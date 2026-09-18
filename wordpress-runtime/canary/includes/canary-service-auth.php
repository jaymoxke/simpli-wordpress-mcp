<?php

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

require_once __DIR__ . '/canary-service-auth-core.php';

use function Simpli\MCP\CanaryServiceAuth\verify_request;
use const Simpli\MCP\CanaryServiceAuth\CANARY_ROUTE;

final class Simpli_MCP_Canary_Service_Auth
{
    private const DEFAULT_KEY_ID = 'sc-wordpress-mcp-v1';
    private const DEFAULT_PUBLIC_KEY_B64URL = 'Dhj_EaSmJ5WGa7Sf_l4O2YD6fYUAx8n2H0us55DeCYo';
    private const NONCE_TTL_SECONDS = 180;

    /**
     * @return true|WP_Error|null
     * null means no paired-service authentication was attempted.
     */
    public static function authorize($request)
    {
        if (!is_object($request) || !method_exists($request, 'get_header')) {
            return null;
        }

        $headers = [
            'version' => trim((string) $request->get_header('x-simpli-service-version')),
            'key_id' => trim((string) $request->get_header('x-simpli-service-key-id')),
            'timestamp' => trim((string) $request->get_header('x-simpli-service-timestamp')),
            'nonce' => trim((string) $request->get_header('x-simpli-service-nonce')),
            'body_sha256' => strtolower(trim((string) $request->get_header('x-simpli-service-body-sha256'))),
            'signature' => trim((string) $request->get_header('x-simpli-service-signature')),
        ];

        $attempted = implode('', $headers) !== '';
        if (!$attempted) {
            return null;
        }

        if (
            !method_exists($request, 'get_method')
            || !method_exists($request, 'get_route')
            || strtoupper((string) $request->get_method()) !== 'POST'
            || (string) $request->get_route() !== CANARY_ROUTE
        ) {
            return new WP_Error(
                'simpli_mcp_canary_service_target_invalid',
                'Paired SuperComputer service request target is invalid.',
                ['status' => 401]
            );
        }

        $keyId = defined('SIMPLI_MCP_SUPERCOMPUTER_SERVICE_KEY_ID')
            ? trim((string) constant('SIMPLI_MCP_SUPERCOMPUTER_SERVICE_KEY_ID'))
            : self::DEFAULT_KEY_ID;
        $publicKey = defined('SIMPLI_MCP_SUPERCOMPUTER_SERVICE_PUBLIC_KEY')
            ? trim((string) constant('SIMPLI_MCP_SUPERCOMPUTER_SERVICE_PUBLIC_KEY'))
            : self::DEFAULT_PUBLIC_KEY_B64URL;

        if ($keyId === '' || $publicKey === '') {
            return new WP_Error(
                'simpli_mcp_canary_service_not_paired',
                'Paired SuperComputer service authentication is not configured.',
                ['status' => 401]
            );
        }

        $clockSkew = defined('SIMPLI_MCP_CANARY_SERVICE_CLOCK_SKEW_SECONDS')
            ? (int) constant('SIMPLI_MCP_CANARY_SERVICE_CLOCK_SKEW_SECONDS')
            : 90;
        $verification = verify_request(
            $headers,
            (string) $request->get_body(),
            $keyId,
            $publicKey,
            null,
            $clockSkew
        );
        if (!$verification['ok']) {
            $status = $verification['code'] === 'crypto_unavailable' ? 503 : 401;
            return new WP_Error(
                'simpli_mcp_canary_service_' . sanitize_key($verification['code']),
                $verification['message'],
                ['status' => $status]
            );
        }

        $replayKey = 'smcp_canary_svc_' . substr(
            hash(
                'sha256',
                wp_salt('auth') . '|' . $headers['key_id'] . '|' . $headers['timestamp'] . '|' . $headers['nonce']
            ),
            0,
            40
        );
        if (get_transient($replayKey) !== false) {
            return new WP_Error(
                'simpli_mcp_canary_service_replay',
                'Paired SuperComputer service request replay was blocked.',
                ['status' => 409]
            );
        }
        set_transient($replayKey, 1, self::NONCE_TTL_SECONDS);

        $user = self::service_principal();
        if (!$user instanceof WP_User) {
            return new WP_Error(
                'simpli_mcp_canary_service_user_unavailable',
                'No authorized WordPress service principal is available.',
                ['status' => 503]
            );
        }

        wp_set_current_user((int) $user->ID);
        return true;
    }

    private static function service_principal()
    {
        $configuredId = defined('SIMPLI_MCP_SERVICE_USER_ID')
            ? (int) constant('SIMPLI_MCP_SERVICE_USER_ID')
            : 0;

        if ($configuredId > 0) {
            $user = get_userdata($configuredId);
            if (
                $user instanceof WP_User
                && (user_can($user, 'manage_woocommerce') || user_can($user, 'manage_options'))
            ) {
                return $user;
            }
        }

        foreach (['manage_woocommerce', 'manage_options'] as $capability) {
            $users = get_users([
                'capability' => $capability,
                'number' => 1,
                'orderby' => 'ID',
                'order' => 'ASC',
                'fields' => 'ids',
            ]);
            $userId = isset($users[0]) ? (int) $users[0] : 0;
            $user = $userId > 0 ? get_userdata($userId) : false;
            if ($user instanceof WP_User && user_can($user, $capability)) {
                return $user;
            }
        }

        return false;
    }
}
