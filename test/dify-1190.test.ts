import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenapiClient } from "../src/api/openapi.ts";
import { tools, type ToolCtx } from "../src/tools/registry.ts";
import type { Result } from "../src/core/contract.ts";

const find = (name: string) => tools.find((tool) => tool.name === name)!;
const ctx = (consoleClient: unknown, openapi: unknown): ToolCtx => ({
  cfg: { baseUrl: "https://dify.example", openapiToken: "t", consoleToken: "t", workspaceId: "w" },
  console: consoleClient as ToolCtx["console"],
  openapi: openapi as ToolCtx["openapi"],
});
const success = async (data: unknown = { result: "success" }): Promise<Result<unknown>> => ({ ok: true, data });

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return handler(url, init);
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

test("Dify 1.19 OpenAPI stop and events use run-based routes", async () => {
  const requested: string[] = [];
  const restore = mockFetch(async (url) => {
    requested.push(url);
    if (url.endsWith(":stop")) return Response.json({ result: "success" });
    return new Response('data: {"event":"workflow_finished"}\n\n', {
      headers: { "Content-Type": "text/event-stream" },
    });
  });
  try {
    const client = new OpenapiClient("https://dify.example", "token");
    assert.ok((await client.stopRun("app-1", "run-1")).ok);
    const events = await client.runEvents("app-1", "run-1");
    assert.ok(events.ok);
    if (events.ok) assert.deepEqual(events.data, [{ event: "workflow_finished" }]);
    assert.deepEqual(requested, [
      "https://dify.example/openapi/v1/apps/app-1/runs/run-1:stop",
      "https://dify.example/openapi/v1/apps/app-1/runs/run-1/events",
    ]);
  } finally { restore(); }
});

test("workflow.stop routes run_id to OpenAPI without using the legacy console task route", async () => {
  let stoppedRun = "";
  let stoppedTask = "";
  const openapi = {
    stopRun: async (_appId: string, runId: string) => { stoppedRun = runId; return success(); },
    stopTask: async (_appId: string, taskId: string) => { stoppedTask = taskId; return success(); },
  };
  const consoleClient = {
    stopTask: async (_appId: string, taskId: string) => { stoppedTask = taskId; return success(); },
  };
  assert.ok((await find("workflow.stop").run({ app_id: "a", run_id: "run-1" }, ctx(consoleClient, openapi))).ok);
  assert.equal(stoppedRun, "run-1");
  assert.equal(stoppedTask, "");
  assert.ok((await find("workflow.stop").run({ app_id: "a", task_id: "task-1" }, ctx(consoleClient, openapi))).ok);
  assert.equal(stoppedTask, "task-1");
});

test("workflow.events supports run_id and legacy task_id", async () => {
  const calls: string[] = [];
  const openapi = {
    runEvents: async (_appId: string, runId: string) => { calls.push(`run:${runId}`); return success([]); },
    taskEvents: async (_appId: string, taskId: string) => { calls.push(`task:${taskId}`); return success([]); },
  };
  assert.ok((await find("workflow.events").run({ app_id: "a", run_id: "run-1" }, ctx(null, openapi))).ok);
  assert.ok((await find("workflow.events").run({ app_id: "a", task_id: "task-1" }, ctx(null, openapi))).ok);
  assert.deepEqual(calls, ["run:run-1", "task:task-1"]);
});
