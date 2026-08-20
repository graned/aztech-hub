import "server-only"
import { z } from "zod"
import type { OpenCodeEventEnvelope } from "../opencode/types"

const eventEnvelopeSchema = z.object({
  directory: z.string().min(1),
  type: z.string().min(1),
  sessionID: z.string().optional(),
  messageID: z.string().optional(),
  partID: z.string().optional(),
  payload: z.unknown(),
})

export function parseEventEnvelope(raw: unknown): OpenCodeEventEnvelope | null {
  const parsed = eventEnvelopeSchema.safeParse(raw)
  if (!parsed.success) {
    return null
  }
  return parsed.data as OpenCodeEventEnvelope
}

export async function* filterSessionEvents(
  source: Iterable<unknown> | AsyncIterable<unknown>,
  sessionId: string,
): AsyncGenerator<OpenCodeEventEnvelope> {
  for await (const raw of source) {
    const envelope = parseEventEnvelope(raw)
    if (envelope === null) {
      continue
    }
    if (envelope.sessionID !== undefined && envelope.sessionID !== sessionId) {
      continue
    }
    yield envelope
  }
}

export function encodeEventFrame(envelope: OpenCodeEventEnvelope): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(envelope)}\n\n`)
}

export interface EventStreamOptions {
  signal?: AbortSignal
  log?: (message: string) => void
}

const noopLog = () => undefined

export function createEventStreamResponse(
  envelopes: Iterable<OpenCodeEventEnvelope> | AsyncIterable<OpenCodeEventEnvelope>,
  options: EventStreamOptions = {},
): Response {
  const { signal, log = noopLog } = options
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const close = () => {
        if (closed) {
          return
        }
        closed = true
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }
      const onAbort = () => {
        log("client disconnected; closing event stream")
        close()
      }
      signal?.addEventListener("abort", onAbort, { once: true })
      try {
        for await (const envelope of envelopes) {
          try {
            controller.enqueue(encodeEventFrame(envelope))
          } catch {
            break
          }
        }
        log("event source finished")
      } catch (error) {
        if (!closed) {
          log(`event stream error: ${error instanceof Error ? error.message : String(error)}`)
        }
      } finally {
        signal?.removeEventListener("abort", onAbort)
        close()
      }
    },
  })
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  })
}