Place the bundled ffmpeg sidecar here when packaging the native host.

Expected filenames:

- `ffmpeg-linux-amd64`
- `ffmpeg-linux-arm64`
- `ffmpeg-darwin-amd64`
- `ffmpeg-darwin-arm64`
- `ffmpeg-windows-amd64.exe`

The daemon resolves these relative to its own executable. For local development, you can also point the daemon at a custom binary with `TUYULDM_FFMPEG=/absolute/path/to/ffmpeg`.