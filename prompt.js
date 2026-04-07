(function initPrompts(global) {
  const shared = global.LinkedInAssistantShared;
  if (!shared) {
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

  function normalizeOutputText(value) {
    return normalizeWhitespace(String(value || "")
      .replace(/\u2014/g, "-"));
  }

  function normalizeFixedTail(value) {
    const normalized = normalizeWhitespace(value);
    if (!normalized || normalized === normalizeWhitespace(LEGACY_FIXED_TAIL)) {
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

  function validateWorkspaceResult(parsed, fixedTail, _flowType, fallbackProfile) {
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
      : normalizeDraftMessages(messages, fixedTail);

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

  function validateGenerationResult(parsed, fixedTail, _flowType, fallbackProfile) {
    return validateWorkspaceResult(parsed, fixedTail, "", fallbackProfile);
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

  function relationshipPromptTemplate() {
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
      "OPTIONAL CONTEXT LINE",
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
      "4. Explain briefly why this is the right action now in about 35-50 words.",
      "5. Say whether it is appropriate to ask for a referral now.",
      "6. Score referral readiness even if the answer is 'not yet'. Return a referral_readiness object with a total score out of 100 and four subscores out of 25 each:",
      "   - relationship_trust_25",
      "   - response_history_25",
      "   - role_fit_25",
      "   - ask_specificity_25",
      "7. Add a short referral_readiness.summary explaining the main gating factor.",
      "7a. In reason_why_now, you must use **double asterisks** around the 2 most important skim-worthy phrases.",
      "7b. In referral_readiness.summary, you must use **double asterisks** around the single biggest gating factor.",
      "7c. Keep that emphasis sparse. Do not use headings, bullets, or markdown fences inside those fields.",
      "7d. Keep reason_why_now tight. Do not exceed 50 words.",
      "8. Return an ai_assessment object that captures your advisory judgment about relevance, warmth, referral path, and ask quality.",
      "9. If the action is not wait, generate up to 3 ranked draft messages that the user can send as-is or edit.",
      "9a. For each message.reason, keep the explanation very short: about 8-16 words, roughly half the length of a typical sentence.",
      "9b. In each message.reason, justify the choice using the most recent recipient message when relevant, especially whether it calls for a shorter or slightly fuller reply.",
      "10. The ai_assessment object and referral_readiness object are mandatory in every response. Do not omit them, even if some values are uncertain.",
      "",
      referralReadinessScoringGuidance(),
      "",
      "Rules for the drafts:",
      `- Each final message must stay within ${MAX_MESSAGE_LENGTH} characters.`,
      "- Messages must sound like a real person, not polished marketing copy.",
      "- Prefer simple, natural spoken English with short sentences and everyday wording. It is acceptable if the tone feels slightly non-native, but it must stay clear, professional, and easy to understand.",
      "- Default to short, concise replies.",
      "- Only make the message longer when the recipient's most recent message is substantively long or detailed and a fuller reply is genuinely needed.",
      "- If extra user context explicitly asks for a longer or more detailed draft, follow that instruction.",
      "- Use the most recent recipient message as the main length cue: short message usually means short reply; thoughtful long message can justify a somewhat fuller reply.",
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
      relationshipOutputContract()
    ].join("\n");
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

  function buildWorkspacePrompt(workspaceContext, personRecord, myProfile, fixedTail, promptSettings, extraContext) {
    const settings = normalizePromptSettings(promptSettings || defaultPromptSettings());
    const profile = workspaceContext?.profile || workspaceContext?.person || {};
    const conversation = workspaceContext?.conversation || null;
    const recipientText = buildRecipientProfileMemory(profile, personRecord);
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
    const flowType = "relationship";
    const template = relationshipPromptTemplate();
    const pageContextText = compactProfile(workspaceContext || {}, [
      { label: "Page type", value: workspaceContext?.pageType },
      { label: "Page title", value: workspaceContext?.title },
      { label: "Page URL", value: workspaceContext?.pageUrl }
    ]);

    const prompt = template
      .replaceAll("{{recipient_full_name}}", profile.fullName || personRecord?.fullName || "Recipient")
      .replaceAll("{{recipient_profile}}", recipientText || "No recipient profile data available.")
      .replaceAll("{{sender_profile}}", myProfileText || "No saved sender profile available.")
      .replaceAll("{{fixed_tail}}", normalizeFixedTail(fixedTail || FIXED_TAIL))
      .replaceAll("{{page_context}}", pageContextText || "No page context available.")
      .replaceAll("{{working_definitions}}", relationshipPromptDefinitions())
      .replaceAll("{{current_objective}}", buildCurrentObjectiveText(personRecord, profile, logicMetrics))
      .replaceAll("{{conversation_context}}", formatConversationContext(conversation, ownFullName) || "No visible conversation context.")
      .replaceAll("{{relationship_memory}}", relationshipMemory || "No saved relationship memory.")
      .replaceAll("{{profile_change_summary}}", profileChangeSummary)
      .replaceAll("{{logic_metrics}}", formatLogicMetrics(logicMetrics))
      .replaceAll("{{person_note}}", personRecord?.personNote || "No saved person note.")
      .replaceAll("{{extra_context}}", normalizeWhitespace(extraContext) || "No additional user context for this draft.")
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
      "Do not use markdown fences.",
      "Do not add any text before or after the JSON."
    ].join("\n");
  }

  global.LinkedInAssistantPrompts = {
    DEFAULT_CHATGPT_PROJECT_URL,
    DEFAULT_GEMINI_URL,
    DEFAULT_LLM_ENTRY_URLS,
    DEFAULT_LLM_PROVIDER,
    FIXED_TAIL,
    MAX_MESSAGE_LENGTH,
    defaultLlmEntryUrl,
    defaultPromptSettings,
    isChatGptUrl,
    isGeminiUrl,
    normalizeFixedTail,
    normalizeLlmEntryUrl,
    normalizeLlmProvider,
    normalizePromptSettings,
    providerDisplayName,
    relationshipPromptTemplate,
    buildWorkspacePrompt,
    buildRetryPrompt,
    validateGenerationResult,
    validateWorkspaceResult
  };
})(globalThis);
