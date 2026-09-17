import { generateKeyPairSync, verify as cryptoVerify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalWordPressRequest,
  sha256Base64Url,
  signWordPressRequest,
  WORDPRESS_REQUEST_AUTH_VERSION,
} from "../src/execution-auth.js";

describe("WordPress signed transport", () => {
  it("binds method, route, audience, body, nonce, release and expiry with Ed25519", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: "request-1",
      method: "tools/call",
      params: { name: "simpli_execute", arguments: { ability_name: "wordpress/site-info.get", input: {} } },
    });
    const signed = signWordPressRequest({
      privateKey,
      keyId: "gateway-test-1",
      audience: "https://wordpress.example.test/some/path",
      releaseId: "3.0.0-rc.4",
      method: "post",
      path: "/wp-json/simpli-mcp/v1/mcp",
      body,
      ttlSeconds: 60,
      nowSeconds: 1_800_000_000,
      nonce: "nonce-test-1",
    });

    expect(signed.attestation).toEqual({
      version: WORDPRESS_REQUEST_AUTH_VERSION,
      method: "POST",
      path: "/wp-json/simpli-mcp/v1/mcp",
      audience: "https://wordpress.example.test",
      keyId: "gateway-test-1",
      issuedAt: 1_800_000_000,
      expiresAt: 1_800_000_060,
      nonce: "nonce-test-1",
      bodySha256: sha256Base64Url(body),
      releaseId: "3.0.0-rc.4",
    });
    expect(signed.canonical).toBe(canonicalWordPressRequest(signed.attestation));
    expect(
      cryptoVerify(
        null,
        Buffer.from(signed.canonical, "utf8"),
        publicKey,
        Buffer.from(signed.signature, "base64url"),
      ),
    ).toBe(true);
    expect(signed.headers["X-Simpli-Signature"]).toBe(signed.signature);
    expect(signed.headers["X-Simpli-Body-Sha256"]).toBe(sha256Base64Url(body));
  });

  it("does not validate after the signed body is changed", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const signed = signWordPressRequest({
      privateKey,
      keyId: "gateway-test-1",
      audience: "https://wordpress.example.test",
      releaseId: "3.0.0-rc.4",
      method: "POST",
      path: "/wp-json/simpli-mcp/v1/mcp",
      body: "{\"safe\":true}",
      ttlSeconds: 60,
      nowSeconds: 1_800_000_000,
      nonce: "nonce-test-2",
    });

    const tampered = {
      ...signed.attestation,
      bodySha256: sha256Base64Url("{\"safe\":false}"),
    };
    expect(
      cryptoVerify(
        null,
        Buffer.from(canonicalWordPressRequest(tampered), "utf8"),
        publicKey,
        Buffer.from(signed.signature, "base64url"),
      ),
    ).toBe(false);
  });

  it("rejects non-Ed25519 keys and excessive attestation lifetimes", () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    expect(() => signWordPressRequest({
      privateKey: rsa,
      keyId: "bad",
      audience: "https://wordpress.example.test",
      releaseId: "3.0.0-rc.4",
      method: "POST",
      path: "/wp-json/simpli-mcp/v1/mcp",
      body: "{}",
      ttlSeconds: 60,
    })).toThrow(/Ed25519/);

    const ed = generateKeyPairSync("ed25519").privateKey;
    expect(() => signWordPressRequest({
      privateKey: ed,
      keyId: "test",
      audience: "https://wordpress.example.test",
      releaseId: "3.0.0-rc.4",
      method: "POST",
      path: "/wp-json/simpli-mcp/v1/mcp",
      body: "{}",
      ttlSeconds: 301,
    })).toThrow(/between 10 and 300/);
  });
});
