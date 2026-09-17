import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type OAuthStoreErrorCode =
  | "NOT_FOUND"
  | "EXPIRED"
  | "CONSUMED"
  | "REVOKED"
  | "BINDING_MISMATCH"
  | "SCOPE_ESCALATION"
  | "TOKEN_REUSE"
  | "CLIENT_INVALID";

export class OAuthStoreError extends Error {
  constructor(
    readonly code: OAuthStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OAuthStoreError";
  }
}

export interface OAuthClientRecord {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  createdAt: number;
  expiresAt: number;
}

export interface AccessTokenRecord {
  clientId: string;
  subject: string;
  scope: string;
  resource: string;
  expiresAt: number;
  familyId?: string;
  generation: number;
}

interface SqlRow {
  [key: string]: unknown;
}

function stringField(row: SqlRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`OAuth state row has invalid ${key}`);
  return value;
}

function numberField(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value !== "number" && typeof value !== "bigint") {
    throw new Error(`OAuth state row has invalid ${key}`);
  }
  return Number(value);
}

function nullableNumber(row: SqlRow, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" && typeof value !== "bigint") {
    throw new Error(`OAuth state row has invalid ${key}`);
  }
  return Number(value);
}

function nullableString(row: SqlRow, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`OAuth state row has invalid ${key}`);
  return value;
}

function parseRedirectUris(raw: string): string[] {
  const value = JSON.parse(raw) as unknown;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("OAuth client redirect URI state is invalid");
  }
  return value;
}

function scopeSubset(requested: string, original: string): boolean {
  const allowed = new Set(original.trim().split(/\s+/).filter(Boolean));
  return requested.trim().split(/\s+/).filter(Boolean).every((scope) => allowed.has(scope));
}

export class OAuthStateStore {
  private readonly db: DatabaseSync;
  readonly statePath: string;
  readonly durable: boolean;

  constructor(path: string) {
    this.durable = path !== ":memory:";
    this.statePath = this.durable ? resolve(path) : path;

    if (this.durable) {
      mkdirSync(dirname(this.statePath), { recursive: true, mode: 0o700 });
    }

    this.db = new DatabaseSync(this.statePath, { timeout: 5000 });
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    if (this.durable) {
      this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
      try {
        chmodSync(this.statePath, 0o600);
      } catch {
        // Some mounted filesystems do not support chmod. Database access still
        // remains controlled by the runtime account and mount permissions.
      }
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS oauth_clients (
        client_id TEXT PRIMARY KEY,
        client_name TEXT NOT NULL,
        redirect_uris_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
        code_hash TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        code_challenge TEXT NOT NULL,
        scope TEXT NOT NULL,
        resource TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER,
        FOREIGN KEY(client_id) REFERENCES oauth_clients(client_id)
      );

      CREATE INDEX IF NOT EXISTS oauth_authorization_codes_client_idx
        ON oauth_authorization_codes(client_id, expires_at);

      CREATE TABLE IF NOT EXISTS oauth_tokens (
        token_hash TEXT PRIMARY KEY,
        token_type TEXT NOT NULL CHECK(token_type IN ('access', 'refresh')),
        client_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        scope TEXT NOT NULL,
        resource TEXT NOT NULL,
        family_id TEXT,
        generation INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        revoked_at INTEGER,
        FOREIGN KEY(client_id) REFERENCES oauth_clients(client_id)
      );

      CREATE INDEX IF NOT EXISTS oauth_tokens_client_idx
        ON oauth_tokens(client_id, token_type, expires_at);
      CREATE INDEX IF NOT EXISTS oauth_tokens_family_idx
        ON oauth_tokens(family_id, token_type, generation);

      PRAGMA user_version = 1;
    `);
  }

  close(): void {
    this.db.close();
  }

  status(): { storage: "sqlite"; durable: boolean; schemaVersion: number } {
    const row = this.db.prepare("PRAGMA user_version").get() as SqlRow | undefined;
    const schemaVersion = row ? Number(Object.values(row)[0] ?? 0) : 0;
    return { storage: "sqlite", durable: this.durable, schemaVersion };
  }

  quickCheck(): boolean {
    const row = this.db.prepare("PRAGMA quick_check").get() as SqlRow | undefined;
    return Boolean(row && Object.values(row)[0] === "ok");
  }

  prune(now: number): void {
    this.db.prepare("DELETE FROM oauth_authorization_codes WHERE expires_at <= ?").run(now);
    this.db.prepare("DELETE FROM oauth_tokens WHERE expires_at <= ?").run(now);
  }

  registerClient(input: {
    clientId: string;
    clientName: string;
    redirectUris: string[];
    now: number;
    expiresAt: number;
  }): void {
    this.db.prepare(`
      INSERT INTO oauth_clients(client_id, client_name, redirect_uris_json, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      input.clientId,
      input.clientName,
      JSON.stringify(input.redirectUris),
      input.now,
      input.expiresAt,
    );
  }

  getActiveClient(clientId: string, now: number): OAuthClientRecord {
    const row = this.db.prepare(`
      SELECT client_id, client_name, redirect_uris_json, created_at, expires_at, revoked_at
      FROM oauth_clients
      WHERE client_id = ?
    `).get(clientId) as SqlRow | undefined;

    if (!row) throw new OAuthStoreError("NOT_FOUND", "OAuth client does not exist");
    if (nullableNumber(row, "revoked_at") !== null) throw new OAuthStoreError("REVOKED", "OAuth client is revoked");
    const expiresAt = numberField(row, "expires_at");
    if (expiresAt <= now) throw new OAuthStoreError("EXPIRED", "OAuth client is expired");

    return {
      clientId: stringField(row, "client_id"),
      clientName: stringField(row, "client_name"),
      redirectUris: parseRedirectUris(stringField(row, "redirect_uris_json")),
      createdAt: numberField(row, "created_at"),
      expiresAt,
    };
  }

  revokeClient(clientId: string, now: number): void {
    this.transaction(() => {
      this.db.prepare("UPDATE oauth_clients SET revoked_at = COALESCE(revoked_at, ?) WHERE client_id = ?")
        .run(now, clientId);
      this.db.prepare("UPDATE oauth_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE client_id = ?")
        .run(now, clientId);
      this.db.prepare(`
        UPDATE oauth_authorization_codes
        SET consumed_at = COALESCE(consumed_at, ?)
        WHERE client_id = ?
      `).run(now, clientId);
    });
  }

  createAuthorizationCode(input: {
    codeHash: string;
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    scope: string;
    resource: string;
    now: number;
    expiresAt: number;
  }): void {
    this.db.prepare(`
      INSERT INTO oauth_authorization_codes(
        code_hash, client_id, redirect_uri, code_challenge, scope, resource, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.codeHash,
      input.clientId,
      input.redirectUri,
      input.codeChallenge,
      input.scope,
      input.resource,
      input.now,
      input.expiresAt,
    );
  }

  consumeAuthorizationCode(input: {
    codeHash: string;
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    resource: string;
    now: number;
  }): { scope: string; clientId: string } {
    return this.transaction(() => {
      const row = this.db.prepare(`
        SELECT c.code_hash, c.client_id, c.redirect_uri, c.code_challenge, c.scope, c.resource,
               c.expires_at, c.consumed_at, cl.expires_at AS client_expires_at, cl.revoked_at AS client_revoked_at
        FROM oauth_authorization_codes c
        JOIN oauth_clients cl ON cl.client_id = c.client_id
        WHERE c.code_hash = ?
      `).get(input.codeHash) as SqlRow | undefined;

      if (!row) throw new OAuthStoreError("NOT_FOUND", "Authorization code is invalid");
      if (nullableNumber(row, "consumed_at") !== null) {
        throw new OAuthStoreError("CONSUMED", "Authorization code was already used");
      }
      if (numberField(row, "expires_at") <= input.now) {
        throw new OAuthStoreError("EXPIRED", "Authorization code is expired");
      }
      if (
        nullableNumber(row, "client_revoked_at") !== null ||
        numberField(row, "client_expires_at") <= input.now
      ) {
        throw new OAuthStoreError("CLIENT_INVALID", "OAuth client is not active");
      }
      if (
        stringField(row, "client_id") !== input.clientId ||
        stringField(row, "redirect_uri") !== input.redirectUri ||
        stringField(row, "code_challenge") !== input.codeChallenge ||
        stringField(row, "resource") !== input.resource
      ) {
        throw new OAuthStoreError("BINDING_MISMATCH", "Authorization code binding failed");
      }

      const consumed = this.db.prepare(`
        UPDATE oauth_authorization_codes
        SET consumed_at = ?
        WHERE code_hash = ? AND consumed_at IS NULL
      `).run(input.now, input.codeHash);
      if (Number(consumed.changes) !== 1) {
        throw new OAuthStoreError("CONSUMED", "Authorization code was already used");
      }

      return { scope: stringField(row, "scope"), clientId: stringField(row, "client_id") };
    });
  }

  createInitialTokenPair(input: {
    accessHash: string;
    refreshHash: string;
    clientId: string;
    subject: string;
    scope: string;
    resource: string;
    familyId: string;
    now: number;
    accessExpiresAt: number;
    refreshExpiresAt: number;
  }): void {
    this.transaction(() => {
      this.assertActiveClient(input.clientId, input.now);
      this.insertToken({
        tokenHash: input.accessHash,
        tokenType: "access",
        clientId: input.clientId,
        subject: input.subject,
        scope: input.scope,
        resource: input.resource,
        familyId: input.familyId,
        generation: 0,
        now: input.now,
        expiresAt: input.accessExpiresAt,
      });
      this.insertToken({
        tokenHash: input.refreshHash,
        tokenType: "refresh",
        clientId: input.clientId,
        subject: input.subject,
        scope: input.scope,
        resource: input.resource,
        familyId: input.familyId,
        generation: 0,
        now: input.now,
        expiresAt: input.refreshExpiresAt,
      });
    });
  }

  rotateRefreshToken(input: {
    refreshHash: string;
    newAccessHash: string;
    newRefreshHash: string;
    clientId: string;
    requestedScope?: string;
    resource: string;
    now: number;
    accessTtlSeconds: number;
  }): { scope: string; accessExpiresAt: number; refreshExpiresAt: number; familyId: string; generation: number } {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare(`
        SELECT t.token_hash, t.token_type, t.client_id, t.subject, t.scope, t.resource, t.family_id,
               t.generation, t.expires_at, t.used_at, t.revoked_at,
               c.expires_at AS client_expires_at, c.revoked_at AS client_revoked_at
        FROM oauth_tokens t
        JOIN oauth_clients c ON c.client_id = t.client_id
        WHERE t.token_hash = ?
      `).get(input.refreshHash) as SqlRow | undefined;

      if (!row || stringField(row, "token_type") !== "refresh") {
        throw new OAuthStoreError("NOT_FOUND", "Refresh token is invalid");
      }

      const familyId = nullableString(row, "family_id");
      if (!familyId) throw new OAuthStoreError("REVOKED", "Refresh token family is invalid");

      if (nullableNumber(row, "used_at") !== null) {
        this.db.prepare(`
          UPDATE oauth_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE family_id = ?
        `).run(input.now, familyId);
        this.db.exec("COMMIT");
        throw new OAuthStoreError("TOKEN_REUSE", "Refresh token reuse detected");
      }
      if (nullableNumber(row, "revoked_at") !== null) {
        throw new OAuthStoreError("REVOKED", "Refresh token is revoked");
      }
      if (numberField(row, "expires_at") <= input.now) {
        throw new OAuthStoreError("EXPIRED", "Refresh token is expired");
      }
      if (
        nullableNumber(row, "client_revoked_at") !== null ||
        numberField(row, "client_expires_at") <= input.now
      ) {
        throw new OAuthStoreError("CLIENT_INVALID", "OAuth client is not active");
      }
      if (
        stringField(row, "client_id") !== input.clientId ||
        stringField(row, "resource") !== input.resource
      ) {
        throw new OAuthStoreError("BINDING_MISMATCH", "Refresh token binding failed");
      }

      const originalScope = stringField(row, "scope");
      const scope = input.requestedScope?.trim() ? input.requestedScope.trim() : originalScope;
      if (!scopeSubset(scope, originalScope)) {
        throw new OAuthStoreError("SCOPE_ESCALATION", "Refresh token cannot increase scope");
      }

      const used = this.db.prepare(`
        UPDATE oauth_tokens SET used_at = ?
        WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL
      `).run(input.now, input.refreshHash);
      if (Number(used.changes) !== 1) {
        throw new OAuthStoreError("TOKEN_REUSE", "Refresh token was already used");
      }

      const generation = numberField(row, "generation") + 1;
      const refreshExpiresAt = numberField(row, "expires_at");
      const accessExpiresAt = input.now + input.accessTtlSeconds;
      const subject = stringField(row, "subject");

      this.insertToken({
        tokenHash: input.newAccessHash,
        tokenType: "access",
        clientId: input.clientId,
        subject,
        scope,
        resource: input.resource,
        familyId,
        generation,
        now: input.now,
        expiresAt: accessExpiresAt,
      });
      this.insertToken({
        tokenHash: input.newRefreshHash,
        tokenType: "refresh",
        clientId: input.clientId,
        subject,
        scope,
        resource: input.resource,
        familyId,
        generation,
        now: input.now,
        expiresAt: refreshExpiresAt,
      });

      this.db.exec("COMMIT");
      return { scope, accessExpiresAt, refreshExpiresAt, familyId, generation };
    } catch (error) {
      if (error instanceof OAuthStoreError && error.code === "TOKEN_REUSE") {
        // A reuse branch may already have committed the family revocation.
        if (!this.db.isTransaction) throw error;
      }
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw error;
    }
  }

  verifyAccessToken(tokenHash: string, now: number, resource: string): AccessTokenRecord {
    const row = this.db.prepare(`
      SELECT t.token_type, t.client_id, t.subject, t.scope, t.resource, t.family_id, t.generation,
             t.expires_at, t.revoked_at, c.expires_at AS client_expires_at, c.revoked_at AS client_revoked_at
      FROM oauth_tokens t
      JOIN oauth_clients c ON c.client_id = t.client_id
      WHERE t.token_hash = ?
    `).get(tokenHash) as SqlRow | undefined;

    if (!row || stringField(row, "token_type") !== "access") {
      throw new OAuthStoreError("NOT_FOUND", "Access token is invalid");
    }
    if (nullableNumber(row, "revoked_at") !== null) throw new OAuthStoreError("REVOKED", "Access token is revoked");
    if (numberField(row, "expires_at") <= now) throw new OAuthStoreError("EXPIRED", "Access token is expired");
    if (
      nullableNumber(row, "client_revoked_at") !== null ||
      numberField(row, "client_expires_at") <= now
    ) {
      throw new OAuthStoreError("CLIENT_INVALID", "OAuth client is not active");
    }
    if (stringField(row, "resource") !== resource) {
      throw new OAuthStoreError("BINDING_MISMATCH", "Access token resource does not match");
    }

    return {
      clientId: stringField(row, "client_id"),
      subject: stringField(row, "subject"),
      scope: stringField(row, "scope"),
      resource: stringField(row, "resource"),
      expiresAt: numberField(row, "expires_at"),
      ...(nullableString(row, "family_id") ? { familyId: nullableString(row, "family_id")! } : {}),
      generation: numberField(row, "generation"),
    };
  }

  revokeToken(tokenHash: string, clientId: string | undefined, now: number): void {
    this.transaction(() => {
      const row = this.db.prepare(`
        SELECT token_type, client_id, family_id FROM oauth_tokens WHERE token_hash = ?
      `).get(tokenHash) as SqlRow | undefined;
      if (!row) return;
      if (clientId && stringField(row, "client_id") !== clientId) return;

      const familyId = nullableString(row, "family_id");
      if (stringField(row, "token_type") === "refresh" && familyId) {
        this.db.prepare(`UPDATE oauth_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE family_id = ?`)
          .run(now, familyId);
        return;
      }
      this.db.prepare(`UPDATE oauth_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE token_hash = ?`)
        .run(now, tokenHash);
    });
  }

  private assertActiveClient(clientId: string, now: number): void {
    const row = this.db.prepare(`SELECT expires_at, revoked_at FROM oauth_clients WHERE client_id = ?`)
      .get(clientId) as SqlRow | undefined;
    if (!row) throw new OAuthStoreError("CLIENT_INVALID", "OAuth client does not exist");
    if (nullableNumber(row, "revoked_at") !== null || numberField(row, "expires_at") <= now) {
      throw new OAuthStoreError("CLIENT_INVALID", "OAuth client is not active");
    }
  }

  private insertToken(input: {
    tokenHash: string;
    tokenType: "access" | "refresh";
    clientId: string;
    subject: string;
    scope: string;
    resource: string;
    familyId: string;
    generation: number;
    now: number;
    expiresAt: number;
  }): void {
    this.db.prepare(`
      INSERT INTO oauth_tokens(
        token_hash, token_type, client_id, subject, scope, resource, family_id,
        generation, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.tokenHash,
      input.tokenType,
      input.clientId,
      input.subject,
      input.scope,
      input.resource,
      input.familyId,
      input.generation,
      input.now,
      input.expiresAt,
    );
  }

  private transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
