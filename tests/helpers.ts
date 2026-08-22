import type { AppConfig } from "../src/config.js";
import type { Logger } from "../src/logger.js";
import type { SimpliBackendTool } from "../src/wordpress.js";

export const testConfig: AppConfig = {
  port: 3000,
  publicBaseUrl: "https://mcp.example.test",
  resourceUrl: "https://mcp.example.test/mcp",
  wordpressUrl: "https://wordpress.example.test",
  wordpressUsername: "gateway",
  wordpressAppPassword: "abcd efgh ijkl mnop qrst uvwx",
  oauthSigningSecret: "o".repeat(64),
  oauthAdminPassword: "correct horse battery staple",
  staticToken: "s".repeat(48),
  browserQaTimeoutMs: 65_000,
  abilityCacheTtlMs: 300_000,
  wordpressTimeoutMs: 10_000,
  maxToolOutputBytes: 262_144,
  accessTokenTtlSeconds: 3600,
  refreshTokenTtlSeconds: 2_592_000,
  logLevel: "error",
};

export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export const fakeTools: SimpliBackendTool[] = [
  {
    name: "simpli_self_status",
    title: "Simpli MCP Self Status",
    description: "Read Simpli MCP status.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "simpli_get_code_file",
    title: "Get Simpli MCP Code File",
    description: "Read an allowlisted Simpli MCP file.",
    inputSchema: {
      type: "object",
      properties: { file_key: { type: "string" } },
      required: ["file_key"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "simpli_patch_code_file",
    title: "Patch Simpli MCP Code File",
    description: "Patch an allowlisted Simpli MCP file with governed controls.",
    inputSchema: {
      type: "object",
      properties: {
        file_key: { type: "string" },
        expected_sha256: { type: "string" },
        old_string: { type: "string" },
        new_string: { type: "string" },
        authority_ref: { type: "string" },
        _confirm: { type: "string", const: "RUN simpli_patch_code_file" },
      },
      required: ["file_key", "expected_sha256", "old_string", "new_string", "authority_ref", "_confirm"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
];

export interface FetchCall {
  url: URL;
  init?: RequestInit;
  body?: Record<string, unknown>;
}

export function makeWordPressFetch(tools: SimpliBackendTool[] = fakeTools): {
  fetch: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    calls.push({ url, ...(init ? { init } : {}), ...(body ? { body } : {}) });

    const method = body?.method;
    if (method === "tools/list") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body?.id ?? "1", result: { tools } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (method === "tools/call") {
      const params = body?.params as Record<string, unknown> | undefined;
      const name = params?.name;
      let structuredContent: Record<string, unknown> = { ok: true, tool: name };
      if (name === "simpli_self_status") {
        structuredContent = { version: "test", status: "ok" };
      }
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: body?.id ?? "1",
        result: { structuredContent, isError: false },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body?.id ?? "1", error: { code: -32601, message: "not found" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fetchImpl, calls };
}
