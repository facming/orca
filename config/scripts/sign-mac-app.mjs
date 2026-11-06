import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join, sep } from 'node:path'
import { signAndSeal, verifySeal } from '../../native/toolkit-host/seal.mjs'

export function signMacApp(options, { sign, retry }) {
  // A custom signer bypasses electron-builder's retry wrapper.
  return retry(() => sign({ ...options, batchCodesignCalls: true }), {
    retries: 3,
    interval: 5000,
    backoff: 5000
  })
}

export default async function sign(options) {
  const { sign: signApplication } = await import('@electron/osx-sign')
  const builderRequire = createRequire(createRequire(import.meta.url).resolve('electron-builder'))
  const require = createRequire(builderRequire.resolve('app-builder-lib'))
  const { retry } = require('builder-util')
  const started = performance.now()
  const toolkitRoot = join(options.app, 'Contents/Resources/toolkit-host')
  if (existsSync(toolkitRoot)) {
    signAndSeal(
      toolkitRoot,
      options.identity,
      options.identity === '-' && process.env.ORCA_MAC_ADHOC === '1'
    )
    options = {
      ...options,
      ignore: [
        ...(options.ignore ?? []),
        (path) => path === toolkitRoot || path.startsWith(toolkitRoot + sep)
      ]
    }
  }
  await signMacApp(options, { sign: signApplication, retry })
  if (existsSync(toolkitRoot)) {
    verifySeal(toolkitRoot)
  }
  console.log(
    `[mac-sign] batched signing completed in ${Math.round(performance.now() - started)}ms`
  )
}
