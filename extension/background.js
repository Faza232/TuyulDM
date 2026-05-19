const HOST_NAME = "com.tuyuldm.daemon";
const SETTINGS_KEY = "interceptionSettings";
const DEFAULT_INTERCEPTION_SETTINGS = Object.freeze({
  enabled: true,
  extensions: ["zip", "iso", "mp4", "mkv", "7z", "tar", "gz"],
  minFileSizeMB: 50,
  allowDomains: [],
  blockDomains: [],
});
const REQUEST_HEADER_TTL_MS = 30_000;
const FORWARDED_HEADERS = new Map([
  ["authorization", "Authorization"],
  ["origin", "Origin"],
  ["referer", "Referer"],
  ["user-agent", "User-Agent"],
]);

console.log("TuyulDM Background Worker Started");

// Connect to the Go binary
let port = null;
const activeDownloads = new Set();
let progressInterval = null;
const recentRequestHeaders = new Map();

function requestKey(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function pruneCapturedHeaders() {
  const now = Date.now();
  for (const [key, entry] of recentRequestHeaders.entries()) {
    if (entry.expiresAt <= now) {
      recentRequestHeaders.delete(key);
    }
  }
}

function captureRequestHeaders(details) {
  pruneCapturedHeaders();
  const captured = {};

  for (const header of details.requestHeaders ?? []) {
    const canonicalName = FORWARDED_HEADERS.get(header.name.toLowerCase());
    if (!canonicalName || typeof header.value !== "string") {
      continue;
    }

    const value = header.value.trim();
    if (!value) {
      continue;
    }

    captured[canonicalName] = value;
  }

  if (Object.keys(captured).length === 0) {
    return;
  }

  recentRequestHeaders.set(requestKey(details.url), {
    headers: captured,
    expiresAt: Date.now() + REQUEST_HEADER_TTL_MS,
  });
}

function getCapturedRequestHeaders(url) {
  pruneCapturedHeaders();
  const entry = recentRequestHeaders.get(requestKey(url));
  return entry?.headers ? { ...entry.headers } : {};
}

async function getCookiesForUrl(url) {
  try {
    const cookies = await chrome.cookies.getAll({ url });
    return cookies.map(({ name, value, domain, path }) => ({
      name,
      value,
      domain,
      path,
    }));
  } catch (error) {
    console.warn("Failed to collect cookies for", url, error);
    return [];
  }
}

async function buildForwardedRequestContext(url, referer = "") {
  const headers = getCapturedRequestHeaders(url);
  if (referer) {
    headers.Referer = referer;
  }
  if (!headers["User-Agent"] && navigator.userAgent) {
    headers["User-Agent"] = navigator.userAgent;
  }

  return {
    headers,
    cookies: await getCookiesForUrl(url),
  };
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    return value.split(/[\n,]/);
  }
  return [];
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeExtension(value) {
  return String(value ?? "").trim().toLowerCase().replace(/^\./, "");
}

function normalizeDomain(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\*\./, "")
    .replace(/^\./, "");
}

function normalizeInterceptionSettings(raw = {}) {
  const minFileSizeMB = Number.isFinite(Number(raw.minFileSizeMB))
    ? Math.max(0, Number(raw.minFileSizeMB))
    : DEFAULT_INTERCEPTION_SETTINGS.minFileSizeMB;

  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_INTERCEPTION_SETTINGS.enabled,
    extensions: uniqueStrings(normalizeList(raw.extensions).map(normalizeExtension)),
    minFileSizeMB,
    allowDomains: uniqueStrings(normalizeList(raw.allowDomains).map(normalizeDomain)),
    blockDomains: uniqueStrings(normalizeList(raw.blockDomains).map(normalizeDomain)),
  };
}

async function getInterceptionSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeInterceptionSettings(stored?.[SETTINGS_KEY] ?? DEFAULT_INTERCEPTION_SETTINGS);
}

async function saveInterceptionSettings(nextSettings) {
  const normalized = normalizeInterceptionSettings(nextSettings);
  await chrome.storage.local.set({ [SETTINGS_KEY]: normalized });
  return normalized;
}

function hostnameMatches(hostname, patterns) {
  return patterns.some((pattern) => hostname === pattern || hostname.endsWith(`.${pattern}`));
}

function getFileExtension(url) {
  try {
    const pathname = new URL(url).pathname;
    const lastSegment = pathname.split("/").pop() || "";
    const dotIndex = lastSegment.lastIndexOf(".");
    return dotIndex >= 0 ? normalizeExtension(lastSegment.slice(dotIndex + 1)) : "";
  } catch {
    return "";
  }
}

function getOriginPattern(url) {
  try {
    return `${new URL(url).origin}/*`;
  } catch {
    return null;
  }
}

async function ensureOriginPermission(url) {
  const originPattern = getOriginPattern(url);
  if (!originPattern) {
    return false;
  }

  const hasPermission = await chrome.permissions.contains({ origins: [originPattern] });
  if (hasPermission) {
    return true;
  }

  try {
    return await chrome.permissions.request({ origins: [originPattern] });
  } catch (error) {
    console.warn("Origin permission request failed:", error);
    return false;
  }
}

function shouldInterceptDownload(item, settings) {
  if (!settings.enabled || !item?.url) {
    return false;
  }

  try {
    const hostname = new URL(item.url).hostname.toLowerCase();
    if (hostnameMatches(hostname, settings.blockDomains)) {
      return false;
    }
    if (settings.allowDomains.length > 0 && !hostnameMatches(hostname, settings.allowDomains)) {
      return false;
    }

    const extension = getFileExtension(item.url);
    if (settings.extensions.length > 0 && !settings.extensions.includes(extension)) {
      return false;
    }

    const minimumBytes = settings.minFileSizeMB * 1024 * 1024;
    if (minimumBytes > 0 && typeof item.totalBytes === "number" && item.totalBytes > 0 && item.totalBytes < minimumBytes) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function getDownloadFilename(item) {
  const existingName = item.filename?.split(/[\\/]/).pop();
  if (existingName) {
    return existingName;
  }

  try {
    const lastSegment = new URL(item.url).pathname.split("/").pop();
    return lastSegment || `Download_${Date.now()}`;
  } catch {
    return `Download_${Date.now()}`;
  }
}

function connectToHost() {
  if (port) {
    return true;
  }

  try {
    port = chrome.runtime.connectNative(HOST_NAME);
    
    port.onMessage.addListener((response) => {
      console.log("Received from TuyulDM Host:", response);
      if (response.message === "download.progressUpdate") {
        // Broadcast progress update to popup/options pages
        const payload = response.payload;
        chrome.runtime.sendMessage({ 
          type: "PROGRESS_UPDATE", 
          payload: payload 
        }).catch(() => {
          // Ignore error if popup is closed
        });

        // Track active downloads for polling
        if (payload && payload.id) {
          if (payload.status === "downloading" || payload.status === "queued" || payload.status === "muxing") {
            activeDownloads.add(payload.id);
          } else {
            activeDownloads.delete(payload.id);
          }
        }
      } else if (response.message === "download.list" || (response.id > 0 && Array.isArray(response.payload))) {
        chrome.runtime.sendMessage({
          type: "LIST_UPDATE",
          payload: response.payload
        }).catch(() => {});
      } else if (response.id > 0 && response.payload && response.payload.id) {
         // Also check for getProgress responses
         if (response.payload.status) {
           chrome.runtime.sendMessage({ 
             type: "PROGRESS_UPDATE", 
             payload: response.payload 
           }).catch(() => {});
           
           if (response.payload.status === "downloading" || response.payload.status === "queued" || response.payload.status === "muxing") {
             activeDownloads.add(response.payload.id);
           } else {
             activeDownloads.delete(response.payload.id);
           }
         }
      }
    });

    port.onDisconnect.addListener(() => {
      console.error("TuyulDM Host disconnected. Error:", chrome.runtime.lastError?.message);
      port = null;
      if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
      }
    });

    // Test ping
    port.postMessage({ method: "ping", params: { data: "Hello from Chrome" }, id: 1 });

    // Start polling active downloads
    if (progressInterval) {
      clearInterval(progressInterval);
    }
    progressInterval = setInterval(() => {
      if (!port) return;
      activeDownloads.forEach(id => {
        port.postMessage({
          method: "download.getProgress",
          params: { id: id },
          id: Date.now()
        });
      });
    }, 1000);

    return true;
  } catch (e) {
    console.error("Failed to connect to native host:", e);
    port = null;
    return false;
  }
}

function postToHost(message) {
  if (!port && !connectToHost()) {
    console.error("Native host not connected.");
    return false;
  }

  port.postMessage(message);
  return true;
}

async function interceptDownload(item) {
  if (item.byExtensionId === chrome.runtime.id) {
    return;
  }

  const settings = await getInterceptionSettings();
  if (!shouldInterceptDownload(item, settings)) {
    return;
  }

  const permissionGranted = await ensureOriginPermission(item.url);
  if (!permissionGranted) {
    console.warn("Skipping interception because the origin permission was not granted:", item.url);
    return;
  }

  const requestContext = await buildForwardedRequestContext(item.url, item.referrer);

  const submitted = postToHost({
    method: "download.add",
    params: {
      url: item.url,
      filename: getDownloadFilename(item),
      headers: requestContext.headers,
      cookies: requestContext.cookies,
    },
    id: Date.now(),
  });

  if (!submitted) {
    return;
  }

  try {
    await chrome.downloads.cancel(item.id);
  } catch (error) {
    console.warn("Failed to cancel browser download:", error);
  }
}

connectToHost();

chrome.webRequest.onSendHeaders.addListener(
  (details) => {
    captureRequestHeaders(details);
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders", "extraHeaders"]
);

// Sniff for video manifests by URL and Headers
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    const url = details.url;
    let isManifest = false;
    let manifestType = '';

    // Check by content-type header
    if (details.responseHeaders) {
      for (let header of details.responseHeaders) {
        if (header.name.toLowerCase() === 'content-type') {
          const value = header.value.toLowerCase();
          if (value.includes('application/vnd.apple.mpegurl') || value.includes('application/x-mpegurl')) {
            isManifest = true;
            manifestType = 'HLS';
            break;
          } else if (value.includes('application/dash+xml')) {
            isManifest = true;
            manifestType = 'DASH';
            break;
          }
        }
      }
    }

    // Fallback: check by URL extension
    if (!isManifest && (url.includes('.m3u8') || url.includes('.mpd'))) {
      isManifest = true;
      manifestType = url.includes('.m3u8') ? 'HLS' : 'DASH';
    }

    if (isManifest) {
      console.log(`Detected ${manifestType} manifest:`, url);
      // Inject content script dynamically if it's not already there
      if (details.tabId >= 0) {
        chrome.scripting.executeScript({
          target: { tabId: details.tabId },
          files: ['content.js']
        }).then(() => {
          // Send message to the content script of the tab after injection
          chrome.tabs.sendMessage(details.tabId, {
            type: "MANIFEST_DETECTED",
            url: url,
            manifestType: manifestType
          }).catch(() => {});
        }).catch((err) => {
          console.error("Failed to inject content script:", err);
        });
      }
    }
  },
  { urls: ["<all_urls>"], types: ["xmlhttprequest", "other"] },
  ["responseHeaders"]
);

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_INTERCEPTION_SETTINGS") {
    getInterceptionSettings()
      .then((settings) => sendResponse({ settings }))
      .catch((error) => sendResponse({ error: String(error) }));
    return true;
  } else if (message.type === "UPDATE_INTERCEPTION_SETTINGS") {
    saveInterceptionSettings(message.settings ?? {})
      .then((settings) => {
        chrome.runtime.sendMessage({
          type: "INTERCEPTION_SETTINGS_UPDATED",
          payload: settings,
        }).catch(() => {});
        sendResponse({ settings });
      })
      .catch((error) => sendResponse({ error: String(error) }));
    return true;
  } else if (message.type === "START_VIDEO_DOWNLOAD") {
    console.log("Starting video download:", message.url);
    postToHost({
        method: "download.video",
        params: {
          url: message.url,
          filename: `Video_${Date.now()}.mp4`,
          manifestType: message.manifestType
        },
        id: Date.now()
      });
  } else if (message.type === "START_DOWNLOAD") {
    console.log("Starting regular download:", message.url);
    const filename = message.url.substring(message.url.lastIndexOf('/') + 1) || `Download_${Date.now()}`;
    buildForwardedRequestContext(message.url)
      .then((requestContext) => {
        postToHost({
          method: "download.add",
          params: {
            url: message.url,
            filename: filename,
            segments: message.segments || 8,
            headers: requestContext.headers,
            cookies: requestContext.cookies,
          },
          id: Date.now(),
        });
      })
      .catch((error) => {
        console.warn("Failed to collect request context for manual download:", error);
        postToHost({
          method: "download.add",
          params: {
            url: message.url,
            filename: filename,
            segments: message.segments || 8,
          },
          id: Date.now(),
        });
      });
  } else if (message.type === "PAUSE_DOWNLOAD") {
    postToHost({ method: "download.pause", params: { id: String(message.id) }, id: Date.now() });
  } else if (message.type === "RESUME_DOWNLOAD") {
    postToHost({ method: "download.resume", params: { id: String(message.id) }, id: Date.now() });
  } else if (message.type === "GET_DOWNLOADS") {
    postToHost({ method: "download.list", params: {}, id: Date.now() });
  }
});

// Intercept downloads
chrome.downloads.onCreated.addListener((item) => {
  console.log("Download observed:", item.url);
  void interceptDownload(item);
});
