//go:build linux

package main

import (
	"bufio"
	"encoding/binary"
	"net"
	"os"
	"strconv"
	"strings"
)

// defaultGateway reads the IPv4 default route straight from
// /proc/net/route — no exec, works in containers and minimal systems.
func defaultGateway() string {
	f, err := os.Open("/proc/net/route")
	if err != nil {
		return ""
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		// Iface Destination Gateway ... — default route has destination 0.
		if len(fields) < 3 || fields[1] != "00000000" {
			continue
		}
		raw, err := strconv.ParseUint(fields[2], 16, 32)
		if err != nil || raw == 0 {
			continue
		}
		ip := make(net.IP, 4)
		binary.LittleEndian.PutUint32(ip, uint32(raw))
		return ip.String()
	}
	return ""
}

// dnsServers reports the configured resolvers. When systemd-resolved's stub
// (127.0.0.53) is the only entry, the resolved copy carries the real
// upstream servers.
func dnsServers() []string {
	servers := parseResolvConf("/etc/resolv.conf")
	if len(servers) == 1 && strings.HasPrefix(servers[0], "127.0.0.53") {
		if real := parseResolvConf("/run/systemd/resolve/resolv.conf"); len(real) > 0 {
			return real
		}
	}
	return servers
}
