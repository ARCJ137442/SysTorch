// Only the locally built M1 app, an isolated APPDATA, and its own WebView2 CDP.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve('.tmp/m1-native-windows'); await mkdir(root, { recursive: true });
const data = await mkdtemp(path.join(root, 'profile-'));
const webviewProfile = await mkdtemp(path.join(process.env.LOCALAPPDATA, 'JevSwitchM1Test-'));
const config = path.join(data, 'jev-switch-m1-preview'); await mkdir(config);
await writeFile(path.join(config, 'providers.toml'), 'mode="local"\nbind="127.0.0.1:11436"\nroutes=[]\n[providers]\n');
const binary = path.resolve('.tmp/m1-delivery/jev-switch-m1-preview-windows-x64.exe');
try { await fetch('http://127.0.0.1:11436/health', { signal: AbortSignal.timeout(300) }); throw Error('Preview port is already occupied; no existing process was stopped'); }
catch (error) { if (error.message?.startsWith('Preview port')) throw error; }
// Exercise the real GUI launch. Hiding this GUI process at creation can suppress
// WebView2 initialization; only the daemon and command helpers stay hidden.
const app = spawn(binary, [], { windowsHide: false, env: { ...process.env, APPDATA: data, WEBVIEW2_USER_DATA_FOLDER: webviewProfile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=19336 --disable-gpu' }, stdio: ['ignore','pipe','pipe'] });
await writeFile(path.join(root,'active-pid.txt'),String(app.pid));
let nativeLogs=''; app.stdout.on('data',chunk=>nativeLogs+=chunk); app.stderr.on('data',chunk=>nativeLogs+=chunk);
let browser, page;
const report = { scope: 'owned Windows M1 standalone, isolated data, real native credential RPC', binarySha256: createHash('sha256').update(await readFile(binary)).digest('hex'), checks: [] };
try {
  const deadline = performance.now() + 60000;
  while (performance.now() < deadline) {
    assert.equal(app.exitCode, null, 'owned native app exited');
    try { const targets = await fetch('http://127.0.0.1:19336/json').then(r => r.json()); if (targets.some(t => t.url.startsWith('http://127.0.0.1:11436'))) break; } catch { /* Wait for the owned WebView. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.connectOverCDP('http://127.0.0.1:19336');
  page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('http://127.0.0.1:11436'));
  assert(page, 'owned native UI loaded');
  report.buildRevision = (await fetch('http://127.0.0.1:11436/health').then(r => r.json())).build_revision;
  await page.evaluate(() => localStorage.setItem('jev_lang', 'en')); await page.reload();
  await page.getByText('Local owner · can answer', { exact: true }).waitFor({ timeout: 20000 });
  report.checks.push('native owner capability retrieved through Tauri IPC without manual credential input');
  await page.getByLabel('Question', { exact: true }).fill('Native Windows M1 fixture');
  await page.getByLabel('Alternatives · one per line').fill('Review the fixture\nContinue testing');
  await page.getByRole('button', { name: 'Submit decision', exact: true }).click();
  await page.getByText('Accepted · waiting for a human answer', { exact: true }).waitFor();
  const taskId = await page.locator('code').first().textContent();
  await page.getByRole('link', { name: 'Open in decision desk', exact: true }).first().click();
  await page.getByRole('radio', { name: 'Review the fixture', exact: true }).check();
  await page.getByRole('button', { name: 'Submit answer', exact: true }).click();
  await page.getByText('Authoritative answer saved', { exact: true }).waitFor();
  const key = await readFile(path.join(config, 'systorch-owner.key'));
  const token = `st_owner_${key.subarray(32).toString('hex')}`;
  const result = await fetch(`http://127.0.0.1:11436/v1/systorch/decisions/${taskId}/result`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
  assert.equal(result.answers.choice.choice, 'option1');
  report.checks.push('real standalone UI submit → durable human answer → external result retrieval');
  const deniedOtherGateway = await page.evaluate(async () => {
    try { await window.__TAURI_INTERNALS__.invoke('decision_owner_token', { base: 'http://127.0.0.1:11435' }); return false; }
    catch (e) { return String(e).includes('owned gateway'); }
  });
  assert(deniedOtherGateway, 'native owner capability must be bound to this preview gateway');
  report.checks.push('native bridge rejects a different local gateway origin');
  const fullscreen = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:window|is_fullscreen', { label: 'main' }));
  await page.keyboard.press('F11');
  await page.waitForFunction(async value => (await window.__TAURI_INTERNALS__.invoke('plugin:window|is_fullscreen', { label: 'main' })) !== value, fullscreen);
  await page.keyboard.press('F11');
  await page.waitForFunction(async value => (await window.__TAURI_INTERNALS__.invoke('plugin:window|is_fullscreen', { label: 'main' })) === value, fullscreen);
  report.checks.push('F11 native fullscreen and restore remain authorized');
  await page.evaluate(() => { document.querySelector('.app-shell__main').scrollTop = 0; });
  await page.screenshot({ path: path.join(root, 'windows-native.png') });
  report.completed = new Date().toISOString();
  await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  const diagnostics = page ? await page.evaluate(async () => {
    let bridge;
    try { bridge = (await window.__TAURI_INTERNALS__?.invoke('decision_owner_token', { base: location.origin }))?.startsWith('st_owner_') ? 'credential available' : 'no credential'; }
    catch (e) { bridge = String(e); }
    return { url: location.href, nativeMarker: globalThis.isTauri, bridge, body: document.body.innerText.slice(0, 2500) };
  }).catch(() => ({})) : {};
  await writeFile(path.join(root, 'failure.json'), JSON.stringify({ error: String(error), ...diagnostics }, null, 2));
  await writeFile(path.join(root, 'native.stderr.log'), nativeLogs);
  await page?.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  // Do not close unrelated WebViews or stop an existing gateway. This PID is the
  // child spawned above; its tree contains only this isolated shell and daemon.
  if (app.exitCode === null) execFileSync('taskkill.exe', ['/PID', String(app.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  if (browser) await browser.close().catch(() => {});
}
