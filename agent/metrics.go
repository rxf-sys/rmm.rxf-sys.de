package main

import (
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/mem"
)

type diskMetric struct {
	Mount   string  `json:"mount"`
	UsedPct float64 `json:"used_pct"`
	TotalB  uint64  `json:"total_b"`
}

type heartbeatPayload struct {
	Ts           int64        `json:"ts"`
	AgentVersion string       `json:"agent_version"`
	CPUPct       float64      `json:"cpu_pct"`
	MemPct       float64      `json:"mem_pct"`
	Disks        []diskMetric `json:"disks"`
	RustDeskID   string       `json:"rustdesk_id,omitempty"`
}

// collectHeartbeat gathers the lightweight metric set sent with every
// heartbeat. Best-effort: a failing probe reports zero values rather than
// blocking the heartbeat — an online signal with partial data beats none.
func collectHeartbeat() heartbeatPayload {
	hb := heartbeatPayload{
		Ts:           time.Now().Unix(),
		AgentVersion: version,
	}

	// Interval 0 = delta since the previous call; the first call after
	// process start reports 0, every later heartbeat gets a real value
	// without blocking for a sampling window.
	if pct, err := cpu.Percent(0, false); err == nil && len(pct) > 0 {
		hb.CPUPct = pct[0]
	}
	if vm, err := mem.VirtualMemory(); err == nil {
		hb.MemPct = vm.UsedPercent
	}
	if parts, err := disk.Partitions(false); err == nil {
		for _, p := range parts {
			u, err := disk.Usage(p.Mountpoint)
			if err != nil || u.Total == 0 {
				continue
			}
			hb.Disks = append(hb.Disks, diskMetric{
				Mount:   p.Mountpoint,
				UsedPct: u.UsedPercent,
				TotalB:  u.Total,
			})
		}
	}
	hb.RustDeskID = rustDeskID()
	return hb
}
