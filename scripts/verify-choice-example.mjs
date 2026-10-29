// Two independent Windows PowerShell 5.1 callers around a real native app answer.
// Uses an explicitly selected candidate (or the frozen M1 default) with an
// isolated profile, never the user DB.
import {spawn, spawnSync, execFileSync} from 'node:child_process';
import {mkdir, mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)(process.env.SYSTORCH_PLAYWRIGHT_PACKAGE ?? 'playwright');
const output=path.resolve('.tmp/choice-example-verification');await mkdir(output,{recursive:true});
const profile=await mkdtemp(path.join(output,'profile-'));
const config=path.join(profile,'jev-switch-m1-preview');await mkdir(config);
const upstream=createServer(async(req,res)=>{
 if(req.url!=='/v1/systemone'){res.writeHead(404).end();return;}
 const chunks=[];for await(const chunk of req)chunks.push(chunk);
 const body=JSON.parse(Buffer.concat(chunks));const questionId=Object.keys(body.questions)[0];
 const answers=body.questions[questionId].type==='choice'
  ? {[questionId]:{type:'choice',choice:'option1',probabilities:{option1:0.9,option2:0.1},confidence:0.9}}
  : {[questionId]:{type:'noul',probability:0.9}};
 res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({model:'m1-synthetic',answers,upstream_calls:1}));
});
upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
await writeFile(path.join(config,'providers.toml'),`mode="local"\nbind="127.0.0.1:11436"\n[providers.fixture]\nkind="typesafe"\nbase="http://127.0.0.1:${upstream.address().port}/v1/systemone"\nenabled=true\nmodels=["m1-synthetic"]\n[[routes]]\nleft="m1-fixture"\nright="fixture"\nupstream_model="m1-synthetic"\npriority=10\n`);
const webview=await mkdtemp(path.join(process.env.LOCALAPPDATA,'SysTorchExampleTest-'));
const base='http://127.0.0.1:11436';
try {await fetch(`${base}/health`,{signal:AbortSignal.timeout(300)});throw Error('Preview port occupied; no existing app was stopped');}
catch(error){if(error.message.startsWith('Preview port occupied'))throw error;}
const binary=path.resolve(process.argv[2]??'.tmp/m1-delivery/jev-switch-m1-preview-windows-x64.exe');
const candidateStamp=path.basename(binary).match(/SysTorch-m1-preview-(.+)-windows-x64\.exe/i)?.[1];
const candidateTitleToken=candidateStamp?Buffer.from(`m1.systorch.${candidateStamp}`).toString('hex'):'';
const expectedBuildId=candidateStamp?JSON.parse(await readFile('scripts/m1-candidate.json','utf8')).build_id:null;
const nativeShellPath=path.resolve('src-tauri/target/release/deps/systorch.exe');
const script=path.resolve('scripts/examples/choice-client.ps1');
const receipt=path.join(profile,'receipt.json');
const report={scope:'selected M1 candidate EXE, native human answer, two independent PowerShell 5.1 callers, persistent model chat with synthetic upstream',checks:[],realModelCalls:0,binary_sha256:createHash('sha256').update(await readFile(binary)).digest('hex'),script_sha256:createHash('sha256').update(await readFile(script)).digest('hex')};
const app=spawn(binary,[],{windowsHide:false,env:{...process.env,APPDATA:profile,WEBVIEW2_USER_DATA_FOLDER:webview,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=19336 --disable-gpu'},stdio:'ignore'});
let browser;
try {
 const deadline=Date.now()+60000;let ready=false;
 while(Date.now()<deadline){assert.equal(app.exitCode,null);try {const targets=await fetch('http://127.0.0.1:19336/json').then(r=>r.json());if(targets.some(t=>t.url.startsWith(base))){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
 assert(ready,'native console must start');
 if(expectedBuildId){const health=await fetch(`${base}/health`).then(r=>r.json());assert.equal(health.build_revision,expectedBuildId,'the exact preview build must answer the native test');report.checks.push(`native EXE health revision matches ${expectedBuildId}`);}
 browser=await chromium.connectOverCDP('http://127.0.0.1:19336');
 const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith(base));assert(page);
 await page.evaluate(()=>localStorage.setItem('jev_lang','en'));await page.reload();
 await page.goto(`${base}/#/start`);
 await page.waitForFunction(()=>!!window.__TAURI_INTERNALS__);
 const owner=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('decision_owner_token',{base:'http://127.0.0.1:11436'}));
 assert(owner.startsWith('st_owner_'),'native owner identity must be available before the browser answer flow');
 await page.locator('.decision-chat-composer').waitFor();
 const tokenResponse=await fetch(`${base}/v1/admin/tokens`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'choice-example-fixture',role:'readonly'})});
 assert(tokenResponse.ok);const {secret}=await tokenResponse.json();assert(secret);
 const shell=path.join(process.env.WINDIR,'System32/WindowsPowerShell/v1.0/powershell.exe');
 const call=action=>{
  // Node inherits the host's bundled PowerShell 7 module path. Use the real
  // Windows PowerShell 5.1 modules, as in a normal Windows terminal session.
  const result=spawnSync(shell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',`& $env:SYSTORCH_EXAMPLE_SCRIPT -Action ${action} -Gateway $env:SYSTORCH_EXAMPLE_GATEWAY -ReceiptPath $env:SYSTORCH_EXAMPLE_RECEIPT -Token (ConvertTo-SecureString $env:SYSTORCH_EXAMPLE_TOKEN -AsPlainText -Force)`],{windowsHide:true,encoding:'utf8',timeout:30000,env:{...process.env,PSModulePath:path.join(process.env.WINDIR,'System32/WindowsPowerShell/v1.0/Modules'),SYSTORCH_EXAMPLE_SCRIPT:script,SYSTORCH_EXAMPLE_GATEWAY:base,SYSTORCH_EXAMPLE_RECEIPT:receipt,SYSTORCH_EXAMPLE_TOKEN:secret}});
  assert.equal(result.status,0,result.stderr);assert(!result.stdout.includes(secret));return result;
 };
 const submit=call('Submit');const saved=JSON.parse(await readFile(receipt,'utf8'));assert(saved.task_id);
 assert(!JSON.stringify(saved).includes(secret));report.checks.push('first PowerShell 5.1 process exits after durable acceptance; receipt contains no token');
 call('Submit');const retried=JSON.parse(await readFile(receipt,'utf8'));assert.equal(retried.task_id,saved.task_id);
 report.checks.push('re-running Submit reuses the exact persisted idempotency key and task');
 const pending=call('Query');assert(pending.stdout.includes('pending'));report.checks.push('independent pre-answer query reports pending without cancellation');
 await page.goto(`${base}/#/desk`);
 await page.getByRole('button',{name:/Should I review the changes before continuing/}).click();
 await page.getByRole('radio',{name:'Review the changes first',exact:true}).check();
 await page.getByRole('button',{name:'Submit answer',exact:true}).click();
 await page.getByRole('heading',{name:'Authoritative answer saved',exact:true}).waitFor();
 report.checks.push('native owner decision desk answers the task while no caller process is alive');
 const query=call('Query');assert.notEqual(query.pid,submit.pid);assert(query.stdout.includes('"choice":  "review"')||/"choice":\s*"review"/.test(query.stdout));
 const result=await fetch(`${base}/v1/systorch/decisions/${saved.task_id}/result`,{headers:{Authorization:`Bearer ${secret}`}}).then(r=>r.json());assert.equal(result.answers.choice.choice,'review');
 report.checks.push('fresh PowerShell 5.1 query retrieves the strict result with the same caller token');

 const multiBody={entry:'human:owner',idempotency_key:'native-multi-preview-001',question:'Which first step?',context:{fixture:'two stable questions'},choices:[{id:'review',label:'Review the plan'},{id:'test',label:'Run a test'}],questions:{'q-first':{type:'choice',instructions:'Which first step?',criteria:{review:'Review the plan',test:'Run a test'}},'q-risk':{type:'choice',instructions:'How should risk be handled?',criteria:{fix:'Fix it now',monitor:'Record and monitor'}}},question_order:['q-first','q-risk'],ttl_seconds:3600};
 const accepted=await fetch(`${base}/v1/systorch/decisions`,{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify(multiBody)});
 assert.equal(accepted.status,202);const multiTask=await accepted.json();assert(multiTask.id);
 report.checks.push('real isolated daemon accepts two Choice questions as one durable parent task');
 await page.goto(`${base}/#/desk?task=${encodeURIComponent(multiTask.id)}`);
 await page.getByRole('radio',{name:'Review the plan',exact:true}).check();
 await page.getByRole('radio',{name:'Fix it now',exact:true}).check();
 await page.getByRole('button',{name:'Submit answer',exact:true}).click();
 await page.getByRole('heading',{name:'Authoritative answer saved',exact:true}).waitFor();
 const multiSaved=await fetch(`${base}/v1/systorch/decisions/${multiTask.id}`,{headers:{Authorization:`Bearer ${secret}`}}).then(r=>r.json());
 assert.equal(multiSaved.status,'completed');assert.deepEqual(Object.keys(multiSaved.observations).sort(),['q-first','q-risk']);
 const multiResult=await fetch(`${base}/v1/systorch/decisions/${multiTask.id}/result`,{headers:{Authorization:`Bearer ${secret}`}}).then(r=>r.json());
 assert.equal(multiResult.answers['q-first'].choice,'review');assert.equal(multiResult.answers['q-risk'].choice,'fix');
 report.checks.push('native owner UI answers both question IDs and caller retrieves the matching strict answer map after one restartable task');

	 await page.goto(`${base}/#/start`);
	 await page.locator('.decision-chat-options > details > summary').click();
	 await page.getByLabel('Current entry').selectOption('model:m1-fixture');
	 await page.getByLabel('Question',{exact:true}).fill('Can the packaged app restore a model chat?');
	 await page.getByLabel('Alternatives · one per line').fill('Restore the saved chat\nStart a new one');
	 const chatSaved=page.waitForResponse(r=>/\/v1\/systorch\/sessions\/start_[^/]+\/messages$/.test(r.url())&&r.request().method()==='POST');
	 const modelSent=page.waitForResponse(r=>r.url().endsWith('/v1/systemone')&&r.request().method()==='POST');
	 await page.getByRole('button',{name:'Submit decision',exact:true}).click();
	 const chatReceipt=await chatSaved;assert.equal(chatReceipt.status(),201);
	 const modelReply=await modelSent;assert.equal(modelReply.status(),200);
	 await page.getByRole('heading',{name:'Can the packaged app restore a model chat?',exact:true}).waitFor();
	 const savedSession=await chatReceipt.json();assert.equal(savedSession.summary.message_count,1);assert.equal(savedSession.summary.interrupted,true);
	 const chatId=new URL(chatReceipt.url()).pathname.split('/')[4];
	 await page.reload();
	 await page.getByRole('button',{name:/Can the packaged app restore a model chat/}).first().click();
	 await page.getByRole('heading',{name:'Can the packaged app restore a model chat?',exact:true}).waitFor();
	 await page.getByText('Restore the saved chat',{exact:true}).last().waitFor();
	 const restored=await fetch(`${base}/v1/systorch/sessions/${chatId}`,{headers:{Authorization:`Bearer ${owner}`}}).then(r=>r.json());
	 assert.equal(restored.messages.length,2);assert.equal(restored.summary.interrupted,false);
	 report.checks.push('packaged Windows EXE routes a synthetic model request, persists its response and restores the chat after a page reload');
	 const archiveResponse=await fetch(`${base}/v1/systorch/sessions/${chatId}`,{method:'PATCH',headers:{Authorization:`Bearer ${owner}`,'Content-Type':'application/json'},body:JSON.stringify({expected_revision:restored.summary.revision,archived:true})});
	 assert.equal(archiveResponse.status,200);
	 await page.goto(`${base}/#/settings`);
	 await page.getByRole('heading',{name:'Archived chats',exact:true}).waitFor();
	 await page.getByText('Can the packaged app restore a model chat?',{exact:true}).waitFor();
	 await page.getByRole('button',{name:'Restore',exact:true}).click();
	 await page.getByText('Can the packaged app restore a model chat?',{exact:true}).waitFor({state:'detached'});
	 const activeChats=await fetch(`${base}/v1/systorch/sessions?offset=0&archived=false`,{headers:{Authorization:`Bearer ${owner}`}}).then(r=>r.json());
	 assert.equal(activeChats.find(session=>session.id===chatId).archived,false);
	 report.checks.push('packaged Settings lists archived chats and restores the session to Start history');
 report.completed=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
} finally {
 await browser?.close();
 if(app.exitCode===null) {
  try {execFileSync('taskkill',['/PID',String(app.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}
  await Promise.race([once(app,'exit').catch(()=>{}),new Promise(resolve=>setTimeout(resolve,5000))]);
 }
 if(candidateTitleToken) {
  const target=nativeShellPath.replace(/'/g,"''");
  const command=`$target='${target}'; $token='${candidateTitleToken}'; Get-Process -Name systorch -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $target -and $_.MainWindowTitle -like "*$token*" } | ForEach-Object { taskkill /PID $_.Id /T /F | Out-Null }`;
  try {execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,stdio:'ignore'});}catch{}
 }
 const profileRoot=path.resolve(output);const profilePath=path.resolve(profile);const webviewRoot=path.resolve(process.env.LOCALAPPDATA,'SysTorchExampleTest-');const webviewPath=path.resolve(webview);
 if(profilePath.startsWith(profileRoot+path.sep)) await rm(profilePath,{recursive:true,force:true});
 if(webviewPath.startsWith(webviewRoot)) await rm(webviewPath,{recursive:true,force:true});
 await new Promise(resolve=>upstream.close(resolve));
}
