// Run with the repository-pinned Node. Produces disposable packaging inputs, never installs them.
import {
  readFileSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  chmodSync,
  existsSync
} from 'node:fs'
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
const panel = readFileSync(join(toolkit, 'configuration-panel.html'), 'utf8')
const script = panel.match(/<script nonce="__TOKEN__">([\s\S]*?)<\/script>/)[1]
put('panel.js', script)
put(
  'panel.html',
  `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>Toolkit configuration</title>${panel.replace(
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
