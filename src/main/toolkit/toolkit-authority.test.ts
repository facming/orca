import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createToolkitPanelContext } from './toolkit-panel-context'
import {
  ToolkitAuthority,
  TOOLKIT_CONFIGURATION_METHOD,
  type ToolkitAdapter,
  type ConfigurationReply
} from './toolkit-authority'

function syntheticAuthority(
  run: (signal: AbortSignal) => Promise<ConfigurationReply> = async () => ({
    ok: true,
    result: { state: 'ready' }
  })
): ToolkitAuthority {
  const adapter: ToolkitAdapter = {
    validate(request) {
      const value = z.object({ op: z.string() }).strict().parse(request)
      if (Object.keys(value).join() !== 'op') {
        throw new Error('Invalid fields')
      }
      return value
    },
    createHostHandler(authorize) {
      return async (_envelope, grant, signal) => (authorize(grant) ? run(signal) : { ok: false })
    }
  }
  return new ToolkitAuthority(adapter, () => {
    throw new Error('Synthetic identity test: no native transport')
  })
}
const envelope = { version: 1, request: { op: 'status' } }
const approve = async (): Promise<boolean> => true

describe('synthetic Host context authorization (not signed Host acceptance)', () => {
  it('rejects forged key/session, copied objects, leases and public command authority', async () => {
    const authority = syntheticAuthority(),
      context = authority.openContext()
    for (const forged of [
      {},
      { ...context },
      { pluginKey: 'toolkit', capability: 'trusted-node-worker' }
    ]) {
      expect(
        (await authority.call(forged, TOOLKIT_CONFIGURATION_METHOD, envelope, approve)).ok
      ).toBe(false)
    }
    for (const input of [
      { ...envelope, session: context },
      { version: 1, request: { op: 'status', pluginKey: 'toolkit' } },
      { version: 1, request: { op: 'lease-acquire' } }
    ]) {
      expect((await authority.call(context, TOOLKIT_CONFIGURATION_METHOD, input, approve)).ok).toBe(
        false
      )
    }
    expect((await authority.call(context, 'command.invoke', envelope, approve)).ok).toBe(false)
    expect(await authority.call(context, TOOLKIT_CONFIGURATION_METHOD, envelope, approve)).toEqual({
      ok: true,
      result: { state: 'ready' }
    })
  })

  it('revokes the old generation during approval and isolates reloads', async () => {
    const authority = syntheticAuthority(),
      old = authority.openContext()
    let release!: (value: boolean) => void
    const call = authority.call(
      old,
      TOOLKIT_CONFIGURATION_METHOD,
      envelope,
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    authority.revoke(old)
    const current = authority.openContext()
    release(true)
    expect((await call).ok).toBe(false)
    expect((await authority.call(old, TOOLKIT_CONFIGURATION_METHOD, envelope, approve)).ok).toBe(
      false
    )
    expect(
      (await authority.call(current, TOOLKIT_CONFIGURATION_METHOD, envelope, approve)).ok
    ).toBe(true)
  })

  it('bounds concurrent admissions and aborts active requests on revoke', async () => {
    const authority = syntheticAuthority(
      (signal) =>
        new Promise((resolve) =>
          signal.addEventListener('abort', () => resolve({ ok: false }), { once: true })
        )
    )
    const context = authority.openContext()
    const calls = Array.from({ length: 4 }, () =>
      authority.call(context, TOOLKIT_CONFIGURATION_METHOD, envelope, approve)
    )
    expect(
      (await authority.call(context, TOOLKIT_CONFIGURATION_METHOD, envelope, approve)).ok
    ).toBe(false)
    authority.revokeAll()
    expect((await Promise.all(calls)).every((reply) => !reply.ok)).toBe(true)
  })

  it('keeps the admitted payload immutable across asynchronous approval', async () => {
    const authority = syntheticAuthority(),
      context = authority.openContext()
    const input = structuredClone(envelope)
    const result = authority.call(context, TOOLKIT_CONFIGURATION_METHOD, input, async (request) => {
      input.request.op = 'restore'
      request.op = 'lease-acquire'
      return true
    })
    expect((await result).ok).toBe(true)
  })
})

it('rejects ordinary renderers, child frames, navigation and a revoked document (synthetic sources)', async () => {
  const authority = syntheticAuthority(),
    frame = {},
    source = { mainFrame: frame, getURL: () => 'file:///sealed/panel.html' }
  const context = createToolkitPanelContext(authority, source, 'file:///sealed/panel.html', approve)
  await expect(context.call({ sender: {}, senderFrame: frame }, envelope)).rejects.toThrow(
    'Unauthorized'
  )
  await expect(context.call({ sender: source, senderFrame: {} }, envelope)).rejects.toThrow(
    'Unauthorized'
  )
  expect((await context.call({ sender: source, senderFrame: frame }, envelope)).ok).toBe(true)
  source.getURL = () => 'http://localhost:18774/'
  await expect(context.call({ sender: source, senderFrame: frame }, envelope)).rejects.toThrow(
    'Unauthorized'
  )
  source.getURL = () => 'file:///sealed/panel.html'
  source.mainFrame = {}
  await expect(
    context.call({ sender: source, senderFrame: source.mainFrame }, envelope)
  ).rejects.toThrow('Unauthorized')
  source.mainFrame = frame
  context.revoke()
  expect((await context.call({ sender: source, senderFrame: frame }, envelope)).ok).toBe(false)
})
