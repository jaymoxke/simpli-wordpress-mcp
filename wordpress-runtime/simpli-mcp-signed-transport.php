<?php
/**
 * Plugin Name: Simpli MCP Signed Transport
 * Description: Verifies short-lived Ed25519 request attestations for the first-party Simpli MCP WordPress runtime.
 * Version: 0.1.0
 * Author: Simpli Cosmetics Kenya
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

require_once __DIR__ . '/lib/signed-transport-core.php';

use function Simpli\MCP\SignedTransport\verify_request_signature;
use const Simpli\MCP\SignedTransport\AUTH_VERSION;

final class Simpli_MCP_Signed_Transport_Guard
{
    private const ROUTE = '/simpli-mcp/v1/mcp';
    private const TABLE_SUFFIX = 'simpli_mcp_request_nonces';

    /** @var array<int, true> */
    private static array $verifiedRequests = [];

    public static function bootstrap(): void
    {
        add_filter('rest_pre_dispatch', [self::class, 'guard'], 5, 3);
    }

    public static function activate(): void
    {
        global $wpdb;
        if (!isset($wpdb)) {
            return;
        }
        $table = self::table_name();
        $charset = $wpdb->get_charset_collate();
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta("CREATE TABLE {$table} (
            nonce_hash char(64) NOT NULL,
            expires_at bigint(20) unsigned NOT NULL,
            created_at bigint(20) unsigned NOT NULL,
            PRIMARY KEY  (nonce_hash),
            KEY expires_at (expires_at)
        ) {$charset};");
    }

    /**
     * Final first-party runtime permission callbacks can use this after
     * rest_pre_dispatch has verified the request. A true value means only that
     * machine transport identity/replay checks passed; it does not grant
     * business authority for a capability or mutation.
     */
    public static function is_verified_request($request): bool
    {
        return is_object($request) && isset(self::$verifiedRequests[spl_object_id($request)]);
    }

    /**
     * Modes:
     * - disabled: no transport enforcement, suitable only during staged rollout.
     * - observe: verify when headers are present and record bounded diagnostics, but do not block.
     * - enforce: reject every invalid, expired, replayed or unsigned request before capability dispatch.
     */
    private static function mode(): string
    {
        $mode = defined('SIMPLI_MCP_SIGNED_TRANSPORT_MODE')
            ? strtolower(trim((string) constant('SIMPLI_MCP_SIGNED_TRANSPORT_MODE')))
            : 'disabled';
        return in_array($mode, ['disabled', 'observe', 'enforce'], true) ? $mode : 'disabled';
    }

    public static function guard($result, $server, $request)
    {
        if (!is_object($request) || !method_exists($request, 'get_route')) {
            return $result;
        }
        if ((string) $request->get_route() !== self::ROUTE) {
            return $result;
        }

        $mode = self::mode();
        if ($mode === 'disabled') {
            return $result;
        }

        $verification = self::verify($request, $mode === 'enforce');
        if ($verification === true) {
            self::$verifiedRequests[spl_object_id($request)] = true;
            return $result;
        }

        $code = is_wp_error($verification) ? $verification->get_error_code() : 'simpli_signed_transport_failed';
        if ($mode === 'observe') {
            error_log('[simpli-mcp] signed transport observation failed: ' . sanitize_key((string) $code));
            return $result;
        }

        return $verification;
    }

    private static function verify($request, bool $claimNonce)
    {
        if (strtoupper((string) $request->get_method()) !== 'POST') {
            return self::error('method_not_allowed', 'Signed Simpli MCP transport accepts POST only', 405);
        }

        $configuredKeyId = defined('SIMPLI_MCP_GATEWAY_KEY_ID')
            ? trim((string) constant('SIMPLI_MCP_GATEWAY_KEY_ID'))
            : '';
        $publicKey = defined('SIMPLI_MCP_GATEWAY_PUBLIC_KEY_B64URL')
            ? trim((string) constant('SIMPLI_MCP_GATEWAY_PUBLIC_KEY_B64URL'))
            : '';
        if ($configuredKeyId === '' || $publicKey === '') {
            return self::error('transport_not_configured', 'Signed Simpli MCP transport verification is not configured', 503);
        }

        $version = self::header($request, 'x-simpli-auth-version');
        $keyId = self::header($request, 'x-simpli-key-id');
        $issuedAtRaw = self::header($request, 'x-simpli-issued-at');
        $expiresAtRaw = self::header($request, 'x-simpli-expires-at');
        $nonce = self::header($request, 'x-simpli-nonce');
        $bodySha256 = self::header($request, 'x-simpli-body-sha256');
        $releaseId = self::header($request, 'x-simpli-release-id');
        $audience = self::header($request, 'x-simpli-audience');
        $signature = self::header($request, 'x-simpli-signature');

        foreach ([
            'version' => $version,
            'key_id' => $keyId,
            'issued_at' => $issuedAtRaw,
            'expires_at' => $expiresAtRaw,
            'nonce' => $nonce,
            'body_sha256' => $bodySha256,
            'release_id' => $releaseId,
            'audience' => $audience,
            'signature' => $signature,
        ] as $name => $value) {
            if ($value === '') {
                return self::error('attestation_missing', "Missing signed transport field: {$name}", 401);
            }
        }

        if (!hash_equals(AUTH_VERSION, $version)) {
            return self::error('auth_version_invalid', 'Unsupported signed transport version', 401);
        }
        if (!hash_equals($configuredKeyId, $keyId)) {
            return self::error('key_id_invalid', 'Signed transport key id is not admitted', 401);
        }
        if (!ctype_digit($issuedAtRaw) || !ctype_digit($expiresAtRaw)) {
            return self::error('timestamp_invalid', 'Signed transport timestamps are invalid', 401);
        }

        $issuedAt = (int) $issuedAtRaw;
        $expiresAt = (int) $expiresAtRaw;
        $now = time();
        $clockSkew = defined('SIMPLI_MCP_SIGNED_CLOCK_SKEW_SECONDS')
            ? max(0, min(120, (int) constant('SIMPLI_MCP_SIGNED_CLOCK_SKEW_SECONDS')))
            : 60;
        if ($expiresAt <= $issuedAt || ($expiresAt - $issuedAt) > 300) {
            return self::error('lifetime_invalid', 'Signed transport lifetime is invalid', 401);
        }
        if ($issuedAt > ($now + $clockSkew)) {
            return self::error('issued_in_future', 'Signed transport request is not yet valid', 401);
        }
        if ($expiresAt < ($now - $clockSkew)) {
            return self::error('request_expired', 'Signed transport request has expired', 401);
        }

        $expectedAudience = self::expected_audience();
        if ($expectedAudience === '' || !hash_equals($expectedAudience, $audience)) {
            return self::error('audience_invalid', 'Signed transport audience is invalid', 401);
        }

        $attestation = [
            'method' => 'POST',
            'path' => '/wp-json/simpli-mcp/v1/mcp',
            'audience' => $audience,
            'keyId' => $keyId,
            'issuedAt' => $issuedAt,
            'expiresAt' => $expiresAt,
            'nonce' => $nonce,
            'bodySha256' => $bodySha256,
            'releaseId' => $releaseId,
        ];
        $crypto = verify_request_signature($attestation, (string) $request->get_body(), $signature, $publicKey);
        if (!$crypto['ok']) {
            $status = $crypto['code'] === 'crypto_unavailable' ? 503 : 401;
            return self::error($crypto['code'], $crypto['message'], $status);
        }

        if ($claimNonce && !self::claim_nonce($keyId, $nonce, $expiresAt, $clockSkew)) {
            return self::error('request_replayed', 'Signed transport nonce has already been consumed', 401);
        }

        return true;
    }

    private static function header($request, string $name): string
    {
        $value = trim((string) $request->get_header($name));
        if (str_contains($value, "\n") || str_contains($value, "\r")) {
            return '';
        }
        return $value;
    }

    private static function expected_audience(): string
    {
        $configured = defined('SIMPLI_MCP_SIGNED_AUDIENCE')
            ? trim((string) constant('SIMPLI_MCP_SIGNED_AUDIENCE'))
            : '';
        $candidate = $configured !== '' ? $configured : (string) home_url('/');
        $parts = wp_parse_url($candidate);
        if (!is_array($parts) || empty($parts['scheme']) || empty($parts['host'])) {
            return '';
        }
        $audience = strtolower((string) $parts['scheme']) . '://' . strtolower((string) $parts['host']);
        if (!empty($parts['port'])) {
            $audience .= ':' . (int) $parts['port'];
        }
        return $audience;
    }

    private static function claim_nonce(string $keyId, string $nonce, int $expiresAt, int $clockSkew): bool
    {
        global $wpdb;
        if (!isset($wpdb)) {
            return false;
        }
        $table = self::table_name();
        $now = time();
        $wpdb->query($wpdb->prepare("DELETE FROM {$table} WHERE expires_at < %d", $now - $clockSkew));
        $nonceHash = hash('sha256', $keyId . "\n" . $nonce);
        $inserted = $wpdb->query($wpdb->prepare(
            "INSERT IGNORE INTO {$table} (nonce_hash, expires_at, created_at) VALUES (%s, %d, %d)",
            $nonceHash,
            $expiresAt,
            $now
        ));
        return $inserted === 1;
    }

    private static function table_name(): string
    {
        global $wpdb;
        return $wpdb->prefix . self::TABLE_SUFFIX;
    }

    private static function error(string $code, string $message, int $status)
    {
        return new WP_Error(
            'simpli_signed_transport_' . sanitize_key($code),
            $message,
            ['status' => $status]
        );
    }
}

register_activation_hook(__FILE__, [Simpli_MCP_Signed_Transport_Guard::class, 'activate']);
Simpli_MCP_Signed_Transport_Guard::bootstrap();
