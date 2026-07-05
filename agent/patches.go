package main

import (
	"context"
	"log"
	"time"
)

// patchItem is one available OS update. patch_id is the OS-native identifier
// used later to install exactly this update (apt package name, Windows
// UpdateID, macOS label).
type patchItem struct {
	PatchID  string `json:"patch_id"`
	Title    string `json:"title"`
	Severity string `json:"severity"` // critical|important|moderate|low|other
}

// patchScanTimeout caps a scan — Windows Update searches can be slow.
const patchScanTimeout = 5 * time.Minute

// scanPatches runs the OS-specific scan and always returns a slice (never
// nil), so an empty report clears the server's list rather than being
// treated as "no data".
func scanPatches(parent context.Context) []patchItem {
	ctx, cancel := context.WithTimeout(parent, patchScanTimeout)
	defer cancel()
	items, err := scanPatchesOS(ctx)
	if err != nil {
		log.Printf("patch scan failed: %v", err)
	}
	if items == nil {
		items = []patchItem{}
	}
	return items
}

// runPatchInstall installs the requested patches as a job (streamed output),
// then re-scans so the server's list reflects what's left. Mirrors runJob's
// lifecycle so the dashboard treats it like any other job.
func runPatchInstall(parent context.Context, s *sender, spec jobSpec) {
	s.send(parent, "job_started", map[string]any{"job_id": spec.JobID})

	w := &chunkWriter{ctx: parent, s: s, jobID: spec.JobID}
	ctx, cancel := context.WithTimeout(parent, perJobTimeout)
	defer cancel()

	status := "done"
	var exitCode any = 0
	if err := installPatchesOS(ctx, spec.PatchIDs, w); err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			status = "timeout"
			exitCode = nil
		} else {
			status = "failed"
			exitCode = nil
			s.send(parent, "job_output", map[string]any{"job_id": spec.JobID, "chunk": "\n" + err.Error()})
		}
	}

	s.send(parent, "job_result", map[string]any{
		"job_id":    spec.JobID,
		"status":    status,
		"exit_code": exitCode,
	})

	// Re-scan so installed patches drop off the dashboard's list.
	report := scanPatches(parent)
	s.send(parent, "patch_report", map[string]any{"patches": report})
}
