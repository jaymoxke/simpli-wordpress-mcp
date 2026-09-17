import { once } from "node:events";
import type { Server as HttpServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger } from "../src/logger.js";
import { createApp } from "../src/server.js";
import { WordPressClient, type SimpliBackendTool } from "../src/wordpress.js";
import { fakeTools, makeWordPressFetch, testConfig } from "./helpers.js";

const servers: HttpServer[] = [];
const MODERN_REVISION = "2026-07-28";
const MODERN_ENVELOPE = {
  "io.modelcontextprotocol/protocolVersion": MODERN_REVISION,
  "io.modelcontextprotocol/clientInfo": { name: "simpli-vitest", version: "1.0.0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

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
): Promise<{ base: string; token: string; whatsappToken: string; fake: ReturnType<typeof makeWordPressFetch> }> {
  const fake = makeWordPressFetch(tools);
  const logger = createLogger(testConfig);
  const wordpress = new WordPressClient(testConfig, logger, fake.fetch);
  const { app } = createApp(testConfig, logger, wordpress);
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");
  return {
    base: `http://127.0.0.1:${address.port}`,
    token: testConfig.staticToken!,
    whatsappToken: testConfig.whatsappMcpToken!,
    fake,
  };
}

async function rpc(base: string, token: string, body: unknown): Promise<Response> {
  return fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function modernRpc(
  base: string,
  token: string,
  id: number,
  method: string,
  params: Record<string, unknown> = {},
): Promise<Response> {
  return fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "Mcp-Protocol-Version": MODERN_REVISION,
      "Mcp-Method": method,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: { ...params, _meta: MODERN_ENVELOPE },
    }),
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

describe("Simpli MCP v3 protocol gateway", () => {
  it("requires bearer authentication", async () => {
    const { base } = await listen();
    const response = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("oauth-protected-resource");
  });

  it("serves the 2026-07-28 discovery probe and stamps Simpli server identity", async () => {
    const { base, token } = await listen();
    const discovered = await modernRpc(base, token, 10, "server/discover");
    expect(discovered.status).toBe(200);
    expect(discovered.headers.get("mcp-session-id")).toBeNull();
    const payload = await readRpcJson<{
      result: {
        supportedVersions: string[];
        _meta?: Record<string, { name?: string; version?: string }>;
      };
    }>(discovered);
    expect(payload.result.supportedVersions).toContain(MODERN_REVISION);
    expect(payload.result._meta?.["io.modelcontextprotocol/serverInfo"]?.name).toBe("simpli-mcp");
  });

  it("serves 2026-07-28 tools/list with the per-request envelope", async () => {
    const { base, token } = await listen();
    const listed = await modernRpc(base, token, 11, "tools/list");
    expect(listed.status).toBe(200);
    expect(listed.headers.get("mcp-session-id")).toBeNull();
    const payload = await readRpcJson<{ result: { tools: Array<{ name: string }> } }>(listed);
    expect(payload.result.tools.map((tool) => tool.name)).toEqual(fakeTools.map((tool) => tool.name));
  });

  it("serves stateless legacy tools/list without an MCP session id", async () => {
    const { base, token } = await listen();
    const listed = await rpc(base, token, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    expect(listed.status).toBe(200);
    expect(listed.headers.get("mcp-session-id")).toBeNull();
    const payload = await readRpcJson<{ result: { tools: Array<{ name: string }> } }>(listed);
    const names = payload.result.tools.map((tool) => tool.name);
    expect(names).toEqual(fakeTools.map((tool) => tool.name));
    expect(names.some((name) => name.toLowerCase().includes("novamira"))).toBe(false);
  });

  it("restricts the dedicated WhatsApp credential to simpli_whatsapp_read", async () => {
    const { base, whatsappToken, fake } = await listen();

    const listed = await rpc(
      base,
      whatsappToken,
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    );
    const listPayload = await readRpcJson<{ result: { tools: Array<{ name: string }> } }>(listed);
    expect(listPayload.result.tools.map((tool) => tool.name)).toEqual(["simpli_whatsapp_read"]);

    const allowed = await rpc(base, whatsappToken, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "simpli_whatsapp_read",
        arguments: { operation: "PRODUCT_SEARCH", query: "sunscreen", limit: 3 },
      },
    });
    const allowedPayload = await readRpcJson<{ result: { isError?: boolean } }>(allowed);
    expect(allowedPayload.result.isError).not.toBe(true);

    const blocked = await rpc(base, whatsappToken, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "simpli_self_status", arguments: {} },
    });
    const blockedPayload = await readRpcJson<{
      result: { isError?: boolean; structuredContent?: { status?: number; error?: string } };
    }>(blocked);
    expect(blockedPayload.result.isError).toBe(true);
    expect(blockedPayload.result.structuredContent?.status).toBe(403);
    expect(blockedPayload.result.structuredContent?.error).toMatch(/restricted/i);

    const forbiddenForward = fake.calls.find((call) =>
      call.body?.method === "tools/call" &&
      (call.body.params as { name?: string } | undefined)?.name === "simpli_self_status"
    );
    expect(forbiddenForward).toBeUndefined();
  });

  it("runs a read-only Simpli tool end to end without server-side MCP session state", async () => {
    const { base, token } = await listen();
    const called = await rpc(base, token, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "simpli_self_status", arguments: {} },
    });
    const payload = await readRpcJson<{ result: { isError?: boolean; structuredContent?: { version?: string } } }>(called);
    expect(payload.result.isError).not.toBe(true);
    expect(payload.result.structuredContent?.version).toBe("0.2.0");
  });

  it("passes plugin-owned write guards through unchanged", async () => {
    const { base, token, fake } = await listen();
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
    });
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
    const legacyArguments = { fields: ["name", "url", "version"] };
    const called = await rpc(base, token, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "wp__core_get-site-info", arguments: legacyArguments },
    });
    const payload = await readRpcJson<{ result: { isError?: boolean } }>(called);
    expect(payload.result.isError).not.toBe(true);

    const forwarded = fake.calls.find((call) => call.body?.method === "tools/call" &&
      (call.body.params as { name?: string } | undefined)?.name === "simpli_execute");
    expect(forwarded?.body).toMatchObject({
      params: {
        name: "simpli_execute",
        arguments: {
          ability_name: "wordpress/site-info.get",
          input: {},
        },
      },
    });
  });

  it("fails closed for stale tools without a verified Simpli equivalent", async () => {
    const { base, token } = await listen([...fakeTools, dispatcherTool]);
    const called = await rpc(base, token, {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "wp__novamira_execute-php", arguments: { code: "echo 'x';" } },
    });
    const payload = await readRpcJson<{ result: { isError?: boolean; structuredContent?: { status?: number } } }>(called);
    expect(payload.result.isError).toBe(true);
    expect(payload.result.structuredContent?.status).toBe(410);
  });
});
