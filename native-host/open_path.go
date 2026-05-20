package main

import (
	"fmt"
	"os/exec"
	"runtime"
)

func openPathInDefaultApp(path string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", path)
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", "", path)
	default:
		cmd = exec.Command("xdg-open", path)
	}

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("open %q: %w", path, err)
	}
	return nil
}