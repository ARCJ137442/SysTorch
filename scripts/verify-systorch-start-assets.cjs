// Loopback-only Playwright check. Every /v1 request is synthetic; it never calls
// a real gateway or provider. This checks attachment placement and transport.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { mkdir } = require('node:fs/promises');
const path = require('node:path');

const base = process.argv[2] ?? 'http://127.0.0.1:5175';
assert.equal(new URL(base).hostname, '127.0.0.1', 'Only a loopback preview may be tested.');
const screenshots = path.resolve('.tmp/systorch-assets-ui');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pS8AAAAASUVORK5CYII=', 'base64');

async function main() {
  await mkdir(screenshots, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const desktopContext = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const desktop = await desktopContext.newPage();
  const uploads = [];
  const submissions = [];
  const systemOneRequests = [];
  const taskReads = [];
  let task = null;
  const fixtureHeaders = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'cache-control': 'no-store',
  };
  const json = async (route, body, status = 200) => route.fulfill({ status, headers: fixtureHeaders, contentType: 'application/json', body: JSON.stringify(body) });
  const handlers = async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: fixtureHeaders });
    if (url.pathname === '/v1/models') return json(route, { object: 'list', data: [{ id: 'typesafe-ai/jev', object: 'model', upstream: 'typesafe' }], upstreams: [] });
    if (url.pathname === '/v1/auth/me') return json(route, { id: 'asset-fixture-caller', role: 'admin' });
    if (url.pathname === '/v1/systorch/identity') return json(route, { id: 'asset-fixture-caller', can_answer: true, entry: 'human:owner', retention_seconds: 604800 });
    if (url.pathname === '/v1/systorch/decisions' && request.method() === 'GET') return json(route, task ? [task] : []);
    if (url.pathname === '/v1/systorch/assets' && request.method() === 'POST') {
      const bytes = request.postDataBuffer();
      const receipt = { asset_id: `uploaded_${uploads.length + 1}`, mime_type: request.headers()['content-type'], size_bytes: bytes.length, expires_at: Math.floor(Date.now() / 1000) + 86400 };
      uploads.push({ receipt, bytes, authorization: request.headers().authorization });
      return json(route, receipt, 201);
    }
    const taskAsset = url.pathname.match(/^\/v1\/systorch\/decisions\/([^/]+)\/assets\/([^/]+)$/);
    if (taskAsset && request.method() === 'GET') {
      const assetId = decodeURIComponent(taskAsset[2]);
      taskReads.push({ taskId: decodeURIComponent(taskAsset[1]), assetId, authorization: request.headers().authorization });
      const mime = assetId === 'uploaded_1' ? 'image/png' : 'video/mp4';
      return route.fulfill({ status: 200, headers: { ...fixtureHeaders, 'content-type': mime, 'x-content-type-options': 'nosniff' }, body: assetId === 'uploaded_1' ? png : Buffer.from([0, 0, 0, 0]) });
    }
    if (/^\/v1\/systorch\/assets\/[^/]+$/.test(url.pathname) && request.method() === 'DELETE') return route.fulfill({ status: 204, headers: fixtureHeaders });
    if (url.pathname === '/v1/systorch/decisions' && request.method() === 'POST') {
      const body = request.postDataJSON();
      submissions.push(body);
      const now = Math.floor(Date.now() / 1000);
      task = {
        id: 'asset-preview-task', caller: 'asset-fixture-caller', assignee: 'local-owner', revision: 1,
        status: 'pending', created_at: now, deadline: now + 3600, updated_at: now,
        request: body, observation: null, observations: {}, projection_policy: 'human-choice-one-hot/v1', previous_requests: [], clarifications: [],
      };
      return json(route, task, 202);
    }
    if (url.pathname === '/v1/systorch/decisions/asset-preview-task' && request.method() === 'GET') return json(route, task);
    if (url.pathname === '/v1/systemone') {
      const body = request.postDataJSON();
      systemOneRequests.push(body);
      return json(route, { model: body.model, answers: Object.fromEntries(Object.keys(body.questions).map(id => [id, { type: 'choice', choice: 'option1', probabilities: { option1: 1 }, confidence: 1 }])), upstream_calls: 1, latency_ms: 2 });
    }
    return json(route, { code: 'fixture_not_found', error: `No synthetic fixture for ${url.pathname}.` }, 404);
  };
  await desktopContext.route('**/v1/**', handlers);
  const pageErrors = [];
  desktop.on('pageerror', error => pageErrors.push(error.message));

  try {
    await desktop.goto(`${base.replace(/\/$/, '')}/#/start`, { waitUntil: 'domcontentloaded' });
    await desktop.getByLabel('调用方 / 主人 Token').fill('synthetic-caller-token');
    await desktop.getByRole('button', { name: '使用凭据' }).click();
    await desktop.getByLabel('决策问题').waitFor({ state: 'visible' });

    await desktop.getByText('共同背景（可选）', { exact: true }).click();
    await desktop.getByTestId('shared-image-input').setInputFiles({ name: 'shared.png', mimeType: 'image/png', buffer: png });
    await desktop.getByLabel('决策问题').fill('检查这张图和这段视频分别说明什么？');
    await desktop.getByLabel('候选方案 · 每行一个').fill('图像符合要求\n需要补充证据');
    await desktop.getByTestId('question-file-input').setInputFiles({ name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(300 * 1024, 7) });
    await assert.doesNotReject(desktop.getByTestId('attachment-chip').first().waitFor({ state: 'visible' }));

    const dimensionsBeforeSend = await desktop.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
      composer: Math.round(document.querySelector('[data-testid="decision-composer"]').getBoundingClientRect().bottom),
    }));
    assert(dimensionsBeforeSend.document <= dimensionsBeforeSend.viewport, 'desktop attachment chips must not create horizontal overflow');
    await desktop.screenshot({ path: path.join(screenshots, 'start-desktop-composer.png'), animations: 'disabled' });
    await desktop.getByRole('button', { name: '提交决策' }).click();
    await desktop.getByTestId('task-image-preview').waitFor({ state: 'visible' });
    await desktop.getByTestId('task-video-preview').waitFor({ state: 'visible' });
    assert.equal(uploads.length, 2, 'durable task media uses the encrypted asset store to keep its JSON request bounded');
    assert.equal(uploads[0].receipt.mime_type, 'image/png');
    assert.equal(uploads[0].bytes.toString('base64'), png.toString('base64'));
    assert.equal(uploads[1].receipt.mime_type, 'video/mp4');
    assert.equal(uploads[1].bytes.length, 300 * 1024);
    assert.ok(uploads.every(upload => upload.authorization === 'Bearer synthetic-caller-token'));
    assert.equal(submissions.length, 1);
    const request = submissions[0];
    const sharedRefs = request.state?._systorch?.assets ?? [];
    const questionRefs = request.questions?.[Object.keys(request.questions)[0]]?.instructions?._systorch?.assets ?? [];
    assert.equal(sharedRefs.length, 1, 'shared image remains attached to common context');
    assert.equal(questionRefs.length, 1, 'video remains attached to its question');
    assert.notEqual(sharedRefs[0], questionRefs[0], 'scopes keep separate stable references');
    assert.equal(request.assets[sharedRefs[0]].type, 'image');
    assert.equal(request.assets[sharedRefs[0]].asset_id, 'uploaded_1');
    assert.equal(request.assets[questionRefs[0]].type, 'video');
    assert.equal(request.assets[questionRefs[0]].asset_id, 'uploaded_2');
    await desktop.screenshot({ path: path.join(screenshots, 'start-desktop-task-assets.png'), animations: 'disabled' });
    assert(taskReads.length >= 1, 'the saved task reads the large attachment through its scoped authorization route');
    assert(taskReads.some(read => read.assetId === 'uploaded_1') && taskReads.some(read => read.assetId === 'uploaded_2'));
    assert(taskReads.every(read => read.authorization === 'Bearer synthetic-caller-token'));

    await desktop.getByRole('button', { name: '开启新会话' }).last().click();
    await desktop.getByText('当前入口: 交给我回答 · 持久人工 Choice').click();
    await desktop.getByLabel('当前入口').selectOption('model:typesafe-ai/jev');
    await desktop.getByLabel('决策问题').fill('立即决策图片中的对象？');
    await desktop.getByLabel('候选方案 · 每行一个').fill('目标是图表\n目标不是图表');
    await desktop.getByTestId('question-image-input').setInputFiles({ name: 'small.png', mimeType: 'image/png', buffer: png });
    await desktop.getByRole('button', { name: '提交决策' }).click();
    await desktop.getByRole('heading', { name: '立即决策图片中的对象？' }).waitFor({ state: 'visible' });
    assert.equal(uploads.length, 2, 'small bytes are inline on the immediate model path');
    assert.equal(submissions.length, 1);
    assert.equal(systemOneRequests.length, 1);
    const immediateRefs = systemOneRequests[0].questions[Object.keys(systemOneRequests[0].questions)[0]].instructions._systorch.assets;
    assert.equal(systemOneRequests[0].assets[immediateRefs[0]].data_base64, png.toString('base64'));
    assert.equal(systemOneRequests[0].assets[immediateRefs[0]].asset_id, undefined);
    assert.equal(pageErrors.length, 0);

    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    await mobileContext.route('**/v1/**', handlers);
    const mobile = await mobileContext.newPage();
    mobile.on('pageerror', error => pageErrors.push(error.message));
    await mobile.goto(`${base.replace(/\/$/, '')}/#/start`, { waitUntil: 'domcontentloaded' });
    await mobile.getByLabel('调用方 / 主人 Token').fill('synthetic-caller-token');
    await mobile.getByRole('button', { name: '使用凭据' }).click();
    await mobile.waitForResponse(response => new URL(response.url()).pathname === '/v1/systorch/decisions' && response.url().includes('offset=0') && response.status() === 200);
    await mobile.getByLabel('决策问题').waitFor({ state: 'visible' });
    await mobile.getByTestId('question-camera-input').waitFor({ state: 'attached' });
    const camera = await mobile.getByTestId('question-camera-input').evaluate(input => ({ capture: input.getAttribute('capture'), accept: input.getAttribute('accept') }));
    assert.deepEqual(camera, { capture: 'environment', accept: 'image/*' });
    await mobile.getByTestId('question-image-input').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png });
    await mobile.getByLabel('决策问题').fill('这个手机图片里有什么？');
    await mobile.getByLabel('候选方案 · 每行一个').fill('A\nB');
    const mobileLayout = await mobile.evaluate(() => ({ width: document.documentElement.clientWidth, document: document.documentElement.scrollWidth, composer: document.querySelector('[data-testid="decision-composer"]').getBoundingClientRect().bottom, viewport: window.innerHeight }));
    assert(mobileLayout.document <= mobileLayout.width, 'mobile attachments must not create horizontal overflow');
    assert(mobileLayout.composer <= mobileLayout.viewport, 'composer remains reachable in the first mobile viewport');
    const mobileChipCount = await mobile.getByTestId('attachment-chip').count();
    const mobileFileCount = await mobile.getByTestId('question-image-input').evaluate(input => input.files.length);
    if (mobileChipCount !== 1) await mobile.screenshot({ path: path.join(screenshots, 'start-mobile-attachment-failure.png'), animations: 'disabled' });
    assert.equal(mobileChipCount, 1, `mobile picker file count=${mobileFileCount}; errors=${pageErrors.join('; ')}`);
    await mobile.screenshot({ path: path.join(screenshots, 'start-mobile-attachment.png'), animations: 'disabled' });
    assert.deepEqual(pageErrors, []);
    await mobileContext.close();
    console.log(JSON.stringify({ uploads: uploads.length, taskSubmissions: submissions.length, immediateModelRequests: systemOneRequests.length, scopedTaskAssetReads: taskReads.length, desktop: dimensionsBeforeSend, mobile: mobileLayout, pageErrors, screenshots }, null, 2));
  } finally {
    await desktopContext.close();
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
