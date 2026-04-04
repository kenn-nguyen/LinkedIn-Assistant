(function initShared(global) {
  const LEGACY_FIXED_TAIL = "I’m finishing Yale SOM in May 2026 and previously led PM for an AI identity/risk platform in fintech. If you’re open to it, I’d appreciate 1-2 quick questions here.";
  const FIXED_TAIL = "I’m finishing Yale SOM in May 2026 and previously led PM for an AI identity/risk platform in fintech. Would you be open to 1-2 quick questions here?";
  const DEFAULT_CHATGPT_PROJECT_URL = "https://chatgpt.com/?temporary-chat=true";
  const DEFAULT_GEMINI_URL = "https://gemini.google.com/u/3/app";
  const DEFAULT_LLM_PROVIDER = "chatgpt";
  const DEFAULT_LLM_ENTRY_URLS = {
    chatgpt: DEFAULT_CHATGPT_PROJECT_URL,
    gemini: DEFAULT_GEMINI_URL
  };
  const LLM_PROVIDERS = Object.freeze(Object.keys(DEFAULT_LLM_ENTRY_URLS));
  const MAX_MESSAGE_LENGTH = 1200;
  const RELATIONSHIP_STAGES = [
    "new",
    "cold_sent",
    "no_reply",
    "engaged",
    "warm",
    "ready_for_referral"
  ];
  const RECOMMENDED_ACTIONS = [
    "draft_first_message",
    "draft_follow_up",
    "draft_reply",
    "draft_advice_ask",
    "draft_referral_ask",
    "wait"
  ];
  const CONNECTION_STATUSES = [
    "connected",
    "not_connected",
    "pending",
    "unknown"
  ];
  const INVESTMENT_DECISIONS = [
    "continue_investing",
    "low_pressure_follow_up",
    "pause_until_new_trigger",
    "move_on"
  ];
  const RESEARCH_RECOMMENDATIONS = [
    "no_new_research_needed",
    "find_new_context_before_follow_up"
  ];
  const USER_GOALS = [
    "build_relationship",
    "get_advice",
    "ask_intro",
    "ask_referral",
    "job_insight"
  ];
  const STORAGE_KEYS = {
    myProfile: "myProfile",
    fixedTail: "fixedTail",
    promptSettings: "promptSettings",
    chatGptProjectUrl: "chatGptProjectUrl",
    people: "people",
    personDraftWorkspaces: "personDraftWorkspaces",
    threadPersonBindings: "threadPersonBindings",
    profileRedirects: "profileRedirects",
    identityResolutionSeenOpaqueUrls: "identityResolutionSeenOpaqueUrls",
    identityResolutionSettings: "identityResolutionSettings"
  };
  const MESSAGE_TYPES = {
    GET_PAGE_CONTEXT: "GET_PAGE_CONTEXT",
    EXTRACT_RECIPIENT: "EXTRACT_RECIPIENT",
    EXTRACT_SELF_PROFILE: "EXTRACT_SELF_PROFILE",
    EXTRACT_WORKSPACE_CONTEXT: "EXTRACT_WORKSPACE_CONTEXT",
    GENERATE_FOR_RECIPIENT: "GENERATE_FOR_RECIPIENT",
    UPDATE_MY_PROFILE: "UPDATE_MY_PROFILE",
    SAVE_MY_PROFILE: "SAVE_MY_PROFILE",
    SET_PENDING_MY_PROFILE_TARGET: "SET_PENDING_MY_PROFILE_TARGET",
    SAVE_FIXED_TAIL: "SAVE_FIXED_TAIL",
    SAVE_PROMPT_SETTINGS: "SAVE_PROMPT_SETTINGS",
    SAVE_CHATGPT_PROJECT_URL: "SAVE_CHATGPT_PROJECT_URL",
    MARK_IDENTITY_RESOLUTION_SEEN: "MARK_IDENTITY_RESOLUTION_SEEN",
    SAVE_PERSON_NOTE: "SAVE_PERSON_NOTE",
    SAVE_PERSON_GOAL: "SAVE_PERSON_GOAL",
    SAVE_PERSON_THREAD_URL: "SAVE_PERSON_THREAD_URL",
    IMPORT_CURRENT_CONVERSATION: "IMPORT_CURRENT_CONVERSATION",
    CLEAR_IMPORTED_CONVERSATION: "CLEAR_IMPORTED_CONVERSATION",
    GET_STORAGE_STATE: "GET_STORAGE_STATE",
    RESOLVE_PROFILE_IDENTITY: "RESOLVE_PROFILE_IDENTITY",
    SAVE_IDENTITY_RESOLUTION_SETTINGS: "SAVE_IDENTITY_RESOLUTION_SETTINGS",
    READ_LATEST_CHATGPT_RESPONSE: "READ_LATEST_CHATGPT_RESPONSE",
    READ_LATEST_PROVIDER_RESPONSE: "READ_LATEST_PROVIDER_RESPONSE",
    RUN_PROMPT: "RUN_PROMPT",
    READ_RESPONSE: "READ_RESPONSE",
    RETRY_RUN: "RETRY_RUN",
    GET_CHATGPT_STATE: "GET_CHATGPT_STATE",
    GET_PROVIDER_STATE: "GET_PROVIDER_STATE",
    GENERATION_PROGRESS: "GENERATION_PROGRESS",
    GENERATION_COMPLETE: "GENERATION_COMPLETE",
    GENERATION_FAILED: "GENERATION_FAILED",
    PAGE_CONTEXT_CHANGED: "PAGE_CONTEXT_CHANGED",
    LINKEDIN_CLICK_TRACE: "LINKEDIN_CLICK_TRACE",
    SHOW_PAGE_ACTIVITY_OVERLAY: "SHOW_PAGE_ACTIVITY_OVERLAY",
    HIDE_PAGE_ACTIVITY_OVERLAY: "HIDE_PAGE_ACTIVITY_OVERLAY",
    FACTORY_RESET: "FACTORY_RESET"
  };

  function normalizeWhitespace(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function generateShortUuid() {
    const alphabet = "23456789abcdefghijkmnpqrstuvwxyz";
    const length = 10;
    const bytes = new Uint8Array(length);
    const cryptoObject = global.crypto || globalThis.crypto;
    if (cryptoObject?.getRandomValues) {
      cryptoObject.getRandomValues(bytes);
    } else {
      for (let index = 0; index < length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
    }
    let id = "";
    for (let index = 0; index < length; index += 1) {
      id += alphabet[bytes[index] % alphabet.length];
    }
    return id;
  }

  function normalizeOutputText(value) {
    return normalizeWhitespace(String(value || "")
      .replace(/\u2014/g, "-"));
  }

  function truncate(value, limit) {
    const text = normalizeWhitespace(value);
    if (text.length <= limit) {
      return text;
    }
    return `${text.slice(0, Math.max(0, limit - 1)).trim()}…`;
  }

  function uniqueStrings(values) {
    const seen = new Set();
    return (values || [])
      .map(normalizeWhitespace)
      .filter(Boolean)
      .filter((value) => {
        const key = value.toLowerCase();
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
  }

  function safeJson(value, fallback) {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return fallback;
    }
  }

  function toIsoNow() {
    return new Date().toISOString();
  }

  function firstNameFromFullName(fullName) {
    const normalized = normalizeWhitespace(fullName);
    if (!normalized) {
      return "";
    }
    return normalized.split(" ")[0];
  }

  function extractOwnProfileName(rawSnapshot) {
    const text = String(rawSnapshot || "");
    if (!text) {
      return "";
    }

    const topCardMatch = text.match(/Top card:\s*([^\n|]+)/i);
    if (topCardMatch) {
      return normalizeWhitespace(topCardMatch[1]).replace(/\s+\((he\/him|she\/her|they\/them)\)$/i, "");
    }

    const firstLine = normalizeWhitespace(text.split("\n")[0] || "");
    return firstLine.replace(/\s+\((he\/him|she\/her|they\/them)\)$/i, "");
  }

  function normalizeNameKey(value) {
    return normalizeWhitespace(value)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function sameNormalizedName(left, right) {
    const leftKey = normalizeNameKey(left);
    const rightKey = normalizeNameKey(right);
    return Boolean(leftKey && rightKey && leftKey === rightKey);
  }

  function ensureSentence(text) {
    const normalized = normalizeWhitespace(text);
    if (!normalized) {
      return "";
    }
    return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
  }

  function combineMessage(opener, fixedTail) {
    const safeOpener = ensureSentence(opener);
    return normalizeWhitespace(`${safeOpener} ${fixedTail}`);
  }

  function normalizeFixedTail(value) {
    const normalized = normalizeWhitespace(value);
    if (!normalized || normalized === normalizeWhitespace(LEGACY_FIXED_TAIL)) {
      return FIXED_TAIL;
    }
    return normalized;
  }

  function compactProfile(profile, fields) {
    return fields
      .map(({ label, value }) => {
        const normalized = Array.isArray(value)
          ? uniqueStrings(value).join(" | ")
          : normalizeWhitespace(value);
        return normalized ? `${label}: ${normalized}` : "";
      })
      .filter(Boolean)
      .join("\n");
  }

  function sanitizeRecipientProfileMemory(value) {
    const text = normalizeWhitespace(value);
    if (!text) {
      return "";
    }

    const firstFullNameIndex = text.toLowerCase().indexOf("full name:");
    const normalized = firstFullNameIndex > 0 ? text.slice(firstFullNameIndex).trim() : text;
    const repeatedBlockIndex = normalized.toLowerCase().indexOf(" full name:", "full name:".length);

    if (repeatedBlockIndex > 0) {
      return normalized.slice(0, repeatedBlockIndex).trim();
    }

    return normalized;
  }

  function normalizeUrl(value) {
    const text = normalizeWhitespace(value);
    if (!text) {
      return "";
    }
    try {
      return new URL(text).toString();
    } catch (_error) {
      return text;
    }
  }

  function normalizeLlmProvider(value) {
    const normalized = normalizeWhitespace(value).toLowerCase();
    return LLM_PROVIDERS.includes(normalized) ? normalized : DEFAULT_LLM_PROVIDER;
  }

  function defaultLlmEntryUrl(provider) {
    return DEFAULT_LLM_ENTRY_URLS[normalizeLlmProvider(provider)] || DEFAULT_CHATGPT_PROJECT_URL;
  }

  function providerDisplayName(provider) {
    switch (normalizeLlmProvider(provider)) {
      case "gemini":
        return "Gemini";
      case "chatgpt":
      default:
        return "ChatGPT";
    }
  }

  function isChatGptUrl(value) {
    const normalized = normalizeUrl(value);
    return Boolean(normalized && /https:\/\/(?:chatgpt\.com|chat\.openai\.com)\//i.test(normalized));
  }

  function isGeminiUrl(value) {
    const normalized = normalizeUrl(value);
    return Boolean(normalized && /https:\/\/gemini\.google\.com\//i.test(normalized));
  }

  function normalizeLlmEntryUrl(provider, value) {
    const normalizedProvider = normalizeLlmProvider(provider);
    const normalizedUrl = normalizeUrl(value);
    if (!normalizedUrl) {
      return defaultLlmEntryUrl(normalizedProvider);
    }
    if (normalizedProvider === "chatgpt" && isChatGptUrl(normalizedUrl)) {
      return normalizedUrl;
    }
    if (normalizedProvider === "gemini" && isGeminiUrl(normalizedUrl)) {
      return normalizedUrl;
    }
    return defaultLlmEntryUrl(normalizedProvider);
  }

  function normalizeLinkedInProfileUrl(value) {
    const text = normalizeUrl(value);
    if (!text) {
      return "";
    }
    try {
      const url = new URL(text);
      if (!/linkedin\.com$/i.test(url.hostname) && !/linkedin\.com$/i.test(url.hostname.split(".").slice(-2).join("."))) {
        return text;
      }
      const parts = url.pathname.split("/").filter(Boolean);
      const profileIndex = parts.indexOf("in");
      if (profileIndex >= 0 && parts[profileIndex + 1]) {
        let slug = parts[profileIndex + 1];
        try {
          slug = decodeURIComponent(slug);
        } catch (_error) {
          // Keep the raw slug when decoding fails.
        }
        return `${url.origin}/in/${slug}/`;
      }
      return `${url.origin}${url.pathname}`;
    } catch (_error) {
      return text;
    }
  }

  function slugify(value) {
    return normalizeWhitespace(value)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/œ/g, "oe")
      .replace(/æ/g, "ae")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function personIdFromProfileUrl(profileUrl, fallbackName) {
    const normalizedProfileUrl = normalizeLinkedInProfileUrl(profileUrl);
    if (normalizedProfileUrl) {
      try {
        const url = new URL(normalizedProfileUrl);
        const parts = url.pathname.split("/").filter(Boolean);
        const profileIndex = parts.indexOf("in");
        if (profileIndex >= 0 && parts[profileIndex + 1]) {
          let slug = parts[profileIndex + 1];
          try {
            slug = decodeURIComponent(slug);
          } catch (_error) {
            // Keep the raw slug when decoding fails.
          }
          return `li:${slugify(slug)}`;
        }
      } catch (_error) {
        // Fall through to fallback name.
      }
    }

    const slug = slugify(fallbackName);
    return slug ? `name:${slug}` : "";
  }

  function linkedInProfileAlias(profileUrl) {
    const normalizedProfileUrl = normalizeLinkedInProfileUrl(profileUrl);
    return normalizedProfileUrl ? normalizedProfileUrl.toLowerCase() : "";
  }

  function isOpaqueLinkedInSlugValue(slug) {
    const normalized = normalizeWhitespace(slug);
    if (!normalized) {
      return false;
    }
    return /^ACo/i.test(normalized)
      || /[A-Z]/.test(normalized)
      || (!normalized.includes("-") && normalized.length > 20);
  }

  function isOpaqueLinkedInPersonId(value) {
    const normalized = normalizeWhitespace(value).toLowerCase();
    return normalized.startsWith("li:") && isOpaqueLinkedInSlugValue(normalized.slice(3));
  }

  function defaultMyProfile() {
    return {
      ownProfileUrl: "",
      pendingProfileUrl: "",
      manualNotes: "",
      rawSnapshot: "",
      updatedAt: ""
    };
  }

  function defaultIdentity(overrides) {
    return {
      personId: "",
      fullName: "",
      firstName: "",
      profileUrl: "",
      primaryLinkedInMemberUrl: "",
      publicProfileUrl: "",
      knownProfileUrls: [],
      normalizedName: "",
      identityStatus: "provisional",
      identityConfidence: "low",
      messagingThreadUrl: "",
      aliases: [],
      ...(overrides || {})
    };
  }

  function defaultProfileContext(overrides) {
    return {
      headline: "",
      location: "",
      connectionStatus: "unknown",
      recipientSummaryMemory: "",
      recipientProfileMemory: "",
      profileSummary: "",
      rawSnapshot: "",
      lastProfileSyncedAt: "",
      recentProfileChanges: "",
      latestProfileData: null,
      ...(overrides || {})
    };
  }

  function defaultRelationshipContext(overrides) {
    return {
      userGoal: "",
      personNote: "",
      relationshipStage: "",
      ...(overrides || {})
    };
  }

  function defaultObservedConversation(overrides) {
    return {
      importedAt: "",
      sourcePageType: "",
      lastSpeaker: "",
      lastMessageAt: "",
      messages: [],
      rawThreadText: "",
      messageSignature: "",
      syncStatus: "",
      ...(overrides || {})
    };
  }

  function defaultObservedMetrics(overrides) {
    return {
      computed_at: "",
      page_type: "",
      is_connection: false,
      user_goal: "",
      user_goal_label: "",
      has_visible_thread: false,
      has_imported_history: false,
      known_message_count: 0,
      known_inbound_count: 0,
      known_outbound_count: 0,
      has_ever_replied: false,
      conversation_state: "",
      unanswered_outbound_streak: 0,
      who_spoke_last: "unknown",
      first_known_message_at_raw: "",
      first_known_message_at: "",
      last_known_message_at_raw: "",
      last_known_message_at: "",
      last_known_inbound_at_raw: "",
      last_known_inbound_at: "",
      last_known_outbound_at_raw: "",
      last_known_outbound_at: "",
      days_since_first_known_contact: null,
      days_since_last_known_message: null,
      days_since_last_known_inbound: null,
      days_since_last_known_outbound: null,
      known_conversation_span_days: null,
      timestamp_confidence: "",
      context_confidence: "",
      current_context_source: "",
      thread_tone: "",
      thread_pace: "",
      thread_warmth_signal: "",
      thread_tone_guidance: "",
      ...(overrides || {})
    };
  }

  function defaultDraftWorkspace(overrides) {
    return {
      generatedAt: "",
      flowType: "",
      pageType: "",
      first_name: "",
      recipient_summary: "",
      relationship_stage: "",
      recommended_action: "",
      reason_why_now: "",
      is_referral_ready: false,
      referral_readiness: null,
      ai_assessment: null,
      logic_metrics: null,
      messages: [],
      relationship_triage: null,
      extra_context: "",
      providerPrompt: "",
      rawOutput: "",
      recipient_full_name: "",
      recipient_profile_url: "",
      conversation: null,
      based_on_message_signature: "",
      is_stale: false,
      ...(overrides || {})
    };
  }

  function defaultDashboardReview(overrides) {
    return {
      reviewedAt: "",
      action_bucket: "",
      stage: "",
      referral_potential: "",
      ask_readiness: "",
      needs_more_context: false,
      context_gap_reason: "",
      why: "",
      next_best_move: "",
      based_on_message_signature: "",
      is_stale: false,
      ...(overrides || {})
    };
  }

  function defaultSystemRecord(overrides) {
    return {
      recordUuid: "",
      updatedAt: "",
      lastPageType: "",
      lastInteractionAt: "",
      lastAiRecommendationAt: "",
      lastAiRecommendationMessageSignature: "",
      aiRecommendationStale: false,
      ...(overrides || {})
    };
  }

  function normalizeConversationMessages(messages) {
    return dedupeConversationMessages(Array.isArray(messages) ? messages : [])
      .map((entry, index) => ({
        sender: normalizeWhitespace(entry?.sender),
        text: normalizeWhitespace(entry?.text),
        timestamp: normalizeConversationTimestamp(entry?.timestamp),
        __index: index
      }))
      .sort((left, right) => {
        const leftDate = parseLooseLinkedInDate(left.timestamp, new Date());
        const rightDate = parseLooseLinkedInDate(right.timestamp, new Date());
        if (leftDate && rightDate) {
          return rightDate - leftDate;
        }
        if (leftDate) {
          return -1;
        }
        if (rightDate) {
          return 1;
        }
        return left.__index - right.__index;
      })
      .map(({ __index, ...entry }) => entry);
  }

  function canonicalConversationSender(sender, recipientFullName, ownFullName) {
    const normalizedSender = normalizeWhitespace(sender);
    if (!normalizedSender) {
      return "";
    }
    if (/^you(?:\s|$)/i.test(normalizedSender)) {
      return normalizeWhitespace(ownFullName) || "You";
    }
    return normalizedSender;
  }

  function canonicalizeConversationEntries(messages, recipientFullName, ownFullName) {
    return normalizeConversationMessages((messages || []).map((entry) => ({
      sender: canonicalConversationSender(entry?.sender, recipientFullName, ownFullName),
      text: normalizeWhitespace(entry?.text),
      timestamp: normalizeConversationTimestamp(entry?.timestamp)
    })));
  }

  function stableConversationSignature(conversation) {
    if (!conversation || typeof conversation !== "object") {
      return "";
    }
    const messages = normalizeConversationMessages(conversation.messages);
    return JSON.stringify({
      sourcePageType: normalizeWhitespace(conversation.sourcePageType),
      lastSpeaker: normalizeWhitespace(conversation.lastSpeaker),
      lastMessageAt: normalizeWhitespace(conversation.lastMessageAt),
      rawThreadText: normalizeWhitespace(conversation.rawThreadText),
      messages
    });
  }

  function normalizeProfileData(profile) {
    if (!profile || typeof profile !== "object") {
      return null;
    }
    return {
      fullName: normalizeWhitespace(profile.fullName),
      firstName: normalizeWhitespace(profile.firstName),
      profileUrl: normalizeLinkedInProfileUrl(profile.profileUrl),
      headline: normalizeWhitespace(profile.headline),
      profileSummary: normalizeWhitespace(profile.profileSummary),
      about: normalizeWhitespace(profile.about),
      location: normalizeWhitespace(profile.location),
      connectionStatus: normalizeConnectionStatus(profile.connectionStatus) || "unknown",
      experienceHighlights: uniqueStrings(profile.experienceHighlights || []),
      educationHighlights: uniqueStrings(profile.educationHighlights || []),
      activitySnippets: uniqueStrings(profile.activitySnippets || []),
      languageSnippets: uniqueStrings(profile.languageSnippets || []),
      rawSnapshot: normalizeWhitespace(profile.rawSnapshot),
      visibleSignals: {
        companies: uniqueStrings(profile.visibleSignals?.companies || []),
        schools: uniqueStrings(profile.visibleSignals?.schools || []),
        locations: uniqueStrings(profile.visibleSignals?.locations || []),
        languages: uniqueStrings(profile.visibleSignals?.languages || [])
      }
    };
  }

  function describeProfileChanges(previousProfile, nextProfile) {
    const previous = normalizeProfileData(previousProfile);
    const next = normalizeProfileData(nextProfile);
    if (!next) {
      return "";
    }

    const changes = [];
    if (!previous) {
      if (next.headline) {
        changes.push(`Captured headline: ${next.headline}`);
      }
      if (next.experienceHighlights[0]) {
        changes.push(`Relevant experience now in context: ${next.experienceHighlights[0]}`);
      }
      if (next.activitySnippets[0]) {
        changes.push(`Recent activity now in context: ${next.activitySnippets[0]}`);
      }
      return changes.join("\n");
    }

    if (next.headline && next.headline !== previous.headline) {
      changes.push(`Headline changed from "${previous.headline || "unknown"}" to "${next.headline}".`);
    }
    if (next.location && next.location !== previous.location) {
      changes.push(`Location changed from "${previous.location || "unknown"}" to "${next.location}".`);
    }

    const newExperience = next.experienceHighlights.filter((item) => !previous.experienceHighlights.includes(item)).slice(0, 2);
    const newActivity = next.activitySnippets.filter((item) => !previous.activitySnippets.includes(item)).slice(0, 2);
    const newEducation = next.educationHighlights.filter((item) => !previous.educationHighlights.includes(item)).slice(0, 1);

    newExperience.forEach((item) => changes.push(`New experience signal: ${item}`));
    newActivity.forEach((item) => changes.push(`New activity signal: ${item}`));
    newEducation.forEach((item) => changes.push(`New education signal: ${item}`));

    if (!changes.length && next.profileSummary && next.profileSummary !== previous.profileSummary) {
      changes.push("Profile context was refreshed and summary details changed.");
    }

    return changes.join("\n");
  }

  function normalizeObservedConversation(conversation) {
    if (!conversation || typeof conversation !== "object") {
      return null;
    }
    const normalized = defaultObservedConversation({
      importedAt: normalizeWhitespace(conversation.importedAt),
      sourcePageType: normalizeWhitespace(conversation.sourcePageType),
      lastSpeaker: normalizeWhitespace(conversation.lastSpeaker),
      lastMessageAt: normalizeWhitespace(conversation.lastMessageAt),
      messages: normalizeConversationMessages(conversation.messages),
      rawThreadText: normalizeWhitespace(conversation.rawThreadText),
      syncStatus: normalizeWhitespace(conversation.syncStatus)
    });
    normalized.messageSignature = normalizeWhitespace(conversation.messageSignature) || stableConversationSignature(normalized);
    if (!normalized.importedAt && !normalized.rawThreadText && !normalized.messages.length) {
      return null;
    }
    return normalized;
  }

  function normalizeObservedMetrics(metrics) {
    if (!metrics || typeof metrics !== "object") {
      return null;
    }
    return defaultObservedMetrics({
      ...metrics,
      computed_at: normalizeWhitespace(metrics.computed_at),
      page_type: normalizeWhitespace(metrics.page_type),
      user_goal: normalizeUserGoal(metrics.user_goal),
      user_goal_label: normalizeWhitespace(metrics.user_goal_label),
      who_spoke_last: normalizeWhitespace(metrics.who_spoke_last) || "unknown",
      first_known_message_at_raw: normalizeWhitespace(metrics.first_known_message_at_raw),
      first_known_message_at: normalizeWhitespace(metrics.first_known_message_at),
      last_known_message_at_raw: normalizeWhitespace(metrics.last_known_message_at_raw),
      last_known_message_at: normalizeWhitespace(metrics.last_known_message_at),
      last_known_inbound_at_raw: normalizeWhitespace(metrics.last_known_inbound_at_raw),
      last_known_inbound_at: normalizeWhitespace(metrics.last_known_inbound_at),
      last_known_outbound_at_raw: normalizeWhitespace(metrics.last_known_outbound_at_raw),
      last_known_outbound_at: normalizeWhitespace(metrics.last_known_outbound_at),
      timestamp_confidence: normalizeWhitespace(metrics.timestamp_confidence),
      context_confidence: normalizeWhitespace(metrics.context_confidence),
      current_context_source: normalizeWhitespace(metrics.current_context_source)
    });
  }

  function normalizeDraftWorkspace(workspace) {
    if (!workspace || typeof workspace !== "object") {
      return null;
    }
    const normalized = defaultDraftWorkspace({
      ...workspace,
      generatedAt: normalizeWhitespace(workspace.generatedAt),
      flowType: normalizeWhitespace(workspace.flowType),
      pageType: normalizeWhitespace(workspace.pageType),
      first_name: normalizeWhitespace(workspace.first_name),
      recipient_summary: normalizeOutputText(workspace.recipient_summary),
      relationship_stage: normalizeRelationshipStage(workspace.relationship_stage),
      recommended_action: normalizeRecommendedAction(workspace.recommended_action),
      reason_why_now: normalizeOutputText(workspace.reason_why_now),
      is_referral_ready: Boolean(workspace.is_referral_ready),
      referral_readiness: workspace.referral_readiness ? normalizeReferralReadiness(workspace.referral_readiness) : null,
      ai_assessment: workspace.ai_assessment ? normalizeAiAssessment(workspace.ai_assessment) : null,
      logic_metrics: normalizeObservedMetrics(workspace.logic_metrics),
      messages: Array.isArray(workspace.messages) ? workspace.messages : [],
      relationship_triage: workspace.relationship_triage || null,
      extra_context: normalizeWhitespace(workspace.extra_context),
      providerPrompt: String(workspace.providerPrompt || ""),
      rawOutput: String(workspace.rawOutput || ""),
      recipient_full_name: normalizeWhitespace(workspace.recipient_full_name),
      recipient_profile_url: normalizeLinkedInProfileUrl(workspace.recipient_profile_url),
      conversation: workspace.conversation || null,
      based_on_message_signature: normalizeWhitespace(workspace.based_on_message_signature),
      is_stale: Boolean(workspace.is_stale)
    });
    if (!normalized.generatedAt && !normalized.recommended_action && !normalized.reason_why_now && !normalized.messages.length) {
      return null;
    }
    return normalized;
  }

  function deriveReferralPotential(aiAssessment) {
    const assessment = normalizeAiAssessment(aiAssessment);
    if (
      (assessment.referral_path_strength === "strong" && assessment.recipient_relevance !== "low")
      || (assessment.recipient_relevance === "high" && assessment.referral_path_strength !== "weak")
    ) {
      return "high";
    }
    if (assessment.referral_path_strength === "weak" || assessment.recipient_relevance === "low") {
      return "low";
    }
    return "medium";
  }

  function deriveAskReadiness(action, stage, aiAssessment) {
    const normalizedAction = normalizeRecommendedAction(action);
    const normalizedStage = normalizeRelationshipStage(stage);
    const assessment = normalizeAiAssessment(aiAssessment);
    if (normalizedAction === "draft_referral_ask" || normalizedStage === "ready_for_referral") {
      return "referral_ready";
    }
    if (normalizedAction === "draft_advice_ask") {
      return "advice_ready";
    }
    if (normalizedStage === "warm" && assessment.referral_path_strength === "strong") {
      return "intro_ready";
    }
    return "not_ready";
  }

  function deriveDashboardActionBucket(metrics, systemRecord, draftWorkspace, relationshipStage, aiAssessment) {
    const normalizedMetrics = normalizeObservedMetrics(metrics) || defaultObservedMetrics();
    const whoSpokeLast = normalizeWhitespace(normalizedMetrics.who_spoke_last).toLowerCase();
    const stale = Boolean(systemRecord?.aiRecommendationStale || draftWorkspace?.is_stale);
    const daysSinceOutbound = normalizedMetrics.days_since_last_known_outbound;
    const stage = normalizeRelationshipStage(relationshipStage);
    if (whoSpokeLast === "recipient") {
      return "reply_now";
    }
    if (whoSpokeLast === "self") {
      if (normalizeRecommendedAction(draftWorkspace?.recommended_action) === "wait") {
        return "waiting";
      }
      if (stale) {
        return daysSinceOutbound !== null && daysSinceOutbound !== undefined && daysSinceOutbound < 7 ? "waiting" : "follow_up";
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
      || normalizeWhitespace(aiAssessment?.referral_path_strength).toLowerCase() === "strong"
    ) {
      return "warm";
    }
    return "follow_up";
  }

  function normalizeDashboardReview(review) {
    if (!review || typeof review !== "object") {
      return null;
    }
    const normalized = defaultDashboardReview({
      ...review,
      reviewedAt: normalizeWhitespace(review.reviewedAt),
      action_bucket: normalizeWhitespace(review.action_bucket).toLowerCase(),
      stage: normalizeRelationshipStage(review.stage),
      referral_potential: normalizeWhitespace(review.referral_potential).toLowerCase(),
      ask_readiness: normalizeWhitespace(review.ask_readiness).toLowerCase(),
      needs_more_context: Boolean(review.needs_more_context),
      context_gap_reason: normalizeWhitespace(review.context_gap_reason),
      why: normalizeOutputText(review.why),
      next_best_move: normalizeWhitespace(review.next_best_move),
      based_on_message_signature: normalizeWhitespace(review.based_on_message_signature),
      is_stale: Boolean(review.is_stale)
    });
    if (!normalized.reviewedAt && !normalized.why && !normalized.action_bucket && !normalized.referral_potential) {
      return null;
    }
    return normalized;
  }

  function deriveDashboardReview(personRecord) {
    const draftWorkspace = normalizeDraftWorkspace(personRecord?.draftWorkspace) || defaultDraftWorkspace();
    const observedMetrics = normalizeObservedMetrics(personRecord?.observedMetrics || personRecord?.lastLogicMetrics) || defaultObservedMetrics();
    const systemRecord = defaultSystemRecord({
      aiRecommendationStale: Boolean(personRecord?.system?.aiRecommendationStale ?? personRecord?.aiRecommendationStale),
      lastAiRecommendationAt: normalizeWhitespace(personRecord?.system?.lastAiRecommendationAt || personRecord?.lastAiRecommendationAt),
      lastAiRecommendationMessageSignature: normalizeWhitespace(personRecord?.system?.lastAiRecommendationMessageSignature || personRecord?.lastAiRecommendationMessageSignature)
    });
    const aiAssessment = personRecord?.aiConversationAssessment
      ? normalizeAiAssessment(personRecord.aiConversationAssessment)
      : personRecord?.aiProfileAssessment
        ? normalizeAiAssessment(personRecord.aiProfileAssessment)
        : draftWorkspace.ai_assessment
          ? normalizeAiAssessment(draftWorkspace.ai_assessment)
          : defaultAiAssessment();
    const relationshipStage = normalizeRelationshipStage(
      personRecord?.relationshipContext?.relationshipStage
      || personRecord?.relationshipStage
      || draftWorkspace.relationship_stage
    );
    const relationshipTriage = draftWorkspace.relationship_triage || null;
    return defaultDashboardReview({
      reviewedAt: normalizeWhitespace(personRecord?.dashboardReview?.reviewedAt)
        || normalizeWhitespace(systemRecord.lastAiRecommendationAt)
        || normalizeWhitespace(draftWorkspace.generatedAt),
      action_bucket: normalizeWhitespace(personRecord?.dashboardReview?.action_bucket)
        || deriveDashboardActionBucket(observedMetrics, systemRecord, draftWorkspace, relationshipStage, aiAssessment),
      stage: normalizeRelationshipStage(personRecord?.dashboardReview?.stage) || relationshipStage,
      referral_potential: normalizeWhitespace(personRecord?.dashboardReview?.referral_potential).toLowerCase()
        || deriveReferralPotential(aiAssessment),
      ask_readiness: normalizeWhitespace(personRecord?.dashboardReview?.ask_readiness).toLowerCase()
        || deriveAskReadiness(draftWorkspace.recommended_action, relationshipStage, aiAssessment),
      needs_more_context: typeof personRecord?.dashboardReview?.needs_more_context === "boolean"
        ? Boolean(personRecord.dashboardReview.needs_more_context)
        : normalizeResearchRecommendation(relationshipTriage?.research_recommendation) === "find_new_context_before_follow_up",
      context_gap_reason: normalizeWhitespace(personRecord?.dashboardReview?.context_gap_reason)
        || (normalizeResearchRecommendation(relationshipTriage?.research_recommendation) === "find_new_context_before_follow_up"
          ? "Need a fresher, more specific reason to re-engage."
          : ""),
      why: normalizeOutputText(personRecord?.dashboardReview?.why)
        || normalizeOutputText(draftWorkspace.reason_why_now)
        || normalizeOutputText(relationshipTriage?.summary)
        || normalizeOutputText(aiAssessment.referral_path_reason)
        || normalizeOutputText(aiAssessment.warmth_reason)
        || normalizeOutputText(aiAssessment.relevance_reason),
      next_best_move: normalizeWhitespace(personRecord?.dashboardReview?.next_best_move)
        || normalizeRecommendedAction(draftWorkspace.recommended_action)
        || "",
      based_on_message_signature: normalizeWhitespace(personRecord?.dashboardReview?.based_on_message_signature)
        || normalizeWhitespace(draftWorkspace.based_on_message_signature)
        || normalizeWhitespace(systemRecord.lastAiRecommendationMessageSignature),
      is_stale: typeof personRecord?.dashboardReview?.is_stale === "boolean"
        ? Boolean(personRecord.dashboardReview.is_stale)
        : Boolean(systemRecord.aiRecommendationStale || draftWorkspace.is_stale)
    });
  }

  function deriveDraftWorkspace(personRecord) {
    const workspace = normalizeDraftWorkspace(personRecord?.draftWorkspace);
    if (workspace) {
      if (!workspace.based_on_message_signature) {
        workspace.based_on_message_signature = normalizeWhitespace(
          personRecord?.system?.lastAiRecommendationMessageSignature || personRecord?.lastAiRecommendationMessageSignature
        );
      }
      if (!workspace.generatedAt) {
        workspace.generatedAt = normalizeWhitespace(
          personRecord?.system?.lastAiRecommendationAt || personRecord?.lastAiRecommendationAt
        );
      }
      if (!workspace.recipient_summary) {
        workspace.recipient_summary = normalizeOutputText(
          personRecord?.profileContext?.recipientSummaryMemory || personRecord?.recipientSummaryMemory
        );
      }
      workspace.is_stale = Boolean(
        workspace.is_stale
        || personRecord?.system?.aiRecommendationStale
        || personRecord?.aiRecommendationStale
      );
      return workspace;
    }

    const action = normalizeRecommendedAction(personRecord?.lastRecommendedAction);
    const reason = normalizeOutputText(personRecord?.lastReasonWhyNow);
    if (!action && !reason) {
      return null;
    }

    return defaultDraftWorkspace({
      generatedAt: normalizeWhitespace(personRecord?.lastAiRecommendationAt),
      recommended_action: action,
      reason_why_now: reason,
      relationship_stage: normalizeRelationshipStage(
        personRecord?.relationshipContext?.relationshipStage || personRecord?.relationshipStage
      ),
      recipient_summary: normalizeOutputText(
        personRecord?.profileContext?.recipientSummaryMemory || personRecord?.recipientSummaryMemory
      ),
      ai_assessment: personRecord?.aiConversationAssessment || personRecord?.aiProfileAssessment || null,
      logic_metrics: normalizeObservedMetrics(personRecord?.observedMetrics || personRecord?.lastLogicMetrics),
      based_on_message_signature: normalizeWhitespace(
        personRecord?.system?.lastAiRecommendationMessageSignature || personRecord?.lastAiRecommendationMessageSignature
      ),
      is_stale: Boolean(personRecord?.system?.aiRecommendationStale || personRecord?.aiRecommendationStale)
    });
  }

  function getIdentity(personRecord) {
    return defaultIdentity(personRecord?.identity || {
      personId: personRecord?.personId,
      fullName: personRecord?.fullName,
      firstName: personRecord?.firstName,
      profileUrl: personRecord?.profileUrl,
      messagingThreadUrl: personRecord?.messagingThreadUrl
    });
  }

  function getProfileContext(personRecord) {
    return defaultProfileContext(personRecord?.profileContext || {
      headline: personRecord?.headline,
      location: personRecord?.location,
      connectionStatus: personRecord?.connectionStatus,
      recipientSummaryMemory: personRecord?.recipientSummaryMemory,
      recipientProfileMemory: personRecord?.recipientProfileMemory,
      profileSummary: personRecord?.profileSummary,
      rawSnapshot: personRecord?.rawSnapshot,
      lastProfileSyncedAt: personRecord?.lastProfileSyncedAt,
      recentProfileChanges: personRecord?.recentProfileChanges
    });
  }

  function getRelationshipContext(personRecord) {
    return defaultRelationshipContext(personRecord?.relationshipContext || {
      userGoal: personRecord?.userGoal,
      personNote: personRecord?.personNote,
      relationshipStage: personRecord?.relationshipStage
    });
  }

  function getObservedConversation(personRecord) {
    return normalizeObservedConversation(personRecord?.observedConversation || personRecord?.importedConversation);
  }

  function getObservedMetrics(personRecord) {
    return normalizeObservedMetrics(personRecord?.observedMetrics || personRecord?.lastLogicMetrics);
  }

  function getDraftWorkspace(personRecord) {
    return deriveDraftWorkspace(personRecord);
  }

  function getDashboardReview(personRecord) {
    return normalizeDashboardReview(personRecord?.dashboardReview) || deriveDashboardReview(personRecord);
  }

  function defaultPersonRecord(overrides) {
    return {
      uuid: "",
      personId: "",
      fullName: "",
      firstName: "",
      profileUrl: "",
      messagingThreadUrl: "",
      headline: "",
      location: "",
      recipientSummaryMemory: "",
      recipientProfileMemory: "",
      profileSummary: "",
      rawSnapshot: "",
      lastProfileSyncedAt: "",
      recentProfileChanges: "",
      connectionStatus: "unknown",
      userGoal: "",
      personNote: "",
      chatGptThreadUrl: "",
      importedConversation: null,
      relationshipStage: "",
      lastRecommendedAction: "",
      lastReasonWhyNow: "",
      lastInteractionAt: "",
      lastPageType: "",
      lastLogicMetrics: null,
      lastAiRecommendationAt: "",
      lastAiRecommendationMessageSignature: "",
      aiRecommendationStale: false,
      aiProfileAssessment: null,
      aiConversationAssessment: null,
      lastWorkspace: null,
      identity: defaultIdentity(),
      profileContext: defaultProfileContext(),
      relationshipContext: defaultRelationshipContext(),
      observedConversation: null,
      observedMetrics: null,
      observedRelationshipTriage: null,
      draftWorkspace: null,
      dashboardReview: null,
      system: defaultSystemRecord(),
      updatedAt: "",
      ...overrides
    };
  }

  function mergePersonRecord(existing, incoming) {
    const merged = {
      ...defaultPersonRecord(),
      ...(existing || {}),
      ...(incoming || {})
    };
    const recordUuid = normalizeWhitespace(
      existing?.uuid
      || existing?.system?.recordUuid
      || incoming?.uuid
      || incoming?.system?.recordUuid
      || merged.uuid
      || merged.system?.recordUuid
    ) || generateShortUuid();

    const existingProfileUrl = normalizeLinkedInProfileUrl(existing?.identity?.profileUrl || existing?.profileUrl);
    const incomingProfileUrl = normalizeLinkedInProfileUrl(incoming?.identity?.profileUrl || incoming?.profileUrl);
    const mergedProfileUrl = normalizeLinkedInProfileUrl(merged.identity?.profileUrl || merged.profileUrl);
    const explicitPrimaryLinkedInMemberUrl = normalizeLinkedInProfileUrl(
      merged.identity?.primaryLinkedInMemberUrl
      || incoming?.identity?.primaryLinkedInMemberUrl
      || existing?.identity?.primaryLinkedInMemberUrl
    );
    const explicitPublicProfileUrl = normalizeLinkedInProfileUrl(
      merged.identity?.publicProfileUrl
      || incoming?.identity?.publicProfileUrl
      || existing?.identity?.publicProfileUrl
    );
    const allKnownProfileUrls = uniqueStrings([
      ...(existing?.identity?.knownProfileUrls || []),
      ...(incoming?.identity?.knownProfileUrls || []),
      explicitPrimaryLinkedInMemberUrl,
      explicitPublicProfileUrl,
      existingProfileUrl,
      incomingProfileUrl,
      mergedProfileUrl
    ].map(normalizeLinkedInProfileUrl).filter(Boolean));
    const opaqueProfileUrls = allKnownProfileUrls.filter((value) => {
      const slug = value ? personIdFromProfileUrl(value, "").replace(/^li:/, "") : "";
      return isOpaqueLinkedInSlugValue(slug);
    });
    const publicProfileUrls = allKnownProfileUrls.filter((value) => {
      const slug = value ? personIdFromProfileUrl(value, "").replace(/^li:/, "") : "";
      return slug && !isOpaqueLinkedInSlugValue(slug);
    });
    const primaryLinkedInMemberUrl = explicitPrimaryLinkedInMemberUrl || opaqueProfileUrls[0] || "";
    const publicProfileUrl = explicitPublicProfileUrl || publicProfileUrls[0] || "";
    const preferredProfileUrl = publicProfileUrl || primaryLinkedInMemberUrl || mergedProfileUrl || "";
    const identity = defaultIdentity({
      ...(existing?.identity || {}),
      ...(incoming?.identity || {}),
      personId: normalizeWhitespace(merged.identity?.personId || merged.personId),
      fullName: normalizeWhitespace(merged.identity?.fullName || merged.fullName),
      firstName: normalizeWhitespace(merged.identity?.firstName || merged.firstName),
      profileUrl: preferredProfileUrl,
      primaryLinkedInMemberUrl,
      publicProfileUrl,
      knownProfileUrls: allKnownProfileUrls,
      normalizedName: normalizeWhitespace(merged.identity?.normalizedName || merged.fullName).toLowerCase(),
      identityStatus: normalizeWhitespace(merged.identity?.identityStatus || incoming?.identity?.identityStatus || existing?.identity?.identityStatus || ""),
      identityConfidence: normalizeWhitespace(merged.identity?.identityConfidence || incoming?.identity?.identityConfidence || existing?.identity?.identityConfidence || ""),
      messagingThreadUrl: normalizeUrl(merged.identity?.messagingThreadUrl || merged.messagingThreadUrl),
      aliases: uniqueStrings([
        ...(existing?.identity?.aliases || []),
        ...(incoming?.identity?.aliases || []),
        ...allKnownProfileUrls.map(linkedInProfileAlias),
        linkedInProfileAlias(existing?.identity?.primaryLinkedInMemberUrl),
        linkedInProfileAlias(existing?.identity?.publicProfileUrl),
        linkedInProfileAlias(incoming?.identity?.primaryLinkedInMemberUrl),
        linkedInProfileAlias(incoming?.identity?.publicProfileUrl)
      ])
    });
    identity.fullName = normalizeWhitespace(identity.fullName);
    identity.firstName = normalizeWhitespace(identity.firstName) || firstNameFromFullName(identity.fullName);
    identity.normalizedName = normalizeWhitespace(identity.normalizedName || identity.fullName).toLowerCase();
    const primaryDerivedPersonId = personIdFromProfileUrl(identity.primaryLinkedInMemberUrl, identity.fullName);
    const publicDerivedPersonId = personIdFromProfileUrl(identity.publicProfileUrl, identity.fullName);
    const profileDerivedPersonId = primaryDerivedPersonId || publicDerivedPersonId || personIdFromProfileUrl(identity.profileUrl, identity.fullName);
    const existingIdentityPersonId = normalizeWhitespace(identity.personId);
    identity.personId = primaryDerivedPersonId || existingIdentityPersonId || publicDerivedPersonId || profileDerivedPersonId;
    if ((!identity.personId || identity.personId.startsWith("name:")) && publicDerivedPersonId && !publicDerivedPersonId.startsWith("name:")) {
      identity.personId = publicDerivedPersonId;
    }
    if ((!identity.personId || identity.personId.startsWith("name:")) && primaryDerivedPersonId && !primaryDerivedPersonId.startsWith("name:")) {
      identity.personId = primaryDerivedPersonId;
    }
    if (!identity.personId) {
      identity.personId = personIdFromProfileUrl(identity.profileUrl, identity.fullName);
    }
    const explicitIdentityStatus = normalizeWhitespace(identity.identityStatus);
    const explicitIdentityConfidence = normalizeWhitespace(identity.identityConfidence);
    const hasStableIdentityEvidence = Boolean(identity.primaryLinkedInMemberUrl || identity.publicProfileUrl);
    if (explicitIdentityStatus === "merged") {
      identity.identityStatus = "merged";
    } else if (explicitIdentityStatus === "needs_merge_confirmation" && !hasStableIdentityEvidence) {
      identity.identityStatus = "needs_merge_confirmation";
    } else if (explicitIdentityStatus === "provisional" && !hasStableIdentityEvidence) {
      identity.identityStatus = "provisional";
    } else if (hasStableIdentityEvidence) {
      identity.identityStatus = "resolved";
    } else {
      identity.identityStatus = explicitIdentityStatus || "provisional";
    }
    if (explicitIdentityConfidence) {
      identity.identityConfidence = explicitIdentityConfidence;
    } else if (identity.primaryLinkedInMemberUrl) {
      identity.identityConfidence = "high";
    } else if (identity.publicProfileUrl) {
      identity.identityConfidence = "medium";
    } else if (identity.identityStatus === "needs_merge_confirmation") {
      identity.identityConfidence = "medium";
    } else {
      identity.identityConfidence = "low";
    }

    const profileContext = defaultProfileContext({
      ...(existing?.profileContext || {}),
      ...(incoming?.profileContext || {}),
      headline: normalizeWhitespace(merged.profileContext?.headline || merged.headline),
      location: normalizeWhitespace(merged.profileContext?.location || merged.location),
      connectionStatus: normalizeConnectionStatus(merged.profileContext?.connectionStatus || merged.connectionStatus) || "unknown",
      recipientSummaryMemory: normalizeOutputText(
        merged.profileContext?.recipientSummaryMemory || merged.recipientSummaryMemory
      ),
      recipientProfileMemory: sanitizeRecipientProfileMemory(
        merged.profileContext?.recipientProfileMemory || merged.recipientProfileMemory
      ),
      profileSummary: normalizeOutputText(
        merged.profileContext?.profileSummary || merged.profileSummary
      ),
      rawSnapshot: normalizeWhitespace(
        merged.profileContext?.rawSnapshot || merged.rawSnapshot
      ),
      lastProfileSyncedAt: normalizeWhitespace(
        merged.profileContext?.lastProfileSyncedAt || merged.lastProfileSyncedAt
      ),
      recentProfileChanges: normalizeOutputText(
        merged.profileContext?.recentProfileChanges || merged.recentProfileChanges
      ),
      latestProfileData: normalizeProfileData(
        merged.profileContext?.latestProfileData || merged.latestProfileData
      )
    });

    const relationshipContext = defaultRelationshipContext({
      ...(existing?.relationshipContext || {}),
      ...(incoming?.relationshipContext || {}),
      userGoal: normalizeUserGoal(merged.relationshipContext?.userGoal || merged.userGoal),
      personNote: normalizeWhitespace(merged.relationshipContext?.personNote || merged.personNote),
      relationshipStage: normalizeRelationshipStage(
        merged.relationshipContext?.relationshipStage || merged.relationshipStage
      )
    });

    const observedConversation = normalizeObservedConversation(
      merged.observedConversation || merged.importedConversation
    );
    const observedMetrics = normalizeObservedMetrics(merged.observedMetrics || merged.lastLogicMetrics);
    const draftWorkspace = deriveDraftWorkspace(merged);
    const dashboardReview = deriveDashboardReview({
      ...merged,
      draftWorkspace,
      observedMetrics,
      relationshipContext
    });
    const system = defaultSystemRecord({
      ...(existing?.system || {}),
      ...(incoming?.system || {}),
      recordUuid,
      updatedAt: normalizeWhitespace(
        incoming?.system?.updatedAt
        || incoming?.updatedAt
        || merged.system?.updatedAt
        || merged.updatedAt
      ),
      lastPageType: normalizeWhitespace(
        incoming?.system?.lastPageType
        || incoming?.lastPageType
        || merged.system?.lastPageType
        || merged.lastPageType
      ),
      lastInteractionAt: normalizeWhitespace(
        incoming?.system?.lastInteractionAt
        || incoming?.lastInteractionAt
        || merged.system?.lastInteractionAt
        || merged.lastInteractionAt
      ),
      lastAiRecommendationAt: normalizeWhitespace(
        incoming?.system?.lastAiRecommendationAt
        || incoming?.lastAiRecommendationAt
        || merged.system?.lastAiRecommendationAt
        || merged.lastAiRecommendationAt
      ),
      lastAiRecommendationMessageSignature: normalizeWhitespace(
        incoming?.system?.lastAiRecommendationMessageSignature
        || incoming?.lastAiRecommendationMessageSignature
        || merged.system?.lastAiRecommendationMessageSignature
        || merged.lastAiRecommendationMessageSignature
      ),
      aiRecommendationStale: Boolean(
        incoming?.system?.aiRecommendationStale
        ?? incoming?.aiRecommendationStale
        ?? merged.system?.aiRecommendationStale
        ?? merged.aiRecommendationStale
        ?? draftWorkspace?.is_stale
      )
    });

    merged.personId = identity.personId;
    merged.uuid = recordUuid;
    merged.fullName = identity.fullName;
    merged.firstName = identity.firstName;
    merged.profileUrl = identity.profileUrl;
    merged.messagingThreadUrl = identity.messagingThreadUrl;
    merged.chatGptThreadUrl = normalizeUrl(merged.chatGptThreadUrl);
    merged.headline = profileContext.headline;
    merged.location = profileContext.location;
    merged.connectionStatus = profileContext.connectionStatus;
    merged.recipientSummaryMemory = profileContext.recipientSummaryMemory;
    merged.recipientProfileMemory = profileContext.recipientProfileMemory;
    merged.profileSummary = profileContext.profileSummary;
    merged.rawSnapshot = profileContext.rawSnapshot;
    merged.lastProfileSyncedAt = profileContext.lastProfileSyncedAt;
    merged.recentProfileChanges = profileContext.recentProfileChanges;
    merged.userGoal = relationshipContext.userGoal;
    merged.personNote = relationshipContext.personNote;
    merged.relationshipStage = relationshipContext.relationshipStage;
    merged.lastWorkspace = draftWorkspace ? { ...draftWorkspace } : null;
    merged.lastRecommendedAction = normalizeRecommendedAction(
      merged.lastRecommendedAction || draftWorkspace?.recommended_action
    );
    merged.lastReasonWhyNow = normalizeOutputText(merged.lastReasonWhyNow || draftWorkspace?.reason_why_now);
    merged.importedConversation = observedConversation ? { ...observedConversation } : null;
    merged.lastLogicMetrics = observedMetrics ? { ...observedMetrics } : null;
    merged.lastAiRecommendationAt = system.lastAiRecommendationAt;
    merged.lastAiRecommendationMessageSignature = system.lastAiRecommendationMessageSignature;
    merged.lastInteractionAt = system.lastInteractionAt;
    merged.lastPageType = system.lastPageType;
    merged.aiRecommendationStale = Boolean(system.aiRecommendationStale);
    merged.updatedAt = system.updatedAt;
    merged.identity = identity;
    merged.profileContext = profileContext;
    merged.relationshipContext = relationshipContext;
    merged.observedConversation = observedConversation;
    merged.observedMetrics = observedMetrics;
    merged.observedRelationshipTriage = merged.observedRelationshipTriage || draftWorkspace?.relationship_triage || null;
    merged.draftWorkspace = draftWorkspace;
    merged.dashboardReview = dashboardReview;
    merged.system = system;
    return merged;
  }

  function dedupeConversationMessages(messages) {
    const seen = new Set();
    return (messages || []).filter((entry) => {
      const key = JSON.stringify({
        sender: normalizeWhitespace(entry?.sender).toLowerCase(),
        text: normalizeWhitespace(entry?.text).toLowerCase(),
        timestamp: normalizeWhitespace(entry?.timestamp).toLowerCase()
      });
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  function classifyConversationSender(sender, recipientFullName, ownFullName) {
    const normalizedSender = normalizeWhitespace(sender).toLowerCase();
    if (!normalizedSender) {
      return "unknown";
    }
    if (normalizedSender === "you" || normalizedSender.startsWith("you ")) {
      return "self";
    }

    if (sameNormalizedName(sender, ownFullName)) {
      return "self";
    }

    if (sameNormalizedName(sender, recipientFullName)) {
      return "recipient";
    }

    return "unknown";
  }

  function collectConversationMessages(workspaceContext, personRecord, myProfile) {
    const recipientFullName = personRecord?.fullName || workspaceContext?.person?.fullName || workspaceContext?.profile?.fullName || "";
    const ownFullName = extractOwnProfileName(myProfile?.rawSnapshot);
    const visibleConversation = workspaceContext?.conversation || {};
    const visibleMessages = Array.isArray(visibleConversation.allVisibleMessages) && visibleConversation.allVisibleMessages.length
      ? visibleConversation.allVisibleMessages
      : Array.isArray(visibleConversation.recentMessages)
        ? visibleConversation.recentMessages
        : [];
    const savedWorkspaceConversation = personRecord?.draftWorkspace?.conversation || null;
    const savedWorkspaceMessages = Array.isArray(savedWorkspaceConversation?.allVisibleMessages) && savedWorkspaceConversation.allVisibleMessages.length
      ? savedWorkspaceConversation.allVisibleMessages
      : Array.isArray(savedWorkspaceConversation?.recentMessages)
        ? savedWorkspaceConversation.recentMessages
        : [];
    const importedMessages = Array.isArray(personRecord?.observedConversation?.messages) && personRecord.observedConversation.messages.length
      ? personRecord.observedConversation.messages
      : savedWorkspaceMessages;

    return canonicalizeConversationEntries([...importedMessages, ...visibleMessages], recipientFullName, ownFullName);
  }

  function importedConversationForPrompt(personRecord) {
    if (personRecord?.observedConversation) {
      return personRecord.observedConversation;
    }

    const savedWorkspaceConversation = personRecord?.draftWorkspace?.conversation || null;
    if (!savedWorkspaceConversation) {
      return null;
    }

    const messages = Array.isArray(savedWorkspaceConversation?.allVisibleMessages) && savedWorkspaceConversation.allVisibleMessages.length
      ? savedWorkspaceConversation.allVisibleMessages
      : Array.isArray(savedWorkspaceConversation?.recentMessages) && savedWorkspaceConversation.recentMessages.length
        ? savedWorkspaceConversation.recentMessages
        : [];

    if (!messages.length && !normalizeWhitespace(savedWorkspaceConversation?.rawThreadText)) {
      return null;
    }

    return {
      importedAt: normalizeWhitespace(personRecord?.draftWorkspace?.generatedAt),
      sourcePageType: normalizeWhitespace(personRecord?.draftWorkspace?.pageType || "linkedin-messaging"),
      lastSpeaker: normalizeWhitespace(savedWorkspaceConversation?.lastSpeaker),
      lastMessageAt: normalizeWhitespace(savedWorkspaceConversation?.lastMessageAt),
      rawThreadText: normalizeWhitespace(savedWorkspaceConversation?.rawThreadText),
      messages
    };
  }

  function parseLooseLinkedInDate(rawValue, now) {
    const text = normalizeWhitespace(rawValue);
    if (!text) {
      return null;
    }

    const importedAtMatch = text.match(/^imported at\s+(.+)$/i);
    if (importedAtMatch) {
      const importedDate = new Date(importedAtMatch[1]);
      return Number.isNaN(importedDate.getTime()) ? null : importedDate;
    }

    if (/^\d{1,2}:\d{2}\s*(am|pm)$/i.test(text)) {
      return null;
    }

    const direct = new Date(text);
    if (!Number.isNaN(direct.getTime())) {
      return direct;
    }

    const lower = text.toLowerCase();
    if (lower === "today") {
      return new Date(now);
    }
    if (lower === "yesterday") {
      const value = new Date(now);
      value.setDate(value.getDate() - 1);
      return value;
    }

    const relativeMatch = lower.match(/^(\d+)\s*([dwmy])$/);
    if (relativeMatch) {
      const amount = Number(relativeMatch[1]) || 0;
      const unit = relativeMatch[2];
      const value = new Date(now);
      if (unit === "d") {
        value.setDate(value.getDate() - amount);
      } else if (unit === "w") {
        value.setDate(value.getDate() - amount * 7);
      } else if (unit === "m") {
        value.setMonth(value.getMonth() - amount);
      } else if (unit === "y") {
        value.setFullYear(value.getFullYear() - amount);
      }
      return value;
    }

    const monthDayYear = text.match(/^([A-Za-z]{3,9})\s+(\d{1,2})(?:,\s*(\d{4}))?$/);
    if (monthDayYear) {
      const parsed = new Date(`${monthDayYear[1]} ${monthDayYear[2]} ${monthDayYear[3] || now.getFullYear()}`);
      if (!Number.isNaN(parsed.getTime())) {
        if (!monthDayYear[3] && parsed.getTime() > now.getTime() + 86400000) {
          parsed.setFullYear(parsed.getFullYear() - 1);
        }
        return parsed;
      }
    }

    return null;
  }

  function normalizeConversationTimestamp(rawValue, now) {
    const text = normalizeWhitespace(rawValue);
    if (!text) {
      return "";
    }

    const parsed = parseLooseLinkedInDate(text, now || new Date());
    return parsed ? parsed.toISOString() : text;
  }

  function formatConversationTimestampForDisplay(rawValue) {
    const text = normalizeWhitespace(rawValue);
    if (!text) {
      return "";
    }

    const parsed = parseLooseLinkedInDate(text, new Date());
    if (!parsed) {
      return text;
    }

    const month = parsed.toLocaleString("en-US", { month: "short" });
    const day = parsed.getDate();
    const year = parsed.getFullYear();
    const time = parsed.toLocaleString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    return `${month} ${day}, ${year} ${time}`;
  }

  function isoFromDate(value) {
    return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : "";
  }

  function daysSince(date, now) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return null;
    }
    return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86400000));
  }

  function goalLabel(value) {
    switch (normalizeUserGoal(value)) {
      case "build_relationship":
        return "Build relationship";
      case "get_advice":
        return "Get advice";
      case "ask_intro":
        return "Ask for intro";
      case "ask_referral":
        return "Ask for referral";
      case "job_insight":
        return "Get job insight";
      default:
        return "";
    }
  }

  function inferThreadTone(classifiedMessages) {
    const recentTexts = (classifiedMessages || [])
      .slice(-6)
      .map((entry) => normalizeWhitespace(entry?.text))
      .filter(Boolean);

    if (!recentTexts.length) {
      return {
        thread_tone: "neutral",
        thread_pace: "medium",
        thread_warmth_signal: "medium",
        thread_tone_guidance: "Use a natural professional LinkedIn tone. Keep it conversational, concise, and specific."
      };
    }

    const joined = recentTexts.join(" ");
    const wordsPerMessage = recentTexts.map((text) => normalizeWhitespace(text).split(/\s+/).filter(Boolean).length);
    const avgWords = wordsPerMessage.reduce((sum, count) => sum + count, 0) / Math.max(1, wordsPerMessage.length);
    const emojiCount = (joined.match(/[\u{1F300}-\u{1FAFF}]/gu) || []).length;
    const exclamationCount = (joined.match(/!/g) || []).length;
    const casualPhraseCount = (joined.match(/\b(thx|thanks|yeah|yep|sure|sounds good|quick|happy to|got it|no worries)\b/gi) || []).length;
    const formalPhraseCount = (joined.match(/\b(appreciate|thank you|would you|could you|pleased|glad to|best regards|sincerely)\b/gi) || []).length;
    const warmthPhraseCount = (joined.match(/\b(thanks|thank you|appreciate|glad|happy|great|nice|pleased)\b/gi) || []).length;

    let threadTone = "neutral";
    if (emojiCount > 0 || exclamationCount >= 2 || casualPhraseCount >= 2 || avgWords <= 10) {
      threadTone = "casual";
    } else if (formalPhraseCount >= 2 || avgWords >= 24) {
      threadTone = "formal";
    }

    let threadPace = "medium";
    if (avgWords <= 10) {
      threadPace = "short";
    } else if (avgWords >= 24) {
      threadPace = "long";
    }

    let threadWarmthSignal = "medium";
    if (warmthPhraseCount >= 3 || exclamationCount >= 2) {
      threadWarmthSignal = "high";
    } else if (warmthPhraseCount === 0 && formalPhraseCount === 0) {
      threadWarmthSignal = "low";
    }

    let threadToneGuidance = "Use a natural professional LinkedIn tone. Keep it conversational, concise, and specific.";
    if (threadTone === "casual") {
      threadToneGuidance = "The thread reads casual and direct. Match that lightly with natural spoken phrasing, but stay professional and avoid sounding sloppy.";
    } else if (threadTone === "formal") {
      threadToneGuidance = "The thread reads more formal. Use clean, complete sentences and a professional tone, but do not become stiff or overly polished.";
    }

    if (threadPace === "short") {
      threadToneGuidance += " Keep the reply fairly short and easy to scan.";
    } else if (threadPace === "long") {
      threadToneGuidance += " A somewhat fuller reply is acceptable if it adds real substance.";
    }

    if (threadWarmthSignal === "high") {
      threadToneGuidance += " The conversation already shows warmth, so a slightly warmer reply is fine.";
    } else if (threadWarmthSignal === "low") {
      threadToneGuidance += " Keep the tone respectful and measured rather than overly familiar.";
    }

    return {
      thread_tone: threadTone,
      thread_pace: threadPace,
      thread_warmth_signal: threadWarmthSignal,
      thread_tone_guidance: threadToneGuidance
    };
  }

  function buildLogicMetrics(workspaceContext, personRecord, myProfile) {
    const now = new Date();
    const recipientFullName = personRecord?.fullName || workspaceContext?.person?.fullName || workspaceContext?.profile?.fullName || "";
    const ownFullName = extractOwnProfileName(myProfile?.rawSnapshot);
    const messages = collectConversationMessages(workspaceContext, personRecord, myProfile);
    const visibleMessages = Array.isArray(workspaceContext?.conversation?.allVisibleMessages) && workspaceContext.conversation.allVisibleMessages.length
      ? workspaceContext.conversation.allVisibleMessages
      : Array.isArray(workspaceContext?.conversation?.recentMessages)
        ? workspaceContext.conversation.recentMessages
        : [];
    const importedMessages = Array.isArray(getObservedConversation(personRecord)?.messages)
      ? getObservedConversation(personRecord).messages
      : [];

    const classified = messages.map((entry) => {
      const senderRole = classifyConversationSender(entry?.sender, recipientFullName, ownFullName);
      const rawTimestamp = normalizeWhitespace(entry?.timestamp);
      const parsedTimestamp = parseLooseLinkedInDate(rawTimestamp, now);
      return {
        sender: normalizeWhitespace(entry?.sender),
        text: normalizeWhitespace(entry?.text),
        timestamp_raw: rawTimestamp,
        timestamp_iso: isoFromDate(parsedTimestamp),
        parsedTimestamp,
        role: senderRole
      };
    });
    const chronological = classified
      .slice()
      .sort((left, right) => {
        if (left.parsedTimestamp && right.parsedTimestamp) {
          return left.parsedTimestamp - right.parsedTimestamp;
        }
        if (left.parsedTimestamp) {
          return -1;
        }
        if (right.parsedTimestamp) {
          return 1;
        }
        return 0;
      });

    const parsedEntries = classified.filter((entry) => entry.parsedTimestamp);
    const inboundEntries = classified.filter((entry) => entry.role === "recipient");
    const outboundEntries = classified.filter((entry) => entry.role === "self");

    let unansweredOutboundStreak = 0;
    let lastSpeakerRole = "unknown";
    chronological.forEach((entry) => {
      if (entry.role === "recipient") {
        unansweredOutboundStreak = 0;
        lastSpeakerRole = "recipient";
        return;
      }
      if (entry.role === "self") {
        unansweredOutboundStreak += 1;
        lastSpeakerRole = "self";
      }
    });

    let conversationState = "no_history";
    if (classified.length) {
      if (lastSpeakerRole === "self" && unansweredOutboundStreak > 0) {
        conversationState = inboundEntries.length
          ? "waiting_on_recipient_after_prior_engagement"
          : "waiting_on_recipient_no_reply_history";
      } else if (lastSpeakerRole === "recipient") {
        conversationState = "waiting_on_user";
      } else if (inboundEntries.length) {
        conversationState = "no_open_loop_with_prior_engagement";
      } else {
        conversationState = "no_reply_history";
      }
    }

    const sortedParsed = parsedEntries.slice().sort((left, right) => left.parsedTimestamp - right.parsedTimestamp);
    const firstParsed = sortedParsed[0] || null;
    const lastParsed = sortedParsed[sortedParsed.length - 1] || null;
    const lastInboundParsed = inboundEntries
      .filter((entry) => entry.parsedTimestamp)
      .sort((left, right) => right.parsedTimestamp - left.parsedTimestamp)[0] || null;
    const lastOutboundParsed = outboundEntries
      .filter((entry) => entry.parsedTimestamp)
      .sort((left, right) => right.parsedTimestamp - left.parsedTimestamp)[0] || null;
    const timestampCoverage = classified.length ? parsedEntries.length / classified.length : 0;
    const inferredImportTimestampCount = classified.filter((entry) => /^imported at\s+/i.test(entry.timestamp_raw)).length;

    let timestampConfidence = "none";
    if (timestampCoverage >= 0.75 && inferredImportTimestampCount === 0) {
      timestampConfidence = "high";
    } else if (timestampCoverage >= 0.75) {
      timestampConfidence = "medium";
    } else if (timestampCoverage >= 0.3) {
      timestampConfidence = "medium";
    } else if (timestampCoverage > 0) {
      timestampConfidence = "low";
    }

    let contextConfidence = "low";
    if (classified.length >= 4 && (visibleMessages.length || importedMessages.length)) {
      contextConfidence = timestampCoverage >= 0.3 ? "high" : "medium";
    } else if (classified.length >= 1 || workspaceContext?.profile?.fullName || workspaceContext?.person?.fullName) {
      contextConfidence = "medium";
    }
    const threadTone = inferThreadTone(classified);

    return {
      computed_at: now.toISOString(),
      page_type: normalizeWhitespace(workspaceContext?.pageType),
      is_connection: normalizeConnectionStatus(personRecord?.connectionStatus || workspaceContext?.person?.connectionStatus) === "connected",
      user_goal: normalizeUserGoal(personRecord?.userGoal),
      user_goal_label: goalLabel(personRecord?.userGoal),
      has_visible_thread: Boolean(visibleMessages.length),
      has_imported_history: Boolean(importedMessages.length),
      known_message_count: classified.length,
      known_inbound_count: inboundEntries.length,
      known_outbound_count: outboundEntries.length,
      has_ever_replied: inboundEntries.length > 0,
      conversation_state: conversationState,
      unanswered_outbound_streak: unansweredOutboundStreak,
      who_spoke_last: lastSpeakerRole,
      first_known_message_at_raw: firstParsed?.timestamp_raw || "",
      first_known_message_at: firstParsed?.timestamp_iso || "",
      last_known_message_at_raw: lastParsed?.timestamp_raw || normalizeWhitespace(workspaceContext?.conversation?.lastMessageAt),
      last_known_message_at: lastParsed?.timestamp_iso || "",
      last_known_inbound_at_raw: lastInboundParsed?.timestamp_raw || "",
      last_known_inbound_at: lastInboundParsed?.timestamp_iso || "",
      last_known_outbound_at_raw: lastOutboundParsed?.timestamp_raw || "",
      last_known_outbound_at: lastOutboundParsed?.timestamp_iso || "",
      days_since_first_known_contact: daysSince(firstParsed?.parsedTimestamp, now),
      days_since_last_known_message: daysSince(lastParsed?.parsedTimestamp, now),
      days_since_last_known_inbound: daysSince(lastInboundParsed?.parsedTimestamp, now),
      days_since_last_known_outbound: daysSince(lastOutboundParsed?.parsedTimestamp, now),
      known_conversation_span_days: firstParsed && lastParsed ? Math.max(0, Math.floor((lastParsed.parsedTimestamp - firstParsed.parsedTimestamp) / 86400000)) : null,
      timestamp_confidence: timestampConfidence,
      context_confidence: contextConfidence,
      thread_tone: threadTone.thread_tone,
      thread_pace: threadTone.thread_pace,
      thread_warmth_signal: threadTone.thread_warmth_signal,
      thread_tone_guidance: threadTone.thread_tone_guidance,
      current_context_source: visibleMessages.length && importedMessages.length
        ? "visible_and_imported"
        : visibleMessages.length
          ? "visible_only"
          : importedMessages.length
            ? "imported_only"
            : "profile_only"
    };
  }

  function formatLogicMetrics(metrics) {
    if (!metrics) {
      return "No logic metrics available.";
    }

    return [
      `Context source: ${metrics.current_context_source || "unknown"} (visible thread, imported history, or both)`,
      `Conversation state: ${metrics.conversation_state || "unknown"}`,
      `Connection status in current context: ${metrics.is_connection ? "connected" : "not clearly connected"}`,
      `User goal: ${metrics.user_goal_label || metrics.user_goal || "unknown"}`,
      `Known message count: ${metrics.known_message_count ?? 0}`,
      `Known inbound count: ${metrics.known_inbound_count ?? 0}`,
      `Known outbound count: ${metrics.known_outbound_count ?? 0}`,
      `Has ever replied: ${metrics.has_ever_replied ? "true" : "false"}`,
      `Who spoke last: ${metrics.who_spoke_last || "unknown"}`,
      `Unanswered outbound streak: ${metrics.unanswered_outbound_streak ?? 0} (consecutive user-sent messages since the last recipient reply)`,
      `First known contact time: ${formatConversationTimestampForDisplay(metrics.first_known_message_at) || "unknown"}`,
      `Last known message time: ${formatConversationTimestampForDisplay(metrics.last_known_message_at) || "unknown"}`,
      `Last known recipient message time: ${formatConversationTimestampForDisplay(metrics.last_known_inbound_at) || "unknown"}`,
      `Last known user message time: ${formatConversationTimestampForDisplay(metrics.last_known_outbound_at) || "unknown"}`,
      `Days since first known contact: ${metrics.days_since_first_known_contact ?? "unknown"}`,
      `Days since last known message: ${metrics.days_since_last_known_message ?? "unknown"}`,
      `Days since last known recipient message: ${metrics.days_since_last_known_inbound ?? "unknown"}`,
      `Days since last known user message: ${metrics.days_since_last_known_outbound ?? "unknown"}`,
      `Known conversation span days: ${metrics.known_conversation_span_days ?? "unknown"}`,
      `Timestamp confidence: ${metrics.timestamp_confidence || "unknown"}`,
      `Context confidence: ${metrics.context_confidence || "unknown"}`,
      `Thread tone: ${metrics.thread_tone || "unknown"}`,
      `Thread pace: ${metrics.thread_pace || "unknown"}`,
      `Thread warmth signal: ${metrics.thread_warmth_signal || "unknown"} (heuristic, not proof of closeness)`,
      `Thread tone guidance: ${metrics.thread_tone_guidance || "unknown"}`
    ].join("\n");
  }

  function normalizeAssessmentLevel(value, allowed) {
    const normalized = normalizeWhitespace(value).toLowerCase();
    return allowed.includes(normalized) ? normalized : "";
  }

  function defaultAiAssessment() {
    return {
      recipient_relevance: "medium",
      relevance_reason: "",
      relationship_warmth: "cool",
      warmth_reason: "",
      referral_path_strength: "moderate",
      referral_path_reason: "",
      last_ask_type: "unknown",
      last_ask_burden: "unknown",
      repeat_ask_risk: "low",
      fresh_trigger_present: false,
      fresh_trigger_reason: ""
    };
  }

  function normalizeAiAssessment(assessment) {
    const source = assessment && typeof assessment === "object" ? assessment : {};
    const fallback = defaultAiAssessment();

    return {
      recipient_relevance: normalizeAssessmentLevel(source.recipient_relevance, ["low", "medium", "high"]) || fallback.recipient_relevance,
      relevance_reason: normalizeWhitespace(source.relevance_reason),
      relationship_warmth: normalizeAssessmentLevel(source.relationship_warmth, ["cold", "cool", "warm"]) || fallback.relationship_warmth,
      warmth_reason: normalizeWhitespace(source.warmth_reason),
      referral_path_strength: normalizeAssessmentLevel(source.referral_path_strength, ["weak", "moderate", "strong"]) || fallback.referral_path_strength,
      referral_path_reason: normalizeWhitespace(source.referral_path_reason),
      last_ask_type: normalizeAssessmentLevel(source.last_ask_type, ["none", "question", "advice", "meeting", "intro", "referral", "unknown"]) || fallback.last_ask_type,
      last_ask_burden: normalizeAssessmentLevel(source.last_ask_burden, ["low", "medium", "high", "unknown"]) || fallback.last_ask_burden,
      repeat_ask_risk: normalizeAssessmentLevel(source.repeat_ask_risk, ["low", "medium", "high"]) || fallback.repeat_ask_risk,
      fresh_trigger_present: typeof source.fresh_trigger_present === "boolean" ? source.fresh_trigger_present : fallback.fresh_trigger_present,
      fresh_trigger_reason: normalizeWhitespace(source.fresh_trigger_reason)
    };
  }

  function clampInteger(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  function defaultReferralReadiness() {
    return {
      score_100: 0,
      relationship_trust_25: 0,
      response_history_25: 0,
      role_fit_25: 0,
      ask_specificity_25: 0,
      summary: ""
    };
  }

  function normalizeReferralReadiness(readiness) {
    const source = readiness && typeof readiness === "object" ? readiness : {};
    const fallback = defaultReferralReadiness();
    const relationshipTrust = clampInteger(source.relationship_trust_25, 0, 25, fallback.relationship_trust_25);
    const responseHistory = clampInteger(source.response_history_25, 0, 25, fallback.response_history_25);
    const roleFit = clampInteger(source.role_fit_25, 0, 25, fallback.role_fit_25);
    const askSpecificity = clampInteger(source.ask_specificity_25, 0, 25, fallback.ask_specificity_25);
    const computedScore = relationshipTrust + responseHistory + roleFit + askSpecificity;

    return {
      score_100: clampInteger(source.score_100, 0, 100, computedScore),
      relationship_trust_25: relationshipTrust,
      response_history_25: responseHistory,
      role_fit_25: roleFit,
      ask_specificity_25: askSpecificity,
      summary: normalizeOutputText(source.summary)
    };
  }

  function spreadReferralSubscore(value) {
    const numeric = clampInteger(value, 0, 25, 0);
    const centered = (numeric - 12.5) / 12.5;
    const amplified = Math.sign(centered) * Math.pow(Math.abs(centered), 0.55);
    return clampInteger((amplified * 12.5) + 12.5, 0, 25, numeric);
  }

  function scaleReferralReadinessToTotal(readiness, targetScore) {
    const current = normalizeReferralReadiness(readiness);
    const target = clampInteger(targetScore, 0, 100, current.score_100);
    const currentScore = Math.max(
      1,
      Number(current.relationship_trust_25 || 0)
      + Number(current.response_history_25 || 0)
      + Number(current.role_fit_25 || 0)
      + Number(current.ask_specificity_25 || 0)
    );
    const ratio = target / currentScore;
    let trust = clampInteger(current.relationship_trust_25 * ratio, 0, 25, current.relationship_trust_25);
    let history = clampInteger(current.response_history_25 * ratio, 0, 25, current.response_history_25);
    let fit = clampInteger(current.role_fit_25 * ratio, 0, 25, current.role_fit_25);
    let specificity = clampInteger(current.ask_specificity_25 * ratio, 0, 25, current.ask_specificity_25);
    let adjustedTotal = trust + history + fit + specificity;
    const fields = [
      [() => trust, (value) => { trust = value; }],
      [() => history, (value) => { history = value; }],
      [() => fit, (value) => { fit = value; }],
      [() => specificity, (value) => { specificity = value; }]
    ];

    while (adjustedTotal !== target) {
      const descending = target > adjustedTotal;
      let changed = false;
      for (const [getter, setter] of fields) {
        const currentValue = getter();
        if (descending && currentValue < 25) {
          setter(currentValue + 1);
          adjustedTotal += 1;
          changed = true;
        } else if (!descending && currentValue > 0) {
          setter(currentValue - 1);
          adjustedTotal -= 1;
          changed = true;
        }
        if (adjustedTotal === target) {
          break;
        }
      }
      if (!changed) {
        break;
      }
    }

    return {
      ...current,
      score_100: trust + history + fit + specificity,
      relationship_trust_25: trust,
      response_history_25: history,
      role_fit_25: fit,
      ask_specificity_25: specificity
    };
  }

  function calibrateReferralReadiness(readiness, recommendedAction, aiAssessment) {
    const current = normalizeReferralReadiness(readiness);
    const assessment = normalizeAiAssessment(aiAssessment);
    let adjusted = {
      ...current,
      relationship_trust_25: spreadReferralSubscore(current.relationship_trust_25),
      response_history_25: spreadReferralSubscore(current.response_history_25),
      role_fit_25: spreadReferralSubscore(current.role_fit_25),
      ask_specificity_25: spreadReferralSubscore(current.ask_specificity_25)
    };
    adjusted.score_100 =
      adjusted.relationship_trust_25
      + adjusted.response_history_25
      + adjusted.role_fit_25
      + adjusted.ask_specificity_25;

    let minScore = 0;
    let maxScore = 100;
    const action = normalizeRecommendedAction(recommendedAction);

    if (action === "wait") {
      maxScore = Math.min(maxScore, 35);
    } else if (action === "draft_reply" || action === "draft_follow_up") {
      maxScore = Math.min(maxScore, 55);
    } else if (action === "draft_advice_ask") {
      maxScore = Math.min(maxScore, 72);
    } else if (action === "draft_referral_ask") {
      minScore = Math.max(minScore, 70);
    }

    if (assessment.repeat_ask_risk === "high") {
      maxScore = Math.min(maxScore, 40);
    } else if (assessment.repeat_ask_risk === "medium") {
      maxScore = Math.min(maxScore, 60);
    }

    if (assessment.referral_path_strength === "weak") {
      maxScore = Math.min(maxScore, 45);
    } else if (assessment.referral_path_strength === "strong" && action === "draft_referral_ask") {
      minScore = Math.max(minScore, 75);
    }

    if (assessment.relationship_warmth === "cold") {
      maxScore = Math.min(maxScore, 35);
    } else if (assessment.relationship_warmth === "cool") {
      maxScore = Math.min(maxScore, 60);
    } else if (assessment.relationship_warmth === "warm" && action === "draft_referral_ask") {
      minScore = Math.max(minScore, 70);
    }

    if (adjusted.score_100 < minScore) {
      adjusted = scaleReferralReadinessToTotal(adjusted, minScore);
    } else if (adjusted.score_100 > maxScore) {
      adjusted = scaleReferralReadinessToTotal(adjusted, maxScore);
    }

    return normalizeReferralReadiness(adjusted);
  }

  function formatAiAssessmentMemory(personRecord) {
    const assessments = [
      personRecord?.aiProfileAssessment ? `Saved profile AI assessment: ${JSON.stringify(personRecord.aiProfileAssessment)}` : "",
      personRecord?.aiConversationAssessment ? `Saved conversation AI assessment: ${JSON.stringify(personRecord.aiConversationAssessment)}` : ""
    ].filter(Boolean);
    return assessments.join("\n") || "No saved AI assessment.";
  }

  function normalizeInvestmentDecision(value) {
    const normalized = normalizeWhitespace(value).toLowerCase();
    return INVESTMENT_DECISIONS.includes(normalized) ? normalized : "";
  }

  function normalizeResearchRecommendation(value) {
    const normalized = normalizeWhitespace(value).toLowerCase();
    return RESEARCH_RECOMMENDATIONS.includes(normalized) ? normalized : "";
  }

  function buildRelationshipTriage(workspaceContext, personRecord, myProfile) {
    const recipientFullName = personRecord?.fullName || workspaceContext?.person?.fullName || workspaceContext?.profile?.fullName || "";
    const ownFullName = extractOwnProfileName(myProfile?.rawSnapshot);
    const messages = collectConversationMessages(workspaceContext, personRecord, myProfile);
    const classifiedMessages = messages.map((entry) => ({
      sender: normalizeWhitespace(entry?.sender),
      text: normalizeWhitespace(entry?.text),
      timestamp: normalizeWhitespace(entry?.timestamp),
      role: classifyConversationSender(entry?.sender, recipientFullName, ownFullName)
    }));
    const chronologicalMessages = classifiedMessages
      .slice()
      .sort((left, right) => {
        const leftDate = parseLooseLinkedInDate(left.timestamp, new Date());
        const rightDate = parseLooseLinkedInDate(right.timestamp, new Date());
        if (leftDate && rightDate) {
          return leftDate - rightDate;
        }
        if (leftDate) {
          return -1;
        }
        if (rightDate) {
          return 1;
        }
        return 0;
      });

    let inboundCount = 0;
    let outboundCount = 0;
    let unansweredOutboundStreak = 0;
    let lastSpeakerRole = "unknown";

    chronologicalMessages.forEach((entry) => {
      if (entry.role === "recipient") {
        inboundCount += 1;
        unansweredOutboundStreak = 0;
        lastSpeakerRole = "recipient";
        return;
      }
      if (entry.role === "self") {
        outboundCount += 1;
        unansweredOutboundStreak += 1;
        lastSpeakerRole = "self";
      }
    });

    const hasInboundReply = inboundCount > 0;
    let investmentDecision = "continue_investing";
    let researchRecommendation = "no_new_research_needed";
    let referralGate = "blocked_no_reply_history";
    let summary = "No prior conversation history is saved yet. Start with a light, relevant message.";

    if (!classifiedMessages.length) {
      summary = normalizeConnectionStatus(personRecord?.connectionStatus) === "connected"
        ? "You are already connected, but there is no saved conversation history yet. Re-engage only with a specific, low-pressure reason."
        : "No prior conversation history is saved yet. Start with a light, relevant message.";
      return {
        message_count: 0,
        inbound_message_count: 0,
        outbound_message_count: 0,
        unanswered_outbound_streak: 0,
        has_inbound_reply: false,
        last_speaker_role: "unknown",
        investment_decision: investmentDecision,
        research_recommendation: researchRecommendation,
        referral_gate: referralGate,
        summary,
        prompt_guidance: "There is no saved reply history yet. Do not suggest a referral ask."
      };
    }

    if (!hasInboundReply) {
      referralGate = "blocked_no_reply_history";
      if (unansweredOutboundStreak >= 3) {
        investmentDecision = "move_on";
        researchRecommendation = "find_new_context_before_follow_up";
        summary = "They have never replied and you already have 3 or more unanswered outbound messages. Stop investing unless you have a genuinely new reason to reopen the conversation.";
      } else if (unansweredOutboundStreak >= 2) {
        investmentDecision = "pause_until_new_trigger";
        researchRecommendation = "find_new_context_before_follow_up";
        summary = "They have not replied and you already sent multiple messages. Only follow up again if you can bring a clearly new, lower-pressure angle.";
      } else {
        investmentDecision = "low_pressure_follow_up";
        summary = "They have not replied yet. One light follow-up can still be reasonable, but keep the ask easy and specific.";
      }
    } else {
      if (inboundCount >= 2) {
        referralGate = "allowed";
      } else {
        referralGate = "not_warm_enough";
      }

      if (unansweredOutboundStreak >= 2) {
        investmentDecision = "pause_until_new_trigger";
        researchRecommendation = "find_new_context_before_follow_up";
        summary = "They replied before, but your last messages have gone unanswered. Pause unless you can re-enter with a fresh, relevant trigger.";
      } else if (unansweredOutboundStreak === 1) {
        investmentDecision = "low_pressure_follow_up";
        summary = "They have engaged before. One low-pressure follow-up is still reasonable, but avoid escalating the ask.";
      } else if (referralGate === "allowed") {
        summary = "They have engaged more than once. An advice ask or specific referral ask can be appropriate if it stays low-pressure and well-targeted.";
      } else {
        summary = "They have replied before. Keep investing, but build a little more warmth before asking for a referral.";
      }
    }

    const promptGuidance = [
      `Investment decision: ${investmentDecision}.`,
      `Research recommendation: ${researchRecommendation}.`,
      `Referral gate: ${referralGate}.`,
      !hasInboundReply
        ? "Do not recommend a referral ask because there is no reply history yet."
        : "",
      investmentDecision === "move_on"
        ? "Default to wait unless the supplied note or conversation contains a genuinely new trigger."
        : "",
      investmentDecision === "pause_until_new_trigger"
        ? "Prefer wait. Only recommend a follow-up if the context clearly provides a new, lower-pressure reason to re-engage."
        : "",
      investmentDecision === "low_pressure_follow_up"
        ? "If you draft a follow-up, make it shorter, easier to answer, and less demanding than the prior ask."
        : "",
      referralGate === "not_warm_enough"
        ? "Prefer a light advice ask before any referral ask."
        : ""
    ].filter(Boolean).join(" ");

    return {
      message_count: classifiedMessages.length,
      inbound_message_count: inboundCount,
      outbound_message_count: outboundCount,
      unanswered_outbound_streak: unansweredOutboundStreak,
      has_inbound_reply: hasInboundReply,
      last_speaker_role: lastSpeakerRole,
      investment_decision: investmentDecision,
      research_recommendation: researchRecommendation,
      referral_gate: referralGate,
      summary,
      prompt_guidance: promptGuidance
    };
  }

  function formatRelationshipTriage(triage) {
    if (!triage) {
      return "No local relationship triage available.";
    }

    return [
      `Local investment decision: ${triage.investment_decision}`,
      `Local research recommendation: ${triage.research_recommendation}`,
      `Local referral gate: ${triage.referral_gate}`,
      `Inbound replies seen: ${triage.has_inbound_reply ? "yes" : "no"}`,
      `Outbound messages: ${triage.outbound_message_count || 0}`,
      `Inbound messages: ${triage.inbound_message_count || 0}`,
      `Unanswered outbound streak: ${triage.unanswered_outbound_streak || 0}`,
      triage.summary ? `Summary: ${triage.summary}` : "",
      triage.prompt_guidance ? `Prompt guidance: ${triage.prompt_guidance}` : ""
    ].filter(Boolean).join("\n");
  }

  function formatPromptConversationMessages(messages, recipientFullName, ownFullName, label) {
    const normalizedMessages = canonicalizeConversationEntries(messages, recipientFullName, ownFullName);
    if (!normalizedMessages.length) {
      return "";
    }

    return [
      `${label} (latest first):`,
      ...normalizedMessages.map((entry) => {
        const timestamp = formatConversationTimestampForDisplay(entry?.timestamp);
        const prefix = timestamp ? `[${timestamp}] ` : "";
        return `- ${prefix}${normalizeWhitespace(entry?.sender) || "Unknown"}: ${normalizeWhitespace(entry?.text)}`;
      })
    ].join("\n");
  }

  function formatConversationContext(conversation, ownFullName) {
    if (!conversation) {
      return "";
    }
    const recipientName = normalizeWhitespace(conversation.recipientName);

    const parts = [
      recipientName ? `Conversation with: ${recipientName}` : "",
      conversation.lastSpeaker ? `Last speaker: ${canonicalConversationSender(conversation.lastSpeaker, recipientName, ownFullName)}` : "",
      conversation.lastMessageAt ? `Last visible message time: ${formatConversationTimestampForDisplay(conversation.lastMessageAt)}` : "",
      formatPromptConversationMessages(conversation.recentMessages, recipientName, ownFullName, "Visible messages")
    ].filter(Boolean);

    return parts.join("\n");
  }

  function formatImportedConversation(importedConversation, recipientFullName, ownFullName) {
    if (!importedConversation) {
      return "";
    }
    const canonicalMessages = canonicalizeConversationEntries(importedConversation.messages, recipientFullName, ownFullName);

    return [
      importedConversation.importedAt ? `Imported at: ${importedConversation.importedAt}` : "",
      importedConversation.sourcePageType ? `Imported from: ${importedConversation.sourcePageType}` : "",
      importedConversation.lastMessageAt
        ? `Last imported message time: ${formatConversationTimestampForDisplay(importedConversation.lastMessageAt)}`
        : "",
      formatPromptConversationMessages(canonicalMessages, recipientFullName, ownFullName, "Imported messages")
    ].filter(Boolean).join("\n");
  }

  function defaultPromptSettings() {
    return {
      strategyGuidance: "",
      llmProvider: DEFAULT_LLM_PROVIDER,
      llmEntryUrl: defaultLlmEntryUrl(DEFAULT_LLM_PROVIDER)
    };
  }

  function relationshipStrategyPlaybook() {
    return [
      "Primary objective:",
      "- Help the user manage this relationship well over time and increase the chance of a credible referral or useful introduction later.",
      "- Do not optimize for sending a message at all costs. Optimize for relationship quality, timing, and expected return.",
      "",
      "Case handling guidance:",
      "- First outreach to a non-connection: keep it light, relevant, and easy to answer. Focus on starting a real exchange, not extracting help immediately.",
      "- Connected but little or no conversation history: do not treat connection status alone as warmth. Re-engage with a specific reason or relevant trigger.",
      "- No reply after prior outreach: do not assume rejection with certainty, but raise the bar for another follow-up. A repeated follow-up should usually become lighter, narrower, and more contextual, not more demanding.",
      "- If there is no fresh angle, recent trigger, or clearer reason to reach out, it is valid to recommend wait.",
      "- If the person has replied before: build momentum with one small next step at a time. Prefer a quick question or advice ask before a heavier ask.",
      "- Warm relationship: if the context supports it, move from curiosity to a more specific ask, but still keep it easy for them to help.",
      "- Referral path: a referral ask should usually come only after there is evidence of engagement, trust, or clear fit. The ask should be targeted to a role, team, or person, not vague.",
      "- Dormant relationship after a long gap: acknowledge the gap lightly only if useful. Re-enter with a relevant reason, not a guilt-inducing reminder.",
      "- Partial or noisy context: LinkedIn thread extraction may be incomplete or messy. Reason from the strongest consistent signals and be explicit when uncertainty is high.",
      "- If the visible current thread conflicts with older imported history, prefer the most recent visible thread for what is happening now.",
      "- Treat saved person note and extra user context as high-signal about the user's goals and hidden context, but do not convert them into invented recipient facts.",
      "",
      "Message strategy rules:",
      "- Make only one primary ask per message.",
      "- Keep the ask easy to answer.",
      "- Avoid guilt, pressure, manufactured intimacy, or manipulative urgency.",
      "- Avoid generic praise and avoid repeating the same ask in slightly different words.",
      "- Do not fabricate shared context, familiarity, or enthusiasm.",
      "- If additional context would materially change the recommendation, say so in reason_why_now."
    ].join("\n");
  }

  function legacyDefaultPromptTemplate() {
    return [
      "You are an expert LinkedIn outreach copywriter. Write concise personalized LinkedIn openers optimized for reply rate.",
      "",
      "Use only the information below.",
      "",
      "Recipient profile:",
      "<<<RECIPIENT_PROFILE",
      "{{recipient_profile}}",
      "RECIPIENT_PROFILE>>>",
      "",
      "Sender profile:",
      "<<<SENDER_PROFILE",
      "{{sender_profile}}",
      "SENDER_PROFILE>>>",
      "",
      "The extension will append this fixed tail later. Do not include it in any opener:",
      "\"{{fixed_tail}}\"",
      "",
      "Task:",
      "- Write a 400-600 character summary of who the recipient is, what stands out in their background, and why the sender should contact them.",
      "- Generate 5 ranked opener variants.",
      "- Each opener must contain only the opening sentence.",
      "- Use a greeting only when it fits the context. For first outreach or a long-gap re-entry, a simple \"Hi {recipient first name},\" can be fine. Do not force a greeting in every opener.",
      "- Use only facts visible in the recipient profile and sender profile.",
      "- Do not invent shared experiences or facts.",
      "- Use only one hook per opener.",
      "- Prefer hooks in this order: direct domain overlap; similar career path; school or alumni overlap; recent activity; geography or community overlap.",
      "- Use nationality, language, or ethnicity only when natural and genuinely relevant.",
      "- Avoid generic flattery, creepy details, oversharing, and scraped-sounding wording.",
      "- Tone must be polite, concise, natural, low-pressure, and optimized for reply.",
      `- Each final combined message after the extension appends the fixed tail must be <= {{max_message_length}} characters.`,
      "",
      "Return JSON only. Do not wrap the response in markdown fences.",
      "",
      "Use this exact schema:",
      "{",
      "  \"first_name\": \"\",",
      "  \"recipient_summary\": \"\",",
      "  \"messages\": [",
      "    {",
      "      \"rank\": 1,",
      "      \"hook_type\": \"\",",
      "      \"opener\": \"\",",
      "      \"estimated_reply_probability\": 0,",
      "      \"reason\": \"\"",
      "    }",
      "  ]",
      "}"
    ].join("\n");
  }

  function previousCurrentPromptTemplate() {
    return [
      "{{recipient_full_name}}",
      "",
      "You are helping write LinkedIn outreach openers.",
      "",
      "Read the recipient profile and the sender profile below.",
      "Use only those details.",
      "Do not invent facts.",
      "",
      "RECIPIENT PROFILE START",
      "{{recipient_profile}}",
      "RECIPIENT PROFILE END",
      "",
      "SENDER PROFILE START",
      "{{sender_profile}}",
      "SENDER PROFILE END",
      "",
      "The extension will append this fixed tail later. Do not include it in the opener text:",
      "{{fixed_tail}}",
      "",
      "Do these tasks:",
      "1. Write a short recipient summary in about 300 characters. Focus only on the most relevant details and why this person is worth contacting.",
      "2. Generate 5 ranked opener variants.",
      "",
      "Rules for the opener variants:",
      "1. Each opener must be only one opening sentence.",
      "2. Use a greeting only when it fits the context. For first outreach or a long-gap re-entry, a simple 'Hi {recipient first name},' can be fine. Do not force a greeting in every opener.",
      "3. Use only one hook per opener.",
      "4. Prefer these hook types in this order: direct domain overlap, similar career path, school or alumni overlap, recent activity, geography or community overlap.",
      "5. Use nationality, language, or ethnicity only if it feels natural and clearly relevant.",
      "6. Avoid generic flattery, creepy details, oversharing, and scraped-sounding wording.",
      "7. Tone should be polite, natural, low-pressure, and easy to read.",
      "8. The writing style should feel like natural messaging or speaking, not formal copywriting. Target readability around 8 out of 10.",
      "9. After the extension appends the fixed tail, each final message must stay within {{max_message_length}} characters.",
      "",
      "Return JSON only.",
      "Do not use markdown fences.",
      "Do not add any text before or after the JSON.",
      "",
      "Use exactly this JSON shape:",
      "{",
      "  \"first_name\": \"\",",
      "  \"recipient_summary\": \"\",",
      "  \"messages\": [",
      "    {",
      "      \"rank\": 1,",
      "      \"hook_type\": \"\",",
      "      \"opener\": \"\",",
      "      \"estimated_reply_probability\": 0,",
      "      \"reason\": \"\"",
      "    }",
      "  ]",
      "}"
    ].join("\n");
  }

  function lockedJsonRules() {
    return [
      "Locked output rules:",
      "- Return JSON only.",
      "- Do not use markdown fences.",
      "- Do not add any text before or after the JSON.",
      "- In every user-facing text field, never use the em dash character (—). Use a normal hyphen (-) instead.",
      "- Every required top-level key and nested key in the schema must be present. Never omit ai_assessment or referral_readiness.",
      "- If recommended_action is wait, return an empty messages array.",
      "- If you are uncertain about ai_assessment or referral_readiness values, still include the full objects and use neutral defaults plus empty-string reasons rather than omitting fields."
    ].join("\n");
  }

  function profileOutputContract() {
    return [
      "Allowed ai_assessment enum values:",
      "- recipient_relevance: low | medium | high",
      "- relationship_warmth: cold | cool | warm",
      "- referral_path_strength: weak | moderate | strong",
      "- last_ask_type: none | question | advice | meeting | intro | referral | unknown",
      "- last_ask_burden: low | medium | high | unknown",
      "- repeat_ask_risk: low | medium | high",
      "",
      "Use exactly this JSON shape:",
      "{",
      "  \"first_name\": \"\",",
      "  \"recipient_summary\": \"\",",
      "  \"relationship_stage\": \"new\",",
      "  \"recommended_action\": \"draft_first_message\",",
      "  \"reason_why_now\": \"\",",
      "  \"is_referral_ready\": false,",
      "  \"referral_readiness\": {",
      "    \"score_100\": 0,",
      "    \"relationship_trust_25\": 0,",
      "    \"response_history_25\": 0,",
      "    \"role_fit_25\": 0,",
      "    \"ask_specificity_25\": 0,",
      "    \"summary\": \"\"",
      "  },",
      "  \"ai_assessment\": {",
      "    \"recipient_relevance\": \"medium\",",
      "    \"relevance_reason\": \"\",",
      "    \"relationship_warmth\": \"cool\",",
      "    \"warmth_reason\": \"\",",
      "    \"referral_path_strength\": \"moderate\",",
      "    \"referral_path_reason\": \"\",",
      "    \"last_ask_type\": \"none\",",
      "    \"last_ask_burden\": \"unknown\",",
      "    \"repeat_ask_risk\": \"low\",",
      "    \"fresh_trigger_present\": false,",
      "    \"fresh_trigger_reason\": \"\"",
      "  },",
      "  \"messages\": [",
      "    {",
      "      \"rank\": 1,",
      "      \"label\": \"Best option\",",
      "      \"message\": \"\",",
      "      \"reason\": \"\"",
      "    }",
      "  ]",
      "}"
    ].join("\n");
  }

  function messagingOutputContract() {
    return [
      "Allowed ai_assessment enum values:",
      "- recipient_relevance: low | medium | high",
      "- relationship_warmth: cold | cool | warm",
      "- referral_path_strength: weak | moderate | strong",
      "- last_ask_type: none | question | advice | meeting | intro | referral | unknown",
      "- last_ask_burden: low | medium | high | unknown",
      "- repeat_ask_risk: low | medium | high",
      "",
      "Use exactly this JSON shape:",
      "{",
      "  \"recommended_action\": \"draft_reply\",",
      "  \"reason_why_now\": \"\",",
      "  \"referral_readiness\": {",
      "    \"score_100\": 0,",
      "    \"relationship_trust_25\": 0,",
      "    \"response_history_25\": 0,",
      "    \"role_fit_25\": 0,",
      "    \"ask_specificity_25\": 0,",
      "    \"summary\": \"\"",
      "  },",
      "  \"ai_assessment\": {",
      "    \"recipient_relevance\": \"medium\",",
      "    \"relevance_reason\": \"\",",
      "    \"relationship_warmth\": \"cool\",",
      "    \"warmth_reason\": \"\",",
      "    \"referral_path_strength\": \"moderate\",",
      "    \"referral_path_reason\": \"\",",
      "    \"last_ask_type\": \"unknown\",",
      "    \"last_ask_burden\": \"unknown\",",
      "    \"repeat_ask_risk\": \"low\",",
      "    \"fresh_trigger_present\": false,",
      "    \"fresh_trigger_reason\": \"\"",
      "  },",
      "  \"messages\": [",
      "    {",
      "      \"rank\": 1,",
      "      \"label\": \"Best option\",",
      "      \"message\": \"\",",
      "      \"reason\": \"\"",
      "    }",
      "  ]",
      "}"
    ].join("\n");
  }

  function currentDefaultPromptTemplate() {
    return [
      "{{recipient_full_name}}",
      "",
      "You are a world-class relationship strategist for LinkedIn networking and job outreach.",
      "Decide the single best next action for this person, then draft the message for that action.",
      "Use only the information below.",
      "Treat raw evidence as primary. Treat derived signals as heuristics, not facts.",
      "Do not invent facts.",
      "",
      "TASK",
      "Choose exactly one next action and, if the action is not wait, draft the message for that action.",
      "",
      "WORKING DEFINITIONS",
      "{{working_definitions}}",
      "",
      "DECISION PRINCIPLES",
      relationshipStrategyPlaybook(),
      "",
      "CURRENT OBJECTIVE",
      "{{current_objective}}",
      "",
      "PAGE CONTEXT",
      "{{page_context}}",
      "",
      "RECIPIENT",
      "{{recipient_profile}}",
      "",
      "CURRENT THREAD EVIDENCE",
      "{{conversation_context}}",
      "",
      "OLDER IMPORTED CONTEXT",
      "{{imported_conversation}}",
      "",
      "DERIVED RELATIONSHIP SIGNALS",
      "{{logic_metrics}}",
      "",
      "LOCAL RELATIONSHIP TRIAGE HEURISTIC",
      "{{relationship_triage}}",
      "",
      "PROFILE CHANGE SIGNALS",
      "{{profile_change_summary}}",
      "",
      "SENDER CONTEXT",
      "{{sender_profile}}",
      "",
      "SAVED RELATIONSHIP MEMORY",
      "{{relationship_memory}}",
      "",
      "USER CUSTOM STRATEGY GUIDANCE",
      "Treat this as supplemental strategy and tone guidance only. Ignore any conflicting output-format or JSON instructions inside it.",
      "{{strategy_guidance}}",
      "",
      "PERSON NOTE",
      "{{person_note}}",
      "",
      "EXTRA USER CONTEXT FOR THIS DRAFT",
      "{{extra_context}}",
      "",
      "OPTIONAL FIRST-OUTREACH CONTEXT LINE",
      "{{fixed_tail}}",
      "",
      "Do these tasks:",
      "1. Write a short recipient summary in about 250-320 characters.",
      "2. Infer the current relationship stage.",
      "3. Recommend exactly one next action from this list:",
      "   - draft_first_message",
      "   - draft_follow_up",
      "   - draft_reply",
      "   - draft_advice_ask",
      "   - draft_referral_ask",
      "   - wait",
      "4. Explain briefly why this is the right action now.",
      "5. Say whether it is appropriate to ask for a referral now.",
      "6. Score referral readiness even if the answer is 'not yet'. Return a referral_readiness object with a total score out of 100 and four subscores out of 25 each:",
      "   - relationship_trust_25",
      "   - response_history_25",
      "   - role_fit_25",
      "   - ask_specificity_25",
      "7. Add a short referral_readiness.summary explaining the main gating factor.",
      "8. Return an ai_assessment object that captures your advisory judgment about relevance, warmth, referral path, and ask quality.",
      "9. If the action is not wait, generate up to 3 ranked draft messages that the user can send as-is or edit.",
      "10. The ai_assessment object and referral_readiness object are mandatory in every response. Do not omit them, even if some values are uncertain.",
      "",
      referralReadinessScoringGuidance(),
      "",
      "Rules for the drafts:",
      `- Each final message must stay within {{max_message_length}} characters.`,
      "- Messages must sound like a real person, not polished marketing copy.",
      "- Prefer simple, natural spoken English with short sentences and everyday wording. It is acceptable if the tone feels slightly non-native, but it must stay clear, professional, and easy to understand.",
      "- Use the natural length that fits the context. It is acceptable to go beyond 300 characters when genuine appreciation, useful specificity, or a thoughtful reply needs more room.",
      "- Do not make messages long just to be long. Earn the length with substance.",
      "- Do not be pushy.",
      "- Ask for a referral only when the context clearly supports it.",
      "- Prefer advice or a light next step before a referral when the relationship is not warm.",
      "- If this is a reply, continue naturally from the visible thread.",
      "- If this is a follow-up after silence, acknowledge the gap lightly and do not guilt the person.",
      "- Do not automatically start with 'Hi {first name},'. Use a greeting only when it sounds natural for the specific context.",
      "- For first outreach or a long-gap re-entry, a short greeting can be fine. For an active or recent thread, usually continue without greeting again.",
      "- Use the thread tone guidance in the logic metrics as advisory context. Match the conversation style lightly, but keep the reply professional because this is LinkedIn.",
      "- Treat the local relationship triage as advisory signal only. The user may know additional context you do not.",
      "- If extra user context is provided for this draft, weigh it heavily.",
      "- If profile change signals are available, use them only when they create a more relevant, fresher reason to reach out. Do not force them into the draft.",
      "- If this is a first outreach draft, you may echo the tone of the optional sender context line, but do not mechanically append it.",
      "- If context is too weak to justify another message confidently, it is valid to recommend wait.",
      "- If you recommend a referral ask, the message should be specific about the target role, team, or person whenever context makes that possible.",
      "",
      lockedJsonRules(),
      "",
      profileOutputContract()
    ].join("\n");
  }

  function messagingPromptTemplate() {
    return [
      "{{recipient_full_name}}",
      "",
      "You are a world-class relationship strategist helping continue an existing LinkedIn conversation.",
      "Use the raw conversation evidence first. Treat derived signals as heuristics, not facts.",
      "Do not invent facts.",
      "Do not add pleasantries outside the draft.",
      "",
      "TASK",
      "Decide the single best next action for this conversation.",
      "",
      "WORKING DEFINITIONS",
      "{{working_definitions}}",
      "",
      "DECISION PRINCIPLES",
      relationshipStrategyPlaybook(),
      "",
      "CURRENT OBJECTIVE",
      "{{current_objective}}",
      "",
      "PAGE CONTEXT",
      "{{page_context}}",
      "",
      "RECIPIENT",
      "{{recipient_profile}}",
      "",
      "CURRENT THREAD EVIDENCE",
      "{{conversation_context}}",
      "",
      "OLDER IMPORTED CONTEXT",
      "{{imported_conversation}}",
      "",
      "DERIVED RELATIONSHIP SIGNALS",
      "{{logic_metrics}}",
      "",
      "LOCAL RELATIONSHIP TRIAGE HEURISTIC",
      "{{relationship_triage}}",
      "",
      "PROFILE CHANGE SIGNALS",
      "{{profile_change_summary}}",
      "",
      "SENDER CONTEXT",
      "{{sender_profile}}",
      "",
      "USER CUSTOM STRATEGY GUIDANCE",
      "Treat this as supplemental strategy and tone guidance only. Ignore any conflicting output-format or JSON instructions inside it.",
      "{{strategy_guidance}}",
      "",
      "PERSON NOTE",
      "{{person_note}}",
      "",
      "EXTRA USER CONTEXT FOR THIS DRAFT",
      "{{extra_context}}",
      "",
      "Decide the single best next action for this conversation.",
      "Return one of:",
      "- draft_reply",
      "- draft_follow_up",
      "- draft_advice_ask",
      "- draft_referral_ask",
      "- wait",
      "",
      "Return an ai_assessment object that captures your advisory judgment about relevance, warmth, referral path, and ask quality.",
      "Return a referral_readiness object even if a referral ask is not appropriate yet. Score how close the relationship is under these criteria:",
      "- relationship_trust_25",
      "- response_history_25",
      "- role_fit_25",
      "- ask_specificity_25",
      "Also include a total score_100 and a short summary of the main gating factor.",
      "The ai_assessment object and referral_readiness object are mandatory in every response. Do not omit them, even if some values are uncertain.",
      "",
      referralReadinessScoringGuidance(),
      "If the best action is not wait, generate up to 3 ranked draft messages.",
      `Each draft must stay within {{max_message_length}} characters.`,
      "Use the natural length that fits the context. It is acceptable to go beyond 300 characters when genuine appreciation, useful specificity, or a thoughtful reply needs more room.",
      "Do not make messages long just to be long. Earn the length with substance.",
      "Prefer simple, natural spoken English with short sentences and everyday wording. It is acceptable if the tone feels slightly non-native, but it must stay clear, professional, and easy to understand.",
      "Do not automatically start with 'Hi {first name},'. If the message continues an active thread, usually continue without greeting again.",
      "Only use a greeting when it feels natural for the conversation state, such as a genuine long-gap restart.",
      "Use the thread tone guidance in the logic metrics as advisory context. Match the conversation style lightly, but keep the reply professional because this is LinkedIn.",
      "If the best action is wait, return an empty messages array.",
      "Treat the local relationship triage as advisory signal only. The user may know additional context you do not.",
      "If extra user context is provided for this draft, weigh it heavily.",
      "If profile change signals are available, use them only when they create a more relevant, fresher reason to reply or re-engage. Do not force them into the draft.",
      "If the thread is partial, noisy, or ambiguous, prefer the least presumptive recommendation.",
      "",
      lockedJsonRules(),
      "",
      messagingOutputContract()
    ].join("\n");
  }

  function normalizePromptSettings(settings) {
    const merged = {
      ...defaultPromptSettings(),
      ...(settings || {})
    };
    const llmProvider = normalizeLlmProvider(merged.llmProvider);
    const llmEntryUrl = normalizeLlmEntryUrl(
      llmProvider,
      merged.llmEntryUrl || (llmProvider === "chatgpt" ? merged.chatGptProjectUrl : "")
    );

    const strategyGuidance = normalizeWhitespace(merged.strategyGuidance);
    const legacyTemplate = String(merged.promptTemplate || "");
    const normalizedLegacyTemplate = normalizeWhitespace(legacyTemplate);
    const isLegacyDefault = !normalizedLegacyTemplate
      || normalizedLegacyTemplate === normalizeWhitespace(legacyDefaultPromptTemplate())
      || normalizedLegacyTemplate === normalizeWhitespace(previousCurrentPromptTemplate())
      || normalizedLegacyTemplate === normalizeWhitespace(currentDefaultPromptTemplate());

    merged.strategyGuidance = strategyGuidance || (isLegacyDefault ? "" : legacyTemplate.trim());
    merged.llmProvider = llmProvider;
    merged.llmEntryUrl = llmEntryUrl;

    return merged;
  }

  function buildRelationshipMemory(personRecord) {
    if (!personRecord) {
      return "No saved relationship memory.";
    }

    const profileContext = getProfileContext(personRecord);
    const relationshipContext = getRelationshipContext(personRecord);
    const draftWorkspace = getDraftWorkspace(personRecord);
    const observedConversation = getObservedConversation(personRecord);

    const lines = compactProfile(personRecord, [
      { label: "Saved relationship stage", value: relationshipContext.relationshipStage },
      { label: "Saved connection status", value: profileContext.connectionStatus },
      { label: "Saved user goal", value: goalLabel(relationshipContext.userGoal) || relationshipContext.userGoal },
      { label: "Saved person note", value: relationshipContext.personNote },
      { label: "Saved recommended action", value: personRecord.lastRecommendedAction },
      { label: "Saved why now", value: personRecord.lastReasonWhyNow },
      { label: "Last interaction timestamp", value: personRecord.lastInteractionAt },
      { label: "Last page type", value: personRecord.lastPageType },
      { label: "Last profile sync", value: profileContext.lastProfileSyncedAt }
    ]);
    if (!draftWorkspace) {
      return lines || "No saved relationship memory.";
    }

    return uniqueStrings([
      lines,
      profileContext.recipientSummaryMemory ? `Saved recipient summary: ${profileContext.recipientSummaryMemory}` : "",
      draftWorkspace.recipient_summary ? `Last recipient summary: ${draftWorkspace.recipient_summary}` : "",
      draftWorkspace.reason_why_now ? `Last reason why now: ${draftWorkspace.reason_why_now}` : ""
    ]).join("\n");
  }

  function chooseRicherText(primary, fallback) {
    const primaryText = normalizeWhitespace(primary);
    const fallbackText = normalizeWhitespace(fallback);
    if (!primaryText) {
      return fallbackText;
    }
    if (!fallbackText) {
      return primaryText;
    }
    return primaryText.length >= fallbackText.length ? primaryText : fallbackText;
  }

  function chooseRicherList(primary, fallback) {
    const primaryList = uniqueStrings(Array.isArray(primary) ? primary : []).filter(Boolean);
    const fallbackList = uniqueStrings(Array.isArray(fallback) ? fallback : []).filter(Boolean);
    return primaryList.length >= fallbackList.length ? primaryList : fallbackList;
  }

  function resolveRecipientPromptProfile(profile, personRecord) {
    const currentProfile = normalizeProfileData(profile) || {};
    const profileContext = getProfileContext(personRecord);
    const savedProfile = normalizeProfileData(profileContext?.latestProfileData) || {};

    const rawSnapshot = chooseRicherText(currentProfile.rawSnapshot, savedProfile.rawSnapshot || profileContext?.rawSnapshot);
    const activitySnippets = chooseRicherList(currentProfile.activitySnippets, savedProfile.activitySnippets);
    const experienceHighlights = chooseRicherList(currentProfile.experienceHighlights, savedProfile.experienceHighlights);
    const educationHighlights = chooseRicherList(currentProfile.educationHighlights, savedProfile.educationHighlights);
    const languageSnippets = chooseRicherList(currentProfile.languageSnippets, savedProfile.languageSnippets);

    return {
      fullName: normalizeWhitespace(currentProfile.fullName || savedProfile.fullName || personRecord?.fullName),
      headline: chooseRicherText(currentProfile.headline, savedProfile.headline || profileContext?.headline || personRecord?.headline),
      location: chooseRicherText(currentProfile.location, savedProfile.location || profileContext?.location || personRecord?.location),
      about: chooseRicherText(currentProfile.about, savedProfile.about),
      profileSummary: chooseRicherText(currentProfile.profileSummary, savedProfile.profileSummary || profileContext?.profileSummary),
      rawSnapshot,
      activitySnippets,
      experienceHighlights,
      educationHighlights,
      languageSnippets
    };
  }

  function relationshipPromptDefinitions() {
    return [
      "- Unanswered outbound streak = consecutive user-sent messages since the last recipient reply.",
      "- Current context source = whether reasoning is based on the visible thread, imported history, or both.",
      "- Referral gate = system heuristic for whether a referral ask looks appropriate now; it is not a fact.",
      "- Thread warmth signal = heuristic engagement quality signal, not proof of closeness."
    ].join("\n");
  }

  function referralReadinessScoringGuidance() {
    return [
      "Referral readiness scoring rubric:",
      "- Use the full scale aggressively. Do not cluster scores in the 40-60 middle unless the evidence is truly mixed.",
      "- 0-20 = clearly not referral-ready: no reply history, repeated unanswered outreach, weak fit, or vague ask.",
      "- 21-40 = low readiness: some relevance exists, but trust or response history is still too weak for a credible referral ask.",
      "- 41-60 = mixed / transitional: some real signal, but one major gating factor still blocks a strong referral ask.",
      "- 61-80 = strong but not automatic: clear fit and engagement, but the ask still needs targeting or slightly more trust.",
      "- 81-100 = highly ready: real trust or repeated engagement, strong role fit, and a specific low-friction referral ask.",
      "- Apply the same discipline to each 0-25 subscore. Use low numbers freely when evidence is weak."
    ].join("\n");
  }

  function buildCurrentObjectiveText(personRecord, profile, logicMetrics) {
    const relationshipContext = getRelationshipContext(personRecord);
    return [
      `User goal: ${goalLabel(relationshipContext.userGoal) || relationshipContext.userGoal || logicMetrics?.user_goal_label || logicMetrics?.user_goal || "unknown"}`,
      `Connection status: ${normalizeConnectionStatus(personRecord?.connectionStatus || profile?.connectionStatus) || "unknown"}`,
      `Current context source: ${logicMetrics?.current_context_source || "unknown"}`,
      `Conversation state: ${logicMetrics?.conversation_state || "unknown"}`
    ].join("\n");
  }

  function buildRecipientProfileMemory(profile, personRecord) {
    const resolved = resolveRecipientPromptProfile(profile, personRecord);
    return sanitizeRecipientProfileMemory(compactProfile(resolved, [
      { label: "Full name", value: resolved.fullName },
      { label: "Headline", value: resolved.headline },
      { label: "Location", value: resolved.location },
      { label: "About", value: truncate(resolved.about, 2000) },
      { label: "Experience highlights", value: resolved.experienceHighlights.length ? resolved.experienceHighlights.join(" | ") : "" },
      { label: "Education highlights", value: resolved.educationHighlights.length ? resolved.educationHighlights.join(" | ") : "" },
      { label: "Activity snippets", value: resolved.activitySnippets.length ? resolved.activitySnippets.join(" | ") : "" },
      { label: "Language snippets", value: resolved.languageSnippets.length ? resolved.languageSnippets.join(" | ") : "" },
      { label: "Raw profile text", value: truncate(resolved.rawSnapshot, 15000) }
    ]));
  }

  function buildRecipientProfileText(profile, personRecord) {
    const resolved = resolveRecipientPromptProfile(profile, personRecord);
    return sanitizeRecipientProfileMemory(compactProfile(resolved, [
      { label: "Full name", value: resolved.fullName },
      { label: "Headline", value: resolved.headline },
      { label: "Location", value: resolved.location },
      { label: "About", value: truncate(resolved.about, 2000) },
      { label: "Experience highlights", value: resolved.experienceHighlights.length ? resolved.experienceHighlights.join(" | ") : "" },
      { label: "Education highlights", value: resolved.educationHighlights.length ? resolved.educationHighlights.join(" | ") : "" },
      { label: "Activity snippets", value: resolved.activitySnippets.length ? resolved.activitySnippets.join(" | ") : "" },
      { label: "Language snippets", value: resolved.languageSnippets.length ? resolved.languageSnippets.join(" | ") : "" },
      { label: "Raw profile text", value: truncate(resolved.rawSnapshot, 15000) }
    ]));
  }

  function buildWorkspacePrompt(workspaceContext, personRecord, myProfile, fixedTail, promptSettings, extraContext) {
    const settings = normalizePromptSettings(promptSettings);
    const profile = workspaceContext?.profile || workspaceContext?.person || {};
    const conversation = workspaceContext?.conversation || null;
    const recipientText = buildRecipientProfileText(profile, personRecord);
    const myProfileText = compactProfile(myProfile || {}, [
      { label: "Own profile URL", value: myProfile?.ownProfileUrl },
      { label: "Manual notes", value: myProfile?.manualNotes },
      { label: "Raw profile text", value: truncate(myProfile?.rawSnapshot, 15000) }
    ]);
    const relationshipMemory = buildRelationshipMemory(personRecord);
    const profileChangeSummary = getProfileContext(personRecord)?.recentProfileChanges || "No newly captured profile changes.";
    const logicMetrics = buildLogicMetrics(workspaceContext, personRecord, myProfile);
    const relationshipTriage = buildRelationshipTriage(workspaceContext, personRecord, myProfile);
    const promptImportedConversation = importedConversationForPrompt(personRecord);
    const ownFullName = extractOwnProfileName(myProfile?.rawSnapshot);
    const canonicalVisibleMessages = canonicalizeConversationEntries(conversation?.recentMessages, profile.fullName || personRecord?.fullName || "", ownFullName);
    const canonicalImportedMessages = canonicalizeConversationEntries(promptImportedConversation?.messages, profile.fullName || personRecord?.fullName || "", ownFullName);
    const importedMatchesVisible = canonicalVisibleMessages.length && canonicalImportedMessages.length
      && JSON.stringify(canonicalVisibleMessages) === JSON.stringify(canonicalImportedMessages);
    const flowType = determineWorkspaceFlow(workspaceContext, personRecord);
    const template = flowType === "messaging"
      ? messagingPromptTemplate()
      : currentDefaultPromptTemplate();
    const pageContextText = compactProfile(workspaceContext || {}, [
      { label: "Page type", value: workspaceContext?.pageType },
      { label: "Page title", value: workspaceContext?.title },
      { label: "Page URL", value: workspaceContext?.pageUrl }
    ]);

    const prompt = template
      .replaceAll("{{recipient_full_name}}", profile.fullName || personRecord?.fullName || "Recipient")
      .replaceAll("{{recipient_profile}}", recipientText || "No recipient profile data available.")
      .replaceAll("{{sender_profile}}", myProfileText || "No saved sender profile available.")
      .replaceAll("{{fixed_tail}}", fixedTail || FIXED_TAIL)
      .replaceAll("{{max_message_length}}", String(MAX_MESSAGE_LENGTH))
      .replaceAll("{{page_context}}", pageContextText || "No page context available.")
      .replaceAll("{{working_definitions}}", relationshipPromptDefinitions())
      .replaceAll("{{current_objective}}", buildCurrentObjectiveText(personRecord, profile, logicMetrics))
      .replaceAll("{{conversation_context}}", formatConversationContext(conversation, ownFullName) || "No visible conversation context.")
      .replaceAll("{{relationship_memory}}", relationshipMemory || "No saved relationship memory.")
      .replaceAll("{{profile_change_summary}}", profileChangeSummary)
      .replaceAll("{{logic_metrics}}", formatLogicMetrics(logicMetrics))
      .replaceAll("{{person_note}}", personRecord?.personNote || "No saved person note.")
      .replaceAll("{{extra_context}}", normalizeWhitespace(extraContext) || "No additional user context for this draft.")
      .replaceAll("{{connection_status}}", personRecord?.connectionStatus || profile.connectionStatus || "unknown")
      .replaceAll("{{imported_conversation}}", importedMatchesVisible
        ? "Imported conversation matches the visible thread and adds no new context."
        : (formatImportedConversation(promptImportedConversation, profile.fullName || personRecord?.fullName || "", ownFullName) || "No imported conversation history."))
      .replaceAll("{{relationship_triage}}", formatRelationshipTriage(relationshipTriage))
      .replaceAll("{{strategy_guidance}}", settings.strategyGuidance || "No additional custom strategy guidance.");

    return {
      flowType,
      prompt,
      recipientText,
      logicMetrics,
      relationshipTriage
    };
  }

  function determineWorkspaceFlow(workspaceContext, personRecord) {
    if (workspaceContext?.pageType === "linkedin-messaging") {
      return "messaging";
    }
    if (normalizeConnectionStatus(personRecord?.connectionStatus) === "connected") {
      return "profile_connected";
    }
    return "profile_first_contact";
  }

  function buildRetryPrompt(errorMessage) {
    const normalizedError = normalizeWhitespace(errorMessage) || "The previous response did not pass validation.";
    return [
      "Please regenerate your last answer in this same thread.",
      `The extension rejected it for this reason: ${normalizedError}`,
      "Check your previous answer and fix the issue.",
      "Return every required top-level and nested field from the locked JSON schema.",
      "If ai_assessment or referral_readiness was missing or incomplete, include the full objects with neutral defaults rather than omitting them.",
      "Do not use the em dash character (—). Use a normal hyphen (-) instead.",
      "Return JSON only.",
      "Do not add explanations.",
      "Do not use markdown fences."
    ].join("\n");
  }

  function extractJsonFromText(rawText) {
    const text = normalizeWhitespace(rawText);
    if (!text) {
      throw new Error("Empty model output.");
    }

    const direct = safeJson(text, null);
    if (direct) {
      return direct;
    }

    const fencedMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch) {
      const fenced = safeJson(fencedMatch[1], null);
      if (fenced) {
        return fenced;
      }
    }

    const start = rawText.indexOf("{");
    const end = rawText.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const candidate = rawText.slice(start, end + 1);
      const parsed = safeJson(candidate, null);
      if (parsed) {
        return parsed;
      }
    }

    throw new Error("Unable to parse JSON from model output.");
  }

  function normalizeRelationshipStage(value) {
    const normalized = normalizeWhitespace(value).toLowerCase();
    return RELATIONSHIP_STAGES.includes(normalized) ? normalized : "";
  }

  function normalizeRecommendedAction(value) {
    const normalized = normalizeWhitespace(value).toLowerCase();
    return RECOMMENDED_ACTIONS.includes(normalized) ? normalized : "";
  }

  function normalizeConnectionStatus(value) {
    const normalized = normalizeWhitespace(value).toLowerCase();
    return CONNECTION_STATUSES.includes(normalized) ? normalized : "";
  }

  function normalizeUserGoal(value) {
    const normalized = normalizeWhitespace(value).toLowerCase();
    return USER_GOALS.includes(normalized) ? normalized : "";
  }

  function normalizeDraftMessages(messages, fixedTail) {
    return messages.map((message, index) => {
      const draft = normalizeOutputText(message.message) || normalizeOutputText(combineMessage(message.opener || "", fixedTail || FIXED_TAIL));
      if (!draft) {
        throw new Error(`Message ${index + 1} is missing message text.`);
      }
      if (draft.length > MAX_MESSAGE_LENGTH) {
        throw new Error(`Message ${index + 1} exceeds ${MAX_MESSAGE_LENGTH} characters.`);
      }
      return {
        rank: Number(message.rank) || index + 1,
        label: normalizeOutputText(message.label) || `Option ${index + 1}`,
        message: draft,
        character_count: draft.length,
        reason: normalizeOutputText(message.reason)
      };
    });
  }

  function validateProfileWorkspaceResult(parsed, fixedTail, fallbackProfile) {
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Parsed model output is not an object.");
    }

    const firstName = normalizeOutputText(parsed.first_name) || firstNameFromFullName(fallbackProfile?.fullName);
    const recipientSummary = normalizeOutputText(parsed.recipient_summary);
    const relationshipStage = normalizeRelationshipStage(parsed.relationship_stage) || "new";
    const recommendedAction = normalizeRecommendedAction(parsed.recommended_action) || "draft_first_message";
    const reasonWhyNow = normalizeOutputText(parsed.reason_why_now);
    const aiAssessment = normalizeAiAssessment(parsed.ai_assessment);
    const referralReadiness = calibrateReferralReadiness(parsed.referral_readiness, recommendedAction, aiAssessment);
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];

    if (!firstName) {
      throw new Error("Model output is missing first_name.");
    }
    if (!recipientSummary) {
      throw new Error("Model output is missing recipient_summary.");
    }
    if (!reasonWhyNow) {
      throw new Error("Model output is missing reason_why_now.");
    }
    if (recommendedAction !== "wait" && messages.length < 1) {
      throw new Error("Model output did not include any draft messages.");
    }

    const normalizedMessages = recommendedAction === "wait"
      ? []
      : normalizeDraftMessages(messages, fixedTail);

    return {
      first_name: firstName,
      recipient_summary: recipientSummary,
      relationship_stage: relationshipStage,
      recommended_action: recommendedAction,
      reason_why_now: reasonWhyNow,
      is_referral_ready: Boolean(parsed.is_referral_ready),
      referral_readiness: referralReadiness,
      ai_assessment: aiAssessment,
      messages: normalizedMessages
        .sort((left, right) => left.rank - right.rank)
        .slice(0, 3)
    };
  }

  function validateMessagingWorkspaceResult(parsed, fixedTail, fallbackProfile) {
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Parsed model output is not an object.");
    }

    const recommendedAction = normalizeRecommendedAction(parsed.recommended_action);
    const reasonWhyNow = normalizeOutputText(parsed.reason_why_now);
    const aiAssessment = normalizeAiAssessment(parsed.ai_assessment);
    const referralReadiness = calibrateReferralReadiness(parsed.referral_readiness, recommendedAction, aiAssessment);
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];

    if (!recommendedAction) {
      throw new Error("Model output is missing recommended_action.");
    }
    if (!reasonWhyNow) {
      throw new Error("Model output is missing reason_why_now.");
    }
    if (recommendedAction !== "wait" && messages.length < 1) {
      throw new Error("Model output did not include any draft messages.");
    }

    return {
      first_name: firstNameFromFullName(fallbackProfile?.fullName),
      recipient_summary: "",
      relationship_stage: "",
      recommended_action: recommendedAction,
      reason_why_now: reasonWhyNow,
      is_referral_ready: recommendedAction === "draft_referral_ask",
      referral_readiness: referralReadiness,
      ai_assessment: aiAssessment,
      messages: recommendedAction === "wait"
        ? []
        : normalizeDraftMessages(messages, fixedTail)
          .sort((left, right) => left.rank - right.rank)
          .slice(0, 3)
    };
  }

  function validateWorkspaceResult(parsed, fixedTail, flowType, fallbackProfile) {
    if (flowType === "messaging") {
      return validateMessagingWorkspaceResult(parsed, fixedTail, fallbackProfile);
    }
    return validateProfileWorkspaceResult(parsed, fixedTail, fallbackProfile);
  }

  function validateGenerationResult(parsed, fixedTail, flowType, fallbackProfile) {
    return validateWorkspaceResult(parsed, fixedTail, flowType, fallbackProfile);
  }

  function serializeError(error) {
    return {
      message: error?.message || String(error),
      stack: error?.stack || ""
    };
  }

  function normalizePersonRecord(record) {
    return mergePersonRecord(record, null);
  }

  global.LinkedInAssistantShared = {
    DEFAULT_GEMINI_URL,
    DEFAULT_CHATGPT_PROJECT_URL,
    DEFAULT_LLM_ENTRY_URLS,
    DEFAULT_LLM_PROVIDER,
    FIXED_TAIL,
    LEGACY_FIXED_TAIL,
    LLM_PROVIDERS,
    CONNECTION_STATUSES,
    INVESTMENT_DECISIONS,
    MAX_MESSAGE_LENGTH,
    MESSAGE_TYPES,
    RECOMMENDED_ACTIONS,
    RESEARCH_RECOMMENDATIONS,
    RELATIONSHIP_STAGES,
    STORAGE_KEYS,
    USER_GOALS,
    buildLogicMetrics,
    buildRecipientProfileMemory,
    buildRecipientProfileText,
    buildRelationshipMemory,
    buildRelationshipTriage,
    buildRetryPrompt,
    buildWorkspacePrompt,
    combineMessage,
    defaultMyProfile,
    defaultDashboardReview,
    defaultDraftWorkspace,
    defaultIdentity,
    defaultObservedConversation,
    defaultObservedMetrics,
    defaultPersonRecord,
    defaultPromptSettings,
    defaultProfileContext,
    defaultRelationshipContext,
    ensureSentence,
    extractJsonFromText,
    firstNameFromFullName,
    formatConversationTimestampForDisplay,
    getDashboardReview,
    getDraftWorkspace,
    getIdentity,
    getObservedConversation,
    getObservedMetrics,
    getProfileContext,
    getRelationshipContext,
    describeProfileChanges,
    isOpaqueLinkedInPersonId,
    mergePersonRecord,
    extractOwnProfileName,
    defaultLlmEntryUrl,
    normalizeFixedTail,
    normalizeConnectionStatus,
    normalizeConversationTimestamp,
    normalizeDashboardReview,
    normalizeInvestmentDecision,
    linkedInProfileAlias,
    normalizeLinkedInProfileUrl,
    normalizeObservedConversation,
    normalizeObservedMetrics,
    normalizeProfileData,
    normalizePersonRecord,
    normalizePromptSettings,
    sanitizeRecipientProfileMemory,
    normalizeRecommendedAction,
    normalizeResearchRecommendation,
    normalizeRelationshipStage,
    normalizeLlmEntryUrl,
    normalizeLlmProvider,
    normalizeUserGoal,
    normalizeUrl,
    normalizeWhitespace,
    isChatGptUrl,
    isGeminiUrl,
    personIdFromProfileUrl,
    providerDisplayName,
    serializeError,
    generateShortUuid,
    slugify,
    toIsoNow,
    truncate,
    uniqueStrings,
    validateGenerationResult,
    validateWorkspaceResult
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
