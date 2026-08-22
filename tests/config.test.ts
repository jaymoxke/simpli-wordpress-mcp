import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const base = {
  PUBLIC_BASE_URL: "https://mcp.example.test/",
  WORDPRESS_URL: "https://wordpress.example.test/",
  WORDPRESS_USERNAME: "gateway",
  WORDPRESS_APP_PASSWORD: "abcd efgh ijkl mnop qrst uvwx",
};

describe("loadConfig", () => {
  it("normalizes origins and accepts OAuth", () => {
    const config = loadConfig({
      ...base,
      OAUTH_SIGNING_SECRET: "s".repeat(64),
      OAUTH_ADMIN_PASSWORD: "correct horse battery staple",
    });
    expect(config.publicBaseUrl).toBe("https://mcp.example.test");
    expect(config.resourceUrl).toBe("https://mcp.example.test/mcp");
    expect(config.wordpressUrl).toBe("https://wordpress.example.test");
  });

  it("requires at least one MCP authentication mode", () => {
    expect(() => loadConfig(base)).toThrow(/Configure OAuth/);
  });

  it("rejects insecure public origins", () => {
    expect(() => loadConfig({ ...base, PUBLIC_BASE_URL: "http://mcp.example.test", MCP_STATIC_TOKEN: "s".repeat(48) }))
      .toThrow(/must use HTTPS/);
  });

  it("requires Browser QA URL and token together", () => {
    expect(() => loadConfig({
      ...base,
      MCP_STATIC_TOKEN: "s".repeat(48),
      BROWSER_QA_BASE_URL: "https://browser.example.test",
    })).toThrow(/must be configured together/);

    const config = loadConfig({
      ...base,
      MCP_STATIC_TOKEN: "s".repeat(48),
      BROWSER_QA_BASE_URL: "https://browser.example.test/",
      BROWSER_QA_TOKEN: "b".repeat(48),
    });
    expect(config.browserQaBaseUrl).toBe("https://browser.example.test");
    expect(config.browserQaToken).toBe("b".repeat(48));
  });
});
