// Real fork/IPC on a staged independent Node. No Electron UI or installed app is launched.
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const resources = resolve(process.argv[2])
const root = mkdtempSync(join(tmpdir(), 'toolkit-worker-smoke-'))
let worker
try {
  for (const [input, output] of [
    ['src/main/plugins/workers/plugin-host-process.ts', 'parent.cjs'],
    ['src/main/plugins/workers/plugin-host-entry.ts', 'entry.cjs']
  ]) {
    await build({
      entryPoints: [input],
      outfile: join(root, output),
      bundle: true,
      platform: 'node',
      format: 'cjs'
    })
  }
  process.resourcesPath = resources
  const { startPluginWorker } = createRequire(import.meta.url)(join(root, 'parent.cjs'))
  writeFileSync(
    join(root, 'main.mjs'),
    `export default function activate(api) { api.commands.register('identity', () => ({execPath:process.execPath,nodeMode:process.env.ELECTRON_RUN_AS_NODE ?? null,privateAPI:api.host.has('toolkit.configuration.v1')})); }`
  )
  worker = await startPluginWorker({
    pluginId: 'toolkit',
    rootDir: root,
    mainEntry: 'main.mjs',
    entryPath: join(root, 'entry.cjs'),
    grantedCapabilities: [],
    executeHostCall: async () => ({ ok: true, value: null }),
    log: () => {}
  })
  assert.deepEqual(await worker.invokeCommand('identity'), {
    execPath: realpathSync(join(resources, 'toolkit-host/worker-node')),
    nodeMode: null,
    privateAPI: false
  })
  console.log(
    'PASS: explicit independent worker Node, real IPC, no RUN_AS_NODE env, no private configuration discovery'
  )
} finally {
  await worker?.dispose()
  rmSync(root, { recursive: true, force: true })
}
