import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function loadRuntimeAndShared() {
  const assetPaths = [
    "prompt-packs/default/prompt-pack.json",
    "prompt-packs/default/relationship/template.txt",
    "prompt-packs/default/relationship/retry.txt",
    "prompt-packs/default/relationship/contract.json",
    "prompt-packs/default/post-suggestions/template.txt",
    "prompt-packs/default/post-suggestions/contract.json",
    "prompt-packs/default/job-outreach/search-url-template.txt",
    "prompt-packs/default/job-outreach/search-url-contract.json",
    "prompt-packs/default/job-outreach/ranking-template.txt",
    "prompt-packs/default/job-outreach/ranking-contract.json"
  ];
  const assets = Object.fromEntries(assetPaths.map((relativePath) => [
    relativePath,
    fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
  ]));
  const context = vm.createContext({
    console,
    URL,
    crypto: {
      getRandomValues(values) {
        return values.fill(7);
      }
    },
    globalThis: {
      __LUMI_PROMPT_PACK_ASSETS__: assets
    }
  });
  vm.runInContext(fs.readFileSync(path.join(process.cwd(), "identity.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(process.cwd(), "shared.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(process.cwd(), "prompt-pack-runtime.js"), "utf8"), context);
  return context.globalThis;
}

test("shared message and storage contracts expose prompt-pack settings", () => {
  const globals = loadRuntimeAndShared();
  const shared = globals.LinkedInAssistantShared;

  assert.equal(shared.STORAGE_KEYS.promptPackSettings, "promptPackSettings");
  assert.equal(shared.MESSAGE_TYPES.SAVE_PROMPT_PACK_SETTINGS, "SAVE_PROMPT_PACK_SETTINGS");
});

test("normalizePromptPackSettings keeps the default pack and drops blank overrides", () => {
  const globals = loadRuntimeAndShared();
  const runtime = globals.LumiPromptPackRuntime;

  const normalized = runtime.normalizePromptPackSettings({
    activePackId: "",
    templateOverrides: {
      relationship: "  ",
      post_suggestions: "Override text"
    }
  });

  assert.equal(normalized.activePackId, "default");
  assert.deepEqual(JSON.parse(JSON.stringify(normalized.templateOverrides)), {
    post_suggestions: "Override text"
  });
});

test("prompt template settings hide the legacy job outreach search-url prompt", () => {
  const globals = loadRuntimeAndShared();
  const runtime = globals.LumiPromptPackRuntime;

  const choices = JSON.parse(JSON.stringify(runtime.listBuiltInPromptChoices().map((choice) => choice.key)));

  assert.deepEqual(choices, [
    "relationship",
    "relationship_retry",
    "post_suggestions",
    "job_outreach_ranking"
  ]);
  assert.ok(!choices.includes("job_outreach_search_url"));
});
