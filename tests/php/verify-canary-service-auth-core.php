<?php

declare(strict_types=1);

require_once __DIR__ . '/../../wordpress-runtime/canary/includes/canary-service-auth-core.php';

use function Simpli\MCP\CanaryServiceAuth\canonical_request;
use function Simpli\MCP\CanaryServiceAuth\verify_request;
use const Simpli\MCP\CanaryServiceAuth\CANARY_ROUTE;
use const Simpli\MCP\CanaryServiceAuth\SERVICE_VERSION;

function b64url(string $bytes): string
{
    return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
}

if (!function_exists('sodium_crypto_sign_keypair')) {
    fwrite(STDERR, "libsodium unavailable\n");
    exit(1);
}

$keypair = sodium_crypto_sign_keypair();
$secret = sodium_crypto_sign_secretkey($keypair);
$public = sodium_crypto_sign_publickey($keypair);

$body = '{"jsonrpc":"2.0","id":"canary-test","method":"tools/list","params":{}}';
$timestamp = '2026-09-18T07:30:00Z';
$nonce = 'canary-test-nonce-0001';
$bodyHash = hash('sha256', $body);
$keyId = 'sc-wordpress-mcp-v1';

$canonical = canonical_request($timestamp, $nonce, $bodyHash);
$expectedPrefix = SERVICE_VERSION . "\nPOST\n" . CANARY_ROUTE . "\n";
if (!str_starts_with($canonical, $expectedPrefix)) {
    fwrite(STDERR, "canonical route binding failed\n");
    exit(1);
}

$signature = sodium_crypto_sign_detached($canonical, $secret);
$headers = [
    'version' => SERVICE_VERSION,
    'key_id' => $keyId,
    'timestamp' => $timestamp,
    'nonce' => $nonce,
    'body_sha256' => $bodyHash,
    'signature' => b64url($signature),
];

$now = strtotime($timestamp);
$valid = verify_request($headers, $body, $keyId, b64url($public), $now, 90);
if (!$valid['ok']) {
    fwrite(STDERR, "valid signature rejected: " . $valid['code'] . "\n");
    exit(1);
}

$tamperedBody = verify_request($headers, $body . ' ', $keyId, b64url($public), $now, 90);
if ($tamperedBody['ok'] || $tamperedBody['code'] !== 'body_mismatch') {
    fwrite(STDERR, "tampered body was not rejected\n");
    exit(1);
}

$wrongKey = verify_request($headers, $body, 'different-key', b64url($public), $now, 90);
if ($wrongKey['ok'] || $wrongKey['code'] !== 'identity_invalid') {
    fwrite(STDERR, "wrong key id was not rejected\n");
    exit(1);
}

$stale = verify_request($headers, $body, $keyId, b64url($public), $now + 500, 90);
if ($stale['ok'] || $stale['code'] !== 'timestamp_invalid') {
    fwrite(STDERR, "stale request was not rejected\n");
    exit(1);
}

echo "CANARY_SERVICE_AUTH_CORE_PASS\n";
