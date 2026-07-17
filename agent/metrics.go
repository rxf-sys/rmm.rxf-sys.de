package main

import (
	"os"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/mem"
	gnet "github.com/shirou/gopsutil/v4/net"
	"github.com/shirou/gopsutil/v4/sensors"
)

type diskMetric struct {
	Mount   string  `json:"mount"`
	UsedPct float64 `json:"used_pct"`
	UsedB   uint64  `json:"used_b"`
	TotalB  uint64  `json:"total_b"`
}

type heartbeatPayload struct {
	Ts           int64        `json:"ts"`
	AgentVersion string       `json:"agent_version"`
	Hostname     string       `json:"hostname,omitempty"`
	CPUPct       float64      `json:"cpu_pct"`
	MemPct       float64      `json:"mem_pct"`
	MemUsedB     uint64       `json:"mem_used_b,omitempty"`
	MemTotalB    uint64       `json:"mem_total_b,omitempty"`
	Disks        []diskMetric `json:"disks"`
	// Network throughput since the previous heartbeat, bytes per second,
	// summed over all non-loopback interfaces — plus the cumulative
	// counters since boot for the "Traffic seit Boot" line.
	NetRxBps    float64 `json:"net_rx_bps"`
	NetTxBps    float64 `json:"net_tx_bps"`
	NetRxTotalB uint64  `json:"net_rx_total_b,omitempty"`
	NetTxTotalB uint64  `json:"net_tx_total_b,omitempty"`
	// Best-effort extras: 0/"" means "not available" and is omitted.
	CPUTempC       float64 `json:"cpu_temp_c,omitempty"`
	BatteryPct     float64 `json:"battery_pct,omitempty"`
	BatteryState   string  `json:"battery_state,omitempty"` // charging|discharging|full|ac
	LoggedInUser   string  `json:"logged_in_user,omitempty"`
	RebootRequired bool    `json:"reboot_required,omitempty"`
	RustDeskID     string  `json:"rustdesk_id,omitempty"`
}

// Previous cumulative NIC counters; collectHeartbeat runs from a single
// goroutine (the connection's select loop), so plain vars suffice.
var (
	prevNetTs time.Time
	prevNetRx uint64
	prevNetTx uint64
)

// netThroughput derives rx/tx bytes-per-second from the delta of the OS's
// cumulative interface counters (also returned as-is for the traffic-since-
// boot display). The first call (and counter resets, e.g. after suspend)
// report a 0 rate — a missing sample beats a bogus spike.
func netThroughput() (rxBps, txBps float64, rxTotal, txTotal uint64) {
	counters, err := gnet.IOCounters(true)
	if err != nil {
		return 0, 0, 0, 0
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
		return 0, 0, rx, tx
	}
	dt := now.Sub(lastTs).Seconds()
	if dt <= 0 {
		return 0, 0, rx, tx
	}
	return float64(rx-lastRx) / dt, float64(tx-lastTx) / dt, rx, tx
}

// cpuTemperature picks the hottest CPU-ish sensor. 0 = unknown (no sensors,
// e.g. most Windows machines and VMs) and is omitted from the heartbeat.
func cpuTemperature() float64 {
	stats, err := sensors.SensorsTemperatures()
	if err != nil {
		return 0
	}
	best := 0.0
	for _, s := range stats {
		key := strings.ToLower(s.SensorKey)
		if !strings.Contains(key, "coretemp") && !strings.Contains(key, "k10temp") &&
			!strings.Contains(key, "cpu") && !strings.Contains(key, "package") &&
			!strings.Contains(key, "tctl") {
			continue
		}
		if s.Temperature > best && s.Temperature < 130 {
			best = s.Temperature
		}
	}
	return best
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
		hb.MemUsedB = vm.Used
		hb.MemTotalB = vm.Total
	}
	hb.NetRxBps, hb.NetTxBps, hb.NetRxTotalB, hb.NetTxTotalB = netThroughput()
	hb.CPUTempC = cpuTemperature()
	hb.BatteryPct, hb.BatteryState = batteryStatus()
	hb.LoggedInUser = loggedInUser()
	hb.RebootRequired = rebootRequired()
	if parts, err := disk.Partitions(false); err == nil {
		for _, p := range parts {
			u, err := disk.Usage(p.Mountpoint)
			if err != nil || u.Total == 0 {
				continue
			}
			hb.Disks = append(hb.Disks, diskMetric{
				Mount:   p.Mountpoint,
				UsedPct: u.UsedPercent,
				UsedB:   u.Used,
				TotalB:  u.Total,
			})
		}
	}
	hb.RustDeskID = rustDeskID()
	return hb
}
