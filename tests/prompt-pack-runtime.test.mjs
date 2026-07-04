import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function loadPromptPackAssets() {
  const root = process.cwd();
  const assetPaths = [
    "prompt-packs/default/prompt-pack.json",
    "prompt-packs/default/relationship/template.txt",
    "prompt-packs/default/relationship/retry.txt",
    "prompt-packs/default/relationship/contract.json",
    "prompt-packs/default/email/template.txt",
    "prompt-packs/default/email/contract.json",
    "prompt-packs/default/post-suggestions/template.txt",
    "prompt-packs/default/post-suggestions/contract.json",
    "prompt-packs/default/job-outreach/search-url-template.txt",
    "prompt-packs/default/job-outreach/search-url-contract.json",
    "prompt-packs/default/job-outreach/ranking-template.txt",
    "prompt-packs/default/job-outreach/ranking-contract.json"
  ];
  return Object.fromEntries(assetPaths.map((relativePath) => [
    relativePath,
    fs.readFileSync(path.join(root, relativePath), "utf8")
  ]));
}

async function loadPromptPackRuntime() {
  const source = fs.readFileSync(path.join(process.cwd(), "prompt-pack-runtime.js"), "utf8");
  const context = vm.createContext({
    console,
    fetch: async (assetPath) => ({
      ok: true,
      async text() {
        const assets = loadPromptPackAssets();
        return assets[String(assetPath).replace(/^\//, "")];
      }
    }),
    globalThis: {
      __LUMI_PROMPT_PACK_ASSETS__: loadPromptPackAssets()
    }
  });
  vm.runInContext(source, context);
  await context.globalThis.LumiPromptPackRuntime.ensureReady();
  return context.globalThis.LumiPromptPackRuntime;
}

test("loadBuiltInPromptPack returns the default manifest and required prompt entries", async () => {
  const runtime = await loadPromptPackRuntime();
  const pack = runtime.getCachedBuiltInPromptPack("default");

  assert.equal(pack.manifest.pack_id, "default");
  assert.equal(pack.prompts.relationship.contract.contract_id, "relationship_draft_v1");
  assert.match(pack.prompts.relationship.template, /{{recipient_profile}}/);
  assert.match(pack.prompts.job_outreach_ranking.template, /{{searches_json}}/);
});

test("applyTemplate resolves placeholders and rejects missing values", async () => {
  const runtime = await loadPromptPackRuntime();

  const resolved = runtime.applyTemplate("Hello {{name}}", { name: "Arushi" });
  assert.equal(resolved, "Hello Arushi");

  assert.throws(() => runtime.applyTemplate("Hello {{name}} {{company}}", { name: "Arushi" }), /Unresolved prompt placeholders/i);
});
