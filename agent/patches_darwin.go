//go:build darwin

package main

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"os/exec"
	"strings"
)

// scanPatchesOS parses `softwareupdate -l`. Its output pairs a "* Label:"
// line with a following details line; the label is the install identifier
// and "Recommended: YES" marks an update worth flagging as important.
func scanPatchesOS(ctx context.Context) ([]patchItem, error) {
	out, err := exec.CommandContext(ctx, "softwareupdate", "-l").CombinedOutput()
	if err != nil {
		// softwareupdate exits non-zero when nothing is available; treat a
		// parseable-but-empty result as success rather than an error.
		if len(out) == 0 {
			return nil, fmt.Errorf("softwareupdate -l: %w", err)
		}
	}

	var items []patchItem
	sc := bufio.NewScanner(bytes.NewReader(out))
	var pending *patchItem
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if strings.HasPrefix(line, "* Label:") {
			if pending != nil {
				items = append(items, *pending)
			}
			label := strings.TrimSpace(strings.TrimPrefix(line, "* Label:"))
			pending = &patchItem{PatchID: label, Title: label, Severity: "other"}
		} else if pending != nil && strings.Contains(line, "Title:") {
			// Details line: refine the title and severity.
			if t := extractField(line, "Title:"); t != "" {
				pending.Title = t
			}
			if strings.Contains(line, "Recommended: YES") {
				pending.Severity = "important"
			}
		}
	}
	if pending != nil {
		items = append(items, *pending)
	}
	return items, nil
}

// extractField pulls "Field: value" out of a comma-separated details line.
func extractField(line, field string) string {
	idx := strings.Index(line, field)
	if idx < 0 {
		return ""
	}
	rest := line[idx+len(field):]
	if comma := strings.Index(rest, ","); comma >= 0 {
		rest = rest[:comma]
	}
	return strings.TrimSpace(rest)
}

// installPatchesOS installs the named labels (or all recommended when the
// list is empty). OS upgrades may still require interaction/restart; this
// triggers the install and streams whatever softwareupdate reports.
func installPatchesOS(ctx context.Context, patchIDs []string, w io.Writer) error {
	args := []string{"-i"}
	if len(patchIDs) == 0 {
		args = append(args, "-r") // recommended only
	} else {
		for _, id := range patchIDs {
			args = append(args, "--product", id)
		}
	}
	cmd := exec.CommandContext(ctx, "softwareupdate", args...)
	cmd.Stdout = w
	cmd.Stderr = w
	return cmd.Run()
}
