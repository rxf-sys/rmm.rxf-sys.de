//go:build !windows

package main

import (
	"context"
	"os/exec"
	"strings"
	"time"
)

// execOut runs a command with a short timeout and returns its stdout.
// Shared helper for the best-effort host probes (identity, security,
// battery) on Linux and macOS — a hanging tool must never stall a heartbeat
// or inventory run. Windows asks the registry and PowerShell instead, so the
// helper is not built there.
func execOut(name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, name, args...).Output()
	return strings.TrimSpace(string(out)), err
}
