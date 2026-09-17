<?php
/**
 * Plugin Name: Simpli MCP First-Party Read Runtime
 * Description: First-party, read-only Simpli WordPress/WooCommerce MCP backend for the fixed Simpli MCP gateway route.
 * Version: 0.1.0
 * Author: Simpli Cosmetics Kenya
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

require_once __DIR__ . '/lib/first-party-read-core.php';

use InvalidArgumentException;
use Throwable;
use function Simpli\MCP\ReadRuntime\ability_definitions;
use function Simpli\MCP\ReadRuntime\rpc_error;
use function Simpli\MCP\ReadRuntime\rpc_success;
use function Simpli\MCP\ReadRuntime\safe_ability_descriptor;
use function Simpli\MCP\ReadRuntime\sha256_canonical;
use function Simpli\MCP\ReadRuntime\tool_definitions;
use function Simpli\MCP\ReadRuntime\validate_input;
use const Simpli\MCP\ReadRuntime\RUNTIME_ID;
use const Simpli\MCP\ReadRuntime\RUNTIME_VERSION;

final class Simpli_MCP_First_Party_Read_Runtime
{
    private const REST_NAMESPACE = 'simpli-mcp/v1';
    private const REST_ROUTE = '/mcp';
    private const MAX_RESPONSE_BYTES = 524288;

    public static function bootstrap(): void
    {
        add_action('rest_api_init', [self::class, 'register_route']);
    }

    public static function register_route(): void
    {
        register_rest_route(
            self::REST_NAMESPACE,
            self::REST_ROUTE,
            [
                'methods' => 'POST',
                'callback' => [self::class, 'dispatch'],
                'permission_callback' => [self::class, 'permission'],
            ]
        );
    }

    /**
     * Authentication and business authority stay separate.
     *
     * Default/staged mode requires an authenticated WordPress Application
     * Password user with WooCommerce-management authority. Signed-only mode is
     * explicit and can be enabled only after the separate Ed25519 transport
     * guard has verified this exact request.
     *
     * @param WP_REST_Request $request
     * @return true|WP_Error
     */
    public static function permission($request)
    {
        if (self::signed_only_mode()) {
            if (
                class_exists('Simpli_MCP_Signed_Transport_Guard')
                && Simpli_MCP_Signed_Transport_Guard::is_verified_request($request)
            ) {
                return true;
            }
            return new WP_Error(
                'simpli_mcp_signed_identity_required',
                'Verified Simpli MCP machine identity is required.',
                ['status' => 401]
            );
        }

        if (is_user_logged_in() && (current_user_can('manage_woocommerce') || current_user_can('manage_options'))) {
            return true;
        }

        return new WP_Error(
            'simpli_mcp_wordpress_auth_required',
            'An authenticated WordPress user with WooCommerce management permission is required.',
            ['status' => 401]
        );
    }

    private static function signed_only_mode(): bool
    {
        return defined('SIMPLI_MCP_RUNTIME_SIGNED_ONLY')
            && constant('SIMPLI_MCP_RUNTIME_SIGNED_ONLY') === true;
    }

    /** @param WP_REST_Request $request @return WP_REST_Response */
    public static function dispatch($request)
    {
        $payload = $request->get_json_params();
        if (!is_array($payload)) {
            return self::response(rpc_error(null, -32700, 'Parse error'));
        }

        $requestId = array_key_exists('id', $payload) ? $payload['id'] : null;
        if (($payload['jsonrpc'] ?? null) !== '2.0' || !isset($payload['method']) || !is_string($payload['method'])) {
            return self::response(rpc_error($requestId, -32600, 'Invalid JSON-RPC request'));
        }

        try {
            if ($payload['method'] === 'tools/list') {
                return self::response([
                    'jsonrpc' => '2.0',
                    'id' => $requestId,
                    'result' => [
                        'tools' => tool_definitions(),
                        'resultType' => 'complete',
                        'cacheScope' => 'runtime-release',
                    ],
                ]);
            }

            if ($payload['method'] !== 'tools/call') {
                return self::response(rpc_error($requestId, -32601, 'Method not found'));
            }

            $params = $payload['params'] ?? null;
            if (!is_array($params) || !isset($params['name']) || !is_string($params['name'])) {
                return self::response(rpc_error($requestId, -32602, 'tools/call requires a tool name'));
            }
            $arguments = $params['arguments'] ?? [];
            if (!is_array($arguments)) {
                return self::response(rpc_error($requestId, -32602, 'Tool arguments must be an object'));
            }

            return self::response(self::call_tool($requestId, $params['name'], $arguments));
        } catch (InvalidArgumentException $exc) {
            return self::response(rpc_error($requestId, -32602, $exc->getMessage()));
        } catch (Throwable $exc) {
            error_log('[simpli-mcp] first-party read runtime error: ' . get_class($exc));
            return self::response(rpc_error($requestId, -32603, 'First-party WordPress runtime failed closed'));
        }
    }

    /** @param mixed $requestId @param array<string,mixed> $arguments @return array<string,mixed> */
    private static function call_tool($requestId, string $name, array $arguments): array
    {
        $tools = [];
        foreach (tool_definitions() as $tool) {
            $tools[(string) $tool['name']] = $tool;
        }
        if (!isset($tools[$name])) {
            return rpc_error($requestId, -32601, 'Unknown Simpli MCP tool');
        }

        $schema = isset($tools[$name]['inputSchema']) && is_array($tools[$name]['inputSchema'])
            ? $tools[$name]['inputSchema']
            : ['type' => 'object'];
        validate_input($schema, $arguments, 'arguments');

        if ($name === 'simpli_self_status') {
            return rpc_success($requestId, self::self_status());
        }
        if ($name === 'simpli_catalog') {
            return rpc_success($requestId, self::catalog());
        }
        if ($name === 'simpli_describe') {
            return rpc_success($requestId, self::describe((string) $arguments['ability_name']));
        }
        if ($name === 'simpli_execute') {
            $abilityName = (string) $arguments['ability_name'];
            $input = $arguments['input'];
            if (!is_array($input)) {
                throw new InvalidArgumentException('arguments.input must be an object');
            }
            return rpc_success($requestId, self::execute_read($abilityName, $input));
        }

        return rpc_error($requestId, -32601, 'Unknown Simpli MCP tool');
    }

    /** @return array<string,mixed> */
    private static function self_status(): array
    {
        $woocommerceReady = class_exists('WooCommerce') && function_exists('wc_get_product') && function_exists('wc_get_order');
        return [
            'state' => $woocommerceReady ? 'STATE_VERIFIED' : 'DEPENDENCY_UNAVAILABLE',
            'service' => 'simpli-wordpress-first-party-read-runtime',
            'version' => RUNTIME_VERSION,
            'runtime_id' => RUNTIME_ID,
            'novamira_dependency' => false,
            'execution_mode' => 'READ_ONLY',
            'signed_only_mode' => self::signed_only_mode(),
            'woocommerce_ready' => $woocommerceReady,
            'admitted_abilities' => count(ability_definitions()),
            'admitted_write_abilities' => 0,
            'write_plane_ready' => false,
            'mutation_dispatcher_present' => false,
        ];
    }

    /** @return array<string,mixed> */
    private static function catalog(): array
    {
        $abilities = [];
        foreach (ability_definitions() as $ability) {
            $abilities[] = safe_ability_descriptor($ability);
        }
        return [
            'state' => 'STATE_VERIFIED',
            'runtime_id' => RUNTIME_ID,
            'novamira_dependency' => false,
            'ability_count' => count($abilities),
            'write_ability_count' => 0,
            'abilities' => $abilities,
            'catalog_sha256' => sha256_canonical($abilities),
        ];
    }

    /** @return array<string,mixed> */
    private static function describe(string $abilityName): array
    {
        $abilities = ability_definitions();
        if (!isset($abilities[$abilityName])) {
            throw new InvalidArgumentException('Ability is not admitted by the first-party read runtime');
        }
        return safe_ability_descriptor($abilities[$abilityName]);
    }

    /** @param array<string,mixed> $input @return array<string,mixed> */
    private static function execute_read(string $abilityName, array $input): array
    {
        $abilities = ability_definitions();
        if (!isset($abilities[$abilityName])) {
            throw new InvalidArgumentException('Ability is not admitted by the first-party read runtime');
        }
        $ability = $abilities[$abilityName];
        if (($ability['readonly'] ?? null) !== true) {
            throw new InvalidArgumentException('Mutation abilities are not admitted by this runtime');
        }
        $authorityClass = (string) ($ability['authority_class'] ?? '');
        if (!in_array($authorityClass, ['A1_READ_AND_ANALYZE', 'A2_SENSITIVE_READ'], true)) {
            throw new InvalidArgumentException('Ability authority class is not admitted by this runtime');
        }
        $schema = isset($ability['input_schema']) && is_array($ability['input_schema'])
            ? $ability['input_schema']
            : ['type' => 'object'];
        validate_input($schema, $input, 'input');

        if ($abilityName === 'wordpress/site-info.get') {
            return self::site_info();
        }
        self::require_woocommerce();
        if ($abilityName === 'woocommerce/product.get') {
            return self::product_get((int) $input['id']);
        }
        if ($abilityName === 'woocommerce/products.query') {
            return self::products_query($input);
        }
        if ($abilityName === 'woocommerce/order.get') {
            return self::order_get((int) $input['id'], (bool) ($input['include_customer'] ?? false));
        }
        if ($abilityName === 'woocommerce/orders.query') {
            return self::orders_query($input);
        }

        throw new InvalidArgumentException('Ability handler is unavailable');
    }

    private static function require_woocommerce(): void
    {
        if (!class_exists('WooCommerce') || !function_exists('wc_get_product') || !function_exists('wc_get_order')) {
            throw new RuntimeException('WooCommerce dependency is unavailable');
        }
    }

    /** @return array<string,mixed> */
    private static function site_info(): array
    {
        global $wp_version;
        return [
            'state' => 'STATE_VERIFIED',
            'site' => [
                'name' => (string) get_bloginfo('name'),
                'description' => (string) get_bloginfo('description'),
                'home_url' => (string) home_url('/'),
                'site_url' => (string) site_url('/'),
                'locale' => (string) get_locale(),
                'timezone' => (string) wp_timezone_string(),
                'multisite' => is_multisite(),
            ],
            'runtime' => [
                'wordpress_version' => is_string($wp_version) ? $wp_version : null,
                'woocommerce_version' => defined('WC_VERSION') ? (string) constant('WC_VERSION') : null,
                'php_version' => PHP_VERSION,
            ],
            'novamira_dependency' => false,
            'write_effect' => 'NONE',
        ];
    }

    /** @return array<string,mixed> */
    private static function product_get(int $id): array
    {
        $product = wc_get_product($id);
        if (!$product || !is_a($product, 'WC_Product')) {
            throw new InvalidArgumentException('Product was not found');
        }
        return self::product_snapshot($product, true);
    }

    /** @param WC_Product $product @return array<string,mixed> */
    private static function product_snapshot($product, bool $includeContent): array
    {
        $id = (int) $product->get_id();
        $categoryIds = wp_get_post_terms($id, 'product_cat', ['fields' => 'ids']);
        $tagIds = wp_get_post_terms($id, 'product_tag', ['fields' => 'ids']);
        $categoryIds = is_wp_error($categoryIds) ? [] : array_values(array_map('intval', $categoryIds));
        $tagIds = is_wp_error($tagIds) ? [] : array_values(array_map('intval', $tagIds));

        $material = [
            'id' => $id,
            'type' => (string) $product->get_type(),
            'status' => (string) $product->get_status(),
            'name' => (string) $product->get_name(),
            'slug' => (string) $product->get_slug(),
            'sku' => (string) $product->get_sku(),
            'price' => (string) $product->get_price(),
            'regular_price' => (string) $product->get_regular_price(),
            'sale_price' => (string) $product->get_sale_price(),
            'currency' => function_exists('get_woocommerce_currency') ? (string) get_woocommerce_currency() : null,
            'manage_stock' => (bool) $product->get_manage_stock(),
            'stock_quantity' => $product->get_stock_quantity() === null ? null : (int) $product->get_stock_quantity(),
            'stock_status' => (string) $product->get_stock_status(),
            'backorders' => (string) $product->get_backorders(),
            'category_ids' => $categoryIds,
            'tag_ids' => $tagIds,
            'date_created' => self::wc_datetime($product->get_date_created()),
            'date_modified' => self::wc_datetime($product->get_date_modified()),
        ];
        $material['concurrency_hash'] = sha256_canonical($material);
        if ($includeContent) {
            $material['permalink'] = (string) get_permalink($id);
            $material['description'] = (string) $product->get_description();
            $material['short_description'] = (string) $product->get_short_description();
        }
        return $material;
    }

    /** @param array<string,mixed> $input @return array<string,mixed> */
    private static function products_query(array $input): array
    {
        $limit = (int) ($input['limit'] ?? 20);
        $page = (int) ($input['page'] ?? 1);
        $args = [
            'post_type' => 'product',
            'post_status' => isset($input['status']) ? (string) $input['status'] : ['publish', 'draft', 'pending', 'private'],
            'posts_per_page' => $limit,
            'paged' => $page,
            'fields' => 'ids',
            'orderby' => 'ID',
            'order' => 'ASC',
            'no_found_rows' => false,
        ];
        if (isset($input['search']) && $input['search'] !== '') {
            $args['s'] = (string) $input['search'];
        }

        $metaQuery = [];
        if (isset($input['sku']) && $input['sku'] !== '') {
            $metaQuery[] = ['key' => '_sku', 'value' => (string) $input['sku'], 'compare' => '='];
        }
        if (isset($input['stock_status'])) {
            $metaQuery[] = ['key' => '_stock_status', 'value' => (string) $input['stock_status'], 'compare' => '='];
        }
        if ($metaQuery !== []) {
            $args['meta_query'] = $metaQuery;
        }

        $taxQuery = [];
        if (isset($input['category']) && $input['category'] !== '') {
            $taxQuery[] = [
                'taxonomy' => 'product_cat',
                'field' => 'slug',
                'terms' => [(string) $input['category']],
            ];
        }
        if (isset($input['type'])) {
            $taxQuery[] = [
                'taxonomy' => 'product_type',
                'field' => 'slug',
                'terms' => [(string) $input['type']],
            ];
        }
        if ($taxQuery !== []) {
            if (count($taxQuery) > 1) {
                $taxQuery['relation'] = 'AND';
            }
            $args['tax_query'] = $taxQuery;
        }

        $query = new WP_Query($args);
        $rows = [];
        foreach ($query->posts as $productId) {
            $product = wc_get_product((int) $productId);
            if ($product && is_a($product, 'WC_Product')) {
                $rows[] = self::product_snapshot($product, false);
            }
        }

        return [
            'state' => 'STATE_VERIFIED',
            'page' => $page,
            'limit' => $limit,
            'total' => (int) $query->found_posts,
            'total_pages' => (int) $query->max_num_pages,
            'products' => $rows,
            'write_effect' => 'NONE',
        ];
    }

    /** @return array<string,mixed> */
    private static function order_get(int $id, bool $includeCustomer): array
    {
        $order = wc_get_order($id);
        if (!$order || !is_a($order, 'WC_Order')) {
            throw new InvalidArgumentException('Order was not found');
        }
        return self::order_snapshot($order, $includeCustomer, true);
    }

    /** @param WC_Order $order @return array<string,mixed> */
    private static function order_snapshot($order, bool $includeCustomer, bool $includeLineItems): array
    {
        $lineItems = [];
        foreach ($order->get_items('line_item') as $itemId => $item) {
            $lineItems[] = [
                'item_id' => (int) $itemId,
                'product_id' => (int) $item->get_product_id(),
                'variation_id' => (int) $item->get_variation_id(),
                'name' => (string) $item->get_name(),
                'quantity' => (int) $item->get_quantity(),
                'subtotal' => (string) $item->get_subtotal(),
                'total' => (string) $item->get_total(),
            ];
        }

        $concurrencyMaterial = [
            'id' => (int) $order->get_id(),
            'status' => (string) $order->get_status(),
            'currency' => (string) $order->get_currency(),
            'total' => (string) $order->get_total(),
            'shipping_total' => (string) $order->get_shipping_total(),
            'discount_total' => (string) $order->get_discount_total(),
            'total_tax' => (string) $order->get_total_tax(),
            'payment_method' => (string) $order->get_payment_method(),
            'shipping_method' => (string) $order->get_shipping_method(),
            'date_created' => self::wc_datetime($order->get_date_created()),
            'date_modified' => self::wc_datetime($order->get_date_modified()),
            'date_paid' => self::wc_datetime($order->get_date_paid()),
            'date_completed' => self::wc_datetime($order->get_date_completed()),
            'line_items' => $lineItems,
        ];

        $result = $concurrencyMaterial;
        $result['concurrency_hash'] = sha256_canonical($concurrencyMaterial);
        if (!$includeLineItems) {
            unset($result['line_items']);
        }
        if ($includeCustomer) {
            $result['customer'] = [
                'customer_id' => (int) $order->get_customer_id(),
                'billing_first_name' => (string) $order->get_billing_first_name(),
                'billing_last_name' => (string) $order->get_billing_last_name(),
                'billing_email' => (string) $order->get_billing_email(),
                'billing_phone' => (string) $order->get_billing_phone(),
            ];
        }
        return $result;
    }

    /** @param array<string,mixed> $input @return array<string,mixed> */
    private static function orders_query(array $input): array
    {
        if (!function_exists('wc_get_orders')) {
            throw new RuntimeException('WooCommerce order query API is unavailable');
        }
        $limit = (int) ($input['limit'] ?? 20);
        $page = (int) ($input['page'] ?? 1);
        $args = [
            'limit' => $limit,
            'page' => $page,
            'paginate' => true,
            'orderby' => 'ID',
            'order' => 'ASC',
            'return' => 'objects',
        ];
        if (isset($input['status']) && $input['status'] !== '') {
            $args['status'] = (string) $input['status'];
        }
        if (isset($input['customer_id'])) {
            $args['customer_id'] = (int) $input['customer_id'];
        }
        if (isset($input['billing_email']) && $input['billing_email'] !== '') {
            $args['billing_email'] = (string) $input['billing_email'];
        }
        if (isset($input['id'])) {
            $args['include'] = [(int) $input['id']];
        }

        $result = wc_get_orders($args);
        $orders = is_object($result) && isset($result->orders) && is_array($result->orders)
            ? $result->orders
            : (is_array($result) ? $result : []);
        $rows = [];
        $includeCustomer = (bool) ($input['include_customer'] ?? false);
        $includeLineItems = (bool) ($input['include_line_items'] ?? false);
        foreach ($orders as $order) {
            if ($order && is_a($order, 'WC_Order')) {
                $rows[] = self::order_snapshot($order, $includeCustomer, $includeLineItems);
            }
        }

        $total = is_object($result) && isset($result->total) ? (int) $result->total : count($rows);
        $maxPages = is_object($result) && isset($result->max_num_pages) ? (int) $result->max_num_pages : 1;
        return [
            'state' => 'STATE_VERIFIED',
            'page' => $page,
            'limit' => $limit,
            'total' => $total,
            'total_pages' => $maxPages,
            'orders' => $rows,
            'customer_details_included' => $includeCustomer,
            'line_items_included' => $includeLineItems,
            'write_effect' => 'NONE',
        ];
    }

    /** @param mixed $value */
    private static function wc_datetime($value): ?string
    {
        if (is_object($value) && method_exists($value, 'date')) {
            return (string) $value->date(DATE_ATOM);
        }
        return null;
    }

    /** @param array<string,mixed> $payload @return WP_REST_Response */
    private static function response(array $payload)
    {
        $encoded = wp_json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if (!is_string($encoded) || strlen($encoded) > self::MAX_RESPONSE_BYTES) {
            $payload = rpc_error(
                $payload['id'] ?? null,
                -32003,
                'First-party WordPress runtime response exceeded the safety limit'
            );
        }
        $response = rest_ensure_response($payload);
        $response->header('Cache-Control', 'no-store');
        $response->header('X-Simpli-WordPress-Runtime', RUNTIME_ID);
        return $response;
    }
}

Simpli_MCP_First_Party_Read_Runtime::bootstrap();
