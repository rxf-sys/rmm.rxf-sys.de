package main

import (
	"strings"
	"sync"
)

// logRing keeps the agent's most recent log lines in memory so the server
// can pull them for remote diagnostics ("warum verbindet der Agent nicht
// richtig?") without shell access to the device. Plugged into the stdlib
// logger as a secondary output in main.
type ringBuffer struct {
	mu    sync.Mutex
	lines []string
	max   int
	part  strings.Builder // carry for writes without trailing newline
}

var logRing = &ringBuffer{max: 200}

func (r *ringBuffer) Write(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.part.Write(p)
	for {
		s := r.part.String()
		idx := strings.IndexByte(s, '\n')
		if idx < 0 {
			break
		}
		line := strings.TrimRight(s[:idx], "\r")
		r.part.Reset()
		r.part.WriteString(s[idx+1:])
		if line == "" {
			continue
		}
		r.lines = append(r.lines, line)
		if len(r.lines) > r.max {
			r.lines = r.lines[len(r.lines)-r.max:]
		}
	}
	return len(p), nil
}

// Snapshot returns a copy of the buffered lines, oldest first.
func (r *ringBuffer) Snapshot() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]string, len(r.lines))
	copy(out, r.lines)
	return out
}
