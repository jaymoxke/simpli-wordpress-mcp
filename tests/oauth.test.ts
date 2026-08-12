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

describe("OAuth 2.1", () => {
  it("supports DCR, authorization code + PKCE, refresh, and code replay prevention", async () => {
    const base = await listen();
    const redirectUri = "https://chatgpt.example.test/oauth/callback";
    const registration = await fetch(`${base}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: "ChatGPT test", redirect_uris: [redirectUri], token_endpoint_auth_method: "none" }),
    });
    expect(registration.status).toBe(201);
    const client = await registration.json() as { client_id: string };
    const verifier = "v".repeat(64);
    const form = new URLSearchParams({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: redirectUri,
      code_challenge: sha256Base64Url(verifier),
      code_challenge_method: "S256",
      state: "state-123",
      scope: "wordpress:read wordpress:write wordpress:dangerous",
      resource: testConfig.resourceUrl,
      admin_password: testConfig.oauthAdminPassword!,
    });
    const authorization = await fetch(`${base}/oauth/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      redirect: "manual",
    });
    expect(authorization.status).toBe(303);
    const location = new URL(authorization.headers.get("location")!);
    expect(location.searchParams.get("state")).toBe("state-123");
    const code = location.searchParams.get("code")!;

    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: client.client_id,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      resource: testConfig.resourceUrl,
    });
    const tokenResponse = await fetch(`${base}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody,
    });
    expect(tokenResponse.status).toBe(200);
    const tokens = await tokenResponse.json() as { access_token: string; refresh_token: string; scope: string };
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();
    expect(tokens.scope).toContain("wordpress:dangerous");

    const replay = await fetch(`${base}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody,
    });
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ error: "invalid_grant" });

    const authenticated = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokens.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "not-initialized" }),
    });
    expect(authenticated.status).toBe(400);
  });
});
