import { readFileSync } from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import { crx, type ManifestV3Export } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

const extensionManifest = JSON.parse(
  readFileSync(path.resolve(__dirname, 'extension', 'manifest.json'), 'utf8'),
) as ManifestV3Export & Record<string, unknown>;

function buildExtensionManifest(targetBrowser: 'chrome' | 'firefox', firefoxExtensionId: string) {
  const manifest = JSON.parse(JSON.stringify(extensionManifest)) as ManifestV3Export & Record<string, unknown>;

  if (targetBrowser === 'firefox') {
    manifest.background = {
      scripts: ['extension/src/background/index.ts'],
      type: 'module',
    } as any;
    manifest.browser_specific_settings = {
      gecko: {
        id: firefoxExtensionId,
      },
    };
    return manifest;
  }

  manifest.background = {
    service_worker: 'extension/src/background/index.ts',
    type: 'module',
  };
  delete manifest.browser_specific_settings;
  return manifest;
}

export default defineConfig(({command, mode}) => {
  const env = loadEnv(mode, '.', '');
  const isBuild = command === 'build';
  const targetBrowser = env.TARGET_BROWSER === 'firefox' ? 'firefox' : 'chrome';
  const firefoxExtensionId = env.FIREFOX_EXTENSION_ID || 'tuyuldm@local.dev';
  const manifest = buildExtensionManifest(targetBrowser, firefoxExtensionId);

  return {
    plugins: [react(), tailwindcss(), ...(isBuild ? [crx({manifest, browser: targetBrowser})] : [])],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    build: isBuild
      ? {
          rollupOptions: {
            input: {
              dashboard: path.resolve(__dirname, 'index.html'),
              popup: path.resolve(__dirname, 'popup.html'),
              options: path.resolve(__dirname, 'options.html'),
            },
          },
        }
      : undefined,
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
