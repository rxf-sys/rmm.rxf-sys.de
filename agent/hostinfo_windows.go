//go:build windows

package main

import (
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/sys/windows/registry"
)

// Heartbeat extras (logged-in user, battery) come from one PowerShell call,
// cached for 5 minutes — spawning PowerShell on every 60 s heartbeat would
// be needless load on older machines.
var winHB struct {
	mu    sync.Mutex
	ts    time.Time
	user  string
	bPct  float64
	bStat string
}

func refreshWinHeartbeatExtras() {
	winHB.mu.Lock()
	defer winHB.mu.Unlock()
	if time.Since(winHB.ts) < 5*time.Minute {
		return
	}
	winHB.ts = time.Now()
	lines := psLines(
		"$u = (Get-CimInstance Win32_ComputerSystem).UserName;" +
			"$b = Get-CimInstance Win32_Battery | Select-Object -First 1;" +
			"Write-Output \"USER=$u\";" +
			"if ($b) { Write-Output \"BPCT=$($b.EstimatedChargeRemaining)\";" +
			" Write-Output \"BST=$($b.BatteryStatus)\" }")
	winHB.user, winHB.bPct, winHB.bStat = "", 0, ""
	for _, line := range lines {
		if v, ok := strings.CutPrefix(line, "USER="); ok {
			// DOMAIN\name → name (die Domain ist im Heim-Setup nur Rauschen).
			if i := strings.LastIndex(v, `\`); i >= 0 {
				v = v[i+1:]
			}
			winHB.user = v
		} else if v, ok := strings.CutPrefix(line, "BPCT="); ok {
			winHB.bPct, _ = strconv.ParseFloat(v, 64)
		} else if v, ok := strings.CutPrefix(line, "BST="); ok {
			winHB.bStat = winBatteryState(v)
		}
	}
}

// winBatteryState maps Win32_Battery.BatteryStatus codes.
func winBatteryState(code string) string {
	switch code {
	case "1", "4", "5":
		return "discharging"
	case "2":
		return "ac"
	case "3":
		return "full"
	case "6", "7", "8", "9":
		return "charging"
	}
	return "ac"
}

func loggedInUser() string {
	refreshWinHeartbeatExtras()
	return winHB.user
}

func batteryStatus() (float64, string) {
	refreshWinHeartbeatExtras()
	return winHB.bPct, winHB.bStat
}

// rebootRequired checks the two registry markers Windows Update / CBS set
// when a restart is pending. Registry reads are cheap — fine per heartbeat.
func rebootRequired() bool {
	for _, path := range []string{
		`SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired`,
		`SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending`,
	} {
		k, err := registry.OpenKey(registry.LOCAL_MACHINE, path, registry.QUERY_VALUE)
		if err == nil {
			k.Close()
			return true
		}
	}
	return false
}

// systemIdentity pulls manufacturer/model/serial via WMI (inventory cadence,
// so the PowerShell spawn is fine).
func systemIdentity() (manufacturer, model, serial string) {
	lines := psLines(
		"$cs = Get-CimInstance Win32_ComputerSystem;" +
			"$bios = Get-CimInstance Win32_BIOS;" +
			"Write-Output \"$($cs.Manufacturer)|$($cs.Model)|$($bios.SerialNumber)\"")
	if len(lines) == 0 {
		return "", "", ""
	}
	parts := strings.SplitN(lines[0], "|", 3)
	for len(parts) < 3 {
		parts = append(parts, "")
	}
	return strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1]), strings.TrimSpace(parts[2])
}

// securityStatus reports firewall, antivirus and BitLocker posture from the
// Security Center / NetSecurity modules.
func securityStatus() map[string]string {
	out := map[string]string{}
	lines := psLines(
		"$fw = (Get-NetFirewallProfile -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq $true } | Measure-Object).Count;" +
			"$av = Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction SilentlyContinue | Select-Object -First 1;" +
			"$bl = (Get-BitLockerVolume -MountPoint $env:SystemDrive -ErrorAction SilentlyContinue).ProtectionStatus;" +
			"Write-Output \"FW=$fw\"; Write-Output \"AVN=$($av.displayName)\";" +
			"Write-Output \"AVS=$($av.productState)\"; Write-Output \"BL=$bl\"")
	var avName, avState string
	for _, line := range lines {
		if v, ok := strings.CutPrefix(line, "FW="); ok {
			switch v {
			case "3":
				out["firewall"] = "aktiv (alle Profile)"
			case "0":
				out["firewall"] = "inaktiv"
			case "1", "2":
				out["firewall"] = "teilweise aktiv (" + v + "/3 Profile)"
			}
		} else if v, ok := strings.CutPrefix(line, "AVN="); ok {
			avName = strings.TrimSpace(v)
		} else if v, ok := strings.CutPrefix(line, "AVS="); ok {
			avState = strings.TrimSpace(v)
		} else if v, ok := strings.CutPrefix(line, "BL="); ok {
			switch strings.TrimSpace(v) {
			case "1", "On":
				out["encryption"] = "BitLocker aktiv"
			case "0", "Off":
				out["encryption"] = "BitLocker inaktiv"
			}
		}
	}
	if avName != "" {
		info := avName
		// productState-Bits (Security-Center-Konvention): 0x1000 = aktiv,
		// 0x10 = Signaturen veraltet.
		if state, err := strconv.Atoi(avState); err == nil {
			if state&0x1000 != 0 {
				info += " · aktiv"
			} else {
				info += " · inaktiv"
			}
			if state&0x10 == 0 {
				info += " · Signaturen aktuell"
			} else {
				info += " · Signaturen veraltet"
			}
		}
		out["antivirus"] = info
	}
	return out
}

// nicSpeeds maps adapter name → link speed in Mbit/s.
func nicSpeeds() map[string]int {
	out := map[string]int{}
	lines := psLines(
		"Get-NetAdapter -Physical -ErrorAction SilentlyContinue |" +
			" ForEach-Object { \"$($_.Name)|$($_.LinkSpeed)\" }")
	for _, line := range lines {
		name, speed, ok := strings.Cut(line, "|")
		if !ok {
			continue
		}
		// "1 Gbps" / "100 Mbps" → Mbit
		fields := strings.Fields(speed)
		if len(fields) != 2 {
			continue
		}
		v, err := strconv.ParseFloat(fields[0], 64)
		if err != nil || v <= 0 {
			continue
		}
		switch strings.ToLower(fields[1]) {
		case "gbps":
			out[name] = int(v * 1000)
		case "mbps":
			out[name] = int(v)
		}
	}
	return out
}
