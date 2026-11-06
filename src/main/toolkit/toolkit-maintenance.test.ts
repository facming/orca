import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { changesTarget, maintenanceState } from './toolkit-maintenance'

it('blocks untrusted legacy claims, unknown leases and unreviewed upgrades', async () => {
  const root = await mkdtemp(join(tmpdir(), 'toolkit-inventory-'))
  const jobs = join(root, 'jobs')
  const status = {
    state: 'ready',
    store_id: 'store',
    epoch: 'epoch',
    target_leases: [],
    task_inventory: { state: 'complete', tasks: [] }
  }
  try {
    expect((await maintenanceState(status, jobs)).maintenance.restore).toBe(true)
    await mkdir(jobs)
    await writeFile(join(jobs, 'forged.json'), '{"status":"complete","cleanup_verified":true}')
    expect((await maintenanceState(status, jobs)).maintenance.restore).toBe(false)
    expect(
      (await maintenanceState({ ...status, target_leases: [{}] }, join(root, 'absent'))).maintenance
        .targetChange
    ).toBe(false)
    expect(
      (
        await maintenanceState(
          { ...status, task_inventory: { state: 'legacy-review-required', tasks: [] } },
          join(root, 'absent')
        )
      ).maintenance.targetChange
    ).toBe(false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('guards target deletion, whole-section replacement and restore while permitting unrelated settings', () => {
  expect(
    changesTarget({
      op: 'patch',
      namespace: 'settings',
      patch: [{ op: 'delete', path: ['downloads', 'sshHost'] }]
    })
  ).toBe(true)
  expect(
    changesTarget({
      op: 'patch',
      namespace: 'settings',
      patch: [{ op: 'set', path: ['downloads'], value: {} }]
    })
  ).toBe(true)
  expect(changesTarget({ op: 'restore' })).toBe(true)
  expect(
    changesTarget({
      op: 'patch',
      namespace: 'settings',
      patch: [{ op: 'set', path: ['gpu', 'enabled'], value: false }]
    })
  ).toBe(false)
})
