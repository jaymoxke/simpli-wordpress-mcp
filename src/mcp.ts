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
  WordPressClient,
  WordPressRequestError,
  type SimpliBackendTool,
} from "./wordpress.js";

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

function requiredScope(tool: SimpliBackendTool): "wordpress:read" | "wordpress:write" | "wordpress:dangerous" {
  const annotations = tool.annotations ?? {};
  if (annotations.readOnlyHint === true) return "wordpress:read";
  if (annotations.destructiveHint === true) return "wordpress:dangerous";
  return "wordpress:write";
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
    },
  };
}

export function createMcpServer(
  config: AppConfig,
  wordpress: WordPressClient,
  auth: AuthContext,
  logger: Logger,
): Server {
  const server = new Server(
    { name: "simpli-mcp", version: "2.0.0" },
    {
      capabilities: { tools: { listChanged: true } },
      instructions:
        "Simpli Cosmetics Kenya first-party MCP. Tools are supplied only by the Simpli-owned WordPress MCP backend. Read current state before writes. Tool access does not grant business authority. Mutations must satisfy each tool's own authority_ref, confirmation, before-state and rollback controls. Never infer successful production acceptance from a transport-level success response.",
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    requireScope(auth, "wordpress:read");
    const tools = await wordpress.listTools();
    return { tools: tools.map(toMcpTool) };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    try {
      const args = asArguments(request.params.arguments);
      const tool = await wordpress.getTool(toolName);
      requireScope(auth, requiredScope(tool));

      logger.info("Simpli backend tool invoked", {
        toolName,
        scope: requiredScope(tool),
        authMode: auth.mode,
        clientId: auth.clientId.slice(0, 24),
      });

      const output = await wordpress.callTool(toolName, args);
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
