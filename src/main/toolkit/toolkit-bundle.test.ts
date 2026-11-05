import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { verifyToolkitBundle, loadToolkitAuthority } from './toolkit-bundle'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})
function syntheticBundle(): string {
  const root = mkdtempSync(join(tmpdir(), 'toolkit-seal-'))
  roots.push(root)
  const files: Record<string, string> = {}
  for (const name of [
    'config-service/host-handler.cjs',
    'config-service/commands.cjs',
    'platform/errors.cjs',
    'socketpair.node',
    'panel.html',
    'panel.js',
    'preload.cjs',
    'worker-node'
  ]) {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), 'synthetic seal fixture')
    files[name] = createHash('sha256').update('synthetic seal fixture').digest('hex')
  }
  writeFileSync(join(root, 'manifest.json'), JSON.stringify({ version: 1, files }))
  return root
}
it('rejects changed executable bytes and unlisted dependencies before loading code', () => {
  const root = syntheticBundle()
  verifyToolkitBundle(root)
  writeFileSync(join(root, 'panel.js'), 'tampered')
  expect(() => verifyToolkitBundle(root)).toThrow('Changed')
})
it('rejects extra dependency files and linked resources even with matching bytes', () => {
  const root = syntheticBundle()
  writeFileSync(join(root, 'extra.cjs'), '')
  expect(() => verifyToolkitBundle(root)).toThrow('Unexpected')
  rmSync(join(root, 'extra.cjs'))
  rmSync(join(root, 'panel.js'))
  symlinkSync(join(root, 'panel.html'), join(root, 'panel.js'))
  expect(() => verifyToolkitBundle(root)).toThrow('Linked')
})
it('a copied manifest in a user-writable directory cannot create production authority', async () => {
  const root = syntheticBundle()
  await expect(loadToolkitAuthority(root)).rejects.toThrow()
})
