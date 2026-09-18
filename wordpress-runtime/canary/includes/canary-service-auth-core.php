<?php

declare(strict_types=1);

namespace Simpli\MCP\CanaryServiceAuth;

const SERVICE_VERSION = 'SIMPLI-WP-SERVICE-V1';
const CANARY_ROUTE = '/simpli-mcp-canary/v1/mcp';

/**
 * WordPress-independent verifier for the paired SuperComputer service identity.
 * Replay protection and WordPress service-principal selection stay in the WP wrapper.
 */

function base64url_decode_strict(string $value): ?string
{
    if ($value === '' || preg_match('/^[A-Za-z0-9_-]+$/D', $value) !== 1) {
        return null;
    }
    $padding = (4 - (strlen($value) % 4)) % 4;
    $decoded = base64_decode(strtr($value . str_repeat('=', $padding), '-_', '+/'), true);
    return $decoded === false ? null : $decoded;
}

function canonical_request(
    string $timestamp,
    string $nonce,
    string $bodySha256,
    string $route = CANARY_ROUTE
): string {
    return implode("\n", [
        SERVICE_VERSION,
        'POST',
        $route,
        $timestamp,
        $nonce,
        $bodySha256,
    ]);
}

/**
 * @param array<string,string> $headers
 * @return array{ok:bool,code:string,message:string}
 */
function verify_request(
    array $headers,
    string $body,
    string $expectedKeyId,
    string $publicKeyBase64Url,
    ?int $now = null,
    int $clockSkewSeconds = 90
): array {
    if (!function_exists('sodium_crypto_sign_verify_detached')) {
        return ['ok' => false, 'code' => 'crypto_unavailable', 'message' => 'Ed25519 verification is unavailable'];
    }

    $version = trim((string) ($headers['version'] ?? ''));
    $keyId = trim((string) ($headers['key_id'] ?? ''));
    $timestamp = trim((string) ($headers['timestamp'] ?? ''));
    $nonce = trim((string) ($headers['nonce'] ?? ''));
    $bodyHash = strtolower(trim((string) ($headers['body_sha256'] ?? '')));
    $signatureText = trim((string) ($headers['signature'] ?? ''));

    if ($version !== SERVICE_VERSION || $keyId === '' || !hash_equals($expectedKeyId, $keyId)) {
        return ['ok' => false, 'code' => 'identity_invalid', 'message' => 'Paired service identity is invalid'];
    }
    if (
        !preg_match('/^[a-f0-9]{64}$/D', $bodyHash)
        || !preg_match('/^[A-Za-z0-9._:-]{16,128}$/D', $nonce)
        || strlen($timestamp) < 20
        || strlen($timestamp) > 40
        || strlen($signatureText) < 40
        || strlen($signatureText) > 128
    ) {
        return ['ok' => false, 'code' => 'request_invalid', 'message' => 'Paired service request headers are malformed'];
    }

    $timestampUnix = strtotime($timestamp);
    $now = $now ?? time();
    if ($timestampUnix === false || abs($now - $timestampUnix) > max(0, min(120, $clockSkewSeconds))) {
        return ['ok' => false, 'code' => 'timestamp_invalid', 'message' => 'Paired service request timestamp is stale or invalid'];
    }

    $actualBodyHash = hash('sha256', $body);
    if (!hash_equals($actualBodyHash, $bodyHash)) {
        return ['ok' => false, 'code' => 'body_mismatch', 'message' => 'Paired service request body hash does not match'];
    }

    $publicKey = base64url_decode_strict($publicKeyBase64Url);
    $signature = base64url_decode_strict($signatureText);
    if (
        $publicKey === null
        || strlen($publicKey) !== SODIUM_CRYPTO_SIGN_PUBLICKEYBYTES
        || $signature === null
        || strlen($signature) !== SODIUM_CRYPTO_SIGN_BYTES
    ) {
        return ['ok' => false, 'code' => 'signature_encoding_invalid', 'message' => 'Paired service signature encoding is invalid'];
    }

    $canonical = canonical_request($timestamp, $nonce, $bodyHash);
    if (!sodium_crypto_sign_verify_detached($signature, $canonical, $publicKey)) {
        return ['ok' => false, 'code' => 'signature_invalid', 'message' => 'Paired service signature verification failed'];
    }

    return ['ok' => true, 'code' => 'verified', 'message' => 'Paired SuperComputer service identity verified'];
}
