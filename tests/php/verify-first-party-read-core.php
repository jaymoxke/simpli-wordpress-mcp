<?php

declare(strict_types=1);

require_once __DIR__ . '/../../wordpress-runtime/lib/first-party-read-core.php';

use InvalidArgumentException;
use function Simpli\MCP\ReadRuntime\ability_definitions;
use function Simpli\MCP\ReadRuntime\safe_ability_descriptor;
use function Simpli\MCP\ReadRuntime\sha256_canonical;
use function Simpli\MCP\ReadRuntime\tool_definitions;
use function Simpli\MCP\ReadRuntime\validate_input;

function fail_test(string $message): never
{
    fwrite(STDERR, $message . PHP_EOL);
    exit(1);
}

function assert_true(bool $condition, string $message): void
{
    if (!$condition) {
        fail_test($message);
    }
}

function assert_throws(callable $fn, string $message): void
{
    try {
        $fn();
    } catch (InvalidArgumentException $exc) {
        return;
    }
    fail_test($message);
}

$abilities = ability_definitions();
assert_true(count($abilities) === 5, 'Expected exactly five admitted read abilities');
assert_true(array_keys($abilities) === [
    'wordpress/site-info.get',
    'woocommerce/product.get',
    'woocommerce/products.query',
    'woocommerce/order.get',
    'woocommerce/orders.query',
], 'Ability admission set drifted');

foreach ($abilities as $name => $ability) {
    assert_true(($ability['readonly'] ?? false) === true, $name . ' must remain read-only');
    assert_true(
        in_array($ability['authority_class'] ?? null, ['A1_READ_AND_ANALYZE', 'A2_SENSITIVE_READ'], true),
        $name . ' must remain A1/A2 only'
    );
    $descriptor = safe_ability_descriptor($ability);
    assert_true(($descriptor['access_mode'] ?? null) === 'READ', $name . ' descriptor must remain READ');
    assert_true(($descriptor['admission_state'] ?? null) === 'ADMITTED_FIRST_PARTY_READ', $name . ' admission state drifted');
}

$tools = tool_definitions();
assert_true(array_column($tools, 'name') === [
    'simpli_self_status',
    'simpli_catalog',
    'simpli_describe',
    'simpli_execute',
], 'Top-level first-party tool set drifted');
foreach ($tools as $tool) {
    $annotations = $tool['annotations'] ?? [];
    assert_true(($annotations['readOnlyHint'] ?? false) === true, $tool['name'] . ' must be read-only');
    assert_true(($annotations['destructiveHint'] ?? true) === false, $tool['name'] . ' must not be destructive');
}

$productQuerySchema = $abilities['woocommerce/products.query']['input_schema'];
validate_input($productQuerySchema, ['limit' => 100, 'page' => 1, 'status' => 'publish']);
assert_throws(
    static fn () => validate_input($productQuerySchema, ['limit' => 101]),
    'Product query limit >100 must fail closed'
);
assert_throws(
    static fn () => validate_input($productQuerySchema, ['limit' => 10, 'unexpected' => true]),
    'Unexpected product query fields must fail closed'
);
assert_throws(
    static fn () => validate_input($productQuerySchema, ['status' => 'trash']),
    'Unadmitted product status must fail closed'
);

$productGetSchema = $abilities['woocommerce/product.get']['input_schema'];
validate_input($productGetSchema, ['id' => 1]);
assert_throws(
    static fn () => validate_input($productGetSchema, ['id' => 0]),
    'Product id <1 must fail closed'
);

$orderGetSchema = $abilities['woocommerce/order.get']['input_schema'];
assert_true(($orderGetSchema['required'] ?? []) === ['id'], 'Customer identity must remain opt-in for order.get');
validate_input($orderGetSchema, ['id' => 1]);
validate_input($orderGetSchema, ['id' => 1, 'include_customer' => true]);

$orderQuerySchema = $abilities['woocommerce/orders.query']['input_schema'];
validate_input($orderQuerySchema, ['limit' => 100, 'include_customer' => false, 'include_line_items' => false]);
assert_throws(
    static fn () => validate_input($orderQuerySchema, ['limit' => 101]),
    'Order query limit >100 must fail closed'
);

$hashA = sha256_canonical(['b' => 2, 'a' => ['y' => 2, 'x' => 1]]);
$hashB = sha256_canonical(['a' => ['x' => 1, 'y' => 2], 'b' => 2]);
assert_true($hashA === $hashB, 'Canonical hash must be key-order independent');

$coreSource = file_get_contents(__DIR__ . '/../../wordpress-runtime/lib/first-party-read-core.php');
$runtimeSource = file_get_contents(__DIR__ . '/../../wordpress-runtime/simpli-mcp-runtime.php');
assert_true(is_string($coreSource) && is_string($runtimeSource), 'Runtime sources must be readable');
foreach (['eval(', 'shell_exec(', 'exec(', 'system(', 'passthru(', 'wp_create_user(', 'wp_insert_user('] as $forbidden) {
    assert_true(stripos($coreSource . "\n" . $runtimeSource, $forbidden) === false, 'Forbidden execution primitive present: ' . $forbidden);
}

fwrite(STDOUT, "SIMPLI_FIRST_PARTY_READ_CORE_VERIFIED\n");
