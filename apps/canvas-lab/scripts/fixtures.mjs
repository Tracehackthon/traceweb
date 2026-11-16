import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public/fixtures');
const tmp = path.resolve(root, '../../.test-results/canvas-lab/browser-tmp');
fs.mkdirSync(tmp, { recursive: true }); process.env.TEMP = tmp; process.env.TMP = tmp; process.env.TMPDIR = tmp;
const result = spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=360x200:rate=12:duration=4', '-an', '-c:v', 'libvpx-vp9', '-b:v', '180k', path.join(out, 'clip.webm')], { windowsHide: true, encoding: 'utf8' });
if (result.status) throw new Error(result.stderr);
const audio = spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:a', 'pcm_s16le', path.join(out, 'tone.wav')], { windowsHide: true, encoding: 'utf8' });
if (audio.status) throw new Error(audio.stderr);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 680, height: 460 }, deviceScaleFactor: 1 });
  await page.setContent(fs.readFileSync(path.join(out, 'source.html'), 'utf8'));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(out, 'screenshot.png') });
  await page.setViewportSize({ width: 680, height: 600 });
  await page.setContent(fs.readFileSync(path.join(out, 'paper.html'), 'utf8'));
  await page.evaluate(() => document.fonts.ready);
  const region = await page.locator('#pdf-selection').boundingBox();
  await page.locator('#pdf-selection').screenshot({ path: path.join(out, 'pdf-region.png') });
  await page.pdf({ path: path.join(out, 'paper.pdf'), width: '680px', height: '600px', margin: { top: 0, right: 0, bottom: 0, left: 0 }, printBackground: true });
  fs.writeFileSync(path.join(out, 'provenance.json'), JSON.stringify({ author: 'Trace Canvas Lab synthetic fixtures', screenshot: { source: 'source.html', viewportCssPx: [680, 460] }, pdf: { source: 'paper.html', page: 1, pageSizePoints: [510, 450], regionCssPx: region, regionPdfPoints: [region.x, region.y, region.width, region.height].map(n => n * .75), note: 'Crop rendered from the same fixed-layout HTML used to print the PDF. No PDF extraction feature is claimed.' } }, null, 2));
} finally { await browser.close(); }
fs.writeFileSync(path.join(out, 'ASSETS.md'), '# Self-authored test fixtures\n\nAll HTML, screenshots, PDF and synthetic test-pattern video / sine audio were produced locally by `npm run fixtures`. No user materials, API calls or downloaded media.\n\nSource locator ranges are fixture metadata used to test preservation; this is not a PDF extraction implementation.\n');
console.log('Created local-only PNG, PDF, WebM and WAV fixtures.');
