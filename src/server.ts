import { randomUUID } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Request, Response, NextFunction } from "express";
import express from "express";
import helmet from "helmet";
import { loadConfig, redactConfig, type AppConfig } from "./config.js";
import { createLogger, type Logger } from "./logger.js";
import { createMcpServer } from "./mcp.js";
import { createOAuthRouter, OAuthService, type AuthContext } from "./oauth.js";
import { WordPressClient } from "./wordpress.js";

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  server: ReturnType<typeof createMcpServer>;
  auth: AuthContext;
  createdAt: number;
}

interface RateRecord {
  count: number;
  resetAt: number;
}

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
      res.status(429).json({ error: "rate_limit_exceeded", retry_after_seconds: Math.ceil((record.resetAt - now) / 1000) });
      return;
    }
    if (records.size > 5000) {
      for (const [recordKey, item] of records) if (item.resetAt <= now) records.delete(recordKey);
    }
    next();
  };
}

function attachSdkAuth(req: Request, auth: AuthContext): void {
  (req as Request & { auth?: AuthInfo }).auth = {
    token: "verified",
    clientId: auth.clientId,
    scopes: [...auth.scopes],
    ...(auth.expiresAt ? { expiresAt: auth.expiresAt } : {}),
  };
}

export function createApp(config: AppConfig, logger: Logger, wordpress: WordPressClient) {
  const app = createMcpExpressApp({ host: "0.0.0.0" });
  const oauth = new OAuthService(config, logger);
  const sessions = new Map<string, SessionEntry>();

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
  app.post(
    "/oauth/authorize",
    createRateLimit({ windowMs: 15 * 60_000, max: 10, keyPrefix: "oauth-authorize" }),
  );
  app.use(createOAuthRouter(config, oauth));
  app.use(express.json({ limit: "2mb", type: ["application/json", "application/*+json"] }));

  app.get("/", (_req, res) => {
    res.json({
      name: "Simpli WordPress MCP",
      version: "1.0.0",
      transport: "MCP Streamable HTTP",
      mcp: `${config.publicBaseUrl}/mcp`,
      health: `${config.publicBaseUrl}/health`,
      readiness: `${config.publicBaseUrl}/ready`,
      authentication: oauth.enabled ? "OAuth 2.1 with PKCE" : "Static bearer token",
    });
  });

  app.get("/docs", (_req, res) => {
    res.type("text/plain").send([
      "Simpli WordPress MCP gateway",
      "",
      "MCP endpoint: /mcp (Streamable HTTP)",
      "OAuth metadata: /.well-known/oauth-protected-resource",
      "Liveness: /health",
      "WordPress readiness: /ready",
      "",
      "The gateway dynamically mirrors REST-exposed WordPress Abilities and preserves each ability's input schema and safety annotations.",
    ].join("\n"));
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", uptimeSeconds: Math.round(process.uptime()), version: "1.0.0" });
  });

  app.get("/ready", async (_req, res) => {
    const readiness = await wordpress.readiness();
    res.status(readiness.ready ? 200 : 503).json(readiness);
  });

  const mcpRateLimit = createRateLimit({ windowMs: 60_000, max: 300, keyPrefix: "mcp" });

  app.post("/mcp", mcpRateLimit, oauth.authenticate, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    attachSdkAuth(req, auth);
    const sessionIdHeader = req.header("mcp-session-id");
    try {
      if (sessionIdHeader) {
        const entry = sessions.get(sessionIdHeader);
        if (!entry) {
          res.status(404).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unknown MCP session" }, id: null });
          return;
        }
        if (entry.auth.clientId !== auth.clientId || entry.auth.subject !== auth.subject) {
          res.status(403).json({ jsonrpc: "2.0", error: { code: -32002, message: "MCP session identity mismatch" }, id: null });
          return;
        }
        await entry.transport.handleRequest(req, res, req.body);
        return;
      }

      if (!isInitializeRequest(req.body)) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Initialize the MCP session before calling tools" },
          id: null,
        });
        return;
      }

      let entry: SessionEntry;
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
          sessions.set(sessionId, entry);
          logger.info("MCP session initialized", { sessionId, authMode: auth.mode });
        },
      });
      const mcpServer = createMcpServer(config, wordpress, auth, logger);
      entry = { transport, server: mcpServer, auth, createdAt: Date.now() };
      transport.onclose = () => {
        const sessionId = transport.sessionId;
        if (sessionId) sessions.delete(sessionId);
        logger.info("MCP session closed", { sessionId: sessionId ?? "uninitialized" });
      };
      transport.onerror = (error) => logger.warn("MCP transport error", { error: error.message });
      await mcpServer.connect(transport as unknown as Transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error("MCP POST request failed", { error: error instanceof Error ? error.message : String(error) });
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  });

  app.get("/mcp", mcpRateLimit, oauth.authenticate, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    attachSdkAuth(req, auth);
    const sessionId = req.header("mcp-session-id");
    const entry = sessionId ? sessions.get(sessionId) : undefined;
    if (!entry) {
      res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "Invalid or missing MCP session" }, id: null });
      return;
    }
    if (entry.auth.clientId !== auth.clientId || entry.auth.subject !== auth.subject) {
      res.status(403).json({ jsonrpc: "2.0", error: { code: -32002, message: "MCP session identity mismatch" }, id: null });
      return;
    }
    await entry.transport.handleRequest(req, res);
  });

  app.delete("/mcp", mcpRateLimit, oauth.authenticate, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    attachSdkAuth(req, auth);
    const sessionId = req.header("mcp-session-id");
    const entry = sessionId ? sessions.get(sessionId) : undefined;
    if (!entry) {
      res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "Invalid or missing MCP session" }, id: null });
      return;
    }
    if (entry.auth.clientId !== auth.clientId || entry.auth.subject !== auth.subject) {
      res.status(403).json({ jsonrpc: "2.0", error: { code: -32002, message: "MCP session identity mismatch" }, id: null });
      return;
    }
    await entry.transport.handleRequest(req, res);
  });

  app.use((_req, res) => res.status(404).json({ error: "not_found" }));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    logger.error("Unhandled HTTP error", { error: error instanceof Error ? error.message : String(error) });
    if (!res.headersSent) res.status(500).json({ error: "internal_server_error" });
  });

  return { app, sessions, oauth };
}

export async function startServer(config = loadConfig()): Promise<HttpServer> {
  const logger = createLogger(config);
  const wordpress = new WordPressClient(config, logger);
  const { app, sessions } = createApp(config, logger, wordpress);
  logger.info("Starting Simpli WordPress MCP", redactConfig(config));

  const httpServer = createServer(app);
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(config.port, "0.0.0.0", () => resolve());
  });
  logger.info("Simpli WordPress MCP listening", { port: config.port });

  void wordpress.readiness().then((readiness) => {
    if (readiness.ready) {
      logger.info("Simpli MCP backend readiness verified", readiness);
      return;
    }
    logger.warn("Simpli MCP backend readiness failed", readiness);
  }).catch((error) => {
    logger.warn("Initial Simpli MCP readiness probe failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  const shutdown = async (signal: string) => {
    logger.info("Shutdown requested", { signal, sessions: sessions.size });
    for (const entry of sessions.values()) {
      await entry.transport.close().catch(() => undefined);
      await entry.server.close().catch(() => undefined);
    }
    sessions.clear();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
  return httpServer;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().catch((error) => {
    console.error(JSON.stringify({ level: "error", message: "Startup failed", error: error instanceof Error ? error.message : String(error) }));
    process.exit(1);
  });
}
