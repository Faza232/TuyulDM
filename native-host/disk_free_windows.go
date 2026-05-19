//go:build windows

package main

import "golang.org/x/sys/windows"

func DiskFreeBytes(path string) (uint64, error) {
	pathPtr, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return 0, err
	}

	var freeBytesAvailable uint64
	if err := windows.GetDiskFreeSpaceEx(pathPtr, &freeBytesAvailable, nil, nil); err != nil {
		return 0, err
	}

	return freeBytesAvailable, nil
}