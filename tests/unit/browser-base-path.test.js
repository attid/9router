import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ROOTS = ["src/app", "src/shared", "src/store", "src/i18n"].map((root) =>
  path.join(REPOSITORY_ROOT, root)
);
const EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const LOCAL_API_LITERAL = /["'`]\/api(?:\/|[?"'`])/g;

function sourceFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (fullPath.startsWith(path.join(REPOSITORY_ROOT, "src", "app", "api"))) return [];
      return sourceFiles(fullPath);
    }
    return EXTENSIONS.has(path.extname(entry.name)) ? [fullPath] : [];
  });
}

describe("browser base-path coverage", () => {
  it("has no bare local API transport URLs", () => {
    const offenders = ROOTS.flatMap(sourceFiles).flatMap((file) => {
      const source = fs.readFileSync(file, "utf8");
      const matches = [...source.matchAll(LOCAL_API_LITERAL)].filter((match) => {
        const prefix = source.slice(Math.max(0, match.index - 32), match.index);
        return !/(?:apiPath|withBasePath)\(\s*$/.test(prefix);
      });
      return matches.map(
        (match) =>
          `${path.relative(REPOSITORY_ROOT, file)}:${source.slice(0, match.index).split("\n").length}`
      );
    });

    expect(offenders).toEqual([]);
  });
});
