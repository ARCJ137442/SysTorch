// Real old EXE -> new EXE, sharing only a synthetic isolated profile.
import {spawn, execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
import {gatewayClient, seedUpgradeFixture, assertUpgradeFixture, preferences, fingerprint} from './lib/upgrade-fixture.mjs';
const {chromium} = createRequire(import.meta.url)('playwright');
const output = path.resolve('.tmp/systorch-upgrade/windows'); await mkdir(output, {recursive: true});
const profile = await mkdtemp(path.join(output, 'profile-'));
const config = path.join(profile, 'jev-switch-m1-preview'); await mkdir(config);
await writeFile(path.join(config, 'providers.toml'), 'mode="local"\nbind="127.0.0.1:11436"\nroutes=[]\n[providers]\n');
const webview = await mkdtemp(path.join(process.env.TEMP, 'SysTorchUpgradeWebview-'));
const base = 'http://127.0.0.1:11436'; const api = gatewayClient(base);
const candidate = JSON.parse(await readFile(new URL('./m1-candidate.json', import.meta.url), 'utf8'));
const stamp = candidate.build_id.replace(/^m1-systorch-/, '');
const binaries = {old: path.resolve('.tmp/m1-delivery/jev-switch-m1-preview-windows-x64.exe'), current: path.resolve(`.tmp/systorch-delivery/SysTorch-m1-preview-${stamp}-windows-x64.exe`)};
const report = {scope: 'Windows native in-place rebrand, isolated legacy data and WebView profile', build: candidate.build_id, binaries: {}, checks: [], realModelCalls: 0};
for (const [key, file] of Object.entries(binaries)) report.binaries[key] = fingerprint(await readFile(file));
try {await fetch(`${base}/health`, {signal: AbortSignal.timeout(300)}); throw Error('Preview port occupied; no existing app was stopped');}
catch (error) {if (error.message.startsWith('Preview port occupied')) throw error;}
let app, browser, page;
async function stop() {
  await browser?.close().catch(() => {}); browser = undefined;
  if (app?.exitCode === null) try {execFileSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore'});} catch {}
  app = undefined;
  for (let n = 0; n < 30; n++) {try {await fetch(`${base}/health`, {signal: AbortSignal.timeout(150)});} catch {return;} await new Promise(r => setTimeout(r, 100));}
  throw Error('Owned gateway did not exit');
}
async function start(binary, build) {
  app = spawn(binary, [], {windowsHide: false, env: {...process.env, APPDATA: profile, WEBVIEW2_USER_DATA_FOLDER: webview, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=19336 --disable-gpu'}, stdio: 'ignore'});
  const deadline = Date.now() + 60000; let ready = false;
  while (Date.now() < deadline) {
    assert.equal(app.exitCode, null, 'the private native process must remain alive');
    try {const health = await api('/health'); const targets = await fetch('http://127.0.0.1:19336/json').then(r => r.json()); if (health.data.build_revision === build && targets.some(t => t.url.startsWith(base))) {ready = true; break;}} catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  assert(ready, 'exact candidate gateway and native UI must be ready');
  browser = await chromium.connectOverCDP('http://127.0.0.1:19336');
  page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith(base)); assert(page);
  if (build === 'm1-local-20261024.1') {
    await page.evaluate(() => localStorage.setItem('jev_lang', 'en'));
    await page.reload();
  }
  try {await page.getByText('Local owner · can answer', {exact: true}).waitFor({timeout: 10000});}
  catch (error) {
    await page.screenshot({path: path.join(output, 'startup-failure.png')});
    const diagnostic = await page.evaluate(async () => {
      let ownerAvailable = false, nativeError;
      try {ownerAvailable = (await window.__TAURI_INTERNALS__.invoke('decision_owner_token', {base: 'http://127.0.0.1:11436'})).startsWith('st_owner_');} catch (e) {nativeError = String(e);}
      return {url: location.href, language: localStorage.getItem('jev_lang'), title: document.title, ownerAvailable, nativeError, body: document.body.innerText.slice(0, 5000)};
    });
    await writeFile(path.join(output, 'startup-failure.json'), JSON.stringify(diagnostic, null, 2));
    throw error;
  }
  return page.evaluate(() => window.__TAURI_INTERNALS__.invoke('decision_owner_token', {base: 'http://127.0.0.1:11436'}));
}
try {
  const owner = await start(binaries.old, 'm1-local-20261024.1');
  const fixture = await seedUpgradeFixture(api, owner);
  await page.evaluate(values => {for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);}, preferences);
  await page.reload();
  // This test force-kills the owned process tree to exercise WAL recovery.
  // Give Chromium's asynchronous localStorage persistence its normal flush
  // interval first; killing it immediately tests a cache crash, not an upgrade.
  await new Promise(resolve => setTimeout(resolve, 7000));
  const ownerKey = fingerprint(await readFile(path.join(config, 'systorch-owner.key')));
  await stop();
  const newOwner = await start(binaries.current, report.build);
  await page.getByText('SysTorch', {exact: true}).first().waitFor();
  assert((await page.title()).includes('SysTorch'));
  assert.equal(fingerprint(await readFile(path.join(config, 'systorch-owner.key'))), ownerKey);
  report.checks.push(...await assertUpgradeFixture(api, fixture, newOwner, page));
  report.checks.push('same 64-byte encryption/owner key, legacy data directory and WebView storage reused without copying or clearing');
  await page.screenshot({path: path.join(output, 'upgraded-native.png')});
  await stop();
  await start(binaries.current, report.build);
  assert.equal((await api(`/v1/systorch/decisions/${fixture.tasks.waiting}/result`, {token: fixture.caller})).data.answers.choice.choice, 'approve');
  report.checks.push('a second new-app restart retains the answer made after upgrade');
  report.completed = new Date().toISOString();
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {await stop();}
