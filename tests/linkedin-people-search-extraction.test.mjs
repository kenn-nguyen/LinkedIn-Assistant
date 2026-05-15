import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function loadPeopleSearchExtraction(overrides = {}) {
  const source = fs.readFileSync(
    path.join(process.cwd(), "linkedin-people-search-extraction.js"),
    "utf8"
  );
  const document = {
    title: "LinkedIn Search",
    querySelectorAll() {
      return [];
    },
    ...overrides.document
  };
  const windowObject = {
    location: {
      href: "https://www.linkedin.com/search/results/people/?keywords=test",
      origin: "https://www.linkedin.com",
      hostname: "www.linkedin.com",
      pathname: "/search/results/people/"
    },
    ...overrides.window
  };
  const context = vm.createContext({
    console,
    URL,
    Date,
    window: windowObject,
    document,
    globalThis: {
      LinkedInAssistantShared: {
        normalizeWhitespace(value) {
          return String(value || "").replace(/\s+/g, " ").trim();
        }
      }
    }
  });
  vm.runInContext(source, context);
  return context.globalThis.LinkedInAssistantPeopleSearchExtraction;
}

test("extractPeopleSearchContext treats an empty people search page as supported", () => {
  const extraction = loadPeopleSearchExtraction();
  const result = extraction.extractPeopleSearchContext();

  assert.equal(result.pageType, "linkedin-people-search");
  assert.equal(result.supported, true);
  assert.equal(result.peopleSearch.resultCount, 0);
  assert.equal(result.reason, "No people results found.");
});
