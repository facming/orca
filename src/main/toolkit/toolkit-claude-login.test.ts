import { clipboard } from 'electron'
import { expect, it, vi } from 'vitest'
import type { ToolkitRuntime } from './toolkit-download-browser'
import { createToolkitClaudeLogin } from './toolkit-claude-login'

vi.mock('electron', () => ({ clipboard: { writeText: vi.fn() } }))

function fixture(remote = true) {
  let phase = 'starting'
  const calls: { method: string; params: unknown }[] = []
  const runtime: ToolkitRuntime = {
    platform: 'darwin',
    cli: 'orca',
    ssh: 'ssh',
    keygen: 'ssh-keygen',
    home: 'unused',
    userDataPath: 'unused',
    childEnv: {},
    loadSdk: () => ({
      RuntimeClient: class {
        isRemote = remote
        async call(method: string, params: unknown) {
          calls.push({ method, params })
          if (method === 'accounts.hostSignInStart') {
            phase = 'starting'
          }
          if (method === 'accounts.hostSignInWait') {
            phase = 'waiting'
          }
          if (method === 'accounts.hostSignInSubmitCode') {
            phase = 'signedIn'
          }
          if (method === 'accounts.hostSignInCancel') {
            phase = 'cancelled'
          }
          return {
            ok: true,
            _meta: { runtimeId: 'test-vps' },
            result: {
              flowId: 'test-flow',
              phase,
              prompt:
                phase === 'waiting'
                  ? { url: 'https://claude.ai/oauth/authorize?state=test-only', needsCode: true }
                  : undefined,
              claude: { accounts: [{ email: 'private@example.test' }] }
            }
          }
        }
      }
    })
  }
  return { login: createToolkitClaudeLogin(runtime), calls }
}

it('relays remote OAuth, keeping the URL, raw account identity and flow ID out of the panel', async () => {
  const { login, calls } = fixture()
  await login.start('vps')
  const waiting = await login.poll('vps')
  expect(waiting.phase).toBe('waiting')
  expect(waiting.needsCode).toBe(true)
  expect(waiting).not.toHaveProperty('prompt')
  expect(waiting).not.toHaveProperty('flowId')
  login.copy()
  expect(clipboard.writeText).toHaveBeenCalledWith(
    'https://claude.ai/oauth/authorize?state=test-only'
  )
  const complete = await login.submit('one-time-test-code')
  expect(complete.phase).toBe('signedIn')
  expect(complete).not.toHaveProperty('claude')
  expect(calls).toContainEqual({
    method: 'accounts.hostSignInSubmitCode',
    params: { flowId: 'test-flow', code: 'one-time-test-code' }
  })
  await login.close()
})

it('cancels the owned remote flow on connection changes and window close', async () => {
  const { login, calls } = fixture()
  await login.start('vps')
  await expect(login.poll('different-vps')).rejects.toThrow('connection changed')
  expect(login.status().phase).toBe('cancelled')
  await login.start('vps')
  await login.close()
  expect(calls.at(-1)).toEqual({
    method: 'accounts.hostSignInCancel',
    params: { flowId: 'test-flow' }
  })
})

it('never starts account login in a local runtime', async () => {
  const { login, calls } = fixture(false)
  await expect(login.start('vps')).rejects.toThrow('must run on the configured VPS')
  expect(calls).toEqual([])
})
