import { Chip } from '../../../ui/primitives';
import { Lock } from '../../../ui/icons';
import type { Tone } from '../../../ui/tokens';
import { STRATEGY_LABELS } from '../../../../extension/src/shared/media_classify';
import type { ExtractionStrategy } from '../../../state/types';

const TONE_BY_STRATEGY: Record<string, Tone> = {
  direct_file: 'neutral',
  progressive_stream: 'neutral',
  hls_manifest: 'accent',
  dash_manifest: 'accent',
  mse_observed_manifest: 'accent',
  page_metadata: 'info',
  site_adapter: 'info',
  unsupported_protected: 'warning',
};

export function strategyTone(strategy?: string): Tone {
  return (strategy && TONE_BY_STRATEGY[strategy]) || 'neutral';
}

export function strategyLabel(strategy?: string): string {
  if (!strategy) return 'Unknown';
  return STRATEGY_LABELS[strategy as ExtractionStrategy] || strategy;
}

export function StrategyChip({ strategy }: { strategy?: string }) {
  const protectedStrategy = strategy === 'unsupported_protected';
  return (
    <Chip tone={strategyTone(strategy)} icon={protectedStrategy ? <Lock size={11} /> : undefined}>
      {strategyLabel(strategy)}
    </Chip>
  );
}
