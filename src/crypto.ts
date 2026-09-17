import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export function randomOpaqueToken(prefix: string, bytes = 32): string {
  if (!/^[a-z][a-z0-9_]{1,15}$/i.test(prefix)) throw new Error("Invalid token prefix");
  if (!Number.isInteger(bytes) || bytes < 32 || bytes > 64) throw new Error("Opaque tokens require 32-64 random bytes");
  return `${prefix}_${randomBytes(bytes).toString("base64url")}`;
}

export function hashOpaqueToken(token: string): string {
  return sha256Base64Url(token);
}
