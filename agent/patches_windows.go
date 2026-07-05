//go:build windows

package main

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"os/exec"
	"strings"
)

// scanPatchesOS queries the Windows Update Agent COM API for applicable
// software updates, emitting one tab-separated line per update
// (UpdateID \t Title \t MsrcSeverity). patch_id is the UpdateID, which the
// install path filters on.
const scanScript = `
$ErrorActionPreference = 'Stop'
$tab = [char]9
$session = New-Object -ComObject Microsoft.Update.Session
$searcher = $session.CreateUpdateSearcher()
$result = $searcher.Search("IsInstalled=0 and Type='Software'")
foreach ($u in $result.Updates) {
  $sev = $u.MsrcSeverity
  if (-not $sev) { $sev = 'other' }
  Write-Output ("{0}{3}{1}{3}{2}" -f $u.Identity.UpdateID, $u.Title, $sev, $tab)
}
`

func scanPatchesOS(ctx context.Context) ([]patchItem, error) {
	out, err := runPowerShell(ctx, scanScript)
	if err != nil {
		return nil, fmt.Errorf("windows update search: %w", err)
	}
	var items []patchItem
	sc := bufio.NewScanner(bytes.NewReader(out))
	for sc.Scan() {
		parts := strings.SplitN(sc.Text(), "\t", 3)
		if len(parts) < 2 || parts[0] == "" {
			continue
		}
		sev := "other"
		if len(parts) == 3 {
			sev = strings.ToLower(strings.TrimSpace(parts[2]))
		}
		items = append(items, patchItem{PatchID: parts[0], Title: parts[1], Severity: sev})
	}
	return items, nil
}

// installScript downloads and installs the updates whose UpdateID is in the
// $ids list (or all applicable when the list is empty). Reboots are never
// forced here — the dashboard decides when to reboot.
const installScript = `
$ErrorActionPreference = 'Stop'
$wanted = @(%s)
$session = New-Object -ComObject Microsoft.Update.Session
$searcher = $session.CreateUpdateSearcher()
$result = $searcher.Search("IsInstalled=0 and Type='Software'")
$toInstall = New-Object -ComObject Microsoft.Update.UpdateColl
foreach ($u in $result.Updates) {
  if ($wanted.Count -eq 0 -or $wanted -contains $u.Identity.UpdateID) {
    Write-Output ("Ausgewählt: {0}" -f $u.Title)
    [void]$toInstall.Add($u)
  }
}
if ($toInstall.Count -eq 0) { Write-Output 'Keine passenden Updates.'; exit 0 }
$downloader = $session.CreateUpdateDownloader()
$downloader.Updates = $toInstall
Write-Output 'Lade herunter…'
[void]$downloader.Download()
$installer = $session.CreateUpdateInstaller()
$installer.Updates = $toInstall
Write-Output 'Installiere…'
$r = $installer.Install()
Write-Output ("Ergebnis-Code: {0}, Reboot nötig: {1}" -f $r.ResultCode, $r.RebootRequired)
if ($r.ResultCode -ne 2) { exit 1 }
`

func installPatchesOS(ctx context.Context, patchIDs []string, w io.Writer) error {
	quoted := make([]string, len(patchIDs))
	for i, id := range patchIDs {
		// UpdateIDs are GUIDs; still guard against quote injection.
		quoted[i] = "'" + strings.ReplaceAll(id, "'", "''") + "'"
	}
	script := fmt.Sprintf(installScript, strings.Join(quoted, ","))
	cmd := powerShellCmd(ctx, script)
	cmd.Stdout = w
	cmd.Stderr = w
	return cmd.Run()
}

func powerShellCmd(ctx context.Context, script string) *exec.Cmd {
	return exec.CommandContext(ctx, "powershell", "-NoProfile", "-NonInteractive", "-Command", script)
}

func runPowerShell(ctx context.Context, script string) ([]byte, error) {
	return powerShellCmd(ctx, script).Output()
}
