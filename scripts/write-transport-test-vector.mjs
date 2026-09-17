import { generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import { signWordPressRequest } from "../dist/src/execution-auth.js";

const outputPath = process.argv[2];
if (!outputPath) {
  throw new Error("Usage: node scripts/write-transport-test-vector.mjs <output.json>");
}

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicJwk = publicKey.export({ format: "jwk" });
if (typeof publicJwk.x !== "string") throw new Error("Ed25519 public JWK did not contain x");

const body = JSON.stringify({
  jsonrpc: "2.0",
  id: "cross-language-vector",
  method: "tools/list",
  params: {},
});
const signed = signWordPressRequest({
  privateKey,
  keyId: "cross-language-test-key",
  audience: "https://wordpress.example.test",
  releaseId: "3.0.0-rc.4-test",
  method: "POST",
  path: "/wp-json/simpli-mcp/v1/mcp",
  body,
  ttlSeconds: 60,
  nowSeconds: 1_800_000_000,
  nonce: "cross-language-nonce",
});

writeFileSync(outputPath, JSON.stringify({
  body,
  publicKeyBase64Url: publicJwk.x,
  signatureBase64Url: signed.signature,
  attestation: signed.attestation,
}, null, 2));
