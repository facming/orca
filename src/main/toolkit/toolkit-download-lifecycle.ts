import type { ToolkitTasks } from './toolkit-tasks'

type Handle = Awaited<ReturnType<ToolkitTasks['create']>>
type State = Parameters<ToolkitTasks['update']>[1]
type Target = NonNullable<Parameters<ToolkitTasks['create']>[0]>
type SavedTask = { id: string; protocol?: number; hostIntent?: boolean }

// Inject only into a sealed engine owned by main, never a plugin host API.
export function toolkitDownloadLifecycle(tasks: ToolkitTasks) {
  const handles = new Map<string, Handle>()
  return {
    signal: tasks.signal,
    async create(target: Target, id?: string): Promise<string> {
      const handle = await tasks.create(target, id)
      handles.set(handle.id, handle)
      return handle.id
    },
    async reconcile(jobs: SavedTask[], target: Target) {
      const inventory = await tasks.inventory()
      const results: { id: string; state: string; released: boolean; reason?: string }[] = []
      for (const job of jobs) {
        const record = inventory.task_inventory.tasks.find((task) => task.task_id === job.id)
        const lease = inventory.target_leases.find((task) => task.task_id === job.id)
        try {
          if (job.protocol !== 3) {
            throw new Error('Legacy authorization requires offline review')
          }
          if (record) {
            if (
              record.epoch !== inventory.epoch ||
              JSON.stringify(record.target) !== JSON.stringify(target)
            ) {
              throw new Error('Historical task belongs to another configuration epoch or target')
            }
            handles.set(job.id, await tasks.claim(record, inventory.store_id))
            results.push({
              id: job.id,
              state: ['created', 'running'].includes(record.state) ? 'paused' : record.state,
              released: record.released
            })
          } else if (lease && JSON.stringify(lease.target) === JSON.stringify(target)) {
            handles.set(
              job.id,
              await tasks.adopt(job.id, target, inventory.store_id, inventory.epoch)
            )
            results.push({ id: job.id, state: 'paused', released: false })
          } else if (job.hostIntent && !lease) {
            handles.set(job.id, await tasks.create(target, job.id))
            results.push({ id: job.id, state: 'created', released: false })
          } else {
            throw new Error('No durable Host task or verified legacy lease')
          }
        } catch (error) {
          results.push({
            id: job.id,
            state: 'review',
            released: false,
            reason: error instanceof Error ? error.message : 'Reconciliation failed'
          })
        }
      }
      for (const record of inventory.task_inventory.tasks) {
        if (!jobs.some((job) => job.id === record.task_id) && !record.released) {
          results.push({
            id: record.task_id,
            state: 'orphan',
            released: false,
            reason: 'Host task has no local file; lease retained for offline review'
          })
        }
      }
      return results
    },
    async transition(id: string, state: State, released = false): Promise<void> {
      const handle = handles.get(id)
      if (!handle) {
        throw new Error('Legacy or unknown download requires Host reconciliation')
      }
      await tasks.update(handle, state, released)
    }
  }
}
