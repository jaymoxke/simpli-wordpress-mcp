import { describe, expect, it } from "vitest";
import { WordPressClient } from "../src/wordpress.js";
import { fakeTools, makeWordPressFetch, silentLogger, testConfig } from "./helpers.js";

describe("WordPressClient Simpli MCP backend", () => {
  it("discovers and caches only the Simpli backend tool catalog using Basic authentication", async () => {
    const fake = makeWordPressFetch();
    const client = new WordPressClient(testConfig, silentLogger, fake.fetch);
    const first = await client.getToolSnapshot();
    const second = await client.getToolSnapshot();

    expect(first.tools.map((tool) => tool.name)).toEqual(fakeTools.map((tool) => tool.name));
    expect(second.tools).toHaveLength(fakeTools.length);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.url.pathname).toBe("/wp-json/simpli-mcp/v1/mcp");
    expect(fake.calls[0]?.init?.headers).toMatchObject({ Authorization: expect.stringMatching(/^Basic /) });
    expect(fake.calls[0]?.body).toMatchObject({ method: "tools/list" });
  });

  it("forwards governed tool arguments unchanged, including authority and confirmation", async () => {
    const fake = makeWordPressFetch();
    const client = new WordPressClient(testConfig, silentLogger, fake.fetch);
    const input = {
      file_key: "server",
      expected_sha256: "a".repeat(64),
      old_string: "old",
      new_string: "new",
      authority_ref: "AI-REL-TEST",
      _confirm: "RUN simpli_patch_code_file",
    };

    const output = await client.callTool("simpli_patch_code_file", input);
    expect(output.isError).toBe(false);
    const call = fake.calls.find((item) => item.body?.method === "tools/call" &&
      (item.body.params as { name?: string } | undefined)?.name === "simpli_patch_code_file");
    expect(call?.body).toMatchObject({
      method: "tools/call",
      params: { name: "simpli_patch_code_file", arguments: input },
    });
  });

  it("reports readiness only after tool discovery and self-status succeed", async () => {
    const fake = makeWordPressFetch();
    const client = new WordPressClient(testConfig, silentLogger, fake.fetch);
    await expect(client.readiness()).resolves.toMatchObject({
      ready: true,
      backend: "simpli-mcp",
      backendVersion: "0.2.0",
      toolCount: fakeTools.length,
    });
  });

  it("deduplicates concurrent readiness probes and caches a successful result", async () => {
    const fake = makeWordPressFetch();
    const client = new WordPressClient(testConfig, silentLogger, fake.fetch);

    const [first, second] = await Promise.all([client.readiness(), client.readiness()]);
    const third = await client.readiness();

    expect(first.ready).toBe(true);
    expect(second.ready).toBe(true);
    expect(third.ready).toBe(true);

    const listCalls = fake.calls.filter((item) => item.body?.method === "tools/list");
    const statusCalls = fake.calls.filter((item) =>
      item.body?.method === "tools/call" &&
      (item.body.params as { name?: string } | undefined)?.name === "simpli_self_status",
    );
    expect(listCalls).toHaveLength(1);
    expect(statusCalls).toHaveLength(1);
  });

  it("fails closed when the backend returns no tools", async () => {
    const fake = makeWordPressFetch([]);
    const client = new WordPressClient(testConfig, silentLogger, fake.fetch);
    await expect(client.listTools(true)).rejects.toMatchObject({
      status: 502,
      message: expect.stringMatching(/returned no tools/),
    });
  });
});
