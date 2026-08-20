import assert from "node:assert/strict"
import test from "node:test"
import { buildOpenCodeWebUrl, encodeOpenCodeDirectory, getOpenCodeWebUrl } from "./web-url"

test("getOpenCodeWebUrl uses the configured coding domain", () => {
  assert.equal(
    getOpenCodeWebUrl({ OPENCODE_WEB_URL: "https://coding.aztech-hub.com/" }),
    "https://coding.aztech-hub.com/",
  )
})

test("encodeOpenCodeDirectory creates a URL-safe directory segment", () => {
  assert.equal(encodeOpenCodeDirectory("/workspaces/acme/widget"), "L3dvcmtzcGFjZXMvYWNtZS93aWRnZXQ")
})

test("buildOpenCodeWebUrl opens a workspace session", () => {
  assert.equal(
    buildOpenCodeWebUrl("/workspaces/acme/widget", "ses_123", {
      OPENCODE_WEB_URL: "https://coding.aztech-hub.com",
    }),
    "https://coding.aztech-hub.com/L3dvcmtzcGFjZXMvYWNtZS93aWRnZXQ/session/ses_123",
  )
})
