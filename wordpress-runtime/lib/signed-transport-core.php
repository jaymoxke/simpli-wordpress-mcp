<?php

declare(strict_types=1);

namespace Simpli\MCP\SignedTransport;

const AUTH_VERSION = 'simpli-wp-request-v1';

/**
 * This file is deliberately WordPress-independent so the canonical request
 * contract can be tested outside WordPress. It contains no capability logic.
 */

function base64url_encode(string $bytes): string
{
    return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
}

function base64url_decode_strict(string $value): ?string
{
    if ($value === '' || preg_match('/^[A-Za-z0-9_-]+$/D', $value) !== 1) {
        return null;
    }
    $padding = (4 - (strlen($value) % 4)) % 4;
    $decoded = base64_decode(strtr($value . str_repeat('=', $padding), '-_', '+/'), true);
    return $decoded === false ? null : $decoded;
}

/** @param array<string, scalar> $attestation */
function canonical_request(array $attestation): string
{
    $required = [
        'method',
        'path',
        'audience',
        'keyId',
        'issuedAt',
        'expiresAt',
        'nonce',
        'bodySha256',
        'releaseId',
    ];
    foreach ($required as $field) {
        if (!array_key_exists($field, $attestation)) {
            throw new \InvalidArgumentException("Missing signed transport field: {$field}");
        }
        $value = (string) $attestation[$field];
        if ($value === '' || str_contains($value, "\n") || str_contains($value, "\r")) {
            throw new \InvalidArgumentException("Invalid signed transport field: {$field}");
        }
    }

    return implode("\n", [
        'SIMPLI-WP-REQUEST-V1',
        (string) $attestation['method'],
        (string) $attestation['path'],
        (string) $attestation['audience'],
        (string) $attestation['keyId'],
        (string) $attestation['issuedAt'],
        (string) $attestation['expiresAt'],
        (string) $attestation['nonce'],
        (string) $attestation['bodySha256'],
        (string) $attestation['releaseId'],
    ]);
}

/**
 * @param array<string, scalar> $attestation
 * @return array{ok: bool, code: string, message: string}
 */
function verify_request_signature(
    array $attestation,
    string $body,
    string $signatureBase64Url,
    string $publicKeyBase64Url
): array {
    if (!function_exists('sodium_crypto_sign_verify_detached')) {
        return ['ok' => false, 'code' => 'crypto_unavailable', 'message' => 'Libsodium Ed25519 verification is unavailable'];
    }

    $expectedBodyHash = base64url_encode(hash('sha256', $body, true));
    $actualBodyHash = (string) ($attestation['bodySha256'] ?? '');
    if ($actualBodyHash === '' || !hash_equals($expectedBodyHash, $actualBodyHash)) {
        return ['ok' => false, 'code' => 'body_hash_mismatch', 'message' => 'Signed request body digest does not match'];
    }

    $signature = base64url_decode_strict($signatureBase64Url);
    $publicKey = base64url_decode_strict($publicKeyBase64Url);
    if ($signature === null || strlen($signature) !== SODIUM_CRYPTO_SIGN_BYTES) {
        return ['ok' => false, 'code' => 'signature_encoding_invalid', 'message' => 'Signed request signature encoding is invalid'];
    }
    if ($publicKey === null || strlen($publicKey) !== SODIUM_CRYPTO_SIGN_PUBLICKEYBYTES) {
        return ['ok' => false, 'code' => 'public_key_invalid', 'message' => 'Signed request public key is invalid'];
    }

    try {
        $canonical = canonical_request($attestation);
    } catch (\InvalidArgumentException $error) {
        return ['ok' => false, 'code' => 'attestation_invalid', 'message' => $error->getMessage()];
    }

    if (!sodium_crypto_sign_verify_detached($signature, $canonical, $publicKey)) {
        return ['ok' => false, 'code' => 'signature_invalid', 'message' => 'Signed request signature is invalid'];
    }

    return ['ok' => true, 'code' => 'verified', 'message' => 'Signed request verified'];
}
