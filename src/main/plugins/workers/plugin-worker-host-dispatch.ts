import type { PluginWorkerHostCallExecutor } from './plugin-host-process-types'
import type { PluginHostCallOutcome } from '../../../shared/plugins/frames/plugin-protocol'

export async function dispatchPluginHostCall(
  execute: PluginWorkerHostCallExecutor,
  method: string,
  params: unknown,
  signal: AbortSignal
): Promise<PluginHostCallOutcome> {
  if (method === 'toolkit.configuration.v1') {
    return {
      ok: false,
      code: 'not_permitted',
      error: 'Toolkit configuration requires a Host-owned context'
    }
  }
  try {
    return await execute(method, params, signal)
  } catch {
    return { ok: false, code: 'unavailable', error: 'Host call failed' }
  }
}
