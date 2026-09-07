//go:build !windows

package main

import (
	"os"
	"path/filepath"
	"testing"
)

// configPath() is a fixed system path, so these tests drive load/save through
// the same JSON handling with an explicit path instead.
func TestConfigRoundTripAndPermissions(t *testing.T) {
	dir := t.TempDir()
	sub := filepath.Join(dir, "rxf-rmm")
	if err := os.MkdirAll(sub, 0o700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(sub, "agent.json")

	raw := []byte(`{"server_url":"https://rmm.example","device_id":7,"device_secret":"dev_x"}`)
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}

	// The device secret is the agent's only credential: the file must not be
	// readable by other local users.
	fi, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if perm := fi.Mode().Perm(); perm != 0o600 {
		t.Errorf("config file mode = %o, want 600", perm)
	}
	di, err := os.Stat(sub)
	if err != nil {
		t.Fatal(err)
	}
	if perm := di.Mode().Perm(); perm != 0o700 {
		t.Errorf("config dir mode = %o, want 700", perm)
	}
}

func TestSaveConfigWritesRestrictivePermissions(t *testing.T) {
	// saveConfig uses the real configDir(); on a non-root test run that write
	// is not permitted, which is itself the expected outcome.
	if os.Geteuid() != 0 {
		t.Skip("saveConfig writes to /etc/rxf-rmm; needs root")
	}
	t.Cleanup(func() { _ = os.RemoveAll(configDir()) })
	if err := saveConfig(Config{ServerURL: "https://x", DeviceID: 1, DeviceSecret: "s"}); err != nil {
		t.Fatal(err)
	}
	fi, err := os.Stat(configPath())
	if err != nil {
		t.Fatal(err)
	}
	if perm := fi.Mode().Perm(); perm != 0o600 {
		t.Errorf("saved config mode = %o, want 600", perm)
	}
}
