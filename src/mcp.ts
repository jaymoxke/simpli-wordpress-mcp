import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { AppConfig } from "./config.js";
import type { AuthContext } from "./oauth.js";
import { requireScope } from "./oauth.js";
import type { Logger } from "./logger.js";
import {
  abilityToToolName,
  getAbilityAnnotations,
  getAbilityInputSchema,
  WordPressClient,
  WordPressRequestError,
  type JsonSchema,
  type WordPressAbility,
} from "./wordpress.js";

const DISCOVER_TOOL = "wordpress_discover_abilities";
const GET_ABILITY_TOOL = "wordpress_get_ability";
const REFRESH_TOOL = "wordpress_refresh_ability_catalog";

function withDangerousConfirmation(schema: JsonSchema, abilityName: string): JsonSchema {
  const confirmation = `RUN ${abilityName}`;
  return {
    ...schema,
    type: "object",
    properties: {
      ...(schema.properties ?? {}),
      _confirm: {
        type: "string",
        const: confirmation,
        description: `Required safety acknowledgement. Must equal exactly: ${confirmation}`,
      },
    },
    required: [...new Set([...(schema.required ?? []), "_confirm"])],
  };
}

function descriptionFor(ability: WordPressAbility): string {
  const annotations = getAbilityAnnotations(ability);
  const parts = [
    `WordPress Ability: ${ability.name}.`,
    ability.description ?? ability.label ?? "Run this WordPress ability.",
  ];
  if (annotations.instructions) parts.push(`Instructions: ${annotations.instructions}`);
  if (annotations.destructive) {
    parts.push(`This is destructive or privileged. The _confirm field must equal "RUN ${ability.name}".`);
  }
  return parts.join(" ").slice(0, 12000);
}

export function abilityToMcpTool(ability: WordPressAbility): Tool {
  const annotations = getAbilityAnnotations(ability);
  const baseSchema = getAbilityInputSchema(ability);
  return {
    name: abilityToToolName(ability.name),
    title: ability.label ?? ability.name,
    description: descriptionFor(ability),
    inputSchema: (annotations.destructive
      ? withDangerousConfirmation(baseSchema, ability.name)
      : baseSchema) as Tool["inputSchema"],
    annotations: {
      title: ability.label ?? ability.name,
      readOnlyHint: annotations.readonly,
      destructiveHint: annotations.destructive,
      idempotentHint: annotations.idempotent,
      openWorldHint: !annotations.readonly,
    },
    _meta: {
      "simpli/abilityName": ability.name,
      "simpli/category": ability.category ?? "uncategorized",
    },
  };
}

const gatewayTools: Tool[] = [
  {
    name: DISCOVER_TOOL,
    title: "Discover WordPress abilities",
    description:
      "List the live WordPress abilities mirrored by this gateway. Use filters to find the correct Novamira, WooCommerce, Elementor, ACF, Rank Math, WPForms, Gutenberg, file, PHP, WP-CLI, memory, or skill capability before calling it.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Case-insensitive search across name, label, and description." },
        namespace: { type: "string", description: "Ability namespace, such as novamira or woocommerce." },
        category: { type: "string", description: "Category slug, such as woocommerce, elementor, acf, or rank-math." },
        safety: {
          type: "string",
          enum: ["all", "readonly", "write", "destructive"],
          default: "all",
        },
        include_schemas: { type: "boolean", default: false },
        force_refresh: { type: "boolean", default: false },
      },
      additionalProperties: false,
    },
    annotations: {
      title: "Discover WordPress abilities",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: GET_ABILITY_TOOL,
    title: "Get WordPress ability",
    description: "Get the complete live definition, JSON schemas, safety annotations, and mapped MCP tool name for one WordPress ability.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Exact ability name, for example novamira/execute-php." } },
      required: ["name"],
      additionalProperties: false,
    },
    annotations: {
      title: "Get WordPress ability",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: REFRESH_TOOL,
    title: "Refresh WordPress ability catalog",
    description: "Force a fresh discovery of the WordPress Abilities API after plugins, themes, or Novamira capabilities change.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: {
      title: "Refresh WordPress ability catalog",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
];

function textResult(value: unknown, maxBytes: number, label?: string): CallToolResult {
  const serialized = JSON.stringify(value, null, 2) ?? "null";
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes <= maxBytes) {
    return {
      content: [{ type: "text", text: label ? `${label}\n${serialized}` : serialized }],
      structuredContent: { result: value },
    };
  }
  const preview = Buffer.from(serialized, "utf8").subarray(0, maxBytes).toString("utf8");
  return {
    content: [
      {
        type: "text",
        text: `${label ? `${label}\n` : ""}${preview}\n\n[Output truncated: ${bytes} bytes total; limit ${maxBytes} bytes.]`,
      },
    ],
    structuredContent: { truncated: true, byteCount: bytes, limitBytes: maxBytes, preview },
  };
}

function errorResult(error: unknown, maxBytes: number): CallToolResult {
  const payload =
    error instanceof WordPressRequestError
      ? { error: error.message, status: error.status, details: error.details }
      : { error: error instanceof Error ? error.message : String(error) };
  const result = textResult(payload, maxBytes);
  return { ...result, isError: true };
}

function asArguments(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Tool arguments must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function requiredString(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value;
}

function filterAbilities(abilities: WordPressAbility[], args: Record<string, unknown>): WordPressAbility[] {
  const search = typeof args.search === "string" ? args.search.toLowerCase() : undefined;
  const namespace = typeof args.namespace === "string" ? args.namespace.toLowerCase() : undefined;
  const category = typeof args.category === "string" ? args.category.toLowerCase() : undefined;
  const safety = typeof args.safety === "string" ? args.safety : "all";
  return abilities.filter((ability) => {
    const annotations = getAbilityAnnotations(ability);
    if (namespace && ability.name.split("/")[0]?.toLowerCase() !== namespace) return false;
    if (category && ability.category?.toLowerCase() !== category) return false;
    if (
      search &&
      !`${ability.name} ${ability.label ?? ""} ${ability.description ?? ""}`.toLowerCase().includes(search)
    ) return false;
    if (safety === "readonly" && !annotations.readonly) return false;
    if (safety === "write" && (annotations.readonly || annotations.destructive)) return false;
    if (safety === "destructive" && !annotations.destructive) return false;
    return true;
  });
}

export function createMcpServer(
  config: AppConfig,
  wordpress: WordPressClient,
  auth: AuthContext,
  logger: Logger,
): Server {
  const server = new Server(
    { name: "simpli-wordpress-mcp", version: "1.0.0" },
    {
      capabilities: { tools: { listChanged: true } },
      instructions:
        "Inspect the relevant WordPress ability before use. Prefer read-only abilities first. Before changing content or code, retrieve the current state. Destructive and privileged abilities require explicit approval and their exact _confirm value. Verify the resulting state after every write.",
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    requireScope(auth, "wordpress:read");
    const abilities = await wordpress.listAbilities();
    const abilityTools = abilities.map(abilityToMcpTool);
    return { tools: [...gatewayTools, ...abilityTools] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    try {
      const args = asArguments(request.params.arguments);
      if (toolName === DISCOVER_TOOL) {
        requireScope(auth, "wordpress:read");
        const snapshot = await wordpress.getAbilitySnapshot(args.force_refresh === true);
        const filtered = filterAbilities(snapshot.abilities, args);
        const includeSchemas = args.include_schemas === true;
        return textResult(
          {
            count: filtered.length,
            total: snapshot.abilities.length,
            refreshedAt: snapshot.refreshedAt,
            abilities: filtered.map((ability) => {
              const annotations = getAbilityAnnotations(ability);
              return {
                name: ability.name,
                toolName: abilityToToolName(ability.name),
                label: ability.label,
                category: ability.category,
                description: ability.description,
                annotations,
                ...(includeSchemas
                  ? { inputSchema: getAbilityInputSchema(ability), outputSchema: ability.output_schema }
                  : {}),
              };
            }),
          },
          config.maxToolOutputBytes,
        );
      }
      if (toolName === GET_ABILITY_TOOL) {
        requireScope(auth, "wordpress:read");
        const ability = await wordpress.getAbility(requiredString(args, "name"));
        return textResult(
          { ...ability, toolName: abilityToToolName(ability.name), annotations: getAbilityAnnotations(ability) },
          config.maxToolOutputBytes,
        );
      }
      if (toolName === REFRESH_TOOL) {
        requireScope(auth, "wordpress:read");
        const snapshot = await wordpress.getAbilitySnapshot(true);
        return textResult(
          {
            refreshedAt: snapshot.refreshedAt,
            abilityCount: snapshot.abilities.length,
            novamiraCount: snapshot.abilities.filter((ability) => ability.name.startsWith("novamira/")).length,
          },
          config.maxToolOutputBytes,
        );
      }

      let abilities = await wordpress.listAbilities();
      let ability = abilities.find((candidate) => abilityToToolName(candidate.name) === toolName);
      if (!ability) {
        abilities = await wordpress.listAbilities(true);
        ability = abilities.find((candidate) => abilityToToolName(candidate.name) === toolName);
      }
      if (!ability) throw new Error(`Unknown tool: ${toolName}`);

      const annotations = getAbilityAnnotations(ability);
      if (annotations.readonly) requireScope(auth, "wordpress:read");
      else if (annotations.destructive) requireScope(auth, "wordpress:dangerous");
      else requireScope(auth, "wordpress:write");

      const forwarded = { ...args };
      if (annotations.destructive) {
        const expected = `RUN ${ability.name}`;
        if (forwarded._confirm !== expected) {
          throw new Error(`Destructive ability requires _confirm to equal exactly: ${expected}`);
        }
        delete forwarded._confirm;
      }

      logger.info("WordPress ability invoked", {
        ability: ability.name,
        category: ability.category ?? "uncategorized",
        readonly: annotations.readonly,
        destructive: annotations.destructive,
        authMode: auth.mode,
        clientId: auth.clientId.slice(0, 24),
      });
      const output = await wordpress.runAbility(ability.name, forwarded);
      return textResult(output, config.maxToolOutputBytes, `Ability ${ability.name} completed.`);
    } catch (error) {
      logger.warn("MCP tool call failed", {
        toolName,
        error: error instanceof Error ? error.message : String(error),
      });
      return errorResult(error, config.maxToolOutputBytes);
    }
  });

  return server;
}

export const GATEWAY_TOOL_NAMES = { DISCOVER_TOOL, GET_ABILITY_TOOL, REFRESH_TOOL } as const;
