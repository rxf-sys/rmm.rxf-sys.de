//go:build !windows

package main

import (
	"context"
	"strings"
	"testing"
)

func TestShellCommandSelectsTheRightInterpreter(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		shell    string
		wantBin  string
		wantFlag string
	}{
		{"bash", "bash", "-c"},
		{"", "bash", "-c"}, // empty means the default
		{"zsh", "zsh", "-c"},
		{"powershell", "powershell", "-NoProfile"},
	}
	for _, c := range cases {
		t.Run(c.shell, func(t *testing.T) {
			cmd, err := shellCommand(ctx, c.shell, "echo hi")
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !strings.HasSuffix(cmd.Path, c.wantBin) && cmd.Args[0] != c.wantBin {
				t.Errorf("interpreter = %q, want %q", cmd.Args[0], c.wantBin)
			}
			if cmd.Args[1] != c.wantFlag {
				t.Errorf("first flag = %q, want %q", cmd.Args[1], c.wantFlag)
			}
			// The command must stay ONE argv element: the shell parses it,
			// nothing here concatenates it into a command line.
			last := cmd.Args[len(cmd.Args)-1]
			if last != "echo hi" {
				t.Errorf("command arg = %q, want it passed through untouched", last)
			}
		})
	}
}

func TestShellCommandRejectsUnknownShells(t *testing.T) {
	// A server-supplied shell name must never reach exec as a binary name.
	for _, bad := range []string{"sh; rm -rf /", "python", "cmd", "BASH"} {
		if _, err := shellCommand(context.Background(), bad, "echo hi"); err == nil {
			t.Errorf("shell %q was accepted, want an error", bad)
		}
	}
}

func TestJobTimeoutClamping(t *testing.T) {
	// Complements TestJobTimeout in jobs_test.go with the boundary values.
	if got := jobTimeout(jobSpec{TimeoutS: 1}); got.Seconds() != 1 {
		t.Errorf("a one-second job timeout should survive, got %v", got)
	}
	if got := jobTimeout(jobSpec{TimeoutS: int64(maxJobTimeout.Seconds())}); got != maxJobTimeout {
		t.Errorf("exactly the cap should be kept, got %v", got)
	}
	if got := jobTimeout(jobSpec{TimeoutS: int64(maxJobTimeout.Seconds()) + 1}); got != maxJobTimeout {
		t.Errorf("above the cap should clamp, got %v", got)
	}
}
