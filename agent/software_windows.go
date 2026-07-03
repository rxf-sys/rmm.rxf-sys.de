//go:build windows

package main

import (
	"golang.org/x/sys/windows/registry"
)

// collectSoftware reads the classic Uninstall registry keys — the same
// source "Apps & Features" uses. Covers both 64-bit and 32-bit installs on
// the machine plus per-user installs of the service account.
func collectSoftware() []softwareItem {
	var items []softwareItem
	seen := map[string]bool{}
	paths := []struct {
		root registry.Key
		path string
	}{
		{registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`},
		{registry.LOCAL_MACHINE, `SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall`},
		{registry.CURRENT_USER, `SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`},
	}
	for _, p := range paths {
		key, err := registry.OpenKey(p.root, p.path, registry.ENUMERATE_SUB_KEYS)
		if err != nil {
			continue
		}
		subs, err := key.ReadSubKeyNames(-1)
		key.Close()
		if err != nil {
			continue
		}
		for _, sub := range subs {
			entry, err := registry.OpenKey(p.root, p.path+`\`+sub, registry.QUERY_VALUE)
			if err != nil {
				continue
			}
			name, _, nameErr := entry.GetStringValue("DisplayName")
			version, _, _ := entry.GetStringValue("DisplayVersion")
			// SystemComponent=1 marks entries "Apps & Features" hides too.
			sysComponent, _, _ := entry.GetIntegerValue("SystemComponent")
			entry.Close()
			if nameErr != nil || name == "" || sysComponent == 1 || seen[name+version] {
				continue
			}
			seen[name+version] = true
			items = append(items, softwareItem{Name: name, Version: version})
		}
	}
	return items
}
