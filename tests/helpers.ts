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
  const fakeFetch = async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    calls.push({ url, ...(init ? { init } : {}), ...(body ? { body } : {}) });

    if (url.pathname !== "/wp-json/simpli-mcp/v1/mcp" || init?.method !== "POST" || !body) {
      return new Response(JSON.stringify({ code: "not_found", message: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const id = body.id ?? null;
    if (body.method === "tools/list") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: { tools } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (body.method === "tools/call") {
      const params = body.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
      if (params?.name === "simpli_self_status") {
        return new Response(JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: {
            structuredContent: { state: "STATE_VERIFIED", version: "0.2.0" },
            content: [{ type: "text", text: "status" }],
            isError: false,
          },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id,
        result: {
          structuredContent: { ok: true, tool: params?.name, arguments: params?.arguments ?? {} },
          content: [{ type: "text", text: "ok" }],
          isError: false,
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetch: fakeFetch as typeof fetch, calls };
}
