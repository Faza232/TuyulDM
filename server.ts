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
    { id: 1, name: "ubuntu-24.04-desktop-amd64.iso", size: "4.7 GB", progress: 45, speed: "12.4 MB/s", status: "downloading", type: "file" },
    { id: 2, name: "TuyulDM_Source.zip", size: "120 MB", progress: 100, speed: "0 B/s", status: "finished", type: "file" },
    { id: 3, name: "Presentation_Video_HLS.mp4", size: "890 MB", progress: 12, speed: "2.1 MB/s", status: "downloading", type: "video" },
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
    if (dl) {
      if (action === "pause") {
        dl.status = "paused";
        dl.speed = "0 B/s";
      } else if (action === "resume") {
        dl.status = "downloading";
        dl.speed = "10.5 MB/s"; // mock speed
      }
    }
    res.json(dl || {});
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
