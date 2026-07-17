//go:build !windows

package main

import (
	"bufio"
	"os"
	"strings"
)

// parseResolvConf extracts the nameserver entries from a resolv.conf-style
// file. Shared between Linux and macOS.
func parseResolvConf(path string) []string {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	var out []string
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if !strings.HasPrefix(line, "nameserver") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) >= 2 {
			out = append(out, fields[1])
		}
	}
	return out
}
