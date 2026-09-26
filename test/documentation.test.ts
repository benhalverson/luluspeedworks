import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { expect, it } from "vitest";

it("keeps local Markdown file links reachable", () => {
  const missing: string[] = [];
  for (const file of globSync(["*.md", "docs/**/*.md", ".github/**/*.md"])) {
    const markdown = readFileSync(file, "utf8");
    for (const match of markdown.matchAll(/\]\(([^)]+)\)/g)) {
      const destination = match[1]?.split("#")[0];
      if (!destination || /^(?:[a-z]+:|\/)/i.test(destination)) continue;
      const target = decodeURIComponent(destination);
      if (!existsSync(resolve(dirname(file), target)))
        missing.push(`${file}: ${destination}`);
    }
  }
  expect(missing).toEqual([]);
});
