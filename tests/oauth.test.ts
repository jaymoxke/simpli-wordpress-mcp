import { once } from "node:events";
import type { Server as HttpServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { sha256Base64Url } from "../src/crypto.js";
import { createLogger } from "../src/logger.js";
import { createApp } from "../src/server.js";
import { WordPressClient } from "../src/wordpress.js";
import { makeWordPressFetch, testConfig } from "./helpers.js";

const servers: HttpServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function listen(): Promise<string> {
  const fake = makeWordPressFetch();
  const logger = createLogger(testConfig);
  const wordpress = new WordPressClient(testConfig, logger, fake.fetch);
  const { app } = createApp(testConfig, logger, wordpress);
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

async function createAuthorization(base: string, scope?: string): Promise<{
  clientId: string;
  redirectUri: string;
  verifier: string;
  code: string;
}> {
  const redirectUri = "https://chatgpt.com/connector/oauth/test-callback";
  const registration = await fetch(`${base}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "ChatGPT test",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
    }),
  });
  expect(registration.status).toBe(201);
  const client = await registration.json() as { client_id: string };
  const verifier = "v".repeat(64);
  const fields: Record<string, string> = {
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: redirectUri,
    code_challenge: sha256Base64Url(verifier),
    code_challenge_method: "S256",
    state: "state-123",
    resource: testConfig.resourceUrl,
    admin_password: testConfig.oauthAdminPassword!,
  };
  if (scope) fields.scope = scope;
  const form = new URLSearchParams(fields);

  const authorizationPage = await fetch(`${base}/oauth/authorize?${form.toString()}`);
  expect(authorizationPage.status).toBe(200);
  expect(authorizationPage.headers.get("cross-origin-opener-policy")).toBe("unsafe-none");
  expect(authorizationPage.headers.get("content-security-policy")).toContain(
    "form-action 'self' https://chatgpt.com",
  );
  expect(authorizationPage.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");

  const authorization = await fetch(`${base}/oauth/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    redirect: "manual",
  });
  expect(authorization.status).toBe(303);
  const location = new URL(authorization.headers.get("location")!);
  expect(location.origin).toBe("https://chatgpt.com");
  expect(location.searchParams.get("state")).toBe("state-123");
  return {
    clientId: client.client_id,
    redirectUri,
    verifier,
    code: location.searchParams.get("code")!,
  };
}

async function exchangeCode(base: string, grant: {
  clientId: string;
  redirectUri: string;
  verifier: string;
  code: string;
}): Promise<{ access_token: string; refresh_token: string; scope: string }> {
  const response = await fetch(`${base}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: grant.code,
      client_id: grant.clientId,
      redirect_uri: grant.redirectUri,
      code_verifier: grant.verifier,
      resource: testConfig.resourceUrl,
    }),
  });
  expect(response.status).toBe(200);
  return await response.json() as { access_token: string; refresh_token: string; scope: string };
}

async function mcpStatus(base: string, accessToken: string): Promise<number> {
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  return response.status;
}

describe("OAuth 2.1 durable opaque-token flow", () => {
  it("supports PKCE, durable one-time codes, rotating refresh tokens and family reuse containment", async () => {
    const base = await listen();
    const grant = await createAuthorization(
      base,
      "wordpress:read wordpress:write wordpress:dangerous",
    );
    const tokens = await exchangeCode(base, grant);

    expect(tokens.access_token).toMatch(/^sat_/);
    expect(tokens.refresh_token).toMatch(/^srt_/);
    expect(tokens.scope).toContain("wordpress:dangerous");
    expect(await mcpStatus(base, tokens.access_token)).toBe(200);

    const replay = await fetch(`${base}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: grant.code,
        client_id: grant.clientId,
        redirect_uri: grant.redirectUri,
        code_verifier: grant.verifier,
        resource: testConfig.resourceUrl,
      }),
    });
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ error: "invalid_grant" });

    const rotatedResponse = await fetch(`${base}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id: grant.clientId,
        resource: testConfig.resourceUrl,
      }),
    });
    expect(rotatedResponse.status).toBe(200);
    const rotated = await rotatedResponse.json() as { access_token: string; refresh_token: string; scope: string };
    expect(rotated.access_token).not.toBe(tokens.access_token);
    expect(rotated.refresh_token).not.toBe(tokens.refresh_token);
    expect(await mcpStatus(base, rotated.access_token)).toBe(200);

    const reused = await fetch(`${base}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id: grant.clientId,
        resource: testConfig.resourceUrl,
      }),
    });
    expect(reused.status).toBe(400);
    expect(await reused.json()).toMatchObject({ error: "invalid_grant" });

    // Reuse of an already-rotated refresh token is treated as credential theft:
    // the entire token family, including the newest access token, is revoked.
    expect(await mcpStatus(base, rotated.access_token)).toBe(401);
  });

  it("defaults omitted scopes to read-only and supports immediate access-token revocation", async () => {
    const base = await listen();
    const grant = await createAuthorization(base);
    const tokens = await exchangeCode(base, grant);
    expect(tokens.scope).toBe("wordpress:read");
    expect(await mcpStatus(base, tokens.access_token)).toBe(200);

    const revocation = await fetch(`${base}/oauth/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: tokens.access_token, client_id: grant.clientId }),
    });
    expect(revocation.status).toBe(200);
    expect(await mcpStatus(base, tokens.access_token)).toBe(401);
  });
});
