import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseSpeedBytes(speed: string) {
  if (!speed || speed === "0 B/s") {
    return 0;
  }

  const match = speed.match(/^(\d+(?:\.\d+)?)\s+([KMGT]?B)\/s$/i);
  if (!match) {
    return 0;
  }

  const value = Number.parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4,
  };

  return Math.round(value * (multipliers[unit] ?? 1));
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Mock Native Host API for the preview
  const activeDownloads = [
    { id: 1, name: "ubuntu-24.04-desktop-amd64.iso", url: "https://releases.example.test/ubuntu.iso", output_path: "/home/faza/Downloads/ubuntu-24.04-desktop-amd64.iso", size: "4.7 GB", progress: 45, speed: "12.4 MB/s", status: "downloading", type: "file" },
    { id: 2, name: "TuyulDM_Source.zip", url: "https://github.example.test/TuyulDM_Source.zip", output_path: "/home/faza/Downloads/TuyulDM_Source.zip", size: "120 MB", progress: 100, speed: "0 B/s", status: "finished", type: "file" },
    { id: 3, name: "Presentation_Video_HLS.mp4", url: "https://video.example.test/hls/master.m3u8", output_path: "/home/faza/Downloads/Presentation_Video_HLS.mp4", size: "890 MB", progress: 12, speed: "2.1 MB/s", status: "downloading", type: "video" },
    { id: 4, name: "signed-asset.bin", url: "https://cdn.example.test/signed-asset.bin?token=expired", output_path: "/home/faza/Downloads/signed-asset.bin", size: "860 MB", progress: 61, speed: "0 B/s", status: "awaiting_url_refresh", type: "file", error: "Link expired. Refresh URL to keep your progress.", error_code: "url_expired" },
  ];

  app.get("/api/host-status", (_req, res) => {
    res.json({
      connected: true,
      protocolVersion: "IPC v1",
      lastError: null,
    });
  });

  app.get("/api/stats", (_req, res) => {
    res.json({
      globalSpeedBytesPerSecond: activeDownloads.reduce((total, download) => total + parseSpeedBytes(download.speed), 0),
      freeSpaceBytes: 84.2 * 1024 ** 3,
      activeDownloads: activeDownloads.filter((download) => download.status === "downloading" || download.status === "queued" || download.status === "muxing").length,
    });
  });

  app.get("/api/downloads", (req, res) => {
    res.json(activeDownloads);
  });

  app.post("/api/downloads", (req, res) => {
    const { url, segments } = req.body;
    const newDownload = {
      id: activeDownloads.length + 1,
      name: url.split("/").pop() || "new_download",
      size: "Unknown",
      progress: 0,
      speed: "0 B/s",
      status: "queued",
      segments: segments || 8
    };
    activeDownloads.push(newDownload as any);
    res.json(newDownload);
  });

  app.post("/api/downloads/:id/:action", (req, res) => {
    const id = parseInt(req.params.id, 10);
    const action = req.params.action; // "pause" or "resume"
    const dl = activeDownloads.find(d => d.id === id);
    if (action === "refresh-url") {
      if (!dl) {
        res.status(404).json({ error: "download not found" });
        return;
      }

      const nextUrl = String(req.body?.url || "").trim();
      const force = !!req.body?.force;
      const restartFromScratch = !!req.body?.restartFromScratch;
      if (!nextUrl) {
        res.status(400).json({ error: "url is required" });
        return;
      }
      if (!force && nextUrl.includes("mismatch")) {
        res.status(409).json({
          error: "Preview mismatch: new URL points to different file size.",
          code: "size_mismatch",
          details: { expectedTotalSize: 860 * 1024 ** 2, actualTotalSize: 912 * 1024 ** 2 },
        });
        return;
      }
      if (!force && nextUrl.includes("validators-missing")) {
        res.status(409).json({
          error: "Preview warning: new URL no longer exposes validators.",
          code: "validators_missing",
        });
        return;
      }

      dl.url = nextUrl;
      dl.error = undefined;
      dl.error_code = undefined;
      dl.status = "downloading";
      dl.speed = "9.8 MB/s";
      dl.progress = restartFromScratch ? 0 : Math.max(Number(dl.progress || 0), 61);
      res.json({ ok: true, download: dl });
      return;
    }

    if (dl) {
      if (action === "pause") {
        dl.status = "paused";
        dl.speed = "0 B/s";
      } else if (action === "resume") {
        dl.status = "downloading";
        dl.speed = "10.5 MB/s"; // mock speed
      } else if (action === "open" || action === "reveal") {
        // Preview server does not control OS file managers. Keep API shape only.
      }
    }
    res.json(dl || {});
  });

  app.delete("/api/downloads/:id", (req, res) => {
    const id = parseInt(req.params.id, 10);
    const index = activeDownloads.findIndex((download) => download.id === id);
    if (index === -1) {
      res.status(404).json({ error: "download not found" });
      return;
    }

    const [removed] = activeDownloads.splice(index, 1);
    res.json({ ok: true, removed, deleteFile: !!req.body?.deleteFile });
  });

  app.post("/api/downloads/pause-all", (_req, res) => {
    activeDownloads.forEach((download) => {
      if (download.status === "downloading" || download.status === "queued" || download.status === "muxing") {
        download.status = "paused";
        download.speed = "0 B/s";
      }
    });
    res.json({ ok: true });
  });

  app.post("/api/downloads/resume-all", (_req, res) => {
    activeDownloads.forEach((download) => {
      if (download.status === "paused" || download.status === "queued") {
        download.status = "downloading";
        download.speed = "10.5 MB/s";
      }
    });
    res.json({ ok: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`TuyulDM Mock Server running on http://localhost:${PORT}`);
  });
}

startServer();
