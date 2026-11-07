const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PROPOSERS = {
  'Canva wedding planner + day-of binder bundle': 'Template Designer',
  'Small business / Etsy-seller bookkeeping & profit spreadsheet': 'Category Researcher',
  'Notion life / business planner template': 'Niche Hunter',
  'Dated 2027 hyperlinked digital planner (GoodNotes/Notability, niche-themed)': 'Listing Analyst',
  'Google Sheets budget / paycheck budget spreadsheet (auto-calculating dashboard)': 'Competitor Tracker',
  'ATS-friendly resume + cover letter template kit (Word/Google Docs), job-specific versions': 'Template Designer',
  'Dated 2026-27 / 2027-28 teacher lesson planner (editable)': 'Content Planner',
  'Editable baby shower / party games & signs bundle (original themes)': 'Template Designer',
  'Original crochet pattern (PDF) collection': 'Category Researcher',
  'ADHD / neurodivergent-friendly daily planner': 'Niche Hunter',
};

function variance(pngPath) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', pngPath, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 * 1024 * 1024 });
  let n = 0;
  let sum = 0;
  let sum2 = 0;
  const step = Math.max(3, Math.floor(raw.length / 6000) * 3);
  for (let i = 0; i + 2 < raw.length; i += step) {
    const y = raw[i] * 0.2126 + raw[i + 1] * 0.7152 + raw[i + 2] * 0.0722;
    sum += y;
    sum2 += y * y;
    n++;
  }
  const mean = sum / n;
  return sum2 / n - mean * mean;
}

async function overflow(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const sw = document.documentElement.scrollWidth;
    const bw = document.body.scrollWidth;
    const off = [...document.querySelectorAll('body *')].filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      if (el.closest('#scene-still, #scene, .scene-wrap')) return false;
      return r.right > vw + 1 || r.left < -1;
    }).slice(0, 6).map((el) => `${el.tagName}.${el.className}`);
    return { sw, bw, vw, off };
  });
}

test('studio preview and research board', async ({ page }, testInfo) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.goto('/?v=' + Date.now(), { waitUntil: 'domcontentloaded' });

  await expect(page.locator('.banner')).toContainText('Preview — sample data, not real research');
  await expect(page.locator('#board .snapshot')).toHaveText('Research snapshot, Nov 7 2026: estimates from third-party trackers (MakerWords, RankHero, eRank); nothing is guaranteed');
  await expect(page.locator('#how-score h3')).toHaveText('How the score works');
  await expect(page.locator('#how-score')).toContainText('0.905 × price − $0.45');
  await expect(page.locator('#how-score')).toContainText('higher validation score ranks first');
  await expect(page.locator('#agents .eyebrow, #agents .head .eyebrow')).toContainText('Preview — sample data, not real research');

  const top = await (await page.request.get('/data/top10.json')).json();
  const preview = await (await page.request.get('/data/preview.json')).json();
  await expect(page.locator('[data-agent-section]')).toHaveCount(10);
  await expect(page.locator('#board-rows [data-rank]')).toHaveCount(10);

  const rows = await page.locator('#board-rows [data-rank]').evaluateAll((els) => els.map((el) => ({
    rank: Number(el.dataset.rank),
    product: el.dataset.product,
    combined: Number(el.dataset.combined),
    margin: Number(el.dataset.margin),
    validation: Number(el.dataset.validation),
    marginPct: Number(el.dataset.marginPct),
    net: Number(el.dataset.net),
    proposer: el.dataset.proposer,
    text: el.innerText,
    links: [...el.querySelectorAll('.evidence a')].map((a) => ({ href: a.href, label: a.textContent })),
  })));

  const ranked = [...top].sort((a, b) =>
    (b.margin_score + b.validation_score) - (a.margin_score + a.validation_score) ||
    b.validation_score - a.validation_score ||
    a.rank - b.rank
  );
  expect(rows.map((r) => r.product)).toEqual(ranked.map((p) => p.product));
  rows.forEach((row, i) => {
    const p = ranked[i];
    expect(row.rank).toBe(i + 1);
    expect(row.rank).toBe(p.rank);
    expect(row.combined).toBe(p.margin_score + p.validation_score);
    expect(row.combined).toBe(p.combined);
    expect(row.margin).toBe(p.margin_score);
    expect(row.validation).toBe(p.validation_score);
    expect(row.marginPct).toBe(p.margin_pct);
    expect(row.net).toBe(p.net_per_sale_usd);
    expect(row.proposer).toBe(PROPOSERS[p.product]);
    expect(row.text).toContain(p.why);
    expect(row.text).toContain(p.risks);
    expect(row.text.toLowerCase()).toContain(p.repeat_buyer ? 'repeat buyer' : 'not a repeat buyer');
    expect(row.text).toContain(String(p.validation_breakdown.demand));
    expect(row.text).toContain(String(p.validation_breakdown.proven_sales));
    expect(row.text).toContain(String(p.validation_breakdown.competition_gap));
    expect(row.text).toContain(String(p.validation_breakdown.repeat));
    expect(row.links.map((l) => l.href)).toEqual(p.evidence.map((e) => e.url));
    expect(row.links.map((l) => l.label)).toEqual(p.evidence.map((e) => e.label));
  });
  const byMargin = [...ranked].sort((a, b) => b.margin_pct - a.margin_pct || b.validation_score - a.validation_score).map((p) => p.product);
  expect(rows.map((r) => r.product)).not.toEqual(byMargin);

  const names = preview.agents.map((a) => a.name);
  expect(names).toEqual([
    'Category Researcher', 'Listing Analyst', 'Niche Hunter', 'Template Designer', 'SEO Copywriter',
    'Content Planner', 'Policy Researcher', 'Brand Designer', 'Competitor Tracker', 'Launch Lead',
  ]);
  for (const agent of preview.agents) {
    const card = page.locator(`[data-agent-section="${agent.id}"]`);
    await expect(card).toContainText(agent.task);
    await expect(card).toContainText('Example');
    await expect(card).toContainText('Sample');
  }

  await expect(page.locator('#shops-label')).toHaveText('public Etsy figures, Nov 2026');
  const shops = await page.locator('#shop-list a').evaluateAll((as) => as.map((a) => ({ href: a.href, text: a.innerText })));
  expect(shops.map((s) => s.href)).toEqual([
    'https://www.etsy.com/shop/HappyDownloads',
    'https://www.etsy.com/shop/MyLifePlans',
    'https://www.etsy.com/shop/PrioriDigitalStudio',
    'https://www.etsy.com/shop/LetsPlanPlanners',
    'https://www.etsy.com/shop/DigitalPlannerStart',
  ]);
  expect(shops[0].text).toContain('~229.9k sales');
  expect(shops[1].text).toContain('197.6k sales');
  expect(shops[1].text).toContain('4.9');
  expect(shops[2].text).toContain('177.9k sales');
  expect(shops[2].text).toContain('4.7');
  expect(shops[3].text).toContain('52.7k sales');
  expect(shops[4].text).toContain('43.4k sales');
  expect(shops[4].text).toContain('4.8');

  const box = await overflow(page);
  expect(box.sw, JSON.stringify(box)).toBeLessThanOrEqual(box.vw);
  expect(box.bw).toBeLessThanOrEqual(box.vw);
  expect(box.off).toEqual([]);

  await page.waitForFunction(() => {
    const w = document.querySelector('.scene-wrap');
    if (!w) return false;
    if (w.classList.contains('no3d')) return true;
    if (!w.classList.contains('is-3d')) return false;
    const canvas = document.querySelector('#scene');
    return parseFloat(getComputedStyle(canvas).opacity) > 0.85;
  }, { timeout: 15000 });

  const sceneState = await page.evaluate(() => {
    const w = document.querySelector('.scene-wrap');
    const canvas = document.querySelector('#scene');
    const img = document.querySelector('#scene-still img');
    const cs = getComputedStyle(canvas);
    const canvasShown = cs.display !== 'none' && parseFloat(cs.opacity) > 0.5 && canvas.getBoundingClientRect().height > 80;
    const stillShown = !!(img && img.complete && img.naturalWidth > 0 && getComputedStyle(img).display !== 'none' && img.getBoundingClientRect().height > 80 && getComputedStyle(img).visibility !== 'hidden');
    return {
      is3d: w.classList.contains('is-3d'),
      no3d: w.classList.contains('no3d'),
      frames: window.__studioFrames || 0,
      canvasShown,
      stillShown,
      natural: img ? img.naturalWidth : 0,
      wrapH: w.getBoundingClientRect().height,
    };
  });
  expect(sceneState.wrapH).toBeGreaterThan(300);
  expect(sceneState.natural).toBeGreaterThan(100);
  if (sceneState.is3d) {
    expect(sceneState.frames).toBeGreaterThanOrEqual(10);
    expect(sceneState.canvasShown).toBe(true);
  } else {
    expect(sceneState.no3d).toBe(true);
    expect(sceneState.canvasShown).toBe(false);
    expect(sceneState.stillShown).toBe(true);
  }
  if (testInfo.project.name === 'chromium-desktop') expect(sceneState.is3d).toBe(true);

  const shotDir = testInfo.outputPath('shots');
  fs.mkdirSync(shotDir, { recursive: true });
  const sceneShot = path.join(shotDir, 'scene.png');
  await page.locator('.scene-wrap').screenshot({ path: sceneShot });
  expect(variance(sceneShot)).toBeGreaterThan(80);

  await page.locator('#board').scrollIntoViewIfNeeded();
  const boardShot = path.join(shotDir, 'board.png');
  await page.locator('#board .rank-row').first().screenshot({ path: boardShot });
  const after = await overflow(page);
  expect(after.sw, JSON.stringify(after)).toBeLessThanOrEqual(after.vw);
  expect(after.off).toEqual([]);

  if (testInfo.project.name === 'chromium-desktop' && sceneState.is3d) {
    await page.locator('.scene-wrap').scrollIntoViewIfNeeded();
    await page.click('[data-view="interior"]');
    await page.waitForFunction(() => document.body.dataset.view === 'interior', { timeout: 5000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(shotDir, 'interior.png') });
    await page.evaluate(() => window.selectAgent('agent-03'));
    await expect(page.locator('#agent-card')).toContainText('Niche Hunter');
    await page.screenshot({ path: path.join(shotDir, 'agent.png') });
  }

  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});
