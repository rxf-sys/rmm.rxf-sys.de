// sign — ed25519 keygen and detached signing for agent release binaries.
//
//	go run ./tools/sign keygen                 # prints priv+pub (base64)
//	go run ./tools/sign sign <privkey_b64> <file>...  # writes <file>.sig + manifest
//
// The private key never leaves your build machine; the public key is pinned
// in the agent (update.go: updatePublicKey). The server serves the signed
// binaries + the generated manifest.json, and each agent verifies the
// signature against the pinned key before installing.
package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type target struct {
	File   string `json:"file"`
	SHA256 string `json:"sha256"`
	Sig    string `json:"sig"`
}

type manifest struct {
	Version string            `json:"version"`
	Targets map[string]target `json:"targets"`
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: sign keygen | sign <privkey_b64> <version> <file>...")
		os.Exit(2)
	}
	switch os.Args[1] {
	case "keygen":
		pub, priv, err := ed25519.GenerateKey(rand.Reader)
		must(err)
		fmt.Println("private (keep secret, e.g. AGENT_SIGN_KEY):")
		fmt.Println("  " + base64.StdEncoding.EncodeToString(priv))
		fmt.Println("public (pin in agent/update.go updatePublicKey):")
		fmt.Println("  " + base64.StdEncoding.EncodeToString(pub))

	case "sign":
		if len(os.Args) < 5 {
			fmt.Fprintln(os.Stderr, "usage: sign <privkey_b64> <version> <file>...")
			os.Exit(2)
		}
		privRaw, err := base64.StdEncoding.DecodeString(os.Args[2])
		must(err)
		if len(privRaw) != ed25519.PrivateKeySize {
			fmt.Fprintln(os.Stderr, "invalid private key size")
			os.Exit(1)
		}
		priv := ed25519.PrivateKey(privRaw)
		version := os.Args[3]

		m := manifest{Version: version, Targets: map[string]target{}}
		for _, path := range os.Args[4:] {
			data, err := os.ReadFile(path)
			must(err)
			sum := sha256.Sum256(data)
			sig := ed25519.Sign(priv, data)
			name := filepath.Base(path)
			// Derive the OS-arch key from the filename convention
			// rmm-agent-<os>-<arch>[.exe].
			m.Targets[targetKey(name)] = target{
				File:   name,
				SHA256: hex.EncodeToString(sum[:]),
				Sig:    base64.StdEncoding.EncodeToString(sig),
			}
			fmt.Printf("signed %s\n", name)
		}
		out, _ := json.MarshalIndent(m, "", "  ")
		must(os.WriteFile("manifest.json", out, 0o644))
		fmt.Println("wrote manifest.json")

	default:
		fmt.Fprintln(os.Stderr, "unknown command:", os.Args[1])
		os.Exit(2)
	}
}

// targetKey turns "rmm-agent-linux-amd64" / "...-windows-amd64.exe" into
// "linux-amd64" / "windows-amd64".
func targetKey(name string) string {
	n := name
	n = trimSuffix(n, ".exe")
	n = trimPrefix(n, "rmm-agent-")
	return n
}

func trimSuffix(s, suf string) string {
	if len(s) >= len(suf) && s[len(s)-len(suf):] == suf {
		return s[:len(s)-len(suf)]
	}
	return s
}

func trimPrefix(s, pre string) string {
	if len(s) >= len(pre) && s[:len(pre)] == pre {
		return s[len(pre):]
	}
	return s
}

func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}
