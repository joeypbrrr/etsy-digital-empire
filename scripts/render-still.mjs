import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const port = 4173;
const outPng = '/tmp/scene-still.png';

const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 400));

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', (err) => console.error('PAGE', err.message));
  page.on('console', (msg) => { if (msg.type() === 'error') console.error('CONSOLE', msg.text()); });
  await page.goto(`http://127.0.0.1:${port}/?capture=1`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForFunction(() => window.__studioConfirmed === true && window.__studioDressed === true, { timeout: 25000 });
  await page.evaluate(() => {
    const canvas = document.getElementById('scene');
    canvas.style.transition = 'none';
    canvas.style.opacity = '1';
    document.querySelectorAll('.scene-title, .scene-controls, .scene-hint, #agent-card, #scene-fade').forEach((el) => {
      el.style.display = 'none';
    });
  });
  await page.waitForTimeout(400);
  await page.locator('#scene').screenshot({ path: outPng });
  const frames = await page.evaluate(() => window.__studioFrames);
  console.log('frames', frames, 'png', fs.statSync(outPng).size);
} finally {
  await browser.close();
  server.kill();
}

const assets = path.join(root, 'assets');
fs.mkdirSync(assets, { recursive: true });
execFileSync('ffmpeg', ['-y', '-i', outPng, '-vf', 'scale=1600:-1', '-q:v', '4', '-update', '1', path.join(assets, 'scene-still.jpg')]);
execFileSync('ffmpeg', ['-y', '-i', outPng, '-vf', 'scale=1600:-1', '-c:v', 'libwebp', '-quality', '78', path.join(assets, 'scene-still.webp')]);
console.log('wrote', fs.statSync(path.join(assets, 'scene-still.jpg')).size, fs.statSync(path.join(assets, 'scene-still.webp')).size);
