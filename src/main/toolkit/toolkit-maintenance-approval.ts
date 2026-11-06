import type { ConfigurationRequest } from './toolkit-authority'
import { changesTarget } from './toolkit-maintenance'

type Inspection = {
  store_id: string
  epoch: string
  maintenance: { targetChange: boolean }
}

export function createMaintenanceApproval(
  inspect: () => Promise<Inspection>,
  confirm: (request: ConfigurationRequest) => Promise<boolean>,
  previewMatches: (request: ConfigurationRequest) => boolean
) {
  const approved = new Map<string, string>()
  return async (request: ConfigurationRequest): Promise<boolean> => {
    const id = typeof request.request_id === 'string' ? request.request_id : undefined
    const digest = JSON.stringify(request)
    if (id && approved.has(id)) {
      return approved.get(id) === digest
    }
    if (request.op === 'import' && !previewMatches(request)) {
      return false
    }
    const eligible = async (): Promise<boolean> => {
      if (!changesTarget(request)) {
        return true
      }
      const status = await inspect()
      return (
        status.maintenance.targetChange &&
        request.store_id === status.store_id &&
        request.epoch === status.epoch
      )
    }
    if (!(await eligible()) || !(await confirm(request)) || !(await eligible())) {
      return false
    }
    if (id) {
      if (approved.size >= 128) {
        approved.delete(approved.keys().next().value ?? '')
      }
      approved.set(id, digest)
    }
    return true
  }
}
