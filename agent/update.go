package main

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// updatePublicKey is the ed25519 public key (base64) the agent trusts for
// self-update payloads. Replace this with your own key from `make keygen`
// before building release binaries — an attacker who controls the update
// channel but not this key cannot ship a malicious agent. It is a var (not a
// const) purely so tests can inject a throwaway key; production builds pin it.
var updatePublicKey = "REPLACE_WITH_YOUR_ED25519_PUBLIC_KEY_BASE64"

// updateSpec is the payload the server sends when a newer agent is available.
type updateSpec struct {
	Version string `json:"version"`
	URL     string `json:"url"`     // relative to the server base, device-authenticated
	SHA256  string `json:"sha256"`  // hex, integrity check before signature
	Sig     string `json:"sig"`     // base64 ed25519 signature over the raw binary
}

// verifyPayload checks a downloaded binary against its expected sha256 and
// ed25519 signature. Pure and side-effect-free so it is unit-tested in
// isolation — this is the security boundary of the whole update mechanism.
func verifyPayload(data []byte, sha256Hex, sigB64, pubKeyB64 string) error {
	sum := sha256.Sum256(data)
	if hex.EncodeToString(sum[:]) != sha256Hex {
		return errors.New("sha256 mismatch")
	}
	pub, err := base64.StdEncoding.DecodeString(pubKeyB64)
	if err != nil || len(pub) != ed25519.PublicKeySize {
		return errors.New("invalid public key")
	}
	sig, err := base64.StdEncoding.DecodeString(sigB64)
	if err != nil || len(sig) != ed25519.SignatureSize {
		return errors.New("invalid signature encoding")
	}
	if !ed25519.Verify(ed25519.PublicKey(pub), data, sig) {
		return errors.New("signature verification failed")
	}
	return nil
}

// applyUpdate downloads, verifies and installs a new agent binary, then exits
// so the service manager restarts it. The running binary is renamed to
// <path>.bak first, giving a one-step manual rollback if the new version
// misbehaves. Any failure before the swap leaves the current binary intact.
func applyUpdate(ctx context.Context, cfg Config, spec updateSpec) error {
	if spec.Version == version {
		return nil // already current
	}
	log.Printf("update: fetching %s", spec.Version)

	data, err := downloadUpdate(ctx, cfg, spec.URL)
	if err != nil {
		return fmt.Errorf("download: %w", err)
	}
	if err := verifyPayload(data, spec.SHA256, spec.Sig, updatePublicKey); err != nil {
		return fmt.Errorf("verify: %w", err)
	}

	exe, err := os.Executable()
	if err != nil {
		return err
	}
	exe, _ = filepath.EvalSymlinks(exe)

	// Write next to the target so the final rename is atomic (same filesystem).
	tmp := exe + ".new"
	if err := os.WriteFile(tmp, data, 0o755); err != nil {
		return fmt.Errorf("write new binary: %w", err)
	}
	if err := swapBinary(exe, tmp); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("swap: %w", err)
	}

	log.Printf("update: installed %s — restarting", spec.Version)
	// Exit cleanly; the service manager (systemd/launchd/SCM), configured with
	// restart-on-exit, brings the new binary back up.
	go func() {
		time.Sleep(500 * time.Millisecond)
		os.Exit(0)
	}()
	return nil
}

func downloadUpdate(ctx context.Context, cfg Config, url string) ([]byte, error) {
	full := cfg.ServerURL + url
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, full, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %d:%s", cfg.DeviceID, cfg.DeviceSecret))
	client := &http.Client{Timeout: 2 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("server answered %s", resp.Status)
	}
	// 64 MiB ceiling — an agent binary is ~10-20 MiB; refuse anything absurd.
	return io.ReadAll(io.LimitReader(resp.Body, 64<<20))
}
