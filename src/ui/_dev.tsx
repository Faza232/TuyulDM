import { useState, type ReactNode } from 'react';
import {
  Badge,
  Button,
  Checkbox,
  Chip,
  CommandPalette,
  Dialog,
  Drawer,
  EmptyState,
  IconButton,
  Input,
  Kbd,
  Menu,
  ProgressBar,
  Row,
  Select,
  Sidebar,
  SidebarItem,
  SidebarSection,
  Switch,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  ToastProvider,
  Toolbar,
  ToolbarDivider,
  ToolbarSpacer,
  Tooltip,
  useToast,
} from './primitives';
import type { BadgeTone, ToastTone } from './primitives';
import {
  Activity,
  CheckCircle2,
  ChevronRight,
  Command,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  Layers,
  Lock,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  Video,
  X,
} from './icons';

const STRATEGY_TONES: Array<{ label: string; tone: BadgeTone }> = [
  { label: 'direct_file', tone: 'neutral' },
  { label: 'progressive_stream', tone: 'neutral' },
  { label: 'hls_manifest', tone: 'accent' },
  { label: 'dash_manifest', tone: 'accent' },
  { label: 'mse_observed', tone: 'accent' },
  { label: 'page_metadata', tone: 'info' },
  { label: 'site_adapter', tone: 'info' },
  { label: 'unsupported_protected', tone: 'warning' },
  { label: 'manifest_expired', tone: 'danger' },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-[var(--color-border-subtle)] pb-6">
      <h2 className="text-[12px] font-mono uppercase tracking-widest text-[var(--color-text-dim)]">{title}</h2>
      <div className="flex flex-wrap items-start gap-3">{children}</div>
    </section>
  );
}

function ToastShowcase() {
  const { push } = useToast();
  const tones: ToastTone[] = ['info', 'success', 'warning', 'danger'];
  return (
    <div className="flex flex-wrap gap-2">
      {tones.map(tone => (
        <Button
          key={tone}
          variant="secondary"
          onClick={() =>
            push({
              tone,
              title: `${tone[0].toUpperCase()}${tone.slice(1)} toast`,
              body: 'Hover to read. Press the × to dismiss.',
              action: { label: 'Undo', onClick: () => {} },
            })
          }
        >
          Push {tone}
        </Button>
      ))}
    </div>
  );
}

function DevPanel() {
  const [tab, setTab] = useState('overview');
  const [vTab, setVTab] = useState('general');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [checked, setChecked] = useState(true);
  const [switched, setSwitched] = useState(false);
  const [select, setSelect] = useState('cozy');

  const commandItems = [
    {
      id: 'cmd.pause.all',
      label: 'Queue: pause all',
      description: 'Pause every active download',
      group: 'Queue',
      icon: <Pause />,
      shortcut: ['⌘', 'P'],
      onSelect: () => {},
    },
    {
      id: 'cmd.resume.all',
      label: 'Queue: resume all',
      description: 'Resume every paused download',
      group: 'Queue',
      icon: <Play />,
      onSelect: () => {},
    },
    {
      id: 'cmd.scan',
      label: 'Scan current tab',
      description: 'Look for offers in the active tab',
      group: 'Discover',
      icon: <RefreshCw />,
      onSelect: () => {},
    },
    {
      id: 'cmd.settings',
      label: 'Open settings',
      group: 'System',
      icon: <Settings />,
      shortcut: ['g', 's'],
      onSelect: () => {},
    },
  ];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-8 text-[var(--color-text)]">
      <header className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--color-text-dim)]">
            Phase W · primitives
          </p>
          <h1 className="mt-1 text-[20px] font-semibold tracking-tight">TuyulDM UI dev shell</h1>
          <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">
            Visual baseline for every primitive. Used as regression check during phases X–AG.
          </p>
        </div>
        <Button variant="primary" iconLeft={<Command />} onClick={() => setPaletteOpen(true)}>
          Open palette
        </Button>
      </header>

      <Section title="Buttons">
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
        <Button variant="secondary" loading>
          Loading
        </Button>
        <Button variant="secondary" disabled>
          Disabled
        </Button>
        <Button variant="secondary" size="sm" iconLeft={<Plus />}>
          Add URL
        </Button>
        <Button variant="primary" iconRight={<ChevronRight />}>
          Next
        </Button>
      </Section>

      <Section title="Icon buttons">
        <IconButton label="Pause">
          <Pause />
        </IconButton>
        <IconButton label="Resume">
          <Play />
        </IconButton>
        <IconButton label="Open folder">
          <FolderOpen />
        </IconButton>
        <IconButton label="Open page">
          <ExternalLink />
        </IconButton>
        <IconButton label="Copy URL">
          <Copy />
        </IconButton>
        <IconButton label="Cancel" tone="danger">
          <X />
        </IconButton>
        <IconButton label="Disabled" disabled>
          <Trash2 />
        </IconButton>
      </Section>

      <Section title="Inputs">
        <Input placeholder="Search downloads" iconLeft={<Search />} className="w-64" />
        <Input placeholder="https://…" defaultValue="https://example.com/video.mp4" className="w-80" />
        <Input placeholder="invalid" invalid className="w-40" />
        <Input placeholder="disabled" disabled className="w-40" />
        <Select
          value={select}
          onChange={e => setSelect(e.target.value)}
          options={[
            { value: 'cozy', label: 'Cozy density' },
            { value: 'compact', label: 'Compact density' },
          ]}
        />
        <Checkbox
          checked={checked}
          onChange={e => setChecked(e.target.checked)}
          label="Interception enabled"
          description="Watch network requests for matching media"
        />
        <Switch
          checked={switched}
          onChange={e => setSwitched(e.target.checked)}
          label="Adapter probe"
        />
      </Section>

      <Section title="Badges & strategy chips">
        {STRATEGY_TONES.map(s => (
          <Badge key={s.label} tone={s.tone} mono iconLeft={s.tone === 'warning' ? <Lock /> : undefined}>
            {s.label}
          </Badge>
        ))}
        <Badge tone="success" iconLeft={<CheckCircle2 />}>finished</Badge>
        <Badge tone="info" iconLeft={<Activity />}>fetching</Badge>
      </Section>

      <Section title="Filter chips">
        <Chip active>All</Chip>
        <Chip>Active</Chip>
        <Chip>Finished</Chip>
        <Chip tone="warning" iconLeft={<Lock />}>Protected</Chip>
        <Chip tone="info" iconLeft={<Layers />}>HLS</Chip>
      </Section>

      <Section title="Tabs (horizontal)">
        <div className="w-full">
          <Tabs value={tab} onValueChange={setTab}>
            <TabList ariaLabel="Demo tabs">
              <Tab value="overview">Overview</Tab>
              <Tab value="tracks">Tracks</Tab>
              <Tab value="debug">Debug</Tab>
            </TabList>
            <TabPanel value="overview">
              <p className="text-[13px] text-[var(--color-text-muted)]">Overview content</p>
            </TabPanel>
            <TabPanel value="tracks">
              <p className="text-[13px] text-[var(--color-text-muted)]">Track list goes here</p>
            </TabPanel>
            <TabPanel value="debug">
              <p className="text-[13px] text-[var(--color-text-muted)]">Debug snapshot goes here</p>
            </TabPanel>
          </Tabs>
        </div>
      </Section>

      <Section title="Tabs (vertical)">
        <div className="flex w-full gap-4">
          <Tabs value={vTab} onValueChange={setVTab} orientation="vertical">
            <TabList ariaLabel="Settings sections">
              <Tab value="general">General</Tab>
              <Tab value="detection">Detection</Tab>
              <Tab value="network">Network</Tab>
            </TabList>
            <TabPanel value="general">General settings…</TabPanel>
            <TabPanel value="detection">Detection settings…</TabPanel>
            <TabPanel value="network">Network settings…</TabPanel>
          </Tabs>
        </div>
      </Section>

      <Section title="Tooltip + Kbd">
        <Tooltip content="Open command palette">
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-[12px] text-[var(--color-text-muted)]"
          >
            <Search className="size-3.5" />
            Search
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </button>
        </Tooltip>
      </Section>

      <Section title="Progress">
        <div className="w-72">
          <ProgressBar value={42} />
        </div>
        <div className="w-72">
          <ProgressBar value={100} tone="success" />
        </div>
        <div className="w-72">
          <ProgressBar indeterminate />
        </div>
      </Section>

      <Section title="Row (cozy + compact)">
        <div className="flex w-full flex-col gap-1">
          <Row>
            <Badge tone="accent" mono>hls_manifest</Badge>
            <span className="flex-1 truncate text-[13px]">trailer-2160p.mp4</span>
            <span className="font-mono text-[12px] text-[var(--color-text-muted)]">312 MB</span>
            <ProgressBar value={68} className="w-24" />
            <span className="font-mono text-[12px] text-[var(--color-text-muted)]">68%</span>
          </Row>
          <Row density="compact" selected>
            <Badge tone="neutral" mono>direct_file</Badge>
            <span className="flex-1 truncate text-[12px]">sample.mp4</span>
            <span className="font-mono text-[11px] text-[var(--color-text-dim)]">88 MB</span>
          </Row>
        </div>
      </Section>

      <Section title="Empty state">
        <div className="w-full">
          <EmptyState
            icon={<Video />}
            title="No detected media on this tab yet"
            body="Open a video page and click Scan tab to look for offers."
            action={<Button variant="primary" iconLeft={<RefreshCw />}>Scan tab</Button>}
          />
        </div>
      </Section>

      <Section title="Overlays">
        <Button variant="secondary" onClick={() => setDialogOpen(true)}>
          Open dialog
        </Button>
        <Button variant="secondary" onClick={() => setDrawerOpen(true)}>
          Open drawer
        </Button>
        <Menu
          trigger={<Button variant="secondary" iconRight={<ChevronRight />}>Menu</Button>}
          groups={[
            {
              id: 'actions',
              label: 'Actions',
              items: [
                { id: 'pause', label: 'Pause', icon: <Pause />, shortcut: 'space', onSelect: () => {} },
                { id: 'resume', label: 'Resume', icon: <Play />, onSelect: () => {} },
                { id: 'open-folder', label: 'Open folder', icon: <FolderOpen />, onSelect: () => {} },
              ],
            },
            {
              id: 'destructive',
              items: [{ id: 'cancel', label: 'Cancel', icon: <Trash2 />, tone: 'danger', onSelect: () => {} }],
            },
          ]}
        />
      </Section>

      <Section title="Toasts">
        <ToastShowcase />
      </Section>

      <div className="rounded-[var(--radius-md)] border border-[var(--color-border-subtle)]">
        <Toolbar ariaLabel="Demo toolbar">
          <span className="font-mono text-[12px] text-[var(--color-text-muted)]">Queue · 12 active</span>
          <ToolbarDivider />
          <Button variant="secondary" size="sm" iconLeft={<Pause />}>Pause all</Button>
          <Button variant="secondary" size="sm" iconLeft={<Play />}>Resume all</Button>
          <ToolbarSpacer />
          <Input placeholder="Filter" iconLeft={<Search />} className="w-48" />
          <Button variant="primary" size="sm" iconLeft={<Plus />}>Add URL</Button>
        </Toolbar>
        <div className="flex h-[200px]">
          <Sidebar>
            <SidebarSection label="Queue">
              <SidebarItem icon={<Activity />} label="All" active count={12} />
              <SidebarItem icon={<Download />} label="Active" count={5} />
              <SidebarItem icon={<CheckCircle2 />} label="Finished" count={7} />
            </SidebarSection>
            <SidebarSection label="System">
              <SidebarItem icon={<Settings />} label="Settings" />
            </SidebarSection>
          </Sidebar>
          <div className="flex-1 p-3 text-[12px] text-[var(--color-text-muted)]">
            Main pane preview.
          </div>
        </div>
      </div>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Add URL"
        description="Paste a media URL to queue."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => setDialogOpen(false)}>Queue</Button>
          </>
        }
      >
        <Input placeholder="https://…" autoFocus />
      </Dialog>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="trailer-2160p.mp4"
        description="hls_manifest · example.com"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDrawerOpen(false)}>Close</Button>
            <Button variant="primary" iconLeft={<FolderOpen />}>Open folder</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-[13px] text-[var(--color-text-muted)]">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--color-text-dim)]">Strategy</p>
            <p className="mt-1">hls_manifest · 3 tracks · plan steps: 4</p>
          </div>
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--color-text-dim)]">Assembly</p>
            <Badge tone="info">remuxing</Badge>
          </div>
        </div>
      </Drawer>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={commandItems} />
    </div>
  );
}

export default function Dev() {
  return (
    <ToastProvider>
      <DevPanel />
    </ToastProvider>
  );
}
