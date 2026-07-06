//go:build !windows

package main

import "os"

// swapBinary atomically replaces the running executable on Unix. The current
// binary is kept as <exe>.bak for manual rollback; the running process holds
// the old inode open until it exits, so the swap is safe mid-run.
func swapBinary(exe, tmp string) error {
	_ = os.Remove(exe + ".bak")
	if err := os.Rename(exe, exe+".bak"); err != nil {
		return err
	}
	if err := os.Rename(tmp, exe); err != nil {
		// Roll the backup back into place so we never end up with no binary.
		_ = os.Rename(exe+".bak", exe)
		return err
	}
	return nil
}
