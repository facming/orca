import { clipboard } from 'electron'
import { z } from 'zod'
import { isHostAccountSignInPage } from '../../shared/host-account-sign-in-types'
import type { ToolkitRuntime } from './toolkit-download-browser'

const flowSchema = z.object({
  flowId: z.string(),
  phase: z.enum(['starting', 'waiting', 'verifying', 'signedIn', 'failed', 'cancelled']),
  prompt: z.object({ url: z.string(), needsCode: z.boolean() }).optional(),
  error: z.string().optional()
})
type Flow = z.infer<typeof flowSchema>
type Client = {
  isRemote: boolean
  call(
    method: string,
    params: unknown
  ): Promise<{
    ok: boolean
    result: unknown
    _meta?: { runtimeId?: string }
  }>
}

export function createToolkitClaudeLogin(runtime: ToolkitRuntime) {
  let client: Client | null = null
  let flow: Flow | null = null
  let runtimeId: string | undefined
  let environment = ''
  let closed = false
  let opening = false
  const active = () => !!flow && ['starting', 'waiting', 'verifying'].includes(flow.phase)
  const status = () => ({
    phase: flow?.phase ?? 'idle',
    needsCode: flow?.phase === 'waiting' && flow.prompt?.needsCode === true,
    canCopy: flow?.phase === 'waiting' && !!flow.prompt,
    message:
      flow?.phase === 'failed'
        ? /took too long|timed out/i.test(flow.error ?? '')
          ? 'Claude sign-in timed out. Start again; existing accounts are unchanged.'
          : 'Claude sign-in failed or was denied. Retry sign-in on the connected VPS.'
        : {
            starting: 'Preparing an independent Claude account on the VPS…',
            waiting:
              'Copy the sign-in link and open it in the VPS browser through RustDesk. Complete authorization there, then paste Claude’s one-time code below.',
            verifying: 'The VPS is completing Claude sign-in…',
            signedIn: 'Account added on the VPS. Use this account to select it for new sessions.',
            cancelled: 'Sign-in cancelled. Existing accounts are unchanged.'
          }[flow?.phase ?? 'cancelled']
  })
  const call = async (method: string, params: unknown) => {
    if (!client) {
      throw new Error('Start Claude sign-in first.')
    }
    const reply = await client.call(method, params).catch(() => {
      throw new Error('VPS sign-in connection interrupted. Refresh or cancel before retrying.')
    })
    if (!reply.ok || !reply._meta?.runtimeId) {
      throw new Error(
        'VPS sign-in unavailable. Check the connection and the remote Orca version, then retry.'
      )
    }
    if (runtimeId && runtimeId !== reply._meta.runtimeId) {
      throw new Error('The VPS runtime changed. Refresh accounts before starting sign-in again.')
    }
    runtimeId = reply._meta.runtimeId
    flow = flowSchema.parse(reply.result)
    return status()
  }
  return {
    status,
    async start(selectedEnvironment: string) {
      if (closed || opening || active()) {
        throw new Error('Finish or cancel the current Claude sign-in first.')
      }
      if (!selectedEnvironment) {
        throw new Error('Choose the VPS account connection in Settings first.')
      }
      opening = true
      try {
        const sdk = z
          .object({
            RuntimeClient: z.custom<new (...args: unknown[]) => Client>(
              (value) => typeof value === 'function' && typeof value.prototype?.call === 'function'
            )
          })
          .parse(runtime.loadSdk())
        client = new sdk.RuntimeClient(
          runtime.userDataPath,
          30000,
          null,
          selectedEnvironment,
          runtime.cli
        )
        if (!client.isRemote) {
          throw new Error('Claude accounts must run on the configured VPS.')
        }
        environment = selectedEnvironment
        runtimeId = undefined
        await call('accounts.hostSignInStart', { provider: 'claude' })
        if (closed) {
          await this.cancel()
        }
        return status()
      } finally {
        opening = false
      }
    },
    async poll(selectedEnvironment: string) {
      if (active() && environment !== selectedEnvironment) {
        await this.cancel()
        throw new Error('Account connection changed. The previous sign-in was cancelled.')
      }
      if (!active()) {
        return status()
      }
      await call('accounts.hostSignInWait', { flowId: flow?.flowId, afterRevision: 0 })
      return status()
    },
    copy() {
      if (
        !flow?.prompt ||
        flow.phase !== 'waiting' ||
        !isHostAccountSignInPage('claude', flow.prompt.url)
      ) {
        throw new Error('The VPS has not supplied a valid Claude sign-in page yet.')
      }
      clipboard.writeText(flow.prompt.url)
      return status()
    },
    async submit(code: string) {
      return call('accounts.hostSignInSubmitCode', { flowId: flow?.flowId, code })
    },
    async cancel() {
      if (active()) {
        return call('accounts.hostSignInCancel', { flowId: flow?.flowId })
      }
      return status()
    },
    async close() {
      closed = true
      await this.cancel().catch(() => undefined)
    }
  }
}
