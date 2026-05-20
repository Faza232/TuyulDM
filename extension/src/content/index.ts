type OverlayDownloadSchedule = {
  start_hour: number;
  end_hour: number;
  days: number[];
};

type DetectedManifest = {
  url: string;
  manifestType: 'HLS' | 'DASH';
};

type RuntimeLike = {
  sendMessage?: (message: Record<string, unknown>, callback?: (response: unknown) => void) => Promise<unknown> | void;
  onMessage?: {
    addListener: (listener: (message: any, sender: any, sendResponse: (response?: any) => void) => boolean | void) => void;
  };
  getURL?: (path: string) => string;
  lastError?: { message?: string };
};

declare global {
  interface Window {
    __TUYULDM_CONTENT_READY__?: boolean;
  }
}

const OVERLAY_HOST_ID = 'tuyuldm-video-overlay-host';
const OVERLAY_AUTO_DISMISS_MS = 5 * 60_000;
const DRM_POLICY_HASH = 'options.html#drm-policy';
const WEEKDAY_OPTIONS = [
  { label: 'Su', value: 0 },
  { label: 'Mo', value: 1 },
  { label: 'Tu', value: 2 },
  { label: 'We', value: 3 },
  { label: 'Th', value: 4 },
  { label: 'Fr', value: 5 },
  { label: 'Sa', value: 6 },
];

function getRuntime(): RuntimeLike | null {
  const browserRuntime = (globalThis as any).browser?.runtime;
  if (browserRuntime?.sendMessage) {
    return browserRuntime;
  }

  const chromeRuntime = (globalThis as any).chrome?.runtime;
  return chromeRuntime?.sendMessage ? chromeRuntime : null;
}

function sendRuntimeMessage(message: Record<string, unknown>) {
  const browserRuntime = (globalThis as any).browser?.runtime;
  if (browserRuntime?.sendMessage) {
    return browserRuntime.sendMessage(message);
  }

  const chromeRuntime = (globalThis as any).chrome?.runtime;
  return new Promise<any>((resolve, reject) => {
    if (!chromeRuntime?.sendMessage) {
      reject(new Error('Extension runtime unavailable'));
      return;
    }

    chromeRuntime.sendMessage(message, (response: unknown) => {
      const lastError = chromeRuntime.lastError;
      if (lastError?.message) {
        reject(new Error(lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function detectManifestTypeFromUrl(rawUrl: unknown): DetectedManifest['manifestType'] | null {
  const url = String(rawUrl || '').trim().toLowerCase();
  if (!url) {
    return null;
  }
  if (url.includes('.m3u8')) {
    return 'HLS';
  }
  if (url.includes('.mpd')) {
    return 'DASH';
  }
  return null;
}

function normalizeScheduleHour(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(23, Math.max(0, Math.round(value)));
}

function normalizeScheduleDays(days: number[] | undefined) {
  if (!Array.isArray(days) || days.length === 0) {
    return WEEKDAY_OPTIONS.map((option) => option.value);
  }

  return Array.from(
    new Set(days.map((day) => Math.min(6, Math.max(0, Math.round(day))))),
  ).sort((left, right) => left - right);
}

function toggleScheduleDay(days: number[], day: number) {
  if (days.includes(day)) {
    if (days.length === 1) {
      return days;
    }
    return days.filter((value) => value !== day);
  }
  return [...days, day].sort((left, right) => left - right);
}

function variantLabel(variant: any) {
  const parts = [variant?.name, variant?.resolution, variant?.bandwidth ? `${Math.round(Number(variant.bandwidth) / 1000)} kbps` : '']
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return parts.join(' · ') || 'Default quality';
}

function isDrmRefusal(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes('drm') || normalized.includes('encrypted') || normalized.includes('widevine');
}

function drmPolicyUrl() {
  const runtime = getRuntime();
  return runtime?.getURL ? runtime.getURL(DRM_POLICY_HASH) : '#';
}

function scanPageForVideos(): DetectedManifest[] {
  const found = new Map<string, DetectedManifest>();
  const remember = (candidate: unknown) => {
    const url = String(candidate || '').trim();
    const manifestType = detectManifestTypeFromUrl(url);
    if (!url || !manifestType) {
      return;
    }
    found.set(`${manifestType}:${url}`, { url, manifestType });
  };

  for (const element of document.querySelectorAll('video, source')) {
    if (element instanceof HTMLMediaElement) {
      remember(element.currentSrc);
      remember(element.src);
      remember(element.getAttribute('src'));
      continue;
    }

    if (element instanceof HTMLSourceElement) {
      remember(element.src);
      remember(element.getAttribute('src'));
    }
  }

  for (const entry of performance.getEntriesByType('resource')) {
    remember((entry as PerformanceResourceTiming).name);
  }

  return Array.from(found.values());
}

function removeOverlayHost() {
  document.getElementById(OVERLAY_HOST_ID)?.remove();
}

function createScheduleField(labelText: string, value: number, onChange: (nextValue: number) => void) {
  const field = document.createElement('label');
  field.className = 'schedule-field';

  const label = document.createElement('span');
  label.textContent = labelText;
  field.appendChild(label);

  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.max = '23';
  input.step = '1';
  input.value = String(value);
  input.addEventListener('change', () => {
    const nextValue = normalizeScheduleHour(Number(input.value));
    input.value = String(nextValue);
    onChange(nextValue);
  });
  field.appendChild(input);
  return field;
}

function injectDetectedManifestOverlay(url: string, manifestType: string, defaultSchedule?: OverlayDownloadSchedule) {
  removeOverlayHost();

  const host = document.createElement('div');
  host.id = OVERLAY_HOST_ID;
  host.style.all = 'initial';
  host.style.position = 'fixed';
  host.style.top = '20px';
  host.style.right = '20px';
  host.style.zIndex = '2147483647';
  host.style.pointerEvents = 'auto';
  host.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace';
  host.style.color = '#E4E3E0';

  const shadowRoot = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .card {
      width: min(360px, calc(100vw - 32px));
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 14px 16px;
      border-radius: 12px;
      border: 1px solid rgba(228, 227, 224, 0.12);
      background: rgba(17, 17, 17, 0.96);
      color: #E4E3E0;
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.42);
      backdrop-filter: blur(16px);
    }
    .eyebrow {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.18em;
      color: rgba(228, 227, 224, 0.55);
    }
    .title {
      font-size: 13px;
      font-weight: 700;
      line-height: 1.5;
    }
    .status {
      font-size: 12px;
      line-height: 1.5;
      color: rgba(228, 227, 224, 0.72);
    }
    .error {
      display: none;
      gap: 8px;
      flex-direction: column;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid rgba(248, 113, 113, 0.25);
      background: rgba(127, 29, 29, 0.35);
      color: #fecaca;
      font-size: 12px;
      line-height: 1.5;
    }
    .error a {
      color: #fff;
      text-decoration: underline;
      cursor: pointer;
    }
    select, input {
      width: 100%;
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid rgba(228, 227, 224, 0.16);
      background: #090909;
      color: #E4E3E0;
      font: inherit;
    }
    select {
      display: none;
    }
    .schedule {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid rgba(228, 227, 224, 0.12);
      background: rgba(255, 255, 255, 0.03);
    }
    .schedule-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }
    .schedule-copy {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 11px;
    }
    .schedule-copy strong {
      font-size: 12px;
    }
    .schedule-copy span {
      color: rgba(228, 227, 224, 0.66);
    }
    .schedule-grid {
      display: none;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    .schedule-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 11px;
      color: rgba(228, 227, 224, 0.72);
    }
    .days {
      grid-column: 1 / -1;
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: 6px;
    }
    .day {
      padding: 6px 0;
      border-radius: 8px;
      border: 1px solid rgba(228, 227, 224, 0.16);
      background: #090909;
      color: rgba(228, 227, 224, 0.72);
      font: inherit;
      font-size: 11px;
      cursor: pointer;
    }
    .day.active {
      border-color: #E4E3E0;
      background: #E4E3E0;
      color: #0A0A0A;
    }
    .actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }
    button {
      font: inherit;
      cursor: pointer;
    }
    .primary {
      border: none;
      border-radius: 8px;
      padding: 8px 12px;
      background: #E4E3E0;
      color: #0A0A0A;
      font-weight: 700;
    }
    .ghost {
      border: 1px solid rgba(228, 227, 224, 0.2);
      border-radius: 8px;
      padding: 8px 12px;
      background: transparent;
      color: #E4E3E0;
    }
    .primary:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
  `;
  shadowRoot.appendChild(style);

  const card = document.createElement('div');
  card.className = 'card';

  const eyebrow = document.createElement('div');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'TuyulDM Video Grabber';
  card.appendChild(eyebrow);

  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = `${manifestType} stream detected`;
  card.appendChild(title);

  const statusText = document.createElement('div');
  statusText.className = 'status';
  statusText.textContent = 'Inspecting stream variants...';
  card.appendChild(statusText);

  const errorCard = document.createElement('div');
  errorCard.className = 'error';
  const errorText = document.createElement('div');
  const whyLink = document.createElement('a');
  whyLink.href = drmPolicyUrl();
  whyLink.target = '_blank';
  whyLink.rel = 'noopener noreferrer';
  whyLink.textContent = 'Why?';
  errorCard.appendChild(errorText);
  errorCard.appendChild(whyLink);
  card.appendChild(errorCard);

  const variantSelect = document.createElement('select');
  card.appendChild(variantSelect);

  let selectedVariantId = '';
  let scheduleEnabled = !!defaultSchedule;
  let scheduleStartHour = normalizeScheduleHour(defaultSchedule?.start_hour ?? 2);
  let scheduleEndHour = normalizeScheduleHour(defaultSchedule?.end_hour ?? 6);
  let scheduleDays = normalizeScheduleDays(defaultSchedule?.days);

  function currentSchedule() {
    if (!scheduleEnabled) {
      return undefined;
    }

    return {
      start_hour: scheduleStartHour,
      end_hour: scheduleEndHour,
      days: [...scheduleDays],
    };
  }

  const scheduleCard = document.createElement('div');
  scheduleCard.className = 'schedule';

  const scheduleHeader = document.createElement('div');
  scheduleHeader.className = 'schedule-head';

  const scheduleCopy = document.createElement('div');
  scheduleCopy.className = 'schedule-copy';
  const scheduleLabel = document.createElement('strong');
  scheduleLabel.textContent = 'Schedule';
  scheduleCopy.appendChild(scheduleLabel);
  const scheduleHint = document.createElement('span');
  scheduleHint.textContent = 'Applies only to this video download.';
  scheduleCopy.appendChild(scheduleHint);
  scheduleHeader.appendChild(scheduleCopy);

  const scheduleToggle = document.createElement('input');
  scheduleToggle.type = 'checkbox';
  scheduleToggle.checked = scheduleEnabled;
  scheduleToggle.style.width = '18px';
  scheduleToggle.style.height = '18px';
  scheduleToggle.style.margin = '0';
  scheduleHeader.appendChild(scheduleToggle);
  scheduleCard.appendChild(scheduleHeader);

  const scheduleFields = document.createElement('div');
  scheduleFields.className = 'schedule-grid';
  scheduleFields.style.display = scheduleEnabled ? 'grid' : 'none';
  scheduleFields.appendChild(createScheduleField('Start Hour', scheduleStartHour, (nextValue) => {
    scheduleStartHour = nextValue;
  }));
  scheduleFields.appendChild(createScheduleField('End Hour', scheduleEndHour, (nextValue) => {
    scheduleEndHour = nextValue;
  }));

  const dayPicker = document.createElement('div');
  dayPicker.className = 'days';
  const dayButtons = new Map<number, HTMLButtonElement>();
  const syncDayButtons = () => {
    for (const [day, button] of dayButtons.entries()) {
      button.className = scheduleDays.includes(day) ? 'day active' : 'day';
    }
  };

  for (const option of WEEKDAY_OPTIONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = option.label;
    button.className = 'day';
    button.addEventListener('click', () => {
      scheduleDays = toggleScheduleDay(scheduleDays, option.value);
      syncDayButtons();
    });
    dayButtons.set(option.value, button);
    dayPicker.appendChild(button);
  }
  syncDayButtons();
  scheduleFields.appendChild(dayPicker);
  scheduleCard.appendChild(scheduleFields);
  card.appendChild(scheduleCard);

  scheduleToggle.addEventListener('change', () => {
    scheduleEnabled = scheduleToggle.checked;
    scheduleFields.style.display = scheduleEnabled ? 'grid' : 'none';
  });

  const actions = document.createElement('div');
  actions.className = 'actions';

  const dismissButton = document.createElement('button');
  dismissButton.type = 'button';
  dismissButton.className = 'ghost';
  dismissButton.textContent = 'Dismiss';

  const downloadButton = document.createElement('button');
  downloadButton.type = 'button';
  downloadButton.className = 'primary';
  downloadButton.textContent = 'Download Video';

  const closeOverlay = () => removeOverlayHost();
  dismissButton.addEventListener('click', closeOverlay);
  actions.appendChild(dismissButton);

  downloadButton.addEventListener('click', () => {
    downloadButton.disabled = true;
    void sendRuntimeMessage({
      type: 'START_VIDEO_DOWNLOAD',
      url,
      manifestType,
      selectedVariantId,
      schedule: currentSchedule(),
    }).then(() => {
      closeOverlay();
    }).catch((error) => {
      statusText.textContent = `Failed to start download: ${error instanceof Error ? error.message : String(error)}`;
      downloadButton.disabled = false;
    });
  });
  actions.appendChild(downloadButton);
  card.appendChild(actions);

  shadowRoot.appendChild(card);
  document.documentElement.appendChild(host);

  void sendRuntimeMessage({ type: 'INSPECT_VIDEO_MANIFEST', url, manifestType })
    .then((response: any) => {
      if (response?.error) {
        statusText.textContent = response.error;
        downloadButton.disabled = true;
        if (isDrmRefusal(String(response.error))) {
          errorText.textContent = response.error;
          errorCard.style.display = 'flex';
        }
        return;
      }

      const variants = Array.isArray(response?.variants) ? response.variants : [];
      selectedVariantId = typeof response?.selectedVariantId === 'string' ? response.selectedVariantId : '';

      if (variants.length <= 1) {
        if (!selectedVariantId && variants[0]?.id) {
          selectedVariantId = variants[0].id;
        }
        statusText.textContent = variants[0] ? `Quality: ${variantLabel(variants[0])}` : 'Using detected stream quality';
        return;
      }

      variantSelect.innerHTML = '';
      for (const variant of variants) {
        const option = document.createElement('option');
        option.value = String(variant?.id || '');
        option.textContent = variantLabel(variant);
        variantSelect.appendChild(option);
      }

      if (selectedVariantId) {
        variantSelect.value = selectedVariantId;
      } else if (variantSelect.options.length > 0) {
        selectedVariantId = variantSelect.options[0].value;
        variantSelect.value = selectedVariantId;
      }

      variantSelect.addEventListener('change', () => {
        selectedVariantId = variantSelect.value;
      });
      variantSelect.style.display = 'block';
      statusText.textContent = 'Choose a quality before starting the download.';
    })
    .catch((error) => {
      statusText.textContent = `Manifest inspection failed: ${error instanceof Error ? error.message : String(error)}`;
    });

  window.setTimeout(() => {
    if (host.isConnected) {
      closeOverlay();
    }
  }, OVERLAY_AUTO_DISMISS_MS);
}

function installMessageListener() {
  const runtime = getRuntime();
  if (!runtime?.onMessage) {
    return;
  }

  runtime.onMessage.addListener((message: any, _sender: any, sendResponse: (response?: any) => void) => {
    if (message?.type === 'PING_TUYULDM_CONTENT') {
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === 'SHOW_VIDEO_OVERLAY') {
      injectDetectedManifestOverlay(String(message.url || ''), String(message.manifestType || ''), message.schedule);
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === 'SCAN_PAGE_VIDEOS') {
      sendResponse({ streams: scanPageForVideos() });
      return false;
    }

    return false;
  });
}

if (!window.__TUYULDM_CONTENT_READY__) {
  window.__TUYULDM_CONTENT_READY__ = true;
  installMessageListener();
}

export {};