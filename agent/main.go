// rmm-agent — the rxf-sys RMM endpoint agent.
//
// One static binary per OS; installs itself as a Windows service, systemd
// unit or launchd daemon via kardianos/service. All communication is
// outbound (WSS to the RMM server), so managed devices never need open
// ports or firewall changes.
//
// Usage:
//
//	rmm-agent enroll -server https://rmm.rxf-sys.de -token <one-time-token>
//	rmm-agent install|uninstall|start|stop   (service management, needs root/admin)
//	rmm-agent run                            (foreground, for debugging)
//	rmm-agent version
package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	"github.com/kardianos/service"
)

// Overridden at build time via -ldflags "-X main.version=…".
var version = "0.1.0-dev"

type program struct {
	cancel context.CancelFunc
	done   chan struct{}
}

func (p *program) Start(_ service.Service) error {
	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("not enrolled yet? %w", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	p.cancel = cancel
	p.done = make(chan struct{})
	go func() {
		defer close(p.done)
		runAgent(ctx, cfg)
	}()
	return nil
}

func (p *program) Stop(_ service.Service) error {
	if p.cancel != nil {
		p.cancel()
		<-p.done
	}
	return nil
}

func newService() (service.Service, error) {
	return service.New(&program{}, &service.Config{
		Name:        "rxf-rmm-agent",
		DisplayName: "rxf-sys RMM Agent",
		Description: "Monitoring and management agent for rmm.rxf-sys.de",
		Arguments:   []string{"run"},
	})
}

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	switch os.Args[1] {
	case "version":
		fmt.Println("rmm-agent", version)

	case "enroll":
		fs := flag.NewFlagSet("enroll", flag.ExitOnError)
		server := fs.String("server", "https://rmm.rxf-sys.de", "RMM server base URL")
		token := fs.String("token", "", "one-time enrollment token (required)")
		label := fs.String("label", "", "owner label shown in the dashboard, e.g. 'Mama'")
		_ = fs.Parse(os.Args[2:])
		if *token == "" {
			fmt.Fprintln(os.Stderr, "error: -token is required")
			os.Exit(2)
		}
		if err := enroll(*server, *token, *label); err != nil {
			fmt.Fprintln(os.Stderr, "enrollment failed:", err)
			os.Exit(1)
		}
		fmt.Println("enrolled — install the service next: rmm-agent install")

	case "install", "uninstall", "start", "stop":
		svc, err := newService()
		if err != nil {
			fmt.Fprintln(os.Stderr, "service setup failed:", err)
			os.Exit(1)
		}
		if err := service.Control(svc, os.Args[1]); err != nil {
			fmt.Fprintln(os.Stderr, "service control failed:", err)
			os.Exit(1)
		}
		fmt.Println(os.Args[1], "ok")

	case "run":
		svc, err := newService()
		if err != nil {
			fmt.Fprintln(os.Stderr, "service setup failed:", err)
			os.Exit(1)
		}
		// service.Run blocks: interactive terminals run the loop directly,
		// under a service manager it wires up the platform lifecycle.
		if err := svc.Run(); err != nil {
			fmt.Fprintln(os.Stderr, "agent exited:", err)
			os.Exit(1)
		}

	default:
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Fprintf(os.Stderr, `rmm-agent %s — rxf-sys RMM endpoint agent

Commands:
  enroll -server <url> -token <token> [-label <name>]
  install | uninstall | start | stop
  run
  version
`, version)
}
