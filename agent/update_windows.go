//go:build windows

package main

import "os"

// swapBinary replaces the running executable on Windows. A running .exe can
// be renamed but not overwritten, so we move the running binary aside to
// <exe>.bak and move the new one into place; the moved-aside file is cleaned
// up on the next start (it may still be locked by the running process now).
func swapBinary(exe, tmp string) error {
	_ = os.Remove(exe + ".bak")
	if err := os.Rename(exe, exe+".bak"); err != nil {
		return err
	}
	if err := os.Rename(tmp, exe); err != nil {
		_ = os.Rename(exe+".bak", exe)
		return err
	}
	return nil
}
