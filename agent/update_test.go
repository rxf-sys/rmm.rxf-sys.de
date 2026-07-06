package main

import (
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
