import { usePermissions } from '../../state/permissions';
import { Button, IconButton } from '../../ui/primitives';
import { X, AlertTriangle } from '../../ui/icons';

export function PermissionBanner() {
  const { status, requestCurrentOrigin, requestAllUrls, dismissOnboarding, isLoading } = usePermissions();

  if (isLoading || !status) return null;
  if (!status.shouldShowOnboarding) return null;
  // If we already have the current origin permission, or all urls, we might not need to show the main banner,
  // but if shouldShowOnboarding is true, we should show it.
  
  if (status.currentOriginGranted && status.hasAllUrlsPermission) {
    return null;
  }

  return (
    <div className="bg-[var(--color-warning)] text-black p-3 m-2 rounded-[var(--radius-sm)] flex flex-col gap-2 relative">
      <div className="flex items-start gap-2 pr-6">
        <AlertTriangle className="size-4 shrink-0 mt-0.5" />
        <div className="flex flex-col">
          <span className="text-[13px] font-semibold">Missing permissions</span>
          <span className="text-[12px] opacity-80 mt-0.5 leading-tight">
            TuyulDM needs host permissions to intercept media requests on this page.
          </span>
        </div>
      </div>
      
      <div className="flex flex-col gap-1.5 mt-1">
        {!status.currentOriginGranted && status.canRequestCurrentOrigin && (
          <Button variant="primary" size="sm" onClick={requestCurrentOrigin} className="w-full bg-black/10 hover:bg-black/20 text-black border-black/10">
            Allow on {status.currentOrigin}
          </Button>
        )}
        {!status.hasAllUrlsPermission && (
          <Button variant="secondary" size="sm" onClick={requestAllUrls} className="w-full bg-transparent hover:bg-black/10 text-black border-black/20">
            Allow on all sites
          </Button>
        )}
      </div>

      <div className="absolute top-1 right-1">
        <IconButton size="sm" label="Dismiss" onClick={dismissOnboarding} className="text-black/50 hover:bg-black/10 hover:text-black">
          <X className="size-3.5" />
        </IconButton>
      </div>
    </div>
  );
}
