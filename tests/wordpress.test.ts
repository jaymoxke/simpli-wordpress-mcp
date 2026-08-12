import { describe, expect, it } from "vitest";
import { getAbilityAnnotations, getAbilityInputSchema, WordPressClient } from "../src/wordpress.js";
import { fakeAbilities, makeWordPressFetch, silentLogger, testConfig } from "./helpers.js";

describe("WordPressClient", () => {
  it("discovers and caches all REST-exposed abilities with Basic authentication", async () => {
    const fake = makeWordPressFetch();
    const client = new WordPressClient(testConfig, silentLogger, fake.fetch);
    const first = await client.getAbilitySnapshot();
    const second = await client.getAbilitySnapshot();
    expect(first.abilities).toHaveLength(fakeAbilities.length);
    expect(second.abilities).toHaveLength(fakeAbilities.length);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.init?.headers).toMatchObject({ Authorization: expect.stringMatching(/^Basic /) });
  });

  it("uses GET, POST, and DELETE from the authoritative ability annotations", async () => {
    const fake = makeWordPressFetch();
    const client = new WordPressClient(testConfig, silentLogger, fake.fetch);
    await client.runAbility("novamira/read-file", { path: "wp-content/test.txt" });
    await client.runAbility("novamira/write-file", { path: "wp-content/test.txt", content: "ok" });
    await client.runAbility("novamira/delete-file", { path: "wp-content/test.txt" });
    const runCalls = fake.calls.filter((call) => call.url.pathname.endsWith("/run"));
    expect(runCalls.map((call) => call.init?.method)).toEqual(["GET", "POST", "DELETE"]);
    expect(runCalls[0]?.url.pathname).toBe("/wp-json/wp-abilities/v1/novamira/read-file/run");
    expect(runCalls[0]?.url.searchParams.get("input[path]")).toBe("wp-content/test.txt");
    expect(runCalls[1]?.init?.body).toBe('{"input":{"path":"wp-content/test.txt","content":"ok"}}');
    expect(runCalls[2]?.url.searchParams.get("input[path]")).toBe("wp-content/test.txt");
  });

  it("serializes nested GET input using WordPress query parameter semantics", async () => {
    const fake = makeWordPressFetch();
    const client = new WordPressClient(testConfig, silentLogger, fake.fetch);

    await client.runAbility("novamira/read-file", {
      path: "wp-content/test.txt",
      filters: { status: "publish", featured: false },
      fields: ["id", "name"],
      page: 2,
      per_page: 1,
      status: "publish",
    });

    const runCall = fake.calls.find((call) => call.url.pathname.endsWith("/run"));
    expect(Object.fromEntries(runCall?.url.searchParams ?? [])).toEqual({
      "input[path]": "wp-content/test.txt",
      "input[filters][status]": "publish",
      "input[filters][featured]": "false",
      "input[fields][0]": "id",
      "input[fields][1]": "name",
      "input[page]": "2",
      "input[per_page]": "1",
      "input[status]": "publish",
    });
    expect(runCall?.url.searchParams.has("input")).toBe(false);
  });

  it("uses the live same-origin action-run URL advertised by WordPress", async () => {
    const ability = {
      ...fakeAbilities[1]!,
      _links: {
        "wp:action-run": [{
          href: "https://wordpress.example.test/wp-json/wp-abilities/v1/abilities/novamira/read-file/run",
        }],
      },
    };
    const fake = makeWordPressFetch([ability]);
    const client = new WordPressClient(testConfig, silentLogger, fake.fetch);

    await client.runAbility("novamira/read-file", { path: "wp-content/test.txt" });

    const runCall = fake.calls.find((call) => call.url.pathname.endsWith("/run"));
    expect(runCall?.url.pathname).toBe("/wp-json/wp-abilities/v1/abilities/novamira/read-file/run");
    expect(runCall?.url.searchParams.get("input[path]")).toBe("wp-content/test.txt");
  });

  it("rejects unsafe action-run URLs before sending WordPress credentials", async () => {
    for (const href of [
      "https://attacker.example/run",
      "https://attacker:secret@wordpress.example.test/wp-json/wp-abilities/v1/abilities/core/get-site-info/run",
    ]) {
      const ability = {
        ...fakeAbilities[0]!,
        _links: { "wp:action-run": [{ href }] },
      };
      const fake = makeWordPressFetch([ability]);
      const client = new WordPressClient(testConfig, silentLogger, fake.fetch);

      await expect(client.runAbility("core/get-site-info", {})).rejects.toMatchObject({
        status: 502,
        message: expect.stringMatching(/same-origin validation/),
      });
      expect(fake.calls).toHaveLength(1);
    }
  });

  it("forces PHP, WP-CLI, and admin-link abilities into the dangerous class", () => {
    for (const name of ["novamira/execute-php", "novamira/run-wp-cli", "novamira/create-admin-access-link"]) {
      const annotations = getAbilityAnnotations({ name, meta: { annotations: { readonly: true, destructive: false } } });
      expect(annotations.readonly).toBe(false);
      expect(annotations.destructive).toBe(true);
    }
  });

  it("normalizes malformed WordPress input schemas without losing required fields", () => {
    expect(getAbilityInputSchema({ name: "test/empty-array", input_schema: [] })).toEqual({
      type: "object",
      properties: {},
      additionalProperties: false,
    });

    expect(getAbilityInputSchema({
      name: "test/required-scalar",
      input_schema: { type: "string", required: true },
    })).toEqual({
      type: "object",
      properties: { input: { type: "string" } },
      required: ["input"],
      additionalProperties: false,
    });

    const normalized = getAbilityInputSchema({
      name: "test/malformed-object",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", required: true },
          options: {
            type: "object",
            properties: [],
            required: true,
          },
          entries: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "integer", required: true },
              },
            },
          },
        },
        required: ["options", "options", 7],
      },
    });

    expect(normalized).toEqual({
      type: "object",
      properties: {
        title: { type: "string" },
        options: { type: "object", properties: {} },
        entries: {
          type: "array",
          items: {
            type: "object",
            properties: { id: { type: "integer" } },
            required: ["id"],
          },
        },
      },
      required: ["options", "title"],
    });
  });
});
