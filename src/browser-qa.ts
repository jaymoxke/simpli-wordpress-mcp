import { z } from "zod";
import type { AppConfig } from "./config.js";
import type { Logger } from "./logger.js";
import type { JsonSchema } from "./wordpress.js";

export type BrowserQaGatewayScope = "wordpress:read" | "wordpress:write";

export interface BrowserQaAbility {
  name: string;
  description: string;
  readonly: boolean;
  risk: string;
  authority_class: "A1_READ_AND_ANALYZE" | "A3_OPERATIONAL_WRITE";
  requires_confirmation: boolean;
  input_schema: JsonSchema;
  output_schema: JsonSchema;
  gateway_scope: BrowserQaGatewayScope;
}

export type BrowserQaExecution =
  | { kind: "structured"; value: Record<string, unknown> }
  | {
      kind: "image";
      dataBase64: string;
      mimeType: "image/png";
      metadata: Record<string, unknown>;
    };

const ViewportSchema = z.enum(["desktop", "tablet", "mobile"]);
const UrlSchema = z.string().url().max(2000).refine((value) => value.startsWith("https://"), "HTTPS_REQUIRED");

const InspectInputSchema = z.object({
  url: UrlSchema,
  viewport: ViewportSchema.default("desktop"),
});

const ScreenshotInputSchema = z.object({
  url: UrlSchema,
  viewport: ViewportSchema.default("desktop"),
  full_page: z.boolean().default(true),
});

const WaitInputSchema = z.object({
  url: UrlSchema,
  viewport: ViewportSchema.default("desktop"),
  wait_for: z.array(z.string().min(1).max(500)).max(10).default([]),
});

const BrowserActionSchema = z.object({
  type: z.enum(["click", "fill", "select", "check", "press", "waitVisible"]),
  selector: z.string().min(1).max(500),
  value: z.string().max(2000).optional(),
  timeout: z.number().int().min(100).max(20000).optional(),
});

const InteractInputSchema = z.object({
  url: UrlSchema,
  viewport: ViewportSchema.default("desktop"),
  actions: z.array(BrowserActionSchema).min(1).max(20),
});

const RegressionInputSchema = z.object({
  url: UrlSchema,
  viewports: z.array(ViewportSchema).min(1).max(3).default(["desktop", "mobile"]),
  include_accessibility: z.boolean().default(true),
});

const urlInputProperties = {
  url: { type: "string", minLength: 8, maxLength: 2000 },
  viewport: { type: "string", enum: ["desktop", "tablet", "mobile"], default: "desktop" },
};

export const BROWSER_QA_ABILITIES: BrowserQaAbility[] = [
  {
    name: "storefront/browser.health.get",
    description:
      "Verify the isolated Simpli Browser QA service and Chromium runtime before relying on rendered browser evidence.",
    readonly: true,
    risk: "diagnostic_read",
    authority_class: "A1_READ_AND_ANALYZE",
    requires_confirmation: false,
    gateway_scope: "wordpress:read",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    output_schema: { type: "object" },
  },
  {
    name: "storefront/browser.inspect",
    description:
      "Render one public Simpli HTTPS URL in a fresh anonymous Chromium context and return viewport, headings, controls, media, overflow and browser error evidence without performing actions.",
    readonly: true,
    risk: "external_rendered_read",
    authority_class: "A1_READ_AND_ANALYZE",
    requires_confirmation: false,
    gateway_scope: "wordpress:read",
    input_schema: {
      type: "object",
      properties: urlInputProperties,
      required: ["url"],
      additionalProperties: false,
    },
    output_schema: { type: "object" },
  },
  {
    name: "storefront/browser.accessibility-audit",
    description:
      "Run axe accessibility analysis on one rendered public Simpli HTTPS URL, optionally waiting for explicit selectors to become visible first.",
    readonly: true,
    risk: "external_rendered_read",
    authority_class: "A1_READ_AND_ANALYZE",
    requires_confirmation: false,
    gateway_scope: "wordpress:read",
    input_schema: {
      type: "object",
      properties: {
        ...urlInputProperties,
        wait_for: {
          type: "array",
          maxItems: 10,
          items: { type: "string", minLength: 1, maxLength: 500 },
          default: [],
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
    output_schema: { type: "object" },
  },
  {
    name: "storefront/browser.screenshot",
    description:
      "Capture a rendered PNG screenshot of one public Simpli HTTPS URL in a fresh anonymous Chromium context without performing browser actions.",
    readonly: true,
    risk: "external_rendered_read",
    authority_class: "A1_READ_AND_ANALYZE",
    requires_confirmation: false,
    gateway_scope: "wordpress:read",
    input_schema: {
      type: "object",
      properties: {
        ...urlInputProperties,
        full_page: { type: "boolean", default: true },
      },
      required: ["url"],
      additionalProperties: false,
    },
    output_schema: { type: "object" },
  },
  {
    name: "storefront/browser.interact",
    description:
      "Execute a bounded sequence of storefront QA interactions in a fresh anonymous Chromium context. Checkout, account, admin and payment-oriented targets are blocked. Requires task authority and explicit confirmation.",
    readonly: false,
    risk: "ephemeral_browser_interaction",
    authority_class: "A3_OPERATIONAL_WRITE",
    requires_confirmation: true,
    gateway_scope: "wordpress:write",
    input_schema: {
      type: "object",
      properties: {
        ...urlInputProperties,
        actions: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: ["click", "fill", "select", "check", "press", "waitVisible"],
              },
              selector: { type: "string", minLength: 1, maxLength: 500 },
              value: { type: "string", maxLength: 2000 },
              timeout: { type: "integer", minimum: 100, maximum: 20000 },
            },
            required: ["type", "selector"],
            additionalProperties: false,
          },
        },
      },
      required: ["url", "actions"],
      additionalProperties: false,
    },
    output_schema: { type: "object" },
  },
  {
    name: "storefront/pdp-regression.run",
    description:
      "Run a bounded rendered PDP baseline across selected desktop/tablet/mobile viewports, checking HTTP success, one-H1 structure, horizontal overflow, browser errors and serious/critical axe violations. This is a baseline regression, not checkout or payment acceptance.",
    readonly: true,
    risk: "external_rendered_regression",
    authority_class: "A1_READ_AND_ANALYZE",
    requires_confirmation: false,
    gateway_scope: "wordpress:read",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", minLength: 8, maxLength: 2000 },
        viewports: {
          type: "array",
          minItems: 1,
          maxItems: 3,
          items: { type: "string", enum: ["desktop", "tablet", "mobile"] },
          default: ["desktop", "mobile"],
        },
        include_accessibility: { type: "boolean", default: true },
      },
      required: ["url"],
      additionalProperties: false,
    },
    output_schema: { type: "object" },
  },
];

const abilityByName = new Map(BROWSER_QA_ABILITIES.map((ability) => [ability.name, ability]));

const restrictedPathPrefixes = ["/checkout", "/my-account", "/wp-admin", "/wp-login.php"];
const forbiddenSelectorFragments = [
  "place_order",
  "order_review",
  "payment",
  "mpesa",
  "password",
  "login",
  "register",
  "newsletter",
  "subscribe",
  "refund",
  "billing_",
  "shipping_",
];

function assertInteractionTarget(urlValue: string, actions: z.infer<typeof BrowserActionSchema>[]): void {
  const url = new URL(urlValue);
  const path = url.pathname.toLowerCase();
  if (restrictedPathPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    throw new Error("BROWSER_QA_RESTRICTED_PATH");
  }
  for (const action of actions) {
    const selector = action.selector.toLowerCase();
    if (forbiddenSelectorFragments.some((fragment) => selector.includes(fragment))) {
      throw new Error("BROWSER_QA_RESTRICTED_SELECTOR");
    }
  }
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("BROWSER_QA_INVALID_RESPONSE");
  }
  return value as Record<string, unknown>;
}

export class BrowserQaClient {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get configured(): boolean {
    return Boolean(this.config.browserQaBaseUrl && this.config.browserQaToken);
  }

  hasAbility(name: unknown): name is string {
    return typeof name === "string" && this.configured && abilityByName.has(name);
  }

  catalog(): BrowserQaAbility[] {
    return this.configured ? BROWSER_QA_ABILITIES.map((ability) => ({ ...ability })) : [];
  }

  describe(name: string): BrowserQaAbility {
    const ability = abilityByName.get(name);
    if (!this.configured || !ability) throw new Error(`Browser QA ability not found: ${name}`);
    return { ...ability };
  }

  async execute(
    name: string,
    input: Record<string, unknown>,
    authorityRef?: unknown,
    confirmation?: unknown,
  ): Promise<BrowserQaExecution> {
    if (!this.configured) throw new Error("BROWSER_QA_NOT_CONFIGURED");
    const ability = abilityByName.get(name);
    if (!ability) throw new Error(`Browser QA ability not found: ${name}`);

    if (ability.requires_confirmation) {
      if (typeof authorityRef !== "string" || !authorityRef.trim()) {
        throw new Error("BROWSER_QA_AUTHORITY_REF_REQUIRED");
      }
      if (confirmation !== "RUN simpli_execute") {
        throw new Error("BROWSER_QA_CONFIRMATION_REQUIRED");
      }
    }

    this.logger.info("Governed Browser QA ability invoked", {
      abilityName: name,
      authorityClass: ability.authority_class,
      ...(typeof authorityRef === "string" && authorityRef.trim()
        ? { authorityRef: authorityRef.slice(0, 191) }
        : {}),
    });

    switch (name) {
      case "storefront/browser.health.get":
        return { kind: "structured", value: await this.getJson("/health") };

      case "storefront/browser.inspect": {
        const parsed = InspectInputSchema.parse(input);
        return {
          kind: "structured",
          value: await this.postJson("/v1/inspect", { ...parsed, actions: [] }),
        };
      }

      case "storefront/browser.accessibility-audit": {
        const parsed = WaitInputSchema.parse(input);
        const actions = parsed.wait_for.map((selector) => ({ type: "waitVisible", selector }));
        return {
          kind: "structured",
          value: await this.postJson("/v1/accessibility", {
            url: parsed.url,
            viewport: parsed.viewport,
            actions,
          }),
        };
      }

      case "storefront/browser.screenshot": {
        const parsed = ScreenshotInputSchema.parse(input);
        const response = await this.request("/v1/screenshot", {
          method: "POST",
          body: JSON.stringify({
            url: parsed.url,
            viewport: parsed.viewport,
            fullPage: parsed.full_page,
            actions: [],
          }),
        });
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > 8 * 1024 * 1024) throw new Error("BROWSER_QA_SCREENSHOT_TOO_LARGE");
        return {
          kind: "image",
          dataBase64: Buffer.from(bytes).toString("base64"),
          mimeType: "image/png",
          metadata: {
            state: "STATE_VERIFIED",
            url: parsed.url,
            viewport: parsed.viewport,
            fullPage: parsed.full_page,
            byteCount: bytes.byteLength,
          },
        };
      }

      case "storefront/browser.interact": {
        const parsed = InteractInputSchema.parse(input);
        assertInteractionTarget(parsed.url, parsed.actions);
        return {
          kind: "structured",
          value: await this.postJson("/v1/inspect", parsed),
        };
      }

      case "storefront/pdp-regression.run": {
        const parsed = RegressionInputSchema.parse(input);
        const fixtures: Record<string, unknown>[] = [];
        for (const viewport of parsed.viewports) {
          const inspect = await this.postJson("/v1/inspect", {
            url: parsed.url,
            viewport,
            actions: [],
          });
          const page =
            typeof inspect.page === "object" && inspect.page !== null && !Array.isArray(inspect.page)
              ? (inspect.page as Record<string, unknown>)
              : {};
          const h1 = Array.isArray(page.h1) ? page.h1 : [];
          const consoleErrors = Array.isArray(inspect.consoleErrors) ? inspect.consoleErrors : [];
          const pageErrors = Array.isArray(inspect.pageErrors) ? inspect.pageErrors : [];
          const status = typeof inspect.status === "number" ? inspect.status : 0;
          const overflowX = inspect.overflowX === true;

          let accessibility: Record<string, unknown> | null = null;
          let seriousOrCritical = 0;
          if (parsed.include_accessibility) {
            accessibility = await this.postJson("/v1/accessibility", {
              url: parsed.url,
              viewport,
              actions: [],
            });
            const violations = Array.isArray(accessibility.violations) ? accessibility.violations : [];
            seriousOrCritical = violations.filter((violation) => {
              if (typeof violation !== "object" || violation === null || Array.isArray(violation)) return false;
              const impact = (violation as Record<string, unknown>).impact;
              return impact === "serious" || impact === "critical";
            }).length;
          }

          const checks = {
            http_ok: status >= 200 && status < 400,
            exactly_one_h1: h1.length === 1,
            no_horizontal_overflow: !overflowX,
            no_console_errors: consoleErrors.length === 0,
            no_page_errors: pageErrors.length === 0,
            no_serious_or_critical_axe_violations: parsed.include_accessibility
              ? seriousOrCritical === 0
              : null,
          };
          const pass = Object.values(checks).every((value) => value === true || value === null);
          fixtures.push({ viewport, pass, checks, inspect, ...(accessibility ? { accessibility } : {}) });
        }

        return {
          kind: "structured",
          value: {
            state: "STATE_VERIFIED",
            scope: "RENDERED_PDP_BASELINE",
            url: parsed.url,
            pass: fixtures.every((fixture) => fixture.pass === true),
            fixtures,
            limitations: [
              "Does not assert checkout or payment state.",
              "Does not yet replace dedicated gallery, variation, accordion, add-to-cart or sticky-CTA interaction fixtures.",
            ],
          },
        };
      }

      default:
        throw new Error(`Browser QA ability not found: ${name}`);
    }
  }

  private async getJson(path: string): Promise<Record<string, unknown>> {
    const response = await this.request(path, { method: "GET" }, false);
    return this.readJson(response);
  }

  private async postJson(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await this.request(path, { method: "POST", body: JSON.stringify(body) });
    return this.readJson(response);
  }

  private async readJson(response: Response): Promise<Record<string, unknown>> {
    const raw = await response.text();
    let parsed: unknown;
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error("BROWSER_QA_INVALID_JSON");
    }
    return asObject(parsed);
  }

  private async request(
    path: string,
    init: RequestInit,
    authenticated = true,
  ): Promise<Response> {
    if (!this.config.browserQaBaseUrl) throw new Error("BROWSER_QA_NOT_CONFIGURED");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.browserQaTimeoutMs);
    const url = new URL(path, `${this.config.browserQaBaseUrl}/`);
    try {
      const response = await this.fetchImpl(url, {
        ...init,
        headers: {
          Accept: path === "/v1/screenshot" ? "image/png" : "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(authenticated && this.config.browserQaToken
            ? { Authorization: `Bearer ${this.config.browserQaToken}` }
            : {}),
        },
        signal: controller.signal,
        redirect: "error",
      });
      if (!response.ok) {
        const raw = (await response.text()).slice(0, 2000);
        throw new Error(`BROWSER_QA_HTTP_${response.status}: ${raw}`);
      }
      return response;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("BROWSER_QA_TIMEOUT");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
