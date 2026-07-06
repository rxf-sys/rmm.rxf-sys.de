package main

import "testing"

func TestTargetKeyMapping(t *testing.T) {
	cases := map[string]string{
		"rmm-agent-linux-amd64":       "linux-amd64",
		"rmm-agent-windows-amd64.exe": "windows-amd64",
		"rmm-agent-darwin-arm64":      "darwin-arm64",
	}
	for in, want := range cases {
		if got := targetKey(in); got != want {
			t.Errorf("targetKey(%q) = %q, want %q", in, got, want)
		}
	}
}
