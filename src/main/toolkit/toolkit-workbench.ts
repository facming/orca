import { z } from 'zod'

const engine = z.enum(['blender', 'godot', 'unity'])
const project = { engine, project_id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/) }
const path = z.string().max(1024)
const id = z.string().regex(/^[a-f0-9]{32}$/)
const args = z.record(z.string(), z.unknown())
export const workbenchCommand = z.discriminatedUnion('action', [
  z
    .object({ action: z.enum(['projects', 'jobs', 'workflows', 'comfy-start', 'comfy-stop']) })
    .strict(),
  z.object({ action: z.enum(['files', 'read', 'edit', 'location']), ...project, path }).strict(),
  z
    .object({
      action: z.literal('submit'),
      ...project,
      task: z.string().min(1).max(64),
      arguments: args,
      request_id: id,
      authorized: z.literal(true)
    })
    .strict(),
  z
    .object({
      action: z.enum(['inspect', 'cancel']),
      engine: z.enum(['blender', 'godot', 'unity', 'comfyui']),
      id
    })
    .strict(),
  z
    .object({
      action: z.literal('stop'),
      engine: z.enum(['godot', 'unity']),
      project_id: project.project_id,
      authorized: z.literal(true)
    })
    .strict(),
  z.object({ action: z.literal('workflow-import'), workflow: args }).strict(),
  z
    .object({
      action: z.literal('workflow-submit'),
      workflow_id: z.string().min(1).max(200),
      parameters: args,
      request_id: id
    })
    .strict()
])
