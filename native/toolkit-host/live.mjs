// Explicit local development build: existing RPC/SSH, isolated persistent application state.
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
const [
  toolkitArg,
  stageArg,
  stateArg,
  profileArg,
  appArg,
  environment,
  connectionArg,
  remotePort = '22222'
] = process.argv.slice(2)
if (!environment) {
  throw new Error(
    'Usage: node live.mjs TOOLKIT STAGE STATE ORCA_PROFILE ORCA_APP ENVIRONMENT [SSH_CONNECTION REMOTE_PORT]'
  )
}
const toolkit = resolve(toolkitArg),
  stage = resolve(stageArg),
  state = resolve(stateArg),
  profile = resolve(profileArg),
  orcaApp = resolve(appArg)
const repo = fileURLToPath(new URL('../../', import.meta.url)),
  require = createRequire(join(repo, 'package.json'))
mkdirSync(state, { recursive: true, mode: 0o700 })
const store = join(state, 'store')
mkdirSync(store, { mode: 0o700, recursive: true })
const python = '/usr/bin/python3',
  storage = join(toolkit, 'plugins/toolkit/config-service/development.py')
const settings = JSON.parse(readFileSync(join(state, 'settings.json'), 'utf8'))
if (
  settings.accounts.environment !== environment ||
  settings.downloads.environment !== environment
) {
  throw new Error('Settings must use the selected existing Orca environment')
}
if (!existsSync(join(store, 'state.sqlite'))) {
  execFileSync(python, [
    storage,
    '--state',
    store,
    '--initialize-settings',
    join(state, 'settings.json')
  ])
}
const source = `
const {app}=require('electron');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {createRequire}=require('node:module');
const {ToolkitAuthority}=require(${JSON.stringify(join(repo, 'src/main/toolkit/toolkit-authority.ts'))});
const {createToolkitMaintenanceWindow}=require(${JSON.stringify(join(repo, 'src/main/toolkit/toolkit-window.ts'))});
const load=createRequire(${JSON.stringify(join(stage, 'manifest.json'))});
app.setName('Orca Toolkit Development');
app.setPath('home',${JSON.stringify(state)});app.setPath('userData',${JSON.stringify(join(state, 'electron'))});
if(process.env.ORCA_BACKGROUND_LAUNCH==='1')app.setActivationPolicy('prohibited');
const authority=new ToolkitAuthority({validate:load('./config-service/commands.cjs').validate,createHostHandler:authorize=>{let tail=Promise.resolve();return (envelope,grant,signal)=>{const next=tail.then(async()=>{
 if(!authorize(grant))throw Error('Revoked development context');
 const result=promisify(execFile)(${JSON.stringify(python)},${JSON.stringify([storage, '--state', store])},{signal,timeout:30000,maxBuffer:2097152});
 result.child.stdin.end(JSON.stringify(envelope.request));const {stdout}=await result;return JSON.parse(stdout);
});tail=next.catch(()=>{});return next;}}},()=>{throw Error('Development storage does not use the privileged bridge');});
const runtime={platform:'darwin',home:${JSON.stringify(state)},userDataPath:${JSON.stringify(profile)},cli:${JSON.stringify(join(orcaApp, 'Contents/Resources/bin/orca'))},ssh:'/usr/bin/ssh',keygen:'/usr/bin/ssh-keygen',loadSdk:()=>load(${JSON.stringify(join(orcaApp, 'Contents/Resources/app.asar.unpacked/out/cli/runtime-client.js'))}),childEnv:{HOME:${JSON.stringify(state)},PATH:'/usr/bin:/bin',ORCA_USER_DATA_PATH:${JSON.stringify(profile)}},development:true,endpointTrustFile:${JSON.stringify(join(state, 'endpoints.json'))}};
app.whenReady().then(async()=>{const panel=await createToolkitMaintenanceWindow(authority,${JSON.stringify(stage)},runtime);panel.setTitle('Orca Toolkit — Development');global.livePanel=panel;console.log('Live Toolkit ready');if(process.env.ORCA_BACKGROUND_LAUNCH!=='1')panel.show();});
app.on('window-all-closed',()=>app.quit());
process.on('SIGTERM',()=>app.quit());process.on('SIGINT',()=>app.quit());
`
await require('esbuild').build({
  stdin: { contents: source, resolveDir: repo, loader: 'ts' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  outfile: join(state, 'main.cjs')
})
const launchArgs = connectionArg
  ? [
      python,
      join(toolkit, 'scripts/launch-live-host.py'),
      '--electron',
      require('electron'),
      '--entry',
      join(state, 'main.cjs'),
      '--connection',
      resolve(connectionArg),
      '--local-port',
      String(settings.downloads.sshPort),
      '--remote-port',
      remotePort
    ]
  : [require('electron'), join(state, 'main.cjs')]
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`
writeFileSync(
  join(state, 'launch.command'),
  `#!/bin/sh\nexec ${launchArgs.map(quote).join(' ')}\n`,
  { mode: 0o700 }
)
if (connectionArg) {
  writeFileSync(
    join(state, 'stop.command'),
    `#!/bin/sh\nexec ${[python, join(toolkit, 'scripts/launch-live-host.py'), '--entry', join(state, 'main.cjs'), '--stop'].map(quote).join(' ')}\n`,
    { mode: 0o700 }
  )
}
console.log('Built live development Host:', join(state, 'launch.command'))
