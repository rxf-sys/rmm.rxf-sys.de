package main

import (
	"os"
	"runtime"
	"sort"

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

	software := collectSoftware()
	sort.Slice(software, func(i, j int) bool { return software[i].Name < software[j].Name })
	if len(software) > maxSoftwareItems {
		software = software[:maxSoftwareItems]
	}
	return inventoryPayload{Hardware: hw, Software: software}
}
