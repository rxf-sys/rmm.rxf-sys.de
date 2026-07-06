# Cross-compilation for the rmm-agent. CGO stays off so every target is a
# single static binary.

VERSION ?= 0.1.0-dev
LDFLAGS  = -s -w -X main.version=$(VERSION)
DIST     = dist

.PHONY: build vet test release clean keygen sign \
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
# One-time: generate a keypair, pin the public half in update.go, keep the
# private half secret (e.g. export AGENT_SIGN_KEY=...).
keygen:
	go run ./tools/sign keygen

# Build all targets, then sign them into $(DIST)/manifest.json. Ship the
# contents of $(DIST) to the server's AGENT_RELEASE_DIR.
#   make sign VERSION=0.2.0 AGENT_SIGN_KEY=<base64 private key>
sign: release
	@test -n "$(AGENT_SIGN_KEY)" || (echo "AGENT_SIGN_KEY is required" && exit 1)
	cd $(DIST) && go run ../tools/sign sign "$(AGENT_SIGN_KEY)" "$(VERSION)" rmm-agent-*

clean:
	rm -rf $(DIST) rmm-agent
