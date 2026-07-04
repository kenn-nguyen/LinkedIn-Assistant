import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function loadJobExtraction(overrides = {}) {
  const source = fs.readFileSync(
    path.join(process.cwd(), "linkedin-library", "jobs", "extraction.js"),
    "utf8"
  );
  const document = {
    title: "LinkedIn Job",
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    ...overrides.document
  };
  const windowObject = {
    location: {
      href: "https://www.linkedin.com/jobs/view/123/",
      origin: "https://www.linkedin.com",
      hostname: "www.linkedin.com",
      pathname: "/jobs/view/123/"
    },
    ...overrides.window
  };
  const globalScope = {
    LinkedInAssistantShared: {
      normalizeWhitespace(value) {
        return String(value || "").replace(/\s+/g, " ").trim();
      },
      normalizeLinkedInProfileUrl(value) {
        const raw = String(value || "").trim();
        const match = raw.match(/linkedin\.com\/in\/([^/?#]+)/i);
        return match ? `https://www.linkedin.com/in/${match[1]}/` : raw;
      }
    }
  };
  const context = vm.createContext({
    console,
    URL,
    Date,
    Node: { DOCUMENT_POSITION_PRECEDING: 2 },
    window: windowObject,
    document,
    globalThis: globalScope
  });
  vm.runInContext(source, context);
  return context.globalThis.LinkedInAssistantJobExtraction;
}

test("job extraction exposes the job-page person-card capture helpers", () => {
  const extraction = loadJobExtraction();
  assert.equal(typeof extraction.findJobPagePersonCards, "function");
  assert.equal(typeof extraction.extractJobPagePersonCard, "function");
});

test("findJobPagePersonCards returns an empty list when no person cards are present", () => {
  const extraction = loadJobExtraction();
  const cards = extraction.findJobPagePersonCards();
  assert.equal(Array.isArray(cards), true);
  assert.equal(cards.length, 0);
});

test("extractJobPagePersonCard returns null for a missing or invalid card element", () => {
  const extraction = loadJobExtraction();
  assert.equal(extraction.extractJobPagePersonCard(null), null);
  assert.equal(extraction.extractJobPagePersonCard({}), null);
});
