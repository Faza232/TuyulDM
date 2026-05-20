//go:build linux

package main

import (
	"errors"
	"os"

	"golang.org/x/sys/unix"
)

func preallocateFileSpace(file *os.File, size int64) error {
	if file == nil || size <= 0 {
		return nil
	}

	if err := unix.Fallocate(int(file.Fd()), 0, 0, size); err != nil {
		if errors.Is(err, unix.EOPNOTSUPP) || errors.Is(err, unix.ENOTSUP) || errors.Is(err, unix.ENOSYS) || errors.Is(err, unix.EPERM) || errors.Is(err, unix.EINVAL) {
			return file.Truncate(size)
		}
		return err
	}

	return nil
}
