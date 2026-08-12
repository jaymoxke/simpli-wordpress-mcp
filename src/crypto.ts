import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

function encode(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function decode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export interface TokenClaims {
  iss: string;
  aud: string;
  sub: string;
  typ: string;
  iat: number;
  exp: number;
  jti: string;
  [key: string]: unknown;
}

export function issueSignedToken(
  secret: string,
  claims: Omit<TokenClaims, "iat" | "jti"> & Partial<Pick<TokenClaims, "iat" | "jti">>,
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = encode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = encode(
    JSON.stringify({
      ...claims,
      iat: claims.iat ?? now,
      jti: claims.jti ?? randomUUID(),
    }),
  );
  const unsigned = `${header}.${payload}`;
  const signature = createHmac("sha256", secret).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}

export function verifySignedToken<T extends TokenClaims>(
  secret: string,
  token: string,
  expected: { issuer: string; audience: string; type: string },
): T {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error("Malformed token");
  }
  const unsigned = `${parts[0]}.${parts[1]}`;
  const expectedSignature = createHmac("sha256", secret).update(unsigned).digest("base64url");
  if (!constantTimeEqual(expectedSignature, parts[2])) throw new Error("Invalid token signature");

  let claims: T;
  try {
    claims = JSON.parse(decode(parts[1]).toString("utf8")) as T;
  } catch {
    throw new Error("Invalid token payload");
  }

  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== expected.issuer) throw new Error("Invalid token issuer");
  if (claims.aud !== expected.audience) throw new Error("Invalid token audience");
  if (claims.typ !== expected.type) throw new Error("Invalid token type");
  if (!Number.isInteger(claims.exp) || claims.exp <= now) throw new Error("Expired token");
  if (!Number.isInteger(claims.iat) || claims.iat > now + 60) throw new Error("Invalid token issue time");
  return claims;
}
