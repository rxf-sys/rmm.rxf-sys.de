package main

import (
	"context"
	"fmt"
	"log"
	"regexp"
	"strings"
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

// patchInstallTimeout caps an install run. Deliberately much longer than the
// shell-job timeout: a large dist-upgrade or Windows-Update run easily takes
// more than 10 minutes, and killing apt/dpkg mid-transaction can leave the
// package system inconsistent. The server's sweep (patch_job_timeout_s) sits
// above this value.
const patchInstallTimeout = 60 * time.Minute

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
	ctx, cancel := context.WithTimeout(parent, patchInstallTimeout)
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

// Patch ids come from the server and end up as apt arguments or spliced into
// the Windows Update script. The agent passes on only ids of the shape the
// scan on that OS reports, so neither a broken server nor anything between
// it and the agent can slip in an option or end a quoted string. The checks
// live here rather than in the per-OS files so their tests run on every OS.
var (
	// A Windows Update UpdateID is a GUID, printed without braces.
	updateIDPattern = regexp.MustCompile(
		`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	// A binary package name as Debian policy 5.6.7 defines it, optionally
	// with the architecture apt appends for a foreign one (libc6:i386).
	debianPackagePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9+.-]+(:[a-z0-9][a-z0-9-]*)?$`)
)

func isUpdateID(id string) bool { return updateIDPattern.MatchString(id) }

func isDebianPackage(id string) bool { return debianPackagePattern.MatchString(id) }

// powerShellUpdateIDs renders UpdateIDs as the elements of a PowerShell
// array for installScript. Escaping is no option here: PowerShell ends a
// single-quoted string not only at U+0027 but also at U+2018 through U+201B.
// A GUID contains none of them, so an id that is one can be quoted as is.
func powerShellUpdateIDs(ids []string) (string, error) {
	quoted := make([]string, len(ids))
	for i, id := range ids {
		if !isUpdateID(id) {
			return "", fmt.Errorf("patch id %q rejected: not a Windows Update UpdateID (GUID)", id)
		}
		quoted[i] = "'" + id + "'"
	}
	return strings.Join(quoted, ","), nil
}
