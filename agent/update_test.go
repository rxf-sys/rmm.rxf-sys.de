package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
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
