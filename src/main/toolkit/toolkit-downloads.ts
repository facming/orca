import { app, dialog, type BrowserWindow } from 'electron'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { z } from 'zod'
import { TOOLKIT_CONFIGURATION_METHOD, type ToolkitAuthority } from './toolkit-authority'
import { ToolkitTasks } from './toolkit-tasks'
import { toolkitDownloadLifecycle } from './toolkit-download-lifecycle'

const commandSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('list') }).strict(),
  z.object({ operation: z.literal('choose-folder') }).strict(),
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
  list(): unknown
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
    if (command.operation === 'choose-folder') {
      const result = await dialog.showOpenDialog(panel, {
        properties: ['openDirectory', 'createDirectory']
      })
      return { path: result.filePaths[0] ?? null }
    }
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
    const key = JSON.stringify(target)
    if (!manager || key !== targetKey) {
      await manager?.close()
      const load = createRequire(join(root, 'manifest.json'))
      const engine: Engine = load('./modules/downloads/host-entry.cjs')
      manager = engine.create({
        ...target,
        dataDir: join(app.getPath('home'), 'Library/Application Support/OrcaTools/downloads'),
        runtime: {
          platform: 'darwin',
          cli: join(process.resourcesPath, 'bin/orca'),
          ssh: '/usr/bin/ssh',
          keygen: '/usr/bin/ssh-keygen',
          childEnv: {
            PATH: '/usr/bin:/bin',
            HOME: app.getPath('home'),
            ORCA_USER_DATA_PATH: app.getPath('userData')
          }
        },
        hostTasks: toolkitDownloadLifecycle(tasks)
      })
      targetKey = key
    }
    await manager.ready
    if (command.operation === 'create') {
      if (!settings.downloads.enabled) {
        throw new Error('Downloads are disabled in settings')
      }
      return manager.create(command)
    }
    if (command.operation === 'action') {
      return manager.action(command.id, command.action)
    }
    return { jobs: manager.list(), recovery: manager.recovery ?? [] }
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
      authority.revoke(context)
      return tail.then(() => manager?.close())
    }
  }
}
