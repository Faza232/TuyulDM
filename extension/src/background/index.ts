import browser from 'webextension-polyfill';
import {
  MEDIA_BUFFER_TTL_MS,
  classifyMediaCandidate,
  getUrlOrigin,
  isBlobUrl,
  mediaIdForCandidate,
  normalizeMediaUrl,
  type DetectedMediaEntry,
  type ManifestType,
  type MediaCandidate,
  type PageHookPayload,
  type ScanPayload,
  type VariantInfo,
} from '../shared/media_classify';

const browserApi = browser as any;
const HOST_NAME = 'com.tuyuldm.daemon';
const SETTINGS_KEY = 'interceptionSettings';
const PERMISSION_ONBOARDING_DISMISSED_KEY = 'permissionOnboardingDismissed';
const REQUEST_HEADER_TTL_MS = 30_000;
const SEND_HEADERS_EXTRA_INFO = typeof browser.runtime.getBrowserInfo === 'function'
  ? ['requestHeaders']
  : ['requestHeaders', 'extraHeaders'];
const DEFAULT_INTERCEPTION_SETTINGS = Object.freeze({
  enabled: true,
  extensions: ['zip', 'iso', 'mp4', 'mkv', '7z', 'tar', 'gz'],
  minFileSizeMB: 50,
  allowDomains: [],
  blockDomains: [],
  autoShowDetectedStreams: false,
  scheduleEnabled: false,
  scheduleStartHour: 2,
  scheduleEndHour: 6,
  scheduleDays: [0, 1, 2, 3, 4, 5, 6],
});
const FORWARDED_HEADERS = new Map([
  ['authorization', 'Authorization'],
  ['origin', 'Origin'],
  ['referer', 'Referer'],
  ['user-agent', 'User-Agent'],
]);
const DETECTED_MEDIA_TTL_MS = 5 * 60_000;

type OverlayDownloadSchedule = {
  start_hour: number;
  end_hour: number;
  days: number[];
};

type RecentMediaCandidate = {
  candidate: MediaCandidate;
  detectedAt: number;
};

type TabDetectionState = {
  pageUrl: string;
  entries: DetectedMediaEntry[];
  manifestByOrigin: Map<string, ManifestType>;
  recentByFrame: Map<string, RecentMediaCandidate[]>;
  blobBackings: Map<string, MediaCandidate>;
  lastMseMimeByFrame: Map<string, string>;
  bufferedCandidates: RecentMediaCandidate[];
  pendingInspectIds: Set<string>;
};

type PermissionStatusPayload = {
  currentOrigin: string;
  currentOriginPattern: string;
  currentOriginGranted: boolean;
  canRequestCurrentOrigin: boolean;
  hasAllUrlsPermission: boolean;
  grantedOrigins: string[];
  shouldShowOnboarding: boolean;
};

let port: any | null = null;
const activeDownloads = new Set<string>();
const recentRequestHeaders = new Map<string, { headers: Record<string, string>; expiresAt: number }>();
const pendingRequests = new Map<number, { resolve: (response: any) => void; reject: (error: Error) => void }>();
const detectedMediaByTab = new Map<number, TabDetectionState>();
let nextRequestId = 10_000;
let hostStatus = {
  connected: false,
  protocolVersion: 'IPC v1',
  lastError: null as string | null,
};

function broadcastRuntimeMessage(message: Record<string, unknown>) {
  void browserApi.runtime.sendMessage(message).catch(() => {
    // Ignore when no listeners are available.
  });
}

function updateHostStatus(nextStatus: Partial<typeof hostStatus>) {
  hostStatus = { ...hostStatus, ...nextStatus };
  broadcastRuntimeMessage({ type: 'HOST_STATUS', payload: hostStatus });
}

function isActiveDownloadStatus(status: unknown) {
  return status === 'downloading' || status === 'queued' || status === 'muxing';
}

function syncActiveDownloadsFromList(downloads: unknown) {
  activeDownloads.clear();
  if (!Array.isArray(downloads)) {
    return;
  }

  for (const download of downloads) {
    if (download?.id && isActiveDownloadStatus(download?.status)) {
      activeDownloads.add(String(download.id));
    }
  }
}

function normalizeGrantedOrigins(origins: unknown) {
  if (!Array.isArray(origins)) {
    return [] as string[];
  }

  return [...new Set(origins.map((origin) => String(origin || '').trim()).filter(Boolean))].sort((left, right) => {
    if (left === '<all_urls>') {
      return -1;
    }
    if (right === '<all_urls>') {
      return 1;
    }
    return left.localeCompare(right);
  });
}

function isRequestableOriginUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

async function getPermissionStatus(): Promise<PermissionStatusPayload> {
  const tab = await getActiveTab();
  const currentUrl = typeof tab?.url === 'string' ? tab.url : '';
  const currentOriginPattern = getOriginPattern(currentUrl) ?? '';
  const currentOrigin = currentOriginPattern ? new URL(currentUrl).origin : '';
  const grantedPermissions = await browserApi.permissions.getAll();
  const grantedOrigins = normalizeGrantedOrigins(grantedPermissions?.origins);
  const hasAllUrlsPermission = grantedOrigins.includes('<all_urls>')
    || await browserApi.permissions.contains({ origins: ['<all_urls>'] });
  const canRequestCurrentOrigin = !!currentOriginPattern && isRequestableOriginUrl(currentUrl);
  const currentOriginGranted = canRequestCurrentOrigin
    ? hasAllUrlsPermission
      || grantedOrigins.includes(currentOriginPattern)
      || await browserApi.permissions.contains({ origins: [currentOriginPattern] })
    : false;
  const stored = await browserApi.storage.local.get(PERMISSION_ONBOARDING_DISMISSED_KEY);
  const shouldShowOnboarding = !hasAllUrlsPermission && stored?.[PERMISSION_ONBOARDING_DISMISSED_KEY] !== true;

  return {
    currentOrigin,
    currentOriginPattern,
    currentOriginGranted,
    canRequestCurrentOrigin,
    hasAllUrlsPermission,
    grantedOrigins,
    shouldShowOnboarding,
  };
}

async function broadcastPermissionStatus() {
  const status = await getPermissionStatus();
  broadcastRuntimeMessage({ type: 'PERMISSIONS_UPDATED', payload: status });
  return status;
}

async function setPermissionOnboardingDismissed(value: boolean) {
  await browserApi.storage.local.set({ [PERMISSION_ONBOARDING_DISMISSED_KEY]: value });
}

function getContentScriptFiles() {
  const manifest = browserApi.runtime.getManifest();
  const scripts = manifest.content_scripts?.find((entry: any) => entry?.js?.includes('extension/src/content/index.ts'))?.js;
  return Array.isArray(scripts) ? scripts : [];
}

function createTabDetectionState(pageUrl = ''): TabDetectionState {
  return {
    pageUrl,
    entries: [],
    manifestByOrigin: new Map<string, ManifestType>(),
    recentByFrame: new Map<string, RecentMediaCandidate[]>(),
    blobBackings: new Map<string, MediaCandidate>(),
    lastMseMimeByFrame: new Map<string, string>(),
    bufferedCandidates: [],
    pendingInspectIds: new Set<string>(),
  };
}

function ensureTabDetectionState(tabId: number, pageUrl = '') {
  const existing = detectedMediaByTab.get(tabId);
  if (existing) {
    if (pageUrl) {
      existing.pageUrl = pageUrl;
    }
    return existing;
  }

  const created = createTabDetectionState(pageUrl);
  detectedMediaByTab.set(tabId, created);
  return created;
}

function isProtectedMediaError(message: string) {
  const normalized = String(message || '').toLowerCase();
  return normalized.includes('drm') || normalized.includes('encrypted') || normalized.includes('widevine');
}

function pruneRecentMediaCandidateList(candidates: RecentMediaCandidate[]) {
  const now = Date.now();
  return candidates.filter((entry) => entry.detectedAt + MEDIA_BUFFER_TTL_MS > now);
}

function pruneDetectedMedia(tabId?: number) {
  const now = Date.now();
  if (typeof tabId === 'number') {
    const state = detectedMediaByTab.get(tabId);
    if (!state) {
      return;
    }

    state.entries = state.entries.filter((entry) => entry.detectedAt + DETECTED_MEDIA_TTL_MS > now);
    state.bufferedCandidates = pruneRecentMediaCandidateList(state.bufferedCandidates);
    for (const [frameUrl, candidates] of state.recentByFrame.entries()) {
      const nextCandidates = pruneRecentMediaCandidateList(candidates);
      if (nextCandidates.length > 0) {
        state.recentByFrame.set(frameUrl, nextCandidates);
      } else {
        state.recentByFrame.delete(frameUrl);
      }
    }

    for (const [blobUrl, candidate] of state.blobBackings.entries()) {
      if (!candidate.url) {
        state.blobBackings.delete(blobUrl);
      }
    }

    if (state.entries.length === 0 && state.bufferedCandidates.length === 0 && state.recentByFrame.size === 0 && state.pageUrl === '') {
      detectedMediaByTab.delete(tabId);
    }
    return;
  }

  for (const currentTabId of detectedMediaByTab.keys()) {
    pruneDetectedMedia(currentTabId);
  }
}

function getDetectedMedia(tabId: number) {
  pruneDetectedMedia(tabId);
  const state = detectedMediaByTab.get(tabId);
  return [...(state?.entries ?? [])].sort((left, right) => right.detectedAt - left.detectedAt);
}

async function updateActionBadge(tabId: number) {
  const count = getDetectedMedia(tabId).length;
  await browserApi.action.setBadgeText({ tabId, text: count > 0 ? String(Math.min(count, 99)) : '' });
  if (count > 0) {
    await browserApi.action.setBadgeBackgroundColor({ tabId, color: '#0A0A0A' });
  }
}

function broadcastDetectedMediaUpdate(tabId: number) {
  const count = getDetectedMedia(tabId).length;
  void updateActionBadge(tabId).catch(() => {
    // Ignore badge update failures on unsupported browsers.
  });
  broadcastRuntimeMessage({ type: 'DETECTED_STREAMS_UPDATED', payload: { tabId, count } });
}

function rememberRecentMediaCandidate(state: TabDetectionState, frameUrl: string, candidate: MediaCandidate) {
  const existing = state.recentByFrame.get(frameUrl) ?? [];
  const next = [{ candidate, detectedAt: Date.now() }, ...existing];
  state.recentByFrame.set(frameUrl, pruneRecentMediaCandidateList(next).slice(0, 16));
}

function candidateFromRecentMedia(state: TabDetectionState, frameUrl: string, blobUrl = '') {
  if (blobUrl) {
    const blobCandidate = state.blobBackings.get(blobUrl);
    if (blobCandidate) {
      return blobCandidate;
    }
  }

  const recent = pruneRecentMediaCandidateList(state.recentByFrame.get(frameUrl) ?? []);
  state.recentByFrame.set(frameUrl, recent);
  return recent[0]?.candidate ?? null;
}

function mapVariantInfo(variants: unknown): VariantInfo[] {
  if (!Array.isArray(variants)) {
    return [];
  }

  return variants
    .map((variant) => ({
      id: String(variant?.id || '').trim(),
      name: typeof variant?.name === 'string' ? variant.name : '',
      bandwidth: Number.isFinite(Number(variant?.bandwidth)) ? Number(variant.bandwidth) : undefined,
      resolution: typeof variant?.resolution === 'string' ? variant.resolution : '',
      codecs: typeof variant?.codecs === 'string' ? variant.codecs : '',
      url: typeof variant?.url === 'string' ? variant.url : '',
    }))
    .filter((variant) => variant.id);
}

function applyInspectResult(state: TabDetectionState, entryId: string, result: { qualities?: VariantInfo[]; selectedVariantId?: string; protected?: boolean; protectedReason?: string }) {
  const entry = state.entries.find((candidate) => candidate.id === entryId);
  if (!entry) {
    return false;
  }

  if (result.qualities && result.qualities.length > 0) {
    entry.qualities = result.qualities;
  }
  if (result.selectedVariantId) {
    entry.selectedVariantId = result.selectedVariantId;
  }
  if (typeof result.protected === 'boolean') {
    entry.protected = result.protected;
  }
  if (result.protectedReason) {
    entry.protectedReason = result.protectedReason;
  }
  return true;
}

async function enrichDetectedManifest(tabId: number, entryId: string) {
  const state = detectedMediaByTab.get(tabId);
  if (!state || state.pendingInspectIds.has(entryId)) {
    return;
  }

  const entry = state.entries.find((candidate) => candidate.id === entryId);
  if (!entry?.manifestType) {
    return;
  }

  state.pendingInspectIds.add(entryId);
  try {
    const requestContext = await buildForwardedRequestContext(entry.url, entry.pageUrl);
    const response = await sendHostRequest('video.inspect', {
      url: entry.url,
      manifestType: entry.manifestType,
      headers: requestContext.headers,
      cookies: requestContext.cookies,
    });
    const updated = applyInspectResult(state, entryId, {
      qualities: mapVariantInfo(response.payload?.variants),
      selectedVariantId: typeof response.payload?.selectedVariantId === 'string' ? response.payload.selectedVariantId : '',
    });
    if (updated) {
      broadcastDetectedMediaUpdate(tabId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const updated = applyInspectResult(state, entryId, {
      protected: isProtectedMediaError(message),
      protectedReason: isProtectedMediaError(message) ? message : undefined,
    });
    if (updated && isProtectedMediaError(message)) {
      broadcastDetectedMediaUpdate(tabId);
    }
  } finally {
    state.pendingInspectIds.delete(entryId);
  }
}

function flushBufferedCandidates(tabId: number, state: TabDetectionState, origin: string, pageUrl: string) {
  const pending = [...state.bufferedCandidates];
  state.bufferedCandidates = [];
  for (const entry of pending) {
    if (getUrlOrigin(entry.candidate.url) === origin) {
      void recordDetectedMediaCandidate(tabId, entry.candidate, 'page', pageUrl);
      continue;
    }
    state.bufferedCandidates.push(entry);
  }
}

async function upsertDetectedMediaEntry(tabId: number, candidate: MediaCandidate, source: DetectedMediaEntry['source'], pageUrl: string) {
  const normalizedUrl = normalizeMediaUrl(candidate.url);
  if (!normalizedUrl) {
    return { entry: null, isNew: false };
  }

  const state = ensureTabDetectionState(tabId, pageUrl);
  const classification = classifyMediaCandidate({ ...candidate, url: normalizedUrl }, { manifestByOrigin: state.manifestByOrigin });
  if (classification.kind === 'unknown') {
    return { entry: null, isNew: false };
  }

  if (classification.kind === 'segment_hls' || classification.kind === 'segment_dash') {
    state.bufferedCandidates = pruneRecentMediaCandidateList([
      { candidate: { ...candidate, url: normalizedUrl }, detectedAt: Date.now() },
      ...state.bufferedCandidates,
    ]);
    return { entry: null, isNew: false };
  }

  const entryId = mediaIdForCandidate(classification.kind, normalizedUrl);
  const existingEntry = state.entries.find((entry) => entry.id === entryId);
  const sizeHint = Number(candidate.sizeHint);
  if (existingEntry) {
    existingEntry.detectedAt = Date.now();
    existingEntry.source = source;
    existingEntry.pageUrl = pageUrl || existingEntry.pageUrl;
    if (candidate.posterUrl) {
      existingEntry.posterUrl = candidate.posterUrl;
    }
    if (Number.isFinite(sizeHint) && sizeHint > 0) {
      existingEntry.sizeHint = sizeHint;
    }
    broadcastDetectedMediaUpdate(tabId);
    return { entry: existingEntry, isNew: false };
  }

  const entry: DetectedMediaEntry = {
    id: entryId,
    url: normalizedUrl,
    kind: classification.kind,
    label: classification.label,
    pageUrl,
    detectedAt: Date.now(),
    source,
    sizeHint: Number.isFinite(sizeHint) && sizeHint > 0 ? sizeHint : undefined,
    manifestType: classification.manifestType,
    posterUrl: candidate.posterUrl || undefined,
  };
  state.entries.unshift(entry);
  state.entries = state.entries.slice(0, 24);
  if (classification.manifestType) {
    const origin = getUrlOrigin(normalizedUrl);
    if (origin) {
      state.manifestByOrigin.set(origin, classification.manifestType);
      flushBufferedCandidates(tabId, state, origin, pageUrl);
    }
  }
  broadcastDetectedMediaUpdate(tabId);
  return { entry, isNew: true };
}

async function recordDetectedMediaCandidate(tabId: number, candidate: MediaCandidate, source: DetectedMediaEntry['source'], pageUrl: string) {
  const normalizedUrl = normalizeMediaUrl(candidate.url);
  if (!normalizedUrl) {
    return;
  }

  const state = ensureTabDetectionState(tabId, pageUrl);
  const frameUrl = String(candidate.frameUrl || pageUrl || '');
  const candidateWithHints = {
    ...candidate,
    url: normalizedUrl,
    mimeFromMSE: candidate.mimeFromMSE || state.lastMseMimeByFrame.get(frameUrl) || '',
  };
  rememberRecentMediaCandidate(state, frameUrl, candidateWithHints);

  const { entry, isNew } = await upsertDetectedMediaEntry(tabId, candidateWithHints, source, pageUrl);
  if (!entry) {
    return;
  }

  if (entry.manifestType && (!entry.qualities || entry.qualities.length === 0) && !entry.protected) {
    void enrichDetectedManifest(tabId, entry.id);
  }

  if (!isNew || !entry.manifestType) {
    return;
  }

  try {
    const settings = await getInterceptionSettings();
    const schedule = buildInterceptionSchedule(settings);
    if (settings.autoShowDetectedStreams) {
      await showDetectedStreamOverlay(tabId, entry.url, entry.manifestType, schedule);
    }
  } catch (error) {
    console.warn('Failed to process detected media:', error);
  }
}

async function handlePageHookPayload(tabId: number, payload: PageHookPayload | ScanPayload, pageUrl: string) {
  const state = ensureTabDetectionState(tabId, pageUrl);
  const frameUrl = String(payload.frameUrl || pageUrl || '');

  if (payload.event === 'mse') {
    if (payload.mimeFromMSE) {
      state.lastMseMimeByFrame.set(frameUrl, String(payload.mimeFromMSE));
    }
    return;
  }

  if (payload.event === 'blob_created') {
    const recentCandidate = candidateFromRecentMedia(state, frameUrl);
    if (recentCandidate && payload.url) {
      state.blobBackings.set(String(payload.url), {
        ...recentCandidate,
        mimeFromMSE: state.lastMseMimeByFrame.get(frameUrl) || recentCandidate.mimeFromMSE,
      });
    }
    return;
  }

  if (payload.event === 'media_src' && isBlobUrl(payload.url)) {
    const backingCandidate = candidateFromRecentMedia(state, frameUrl, String(payload.url || payload.blobUrl || ''));
    if (!backingCandidate) {
      return;
    }

    await recordDetectedMediaCandidate(tabId, {
      ...backingCandidate,
      posterUrl: payload.posterUrl || backingCandidate.posterUrl,
      frameUrl,
      mimeFromMSE: state.lastMseMimeByFrame.get(frameUrl) || backingCandidate.mimeFromMSE,
    }, 'page', pageUrl);
    return;
  }

  if (payload.url) {
    await recordDetectedMediaCandidate(tabId, {
      ...payload,
      mimeFromMSE: payload.mimeFromMSE || state.lastMseMimeByFrame.get(frameUrl) || '',
      frameUrl,
    }, payload.event === 'scan' ? 'scan' : 'page', pageUrl);
  }
}

async function getActiveTab() {
  const tabs = await browserApi.tabs.query({ active: true, currentWindow: true });
  return tabs[0] ?? null;
}

async function ensureContentScript(tabId: number) {
  try {
    await browserApi.tabs.sendMessage(tabId, { type: 'PING_TUYULDM_CONTENT' });
    return true;
  } catch {
    const files = getContentScriptFiles();
    if (files.length === 0) {
      return false;
    }

    try {
      await browserApi.scripting.executeScript({
        target: { tabId, allFrames: true },
        files,
      });
      await browserApi.tabs.sendMessage(tabId, { type: 'PING_TUYULDM_CONTENT' });
      return true;
    } catch (error) {
      console.warn('Failed to ensure content script:', error);
      return false;
    }
  }
}

async function sendMessageToTab(tabId: number, message: Record<string, unknown>) {
  const ready = await ensureContentScript(tabId);
  if (!ready) {
    return null;
  }

  return browserApi.tabs.sendMessage(tabId, message);
}

async function sendMessageToFrame(tabId: number, frameId: number, message: Record<string, unknown>) {
  const ready = await ensureContentScript(tabId);
  if (!ready) {
    return null;
  }

  return browserApi.tabs.sendMessage(tabId, message, { frameId });
}

async function showDetectedStreamOverlay(tabId: number, url: string, manifestType: string, schedule?: OverlayDownloadSchedule) {
  try {
    await sendMessageToTab(tabId, {
      type: 'SHOW_VIDEO_OVERLAY',
      url,
      manifestType,
      schedule,
    });
  } catch (error) {
    console.warn('Failed to show video overlay:', error);
  }
}

async function scanTabForVideos(tabId: number) {
  try {
    const frames = await browserApi.webNavigation.getAllFrames({ tabId }).catch(() => [{ frameId: 0 }]);
    const results = await Promise.all((frames || [{ frameId: 0 }]).map((frame: any) =>
      sendMessageToFrame(tabId, Number(frame?.frameId ?? 0), { type: 'SCAN_PAGE' }).catch(() => null)));
    return results.flatMap((response: any) => Array.isArray(response?.candidates) ? response.candidates : []);
  } catch (error) {
    console.warn('Failed to scan tab for videos:', error);
    return [];
  }
}

async function refreshDetectedMediaFromPage(tabId: number, pageUrl = '') {
  const results = await scanTabForVideos(tabId);
  await Promise.all(results.map((entry: any) => handlePageHookPayload(tabId, entry, pageUrl)));
  return getDetectedMedia(tabId);
}

function normalizeList(value: unknown) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    return value.split(/[\n,]/);
  }
  return [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeExtension(value: unknown) {
  return String(value ?? '').trim().toLowerCase().replace(/^\./, '');
}

function normalizeDomain(value: unknown) {
  return String(value ?? '').trim().toLowerCase().replace(/^\*\./, '').replace(/^\./, '');
}

function normalizeScheduleHour(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.min(23, Math.max(0, Math.round(numeric)));
}

function normalizeScheduleDay(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.min(6, Math.max(0, Math.round(numeric)));
}

function normalizeScheduleDays(value: unknown) {
  if (!Array.isArray(value)) {
    return [...DEFAULT_INTERCEPTION_SETTINGS.scheduleDays];
  }

  const normalized = [...new Set(value.map((entry) => normalizeScheduleDay(entry)))].sort((left, right) => left - right);
  if (normalized.length === 0) {
    return [...DEFAULT_INTERCEPTION_SETTINGS.scheduleDays];
  }
  return normalized;
}

function normalizeInterceptionSettings(raw: Record<string, unknown> = {}) {
  const minFileSizeMB = Number.isFinite(Number(raw.minFileSizeMB))
    ? Math.max(0, Number(raw.minFileSizeMB))
    : DEFAULT_INTERCEPTION_SETTINGS.minFileSizeMB;

  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_INTERCEPTION_SETTINGS.enabled,
    extensions: uniqueStrings(normalizeList(raw.extensions).map(normalizeExtension)),
    minFileSizeMB,
    allowDomains: uniqueStrings(normalizeList(raw.allowDomains).map(normalizeDomain)),
    blockDomains: uniqueStrings(normalizeList(raw.blockDomains).map(normalizeDomain)),
    autoShowDetectedStreams: typeof raw.autoShowDetectedStreams === 'boolean'
      ? raw.autoShowDetectedStreams
      : DEFAULT_INTERCEPTION_SETTINGS.autoShowDetectedStreams,
    scheduleEnabled: typeof raw.scheduleEnabled === 'boolean' ? raw.scheduleEnabled : DEFAULT_INTERCEPTION_SETTINGS.scheduleEnabled,
    scheduleStartHour: normalizeScheduleHour(raw.scheduleStartHour ?? DEFAULT_INTERCEPTION_SETTINGS.scheduleStartHour),
    scheduleEndHour: normalizeScheduleHour(raw.scheduleEndHour ?? DEFAULT_INTERCEPTION_SETTINGS.scheduleEndHour),
    scheduleDays: normalizeScheduleDays(raw.scheduleDays ?? DEFAULT_INTERCEPTION_SETTINGS.scheduleDays),
  };
}

function buildInterceptionSchedule(settings: ReturnType<typeof normalizeInterceptionSettings>) {
  if (!settings.scheduleEnabled) {
    return undefined;
  }

  return {
    start_hour: settings.scheduleStartHour,
    end_hour: settings.scheduleEndHour,
    days: [...settings.scheduleDays],
  };
}

async function getInterceptionSettings() {
  const stored = await browserApi.storage.local.get(SETTINGS_KEY);
  return normalizeInterceptionSettings(stored?.[SETTINGS_KEY] ?? DEFAULT_INTERCEPTION_SETTINGS);
}

async function saveInterceptionSettings(nextSettings: Record<string, unknown>) {
  const normalized = normalizeInterceptionSettings(nextSettings);
  await browserApi.storage.local.set({ [SETTINGS_KEY]: normalized });
  return normalized;
}

function hostnameMatches(hostname: string, patterns: string[]) {
  return patterns.some((pattern) => hostname === pattern || hostname.endsWith(`.${pattern}`));
}

function getFileExtension(url: string) {
  try {
    const pathname = new URL(url).pathname;
    const lastSegment = pathname.split('/').pop() || '';
    const dotIndex = lastSegment.lastIndexOf('.');
    return dotIndex >= 0 ? normalizeExtension(lastSegment.slice(dotIndex + 1)) : '';
  } catch {
    return '';
  }
}

function getOriginPattern(url: string) {
  try {
    return `${new URL(url).origin}/*`;
  } catch {
    return null;
  }
}

async function ensureOriginPermission(url: string) {
  const originPattern = getOriginPattern(url);
  if (!originPattern) {
    return false;
  }

  const hasPermission = await browserApi.permissions.contains({ origins: [originPattern] });
  if (hasPermission) {
    return true;
  }

  try {
    return await browserApi.permissions.request({ origins: [originPattern] });
  } catch (error) {
    console.warn('Origin permission request failed:', error);
    return false;
  }
}

async function hasOriginPermission(url: string) {
  const originPattern = getOriginPattern(url);
  if (!originPattern) {
    return false;
  }

  return browserApi.permissions.contains({ origins: ['<all_urls>'] })
    || browserApi.permissions.contains({ origins: [originPattern] });
}

browserApi.runtime.onInstalled?.addListener((details: any) => {
  if (details?.reason === 'install') {
    void browserApi.storage.local.remove(PERMISSION_ONBOARDING_DISMISSED_KEY).catch(() => {
      // Ignore storage cleanup errors on first install.
    });
  }
});

function shouldInterceptDownload(item: any, settings: ReturnType<typeof normalizeInterceptionSettings>) {
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
    if (minimumBytes > 0 && typeof item.totalBytes === 'number' && item.totalBytes > 0 && item.totalBytes < minimumBytes) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function getDownloadFilename(item: any) {
  const existingName = item.filename?.split(/[\\/]/).pop();
  if (existingName) {
    return existingName;
  }

  try {
    const lastSegment = new URL(item.url).pathname.split('/').pop();
    return lastSegment || `Download_${Date.now()}`;
  } catch {
    return `Download_${Date.now()}`;
  }
}

function requestKey(url: string) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
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

function captureRequestHeaders(details: any) {
  pruneCapturedHeaders();
  const captured: Record<string, string> = {};

  for (const header of details.requestHeaders ?? []) {
    const canonicalName = FORWARDED_HEADERS.get(header.name.toLowerCase());
    if (!canonicalName || typeof header.value !== 'string') {
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

function getCapturedRequestHeaders(url: string) {
  pruneCapturedHeaders();
  const entry = recentRequestHeaders.get(requestKey(url));
  return entry?.headers ? { ...entry.headers } : {};
}

async function getCookiesForUrl(url: string) {
  try {
    const cookies = await browserApi.cookies.getAll({ url });
    return cookies.map(({ name, value, domain, path }: any) => ({
      name,
      value,
      domain,
      path,
    }));
  } catch (error) {
    console.warn('Failed to collect cookies for', url, error);
    return [];
  }
}

async function buildForwardedRequestContext(url: string, referer = '') {
  const headers = getCapturedRequestHeaders(url);
  if (referer) {
    headers.Referer = referer;
  }
  if (!headers['User-Agent'] && navigator.userAgent) {
    headers['User-Agent'] = navigator.userAgent;
  }

  const cookies = await getCookiesForUrl(url);
  if (cookies.length === 0 && await hasOriginPermission(url)) {
    console.warn('0 cookies forwarded for request context:', url, Object.keys(headers));
  }

  return {
    headers,
    cookies,
  };
}

function handleHostResponse(response: any) {
  if (response?.id && pendingRequests.has(response.id)) {
    const pendingRequest = pendingRequests.get(response.id)!;
    pendingRequests.delete(response.id);

    if (response.status === 'error') {
        const hostError = new Error(response.message || 'Native host request failed') as Error & { code?: string; payload?: any };
        if (response?.payload && typeof response.payload === 'object') {
          hostError.payload = response.payload;
          if (typeof response.payload.code === 'string') {
            hostError.code = response.payload.code;
          }
        }
        pendingRequest.reject(hostError);
    } else {
      pendingRequest.resolve(response);
    }
  }

  if (response?.message === 'download.progressUpdate') {
    const payload = response.payload;
    broadcastRuntimeMessage({ type: 'PROGRESS_UPDATE', payload });

    if (payload?.id) {
      if (isActiveDownloadStatus(payload.status)) {
        activeDownloads.add(String(payload.id));
      } else {
        activeDownloads.delete(String(payload.id));
      }
    }
    return;
  }

  if (Array.isArray(response?.payload)) {
    syncActiveDownloadsFromList(response.payload);
    broadcastRuntimeMessage({ type: 'LIST_UPDATE', payload: response.payload });
    return;
  }

  if (response?.payload?.id && response?.payload?.status) {
    const payload = response.payload;
    broadcastRuntimeMessage({ type: 'PROGRESS_UPDATE', payload });

    if (isActiveDownloadStatus(payload.status)) {
      activeDownloads.add(String(payload.id));
    } else {
      activeDownloads.delete(String(payload.id));
    }
  }
}

function rejectPendingRequests(message: string) {
  for (const { reject } of pendingRequests.values()) {
    reject(new Error(message));
  }
  pendingRequests.clear();
}

function serializeRuntimeError(error: unknown) {
  const hostError = error as { code?: string; payload?: any } | null;
  const payload = hostError && typeof hostError === 'object' ? hostError.payload : undefined;
  const details = payload && typeof payload === 'object' && 'details' in payload ? payload.details : undefined;
  const code = typeof hostError?.code === 'string'
    ? hostError.code
    : payload && typeof payload === 'object' && typeof payload.code === 'string'
      ? payload.code
      : undefined;
  return {
    error: error instanceof Error ? error.message : String(error),
    code,
    details,
    status: hostStatus,
  };
}

function connectToHost() {
  if (port) {
    return true;
  }

  try {
    port = browserApi.runtime.connectNative(HOST_NAME);
    port.onMessage.addListener((response: any) => {
      handleHostResponse(response);
    });

    port.onDisconnect.addListener(() => {
      const lastError = browser.runtime.lastError?.message ?? 'Native host disconnected';
      port = null;
      activeDownloads.clear();
      updateHostStatus({ connected: false, lastError });
      rejectPendingRequests(lastError);
    });

    updateHostStatus({ connected: true, lastError: null });
    port.postMessage({ method: 'ping', params: { data: 'Hello from Chrome' }, id: 1 });
    void sendHostRequest('download.list').catch((error) => {
      console.warn('Failed to refresh downloads after host connect:', error);
    });

    return true;
  } catch (error) {
    console.error('Failed to connect to native host:', error);
    port = null;
    updateHostStatus({ connected: false, lastError: String(error) });
    return false;
  }
}

function sendHostRequest(method: string, params: Record<string, unknown> = {}) {
  if (!port && !connectToHost()) {
    return Promise.reject(new Error(hostStatus.lastError || 'Native host not connected'));
  }

  const id = nextRequestId++;
  return new Promise<any>((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    try {
      port!.postMessage({ method, params, id });
    } catch (error) {
      pendingRequests.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

async function interceptDownload(item: any) {
  if (item.byExtensionId === browser.runtime.id) {
    return;
  }

  const settings = await getInterceptionSettings();
  if (!shouldInterceptDownload(item, settings)) {
    return;
  }

  const permissionGranted = await ensureOriginPermission(item.url);
  if (!permissionGranted) {
    console.warn('Skipping interception because the origin permission was not granted:', item.url);
    return;
  }

  const requestContext = await buildForwardedRequestContext(item.url, item.referrer);
  try {
    await sendHostRequest('download.add', {
      url: item.url,
      filename: getDownloadFilename(item),
      schedule: buildInterceptionSchedule(settings),
      headers: requestContext.headers,
      cookies: requestContext.cookies,
    });
  } catch (error) {
    console.error('Failed to hand off download to native host:', error);
    return;
  }

  try {
    await browserApi.downloads.cancel(item.id);
  } catch (error) {
    console.warn('Failed to cancel browser download:', error);
  }
}

async function startDetectedMediaDownload(tabId: number, entryId: string, selectedVariantId = '') {
  const state = detectedMediaByTab.get(tabId);
  const entry = state?.entries.find((candidate) => candidate.id === entryId);
  if (!entry) {
    throw new Error('Detected media entry no longer exists');
  }
  if (entry.protected) {
    throw new Error(entry.protectedReason || 'Encrypted (DRM) media cannot be downloaded');
  }

  const requestContext = await buildForwardedRequestContext(entry.url, entry.pageUrl);
  const settings = await getInterceptionSettings();
  if (entry.kind === 'progressive_mp4') {
    const fileExtension = getFileExtension(entry.url) || (entry.label.toLowerCase().includes('webm') ? 'webm' : 'mp4');
    await sendHostRequest('download.add', {
      url: entry.url,
      filename: `Media_${Date.now()}.${fileExtension}`,
      schedule: buildInterceptionSchedule(settings),
      headers: requestContext.headers,
      cookies: requestContext.cookies,
    });
    return;
  }

  if (!entry.manifestType) {
    throw new Error('Detected media is not downloadable yet');
  }

  await sendHostRequest('download.video', {
    url: entry.url,
    filename: `Video_${Date.now()}.mp4`,
    manifestType: entry.manifestType,
    selectedVariantId: selectedVariantId || entry.selectedVariantId,
    schedule: buildInterceptionSchedule(settings),
    headers: requestContext.headers,
    cookies: requestContext.cookies,
  });
}

connectToHost();

browserApi.tabs.onRemoved.addListener((tabId: number) => {
  detectedMediaByTab.delete(tabId);
});

browserApi.tabs.onActivated?.addListener((details: any) => {
  if (details?.tabId != null) {
    void updateActionBadge(details.tabId).catch(() => {
      // Ignore badge update failures.
    });
  }
});

browserApi.webRequest.onSendHeaders.addListener(
  (details: any) => {
    captureRequestHeaders(details);
  },
  { urls: ['<all_urls>'] },
  SEND_HEADERS_EXTRA_INFO,
);

browserApi.webRequest.onHeadersReceived.addListener(
  (details: any) => {
    if (details.tabId < 0) {
      return;
    }

    const responseHeaders: Record<string, string> = {};
    for (const header of details.responseHeaders ?? []) {
      if (typeof header?.name === 'string' && typeof header?.value === 'string') {
        responseHeaders[header.name] = header.value;
      }
    }

    void recordDetectedMediaCandidate(details.tabId, {
      url: details.url,
      frameUrl: typeof details.documentUrl === 'string' ? details.documentUrl : '',
      contentType: responseHeaders['Content-Type'] || responseHeaders['content-type'] || '',
      responseHeaders,
      requestHeaders: getCapturedRequestHeaders(details.url),
    }, 'network', typeof details.documentUrl === 'string' ? details.documentUrl : '');
  },
  { urls: ['<all_urls>'], types: ['xmlhttprequest', 'media', 'other', 'sub_frame', 'object', 'main_frame'] },
  ['responseHeaders'],
);

browserApi.webNavigation.onCommitted.addListener((details: any) => {
  if (details.frameId !== 0 || details.tabId < 0) {
    return;
  }

  detectedMediaByTab.set(details.tabId, createTabDetectionState(typeof details.url === 'string' ? details.url : ''));
  void updateActionBadge(details.tabId).catch(() => {
    // Ignore badge update failures.
  });
});

browserApi.webNavigation.onCompleted.addListener((details: any) => {
  if (details.frameId !== 0 || details.tabId < 0) {
    return;
  }

  void refreshDetectedMediaFromPage(details.tabId, typeof details.url === 'string' ? details.url : '')
    .catch((error: unknown) => {
      console.warn('Active-tab media scan failed:', error);
    });
});

browserApi.runtime.onMessage.addListener(((message: any, sender: any, sendResponse: (response?: any) => void) => {
  if (message.type === 'PAGE_HOOK_EVENT') {
    const tabId = sender?.tab?.id;
    if (typeof tabId !== 'number') {
      return false;
    }

    const pageUrl = typeof sender?.tab?.url === 'string' ? sender.tab.url : '';
    void handlePageHookPayload(tabId, message.payload ?? {}, pageUrl).catch((error) => {
      console.warn('Failed to process page hook payload:', error);
    });
    return false;
  }

  if (message.type === 'INSPECT_VIDEO_MANIFEST') {
    buildForwardedRequestContext(message.url, String(message.pageUrl || ''))
      .then((requestContext) => sendHostRequest('video.inspect', {
        url: message.url,
        manifestType: message.manifestType,
        selectedVariantId: message.selectedVariantId,
        headers: requestContext.headers,
        cookies: requestContext.cookies,
      }))
      .then((response) => sendResponse(response.payload || { variants: [] }))
      .catch((error) => sendResponse({ error: String(error), variants: [] }));
    return true;
  }

  if (message.type === 'GET_INTERCEPTION_SETTINGS') {
    getInterceptionSettings()
      .then((settings) => sendResponse({ settings }))
      .catch((error) => sendResponse({ error: String(error) }));
    return true;
  }

  if (message.type === 'GET_PERMISSION_STATUS') {
    getPermissionStatus()
      .then((status) => sendResponse({ status }))
      .catch((error) => sendResponse({ error: String(error), status: null }));
    return true;
  }

  if (message.type === 'REQUEST_ALL_URLS_PERMISSION') {
    browserApi.permissions.request({ origins: ['<all_urls>'] })
      .then(async (granted: boolean) => {
        if (granted) {
          await setPermissionOnboardingDismissed(true);
        }
        return { granted, status: await broadcastPermissionStatus() };
      })
      .then((result: any) => sendResponse(result))
      .catch((error: unknown) => sendResponse({ error: String(error), granted: false, status: null }));
    return true;
  }

  if (message.type === 'REQUEST_CURRENT_TAB_PERMISSION') {
    getPermissionStatus()
      .then(async (status) => {
        if (!status.currentOriginPattern || !status.canRequestCurrentOrigin) {
          return { granted: false, status };
        }
        const granted = await browserApi.permissions.request({ origins: [status.currentOriginPattern] });
        return { granted, status: await broadcastPermissionStatus() };
      })
      .then((result: any) => sendResponse(result))
      .catch((error: unknown) => sendResponse({ error: String(error), granted: false, status: null }));
    return true;
  }

  if (message.type === 'DISMISS_PERMISSION_ONBOARDING') {
    setPermissionOnboardingDismissed(true)
      .then(() => broadcastPermissionStatus())
      .then((status) => sendResponse({ status }))
      .catch((error) => sendResponse({ error: String(error), status: null }));
    return true;
  }

  if (message.type === 'REVOKE_GRANTED_PERMISSION') {
    const origin = String(message.origin || '').trim();
    if (!origin) {
      sendResponse({ error: 'origin is required', status: null });
      return false;
    }

    browserApi.permissions.remove({ origins: [origin] })
      .then(async () => ({ status: await broadcastPermissionStatus() }))
      .then((result: any) => sendResponse(result))
      .catch((error: unknown) => sendResponse({ error: String(error), status: null }));
    return true;
  }

  if (message.type === 'GET_DETECTED_STREAMS') {
    getActiveTab()
      .then((tab) => sendResponse({ streams: tab?.id != null ? getDetectedMedia(tab.id) : [] }))
      .catch((error) => sendResponse({ error: String(error), streams: [] }));
    return true;
  }

	if (message.type === 'GET_ACTIVE_TAB_URL') {
		getActiveTab()
			.then((tab) => sendResponse({ url: typeof tab?.url === 'string' ? tab.url : '' }))
			.catch((error) => sendResponse({ error: String(error), url: '' }));
		return true;
	}

  if (message.type === 'SCAN_PAGE' || message.type === 'SCAN_PAGE_VIDEOS') {
    getActiveTab()
      .then(async (tab) => {
        if (!tab?.id) {
          return { streams: [] };
        }
        const streams = await refreshDetectedMediaFromPage(tab.id, typeof tab.url === 'string' ? tab.url : '');
        return { streams };
      })
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ error: String(error), streams: [] }));
    return true;
  }

  if (message.type === 'SHOW_DETECTED_STREAM_OVERLAY') {
    getActiveTab()
      .then(async (tab) => {
        if (!tab?.id) {
          return { error: 'Active tab unavailable' };
        }

        const settings = await getInterceptionSettings();
        await showDetectedStreamOverlay(tab.id, String(message.url || ''), String(message.manifestType || ''), buildInterceptionSchedule(settings));
        return { ok: true };
      })
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ error: String(error) }));
    return true;
  }

  if (message.type === 'UPDATE_INTERCEPTION_SETTINGS') {
    saveInterceptionSettings(message.settings ?? {})
      .then((settings) => {
        broadcastRuntimeMessage({
          type: 'INTERCEPTION_SETTINGS_UPDATED',
          payload: settings,
        });
        sendResponse({ settings });
      })
      .catch((error) => sendResponse({ error: String(error) }));
    return true;
  }

  if (message.type === 'GET_HOST_STATUS') {
    sendResponse({ status: hostStatus });
    return false;
  }

  if (message.type === 'GET_HOST_STATS') {
    sendHostRequest('host.getStats')
      .then((response) => sendResponse({ stats: response.payload, status: hostStatus }))
      .catch((error) => sendResponse({
        error: String(error),
        stats: { globalSpeedBytesPerSecond: 0, freeSpaceBytes: 0, activeDownloads: 0 },
        status: hostStatus,
      }));
    return true;
  }

  if (message.type === 'GET_HOST_SETTINGS') {
    sendHostRequest('host.getSettings')
      .then((response) => sendResponse({ settings: response.payload, status: hostStatus }))
      .catch((error) => sendResponse({ error: String(error), settings: null, status: hostStatus }));
    return true;
  }

  if (message.type === 'UPDATE_HOST_SETTINGS') {
    sendHostRequest('host.setSettings', message.settings ?? {})
      .then((response) => {
        broadcastRuntimeMessage({
          type: 'HOST_SETTINGS_UPDATED',
          payload: response.payload,
        });
        sendResponse({ settings: response.payload, status: hostStatus });
      })
      .catch((error) => sendResponse({ error: String(error), settings: null, status: hostStatus }));
    return true;
  }

  if (message.type === 'OPEN_LOGS') {
    sendHostRequest('host.openLogs')
      .then((response) => sendResponse({ result: response.payload, status: hostStatus }))
      .catch((error) => sendResponse({ error: String(error), status: hostStatus }));
    return true;
  }

  if (message.type === 'OPEN_DOWNLOAD_FILE') {
    sendHostRequest('host.openFile', { id: String(message.id) })
      .then((response) => sendResponse({ path: response.payload?.path, status: hostStatus }))
      .catch((error) => sendResponse({ error: String(error), status: hostStatus }));
    return true;
  }

  if (message.type === 'REVEAL_DOWNLOAD_IN_FOLDER') {
    sendHostRequest('host.revealInFolder', { id: String(message.id) })
      .then((response) => sendResponse({ path: response.payload?.path, status: hostStatus }))
      .catch((error) => sendResponse({ error: String(error), status: hostStatus }));
    return true;
  }

  if (message.type === 'PICK_DOWNLOAD_DIRECTORY') {
    sendHostRequest('host.pickDirectory', { initial: String(message.initial || '') })
      .then((response) => sendResponse({ path: response.payload?.path || '', status: hostStatus }))
      .catch((error) => sendResponse({ error: String(error), status: hostStatus }));
    return true;
  }

  if (message.type === 'START_VIDEO_DOWNLOAD') {
    Promise.all([buildForwardedRequestContext(message.url), getInterceptionSettings()])
      .then(([requestContext, settings]) => sendHostRequest('download.video', {
        url: message.url,
        filename: `Video_${Date.now()}.mp4`,
        manifestType: message.manifestType,
        selectedVariantId: message.selectedVariantId,
        schedule: message.schedule ?? buildInterceptionSchedule(settings),
        headers: requestContext.headers,
        cookies: requestContext.cookies,
      }))
      .catch((error) => console.error('Failed to start video download:', error));
    return false;
  }

  if (message.type === 'START_DETECTED_MEDIA_DOWNLOAD') {
    getActiveTab()
      .then(async (tab) => {
        if (!tab?.id) {
          throw new Error('Active tab unavailable');
        }
        await startDetectedMediaDownload(tab.id, String(message.id || ''), String(message.selectedVariantId || ''));
        return { ok: true };
      })
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ error: String(error) }));
    return true;
  }

  if (message.type === 'START_DOWNLOAD') {
    const filename = message.url.substring(message.url.lastIndexOf('/') + 1) || `Download_${Date.now()}`;
    buildForwardedRequestContext(message.url)
      .catch((error) => {
        console.warn('Failed to collect request context for manual download:', error);
        return {
          headers: {},
          cookies: [],
        };
      })
      .then((requestContext) => sendHostRequest('download.add', {
        url: message.url,
        filename,
        segments: message.segments || 8,
        schedule: message.schedule,
        headers: requestContext.headers,
        cookies: requestContext.cookies,
      }))
      .catch((error) => console.error('Failed to start manual download:', error));
    return false;
  }

  if (message.type === 'PAUSE_DOWNLOAD') {
    void sendHostRequest('download.pause', { id: String(message.id) }).catch((error) => console.error('Failed to pause download:', error));
    return false;
  }

  if (message.type === 'RESUME_DOWNLOAD') {
    void sendHostRequest('download.resume', { id: String(message.id) }).catch((error) => console.error('Failed to resume download:', error));
    return false;
  }

  if (message.type === 'REFRESH_DOWNLOAD_URL') {
    sendHostRequest('download.refreshUrl', {
      id: String(message.id),
      url: String(message.url || ''),
      force: !!message.force,
      restartFromScratch: !!message.restartFromScratch,
    })
      .then((response) => sendResponse({ ok: true, download: response.payload, status: hostStatus }))
      .catch((error) => sendResponse(serializeRuntimeError(error)));
    return true;
  }

  if (message.type === 'REMOVE_DOWNLOAD') {
    sendHostRequest('download.remove', {
      id: String(message.id),
      deleteFile: !!message.deleteFile,
    })
      .then(() => {
        activeDownloads.delete(String(message.id));
        return sendHostRequest('download.list');
      })
      .then(() => sendResponse({ ok: true, status: hostStatus }))
      .catch((error) => sendResponse({ error: String(error), status: hostStatus }));
    return true;
  }

  if (message.type === 'PAUSE_ALL_DOWNLOADS') {
    void sendHostRequest('download.pauseAll')
      .then(() => sendHostRequest('download.list'))
      .catch((error) => console.error('Failed to pause all downloads:', error));
    return false;
  }

  if (message.type === 'RESUME_ALL_DOWNLOADS') {
    void sendHostRequest('download.resumeAll')
      .then(() => sendHostRequest('download.list'))
      .catch((error) => console.error('Failed to resume all downloads:', error));
    return false;
  }

  if (message.type === 'GET_DOWNLOADS') {
    void sendHostRequest('download.list').catch((error) => console.error('Failed to list downloads:', error));
    return false;
  }

  return false;
}) as any);

browserApi.downloads.onCreated.addListener((item: any) => {
  console.log('Download observed:', item.url);
  void interceptDownload(item);
});