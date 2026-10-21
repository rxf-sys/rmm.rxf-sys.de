package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type attribute struct {
	Type   asn1.ObjectIdentifier
	Values []asn1.RawValue `asn1:"set"`
}

// makeCSR builds a PKCS#10 request by hand, because crypto/x509 cannot emit
// a challengePassword attribute. Same shape as what iOS sends.
func makeCSR(t *testing.T, cn, challenge string) []byte {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	subject, err := asn1.Marshal(pkix.Name{CommonName: cn}.ToRDNSequence())
	if err != nil {
		t.Fatal(err)
	}
	spki, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	var attrs []attribute
	if challenge != "" {
		value, err := asn1.Marshal(challenge)
		if err != nil {
			t.Fatal(err)
		}
		attrs = append(attrs, attribute{Type: oidChallengePassword, Values: []asn1.RawValue{{FullBytes: value}}})
	}
	tbs, err := asn1.Marshal(struct {
		Version    int
		Subject    asn1.RawValue
		PublicKey  asn1.RawValue
		Attributes []attribute `asn1:"tag:0"`
	}{0, asn1.RawValue{FullBytes: subject}, asn1.RawValue{FullBytes: spki}, attrs})
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(tbs)
	sig, err := ecdsa.SignASN1(rand.Reader, key, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	csr, err := asn1.Marshal(struct {
		TBS       asn1.RawValue
		Algorithm pkix.AlgorithmIdentifier
		Signature asn1.BitString
	}{
		asn1.RawValue{FullBytes: tbs},
		pkix.AlgorithmIdentifier{Algorithm: asn1.ObjectIdentifier{1, 2, 840, 10045, 4, 3, 2}},
		asn1.BitString{Bytes: sig, BitLength: len(sig) * 8},
	})
	if err != nil {
		t.Fatal(err)
	}
	return csr
}

func TestParseCSR(t *testing.T) {
	challenge, cn, err := parseCSR(makeCSR(t, "Vulpexa MDM ref1", "c0ffee"))
	if err != nil {
		t.Fatal(err)
	}
	if challenge != "c0ffee" || cn != "Vulpexa MDM ref1" {
		t.Fatalf("got %q %q", challenge, cn)
	}
}

func TestParseCSRWithoutChallenge(t *testing.T) {
	if _, _, err := parseCSR(makeCSR(t, "x", "")); err == nil {
		t.Fatal("expected error for missing challenge")
	}
}

func TestParseCSRTampered(t *testing.T) {
	der := makeCSR(t, "Vulpexa MDM ref1", "c0ffee")
	// Flip a byte inside the challenge: the signature must no longer match.
	i := strings.Index(string(der), "c0ffee")
	der[i] = 'd'
	if _, _, err := parseCSR(der); err == nil {
		t.Fatal("expected signature error")
	}
}

func TestRun(t *testing.T) {
	var got map[string]string
	var auth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth = r.Header.Get("Authorization")
		_ = json.NewDecoder(r.Body).Decode(&got)
		if got["challenge"] != "good" {
			http.Error(w, `{"detail":"unknown"}`, http.StatusForbidden)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	env := map[string]string{"SCEP_VERIFY_URL": srv.URL, "SCEP_VERIFY_TOKEN": "tok"}
	getenv := func(k string) string { return env[k] }

	if err := run(strings.NewReader(string(makeCSR(t, "Vulpexa MDM r", "good"))), getenv); err != nil {
		t.Fatal(err)
	}
	if auth != "Bearer tok" || got["cn"] != "Vulpexa MDM r" {
		t.Fatalf("auth %q body %v", auth, got)
	}
	if err := run(strings.NewReader(string(makeCSR(t, "Vulpexa MDM r", "bad"))), getenv); err == nil {
		t.Fatal("expected refusal")
	}
	env["SCEP_VERIFY_TOKEN"] = ""
	if err := run(strings.NewReader(""), getenv); err == nil {
		t.Fatal("expected error without token")
	}
}

func TestRunBackendDown(t *testing.T) {
	env := map[string]string{"SCEP_VERIFY_URL": "http://127.0.0.1:1", "SCEP_VERIFY_TOKEN": "tok"}
	err := run(strings.NewReader(string(makeCSR(t, "x", "c"))), func(k string) string { return env[k] })
	if err == nil {
		t.Fatal("expected error when backend is unreachable")
	}
}

// writeCA writes a self-signed CA certificate with the given key usage.
func writeCA(t *testing.T, usage x509.KeyUsage) string {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "Test CA"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		KeyUsage:              usage,
		BasicConstraintsValid: true,
		IsCA:                  true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "ca.pem")
	if err := os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestCheckCA(t *testing.T) {
	// What `scepserver ca -init` produces: iOS refuses it.
	initCA := writeCA(t, x509.KeyUsageCertSign|x509.KeyUsageCRLSign|x509.KeyUsageDigitalSignature)
	if err := checkCA(initCA); err == nil || !strings.Contains(err.Error(), "scep-ca-reissue.sh") {
		t.Fatalf("expected a refusal naming the fix, got %v", err)
	}
	fixed := writeCA(t, x509.KeyUsageCertSign|x509.KeyUsageCRLSign|x509.KeyUsageDigitalSignature|x509.KeyUsageKeyEncipherment)
	if err := checkCA(fixed); err != nil {
		t.Fatal(err)
	}
	if err := checkCA(filepath.Join(t.TempDir(), "missing.pem")); err == nil {
		t.Fatal("expected an error for a missing file")
	}
}
