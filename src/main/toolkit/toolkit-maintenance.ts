import { readdir, lstat } from 'node:fs/promises'
import { z } from 'zod'
import type { ConfigurationRequest } from './toolkit-authority'

const statusSchema = z.object({
  store_id: z.string(),
  epoch: z.string(),
  state: z.string(),
  target_leases: z.array(z.unknown()),
  task_inventory: z.object({
    state: z.string(),
    tasks: z.array(z.object({ task_id: z.string(), released: z.boolean() }).passthrough())
  })
})
export function changesTarget(request: ConfigurationRequest): boolean {
  if (['import', 'restore'].includes(request.op)) {
    return true
  }
  if (request.op !== 'patch' || request.namespace !== 'settings') {
    return false
  }
  return z
    .array(z.object({ path: z.array(z.string()) }))
    .parse(request.patch)
    .some(
      ({ path }) =>
        path[0] === 'downloads' &&
        (path.length === 1 || ['environment', 'sshHost', 'sshUser', 'sshPort'].includes(path[1]))
    )
}

export async function maintenanceState(input: unknown, legacyJobs: string) {
  const status = statusSchema.parse(input)
  let reason =
    status.task_inventory.state === 'complete'
      ? ''
      : 'Legacy task inventory requires offline review.'
  if (status.target_leases.length) {
    reason = 'Active or unknown download leases require verified cleanup.'
  }
  try {
    const info = await lstat(legacyJobs)
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error('Unsafe legacy inventory')
    }
    const entries = await readdir(legacyJobs)
    const known = new Set(status.task_inventory.tasks.map((task) => `${task.task_id}.json`))
    if (entries.some((name) => !known.has(name))) {
      reason =
        'Legacy or unknown download files require offline review; their claimed state is not trusted.'
    }
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      reason = 'Download inventory could not be verified.'
    }
  }
  return {
    ...status,
    maintenance: {
      targetChange: !reason,
      confirm: !reason && status.state === 'migration-pending',
      restore: !reason && status.state === 'ready',
      reason
    }
  }
}
