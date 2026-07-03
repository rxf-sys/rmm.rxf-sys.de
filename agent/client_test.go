package main

import "testing"

func TestWsEndpoint(t *testing.T) {
	cases := []struct {
		in, want string
		wantErr  bool
	}{
		{in: "https://rmm.rxf-sys.de", want: "wss://rmm.rxf-sys.de/api/agent/ws"},
		{in: "https://rmm.rxf-sys.de/", want: "wss://rmm.rxf-sys.de/api/agent/ws"},
		{in: "http://127.0.0.1:8080", want: "ws://127.0.0.1:8080/api/agent/ws"},
		{in: "ftp://nope", wantErr: true},
	}
	for _, c := range cases {
		got, err := wsEndpoint(c.in)
		if c.wantErr {
			if err == nil {
				t.Errorf("wsEndpoint(%q): expected error, got %q", c.in, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("wsEndpoint(%q): %v", c.in, err)
			continue
		}
		if got != c.want {
			t.Errorf("wsEndpoint(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
