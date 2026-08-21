import type { AppConfig } from "./config.js";
import type { Logger } from "./logger.js";

export interface JsonSchema {
  type?: string | string[];
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema | JsonSchema[];
  default?: unknown;
  enum?: unknown[];
  const?: unknown;
  [key: string]: unknown;
}

export interface SimpliBackendTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
    [key: string]: unknown;
  };
  securitySchemes?: unknown[];
  [key: string]: unknown;
}

interface JsonRpcResponse<T> {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface BackendToolsListResult {
  tools?: SimpliBackendTool[];
  resultType?: string;
  ttlMs?: number;
  cacheScope?: string;
}

interface BackendToolCallResult {
  structuredContent?: unknown;
  content?: unknown;
  isError?: boolean;
  resultType?: string;
}

export interface ToolSnapshot {
  tools: SimpliBackendTool[];
  refreshedAt: string;
  expiresAt: string;
  stale: boolean;
}

export class WordPressRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "WordPressRequestError";
  }
}

function normalizeTool(value: unknown): SimpliBackendTool | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const tool = value as Record<string, unknown>;
  if (typeof tool.name !== "string" || !tool.name.trim()) return null;

  const normalized: SimpliBackendTool = {
    name: tool.name,
    inputSchema:
      typeof tool.inputSchema === "object" && tool.inputSchema !== null && !Array.isArray(tool.inputSchema)
        ? (tool.inputSchema as JsonSchema)
        : { type: "object", properties: {}, additionalProperties: false },
  };

  if (typeof tool.title === "string") normalized.title = tool.title;
  if (typeof tool.description === "string") normalized.description = tool.description;
  if (typeof tool.outputSchema === "object" && tool.outputSchema !== null && !Array.isArray(tool.outputSchema)) {
    normalized.outputSchema = tool.outputSchema as JsonSchema;
  }
  if (typeof tool.annotations === "object" && tool.annotations !== null && !Array.isArray(tool.annotations)) {
    normalized.annotations = tool.annotations as NonNullable<SimpliBackendTool["annotations"]>;
  }
  if (Array.isArray(tool.securitySchemes)) normalized.securitySchemes = tool.securitySchemes;

  return normalized;
}

export class WordPressClient {
  private cache?: { tools: SimpliBackendTool[]; refreshedAt: number };
  private refreshPromise: Promise<SimpliBackendTool[]> | undefined;
  private readonly endpoint: URL;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.endpoint = new URL(`${config.wordpressUrl}/wp-json/simpli-mcp/v1/mcp`);
  }

  async getToolSnapshot(force = false): Promise<ToolSnapshot> {
    const tools = await this.listTools(force);
    const refreshedAt = this.cache?.refreshedAt ?? Date.now();
    const expiresAt = refreshedAt + this.config.abilityCacheTtlMs;
    return {
      tools,
      refreshedAt: new Date(refreshedAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      stale: Date.now() >= expiresAt,
    };
  }

  // Compatibility for the existing server startup hook while the gateway migrates
  // from the old Abilities vocabulary to the Simpli-owned tool vocabulary.
  async getAbilitySnapshot(force = false): Promise<ToolSnapshot> {
    return this.getToolSnapshot(force);
  }

  async listTools(force = false): Promise<SimpliBackendTool[]> {
    const now = Date.now();
    if (!force && this.cache && now - this.cache.refreshedAt < this.config.abilityCacheTtlMs) {
      return this.cache.tools;
    }
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = this.rpc<BackendToolsListResult>("tools/list", {})
      .then((result) => {
        const tools = Array.isArray(result.tools)
          ? result.tools.map(normalizeTool).filter((tool): tool is SimpliBackendTool => tool !== null)
          : [];
        if (tools.length === 0) {
          throw new WordPressRequestError("Simpli MCP backend returned no tools", 502, result);
        }
        const seen = new Set<string>();
        const unique = tools.filter((tool) => {
          if (seen.has(tool.name)) return false;
          seen.add(tool.name);
          return true;
        });
        this.cache = { tools: unique, refreshedAt: Date.now() };
        this.logger.info("Simpli MCP backend tool catalog refreshed", {
          toolCount: unique.length,
          tools: unique.map((tool) => tool.name),
        });
        return unique;
      })
      .catch((error: unknown) => {
        if (this.cache) {
          this.logger.warn("Simpli MCP backend refresh failed; using stale catalog", {
            error: error instanceof Error ? error.message : String(error),
            toolCount: this.cache.tools.length,
          });
          return this.cache.tools;
        }
        throw error;
      })
      .finally(() => {
        this.refreshPromise = undefined;
      });

    return this.refreshPromise;
  }

  async getTool(name: string, refreshIfMissing = true): Promise<SimpliBackendTool> {
    let tools = await this.listTools();
    let tool = tools.find((candidate) => candidate.name === name);
    if (!tool && refreshIfMissing) {
      tools = await this.listTools(true);
      tool = tools.find((candidate) => candidate.name === name);
    }
    if (!tool) throw new WordPressRequestError(`Simpli MCP tool not found: ${name}`, 404);
    return tool;
  }

  async callTool(name: string, input: Record<string, unknown>): Promise<BackendToolCallResult> {
    await this.getTool(name);
    const result = await this.rpc<BackendToolCallResult>("tools/call", {
      name,
      arguments: input,
    });
    if (result.isError === true) {
      const details = result.structuredContent ?? result.content ?? result;
      const message =
        typeof result.structuredContent === "object" &&
        result.structuredContent !== null &&
        "message" in result.structuredContent
          ? String((result.structuredContent as { message: unknown }).message)
          : `Simpli MCP backend tool failed: ${name}`;
      throw new WordPressRequestError(message, 502, details);
    }
    return result;
  }

  async readiness(): Promise<{
    ready: boolean;
    toolCount: number;
    backend: "simpli-mcp";
    backendVersion?: string;
    lastRefresh?: string;
    error?: string;
  }> {
    try {
      const [snapshot, statusResult] = await Promise.all([
        this.getToolSnapshot(),
        this.callTool("simpli_self_status", {}),
      ]);
      const structured = statusResult.structuredContent;
      const backendVersion =
        typeof structured === "object" && structured !== null && "version" in structured
          ? String((structured as { version: unknown }).version)
          : undefined;
      return {
        ready: snapshot.tools.length > 0,
        toolCount: snapshot.tools.length,
        backend: "simpli-mcp",
        ...(backendVersion ? { backendVersion } : {}),
        lastRefresh: snapshot.refreshedAt,
      };
    } catch (error) {
      return {
        ready: false,
        toolCount: this.cache?.tools.length ?? 0,
        backend: "simpli-mcp",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async rpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const id = `railway-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const payload = { jsonrpc: "2.0", id, method, params };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.wordpressTimeoutMs);
    const authorization = Buffer.from(
      `${this.config.wordpressUsername}:${this.config.wordpressAppPassword}`,
      "utf8",
    ).toString("base64");

    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Basic ${authorization}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "Simpli-MCP-Railway/2.0",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
        redirect: "error",
      });
      const raw = await response.text();
      let data: unknown = null;
      if (raw) {
        try {
          data = JSON.parse(raw);
        } catch {
          data = raw;
        }
      }
      if (!response.ok) {
        const message =
          typeof data === "object" && data !== null && "message" in data
            ? String((data as { message: unknown }).message)
            : `Simpli MCP backend returned HTTP ${response.status}`;
        throw new WordPressRequestError(message, response.status, data);
      }
      if (typeof data !== "object" || data === null || Array.isArray(data)) {
        throw new WordPressRequestError("Simpli MCP backend returned invalid JSON-RPC", 502, data);
      }
      const rpc = data as JsonRpcResponse<T>;
      if (rpc.error) {
        throw new WordPressRequestError(rpc.error.message, 502, rpc.error);
      }
      if (!("result" in rpc)) {
        throw new WordPressRequestError("Simpli MCP backend JSON-RPC result is missing", 502, rpc);
      }
      return rpc.result as T;
    } catch (error) {
      if (error instanceof WordPressRequestError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new WordPressRequestError("Simpli MCP backend request timed out", 504);
      }
      throw new WordPressRequestError(
        error instanceof Error ? `Simpli MCP backend request failed: ${error.message}` : "Simpli MCP backend request failed",
        502,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
