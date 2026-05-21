import { useState, useRef, useEffect } from 'react';
import { cn } from '../../../ui/cn';
import type { VariantInfo } from '../../../../extension/src/shared/media_classify';

interface VariantPickerProps {
  variants: VariantInfo[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onDownload: (id: string) => void;
}

export function VariantPicker({ variants, selectedId, onSelect, onDownload }: VariantPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  
  const selectedIndex = variants.findIndex(v => v.id === selectedId);
  const activeIndex = selectedIndex >= 0 ? selectedIndex : 0;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if we're focused on or within the variant picker container
      if (!containerRef.current?.contains(document.activeElement)) return;
      
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = Math.max(0, activeIndex - 1);
        onSelect(variants[prev].id);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = Math.min(variants.length - 1, activeIndex + 1);
        onSelect(variants[next].id);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onDownload(variants[activeIndex].id);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeIndex, variants, onSelect, onDownload]);

  if (!variants || variants.length === 0) {
    return <div className="text-[12px] text-[var(--color-text-dim)]">No variants available.</div>;
  }

  return (
    <div ref={containerRef} className="flex flex-col gap-1 outline-none" tabIndex={0}>
      {variants.map((variant, i) => {
        const isSelected = variant.id === selectedId || (i === 0 && !selectedId);
        return (
          <button
            key={variant.id}
            className={cn(
              "flex items-center justify-between px-3 py-2 text-left rounded-[var(--radius-sm)] border border-transparent transition-colors",
              "focus:outline-none focus-visible:border-[var(--color-accent)]",
              isSelected ? "bg-white/5 border-[var(--color-border)]" : "hover:bg-white/5 hover:border-[var(--color-border-subtle)]"
            )}
            onClick={() => onSelect(variant.id)}
            onDoubleClick={() => onDownload(variant.id)}
          >
            <div className="flex flex-col">
              <span className={cn("text-[13px] font-medium leading-tight", isSelected ? "text-[var(--color-text)]" : "text-[var(--color-text-muted)]")}>
                {variant.resolution || variant.name || variant.id}
              </span>
              <span className="text-[11px] text-[var(--color-text-dim)] mt-0.5 font-mono">
                {variant.codecs ? variant.codecs : 'Unknown codec'}
              </span>
            </div>
            
            {variant.bandwidth && (
              <div className="font-mono text-[11px] text-[var(--color-text-dim)]">
                {Math.round(variant.bandwidth / 1000)}k
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
