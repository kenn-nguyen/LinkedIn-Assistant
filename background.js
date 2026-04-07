importScripts("identity.js", "shared.js", "prompt.js");

const shared = globalThis.LinkedInAssistantShared;
const prompts = globalThis.LinkedInAssistantPrompts;
const {
  MESSAGE_TYPES,
  STORAGE_KEYS,
  buildFreshGenerationPersonRecord,
  buildLogicMetrics,
  buildRecipientProfileMemory,
  buildRelationshipTriage,
  defaultMyProfile,
  describeProfileChanges,
  extractOwnProfileName,
  getDashboardReview,
  getDraftWorkspace,
  getObservedConversation,
  getObservedMetrics,
  getProfileContext,
  isOpaqueLinkedInPersonId,
  linkedInProfileAlias,
  mergePersonRecord,
  normalizeConnectionStatus,
  normalizeConversationTimestamp,
  normalizeLinkedInProfileUrl,
  normalizeProfileData,
  normalizePersonRecord,
  normalizeUserGoal,
  normalizeUrl,
  normalizeWhitespace,
  serializeError,
  toIsoNow
} = shared;
const {
  DEFAULT_CHATGPT_PROJECT_URL,
  DEFAULT_LLM_PROVIDER,
  FIXED_TAIL,
  defaultLlmEntryUrl,
  buildRetryPrompt,
  buildWorkspacePrompt,
  isChatGptUrl,
  isGeminiUrl,
  normalizeFixedTail,
  normalizeLlmProvider,
  normalizePromptSettings,
  providerDisplayName,
  validateWorkspaceResult,
  defaultPromptSettings
} = prompts;

const MAX_RETRIES = 3;
const CHATGPT_SINGLE_WAIT_MS = 180000;
const CHATGPT_STALL_WAIT_MS = 45000;
const CHATGPT_TOTAL_WAIT_MS = 900000;
const PROVIDER_BACKGROUND_READ_MAX_WAIT_MS = 3000;
const PROVIDER_BACKGROUND_READ_STALL_MS = 2500;
const PROVIDER_BACKGROUND_POLL_DELAY_MS = 1200;
const PROVIDER_FOCUS_SETTLE_MS = 180;
const PROVIDER_CAPTURE_SETTLE_MS = 120;
const PROVIDER_POPUP_WIDTH = 10;
const PROVIDER_POPUP_HEIGHT = 10;
const PROVIDER_POPUP_MARGIN = 8;
const lastProviderTabIds = {
  chatgpt: null,
  gemini: null
};
const providerTabBindings = new Map();
const sourceTabProviderBindings = new Map();
const generationJobs = new Map();
const linkedInProfileResolutionInFlight = new Map();
let lastObservedLinkedInTabId = null;
let lastObservedLinkedInTabUrl = "";
let lastLinkedInClickTrace = {
  tabId: null,
  pageHrefBefore: "",
  clickHref: "",
  clickText: "",
  at: ""
};
let pendingLinkedInNavigation = {
  tabId: null,
  targetHref: "",
  startedAt: "",
  resolvedAt: "",
  lastSeenTabUrl: ""
};
const messagingReloadStateByTab = new Map();

function resetRuntimeCaches() {
  providerTabBindings.clear();
  sourceTabProviderBindings.clear();
  generationJobs.clear();
  linkedInProfileResolutionInFlight.clear();
  messagingReloadStateByTab.clear();
  setLastProviderTabId("chatgpt", null);
  setLastProviderTabId("gemini", null);
  lastObservedLinkedInTabId = null;
  lastObservedLinkedInTabUrl = "";
  lastLinkedInClickTrace = {
    tabId: null,
    pageHrefBefore: "",
    clickHref: "",
    clickText: "",
    at: ""
  };
  pendingLinkedInNavigation = {
    tabId: null,
    targetHref: "",
    startedAt: "",
    resolvedAt: "",
    lastSeenTabUrl: ""
  };
}

async function initializeStorageDefaults(resetAll) {
  if (resetAll) {
    await chrome.storage.local.clear();
  }
  const current = await chrome.storage.local.get([
    STORAGE_KEYS.fixedTail,
    STORAGE_KEYS.myProfile,
    STORAGE_KEYS.promptSettings,
    STORAGE_KEYS.chatGptProjectUrl,
    STORAGE_KEYS.people,
    STORAGE_KEYS.tabPersonBindings,
    STORAGE_KEYS.threadPersonBindings,
    STORAGE_KEYS.profileRedirects,
    STORAGE_KEYS.identityResolutionSeenOpaqueUrls
  ]);

  const nextState = {};
  if (!current[STORAGE_KEYS.fixedTail]) {
    nextState[STORAGE_KEYS.fixedTail] = FIXED_TAIL;
  } else {
    const normalizedFixedTail = normalizeFixedTail(current[STORAGE_KEYS.fixedTail]);
    if (normalizedFixedTail !== current[STORAGE_KEYS.fixedTail]) {
      nextState[STORAGE_KEYS.fixedTail] = normalizedFixedTail;
    }
  }
  if (!current[STORAGE_KEYS.myProfile]) {
    nextState[STORAGE_KEYS.myProfile] = defaultMyProfile();
  }
  if (!current[STORAGE_KEYS.promptSettings]) {
    nextState[STORAGE_KEYS.promptSettings] = defaultPromptSettings();
  }
  if (!current[STORAGE_KEYS.chatGptProjectUrl]) {
    nextState[STORAGE_KEYS.chatGptProjectUrl] = DEFAULT_CHATGPT_PROJECT_URL;
  }
  if (!current[STORAGE_KEYS.people]) {
    nextState[STORAGE_KEYS.people] = {};
  }
  if (!current[STORAGE_KEYS.tabPersonBindings]) {
    nextState[STORAGE_KEYS.tabPersonBindings] = {};
  }
  if (!current[STORAGE_KEYS.threadPersonBindings]) {
    nextState[STORAGE_KEYS.threadPersonBindings] = {};
  }
  if (!current[STORAGE_KEYS.profileRedirects]) {
    nextState[STORAGE_KEYS.profileRedirects] = {};
  }
  if (!current[STORAGE_KEYS.identityResolutionSeenOpaqueUrls]) {
    nextState[STORAGE_KEYS.identityResolutionSeenOpaqueUrls] = {};
  }
  if (Object.keys(nextState).length) {
    await chrome.storage.local.set(nextState);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.warn("Unable to set side panel behavior", error);
  }

  await initializeStorageDefaults(false);
});

chrome.action.onClicked.addListener(async ({ windowId }) => {
  try {
    await chrome.sidePanel.open({ windowId });
  } catch (error) {
    console.warn("Unable to open side panel", error);
  }
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function roundMs(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  return Math.max(0, Math.round(number));
}

function mergePageContextDebug(pageContext, extraDebug) {
  return {
    ...pageContext,
    debug: {
      ...(pageContext?.debug || {}),
      ...(extraDebug || {})
    }
  };
}

async function timedStep(timing, key, work) {
  const startedAt = Date.now();
  const result = await work();
  timing[key] = roundMs((timing[key] || 0) + (Date.now() - startedAt));
  return result;
}

function isLinkedInUrl(url) {
  return /^https:\/\/www\.linkedin\.com\//i.test(normalizeWhitespace(url || ""));
}

function isProviderUrl(provider, url) {
  const normalizedProvider = normalizeLlmProvider(provider);
  if (normalizedProvider === "gemini") {
    return isGeminiUrl(url);
  }
  return isChatGptUrl(url);
}

function inferProviderFromUrl(url) {
  if (isGeminiUrl(url)) {
    return "gemini";
  }
  if (isChatGptUrl(url)) {
    return "chatgpt";
  }
  return "";
}

function getLastProviderTabId(provider) {
  return lastProviderTabIds[normalizeLlmProvider(provider)] || null;
}

function setLastProviderTabId(provider, tabId) {
  const normalizedProvider = normalizeLlmProvider(provider);
  lastProviderTabIds[normalizedProvider] = typeof tabId === "number" ? tabId : null;
}

function rememberLinkedInTab(tabId, url) {
  if (typeof tabId !== "number" || !isLinkedInUrl(url)) {
    return;
  }
  lastObservedLinkedInTabId = tabId;
  lastObservedLinkedInTabUrl = normalizeWhitespace(url);
}

function isMessagingUrl(url) {
  return /^https:\/\/www\.linkedin\.com\/messaging\b/i.test(normalizeWhitespace(url || ""));
}

function isMessagingComposeUrl(url) {
  return /^https:\/\/www\.linkedin\.com\/messaging\/compose\b/i.test(normalizeWhitespace(url || ""));
}

function shouldAutoReloadMessagingUrl(url) {
  return isMessagingUrl(url) && !isMessagingComposeUrl(url);
}

function markMessagingReload(tabId, url) {
  if (typeof tabId !== "number") {
    return;
  }
  messagingReloadStateByTab.set(tabId, {
    url: normalizeWhitespace(url || ""),
    at: toIsoNow(),
    postReloadOverlayShown: false
  });
}

function clearMessagingReload(tabId) {
  if (typeof tabId !== "number") {
    return;
  }
  messagingReloadStateByTab.delete(tabId);
}

function getMessagingReloadState(tabId) {
  return typeof tabId === "number" ? messagingReloadStateByTab.get(tabId) || null : null;
}

async function showLinkedInPageActivityOverlay(tabId, title, message) {
  if (typeof tabId !== "number") {
    return;
  }
  await safeSendMessage(tabId, {
    type: MESSAGE_TYPES.SHOW_PAGE_ACTIVITY_OVERLAY,
    title,
    message,
    autoHideMs: 0
  });
}

async function hideLinkedInPageActivityOverlay(tabId) {
  if (typeof tabId !== "number") {
    return;
  }
  await safeSendMessage(tabId, {
    type: MESSAGE_TYPES.HIDE_PAGE_ACTIVITY_OVERLAY
  });
}

function rememberLinkedInClickTrace(tabId, pageHrefBefore, clickHref, clickText) {
  lastLinkedInClickTrace = {
    tabId: typeof tabId === "number" ? tabId : null,
    pageHrefBefore: normalizeWhitespace(pageHrefBefore || ""),
    clickHref: normalizeWhitespace(clickHref || ""),
    clickText: normalizeWhitespace(clickText || ""),
    at: toIsoNow()
  };
  if (typeof tabId === "number" && isLinkedInUrl(clickHref)) {
    rememberLinkedInTab(tabId, clickHref);
  }
}

async function trackPendingLinkedInNavigation(tabId, targetHref) {
  if (typeof tabId !== "number" || !isLinkedInUrl(targetHref)) {
    return;
  }
  const normalizedTargetHref = normalizeWhitespace(targetHref);
  pendingLinkedInNavigation = {
    tabId,
    targetHref: normalizedTargetHref,
    startedAt: toIsoNow(),
    resolvedAt: "",
    lastSeenTabUrl: ""
  };
  if (!shouldAutoReloadMessagingUrl(normalizedTargetHref)) {
    return;
  }
  await showLinkedInPageActivityOverlay(
    tabId,
    "Opening messages",
    "Refreshing soon…"
  );
  await delay(1000);
  if (pendingLinkedInNavigation.tabId !== tabId || pendingLinkedInNavigation.targetHref !== normalizedTargetHref) {
    await hideLinkedInPageActivityOverlay(tabId);
    return;
  }
  try {
    const tab = await chrome.tabs.get(tabId);
    const tabUrl = normalizeWhitespace(tab?.url || "");
    pendingLinkedInNavigation.lastSeenTabUrl = tabUrl;
    if (isLinkedInUrl(tabUrl)) {
      rememberLinkedInTab(tabId, tabUrl);
      notifyPageContextChanged(tabId, tabUrl);
    }
    const reloadState = getMessagingReloadState(tabId);
    const reloadUrl = shouldAutoReloadMessagingUrl(tabUrl) ? tabUrl : normalizedTargetHref;
    const alreadyReloadedForUrl = Boolean(
      reloadState && normalizeWhitespace(reloadState.url) === reloadUrl
    );
    if (!alreadyReloadedForUrl && shouldAutoReloadMessagingUrl(reloadUrl)) {
      await chrome.tabs.reload(tabId);
      markMessagingReload(tabId, reloadUrl);
    } else {
        await hideLinkedInPageActivityOverlay(tabId);
      }
    pendingLinkedInNavigation.resolvedAt = toIsoNow();
  } catch (_error) {
    await hideLinkedInPageActivityOverlay(tabId);
    return;
  }
}

function isMissingReceiverError(error) {
  const text = error?.message || String(error || "");
  return /receiving end does not exist|could not establish connection/i.test(text);
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tabs[0]) {
    rememberLinkedInTab(tabs[0].id, tabs[0].url);
    return tabs[0];
  }
  const fallbackTabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (fallbackTabs[0]) {
    rememberLinkedInTab(fallbackTabs[0].id, fallbackTabs[0].url);
  }
  return fallbackTabs[0] || null;
}

async function getTabForRequest(tabId) {
  if (typeof tabId === "number") {
    try {
      const tab = await chrome.tabs.get(tabId);
      rememberLinkedInTab(tab.id, tab.url);
      return tab;
    } catch (_error) {
      // Fall back to the current active tab.
    }
  }
  if (typeof lastObservedLinkedInTabId === "number") {
    try {
      const tab = await chrome.tabs.get(lastObservedLinkedInTabId);
      if (isLinkedInUrl(tab?.url)) {
        rememberLinkedInTab(tab.id, tab.url);
        return tab;
      }
    } catch (_error) {
      // Fall through to active tab resolution.
    }
  }
  return getActiveTab();
}

async function injectContentScriptsForTab(tab) {
  if (!tab?.id || !tab?.url) {
    throw new Error("Cannot inject content scripts without a valid tab.");
  }

  if (tab.url.startsWith("https://www.linkedin.com/")) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ["identity.js", "shared.js", "linkedin-commands.js", "linkedin-content.js"]
    });
    return;
  }

  if (isChatGptUrl(tab.url)) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["identity.js", "shared.js", "chatgpt-content.js"]
    });
    return;
  }

  if (isGeminiUrl(tab.url)) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["identity.js", "shared.js", "gemini-content.js"]
    });
    return;
  }

  throw new Error("No injectable content script is configured for this tab.");
}

async function safeSendMessage(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    if (isMissingReceiverError(error)) {
      try {
        const tab = await chrome.tabs.get(tabId);
        await injectContentScriptsForTab(tab);
        await delay(100);
        return await chrome.tabs.sendMessage(tabId, message);
      } catch (retryError) {
        return { ok: false, error: retryError.message || String(retryError) };
      }
    }
    return { ok: false, error: error.message || String(error) };
  }
}

async function injectLinkedInScriptsIntoFrames(tabId, frameIds) {
  const uniqueFrameIds = Array.from(new Set((Array.isArray(frameIds) ? frameIds : [])
    .map((frameId) => Number(frameId))
    .filter((frameId) => Number.isInteger(frameId) && frameId >= 0)));
  if (!uniqueFrameIds.length) {
    return;
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: uniqueFrameIds },
      files: ["identity.js", "shared.js", "linkedin-commands.js", "linkedin-content.js"]
    });
  } catch (_error) {
    // Some LinkedIn subframes may reject script injection. Ignore and keep trying other frames.
  }
}

function linkedInFrameDomProbe() {
  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const overlayRoot = document.querySelector(
    "[data-view-name='message-overlay-conversation-bubble-item'], [data-msg-overlay-conversation-bubble-open], .msg-overlay-conversation-bubble, .msg-overlay-bubble, .relative.display-flex.flex-column.flex-grow-1"
  );
  const contentWrapper = (overlayRoot || document).querySelector?.(".msg-overlay-conversation-bubble__content-wrapper")
    || document.querySelector(".msg-overlay-conversation-bubble__content-wrapper");
  const messageList = (contentWrapper || document).querySelector?.(".msg-s-message-list-content, .msg-s-message-list-container, .msg-s-message-list")
    || document.querySelector(".msg-s-message-list-content, .msg-s-message-list-container, .msg-s-message-list");
  const messageBubbles = Array.from((contentWrapper || messageList || document).querySelectorAll(".msg-s-event-listitem__message-bubble"));
  const messageBodies = Array.from((contentWrapper || messageList || document).querySelectorAll(".msg-s-event-listitem__body"));
  const composer = document.querySelector(".msg-form__contenteditable, .msg-form__msg-content-container");
  const messageText = normalize(
    (messageList?.innerText || messageList?.textContent || "")
    || messageBodies.map((node) => node.innerText || node.textContent || "").join("\n")
    || messageBubbles.map((node) => node.innerText || node.textContent || "").join("\n")
  );
  const eventCount = document.querySelectorAll("[data-event-urn], .msg-s-message-list__event, .msg-s-event-listitem").length;
  return {
    href: normalize(window.location.href),
    pathname: normalize(window.location.pathname),
    readyState: normalize(document.readyState),
    overlayPresent: Boolean(overlayRoot),
    contentWrapperPresent: Boolean(contentWrapper),
    messageListPresent: Boolean(messageList),
    messageBubbleCount: messageBubbles.length,
    messageBodyCount: messageBodies.length,
    composerPresent: Boolean(composer),
    eventCount,
    textLength: messageText.length,
    sampleText: messageText.slice(0, 240)
  };
}

async function getLinkedInFrameIds(tabId) {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    const unique = Array.from(new Set((Array.isArray(frames) ? frames : [])
      .map((frame) => Number(frame?.frameId))
      .filter((frameId) => Number.isInteger(frameId) && frameId >= 0)));
    if (!unique.length) {
      return [0];
    }
    return unique.sort((left, right) => {
      const leftPriority = left === 0 ? 1 : 0;
      const rightPriority = right === 0 ? 1 : 0;
      return leftPriority - rightPriority || left - right;
    });
  } catch (_error) {
    return [0];
  }
}

async function probeLinkedInFrame(tabId, frameId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: linkedInFrameDomProbe
    });
    return {
      frameId,
      ...(result?.result || {})
    };
  } catch (_error) {
    return {
      frameId,
      href: "",
      pathname: "",
      readyState: "",
      overlayPresent: false,
      messageListPresent: false,
      composerPresent: false,
      eventCount: 0,
      textLength: 0,
      sampleText: ""
    };
  }
}

function linkedInFrameProbeScore(probe) {
  if (!probe) {
    return -1;
  }
  let score = 0;
  if (probe.contentWrapperPresent) {
    score += 500;
  }
  if (probe.messageListPresent) {
    score += 1000;
  }
  if (probe.overlayPresent) {
    score += 250;
  }
  if (probe.composerPresent) {
    score += 80;
  }
  if (/\/preload\/?$/i.test(normalizeWhitespace(probe.pathname || ""))) {
    score += 180;
  }
  if (/^https:\/\/www\.linkedin\.com\/messaging\b/i.test(normalizeWhitespace(probe.href || ""))) {
    score += 120;
  }
  if (Number.isFinite(probe.eventCount) && probe.eventCount > 0) {
    score += Math.min(probe.eventCount, 40) * 20;
  }
  if (Number.isFinite(probe.messageBubbleCount) && probe.messageBubbleCount > 0) {
    score += Math.min(probe.messageBubbleCount, 40) * 15;
  }
  if (Number.isFinite(probe.messageBodyCount) && probe.messageBodyCount > 0) {
    score += Math.min(probe.messageBodyCount, 40) * 15;
  }
  if (Number.isFinite(probe.textLength) && probe.textLength > 0) {
    score += Math.min(probe.textLength, 500);
  }
  if (probe.readyState === "complete") {
    score += 15;
  }
  if (Number(probe.frameId) === 0) {
    score -= 25;
  }
  return score;
}

function frameProbeLooksMessagingReady(probe) {
  if (!probe) {
    return false;
  }
  if (!probe.contentWrapperPresent && !probe.messageListPresent) {
    return false;
  }
  return Number(probe.messageBubbleCount) > 0
    || Number(probe.messageBodyCount) > 0
    || Number(probe.eventCount) > 0
    || Number(probe.textLength) > 80;
}

async function probeLinkedInFrames(tabId) {
  const frameIds = await getLinkedInFrameIds(tabId);
  const probes = [];
  for (const frameId of frameIds) {
    probes.push(await probeLinkedInFrame(tabId, frameId));
  }
  return probes.sort((left, right) => linkedInFrameProbeScore(right) - linkedInFrameProbeScore(left));
}

async function waitForLinkedInMessagingFrame(tabId, timeoutMs) {
  const startedAt = Date.now();
  let latestProbes = [];
  const attempts = [];
  while (Date.now() - startedAt < timeoutMs) {
    latestProbes = await probeLinkedInFrames(tabId);
    attempts.push({
      elapsedMs: roundMs(Date.now() - startedAt),
      probes: latestProbes.slice(0, 5).map((probe) => ({
        frameId: probe.frameId,
        href: normalizeWhitespace(probe.href || ""),
        pathname: normalizeWhitespace(probe.pathname || ""),
        overlayPresent: Boolean(probe.overlayPresent),
        contentWrapperPresent: Boolean(probe.contentWrapperPresent),
        messageListPresent: Boolean(probe.messageListPresent),
        messageBubbleCount: Number(probe.messageBubbleCount) || 0,
        messageBodyCount: Number(probe.messageBodyCount) || 0,
        eventCount: Number(probe.eventCount) || 0,
        textLength: Number(probe.textLength) || 0,
        readyState: normalizeWhitespace(probe.readyState || "")
      }))
    });
    const readyProbe = latestProbes.find(frameProbeLooksMessagingReady);
    if (readyProbe) {
      return { probe: readyProbe, probes: latestProbes, attempts };
    }
    await delay(250);
  }
  latestProbes = await probeLinkedInFrames(tabId);
  return {
    probe: latestProbes.find(frameProbeLooksMessagingReady) || null,
    probes: latestProbes,
    attempts
  };
}

async function extractLinkedInMessagingWorkspaceFromFrame(tabId, frameId, fallbackPageUrl) {
  const response = await sendLinkedInMessageToFrame(tabId, frameId, {
    type: MESSAGE_TYPES.EXTRACT_OPEN_MESSAGE_BUBBLE_WORKSPACE
  });
  if (!response?.ok || response?.pageType !== "linkedin-messaging") {
    return null;
  }
  return {
    ...response,
    pageUrl: normalizeWhitespace(fallbackPageUrl || response?.pageUrl || ""),
    debug: {
      ...(response?.debug || {}),
      background_overlay_frame_extract_frame_id: frameId
    }
  };
}

function linkedInFrameResponseScore(response) {
  if (!response?.ok) {
    return -1;
  }
  const conversation = response?.conversation || {};
  const visibleMessageCount = Array.isArray(conversation?.allVisibleMessages)
    ? conversation.allVisibleMessages.length
    : Array.isArray(conversation?.recentMessages)
      ? conversation.recentMessages.length
      : 0;
  let score = 0;
  if (response.pageType === "linkedin-messaging") {
    score += 500;
  } else if (response.pageType === "linkedin-profile") {
    score += 100;
  }
  if (response.supported) {
    score += 100;
  }
  if (normalizeWhitespace(conversation?.threadUrl)) {
    score += 40;
  }
  if (visibleMessageCount > 0) {
    score += Math.min(visibleMessageCount, 20) * 5;
  }
  if (normalizeWhitespace(response?.person?.profileUrl || response?.profile?.profileUrl || "")) {
    score += 10;
  }
  return score;
}

async function sendLinkedInMessageToFrame(tabId, frameId, message) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, message, { frameId });
    return {
      ...(response || {}),
      _frameId: frameId
    };
  } catch (error) {
    if (!isMissingReceiverError(error)) {
      return null;
    }
  }

  await injectLinkedInScriptsIntoFrames(tabId, [frameId]);
  await delay(100);
  try {
    const response = await chrome.tabs.sendMessage(tabId, message, { frameId });
    return {
      ...(response || {}),
      _frameId: frameId
    };
  } catch (_error) {
    return null;
  }
}

async function sendLinkedInMessageToBestFrame(tabId, message) {
  const shouldProbeFrames = message?.type === MESSAGE_TYPES.GET_PAGE_CONTEXT
    || message?.type === MESSAGE_TYPES.EXTRACT_WORKSPACE_CONTEXT;
  const frameProbes = shouldProbeFrames ? await probeLinkedInFrames(tabId) : [];
  const probeOrderedFrameIds = frameProbes.map((probe) => probe.frameId);
  const fallbackFrameIds = await getLinkedInFrameIds(tabId);
  const frameIds = Array.from(new Set([
    ...probeOrderedFrameIds,
    ...fallbackFrameIds
  ]));
  const responses = [];
  for (const frameId of frameIds) {
    const response = await sendLinkedInMessageToFrame(tabId, frameId, message);
    if (response) {
      responses.push(response);
    }
  }
  if (!responses.length) {
    return null;
  }
  const best = responses
    .slice()
    .sort((left, right) => linkedInFrameResponseScore(right) - linkedInFrameResponseScore(left))[0];
  return best || null;
}

async function safeSendLinkedInMessage(tabId, message) {
  let response = await sendLinkedInMessageToBestFrame(tabId, message);
  if (response) {
    return response;
  }
  try {
    const tab = await chrome.tabs.get(tabId);
    await injectContentScriptsForTab(tab);
    await delay(100);
    response = await sendLinkedInMessageToBestFrame(tabId, message);
    if (response) {
      return response;
    }
    return { ok: false, error: "No LinkedIn content script receiver was available in this tab." };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
}

async function waitForTabComplete(tabId, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") {
      return tab;
    }
    await delay(300);
  }
  return chrome.tabs.get(tabId);
}

async function getProviderPopupBounds() {
  try {
    const lastFocused = await chrome.windows.getLastFocused();
    const baseLeft = Number.isFinite(lastFocused?.left) ? lastFocused.left : 0;
    const baseTop = Number.isFinite(lastFocused?.top) ? lastFocused.top : 0;
    const baseWidth = Number.isFinite(lastFocused?.width) ? lastFocused.width : null;
    const popupWidth = PROVIDER_POPUP_WIDTH;
    const popupHeight = PROVIDER_POPUP_HEIGHT;
    const left = baseWidth && baseWidth > popupWidth + (PROVIDER_POPUP_MARGIN * 2)
      ? Math.max(0, baseLeft + baseWidth - popupWidth - PROVIDER_POPUP_MARGIN)
      : Math.max(0, baseLeft + PROVIDER_POPUP_MARGIN);
    const top = Math.max(0, baseTop + PROVIDER_POPUP_MARGIN);
    return {
      width: popupWidth,
      height: popupHeight,
      left,
      top
    };
  } catch (_error) {
    return {
      width: PROVIDER_POPUP_WIDTH,
      height: PROVIDER_POPUP_HEIGHT
    };
  }
}

async function createIsolatedProviderTab(provider, desiredUrl) {
  const normalizedProvider = normalizeLlmProvider(provider);
  const providerName = providerDisplayName(normalizedProvider);
  const popupBounds = await getProviderPopupBounds();
  const createdWindow = await chrome.windows.create({
    url: desiredUrl,
    focused: false,
    type: "popup",
    width: popupBounds.width,
    height: popupBounds.height,
    left: popupBounds.left,
    top: popupBounds.top
  });
  const tab = createdWindow?.tabs?.[0];
  if (!tab?.id) {
    throw new Error(`Unable to open ${providerName}.`);
  }
  setLastProviderTabId(normalizedProvider, tab.id);
  try {
    await chrome.tabs.update(tab.id, { autoDiscardable: false, active: true });
  } catch (error) {
    console.warn(`Unable to configure isolated ${providerName} tab`, error);
  }
  await waitForTabComplete(tab.id, 20000);
  return tab;
}

async function readResolvedLinkedInProfileUrlFromTab(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const canonicalHref = document.querySelector('link[rel="canonical"]')?.href || "";
        const ogUrl = document.querySelector('meta[property="og:url"]')?.content || "";
        return {
          href: window.location.href,
          canonicalHref,
          ogUrl
        };
      }
    });
    return result?.result || null;
  } catch (_error) {
    return null;
  }
}

function linkedInProfileSlug(url) {
  const normalized = normalizeLinkedInProfileUrl(url);
  if (!normalized) {
    return "";
  }
  try {
    const parsed = new URL(normalized);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const profileIndex = parts.indexOf("in");
    return profileIndex >= 0 && parts[profileIndex + 1] ? parts[profileIndex + 1] : "";
  } catch (_error) {
    return "";
  }
}

function shouldResolveLinkedInProfileUrl(url) {
  const slug = linkedInProfileSlug(url);
  if (!slug) {
    return false;
  }
  return /^ACo/i.test(slug)
    || /[A-Z]/.test(slug)
    || (!slug.includes("-") && slug.length > 20);
}

async function resolveLinkedInProfileUrl(rawUrl, stored) {
  return resolveLinkedInProfileUrlWithOptions(rawUrl, stored, {});
}

async function resolveLinkedInProfileUrlViaHiddenTab(rawUrl) {
  const normalized = normalizeLinkedInProfileUrl(rawUrl);
  if (!normalized) {
    return "";
  }
  if (linkedInProfileResolutionInFlight.has(normalized)) {
    return linkedInProfileResolutionInFlight.get(normalized);
  }
  const resolutionPromise = (async () => {
  try {
    const tab = await chrome.tabs.create({
      url: normalized,
      active: false
    });
    try {
      await waitForTabComplete(tab.id, 12000);
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await delay(attempt === 0 ? 300 : 600);
        const details = await readResolvedLinkedInProfileUrlFromTab(tab.id);
        const candidates = [
          normalizeLinkedInProfileUrl(details?.canonicalHref),
          normalizeLinkedInProfileUrl(details?.ogUrl),
          normalizeLinkedInProfileUrl(details?.href)
        ].filter(Boolean);
        const publicCandidate = candidates.find((value) => !shouldResolveLinkedInProfileUrl(value));
        if (publicCandidate) {
          return publicCandidate;
        }
      }
      const finalTab = await chrome.tabs.get(tab.id);
      return normalizeLinkedInProfileUrl(finalTab?.url || normalized) || normalized;
    } finally {
      await chrome.tabs.remove(tab.id).catch(() => {});
    }
  } catch (_error) {
    return normalized;
  }
  })();
  linkedInProfileResolutionInFlight.set(normalized, resolutionPromise);
  try {
    return await resolutionPromise;
  } finally {
    linkedInProfileResolutionInFlight.delete(normalized);
  }
}

async function resolveLinkedInProfileUrlWithOptions(rawUrl, stored, options) {
  const normalized = normalizeLinkedInProfileUrl(rawUrl);
  if (!normalized) {
    return { resolvedUrl: "", stored };
  }

  const cached = normalizeLinkedInProfileUrl(stored?.profileRedirects?.[normalized]);
  if (cached && !options?.forceRefresh) {
    return { resolvedUrl: cached, stored };
  }

  if (!shouldResolveLinkedInProfileUrl(normalized)) {
    const nextRedirects = {
      ...(stored?.profileRedirects || {}),
      [normalized]: normalized
    };
    await chrome.storage.local.set({ [STORAGE_KEYS.profileRedirects]: nextRedirects });
    return {
      resolvedUrl: normalized,
      stored: {
        ...stored,
        profileRedirects: nextRedirects
      }
    };
  }

  if (!options?.allowHiddenTabResolution) {
    return { resolvedUrl: cached || normalized, stored };
  }

  const resolvedUrl = await resolveLinkedInProfileUrlViaHiddenTab(normalized);

  const nextRedirects = {
    ...(stored?.profileRedirects || {}),
    [normalized]: resolvedUrl || normalized
  };
  if (resolvedUrl) {
    nextRedirects[resolvedUrl] = resolvedUrl;
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.profileRedirects]: nextRedirects });
  return {
    resolvedUrl: resolvedUrl || normalized,
    stored: {
      ...stored,
      profileRedirects: nextRedirects
    }
  };
}

function buildIdentityResolutionRequest(pageContext, stored) {
  const profileUrl = normalizeLinkedInProfileUrl(pageContext?.person?.profileUrl || pageContext?.profile?.profileUrl);
  if (!profileUrl || !shouldResolveLinkedInProfileUrl(profileUrl) || pageContext?.pageType !== "linkedin-messaging") {
    return null;
  }
  const knownPersonId = normalizeWhitespace(pageContext?.person?.personId);
  if (knownPersonId && stored?.people?.[knownPersonId]) {
    return null;
  }
  const knownThreadUrl = normalizeUrl(pageContext?.conversation?.threadUrl || pageContext?.person?.messagingThreadUrl);
  if (knownThreadUrl) {
    const boundPersonId = normalizeWhitespace(stored?.threadPersonBindings?.[knownThreadUrl]);
    if (boundPersonId && stored?.people?.[boundPersonId]) {
      return null;
    }
  }
  const cached = normalizeLinkedInProfileUrl(stored?.profileRedirects?.[profileUrl]);
  if (cached && !shouldResolveLinkedInProfileUrl(cached)) {
    return null;
  }
  if (stored?.identityResolutionSeenOpaqueUrls?.[profileUrl]) {
    return null;
  }
  return {
    requestKey: `resolve:${linkedInProfileAlias(profileUrl)}`,
    profileUrl,
    mode: "resolve_identity",
    message: "Allow one quick background check to link this thread."
  };
}

async function markIdentityResolutionPromptSeen(profileUrl, stored) {
  const normalized = normalizeLinkedInProfileUrl(profileUrl);
  if (!normalized) {
    return stored;
  }
  const existing = stored?.identityResolutionSeenOpaqueUrls || {};
  if (existing[normalized]) {
    return stored;
  }
  const nextSeen = {
    ...existing,
    [normalized]: toIsoNow()
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.identityResolutionSeenOpaqueUrls]: nextSeen });
  return {
    ...stored,
    identityResolutionSeenOpaqueUrls: nextSeen
  };
}

function buildMergeConfirmationResolutionRequest(pageContext, stored, identityWarning) {
  const profileUrl = normalizeLinkedInProfileUrl(pageContext?.person?.profileUrl || pageContext?.profile?.profileUrl);
  if (!profileUrl || !shouldResolveLinkedInProfileUrl(profileUrl) || pageContext?.pageType !== "linkedin-messaging") {
    return null;
  }
  const candidateIds = Array.from(new Set([
    normalizeWhitespace(identityWarning?.candidatePersonId),
    ...(Array.isArray(identityWarning?.candidatePersonIds) ? identityWarning.candidatePersonIds.map((value) => normalizeWhitespace(value)) : [])
  ].filter(Boolean)));
  if (!candidateIds.length) {
    return null;
  }
  const candidateRecords = candidateIds
    .map((personId) => stored?.people?.[personId])
    .filter(Boolean);
  const candidateLabels = candidateRecords
    .map((record) => normalizeWhitespace(record.fullName || publicProfileUrl(record) || primaryLinkedInMemberUrl(record)))
    .filter(Boolean);
  return {
    requestKey: `merge:${linkedInProfileAlias(profileUrl)}:${candidateIds.join(",")}`,
    profileUrl,
    mode: "merge_confirmation",
    candidatePersonIds: candidateIds,
    message: candidateLabels.length === 1
      ? `Possible match: ${candidateLabels[0]}. Check once before merging?`
      : "Possible match found. Check once before merging?"
  };
}

async function canonicalizePageContextIdentity(pageContext, stored, options) {
  const profileUrl = normalizeLinkedInProfileUrl(pageContext?.person?.profileUrl || pageContext?.profile?.profileUrl);
  if (!profileUrl) {
    return { pageContext, stored, identityResolutionRequest: null };
  }
  const mergeResolutionRequest = buildMergeConfirmationResolutionRequest(
    pageContext,
    stored,
    resolveStoredPersonMatch(pageContext, stored)?.identityWarning
  );
  const mergeLookupRequiresExplicitApproval = Boolean(mergeResolutionRequest && !options?.allowMergeConfirmationLookup);
  const allowHiddenTabResolution = mergeLookupRequiresExplicitApproval
    ? Boolean(options?.allowHiddenTabResolution)
    : Boolean(options?.allowHiddenTabResolution);
  const forceRefresh = Boolean(options?.forceHiddenTabResolution);

  const secondaryAlias = linkedInProfileAlias(profileUrl);
  const withSecondaryAlias = {
    ...pageContext,
    person: pageContext?.person
      ? {
        ...pageContext.person,
        primaryLinkedInMemberUrl: shouldResolveLinkedInProfileUrl(profileUrl)
          ? profileUrl
          : normalizeLinkedInProfileUrl(pageContext.person.primaryLinkedInMemberUrl),
        identityAliases: Array.from(new Set([
          ...(Array.isArray(pageContext.person.identityAliases) ? pageContext.person.identityAliases : []),
          secondaryAlias
        ].filter(Boolean)))
      }
      : pageContext?.person
  };

  if (pageContext?.pageType === "linkedin-messaging" && shouldResolveLinkedInProfileUrl(profileUrl)) {
    const secondaryMatch = Object.values(stored?.people || {}).find((record) => hasMatchingIdentityAlias(record, {
      profileUrl,
      personId: pageContext?.person?.personId,
      identity: { aliases: [secondaryAlias] }
    }));
    if (secondaryMatch) {
      const hasKnownPublicProfile = Boolean(publicProfileUrl(secondaryMatch))
        || Boolean(
          normalizeLinkedInProfileUrl(stored?.profileRedirects?.[profileUrl])
          && !shouldResolveLinkedInProfileUrl(normalizeLinkedInProfileUrl(stored?.profileRedirects?.[profileUrl]))
        );
      return {
        pageContext: withSecondaryAlias,
        stored,
        identityResolutionRequest: hasKnownPublicProfile ? null : (mergeResolutionRequest || buildIdentityResolutionRequest(withSecondaryAlias, stored))
      };
    }
  }

  const identityResolutionRequest = mergeResolutionRequest || buildIdentityResolutionRequest(withSecondaryAlias, stored);
  const { resolvedUrl, stored: nextStored } = await resolveLinkedInProfileUrlWithOptions(profileUrl, stored, {
    allowHiddenTabResolution,
    forceRefresh
  });
  if (!resolvedUrl || resolvedUrl === profileUrl) {
    return {
      pageContext: withSecondaryAlias,
      stored: nextStored,
      identityResolutionRequest: allowHiddenTabResolution ? null : identityResolutionRequest
    };
  }

  const nextPerson = pageContext?.person
    ? {
      ...withSecondaryAlias.person,
      profileUrl: resolvedUrl,
      publicProfileUrl: resolvedUrl,
      personId: shared.personIdFromProfileUrl(withSecondaryAlias.person?.primaryLinkedInMemberUrl || profileUrl, pageContext.person.fullName),
      identityAliases: Array.from(new Set([
        ...(Array.isArray(withSecondaryAlias.person?.identityAliases) ? withSecondaryAlias.person.identityAliases : []),
        linkedInProfileAlias(resolvedUrl)
      ].filter(Boolean)))
    }
    : pageContext?.person;
  const nextProfile = pageContext?.profile
    ? {
      ...pageContext.profile,
      profileUrl: resolvedUrl
    }
    : pageContext?.profile;

  return {
    stored: nextStored,
    pageContext: {
      ...withSecondaryAlias,
      person: nextPerson,
      profile: nextProfile
    },
    identityResolutionRequest: null
  };
}

async function getPageContext(sourceTabId) {
  const requestStartedAt = Date.now();
  const targetTab = await getTabForRequest(sourceTabId);
  if (!targetTab?.id || !targetTab.url) {
    return {
      supported: false,
      pageType: "unsupported",
      reason: "No active tab.",
      tabId: null
    };
  }

  if (!targetTab.url.startsWith("https://www.linkedin.com/")) {
    return {
      supported: false,
      pageType: "unsupported",
      reason: "Open a LinkedIn profile or messaging thread to use the extension.",
      tabId: targetTab.id
    };
  }

  const pendingMessagingTarget = pendingLinkedInNavigation?.tabId === targetTab.id
    ? normalizeWhitespace(pendingLinkedInNavigation?.targetHref || "")
    : "";
  const inferredLinkedInPageType = /^https:\/\/www\.linkedin\.com\/messaging\b/i.test(targetTab.url)
    || /^https:\/\/www\.linkedin\.com\/messaging\b/i.test(pendingMessagingTarget)
    ? "linkedin-messaging"
    : /^https:\/\/www\.linkedin\.com\/in\/[^/]+(?:\/.*)?$/i.test(targetTab.url)
      ? "linkedin-profile"
      : "unsupported";

  const maxAttempts = inferredLinkedInPageType === "linkedin-messaging"
    ? 6
    : inferredLinkedInPageType === "linkedin-profile"
      ? 2
      : 3;
  const requestDebug = {
    background_page_context_ms: 0,
    background_page_context_attempts_planned: maxAttempts,
    background_page_context_attempts_completed: 0,
    background_page_context_send_ms: 0,
    background_page_context_retry_wait_ms: 0,
    background_page_context_inferred_type: inferredLinkedInPageType,
    background_page_context_target_tab_id: targetTab.id,
    background_page_context_target_tab_url: normalizeWhitespace(targetTab.url || ""),
    background_page_context_pending_target_href: pendingMessagingTarget,
    background_page_context_last_response_page_type: "",
    background_page_context_last_response_supported: false,
    background_page_context_last_response_reason: "",
    background_page_context_last_response_page_url: "",
    background_page_context_frame_probes: []
  };
  let lastResponse = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    requestDebug.background_page_context_attempts_completed = attempt;
    const frameProbes = await probeLinkedInFrames(targetTab.id);
    requestDebug.background_page_context_frame_probes = frameProbes.slice(0, 5).map((probe) => ({
      frameId: probe.frameId,
      href: normalizeWhitespace(probe.href || ""),
      pathname: normalizeWhitespace(probe.pathname || ""),
      overlayPresent: Boolean(probe.overlayPresent),
      messageListPresent: Boolean(probe.messageListPresent),
      composerPresent: Boolean(probe.composerPresent),
      eventCount: Number(probe.eventCount) || 0,
      textLength: Number(probe.textLength) || 0
    }));
    const sendStartedAt = Date.now();
    const response = await safeSendLinkedInMessage(targetTab.id, { type: MESSAGE_TYPES.GET_PAGE_CONTEXT });
    requestDebug.background_page_context_send_ms += roundMs(Date.now() - sendStartedAt);
    lastResponse = response;
    requestDebug.background_page_context_last_response_page_type = normalizeWhitespace(response?.pageType || "");
    requestDebug.background_page_context_last_response_supported = Boolean(response?.supported);
    requestDebug.background_page_context_last_response_reason = normalizeWhitespace(response?.reason || response?.error || "");
    requestDebug.background_page_context_last_response_page_url = normalizeWhitespace(response?.pageUrl || "");
    requestDebug.background_page_context_last_response_frame_id = Number.isInteger(response?._frameId) ? response._frameId : null;
    if (response?.ok) {
      const responsePageType = response.pageType === "linkedin-messaging" || response.pageType === "linkedin-profile"
        ? response.pageType
        : inferredLinkedInPageType;
      if (responsePageType === "linkedin-messaging" && !response.supported) {
        lastResponse = {
          ...response,
          pageType: "linkedin-messaging",
          reason: response.reason || "Loading selected conversation...",
          pageUrl: response.pageUrl || targetTab.url
        };
      } else if (responsePageType === "linkedin-profile" && !response.supported) {
        lastResponse = {
          ...response,
          pageType: "linkedin-profile",
          reason: response.reason || "Loading profile...",
          pageUrl: response.pageUrl || targetTab.url
        };
      }
      const looksReady = response.supported
        || (
          responsePageType === "linkedin-messaging"
            ? !/loading selected conversation/i.test(response.reason || "")
            : responsePageType === "linkedin-profile"
              ? !/loading profile/i.test(response.reason || "")
              : true
        );
      if (looksReady) {
        const resolvedPageUrl = isLinkedInUrl(lastResponse?.pageUrl)
          ? lastResponse.pageUrl
          : (responsePageType === "linkedin-messaging" ? pendingMessagingTarget || targetTab.url : targetTab.url);
        return mergePageContextDebug({
          ...lastResponse,
          pageUrl: resolvedPageUrl,
          tabId: targetTab.id
        }, {
          ...requestDebug,
          background_page_context_ms: roundMs(Date.now() - requestStartedAt)
        });
      }
    }

    if (attempt < maxAttempts) {
      const waitStartedAt = Date.now();
      await delay(inferredLinkedInPageType === "linkedin-profile" ? 180 * attempt : 350 * attempt);
      requestDebug.background_page_context_retry_wait_ms += roundMs(Date.now() - waitStartedAt);
    }
  }

  if (!lastResponse?.ok) {
    return mergePageContextDebug({
      supported: false,
      pageType: inferredLinkedInPageType,
      reason: inferredLinkedInPageType === "linkedin-messaging"
        ? "Loading selected conversation..."
        : inferredLinkedInPageType === "linkedin-profile"
          ? "Loading profile..."
        : lastResponse?.error || "Unable to inspect the current page.",
      pageUrl: targetTab.url,
      tabId: targetTab.id
    }, {
      ...requestDebug,
      background_page_context_ms: roundMs(Date.now() - requestStartedAt)
    });
  }

  return mergePageContextDebug({
    ...lastResponse,
    pageType: inferredLinkedInPageType === "linkedin-messaging" && !lastResponse?.supported
      ? "linkedin-messaging"
      : inferredLinkedInPageType === "linkedin-profile" && !lastResponse?.supported
        ? "linkedin-profile"
        : lastResponse?.pageType,
    reason: inferredLinkedInPageType === "linkedin-messaging" && !lastResponse?.supported
      ? lastResponse?.reason || "Loading selected conversation..."
      : inferredLinkedInPageType === "linkedin-profile" && !lastResponse?.supported
      ? lastResponse?.reason || "Loading profile..."
      : lastResponse?.reason,
    tabId: targetTab.id
  }, {
    ...requestDebug,
    background_page_context_ms: roundMs(Date.now() - requestStartedAt)
  });
}

async function extractLinkedInWorkspaceContext(sourceTabId, options) {
  const startedAt = Date.now();
  const targetTab = await getTabForRequest(sourceTabId);
  if (!targetTab?.id) {
    throw new Error("No active LinkedIn tab found.");
  }

  const request = {
    type: MESSAGE_TYPES.EXTRACT_WORKSPACE_CONTEXT,
    forceScrollPass: Boolean(options?.forceScrollPass)
  };
  const response = options?.frameId === 0
    ? await sendLinkedInMessageToFrame(targetTab.id, 0, request)
    : await safeSendLinkedInMessage(targetTab.id, request);
  if (!response?.ok) {
    throw new Error(response?.error || "Unable to extract LinkedIn context.");
  }

  return {
    ...response,
    pageUrl: isLinkedInUrl(response?.pageUrl)
      ? response.pageUrl
      : normalizeWhitespace(targetTab.url || ""),
    debug: {
      ...(response?.debug || {}),
      background_extract_workspace_frame_id: Number.isInteger(response?._frameId) ? response._frameId : null,
      background_extract_workspace_ms: roundMs(Date.now() - startedAt)
    },
    tabId: targetTab.id
  };
}

async function ensureProviderTab(provider, targetUrl, options) {
  const normalizedProvider = normalizeLlmProvider(provider);
  const providerName = providerDisplayName(normalizedProvider);
  const desiredUrl = normalizeUrl(targetUrl || defaultLlmEntryUrl(normalizedProvider)) || defaultLlmEntryUrl(normalizedProvider);
  const isTemporarySession = normalizedProvider === "chatgpt" && /[?&]temporary-chat=true\b/i.test(desiredUrl);
  const preferFreshTab = Boolean(options?.preferFreshTab);

  if (preferFreshTab) {
    return createIsolatedProviderTab(normalizedProvider, desiredUrl);
  }

  if (isTemporarySession) {
    return createIsolatedProviderTab(normalizedProvider, desiredUrl);
  }

  const openTabs = await chrome.tabs.query({ currentWindow: true });
  const exactMatch = openTabs.find((tab) => normalizeUrl(tab.url) === desiredUrl);

  if (exactMatch?.id) {
    setLastProviderTabId(normalizedProvider, exactMatch.id);
    await waitForTabComplete(exactMatch.id, 20000);
    return exactMatch;
  }

  const lastProviderTabId = getLastProviderTabId(normalizedProvider);
  if (lastProviderTabId) {
    try {
      const existing = await chrome.tabs.get(lastProviderTabId);
      if (existing?.id && isProviderUrl(normalizedProvider, existing.url)) {
        const updated = await chrome.tabs.update(existing.id, { url: desiredUrl, active: false });
        await waitForTabComplete(updated.id, 20000);
        return updated;
      }
    } catch (_error) {
      setLastProviderTabId(normalizedProvider, null);
    }
  }

  const tab = await chrome.tabs.create({ url: desiredUrl, active: false });
  if (!tab?.id) {
    throw new Error(`Unable to open ${providerName}.`);
  }
  setLastProviderTabId(normalizedProvider, tab.id);
  try {
    await chrome.tabs.update(tab.id, { autoDiscardable: false });
  } catch (error) {
    console.warn(`Unable to disable auto-discard for ${providerName} tab`, error);
  }
  await waitForTabComplete(tab.id, 20000);
  return tab;
}

async function getPreferredProviderTab(provider) {
  const normalizedProvider = normalizeLlmProvider(provider);
  const activeTab = await getActiveTab();
  if (activeTab?.id && isProviderUrl(normalizedProvider, activeTab.url)) {
    setLastProviderTabId(normalizedProvider, activeTab.id);
    return activeTab;
  }

  const lastProviderTabId = getLastProviderTabId(normalizedProvider);
  if (lastProviderTabId) {
    try {
      const tab = await chrome.tabs.get(lastProviderTabId);
      if (tab?.id && isProviderUrl(normalizedProvider, tab.url)) {
        return tab;
      }
    } catch (_error) {
      setLastProviderTabId(normalizedProvider, null);
    }
  }

  const providerTabs = await chrome.tabs.query({ currentWindow: true });
  const candidate = providerTabs.find((tab) => isProviderUrl(normalizedProvider, tab.url)) || null;
  if (candidate?.id) {
    setLastProviderTabId(normalizedProvider, candidate.id);
  }
  return candidate;
}

function bindProviderTabToPerson(providerTabId, payload) {
  if (!providerTabId) {
    return;
  }
  const binding = {
    provider: normalizeLlmProvider(payload?.provider),
    personId: normalizeWhitespace(payload?.personId),
    fullName: normalizeWhitespace(payload?.fullName),
    requestId: normalizeWhitespace(payload?.requestId),
    sourceTabId: typeof payload?.sourceTabId === "number" ? payload.sourceTabId : null,
    boundAt: toIsoNow()
  };
  providerTabBindings.set(providerTabId, binding);
  if (typeof binding.sourceTabId === "number") {
    sourceTabProviderBindings.set(`${binding.provider}:${binding.sourceTabId}`, {
      ...binding,
      providerTabId
    });
  }
}

function updateGenerationJobState(requestId, patch) {
  const normalizedRequestId = normalizeWhitespace(requestId);
  if (!normalizedRequestId || !generationJobs.has(normalizedRequestId)) {
    return;
  }
  const current = generationJobs.get(normalizedRequestId) || {};
  generationJobs.set(normalizedRequestId, {
    ...current,
    ...(patch || {}),
    requestId: normalizedRequestId
  });
}

function generationJobsSnapshot() {
  return Array.from(generationJobs.values()).map((job) => ({
    requestId: normalizeWhitespace(job?.requestId),
    personId: normalizeWhitespace(job?.personId),
    sourceTabId: typeof job?.sourceTabId === "number" ? job.sourceTabId : null,
    provider: normalizeLlmProvider(job?.provider || DEFAULT_LLM_PROVIDER),
    status: normalizeWhitespace(job?.status || "running"),
    progressText: normalizeWhitespace(job?.progressText),
    providerPrompt: typeof job?.providerPrompt === "string" ? job.providerPrompt : "",
    progressPercent: Number.isFinite(Number(job?.progressPercent)) ? Number(job.progressPercent) : 0,
    outputChars: Number.isFinite(Number(job?.outputChars)) ? Number(job.outputChars) : 0,
    startedAt: normalizeWhitespace(job?.startedAt),
    updatedAt: normalizeWhitespace(job?.updatedAt)
  }));
}

function getProviderTabBinding(provider, options) {
  const normalizedProvider = normalizeLlmProvider(provider);
  const normalizedPersonId = normalizeWhitespace(options?.personId);
  const normalizedRequestId = normalizeWhitespace(options?.requestId);
  const sourceTabId = typeof options?.sourceTabId === "number" ? options.sourceTabId : null;
  if (sourceTabId !== null) {
    const directBinding = sourceTabProviderBindings.get(`${normalizedProvider}:${sourceTabId}`) || null;
    if (directBinding?.providerTabId) {
      return { tabId: directBinding.providerTabId, ...directBinding };
    }
  }
  const bindings = [];
  for (const [tabId, binding] of providerTabBindings.entries()) {
    if (binding?.provider !== normalizedProvider) {
      continue;
    }
    bindings.push({ tabId, ...binding });
  }

  if (sourceTabId !== null) {
    const sourceMatch = bindings.find((binding) => binding.sourceTabId === sourceTabId);
    if (sourceMatch) {
      return sourceMatch;
    }
  }
  if (normalizedRequestId) {
    const requestMatch = bindings.find((binding) => normalizeWhitespace(binding.requestId) === normalizedRequestId);
    if (requestMatch) {
      return requestMatch;
    }
  }
  if (normalizedPersonId) {
    const personMatch = bindings.find((binding) => normalizeWhitespace(binding.personId) === normalizedPersonId);
    if (personMatch) {
      return personMatch;
    }
  }
  return null;
}

async function brieflyActivateProviderTab(provider, providerTabId, previousTabId) {
  if (!providerTabId) {
    return;
  }

  const restoreTabId = await activateProviderTab(provider, providerTabId, previousTabId);
  if (!restoreTabId && restoreTabId !== null) {
    return;
  }

  try {
    await delay(1800);
  } catch (error) {
    console.warn(`Unable to briefly activate ${providerDisplayName(provider)} tab`, error);
  } finally {
    await restoreActiveTab(restoreTabId);
  }
}

async function activateProviderTab(provider, providerTabId, previousTabId) {
  if (!providerTabId) {
    return null;
  }

  const currentActive = await getActiveTab().catch(() => null);
  const restoreTabId = currentActive?.id || previousTabId || null;

  try {
    const providerTab = await chrome.tabs.get(providerTabId);
    if (providerTab?.windowId) {
      await chrome.windows.update(providerTab.windowId, { focused: true });
    }
    await chrome.tabs.update(providerTabId, { active: true });
    await delay(PROVIDER_FOCUS_SETTLE_MS);
    return restoreTabId;
  } catch (error) {
    console.warn(`Unable to activate ${providerDisplayName(provider)} tab`, error);
    return null;
  }
}

async function restoreActiveTab(tabId) {
  if (!tabId) {
    return;
  }

  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab?.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    await chrome.tabs.update(tabId, { active: true });
  } catch (error) {
    console.warn("Unable to restore previous active tab", error);
  }
}

async function sendGenerationProgress(requestId, sourceTabId, text, meta) {
  if (!requestId || !normalizeWhitespace(text)) {
    return;
  }
  const normalizedPersonId = normalizeWhitespace(meta?.personId);
  const providerPrompt = typeof meta?.providerPrompt === "string" ? meta.providerPrompt : "";
  const progressPercent = Number.isFinite(Number(meta?.progressPercent)) ? Number(meta.progressPercent) : 0;
  const outputChars = Number.isFinite(Number(meta?.outputChars)) ? Number(meta.outputChars) : 0;
  updateGenerationJobState(requestId, {
    personId: normalizedPersonId || generationJobs.get(requestId)?.personId || "",
    provider: normalizeLlmProvider(meta?.provider || generationJobs.get(requestId)?.provider || DEFAULT_LLM_PROVIDER),
    status: normalizeWhitespace(meta?.status || "running") || "running",
    progressText: normalizeWhitespace(text),
    providerPrompt: providerPrompt || generationJobs.get(requestId)?.providerPrompt || "",
    progressPercent,
    outputChars,
    updatedAt: toIsoNow()
  });
  try {
    await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.GENERATION_PROGRESS,
      requestId,
      sourceTabId: typeof sourceTabId === "number" ? sourceTabId : null,
      personId: normalizedPersonId,
      provider: normalizeLlmProvider(meta?.provider || DEFAULT_LLM_PROVIDER),
      status: normalizeWhitespace(meta?.status || "running") || "running",
      progressPercent,
      outputChars,
      text: normalizeWhitespace(text),
      providerPrompt
    });
  } catch (_error) {
    // Ignore when the side panel is closed or no listener is attached.
  }
}

async function sendGenerationLifecycleMessage(type, payload) {
  try {
    await chrome.runtime.sendMessage({
      type,
      ...(payload || {})
    });
  } catch (_error) {
    // Ignore when no listener is attached.
  }
}

async function sendPromptToProviderTab(provider, providerTabId, type, prompt, previousTabId) {
  try {
    let response = await safeSendMessage(providerTabId, { type, prompt });
    if (response?.ok) {
      return response;
    }
    await delay(800);
    response = await safeSendMessage(providerTabId, { type, prompt });
    return response;
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

async function readProviderTabState(provider, providerTabId) {
  const response = await safeSendMessage(providerTabId, { type: MESSAGE_TYPES.GET_PROVIDER_STATE });
  if (response?.ok) {
    return response;
  }

  try {
    const tab = await chrome.tabs.get(providerTabId);
    return {
      ok: true,
      currentUrl: tab?.url || "",
      title: tab?.title || ""
    };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
}

function resolveThreadUrl(provider, candidateUrl, fallbackUrl) {
  const normalizedCandidate = normalizeUrl(candidateUrl);
  if (normalizedCandidate && isProviderUrl(provider, normalizedCandidate)) {
    return normalizedCandidate;
  }
  const normalizedFallback = normalizeUrl(fallbackUrl);
  return isProviderUrl(provider, normalizedFallback) ? normalizedFallback : "";
}

function estimateGenerationProgressPercent(rawOutput) {
  const chars = normalizeWhitespace(rawOutput).length;
  if (!chars) {
    return 0;
  }
  return Math.min(90, Math.max(10, Math.floor(chars / 300) * 10 || 10));
}

function formatGenerationProgressText(providerName, rawOutput, elapsedMs) {
  const chars = normalizeWhitespace(rawOutput).length;
  const percent = estimateGenerationProgressPercent(rawOutput);
  const elapsedText = formatElapsedWait(elapsedMs);
  if (percent > 0) {
    return {
      text: `${providerName} is generating... ${percent}% (${chars} chars, ${elapsedText})`,
      percent,
      chars
    };
  }
  return {
    text: `${providerName} is generating... (${elapsedText})`,
    percent: 0,
    chars: 0
  };
}

function tryValidateProviderOutput(rawOutput, fixedTail, flowType, fallbackProfile) {
  const normalized = normalizeWhitespace(rawOutput);
  if (!normalized) {
    return null;
  }
  try {
    return validateWorkspaceResult(
      shared.extractJsonFromText(normalized),
      fixedTail,
      flowType,
      fallbackProfile
    );
  } catch (_error) {
    return null;
  }
}

async function captureProviderResponseViaFlash(provider, providerTabId, previousTabId, sourceTabId) {
  let restoreTabId = null;
  let rawOutput = "";
  let currentUrl = "";
  try {
    await showLinkedInPageActivityOverlay(
      sourceTabId,
      "Loading recommendations",
      "Finalizing your recommendation..."
    );
    restoreTabId = await activateProviderTab(provider, providerTabId, previousTabId);
    await delay(PROVIDER_CAPTURE_SETTLE_MS);
    const readResponse = await safeSendMessage(providerTabId, {
      type: MESSAGE_TYPES.READ_RESPONSE,
      maxWaitMs: 8000,
      stallWaitMs: 4000
    });
    if (readResponse?.ok) {
      rawOutput = normalizeWhitespace(readResponse.rawOutput);
    }
    const stateResponse = await readProviderTabState(provider, providerTabId);
    currentUrl = normalizeWhitespace(stateResponse?.currentUrl || "");
    if (!rawOutput) {
      rawOutput = normalizeWhitespace(stateResponse?.latestResponseText || "");
    }
  } catch (_error) {
    // Fall back to whatever the background poll already saw.
  } finally {
    await hideLinkedInPageActivityOverlay(sourceTabId).catch(() => {});
  }
  return {
    restoreTabId,
    rawOutput,
    currentUrl
  };
}

async function runPromptWithRetries(prompt, fixedTail, runnerOptions, flowType, fallbackProfile, options) {
  let lastError = null;
  let lastRawOutput = "";
  let threadUrl = "";
  let providerTab = null;
  let promptSubmitted = false;
  const previousTab = await getActiveTab();
  const previousTabId = previousTab?.id || null;
  const onProgress = typeof options?.onProgress === "function" ? options.onProgress : null;
  const jobBinding = options?.jobBinding || null;
  const provider = normalizeLlmProvider(runnerOptions?.provider || DEFAULT_LLM_PROVIDER);
  const providerName = providerDisplayName(provider);
  const entryUrl = normalizeUrl(runnerOptions?.entryUrl || defaultLlmEntryUrl(provider)) || defaultLlmEntryUrl(provider);
  const preferFreshTab = Boolean(runnerOptions?.preferFreshTab);
  const isTemporarySession = provider === "chatgpt" && /[?&]temporary-chat=true\b/i.test(entryUrl);
  const timings = {
    llm_total_ms: 0,
    llm_open_tab_ms: 0,
    llm_send_prompt_ms: 0,
    llm_time_to_submit_ms: 0,
    llm_wait_for_response_ms: 0,
    llm_validate_response_ms: 0
  };
  const llmStartedAt = Date.now();
  let restoredAfterRun = false;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      await onProgress?.(attempt === 1 ? `Opening ${providerName}...` : `Re-opening ${providerName}...`, {
        provider,
        status: "opening"
      });
      const openStartedAt = Date.now();
      providerTab = await ensureProviderTab(provider, entryUrl, { preferFreshTab });
      timings.llm_open_tab_ms += roundMs(Date.now() - openStartedAt);

      if (!providerTab?.id) {
        throw new Error(`No ${providerName} tab available.`);
      }
      setLastProviderTabId(provider, providerTab.id);
      if (jobBinding?.personId) {
        bindProviderTabToPerson(providerTab.id, {
          provider,
          personId: jobBinding.personId,
          fullName: jobBinding.fullName,
          requestId: jobBinding.requestId,
          sourceTabId: jobBinding.sourceTabId
        });
      }

      if (!promptSubmitted) {
        await onProgress?.(`Sending prompt to ${providerName}...`, {
          provider,
          status: "submitting"
        });
        const sendStartedAt = Date.now();
        const startResponse = await sendPromptToProviderTab(provider, providerTab.id, MESSAGE_TYPES.RUN_PROMPT, prompt, previousTabId);
        timings.llm_send_prompt_ms += roundMs(Date.now() - sendStartedAt);
        if (!startResponse?.ok) {
          throw new Error(startResponse?.error || `Unable to submit prompt to ${providerName}.`);
        }
        promptSubmitted = true;
        timings.llm_time_to_submit_ms = roundMs(Date.now() - llmStartedAt);
      }

      const waitStartedAt = Date.now();
      let repairAttemptCount = 0;
      await onProgress?.(`${providerName} is generating...`, {
        provider,
        status: "generating",
        progressPercent: 0,
        outputChars: 0
      });

      while (Date.now() - waitStartedAt < CHATGPT_TOTAL_WAIT_MS) {
        const readResponse = await safeSendMessage(providerTab.id, {
          type: MESSAGE_TYPES.READ_RESPONSE,
          maxWaitMs: PROVIDER_BACKGROUND_READ_MAX_WAIT_MS,
          stallWaitMs: PROVIDER_BACKGROUND_READ_STALL_MS
        });
        if (!readResponse?.ok) {
          throw new Error(readResponse?.error || `Unable to read ${providerName} response.`);
        }

        lastRawOutput = readResponse.rawOutput || lastRawOutput;
        const progress = formatGenerationProgressText(providerName, lastRawOutput, Date.now() - waitStartedAt);

        if (readResponse.status === "complete") {
          try {
            await onProgress?.(`Capturing ${providerName} response...`, {
              provider,
              status: "capturing",
              progressPercent: 95,
              outputChars: progress.chars
            });
            const flashed = await captureProviderResponseViaFlash(
              provider,
              providerTab.id,
              previousTabId,
              jobBinding?.sourceTabId
            );
            const capturedOutput = normalizeWhitespace(flashed.rawOutput || lastRawOutput);
            await onProgress?.(`Checking ${providerName} response...`, {
              provider,
              status: "validating",
              progressPercent: 95,
              outputChars: Math.max(progress.chars, normalizeWhitespace(capturedOutput).length)
            });
            const validateStartedAt = Date.now();
            const validated = validateWorkspaceResult(
              shared.extractJsonFromText(capturedOutput),
              fixedTail,
              flowType,
              fallbackProfile
            );
            timings.llm_validate_response_ms += roundMs(Date.now() - validateStartedAt);
            threadUrl = resolveThreadUrl(provider, flashed.currentUrl, entryUrl);
            await onProgress?.("Finalizing draft...", {
              provider,
              status: "finalizing",
              progressPercent: 100,
              outputChars: Math.max(progress.chars, normalizeWhitespace(capturedOutput).length)
            });
            if (providerTab?.id) {
              try {
                await chrome.tabs.remove(providerTab.id);
                if (getLastProviderTabId(provider) === providerTab.id) {
                  setLastProviderTabId(provider, null);
                }
              } catch (_error) {
                // Ignore cleanup failure.
              }
            }
            if (flashed.restoreTabId || previousTabId) {
              await restoreActiveTab(flashed.restoreTabId || previousTabId);
              restoredAfterRun = true;
            }
            return {
              ok: true,
              attempt,
              rawOutput: capturedOutput,
              result: validated,
              threadUrl,
              providerTabId: providerTab?.id ?? null,
              timings: {
                ...timings,
                llm_wait_for_response_ms: roundMs(timings.llm_wait_for_response_ms + (Date.now() - waitStartedAt)),
                llm_total_ms: roundMs(Date.now() - llmStartedAt)
              }
            };
          } catch (validationError) {
            lastError = validationError;
            if (repairAttemptCount >= MAX_RETRIES - 1) {
              throw validationError;
            }

            repairAttemptCount += 1;
            await onProgress?.(`Fixing ${providerName} response format...`, {
              provider,
              status: "repairing",
              progressPercent: progress.percent,
              outputChars: progress.chars
            });
            const retryPrompt = buildRetryPrompt(validationError.message || String(validationError));
            const retryResponse = await sendPromptToProviderTab(provider, providerTab.id, MESSAGE_TYPES.RETRY_RUN, retryPrompt, previousTabId);
            if (!retryResponse?.ok) {
              throw new Error(retryResponse?.error || `Unable to request a regenerated response from ${providerName}.`);
            }
            lastRawOutput = "";
            await delay(1200);
            await onProgress?.(`Waiting for corrected ${providerName} response...`, {
              provider,
              status: "generating",
              progressPercent: 0,
              outputChars: 0
            });
            continue;
          }
        }

        if (readResponse.status === "still_generating") {
          const validatedWhileGenerating = tryValidateProviderOutput(lastRawOutput, fixedTail, flowType, fallbackProfile);
          if (validatedWhileGenerating) {
            await onProgress?.(`Capturing ${providerName} response...`, {
              provider,
              status: "capturing",
              progressPercent: 95,
              outputChars: progress.chars
            });
            const flashed = await captureProviderResponseViaFlash(
              provider,
              providerTab.id,
              previousTabId,
              jobBinding?.sourceTabId
            );
            const capturedOutput = normalizeWhitespace(flashed.rawOutput || lastRawOutput);
            const validatedCaptured = tryValidateProviderOutput(capturedOutput, fixedTail, flowType, fallbackProfile) || validatedWhileGenerating;
            threadUrl = resolveThreadUrl(provider, flashed.currentUrl, entryUrl);
            await onProgress?.("Finalizing draft...", {
              provider,
              status: "finalizing",
              progressPercent: 100,
              outputChars: Math.max(progress.chars, capturedOutput.length)
            });
            if (providerTab?.id) {
              try {
                await chrome.tabs.remove(providerTab.id);
                if (getLastProviderTabId(provider) === providerTab.id) {
                  setLastProviderTabId(provider, null);
                }
              } catch (_error) {
                // Ignore cleanup failure.
              }
            }
            if (flashed.restoreTabId || previousTabId) {
              await restoreActiveTab(flashed.restoreTabId || previousTabId);
              restoredAfterRun = true;
            }
            return {
              ok: true,
              attempt,
              rawOutput: capturedOutput,
              result: validatedCaptured,
              threadUrl,
              providerTabId: providerTab?.id ?? null,
              timings: {
                ...timings,
                llm_wait_for_response_ms: roundMs(timings.llm_wait_for_response_ms + (Date.now() - waitStartedAt)),
                llm_total_ms: roundMs(Date.now() - llmStartedAt)
              }
            };
          }
          await onProgress?.(progress.text, {
            provider,
            status: "generating",
            progressPercent: progress.percent,
            outputChars: progress.chars
          });
          await delay(PROVIDER_BACKGROUND_POLL_DELAY_MS);
          continue;
        }

        if (readResponse.status === "stalled" || readResponse.status === "no_response") {
          const stateResponse = await readProviderTabState(provider, providerTab.id);
          const stateChars = Number(stateResponse?.latestResponseLength || 0);
          const candidateOutput = normalizeWhitespace(stateResponse?.latestResponseText || lastRawOutput);
          const validatedFromCandidate = tryValidateProviderOutput(candidateOutput, fixedTail, flowType, fallbackProfile);
          if (validatedFromCandidate) {
            await onProgress?.(`Capturing ${providerName} response...`, {
              provider,
              status: "capturing",
              progressPercent: 95,
              outputChars: Math.max(candidateOutput.length, stateChars)
            });
            const flashed = await captureProviderResponseViaFlash(
              provider,
              providerTab.id,
              previousTabId,
              jobBinding?.sourceTabId
            );
            const capturedOutput = normalizeWhitespace(flashed.rawOutput || candidateOutput);
            const validatedCaptured = tryValidateProviderOutput(capturedOutput, fixedTail, flowType, fallbackProfile) || validatedFromCandidate;
            const stateProgress = formatGenerationProgressText(
              providerName,
              capturedOutput,
              Date.now() - waitStartedAt
            );
            threadUrl = resolveThreadUrl(provider, flashed.currentUrl || stateResponse?.currentUrl, entryUrl);
            await onProgress?.("Finalizing draft...", {
              provider,
              status: "finalizing",
              progressPercent: 100,
              outputChars: Math.max(stateProgress.chars, stateChars, capturedOutput.length)
            });
            if (providerTab?.id) {
              try {
                await chrome.tabs.remove(providerTab.id);
                if (getLastProviderTabId(provider) === providerTab.id) {
                  setLastProviderTabId(provider, null);
                }
              } catch (_error) {
                // Ignore cleanup failure.
              }
            }
            if (flashed.restoreTabId || previousTabId) {
              await restoreActiveTab(flashed.restoreTabId || previousTabId);
              restoredAfterRun = true;
            }
            return {
              ok: true,
              attempt,
              rawOutput: capturedOutput,
              result: validatedCaptured,
              threadUrl,
              providerTabId: providerTab?.id ?? null,
              timings: {
                ...timings,
                llm_wait_for_response_ms: roundMs(timings.llm_wait_for_response_ms + (Date.now() - waitStartedAt)),
                llm_total_ms: roundMs(Date.now() - llmStartedAt)
              }
            };
          }
          const stateProgress = formatGenerationProgressText(
            providerName,
            stateResponse?.latestResponseText || lastRawOutput,
            Date.now() - waitStartedAt
          );
          if (stateResponse?.isGenerating || stateChars > 0) {
            await onProgress?.(stateProgress.text, {
              provider,
              status: "generating",
              progressPercent: stateProgress.percent,
              outputChars: Math.max(stateProgress.chars, stateChars)
            });
            await delay(PROVIDER_BACKGROUND_POLL_DELAY_MS);
            continue;
          }
          throw new Error(`${providerName} response stalled before completion.`);
        }

        await delay(PROVIDER_BACKGROUND_POLL_DELAY_MS);
      }

      return {
        ok: false,
        status: "still_generating",
        error: {
          message: `${providerName} is still generating after an extended wait. No new prompt was sent.`
        },
        rawOutput: lastRawOutput,
        threadUrl,
        providerTabId: providerTab?.id ?? null,
        timings: {
          ...timings,
          llm_wait_for_response_ms: roundMs(timings.llm_wait_for_response_ms + (Date.now() - waitStartedAt)),
          llm_total_ms: roundMs(Date.now() - llmStartedAt)
        }
      };
    } catch (error) {
      lastError = error;
      if (promptSubmitted) {
        if (!restoredAfterRun && previousTabId) {
          await restoreActiveTab(previousTabId).catch(() => {});
          restoredAfterRun = true;
        }
        break;
      }
      await onProgress?.(`Retrying ${providerName}...`);
      await delay(800);
    }
  }

  if (!restoredAfterRun && previousTabId) {
    await restoreActiveTab(previousTabId).catch(() => {});
  }

  return {
    ok: false,
    status: "failed",
    error: lastError ? serializeError(lastError) : { message: `Unknown ${providerName} failure.` },
    rawOutput: lastRawOutput,
    threadUrl,
    providerTabId: providerTab?.id ?? null,
    timings: {
      ...timings,
      llm_total_ms: roundMs(Date.now() - llmStartedAt)
    }
  };
}

function enqueueChatGptRun(task) {
  return task();
}

function formatElapsedWait(ms) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

async function getStoredState() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.myProfile,
    STORAGE_KEYS.fixedTail,
    STORAGE_KEYS.promptSettings,
    STORAGE_KEYS.chatGptProjectUrl,
    STORAGE_KEYS.people,
    STORAGE_KEYS.tabPersonBindings,
    STORAGE_KEYS.threadPersonBindings,
    STORAGE_KEYS.profileRedirects,
    STORAGE_KEYS.identityResolutionSeenOpaqueUrls
  ]);

  const rawPeople = stored[STORAGE_KEYS.people] || {};
  const rawPromptSettings = stored[STORAGE_KEYS.promptSettings] || defaultPromptSettings();
  const legacyChatGptProjectUrl = stored[STORAGE_KEYS.chatGptProjectUrl] || DEFAULT_CHATGPT_PROJECT_URL;
  const people = Object.fromEntries(
    Object.entries(rawPeople)
      .map(([key, value]) => {
        const normalized = normalizePersonRecord(value);
        return [normalized.personId || key, normalized];
      })
      .filter(([, value]) => Boolean(value?.personId))
  );
  return {
    myProfile: stored[STORAGE_KEYS.myProfile] || defaultMyProfile(),
    fixedTail: normalizeFixedTail(stored[STORAGE_KEYS.fixedTail] || FIXED_TAIL),
    promptSettings: normalizePromptSettings({
      ...rawPromptSettings,
      llmEntryUrl: normalizeWhitespace(rawPromptSettings?.llmEntryUrl || "")
        || (normalizeLlmProvider(rawPromptSettings?.llmProvider) === "chatgpt" ? legacyChatGptProjectUrl : "")
    }),
    chatGptProjectUrl: legacyChatGptProjectUrl,
    people,
    tabPersonBindings: stored[STORAGE_KEYS.tabPersonBindings] || {},
    threadPersonBindings: stored[STORAGE_KEYS.threadPersonBindings] || {},
    profileRedirects: stored[STORAGE_KEYS.profileRedirects] || {},
    identityResolutionSeenOpaqueUrls: stored[STORAGE_KEYS.identityResolutionSeenOpaqueUrls] || {}
  };
}

function normalizedOwnProfileUrlFromStored(stored) {
  return normalizeLinkedInProfileUrl(stored?.myProfile?.ownProfileUrl || "");
}

function normalizedPendingProfileUrlFromStored(stored) {
  return normalizeLinkedInProfileUrl(stored?.myProfile?.pendingProfileUrl || "");
}

function isOwnProfileRecord(record, stored) {
  const ownProfileUrl = normalizedOwnProfileUrlFromStored(stored);
  if (!ownProfileUrl || !record) {
    return false;
  }
  return knownProfileUrls(record).includes(ownProfileUrl);
}

function isOwnProfilePageContext(pageContext, stored) {
  const ownProfileUrl = normalizedOwnProfileUrlFromStored(stored);
  if (!ownProfileUrl) {
    return false;
  }
  const pageProfileUrl = normalizeLinkedInProfileUrl(pageContext?.person?.profileUrl || pageContext?.profile?.profileUrl || pageContext?.pageUrl);
  return Boolean(pageProfileUrl && pageProfileUrl === ownProfileUrl);
}

function isPendingProfilePageContext(pageContext, stored) {
  const pendingProfileUrl = normalizedPendingProfileUrlFromStored(stored);
  if (!pendingProfileUrl) {
    return false;
  }
  const pageProfileUrl = normalizeLinkedInProfileUrl(pageContext?.person?.profileUrl || pageContext?.profile?.profileUrl || pageContext?.pageUrl);
  return Boolean(pageProfileUrl && pageProfileUrl === pendingProfileUrl);
}

async function removePeopleMatchingProfileUrl(profileUrl, stored) {
  const normalizedProfileUrl = normalizeLinkedInProfileUrl(profileUrl);
  if (!normalizedProfileUrl) {
    return stored;
  }
  const nextPeople = Object.fromEntries(
    Object.entries(stored?.people || {}).filter(([, record]) => !knownProfileUrls(record).includes(normalizedProfileUrl))
  );
  await savePeople(nextPeople);
  return {
    ...stored,
    people: nextPeople
  };
}

async function savePeople(people) {
  const normalizedPeople = Object.fromEntries(
    Object.entries(people || {})
      .map(([key, value]) => {
        const normalized = normalizePersonRecord(value);
        return [normalized.personId || key, normalized];
      })
      .filter(([, value]) => Boolean(value?.personId))
  );
  await chrome.storage.local.set({ [STORAGE_KEYS.people]: normalizedPeople });
}

function collectThreadUrlsForRecord(record) {
  const urls = new Set();
  const topLevelThreadUrl = normalizeUrl(record?.messagingThreadUrl);
  if (topLevelThreadUrl) {
    urls.add(topLevelThreadUrl);
  }
  const draftWorkspaceThreadUrl = normalizeUrl(getDraftWorkspace(record)?.conversation?.threadUrl);
  if (draftWorkspaceThreadUrl) {
    urls.add(draftWorkspaceThreadUrl);
  }
  return Array.from(urls);
}

function buildThreadPersonBindings(people, existingBindings) {
  const nextBindings = {};
  const currentPeople = people || {};
  const priorBindings = existingBindings || {};

  Object.entries(priorBindings).forEach(([threadUrl, personId]) => {
    const normalizedThreadUrl = normalizeUrl(threadUrl);
    const normalizedPersonId = normalizeWhitespace(personId);
    if (normalizedThreadUrl && normalizedPersonId && currentPeople[normalizedPersonId]) {
      nextBindings[normalizedThreadUrl] = normalizedPersonId;
    }
  });

  Object.values(currentPeople).forEach((record) => {
    const personId = normalizeWhitespace(record?.personId);
    if (!personId) {
      return;
    }
    collectThreadUrlsForRecord(record).forEach((threadUrl) => {
      nextBindings[threadUrl] = personId;
    });
  });

  return nextBindings;
}

function buildTabPersonBindings(people, existingBindings) {
  const nextBindings = {};
  const currentPeople = people || {};
  const priorBindings = existingBindings || {};

  Object.entries(priorBindings).forEach(([tabId, personId]) => {
    const normalizedTabId = Number(tabId);
    const normalizedPersonId = normalizeWhitespace(personId);
    if (Number.isInteger(normalizedTabId) && normalizedTabId >= 0 && normalizedPersonId && currentPeople[normalizedPersonId]) {
      nextBindings[String(normalizedTabId)] = normalizedPersonId;
    }
  });

  return nextBindings;
}

async function saveThreadPersonBindings(bindings) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.threadPersonBindings]: bindings || {}
  });
}

async function saveTabPersonBindings(bindings) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.tabPersonBindings]: bindings || {}
  });
}

function chooseCanonicalPersonId(records) {
  const ids = (records || [])
    .map((entry) => normalizeWhitespace(typeof entry === "string" ? entry : entry?.personId))
    .filter(Boolean);

  return ids.find((id) => isPublicSlugPersonId(id))
    || ids.find((id) => isOpaqueLinkedInPersonId(id))
    || ids.find((id) => id.startsWith("li:"))
    || ids.find((id) => !id.startsWith("name:"))
    || ids[0]
    || "";
}

function normalizeNameForMatch(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCaseName(value) {
  return normalizeWhitespace(value)
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function publicNameHintFromPersonId(personId) {
  const normalizedId = normalizeWhitespace(personId).toLowerCase();
  if (!normalizedId.startsWith("li:")) {
    return "";
  }

  const raw = normalizedId.slice(3);
  if (!raw || !raw.includes("-")) {
    return "";
  }

  const parts = raw.split("-");
  const nameParts = [];
  for (const part of parts) {
    if (!part || /\d/.test(part) || /_/.test(part)) {
      break;
    }
    nameParts.push(part);
  }

  if (!nameParts.length) {
    return "";
  }
  return normalizeNameForMatch(nameParts.join(" "));
}

function primaryLinkedInMemberUrl(record) {
  const explicit = normalizeLinkedInProfileUrl(record?.identity?.primaryLinkedInMemberUrl);
  if (explicit) {
    return explicit;
  }
  const profileUrl = normalizeLinkedInProfileUrl(record?.profileUrl);
  return shouldResolveLinkedInProfileUrl(profileUrl) ? profileUrl : "";
}

function publicProfileUrl(record) {
  const explicit = normalizeLinkedInProfileUrl(record?.identity?.publicProfileUrl);
  if (explicit) {
    return explicit;
  }
  const profileUrl = normalizeLinkedInProfileUrl(record?.profileUrl);
  return profileUrl && !shouldResolveLinkedInProfileUrl(profileUrl) ? profileUrl : "";
}

function knownProfileUrls(record) {
  return Array.from(new Set([
    ...(Array.isArray(record?.identity?.knownProfileUrls) ? record.identity.knownProfileUrls : []),
    primaryLinkedInMemberUrl(record),
    publicProfileUrl(record),
    normalizeLinkedInProfileUrl(record?.identity?.profileUrl),
    normalizeLinkedInProfileUrl(record?.profileUrl)
  ].map((value) => normalizeLinkedInProfileUrl(value)).filter(Boolean)));
}

function personNameCandidates(record) {
  const explicitName = normalizeNameForMatch(record?.identity?.normalizedName || record?.fullName);
  const idHint = publicNameHintFromPersonId(record?.personId);
  return Array.from(new Set([explicitName, idHint].filter(Boolean)));
}

function personIdentityAliases(record) {
  const aliases = new Set();
  knownProfileUrls(record)
    .map((value) => linkedInProfileAlias(value))
    .filter(Boolean)
    .forEach((value) => aliases.add(value));
  const identityAliases = Array.isArray(record?.identity?.aliases) ? record.identity.aliases : [];
  identityAliases
    .map((value) => linkedInProfileAlias(value) || normalizeWhitespace(value).toLowerCase())
    .filter(Boolean)
    .forEach((value) => aliases.add(value));
  const personId = normalizeWhitespace(record?.personId).toLowerCase();
  if (personId) {
    aliases.add(personId);
  }
  return aliases;
}

function hasMatchingIdentityAlias(leftRecord, rightRecord) {
  const leftAliases = personIdentityAliases(leftRecord);
  const rightAliases = personIdentityAliases(rightRecord);
  for (const alias of leftAliases) {
    if (rightAliases.has(alias)) {
      return true;
    }
  }
  return false;
}

function hasMatchingNameEvidence(leftRecord, rightRecord) {
  const leftNames = personNameCandidates(leftRecord);
  const rightNames = personNameCandidates(rightRecord);
  return leftNames.some((left) => rightNames.includes(left));
}

function normalizedHeadlinePrefix(value, length) {
  const normalized = normalizeNameForMatch(value);
  if (!normalized) {
    return "";
  }
  return normalized.slice(0, Math.max(1, Number(length) || 15)).trim();
}

function hasMatchingHeadlinePrefixEvidence(leftRecord, rightRecord, length = 15) {
  const leftPrefix = normalizedHeadlinePrefix(
    leftRecord?.headline || leftRecord?.profileSummary || leftRecord?.recipientProfileMemory,
    length
  );
  const rightPrefix = normalizedHeadlinePrefix(
    rightRecord?.headline || rightRecord?.profileSummary || rightRecord?.recipientProfileMemory,
    length
  );
  return Boolean(leftPrefix && rightPrefix && leftPrefix === rightPrefix);
}

function hasMatchingProfileEvidence(leftRecord, rightRecord) {
  const leftHeadline = normalizeNameForMatch(leftRecord?.headline);
  const rightHeadline = normalizeNameForMatch(rightRecord?.headline);
  if (leftHeadline && rightHeadline && leftHeadline === rightHeadline) {
    return true;
  }

  const leftSummary = normalizeNameForMatch(leftRecord?.profileSummary || leftRecord?.recipientProfileMemory);
  const rightSummary = normalizeNameForMatch(rightRecord?.profileSummary || rightRecord?.recipientProfileMemory);
  return Boolean(leftSummary && rightSummary && leftSummary.slice(0, 80) === rightSummary.slice(0, 80));
}

function findRecordByPrimaryLinkedInMemberUrl(people, profileUrl) {
  const normalized = normalizeLinkedInProfileUrl(profileUrl);
  if (!normalized) {
    return null;
  }
  return Object.values(people || {}).find((record) => primaryLinkedInMemberUrl(record) === normalized)
    || null;
}

function findRecordByPublicProfileUrl(people, profileUrl) {
  const normalized = normalizeLinkedInProfileUrl(profileUrl);
  if (!normalized) {
    return null;
  }
  return Object.values(people || {}).find((record) => publicProfileUrl(record) === normalized)
    || null;
}

function findRecordByKnownProfileUrl(people, profileUrl) {
  const normalized = normalizeLinkedInProfileUrl(profileUrl);
  if (!normalized) {
    return null;
  }
  return Object.values(people || {}).find((record) => {
    const knownUrls = [
      normalizeLinkedInProfileUrl(record?.profileUrl),
      normalizeLinkedInProfileUrl(record?.identity?.profileUrl),
      normalizeLinkedInProfileUrl(record?.identity?.primaryLinkedInMemberUrl),
      normalizeLinkedInProfileUrl(record?.identity?.publicProfileUrl),
      ...(Array.isArray(record?.identity?.knownProfileUrls) ? record.identity.knownProfileUrls.map((value) => normalizeLinkedInProfileUrl(value)) : [])
    ].filter(Boolean);
    return knownUrls.includes(normalized);
  }) || null;
}

function findRecordByMessagingThreadUrl(people, threadUrl) {
  const normalized = normalizeUrl(threadUrl);
  if (!normalized) {
    return null;
  }
  return Object.values(people || {}).find((record) =>
    normalizeUrl(record?.messagingThreadUrl) === normalized
  ) || null;
}

function findRecordByDraftWorkspaceThreadUrl(people, threadUrl) {
  const normalized = normalizeUrl(threadUrl);
  if (!normalized) {
    return null;
  }
  return Object.values(people || {}).find((record) =>
    normalizeUrl(getDraftWorkspace(record)?.conversation?.threadUrl) === normalized
  ) || null;
}

function recordMatchesPageContext(record, pageContext) {
  if (!record || !pageContext) {
    return false;
  }

  const preview = pageContext.person || {};
  const previewPersonId = normalizeWhitespace(preview.personId);
  if (previewPersonId && normalizeWhitespace(record.personId) === previewPersonId) {
    return true;
  }

  const previewThreadUrl = pageContext.pageType === "linkedin-messaging"
    ? normalizeUrl(preview.messagingThreadUrl || pageContext?.conversation?.threadUrl || pageContext?.pageUrl)
    : "";
  if (previewThreadUrl) {
    const recordThreadUrls = new Set([
      normalizeUrl(record.messagingThreadUrl),
      normalizeUrl(getDraftWorkspace(record)?.conversation?.threadUrl)
    ].filter(Boolean));
    if (recordThreadUrls.has(previewThreadUrl)) {
      return true;
    }
  }

  const previewProfileUrl = normalizeLinkedInProfileUrl(preview.profileUrl)
    || (pageContext.pageType === "linkedin-profile" ? normalizeLinkedInProfileUrl(pageContext.pageUrl) : "");
  if (previewProfileUrl) {
    const recordProfileUrls = new Set([
      normalizeLinkedInProfileUrl(record.profileUrl),
      primaryLinkedInMemberUrl(record),
      publicProfileUrl(record),
      ...knownProfileUrls(record)
    ].filter(Boolean));
    if (recordProfileUrls.has(previewProfileUrl)) {
      return true;
    }
    if (hasMatchingIdentityAlias(record, {
      personId: previewPersonId,
      profileUrl: previewProfileUrl,
      identity: { aliases: [linkedInProfileAlias(previewProfileUrl)] }
    })) {
      return true;
    }
  }

  return false;
}

function findIdentityCandidates(pageContext, stored) {
  const preview = pageContext?.person || {};
  const candidateSeed = {
    fullName: normalizeWhitespace(preview.fullName || pageContext?.conversation?.recipientName),
    personId: preview.personId,
    headline: preview.headline,
    profileSummary: preview.profileSummary || pageContext?.profile?.summaryText || ""
  };
  const candidates = Object.values(stored?.people || {})
    .filter((record) => !isOwnProfileRecord(record, stored))
    .map((record) => {
      const nameMatch = hasMatchingNameEvidence(record, candidateSeed);
      let score = 0;
      if (nameMatch) {
        score += 3;
      }
      if (nameMatch && hasMatchingHeadlinePrefixEvidence(record, candidateSeed)) {
        score += 3;
      }
      if (nameMatch && hasMatchingProfileEvidence(record, candidateSeed)) {
        score += 2;
      }
      return { record, score, nameMatch };
    })
    .filter((entry) => entry.nameMatch && entry.score >= 3);

  candidates.sort((left, right) => right.score - left.score || personRecordStrength(right.record) - personRecordStrength(left.record));
  return candidates.map((entry) => entry.record);
}

function resolveStoredPersonMatch(pageContext, stored) {
  if (isOwnProfilePageContext(pageContext, stored)) {
    return { matchedRecord: null, identityWarning: null, matchType: "own_profile" };
  }
  const people = stored?.people || {};
  const sourceTabId = Number.isInteger(pageContext?.tabId) ? pageContext.tabId : null;
  const preview = pageContext?.person || {};
  const previewId = normalizeWhitespace(preview.personId);
  const previewProfileUrl = normalizeLinkedInProfileUrl(preview.profileUrl);
  const previewThreadUrl = pageContext?.pageType === "linkedin-messaging"
    ? normalizeUrl(preview.messagingThreadUrl || pageContext?.conversation?.threadUrl || pageContext?.pageUrl)
    : "";
  const pageProfileUrl = pageContext?.pageType === "linkedin-profile"
    ? normalizeLinkedInProfileUrl(pageContext?.pageUrl)
    : "";
  const previewOpaqueUrl = normalizeLinkedInProfileUrl(preview.primaryLinkedInMemberUrl)
    || (previewProfileUrl && shouldResolveLinkedInProfileUrl(previewProfileUrl) ? previewProfileUrl : "");
  const previewPublicUrl = normalizeLinkedInProfileUrl(preview.publicProfileUrl)
    || (previewProfileUrl && !shouldResolveLinkedInProfileUrl(previewProfileUrl) ? previewProfileUrl : "")
    || (pageProfileUrl && !shouldResolveLinkedInProfileUrl(pageProfileUrl) ? pageProfileUrl : "");

  if (previewId && people[previewId]) {
    return { matchedRecord: people[previewId], identityWarning: null, matchType: "person_id" };
  }

  if (previewThreadUrl) {
    const boundPersonId = normalizeWhitespace(stored?.threadPersonBindings?.[previewThreadUrl]);
    if (boundPersonId && people[boundPersonId]) {
      return { matchedRecord: people[boundPersonId], identityWarning: null, matchType: "thread_binding" };
    }
    const threadMatch = findRecordByMessagingThreadUrl(people, previewThreadUrl);
    if (threadMatch) {
      return { matchedRecord: threadMatch, identityWarning: null, matchType: "messaging_thread_url" };
    }
    const workspaceThreadMatch = findRecordByDraftWorkspaceThreadUrl(people, previewThreadUrl);
    if (workspaceThreadMatch) {
      return { matchedRecord: workspaceThreadMatch, identityWarning: null, matchType: "draft_workspace_thread_url" };
    }
  }

  if (sourceTabId !== null) {
    const boundPersonId = normalizeWhitespace(stored?.tabPersonBindings?.[String(sourceTabId)]);
    const boundRecord = boundPersonId ? people[boundPersonId] : null;
    if (boundRecord && recordMatchesPageContext(boundRecord, pageContext)) {
      return { matchedRecord: boundRecord, identityWarning: null, matchType: "tab_binding" };
    }
  }

  if (pageContext?.pageType === "linkedin-messaging" && previewOpaqueUrl) {
    const primaryMatch = findRecordByPrimaryLinkedInMemberUrl(people, previewOpaqueUrl)
      || findRecordByKnownProfileUrl(people, previewOpaqueUrl)
      || Object.values(people).find((record) => hasMatchingIdentityAlias(record, {
        identity: { aliases: [linkedInProfileAlias(previewOpaqueUrl)] },
        personId: previewId,
        profileUrl: previewOpaqueUrl
      }));
    if (primaryMatch) {
      return { matchedRecord: primaryMatch, identityWarning: null, matchType: "primary_linkedin_member_url" };
    }
  }

  if (previewPublicUrl) {
    const publicMatch = findRecordByPublicProfileUrl(people, previewPublicUrl)
      || findRecordByKnownProfileUrl(people, previewPublicUrl)
      || Object.values(people).find((record) => hasMatchingIdentityAlias(record, {
        identity: { aliases: [linkedInProfileAlias(previewPublicUrl)] },
        personId: previewId,
        profileUrl: previewPublicUrl
      }));
    if (publicMatch) {
      return { matchedRecord: publicMatch, identityWarning: null, matchType: "public_profile_url" };
    }
  }

  if (pageContext?.pageType !== "linkedin-messaging" && previewOpaqueUrl) {
    const opaqueMatch = findRecordByPrimaryLinkedInMemberUrl(people, previewOpaqueUrl)
      || findRecordByKnownProfileUrl(people, previewOpaqueUrl);
    if (opaqueMatch) {
      return { matchedRecord: opaqueMatch, identityWarning: null, matchType: "primary_linkedin_member_url" };
    }
  }

  const candidates = findIdentityCandidates(pageContext, stored);
  if (candidates.length === 1) {
    const candidate = candidates[0];
    if (hasMatchingNameEvidence(candidate, preview) && hasMatchingHeadlinePrefixEvidence(candidate, preview)) {
      return {
        matchedRecord: candidate,
        identityWarning: null,
        matchType: "name_headline_prefix"
      };
    }
    return {
      matchedRecord: null,
      matchType: "",
      identityWarning: {
        status: "needs_merge_confirmation",
        confidence: "medium",
        message: `Possible match: ${normalizeWhitespace(candidate.fullName || "existing person")}.`,
        candidatePersonId: candidate.personId
      }
    };
  }

  if (candidates.length > 1) {
    return {
      matchedRecord: null,
      matchType: "",
      identityWarning: {
        status: "needs_merge_confirmation",
        confidence: "low",
        message: "Multiple possible matches found.",
        candidatePersonIds: candidates.slice(0, 5).map((record) => record.personId).filter(Boolean)
      }
    };
  }

  return { matchedRecord: null, identityWarning: null, matchType: "" };
}

function personRecordStrength(record) {
  if (!record) {
    return -1;
  }

  let score = 0;
  const personId = normalizeWhitespace(record.personId);
  if (isOpaqueLinkedInPersonId(personId)) {
    score += 10;
  } else if (isPublicSlugPersonId(personId)) {
    score += 8;
  } else if (personId.startsWith("li:")) {
    score += 4;
  } else if (personId.startsWith("name:")) {
    score += 1;
  }

  if (normalizeUrl(record.profileUrl)) {
    score += 6;
  }
  score += personIdentityAliases(record).size;
  if (normalizeUrl(record.messagingThreadUrl)) {
    score += 4;
  }
  if (normalizeUrl(record.chatGptThreadUrl)) {
    score += 10;
  }
  if (normalizeWhitespace(record.personNote)) {
    score += 4;
  }
  if (normalizeWhitespace(record.userGoal)) {
    score += 3;
  }
  if (normalizeWhitespace(record.recipientSummaryMemory)) {
    score += 5;
  }
  if (normalizeWhitespace(record.recipientProfileMemory)) {
    score += 5;
  }
  if (record.importedConversation) {
    score += 3;
  }
  if (normalizeWhitespace(record.fullName)) {
    score += 2;
  }
  if (normalizeWhitespace(record.headline)) {
    score += 2;
  }

  return score;
}

function isPublicSlugPersonId(personId) {
  return Boolean(publicNameHintFromPersonId(personId));
}

function mergeCurrentPerson(pageContext, existingRecord) {
  const preview = pageContext?.person || {};
  const previewPersonId = normalizeWhitespace(preview.personId);
  const existingPersonId = normalizeWhitespace(existingRecord?.personId);
  const previewProfileUrl = normalizeLinkedInProfileUrl(preview.profileUrl);
  const previewAliases = Array.isArray(preview.identityAliases) ? preview.identityAliases : [];
  const aliasUrls = previewAliases.map((value) => normalizeLinkedInProfileUrl(value)).filter(Boolean);
  const previewOpaqueAlias = aliasUrls.find((value) => shouldResolveLinkedInProfileUrl(value)) || "";
  const previewPublicAlias = aliasUrls.find((value) => value && !shouldResolveLinkedInProfileUrl(value)) || "";
  const previewPrimaryLinkedInMemberUrl = normalizeLinkedInProfileUrl(preview.primaryLinkedInMemberUrl)
    || (shouldResolveLinkedInProfileUrl(previewProfileUrl)
      ? previewProfileUrl
      : "")
    || previewOpaqueAlias
    || primaryLinkedInMemberUrl(existingRecord);
  const previewPublicProfileUrl = normalizeLinkedInProfileUrl(preview.publicProfileUrl)
    || (previewProfileUrl && !shouldResolveLinkedInProfileUrl(previewProfileUrl)
      ? previewProfileUrl
      : "")
    || previewPublicAlias
    || publicProfileUrl(existingRecord);
  const shouldPreserveExistingId = Boolean(
    existingPersonId
    && (
      hasMatchingIdentityAlias(existingRecord, preview)
      || (
      (
        existingPersonId.startsWith("li:")
        && (!previewPersonId || previewPersonId.startsWith("name:"))
        && !normalizeWhitespace(preview.profileUrl)
      )
      || (
        isPublicSlugPersonId(existingPersonId)
        && isOpaqueLinkedInPersonId(previewPersonId)
      )
      )
    )
  );
  const inferredFullName = titleCaseName(
    normalizeWhitespace(preview.fullName)
    || publicNameHintFromPersonId(previewPersonId)
    || existingRecord?.fullName
    || publicNameHintFromPersonId(existingPersonId)
  );
  const inferredFirstName = normalizeWhitespace(preview.firstName)
    || normalizeWhitespace(existingRecord?.firstName)
    || (inferredFullName ? inferredFullName.split(" ")[0] : "");
  const preferredPersonId = shared.personIdFromProfileUrl(
    previewPrimaryLinkedInMemberUrl || primaryLinkedInMemberUrl(existingRecord),
    inferredFullName
  ) || shared.personIdFromProfileUrl(
    previewPublicProfileUrl || publicProfileUrl(existingRecord),
    inferredFullName
  ) || previewPersonId
    || existingPersonId;

  return mergePersonRecord(existingRecord, {
    identity: {
      primaryLinkedInMemberUrl: previewPrimaryLinkedInMemberUrl || primaryLinkedInMemberUrl(existingRecord),
      publicProfileUrl: previewPublicProfileUrl || publicProfileUrl(existingRecord),
      knownProfileUrls: Array.from(new Set([
        ...knownProfileUrls(existingRecord),
        previewProfileUrl,
        previewOpaqueAlias,
        previewPublicAlias
      ].filter(Boolean))),
      identityStatus: previewPrimaryLinkedInMemberUrl || previewPublicProfileUrl ? "resolved" : "provisional",
      identityConfidence: previewPrimaryLinkedInMemberUrl ? "high" : previewPublicProfileUrl ? "medium" : "low",
      aliases: Array.from(new Set([
        ...(Array.isArray(preview.identityAliases) ? preview.identityAliases : []),
        linkedInProfileAlias(preview.profileUrl),
        linkedInProfileAlias(existingRecord?.profileUrl)
      ].filter(Boolean)))
    },
    personId: shouldPreserveExistingId ? (preferredPersonId || existingPersonId) : preferredPersonId,
    fullName: inferredFullName,
    firstName: inferredFirstName,
    profileUrl: previewPublicProfileUrl || preview.profileUrl || existingRecord?.profileUrl,
    messagingThreadUrl: pageContext?.pageType === "linkedin-messaging"
      ? normalizeUrl(preview.messagingThreadUrl || pageContext?.conversation?.threadUrl || pageContext?.pageUrl) || existingRecord?.messagingThreadUrl
      : existingRecord?.messagingThreadUrl,
    headline: normalizeWhitespace(preview.headline) || existingRecord?.headline,
    location: normalizeWhitespace(preview.location) || existingRecord?.location,
    connectionStatus: normalizeConnectionStatus(preview.connectionStatus) || existingRecord?.connectionStatus || "unknown",
    lastPageType: pageContext?.pageType || existingRecord?.lastPageType || ""
  });
}

function findMatchingStoredPerson(pageContext, stored) {
  return resolveStoredPersonMatch(pageContext, stored).matchedRecord;
}

function shouldMergeDuplicatePersonRecords(baseRecord, candidateRecord) {
  if (!baseRecord || !candidateRecord) {
    return false;
  }

  const baseId = normalizeWhitespace(baseRecord.personId);
  const candidateId = normalizeWhitespace(candidateRecord.personId);
  if (!baseId || !candidateId || baseId === candidateId) {
    return false;
  }

  const baseProfileUrl = normalizeLinkedInProfileUrl(baseRecord.profileUrl);
  const candidateProfileUrl = normalizeLinkedInProfileUrl(candidateRecord.profileUrl);
  const baseThreadUrl = normalizeUrl(baseRecord.messagingThreadUrl);
  const candidateThreadUrl = normalizeUrl(candidateRecord.messagingThreadUrl);
  if (baseProfileUrl && candidateProfileUrl && baseProfileUrl === candidateProfileUrl) {
    return true;
  }
  if (baseThreadUrl && candidateThreadUrl && baseThreadUrl === candidateThreadUrl) {
    return true;
  }
  if (hasMatchingIdentityAlias(baseRecord, candidateRecord)) {
    return true;
  }
  return false;
}

function mergeDuplicatePersonEntries(personRecord, stored) {
  const people = stored.people || {};
  const seed = mergePersonRecord(people[personRecord.personId], personRecord);
  let combined = seed;
  const duplicateKeys = new Set();

  for (const [key, candidate] of Object.entries(people)) {
    if (!shouldMergeDuplicatePersonRecords(combined, candidate)) {
      continue;
    }
    duplicateKeys.add(key);
    combined = mergePersonRecord(candidate, combined);
  }

  const canonicalPersonId = chooseCanonicalPersonId([
    combined,
    ...Array.from(duplicateKeys).map((key) => people[key]),
    personRecord.personId
  ]);
  if (canonicalPersonId) {
    combined.personId = canonicalPersonId;
  }

  const nextPeople = { ...people };
  delete nextPeople[personRecord.personId];
  for (const key of duplicateKeys) {
    delete nextPeople[key];
  }

  combined = mergePersonRecord(people[combined.personId], combined);
  nextPeople[combined.personId] = combined;

  return {
    merged: combined,
    people: nextPeople
  };
}

async function loadCurrentPersonFromPage(pageContext, stored) {
  if (isOwnProfilePageContext(pageContext, stored)) {
    return null;
  }
  const resolution = resolveStoredPersonMatch(pageContext, stored);
  const matchedRecord = resolution.matchedRecord;
  const previewId = normalizeWhitespace(pageContext?.person?.personId);
  const previewProfileUrl = normalizeLinkedInProfileUrl(pageContext?.person?.profileUrl)
    || (pageContext?.pageType === "linkedin-profile" ? normalizeLinkedInProfileUrl(pageContext?.pageUrl) : "");
  if (!previewId && !previewProfileUrl && !matchedRecord) {
    return null;
  }

  const fallbackPreview = pageContext?.person
    ? pageContext
    : {
      ...pageContext,
      person: previewProfileUrl
        ? {
          personId: shared.personIdFromProfileUrl(previewProfileUrl, ""),
          firstName: "",
          fullName: "",
          profileUrl: previewProfileUrl,
          publicProfileUrl: !shouldResolveLinkedInProfileUrl(previewProfileUrl) ? previewProfileUrl : "",
          primaryLinkedInMemberUrl: shouldResolveLinkedInProfileUrl(previewProfileUrl) ? previewProfileUrl : "",
          headline: "",
          location: "",
          connectionStatus: "unknown",
          identityAliases: [linkedInProfileAlias(previewProfileUrl)]
        }
        : null
    };

  return mergeCurrentPerson(fallbackPreview, matchedRecord || stored.people?.[previewId]);
}

async function upsertPersonRecord(personRecord, stored) {
  const latestStored = await getStoredState();
  const workingStored = {
    ...latestStored,
    people: latestStored.people || stored?.people || {},
    tabPersonBindings: latestStored.tabPersonBindings || stored?.tabPersonBindings || {},
    threadPersonBindings: latestStored.threadPersonBindings || stored?.threadPersonBindings || {}
  };
  const deduped = mergeDuplicatePersonEntries(personRecord, workingStored);
  const merged = deduped.merged;
  const nextPeople = deduped.people;
  const nextTabPersonBindings = buildTabPersonBindings(nextPeople, workingStored.tabPersonBindings);
  const nextThreadPersonBindings = buildThreadPersonBindings(nextPeople, workingStored.threadPersonBindings);
  await chrome.storage.local.set({
    [STORAGE_KEYS.people]: nextPeople,
    [STORAGE_KEYS.tabPersonBindings]: nextTabPersonBindings,
    [STORAGE_KEYS.threadPersonBindings]: nextThreadPersonBindings
  });
  return {
    merged,
    people: nextPeople,
    tabPersonBindings: nextTabPersonBindings,
    threadPersonBindings: nextThreadPersonBindings
  };
}

async function ensureCurrentPersonPersisted(currentPerson, stored) {
  if (!currentPerson?.personId) {
    return {
      currentPerson,
      stored,
      persisted: false
    };
  }
  const existing = stored?.people?.[currentPerson.personId];
  const normalizedCurrent = normalizePersonRecord(currentPerson);
  const normalizedExisting = normalizePersonRecord(existing);
  const shouldPersist = !existing
    || normalizeWhitespace(normalizedExisting.personId) !== normalizeWhitespace(normalizedCurrent.personId)
    || normalizeLinkedInProfileUrl(normalizedExisting.profileUrl) !== normalizeLinkedInProfileUrl(normalizedCurrent.profileUrl)
    || normalizeUrl(normalizedExisting.messagingThreadUrl) !== normalizeUrl(normalizedCurrent.messagingThreadUrl)
    || normalizeLinkedInProfileUrl(normalizedExisting.identity?.primaryLinkedInMemberUrl) !== normalizeLinkedInProfileUrl(normalizedCurrent.identity?.primaryLinkedInMemberUrl)
    || normalizeLinkedInProfileUrl(normalizedExisting.identity?.publicProfileUrl) !== normalizeLinkedInProfileUrl(normalizedCurrent.identity?.publicProfileUrl)
    || JSON.stringify(normalizedExisting.identity?.knownProfileUrls || []) !== JSON.stringify(normalizedCurrent.identity?.knownProfileUrls || []);
  if (!shouldPersist) {
    return {
      currentPerson,
      stored,
      persisted: false
    };
  }
  const result = await upsertPersonRecord(currentPerson, stored);
  return {
    currentPerson: result.merged,
    stored: {
      ...stored,
      people: result.people,
      tabPersonBindings: result.tabPersonBindings,
      threadPersonBindings: result.threadPersonBindings
    },
    persisted: true
  };
}

async function ensureCurrentTabPersonBinding(pageContext, currentPerson, stored) {
  const sourceTabId = Number.isInteger(pageContext?.tabId) ? pageContext.tabId : null;
  const personId = normalizeWhitespace(currentPerson?.personId);
  if (sourceTabId === null || !personId) {
    return { stored, persisted: false };
  }

  const nextBindings = buildTabPersonBindings(stored?.people || {}, {
    ...(stored?.tabPersonBindings || {}),
    [String(sourceTabId)]: personId
  });
  if (normalizeWhitespace(nextBindings[String(sourceTabId)]) !== personId) {
    nextBindings[String(sourceTabId)] = personId;
  }
  if (normalizeWhitespace(stored?.tabPersonBindings?.[String(sourceTabId)]) === personId
    && JSON.stringify(nextBindings) === JSON.stringify(stored?.tabPersonBindings || {})) {
    return { stored, persisted: false };
  }

  await saveTabPersonBindings(nextBindings);
  return {
    stored: {
      ...stored,
      tabPersonBindings: nextBindings
    },
    persisted: true
  };
}

function validateChatGptThreadUrl(url) {
  const normalized = normalizeUrl(url);
  if (!normalized) {
    return "";
  }
  if (!isChatGptUrl(normalized)) {
    throw new Error("Enter a valid ChatGPT conversation URL.");
  }
  return normalized;
}

function buildImportedConversationRecord(conversation, sourcePageType, myProfile) {
  const importedAt = toIsoNow();
  const ownDisplayName = extractOwnProfileName(myProfile?.rawSnapshot) || "You";
  const messages = Array.isArray(conversation?.allVisibleMessages) && conversation.allVisibleMessages.length
    ? conversation.allVisibleMessages
    : Array.isArray(conversation?.recentMessages)
      ? conversation.recentMessages
      : [];

  if (!messages.length && !normalizeWhitespace(conversation?.rawThreadText)) {
    return null;
  }
  const normalizedMessages = messages
    .slice(-20)
    .map((entry) => ({
      sender: /^you(?:\s|$)/i.test(normalizeWhitespace(entry?.sender)) ? ownDisplayName : normalizeWhitespace(entry?.sender),
      text: normalizeWhitespace(entry?.text),
      timestamp: normalizeConversationTimestamp(entry?.timestamp, importedAt ? new Date(importedAt) : new Date())
    }));

  return {
    importedAt,
    sourcePageType: normalizeWhitespace(sourcePageType),
    lastSpeaker: /^you(?:\s|$)/i.test(normalizeWhitespace(conversation?.lastSpeaker)) ? ownDisplayName : normalizeWhitespace(conversation?.lastSpeaker),
    lastMessageAt: normalizeConversationTimestamp(conversation?.lastMessageAt, importedAt ? new Date(importedAt) : new Date()),
    messages: normalizedMessages,
    rawThreadText: normalizeWhitespace(conversation?.rawThreadText)
  };
}

function logConversationPersistence(eventName, personRecord, importedConversation) {
  const messages = Array.isArray(importedConversation?.messages) ? importedConversation.messages : [];
  const latestMessage = messages[0] || null;
  console.info("[LinkedIn Assistant]", eventName, {
    personId: normalizeWhitespace(personRecord?.personId),
    fullName: normalizeWhitespace(personRecord?.fullName),
    sourcePageType: normalizeWhitespace(importedConversation?.sourcePageType),
    messageCount: messages.length,
    lastSpeaker: normalizeWhitespace(importedConversation?.lastSpeaker),
    lastMessageAt: normalizeWhitespace(importedConversation?.lastMessageAt),
    latestMessageSender: normalizeWhitespace(latestMessage?.sender),
    latestMessageTimestamp: normalizeWhitespace(latestMessage?.timestamp)
  });
}

function logObservedMetricsPersistence(eventName, personRecord, observedMetrics, relationshipTriage) {
  console.info("[LinkedIn Assistant]", eventName, {
    personId: normalizeWhitespace(personRecord?.personId),
    fullName: normalizeWhitespace(personRecord?.fullName),
    knownMessageCount: Number(observedMetrics?.known_message_count || 0),
    knownInboundCount: Number(observedMetrics?.known_inbound_count || 0),
    knownOutboundCount: Number(observedMetrics?.known_outbound_count || 0),
    whoSpokeLast: normalizeWhitespace(observedMetrics?.who_spoke_last),
    lastKnownMessageAt: normalizeWhitespace(observedMetrics?.last_known_message_at),
    unansweredOutboundStreak: Number(observedMetrics?.unanswered_outbound_streak || 0),
    investmentDecision: normalizeWhitespace(relationshipTriage?.investment_decision),
    referralGate: normalizeWhitespace(relationshipTriage?.referral_gate),
    lastInteractionAt: normalizeWhitespace(personRecord?.lastInteractionAt)
  });
}

function logPersonResolution(eventName, payload) {
  console.info("[LinkedIn Assistant]", eventName, {
    sourceTabId: payload?.sourceTabId ?? null,
    activeTabId: payload?.activeTabId ?? null,
    providerTabId: payload?.providerTabId ?? null,
    pageType: normalizeWhitespace(payload?.pageType),
    pageUrl: normalizeWhitespace(payload?.pageUrl),
    previewPersonId: normalizeWhitespace(payload?.previewPersonId),
    previewProfileUrl: normalizeWhitespace(payload?.previewProfileUrl),
    previewThreadUrl: normalizeWhitespace(payload?.previewThreadUrl),
    tabBoundPersonId: normalizeWhitespace(payload?.tabBoundPersonId),
    finalTabBoundPersonId: normalizeWhitespace(payload?.finalTabBoundPersonId),
    matchType: normalizeWhitespace(payload?.matchType),
    matchedPersonId: normalizeWhitespace(payload?.matchedPersonId),
    matchedFullName: normalizeWhitespace(payload?.matchedFullName),
    currentPersonId: normalizeWhitespace(payload?.currentPersonId),
    currentPersonFullName: normalizeWhitespace(payload?.currentPersonFullName),
    currentThreadUrl: normalizeWhitespace(payload?.currentThreadUrl),
    requestedPersonId: normalizeWhitespace(payload?.requestedPersonId),
    requestedFullName: normalizeWhitespace(payload?.requestedFullName),
    requestedThreadUrl: normalizeWhitespace(payload?.requestedThreadUrl),
    draftGeneratedAt: normalizeWhitespace(payload?.draftGeneratedAt)
  });
}

function importedConversationSignature(importedConversation) {
  if (!importedConversation) {
    return "";
  }

  const messages = Array.isArray(importedConversation.messages)
    ? importedConversation.messages.map((entry) => ({
      sender: normalizeWhitespace(entry?.sender),
      text: normalizeWhitespace(entry?.text),
      timestamp: normalizeWhitespace(entry?.timestamp)
    }))
    : [];

  return JSON.stringify({
    sourcePageType: normalizeWhitespace(importedConversation.sourcePageType),
    lastSpeaker: normalizeWhitespace(importedConversation.lastSpeaker),
    lastMessageAt: normalizeWhitespace(importedConversation.lastMessageAt),
    rawThreadText: normalizeWhitespace(importedConversation.rawThreadText),
    messages
  });
}

function isSameImportedConversation(left, right) {
  return importedConversationSignature(left) === importedConversationSignature(right);
}

function requestedWorkspaceContextFromMessage(message, sourceTabId) {
  const requestPageContext = message?.requestContext?.pageContext;
  if (!requestPageContext || typeof requestPageContext !== "object") {
    return null;
  }
  if (normalizeWhitespace(requestPageContext?.pageType) === "linkedin-profile") {
    return null;
  }
  return {
    ...requestPageContext,
    tabId: typeof sourceTabId === "number"
      ? sourceTabId
      : (typeof requestPageContext?.tabId === "number" ? requestPageContext.tabId : null)
  };
}

function requestedPersonRecordFromMessage(message, stored) {
  const requestedRecord = buildFreshGenerationPersonRecord(message?.requestContext?.personRecord);
  if (!requestedRecord || typeof requestedRecord !== "object") {
    return null;
  }
  const requestedPersonId = normalizeWhitespace(requestedRecord.personId);
  if (requestedPersonId && stored?.people?.[requestedPersonId]) {
    return mergePersonRecord(stored.people[requestedPersonId], requestedRecord);
  }
  return requestedPersonId ? mergePersonRecord({ personId: requestedPersonId }, requestedRecord) : null;
}

function importDiagnosticsSuffix(workspaceContext) {
  const debug = workspaceContext?.debug || {};
  const details = [
    `recipient_name_found=${Boolean(debug.recipient_name_found)}`,
    `visible_message_count=${Number.isFinite(debug.visible_message_count) ? debug.visible_message_count : 0}`,
    `visible_candidate_count=${Number.isFinite(debug.visible_candidate_count) ? debug.visible_candidate_count : 0}`,
    `conversation_root_found=${Boolean(debug.conversation_root_found)}`
  ];
  return ` Diagnostics: ${details.join(", ")}.`;
}

function importStatusMessage(importedConversation, currentPerson, unchanged) {
  const parts = [];
  if (unchanged) {
    parts.push("Visible conversation unchanged.");
  } else if (importedConversation) {
    parts.push(`Imported ${importedConversation.messages.length} visible messages.`);
  }

  if (normalizeWhitespace(currentPerson?.recipientSummaryMemory)) {
    parts.push("Reused saved profile summary.");
  }

  return parts.join(" ");
}

function stableLogicMetricsSignature(metrics) {
  if (!metrics) {
    return "";
  }
  return JSON.stringify({
    page_type: normalizeWhitespace(metrics.page_type),
    is_connection: Boolean(metrics.is_connection),
    user_goal: normalizeWhitespace(metrics.user_goal),
    has_visible_thread: Boolean(metrics.has_visible_thread),
    has_imported_history: Boolean(metrics.has_imported_history),
    current_context_source: normalizeWhitespace(metrics.current_context_source),
    known_message_count: Number(metrics.known_message_count) || 0,
    known_inbound_count: Number(metrics.known_inbound_count) || 0,
    known_outbound_count: Number(metrics.known_outbound_count) || 0,
    has_ever_replied: Boolean(metrics.has_ever_replied),
    unanswered_outbound_streak: Number(metrics.unanswered_outbound_streak) || 0,
    who_spoke_last: normalizeWhitespace(metrics.who_spoke_last),
    first_known_message_at_raw: normalizeWhitespace(metrics.first_known_message_at_raw),
    first_known_message_at: normalizeWhitespace(metrics.first_known_message_at),
    last_known_message_at_raw: normalizeWhitespace(metrics.last_known_message_at_raw),
    last_known_message_at: normalizeWhitespace(metrics.last_known_message_at),
    last_known_inbound_at_raw: normalizeWhitespace(metrics.last_known_inbound_at_raw),
    last_known_inbound_at: normalizeWhitespace(metrics.last_known_inbound_at),
    last_known_outbound_at_raw: normalizeWhitespace(metrics.last_known_outbound_at_raw),
    last_known_outbound_at: normalizeWhitespace(metrics.last_known_outbound_at),
    known_conversation_span_days: metrics.known_conversation_span_days ?? null,
    timestamp_confidence: normalizeWhitespace(metrics.timestamp_confidence),
    context_confidence: normalizeWhitespace(metrics.context_confidence)
  });
}

function headlineQualityScore(value) {
  const text = normalizeWhitespace(value);
  const lower = text.toLowerCase();
  if (!text) {
    return 0;
  }
  if (/^(he\/him|she\/her|they\/them)(\s*[·|]\s*\d+(?:st|nd|rd|th))?$/i.test(text)) {
    return 1;
  }
  if (/^\d+(?:st|nd|rd|th)\b/i.test(lower)) {
    return 1;
  }
  let score = 2;
  if (/[|]/.test(text)) {
    score += 4;
  }
  if (/(manager|director|founder|student|mba|som|product|engineer|strategy|marketing|sales|ads|platform|banking|fintech|ai|risk|fraud|recruiter|talent|acquisition|specialist|analyst|consultant|associate|intern)/i.test(text)) {
    score += 3;
  }
  if (text.length >= 12 && text.length <= 160) {
    score += 2;
  }
  if (/(united states|india|singapore|canada|united kingdom|uk|new york|san francisco|connecticut|california|boston|seattle|area)/i.test(lower)) {
    score -= 2;
  }
  return score;
}

function preferBetterHeadline(nextHeadline, currentHeadline) {
  const nextText = normalizeWhitespace(nextHeadline);
  const currentText = normalizeWhitespace(currentHeadline);
  if (!currentText) {
    return nextText;
  }
  if (!nextText) {
    return currentText;
  }
  return headlineQualityScore(nextText) >= headlineQualityScore(currentText) ? nextText : currentText;
}

function buildObservedPersonUpdate(pageContext, personRecord, myProfile) {
  if (!personRecord?.personId) {
    return {};
  }

  const logicMetrics = buildLogicMetrics(pageContext, personRecord, myProfile);
  const relationshipTriage = buildRelationshipTriage(pageContext, personRecord, myProfile);
  const currentSignature = importedConversationSignature(getObservedConversation(personRecord));
  const recommendationSignature = normalizeWhitespace(personRecord.lastAiRecommendationMessageSignature);
  const shouldMarkStale = Boolean(
    personRecord.lastAiRecommendationAt
    && currentSignature
    && recommendationSignature
    && currentSignature !== recommendationSignature
  );

  return {
    lastLogicMetrics: logicMetrics,
    observedMetrics: logicMetrics,
    observedRelationshipTriage: relationshipTriage,
    lastPageType: normalizeWhitespace(pageContext?.pageType) || normalizeWhitespace(personRecord.lastPageType),
    lastInteractionAt: normalizeWhitespace(logicMetrics.last_known_message_at)
      || normalizeWhitespace(personRecord.lastInteractionAt),
    messagingThreadUrl: pageContext?.pageType === "linkedin-messaging"
      ? normalizeUrl(pageContext?.person?.messagingThreadUrl || pageContext?.conversation?.threadUrl || pageContext?.pageUrl) || normalizeUrl(personRecord.messagingThreadUrl)
      : normalizeUrl(personRecord.messagingThreadUrl),
    aiRecommendationStale: shouldMarkStale
  };
}

function buildProfileContextUpdate(pageContext, personRecord) {
  if (pageContext?.pageType !== "linkedin-profile" || !pageContext?.profile || !personRecord?.personId) {
    return {};
  }

  const nextProfileData = normalizeProfileData(pageContext.profile);
  if (!nextProfileData) {
    return {};
  }

  const profileContext = getProfileContext(personRecord);
  const previousProfileData = normalizeProfileData(profileContext.latestProfileData);
  const recentProfileChanges = describeProfileChanges(previousProfileData, nextProfileData);
  const recipientProfileMemory = buildRecipientProfileMemory(pageContext.profile, personRecord);
  const bestHeadline = preferBetterHeadline(nextProfileData.headline, profileContext.headline || personRecord.headline);

  return {
    identity: {
      fullName: nextProfileData.fullName || personRecord.fullName,
      firstName: nextProfileData.firstName || personRecord.firstName,
      profileUrl: nextProfileData.profileUrl || personRecord.profileUrl
    },
    profileContext: {
      ...profileContext,
      headline: bestHeadline,
      location: nextProfileData.location,
      connectionStatus: nextProfileData.connectionStatus || "unknown",
      profileSummary: nextProfileData.profileSummary,
      rawSnapshot: nextProfileData.rawSnapshot,
      latestActivitySnippets: nextProfileData.activitySnippets || [],
      lastActivitySyncedAt: toIsoNow(),
      recipientProfileMemory,
      latestProfileData: nextProfileData,
      lastProfileSyncedAt: toIsoNow(),
      recentProfileChanges,
      profileCaptureMode: "full"
    },
    updatedAt: toIsoNow()
  };
}

function isFullProfileExtractionContext(pageContext) {
  return pageContext?.pageType === "linkedin-profile"
    && (
      normalizeWhitespace(pageContext?.debug?.profile_timing_mode) === "full"
      || normalizeWhitespace(pageContext?.debug?.workspace_context_scroll_mode) === "full_profile"
    );
}

async function syncActivityContextIfNeeded(pageContext, stored, currentPerson) {
  if (pageContext?.pageType !== "linkedin-profile" || !pageContext?.profile || !currentPerson?.personId) {
    return {
      currentPerson,
      stored,
      activityChanged: false
    };
  }

  const nextProfileData = normalizeProfileData(pageContext.profile);
  const nextActivitySnippets = Array.isArray(nextProfileData?.activitySnippets) ? nextProfileData.activitySnippets : [];
  if (!nextActivitySnippets.length) {
    return {
      currentPerson,
      stored,
      activityChanged: false
    };
  }

  const profileContext = getProfileContext(currentPerson);
  const currentActivitySnippets = Array.isArray(profileContext?.latestActivitySnippets)
    ? profileContext.latestActivitySnippets
    : [];
  const changed = JSON.stringify(currentActivitySnippets) !== JSON.stringify(nextActivitySnippets)
    || !normalizeWhitespace(profileContext?.lastActivitySyncedAt);
  if (!changed) {
    return {
      currentPerson,
      stored,
      activityChanged: false
    };
  }

  const nextPerson = mergePersonRecord(currentPerson, {
    profileContext: {
      ...profileContext,
      latestActivitySnippets: nextActivitySnippets,
      lastActivitySyncedAt: toIsoNow()
    },
    updatedAt: toIsoNow()
  });
  const result = await upsertPersonRecord(nextPerson, stored);
  return {
    currentPerson: result.merged,
    stored: {
      ...stored,
      people: result.people,
      threadPersonBindings: result.threadPersonBindings
    },
    activityChanged: true
  };
}

function hasRecipientProfileSnapshot(personRecord) {
  const profileContext = getProfileContext(personRecord);
  return Boolean(
    normalizeWhitespace(profileContext?.profileCaptureMode) === "full"
    && (normalizeWhitespace(profileContext?.lastProfileSyncedAt) || normalizeWhitespace(personRecord?.lastProfileSyncedAt))
    && (
      normalizeWhitespace(profileContext?.rawSnapshot)
      || normalizeWhitespace(profileContext?.profileSummary)
      || profileContext?.latestProfileData
    )
  );
}

async function syncProfileContextIfNeeded(pageContext, stored, currentPerson, options) {
  const forceRefresh = Boolean(options?.forceRefresh);
  if (pageContext?.pageType !== "linkedin-profile" || !currentPerson?.personId) {
    return {
      currentPerson,
      stored,
      profileChanged: false
    };
  }
  if (!forceRefresh && hasRecipientProfileSnapshot(currentPerson)) {
    return {
      currentPerson,
      stored,
      profileChanged: false
    };
  }
  if (!isFullProfileExtractionContext(pageContext)) {
    return {
      currentPerson,
      stored,
      profileChanged: false
    };
  }

  const update = buildProfileContextUpdate(pageContext, currentPerson);
  if (!Object.keys(update).length) {
    return {
      currentPerson,
      stored,
      profileChanged: false
    };
  }

  const currentProfileContext = getProfileContext(currentPerson);
  const nextProfileContext = update.profileContext || {};
  const changed = normalizeWhitespace(nextProfileContext.recipientProfileMemory) !== normalizeWhitespace(currentProfileContext.recipientProfileMemory)
    || normalizeWhitespace(nextProfileContext.profileSummary) !== normalizeWhitespace(currentProfileContext.profileSummary)
    || normalizeWhitespace(nextProfileContext.rawSnapshot) !== normalizeWhitespace(currentProfileContext.rawSnapshot)
    || normalizeWhitespace(nextProfileContext.recentProfileChanges) !== normalizeWhitespace(currentProfileContext.recentProfileChanges)
    || normalizeWhitespace(nextProfileContext.profileCaptureMode) !== normalizeWhitespace(currentProfileContext.profileCaptureMode)
    || !normalizeWhitespace(currentProfileContext.lastProfileSyncedAt)
    || normalizeWhitespace(update.identity?.profileUrl) !== normalizeWhitespace(currentPerson.profileUrl)
    || normalizeWhitespace(nextProfileContext.headline) !== normalizeWhitespace(currentProfileContext.headline);

  if (!changed) {
    return {
      currentPerson,
      stored,
      profileChanged: false
    };
  }

  const nextPerson = mergePersonRecord(currentPerson, update);
  const result = await upsertPersonRecord(nextPerson, stored);
  return {
    currentPerson: result.merged,
    stored: {
      ...stored,
      people: result.people,
      threadPersonBindings: result.threadPersonBindings
    },
    profileChanged: true
  };
}

async function syncImportedConversationIfNeeded(pageContext, stored, currentPerson) {
  if (pageContext?.pageType !== "linkedin-messaging" || !currentPerson?.personId) {
    return {
      currentPerson,
      stored,
      importedChanged: false,
      syncMessage: "",
      syncResult: pageContext?.pageType !== "linkedin-messaging"
        ? "page_not_messaging"
        : "missing_person_id"
    };
  }

  const importedConversation = buildImportedConversationRecord(pageContext.conversation, pageContext.pageType, stored.myProfile);
  const currentObservedConversation = getObservedConversation(currentPerson);
  if (!importedConversation || isSameImportedConversation(currentObservedConversation, importedConversation)) {
    const observedUpdate = buildObservedPersonUpdate(pageContext, currentPerson, stored.myProfile);
    const shouldPersistObserved = stableLogicMetricsSignature(observedUpdate.lastLogicMetrics) !== stableLogicMetricsSignature(currentPerson.lastLogicMetrics)
      || Boolean(observedUpdate.aiRecommendationStale) !== Boolean(currentPerson.aiRecommendationStale)
      || normalizeWhitespace(observedUpdate.lastInteractionAt) !== normalizeWhitespace(currentPerson.lastInteractionAt)
      || normalizeUrl(observedUpdate.messagingThreadUrl) !== normalizeUrl(currentPerson.messagingThreadUrl);
    if (shouldPersistObserved) {
      const nextPerson = mergePersonRecord(currentPerson, observedUpdate);
      const result = await upsertPersonRecord(nextPerson, stored);
      logObservedMetricsPersistence("observed_metrics_persisted", result.merged, observedUpdate.observedMetrics, observedUpdate.observedRelationshipTriage);
      return {
        currentPerson: result.merged,
        stored: {
          ...stored,
          people: result.people,
          threadPersonBindings: result.threadPersonBindings
        },
        importedChanged: false,
        syncMessage: importedConversation ? "Visible conversation unchanged." : "No visible conversation found to auto-import.",
        syncResult: importedConversation ? "unchanged" : "no_visible_conversation"
      };
    }
    return {
      currentPerson,
      stored,
      importedChanged: false,
      syncMessage: importedConversation ? "Visible conversation unchanged." : "No visible conversation found to auto-import.",
      syncResult: importedConversation ? "unchanged" : "no_visible_conversation"
    };
  }

  const nextPerson = mergePersonRecord(currentPerson, {
    observedConversation: importedConversation,
    updatedAt: toIsoNow()
  });
  const observedUpdate = buildObservedPersonUpdate(pageContext, nextPerson, stored.myProfile);
  const result = await upsertPersonRecord(nextPerson, stored);
  const mergedWithObserved = mergePersonRecord(result.merged, observedUpdate);
  logConversationPersistence("conversation_imported", result.merged, importedConversation);
  const finalResult = stableLogicMetricsSignature(mergedWithObserved.lastLogicMetrics) !== stableLogicMetricsSignature(result.merged.lastLogicMetrics)
    || Boolean(mergedWithObserved.aiRecommendationStale) !== Boolean(result.merged.aiRecommendationStale)
    || normalizeWhitespace(mergedWithObserved.lastInteractionAt) !== normalizeWhitespace(result.merged.lastInteractionAt)
    || normalizeUrl(mergedWithObserved.messagingThreadUrl) !== normalizeUrl(result.merged.messagingThreadUrl)
      ? await upsertPersonRecord(mergedWithObserved, {
        ...stored,
        people: result.people,
        threadPersonBindings: result.threadPersonBindings
      })
      : result;
  if (finalResult.merged) {
    logObservedMetricsPersistence("observed_metrics_persisted", finalResult.merged, observedUpdate.observedMetrics, observedUpdate.observedRelationshipTriage);
  }
  return {
    currentPerson: finalResult.merged,
    stored: {
      ...stored,
      people: finalResult.people,
      threadPersonBindings: finalResult.threadPersonBindings
    },
    importedChanged: true,
    syncMessage: `Auto-imported ${importedConversation.messages.length} visible messages.`,
    syncResult: "imported"
  };
}

async function syncObservedStateIfNeeded(pageContext, stored, currentPerson) {
  if (!currentPerson?.personId) {
    return {
      currentPerson,
      stored,
      observedChanged: false
    };
  }

  const observedUpdate = buildObservedPersonUpdate(pageContext, currentPerson, stored.myProfile);
  const currentObservedMetrics = getObservedMetrics(currentPerson);
  const shouldPersistObserved = stableLogicMetricsSignature(observedUpdate.lastLogicMetrics) !== stableLogicMetricsSignature(currentObservedMetrics)
    || stableLogicMetricsSignature(observedUpdate.observedMetrics) !== stableLogicMetricsSignature(currentObservedMetrics)
    || Boolean(observedUpdate.aiRecommendationStale) !== Boolean(currentPerson.aiRecommendationStale)
    || normalizeWhitespace(observedUpdate.lastPageType) !== normalizeWhitespace(currentPerson.lastPageType)
    || normalizeWhitespace(observedUpdate.lastInteractionAt) !== normalizeWhitespace(currentPerson.lastInteractionAt)
    || normalizeUrl(observedUpdate.messagingThreadUrl) !== normalizeUrl(currentPerson.messagingThreadUrl);

  if (!shouldPersistObserved) {
    return {
      currentPerson,
      stored,
      observedChanged: false
    };
  }

  const nextPerson = mergePersonRecord(currentPerson, observedUpdate);
  const result = await upsertPersonRecord(nextPerson, stored);
  logObservedMetricsPersistence("observed_metrics_persisted", result.merged, observedUpdate.observedMetrics, observedUpdate.observedRelationshipTriage);
  return {
    currentPerson: result.merged,
    stored: {
      ...stored,
      people: result.people,
      threadPersonBindings: result.threadPersonBindings
    },
    observedChanged: true
  };
}

function notifyPageContextChanged(tabId, href, extra) {
  chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.PAGE_CONTEXT_CHANGED,
    tabId,
    href: normalizeWhitespace(href || ""),
    clickText: normalizeWhitespace(extra?.clickText || "")
  }).catch(() => {});
}

if (chrome.webNavigation?.onHistoryStateUpdated) {
  chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
    if (details.frameId !== 0) {
      return;
    }
    if (!/^https:\/\/www\.linkedin\.com\//i.test(details.url || "")) {
      return;
    }
    rememberLinkedInTab(details.tabId, details.url);
    notifyPageContextChanged(details.tabId, details.url);
  }, {
    url: [{ hostEquals: "www.linkedin.com" }]
  });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const reloadState = getMessagingReloadState(tabId);
  if (reloadState && changeInfo.status === "complete" && shouldAutoReloadMessagingUrl(tab?.url || changeInfo.url || reloadState.url)) {
    if (!reloadState.postReloadOverlayShown) {
      messagingReloadStateByTab.set(tabId, {
        ...reloadState,
        postReloadOverlayShown: true
      });
      safeSendMessage(tabId, {
        type: MESSAGE_TYPES.SHOW_PAGE_ACTIVITY_OVERLAY,
        title: "Getting LinkedIn data",
        message: "Loading messages…",
        autoHideMs: 1000
      }).catch(() => {});
    }
  }
  if (typeof tabId === "number" && !shouldAutoReloadMessagingUrl(changeInfo.url || tab?.url || "")) {
    clearMessagingReload(tabId);
  }
  if (!tab?.url || !/^https:\/\/www\.linkedin\.com\//i.test(tab.url)) {
    return;
  }
  rememberLinkedInTab(tabId, changeInfo.url || tab.url);
  if (changeInfo.url || changeInfo.status === "loading" || changeInfo.status === "complete") {
    notifyPageContextChanged(tabId, changeInfo.url || tab.url);
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    rememberLinkedInTab(tab.id, tab.url);
  } catch (_error) {
    // Ignore transient activation errors.
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearMessagingReload(tabId);
  const removedProviderBinding = providerTabBindings.get(tabId) || null;
  if (removedProviderBinding?.provider && typeof removedProviderBinding?.sourceTabId === "number") {
    sourceTabProviderBindings.delete(`${removedProviderBinding.provider}:${removedProviderBinding.sourceTabId}`);
  }
  providerTabBindings.delete(tabId);
  for (const [key, binding] of sourceTabProviderBindings.entries()) {
    if (binding?.sourceTabId === tabId || binding?.providerTabId === tabId) {
      sourceTabProviderBindings.delete(key);
    }
  }
  chrome.storage.local.get([STORAGE_KEYS.tabPersonBindings]).then((stored) => {
    const existingBindings = stored?.[STORAGE_KEYS.tabPersonBindings] || {};
    if (!(String(tabId) in existingBindings)) {
      return;
    }
    const nextBindings = { ...existingBindings };
    delete nextBindings[String(tabId)];
    return saveTabPersonBindings(nextBindings);
  }).catch(() => {});
});

async function maybeReloadMessagingTabOnce(pageContext, sourceTabId) {
  const targetTab = await getTabForRequest(sourceTabId);
  const tabId = targetTab?.id;
  const tabReloadState = getMessagingReloadState(tabId);
  return {
    reloaded: false,
    reloadInfo: {
      attempted: Boolean(tabReloadState),
      at: tabReloadState?.at || "",
      url: tabReloadState?.url || ""
    }
  };
}

async function executeGenerationJob(job) {
  const generationTiming = {
    draft_total_ms: 0,
    draft_get_stored_ms: 0,
    draft_extract_workspace_ms: 0,
    draft_canonicalize_identity_ms: 0,
    draft_load_person_ms: 0,
    draft_profile_sync_ms: 0,
    draft_sync_visible_conversation_ms: 0,
    draft_prompt_build_ms: 0,
    draft_llm_ms: 0,
    draft_time_to_llm_submit_ms: 0
  };
  const draftStartedAt = Date.now();
  const stepStartedAt0 = Date.now();
  let stored = await getStoredState();
  generationTiming.draft_get_stored_ms = roundMs(Date.now() - stepStartedAt0);
  if (!normalizeWhitespace(stored.myProfile?.ownProfileUrl) || !normalizeWhitespace(stored.myProfile?.rawSnapshot)) {
    throw new Error("Save your sender profile first with Update Profile before generating a draft.");
  }
  const requestId = normalizeWhitespace(job.requestId);
  const sourceTabId = typeof job.sourceTabId === "number" ? job.sourceTabId : null;
  const requestedPersonRecord = requestedPersonRecordFromMessage(job, stored);
  const requestedPersonId = normalizeWhitespace(job?.requestContext?.personRecord?.personId);
  const requestedFullName = normalizeWhitespace(job?.requestContext?.personRecord?.fullName);
  const requestedThreadUrl = normalizeWhitespace(
    job?.requestContext?.pageContext?.conversation?.threadUrl
    || job?.requestContext?.personRecord?.messagingThreadUrl
  );

  const requestedPageContext = job?.requestContext?.pageContext;
  const canReuseRequestedProfileContext = Boolean(
    requestedPageContext
    && typeof requestedPageContext === "object"
    && normalizeWhitespace(requestedPageContext?.pageType) === "linkedin-profile"
    && hasRecipientProfileSnapshot(requestedPersonRecord)
  );

  await sendGenerationProgress(requestId, sourceTabId, "Reading the current LinkedIn page...");
  let stepStartedAt = Date.now();
  let workspaceContext = canReuseRequestedProfileContext
    ? {
        ...requestedPageContext,
        tabId: typeof sourceTabId === "number"
          ? sourceTabId
          : (typeof requestedPageContext?.tabId === "number" ? requestedPageContext.tabId : null)
      }
    : (
        requestedWorkspaceContextFromMessage(job, sourceTabId)
        || await extractLinkedInWorkspaceContext(job.sourceTabId)
      );
  generationTiming.draft_extract_workspace_ms = roundMs(Date.now() - stepStartedAt);
  await sendGenerationProgress(requestId, sourceTabId, "Linking this page to the right person...");
  stepStartedAt = Date.now();
  const canonicalized = await canonicalizePageContextIdentity(workspaceContext, stored);
  generationTiming.draft_canonicalize_identity_ms = roundMs(Date.now() - stepStartedAt);
  workspaceContext = canonicalized.pageContext;
  stored = canonicalized.stored;
  await sendGenerationProgress(requestId, sourceTabId, "Loading saved context...");
  stepStartedAt = Date.now();
  let currentPerson = requestedPersonRecord || null;
  if (!currentPerson && requestedPersonId && stored.people?.[requestedPersonId]) {
    currentPerson = stored.people[requestedPersonId];
  }
  if (!currentPerson) {
    currentPerson = await loadCurrentPersonFromPage(workspaceContext, stored);
  }
  generationTiming.draft_load_person_ms = roundMs(Date.now() - stepStartedAt);
  if (!currentPerson?.personId) {
    throw new Error("Could not identify the current LinkedIn person.");
  }

  let syncedPerson = currentPerson;
  if (!hasRecipientProfileSnapshot(currentPerson)) {
    stepStartedAt = Date.now();
    const profileSyncResult = await syncProfileContextIfNeeded(workspaceContext, stored, currentPerson);
    generationTiming.draft_profile_sync_ms = roundMs(Date.now() - stepStartedAt);
    stored = profileSyncResult.stored;
    syncedPerson = profileSyncResult.currentPerson || currentPerson;
  }

  const personRecord = mergePersonRecord(syncedPerson, {
    personNote: typeof job.personNote === "string" ? job.personNote : syncedPerson.personNote,
    userGoal: typeof job.userGoal === "string" ? job.userGoal : syncedPerson.userGoal,
    updatedAt: toIsoNow()
  });
  const importedConversation = buildImportedConversationRecord(workspaceContext.conversation, workspaceContext.pageType, stored.myProfile);
  if (importedConversation && !isSameImportedConversation(getObservedConversation(personRecord), importedConversation)) {
    await sendGenerationProgress(requestId, sourceTabId, "Syncing visible conversation...");
    stepStartedAt = Date.now();
    personRecord.observedConversation = importedConversation;
    generationTiming.draft_sync_visible_conversation_ms = roundMs(Date.now() - stepStartedAt);
  }
  const observedBeforePrompt = await syncObservedStateIfNeeded(workspaceContext, stored, personRecord);
  syncedPerson = observedBeforePrompt.currentPerson || personRecord;
  stored = observedBeforePrompt.stored;
  await sendGenerationProgress(requestId, sourceTabId, "Preparing the draft prompt...");
  stepStartedAt = Date.now();
  const promptPayload = buildWorkspacePrompt(
    workspaceContext,
    syncedPerson,
    stored.myProfile,
    normalizeFixedTail(job.fixedTail || stored.fixedTail || FIXED_TAIL),
    stored.promptSettings,
    job.extraContext
  );
  generationTiming.draft_prompt_build_ms = roundMs(Date.now() - stepStartedAt);
  const llmRunner = normalizePromptSettings(stored.promptSettings || defaultPromptSettings());
  await sendGenerationProgress(
    requestId,
    sourceTabId,
    `Sending prompt to ${providerDisplayName(llmRunner.llmProvider)}...`,
    {
      personId: currentPerson?.personId || requestedPersonId,
      provider: llmRunner.llmProvider,
      status: "submitting",
      providerPrompt: promptPayload.prompt
    }
  );
  const generation = await enqueueChatGptRun(() => runPromptWithRetries(
    promptPayload.prompt,
    normalizeFixedTail(job.fixedTail || stored.fixedTail || FIXED_TAIL),
    {
      provider: llmRunner.llmProvider,
      entryUrl: llmRunner.llmEntryUrl,
      preferFreshTab: true
    },
    promptPayload.flowType,
    workspaceContext.profile || workspaceContext.person,
    {
      jobBinding: {
        personId: currentPerson?.personId || requestedPersonId,
        fullName: currentPerson?.fullName || requestedFullName,
        requestId,
        sourceTabId
      },
      onProgress: (text, meta) => sendGenerationProgress(requestId, sourceTabId, text, meta)
    }
  ));
  generationTiming.draft_llm_ms = roundMs(generation?.timings?.llm_total_ms || 0);
  generationTiming.draft_time_to_llm_submit_ms = roundMs(
    generationTiming.draft_extract_workspace_ms
    + generationTiming.draft_canonicalize_identity_ms
    + generationTiming.draft_load_person_ms
    + generationTiming.draft_profile_sync_ms
    + generationTiming.draft_sync_visible_conversation_ms
    + generationTiming.draft_prompt_build_ms
    + Number(generation?.timings?.llm_time_to_submit_ms || 0)
  );
  generationTiming.draft_total_ms = roundMs(Date.now() - draftStartedAt);

  if (!generation.ok) {
    return {
      ok: false,
      error: generation.error?.message || "Generation failed.",
      manualRecovery: {
        prompt: promptPayload.prompt,
        rawOutput: generation.rawOutput || ""
      },
      diagnostics: generationTiming,
      personId: currentPerson?.personId || requestedPersonId || "",
      requestId
    };
  }

  const workspace = {
    generatedAt: toIsoNow(),
    flowType: promptPayload.flowType,
    pageType: workspaceContext.pageType,
    llm_provider: normalizeLlmProvider(llmRunner.llmProvider),
    llm_thread_url: normalizeWhitespace(generation.threadUrl || ""),
    first_name: generation.result.first_name,
    recipient_summary: generation.result.recipient_summary,
    relationship_stage: generation.result.relationship_stage,
    recommended_action: generation.result.recommended_action,
    reason_why_now: generation.result.reason_why_now,
    is_referral_ready: generation.result.is_referral_ready,
    referral_readiness: generation.result.referral_readiness,
    ai_assessment: generation.result.ai_assessment,
    logic_metrics: promptPayload.logicMetrics,
    messages: generation.result.messages,
    relationship_triage: promptPayload.relationshipTriage,
    extra_context: normalizeWhitespace(job.extraContext),
    providerPrompt: promptPayload.prompt,
    rawOutput: generation.rawOutput,
    recipient_full_name: syncedPerson.fullName,
    recipient_profile_url: syncedPerson.profileUrl,
    conversation: workspaceContext.conversation || null
  };

  const savedPerson = mergePersonRecord(syncedPerson, {
    identity: {
      messagingThreadUrl: syncedPerson.messagingThreadUrl
    },
    profileContext: {
      ...getProfileContext(syncedPerson),
      recipientSummaryMemory: generation.result.recipient_summary || "",
      recipientProfileMemory: buildRecipientProfileMemory(workspaceContext.profile || workspaceContext.person || {}, syncedPerson)
    },
    relationshipContext: {
      userGoal: syncedPerson.userGoal,
      personNote: syncedPerson.personNote,
      relationshipStage: workspace.relationship_stage
    },
    lastRecommendedAction: workspace.recommended_action,
    lastReasonWhyNow: workspace.reason_why_now,
    lastLogicMetrics: workspace.logic_metrics,
    chatGptThreadUrl: normalizeLlmProvider(llmRunner.llmProvider) === "chatgpt"
      ? normalizeWhitespace(generation.threadUrl || syncedPerson.chatGptThreadUrl || "")
      : syncedPerson.chatGptThreadUrl,
    lastAiRecommendationAt: workspace.generatedAt,
    lastAiRecommendationMessageSignature: importedConversationSignature(getObservedConversation(syncedPerson)),
    aiRecommendationStale: false,
    aiProfileAssessment: workspace.ai_assessment,
    aiConversationAssessment: workspace.ai_assessment,
    draftWorkspace: workspace,
    lastInteractionAt: normalizeWhitespace(workspace.logic_metrics?.last_known_message_at) || syncedPerson.lastInteractionAt,
    lastPageType: workspaceContext.pageType,
    updatedAt: toIsoNow()
  });
  const result = await upsertPersonRecord(savedPerson, stored);
  logPersonResolution("generation_saved_to_person", {
    sourceTabId,
    activeTabId: workspaceContext?.tabId ?? null,
    providerTabId: generation?.providerTabId ?? null,
    pageType: normalizeWhitespace(workspaceContext?.pageType),
    pageUrl: normalizeWhitespace(workspaceContext?.pageUrl),
    previewPersonId: normalizeWhitespace(workspaceContext?.person?.personId),
    previewProfileUrl: normalizeWhitespace(workspaceContext?.person?.profileUrl || workspaceContext?.profile?.profileUrl),
    previewThreadUrl: normalizeWhitespace(workspaceContext?.conversation?.threadUrl || workspaceContext?.person?.messagingThreadUrl),
    matchType: "generation_save",
    matchedPersonId: normalizeWhitespace(syncedPerson?.personId),
    matchedFullName: normalizeWhitespace(syncedPerson?.fullName),
    currentPersonId: normalizeWhitespace(result?.merged?.personId),
    currentPersonFullName: normalizeWhitespace(result?.merged?.fullName),
    currentThreadUrl: normalizeWhitespace(result?.merged?.messagingThreadUrl),
    requestedPersonId,
    requestedFullName,
    requestedThreadUrl,
    draftGeneratedAt: normalizeWhitespace(getDraftWorkspace(result?.merged)?.generatedAt || workspace.generatedAt)
  });

  return {
    ok: true,
    prompt: promptPayload.prompt,
    workspace,
    personRecord: result.merged,
    personId: result?.merged?.personId || currentPerson?.personId || requestedPersonId || "",
    sourceTabId,
    requestId,
    diagnostics: {
      generationTiming: {
        ...generationTiming,
        ...(generation?.timings || {})
      },
      workspaceContextDebug: workspaceContext?.debug || null
    }
  };
}

function enqueueGenerationJob(job) {
  const requestId = normalizeWhitespace(job?.requestId) || `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const normalizedJob = {
    ...job,
    requestId
  };
  generationJobs.set(requestId, {
    requestId,
    personId: normalizeWhitespace(job?.requestContext?.personRecord?.personId || ""),
    sourceTabId: typeof job?.sourceTabId === "number" ? job.sourceTabId : null,
    provider: normalizeLlmProvider(job?.promptSettings?.llmProvider || DEFAULT_LLM_PROVIDER),
    status: "running",
    progressText: "Queued...",
    providerPrompt: "",
    progressPercent: 0,
    outputChars: 0,
    startedAt: toIsoNow(),
    updatedAt: toIsoNow()
  });
  void sendGenerationProgress(requestId, normalizedJob?.sourceTabId, "Queued...", {
    personId: normalizeWhitespace(job?.requestContext?.personRecord?.personId || ""),
    provider: normalizeLlmProvider(job?.promptSettings?.llmProvider || DEFAULT_LLM_PROVIDER),
    status: "queued",
    progressPercent: 0,
    outputChars: 0
  });
  void executeGenerationJob(normalizedJob)
    .then(async (result) => {
      if (result?.ok) {
        await sendGenerationLifecycleMessage(MESSAGE_TYPES.GENERATION_COMPLETE, result);
      } else {
        await sendGenerationLifecycleMessage(MESSAGE_TYPES.GENERATION_FAILED, result);
      }
    })
    .catch(async (error) => {
      await sendGenerationLifecycleMessage(MESSAGE_TYPES.GENERATION_FAILED, {
        ok: false,
        error: error?.message || String(error),
        manualRecovery: null,
        diagnostics: null,
        personId: normalizeWhitespace(normalizedJob?.requestContext?.personRecord?.personId || ""),
        sourceTabId: typeof normalizedJob?.sourceTabId === "number" ? normalizedJob.sourceTabId : null,
        requestId
      });
    })
    .finally(() => {
      generationJobs.delete(requestId);
    });
  return generationJobs.size;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === MESSAGE_TYPES.PAGE_CONTEXT_CHANGED && _sender?.tab?.id) {
        const tabId = _sender.tab.id;
        const senderFrameId = Number.isInteger(_sender?.frameId) ? _sender.frameId : 0;
        const href = senderFrameId === 0
          ? normalizeWhitespace(message.href || _sender.tab.url || "")
          : normalizeWhitespace(_sender.tab.url || "");
        rememberLinkedInTab(tabId, href);
        notifyPageContextChanged(tabId, href);
        sendResponse({ ok: true });
        return;
      }

      if (message.type === MESSAGE_TYPES.LINKEDIN_CLICK_TRACE) {
        const tabId = _sender?.tab?.id || null;
        const senderFrameId = Number.isInteger(_sender?.frameId) ? _sender.frameId : 0;
        if (senderFrameId !== 0) {
          sendResponse({ ok: true, ignored: true });
          return;
        }
        rememberLinkedInClickTrace(
          tabId,
          message.href,
          message.clickHref,
          message.clickText
        );
        if (typeof tabId === "number" && isLinkedInUrl(message.clickHref)) {
          trackPendingLinkedInNavigation(tabId, message.clickHref).catch(() => {});
        }
        notifyPageContextChanged(tabId, message.clickHref || message.href || "", {
          clickText: message.clickText || ""
        });
        sendResponse({ ok: true });
        return;
      }

      if (message.type === MESSAGE_TYPES.GET_STORAGE_STATE) {
        const storageStateTiming = {
          storage_state_total_ms: 0,
          storage_state_get_page_context_ms: 0,
          storage_state_messaging_reload_ms: 0,
          storage_state_canonicalize_identity_ms: 0,
          storage_state_match_resolution_ms: 0,
          storage_state_load_current_person_ms: 0,
          storage_state_activity_sync_ms: 0,
          storage_state_profile_sync_ms: 0,
          storage_state_import_sync_ms: 0,
          storage_state_persist_person_ms: 0
        };
        const storageStateStartedAt = Date.now();
        let stored = await getStoredState();
        let pageContext = await timedStep(storageStateTiming, "storage_state_get_page_context_ms", async () => getPageContext(message.sourceTabId));
        const messagingReload = await timedStep(storageStateTiming, "storage_state_messaging_reload_ms", async () => maybeReloadMessagingTabOnce(pageContext, message.sourceTabId));
        if (messagingReload.reloaded) {
          pageContext = {
            ...pageContext,
            supported: false,
            reason: "Refreshing messaging page once..."
          };
        }
        const hasSavedSenderProfile = Boolean(
          normalizeWhitespace(stored.myProfile?.ownProfileUrl)
          && normalizeWhitespace(stored.myProfile?.rawSnapshot)
        );
        const suppressPersonWorkflow = isPendingProfilePageContext(pageContext, stored);
        if (!hasSavedSenderProfile) {
          sendResponse({
            ok: true,
            myProfile: stored.myProfile,
            fixedTail: stored.fixedTail,
            promptSettings: stored.promptSettings,
            chatGptProjectUrl: stored.chatGptProjectUrl,
            allPeople: Object.values(stored.people || {}),
            generationJobs: generationJobsSnapshot(),
            pageContext,
            activeTabId: pageContext?.tabId || null,
            backgroundObservedLinkedInTabId: lastObservedLinkedInTabId,
            backgroundObservedLinkedInTabUrl: lastObservedLinkedInTabUrl,
            lastLinkedInClickTrace,
            pendingLinkedInNavigation,
            messagingReload,
            currentPerson: null,
            identityWarning: null,
            identityResolutionRequest: null,
            importedChanged: false,
            importSyncMessage: ""
          });
          return;
        }
        if (suppressPersonWorkflow) {
          sendResponse({
            ok: true,
            myProfile: stored.myProfile,
            fixedTail: stored.fixedTail,
            promptSettings: stored.promptSettings,
            chatGptProjectUrl: stored.chatGptProjectUrl,
            allPeople: Object.values(stored.people || {}),
            generationJobs: generationJobsSnapshot(),
            pageContext,
            activeTabId: pageContext?.tabId || null,
            backgroundObservedLinkedInTabId: lastObservedLinkedInTabId,
            backgroundObservedLinkedInTabUrl: lastObservedLinkedInTabUrl,
            lastLinkedInClickTrace,
            pendingLinkedInNavigation,
            messagingReload,
            currentPerson: null,
            identityWarning: null,
            identityResolutionRequest: null,
            importedChanged: false,
            importSyncMessage: ""
          });
          return;
        }
        const canonicalized = await timedStep(storageStateTiming, "storage_state_canonicalize_identity_ms", async () => canonicalizePageContextIdentity(pageContext, stored));
        pageContext = canonicalized.pageContext;
        stored = canonicalized.stored;
        const identityResolutionStartedAt = Date.now();
        const identityResolution = resolveStoredPersonMatch(pageContext, stored);
        storageStateTiming.storage_state_match_resolution_ms = roundMs(Date.now() - identityResolutionStartedAt);
        const identityResolutionRequest = canonicalized.identityResolutionRequest
          || buildMergeConfirmationResolutionRequest(pageContext, stored, identityResolution?.identityWarning)
          || null;
        let currentPerson = pageContext.supported
          ? await timedStep(storageStateTiming, "storage_state_load_current_person_ms", async () => loadCurrentPersonFromPage(pageContext, stored))
          : null;
        const resolutionDiagnostics = {
          sourceTabId: typeof message.sourceTabId === "number" ? message.sourceTabId : null,
          activeTabId: pageContext?.tabId ?? null,
          providerTabId: null,
          pageType: normalizeWhitespace(pageContext?.pageType),
          pageUrl: normalizeWhitespace(pageContext?.pageUrl),
          previewPersonId: normalizeWhitespace(pageContext?.person?.personId),
          previewProfileUrl: normalizeWhitespace(pageContext?.person?.profileUrl || pageContext?.profile?.profileUrl),
          previewThreadUrl: normalizeWhitespace(pageContext?.conversation?.threadUrl || pageContext?.person?.messagingThreadUrl),
          tabBoundPersonId: normalizeWhitespace(stored?.tabPersonBindings?.[String(pageContext?.tabId ?? "")]),
          matchType: normalizeWhitespace(identityResolution?.matchType),
          matchedPersonId: normalizeWhitespace(identityResolution?.matchedRecord?.personId),
          matchedFullName: normalizeWhitespace(identityResolution?.matchedRecord?.fullName),
          currentPersonId: normalizeWhitespace(currentPerson?.personId),
          currentPersonFullName: normalizeWhitespace(currentPerson?.fullName),
          currentThreadUrl: normalizeWhitespace(currentPerson?.messagingThreadUrl),
          draftGeneratedAt: normalizeWhitespace(getDraftWorkspace(currentPerson)?.generatedAt)
        };
        logPersonResolution("storage_state_person_resolution", resolutionDiagnostics);
        const awaitingMergeConfirmation = Boolean(identityResolution?.identityWarning?.status === "needs_merge_confirmation");
        if (currentPerson && awaitingMergeConfirmation) {
          currentPerson = mergePersonRecord(currentPerson, {
            identity: {
              identityStatus: "needs_merge_confirmation",
              identityConfidence: identityResolution.identityWarning.confidence || "low"
            }
          });
        }
        let importedChanged = false;
        let importSyncMessage = "";
        if (pageContext.supported && currentPerson && !awaitingMergeConfirmation) {
          const activitySyncResult = await timedStep(storageStateTiming, "storage_state_activity_sync_ms", async () => syncActivityContextIfNeeded(pageContext, stored, currentPerson));
          currentPerson = activitySyncResult.currentPerson;
          stored = activitySyncResult.stored;
          if (!hasRecipientProfileSnapshot(currentPerson)) {
            const profileSyncResult = await timedStep(storageStateTiming, "storage_state_profile_sync_ms", async () => syncProfileContextIfNeeded(pageContext, stored, currentPerson));
            currentPerson = profileSyncResult.currentPerson;
            stored = profileSyncResult.stored;
          }
          const syncResult = await timedStep(storageStateTiming, "storage_state_import_sync_ms", async () => syncImportedConversationIfNeeded(pageContext, stored, currentPerson));
          currentPerson = syncResult.currentPerson;
          stored = syncResult.stored;
          importedChanged = syncResult.importedChanged;
          importSyncMessage = syncResult.syncMessage || "";
          storageStateTiming.storage_state_import_sync_result = normalizeWhitespace(syncResult.syncResult || "");
          storageStateTiming.storage_state_import_sync_message = normalizeWhitespace(syncResult.syncMessage || "");
          const observedSyncResult = await timedStep(storageStateTiming, "storage_state_persist_person_ms", async () => syncObservedStateIfNeeded(pageContext, stored, currentPerson));
          currentPerson = observedSyncResult.currentPerson;
          stored = observedSyncResult.stored;
          const persistenceResult = await timedStep(storageStateTiming, "storage_state_persist_person_ms", async () => ensureCurrentPersonPersisted(currentPerson, stored));
          currentPerson = persistenceResult.currentPerson;
          stored = persistenceResult.stored;
          const tabBindingResult = await timedStep(storageStateTiming, "storage_state_persist_person_ms", async () => ensureCurrentTabPersonBinding(pageContext, currentPerson, stored));
          stored = tabBindingResult.stored;
        }
        resolutionDiagnostics.finalTabBoundPersonId = normalizeWhitespace(stored?.tabPersonBindings?.[String(pageContext?.tabId ?? "")]);
        storageStateTiming.storage_state_total_ms = roundMs(Date.now() - storageStateStartedAt);
        pageContext = mergePageContextDebug(pageContext, storageStateTiming);
        sendResponse({
          ok: true,
          myProfile: stored.myProfile,
          fixedTail: stored.fixedTail,
          promptSettings: stored.promptSettings,
          chatGptProjectUrl: stored.chatGptProjectUrl,
          allPeople: Object.values(stored.people || {}),
          generationJobs: generationJobsSnapshot(),
          pageContext,
          activeTabId: pageContext?.tabId || null,
          backgroundObservedLinkedInTabId: lastObservedLinkedInTabId,
          backgroundObservedLinkedInTabUrl: lastObservedLinkedInTabUrl,
          lastLinkedInClickTrace,
          pendingLinkedInNavigation,
          messagingReload,
          currentPerson,
          resolutionDiagnostics,
          identityWarning: identityResolution?.identityWarning || null,
          identityResolutionRequest,
          importedChanged,
          importSyncMessage
        });
        return;
      }

      if (message.type === MESSAGE_TYPES.RESOLVE_PROFILE_IDENTITY) {
        let stored = await getStoredState();
        const requestMode = normalizeWhitespace(message.requestMode);
        const requestedOpaqueProfileUrl = normalizeLinkedInProfileUrl(message.profileUrl);
        let pageContext = await getPageContext(message.sourceTabId);
        const canonicalized = await canonicalizePageContextIdentity(pageContext, stored, {
          allowHiddenTabResolution: true,
          forceHiddenTabResolution: true,
          allowMergeConfirmationLookup: requestMode === "merge_confirmation"
        });
        pageContext = canonicalized.pageContext;
        stored = canonicalized.stored;
        let currentPerson = pageContext.supported ? await loadCurrentPersonFromPage(pageContext, stored) : null;
        let importedChanged = false;
        let importSyncMessage = "";
        if (pageContext.supported && currentPerson) {
          if (!hasRecipientProfileSnapshot(currentPerson)) {
            const profileSyncResult = await syncProfileContextIfNeeded(pageContext, stored, currentPerson);
            currentPerson = profileSyncResult.currentPerson;
            stored = profileSyncResult.stored;
          }
          const syncResult = await syncImportedConversationIfNeeded(pageContext, stored, currentPerson);
          currentPerson = syncResult.currentPerson;
          stored = syncResult.stored;
          importedChanged = syncResult.importedChanged;
          importSyncMessage = syncResult.syncMessage || "";
          const persistenceResult = await ensureCurrentPersonPersisted(currentPerson, stored);
          currentPerson = persistenceResult.currentPerson;
          stored = persistenceResult.stored;
          const tabBindingResult = await ensureCurrentTabPersonBinding(pageContext, currentPerson, stored);
          stored = tabBindingResult.stored;
        }
        if (requestMode === "resolve_identity" && requestedOpaqueProfileUrl) {
          stored = await markIdentityResolutionPromptSeen(requestedOpaqueProfileUrl, stored);
        }
        sendResponse({
          ok: true,
          pageContext,
          currentPerson,
          importedChanged,
          importSyncMessage
        });
        return;
      }

      if (message.type === MESSAGE_TYPES.MARK_IDENTITY_RESOLUTION_SEEN) {
        let stored = await getStoredState();
        const profileUrl = normalizeLinkedInProfileUrl(message.profileUrl);
        if (profileUrl) {
          stored = await markIdentityResolutionPromptSeen(profileUrl, stored);
        }
        sendResponse({ ok: true });
        return;
      }

      if (message.type === MESSAGE_TYPES.UPDATE_MY_PROFILE) {
        const activeTab = await getTabForRequest(message.sourceTabId);
        if (!activeTab?.url || !activeTab.url.startsWith("https://www.linkedin.com/in/")) {
          throw new Error("Open your own main LinkedIn profile page before updating your sender profile.");
        }

        const response = await sendLinkedInMessageToFrame(activeTab.id, 0, {
          type: MESSAGE_TYPES.EXTRACT_SELF_PROFILE
        });
        if (!response?.ok) {
          sendResponse({
            ok: false,
            error: response?.error || "Unable to extract your LinkedIn profile.",
            extractedProfile: response?.profile || null,
            extractedProfileDebug: {
              ...(response?.debug || {}),
              update_my_profile_frame_id: Number.isInteger(response?._frameId) ? response._frameId : 0,
              update_my_profile_response_error: normalizeWhitespace(response?.error || "")
            }
          });
          return;
        }

        const stored = await getStoredState();
        const extractedProfile = response.profile || null;
        const fallbackRawSnapshot = normalizeWhitespace([
          normalizeWhitespace(extractedProfile?.fullName),
          normalizeWhitespace(extractedProfile?.headline),
          normalizeWhitespace(extractedProfile?.location),
          normalizeWhitespace(extractedProfile?.about)
        ].filter(Boolean).join("\n"));
        const profile = {
          ownProfileUrl: normalizeLinkedInProfileUrl(activeTab.url)
            || normalizeLinkedInProfileUrl(extractedProfile?.profileUrl || ""),
          manualNotes: stored.myProfile?.manualNotes || "",
          rawSnapshot: response.draft?.rawSnapshot || extractedProfile?.rawSnapshot || fallbackRawSnapshot,
          updatedAt: toIsoNow()
        };
        if (!profile.ownProfileUrl) {
          profile.ownProfileUrl = normalizeLinkedInProfileUrl(stored.myProfile?.ownProfileUrl || "");
        }
        sendResponse({
          ok: true,
          profile,
          extractedProfile: response.profile,
          extractedProfileDebug: {
            ...(response.debug || {}),
            update_my_profile_frame_id: Number.isInteger(response?._frameId) ? response._frameId : 0,
            update_my_profile_payload: {
              ownProfileUrl: normalizeWhitespace(profile.ownProfileUrl || ""),
              rawSnapshotLength: normalizeWhitespace(profile.rawSnapshot || "").length,
              fallbackRawSnapshotLength: fallbackRawSnapshot.length,
              extractedProfileUrl: normalizeWhitespace(extractedProfile?.profileUrl || ""),
              extractedRawSnapshotLength: normalizeWhitespace(extractedProfile?.rawSnapshot || "").length,
              draftRawSnapshotLength: normalizeWhitespace(response.draft?.rawSnapshot || "").length
            }
          }
        });
        return;
      }

      if (message.type === MESSAGE_TYPES.UPDATE_RECIPIENT_PROFILE_CONTEXT) {
        let stored = await getStoredState();
        let workspaceContext = await extractLinkedInWorkspaceContext(message.sourceTabId, {
          frameId: 0,
          forceScrollPass: true
        });
        const canonicalized = await canonicalizePageContextIdentity(workspaceContext, stored);
        workspaceContext = canonicalized.pageContext;
        stored = canonicalized.stored;
        if (workspaceContext.pageType !== "linkedin-profile") {
          throw new Error("Open the recipient's LinkedIn profile before refreshing profile context.");
        }
        if (!isFullProfileExtractionContext(workspaceContext)) {
          throw new Error("LinkedIn did not finish loading the full profile yet.");
        }
        let currentPerson = await loadCurrentPersonFromPage(workspaceContext, stored);
        if (!currentPerson?.personId) {
          throw new Error("Could not identify the current LinkedIn person on this profile page.");
        }
        const profileSyncResult = await syncProfileContextIfNeeded(workspaceContext, stored, currentPerson, { forceRefresh: true });
        currentPerson = profileSyncResult.currentPerson || currentPerson;
        stored = profileSyncResult.stored;
        const persistenceResult = await ensureCurrentPersonPersisted(currentPerson, stored);
        currentPerson = persistenceResult.currentPerson || currentPerson;
        stored = persistenceResult.stored || stored;
        const tabBindingResult = await ensureCurrentTabPersonBinding(workspaceContext, currentPerson, stored);
        stored = tabBindingResult.stored;
        sendResponse({
          ok: true,
          personRecord: currentPerson,
          profileDebug: workspaceContext?.debug || null
        });
        return;
      }

      if (message.type === MESSAGE_TYPES.OPEN_PERSON_MESSAGES) {
        const targetTab = await getTabForRequest(message.sourceTabId);
        const profileUrl = normalizeLinkedInProfileUrl(message.profileUrl || "");
        const openMessagesStartedAt = Date.now();
        if (!targetTab?.id) {
          throw new Error("Could not find the active LinkedIn tab.");
        }
        if (!profileUrl) {
          throw new Error("No LinkedIn profile URL is saved for this person yet.");
        }
        const currentUrl = normalizeLinkedInProfileUrl(targetTab.url || "") || normalizeWhitespace(targetTab.url || "");
        const requiresNavigation = currentUrl.replace(/\/+$/, "") !== profileUrl.replace(/\/+$/, "");
        if (requiresNavigation) {
          await chrome.tabs.update(targetTab.id, { url: profileUrl, active: true });
          await waitForTabComplete(targetTab.id, 12000);
          await delay(700);
        }
        const response = await sendLinkedInMessageToFrame(targetTab.id, 0, {
          type: MESSAGE_TYPES.OPEN_CURRENT_PROFILE_MESSAGES
        });
        if (!response?.ok) {
          throw new Error(response?.error || "Unable to open LinkedIn messages from this profile.");
        }
        const postClickSettleDelayMs = 1500;
        await delay(postClickSettleDelayMs);
        const waitedForFrame = await waitForLinkedInMessagingFrame(targetTab.id, 8000);
        const openMessagesDebug = {
          actionHref: normalizeWhitespace(response?.actionHref || ""),
          actionText: normalizeWhitespace(response?.actionText || ""),
          initialSurfaceResult: normalizeWhitespace(response?.surfaceResult || ""),
          postClickSettleDelayMs,
          totalElapsedMs: roundMs(Date.now() - openMessagesStartedAt),
          waitedForFrameId: Number.isInteger(waitedForFrame?.probe?.frameId) ? waitedForFrame.probe.frameId : null,
          waitAttempts: Array.isArray(waitedForFrame?.attempts) ? waitedForFrame.attempts : [],
          finalFrameProbes: Array.isArray(waitedForFrame?.probes)
            ? waitedForFrame.probes.slice(0, 5).map((probe) => ({
              frameId: probe.frameId,
              href: normalizeWhitespace(probe.href || ""),
              pathname: normalizeWhitespace(probe.pathname || ""),
              overlayPresent: Boolean(probe.overlayPresent),
              contentWrapperPresent: Boolean(probe.contentWrapperPresent),
              messageListPresent: Boolean(probe.messageListPresent),
              messageBubbleCount: Number(probe.messageBubbleCount) || 0,
              messageBodyCount: Number(probe.messageBodyCount) || 0,
              eventCount: Number(probe.eventCount) || 0,
              textLength: Number(probe.textLength) || 0,
              readyState: normalizeWhitespace(probe.readyState || ""),
              sampleText: normalizeWhitespace(probe.sampleText || "")
            }))
            : []
        };
        if (waitedForFrame?.probe?.frameId != null) {
          let frameWorkspaceContext = await sendLinkedInMessageToFrame(targetTab.id, waitedForFrame.probe.frameId, {
            type: MESSAGE_TYPES.EXTRACT_WORKSPACE_CONTEXT
          });
          if (!frameWorkspaceContext?.ok || frameWorkspaceContext?.pageType !== "linkedin-messaging") {
            frameWorkspaceContext = await extractLinkedInMessagingWorkspaceFromFrame(
              targetTab.id,
              waitedForFrame.probe.frameId,
              normalizeWhitespace(targetTab.url || "")
            );
          }
          if (frameWorkspaceContext?.ok && frameWorkspaceContext?.pageType === "linkedin-messaging") {
            response.workspaceContext = {
              ...frameWorkspaceContext,
              debug: {
                ...(frameWorkspaceContext?.debug || {}),
                background_open_messages_waited_frame_id: waitedForFrame.probe.frameId,
                background_open_messages_waited_frame_probes: waitedForFrame.probes.slice(0, 5).map((probe) => ({
                  frameId: probe.frameId,
                  href: normalizeWhitespace(probe.href || ""),
                  messageListPresent: Boolean(probe.messageListPresent),
                  eventCount: Number(probe.eventCount) || 0,
                  textLength: Number(probe.textLength) || 0
                }))
              }
            };
            response.surfaceResult = "messaging_frame_detected";
            openMessagesDebug.frameExtractionResult = "messaging_frame_detected";
            openMessagesDebug.workspaceFrameId = Number.isInteger(frameWorkspaceContext?._frameId) ? frameWorkspaceContext._frameId : waitedForFrame.probe.frameId;
            openMessagesDebug.workspaceVisibleMessageCount = Array.isArray(frameWorkspaceContext?.conversation?.allVisibleMessages)
              ? frameWorkspaceContext.conversation.allVisibleMessages.length
              : Array.isArray(frameWorkspaceContext?.conversation?.recentMessages)
                ? frameWorkspaceContext.conversation.recentMessages.length
                : 0;
          } else {
            openMessagesDebug.frameExtractionResult = "frame_detected_but_workspace_not_messaging";
          }
        } else {
          openMessagesDebug.frameExtractionResult = "no_ready_frame_detected";
        }
        let autoImport = {
          result: normalizeWhitespace(response?.surfaceResult || ""),
          syncMessage: "",
          importedChanged: false,
          visibleMessageCount: 0
        };
        let personRecord = null;
        if (response?.workspaceContext?.pageType === "linkedin-messaging") {
          let stored = await getStoredState();
          let workspaceContext = {
            ...response.workspaceContext,
            tabId: targetTab.id
          };
          const canonicalized = await canonicalizePageContextIdentity(workspaceContext, stored);
          workspaceContext = canonicalized.pageContext;
          stored = canonicalized.stored;
          let currentPerson = await loadCurrentPersonFromPage(workspaceContext, stored);
          if (currentPerson?.personId) {
            const syncResult = await syncImportedConversationIfNeeded(workspaceContext, stored, currentPerson);
            currentPerson = syncResult.currentPerson;
            stored = syncResult.stored;
            autoImport = {
              result: normalizeWhitespace(syncResult.syncResult || response?.surfaceResult || ""),
              syncMessage: normalizeWhitespace(syncResult.syncMessage || ""),
              importedChanged: Boolean(syncResult.importedChanged),
              visibleMessageCount: Array.isArray(workspaceContext?.conversation?.allVisibleMessages)
                ? workspaceContext.conversation.allVisibleMessages.length
                : Array.isArray(workspaceContext?.conversation?.recentMessages)
                  ? workspaceContext.conversation.recentMessages.length
                  : 0
            };
            const observedSyncResult = await syncObservedStateIfNeeded(workspaceContext, stored, currentPerson);
            currentPerson = observedSyncResult.currentPerson;
            stored = observedSyncResult.stored;
            const persistenceResult = await ensureCurrentPersonPersisted(currentPerson, stored);
            personRecord = persistenceResult.currentPerson || currentPerson;
          }
        }
        sendResponse({
          ok: true,
          profileUrl,
          navigatedToProfile: requiresNavigation,
          autoImport,
          personRecord,
          openMessagesDebug: {
            ...(response?.debug || {}),
            ...openMessagesDebug,
            finalSurfaceResult: normalizeWhitespace(response?.surfaceResult || ""),
            finalElapsedMs: roundMs(Date.now() - openMessagesStartedAt)
          }
        });
        return;
      }

      if (message.type === MESSAGE_TYPES.SET_PENDING_MY_PROFILE_TARGET) {
        const stored = await getStoredState();
        const pendingProfileUrl = normalizeLinkedInProfileUrl(message.ownProfileUrl || "");
        const myProfile = {
          ...stored.myProfile,
          pendingProfileUrl
        };
        await chrome.storage.local.set({ [STORAGE_KEYS.myProfile]: myProfile });
        sendResponse({ ok: true, myProfile });
        return;
      }

      if (message.type === MESSAGE_TYPES.SAVE_MY_PROFILE) {
        const profile = {
          ownProfileUrl: normalizeLinkedInProfileUrl(message.profile?.ownProfileUrl || ""),
          pendingProfileUrl: "",
          manualNotes: message.profile?.manualNotes || "",
          rawSnapshot: message.profile?.rawSnapshot || "",
          updatedAt: toIsoNow()
        };
        let stored = await getStoredState();
        stored = await removePeopleMatchingProfileUrl(profile.ownProfileUrl, stored);
        await chrome.storage.local.set({ [STORAGE_KEYS.myProfile]: profile });
        const persisted = (await chrome.storage.local.get([STORAGE_KEYS.myProfile]))?.[STORAGE_KEYS.myProfile] || null;
        sendResponse({
          ok: true,
          profile,
          diagnostics: {
            requestedOwnProfileUrl: normalizeWhitespace(message.profile?.ownProfileUrl || ""),
            normalizedOwnProfileUrl: normalizeWhitespace(profile.ownProfileUrl || ""),
            requestedRawSnapshotLength: normalizeWhitespace(message.profile?.rawSnapshot || "").length,
            persistedOwnProfileUrl: normalizeWhitespace(persisted?.ownProfileUrl || ""),
            persistedRawSnapshotLength: normalizeWhitespace(persisted?.rawSnapshot || "").length,
            persistedPendingProfileUrl: normalizeWhitespace(persisted?.pendingProfileUrl || "")
          }
        });
        return;
      }

      if (message.type === MESSAGE_TYPES.SAVE_FIXED_TAIL) {
        const fixedTail = normalizeFixedTail(message.fixedTail);
        await chrome.storage.local.set({ [STORAGE_KEYS.fixedTail]: fixedTail });
        sendResponse({ ok: true, fixedTail });
        return;
      }

      if (message.type === MESSAGE_TYPES.SAVE_PROMPT_SETTINGS) {
        const promptSettings = normalizePromptSettings(message.promptSettings || {});
        const updates = {
          [STORAGE_KEYS.promptSettings]: promptSettings
        };
        if (normalizeLlmProvider(promptSettings.llmProvider) === "chatgpt") {
          updates[STORAGE_KEYS.chatGptProjectUrl] = promptSettings.llmEntryUrl || DEFAULT_CHATGPT_PROJECT_URL;
        }
        await chrome.storage.local.set(updates);
        sendResponse({ ok: true, promptSettings });
        return;
      }

      if (message.type === MESSAGE_TYPES.SAVE_CHATGPT_PROJECT_URL) {
        const chatGptProjectUrl = normalizeWhitespace(message.chatGptProjectUrl) || DEFAULT_CHATGPT_PROJECT_URL;
        const stored = await getStoredState();
        const promptSettings = normalizePromptSettings({
          ...(stored.promptSettings || {}),
          llmProvider: "chatgpt",
          llmEntryUrl: chatGptProjectUrl
        });
        await chrome.storage.local.set({
          [STORAGE_KEYS.chatGptProjectUrl]: chatGptProjectUrl,
          [STORAGE_KEYS.promptSettings]: promptSettings
        });
        sendResponse({ ok: true, chatGptProjectUrl });
        return;
      }

      if (message.type === MESSAGE_TYPES.SAVE_PERSON_NOTE) {
        let stored = await getStoredState();
        let pageContext = await getPageContext(message.sourceTabId);
        const canonicalized = await canonicalizePageContextIdentity(pageContext, stored);
        pageContext = canonicalized.pageContext;
        stored = canonicalized.stored;
        const currentPerson = await loadCurrentPersonFromPage(pageContext, stored);
        const targetId = normalizeWhitespace(message.personId) || currentPerson?.personId;
        if (!targetId) {
          throw new Error("No active person is available to save a note for.");
        }

        const basePerson = currentPerson?.personId === targetId
          ? currentPerson
          : mergePersonRecord(stored.people?.[targetId], { personId: targetId });
        const personRecord = mergePersonRecord(basePerson, {
          personNote: message.personNote || "",
          updatedAt: toIsoNow()
        });
        const result = await upsertPersonRecord(personRecord, stored);
        sendResponse({ ok: true, personRecord: result.merged });
        return;
      }

      if (message.type === MESSAGE_TYPES.SAVE_PERSON_GOAL) {
        let stored = await getStoredState();
        let pageContext = await getPageContext(message.sourceTabId);
        const canonicalized = await canonicalizePageContextIdentity(pageContext, stored);
        pageContext = canonicalized.pageContext;
        stored = canonicalized.stored;
        const currentPerson = await loadCurrentPersonFromPage(pageContext, stored);
        const targetId = normalizeWhitespace(message.personId) || currentPerson?.personId;
        if (!targetId) {
          throw new Error("No active person is available to save a goal for.");
        }

        const basePerson = currentPerson?.personId === targetId
          ? currentPerson
          : mergePersonRecord(stored.people?.[targetId], { personId: targetId });
        const personRecord = mergePersonRecord(basePerson, {
          userGoal: normalizeUserGoal(message.userGoal),
          updatedAt: toIsoNow()
        });
        const result = await upsertPersonRecord(personRecord, stored);
        sendResponse({ ok: true, personRecord: result.merged });
        return;
      }

      if (message.type === MESSAGE_TYPES.SAVE_PERSON_THREAD_URL) {
        let stored = await getStoredState();
        let pageContext = await getPageContext(message.sourceTabId);
        const canonicalized = await canonicalizePageContextIdentity(pageContext, stored);
        pageContext = canonicalized.pageContext;
        stored = canonicalized.stored;
        const currentPerson = await loadCurrentPersonFromPage(pageContext, stored);
        const targetId = normalizeWhitespace(message.personId) || currentPerson?.personId;
        if (!targetId) {
          throw new Error("No active person is available to link a thread to.");
        }

        const threadUrl = validateChatGptThreadUrl(message.chatGptThreadUrl || "");
        const basePerson = currentPerson?.personId === targetId
          ? currentPerson
          : mergePersonRecord(stored.people?.[targetId], { personId: targetId });
        const personRecord = mergePersonRecord(basePerson, {
          chatGptThreadUrl: threadUrl,
          updatedAt: toIsoNow()
        });
        const result = await upsertPersonRecord(personRecord, stored);
        sendResponse({ ok: true, personRecord: result.merged });
        return;
      }

      if (message.type === MESSAGE_TYPES.IMPORT_CURRENT_CONVERSATION) {
        let stored = await getStoredState();
        let workspaceContext = await extractLinkedInWorkspaceContext(message.sourceTabId);
        const canonicalized = await canonicalizePageContextIdentity(workspaceContext, stored);
        workspaceContext = canonicalized.pageContext;
        stored = canonicalized.stored;
        if (workspaceContext.pageType !== "linkedin-messaging") {
          throw new Error("Open a LinkedIn messaging thread to import conversation history.");
        }

        const currentPerson = await loadCurrentPersonFromPage(workspaceContext, stored);
        if (!currentPerson?.personId) {
          throw new Error(`Could not identify the current LinkedIn person on this messaging page.${importDiagnosticsSuffix(workspaceContext)}`);
        }

        const importedConversation = buildImportedConversationRecord(workspaceContext.conversation, workspaceContext.pageType, stored.myProfile);
        if (!importedConversation) {
          throw new Error(`No visible conversation history was found to import.${importDiagnosticsSuffix(workspaceContext)}`);
        }

        if (isSameImportedConversation(getObservedConversation(currentPerson), importedConversation)) {
          sendResponse({
            ok: true,
            unchanged: true,
            personRecord: currentPerson,
            diagnostics: {
              visibleMessageCount: importedConversation.messages.length,
              syncMessage: importStatusMessage(importedConversation, currentPerson, true)
            }
          });
          return;
        }

        const personRecord = mergePersonRecord(currentPerson, {
          observedConversation: importedConversation,
          updatedAt: toIsoNow()
        });
        const observedUpdate = buildObservedPersonUpdate(workspaceContext, personRecord, stored.myProfile);
        const result = await upsertPersonRecord(mergePersonRecord(personRecord, observedUpdate), stored);
        sendResponse({
          ok: true,
          personRecord: result.merged,
          diagnostics: {
            visibleMessageCount: importedConversation.messages.length,
            syncMessage: importStatusMessage(importedConversation, result.merged, false)
          }
        });
        return;
      }

      if (message.type === MESSAGE_TYPES.CLEAR_IMPORTED_CONVERSATION) {
        let stored = await getStoredState();
        let pageContext = await getPageContext(message.sourceTabId);
        const canonicalized = await canonicalizePageContextIdentity(pageContext, stored);
        pageContext = canonicalized.pageContext;
        stored = canonicalized.stored;
        const currentPerson = await loadCurrentPersonFromPage(pageContext, stored);
        const targetId = normalizeWhitespace(message.personId) || currentPerson?.personId;
        if (!targetId) {
          throw new Error("No active person is available to clear conversation history for.");
        }

        const basePerson = currentPerson?.personId === targetId
          ? currentPerson
          : mergePersonRecord(stored.people?.[targetId], { personId: targetId });
        const personRecord = mergePersonRecord(basePerson, {
          observedConversation: null,
          updatedAt: toIsoNow()
        });
        const result = await upsertPersonRecord(personRecord, stored);
        sendResponse({ ok: true, personRecord: result.merged });
        return;
      }

      if (message.type === MESSAGE_TYPES.GENERATE_FOR_RECIPIENT) {
        let stored = await getStoredState();
        if (!normalizeWhitespace(stored.myProfile?.ownProfileUrl) || !normalizeWhitespace(stored.myProfile?.rawSnapshot)) {
          throw new Error("Save your sender profile first with Update Profile before generating a draft.");
        }
        const requestedPersonId = normalizeWhitespace(message?.requestContext?.personRecord?.personId);
        if (!requestedPersonId) {
          throw new Error("Wait for the person to resolve before drafting.");
        }
        const requestedPersonRecord = mergePersonRecord(
          stored.people?.[requestedPersonId],
          message?.requestContext?.personRecord || { personId: requestedPersonId }
        );
        if (!hasRecipientProfileSnapshot(requestedPersonRecord)) {
          throw new Error("Save the recipient profile first before drafting.");
        }
        const queuePosition = enqueueGenerationJob({ ...message, sourceTabId: message.sourceTabId });
        sendResponse({
          ok: true,
          queued: true,
          requestId: normalizeWhitespace(message.requestId),
          personId: requestedPersonId,
          queuePosition
        });
        return;
      }

      if (message.type === MESSAGE_TYPES.READ_LATEST_CHATGPT_RESPONSE || message.type === MESSAGE_TYPES.READ_LATEST_PROVIDER_RESPONSE) {
        let stored = await getStoredState();
        let pageContext = await getPageContext();
        const canonicalized = await canonicalizePageContextIdentity(pageContext, stored);
        pageContext = canonicalized.pageContext;
        stored = canonicalized.stored;
        const explicitPersonId = normalizeWhitespace(message.personId);
        const currentPerson = explicitPersonId && stored.people?.[explicitPersonId]
          ? stored.people[explicitPersonId]
          : (pageContext.supported ? await loadCurrentPersonFromPage(pageContext, stored) : null);
        const promptSettings = normalizePromptSettings(stored.promptSettings || defaultPromptSettings());
        const provider = normalizeLlmProvider(promptSettings.llmProvider);
        const providerName = providerDisplayName(provider);
        const boundProviderTab = getProviderTabBinding(provider, {
          personId: currentPerson?.personId,
          sourceTabId: typeof message.sourceTabId === "number" ? message.sourceTabId : null
        });
        const providerTab = boundProviderTab?.tabId
          ? await chrome.tabs.get(boundProviderTab.tabId).catch(() => null)
          : await getPreferredProviderTab(provider);
        if (!providerTab?.id) {
          throw new Error(`No ${providerName} tab is available to read from.`);
        }

        const readResponse = await safeSendMessage(providerTab.id, {
          type: MESSAGE_TYPES.READ_RESPONSE,
          maxWaitMs: 6000,
          stallWaitMs: 12000
        });
        if (!readResponse?.ok) {
          throw new Error(readResponse?.error || `Unable to read the latest ${providerName} response.`);
        }

        const rawOutput = readResponse.rawOutput || "";
        if (!normalizeWhitespace(rawOutput)) {
          throw new Error(`No ${providerName} response was found in that tab yet.`);
        }

        try {
          const result = validateWorkspaceResult(
            shared.extractJsonFromText(rawOutput),
            normalizeFixedTail(message.fixedTail || stored.fixedTail || FIXED_TAIL),
            normalizeWhitespace(message.flowType),
            {
              fullName: normalizeWhitespace(message.recipientFullName)
            }
          );
          const workspace = {
            generatedAt: toIsoNow(),
            flowType: normalizeWhitespace(message.flowType),
            pageType: normalizeWhitespace(message.pageType),
            first_name: result.first_name,
            recipient_summary: result.recipient_summary,
            relationship_stage: result.relationship_stage,
            recommended_action: result.recommended_action,
            reason_why_now: result.reason_why_now,
            is_referral_ready: result.is_referral_ready,
            referral_readiness: result.referral_readiness,
            ai_assessment: result.ai_assessment,
            logic_metrics: currentPerson ? buildLogicMetrics(pageContext, currentPerson, stored.myProfile) : null,
            messages: result.messages,
            rawOutput,
            recipient_full_name: normalizeWhitespace(message.recipientFullName),
            recipient_profile_url: normalizeWhitespace(message.recipientProfileUrl)
          };
          let savedPerson = null;
          if (currentPerson?.personId) {
            const mergedPerson = mergePersonRecord(currentPerson, {
              lastRecommendedAction: workspace.recommended_action,
              lastReasonWhyNow: workspace.reason_why_now,
              lastLogicMetrics: workspace.logic_metrics,
              lastAiRecommendationAt: workspace.generatedAt,
              draftWorkspace: workspace,
              aiRecommendationStale: false,
              updatedAt: toIsoNow()
            });
            const persisted = await upsertPersonRecord(mergedPerson, stored);
            savedPerson = persisted.merged;
          }
          sendResponse({
            ok: true,
            personRecord: savedPerson,
            workspace
          });
          return;
        } catch (error) {
          sendResponse({
            ok: false,
            error: error.message || String(error),
            manualRecovery: {
              prompt: message.prompt || "",
              rawOutput
            }
          });
          return;
        }
      }

      if (message.type === MESSAGE_TYPES.FACTORY_RESET) {
        resetRuntimeCaches();
        await initializeStorageDefaults(true);
        sendResponse({ ok: true });
        return;
      }

      throw new Error(`Unsupported message type: ${normalizeWhitespace(message.type)}`);
    } catch (error) {
      sendResponse({ ok: false, error: error.message || String(error) });
    }
  })();
  return true;
});
