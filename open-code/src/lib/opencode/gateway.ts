import "server-only"
import type { OpencodeClient, Session } from "@opencode-ai/sdk"
import {
	OpenCodeError,
	type OpenCodeErrorKind,
	type OpenCodeEventEnvelope,
	type OpenCodeMessage,
	type OpenCodePath,
	type OpenCodeProject,
	type OpenCodePromptResult,
	type OpenCodeSession,
	type OpenCodeSessionStatus,
	type OpenCodeVcs,
} from "./types"
import { getClient, createClient } from "./client"
import { getServerConfig, type OpenCodeServerConfig } from "./config"
import { mapGlobalEvent, mapMessages, mapProject, mapPromptResult, mapSession, mapSessionStatus, toTextPartInput } from "./mapper"

export interface OpenCodeGatewayOptions {
	client?: OpencodeClient
}

function unwrapError(status: number, body: unknown): OpenCodeError {
	const kind: OpenCodeErrorKind =
		status === 401
			? "unauthorized"
			: status === 404
				? "not-found"
				: status === 400
					? "bad-request"
					: "upstream"
	const message =
		typeof body === "object" &&
			body !== null &&
			"data" in body &&
			typeof (body as { data: { message?: unknown } }).data.message === "string"
			? (body as { data: { message: string } }).data.message
			: `OpenCode server responded with status ${status}`
	return new OpenCodeError(kind, message, status)
}

function asError(error: unknown, status: number | null): OpenCodeError {
	if (error instanceof OpenCodeError) {
		return error
	}
	if (error instanceof Error && error.name === "AbortError") {
		return new OpenCodeError("unreachable", error.message, status)
	}
	const message = error instanceof Error ? error.message : String(error)
	return new OpenCodeError("unreachable", message, status)
}

async function runRequest<T>(call: () => Promise<T>): Promise<T> {
	try {
		return await call()
	} catch (error) {
		if (error instanceof OpenCodeError) {
			throw error
		}
		if (error instanceof Error && error.name === "AbortError") {
			throw asError(error, null)
		}
		if (error instanceof SyntaxError) {
			throw new OpenCodeError("invalid-response", error.message, null)
		}
		throw asError(error, null)
	}
}

function requireData<T>(result: { data: T | undefined; response: { status: number } }): T {
	if (result.data === undefined) {
		throw new OpenCodeError("invalid-response", "Empty response from OpenCode server", result.response.status)
	}
	return result.data
}

export async function health(config: OpenCodeServerConfig = getServerConfig(), client: OpencodeClient = getClient(config)): Promise<{ ok: true; url: string; version?: string }> {
	const result = await runRequest(() => client.config.get())
	if (result.error !== undefined || result.response.status !== 200) {
		throw unwrapError(result.response.status, result.error)
	}
	const body = result.data
	const version =
		typeof body === "object" && body !== null && "version" in body && typeof (body as { version?: unknown }).version === "string"
			? (body as { version: string }).version
			: undefined
	return { ok: true, url: config.url, ...(version !== undefined ? { version } : {}) }
}

export async function listProjects(client: OpencodeClient = getClient()): Promise<OpenCodeProject[]> {
	const result = await runRequest(() => client.project.list())
	if (result.error !== undefined || result.response.status !== 200) {
		throw unwrapError(result.response.status, result.error)
	}
	console.log("OpenCode response diagnostic", {
		isArray: Array.isArray(result.data),
		type: typeof result.data,
		keys:
			result.data && typeof result.data === "object"
				? Object.keys(result.data).slice(0, 10)
				: [],
	})
	return requireArray<Parameters<typeof mapProject>[0]>(
		result.data,
		'project.list',
	).map(mapProject);
}

export async function getCurrentProject(directory: string, client: OpencodeClient = getClient()): Promise<OpenCodeProject> {
	const result = await runRequest(() => client.project.current({ query: { directory } }))
	if (result.error !== undefined || result.response.status !== 200) {
		throw unwrapError(result.response.status, result.error)
	}
	return mapProject(requireData(result))
}

export async function getPath(client: OpencodeClient = getClient()): Promise<OpenCodePath> {
	const result = await runRequest(() => client.path.get())
	if (result.error !== undefined || result.response.status !== 200) {
		throw unwrapError(result.response.status, result.error)
	}
	const data = requireData(result)
	return {
		state: data.state,
		config: data.config,
		worktree: data.worktree,
		directory: data.directory,
	}
}

export async function getVcs(directory: string, client: OpencodeClient = getClient()): Promise<OpenCodeVcs> {
	const result = await runRequest(() => client.vcs.get({ query: { directory } }))
	if (result.error !== undefined || result.response.status !== 200) {
		throw unwrapError(result.response.status, result.error)
	}
	const data = requireData(result)
	return { branch: data.branch }
}

export async function listSessions(directory: string, client: OpencodeClient = getClient()): Promise<OpenCodeSession[]> {
	const result = await runRequest(() => client.session.list({ query: { directory } }))
	if (result.error !== undefined || result.response.status !== 200) {
		throw unwrapError(result.response.status, result.error)
	}
	console.log("OpenCode response diagnostic", {
		isArray: Array.isArray(result.data),
		type: typeof result.data,
		keys:
			result.data && typeof result.data === "object"
				? Object.keys(result.data).slice(0, 10)
				: [],
	})
	return requireArray<Parameters<typeof mapSession>[0]>(
		result.data,
		'session.list'
	).map(mapSession);
}

export async function createSession(directory: string, title?: string, client: OpencodeClient = getClient()): Promise<OpenCodeSession> {
	const result = await runRequest(() =>
		client.session.create({
			query: { directory },
			...(title !== undefined ? { body: { title } } : {}),
		}),
	)
	if (result.error !== undefined || result.response.status !== 200) {
		throw unwrapError(result.response.status, result.error)
	}
	return mapSession(requireData(result))
}

export async function getSession(id: string, directory: string, client: OpencodeClient = getClient()): Promise<OpenCodeSession> {
	const result = await runRequest(() => client.session.get({ path: { id }, query: { directory } }))
	if (result.error !== undefined || result.response.status !== 200) {
		throw unwrapError(result.response.status, result.error)
	}
	return mapSession(requireData(result))
}

export async function deleteSession(id: string, directory: string, client: OpencodeClient = getClient()): Promise<boolean> {
	const result = await runRequest(() => client.session.delete({ path: { id }, query: { directory } }))
	if (result.error !== undefined || result.response.status !== 200) {
		throw unwrapError(result.response.status, result.error)
	}
	return result.data === true
}

export async function getSessionStatus(directory: string, client: OpencodeClient = getClient()): Promise<Record<string, OpenCodeSessionStatus>> {
	const result = await runRequest(() => client.session.status({ query: { directory } }))
	if (result.error !== undefined || result.response.status !== 200) {
		throw unwrapError(result.response.status, result.error)
	}
	return mapSessionStatus(requireData(result))
}

export async function listMessages(id: string, directory: string, limit?: number, client: OpencodeClient = getClient()): Promise<OpenCodeMessage[]> {
	const result = await runRequest(() =>
		client.session.messages({
			path: { id },
			query: { directory, ...(limit !== undefined ? { limit } : {}) },
		}),
	)
	if (result.error !== undefined || result.response.status !== 200) {
		throw unwrapError(result.response.status, result.error)
	}
	return mapMessages(requireData(result))
}

export async function prompt(id: string, directory: string, text: string, client: OpencodeClient = getClient()): Promise<OpenCodePromptResult> {
	const result = await runRequest(() =>
		client.session.prompt({
			path: { id },
			query: { directory },
			body: { parts: [toTextPartInput(text)] },
		}),
	)
	if (result.error !== undefined || result.response.status !== 200) {
		throw unwrapError(result.response.status, result.error)
	}
	return mapPromptResult(requireData(result))
}

export async function promptAsync(id: string, directory: string, text: string, client: OpencodeClient = getClient()): Promise<void> {
	const result = await runRequest(() =>
		client.session.promptAsync({
			path: { id },
			query: { directory },
			body: { parts: [toTextPartInput(text)] },
		}),
	)
	if (result.error !== undefined || (result.response.status !== 204 && result.response.status !== 200)) {
		throw unwrapError(result.response.status, result.error)
	}
}

export async function abort(id: string, directory: string, client: OpencodeClient = getClient()): Promise<boolean> {
	const result = await runRequest(() => client.session.abort({ path: { id }, query: { directory } }))
	if (result.error !== undefined || result.response.status !== 200) {
		throw unwrapError(result.response.status, result.error)
	}
	return result.data === true
}

export async function* subscribeEvents(
	directory: string,
	client: OpencodeClient = getClient(),
	signal?: AbortSignal,
): AsyncGenerator<OpenCodeEventEnvelope> {
	const { stream } = await runRequest(() => client.event.subscribe({ query: { directory }, ...(signal !== undefined ? { signal } : {}) }))
	try {
		for await (const event of stream) {
			yield {
				directory,
				type: event.type,
				payload: event,
				...(event.type === "session.created" || event.type === "session.updated" || event.type === "session.deleted" ? { sessionID: (event as { properties: { info: Session } }).properties.info.id } : {}),
				...("properties" in event && typeof (event.properties as { sessionID?: unknown })?.sessionID === "string" ? { sessionID: (event.properties as { sessionID: string }).sessionID } : {}),
				...("properties" in event && typeof (event.properties as { messageID?: unknown })?.messageID === "string" ? { messageID: (event.properties as { messageID: string }).messageID } : {}),
				...("properties" in event && typeof (event.properties as { partID?: unknown })?.partID === "string" ? { partID: (event.properties as { partID: string }).partID } : {}),
			}
		}
	} catch (error) {
		throw asError(error, null)
	}
}

export async function* subscribeGlobalEvents(client: OpencodeClient = getClient(), signal?: AbortSignal): AsyncGenerator<OpenCodeEventEnvelope> {
	const { stream } = await runRequest(() => client.global.event({ ...(signal !== undefined ? { signal } : {}) }))
	try {
		for await (const event of stream) {
			yield mapGlobalEvent(event)
		}
	} catch (error) {
		throw asError(error, null)
	}
}

function requireArray<T>(
	data: unknown,
	endpoint: string,
): T[] {
	if (!Array.isArray(data)) {
		throw new OpenCodeError(
			"invalid-response",
			`Expected array from ${endpoint}, received ${data === null ? "null" : typeof data
			}`,
			null,
		)
	}

	return data as T[]
}

export { getClient, createClient }
