import { describe, expect, it } from "vitest";
import { DEFAULT_WORDPRESS_USER_AGENT, loadConfig } from "../src/config.js";

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
    expect(config.wordpressUserAgent).toBe(DEFAULT_WORDPRESS_USER_AGENT);
    expect(config.wordpressAuthMode).toBe("basic");
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

  it("requires WORDPRESS_URL to be an exact origin, not a path-bearing alias", () => {
    expect(() => loadConfig({
      ...base,
      WORDPRESS_URL: "https://wordpress.example.test/shop/",
      MCP_STATIC_TOKEN: "s".repeat(48),
    })).toThrow(/origin without a path/);
  });

  it("accepts a bounded browser-compatible WordPress user agent and rejects header injection", () => {
    const config = loadConfig({
      ...base,
      WORDPRESS_USER_AGENT: "Mozilla/5.0 Custom-Simpli-Upstream-Test/1.0",
      MCP_STATIC_TOKEN: "s".repeat(48),
    });
    expect(config.wordpressUserAgent).toBe("Mozilla/5.0 Custom-Simpli-Upstream-Test/1.0");

    expect(() => loadConfig({
      ...base,
      WORDPRESS_USER_AGENT: "Mozilla/5.0 safe\r\nX-Evil: injected",
      MCP_STATIC_TOKEN: "s".repeat(48),
    })).toThrow(/CR\/LF/);
  });

  it("supports signed WordPress transport without a Basic credential", () => {
    const config = loadConfig({
      PUBLIC_BASE_URL: base.PUBLIC_BASE_URL,
      WORDPRESS_URL: base.WORDPRESS_URL,
      WORDPRESS_AUTH_MODE: "signed",
      WORDPRESS_SIGNING_KEY_ID: "gateway-key-r1",
      WORDPRESS_SIGNING_PRIVATE_KEY_PATH: "/tmp/test-ed25519.pem",
      MCP_STATIC_TOKEN: "s".repeat(48),
    });
    expect(config.wordpressAuthMode).toBe("signed");
    expect(config.wordpressUsername).toBeUndefined();
    expect(config.wordpressAppPassword).toBeUndefined();
    expect(config.wordpressSigningKeyId).toBe("gateway-key-r1");
  });

  it("requires both Basic and signing material in dual mode", () => {
    expect(() => loadConfig({
      PUBLIC_BASE_URL: base.PUBLIC_BASE_URL,
      WORDPRESS_URL: base.WORDPRESS_URL,
      WORDPRESS_AUTH_MODE: "dual",
      WORDPRESS_USERNAME: base.WORDPRESS_USERNAME,
      WORDPRESS_APP_PASSWORD: base.WORDPRESS_APP_PASSWORD,
      MCP_STATIC_TOKEN: "s".repeat(48),
    })).toThrow(/SIGNING_KEY_ID/);

    const config = loadConfig({
      ...base,
      WORDPRESS_AUTH_MODE: "dual",
      WORDPRESS_SIGNING_KEY_ID: "gateway-key-r1",
      WORDPRESS_SIGNING_PRIVATE_KEY_PATH: "/tmp/test-ed25519.pem",
      MCP_STATIC_TOKEN: "s".repeat(48),
    });
    expect(config.wordpressAuthMode).toBe("dual");
  });

  it("requires an absolute signing key path in production", () => {
    expect(() => loadConfig({
      PUBLIC_BASE_URL: base.PUBLIC_BASE_URL,
      WORDPRESS_URL: base.WORDPRESS_URL,
      WORDPRESS_AUTH_MODE: "signed",
      WORDPRESS_SIGNING_KEY_ID: "gateway-key-r1",
      WORDPRESS_SIGNING_PRIVATE_KEY_PATH: "relative/private.pem",
      MCP_STATIC_TOKEN: "s".repeat(48),
      NODE_ENV: "production",
    })).toThrow(/SIGNING_PRIVATE_KEY_PATH must be an absolute path/);
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
