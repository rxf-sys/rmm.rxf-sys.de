//go:build windows

package main

func rustDeskBinaries() []string {
	return []string{
		`rustdesk.exe`,
		`C:\Program Files\RustDesk\rustdesk.exe`,
	}
}
