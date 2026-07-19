package main

import (
	"testing"
	"time"
)

func TestJobTimeout(t *testing.T) {
	if got := jobTimeout(jobSpec{}); got != perJobTimeout {
		t.Fatalf("default: got %v, want %v", got, perJobTimeout)
	}
	if got := jobTimeout(jobSpec{TimeoutS: 60}); got != time.Minute {
		t.Fatalf("server value: got %v, want 1m", got)
	}
	if got := jobTimeout(jobSpec{TimeoutS: 999_999}); got != maxJobTimeout {
		t.Fatalf("cap: got %v, want %v", got, maxJobTimeout)
	}
	if got := jobTimeout(jobSpec{TimeoutS: -5}); got != perJobTimeout {
		t.Fatalf("negative: got %v, want default", got)
	}
}
