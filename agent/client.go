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
)

type message struct {
	Type    string          `json:"type"`
	ID      string          `json:"id,omitempty"`
	Payload json.RawMessage `json:"payload,omitempty"`
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

	send := func(msgType string, payload any) error {
		raw, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		_ = conn.SetWriteDeadline(time.Now().Add(writeTimeout))
		return conn.WriteJSON(message{Type: msgType, Payload: raw})
	}

	// First heartbeat immediately — it flips the device to 'online' in the
	// dashboard without waiting a full interval — followed by a full
	// inventory so the device page is populated right after enrollment.
	if err := send("heartbeat", collectHeartbeat()); err != nil {
		return err
	}
	if err := send("inventory", collectInventory()); err != nil {
		return err
	}

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
		case <-ticker.C:
			if err := send("heartbeat", collectHeartbeat()); err != nil {
				return err
			}
		case <-inventoryTicker.C:
			if err := send("inventory", collectInventory()); err != nil {
				return err
			}
		case msg, ok := <-incoming:
			if !ok {
				return <-readErr
			}
			if err := handleMessage(msg, send); err != nil {
				return err
			}
		}
	}
}

// handleMessage dispatches a server message. Phase 0 only answers pings;
// job execution, inventory requests and patch scans hook in here later.
func handleMessage(msg message, send func(string, any) error) error {
	switch msg.Type {
	case "ping":
		return send("pong", map[string]any{"ts": time.Now().Unix()})
	default:
		log.Printf("ignoring unknown message type %q", msg.Type)
		return nil
	}
}
