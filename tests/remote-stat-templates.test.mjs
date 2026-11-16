// Both background refreshers ask for data/stat-templates.json at the same time;
// they must share ONE download, and a failed download must not be cached.
import { test } from "node:test"
import assert from "node:assert/strict"

import { loadRemoteStatTemplates } from "../lib/poe-zh-core/remote-stat-templates.ts"

const okResponse = (body) => ({ ok: true, status: 200, json: async () => body })

test("concurrent callers share one download", async () => {
  let calls = 0
  const fetcher = async () => {
    calls++
    await new Promise((r) => setTimeout(r, 10))
    return okResponse({ tw: { a: "甲" } })
  }
  const [a, b] = await Promise.all([loadRemoteStatTemplates(fetcher), loadRemoteStatTemplates(fetcher)])
  assert.equal(calls, 1)
  assert.equal(a, b)
  assert.equal(a.tw.a, "甲")
  // a caller arriving shortly after reuses the same result
  assert.equal(await loadRemoteStatTemplates(fetcher), a)
  assert.equal(calls, 1)
})

test("a failure is not kept; the next call retries", async () => {
  // wait out the kept result from the previous test (it is dropped after a while),
  // so this test starts clean by using a fresh module instance
  const mod = await import("../lib/poe-zh-core/remote-stat-templates.ts?fresh=1")
  let calls = 0
  const failing = async () => { calls++; return { ok: false, status: 503, json: async () => ({}) } }
  assert.equal(await mod.loadRemoteStatTemplates(failing), null)
  const throwing = async () => { calls++; throw new Error("offline") }
  assert.equal(await mod.loadRemoteStatTemplates(throwing), null)
  assert.equal(calls, 2)
  const good = await mod.loadRemoteStatTemplates(async () => { calls++; return okResponse({ cn: {} }) })
  assert.deepEqual(good, { cn: {} })
  assert.equal(calls, 3)
})
