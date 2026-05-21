import { Chip } from '../../../ui/primitives';
import { Lock } from '../../../ui/icons';
import { STRATEGY_LABELS, type ExtractionStrategy } from '../../../../extension/src/shared/media_classify';

interface StrategyChipProps {
  strategy?: string;
  className?: string;
}

export function StrategyChip({ strategy, className }: StrategyChipProps) {
  if (!strategy) {
    return <Chip tone="neutral" className={className}>Unknown</Chip>;
  }

  const label = (STRATEGY_LABELS as Record<string, string>)[strategy] || strategy;

  let tone: 'neutral' | 'accent' | 'info' | 'warning' | 'danger' | 'success' = 'neutral';
  let icon = undefined;

  switch (strategy) {
    case 'hls_manifest':
    case 'dash_manifest':
    case 'mse_observed_manifest':
      tone = 'accent';
      break;
    case 'page_metadata':
    case 'site_adapter':
      tone = 'info';
      break;
    case 'unsupported_protected':
      tone = 'warning';
      icon = <Lock />;
      break;
    case 'direct_file':
    case 'progressive_stream':
    default:
      tone = 'neutral';
      break;
  }

  return (
    <Chip tone={tone} className={className}>
      {icon && <span className="mr-1">{icon}</span>}
      {label}
    </Chip>
  );
}
