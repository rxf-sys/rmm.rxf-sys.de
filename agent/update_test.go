package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestVerifyPayload(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	pubB64 := base64.StdEncoding.EncodeToString(pub)
	data := []byte("pretend this is a signed agent binary")
	sum := sha256.Sum256(data)
	sha := hex.EncodeToString(sum[:])
	sig := base64.StdEncoding.EncodeToString(ed25519.Sign(priv, data))

	// Happy path.
	if err := verifyPayload(data, sha, sig, pubB64); err != nil {
		t.Fatalf("valid payload rejected: %v", err)
	}

	// Tampered binary — sha256 no longer matches.
	if err := verifyPayload([]byte("tampered"), sha, sig, pubB64); err == nil {
		t.Error("tampered binary accepted")
	}

	// Correct hash but signature from a different key must fail.
	otherPub, otherPriv, _ := ed25519.GenerateKey(rand.Reader)
	_ = otherPub
	badSig := base64.StdEncoding.EncodeToString(ed25519.Sign(otherPriv, data))
	if err := verifyPayload(data, sha, badSig, pubB64); err == nil {
		t.Error("payload signed by wrong key accepted")
	}

	// Malformed inputs.
	if err := verifyPayload(data, sha, sig, "not-base64!!"); err == nil {
		t.Error("invalid public key accepted")
	}
	if err := verifyPayload(data, "deadbeef", sig, pubB64); err == nil {
		t.Error("wrong sha256 accepted")
	}
}

// fuzzSigner is a fixed key so fuzz failures reproduce from the corpus.
var fuzzSigner = ed25519.NewKeyFromSeed(bytes.Repeat([]byte{7}, ed25519.SeedSize))

// Invariants: no panic for any input; a payload signed by the pinned key is
// accepted; any other bytes under that hash or signature are rejected; with
// the pinned key only the genuine signature passes (however it is spelled in
// base64); and only a well-formed key can ever lead to acceptance.
func FuzzVerifyPayload(f *testing.F) {
	pinned := base64.StdEncoding.EncodeToString(fuzzSigner.Public().(ed25519.PublicKey))
	f.Add([]byte("agent binary"), []byte("agent binary"), "", pinned)
	f.Add([]byte("agent binary"), []byte("agent binarY"), "c2ln", "not-base64!!")
	f.Add([]byte{}, []byte{0}, base64.StdEncoding.EncodeToString(make([]byte, ed25519.SignatureSize)), "")
	f.Add([]byte("\x7fELF"), []byte("MZ"), "====", base64.StdEncoding.EncodeToString(make([]byte, ed25519.PublicKeySize)))
	f.Fuzz(func(t *testing.T, data, other []byte, sigB64, pubB64 string) {
		sum := sha256.Sum256(data)
		sha := hex.EncodeToString(sum[:])
		sig := ed25519.Sign(fuzzSigner, data)
		genuine := base64.StdEncoding.EncodeToString(sig)

		if err := verifyPayload(data, sha, genuine, pinned); err != nil {
			t.Fatalf("genuine payload rejected: %v", err)
		}
		if !bytes.Equal(other, data) {
			if verifyPayload(other, sha, genuine, pinned) == nil {
				t.Fatal("different bytes accepted under the original hash")
			}
			otherSum := sha256.Sum256(other)
			if verifyPayload(other, hex.EncodeToString(otherSum[:]), genuine, pinned) == nil {
				t.Fatal("different bytes accepted with a matching hash but the original signature")
			}
		}
		if verifyPayload(data, sha, sigB64, pinned) == nil {
			if dec, err := base64.StdEncoding.DecodeString(sigB64); err != nil || !bytes.Equal(dec, sig) {
				t.Fatalf("signature %q accepted but is not the genuine one", sigB64)
			}
		}
		if verifyPayload(data, sha, genuine, pubB64) == nil {
			if dec, err := base64.StdEncoding.DecodeString(pubB64); err != nil || len(dec) != ed25519.PublicKeySize {
				t.Fatalf("malformed public key %q accepted", pubB64)
			}
		}
	})
}

func TestDownloadUpdateAuthenticatesAndChecksTheStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer 3:s3cret" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte("binary"))
	}))
	defer srv.Close()
	ctx := context.Background()

	got, err := downloadUpdate(ctx, Config{ServerURL: srv.URL, DeviceID: 3, DeviceSecret: "s3cret"}, "/dl")
	if err != nil || string(got) != "binary" {
		t.Fatalf("got %q, %v", got, err)
	}
	if _, err := downloadUpdate(ctx, Config{ServerURL: srv.URL, DeviceID: 3, DeviceSecret: "wrong"}, "/dl"); err == nil ||
		!strings.Contains(err.Error(), "401") {
		t.Fatalf("want the server's 401 as an error, got %v", err)
	}
}

// A download that fails verification must never reach the disk.
func TestApplyUpdateRejectsATamperedDownload(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("tampered"))
	}))
	defer srv.Close()
	sum := sha256.Sum256([]byte("genuine"))
	spec := updateSpec{Version: version + "-next", URL: "/dl", SHA256: hex.EncodeToString(sum[:])}

	err := applyUpdate(context.Background(), Config{ServerURL: srv.URL}, spec)
	if err == nil || !strings.HasPrefix(err.Error(), "verify:") {
		t.Fatalf("want a verify error, got %v", err)
	}
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(exe + ".new"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("rejected update was written to disk: %v", err)
	}
}

func TestApplyUpdateSkipsTheRunningVersion(t *testing.T) {
	// No server at all: an update to the version already running must not
	// even try to download.
	if err := applyUpdate(context.Background(), Config{ServerURL: "http://127.0.0.1:1"}, updateSpec{Version: version}); err != nil {
		t.Fatalf("got %v", err)
	}
}
