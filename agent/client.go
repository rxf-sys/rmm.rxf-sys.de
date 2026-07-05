package main

import (
	"context"
	"encoding/json"
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
	writeTimeout      = 10 * time.Second
	outboxSize        = 64
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
		if err := connectAndServe(ctx, cfg); err != nil {
			if ctx.Err() != nil {
				return
			}
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

func connectAndServe(ctx context.Context, cfg Config) error {
	endpoint, err := wsEndpoint(cfg.ServerURL)
	if err != nil {
		return err
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
			return fmt.Errorf("dial %s: %s", endpoint, resp.Status)
		}
		return fmt.Errorf("dial %s: %w", endpoint, err)
	}
	defer conn.Close()
	log.Printf("connected to %s", endpoint)

	// A per-connection context cancels in-flight jobs when the socket drops.
	connCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	s := newSender()

	// Reader goroutine: surfaces incoming messages + read errors.
	incoming := make(chan message)
	readErr := make(chan error, 1)
	go func() {
		defer close(incoming)
		for {
			var msg message
			if err := conn.ReadJSON(&msg); err != nil {
				readErr <- err
				return
			}
			incoming <- msg
		}
	}()

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
		case msg, ok := <-incoming:
			if !ok {
				return <-readErr
			}
			handleMessage(connCtx, msg, s)
		}
	}
}

// handleMessage dispatches a server message. Ping/pong keeps the pipeline
// observable; "job" hands off to a goroutine so long commands never block
// heartbeats or other messages.
func handleMessage(ctx context.Context, msg message, s *sender) {
	switch msg.Type {
	case "ping":
		s.send(ctx, "pong", map[string]any{"ts": time.Now().Unix()})
	case "job":
		var spec jobSpec
		if err := json.Unmarshal(msg.Payload, &spec); err != nil {
			log.Printf("bad job payload: %v", err)
			return
		}
		go runJob(ctx, s, spec)
	default:
		log.Printf("ignoring unknown message type %q", msg.Type)
	}
}
