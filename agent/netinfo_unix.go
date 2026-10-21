//go:build !windows

package main

import (
	"bufio"
	"io"
	"os"
	"strings"
)

// readResolvConf returns the nameservers listed in the resolv.conf-style
// file at path, or nil when it cannot be read. Shared between Linux and
// macOS.
func readResolvConf(path string) []string {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer closeQuietly(f)
	return parseResolvConf(f)
}

// parseResolvConf extracts the nameserver entries from resolv.conf-style
// content. Kept apart from the file access so it can be tested and fuzzed.
func parseResolvConf(r io.Reader) []string {
	var out []string
	sc := bufio.NewScanner(r)
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		// The keyword must stand alone, as the resolver reads it: a line
		// such as "nameservers 10.0.0.1" configures nothing.
		if len(fields) >= 2 && fields[0] == "nameserver" {
			out = append(out, fields[1])
		}
	}
	return out
}
