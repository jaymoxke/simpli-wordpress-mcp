import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PUBLIC_BASE_URL: z.string().url(),
  WORDPRESS_URL: z.string().url(),
  WORDPRESS_USERNAME: z.string().min(1),
  WORDPRESS_APP_PASSWORD: z.string().min(8),
  OAUTH_SIGNING_SECRET: z.string().min(32).optional(),
  OAUTH_ADMIN_PASSWORD: z.string().min(16).optional(),
  MCP_STATIC_TOKEN: z.string().min(32).optional(),
  ABILITY_CACHE_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  WORDPRESS_TIMEOUT_MS: z.coerce.number().int().min(5000).max(180000).default(65000),
  MAX_TOOL_OUTPUT_BYTES: z.coerce.number().int().min(16384).max(1048576).default(262144),
  OAUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(300).max(86400).default(3600),
  OAUTH_REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(3600).max(7776000).default(2592000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function assertSecureUrl(value: string, name: string, originOnly: boolean): void {
  const url = new URL(value);
  const isLocal = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(isLocal && url.protocol === "http:")) {
    throw new Error(`${name} must use HTTPS (localhost may use HTTP).`);
  }
  if (url.username || url.password) throw new Error(`${name} must not contain credentials.`);
  if (originOnly && (url.pathname !== "/" || url.search || url.hash)) {
    throw new Error(`${name} must be an origin without a path, query, or fragment.`);
  }
}

export interface AppConfig {
  port: number;
  publicBaseUrl: string;
  resourceUrl: string;
  wordpressUrl: string;
  wordpressUsername: string;
  wordpressAppPassword: string;
  oauthSigningSecret?: string;
  oauthAdminPassword?: string;
  staticToken?: string;
  abilityCacheTtlMs: number;
  wordpressTimeoutMs: number;
  maxToolOutputBytes: number;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  logLevel: "debug" | "info" | "warn" | "error";
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse({
    ...environment,
    OAUTH_SIGNING_SECRET: environment.OAUTH_SIGNING_SECRET || undefined,
    OAUTH_ADMIN_PASSWORD: environment.OAUTH_ADMIN_PASSWORD || undefined,
    MCP_STATIC_TOKEN: environment.MCP_STATIC_TOKEN || undefined,
  });

  if (!(parsed.OAUTH_SIGNING_SECRET && parsed.OAUTH_ADMIN_PASSWORD) && !parsed.MCP_STATIC_TOKEN) {
    throw new Error(
      "Configure OAuth (OAUTH_SIGNING_SECRET and OAUTH_ADMIN_PASSWORD) or MCP_STATIC_TOKEN.",
    );
  }

  assertSecureUrl(parsed.PUBLIC_BASE_URL, "PUBLIC_BASE_URL", true);
  assertSecureUrl(parsed.WORDPRESS_URL, "WORDPRESS_URL", false);

  const publicBaseUrl = withoutTrailingSlash(parsed.PUBLIC_BASE_URL);
  return {
    port: parsed.PORT,
    publicBaseUrl,
    resourceUrl: `${publicBaseUrl}/mcp`,
    wordpressUrl: withoutTrailingSlash(parsed.WORDPRESS_URL),
    wordpressUsername: parsed.WORDPRESS_USERNAME,
    wordpressAppPassword: parsed.WORDPRESS_APP_PASSWORD,
    ...(parsed.OAUTH_SIGNING_SECRET ? { oauthSigningSecret: parsed.OAUTH_SIGNING_SECRET } : {}),
    ...(parsed.OAUTH_ADMIN_PASSWORD ? { oauthAdminPassword: parsed.OAUTH_ADMIN_PASSWORD } : {}),
    ...(parsed.MCP_STATIC_TOKEN ? { staticToken: parsed.MCP_STATIC_TOKEN } : {}),
    abilityCacheTtlMs: parsed.ABILITY_CACHE_TTL_SECONDS * 1000,
    wordpressTimeoutMs: parsed.WORDPRESS_TIMEOUT_MS,
    maxToolOutputBytes: parsed.MAX_TOOL_OUTPUT_BYTES,
    accessTokenTtlSeconds: parsed.OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlSeconds: parsed.OAUTH_REFRESH_TOKEN_TTL_SECONDS,
    logLevel: parsed.LOG_LEVEL,
  };
}

export function redactConfig(config: AppConfig): Record<string, unknown> {
  return {
    port: config.port,
    publicBaseUrl: config.publicBaseUrl,
    resourceUrl: config.resourceUrl,
    wordpressUrl: config.wordpressUrl,
    wordpressUsername: config.wordpressUsername,
    oauthEnabled: Boolean(config.oauthSigningSecret && config.oauthAdminPassword),
    staticTokenEnabled: Boolean(config.staticToken),
    abilityCacheTtlMs: config.abilityCacheTtlMs,
    wordpressTimeoutMs: config.wordpressTimeoutMs,
    maxToolOutputBytes: config.maxToolOutputBytes,
    logLevel: config.logLevel,
  };
}
