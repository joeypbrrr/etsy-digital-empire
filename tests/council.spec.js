const { test, expect } = require('@playwright/test');

const TOKEN = 'github_pat_TESTVALUE123';
const REPO = 'joeypbrrr/etsy-digital-empire';

function issue(number, extra) {
  return Object.assign({
    number,
    state: 'open',
    user: { login: 'github-actions[bot]' },
    html_url: `https://github.com/${REPO}/issues/${number}`,
    labels: [],
  }, extra);
}

function header(lines) {
  return `<!-- council\n${lines}\n-->\n\n`;
}

const ISSUES = [
  issue(12, {
    created_at: '2026-11-07T16:00:00Z',
    updated_at: '2026-11-07T17:00:00Z',
    title: '[SAMPLE] Category Researcher pitch',
    labels: [
      { name: 'pitch' },
      { name: 'agent:category-researcher' },
      { name: 'sample' },
      { name: 'status:declined' },
      { name: 'status:revised' },
    ],
    body: header('agent: category-researcher\nniche: Etsy digital products\nsample: true')
      + 'SAMPLE / stub. I would file one sourced category note. Not research.',
  }),
  issue(18, {
    created_at: '2026-11-07T18:20:00Z',
    updated_at: '2026-11-07T18:30:00Z',
    title: '[SAMPLE] Category Researcher revises #12',
    labels: [
      { name: 'pitch' },
      { name: 'agent:category-researcher' },
      { name: 'sample' },
      { name: 'status:pending' },
    ],
    body: header('agent: category-researcher\nniche: Etsy digital products\nrevision of: #12\nsample: true')
      + 'SAMPLE / stub. Narrowed after your decline. Not research.',
  }),
  issue(20, {
    created_at: '2026-11-07T18:00:00Z',
    updated_at: '2026-11-07T18:10:00Z',
    title: '[SAMPLE] Listing Analyst pitch',
    labels: [
      { name: 'pitch' },
      { name: 'agent:listing-analyst' },
      { name: 'sample' },
      { name: 'status:pending' },
    ],
    body: header('agent: listing-analyst\nniche: Etsy digital products\nsample: true')
      + 'SAMPLE / stub. I would study one public listing. Not research.',
  }),
];

const COMMENTS = {
  12: [
    {
      id: 501,
      body: '/decline too vague',
      user: { login: 'joeypbrrr' },
      created_at: '2026-11-07T16:30:00Z',
      html_url: `https://github.com/${REPO}/issues/12#issuecomment-501`,
    },
  ],
};

function cors(extra) {
  return Object.assign({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'ETag, Link',
    'Content-Type': 'application/json',
  }, extra);
}

async function installApi(page, options) {
  const writes = [];
  const listHits = [];
  const userLogin = options.userLogin || 'joeypbrrr';
  const browserName = page.context().browser().browserType().name();
  await page.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.url().includes(TOKEN)) throw new Error('token leaked into a URL');
    if (req.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, If-None-Match, X-GitHub-Api-Version',
        },
      });
      return;
    }
    const authorization = req.headers().authorization || '';
    if (req.method() === 'GET' && url.pathname !== '/user' && authorization) {
      throw new Error(`unsigned read sent a token: ${url.pathname}`);
    }
    if (req.method() === 'GET' && url.pathname.endsWith('/issues') && url.searchParams.get('labels') === 'pitch') {
      listHits.push(req.headers()['if-none-match'] || '');
      if (req.headers()['if-none-match'] === '"pitches-v1"') {
        // WebKit refuses route.fulfill with status 304. Chromium exercises the real 304 path.
        if (browserName === 'webkit') {
          await route.fulfill({
            status: 200,
            headers: cors({ ETag: '"pitches-v1"' }),
            body: JSON.stringify(ISSUES),
          });
        } else {
          await route.fulfill({ status: 304, body: '', headers: cors({ ETag: '"pitches-v1"' }) });
        }
        return;
      }
      await route.fulfill({
        status: 200,
        headers: cors({ ETag: '"pitches-v1"' }),
        body: JSON.stringify(ISSUES),
      });
      return;
    }
    const commentGet = url.pathname.match(/\/issues\/(\d+)\/comments$/);
    if (req.method() === 'GET' && commentGet) {
      await route.fulfill({
        status: 200,
        headers: cors(),
        body: JSON.stringify(COMMENTS[commentGet[1]] || []),
      });
      return;
    }
    if (req.method() === 'GET' && url.pathname === '/user') {
      await route.fulfill({
        status: 200,
        headers: cors(),
        body: JSON.stringify({ login: userLogin }),
      });
      return;
    }
    if (req.method() === 'POST' && commentGet) {
      const body = JSON.parse(req.postData());
      writes.push({ method: 'POST', path: url.pathname, body, authorization });
      await route.fulfill({
        status: 201,
        headers: cors(),
        body: JSON.stringify({
          id: 900 + writes.length,
          body: body.body,
          user: { login: 'joeypbrrr' },
          created_at: '2026-11-07T18:40:00Z',
        }),
      });
      return;
    }
    if (req.method() === 'PATCH' && /\/issues\/\d+$/.test(url.pathname)) {
      const body = JSON.parse(req.postData());
      writes.push({ method: 'PATCH', path: url.pathname, body, authorization });
      await route.fulfill({
        status: 200,
        headers: cors(),
        body: JSON.stringify({
          labels: body.labels.map((name) => ({ name })),
          updated_at: '2026-11-07T18:40:00Z',
        }),
      });
      return;
    }
    throw new Error(`unexpected ${req.method()} ${req.url()}`);
  });
  return { writes, listHits };
}

async function openCouncil(page) {
  await page.goto('/council/?v=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('thread-12')).toBeVisible();
}

async function connect(page, token) {
  await page.getByTestId('connect').click();
  await expect(page.getByTestId('connect-panel')).toBeVisible();
  await expect(page.getByTestId('connect-panel')).toContainText('fine-grained');
  await expect(page.getByTestId('connect-panel')).toContainText('localStorage');
  await expect(page.getByTestId('connect-panel')).toContainText('api.github.com');
  await expect(page.getByTestId('connect-panel')).toContainText('Issues');
  await expect(page.getByTestId('repo-name')).toHaveText(REPO);
  await page.getByTestId('token-input').fill(token || TOKEN);
  await page.getByTestId('save-token').click();
  await expect(page.getByTestId('who')).toContainText('@joeypbrrr');
}

test('home page links to the council', async ({ request }) => {
  const html = await (await request.get('/')).text();
  expect(html).toContain('href="council/"');
  expect(html).toContain('Open the pitch thread');
  expect(html).toContain('Ten agents building');
});

test('pitch thread renders the chain, chips, and New York time', async ({ page }, testInfo) => {
  await installApi(page, {});
  await openCouncil(page);

  await expect(page.locator('body')).toHaveAttribute('data-refresh-ms', '20000');
  await expect(page.getByTestId('sample-banner')).toContainText('SAMPLE / stub');
  await expect(page.getByTestId('threads')).not.toContainText('<!--');

  const threads = page.getByTestId('threads').locator('[data-testid^="thread-"]');
  await expect(threads).toHaveCount(2);
  await expect(threads.nth(0)).toHaveAttribute('data-testid', 'thread-12');
  await expect(page.getByTestId('thread-12')).toContainText('Category Researcher');
  await expect(page.getByTestId('chain-12')).toContainText('Revision chain: #12 → #18');
  await expect(page.getByTestId('pitch-18')).toContainText('Revises #12');
  await expect(page.getByTestId('pitch-18')).toContainText('Narrowed after your decline');
  await expect(page.getByTestId('statuses-12')).toContainText('declined');
  await expect(page.getByTestId('statuses-12')).toContainText('revised');
  await expect(page.getByTestId('statuses-12')).toContainText('sample');
  await expect(page.getByTestId('statuses-18')).toContainText('pending');
  await expect(page.getByTestId('pitch-12')).toContainText('/decline too vague');
  await expect(page.getByTestId('comment-501')).toHaveAttribute('data-from', 'owner');
  await expect(page.getByTestId('thread-20')).toContainText('Listing Analyst');
  await expect(page.getByTestId('approve-12')).toHaveCount(0);

  const stamp = await page.evaluate((iso) => new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(iso)), '2026-11-07T18:00:00Z');
  const time = page.getByTestId('time-20');
  await expect(time).toHaveAttribute('data-timezone', 'America/New_York');
  await expect(time).toHaveText(stamp);
  expect(stamp).not.toContain('6:00');

  const box = await page.getByTestId('approve-18').boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  const viewport = page.viewportSize();
  if (testInfo.project.name === 'chromium-phone') {
    expect(viewport).toEqual({ width: 390, height: 844 });
  }
  if (testInfo.project.name !== 'chromium-desktop') {
    expect(viewport.width).toBe(390);
  }
  const overflow = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    bw: document.body.scrollWidth,
    vw: document.documentElement.clientWidth,
  }));
  expect(overflow.sw).toBeLessThanOrEqual(overflow.vw + 1);
  expect(overflow.bw).toBeLessThanOrEqual(overflow.vw + 1);

  await expect(page.getByTestId('fallback-18')).toContainText('/approve');
  await expect(page.getByTestId('fallback-18')).toContainText('/decline');
  await expect(page.getByTestId('approve-18')).toHaveAttribute('href', `https://github.com/${REPO}/issues/18`);
  await expect(page.getByTestId('decline-20')).toHaveAttribute('href', `https://github.com/${REPO}/issues/20`);
});

test('refresh sends If-None-Match and keeps the thread', async ({ page }) => {
  await page.clock.install();
  const api = await installApi(page, {});
  await openCouncil(page);
  expect(api.listHits).toEqual(['']);
  const second = page.waitForRequest((req) => {
    const url = new URL(req.url());
    return req.method() === 'GET'
      && url.pathname.endsWith('/issues')
      && url.searchParams.get('labels') === 'pitch'
      && req.headers()['if-none-match'] === '"pitches-v1"';
  });
  await page.clock.fastForward(25000);
  await second;
  await expect(page.getByTestId('pitch-18')).toContainText('Narrowed after your decline');
  expect(api.listHits[1]).toBe('"pitches-v1"');
  const browserName = page.context().browser().browserType().name();
  await expect(page.getByTestId('status')).toHaveAttribute('data-fetch', browserName === 'webkit' ? '200' : '304');
  await expect(page.getByTestId('status')).toContainText('refreshes every 20');
});

test('approve and decline call GitHub with the token, then disconnect', async ({ page }) => {
  const api = await installApi(page, {});
  await openCouncil(page);
  await connect(page);

  const stored = await page.evaluate((repo) => localStorage.getItem('council.githubToken.v1:' + repo), REPO);
  expect(stored).toBe(TOKEN);
  expect(await page.content()).not.toContain(TOKEN);

  await page.getByTestId('approve-20').click();
  await expect(page.getByTestId('statuses-20')).toContainText('approved');
  await expect(page.getByTestId('statuses-20')).toContainText('working');
  await expect(page.getByTestId('statuses-20')).not.toContainText('pending');
  await expect(page.getByTestId('pitch-20')).toContainText('/approve');

  await page.getByTestId('decline-18').click();
  await expect(page.getByTestId('decline-reason-18')).toBeVisible();
  await page.getByTestId('decline-reason-18').fill('too broad');
  await page.getByTestId('decline-send-18').click();
  await expect(page.getByTestId('statuses-18')).toContainText('declined');
  await expect(page.getByTestId('statuses-18')).not.toContainText('pending');
  await expect(page.getByTestId('pitch-18')).toContainText('/decline too broad');

  expect(api.writes).toEqual([
    {
      method: 'POST',
      path: `/repos/${REPO}/issues/20/comments`,
      body: { body: '/approve' },
      authorization: `Bearer ${TOKEN}`,
    },
    {
      method: 'PATCH',
      path: `/repos/${REPO}/issues/20`,
      body: {
        labels: ['agent:listing-analyst', 'pitch', 'sample', 'status:approved', 'status:working'],
      },
      authorization: `Bearer ${TOKEN}`,
    },
    {
      method: 'POST',
      path: `/repos/${REPO}/issues/18/comments`,
      body: { body: '/decline too broad' },
      authorization: `Bearer ${TOKEN}`,
    },
    {
      method: 'PATCH',
      path: `/repos/${REPO}/issues/18`,
      body: {
        labels: ['agent:category-researcher', 'pitch', 'sample', 'status:declined'],
      },
      authorization: `Bearer ${TOKEN}`,
    },
  ]);

  await page.getByTestId('disconnect').click();
  await expect(page.getByTestId('who')).toBeHidden();
  const after = await page.evaluate((repo) => localStorage.getItem('council.githubToken.v1:' + repo), REPO);
  expect(after).toBeNull();
  await expect(page.getByTestId('approve-18')).toHaveAttribute('href', `https://github.com/${REPO}/issues/18`);
});

test('a token for someone else is refused', async ({ page }) => {
  await installApi(page, { userLogin: 'someone-else' });
  await openCouncil(page);
  await page.getByTestId('connect').click();
  await page.getByTestId('token-input').fill(TOKEN);
  await page.getByTestId('save-token').click();
  await expect(page.getByTestId('connect-error')).toContainText('@someone-else');
  await expect(page.getByTestId('connect-error')).toContainText('@joeypbrrr');
  const stored = await page.evaluate((repo) => localStorage.getItem('council.githubToken.v1:' + repo), REPO);
  expect(stored).toBeNull();
  await expect(page.getByTestId('approve-20')).toHaveAttribute('href', /\/issues\/20$/);
});

test('without a token, approve opens the GitHub issue and does not post', async ({ page }) => {
  const api = await installApi(page, {});
  await page.route('https://github.com/**', (route) => {
    route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>issue</title>' });
  });
  await openCouncil(page);
  const popupPromise = page.waitForEvent('popup');
  await page.getByTestId('approve-20').click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(`https://github.com/${REPO}/issues/20`);
  await popup.close();
  expect(api.writes).toEqual([]);
});
