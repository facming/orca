import { app, shell } from 'electron'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { z } from 'zod'
import { TOOLKIT_CONFIGURATION_METHOD, type ToolkitAuthority } from './toolkit-authority'
import { createToolkitDownloadBrowser } from './toolkit-download-browser'

const accountId = z.string().min(1).max(200)
const commands = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('accounts') }).strict(),
  z.object({ operation: z.literal('accounts-refresh') }).strict(),
  z
    .object({
      operation: z.literal('accounts-select'),
      accountId,
      expectedActiveAccountId: accountId.nullable()
    })
    .strict(),
  z.object({ operation: z.literal('accounts-disable'), accountId, disabled: z.boolean() }).strict(),
  z.object({ operation: z.literal('gpu-status') }).strict(),
  z.object({ operation: z.literal('gpu-workflows') }).strict(),
  z.object({ operation: z.literal('gpu-open') }).strict()
])

export function createToolkitTools(authority: ToolkitAuthority, root: string) {
  const context = authority.openContext()
  const browsing = createToolkitDownloadBrowser(authority, root)
  const readSettings = async () => {
    const reply = await authority.call(
      context,
      TOOLKIT_CONFIGURATION_METHOD,
      { version: 1, request: { op: 'read', namespace: 'settings' } },
      async () => true
    )
    if (!reply.ok || typeof reply.result?.raw_json !== 'string') {
      throw new Error(reply.error ?? 'Read Host settings before using Toolkit')
    }
    return JSON.parse(reply.result.raw_json)
  }
  const service: { call(input: unknown): Promise<unknown>; close(): void } = createRequire(
    join(root, 'manifest.json')
  )('./host-tools.cjs').create({
    runtime: {
      ...browsing.runtime,
      gpuDir: join(app.getPath('home'), 'Library/Application Support/LocalGpuBridge')
    },
    readSettings,
    dataDir: join(app.getPath('home'), 'Library/Application Support/OrcaTools')
  })
  let closed = false
  let tail: Promise<unknown> = Promise.resolve()
  return {
    call(input: unknown) {
      const command = commands.parse(input)
      const result = tail.then(async () => {
        if (closed) {
          throw new Error('Toolkit session revoked')
        }
        if (command.operation === 'gpu-open') {
          if (!(await readSettings()).gpu.enabled) {
            throw new Error('GPU tools are disabled in settings')
          }
          await shell.openExternal('http://127.0.0.1:18773/')
          return { opened: true }
        }
        return service.call(command)
      })
      tail = result.catch(() => undefined)
      return result
    },
    close() {
      closed = true
      service.close()
      browsing.close()
      authority.revoke(context)
    }
  }
}
