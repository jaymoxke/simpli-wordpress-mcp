<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/wordpress-runtime/lib/signed-transport-core.php';

use function Simpli\MCP\SignedTransport\verify_request_signature;

$path = $argv[1] ?? '';
if ($path === '' || !is_file($path)) {
    fwrite(STDERR, "Usage: php tests/php/verify-transport-vector.php <vector.json>\n");
    exit(2);
}

$raw = file_get_contents($path);
$vector = json_decode((string) $raw, true, 512, JSON_THROW_ON_ERROR);
if (!is_array($vector)) {
    fwrite(STDERR, "Vector is not an object\n");
    exit(3);
}

$attestation = $vector['attestation'] ?? null;
$body = $vector['body'] ?? null;
$signature = $vector['signatureBase64Url'] ?? null;
$publicKey = $vector['publicKeyBase64Url'] ?? null;
if (!is_array($attestation) || !is_string($body) || !is_string($signature) || !is_string($publicKey)) {
    fwrite(STDERR, "Vector fields are invalid\n");
    exit(4);
}

$verified = verify_request_signature($attestation, $body, $signature, $publicKey);
if (!$verified['ok']) {
    fwrite(STDERR, "Cross-language verification failed: {$verified['code']} {$verified['message']}\n");
    exit(5);
}

$tampered = verify_request_signature($attestation, $body . ' ', $signature, $publicKey);
if ($tampered['ok'] || $tampered['code'] !== 'body_hash_mismatch') {
    fwrite(STDERR, "Tampered-body negative test failed\n");
    exit(6);
}

fwrite(STDOUT, "SIMPLI_SIGNED_TRANSPORT_VECTOR_VERIFIED\n");
