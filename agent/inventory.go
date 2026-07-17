package main

import (
	"net"
	"os"
	"runtime"
	"sort"
	"strings"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/mem"
)

// softwareItem is one installed application/package.
type softwareItem struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

type inventoryPayload struct {
	Hardware map[string]any `json:"hardware"`
	Software []softwareItem `json:"software"`
}

// Cap the software list so a package-happy Linux box can't blow past the
// server's inventory size ceiling.
const maxSoftwareItems = 4000

// collectInventory gathers the full hardware + software picture. Sent on
// connect and every 12 h; everything is best-effort — missing probes leave
// their fields empty rather than failing the whole report.
func collectInventory() inventoryPayload {
	hw := map[string]any{
		"go_os":   runtime.GOOS,
		"go_arch": runtime.GOARCH,
	}
	if hostname, err := os.Hostname(); err == nil {
		hw["hostname"] = hostname
	}
	if info, err := host.Info(); err == nil && info != nil {
		hw["platform"] = info.Platform
		hw["platform_version"] = info.PlatformVersion
		hw["kernel_version"] = info.KernelVersion
		hw["kernel_arch"] = info.KernelArch
		hw["uptime_s"] = info.Uptime
		hw["boot_time"] = info.BootTime
	}
	if infos, err := cpu.Info(); err == nil && len(infos) > 0 {
		hw["cpu_model"] = infos[0].ModelName
	}
	if cores, err := cpu.Counts(true); err == nil {
		hw["cpu_threads"] = cores
	}
	if vm, err := mem.VirtualMemory(); err == nil {
		hw["mem_total_b"] = vm.Total
	}
	if macs := collectMACs(); len(macs) > 0 {
		// The server uses these for Wake-on-LAN (magic packets into the LAN).
		hw["macs"] = macs
	}
	if nics := collectNICs(); len(nics) > 0 {
		// Per-interface detail (IPs + MAC) for the dashboard's network card.
		hw["nics"] = nics
	}

	return finishInventory(hw, collectSoftware())
}

// nicInfo is one network interface as shown in the device's network card.
type nicInfo struct {
	Name string   `json:"name"`
	MAC  string   `json:"mac,omitempty"`
	IPs  []string `json:"ips"`
	MTU  int      `json:"mtu,omitempty"`
}

// collectNICs lists up, non-loopback interfaces with their MAC and non-link-
// local IPs. Per-container veth/tap noise is skipped; bridges stay (on a
// Proxmox host vmbr0 carries the primary address).
func collectNICs() []nicInfo {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	var out []nicInfo
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagLoopback != 0 || ifc.Flags&net.FlagUp == 0 {
			continue
		}
		name := strings.ToLower(ifc.Name)
		if strings.HasPrefix(name, "veth") || strings.HasPrefix(name, "tap") ||
			strings.HasPrefix(name, "tun") || strings.HasPrefix(name, "fwbr") ||
			strings.HasPrefix(name, "fwln") || strings.HasPrefix(name, "fwpr") {
			continue
		}
		var ips []string
		addrs, _ := ifc.Addrs()
		for _, a := range addrs {
			ipnet, ok := a.(*net.IPNet)
			if !ok || ipnet.IP == nil {
				continue
			}
			if ipnet.IP.IsLoopback() || ipnet.IP.IsLinkLocalUnicast() {
				continue
			}
			ips = append(ips, ipnet.IP.String())
		}
		// Interfaces without any routable address (down bridges, bare
		// enslaved ports) would only clutter the card.
		if len(ips) == 0 {
			continue
		}
		mac := ifc.HardwareAddr.String()
		if mac == "00:00:00:00:00:00" {
			mac = ""
		}
		out = append(out, nicInfo{Name: ifc.Name, MAC: mac, IPs: ips, MTU: ifc.MTU})
		if len(out) >= 12 {
			break
		}
	}
	return out
}

// collectMACs returns the MAC addresses of physical-looking, non-loopback
// interfaces. Virtual adapters (docker, veth, bridges, TAP) are skipped by
// name — best-effort, the server just tries every reported MAC for WoL.
func collectMACs() []string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	var out []string
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagLoopback != 0 || len(ifc.HardwareAddr) != 6 {
			continue
		}
		name := strings.ToLower(ifc.Name)
		if strings.HasPrefix(name, "docker") || strings.HasPrefix(name, "veth") ||
			strings.HasPrefix(name, "br-") || strings.HasPrefix(name, "virbr") ||
			strings.HasPrefix(name, "tap") || strings.HasPrefix(name, "tun") ||
			strings.HasPrefix(name, "vmnet") || strings.HasPrefix(name, "zt") {
			continue
		}
		mac := ifc.HardwareAddr.String()
		if mac == "" || mac == "00:00:00:00:00:00" {
			continue
		}
		out = append(out, mac)
	}
	return out
}

func finishInventory(hw map[string]any, software []softwareItem) inventoryPayload {
	sort.Slice(software, func(i, j int) bool { return software[i].Name < software[j].Name })
	if len(software) > maxSoftwareItems {
		software = software[:maxSoftwareItems]
	}
	return inventoryPayload{Hardware: hw, Software: software}
}
