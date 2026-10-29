// Dedicated disposable AVD only. The APK update uses install -r; never clear
// storage between the old version and SysTorch, and never rotate signing keys.
import {execFileSync} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
import {gatewayClient, seedUpgradeFixture, assertUpgradeFixture, preferences, fingerprint} from './lib/upgrade-fixture.mjs';
const {chromium} = createRequire(import.meta.url)('playwright');
const adb = process.env.M1_ADB ?? path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe');
const command = (...args) => execFileSync(adb, ['-P', '5041', '-s', '127.0.0.1:5583', ...args], {windowsHide: true, timeout: 90000, encoding: 'utf8'});
execFileSync(adb, ['-P', '5041', 'connect', '127.0.0.1:5583'], {windowsHide: true, stdio: 'ignore'});
assert.equal(command('shell', 'getprop', 'ro.boot.qemu.avd_name').trim(), 'SysTorch_M1_API_35', 'only the dedicated temporary emulator may be used');
const pkg = 'io.github.arcj137442.jevswitch.m1preview';
const component = `${pkg}/io.github.arcj137442.jevswitch.MainActivity`;
const candidate = JSON.parse(await readFile(new URL('./m1-candidate.json', import.meta.url), 'utf8'));
const stamp = candidate.build_id.replace(/^m1-systorch-/, '');
const apks = {old: path.resolve('.tmp/m1-delivery/jev-switch-m1-preview-x86_64.apk'), current: path.resolve(`.tmp/systorch-delivery/SysTorch-m1-preview-${stamp}-x86_64.apk`)};
const output = path.resolve('.tmp/systorch-upgrade/android'); await mkdir(output, {recursive: true});
const report = {scope: 'old signed M1 APK -> SysTorch in-place update on isolated Android API 35 emulator', build: candidate.build_id, apks: {}, checks: [], realModelCalls: 0};
for (const [key, file] of Object.entries(apks)) report.apks[key] = fingerprint(await readFile(file));
const api = gatewayClient('http://127.0.0.1:18438');
let browser, page;
async function waitFor(action, seconds = 70) {
  const deadline = Date.now() + seconds * 1000; let last;
  while (Date.now() < deadline) {try {const value = await action(); if (value) return value;} catch (e) {last = e;} await new Promise(r => setTimeout(r, 250));}
  throw last ?? Error('owned Android app did not become ready');
}
async function start(build, {restoreStopped = false, expectStopped = false} = {}) {
  console.log(`Starting native APK: ${build}`);
  command('shell', 'am', 'start', '-n', component);
  if (!restoreStopped && !expectStopped) await waitFor(async () => (await api('/health')).data?.build_revision === build);
  const pid = await waitFor(() => {const value = command('shell', 'pidof', pkg).trim().split(/\s+/)[0]; return /^\d+$/.test(value) && value;});
  command('forward', 'tcp:19438', `localabstract:webview_devtools_remote_${pid}`);
  await waitFor(async () => (await fetch('http://127.0.0.1:19438/json').then(r => r.json())).some(t => t.type === 'page'));
  // Android WebView does not implement Browser context/download management.
  // Keep its native defaults instead of applying desktop browser overrides.
  browser = await chromium.connectOverCDP('http://127.0.0.1:19438', {noDefaults: true, timeout: 15000});
  console.log('Android WebView CDP connected.');
  page = browser.contexts().flatMap(c => c.pages()).find(p => /tauri\.localhost|127\.0\.0\.1:11436/.test(p.url())); assert(page);
  page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(15000);
  await page.waitForFunction(() => !!window.__TAURI_INTERNALS__);
  console.log('Native RPC bridge available.');
  if (expectStopped) {
    await waitFor(async () => !(await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('gateway_status'))).running, 25);
    return;
  }
  if (restoreStopped) {
    const stopped = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('gateway_status'));
    assert.equal(stopped.running, false, 'an explicit old stop must not turn into automatic startup on upgrade');
    const started = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('start_gateway'));
    assert.equal(started.running, true);
    await waitFor(async () => (await api('/health')).data?.build_revision === build);
    await page.reload();
  }
  if (build === 'm1-local-20261024.1') {await page.evaluate(() => localStorage.setItem('jev_lang', 'en')); await page.reload({waitUntil: 'domcontentloaded'});}
  console.log('Waiting for local owner UI.');
  await page.getByText('Local owner · can answer', {exact: true}).waitFor({timeout: 30000});
  return page.evaluate(() => window.__TAURI_INTERNALS__.invoke('decision_owner_token', {base: 'http://127.0.0.1:11436'}));
}
async function stop() {
  await browser?.close().catch(() => {}); browser = undefined;
  command('shell', 'am', 'force-stop', pkg);
  try {command('forward', '--remove', 'tcp:19438');} catch {}
}
try {
  command('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'); command('shell', 'wm', 'dismiss-keyguard');
  command('shell', 'settings', 'put', 'system', 'screen_off_timeout', '1800000');
  command('shell', 'am', 'force-stop', 'com.google.android.apps.messaging');
  console.log('Installing frozen old M1 APK on disposable emulator.');
  command('install', '--no-incremental', '--no-streaming', '-r', apks.old);
  command('shell', 'am', 'force-stop', pkg);
  command('shell', 'pm', 'clear', pkg); // Before creating fixtures, never during upgrade.
  command('forward', 'tcp:18438', 'tcp:11436');
  const owner = await start('m1-local-20261024.1');
  const fixture = await seedUpgradeFixture(api, owner);
  console.log('Old APK: task, token, provider and lifecycle fixtures accepted.');
  await page.evaluate(values => {for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);}, preferences);
  await page.reload(); await new Promise(r => setTimeout(r, 7000));
  // API 35's dumpsys calls the installed app identity appId (older releases
  // called it userId); this is unrelated to the task's owner/caller IDs.
  const packageUid = () => command('shell', 'dumpsys', 'package', pkg).match(/(?:userId|appId)=(\d+)/)?.[1];
  const oldUid = packageUid(); assert(oldUid);
  const stopped = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('stop_gateway'));
  assert.equal(stopped.running, false);
  await stop();
  // A signing mismatch fails here rather than uninstalling or dropping old data.
  console.log('Updating APK with install -r, preserving data and signer.');
  command('install', '--no-incremental', '--no-streaming', '-r', apks.current);
  const newUid = packageUid(); assert.equal(newUid, oldUid);
  const newOwner = await start(report.build, {restoreStopped: true});
  report.checks.push('explicit old gateway stop survives upgrade; native RPC starts the new daemon without an HTTP gateway dependency');
  await page.getByText('SysTorch', {exact: true}).first().waitFor();
  report.checks.push(...await assertUpgradeFixture(api, fixture, newOwner, page, {answerPending: async () => {
    // The shared assertions above already verify preservation of 137% zoom.
    // Use 100% for the input test: 137% hit testing could not be verified
    // reliably on this API 35 image. Keep that limitation explicit rather
    // than using forced clicks or claiming native 137% touch acceptance.
    await page.evaluate(() => localStorage.setItem('jev_ui_scale','1'));
    await page.reload({waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:/Upgrade fixture: waiting/}).click();
    await page.getByRole('radio',{name:'Finish migration verification',exact:true}).check();
    await page.getByRole('button',{name:'Submit answer',exact:true}).click();
  }}));
  report.inputScope = 'native WebView UI at 100%; 137% preference preservation asserted before changing test view scale; native zoomed input remains unverified';
  console.log('Updated APK: authority, persistent task states, UI answering and old preferences verified.');
  report.checks.push('same installed application ID, signer-compatible install -r and application UID; no data clearing during upgrade');
  await page.screenshot({path: path.join(output, 'upgraded-native.png')});
  const services = command('shell', 'dumpsys', 'activity', 'services', pkg);
  assert(services.includes('JevKeepaliveService'), 'the stable foreground-service component remains resolvable');
  report.checks.push('legacy launcher and foreground-service component identities resolve through new SysTorch implementations');
  await stop(); await start(report.build);
  const result = await api(`/v1/systorch/decisions/${fixture.tasks.waiting}/result`, {token: fixture.caller}); assert.equal(result.status, 200); assert.equal(result.data.answers.choice.choice, 'approve');
  report.checks.push('a second cold restart retains the answer accepted after upgrade');
  // Exercise the actual notification/tile intent from Start and Routing, not
  // just an RPC invoked by the test. No Dashboard component is mounted here.
  for (const route of ['start', 'routing']) {
    console.log(`Testing native notification/tile intent on ${route}`);
    await page.goto(`${page.url().split('#')[0]}#/${route}`);
    command('shell', 'am', 'start', '-n', component, '--ez', 'jev-switch.toggle-gateway', 'true');
    await waitFor(async () => !(await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('gateway_status'))).running, 20);
    command('shell', 'am', 'start', '-n', component, '--ez', 'jev-switch.toggle-gateway', 'true');
    await waitFor(async () => (await api('/health')).data?.build_revision === report.build, 25);
  }
  report.checks.push('notification/tile intents work on Start and Routing without mounting Dashboard and do not replay on navigation');
  await stop();
  command('shell', 'am', 'start', '-n', component, '--ez', 'jev-switch.toggle-gateway', 'true');
  await start(report.build, {expectStopped: true});
  command('shell', 'am', 'start', '-n', component, '--ez', 'jev-switch.toggle-gateway', 'true');
  await waitFor(async () => (await api('/health')).data?.build_revision === report.build, 25);
  await page.reload({waitUntil:'domcontentloaded'});
  await new Promise(r => setTimeout(r,700));
  assert.equal((await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('gateway_status'))).running, true);
  report.checks.push('a cold-start notification/tile gesture is accepted once; reloading the UI does not replay it');
  command('shell', 'input', 'keyevent', 'KEYCODE_APP_SWITCH');
  await new Promise(r => setTimeout(r, 700));
  const recents = execFileSync(adb, ['-P', '5041', '-s', '127.0.0.1:5583', 'exec-out', 'screencap', '-p'], {windowsHide: true, timeout: 15000});
  await writeFile(path.join(output, 'android-recents.png'), recents);
  report.completed = new Date().toISOString(); await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
} catch (error) {
  await page?.screenshot({path: path.join(output, 'failure-native.png')}).catch(() => {});
  await writeFile(path.join(output, 'failure.txt'), String(error.stack ?? error));
  throw error;
} finally {
  await stop();
  try {command('forward', '--remove', 'tcp:18438');} catch {}
}
