import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

async function loadJobOutreachAi() {
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
  const assets = Object.fromEntries(assetPaths.map((relativePath) => [
    relativePath,
    fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
  ]));
  const source = fs.readFileSync(path.join(process.cwd(), "job-outreach-ai.js"), "utf8");
  const context = vm.createContext({
    console,
    globalThis: {},
    URL
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
  context.globalThis.__LUMI_PROMPT_PACK_ASSETS__ = assets;
  vm.runInContext(fs.readFileSync(path.join(process.cwd(), "prompt-pack-runtime.js"), "utf8"), context);
  await context.globalThis.LumiPromptPackRuntime.ensureReady();
  vm.runInContext(source, context);
  return context.globalThis.LumiJobOutreachAI;
}

function sampleRankingInput() {
  return {
    job: {
      title: "Senior Product Manager - API Integrations and Developer Experiences",
      company: "Uber",
      location: "San Francisco, California, United States",
      description: "Lead API integrations and developer experiences for the Uber Eats Merchant team."
    },
    myProfile: {
      ownProfileUrl: "https://www.linkedin.com/in/test-sender/",
      fullName: "Kenn Nguyen",
      headline: "Senior Product Leader",
      rawSnapshot: "Brian Le Vu recommended this post and appears elsewhere in the saved profile snapshot."
    },
    searches: [
      {
        searchKey: "A",
        searchNumber: 1,
        keywords: "\"Vietnamese\" Senior Product Manager",
        searchUrl: "https://www.linkedin.com/search/results/people/?keywords=%22Vietnamese%22%20Senior%20Product%20Manager",
        people: [
          {
            name: "Arushi Singh",
            profileUrl: "https://www.linkedin.com/in/arushi-singh/",
            connectionDegree: "2nd",
            headline: "Senior Product Manager at Uber",
            location: "San Francisco Bay Area",
            mutualConnectionsText: "Brian Le Vu and 2 other mutual connections",
            primaryAction: "Message"
          }
        ]
      }
    ]
  };
}

test("buildRankingPrompt excludes raw sender snapshot names and sanitizes mutual-connection text", async () => {
  const ai = await loadJobOutreachAi();

  const prompt = ai.buildRankingPrompt(sampleRankingInput());

  assert.doesNotMatch(prompt, /rawSnapshotExcerpt/i);
  assert.doesNotMatch(prompt, /Brian Le Vu/);
  assert.match(prompt, /3 mutual connections/i);
});

test("buildRankingPrompt explicitly bans named third-party intro recommendations", async () => {
  const ai = await loadJobOutreachAi();

  const prompt = ai.buildRankingPrompt(sampleRankingInput());

  assert.match(prompt, /Do not recommend asking a named third party for an introduction or referral\./);
  assert.match(prompt, /approach_strategy must describe direct outreach to the ranked person only/i);
  assert.match(prompt, /Any suggested outreach framing must stay professionally polite/i);
});

test("buildRankingPrompt frames ranking as expected contact value and requires best-use classification", async () => {
  const ai = await loadJobOutreachAi();

  const prompt = ai.buildRankingPrompt(sampleRankingInput());

  assert.match(prompt, /You are Lumi Assistant's recruiting intelligence analyst\./);
  assert.match(prompt, /Rank people by the expected value of contacting them now for this specific job\./i);
  assert.match(prompt, /The best first contact is not always the strongest final referrer\./i);
  assert.match(prompt, /For each person, classify best_use as one of:/i);
  assert.match(prompt, /direct_referral_path/);
  assert.match(prompt, /hiring_context/);
  assert.match(prompt, /warm_entry_point/);
  assert.match(prompt, /peer_team_insight/);
  assert.match(prompt, /low_value/);
});

test("buildRankingPrompt prioritizes referral paths to hiring managers or HR over general context gathering", async () => {
  const ai = await loadJobOutreachAi();

  const prompt = ai.buildRankingPrompt(sampleRankingInput());

  assert.match(prompt, /the objective is to get a referral for this job, not to optimize for generic networking or relationship building\./i);
  assert.match(prompt, /put the highest priority on people who can realistically move the sender closer to the hiring manager, recruiter, or HR path for this specific job\./i);
  assert.match(prompt, /prioritize influence on the hiring manager over generic hr access when the evidence supports both\./i);
  assert.match(prompt, /prefer people who are more likely to actively help with referral progress over people who only offer general team or company context\./i);
  assert.match(prompt, /warmth or easy rapport is secondary unless it improves the sender's path toward referral or recruiting access\./i);
});

test("buildRankingPrompt treats active openings as speed-sensitive and prefers the fastest credible referral path", async () => {
  const ai = await loadJobOutreachAi();

  const prompt = ai.buildRankingPrompt(sampleRankingInput());

  assert.match(prompt, /treat active job openings as time-sensitive and prefer the fastest credible referral path over slower relationship-building paths\./i);
  assert.match(prompt, /do not optimize for broad networking or long-term relationship building when a faster referral or recruiting path is available\./i);
  assert.match(prompt, /channel viability matters: if linkedin outreach is likely to go unseen, down-rank that person unless the referral upside is clearly stronger\./i);
  assert.match(prompt, /shared background signals such as vietnamese identity, school, or geography matter only when they plausibly improve reply speed or willingness to help\./i);
});

test("validateRankingResponse rejects indirect intro strategies", async () => {
  const ai = await loadJobOutreachAi();
  const input = sampleRankingInput();

  const result = ai.validateRankingResponse(JSON.stringify({
    contract_version: ai.RANKING_CONTRACT_VERSION,
    job_brief: "Uber is hiring a PM for merchant APIs.",
    fit_summary: "The sender has relevant product and API experience.",
    caveats: ["Confirm team scope."],
    list_evaluations: [
      {
        search_key: "A",
        summary: "Direct company relevance.",
        best_use: "peer_team_insight"
      }
    ],
    people: [
      {
        profile_url: "https://www.linkedin.com/in/arushi-singh/",
        source_search_key: "A",
        rank: 1,
        confidence: 0.84,
        best_use: "direct_referral_path",
        reason: "Direct company match.",
        approach_strategy: "Ask Brian Le Vu for a warm introduction to Arushi and then ask for a referral."
      }
    ],
    overall_strategy: "Start with the direct company match."
  }), input);

  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /direct to the ranked person|third-party introduction/i);
});

test("validateRankingResponse rejects missing or invalid best_use classifications", async () => {
  const ai = await loadJobOutreachAi();
  const input = sampleRankingInput();

  const missingBestUse = ai.validateRankingResponse(JSON.stringify({
    contract_version: ai.RANKING_CONTRACT_VERSION,
    job_brief: "Uber is hiring a PM for merchant APIs.",
    fit_summary: "The sender has relevant product and API experience.",
    caveats: ["Confirm team scope."],
    list_evaluations: [
      {
        search_key: "A",
        summary: "Direct company relevance.",
        best_use: "peer_team_insight"
      }
    ],
    people: [
      {
        profile_url: "https://www.linkedin.com/in/arushi-singh/",
        source_search_key: "A",
        rank: 1,
        confidence: 0.84,
        reason: "Direct company match.",
        approach_strategy: "Open with the Uber API role and ask one practical team-context question."
      }
    ],
    overall_strategy: "Start with the direct company match."
  }), input);

  assert.equal(missingBestUse.ok, false);
  assert.match(missingBestUse.errors.join(" "), /best_use/i);

  const invalidBestUse = ai.validateRankingResponse(JSON.stringify({
    contract_version: ai.RANKING_CONTRACT_VERSION,
    job_brief: "Uber is hiring a PM for merchant APIs.",
    fit_summary: "The sender has relevant product and API experience.",
    caveats: ["Confirm team scope."],
    list_evaluations: [
      {
        search_key: "A",
        summary: "Direct company relevance.",
        best_use: "peer_team_insight"
      }
    ],
    people: [
      {
        profile_url: "https://www.linkedin.com/in/arushi-singh/",
        source_search_key: "A",
        rank: 1,
        confidence: 0.84,
        best_use: "celebrity_exec",
        reason: "Direct company match.",
        approach_strategy: "Open with the Uber API role and ask one practical team-context question."
      }
    ],
    overall_strategy: "Start with the direct company match."
  }), input);

  assert.equal(invalidBestUse.ok, false);
  assert.match(invalidBestUse.errors.join(" "), /best_use/i);
});

test("fallback ranking still prioritizes recruiter and referral-path people over general peer context", async () => {
  const ai = await loadJobOutreachAi();

  const response = ai.buildFallbackRankingResponse({
    job: {
      title: "Senior Product Manager",
      company: "Checkr"
    },
    searches: [
      {
        searchKey: "A",
        keywords: "checkr recruiter",
        people: [
          {
            profileUrl: "https://www.linkedin.com/in/recruiter/",
            headline: "Recruiter at Checkr",
            currentText: "Recruiting for product roles",
            connectionDegree: "3rd"
          }
        ]
      },
      {
        searchKey: "B",
        keywords: "checkr product peer",
        people: [
          {
            profileUrl: "https://www.linkedin.com/in/peer/",
            headline: "Senior Product Manager at Checkr",
            currentText: "Product @ Checkr",
            connectionDegree: "2nd"
          }
        ]
      }
    ]
  });

  const recruiter = response.people.find((person) => person.profile_url === "https://www.linkedin.com/in/recruiter/");
  const peer = response.people.find((person) => person.profile_url === "https://www.linkedin.com/in/peer/");

  assert.equal(recruiter?.best_use, "direct_referral_path");
  assert.match(recruiter?.approach_strategy || "", /referral direction|referral/i);
  assert.equal(peer?.best_use, "direct_referral_path");
});
