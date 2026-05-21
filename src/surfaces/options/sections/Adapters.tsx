import { EmptyState } from '../../../ui/primitives';

export function AdaptersSection({ searchQuery }: { searchQuery: string }) {
  if (searchQuery && !'adapters plugins extraction'.includes(searchQuery.toLowerCase())) return null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-[16px] font-semibold text-[var(--color-text)] mb-1">Extraction Adapters</h2>
        <p className="text-[13px] text-[var(--color-text-muted)] mb-6">Manage specific rules for specialized websites.</p>
        
        <EmptyState 
           title="No adapters configured" 
           body="Custom site extraction scripts cannot be managed through the UI yet." 
        />
      </div>
    </div>
  );
}
