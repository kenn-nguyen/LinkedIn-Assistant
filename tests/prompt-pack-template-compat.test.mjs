import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function assetMap() {
  const root = process.cwd();
  const assetPaths = [
    "prompt-packs/default/manifest.json",
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
  return Object.fromEntries(assetPaths.map((relativePath) => [
    relativePath,
    fs.readFileSync(path.join(root, relativePath), "utf8")
  ]));
}

async function loadPromptModule() {
  const context = vm.createContext({
    console,
    URL,
    setTimeout,
    clearTimeout,
    globalThis: {
      __LUMI_PROMPT_PACK_ASSETS__: assetMap()
    }
  });
  for (const scriptName of ["identity.js", "shared.js", "prompt-pack-runtime.js", "prompt.js"]) {
    const source = fs.readFileSync(path.join(process.cwd(), scriptName), "utf8");
    vm.runInContext(source, context);
  }
  await context.globalThis.LumiPromptPackRuntime.ensureReady();
  return {
    prompts: context.globalThis.LinkedInAssistantPrompts,
    runtime: context.globalThis.LumiPromptPackRuntime
  };
}

async function loadJobOutreachAi() {
  const context = vm.createContext({
    console,
    URL,
    setTimeout,
    clearTimeout,
    globalThis: {
      __LUMI_PROMPT_PACK_ASSETS__: assetMap()
    }
  });
  context.globalThis.LinkedInAssistantShared = {
    normalizeWhitespace(value) {
      return String(value || "").replace(/\s+/g, " ").trim();
    },
    extractJsonFromText(rawText) {
      return JSON.parse(String(rawText || ""));
    },
    truncate(value, limit) {
      const text = String(value || "").replace(/\s+/g, " ").trim();
      if (!limit || text.length <= limit) {
        return text;
      }
      return `${text.slice(0, Math.max(0, limit - 1)).trim()}…`;
    }
  };
  vm.runInContext(fs.readFileSync(path.join(process.cwd(), "prompt-pack-runtime.js"), "utf8"), context);
  await context.globalThis.LumiPromptPackRuntime.ensureReady();
  vm.runInContext(fs.readFileSync(path.join(process.cwd(), "job-outreach-ai.js"), "utf8"), context);
  return {
    ai: context.globalThis.LumiJobOutreachAI,
    runtime: context.globalThis.LumiPromptPackRuntime
  };
}

test("relationship and post prompt builders load text from the default prompt pack", async () => {
  const { prompts, runtime } = await loadPromptModule();

  const relationshipTemplate = prompts.relationshipPromptTemplate();
  const postTemplate = prompts.postSuggestionPromptTemplate();

  assert.equal(relationshipTemplate, runtime.getBuiltInTemplate("relationship"));
  assert.equal(postTemplate, runtime.getBuiltInTemplate("post_suggestions"));

  const relationship = prompts.buildWorkspacePrompt(
    {
      pageType: "linkedin-profile",
      title: "Arushi Singh",
      pageUrl: "https://www.linkedin.com/in/arushi-singh/",
      person: { fullName: "Arushi Singh", headline: "Senior Product Manager at Uber" },
      conversation: { recentMessages: [] }
    },
    { personId: "arushi-singh", fullName: "Arushi Singh" },
    { fullName: "Kenn Nguyen", ownProfileUrl: "https://www.linkedin.com/in/kenn-nguyen/" },
    prompts.FIXED_TAIL,
    prompts.defaultPromptSettings(),
    "",
    {}
  );

  const post = prompts.buildPostSuggestionPrompt(
    {
      authorName: "Arushi Singh",
      postText: "We are hiring PMs at Uber.",
      comments: []
    },
    { fullName: "Kenn Nguyen" },
    prompts.defaultPromptSettings(),
    {}
  );

  assert.match(relationship.prompt, /You are a world-class relationship strategist/);
  assert.match(relationship.prompt, /Any tone choice must stay professionally polite/i);
  assert.match(relationship.prompt, /When space allows, prefer 'Would you be open to a brief chat\?' over 'Open to a brief chat\?'/i);
  assert.match(post.prompt, /This is a suggestion tool, not an automation tool\./);
  assert.match(post.prompt, /Any tone used must stay professionally polite/i);
  assert.doesNotMatch(relationship.prompt, /{{recipient_profile}}/);
  assert.doesNotMatch(post.prompt, /{{post_context}}/);
});

test("job outreach prompt builders load search and ranking templates from the default pack", async () => {
  const { ai, runtime } = await loadJobOutreachAi();

  assert.equal(ai.searchUrlPromptTemplate(), runtime.getBuiltInTemplate("job_outreach_search_url"));
  assert.equal(ai.rankingPromptTemplate(), runtime.getBuiltInTemplate("job_outreach_ranking"));

  const searchPrompt = ai.buildSearchUrlPrompt({
    searches: [
      {
        searchKey: "A",
        searchNumber: 1,
        keywords: "\"Vietnamese\" Senior Product Manager",
        enabledCriteria: [],
        criteria: {}
      }
    ]
  });
  const rankingPrompt = ai.buildRankingPrompt({
    job: {
      title: "Senior Product Manager - API Integrations",
      company: "Uber",
      location: "San Francisco, California, United States"
    },
    myProfile: {
      fullName: "Kenn Nguyen",
      headline: "Senior Product Leader"
    },
    searches: [
      {
        searchKey: "A",
        searchNumber: 1,
        keywords: "\"Vietnamese\" Senior Product Manager",
        people: [
          {
            name: "Arushi Singh",
            profileUrl: "https://www.linkedin.com/in/arushi-singh/",
            headline: "Senior Product Manager at Uber"
          }
        ]
      }
    ]
  });

  assert.match(searchPrompt, /LinkedIn people-search URL formatter/);
  assert.match(rankingPrompt, /recruiting intelligence analyst/i);
  assert.match(rankingPrompt, /Rank people by the expected value of contacting them now for this specific job/i);
  assert.match(rankingPrompt, /The best first contact is not always the strongest final referrer/i);
  assert.match(rankingPrompt, /Do not recommend asking a named third party/);
  assert.match(rankingPrompt, /Any suggested outreach framing must stay professionally polite/i);
  assert.doesNotMatch(searchPrompt, /{{searches_json}}/);
  assert.doesNotMatch(rankingPrompt, /{{searches_json}}/);
});
