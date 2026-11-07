import { app, dialog, shell } from 'electron'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { z } from 'zod'
import { runProcess } from '@orca/process-host'
import { createToolkitClaudeLogin } from './toolkit-claude-login'
import { workbenchCommand } from './toolkit-workbench'
import { TOOLKIT_CONFIGURATION_METHOD, type ToolkitAuthority } from './toolkit-authority'
import { createToolkitDownloadBrowser, type ToolkitRuntime } from './toolkit-download-browser'

const accountId = z.string().min(1).max(200)
const commands = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('workbench'), command: workbenchCommand }).strict(),
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
  z.object({ operation: z.literal('accounts-remove'), accountId }).strict(),
  z
    .object({
      operation: z.enum([
        'accounts-login-start',
        'accounts-login-status',
        'accounts-login-cancel',
        'accounts-login-open',
        'accounts-login-copy'
      ])
    })
    .strict(),
  z
    .object({
      operation: z.literal('accounts-login-submit'),
      code: z
        .string()
        .trim()
        .min(1)
        .max(4096)
        .regex(/^[^\s\p{Cc}]+$/u)
    })
    .strict(),
  z.object({ operation: z.literal('gpu-status') }).strict(),
  z.object({ operation: z.literal('gpu-workflows') }).strict(),
  z.object({ operation: z.literal('gpu-open') }).strict()
])

export function createToolkitTools(
  authority: ToolkitAuthority,
  root: string,
  runtime?: ToolkitRuntime
) {
  const context = authority.openContext()
  const browsing = createToolkitDownloadBrowser(authority, root, runtime)
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
  const login = createToolkitClaudeLogin(browsing.runtime)
  let accountMutation = false
  let closed = false
  let tail: Promise<unknown> = Promise.resolve()
  return {
    call(input: unknown) {
      const command = commands.parse(input)
      const mutation = ['accounts-select', 'accounts-disable', 'accounts-remove'].includes(
        command.operation
      )
      if (mutation && accountMutation) {
        return Promise.reject(new Error('An account change is in progress. Refresh shortly.'))
      }
      if (mutation) {
        accountMutation = true
      }
      const result = tail.then(async () => {
        if (closed) {
          throw new Error('Toolkit session revoked')
        }
        if (command.operation.startsWith('accounts-login-')) {
          const settings = await readSettings()
          if (command.operation === 'accounts-login-cancel') {
            return login.cancel()
          }
          if (!settings.accounts.enabled) {
            await login.cancel()
            throw new Error('Enable accounts in Host settings first.')
          }
          if (command.operation === 'accounts-login-start') {
            return login.start(settings.accounts.environment)
          }
          if (command.operation === 'accounts-login-submit') {
            await login.poll(settings.accounts.environment)
            return login.submit(command.code)
          }
          if (command.operation === 'accounts-login-copy') {
            await login.poll(settings.accounts.environment)
            return login.copy()
          }
          if (command.operation === 'accounts-login-open') {
            await login.poll(settings.accounts.environment)
            return login.open()
          }
          return login.poll(settings.accounts.environment)
        }
        if (
          mutation &&
          ['starting', 'waiting', 'verifying', 'cancelling'].includes(login.status().phase)
        ) {
          throw new Error('Finish or cancel Claude sign-in before changing accounts.')
        }
        if (command.operation === 'gpu-open') {
          if (!(await readSettings()).gpu.enabled) {
            throw new Error('GPU tools are disabled in settings')
          }
          await shell.openExternal('http://127.0.0.1:18773/')
          return { opened: true }
        }
        if (
          command.operation === 'workbench' &&
          (command.command.action === 'engine-pick' || command.command.action === 'resource-pick')
        ) {
          const request = command.command
          const selection = await dialog.showOpenDialog({
            title:
              request.action === 'engine-pick'
                ? 'Select an existing engine application'
                : 'Copy a resource into the approved project',
            properties: ['openFile'],
            ...(request.action === 'engine-pick'
              ? { filters: [{ name: 'Application', extensions: ['app'] }] }
              : {})
          })
          if (closed) {
            throw new Error('Toolkit session revoked')
          }
          if (selection.canceled || !selection.filePaths[0]) {
            return { cancelled: true }
          }
          return service.call({
            operation: 'workbench',
            command:
              request.action === 'engine-pick'
                ? {
                    action: 'engine-check',
                    engine: request.engine,
                    path: selection.filePaths[0],
                    authorized: true
                  }
                : {
                    action: 'resource-import',
                    engine: request.engine,
                    project_id: request.project_id,
                    path: request.path,
                    source: selection.filePaths[0]
                  }
          })
        }
        if (command.operation === 'workbench' && command.command.action === 'edit') {
          if (process.platform !== 'darwin') {
            throw new Error('TextEdit requires macOS')
          }
          const location = z.object({ path: z.string(), directory: z.literal(false) }).parse(
            await service.call({
              operation: 'workbench',
              command: command.command
            })
          )
          if (closed) {
            throw new Error('Toolkit session revoked')
          }
          const result = await runProcess({
            program: '/usr/bin/open',
            args: ['-g', '-b', 'com.apple.TextEdit', location.path],
            timeoutMs: 10000,
            maxOutputBytes: 4096
          })
          if (result.code !== 0) {
            throw new Error(
              'Could not open TextEdit. Check the local file association or permissions.'
            )
          }
          return { opened: true }
        }
        return service.call(command)
      })
      if (mutation) {
        void result
          .finally(() => {
            accountMutation = false
          })
          .catch(() => undefined)
      }
      tail = result.catch(() => undefined)
      return result
    },
    async close() {
      closed = true
      await login.close()
      service.close()
      browsing.close()
      authority.revoke(context)
    }
  }
}
