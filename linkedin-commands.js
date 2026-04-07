(function initLinkedInCommands() {
  const shared = globalThis.LinkedInAssistantShared;
  const {
    MESSAGE_TYPES,
    firstNameFromFullName,
    normalizeLinkedInProfileUrl,
    normalizeWhitespace,
    personIdFromProfileUrl
  } = shared;

  const PROFILE_NOT_SUPPORTED_ERROR = "This page is not a supported LinkedIn profile.";
  const UNSUPPORTED_LINKEDIN_PAGE_ERROR = "This LinkedIn page is not supported yet.";

  function buildPersonIdentity(source) {
    const fullName = normalizeWhitespace(source?.fullName || source?.name);
    const profileUrl = normalizeLinkedInProfileUrl(source?.profileUrl) || normalizeWhitespace(source?.profileUrl || "");
    const messagingThreadUrl = normalizeWhitespace(source?.messagingThreadUrl || "");
    const headline = normalizeWhitespace(source?.headline || "");
    const location = normalizeWhitespace(source?.location || "");
    const connectionStatus = normalizeWhitespace(source?.connectionStatus || "");
    const profileSummary = normalizeWhitespace(source?.profileSummary || headline);
    const rawSnapshot = String(source?.rawSnapshot || "").replace(/\r/g, "").trim();
    const explicitPersonId = normalizeWhitespace(source?.personId || "");

    return {
      personId: explicitPersonId
        || personIdFromProfileUrl(profileUrl, fullName),
      firstName: normalizeWhitespace(source?.firstName) || firstNameFromFullName(fullName),
      fullName,
      profileUrl,
      messagingThreadUrl,
      headline,
      location,
      connectionStatus,
      profileSummary,
      rawSnapshot
    };
  }

  function buildProfilePerson(profile) {
    if (!profile) {
      return null;
    }
    return buildPersonIdentity(profile);
  }

  function buildProfileWorkspaceContext(extracted) {
    const person = buildProfilePerson(extracted?.profile);
    return {
      supported: Boolean(extracted?.supported),
      pageType: extracted?.pageType || "linkedin-profile",
      pageUrl: extracted?.pageUrl || window.location.href,
      title: extracted?.title || document.title,
      person,
      profile: extracted?.profile || null,
      conversation: null,
      debug: {
        ...(extracted?.debug || {}),
        page_kind: "profile",
        person_found: Boolean(person?.fullName),
        connection_status: person?.connectionStatus || ""
      },
      reason: extracted?.reason || ""
    };
  }

  function buildProfileExtractionMode(options) {
    return {
      lightweight: Boolean(options?.lightweight),
      forceScrollPass: Boolean(options?.forceScrollPass) && !Boolean(options?.lightweight)
    };
  }

  function extractMessagingContext(deps) {
    if (!deps.isSupportedMessagingPage()) {
      return {
        supported: false,
        pageType: "unsupported",
        pageUrl: window.location.href,
        title: document.title
      };
    }

    const messagingRoot = document.querySelector("main") || document;
    const overlayRoot = deps.queryFirst([
      "[data-view-name='message-overlay-conversation-bubble-item']",
      ".msg-overlay-conversation-bubble--is-active",
      ".msg-overlay-conversation-bubble",
      ".msg-overlay-bubble"
    ], document);
    const detailRootSelectors = [
      ".scaffold-layout__detail .msg-convo-wrapper",
      ".scaffold-layout__detail .msg-thread.msg-thread--pillar",
      ".scaffold-layout__detail .msg-thread",
      ".scaffold-layout__detail",
      ".msg-overlay-bubble",
      ".msg-overlay-bubble__content",
      ".msg-overlay-conversation-bubble",
      ".msg-overlay-conversation-bubble__content-wrapper",
      "[data-view-name='message-overlay-conversation-bubble-item']"
    ];
    const detailRoot = overlayRoot
      || deps.queryFirst(detailRootSelectors, messagingRoot)
      || deps.queryFirst(detailRootSelectors, document)
      || deps.queryAny(detailRootSelectors, messagingRoot)
      || deps.queryAny(detailRootSelectors, document)
      || messagingRoot;
    const header = deps.queryAny([
      ".msg-title-bar",
      ".shared-title-bar",
      ".msg-thread__thread-top-card",
      ".msg-thread__thread-header",
      ".msg-thread__topcard",
      ".msg-overlay-bubble-header",
      ".msg-overlay-conversation-bubble-header",
      ".msg-conversations-container__convo-details",
      ".msg-thread-bubble-header"
    ], detailRoot);
    const conversationRoot = deps.queryFirst([
      ".msg-s-message-list-container",
      ".msg-s-message-list",
      ".msg-s-message-list-content",
      ".msg-overlay-conversation-bubble__content-wrapper",
      ".msg-thread__content",
      ".msg-thread__messages-container",
      ".msg-thread",
      ".msg-overlay-bubble__content"
    ], detailRoot) || deps.queryAny([
      ".msg-s-message-list-container",
      ".msg-s-message-list",
      ".msg-thread__content",
      ".msg-thread__messages-container",
      ".msg-thread",
      ".msg-overlay-bubble__content"
    ], detailRoot) || detailRoot;
    const activeConversationIdentity = deps.extractActiveConversationIdentity();
    const headerIdentity = deps.extractMessagingHeaderIdentity(header);
    const recipientAnchor = deps.queryAny([
      ".msg-thread__link-to-profile",
      ".msg-title-bar .msg-thread__link-to-profile",
      ".msg-entity-lockup a[href*='/in/']",
      "a[href*='/in/']",
      ".msg-thread__topcard-link",
      "[data-control-name='view_profile']"
    ], header || detailRoot);
    const headerRecipientName = deps.visibleTextFromSelectors([
      ".msg-entity-lockup__entity-title",
      ".msg-entity-lockup__entity-title-wrapper h2",
      ".msg-thread__participant-names",
      ".msg-thread__thread-title",
      ".msg-thread__topcard-title",
      "h1",
      "h2",
      "h3"
    ], header || detailRoot);
    const recipientName = [
      normalizeWhitespace(headerIdentity?.name),
      normalizeWhitespace(activeConversationIdentity?.name),
      deps.visibleText(recipientAnchor),
      headerRecipientName
    ].find((value) => deps.isLikelyMessagingRecipientName(value)) || "";
    const headline = deps.visibleTextFromSelectors([
      ".msg-entity-lockup__entity-info",
      ".msg-entity-lockup__presence-status",
      ".msg-thread__entity-lockup__subtitle",
      ".msg-thread__topcard-subtitle",
      ".artdeco-entity-lockup__subtitle",
      ".t-14"
    ], header || detailRoot) || normalizeWhitespace(headerIdentity?.headline) || normalizeWhitespace(activeConversationIdentity?.headline);
    const profileUrl = normalizeWhitespace(recipientAnchor?.href || activeConversationIdentity?.profileUrl || "");
    const messagingThreadUrl = normalizeWhitespace(activeConversationIdentity?.threadUrl || window.location.href);
    const profileCard = deps.queryAny([
      ".msg-s-profile-card",
      ".msg-thread__thread-top-card",
      ".msg-thread__topcard",
      ".msg-title-bar"
    ], detailRoot) || header || detailRoot;
    const allVisibleMessages = deps.extractRecentMessagesFromConversation(conversationRoot, recipientName, 20);
    const recentMessages = allVisibleMessages.slice(0, 8);
    const lastEntry = recentMessages[0] || null;
    const rawThreadText = deps.truncate(
      allVisibleMessages.length
        ? allVisibleMessages.map((entry) => `${entry.sender}: ${entry.text}`).join("\n")
        : deps.visibleText(conversationRoot),
      7000
    );
    const firstName = firstNameFromFullName(recipientName);
    const personId = personIdFromProfileUrl(profileUrl, recipientName);
    const connectionStatus = deps.detectConnectionStatus(header || document);
    const hasCriticalMessagingIdentity = Boolean(normalizeWhitespace(recipientName) && normalizeWhitespace(profileUrl));
    const recipientSnapshot = deps.truncate(shared.uniqueStrings([
      recipientName,
      headline
    ]).join("\n"), 1000);

    return {
      supported: hasCriticalMessagingIdentity,
      pageType: "linkedin-messaging",
      pageUrl: window.location.href,
      title: document.title,
      reason: hasCriticalMessagingIdentity ? "" : "Loading selected conversation...",
      debug: deps.messagingDebugSummary(
        header,
        detailRoot,
        conversationRoot,
        activeConversationIdentity,
        headerIdentity,
        recipientAnchor,
        recipientName,
        profileUrl,
        headline,
        allVisibleMessages
      ),
      person: buildPersonIdentity({
        personId,
        firstName,
        fullName: recipientName,
        profileUrl,
        messagingThreadUrl,
        headline,
        location: "",
        connectionStatus,
        profileSummary: deps.truncate(shared.uniqueStrings([headline]).join(" | "), 600),
        rawSnapshot: recipientSnapshot || deps.truncate(deps.visibleText(profileCard), 1000)
      }),
      conversation: {
        recipientName,
        threadUrl: messagingThreadUrl,
        recentMessages,
        allVisibleMessages,
        lastSpeaker: normalizeWhitespace(lastEntry?.sender),
        lastMessageAt: normalizeWhitespace(lastEntry?.timestamp),
        rawThreadText
      }
    };
  }

  function extractWorkspaceContext(deps) {
    if (deps.isSupportedMessagingPage()) {
      const messaging = extractMessagingContext(deps);
      return {
        ...messaging,
        profile: messaging.person || null
      };
    }

    if (deps.isSupportedProfilePage()) {
      return buildProfileWorkspaceContext(deps.extractProfile());
    }

    return {
      supported: false,
      pageType: "unsupported",
      pageUrl: window.location.href,
      title: document.title
    };
  }

  function hasStructuredProfileContent(profile) {
    if (!profile || typeof profile !== "object") {
      return false;
    }
    const experienceCount = Array.isArray(profile.experienceHighlights) ? profile.experienceHighlights.filter(Boolean).length : 0;
    const educationCount = Array.isArray(profile.educationHighlights) ? profile.educationHighlights.filter(Boolean).length : 0;
    const activityCount = Array.isArray(profile.activitySnippets) ? profile.activitySnippets.filter(Boolean).length : 0;
    const languageCount = Array.isArray(profile.languageSnippets) ? profile.languageSnippets.filter(Boolean).length : 0;
    const about = normalizeWhitespace(profile.about || "");
    return Boolean(
      about
      || experienceCount > 0
      || educationCount > 0
      || activityCount > 0
      || languageCount > 0
    );
  }

  function profileLooksCompleteEnough(profile) {
    if (!profile || typeof profile !== "object") {
      return false;
    }
    const rawSnapshotLength = normalizeWhitespace(profile.rawSnapshot || "").length;
    const summaryLength = normalizeWhitespace(profile.profileSummary || "").length;
    const experienceCount = Array.isArray(profile.experienceHighlights) ? profile.experienceHighlights.filter(Boolean).length : 0;
    const educationCount = Array.isArray(profile.educationHighlights) ? profile.educationHighlights.filter(Boolean).length : 0;
    const aboutLength = normalizeWhitespace(profile.about || "").length;
    return Boolean(
      (aboutLength >= 120 && rawSnapshotLength >= 900)
      || (experienceCount >= 2 && rawSnapshotLength >= 900)
      || (experienceCount >= 1 && educationCount >= 1 && rawSnapshotLength >= 800)
      || (summaryLength >= 220 && rawSnapshotLength >= 1000)
    );
  }

  function missingProfileExtractionGoals(profile) {
    if (!profile || typeof profile !== "object") {
      return ["about", "experience", "education", "activity"];
    }
    const goals = [];
    if (!normalizeWhitespace(profile.about || "")) {
      goals.push("about");
    }
    if (!Array.isArray(profile.experienceHighlights) || !profile.experienceHighlights.filter(Boolean).length) {
      goals.push("experience");
    }
    if (!Array.isArray(profile.educationHighlights) || !profile.educationHighlights.filter(Boolean).length) {
      goals.push("education");
    }
    if (!Array.isArray(profile.activitySnippets) || !profile.activitySnippets.filter(Boolean).length) {
      goals.push("activity");
    }
    if (!Array.isArray(profile.languageSnippets) || !profile.languageSnippets.filter(Boolean).length) {
      goals.push("languages");
    }
    return goals;
  }

  async function extractProfileWithRetries(deps, options) {
    const mode = buildProfileExtractionMode(options);
    const lightweight = mode.lightweight;
    const forceScrollPass = mode.forceScrollPass;
    const attempts = lightweight ? 2 : 3;
    const startedAtMs = deps.nowMs();
    const timing = {
      page_kind: "profile",
      profile_timing_mode: lightweight ? "lightweight" : "full",
      profile_fast_path: false,
      profile_attempts_planned: attempts,
      profile_attempts_completed: 0,
      profile_initial_extract_ms: 0,
      profile_wait_ready_ms: 0,
      profile_wait_stable_ms: 0,
      profile_auto_scroll_ms: 0,
      profile_expand_inline_ms: 0,
      profile_extract_ms: 0,
      profile_total_ms: 0,
      profile_scroll_strategy: lightweight ? "lightweight" : (forceScrollPass ? "forced_progressive_full_refresh" : "progressive_sections"),
      profile_scroll_passes_run: 0,
      profile_expand_passes_run: 0,
      profile_scroll_goal_summary: "",
      profile_scroll_seen_sections: []
    };
    let latest = null;
    let stepStartedAtMs = deps.nowMs();
    latest = deps.extractProfile();
    timing.profile_initial_extract_ms = deps.roundMs(deps.nowMs() - stepStartedAtMs);
    if (
      lightweight
      && latest?.supported
      && normalizeWhitespace(latest?.profile?.fullName)
      && normalizeWhitespace(latest?.profile?.headline)
    ) {
      timing.profile_fast_path = true;
      timing.profile_total_ms = deps.roundMs(deps.nowMs() - startedAtMs);
      return deps.mergeDebugInfo(latest, timing);
    }

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      timing.profile_attempts_completed = attempt;
      stepStartedAtMs = deps.nowMs();
      await deps.waitForProfilePageReady(lightweight ? 3 : 6);
      timing.profile_wait_ready_ms += deps.roundMs(deps.nowMs() - stepStartedAtMs);
      stepStartedAtMs = deps.nowMs();
      await deps.waitForStableProfileTopCard(lightweight ? 2 : 4);
      timing.profile_wait_stable_ms += deps.roundMs(deps.nowMs() - stepStartedAtMs);
      stepStartedAtMs = deps.nowMs();
      latest = deps.extractProfile();
      timing.profile_extract_ms += deps.roundMs(deps.nowMs() - stepStartedAtMs);
      if (!lightweight && (forceScrollPass || !latest?.supported || !profileLooksCompleteEnough(latest?.profile))) {
        const hasAnyStructuredContent = hasStructuredProfileContent(latest?.profile);
        const shouldRunScrollPass = (forceScrollPass && attempt === 1) || attempt === 1 || !hasAnyStructuredContent;
        const shouldRunExpandPass = !profileLooksCompleteEnough(latest?.profile);
        const sectionGoals = missingProfileExtractionGoals(latest?.profile);
        timing.profile_scroll_goal_summary = sectionGoals.join(", ");
        if (shouldRunScrollPass) {
          stepStartedAtMs = deps.nowMs();
          const scrollResult = await (deps.scrollProfileForExtraction
            ? deps.scrollProfileForExtraction({ sectionGoals })
            : deps.scrollProfileToBottomAndWaitForStable());
          timing.profile_auto_scroll_ms += deps.roundMs(deps.nowMs() - stepStartedAtMs);
          timing.profile_scroll_passes_run += 1;
          if (Array.isArray(scrollResult?.seenSections)) {
            timing.profile_scroll_seen_sections = scrollResult.seenSections.slice(0, 8);
          }
        }
        if (shouldRunExpandPass) {
          stepStartedAtMs = deps.nowMs();
          await deps.expandInlineTextSections();
          timing.profile_expand_inline_ms += deps.roundMs(deps.nowMs() - stepStartedAtMs);
          timing.profile_expand_passes_run += 1;
        }
        if (shouldRunScrollPass || shouldRunExpandPass) {
          stepStartedAtMs = deps.nowMs();
          latest = deps.extractProfile();
          timing.profile_extract_ms += deps.roundMs(deps.nowMs() - stepStartedAtMs);
        }
      }
      if (latest?.supported && normalizeWhitespace(latest?.profile?.fullName) && normalizeWhitespace(latest?.profile?.headline)) {
        timing.profile_total_ms = deps.roundMs(deps.nowMs() - startedAtMs);
        return deps.mergeDebugInfo(latest, timing);
      }
      if (attempt < attempts) {
        await deps.delay(lightweight ? 140 * attempt : 220 * attempt);
      }
    }
    timing.profile_total_ms = deps.roundMs(deps.nowMs() - startedAtMs);
    return deps.mergeDebugInfo(latest || deps.extractProfile(), timing);
  }

  async function extractLightweightProfilePageContext(deps) {
    return extractProfileWithRetries(deps, { lightweight: true });
  }

  async function extractFullProfile(deps, options) {
    return extractProfileWithRetries(deps, {
      lightweight: false,
      forceScrollPass: Boolean(options?.forceScrollPass)
    });
  }

  async function extractSelfProfileWithRetries(deps) {
    return extractFullProfile(deps, { forceScrollPass: true });
  }

  async function extractRecipientProfileWithFullRetries(deps, options) {
    return extractFullProfile(deps, { forceScrollPass: Boolean(options?.forceScrollPass) });
  }

  async function extractMessagingContextWithRetries(deps) {
    let latest = extractWorkspaceContext(deps);
    if (latest?.pageType !== "linkedin-messaging") {
      return latest;
    }

    const retryDelays = [180, 400, 800, 1400, 2200, 3200, 4500];
    for (const delayMs of retryDelays) {
      const ready = latest?.supported
        && normalizeWhitespace(latest?.person?.fullName)
        && normalizeWhitespace(latest?.person?.profileUrl);
      if (ready) {
        return latest;
      }
      await deps.delay(delayMs);
      latest = extractWorkspaceContext(deps);
    }

    return latest;
  }

  function unsupportedReason(deps) {
    if (deps.isLinkedInProfileSubpage()) {
      return "Open the main LinkedIn profile page, not an activity or details subpage.";
    }
    if (!deps.isSupportedProfilePage() && !deps.isSupportedMessagingPage()) {
      return "Open a LinkedIn profile or 1:1 messaging thread.";
    }
    return undefined;
  }

  async function handleMessage(deps, message, sendResponse) {
    try {
      if (message.type === MESSAGE_TYPES.GET_PAGE_CONTEXT) {
        const extracted = deps.isSupportedMessagingPage()
          ? await extractMessagingContextWithRetries(deps)
          : deps.isSupportedProfilePage()
            ? await extractLightweightProfilePageContext(deps)
            : extractWorkspaceContext(deps);
        sendResponse({
          ok: true,
          supported: extracted.supported,
          pageType: extracted.pageType,
          pageUrl: extracted.pageUrl,
          title: extracted.title,
          person: extracted.person || buildProfilePerson(extracted.profile) || null,
          profile: extracted.profile || null,
          conversation: extracted.conversation || null,
          debug: extracted.debug || null,
          reason: extracted.supported ? undefined : (extracted.reason || unsupportedReason(deps))
        });
        return;
      }

      if (message.type === MESSAGE_TYPES.SHOW_PAGE_ACTIVITY_OVERLAY) {
        deps.showPageActivityOverlay(message.title, message.message, message.autoHideMs);
        sendResponse({ ok: true });
        return;
      }

      if (message.type === MESSAGE_TYPES.HIDE_PAGE_ACTIVITY_OVERLAY) {
        deps.hidePageActivityOverlay();
        sendResponse({ ok: true });
        return;
      }

      if (message.type === MESSAGE_TYPES.EXTRACT_WORKSPACE_CONTEXT) {
        const workspaceStartedAtMs = deps.nowMs();
        if (deps.isSupportedProfilePage()) {
          const extracted = await extractFullProfile(deps, { forceScrollPass: Boolean(message.forceScrollPass) });
          const person = buildProfilePerson(extracted?.profile);
          sendResponse({
            ok: true,
            supported: extracted.supported,
            pageType: extracted.pageType,
            pageUrl: extracted.pageUrl,
            title: extracted.title,
            person,
            profile: extracted.profile || null,
            conversation: null,
            debug: {
              ...(extracted.debug || {}),
              page_kind: "profile",
              person_found: Boolean(person?.fullName),
              connection_status: person?.connectionStatus || "",
              workspace_context_total_ms: deps.roundMs(deps.nowMs() - workspaceStartedAtMs),
              workspace_context_scroll_mode: "full_profile",
              workspace_context_extract_ms: deps.roundMs(extracted?.debug?.profile_extract_ms || 0)
            }
          });
          return;
        }

        const extractStartedAtMs = deps.nowMs();
        const extracted = extractWorkspaceContext(deps);
        const workspaceTiming = {
          workspace_context_total_ms: deps.roundMs(deps.nowMs() - workspaceStartedAtMs),
          workspace_context_scroll_mode: "none",
          workspace_context_scroll_pass_1_ms: 0,
          workspace_context_expand_pass_1_ms: 0,
          workspace_context_scroll_pass_2_ms: 0,
          workspace_context_expand_pass_2_ms: 0,
          workspace_context_scroll_stability_wait_ms: 0,
          workspace_context_scroll_stability_checks: 0,
          workspace_context_extract_ms: deps.roundMs(deps.nowMs() - extractStartedAtMs)
        };
        if (!extracted.supported) {
          sendResponse({ ok: false, error: UNSUPPORTED_LINKEDIN_PAGE_ERROR });
          return;
        }
        sendResponse({
          ok: true,
          ...extracted,
          debug: {
            ...(extracted.debug || {}),
            ...workspaceTiming
          }
        });
        return;
      }

      if (message.type === MESSAGE_TYPES.OPEN_CURRENT_PROFILE_MESSAGES) {
        sendResponse(await deps.openMessagesFromCurrentProfileAndWait());
        return;
      }

      if (message.type === MESSAGE_TYPES.EXTRACT_OPEN_MESSAGE_BUBBLE_WORKSPACE) {
        const extracted = deps.extractOpenMessageBubbleWorkspace();
        if (!extracted?.supported) {
          sendResponse({
            ok: false,
            error: "LinkedIn message bubble content is not ready yet.",
            ...extracted
          });
          return;
        }
        sendResponse({
          ok: true,
          ...extracted
        });
        return;
      }

      if (message.type === MESSAGE_TYPES.EXTRACT_RECIPIENT) {
        const extracted = await extractRecipientProfileWithFullRetries(deps, { forceScrollPass: Boolean(message.forceScrollPass) });
        if (!extracted.supported) {
          sendResponse({
            ok: false,
            error: PROFILE_NOT_SUPPORTED_ERROR,
            profile: extracted.profile || null,
            debug: extracted.debug || null
          });
          return;
        }
        sendResponse({ ok: true, profile: extracted.profile });
        return;
      }

      if (message.type === MESSAGE_TYPES.EXTRACT_SELF_PROFILE) {
        const extracted = await extractSelfProfileWithRetries(deps);
        if (!extracted.supported) {
          sendResponse({
            ok: false,
            error: PROFILE_NOT_SUPPORTED_ERROR,
            draft: extracted?.profile ? deps.buildMyProfileDraft(extracted.profile) : null,
            profile: extracted.profile || null,
            debug: extracted.debug || null
          });
          return;
        }
        sendResponse({
          ok: true,
          draft: deps.buildMyProfileDraft(extracted.profile),
          profile: extracted.profile,
          debug: extracted.debug || null
        });
        return;
      }
    } catch (error) {
      sendResponse({ ok: false, error: error.message || String(error) });
    }
  }

  globalThis.LinkedInAssistantLinkedInCommands = {
    buildPersonIdentity,
    buildProfilePerson,
    extractWorkspaceContext,
    extractLightweightProfilePageContext,
    extractFullProfile,
    extractProfileWithRetries,
    extractSelfProfileWithRetries,
    extractRecipientProfileWithFullRetries,
    extractMessagingContextWithRetries,
    extractMessagingContext,
    handleMessage
  };
})();
