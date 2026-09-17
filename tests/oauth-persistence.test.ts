import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server as HttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config.js";
import { sha256Base64Url } from "../src/crypto.js";
import { createLogger } from "../src/logger.js";
import type { OAuthService } from "../src/oauth.js";
import { createApp } from "../src/server.js";
import { WordPressClient } from "../src/wordpress.js";
import { makeWordPressFetch, testConfig } from "./helpers.js";

interface RunningApp {
  base: string;
  server: HttpServer;
  oauth: OAuthService;
}

const running: RunningApp[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  for (const item of running.splice(0)) {
    await new Promise<void>((resolve) => item.server.close(() => resolve()));
    try {
      item.oauth.close();
    } catch {
      // Already closed by a test restart boundary.
    }
  }
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function start(config: AppConfig): Promise<RunningApp> {
  const fake = makeWordPressFetch();
  const logger = createLogger(config);
  const wordpress = new WordPressClient(config, logger, fake.fetch);
  const { app, oauth } = createApp(config, logger, wordpress);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");
  const item = { base: `http://127.0.0.1:${address.port}`, server, oauth };
  running.push(item);
  return item;
}

async function stop(item: RunningApp): Promise<void> {
  const index = running.indexOf(item);
  if (index >= 0) running.splice(index, 1);
  await new Promise<void>((resolve) => item.server.close(() => resolve()));
  item.oauth.close();
}

async function registerAndAuthorize(base: string): Promise<{
  clientId: string;
  redirectUri: string;
  verifier: string;
  code: string;
}> {
  const redirectUri = "https://chatgpt.com/connector/oauth/restart-callback";
  const registration = await fetch(`${base}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "Restart test", redirect_uris: [redirectUri] }),
  });
  expect(registration.status).toBe(201);
  const client = await registration.json() as { client_id: string };
  const verifier = "r".repeat(64);
  const authorization = await fetch(`${base}/oauth/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: redirectUri,
      code_challenge: sha256Base64Url(verifier),
      code_challenge_method: "S256",
      scope: "wordpress:read",
      resource: testConfig.resourceUrl,
      admin_password: testConfig.oauthAdminPassword!,
    }),
    redirect: "manual",
  });
  expect(authorization.status).toBe(303);
  return {
    clientId: client.client_id,
    redirectUri,
    verifier,
    code: new URL(authorization.headers.get("location")!).searchParams.get("code")!,
  };
}

describe("durable OAuth state", () => {
  it("survives restart, preserves code replay protection and preserves client revocation", async () => {
    const directory = mkdtempSync(join(tmpdir(), "simpli-oauth-"));
    tempDirs.push(directory);
    const config: AppConfig = { ...testConfig, oauthStateDbPath: join(directory, "oauth.sqlite") };

    const first = await start(config);
    const grant = await registerAndAuthorize(first.base);
    await stop(first);

    const second = await start(config);
    const tokenRequest = new URLSearchParams({
      grant_type: "authorization_code",
      code: grant.code,
      client_id: grant.clientId,
      redirect_uri: grant.redirectUri,
      code_verifier: grant.verifier,
      resource: testConfig.resourceUrl,
    });
    const tokenResponse = await fetch(`${second.base}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenRequest,
    });
    expect(tokenResponse.status).toBe(200);
    const tokens = await tokenResponse.json() as { access_token: string };

    await stop(second);
    const third = await start(config);

    const replay = await fetch(`${third.base}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenRequest,
    });
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ error: "invalid_grant" });

    const beforeRevoke = await fetch(`${third.base}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(beforeRevoke.status).toBe(200);

    const revokeClient = await fetch(`${third.base}/oauth/client/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: grant.clientId,
        admin_password: testConfig.oauthAdminPassword!,
      }),
    });
    expect(revokeClient.status).toBe(204);
    await stop(third);

    const fourth = await start(config);
    const afterRestart = await fetch(`${fourth.base}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    expect(afterRestart.status).toBe(401);
  });
});
