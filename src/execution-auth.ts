import { createHash, createPrivateKey, randomUUID, sign as cryptoSign, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";

export const WORDPRESS_REQUEST_AUTH_VERSION = "simpli-wp-request-v1" as const;

export interface WordPressRequestAttestation {
  version: typeof WORDPRESS_REQUEST_AUTH_VERSION;
  method: string;
  path: string;
  audience: string;
  keyId: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  bodySha256: string;
  releaseId: string;
}

export interface SignedWordPressRequest {
  attestation: WordPressRequestAttestation;
  canonical: string;
  signature: string;
  headers: Record<string, string>;
}

export interface SignWordPressRequestInput {
  privateKey: KeyObject;
  keyId: string;
  audience: string;
  releaseId: string;
  method: string;
  path: string;
  body: string;
  ttlSeconds: number;
  nowSeconds?: number;
  nonce?: string;
}

export function sha256Base64Url(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("base64url");
}

function normalizeMethod(value: string): string {
  const method = value.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(method)) throw new Error("Invalid signed WordPress HTTP method");
  return method;
}

function normalizePath(value: string): string {
  if (!value.startsWith("/") || value.includes("\n") || value.includes("\r")) {
    throw new Error("Invalid signed WordPress request path");
  }
  return value;
}

function normalizeScalar(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.includes("\n") || normalized.includes("\r")) {
    throw new Error(`Invalid ${label}`);
  }
  return normalized;
}

export function canonicalWordPressRequest(attestation: WordPressRequestAttestation): string {
  return [
    "SIMPLI-WP-REQUEST-V1",
    attestation.method,
    attestation.path,
    attestation.audience,
    attestation.keyId,
    String(attestation.issuedAt),
    String(attestation.expiresAt),
    attestation.nonce,
    attestation.bodySha256,
    attestation.releaseId,
  ].join("\n");
}

export function loadEd25519PrivateKey(path: string): KeyObject {
  const key = createPrivateKey(readFileSync(path));
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("WORDPRESS_SIGNING_PRIVATE_KEY_PATH must contain an Ed25519 private key");
  }
  return key;
}

export function signWordPressRequest(input: SignWordPressRequestInput): SignedWordPressRequest {
  if (input.privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("WordPress request signing requires an Ed25519 private key");
  }
  if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 10 || input.ttlSeconds > 300) {
    throw new Error("WordPress request signing TTL must be between 10 and 300 seconds");
  }

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isInteger(now) || now <= 0) throw new Error("Invalid signing clock");

  const audience = new URL(input.audience).origin;
  const attestation: WordPressRequestAttestation = {
    version: WORDPRESS_REQUEST_AUTH_VERSION,
    method: normalizeMethod(input.method),
    path: normalizePath(input.path),
    audience,
    keyId: normalizeScalar(input.keyId, "WordPress signing key id"),
    issuedAt: now,
    expiresAt: now + input.ttlSeconds,
    nonce: normalizeScalar(input.nonce ?? randomUUID(), "WordPress request nonce"),
    bodySha256: sha256Base64Url(input.body),
    releaseId: normalizeScalar(input.releaseId, "Simpli MCP release id"),
  };
  const canonical = canonicalWordPressRequest(attestation);
  const signature = cryptoSign(null, Buffer.from(canonical, "utf8"), input.privateKey).toString("base64url");

  return {
    attestation,
    canonical,
    signature,
    headers: {
      "X-Simpli-Auth-Version": attestation.version,
      "X-Simpli-Key-Id": attestation.keyId,
      "X-Simpli-Issued-At": String(attestation.issuedAt),
      "X-Simpli-Expires-At": String(attestation.expiresAt),
      "X-Simpli-Nonce": attestation.nonce,
      "X-Simpli-Body-Sha256": attestation.bodySha256,
      "X-Simpli-Release-Id": attestation.releaseId,
      "X-Simpli-Audience": attestation.audience,
      "X-Simpli-Signature": signature,
    },
  };
}

export class WordPressRequestSigner {
  private readonly privateKey: KeyObject;

  constructor(
    private readonly keyId: string,
    private readonly privateKeyPath: string,
    private readonly ttlSeconds: number,
    private readonly releaseId: string,
  ) {
    this.privateKey = loadEd25519PrivateKey(privateKeyPath);
  }

  sign(options: { method: string; path: string; audience: string; body: string }): SignedWordPressRequest {
    return signWordPressRequest({
      privateKey: this.privateKey,
      keyId: this.keyId,
      audience: options.audience,
      releaseId: this.releaseId,
      method: options.method,
      path: options.path,
      body: options.body,
      ttlSeconds: this.ttlSeconds,
    });
  }
}
