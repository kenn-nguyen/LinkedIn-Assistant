(function initPrompts(global) {
  const shared = global.LinkedInAssistantShared;
  const promptPackRuntime = global.LumiPromptPackRuntime;
  if (!shared || !promptPackRuntime) {
    return;
  }

  const {
    buildLogicMetrics,
    buildRecipientProfileMemory,
    buildRelationshipTriage,
    calibrateReferralReadiness,
    canonicalizeConversationEntries,
    compactProfile,
    defaultAiAssessment,
    ensureSentence,
    extractOwnProfileName,
    firstNameFromFullName,
    getDraftWorkspace,
    getProfileContext,
    getRelationshipContext,
    goalLabel,
    importedConversationForPrompt,
    normalizeAiAssessment,
    normalizeConnectionStatus,
    normalizeRecommendedAction,
    normalizeRelationshipStage,
    normalizeUrl,
    normalizeWhitespace,
    truncate,
    uniqueStrings
  } = shared;

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
  const SHORT_DRAFT_CHARACTER_LIMIT = 300;

  function normalizeOutputText(value) {
    return normalizeWhitespace(String(value || "")
      .replace(/\u2014/g, "-"));
  }

  function normalizeFixedTail(value) {
    if (value === undefined || value === null) {
      return FIXED_TAIL;
    }
    const normalized = normalizeWhitespace(value);
    if (!normalized) {
      return "";
    }
    if (normalized === normalizeWhitespace(LEGACY_FIXED_TAIL)) {
      return FIXED_TAIL;
    }
    return normalized;
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

  function normalizeDraftCharacterLimit(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return null;
    }
    return Math.max(1, Math.floor(numeric));
  }

  function draftLengthRule(options) {
    const draftCharacterLimit = normalizeDraftCharacterLimit(options?.draftCharacterLimit);
    if (!draftCharacterLimit) {
      return `- Each final message must stay within ${MAX_MESSAGE_LENGTH} characters.`;
    }
    return [
      `- Each final message must be fewer than ${draftCharacterLimit} characters, including spaces.`,
      "- This stricter character limit overrides any request for a longer or more detailed draft.",
      "- If needed, omit nice-to-have detail so the whole message fits the limit."
    ].join("\n");
  }

  function defaultPromptSettings() {
    return {
      strategyGuidance: "",
      llmProvider: DEFAULT_LLM_PROVIDER,
      llmEntryUrl: defaultLlmEntryUrl(DEFAULT_LLM_PROVIDER)
    };
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

    merged.strategyGuidance = normalizeWhitespace(merged.strategyGuidance);
    merged.llmProvider = llmProvider;
    merged.llmEntryUrl = llmEntryUrl;

    return merged;
  }

  function combineMessage(opener, fixedTail) {
    const safeOpener = ensureSentence(opener);
    return normalizeWhitespace(`${safeOpener} ${fixedTail}`);
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

  function buildRelationshipMemory(personRecord) {
    if (!personRecord) {
      return "No saved relationship memory.";
    }

    const profileContext = getProfileContext(personRecord);
    const relationshipContext = getRelationshipContext(personRecord);
    const draftWorkspace = getDraftWorkspace(personRecord);

    const lines = compactProfile(personRecord, [
      { label: "Saved relationship stage", value: relationshipContext.relationshipStage },
      { label: "Saved connection status", value: profileContext.connectionStatus },
      { label: "Saved user goal", value: goalLabel(relationshipContext.userGoal) || relationshipContext.userGoal },
      { label: "Saved person note", value: relationshipContext.personNote },
      { label: "Last interaction timestamp", value: personRecord.lastInteractionAt },
      { label: "Last page type", value: personRecord.lastPageType },
      { label: "Last profile sync", value: profileContext.lastProfileSyncedAt }
    ]);
    if (!draftWorkspace) {
      return lines || "No saved relationship memory.";
    }

    return uniqueStrings([
      lines
    ]).join("\n");
  }

  function normalizeDraftMessages(messages, fixedTail, options) {
    const draftCharacterLimit = normalizeDraftCharacterLimit(options?.draftCharacterLimit);
    return messages.map((message, index) => {
      const draft = normalizeOutputText(message.message) || normalizeOutputText(combineMessage(message.opener || "", normalizeFixedTail(fixedTail)));
      if (!draft) {
        throw new Error(`Message ${index + 1} is missing message text.`);
      }
      if (draft.length > MAX_MESSAGE_LENGTH) {
        throw new Error(`Message ${index + 1} exceeds ${MAX_MESSAGE_LENGTH} characters.`);
      }
      if (draftCharacterLimit && draft.length >= draftCharacterLimit) {
        throw new Error(`Message ${index + 1} must be fewer than ${draftCharacterLimit} characters.`);
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

  function validateWorkspaceResult(parsed, fixedTail, _flowType, fallbackProfile, options) {
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Parsed model output is not an object.");
    }

    const firstName = normalizeOutputText(parsed.first_name) || firstNameFromFullName(fallbackProfile?.fullName);
    const recipientSummary = normalizeOutputText(parsed.recipient_summary);
    const relationshipStage = normalizeRelationshipStage(parsed.relationship_stage) || "new";
    const recommendedAction = normalizeRecommendedAction(parsed.recommended_action);
    const reasonWhyNow = normalizeOutputText(parsed.reason_why_now);
    const aiAssessment = normalizeAiAssessment(parsed.ai_assessment || defaultAiAssessment());
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

    const normalizedMessages = recommendedAction === "wait"
      ? []
      : normalizeDraftMessages(messages, fixedTail, options);

    return {
      first_name: firstName || "",
      recipient_summary: recipientSummary || "",
      relationship_stage: relationshipStage,
      recommended_action: recommendedAction,
      reason_why_now: reasonWhyNow,
      is_referral_ready: typeof parsed.is_referral_ready === "boolean"
        ? parsed.is_referral_ready
        : recommendedAction === "draft_referral_ask",
      referral_readiness: referralReadiness,
      ai_assessment: aiAssessment,
      messages: normalizedMessages
        .sort((left, right) => left.rank - right.rank)
        .slice(0, 3)
    };
  }

  function validateGenerationResult(parsed, fixedTail, _flowType, fallbackProfile, options) {
    return validateWorkspaceResult(parsed, fixedTail, "", fallbackProfile, options);
  }

  const {
    formatConversationTimestampForDisplay
  } = shared;

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
        return `- ${normalizeWhitespace(prefix)}${normalizeWhitespace(entry?.sender) || "Unknown"}: ${normalizeWhitespace(entry?.text)}`;
      })
    ].join("\n");
  }

  function formatConversationContext(conversation, ownFullName) {
    if (!conversation) {
      return "";
    }
    const recipientName = normalizeWhitespace(conversation.recipientName);
    return [
      recipientName ? `Conversation with: ${recipientName}` : "",
      conversation.lastSpeaker ? `Last speaker: ${normalizeWhitespace(conversation.lastSpeaker)}` : "",
      conversation.lastMessageAt ? `Last visible message time: ${formatConversationTimestampForDisplay(conversation.lastMessageAt)}` : "",
      formatPromptConversationMessages(conversation.recentMessages, recipientName, ownFullName, "Visible messages")
    ].filter(Boolean).join("\n");
  }

  function formatImportedConversation(importedConversation, recipientFullName, ownFullName) {
    if (!importedConversation) {
      return "";
    }
    const canonicalMessages = canonicalizeConversationEntries(importedConversation.messages, recipientFullName, ownFullName);
    return [
      importedConversation.importedAt ? `Imported at: ${importedConversation.importedAt}` : "",
      importedConversation.sourcePageType ? `Imported from: ${importedConversation.sourcePageType}` : "",
      importedConversation.lastMessageAt ? `Last imported message time: ${formatConversationTimestampForDisplay(importedConversation.lastMessageAt)}` : "",
      formatPromptConversationMessages(canonicalMessages, recipientFullName, ownFullName, "Imported messages")
    ].filter(Boolean).join("\n");
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

  function relationshipOutputContract() {
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

  function relationshipPromptTemplate(promptPackSettings) {
    return promptPackRuntime.getBuiltInTemplate("relationship", promptPackSettings);
  }

  function postSuggestionPromptTemplate(promptPackSettings) {
    return promptPackRuntime.getBuiltInTemplate("post_suggestions", promptPackSettings);
  }

  function relationshipRetryPromptTemplate(promptPackSettings) {
    return promptPackRuntime.getBuiltInTemplate("relationship_retry", promptPackSettings);
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

  function visibleSignalsText(visibleSignals) {
    if (!visibleSignals || typeof visibleSignals !== "object") {
      return "";
    }
    return compactProfile({}, [
      { label: "Companies", value: visibleSignals.companies },
      { label: "Schools", value: visibleSignals.schools },
      { label: "Locations", value: visibleSignals.locations },
      { label: "Languages", value: visibleSignals.languages }
    ]);
  }

  function senderProfileFactsText(myProfile, senderProfileData) {
    const facts = senderProfileData?.profileFacts || myProfile?.profileFacts;
    if (!facts || typeof facts !== "object") {
      return "";
    }
    return JSON.stringify({
      identity: facts.identity || {},
      manualContext: {
        notes: normalizeWhitespace(myProfile?.manualNotes || "")
      },
      about: facts.about || {},
      experience: Array.isArray(facts.experience) ? facts.experience : [],
      education: Array.isArray(facts.education) ? facts.education : [],
      languages: Array.isArray(facts.languages) ? facts.languages : [],
      recentActivity: {
        items: Array.isArray(facts.recentActivity?.items) ? facts.recentActivity.items.slice(0, 3) : []
      },
      visibleSignals: facts.visibleSignals || senderProfileData?.visibleSignals || myProfile?.visibleSignals || {}
    }, null, 2);
  }

  function buildWorkspacePrompt(workspaceContext, personRecord, myProfile, fixedTail, promptSettings, extraContext, options) {
    const settings = normalizePromptSettings(promptSettings || defaultPromptSettings());
    const profile = workspaceContext?.profile || workspaceContext?.person || {};
    const conversation = workspaceContext?.conversation || null;
    const recipientText = buildRecipientProfileMemory(profile, personRecord);
    const senderProfileData = myProfile?.profileData || myProfile || {};
    const myProfileText = senderProfileFactsText(myProfile, senderProfileData) || compactProfile(myProfile || {}, [
      { label: "Own profile URL", value: myProfile?.ownProfileUrl },
      { label: "Manual notes", value: myProfile?.manualNotes },
      { label: "Full name", value: senderProfileData.fullName || myProfile?.fullName },
      { label: "Headline", value: senderProfileData.headline || myProfile?.headline },
      { label: "Location", value: senderProfileData.location || myProfile?.location },
      { label: "About", value: senderProfileData.about || myProfile?.about },
      { label: "Experience highlights", value: senderProfileData.experienceHighlights || myProfile?.experienceHighlights },
      { label: "Education highlights", value: senderProfileData.educationHighlights || myProfile?.educationHighlights },
      { label: "Activity snippets", value: senderProfileData.activitySnippets || myProfile?.activitySnippets },
      { label: "Language snippets", value: senderProfileData.languageSnippets || myProfile?.languageSnippets },
      { label: "Visible signals", value: visibleSignalsText(senderProfileData.visibleSignals || myProfile?.visibleSignals) }
    ]);
    const relationshipMemory = buildRelationshipMemory(personRecord);
    const profileChangeSummary = getProfileContext(personRecord)?.recentProfileChanges || "No newly captured profile changes.";
    const logicMetrics = buildLogicMetrics(workspaceContext, personRecord, myProfile);
    const relationshipTriage = buildRelationshipTriage(workspaceContext, personRecord, myProfile);
    const promptImportedConversation = importedConversationForPrompt(personRecord);
    const ownFullName = normalizeWhitespace(senderProfileData.fullName || myProfile?.fullName) || extractOwnProfileName(myProfile?.rawSnapshot);
    const canonicalVisibleMessages = canonicalizeConversationEntries(conversation?.recentMessages, profile.fullName || personRecord?.fullName || "", ownFullName);
    const canonicalImportedMessages = canonicalizeConversationEntries(promptImportedConversation?.messages, profile.fullName || personRecord?.fullName || "", ownFullName);
    const importedMatchesVisible = canonicalVisibleMessages.length && canonicalImportedMessages.length
      && JSON.stringify(canonicalVisibleMessages) === JSON.stringify(canonicalImportedMessages);
    const flowType = "relationship";
    const template = relationshipPromptTemplate(options?.promptPackSettings);
    const pageContextText = compactProfile(workspaceContext || {}, [
      { label: "Page type", value: workspaceContext?.pageType },
      { label: "Page title", value: workspaceContext?.title },
      { label: "Page URL", value: workspaceContext?.pageUrl }
    ]);

    const prompt = promptPackRuntime.applyTemplate(template, {
      recipient_full_name: profile.fullName || personRecord?.fullName || "Recipient",
      recipient_profile: recipientText || "No recipient profile data available.",
      sender_profile: myProfileText || "No saved sender profile available.",
      fixed_tail: normalizeFixedTail(fixedTail),
      page_context: pageContextText || "No page context available.",
      working_definitions: relationshipPromptDefinitions(),
      relationship_strategy_playbook: relationshipStrategyPlaybook(),
      current_objective: buildCurrentObjectiveText(personRecord, profile, logicMetrics),
      conversation_context: formatConversationContext(conversation, ownFullName) || "No visible conversation context.",
      relationship_memory: relationshipMemory || "No saved relationship memory.",
      profile_change_summary: profileChangeSummary,
      logic_metrics: formatLogicMetrics(logicMetrics),
      person_note: personRecord?.personNote || "No saved person note.",
      extra_context: normalizeWhitespace(extraContext) || "No additional user context for this draft.",
      imported_conversation: importedMatchesVisible
        ? "Imported conversation matches the visible thread and adds no new context."
        : (formatImportedConversation(promptImportedConversation, profile.fullName || personRecord?.fullName || "", ownFullName) || "No imported conversation history."),
      relationship_triage: formatRelationshipTriage(relationshipTriage),
      draft_length_rule: draftLengthRule(options),
      strategy_guidance: settings.strategyGuidance || "No additional custom strategy guidance.",
      referral_readiness_scoring_guidance: referralReadinessScoringGuidance(),
      locked_json_rules: lockedJsonRules(),
      relationship_output_contract: relationshipOutputContract()
    });

    return {
      flowType,
      prompt,
      recipientText,
      logicMetrics,
      relationshipTriage
    };
  }

  function formatPostDiscussionForPrompt(postDiscussion) {
    const discussion = postDiscussion || {};
    const actors = Array.isArray(discussion.actors) ? discussion.actors : [];
    const comments = Array.isArray(discussion.comments) ? discussion.comments : [];
    return [
      compactProfile(discussion, [
        { label: "Post URL", value: discussion.postUrl || discussion.pageUrl },
        { label: "Post author", value: discussion.authorName },
        { label: "Visible actors", value: actors.map((actor) => actor?.name).filter(Boolean) },
        { label: "Post text", value: discussion.postText },
        { label: "Reaction summary", value: compactProfile(discussion.reactionSummary || {}, [
          { label: "Reactions", value: discussion.reactionSummary?.reactionsText },
          { label: "Comments", value: discussion.reactionSummary?.commentsText },
          { label: "Reposts", value: discussion.reactionSummary?.repostsText }
        ]) }
      ]),
      comments.length
        ? [
          "Visible comments:",
          ...comments.slice(0, 8).map((comment, index) => {
            const header = [comment.authorName || `Comment ${index + 1}`, comment.timestamp || ""].filter(Boolean).join(" - ");
            return `- ${header}: ${normalizeWhitespace(comment.text)}`;
          })
        ].join("\n")
        : "Visible comments: none captured."
    ].filter(Boolean).join("\n\n");
  }

  function buildPostSuggestionPrompt(postDiscussion, myProfile, promptSettings, options) {
    const settings = normalizePromptSettings(promptSettings || defaultPromptSettings());
    const senderProfileData = myProfile?.profileData || myProfile || {};
    const senderContext = senderProfileFactsText(myProfile, senderProfileData) || compactProfile(myProfile || {}, [
      { label: "Full name", value: senderProfileData.fullName || myProfile?.fullName },
      { label: "Headline", value: senderProfileData.headline || myProfile?.headline },
      { label: "Location", value: senderProfileData.location || myProfile?.location },
      { label: "Manual notes", value: myProfile?.manualNotes }
    ]);
    const messageLimit = normalizeDraftCharacterLimit(options?.draftCharacterLimit);
    const limitRule = messageLimit
      ? `Each suggested message must be fewer than ${messageLimit} characters, including spaces.`
      : "Each suggested message should stay concise and comfortably under 500 characters.";
    const postContext = formatPostDiscussionForPrompt(postDiscussion);

    const prompt = promptPackRuntime.applyTemplate(postSuggestionPromptTemplate(options?.promptPackSettings), {
      draft_length_rule: limitRule,
      sender_context: senderContext || "No saved sender profile context.",
      post_context: postContext || "No visible post context.",
      strategy_guidance_section: settings.strategyGuidance
        ? ["Additional strategy guidance:", settings.strategyGuidance].join("\n")
        : "No additional strategy guidance."
    });

    return {
      prompt,
      postContext
    };
  }

  function validatePostSuggestionResult(raw, options) {
    const parsed = shared.extractJsonFromText(raw);
    const draftCharacterLimit = normalizeDraftCharacterLimit(options?.draftCharacterLimit);
    const suggestions = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
    const normalizedSuggestions = suggestions.map((item, index) => {
      const message = normalizeOutputText(item?.message);
      return {
        rank: Math.max(1, Number(item?.rank || index + 1) || index + 1),
        type: normalizeWhitespace(item?.type || "").toLowerCase(),
        target: normalizeOutputText(item?.target),
        message,
        reason: normalizeOutputText(item?.reason)
      };
    }).filter((item) => item.message);
    const errors = [];
    const postSummary = normalizeOutputText(parsed?.post_summary || parsed?.postSummary);
    const interactionRead = normalizeOutputText(parsed?.interaction_read || parsed?.interactionRead);
    if (!postSummary) {
      errors.push("Missing post_summary.");
    }
    if (!interactionRead) {
      errors.push("Missing interaction_read.");
    }
    if (!normalizedSuggestions.length) {
      errors.push("No suggestions were returned.");
    }
    const invalidType = normalizedSuggestions.find((item) => item.type !== "comment" && item.type !== "reply");
    if (invalidType) {
      errors.push(`Invalid suggestion type: ${invalidType.type || "unknown"}.`);
    }
    const overLimit = normalizedSuggestions.find((item) => draftCharacterLimit && item.message.length >= draftCharacterLimit);
    if (overLimit) {
      errors.push(`Suggestion ${overLimit.rank} must be fewer than ${draftCharacterLimit} characters.`);
    }
    const tooLong = normalizedSuggestions.find((item) => item.message.length > MAX_MESSAGE_LENGTH);
    if (tooLong) {
      errors.push(`Suggestion ${tooLong.rank} exceeds ${MAX_MESSAGE_LENGTH} characters.`);
    }
    const missingReason = normalizedSuggestions.find((item) => !item.reason);
    if (missingReason) {
      errors.push(`Suggestion ${missingReason.rank} is missing reason.`);
    }
    const missingTarget = normalizedSuggestions.find((item) => !item.target);
    if (missingTarget) {
      errors.push(`Suggestion ${missingTarget.rank} is missing target.`);
    }
    if (errors.length) {
      return { ok: false, errors, raw: parsed, value: null };
    }
    return {
      ok: true,
      errors: [],
      raw: parsed,
      value: {
        postSummary,
        interactionRead,
        suggestions: normalizedSuggestions
          .sort((left, right) => left.rank - right.rank)
          .slice(0, 5)
      }
    };
  }

  function buildRetryPrompt(errorMessage, promptPackSettings) {
    const normalizedError = normalizeWhitespace(errorMessage) || "The previous response did not pass validation.";
    return promptPackRuntime.applyTemplate(relationshipRetryPromptTemplate(promptPackSettings), {
      error_message: normalizedError
    });
  }

  global.LinkedInAssistantPrompts = {
    DEFAULT_CHATGPT_PROJECT_URL,
    DEFAULT_GEMINI_URL,
    DEFAULT_LLM_ENTRY_URLS,
    DEFAULT_LLM_PROVIDER,
    FIXED_TAIL,
    MAX_MESSAGE_LENGTH,
    SHORT_DRAFT_CHARACTER_LIMIT,
    defaultLlmEntryUrl,
    defaultPromptSettings,
    isChatGptUrl,
    isGeminiUrl,
    normalizeFixedTail,
    normalizeLlmEntryUrl,
    normalizeLlmProvider,
    normalizeDraftCharacterLimit,
    normalizePromptSettings,
    providerDisplayName,
    relationshipPromptTemplate,
    postSuggestionPromptTemplate,
    buildWorkspacePrompt,
    buildPostSuggestionPrompt,
    buildRetryPrompt,
    validateGenerationResult,
    validateWorkspaceResult,
    validatePostSuggestionResult
  };
})(globalThis);
