// Run with the repository-pinned Node. Produces disposable packaging inputs, never installs them.
import {
  readFileSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  chmodSync,
  existsSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { NODE_RUNTIME_ASSETS } from '../../src/shared/node-runtime-pin.ts'

const [toolkitPath, outputPath, nodePath, headersPath] = process.argv.slice(2)
if (!toolkitPath || !outputPath || !nodePath || !headersPath || process.platform !== 'darwin') {
  throw new Error('Usage: node stage.mjs TOOLKIT_REPO NEW_OUTPUT PINNED_NODE NODE_HEADERS (macOS)')
}
const root = resolve(outputPath),
  toolkit = resolve(toolkitPath, 'plugins/toolkit')
if (existsSync(root)) {
  throw new Error('Output must not exist')
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const pin = NODE_RUNTIME_ASSETS[`darwin-${process.arch}`]
if (!pin || hash(readFileSync(nodePath)) !== pin.executableSha256) {
  throw new Error('Worker Node does not match repository pin')
}
mkdirSync(root, { recursive: true })
const files = {}
function put(name, bytes) {
  mkdirSync(dirname(join(root, name)), { recursive: true })
  writeFileSync(join(root, name), bytes)
  files[name] = hash(bytes)
}
for (const name of [
  'config-service/host-handler.cjs',
  'config-service/client.cjs',
  'modules/downloads/host-entry.cjs',
  'modules/downloads/host-browser.cjs',
  'remote-browser.cjs',
  'host-tools.cjs',
  'account-preferences.cjs',
  'modules/accounts.cjs',
  'modules/gpu-macos.cjs',
  'remote-runtime.cjs',
  'download-preferences.cjs',
  'modules/downloads/engine.cjs',
  'modules/downloads/v3.cjs',
  'modules/downloads/transport.cjs',
  'modules/downloads/local-state.cjs',
  'modules/downloads/settings.cjs',
  'modules/downloads/projects.cjs',
  'config-service/commands.cjs',
  'platform/errors.cjs'
]) {
  put(name, readFileSync(join(toolkit, name)))
}
const { fragment } = createRequire(import.meta.url)(join(toolkit, 'compose-ui.cjs'))
const accounts = fragment('accounts.html')
const accountMarkup = accounts.content.replace('<a href="/">← Orca Toolkit</a>', '')
const panel = readFileSync(join(toolkit, 'configuration-panel.html'), 'utf8')
  .replace('<!-- HOST_ACCOUNTS -->', accountMarkup)
  .replace(
    '/* HOST_ACCOUNTS_SCRIPT */',
    `(()=>{const root=window.document.getElementById('host-accounts');const document={getElementById:id=>root.querySelector('#'+id),createElement:tag=>window.document.createElement(tag),get visibilityState(){return window.document.visibilityState;}};${accounts.script}})();`
  )

const script = panel.match(/<script nonce="__TOKEN__">([\s\S]*?)<\/script>/)[1]
put('panel.js', script)
put(
  'panel.html',
  `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Orca Toolkit</title><style>body{font:14px system-ui;margin:24px;line-height:1.5;color:CanvasText;background:Canvas;color-scheme:light dark}section{margin-block:24px}input,button{font:inherit;margin:4px;padding:6px}fieldset{margin-block:12px;min-width:0}pre,p{overflow-wrap:anywhere}progress{width:100%}nav{display:flex;flex-wrap:wrap;gap:12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.card{border:1px solid GrayText;padding:12px}pre{white-space:pre-wrap}button:disabled{opacity:.5}#host-download-form{display:flex;flex-wrap:wrap;gap:8px;align-items:end}#host-download-form label{display:grid;gap:4px}#host-download-concurrency{width:5em}.top,.label{display:flex;justify-content:space-between;gap:12px}.window{margin-block:12px}.track{height:6px;background:ButtonFace}.fill{height:100%;background:Highlight}.badge{margin-inline-start:8px}details{margin-block:12px}</style>${panel.replace(
    /<script[\s\S]*?<\/script>/,
    '<script src="panel.js"></script>'
  )}`
)
put(
  'preload.cjs',
  `const {contextBridge,ipcRenderer}=require('electron');
const ready=new Promise(resolve=>ipcRenderer.once('toolkit:ready:v1',resolve));
contextBridge.exposeInMainWorld('orcaToolkitConfiguration',{call(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.hasOwn(input,'op'))throw new Error('Invalid configuration command');
 const {operation='status',...args}=input;
 return ready.then(()=>ipcRenderer.invoke('toolkit:configuration:v1',{version:1,request:{op:operation==='confirm'?'import':operation,...args}}));
}});
ipcRenderer.on('toolkit:section:v1',(_event,section)=>{document.getElementById(section)?.scrollIntoView();});
contextBridge.exposeInMainWorld('orcaToolkitTools',{call(input){return ready.then(()=>ipcRenderer.invoke('toolkit:tools:v1',input));}});
contextBridge.exposeInMainWorld('orcaToolkitDownloads',{call(input){return ready.then(()=>ipcRenderer.invoke('toolkit:downloads:v1',input));}});\n`
)
execFileSync('/usr/bin/cc', [
  '-Wall',
  '-Wextra',
  '-Werror',
  '-bundle',
  '-undefined',
  'dynamic_lookup',
  `-I${resolve(headersPath)}`,
  fileURLToPath(new URL('socketpair.c', import.meta.url)),
  '-o',
  join(root, 'socketpair.node')
])
files['socketpair.node'] = hash(readFileSync(join(root, 'socketpair.node')))
copyFileSync(nodePath, join(root, 'worker-node'))
chmodSync(join(root, 'worker-node'), 0o755)
files['worker-node'] = hash(readFileSync(join(root, 'worker-node')))
writeFileSync(join(root, 'manifest.json'), `${JSON.stringify({ version: 1, files }, null, 2)}\n`)
console.log(
  'Staged Toolkit Host. RELEASE BLOCKED: seal hashes must be regenerated after nested signing; production enrollment remains mandatory.'
)
