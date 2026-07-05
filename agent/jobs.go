package main

import (
	"context"
	"errors"
	"os/exec"
	"runtime"
	"sync"
	"time"
)

// perJobTimeout caps a single command. The server has its own, longer sweep
// (job_timeout_s) as a backstop for the case where the agent dies entirely.
const perJobTimeout = 10 * time.Minute

type jobSpec struct {
	JobID   int64  `json:"job_id"`
	Kind    string `json:"kind"`
	Command string `json:"command"`
	Shell   string `json:"shell"`
}

// chunkWriter forwards process output to the server as job_output messages.
// stdout and stderr are wired to the same writer, so a mutex serializes the
// interleaved writes into a single ordered stream.
type chunkWriter struct {
	ctx   context.Context
	s     *sender
	jobID int64
	mu    sync.Mutex
}

func (w *chunkWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.s.send(w.ctx, "job_output", map[string]any{
		"job_id": w.jobID,
		"chunk":  string(p),
	})
	return len(p), nil
}

// shellCommand builds the exec.Cmd for a requested shell. Unknown or
// platform-mismatched shells return an error the caller reports as a failed
// job rather than a crash.
func shellCommand(ctx context.Context, shell, command string) (*exec.Cmd, error) {
	switch shell {
	case "powershell":
		return exec.CommandContext(ctx, "powershell", "-NoProfile", "-NonInteractive",
			"-Command", command), nil
	case "zsh":
		return exec.CommandContext(ctx, "zsh", "-c", command), nil
	case "bash", "":
		// On Windows there is no bash by default; fall back to powershell so a
		// "bash" default script still does something sensible.
		if runtime.GOOS == "windows" {
			return exec.CommandContext(ctx, "powershell", "-NoProfile", "-NonInteractive",
				"-Command", command), nil
		}
		return exec.CommandContext(ctx, "bash", "-c", command), nil
	default:
		return nil, errors.New("unsupported shell: " + shell)
	}
}

// runJob executes one job and reports its lifecycle: job_started → streamed
// job_output → job_result. Best-effort throughout; any local failure becomes
// a job_result with status "failed" so the dashboard never shows a job stuck
// in "running".
func runJob(parent context.Context, s *sender, spec jobSpec) {
	s.send(parent, "job_started", map[string]any{"job_id": spec.JobID})

	ctx, cancel := context.WithTimeout(parent, perJobTimeout)
	defer cancel()

	cmd, err := shellCommand(ctx, spec.Shell, spec.Command)
	if err != nil {
		s.send(parent, "job_output", map[string]any{"job_id": spec.JobID, "chunk": err.Error()})
		s.send(parent, "job_result", map[string]any{"job_id": spec.JobID, "status": "failed", "exit_code": nil})
		return
	}

	w := &chunkWriter{ctx: parent, s: s, jobID: spec.JobID}
	cmd.Stdout = w
	cmd.Stderr = w

	runErr := cmd.Run()

	status := "done"
	var exitCode any
	if ctx.Err() == context.DeadlineExceeded {
		status = "timeout"
	} else if runErr != nil {
		var exitErr *exec.ExitError
		if errors.As(runErr, &exitErr) {
			// Command ran but returned non-zero — that's a completed job with a
			// failing exit code, not an agent-side failure.
			status = "done"
			exitCode = exitErr.ExitCode()
		} else {
			// Couldn't start (shell missing, permission denied, …).
			status = "failed"
			s.send(parent, "job_output", map[string]any{"job_id": spec.JobID, "chunk": runErr.Error()})
		}
	} else {
		exitCode = 0
	}

	s.send(parent, "job_result", map[string]any{
		"job_id":    spec.JobID,
		"status":    status,
		"exit_code": exitCode,
	})
}
