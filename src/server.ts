import { createServer, type Server as HttpServer } from "node:http";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, type AuthInfo as SdkAuthInfo } from "@modelcontextprotocol/server";
import type { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { loadConfig, redactConfig, type AppConfig } from "./config.js";
import { constantTimeEqual } from "./crypto.js";
import { createLogger, type Logger } from "./logger.js";
import { createMcpServer } from "./mcp.js";
import { createOAuthRouter, OAuthService, type AuthContext } from "./oauth.js";
import { releaseMetadata, SIMPLI_MCP_VERSION } from "./version.js";
import { WordPressClient } from "./wordpress.js";

interface RateRecord {
  count: number;
  resetAt: number;
}

const WHATSAPP_CLIENT_ID = "simpli-whatsapp-intelligence";

function createRateLimit(options: { windowMs: number; max: number; keyPrefix: string }) {
  const records = new Map<string, RateRecord>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = `${options.keyPrefix}:${req.ip ?? req.socket.remoteAddress ?? "unknown"}`;
    let record = records.get(key);
    if (!record || record.resetAt <= now) {
      record = { count: 0, resetAt: now + options.windowMs };
      records.set(key, record);
    }
    record.count += 1;
    res.set("RateLimit-Limit", String(options.max));
    res.set("RateLimit-Remaining", String(Math.max(0, options.max - record.count)));
    res.set("RateLimit-Reset", String(Math.ceil(record.resetAt / 1000)));
    if (record.count > options.max) {
      res.status(429).json({
        error: "rate_limit_exceeded",
        retry_after_seconds: Math.ceil((record.resetAt - now) / 1000),
      });
      return;
    }
    if (records.size > 5000) {
      for (const [recordKey, item] of records) if (item.resetAt <= now) records.delete(recordKey);
    }
    next();
  };
}

function attachSdkAuth(req: Request, auth: AuthContext): void {
  const sdkAuth: SdkAuthInfo = {
    token: "verified",
    clientId: auth.clientId,
    scopes: [...auth.scopes],
    ...(auth.expiresAt ? { expiresAt: auth.expiresAt } : {}),
  };
  (req as Request & { auth?: SdkAuthInfo }).auth = sdkAuth;
}

function authContextFromSdk(auth: SdkAuthInfo): AuthContext {
  const staticClient = auth.clientId === WHATSAPP_CLIENT_ID || auth.clientId === "static-token";
  return {
    subject: staticClient ? auth.clientId : "wordpress-owner",
    clientId: auth.clientId,
    scopes: new Set(auth.scopes),
    ...(auth.expiresAt ? { expiresAt: auth.expiresAt } : {}),
    mode: staticClient ? "static" : "oauth",
  };
}

function allowedMcpHosts(config: AppConfig): string[] {
  return [...new Set([
    new URL(config.publicBaseUrl).hostname,
    "localhost",
    "127.0.0.1",
    "[::1]",
  ])];
}

export function createApp(config: AppConfig, logger: Logger, wordpress: WordPressClient) {
  const app = createMcpExpressApp({
    host: "0.0.0.0",
    allowedHosts: allowedMcpHosts(config),
    jsonLimit: "2mb",
  });
  const oauth = new OAuthService(config, logger);

  const authenticateMcp = (req: Request, res: Response, next: NextFunction): void => {
    const authorization = req.header("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(authorization);
    if (
      match?.[1] &&
      config.whatsappMcpToken &&
      constantTimeEqual(match[1], config.whatsappMcpToken)
    ) {
      const auth: AuthContext = {
        subject: WHATSAPP_CLIENT_ID,
        clientId: WHATSAPP_CLIENT_ID,
        scopes: new Set(["wordpress:read"]),
        mode: "static",
      };
      res.locals.auth = auth;
      attachSdkAuth(req, auth);
      next();
      return;
    }

    oauth.authenticate(req, res, () => {
      const auth = res.locals.auth as AuthContext | undefined;
      if (!auth) {
        logger.error("OAuth middleware completed without validated auth context");
        if (!res.headersSent) res.status(500).json({ error: "auth_context_missing" });
        return;
      }
      attachSdkAuth(req, auth);
      next();
    });
  };

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          formAction: ["'self'"],
          baseUri: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: "same-site" },
    }),
  );

  app.use("/oauth", createRateLimit({ windowMs: 15 * 60_000, max: 120, keyPrefix: "oauth" }));
  app.post("/oauth/register", createRateLimit({ windowMs: 15 * 60_000, max: 30, keyPrefix: "oauth-register" }));
  app.post(
    "/oauth/authorize",
    createRateLimit({ windowMs: 15 * 60_000, max: 10, keyPrefix: "oauth-authorize" }),
  );
  app.post(
    "/oauth/client/revoke",
    createRateLimit({ windowMs: 15 * 60_000, max: 10, keyPrefix: "oauth-client-revoke" }),
  );
  app.use(createOAuthRouter(config, oauth));

  app.get("/", (_req, res) => {
    res.json({
      ...releaseMetadata(),
      displayName: "Simpli WordPress MCP",
      transport: "MCP HTTP per-request",
      mcp: `${config.publicBaseUrl}/mcp`,
      health: `${config.publicBaseUrl}/health`,
      readiness: `${config.publicBaseUrl}/ready`,
      versionEndpoint: `${config.publicBaseUrl}/version`,
      authentication: oauth.enabled ? "OAuth 2.1 + PKCE + durable opaque tokens" : "Static bearer token",
    });
  });

  app.get("/docs", (_req, res) => {
    res.type("text/plain").send([
      "Simpli WordPress MCP gateway",
      "",
      `Release: ${SIMPLI_MCP_VERSION}`,
      "MCP endpoint: /mcp (per-request HTTP; modern 2026-07-28 with stateless legacy fallback)",
      "OAuth metadata: /.well-known/oauth-protected-resource",
      "OAuth token revocation: /oauth/revoke",
      "Liveness: /health",
      "Readiness: /ready",
      "Release metadata: /version",
      "",
      "The gateway exposes Simpli-owned governed backend capabilities and preserves each capability's schema and safety annotations.",
    ].join("\n"));
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", uptimeSeconds: Math.round(process.uptime()), ...releaseMetadata() });
  });

  app.get("/version", (_req, res) => {
    res.set("Cache-Control", "no-store").json(releaseMetadata());
  });

  app.get("/ready", async (_req, res) => {
    const wordpressReadiness = await wordpress.readiness();
    const oauthReadiness = oauth.status();
    const oauthHealthy = oauthReadiness.healthy !== false;
    const ready = wordpressReadiness.ready && oauthHealthy;
    res.status(ready ? 200 : 503).json({
      ...wordpressReadiness,
      ready,
      oauth: oauthReadiness,
      release: releaseMetadata(),
    });
  });

  const mcpRateLimit = createRateLimit({ windowMs: 60_000, max: 300, keyPrefix: "mcp" });
  const mcpHandler = createMcpHandler(
    ({ authInfo, era }) => {
      if (!authInfo) throw new Error("MCP request reached the handler without validated authentication");
      const auth = authContextFromSdk(authInfo);
      logger.debug("Creating per-request MCP server", {
        era,
        authMode: auth.mode,
        clientId: auth.clientId.slice(0, 24),
      });
      return createMcpServer(config, wordpress, auth, logger);
    },
    {
      legacy: "stateless",
      responseMode: "auto",
      onerror: (error) => logger.warn("MCP handler error", { error: error.message }),
    },
  );
  const nodeMcpHandler = toNodeHandler(mcpHandler, {
    onerror: (error) => logger.warn("MCP Node adapter error", { error: error.message }),
  });

  app.all("/mcp", mcpRateLimit, authenticateMcp, async (req, res) => {
    await nodeMcpHandler(req, res, req.body);
  });

  app.use((_req, res) => res.status(404).json({ error: "not_found" }));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    logger.error("Unhandled HTTP error", { error: error instanceof Error ? error.message : String(error) });
    if (!res.headersSent) res.status(500).json({ error: "internal_server_error" });
  });

  return { app, mcpHandler, oauth };
}

export async function startServer(config = loadConfig()): Promise<HttpServer> {
  const logger = createLogger(config);
  const wordpress = new WordPressClient(config, logger);
  const { app, mcpHandler, oauth } = createApp(config, logger, wordpress);
  logger.info("Starting Simpli WordPress MCP", { ...redactConfig(config), release: releaseMetadata() });

  const httpServer = createServer(app);
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(config.port, "0.0.0.0", () => resolve());
  });
  logger.info("Simpli WordPress MCP listening", { port: config.port, release: releaseMetadata() });

  void wordpress.readiness().then((readiness) => {
    if (readiness.ready) {
      logger.info("Simpli MCP backend readiness verified", { ...readiness });
      return;
    }
    logger.warn("Simpli MCP backend readiness failed", { ...readiness });
  }).catch((error) => {
    logger.warn("Initial Simpli MCP readiness probe failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  const shutdown = async (signal: string) => {
    logger.info("Shutdown requested", { signal });
    try {
      await mcpHandler.close();
    } catch (error) {
      logger.warn("MCP handler close failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    try {
      oauth.close();
    } catch (error) {
      logger.warn("OAuth state close failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
  return httpServer;
}
