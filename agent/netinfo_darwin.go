//go:build darwin

package main

import (
	"context"
	"os/exec"
	"strings"
	"time"
)

// defaultGateway asks the routing table for the default route.
func defaultGateway() string {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "route", "-n", "get", "default").Output()
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if v, ok := strings.CutPrefix(line, "gateway:"); ok {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func dnsServers() []string {
	// macOS keeps a resolv.conf mirror of the active resolver config.
	return parseResolvConf("/etc/resolv.conf")
}
