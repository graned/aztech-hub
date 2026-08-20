import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  createEventStreamResponse,
  encodeEventFrame,
  filterSessionEvents,
  parseEventEnvelope,
} from "../api/eventRelay"
import type { OpenCodeEventEnvelope } from "../opencode/types"

const SESSION_ID = "ses-abc123"

function envelope(overrides: Partial<OpenCodeEventEnvelope> = {}): OpenCodeEventEnvelope {
  return {
    directory: "/workspaces/octocat/Hello-World",
    type: "message.updated",
    sessionID: SESSION_ID,
    payload: {},
    ...overrides,
  }
}

describe("parseEventEnvelope", () => {
  it("parses a well-formed envelope", () => {
    const raw = envelope()
    const parsed = parseEventEnvelope(raw)
    assert.deepEqual(parsed, raw)
  })

  it("parses an envelope without a session id", () => {
    const parsed = parseEventEnvelope({
      directory: "/workspaces/octocat/Hello-World",
      type: "server.connected",
      payload: {},
    })
    assert.ok(parsed !== null)
    assert.equal(parsed?.sessionID, undefined)
  })

  it("returns null for malformed envelopes", () => {
    assert.equal(parseEventEnvelope(null), null)
    assert.equal(parseEventEnvelope(undefined), null)
    assert.equal(parseEventEnvelope("nope"), null)
    assert.equal(parseEventEnvelope({ type: "message.updated" }), null)
    assert.equal(parseEventEnvelope({ directory: "", type: "message.updated", payload: {} }), null)
  })
})

describe("filterSessionEvents", () => {
  it("passes events for the requested session", async () => {
    const source = [envelope()]
    const collected: OpenCodeEventEnvelope[] = []
    for await (const item of filterSessionEvents(source, SESSION_ID)) {
      collected.push(item)
    }
    assert.equal(collected.length, 1)
  })

  it("drops events for other sessions", async () => {
    const withoutSessionID: OpenCodeEventEnvelope = { ...envelope() }
    delete withoutSessionID.sessionID
    const source = [envelope({ sessionID: "ses-other" }), envelope(), withoutSessionID]
    const collected: OpenCodeEventEnvelope[] = []
    for await (const item of filterSessionEvents(source, SESSION_ID)) {
      collected.push(item)
    }
    assert.equal(collected.length, 2)
  })

  it("drops malformed envelopes", async () => {
    const source = [null, envelope(), { type: "nope" }]
    const collected: OpenCodeEventEnvelope[] = []
    for await (const item of filterSessionEvents(source, SESSION_ID)) {
      collected.push(item)
    }
    assert.equal(collected.length, 1)
  })
})

describe("encodeEventFrame", () => {
  it("produces a data-prefixed sse frame", () => {
    const frame = encodeEventFrame(envelope())
    const text = new TextDecoder().decode(frame)
    assert.ok(text.startsWith("data: "))
    assert.ok(text.endsWith("\n\n"))
    assert.match(text, /"sessionID":"ses-abc123"/)
  })
})

describe("createEventStreamResponse", () => {
  it("streams framed events and closes when the source finishes", async () => {
    const envelopes = [envelope(), envelope({ type: "session.idle" })]
    const logs: string[] = []
    const response = createEventStreamResponse(envelopes, { log: (message) => logs.push(message) })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8")
    assert.equal(response.headers.get("cache-control"), "no-cache, no-transform")
    const body = await response.text()
    assert.equal((body.match(/data: /g) ?? []).length, 2)
    assert.match(body, /session\.idle/)
    assert.ok(logs.some((entry) => entry === "event source finished"))
  })

  it("closes the stream when the abort signal fires", async () => {
    const controller = new AbortController()
    const response = createEventStreamResponse(
      (async function* () {
        yield envelope()
        await new Promise((resolve) => setTimeout(resolve, 50))
        yield envelope({ type: "session.idle" })
      })(),
      { signal: controller.signal },
    )
    const bodyPromise = response.text()
    setTimeout(() => controller.abort(), 10)
    const body = await bodyPromise
    assert.equal((body.match(/data: /g) ?? []).length, 1)
  })
})