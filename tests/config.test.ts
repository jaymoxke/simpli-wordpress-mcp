import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const base = {
  PUBLIC_BASE_URL: "https://mcp.example.test/",
  WORDPRESS_URL: "https://wordpress.example.test/",
  WORDPRESS_USERNAME: "gateway",
  WORDPRESS_APP_PASSWORD: "abcd efgh ijkl mnop qrst uvwx",
};

describe("loadConfig", () => {
  it("normalizes origins and accepts durable OAuth state", () => {
    const config = loadConfig({
      ...base,
      OAUTH_ADMIN_PASSWORD: "correct horse battery staple",
      OAUTH_STATE_DB_PATH: ":memory:",
    });
    expect(config.publicBaseUrl).toBe("https://mcp.example.test");
    expect(config.resourceUrl).toBe("https://mcp.example.test/mcp");
    expect(config.wordpressUrl).toBe("https://wordpress.example.test");
    expect(config.oauthStateDbPath).toBe(":memory:");
  });

  it("requires at least one MCP authentication mode", () => {
    expect(() => loadConfig(base)).toThrow(/Configure durable OAuth/);
  });

  it("requires OAuth password and state path together", () => {
    expect(() => loadConfig({ ...base, OAUTH_ADMIN_PASSWORD: "correct horse battery staple" }))
      .toThrow(/must be configured together/);
    expect(() => loadConfig({ ...base, OAUTH_STATE_DB_PATH: ":memory:" }))
      .toThrow(/must be configured together/);
  });

  it("requires a durable absolute OAuth state path in production", () => {
    expect(() => loadConfig({
      ...base,
      NODE_ENV: "production",
      OAUTH_ADMIN_PASSWORD: "correct horse battery staple",
      OAUTH_STATE_DB_PATH: ":memory:",
    })).toThrow(/must be durable/);

    expect(() => loadConfig({
      ...base,
      NODE_ENV: "production",
      OAUTH_ADMIN_PASSWORD: "correct horse battery staple",
      OAUTH_STATE_DB_PATH: "state/oauth.sqlite",
    })).toThrow(/absolute path/);

    const config = loadConfig({
      ...base,
      NODE_ENV: "production",
      OAUTH_ADMIN_PASSWORD: "correct horse battery staple",
      OAUTH_STATE_DB_PATH: "/var/lib/simpli-mcp/oauth.sqlite",
    });
    expect(config.oauthStateDbPath).toBe("/var/lib/simpli-mcp/oauth.sqlite");
  });

  it("rejects insecure public origins", () => {
    expect(() => loadConfig({ ...base, PUBLIC_BASE_URL: "http://mcp.example.test", MCP_STATIC_TOKEN: "s".repeat(48) }))
      .toThrow(/must use HTTPS/);
  });

  it("accepts a distinct dedicated WhatsApp MCP token", () => {
    const config = loadConfig({
      ...base,
      MCP_STATIC_TOKEN: "s".repeat(48),
      WHATSAPP_MCP_TOKEN: "w".repeat(48),
    });
    expect(config.whatsappMcpToken).toBe("w".repeat(48));

    expect(() => loadConfig({
      ...base,
      MCP_STATIC_TOKEN: "x".repeat(48),
      WHATSAPP_MCP_TOKEN: "x".repeat(48),
    })).toThrow(/must be distinct/);
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
