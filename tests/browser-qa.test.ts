import { describe, expect, it, vi } from "vitest";
import { BrowserQaClient } from "../src/browser-qa.js";
import { loadConfig } from "../src/config.js";
import type { Logger } from "../src/logger.js";

const logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function config() {
  return loadConfig({
    PUBLIC_BASE_URL: "https://mcp.example.test",
    WORDPRESS_URL: "https://wordpress.example.test",
    WORDPRESS_USERNAME: "gateway",
    WORDPRESS_APP_PASSWORD: "abcd efgh ijkl mnop qrst uvwx",
    MCP_STATIC_TOKEN: "m".repeat(48),
    BROWSER_QA_BASE_URL: "https://browser.example.test",
    BROWSER_QA_TOKEN: "b".repeat(48),
  });
}

describe("BrowserQaClient", () => {
  it("adds only configured governed abilities", () => {
    const client = new BrowserQaClient(config(), logger, vi.fn() as unknown as typeof fetch);
    expect(client.catalog().map((ability) => ability.name)).toContain("storefront/browser.inspect");
    expect(client.describe("storefront/browser.interact").requires_confirmation).toBe(true);
  });

  it("executes passive inspect with bearer auth and no actions", async () => {
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: `Bearer ${"b".repeat(48)}` });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        url: "https://www.simplicosmetics.co.ke/product/example/",
        viewport: "mobile",
        actions: [],
      });
      return new Response(JSON.stringify({ state: "STATE_VERIFIED", status: 200 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const client = new BrowserQaClient(config(), logger, fetchMock as unknown as typeof fetch);
    const result = await client.execute("storefront/browser.inspect", {
      url: "https://www.simplicosmetics.co.ke/product/example/",
      viewport: "mobile",
    });
    expect(result.kind).toBe("structured");
  });

  it("requires explicit authority and confirmation for interactions", async () => {
    const client = new BrowserQaClient(config(), logger, vi.fn() as unknown as typeof fetch);
    await expect(
      client.execute("storefront/browser.interact", {
        url: "https://www.simplicosmetics.co.ke/product/example/",
        actions: [{ type: "click", selector: ".accordion" }],
      }),
    ).rejects.toThrow(/AUTHORITY_REF_REQUIRED/);
  });

  it("blocks checkout and payment-oriented interaction targets", async () => {
    const client = new BrowserQaClient(config(), logger, vi.fn() as unknown as typeof fetch);
    await expect(
      client.execute(
        "storefront/browser.interact",
        {
          url: "https://www.simplicosmetics.co.ke/checkout/",
          actions: [{ type: "click", selector: "button" }],
        },
        "AUTH-TEST",
        "RUN simpli_execute",
      ),
    ).rejects.toThrow(/RESTRICTED_PATH/);

    await expect(
      client.execute(
        "storefront/browser.interact",
        {
          url: "https://www.simplicosmetics.co.ke/product/example/",
          actions: [{ type: "click", selector: "#place_order" }],
        },
        "AUTH-TEST",
        "RUN simpli_execute",
      ),
    ).rejects.toThrow(/RESTRICTED_SELECTOR/);
  });
});
