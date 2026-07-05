//go:build !windows

package main

func rustDeskBinaries() []string {
	return []string{"rustdesk", "/usr/bin/rustdesk", "/usr/local/bin/rustdesk"}
}
