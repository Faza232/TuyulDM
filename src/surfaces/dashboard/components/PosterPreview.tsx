import { Video } from '../../../ui/icons';
import { cn } from '../../../ui/cn';
import { useState } from 'react';

interface PosterPreviewProps {
  src?: string;
  alt?: string;
  className?: string;
}

export function PosterPreview({ src, alt, className }: PosterPreviewProps) {
  const [error, setError] = useState(false);

  if (!src || error) {
    return (
      <div className={cn("flex items-center justify-center bg-[var(--color-surface-raised)] border border-[var(--color-border-subtle)] rounded-[var(--radius-sm)]", className)}>
        <Video className="text-[var(--color-text-dim)] size-1/3 max-w-[32px] max-h-[32px]" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt || 'Poster preview'}
      className={cn("object-cover bg-[var(--color-surface-raised)] border border-[var(--color-border-subtle)] rounded-[var(--radius-sm)]", className)}
      onError={() => setError(true)}
      loading="lazy"
    />
  );
}
