import type { AppConfig } from "../src/config.js";
import type { Logger } from "../src/logger.js";
import type { WordPressAbility } from "../src/wordpress.js";

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

export const fakeAbilities: WordPressAbility[] = [
  {
    name: "core/get-site-info",
    label: "Get Site Information",
    category: "site",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    meta: { annotations: { readonly: true, destructive: false, idempotent: true } },
  },
  {
    name: "novamira/read-file",
    label: "Read File",
    description: "Read a WordPress file.",
    category: "novamira",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
    meta: { annotations: { readonly: true, destructive: false, idempotent: true } },
  },
  {
    name: "novamira/write-file",
    label: "Write File",
    description: "Write a WordPress file.",
    category: "novamira",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
      additionalProperties: false,
    },
    meta: { annotations: { readonly: false, destructive: false, idempotent: true } },
  },
  {
    name: "novamira/delete-file",
    label: "Delete File",
    description: "Delete a WordPress file.",
    category: "novamira",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
    meta: { annotations: { readonly: false, destructive: true, idempotent: true } },
  },
];

export interface FetchCall {
  url: URL;
  init?: RequestInit;
}

export function makeWordPressFetch(abilities: WordPressAbility[] = fakeAbilities): {
  fetch: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fakeFetch = async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url);
    calls.push({ url, ...(init ? { init } : {}) });
    if (url.pathname === "/wp-json/wp-abilities/v1/abilities") {
      return new Response(JSON.stringify(abilities), {
        status: 200,
        headers: { "Content-Type": "application/json", "X-WP-TotalPages": "1" },
      });
    }
    if (url.pathname.endsWith("/core/get-site-info/run")) {
      return new Response(JSON.stringify({ name: "Test WordPress", version: "7.0.3" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.pathname.endsWith("/run")) {
      return new Response(
        JSON.stringify({ ok: true, method: init?.method ?? "GET", input: url.searchParams.get("input") ?? init?.body ?? null }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ code: "not_found", message: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetch: fakeFetch as typeof fetch, calls };
}
