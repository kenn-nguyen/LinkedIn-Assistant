(function initLinkedInProfileExtraction() {
  const shared = globalThis.LinkedInAssistantShared;
  const {
    firstNameFromFullName,
    normalizeLinkedInProfileUrl,
    normalizeWhitespace,
    uniqueStrings
  } = shared;

  const PROFILE_FACTS_SCHEMA_VERSION = 1;
  const DEFAULT_ACTIVITY_SOURCE = "visible_profile_activity";

  function normalizeProfileIdentity(identity) {
    const fullName = normalizeWhitespace(identity?.fullName);
    const profileUrl = normalizeLinkedInProfileUrl(identity?.profileUrl || "");
    return {
      profileUrl,
      fullName,
      firstName: normalizeWhitespace(identity?.firstName) || firstNameFromFullName(fullName),
      headline: normalizeWhitespace(identity?.headline),
      location: normalizeWhitespace(identity?.location),
      connectionStatus: normalizeWhitespace(identity?.connectionStatus) || "unknown"
    };
  }

  function normalizeExperienceEntry(entry) {
    if (!entry || typeof entry !== "object") {
      return null;
    }
    return {
      title: normalizeWhitespace(entry.title),
      company: normalizeWhitespace(entry.company),
      employmentType: normalizeWhitespace(entry.employmentType),
      startDateText: normalizeWhitespace(entry.startDateText),
      endDateText: normalizeWhitespace(entry.endDateText),
      durationText: normalizeWhitespace(entry.durationText),
      location: normalizeWhitespace(entry.location),
      summary: normalizeWhitespace(entry.summary),
      bullets: uniqueStrings(entry.bullets || [])
    };
  }

  function normalizeEducationEntry(entry) {
    if (!entry || typeof entry !== "object") {
      return null;
    }
    return {
      school: normalizeWhitespace(entry.school),
      degree: normalizeWhitespace(entry.degree),
      startDateText: normalizeWhitespace(entry.startDateText),
      endDateText: normalizeWhitespace(entry.endDateText),
      durationText: normalizeWhitespace(entry.durationText),
      activities: uniqueStrings(entry.activities || []),
      notes: normalizeWhitespace(entry.notes)
    };
  }

  function normalizeLanguageEntry(entry) {
    if (!entry || typeof entry !== "object") {
      return null;
    }
    return {
      language: normalizeWhitespace(entry.language),
      proficiency: normalizeWhitespace(entry.proficiency)
    };
  }

  function normalizeActivityItem(item, index) {
    if (!item || typeof item !== "object") {
      return null;
    }
    const rank = Number.isFinite(Number(item.rank)) && Number(item.rank) > 0
      ? Math.floor(Number(item.rank))
      : index + 1;
    return {
      rank,
      isLatest: rank === 1 || Boolean(item.isLatest && index === 0),
      type: normalizeWhitespace(item.type) || "post",
      timestampText: normalizeWhitespace(item.timestampText),
      text: normalizeWhitespace(item.text),
      source: normalizeWhitespace(item.source) || DEFAULT_ACTIVITY_SOURCE
    };
  }

  function normalizeVisibleSignals(visibleSignals) {
    const source = visibleSignals || {};
    return {
      companies: uniqueStrings(source.companies || []),
      schools: uniqueStrings(source.schools || []),
      locations: uniqueStrings(source.locations || []),
      languages: uniqueStrings(source.languages || [])
    };
  }

  function createProfileFacts(input) {
    const identity = normalizeProfileIdentity(input?.identity || {});
    const activityItems = (Array.isArray(input?.recentActivity?.items) ? input.recentActivity.items : [])
      .map(normalizeActivityItem)
      .filter((item) => item?.text)
      .slice(0, 3)
      .map((item, index) => ({
        ...item,
        rank: index + 1,
        isLatest: index === 0
      }));
    return {
      schemaVersion: PROFILE_FACTS_SCHEMA_VERSION,
      identity,
      about: {
        text: normalizeWhitespace(input?.about?.text)
      },
      experience: (Array.isArray(input?.experience) ? input.experience : [])
        .map(normalizeExperienceEntry)
        .filter((entry) => entry && (entry.title || entry.company || entry.summary)),
      education: (Array.isArray(input?.education) ? input.education : [])
        .map(normalizeEducationEntry)
        .filter((entry) => entry?.school),
      languages: (Array.isArray(input?.languages) ? input.languages : [])
        .map(normalizeLanguageEntry)
        .filter((entry) => entry?.language),
      recentActivity: {
        source: normalizeWhitespace(input?.recentActivity?.source) || DEFAULT_ACTIVITY_SOURCE,
        items: activityItems
      },
      visibleSignals: normalizeVisibleSignals(input?.visibleSignals)
    };
  }

  function createProfileExtractionResult(input) {
    const facts = createProfileFacts(input?.facts || {});
    const hasImmediateProfileSignals = Boolean(facts.identity.fullName && facts.identity.headline);
    return {
      supported: hasImmediateProfileSignals,
      pageType: "linkedin-profile",
      pageUrl: normalizeWhitespace(input?.pageUrl),
      title: normalizeWhitespace(input?.title),
      reason: hasImmediateProfileSignals ? "" : "Loading profile...",
      profile: {
        firstName: facts.identity.firstName,
        fullName: facts.identity.fullName,
        profileUrl: facts.identity.profileUrl,
        headline: facts.identity.headline,
        about: facts.about.text,
        location: facts.identity.location,
        connectionStatus: facts.identity.connectionStatus,
        experienceHighlights: uniqueStrings(input?.compatibility?.experienceHighlights || []),
        educationHighlights: uniqueStrings(input?.compatibility?.educationHighlights || []),
        activitySnippets: uniqueStrings(input?.compatibility?.activitySnippets || []),
        languageSnippets: uniqueStrings(input?.compatibility?.languageSnippets || []),
        visibleSignals: facts.visibleSignals,
        profileFacts: facts,
        rawSnapshot: normalizeWhitespace(input?.rawSnapshot)
      }
    };
  }

  globalThis.LinkedInAssistantProfileExtraction = {
    PROFILE_FACTS_SCHEMA_VERSION,
    createProfileFacts,
    createProfileExtractionResult
  };
})();
