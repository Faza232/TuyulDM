import { useRef } from 'react';
import type { VariantInfo } from '../../../state/types';
import { cn } from '../../../ui/cn';

export type VariantPickerProps = {
  variants: VariantInfo[];
  selectedId: string;
  onSelect: (id: string) => void;
  onConfirm: (id: string) => void;
};

function variantLine(v: VariantInfo): string {
  return [
    v.resolution || v.name,
    Number.isFinite(v.bandwidth) && v.bandwidth ? `${Math.round((v.bandwidth as number) / 1000)} kbps` : '',
    v.codecs,
  ].filter(Boolean).join(' · ') || 'Default quality';
}

export function VariantPicker({ variants, selectedId, onSelect, onConfirm }: VariantPickerProps) {
  const ref = useRef<HTMLDivElement>(null);

  function onKeyDown(e: React.KeyboardEvent) {
    const idx = variants.findIndex((v) => v.id === selectedId);
    if (e.key === 'ArrowDown') { e.preventDefault(); onSelect(variants[Math.min(idx + 1, variants.length - 1)]?.id || selectedId); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); onSelect(variants[Math.max(idx - 1, 0)]?.id || selectedId); }
    else if (e.key === 'Enter') { e.preventDefault(); if (selectedId) onConfirm(selectedId); }
  }

  if (variants.length === 0) {
    return <p className="text-[12px] text-[var(--color-text-dim)]">Single quality stream.</p>;
  }

  return (
    <div ref={ref} role="listbox" tabIndex={0} onKeyDown={onKeyDown} className="space-y-1 outline-none">
      {variants.map((v) => {
        const active = v.id === selectedId;
        return (
          <button
            key={v.id}
            role="option"
            aria-selected={active}
            onClick={() => onSelect(v.id)}
            onDoubleClick={() => onConfirm(v.id)}
            className={cn(
              'flex items-center justify-between w-full px-2.5 h-9 rounded-[var(--radius-sm)] text-left border',
              active ? 'bg-[var(--color-surface-raised)] border-[var(--color-border)]' : 'border-transparent hover:bg-white/5',
            )}
          >
            <span className="font-mono text-[12px] text-[var(--color-text)] truncate">{variantLine(v)}</span>
          </button>
        );
      })}
    </div>
  );
}
