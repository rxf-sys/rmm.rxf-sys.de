//go:build linux

package main

import (
	"bufio"
	"bytes"
	"os/exec"
	"strings"
	"time"
)

// collectSoftware lists installed packages via dpkg (Debian family) with an
// rpm fallback. Anything else (Alpine, Arch, …) just reports empty — good
// enough for a fleet of Debian LXCs and family desktops.
func collectSoftware() []softwareItem {
	if out, err := runWithTimeout("dpkg-query", "-W", "-f", "${Package}\t${Version}\n"); err == nil {
		return parseTabSeparated(out)
	}
	if out, err := runWithTimeout("rpm", "-qa", "--qf", "%{NAME}\t%{VERSION}-%{RELEASE}\n"); err == nil {
		return parseTabSeparated(out)
	}
	return nil
}

func runWithTimeout(name string, args ...string) ([]byte, error) {
	cmd := exec.Command(name, args...)
	var buf bytes.Buffer
	cmd.Stdout = &buf
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		return buf.Bytes(), err
	case <-time.After(30 * time.Second):
		_ = cmd.Process.Kill()
		return nil, <-done
	}
}

func parseTabSeparated(out []byte) []softwareItem {
	var items []softwareItem
	sc := bufio.NewScanner(bytes.NewReader(out))
	for sc.Scan() {
		name, version, ok := strings.Cut(sc.Text(), "\t")
		if !ok || name == "" {
			continue
		}
		items = append(items, softwareItem{Name: name, Version: version})
	}
	return items
}
