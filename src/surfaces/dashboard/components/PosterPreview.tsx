import { useState } from 'react';
import { Film } from '../../../ui/icons';
import { cn } from '../../../ui/cn';

export type PosterPreviewProps = {
  src?: string;
  alt?: string;
  className?: string;
};

export function PosterPreview({ src, alt, className }: PosterPreviewProps) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={cn('relative aspect-video rounded-[var(--radius-sm)] overflow-hidden bg-[var(--color-surface-raised)] border border-[var(--color-border-subtle)]', className)}>
      {src && !failed ? (
        <img src={src} alt={alt || ''} loading="lazy" onError={() => setFailed(true)} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-[var(--color-text-dim)]">
          <Film size={20} />
        </div>
      )}
    </div>
  );
}
