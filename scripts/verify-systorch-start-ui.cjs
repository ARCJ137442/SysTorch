// Optional Playwright regression for the production Start page. Start a local
// Vite server first. Every /v1 request is intercepted and answered with synthetic
// fixtures; this script never contacts a real gateway or upstream provider.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.argv[2] ?? 'http://127.0.0.1:5175';
assert.equal(new URL(base).hostname, '127.0.0.1', 'Only a loopback preview may be tested.');
const appUrl = base.replace(/\/$/, '');
let browser;

async function main() {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const page = await context.newPage();
  const systemOneRequests = [];
  const durableRequests = [];
  const answerRequests = [];
  let uploadedAssetCount = 0;
  let submittedTask = null;
  const headers = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
  };
  const now = Math.floor(Date.now() / 1000);
  const task = {
    id: 'decision-preview-001', caller: 'test-caller', assignee: 'human:owner', revision: 1,
    status: 'completed', created_at: now - 60, deadline: now + 3600, updated_at: now,
    request: {
      entry: 'human:owner', idempotency_key: 'preview-key', question: '首屏图片输入体验',
      context: { source: 'synthetic browser fixture' },
      choices: [{ id: 'option1', label: '现在适合推进吗？' }, { id: 'option2', label: '先补充测试' }], ttl_seconds: 3600,
    },
    observation: { kind: 'answered', choice_id: 'option1' }, projection_policy: 'human-choice-one-hot/v1',
    previous_requests: [], clarifications: [],
  };
  await context.route('**/v1/**', async route => {
    const url = new URL(route.request().url());
    let body = {};
    let responseStatus = 200;
    if (url.pathname === '/v1/models') body = { object: 'list', data: [{ id: 'typesafe-ai/jev', object: 'model', upstream: 'typesafe' }], upstreams: [] };
    else if (url.pathname === '/v1/auth/me') body = { id: 'test-caller', role: 'admin' };
    else if (url.pathname === '/v1/systorch/identity') body = { id: 'test-caller', can_answer: true, entry: 'human:owner', retention_seconds: 604800 };
    else if (url.pathname === '/v1/systorch/assets' && route.request().method() === 'POST') {
      const bytes = route.request().postDataBuffer();
      assert.ok(bytes?.length, 'synthetic image attachment must upload bytes');
      uploadedAssetCount += 1;
      responseStatus = 201;
      body = { asset_id: `asset-ui-${uploadedAssetCount}`, mime_type: 'image/png', size_bytes: bytes.length, expires_at: now + 86400 };
    }
    else if (/^\/v1\/systorch\/assets\/[^/]+$/.test(url.pathname) && route.request().method() === 'DELETE') {
      await route.fulfill({ status: 204, headers });
      return;
    }
    else if (url.pathname === '/v1/systorch/decisions' && route.request().method() === 'GET') body = [submittedTask, task].filter(Boolean);
    else if (url.pathname === '/v1/systorch/decisions' && route.request().method() === 'POST') {
      const request = route.request().postDataJSON();
      durableRequests.push(request);
      responseStatus = 202;
      submittedTask = {
        id: 'decision-preview-multi-001', caller: 'test-caller', assignee: 'human:owner', revision: 1,
        status: 'pending', created_at: now, deadline: now + 3600, updated_at: now,
        request, observation: null, observations: {}, projection_policy: 'human-choice-one-hot/v1', previous_requests: [], clarifications: [],
      };
      body = submittedTask;
    }
    else if (url.pathname === '/v1/systorch/decisions/decision-preview-multi-001/answers' && route.request().method() === 'POST') {
      const answer = route.request().postDataJSON();
      answerRequests.push(answer);
      submittedTask = { ...submittedTask, status: 'completed', updated_at: Math.floor(Date.now() / 1000), observations: answer.observations };
      body = submittedTask;
    }
    else if (url.pathname === '/v1/systorch/decisions/decision-preview-multi-001' && route.request().method() === 'GET') body = submittedTask;
    else if (url.pathname === '/v1/systemone' && route.request().method() === 'POST') {
      const request = route.request().postDataJSON();
      systemOneRequests.push(request);
      const answers = Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
        const choiceIds = Object.keys(question.criteria);
        return [id, { type: 'choice', choice: choiceIds[0], probabilities: Object.fromEntries(choiceIds.map((key, index) => [key, index === 0 ? 1 : 0])), confidence: 1 }];
      }));
      body = { model: request.model, answers, upstream_calls: 1, latency_ms: 12 };
    }
    else if (url.pathname === '/health') body = { status: 'ok', version: '0.11.0', brand: 'SysTorch', product: 'jev-switch', api_revision: 1 };
    else {
      await route.fulfill({ status: 404, headers, contentType: 'application/json', body: JSON.stringify({ code: 'fixture_not_found', error: 'No synthetic fixture for this endpoint.' }) });
      return;
    }
    await route.fulfill({ status: responseStatus, headers, contentType: 'application/json', body: JSON.stringify(body) });
  });

  const pageErrors = [];
  const apiResponses = [];
  context.on('response', response => { if (response.url().includes('/v1/')) apiResponses.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`${appUrl}/#/start`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('决策问题').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '开启新会话' }).last().waitFor({ state: 'visible' });
  await page.getByLabel('调用方 / 主人 Token').fill('fixture-caller-token');
  await page.getByRole('button', { name: '使用凭据' }).click();
  await page.getByRole('button', { name: /首屏图片输入体验/ }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: /首屏图片输入体验/ }).click();
  await page.getByText('现在适合推进吗？', { exact: true }).first().waitFor({ state: 'visible' });
  await page.getByLabel('会话操作').click();
  await page.getByRole('button', { name: '置顶' }).click();
  await page.getByLabel('会话操作').click();
  await page.getByRole('button', { name: '归档', exact: true }).click();
  await page.getByText('已归档会话', { exact: true }).click();
  await page.getByRole('button', { name: /首屏图片输入体验/ }).waitFor({ state: 'visible' });
  const storedIndex = await page.evaluate(() => localStorage.getItem('systorch:start-session-index:v1'));
  assert.ok(storedIndex?.includes('decision-preview-001'));
  assert.ok(!storedIndex?.includes('首屏图片输入体验'));
  await page.getByRole('link', { name: '设置' }).click();
  await page.getByRole('heading', { name: '已归档会话' }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '恢复', exact: true }).click();
  await page.getByRole('link', { name: '开始' }).click();
  await page.getByRole('button', { name: '开启新会话' }).last().click();
  await page.getByLabel('决策问题').fill('问题 A：先检查什么？');
  await page.getByLabel('候选方案 · 每行一个').fill('先补齐测试\n直接发布');
  await page.getByRole('button', { name: '将当前问题加入队列' }).click();
  await page.getByLabel('问题类型').selectOption('score');
  await page.getByLabel('决策问题').fill('问题 B：如何处理风险？');
  await page.getByLabel('有序等级 (2–10)').fill('低\n中\n高');
  await page.getByRole('button', { name: '将当前问题加入队列' }).click();
  await page.getByLabel('问题类型').selectOption('noul');
  await page.getByLabel('决策问题').fill('问题 C：是否满足发布条件？');
  await page.getByLabel('是 / 否文案（可选）').fill('满足\n不满足');
  await page.getByRole('button', { name: '将当前问题加入队列' }).click();
  await page.getByLabel('问题类型').selectOption('box');
  await page.getByLabel('决策问题').fill('问题 D：标出图表中的峰值区域。');
  await page.getByTestId('question-image-input').setInputFiles({ name: 'synthetic-box.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ZkAAAAASUVORK5CYII=', 'base64') });
  await page.getByRole('button', { name: '提交决策' }).click();
  await page.locator('.decision-user-message').getByText('问题 A：先检查什么？', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(durableRequests.length, 1, 'a queued human decision is one durable task');
  assert.deepEqual(durableRequests[0].question_order, Object.keys(durableRequests[0].questions));
  assert.equal(durableRequests[0].model, 'human:owner');
  assert.equal(durableRequests[0].state, '');
  assert.equal(durableRequests[0].question, undefined, 'new submissions use the TypeSafe-compatible core instead of legacy mirrors');
  assert.deepEqual(durableRequests[0].questions[durableRequests[0].question_order[0]], { type: 'choice', instructions: '问题 A：先检查什么？', criteria: { option1: '先补齐测试', option2: '直接发布' } });
  assert.equal(durableRequests[0].questions[durableRequests[0].question_order[1]].type, 'score');
  assert.deepEqual(durableRequests[0].questions[durableRequests[0].question_order[1]].criteria, ['低', '中', '高']);
  assert.equal(durableRequests[0].questions[durableRequests[0].question_order[2]].type, 'noul');
  assert.equal(durableRequests[0].questions[durableRequests[0].question_order[3]].type, 'box');
  assert.equal(uploadedAssetCount, 1);
  const multiTaskIndex = await page.evaluate(() => localStorage.getItem('systorch:start-session-index:v1'));
  assert.ok(!multiTaskIndex?.includes('问题 A：先检查什么？') && !multiTaskIndex?.includes('问题 B：如何处理风险？'), 'browser session index stores IDs/preferences, not question bodies');
  assert.equal(systemOneRequests.length, 0, 'human choice mode must not call SystemOne');

  await page.goto(`${appUrl}/#/desk?task=decision-preview-multi-001`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('radio', { name: '先补齐测试' }).check();
  await page.getByRole('radio', { name: '2 · 高' }).check();
  await page.getByRole('radio', { name: '满足', exact: true }).check();
  await page.getByLabel('问题 D：标出图表中的峰值区域。 · 上 (0–1)').fill('0.1');
  await page.getByLabel('问题 D：标出图表中的峰值区域。 · 下 (0–1)').fill('0.8');
  await page.getByLabel('问题 D：标出图表中的峰值区域。 · 左 (0–1)').fill('0.2');
  await page.getByLabel('问题 D：标出图表中的峰值区域。 · 右 (0–1)').fill('0.9');
  await page.getByRole('button', { name: '提交回答', exact: true }).click();
  assert.equal(answerRequests.length, 1, 'the owner submits one atomic answer map for the message');
  assert.deepEqual(Object.keys(answerRequests[0].observations).sort(), Object.keys(durableRequests[0].questions).sort());
  assert.equal(answerRequests[0].observations[durableRequests[0].question_order[0]].kind, 'answered');
  assert.deepEqual(answerRequests[0].observations[durableRequests[0].question_order[1]], { kind: 'score', level_index: 2 });
  assert.deepEqual(answerRequests[0].observations[durableRequests[0].question_order[2]], { kind: 'noul', value: true });
  assert.deepEqual(answerRequests[0].observations[durableRequests[0].question_order[3]], { kind: 'box', top: 0.1, bottom: 0.8, left: 0.2, right: 0.9 });
  assert.equal(submittedTask.status, 'completed', 'the task completes after all question IDs are answered');

  await page.goto(`${appUrl}/#/start`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('决策问题').waitFor({ state: 'visible' });
  await page.locator('.decision-session-unread').first().waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '开启新会话' }).last().click();
  await page.getByText('当前入口: 交给我回答 · 持久人工 Choice').click();
  await page.getByLabel('当前入口').selectOption('model:typesafe-ai/jev');
  await page.getByLabel('决策问题').fill('问题 A：先检查什么？');
  await page.getByLabel('候选方案 · 每行一个').fill('先补齐测试\n直接发布');
  await page.getByRole('button', { name: '将当前问题加入队列' }).click();
  await page.getByLabel('决策问题').fill('问题 B：如何处理风险？');
  await page.getByLabel('候选方案 · 每行一个').fill('先修复\n记录并观察');
  await page.getByRole('button', { name: '提交决策' }).click();
  await page.getByRole('heading', { name: '问题 A：先检查什么？' }).waitFor({ state: 'visible' });
  assert.equal(systemOneRequests.length, 1, 'queued questions must be sent in one provider request');
  assert.equal(Object.keys(systemOneRequests[0].questions).length, 2);
  assert.equal(Object.values(systemOneRequests[0].questions)[0].type, 'choice');
  await page.getByRole('button', { name: /首屏图片输入体验/ }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: /首屏图片输入体验/ }).click();
  await page.getByText('现在适合推进吗？', { exact: true }).first().waitFor({ state: 'visible' });

  const desktop = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    globalNavigation: getComputedStyle(document.querySelector('.app-shell__nav')).display,
    sessionSidebar: getComputedStyle(document.querySelector('.decision-session-sidebar')).display,
    composerBottom: Math.round(document.querySelector('.decision-chat-composer').getBoundingClientRect().bottom),
    actionsBottom: Math.round(document.querySelector('.decision-composer-actions').getBoundingClientRect().bottom),
    transcript: document.querySelector('[data-component="decision-session-message"]')?.textContent?.slice(0, 100) ?? null,
  }));
  assert(desktop.actionsBottom <= desktop.composerBottom && desktop.composerBottom <= desktop.height, 'desktop composer actions remain inside the composer and viewport');
  await page.screenshot({ path: '.tmp/interactive-ui-20261029/start-desktop.png', animations: 'disabled' });

  const mobilePage = await context.newPage();
  await mobilePage.setViewportSize({ width: 390, height: 844 });
  mobilePage.on('pageerror', error => pageErrors.push(error.message));
  await mobilePage.goto(`${appUrl}/#/start`, { waitUntil: 'domcontentloaded' });
  await mobilePage.getByLabel('调用方 / 主人 Token').fill('fixture-caller-token');
  await mobilePage.getByRole('button', { name: '使用凭据' }).click();
  const mobile = await mobilePage.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    composerBottom: Math.round(document.querySelector('.decision-chat-composer').getBoundingClientRect().bottom),
    actionsBottom: Math.round(document.querySelector('.decision-composer-actions').getBoundingClientRect().bottom),
    globalNavigation: getComputedStyle(document.querySelector('.app-shell__nav')).display,
    sidebarVisibility: getComputedStyle(document.querySelector('.decision-session-sidebar')).visibility,
    mediaMatch: matchMedia('(max-width: 720px)').matches,
    menuDisplay: getComputedStyle(document.querySelector('.decision-mobile-menu')).display,
  }));
  await mobilePage.getByRole('button', { name: '打开会话列表' }).click();
  await mobilePage.getByRole('button', { name: /首屏图片输入体验/ }).waitFor({ state: 'visible' });
  const openDrawer = await mobilePage.evaluate(() => ({
    open: document.querySelector('.decision-session-sidebar').classList.contains('is-open'),
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }));
  await mobilePage.screenshot({ path: '.tmp/interactive-ui-20261029/start-mobile-drawer.png', animations: 'disabled' });

  const shortPage = await context.newPage();
  await shortPage.setViewportSize({ width: 360, height: 640 });
  shortPage.on('pageerror', error => pageErrors.push(error.message));
  await shortPage.goto(`${appUrl}/#/start`, { waitUntil: 'domcontentloaded' });
  await shortPage.getByLabel('调用方 / 主人 Token').fill('fixture-caller-token');
  await shortPage.getByRole('button', { name: '使用凭据' }).click();
  await shortPage.getByLabel('调用方 / 主人 Token').waitFor({ state: 'detached' });
  await shortPage.getByLabel('决策问题').fill('窄屏短窗口链接遮挡回归');
  await shortPage.getByLabel('候选方案 · 每行一个').fill('展开决策台\n继续留在开始');
  await shortPage.locator('.decision-shared-context > summary').click();
  await shortPage.getByLabel('上下文 · JSON 或普通文本').fill('短屏共享背景');
  const accepted = shortPage.waitForResponse(response => response.url().endsWith('/v1/systorch/decisions') && response.request().method() === 'POST');
  await shortPage.getByRole('button', { name: '提交决策' }).click();
  assert.equal((await accepted).status(), 202);
  await shortPage.getByText('已保存并等待在决策台中作答。', { exact: true }).waitFor({ state: 'visible' });
  const openDeskLink = shortPage.getByRole('link', { name: '在决策台查看', exact: true });
  const shortLayout = await shortPage.evaluate(() => {
    const link = document.querySelector('.decision-response-message a');
    const composer = document.querySelector('.decision-chat-composer');
    const thread = document.querySelector('.decision-chat-thread');
    const linkRect = link.getBoundingClientRect();
    const composerRect = composer.getBoundingClientRect();
    const threadRect = thread.getBoundingClientRect();
    return { linkTop: linkRect.top, linkBottom: linkRect.bottom, composerTop: composerRect.top, composerBottom: composerRect.bottom, threadHeight: threadRect.height, composerHeight: composerRect.height, documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth };
  });
  assert.ok(shortLayout.threadHeight >= 96, 'short mobile window preserves a usable message viewport');
  assert.ok(shortLayout.composerBottom <= 640, 'short mobile composer remains inside the visible window');
  assert.ok(shortLayout.documentWidth <= shortLayout.viewportWidth, 'short mobile layout has no horizontal overflow');
  assert.ok(shortLayout.linkBottom <= shortLayout.composerTop, 'the newest reply action scrolls above the composer automatically');
  await shortPage.screenshot({ path: '.tmp/interactive-ui-20261029/start-mobile-short-chat.png', animations: 'disabled' });
  await openDeskLink.click();
  await shortPage.getByRole('heading', { name: '决策台' }).waitFor({ state: 'visible' });
  await shortPage.screenshot({ path: '.tmp/interactive-ui-20261029/start-mobile-short-window.png', animations: 'disabled' });

  assert.equal(desktop.globalNavigation, 'none');
  assert.equal(desktop.sessionSidebar, 'grid');
  assert.ok(desktop.documentWidth <= desktop.viewportWidth, 'desktop layout has horizontal overflow');
  assert.ok(desktop.transcript?.includes('首屏图片输入体验'));
  assert.equal(mobile.globalNavigation, 'none');
  assert.ok(mobile.documentWidth <= mobile.viewportWidth, 'mobile layout has horizontal overflow');
  assert.ok(mobile.actionsBottom <= mobile.composerBottom && mobile.composerBottom <= mobile.height, 'mobile composer actions remain inside the composer and viewport');
  assert.equal(mobile.sidebarVisibility, 'hidden');
  assert.notEqual(mobile.menuDisplay, 'none');
  assert.equal(openDrawer.open, true);
  assert.equal(openDrawer.horizontalOverflow, false);
  assert.deepEqual(pageErrors, []);

  console.log(JSON.stringify({ durableRequestCount: durableRequests.length, durableQuestionTypes: Object.values(durableRequests[0]?.questions ?? {}).map(question => question.type), answeredQuestionIds: Object.keys(answerRequests[0]?.observations ?? {}), uploadedAssetCount, systemOneRequestCount: systemOneRequests.length, desktop, mobile, openDrawer, shortLayout, pageErrors }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); });
