export type ActionType = 'RefreshFromCurrentTab' | 'OpenAdapterSettings' | 'OpenPermissionsSettings' | 'RetryDownload' | 'OpenDocs';

export interface RecoveryAction {
  type: ActionType;
  label: string;
  url?: string;
}

export interface MessageResult {
  title: string;
  body?: string;
  recovery?: RecoveryAction;
}

export function errorMessage(code?: string, context?: any): MessageResult {
  switch (code) {
    case 'url_expired':
    case 'manifest_expired':
    case 'awaiting_url_refresh':
      return { 
        title: 'URL Expired', 
        body: 'The download link has expired. Refresh from the source page.',
        recovery: { type: 'RefreshFromCurrentTab', label: 'Refresh from current tab' }
      };
    default:
      return { title: 'Download Error', body: code || 'Unknown error' };
  }
}

export function refusalMessage(reason?: string, context?: any): MessageResult {
  switch (reason) {
    case 'url_expired':
    case 'manifest_expired':
    case 'awaiting_url_refresh':
      return { 
        title: 'URL Expired', 
        body: 'The download link has expired. Refresh from the source page.',
        recovery: { type: 'RefreshFromCurrentTab', label: 'Refresh from current tab' }
      };
    case 'drm_detected':
    case 'encrypted_hls':
    case 'unsupported_protected':
      return { 
        title: 'Encrypted (DRM)', 
        body: 'TuyulDM cannot download DRM protected content.', 
        recovery: { type: 'OpenDocs', label: 'Documentation', url: 'https://github.com/tuyuldm/tuyuldm' } 
      };
    case 'site_adapter_failed':
      return { 
        title: 'Site adapter failed', 
        recovery: { type: 'OpenAdapterSettings', label: 'Open adapter settings' } 
      };
    default:
      return { title: 'Failed to extract', body: reason };
  }
}
