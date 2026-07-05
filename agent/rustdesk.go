package main

import (
	"context"
	"os/exec"
	"strings"
	"time"
)

// rustDeskID returns the installed RustDesk client's ID, or "" when RustDesk
// isn't installed. Reported in the heartbeat so the dashboard can offer a
// one-click remote session. Best-effort and quick — a missing binary or a
// slow call must never hold up the heartbeat.
//
// `rustdesk --get-id` prints the stable ID on all three platforms. The
// binary name differs on Windows, so we try the common locations.
func rustDeskID() string {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	for _, bin := range rustDeskBinaries() {
		out, err := exec.CommandContext(ctx, bin, "--get-id").Output()
		if err != nil {
			continue
		}
		id := strings.TrimSpace(string(out))
		// The ID is numeric (9-10 digits); guard against a help/usage dump.
		if id != "" && len(id) <= 20 && !strings.ContainsAny(id, " \t\n") {
			return id
		}
	}
	return ""
}
