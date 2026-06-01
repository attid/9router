import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

const cases = [
  {
    file: "src/shared/components/AddCustomEmbeddingModal.js",
    forbidden: [/const url = isEdit \? `\/api\/provider-nodes\/\$\{node\.id\}` : "\/api\/provider-nodes"/],
  },
  {
    file: "src/app/(dashboard)/dashboard/cli-tools/CLIToolsPageClient.js",
    forbidden: [/:\s*"\/api\/cli-tools\//],
  },
  {
    file: "src/app/(dashboard)/dashboard/cli-tools/components/HermesToolCard.js",
    forbidden: [/const ENDPOINT = "\/api\/cli-tools\/hermes-settings"/],
  },
  {
    file: "src/app/(dashboard)/dashboard/proxy-pools/page.js",
    forbidden: [/fetch\(isEdit \? `\/api\/proxy-pools\/\$\{editingProxyPool\.id\}` : "\/api\/proxy-pools"/],
  },
  {
    file: "src/app/(dashboard)/dashboard/media-providers/combo/[id]/page.js",
    forbidden: [/fetch\(`\/api\$\{path\}`/],
  },
  {
    file: "src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/page.js",
    forbidden: [
      /: `\/api\/media-providers\/tts\/voices\?provider=/,
      /const url = `\/api\/v1\/audio\/speech/,
      /fetch\(`\/api\$\{apiPathWithQuery\}`/,
    ],
  },
];

describe("client base-path regressions", () => {
  for (const { file, forbidden } of cases) {
    it(`does not keep raw root-relative API paths in ${file}`, () => {
      const source = fs.readFileSync(path.join(repoRoot, file), "utf8");

      for (const pattern of forbidden) {
        expect(source).not.toMatch(pattern);
      }
    });
  }
});
