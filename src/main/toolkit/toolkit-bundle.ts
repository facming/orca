import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { runProcess } from '@orca/process-host'
import { z } from 'zod'
import { createRequire } from 'node:module'
import { ToolkitAuthority, type ToolkitAdapter, type SocketPair } from './toolkit-authority'

const required = [
  'config-service/host-handler.cjs',
  'config-service/commands.cjs',
  'platform/errors.cjs',
  'config-service/client.cjs',
  'modules/downloads/host-entry.cjs',
  'modules/downloads/host-browser.cjs',
  'remote-browser.cjs',
  'remote-runtime.cjs',
  'download-preferences.cjs',
  'modules/downloads/engine.cjs',
  'modules/downloads/v3.cjs',
  'modules/downloads/transport.cjs',
  'modules/downloads/local-state.cjs',
  'modules/downloads/settings.cjs',
  'modules/downloads/projects.cjs',
  'socketpair.node',
  'panel.html',
  'panel.js',
  'preload.cjs',
  'worker-node'
]

export function verifyToolkitBundle(root: string): string {
  if (lstatSync(root).isSymbolicLink()) {
    throw new Error('Linked Toolkit root')
  }
  const manifest = z
    .object({
      version: z.literal(1),
      files: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/))
    })
    .strict()
    .parse(JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')))
  if (
    manifest.version !== 1 ||
    Object.keys(manifest.files).sort().join('\n') !== [...required].sort().join('\n')
  ) {
    throw new Error('Invalid Toolkit seal')
  }
  const walk = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const file = join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        throw new Error('Linked Toolkit resource')
      }
      return entry.isDirectory() ? walk(file) : [file]
    })
  if (walk(root).length !== required.length + 1) {
    throw new Error('Unexpected Toolkit resource')
  }
  for (const file of required) {
    const bytes = readFileSync(join(root, file))
    if (createHash('sha256').update(bytes).digest('hex') !== manifest.files[file]) {
      throw new Error('Changed Toolkit resource')
    }
  }
  return createHash('sha256')
    .update(readFileSync(join(root, 'manifest.json')))
    .digest('hex')
}

async function assertProtected(path: string): Promise<void> {
  let current = resolve(path)
  for (;;) {
    const stat = lstatSync(current)
    if (stat.isSymbolicLink() || stat.uid !== 0 || stat.mode & 0o022) {
      throw new Error('Unprotected Toolkit bundle')
    }
    const acl = await runProcess({
      program: '/bin/ls',
      args: ['-lde', current],
      env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
      timeoutMs: 5000,
      maxOutputBytes: 16384
    })
    if (
      acl.code !== 0 ||
      acl.timedOut ||
      acl.outputTruncated ||
      acl.stdout.trim().split('\n').length !== 1
    ) {
      throw new Error('Toolkit ACL is not allowed')
    }
    if (current === dirname(current)) {
      break
    }
    current = dirname(current)
  }
}

export async function assertToolkitRuntime(resources: string): Promise<void> {
  const app = resolve(resources, '../..')
  await assertProtected(app)
  const seal = await runProcess({
    program: '/usr/bin/codesign',
    args: ['--verify', '--deep', '--strict', app],
    env: { PATH: '/usr/bin:/bin' },
    timeoutMs: 30000,
    maxOutputBytes: 65536
  })
  if (seal.code !== 0 || seal.timedOut || seal.outputTruncated) {
    throw new Error('Invalid app signature')
  }
  const binary = readFileSync(
    join(app, 'Contents/Frameworks/Electron Framework.framework/Electron Framework')
  )
  const marker = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX')
  let offset = binary.indexOf(marker)
  if (offset < 0) {
    throw new Error('Missing runtime fuse wire')
  }
  while (offset >= 0) {
    const wire = binary.subarray(offset + marker.length)
    if (
      wire[0] !== 1 ||
      wire[1] < 6 ||
      [0, 2, 3].some((i) => wire[2 + i] !== 48) ||
      [4, 5].some((i) => wire[2 + i] !== 49)
    ) {
      throw new Error('RELEASE BLOCKED: main runtime permits code injection')
    }
    offset = binary.indexOf(marker, offset + marker.length)
  }
}

export async function loadToolkitAuthority(resources: string): Promise<{
  authority: ToolkitAuthority
  root: string
  digest: string
}> {
  if (process.platform !== 'darwin') {
    throw new Error('Toolkit Host requires macOS')
  }
  await assertToolkitRuntime(resources)
  const root = join(resources, 'toolkit-host')
  const digest = verifyToolkitBundle(root)
  for (const file of [...required, 'manifest.json']) {
    await assertProtected(join(root, file))
  }
  if (realpathSync(join(root, 'worker-node')) === realpathSync(process.execPath)) {
    throw new Error('Worker runtime must be distinct')
  }
  const load = createRequire(join(root, 'manifest.json'))
  const adapter: ToolkitAdapter = {
    ...load('./config-service/commands.cjs'),
    ...load('./config-service/host-handler.cjs')
  }
  const native: { createSocketPair: () => SocketPair } = load('./socketpair.node')
  return { authority: new ToolkitAuthority(adapter, native.createSocketPair), root, digest }
}
