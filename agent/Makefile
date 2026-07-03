# Cross-compilation for the rmm-agent. CGO stays off so every target is a
# single static binary.

VERSION ?= 0.1.0-dev
LDFLAGS  = -s -w -X main.version=$(VERSION)
DIST     = dist

.PHONY: build vet test release clean \
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

clean:
	rm -rf $(DIST) rmm-agent
