import { Badge } from '../../../ui/primitives';
import { Loader2 } from '../../../ui/icons';
import type { Tone } from '../../../ui/tokens';

const STAGE_LABELS: Record<string, { label: string; tone: Tone; active: boolean }> = {
  resolving: { label: 'Resolving', tone: 'info', active: true },
  fetching: { label: 'Fetching', tone: 'accent', active: true },
  muxing: { label: 'Muxing', tone: 'accent', active: true },
  remuxing: { label: 'Remuxing', tone: 'accent', active: true },
  finalizing: { label: 'Finalizing', tone: 'accent', active: true },
};

export function AssemblyStageBadge({ stage }: { stage?: string }) {
  if (!stage) return null;
  const meta = STAGE_LABELS[stage] || { label: stage, tone: 'neutral' as Tone, active: false };
  return (
    <Badge tone={meta.tone}>
      {meta.active && <Loader2 size={9} className="animate-spin" />}
      {meta.label}
    </Badge>
  );
}
