import { Badge } from '../../../ui/primitives';
import { Loader2 } from '../../../ui/icons';

interface AssemblyStageBadgeProps {
  stage?: string;
  className?: string;
}

export function AssemblyStageBadge({ stage, className }: AssemblyStageBadgeProps) {
  if (!stage) return null;

  return (
    <Badge 
      tone="info" 
      iconLeft={<Loader2 className="animate-spin" />} 
      className={className}
    >
      {stage}
    </Badge>
  );
}
