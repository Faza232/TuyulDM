export function AboutSection({ searchQuery }: { searchQuery: string }) {
  if (searchQuery && !'about version info developer'.includes(searchQuery.toLowerCase())) return null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-[16px] font-semibold text-[var(--color-text)] mb-1">About TuyulDM</h2>
        <p className="text-[13px] text-[var(--color-text-muted)] mb-6">System information and developer credits.</p>
        
        <div className="flex flex-col gap-4 border border-[var(--color-border-subtle)] rounded-[var(--radius-md)] p-4 bg-[var(--color-surface)]">
          <div className="flex justify-between items-center pb-4 border-b border-[var(--color-border-subtle)]">
            <span className="text-[13px] text-[var(--color-text-muted)]">Version</span>
            <span className="text-[13px] font-medium text-[var(--color-text)]">0.1.0-alpha</span>
          </div>
          <div className="flex justify-between items-center pb-4 border-b border-[var(--color-border-subtle)]">
            <span className="text-[13px] text-[var(--color-text-muted)]">Native Engine</span>
            <span className="text-[13px] font-medium text-[var(--color-text)]">Go 1.21+ (Connected)</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[13px] text-[var(--color-text-muted)]">License</span>
            <span className="text-[13px] font-medium text-[var(--color-text)]">MIT</span>
          </div>
        </div>
      </div>
    </div>
  );
}
