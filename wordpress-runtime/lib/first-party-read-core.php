<?php
/**
 * Pure contract helpers for the first-party Simpli WordPress read runtime.
 *
 * This file intentionally has no WordPress/WooCommerce dependency so its
 * schemas and validation rules can be regression-tested in isolation.
 */

declare(strict_types=1);

namespace Simpli\MCP\ReadRuntime;

use InvalidArgumentException;

const RUNTIME_VERSION = '0.1.0-readonly';
const RUNTIME_ID = 'SIMPLI-WORDPRESS-FIRST-PARTY-READ-V1';

/** @return array<string, mixed> */
function empty_object_schema(): array
{
    return [
        'type' => 'object',
        'properties' => (object) [],
        'additionalProperties' => false,
    ];
}

/** @return array<string, array<string, mixed>> */
function ability_definitions(): array
{
    return [
        'wordpress/site-info.get' => [
            'name' => 'wordpress/site-info.get',
            'description' => 'Read a minimal current WordPress site identity and runtime snapshot.',
            'authority_class' => 'A1_READ_AND_ANALYZE',
            'readonly' => true,
            'input_schema' => empty_object_schema(),
        ],
        'woocommerce/product.get' => [
            'name' => 'woocommerce/product.get',
            'description' => 'Read one exact product including content, price, inventory, taxonomy IDs and a concurrency hash.',
            'authority_class' => 'A1_READ_AND_ANALYZE',
            'readonly' => true,
            'input_schema' => [
                'type' => 'object',
                'properties' => [
                    'id' => ['type' => 'integer', 'minimum' => 1],
                ],
                'required' => ['id'],
                'additionalProperties' => false,
            ],
        ],
        'woocommerce/products.query' => [
            'name' => 'woocommerce/products.query',
            'description' => 'Query products with bounded filters and return stable IDs plus current price/stock state.',
            'authority_class' => 'A1_READ_AND_ANALYZE',
            'readonly' => true,
            'input_schema' => [
                'type' => 'object',
                'properties' => [
                    'category' => ['type' => 'string', 'maxLength' => 200],
                    'limit' => ['type' => 'integer', 'minimum' => 1, 'maximum' => 100],
                    'page' => ['type' => 'integer', 'minimum' => 1, 'maximum' => 10000],
                    'search' => ['type' => 'string', 'maxLength' => 200],
                    'sku' => ['type' => 'string', 'maxLength' => 100],
                    'status' => [
                        'type' => 'string',
                        'enum' => ['publish', 'draft', 'pending', 'private'],
                    ],
                    'stock_status' => [
                        'type' => 'string',
                        'enum' => ['instock', 'outofstock', 'onbackorder'],
                    ],
                    'type' => [
                        'type' => 'string',
                        'enum' => ['simple', 'variable', 'grouped', 'external'],
                    ],
                ],
                'required' => [],
                'additionalProperties' => false,
            ],
        ],
        'woocommerce/order.get' => [
            'name' => 'woocommerce/order.get',
            'description' => 'Read one exact order and operational state; customer identity details are opt-in.',
            'authority_class' => 'A2_SENSITIVE_READ',
            'readonly' => true,
            'input_schema' => [
                'type' => 'object',
                'properties' => [
                    'id' => ['type' => 'integer', 'minimum' => 1],
                    'include_customer' => ['type' => 'boolean'],
                ],
                'required' => ['id'],
                'additionalProperties' => false,
            ],
        ],
        'woocommerce/orders.query' => [
            'name' => 'woocommerce/orders.query',
            'description' => 'Query orders by bounded filters; customer and line-item details are returned only when explicitly requested.',
            'authority_class' => 'A2_SENSITIVE_READ',
            'readonly' => true,
            'input_schema' => [
                'type' => 'object',
                'properties' => [
                    'billing_email' => ['type' => 'string', 'maxLength' => 320],
                    'customer_id' => ['type' => 'integer', 'minimum' => 0],
                    'id' => ['type' => 'integer', 'minimum' => 1],
                    'include_customer' => ['type' => 'boolean'],
                    'include_line_items' => ['type' => 'boolean'],
                    'limit' => ['type' => 'integer', 'minimum' => 1, 'maximum' => 100],
                    'page' => ['type' => 'integer', 'minimum' => 1, 'maximum' => 10000],
                    'status' => ['type' => 'string', 'maxLength' => 80],
                ],
                'required' => [],
                'additionalProperties' => false,
            ],
        ],
    ];
}

/** @return list<array<string, mixed>> */
function tool_definitions(): array
{
    $readAnnotations = [
        'readOnlyHint' => true,
        'destructiveHint' => false,
        'idempotentHint' => true,
        'openWorldHint' => false,
    ];

    return [
        [
            'name' => 'simpli_self_status',
            'title' => 'Simpli WordPress Runtime Status',
            'description' => 'Read first-party Simpli WordPress runtime readiness without business records.',
            'inputSchema' => empty_object_schema(),
            'annotations' => $readAnnotations,
        ],
        [
            'name' => 'simpli_catalog',
            'title' => 'Simpli WordPress Ability Catalog',
            'description' => 'List only explicitly admitted first-party WordPress read abilities.',
            'inputSchema' => empty_object_schema(),
            'annotations' => $readAnnotations,
        ],
        [
            'name' => 'simpli_describe',
            'title' => 'Describe Simpli WordPress Ability',
            'description' => 'Describe one explicitly admitted first-party WordPress read ability.',
            'inputSchema' => [
                'type' => 'object',
                'properties' => [
                    'ability_name' => ['type' => 'string', 'minLength' => 1, 'maxLength' => 191],
                ],
                'required' => ['ability_name'],
                'additionalProperties' => false,
            ],
            'annotations' => $readAnnotations,
        ],
        [
            'name' => 'simpli_execute',
            'title' => 'Execute Simpli WordPress Read',
            'description' => 'Execute exactly one admitted A1/A2 read ability. This runtime contains no mutation dispatcher.',
            'inputSchema' => [
                'type' => 'object',
                'properties' => [
                    'ability_name' => ['type' => 'string', 'minLength' => 1, 'maxLength' => 191],
                    'input' => ['type' => 'object'],
                ],
                'required' => ['ability_name', 'input'],
                'additionalProperties' => false,
            ],
            'annotations' => $readAnnotations,
        ],
    ];
}

/**
 * Return a stable, recursively key-sorted representation for hashing.
 * Lists preserve caller order; object/map keys are sorted lexicographically.
 *
 * @param mixed $value
 * @return mixed
 */
function canonicalize($value)
{
    if (!is_array($value)) {
        return $value;
    }

    $isList = array_keys($value) === range(0, count($value) - 1);
    if ($isList) {
        return array_map(__NAMESPACE__ . '\\canonicalize', $value);
    }

    ksort($value, SORT_STRING);
    foreach ($value as $key => $item) {
        $value[$key] = canonicalize($item);
    }
    return $value;
}

/** @param mixed $value */
function sha256_canonical($value): string
{
    $encoded = json_encode(canonicalize($value), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION);
    if (!is_string($encoded)) {
        throw new InvalidArgumentException('Unable to canonicalize value');
    }
    return hash('sha256', $encoded);
}

/** @param mixed $value */
function value_matches_type($value, string $type): bool
{
    switch ($type) {
        case 'object':
            return is_array($value) && array_keys($value) !== range(0, count($value) - 1);
        case 'array':
            return is_array($value) && array_keys($value) === range(0, count($value) - 1);
        case 'string':
            return is_string($value);
        case 'integer':
            return is_int($value);
        case 'number':
            return is_int($value) || is_float($value);
        case 'boolean':
            return is_bool($value);
        case 'null':
            return $value === null;
        default:
            return false;
    }
}

/**
 * Small deterministic JSON-Schema subset used by the admitted read runtime.
 *
 * @param array<string, mixed> $schema
 * @param mixed $value
 */
function validate_input(array $schema, $value, string $path = 'input'): void
{
    $type = $schema['type'] ?? null;
    if (is_string($type) && !value_matches_type($value, $type)) {
        throw new InvalidArgumentException($path . ' must be ' . $type);
    }

    if (isset($schema['enum']) && is_array($schema['enum']) && !in_array($value, $schema['enum'], true)) {
        throw new InvalidArgumentException($path . ' is not in the admitted enum');
    }

    if (is_string($value)) {
        $length = function_exists('mb_strlen') ? mb_strlen($value, 'UTF-8') : strlen($value);
        if (isset($schema['minLength']) && is_int($schema['minLength']) && $length < $schema['minLength']) {
            throw new InvalidArgumentException($path . ' is too short');
        }
        if (isset($schema['maxLength']) && is_int($schema['maxLength']) && $length > $schema['maxLength']) {
            throw new InvalidArgumentException($path . ' is too long');
        }
    }

    if ((is_int($value) || is_float($value)) && !is_bool($value)) {
        if (isset($schema['minimum']) && is_numeric($schema['minimum']) && $value < $schema['minimum']) {
            throw new InvalidArgumentException($path . ' is below the minimum');
        }
        if (isset($schema['maximum']) && is_numeric($schema['maximum']) && $value > $schema['maximum']) {
            throw new InvalidArgumentException($path . ' is above the maximum');
        }
    }

    if (is_array($value) && value_matches_type($value, 'object')) {
        $properties = isset($schema['properties']) && is_array($schema['properties']) ? $schema['properties'] : [];
        $required = isset($schema['required']) && is_array($schema['required']) ? $schema['required'] : [];
        foreach ($required as $requiredKey) {
            if (is_string($requiredKey) && !array_key_exists($requiredKey, $value)) {
                throw new InvalidArgumentException($path . ' is missing ' . $requiredKey);
            }
        }
        if (($schema['additionalProperties'] ?? null) === false) {
            $extra = array_diff(array_keys($value), array_keys($properties));
            if ($extra !== []) {
                sort($extra, SORT_STRING);
                throw new InvalidArgumentException($path . ' has unsupported fields: ' . implode(',', $extra));
            }
        }
        foreach ($value as $key => $item) {
            if (isset($properties[$key]) && is_array($properties[$key])) {
                validate_input($properties[$key], $item, $path . '.' . (string) $key);
            }
        }
    }

    if (is_array($value) && value_matches_type($value, 'array') && isset($schema['items']) && is_array($schema['items'])) {
        foreach ($value as $index => $item) {
            validate_input($schema['items'], $item, $path . '[' . (string) $index . ']');
        }
    }
}

/** @return array<string, mixed> */
function safe_ability_descriptor(array $ability): array
{
    $schema = isset($ability['input_schema']) && is_array($ability['input_schema']) ? $ability['input_schema'] : empty_object_schema();
    return [
        'name' => (string) ($ability['name'] ?? ''),
        'description' => (string) ($ability['description'] ?? ''),
        'authority_class' => (string) ($ability['authority_class'] ?? ''),
        'readonly' => true,
        'access_mode' => 'READ',
        'input_schema' => $schema,
        'schema_sha256' => sha256_canonical($schema),
        'admission_state' => 'ADMITTED_FIRST_PARTY_READ',
    ];
}

/** @param mixed $id @param mixed $data @return array<string, mixed> */
function rpc_success($id, $data): array
{
    $text = json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if (!is_string($text)) {
        $text = '{}';
    }
    return [
        'jsonrpc' => '2.0',
        'id' => $id,
        'result' => [
            'resultType' => 'complete',
            'content' => [['type' => 'text', 'text' => $text]],
            'structuredContent' => $data,
            'isError' => false,
        ],
    ];
}

/** @param mixed $id @return array<string, mixed> */
function rpc_error($id, int $code, string $message, array $data = []): array
{
    $error = ['code' => $code, 'message' => $message];
    if ($data !== []) {
        $error['data'] = $data;
    }
    return ['jsonrpc' => '2.0', 'id' => $id, 'error' => $error];
}
