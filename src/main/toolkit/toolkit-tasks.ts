import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  TOOLKIT_CONFIGURATION_METHOD,
  type ConfigurationRequest,
  type ToolkitAuthority
} from './toolkit-authority'

const targetSchema = z
  .object({
    environment: z.string(),
    sshHost: z.string(),
    sshUser: z.string(),
    sshPort: z.number().int()
  })
  .strict()
const taskSchema = z.object({
  task_id: z.string(),
  owner: z.string(),
  epoch: z.string(),
  revision: z.string(),
  state: z.enum(['created', 'running', 'paused', 'error', 'complete', 'cancelled']),
  released: z.boolean(),
  target: targetSchema
})
type TaskState = z.infer<typeof taskSchema>['state']
type TaskRecord = z.infer<typeof taskSchema>
type TaskHandle = Readonly<{ id: string }>
type OwnedTask = { record: TaskRecord; storeId: string; pending?: ConfigurationRequest }

export class ToolkitTasks {
  #context
  #abort = new AbortController()
  #owner = randomUUID().replaceAll('-', '')
  #tasks = new Map<TaskHandle, OwnedTask>()
  #pendingCreate?: { request: ConfigurationRequest; id: string; storeId: string }
  #tail: Promise<unknown> = Promise.resolve()

  constructor(private authority: ToolkitAuthority) {
    this.#context = authority.openContext(true)
    authority.contextSignal(this.#context).addEventListener(
      'abort',
      () => {
        this.#abort.abort()
        this.#tasks.clear()
      },
      { once: true }
    )
  }

  async #request(request: ConfigurationRequest): Promise<Record<string, unknown>> {
    const reply = await this.authority.call(
      this.#context,
      TOOLKIT_CONFIGURATION_METHOD,
      { version: 1, request },
      async () => true
    )
    if (!reply.ok || !reply.result) {
      throw new Error(reply.error ?? 'Host task result unknown; lease retained')
    }
    return reply.result
  }

  #serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation)
    this.#tail = result.catch(() => undefined)
    return result
  }

  get signal(): AbortSignal {
    return this.#abort.signal
  }

  create(expectedTarget?: z.infer<typeof targetSchema>): Promise<TaskHandle> {
    return this.#serial(async () => {
      if (!this.#pendingCreate) {
        const snapshot = z
          .object({ store_id: z.string(), epoch: z.string(), raw_json: z.string() })
          .parse(await this.#request({ op: 'read', namespace: 'settings' }))
        const settings = z
          .object({ downloads: targetSchema.passthrough() })
          .parse(JSON.parse(snapshot.raw_json))
        const target = targetSchema.parse(
          Object.fromEntries(
            ['environment', 'sshHost', 'sshUser', 'sshPort'].map((key) => [
              key,
              settings.downloads[key]
            ])
          )
        )
        if (
          expectedTarget &&
          JSON.stringify(targetSchema.parse(expectedTarget)) !== JSON.stringify(target)
        ) {
          throw new Error('Download target changed; reload before creating a task')
        }
        const id = randomUUID().replaceAll('-', '')
        const request = {
          op: 'task-create',
          request_id: randomUUID(),
          task_id: id,
          owner: this.#owner,
          epoch: snapshot.epoch,
          store_id: snapshot.store_id,
          target
        }
        this.#pendingCreate = { request, id, storeId: snapshot.store_id }
      }
      const { request, id, storeId } = this.#pendingCreate
      if (
        expectedTarget &&
        JSON.stringify(targetSchema.parse(expectedTarget)) !== JSON.stringify(request.target)
      ) {
        throw new Error('Previous task creation outcome unknown; reconcile before changing target')
      }
      const record = taskSchema.parse(await this.#request(request))
      const handle = Object.freeze({ id })
      this.#tasks.set(handle, { record, storeId })
      this.#pendingCreate = undefined
      return handle
    })
  }

  update(handle: TaskHandle, state: TaskState, released = false): Promise<void> {
    return this.#serial(async () => {
      const task = this.#tasks.get(handle)
      if (!task) {
        throw new Error('Unknown Host task owner')
      }
      if (task.pending) {
        task.record = taskSchema.parse(await this.#request(task.pending))
        task.pending = undefined
      }
      if (task.record.state === state && task.record.released === released) {
        return
      }
      task.pending = {
        op: 'task-update',
        request_id: randomUUID(),
        task_id: handle.id,
        owner: this.#owner,
        epoch: task.record.epoch,
        store_id: task.storeId,
        revision: task.record.revision,
        state,
        released
      }
      task.record = taskSchema.parse(await this.#request(task.pending))
      task.pending = undefined
    })
  }

  revoke(): void {
    this.#abort.abort()
    this.authority.revoke(this.#context)
    this.#tasks.clear()
  }
}
