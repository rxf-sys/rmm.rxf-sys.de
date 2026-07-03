//go:build darwin

package main

import (
	"os"
	"strings"
)

// collectSoftware lists app bundles in /Applications. Versions would need
// per-app Info.plist parsing (or the very slow system_profiler) — names
// alone already answer "was ist da installiert?" for family Macs.
func collectSoftware() []softwareItem {
	var items []softwareItem
	for _, dir := range []string{"/Applications", "/Applications/Utilities"} {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if name, ok := strings.CutSuffix(e.Name(), ".app"); ok {
				items = append(items, softwareItem{Name: name})
			}
		}
	}
	return items
}
