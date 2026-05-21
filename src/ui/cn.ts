export type ClassValue =
  | string
  | number
  | false
  | null
  | undefined
  | ClassValue[]
  | Record<string, boolean | null | undefined>;

function push(out: string[], value: ClassValue): void {
  if (!value && value !== 0) return;
  if (typeof value === 'string' || typeof value === 'number') {
    out.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) push(out, v);
    return;
  }
  if (typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (value[key]) out.push(key);
    }
  }
}

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  for (const input of inputs) push(out, input);
  return out.join(' ');
}
