import { once } from "node:events";
import type { Server as HttpServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger } from "../src/logger.js";
import { createApp } from "../src/server.js";
import { SIMPLI_MCP_VERSION } from "../src/version.js";
import { WordPressClient } from "../src/wordpress.js";
import { makeWordPressFetch, testConfig } from "./helpers.js";

const servers: HttpServer[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
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

describe("canonical release identity", () => {
  it("reports one release version consistently without overstating backend independence", async () => {
    const base = await listen();

    const [rootResponse, healthResponse, versionResponse, readyResponse] = await Promise.all([
      fetch(`${base}/`),
      fetch(`${base}/health`),
      fetch(`${base}/version`),
      fetch(`${base}/ready`),
    ]);

    expect(rootResponse.status).toBe(200);
    expect(healthResponse.status).toBe(200);
    expect(versionResponse.status).toBe(200);
    expect(readyResponse.status).toBe(200);

    const root = await rootResponse.json() as Record<string, unknown>;
    const health = await healthResponse.json() as Record<string, unknown>;
    const version = await versionResponse.json() as Record<string, unknown>;
    const ready = await readyResponse.json() as {
      release?: Record<string, unknown>;
      oauth?: Record<string, unknown>;
    };

    for (const payload of [root, health, version, ready.release ?? {}]) {
      expect(payload.version).toBe(SIMPLI_MCP_VERSION);
      expect(payload.runtime).toBe("node-24");
      expect(payload.oauthTokenModel).toBe("opaque-sha256-sqlite");
      expect(payload.oauthRefreshRotation).toBe(true);
      expect(payload.oauthDurableReplayProtection).toBe(true);
      expect(payload.novamiraGatewayDependency).toBe(false);
      expect(payload.wordpressBackendIndependence).toBe("unverified");
    }

    expect(ready.oauth).toMatchObject({
      enabled: true,
      storage: "sqlite",
      durable: false,
      healthy: true,
      tokenModel: "opaque-sha256",
      refreshRotation: true,
      authorizationCodeReplayProtection: "durable",
    });
    expect(versionResponse.headers.get("cache-control")).toContain("no-store");
  });
});
