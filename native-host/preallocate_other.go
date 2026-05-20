//go:build !linux

package main

import "os"

func preallocateFileSpace(file *os.File, size int64) error {
	if file == nil || size <= 0 {
		return nil
	}
	return file.Truncate(size)
}
