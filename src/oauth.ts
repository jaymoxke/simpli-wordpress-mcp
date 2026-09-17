import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response, Router } from "express";
import express from "express";
import helmet from "helmet";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import {
  constantTimeEqual,
  hashOpaqueToken,
  randomOpaqueToken,
  sha256Base64Url,
} from "./crypto.js";
import type { Logger } from "./logger.js";
import { OAuthStateStore, OAuthStoreError } from "./oauth-store.js";

export const SUPPORTED_SCOPES = [
  "wordpress:read",
  "wordpress:write",
  "wordpress:dangerous",
] as const;

export interface AuthContext {
  subject: string;
  clientId: string;
  scopes: Set<string>;
  expiresAt?: number;
  mode: "oauth" | "static";
}

const RegistrationSchema = z.object({
  redirect_uris: z.array(z.string().url().max(2048)).min(1).max(10),
  client_name: z.string().trim().min(1).max(100).default("MCP client"),
  token_endpoint_auth_method: z.literal("none").optional(),
  grant_types: z.array(z.enum(["authorization_code", "refresh_token"])).max(2).optional(),
  response_types: z.array(z.literal("code")).max(1).optional(),
});

const AuthorizeSchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1).max(256),
  redirect_uri: z.string().url().max(2048),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal("S256"),
  state: z.string().max(2048).optional(),
  scope: z.string().max(512).optional(),
  resource: z.string().url().max(2048),
});

const TokenSchema = z.discriminatedUnion("grant_type", [
  z.object({
    grant_type: z.literal("authorization_code"),
    code: z.string().min(32).max(512),
    client_id: z.string().min(1).max(256),
    redirect_uri: z.string().url().max(2048),
    code_verifier: z.string().min(43).max(128),
    resource: z.string().url().max(2048).optional(),
  }),
  z.object({
    grant_type: z.literal("refresh_token"),
    refresh_token: z.string().min(32).max(512),
    client_id: z.string().min(1).max(256),
    scope: z.string().max(512).optional(),
    resource: z.string().url().max(2048).optional(),
  }),
]);

const RevocationSchema = z.object({
  token: z.string().min(32).max(512),
  client_id: z.string().min(1).max(256).optional(),
});

const ClientRevocationSchema = z.object({
  client_id: z.string().min(1).max(256),
  admin_password: z.string().min(1).max(1024),
});

function isAllowedRedirect(value: string): boolean {
  const url = new URL(value);
  if (url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  return (
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)
  );
}

function parseScopes(value?: string, fallback: readonly string[] = ["wordpress:read"]): string[] {
  const requested = value?.trim() ? value.trim().split(/\s+/) : [...fallback];
  const unique = [...new Set(requested)];
  if (unique.length === 0) throw new Error("At least one OAuth scope is required");
  if (unique.some((scope) => !SUPPORTED_SCOPES.includes(scope as (typeof SUPPORTED_SCOPES)[number]))) {
    throw new Error("Unsupported OAuth scope requested");
  }
  return unique;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function oauthError(res: Response, status: number, error: string, description: string): void {
  res.set("Cache-Control", "no-store").status(status).json({ error, error_description: description });
}

export class OAuthService {
  private readonly state?: OAuthStateStore;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {
    if (config.oauthAdminPassword && config.oauthStateDbPath) {
      this.state = new OAuthStateStore(config.oauthStateDbPath);
    }
  }

  get enabled(): boolean {
    return Boolean(this.state && this.config.oauthAdminPassword);
  }

  close(): void {
    this.state?.close();
  }

  status(): Record<string, unknown> {
    if (!this.state) return { enabled: false, storage: "disabled", healthy: true };
    const state = this.state.status();
    return {
      enabled: true,
      ...state,
      healthy: this.state.quickCheck(),
      tokenModel: "opaque-sha256",
      refreshRotation: true,
      authorizationCodeReplayProtection: "durable",
    };
  }

  private requireState(): OAuthStateStore {
    if (!this.state) throw new Error("OAuth is not configured");
    return this.state;
  }

  registerClient = (req: Request, res: Response): void => {
    if (!this.enabled) return oauthError(res, 503, "temporarily_unavailable", "OAuth is disabled");
    const parsed = RegistrationSchema.safeParse(req.body);
    if (!parsed.success || parsed.data.redirect_uris.some((uri) => !isAllowedRedirect(uri))) {
      return oauthError(res, 400, "invalid_redirect_uri", "Use HTTPS redirect URIs (localhost may use HTTP)");
    }

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 365 * 24 * 60 * 60;
    const clientId = randomOpaqueToken("mcpclient");
    const state = this.requireState();
    state.prune(now);
    state.registerClient({
      clientId,
      clientName: parsed.data.client_name,
      redirectUris: parsed.data.redirect_uris,
      now,
      expiresAt,
    });

    res.set("Cache-Control", "no-store").status(201).json({
      client_id: clientId,
      client_id_issued_at: now,
      client_id_expires_at: expiresAt,
      client_name: parsed.data.client_name,
      redirect_uris: parsed.data.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
  };

  authorizePage = (req: Request, res: Response): void => {
    if (!this.enabled) return oauthError(res, 503, "temporarily_unavailable", "OAuth is disabled");
    const parsed = AuthorizeSchema.safeParse(req.query);
    if (!parsed.success || parsed.data.resource !== this.config.resourceUrl) {
      return oauthError(res, 400, "invalid_request", "Invalid authorization request");
    }

    const now = Math.floor(Date.now() / 1000);
    let client;
    let scopes: string[];
    try {
      client = this.requireState().getActiveClient(parsed.data.client_id, now);
      scopes = parseScopes(parsed.data.scope);
    } catch {
      return oauthError(res, 400, "invalid_client", "Invalid OAuth client or scope");
    }

    if (!client.redirectUris.includes(parsed.data.redirect_uri)) {
      return oauthError(res, 400, "invalid_redirect_uri", "Redirect URI is not registered");
    }

    const fields = Object.entries(parsed.data)
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(String(value))}">`)
      .join("\n");
    res.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize Simpli WordPress MCP</title><style>
body{font-family:system-ui,sans-serif;background:#f6f7f9;color:#17202a;margin:0;padding:2rem}.card{max-width:34rem;margin:5vh auto;background:white;padding:2rem;border-radius:1rem;box-shadow:0 12px 40px #0001}h1{font-size:1.5rem}code{background:#f1f3f5;padding:.15rem .35rem;border-radius:.3rem}label{display:block;font-weight:600;margin:1.25rem 0 .4rem}input[type=password]{box-sizing:border-box;width:100%;padding:.8rem;border:1px solid #aeb6bf;border-radius:.5rem}button{margin-top:1rem;padding:.8rem 1rem;border:0;border-radius:.5rem;background:#111827;color:white;font-weight:700;cursor:pointer}.warning{padding:.8rem;background:#fff7ed;border-left:4px solid #f97316}.scopes{line-height:1.7}
</style></head><body><main class="card"><h1>Authorize WordPress control</h1>
<p><strong>${escapeHtml(client.clientName)}</strong> is requesting access to the Simpli WordPress MCP gateway.</p>
<div class="warning">This connection can modify a live WordPress site if write scopes and separate execution authority are later granted. Approve only a client you initiated.</div>
<p class="scopes"><strong>Requested OAuth scopes:</strong><br>${scopes.map(escapeHtml).join("<br>")}</p>
<p><strong>Return address:</strong> <code>${escapeHtml(parsed.data.redirect_uri)}</code></p>
<form method="post" action="/oauth/authorize">${fields}<label for="admin_password">Owner authorization password</label><input id="admin_password" name="admin_password" type="password" autocomplete="current-password" required><button type="submit">Authorize connection</button></form>
</main></body></html>`);
  };

  authorizeSubmit = (req: Request, res: Response): void => {
    if (!this.enabled) return oauthError(res, 503, "temporarily_unavailable", "OAuth is disabled");
    const parsed = AuthorizeSchema.safeParse(req.body);
    const password = typeof req.body?.admin_password === "string" ? req.body.admin_password : "";
    if (!parsed.success || parsed.data.resource !== this.config.resourceUrl) {
      return oauthError(res, 400, "invalid_request", "Invalid authorization request");
    }

    const now = Math.floor(Date.now() / 1000);
    let client;
    let scopes: string[];
    try {
      client = this.requireState().getActiveClient(parsed.data.client_id, now);
      scopes = parseScopes(parsed.data.scope);
    } catch {
      return oauthError(res, 400, "invalid_client", "Invalid OAuth client or scope");
    }

    if (!client.redirectUris.includes(parsed.data.redirect_uri)) {
      return oauthError(res, 400, "invalid_redirect_uri", "Redirect URI is not registered");
    }
    if (!this.config.oauthAdminPassword || !constantTimeEqual(password, this.config.oauthAdminPassword)) {
      this.logger.warn("OAuth authorization password rejected", { clientId: client.clientId.slice(0, 24) });
      return oauthError(res, 401, "access_denied", "Owner authorization failed");
    }

    const code = randomOpaqueToken("sac");
    this.requireState().createAuthorizationCode({
      codeHash: hashOpaqueToken(code),
      clientId: client.clientId,
      redirectUri: parsed.data.redirect_uri,
      codeChallenge: parsed.data.code_challenge,
      scope: scopes.join(" "),
      resource: this.config.resourceUrl,
      now,
      expiresAt: now + 300,
    });

    const redirect = new URL(parsed.data.redirect_uri);
    redirect.searchParams.set("code", code);
    if (parsed.data.state) redirect.searchParams.set("state", parsed.data.state);
    res.redirect(303, redirect.toString());
  };

  token = (req: Request, res: Response): void => {
    if (!this.enabled) return oauthError(res, 503, "temporarily_unavailable", "OAuth is disabled");
    const parsed = TokenSchema.safeParse(req.body);
    if (!parsed.success) return oauthError(res, 400, "invalid_request", "Invalid token request");

    const now = Math.floor(Date.now() / 1000);
    const resource = parsed.data.resource ?? this.config.resourceUrl;
    if (resource !== this.config.resourceUrl) {
      return oauthError(res, 400, "invalid_target", "Invalid OAuth resource");
    }

    try {
      const state = this.requireState();
      state.prune(now);

      if (parsed.data.grant_type === "authorization_code") {
        const grant = state.consumeAuthorizationCode({
          codeHash: hashOpaqueToken(parsed.data.code),
          clientId: parsed.data.client_id,
          redirectUri: parsed.data.redirect_uri,
          codeChallenge: sha256Base64Url(parsed.data.code_verifier),
          resource,
          now,
        });

        const accessToken = randomOpaqueToken("sat");
        const refreshToken = randomOpaqueToken("srt");
        const familyId = randomUUID();
        const accessExpiresAt = now + this.config.accessTokenTtlSeconds;
        const refreshExpiresAt = now + this.config.refreshTokenTtlSeconds;
        state.createInitialTokenPair({
          accessHash: hashOpaqueToken(accessToken),
          refreshHash: hashOpaqueToken(refreshToken),
          clientId: grant.clientId,
          subject: "wordpress-owner",
          scope: grant.scope,
          resource,
          familyId,
          now,
          accessExpiresAt,
          refreshExpiresAt,
        });

        return this.sendTokens(res, {
          accessToken,
          refreshToken,
          scope: grant.scope,
          expiresIn: this.config.accessTokenTtlSeconds,
        });
      }

      const requestedScope = parsed.data.scope ? parseScopes(parsed.data.scope).join(" ") : undefined;
      const newAccessToken = randomOpaqueToken("sat");
      const newRefreshToken = randomOpaqueToken("srt");
      const rotated = state.rotateRefreshToken({
        refreshHash: hashOpaqueToken(parsed.data.refresh_token),
        newAccessHash: hashOpaqueToken(newAccessToken),
        newRefreshHash: hashOpaqueToken(newRefreshToken),
        clientId: parsed.data.client_id,
        ...(requestedScope ? { requestedScope } : {}),
        resource,
        now,
        accessTtlSeconds: this.config.accessTokenTtlSeconds,
      });

      return this.sendTokens(res, {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        scope: rotated.scope,
        expiresIn: this.config.accessTokenTtlSeconds,
      });
    } catch (error) {
      this.logger.warn("OAuth grant rejected", {
        grantType: parsed.data.grant_type,
        reason: error instanceof OAuthStoreError ? error.code : "INVALID_GRANT",
      });
      return oauthError(res, 400, "invalid_grant", "Invalid OAuth grant");
    }
  };

  revokeToken = (req: Request, res: Response): void => {
    if (!this.enabled) return oauthError(res, 503, "temporarily_unavailable", "OAuth is disabled");
    const parsed = RevocationSchema.safeParse(req.body);
    if (!parsed.success) return oauthError(res, 400, "invalid_request", "Invalid revocation request");
    this.requireState().revokeToken(
      hashOpaqueToken(parsed.data.token),
      parsed.data.client_id,
      Math.floor(Date.now() / 1000),
    );
    res.set("Cache-Control", "no-store").status(200).end();
  };

  revokeClient = (req: Request, res: Response): void => {
    if (!this.enabled) return oauthError(res, 503, "temporarily_unavailable", "OAuth is disabled");
    const parsed = ClientRevocationSchema.safeParse(req.body);
    if (!parsed.success) return oauthError(res, 400, "invalid_request", "Invalid client revocation request");
    if (!this.config.oauthAdminPassword || !constantTimeEqual(parsed.data.admin_password, this.config.oauthAdminPassword)) {
      this.logger.warn("OAuth client revocation password rejected", { clientId: parsed.data.client_id.slice(0, 24) });
      return oauthError(res, 401, "access_denied", "Owner authorization failed");
    }
    this.requireState().revokeClient(parsed.data.client_id, Math.floor(Date.now() / 1000));
    res.set("Cache-Control", "no-store").status(204).end();
  };

  private sendTokens(
    res: Response,
    payload: { accessToken: string; refreshToken: string; scope: string; expiresIn: number },
  ): void {
    res.set("Cache-Control", "no-store").json({
      access_token: payload.accessToken,
      refresh_token: payload.refreshToken,
      token_type: "Bearer",
      expires_in: payload.expiresIn,
      scope: payload.scope,
    });
  }

  verifyBearer(token: string): AuthContext {
    if (this.config.staticToken && constantTimeEqual(token, this.config.staticToken)) {
      return {
        subject: "static-token-user",
        clientId: "static-token",
        scopes: new Set(SUPPORTED_SCOPES),
        mode: "static",
      };
    }
    if (!this.enabled) throw new Error("Bearer token is invalid");

    try {
      const record = this.requireState().verifyAccessToken(
        hashOpaqueToken(token),
        Math.floor(Date.now() / 1000),
        this.config.resourceUrl,
      );
      return {
        subject: record.subject,
        clientId: record.clientId,
        scopes: new Set(parseScopes(record.scope)),
        expiresAt: record.expiresAt,
        mode: "oauth",
      };
    } catch {
      throw new Error("Bearer token is invalid");
    }
  }

  authenticate = (req: Request, res: Response, next: NextFunction): void => {
    const authorization = req.header("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(authorization);
    if (!match?.[1]) return this.unauthorized(res, "Missing bearer token");
    try {
      res.locals.auth = this.verifyBearer(match[1]);
      next();
    } catch {
      this.unauthorized(res, "Bearer token is invalid");
    }
  };

  private unauthorized(res: Response, description: string): void {
    res.set(
      "WWW-Authenticate",
      `Bearer resource_metadata="${this.config.publicBaseUrl}/.well-known/oauth-protected-resource"`,
    );
    res.set("Cache-Control", "no-store").status(401).json({ error: "invalid_token", error_description: description });
  }
}

export function createOAuthRouter(config: AppConfig, service: OAuthService): Router {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false, limit: "32kb" }));
  router.all(
    "/oauth/authorize",
    helmet.contentSecurityPolicy({
      directives: {
        defaultSrc: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        formAction: ["'self'", "https://chatgpt.com"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
      },
    }),
    (_req, res, next) => {
      res.set("Cross-Origin-Opener-Policy", "unsafe-none");
      next();
    },
  );

  const protectedResource = {
    resource: config.resourceUrl,
    authorization_servers: [config.publicBaseUrl],
    scopes_supported: [...SUPPORTED_SCOPES],
    resource_name: "Simpli WordPress MCP",
    resource_documentation: `${config.publicBaseUrl}/docs`,
  };
  const authorizationMetadata = {
    issuer: config.publicBaseUrl,
    authorization_endpoint: `${config.publicBaseUrl}/oauth/authorize`,
    token_endpoint: `${config.publicBaseUrl}/oauth/token`,
    registration_endpoint: `${config.publicBaseUrl}/oauth/register`,
    revocation_endpoint: `${config.publicBaseUrl}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...SUPPORTED_SCOPES],
  };

  router.get("/.well-known/oauth-protected-resource", (_req, res) => res.json(protectedResource));
  router.get("/.well-known/oauth-protected-resource/mcp", (_req, res) => res.json(protectedResource));
  router.get("/.well-known/oauth-authorization-server", (_req, res) => res.json(authorizationMetadata));
  router.post("/oauth/register", express.json({ limit: "32kb" }), service.registerClient);
  router.get("/oauth/authorize", service.authorizePage);
  router.post("/oauth/authorize", service.authorizeSubmit);
  router.post("/oauth/token", service.token);
  router.post("/oauth/revoke", service.revokeToken);
  router.post("/oauth/client/revoke", service.revokeClient);
  return router;
}

export function requireScope(auth: AuthContext, scope: (typeof SUPPORTED_SCOPES)[number]): void {
  if (!auth.scopes.has(scope)) throw new Error(`Missing required OAuth scope: ${scope}`);
}
