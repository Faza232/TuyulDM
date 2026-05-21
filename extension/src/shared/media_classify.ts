export const PAGE_HOOK_MESSAGE_TYPE = 'TUYUL_PAGE_HOOK';
export const MEDIA_BUFFER_TTL_MS = 30_000;

export type ManifestType = 'HLS' | 'DASH';
export type MediaKind = 'manifest_hls' | 'manifest_dash' | 'segment_hls' | 'segment_dash' | 'progressive_mp4' | 'unknown';
export type DetectedMediaSource = 'network' | 'page' | 'scan';

export type VariantInfo = {
  id: string;
  name?: string;
  bandwidth?: number;
  resolution?: string;
  codecs?: string;
  url?: string;
};

export type DetectedMediaEntry = {
  id: string;
  url: string;
  kind: MediaKind;
  label: string;
  pageUrl: string;
  detectedAt: number;
  source: DetectedMediaSource;
  sizeHint?: number;
  manifestType?: ManifestType;
  qualities?: VariantInfo[];
  selectedVariantId?: string;
  posterUrl?: string;
  protected?: boolean;
  protectedReason?: string;
};

export type ExtractionStrategy =
  | 'direct_file'
  | 'progressive_stream'
  | 'hls_manifest'
  | 'dash_manifest'
  | 'mse_observed_manifest'
  | 'page_metadata'
  | 'site_adapter'
  | 'unsupported_protected';

export type MediaTrack = {
  id: string;
  kind: string;
  url?: string;
  manifest_url?: string;
  codec?: string;
  bitrate?: number;
  width?: number;
  height?: number;
  container?: string;
};

export type MediaEvidence = {
  candidateUrl?: string;
  contentType?: string;
  manifestType?: ManifestType;
  mimeFromMSE?: string;
  sawBlobPlayback?: boolean;
  sawRangeRequests?: boolean;
  hadAudioVideoTraffic?: boolean;
  topOrigin?: string;
};

export type MediaOffer = {
  id: string;
  page_url?: string;
  source_url: string;
  site_key?: string;
  title?: string;
  strategy: ExtractionStrategy;
  container?: string;
  mime_type?: string;
  needs_playback?: boolean;
  protected?: boolean;
  protected_reason?: string;
  expires_at?: string;
  tracks?: MediaTrack[];
  variants?: VariantInfo[];
  headers?: Record<string, string>;
  debug?: Record<string, string>;
};

export const STRATEGY_LABELS: Record<ExtractionStrategy, string> = {
  direct_file: 'Direct',
  progressive_stream: 'Progressive',
  hls_manifest: 'HLS',
  dash_manifest: 'DASH',
  mse_observed_manifest: 'Observed in player',
  page_metadata: 'Page metadata',
  site_adapter: 'Site adapter',
  unsupported_protected: 'Protected',
};

export function strategyAssemblyKind(strategy?: ExtractionStrategy | string | null): 'direct' | 'adaptive' | 'muxed' | 'protected' | 'unknown' {
  switch (strategy) {
    case 'direct_file':
    case 'progressive_stream':
      return 'direct';
    case 'hls_manifest':
    case 'mse_observed_manifest':
      return 'adaptive';
    case 'dash_manifest':
      return 'muxed';
    case 'page_metadata':
    case 'site_adapter':
      return 'adaptive';
    case 'unsupported_protected':
      return 'protected';
    default:
      return 'unknown';
  }
}

export type MediaCandidate = {
  url: string;
  frameUrl?: string;
  contentType?: string;
  mimeFromMSE?: string;
  sizeHint?: number;
  acceptRanges?: string;
  method?: string;
  status?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  posterUrl?: string;
  mediaId?: string;
  blobUrl?: string;
  counter?: number;
};

export type PageHookPayload = MediaCandidate & {
  event: 'fetch' | 'xhr' | 'mse' | 'blob_created' | 'media_src';
};

export type ScanPayload = MediaCandidate & {
  event: 'scan';
};

export type MediaClassification = {
  kind: MediaKind;
  manifestType?: ManifestType;
  label: string;
};

export type MediaClassificationOptions = {
  manifestByOrigin?: ReadonlyMap<string, ManifestType>;
};

const HLS_MIME_PATTERNS = ['application/vnd.apple.mpegurl', 'application/x-mpegurl'];
const DASH_MIME_PATTERNS = ['application/dash+xml'];
const MEDIA_EXTENSIONS = new Set(['m3u8', 'mpd', 'm4s', 'mp4', 'm4a', 'aac', 'ts', 'webm', 'mp3']);

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function lower(value: unknown) {
  return normalizeText(value).toLowerCase();
}

export function getHeader(headers: Record<string, string> | undefined, name: string) {
  if (!headers) {
    return '';
  }

  const needle = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === needle) {
      return normalizeText(value);
    }
  }
  return '';
}

export function normalizeMediaUrl(rawUrl: unknown) {
  const trimmed = normalizeText(rawUrl);
  if (!trimmed) {
    return '';
  }

  try {
    const parsed = new URL(trimmed);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return trimmed;
  }
}

export function getUrlOrigin(rawUrl: unknown) {
  try {
    return new URL(normalizeMediaUrl(rawUrl)).origin;
  } catch {
    return '';
  }
}

export function getUrlExtension(rawUrl: unknown) {
  try {
    const pathname = new URL(normalizeMediaUrl(rawUrl)).pathname.toLowerCase();
    const lastSegment = pathname.split('/').pop() || '';
    const dotIndex = lastSegment.lastIndexOf('.');
    return dotIndex >= 0 ? lastSegment.slice(dotIndex + 1) : '';
  } catch {
    return '';
  }
}

function parseMimeHintFromUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    const explicit = parsed.searchParams.get('mime') || parsed.searchParams.get('type');
    return explicit ? decodeURIComponent(explicit).toLowerCase() : '';
  } catch {
    return '';
  }
}

function deriveContentType(candidate: MediaCandidate) {
  return lower(candidate.contentType)
    || lower(getHeader(candidate.responseHeaders, 'content-type'))
    || lower(getHeader(candidate.requestHeaders, 'content-type'));
}

function deriveSizeHint(candidate: MediaCandidate) {
  const direct = Number(candidate.sizeHint);
  if (Number.isFinite(direct) && direct > 0) {
    return direct;
  }

  const fromHeader = Number(getHeader(candidate.responseHeaders, 'content-length'));
  return Number.isFinite(fromHeader) && fromHeader > 0 ? fromHeader : undefined;
}

function deriveAcceptRanges(candidate: MediaCandidate) {
  return lower(candidate.acceptRanges) || lower(getHeader(candidate.responseHeaders, 'accept-ranges'));
}

function hasByteRangeHint(candidate: MediaCandidate) {
  const requestRange = lower(getHeader(candidate.requestHeaders, 'range'));
  if (requestRange.includes('bytes=')) {
    return true;
  }

  try {
    const parsed = new URL(candidate.url);
    const urlRange = lower(parsed.searchParams.get('range'));
    return urlRange.includes('-');
  } catch {
    return false;
  }
}

function looksLikeMediaPath(rawUrl: string) {
  const lowered = rawUrl.toLowerCase();
  if (MEDIA_EXTENSIONS.has(getUrlExtension(rawUrl))) {
    return true;
  }
  return /(?:videoplayback|manifest|playlist|segment|chunk|stream|dash|hls|m3u8|mpd)/.test(lowered);
}

export function isBlobUrl(rawUrl: unknown) {
  return normalizeText(rawUrl).startsWith('blob:');
}

export function shouldReportMediaCandidate(candidate: Pick<MediaCandidate, 'url' | 'contentType' | 'mimeFromMSE' | 'requestHeaders' | 'responseHeaders'>) {
  const url = normalizeMediaUrl(candidate.url);
  if (!url) {
    return false;
  }

  const contentType = deriveContentType(candidate as MediaCandidate);
  const mimeFromMSE = lower(candidate.mimeFromMSE);
  if (contentType || mimeFromMSE) {
    if (contentType.startsWith('video/') || contentType.startsWith('audio/') || mimeFromMSE) {
      return true;
    }
    if (HLS_MIME_PATTERNS.some((pattern) => contentType.includes(pattern)) || DASH_MIME_PATTERNS.some((pattern) => contentType.includes(pattern))) {
      return true;
    }
  }

  return looksLikeMediaPath(url);
}

export function mediaIdForCandidate(kind: MediaKind, url: string) {
  return `${kind}:${normalizeMediaUrl(url)}`;
}

export function manifestTypeFromKind(kind: MediaKind): ManifestType | undefined {
  if (kind === 'manifest_hls' || kind === 'segment_hls') {
    return 'HLS';
  }
  if (kind === 'manifest_dash' || kind === 'segment_dash') {
    return 'DASH';
  }
  return undefined;
}

export function isManifestKind(kind: MediaKind) {
  return kind === 'manifest_hls' || kind === 'manifest_dash';
}

export function classifyMediaCandidate(candidate: MediaCandidate, options: MediaClassificationOptions = {}): MediaClassification {
  const url = normalizeMediaUrl(candidate.url);
  if (!url || isBlobUrl(url)) {
    return { kind: 'unknown', label: 'Unknown media' };
  }

  const extension = getUrlExtension(url);
  const contentType = deriveContentType(candidate);
  const mimeHint = lower(candidate.mimeFromMSE) || parseMimeHintFromUrl(url);
  const acceptRanges = deriveAcceptRanges(candidate);
  const sizeHint = deriveSizeHint(candidate);
  const originManifestType = options.manifestByOrigin?.get(getUrlOrigin(url));
  const byteRangeHint = hasByteRangeHint(candidate) || acceptRanges.includes('bytes');

  if (extension === 'm3u8' || HLS_MIME_PATTERNS.some((pattern) => contentType.includes(pattern))) {
    return { kind: 'manifest_hls', manifestType: 'HLS', label: 'HLS manifest' };
  }

  if (extension === 'mpd' || DASH_MIME_PATTERNS.some((pattern) => contentType.includes(pattern))) {
    return { kind: 'manifest_dash', manifestType: 'DASH', label: 'DASH manifest' };
  }

  const mediaMime = mimeHint || contentType;
  const looksLikeSegment = ['m4s', 'ts', 'aac'].includes(extension) || byteRangeHint;

  if (originManifestType === 'HLS' && looksLikeSegment) {
    return { kind: 'segment_hls', manifestType: 'HLS', label: 'HLS segments' };
  }

  if (originManifestType === 'DASH' && looksLikeSegment) {
    return { kind: 'segment_dash', manifestType: 'DASH', label: 'DASH segments' };
  }

  if (
    ['mp4', 'webm', 'm4a', 'mp3'].includes(extension)
    || mediaMime.startsWith('video/')
    || mediaMime.startsWith('audio/')
    || url.toLowerCase().includes('videoplayback')
  ) {
    if (originManifestType === 'HLS' && (looksLikeSegment || extension === 'mp4')) {
      return { kind: 'segment_hls', manifestType: 'HLS', label: 'HLS segments' };
    }

    if (originManifestType === 'DASH' && (looksLikeSegment || extension === 'mp4' || extension === 'webm')) {
      return { kind: 'segment_dash', manifestType: 'DASH', label: 'DASH segments' };
    }

    if (acceptRanges.includes('bytes') || sizeHint || extension === 'mp4' || extension === 'webm' || url.toLowerCase().includes('videoplayback')) {
      return { kind: 'progressive_mp4', label: mediaMime.includes('webm') || extension === 'webm' ? 'Direct WebM' : 'Direct MP4' };
    }
  }

  return { kind: 'unknown', label: 'Unknown media' };
}
