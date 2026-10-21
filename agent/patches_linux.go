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

	return parseAptSimulate(out), nil
}

// parseAptSimulate turns `apt-get -s dist-upgrade` output into patch items.
//
// Split out from the command execution so the parsing — which is where the
// bugs live — is testable without an apt on the machine. Only "Inst " lines
// carry an upgrade; everything else (Conf, Remove, progress noise) is ignored.
func parseAptSimulate(out []byte) []patchItem {
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
		// apt names the origin in brackets; the security pocket is the only
		// signal available here, so a match is the closest thing to a
		// severity that this OS gives us.
		if strings.Contains(strings.ToLower(line), "security") {
			severity = "important"
		}
		items = append(items, patchItem{PatchID: pkg, Title: pkg, Severity: severity})
	}
	return items
}

// aptInstallArgs builds the apt-get arguments for an install run: exactly the
// named packages, or a full dist-upgrade for an empty list. Every name has to
// be a package name; "--" additionally ends apt's options before them.
func aptInstallArgs(patchIDs []string) ([]string, error) {
	if len(patchIDs) == 0 {
		return []string{"dist-upgrade", "-y"}, nil
	}
	for _, id := range patchIDs {
		if !isDebianPackage(id) {
			return nil, fmt.Errorf("patch id %q rejected: not a Debian package name", id)
		}
	}
	return append([]string{"install", "-y", "--only-upgrade", "--"}, patchIDs...), nil
}

// installPatchesOS upgrades exactly the named packages. Empty list = all
// upgradable (full dist-upgrade). Requires root; streams apt output to w.
func installPatchesOS(ctx context.Context, patchIDs []string, w io.Writer) error {
	args, err := aptInstallArgs(patchIDs)
	if err != nil {
		return err
	}
	cmd := exec.CommandContext(ctx, "apt-get", args...)
	cmd.Env = append(os.Environ(), "DEBIAN_FRONTEND=noninteractive", "LC_ALL=C")
	cmd.Stdout = w
	cmd.Stderr = w
	return cmd.Run()
}
