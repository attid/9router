import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ROOTS = ["src/app", "src/shared", "src/store", "src/i18n"].map((root) =>
  path.join(REPOSITORY_ROOT, root)
);
const EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const SERVER_APP_URL_FILES = [
  "src/app/api/auth/oidc/start/route.js",
  "src/app/api/auth/oidc/callback/route.js",
  "src/app/api/auth/oidc/test/route.js",
  "src/lib/oauth/utils/server.js",
  "src/lib/tunnel/cloudflare/healthCheck.js",
  "src/lib/tunnel/tailscale/healthCheck.js",
].map((file) => path.join(REPOSITORY_ROOT, file));
const LOCAL_API_LITERAL = /["'`]\/api(?:\/|[?"'`])/g;
const INTERPOLATED_APP_PATH = /\$\{[^}\n]+\}\/(?:api\/health|v1(?:\/|\b)|callback(?:[/?]|\b)|dashboard(?:[/?]|\b))/g;
const PLAIN_LOCAL_ANCHOR = /<a\b[^>]*\bhref=["']\/(?:dashboard|callback|api|v1)(?:[/?"'])/g;
const BARE_STATIC_SOURCE = /\bsrc=["']\/(?:icons|providers|images|assets)\//g;
const DIRECT_LOCATION_PATH = /window\.location\.(?:href\s*=|assign\(|replace\()\s*["'`]\/(?:dashboard|callback|api|v1)(?:[/?"'`])/g;

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
        return !/(?:apiPath|withBasePath|appUrl)\(\s*$/.test(prefix);
      });
      return matches.map(
        (match) =>
          `${path.relative(REPOSITORY_ROOT, file)}:${source.slice(0, match.index).split("\n").length}`
      );
    });

    expect(offenders).toEqual([]);
  });

  it.each([
    ["interpolated app paths", INTERPOLATED_APP_PATH],
    ["plain local anchors", PLAIN_LOCAL_ANCHOR],
    ["bare static sources", BARE_STATIC_SOURCE],
    ["direct window.location paths", DIRECT_LOCATION_PATH],
  ])("has no unhandled %s", (_category, pattern) => {
    const offenders = ROOTS.flatMap(sourceFiles).flatMap((file) => {
      const source = fs.readFileSync(file, "utf8");
      return [...source.matchAll(pattern)].map((match) =>
        `${path.relative(REPOSITORY_ROOT, file)}:${source.slice(0, match.index).split("\n").length}`
      );
    });

    expect(offenders).toEqual([]);
  });

  it("configures manifest navigation within the base path", () => {
    const source = fs.readFileSync(path.join(REPOSITORY_ROOT, "src/app/manifest.js"), "utf8");
    expect(source).toMatch(/start_url:\s*withBasePath\(["']\/["']\)/);
    expect(source).toMatch(/scope:\s*withBasePath\(["']\/["']\)/);
  });

  it("has no bare server-owned health, callback, or OIDC origin paths", () => {
    const pattern = /\$\{[^}\n]+\}\/(?:api\/health|api\/auth\/oidc|callback|dashboard|login)(?:[/?]|\b)/g;
    const offenders = SERVER_APP_URL_FILES.flatMap((file) => {
      const source = fs.readFileSync(file, "utf8");
      return [...source.matchAll(pattern)].map((match) =>
        `${path.relative(REPOSITORY_ROOT, file)}:${source.slice(0, match.index).split("\n").length}`
      );
    });

    expect(offenders).toEqual([]);
  });

  it("does not require manual prefixes for Next Link or router navigation", () => {
    const example = '<Link href="/dashboard" />; router.push("/dashboard");';
    expect([...example.matchAll(PLAIN_LOCAL_ANCHOR)]).toEqual([]);
    expect([...example.matchAll(DIRECT_LOCATION_PATH)]).toEqual([]);
  });
});
