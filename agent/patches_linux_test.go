//go:build linux

package main

import "testing"

func TestParseAptSimulate(t *testing.T) {
	// Verbatim shape of `apt-get -s dist-upgrade`: a preamble, Inst/Conf
	// pairs, and origin annotations in brackets.
	out := []byte(`Reading package lists...
Building dependency tree...
Calculating upgrade...
Inst libssl3 [3.0.11-1~deb12u2] (3.0.13-1~deb12u1 Debian-Security:12/stable [amd64])
Conf libssl3 (3.0.13-1~deb12u1 Debian-Security:12/stable [amd64])
Inst curl [7.88.1-10+deb12u5] (7.88.1-10+deb12u7 Debian:12.6/stable [amd64])
Conf curl (7.88.1-10+deb12u7 Debian:12.6/stable [amd64])
Remove obsolete-pkg [1.0]
`)

	items := parseAptSimulate(out)
	if len(items) != 2 {
		t.Fatalf("want 2 items, got %d: %+v", len(items), items)
	}
	if items[0].PatchID != "libssl3" || items[0].Severity != "important" {
		t.Errorf("security upgrade misparsed: %+v", items[0])
	}
	if items[1].PatchID != "curl" || items[1].Severity != "other" {
		t.Errorf("regular upgrade misparsed: %+v", items[1])
	}
	// Title mirrors the package name — the dashboard has nothing better to show.
	if items[0].Title != items[0].PatchID {
		t.Errorf("title should mirror the package name, got %q", items[0].Title)
	}
}

func TestParseAptSimulateEdgeCases(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want int
	}{
		{"empty output", "", 0},
		{"nothing to upgrade", "Reading package lists...\nCalculating upgrade...\n0 upgraded.\n", 0},
		{"Inst without a package name", "Inst\n", 0},
		{"lowercase inst is not a marker", "inst libfoo [1.0]\n", 0},
		{"no trailing newline", "Inst libfoo [1.0] (1.1 Debian:12/stable [amd64])", 1},
		{"CRLF line endings", "Inst libfoo [1.0] (1.1 Debian:12/stable [amd64])\r\n", 1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := len(parseAptSimulate([]byte(c.in))); got != c.want {
				t.Errorf("got %d items, want %d", got, c.want)
			}
		})
	}
}

func TestParseAptSimulateSecurityDetectionIsCaseInsensitive(t *testing.T) {
	in := []byte("Inst libfoo [1.0] (1.1 Debian-SECURITY:12/stable [amd64])\n")
	items := parseAptSimulate(in)
	if len(items) != 1 || items[0].Severity != "important" {
		t.Fatalf("uppercase security pocket not detected: %+v", items)
	}
}
