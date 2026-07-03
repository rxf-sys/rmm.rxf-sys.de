package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"runtime"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v4/host"
)

// enroll exchanges a one-time token for permanent device credentials.
//
// Server side lands in Phase 1: POST /api/agent/enroll consumes the token,
// creates the device row and returns {device_id, device_secret}. The agent
// side is complete so Phase 1 only has to implement the endpoint.
func enroll(serverURL, token, label string) error {
	serverURL = strings.TrimRight(serverURL, "/")
	hostname, _ := os.Hostname()
	info, _ := host.Info()

	payload := map[string]any{
		"token":         token,
		"hostname":      hostname,
		"owner_label":   label,
		"os":            runtime.GOOS,
		"arch":          runtime.GOARCH,
		"agent_version": version,
	}
	if info != nil {
		payload["os_version"] = strings.TrimSpace(info.Platform + " " + info.PlatformVersion)
	}
	body, _ := json.Marshal(payload)

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Post(serverURL+"/api/agent/enroll", "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("server answered %s: %s", resp.Status, strings.TrimSpace(string(raw)))
	}

	var out struct {
		DeviceID     int64  `json:"device_id"`
		DeviceSecret string `json:"device_secret"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return fmt.Errorf("unexpected enroll response: %w", err)
	}
	if out.DeviceSecret == "" {
		return fmt.Errorf("enroll response carried no device_secret")
	}
	return saveConfig(Config{
		ServerURL:    serverURL,
		DeviceID:     out.DeviceID,
		DeviceSecret: out.DeviceSecret,
	})
}
