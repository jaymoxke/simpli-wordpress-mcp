import { once } from "node:events";
import type { Server as HttpServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger } from "../src/logger.js";
import { createApp } from "../src/server.js";
import { WordPressClient, type SimpliBackendTool } from "../src/wordpress.js";
import { fakeTools, makeWordPressFetch, testConfig } from "./helpers.js";

const servers: HttpServer[] = [];

const dispatcherTool: SimpliBackendTool = {
  name: "simpli_execute",
  description: "Stable dispatcher for Simpli-owned abilities.",
  inputSchema: {
    type: "object",
    properties: {
      ability_name: { type: "string" },
      input: { type: "object" },
      authority_ref: { type: "string" },
      _confirm: { type: "string" },
    },
    required: ["ability_name", "input"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
};

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function listen(
  tools: SimpliBackendTool[] = fakeTools,
): Promise<{ base: string; token: string; fake: ReturnType<typeof makeWordPressFetch> }> {
  const fake = makeWordPressFetch(tools);
  const logger = createLogger(testConfig);
  const wordpress = new WordPressClient(testConfig, logger, fake.fetch);
  const { app } = createApp(testConfig, logger, wordpress);
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");
  return { base: `http://127.0.0.1:${address.port}`, token: testConfig.staticToken!, fake };
}

async function rpc(base: string, token: string, body: unknown, sessionId?: string): Promise<Response> {
  return fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function readRpcJson<T>(response: Response): Promise<T> {
  const raw = await response.text();
  if (!response.headers.get("content-type")?.includes("text/event-stream")) return JSON.parse(raw) as T;
  const data = raw.split(/\r?\n/).filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim()).filter(Boolean).at(-1);
  if (!data) throw new Error(`SSE response did not contain data: ${raw}`);
  return JSON.parse(data) as T;
}

async function initializedSession(base: string, token: string): Promise<string> {
  const initialized = await rpc(base, token, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "vitest", version: "1.0.0" },
    },
  });
  expect(initialized.status).toBe(200);
  const sessionId = initialized.headers.get("mcp-session-id");
  expect(sessionId).toBeTruthy();
  await rpc(base, token, { jsonrpc: "2.0", method: "notifications/initialized" }, sessionId!);
  return sessionId!;
}

describe("Simpli Railway MCP", () => {
  it("requires bearer authentication", async () => {
    const { base } = await listen();
    const response = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("oauth-protected-resource");
  });

  it("exposes exactly the Simpli backend tools and no Novamira tools", async () => {
    const { base, token } = await listen();
    const sessionId = await initializedSession(base, token);
    const listed = await rpc(base, token, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, sessionId);
    const payload = await readRpcJson<{ result: { tools: Array<{ name: string }> } }>(listed);
    const names = payload.result.tools.map((tool) => tool.name);
    expect(names).toEqual(fakeTools.map((tool) => tool.name));
    expect(names.some((name) => name.toLowerCase().includes("novamira"))).toBe(false);
  });

  it("runs a read-only Simpli tool end to end", async () => {
    const { base, token } = await listen();
    const sessionId = await initializedSession(base, token);
    const called = await rpc(base, token, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "simpli_self_status", arguments: {} },
    }, sessionId);
    const payload = await readRpcJson<{ result: { isError?: boolean; structuredContent?: { version?: string } } }>(called);
    expect(payload.result.isError).not.toBe(true);
    expect(payload.result.structuredContent?.version).toBe("0.2.0");
  });

  it("passes plugin-owned write guards through unchanged", async () => {
    const { base, token, fake } = await listen();
    const sessionId = await initializedSession(base, token);
    const argumentsPayload = {
      file_key: "server",
      expected_sha256: "a".repeat(64),
      old_string: "old",
      new_string: "new",
      authority_ref: "AI-REL-TEST",
      _confirm: "RUN simpli_patch_code_file",
    };
    const called = await rpc(base, token, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "simpli_patch_code_file", arguments: argumentsPayload },
    }, sessionId);
    const payload = await readRpcJson<{ result: { isError?: boolean } }>(called);
    expect(payload.result.isError).not.toBe(true);

    const forwarded = fake.calls.find((call) => call.body?.method === "tools/call" &&
      (call.body.params as { name?: string } | undefined)?.name === "simpli_patch_code_file");
    expect(forwarded?.body).toMatchObject({
      params: { name: "simpli_patch_code_file", arguments: argumentsPayload },
    });
  });

  it("routes the verified stale site-info tool through the governed Simpli dispatcher", async () => {
    const { base, token, fake } = await listen([...fakeTools, dispatcherTool]);
    const sessionId = await initializedSession(base, token);
    const legacyArguments = { fields: ["name", "url", "version"] };
    const called = await rpc(base, token, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "wp__core_get-site-info", arguments: legacyArguments },
    }, sessionId);
    const payload = await readRpcJson<{ result: { isError?: boolean } }>(called);
    expect(payload.result.isError).not.toBe(true);

    const forwarded = fake.calls.find((call) => call.body?.method === "tools/call" &&
      (call.body.params as { name?: string } | undefined)?.name === "simpli_execute");
    expect(forwarded?.body).toMatchObject({
      params: {
        name: "simpli_execute",
        arguments: {
          ability_name: "wordpress/site-info.get",
          input: legacyArguments,
        },
      },
    });
  });

  it("fails closed for stale tools without a verified Simpli v2 equivalent", async () => {
    const { base, token } = await listen([...fakeTools, dispatcherTool]);
    const sessionId = await initializedSession(base, token);
    const called = await rpc(base, token, {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "wp__novamira_execute-php", arguments: { code: "echo 'x';" } },
    }, sessionId);
    const payload = await readRpcJson<{ result: { isError?: boolean; structuredContent?: { status?: number } } }>(called);
    expect(payload.result.isError).toBe(true);
    expect(payload.result.structuredContent?.status).toBe(410);
  });
});
