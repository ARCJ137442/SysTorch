// Optional browser gate. Requires Playwright (or NODE_PATH pointing to the local
// bundled runtime). Uses a fresh browser profile; never the maintainer's profile.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const base = process.argv[2] ?? 'http://127.0.0.1:5173';
assert.equal(new URL(base).hostname, '127.0.0.1', 'Only an isolated loopback preview may be tested.');
const output = path.resolve(process.argv[3] ?? '.tmp/m0-20261024/browser');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = { browserVersion: await browser.version(), date: new Date().toISOString(), scope: 'M0 simulated browser only', cases: [], screenshots: [], forbiddenRequests: [], errors: [] };
const key = 'systorch-m0-preview-v1';
let page;
async function nav(name) { await page.getByRole('button', { name, exact: true }).click(); }
async function scenario(id) {
  if (!await page.getByRole('combobox', { name: '预览情境' }).isVisible()) await page.getByRole('button', { name: '预览设置与情境' }).click();
  await page.getByRole('combobox', { name: '预览情境' }).selectOption(id);
}
async function state() { return page.evaluate(k => JSON.parse(localStorage.getItem(k)), key); }
async function noOverflow(label) {
  const sizes = await page.evaluate(() => ({ view: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth * Number(getComputedStyle(document.documentElement).zoom || 1), main: document.querySelector('main').scrollWidth, mainWidth: document.querySelector('main').clientWidth }));
  assert(sizes.document <= sizes.view + 1 && sizes.body <= sizes.view + 1 && sizes.main <= sizes.mainWidth + 1, `${label}: ${JSON.stringify(sizes)}`);
}
async function screenshot(name) {
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true, animations: 'disabled' });
  report.screenshots.push(`${name}.png`);
}
async function record(name, run) {
  await run(); report.cases.push(name); console.log(`PASS ${name}`);
}
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 1024, height: 800 }, { width: 390, height: 844 }, { width: 360, height: 640 }]) {
    const context = await browser.newContext({ viewport, hasTouch: viewport.width < 500 });
    page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin || url.pathname.startsWith('/v1/')) {
        report.forbiddenRequests.push(route.request().url()); return route.abort();
      }
      return route.continue();
    });
    await page.goto(`${base}/systorch-preview.html`);
    await page.getByRole('heading', { name: /把眼前的问题/ }).waitFor();
    await record(`first action is visible at ${viewport.width}x${viewport.height}`, async () => {
      const rect = await page.getByRole('button', { name: '请求判断', exact: true }).boundingBox();
      assert(rect && rect.y + rect.height <= viewport.height, 'Primary action is below the first screen.');
      await noOverflow('initial');
    });
    await screenshot(`start-${viewport.width}`);
    await record(`scenario and workspace matrix at ${viewport.width}`, async () => {
      for (const id of ['normal', 'empty', 'loading', 'offline', 'busy', 'expired', 'conflict', 'declined', 'conditional', 'error', 'draft', 'permission', 'local-stopped']) {
        await scenario(id);
        for (const workspace of ['开始', '决策台', '协调工作台']) { await nav(workspace); await noOverflow(`${id}/${workspace}`); }
      }
    });
    await scenario('draft'); await nav('决策台');
    await screenshot(`desk-${viewport.width}`);
    await nav('协调工作台'); await screenshot(`coordinate-${viewport.width}`);
    await page.getByRole('button', { name: '深色模式' }).click();
    await noOverflow('dark'); await screenshot(`coordinate-dark-${viewport.width}`);
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(base).origin || url.pathname.startsWith('/v1/')) { report.forbiddenRequests.push(url.href); return route.abort(); }
    return route.continue();
  });
  await page.goto(`${base}/systorch-preview.html`);
  await record('selection and annotations persist across navigation and reload', async () => {
    await nav('决策台');
    await page.getByRole('radio', { name: /先完成演示/ }).check();
    await page.getByText('附条件回答或补充说明', { exact: false }).click();
    await page.getByRole('textbox', { name: '需要先满足什么条件？' }).fill('先检查隐私');
    assert.equal((await state()).tasks[0].status, 'pending');
    await nav('协调工作台'); await nav('决策台');
    assert(await page.getByRole('radio', { name: /先完成演示/ }).isChecked());
    await page.reload(); await nav('决策台');
    assert.equal((await state()).tasks[0].draftCondition, '先检查隐私');
  });
  await record('offline rejects submission but preserves draft and permits retry', async () => {
    await scenario('offline');
    await page.getByRole('button', { name: '提交回答', exact: true }).click();
    assert.equal((await state()).tasks[0].status, 'pending');
    assert.equal((await state()).tasks[0].draft, '先完成演示');
    await scenario('normal');
    await page.getByRole('button', { name: '提交回答', exact: true }).click();
    await page.getByText('本预览已记录 · 没有真实调用方确认收取', { exact: false }).waitFor();
    assert.equal((await state()).tasks[0].outcome, 'conditional');
    await page.reload(); await nav('决策台');
    assert.equal((await state()).tasks[0].outcome, 'conditional');
  });
  await record('stale revision and permissions disable submission', async () => {
    await scenario('conflict');
    assert.equal((await state()).tasks[0].draftRevision, 1);
    await page.getByRole('button', { name: '查看最新结果' }).click();
    assert.equal((await state()).tasks[0].draft, undefined);
    await scenario('permission');
    assert(await page.getByRole('button', { name: '提交回答', exact: true }).isDisabled());
  });
  await record('empty configuration leads to a visible simulated setup and back to Start', async () => {
    await scenario('empty'); await nav('开始');
    await page.getByRole('button', { name: '配置演示入口' }).click();
    await page.getByRole('textbox', { name: '入口名称' }).fill('我的演示入口');
    await page.getByRole('button', { name: '保存模拟入口并开始' }).click();
    assert.equal((await state()).workspace, 'start');
    assert.equal((await state()).entries[0].label, '我的演示入口');
  });
  await record('cancellation prevents delayed simulated completion', async () => {
    await page.getByRole('button', { name: '安排下一步', exact: false }).click();
    await page.getByRole('button', { name: '请求判断', exact: true }).click();
    await page.getByRole('button', { name: '取消本次提交' }).click();
    assert.equal((await state()).lastRequestId, undefined);
    await page.getByRole('button', { name: '请求判断', exact: true }).click();
    await page.getByRole('article', { name: '最近判断结果' }).waitFor();
    assert.equal((await state()).tasks.filter(t => t.origin === 'start').length, 1);
  });
  await record('local source never falls back silently and reports readiness separately', async () => {
    await scenario('local-stopped'); await nav('开始');
    await page.getByRole('button', { name: '安排下一步', exact: false }).click();
    assert(await page.getByRole('button', { name: '请求判断', exact: true }).isDisabled());
    await page.getByRole('button', { name: '模拟启动服务', exact: true }).click();
    await page.getByRole('button', { name: '模拟启动服务', exact: true }).waitFor({ state: 'hidden' });
    assert.equal((await state()).entryId, 'local');
    assert((await state()).entries.find(e => e.id === 'local').ready);
    await nav('协调工作台');
    await page.getByRole('button', { name: '模拟停止', exact: true }).click();
    await page.getByRole('button', { name: '模拟启动', exact: true }).waitFor();
    await nav('开始');
    assert(!(await state()).entries.find(e => e.id === 'local').ready);
    assert(await page.getByRole('button', { name: '请求判断', exact: true }).isDisabled());
  });
  await record('IME and held Ctrl+Enter do not submit; ordinary Enter stays in textarea', async () => {
    const input = page.getByRole('textbox', { name: '你现在想判断什么？' });
    await input.fill('输入法测试');
    const count = (await state()).tasks.length;
    await input.dispatchEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true, bubbles: true });
    await input.dispatchEvent('keydown', { key: 'Enter', ctrlKey: true, repeat: true, bubbles: true });
    await input.press('Enter');
    assert.equal((await state()).tasks.length, count);
    assert((await input.inputValue()).includes('\n'));
  });
  await record('default home and context-aware experiment return survive reload', async () => {
    await scenario('draft'); await nav('协调工作台');
    await page.getByRole('combobox', { name: '默认首页' }).selectOption('last');
    await page.reload();
    assert.equal((await state()).workspace, 'coordinate');
    await page.getByRole('button', { name: '前往决策台作答' }).click();
    await page.getByRole('radio', { name: /判断，从这里开始/ }).check();
    await page.getByRole('button', { name: '提交回答', exact: true }).click();
    await page.getByRole('button', { name: '返回人机比较 · 样本 03' }).click();
    assert.equal((await state()).workspace, 'coordinate');
    assert.equal((await state()).tasks.find(t => t.id === 'demo-1040').answer, '判断，从这里开始');
  });
  await record('reused DAG holds request brightness, fades response glow and does not replay on return', async () => {
    await nav('协调工作台');
    await page.getByRole('button', { name: '模拟请求', exact: true }).click();
    await page.getByRole('button', { name: '模拟请求', exact: true }).click();
    assert(await page.getByText('2 个模拟请求等待响应', { exact: true }).isVisible());
    await page.getByRole('button', { name: '模拟成功响应', exact: true }).click();
    await page.getByRole('button', { name: '模拟失败响应', exact: true }).click();
    const glow = () => page.locator('svg[aria-label]').evaluate(svg => Math.max(0, ...[...svg.querySelectorAll('g')].map(g => Number(g.style.getPropertyValue('--dag-glow-alpha')) || 0)));
    const before = await glow();
    assert(before > 0, 'response must produce visible glow');
    await nav('开始'); await nav('协调工作台');
    assert((await glow()) <= before + 0.01, 'returning must not restart the response glow');
    await page.waitForFunction(() => [...document.querySelectorAll('svg[aria-label] g')].every(g => (Number(g.style.getPropertyValue('--dag-glow-alpha')) || 0) === 0), { timeout: 8000 });
    await screenshot('core-dag-after-response');
  });
  await record('professional routes remain discoverable without replacing the preview or auto-connecting', async () => {
    await nav('协调工作台');
    const tools = page.getByRole('navigation', { name: '现有控制台功能' });
    for (const [name, route] of [['提供商与服务启停','providers'], ['完整 DAG 与实时辉光','routing'], ['调用历史与统计','stats'], ['演练场与批量比较','playground']]) {
      const link = tools.getByRole('link', { name, exact: false });
      assert.equal(await link.getAttribute('href'), `/#/${route}`);
      assert.equal(await link.getAttribute('target'), '_blank');
    }
  });
  await record('untrusted JSON is text, not HTML or automatic URL fetch', async () => {
    const current = await state();
    current.home = 'last'; current.lastWorkspace = 'desk'; current.workspace = 'desk'; current.selectedTaskId = 'demo-1042';
    current.tasks[0].context = { unsafe: '<img src="http://127.0.0.1:1/private" onerror="window.__unsafe=1">', nested: { null: null, url: 'http://127.0.0.1:1/private' } };
    await page.evaluate(({ key, current }) => localStorage.setItem(key, JSON.stringify(current)), { key, current });
    await page.reload();
    await page.getByText(current.tasks[0].context.unsafe, { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__unsafe), undefined);
  });
  await record('10/100/137/200 percent layout bounds on desktop and mobile', async () => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const scale of [0.1, 1, 1.37, 2]) {
        await page.evaluate(scale => { document.documentElement.style.zoom = String(scale); }, scale);
        for (const name of ['开始', '决策台', '协调工作台']) { await nav(name); await noOverflow(`${width}/${scale}/${name}`); assert.equal(Math.round(await page.locator('[data-theme]').evaluate(el => el.getBoundingClientRect().height)), 1000, 'scaled shell remains inside viewport'); }
      }
    }
    await page.evaluate(() => { document.documentElement.style.zoom = ''; });
  });
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.forbiddenRequests, [], 'Prototype attempted to contact a real gateway or external service.');
  await context.close();
} catch (error) {
  report.failure = String(error.stack ?? error);
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
  throw error;
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
