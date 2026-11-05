import { randomUUID } from 'node:crypto'
import { z } from 'zod'

export const TOOLKIT_CONFIGURATION_METHOD = 'toolkit.configuration.v1'
export type ConfigurationRequest = { op: string; [key: string]: unknown }
export type ConfigurationReply = { ok: boolean; result?: Record<string, unknown>; error?: string }
export type SocketPair = { hostFd: number; bridgeFd: number }
type ToolkitContext = { instance: string; generation: number }
const envelopeSchema = z.object({ version: z.literal(1), request: z.unknown() }).strict()
type Envelope = { version: number; request: ConfigurationRequest }
type Handler = (
  envelope: Envelope,
  grant: unknown,
  signal: AbortSignal
) => Promise<ConfigurationReply>
export type ToolkitAdapter = {
  validate(request: unknown): ConfigurationRequest
  createHostHandler(
    authorize: (grant: unknown) => boolean,
    options: { createSocketPair: () => SocketPair }
  ): Handler
}
const denied = (): ConfigurationReply => ({
  ok: false,
  error: 'Unauthorized or revoked Toolkit context.'
})
const operations = new Set(['status', 'read', 'patch', 'preview', 'import', 'backup', 'restore'])

export class ToolkitAuthority {
  readonly instance = randomUUID()
  #generation = 0
  #contexts = new Map<unknown, { generation: number; controllers: Set<AbortController> }>()
  #grants = new Map<unknown, () => boolean>()
  #handler: Handler

  constructor(
    private adapter: ToolkitAdapter,
    createSocketPair: () => SocketPair
  ) {
    this.#handler = adapter.createHostHandler((grant) => this.#grants.get(grant)?.() === true, {
      createSocketPair
    })
  }

  openContext(): ToolkitContext {
    const context = Object.freeze({ instance: this.instance, generation: ++this.#generation })
    this.#contexts.set(context, { generation: this.#generation, controllers: new Set() })
    return context
  }

  revoke(context: unknown): void {
    const record = this.#contexts.get(context)
    this.#contexts.delete(context)
    for (const controller of record?.controllers ?? []) {
      controller.abort()
    }
  }

  revokeAll(): void {
    for (const context of this.#contexts.keys()) {
      this.revoke(context)
    }
  }

  async call(
    context: unknown,
    method: string,
    input: unknown,
    approve: (request: ConfigurationRequest) => Promise<boolean>
  ): Promise<ConfigurationReply> {
    const record = this.#contexts.get(context)
    if (
      !record ||
      method !== TOOLKIT_CONFIGURATION_METHOD ||
      this.#grants.size >= 16 ||
      record.controllers.size >= 4
    ) {
      return denied()
    }
    let envelope: Envelope
    try {
      const candidate = envelopeSchema.parse(structuredClone(input))
      envelope = { version: 1, request: this.adapter.validate(candidate.request) }
      if (!operations.has(envelope.request.op)) {
        return denied()
      }
    } catch {
      return denied()
    }
    const controller = new AbortController()
    const grant = Object.freeze({})
    const active = (): boolean =>
      !controller.signal.aborted && this.#contexts.get(context) === record
    record.controllers.add(controller)
    this.#grants.set(grant, active)
    try {
      // Approval receives a copy; no renderer-controlled object can mutate the admitted request.
      if (!(await approve(structuredClone(envelope.request))) || !active()) {
        return denied()
      }
      const reply = await this.#handler(envelope, grant, controller.signal)
      return active()
        ? reply
        : {
            ok: false,
            error: 'Context revoked; result may be unknown. Retry with the same request_id.'
          }
    } catch {
      return {
        ok: false,
        error: 'Configuration unavailable; result may be unknown. Retry with the same request_id.'
      }
    } finally {
      record.controllers.delete(controller)
      this.#grants.delete(grant)
    }
  }
}
