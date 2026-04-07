(function initSidePanel() {
  const shared = globalThis.LinkedInAssistantShared;
  const prompts = globalThis.LinkedInAssistantPrompts;
  const {
    BUILD_DEBUG_VERSION,
    buildFreshGenerateForRecipientCommand,
    extractOwnProfileName,
    formatConversationTimestampForDisplay,
    MESSAGE_TYPES,
    defaultMyProfile,
    getDashboardReview,
    getDraftWorkspace,
    getObservedConversation,
    getObservedMetrics,
    getProfileContext,
    mergePersonRecord,
    defaultPersonRecord,
    normalizeConnectionStatus,
    normalizeConversationTimestamp,
    normalizeInvestmentDecision,
    normalizeRecommendedAction,
    normalizeResearchRecommendation,
    normalizeRelationshipStage,
    normalizeWhitespace
  } = shared;
  const {
    defaultLlmEntryUrl,
    defaultPromptSettings,
    FIXED_TAIL,
    normalizeLlmEntryUrl,
    normalizeLlmProvider,
    providerDisplayName
  } = prompts;

  const state = {
    pageContext: null,
    activeTabId: null,
    attachedLinkedInTabId: null,
    myProfile: defaultMyProfile(),
    promptSettings: defaultPromptSettings(),
    fixedTail: FIXED_TAIL,
    allPeople: [],
    personRecord: defaultPersonRecord(),
    workspace: null,
    manualRecovery: null,
    extraContext: "",
    lastImportSyncMessage: "",
    lastStatusIsError: false,
    fixedTailSaveTimer: null,
    showingAlternatives: false,
    viewMode: "workspace",
    dashboardSection: "reply_now",
    dashboardFilter: "reply_now",
    dashboardSearch: "",
    dashboardExpanded: {},
    dashboardSort: "priority",
    dashboardActivityWindow: "7d",
    autoRefreshTimer: null,
    ctaReadinessTimer: null,
    ctaReadinessByViewKey: {},
    activeGenerationRequestId: "",
    activeGenerationPersonId: "",
    activeGenerationSourceTabId: null,
    generationProgressText: "",
    generationJobs: [],
    identityWarning: null,
    identityResolutionRequest: null,
    dismissedIdentityResolutionRequestKey: "",
    lastNavigationSignalHref: "",
    lastNavigationSignalAt: "",
    backgroundObservedLinkedInTabId: null,
    backgroundObservedLinkedInTabUrl: "",
    lastLinkedInClickTrace: null,
    pendingLinkedInNavigation: null,
    messagingReload: null,
    lastGenerationDiagnostics: null,
    resolutionDiagnostics: null,
    lastProfileExtractionDiagnostics: null,
    lastSenderProfileSaveDiagnostics: null,
    lastOpenMessagesDiagnostics: null,
    showingSenderProfilePrompt: false,
    conversationHistoryExpanded: false,
    transientMessagingRetryTimer: null,
    transientMessagingRetryCount: 0,
    navigationRefreshTimers: [],
    lastObservedBrowserTabId: null,
    lastObservedBrowserTabUrl: "",
    promptSettingsDirty: false,
    refreshInFlight: false,
    refreshPromise: null,
    pendingRefreshOptions: null,
    refreshCache: {
      key: "",
      savedAt: 0,
      response: null
    },
    blockingUiLoading: false,
    blockingUiLoadingText: "",
    navigationHold: {
      active: false,
      targetUrl: "",
      targetPageType: ""
    },
    statusStateByScope: {},
    statusState: {
      text: "",
      isError: false,
      mode: "",
      source: "ambient",
      updatedAt: 0
    }
  };

  const MESSAGE_THREAD_POLL_MS = 10000;
  const CTA_INITIAL_DISABLE_MS = 1000;

  const el = {
    panelLoadingOverlay: document.querySelector("#panel-loading-overlay"),
    panelLoadingText: document.querySelector("#panel-loading-text"),
    topToolbar: document.querySelector("#top-toolbar"),
    workspaceView: document.querySelector("#workspace-view"),
    statusCard: document.querySelector("#status-card"),
    onboardingSection: document.querySelector("#onboarding-section"),
    recommendationSection: document.querySelector("#recommendation-section"),
    dashboardView: document.querySelector("#dashboard-view"),
    personRecordUuid: document.querySelector("#person-record-uuid"),
    workspaceViewButton: document.querySelector("#workspace-view-button"),
    dashboardViewButton: document.querySelector("#dashboard-view-button"),
    pageStatus: document.querySelector("#page-status"),
    workspaceStatus: document.querySelector("#workspace-status"),
    senderProfilePrompt: document.querySelector("#sender-profile-prompt"),
    senderProfileCopy: document.querySelector("#sender-profile-copy"),
    senderProfileNotesInput: document.querySelector("#sender-profile-notes-input"),
    senderProfileUrlInput: document.querySelector("#sender-profile-url-input"),
    senderProfileProviderSelect: document.querySelector("#sender-profile-provider-select"),
    senderProfileOpenLink: document.querySelector("#sender-profile-open-link"),
    senderProfileUpdateNow: document.querySelector("#sender-profile-update-now"),
    senderProfileOpenSettings: document.querySelector("#sender-profile-open-settings"),
    personName: document.querySelector("#person-name"),
    personSubtitle: document.querySelector("#person-subtitle"),
    connectionStatusPill: document.querySelector("#connection-status-pill"),
    unsupportedPageMessage: document.querySelector("#unsupported-page-message"),
    conversationImportMeta: document.querySelector("#conversation-import-meta"),
    personCardEditButton: document.querySelector("#person-card-edit-button"),
    personCardEditor: document.querySelector("#person-card-editor"),
    settingsButton: document.querySelector("#settings-button"),
    closeSettingsButton: document.querySelector("#close-settings-button"),
    nextActionButton: document.querySelector("#next-action-button"),
    nextHelperButton: document.querySelector("#next-helper-button"),
    updateProfileButton: document.querySelector("#update-profile-button"),
    updateProfileMeta: document.querySelector("#update-profile-meta"),
    importConversationButton: document.querySelector("#import-conversation-button"),
    clearConversationButton: document.querySelector("#clear-conversation-button"),
    lastUpdatedMeta: document.querySelector("#last-updated-meta"),
    fixedTailInput: document.querySelector("#fixed-tail-input"),
    resetFixedTail: document.querySelector("#reset-fixed-tail"),
    actionPill: document.querySelector("#action-pill"),
    actionPillLabel: document.querySelector("#action-pill-label"),
    actionPillGuideTitle: document.querySelector("#action-pill-guide-title"),
    actionPillGuideBody: document.querySelector("#action-pill-guide-body"),
    recommendationReason: document.querySelector("#recommendation-reason"),
    nextStepEvidence: document.querySelector("#next-step-evidence"),
    referralReadiness: document.querySelector("#referral-readiness"),
    draftSection: document.querySelector("#draft-section"),
    toggleAlternativesButton: document.querySelector("#toggle-alternatives-button"),
    primaryDraftLabel: document.querySelector("#primary-draft-label"),
    primaryDraftInput: document.querySelector("#primary-draft-input"),
    primaryDraftMetrics: document.querySelector("#primary-draft-metrics"),
    primaryDraftReason: document.querySelector("#primary-draft-reason"),
    copyPrimaryDraftButton: document.querySelector("#copy-primary-draft-button"),
    alternativeDrafts: document.querySelector("#alternative-drafts"),
    personNoteInput: document.querySelector("#person-note-input"),
    personGoalSelect: document.querySelector("#person-goal-select"),
    extraContextInput: document.querySelector("#extra-context-input"),
    savePersonNoteButton: document.querySelector("#save-person-note-button"),
    recipientSummaryCard: document.querySelector("#recipient-summary-card"),
    recipientProfileMeta: document.querySelector("#recipient-profile-meta"),
    recipientProfileRefreshLink: document.querySelector("#recipient-profile-refresh-link"),
    recipientSummaryText: document.querySelector("#recipient-summary-text"),
    recipientActivityBlock: document.querySelector("#recipient-activity-block"),
    recipientActivityMeta: document.querySelector("#recipient-activity-meta"),
    recipientActivityList: document.querySelector("#recipient-activity-list"),
    conversationCard: document.querySelector("#conversation-card"),
    conversationList: document.querySelector("#conversation-list"),
    contextSection: document.querySelector("#context-section"),
    settingsSection: document.querySelector("#settings-section"),
    promptSettingsForm: document.querySelector("#prompt-settings-form"),
    llmProviderSettingsSelect: document.querySelector("#llm-provider-settings-select"),
    llmProviderUrlInput: document.querySelector("#llm-provider-url-input"),
    senderProfileSettingsUrl: document.querySelector("#sender-profile-settings-url"),
    openSenderProfileLink: document.querySelector("#open-sender-profile-link"),
    savePromptSettingsButton: document.querySelector("#save-prompt-settings-button"),
    factoryResetButton: document.querySelector("#factory-reset-button"),
    senderContextDetails: document.querySelector("#sender-context-details"),
    profileForm: document.querySelector("#profile-form"),
    saveProfileButton: document.querySelector("#save-profile-button"),
    globalLogsPanel: document.querySelector("#global-logs-panel"),
    globalDiagnosticsDetails: document.querySelector("#global-diagnostics-details"),
    globalDiagnosticsSummary: document.querySelector("#global-diagnostics-summary"),
    manualRecoverySection: document.querySelector("#manual-recovery-section"),
    readLatestResponseButton: document.querySelector("#read-latest-response-button"),
    copyTechnicalDetailsButton: document.querySelector("#copy-technical-details-button"),
    clearTechnicalDetailsButton: document.querySelector("#clear-technical-details-button"),
    pageDiagnostics: document.querySelector("#page-diagnostics"),
    senderProfileExtracted: document.querySelector("#sender-profile-extracted"),
    manualPrompt: document.querySelector("#manual-prompt"),
    manualRawOutput: document.querySelector("#manual-raw-output"),
    strategyGuidance: document.querySelector("#strategy-guidance"),
    dashboardMeta: document.querySelector("#dashboard-meta"),
    dashboardExportCsv: document.querySelector("#dashboard-export-csv"),
    dashboardActivityWindowToday: document.querySelector("#dashboard-activity-window-today"),
    dashboardActivityWindow7d: document.querySelector("#dashboard-activity-window-7d"),
    dashboardActivityOutreachCount: document.querySelector("#dashboard-activity-outreach-count"),
    dashboardActivityOutreachDelta: document.querySelector("#dashboard-activity-outreach-delta"),
    dashboardActivityRepliesCount: document.querySelector("#dashboard-activity-replies-count"),
    dashboardActivityRepliesDelta: document.querySelector("#dashboard-activity-replies-delta"),
    dashboardActivityActiveCount: document.querySelector("#dashboard-activity-active-count"),
    dashboardActivityActiveDelta: document.querySelector("#dashboard-activity-active-delta"),
    dashboardSummaryNeedsAction: document.querySelector("#dashboard-summary-needs-action"),
    dashboardSummaryFollowUp: document.querySelector("#dashboard-summary-follow-up"),
    dashboardSummaryWarm: document.querySelector("#dashboard-summary-warm"),
    dashboardSummaryWaiting: document.querySelector("#dashboard-summary-waiting"),
    dashboardSummaryDeprioritize: document.querySelector("#dashboard-summary-deprioritize"),
    dashboardFilterSelect: document.querySelector("#dashboard-filter-select"),
    dashboardSortSelect: document.querySelector("#dashboard-sort-select"),
    dashboardList: document.querySelector("#dashboard-list")
  };

  function setPersonCardEditorOpen(isOpen) {
    el.personCardEditor?.classList.toggle("hidden", !isOpen);
    if (el.personCardEditButton) {
      el.personCardEditButton.textContent = isOpen ? "Hide" : "Edit";
    }
  }

  const profileFields = {
    manualNotes: document.querySelector("#profile-manual-notes"),
    rawSnapshot: document.querySelector("#profile-raw-snapshot")
  };

  function setLoading(button, loadingText, isLoading) {
    if (!button) {
      return;
    }
    if (isLoading) {
      if (!button.dataset.defaultLabel) {
        button.dataset.defaultLabel = button.textContent;
      }
      button.dataset.loading = "true";
      button.disabled = true;
      button.textContent = loadingText;
      return;
    }
    button.disabled = false;
    const nextLabel = button.dataset.pendingLabel || button.dataset.defaultLabel || button.textContent;
    button.textContent = nextLabel;
    button.dataset.defaultLabel = nextLabel;
    delete button.dataset.pendingLabel;
    delete button.dataset.loading;
  }

  function setButtonLabel(button, label) {
    if (!button) {
      return;
    }
    const nextLabel = normalizeWhitespace(label) || button.textContent || "";
    if (button.dataset.loading === "true") {
      button.dataset.pendingLabel = nextLabel;
      return;
    }
    button.textContent = nextLabel;
    button.dataset.defaultLabel = nextLabel;
  }

  function applyStatusState() {
    const normalized = normalizeWhitespace(state.statusState?.text);
    const isError = Boolean(state.statusState?.isError);
    const mode = normalizeWhitespace(state.statusState?.mode);
    el.pageStatus.textContent = normalized;
    el.pageStatus.classList.toggle("hidden", !normalized);
    el.pageStatus.classList.toggle("error-text", isError && Boolean(normalized));
    el.pageStatus.classList.toggle("progress-text", !isError && mode === "progress" && Boolean(normalized));
    el.pageStatus.classList.toggle("warning-text", !isError && mode === "warning" && Boolean(normalized));
  }

  function statusScopeKeyFromIdentity(identity) {
    if (!identity) {
      return "";
    }
    const tabId = Number.isInteger(identity.tabId) ? identity.tabId : 0;
    const personId = normalizeWhitespace(identity.personId);
    const pageType = normalizeWhitespace(identity.pageType);
    const pageUrl = normalizeWhitespace(identity.pageUrl);
    const threadUrl = normalizeWhitespace(identity.threadUrl);
    return [tabId, personId, pageType, pageUrl, threadUrl].join("::");
  }

  function currentStatusScopeKey() {
    return statusScopeKeyFromIdentity(currentViewIdentity());
  }

  function restoreStatusStateForCurrentScope() {
    const scopeKey = currentStatusScopeKey();
    const scoped = (scopeKey && state.statusStateByScope?.[scopeKey]) || null;
    state.statusState = scoped
      ? { ...scoped }
      : {
        text: "",
        isError: false,
        mode: "",
        source: "ambient",
        updatedAt: 0
      };
    applyStatusState();
  }

  function setBlockingUiLoading(isLoading, text) {
    state.blockingUiLoading = Boolean(isLoading);
    state.blockingUiLoadingText = normalizeWhitespace(text || "") || "Loading LinkedIn data…";
    if (el.panelLoadingText) {
      el.panelLoadingText.textContent = state.blockingUiLoadingText;
    }
    el.panelLoadingOverlay?.classList.toggle("hidden", !state.blockingUiLoading);
    if (el.panelLoadingOverlay) {
      el.panelLoadingOverlay.setAttribute("aria-hidden", state.blockingUiLoading ? "false" : "true");
    }
  }

  function setStatus(text, isError, mode, options) {
    const normalized = normalizeWhitespace(text);
    const source = normalizeWhitespace(options?.source || "direct") || "direct";
    const current = state.statusState || {};
    const currentText = normalizeWhitespace(current.text);
    const currentIsSticky = Boolean(currentText) && normalizeWhitespace(current.source) !== "ambient";
    const currentAgeMs = current.updatedAt ? (Date.now() - current.updatedAt) : Number.POSITIVE_INFINITY;
    if (source === "ambient") {
      if (!normalized && currentIsSticky) {
        return;
      }
      if (currentIsSticky && currentAgeMs < 5000) {
        return;
      }
    }
    state.lastStatusIsError = Boolean(isError);
    state.statusState = {
      text: normalized,
      isError: Boolean(isError),
      mode: normalizeWhitespace(mode),
      source,
      updatedAt: Date.now()
    };
    const scopeKey = normalizeWhitespace(options?.scopeKey || currentStatusScopeKey());
    if (scopeKey) {
      state.statusStateByScope = {
        ...(state.statusStateByScope || {}),
        [scopeKey]: { ...state.statusState }
      };
    }
    applyStatusState();
  }

  function configuredOwnProfileUrl() {
    return normalizeWhitespace(
      el.senderProfileUrlInput?.value
      || state.myProfile?.ownProfileUrl
      || ""
    );
  }

  function configuredSenderManualNotes() {
    const setupValue = typeof el.senderProfileNotesInput?.value === "string" ? el.senderProfileNotesInput.value : "";
    const contextValue = typeof profileFields.manualNotes?.value === "string" ? profileFields.manualNotes.value : "";
    if (document.activeElement === el.senderProfileNotesInput) {
      return normalizeWhitespace(setupValue);
    }
    if (document.activeElement === profileFields.manualNotes) {
      return normalizeWhitespace(contextValue);
    }
    if (normalizeWhitespace(contextValue)) {
      return normalizeWhitespace(contextValue);
    }
    if (normalizeWhitespace(setupValue)) {
      return normalizeWhitespace(setupValue);
    }
    if (typeof profileFields.manualNotes?.value === "string") {
      return normalizeWhitespace(contextValue);
    }
    if (typeof el.senderProfileNotesInput?.value === "string") {
      return normalizeWhitespace(setupValue);
    }
    return normalizeWhitespace(state.myProfile?.manualNotes || "");
  }

  function normalizedOwnProfileUrl() {
    return normalizeWhitespace(state.myProfile?.ownProfileUrl || "");
  }

  function normalizedPendingProfileUrl() {
    return normalizeWhitespace(state.myProfile?.pendingProfileUrl || "");
  }

  function currentProfileUrl() {
    return normalizeWhitespace(
      state.pageContext?.profile?.profileUrl
      || state.pageContext?.person?.profileUrl
      || (state.pageContext?.pageType === "linkedin-profile" ? state.pageContext?.pageUrl : "")
      || state.personRecord?.profileUrl
      || ""
    );
  }

  function isSavedOwnProfilePage() {
    const ownProfileUrl = normalizedOwnProfileUrl();
    const pageUrl = currentProfileUrl();
    return Boolean(
      ownProfileUrl
      && pageUrl
      && ownProfileUrl.replace(/\/+$/, "") === pageUrl.replace(/\/+$/, "")
    );
  }

  function isPendingOwnProfilePage() {
    const pendingProfileUrl = normalizedPendingProfileUrl();
    const pageUrl = currentProfileUrl();
    return Boolean(
      pendingProfileUrl
      && pageUrl
      && pendingProfileUrl.replace(/\/+$/, "") === pageUrl.replace(/\/+$/, "")
    );
  }

  function isOwnProfilePage() {
    const ownProfileUrl = configuredOwnProfileUrl();
    const pageUrl = currentProfileUrl();
    return Boolean(
      ownProfileUrl
      && pageUrl
      && ownProfileUrl.replace(/\/+$/, "") === pageUrl.replace(/\/+$/, "")
    );
  }

  function canUpdateSenderProfileNow() {
    return state.pageContext?.pageType === "linkedin-profile" && Boolean(currentProfileUrl());
  }

  function canCaptureCurrentProfilePage() {
    return state.pageContext?.pageType === "linkedin-profile" && Boolean(currentProfileUrl());
  }

  function hasSavedSenderProfile() {
    return Boolean(
      normalizeWhitespace(state.myProfile?.ownProfileUrl)
      && normalizeWhitespace(state.myProfile?.rawSnapshot)
    );
  }

  function renderSenderProfilePrompt() {
    const hasSavedProfile = hasSavedSenderProfile();
    const onSavedOwnProfilePage = isSavedOwnProfilePage();
    const onPendingOwnProfilePage = isPendingOwnProfilePage();
    const shouldShowPrompt = !hasSavedProfile || onSavedOwnProfilePage || onPendingOwnProfilePage;
    state.showingSenderProfilePrompt = shouldShowPrompt;
    el.onboardingSection?.classList.toggle("hidden", !shouldShowPrompt);
    if (!shouldShowPrompt || !el.senderProfilePrompt) {
      return;
    }
    const ownProfileUrl = normalizeWhitespace(el.senderProfileUrlInput?.value || configuredOwnProfileUrl());
    const currentPageUrl = currentProfileUrl();
    const normalizedOwnProfileUrl = ownProfileUrl.replace(/\/+$/, "");
    const normalizedCurrentPageUrl = normalizeWhitespace(currentPageUrl).replace(/\/+$/, "");
    const pastedUrlMatchesCurrentPage = Boolean(
      normalizedOwnProfileUrl
      && normalizedCurrentPageUrl
      && normalizedOwnProfileUrl === normalizedCurrentPageUrl
    );
    const onAnyProfilePage = canCaptureCurrentProfilePage();
    const canUseCurrentPage = onAnyProfilePage && (!ownProfileUrl || pastedUrlMatchesCurrentPage);
    const hasConfiguredProfileUrl = Boolean(ownProfileUrl);
    const canOpenTargetProfile = hasConfiguredProfileUrl && !pastedUrlMatchesCurrentPage;
    let promptCopy = "";
    let primaryLabel = "";
    let primaryDisabled = false;
    let secondaryLabel = "Go to profile";
    let secondaryHidden = !hasConfiguredProfileUrl;
    let secondaryDisabled = !hasConfiguredProfileUrl;

    if (el.senderProfileUrlInput && document.activeElement !== el.senderProfileUrlInput) {
      el.senderProfileUrlInput.value = ownProfileUrl;
    }
    if (el.senderProfileNotesInput && document.activeElement !== el.senderProfileNotesInput) {
      el.senderProfileNotesInput.value = state.myProfile?.manualNotes || "";
    }
    if (el.senderProfileSettingsUrl && document.activeElement !== el.senderProfileSettingsUrl) {
      el.senderProfileSettingsUrl.value = ownProfileUrl;
    }

    if (onPendingOwnProfilePage) {
      promptCopy = "Update this page to switch your saved profile.";
      primaryLabel = "Update this page";
      primaryDisabled = !canUpdateSenderProfileNow();
    } else if (onSavedOwnProfilePage) {
      promptCopy = hasSavedProfile
        ? "Refresh your saved profile from this page."
        : "You are on your profile. Save it once.";
      primaryLabel = hasSavedProfile ? "Refresh my profile" : "Save my profile now";
      primaryDisabled = !canUpdateSenderProfileNow();
    } else if (canOpenTargetProfile) {
      promptCopy = hasSavedProfile
        ? "Open the pasted profile to switch your saved profile."
        : "Open the pasted profile, then use this page.";
      primaryLabel = onAnyProfilePage ? "Use this page" : "Update profile";
      primaryDisabled = true;
    } else if (canUseCurrentPage) {
      promptCopy = "If this is your profile, use this page.";
      primaryLabel = "Use this page";
      primaryDisabled = !(canUpdateSenderProfileNow() || canUseCurrentPage);
    } else {
      promptCopy = "Paste your profile URL and open it.";
      primaryLabel = onAnyProfilePage ? "Update this page" : "Update profile";
      primaryDisabled = !canUpdateSenderProfileNow();
    }

    if (onSavedOwnProfilePage && hasConfiguredProfileUrl) {
      secondaryHidden = false;
      secondaryDisabled = false;
      secondaryLabel = "Go to profile";
    } else if (canOpenTargetProfile) {
      secondaryHidden = false;
      secondaryDisabled = false;
      secondaryLabel = "Go to profile";
    }

    el.senderProfileCopy.textContent = promptCopy;
    el.senderProfileUpdateNow.disabled = primaryDisabled;
    setButtonLabel(el.senderProfileUpdateNow, primaryLabel);
    el.senderProfileOpenLink.disabled = secondaryDisabled;
    el.senderProfileOpenLink.classList.toggle("hidden", secondaryHidden);
    setButtonLabel(el.senderProfileOpenLink, secondaryLabel);
  }

  if (el.readLatestResponseButton) {
    el.readLatestResponseButton.classList.add("hidden");
  }

  function makeRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function autosizeTextarea(textarea) {
    if (!(textarea instanceof HTMLTextAreaElement)) {
      return;
    }
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
  }

  function formatSavedAt(value) {
    if (!value) {
      return "";
    }
    return new Date(value).toLocaleString([], {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function formatRelativeTimestamp(value) {
    if (!value) {
      return "";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    const diffMs = Math.max(0, Date.now() - date.getTime());
    const diffMinutes = Math.round(diffMs / 60000);
    if (diffMinutes <= 1) {
      return "just now";
    }
    if (diffMinutes < 60) {
      return `${diffMinutes}m ago`;
    }
    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24) {
      return `${diffHours}h ago`;
    }
    const diffDays = Math.round(diffHours / 24);
    if (diffDays < 7) {
      return `${diffDays}d ago`;
    }
    return formatSavedAt(value);
  }

  function countWords(text) {
    const normalized = normalizeWhitespace(text);
    return normalized ? normalized.split(/\s+/).length : 0;
  }

  function draftMetricsText(text) {
    const value = String(text || "");
    return `${value.length} chars • ${countWords(value)} words`;
  }

  function renderPrimaryDraftMetrics() {
    if (!el.primaryDraftMetrics) {
      return;
    }
    el.primaryDraftMetrics.textContent = draftMetricsText(el.primaryDraftInput?.value || "");
  }

  function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function cleanHeaderName(value) {
    const normalized = normalizeWhitespace(value);
    if (!normalized) {
      return "";
    }

    const firstSegment = normalized.split(/\s*[|·]\s*/)[0].trim();
    const words = firstSegment.split(/\s+/).filter(Boolean);
    const roleKeywordPattern = /\b(product|leader|manager|director|founder|revenue|commercialization|strategy|advisor|engineer|designer|chief|staff|operator|investor|commercial|growth|marketing|sales|recruiter|program|data|ai)\b/i;
    if (words.length <= 3 && !roleKeywordPattern.test(firstSegment)) {
      return firstSegment;
    }

    const kept = [];
    for (let index = 0; index < words.length; index += 1) {
      const word = words[index];
      const cleaned = word.replace(/[^A-Za-z'’-]/g, "");
      const looksLikeNameToken = /^[A-Z][a-zA-Z'’-]*$/.test(cleaned) || /^[A-Z]\.?$/.test(cleaned);
      const nextLooksLikeRole = roleKeywordPattern.test(word) || /^[A-Z]{2,}$/.test(cleaned);
      if ((nextLooksLikeRole && kept.length >= 2) || (!looksLikeNameToken && kept.length >= 2)) {
        break;
      }
      if (looksLikeNameToken) {
        kept.push(word);
      }
      if (kept.length >= 3) {
        break;
      }
    }

    if (kept.length >= 2) {
      return kept.join(" ").trim();
    }

    return words.slice(0, Math.min(2, words.length)).join(" ").trim() || firstSegment;
  }

  function fallbackProfileNameFromPageContext() {
    const pageTitleName = cleanHeaderName(
      normalizeWhitespace(String(state.pageContext?.title || "").split("|")[0])
    );
    if (pageTitleName && pageTitleName.toLowerCase() !== "linkedin") {
      return pageTitleName;
    }
    const pageUrl = normalizeWhitespace(state.pageContext?.pageUrl || "");
    if (!pageUrl || !/linkedin\.com\/in\//i.test(pageUrl)) {
      return "";
    }
    try {
      const url = new URL(pageUrl);
      const parts = url.pathname.split("/").filter(Boolean);
      const slug = parts[0] === "in" ? parts[1] : "";
      if (!slug || /^ACo/i.test(slug)) {
        return "";
      }
      return cleanHeaderName(
        slug
          .split("-")
          .filter(Boolean)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" ")
      );
    } catch (_error) {
      return "";
    }
  }

  function cleanHeaderSubtitle(value, displayName) {
    const normalized = normalizeWhitespace(value);
    if (!normalized) {
      return "";
    }

    const withoutName = displayName
      ? normalized.replace(new RegExp(`^${escapeRegExp(displayName)}\\s*(?:[-|·:]+\\s*)?`, "i"), "")
      : normalized;
    const cleaned = normalizeWhitespace(withoutName);
    return cleaned && cleaned.toLowerCase() !== normalizeWhitespace(displayName).toLowerCase() ? cleaned : "";
  }

  function extractSubtitleFromProfileSummary(summary, displayName) {
    const lines = String(summary || "")
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => cleanHeaderSubtitle(line, displayName))
      .filter(Boolean);
    return lines[0] || "";
  }

  function extractSubtitleFromRawSnapshot(rawSnapshot, displayName) {
    const text = String(rawSnapshot || "");
    if (!text) {
      return "";
    }

    const topCardBlockMatch = text.match(/Top card:\s*([\s\S]*?)(?:\n\n|$)/i);
    const topCardText = topCardBlockMatch ? topCardBlockMatch[1] : text;
    const lineCandidates = topCardText
      .replace(/\s*\|\s*/g, "\n")
      .split("\n")
      .map((segment) => cleanHeaderSubtitle(segment, displayName))
      .filter(Boolean)
      .filter((segment) => !/^(contact info|message|connect|follow)$/i.test(segment))
      .filter((segment) => !/(united states|area|county|province|contact info)/i.test(segment))
      .filter((segment) => segment.length <= 140)
      .filter((segment) => !/[.!?]\s+[A-Z]/.test(segment));

    const best = lineCandidates.find((segment) =>
      /(manager|director|founder|student|mba|som|program|product|engineer|strategy|marketing|sales|ads|platform|banking|fintech|ai|risk|fraud|yale)/i.test(segment)
    );
    return best || lineCandidates[0] || "";
  }

  function relativeAgeLabel(days) {
    if (days === null || days === undefined || Number.isNaN(days)) {
      return "";
    }
    if (days <= 0) {
      return "today";
    }
    if (days === 1) {
      return "1 day ago";
    }
    if (days < 7) {
      return `${days} days ago`;
    }
    if (days < 30) {
      const weeks = Math.floor(days / 7);
      return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
    }
    if (days < 365) {
      const months = Math.floor(days / 30);
      return `${months} month${months === 1 ? "" : "s"} ago`;
    }
    const years = Math.floor(days / 365);
    return `${years} year${years === 1 ? "" : "s"} ago`;
  }

  function stageLabel(value) {
    switch (normalizeRelationshipStage(value)) {
      case "cold_sent":
        return "Reached out";
      case "no_reply":
        return "Reached out";
      case "engaged":
        return "Engaged";
      case "warm":
        return "Warm";
      case "ready_for_referral":
        return "Referral-ready";
      case "new":
      default:
        return "New target";
    }
  }

  function personViewKey(person, conversation) {
    return normalizeWhitespace(
      conversation?.threadUrl
      || conversation?.recipientName
      || person?.personId
      || person?.profileUrl
      || person?.fullName
      || ""
    ).toLowerCase();
  }

  function currentCtaViewKey() {
    return personViewKey(state.personRecord, state.pageContext?.conversation)
      || personViewKey(state.pageContext?.person, state.pageContext?.conversation)
      || normalizeWhitespace(state.pageContext?.pageUrl || "").toLowerCase();
  }

  function clearCtaReadinessTimer() {
    window.clearTimeout(state.ctaReadinessTimer);
    state.ctaReadinessTimer = null;
  }

  function scheduleCtaReadinessRefresh(delayMs) {
    clearCtaReadinessTimer();
    if (!(delayMs > 0)) {
      return;
    }
    state.ctaReadinessTimer = window.setTimeout(() => {
      state.ctaReadinessTimer = null;
      renderPageStatus({ preserveStatus: true });
    }, delayMs);
  }

  function touchCtaReadiness(viewKey) {
    const normalizedViewKey = normalizeWhitespace(viewKey).toLowerCase();
    if (!normalizedViewKey) {
      return null;
    }
    const existing = state.ctaReadinessByViewKey?.[normalizedViewKey];
    if (existing) {
      return existing;
    }
    const nextEntry = {
      firstSeenAt: Date.now(),
      ready: false,
      personId: ""
    };
    state.ctaReadinessByViewKey = {
      ...(state.ctaReadinessByViewKey || {}),
      [normalizedViewKey]: nextEntry
    };
    scheduleCtaReadinessRefresh(CTA_INITIAL_DISABLE_MS);
    return nextEntry;
  }

  function markCtaReady(viewKey, personId) {
    const normalizedViewKey = normalizeWhitespace(viewKey).toLowerCase();
    if (!normalizedViewKey) {
      return;
    }
    state.ctaReadinessByViewKey = {
      ...(state.ctaReadinessByViewKey || {}),
      [normalizedViewKey]: {
        firstSeenAt: state.ctaReadinessByViewKey?.[normalizedViewKey]?.firstSeenAt || Date.now(),
        ready: true,
        personId: normalizeWhitespace(personId)
      }
    };
    clearCtaReadinessTimer();
  }

  function ctaReadyFromCache(viewKey) {
    const normalizedViewKey = normalizeWhitespace(viewKey).toLowerCase();
    if (!normalizedViewKey) {
      return false;
    }
    return Boolean(state.ctaReadinessByViewKey?.[normalizedViewKey]?.ready);
  }

  function currentNextStepPerson() {
    const preview = previewPersonRecord(state.pageContext, state.personRecord);
    return resolveEffectivePersonRecord(preview, state.pageContext?.conversation);
  }

  function hasRecipientProfileSnapshot(person) {
    const record = resolveEffectivePersonRecord(person || state.personRecord, state.pageContext?.conversation);
    const profileContext = record?.profileContext || {};
    return Boolean(
      normalizeWhitespace(profileContext.profileCaptureMode) === "full"
      && (normalizeWhitespace(profileContext.lastProfileSyncedAt) || normalizeWhitespace(record?.lastProfileSyncedAt))
      && (
        normalizeWhitespace(profileContext.rawSnapshot)
        || normalizeWhitespace(profileContext.profileSummary)
        || profileContext.latestProfileData
      )
    );
  }

  function hasSavedMessageHistory(person) {
    const observedConversation = currentObservedConversation(person);
    return Boolean(
      Array.isArray(observedConversation?.messages) && observedConversation.messages.length
    ) || Boolean(
      normalizeWhitespace(observedConversation?.rawThreadText)
      || normalizeWhitespace(observedConversation?.importedAt)
      || normalizeWhitespace(observedConversation?.lastMessageAt)
    );
  }

  function hasVisibleMessagingThread() {
    const conversation = state.pageContext?.conversation || {};
    return state.pageContext?.pageType === "linkedin-messaging" && Boolean(
      normalizeWhitespace(conversation.threadUrl)
      || normalizeWhitespace(conversation.recipientName)
      || (Array.isArray(conversation.recentMessages) && conversation.recentMessages.length)
      || (Array.isArray(conversation.allVisibleMessages) && conversation.allVisibleMessages.length)
    );
  }

  function currentThreadUrl(person) {
    return normalizeWhitespace(
      state.pageContext?.conversation?.threadUrl
      || (state.pageContext?.pageType === "linkedin-messaging" ? state.pageContext?.pageUrl : "")
      || person?.messagingThreadUrl
      || state.personRecord?.messagingThreadUrl
      || ""
    );
  }

  function currentRecipientProfileUrl(person) {
    return normalizeWhitespace(
      person?.profileUrl
      || state.pageContext?.person?.profileUrl
      || state.pageContext?.profile?.profileUrl
      || currentProfileUrl()
      || state.personRecord?.profileUrl
      || ""
    );
  }

  function canRefreshCurrentRecipientProfile(person) {
    const profileUrl = currentRecipientProfileUrl(person);
    return state.pageContext?.pageType === "linkedin-profile"
      && !isOwnProfilePage()
      && Boolean(profileUrl)
      && hasRecipientProfileSnapshot(person);
  }

  function nextStepEvidence(person) {
    const profileReady = hasRecipientProfileSnapshot(person);
    const messageReady = hasSavedMessageHistory(person);
    return [
      profileReady
        ? {
            label: "Profile saved",
            tone: "neutral",
            action: canRefreshCurrentRecipientProfile(person) ? "refresh_profile_context" : ""
          }
        : {
            label: "Profile missing",
            tone: "warning"
          },
      messageReady
        ? {
            label: "Chats synced",
            tone: "neutral"
          }
        : {
            label: "Chats not synced",
            tone: "warning"
          }
    ].filter(Boolean);
  }

  function currentNextStepState() {
    const person = currentNextStepPerson();
    const profileReady = hasRecipientProfileSnapshot(person);
    const messageReady = hasSavedMessageHistory(person);
    const visibleThread = hasVisibleMessagingThread();
    const profileUrl = currentRecipientProfileUrl(person);
    const threadUrl = currentThreadUrl(person);
    const connectionStatus = currentConnectionStatus();
    const action = currentAction();
    const readyReason = normalizeWhitespace(currentDraftWorkspace(person)?.reason_why_now);
    const pageType = state.pageContext?.pageType || "";
    const onRecipientProfilePage = pageType === "linkedin-profile" && Boolean(profileUrl) && !isOwnProfilePage();
    const helperProfileAction = profileUrl && !onRecipientProfilePage
      ? { label: "Open profile", mode: "open_profile", disabled: false, targetUrl: profileUrl }
      : null;
    const helperThreadAction = threadUrl && pageType !== "linkedin-messaging"
      ? { label: "Open thread", mode: "open_thread", disabled: false, targetUrl: threadUrl }
      : null;
    const draftAction = { label: nextActionLabel("draft_first_message", person), mode: "draft", disabled: false };

    if (!profileReady) {
      return {
        badgeLabel: "Profile needed",
        reason: "Save profile context first so the assistant knows who this person is.",
        primary: onRecipientProfilePage
          ? { label: "Refresh profile context", mode: "refresh_profile_context", disabled: false }
          : { label: "Open profile", mode: "open_profile", disabled: !profileUrl, targetUrl: profileUrl },
        helper: onRecipientProfilePage ? helperThreadAction : null,
        evidence: nextStepEvidence(person),
        statusText: ""
      };
    }

    if (!messageReady) {
      if (visibleThread) {
        return {
          badgeLabel: "Thread needed",
          reason: "Profile is saved. Import the visible thread to tailor the next touch.",
          primary: { label: "Import conversation", mode: "import_conversation", disabled: false },
          helper: helperProfileAction,
          evidence: nextStepEvidence(person),
          statusText: ""
        };
      }

      if (connectionStatus === "connected" && helperThreadAction) {
        return {
          badgeLabel: "Thread needed",
          reason: "Profile is saved. Open the thread before deciding the next touch.",
          primary: { label: "Open thread", mode: "open_thread", disabled: false, targetUrl: threadUrl },
          helper: helperProfileAction,
          evidence: nextStepEvidence(person),
          statusText: ""
        };
      }

      if (connectionStatus === "connected") {
        return {
          badgeLabel: "No thread yet",
          reason: "You are connected. Open messages if you want to check for an existing thread before drafting.",
          primary: { label: "Open messages", mode: "open_messages", disabled: !profileUrl, targetUrl: profileUrl },
          helper: draftAction,
          evidence: nextStepEvidence(person),
          statusText: ""
        };
      }

      return {
        badgeLabel: "Ready to draft",
        reason: "Profile is saved. You can draft a first message now.",
        primary: draftAction,
        helper: helperThreadAction || helperProfileAction,
        evidence: nextStepEvidence(person),
        statusText: ""
      };
    }

    return {
      badgeLabel: action === "draft_reply"
        ? "Ready to reply"
        : action === "draft_follow_up"
          ? "Ready to follow up"
          : action === "wait"
            ? "Waiting"
            : "Ready to draft",
      reason: readyReason || relationshipRead(person),
      primary: { label: nextActionLabel(action, person), mode: "draft", disabled: false },
      helper: helperThreadAction || helperProfileAction,
      evidence: nextStepEvidence(person),
      statusText: readyReason ? "" : relationshipManagementRead()
    };
  }

  function currentActionPillGuide(label) {
    switch (normalizeWhitespace(label)) {
      case "Profile needed":
        return {
          title: "Profile needed",
          body: [
            `<p><span class="pill-info__label">What it is:</span> you do not have enough signal to act with precision.</p>`,
            `<p><span class="pill-info__label">What to do:</span> save the profile first. <mark class="inline-highlight">Do not draft yet</mark>.</p>`
          ].join("")
        };
      case "Thread needed":
        return {
          title: "Thread needed",
          body: [
            `<p><span class="pill-info__label">What it is:</span> a conversation likely exists, but the assistant has not seen the interaction pattern.</p>`,
            `<p><span class="pill-info__label">What to do:</span> open or import the thread before choosing tone, pressure, or timing.</p>`
          ].join("")
        };
      case "No thread yet":
        return {
          title: "No thread yet",
          body: [
            `<p><span class="pill-info__label">What it is:</span> there is no saved message history for this relationship.</p>`,
            `<p><span class="pill-info__label">What to do:</span> check messages once. If nothing exists, send a crisp first note with one clear reason.</p>`
          ].join("")
        };
      case "Ready to draft":
        return {
          title: "Ready to draft",
          body: [
            `<p><span class="pill-info__label">What it is:</span> context is strong enough for a first move.</p>`,
            `<p><span class="pill-info__label">What to do:</span> send a concise, relevant opener.</p>`,
            `<p class="pill-info__note"><span class="pill-info__label">Example:</span> tier 1 executive target, profile saved, no prior thread. Lead with relevance, not enthusiasm.</p>`
          ].join("")
        };
      case "Ready to reply":
        return {
          title: "Ready to reply",
          body: [
            `<p><span class="pill-info__label">What it is:</span> they engaged and the ball is in your court.</p>`,
            `<p><span class="pill-info__label">What to do:</span> reply promptly, answer their point directly, and advance only one step.</p>`
          ].join("")
        };
      case "Ready to follow up":
        return {
          title: "Ready to follow up",
          body: [
            `<p><span class="pill-info__label">What it is:</span> you already opened the thread, and another touch is now justified.</p>`,
            `<p><span class="pill-info__label">What to do:</span> send one measured nudge tied to timing, progress, or a new reason to re-engage.</p>`
          ].join("")
        };
      case "Waiting":
        return {
          title: "Waiting",
          body: [
            `<p><span class="pill-info__label pill-info__label--warning">What it is:</span> restraint is the highest-quality move right now.</p>`,
            `<p><span class="pill-info__label">What to do:</span> <mark class="inline-highlight">Do not send another message yet</mark>. Wait for more time, a better trigger, or their reply.</p>`,
            `<p class="pill-info__note pill-info__note--warning"><span class="pill-info__label pill-info__label--warning">Expert read:</span> forcing momentum too early lowers status and weakens trust.</p>`
          ].join("")
        };
      default:
        return {
          title: normalizeWhitespace(label) || "Next step",
          body: [
            `<p><span class="pill-info__label">What it is:</span> the assistant's current read on the best next move.</p>`,
            `<p><span class="pill-info__label">What to do:</span> follow the recommended action and avoid adding pressure without new signal.</p>`
          ].join("")
        };
    }
  }

  function renderActionPillGuide(label) {
    const guide = currentActionPillGuide(label);
    if (el.actionPillGuideTitle) {
      el.actionPillGuideTitle.textContent = guide.title;
    }
    if (el.actionPillGuideBody) {
      el.actionPillGuideBody.innerHTML = guide.body;
    }
  }

  function shouldDisableNextActionButton(options) {
    if (options?.forceDisabled) {
      return true;
    }
    const nextStep = options?.nextStep || currentNextStepState();
    if (!nextStep?.primary || nextStep.primary.disabled) {
      return true;
    }
    if (nextStep.primary.mode !== "draft") {
      return false;
    }

    const viewKey = currentCtaViewKey();
    const readiness = touchCtaReadiness(viewKey);
    const person = currentNextStepPerson();
    const hasResolvedPersonId = Boolean(normalizeWhitespace(person?.personId));
    if (hasResolvedPersonId) {
      markCtaReady(viewKey, person.personId);
      return !hasRecipientProfileSnapshot(person);
    }
    if (ctaReadyFromCache(viewKey)) {
      return false;
    }
    if (!readiness) {
      return true;
    }
    const ageMs = Date.now() - Number(readiness.firstSeenAt || 0);
    if (ageMs < CTA_INITIAL_DISABLE_MS) {
      scheduleCtaReadinessRefresh(CTA_INITIAL_DISABLE_MS - ageMs);
      return true;
    }
    return true;
  }

  function previewPersonRecord(pageContext, fallbackRecord) {
    const preview = pageContext?.person || {};
    const fallback = fallbackRecord || defaultPersonRecord();
    const conversationRecipientName = normalizeWhitespace(pageContext?.conversation?.recipientName);
    const previewName = normalizeWhitespace(preview.fullName);
    const shouldTrustConversationName = Boolean(
      conversationRecipientName
      && (!previewName || previewName.toLowerCase() !== conversationRecipientName.toLowerCase())
    );
    const fullName = normalizeWhitespace(
      shouldTrustConversationName ? conversationRecipientName : (previewName || conversationRecipientName || fallback.fullName)
    );
    return {
      ...defaultPersonRecord(),
      ...fallback,
      personId: normalizeWhitespace((shouldTrustConversationName ? "" : preview.personId) || fallback.personId),
      fullName,
      firstName: normalizeWhitespace(preview.firstName || fallback.firstName || fullName.split(" ")[0] || ""),
      profileUrl: normalizeWhitespace((shouldTrustConversationName ? "" : preview.profileUrl) || fallback.profileUrl),
      messagingThreadUrl: normalizeWhitespace(pageContext?.conversation?.threadUrl || preview.messagingThreadUrl || fallback.messagingThreadUrl),
      headline: normalizeWhitespace((shouldTrustConversationName ? "" : preview.headline) || fallback.headline),
      connectionStatus: normalizeWhitespace(preview.connectionStatus || fallback.connectionStatus || "unknown"),
      lastPageType: normalizeWhitespace(pageContext?.pageType || fallback.lastPageType)
    };
  }

  function actionSummaryLabel(value) {
    switch (normalizeRecommendedAction(value)) {
      case "draft_reply":
        return "Draft reply";
      case "draft_follow_up":
        return "Draft follow-up";
      case "draft_advice_ask":
        return "Draft advice ask";
      case "draft_referral_ask":
        return "Draft referral ask";
      case "wait":
        return "Wait";
      case "draft_first_message":
      default:
        return "Draft first message";
    }
  }

  function potentialLabel(aiAssessment) {
    const relevance = normalizeWhitespace(aiAssessment?.recipient_relevance).toLowerCase();
    const path = normalizeWhitespace(aiAssessment?.referral_path_strength).toLowerCase();
    if ((path === "strong" && relevance !== "low") || (relevance === "high" && path !== "weak")) {
      return "High";
    }
    if (path === "weak" || relevance === "low") {
      return "Low";
    }
    return "Medium";
  }

  function currentObservedConversation(person) {
    return getObservedConversation(resolveEffectivePersonRecord(person || state.personRecord));
  }

  function currentObservedMetrics(person) {
    return getObservedMetrics(resolveEffectivePersonRecord(person || state.personRecord)) || null;
  }

  function findSavedPersonRecord(record, conversation) {
    const people = Array.isArray(state.allPeople) ? state.allPeople : [];
    const personId = normalizeWhitespace(record?.personId);
    const threadUrl = normalizeWhitespace(conversation?.threadUrl || record?.messagingThreadUrl);
    const profileUrl = normalizeWhitespace(record?.profileUrl);

    if (personId) {
      const byPersonId = people.find((entry) => normalizeWhitespace(entry?.personId) === personId);
      if (byPersonId) {
        return byPersonId;
      }
    }
    if (threadUrl) {
      const byThreadUrl = people.find((entry) => normalizeWhitespace(entry?.messagingThreadUrl) === threadUrl);
      if (byThreadUrl) {
        return byThreadUrl;
      }
    }
    if (profileUrl) {
      const byProfileUrl = people.find((entry) => normalizeWhitespace(entry?.profileUrl) === profileUrl);
      if (byProfileUrl) {
        return byProfileUrl;
      }
    }
    return null;
  }

  function currentDraftWorkspace(person) {
    return getDraftWorkspace(resolveEffectivePersonRecord(person || state.personRecord)) || null;
  }

  function currentDashboardReview(person) {
    return getDashboardReview(resolveEffectivePersonRecord(person || state.personRecord)) || null;
  }

  function currentGenerationJob(person) {
    const personId = normalizeWhitespace((person || state.personRecord)?.personId);
    const sourceTabId = preferredLinkedInTabId();
    if (!personId) {
      return null;
    }
    return (Array.isArray(state.generationJobs) ? state.generationJobs : []).find((job) =>
      normalizeWhitespace(job?.personId) === personId
      && (
        sourceTabId === null
        || !Number.isInteger(job?.sourceTabId)
        || job.sourceTabId === sourceTabId
      )
    ) || null;
  }

  function resolveEffectivePersonRecord(record, conversation) {
    const fallbackRecord = record || state.personRecord || defaultPersonRecord();
    const savedRecord = findSavedPersonRecord(fallbackRecord, conversation || state.pageContext?.conversation);
    return savedRecord ? mergePersonRecord(savedRecord, fallbackRecord) : fallbackRecord;
  }

  function upsertLocalPersonRecord(record) {
    const personId = normalizeWhitespace(record?.personId);
    if (!personId) {
      return record || null;
    }
    const nextPeople = Array.isArray(state.allPeople) ? [...state.allPeople] : [];
    const existingIndex = nextPeople.findIndex((entry) => normalizeWhitespace(entry?.personId) === personId);
    const mergedRecord = mergePersonRecord(existingIndex >= 0 ? nextPeople[existingIndex] : null, record);
    if (existingIndex >= 0) {
      nextPeople[existingIndex] = mergedRecord;
    } else {
      nextPeople.push(mergedRecord);
    }
    state.allPeople = nextPeople;
    return mergedRecord;
  }

  function daysSinceIso(value) {
    const normalized = normalizeWhitespace(value);
    if (!normalized) {
      return null;
    }
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 86400000));
  }

  function bestAiAssessment(person) {
    const draftWorkspace = currentDraftWorkspace(person);
    return person?.aiConversationAssessment
      || person?.aiProfileAssessment
      || draftWorkspace?.ai_assessment
      || null;
  }

  function latestObservedMessage(person) {
    const observedConversation = currentObservedConversation(person);
    const imported = Array.isArray(observedConversation?.messages) ? observedConversation.messages : [];
    if (imported.length) {
      return imported[0];
    }
    const draftWorkspace = currentDraftWorkspace(person);
    const recent = Array.isArray(draftWorkspace?.conversation?.recentMessages)
      ? draftWorkspace.conversation.recentMessages
      : [];
    return recent.length ? recent[0] : null;
  }

  function parseActivityTimestamp(value) {
    const normalized = normalizeWhitespace(normalizeConversationTimestamp(value) || value);
    if (!normalized) {
      return null;
    }
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed;
  }

  function startOfLocalDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function activityWindowRange(windowKey, now) {
    const reference = now instanceof Date ? now : new Date();
    if (windowKey === "today") {
      return {
        key: "today",
        start: startOfLocalDay(reference),
        end: reference
      };
    }
    const end = reference;
    const start = startOfLocalDay(reference);
    start.setDate(start.getDate() - 6);
    return {
      key: "7d",
      start,
      end
    };
  }

  function previousActivityWindowRange(windowKey, now) {
    if (windowKey !== "7d") {
      return null;
    }
    const current = activityWindowRange("7d", now);
    const end = new Date(current.start.getTime());
    const start = new Date(end.getTime());
    start.setDate(start.getDate() - 7);
    return {
      key: "prev_7d",
      start,
      end
    };
  }

  function isDateInRange(date, range) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime()) || !range) {
      return false;
    }
    return date.getTime() >= range.start.getTime() && date.getTime() < range.end.getTime();
  }

  function analyticsMessagesForPerson(person) {
    const observed = currentObservedConversation(person);
    const observedMessages = Array.isArray(observed?.messages) ? observed.messages : [];
    if (observedMessages.length) {
      return observedMessages;
    }
    const draftWorkspace = currentDraftWorkspace(person);
    const recentMessages = Array.isArray(draftWorkspace?.conversation?.recentMessages)
      ? draftWorkspace.conversation.recentMessages
      : [];
    return recentMessages;
  }

  function derivePersonActivitySnapshot(person) {
    const metrics = currentObservedMetrics(person) || null;
    const parsedMessages = analyticsMessagesForPerson(person)
      .map((message) => {
        const date = parseActivityTimestamp(message?.timestamp);
        if (!date) {
          return null;
        }
        return {
          date,
          isSelf: isSelfSpeakerLabel(message?.sender)
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.date - right.date);

    let firstOutboundAt = null;
    let firstInboundAt = null;
    let lastActivityAt = null;

    parsedMessages.forEach((message) => {
      lastActivityAt = message.date;
      if (message.isSelf) {
        if (!firstOutboundAt) {
          firstOutboundAt = message.date;
        }
      } else if (!firstInboundAt) {
        firstInboundAt = message.date;
      }
    });

    if (!lastActivityAt) {
      lastActivityAt = parseActivityTimestamp(metrics?.last_known_message_at)
        || parseActivityTimestamp(metrics?.last_known_inbound_at)
        || parseActivityTimestamp(metrics?.last_known_outbound_at);
    }
    if (!firstOutboundAt && Number(metrics?.known_outbound_count || 0) > 0) {
      firstOutboundAt = parseActivityTimestamp(metrics?.first_known_message_at);
      if (!firstOutboundAt && Number(metrics?.known_outbound_count || 0) === 1) {
        firstOutboundAt = parseActivityTimestamp(metrics?.last_known_outbound_at);
      }
    }
    if (!firstInboundAt && Number(metrics?.known_inbound_count || 0) === 1) {
      firstInboundAt = parseActivityTimestamp(metrics?.last_known_inbound_at);
    }

    function hasMessageInRange(range, mode) {
      if (!range) {
        return false;
      }
      if (parsedMessages.length) {
        return parsedMessages.some((message) => {
          if (!isDateInRange(message.date, range)) {
            return false;
          }
          if (mode === "inbound") {
            return !message.isSelf;
          }
          if (mode === "outbound") {
            return message.isSelf;
          }
          return true;
        });
      }
      if (mode === "inbound") {
        return isDateInRange(parseActivityTimestamp(metrics?.last_known_inbound_at), range);
      }
      if (mode === "outbound") {
        return isDateInRange(parseActivityTimestamp(metrics?.last_known_outbound_at), range);
      }
      return isDateInRange(lastActivityAt, range);
    }

    return {
      personId: normalizeWhitespace(person?.personId),
      fullName: normalizeWhitespace(person?.fullName),
      firstOutboundAt,
      firstInboundAt,
      lastActivityAt,
      hasInboundInRange: (range) => hasMessageInRange(range, "inbound"),
      hasActivityInRange: (range) => hasMessageInRange(range, "any")
    };
  }

  function summarizeActivityMetrics(windowKey) {
    const now = new Date();
    const currentRange = activityWindowRange(windowKey, now);
    const previousRange = previousActivityWindowRange(windowKey, now);
    const summary = {
      current: {
        outreach: 0,
        replies: 0,
        active: 0
      },
      previous: {
        outreach: 0,
        replies: 0,
        active: 0
      },
      snapshots: []
    };

    (state.allPeople || []).forEach((person) => {
      const snapshot = derivePersonActivitySnapshot(person);
      if (!snapshot.personId) {
        return;
      }
      summary.snapshots.push(snapshot);
      if (isDateInRange(snapshot.firstOutboundAt, currentRange)) {
        summary.current.outreach += 1;
      }
      if (snapshot.hasInboundInRange(currentRange)) {
        summary.current.replies += 1;
      }
      if (snapshot.hasActivityInRange(currentRange)) {
        summary.current.active += 1;
      }
      if (previousRange) {
        if (isDateInRange(snapshot.firstOutboundAt, previousRange)) {
          summary.previous.outreach += 1;
        }
        if (snapshot.hasInboundInRange(previousRange)) {
          summary.previous.replies += 1;
        }
        if (snapshot.hasActivityInRange(previousRange)) {
          summary.previous.active += 1;
        }
      }
    });

    return summary;
  }

  function formatActivityDelta(currentValue, previousValue, windowKey) {
    if (windowKey !== "7d") {
      return "Today";
    }
    const delta = Number(currentValue || 0) - Number(previousValue || 0);
    if (delta === 0) {
      return "No change vs prev 7d";
    }
    return `${delta > 0 ? "+" : ""}${delta} vs prev 7d`;
  }

  function csvCell(value) {
    const text = String(value ?? "");
    if (!/[",\n]/.test(text)) {
      return text;
    }
    return `"${text.replace(/"/g, "\"\"")}"`;
  }

  function dashboardActivityCsv(windowKey) {
    const range = activityWindowRange(windowKey, new Date());
    const rows = [[
      "person_id",
      "name",
      "first_outbound_at",
      "first_inbound_at",
      "last_activity_at",
      "new_outreach_in_window",
      "reply_in_window",
      "active_in_window",
      "window"
    ]];

    summarizeActivityMetrics(windowKey).snapshots
      .sort((left, right) => (left.fullName || "").localeCompare(right.fullName || ""))
      .forEach((snapshot) => {
        rows.push([
          snapshot.personId,
          snapshot.fullName,
          snapshot.firstOutboundAt ? snapshot.firstOutboundAt.toISOString() : "",
          snapshot.firstInboundAt ? snapshot.firstInboundAt.toISOString() : "",
          snapshot.lastActivityAt ? snapshot.lastActivityAt.toISOString() : "",
          isDateInRange(snapshot.firstOutboundAt, range) ? "1" : "0",
          snapshot.hasInboundInRange(range) ? "1" : "0",
          snapshot.hasActivityInRange(range) ? "1" : "0",
          windowKey === "today" ? "today" : "last_7_days"
        ]);
      });

    return rows.map((row) => row.map(csvCell).join(",")).join("\n");
  }

  function downloadDashboardActivityCsv() {
    const csv = dashboardActivityCsv(state.dashboardActivityWindow || "7d");
    const stamp = new Date().toISOString().slice(0, 10);
    const windowLabel = state.dashboardActivityWindow === "today" ? "today" : "7d";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `relationship_activity_${windowLabel}_${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function renderDashboardActivityCard() {
    const windowKey = state.dashboardActivityWindow || "7d";
    const summary = summarizeActivityMetrics(windowKey);
    [
      ["outreach", el.dashboardActivityOutreachCount, el.dashboardActivityOutreachDelta],
      ["replies", el.dashboardActivityRepliesCount, el.dashboardActivityRepliesDelta],
      ["active", el.dashboardActivityActiveCount, el.dashboardActivityActiveDelta]
    ].forEach(([key, countNode, deltaNode]) => {
      if (countNode) {
        countNode.textContent = String(summary.current[key] || 0);
      }
      if (deltaNode) {
        deltaNode.textContent = formatActivityDelta(summary.current[key] || 0, summary.previous[key] || 0, windowKey);
      }
    });

    el.dashboardActivityWindowToday?.classList.toggle("is-active", windowKey === "today");
    el.dashboardActivityWindow7d?.classList.toggle("is-active", windowKey === "7d");
    if (el.dashboardExportCsv) {
      el.dashboardExportCsv.disabled = !state.allPeople.length;
    }
  }

  function ownDisplayName() {
    return extractOwnProfileName(state.myProfile?.rawSnapshot);
  }

  function isSelfSpeakerLabel(value) {
    const speaker = normalizeWhitespace(value);
    if (!speaker) {
      return false;
    }
    if (speaker.toLowerCase() === "you") {
      return true;
    }
    return Boolean(ownDisplayName() && speaker === ownDisplayName());
  }

  function messagePreview(text, limit) {
    const normalized = normalizeWhitespace(String(text || "").replace(/\r/g, " ").replace(/\n+/g, " "));
    if (!normalized) {
      return { summary: "", full: "", truncated: false };
    }
    if (normalized.length <= limit) {
      return { summary: normalized, full: normalized, truncated: false };
    }
    return {
      summary: `${normalized.slice(0, Math.max(0, limit - 6)).trim()}...more`,
      full: normalized,
      truncated: true
    };
  }

  function liveMetrics(person) {
    const metrics = { ...(currentObservedMetrics(person) || {}) };
    metrics.days_since_first_known_contact = daysSinceIso(metrics.first_known_message_at);
    metrics.days_since_last_known_message = daysSinceIso(metrics.last_known_message_at);
    metrics.days_since_last_known_inbound = daysSinceIso(metrics.last_known_inbound_at);
    metrics.days_since_last_known_outbound = daysSinceIso(metrics.last_known_outbound_at);
    return metrics;
  }

  function dashboardSectionForPerson(person) {
    const metrics = liveMetrics(person);
    const draftWorkspace = currentDraftWorkspace(person);
    const dashboardReview = currentDashboardReview(person);
    const triage = draftWorkspace?.relationship_triage || null;
    const investmentDecision = normalizeInvestmentDecision(triage?.investment_decision);
    const action = normalizeRecommendedAction(draftWorkspace?.recommended_action || person?.lastRecommendedAction);
    const stage = normalizeRelationshipStage(dashboardReview?.stage || person?.relationshipStage || draftWorkspace?.relationship_stage);
    const aiAssessment = bestAiAssessment(person);
    const readinessScore = Number(draftWorkspace?.referral_readiness?.score_100 || 0);
    const askReadiness = normalizeWhitespace(dashboardReview?.ask_readiness || "").toLowerCase();
    const whoSpokeLast = normalizeWhitespace(metrics?.who_spoke_last).toLowerCase();
    const staleRecommendation = Boolean(dashboardReview?.is_stale ?? person?.aiRecommendationStale);
    const daysSinceOutbound = metrics?.days_since_last_known_outbound;

    if (investmentDecision === "move_on") {
      return "deprioritize";
    }
    if (staleRecommendation && whoSpokeLast === "recipient") {
      return "reply_now";
    }
    if (
      action === "draft_referral_ask"
      || askReadiness === "referral_ready"
      || readinessScore >= 70
      || (normalizeWhitespace(aiAssessment?.referral_path_strength).toLowerCase() === "strong" && metrics?.has_ever_replied)
    ) {
      return "warm";
    }
    if (staleRecommendation && whoSpokeLast === "self") {
      return daysSinceOutbound !== null && daysSinceOutbound !== undefined && daysSinceOutbound < 7 ? "waiting" : "follow_up";
    }
    if (staleRecommendation) {
      return "follow_up";
    }
    if (whoSpokeLast === "recipient") {
      return "reply_now";
    }
    if (whoSpokeLast === "self") {
      if (action === "wait" || investmentDecision === "pause_until_new_trigger") {
        return "waiting";
      }
      if (daysSinceOutbound !== null && daysSinceOutbound !== undefined && daysSinceOutbound < 7) {
        return "waiting";
      }
      return "follow_up";
    }
    if (
      stage === "warm"
      || stage === "ready_for_referral"
      || normalizeWhitespace(aiAssessment?.relationship_warmth).toLowerCase() === "warm"
    ) {
      return "warm";
    }
    return (metrics?.known_message_count ?? 0) > 0 ? "follow_up" : "deprioritize";
  }

  function dashboardPriorityScore(entry) {
    const sectionWeights = {
      reply_now: 500,
      warm: 420,
      follow_up: 340,
      waiting: 220,
      deprioritize: 100
    };
    const actionWeights = {
      draft_reply: 80,
      draft_follow_up: 70,
      draft_advice_ask: 60,
      draft_referral_ask: 55,
      draft_first_message: 45,
      wait: 20
    };
    const potentialWeights = {
      High: 30,
      Medium: 20,
      Low: 10
    };
    const recencyPenalty = Math.min(entry.daysSinceActivity ?? 90, 90);
    return (sectionWeights[entry.section] || 0)
      + (actionWeights[normalizeRecommendedAction(entry.recommendedAction)] || 0)
      + (potentialWeights[entry.referralPotential] || 0)
      + Math.round((entry.referralReadinessScore || 0) * 0.8)
      + (currentDashboardReview(entry.person)?.is_stale ? 50 : 0)
      - recencyPenalty;
  }

  function dashboardSectionLabel(section) {
    switch (section) {
      case "reply_now":
        return "Reply now";
      case "follow_up":
        return "Re-engage";
      case "warm":
        return "Referral pipeline";
      case "waiting":
        return "Monitor";
      case "deprioritize":
        return "Parked";
      default:
        return "Relationship";
    }
  }

  function dashboardReadinessBand(score) {
    if (score >= 75) {
      return "High";
    }
    if (score >= 50) {
      return "Medium";
    }
    return "Low";
  }

  function dashboardGoalLabel(goal) {
    switch (normalizeWhitespace(goal)) {
      case "build_relationship":
        return "Goal: relationship";
      case "get_advice":
        return "Goal: advice";
      case "ask_intro":
        return "Goal: intro";
      case "ask_referral":
        return "Goal: referral";
      case "job_insight":
        return "Goal: job insight";
      default:
        return "";
    }
  }

  function openLoopLabel(metrics, triage) {
    const whoSpokeLast = normalizeWhitespace(metrics?.who_spoke_last).toLowerCase();
    if (whoSpokeLast === "recipient") {
      return "Open loop: reply owed";
    }
    if (whoSpokeLast === "self") {
      if (normalizeInvestmentDecision(triage?.investment_decision) === "pause_until_new_trigger") {
        return "Open loop: pause";
      }
      return "Open loop: waiting on them";
    }
    return "";
  }

  function activityLabelFromMetrics(metrics) {
    const whoSpokeLast = normalizeWhitespace(metrics?.who_spoke_last).toLowerCase();
    if (whoSpokeLast === "recipient" && metrics?.days_since_last_known_inbound !== null && metrics?.days_since_last_known_inbound !== undefined) {
      return `They replied ${relativeAgeLabel(metrics.days_since_last_known_inbound)}`;
    }
    if (whoSpokeLast === "self" && metrics?.days_since_last_known_outbound !== null && metrics?.days_since_last_known_outbound !== undefined) {
      return `You sent last ${relativeAgeLabel(metrics.days_since_last_known_outbound)}`;
    }
    if (metrics?.days_since_last_known_message !== null && metrics?.days_since_last_known_message !== undefined) {
      return `Last touch ${relativeAgeLabel(metrics.days_since_last_known_message)}`;
    }
    return "";
  }

  function deriveDashboardEntry(person) {
    const metrics = liveMetrics(person);
    const draftWorkspace = currentDraftWorkspace(person);
    const dashboardReview = currentDashboardReview(person);
    const triage = draftWorkspace?.relationship_triage || null;
    const aiAssessment = bestAiAssessment(person);
    const section = dashboardSectionForPerson(person);
    const staleRecommendation = Boolean(dashboardReview?.is_stale ?? person?.aiRecommendationStale);
    const stage = normalizeRelationshipStage(dashboardReview?.stage || person?.relationshipStage || draftWorkspace?.relationship_stage)
      || (metrics.has_ever_replied ? "engaged" : metrics.known_outbound_count > 0 ? "cold_sent" : "new");
    const why = normalizeWhitespace(
      dashboardReview?.why
        || (staleRecommendation
        ? "New LinkedIn activity arrived after the last recommendation. Review this workspace before acting."
        : draftWorkspace?.reason_why_now
          || person?.lastReasonWhyNow
          || triage?.summary
          || aiAssessment?.referral_path_reason
          || aiAssessment?.warmth_reason
          || aiAssessment?.relevance_reason)
    );
    const activityLabel = activityLabelFromMetrics(metrics);
    const daysSinceActivity = metrics?.days_since_last_known_message ?? null;
    const whoSpokeLast = normalizeWhitespace(metrics?.who_spoke_last).toLowerCase();
    const latestMessage = latestObservedMessage(person);
    const latestMessageSender = normalizeWhitespace(latestMessage?.sender);
    const latestMessagePreview = messagePreview(latestMessage?.text, 96);
    const referralReadinessScore = Number(draftWorkspace?.referral_readiness?.score_100 || 0);
    const referralPotential = dashboardReview?.referral_potential
      ? `${dashboardReview.referral_potential.charAt(0).toUpperCase()}${dashboardReview.referral_potential.slice(1)}`
      : dashboardReadinessBand(referralReadinessScore || 0);
    const observedActionLabel = staleRecommendation
      ? "Review workspace"
      : whoSpokeLast === "recipient"
        ? "Reply now"
        : whoSpokeLast === "self"
          ? section === "waiting"
            ? "Waiting on them"
            : "Follow up"
          : actionSummaryLabel(draftWorkspace?.recommended_action || person?.lastRecommendedAction);

    return {
      person,
      personId: person?.personId || "",
      fullName: normalizeWhitespace(person?.fullName) || "Unknown person",
      subtitle: normalizeWhitespace(person?.headline),
      connectionStatus: normalizeConnectionStatus(person?.connectionStatus),
      section,
      stage,
      stageLabel: section === "waiting" && (metrics?.days_since_last_known_message ?? 0) >= 30
        ? "Dormant"
        : dashboardSectionLabel(section),
      recommendedAction: normalizeRecommendedAction(draftWorkspace?.recommended_action || person?.lastRecommendedAction),
      recommendedActionLabel: observedActionLabel,
      referralPotential,
      referralReadinessScore,
      askReadiness: dashboardReview?.ask_readiness || "",
      why: why || "Open this workspace to review the latest recommendation.",
      activityLabel: activityLabel || "No activity yet",
      openLoopLabel: openLoopLabel(metrics, triage),
      goalLabel: dashboardGoalLabel(person?.userGoal),
      daysSinceActivity,
      profileUrl: normalizeWhitespace(person?.profileUrl),
      messagingThreadUrl: normalizeWhitespace(person?.messagingThreadUrl),
      latestMessageSender,
      latestMessagePreview,
      priorityScore: 0,
      updatedAt: person?.updatedAt || ""
    };
  }

  function filteredDashboardEntries() {
    const filter = state.dashboardFilter;

    const entries = state.allPeople
      .map(deriveDashboardEntry)
      .filter((entry) => entry.personId && entry.fullName !== "Unknown person");

    entries.forEach((entry) => {
      entry.priorityScore = dashboardPriorityScore(entry);
    });

    let filtered = entries;
    if (filter !== "all") {
      filtered = filtered.filter((entry) => entry.section === filter);
    }
    filtered.sort((left, right) => {
      switch (state.dashboardSort) {
        case "name":
          return left.fullName.localeCompare(right.fullName);
        case "recent":
          return (left.daysSinceActivity ?? Number.POSITIVE_INFINITY) - (right.daysSinceActivity ?? Number.POSITIVE_INFINITY);
        case "potential": {
          return (right.referralReadinessScore || 0) - (left.referralReadinessScore || 0)
            || right.priorityScore - left.priorityScore;
        }
        case "priority":
        default:
          return right.priorityScore - left.priorityScore
            || (left.daysSinceActivity ?? Number.POSITIVE_INFINITY) - (right.daysSinceActivity ?? Number.POSITIVE_INFINITY);
      }
    });

    return filtered;
  }

  function dashboardCounts() {
    const counts = {
      reply_now: 0,
      follow_up: 0,
      warm: 0,
      waiting: 0,
      deprioritize: 0
    };

    state.allPeople
      .map(deriveDashboardEntry)
      .forEach((entry) => {
        counts[entry.section] = (counts[entry.section] || 0) + 1;
      });
    return counts;
  }

  function isDashboardExpanded(key) {
    return Boolean(state.dashboardExpanded?.[normalizeWhitespace(key)]);
  }

  function setDashboardExpanded(key) {
    const normalizedKey = normalizeWhitespace(key);
    if (!normalizedKey) {
      return;
    }
    state.dashboardExpanded = {
      ...(state.dashboardExpanded || {}),
      [normalizedKey]: true
    };
  }

  function toggleDashboardExpanded(key) {
    const normalizedKey = normalizeWhitespace(key);
    if (!normalizedKey) {
      return;
    }
    const nextExpanded = { ...(state.dashboardExpanded || {}) };
    if (nextExpanded[normalizedKey]) {
      delete nextExpanded[normalizedKey];
    } else {
      nextExpanded[normalizedKey] = true;
    }
    state.dashboardExpanded = nextExpanded;
  }

  function createExpandableTextBlock(className, text, key, maxLength) {
    const normalized = normalizeWhitespace(text);
    if (!normalized) {
      return null;
    }
    const expanded = isDashboardExpanded(key);
    const needsExpansion = normalized.length > maxLength;
    if (!needsExpansion) {
      const full = document.createElement("p");
      full.className = className;
      full.textContent = normalized;
      return full;
    }
    const wrapper = document.createElement("div");
    wrapper.className = `${className}-expandable`;
    const preview = document.createElement("p");
    preview.className = className;
    const previewText = expanded
      ? normalized
      : `${normalized.slice(0, maxLength).trim()}...`;
    preview.appendChild(document.createTextNode(previewText));
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dashboard-more-button";
    button.dataset.dashboardExpand = normalizeWhitespace(key);
    button.textContent = expanded ? "less" : "more";
    wrapper.appendChild(preview);
    wrapper.appendChild(button);
    return wrapper;
  }

  function createDashboardPreviewBlock(entry) {
    if (!entry.latestMessagePreview?.summary) {
      return null;
    }
    const container = document.createElement("div");
    container.className = "dashboard-message-preview";

    const previewText = entry.latestMessageSender
      ? `${entry.latestMessageSender}: ${entry.latestMessagePreview.full || entry.latestMessagePreview.summary}`
      : (entry.latestMessagePreview.full || entry.latestMessagePreview.summary);

    if (entry.latestMessagePreview.truncated) {
      const previewBlock = createExpandableTextBlock(
        "dashboard-message-body",
        previewText,
        `preview:${entry.personId}`,
        92
      );
      if (previewBlock) {
        container.appendChild(previewBlock);
      }
    } else {
      const previewLine = document.createElement("p");
      previewLine.className = "dashboard-message-body";
      previewLine.textContent = entry.latestMessageSender
        ? `${entry.latestMessageSender}: ${entry.latestMessagePreview.summary}`
        : entry.latestMessagePreview.summary;
      container.appendChild(previewLine);
    }

    return container;
  }

  function currentViewIdentity() {
    return {
      tabId: state.activeTabId || null,
      personId: state.pageContext?.person?.personId || state.personRecord?.personId || "",
      pageType: state.pageContext?.pageType || "",
      pageUrl: state.pageContext?.pageUrl || "",
      threadUrl: normalizeWhitespace(state.pageContext?.conversation?.threadUrl || state.personRecord?.messagingThreadUrl || "")
    };
  }

  function sameViewIdentity(left, right) {
    return Boolean(left && right)
      && left.tabId === right.tabId
      && left.personId === right.personId
      && left.pageType === right.pageType
      && left.pageUrl === right.pageUrl
      && normalizeWhitespace(left.threadUrl) === normalizeWhitespace(right.threadUrl);
  }

  function preferredLinkedInTabId() {
    return state.attachedLinkedInTabId
      || state.activeTabId
      || state.backgroundObservedLinkedInTabId
      || null;
  }

  function isLinkedInWorkspaceUrl(url) {
    return /^https:\/\/www\.linkedin\.com\/(?:in|messaging)\b/i.test(normalizeWhitespace(url || ""));
  }

  function attachToLinkedInTab(tabId, url) {
    if (typeof tabId !== "number" || !isLinkedInWorkspaceUrl(url)) {
      return false;
    }
    state.attachedLinkedInTabId = tabId;
    state.lastObservedBrowserTabId = tabId;
    state.lastObservedBrowserTabUrl = normalizeWhitespace(url || "");
    return true;
  }

  function messageMatchesAttachedLinkedInTab(message) {
    const preferredTabId = preferredLinkedInTabId();
    const sourceTabId = typeof message?.sourceTabId === "number" ? message.sourceTabId : null;
    if (preferredTabId === null || sourceTabId === null) {
      return false;
    }
    return preferredTabId === sourceTabId;
  }

  async function getSourceTabId() {
    const preferredTabId = preferredLinkedInTabId();
    if (typeof preferredTabId === "number") {
      return preferredTabId;
    }
    try {
      let tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tabs[0]?.id) {
        tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      }
      if (tabs[0]?.id && /^https:\/\/www\.linkedin\.com\//i.test(normalizeWhitespace(tabs[0]?.url || ""))) {
        return tabs[0].id;
      }
    } catch (_error) {
      // Fall back to the last known active LinkedIn tab id from refreshState.
    }
    return preferredLinkedInTabId();
  }

  function actionLabel(action) {
    switch (normalizeRecommendedAction(action)) {
      case "draft_follow_up":
        return "Draft follow-up";
      case "draft_reply":
        return "Draft reply";
      case "draft_advice_ask":
        return "Draft advice ask";
      case "draft_referral_ask":
        return "Draft referral ask";
      case "wait":
        return "Draft again";
      case "draft_first_message":
      default:
        return "Draft message";
    }
  }

  function nextActionLabel(action, person) {
    const normalizedAction = normalizeRecommendedAction(action);
    const hasExistingDraft = Boolean(currentDraftWorkspace(person)?.generatedAt);
    if (normalizedAction === "wait") {
      const fallbackAction = inferFallbackAction();
      if (fallbackAction === "draft_reply") {
        return hasExistingDraft ? "Draft reply again" : "Draft reply";
      }
      if (fallbackAction === "draft_follow_up") {
        return hasExistingDraft ? "Draft follow-up again" : "Draft follow-up";
      }
      if (fallbackAction === "draft_first_message") {
        return hasExistingDraft ? "Draft message again" : "Draft message";
      }
      return hasExistingDraft ? "Draft again" : "Draft message";
    }
    if (normalizedAction === "draft_reply" && hasExistingDraft) {
      return "Draft reply again";
    }
    return actionLabel(normalizedAction);
  }

  function actionBadgeLabel(action) {
    switch (normalizeRecommendedAction(action)) {
      case "draft_follow_up":
        return "Follow-up";
      case "draft_reply":
        return "Reply";
      case "draft_advice_ask":
        return "Advice ask";
      case "draft_referral_ask":
        return "Referral ask";
      case "wait":
        return "Wait";
      case "draft_first_message":
      default:
        return "First message";
    }
  }

  function inferFallbackAction() {
    const draftWorkspace = currentDraftWorkspace();
    if (draftWorkspace?.recommended_action) {
      return draftWorkspace.recommended_action;
    }

    const person = currentNextStepPerson();
    const lastSpeaker = normalizeWhitespace(latestObservedMessage(person)?.sender || currentObservedConversation(person)?.lastSpeaker);
    if (hasSavedMessageHistory(person)) {
      return isSelfSpeakerLabel(lastSpeaker) ? "draft_follow_up" : "draft_reply";
    }
    if (state.personRecord?.relationshipStage === "no_reply") {
      return "draft_follow_up";
    }
    if (normalizeInvestmentDecision(currentRelationshipTriage()?.investment_decision) === "low_pressure_follow_up") {
      return "draft_follow_up";
    }
    return "draft_first_message";
  }

  function currentAction() {
    const draftWorkspace = currentDraftWorkspace();
    return normalizeRecommendedAction(draftWorkspace?.recommended_action)
      || normalizeRecommendedAction(state.personRecord?.lastRecommendedAction)
      || inferFallbackAction();
  }

  function currentRelationshipTriage() {
    const draftWorkspace = currentDraftWorkspace();
    return draftWorkspace?.relationship_triage
      || state.personRecord?.observedRelationshipTriage
      || null;
  }

  function currentConnectionStatus() {
    const storedStatus = normalizeConnectionStatus(state.personRecord?.connectionStatus);
    if (storedStatus) {
      return storedStatus;
    }
    return normalizeConnectionStatus(
      state.pageContext?.person?.connectionStatus
      || state.pageContext?.profile?.connectionStatus
    ) || "unknown";
  }

  function relationshipManagementLabel() {
    switch (normalizeInvestmentDecision(currentRelationshipTriage()?.investment_decision)) {
      case "continue_investing":
        return "Worth continuing";
      case "low_pressure_follow_up":
        return "One light touch is reasonable";
      case "pause_until_new_trigger":
        return "Pause unless you have a new reason to re-engage";
      case "move_on":
        return "This may not be worth more effort right now";
      default:
        return "";
    }
  }

  function relationshipManagementRead() {
    const triage = currentRelationshipTriage();
    if (!triage) {
      return "";
    }

    const researchAdvice = normalizeResearchRecommendation(triage.research_recommendation) === "find_new_context_before_follow_up"
      ? "Find a fresh, lower-pressure angle before sending anything else."
      : "";
    return [triage.summary, researchAdvice].filter(Boolean).join(" ");
  }

  function referralReadinessRead() {
    const readiness = currentDraftWorkspace()?.referral_readiness || null;
    if (!readiness || typeof readiness !== "object") {
      const hasWorkspace = Boolean(currentDraftWorkspace()?.generatedAt);
      return hasWorkspace ? "Refresh draft to score referral readiness." : "";
    }
    const score = Number.isFinite(Number(readiness.score_100)) ? Number(readiness.score_100) : 0;
    const trust = Number.isFinite(Number(readiness.relationship_trust_25)) ? Number(readiness.relationship_trust_25) : 0;
    const history = Number.isFinite(Number(readiness.response_history_25)) ? Number(readiness.response_history_25) : 0;
    const fit = Number.isFinite(Number(readiness.role_fit_25)) ? Number(readiness.role_fit_25) : 0;
    const ask = Number.isFinite(Number(readiness.ask_specificity_25)) ? Number(readiness.ask_specificity_25) : 0;
    const summary = normalizeWhitespace(readiness.summary || "");
    const metrics = `Referral readiness ${score}/100 - trust ${trust}/25, replies ${history}/25, fit ${fit}/25, ask ${ask}/25`;
    return summary ? `${metrics}. ${summary}` : metrics;
  }

  function referralReadinessMarkup() {
    const readiness = currentDraftWorkspace()?.referral_readiness || null;
    if (!readiness || typeof readiness !== "object") {
      return "";
    }
    const score = Number.isFinite(Number(readiness.score_100)) ? Number(readiness.score_100) : 0;
    const trust = Number.isFinite(Number(readiness.relationship_trust_25)) ? Number(readiness.relationship_trust_25) : 0;
    const history = Number.isFinite(Number(readiness.response_history_25)) ? Number(readiness.response_history_25) : 0;
    const fit = Number.isFinite(Number(readiness.role_fit_25)) ? Number(readiness.role_fit_25) : 0;
    const ask = Number.isFinite(Number(readiness.ask_specificity_25)) ? Number(readiness.ask_specificity_25) : 0;
    const summary = normalizeWhitespace(readiness.summary || "");
    const scoreLabel = `Referral readiness ${score}/100`;
    const rest = ` - trust ${trust}/25, replies ${history}/25, fit ${fit}/25, ask ${ask}/25`;
    const summarySuffix = summary ? `. ${renderInlineRichText(summary)}` : "";
    return `<strong class="referral-readiness-score">${escapeHtml(scoreLabel)}</strong>${escapeHtml(rest)}${summarySuffix}`;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderInlineRichText(value) {
    const escaped = escapeHtml(normalizeWhitespace(value));
    if (!escaped) {
      return "";
    }
    return escaped
      .replace(/\*\*(.+?)\*\*/g, '<strong class="inline-emphasis">$1</strong>')
      .replace(/==(.+?)==/g, '<mark class="inline-highlight">$1</mark>');
  }

  function connectionLabel(status) {
    switch (normalizeWhitespace(status)) {
      case "connected":
        return "Connected";
      case "not_connected":
        return "Not connected";
      case "pending":
        return "Pending";
      default:
        return "Connection unknown";
    }
  }

  function relationshipRead(person) {
    const target = resolveEffectivePersonRecord(person || state.personRecord, state.pageContext?.conversation);
    if (isSavedOwnProfilePage()) {
      return "This is your profile.";
    }
    const draftWorkspace = currentDraftWorkspace(target);
    if (draftWorkspace?.reason_why_now) {
      return draftWorkspace.reason_why_now;
    }

    const observedConversation = currentObservedConversation(target);
    const lastSpeaker = normalizeWhitespace(latestObservedMessage(target)?.sender || observedConversation?.lastSpeaker);
    const connectionStatus = currentConnectionStatus();
    const hasImportedConversation = hasSavedMessageHistory(target);
    if (hasImportedConversation && isSelfSpeakerLabel(lastSpeaker)) {
      return `${ownDisplayName() || "You"} spoke last.`;
    }
    if (hasImportedConversation && lastSpeaker) {
      return `${lastSpeaker} spoke last.`;
    }
    if (!hasImportedConversation && connectionStatus === "connected") {
      return "Profile saved. Bring in the thread before the next touch.";
    }
    if (target?.relationshipStage === "no_reply") {
      return "Previous outreach found.";
    }
    return "Profile context is saved.";
  }

  function populateProfileForm(profile, options) {
    const merged = { ...defaultMyProfile(), ...(profile || {}) };
    Object.entries(profileFields).forEach(([key, field]) => {
      if (field) {
        field.value = merged[key] || "";
      }
    });
    if (el.senderProfileNotesInput && document.activeElement !== el.senderProfileNotesInput) {
      el.senderProfileNotesInput.value = merged.manualNotes || "";
    }
    if (el.senderProfileUrlInput && document.activeElement !== el.senderProfileUrlInput) {
      el.senderProfileUrlInput.value = merged.ownProfileUrl || "";
    }
    if (el.senderProfileSettingsUrl && document.activeElement !== el.senderProfileSettingsUrl) {
      el.senderProfileSettingsUrl.value = merged.ownProfileUrl || "";
    }
    if (el.senderContextDetails && options?.openDetails) {
      el.senderContextDetails.open = true;
    }
  }

  function syncOwnProfileUrlInputs(nextUrl) {
    const ownProfileUrl = normalizeWhitespace(nextUrl);
    if (el.senderProfileUrlInput && document.activeElement !== el.senderProfileUrlInput) {
      el.senderProfileUrlInput.value = ownProfileUrl;
    }
    if (el.senderProfileSettingsUrl && document.activeElement !== el.senderProfileSettingsUrl) {
      el.senderProfileSettingsUrl.value = ownProfileUrl;
    }
  }

  function readProfileForm() {
    return {
      ownProfileUrl: normalizeWhitespace(el.senderProfileSettingsUrl?.value || el.senderProfileUrlInput?.value || state.myProfile?.ownProfileUrl || ""),
      manualNotes: configuredSenderManualNotes(),
      rawSnapshot: typeof profileFields.rawSnapshot?.value === "string"
        ? profileFields.rawSnapshot.value
        : (state.myProfile?.rawSnapshot || "")
    };
  }

  function selectedLlmProvider() {
    return normalizeLlmProvider(
      el.llmProviderSettingsSelect?.value
      || el.senderProfileProviderSelect?.value
      || state.promptSettings?.llmProvider
      || ""
    );
  }

  function settingsSheetOpen() {
    return Boolean(el.settingsSection && !el.settingsSection.classList.contains("hidden"));
  }

  function markPromptSettingsDirty() {
    state.promptSettingsDirty = true;
  }

  function resetPromptSettingsDirty() {
    state.promptSettingsDirty = false;
  }

  function shouldPreserveUnsavedPromptSettings() {
    return settingsSheetOpen() && state.promptSettingsDirty;
  }

  function selectedLlmProviderUrl(providerOverride) {
    const provider = normalizeLlmProvider(providerOverride || selectedLlmProvider());
    const candidate = normalizeWhitespace(
      el.llmProviderUrlInput?.value
      || state.promptSettings?.llmEntryUrl
      || ""
    );
    return normalizeLlmEntryUrl(provider, candidate || defaultLlmEntryUrl(provider));
  }

  function syncLlmProviderInputs(provider, entryUrl) {
    const normalizedProvider = normalizeLlmProvider(provider);
    const normalizedEntryUrl = normalizeLlmEntryUrl(normalizedProvider, entryUrl || defaultLlmEntryUrl(normalizedProvider));
    if (el.senderProfileProviderSelect && document.activeElement !== el.senderProfileProviderSelect) {
      el.senderProfileProviderSelect.value = normalizedProvider;
    }
    if (el.llmProviderSettingsSelect && document.activeElement !== el.llmProviderSettingsSelect) {
      el.llmProviderSettingsSelect.value = normalizedProvider;
    }
    if (el.llmProviderUrlInput && document.activeElement !== el.llmProviderUrlInput) {
      el.llmProviderUrlInput.value = normalizedEntryUrl;
    }
    if (el.llmProviderUrlInput) {
      el.llmProviderUrlInput.placeholder = defaultLlmEntryUrl(normalizedProvider);
    }
  }

  function populatePromptSettingsForm(settings) {
    if (shouldPreserveUnsavedPromptSettings()) {
      return;
    }
    const merged = { ...defaultPromptSettings(), ...(settings || {}) };
    const llmProvider = normalizeLlmProvider(merged.llmProvider);
    const llmEntryUrl = normalizeLlmEntryUrl(llmProvider, merged.llmEntryUrl || defaultLlmEntryUrl(llmProvider));
    syncLlmProviderInputs(llmProvider, llmEntryUrl);
    el.strategyGuidance.value = merged.strategyGuidance || "";
    if (el.senderProfileSettingsUrl && document.activeElement !== el.senderProfileSettingsUrl) {
      el.senderProfileSettingsUrl.value = normalizedOwnProfileUrl();
    }
    resetPromptSettingsDirty();
  }

  function readPromptSettingsForm() {
    const llmProvider = normalizeLlmProvider(el.llmProviderSettingsSelect?.value || state.promptSettings?.llmProvider || "");
    return {
      strategyGuidance: el.strategyGuidance.value,
      llmProvider,
      llmEntryUrl: normalizeLlmEntryUrl(
        llmProvider,
        el.llmProviderUrlInput?.value || state.promptSettings?.llmEntryUrl || defaultLlmEntryUrl(llmProvider)
      )
    };
  }

  function currentObservedSurfaceUrl() {
    const liveLinkedInUrl = normalizeWhitespace(state.backgroundObservedLinkedInTabUrl || state.pageContext?.pageUrl || "");
    if (liveLinkedInUrl) {
      return liveLinkedInUrl;
    }
    const lastObservedUrl = normalizeWhitespace(state.lastObservedBrowserTabUrl || "");
    return isSupportedWorkspaceSurfaceUrl(lastObservedUrl) ? lastObservedUrl : "";
  }

  function isSupportedWorkspaceSurfaceUrl(url) {
    const normalized = normalizeWhitespace(url);
    return /^https:\/\/www\.linkedin\.com\/(?:in|messaging)\b/i.test(normalized);
  }

  function clearNavigationHold() {
    state.navigationHold = {
      active: false,
      targetUrl: "",
      targetPageType: ""
    };
  }

  function setNavigationHold(targetUrl) {
    const normalizedUrl = normalizeWhitespace(targetUrl);
    state.navigationHold = {
      active: Boolean(normalizedUrl),
      targetUrl: normalizedUrl,
      targetPageType: /^https:\/\/www\.linkedin\.com\/messaging\b/i.test(normalizedUrl)
        ? "linkedin-messaging"
        : /^https:\/\/www\.linkedin\.com\/in\//i.test(normalizedUrl)
          ? "linkedin-profile"
          : ""
    };
  }

  function shouldKeepNavigationHold() {
    if (!state.navigationHold?.active) {
      return false;
    }
    const targetUrl = normalizeWhitespace(state.navigationHold?.targetUrl || "").replace(/\/+$/, "");
    const targetPageType = normalizeWhitespace(state.navigationHold?.targetPageType || "");
    const pageType = normalizeWhitespace(state.pageContext?.pageType || "");
    const pageUrl = normalizeWhitespace(state.pageContext?.pageUrl || "").replace(/\/+$/, "");
    const surfaceUrl = normalizeWhitespace(currentObservedSurfaceUrl() || "").replace(/\/+$/, "");

    if (!targetUrl) {
      return false;
    }
    if (!isSupportedWorkspaceSurfaceUrl(targetUrl)) {
      return false;
    }
    if (surfaceUrl && surfaceUrl !== targetUrl && pageUrl && pageUrl !== targetUrl) {
      return true;
    }
    if (!state.pageContext?.supported) {
      return true;
    }
    if (targetPageType && pageType && pageType !== targetPageType) {
      return true;
    }
    if (pageUrl && pageUrl !== targetUrl) {
      return true;
    }
    return false;
  }

  function resetTransientWorkspaceState() {
    state.personRecord = defaultPersonRecord();
    state.workspace = null;
    state.manualRecovery = null;
    state.lastGenerationDiagnostics = null;
    state.resolutionDiagnostics = null;
    state.lastOpenMessagesDiagnostics = null;
    state.extraContext = "";
    state.showingAlternatives = false;
    state.conversationHistoryExpanded = false;
    state.identityResolutionRequest = null;
    state.identityWarning = null;
    setPersonCardEditorOpen(false);
  }

  function renderHeader() {
    const messagingRecipientName = normalizeWhitespace(state.pageContext?.conversation?.recipientName);
    const isTransientMessagingLoad = state.pageContext?.pageType === "linkedin-messaging"
      && !state.pageContext?.supported
      && /loading selected conversation/i.test(state.pageContext?.reason || "Loading selected conversation...");
    const isTransientProfileLoad = state.pageContext?.pageType === "linkedin-profile"
      && !state.pageContext?.supported
      && /loading profile/i.test(state.pageContext?.reason || "Loading profile...");
    const loadingDisplayName = isTransientMessagingLoad
      ? "Loading conversation..."
      : isTransientProfileLoad
        ? (fallbackProfileNameFromPageContext() || "Loading profile...")
        : "Open a LinkedIn person";
    const displayName = cleanHeaderName(
      state.pageContext?.person?.fullName
      || state.pageContext?.profile?.fullName
      || state.personRecord?.fullName
      || messagingRecipientName
      || state.personRecord?.firstName
      || fallbackProfileNameFromPageContext()
      || ""
    ) || loadingDisplayName;
    const displaySubtitle = cleanHeaderSubtitle(
      state.pageContext?.person?.headline
      || state.pageContext?.profile?.headline
      || state.personRecord?.headline
      || extractSubtitleFromRawSnapshot(
        state.pageContext?.profile?.rawSnapshot
        || state.pageContext?.person?.rawSnapshot
        || state.personRecord?.rawSnapshot
        || "",
        displayName
      )
      || (
        isTransientMessagingLoad || isTransientProfileLoad
          ? normalizeWhitespace(state.pageContext?.reason || "")
          : ""
      ),
      displayName
    );
    const observedConversation = currentObservedConversation();
    const draftWorkspace = currentDraftWorkspace();
    const importedAt = observedConversation?.importedAt;
    const generatedAt = draftWorkspace?.generatedAt;
    const updatedAt = state.personRecord?.updatedAt;
    el.personName.textContent = displayName;
    const headerProfileUrl = normalizeWhitespace(
      state.pageContext?.person?.profileUrl
      || state.pageContext?.profile?.profileUrl
      || state.personRecord?.profileUrl
      || ""
    );
    if (el.personName instanceof HTMLAnchorElement) {
      if (headerProfileUrl) {
        el.personName.href = headerProfileUrl;
        el.personName.removeAttribute("aria-disabled");
      } else {
        el.personName.removeAttribute("href");
        el.personName.setAttribute("aria-disabled", "true");
      }
    }
    el.personSubtitle.textContent = displaySubtitle;
    el.personSubtitle.classList.toggle("hidden", !displaySubtitle);
    el.connectionStatusPill.textContent = isTransientMessagingLoad || isTransientProfileLoad
      ? "Loading"
      : connectionLabel(currentConnectionStatus());
    if (el.unsupportedPageMessage) {
      el.unsupportedPageMessage.textContent = "";
      el.unsupportedPageMessage.classList.add("hidden");
    }
    if (el.personCardEditButton) {
      const canEdit = Boolean(normalizeWhitespace(state.personRecord?.personId));
      el.personCardEditButton.classList.toggle("hidden", !canEdit);
      el.personCardEditButton.disabled = !canEdit;
      if (!canEdit) {
        setPersonCardEditorOpen(false);
      }
    }
    el.conversationImportMeta.textContent = "";
    el.conversationImportMeta.classList.add("hidden");
    el.conversationImportMeta.title = "";

    el.lastUpdatedMeta.textContent = "";
    el.lastUpdatedMeta.classList.add("hidden");
    el.lastUpdatedMeta.title = "";

    const recordUuid = normalizeWhitespace(state.personRecord?.uuid || state.personRecord?.system?.recordUuid || "");
    const shouldShowUuid = Boolean(recordUuid && displayName && displayName !== "Open a LinkedIn person");
    el.personRecordUuid.textContent = shouldShowUuid ? `Record ID: ${recordUuid}` : "";
    el.personRecordUuid.classList.toggle("hidden", !shouldShowUuid);
  }

  function renderNextStepEvidence(items) {
    if (!el.nextStepEvidence) {
      return;
    }
    const evidence = Array.isArray(items) ? items.filter(Boolean) : [];
    el.nextStepEvidence.innerHTML = "";
    el.nextStepEvidence.classList.toggle("hidden", !evidence.length);
    evidence.forEach((item) => {
      const chip = document.createElement("span");
      chip.className = "next-step-chip";
      const label = typeof item === "string" ? item : normalizeWhitespace(item?.label);
      const tone = normalizeWhitespace(typeof item === "object" ? item?.tone : "");
      const action = normalizeWhitespace(typeof item === "object" ? item?.action : "");
      chip.classList.toggle("warning", tone === "warning");
      if (label) {
        const text = document.createElement("span");
        text.className = "next-step-chip__label";
        text.textContent = label;
        chip.appendChild(text);
      }
      if (action) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "next-step-chip__action";
        button.dataset.mode = action;
        button.setAttribute("aria-label", "Refresh profile context");
        button.title = "Refresh profile context";
        button.textContent = "↻";
        chip.appendChild(button);
      }
      el.nextStepEvidence.appendChild(chip);
    });
  }

  function applyRecommendationButton(button, config) {
    if (!button) {
      return;
    }
    const mode = normalizeWhitespace(config?.mode);
    const hidden = !config || !mode;
    button.classList.toggle("hidden", hidden);
    button.dataset.mode = mode;
    if (hidden) {
      button.disabled = true;
      delete button.dataset.targetUrl;
      return;
    }
    button.dataset.targetUrl = normalizeWhitespace(config?.targetUrl || "");
    setButtonLabel(button, normalizeWhitespace(config?.label) || "Continue");
    button.disabled = Boolean(config?.disabled);
  }

  function renderRecommendation() {
    const nextStep = currentNextStepState();
    const referralRead = nextStep?.primary?.mode === "draft" ? referralReadinessRead() : "";
    const referralMarkup = nextStep?.primary?.mode === "draft" ? referralReadinessMarkup() : "";

    if (el.actionPillLabel) {
      el.actionPillLabel.textContent = nextStep.badgeLabel || "Waiting";
    } else {
      el.actionPill.textContent = nextStep.badgeLabel || "Waiting";
    }
    renderActionPillGuide(nextStep.badgeLabel || "Waiting");
    el.recommendationReason.innerHTML = renderInlineRichText(nextStep.reason || "Ready when you are.");
    renderNextStepEvidence(nextStep.evidence);
    applyRecommendationButton(el.nextActionButton, nextStep.primary);
    applyRecommendationButton(el.nextHelperButton, nextStep.helper);
    el.referralReadiness.innerHTML = referralMarkup || escapeHtml(referralRead);
    el.referralReadiness.classList.toggle("referral-readiness", Boolean(normalizeWhitespace(referralRead)));
    el.referralReadiness.classList.toggle("hidden", !normalizeWhitespace(referralRead));
    const workspaceStatusText = normalizeWhitespace(nextStep.statusText);
    el.workspaceStatus.innerHTML = renderInlineRichText(workspaceStatusText);
    el.workspaceStatus.classList.toggle("hidden", !workspaceStatusText);
    return nextStep;
  }

  function renderDrafts() {
    const draftWorkspace = currentDraftWorkspace();
    const drafts = Array.isArray(draftWorkspace?.messages) ? draftWorkspace.messages : [];
    const primary = drafts[0] || null;
    const alternatives = drafts.slice(1);

    if (!primary) {
      el.draftSection.classList.add("hidden");
      el.toggleAlternativesButton.classList.add("hidden");
      el.alternativeDrafts.classList.add("hidden");
      el.alternativeDrafts.innerHTML = "";
      el.primaryDraftInput.value = "";
      renderPrimaryDraftMetrics();
      el.primaryDraftReason.textContent = "";
      return;
    }

    el.draftSection.classList.remove("hidden");
    el.primaryDraftLabel.textContent = primary.label || "Best option";
    el.primaryDraftInput.value = primary.message || "";
    renderPrimaryDraftMetrics();
    el.primaryDraftReason.textContent = primary.reason || "";
    autosizeTextarea(el.primaryDraftInput);

    if (!alternatives.length) {
      el.toggleAlternativesButton.classList.add("hidden");
      el.alternativeDrafts.classList.add("hidden");
      el.alternativeDrafts.innerHTML = "";
      return;
    }

    el.toggleAlternativesButton.classList.remove("hidden");
    el.toggleAlternativesButton.textContent = state.showingAlternatives ? "Hide options" : "More options";
    el.alternativeDrafts.classList.toggle("hidden", !state.showingAlternatives);
    el.alternativeDrafts.innerHTML = "";

    if (!state.showingAlternatives) {
      return;
    }

    alternatives.forEach((draft, index) => {
      const card = document.createElement("article");
      card.className = "draft-surface draft-surface--alt";
      card.innerHTML = `
        <div class="draft-toolbar">
          <strong>${draft.label || `Option ${index + 2}`}</strong>
          <button type="button" class="icon-button draft-copy-button" data-action="copy-alt" data-index="${index + 1}">Copy</button>
        </div>
        <textarea class="draft-editor" data-index="${index + 1}" rows="4">${draft.message || ""}</textarea>
        <div class="draft-footer">
          <p class="result-meta draft-metrics" data-role="draft-metrics">${draftMetricsText(draft.message || "")}</p>
          <p class="result-meta draft-reason">${draft.reason || ""}</p>
        </div>
      `;
      el.alternativeDrafts.appendChild(card);
      autosizeTextarea(card.querySelector("textarea"));
    });
  }

  function currentLatestActivitySnippets() {
    const profileContext = getProfileContext(state.personRecord);
    const saved = Array.isArray(profileContext?.latestActivitySnippets) ? profileContext.latestActivitySnippets : [];
    const fallback = Array.isArray(profileContext?.latestProfileData?.activitySnippets)
      ? profileContext.latestProfileData.activitySnippets
      : [];
    return (saved.length ? saved : fallback).filter(Boolean).slice(0, 3);
  }

  function renderRecipientContext() {
    if (!el.recipientSummaryCard || !el.conversationCard || !el.recipientSummaryText || !el.conversationList) {
      return;
    }
    const draftWorkspace = currentDraftWorkspace();
    const observedConversation = currentObservedConversation();
    const profileContext = getProfileContext(state.personRecord);
    const summary = normalizeWhitespace(
      draftWorkspace?.recipient_summary
      || state.personRecord?.recipientSummaryMemory
    );
    const latestActivitySnippets = currentLatestActivitySnippets();
    const lastProfileSyncedAt = normalizeWhitespace(profileContext?.lastProfileSyncedAt);
    const lastActivitySyncedAt = normalizeWhitespace(profileContext?.lastActivitySyncedAt);
    const canRefreshFullProfile = state.pageContext?.pageType === "linkedin-profile"
      && !isOwnProfilePage()
      && Boolean(normalizeWhitespace(state.personRecord?.personId))
      && hasRecipientProfileSnapshot(state.personRecord);
    const rawConversationFallback = normalizeWhitespace(
      observedConversation?.rawThreadText
      || draftWorkspace?.conversation?.rawThreadText
    );
    const recentMessages = (Array.isArray(observedConversation?.messages) && observedConversation.messages.length
      ? observedConversation.messages
      : Array.isArray(draftWorkspace?.conversation?.recentMessages) && draftWorkspace.conversation.recentMessages.length
        ? draftWorkspace.conversation.recentMessages
        : []);

    el.personNoteInput.value = state.personRecord?.personNote || "";
    el.personGoalSelect.value = state.personRecord?.userGoal || "";
    el.extraContextInput.value = state.extraContext || "";

    if (summary || latestActivitySnippets.length || lastProfileSyncedAt) {
      el.recipientSummaryCard.classList.remove("hidden");
      el.recipientSummaryText.textContent = summary;
    } else {
      el.recipientSummaryCard.classList.add("hidden");
      el.recipientSummaryText.textContent = "";
    }
    el.recipientSummaryText.classList.toggle("hidden", !summary);
    if (el.recipientProfileMeta) {
      const profileMetaText = lastProfileSyncedAt
        ? `Profile saved ${formatRelativeTimestamp(lastProfileSyncedAt)}`
        : "";
      el.recipientProfileMeta.textContent = profileMetaText;
      el.recipientProfileMeta.classList.toggle("hidden", !profileMetaText);
      el.recipientProfileMeta.title = profileMetaText ? formatSavedAt(lastProfileSyncedAt) : "";
    }
    if (el.recipientProfileRefreshLink) {
      el.recipientProfileRefreshLink.classList.toggle("hidden", !canRefreshFullProfile);
    }
    if (el.recipientActivityBlock && el.recipientActivityList && el.recipientActivityMeta) {
      el.recipientActivityList.innerHTML = "";
      latestActivitySnippets.forEach((snippet) => {
        const item = document.createElement("li");
        item.textContent = snippet;
        el.recipientActivityList.appendChild(item);
      });
      const activityMetaText = lastActivitySyncedAt
        ? `Synced ${formatRelativeTimestamp(lastActivitySyncedAt)}`
        : "";
      el.recipientActivityMeta.textContent = activityMetaText;
      el.recipientActivityMeta.classList.toggle("hidden", !activityMetaText);
      el.recipientActivityMeta.title = activityMetaText ? formatSavedAt(lastActivitySyncedAt) : "";
      el.recipientActivityBlock.classList.toggle("hidden", !latestActivitySnippets.length);
    }

    if (!recentMessages.length && !rawConversationFallback) {
      el.conversationCard.classList.add("hidden");
      el.conversationList.innerHTML = "";
      if (state.pageContext?.pageType === "linkedin-messaging" && (summary || latestActivitySnippets.length)) {
        el.contextSection?.appendChild(el.recipientSummaryCard);
      }
      return;
    }

    el.conversationCard.classList.remove("hidden");
    if (state.pageContext?.pageType === "linkedin-messaging" && (summary || latestActivitySnippets.length)) {
      el.contextSection?.insertBefore(el.recipientSummaryCard, el.conversationCard.nextSibling);
    } else if (summary || latestActivitySnippets.length) {
      el.contextSection?.insertBefore(el.recipientSummaryCard, el.conversationCard);
    }
    el.conversationList.innerHTML = "";
    if (!recentMessages.length && rawConversationFallback) {
      const item = document.createElement("div");
      item.className = "conversation-item";
      item.innerHTML = `
        <div class="conversation-meta">
          <span>Imported thread text</span>
          <span></span>
        </div>
        <div>${rawConversationFallback}</div>
      `;
      el.conversationList.appendChild(item);
      return;
    }

    const latestMessage = recentMessages[0];
    const earlierMessages = recentMessages.slice(1);

    el.conversationList.appendChild(createConversationItem(latestMessage));

    if (earlierMessages.length) {
      const details = document.createElement("details");
      details.className = "conversation-history-toggle";
      details.open = Boolean(state.conversationHistoryExpanded);
      details.addEventListener("toggle", () => {
        state.conversationHistoryExpanded = details.open;
      });
      const summary = document.createElement("summary");
      summary.textContent = `Show ${earlierMessages.length} earlier message${earlierMessages.length === 1 ? "" : "s"}`;
      details.appendChild(summary);

      const historyList = document.createElement("div");
      historyList.className = "conversation-history-list";
      earlierMessages.forEach((entry) => {
        historyList.appendChild(createConversationItem(entry));
      });
      details.appendChild(historyList);
      el.conversationList.appendChild(details);
    }
  }

  function createConversationItem(entry) {
    const item = document.createElement("div");
    item.className = "conversation-item";
    const meta = document.createElement("div");
    meta.className = "conversation-meta";
    const sender = document.createElement("span");
    const senderLabel = normalizeWhitespace(entry?.sender);
    sender.textContent = /^you(?:\s|$)/i.test(senderLabel) ? (ownDisplayName() || "You") : (senderLabel || "Unknown");
    const timestamp = document.createElement("span");
    timestamp.textContent = formatConversationTimestampForDisplay(entry?.timestamp);
    meta.appendChild(sender);
    meta.appendChild(timestamp);

    const body = document.createElement("div");
    body.className = "conversation-text";
    body.textContent = entry?.text || "";

    item.appendChild(meta);
    item.appendChild(body);
    return item;
  }

  function buildDiagnosticsSnapshot() {
    function linkedInSurfaceMode(url) {
      const normalized = normalizeWhitespace(url || "");
      if (!normalized) {
        return "";
      }
      if (/^https:\/\/www\.linkedin\.com\/messaging\/thread\//i.test(normalized)) {
        return "messaging_thread";
      }
      if (/^https:\/\/www\.linkedin\.com\/messaging\/compose\//i.test(normalized)) {
        return "messaging_compose";
      }
      if (/^https:\/\/www\.linkedin\.com\/messaging\b/i.test(normalized)) {
        return "messaging";
      }
      if (/^https:\/\/www\.linkedin\.com\/in\//i.test(normalized)) {
        return "profile";
      }
      return "other";
    }

    const pageConversation = state.pageContext?.conversation;
    const importedConversation = currentObservedConversation();
    const observedMetrics = currentObservedMetrics();
    const observedRelationshipTriage = state.personRecord?.observedRelationshipTriage || null;
    const draftWorkspace = currentDraftWorkspace();
    const extractedProfileName = normalizeWhitespace(
      state.pageContext?.person?.fullName
      || state.pageContext?.profile?.fullName
      || ""
    );
    const extractedProfileHeadline = normalizeWhitespace(
      state.pageContext?.person?.headline
      || state.pageContext?.profile?.headline
      || ""
    );
    const extractedProfileLocation = normalizeWhitespace(
      state.pageContext?.person?.location
      || state.pageContext?.profile?.location
      || ""
    );
    const extractedMessagingName = normalizeWhitespace(
      state.pageContext?.conversation?.recipientName
      || state.pageContext?.person?.fullName
      || ""
    );
    const extractedMessagingHeadline = normalizeWhitespace(
      state.pageContext?.person?.headline
      || ""
    );
    const extractedMessagingProfileUrl = normalizeWhitespace(
      state.pageContext?.person?.profileUrl
      || ""
    );
    const criticalMessagingReady = Boolean(extractedMessagingName && extractedMessagingProfileUrl);
    const criticalProfileReady = Boolean(extractedProfileName && extractedProfileHeadline);
    const shouldShowTechnicalDetails = true;
    const diagnostics = {
      build_debug_version: normalizeWhitespace(BUILD_DEBUG_VERSION || ""),
      page_supported: Boolean(state.pageContext?.supported),
      page_type: state.pageContext?.pageType || "",
      page_url: state.pageContext?.pageUrl || "",
      requested_source_tab_id: state.lastObservedBrowserTabId || state.activeTabId || null,
      observed_browser_tab_id: state.lastObservedBrowserTabId,
      observed_browser_tab_url: state.lastObservedBrowserTabUrl,
      observed_browser_tab_mode: linkedInSurfaceMode(state.lastObservedBrowserTabUrl),
      background_observed_linkedin_tab_id: state.backgroundObservedLinkedInTabId,
      background_observed_linkedin_tab_url: state.backgroundObservedLinkedInTabUrl,
      background_observed_linkedin_tab_mode: linkedInSurfaceMode(state.backgroundObservedLinkedInTabUrl),
      last_navigation_signal_href: state.lastNavigationSignalHref,
      last_navigation_signal_at: state.lastNavigationSignalAt,
      last_click_tab_id: state.lastLinkedInClickTrace?.tabId || null,
      last_click_page_href_before: state.lastLinkedInClickTrace?.pageHrefBefore || "",
      last_click_href: state.lastLinkedInClickTrace?.clickHref || "",
      last_click_target_mode: linkedInSurfaceMode(state.lastLinkedInClickTrace?.clickHref || ""),
      last_click_text: state.lastLinkedInClickTrace?.clickText || "",
      last_click_at: state.lastLinkedInClickTrace?.at || "",
      pending_navigation_tab_id: state.pendingLinkedInNavigation?.tabId || null,
      pending_navigation_target_href: state.pendingLinkedInNavigation?.targetHref || "",
      pending_navigation_target_mode: linkedInSurfaceMode(state.pendingLinkedInNavigation?.targetHref || ""),
      pending_navigation_started_at: state.pendingLinkedInNavigation?.startedAt || "",
      pending_navigation_resolved_at: state.pendingLinkedInNavigation?.resolvedAt || "",
      pending_navigation_last_seen_tab_url: state.pendingLinkedInNavigation?.lastSeenTabUrl || "",
      messaging_reload_attempted: Boolean(state.messagingReload?.reloadInfo?.attempted),
      messaging_reload_at: state.messagingReload?.reloadInfo?.at || "",
      messaging_reload_url: state.messagingReload?.reloadInfo?.url || "",
      messaging_reloaded_now: Boolean(state.messagingReload?.reloaded),
      extracted_profile_name: extractedProfileName,
      extracted_profile_headline: extractedProfileHeadline,
      extracted_profile_location: extractedProfileLocation,
      critical_profile_ready: criticalProfileReady,
      extracted_messaging_name: extractedMessagingName,
      extracted_messaging_headline: extractedMessagingHeadline,
      extracted_messaging_profile_url: extractedMessagingProfileUrl,
      critical_messaging_ready: criticalMessagingReady,
      visible_thread_url: normalizeWhitespace(state.pageContext?.conversation?.threadUrl || ""),
      page_reason: state.pageContext?.reason || "",
      person_name: state.pageContext?.person?.fullName || state.personRecord?.fullName || "",
      person_id: state.pageContext?.person?.personId || state.personRecord?.personId || "",
      stored_person_id: state.personRecord?.personId || "",
      sender_profile_saved: Boolean(normalizeWhitespace(state.myProfile?.rawSnapshot)),
      sender_profile_url: normalizeWhitespace(state.myProfile?.ownProfileUrl || ""),
      saved_summary_present: Boolean(normalizeWhitespace(state.personRecord?.recipientSummaryMemory)),
      visible_message_count: Array.isArray(pageConversation?.allVisibleMessages)
        ? pageConversation.allVisibleMessages.length
        : Array.isArray(pageConversation?.recentMessages)
          ? pageConversation.recentMessages.length
          : 0,
      imported_message_count: Array.isArray(importedConversation?.messages) ? importedConversation.messages.length : 0,
      observed_conversation_saved: Boolean(Array.isArray(importedConversation?.messages) && importedConversation.messages.length),
      observed_metrics_saved: Boolean(observedMetrics),
      observed_relationship_triage_saved: Boolean(observedRelationshipTriage),
      observed_last_interaction_at: normalizeWhitespace(state.personRecord?.lastInteractionAt),
      observed_last_updated_at: normalizeWhitespace(state.personRecord?.updatedAt),
      observed_last_speaker: normalizeWhitespace(importedConversation?.lastSpeaker),
      observed_last_message_at: normalizeWhitespace(importedConversation?.lastMessageAt),
      last_import_sync_message: state.lastImportSyncMessage || "",
      workspace_reason_why_now: draftWorkspace?.reason_why_now || "",
      observed_metrics: observedMetrics,
      observed_relationship_triage: observedRelationshipTriage,
      relationship_triage: currentRelationshipTriage(),
      generation_diagnostics: state.lastGenerationDiagnostics || null,
      resolution_diagnostics: state.resolutionDiagnostics || null,
      sender_profile_extraction_diagnostics: state.lastProfileExtractionDiagnostics || null,
      sender_profile_save_diagnostics: state.lastSenderProfileSaveDiagnostics || null,
      open_messages_diagnostics: state.lastOpenMessagesDiagnostics || null,
      debug: state.pageContext?.debug || null
    };
    return {
      shouldShowTechnicalDetails,
      diagnostics
    };
  }

  function renderManualRecovery() {
    const { shouldShowTechnicalDetails, diagnostics } = buildDiagnosticsSnapshot();
    const draftWorkspace = currentDraftWorkspace();
    const currentJob = currentGenerationJob();
    const liveProviderPrompt = typeof currentJob?.providerPrompt === "string" ? currentJob.providerPrompt : "";
    if (el.globalLogsPanel) {
      el.globalLogsPanel.classList.toggle("hidden", !shouldShowTechnicalDetails);
    }
    if (el.globalDiagnosticsSummary) {
      el.globalDiagnosticsSummary.textContent = state.manualRecovery
        ? "Technical details available"
        : "Technical details";
    }
    if (!shouldShowTechnicalDetails) {
      if (el.globalDiagnosticsDetails) {
        el.globalDiagnosticsDetails.open = false;
      }
      return;
    }
    el.pageDiagnostics.value = JSON.stringify(diagnostics, null, 2);
    el.senderProfileExtracted.value = state.myProfile?.rawSnapshot || "";
    el.manualPrompt.value = state.manualRecovery?.prompt || liveProviderPrompt || draftWorkspace?.providerPrompt || "";
    el.manualRawOutput.value = state.manualRecovery?.rawOutput || draftWorkspace?.rawOutput || "";
  }

  function renderDashboard() {
    renderDashboardActivityCard();
    const counts = dashboardCounts();
    const summaryCards = [
      [el.dashboardSummaryNeedsAction, "reply_now"],
      [el.dashboardSummaryFollowUp, "follow_up"],
      [el.dashboardSummaryWarm, "warm"],
      [el.dashboardSummaryWaiting, "waiting"],
      [el.dashboardSummaryDeprioritize, "deprioritize"]
    ];

    summaryCards.forEach(([button, section]) => {
      if (!button) {
        return;
      }
      const countNode = button.querySelector(".dashboard-summary-count");
      if (countNode) {
        countNode.textContent = String(counts[section] || 0);
      }
      button.classList.toggle("is-active", state.dashboardSection === section);
    });

    if (el.dashboardFilterSelect) {
      el.dashboardFilterSelect.value = state.dashboardFilter;
    }
    if (el.dashboardSortSelect) {
      el.dashboardSortSelect.value = state.dashboardSort;
    }
    const replyCount = counts.reply_now || 0;
    const referralCount = counts.warm || 0;
    el.dashboardMeta.textContent = `${state.allPeople.length} tracked ${state.allPeople.length === 1 ? "person" : "people"} - ${replyCount} need replies - ${referralCount} in referral pipeline`;

    const entries = filteredDashboardEntries();
    el.dashboardList.innerHTML = "";

    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "dashboard-empty";
      empty.textContent = state.allPeople.length
        ? "No people match this filter right now."
        : "No relationships tracked yet. Open a LinkedIn profile or message thread to start building the dashboard.";
      el.dashboardList.appendChild(empty);
      return;
    }

    entries.forEach((entry) => {
      const destinationUrl = normalizeWhitespace(entry.messagingThreadUrl) || normalizeWhitespace(entry.profileUrl);
      const row = document.createElement("article");
      row.className = `dashboard-row dashboard-row--${entry.section}`;
      const top = document.createElement("div");
      top.className = "dashboard-row-top";

      const titleGroup = document.createElement("div");
      titleGroup.className = "dashboard-row-title";
      const titleRow = document.createElement("div");
      titleRow.className = "dashboard-row-title-line";
      const name = destinationUrl ? document.createElement("a") : document.createElement("strong");
      name.className = destinationUrl ? "dashboard-person-link" : "dashboard-person-name";
      if (destinationUrl) {
        name.href = destinationUrl;
        name.dataset.dashboardOpen = entry.personId;
      }
      name.textContent = entry.fullName;
      const stageBadge = document.createElement("span");
      stageBadge.className = "dashboard-stage-badge";
      stageBadge.textContent = entry.stageLabel;
      const subtitle = document.createElement("span");
      subtitle.className = "dashboard-row-subtitle";
      subtitle.textContent = entry.subtitle || "No title saved yet";
      titleRow.appendChild(name);
      titleRow.appendChild(stageBadge);
      titleGroup.appendChild(titleRow);
      titleGroup.appendChild(subtitle);

      top.appendChild(titleGroup);

      const meta = document.createElement("div");
      meta.className = "dashboard-pill-row";
      [entry.activityLabel, `Readiness ${entry.referralReadinessScore || 0}/100`]
        .filter(Boolean)
        .forEach((text) => {
          const chip = document.createElement("span");
          chip.textContent = text;
          meta.appendChild(chip);
        });

      const preview = createDashboardPreviewBlock(entry);

      const updated = document.createElement("p");
      updated.className = "meta-text dashboard-updated-text";
      updated.textContent = entry.person?.updatedAt ? `Updated ${formatSavedAt(entry.person.updatedAt)}` : "";

      row.appendChild(top);
      row.appendChild(meta);
      if (preview) {
        row.appendChild(preview);
      }
      if (updated.textContent) {
        row.appendChild(updated);
      }
      el.dashboardList.appendChild(row);
    });
  }

  function setViewMode(nextMode) {
    state.viewMode = nextMode === "dashboard" ? "dashboard" : "workspace";
    el.workspaceView.classList.toggle("hidden", state.viewMode !== "workspace");
    el.dashboardView.classList.toggle("hidden", state.viewMode !== "dashboard");
    el.workspaceViewButton.classList.toggle("is-active", state.viewMode === "workspace");
    el.dashboardViewButton.classList.toggle("is-active", state.viewMode === "dashboard");
    if (state.viewMode === "dashboard") {
      renderDashboard();
    }
  }

  function updateAutoRefreshTimer() {
    window.clearInterval(state.autoRefreshTimer);
    state.autoRefreshTimer = null;

    if (state.pageContext?.pageType !== "linkedin-messaging") {
      return;
    }

    state.autoRefreshTimer = window.setInterval(() => {
      const isBusy = Boolean(state.activeGenerationRequestId || state.refreshInFlight);
      if (isBusy || document.hidden) {
        return;
      }
      void refreshState({ preserveStatus: true, allowCached: true, suppressImportStatus: true });
    }, MESSAGE_THREAD_POLL_MS);
  }

  function clearTransientMessagingRetry() {
    window.clearTimeout(state.transientMessagingRetryTimer);
    state.transientMessagingRetryTimer = null;
    state.transientMessagingRetryCount = 0;
  }

  function clearNavigationRefreshBurst() {
    state.navigationRefreshTimers.forEach((timerId) => window.clearTimeout(timerId));
    state.navigationRefreshTimers = [];
  }

  function scheduleNavigationRefreshBurst(options) {
    clearNavigationRefreshBurst();
    [250, 1500].forEach((delayMs, index) => {
      const timerId = window.setTimeout(() => {
        void refreshState({
          preserveStatus: true,
          allowCached: false,
          showOverlay: index === 0,
          suppressImportStatus: options?.suppressImportStatus ?? true
        });
      }, delayMs);
      state.navigationRefreshTimers.push(timerId);
    });
  }

  function scheduleTransientMessagingRetry() {
    if (state.transientMessagingRetryCount >= 3 || state.transientMessagingRetryTimer) {
      return;
    }
    state.transientMessagingRetryCount += 1;
    const retryDelays = [450, 1100, 2000];
    const delayMs = retryDelays[state.transientMessagingRetryCount - 1] || retryDelays[retryDelays.length - 1];
    state.transientMessagingRetryTimer = window.setTimeout(() => {
      state.transientMessagingRetryTimer = null;
      void refreshState({ preserveStatus: true, allowCached: false, showOverlay: false, suppressImportStatus: true });
    }, delayMs);
  }

  function scrollContainer() {
    return document.scrollingElement || document.documentElement || document.body;
  }

  function snapshotScrollPosition() {
    const container = scrollContainer();
    return container ? container.scrollTop : 0;
  }

  function restoreScrollPosition(previousTop) {
    const container = scrollContainer();
    if (!container || !Number.isFinite(previousTop)) {
      return;
    }
    container.scrollTop = previousTop;
  }

  function applyOptimisticNavigationHint(href, clickText) {
    const nextHref = normalizeWhitespace(href);
    if (!/^https:\/\/www\.linkedin\.com\/(?:in|messaging)\b/i.test(nextHref)) {
      return;
    }
    const currentHref = normalizeWhitespace(state.pageContext?.pageUrl || state.lastObservedBrowserTabUrl || "");
    const isDifferentSurface = nextHref.replace(/\/+$/, "") !== currentHref.replace(/\/+$/, "");
    if (isDifferentSurface) {
      setNavigationHold(nextHref);
    }
  }

  function renderPageStatus(options) {
    clearNavigationHold();
    const preserveStatus = Boolean(options?.preserveStatus);
    const hasSavedProfile = hasSavedSenderProfile();
    const supported = Boolean(state.pageContext?.supported);
    const isTransientMessagingLoad = state.pageContext?.pageType === "linkedin-messaging"
      && /loading selected conversation/i.test(state.pageContext?.reason || "");
    const isTransientProfileLoad = state.pageContext?.pageType === "linkedin-profile"
      && /loading profile/i.test(state.pageContext?.reason || "");
    const canImportConversation = state.pageContext?.pageType === "linkedin-messaging";
    const hasImportedConversation = Boolean(currentObservedConversation());
    const onOwnProfilePage = isSavedOwnProfilePage();
    const onPendingOwnProfilePage = isPendingOwnProfilePage();
    const showSetupOnly = !hasSavedProfile || onPendingOwnProfilePage || onOwnProfilePage;
    const currentJob = currentGenerationJob();
    const jobProgressText = normalizeWhitespace(currentJob?.progressText);
    const currentSourceTabId = preferredLinkedInTabId();
    const currentPersonId = normalizeWhitespace(state.personRecord?.personId);
    const localProgressAppliesToCurrentPerson = Boolean(
      currentSourceTabId !== null
      && currentSourceTabId === state.activeGenerationSourceTabId
      && currentPersonId
      && currentPersonId === normalizeWhitespace(state.activeGenerationPersonId)
      && state.activeGenerationRequestId
      && state.generationProgressText
    );

    el.topToolbar?.classList.remove("hidden");

    renderHeader();
    const nextStep = renderRecommendation();
    renderDrafts();
    renderRecipientContext();
    renderManualRecovery();
    renderDashboard();
    renderSenderProfilePrompt();
    if (showSetupOnly) {
      el.statusCard?.classList.add("hidden");
      el.recommendationSection?.classList.add("hidden");
      el.contextSection?.classList.add("hidden");
      el.draftSection?.classList.add("hidden");
    } else {
      el.statusCard?.classList.remove("hidden");
      el.recommendationSection?.classList.toggle("hidden", onOwnProfilePage);
      el.contextSection?.classList.remove("hidden");
    }

    if (showSetupOnly) {
      if (!preserveStatus) {
        setStatus(
          onPendingOwnProfilePage
            ? "Update this page to switch your saved profile."
            : onOwnProfilePage
            ? "Update your profile from this page."
            : canCaptureCurrentProfilePage() && !configuredOwnProfileUrl()
              ? "If this is your profile, save this page now."
              : "Save your profile first.",
          false,
          "warning",
          { source: "ambient" }
        );
      }
      el.nextActionButton.disabled = true;
      applyRecommendationButton(el.nextHelperButton, null);
      if (el.updateProfileButton) {
        el.updateProfileButton.disabled = !canUpdateSenderProfileNow();
        el.updateProfileButton.classList.add("hidden");
      }
      if (el.importConversationButton) {
        el.importConversationButton.classList.toggle("hidden", !canImportConversation);
        el.importConversationButton.disabled = !canImportConversation;
      }
      if (el.clearConversationButton) {
        el.clearConversationButton.classList.toggle("hidden", !hasImportedConversation);
        el.clearConversationButton.disabled = !hasImportedConversation;
      }
      return;
    }

    if (!supported && !preserveStatus) {
      setStatus("", false, "", { source: "ambient" });
    }

    if (!preserveStatus) {
      const progressActive = Boolean(
        localProgressAppliesToCurrentPerson
        || jobProgressText
      );
      setStatus(
        progressActive ? (jobProgressText || state.generationProgressText) : "",
        false,
        progressActive ? "progress" : "",
        { source: progressActive ? "direct" : "ambient" }
      );
    }
    el.nextActionButton.disabled = shouldDisableNextActionButton({
      forceDisabled: Boolean(onOwnProfilePage),
      nextStep
    });
    if (el.updateProfileButton) {
      el.updateProfileButton.classList.remove("hidden");
      setButtonLabel(el.updateProfileButton, isSavedOwnProfilePage() ? "Refresh my profile" : "Update Profile");
      el.updateProfileButton.disabled = state.pageContext?.pageType !== "linkedin-profile" || (normalizedOwnProfileUrl() && !isSavedOwnProfilePage());
    }
    if (el.importConversationButton) {
      el.importConversationButton.classList.toggle("hidden", !canImportConversation);
      if (canImportConversation) {
        el.importConversationButton.disabled = false;
        el.importConversationButton.textContent = currentObservedConversation()
          ? "Refresh conversation context"
          : "Import conversation";
      }
    }
    if (el.clearConversationButton) {
      el.clearConversationButton.classList.toggle("hidden", !hasImportedConversation);
      el.clearConversationButton.disabled = !hasImportedConversation;
    }
  }

  function mergeRefreshOptions(left, right) {
    const leftSuppress = left ? Boolean(left.suppressImportStatus) : null;
    const rightSuppress = right ? Boolean(right.suppressImportStatus) : null;
    return {
      preserveStatus: Boolean(left?.preserveStatus || right?.preserveStatus),
      showOverlay: Boolean(left?.showOverlay || right?.showOverlay),
      allowCached: Boolean(left?.allowCached || right?.allowCached),
      suppressImportStatus:
        leftSuppress === null
          ? (rightSuppress ?? false)
          : rightSuppress === null
            ? leftSuppress
            : leftSuppress && rightSuppress
    };
  }

  function buildRefreshCacheKey(sourceTabId) {
    const tabId = typeof sourceTabId === "number" ? sourceTabId : -1;
    const surfaceUrl = normalizeWhitespace(currentObservedSurfaceUrl() || state.pageContext?.pageUrl || "");
    return `${tabId}::${surfaceUrl}`;
  }

  function cloneRefreshResponse(response) {
    if (!response) {
      return null;
    }
    try {
      return JSON.parse(JSON.stringify(response));
    } catch (_error) {
      return null;
    }
  }

  function isStableRefreshResponse(response) {
    const pageContext = response?.pageContext || null;
    if (!pageContext?.supported) {
      return false;
    }
    const reason = normalizeWhitespace(pageContext?.reason || "");
    if (/loading/i.test(reason)) {
      return false;
    }
    return true;
  }

  function readCachedRefreshResponse(cacheKey, options) {
    if (!options?.allowCached || !cacheKey) {
      return null;
    }
    const cached = state.refreshCache || {};
    if (cached.key !== cacheKey || !cached.response) {
      return null;
    }
    const ageMs = Date.now() - Number(cached.savedAt || 0);
    if (ageMs > REFRESH_CACHE_MAX_AGE_MS) {
      return null;
    }
    if (!isStableRefreshResponse(cached.response)) {
      return null;
    }
    return cloneRefreshResponse(cached.response);
  }

  function hasUsableCachedRefreshResponse(cacheKey) {
    if (!cacheKey) {
      return false;
    }
    return Boolean(readCachedRefreshResponse(cacheKey, { allowCached: true }));
  }

  function writeCachedRefreshResponse(cacheKey, response) {
    if (!cacheKey || !response) {
      return;
    }
    state.refreshCache = {
      key: cacheKey,
      savedAt: Date.now(),
      response: cloneRefreshResponse(response)
    };
  }

  function clearRefreshCache() {
    state.refreshCache = {
      key: "",
      savedAt: 0,
      response: null
    };
  }

  function refreshResponsesEquivalent(left, right) {
    if (!left || !right) {
      return false;
    }
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch (_error) {
      return false;
    }
  }

  function applyRefreshResponse(response, options) {
    const previousScrollTop = snapshotScrollPosition();
    const previousPersonId = state.personRecord?.personId || "";
    const previousPersonRecord = state.personRecord;
    const previousWorkspace = state.workspace;
    const previousPageUrl = normalizeWhitespace(state.pageContext?.pageUrl || "");
    const previousViewKey = personViewKey(previousPersonRecord, state.pageContext?.conversation);
    const nextPageContext = response.pageContext;
    const isTransientMessagingLoad = nextPageContext?.pageType === "linkedin-messaging"
      && (!nextPageContext?.supported || !response.currentPerson?.personId);
    const isTransientProfileLoad = nextPageContext?.pageType === "linkedin-profile"
      && !nextPageContext?.supported;
    const samePageUrlAsPrevious = normalizeWhitespace(nextPageContext?.pageUrl || "") === previousPageUrl;
    const pageViewKey = personViewKey(nextPageContext?.person, nextPageContext?.conversation);
    const resolvedViewKey = personViewKey(response.currentPerson, nextPageContext?.conversation);
    const hasVisiblePersonSwitch = Boolean(
      nextPageContext?.pageType === "linkedin-messaging"
      && pageViewKey
      && pageViewKey !== previousViewKey
    );

    state.pageContext = nextPageContext;
    state.activeTabId = response.activeTabId || response.pageContext?.tabId || null;
    state.attachedLinkedInTabId = response.activeTabId
      || response.pageContext?.tabId
      || response.backgroundObservedLinkedInTabId
      || state.attachedLinkedInTabId
      || null;
    state.backgroundObservedLinkedInTabId = response.backgroundObservedLinkedInTabId || null;
    state.backgroundObservedLinkedInTabUrl = normalizeWhitespace(response.backgroundObservedLinkedInTabUrl || "");
    state.lastLinkedInClickTrace = response.lastLinkedInClickTrace || null;
    state.pendingLinkedInNavigation = response.pendingLinkedInNavigation || null;
    state.messagingReload = response.messagingReload || null;
    state.myProfile = response.myProfile || defaultMyProfile();
    state.fixedTail = response.fixedTail || FIXED_TAIL;
    state.promptSettings = response.promptSettings || defaultPromptSettings();
    state.allPeople = Array.isArray(response.allPeople) ? response.allPeople : [];
    state.generationJobs = Array.isArray(response.generationJobs) ? response.generationJobs : [];
    state.identityWarning = response.identityWarning || null;
    state.identityResolutionRequest = response.identityResolutionRequest || null;
    state.resolutionDiagnostics = response.resolutionDiagnostics || null;
    if (!state.identityResolutionRequest?.requestKey || state.identityResolutionRequest.requestKey !== state.dismissedIdentityResolutionRequestKey) {
      state.dismissedIdentityResolutionRequestKey = "";
    }
    const resolvedCurrentPerson = findSavedPersonRecord(response.currentPerson, nextPageContext?.conversation)
      || response.currentPerson
      || defaultPersonRecord();
    state.personRecord = (isTransientMessagingLoad || isTransientProfileLoad) && previousPersonId && samePageUrlAsPrevious
      ? previousPersonRecord
      : resolvedCurrentPerson;
    state.workspace = (isTransientMessagingLoad || isTransientProfileLoad) && previousPersonId && samePageUrlAsPrevious
      ? previousWorkspace
      : currentDraftWorkspace(state.personRecord);

    if (
      nextPageContext?.pageType === "linkedin-messaging"
      && nextPageContext?.supported
      && pageViewKey
      && resolvedViewKey
      && pageViewKey !== resolvedViewKey
    ) {
      state.personRecord = findSavedPersonRecord(previewPersonRecord(nextPageContext, response.currentPerson), nextPageContext?.conversation)
        || previewPersonRecord(nextPageContext, response.currentPerson);
      state.workspace = currentDraftWorkspace(state.personRecord);
    } else if (
      nextPageContext?.pageType === "linkedin-messaging"
      && nextPageContext?.supported
      && hasVisiblePersonSwitch
      && !resolvedViewKey
    ) {
      state.personRecord = findSavedPersonRecord(previewPersonRecord(nextPageContext, previousPersonRecord), nextPageContext?.conversation)
        || previewPersonRecord(nextPageContext, previousPersonRecord);
      state.workspace = currentDraftWorkspace(state.personRecord);
    }

    state.lastImportSyncMessage = response.importSyncMessage || "";
    if ((state.personRecord?.personId || "") !== previousPersonId || hasVisiblePersonSwitch) {
      state.extraContext = currentDraftWorkspace(state.personRecord)?.extra_context || "";
      state.conversationHistoryExpanded = false;
    } else if (!state.extraContext && currentDraftWorkspace(state.personRecord)?.extra_context) {
      state.extraContext = currentDraftWorkspace(state.personRecord).extra_context;
    }
    const currentViewKey = personViewKey(state.personRecord, state.pageContext?.conversation);
    if (normalizeWhitespace(state.personRecord?.personId) && currentViewKey) {
      markCtaReady(currentViewKey, state.personRecord.personId);
    }
    el.fixedTailInput.value = state.fixedTail;
    populateProfileForm(state.myProfile);
    populatePromptSettingsForm(state.promptSettings);
    const shouldPreserveStatus = Boolean(options?.preserveStatus) && currentViewKey === previousViewKey;
    restoreStatusStateForCurrentScope();
    renderPageStatus({ preserveStatus: shouldPreserveStatus });
    restoreScrollPosition(previousScrollTop);
    updateAutoRefreshTimer();
    if (isTransientMessagingLoad || isTransientProfileLoad) {
      scheduleTransientMessagingRetry();
    } else {
      clearTransientMessagingRetry();
    }
    if (
      state.pendingLinkedInNavigation?.targetHref
      && !state.pendingLinkedInNavigation?.resolvedAt
      && (
        !normalizeWhitespace(state.pageContext?.pageUrl)
        || normalizeWhitespace(state.pageContext?.pageUrl) === normalizeWhitespace(state.lastLinkedInClickTrace?.pageHrefBefore || "")
        || state.pageContext?.pageType === "unsupported"
      )
    ) {
      scheduleNavigationRefreshBurst();
    }
    if (!options?.suppressImportStatus && response.importedChanged && response.importSyncMessage) {
      setStatus(response.importSyncMessage, false);
    }
  }

  async function performRefreshState(options) {
    const requestedSourceTabId = preferredLinkedInTabId();
    const refreshCacheKey = buildRefreshCacheKey(requestedSourceTabId);
    const cachedResponse = readCachedRefreshResponse(refreshCacheKey, options);
    if (cachedResponse) {
      applyRefreshResponse(cachedResponse, options);
    }
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.GET_STORAGE_STATE,
      sourceTabId: requestedSourceTabId
    });
    writeCachedRefreshResponse(refreshCacheKey, response);
    if (!cachedResponse || !refreshResponsesEquivalent(cachedResponse, response)) {
      applyRefreshResponse(response, options);
    }
  }

  function refreshState(options) {
    state.pendingRefreshOptions = mergeRefreshOptions(state.pendingRefreshOptions, options);
    if (state.refreshInFlight) {
      return state.refreshPromise || Promise.resolve();
    }

    const run = async () => {
      while (state.pendingRefreshOptions) {
        const nextOptions = state.pendingRefreshOptions;
        state.pendingRefreshOptions = null;
        await performRefreshState(nextOptions);
      }
    };

    state.refreshInFlight = true;
    state.refreshPromise = run()
      .finally(() => {
        state.refreshInFlight = false;
        state.refreshPromise = null;
      });
    return state.refreshPromise;
  }

  async function saveFixedTail(nextValue) {
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.SAVE_FIXED_TAIL,
      fixedTail: nextValue
    });
    if (response?.ok) {
      state.fixedTail = response.fixedTail;
      el.fixedTailInput.value = state.fixedTail;
    }
  }

  async function saveOwnProfileUrl(nextUrl) {
    const ownProfileUrl = normalizeWhitespace(nextUrl);
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.SAVE_MY_PROFILE,
      profile: {
        ownProfileUrl,
        manualNotes: state.myProfile?.manualNotes || "",
        rawSnapshot: state.myProfile?.rawSnapshot || ""
      }
    });
    if (response?.ok) {
      state.myProfile = response.profile || state.myProfile;
      if (el.senderProfileUrlInput && document.activeElement !== el.senderProfileUrlInput) {
        el.senderProfileUrlInput.value = state.myProfile?.ownProfileUrl || "";
      }
      if (el.senderProfileSettingsUrl && document.activeElement !== el.senderProfileSettingsUrl) {
        el.senderProfileSettingsUrl.value = state.myProfile?.ownProfileUrl || "";
      }
    }
    return response;
  }

  async function openSenderProfileUrl() {
    const url = normalizeWhitespace(el.senderProfileUrlInput?.value || el.senderProfileSettingsUrl?.value || state.myProfile?.ownProfileUrl || "");
    if (!url) {
      setStatus("Paste your LinkedIn profile URL first.", true);
      return;
    }
    const pendingResponse = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.SET_PENDING_MY_PROFILE_TARGET,
      ownProfileUrl: url
    });
    if (pendingResponse?.ok) {
      state.myProfile = pendingResponse.myProfile || state.myProfile;
    }
    syncOwnProfileUrlInputs(url);
    const currentUrl = currentProfileUrl();
    if (currentUrl && currentUrl.replace(/\/+$/, "") === url.replace(/\/+$/, "")) {
      setViewMode("workspace");
      el.settingsSection?.classList.add("hidden");
      void refreshState({ preserveStatus: true, suppressImportStatus: true });
      renderPageStatus({ preserveStatus: true });
      setStatus("You are already on your LinkedIn profile.", false);
      return;
    }
    try {
      const sourceTabId = await getSourceTabId();
      setViewMode("workspace");
      el.settingsSection?.classList.add("hidden");
      applyOptimisticNavigationHint(url, "");
      if (sourceTabId) {
        await chrome.tabs.update(sourceTabId, { url, active: true });
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
      scheduleNavigationRefreshBurst({ suppressImportStatus: true });
      setStatus("Opening your LinkedIn profile.", false, "progress");
    } catch (error) {
      setStatus(error.message || String(error), true);
    }
  }

  async function openCurrentLinkedInDestination(kind, destinationOverride) {
    const person = currentNextStepPerson();
    const profileUrl = currentRecipientProfileUrl(person);
    const threadUrl = currentThreadUrl(person);
    const destinationUrl = normalizeWhitespace(destinationOverride || (kind === "thread" ? threadUrl : profileUrl));
    const destinationLabel = kind === "thread" ? "thread" : "profile";
    const currentUrl = normalizeWhitespace(state.pageContext?.pageUrl || "");

    if (!destinationUrl) {
      setStatus(`No LinkedIn ${destinationLabel} URL is saved for this person yet.`, true);
      return;
    }
    if (currentUrl && currentUrl.replace(/\/+$/, "") === destinationUrl.replace(/\/+$/, "")) {
      if (kind === "profile" && state.pageContext?.pageType === "linkedin-profile") {
        await refreshRecipientProfileContext();
        return;
      }
      setStatus(`You are already on this ${destinationLabel}.`, false);
      return;
    }

    try {
      const sourceTabId = await getSourceTabId();
      if (sourceTabId) {
        await chrome.tabs.update(sourceTabId, { url: destinationUrl, active: true });
      } else {
        window.open(destinationUrl, "_blank", "noopener,noreferrer");
      }
      if (kind === "profile") {
        setStatus("Opening profile so the assistant can refresh profile context.", false, "progress");
      }
    } catch (error) {
      setStatus(error.message || String(error), true);
    }
  }

  async function openCurrentLinkedInMessages(profileUrlOverride) {
    const person = currentNextStepPerson();
    const profileUrl = normalizeWhitespace(profileUrlOverride || currentRecipientProfileUrl(person));
    if (!profileUrl) {
      setStatus("No LinkedIn profile URL is saved for this person yet.", true);
      return;
    }

    setStatus("Opening LinkedIn messages for this person.", false, "progress");
    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.OPEN_PERSON_MESSAGES,
        sourceTabId: await getSourceTabId(),
        profileUrl
      });
      if (!response?.ok) {
        throw new Error(response?.error || "Unable to open LinkedIn messages for this person.");
      }
      state.lastOpenMessagesDiagnostics = response.openMessagesDebug || null;
      if (response.personRecord?.personId) {
        state.personRecord = mergePersonRecord(state.personRecord, response.personRecord);
      }
      await refreshState({ preserveStatus: true });
      scheduleNavigationRefreshBurst({ suppressImportStatus: false });
      const syncMessage = normalizeWhitespace(response?.autoImport?.syncMessage || "");
      if (syncMessage) {
        setStatus(syncMessage, false);
        return;
      }
      switch (normalizeWhitespace(response?.autoImport?.result || "")) {
        case "thread_visible":
        case "imported":
        case "unchanged":
          setStatus("Opened LinkedIn messaging.", false);
          return;
        case "messaging_surface_no_messages":
        case "compose_overlay_visible":
          setStatus("LinkedIn opened a message composer, but no visible thread history was available to import yet.", false);
          return;
        case "no_surface_detected":
          setStatus("Clicked LinkedIn Message, but no messaging surface was detected yet.", true);
          return;
        default:
          setStatus(
            response.navigatedToProfile
              ? "Opened the profile and triggered LinkedIn messaging."
              : "Opened LinkedIn messaging.",
            false
          );
      }
    } catch (error) {
      setStatus(error.message || String(error), true);
    }
  }

  async function refreshRecipientProfileContext() {
    if (state.pageContext?.pageType !== "linkedin-profile" || isOwnProfilePage()) {
      setStatus("Open the recipient's LinkedIn profile first.", true);
      return;
    }
    setStatus("Refreshing profile context from the current LinkedIn page. LinkedIn needs a short scroll pass to load the full profile.", false, "progress");
    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.UPDATE_RECIPIENT_PROFILE_CONTEXT,
        sourceTabId: await getSourceTabId()
      });
      if (!response?.ok) {
        throw new Error(response?.error || "Unable to refresh profile context.");
      }
      state.personRecord = response.personRecord || state.personRecord;
      const refreshed = hasRecipientProfileSnapshot(currentNextStepPerson());
      await refreshState({ preserveStatus: true });
      setStatus(
        refreshed
          ? "Profile context refreshed."
          : "Still waiting for LinkedIn to finish loading this profile.",
        !refreshed
      );
    } catch (error) {
      setStatus(error.message || String(error), true);
    }
  }

  async function handleNextStepAction(button) {
    const mode = normalizeWhitespace(button?.dataset?.mode);
    const targetUrl = normalizeWhitespace(button?.dataset?.targetUrl || "");
    switch (mode) {
      case "open_profile":
        await openCurrentLinkedInDestination("profile", targetUrl);
        return;
      case "open_messages":
        await openCurrentLinkedInMessages(targetUrl);
        return;
      case "open_thread":
        await openCurrentLinkedInDestination("thread", targetUrl);
        return;
      case "import_conversation":
        await handleImportConversation();
        return;
      case "refresh_profile_context":
        await refreshRecipientProfileContext();
        return;
      case "draft":
      default:
        await handleGenerate();
    }
  }

  function scheduleFixedTailSave() {
    window.clearTimeout(state.fixedTailSaveTimer);
    state.fixedTailSaveTimer = window.setTimeout(() => {
      saveFixedTail(el.fixedTailInput.value);
    }, 300);
  }

  async function handleGenerate() {
    setLoading(el.nextActionButton, "Drafting…", true);
    state.manualRecovery = null;
    const requestId = makeRequestId();
    const currentPersonId = normalizeWhitespace(state.personRecord?.personId);
    try {
      const sourceTabId = await getSourceTabId();
      state.activeGenerationRequestId = requestId;
      state.activeGenerationPersonId = currentPersonId;
      state.activeGenerationSourceTabId = typeof sourceTabId === "number" ? sourceTabId : null;
      state.generationProgressText = "Queued...";
      renderManualRecovery();
      setStatus(state.generationProgressText, false, "progress");
      const response = await chrome.runtime.sendMessage(buildFreshGenerateForRecipientCommand({
        requestId,
        sourceTabId,
        personRecord: state.personRecord,
        fixedTail: el.fixedTailInput.value,
        personNote: el.personNoteInput.value,
        userGoal: el.personGoalSelect.value,
        extraContext: el.extraContextInput.value
      }));
      if (!response?.ok) {
        state.manualRecovery = response?.manualRecovery || null;
        state.lastGenerationDiagnostics = response?.diagnostics || null;
        throw new Error(response?.error || "Generation failed.");
      }
      state.extraContext = el.extraContextInput.value;
      state.showingAlternatives = false;
      renderPageStatus({ preserveStatus: true });
    } catch (error) {
      if (state.activeGenerationRequestId === requestId) {
        state.activeGenerationRequestId = "";
        state.activeGenerationPersonId = "";
        state.activeGenerationSourceTabId = null;
        state.generationProgressText = "";
      }
      setStatus(error.message || String(error), true);
      renderManualRecovery();
    } finally {
      setLoading(el.nextActionButton, "Drafting…", false);
      renderPageStatus({ preserveStatus: true });
    }
  }

  async function handleUpdateProfile(options) {
    const allowCurrentPageCapture = Boolean(options?.allowCurrentPageCapture);
    const firstTimeSave = !normalizeWhitespace(state.myProfile?.rawSnapshot);
    const pendingOwnProfilePage = isPendingOwnProfilePage();
    const shouldAutoSaveProfile = firstTimeSave || pendingOwnProfilePage;
    const targetProfileUrl = normalizeWhitespace(el.senderProfileUrlInput?.value || configuredOwnProfileUrl());
    const pageProfileUrl = normalizeWhitespace(currentProfileUrl());
    const hasDifferentTargetProfile = Boolean(
      targetProfileUrl
      && pageProfileUrl
      && targetProfileUrl.replace(/\/+$/, "") !== pageProfileUrl.replace(/\/+$/, "")
    );
    if (hasDifferentTargetProfile) {
      setStatus("Go to the pasted profile first.", false, "warning");
      return;
    }
    if (!canUpdateSenderProfileNow()) {
      if (allowCurrentPageCapture && canCaptureCurrentProfilePage()) {
        const pageUrl = currentProfileUrl();
        syncOwnProfileUrlInputs(pageUrl);
        renderPageStatus({ preserveStatus: true });
      }
    }
    if (!canUpdateSenderProfileNow()) {
      setStatus("Paste your LinkedIn profile URL and open that page first.", true);
      return;
    }
    setLoading(el.updateProfileButton, "Extracting…", true);
    setLoading(el.senderProfileUpdateNow, "Extracting…", true);
    setStatus("Saving your profile. LinkedIn needs a short scroll pass to load the full page.", false, "progress");
    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.UPDATE_MY_PROFILE,
        sourceTabId: await getSourceTabId()
      });
      state.lastProfileExtractionDiagnostics = response?.extractedProfileDebug || null;
      state.lastSenderProfileSaveDiagnostics = {
        source: "handleUpdateProfile",
        stage: "after_update_my_profile",
        firstTimeSave,
        pendingOwnProfilePage,
        shouldAutoSaveProfile,
        currentProfileUrl: normalizeWhitespace(currentProfileUrl()),
        configuredOwnProfileUrl: normalizeWhitespace(configuredOwnProfileUrl()),
        responseOk: Boolean(response?.ok),
        responseError: normalizeWhitespace(response?.error || ""),
        responseOwnProfileUrl: normalizeWhitespace(response?.profile?.ownProfileUrl || ""),
        responseRawSnapshotLength: normalizeWhitespace(response?.profile?.rawSnapshot || "").length,
        extractedProfileUrl: normalizeWhitespace(response?.extractedProfile?.profileUrl || ""),
        extractedRawSnapshotLength: normalizeWhitespace(response?.extractedProfile?.rawSnapshot || "").length
      };
      if (!response?.ok) {
        throw new Error(response?.error || "Unable to extract your LinkedIn profile.");
      }
      const fallbackRawSnapshot = normalizeWhitespace([
        normalizeWhitespace(response.extractedProfile?.fullName),
        normalizeWhitespace(response.extractedProfile?.headline),
        normalizeWhitespace(response.extractedProfile?.location),
        normalizeWhitespace(response.extractedProfile?.about)
      ].filter(Boolean).join("\n"));
      const nextProfile = {
        ...state.myProfile,
        ownProfileUrl: response.profile?.ownProfileUrl
          || response.extractedProfile?.profileUrl
          || currentProfileUrl()
          || configuredOwnProfileUrl()
          || state.myProfile?.ownProfileUrl
          || "",
        manualNotes: configuredSenderManualNotes(),
        rawSnapshot: response.profile?.rawSnapshot || response.extractedProfile?.rawSnapshot || fallbackRawSnapshot
      };
      populateProfileForm(nextProfile);
      state.lastSenderProfileSaveDiagnostics = {
        ...(state.lastSenderProfileSaveDiagnostics || {}),
        stage: shouldAutoSaveProfile ? "before_save_my_profile" : "no_auto_save",
        nextOwnProfileUrl: normalizeWhitespace(nextProfile.ownProfileUrl || ""),
        nextRawSnapshotLength: normalizeWhitespace(nextProfile.rawSnapshot || "").length
      };
      if (shouldAutoSaveProfile) {
        const saveResponse = await chrome.runtime.sendMessage({
          type: MESSAGE_TYPES.SAVE_MY_PROFILE,
          profile: nextProfile
        });
        state.lastSenderProfileSaveDiagnostics = {
          source: "handleUpdateProfile",
          attemptedOwnProfileUrl: normalizeWhitespace(nextProfile.ownProfileUrl || ""),
          attemptedRawSnapshotLength: normalizeWhitespace(nextProfile.rawSnapshot || "").length,
          responseDiagnostics: saveResponse?.diagnostics || null
        };
        if (!saveResponse?.ok) {
          throw new Error(saveResponse?.error || "Unable to save profile.");
        }
        state.myProfile = {
          ...state.myProfile,
          ...nextProfile,
          ...(saveResponse.profile || {}),
          ownProfileUrl: normalizeWhitespace(saveResponse.profile?.ownProfileUrl || nextProfile.ownProfileUrl || ""),
          rawSnapshot: saveResponse.profile?.rawSnapshot || nextProfile.rawSnapshot || "",
          pendingProfileUrl: ""
        };
        if (el.senderContextDetails) {
          el.senderContextDetails.open = false;
        }
        syncOwnProfileUrlInputs(state.myProfile?.ownProfileUrl || "");
        await refreshState({ preserveStatus: true, suppressImportStatus: true });
        renderPageStatus({ preserveStatus: true });
        setStatus(pendingOwnProfilePage ? "Profile switched." : "Sender context saved.", false);
        return;
      }
      renderPageStatus();
      setStatus("Profile updated. Save to overwrite.", false);
    } catch (error) {
      setStatus(error.message || String(error), true);
    } finally {
      setLoading(el.updateProfileButton, "Extracting…", false);
      setLoading(el.senderProfileUpdateNow, "Extracting…", false);
    }
  }

  async function handleSaveProfile(event) {
    event.preventDefault();
    setLoading(el.saveProfileButton, "Saving…", true);
    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.SAVE_MY_PROFILE,
        profile: readProfileForm()
      });
      state.lastSenderProfileSaveDiagnostics = {
        source: "handleSaveProfile",
        attemptedOwnProfileUrl: normalizeWhitespace(readProfileForm()?.ownProfileUrl || ""),
        attemptedRawSnapshotLength: normalizeWhitespace(readProfileForm()?.rawSnapshot || "").length,
        responseDiagnostics: response?.diagnostics || null
      };
      if (!response?.ok) {
        throw new Error(response?.error || "Unable to save profile.");
      }
      state.myProfile = response.profile;
      if (el.senderContextDetails) {
        el.senderContextDetails.open = false;
      }
      syncOwnProfileUrlInputs(state.myProfile?.ownProfileUrl || "");
      renderPageStatus();
      setStatus("Sender context saved.", false);
    } catch (error) {
      setStatus(error.message || String(error), true);
    } finally {
      setLoading(el.saveProfileButton, "Saving…", false);
    }
  }

  async function saveProviderPreference(provider, options) {
    const normalizedProvider = normalizeLlmProvider(provider);
    const nextPromptSettings = {
      ...(state.promptSettings || defaultPromptSettings()),
      llmProvider: normalizedProvider,
      llmEntryUrl: normalizeLlmEntryUrl(
        normalizedProvider,
        options?.entryUrl
          || (normalizedProvider === normalizeLlmProvider(state.promptSettings?.llmProvider)
            ? state.promptSettings?.llmEntryUrl
            : defaultLlmEntryUrl(normalizedProvider))
      )
    };
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.SAVE_PROMPT_SETTINGS,
      promptSettings: nextPromptSettings
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Unable to save AI provider.");
    }
    state.promptSettings = response.promptSettings || nextPromptSettings;
    resetPromptSettingsDirty();
    syncLlmProviderInputs(state.promptSettings.llmProvider, state.promptSettings.llmEntryUrl);
    if (!options?.silent) {
      setStatus(`AI provider set to ${providerDisplayName(normalizedProvider)}.`, false);
    }
  }

  async function handleSavePromptSettings(event) {
    event.preventDefault();
    setLoading(el.savePromptSettingsButton, "Saving…", true);
    try {
      const ownProfileUrl = normalizeWhitespace(el.senderProfileSettingsUrl?.value || "");
      const ownProfileResponse = await saveOwnProfileUrl(ownProfileUrl);
      if (!ownProfileResponse?.ok) {
        throw new Error(ownProfileResponse?.error || "Unable to save your LinkedIn profile URL.");
      }
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.SAVE_PROMPT_SETTINGS,
        promptSettings: readPromptSettingsForm()
      });
      if (!response?.ok) {
        throw new Error(response?.error || "Unable to save prompt settings.");
      }

      state.promptSettings = response.promptSettings || defaultPromptSettings();
      resetPromptSettingsDirty();
      populatePromptSettingsForm(state.promptSettings);
      el.settingsSection.classList.add("hidden");
      setStatus("Settings saved.", false);
    } catch (error) {
      setStatus(error.message || String(error), true);
    } finally {
      setLoading(el.savePromptSettingsButton, "Saving…", false);
    }
  }

  async function handleSavePersonNote() {
    setLoading(el.savePersonNoteButton, "Saving…", true);
    try {
      const noteResponse = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.SAVE_PERSON_NOTE,
        personId: state.personRecord?.personId,
        personNote: el.personNoteInput.value
      });
      if (!noteResponse?.ok) {
        throw new Error(noteResponse?.error || "Unable to save person note.");
      }

      const goalResponse = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.SAVE_PERSON_GOAL,
        personId: state.personRecord?.personId,
        userGoal: el.personGoalSelect.value
      });
      if (!goalResponse?.ok) {
        throw new Error(goalResponse?.error || "Unable to save person goal.");
      }

      state.personRecord = goalResponse.personRecord || noteResponse.personRecord || state.personRecord;
      setPersonCardEditorOpen(false);
      renderPageStatus();
      setStatus("Person context saved.", false);
    } catch (error) {
      setStatus(error.message || String(error), true);
    } finally {
      setLoading(el.savePersonNoteButton, "Saving…", false);
    }
  }

  async function handleImportConversation() {
    setLoading(el.importConversationButton, "Importing…", true);
    const requestView = currentViewIdentity();
    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.IMPORT_CURRENT_CONVERSATION,
        sourceTabId: await getSourceTabId()
      });
      if (!response?.ok) {
        throw new Error(response?.error || "Unable to import conversation history.");
      }

      if (!sameViewIdentity(requestView, currentViewIdentity())) {
        await refreshState();
        return;
      }

      state.personRecord = response.personRecord || state.personRecord;
      state.lastImportSyncMessage = response?.diagnostics?.syncMessage || "";
      renderPageStatus({ preserveStatus: true });
      setStatus(response?.diagnostics?.syncMessage || (response.unchanged ? "Conversation import unchanged." : "Conversation imported."), false);
    } catch (error) {
      if (!sameViewIdentity(requestView, currentViewIdentity())) {
        return;
      }
      setStatus(error.message || String(error), true);
    } finally {
      setLoading(el.importConversationButton, "Importing…", false);
      renderPageStatus({ preserveStatus: true });
    }
  }

  async function handleClearImportedConversation() {
    setLoading(el.clearConversationButton, "Clearing…", true);
    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.CLEAR_IMPORTED_CONVERSATION,
        personId: state.personRecord?.personId,
        sourceTabId: await getSourceTabId()
      });
      if (!response?.ok) {
        throw new Error(response?.error || "Unable to clear imported conversation history.");
      }

      state.personRecord = response.personRecord || state.personRecord;
      renderPageStatus({ preserveStatus: true });
      setStatus("Imported conversation cleared.", false);
    } catch (error) {
      setStatus(error.message || String(error), true);
    } finally {
      setLoading(el.clearConversationButton, "Clearing…", false);
      renderPageStatus({ preserveStatus: true });
    }
  }

  async function copyToClipboard(text) {
    await navigator.clipboard.writeText(text);
    setStatus("Copied.", false);
  }

  async function openWorkspaceForPerson(personId) {
    const target = state.allPeople.find((entry) => entry.personId === personId);
    if (!target) {
      setStatus("Could not find that person in the dashboard.", true);
      return;
    }

    const destinationUrl = normalizeWhitespace(target.messagingThreadUrl) || normalizeWhitespace(target.profileUrl);
    if (!destinationUrl) {
      setStatus("No LinkedIn profile URL is saved for this person yet.", true);
      return;
    }

    if ((state.personRecord?.personId || "") === personId && normalizeWhitespace(state.pageContext?.pageUrl) === destinationUrl) {
      setViewMode("workspace");
      return;
    }

    try {
      const sourceTabId = await getSourceTabId();
      if (!sourceTabId) {
        throw new Error("No active LinkedIn tab is available.");
      }
      await chrome.tabs.update(sourceTabId, { url: destinationUrl, active: true });
      setViewMode("workspace");
    } catch (error) {
      setStatus(error.message || String(error), true);
    }
  }

  async function handleReadLatestResponse() {
    setLoading(el.readLatestResponseButton, "Reading…", true);
    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.READ_LATEST_PROVIDER_RESPONSE,
        sourceTabId: await getSourceTabId(),
        personId: state.personRecord?.personId || "",
        fixedTail: el.fixedTailInput.value,
        recipientFullName: state.personRecord?.fullName || state.pageContext?.person?.fullName || "",
        recipientProfileUrl: state.personRecord?.profileUrl || state.pageContext?.person?.profileUrl || "",
        pageType: state.pageContext?.pageType || "",
        flowType: currentDraftWorkspace()?.flowType || "relationship",
        prompt: state.manualRecovery?.prompt || ""
      });
      if (!response?.ok) {
        state.manualRecovery = response?.manualRecovery || state.manualRecovery;
        throw new Error(response?.error || "Unable to read the latest provider response.");
      }

      state.workspace = currentDraftWorkspace(response.personRecord) || response.workspace || state.workspace;
      state.extraContext = state.workspace?.extra_context || state.extraContext;
      state.manualRecovery = null;
      state.showingAlternatives = false;
      renderPageStatus();
      setStatus("Loaded the latest provider response.", false);
    } catch (error) {
      setStatus(error.message || String(error), true);
      renderManualRecovery();
    } finally {
      setLoading(el.readLatestResponseButton, "Reading…", false);
    }
  }

  function handleClearTechnicalDetails() {
    state.manualRecovery = null;
    state.lastGenerationDiagnostics = null;
    state.resolutionDiagnostics = null;
      state.lastProfileExtractionDiagnostics = null;
      state.lastSenderProfileSaveDiagnostics = null;
      if (el.pageDiagnostics) {
        el.pageDiagnostics.value = "";
      }
    if (el.senderProfileExtracted) {
      el.senderProfileExtracted.value = "";
    }
    if (el.manualPrompt) {
      el.manualPrompt.value = "";
    }
    if (el.manualRawOutput) {
      el.manualRawOutput.value = "";
    }
    if (el.globalDiagnosticsDetails) {
      el.globalDiagnosticsDetails.open = false;
    }
    renderManualRecovery();
  }

  async function handleCopyTechnicalDetails() {
    const { diagnostics } = buildDiagnosticsSnapshot();
    const text = JSON.stringify(diagnostics, null, 2);
    await copyToClipboard(text);
  }

  async function handleFactoryReset() {
    const confirmed = window.confirm("Factory reset will delete all locally saved extension data, including profiles, notes, imported conversation history, prompt settings, and cache. It will not delete conversations on the provider websites. Continue?");
    if (!confirmed) {
      return;
    }

    setLoading(el.factoryResetButton, "Resetting…", true);
    try {
      const response = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.FACTORY_RESET });
      if (!response?.ok) {
        throw new Error(response?.error || "Unable to factory reset the extension.");
      }

      state.viewMode = "workspace";
      state.myProfile = defaultMyProfile();
      state.promptSettings = defaultPromptSettings();
      state.fixedTail = FIXED_TAIL;
      state.allPeople = [];
      state.personRecord = defaultPersonRecord();
      state.workspace = null;
      state.manualRecovery = null;
      state.identityWarning = null;
      state.identityResolutionRequest = null;
      state.dismissedIdentityResolutionRequestKey = "";
      state.extraContext = "";
      state.showingAlternatives = false;
      state.generationJobs = [];
      state.activeGenerationRequestId = "";
      state.activeGenerationPersonId = "";
      state.generationProgressText = "";
      state.lastImportSyncMessage = "";
      state.lastGenerationDiagnostics = null;
      state.resolutionDiagnostics = null;
      state.lastProfileExtractionDiagnostics = null;
      state.lastSenderProfileSaveDiagnostics = null;
      state.lastOpenMessagesDiagnostics = null;
      el.settingsSection.classList.add("hidden");
      populateProfileForm(state.myProfile);
      populatePromptSettingsForm(state.promptSettings);
      el.fixedTailInput.value = state.fixedTail;
      setViewMode("workspace");
      renderPageStatus({ preserveStatus: false });
      await refreshState();
      setStatus("Factory reset complete.", false);
    } catch (error) {
      setStatus(error.message || String(error), true);
    } finally {
      setLoading(el.factoryResetButton, "Resetting…", false);
    }
  }

  el.settingsButton.addEventListener("click", () => {
    resetPromptSettingsDirty();
    populatePromptSettingsForm(state.promptSettings);
    el.settingsSection.classList.remove("hidden");
  });

  el.closeSettingsButton.addEventListener("click", () => {
    resetPromptSettingsDirty();
    populatePromptSettingsForm(state.promptSettings);
    el.settingsSection.classList.add("hidden");
  });

  el.settingsSection.addEventListener("click", (event) => {
    if (event.target === el.settingsSection) {
      resetPromptSettingsDirty();
      populatePromptSettingsForm(state.promptSettings);
      el.settingsSection.classList.add("hidden");
    }
  });

  el.workspaceViewButton.addEventListener("click", () => {
    setViewMode("workspace");
  });

  el.dashboardViewButton.addEventListener("click", () => {
    setViewMode("dashboard");
  });

  [el.dashboardActivityWindowToday, el.dashboardActivityWindow7d].forEach((button) => {
    button?.addEventListener("click", () => {
      state.dashboardActivityWindow = button.dataset.window === "today" ? "today" : "7d";
      renderDashboard();
    });
  });

  el.dashboardExportCsv?.addEventListener("click", () => {
    downloadDashboardActivityCsv();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !el.settingsSection.classList.contains("hidden")) {
      resetPromptSettingsDirty();
      populatePromptSettingsForm(state.promptSettings);
      el.settingsSection.classList.add("hidden");
    }
  });

  el.nextActionButton.addEventListener("click", () => {
    handleNextStepAction(el.nextActionButton);
  });

  el.nextHelperButton?.addEventListener("click", () => {
    handleNextStepAction(el.nextHelperButton);
  });

  el.personCardEditButton?.addEventListener("click", () => {
    const willOpen = Boolean(el.personCardEditor?.classList.contains("hidden"));
    setPersonCardEditorOpen(willOpen);
  });

  el.nextStepEvidence?.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest(".next-step-chip__action") : null;
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }
    void handleNextStepAction(button);
  });

  el.updateProfileButton?.addEventListener("click", () => {
    handleUpdateProfile();
  });

  el.profileForm?.addEventListener("submit", (event) => {
    handleSaveProfile(event);
  });

  el.promptSettingsForm.addEventListener("submit", (event) => {
    handleSavePromptSettings(event);
  });

  el.fixedTailInput.addEventListener("input", () => {
    state.fixedTail = el.fixedTailInput.value;
    scheduleFixedTailSave();
  });

  el.senderProfileUrlInput.addEventListener("input", () => {
    renderPageStatus({ preserveStatus: true });
  });

  el.senderProfileNotesInput.addEventListener("input", () => {
    if (profileFields.manualNotes && document.activeElement === el.senderProfileNotesInput) {
      profileFields.manualNotes.value = el.senderProfileNotesInput.value;
    }
  });

  profileFields.manualNotes?.addEventListener("input", () => {
    if (el.senderProfileNotesInput && document.activeElement === profileFields.manualNotes) {
      el.senderProfileNotesInput.value = profileFields.manualNotes.value;
    }
  });

  el.senderProfileProviderSelect?.addEventListener("change", async () => {
    try {
      await saveProviderPreference(el.senderProfileProviderSelect.value);
      renderPageStatus({ preserveStatus: true });
    } catch (error) {
      syncLlmProviderInputs(state.promptSettings?.llmProvider, state.promptSettings?.llmEntryUrl);
      setStatus(error.message || String(error), true);
    }
  });

  el.llmProviderSettingsSelect?.addEventListener("change", () => {
    markPromptSettingsDirty();
    const provider = normalizeLlmProvider(el.llmProviderSettingsSelect.value);
    const currentUrl = normalizeWhitespace(el.llmProviderUrlInput?.value || "");
    const currentProvider = normalizeLlmProvider(state.promptSettings?.llmProvider || "");
    const currentSavedUrl = normalizeWhitespace(state.promptSettings?.llmEntryUrl || "");
    const shouldResetUrl = !currentUrl
      || currentProvider !== provider
      || currentUrl === currentSavedUrl
      || currentUrl === defaultLlmEntryUrl(currentProvider);
    syncLlmProviderInputs(
      provider,
      shouldResetUrl ? defaultLlmEntryUrl(provider) : currentUrl
    );
  });

  el.llmProviderUrlInput?.addEventListener("input", () => {
    markPromptSettingsDirty();
    if (el.senderProfileProviderSelect && document.activeElement !== el.senderProfileProviderSelect) {
      el.senderProfileProviderSelect.value = normalizeLlmProvider(el.llmProviderSettingsSelect?.value || state.promptSettings?.llmProvider || "");
    }
  });

  el.strategyGuidance?.addEventListener("input", () => {
    markPromptSettingsDirty();
  });

  el.extraContextInput.addEventListener("input", () => {
    state.extraContext = el.extraContextInput.value;
  });

  el.resetFixedTail.addEventListener("click", async () => {
    el.fixedTailInput.value = FIXED_TAIL;
    state.fixedTail = FIXED_TAIL;
    await saveFixedTail(FIXED_TAIL);
    setStatus("Cold outreach default reset.", false);
  });

  el.importConversationButton?.addEventListener("click", () => {
    handleImportConversation();
  });

  el.senderProfileOpenLink?.addEventListener("click", () => {
    openSenderProfileUrl();
  });

  el.openSenderProfileLink.addEventListener("click", () => {
    openSenderProfileUrl();
  });

  el.senderProfileOpenSettings?.addEventListener("click", () => {
    if (el.senderProfileUrlInput && el.senderProfileSettingsUrl) {
      el.senderProfileSettingsUrl.value = el.senderProfileUrlInput.value;
    }
    el.settingsSection.classList.remove("hidden");
  });

  el.senderProfileUpdateNow.addEventListener("click", () => {
    handleUpdateProfile({ allowCurrentPageCapture: true });
  });

  el.clearConversationButton?.addEventListener("click", () => {
    handleClearImportedConversation();
  });

  el.savePersonNoteButton.addEventListener("click", () => {
    handleSavePersonNote();
  });

  el.copyPrimaryDraftButton.addEventListener("click", () => {
    copyToClipboard(el.primaryDraftInput.value);
  });

  el.toggleAlternativesButton.addEventListener("click", () => {
    state.showingAlternatives = !state.showingAlternatives;
    renderDrafts();
  });

  el.readLatestResponseButton.addEventListener("click", () => {
    handleReadLatestResponse();
  });

  el.clearTechnicalDetailsButton?.addEventListener("click", () => {
    handleClearTechnicalDetails();
  });

  el.copyTechnicalDetailsButton?.addEventListener("click", () => {
    void handleCopyTechnicalDetails();
  });

  el.recipientProfileRefreshLink?.addEventListener("click", () => {
    void refreshRecipientProfileContext();
  });

  el.factoryResetButton.addEventListener("click", () => {
    handleFactoryReset();
  });

  el.dashboardFilterSelect?.addEventListener("change", () => {
    state.dashboardFilter = el.dashboardFilterSelect.value || "all";
    renderDashboard();
  });

  [
    el.dashboardSummaryNeedsAction,
    el.dashboardSummaryFollowUp,
    el.dashboardSummaryWarm,
    el.dashboardSummaryWaiting,
    el.dashboardSummaryDeprioritize
  ].forEach((button) => {
    button.addEventListener("click", () => {
      state.dashboardSection = button.dataset.section || "reply_now";
      state.dashboardFilter = state.dashboardSection;
      renderDashboard();
    });
  });

  el.dashboardSortSelect?.addEventListener("change", () => {
    state.dashboardSort = el.dashboardSortSelect.value || "priority";
    renderDashboard();
  });

  el.dashboardList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const expandButton = target.closest("[data-dashboard-expand]");
    const expandKey = normalizeWhitespace(expandButton?.dataset?.dashboardExpand);
    if (expandKey) {
      event.preventDefault();
      toggleDashboardExpanded(expandKey);
      renderDashboard();
      return;
    }
    const openTarget = target.closest("[data-dashboard-open]");
    const personId = normalizeWhitespace(openTarget?.dataset?.dashboardOpen);
    if (personId) {
      event.preventDefault();
      openWorkspaceForPerson(personId);
    }
  });

  el.primaryDraftInput.addEventListener("input", () => {
    if (state.workspace?.messages?.[0]) {
      state.workspace.messages[0].message = el.primaryDraftInput.value;
    }
    autosizeTextarea(el.primaryDraftInput);
    renderPrimaryDraftMetrics();
  });

  el.alternativeDrafts.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement)) {
      return;
    }
    const index = Number(target.dataset.index);
    if (state.workspace?.messages?.[index]) {
      state.workspace.messages[index].message = target.value;
    }
    autosizeTextarea(target);
    const metrics = target.parentElement?.querySelector('[data-role="draft-metrics"]');
    if (metrics) {
      metrics.textContent = draftMetricsText(target.value);
    }
  });

  el.alternativeDrafts.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) {
      return;
    }
    if (target.dataset.action !== "copy-alt") {
      return;
    }
    const index = Number(target.dataset.index);
    const draft = state.workspace?.messages?.[index];
    if (draft?.message) {
      copyToClipboard(draft.message);
    }
  });

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message?.type === MESSAGE_TYPES.GENERATION_PROGRESS) {
      const matchesAttachedTab = messageMatchesAttachedLinkedInTab(message);
      const personId = normalizeWhitespace(message?.personId);
      if (personId && matchesAttachedTab) {
        const nextJobs = Array.isArray(state.generationJobs) ? [...state.generationJobs] : [];
        const index = nextJobs.findIndex((job) => normalizeWhitespace(job?.requestId) === normalizeWhitespace(message?.requestId));
        const nextJob = {
          ...(index >= 0 ? nextJobs[index] : {}),
          requestId: normalizeWhitespace(message?.requestId),
          personId,
          sourceTabId: typeof message?.sourceTabId === "number" ? message.sourceTabId : null,
          provider: normalizeWhitespace(message?.provider),
          status: normalizeWhitespace(message?.status || "running"),
          progressText: normalizeWhitespace(message?.text),
          providerPrompt: typeof message?.providerPrompt === "string"
            ? message.providerPrompt
            : (index >= 0 ? nextJobs[index]?.providerPrompt : ""),
          progressPercent: Number(message?.progressPercent || 0),
          outputChars: Number(message?.outputChars || 0)
        };
        if (index >= 0) {
          nextJobs[index] = nextJob;
        } else {
          nextJobs.push(nextJob);
        }
        state.generationJobs = nextJobs;
      }
      if (message?.requestId && message.requestId === state.activeGenerationRequestId) {
        state.generationProgressText = normalizeWhitespace(message.text);
      }
      const isCurrentPerson = Boolean(matchesAttachedTab && personId && personId === normalizeWhitespace(state.personRecord?.personId));
      const isActiveRequest = Boolean(
        message?.requestId
        && message.requestId === state.activeGenerationRequestId
        && (
          state.activeGenerationSourceTabId === null
          || state.activeGenerationSourceTabId === (typeof message?.sourceTabId === "number" ? message.sourceTabId : null)
        )
      );
      if (isCurrentPerson || isActiveRequest) {
        const nextText = normalizeWhitespace(message?.text) || state.generationProgressText;
        setStatus(nextText, false, "progress");
      }
      return;
    }

    if (message?.type === MESSAGE_TYPES.GENERATION_COMPLETE) {
      const matchesAttachedTab = messageMatchesAttachedLinkedInTab(message);
      const completedPersonId = normalizeWhitespace(message.personId || message.personRecord?.personId);
      const isCurrentPerson = Boolean(matchesAttachedTab && completedPersonId && completedPersonId === normalizeWhitespace(state.personRecord?.personId));
      const mergedCompletedRecord = message?.personRecord ? upsertLocalPersonRecord(message.personRecord) : null;
      state.generationJobs = (Array.isArray(state.generationJobs) ? state.generationJobs : [])
        .filter((job) => normalizeWhitespace(job?.requestId) !== normalizeWhitespace(message?.requestId));
      if (message?.requestId && message.requestId === state.activeGenerationRequestId) {
        state.activeGenerationRequestId = "";
        state.activeGenerationPersonId = "";
        state.activeGenerationSourceTabId = null;
        state.generationProgressText = "";
      }
      if (isCurrentPerson) {
        state.personRecord = mergedCompletedRecord || message.personRecord || state.personRecord;
        state.workspace = currentDraftWorkspace(state.personRecord) || message.workspace || state.workspace;
        state.lastGenerationDiagnostics = message?.diagnostics || null;
        state.manualRecovery = null;
        state.showingAlternatives = false;
        renderPageStatus();
        setStatus("Draft ready.", false);
      } else if (matchesAttachedTab) {
        refreshState({ preserveStatus: true, suppressImportStatus: true }).catch(() => {});
      }
      return;
    }

    if (message?.type === MESSAGE_TYPES.GENERATION_FAILED) {
      const matchesAttachedTab = messageMatchesAttachedLinkedInTab(message);
      const failedPersonId = normalizeWhitespace(message.personId);
      const isCurrentPerson = Boolean(matchesAttachedTab && failedPersonId && failedPersonId === normalizeWhitespace(state.personRecord?.personId));
      state.generationJobs = (Array.isArray(state.generationJobs) ? state.generationJobs : [])
        .filter((job) => normalizeWhitespace(job?.requestId) !== normalizeWhitespace(message?.requestId));
      if (message?.requestId && message.requestId === state.activeGenerationRequestId) {
        state.activeGenerationRequestId = "";
        state.activeGenerationPersonId = "";
        state.activeGenerationSourceTabId = null;
        state.generationProgressText = "";
      }
      if (isCurrentPerson) {
        state.manualRecovery = message?.manualRecovery || null;
        state.lastGenerationDiagnostics = message?.diagnostics || null;
        setStatus(message?.error || "Generation failed.", true);
        renderManualRecovery();
      }
      return;
    }

    if (message?.type === MESSAGE_TYPES.PAGE_CONTEXT_CHANGED) {
      const senderTabId = sender?.tab?.id || message?.tabId || null;
      const knownTabId = preferredLinkedInTabId() || state.lastObservedBrowserTabId || null;
      if (!senderTabId || (knownTabId && senderTabId !== knownTabId)) {
        return;
      }
      state.lastObservedBrowserTabId = senderTabId;
      state.lastObservedBrowserTabUrl = normalizeWhitespace(message?.href || state.lastObservedBrowserTabUrl || "");
      state.lastNavigationSignalHref = normalizeWhitespace(message?.href || "");
      state.lastNavigationSignalAt = new Date().toISOString();
      clearRefreshCache();
      applyOptimisticNavigationHint(message?.href || "", message?.clickText || "");
      scheduleNavigationRefreshBurst();
    }
  });

  chrome.tabs.onActivated.addListener(async () => {
    try {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const activeTab = tabs[0] || null;
      if (!activeTab?.id) {
        return;
      }
      state.lastObservedBrowserTabId = activeTab.id;
      state.lastObservedBrowserTabUrl = normalizeWhitespace(activeTab.url || state.lastObservedBrowserTabUrl || "");
      const attachedToLinkedIn = attachToLinkedInTab(activeTab.id, activeTab.url || "");
      const shouldRefresh = attachedToLinkedIn || activeTab.id === preferredLinkedInTabId();
      if (shouldRefresh) {
        scheduleNavigationRefreshBurst();
      }
    } catch (_error) {
      // Ignore activation lookup errors.
    }
  });

  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (!tab.active) {
      return;
    }
    if (changeInfo.url) {
      state.lastObservedBrowserTabId = tab.id || state.lastObservedBrowserTabId;
      state.lastObservedBrowserTabUrl = normalizeWhitespace(changeInfo.url);
      const attachedToLinkedIn = attachToLinkedInTab(tab.id, changeInfo.url);
      if (tab.id === preferredLinkedInTabId() || attachedToLinkedIn) {
        applyOptimisticNavigationHint(changeInfo.url, "");
      }
    }
    if ((changeInfo.url || changeInfo.status === "complete")
      && (tab.id === preferredLinkedInTabId() || isLinkedInWorkspaceUrl(tab.url || changeInfo.url || ""))) {
      scheduleNavigationRefreshBurst();
    }
  });

  if (chrome.webNavigation?.onHistoryStateUpdated) {
    chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
      if (details.frameId !== 0) {
        return;
      }
      if (state.lastObservedBrowserTabId && details.tabId !== state.lastObservedBrowserTabId) {
        return;
      }
      attachToLinkedInTab(details.tabId, details.url || state.lastObservedBrowserTabUrl || "");
      applyOptimisticNavigationHint(details.url || "", "");
      scheduleNavigationRefreshBurst();
    }, {
      url: [{ hostEquals: "www.linkedin.com" }]
    });
  }

  setViewMode("workspace");
  renderPageStatus({ preserveStatus: true });
  refreshState({ allowCached: true });
})();
