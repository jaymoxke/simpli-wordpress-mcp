import { access, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import type { AppConfig } from "./config.js";
import type { Logger } from "./logger.js";

interface AdminAccessPayload {
  exchange_url: string;
  exchange_method: string;
  access_token: string;
  token_header: string;
  access_nonce: string;
  nonce_header: string;
}

interface ExchangePayload {
  login_url: string;
}

interface EditorObservation {
  ready: boolean;
  score: number | null;
  refreshing: boolean | null;
  href: string;
  title: string;
  readyState: string;
  editor: string;
}

export interface LiveRankMathScore {
  post_id: number;
  seo_score: number;
  source: "rank_math_editor";
  verification: "verified_live";
  stale: false;
  editor: string;
  stable_samples: number;
  observed_at: string;
}

const SCORE_EXPRESSION = `(() => {
  const select = globalThis.wp?.data?.select;
  if (typeof select !== "function") {
    return { ready: false, score: null, refreshing: null, href: location.href, title: document.title, readyState: document.readyState, editor: "unknown" };
  }
  let store;
  try { store = select("rank-math"); } catch { store = null; }
  if (!store || typeof store.getAnalysisScore !== "function") {
    return { ready: false, score: null, refreshing: null, href: location.href, title: document.title, readyState: document.readyState, editor: "unknown" };
  }
  const value = Number(store.getAnalysisScore());
  const refreshing = typeof store.isRefreshing === "function" ? Boolean(store.isRefreshing()) : null;
  const editor = document.body?.classList?.contains("block-editor-page") ? "gutenberg" : "wordpress";
  return {
    ready: Number.isFinite(value),
    score: Number.isFinite(value) ? value : null,
    refreshing,
    href: location.href,
    title: document.title,
    readyState: document.readyState,
    editor,
  };
})()`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePostId(input: unknown): number {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("post_id is required");
  const value = (input as Record<string, unknown>).post_id;
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error("post_id must be a positive integer");
  return Number(value);
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to allocate Chromium debugging port");
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function findChromium(): Promise<string> {
  const candidates = [
    process.env.CHROMIUM_PATH,
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next known path.
    }
  }
  throw new Error("Chromium is not installed in the MCP runtime");
}

class CdpSession {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      let message: unknown;
      try { message = JSON.parse(event.data); } catch { return; }
      if (typeof message !== "object" || message === null || !("id" in message)) return;
      const id = Number((message as { id: unknown }).id);
      const waiter = this.pending.get(id);
      if (!waiter) return;
      this.pending.delete(id);
      const payload = message as { error?: { message?: string }; result?: unknown };
      if (payload.error) waiter.reject(new Error(payload.error.message ?? "Chromium DevTools command failed"));
      else waiter.resolve(payload.result);
    });
  }

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = this.nextId++;
    const promise = new Promise<unknown>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.socket.send(JSON.stringify({ id, method, params }));
    return promise;
  }

  async evaluate(expression: string): Promise<unknown> {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }) as { result?: { value?: unknown }; exceptionDetails?: unknown };
    if (result.exceptionDetails) throw new Error("Rank Math editor evaluation failed");
    return result.result?.value;
  }
}

async function connectWebSocket(url: string, timeoutMs: number): Promise<WebSocket> {
  const socket = new WebSocket(url);
  await Promise.race([
    new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("Unable to connect to Chromium DevTools")), { once: true });
    }),
    sleep(timeoutMs).then(() => { throw new Error("Timed out connecting to Chromium DevTools"); }),
  ]);
  return socket;
}

export class RankMathLiveScoreService {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async getScore(input: unknown): Promise<LiveRankMathScore> {
    const postId = parsePostId(input);
    const loginUrl = await this.createAdminLoginUrl(postId);
    const chromium = await findChromium();
    const port = await availablePort();
    const profile = await mkdtemp(join(tmpdir(), "simpli-rankmath-"));
    let child: ChildProcess | undefined;
    let socket: WebSocket | undefined;
    try {
      child = spawn(chromium, [
        "--headless=new",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        `--remote-debugging-address=127.0.0.1`,
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profile}`,
        loginUrl,
      ], { stdio: ["ignore", "ignore", "ignore"] });

      const target = await this.waitForPageTarget(port, 20_000);
      socket = await connectWebSocket(target.webSocketDebuggerUrl, 5_000);
      const cdp = new CdpSession(socket);
      await cdp.send("Runtime.enable");
      const observed = await this.waitForStableScore(cdp, postId, 45_000);
      this.logger.info("Live Rank Math score verified", {
        postId,
        score: observed.score,
        editor: observed.editor,
        stableSamples: observed.stableSamples,
      });
      return {
        post_id: postId,
        seo_score: observed.score,
        source: "rank_math_editor",
        verification: "verified_live",
        stale: false,
        editor: observed.editor,
        stable_samples: observed.stableSamples,
        observed_at: new Date().toISOString(),
      };
    } finally {
      try { socket?.close(); } catch { /* no-op */ }
      if (child && !child.killed) child.kill("SIGKILL");
      await rm(profile, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async createAdminLoginUrl(postId: number): Promise<string> {
    const origin = new URL(this.config.wordpressUrl).origin;
    const runUrl = new URL(
      "/wp-json/wp-abilities/v1/abilities/novamira/create-admin-access-link/run",
      `${origin}/`,
    );
    const authorization = Buffer.from(
      `${this.config.wordpressUsername}:${this.config.wordpressAppPassword}`,
      "utf8",
    ).toString("base64");
    const response = await this.fetchImpl(runUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authorization}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Simpli-WordPress-MCP/1.0",
      },
      body: JSON.stringify({
        input: {
          expires_in: 90,
          session_expires_in: 300,
          admin_path: `post.php?post=${postId}&action=edit`,
        },
      }),
      redirect: "error",
    });
    if (!response.ok) throw new Error(`Unable to create temporary WordPress editor session (HTTP ${response.status})`);
    const access = await response.json() as AdminAccessPayload;
    const exchangeUrl = new URL(access.exchange_url);
    if (exchangeUrl.origin !== origin) throw new Error("Admin access exchange failed same-origin validation");
    if (!access.token_header || !access.nonce_header || !access.access_token || !access.access_nonce) {
      throw new Error("WordPress returned an incomplete admin access exchange");
    }
    const exchanged = await this.fetchImpl(exchangeUrl, {
      method: access.exchange_method === "POST" ? "POST" : "POST",
      headers: {
        Accept: "application/json",
        [access.token_header]: access.access_token,
        [access.nonce_header]: access.access_nonce,
        "User-Agent": "Simpli-WordPress-MCP/1.0",
      },
      redirect: "error",
    });
    if (!exchanged.ok) throw new Error(`Unable to exchange temporary WordPress editor session (HTTP ${exchanged.status})`);
    const body = await exchanged.json() as ExchangePayload;
    const loginUrl = new URL(body.login_url);
    if (loginUrl.origin !== origin) throw new Error("Temporary WordPress login URL failed same-origin validation");
    return loginUrl.toString();
  }

  private async waitForPageTarget(port: number, timeoutMs: number): Promise<{ webSocketDebuggerUrl: string }> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const response = await this.fetchImpl(`http://127.0.0.1:${port}/json/list`);
        if (response.ok) {
          const targets = await response.json() as Array<{ type?: string; webSocketDebuggerUrl?: string }>;
          const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
          if (page?.webSocketDebuggerUrl) return { webSocketDebuggerUrl: page.webSocketDebuggerUrl };
        }
      } catch {
        // Chromium is still starting.
      }
      await sleep(250);
    }
    throw new Error("Timed out waiting for Chromium editor target");
  }

  private async waitForStableScore(
    cdp: CdpSession,
    postId: number,
    timeoutMs: number,
  ): Promise<{ score: number; editor: string; stableSamples: number }> {
    const deadline = Date.now() + timeoutMs;
    let readySince = 0;
    let lastScore: number | null = null;
    let stableSamples = 0;
    while (Date.now() < deadline) {
      try {
        const value = await cdp.evaluate(SCORE_EXPRESSION) as EditorObservation;
        const onTarget = value.href.includes(`post=${postId}`) && value.href.includes("action=edit");
        if (value.ready && onTarget && value.readyState === "complete" && value.score !== null && value.refreshing === false) {
          if (!readySince) readySince = Date.now();
          if (value.score === lastScore) stableSamples += 1;
          else {
            lastScore = value.score;
            stableSamples = 1;
          }
          const readyFor = Date.now() - readySince;
          const minimumReadyMs = value.score === 0 ? 10_000 : 4_000;
          const minimumSamples = value.score === 0 ? 6 : 3;
          if (readyFor >= minimumReadyMs && stableSamples >= minimumSamples) {
            return { score: value.score, editor: value.editor, stableSamples };
          }
        } else {
          readySince = 0;
          stableSamples = 0;
          lastScore = null;
        }
      } catch {
        // Navigation can temporarily invalidate the execution context.
      }
      await sleep(500);
    }
    throw new Error("Rank Math did not produce a stable live editor score before timeout");
  }
}
