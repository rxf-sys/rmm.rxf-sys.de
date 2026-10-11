package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

const (
	heartbeatInterval = 60 * time.Second
	inventoryInterval = 12 * time.Hour
	backoffMin        = 2 * time.Second
	backoffMax        = 5 * time.Minute
	// A connection alive at least this long counts as healthy — its later
	// drop resets the reconnect backoff instead of compounding it.
	healthyConnMin = 30 * time.Second
	writeTimeout   = 10 * time.Second
	outboxSize     = 64

	// maxServerMessage caps one inbound WebSocket message. gorilla/websocket
	// assembles a whole message in memory and has no limit by default, so
	// without a cap a broken server or anything sitting between it and the
	// agent could make every agent in the fleet allocate without bound.
	//
	// The largest legitimate server message is a job carrying a script: the
	// backend accepts up to 64,000 characters for a command or a saved script
	// (max_length in backend/app/routers/jobs.py and scripts.py). Starlette's
	// send_json writes non-ASCII as UTF-8 (at most 4 bytes per character) and
	// escapes control characters as \u00XX (6 bytes), so the worst case is
	// 64,000 × 6 = 384,000 bytes plus a small envelope. Patch installs carry
	// package lists far below that. 1 MiB leaves more than twice that headroom
	// and still bounds the memory one message can take.
	maxServerMessage = 1 << 20
)

type message struct {
	Type    string          `json:"type"`
	ID      string          `json:"id,omitempty"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

// sender serializes all outbound writes through one channel. gorilla/websocket
// forbids concurrent writes, and job execution streams output from its own
// goroutine while heartbeats keep ticking — so every writer enqueues here and
// a single drain (the main select loop) does the actual WriteJSON.
type sender struct {
	outbox chan message
}

func newSender() *sender { return &sender{outbox: make(chan message, outboxSize)} }

// send marshals and enqueues a message. It blocks when the outbox is full,
// which applies natural backpressure to a chatty job instead of dropping
// output. ctx cancellation unblocks it during shutdown.
func (s *sender) send(ctx context.Context, msgType string, payload any) {
	raw, err := json.Marshal(payload)
	if err != nil {
		log.Printf("marshal %s: %v", msgType, err)
		return
	}
	select {
	case s.outbox <- message{Type: msgType, Payload: raw}:
	case <-ctx.Done():
	}
}

// runAgent keeps one WSS connection to the server alive until ctx is
// cancelled: connect, pump heartbeats, react to server messages, reconnect
// with jittered exponential backoff on any failure.
func runAgent(ctx context.Context, cfg Config) {
	backoff := backoffMin
	for {
		start := time.Now()
		err := connectAndServe(ctx, cfg)
		if ctx.Err() != nil {
			return
		}
		// A connection that stayed up a while was healthy — the drop is a
		// server restart or transient network blip, not a failing endpoint.
		// Reset the backoff so the agent reconnects within seconds (and the
		// device flips back online quickly) instead of waiting out a window
		// that crept up to backoffMax over earlier failures.
		if time.Since(start) >= healthyConnMin {
			backoff = backoffMin
		}
		if err != nil {
			log.Printf("connection lost: %v — retrying in %s", err, backoff)
		}
		// Jitter spreads a fleet's reconnects after a server restart.
		sleep := backoff + time.Duration(rand.Int63n(int64(backoff/2)))
		select {
		case <-ctx.Done():
			return
		case <-time.After(sleep):
		}
		backoff = min(backoff*2, backoffMax)
	}
}

func wsEndpoint(serverURL string) (string, error) {
	u, err := url.Parse(serverURL)
	if err != nil {
		return "", err
	}
	switch u.Scheme {
	case "https":
		u.Scheme = "wss"
	case "http":
		// Plain http is only reasonable against a dev server on localhost.
		u.Scheme = "ws"
	default:
		return "", fmt.Errorf("unsupported server URL scheme %q", u.Scheme)
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/api/agent/ws"
	return u.String(), nil
}

// dialServer opens the agent socket with the limits every connection needs.
func dialServer(ctx context.Context, cfg Config) (*websocket.Conn, error) {
	endpoint, err := wsEndpoint(cfg.ServerURL)
	if err != nil {
		return nil, err
	}
	header := http.Header{}
	header.Set("Authorization", fmt.Sprintf("Bearer %d:%s", cfg.DeviceID, cfg.DeviceSecret))
	header.Set("User-Agent", "rmm-agent/"+version)

	dialer := websocket.Dialer{
		Proxy:            http.ProxyFromEnvironment,
		HandshakeTimeout: 15 * time.Second,
	}
	conn, resp, err := dialer.DialContext(ctx, endpoint, header)
	if err != nil {
		if resp != nil {
			return nil, fmt.Errorf("dial %s: %s", endpoint, resp.Status)
		}
		return nil, fmt.Errorf("dial %s: %w", endpoint, err)
	}
	// Set before the first read: an oversized message then fails that read
	// (and the reconnect loop takes over) instead of being buffered whole.
	conn.SetReadLimit(maxServerMessage)
	log.Printf("connected to %s", endpoint)
	return conn, nil
}

func connectAndServe(ctx context.Context, cfg Config) error {
	conn, err := dialServer(ctx, cfg)
	if err != nil {
		return err
	}
	defer closeQuietly(conn)

	// A per-connection context cancels in-flight jobs when the socket drops.
	// It also releases the reader goroutine below: cancel runs before the
	// close (defers unwind in reverse), and the close then unblocks a read
	// that is still in progress.
	connCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	s := newSender()

	frames := make(chan []byte)
	readErr := make(chan error, 1)
	go readFrames(connCtx, conn, frames, readErr)

	// First heartbeat immediately — it flips the device to 'online' in the
	// dashboard without waiting a full interval — followed by a full
	// inventory so the device page is populated right after enrollment.
	s.send(connCtx, "heartbeat", collectHeartbeat())
	s.send(connCtx, "inventory", collectInventory())

	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()
	inventoryTicker := time.NewTicker(inventoryInterval)
	defer inventoryTicker.Stop()
	for {
		select {
		case <-ctx.Done():
			_ = conn.WriteControl(
				websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.CloseNormalClosure, "shutdown"),
				time.Now().Add(writeTimeout),
			)
			return nil
		case err := <-readErr:
			return err
		case m := <-s.outbox:
			_ = conn.SetWriteDeadline(time.Now().Add(writeTimeout))
			if err := conn.WriteJSON(m); err != nil {
				return err
			}
		case <-ticker.C:
			s.send(connCtx, "heartbeat", collectHeartbeat())
		case <-inventoryTicker.C:
			s.send(connCtx, "inventory", collectInventory())
		case raw := <-frames:
			cmd, err := decodeCommand(raw)
			if err != nil {
				// Dropped, not fatal: a newer server may send something this
				// agent does not know yet, and reconnecting would not make the
				// next message any more readable.
				log.Printf("ignoring server message: %v", err)
				continue
			}
			dispatch(connCtx, cfg, cmd, s)
		}
	}
}

// frameReader is the part of *websocket.Conn that readFrames uses, narrowed
// so the reader can be tested without a network.
type frameReader interface {
	ReadMessage() (messageType int, p []byte, err error)
}

// readFrames hands every inbound message to the serve loop and reports the
// first read error. Both sends also watch ctx: once the serve loop has
// returned nobody receives any more, and an unconditional send would park
// this goroutine — together with the message it holds — for the rest of the
// process, once per reconnect.
func readFrames(ctx context.Context, r frameReader, frames chan<- []byte, readErr chan<- error) {
	for {
		_, data, err := r.ReadMessage()
		if err != nil {
			select {
			case readErr <- err:
			case <-ctx.Done():
			}
			return
		}
		select {
		case frames <- data:
		case <-ctx.Done():
			return
		}
	}
}

// commandKind names what the server asked for. The zero value is never the
// result of a successful decode.
type commandKind int

const (
	cmdPing commandKind = iota + 1
	cmdJob
	cmdPatchScan
	cmdGetLogs
	cmdUpdate
)

// command is one decoded server message. Job is set only for cmdJob and
// Update only for cmdUpdate; the other kinds carry no payload.
type command struct {
	Kind   commandKind
	Job    jobSpec
	Update updateSpec
}

// errUnknownMessage marks a well-formed message of a type this agent does
// not know.
var errUnknownMessage = errors.New("unknown message type")

// decodeCommand turns one raw server message into a typed command and does
// nothing else — no logging, no goroutines, no I/O. Everything the network
// can hand the agent passes through here first, so keeping it pure lets the
// tests and the fuzzer cover it without running anything on the machine.
func decodeCommand(raw []byte) (command, error) {
	var msg message
	if err := json.Unmarshal(raw, &msg); err != nil {
		return command{}, fmt.Errorf("decode message: %w", err)
	}
	switch msg.Type {
	case "ping":
		return command{Kind: cmdPing}, nil
	case "patch_scan":
		return command{Kind: cmdPatchScan}, nil
	case "get_logs":
		return command{Kind: cmdGetLogs}, nil
	case "job":
		var spec jobSpec
		if err := json.Unmarshal(msg.Payload, &spec); err != nil {
			return command{}, fmt.Errorf("bad job payload: %w", err)
		}
		return command{Kind: cmdJob, Job: spec}, nil
	case "update":
		var spec updateSpec
		if err := json.Unmarshal(msg.Payload, &spec); err != nil {
			return command{}, fmt.Errorf("bad update payload: %w", err)
		}
		return command{Kind: cmdUpdate, Update: spec}, nil
	default:
		return command{}, fmt.Errorf("%w %q", errUnknownMessage, msg.Type)
	}
}

// dispatch carries out a decoded command. Ping/pong keeps the pipeline
// observable; anything that can take a while (jobs, scans, updates) runs in
// its own goroutine so it never blocks heartbeats or later messages.
func dispatch(ctx context.Context, cfg Config, cmd command, s *sender) {
	switch cmd.Kind {
	case cmdPing:
		s.send(ctx, "pong", map[string]any{"ts": time.Now().Unix()})
	case cmdJob:
		if cmd.Job.Kind == "patch_install" {
			go runPatchInstall(ctx, s, cmd.Job)
		} else {
			go runJob(ctx, s, cmd.Job)
		}
	case cmdPatchScan:
		go func() {
			report := scanPatches(ctx)
			s.send(ctx, "patch_report", map[string]any{"patches": report})
		}()
	case cmdGetLogs:
		// Remote diagnostics: ship the recent log ring to the dashboard.
		s.send(ctx, "agent_logs", map[string]any{"lines": logRing.Snapshot()})
	case cmdUpdate:
		go func() {
			if err := applyUpdate(ctx, cfg, cmd.Update); err != nil {
				log.Printf("self-update failed: %v", err)
			}
		}()
	}
}
