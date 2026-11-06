import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync, lstatSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const required = [
  'config-service/commands.cjs',
  'config-service/host-handler.cjs',
  'panel.html',
  'panel.js',
  'platform/errors.cjs',
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
  'preload.cjs',
  'socketpair.node',
  'worker-node'
].sort()
export function verifySeal(root) {
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json')))
  const walk = (directory) =>
    readdirSync(directory).flatMap((name) => {
      const file = join(directory, name),
        stat = lstatSync(file)
      if (stat.isSymbolicLink()) {
        throw new Error('Linked resource')
      }
      return stat.isDirectory() ? walk(file) : [file.slice(root.length + 1)]
    })
  if (
    lstatSync(root).isSymbolicLink() ||
    walk(root).sort().join() !== [...required, 'manifest.json'].sort().join() ||
    manifest.version !== 1 ||
    Object.keys(manifest.files).sort().join() !== required.join()
  ) {
    throw new Error('Unexpected seal resources')
  }
  for (const name of required) {
    if (hash(readFileSync(join(root, name))) !== manifest.files[name]) {
      throw new Error(`Changed resource: ${name}`)
    }
  }
  return manifest
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
export function signAndSeal(root, identity, testOnly = false) {
  verifySeal(root)
  if (
    process.platform !== 'darwin' ||
    (identity === '-'
      ? !testOnly
      : !identity.startsWith('Developer ID Application:') && !/^[a-fA-F0-9]{40}$/.test(identity))
  ) {
    throw new Error('Explicit Developer ID identity or --test-only ad-hoc required')
  }
  const manifest = { version: 1, files: {} }
  for (const name of ['worker-node', 'socketpair.node']) {
    const args = ['--force', '--options', 'runtime', '--sign', identity]
    if (identity !== '-') {
      args.push('--timestamp')
    }
    if (name === 'worker-node') {
      args.push(
        '--entitlements',
        fileURLToPath(new URL('entitlements.worker.plist', import.meta.url))
      )
    }
    args.push(join(root, name))
    execFileSync('/usr/bin/codesign', args, { stdio: 'inherit' })
    if (identity !== '-') {
      execFileSync(
        '/usr/bin/codesign',
        [
          '--verify',
          '--strict',
          '-R',
          '=anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists',
          join(root, name)
        ],
        { stdio: 'inherit' }
      )
    }
    execFileSync('/usr/bin/codesign', ['--verify', '--strict', join(root, name)], {
      stdio: 'inherit'
    })
  }
  for (const name of required) {
    manifest.files[name] = hash(readFileSync(join(root, name)))
  }
  writeFileSync(join(root, 'manifest.json.tmp'), `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: 'wx'
  })
  renameSync(join(root, 'manifest.json.tmp'), join(root, 'manifest.json'))
  verifySeal(root)
}
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const [root, identity, flag] = process.argv.slice(2)
  if (!root || !identity || (flag && flag !== '--test-only')) {
    throw new Error('Usage: seal.mjs STAGE_ROOT IDENTITY [--test-only]')
  }
  signAndSeal(resolve(root), identity, flag === '--test-only')
  console.log(
    'Nested signatures and manifest verified. Outer app must be signed last. RELEASE BLOCKED; no enrollment performed.'
  )
}
