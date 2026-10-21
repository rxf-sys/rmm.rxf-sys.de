package main

import (
	"strings"
	"testing"
)

const sampleUpdateID = "3f2c8a10-5b7e-4d21-9c3a-0e6f1b2d4a58"

func TestIsUpdateID(t *testing.T) {
	cases := []struct {
		id   string
		want bool
	}{
		{sampleUpdateID, true},
		{strings.ToUpper(sampleUpdateID), true},
		{"", false},
		{"{" + sampleUpdateID + "}", false},
		{sampleUpdateID + "\n", false},
		{" " + sampleUpdateID, false},
		{sampleUpdateID[:35], false},
		{sampleUpdateID + "0", false},
		{strings.ReplaceAll(sampleUpdateID, "-", ""), false},
		{"3f2c8a10-5b7e-4d21-9c3a-0e6f1b2d4a5g", false},
		{"KB5034441", false},
	}
	for _, c := range cases {
		if got := isUpdateID(c.id); got != c.want {
			t.Errorf("isUpdateID(%q) = %v, want %v", c.id, got, c.want)
		}
	}
}

func TestIsDebianPackage(t *testing.T) {
	cases := []struct {
		id   string
		want bool
	}{
		{"curl", true},
		{"libssl3", true},
		{"libstdc++6", true},
		{"python3.11", true},
		{"g++", true},
		{"0ad", true},
		{"linux-image-6.1.0-21-amd64", true},
		// apt names packages of a foreign architecture this way.
		{"libc6:i386", true},
		{"libc6:kfreebsd-amd64", true},
		{"", false},
		{"a", false}, // policy: at least two characters
		{"-o", false},
		{"--version", false},
		{"+curl", false},
		{".curl", false},
		{"Curl", false},
		{"curl=7.88.1-10", false}, // pins a version: not something the scan reports
		{"curl/bookworm", false},
		{"curl ", false},
		{"curl\n", false},
		{"curl;reboot", false},
		{"libc6:", false},
		{":i386", false},
		{"libc6:-i386", false},
		{"libc6:i386:amd64", false},
		{"libc6:I386", false},
	}
	for _, c := range cases {
		if got := isDebianPackage(c.id); got != c.want {
			t.Errorf("isDebianPackage(%q) = %v, want %v", c.id, got, c.want)
		}
	}
}

func TestPowerShellUpdateIDs(t *testing.T) {
	other := "00000000-0000-0000-0000-00000000000a"
	got, err := powerShellUpdateIDs([]string{sampleUpdateID, other})
	if err != nil {
		t.Fatal(err)
	}
	if want := "'" + sampleUpdateID + "','" + other + "'"; got != want {
		t.Errorf("got %s, want %s", got, want)
	}
	if got, err := powerShellUpdateIDs(nil); err != nil || got != "" {
		t.Errorf("no ids: got %q, %v; want an empty list", got, err)
	}
}

// PowerShell ends a single-quoted string at any of these five characters,
// not only at the ASCII apostrophe.
func TestPowerShellUpdateIDsRejectsEveryQuoteCharacter(t *testing.T) {
	for _, q := range []string{"'", "‘", "’", "‚", "‛"} {
		id := sampleUpdateID + q + "; Restart-Computer -Force; " + q
		list, err := powerShellUpdateIDs([]string{sampleUpdateID, id})
		if err == nil {
			t.Errorf("quote %U: id was spliced into the script as %s", []rune(q)[0], list)
			continue
		}
		if !strings.Contains(err.Error(), "rejected") {
			t.Errorf("quote %U: error %q does not say the id was rejected", []rune(q)[0], err)
		}
	}
}

// Invariants: whatever a validator accepts consists only of characters
// that can neither end a quoted string nor start an option, and an id the
// UpdateID check rejects never reaches the script.
func FuzzPatchIDValidators(f *testing.F) {
	f.Add(sampleUpdateID)
	f.Add("libc6:i386")
	f.Add("libstdc++6")
	f.Add("--version")
	f.Add(sampleUpdateID + "’; Restart-Computer; ‘")
	f.Add("curl\n")
	f.Fuzz(func(t *testing.T, id string) {
		list, err := powerShellUpdateIDs([]string{id})
		if isUpdateID(id) {
			if len(id) != 36 || strings.Trim(id, "0123456789abcdefABCDEF-") != "" {
				t.Fatalf("UpdateID %q has unexpected characters", id)
			}
			if err != nil || list != "'"+id+"'" {
				t.Fatalf("valid UpdateID %q: got %q, %v", id, list, err)
			}
		} else if err == nil {
			t.Fatalf("rejected UpdateID %q was spliced as %q", id, list)
		}
		if isDebianPackage(id) {
			if len(id) < 2 || id[0] == '-' || strings.Count(id, ":") > 1 ||
				strings.Trim(id, "abcdefghijklmnopqrstuvwxyz0123456789+.-:") != "" {
				t.Fatalf("package name %q has unexpected characters", id)
			}
		}
	})
}
