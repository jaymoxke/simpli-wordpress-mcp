import { once } from "node:events";
import type { Server as HttpServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger } from "../src/logger.js";
import { abilityToMcpTool } from "../src/mcp.js";
import { createApp } from "../src/server.js";
import { WordPressClient } from "../src/wordpress.js";
import { fakeAbilities, makeWordPressFetch, testConfig } from "./helpers.js";

const servers: HttpServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function listen(): Promise<{ base: string; token: string }> {
  const fake = makeWordPressFetch();
  const logger = createLogger(testConfig);
  const wordpress = new WordPressClient(testConfig, logger, fake.fetch);
  const { app } = createApp(testConfig, logger, wordpress);
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");
  return { base: `http://127.0.0.1:${address.port}`, token: testConfig.staticToken! };
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
  const data = raw
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean)
    .at(-1);
  if (!data) throw new Error(`SSE response did not contain data: ${raw}`);
  return JSON.parse(data) as T;
}

describe("MCP gateway", () => {
  it("preserves destructive annotations and adds an exact confirmation gate", () => {
    const ability = fakeAbilities.find((item) => item.name === "novamira/delete-file")!;
    const tool = abilityToMcpTool(ability);
    expect(tool.annotations?.destructiveHint).toBe(true);
    expect(tool.annotations?.readOnlyHint).toBe(false);
    expect(tool.inputSchema.required).toContain("_confirm");
    expect(tool.inputSchema.properties?._confirm).toMatchObject({ const: "RUN novamira/delete-file" });
  });

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

  it("initializes, lists mirrored abilities, and runs a read-only tool", async () => {
    const { base, token } = await listen();
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

    const notification = await rpc(base, token, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }, sessionId!);
    expect([200, 202]).toContain(notification.status);

    const listed = await rpc(base, token, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, sessionId!);
    const listPayload = await readRpcJson<{ result: { tools: Array<{ name: string }> } }>(listed);
    expect(listPayload.result.tools.map((tool) => tool.name)).toContain("wp__novamira_read-file");

    const called = await rpc(base, token, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "wp__novamira_read-file", arguments: { path: "wp-content/test.txt" } },
    }, sessionId!);
    const callPayload = await readRpcJson<{ result: { isError?: boolean; structuredContent?: { result?: { ok?: boolean } } } }>(called);
    expect(callPayload.result.isError).not.toBe(true);
    expect(callPayload.result.structuredContent?.result?.ok).toBe(true);
  });
});
