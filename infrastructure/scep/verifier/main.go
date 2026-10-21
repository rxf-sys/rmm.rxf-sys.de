// scep-csr-verifier is the -csrverifierexec hook of scepserver.
//
// scepserver writes the decrypted CSR (DER) to stdin and signs the
// certificate only when this program exits 0. The decision is not made
// here: the challenge password and the subject CN go to the Vulpexa backend
// (POST /api/mdm/scep/verify), which accepts each per-enrollment challenge
// exactly once. Any error — unreadable CSR, bad signature, backend down —
// is a refusal.
//
// Environment (inherited from scepserver):
//
//	SCEP_VERIFY_URL    default http://backend:8080/api/mdm/scep/verify
//	SCEP_VERIFY_TOKEN  bearer token, same value as MDM_SCEP_VERIFY_TOKEN
package main

import (
	"bytes"
	"crypto/x509"
	"encoding/asn1"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

const (
	defaultURL = "http://backend:8080/api/mdm/scep/verify"
	maxCSR     = 64 << 10
)

// PKCS#9 challengePassword.
var oidChallengePassword = asn1.ObjectIdentifier{1, 2, 840, 113549, 1, 9, 7}

func main() {
	if err := run(os.Stdin, os.Getenv); err != nil {
		fmt.Fprintln(os.Stderr, "scep-csr-verifier:", err)
		os.Exit(1)
	}
}

func run(stdin io.Reader, getenv func(string) string) error {
	token := getenv("SCEP_VERIFY_TOKEN")
	if token == "" {
		return errors.New("SCEP_VERIFY_TOKEN is empty")
	}
	url := getenv("SCEP_VERIFY_URL")
	if url == "" {
		url = defaultURL
	}
	der, err := io.ReadAll(io.LimitReader(stdin, maxCSR+1))
	if err != nil {
		return fmt.Errorf("read csr: %w", err)
	}
	if len(der) > maxCSR {
		return errors.New("csr too large")
	}
	challenge, cn, err := parseCSR(der)
	if err != nil {
		return err
	}
	return verify(url, token, challenge, cn)
}

// parseCSR checks the CSR signature and returns its challenge password and
// subject CN.
func parseCSR(der []byte) (challenge, cn string, err error) {
	csr, err := x509.ParseCertificateRequest(der)
	if err != nil {
		return "", "", fmt.Errorf("parse csr: %w", err)
	}
	if err := csr.CheckSignature(); err != nil {
		return "", "", fmt.Errorf("csr signature: %w", err)
	}
	challenge, err = challengePassword(csr.RawTBSCertificateRequest)
	if err != nil {
		return "", "", err
	}
	return challenge, csr.Subject.CommonName, nil
}

// challengePassword reads the attribute from the raw request info. The
// x509 package only decodes attributes shaped like extension requests and
// silently skips a plain string, so this walks the ASN.1 itself.
func challengePassword(tbs []byte) (string, error) {
	var info struct {
		Version       int
		Subject       asn1.RawValue
		PublicKey     asn1.RawValue
		RawAttributes []asn1.RawValue `asn1:"tag:0"`
	}
	if _, err := asn1.Unmarshal(tbs, &info); err != nil {
		return "", fmt.Errorf("parse request info: %w", err)
	}
	for _, raw := range info.RawAttributes {
		var attr struct {
			Type   asn1.ObjectIdentifier
			Values []asn1.RawValue `asn1:"set"`
		}
		if _, err := asn1.Unmarshal(raw.FullBytes, &attr); err != nil {
			continue
		}
		if !attr.Type.Equal(oidChallengePassword) || len(attr.Values) != 1 {
			continue
		}
		var value string
		if _, err := asn1.Unmarshal(attr.Values[0].FullBytes, &value); err != nil {
			return "", fmt.Errorf("challenge password: %w", err)
		}
		return value, nil
	}
	return "", errors.New("csr has no challenge password")
}

func verify(url, token, challenge, cn string) error {
	body, err := json.Marshal(map[string]string{"challenge": challenge, "cn": cn})
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("backend: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("backend refused (%d): %s", resp.StatusCode, bytes.TrimSpace(detail))
	}
	return nil
}
