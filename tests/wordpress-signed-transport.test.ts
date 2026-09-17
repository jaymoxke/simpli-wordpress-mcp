import { generateKeyPairSync, verify as cryptoVerify } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config.js";
import { canonicalWordPressRequest, type WordPressRequestAttestation } from "../src/execution-auth.js";
import { WordPressClient } from "../src/wordpress.js";
import { makeWordPressFetch, silentLogger, testConfig } from "./helpers.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function signingFixture(mode: "dual" | "signed"): {
  config: AppConfig;
  publicKey: ReturnType<typeof generateKeyPairSync>["publicKey"];
} {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const dir = mkdtempSync(join(tmpdir(), "simpli-mcp-signing-"));
  dirs.push(dir);
  const keyPath = join(dir, "gateway-ed25519.pem");
  writeFileSync(keyPath, privateKey.export({ format: "pem", type: "pkcs8" }));

  const signing = {
    wordpressAuthMode: mode,
    wordpressSigningKeyId: "gateway-test-key",
    wordpressSigningPrivateKeyPath: keyPath,
    wordpressSigningTtlSeconds: 60,
  } satisfies Partial<AppConfig>;

  let config: AppConfig;
  if (mode === "signed") {
    const {
      wordpressUsername: _wordpressUsername,
      wordpressAppPassword: _wordpressAppPassword,
      ...withoutBasic
    } = testConfig;
    config = { ...withoutBasic, ...signing, wordpressAuthMode: "signed" };
  } else {
    config = { ...testConfig, ...signing, wordpressAuthMode: "dual" };
  }

  return { publicKey, config };
}

function attestationFromHeaders(headers: Headers): WordPressRequestAttestation {
  const required = (name: string): string => {
    const value = headers.get(name);
    if (!value) throw new Error(`Missing ${name}`);
    return value;
  };
  return {
    version: required("x-simpli-auth-version") as WordPressRequestAttestation["version"],
    method: "POST",
    path: "/wp-json/simpli-mcp/v1/mcp",
    audience: required("x-simpli-audience"),
    keyId: required("x-simpli-key-id"),
    issuedAt: Number(required("x-simpli-issued-at")),
    expiresAt: Number(required("x-simpli-expires-at")),
    nonce: required("x-simpli-nonce"),
    bodySha256: required("x-simpli-body-sha256"),
    releaseId: required("x-simpli-release-id"),
  };
}

describe("WordPressClient signed transport", () => {
  it("dual mode signs the exact body while retaining Basic auth for staged rollout", async () => {
    const { config, publicKey } = signingFixture("dual");
    const fake = makeWordPressFetch();
    const client = new WordPressClient(config, silentLogger, fake.fetch);

    await client.listTools(true);
    const call = fake.calls[0];
    expect(call).toBeTruthy();
    const headers = new Headers(call?.init?.headers);
    expect(headers.get("authorization")).toMatch(/^Basic /);
    expect(headers.get("x-simpli-key-id")).toBe("gateway-test-key");
    expect(headers.get("user-agent")).toBe(config.wordpressUserAgent);
    expect(headers.get("user-agent")).toMatch(/^Mozilla\/5\.0/);
    expect(headers.get("x-simpli-client")).toMatch(/^simpli-wordpress-mcp\//);
    expect(headers.get("x-simpli-release-id")).toBeTruthy();
    expect(call?.init?.redirect).toBe("error");
    expect(call?.url.origin).toBe(config.wordpressUrl);
    expect(call?.url.pathname).toBe("/wp-json/simpli-mcp/v1/mcp");

    const body = String(call?.init?.body ?? "");
    const attestation = attestationFromHeaders(headers);
    expect(attestation.expiresAt - attestation.issuedAt).toBe(60);
    expect(
      cryptoVerify(
        null,
        Buffer.from(canonicalWordPressRequest(attestation), "utf8"),
        publicKey,
        Buffer.from(headers.get("x-simpli-signature")!, "base64url"),
      ),
    ).toBe(true);
    expect(attestation.bodySha256).toBe(headers.get("x-simpli-body-sha256"));
    expect(body).toContain("\"tools/list\"");
  });

  it("signed mode sends no WordPress Basic credential", async () => {
    const { config } = signingFixture("signed");
    const fake = makeWordPressFetch();
    const client = new WordPressClient(config, silentLogger, fake.fetch);

    await client.listTools(true);
    const headers = new Headers(fake.calls[0]?.init?.headers);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-simpli-signature")).toBeTruthy();
    expect(headers.get("x-simpli-audience")).toBe("https://wordpress.example.test");
  });

  it("reports exact origin, redirect rejection and UA posture in readiness", async () => {
    const fake = makeWordPressFetch();
    const client = new WordPressClient(testConfig, silentLogger, fake.fetch);
    const readiness = await client.readiness();
    expect(readiness).toMatchObject({
      ready: true,
      endpointOrigin: "https://wordpress.example.test",
      redirectPolicy: "reject",
      userAgentMode: "browser-compatible",
    });
  });
});
