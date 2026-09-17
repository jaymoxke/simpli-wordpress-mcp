import { createHash, generateKeyPairSync } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";

const privateKeyPath = process.argv[2];
const keyId = process.argv[3] ?? `simpli-mcp-gateway-${new Date().toISOString().slice(0, 10)}`;
if (!privateKeyPath) {
  throw new Error("Usage: node scripts/generate-wordpress-signing-key.mjs <private-key-path> [key-id]");
}
if (existsSync(privateKeyPath)) {
  throw new Error(`Refusing to overwrite existing key: ${privateKeyPath}`);
}

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privatePem = privateKey.export({ format: "pem", type: "pkcs8" });
const publicJwk = publicKey.export({ format: "jwk" });
if (typeof publicJwk.x !== "string") throw new Error("Ed25519 public JWK did not contain x");

writeFileSync(privateKeyPath, privatePem, { mode: 0o600, flag: "wx" });
const fingerprint = createHash("sha256").update(Buffer.from(publicJwk.x, "base64url")).digest("hex");

process.stdout.write(`${JSON.stringify({
  keyId,
  privateKeyPath,
  publicKeyBase64Url: publicJwk.x,
  publicKeyFingerprintSha256: fingerprint,
  wordpressConstants: {
    SIMPLI_MCP_GATEWAY_KEY_ID: keyId,
    SIMPLI_MCP_GATEWAY_PUBLIC_KEY_B64URL: publicJwk.x,
  },
}, null, 2)}\n`);
