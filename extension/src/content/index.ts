type OverlayDownloadSchedule = {
  start_hour: number;
  end_hour: number;
  days: number[];
};

export function injectDetectedManifestOverlay(url: string, manifestType: string, defaultSchedule?: OverlayDownloadSchedule) {
  const overlayId = 'tuyuldm-video-overlay';
  const existingOverlay = document.getElementById(overlayId);
  if (existingOverlay) {
    existingOverlay.remove();
  }

  const weekdayOptions = [
    { label: 'Su', value: 0 },
    { label: 'Mo', value: 1 },
    { label: 'Tu', value: 2 },
    { label: 'We', value: 3 },
    { label: 'Th', value: 4 },
    { label: 'Fr', value: 5 },
    { label: 'Sa', value: 6 },
  ];

  function normalizeScheduleHour(value: number) {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.min(23, Math.max(0, Math.round(value)));
  }

  function normalizeScheduleDays(days: number[] | undefined) {
    if (!Array.isArray(days) || days.length === 0) {
      return weekdayOptions.map((option) => option.value);
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

      chromeRuntime.sendMessage(message, (response: any) => {
        const lastError = chromeRuntime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        resolve(response);
      });
    });
  }

  const overlay = document.createElement('div');
  overlay.id = overlayId;
  overlay.style.position = 'fixed';
  overlay.style.top = '20px';
  overlay.style.right = '20px';
  overlay.style.zIndex = '999999';
  overlay.style.backgroundColor = '#141414';
  overlay.style.color = '#E4E3E0';
  overlay.style.padding = '12px 16px';
  overlay.style.borderRadius = '8px';
  overlay.style.fontFamily = 'monospace';
  overlay.style.fontSize = '12px';
  overlay.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
  overlay.style.display = 'flex';
  overlay.style.flexDirection = 'column';
  overlay.style.gap = '8px';

  const text = document.createElement('span');
  text.innerText = `TuyulDM: ${manifestType} Video Detected`;
  overlay.appendChild(text);

  const statusText = document.createElement('span');
  statusText.innerText = 'Inspecting stream variants...';
  statusText.style.opacity = '0.8';
  overlay.appendChild(statusText);

  const variantSelect = document.createElement('select');
  variantSelect.style.backgroundColor = '#0E0E0E';
  variantSelect.style.color = '#E4E3E0';
  variantSelect.style.border = '1px solid rgba(228, 227, 224, 0.2)';
  variantSelect.style.padding = '6px 10px';
  variantSelect.style.borderRadius = '4px';
  variantSelect.style.fontFamily = 'monospace';
  variantSelect.style.fontSize = '12px';
  variantSelect.style.display = 'none';
  overlay.appendChild(variantSelect);

  const buttonRow = document.createElement('div');
  buttonRow.style.display = 'flex';
  buttonRow.style.gap = '8px';

  const downloadButton = document.createElement('button');
  downloadButton.innerText = 'Download Video';
  downloadButton.style.backgroundColor = '#E4E3E0';
  downloadButton.style.color = '#141414';
  downloadButton.style.border = 'none';
  downloadButton.style.padding = '6px 12px';
  downloadButton.style.borderRadius = '4px';
  downloadButton.style.cursor = 'pointer';
  downloadButton.style.fontWeight = 'bold';
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

  function variantLabel(variant: any) {
    const parts = [variant?.name, variant?.resolution, variant?.bandwidth ? `${Math.round(Number(variant.bandwidth) / 1000)} kbps` : '']
      .map((value) => String(value || '').trim())
      .filter(Boolean);
    return parts.join(' · ') || 'Default quality';
  }

  const scheduleCard = document.createElement('div');
  scheduleCard.style.display = 'flex';
  scheduleCard.style.flexDirection = 'column';
  scheduleCard.style.gap = '8px';
  scheduleCard.style.padding = '8px 10px';
  scheduleCard.style.border = '1px solid rgba(228, 227, 224, 0.12)';
  scheduleCard.style.borderRadius = '6px';
  scheduleCard.style.backgroundColor = '#101010';

  const scheduleHeader = document.createElement('div');
  scheduleHeader.style.display = 'flex';
  scheduleHeader.style.alignItems = 'center';
  scheduleHeader.style.justifyContent = 'space-between';
  scheduleHeader.style.gap = '12px';

  const scheduleHeaderCopy = document.createElement('div');
  scheduleHeaderCopy.style.display = 'flex';
  scheduleHeaderCopy.style.flexDirection = 'column';
  scheduleHeaderCopy.style.gap = '4px';

  const scheduleLabel = document.createElement('span');
  scheduleLabel.innerText = 'Schedule';
  scheduleLabel.style.fontWeight = 'bold';
  scheduleHeaderCopy.appendChild(scheduleLabel);

  const scheduleHint = document.createElement('span');
  scheduleHint.innerText = 'Applies only to this video download.';
  scheduleHint.style.opacity = '0.7';
  scheduleHint.style.fontSize = '11px';
  scheduleHeaderCopy.appendChild(scheduleHint);

  const scheduleToggle = document.createElement('input');
  scheduleToggle.type = 'checkbox';
  scheduleToggle.checked = scheduleEnabled;
  scheduleToggle.style.margin = '0';

  scheduleHeader.appendChild(scheduleHeaderCopy);
  scheduleHeader.appendChild(scheduleToggle);
  scheduleCard.appendChild(scheduleHeader);

  const scheduleFields = document.createElement('div');
  scheduleFields.style.display = scheduleEnabled ? 'grid' : 'none';
  scheduleFields.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
  scheduleFields.style.gap = '8px';

  function buildScheduleField(labelText: string, value: number, onChange: (nextValue: number) => void) {
    const field = document.createElement('label');
    field.style.display = 'flex';
    field.style.flexDirection = 'column';
    field.style.gap = '4px';

    const label = document.createElement('span');
    label.innerText = labelText;
    label.style.opacity = '0.75';
    label.style.fontSize = '11px';
    field.appendChild(label);

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = '23';
    input.step = '1';
    input.value = String(value);
    input.style.backgroundColor = '#0A0A0A';
    input.style.color = '#E4E3E0';
    input.style.border = '1px solid rgba(228, 227, 224, 0.2)';
    input.style.padding = '6px 8px';
    input.style.borderRadius = '4px';
    input.style.fontFamily = 'monospace';
    input.style.fontSize = '12px';
    input.onchange = () => {
      const nextValue = normalizeScheduleHour(Number(input.value));
      input.value = String(nextValue);
      onChange(nextValue);
    };
    field.appendChild(input);

    return field;
  }

  scheduleFields.appendChild(buildScheduleField('Start Hour', scheduleStartHour, (nextValue) => {
    scheduleStartHour = nextValue;
  }));
  scheduleFields.appendChild(buildScheduleField('End Hour', scheduleEndHour, (nextValue) => {
    scheduleEndHour = nextValue;
  }));

  const dayPicker = document.createElement('div');
  dayPicker.style.display = 'grid';
  dayPicker.style.gridTemplateColumns = 'repeat(7, minmax(0, 1fr))';
  dayPicker.style.gap = '6px';
  dayPicker.style.gridColumn = '1 / -1';

  const dayButtons = new Map<number, HTMLButtonElement>();
  function syncDayButtons() {
    for (const [day, button] of dayButtons.entries()) {
      const active = scheduleDays.includes(day);
      button.style.backgroundColor = active ? '#E4E3E0' : '#0A0A0A';
      button.style.color = active ? '#141414' : '#E4E3E0';
      button.style.borderColor = active ? '#E4E3E0' : 'rgba(228, 227, 224, 0.2)';
    }
  }

  for (const option of weekdayOptions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.innerText = option.label;
    button.style.padding = '6px 0';
    button.style.borderRadius = '4px';
    button.style.border = '1px solid rgba(228, 227, 224, 0.2)';
    button.style.cursor = 'pointer';
    button.style.fontFamily = 'monospace';
    button.style.fontSize = '11px';
    button.onclick = () => {
      scheduleDays = toggleScheduleDay(scheduleDays, option.value);
      syncDayButtons();
    };
    dayButtons.set(option.value, button);
    dayPicker.appendChild(button);
  }
  syncDayButtons();

  scheduleFields.appendChild(dayPicker);
  scheduleCard.appendChild(scheduleFields);
  overlay.appendChild(scheduleCard);

  scheduleToggle.onchange = () => {
    scheduleEnabled = scheduleToggle.checked;
    scheduleFields.style.display = scheduleEnabled ? 'grid' : 'none';
  };

  downloadButton.onclick = () => {
    downloadButton.disabled = true;
    downloadButton.style.opacity = '0.5';
    void sendRuntimeMessage({
      type: 'START_VIDEO_DOWNLOAD',
      url,
      manifestType,
      selectedVariantId,
      schedule: currentSchedule(),
    }).then(() => {
      overlay.remove();
    }).catch((error) => {
      statusText.innerText = `Failed to start download: ${error instanceof Error ? error.message : String(error)}`;
      downloadButton.disabled = false;
      downloadButton.style.opacity = '1';
    });
  };
  buttonRow.appendChild(downloadButton);

  const dismissButton = document.createElement('button');
  dismissButton.innerText = 'Dismiss';
  dismissButton.style.backgroundColor = 'transparent';
  dismissButton.style.color = '#E4E3E0';
  dismissButton.style.border = '1px solid #E4E3E0';
  dismissButton.style.padding = '6px 12px';
  dismissButton.style.borderRadius = '4px';
  dismissButton.style.cursor = 'pointer';
  dismissButton.onclick = () => {
    overlay.remove();
  };
  buttonRow.appendChild(dismissButton);

  overlay.appendChild(buttonRow);
  document.body.appendChild(overlay);

  void sendRuntimeMessage({ type: 'INSPECT_VIDEO_MANIFEST', url, manifestType })
    .then((response: any) => {
      if (response?.error) {
        statusText.innerText = response.error;
        downloadButton.disabled = true;
        downloadButton.style.opacity = '0.5';
        downloadButton.style.cursor = 'not-allowed';
        return;
      }

      const variants = Array.isArray(response?.variants) ? response.variants : [];
      selectedVariantId = typeof response?.selectedVariantId === 'string' ? response.selectedVariantId : '';

      if (variants.length <= 1) {
        if (!selectedVariantId && variants[0]?.id) {
          selectedVariantId = variants[0].id;
        }
        statusText.innerText = variants[0] ? `Quality: ${variantLabel(variants[0])}` : 'Using detected stream quality';
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

      variantSelect.onchange = () => {
        selectedVariantId = variantSelect.value;
      };
      variantSelect.style.display = 'block';
      statusText.innerText = 'Choose a quality before starting the download.';
    })
    .catch((error) => {
      statusText.innerText = `Manifest inspection failed: ${error instanceof Error ? error.message : String(error)}`;
    });

  window.setTimeout(() => {
    if (overlay.isConnected) {
      overlay.remove();
    }
  }, 30_000);
}