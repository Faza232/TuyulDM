package main

import (
	"bytes"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

func openPathInDefaultApp(path string) error {
	return openFilePath(path)
}

func openFilePath(path string) error {
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

func revealFileInFolder(path string) error {
	switch runtime.GOOS {
	case "darwin":
		if err := exec.Command("open", "-R", path).Run(); err != nil {
			return fmt.Errorf("reveal %q: %w", path, err)
		}
		return nil
	case "windows":
		if err := exec.Command("explorer", fmt.Sprintf("/select,%s", path)).Run(); err != nil {
			return fmt.Errorf("reveal %q: %w", path, err)
		}
		return nil
	default:
		if err := showItemsWithDBus(path); err == nil {
			return nil
		}
		dir := filepath.Dir(path)
		if err := exec.Command("xdg-open", dir).Run(); err != nil {
			return fmt.Errorf("reveal %q: %w", path, err)
		}
		return nil
	}
}

func showItemsWithDBus(path string) error {
	if _, err := exec.LookPath("dbus-send"); err != nil {
		return err
	}
	uri := (&url.URL{Scheme: "file", Path: filepath.ToSlash(path)}).String()
	cmd := exec.Command(
		"dbus-send",
		"--session",
		"--dest=org.freedesktop.FileManager1",
		"--type=method_call",
		"--print-reply",
		"/org/freedesktop/FileManager1",
		"org.freedesktop.FileManager1.ShowItems",
		fmt.Sprintf("array:string:%s", uri),
		"string:",
	)
	return cmd.Run()
}

func resolveDownloadOutputPath(state *DownloadState, settings HostSettings) (string, error) {
	downloadDir, err := ResolveDownloadDir(settings)
	if err != nil {
		return "", err
	}

	outputPath := strings.TrimSpace(state.OutputPath)
	if outputPath == "" {
		filename := strings.TrimSpace(state.Filename)
		if filename == "" {
			return "", fmt.Errorf("download output path is unavailable")
		}
		outputPath = filepath.Join(downloadDir, filename)
	} else if !filepath.IsAbs(outputPath) {
		outputPath = filepath.Join(downloadDir, outputPath)
	}

	outputPath = filepath.Clean(outputPath)
	insideDownloadDir, err := pathInsideBase(outputPath, downloadDir)
	if err != nil {
		return "", err
	}
	if !insideDownloadDir {
		return "", fmt.Errorf("download path escapes configured download dir")
	}
	return outputPath, nil
}

func resolveDownloadOpenPath(state *DownloadState, settings HostSettings) (string, error) {
	if state.Status != "finished" {
		return "", fmt.Errorf("download is not finished")
	}
	outputPath, err := resolveDownloadRevealPath(state, settings)
	if err != nil {
		return "", err
	}
	return outputPath, nil
}

func resolveDownloadRevealPath(state *DownloadState, settings HostSettings) (string, error) {
	outputPath, err := resolveDownloadOutputPath(state, settings)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(outputPath)
	if err != nil {
		if os.IsNotExist(err) {
			return "", fmt.Errorf("download output not found")
		}
		return "", err
	}
	if info.IsDir() {
		return "", fmt.Errorf("download output path points to a directory")
	}
	return outputPath, nil
}

func pickDirectory(initial string) (string, error) {
	switch runtime.GOOS {
	case "darwin":
		return pickDirectoryDarwin(initial)
	case "windows":
		return pickDirectoryWindows(initial)
	default:
		return pickDirectoryLinux(initial)
	}
}

func pickDirectoryLinux(initial string) (string, error) {
	zenityArgs := []string{"--file-selection", "--directory"}
	if trimmed := strings.TrimSpace(initial); trimmed != "" {
		zenityArgs = append(zenityArgs, "--filename", ensureTrailingSeparator(trimmed))
	}
	if path, available, err := runOptionalPicker("zenity", zenityArgs...); available {
		return path, err
	}

	kdialogArgs := []string{"--getexistingdirectory"}
	if trimmed := strings.TrimSpace(initial); trimmed != "" {
		kdialogArgs = append(kdialogArgs, trimmed)
	}
	if path, available, err := runOptionalPicker("kdialog", kdialogArgs...); available {
		return path, err
	}

	return "", fmt.Errorf("no GUI dialog available; type path manually")
}

func pickDirectoryDarwin(initial string) (string, error) {
	if _, err := exec.LookPath("osascript"); err != nil {
		return "", fmt.Errorf("no GUI dialog available; type path manually")
	}
	script := "POSIX path of (choose folder"
	if trimmed := strings.TrimSpace(initial); trimmed != "" {
		script += fmt.Sprintf(` default location POSIX file "%s"`, escapeAppleScriptString(trimmed))
	}
	script += ")"
	out, err := exec.Command("osascript", "-e", script).CombinedOutput()
	if err != nil {
		if pickerCanceled(out, err) {
			return "", nil
		}
		return "", fmt.Errorf("osascript picker failed: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return normalizePickedDirectory(string(out))
}

func pickDirectoryWindows(initial string) (string, error) {
	if _, err := exec.LookPath("powershell"); err != nil {
		return "", fmt.Errorf("no GUI dialog available; type path manually")
	}
	scriptParts := []string{
		"Add-Type -AssemblyName System.Windows.Forms",
		"$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
		"$dialog.ShowNewFolderButton = $true",
	}
	if trimmed := strings.TrimSpace(initial); trimmed != "" {
		scriptParts = append(scriptParts, fmt.Sprintf("$dialog.SelectedPath = '%s'", escapePowerShellSingleQuoted(trimmed)))
	}
	scriptParts = append(scriptParts, "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }")
	out, err := exec.Command("powershell", "-NoProfile", "-Command", strings.Join(scriptParts, "; ")).CombinedOutput()
	if err != nil {
		if pickerCanceled(out, err) {
			return "", nil
		}
		return "", fmt.Errorf("powershell picker failed: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return normalizePickedDirectory(string(out))
}

func runOptionalPicker(command string, args ...string) (string, bool, error) {
	if _, err := exec.LookPath(command); err != nil {
		if errors.Is(err, exec.ErrNotFound) {
			return "", false, nil
		}
		return "", false, err
	}
	out, err := exec.Command(command, args...).CombinedOutput()
	if err != nil {
		if pickerCanceled(out, err) {
			return "", true, nil
		}
		return "", true, fmt.Errorf("%s picker failed: %w: %s", command, err, strings.TrimSpace(string(out)))
	}
	path, normalizeErr := normalizePickedDirectory(string(out))
	return path, true, normalizeErr
}

func pickerCanceled(output []byte, err error) bool {
	var exitErr *exec.ExitError
	if !errors.As(err, &exitErr) {
		return false
	}
	return len(bytes.TrimSpace(output)) == 0
}

func normalizePickedDirectory(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", nil
	}
	absolutePath, err := filepath.Abs(trimmed)
	if err != nil {
		return "", err
	}
	return filepath.Clean(absolutePath), nil
}

func ensureTrailingSeparator(path string) string {
	if strings.HasSuffix(path, string(filepath.Separator)) {
		return path
	}
	return path + string(filepath.Separator)
}

func escapeAppleScriptString(value string) string {
	return strings.ReplaceAll(value, `"`, `\"`)
}

func escapePowerShellSingleQuoted(value string) string {
	return strings.ReplaceAll(value, "'", "''")
}