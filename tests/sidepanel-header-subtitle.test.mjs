import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Expected ${name} in sidepanel.js`);
  let depth = 0;
  let end = -1;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index + 1;
        break;
      }
    }
  }
  assert.ok(end > start, `Expected complete function body for ${name}`);
  return source.slice(start, end);
}

function loadHeaderSubtitleHelpers() {
  const source = fs.readFileSync(path.join(process.cwd(), "sidepanel.js"), "utf8");
  const context = vm.createContext({
    normalizeWhitespace(value) {
      return String(value || "").replace(/\s+/g, " ").trim();
    },
    escapeRegExp(value) {
      return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  });
  const code = [
    extractFunction(source, "subtitleLooksLikeInjectedProfileSuggestion"),
    extractFunction(source, "extractRoleFromActivitySnapshot"),
    extractFunction(source, "cleanHeaderSubtitle"),
    extractFunction(source, "resolveHeaderSubtitle"),
    extractFunction(source, "extractSubtitleFromRawSnapshot")
  ].join("\n\n");
  return vm.runInContext(`(() => { ${code}; return { subtitleLooksLikeInjectedProfileSuggestion, extractRoleFromActivitySnapshot, cleanHeaderSubtitle, resolveHeaderSubtitle, extractSubtitleFromRawSnapshot }; })()`, context);
}

test("cleanHeaderSubtitle rejects foreign activity/profile snippets", () => {
  const { cleanHeaderSubtitle } = loadHeaderSubtitleHelpers();

  assert.equal(
    cleanHeaderSubtitle("Edward Hu • 2nd Sales Leader at Uber Eats 11mo •", "Angela Duong"),
    ""
  );
  assert.equal(
    cleanHeaderSubtitle("Angela Duong reposted this", "Angela Duong"),
    ""
  );
  assert.equal(
    cleanHeaderSubtitle(
      "Explore Premium profiles Promila Tanwar · 3rd Senior Product Manager @ Fiserv Message",
      "Angela Duong"
    ),
    ""
  );
});

test("resolveHeaderSubtitle falls through polluted subtitle candidates to a clean later value", () => {
  const { resolveHeaderSubtitle } = loadHeaderSubtitleHelpers();

  assert.equal(
    resolveHeaderSubtitle([
      "Edward Hu • 2nd Sales Leader at Uber Eats 11mo •",
      "Restaurant Partnerships at Uber Eats",
      "San Francisco Bay Area"
    ], "Angela Duong"),
    "Restaurant Partnerships at Uber Eats"
  );
});

test("extractSubtitleFromRawSnapshot prefers the actual role line from a LinkedIn top card snapshot", () => {
  const { extractSubtitleFromRawSnapshot } = loadHeaderSubtitleHelpers();

  const rawSnapshot = [
    "Top card: Angela Duong",
    "She/Her",
    "1st",
    "Restaurant Partnerships at Uber Eats",
    "University of California, Santa Cruz",
    "San Francisco Bay Area",
    "Contact info"
  ].join(" | ");

  assert.equal(
    extractSubtitleFromRawSnapshot(rawSnapshot, "Angela Duong"),
    "Restaurant Partnerships at Uber Eats"
  );
});

test("extractSubtitleFromRawSnapshot recovers the role line from an activity-heavy saved snapshot", () => {
  const { extractSubtitleFromRawSnapshot } = loadHeaderSubtitleHelpers();

  const rawSnapshot = [
    "Top card: Angela Duong | Angela Duong She/Her · 1st",
    "About: As an Account Manager at Uber...",
    "Activity: Activity 1,192 followers Posts Comments",
    "Angela Duong reposted this",
    "Edward Hu • 2nd Sales Leader at Uber Eats 11mo • Our Uber Eats team continues to grow.",
    "Angela Duong • 1st Restaurant Partnerships at Uber Eats 1yr • I’m happy to share that I’m starting a new position."
  ].join(" | ");

  assert.equal(
    extractSubtitleFromRawSnapshot(rawSnapshot, "Angela Duong"),
    "Restaurant Partnerships at Uber Eats"
  );
});

test("header exposes a dedicated refresh button next to edit for manual profile re-extraction", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "sidepanel.html"), "utf8");

  assert.match(
    html,
    /id="person-card-refresh-button"[\s\S]*?Refresh[\s\S]*?id="person-card-edit-button"[\s\S]*?Edit/i
  );
});
