import type { ToolkitTasks } from './toolkit-tasks'

type Handle = Awaited<ReturnType<ToolkitTasks['create']>>
type State = Parameters<ToolkitTasks['update']>[1]

// Inject only into a sealed engine owned by main, never a plugin host API.
export function toolkitDownloadLifecycle(tasks: ToolkitTasks) {
  const handles = new Map<string, Handle>()
  return {
    signal: tasks.signal,
    async create(target: Parameters<ToolkitTasks['create']>[0]): Promise<string> {
      const handle = await tasks.create(target)
      handles.set(handle.id, handle)
      return handle.id
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
