// Minimal classname joiner. No clsx dep — keeps primitive layer self-contained.
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
