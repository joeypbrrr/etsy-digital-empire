const { defineConfig, devices } = require('@playwright/test');

const glArgs = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

module.exports = defineConfig({
  testDir: 'tests',
  timeout: 90000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4173' },
  webServer: {
    command: 'python3 -m http.server 4173 --bind 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 20000,
  },
  projects: [
    {
      name: 'chromium-phone',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
        launchOptions: { args: glArgs },
      },
    },
    {
      name: 'chromium-desktop',
      use: {
        browserName: 'chromium',
        viewport: { width: 1440, height: 900 },
        launchOptions: { args: glArgs },
      },
    },
    {
      name: 'webkit-iphone13',
      use: { ...devices['iPhone 13'] },
    },
  ],
});
