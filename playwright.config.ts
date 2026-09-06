import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', workers: 1, timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 1280, height: 900 }, headless: true,
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
      ...(process.env.GAZE_CHROMIUM_PATH ? { executablePath: process.env.GAZE_CHROMIUM_PATH } : {}),
    },
  },
  webServer: { command: 'npm run dev -- --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
});
