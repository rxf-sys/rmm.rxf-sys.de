//go:build linux

package main

import (
	"bytes"
	"reflect"
	"strings"
	"testing"
)

func TestParseTabSeparated(t *testing.T) {
	in := []byte("bash\t5.2.15-2+b7\n" +
		"no-tab-here\n" +
		"\tversion-without-name\n" +
		"libc6\t2.36-9+deb12u7\r\n" +
		"\n" +
		"tzdata\t\n" +
		"kernel\t6.1.0\tsecond-tab-stays")
	want := []softwareItem{
		{Name: "bash", Version: "5.2.15-2+b7"},
		{Name: "libc6", Version: "2.36-9+deb12u7"},
		{Name: "tzdata", Version: ""},
		{Name: "kernel", Version: "6.1.0\tsecond-tab-stays"},
	}
	if got := parseTabSeparated(in); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

// Invariants: no panic; every item comes from one input line (a non-empty
// name without tab or newline, a version without newline); and printing the
// items the way dpkg-query does parses to the same list (round trip).
func FuzzParseTabSeparated(f *testing.F) {
	f.Add([]byte("bash\t5.2.15-2+b7\nlibc6\t2.36-9+deb12u7\n"))
	f.Add([]byte("openssl\t3.0.15-1~deb12u1\r\nno-tab\n\tno-name\n"))
	f.Add([]byte("kernel\t6.1.0\textra\ntzdata\t\n"))
	f.Add([]byte("name\tversion\r\r\n\xff\t\xfe"))
	f.Add([]byte(""))
	f.Fuzz(func(t *testing.T, in []byte) {
		got := parseTabSeparated(in)
		if len(got) > bytes.Count(in, []byte("\n"))+1 {
			t.Fatalf("%d items from %d lines", len(got), bytes.Count(in, []byte("\n"))+1)
		}
		var canon strings.Builder
		for _, it := range got {
			if it.Name == "" || strings.ContainsAny(it.Name, "\t\n") || strings.Contains(it.Version, "\n") {
				t.Fatalf("malformed item %+v", it)
			}
			line := it.Name + "\t" + it.Version
			if !bytes.Contains(in, []byte(line)) {
				t.Fatalf("item %+v does not come from an input line", it)
			}
			// The scanner strips one trailing \r per line, so a value that
			// itself ends in \r needs one more to survive the trip.
			if strings.HasSuffix(line, "\r") {
				line += "\r"
			}
			canon.WriteString(line + "\n")
		}
		if again := parseTabSeparated([]byte(canon.String())); !reflect.DeepEqual(again, got) {
			t.Fatalf("round trip: %+v became %+v", got, again)
		}
	})
}
