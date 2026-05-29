import { Dialog, Kbd } from '../../../ui/primitives';

const GROUPS: Array<{ title: string; items: Array<{ keys: string[]; label: string }> }> = [
  {
    title: 'General',
    items: [
      { keys: ['⌘', 'K'], label: 'Command palette' },
      { keys: ['['], label: 'Toggle sidebar' },
      { keys: ['?'], label: 'This cheat sheet' },
    ],
  },
  {
    title: 'Navigation',
    items: [
      { keys: ['g', 'q'], label: 'Go to Queue' },
      { keys: ['g', 'f'], label: 'Go to Finished' },
      { keys: ['g', 'g'], label: 'Go to Grabber' },
      { keys: ['g', 's'], label: 'Open Settings' },
    ],
  },
  {
    title: 'Selected row',
    items: [
      { keys: ['Space'], label: 'Pause / resume' },
      { keys: ['Enter'], label: 'Open details' },
      { keys: ['Del'], label: 'Cancel' },
    ],
  },
];

export function CheatSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts">
      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <h4 className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-text-dim)] mb-2">{g.title}</h4>
            <div className="space-y-1.5">
              {g.items.map((it) => (
                <div key={it.label} className="flex items-center justify-between gap-3">
                  <span className="text-[12px] text-[var(--color-text-muted)]">{it.label}</span>
                  <span className="flex items-center gap-1">{it.keys.map((k, i) => <Kbd key={i}>{k}</Kbd>)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
