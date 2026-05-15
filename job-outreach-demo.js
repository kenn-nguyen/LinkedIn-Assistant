(function initJobOutreachDemo() {
  const searchLabels = ["A", "B", "C"];
  const FILTER_SUGGESTION_LIMIT = 5;
  const DEFAULT_LOCATION_FILTERS = [
    {
      type: "location",
      label: "United States",
      sourceText: "United States",
      id: "103644278",
      param: "geoUrn",
      state: "resolved",
      origin: "default"
    },
    {
      type: "location",
      label: "San Francisco Bay Area",
      sourceText: "San Francisco Bay Area",
      id: "90000084",
      param: "geoUrn",
      state: "resolved",
      origin: "default"
    }
  ];

  const state = {
    entries: [],
    globalCriteria: {
      locations: "",
      schools: "",
      company: ""
    },
    activeTab: "overall",
    rankings: {},
    lastRunEntries: [],
    runtimeJob: null,
    importedPeopleBySearch: {},
    myProfile: null,
    activeTabId: null,
    lastSearchPlan: null,
    lastRankingPlan: null,
    filterCache: {},
    runsById: {},
    runOrder: [],
    pageRunIds: [],
    activeRunIds: [],
    selectedRunId: "",
    selectedRunSource: "",
    activeRunId: "",
    activeWorkerTabId: null,
    manualAction: null,
    pendingRunEntries: [],
    loadedSavedRunId: "",
    profileSchoolPrefillLocked: false,
    initialized: false
  };

  const nodes = {};
  let runTimerIds = [];
  const normalizeWhitespace = globalThis.LinkedInAssistantShared?.normalizeWhitespace
    || ((value) => String(value || "").replace(/\s+/g, " ").trim());
  const cleanLinkedInCompanyDisplayName = globalThis.LinkedInAssistantShared?.cleanLinkedInCompanyDisplayName
    || ((value) => normalizeWhitespace(value));

  function getNode(id) {
    return document.querySelector(`#${id}`);
  }

  function cacheNodes() {
    Object.assign(nodes, {
      jobLink: getNode("job-demo-job-link"),
      jobRefresh: getNode("job-demo-refresh"),
      jobSubtitle: getNode("job-demo-job-subtitle"),
      searchEntries: getNode("job-demo-search-entries"),
      searchPanel: getNode("job-demo-search-panel"),
      strategySummary: getNode("job-demo-strategy-summary"),
      strategySummaryText: getNode("job-demo-strategy-summary-text"),
      globalLocations: getNode("job-demo-global-locations"),
      globalSchools: getNode("job-demo-global-schools"),
      globalCompany: getNode("job-demo-global-company"),
      searchError: getNode("job-demo-search-error"),
      addSearch: getNode("job-demo-add-search"),
      runSearch: getNode("job-demo-run-search"),
      submitSearch: getNode("job-demo-submit-search"),
      cancelSearchEdit: getNode("job-demo-cancel-search-edit"),
      runPanel: getNode("job-demo-run-panel"),
      runSummary: getNode("job-demo-run-summary"),
      runDetail: getNode("job-demo-run-detail"),
      runLink: getNode("job-demo-run-link"),
      activityBanner: getNode("job-demo-activity-banner"),
      activityTitle: getNode("job-demo-activity-title"),
      activityLink: getNode("job-demo-activity-link"),
      manualOverlay: getNode("job-demo-manual-overlay"),
      manualEyebrow: getNode("job-demo-manual-eyebrow"),
      manualTitle: getNode("job-demo-manual-title"),
      manualDetail: getNode("job-demo-manual-detail"),
      manualReason: getNode("job-demo-manual-reason"),
      manualFilters: getNode("job-demo-manual-filters"),
      openWorkerTab: getNode("job-demo-open-worker-tab"),
      resumeRun: getNode("job-demo-resume-run"),
      progressFill: getNode("job-demo-progress-fill"),
      rankPanel: getNode("job-demo-rank-panel"),
      rankTitle: getNode("job-demo-rank-title"),
      rankTabs: getNode("job-demo-rank-tabs"),
      resultsSearchLinks: getNode("job-demo-results-search-links"),
      rankList: getNode("job-demo-rank-list")
    });
  }

  function hasRequiredNodes() {
    return Boolean(nodes.jobLink && nodes.jobRefresh && nodes.searchEntries && nodes.addSearch && nodes.runSearch && nodes.submitSearch && nodes.rankList);
  }

  function cloneEntries(entries) {
    return entries.map((entry) => ({
      text: entry.text || "",
      filters: compactFilterPills(entry.filters || []),
      criteria: Array.isArray(entry.criteria) ? [...entry.criteria] : [],
      filterComposerOpen: Boolean(entry.filterComposerOpen),
      filterComposerType: normalizeFilterType(entry.filterComposerType)
    }));
  }

  function cloneWorkflowEntries(entries) {
    return (Array.isArray(entries) ? entries : []).map((entry, index) => ({
      index: Number.isFinite(Number(entry?.index)) ? Number(entry.index) : index,
      text: normalizeWhitespace(entry?.text),
      filters: compactFilterPills(entry?.filters || []),
      criteria: Array.isArray(entry?.criteria) ? [...entry.criteria] : []
    }));
  }

  function uniqueValues(values) {
    const seen = new Set();
    const result = [];
    (Array.isArray(values) ? values : []).forEach((value) => {
      const text = normalizeWhitespace(value);
      const key = text.toLowerCase();
      if (text && !seen.has(key)) {
        seen.add(key);
        result.push(text);
      }
    });
    return result;
  }

  function normalizeJobOutreachManualAction(action) {
    if (!action || typeof action !== "object") {
      return null;
    }
    const requestId = normalizeWhitespace(action.requestId || state.activeRunId);
    const summary = normalizeWhitespace(action.summary);
    const detail = normalizeWhitespace(action.detail);
    const reason = normalizeWhitespace(action.reason);
    const searchKey = normalizeWhitespace(action.searchKey);
    const workerTabId = typeof action.workerTabId === "number" ? action.workerTabId : null;
    const removableFilters = normalizeManualActionFilters(action.removableFilters || action.filters || action.unresolvedFilters);
    if (!requestId || !summary) {
      return null;
    }
    return {
      requestId,
      summary,
      detail,
      reason,
      searchKey,
      workerTabId,
      removableFilters,
      status: normalizeWhitespace(action.status || "awaiting_user_action"),
      progressPercent: Math.max(0, Math.min(100, Number(action.progressPercent || 0)))
    };
  }

  function normalizeManualActionFilters(filters) {
    return (Array.isArray(filters) ? filters : [])
      .map((filter) => {
        const type = normalizeFilterType(filter?.type);
        const sourceText = normalizeFilterDisplayText(type, filter?.sourceText || filter?.value || filter?.label);
        const label = normalizeFilterDisplayText(type, filter?.label || sourceText);
        if (!type || !sourceText) {
          return null;
        }
        return {
          type,
          label,
          sourceText,
          id: normalizeWhitespace(filter?.id),
          param: normalizeWhitespace(filter?.param || filterParamForType(type))
        };
      })
      .filter(Boolean);
  }

  function criteriaNamesFromFilters(filters) {
    const usable = (Array.isArray(filters) ? filters : []).filter((filter) => filter.state !== "failed");
    return uniqueValues([
      usable.some((filter) => filter.type === "company") ? "company" : "",
      usable.some((filter) => filter.type === "location") ? "locations" : "",
      usable.some((filter) => filter.type === "school") ? "schools" : ""
    ]);
  }

  function defaultSearchEntry(text = "", filters = []) {
    const normalizedFilters = compactFilterPills(filters);
    return {
      text: normalizeWhitespace(text),
      filters: normalizedFilters,
      criteria: criteriaNamesFromFilters(normalizedFilters),
      filterComposerOpen: false,
      filterComposerType: ""
    };
  }

  function jobScopeKey(job) {
    const normalized = normalizeJob(job);
    if (normalized.jobId) {
      return `id:${normalized.jobId}`;
    }
    if (normalized.sourceUrl) {
      return `url:${normalized.sourceUrl}`;
    }
    const fallback = [normalized.title, normalized.company, normalized.location]
      .map(normalizeWhitespace)
      .filter(Boolean)
      .join("|");
    return fallback ? `text:${fallback}` : "";
  }

  function initialSearchEntry() {
    return defaultSearchEntryForCurrentJob();
  }

  function blankEntries() {
    return [initialSearchEntry()];
  }

  function normalizeJobOutreachRunStatus(status) {
    const normalized = normalizeWhitespace(status).toLowerCase();
    if (["complete", "ranking_complete", "search_empty_complete"].includes(normalized)) {
      return "completed";
    }
    if (["queued", "running", "awaiting_user_action", "resuming", "completed", "failed", "cancelled"].includes(normalized)) {
      return normalized;
    }
    return normalized || "running";
  }

  function isJobOutreachRunActiveStatus(status) {
    return ["queued", "running", "awaiting_user_action", "resuming"].includes(normalizeJobOutreachRunStatus(status));
  }

  function dedupeRunIds(values) {
    const seen = new Set();
    return (Array.isArray(values) ? values : []).map((value) => normalizeWhitespace(value)).filter((value) => {
      if (!value || seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    });
  }

  function normalizeJobOutreachRunJob(job) {
    const source = job && typeof job === "object" ? job : {};
    return {
      title: normalizeWhitespace(source.title || ""),
      company: normalizeWhitespace(source.company || ""),
      location: normalizeWhitespace(source.location || ""),
      datePosted: normalizeWhitespace(source.datePosted || ""),
      applySignal: normalizeWhitespace(source.applySignal || ""),
      promotionSignal: normalizeWhitespace(source.promotionSignal || ""),
      sourceUrl: normalizeWhitespace(source.jobUrl || source.sourceUrl || ""),
      description: normalizeWhitespace(source.description || ""),
      jobId: normalizeWhitespace(source.jobId || "")
    };
  }

  function normalizeJobOutreachRunManualAction(action) {
    if (!action || typeof action !== "object") {
      return null;
    }
    const requestId = normalizeWhitespace(action.requestId);
    const summary = normalizeWhitespace(action.summary);
    if (!requestId || !summary) {
      return null;
    }
    return {
      requestId,
      searchKey: normalizeWhitespace(action.searchKey),
      workerTabId: typeof action.workerTabId === "number" ? action.workerTabId : null,
      summary,
      detail: normalizeWhitespace(action.detail),
      reason: normalizeWhitespace(action.reason),
      status: normalizeJobOutreachRunStatus(action.status || "awaiting_user_action"),
      progressPercent: Math.max(0, Math.min(100, Number(action.progressPercent || 0))),
      removableFilters: Array.isArray(action.removableFilters) ? action.removableFilters : []
    };
  }

  function normalizeJobOutreachRunSnapshot(run) {
    if (!run || typeof run !== "object") {
      return null;
    }
    const runId = normalizeWhitespace(run.runId || run.requestId);
    if (!runId) {
      return null;
    }
    return {
      runId,
      jobId: normalizeWhitespace(run.jobId),
      job: normalizeJobOutreachRunJob(run.job || {}),
      createdAt: normalizeWhitespace(run.createdAt),
      startedAt: normalizeWhitespace(run.startedAt),
      completedAt: normalizeWhitespace(run.completedAt),
      updatedAt: normalizeWhitespace(run.updatedAt),
      sourceTabId: typeof run.sourceTabId === "number" ? run.sourceTabId : null,
      workerTabId: typeof run.workerTabId === "number" ? run.workerTabId : null,
      status: normalizeJobOutreachRunStatus(run.status),
      cancelRequested: Boolean(run.cancelRequested),
      progressText: normalizeWhitespace(run.progressText || run.text),
      progressDetail: normalizeWhitespace(run.progressDetail || run.detail),
      progressPercent: Math.max(0, Math.min(100, Number(run.progressPercent || 0))),
      sharedCriteria: run.sharedCriteria && typeof run.sharedCriteria === "object"
        ? {
          locations: dedupeRunIds(run.sharedCriteria.locations || []),
          schools: dedupeRunIds(run.sharedCriteria.schools || []),
          currentCompany: normalizeWhitespace(run.sharedCriteria.currentCompany)
        }
        : { locations: [], schools: [], currentCompany: "" },
      searches: Array.isArray(run.searches) ? run.searches : [],
      searchPlan: run.searchPlan || null,
      rankingPlan: run.rankingPlan || null,
      rankingInput: run.rankingInput || null,
      importedPeopleBySearch: run.importedPeopleBySearch && typeof run.importedPeopleBySearch === "object" ? run.importedPeopleBySearch : {},
      importedPeopleBySearchKey: run.importedPeopleBySearchKey && typeof run.importedPeopleBySearchKey === "object" ? run.importedPeopleBySearchKey : {},
      diagnostics: run.diagnostics || null,
      manualAction: normalizeJobOutreachRunManualAction(run.manualAction),
      error: normalizeWhitespace(run.error)
    };
  }

  function mergeJobOutreachRunsState(currentState, incoming) {
    const runsById = { ...(currentState?.runsById || {}) };
    Object.values(incoming?.runsById || {}).forEach((run) => {
      const normalizedRun = normalizeJobOutreachRunSnapshot(run);
      if (normalizedRun) {
        runsById[normalizedRun.runId] = {
          ...(runsById[normalizedRun.runId] || {}),
          ...normalizedRun
        };
      }
    });
    const runOrder = dedupeRunIds(incoming?.runOrder || Object.keys(runsById)).filter((runId) => runsById[runId]);
    const pageRunIds = dedupeRunIds(incoming?.pageRunIds || []).filter((runId) => runsById[runId]);
    const activeRunIds = dedupeRunIds(incoming?.activeRunIds || []).filter((runId) => runsById[runId]);
    return {
      runsById,
      runOrder,
      pageRunIds,
      activeRunIds,
      selectedRunId: normalizeWhitespace(incoming?.selectedRunId),
      selectedRunSource: normalizeWhitespace(incoming?.selectedRunId) ? "page" : ""
    };
  }

  function mergeJobOutreachProgressIntoState(currentState, progress) {
    const runId = normalizeWhitespace(progress?.requestId);
    if (!runId) {
      return currentState;
    }
    const existing = normalizeJobOutreachRunSnapshot(currentState?.runsById?.[runId]) || { runId };
    const status = normalizeJobOutreachRunStatus(progress?.status || existing.status || "running");
    const nextRun = normalizeJobOutreachRunSnapshot({
      ...existing,
      runId,
      sourceTabId: typeof progress?.sourceTabId === "number" ? progress.sourceTabId : existing.sourceTabId,
      workerTabId: typeof progress?.workerTabId === "number" ? progress.workerTabId : existing.workerTabId,
      status,
      progressText: normalizeWhitespace(progress?.text || existing.progressText),
      progressDetail: normalizeWhitespace(progress?.detail || existing.progressDetail),
      progressPercent: Number.isFinite(Number(progress?.progressPercent)) ? Number(progress.progressPercent) : Number(existing.progressPercent || 0),
      manualAction: progress?.manualAction || existing.manualAction
    }) || existing;
    const runsById = {
      ...(currentState?.runsById || {}),
      [runId]: nextRun
    };
    const runOrder = dedupeRunIds([runId, ...(currentState?.runOrder || [])]);
    const activeRunIds = isJobOutreachRunActiveStatus(status)
      ? dedupeRunIds([runId, ...(currentState?.activeRunIds || [])])
      : dedupeRunIds((currentState?.activeRunIds || []).filter((activeRunId) => activeRunId !== runId));
    return {
      ...currentState,
      runsById,
      runOrder,
      activeRunIds,
      selectedRunId: normalizeWhitespace(currentState?.selectedRunId) || runId,
      selectedRunSource: normalizeWhitespace(currentState?.selectedRunId) ? normalizeWhitespace(currentState?.selectedRunSource) : "progress"
    };
  }

  function jobOutreachRunActions(run) {
    switch (normalizeJobOutreachRunStatus(run?.status)) {
      case "queued":
        return ["cancel", "select"];
      case "running":
      case "resuming":
        return ["cancel", "select"];
      case "awaiting_user_action":
        return ["open-worker-tab", "resume", "cancel"];
      case "completed":
      case "failed":
      case "cancelled":
        return ["select", "dismiss"];
      default:
        return ["select"];
    }
  }

  function currentPageSearchActionLabel(run) {
    return run ? "Search again" : "Search";
  }

  function isCurrentPageSearchBusy(run) {
    return Boolean(run) && isJobOutreachRunActiveStatus(run?.status);
  }

  function setSearchButtonsDisabled(disabled) {
    if (nodes.runSearch) {
      nodes.runSearch.disabled = disabled;
    }
    if (nodes.submitSearch) {
      nodes.submitSearch.disabled = disabled;
    }
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function normalizeFilterType(type) {
    const normalized = normalizeWhitespace(type).toLowerCase();
    if (normalized === "locations") {
      return "location";
    }
    if (normalized === "schools") {
      return "school";
    }
    return ["company", "location", "school"].includes(normalized) ? normalized : "";
  }

  function cleanCompanyFilterLabel(value) {
    return cleanLinkedInCompanyDisplayName(value);
  }

  function normalizeFilterDisplayText(type, value) {
    return normalizeFilterType(type) === "company" ? cleanCompanyFilterLabel(value) : normalizeWhitespace(value);
  }

  function filterParamForType(type) {
    return {
      company: "currentCompany",
      location: "geoUrn",
      school: "schoolFilter"
    }[normalizeFilterType(type)] || "";
  }

  function filterTypeLabel(type) {
    return {
      company: "Company",
      location: "Location",
      school: "School"
    }[normalizeFilterType(type)] || "Filter";
  }

  function filterTypeMenuLabel(type) {
    return {
      company: "Company",
      location: "Locations",
      school: "Schools"
    }[normalizeFilterType(type)] || "Filter";
  }

  function normalizeFilterLookupText(value) {
    return normalizeWhitespace(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function normalizeFilterCacheKey(type, value) {
    const normalizedType = normalizeFilterType(type);
    const normalizedValue = normalizeFilterLookupText(value);
    return normalizedType && normalizedValue ? `${normalizedType}:${normalizedValue}` : "";
  }

  function normalizeFilterCache(cache) {
    const result = {};
    Object.entries(cache || {}).forEach(([key, entry]) => {
      const type = normalizeFilterType(entry?.type || key.split(":")[0]);
      const label = normalizeFilterDisplayText(type, entry?.label || entry?.sourceText);
      const sourceText = normalizeFilterDisplayText(type, entry?.sourceText || label);
      const id = normalizeWhitespace(entry?.id);
      const param = normalizeWhitespace(entry?.param || filterParamForType(type));
      if (!type || !id || !param || !label) {
        return;
      }
      const normalizedEntry = {
        type,
        label,
        sourceText,
        id,
        param,
        state: "resolved"
      };
      [key, normalizeFilterCacheKey(type, label), normalizeFilterCacheKey(type, sourceText)]
        .filter(Boolean)
        .forEach((cacheKey) => {
          result[cacheKey] = normalizedEntry;
        });
    });
    return result;
  }

  function filterCacheEntry(type, value) {
    return state.filterCache[normalizeFilterCacheKey(type, value)] || null;
  }

  function cachedFilterEntries(type) {
    const normalizedType = normalizeFilterType(type);
    const seen = new Set();
    return Object.values(state.filterCache || {})
      .filter((entry) => normalizeFilterType(entry?.type) === normalizedType)
      .map((entry) => ({
        type: normalizedType,
        label: normalizeFilterDisplayText(normalizedType, entry.label || entry.sourceText),
        sourceText: normalizeFilterDisplayText(normalizedType, entry.sourceText || entry.label),
        id: normalizeWhitespace(entry.id),
        param: normalizeWhitespace(entry.param || filterParamForType(normalizedType)),
        state: "resolved"
      }))
      .filter((entry) => {
        const key = entry.id ? `${entry.type}:id:${entry.id}` : `${entry.type}:label:${entry.label.toLowerCase()}`;
        if (!entry.label || !entry.id || seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
  }

  function matchingFilterSuggestions(type, query, limit = FILTER_SUGGESTION_LIMIT) {
    const text = normalizeWhitespace(query).toLowerCase();
    if (!text) {
      return [];
    }
    return cachedFilterEntries(type)
      .map((entry) => {
        const label = entry.label.toLowerCase();
        const index = label.indexOf(text);
        return index >= 0 ? { entry, index, startsWith: index === 0 } : null;
      })
      .filter(Boolean)
      .sort((left, right) => {
        if (left.startsWith !== right.startsWith) {
          return left.startsWith ? -1 : 1;
        }
        if (left.index !== right.index) {
          return left.index - right.index;
        }
        if (left.entry.label.length !== right.entry.label.length) {
          return left.entry.label.length - right.entry.label.length;
        }
        return left.entry.label.localeCompare(right.entry.label);
      })
      .slice(0, limit)
      .map((match) => match.entry);
  }

  function highlightFilterMatch(label, query) {
    const text = String(label || "");
    const normalizedQuery = normalizeWhitespace(query);
    if (!normalizedQuery) {
      return escapeHtml(text);
    }
    const index = text.toLowerCase().indexOf(normalizedQuery.toLowerCase());
    if (index < 0) {
      return escapeHtml(text);
    }
    const end = index + normalizedQuery.length;
    return [
      escapeHtml(text.slice(0, index)),
      `<mark>${escapeHtml(text.slice(index, end))}</mark>`,
      escapeHtml(text.slice(end))
    ].join("");
  }

  function normalizeFilterPill(input) {
    const type = normalizeFilterType(input?.type);
    const sourceText = normalizeFilterDisplayText(type, input?.sourceText || input?.value || input?.label);
    if (!type || !sourceText) {
      return null;
    }
    const cached = filterCacheEntry(type, sourceText) || filterCacheEntry(type, input?.label);
    const explicitId = normalizeWhitespace(input?.id);
    const explicitParam = normalizeWhitespace(input?.param || filterParamForType(type));
    const origin = normalizeWhitespace(input?.origin || input?.source);
    const requestedState = normalizeWhitespace(input?.state);
    if (cached && origin !== "custom" && requestedState !== "failed") {
      return {
        type,
        label: cached.label,
        sourceText,
        id: cached.id,
        param: cached.param,
        state: "resolved",
        origin: "cache"
      };
    }
    return {
      type,
      label: normalizeFilterDisplayText(type, input?.label || sourceText),
      sourceText,
      id: explicitId,
      param: explicitParam,
      state: explicitId ? "resolved" : (requestedState || "unresolved"),
      origin
    };
  }

  function compactFilterPills(pills) {
    const normalized = (Array.isArray(pills) ? pills : [])
      .map(normalizeFilterPill)
      .filter(Boolean);
    const deduped = [];
    const seen = new Set();
    normalized.forEach((pill) => {
      const keys = [
        pill.id ? `${pill.type}:id:${pill.id}` : "",
        normalizeFilterCacheKey(pill.type, pill.sourceText),
        normalizeFilterCacheKey(pill.type, pill.label)
      ].filter(Boolean);
      if (!keys.length || keys.some((key) => seen.has(key))) {
        return;
      }
      keys.forEach((key) => seen.add(key));
      deduped.push(pill);
    });
    return deduped.filter((pill) => {
      if (pill.type !== "school") {
        return true;
      }
      const label = normalizeFilterLookupText(cleanSchoolCandidate(pill.label || pill.sourceText));
      if (!label) {
        return false;
      }
      return !deduped.some((other) => {
        if (other === pill || other.type !== "school") {
          return false;
        }
        const otherLabel = normalizeFilterLookupText(cleanSchoolCandidate(other.label || other.sourceText));
        return otherLabel && otherLabel !== label && otherLabel.includes(label);
      });
    });
  }

  function defaultLocationFilters() {
    return DEFAULT_LOCATION_FILTERS.map((filter) => ({ ...filter }));
  }

  function isDefaultLocationFilter(pill) {
    if (normalizeFilterType(pill?.type) !== "location") {
      return false;
    }
    const id = normalizeWhitespace(pill?.id);
    const textKey = normalizeFilterCacheKey("location", pill?.sourceText || pill?.label);
    return DEFAULT_LOCATION_FILTERS.some((filter) =>
      filter.id === id || normalizeFilterCacheKey("location", filter.sourceText) === textKey
    );
  }

  function locationFiltersForEntry(entryIndex) {
    return (Array.isArray(state.entries[entryIndex]?.filters) ? state.entries[entryIndex].filters : [])
      .filter((pill) => normalizeFilterType(pill?.type) === "location");
  }

  function shouldAdoptJobLocation(previousLocation, nextLocation) {
    const next = normalizeWhitespace(nextLocation);
    if (!next) {
      return false;
    }
    const locations = locationFiltersForEntry(0);
    if (!locations.length) {
      return true;
    }
    const nonDefaultLocations = locations.filter((pill) => !isDefaultLocationFilter(pill));
    if (!nonDefaultLocations.length) {
      return true;
    }
    const previous = normalizeWhitespace(previousLocation);
    return Boolean(previous && nonDefaultLocations.some((pill) =>
      normalizeWhitespace(pill.sourceText || pill.label) === previous
    ));
  }

  function normalizedSearchEntry(entry) {
    const filters = compactFilterPills(entry?.filters || []);
    return {
      text: normalizeWhitespace(entry?.text),
      filters,
      criteria: criteriaNamesFromFilters(filters),
      filterComposerOpen: Boolean(entry?.filterComposerOpen),
      filterComposerType: normalizeFilterType(entry?.filterComposerType)
    };
  }

  function syncEntryCriteria(index) {
    if (!state.entries[index]) {
      return;
    }
    state.entries[index] = normalizedSearchEntry(state.entries[index]);
    syncSharedCriteriaFromFirstEntry();
  }

  function syncAllEntryCriteria() {
    state.entries = state.entries.map(normalizedSearchEntry);
    syncSharedCriteriaFromFirstEntry();
  }

  function upsertEntryFilter(entryIndex, type, sourceText, options = {}) {
    const pill = normalizeFilterPill({
      type,
      sourceText,
      label: options.label || sourceText,
      id: options.id,
      param: options.param,
      state: options.state || "unresolved",
      origin: options.origin
    });
    if (!pill) {
      return false;
    }
    if (!state.entries[entryIndex]) {
      state.entries[entryIndex] = defaultSearchEntry();
    }
    const before = JSON.stringify(state.entries[entryIndex].filters || []);
    state.entries[entryIndex].filters = compactFilterPills([...(state.entries[entryIndex].filters || []), pill]);
    syncEntryCriteria(entryIndex);
    return JSON.stringify(state.entries[entryIndex].filters || []) !== before;
  }

  function filterMatchesTarget(filter, target) {
    const type = normalizeFilterType(filter?.type);
    const targetType = normalizeFilterType(target?.type);
    if (!type || !targetType || type !== targetType) {
      return false;
    }
    const filterId = normalizeWhitespace(filter?.id);
    const targetId = normalizeWhitespace(target?.id);
    if (filterId && targetId && filterId === targetId) {
      return true;
    }
    const filterKey = normalizeFilterCacheKey(type, filter?.sourceText || filter?.value || filter?.label);
    const labelKey = normalizeFilterCacheKey(type, filter?.label || filter?.sourceText || filter?.value);
    const targetKey = normalizeFilterCacheKey(targetType, target?.sourceText || target?.value || target?.label);
    const targetLabelKey = normalizeFilterCacheKey(targetType, target?.label || target?.sourceText || target?.value);
    return Boolean(targetKey && (filterKey === targetKey || labelKey === targetKey || filterKey === targetLabelKey));
  }

  function removeFilterFromEntry(entry, target) {
    return {
      ...entry,
      filters: compactFilterPills((Array.isArray(entry?.filters) ? entry.filters : [])
        .filter((filter) => !filterMatchesTarget(filter, target)))
    };
  }

  function removeManualFilterFromLocalState(manualAction, filter) {
    const sourceNumber = sourceNumberFromSearchKey(manualAction?.searchKey);
    const entryIndex = sourceNumber ? sourceNumber - 1 : -1;
    if (entryIndex < 0) {
      return;
    }
    state.pendingRunEntries = state.pendingRunEntries.map((entry) => (
      Number(entry?.index) === entryIndex ? removeFilterFromEntry(entry, filter) : entry
    ));
    state.entries = state.entries.map((entry, index) => (
      index === entryIndex ? removeFilterFromEntry(entry, filter) : entry
    ));
    syncAllEntryCriteria();
    renderEntries();
  }

  function syncSharedCriteriaFromFirstEntry() {
    const usable = (state.entries[0]?.filters || []).filter((pill) => pill.state !== "failed");
    state.globalCriteria = {
      locations: usable.filter((pill) => pill.type === "location").map((pill) => pill.sourceText || pill.label).join(", "),
      schools: usable.filter((pill) => pill.type === "school").map((pill) => pill.sourceText || pill.label).join(", "),
      company: normalizeWhitespace(usable.find((pill) => pill.type === "company")?.sourceText || usable.find((pill) => pill.type === "company")?.label || "")
    };
    if (nodes.globalLocations) {
      nodes.globalLocations.value = state.globalCriteria.locations;
    }
    if (nodes.globalSchools) {
      nodes.globalSchools.value = state.globalCriteria.schools;
    }
    if (nodes.globalCompany) {
      nodes.globalCompany.value = state.globalCriteria.company;
    }
  }

  function renderEntryFilterPills(entry, entryIndex) {
    const filters = compactFilterPills(entry?.filters || []);
    if (!filters.length) {
      return '<div class="job-demo-filter-empty">No filters</div>';
    }
    return filters.map((pill, filterIndex) => {
      const title = pill.state === "failed"
        ? `Could not match "${pill.sourceText || pill.label}" to a LinkedIn ${pill.type} filter.`
        : pill.state === "resolved" && pill.id
          ? `LinkedIn ${filterTypeLabel(pill.type)} ID: ${pill.id}`
          : `LinkedIn will match this ${pill.type} filter on search.`;
      const warning = pill.state === "failed"
        ? '<span class="job-demo-filter-warning" aria-hidden="true">!</span>'
        : "";
      return `
        ${filterIndex === 0 ? "" : '<span class="job-demo-filter-separator" aria-hidden="true">•</span>'}
        <span class="job-demo-filter-text is-${escapeHtml(pill.state)} ${filterIndex === 0 ? "is-first" : ""}" role="button" tabindex="0" data-job-demo-filter-remove="${filterIndex}" data-entry="${entryIndex}" title="${escapeHtml(title)}" aria-label="Remove ${escapeHtml(filterTypeLabel(pill.type))} ${escapeHtml(pill.label)}">
          <span class="job-demo-filter-text-label">${escapeHtml(pill.label)}</span>
          ${warning}
        </span>
      `;
    }).join("");
  }

  function renderFilterSuggestions(entryIndex, type, query) {
    const selectedType = normalizeFilterType(type);
    const text = normalizeWhitespace(query);
    if (!selectedType || !text) {
      return "";
    }
    const suggestions = matchingFilterSuggestions(selectedType, text);
    const rows = suggestions.map((entry, index) => `
      <button class="job-demo-filter-suggestion ${index === 0 ? "is-active" : ""}" type="button" role="option" aria-selected="${index === 0 ? "true" : "false"}" data-job-demo-filter-suggestion="cache" data-entry="${entryIndex}" data-type="${escapeHtml(entry.type)}" data-label="${escapeHtml(entry.label)}" data-source-text="${escapeHtml(entry.sourceText || entry.label)}" data-filter-id="${escapeHtml(entry.id)}" data-param="${escapeHtml(entry.param)}">
        <span class="job-demo-filter-suggestion-label">${highlightFilterMatch(entry.label, text)}</span>
        <span class="job-demo-filter-suggestion-meta">Saved</span>
      </button>
    `);
    rows.push(`
      <button class="job-demo-filter-suggestion is-custom ${rows.length ? "" : "is-active"}" type="button" role="option" aria-selected="${rows.length ? "false" : "true"}" data-job-demo-filter-suggestion="custom" data-entry="${entryIndex}" data-type="${escapeHtml(selectedType)}" data-source-text="${escapeHtml(text)}">
        <span class="job-demo-filter-suggestion-label">Search LinkedIn for "${escapeHtml(text)}"</span>
        <span class="job-demo-filter-suggestion-meta">Use once</span>
      </button>
    `);
    return rows.join("");
  }

  function renderFilterComposer(entry, entryIndex) {
    if (!entry?.filterComposerOpen) {
      return "";
    }
    const selectedType = normalizeFilterType(entry.filterComposerType);
    if (!selectedType) {
      return `
        <div class="job-demo-filter-popover" data-job-demo-filter-popover="${entryIndex}">
          ${["company", "school", "location"].map((type) => `
            <button class="job-demo-filter-type-choice" type="button" data-entry="${entryIndex}" data-job-demo-filter-type-choice="${type}">
              <span>${escapeHtml(filterTypeMenuLabel(type))}</span>
              <svg class="job-demo-filter-choice-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path>
              </svg>
            </button>
          `).join("")}
        </div>
      `;
    }
    return `
      <div class="job-demo-filter-popover" data-job-demo-filter-popover="${entryIndex}">
        <div class="job-demo-filter-add-row">
          <button class="job-demo-filter-back-button" type="button" data-entry="${entryIndex}" data-job-demo-filter-back aria-label="Choose a different filter type">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m15 6-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
          </button>
          <input data-job-demo-filter-input="${entryIndex}" data-job-demo-filter-input-type="${selectedType}" value="" placeholder="Search ${escapeHtml(filterTypeLabel(selectedType).toLowerCase())}" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false" aria-controls="job-demo-filter-suggestions-${entryIndex}">
        </div>
        <div id="job-demo-filter-suggestions-${entryIndex}" class="job-demo-filter-suggestions hidden" role="listbox" data-job-demo-filter-suggestions="${entryIndex}"></div>
      </div>
    `;
  }

  function rehydrateFilterPillsFromCache() {
    syncAllEntryCriteria();
    if (nodes.searchEntries) {
      renderEntries();
    }
  }

  function filterSuggestionsContainerForInput(input) {
    const index = Number(input?.dataset?.jobDemoFilterInput);
    if (!Number.isFinite(index)) {
      return null;
    }
    return nodes.searchEntries?.querySelector(`[data-job-demo-filter-suggestions="${index}"]`) || null;
  }

  function updateFilterSuggestionsForInput(input) {
    if (!input) {
      return;
    }
    const index = Number(input.dataset.jobDemoFilterInput);
    const type = normalizeFilterType(input.dataset.jobDemoFilterInputType || state.entries[index]?.filterComposerType);
    const container = filterSuggestionsContainerForInput(input);
    if (!container) {
      return;
    }
    const html = renderFilterSuggestions(index, type, input.value);
    container.innerHTML = html;
    container.classList.toggle("hidden", !html);
    input.setAttribute("aria-expanded", html ? "true" : "false");
  }

  function hideFilterSuggestionsForInput(input) {
    const container = filterSuggestionsContainerForInput(input);
    if (container) {
      container.innerHTML = "";
      container.classList.add("hidden");
    }
    input?.setAttribute("aria-expanded", "false");
  }

  function suggestionButtonsForInput(input) {
    return Array.from(filterSuggestionsContainerForInput(input)?.querySelectorAll("[data-job-demo-filter-suggestion]") || []);
  }

  function moveActiveFilterSuggestion(input, direction) {
    const buttons = suggestionButtonsForInput(input);
    if (!buttons.length) {
      updateFilterSuggestionsForInput(input);
      return;
    }
    const currentIndex = Math.max(0, buttons.findIndex((button) => button.classList.contains("is-active")));
    const nextIndex = (currentIndex + direction + buttons.length) % buttons.length;
    buttons.forEach((button, index) => {
      const active = index === nextIndex;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  function activeFilterSuggestionForInput(input) {
    return suggestionButtonsForInput(input).find((button) => button.classList.contains("is-active")) || null;
  }

  function closeOpenFilterComposers() {
    if (!state.entries.some((entry) => entry.filterComposerOpen)) {
      return false;
    }
    readEntriesFromDom();
    state.entries = state.entries.map((entry) => ({
      ...entry,
      filterComposerOpen: false,
      filterComposerType: ""
    }));
    syncAllEntryCriteria();
    renderEntries();
    return true;
  }

  function parseCriteriaList(value, kind) {
    const normalized = normalizeWhitespace(value);
    if (!normalized) {
      return [];
    }
    if (kind === "locations" && /^[^,]+,\s*[A-Z]{2}(?:\b|$)/.test(normalized)) {
      return [normalized.replace(/\s*\+\d+\s+more\b/i, "").trim()];
    }
    const separator = /[;\n]+/.test(String(value || "")) ? /[;\n]+/ : /,/;
    return uniqueValues(String(value || "")
      .split(separator)
      .map((item) => kind === "schools" ? cleanSchoolCandidate(item) : normalizeWhitespace(item))
      .filter(Boolean));
  }

  function cleanSchoolCandidate(value) {
    const cleaned = normalizeWhitespace(value)
      .replace(/^(?:education|education highlights?|school|schools)\s*[:\-]?\s*/i, "")
      .replace(/\b(?:bachelor'?s?|master'?s?|mba|ms|ma|bs|ba|degree|candidate|graduate|alumni)\b.*$/i, "")
      .replace(/\s*[|\u2022\u00b7]\s*.*$/, "")
      .trim();
    if (!cleaned || /^of\s+/i.test(cleaned) || /^(?:school|college|institute|university)$/i.test(cleaned)) {
      return "";
    }
    if (/^(?:school|college|institute)\s+of\s+/i.test(cleaned) && !/\b(?:yale|national|singapore|stanford|harvard|mit|university)\b/i.test(cleaned)) {
      return "";
    }
    return cleaned;
  }

  function compactSchoolCandidates(values) {
    const normalized = uniqueValues((values || []).map(cleanSchoolCandidate).filter(Boolean));
    return normalized.filter((candidate) => {
      const lower = candidate.toLowerCase();
      return !normalized.some((other) => other !== candidate && other.toLowerCase().includes(lower));
    });
  }

  function schoolCandidatesFromText(value) {
    const text = normalizeWhitespace(value);
    if (!text) {
      return [];
    }
    const matches = [];
    const patterns = [
      /\b[A-Z][A-Za-z&.'-]*(?:\s+[A-Z][A-Za-z&.'-]*){0,7}\s+(?:University|College|School|Institute)(?:\s+of\s+[A-Z][A-Za-z&.'-]*(?:\s+[A-Z][A-Za-z&.'-]*){0,5})?/g,
      /\b(?:University|College|School|Institute)\s+of\s+[A-Z][A-Za-z&.'-]*(?:\s+[A-Z][A-Za-z&.'-]*){0,7}\b/g,
      /\b(?:Yale SOM|NUS|IIT Bombay)\b/g
    ];
    patterns.forEach((pattern) => {
      const found = text.match(pattern) || [];
      matches.push(...found);
    });
    if (!matches.length && /\b(?:university|college|school|institute|mba|som|nus|yale|stanford|duke)\b/i.test(text) && text.length <= 110) {
      matches.push(text);
    }
    return compactSchoolCandidates(matches).filter((candidate) => candidate.length >= 3);
  }

  function schoolPrefillFromProfile(profile) {
    const source = profile || {};
    const profileData = source.profileData || {};
    const structured = [
      ...(Array.isArray(profileData.visibleSignals?.schools) ? profileData.visibleSignals.schools : []),
      ...(Array.isArray(source.visibleSignals?.schools) ? source.visibleSignals.schools : []),
      ...(Array.isArray(profileData.educationHighlights) ? profileData.educationHighlights : []),
      ...(Array.isArray(source.educationHighlights) ? source.educationHighlights : [])
    ];
    const structuredSchools = compactSchoolCandidates(structured.flatMap(schoolCandidatesFromText));
    if (structuredSchools.length) {
      return structuredSchools.slice(0, 3).join(", ");
    }
    const rawLines = String(source.rawSnapshot || "")
      .split(/\n+/)
      .map(normalizeWhitespace)
      .filter(Boolean);
    return compactSchoolCandidates(rawLines.flatMap(schoolCandidatesFromText)).slice(0, 3).join(", ");
  }

  function linkedInProfileSlugFromUrl(value) {
    const raw = normalizeWhitespace(value);
    if (!raw) {
      return "";
    }
    try {
      const parsed = new URL(raw);
      const match = parsed.pathname.match(/^\/in\/([^/?#]+)\/?/i);
      return normalizeWhitespace(match?.[1] || "").toLowerCase();
    } catch (_error) {
      const match = raw.match(/linkedin\.com\/in\/([^/?#]+)/i);
      return normalizeWhitespace(match?.[1] || "").toLowerCase();
    }
  }

  function senderProfileSlug() {
    return linkedInProfileSlugFromUrl(
      state.myProfile?.ownProfileUrl
      || state.myProfile?.profileData?.profileUrl
      || ""
    );
  }

  function defaultKeywordForCurrentJob(searchIndex = 0) {
    const title = normalizeWhitespace(currentJob().title);
    if (!title) {
      return "";
    }
    if (Number(searchIndex) === 0 && senderProfileSlug() === "kenn-nguyen" && !/\bvietnamese\b/i.test(title)) {
      return `"Vietnamese" ${title}`;
    }
    return title;
  }

  function defaultFiltersForCurrentContext() {
    return compactFilterPills([
      currentJob().company ? { type: "company", sourceText: currentJob().company } : null,
      ...defaultLocationFilters(),
      currentJob().location ? { type: "location", sourceText: currentJob().location } : null,
      ...parseCriteriaList(schoolPrefillFromProfile(state.myProfile), "schools")
        .map((school) => ({ type: "school", sourceText: school }))
    ].filter(Boolean));
  }

  function defaultSearchEntryForCurrentJob(searchIndex = 0) {
    return defaultSearchEntry(defaultKeywordForCurrentJob(searchIndex), defaultFiltersForCurrentContext());
  }

  function seedFirstEntryText(nextText, previousText) {
    const text = normalizeWhitespace(nextText);
    if (!text) {
      return false;
    }
    if (!state.entries.length) {
      state.entries = [defaultSearchEntry(text, defaultFiltersForCurrentContext())];
      return true;
    }
    const first = state.entries[0];
    const currentText = normalizeWhitespace(first.text);
    const priorText = normalizeWhitespace(previousText);
    if (currentText && currentText !== priorText) {
      return false;
    }
    first.text = text;
    return true;
  }

  function searchLabel(index) {
    return searchLabels[index] || String(index + 1);
  }

  function normalizeSearchKey(value) {
    const text = normalizeWhitespace(value).toUpperCase();
    if (!text) {
      return "";
    }
    const letterMatch = text.match(/\b([ABC])\b/) || text.match(/SEARCH\s*([ABC])/);
    if (letterMatch && searchLabels.includes(letterMatch[1])) {
      return letterMatch[1];
    }
    const number = Number(text);
    if (Number.isFinite(number) && number >= 1) {
      return searchLabel(number - 1);
    }
    return "";
  }

  function sourceNumberFromSearchKey(value) {
    const key = normalizeSearchKey(value);
    const index = searchLabels.indexOf(key);
    return index >= 0 ? index + 1 : 0;
  }

  function jobAi() {
    return globalThis.LumiJobOutreachAI || null;
  }

  function createRunId() {
    return `job_outreach_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function normalizeJob(job) {
    const source = job || {};
    return {
      title: normalizeWhitespace(source.title || ""),
      company: normalizeWhitespace(source.company || ""),
      location: normalizeWhitespace(source.location || ""),
      datePosted: normalizeWhitespace(source.datePosted || ""),
      applySignal: normalizeWhitespace(source.applySignal || ""),
      promotionSignal: normalizeWhitespace(source.promotionSignal || ""),
      sourceUrl: normalizeWhitespace(source.jobUrl || source.sourceUrl || ""),
      description: normalizeWhitespace(source.description || ""),
      jobId: normalizeWhitespace(source.jobId || "")
    };
  }

  function currentJob() {
    return normalizeJob(state.runtimeJob);
  }

  function jobIdentityKey(job) {
    const normalized = normalizeJob(job);
    if (normalized.jobId) {
      return `job:${normalized.jobId}`;
    }
    if (normalized.sourceUrl) {
      return `url:${normalized.sourceUrl.toLowerCase()}`;
    }
    const title = normalized.title.toLowerCase();
    const company = normalized.company.toLowerCase();
    return title || company ? `text:${company}|${title}` : "";
  }

  function hasRecognizedJob(job = currentJob()) {
    return Boolean(job.title || job.company || job.jobId || job.sourceUrl);
  }

  function hasCurrentJob() {
    const job = currentJob();
    return Boolean(job.title && job.company);
  }

  function jobDetailsPendingText(job) {
    if (!hasRecognizedJob(job) || hasCurrentJob()) {
      return "";
    }
    return "Job details are still loading in LinkedIn.";
  }

  function compactJobPostedText(datePosted, location) {
    const normalizedLocation = normalizeWhitespace(location);
    let posted = normalizeWhitespace(datePosted).replace(/^Posted\s+/i, "");
    if (posted && normalizedLocation && posted.toLowerCase().startsWith(normalizedLocation.toLowerCase())) {
      posted = normalizeWhitespace(posted.slice(normalizedLocation.length).replace(/^[\s,·-]+/, ""));
    }
    if (posted.toLowerCase() === normalizedLocation.toLowerCase()) {
      return "";
    }
    return posted;
  }

  function jobPrimaryMetaLine(job) {
    return [
      job.location,
      compactJobPostedText(job.datePosted, job.location),
      job.applySignal
    ].map(normalizeWhitespace).filter(Boolean).join(" · ");
  }

  function jobSubtitleLine(job) {
    return [
      job.company || jobDetailsPendingText(job),
      jobPrimaryMetaLine(job),
      job.promotionSignal
    ].map(normalizeWhitespace).filter(Boolean).join(" · ");
  }

  function renderJob() {
    const job = currentJob();
    nodes.jobLink.textContent = job.title || (hasRecognizedJob(job) ? `LinkedIn job ${job.jobId || ""}`.trim() : "No LinkedIn job detected");
    nodes.jobLink.classList.toggle("is-disabled", !job.sourceUrl);
    if (job.sourceUrl) {
      nodes.jobLink.href = job.sourceUrl;
      nodes.jobLink.target = "_blank";
      nodes.jobLink.rel = "noreferrer";
    } else {
      nodes.jobLink.removeAttribute("href");
      nodes.jobLink.removeAttribute("target");
      nodes.jobLink.removeAttribute("rel");
    }
    if (nodes.jobSubtitle) {
      const subtitle = jobSubtitleLine(job);
      nodes.jobSubtitle.textContent = subtitle;
      nodes.jobSubtitle.classList.toggle("hidden", !subtitle);
    }
  }

  function renderEntries() {
    nodes.searchEntries.innerHTML = state.entries.map((entry, index) => {
      const normalizedEntry = normalizedSearchEntry(entry);
      const entryLabel = `Search ${searchLabel(index)}`;
      const removeButton = index > 0
        ? `<button class="job-demo-entry-remove" type="button" data-job-demo-entry-remove="${index}" aria-label="Remove ${escapeHtml(entryLabel)}" title="Remove ${escapeHtml(entryLabel)}">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"></path>
            </svg>
          </button>`
        : "";
      const composerOpen = Boolean(normalizedEntry.filterComposerOpen);
      return `
        <article class="job-demo-search-entry ${index === 0 ? "is-primary" : ""}">
          <div class="job-demo-keyword-row-label">
            <div class="job-demo-entry-title"><span>${escapeHtml(entryLabel)}</span></div>
            ${removeButton}
          </div>
          <div class="job-demo-keyword-control">
            <input class="job-demo-search-keyword-input" data-entry="${index}" data-field="text" value="${escapeHtml(normalizedEntry.text)}" placeholder="Keywords: role, team, signal">
          </div>
          <div class="job-demo-combo-filters">
            <div class="job-demo-filter-pills" aria-live="polite">
              ${renderEntryFilterPills(normalizedEntry, index)}
            </div>
            <button class="job-demo-toggle-filter ${composerOpen ? "is-active" : ""}" type="button" data-job-demo-filter-toggle="${index}" aria-expanded="${composerOpen ? "true" : "false"}">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"></path>
              </svg>
              <span>Filter</span>
            </button>
            ${renderFilterComposer(normalizedEntry, index)}
          </div>
        </article>
      `;
    }).join("");
    nodes.addSearch.classList.toggle("hidden", state.entries.length >= 3);
    nodes.addSearch.disabled = state.entries.length >= 3;
  }

  function readEntriesFromDom() {
    const next = cloneEntries(state.entries);
    nodes.searchEntries.querySelectorAll("[data-entry][data-field]").forEach((input) => {
      const index = Number(input.dataset.entry);
      const field = input.dataset.field;
      if (next[index]) {
        next[index][field] = input.value;
      }
    });
    state.entries = next;
    state.profileSchoolPrefillLocked = true;
    syncAllEntryCriteria();
  }

  function firstEntryHasSchoolFilters() {
    return (Array.isArray(state.entries[0]?.filters) ? state.entries[0].filters : [])
      .some((pill) => normalizeFilterType(pill?.type) === "school");
  }

  function resetProfileSchoolPrefillLock() {
    state.profileSchoolPrefillLocked = firstEntryHasSchoolFilters();
  }

  function lockProfileSchoolPrefill() {
    state.profileSchoolPrefillLocked = true;
  }

  function buildSearchUrl(entry, index) {
    const terms = normalizeWhitespace(entry.text);
    return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(terms)}&origin=LUMI_JOB_OUTREACH_${searchLabel(index)}`;
  }

  function filtersForEntry(entry) {
    return compactFilterPills(entry?.filters || [])
      .filter((pill) => pill.state !== "failed")
      .map((pill) => ({
        type: pill.type,
        label: pill.label,
        sourceText: pill.sourceText || pill.label,
        id: pill.state === "resolved" ? pill.id : "",
        param: pill.param || filterParamForType(pill.type),
        state: pill.state,
        origin: pill.origin || ""
      }));
  }

  function criteriaPayloadFromFilters(filters) {
    const usable = compactFilterPills(filters).filter((pill) => pill.state !== "failed");
    return {
      locations: usable.filter((pill) => pill.type === "location").map((pill) => pill.sourceText || pill.label),
      schools: usable.filter((pill) => pill.type === "school").map((pill) => pill.sourceText || pill.label),
      currentCompany: normalizeWhitespace(usable.find((pill) => pill.type === "company")?.sourceText || usable.find((pill) => pill.type === "company")?.label || "")
    };
  }

  function buildSearchPlanAiInput(entries) {
    return {
      searches: entries.map((entry) => {
        const filters = filtersForEntry(entry);
        const criteria = criteriaPayloadFromFilters(filters);
        return {
          searchKey: searchLabel(entry.index),
          searchNumber: entry.index + 1,
          keywords: normalizeWhitespace(entry.text),
          enabledCriteria: criteriaNamesFromFilters(filters),
          criteria: {
            locations: criteria.locations,
            schools: criteria.schools,
            currentCompany: normalizeWhitespace(criteria.currentCompany)
          },
          filters
        };
      })
    };
  }

  function buildRankingAiInput(entries) {
    return {
      job: currentJob(),
      myProfile: state.myProfile || null,
      searches: entries.map((entry) => ({
        searchKey: searchLabel(entry.index),
        searchNumber: entry.index + 1,
        keywords: normalizeWhitespace(entry.text),
        searchUrl: normalizeWhitespace(entry.url || ""),
        people: (state.importedPeopleBySearch[String(entry.index + 1)] || []).map((person) => ({
          name: person.name,
          profileUrl: person.profileUrl,
          connectionDegree: person.connectionDegree,
          headline: person.headline,
          location: person.location,
          currentText: person.currentText,
          pastText: person.pastText,
          mutualConnectionsText: person.mutualConnectionsText,
          followersText: person.followersText,
          linkedInAiInsight: person.aiGeneratedInsight,
          primaryAction: person.primaryAction || person.action
        }))
      }))
    };
  }

  function activeEntries() {
    return state.entries
      .map((entry, index) => ({ ...entry, index }))
      .filter((entry) => entry.text.trim());
  }

  function buildEntriesWithSearchUrls(rawEntries) {
    const input = buildSearchPlanAiInput(rawEntries);
    const ai = jobAi();
    const fallback = ai?.buildFallbackSearchUrlResponse
      ? ai.buildFallbackSearchUrlResponse(input)
      : {
        searches: rawEntries.map((entry) => ({
          search_key: searchLabel(entry.index),
          url: buildSearchUrl(entry, entry.index)
        }))
      };
    const validation = ai?.validateSearchUrlResponse
      ? ai.validateSearchUrlResponse(fallback, input)
      : { ok: true, value: { searches: fallback.searches || [] } };
    const urlByKey = new Map((validation.value?.searches || []).map((search) => [search.searchKey, search.url]));
    state.lastSearchPlanAiInput = input;
    state.lastSearchPlan = validation.value || fallback;
    return rawEntries.map((entry) => ({
      ...entry,
      url: urlByKey.get(searchLabel(entry.index)) || buildSearchUrl(entry, entry.index)
    }));
  }

  function mergeRankingPlanIntoRankings(entries, rankings, explicitPlan) {
    const plan = explicitPlan || null;
    const input = buildRankingAiInput(entries);
    state.lastRankingAiInput = input;
    state.lastRankingPlan = plan;
    const sourceLockedRankings = {
      ...rankings,
      overall: []
    };
    if (!plan?.people?.length) {
      return sourceLockedRankings;
    }
    const planBySourceUrl = new Map(plan.people
      .map((person) => [planPersonKey(person.profileUrl, person.sourceSearchKey), person])
      .filter(([key]) => key));
    return Object.fromEntries(Object.entries(sourceLockedRankings).map(([key, people]) => [
      key,
      key === "overall"
        ? buildAiBestRankings(sourceLockedRankings, plan)
        : people.map((person) => {
          const strategy = planBySourceUrl.get(planPersonKey(person.profileUrl, searchLabel(Number(key) - 1)));
          if (!strategy) {
            return person;
          }
          return {
            ...person,
            confidence: strategy.confidence,
            bestUse: strategy.bestUse || person.bestUse,
            reason: strategy.reason || person.reason,
            approachStrategy: strategy.approachStrategy
          };
        }).sort((left, right) => left.rank - right.rank)
    ]));
  }

  async function sendJobOutreachCommand(message) {
    const messageTypes = globalThis.LinkedInAssistantShared?.MESSAGE_TYPES || {};
    if (!globalThis.chrome?.runtime?.sendMessage) {
      return null;
    }
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) {
      const error = new Error(response?.error || "Job outreach search failed.");
      error.manualAction = normalizeJobOutreachManualAction(response?.manualAction);
      error.response = response;
      throw error;
    }
    return response;
  }

  async function runBackgroundJobOutreach(rawEntries, requestId) {
    const messageTypes = globalThis.LinkedInAssistantShared?.MESSAGE_TYPES || {};
    if (!messageTypes.RUN_JOB_OUTREACH) {
      return null;
    }
    const input = buildSearchPlanAiInput(rawEntries);
    const response = await sendJobOutreachCommand({
      type: messageTypes.RUN_JOB_OUTREACH,
      requestId,
      sourceTabId: state.activeTabId || null,
      job: currentJob(),
      searches: input.searches
    });
    if (!Array.isArray(response.searches) || !response.searches.length) {
      return null;
    }
    return response;
  }

  async function resumeBackgroundJobOutreach(requestId, options = {}) {
    const messageTypes = globalThis.LinkedInAssistantShared?.MESSAGE_TYPES || {};
    if (!messageTypes.RESUME_JOB_OUTREACH) {
      throw new Error("Resume is not available in this build.");
    }
    return sendJobOutreachCommand({
      type: messageTypes.RESUME_JOB_OUTREACH,
      requestId,
      sourceTabId: state.activeTabId || null,
      removeFilter: options.removeFilter || null
    });
  }

  async function openBackgroundJobOutreachWorkerTab(requestId, workerTabId) {
    const messageTypes = globalThis.LinkedInAssistantShared?.MESSAGE_TYPES || {};
    if (!messageTypes.OPEN_JOB_OUTREACH_WORKER_TAB) {
      throw new Error("Opening the LinkedIn search tab is not available in this build.");
    }
    return sendJobOutreachCommand({
      type: messageTypes.OPEN_JOB_OUTREACH_WORKER_TAB,
      requestId,
      workerTabId
    });
  }

  async function cancelBackgroundJobOutreach(requestId) {
    const messageTypes = globalThis.LinkedInAssistantShared?.MESSAGE_TYPES || {};
    if (!messageTypes.CANCEL_JOB_OUTREACH) {
      throw new Error("Cancel is not available in this build.");
    }
    return sendJobOutreachCommand({
      type: messageTypes.CANCEL_JOB_OUTREACH,
      requestId
    });
  }

  async function dismissBackgroundJobOutreachRun(requestId) {
    const messageTypes = globalThis.LinkedInAssistantShared?.MESSAGE_TYPES || {};
    if (!messageTypes.DISMISS_JOB_OUTREACH_RUN) {
      throw new Error("Dismiss is not available in this build.");
    }
    return sendJobOutreachCommand({
      type: messageTypes.DISMISS_JOB_OUTREACH_RUN,
      requestId
    });
  }

  function applyBackgroundWorkflowResult(response, rawEntries) {
    if (response.jobOutreachFilterCache) {
      state.filterCache = normalizeFilterCache(response.jobOutreachFilterCache);
    }
    const searchByKey = new Map((response.searches || []).map((search) => [normalizeWhitespace(search.searchKey), search]));
    const entries = rawEntries.map((entry) => {
      const key = searchLabel(entry.index);
      const search = searchByKey.get(key);
      const failedKeys = new Set((Array.isArray(search?.failedFilters) ? search.failedFilters : [])
        .map((filter) => normalizeFilterCacheKey(filter.type, filter.sourceText || filter.label || filter.value))
        .filter(Boolean));
      const responseFilters = filtersFromSearchResult(search, entry.filters);
      return {
        ...entry,
        filters: compactFilterPills(responseFilters.map((filter) => (
          failedKeys.has(normalizeFilterCacheKey(filter.type, filter.sourceText || filter.label))
            ? { ...filter, state: "failed", id: "", param: filterParamForType(filter.type) }
            : filter
        ))),
        url: normalizeWhitespace(search?.url) || buildSearchUrl(entry, entry.index)
      };
    });
    state.entries = entries.map(normalizedSearchEntry);
    syncAllEntryCriteria();
    lockProfileSchoolPrefill();
    state.lastSearchPlan = response.searchPlan || null;
    state.lastRankingPlan = response.rankingPlan || null;
    state.loadedSavedRunId = normalizeWhitespace(response.jobOutreachLatestRun?.latestRun?.runId || state.loadedSavedRunId);
    state.lastSearchPlanAiInput = buildSearchPlanAiInput(rawEntries);
    state.lastRankingAiInput = response.rankingInput || null;
    state.importedPeopleBySearch = {};
    entries.forEach((entry) => {
      const numericKey = String(entry.index + 1);
      const labelKey = searchLabel(entry.index);
      state.importedPeopleBySearch[numericKey] = response.importedPeopleBySearch?.[numericKey]
        || response.importedPeopleBySearchKey?.[labelKey]
        || [];
    });
    state.rankings = mergeRankingPlanIntoRankings(entries, buildRankings(entries), state.lastRankingPlan);
    return entries;
  }

  function filtersFromSearchResult(search, fallbackFilters = []) {
    if (!search) {
      return compactFilterPills(fallbackFilters);
    }
    const filters = Array.isArray(search.filters) ? search.filters : [];
    const resolved = Array.isArray(search.resolvedFilters) ? search.resolvedFilters : [];
    const failed = Array.isArray(search.failedFilters) ? search.failedFilters : [];
    if (!filters.length && !resolved.length && !failed.length) {
      return compactFilterPills(fallbackFilters);
    }
    return compactFilterPills([...failed, ...resolved, ...filters]);
  }

  function applyRuntimeJobOutreachRuns(runContext) {
    if (!runContext || typeof runContext !== "object") {
      return false;
    }
    const previousSelectedRunId = normalizeWhitespace(state.selectedRunId);
    const previousSelectedRunSource = normalizeWhitespace(state.selectedRunSource);
    const merged = mergeJobOutreachRunsState(state, runContext);
    if (previousSelectedRunSource === "user" && merged.runsById[previousSelectedRunId]) {
      merged.selectedRunId = previousSelectedRunId;
      merged.selectedRunSource = "user";
    }
    state.runsById = merged.runsById;
    state.runOrder = merged.runOrder;
    state.pageRunIds = merged.pageRunIds;
    state.activeRunIds = merged.activeRunIds;
    state.selectedRunId = merged.selectedRunId;
    state.selectedRunSource = merged.selectedRunSource;
    if (state.selectedRunId) {
      state.loadedSavedRunId = state.selectedRunId;
    }
    return true;
  }

  function applyJobOutreachCommandResponse(response) {
    if (response?.jobOutreachFilterCache) {
      state.filterCache = normalizeFilterCache(response.jobOutreachFilterCache);
    }
    if (response?.jobOutreachRuns) {
      applyRuntimeJobOutreachRuns(response.jobOutreachRuns);
    }
    renderRunRegistry();
    renderSelectedRunPanels();
  }

  function upsertJobOutreachRunSnapshot(run, selectionSource = "") {
    const normalizedRun = normalizeJobOutreachRunSnapshot(run);
    if (!normalizedRun) {
      return null;
    }
    state.runsById = {
      ...state.runsById,
      [normalizedRun.runId]: {
        ...(state.runsById[normalizedRun.runId] || {}),
        ...normalizedRun
      }
    };
    state.runOrder = dedupeRunIds([normalizedRun.runId, ...state.runOrder]);
    state.activeRunIds = isJobOutreachRunActiveStatus(normalizedRun.status)
      ? dedupeRunIds([normalizedRun.runId, ...state.activeRunIds])
      : dedupeRunIds(state.activeRunIds.filter((runId) => runId !== normalizedRun.runId));
    if (runMatchesCurrentPage(normalizedRun.runId) || selectionSource) {
      selectJobOutreachRun(normalizedRun.runId, selectionSource || (runMatchesCurrentPage(normalizedRun.runId) ? "page" : "user"));
    }
    return normalizedRun;
  }

  function recordJobOutreachRunFromResponse(response, overrides = {}) {
    const runId = normalizeWhitespace(overrides.runId || response?.requestId || state.activeRunId);
    if (!runId) {
      return null;
    }
    return upsertJobOutreachRunSnapshot({
      runId,
      job: overrides.job || response?.job || currentJob(),
      status: overrides.status || response?.status || "completed",
      progressText: overrides.progressText || response?.progressText || "",
      progressDetail: overrides.progressDetail || response?.progressDetail || "",
      progressPercent: Number.isFinite(Number(overrides.progressPercent))
        ? Number(overrides.progressPercent)
        : Number(response?.progressPercent || 0),
      workerTabId: typeof overrides.workerTabId === "number"
        ? overrides.workerTabId
        : (typeof response?.workerTabId === "number" ? response.workerTabId : null),
      manualAction: overrides.manualAction || response?.manualAction || null,
      searches: Array.isArray(response?.searches) ? response.searches : [],
      searchPlan: response?.searchPlan || null,
      rankingPlan: response?.rankingPlan || null,
      rankingInput: response?.rankingInput || null,
      importedPeopleBySearch: response?.importedPeopleBySearch || {},
      importedPeopleBySearchKey: response?.importedPeopleBySearchKey || {},
      error: overrides.error || response?.error || ""
    }, overrides.selectionSource);
  }

  function applySavedLatestRun(saved) {
    const run = saved?.latestRun;
    const runId = normalizeWhitespace(run?.runId);
    if (!runId || state.activeRunId || state.loadedSavedRunId === runId) {
      return false;
    }
    const searches = Array.isArray(run.searches) ? run.searches : [];
    if (!searches.length) {
      return false;
    }
    state.loadedSavedRunId = runId;
    const fallbackSharedFilters = [
      ...(Array.isArray(run.sharedCriteria?.locations) ? run.sharedCriteria.locations.map((value) => ({ type: "location", sourceText: value })) : []),
      ...(Array.isArray(run.sharedCriteria?.schools) ? run.sharedCriteria.schools.map((value) => ({ type: "school", sourceText: value })) : []),
      normalizeWhitespace(run.sharedCriteria?.currentCompany) ? { type: "company", sourceText: run.sharedCriteria.currentCompany } : null
    ].filter(Boolean);
    const entries = searches.map((search, index) => ({
      index: Number.isFinite(Number(search.index)) ? Number(search.index) : index,
      text: normalizeWhitespace(search.keywords),
      filters: filtersFromSearchResult(search, fallbackSharedFilters),
      criteria: criteriaNamesFromFilters(filtersFromSearchResult(search, fallbackSharedFilters)),
      filterComposerOpen: false,
      url: normalizeWhitespace(search.url)
    })).filter((entry) => entry.text || entry.url);
    state.entries = entries.map((entry) => ({
      text: entry.text,
      filters: entry.filters,
      criteria: entry.criteria
    }));
    syncAllEntryCriteria();
    lockProfileSchoolPrefill();
    state.lastRunEntries = entries;
    state.lastSearchPlan = run.searchPlan || null;
    state.lastRankingPlan = run.rankingPlan || null;
    state.importedPeopleBySearch = run.peopleBySearch || {};
    state.rankings = mergeRankingPlanIntoRankings(entries, buildRankings(entries), state.lastRankingPlan);
    state.activeTab = firstPopulatedRankingTab(state.rankings, "overall");
    return true;
  }

  function entryFromPersistedSearch(search, index) {
    const sourceIndex = sourceNumberFromSearchKey(search?.searchKey || "") || (Number(index) + 1);
    const filters = filtersFromSearchResult(search, [
      ...(Array.isArray(search?.criteria?.locations) ? search.criteria.locations.map((value) => ({ type: "location", sourceText: value })) : []),
      ...(Array.isArray(search?.criteria?.schools) ? search.criteria.schools.map((value) => ({ type: "school", sourceText: value })) : []),
      normalizeWhitespace(search?.criteria?.currentCompany) ? { type: "company", sourceText: search.criteria.currentCompany } : null
    ].filter(Boolean));
    return {
      index: sourceIndex - 1,
      text: normalizeWhitespace(search?.keywords),
      filters,
      criteria: criteriaNamesFromFilters(filters),
      filterComposerOpen: false,
      filterComposerType: "",
      url: normalizeWhitespace(search?.url)
    };
  }

  function selectedJobOutreachRun() {
    return normalizeJobOutreachRunSnapshot(state.runsById[state.selectedRunId]) || null;
  }

  function currentPageRunId() {
    const runId = normalizeWhitespace(state.pageRunIds[0]);
    return runId && state.runsById[runId] ? runId : "";
  }

  function currentPageJobOutreachRun() {
    const runId = currentPageRunId();
    return runId ? normalizeJobOutreachRunSnapshot(state.runsById[runId]) : null;
  }

  function latestCompletedCurrentPageRun() {
    const pageRunIds = Array.isArray(state.pageRunIds) ? state.pageRunIds : [];
    for (const runId of pageRunIds) {
      const run = normalizeJobOutreachRunSnapshot(state.runsById[runId]);
      if (normalizeJobOutreachRunStatus(run?.status) === "completed") {
        return run;
      }
    }
    return null;
  }

  function shouldKeepSearchEditorOpenForCurrentPage() {
    const run = currentPageJobOutreachRun();
    return !run || isCurrentPageSearchBusy(run);
  }

  function currentPageSearchDraftEntries() {
    const run = latestCompletedCurrentPageRun() || currentPageJobOutreachRun();
    const runSearches = Array.isArray(run?.searches) ? run.searches : [];
    if (runSearches.length) {
      return runSearches.map(entryFromPersistedSearch);
    }
    return [initialSearchEntry()];
  }

  function resetSearchDraftToCurrentDefault() {
    state.entries = currentPageSearchDraftEntries().map(normalizedSearchEntry);
    syncAllEntryCriteria();
    resetProfileSchoolPrefillLock();
    renderEntries();
  }

  function isSearchEditorCollapsed() {
    return nodes.searchPanel?.classList.contains("is-collapsed");
  }

  function hasBlockingJobOutreachRun() {
    return Boolean(state.activeRunId || (Array.isArray(state.activeRunIds) && state.activeRunIds.length));
  }

  function renderSearchActionButton() {
    if (!nodes.runSearch) {
      return;
    }
    const run = currentPageJobOutreachRun();
    const hasCurrentPageRun = Boolean(run);
    const collapsed = isSearchEditorCollapsed();
    nodes.runSearch.textContent = currentPageSearchActionLabel(run);
    nodes.runSearch.classList.toggle("hidden", !hasCurrentPageRun || !collapsed || isCurrentPageSearchBusy(run));
    nodes.runSearch.disabled = isCurrentPageSearchBusy(run) || hasBlockingJobOutreachRun();
    nodes.cancelSearchEdit?.classList.toggle("hidden", !hasCurrentPageRun || collapsed);
    renderSearchSubmitButton();
  }

  function renderSearchSubmitButton() {
    if (!nodes.submitSearch) {
      return;
    }
    const run = currentPageJobOutreachRun();
    const collapsed = isSearchEditorCollapsed();
    nodes.submitSearch.textContent = "Search";
    nodes.submitSearch.classList.toggle("hidden", collapsed);
    nodes.submitSearch.disabled = isCurrentPageSearchBusy(run) || hasBlockingJobOutreachRun();
  }

  function openSearchEditor() {
    resetSearchDraftToCurrentDefault();
    nodes.searchError?.classList.remove("is-visible");
    setStrategyCollapsed(false, state.lastRunEntries);
  }

  async function cancelSearchEditor() {
    const run = currentPageJobOutreachRun();
    if (run && isCurrentPageSearchBusy(run)) {
      try {
        const response = await cancelBackgroundJobOutreach(run.runId);
        if (response) {
          applyJobOutreachCommandResponse(response);
        }
      } catch (error) {
        nodes.searchError.textContent = error?.message || String(error);
        nodes.searchError.classList.add("is-visible");
        return;
      }
    }
    resetSearchDraftToCurrentDefault();
    nodes.searchError?.classList.remove("is-visible");
    setStrategyCollapsed(true, state.lastRunEntries);
  }

  function activeResultsRun() {
    const currentRun = currentPageJobOutreachRun();
    if (normalizeJobOutreachRunStatus(currentRun?.status) === "completed") {
      return currentRun;
    }
    return latestCompletedCurrentPageRun();
  }

  function visibleStatusRun() {
    const pageRun = currentPageJobOutreachRun();
    if (pageRun) {
      return pageRun;
    }
    const latestActiveOffPage = (Array.isArray(state.activeRunIds) ? state.activeRunIds : [])
      .map((runId) => normalizeJobOutreachRunSnapshot(state.runsById[runId]))
      .find((run) => run && !runBelongsToCurrentJob(run));
    if (latestActiveOffPage) {
      return latestActiveOffPage;
    }
    const latestRunId = normalizeWhitespace((Array.isArray(state.runOrder) ? state.runOrder : [])[0]);
    const latestRun = latestRunId ? normalizeJobOutreachRunSnapshot(state.runsById[latestRunId]) : null;
    if (latestRun && !runBelongsToCurrentJob(latestRun)) {
      return latestRun;
    }
    return null;
  }

  function searchHistoryRuns() {
    return [];
  }

  function runBelongsToCurrentJob(run) {
    if (!run) {
      return false;
    }
    const pageKey = jobIdentityKey(currentJob());
    const runKey = jobIdentityKey(run.job || {});
    return Boolean(pageKey && runKey && pageKey === runKey);
  }

  function displayJobForRun(run) {
    const runJob = normalizeJob(run?.job || {});
    if (runJob.title || runJob.company) {
      return runJob;
    }
    if (runBelongsToCurrentJob(run)) {
      const pageJob = currentJob();
      if (pageJob.title || pageJob.company) {
        return pageJob;
      }
    }
    return runJob;
  }

  function selectedRunTitle(run) {
    const job = displayJobForRun(run);
    if (job.title && job.company) {
      return `${job.company} - ${job.title}`;
    }
    if (job.title) {
      return job.title;
    }
    if (job.company) {
      return job.company;
    }
    return "Saved Job Outreach run";
  }

  function selectedRunStatusLabel(run) {
    const status = normalizeJobOutreachRunStatus(run?.status);
    return {
      queued: "Queued",
      running: "Running",
      awaiting_user_action: "Needs attention",
      resuming: "Resuming",
      completed: "Completed",
      failed: "Failed",
      cancelled: "Cancelled"
    }[status] || "Running";
  }

  function rankingBestUseLabel(bestUse) {
    return {
      direct_referral_path: "Direct referral path",
      hiring_context: "Hiring context",
      warm_entry_point: "Warm entry point",
      peer_team_insight: "Peer team insight",
      low_value: "Low value"
    }[normalizeWhitespace(bestUse)] || "";
  }

  function isSamePageCompletedRun(run, currentPageRun) {
    return Boolean(
      run
      && currentPageRun
      && run.runId === currentPageRun.runId
      && normalizeJobOutreachRunStatus(run.status) === "completed"
    );
  }

  function runSearchKeyLabel(search, index) {
    const key = normalizeSearchKey(search?.searchKey);
    if (key) {
      return `Search ${key}`;
    }
    return `Search ${searchLabel(Number(index) || 0)}`;
  }

  function renderResultsSearchLinks(run) {
    if (!nodes.resultsSearchLinks) {
      return;
    }
    const searches = Array.isArray(run?.searches) ? run.searches : [];
    if (!run || !searches.length) {
      nodes.resultsSearchLinks.innerHTML = "";
      nodes.resultsSearchLinks.classList.add("hidden");
      return;
    }
    nodes.resultsSearchLinks.innerHTML = searches.map((search, index) => {
      const label = runSearchKeyLabel(search, index);
      const url = normalizeWhitespace(search?.url);
      return `
        <div class="job-demo-results-search-link-row">
          ${url
            ? `<a class="job-demo-results-search-link" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(`${label} URL`)}</a>`
            : ""}
        </div>
      `;
    }).join("");
    nodes.resultsSearchLinks.classList.remove("hidden");
  }

  function runMatchesCurrentPage(runId) {
    const normalizedRunId = normalizeWhitespace(runId);
    if (!normalizedRunId || !state.pageRunIds.includes(normalizedRunId)) {
      return false;
    }
    return runBelongsToCurrentJob(state.runsById[normalizedRunId]);
  }

  function selectJobOutreachRun(runId, source = "user") {
    const normalizedRunId = normalizeWhitespace(runId);
    if (!normalizedRunId || !state.runsById[normalizedRunId]) {
      return false;
    }
    state.selectedRunId = normalizedRunId;
    state.selectedRunSource = normalizeWhitespace(source) || "user";
    return true;
  }

  function clearSelectedJobOutreachRun() {
    state.selectedRunId = "";
    state.selectedRunSource = "";
  }

  function applySelectedRunSnapshot() {
    const run = activeResultsRun();
    if (!run) {
      state.lastRunEntries = [];
      state.importedPeopleBySearch = {};
      state.lastSearchPlan = null;
      state.lastRankingPlan = null;
      state.rankings = {};
      state.activeTab = "overall";
      clearManualAction();
      return false;
    }
    const entries = (Array.isArray(run.searches) ? run.searches : [])
      .map(entryFromPersistedSearch)
      .filter((entry) => entry.text || entry.url);
    state.lastRunEntries = entries;
    state.importedPeopleBySearch = run.importedPeopleBySearch || {};
    state.lastSearchPlan = run.searchPlan || null;
    state.lastRankingPlan = run.rankingPlan || null;
    state.lastRankingAiInput = run.rankingInput || null;
    state.rankings = mergeRankingPlanIntoRankings(entries, buildRankings(entries), state.lastRankingPlan);
    state.activeTab = firstPopulatedRankingTab(state.rankings, state.activeTab || "overall");
    const currentPageRun = currentPageJobOutreachRun();
    const interactionRun = isJobOutreachRunActiveStatus(currentPageRun?.status) || currentPageRun?.manualAction
      ? currentPageRun
      : run;
    state.activeRunId = isJobOutreachRunActiveStatus(interactionRun?.status) ? interactionRun.runId : "";
    state.activeWorkerTabId = interactionRun?.workerTabId || interactionRun?.manualAction?.workerTabId || null;
    if (interactionRun?.manualAction) {
      setManualAction(interactionRun.manualAction, { focus: false });
    } else {
      clearManualAction();
    }
    return true;
  }

  function renderRunStatusPanel() {
    const run = visibleStatusRun();
    const currentPageRun = currentPageJobOutreachRun();
    if (!nodes.runPanel || !nodes.progressFill) {
      return;
    }
    const hideRunPanel = () => {
      nodes.runPanel.classList.add("hidden");
      if (nodes.runDetail) {
        nodes.runDetail.textContent = "";
        nodes.runDetail.classList.add("hidden");
      }
      if (nodes.runLink) {
        nodes.runLink.textContent = "";
        nodes.runLink.classList.add("hidden");
        nodes.runLink.removeAttribute("href");
      }
      nodes.progressFill.parentElement?.classList.add("hidden");
    };
    const hideActivityBanner = () => {
      if (!nodes.activityBanner) {
        return;
      }
      nodes.activityBanner.classList.add("hidden");
      if (nodes.activityTitle) {
        nodes.activityTitle.textContent = "";
      }
      if (nodes.activityLink) {
        nodes.activityLink.textContent = "";
        nodes.activityLink.classList.add("hidden");
        nodes.activityLink.removeAttribute("href");
      }
    };
    if (!run) {
      hideRunPanel();
      hideActivityBanner();
      renderSearchActionButton();
      return;
    }
    const status = normalizeJobOutreachRunStatus(run.status);
    if (isSamePageCompletedRun(run, currentPageRun)) {
      hideRunPanel();
      hideActivityBanner();
      renderSearchActionButton();
      return;
    }
    const isCurrentPageRun = currentPageRun?.runId === run.runId;
    if (!isCurrentPageRun) {
      hideRunPanel();
      if (nodes.activityBanner && nodes.activityTitle) {
        const title = selectedRunTitle(run);
        nodes.activityTitle.textContent = status === "completed"
          ? `Background search completed for ${title}.`
          : `${normalizeWhitespace(run.progressText) || selectedRunStatusLabel(run)} · ${title}`;
        const linkUrl = normalizeWhitespace(run?.job?.sourceUrl || run?.job?.jobUrl || "");
        if (nodes.activityLink) {
          const showLink = status === "completed" && linkUrl;
          if (showLink) {
            nodes.activityLink.textContent = `Open ${title}`;
            nodes.activityLink.href = linkUrl;
            nodes.activityLink.classList.remove("hidden");
          } else {
            nodes.activityLink.textContent = "";
            nodes.activityLink.classList.add("hidden");
            nodes.activityLink.removeAttribute("href");
          }
        }
        nodes.activityBanner.classList.remove("hidden");
      }
      renderSearchActionButton();
      return;
    }
    hideActivityBanner();
    nodes.runPanel.classList.remove("hidden");
    nodes.runSummary.textContent = normalizeWhitespace(run.progressText) || selectedRunStatusLabel(run);
    if (nodes.runDetail) {
      const detail = normalizeWhitespace(run?.progressDetail || run?.error || "");
      nodes.runDetail.textContent = detail;
      nodes.runDetail.classList.toggle("hidden", !detail);
    }
    if (nodes.runLink) {
      nodes.runLink.textContent = "";
      nodes.runLink.classList.add("hidden");
      nodes.runLink.removeAttribute("href");
    }
    const progressPercent = Math.max(
      0,
      Math.min(
        100,
        Number(run.progressPercent || 0) || (status === "completed" ? 100 : 0)
      )
    );
    nodes.progressFill.style.width = `${progressPercent}%`;
    nodes.progressFill.parentElement?.classList.toggle("hidden", progressPercent <= 0 || status === "completed");
    renderSearchActionButton();
  }

  function renderSelectedRunPanels() {
    const hasRun = applySelectedRunSnapshot();
    if (!hasRun) {
      nodes.resultsSearchLinks?.classList.add("hidden");
      nodes.rankPanel?.classList.add("hidden");
      renderRunStatusPanel();
      renderSearchActionButton();
      return;
    }
    renderRunStatusPanel();
    const resultsRun = activeResultsRun();
    const canShowResults = normalizeJobOutreachRunStatus(resultsRun?.status) === "completed" && hasAnyRankingPeople(state.rankings);
    if (canShowResults) {
      nodes.rankPanel?.classList.remove("hidden");
      renderRankings();
    } else {
      nodes.rankPanel?.classList.add("hidden");
    }
    setStrategyCollapsed(true, state.lastRunEntries);
    renderSearchActionButton();
  }

  function runActionLabel(action) {
    return {
      select: "Open",
      cancel: "Cancel",
      dismiss: "Dismiss",
      resume: "Continue",
      "open-worker-tab": "Open LinkedIn tab",
      "view-results": "View results",
      "continue-run": "Continue",
      "rerun-search": "Search again",
      "start-search": "Start search"
    }[action] || "Open";
  }

  function renderRunRegistry() {}

  function clearRunTimers() {
    runTimerIds.forEach((timerId) => window.clearTimeout(timerId));
    runTimerIds = [];
  }

  function renderManualFilterActions(filters) {
    return (Array.isArray(filters) ? filters : []).map((filter, index) => {
      const typeLabel = filterTypeLabel(filter.type);
      const label = normalizeWhitespace(filter.label || filter.sourceText);
      return `
        <div class="job-demo-manual-filter-row">
          <span class="job-demo-manual-filter-label">${escapeHtml(typeLabel)}: ${escapeHtml(label)}</span>
          <button class="secondary-button job-demo-manual-filter-remove" type="button" data-job-demo-remove-manual-filter="${index}">Remove</button>
        </div>
      `;
    }).join("");
  }

  function renderRunActions() {
    const manualAction = state.manualAction;
    if (!nodes.manualOverlay || !nodes.openWorkerTab || !nodes.resumeRun) {
      return;
    }
    const hasManualAction = Boolean(manualAction?.requestId);
    nodes.manualOverlay.classList.toggle("hidden", !hasManualAction);
    nodes.manualOverlay.setAttribute("aria-hidden", hasManualAction ? "false" : "true");
    if (nodes.manualEyebrow) {
      nodes.manualEyebrow.textContent = hasManualAction ? "LinkedIn confirmation needed" : "";
    }
    if (nodes.manualTitle) {
      nodes.manualTitle.textContent = hasManualAction
        ? (manualAction.summary || "Check LinkedIn filters")
        : "Check LinkedIn filters";
    }
    if (nodes.manualDetail) {
      nodes.manualDetail.textContent = hasManualAction ? normalizeWhitespace(manualAction.detail) : "";
    }
    if (nodes.manualReason) {
      nodes.manualReason.textContent = hasManualAction ? normalizeWhitespace(manualAction.reason) : "";
      nodes.manualReason.classList.toggle("hidden", !normalizeWhitespace(nodes.manualReason.textContent));
    }
    if (nodes.manualFilters) {
      const filters = hasManualAction ? manualAction.removableFilters || [] : [];
      nodes.manualFilters.innerHTML = renderManualFilterActions(filters);
      nodes.manualFilters.classList.toggle("hidden", !filters.length);
    }
    nodes.openWorkerTab.disabled = !hasManualAction;
    nodes.resumeRun.disabled = !hasManualAction;
  }

  function clearManualAction() {
    state.manualAction = null;
    state.activeWorkerTabId = null;
    renderRunActions();
  }

  function setManualAction(action, options = {}) {
    state.manualAction = normalizeJobOutreachManualAction(action);
    state.activeWorkerTabId = state.manualAction?.workerTabId || null;
    renderRunActions();
    if (state.manualAction?.requestId && options.focus !== false) {
      window.setTimeout(() => {
        nodes.openWorkerTab?.focus();
      }, 0);
    }
  }

  function setProgress(activeIndex) {
    const labels = [
      "Building search links",
      "Opening your search",
      "Reading visible results",
      "Ranking people"
    ];
    if (activeIndex < 0) {
      nodes.runPanel.classList.add("hidden");
      nodes.progressFill.style.width = "0%";
      nodes.runSummary.textContent = "Ready.";
      if (nodes.runDetail) {
        nodes.runDetail.textContent = "";
      }
      clearManualAction();
      renderSearchActionButton();
      return;
    }
    const index = Math.min(activeIndex, labels.length - 1);
    nodes.runPanel.classList.remove("hidden");
    nodes.runSummary.textContent = labels[index];
    if (nodes.runDetail) {
      nodes.runDetail.textContent = "";
    }
    nodes.progressFill.style.width = `${((index + 1) / labels.length) * 100}%`;
    clearManualAction();
    renderSearchActionButton();
  }

  function setWorkflowProgress(progress) {
    const text = normalizeWhitespace(progress?.text || progress?.stage);
    const detail = normalizeWhitespace(progress?.detail);
    const percent = Math.max(0, Math.min(100, Number(progress?.progressPercent || progress?.percent || 0)));
    const manualAction = normalizeJobOutreachManualAction(progress?.manualAction);
    nodes.runPanel.classList.remove("hidden");
    nodes.runSummary.textContent = manualAction ? "Waiting for LinkedIn confirmation." : (text || "Working...");
    if (nodes.runDetail) {
      nodes.runDetail.textContent = manualAction ? "Complete the filter selection in LinkedIn, then continue here." : detail;
      nodes.runDetail.classList.toggle("hidden", !(manualAction || detail));
    }
    if (Number.isFinite(percent) && percent > 0) {
      nodes.progressFill.style.width = `${percent}%`;
    }
    if (manualAction) {
      setManualAction(manualAction);
    } else if (state.manualAction && normalizeWhitespace(progress?.status) !== "awaiting_user_action") {
      clearManualAction();
    } else {
      renderRunActions();
    }
    renderSearchActionButton();
  }

  function renderUrlPreview(entries) {
    void entries;
  }

  function sourceIndexFromSearchUrl(url) {
    try {
      const parsed = new URL(url, window.location.origin);
      const origin = normalizeWhitespace(parsed.searchParams.get("origin") || "");
      const match = origin.match(/LUMI_JOB_DEMO_(\d+)/i);
      if (match) {
        return Math.max(1, Math.min(3, Number(match[1]) || 1));
      }
      const letterMatch = origin.match(/LUMI_JOB_OUTREACH_([ABC])/i);
      if (letterMatch) {
        return Math.max(1, searchLabels.indexOf(letterMatch[1].toUpperCase()) + 1);
      }
    } catch (_error) {}
    return 0;
  }

  function shouldAcceptPeopleSearchSource(sourceNumber) {
    if (!sourceNumber) {
      return false;
    }
    if (!state.lastRunEntries.length) {
      return true;
    }
    return state.lastRunEntries.some((entry) => Number(entry?.index) === sourceNumber - 1);
  }

  function searchKeywordsFromUrl(url) {
    try {
      const parsed = new URL(url, window.location.origin);
      return normalizeWhitespace(parsed.searchParams.get("keywords") || "");
    } catch (_error) {
      return "";
    }
  }

  function cleanProfileUrlForDedupe(url) {
    return normalizeWhitespace(url).toLowerCase().replace(/[?#].*$/, "").replace(/\/$/, "");
  }

  function searchEntryForSourceNumber(sourceNumber) {
    const index = Number(sourceNumber) - 1;
    if (!Number.isInteger(index) || index < 0) {
      return null;
    }
    const candidates = [
      ...state.lastRunEntries,
      ...state.pendingRunEntries,
      ...state.entries.map((entry, entryIndex) => ({ ...entry, index: entryIndex }))
    ];
    return candidates.find((entry) => Number(entry?.index) === index) || null;
  }

  function searchKeywordsForSourceNumber(sourceNumber) {
    const entry = searchEntryForSourceNumber(sourceNumber);
    return normalizeWhitespace(entry?.text) || searchKeywordsFromUrl(entry?.url);
  }

  function personSearchKeywordTooltip(person) {
    const sourceIndices = Array.isArray(person?.sourceIndices) && person.sourceIndices.length
      ? person.sourceIndices
      : [person?.sourceIndex];
    const lines = uniqueValues(sourceIndices
      .map(Number)
      .filter(Number.isFinite)
      .map((sourceNumber) => {
        const label = searchLabel(sourceNumber - 1);
        const keywords = searchKeywordsForSourceNumber(sourceNumber);
        return keywords ? `Search ${label}: ${keywords}` : `Search ${label}`;
      }));
    return lines.length ? `Keywords used:\n${lines.join("\n")}` : "";
  }

  function numericSignal(text) {
    const normalized = normalizeWhitespace(text);
    const match = normalized.match(/\b(\d+)(?:K)?\b/i);
    if (!match) {
      return /is a mutual connection/i.test(normalized) ? 1 : 0;
    }
    const value = Number(match[1]) || 0;
    return /\bK\b/i.test(match[0]) ? value * 1000 : value;
  }

  function rankScore(person) {
    const degree = normalizeWhitespace(person.connectionDegree).toLowerCase();
    const action = normalizeWhitespace(person.primaryAction || person.action).toLowerCase();
    const company = normalizeWhitespace(currentJob().company).toLowerCase();
    const combined = normalizeWhitespace([
      person.headline,
      person.currentText,
      person.pastText,
      person.aiGeneratedInsight
    ].join(" ")).toLowerCase();
    return (
      (degree === "1st" ? 40 : degree === "2nd" ? 25 : degree.startsWith("3rd") ? 10 : 0)
      + (action === "message" ? 14 : action === "connect" ? 10 : 4)
      + (company && combined.includes(company) ? 18 : 0)
      + (/product|recruit|talent|hiring|people|manager|lead/i.test(combined) ? 8 : 0)
      + Math.min(12, numericSignal(person.mutualConnectionsText || person.signals?.[0] || "") / 3)
    );
  }

  function normalizePersonForRanking(person, sourceNumber, fallbackRank) {
    const signals = Array.isArray(person.signals)
      ? person.signals
      : [person.mutualConnectionsText, person.followersText].filter(Boolean);
    return {
      ...person,
      name: normalizeWhitespace(person.name),
      profileUrl: normalizeWhitespace(person.profileUrl),
      avatarUrl: normalizeWhitespace(person.avatarUrl),
      connectionDegree: normalizeWhitespace(person.connectionDegree),
      headline: normalizeWhitespace(person.headline),
      location: normalizeWhitespace(person.location),
      action: normalizeWhitespace(person.action || person.primaryAction || "Open"),
      signals,
      reason: normalizeWhitespace(person.reason),
      rank: fallbackRank,
      source: `Search ${searchLabel(sourceNumber - 1)}`,
      sourceIndex: sourceNumber
    };
  }

  function rankedPeopleForEntry(entry) {
    const sourceNumber = entry.index + 1;
    const imported = state.importedPeopleBySearch[String(sourceNumber)] || [];
    return imported
      .map((person, personIndex) => normalizePersonForRanking(person, sourceNumber, personIndex + 1))
      .sort((left, right) => rankScore(right) - rankScore(left))
      .map((person, index) => ({ ...person, rank: index + 1 }));
  }

  function personDedupeKey(person) {
    const profileUrl = cleanProfileUrlForDedupe(person?.profileUrl);
    if (profileUrl) {
      return `url:${profileUrl}`;
    }
    const name = normalizeWhitespace(person?.name).toLowerCase();
    const headline = normalizeWhitespace(person?.headline).toLowerCase();
    return name ? `name:${name}|${headline.slice(0, 80)}` : "";
  }

  function planPersonKey(profileUrl, sourceSearchKey) {
    const cleanUrl = cleanProfileUrlForDedupe(profileUrl);
    const searchKey = normalizeSearchKey(sourceSearchKey);
    return cleanUrl && searchKey ? `${cleanUrl}|${searchKey}` : "";
  }

  function mergeAiBestPersonSources(existing, candidate) {
    const sourceIndices = uniqueValues([...(existing.sourceIndices || [existing.sourceIndex]), ...(candidate.sourceIndices || [candidate.sourceIndex])])
      .map(Number)
      .filter(Number.isFinite)
      .sort((left, right) => left - right);
    const sourceLabels = uniqueValues([
      ...(Array.isArray(existing.sourceLabels) ? existing.sourceLabels : [existing.source]),
      ...(Array.isArray(candidate.sourceLabels) ? candidate.sourceLabels : [candidate.source])
    ].filter(Boolean));
    const existingRank = Number(existing.rank || 9999);
    const candidateRank = Number(candidate.rank || 9999);
    const winner = candidateRank < existingRank ? candidate : existing;
    return {
      ...winner,
      signals: uniqueValues([...(existing.signals || []), ...(candidate.signals || [])]),
      sourceIndex: sourceIndices[0] || winner.sourceIndex,
      sourceIndices,
      sourceLabels,
      source: sourceLabels.join(" / ")
    };
  }

  function dedupeAiBestRankings(people) {
    const deduped = [];
    const byKey = new Map();
    people.forEach((person) => {
      const key = personDedupeKey(person);
      if (!key) {
        deduped.push(person);
        return;
      }
      const existingIndex = byKey.get(key);
      if (Number.isInteger(existingIndex)) {
        deduped[existingIndex] = mergeAiBestPersonSources(deduped[existingIndex], person);
        return;
      }
      byKey.set(key, deduped.length);
      deduped.push({
        ...person,
        sourceIndices: Array.isArray(person.sourceIndices) ? person.sourceIndices : [person.sourceIndex].filter(Boolean),
        sourceLabels: Array.isArray(person.sourceLabels) ? person.sourceLabels : [person.source].filter(Boolean)
      });
    });
    return deduped;
  }

  function mergeRankedPersonSources(existing, candidate) {
    const sourceIndices = uniqueValues([...(existing.sourceIndices || [existing.sourceIndex]), candidate.sourceIndex])
      .map(Number)
      .filter(Number.isFinite)
      .sort((left, right) => left - right);
    const sourceLabels = uniqueValues([
      ...(Array.isArray(existing.sourceLabels) ? existing.sourceLabels : [existing.source]),
      candidate.source
    ].filter(Boolean));
    const best = rankScore(candidate) > rankScore(existing) ? candidate : existing;
    const signals = uniqueValues([...(existing.signals || []), ...(candidate.signals || [])]);
    return {
      ...best,
      reason: existing.reason || candidate.reason || best.reason,
      signals,
      sourceIndex: Math.min(...sourceIndices),
      sourceIndices,
      sourceLabels,
      source: sourceLabels.join(" / ")
    };
  }

  function dedupeOverallRankings(people) {
    const deduped = [];
    const byKey = new Map();
    people.forEach((person) => {
      const key = personDedupeKey(person);
      if (!key) {
        deduped.push(person);
        return;
      }
      const existingIndex = byKey.get(key);
      if (Number.isInteger(existingIndex)) {
        deduped[existingIndex] = mergeRankedPersonSources(deduped[existingIndex], person);
        return;
      }
      byKey.set(key, deduped.length);
      deduped.push({
        ...person,
        sourceIndices: [person.sourceIndex],
        sourceLabels: [person.source].filter(Boolean)
      });
    });
    return deduped;
  }

  function setStrategyCollapsed(collapsed, entries = []) {
    if (entries.length) {
      state.lastRunEntries = entries;
    }
    const effectiveCollapsed = collapsed && !shouldKeepSearchEditorOpenForCurrentPage();
    nodes.searchPanel.classList.toggle("is-collapsed", effectiveCollapsed);
    nodes.strategySummary.classList.add("hidden");
    renderSearchActionButton();
  }

  function buildRankings(entries) {
    const rankings = {};
    entries.forEach((entry) => {
      const people = rankedPeopleForEntry(entry);
      rankings[String(entry.index + 1)] = people;
    });
    rankings.overall = [];
    return rankings;
  }

  function peopleByPlanKey(rankings) {
    const byKey = new Map();
    Object.entries(rankings).forEach(([sourceNumber, people]) => {
      if (sourceNumber === "overall") {
        return;
      }
      const sourceKey = searchLabel(Number(sourceNumber) - 1);
      (Array.isArray(people) ? people : []).forEach((person) => {
        const key = planPersonKey(person.profileUrl, sourceKey);
        if (key) {
          byKey.set(key, person);
        }
      });
    });
    return byKey;
  }

  function buildAiBestRankings(rankings, plan) {
    const personByPlanKey = peopleByPlanKey(rankings);
    const bestPeople = (Array.isArray(plan?.people) ? plan.people : [])
      .slice()
      .sort((left, right) => Number(left.rank || 9999) - Number(right.rank || 9999))
      .map((strategy) => {
        const sourceKey = normalizeSearchKey(strategy.sourceSearchKey);
        const sourceNumber = sourceNumberFromSearchKey(sourceKey);
        const person = personByPlanKey.get(planPersonKey(strategy.profileUrl, sourceKey));
        if (!person) {
          return null;
        }
        const sourceLabel = sourceKey ? `Search ${sourceKey}` : person.source;
        return {
          ...person,
          confidence: strategy.confidence,
          bestUse: strategy.bestUse,
          reason: strategy.reason || person.reason,
          approachStrategy: strategy.approachStrategy,
          rank: Math.max(1, Number(strategy.rank || 0) || 0),
          source: sourceLabel,
          sourceIndex: sourceNumber || person.sourceIndex,
          sourceIndices: [sourceNumber || person.sourceIndex].filter(Boolean),
          sourceLabels: [sourceLabel].filter(Boolean)
        };
      })
      .filter(Boolean);
    return dedupeAiBestRankings(bestPeople)
      .sort((left, right) => Number(left.rank || 9999) - Number(right.rank || 9999))
      .map((person, index) => ({ ...person, rank: index + 1 }));
  }

  function renderRankTabs() {
    const tabLabels = [
      ["overall", "Best"],
      ["1", "A"],
      ["2", "B"],
      ["3", "C"]
    ];
    nodes.rankTabs.innerHTML = tabLabels.map(([key, label]) => {
      const count = (state.rankings[key] || []).length;
      const disabled = key !== "overall" && !count;
      return `<button class="job-demo-tab ${state.activeTab === key ? "is-active" : ""}" data-job-demo-tab="${key}" type="button" ${disabled ? "disabled" : ""}>${label}${count ? ` (${count})` : ""}</button>`;
    }).join("");
  }

  function renderResultMeta(person) {
    return [person.headline, person.location, ...(person.signals || [])]
      .filter(Boolean)
      .map((part, index) => `${index ? '<span class="job-demo-result-meta-dot" aria-hidden="true"></span>' : ""}${escapeHtml(part)}`)
      .join("");
  }

  function renderRankList() {
    const people = state.rankings[state.activeTab] || [];
    if (!people.length) {
      const emptyText = state.activeTab === "overall"
        ? "No AI-ranked people yet."
        : `No visible people found for Search ${searchLabel(Number(state.activeTab) - 1)}.`;
      nodes.rankList.innerHTML = `<div class="job-demo-empty">${escapeHtml(emptyText)}</div>`;
      return;
    }
    nodes.rankList.innerHTML = people.map((person) => {
      const keywordTooltip = personSearchKeywordTooltip(person);
      const bestUseLabel = rankingBestUseLabel(person.bestUse);
      const sourceBadge = person.sourceIndex
        ? searchLabel(Number(person.sourceIndex) - 1)
        : normalizeWhitespace(String(person.source || "").replace(/^Search\s+/i, ""));
      const supportingMeta = [
        normalizeWhitespace(person.connectionDegree) ? escapeHtml(normalizeWhitespace(person.connectionDegree)) : "",
        sourceBadge ? escapeHtml(sourceBadge) : "",
        renderResultMeta(person)
      ].filter(Boolean).join(" - ");
      return `
      <article class="job-demo-person-card" ${keywordTooltip ? `title="${escapeHtml(keywordTooltip)}"` : ""}>
        <div class="job-demo-person-top">
          <div class="job-demo-result-avatar">
            ${person.avatarUrl
              ? `<img src="${escapeHtml(person.avatarUrl)}" alt="${escapeHtml(person.name)}">`
              : `<span class="job-demo-avatar-fallback">${escapeHtml(person.name.slice(0, 1) || "?")}</span>`}
            <span class="job-demo-rank">${person.rank}</span>
          </div>
          <div class="job-demo-person-actions">
            <button class="job-demo-message-button" type="button" data-job-demo-open-messages="${escapeHtml(person.profileUrl)}" aria-label="Open LinkedIn messages with ${escapeHtml(person.name)}" title="Open messages">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path>
              </svg>
            </button>
          </div>
          <div class="job-demo-person-copy">
            <p class="job-demo-result-identity-line">
              <a class="job-demo-person-name" href="${escapeHtml(person.profileUrl)}" target="_blank" rel="noreferrer">${escapeHtml(person.name)}</a>${supportingMeta ? `<span class="job-demo-result-supporting-meta"> - ${supportingMeta}</span>` : ""}
            </p>
            ${bestUseLabel ? `<p class="job-demo-result-best-use"><strong>Best use:</strong> ${escapeHtml(bestUseLabel)}</p>` : ""}
          </div>
        </div>
        ${person.approachStrategy ? `<p class="job-demo-result-approach"><strong>Best ask:</strong> ${escapeHtml(person.approachStrategy)}</p>` : ""}
        ${person.reason ? `<p class="job-demo-reason"><strong>Why this person:</strong> ${escapeHtml(person.reason)}</p>` : ""}
      </article>
    `;
    }).join("");
  }

  function renderRankings() {
    if (nodes.rankTitle) {
      nodes.rankTitle.textContent = "Results";
    }
    renderResultsSearchLinks(activeResultsRun());
    nodes.rankPanel.classList.remove("hidden");
    renderRankTabs();
    renderRankList();
  }

  function rankingTabHasPeople(rankings, key) {
    return Array.isArray(rankings?.[key]) && rankings[key].length > 0;
  }

  function hasAnyRankingPeople(rankings = state.rankings) {
    return ["overall", "1", "2", "3"].some((key) => rankingTabHasPeople(rankings, key));
  }

  function firstPopulatedRankingTab(rankings = state.rankings, preferred = "overall") {
    if (rankingTabHasPeople(rankings, preferred)) {
      return preferred;
    }
    return ["overall", "1", "2", "3"].find((key) => rankingTabHasPeople(rankings, key)) || "overall";
  }

  function totalSourceRankingPeople(rankings = state.rankings) {
    return ["1", "2", "3"].reduce((total, key) => total + (rankings[key] || []).length, 0);
  }

  function completeJobOutreachRun(backgroundResult, rawEntries) {
    const entries = backgroundResult
      ? applyBackgroundWorkflowResult(backgroundResult, rawEntries)
      : buildEntriesWithSearchUrls(rawEntries);
    if (!backgroundResult) {
      state.rankings = mergeRankingPlanIntoRankings(entries, buildRankings(entries));
    }
    renderUrlPreview(entries);
    state.activeTab = firstPopulatedRankingTab(state.rankings, "overall");
    if (hasAnyRankingPeople(state.rankings)) {
      renderRankings();
    }
    const sourceCount = totalSourceRankingPeople(state.rankings);
    const hasNoResults = sourceCount === 0;
    setStrategyCollapsed(true, entries);
    setWorkflowProgress({
      text: "Search completed.",
      detail: "",
      progressPercent: 100
    });
    nodes.runPanel.classList.remove("hidden");
    recordJobOutreachRunFromResponse(backgroundResult || {
      requestId: state.activeRunId,
      job: currentJob(),
      searches: entries.map((entry) => ({
        searchKey: searchLabel(entry.index),
        keywords: entry.text,
        criteria: criteriaPayloadFromFilters(entry.filters),
        filters: entry.filters,
        url: entry.url
      })),
      rankingPlan: state.lastRankingPlan,
      importedPeopleBySearch: state.importedPeopleBySearch
    }, {
      runId: state.activeRunId,
      status: "completed",
      progressText: "Search completed.",
      progressDetail: "",
      progressPercent: 100,
      selectionSource: "page"
    });
    renderRunRegistry();
    renderSelectedRunPanels();
    state.pendingRunEntries = [];
    setSearchButtonsDisabled(false);
  }

  function pauseJobOutreachRun(error) {
    const manualAction = normalizeJobOutreachManualAction(error?.manualAction || error?.response?.manualAction);
    if (!manualAction) {
      return false;
    }
    if (error?.response?.jobOutreachFilterCache) {
      state.filterCache = normalizeFilterCache(error.response.jobOutreachFilterCache);
    }
    state.activeRunId = manualAction.requestId;
    setManualAction(manualAction);
    upsertJobOutreachRunSnapshot({
      runId: manualAction.requestId,
      job: currentJob(),
      status: "awaiting_user_action",
      workerTabId: manualAction.workerTabId,
      manualAction,
      progressText: manualAction.summary,
      progressDetail: [manualAction.detail, manualAction.reason].filter(Boolean).join(" "),
      progressPercent: manualAction.progressPercent || 40,
      searches: state.pendingRunEntries.map((entry) => ({
        searchKey: searchLabel(entry.index),
        keywords: entry.text,
        criteria: criteriaPayloadFromFilters(entry.filters),
        filters: entry.filters,
        url: entry.url || buildSearchUrl(entry, entry.index)
      })),
      selectionSource: "page"
    }, "page");
    setWorkflowProgress({
      text: manualAction.summary,
      detail: [manualAction.detail, manualAction.reason].filter(Boolean).join(" "),
      progressPercent: manualAction.progressPercent || 40,
      status: manualAction.status,
      searchKey: manualAction.searchKey,
      workerTabId: manualAction.workerTabId,
      manualAction
    });
    renderRunRegistry();
    renderSelectedRunPanels();
    nodes.searchError.classList.remove("is-visible");
    setSearchButtonsDisabled(true);
    return true;
  }

  async function resumePausedSearch(options = {}) {
    const manualAction = state.manualAction;
    if (!manualAction?.requestId || !state.pendingRunEntries.length) {
      return;
    }
    const removeFilter = options.removeFilter || null;
    if (removeFilter) {
      removeManualFilterFromLocalState(manualAction, removeFilter);
    }
    nodes.searchError.classList.remove("is-visible");
    setSearchButtonsDisabled(true);
    const pendingEntries = cloneWorkflowEntries(state.pendingRunEntries);
    setWorkflowProgress({
      text: `Resuming Search ${manualAction.searchKey || ""}`.trim(),
      detail: removeFilter
        ? `Removed ${filterTypeLabel(removeFilter.type).toLowerCase()} "${removeFilter.sourceText || removeFilter.label}" from this search.`
        : "Reading the LinkedIn search tab after your filter changes.",
      progressPercent: Math.max(40, Number(manualAction.progressPercent || 40))
    });
    upsertJobOutreachRunSnapshot({
      runId: manualAction.requestId,
      job: currentJob(),
      status: "resuming",
      workerTabId: manualAction.workerTabId,
      progressText: `Resuming Search ${manualAction.searchKey || ""}`.trim(),
      progressDetail: removeFilter
        ? `Removed ${filterTypeLabel(removeFilter.type).toLowerCase()} "${removeFilter.sourceText || removeFilter.label}" from this search.`
        : "Reading the LinkedIn search tab after your filter changes.",
      progressPercent: Math.max(40, Number(manualAction.progressPercent || 40)),
      searches: pendingEntries.map((entry) => ({
        searchKey: searchLabel(entry.index),
        keywords: entry.text,
        criteria: criteriaPayloadFromFilters(entry.filters),
        filters: entry.filters,
        url: entry.url || buildSearchUrl(entry, entry.index)
      })),
      selectionSource: "page"
    }, "page");
    renderRunRegistry();
    renderSelectedRunPanels();
    try {
      const backgroundResult = await resumeBackgroundJobOutreach(manualAction.requestId, { removeFilter });
      completeJobOutreachRun(backgroundResult, pendingEntries);
    } catch (error) {
      if (pauseJobOutreachRun(error)) {
        return;
      }
      state.activeRunId = "";
      state.pendingRunEntries = [];
      setSearchButtonsDisabled(false);
      nodes.searchError.textContent = error?.message || String(error);
      nodes.searchError.classList.add("is-visible");
      upsertJobOutreachRunSnapshot({
        runId: manualAction.requestId,
        job: currentJob(),
        status: "failed",
        progressText: "Resume failed",
        progressDetail: error?.message || String(error),
        error: error?.message || String(error)
      }, "page");
      renderRunRegistry();
      renderSelectedRunPanels();
    }
  }

  async function runSearch() {
    readEntriesFromDom();
    nodes.searchError.classList.remove("is-visible");
    const rawEntries = activeEntries();
    const hadExistingRun = Boolean(currentPageJobOutreachRun());
    if (!hasCurrentJob()) {
      nodes.searchError.textContent = hasRecognizedJob()
        ? "Job details are still loading. Wait for LinkedIn to show the title and company, then refresh."
        : "Open a LinkedIn job first.";
      nodes.searchError.classList.add("is-visible");
      nodes.runSummary.textContent = hasRecognizedJob() ? "Job details needed." : "Job needed.";
      return;
    }
    if (!rawEntries.length) {
      nodes.searchError.textContent = "Add a keyword.";
      nodes.searchError.classList.add("is-visible");
      nodes.runSummary.textContent = "Search needs a keyword.";
      return;
    }
    clearRunTimers();
    setSearchButtonsDisabled(true);
    nodes.rankPanel.classList.add("hidden");
    setStrategyCollapsed(hadExistingRun ? false : true);
    const requestId = createRunId();
    state.activeRunId = requestId;
    state.pendingRunEntries = cloneWorkflowEntries(rawEntries);
    clearManualAction();
    setWorkflowProgress({
      text: "Starting job outreach",
      detail: `${rawEntries.length} active search${rawEntries.length === 1 ? "" : "es"} queued.`,
      progressPercent: 5
    });
    state.pageRunIds = dedupeRunIds([requestId, ...state.pageRunIds]);
    selectJobOutreachRun(requestId, "page");
    upsertJobOutreachRunSnapshot({
      runId: requestId,
      job: currentJob(),
      status: "running",
      progressText: "Starting job outreach",
      progressDetail: `${rawEntries.length} active search${rawEntries.length === 1 ? "" : "es"} queued.`,
      progressPercent: 5,
      sourceTabId: state.activeTabId || null,
      searches: rawEntries.map((entry) => ({
        searchKey: searchLabel(entry.index),
        keywords: entry.text,
        criteria: criteriaPayloadFromFilters(entry.filters),
        filters: entry.filters,
        url: buildSearchUrl(entry, entry.index)
      }))
    }, "page");
    renderRunRegistry();
    renderSelectedRunPanels();
    try {
      const backgroundResult = await runBackgroundJobOutreach(rawEntries, requestId);
      if (backgroundResult?.queued) {
        recordJobOutreachRunFromResponse(backgroundResult, {
          runId: requestId,
          status: "queued",
          progressText: `Queued${Number(backgroundResult.queuePosition) > 0 ? ` (#${backgroundResult.queuePosition})` : ""}`,
          progressDetail: "Another Job Outreach run is still active. This one will start automatically.",
          progressPercent: 0,
          selectionSource: "page"
        });
        applyJobOutreachCommandResponse(backgroundResult);
        setSearchButtonsDisabled(false);
        state.activeRunId = "";
        state.pendingRunEntries = [];
        return;
      }
      completeJobOutreachRun(backgroundResult, rawEntries);
    } catch (error) {
      if (pauseJobOutreachRun(error)) {
        return;
      }
      nodes.searchError.textContent = error?.message || String(error);
      nodes.searchError.classList.add("is-visible");
      state.pendingRunEntries = [];
      upsertJobOutreachRunSnapshot({
        runId: requestId,
        job: currentJob(),
        status: "failed",
        progressText: "Job Outreach failed",
        progressDetail: error?.message || String(error),
        error: error?.message || String(error)
      }, "page");
      renderRunRegistry();
      renderSelectedRunPanels();
    } finally {
      if (!state.manualAction) {
        state.activeRunId = "";
        setSearchButtonsDisabled(false);
      }
    }
  }

  function resetForm() {
    clearRunTimers();
    state.rankings = {};
    state.importedPeopleBySearch = {};
    state.lastRunEntries = [];
    state.lastSearchPlan = null;
    state.lastRankingPlan = null;
    state.activeTab = "overall";
    state.activeRunId = "";
    state.activeWorkerTabId = null;
    state.manualAction = null;
    state.pendingRunEntries = [];
    state.loadedSavedRunId = "";
    state.entries = [initialSearchEntry()];
    syncAllEntryCriteria();
    resetProfileSchoolPrefillLock();
    nodes.rankPanel.classList.add("hidden");
    nodes.searchError.classList.remove("is-visible");
    setSearchButtonsDisabled(false);
    setStrategyCollapsed(true);
    setProgress(-1);
    renderEntries();
  }

  function resetForCurrentJob() {
    clearRunTimers();
    state.rankings = {};
    state.importedPeopleBySearch = {};
    state.lastRunEntries = [];
    state.lastSearchPlan = null;
    state.lastRankingPlan = null;
    state.activeTab = "overall";
    state.activeRunId = "";
    state.activeWorkerTabId = null;
    state.manualAction = null;
    state.pendingRunEntries = [];
    state.loadedSavedRunId = "";
    state.pageRunIds = [];
    clearSelectedJobOutreachRun();
    state.entries = [initialSearchEntry()];
    syncAllEntryCriteria();
    resetProfileSchoolPrefillLock();
    if (nodes.rankPanel) {
      nodes.rankPanel.classList.add("hidden");
    }
    if (nodes.searchError) {
      nodes.searchError.classList.remove("is-visible");
    }
    setSearchButtonsDisabled(false);
    if (state.initialized) {
      setStrategyCollapsed(true);
      setProgress(-1);
    }
    if (nodes.searchEntries) {
      renderEntries();
    }
  }

  function clearEntries() {
    clearRunTimers();
    state.entries = blankEntries();
    state.rankings = {};
    state.importedPeopleBySearch = {};
    state.lastRunEntries = [];
    state.lastSearchPlan = null;
    state.lastRankingPlan = null;
    state.activeRunId = "";
    state.activeWorkerTabId = null;
    state.manualAction = null;
    state.pendingRunEntries = [];
    syncAllEntryCriteria();
    resetProfileSchoolPrefillLock();
    nodes.rankPanel.classList.add("hidden");
    nodes.searchError.classList.remove("is-visible");
    setSearchButtonsDisabled(false);
    setStrategyCollapsed(true);
    setProgress(-1);
    renderEntries();
  }

  function findPersonByUrl(url) {
    const activePerson = (state.rankings[state.activeTab] || [])
      .find((person) => person.profileUrl === url);
    if (activePerson) {
      return activePerson;
    }
    return Object.values(state.rankings)
      .flat()
      .find((person) => person.profileUrl === url);
  }

  function dispatchOpenMessages(profileUrl) {
    const person = findPersonByUrl(profileUrl);
    const rankingPlan = state.lastRankingPlan || {};
    const event = new CustomEvent("lumi-job-demo-open-messages", {
      bubbles: true,
      cancelable: true,
      detail: {
        profileUrl,
        person,
        job: currentJob(),
        objective: "referral or warm support",
        draftContext: {
          jobBrief: rankingPlan.jobBrief || "",
          fitSummary: rankingPlan.fitSummary || "",
          caveats: rankingPlan.caveats || [],
          bestUse: person?.bestUse || "",
          reason: person?.reason || "",
          approachStrategy: person?.approachStrategy || person?.reason || "",
          overallStrategy: rankingPlan.overallStrategy || ""
        }
      }
    });
    const shouldUseFallback = window.dispatchEvent(event);
    if (shouldUseFallback) {
      window.open(profileUrl, "_blank", "noopener,noreferrer");
    }
  }

  function bindEvents() {
    nodes.runSearch.addEventListener("click", () => {
      if (nodes.runSearch.disabled) {
        return;
      }
      openSearchEditor();
    });
    nodes.submitSearch?.addEventListener("click", () => {
      if (nodes.submitSearch.disabled) {
        return;
      }
      runSearch();
    });
    nodes.cancelSearchEdit?.addEventListener("click", async () => {
      await cancelSearchEditor();
    });
    nodes.openWorkerTab?.addEventListener("click", async () => {
      const manualAction = state.manualAction;
      if (!manualAction?.requestId) {
        return;
      }
      try {
        const response = await openBackgroundJobOutreachWorkerTab(manualAction.requestId, manualAction.workerTabId);
        if (response?.workerTabId) {
          state.activeWorkerTabId = response.workerTabId;
          if (state.manualAction) {
            state.manualAction.workerTabId = response.workerTabId;
          }
          renderRunActions();
        }
      } catch (error) {
        nodes.searchError.textContent = error?.message || String(error);
        nodes.searchError.classList.add("is-visible");
      }
    });
    nodes.resumeRun?.addEventListener("click", resumePausedSearch);
    nodes.manualFilters?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-job-demo-remove-manual-filter]");
      if (!button || button.disabled) {
        return;
      }
      const index = Number(button.dataset.jobDemoRemoveManualFilter);
      const filter = state.manualAction?.removableFilters?.[index];
      if (!filter) {
        return;
      }
      resumePausedSearch({ removeFilter: filter });
    });
    nodes.jobRefresh.addEventListener("click", () => {
      const event = new CustomEvent("lumi-job-demo-refresh-context", {
        bubbles: true,
        cancelable: true,
        detail: { job: currentJob() }
      });
      window.dispatchEvent(event);
    });
    nodes.addSearch.addEventListener("click", () => {
      readEntriesFromDom();
      if (state.entries.length >= 3) {
        return;
      }
      state.entries = [...state.entries, defaultSearchEntryForCurrentJob(state.entries.length)];
      syncAllEntryCriteria();
      renderEntries();
    });
    nodes.searchEntries.addEventListener("click", (event) => {
      const toggleButton = event.target.closest("[data-job-demo-filter-toggle]");
      if (toggleButton) {
        event.preventDefault();
        readEntriesFromDom();
        const index = Number(toggleButton.dataset.jobDemoFilterToggle);
        if (state.entries[index]) {
          state.entries[index].filterComposerOpen = !state.entries[index].filterComposerOpen;
          state.entries[index].filterComposerType = "";
          renderEntries();
        }
        return;
      }

      const typeChoiceButton = event.target.closest("[data-job-demo-filter-type-choice]");
      if (typeChoiceButton) {
        event.preventDefault();
        readEntriesFromDom();
        const index = Number(typeChoiceButton.dataset.entry);
        const type = normalizeFilterType(typeChoiceButton.dataset.jobDemoFilterTypeChoice);
        if (state.entries[index] && type) {
          state.entries[index].filterComposerOpen = true;
          state.entries[index].filterComposerType = type;
          renderEntries();
          window.setTimeout(() => {
            nodes.searchEntries.querySelector(`[data-job-demo-filter-input="${index}"]`)?.focus();
          }, 0);
        }
        return;
      }

      const backButton = event.target.closest("[data-job-demo-filter-back]");
      if (backButton) {
        event.preventDefault();
        readEntriesFromDom();
        const index = Number(backButton.dataset.entry);
        if (state.entries[index]) {
          state.entries[index].filterComposerOpen = true;
          state.entries[index].filterComposerType = "";
          renderEntries();
        }
        return;
      }

      const suggestionButton = event.target.closest("[data-job-demo-filter-suggestion]");
      if (suggestionButton) {
        event.preventDefault();
        readEntriesFromDom();
        const index = Number(suggestionButton.dataset.entry);
        const type = normalizeFilterType(suggestionButton.dataset.type || state.entries[index]?.filterComposerType);
        const sourceText = normalizeWhitespace(suggestionButton.dataset.sourceText || suggestionButton.dataset.label);
        if (state.entries[index] && type && sourceText) {
          if (suggestionButton.dataset.jobDemoFilterSuggestion === "cache") {
            upsertEntryFilter(index, type, sourceText, {
              label: normalizeWhitespace(suggestionButton.dataset.label || sourceText),
              id: normalizeWhitespace(suggestionButton.dataset.filterId),
              param: normalizeWhitespace(suggestionButton.dataset.param || filterParamForType(type)),
              state: "resolved",
              origin: "cache"
            });
          } else {
            upsertEntryFilter(index, type, sourceText, { state: "unresolved", origin: "custom" });
          }
          state.entries[index].filterComposerOpen = false;
          state.entries[index].filterComposerType = "";
          renderEntries();
        }
        return;
      }

      const removeFilterButton = event.target.closest("[data-job-demo-filter-remove]");
      if (removeFilterButton) {
        event.preventDefault();
        readEntriesFromDom();
        const entryIndex = Number(removeFilterButton.dataset.entry);
        const filterIndex = Number(removeFilterButton.dataset.jobDemoFilterRemove);
        if (state.entries[entryIndex] && Number.isFinite(filterIndex)) {
          state.entries[entryIndex].filters = state.entries[entryIndex].filters.filter((_pill, pillIndex) => pillIndex !== filterIndex);
          syncEntryCriteria(entryIndex);
        }
        renderEntries();
        return;
      }

      const removeButton = event.target.closest("[data-job-demo-entry-remove]");
      if (removeButton) {
        event.preventDefault();
        readEntriesFromDom();
        const index = Number(removeButton.dataset.jobDemoEntryRemove);
        if (index > 0 && state.entries[index]) {
          state.entries = state.entries.filter((_entry, entryIndex) => entryIndex !== index);
          syncAllEntryCriteria();
        }
        renderEntries();
      }
    });
    nodes.searchEntries.addEventListener("input", (event) => {
      const input = event.target.closest("[data-job-demo-filter-input]");
      if (input) {
        updateFilterSuggestionsForInput(input);
      }
    });
    nodes.searchEntries.addEventListener("focusin", (event) => {
      const input = event.target.closest("[data-job-demo-filter-input]");
      if (input) {
        updateFilterSuggestionsForInput(input);
      }
    });
    nodes.searchEntries.addEventListener("keydown", (event) => {
      const removableFilter = event.target.closest("[data-job-demo-filter-remove]");
      if (removableFilter && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        removableFilter.click();
        return;
      }
      const input = event.target.closest("[data-job-demo-filter-input]");
      if (!input) {
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        updateFilterSuggestionsForInput(input);
        moveActiveFilterSuggestion(input, event.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        hideFilterSuggestionsForInput(input);
        return;
      }
      if (event.key !== "Enter") {
        return;
      }
      event.preventDefault();
      updateFilterSuggestionsForInput(input);
      const activeSuggestion = activeFilterSuggestionForInput(input);
      if (activeSuggestion) {
        activeSuggestion.click();
      }
    });
    document.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) {
        return;
      }
      if (target.closest("[data-job-demo-filter-popover]") || target.closest("[data-job-demo-filter-toggle]")) {
        return;
      }
      closeOpenFilterComposers();
    });
    nodes.rankTabs.addEventListener("click", (event) => {
      const button = event.target.closest("[data-job-demo-tab]");
      if (!button || button.disabled) {
        return;
      }
      state.activeTab = button.dataset.jobDemoTab;
      renderRankTabs();
      renderRankList();
    });
    nodes.rankList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-job-demo-open-messages]");
      if (!button) {
        return;
      }
      dispatchOpenMessages(button.dataset.jobDemoOpenMessages);
    });
    if (globalThis.chrome?.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((message) => {
        const messageTypes = globalThis.LinkedInAssistantShared?.MESSAGE_TYPES || {};
        if (message?.type !== messageTypes.JOB_OUTREACH_PROGRESS) {
          return;
        }
        const previousSelectedRunId = state.selectedRunId;
        const nextState = mergeJobOutreachProgressIntoState(state, message);
        state.runsById = nextState.runsById;
        state.runOrder = nextState.runOrder;
        state.activeRunIds = nextState.activeRunIds;
        state.selectedRunId = nextState.selectedRunId;
        state.selectedRunSource = nextState.selectedRunSource;
        const requestId = normalizeWhitespace(message?.requestId);
        if (typeof message?.workerTabId === "number" && requestId) {
          const run = state.runsById[requestId];
          if (run) {
            state.runsById[requestId] = {
              ...run,
              workerTabId: message.workerTabId
            };
          }
        }
        if (state.pageRunIds.includes(requestId) || !previousSelectedRunId || previousSelectedRunId === requestId) {
          selectJobOutreachRun(requestId, state.pageRunIds.includes(requestId) ? "page" : nextState.selectedRunSource);
        }
        renderRunRegistry();
        renderSelectedRunPanels();
      });
    }
  }

  function applyRuntimeJob(job) {
    const normalized = normalizeJob(job);
    if (!hasRecognizedJob(normalized)) {
      return false;
    }
    const previousJob = currentJob();
    const previousScope = jobScopeKey(previousJob);
    const nextScope = jobScopeKey(normalized);
    const previousTitle = normalizeWhitespace(previousJob.title);
    const previousCompany = normalizeWhitespace(previousJob.company);
    const previousLocation = normalizeWhitespace(previousJob.location);
    const previousJobId = normalizeWhitespace(previousJob.jobId);
    const previousSourceUrl = normalizeWhitespace(previousJob.sourceUrl);
    let changed = false;
    state.runtimeJob = normalized;
    if (previousScope && nextScope && previousScope !== nextScope) {
      resetForCurrentJob();
      return true;
    }
    changed = normalized.jobId !== previousJobId || normalized.sourceUrl !== previousSourceUrl || changed;
    if (normalized.title) {
      changed = seedFirstEntryText(defaultKeywordForCurrentJob(0), previousTitle) || changed;
    }
    const shouldAdoptCompany = normalized.company && (
      !normalizeWhitespace(state.globalCriteria.company)
      || state.globalCriteria.company === previousCompany
    );
    if (shouldAdoptCompany) {
      upsertEntryFilter(0, "company", normalized.company);
      changed = true;
    }
    const shouldAdoptLocation = shouldAdoptJobLocation(previousLocation, normalized.location);
    if (shouldAdoptLocation && normalized.location) {
      upsertEntryFilter(0, "location", normalized.location);
      changed = true;
    }
    if (changed && nodes.searchEntries) {
      renderEntries();
    }
    return true;
  }

  function applyMyProfileDefaults(profile) {
    const schoolText = schoolPrefillFromProfile(profile || state.myProfile);
    if (!schoolText || state.profileSchoolPrefillLocked) {
      return false;
    }
    const shouldAdoptSchools = !normalizeWhitespace(state.globalCriteria.schools);
    if (!shouldAdoptSchools) {
      return false;
    }
    parseCriteriaList(schoolText, "schools").forEach((school) => upsertEntryFilter(0, "school", school));
    lockProfileSchoolPrefill();
    if (nodes.searchEntries) {
      renderEntries();
    }
    return true;
  }

  function applyPeopleSearchContext(peopleSearch) {
    const results = Array.isArray(peopleSearch?.results) ? peopleSearch.results : [];
    if (!results.length) {
      return false;
    }
    const sourceUrl = normalizeWhitespace(peopleSearch.sourceUrl || "");
    const sourceNumber = sourceIndexFromSearchUrl(sourceUrl);
    if (!shouldAcceptPeopleSearchSource(sourceNumber)) {
      return false;
    }
    state.importedPeopleBySearch[String(sourceNumber)] = results;
    const entry = {
      index: sourceNumber - 1,
      text: searchKeywordsFromUrl(sourceUrl) || `Search ${searchLabel(sourceNumber - 1)}`,
      criteria: [],
      url: sourceUrl
    };
    if (!state.lastRunEntries.some((existing) => existing.index === entry.index)) {
      state.lastRunEntries = [...state.lastRunEntries, entry].sort((left, right) => left.index - right.index);
    }
    const entries = state.lastRunEntries.length ? state.lastRunEntries : [entry];
    state.rankings = mergeRankingPlanIntoRankings(entries, buildRankings(entries));
    if (!state.rankings[state.activeTab]?.length) {
      state.activeTab = firstPopulatedRankingTab(state.rankings, String(sourceNumber));
    }
    return true;
  }

  function setRuntimeContext(runtimeContext) {
    const pageContext = runtimeContext?.pageContext || runtimeContext || {};
    if (runtimeContext?.jobOutreachFilterCache) {
      state.filterCache = normalizeFilterCache(runtimeContext.jobOutreachFilterCache);
      rehydrateFilterPillsFromCache();
    }
    state.myProfile = runtimeContext?.myProfile || state.myProfile;
    state.activeTabId = runtimeContext?.activeTabId || pageContext?.tabId || state.activeTabId;
    const jobChanged = pageContext.pageType === "linkedin-job" && applyRuntimeJob(pageContext.job);
    const runsChanged = applyRuntimeJobOutreachRuns(runtimeContext?.jobOutreachRuns);
    const profileChanged = applyMyProfileDefaults(state.myProfile);
    const peopleChanged = pageContext.pageType === "linkedin-people-search" && applyPeopleSearchContext(pageContext.peopleSearch);
    if (!state.initialized) {
      return;
    }
    if (jobChanged || profileChanged || runsChanged) {
      renderJob();
    }
    renderRunRegistry();
    renderSelectedRunPanels();
    if (peopleChanged) {
      renderUrlPreview(state.lastRunEntries);
      nodes.rankPanel.classList.remove("hidden");
      renderRankings();
      setStrategyCollapsed(true, state.lastRunEntries);
    }
  }

  function init() {
    if (state.initialized) {
      return true;
    }
    cacheNodes();
    if (!hasRequiredNodes()) {
      return false;
    }
    state.initialized = true;
    bindEvents();
    renderJob();
    resetForm();
    renderRunRegistry();
    return true;
  }

  function render() {
    if (!init()) {
      return;
    }
    renderJob();
  }

  globalThis.LumiJobOutreachDemo = {
    init,
    render,
    reset: resetForm,
    setRuntimeContext,
    buildSearchPlanAiInput: () => buildSearchPlanAiInput(activeEntries()),
    buildRankingAiInput: () => buildRankingAiInput(state.lastRunEntries),
    getLastSearchPlan: () => state.lastSearchPlan,
    getLastRankingPlan: () => state.lastRankingPlan
  };

  init();
})();
