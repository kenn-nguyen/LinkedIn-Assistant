import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function loadBuildJobDemoDraftHandoffText() {
  const source = fs.readFileSync(path.join(process.cwd(), "sidepanel.js"), "utf8");
  const start = source.indexOf("function buildJobDemoDraftHandoffText(job, person, draftContext) {");
  const end = source.indexOf("\n\n  function isSavedOwnProfilePage()", start);
  assert.ok(start >= 0 && end > start, "Expected buildJobDemoDraftHandoffText in sidepanel.js");
  const functionSource = source.slice(start, end);
  const context = vm.createContext({
    normalizeWhitespace(value) {
      return String(value || "").replace(/\s+/g, " ").trim();
    }
  });
  return vm.runInContext(`(() => { ${functionSource}; return buildJobDemoDraftHandoffText; })()`, context);
}

test("buildJobDemoDraftHandoffText keeps the job, person, and approach context for manual tailoring", () => {
  const buildJobDemoDraftHandoffText = loadBuildJobDemoDraftHandoffText();

  const handoff = buildJobDemoDraftHandoffText(
    { title: "Staff Product Manager", company: "Intuit" },
    { name: "Adekamni Olubakin", bestUse: "direct_referral_path" },
    {
      jobBrief: "Builds core financial experiences for mid-market customers.",
      approachStrategy: "Lead with the Yale/Intuit overlap and ask for quick guidance.",
      reason: "Likely close to the hiring path for this PM opening."
    }
  );

  assert.equal(handoff, [
    "Job brief: Builds core financial experiences for mid-market customers.",
    "I am applying to Staff Product Manager at Intuit.",
    "Person: Adekamni Olubakin.",
    "Best use: Direct referral path.",
    "Approach: Lead with the Yale/Intuit overlap and ask for quick guidance.",
    "Why this person: Likely close to the hiring path for this PM opening."
  ].join("\n"));
});

test("buildJobDemoDraftHandoffText omits empty lines when some fields are missing", () => {
  const buildJobDemoDraftHandoffText = loadBuildJobDemoDraftHandoffText();

  const handoff = buildJobDemoDraftHandoffText(
    { title: "Product Lead", company: "" },
    { name: "" },
    { jobBrief: "", approachStrategy: "Ask for a short perspective on the team." }
  );

  assert.equal(handoff, [
    "I am applying to Product Lead.",
    "Approach: Ask for a short perspective on the team."
  ].join("\n"));
});
