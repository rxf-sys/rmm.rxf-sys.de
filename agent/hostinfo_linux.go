//go:build linux

package main

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/shirou/gopsutil/v4/host"
)

// loggedInUser reports the first active login session (utmp). Empty on
// headless boxes or distros that no longer maintain utmp — best effort.
func loggedInUser() string {
	users, err := host.Users()
	if err != nil || len(users) == 0 {
		return ""
	}
	return users[0].User
}

// rebootRequired mirrors Debian/Ubuntu's marker file written by apt when a
// kernel/libc update wants a restart.
func rebootRequired() bool {
	_, err := os.Stat("/var/run/reboot-required")
	return err == nil
}

// batteryStatus reads the first battery under /sys/class/power_supply.
// state "" means "no battery" (desktops, servers, containers).
func batteryStatus() (pct float64, state string) {
	entries, _ := filepath.Glob("/sys/class/power_supply/*")
	for _, dir := range entries {
		typ, err := os.ReadFile(filepath.Join(dir, "type"))
		if err != nil || strings.TrimSpace(string(typ)) != "Battery" {
			continue
		}
		capRaw, err := os.ReadFile(filepath.Join(dir, "capacity"))
		if err != nil {
			continue
		}
		v, err := strconv.ParseFloat(strings.TrimSpace(string(capRaw)), 64)
		if err != nil {
			continue
		}
		st := ""
		if raw, err := os.ReadFile(filepath.Join(dir, "status")); err == nil {
			switch strings.TrimSpace(string(raw)) {
			case "Charging":
				st = "charging"
			case "Discharging":
				st = "discharging"
			case "Full":
				st = "full"
			case "Not charging":
				st = "ac"
			default:
				st = "ac"
			}
		}
		return v, st
	}
	return 0, ""
}

func dmi(name string) string {
	raw, err := os.ReadFile("/sys/class/dmi/id/" + name)
	if err != nil {
		return ""
	}
	v := strings.TrimSpace(string(raw))
	// Boards without values report filler strings.
	if v == "To be filled by O.E.M." || v == "Default string" || v == "None" {
		return ""
	}
	return v
}

// systemIdentity reads manufacturer/model/serial from DMI (root can read
// the serial; the agent runs as root).
func systemIdentity() (manufacturer, model, serial string) {
	return dmi("sys_vendor"), dmi("product_name"), dmi("product_serial")
}

// securityStatus reports firewall + disk-encryption posture. Keys are only
// set when a state was positively detected — no guessing.
func securityStatus() map[string]string {
	out := map[string]string{}
	if o, err := execOut("ufw", "status"); err == nil {
		if strings.Contains(o, "Status: active") {
			out["firewall"] = "ufw aktiv"
		} else {
			out["firewall"] = "ufw inaktiv"
		}
	} else if o, err := execOut("firewall-cmd", "--state"); err == nil && o == "running" {
		out["firewall"] = "firewalld aktiv"
	}
	// LUKS: any device-mapper target with a crypt UUID.
	if uuids, _ := filepath.Glob("/sys/block/dm-*/dm/uuid"); len(uuids) > 0 {
		for _, p := range uuids {
			if raw, err := os.ReadFile(p); err == nil &&
				strings.HasPrefix(strings.TrimSpace(string(raw)), "CRYPT-LUKS") {
				out["encryption"] = "LUKS aktiv"
				break
			}
		}
	}
	return out
}

// nicSpeeds reads the negotiated link speed (Mbit/s) per interface.
func nicSpeeds() map[string]int {
	out := map[string]int{}
	paths, _ := filepath.Glob("/sys/class/net/*/speed")
	for _, p := range paths {
		raw, err := os.ReadFile(p)
		if err != nil {
			continue // down interfaces report EINVAL
		}
		v, err := strconv.Atoi(strings.TrimSpace(string(raw)))
		if err != nil || v <= 0 {
			continue
		}
		out[filepath.Base(filepath.Dir(p))] = v
	}
	return out
}
