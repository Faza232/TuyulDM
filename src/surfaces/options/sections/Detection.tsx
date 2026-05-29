import { useEffect, useState } from 'react';
import { Switch, Input, Button, Badge } from '../../../ui/primitives';
import { Trash2 } from '../../../ui/icons';
import { SectionHeader, SettingRow } from './_shared';
import { useSettings, useSystem } from '../../../state/store';
import { useToasts } from '../../../state/toast';
import { formatExtensionRules, formatDomainRules, parseSettingsList, normalizeExtensionRule, normalizeDomainRule } from '../../../state/normalize';
import { formatGrantedOrigin } from '../../../ui/format';

export function Detection() {
  const { interception, persistInterception } = useSettings();
  const { permission, requestAllUrlsPermission, revokeGrantedPermission } = useSystem();
  const { push } = useToasts();
  const [ext, setExt] = useState('');
  const [allow, setAllow] = useState('');
  const [block, setBlock] = useState('');

  useEffect(() => {
    setExt(formatExtensionRules(interception.extensions));
    setAllow(formatDomainRules(interception.allowDomains));
    setBlock(formatDomainRules(interception.blockDomains));
  }, [interception]);

  const save = async (patch: Partial<typeof interception>) => {
    await persistInterception({ ...interception, ...patch });
    push({ tone: 'success', title: 'Saved' });
  };

  return (
    <div>
      <SectionHeader eyebrow="Capture" title="Detection" description="Control which downloads TuyulDM intercepts." />
      <SettingRow
        label="Intercept downloads"
        description="Take over matching downloads from the browser."
        control={<Switch checked={interception.enabled} onChange={(v) => void save({ enabled: v })} />}
      />
      <SettingRow
        label="Auto-show detected streams"
        description="Surface detected media as soon as it appears."
        control={<Switch checked={interception.autoShowDetectedStreams} onChange={(v) => void save({ autoShowDetectedStreams: v })} />}
      />
      <SettingRow
        label="Minimum file size (MB)"
        description="Ignore intercepted files smaller than this."
        control={
          <Input
            type="number" min={0}
            value={interception.minFileSizeMB}
            onChange={(e) => void save({ minFileSizeMB: Number(e.target.value) })}
            className="w-28"
          />
        }
      />

      <div className="py-4 border-b border-[var(--color-border-subtle)]">
        <label className="text-[13px] text-[var(--color-text)]">File extensions</label>
        <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 mb-2">One per line, e.g. <span className="font-mono">.mp4</span></p>
        <textarea
          value={ext}
          onChange={(e) => setExt(e.target.value)}
          onBlur={() => void save({ extensions: parseSettingsList(ext, normalizeExtensionRule) })}
          rows={4}
          className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-sm)] p-2 text-[12px] font-mono text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
        />
      </div>

      <div className="grid grid-cols-2 gap-4 py-4 border-b border-[var(--color-border-subtle)]">
        <div>
          <label className="text-[13px] text-[var(--color-text)]">Allow domains</label>
          <textarea
            value={allow}
            onChange={(e) => setAllow(e.target.value)}
            onBlur={() => void save({ allowDomains: parseSettingsList(allow, normalizeDomainRule) })}
            rows={4}
            className="mt-2 w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-sm)] p-2 text-[12px] font-mono text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
          />
        </div>
        <div>
          <label className="text-[13px] text-[var(--color-text)]">Block domains</label>
          <textarea
            value={block}
            onChange={(e) => setBlock(e.target.value)}
            onBlur={() => void save({ blockDomains: parseSettingsList(block, normalizeDomainRule) })}
            rows={4}
            className="mt-2 w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-sm)] p-2 text-[12px] font-mono text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
          />
        </div>
      </div>

      <div className="py-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-[13px] text-[var(--color-text)]">Site access</p>
            <p className="text-[12px] text-[var(--color-text-muted)]">Origins TuyulDM may read media from.</p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => void requestAllUrlsPermission()}>Grant all sites</Button>
        </div>
        {permission.grantedOrigins.length === 0 ? (
          <p className="text-[12px] text-[var(--color-text-dim)]">No origins granted yet.</p>
        ) : (
          <div className="space-y-1">
            {permission.grantedOrigins.map((origin) => (
              <div key={origin} className="flex items-center justify-between gap-2 px-2 h-8 rounded-[var(--radius-sm)] bg-[var(--color-surface)]">
                <span className="flex items-center gap-2 min-w-0">
                  {origin === '<all_urls>' && <Badge tone="accent">all</Badge>}
                  <span className="font-mono text-[12px] text-[var(--color-text-muted)] truncate">{formatGrantedOrigin(origin)}</span>
                </span>
                <button onClick={() => void revokeGrantedPermission(origin)} className="text-[var(--color-text-dim)] hover:text-[var(--color-danger)]" aria-label="Revoke">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
