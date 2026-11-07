import { existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { verifyToolkitBundle } from './toolkit-bundle'

export function toolkitWorkerRuntime(resources: string | undefined): string | undefined {
  if (process.platform !== 'darwin' || !resources) {
    return undefined
  }
  const root = join(resources, 'toolkit-host')
  if (!existsSync(root)) {
    return undefined
  }
  verifyToolkitBundle(root)
  const runtime = join(root, 'worker-node')
  if (realpathSync(runtime) === realpathSync(process.execPath)) {
    throw new Error('Toolkit worker runtime is not separate')
  }
  return runtime
}
