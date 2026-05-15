(function initJobOutreachAi(global) {
  const promptPackRuntime = global.LumiPromptPackRuntime;
  const shared = global.LinkedInAssistantShared || {};
  if (!promptPackRuntime) {
    return;
  }
  const normalizeWhitespace = shared.normalizeWhitespace
    || ((value) => String(value || "").replace(/\s+/g, " ").trim());
  const extractJsonFromText = shared.extractJsonFromText || ((rawText) => JSON.parse(rawText));
  const truncate = shared.truncate || ((value, limit) => {
    const text = normalizeWhitespace(value);
    if (!limit || text.length <= limit) {
      return text;
    }
    return `${text.slice(0, Math.max(0, limit - 1)).trim()}…`;
  });
  const SEARCH_KEYS = ["A", "B", "C"];
  const SEARCH_URL_CONTRACT_VERSION = "job_outreach_search_urls_v1";
  const RANKING_CONTRACT_VERSION = "job_outreach_ranking_v1";
  const RANKING_BEST_USE_VALUES = Object.freeze([
    "direct_referral_path",
    "hiring_context",
    "warm_entry_point",
    "peer_team_insight",
    "low_value"
  ]);

  function toArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function uniqueText(values) {
    return Array.from(new Set(toArray(values).map(normalizeWhitespace).filter(Boolean)));
  }

  function normalizeCriteriaLocations(values) {
    const raw = uniqueText(values);
    const result = [];
    for (let index = 0; index < raw.length; index += 1) {
      const current = raw[index];
      const next = raw[index + 1] || "";
      if (next && /^[A-Z]{2}$/i.test(next) && !/,/.test(current)) {
        result.push(`${current}, ${next.toUpperCase()}`);
        index += 1;
      } else {
        result.push(current);
      }
    }
    return uniqueText(result.map((location) => location.replace(/\s*\+\d+\s+more\b/i, "").trim()));
  }

  function normalizeCriteriaSchools(values) {
    const normalized = uniqueText(values)
      .map((school) => normalizeWhitespace(school)
        .replace(/^(?:education|education highlights?|school|schools)\s*[:\-]?\s*/i, "")
        .replace(/\b(?:bachelor'?s?|master'?s?|mba|ms|ma|bs|ba|degree|candidate|graduate|alumni)\b.*$/i, "")
        .replace(/\s*[|\u2022\u00b7]\s*.*$/, "")
        .trim())
      .filter((school) => {
        if (!school || school.length < 3 || /^of\s+/i.test(school)) {
          return false;
        }
        if (/^(?:school|college|institute)\s+of\s+/i.test(school) && !/\b(?:yale|national|singapore|stanford|harvard|mit|university)\b/i.test(school)) {
          return false;
        }
        return true;
      });
    return normalized.filter((school) => {
      const lower = school.toLowerCase();
      return !normalized.some((other) => other !== school && other.toLowerCase().includes(lower));
    });
  }

  function safeJson(value) {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return null;
    }
  }

  function jsonObjectText(rawText) {
    const text = String(rawText || "").trim();
    const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch) {
      return fencedMatch[1].trim();
    }
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    return start >= 0 && end > start ? text.slice(start, end + 1) : text;
  }

  function stripWrappingQuotes(value) {
    const text = String(value || "").trim();
    return text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1) : text;
  }

  function trimUrlCandidate(value) {
    return normalizeWhitespace(value)
      .replace(/^\[+/, "")
      .replace(/\]+$/, "")
      .replace(/^["']+/, "")
      .replace(/["']+$/, "");
  }

  function plainLinkedInSearchUrl(value) {
    let text = normalizeWhitespace(value);
    if (!text) {
      return "";
    }
    const directMarkdownUrl = text.match(/^\[[^\]]+\]\((https:\/\/www\.linkedin\.com\/search\/results\/people\/\?.*)\)$/i);
    if (directMarkdownUrl) {
      text = directMarkdownUrl[1];
    } else {
      const visibleMarkdownUrl = text.match(/^\[(https:\/\/www\.linkedin\.com\/search\/results\/people\/\?[^\]]+)\]\(https:\/\/www\.linkedin\.com\/search\/results\/people\/\?/i);
      if (visibleMarkdownUrl) {
        text = visibleMarkdownUrl[1];
      }
    }
    const firstUrl = text.match(/https:\/\/www\.linkedin\.com\/search\/results\/people\/\?[^\s"']+/i);
    if (firstUrl && !/^https:\/\//i.test(text)) {
      text = firstUrl[0].split("](")[0];
    }
    return trimUrlCandidate(text);
  }

  function repairJsonStringFieldLine(line, fieldName, transformValue) {
    const pattern = new RegExp(`^(\\s*"${fieldName}"\\s*:\\s*)(.*?)(,?)\\s*$`);
    const match = line.match(pattern);
    if (!match) {
      return line;
    }
    const prefix = match[1];
    const comma = match[3] || "";
    const rawValue = stripWrappingQuotes(match[2].trim());
    const repairedValue = typeof transformValue === "function" ? transformValue(rawValue) : rawValue;
    return `${prefix}${JSON.stringify(repairedValue)}${comma}`;
  }

  function repairCommonProviderJson(rawText) {
    return jsonObjectText(rawText)
      .split(/\n/)
      .map((line) => repairJsonStringFieldLine(line, "keywords", normalizeWhitespace))
      .map((line) => repairJsonStringFieldLine(line, "url", plainLinkedInSearchUrl))
      .join("\n");
  }

  function parseJsonCandidate(raw) {
    if (raw && typeof raw === "object") {
      return raw;
    }
    const rawText = String(raw || "");
    try {
      return extractJsonFromText(rawText);
    } catch (error) {
      const repairedText = repairCommonProviderJson(rawText);
      const repaired = safeJson(repairedText);
      if (repaired) {
        return repaired;
      }
      throw error;
    }
  }

  function normalizeLinkedInSearchUrl(url) {
    const value = plainLinkedInSearchUrl(url);
    if (!value) {
      return "";
    }
    try {
      const parsed = new URL(value);
      const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
      if (host !== "linkedin.com" || !/^\/search\/results\/people\/?$/i.test(parsed.pathname)) {
        return "";
      }
      return parsed.toString();
    } catch (_error) {
      return "";
    }
  }

  function criterionEnabled(search, key) {
    const selected = uniqueText(search?.enabledCriteria).map((value) => value.toLowerCase());
    if (!selected.length) {
      return true;
    }
    if (key === "company") {
      return selected.includes("company") || selected.includes("currentcompany") || selected.includes("current_company");
    }
    return selected.includes(key);
  }

  function buildLinkedInSearchKeywords(search) {
    return normalizeWhitespace(search?.keywords);
  }

  function buildKeywordSearchUrl(search, index) {
    const terms = buildLinkedInSearchKeywords(search);
    const url = new URL("https://www.linkedin.com/search/results/people/");
    url.searchParams.set("keywords", terms);
    url.searchParams.set("origin", `LUMI_JOB_OUTREACH_${SEARCH_KEYS[index] || index + 1}`);
    return url.toString();
  }

  function normalizeSearchUrlKeywords(url, search) {
    const normalizedUrl = normalizeLinkedInSearchUrl(url);
    if (!normalizedUrl) {
      return "";
    }
    try {
      const parsed = new URL(normalizedUrl);
      const keywords = normalizeWhitespace(search?.keywords);
      if (keywords) {
        parsed.searchParams.set("keywords", keywords);
      } else {
        parsed.searchParams.delete("keywords");
      }
      return parsed.toString();
    } catch (_error) {
      return normalizedUrl;
    }
  }

  function searchUrlHasParam(url, paramName) {
    const normalizedUrl = normalizeLinkedInSearchUrl(url);
    if (!normalizedUrl) {
      return false;
    }
    try {
      const parsed = new URL(normalizedUrl);
      const value = normalizeWhitespace(parsed.searchParams.get(paramName));
      return Boolean(value && value !== "[]" && value !== "%5B%5D");
    } catch (_error) {
      return false;
    }
  }

  function normalizeSearchInput(input) {
    const searches = toArray(input?.searches).slice(0, 3).map((search, index) => {
      const criteria = search?.criteria || {};
      const normalizedSearch = {
        searchKey: normalizeWhitespace(search?.searchKey || SEARCH_KEYS[index] || String(index + 1)),
        searchNumber: Number(search?.searchNumber || index + 1),
        keywords: normalizeWhitespace(search?.keywords),
        enabledCriteria: uniqueText(search?.enabledCriteria),
        criteria: {
          locations: normalizeCriteriaLocations(criteria.locations),
          schools: normalizeCriteriaSchools(criteria.schools),
          currentCompany: normalizeWhitespace(criteria.currentCompany)
        }
      };
      return {
        ...normalizedSearch,
        criteria: {
          locations: criterionEnabled(normalizedSearch, "locations") ? normalizedSearch.criteria.locations : [],
          schools: criterionEnabled(normalizedSearch, "schools") ? normalizedSearch.criteria.schools : [],
          currentCompany: criterionEnabled(normalizedSearch, "company") ? normalizedSearch.criteria.currentCompany : ""
        }
      };
    }).filter((search) => search.keywords);
    return {
      searches
    };
  }

  function compactArray(values, limit, itemLimit) {
    return uniqueText(values).slice(0, limit).map((value) => truncate(value, itemLimit));
  }

  function normalizeRankingBestUse(value) {
    const normalized = normalizeWhitespace(value).toLowerCase().replace(/\s+/g, "_");
    return RANKING_BEST_USE_VALUES.includes(normalized) ? normalized : "";
  }

  function sanitizeMutualConnectionsTextForRanking(text) {
    const normalized = normalizeWhitespace(text);
    if (!/mutual connection/i.test(normalized)) {
      return "";
    }
    const directCount = Number(normalized.match(/(\d+)\s+mutual connections?/i)?.[1] || 0);
    if (directCount > 0) {
      return `${directCount} mutual connection${directCount === 1 ? "" : "s"}`;
    }
    const namedPlusOthersMatch = normalized.match(/and\s+(\d+)\s+other mutual connections?/i);
    if (namedPlusOthersMatch) {
      const total = Number(namedPlusOthersMatch[1] || 0) + 1;
      return `${total} mutual connections`;
    }
    if (/mutual connection/i.test(normalized)) {
      return "Has mutual connections";
    }
    return "";
  }

  function looksLikeIndirectIntroStrategy(text) {
    const normalized = normalizeWhitespace(text).toLowerCase();
    if (!normalized) {
      return false;
    }
    return /warm introduction|warm intro/.test(normalized)
      || /ask\s+.+\s+for\s+(?:a\s+)?(?:warm\s+)?(?:introduction|intro)\s+to\b/.test(normalized)
      || /have\s+.+\s+introduce\b/.test(normalized)
      || /through\s+(?:a\s+)?mutual connection\b/.test(normalized);
  }

  function compactJobForRanking(job) {
    const source = job || {};
    return {
      title: normalizeWhitespace(source.title),
      company: normalizeWhitespace(source.company),
      location: normalizeWhitespace(source.location),
      datePosted: normalizeWhitespace(source.datePosted),
      sourceUrl: normalizeWhitespace(source.sourceUrl || source.jobUrl || source.pageUrl),
      description: truncate(source.description, 3500)
    };
  }

  function compactMyProfileForRanking(profile) {
    const source = profile || {};
    const profileData = source.profileData || source.latestProfileData || source;
    const visibleSignals = profileData.visibleSignals || source.visibleSignals || {};
    return {
      ownProfileUrl: normalizeWhitespace(source.ownProfileUrl || source.profileUrl),
      fullName: normalizeWhitespace(profileData.fullName || source.fullName),
      headline: truncate(profileData.headline || source.headline, 240),
      location: normalizeWhitespace(profileData.location || source.location),
      manualNotes: truncate(source.manualNotes, 600),
      profileData: {
        about: truncate(profileData.about || source.about, 900),
        profileSummary: truncate(profileData.profileSummary || source.profileSummary, 500),
        experienceHighlights: compactArray(profileData.experienceHighlights || source.experienceHighlights, 5, 260),
        educationHighlights: compactArray(profileData.educationHighlights || source.educationHighlights, 4, 180),
        activitySnippets: compactArray(profileData.activitySnippets || source.activitySnippets, 4, 180),
        languageSnippets: compactArray(profileData.languageSnippets || source.languageSnippets, 4, 120),
        visibleSignals: {
          companies: uniqueText(visibleSignals.companies || []).slice(0, 8),
          schools: uniqueText(visibleSignals.schools || []).slice(0, 8),
          locations: uniqueText(visibleSignals.locations || []).slice(0, 5),
          languages: uniqueText(visibleSignals.languages || []).slice(0, 5)
        }
      },
      latestActivitySnippets: compactArray(source.latestActivitySnippets || profileData.activitySnippets, 4, 180)
    };
  }

  function compactPersonForRanking(person) {
    return {
      name: normalizeWhitespace(person?.name),
      profileUrl: normalizeWhitespace(person?.profileUrl || person?.profile_url),
      connectionDegree: normalizeWhitespace(person?.connectionDegree || person?.connection_degree),
      headline: truncate(person?.headline, 240),
      location: normalizeWhitespace(person?.location),
      currentText: truncate(person?.currentText || person?.current_text, 240),
      pastText: truncate(person?.pastText || person?.past_text, 220),
      mutualConnectionsText: sanitizeMutualConnectionsTextForRanking(person?.mutualConnectionsText || person?.mutual_connections_text),
      followersText: normalizeWhitespace(person?.followersText || person?.followers_text),
      linkedInAiInsight: truncate(person?.linkedInAiInsight || person?.aiGeneratedInsight || person?.ai_generated_insight, 260),
      primaryAction: normalizeWhitespace(person?.primaryAction || person?.action || person?.primary_action)
    };
  }

  function normalizeRankingInput(input) {
    return {
      job: compactJobForRanking(input?.job || {}),
      myProfile: compactMyProfileForRanking(input?.myProfile || null),
      searches: toArray(input?.searches).slice(0, 3).map((search, index) => ({
        searchKey: normalizeWhitespace(search?.searchKey || SEARCH_KEYS[index] || String(index + 1)),
        searchNumber: Number(search?.searchNumber || index + 1),
        keywords: normalizeWhitespace(search?.keywords),
        searchUrl: normalizeWhitespace(search?.searchUrl),
        people: toArray(search?.people).map(compactPersonForRanking).filter((person) => person.name || person.profileUrl)
      }))
    };
  }

  function searchUrlPromptTemplate(promptPackSettings) {
    return promptPackRuntime.getBuiltInTemplate("job_outreach_search_url", promptPackSettings);
  }

  function buildSearchUrlPrompt(input, promptPackSettings) {
    const normalized = normalizeSearchInput(input);
    return promptPackRuntime.applyTemplate(searchUrlPromptTemplate(promptPackSettings), {
      search_url_examples: [
        JSON.stringify({
          wrong_url: "https://www.linkedin.com/search/results/people/?keywords=product%20manager%20%22vietnamese%22%20%22LendingClub%22%20%22san%20francisco%22&geoUrn=%5B%22103644278%22%5D",
          correct_url: "https://www.linkedin.com/search/results/people/?keywords=product%20manager%20%22vietnamese%22&origin=GLOBAL_SEARCH_HEADER&geoUrn=%5B%22103644278%22%2C%2290000084%22%5D&currentCompany=%5B%2242519%22%5D",
          lesson: "LendingClub and San Francisco are criteria, so remove them from keywords and encode them as currentCompany and geoUrn."
        }, null, 2),
        JSON.stringify({
          wrong_url: "https://www.linkedin.com/search/results/people/?keywords=product%20manager%20%22LendingClub%22%20%22yale%20school%20of%20management%22%20%22san%20francisco%22&geoUrn=%5B%22103644278%22%5D",
          correct_url: "https://www.linkedin.com/search/results/people/?keywords=product%20manager&origin=GLOBAL_SEARCH_HEADER&geoUrn=%5B%2290000084%22%2C%22103644278%22%5D&currentCompany=%5B%2242519%22%5D&schoolFilter=%5B%224073%22%5D",
          lesson: "LendingClub, Yale School of Management, and San Francisco are criteria, so encode them as currentCompany, schoolFilter, and geoUrn instead of keywords."
        }, null, 2),
        JSON.stringify({
          wrong_url: "https://www.linkedin.com/search/results/people/?keywords=Lead%20Product%20Manager%20%22PayPal%22%20%22National%20University%20of%20Singapore%22%20%22San%20Jose%22%20CA",
          correct_url_when_ids_are_unknown: "https://www.linkedin.com/search/results/people/?keywords=Lead%20Product%20Manager&origin=GLOBAL_SEARCH_HEADER",
          filters_to_resolve_when_possible: ["currentCompany=PayPal LinkedIn company id", "schoolFilter=National University of Singapore LinkedIn school id", "geoUrn=San Jose LinkedIn location id"],
          lesson: "Lead Product Manager is the keyword. PayPal, National University of Singapore, and San Jose are criteria, so resolve them into LinkedIn filters when possible and never put them in keyword text."
        }, null, 2)
      ].join("\n"),
      search_url_contract_version: SEARCH_URL_CONTRACT_VERSION,
      search_url_contract_shape: JSON.stringify({
        contract_version: SEARCH_URL_CONTRACT_VERSION,
        searches: [
          {
            search_key: "A",
            url: "https://www.linkedin.com/search/results/people/?keywords=..."
          }
        ]
      }, null, 2),
      searches_json: JSON.stringify(normalized, null, 2)
    });
  }

  function validateSearchUrlResponse(raw, input) {
    const normalizedInput = normalizeSearchInput(input);
    const parsed = parseJsonCandidate(raw);
    const contractId = normalizeWhitespace(promptPackRuntime.getBuiltInContract("job_outreach_search_url").contract_id || SEARCH_URL_CONTRACT_VERSION);
    const searches = toArray(parsed?.searches);
    const expectedKeys = new Set(normalizedInput.searches.map((search) => search.searchKey));
    const inputByKey = new Map(normalizedInput.searches.map((search) => [search.searchKey, search]));
    const normalizedSearches = searches.map((search) => {
      const searchKey = normalizeWhitespace(search?.search_key || search?.searchKey);
      const inputSearch = inputByKey.get(searchKey) || null;
      return {
        searchKey,
        keywords: normalizeWhitespace(inputSearch?.keywords || search?.keywords),
        url: normalizeSearchUrlKeywords(search?.url, inputSearch),
        appliedCriteria: {
          locations: uniqueText(search?.applied_criteria?.locations || search?.appliedCriteria?.locations),
          schools: uniqueText(search?.applied_criteria?.schools || search?.appliedCriteria?.schools),
          currentCompany: normalizeWhitespace(search?.applied_criteria?.current_company || search?.appliedCriteria?.currentCompany)
        },
        note: normalizeWhitespace(search?.note)
      };
    }).filter((search) => search.searchKey || search.url);

    const errors = [];
    if (!normalizedSearches.length) {
      errors.push("No searches were returned.");
    }
    for (const expectedKey of expectedKeys) {
      const match = normalizedSearches.find((search) => search.searchKey === expectedKey);
      if (!match) {
        errors.push(`Missing search ${expectedKey}.`);
      } else if (!match.url) {
        errors.push(`Search ${expectedKey} is missing a valid LinkedIn people-search URL.`);
      } else {
        const expected = inputByKey.get(expectedKey);
        if (expected?.criteria?.currentCompany && !searchUrlHasParam(match.url, "currentCompany")) {
          errors.push(`Search ${expectedKey} must encode current company as currentCompany, not keyword text.`);
        }
        if (Array.isArray(expected?.criteria?.schools) && expected.criteria.schools.length && !searchUrlHasParam(match.url, "schoolFilter")) {
          errors.push(`Search ${expectedKey} must encode selected schools as schoolFilter, not keyword text.`);
        }
        if (Array.isArray(expected?.criteria?.locations) && expected.criteria.locations.length && !searchUrlHasParam(match.url, "geoUrn")) {
          errors.push(`Search ${expectedKey} must encode selected locations as geoUrn, not keyword text.`);
        }
      }
    }
    const extra = normalizedSearches.find((search) => search.searchKey && !expectedKeys.has(search.searchKey));
    if (extra) {
      errors.push(`Unexpected search key ${extra.searchKey}.`);
    }
    if (contractId !== SEARCH_URL_CONTRACT_VERSION) {
      errors.push(`Unsupported search-url contract: ${contractId}.`);
    }
    if (errors.length) {
      return { ok: false, errors, value: null, raw: parsed };
    }
    return {
      ok: true,
      errors: [],
      raw: parsed,
      value: {
        contractVersion: normalizeWhitespace(parsed?.contract_version || parsed?.contractVersion || SEARCH_URL_CONTRACT_VERSION),
        searches: normalizedSearches
      }
    };
  }

  function buildFallbackSearchUrlResponse(input) {
    return buildDeterministicSearchUrlResponse(input);
  }

  function buildDeterministicSearchUrlResponse(input) {
    const normalized = normalizeSearchInput(input);
    return {
      contract_version: SEARCH_URL_CONTRACT_VERSION,
      searches: normalized.searches.map((search, index) => ({
        search_key: search.searchKey,
        keywords: buildLinkedInSearchKeywords(search),
        url: buildKeywordSearchUrl(search, index)
      }))
    };
  }

  function rankingPromptTemplate(promptPackSettings) {
    return promptPackRuntime.getBuiltInTemplate("job_outreach_ranking", promptPackSettings);
  }

  function buildRankingPrompt(input, promptPackSettings) {
    const normalized = normalizeRankingInput(input);
    return promptPackRuntime.applyTemplate(rankingPromptTemplate(promptPackSettings), {
      ranking_contract_version: RANKING_CONTRACT_VERSION,
      ranking_contract_shape: JSON.stringify({
        contract_version: RANKING_CONTRACT_VERSION,
        job_brief: "one short paragraph about the role",
        fit_summary: "why the sender can credibly fit",
        caveats: ["short caveat"],
        list_evaluations: [
          {
            search_key: "A",
            summary: "short quality read",
            best_use: "peer_team_insight"
          }
        ],
        people: [
          {
            profile_url: "https://www.linkedin.com/in/example/",
            source_search_key: "A",
            rank: 1,
            confidence: 0.86,
            best_use: "direct_referral_path",
            reason: "one sentence",
            approach_strategy: "one sentence for how to approach this person"
          }
        ],
        overall_strategy: "short approach strategy across the ranked list"
      }, null, 2),
      searches_json: JSON.stringify(normalized, null, 2)
    });
  }

  function validateRankingResponse(raw, input) {
    const normalizedInput = normalizeRankingInput(input);
    const parsed = parseJsonCandidate(raw);
    const contractId = normalizeWhitespace(promptPackRuntime.getBuiltInContract("job_outreach_ranking").contract_id || RANKING_CONTRACT_VERSION);
    const knownUrls = new Set(normalizedInput.searches.flatMap((search) =>
      toArray(search.people).map((person) => normalizeWhitespace(person.profileUrl)).filter(Boolean)
    ));
    const people = toArray(parsed?.people).map((person) => ({
      profileUrl: normalizeWhitespace(person?.profile_url || person?.profileUrl),
      sourceSearchKey: normalizeWhitespace(person?.source_search_key || person?.sourceSearchKey),
      rank: Math.max(1, Number(person?.rank || 0) || 0),
      confidence: Math.max(0, Math.min(1, Number(person?.confidence || 0))),
      bestUse: normalizeRankingBestUse(person?.best_use || person?.bestUse),
      reason: normalizeWhitespace(person?.reason),
      approachStrategy: normalizeWhitespace(person?.approach_strategy || person?.approachStrategy)
    })).filter((person) => person.profileUrl);
    const errors = [];
    const listEvaluations = toArray(parsed?.list_evaluations || parsed?.listEvaluations).map((item) => ({
      searchKey: normalizeWhitespace(item?.search_key || item?.searchKey),
      summary: normalizeWhitespace(item?.summary),
      bestUse: normalizeRankingBestUse(item?.best_use || item?.bestUse)
    })).filter((item) => item.searchKey || item.summary);
    if (!normalizeWhitespace(parsed?.job_brief || parsed?.jobBrief)) {
      errors.push("Missing job_brief.");
    }
    if (!normalizeWhitespace(parsed?.fit_summary || parsed?.fitSummary)) {
      errors.push("Missing fit_summary.");
    }
    if (!people.length) {
      errors.push("No people rankings were returned.");
    }
    const unknown = people.find((person) => knownUrls.size && !knownUrls.has(person.profileUrl));
    if (unknown) {
      errors.push(`Unknown ranked profile URL: ${unknown.profileUrl}.`);
    }
    const incomplete = people.find((person) => !person.reason || !person.approachStrategy || !person.confidence || !person.bestUse);
    if (incomplete) {
      errors.push(`Incomplete ranking for ${incomplete.profileUrl}.`);
    }
    const invalidBestUse = people.find((person) => !person.bestUse);
    if (invalidBestUse) {
      errors.push(`Ranking for ${invalidBestUse.profileUrl} is missing a valid best_use classification.`);
    }
    const invalidListEvaluation = listEvaluations.find((item) => !item.bestUse);
    if (invalidListEvaluation) {
      errors.push(`Search evaluation for ${invalidListEvaluation.searchKey || "unknown"} is missing a valid best_use classification.`);
    }
    const indirectIntro = people.find((person) => looksLikeIndirectIntroStrategy(person.approachStrategy));
    if (indirectIntro) {
      errors.push(`Approach strategy for ${indirectIntro.profileUrl} must stay direct to the ranked person and must not route through a third-party introduction.`);
    }
    if (contractId !== RANKING_CONTRACT_VERSION) {
      errors.push(`Unsupported ranking contract: ${contractId}.`);
    }
    if (errors.length) {
      return { ok: false, errors, value: null, raw: parsed };
    }
    return {
      ok: true,
      errors: [],
      raw: parsed,
      value: {
        contractVersion: normalizeWhitespace(parsed?.contract_version || parsed?.contractVersion || RANKING_CONTRACT_VERSION),
        jobBrief: normalizeWhitespace(parsed?.job_brief || parsed?.jobBrief),
        fitSummary: normalizeWhitespace(parsed?.fit_summary || parsed?.fitSummary),
        caveats: uniqueText(parsed?.caveats),
        listEvaluations,
        people,
        overallStrategy: normalizeWhitespace(parsed?.overall_strategy || parsed?.overallStrategy)
      }
    };
  }

  function fallbackBestUseForPerson(person, job) {
    const company = normalizeWhitespace(job?.company).toLowerCase();
    const degree = normalizeWhitespace(person?.connectionDegree).toLowerCase();
    const headline = normalizeWhitespace(person?.headline).toLowerCase();
    const currentText = normalizeWhitespace(person?.currentText).toLowerCase();
    const combined = `${headline} ${currentText}`.trim();
    if (company && combined.includes(company) && /recruit|talent|hiring|people partner|recruiting/i.test(combined)) {
      return "direct_referral_path";
    }
    if (company && combined.includes(company) && /product|manager|lead|director|head|group product/i.test(combined)) {
      return degree === "1st" || degree === "2nd"
        ? "direct_referral_path"
        : "hiring_context";
    }
    if (/product|manager|lead|director|head/i.test(combined)) {
      return "peer_team_insight";
    }
    if (degree === "1st" || degree === "2nd" || /mutual connection/i.test(normalizeWhitespace(person?.mutualConnectionsText))) {
      return "warm_entry_point";
    }
    return "low_value";
  }

  function fallbackReasonForPerson(person, job) {
    const company = normalizeWhitespace(job?.company);
    const headline = normalizeWhitespace(person?.headline);
    const currentText = normalizeWhitespace(person?.currentText);
    if (company && new RegExp(company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(`${headline} ${currentText}`)) {
      return `Direct ${company} signal and reachable LinkedIn path.`;
    }
    if (/alum|yale|stanford|mit|harvard|berkeley|duke|school|mba/i.test(headline)) {
      return "Education or alumni signal creates a warmer opening.";
    }
    if (/product|manager|lead|head/i.test(headline)) {
      return "Product role context makes them useful for role and team insight.";
    }
    return "Relevant search match with usable profile context.";
  }

  function fallbackBestUseForSearch(search, job) {
    const firstPerson = toArray(search?.people)[0];
    return firstPerson ? fallbackBestUseForPerson(firstPerson, job) : "low_value";
  }

  function buildFallbackRankingResponse(input) {
    const normalized = normalizeRankingInput(input);
    const job = normalized.job || {};
    const allPeople = normalized.searches.flatMap((search) =>
      toArray(search.people).map((person) => ({
        person,
        searchKey: search.searchKey
      }))
    );
    return {
      contract_version: RANKING_CONTRACT_VERSION,
      job_brief: `${normalizeWhitespace(job.title) || "This role"} at ${normalizeWhitespace(job.company) || "the company"} needs targeted outreach for referral or warm support.`,
      fit_summary: "Use the saved sender profile plus the job requirements to position relevant product, AI, and domain experience.",
      caveats: ["Confirm team ownership and hiring proximity before asking for a referral."],
      list_evaluations: normalized.searches.map((search) => ({
        search_key: search.searchKey,
        summary: `${search.people.length} visible profiles for ${search.keywords}.`,
        best_use: fallbackBestUseForSearch(search, job)
      })),
      people: allPeople.map(({ person, searchKey }, index) => ({
        profile_url: normalizeWhitespace(person.profileUrl),
        source_search_key: searchKey,
        rank: index + 1,
        confidence: Math.max(0.55, 0.86 - index * 0.03),
        best_use: fallbackBestUseForPerson(person, job),
        reason: fallbackReasonForPerson(person, job),
        approach_strategy: `Open with the ${normalizeWhitespace(job.title) || "role"} context and ask for one practical suggestion or referral direction.`
      })).filter((person) => person.profile_url),
      overall_strategy: "Start with the fastest credible path toward the hiring manager or recruiting referral route, prefer people likely to actively help quickly, and avoid slower networking-first paths when openings are time-sensitive."
    };
  }

  async function runJsonContractWithRetry({ callAi, buildPrompt, buildRepairPrompt, validate, maxAttempts = 2 }) {
    if (typeof callAi !== "function") {
      throw new Error("No AI runner is configured for this contract.");
    }
    let lastErrors = [];
    let prompt = buildPrompt();
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const raw = await callAi(prompt, { attempt });
      const result = validate(raw);
      if (result.ok) {
        return { ...result, attempt, rawOutput: raw };
      }
      lastErrors = result.errors || [];
      prompt = typeof buildRepairPrompt === "function"
        ? buildRepairPrompt(lastErrors, raw)
        : `${prompt}\n\nYour previous response failed validation: ${lastErrors.join(" ")}\nReturn corrected JSON only.`;
    }
    throw new Error(lastErrors.join(" ") || "AI response failed validation.");
  }

  global.LumiJobOutreachAI = {
    SEARCH_KEYS,
    SEARCH_URL_CONTRACT_VERSION,
    RANKING_CONTRACT_VERSION,
    RANKING_BEST_USE_VALUES,
    searchUrlPromptTemplate,
    rankingPromptTemplate,
    buildSearchUrlPrompt,
    validateSearchUrlResponse,
    buildFallbackSearchUrlResponse,
    buildRankingPrompt,
    validateRankingResponse,
    buildFallbackRankingResponse,
    runJsonContractWithRetry
  };
})(globalThis);
