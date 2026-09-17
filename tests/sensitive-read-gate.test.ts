import { once } from "node:events";
import type { Server as HttpServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { sha256Base64Url } from "../src/crypto.js";
import { createLogger } from "../src/logger.js";
import { createApp } from "../src/server.js";
import { WordPressClient, type SimpliBackendTool } from "../src/wordpress.js";
import { fakeTools, makeWordPressFetch, testConfig } from "./helpers.js";

const servers: HttpServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

const describeTool: SimpliBackendTool = {
  name: "simpli_describe",
  title: "Describe Simpli Ability",
  description: "Return exact authority metadata for one admitted ability.",
  inputSchema: {
    type: "object",
    properties: { ability_name: { type: "string" } },
    required: ["ability_name"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

const readDispatcherTool: SimpliBackendTool = {
  name: "simpli_execute",
  title: "Execute First-Party Simpli Read",
  description: "Read-only dispatcher whose nested A1/A2 authority class is checked before execution.",
  inputSchema: {
    type: "object",
    properties: {
      ability_name: { type: "string" },
      input: { type: "object" },
    },
    required: ["ability_name", "input"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

async function listen(): Promise<{
  base: string;
  fake: ReturnType<typeof makeWordPressFetch>;
}> {
  const fake = makeWordPressFetch([...fakeTools, describeTool, readDispatcherTool]);
  const logger = createLogger(testConfig);
  const wordpress = new WordPressClient(testConfig, logger, fake.fetch);
  const { app } = createApp(testConfig, logger, wordpress);
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");
  return { base: `http://127.0.0.1:${address.port}`, fake };
}

async function ownerToken(base: string, scope: string): Promise<string> {
  const redirectUri = "https://chatgpt.com/connector/oauth/sensitive-test";
  const registration = await fetch(`${base}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "Sensitive read test", redirect_uris: [redirectUri] }),
  });
  expect(registration.status).toBe(201);
  const client = await registration.json() as { client_id: string };
  const verifier = "s".repeat(64);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: redirectUri,
    code_challenge: sha256Base64Url(verifier),
    code_challenge_method: "S256",
    resource: testConfig.resourceUrl,
    scope,
    admin_password: testConfig.oauthAdminPassword!,
  });
  const authorization = await fetch(`${base}/oauth/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
    redirect: "manual",
  });
  expect(authorization.status).toBe(303);
  const code = new URL(authorization.headers.get("location")!).searchParams.get("code");
  expect(code).toBeTruthy();

  const token = await fetch(`${base}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code!,
      client_id: client.client_id,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      resource: testConfig.resourceUrl,
    }),
  });
  expect(token.status).toBe(200);
  return (await token.json() as { access_token: string }).access_token;
}

async function callDispatcher(
  base: string,
  token: string,
  abilityName: string,
  input: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<Record<string, any>> {
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 71,
      method: "tools/call",
      params: {
        name: "simpli_execute",
        arguments: { ability_name: abilityName, input, ...extra },
      },
    }),
  });
  expect(response.status).toBe(200);
  const raw = await response.text();
  const data = response.headers.get("content-type")?.includes("text/event-stream")
    ? raw.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).filter(Boolean).at(-1)
    : raw;
  if (!data) throw new Error("Missing MCP response data");
  return JSON.parse(data) as Record<string, any>;
}

function forwardedToolCalls(fake: ReturnType<typeof makeWordPressFetch>, name: string): number {
  return fake.calls.filter((call) => {
    if (call.body?.method !== "tools/call") return false;
    const params = call.body.params as { name?: string } | undefined;
    return params?.name === name;
  }).length;
}

describe("A2 sensitive-read scope gate", () => {
  it("allows A1 through ordinary wordpress:read", async () => {
    const { base, fake } = await listen();
    const token = await ownerToken(base, "wordpress:read");
    const payload = await callDispatcher(base, token, "woocommerce/product.get", { id: 123 });
    expect(payload.result?.isError).not.toBe(true);
    expect(forwardedToolCalls(fake, "simpli_describe")).toBe(1);
    expect(forwardedToolCalls(fake, "simpli_execute")).toBe(1);
  });

  it("blocks A2 before execution when only ordinary read scope is granted", async () => {
    const { base, fake } = await listen();
    const token = await ownerToken(base, "wordpress:read");
    const payload = await callDispatcher(base, token, "woocommerce/order.get", { id: 55 });
    expect(payload.result?.isError).toBe(true);
    expect(payload.result?.structuredContent).toMatchObject({
      code: "SIMPLI_SENSITIVE_READ_SCOPE_REQUIRED",
      status: 403,
      scope: "wordpress:sensitive",
      operation: "woocommerce/order.get",
    });
    expect(forwardedToolCalls(fake, "simpli_describe")).toBe(1);
    expect(forwardedToolCalls(fake, "simpli_execute")).toBe(0);
  });

  it("allows A2 only after explicit wordpress:sensitive grant", async () => {
    const { base, fake } = await listen();
    const token = await ownerToken(base, "wordpress:read wordpress:sensitive");
    const payload = await callDispatcher(base, token, "woocommerce/orders.query", {
      page: 1,
      limit: 5,
      include_customer: false,
      include_line_items: false,
    });
    expect(payload.result?.isError).not.toBe(true);
    expect(forwardedToolCalls(fake, "simpli_describe")).toBe(1);
    expect(forwardedToolCalls(fake, "simpli_execute")).toBe(1);
  });

  it("never lets a read-only dispatcher turn nested write metadata into execution authority", async () => {
    const { base, fake } = await listen();
    const token = await ownerToken(base, "wordpress:read wordpress:sensitive");
    const payload = await callDispatcher(base, token, "write/product.update", { id: 123 });
    expect(payload.result?.isError).toBe(true);
    expect(payload.result?.structuredContent).toMatchObject({
      code: "SIMPLI_AUTHORITY_BROKER_REQUIRED",
      status: 503,
    });
    expect(forwardedToolCalls(fake, "simpli_execute")).toBe(0);
  });

  it("rejects caller authority metadata on the direct read dispatcher", async () => {
    const { base, fake } = await listen();
    const token = await ownerToken(base, "wordpress:read wordpress:sensitive");
    const payload = await callDispatcher(
      base,
      token,
      "woocommerce/product.get",
      { id: 123 },
      { authority_ref: "CALLER_CONTROLLED", _confirm: "RUN simpli_execute" },
    );
    expect(payload.result?.isError).toBe(true);
    expect(payload.result?.structuredContent).toMatchObject({ status: 400 });
    expect(forwardedToolCalls(fake, "simpli_describe")).toBe(0);
    expect(forwardedToolCalls(fake, "simpli_execute")).toBe(0);
  });
});
