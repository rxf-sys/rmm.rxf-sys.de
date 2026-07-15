# Cross-compilation for the rmm-agent. CGO stays off so every target is a
# single static binary.

VERSION ?= 0.1.0-dev
LDFLAGS  = -s -w -X main.version=$(VERSION)
DIST     = dist

# Öffentlicher ed25519-Update-Key (base64, aus `make keygen`). Wird beim Build
# in die Binaries gepinnt — ohne ihn bleibt der Platzhalter in update.go aktiv
# und die Agents lehnen jedes Auto-Update ab (fail-safe, aber tot).
ifneq ($(strip $(AGENT_UPDATE_PUBKEY)),)
LDFLAGS += -X main.updatePublicKey=$(AGENT_UPDATE_PUBKEY)
endif

.PHONY: build vet test release clean keygen sign check-sign-env dev-manifest \
        linux-amd64 linux-arm64 windows-amd64 darwin-amd64 darwin-arm64

build:
	CGO_ENABLED=0 go build -ldflags '$(LDFLAGS)' -o rmm-agent .

vet:
	go vet ./...

test:
	go test ./...

release: linux-amd64 linux-arm64 windows-amd64 darwin-amd64 darwin-arm64

linux-amd64:
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags '$(LDFLAGS)' -o $(DIST)/rmm-agent-linux-amd64 .

linux-arm64:
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags '$(LDFLAGS)' -o $(DIST)/rmm-agent-linux-arm64 .

windows-amd64:
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags '$(LDFLAGS)' -o $(DIST)/rmm-agent-windows-amd64.exe .

darwin-amd64:
	CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -ldflags '$(LDFLAGS)' -o $(DIST)/rmm-agent-darwin-amd64 .

darwin-arm64:
	CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -ldflags '$(LDFLAGS)' -o $(DIST)/rmm-agent-darwin-arm64 .

# --- Signing / self-update release -----------------------------------------
# One-time: generate a keypair; the private half stays secret on the build
# machine (AGENT_SIGN_KEY), the public half is injected at build time via
# AGENT_UPDATE_PUBKEY (no source edit needed).
keygen:
	go run ./tools/sign keygen

# Build all targets (with the public key pinned), then sign them into
# $(DIST)/manifest.json. Ship the contents of $(DIST) to the server's
# AGENT_RELEASE_DIR.
#   make sign VERSION=0.2.0 AGENT_SIGN_KEY=<base64 priv> AGENT_UPDATE_PUBKEY=<base64 pub>
sign: check-sign-env release
	cd $(DIST) && go run ../tools/sign sign "$(AGENT_SIGN_KEY)" "$(VERSION)" rmm-agent-*

check-sign-env:
	@test -n "$(AGENT_SIGN_KEY)" || (echo "AGENT_SIGN_KEY is required (make keygen)" && exit 1)
	@test -n "$(strip $(AGENT_UPDATE_PUBKEY))" || (echo "AGENT_UPDATE_PUBKEY is required — ohne gepinnten Public Key können die gebauten Agents keine Updates verifizieren" && exit 1)

# Build all targets + an UNSIGNED manifest.json. Enough to make the dashboard
# download / one-liner install work without setting up a signing key first.
# Auto-update stays off for these targets (that needs `make sign`). Copy the
# contents of $(DIST) to the server's AGENT_RELEASE_DIR (infrastructure/agent-releases/).
#   make dev-manifest VERSION=0.1.0
dev-manifest: release
	cd $(DIST) && go run ../tools/sign manifest "$(VERSION)" rmm-agent-*

clean:
	rm -rf $(DIST) rmm-agent
