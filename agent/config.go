package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

// Config is written once by `enroll` and read by the service on every start.
// The device secret is the agent's only credential — file permissions keep
// it readable by root/SYSTEM only.
type Config struct {
	ServerURL    string `json:"server_url"`
	DeviceID     int64  `json:"device_id"`
	DeviceSecret string `json:"device_secret"`
}

func configDir() string {
	if runtime.GOOS == "windows" {
		base := os.Getenv("ProgramData")
		if base == "" {
			base = `C:\ProgramData`
		}
		return filepath.Join(base, "rxf-rmm")
	}
	return "/etc/rxf-rmm"
}

func configPath() string {
	return filepath.Join(configDir(), "agent.json")
}

func loadConfig() (Config, error) {
	var cfg Config
	raw, err := os.ReadFile(configPath())
	if err != nil {
		return cfg, err
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return cfg, fmt.Errorf("parsing %s: %w", configPath(), err)
	}
	if cfg.ServerURL == "" || cfg.DeviceSecret == "" {
		return cfg, fmt.Errorf("%s is incomplete — re-run enroll", configPath())
	}
	return cfg, nil
}

func saveConfig(cfg Config) error {
	if err := os.MkdirAll(configDir(), 0o700); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(configPath(), raw, 0o600)
}
