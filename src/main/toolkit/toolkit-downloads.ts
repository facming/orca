import { app, dialog, shell, type BrowserWindow } from 'electron'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { z } from 'zod'
import { TOOLKIT_CONFIGURATION_METHOD, type ToolkitAuthority } from './toolkit-authority'
import { createToolkitDownloadBrowser } from './toolkit-download-browser'
import { ToolkitTasks } from './toolkit-tasks'
import { toolkitDownloadLifecycle } from './toolkit-download-lifecycle'

const commandSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('list') }).strict(),
  z.object({ operation: z.literal('reconcile') }).strict(),
  z.object({ operation: z.literal('choose-folder') }).strict(),
  z
    .object({
      operation: z.literal('browse-remote'),
      directory: z.string().max(4096).optional(),
      showHidden: z.boolean().optional(),
      query: z.string().max(200).optional(),
      offset: z.number().int().min(0).max(1000000).optional()
    })
    .strict(),
  z
    .object({ operation: z.literal('open-folder'), id: z.string().regex(/^[a-f0-9]{32}$/) })
    .strict(),
  z
    .object({
      operation: z.literal('create'),
      requestId: z.string().uuid(),
      source: z.string().max(4096),
      folder: z.string().max(4096),
      concurrency: z.number().int().min(1).max(16)
    })
    .strict(),
  z
    .object({
      operation: z.literal('action'),
      id: z.string().regex(/^[a-f0-9]{32}$/),
      action: z.enum(['pause', 'resume', 'cancel', 'cleanup'])
    })
    .strict()
])
const targetSchema = z.object({
  environment: z.string(),
  sshHost: z.string(),
  sshUser: z.string(),
  sshPort: z.number().int()
})
type Manager = {
  ready: Promise<void>
  recovery?: unknown
  list(): { id: string; destination: string; status: string }[]
  create(input: {
    source: string
    folder: string
    concurrency: number
    requestId: string
  }): Promise<unknown>
  action(id: string, action: string): Promise<unknown>
  close(): Promise<void>
}
type Engine = {
  create(options: {
    dataDir: string
    environment: string
    sshHost: string
    sshUser: string
    sshPort: number
    runtime: {
      platform: string
      cli: string
      ssh: string
      keygen: string
      childEnv: Record<string, string>
    }
    hostTasks: ReturnType<typeof toolkitDownloadLifecycle>
  }): Manager
}

export function createToolkitDownloads(
  authority: ToolkitAuthority,
  root: string,
  panel: BrowserWindow
) {
  const tasks = new ToolkitTasks(authority)
  const browsing = createToolkitDownloadBrowser(authority, root)
  const context = authority.openContext(true)
  let manager: Manager | undefined
  let targetKey = ''
  let tail: Promise<unknown> = Promise.resolve()
  let closed = false
  const perform = async (input: unknown) => {
    if (closed || tasks.signal.aborted) {
      throw new Error('Download session revoked')
    }
    const command = commandSchema.parse(input)
    const reply = await authority.call(
      context,
      TOOLKIT_CONFIGURATION_METHOD,
      { version: 1, request: { op: 'read', namespace: 'settings' } },
      async () => true
    )
    if (!reply.ok || typeof reply.result?.raw_json !== 'string') {
      throw new Error(reply.error ?? 'Read settings before downloading')
    }
    const settings = z
      .object({ downloads: targetSchema.extend({ enabled: z.boolean() }) })
      .parse(JSON.parse(reply.result.raw_json))
    const target = targetSchema.parse(settings.downloads)
    if (command.operation === 'choose-folder') {
      const defaults = await browsing.browser.snapshot(target.environment)
      const result = await dialog.showOpenDialog(panel, {
        defaultPath: defaults.defaultFolder,
        properties: ['openDirectory', 'createDirectory']
      })
      const folder = result.canceled ? undefined : result.filePaths[0]
      if (folder) {
        try {
          await browsing.browser.remember(target.environment, { folder })
        } catch {
          return {
            path: folder,
            warning: 'Folder selected; saving the default failed. Retry by creating the download.'
          }
        }
      }
      return { path: folder ?? null }
    }
    if (command.operation === 'browse-remote') {
      const { operation: _operation, ...options } = command
      return browsing.browser.browse(target.environment, options)
    }
    if (command.operation === 'reconcile' && manager) {
      if (
        manager.list().some((job) => ['preparing', 'downloading', 'verifying'].includes(job.status))
      ) {
        throw new Error('Pause active downloads before retrying recovery')
      }
      await manager.close()
      manager = undefined
    }
    const key = JSON.stringify(target)
    if (!manager || key !== targetKey) {
      await manager?.close()
      const load = createRequire(join(root, 'manifest.json'))
      const engine: Engine = load('./modules/downloads/host-entry.cjs')
      manager = engine.create({
        ...target,
        dataDir: join(app.getPath('home'), 'Library/Application Support/OrcaTools/downloads'),
        runtime: browsing.runtime,
        hostTasks: toolkitDownloadLifecycle(tasks)
      })
      targetKey = key
    }
    try {
      await manager.ready
    } catch (error) {
      await manager.close()
      manager = undefined
      throw error
    }
    if (command.operation === 'create') {
      if (!settings.downloads.enabled) {
        throw new Error('Downloads are disabled in settings')
      }
      const job = await manager.create(command)
      try {
        await browsing.browser.remember(target.environment, command)
      } catch {
        return { job, warning: 'Download created; preferences could not be saved.' }
      }
      return { job }
    }
    if (command.operation === 'open-folder') {
      const job = manager.list().find((item) => item.id === command.id)
      if (!job) {
        throw new Error('Download not found')
      }
      shell.showItemInFolder(job.destination)
      return { opened: true }
    }
    if (command.operation === 'action') {
      return manager.action(command.id, command.action)
    }
    return {
      jobs: manager.list(),
      recovery: manager.recovery ?? [],
      enabled: settings.downloads.enabled,
      ...(await browsing.browser.snapshot(target.environment))
    }
  }
  return {
    call(input: unknown) {
      const result = tail.then(() => perform(input))
      tail = result.catch(() => undefined)
      return result
    },
    close() {
      closed = true
      tasks.revoke()
      browsing.close()
      authority.revoke(context)
      return tail.then(() => manager?.close())
    }
  }
}
