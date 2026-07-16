package main

import (
	"os"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/mem"
	gnet "github.com/shirou/gopsutil/v4/net"
)

type diskMetric struct {
	Mount   string  `json:"mount"`
	UsedPct float64 `json:"used_pct"`
	TotalB  uint64  `json:"total_b"`
}

type heartbeatPayload struct {
	Ts           int64        `json:"ts"`
	AgentVersion string       `json:"agent_version"`
	Hostname     string       `json:"hostname,omitempty"`
	CPUPct       float64      `json:"cpu_pct"`
	MemPct       float64      `json:"mem_pct"`
	Disks        []diskMetric `json:"disks"`
	// Network throughput since the previous heartbeat, bytes per second,
	// summed over all non-loopback interfaces.
	NetRxBps   float64 `json:"net_rx_bps"`
	NetTxBps   float64 `json:"net_tx_bps"`
	RustDeskID string  `json:"rustdesk_id,omitempty"`
}

// Previous cumulative NIC counters; collectHeartbeat runs from a single
// goroutine (the connection's select loop), so plain vars suffice.
var (
	prevNetTs time.Time
	prevNetRx uint64
	prevNetTx uint64
)

// netThroughput derives rx/tx bytes-per-second from the delta of the OS's
// cumulative interface counters. The first call (and counter resets, e.g.
// after suspend) report 0 — a missing sample beats a bogus spike.
func netThroughput() (rxBps, txBps float64) {
	counters, err := gnet.IOCounters(true)
	if err != nil {
		return 0, 0
	}
	var rx, tx uint64
	for _, c := range counters {
		name := strings.ToLower(c.Name)
		if name == "lo" || strings.Contains(name, "loopback") {
			continue
		}
		rx += c.BytesRecv
		tx += c.BytesSent
	}
	now := time.Now()
	lastTs, lastRx, lastTx := prevNetTs, prevNetRx, prevNetTx
	prevNetTs, prevNetRx, prevNetTx = now, rx, tx
	if lastTs.IsZero() || rx < lastRx || tx < lastTx {
		return 0, 0
	}
	dt := now.Sub(lastTs).Seconds()
	if dt <= 0 {
		return 0, 0
	}
	return float64(rx-lastRx) / dt, float64(tx-lastTx) / dt
}

// collectHeartbeat gathers the lightweight metric set sent with every
// heartbeat. Best-effort: a failing probe reports zero values rather than
// blocking the heartbeat — an online signal with partial data beats none.
func collectHeartbeat() heartbeatPayload {
	hb := heartbeatPayload{
		Ts:           time.Now().Unix(),
		AgentVersion: version,
	}
	// Report the live OS hostname so the dashboard tracks renames instead of
	// keeping the value captured at enrollment.
	hb.Hostname, _ = os.Hostname()

	// Interval 0 = delta since the previous call; the first call after
	// process start reports 0, every later heartbeat gets a real value
	// without blocking for a sampling window.
	if pct, err := cpu.Percent(0, false); err == nil && len(pct) > 0 {
		hb.CPUPct = pct[0]
	}
	if vm, err := mem.VirtualMemory(); err == nil {
		hb.MemPct = vm.UsedPercent
	}
	hb.NetRxBps, hb.NetTxBps = netThroughput()
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
