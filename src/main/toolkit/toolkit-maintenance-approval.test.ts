import { expect, it } from 'vitest'
import { createMaintenanceApproval } from './toolkit-maintenance-approval'

const restore = {
  op: 'restore',
  request_id: 'request',
  backup_id: 'backup',
  store_id: 'store',
  epoch: 'before'
}
it('replays only the exact approved restore after its epoch changes, without authorizing another restore', async () => {
  let epoch = 'before'
  const approve = createMaintenanceApproval(
    async () => ({ store_id: 'store', epoch, maintenance: { targetChange: true } }),
    async () => true,
    () => false
  )
  expect(await approve(restore)).toBe(true)
  epoch = 'after'
  expect(await approve(restore)).toBe(true)
  expect(await approve({ ...restore, backup_id: 'other' })).toBe(false)
  expect(await approve({ ...restore, request_id: 'other' })).toBe(false)
})

it('rechecks inventory after a native confirmation and rejects unseen previews', async () => {
  let idle = true
  const approve = createMaintenanceApproval(
    async () => ({ store_id: 'store', epoch: 'before', maintenance: { targetChange: idle } }),
    async () => {
      idle = false
      return true
    },
    () => false
  )
  expect(await approve(restore)).toBe(false)
  expect(await approve({ op: 'import', preview_id: 'forged' })).toBe(false)
})
