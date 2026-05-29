import type { ReactNode } from 'react';

export function SectionHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return (
    <div className="mb-5">
      <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-text-dim)]">{eyebrow}</p>
      <h2 className="text-[16px] font-semibold text-[var(--color-text)] mt-0.5">{title}</h2>
      {description && <p className="text-[12px] text-[var(--color-text-muted)] mt-1">{description}</p>}
    </div>
  );
}

export function SettingRow({ label, description, control, htmlFor }: { label: string; description?: string; control: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex items-start justify-between gap-6 py-3 border-b border-[var(--color-border-subtle)]">
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="text-[13px] text-[var(--color-text)]">{label}</label>
        {description && <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5">{description}</p>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

// A section declares its searchable terms so the options search can filter it.
export type SectionMeta = { id: string; label: string; keywords: string[] };
