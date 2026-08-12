import type { AppConfig } from "./config.js";
import type { Logger } from "./logger.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface JsonSchema {
  type?: string | string[];
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema | JsonSchema[];
  default?: JsonValue;
  enum?: JsonValue[];
  [key: string]: unknown;
}

export interface AbilityAnnotations {
  readonly?: boolean;
  destructive?: boolean;
  idempotent?: boolean;
  instructions?: string;
}

export interface WordPressAbility {
  name: string;
  label?: string;
  description?: string;
  category?: string;
  input_schema?: JsonSchema;
  output_schema?: JsonSchema;
  meta?: {
    annotations?: AbilityAnnotations;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface AbilitySnapshot {
  abilities: WordPressAbility[];
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

function abilityPath(name: string): string {
  const parts = name.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error(`Invalid ability name: ${name}`);
  return `${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}`;
}

function normalizeInputSchema(schema: JsonSchema | undefined): JsonSchema {
  if (!schema) return { type: "object", properties: {}, additionalProperties: false };
  if (schema.type === "object" || schema.properties) return schema;
  return {
    type: "object",
    properties: { input: schema },
    required: ["input"],
    additionalProperties: false,
  };
}

export function getAbilityInputSchema(ability: WordPressAbility): JsonSchema {
  return normalizeInputSchema(ability.input_schema);
}

export function getAbilityAnnotations(ability: WordPressAbility): Required<Pick<AbilityAnnotations, "readonly" | "destructive" | "idempotent">> & Pick<AbilityAnnotations, "instructions"> {
  const annotations = ability.meta?.annotations ?? {};
  const forcedDangerous = [
    "novamira/execute-php",
    "novamira/run-wp-cli",
    "novamira/create-admin-access-link",
  ].includes(ability.name);
  return {
    readonly: forcedDangerous ? false : annotations.readonly === true,
    destructive: forcedDangerous || annotations.destructive === true,
    idempotent: annotations.idempotent === true,
    ...(annotations.instructions ? { instructions: annotations.instructions } : {}),
  };
}

export function abilityToToolName(abilityName: string): string {
  const safe = abilityName
    .toLowerCase()
    .replaceAll("/", "__")
    .replace(/[^a-z0-9_-]/g, "_")
    .replace(/_+/g, "_");
  return `wp__${safe}`.slice(0, 128);
}

export class WordPressClient {
  private cache?: { abilities: WordPressAbility[]; refreshedAt: number };
  private refreshPromise: Promise<WordPressAbility[]> | undefined;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async getAbilitySnapshot(force = false): Promise<AbilitySnapshot> {
    const abilities = await this.listAbilities(force);
    const refreshedAt = this.cache?.refreshedAt ?? Date.now();
    const expiresAt = refreshedAt + this.config.abilityCacheTtlMs;
    return {
      abilities,
      refreshedAt: new Date(refreshedAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      stale: Date.now() >= expiresAt,
    };
  }

  async listAbilities(force = false): Promise<WordPressAbility[]> {
    const now = Date.now();
    if (!force && this.cache && now - this.cache.refreshedAt < this.config.abilityCacheTtlMs) {
      return this.cache.abilities;
    }
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = this.fetchAllAbilities()
      .then((abilities) => {
        this.cache = { abilities, refreshedAt: Date.now() };
        this.logger.info("WordPress ability catalog refreshed", {
          abilityCount: abilities.length,
          novamiraCount: abilities.filter((ability) => ability.name.startsWith("novamira/")).length,
        });
        return abilities;
      })
      .catch((error) => {
        if (this.cache) {
          this.logger.warn("Ability refresh failed; using stale catalog", {
            error: error instanceof Error ? error.message : String(error),
            abilityCount: this.cache.abilities.length,
          });
          return this.cache.abilities;
        }
        throw error;
      })
      .finally(() => {
        this.refreshPromise = undefined;
      });
    return this.refreshPromise;
  }

  private async fetchAllAbilities(): Promise<WordPressAbility[]> {
    const abilities: WordPressAbility[] = [];
    for (let page = 1; page <= 100; page += 1) {
      const response = await this.request<WordPressAbility[]>("GET", "/wp-abilities/v1/abilities", {
        query: { page: String(page), per_page: "100" },
        includeResponse: true,
      });
      const items = response.data;
      if (!Array.isArray(items)) throw new WordPressRequestError("Abilities response was not an array", 502);
      abilities.push(...items);
      const totalPages = Number(response.headers.get("x-wp-totalpages") ?? "0");
      if ((totalPages > 0 && page >= totalPages) || items.length < 100) break;
    }
    const seen = new Set<string>();
    return abilities.filter((ability) => {
      if (!ability?.name || seen.has(ability.name)) return false;
      seen.add(ability.name);
      return true;
    });
  }

  async getAbility(name: string, refreshIfMissing = true): Promise<WordPressAbility> {
    let abilities = await this.listAbilities();
    let ability = abilities.find((candidate) => candidate.name === name);
    if (!ability && refreshIfMissing) {
      abilities = await this.listAbilities(true);
      ability = abilities.find((candidate) => candidate.name === name);
    }
    if (!ability) throw new WordPressRequestError(`WordPress ability not found: ${name}`, 404);
    return ability;
  }

  async runAbility(name: string, input: unknown): Promise<unknown> {
    const ability = await this.getAbility(name);
    const annotations = getAbilityAnnotations(ability);
    const path = `/wp-abilities/v1/${abilityPath(name)}/run`;
    if (annotations.readonly) {
      const query = input === undefined || (typeof input === "object" && input !== null && Object.keys(input).length === 0)
        ? undefined
        : { input: JSON.stringify(input) };
      return (await this.request<unknown>("GET", path, { ...(query ? { query } : {}) })).data;
    }
    if (annotations.destructive) {
      const query = input === undefined ? undefined : { input: JSON.stringify(input) };
      return (await this.request<unknown>("DELETE", path, { ...(query ? { query } : {}) })).data;
    }
    return (await this.request<unknown>("POST", path, { body: { input: input ?? {} } })).data;
  }

  async getSiteInfo(): Promise<unknown> {
    return this.runAbility("core/get-site-info", {});
  }

  async readiness(): Promise<{ ready: boolean; abilityCount: number; novamiraCount: number; lastRefresh?: string; error?: string }> {
    try {
      const snapshot = await this.getAbilitySnapshot();
      return {
        ready: snapshot.abilities.length > 0,
        abilityCount: snapshot.abilities.length,
        novamiraCount: snapshot.abilities.filter((ability) => ability.name.startsWith("novamira/")).length,
        lastRefresh: snapshot.refreshedAt,
      };
    } catch (error) {
      return {
        ready: false,
        abilityCount: this.cache?.abilities.length ?? 0,
        novamiraCount: this.cache?.abilities.filter((ability) => ability.name.startsWith("novamira/")).length ?? 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    route: string,
    options: {
      query?: Record<string, string>;
      body?: unknown;
      includeResponse?: boolean;
    } = {},
  ): Promise<{ data: T; headers: Headers }> {
    const url = new URL(`${this.config.wordpressUrl}/wp-json${route}`);
    for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.wordpressTimeoutMs);
    const authorization = Buffer.from(
      `${this.config.wordpressUsername}:${this.config.wordpressAppPassword}`,
      "utf8",
    ).toString("base64");

    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: `Basic ${authorization}`,
          Accept: "application/json",
          "User-Agent": "Simpli-WordPress-MCP/1.0",
          ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
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
            : `WordPress returned HTTP ${response.status}`;
        throw new WordPressRequestError(message, response.status, data);
      }
      return { data: data as T, headers: response.headers };
    } catch (error) {
      if (error instanceof WordPressRequestError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new WordPressRequestError("WordPress request timed out", 504);
      }
      throw new WordPressRequestError(
        error instanceof Error ? `WordPress request failed: ${error.message}` : "WordPress request failed",
        502,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
