package main

import (
	"strings"
	"sync"
	"testing"
)

func TestRingBufferSplitsAndTrims(t *testing.T) {
	r := &ringBuffer{max: 3}
	if _, err := r.Write([]byte("eins\nzwei\ndrei\n")); err != nil {
		t.Fatal(err)
	}
	if got := r.Snapshot(); len(got) != 3 || got[0] != "eins" || got[2] != "drei" {
		t.Fatalf("unexpected snapshot: %v", got)
	}

	// Oldest lines fall off once max is exceeded.
	if _, err := r.Write([]byte("vier\n")); err != nil {
		t.Fatal(err)
	}
	got := r.Snapshot()
	if len(got) != 3 || got[0] != "zwei" || got[2] != "vier" {
		t.Fatalf("ring did not drop the oldest line: %v", got)
	}
}

func TestRingBufferCarriesPartialLines(t *testing.T) {
	r := &ringBuffer{max: 10}
	// A logger writing in fragments must not produce fragmented lines.
	_, _ = r.Write([]byte("halb"))
	if len(r.Snapshot()) != 0 {
		t.Fatal("a line without a newline should not be published yet")
	}
	_, _ = r.Write([]byte("e Zeile\n"))
	if got := r.Snapshot(); len(got) != 1 || got[0] != "halbe Zeile" {
		t.Fatalf("fragments not joined: %v", got)
	}
}

func TestRingBufferStripsCarriageReturnsAndBlankLines(t *testing.T) {
	r := &ringBuffer{max: 10}
	_, _ = r.Write([]byte("mit CR\r\n\n\nohne\n"))
	got := r.Snapshot()
	if len(got) != 2 || got[0] != "mit CR" || got[1] != "ohne" {
		t.Fatalf("blank lines or CR not handled: %q", got)
	}
}

func TestRingBufferSnapshotIsACopy(t *testing.T) {
	r := &ringBuffer{max: 5}
	_, _ = r.Write([]byte("original\n"))
	snap := r.Snapshot()
	snap[0] = "verändert"
	if r.Snapshot()[0] != "original" {
		t.Fatal("Snapshot handed out the internal slice")
	}
}

func TestRingBufferIsSafeForConcurrentWriters(t *testing.T) {
	// The stdlib logger and the job runner both write through this.
	r := &ringBuffer{max: 500}
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			for j := 0; j < 25; j++ {
				_, _ = r.Write([]byte(strings.Repeat("x", n%5+1) + "\n"))
			}
		}(i)
	}
	wg.Wait()
	if got := len(r.Snapshot()); got != 500 {
		t.Fatalf("want 500 buffered lines, got %d", got)
	}
}
