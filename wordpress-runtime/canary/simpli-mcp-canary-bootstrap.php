<?php
/**
 * Plugin Name: Simpli MCP First-Party Canary Bootstrap
 * Description: Isolated read-only canary route for validating the first-party Simpli MCP WordPress runtime without taking over the production /simpli-mcp/v1 route.
 * Version: 0.1.0-canary.1
 * Author: Simpli Cosmetics Kenya
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

$runtime = __DIR__ . '/includes/simpli-mcp-runtime.php';
if (!is_file($runtime)) {
    add_action('admin_notices', static function (): void {
        echo '<div class="notice notice-error"><p>Simpli MCP Canary: packaged runtime implementation is missing.</p></div>';
    });
    return;
}

require_once $runtime;

if (!class_exists('Simpli_MCP_First_Party_Read_Runtime')) {
    return;
}

// The packaged implementation normally registers the production v1 route.
// Remove that registration before rest_api_init fires, then expose only the
// isolated canary namespace. This makes activation reversible and prevents a
// canary install from silently taking over the production backend route.
remove_action('rest_api_init', [Simpli_MCP_First_Party_Read_Runtime::class, 'register_route']);

final class Simpli_MCP_First_Party_Canary_Bootstrap
{
    private const REST_NAMESPACE = 'simpli-mcp-canary/v1';
    private const REST_ROUTE = '/mcp';

    public static function register_route(): void
    {
        register_rest_route(
            self::REST_NAMESPACE,
            self::REST_ROUTE,
            [
                'methods' => 'POST',
                'callback' => [Simpli_MCP_First_Party_Read_Runtime::class, 'dispatch'],
                'permission_callback' => [Simpli_MCP_First_Party_Read_Runtime::class, 'permission'],
            ]
        );
    }
}

add_action('rest_api_init', [Simpli_MCP_First_Party_Canary_Bootstrap::class, 'register_route']);
