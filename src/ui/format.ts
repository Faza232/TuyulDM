import type { DownloadItem, DetectedStreamItem, VariantInfo } from '../state/types';
import { normalizeScheduleHour } from '../state/normalize';

export function formatSize(bytes: number | string): string {
  if (typeof bytes === 'string') return bytes;
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function formatSpeed(bytesPerSecond: number) {
  return `${formatSize(bytesPerSecond)}/s`;
}

export function formatDownloadSpeed(d: DownloadItem): string {
  if (d.status === 'muxing') return 'Muxing';
  if (d.status === 'awaiting_url_refresh' || d.error_code === 'url_expired') return 'Awaiting refresh';
  const raw = Number(d.speed_bytes_per_second ?? 0);
  if (Number.isFinite(raw) && raw > 0) return formatSpeed(raw);
  return d.speed || '0 B/s';
}

export function formatAttemptTimestamp(value: string | undefined): string {
  if (!value) return 'unknown';
  const t = new Date(value);
  if (Number.isNaN(t.getTime())) return value;
  return t.toLocaleString();
}

export function formatDetectedTimestamp(value: number | undefined): string {
  if (!Number.isFinite(value) || !value) return 'just now';
  const t = new Date(value);
  if (Number.isNaN(t.getTime())) return 'just now';
  return t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function getDownloadLabel(d: DownloadItem): string {
  return d.name || d.filename || `Download ${d.id}`;
}

export function downloadNeedsUrlRefresh(d: DownloadItem): boolean {
  return d.status === 'awaiting_url_refresh' || d.error_code === 'url_expired';
}

export function isValidDownloadUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function getDownloadParentDirectory(outputPath: string | undefined): string {
  if (!outputPath) return '';
  const normalized = outputPath.replace(/[\\/]+$/, '');
  const sep = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  if (sep <= 0) return normalized;
  return normalized.slice(0, sep);
}

export function hostFromUrl(value: string | undefined): string {
  if (!value) return '';
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

export function formatVariantLabel(variant: VariantInfo | undefined): string {
  if (!variant) return 'Default quality';
  const parts = [
    variant.name,
    variant.resolution,
    Number.isFinite(variant.bandwidth) && variant.bandwidth ? `${Math.round((variant.bandwidth as number) / 1000)} kbps` : '',
  ].filter(Boolean);
  return parts.join(' · ') || 'Default quality';
}

export function formatDetectedMediaSource(source: DetectedStreamItem['source']): string {
  if (source === 'network') return 'network';
  if (source === 'scan') return 'scan';
  return 'page';
}

export function formatScheduleHour(hour: number) {
  return `${normalizeScheduleHour(hour).toString().padStart(2, '0')}:00`;
}

export function formatGrantedOrigin(origin: string) {
  return origin === '<all_urls>' ? 'All sites (<all_urls>)' : origin;
}

export function bytesPerSecondFromKilobytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 1024);
}

export function kilobytesPerSecondFromBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value / 1024);
}

export function buildSafeDebugSnapshot(d: DownloadItem) {
  return {
    id: d.id,
    name: d.name || d.filename,
    extraction_strategy: d.extraction_strategy,
    site_key: d.site_key,
    track_count: d.track_count,
    assembly_stage: d.assembly_stage,
    plan: d.plan,
    offer_debug: d.offer_debug,
    status: d.status,
    error_code: d.error_code,
  };
}
