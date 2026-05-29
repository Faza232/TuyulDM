import { useState } from 'react';
import {
  Button, IconButton, Input, Select, Checkbox, Switch, Tabs, Badge, Chip, Tooltip,
  Kbd, Dialog, Drawer, Menu, ToastRegion, Toolbar, Sidebar, SidebarItem, Row,
  ProgressBar, EmptyState,
} from './primitives';
import type { ToastData, MenuItem } from './primitives';
import type { Tone } from './tokens';
import {
  Plus, Search, Download, Pause, Settings, Film, LayoutGrid, Info, MoreHorizontal,
  ScanLine,
} from './icons';

const TONES: Tone[] = ['neutral', 'accent', 'info', 'success', 'warning', 'danger'];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-mono text-[11px] uppercase tracking-widest text-[var(--color-text-dim)]">{title}</h2>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  );
}

export function DevShowcase() {
  const [tab, setTab] = useState('all');
  const [checked, setChecked] = useState(true);
  const [sw, setSw] = useState(true);
  const [dialog, setDialog] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const pushToast = (tone: ToastData['tone']) =>
    setToasts((t) => [...t, { id: `${tone}-${t.length}`, tone, title: `${tone} toast`, body: 'Example notification body.' }]);

  const menuItems: MenuItem[] = [
    { label: 'Pause', icon: <Pause size={14} />, onSelect: () => {} },
    { label: 'Download', icon: <Download size={14} />, onSelect: () => {} },
    { type: 'separator' },
    { label: 'Cancel', tone: 'danger', onSelect: () => {} },
  ];

  return (
    <div className="min-h-screen flex">
      <Sidebar collapsed={collapsed}>
        <div className="h-12 flex items-center px-3 border-b border-[var(--color-border-subtle)]">
          <span className="font-mono text-[12px] text-[var(--color-text)]">TuyulDM</span>
        </div>
        <div className="py-2 flex flex-col gap-0.5">
          <SidebarItem icon={<LayoutGrid size={16} />} label="Queue" count={3} active collapsed={collapsed} />
          <SidebarItem icon={<Film size={16} />} label="Grabber" collapsed={collapsed} />
          <SidebarItem icon={<Settings size={16} />} label="Settings" collapsed={collapsed} />
        </div>
      </Sidebar>

      <div className="flex-1 flex flex-col">
        <Toolbar
          left={<span className="font-mono text-[12px] text-[var(--color-text)]">_dev</span>}
          center={<Input iconLeft={<Search size={14} />} placeholder="Search…" className="w-64" />}
          right={
            <>
              <Kbd>⌘K</Kbd>
              <Button variant="primary" size="sm" iconLeft={<Plus size={14} />}>Add URL</Button>
            </>
          }
        />

        <div className="flex-1 overflow-y-auto p-8 space-y-10 max-w-3xl">
          <Section title="Buttons">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="secondary" loading>Loading</Button>
            <Button variant="secondary" disabled>Disabled</Button>
            <Button size="sm" variant="primary">Small</Button>
            <IconButton icon={<MoreHorizontal size={16} />} label="More" />
          </Section>

          <Section title="Inputs">
            <Input placeholder="Text input" className="w-48" />
            <Input invalid placeholder="Invalid" className="w-48" />
            <Select className="w-40" options={[{ value: 'a', label: 'Option A' }, { value: 'b', label: 'Option B' }]} />
            <Checkbox label="Checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            <Switch checked={sw} onChange={setSw} label="Switch" />
          </Section>

          <Section title="Tabs">
            <Tabs
              value={tab}
              onChange={setTab}
              aria-label="demo"
              items={[
                { value: 'all', label: 'All', count: 12 },
                { value: 'active', label: 'Active', count: 3 },
                { value: 'finished', label: 'Finished', count: 9 },
              ]}
            />
          </Section>

          <Section title="Badges / Chips">
            {TONES.map((t) => <Badge key={t} tone={t}>{t}</Badge>)}
            {TONES.map((t) => <Chip key={t} tone={t} icon={<Film size={12} />}>{t}</Chip>)}
          </Section>

          <Section title="Tooltip / Kbd">
            <Tooltip label="Tooltip text"><Button variant="secondary" size="sm">Hover me</Button></Tooltip>
            <span className="flex items-center gap-1"><Kbd>g</Kbd><Kbd>q</Kbd></span>
          </Section>

          <Section title="Progress">
            <div className="w-64 space-y-3">
              <ProgressBar value={0.4} />
              <ProgressBar value={0.8} tone="success" />
              <ProgressBar value={null} />
            </div>
          </Section>

          <Section title="Overlays">
            <Button variant="secondary" onClick={() => setDialog(true)}>Open dialog</Button>
            <Button variant="secondary" onClick={() => setDrawer(true)}>Open drawer</Button>
            <div className="relative">
              <Button variant="secondary" onClick={() => setMenu((m) => !m)}>Menu ▾</Button>
              <Menu open={menu} onClose={() => setMenu(false)} items={menuItems} />
            </div>
          </Section>

          <Section title="Toasts">
            {(['info', 'success', 'warning', 'danger'] as const).map((t) => (
              <Button key={t} variant="secondary" size="sm" onClick={() => pushToast(t)}>{t}</Button>
            ))}
          </Section>

          <Section title="Rows">
            <div className="w-full space-y-1">
              <Row><Chip tone="neutral">Direct</Chip><span className="text-[13px]">cozy row</span></Row>
              <Row density="compact" selected><Chip tone="accent">HLS</Chip><span className="text-[13px]">compact selected row</span></Row>
            </div>
          </Section>

          <Section title="Empty state">
            <div className="w-full border border-[var(--color-border-subtle)] rounded-[var(--radius-lg)]">
              <EmptyState
                icon={<ScanLine size={28} />}
                title="No downloads yet"
                body="Detected media from the current tab will show up here."
                action={<Button variant="primary" size="sm" iconLeft={<ScanLine size={14} />}>Scan current tab</Button>}
              />
            </div>
          </Section>

          <Section title="Sidebar">
            <Button variant="secondary" size="sm" onClick={() => setCollapsed((c) => !c)}>Toggle collapse</Button>
            <span className="flex items-center gap-1 text-[12px] text-[var(--color-text-muted)]"><Info size={13} /> uses left rail</span>
          </Section>
        </div>
      </div>

      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="Example dialog"
        description="Focus trapped, escape closes, scrim click closes."
        footer={<><Button variant="ghost" size="sm" onClick={() => setDialog(false)}>Cancel</Button><Button variant="primary" size="sm" onClick={() => setDialog(false)}>Confirm</Button></>}
      >
        Dialog body content.
      </Dialog>

      <Drawer open={drawer} onClose={() => setDrawer(false)} title="Example drawer">
        <div className="p-4 text-[13px] text-[var(--color-text-muted)]">Drawer body. Slides in from the right.</div>
      </Drawer>

      <ToastRegion toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  );
}
