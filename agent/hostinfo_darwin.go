//go:build darwin

package main

import (
	"regexp"
	"strconv"
	"strings"

	"github.com/shirou/gopsutil/v4/host"
)

func loggedInUser() string {
	users, err := host.Users()
	if err != nil || len(users) == 0 {
		return ""
	}
	return users[0].User
}

// macOS has no reliable pending-reboot marker — report false.
func rebootRequired() bool { return false }

var pmsetRe = regexp.MustCompile(`(\d+)%; (\w[\w ]*?);`)

// batteryStatus parses `pmset -g batt` ("… 87%; discharging; …").
func batteryStatus() (float64, string) {
	out, err := execOut("pmset", "-g", "batt")
	if err != nil {
		return 0, ""
	}
	m := pmsetRe.FindStringSubmatch(out)
	if m == nil {
		return 0, ""
	}
	pct, _ := strconv.ParseFloat(m[1], 64)
	switch m[2] {
	case "charging":
		return pct, "charging"
	case "discharging":
		return pct, "discharging"
	case "charged":
		return pct, "full"
	default: // "AC attached", "finishing charge", …
		return pct, "ac"
	}
}

func systemIdentity() (manufacturer, model, serial string) {
	model, _ = execOut("sysctl", "-n", "hw.model")
	if out, err := execOut("ioreg", "-c", "IOPlatformExpertDevice", "-d", "2"); err == nil {
		for _, line := range strings.Split(out, "\n") {
			if strings.Contains(line, "IOPlatformSerialNumber") {
				if i := strings.LastIndex(line, "= \""); i >= 0 {
					serial = strings.Trim(line[i+2:], `" `)
				}
			}
		}
	}
	return "Apple", model, serial
}

func securityStatus() map[string]string {
	out := map[string]string{}
	if o, err := execOut("fdesetup", "status"); err == nil {
		if strings.Contains(o, "FileVault is On") {
			out["encryption"] = "FileVault aktiv"
		} else if strings.Contains(o, "FileVault is Off") {
			out["encryption"] = "FileVault inaktiv"
		}
	}
	if o, err := execOut("defaults", "read", "/Library/Preferences/com.apple.alf", "globalstate"); err == nil {
		if o == "0" {
			out["firewall"] = "inaktiv"
		} else {
			out["firewall"] = "aktiv"
		}
	}
	return out
}

// Link speed is not trivially readable on macOS — omit.
func nicSpeeds() map[string]int { return nil }
