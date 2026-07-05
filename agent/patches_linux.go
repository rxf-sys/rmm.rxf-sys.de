//go:build linux

package main

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
)

// scanPatchesOS lists upgradable packages via a simulated apt dist-upgrade.
// Each "Inst" line names a package and the repo it upgrades from; packages
// coming from a *-security repo are flagged important. dpkg/apt only — other
// distros report nothing (fine for a Debian/Ubuntu fleet).
func scanPatchesOS(ctx context.Context) ([]patchItem, error) {
	// -s simulates (no root needed for the scan); update the lists first so
	// the simulation reflects current upstream state (best-effort).
	_ = exec.CommandContext(ctx, "apt-get", "update", "-qq").Run()

	cmd := exec.CommandContext(ctx, "apt-get", "-s", "dist-upgrade")
	cmd.Env = append(os.Environ(), "DEBIAN_FRONTEND=noninteractive", "LC_ALL=C")
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("apt-get simulate: %w", err)
	}

	var items []patchItem
	sc := bufio.NewScanner(bytes.NewReader(out))
	for sc.Scan() {
		line := sc.Text()
		if !strings.HasPrefix(line, "Inst ") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		pkg := fields[1]
		severity := "other"
		if strings.Contains(strings.ToLower(line), "security") {
			severity = "important"
		}
		items = append(items, patchItem{PatchID: pkg, Title: pkg, Severity: severity})
	}
	return items, nil
}

// installPatchesOS upgrades exactly the named packages. Empty list = all
// upgradable (full dist-upgrade). Requires root; streams apt output to w.
func installPatchesOS(ctx context.Context, patchIDs []string, w io.Writer) error {
	args := []string{"install", "-y", "--only-upgrade"}
	if len(patchIDs) == 0 {
		args = []string{"dist-upgrade", "-y"}
	} else {
		args = append(args, patchIDs...)
	}
	cmd := exec.CommandContext(ctx, "apt-get", args...)
	cmd.Env = append(os.Environ(), "DEBIAN_FRONTEND=noninteractive", "LC_ALL=C")
	cmd.Stdout = w
	cmd.Stderr = w
	return cmd.Run()
}
