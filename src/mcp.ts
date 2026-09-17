import { Server, type CallToolResult, type Tool } from "@modelcontextprotocol/server";
import type { AppConfig } from "./config.js";
import type { AuthContext } from "./oauth.js";
import { requireScope } from "./oauth.js";
import type { Logger } from "./logger.js";
import { BrowserQaClient } from "./browser-qa.js";
import {
  AuthorityBrokerRequiredError,
  assertGatewayExecutionAllowed,
  isReadScope,
  MUTATION_EXECUTION_STATE,
  type GatewayExecutionScope,
} from "./authority-gate.js";
import {
  WordPressClient,
  WordPressRequestError,
  type SimpliBackendTool,
} from "./wordpress.js";
import { SIMPLI_MCP_VERSION } from "./version.js";

type GatewayScope = GatewayExecutionScope;
type BackendOutput = Awaited<ReturnType<WordPressClient["callTool"]>>;

const WHATSAPP_CLIENT_ID = "simpli-whatsapp-intelligence";
const WHATSAPP_ALLOWED_TOOLS = new Set(["simpli_whatsapp_read"]);

const LEGACY_ABILITY_ALIASES: Record<string, { abilityName: string; scope: GatewayScope }> = {
  "core/get-site-info": { abilityName: "wordpress/site-info.get", scope: "wordpress:read" },
  "simpli/get-product-brand-description": {
    abilityName: "woocommerce/product-brand-description.get",
    scope: "wordpress:read",
  },
  "simpli/edit-product-brand-description": {
    abilityName: "woocommerce/product-brand-description.edit",
    scope: "wordpress:dangerous",
  },
};

function textResult(value: unknown, maxBytes: number, label?: string): CallToolResult {
  const serialized = JSON.stringify(value, null, 2) ?? "null";
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes <= maxBytes) {
    return {
      content: [{ type: "text", text: label ? `${label}\n${serialized}` : serialized }],
      structuredContent:
        typeof value === "object" && value !== null && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : { result: value },
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
      : error instanceof AuthorityBrokerRequiredError
        ? {
            error: error.message,
            code: error.code,
            status: error.status,
            operation: error.operation,
            scope: error.scope,
            mutationExecutionState: MUTATION_EXECUTION_STATE,
          }
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

function requiredScope(tool: SimpliBackendTool): GatewayScope {
  const annotations = tool.annotations ?? {};
  if (annotations.readOnlyHint === true) return "wordpress:read";
  if (annotations.destructiveHint === true) return "wordpress:dangerous";
  return "wordpress:write";
}

function authorizeOperation(auth: AuthContext, scope: GatewayScope, operation: string): void {
  requireScope(auth, scope);
  assertGatewayExecutionAllowed(scope, operation);
}

function toMcpTool(tool: SimpliBackendTool): Tool {
  return {
    name: tool.name,
    ...(tool.title ? { title: tool.title } : {}),
    ...(tool.description ? { description: tool.description } : {}),
    inputSchema: tool.inputSchema as Tool["inputSchema"],
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema as Tool["outputSchema"] } : {}),
    annotations: {
      ...(tool.annotations?.title ? { title: tool.annotations.title } : {}),
      readOnlyHint: tool.annotations?.readOnlyHint === true,
      destructiveHint: tool.annotations?.destructiveHint === true,
      idempotentHint: tool.annotations?.idempotentHint === true,
      openWorldHint: tool.annotations?.openWorldHint === true,
    },
    _meta: {
      "simpli/backend": "wordpress-plugin",
      "simpli/sourceTool": tool.name,
      "simpli/executionState": "READ_ONLY_DIRECT_PATH",
    },
  };
}

function legacyWpToolToAbility(toolName: string): string | null {
  if (!toolName.startsWith("wp__")) return null;
  const encoded = toolName.slice(4);
  const separator = encoded.indexOf("_");
  if (separator <= 0 || separator === encoded.length - 1) return null;
  return `${encoded.slice(0, separator)}/${encoded.slice(separator + 1)}`;
}

function mapLegacyAbilityName(name: string): { abilityName: string; scope: GatewayScope } | null {
  return LEGACY_ABILITY_ALIASES[name] ?? null;
}

function mapLegacyAbilityInput(abilityName: string, args: Record<string, unknown>): Record<string, unknown> {
  if (abilityName === "wordpress/site-info.get") return {};
  return args;
}

function mergeBrowserCatalog(output: BackendOutput, browserQa: BrowserQaClient): BackendOutput {
  const structured = output.structuredContent;
  if (typeof structured !== "object" || structured === null || Array.isArray(structured)) return output;
  const payload = structured as Record<string, unknown>;
  const existing = Array.isArray(payload.abilities) ? payload.abilities : [];
  const browserAbilities = browserQa.catalog().map((ability) => ({
    name: ability.name,
    description: ability.description,
    readonly: ability.readonly,
    risk: ability.risk,
    authority_class: ability.authority_class,
    requires_confirmation: ability.requires_confirmation,
    execution_state: ability.readonly ? "AVAILABLE_READ" : MUTATION_EXECUTION_STATE,
  }));
  return {
    ...output,
    structuredContent: {
      ...payload,
      abilities: [...existing, ...browserAbilities],
    },
  };
}

async function callCompatibilityTool(
  wordpress: WordPressClient,
  auth: AuthContext,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{
  output: Awaited<ReturnType<WordPressClient["callTool"]>>;
  routedTool: string;
  scope: GatewayScope;
  abilityName?: string;
} | null> {
  if (toolName === "wordpress_discover_abilities" || toolName === "wordpress_refresh_ability_catalog") {
    authorizeOperation(auth, "wordpress:read", toolName);
    return {
      output: await wordpress.callTool("simpli_catalog", {}),
      routedTool: "simpli_catalog",
      scope: "wordpress:read",
    };
  }

  if (toolName === "wordpress_get_ability") {
    authorizeOperation(auth, "wordpress:read", toolName);
    const name = args.name;
    if (typeof name !== "string" || !name.trim()) {
      throw new WordPressRequestError("Legacy wordpress_get_ability requires name", 400);
    }
    const mapped = mapLegacyAbilityName(name);
    const abilityName = mapped?.abilityName ?? name;
    return {
      output: await wordpress.callTool("simpli_describe", { ability_name: abilityName }),
      routedTool: "simpli_describe",
      scope: "wordpress:read",
      abilityName,
    };
  }

  const legacyAbilityName = legacyWpToolToAbility(toolName);
  if (!legacyAbilityName) return null;
  const mapped = mapLegacyAbilityName(legacyAbilityName);
  if (!mapped) {
    throw new WordPressRequestError(
      `Legacy MCP tool has no governed Simpli v3 equivalent: ${toolName}`,
      410,
      { legacyAbilityName },
    );
  }

  authorizeOperation(auth, mapped.scope, mapped.abilityName);

  const dispatcherInput: Record<string, unknown> = {
    ability_name: mapped.abilityName,
    input: mapLegacyAbilityInput(mapped.abilityName, args),
  };
  // Caller-supplied authority metadata is deliberately not forwarded. Mutation
  // compatibility paths are blocked above until the trusted authority bridge exists.
  return {
    output: await wordpress.callTool("simpli_execute", dispatcherInput),
    routedTool: "simpli_execute",
    scope: mapped.scope,
    abilityName: mapped.abilityName,
  };
}

export function createMcpServer(
  config: AppConfig,
  wordpress: WordPressClient,
  auth: AuthContext,
  logger: Logger,
): Server {
  const browserQa = new BrowserQaClient(config, logger);
  const isWhatsappClient = auth.clientId === WHATSAPP_CLIENT_ID;
  const server = new Server(
    { name: "simpli-mcp", version: SIMPLI_MCP_VERSION },
    {
      capabilities: { tools: { listChanged: true } },
      instructions:
        "Simpli Cosmetics Kenya first-party MCP. Direct public-gateway execution is currently read-only. Mutations fail closed until the existing SuperComputer sealed-permit authority lane is integrated. Tool access, OAuth scope, caller-supplied authority references and valid machine transport signatures do not grant business authority. Read current state before any future write; material mutations require exact authority, idempotency/before-state controls and read-back verification. Never infer production acceptance from transport-level success.",
    },
  );

  server.setRequestHandler("tools/list", async () => {
    requireScope(auth, "wordpress:read");
    const tools = await wordpress.listTools();
    const readOnlyTools = tools.filter((tool) => isReadScope(requiredScope(tool)));
    const visibleTools = isWhatsappClient
      ? readOnlyTools.filter((tool) => WHATSAPP_ALLOWED_TOOLS.has(tool.name))
      : readOnlyTools;
    return { tools: visibleTools.map(toMcpTool) };
  });

  server.setRequestHandler("tools/call", async (request) => {
    const toolName = request.params.name;
    try {
      if (isWhatsappClient && !WHATSAPP_ALLOWED_TOOLS.has(toolName)) {
        throw new WordPressRequestError(
          "This credential is restricted to the Simpli WhatsApp safe read facade.",
          403,
          { allowedTools: [...WHATSAPP_ALLOWED_TOOLS] },
        );
      }

      const args = asArguments(request.params.arguments);
      let output: BackendOutput;
      let routedToolName = toolName;
      let scope: GatewayScope;

      if (toolName === "simpli_catalog" && browserQa.configured) {
        scope = "wordpress:read";
        authorizeOperation(auth, scope, toolName);
        output = mergeBrowserCatalog(await wordpress.callTool("simpli_catalog", {}), browserQa);
        routedToolName = "simpli_catalog+browser-qa";
      } else if (
        toolName === "simpli_describe" &&
        browserQa.hasAbility(args.ability_name)
      ) {
        const ability = browserQa.describe(args.ability_name);
        scope = ability.gateway_scope;
        // Describing a blocked write ability is still a read operation.
        authorizeOperation(auth, "wordpress:read", `describe:${ability.name}`);
        output = {
          structuredContent: {
            name: ability.name,
            description: ability.description,
            readonly: ability.readonly,
            risk: ability.risk,
            authority_class: ability.authority_class,
            requires_confirmation: ability.requires_confirmation,
            execution_state: ability.readonly ? "AVAILABLE_READ" : MUTATION_EXECUTION_STATE,
            input_schema: ability.input_schema,
            output_schema: ability.output_schema,
          },
        };
        routedToolName = "browser-qa/describe";
      } else if (
        toolName === "simpli_execute" &&
        browserQa.hasAbility(args.ability_name)
      ) {
        const ability = browserQa.describe(args.ability_name);
        scope = ability.gateway_scope;
        authorizeOperation(auth, scope, ability.name);
        const localInput = asArguments(args.input);
        const execution = await browserQa.execute(
          ability.name,
          localInput,
          undefined,
          undefined,
        );
        routedToolName = `browser-qa/${ability.name}`;

        logger.info("Simpli Browser QA read ability invoked through dispatcher", {
          toolName,
          routedToolName,
          scope,
          authMode: auth.mode,
          clientId: auth.clientId.slice(0, 24),
        });

        if (execution.kind === "image") {
          return {
            content: [{ type: "image", data: execution.dataBase64, mimeType: execution.mimeType }],
            structuredContent: execution.metadata,
            isError: false,
          };
        }
        output = { structuredContent: execution.value };
      } else {
        try {
          const tool = await wordpress.getTool(toolName);
          scope = requiredScope(tool);
          authorizeOperation(auth, scope, toolName);
          output = await wordpress.callTool(toolName, args);
        } catch (error) {
          if (!(error instanceof WordPressRequestError) || error.status !== 404) throw error;
          const compatibility = await callCompatibilityTool(wordpress, auth, toolName, args);
          if (!compatibility) throw error;
          routedToolName = compatibility.routedTool;
          scope = compatibility.scope;
          output = compatibility.output;
          logger.info("Legacy MCP tool routed through Simpli compatibility dispatcher", {
            legacyToolName: toolName,
            routedToolName,
            ...(compatibility.abilityName ? { abilityName: compatibility.abilityName } : {}),
            authMode: auth.mode,
            clientId: auth.clientId.slice(0, 24),
          });
        }
      }

      logger.info("Simpli backend read tool invoked", {
        toolName,
        routedToolName,
        scope,
        authMode: auth.mode,
        clientId: auth.clientId.slice(0, 24),
      });

      const structured = output.structuredContent ?? { content: output.content ?? null };
      const result = textResult(structured, config.maxToolOutputBytes, `Simpli tool ${toolName} completed.`);
      return { ...result, isError: false };
    } catch (error) {
      logger.warn("Simpli MCP tool call failed", {
        toolName,
        error: error instanceof Error ? error.message : String(error),
      });
      return errorResult(error, config.maxToolOutputBytes);
    }
  });

  return server;
}
