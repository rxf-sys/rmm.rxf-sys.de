//go:build windows

package main

import (
	"context"
	"os/exec"
	"strings"
	"time"
)

// psLines runs a PowerShell expression and returns its non-empty output
// lines. Inventory collection is infrequent (connect + every 12 h), so the
// exec cost is fine.
func psLines(expr string) []string {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "powershell", "-NoProfile", "-NonInteractive",
		"-Command", expr).Output()
	if err != nil {
		return nil
	}
	var lines []string
	for _, line := range strings.Split(string(out), "\n") {
		if line = strings.TrimSpace(line); line != "" {
			lines = append(lines, line)
		}
	}
	return lines
}

// defaultGateway returns the next hop of the lowest-metric IPv4 default route.
func defaultGateway() string {
	lines := psLines(
		"(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |" +
			" Sort-Object RouteMetric | Select-Object -First 1).NextHop")
	if len(lines) == 0 || lines[0] == "0.0.0.0" {
		return ""
	}
	return lines[0]
}

// dnsServers returns the configured IPv4 resolvers across adapters, deduped
// in order of appearance.
func dnsServers() []string {
	lines := psLines(
		"Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |" +
			" Select-Object -ExpandProperty ServerAddresses")
	seen := map[string]bool{}
	var out []string
	for _, s := range lines {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}
