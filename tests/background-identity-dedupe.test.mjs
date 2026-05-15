import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function extractFunction(source, name) {
  const match = source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`, "m"));
  assert.ok(match, `Expected ${name} in background.js`);
  return match[0];
}

function loadIdentityHelpers() {
  const source = fs.readFileSync(path.join(process.cwd(), "background.js"), "utf8");
  const context = vm.createContext({
    normalizeWhitespace(value) {
      return String(value || "").replace(/\s+/g, " ").trim();
    },
    normalizeLinkedInProfileUrl(value) {
      return String(value || "").trim();
    },
    normalizeUrl(value) {
      return String(value || "").trim();
    },
    isOpaqueLinkedInPersonId(value) {
      return /^li:ACo/i.test(String(value || "").trim());
    },
    isPublicSlugPersonId(value) {
      return /^li:[a-z0-9-]+$/i.test(String(value || "").trim()) && !/^li:ACo/i.test(String(value || "").trim());
    },
    stableDerivedPersonIdForRecord(record) {
      return String(record?.identity?.publicProfileUrlDerived || record?.stableDerivedPersonId || "");
    },
    primaryLinkedInMemberUrl(record) {
      return String(record?.identity?.primaryLinkedInMemberUrl || "");
    },
    publicProfileUrl(record) {
      return String(record?.identity?.publicProfileUrl || "");
    },
    knownProfileUrls(record) {
      return Array.isArray(record?.identity?.knownProfileUrls) ? record.identity.knownProfileUrls : [];
    },
    linkedInProfileAlias(value) {
      return String(value || "").trim().toLowerCase();
    },
    shouldResolveLinkedInProfileUrl(value) {
      return /\/in\/ACo/i.test(String(value || "").trim());
    },
    toIsoNow() {
      return "2026-05-12T00:00:00.000Z";
    },
    mergePersonRecord(existing, incoming) {
      const existingIdentity = existing?.identity || {};
      const incomingIdentity = incoming?.identity || {};
      const merged = {
        ...(existing || {}),
        ...(incoming || {})
      };
      const recordUuid = String(
        existing?.uuid
        || existing?.system?.recordUuid
        || incoming?.uuid
        || incoming?.system?.recordUuid
        || merged?.uuid
        || merged?.system?.recordUuid
        || ""
      ).trim();
      return {
        ...merged,
        uuid: recordUuid,
        system: {
          ...(existing?.system || {}),
          ...(incoming?.system || {}),
          recordUuid
        },
        identity: {
          ...existingIdentity,
          ...incomingIdentity,
          knownProfileUrls: Array.from(new Set([
            ...(Array.isArray(existingIdentity.knownProfileUrls) ? existingIdentity.knownProfileUrls : []),
            ...(Array.isArray(incomingIdentity.knownProfileUrls) ? incomingIdentity.knownProfileUrls : [])
          ])),
          aliases: Array.from(new Set([
            ...(Array.isArray(existingIdentity.aliases) ? existingIdentity.aliases : []),
            ...(Array.isArray(incomingIdentity.aliases) ? incomingIdentity.aliases : [])
          ]))
        }
      };
    },
    normalizePersonRecord(record) {
      return record ? { ...record } : null;
    },
    getDraftWorkspace(record) {
      return record?.draftWorkspace || null;
    },
    personRecordStrength(record) {
      return Number(record?.strength || 0);
    },
    hasMatchingIdentityAlias(left, right) {
      return Boolean(left?.alias && right?.alias && left.alias === right.alias);
    },
    hasMatchingNameEvidence(left, right) {
      return String(left?.fullName || "").trim().toLowerCase() === String(right?.fullName || "").trim().toLowerCase();
    },
    hasMatchingHeadlinePrefixEvidence(left, right) {
      return String(left?.headlinePrefix || "").trim().toLowerCase() === String(right?.headlinePrefix || "").trim().toLowerCase();
    },
    hasMatchingProfileEvidence(left, right) {
      return String(left?.profileEvidence || "").trim().toLowerCase() === String(right?.profileEvidence || "").trim().toLowerCase();
    }
  });

  const code = [
    extractFunction(source, "headlineQualityScore"),
    extractFunction(source, "chooseCanonicalPersonId"),
    extractFunction(source, "preferBetterHeadline"),
    extractFunction(source, "linkProfileUrlToPersonRecord"),
    extractFunction(source, "resolveLinkProfileTargetPerson"),
    extractFunction(source, "shouldMergeDuplicatePersonRecords"),
    extractFunction(source, "mergeDuplicatePersonEntries")
  ].join("\n\n");

  return vm.runInContext(`(() => { ${code}; return { headlineQualityScore, chooseCanonicalPersonId, preferBetterHeadline, linkProfileUrlToPersonRecord, resolveLinkProfileTargetPerson, shouldMergeDuplicatePersonRecords, mergeDuplicatePersonEntries }; })()`, context);
}

function loadResolveStoredPersonMatch() {
  const source = fs.readFileSync(path.join(process.cwd(), "background.js"), "utf8");
  const context = vm.createContext({
    pendingProfileIdentityHandoffsByTabId: new Map(),
    PENDING_PROFILE_IDENTITY_HANDOFF_MAX_AGE_MS: 2 * 60 * 1000,
    normalizeWhitespace(value) {
      return String(value || "").replace(/\s+/g, " ").trim();
    },
    normalizeLinkedInProfileUrl(value) {
      return String(value || "").trim();
    },
    normalizeUrl(value) {
      return String(value || "").trim();
    },
    shouldResolveLinkedInProfileUrl(value) {
      return /\/in\/ACo/i.test(String(value || "").trim());
    },
    linkedInProfileAlias(value) {
      return String(value || "").trim().toLowerCase();
    },
    primaryLinkedInMemberUrl(record) {
      return String(record?.identity?.primaryLinkedInMemberUrl || "");
    },
    publicProfileUrl(record) {
      return String(record?.identity?.publicProfileUrl || "");
    },
    knownProfileUrls(record) {
      return Array.isArray(record?.identity?.knownProfileUrls) ? record.identity.knownProfileUrls : [];
    },
    personNameHeadlineSignature() {
      return "";
    },
    hasMatchingIdentityAlias(record, candidate) {
      const recordAliases = new Set(Array.isArray(record?.identity?.aliases) ? record.identity.aliases : []);
      const candidateAliases = Array.isArray(candidate?.identity?.aliases) ? candidate.identity.aliases : [];
      return candidateAliases.some((value) => recordAliases.has(value));
    },
    getDraftWorkspace() {
      return null;
    },
    isOwnProfilePageContext() {
      return false;
    },
    resolveProfileClickTraceMatch() {
      return null;
    },
    findRecordByNameHeadlineSignature() {
      return null;
    },
    findRecordByMessagingThreadUrl() {
      return null;
    },
    findRecordByDraftWorkspaceThreadUrl() {
      return null;
    },
    findRecordByPrimaryLinkedInMemberUrl() {
      return null;
    },
    findRecordByPublicProfileUrl() {
      return null;
    },
    findRecordByKnownProfileUrl() {
      return null;
    },
    findIdentityCandidates() {
      return [];
    },
    recordMatchesProfileNameHeadline(record) {
      return Boolean(record?.profileNameHeadlineMatch);
    },
    hasMatchingNameEvidence() {
      return false;
    },
    hasMatchingHeadlinePrefixEvidence() {
      return false;
    },
    hasMatchingProfileEvidence() {
      return false;
    }
  });

  const code = [
    extractFunction(source, "getPendingProfileIdentityHandoffForPage"),
    extractFunction(source, "previewIdentityHints"),
    extractFunction(source, "recordMatchesExplicitPageIdentity"),
    extractFunction(source, "recordMatchesPageContext"),
    extractFunction(source, "resolveStoredPersonMatch")
  ].join("\n\n");

  return vm.runInContext(`(() => { ${code}; return { resolveStoredPersonMatch }; })()`, context);
}

test("chooseCanonicalPersonId prefers the thread-backed messaging record when profile and messaging records merge", () => {
  const { chooseCanonicalPersonId } = loadIdentityHelpers();

  const publicRecord = {
    personId: "li:rebecca-rabison",
    stableDerivedPersonId: "li:rebecca-rabison",
    strength: 8
  };
  const opaqueRecord = {
    personId: "li:ACoAAAL64OkB7N9yWpzDPHP89H8LKcKRslC0VjM",
    stableDerivedPersonId: "",
    strength: 12,
    messagingThreadUrl: "https://www.linkedin.com/messaging/thread/abc/"
  };

  assert.equal(
    chooseCanonicalPersonId([opaqueRecord, publicRecord], opaqueRecord.personId),
    opaqueRecord.personId
  );
  assert.equal(
    chooseCanonicalPersonId([opaqueRecord, publicRecord], publicRecord.personId),
    opaqueRecord.personId
  );
});

test("shouldMergeDuplicatePersonRecords merges public and opaque LinkedIn identities with matching name and headline evidence", () => {
  const { shouldMergeDuplicatePersonRecords } = loadIdentityHelpers();

  const publicRecord = {
    personId: "li:mattia-canzanella",
    fullName: "Mattia Canzanella",
    headlinePrefix: "senior manager",
    profileEvidence: "strategy uber"
  };
  const opaqueRecord = {
    personId: "li:ACoAAAL64OkB7N9yWpzDPHP89H8LKcKRslC0VjM",
    fullName: "Mattia Canzanella",
    headlinePrefix: "senior manager",
    profileEvidence: "strategy uber"
  };

  assert.equal(shouldMergeDuplicatePersonRecords(publicRecord, opaqueRecord), true);
});

test("shouldMergeDuplicatePersonRecords does not merge unrelated public and opaque identities on name alone", () => {
  const { shouldMergeDuplicatePersonRecords } = loadIdentityHelpers();

  const publicRecord = {
    personId: "li:mattia-canzanella",
    fullName: "Mattia Canzanella",
    headlinePrefix: "senior manager",
    profileEvidence: "strategy uber"
  };
  const opaqueRecord = {
    personId: "li:ACoAAAL64OkB7N9yWpzDPHP89H8LKcKRslC0VjM",
    fullName: "Mattia Canzanella",
    headlinePrefix: "product design",
    profileEvidence: "checkr design"
  };

  assert.equal(shouldMergeDuplicatePersonRecords(publicRecord, opaqueRecord), false);
});

test("linkProfileUrlToPersonRecord attaches the public profile URL to the existing message-backed identity", () => {
  const { linkProfileUrlToPersonRecord } = loadIdentityHelpers();

  const linked = linkProfileUrlToPersonRecord({
    personId: "li:ACoAAAL64OkB7N9yWpzDPHP89H8LKcKRslC0VjM",
    profileUrl: "https://www.linkedin.com/in/ACoAAAL64OkB7N9yWpzDPHP89H8LKcKRslC0VjM/",
    identity: {
      primaryLinkedInMemberUrl: "https://www.linkedin.com/in/ACoAAAL64OkB7N9yWpzDPHP89H8LKcKRslC0VjM/",
      knownProfileUrls: ["https://www.linkedin.com/in/ACoAAAL64OkB7N9yWpzDPHP89H8LKcKRslC0VjM/"],
      aliases: ["https://www.linkedin.com/in/acoaaal64okb7n9ywpzdphp89h8lkckrslc0vjm/"]
    }
  }, "https://www.linkedin.com/in/duongangela/");

  assert.equal(linked.personId, "li:ACoAAAL64OkB7N9yWpzDPHP89H8LKcKRslC0VjM");
  assert.equal(linked.profileUrl, "https://www.linkedin.com/in/duongangela/");
  assert.equal(linked.identity.publicProfileUrl, "https://www.linkedin.com/in/duongangela/");
  assert.ok(linked.identity.knownProfileUrls.includes("https://www.linkedin.com/in/duongangela/"));
  assert.ok(linked.identity.aliases.includes("https://www.linkedin.com/in/duongangela/"));
});

test("resolveLinkProfileTargetPerson falls back to the hinted message record when the explicit person is not yet persisted", () => {
  const { resolveLinkProfileTargetPerson } = loadIdentityHelpers();

  const resolved = resolveLinkProfileTargetPerson(
    "li:ACoAAAL64OkB7N9yWpzDPHP89H8LKcKRslC0VjM",
    {
      personId: "li:ACoAAAL64OkB7N9yWpzDPHP89H8LKcKRslC0VjM",
      fullName: "Angela Duong",
      messagingThreadUrl: "https://www.linkedin.com/messaging/thread/abc/",
      identity: {
        primaryLinkedInMemberUrl: "https://www.linkedin.com/in/ACoAAAL64OkB7N9yWpzDPHP89H8LKcKRslC0VjM/"
      }
    },
    {
      people: {
        "li:duongangela": {
          personId: "li:duongangela",
          fullName: "Angela Duong"
        }
      }
    }
  );

  assert.equal(resolved.personId, "li:ACoAAAL64OkB7N9yWpzDPHP89H8LKcKRslC0VjM");
  assert.equal(resolved.messagingThreadUrl, "https://www.linkedin.com/messaging/thread/abc/");
});

test("mergeDuplicatePersonEntries preserves the message-backed record uuid when a public duplicate is absorbed", () => {
  const { mergeDuplicatePersonEntries } = loadIdentityHelpers();

  const result = mergeDuplicatePersonEntries(
    {
      personId: "li:ACoAAAL64OkB7N9yWpzDPHP89H8LKcKRslC0VjM",
      uuid: "hnz5vrwpxd",
      system: { recordUuid: "hnz5vrwpxd" },
      fullName: "Angela Duong",
      messagingThreadUrl: "https://www.linkedin.com/messaging/thread/abc/",
      identity: {
        primaryLinkedInMemberUrl: "https://www.linkedin.com/in/ACoAAAL64OkB7N9yWpzDPHP89H8LKcKRslC0VjM/",
        publicProfileUrl: "https://www.linkedin.com/in/duongangela/",
        knownProfileUrls: [
          "https://www.linkedin.com/in/ACoAAAL64OkB7N9yWpzDPHP89H8LKcKRslC0VjM/",
          "https://www.linkedin.com/in/duongangela/"
        ]
      },
      fullName: "Angela Duong",
      headlinePrefix: "restaurant part",
      profileEvidence: "uber eats"
    },
    {
      people: {
        "li:duongangela": {
          personId: "li:duongangela",
          uuid: "fhfx9kjen7",
          system: { recordUuid: "fhfx9kjen7" },
          fullName: "Angela Duong",
          profileUrl: "https://www.linkedin.com/in/duongangela/",
          identity: {
            publicProfileUrl: "https://www.linkedin.com/in/duongangela/",
            knownProfileUrls: ["https://www.linkedin.com/in/duongangela/"]
          },
          headlinePrefix: "restaurant part",
          profileEvidence: "uber eats"
        }
      }
    }
  );

  assert.equal(result.merged.personId, "li:ACoAAAL64OkB7N9yWpzDPHP89H8LKcKRslC0VjM");
  assert.equal(result.merged.uuid, "hnz5vrwpxd");
  assert.equal(result.merged.system?.recordUuid, "hnz5vrwpxd");
  assert.equal(result.people["li:duongangela"], undefined);
});

test("resolveStoredPersonMatch keeps a profile tab on the thread-backed person when the tab is already bound from messaging", () => {
  const { resolveStoredPersonMatch } = loadResolveStoredPersonMatch();

  const pageContext = {
    pageType: "linkedin-profile",
    tabId: 55,
    pageUrl: "https://www.linkedin.com/in/duongangela/",
    person: {
      personId: "li:duongangela",
      fullName: "Angela Duong",
      profileUrl: "https://www.linkedin.com/in/duongangela/",
      headline: "Restaurant Partnerships at Uber Eats"
    }
  };
  const stored = {
    people: {
      "li:duongangela": {
        personId: "li:duongangela",
        fullName: "Angela Duong",
        profileUrl: "https://www.linkedin.com/in/duongangela/",
        identity: {
          publicProfileUrl: "https://www.linkedin.com/in/duongangela/",
          knownProfileUrls: ["https://www.linkedin.com/in/duongangela/"]
        }
      },
      "li:ACoAABzTAGkBYKSDR7PqUopn1G6KwoH9OxBy8IE": {
        personId: "li:ACoAABzTAGkBYKSDR7PqUopn1G6KwoH9OxBy8IE",
        fullName: "Angela Duong",
        profileUrl: "https://www.linkedin.com/in/duongangela/",
        messagingThreadUrl: "https://www.linkedin.com/messaging/thread/2-abc/",
        identity: {
          publicProfileUrl: "https://www.linkedin.com/in/duongangela/",
          knownProfileUrls: ["https://www.linkedin.com/in/duongangela/"]
        }
      }
    },
    tabPersonBindings: {
      "55": "li:ACoAABzTAGkBYKSDR7PqUopn1G6KwoH9OxBy8IE"
    },
    threadPersonBindings: {}
  };

  const result = resolveStoredPersonMatch(pageContext, stored);
  assert.equal(result.matchedRecord?.personId, "li:ACoAABzTAGkBYKSDR7PqUopn1G6KwoH9OxBy8IE");
  assert.equal(result.matchType, "tab_binding_profile_person");
});

test("resolveStoredPersonMatch prefers an explicit pending profile handoff over a stale public-tab binding", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "background.js"), "utf8");
  const context = vm.createContext({
    pendingProfileIdentityHandoffsByTabId: new Map([[
      55,
      {
        personId: "li:ACoAABzTAGkBYKSDR7PqUopn1G6KwoH9OxBy8IE",
        fullName: "Angela Duong",
        targetHref: "https://www.linkedin.com/in/ACoAABzTAGkBYKSDR7PqUopn1G6KwoH9OxBy8IE/",
        startedAt: "2026-05-12T23:30:00.000Z"
      }
    ]]),
    PENDING_PROFILE_IDENTITY_HANDOFF_MAX_AGE_MS: 2 * 60 * 1000,
    Date: class extends Date {
      constructor(...args) {
        super(...(args.length ? args : ["2026-05-12T23:30:30.000Z"]));
      }
      static now() {
        return new Date("2026-05-12T23:30:30.000Z").getTime();
      }
    },
    normalizeWhitespace(value) {
      return String(value || "").replace(/\s+/g, " ").trim();
    },
    normalizeLinkedInProfileUrl(value) {
      return String(value || "").trim();
    },
    normalizeUrl(value) {
      return String(value || "").trim();
    },
    shouldResolveLinkedInProfileUrl(value) {
      return /\/in\/ACo/i.test(String(value || "").trim());
    },
    linkedInProfileAlias(value) {
      return String(value || "").trim().toLowerCase();
    },
    primaryLinkedInMemberUrl(record) {
      return String(record?.identity?.primaryLinkedInMemberUrl || "");
    },
    publicProfileUrl(record) {
      return String(record?.identity?.publicProfileUrl || "");
    },
    knownProfileUrls(record) {
      return Array.isArray(record?.identity?.knownProfileUrls) ? record.identity.knownProfileUrls : [];
    },
    personNameHeadlineSignature() {
      return "";
    },
    hasMatchingIdentityAlias(record, candidate) {
      const recordAliases = new Set(Array.isArray(record?.identity?.aliases) ? record.identity.aliases : []);
      const candidateAliases = Array.isArray(candidate?.identity?.aliases) ? candidate.identity.aliases : [];
      return candidateAliases.some((value) => recordAliases.has(value));
    },
    getDraftWorkspace() {
      return null;
    },
    isOwnProfilePageContext() {
      return false;
    },
    resolveProfileClickTraceMatch() {
      return null;
    },
    findRecordByNameHeadlineSignature() {
      return null;
    },
    findRecordByMessagingThreadUrl() {
      return null;
    },
    findRecordByDraftWorkspaceThreadUrl() {
      return null;
    },
    findRecordByPrimaryLinkedInMemberUrl() {
      return null;
    },
    findRecordByPublicProfileUrl(people) {
      return people["li:duongangela"];
    },
    findRecordByKnownProfileUrl() {
      return null;
    },
    findIdentityCandidates() {
      return [];
    },
    recordMatchesProfileNameHeadline(record) {
      return Boolean(record?.profileNameHeadlineMatch);
    },
    hasMatchingNameEvidence() {
      return false;
    },
    hasMatchingHeadlinePrefixEvidence() {
      return false;
    },
    hasMatchingProfileEvidence() {
      return false;
    }
  });

  const code = [
    extractFunction(source, "getPendingProfileIdentityHandoffForPage"),
    extractFunction(source, "previewIdentityHints"),
    extractFunction(source, "recordMatchesExplicitPageIdentity"),
    extractFunction(source, "recordMatchesPageContext"),
    extractFunction(source, "resolveStoredPersonMatch")
  ].join("\n\n");

  const { resolveStoredPersonMatch } = vm.runInContext(`(() => { ${code}; return { resolveStoredPersonMatch }; })()`, context);

  const pageContext = {
    pageType: "linkedin-profile",
    tabId: 55,
    pageUrl: "https://www.linkedin.com/in/duongangela/",
    person: {
      personId: "li:duongangela",
      fullName: "Angela Duong",
      profileUrl: "https://www.linkedin.com/in/duongangela/",
      headline: "Restaurant Partnerships at Uber Eats"
    }
  };
  const stored = {
    people: {
      "li:duongangela": {
        personId: "li:duongangela",
        fullName: "Angela Duong",
        profileUrl: "https://www.linkedin.com/in/duongangela/",
        identity: {
          publicProfileUrl: "https://www.linkedin.com/in/duongangela/",
          knownProfileUrls: ["https://www.linkedin.com/in/duongangela/"]
        }
      },
      "li:ACoAABzTAGkBYKSDR7PqUopn1G6KwoH9OxBy8IE": {
        personId: "li:ACoAABzTAGkBYKSDR7PqUopn1G6KwoH9OxBy8IE",
        fullName: "Angela Duong",
        profileUrl: "https://www.linkedin.com/in/ACoAABzTAGkBYKSDR7PqUopn1G6KwoH9OxBy8IE/",
        messagingThreadUrl: "https://www.linkedin.com/messaging/thread/2-abc/",
        profileNameHeadlineMatch: true,
        identity: {
          primaryLinkedInMemberUrl: "https://www.linkedin.com/in/ACoAABzTAGkBYKSDR7PqUopn1G6KwoH9OxBy8IE/",
          knownProfileUrls: ["https://www.linkedin.com/in/ACoAABzTAGkBYKSDR7PqUopn1G6KwoH9OxBy8IE/"]
        }
      }
    },
    tabPersonBindings: {
      "55": "li:duongangela"
    },
    threadPersonBindings: {}
  };

  const result = resolveStoredPersonMatch(pageContext, stored);
  assert.equal(result.matchedRecord?.personId, "li:ACoAABzTAGkBYKSDR7PqUopn1G6KwoH9OxBy8IE");
  assert.equal(result.matchType, "pending_profile_handoff");
});

test("resolveStoredPersonMatch keeps a profile tab on the thread-backed person before the public alias has been persisted", () => {
  const { resolveStoredPersonMatch } = loadResolveStoredPersonMatch();

  const pageContext = {
    pageType: "linkedin-profile",
    tabId: 55,
    pageUrl: "https://www.linkedin.com/in/duongangela/",
    person: {
      personId: "li:duongangela",
      fullName: "Angela Duong",
      profileUrl: "https://www.linkedin.com/in/duongangela/",
      headline: "Restaurant Partnerships at Uber Eats"
    }
  };
  const stored = {
    people: {
      "li:duongangela": {
        personId: "li:duongangela",
        fullName: "Angela Duong",
        profileUrl: "https://www.linkedin.com/in/duongangela/",
        identity: {
          publicProfileUrl: "https://www.linkedin.com/in/duongangela/",
          knownProfileUrls: ["https://www.linkedin.com/in/duongangela/"]
        }
      },
      "li:ACoAABzTAGkBYKSDR7PqUopn1G6KwoH9OxBy8IE": {
        personId: "li:ACoAABzTAGkBYKSDR7PqUopn1G6KwoH9OxBy8IE",
        fullName: "Angela Duong",
        profileUrl: "https://www.linkedin.com/in/ACoAABzTAGkBYKSDR7PqUopn1G6KwoH9OxBy8IE/",
        messagingThreadUrl: "https://www.linkedin.com/messaging/thread/2-abc/",
        profileNameHeadlineMatch: true,
        identity: {
          primaryLinkedInMemberUrl: "https://www.linkedin.com/in/ACoAABzTAGkBYKSDR7PqUopn1G6KwoH9OxBy8IE/",
          knownProfileUrls: ["https://www.linkedin.com/in/ACoAABzTAGkBYKSDR7PqUopn1G6KwoH9OxBy8IE/"]
        }
      }
    },
    tabPersonBindings: {
      "55": "li:ACoAABzTAGkBYKSDR7PqUopn1G6KwoH9OxBy8IE"
    },
    threadPersonBindings: {}
  };

  const result = resolveStoredPersonMatch(pageContext, stored);
  assert.equal(result.matchedRecord?.personId, "li:ACoAABzTAGkBYKSDR7PqUopn1G6KwoH9OxBy8IE");
  assert.equal(result.matchType, "tab_binding_profile_person");
});

test("preferBetterHeadline replaces junk sidebar suggestions with a real role line", () => {
  const { preferBetterHeadline } = loadIdentityHelpers();

  assert.equal(
    preferBetterHeadline(
      "Restaurant Partnerships at Uber Eats",
      "Explore Premium profiles Promila Tanwar · 3rd Senior Product Manager @ Fiserv Message"
    ),
    "Restaurant Partnerships at Uber Eats"
  );
});
