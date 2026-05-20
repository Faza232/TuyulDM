import { PAGE_HOOK_MESSAGE_TYPE, shouldReportMediaCandidate, type PageHookPayload } from '../shared/media_classify';

declare global {
  interface Window {
    __TUYULDM_PAGE_HOOK_INSTALLED__?: boolean;
  }
}

const mediaIds = new WeakMap<HTMLMediaElement, string>();
const xhrMeta = new WeakMap<XMLHttpRequest, {
  method: string;
  url: string;
  headers: Record<string, string>;
}>();

let counter = 0;

function nextCounter() {
  counter += 1;
  return counter;
}

function getFrameUrl() {
  return window.location.href;
}

function postPayload(payload: PageHookPayload) {
  window.postMessage({
    type: PAGE_HOOK_MESSAGE_TYPE,
    payload: {
      ...payload,
      counter: nextCounter(),
      frameUrl: getFrameUrl(),
    },
  }, '*');
}

function headerMapFromHeaders(headers: Headers | undefined | null) {
  const record: Record<string, string> = {};
  if (!headers) {
    return record;
  }

  for (const [key, value] of headers.entries()) {
    record[key] = value;
  }
  return record;
}

function headerMapFromInit(init: HeadersInit | undefined) {
  const record: Record<string, string> = {};
  if (!init) {
    return record;
  }

  if (init instanceof Headers) {
    return headerMapFromHeaders(init);
  }

  if (Array.isArray(init)) {
    for (const [key, value] of init) {
      record[String(key)] = String(value);
    }
    return record;
  }

  for (const [key, value] of Object.entries(init)) {
    if (Array.isArray(value)) {
      record[key] = value.join(', ');
      continue;
    }
    record[key] = String(value);
  }
  return record;
}

function getMediaId(element: HTMLMediaElement) {
  const existing = mediaIds.get(element);
  if (existing) {
    return existing;
  }

  const nextId = typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `media-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  mediaIds.set(element, nextId);
  return nextId;
}

function getPosterUrl(element: HTMLMediaElement) {
  return element instanceof HTMLVideoElement ? element.poster || '' : '';
}

function installFetchHook() {
  if ((window.fetch as any).__tuyulWrapped__) {
    return;
  }

  const originalFetch = window.fetch.bind(window);
  const wrappedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : undefined;
    const url = request?.url || String(input);
    const method = init?.method || request?.method || 'GET';
    const requestHeaders = {
      ...headerMapFromInit(request?.headers),
      ...headerMapFromInit(init?.headers),
    };

    const response = await originalFetch(input, init);
    const responseHeaders = headerMapFromHeaders(response.headers);
    const payload = {
      event: 'fetch' as const,
      url: response.url || url,
      method,
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      requestHeaders,
      responseHeaders,
    };
    if (shouldReportMediaCandidate(payload)) {
      postPayload(payload);
    }
    return response;
  };

  (wrappedFetch as any).__tuyulWrapped__ = true;
  window.fetch = wrappedFetch;
}

function installXHRHook() {
  if ((XMLHttpRequest.prototype.open as any).__tuyulWrapped__) {
    return;
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function patchedOpen(method: string, url: string | URL, ...rest: any[]) {
    xhrMeta.set(this, {
      method: String(method || 'GET'),
      url: String(url || ''),
      headers: {},
    });
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.setRequestHeader = function patchedSetRequestHeader(name: string, value: string) {
    const meta = xhrMeta.get(this);
    if (meta) {
      meta.headers[name] = value;
    }
    return originalSetRequestHeader.call(this, name, value);
  };

  XMLHttpRequest.prototype.send = function patchedSend(...args: any[]) {
    this.addEventListener('loadend', () => {
      const meta = xhrMeta.get(this);
      if (!meta) {
        return;
      }

      const rawHeaders = this.getAllResponseHeaders();
      const responseHeaders: Record<string, string> = {};
      for (const line of rawHeaders.split(/\r?\n/)) {
        const separator = line.indexOf(':');
        if (separator <= 0) {
          continue;
        }
        responseHeaders[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
      }

      const payload = {
        event: 'xhr' as const,
        url: this.responseURL || meta.url,
        method: meta.method,
        status: this.status,
        contentType: this.getResponseHeader('content-type') || '',
        requestHeaders: meta.headers,
        responseHeaders,
      };
      if (shouldReportMediaCandidate(payload)) {
        postPayload(payload);
      }
    }, { once: true });

    return originalSend.apply(this, args as any);
  };

  (XMLHttpRequest.prototype.open as any).__tuyulWrapped__ = true;
}

function installMediaSourceHooks() {
  const mediaSourcePrototype = (window as any).MediaSource?.prototype;
  if (mediaSourcePrototype?.addSourceBuffer && !(mediaSourcePrototype.addSourceBuffer as any).__tuyulWrapped__) {
    const originalAddSourceBuffer = mediaSourcePrototype.addSourceBuffer;
    mediaSourcePrototype.addSourceBuffer = function patchedAddSourceBuffer(type: string, ...rest: any[]) {
      postPayload({
        event: 'mse',
        url: '',
        mimeFromMSE: String(type || ''),
      });
      return originalAddSourceBuffer.call(this, type, ...rest);
    };
    (mediaSourcePrototype.addSourceBuffer as any).__tuyulWrapped__ = true;
  }

  if (!(URL.createObjectURL as any).__tuyulWrapped__) {
    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function patchedCreateObjectURL(object: MediaSource | Blob) {
      const blobUrl = originalCreateObjectURL(object);
      if ((window as any).MediaSource && object instanceof MediaSource) {
        postPayload({
          event: 'blob_created',
          url: blobUrl,
          blobUrl,
        });
      }
      return blobUrl;
    };
    (URL.createObjectURL as any).__tuyulWrapped__ = true;
  }
}

function installMediaSrcHook() {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  if (!descriptor?.set || (descriptor.set as any).__tuyulWrapped__) {
    return;
  }

  Object.defineProperty(HTMLMediaElement.prototype, 'src', {
    configurable: descriptor.configurable,
    enumerable: descriptor.enumerable,
    get: descriptor.get,
    set(value: string) {
      descriptor.set!.call(this, value);
      postPayload({
        event: 'media_src',
        url: String(value || ''),
        posterUrl: getPosterUrl(this),
        mediaId: getMediaId(this),
      });
    },
  });

  const currentDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  if (currentDescriptor?.set) {
    (currentDescriptor.set as any).__tuyulWrapped__ = true;
  }
}

if (!window.__TUYULDM_PAGE_HOOK_INSTALLED__) {
  window.__TUYULDM_PAGE_HOOK_INSTALLED__ = true;
  installFetchHook();
  installXHRHook();
  installMediaSourceHooks();
  installMediaSrcHook();
}
