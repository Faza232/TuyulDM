// Central human-readable copy for engine errors and refusals (Phase AE).
// UI never renders raw codes; it routes them through here.

export type RecoveryAction =
  | { kind: 'RefreshFromCurrentTab' }
  | { kind: 'OpenAdapterSettings' }
  | { kind: 'OpenPermissionsSettings' }
  | { kind: 'RetryDownload' }
  | { kind: 'OpenDocs'; url: string };

export interface UiMessage {
  title: string;
  body: string;
  recovery?: RecoveryAction;
}

const DOCS_BASE = 'https://github.com/husainfaza/TuyulDM#troubleshooting';

const ERROR_TABLE: Record<string, UiMessage> = {
  drm_detected: {
    title: 'Protected by DRM',
    body: 'This stream is encrypted with DRM and cannot be downloaded.',
    recovery: { kind: 'OpenDocs', url: `${DOCS_BASE}-drm` },
  },
  encrypted_hls: {
    title: 'Encrypted HLS stream',
    body: 'The HLS manifest uses key-based encryption that is not supported.',
    recovery: { kind: 'OpenDocs', url: `${DOCS_BASE}-encrypted-hls` },
  },
  unsupported_site_strategy: {
    title: 'Site not supported',
    body: 'No extraction strategy matched this site.',
    recovery: { kind: 'OpenDocs', url: DOCS_BASE },
  },
  site_adapter_failed: {
    title: 'Site adapter failed',
    body: 'The site adapter could not resolve a downloadable URL.',
    recovery: { kind: 'OpenAdapterSettings' },
  },
  manifest_expired: {
    title: 'Link expired',
    body: 'The media URL expired. Refresh it from the source page to resume.',
    recovery: { kind: 'RefreshFromCurrentTab' },
  },
  url_expired: {
    title: 'Link expired',
    body: 'The download URL expired. Refresh it from the source page to resume.',
    recovery: { kind: 'RefreshFromCurrentTab' },
  },
  network_unreachable: {
    title: 'Network unreachable',
    body: 'Could not reach the server. Check your connection and retry.',
    recovery: { kind: 'RetryDownload' },
  },
  disk_full: {
    title: 'Disk full',
    body: 'Not enough free space to finish this download.',
  },
  host_unreachable: {
    title: 'Native host offline',
    body: 'The TuyulDM native host is not responding. Restart it and retry.',
    recovery: { kind: 'RetryDownload' },
  },
  permission_denied: {
    title: 'Permission needed',
    body: 'Grant site access so TuyulDM can read this media.',
    recovery: { kind: 'OpenPermissionsSettings' },
  },
  unsupported_container: {
    title: 'Unsupported container',
    body: 'The output container could not be assembled.',
    recovery: { kind: 'OpenDocs', url: DOCS_BASE },
  },
};

const REFUSAL_TABLE: Record<string, UiMessage> = {
  drm_detected: ERROR_TABLE.drm_detected,
  encrypted_hls: ERROR_TABLE.encrypted_hls,
  unsupported_site_strategy: ERROR_TABLE.unsupported_site_strategy,
  site_adapter_failed: ERROR_TABLE.site_adapter_failed,
};

export function errorMessage(code: string | undefined): UiMessage {
  if (!code) return { title: 'Download failed', body: 'An unknown error occurred.', recovery: { kind: 'RetryDownload' } };
  return ERROR_TABLE[code] || { title: 'Download failed', body: code, recovery: { kind: 'RetryDownload' } };
}

export function refusalMessage(reason: string | undefined): UiMessage {
  if (!reason) return { title: 'Refused', body: 'This media cannot be downloaded.' };
  return REFUSAL_TABLE[reason] || { title: 'Refused', body: reason };
}

export function recoveryLabel(action: RecoveryAction | undefined): string | null {
  if (!action) return null;
  switch (action.kind) {
    case 'RefreshFromCurrentTab': return 'Refresh from current tab';
    case 'OpenAdapterSettings': return 'Open adapter settings';
    case 'OpenPermissionsSettings': return 'Open permissions';
    case 'RetryDownload': return 'Retry';
    case 'OpenDocs': return 'Open documentation';
  }
}
