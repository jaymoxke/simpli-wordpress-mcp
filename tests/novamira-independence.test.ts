import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function listSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...listSourceFiles(path));
    else if (path.endsWith(".ts")) files.push(path);
  }
  return files;
}

describe("Novamira independence", () => {
  it("keeps the Simpli runtime free of Novamira endpoint and package dependencies", () => {
    const forbidden = [
      /\/wp-json\/novamira/i,
      /novamira-pro/i,
      /novamira\/v/i,
      /from\s+["'][^"']*novamira/i,
      /require\([^)]*novamira/i,
    ];

    for (const file of listSourceFiles("src")) {
      const source = readFileSync(file, "utf8");
      for (const pattern of forbidden) {
        expect(source, `${file} contains forbidden Novamira runtime dependency ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
