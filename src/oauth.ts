import type { NextFunction, Request, Response, Router } from "express";
import express from "express";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import {
  constantTimeEqual,
  issueSignedToken,
  sha256Base64Url,
  verifySignedToken,
  type TokenClaims,
} from "./crypto.js";
import type { Logger } from "./logger.js";

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

interface ClientClaims extends TokenClaims {
  typ: "client";
  redirect_uris: string[];
  client_name: string;
}

interface CodeClaims extends TokenClaims {
  typ: "authorization_code";
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string;
}

interface AccessClaims extends TokenClaims {
  typ: "access_token";
  client_id: string;
  scope: string;
}

interface RefreshClaims extends TokenClaims {
  typ: "refresh_token";
  client_id: string;
  scope: string;
}

const RegistrationSchema = z.object({
  redirect_uris: z.array(z.string().url().max(2048)).min(1).max(10),
  client_name: z.string().trim().min(1).max(100).default("MCP client"),
  token_endpoint_auth_method: z.literal("none").optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
});

const AuthorizeSchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal("S256"),
  state: z.string().max(2048).optional(),
  scope: z.string().max(512).optional(),
  resource: z.string().url(),
});

const TokenSchema = z.discriminatedUnion("grant_type", [
  z.object({
    grant_type: z.literal("authorization_code"),
    code: z.string().min(1),
    client_id: z.string().min(1),
    redirect_uri: z.string().url(),
    code_verifier: z.string().min(43).max(128),
    resource: z.string().url().optional(),
  }),
  z.object({
    grant_type: z.literal("refresh_token"),
    refresh_token: z.string().min(1),
    client_id: z.string().min(1),
    scope: z.string().max(512).optional(),
    resource: z.string().url().optional(),
  }),
]);

function isAllowedRedirect(value: string): boolean {
  const url = new URL(value);
  if (url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  return (
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)
  );
}

function parseScopes(value?: string): string[] {
  const requested = value?.trim() ? value.trim().split(/\s+/) : [...SUPPORTED_SCOPES];
  const unique = [...new Set(requested)];
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
  res.status(status).json({ error, error_description: description });
}

export class OAuthService {
  private readonly usedCodes = new Map<string, number>();

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  get enabled(): boolean {
    return Boolean(this.config.oauthSigningSecret && this.config.oauthAdminPassword);
  }

  private requireSecret(): string {
    if (!this.config.oauthSigningSecret) throw new Error("OAuth is not configured");
    return this.config.oauthSigningSecret;
  }

  private clientAudience(): string {
    return `${this.config.publicBaseUrl}/oauth/client`;
  }

  private verifyClient(clientId: string): ClientClaims {
    return verifySignedToken<ClientClaims>(this.requireSecret(), clientId, {
      issuer: this.config.publicBaseUrl,
      audience: this.clientAudience(),
      type: "client",
    });
  }

  registerClient = (req: Request, res: Response): void => {
    if (!this.enabled) return oauthError(res, 503, "temporarily_unavailable", "OAuth is disabled");
    const parsed = RegistrationSchema.safeParse(req.body);
    if (!parsed.success || parsed.data.redirect_uris.some((uri) => !isAllowedRedirect(uri))) {
      return oauthError(res, 400, "invalid_redirect_uri", "Use HTTPS redirect URIs (localhost may use HTTP)");
    }
    const now = Math.floor(Date.now() / 1000);
    const clientId = issueSignedToken(this.requireSecret(), {
      iss: this.config.publicBaseUrl,
      aud: this.clientAudience(),
      sub: parsed.data.client_name,
      typ: "client",
      exp: now + 365 * 24 * 60 * 60,
      redirect_uris: parsed.data.redirect_uris,
      client_name: parsed.data.client_name,
    });
    res.status(201).json({
      client_id: clientId,
      client_id_issued_at: now,
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
    let client: ClientClaims;
    let scopes: string[];
    try {
      client = this.verifyClient(parsed.data.client_id);
      scopes = parseScopes(parsed.data.scope);
    } catch (error) {
      return oauthError(res, 400, "invalid_client", error instanceof Error ? error.message : "Invalid client");
    }
    if (!client.redirect_uris.includes(parsed.data.redirect_uri)) {
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
<p><strong>${escapeHtml(client.client_name)}</strong> is requesting access to the Simpli WordPress MCP gateway.</p>
<div class="warning">This connection can modify a live WordPress site. Approve only a client you initiated.</div>
<p class="scopes"><strong>Permissions:</strong><br>${scopes.map(escapeHtml).join("<br>")}</p>
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
    let client: ClientClaims;
    let scopes: string[];
    try {
      client = this.verifyClient(parsed.data.client_id);
      scopes = parseScopes(parsed.data.scope);
    } catch (error) {
      return oauthError(res, 400, "invalid_client", error instanceof Error ? error.message : "Invalid client");
    }
    if (!client.redirect_uris.includes(parsed.data.redirect_uri)) {
      return oauthError(res, 400, "invalid_redirect_uri", "Redirect URI is not registered");
    }
    if (!this.config.oauthAdminPassword || !constantTimeEqual(password, this.config.oauthAdminPassword)) {
      this.logger.warn("OAuth authorization password rejected", { clientName: client.client_name });
      return oauthError(res, 401, "access_denied", "Owner authorization failed");
    }

    const now = Math.floor(Date.now() / 1000);
    const code = issueSignedToken(this.requireSecret(), {
      iss: this.config.publicBaseUrl,
      aud: this.config.resourceUrl,
      sub: "wordpress-owner",
      typ: "authorization_code",
      exp: now + 300,
      client_id: parsed.data.client_id,
      redirect_uri: parsed.data.redirect_uri,
      code_challenge: parsed.data.code_challenge,
      scope: scopes.join(" "),
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
    try {
      if (parsed.data.resource && parsed.data.resource !== this.config.resourceUrl) {
        throw new Error("Invalid resource");
      }
      if (parsed.data.grant_type === "authorization_code") {
        const claims = verifySignedToken<CodeClaims>(this.requireSecret(), parsed.data.code, {
          issuer: this.config.publicBaseUrl,
          audience: this.config.resourceUrl,
          type: "authorization_code",
        });
        if (
          claims.client_id !== parsed.data.client_id ||
          claims.redirect_uri !== parsed.data.redirect_uri ||
          sha256Base64Url(parsed.data.code_verifier) !== claims.code_challenge
        ) {
          throw new Error("Authorization code binding failed");
        }
        this.pruneUsedCodes();
        if (this.usedCodes.has(claims.jti)) throw new Error("Authorization code was already used");
        this.usedCodes.set(claims.jti, claims.exp);
        return this.sendTokens(res, claims.client_id, claims.scope, true);
      }

      const claims = verifySignedToken<RefreshClaims>(this.requireSecret(), parsed.data.refresh_token, {
        issuer: this.config.publicBaseUrl,
        audience: this.config.resourceUrl,
        type: "refresh_token",
      });
      if (claims.client_id !== parsed.data.client_id) throw new Error("Refresh token binding failed");
      const originalScopes = parseScopes(claims.scope);
      const requestedScopes = parsed.data.scope ? parseScopes(parsed.data.scope) : originalScopes;
      if (requestedScopes.some((scope) => !originalScopes.includes(scope))) {
        throw new Error("Refresh request cannot increase scopes");
      }
      return this.sendTokens(res, claims.client_id, requestedScopes.join(" "), false);
    } catch (error) {
      return oauthError(res, 400, "invalid_grant", error instanceof Error ? error.message : "Invalid grant");
    }
  };

  private sendTokens(res: Response, clientId: string, scope: string, includeRefresh: boolean): void {
    const now = Math.floor(Date.now() / 1000);
    const common = {
      iss: this.config.publicBaseUrl,
      aud: this.config.resourceUrl,
      sub: "wordpress-owner",
      client_id: clientId,
      scope,
    };
    const accessToken = issueSignedToken(this.requireSecret(), {
      ...common,
      typ: "access_token",
      exp: now + this.config.accessTokenTtlSeconds,
    });
    const payload: Record<string, unknown> = {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: this.config.accessTokenTtlSeconds,
      scope,
    };
    if (includeRefresh) {
      payload.refresh_token = issueSignedToken(this.requireSecret(), {
        ...common,
        typ: "refresh_token",
        exp: now + this.config.refreshTokenTtlSeconds,
      });
    }
    res.set("Cache-Control", "no-store").json(payload);
  }

  private pruneUsedCodes(): void {
    const now = Math.floor(Date.now() / 1000);
    for (const [jti, expiry] of this.usedCodes) if (expiry <= now) this.usedCodes.delete(jti);
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
    const claims = verifySignedToken<AccessClaims>(this.requireSecret(), token, {
      issuer: this.config.publicBaseUrl,
      audience: this.config.resourceUrl,
      type: "access_token",
    });
    return {
      subject: claims.sub,
      clientId: claims.client_id,
      scopes: new Set(parseScopes(claims.scope)),
      expiresAt: claims.exp,
      mode: "oauth",
    };
  }

  authenticate = (req: Request, res: Response, next: NextFunction): void => {
    const authorization = req.header("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(authorization);
    if (!match?.[1]) return this.unauthorized(res, "Missing bearer token");
    try {
      res.locals.auth = this.verifyBearer(match[1]);
      next();
    } catch (error) {
      this.unauthorized(res, error instanceof Error ? error.message : "Invalid bearer token");
    }
  };

  private unauthorized(res: Response, description: string): void {
    res.set(
      "WWW-Authenticate",
      `Bearer resource_metadata="${this.config.publicBaseUrl}/.well-known/oauth-protected-resource"`,
    );
    res.status(401).json({ error: "invalid_token", error_description: description });
  }
}

export function createOAuthRouter(config: AppConfig, service: OAuthService): Router {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false, limit: "32kb" }));

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
  return router;
}

export function requireScope(auth: AuthContext, scope: (typeof SUPPORTED_SCOPES)[number]): void {
  if (!auth.scopes.has(scope)) throw new Error(`Missing required OAuth scope: ${scope}`);
}
