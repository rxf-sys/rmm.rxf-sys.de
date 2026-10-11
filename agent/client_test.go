package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestWsEndpoint(t *testing.T) {
	cases := []struct {
		in, want string
		wantErr  bool
	}{
		{in: "https://rmm.rxf-sys.de", want: "wss://rmm.rxf-sys.de/api/agent/ws"},
		{in: "https://rmm.rxf-sys.de/", want: "wss://rmm.rxf-sys.de/api/agent/ws"},
		{in: "http://127.0.0.1:8080", want: "ws://127.0.0.1:8080/api/agent/ws"},
		{in: "ftp://nope", wantErr: true},
	}
	for _, c := range cases {
		got, err := wsEndpoint(c.in)
		if c.wantErr {
			if err == nil {
				t.Errorf("wsEndpoint(%q): expected error, got %q", c.in, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("wsEndpoint(%q): %v", c.in, err)
			continue
		}
		if got != c.want {
			t.Errorf("wsEndpoint(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestDecodeCommand(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want command
	}{
		{"ping", `{"type":"ping"}`, command{Kind: cmdPing}},
		{"ping ignores its payload", `{"type":"ping","payload":"anything"}`, command{Kind: cmdPing}},
		{"patch scan", `{"type":"patch_scan"}`, command{Kind: cmdPatchScan}},
		{"get logs", `{"type":"get_logs","id":"7"}`, command{Kind: cmdGetLogs}},
		{
			"shell job",
			`{"type":"job","payload":{"job_id":42,"kind":"shell","command":"uptime","shell":"bash","timeout_s":600}}`,
			command{Kind: cmdJob, Job: jobSpec{JobID: 42, Kind: "shell", Command: "uptime", Shell: "bash", TimeoutS: 600}},
		},
		{
			"patch install",
			`{"type":"job","payload":{"job_id":9,"kind":"patch_install","command":"[\"curl\"]","shell":"","patch_ids":["curl"]}}`,
			command{Kind: cmdJob, Job: jobSpec{JobID: 9, Kind: "patch_install", Command: `["curl"]`, PatchIDs: []string{"curl"}}},
		},
		{
			"update",
			`{"type":"update","payload":{"version":"0.3.0","url":"/api/agent/download/linux-amd64","sha256":"ab","sig":"cd"}}`,
			command{Kind: cmdUpdate, Update: updateSpec{Version: "0.3.0", URL: "/api/agent/download/linux-amd64", SHA256: "ab", Sig: "cd"}},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := decodeCommand([]byte(c.in))
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !reflect.DeepEqual(got, c.want) {
				t.Errorf("got %+v, want %+v", got, c.want)
			}
		})
	}
}

func TestDecodeCommandRejects(t *testing.T) {
	cases := []struct {
		name    string
		in      string
		unknown bool // a readable message of a type this agent does not know
	}{
		{"not JSON", `ping`, false},
		{"truncated", `{"type":"job","payload":{"job_id":1`, false},
		{"array instead of object", `[{"type":"ping"}]`, false},
		{"type is not a string", `{"type":7}`, false},
		{"job without payload", `{"type":"job"}`, false},
		{"job payload is a string", `{"type":"job","payload":"rm -rf /"}`, false},
		{"job id is not a number", `{"type":"job","payload":{"job_id":"1"}}`, false},
		{"timeout overflows int64", `{"type":"job","payload":{"timeout_s":1e30}}`, false},
		{"update without payload", `{"type":"update"}`, false},
		{"update fields of the wrong type", `{"type":"update","payload":{"version":1}}`, false},
		{"unknown type", `{"type":"reboot_now"}`, true},
		{"empty type", `{}`, true},
		{"null", `null`, true},
		{"type differs in case", `{"type":"PING"}`, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := decodeCommand([]byte(c.in))
			if err == nil {
				t.Fatalf("accepted as %+v", got)
			}
			if got.Kind != 0 {
				t.Errorf("a rejected message must not carry a command, got %+v", got)
			}
			if errors.Is(err, errUnknownMessage) != c.unknown {
				t.Errorf("errors.Is(err, errUnknownMessage) = %v, want %v (err: %v)", !c.unknown, c.unknown, err)
			}
		})
	}
}

// The read limit has to admit the largest job the backend lets through: a
// 64,000-character script made of characters that JSON escapes to six bytes
// each. Go's encoder escapes control characters exactly as Starlette does.
func TestWorstCaseScriptFitsTheReadLimit(t *testing.T) {
	const backendScriptLimit = 64_000 // max_length in backend/app/routers/jobs.py and scripts.py
	spec := jobSpec{
		JobID:    1 << 53,
		Kind:     "script",
		Command:  strings.Repeat("\x01", backendScriptLimit),
		Shell:    "powershell",
		TimeoutS: int64(maxJobTimeout / time.Second),
	}
	payload, err := json.Marshal(spec)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(message{Type: "job", Payload: payload})
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) < 6*backendScriptLimit {
		t.Fatalf("encoding is not the worst case any more: %d bytes", len(raw))
	}
	if len(raw) > maxServerMessage {
		t.Fatalf("a legitimate %d-byte job exceeds maxServerMessage (%d)", len(raw), maxServerMessage)
	}
	got, err := decodeCommand(raw)
	if err != nil || got.Job.Command != spec.Command {
		t.Fatalf("worst-case job did not survive decoding: %v", err)
	}
}

func TestDialServerAuthenticatesAndEnforcesTheReadLimit(t *testing.T) {
	upgrader := websocket.Upgrader{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/agent/ws" || r.Header.Get("Authorization") != "Bearer 7:s3cret" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		c, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer closeQuietly(c)
		if err := c.WriteMessage(websocket.TextMessage, bytes.Repeat([]byte("a"), maxServerMessage)); err != nil {
			return
		}
		if err := c.WriteMessage(websocket.TextMessage, bytes.Repeat([]byte("a"), maxServerMessage+1)); err != nil {
			return
		}
		// Hold the connection until the agent hangs up.
		_, _, _ = c.ReadMessage()
	}))
	defer srv.Close()
	ctx := context.Background()

	if _, err := dialServer(ctx, Config{ServerURL: srv.URL, DeviceID: 7, DeviceSecret: "wrong"}); err == nil ||
		!strings.Contains(err.Error(), "401") {
		t.Fatalf("bad credentials: want a 401 dial error, got %v", err)
	}

	conn, err := dialServer(ctx, Config{ServerURL: srv.URL, DeviceID: 7, DeviceSecret: "s3cret"})
	if err != nil {
		t.Fatal(err)
	}
	defer closeQuietly(conn)
	if _, p, err := conn.ReadMessage(); err != nil || len(p) != maxServerMessage {
		t.Fatalf("message at the limit: got %d bytes, err %v", len(p), err)
	}
	if _, _, err := conn.ReadMessage(); !errors.Is(err, websocket.ErrReadLimit) {
		t.Fatalf("message over the limit: want ErrReadLimit, got %v", err)
	}
}

// endlessReader always has another message ready, like a busy server.
type endlessReader struct{}

func (endlessReader) ReadMessage() (int, []byte, error) {
	return websocket.TextMessage, []byte(`{"type":"ping"}`), nil
}

// scriptedReader returns its frames in order, then err forever.
type scriptedReader struct {
	frames [][]byte
	err    error
}

func (r *scriptedReader) ReadMessage() (int, []byte, error) {
	if len(r.frames) == 0 {
		return 0, nil, r.err
	}
	f := r.frames[0]
	r.frames = r.frames[1:]
	return websocket.TextMessage, f, nil
}

// waitDone fails the test when the reader goroutine does not finish.
func waitDone(t *testing.T, done <-chan struct{}) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("readFrames is still blocked after the serve loop went away")
	}
}

func TestReadFramesStopsWhenTheServeLoopIsGone(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	frames := make(chan []byte)
	done := make(chan struct{})
	go func() {
		defer close(done)
		readFrames(ctx, endlessReader{}, frames, make(chan error, 1))
	}()
	<-frames // the loop received one message, then returned for good
	cancel()
	waitDone(t, done)
}

func TestReadFramesDoesNotBlockOnTheErrorAfterCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	done := make(chan struct{})
	go func() {
		defer close(done)
		// Unbuffered and never drained: only ctx can release the send.
		readFrames(ctx, &scriptedReader{err: io.ErrUnexpectedEOF}, make(chan []byte), make(chan error))
	}()
	waitDone(t, done)
}

func TestReadFramesDeliversFramesBeforeTheError(t *testing.T) {
	r := &scriptedReader{frames: [][]byte{[]byte("one"), []byte("two")}, err: io.ErrUnexpectedEOF}
	frames := make(chan []byte)
	readErr := make(chan error, 1)
	go readFrames(context.Background(), r, frames, readErr)
	for _, want := range []string{"one", "two"} {
		if got := string(<-frames); got != want {
			t.Fatalf("got frame %q, want %q", got, want)
		}
	}
	if err := <-readErr; !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("got %v, want the reader's error", err)
	}
}

// nextSent returns the next message the agent queued for the server.
func nextSent(t *testing.T, s *sender) (string, map[string]any) {
	t.Helper()
	select {
	case m := <-s.outbox:
		var payload map[string]any
		if err := json.Unmarshal(m.Payload, &payload); err != nil {
			t.Fatalf("%s payload: %v", m.Type, err)
		}
		return m.Type, payload
	case <-time.After(2 * time.Second):
		t.Fatal("nothing was sent")
		return "", nil
	}
}

func TestDispatchAnswersPingAndLogRequests(t *testing.T) {
	ctx := context.Background()
	s := newSender()

	dispatch(ctx, Config{}, command{Kind: cmdPing}, s)
	if typ, payload := nextSent(t, s); typ != "pong" || payload["ts"] == nil {
		t.Errorf("ping: got %s %v", typ, payload)
	}

	dispatch(ctx, Config{}, command{Kind: cmdGetLogs}, s)
	if typ, payload := nextSent(t, s); typ != "agent_logs" {
		t.Errorf("get_logs: got %s %v", typ, payload)
	} else if _, ok := payload["lines"].([]any); !ok {
		t.Errorf("get_logs: lines must be a list, got %v", payload["lines"])
	}
}

// A job reaches runJob through dispatch; an unsupported shell fails before
// anything is executed, which keeps this test free of side effects.
func TestDispatchRunsAJobToItsResult(t *testing.T) {
	s := newSender()
	dispatch(context.Background(), Config{}, command{Kind: cmdJob, Job: jobSpec{JobID: 5, Shell: "fish"}}, s)

	for _, want := range []string{"job_started", "job_output", "job_result"} {
		typ, payload := nextSent(t, s)
		if typ != want {
			t.Fatalf("got %s, want %s", typ, want)
		}
		if payload["job_id"] != float64(5) {
			t.Errorf("%s: job_id = %v, want 5", typ, payload["job_id"])
		}
		if typ == "job_result" && payload["status"] != "failed" {
			t.Errorf("unsupported shell must fail the job, got %v", payload["status"])
		}
	}
}
