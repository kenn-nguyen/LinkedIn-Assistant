importScripts("identity.js", "shared.js", "prompt-pack-runtime.js", "prompt.js", "job-outreach-ai.js");

const shared = globalThis.LinkedInAssistantShared;
const prompts = globalThis.LinkedInAssistantPrompts;
const promptPackRuntime = globalThis.LumiPromptPackRuntime;
const jobOutreachAi = globalThis.LumiJobOutreachAI;
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
  cleanLinkedInCompanyDisplayName,
  normalizeConnectionStatus,
  normalizeConversationTimestamp,
  normalizeLinkedInProfileUrl,
  normalizeProfileData,
  normalizePersonRecord,
  normalizeUserGoal,
  normalizeUrl,
  normalizeWhitespace,
  serializeError,
  toIsoNow,
  uniqueStrings
} = shared;
const {
  DEFAULT_CHATGPT_PROJECT_URL,
  DEFAULT_LLM_PROVIDER,
  FIXED_TAIL,
  defaultLlmEntryUrl,
  buildPostSuggestionPrompt,
  buildRetryPrompt,
  buildWorkspacePrompt,
  isChatGptUrl,
  isGeminiUrl,
  normalizeDraftCharacterLimit,
  normalizeFixedTail,
  normalizeLlmProvider,
  normalizePromptSettings,
  providerDisplayName,
  validatePostSuggestionResult,
  validateWorkspaceResult,
  defaultPromptSettings
} = prompts;
const {
  defaultPromptPackSettings,
  normalizePromptPackSettings
} = promptPackRuntime;

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
const POST_SUGGESTION_CONTRACT_VERSION = "linkedin_post_suggestions_v1";
const LINKEDIN_CONTENT_SCRIPT_FILES = [
  "identity.js",
  "shared.js",
  "linkedin-profile-extraction.js",
  "linkedin-library/jobs/extraction.js",
  "linkedin-library/posts/extraction.js",
  "linkedin-people-search-extraction.js",
  "linkedin-commands.js",
  "linkedin-content.js"
];
const lastProviderTabIds = {
  chatgpt: null,
  gemini: null
};
const providerTabBindings = new Map();
const sourceTabProviderBindings = new Map();
const generationJobs = new Map();
const pendingJobOutreachRuns = new Map();
const linkedInProfileResolutionInFlight = new Map();
const linkedInTabUrls = new Map();
const sidePanelSessionPorts = new Set();
const PROFILE_CLICK_IDENTITY_MAX_AGE_MS = 2 * 60 * 1000;
const PENDING_PROFILE_IDENTITY_HANDOFF_MAX_AGE_MS = 2 * 60 * 1000;
const SIDEPANEL_SESSION_PORT_NAME = "sidepanel-session";
const pendingProfileIdentityHandoffsByTabId = new Map();
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
const promptPackReadyPromise = promptPackRuntime.ensureReady().catch((error) => {
  console.error("Unable to preload prompt pack runtime", error);
  throw error;
});

async function ensurePromptPackReady(settings) {
  if (settings) {
    return promptPackRuntime.ensureReady(settings);
  }
  return promptPackReadyPromise;
}

function resetRuntimeCaches() {
  providerTabBindings.clear();
  sourceTabProviderBindings.clear();
  generationJobs.clear();
  pendingJobOutreachRuns.clear();
  linkedInProfileResolutionInFlight.clear();
  messagingReloadStateByTab.clear();
  linkedInTabUrls.clear();
  sidePanelSessionPorts.clear();
  pendingProfileIdentityHandoffsByTabId.clear();
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
    try {
      const db = await openDatabase();
      await Promise.all([
        idbClear(db, "people"),
        idbClear(db, "jobOutreachRuns"),
        idbClear(db, "jobOutreachJobs"),
        idbClear(db, "profileRedirects"),
        idbClear(db, "identityResolutionSeen"),
        idbClear(db, "meta")
      ]);
    } catch (_error) {
      // IndexedDB may not be ready yet during a full reset
    }
  }

  try {
    await migrateFromChromeStorage();
  } catch (error) {
    console.warn("[Lumi] Migration failed, will retry next startup:", error);
  }

  const migrated = await isMigrated();

  const current = await chrome.storage.local.get([
    STORAGE_KEYS.fixedTail,
    STORAGE_KEYS.myProfile,
    STORAGE_KEYS.promptSettings,
    STORAGE_KEYS.promptPackSettings,
    STORAGE_KEYS.chatGptProjectUrl,
    ...(migrated ? [] : [
      STORAGE_KEYS.people,
      STORAGE_KEYS.jobOutreach,
      STORAGE_KEYS.profileRedirects,
      STORAGE_KEYS.identityResolutionSeenOpaqueUrls
    ]),
    STORAGE_KEYS.tabPersonBindings,
    STORAGE_KEYS.threadPersonBindings
  ]);

  const nextState = {};
  if (!Object.prototype.hasOwnProperty.call(current, STORAGE_KEYS.fixedTail)) {
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
  if (!current[STORAGE_KEYS.promptPackSettings]) {
    nextState[STORAGE_KEYS.promptPackSettings] = defaultPromptPackSettings();
  }
  if (!current[STORAGE_KEYS.chatGptProjectUrl]) {
    nextState[STORAGE_KEYS.chatGptProjectUrl] = DEFAULT_CHATGPT_PROJECT_URL;
  }
  if (!migrated) {
    if (!current[STORAGE_KEYS.people]) {
      nextState[STORAGE_KEYS.people] = {};
    }
    if (!current[STORAGE_KEYS.jobOutreach]) {
      nextState[STORAGE_KEYS.jobOutreach] = { jobsById: {}, filterCache: {}, runsById: {}, runOrder: [], queue: [], activeRunId: "" };
    }
    if (!current[STORAGE_KEYS.profileRedirects]) {
      nextState[STORAGE_KEYS.profileRedirects] = {};
    }
    if (!current[STORAGE_KEYS.identityResolutionSeenOpaqueUrls]) {
      nextState[STORAGE_KEYS.identityResolutionSeenOpaqueUrls] = {};
    }
  }
  if (!current[STORAGE_KEYS.tabPersonBindings]) {
    nextState[STORAGE_KEYS.tabPersonBindings] = {};
  }
  if (!current[STORAGE_KEYS.threadPersonBindings]) {
    nextState[STORAGE_KEYS.threadPersonBindings] = {};
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

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== SIDEPANEL_SESSION_PORT_NAME) {
    return;
  }
  sidePanelSessionPorts.add(port);
  getActiveTab().then((tab) => {
    if (tab?.id && isLinkedInUrl(tab.url || "")) {
      rememberLinkedInTab(tab.id, tab.url);
    }
  }).catch(() => {});
  syncAssistantActivationForKnownLinkedInTabs().catch(() => {});
  port.onDisconnect.addListener(() => {
    sidePanelSessionPorts.delete(port);
    syncAssistantActivationForKnownLinkedInTabs().catch(() => {});
  });
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
  linkedInTabUrls.set(tabId, normalizeWhitespace(url));
  lastObservedLinkedInTabId = tabId;
  lastObservedLinkedInTabUrl = normalizeWhitespace(url);
  // Only sync this one tab — in-page SPA navigation should not deactivate
  // other tabs. Full multi-tab sync happens only on real tab switches
  // (onActivated) and sidepanel connect/disconnect.
  syncAssistantActivationForTab(tabId).catch(() => {});
}

function isAssistantSessionActive() {
  return sidePanelSessionPorts.size > 0;
}

async function syncAssistantActivationForTab(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) {
    return;
  }
  const tabUrl = normalizeWhitespace(linkedInTabUrls.get(tabId) || "");
  if (!isLinkedInUrl(tabUrl)) {
    return;
  }
  await sendActivationMessage(tabId, isAssistantSessionActive());
}

// Send SET_ASSISTANT_ACTIVE without ever injecting content scripts.
// Activation messages must not trigger injection — injecting mid-page on a
// LinkedIn SPA tab can disrupt navigation and cause blank/grey pages.
// If the content script is not present, the tab is already in the default
// inactive state so there is nothing to do.
async function sendActivationMessage(tabId, active) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: MESSAGE_TYPES.SET_ASSISTANT_ACTIVE,
      active: Boolean(active)
    });
  } catch {
    // Content script not present — tab is already inactive by default. Ignore.
  }
}

async function syncAssistantActivationForKnownLinkedInTabs() {
  const sessionActive = isAssistantSessionActive();
  // Only the most recently focused LinkedIn tab is activated.
  // All other open LinkedIn tabs are deactivated so their MutationObservers
  // and polling timers stop running in the background.
  const tasks = Array.from(linkedInTabUrls.keys()).map((tabId) => {
    const shouldBeActive = sessionActive && tabId === lastObservedLinkedInTabId;
    return sendActivationMessage(tabId, shouldBeActive);
  });
  await Promise.all(tasks);
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

function setPendingProfileIdentityHandoff(tabId, personRecord, targetHref) {
  if (!Number.isInteger(tabId) || tabId < 0) {
    return null;
  }
  const personId = normalizeWhitespace(personRecord?.personId);
  if (!personId) {
    return null;
  }
  const handoff = {
    personId,
    recordUuid: normalizeWhitespace(personRecord?.uuid || personRecord?.system?.recordUuid),
    fullName: normalizeWhitespace(personRecord?.fullName),
    headline: normalizeWhitespace(personRecord?.headline),
    targetHref: normalizeLinkedInProfileUrl(targetHref),
    startedAt: toIsoNow(),
    resolvedAt: "",
    publicProfileUrl: ""
  };
  pendingProfileIdentityHandoffsByTabId.set(tabId, handoff);
  return handoff;
}

function clearPendingProfileIdentityHandoff(tabId) {
  if (!Number.isInteger(tabId)) {
    return;
  }
  pendingProfileIdentityHandoffsByTabId.delete(tabId);
}

function getPendingProfileIdentityHandoffForPage(pageContext, stored) {
  if (pageContext?.pageType !== "linkedin-profile") {
    return null;
  }
  const tabId = Number.isInteger(pageContext?.tabId) ? pageContext.tabId : null;
  if (tabId === null) {
    return null;
  }
  const pending = pendingProfileIdentityHandoffsByTabId.get(tabId);
  if (!pending) {
    return null;
  }
  const startedAt = Date.parse(normalizeWhitespace(pending.startedAt));
  if (!Number.isFinite(startedAt) || Math.max(0, Date.now() - startedAt) > PENDING_PROFILE_IDENTITY_HANDOFF_MAX_AGE_MS) {
    pendingProfileIdentityHandoffsByTabId.delete(tabId);
    return null;
  }
  const people = stored?.people || {};
  const personId = normalizeWhitespace(pending.personId);
  const record = personId ? people[personId] : null;
  if (!record) {
    return null;
  }
  const pageFullName = normalizeWhitespace(pageContext?.person?.fullName || pageContext?.profile?.fullName);
  const pageProfileUrl = normalizeLinkedInProfileUrl(pageContext?.pageUrl || pageContext?.person?.profileUrl || pageContext?.profile?.profileUrl);
  if (
    recordMatchesExplicitPageIdentity(record, pageContext)
    || recordMatchesProfileNameHeadline(record, pageContext)
    || (pageFullName && hasMatchingNameEvidence(record, { fullName: pageFullName }))
    || (pageProfileUrl && pageProfileUrl === normalizeLinkedInProfileUrl(pending.publicProfileUrl || pending.targetHref))
  ) {
    return { record, handoff: pending };
  }
  return null;
}

async function maybeResolvePendingProfileIdentityHandoff(tabId, tabUrl) {
  if (!Number.isInteger(tabId) || tabId < 0) {
    return;
  }
  const pending = pendingProfileIdentityHandoffsByTabId.get(tabId);
  if (!pending) {
    return;
  }
  const normalizedTabUrl = normalizeLinkedInProfileUrl(tabUrl);
  if (
    !normalizedTabUrl
    || !/^https:\/\/www\.linkedin\.com\/in\//i.test(normalizedTabUrl)
    || shouldResolveLinkedInProfileUrl(normalizedTabUrl)
  ) {
    return;
  }
  const startedAt = Date.parse(normalizeWhitespace(pending.startedAt));
  if (!Number.isFinite(startedAt) || Math.max(0, Date.now() - startedAt) > PENDING_PROFILE_IDENTITY_HANDOFF_MAX_AGE_MS) {
    pendingProfileIdentityHandoffsByTabId.delete(tabId);
    return;
  }

  let stored = await getStoredState();
  let targetPerson = stored?.people?.[normalizeWhitespace(pending.personId)] || null;
  if (!targetPerson) {
    pendingProfileIdentityHandoffsByTabId.delete(tabId);
    return;
  }

  const linkedPerson = linkProfileUrlToPersonRecord(targetPerson, normalizedTabUrl);
  const upsertResult = await upsertPersonRecord(linkedPerson, stored);
  stored = {
    ...stored,
    people: upsertResult.people,
    tabPersonBindings: upsertResult.tabPersonBindings,
    threadPersonBindings: upsertResult.threadPersonBindings
  };
  const tabBindingResult = await ensureCurrentTabPersonBinding({ tabId }, upsertResult.merged, stored);
  stored = tabBindingResult.stored;
  pendingProfileIdentityHandoffsByTabId.set(tabId, {
    ...pending,
    personId: normalizeWhitespace(upsertResult.merged?.personId || pending.personId),
    recordUuid: normalizeWhitespace(upsertResult.merged?.uuid || upsertResult.merged?.system?.recordUuid || pending.recordUuid),
    fullName: normalizeWhitespace(upsertResult.merged?.fullName || pending.fullName),
    headline: normalizeWhitespace(upsertResult.merged?.headline || pending.headline),
    publicProfileUrl: normalizedTabUrl,
    resolvedAt: toIsoNow()
  });
}

function isMissingReceiverError(error) {
  const text = error?.message || String(error || "");
  return /receiving end does not exist|could not establish connection|message channel closed before a response was received|message port closed before a response was received/i.test(text);
}

function buildOpenPersonMessagesTabCreateProperties(sourceTab, profileUrl) {
  const url = normalizeLinkedInProfileUrl(profileUrl || "") || normalizeWhitespace(profileUrl || "");
  const createProperties = {
    url,
    active: true
  };
  if (Number.isInteger(sourceTab?.windowId)) {
    createProperties.windowId = sourceTab.windowId;
  }
  if (Number.isInteger(sourceTab?.index)) {
    createProperties.index = sourceTab.index + 1;
  }
  if (Number.isInteger(sourceTab?.id)) {
    createProperties.openerTabId = sourceTab.id;
  }
  return createProperties;
}

function linkedInMessageErrorText(error) {
  if (isMissingReceiverError(error)) {
    return "LinkedIn reloaded before the page responded.";
  }
  return error?.message || String(error || "");
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

async function isContentScriptAlreadyInjected(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Boolean(window.__lumiAssistInjected)
    });
    return results?.[0]?.result === true;
  } catch {
    return false;
  }
}

async function injectContentScriptsForTab(tab) {
  if (!tab?.id || !tab?.url) {
    throw new Error("Cannot inject content scripts without a valid tab.");
  }

  if (tab.url.startsWith("https://www.linkedin.com/")) {
    if (await isContentScriptAlreadyInjected(tab.id)) {
      return;
    }
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: LINKEDIN_CONTENT_SCRIPT_FILES
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
        return { ok: false, error: linkedInMessageErrorText(retryError) };
      }
    }
    return { ok: false, error: linkedInMessageErrorText(error) };
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
      files: LINKEDIN_CONTENT_SCRIPT_FILES
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
    if (attempts.length >= 5) {
      attempts.shift();
    }
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
  const responsePageUrl = normalizeWhitespace(response?.pageUrl || "");
  const frameId = Number(response?._frameId);
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
  } else if (response.pageType === "linkedin-job") {
    score += 120;
  } else if (response.pageType === "linkedin-people-search") {
    score += 110;
  } else if (response.pageType === "linkedin-post") {
    score += 105;
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
  if (normalizeWhitespace(response?.job?.title || "") && normalizeWhitespace(response?.job?.company || "")) {
    score += 40;
  }
  if (response.pageType === "linkedin-job" && normalizeWhitespace(response?.job?.description || "")) {
    score += 90;
  }
  if (Number(response?.peopleSearch?.resultCount || 0) > 0) {
    score += 30;
  }
  if (normalizeWhitespace(response?.postDiscussion?.postText || "")) {
    score += 40;
  }
  if (Number(response?.postDiscussion?.commentCount || 0) > 0) {
    score += 20;
  }
  if (Number.isInteger(frameId) && frameId === 0) {
    score += response.pageType === "unsupported" ? 120 : 25;
  }
  if (/^about:blank$/i.test(responsePageUrl)) {
    score -= 260;
  }
  if (/\/preload\/?$/i.test(responsePageUrl) && !(response.pageType === "linkedin-job" && response.supported)) {
    score -= 220;
  }
  if (/^https:\/\/www\.linkedin\.com\/tscp-serving\/dtag\b/i.test(responsePageUrl)) {
    score -= 180;
  }
  return score;
}

function isStrongLinkedInFrameResponse(response, messageType) {
  if (!response?.ok) {
    return false;
  }
  if (messageType === MESSAGE_TYPES.GET_PAGE_CONTEXT || messageType === MESSAGE_TYPES.EXTRACT_WORKSPACE_CONTEXT) {
    if (response.pageType === "linkedin-messaging") {
      const conversation = response?.conversation || {};
      const visibleMessageCount = Array.isArray(conversation?.allVisibleMessages)
        ? conversation.allVisibleMessages.length
        : Array.isArray(conversation?.recentMessages)
          ? conversation.recentMessages.length
          : 0;
      return Boolean(response.supported && visibleMessageCount > 0);
    }
    if (response.pageType === "linkedin-profile") {
      return Boolean(response.supported && normalizeWhitespace(response?.profile?.fullName || response?.person?.fullName));
    }
    if (response.pageType === "linkedin-job") {
      return Boolean(response.supported && normalizeWhitespace(response?.job?.title || "") && normalizeWhitespace(response?.job?.company || ""));
    }
    if (response.pageType === "linkedin-people-search") {
      return Boolean(response.supported);
    }
    if (response.pageType === "linkedin-post") {
      return Boolean(response.supported && normalizeWhitespace(response?.postDiscussion?.postText || response?.postDiscussion?.postUrl || ""));
    }
  }
  return false;
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
    || message?.type === MESSAGE_TYPES.EXTRACT_WORKSPACE_CONTEXT
    || message?.type === MESSAGE_TYPES.CAPTURE_LINKEDIN_POST_DISCUSSION;
  const frameProbes = shouldProbeFrames ? await probeLinkedInFrames(tabId) : [];
  const probeOrderedFrameIds = frameProbes.map((probe) => probe.frameId);
  const fallbackFrameIds = await getLinkedInFrameIds(tabId);
  const frameIds = shouldProbeFrames
    ? Array.from(new Set([
      ...probeOrderedFrameIds.slice(0, 3),
      0,
      ...probeOrderedFrameIds.slice(3, 5),
      ...fallbackFrameIds.slice(0, 3)
    ]))
    : Array.from(new Set([
      ...probeOrderedFrameIds,
      ...fallbackFrameIds
    ]));
  const responses = [];
  for (const frameId of frameIds) {
    const response = await sendLinkedInMessageToFrame(tabId, frameId, message);
    if (response) {
      responses.push(response);
      if (isStrongLinkedInFrameResponse(response, message?.type)) {
        return response;
      }
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
    return { ok: false, error: linkedInMessageErrorText(error) };
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
    await persistProfileRedirect(normalized, normalized);
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
  await persistProfileRedirect(normalized, resolvedUrl || normalized);
  if (resolvedUrl) {
    await persistProfileRedirect(resolvedUrl, resolvedUrl);
  }
  return {
    resolvedUrl: resolvedUrl || normalized,
    stored: {
      ...stored,
      profileRedirects: nextRedirects
    }
  };
}

async function persistProfileRedirect(sourceUrl, targetUrl) {
  if (await isMigrated()) {
    const db = await openDatabase();
    await idbPut(db, "profileRedirects", { sourceUrl, targetUrl, createdAt: toIsoNow() });
  } else {
    const current = (await chrome.storage.local.get([STORAGE_KEYS.profileRedirects]))?.[STORAGE_KEYS.profileRedirects] || {};
    current[sourceUrl] = targetUrl;
    await chrome.storage.local.set({ [STORAGE_KEYS.profileRedirects]: current });
  }
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
    const boundRecord = boundPersonId ? stored?.people?.[boundPersonId] : null;
    if (boundRecord && recordMatchesExplicitPageIdentity(boundRecord, pageContext)) {
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
  const now = toIsoNow();
  const nextSeen = {
    ...existing,
    [normalized]: now
  };
  if (await isMigrated()) {
    const db = await openDatabase();
    await idbPut(db, "identityResolutionSeen", { opaqueUrl: normalized, seenAt: now });
  } else {
    await chrome.storage.local.set({ [STORAGE_KEYS.identityResolutionSeenOpaqueUrls]: nextSeen });
  }
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

function inferLinkedInPageTypeFromUrl(url) {
  const normalized = normalizeWhitespace(url || "");
  if (/^https:\/\/www\.linkedin\.com\/messaging\b/i.test(normalized)) {
    return "linkedin-messaging";
  }
  if (/^https:\/\/www\.linkedin\.com\/in\/[^/]+(?:\/.*)?$/i.test(normalized)) {
    return "linkedin-profile";
  }
  if (
    /^https:\/\/www\.linkedin\.com\/jobs\/view\/\d+/i.test(normalized)
    || (
      /^https:\/\/www\.linkedin\.com\/jobs(?:[/?#]|$)/i.test(normalized)
      && /[?&]currentJobId=\d+/i.test(normalized)
    )
  ) {
    return "linkedin-job";
  }
  if (/^https:\/\/www\.linkedin\.com\/search\/results\/people\/?/i.test(normalized)) {
    return "linkedin-people-search";
  }
  if (
    /^https:\/\/www\.linkedin\.com\/feed(?:[/?#]|\/update\/|$)/i.test(normalized)
    || /^https:\/\/www\.linkedin\.com\/posts(?:[/?#]|$)/i.test(normalized)
    || /^https:\/\/www\.linkedin\.com\/company\/[^/]+\/posts(?:[/?#]|$)/i.test(normalized)
  ) {
    return "linkedin-post";
  }
  return "unsupported";
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
      reason: "Open a LinkedIn profile, messaging thread, job, or people search to use the extension.",
      tabId: targetTab.id
    };
  }

  const pendingMessagingTarget = pendingLinkedInNavigation?.tabId === targetTab.id
    ? normalizeWhitespace(pendingLinkedInNavigation?.targetHref || "")
    : "";
  const inferredLinkedInPageType = inferLinkedInPageTypeFromUrl(pendingMessagingTarget) === "linkedin-messaging"
    ? "linkedin-messaging"
    : inferLinkedInPageTypeFromUrl(targetTab.url);

  const maxAttempts = inferredLinkedInPageType === "linkedin-messaging"
    ? 6
    : inferredLinkedInPageType === "linkedin-profile"
      ? 2
      : inferredLinkedInPageType === "linkedin-job" || inferredLinkedInPageType === "linkedin-people-search" || inferredLinkedInPageType === "linkedin-post"
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

  function normalizeMessagingContextForTab(response) {
    if (response?.pageType !== "linkedin-messaging") {
      return response;
    }
    const normalizedTargetUrl = normalizeWhitespace(pendingMessagingTarget || targetTab.url || "");
    const responsePageUrl = normalizeWhitespace(response?.pageUrl || "");
    const normalizedPageUrl = /\/preload\/?$/i.test(responsePageUrl)
      ? normalizedTargetUrl
      : (isLinkedInUrl(responsePageUrl) ? responsePageUrl : normalizedTargetUrl);
    const conversation = response?.conversation || null;
    const rawThreadUrl = normalizeWhitespace(conversation?.threadUrl || "");
    const normalizedThreadUrl = /^https:\/\/www\.linkedin\.com\/messaging\/thread\//i.test(rawThreadUrl)
      ? rawThreadUrl
      : normalizedTargetUrl;
    return {
      ...response,
      pageUrl: normalizedPageUrl,
      conversation: conversation
        ? {
          ...conversation,
          threadUrl: normalizedThreadUrl
        }
        : conversation,
      person: response?.person
        ? {
          ...response.person,
          messagingThreadUrl: normalizedThreadUrl
        }
        : response?.person
    };
  }

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
    const response = normalizeMessagingContextForTab(
      await sendLinkedInMessageToBestFrame(targetTab.id, { type: MESSAGE_TYPES.GET_PAGE_CONTEXT })
    );
    requestDebug.background_page_context_send_ms += roundMs(Date.now() - sendStartedAt);
    lastResponse = response;
    requestDebug.background_page_context_last_response_page_type = normalizeWhitespace(response?.pageType || "");
    requestDebug.background_page_context_last_response_supported = Boolean(response?.supported);
    requestDebug.background_page_context_last_response_reason = normalizeWhitespace(response?.reason || response?.error || "");
    requestDebug.background_page_context_last_response_page_url = normalizeWhitespace(response?.pageUrl || "");
    requestDebug.background_page_context_last_response_frame_id = Number.isInteger(response?._frameId) ? response._frameId : null;
    if (response?.ok) {
      const responsePageType = [
        "linkedin-messaging",
        "linkedin-profile",
        "linkedin-job",
        "linkedin-people-search",
        "linkedin-post"
      ].includes(response.pageType)
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
      } else if (responsePageType === "linkedin-job" && !response.supported) {
        const isInferredJobResponse = response.pageType !== "linkedin-job";
        lastResponse = {
          ...response,
          pageType: "linkedin-job",
          reason: isInferredJobResponse ? "Loading job..." : response.reason || "Loading job...",
          pageUrl: response.pageUrl || targetTab.url
        };
      } else if (responsePageType === "linkedin-people-search" && !response.supported) {
        const isInferredPeopleSearchResponse = response.pageType !== "linkedin-people-search";
        lastResponse = {
          ...response,
          pageType: "linkedin-people-search",
          reason: isInferredPeopleSearchResponse ? "Loading people search..." : response.reason || "Loading people search...",
          pageUrl: response.pageUrl || targetTab.url
        };
      } else if (responsePageType === "linkedin-post" && !response.supported) {
        lastResponse = {
          ...response,
          pageType: "linkedin-post",
          reason: response.reason || "Open a visible LinkedIn feed or company post.",
          pageUrl: response.pageUrl || targetTab.url
        };
      }
      const looksReady = response.supported
        || (
          responsePageType === "linkedin-messaging"
            ? !/loading selected conversation/i.test(response.reason || "")
            : responsePageType === "linkedin-profile"
              ? !/loading profile/i.test(response.reason || "")
              : responsePageType === "linkedin-job"
                ? !/loading job/i.test(response.reason || "")
                : responsePageType === "linkedin-people-search"
                  ? !/no people results found yet|loading people search/i.test(response.reason || "")
                  : responsePageType === "linkedin-post"
                    ? true
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
          : inferredLinkedInPageType === "linkedin-job"
            ? "Loading job..."
            : inferredLinkedInPageType === "linkedin-people-search"
              ? "Loading people search..."
              : inferredLinkedInPageType === "linkedin-post"
                ? "Open a visible LinkedIn feed or company post."
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
        : inferredLinkedInPageType === "linkedin-post" && !lastResponse?.supported
          ? "linkedin-post"
        : lastResponse?.pageType,
    reason: inferredLinkedInPageType === "linkedin-messaging" && !lastResponse?.supported
      ? lastResponse?.reason || "Loading selected conversation..."
      : inferredLinkedInPageType === "linkedin-profile" && !lastResponse?.supported
      ? lastResponse?.reason || "Loading profile..."
      : inferredLinkedInPageType === "linkedin-job" && !lastResponse?.supported
      ? lastResponse?.reason || "Loading job..."
      : inferredLinkedInPageType === "linkedin-people-search" && !lastResponse?.supported
      ? lastResponse?.reason || "Loading people search..."
      : inferredLinkedInPageType === "linkedin-post" && !lastResponse?.supported
      ? lastResponse?.reason || "Open a visible LinkedIn feed or company post."
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

async function captureLinkedInPostDiscussion(sourceTabId) {
  const startedAt = Date.now();
  const targetTab = await getTabForRequest(sourceTabId);
  if (!targetTab?.id || !isLinkedInUrl(targetTab.url)) {
    return {
      ok: false,
      error: "Open a LinkedIn feed or company post before capturing discussion context."
    };
  }
  const response = await safeSendLinkedInMessage(targetTab.id, {
    type: MESSAGE_TYPES.CAPTURE_LINKEDIN_POST_DISCUSSION
  });
  if (!response?.ok) {
    return {
      ok: false,
      error: response?.error || "Unable to capture the visible LinkedIn post discussion.",
      debug: response?.debug || null
    };
  }
  return {
    ...response,
    pageUrl: isLinkedInUrl(response?.pageUrl) ? response.pageUrl : normalizeWhitespace(targetTab.url || ""),
    tabId: targetTab.id,
    debug: {
      ...(response?.debug || {}),
      background_post_capture_frame_id: Number.isInteger(response?._frameId) ? response._frameId : null,
      background_post_capture_ms: roundMs(Date.now() - startedAt)
    }
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

function purgeStaleGenerationJobs() {
  // Remove completed/failed/cancelled jobs older than 2 minutes — they are
  // only needed long enough for the sidepanel to read the final status once.
  const cutoff = Date.now() - 2 * 60 * 1000;
  for (const [requestId, job] of generationJobs.entries()) {
    const terminal = ["completed", "failed", "cancelled", "error"].includes(normalizeWhitespace(job?.status));
    const completedAt = job?.completedAt ? new Date(job.completedAt).getTime() : 0;
    if (terminal && completedAt && completedAt < cutoff) {
      generationJobs.delete(requestId);
    }
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
  // Opportunistically purge stale jobs to keep the map lean.
  purgeStaleGenerationJobs();
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

async function sendPostSuggestionProgress(requestId, sourceTabId, text, meta) {
  if (!requestId || !normalizeWhitespace(text)) {
    return;
  }
  try {
    await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.POST_SUGGESTIONS_PROGRESS,
      requestId,
      sourceTabId: typeof sourceTabId === "number" ? sourceTabId : null,
      provider: normalizeLlmProvider(meta?.provider || DEFAULT_LLM_PROVIDER),
      status: normalizeWhitespace(meta?.status || "running") || "running",
      progressPercent: Number.isFinite(Number(meta?.progressPercent)) ? Number(meta.progressPercent) : 0,
      outputChars: Number.isFinite(Number(meta?.outputChars)) ? Number(meta.outputChars) : 0,
      text: normalizeWhitespace(text)
    });
  } catch (_error) {
    // Ignore sidepanel delivery issues.
  }
}

async function sendPostSuggestionLifecycleMessage(type, payload) {
  try {
    await chrome.runtime.sendMessage({
      type,
      ...(payload || {})
    });
  } catch (_error) {
    // Ignore sidepanel delivery issues.
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

function parseJobJsonWithValidator(rawOutput, validator) {
  try {
    const result = validator(rawOutput);
    if (result?.ok) {
      return result;
    }
    return {
      ok: false,
      errors: Array.isArray(result?.errors) && result.errors.length
        ? result.errors
        : ["Provider response did not match the required JSON contract."],
      raw: result?.raw || null
    };
  } catch (error) {
    return {
      ok: false,
      errors: [error?.message || String(error)],
      raw: null
    };
  }
}

function buildJobJsonRepairPrompt(contractName, errors, rawOutput) {
  return [
    `Your previous ${contractName} response failed validation.`,
    "Return corrected JSON only. Do not include markdown or prose.",
    "Use plain JSON string values only. URL fields must be plain absolute URLs, not Markdown links.",
    "Escape quotation marks inside JSON strings.",
    "Validation errors:",
    (Array.isArray(errors) ? errors : [])
      .map((error) => `- ${normalizeWhitespace(error)}`)
      .join("\n") || "- Unknown validation failure.",
    "",
    "Previous raw response:",
    normalizeWhitespace(rawOutput).slice(0, 12000)
  ].join("\n");
}

async function runProviderJsonPromptWithRetry({ prompt, validator, contractName, sourceTabId, runnerOptions, onProgress }) {
  const provider = normalizeLlmProvider(runnerOptions?.provider || DEFAULT_LLM_PROVIDER);
  const providerName = providerDisplayName(provider);
  const entryUrl = normalizeUrl(runnerOptions?.entryUrl || defaultLlmEntryUrl(provider)) || defaultLlmEntryUrl(provider);
  const previousTab = await getActiveTab();
  const previousTabId = previousTab?.id || null;
  let providerTab = null;
  let lastRawOutput = "";
  let lastErrors = [];
  const startedAt = Date.now();

  try {
    await onProgress?.(`Opening ${providerName}.`, {
      provider,
      status: "opening_provider",
      progressPercent: 6
    });
    providerTab = await ensureProviderTab(provider, entryUrl, { preferFreshTab: true });
    if (!providerTab?.id) {
      throw new Error(`No ${providerName} tab available.`);
    }
    setLastProviderTabId(provider, providerTab.id);

    let promptToSend = prompt;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const messageType = attempt === 1 ? MESSAGE_TYPES.RUN_PROMPT : MESSAGE_TYPES.RETRY_RUN;
      await onProgress?.(attempt === 1 ? `Sending prompt to ${providerName}.` : `Sending repair prompt to ${providerName}.`, {
        provider,
        status: attempt === 1 ? "submitting_prompt" : "submitting_repair",
        attempt,
        progressPercent: attempt === 1 ? 10 : 72
      });
      const startResponse = await sendPromptToProviderTab(provider, providerTab.id, messageType, promptToSend, previousTabId);
      if (!startResponse?.ok) {
        throw new Error(startResponse?.error || `Unable to submit ${contractName} prompt to ${providerName}.`);
      }

      const waitStartedAt = Date.now();
      while (Date.now() - waitStartedAt < CHATGPT_TOTAL_WAIT_MS) {
        const readResponse = await safeSendMessage(providerTab.id, {
          type: MESSAGE_TYPES.READ_RESPONSE,
          maxWaitMs: PROVIDER_BACKGROUND_READ_MAX_WAIT_MS,
          stallWaitMs: PROVIDER_BACKGROUND_READ_STALL_MS
        });
        if (!readResponse?.ok) {
          throw new Error(readResponse?.error || `Unable to read ${providerName} response.`);
        }

        lastRawOutput = String(readResponse.rawOutput || lastRawOutput || "").trim();
        if (readResponse.status === "still_generating") {
          const progress = formatGenerationProgressText(providerName, lastRawOutput, Date.now() - waitStartedAt);
          await onProgress?.(progress.text, {
            provider,
            status: "generating",
            attempt,
            progressPercent: progress.percent,
            outputChars: progress.chars
          });
          const partialValidation = parseJobJsonWithValidator(lastRawOutput, validator);
          if (partialValidation.ok) {
            await onProgress?.(`${providerName} returned valid JSON.`, {
              provider,
              status: "valid_json",
              attempt,
              progressPercent: 90
            });
            return {
              ok: true,
              attempt,
              rawOutput: lastRawOutput,
              value: partialValidation.value,
              provider,
              providerTabId: providerTab.id,
              timings: { llm_total_ms: roundMs(Date.now() - startedAt) }
            };
          }
          await delay(PROVIDER_BACKGROUND_POLL_DELAY_MS);
          continue;
        }

        if (readResponse.status === "complete" || readResponse.status === "stalled" || readResponse.status === "no_response") {
          const providerState = await readProviderTabState(provider, providerTab.id);
          const candidateOutput = String(providerState?.latestResponseText || lastRawOutput || "").trim();
          lastRawOutput = candidateOutput || lastRawOutput;
          const validation = parseJobJsonWithValidator(lastRawOutput, validator);
          if (validation.ok) {
            return {
              ok: true,
              attempt,
              rawOutput: lastRawOutput,
              value: validation.value,
              provider,
              providerTabId: providerTab.id,
              threadUrl: resolveThreadUrl(provider, providerState?.currentUrl || "", entryUrl),
              timings: { llm_total_ms: roundMs(Date.now() - startedAt) }
            };
          }
          lastErrors = validation.errors || [];
          if (attempt >= 2) {
            throw new Error(lastErrors.join(" ") || `${contractName} response failed validation.`);
          }
          await onProgress?.(`Repairing ${contractName} JSON.`, {
            provider,
            status: "repairing_json",
            attempt,
            errors: lastErrors,
            progressPercent: 70
          });
          promptToSend = buildJobJsonRepairPrompt(contractName, lastErrors, lastRawOutput);
          lastRawOutput = "";
          await delay(1000);
          break;
        }

        await delay(PROVIDER_BACKGROUND_POLL_DELAY_MS);
      }
    }
  } finally {
    if (providerTab?.id) {
      try {
        await chrome.tabs.remove(providerTab.id);
      } catch (_error) {
        // Ignore cleanup failure.
      }
      if (getLastProviderTabId(provider) === providerTab.id) {
        setLastProviderTabId(provider, null);
      }
    }
    if (previousTabId) {
      await restoreActiveTab(previousTabId).catch(() => {});
    }
    await hideLinkedInPageActivityOverlay(sourceTabId).catch(() => {});
  }

  throw new Error(lastErrors.join(" ") || `${contractName} response failed validation.`);
}

async function runPostSuggestionWorkflow(message) {
  const requestId = normalizeWhitespace(message?.requestId) || `post_suggestions_${Date.now()}`;
  const sourceTabId = typeof message?.sourceTabId === "number" ? message.sourceTabId : null;
  const draftCharacterLimit = normalizeDraftCharacterLimit(message?.draftCharacterLimit);
  const progress = (text, meta) => sendPostSuggestionProgress(requestId, sourceTabId, text, meta);
  const startedAt = Date.now();
  try {
    await progress("Reading the visible LinkedIn post.", {
      status: "capturing_context",
      progressPercent: 4
    });
    const captured = message?.postDiscussion
      ? {
        ok: true,
        postDiscussion: message.postDiscussion
      }
      : await captureLinkedInPostDiscussion(sourceTabId);
    if (!captured?.ok || !captured?.postDiscussion) {
      throw new Error(captured?.error || "Capture the visible post discussion first.");
    }

    const stored = await getStoredState();
    await ensurePromptPackReady(stored.promptPackSettings);
    const promptSettings = normalizePromptSettings(stored.promptSettings || defaultPromptSettings());
    const runnerOptions = {
      provider: promptSettings.llmProvider,
      entryUrl: promptSettings.llmEntryUrl
    };
    const promptPayload = buildPostSuggestionPrompt(
      captured.postDiscussion,
      stored.myProfile || defaultMyProfile(),
      promptSettings,
      {
        draftCharacterLimit,
        promptPackSettings: stored.promptPackSettings
      }
    );

    await progress("Preparing suggestion prompt.", {
      status: "building_prompt",
      progressPercent: 10,
      provider: promptSettings.llmProvider
    });
    const generation = await enqueueChatGptRun(() => runProviderJsonPromptWithRetry({
      prompt: promptPayload.prompt,
      validator: (rawOutput) => validatePostSuggestionResult(rawOutput, { draftCharacterLimit }),
      contractName: POST_SUGGESTION_CONTRACT_VERSION,
      sourceTabId,
      runnerOptions,
      onProgress: progress
    }));

    const result = {
      postSummary: normalizeWhitespace(generation.value?.postSummary),
      interactionRead: normalizeWhitespace(generation.value?.interactionRead),
      suggestions: Array.isArray(generation.value?.suggestions) ? generation.value.suggestions : [],
      provider: generation.provider,
      threadUrl: normalizeWhitespace(generation.threadUrl || ""),
      prompt: promptPayload.prompt
    };
    await sendPostSuggestionLifecycleMessage(MESSAGE_TYPES.POST_SUGGESTIONS_COMPLETE, {
      requestId,
      sourceTabId,
      result,
      postDiscussion: captured.postDiscussion,
      diagnostics: {
        provider: generation.provider,
        attempt: generation.attempt,
        timings: generation.timings || null,
        totalMs: roundMs(Date.now() - startedAt)
      }
    });
    return { ok: true, requestId };
  } catch (error) {
    await sendPostSuggestionLifecycleMessage(MESSAGE_TYPES.POST_SUGGESTIONS_FAILED, {
      requestId,
      sourceTabId,
      error: error?.message || String(error),
      diagnostics: {
        totalMs: roundMs(Date.now() - startedAt)
      }
    });
    return { ok: false, requestId, error: error?.message || String(error) };
  }
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

function tryValidateProviderOutput(rawOutput, fixedTail, flowType, fallbackProfile, validationOptions) {
  const normalized = normalizeWhitespace(rawOutput);
  if (!normalized) {
    return null;
  }
  try {
    return validateWorkspaceResult(
      shared.extractJsonFromText(normalized),
      fixedTail,
      flowType,
      fallbackProfile,
      validationOptions
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
  const validationOptions = options?.validationOptions || {};
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
              fallbackProfile,
              validationOptions
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
            const retryPrompt = buildRetryPrompt(
              validationError.message || String(validationError),
              options?.promptPackSettings
            );
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
          const validatedWhileGenerating = tryValidateProviderOutput(lastRawOutput, fixedTail, flowType, fallbackProfile, validationOptions);
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
            const validatedCaptured = tryValidateProviderOutput(capturedOutput, fixedTail, flowType, fallbackProfile, validationOptions) || validatedWhileGenerating;
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
          const validatedFromCandidate = tryValidateProviderOutput(candidateOutput, fixedTail, flowType, fallbackProfile, validationOptions);
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
            const validatedCaptured = tryValidateProviderOutput(capturedOutput, fixedTail, flowType, fallbackProfile, validationOptions) || validatedFromCandidate;
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

// ---------------------------------------------------------------------------
// IndexedDB storage layer
// ---------------------------------------------------------------------------

const IDB_NAME = "lumi-assist-db";
const IDB_VERSION = 1;

let _idbInstance = null;

function openDatabase() {
  if (_idbInstance) {
    return Promise.resolve(_idbInstance);
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, IDB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains("people")) {
        const people = db.createObjectStore("people", { keyPath: "personId" });
        people.createIndex("byLastInteraction", "system.lastInteractionAt", { unique: false });
        people.createIndex("byUpdatedAt", "system.updatedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains("jobOutreachRuns")) {
        const runs = db.createObjectStore("jobOutreachRuns", { keyPath: "runId" });
        runs.createIndex("byJobId", "jobId", { unique: false });
        runs.createIndex("byStatus", "status", { unique: false });
        runs.createIndex("byCreatedAt", "createdAt", { unique: false });
      }
      if (!db.objectStoreNames.contains("jobOutreachJobs")) {
        const jobs = db.createObjectStore("jobOutreachJobs", { keyPath: "jobId" });
        jobs.createIndex("byUpdatedAt", "updatedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains("profileRedirects")) {
        const redirects = db.createObjectStore("profileRedirects", { keyPath: "sourceUrl" });
        redirects.createIndex("byCreatedAt", "createdAt", { unique: false });
      }
      if (!db.objectStoreNames.contains("identityResolutionSeen")) {
        const seen = db.createObjectStore("identityResolutionSeen", { keyPath: "opaqueUrl" });
        seen.createIndex("bySeenAt", "seenAt", { unique: false });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    };
    request.onsuccess = (event) => {
      _idbInstance = event.target.result;
      _idbInstance.onclose = () => { _idbInstance = null; };
      resolve(_idbInstance);
    };
    request.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

function idbGetAll(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function idbGet(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

function idbPut(db, storeName, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const request = store.put(value);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbDelete(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function idbClear(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function idbPutBatch(db, storeName, items) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    for (const item of items) {
      store.put(item);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getIdbMeta(db, key) {
  const record = await idbGet(db, "meta", key);
  return record?.value ?? null;
}

async function setIdbMeta(db, key, value) {
  await idbPut(db, "meta", { key, value });
}

async function isMigrated() {
  try {
    const db = await openDatabase();
    const version = await getIdbMeta(db, "migrationVersion");
    return Number(version) >= 1;
  } catch (_error) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Migration: chrome.storage.local → IndexedDB (one-time)
// ---------------------------------------------------------------------------

async function migrateFromChromeStorage() {
  const db = await openDatabase();
  const version = await getIdbMeta(db, "migrationVersion");
  if (Number(version) >= 1) {
    return;
  }

  const current = await chrome.storage.local.get([
    STORAGE_KEYS.people,
    STORAGE_KEYS.jobOutreach,
    STORAGE_KEYS.profileRedirects,
    STORAGE_KEYS.identityResolutionSeenOpaqueUrls
  ]);

  const now = toIsoNow();

  const people = current[STORAGE_KEYS.people] || {};
  const peopleItems = Object.entries(people)
    .map(([key, value]) => {
      const normalized = normalizePersonRecord(value);
      return normalized?.personId ? normalized : null;
    })
    .filter(Boolean);
  if (peopleItems.length) {
    await idbPutBatch(db, "people", peopleItems);
  }

  const jobOutreach = normalizeJobOutreachStore(current[STORAGE_KEYS.jobOutreach]);

  const jobItems = Object.values(jobOutreach.jobsById || {}).filter((j) => j?.jobId);
  if (jobItems.length) {
    await idbPutBatch(db, "jobOutreachJobs", jobItems);
  }

  const runItems = Object.values(jobOutreach.runsById || {}).filter((r) => r?.runId);
  if (runItems.length) {
    await idbPutBatch(db, "jobOutreachRuns", runItems);
  }

  const redirects = current[STORAGE_KEYS.profileRedirects] || {};
  const redirectItems = Object.entries(redirects).map(([sourceUrl, targetUrl]) => ({
    sourceUrl,
    targetUrl: normalizeWhitespace(targetUrl) || sourceUrl,
    createdAt: now
  }));
  if (redirectItems.length) {
    await idbPutBatch(db, "profileRedirects", redirectItems);
  }

  const seenUrls = current[STORAGE_KEYS.identityResolutionSeenOpaqueUrls] || {};
  const seenItems = Object.entries(seenUrls).map(([opaqueUrl, value]) => ({
    opaqueUrl,
    seenAt: normalizeWhitespace(typeof value === "string" ? value : "") || now
  }));
  if (seenItems.length) {
    await idbPutBatch(db, "identityResolutionSeen", seenItems);
  }

  await setIdbMeta(db, "jobOutreachCoordination", {
    filterCache: jobOutreach.filterCache || {},
    runOrder: jobOutreach.runOrder || [],
    queue: jobOutreach.queue || [],
    activeRunId: jobOutreach.activeRunId || ""
  });

  await setIdbMeta(db, "migrationVersion", 1);

  await chrome.storage.local.remove([
    STORAGE_KEYS.people,
    STORAGE_KEYS.jobOutreach,
    STORAGE_KEYS.profileRedirects,
    STORAGE_KEYS.identityResolutionSeenOpaqueUrls
  ]);
}

// ---------------------------------------------------------------------------
// Cleanup engine
// ---------------------------------------------------------------------------

const CLEANUP_THRESHOLDS = {
  peopleDeleteDays: 180,
  profileStripDays: 60,
  draftExpireDays: 30,
  jobRunDeleteDays: 90,
  jobRunStripDays: 30,
  jobRunKeepPerJob: 5,
  redirectDeleteDays: 365,
  redirectMaxEntries: 10000,
  redirectTargetEntries: 8000,
  seenUrlDeleteDays: 180,
  seenUrlMaxEntries: 5000,
  seenUrlTargetEntries: 4000
};

async function estimateStoragePressure() {
  try {
    const estimate = await navigator.storage.estimate();
    if (!estimate?.quota || !estimate?.usage) {
      return 0;
    }
    return estimate.usage / estimate.quota;
  } catch (_error) {
    return 0;
  }
}

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function mostRecentTimestamp(...timestamps) {
  let best = "";
  for (const ts of timestamps) {
    const s = normalizeWhitespace(ts);
    if (s && s > best) {
      best = s;
    }
  }
  return best;
}

function isPersonProtected(personId, tabBindings) {
  return Object.values(tabBindings || {}).includes(personId);
}

async function runCleanupPeople(db, thresholds, tabBindings) {
  const allPeople = await idbGetAll(db, "people");
  const deleteThreshold = daysAgo(thresholds.peopleDeleteDays);
  const stripThreshold = daysAgo(thresholds.profileStripDays);
  const draftThreshold = daysAgo(thresholds.draftExpireDays);
  let deleted = 0;
  let stripped = 0;

  for (const person of allPeople) {
    if (isPersonProtected(person.personId, tabBindings)) {
      continue;
    }

    const lastActivity = mostRecentTimestamp(
      person.system?.lastInteractionAt,
      person.observedConversation?.lastMessageAt
    );

    if (!lastActivity || lastActivity < deleteThreshold) {
      await idbDelete(db, "people", person.personId);
      deleted++;
      continue;
    }

    if (lastActivity < stripThreshold) {
      const updated = { ...person };
      if (updated.profileContext) {
        updated.profileContext = {
          ...updated.profileContext,
          rawSnapshot: "",
          recipientProfileMemory: "",
          recipientSummaryMemory: "",
          profileSummary: "",
          latestProfileData: null,
          latestActivitySnippets: [],
          recentProfileChanges: "",
          lastProfileSyncedAt: ""
        };
      }
      // Clear entire draftWorkspace — contains messages, prompts, AI analysis, logic_metrics
      updated.draftWorkspace = null;
      updated.aiProfileAssessment = null;
      updated.aiConversationAssessment = null;
      // Clear root-level AI backup fields
      updated.lastRecommendedAction = "";
      updated.lastReasonWhyNow = "";
      updated.lastLogicMetrics = null;
      updated.lastWorkspace = null;
      if (updated.observedConversation) {
        updated.observedConversation = {
          ...updated.observedConversation,
          rawThreadText: "",
          messages: (updated.observedConversation.messages || []).slice(-10)
        };
      }
      if (updated.importedConversation) {
        updated.importedConversation = {
          ...updated.importedConversation,
          rawThreadText: "",
          messages: (updated.importedConversation.messages || []).slice(-10)
        };
      }
      await idbPut(db, "people", updated);
      stripped++;
      continue;
    }

    if (person.draftWorkspace?.generatedAt && person.draftWorkspace?.is_stale) {
      if (person.draftWorkspace.generatedAt < draftThreshold) {
        await idbPut(db, "people", { ...person, draftWorkspace: null });
        stripped++;
      }
    }
  }
  return { deleted, stripped };
}

async function runCleanupJobOutreachRuns(db, thresholds) {
  const allRuns = await idbGetAll(db, "jobOutreachRuns");
  const deleteThreshold = daysAgo(thresholds.jobRunDeleteDays);
  const stripThreshold = daysAgo(thresholds.jobRunStripDays);
  const terminalStatuses = new Set(["completed", "failed", "cancelled"]);
  let deleted = 0;
  let stripped = 0;

  const terminalByJob = {};
  for (const run of allRuns) {
    if (!terminalStatuses.has(normalizeJobOutreachRunStatus(run.status))) {
      continue;
    }
    const jobId = normalizeWhitespace(run.jobId || "");
    if (!terminalByJob[jobId]) {
      terminalByJob[jobId] = [];
    }
    terminalByJob[jobId].push(run);
  }

  for (const [, runs] of Object.entries(terminalByJob)) {
    runs.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      const isProtected = i < thresholds.jobRunKeepPerJob;
      if (!isProtected && run.createdAt && run.createdAt < deleteThreshold) {
        await idbDelete(db, "jobOutreachRuns", run.runId);
        deleted++;
      } else if (run.createdAt && run.createdAt < stripThreshold) {
        await idbPut(db, "jobOutreachRuns", {
          ...run,
          importedPeopleBySearch: {},
          importedPeopleBySearchKey: {},
          rankingInput: null,
          rankingPlan: null,
          searchPlan: null,
          diagnostics: null
        });
        stripped++;
      }
    }
  }
  return { deleted, stripped };
}

async function runCleanupRedirects(db, thresholds) {
  const all = await idbGetAll(db, "profileRedirects");
  const deleteThreshold = daysAgo(thresholds.redirectDeleteDays);
  let deleted = 0;

  const old = all.filter((r) => r.createdAt && r.createdAt < deleteThreshold);
  for (const r of old) {
    await idbDelete(db, "profileRedirects", r.sourceUrl);
    deleted++;
  }

  const remaining = all.length - deleted;
  if (remaining > thresholds.redirectMaxEntries) {
    const sorted = all
      .filter((r) => !old.includes(r))
      .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
    const toRemove = remaining - thresholds.redirectTargetEntries;
    for (let i = 0; i < toRemove && i < sorted.length; i++) {
      await idbDelete(db, "profileRedirects", sorted[i].sourceUrl);
      deleted++;
    }
  }
  return { deleted };
}

async function runCleanupSeenUrls(db, thresholds) {
  const all = await idbGetAll(db, "identityResolutionSeen");
  const deleteThreshold = daysAgo(thresholds.seenUrlDeleteDays);
  let deleted = 0;

  const old = all.filter((r) => r.seenAt && r.seenAt < deleteThreshold);
  for (const r of old) {
    await idbDelete(db, "identityResolutionSeen", r.opaqueUrl);
    deleted++;
  }

  const remaining = all.length - deleted;
  if (remaining > thresholds.seenUrlMaxEntries) {
    const sorted = all
      .filter((r) => !old.includes(r))
      .sort((a, b) => (a.seenAt || "").localeCompare(b.seenAt || ""));
    const toRemove = remaining - thresholds.seenUrlTargetEntries;
    for (let i = 0; i < toRemove && i < sorted.length; i++) {
      await idbDelete(db, "identityResolutionSeen", sorted[i].opaqueUrl);
      deleted++;
    }
  }
  return { deleted };
}

async function runCleanup() {
  try {
    const db = await openDatabase();
    const migrated = await getIdbMeta(db, "migrationVersion");
    if (Number(migrated) < 1) {
      return;
    }

    const tabBindings = (await chrome.storage.local.get([STORAGE_KEYS.tabPersonBindings]))?.[STORAGE_KEYS.tabPersonBindings] || {};

    const pressure = await estimateStoragePressure();
    const isHighPressure = pressure >= 0.9;

    const thresholds = { ...CLEANUP_THRESHOLDS };
    if (isHighPressure) {
      thresholds.peopleDeleteDays = Math.floor(thresholds.peopleDeleteDays / 2);
      thresholds.profileStripDays = Math.floor(thresholds.profileStripDays / 2);
      thresholds.draftExpireDays = Math.floor(thresholds.draftExpireDays / 2);
      thresholds.jobRunDeleteDays = Math.floor(thresholds.jobRunDeleteDays / 2);
      thresholds.jobRunStripDays = Math.floor(thresholds.jobRunStripDays / 2);
      thresholds.jobRunKeepPerJob = 3;
      thresholds.redirectDeleteDays = 30;
      thresholds.seenUrlDeleteDays = 30;
    }

    const peopleResult = await runCleanupPeople(db, thresholds, tabBindings);
    const runsResult = await runCleanupJobOutreachRuns(db, thresholds);
    const redirectsResult = await runCleanupRedirects(db, thresholds);
    const seenResult = await runCleanupSeenUrls(db, thresholds);

    if (isHighPressure) {
      const stillHighPressure = (await estimateStoragePressure()) >= 0.9;
      if (stillHighPressure) {
        const allPeople = await idbGetAll(db, "people");
        for (const person of allPeople) {
          if (isPersonProtected(person.personId, tabBindings)) {
            continue;
          }
          if (
            person.profileContext?.rawSnapshot ||
            person.profileContext?.latestProfileData ||
            person.draftWorkspace ||
            person.aiProfileAssessment ||
            person.aiConversationAssessment
          ) {
            const updated = { ...person };
            updated.profileContext = {
              ...updated.profileContext,
              rawSnapshot: "",
              recipientProfileMemory: "",
              recipientSummaryMemory: "",
              profileSummary: "",
              latestProfileData: null,
              latestActivitySnippets: [],
              recentProfileChanges: "",
              lastProfileSyncedAt: ""
            };
            updated.draftWorkspace = null;
            updated.aiProfileAssessment = null;
            updated.aiConversationAssessment = null;
            updated.lastRecommendedAction = "";
            updated.lastReasonWhyNow = "";
            updated.lastLogicMetrics = null;
            updated.lastWorkspace = null;
            if (updated.observedConversation) {
              updated.observedConversation = {
                ...updated.observedConversation,
                rawThreadText: ""
              };
            }
            if (updated.importedConversation) {
              updated.importedConversation = {
                ...updated.importedConversation,
                rawThreadText: ""
              };
            }
            await idbPut(db, "people", updated);
          }
        }
      }
    }

    await setIdbMeta(db, "lastCleanupAt", toIsoNow());

    console.log("[Lumi] Cleanup complete:", {
      pressure: Math.round(pressure * 100) + "%",
      people: peopleResult,
      runs: runsResult,
      redirects: redirectsResult,
      seen: seenResult
    });
  } catch (error) {
    console.warn("[Lumi] Cleanup failed:", error);
  }
}

let _cleanupPromise = null;

function maybeScheduleCleanup() {
  if (_cleanupPromise) {
    return;
  }
  _cleanupPromise = (async () => {
    try {
      const db = await openDatabase();
      const lastCleanup = await getIdbMeta(db, "lastCleanupAt");
      const sixHoursAgo = daysAgo(0.25);
      const shouldRun = !lastCleanup || lastCleanup < sixHoursAgo;
      if (!shouldRun) {
        const pressure = await estimateStoragePressure();
        if (pressure < 0.9) {
          return;
        }
      }
      await runCleanup();
    } catch (_error) {
      // cleanup is best-effort
    } finally {
      _cleanupPromise = null;
    }
  })();
}

// ---------------------------------------------------------------------------
// getStoredState — reads from IndexedDB (post-migration) or chrome.storage
// ---------------------------------------------------------------------------

async function getStoredState() {
  const migrated = await isMigrated();

  if (!migrated) {
    const stored = await chrome.storage.local.get([
      STORAGE_KEYS.myProfile,
      STORAGE_KEYS.fixedTail,
      STORAGE_KEYS.promptSettings,
      STORAGE_KEYS.promptPackSettings,
      STORAGE_KEYS.chatGptProjectUrl,
      STORAGE_KEYS.people,
      STORAGE_KEYS.jobOutreach,
      STORAGE_KEYS.tabPersonBindings,
      STORAGE_KEYS.threadPersonBindings,
      STORAGE_KEYS.profileRedirects,
      STORAGE_KEYS.identityResolutionSeenOpaqueUrls
    ]);

    const rawPeople = stored[STORAGE_KEYS.people] || {};
    const rawPromptSettings = stored[STORAGE_KEYS.promptSettings] || defaultPromptSettings();
    const rawPromptPackSettings = stored[STORAGE_KEYS.promptPackSettings] || defaultPromptPackSettings();
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
      fixedTail: Object.prototype.hasOwnProperty.call(stored, STORAGE_KEYS.fixedTail)
        ? normalizeFixedTail(stored[STORAGE_KEYS.fixedTail])
        : FIXED_TAIL,
      promptSettings: normalizePromptSettings({
        ...rawPromptSettings,
        llmEntryUrl: normalizeWhitespace(rawPromptSettings?.llmEntryUrl || "")
          || (normalizeLlmProvider(rawPromptSettings?.llmProvider) === "chatgpt" ? legacyChatGptProjectUrl : "")
      }),
      promptPackSettings: normalizePromptPackSettings(rawPromptPackSettings),
      chatGptProjectUrl: legacyChatGptProjectUrl,
      people,
      jobOutreach: normalizeJobOutreachStore(stored[STORAGE_KEYS.jobOutreach]),
      tabPersonBindings: stored[STORAGE_KEYS.tabPersonBindings] || {},
      threadPersonBindings: stored[STORAGE_KEYS.threadPersonBindings] || {},
      profileRedirects: stored[STORAGE_KEYS.profileRedirects] || {},
      identityResolutionSeenOpaqueUrls: stored[STORAGE_KEYS.identityResolutionSeenOpaqueUrls] || {}
    };
  }

  // --- IndexedDB path (post-migration) ---
  maybeScheduleCleanup();

  const db = await openDatabase();
  const [chromeData, allPeople, allRuns, allJobs, allRedirects, allSeen] = await Promise.all([
    chrome.storage.local.get([
      STORAGE_KEYS.myProfile,
      STORAGE_KEYS.fixedTail,
      STORAGE_KEYS.promptSettings,
      STORAGE_KEYS.promptPackSettings,
      STORAGE_KEYS.chatGptProjectUrl,
      STORAGE_KEYS.tabPersonBindings,
      STORAGE_KEYS.threadPersonBindings
    ]),
    idbGetAll(db, "people"),
    idbGetAll(db, "jobOutreachRuns"),
    idbGetAll(db, "jobOutreachJobs"),
    idbGetAll(db, "profileRedirects"),
    idbGetAll(db, "identityResolutionSeen")
  ]);

  const people = Object.fromEntries(
    allPeople
      .map((record) => {
        const normalized = normalizePersonRecord(record);
        return [normalized.personId, normalized];
      })
      .filter(([, value]) => Boolean(value?.personId))
  );

  const runsById = Object.fromEntries(allRuns.filter((r) => r?.runId).map((r) => [r.runId, r]));
  const jobsById = Object.fromEntries(allJobs.filter((j) => j?.jobId).map((j) => [j.jobId, j]));
  const coordination = (await getIdbMeta(db, "jobOutreachCoordination")) || {};
  const jobOutreach = normalizeJobOutreachStore({
    jobsById,
    runsById,
    filterCache: coordination.filterCache || {},
    runOrder: coordination.runOrder || [],
    queue: coordination.queue || [],
    activeRunId: coordination.activeRunId || ""
  });

  const profileRedirects = Object.fromEntries(
    allRedirects.map((r) => [r.sourceUrl, r.targetUrl || r.sourceUrl])
  );

  const identityResolutionSeenOpaqueUrls = Object.fromEntries(
    allSeen.map((r) => [r.opaqueUrl, r.seenAt || ""])
  );

  const rawPromptSettings = chromeData[STORAGE_KEYS.promptSettings] || defaultPromptSettings();
  const rawPromptPackSettings = chromeData[STORAGE_KEYS.promptPackSettings] || defaultPromptPackSettings();
  const legacyChatGptProjectUrl = chromeData[STORAGE_KEYS.chatGptProjectUrl] || DEFAULT_CHATGPT_PROJECT_URL;

  return {
    myProfile: chromeData[STORAGE_KEYS.myProfile] || defaultMyProfile(),
    fixedTail: Object.prototype.hasOwnProperty.call(chromeData, STORAGE_KEYS.fixedTail)
      ? normalizeFixedTail(chromeData[STORAGE_KEYS.fixedTail])
      : FIXED_TAIL,
    promptSettings: normalizePromptSettings({
      ...rawPromptSettings,
      llmEntryUrl: normalizeWhitespace(rawPromptSettings?.llmEntryUrl || "")
        || (normalizeLlmProvider(rawPromptSettings?.llmProvider) === "chatgpt" ? legacyChatGptProjectUrl : "")
    }),
    promptPackSettings: normalizePromptPackSettings(rawPromptPackSettings),
    chatGptProjectUrl: legacyChatGptProjectUrl,
    people,
    jobOutreach,
    tabPersonBindings: chromeData[STORAGE_KEYS.tabPersonBindings] || {},
    threadPersonBindings: chromeData[STORAGE_KEYS.threadPersonBindings] || {},
    profileRedirects,
    identityResolutionSeenOpaqueUrls
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

  if (await isMigrated()) {
    const db = await openDatabase();
    await idbClear(db, "people");
    const items = Object.values(normalizedPeople).filter((p) => p?.personId);
    if (items.length) {
      await idbPutBatch(db, "people", items);
    }
  } else {
    await chrome.storage.local.set({ [STORAGE_KEYS.people]: normalizedPeople });
  }
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

  // Safety cap: if bindings somehow exceed 500 entries (e.g. heavy conversation history),
  // drop the excess by keeping only the first 500.  In practice the count is 2× people
  // count because collectThreadUrlsForRecord returns at most 2 URLs per person, so this
  // guard only fires in extreme edge cases.
  const bindingKeys = Object.keys(nextBindings);
  if (bindingKeys.length > 500) {
    const trimmed = {};
    bindingKeys.slice(0, 500).forEach((k) => { trimmed[k] = nextBindings[k]; });
    return trimmed;
  }

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

  // Safety cap: Chrome tab IDs are session-scoped and increase monotonically, so old
  // sessions leave stale entries (valid person, stale tab ID) until the person is deleted.
  // If we somehow accumulate more than 200 entries, keep only the highest tab IDs
  // (most recent session), which are the ones most likely to still be open.
  const tabKeys = Object.keys(nextBindings);
  if (tabKeys.length > 200) {
    const sorted = tabKeys.sort((a, b) => Number(b) - Number(a)).slice(0, 200);
    const trimmed = {};
    sorted.forEach((k) => { trimmed[k] = nextBindings[k]; });
    return trimmed;
  }

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

function chooseCanonicalPersonId(records, preferredPersonId) {
  const normalizedPreferredPersonId = normalizeWhitespace(preferredPersonId);
  const explicitEntries = (records || [])
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      personId: normalizeWhitespace(entry.personId),
      strength: personRecordStrength(entry),
      stableDerivedPersonId: stableDerivedPersonIdForRecord(entry),
      hasThreadContext: Boolean(
        normalizeUrl(entry.messagingThreadUrl)
        || normalizeUrl(getDraftWorkspace(entry)?.conversation?.threadUrl)
      )
    }))
    .filter((entry) => entry.personId);

  const threadBackedEntries = explicitEntries
    .filter((entry) => entry.hasThreadContext)
    .sort((left, right) =>
      right.strength - left.strength
        || Number(isOpaqueLinkedInPersonId(right.personId)) - Number(isOpaqueLinkedInPersonId(left.personId))
        || Number(isPublicSlugPersonId(right.personId)) - Number(isPublicSlugPersonId(left.personId))
    );
  if (threadBackedEntries.length === 1) {
    return threadBackedEntries[0].personId;
  }
  if (threadBackedEntries.length > 1 && normalizedPreferredPersonId) {
    const preferredThreadBacked = threadBackedEntries.find((entry) => entry.personId === normalizedPreferredPersonId);
    if (preferredThreadBacked) {
      return preferredThreadBacked.personId;
    }
  }

  if (normalizedPreferredPersonId && explicitEntries.some((entry) => entry.personId === normalizedPreferredPersonId)) {
    return normalizedPreferredPersonId;
  }

  explicitEntries.sort((left, right) =>
    Number(right.hasThreadContext) - Number(left.hasThreadContext)
      || right.strength - left.strength
      || Number(isPublicSlugPersonId(right.personId)) - Number(isPublicSlugPersonId(left.personId))
      || Number(isOpaqueLinkedInPersonId(right.personId)) - Number(isOpaqueLinkedInPersonId(left.personId))
  );
  if (explicitEntries.length) {
    return explicitEntries[0].personId;
  }

  const ids = (records || [])
    .map((entry) => normalizeWhitespace(typeof entry === "string" ? entry : entry?.personId))
    .filter(Boolean);
  if (normalizedPreferredPersonId && ids.includes(normalizedPreferredPersonId)) {
    return normalizedPreferredPersonId;
  }

  return ids.find((id) => isPublicSlugPersonId(id))
    || ids.find((id) => isOpaqueLinkedInPersonId(id))
    || ids.find((id) => id.startsWith("li:"))
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
  const signature = personNameHeadlineSignature(
    record?.identity?.fullName || record?.fullName,
    record?.headline || record?.profileSummary || record?.recipientProfileMemory
  );
  if (signature) {
    aliases.add(signature);
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

function personNameHeadlineSignature(fullName, headline) {
  const normalizedName = normalizeNameForMatch(fullName);
  const headlinePrefix = normalizedHeadlinePrefix(headline, 15);
  if (!normalizedName || !headlinePrefix) {
    return "";
  }
  return `sig:${normalizedName}|${headlinePrefix}`;
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

function findRecordByNameHeadlineSignature(people, signature) {
  const normalizedSignature = normalizeWhitespace(signature).toLowerCase();
  if (!normalizedSignature) {
    return null;
  }
  return Object.values(people || {})
    .filter((record) => personIdentityAliases(record).has(normalizedSignature))
    .sort((left, right) => personRecordStrength(right) - personRecordStrength(left))[0]
    || null;
}

function previewIdentityHints(pageContext) {
  const preview = pageContext?.person || {};
  const previewId = normalizeWhitespace(preview.personId);
  const pageProfileUrl = pageContext?.pageType === "linkedin-profile"
    ? normalizeLinkedInProfileUrl(pageContext?.pageUrl)
    : "";
  const previewProfileUrl = normalizeLinkedInProfileUrl(preview.profileUrl) || pageProfileUrl;
  const previewOpaqueUrl = normalizeLinkedInProfileUrl(preview.primaryLinkedInMemberUrl)
    || (previewProfileUrl && shouldResolveLinkedInProfileUrl(previewProfileUrl) ? previewProfileUrl : "");
  const previewPublicUrl = normalizeLinkedInProfileUrl(preview.publicProfileUrl)
    || (previewProfileUrl && !shouldResolveLinkedInProfileUrl(previewProfileUrl) ? previewProfileUrl : "")
    || (pageProfileUrl && !shouldResolveLinkedInProfileUrl(pageProfileUrl) ? pageProfileUrl : "");
  const previewNameHeadlineSignature = personNameHeadlineSignature(
    preview.fullName || pageContext?.profile?.fullName,
    preview.headline || preview.profileSummary || pageContext?.profile?.headline || pageContext?.profile?.profileSummary
  );
  const aliases = Array.from(new Set([
    linkedInProfileAlias(previewProfileUrl),
    linkedInProfileAlias(previewOpaqueUrl),
    linkedInProfileAlias(previewPublicUrl),
    previewNameHeadlineSignature
  ].filter(Boolean)));

  return {
    previewId,
    previewProfileUrl,
    previewOpaqueUrl,
    previewPublicUrl,
    previewNameHeadlineSignature,
    aliases,
    hasExplicitIdentity: Boolean(previewId || previewOpaqueUrl || previewPublicUrl || previewNameHeadlineSignature)
  };
}

function recordMatchesExplicitPageIdentity(record, pageContext) {
  if (!record || !pageContext) {
    return false;
  }

  const hints = previewIdentityHints(pageContext);
  if (!hints.hasExplicitIdentity) {
    return true;
  }

  if (hints.previewId && normalizeWhitespace(record.personId) === hints.previewId) {
    return true;
  }

  const recordProfileUrls = new Set([
    normalizeLinkedInProfileUrl(record.profileUrl),
    primaryLinkedInMemberUrl(record),
    publicProfileUrl(record),
    ...knownProfileUrls(record)
  ].filter(Boolean));
  if (
    (hints.previewProfileUrl && recordProfileUrls.has(hints.previewProfileUrl))
    || (hints.previewOpaqueUrl && recordProfileUrls.has(hints.previewOpaqueUrl))
    || (hints.previewPublicUrl && recordProfileUrls.has(hints.previewPublicUrl))
  ) {
    return true;
  }

  return hasMatchingIdentityAlias(record, {
    personId: hints.previewId,
    profileUrl: hints.previewProfileUrl || hints.previewPublicUrl || hints.previewOpaqueUrl,
    identity: { aliases: hints.aliases }
  });
}

function stableDerivedPersonIdForRecord(record) {
  if (!record) {
    return "";
  }
  return shared.personIdFromProfileUrl(publicProfileUrl(record), record.fullName)
    || shared.personIdFromProfileUrl(primaryLinkedInMemberUrl(record), record.fullName)
    || shared.personIdFromProfileUrl(normalizeLinkedInProfileUrl(record.profileUrl), record.fullName)
    || "";
}

function describeIdentityConsistency(record) {
  if (!record) {
    return null;
  }
  const personId = normalizeWhitespace(record.personId);
  const stableDerivedPersonIds = Array.from(new Set(
    knownProfileUrls(record)
      .map((value) => shared.personIdFromProfileUrl(value, record.fullName))
      .filter(Boolean)
  ));
  const stableDerivedPersonId = stableDerivedPersonIds.find((value) => !value.startsWith("name:"))
    || stableDerivedPersonIds[0]
    || "";
  return {
    personId,
    stableDerivedPersonId,
    canonicalMatchesDerivedPersonId: !personId || !stableDerivedPersonId || personId === stableDerivedPersonId,
    isConsistent: stableDerivedPersonIds.length <= 1,
    profileUrl: normalizeLinkedInProfileUrl(record.profileUrl),
    primaryLinkedInMemberUrl: primaryLinkedInMemberUrl(record),
    publicProfileUrl: publicProfileUrl(record),
    fullName: normalizeWhitespace(record.fullName)
  };
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

function recordMatchesProfileNameHeadline(record, pageContext) {
  if (!record || pageContext?.pageType !== "linkedin-profile") {
    return false;
  }

  const preview = {
    fullName: normalizeWhitespace(pageContext?.person?.fullName || pageContext?.profile?.fullName),
    personId: normalizeWhitespace(pageContext?.person?.personId),
    headline: normalizeWhitespace(pageContext?.person?.headline || pageContext?.profile?.headline),
    profileSummary: normalizeWhitespace(pageContext?.profile?.profileSummary || pageContext?.person?.profileSummary)
  };
  if (!hasMatchingNameEvidence(record, preview)) {
    return false;
  }
  return hasMatchingHeadlinePrefixEvidence(record, preview)
    || hasMatchingProfileEvidence(record, preview);
}

function isFreshLinkedInProfileClickTrace(pageContext) {
  if (pageContext?.pageType !== "linkedin-profile") {
    return false;
  }
  const currentProfileUrl = normalizeLinkedInProfileUrl(pageContext?.pageUrl || pageContext?.person?.profileUrl);
  const clickedProfileUrl = normalizeLinkedInProfileUrl(lastLinkedInClickTrace?.clickHref);
  if (!currentProfileUrl || !clickedProfileUrl || currentProfileUrl !== clickedProfileUrl) {
    return false;
  }
  const clickedAt = Date.parse(normalizeWhitespace(lastLinkedInClickTrace?.at));
  if (!Number.isFinite(clickedAt)) {
    return false;
  }
  return Math.max(0, Date.now() - clickedAt) <= PROFILE_CLICK_IDENTITY_MAX_AGE_MS;
}

function resolveProfileClickTraceMatch(pageContext, stored) {
  if (!isFreshLinkedInProfileClickTrace(pageContext)) {
    return null;
  }

  const people = stored?.people || {};
  const sourceThreadUrl = isMessagingUrl(lastLinkedInClickTrace?.pageHrefBefore)
    ? normalizeUrl(lastLinkedInClickTrace?.pageHrefBefore)
    : "";
  const sourceTabId = Number.isInteger(lastLinkedInClickTrace?.tabId)
    ? lastLinkedInClickTrace.tabId
    : null;
  const candidates = [];

  if (sourceThreadUrl) {
    const boundPersonId = normalizeWhitespace(stored?.threadPersonBindings?.[sourceThreadUrl]);
    const boundRecord = boundPersonId ? people[boundPersonId] : null;
    if (boundRecord) {
      candidates.push({ record: boundRecord, matchType: "recent_profile_click_thread_binding" });
    }
    const threadMatch = findRecordByMessagingThreadUrl(people, sourceThreadUrl);
    if (threadMatch) {
      candidates.push({ record: threadMatch, matchType: "recent_profile_click_messaging_thread_url" });
    }
    const workspaceThreadMatch = findRecordByDraftWorkspaceThreadUrl(people, sourceThreadUrl);
    if (workspaceThreadMatch) {
      candidates.push({ record: workspaceThreadMatch, matchType: "recent_profile_click_draft_thread_url" });
    }
  }

  if (sourceTabId !== null) {
    const tabBoundPersonId = normalizeWhitespace(stored?.tabPersonBindings?.[String(sourceTabId)]);
    const tabBoundRecord = tabBoundPersonId ? people[tabBoundPersonId] : null;
    if (tabBoundRecord) {
      candidates.push({ record: tabBoundRecord, matchType: "recent_profile_click_tab_binding" });
    }
  }

  for (const candidate of candidates) {
    if (!candidate.record) {
      continue;
    }
    if (recordMatchesProfileNameHeadline(candidate.record, pageContext) || hasMatchingNameEvidence(candidate.record, {
      fullName: normalizeWhitespace(pageContext?.person?.fullName || pageContext?.profile?.fullName),
      personId: normalizeWhitespace(pageContext?.person?.personId)
    })) {
      return candidate;
    }
  }

  return candidates[0] || null;
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
  const pendingProfileHandoff = getPendingProfileIdentityHandoffForPage(pageContext, stored);
  if (pendingProfileHandoff?.record) {
    return {
      matchedRecord: pendingProfileHandoff.record,
      identityWarning: null,
      matchType: "pending_profile_handoff"
    };
  }
  const people = stored?.people || {};
  const recentProfileClickMatch = resolveProfileClickTraceMatch(pageContext, stored);
  if (recentProfileClickMatch?.record) {
    return {
      matchedRecord: recentProfileClickMatch.record,
      identityWarning: null,
      matchType: recentProfileClickMatch.matchType
    };
  }
  const sourceTabId = Number.isInteger(pageContext?.tabId) ? pageContext.tabId : null;
  const preview = pageContext?.person || {};
  const identityHints = previewIdentityHints(pageContext);
  const previewId = identityHints.previewId;
  const previewProfileUrl = identityHints.previewProfileUrl;
  const previewThreadUrl = pageContext?.pageType === "linkedin-messaging"
    ? normalizeUrl(preview.messagingThreadUrl || pageContext?.conversation?.threadUrl || pageContext?.pageUrl)
    : "";
  const previewOpaqueUrl = identityHints.previewOpaqueUrl;
  const previewPublicUrl = identityHints.previewPublicUrl;
  const previewNameHeadlineSignature = identityHints.previewNameHeadlineSignature;
  if (pageContext?.pageType === "linkedin-profile" && sourceTabId !== null) {
    const boundPersonId = normalizeWhitespace(stored?.tabPersonBindings?.[String(sourceTabId)]);
    const boundRecord = boundPersonId ? people[boundPersonId] : null;
    if (
      boundRecord
      && normalizeUrl(boundRecord.messagingThreadUrl)
      && (
        recordMatchesExplicitPageIdentity(boundRecord, pageContext)
        || recordMatchesProfileNameHeadline(boundRecord, pageContext)
      )
    ) {
      return { matchedRecord: boundRecord, identityWarning: null, matchType: "tab_binding_profile_person" };
    }
  }

  if (previewId && people[previewId]) {
    return { matchedRecord: people[previewId], identityWarning: null, matchType: "person_id" };
  }

  if (previewNameHeadlineSignature) {
    const signatureMatch = findRecordByNameHeadlineSignature(people, previewNameHeadlineSignature);
    if (signatureMatch) {
      return { matchedRecord: signatureMatch, identityWarning: null, matchType: "name_headline_signature" };
    }
  }

  if (previewThreadUrl) {
    const boundPersonId = normalizeWhitespace(stored?.threadPersonBindings?.[previewThreadUrl]);
    const boundRecord = boundPersonId ? people[boundPersonId] : null;
    if (boundRecord && recordMatchesExplicitPageIdentity(boundRecord, pageContext)) {
      return { matchedRecord: boundRecord, identityWarning: null, matchType: "thread_binding" };
    }
    const threadMatch = findRecordByMessagingThreadUrl(people, previewThreadUrl);
    if (threadMatch && recordMatchesExplicitPageIdentity(threadMatch, pageContext)) {
      return { matchedRecord: threadMatch, identityWarning: null, matchType: "messaging_thread_url" };
    }
    const workspaceThreadMatch = findRecordByDraftWorkspaceThreadUrl(people, previewThreadUrl);
    if (workspaceThreadMatch && recordMatchesExplicitPageIdentity(workspaceThreadMatch, pageContext)) {
      return { matchedRecord: workspaceThreadMatch, identityWarning: null, matchType: "draft_workspace_thread_url" };
    }
  }

  if (sourceTabId !== null) {
    const boundPersonId = normalizeWhitespace(stored?.tabPersonBindings?.[String(sourceTabId)]);
    const boundRecord = boundPersonId ? people[boundPersonId] : null;
    if (boundRecord
      && recordMatchesExplicitPageIdentity(boundRecord, pageContext)
      && recordMatchesPageContext(boundRecord, pageContext)) {
      return { matchedRecord: boundRecord, identityWarning: null, matchType: "tab_binding" };
    }
    if (boundRecord && recordMatchesProfileNameHeadline(boundRecord, pageContext)) {
      return { matchedRecord: boundRecord, identityWarning: null, matchType: "tab_binding_profile_name_headline" };
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
  const shouldReuseExistingIdentity = !previewIdentityHints(pageContext).hasExplicitIdentity
    || recordMatchesExplicitPageIdentity(existingRecord, pageContext);
  const previewAliases = Array.isArray(preview.identityAliases) ? preview.identityAliases : [];
  const aliasUrls = previewAliases.map((value) => normalizeLinkedInProfileUrl(value)).filter(Boolean);
  const previewOpaqueAlias = aliasUrls.find((value) => shouldResolveLinkedInProfileUrl(value)) || "";
  const previewPublicAlias = aliasUrls.find((value) => value && !shouldResolveLinkedInProfileUrl(value)) || "";
  const previewPrimaryLinkedInMemberUrl = normalizeLinkedInProfileUrl(preview.primaryLinkedInMemberUrl)
    || (shouldResolveLinkedInProfileUrl(previewProfileUrl)
      ? previewProfileUrl
      : "")
    || previewOpaqueAlias
    || (shouldReuseExistingIdentity ? primaryLinkedInMemberUrl(existingRecord) : "");
  const previewPublicProfileUrl = normalizeLinkedInProfileUrl(preview.publicProfileUrl)
    || (previewProfileUrl && !shouldResolveLinkedInProfileUrl(previewProfileUrl)
      ? previewProfileUrl
      : "")
    || previewPublicAlias
    || (shouldReuseExistingIdentity ? publicProfileUrl(existingRecord) : "");
  const shouldPreserveExistingId = Boolean(
    shouldReuseExistingIdentity
    && existingPersonId
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
  const canonicalPersonId = shouldReuseExistingIdentity && existingPersonId
    ? existingPersonId
    : preferredPersonId;

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
    personId: shouldPreserveExistingId ? existingPersonId : canonicalPersonId,
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

function linkProfileUrlToPersonRecord(personRecord, profileUrl) {
  const normalizedProfileUrl = normalizeLinkedInProfileUrl(profileUrl);
  if (!personRecord?.personId || !normalizedProfileUrl) {
    return personRecord || null;
  }
  const isOpaqueProfileUrl = shouldResolveLinkedInProfileUrl(normalizedProfileUrl);
  return mergePersonRecord(personRecord, {
    profileUrl: normalizedProfileUrl,
    identity: {
      profileUrl: normalizedProfileUrl,
      primaryLinkedInMemberUrl: isOpaqueProfileUrl
        ? normalizedProfileUrl
        : primaryLinkedInMemberUrl(personRecord),
      publicProfileUrl: !isOpaqueProfileUrl
        ? normalizedProfileUrl
        : publicProfileUrl(personRecord),
      knownProfileUrls: Array.from(new Set([
        ...knownProfileUrls(personRecord),
        normalizedProfileUrl
      ].filter(Boolean))),
      aliases: Array.from(new Set([
        ...(Array.isArray(personRecord?.identity?.aliases) ? personRecord.identity.aliases : []),
        linkedInProfileAlias(normalizedProfileUrl)
      ].filter(Boolean))),
      identityStatus: "resolved",
      identityConfidence: isOpaqueProfileUrl ? "high" : "medium"
    },
    updatedAt: toIsoNow()
  });
}

function resolveLinkProfileTargetPerson(explicitPersonId, hintedPersonRecord, stored) {
  const normalizedExplicitPersonId = normalizeWhitespace(explicitPersonId);
  if (normalizedExplicitPersonId && stored?.people?.[normalizedExplicitPersonId]) {
    return stored.people[normalizedExplicitPersonId];
  }

  const normalizedHint = hintedPersonRecord ? normalizePersonRecord(hintedPersonRecord) : null;
  if (!normalizedHint?.personId) {
    return null;
  }

  return mergePersonRecord(stored?.people?.[normalizedHint.personId], normalizedHint);
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
  const crossSurfaceSlugPair = (
    (isOpaqueLinkedInPersonId(baseId) && isPublicSlugPersonId(candidateId))
    || (isPublicSlugPersonId(baseId) && isOpaqueLinkedInPersonId(candidateId))
  );
  if (
    crossSurfaceSlugPair
    && hasMatchingNameEvidence(baseRecord, candidateRecord)
    && (
      hasMatchingHeadlinePrefixEvidence(baseRecord, candidateRecord)
      || hasMatchingProfileEvidence(baseRecord, candidateRecord)
    )
  ) {
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
  ], personRecord.personId);
  if (canonicalPersonId) {
    combined.personId = canonicalPersonId;
  }

  const canonicalRecordUuid = normalizeWhitespace(
    people[combined.personId]?.uuid
    || people[combined.personId]?.system?.recordUuid
    || seed?.uuid
    || seed?.system?.recordUuid
    || personRecord?.uuid
    || personRecord?.system?.recordUuid
  );
  if (canonicalRecordUuid) {
    combined.uuid = canonicalRecordUuid;
    combined.system = {
      ...(combined.system || {}),
      recordUuid: canonicalRecordUuid
    };
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
  const matchedRecord = recordMatchesExplicitPageIdentity(resolution.matchedRecord, pageContext)
    ? resolution.matchedRecord
    : null;
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
          messagingThreadUrl: "",
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

async function resolveExplicitOrCurrentPerson(pageContext, stored, explicitPersonId) {
  const normalizedExplicitPersonId = normalizeWhitespace(explicitPersonId);
  const explicitPerson = normalizedExplicitPersonId && stored?.people?.[normalizedExplicitPersonId]
    ? stored.people[normalizedExplicitPersonId]
    : null;
  const currentPerson = pageContext?.supported ? await loadCurrentPersonFromPage(pageContext, stored) : null;

  if (!explicitPerson) {
    return {
      person: currentPerson,
      stored,
      merged: false
    };
  }

  if (!currentPerson?.personId || currentPerson.personId === explicitPerson.personId) {
    return {
      person: mergePersonRecord(explicitPerson, currentPerson),
      stored,
      merged: false
    };
  }

  const explicitMatchesPage = recordMatchesExplicitPageIdentity(explicitPerson, pageContext)
    || recordMatchesPageContext(explicitPerson, pageContext);
  const currentMatchesPage = recordMatchesExplicitPageIdentity(currentPerson, pageContext)
    || recordMatchesPageContext(currentPerson, pageContext);
  if (!explicitMatchesPage && !currentMatchesPage) {
    return {
      person: explicitPerson,
      stored,
      merged: false
    };
  }

  const mergedPerson = mergePersonRecord(explicitPerson, currentPerson);
  const result = await upsertPersonRecord(mergedPerson, stored);
  return {
    person: result.merged,
    stored: {
      ...stored,
      people: result.people,
      tabPersonBindings: result.tabPersonBindings,
      threadPersonBindings: result.threadPersonBindings
    },
    merged: true
  };
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

  if (await isMigrated()) {
    const db = await openDatabase();
    await idbClear(db, "people");
    const items = Object.values(nextPeople).filter((p) => p?.personId);
    if (items.length) {
      await idbPutBatch(db, "people", items);
    }
    await chrome.storage.local.set({
      [STORAGE_KEYS.tabPersonBindings]: nextTabPersonBindings,
      [STORAGE_KEYS.threadPersonBindings]: nextThreadPersonBindings
    });
  } else {
    await chrome.storage.local.set({
      [STORAGE_KEYS.people]: nextPeople,
      [STORAGE_KEYS.tabPersonBindings]: nextTabPersonBindings,
      [STORAGE_KEYS.threadPersonBindings]: nextThreadPersonBindings
    });
  }

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
  console.info("[Lumi Assist]", eventName, {
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
  console.info("[Lumi Assist]", eventName, {
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
  console.info("[Lumi Assist]", eventName, {
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
  if (/^explore premium profiles\b/i.test(lower)) {
    return -100;
  }
  if (/reposted this$/i.test(lower)) {
    return -80;
  }
  if (/\bmessage\b/i.test(text) && /\b(?:1st|2nd|3rd\+?|\d+(?:st|nd|rd|th))\b/i.test(text)) {
    return -60;
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
  if (/(manager|director|founder|student|mba|som|product|engineer|strategy|marketing|sales|ads|platform|banking|fintech|ai|risk|fraud|recruiter|talent|acquisition|specialist|analyst|consultant|associate|intern|partnership|partnerships|account)/i.test(text)) {
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

function hasFullProfileSectionData(profile) {
  return Boolean(
    normalizeWhitespace(profile?.about)
    || (Array.isArray(profile?.experienceHighlights) && profile.experienceHighlights.length)
    || (Array.isArray(profile?.educationHighlights) && profile.educationHighlights.length)
    || (Array.isArray(profile?.activitySnippets) && profile.activitySnippets.length)
  );
}

function isForcedFullProfileExtractionResponse(response) {
  const debug = response?.debug || {};
  return normalizeWhitespace(debug.profile_timing_mode) === "full"
    && normalizeWhitespace(debug.profile_scroll_strategy) === "forced_progressive_full_refresh"
    && Number(debug.profile_scroll_passes_run || 0) > 0
    && Number(debug.profile_scroll_steps_run || 0) > 0
    && hasFullProfileSectionData(response?.profile);
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

async function syncMyProfileActivityIfNeeded(pageContext, stored) {
  if (pageContext?.pageType !== "linkedin-profile" || !isOwnProfilePageContext(pageContext, stored)) {
    return {
      stored,
      activityChanged: false
    };
  }

  const nextProfileData = normalizeProfileData(pageContext.profile);
  const nextActivitySnippets = Array.isArray(nextProfileData?.activitySnippets) ? nextProfileData.activitySnippets : [];
  if (!nextActivitySnippets.length) {
    return {
      stored,
      activityChanged: false
    };
  }

  const currentActivitySnippets = Array.isArray(stored?.myProfile?.latestActivitySnippets)
    ? stored.myProfile.latestActivitySnippets
    : [];
  const changed = JSON.stringify(currentActivitySnippets) !== JSON.stringify(nextActivitySnippets)
    || !normalizeWhitespace(stored?.myProfile?.lastActivitySyncedAt);
  if (!changed) {
    return {
      stored,
      activityChanged: false
    };
  }

  const nextMyProfile = {
    ...defaultMyProfile(),
    ...(stored?.myProfile || {}),
    latestActivitySnippets: nextActivitySnippets,
    lastActivitySyncedAt: toIsoNow(),
    updatedAt: normalizeWhitespace(stored?.myProfile?.updatedAt) || toIsoNow()
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.myProfile]: nextMyProfile });
  return {
    stored: {
      ...stored,
      myProfile: nextMyProfile
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
  if (!isAssistantSessionActive()) {
    return;
  }
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
    maybeResolvePendingProfileIdentityHandoff(details.tabId, details.url).catch(() => {});
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
    linkedInTabUrls.delete(tabId);
    return;
  }
  rememberLinkedInTab(tabId, changeInfo.url || tab.url);
  if (changeInfo.url || changeInfo.status === "loading" || changeInfo.status === "complete") {
    notifyPageContextChanged(tabId, changeInfo.url || tab.url);
  }
  maybeResolvePendingProfileIdentityHandoff(tabId, changeInfo.url || tab.url).catch(() => {});
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab?.id && isLinkedInUrl(tab.url || "")) {
      linkedInTabUrls.set(tab.id, normalizeWhitespace(tab.url));
      lastObservedLinkedInTabId = tab.id;
      lastObservedLinkedInTabUrl = normalizeWhitespace(tab.url);
    } else if (tab?.id) {
      // User switched to a non-LinkedIn tab — deactivate all LinkedIn tabs.
      lastObservedLinkedInTabId = -1;
      lastObservedLinkedInTabUrl = "";
    }
    // Real tab switch: sync activation state across all known LinkedIn tabs.
    syncAssistantActivationForKnownLinkedInTabs().catch(() => {});
  } catch (_error) {
    // Ignore transient activation errors.
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearMessagingReload(tabId);
  linkedInTabUrls.delete(tabId);
  clearPendingProfileIdentityHandoff(tabId);
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
  // Cancel and remove any generation jobs that were sourced from this tab.
  for (const [requestId, job] of generationJobs.entries()) {
    if (job?.sourceTabId === tabId || job?.workerTabId === tabId) {
      generationJobs.delete(requestId);
    }
  }
  // Cancel and remove any pending job outreach runs sourced from this tab.
  for (const [requestId, run] of pendingJobOutreachRuns.entries()) {
    if (run?.sourceTabId === tabId) {
      pendingJobOutreachRuns.delete(requestId);
    }
  }
  // If the closed tab was the active LinkedIn tab, promote the most recently
  // seen remaining LinkedIn tab so the extension stays usable.
  if (tabId === lastObservedLinkedInTabId) {
    const remaining = Array.from(linkedInTabUrls.keys());
    if (remaining.length > 0) {
      lastObservedLinkedInTabId = remaining[remaining.length - 1];
      lastObservedLinkedInTabUrl = linkedInTabUrls.get(lastObservedLinkedInTabId) || "";
      syncAssistantActivationForKnownLinkedInTabs().catch(() => {});
    } else {
      lastObservedLinkedInTabId = -1;
      lastObservedLinkedInTabUrl = "";
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
  const draftCharacterLimit = normalizeDraftCharacterLimit(job.draftCharacterLimit);

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
  await ensurePromptPackReady(stored.promptPackSettings);
  const promptPayload = buildWorkspacePrompt(
    workspaceContext,
    syncedPerson,
    stored.myProfile,
    normalizeFixedTail(job.fixedTail ?? stored.fixedTail),
    stored.promptSettings,
    job.extraContext,
    {
      draftCharacterLimit,
      promptPackSettings: stored.promptPackSettings,
      channel: job.channel === "email" ? "email" : "relationship"
    }
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
    normalizeFixedTail(job.fixedTail ?? stored.fixedTail),
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
      onProgress: (text, meta) => sendGenerationProgress(requestId, sourceTabId, text, meta),
      promptPackSettings: stored.promptPackSettings,
      validationOptions: { draftCharacterLimit }
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
    draft_character_limit: draftCharacterLimit,
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

function normalizeJobOutreachJob(job) {
  const source = job || {};
  return {
    title: normalizeWhitespace(source.title),
    company: normalizeWhitespace(source.company),
    location: normalizeWhitespace(source.location),
    datePosted: normalizeWhitespace(source.datePosted),
    sourceUrl: normalizeWhitespace(source.sourceUrl || source.jobUrl || source.pageUrl),
    description: normalizeWhitespace(source.description),
    jobId: normalizeWhitespace(source.jobId)
  };
}

function normalizeMyProfileForStorage(profile, previousProfile) {
  const source = profile || {};
  const previous = previousProfile || {};
  const sourceProfileData = source.profileData || source.latestProfileData || {};
  const previousProfileData = previous.profileData || {};
  const mergedProfileData = normalizeProfileData({
    ...previousProfileData,
    ...sourceProfileData,
    ...source,
    profileUrl: source.profileUrl || source.ownProfileUrl || sourceProfileData.profileUrl || previousProfileData.profileUrl || previous.ownProfileUrl
  }) || null;
  const visibleSignals = mergedProfileData?.visibleSignals || source.visibleSignals || previous.visibleSignals || {};
  const activitySnippets = Array.isArray(source.latestActivitySnippets)
    ? source.latestActivitySnippets
    : Array.isArray(mergedProfileData?.activitySnippets)
      ? mergedProfileData.activitySnippets
      : Array.isArray(source.activitySnippets)
        ? source.activitySnippets
        : Array.isArray(previous.latestActivitySnippets)
          ? previous.latestActivitySnippets
          : [];
  return {
    ...defaultMyProfile(),
    ...previous,
    ownProfileUrl: normalizeLinkedInProfileUrl(
      source.ownProfileUrl
      || source.profileUrl
      || sourceProfileData.profileUrl
      || previousProfileData.profileUrl
      || previous.ownProfileUrl
      || ""
    ),
    pendingProfileUrl: normalizeLinkedInProfileUrl(source.pendingProfileUrl || ""),
    manualNotes: normalizeWhitespace(source.manualNotes || previous.manualNotes),
    fullName: normalizeWhitespace(mergedProfileData?.fullName || source.fullName || previous.fullName),
    firstName: normalizeWhitespace(mergedProfileData?.firstName || source.firstName || previous.firstName),
    headline: normalizeWhitespace(mergedProfileData?.headline || source.headline || previous.headline),
    location: normalizeWhitespace(mergedProfileData?.location || source.location || previous.location),
    profileSummary: normalizeWhitespace(mergedProfileData?.profileSummary || source.profileSummary || ""),
    about: normalizeWhitespace(mergedProfileData?.about || source.about || previous.about),
    experienceHighlights: uniqueStrings(Array.isArray(mergedProfileData?.experienceHighlights) ? mergedProfileData.experienceHighlights : previous.experienceHighlights || []),
    educationHighlights: uniqueStrings(Array.isArray(mergedProfileData?.educationHighlights) ? mergedProfileData.educationHighlights : previous.educationHighlights || []),
    activitySnippets: uniqueStrings(Array.isArray(mergedProfileData?.activitySnippets) ? mergedProfileData.activitySnippets : previous.activitySnippets || []),
    languageSnippets: uniqueStrings(Array.isArray(mergedProfileData?.languageSnippets) ? mergedProfileData.languageSnippets : previous.languageSnippets || []),
    profileCaptureMode: normalizeWhitespace(mergedProfileData?.profileCaptureMode || source.profileCaptureMode || previous.profileCaptureMode),
    visibleSignals: {
      companies: uniqueStrings(visibleSignals.companies || []),
      schools: uniqueStrings(visibleSignals.schools || []),
      locations: uniqueStrings(visibleSignals.locations || []),
      languages: uniqueStrings(visibleSignals.languages || [])
    },
    profileFacts: mergedProfileData?.profileFacts || source.profileFacts || previous.profileFacts || null,
    profileData: mergedProfileData,
    rawSnapshot: normalizeWhitespace(mergedProfileData?.rawSnapshot || source.rawSnapshot || previous.rawSnapshot),
    updatedAt: normalizeWhitespace(source.updatedAt) || toIsoNow(),
    lastActivitySyncedAt: normalizeWhitespace(source.lastActivitySyncedAt || previous.lastActivitySyncedAt),
    latestActivitySnippets: uniqueStrings(activitySnippets)
  };
}

function compactHash(value) {
  const text = normalizeWhitespace(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function jobIdFromJob(job) {
  const normalized = normalizeJobOutreachJob(job);
  if (normalized.jobId) {
    return `li_job_${normalized.jobId}`;
  }
  const fromUrl = normalizeWhitespace(normalized.sourceUrl).match(/(?:currentJobId=|\/jobs\/view\/)(\d+)/i)?.[1];
  if (fromUrl) {
    return `li_job_${fromUrl}`;
  }
  const stableText = [
    normalized.sourceUrl,
    normalized.title,
    normalized.company,
    normalized.location
  ].filter(Boolean).join("|");
  return stableText ? `job_${compactHash(stableText.toLowerCase())}` : "";
}

function normalizeJobOutreachRunStatus(status) {
  const normalized = normalizeWhitespace(status).toLowerCase();
  if (["complete", "ranking_complete", "search_empty_complete"].includes(normalized)) {
    return "completed";
  }
  if ([
    "queued",
    "running",
    "awaiting_user_action",
    "resuming",
    "completed",
    "failed",
    "cancelled"
  ].includes(normalized)) {
    return normalized;
  }
  return normalized || "queued";
}

function isJobOutreachRunTerminalStatus(status) {
  return ["completed", "failed", "cancelled"].includes(normalizeJobOutreachRunStatus(status));
}

function isJobOutreachRunActiveStatus(status) {
  return ["queued", "running", "awaiting_user_action", "resuming"].includes(normalizeJobOutreachRunStatus(status));
}

function normalizeJobOutreachManualActionSnapshot(action) {
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
    removableFilters: Array.isArray(action.removableFilters)
      ? action.removableFilters.map((filter) => ({
        type: normalizeWhitespace(filter?.type).toLowerCase(),
        label: normalizeWhitespace(filter?.label || filter?.sourceText || filter?.value),
        sourceText: normalizeWhitespace(filter?.sourceText || filter?.value || filter?.label),
        param: normalizeWhitespace(filter?.param || ""),
        id: normalizeWhitespace(filter?.id || "")
      })).filter((filter) => filter.type && filter.sourceText)
      : []
  };
}

function normalizeJobOutreachRun(run, fallbackJobId = "") {
  const source = run && typeof run === "object" ? run : {};
  const runId = normalizeWhitespace(source.runId || source.requestId);
  const jobId = normalizeWhitespace(source.jobId || fallbackJobId);
  if (!runId) {
    return null;
  }
  return {
    runId,
    jobId,
    job: normalizeJobOutreachJob(source.job || {}),
    createdAt: normalizeWhitespace(source.createdAt),
    startedAt: normalizeWhitespace(source.startedAt),
    completedAt: normalizeWhitespace(source.completedAt),
    updatedAt: normalizeWhitespace(source.updatedAt),
    sourceTabId: typeof source.sourceTabId === "number" ? source.sourceTabId : null,
    workerTabId: typeof source.workerTabId === "number" ? source.workerTabId : null,
    status: normalizeJobOutreachRunStatus(source.status),
    cancelRequested: Boolean(source.cancelRequested),
    progressText: normalizeWhitespace(source.progressText || source.text),
    progressDetail: normalizeWhitespace(source.progressDetail || source.detail),
    progressPercent: Math.max(0, Math.min(100, Number(source.progressPercent || 0))),
    sharedCriteria: source.sharedCriteria && typeof source.sharedCriteria === "object"
      ? {
        locations: uniqueStrings(source.sharedCriteria.locations || []),
        schools: uniqueStrings(source.sharedCriteria.schools || []),
        currentCompany: normalizeWhitespace(source.sharedCriteria.currentCompany)
      }
      : { locations: [], schools: [], currentCompany: "" },
    searches: Array.isArray(source.searches) ? source.searches : [],
    searchPlan: source.searchPlan || null,
    rankingPlan: source.rankingPlan || null,
    rankingInput: source.rankingInput || null,
    importedPeopleBySearch: (source.importedPeopleBySearch && typeof source.importedPeopleBySearch === "object")
      ? source.importedPeopleBySearch
      : (source.peopleBySearch && typeof source.peopleBySearch === "object")
        ? source.peopleBySearch
      : {},
    importedPeopleBySearchKey: (source.importedPeopleBySearchKey && typeof source.importedPeopleBySearchKey === "object")
      ? source.importedPeopleBySearchKey
      : (source.peopleBySearchKey && typeof source.peopleBySearchKey === "object")
        ? source.peopleBySearchKey
      : {},
    diagnostics: source.diagnostics || null,
    manualAction: normalizeJobOutreachManualActionSnapshot(source.manualAction),
    error: normalizeWhitespace(source.error)
  };
}

function mergeJobOutreachRunWithJob(run, job) {
  const normalizedRun = normalizeJobOutreachRun(run, run?.jobId || job?.jobId || "");
  if (!normalizedRun) {
    return null;
  }
  const normalizedJob = normalizeJobOutreachJob(job || {});
  const mergedJob = {
    ...normalizedJob,
    ...normalizedRun.job
  };
  return {
    ...normalizedRun,
    job: {
      ...mergedJob,
      title: normalizeWhitespace(normalizedRun.job?.title || normalizedJob.title),
      company: normalizeWhitespace(normalizedRun.job?.company || normalizedJob.company),
      location: normalizeWhitespace(normalizedRun.job?.location || normalizedJob.location),
      datePosted: normalizeWhitespace(normalizedRun.job?.datePosted || normalizedJob.datePosted),
      applySignal: normalizeWhitespace(normalizedRun.job?.applySignal || normalizedJob.applySignal),
      promotionSignal: normalizeWhitespace(normalizedRun.job?.promotionSignal || normalizedJob.promotionSignal),
      sourceUrl: normalizeWhitespace(normalizedRun.job?.sourceUrl || normalizedJob.sourceUrl),
      description: normalizeWhitespace(normalizedRun.job?.description || normalizedJob.description),
      jobId: normalizeWhitespace(normalizedRun.job?.jobId || normalizedJob.jobId || normalizedRun.jobId)
    }
  };
}

const JOB_PAGE_CAPTURES_MAX = 50;

function normalizeCapturedPerson(person) {
  const profileUrl = normalizeLinkedInProfileUrl(person?.profileUrl || person?.profile_url || "");
  if (!profileUrl) {
    return null;
  }
  const relationshipContext = normalizeWhitespace(person?.relationshipContext || "");
  const note = normalizeWhitespace(person?.note || "");
  const aiInsight = normalizeWhitespace(person?.aiGeneratedInsight || note || relationshipContext || "");
  return {
    profileUrl,
    avatarUrl: normalizeWhitespace(person?.avatarUrl || ""),
    name: normalizeWhitespace(person?.name || ""),
    headline: normalizeWhitespace(person?.headline || ""),
    connectionDegree: normalizeWhitespace(person?.connectionDegree || ""),
    relationshipContext,
    note,
    aiGeneratedInsight: aiInsight,
    manual: Boolean(person?.manual),
    capturedAt: normalizeWhitespace(person?.capturedAt) || toIsoNow(),
    updatedAt: normalizeWhitespace(person?.updatedAt) || toIsoNow()
  };
}

function normalizeJobCaptures(record) {
  const source = record?.captures && typeof record.captures === "object" ? record.captures : {};
  const seen = new Set();
  const people = [];
  (Array.isArray(source.people) ? source.people : []).forEach((person) => {
    const normalized = normalizeCapturedPerson(person);
    if (!normalized || seen.has(normalized.profileUrl)) {
      return;
    }
    seen.add(normalized.profileUrl);
    people.push(normalized);
  });
  return {
    people: people.slice(-JOB_PAGE_CAPTURES_MAX),
    updatedAt: normalizeWhitespace(source.updatedAt)
  };
}

function normalizeJobOutreachStore(store) {
  const source = store && typeof store === "object" ? store : {};
  const jobsById = {};
  const runsById = {};
  Object.entries(source.jobsById || {}).forEach(([jobId, record]) => {
    const key = normalizeWhitespace(record?.jobId || jobId);
    if (!key) {
      return;
    }
    const job = normalizeJobOutreachJob(record?.job || {});
    const latestRun = mergeJobOutreachRunWithJob(record?.latestRun, job);
    if (latestRun?.runId) {
      runsById[latestRun.runId] = latestRun;
    }
    jobsById[key] = {
      jobId: key,
      job,
      latestRun,
      analytics: {
        totalSearchRuns: Math.max(0, Number(record?.analytics?.totalSearchRuns || 0)),
        lastSearchAt: normalizeWhitespace(record?.analytics?.lastSearchAt),
        searchTermHistory: Array.isArray(record?.analytics?.searchTermHistory)
          ? record.analytics.searchTermHistory.slice(-20)
          : []
      },
      captures: normalizeJobCaptures(record),
      firstSeenAt: normalizeWhitespace(record?.firstSeenAt),
      updatedAt: normalizeWhitespace(record?.updatedAt)
    };
  });
  Object.entries(source.runsById || {}).forEach(([runId, run]) => {
    const parentJob = jobsById[normalizeWhitespace(run?.jobId || runId)]?.job || {};
    const normalized = mergeJobOutreachRunWithJob(run, parentJob);
    if (normalized?.runId) {
      runsById[normalized.runId] = normalized;
    }
  });
  const runOrder = uniqueStrings(Array.isArray(source.runOrder) ? source.runOrder : Object.keys(runsById))
    .filter((runId) => runsById[runId]);
  const queue = uniqueStrings(Array.isArray(source.queue) ? source.queue : [])
    .filter((runId) => runsById[runId] && normalizeJobOutreachRunStatus(runsById[runId].status) === "queued");
  const activeRunId = normalizeWhitespace(source.activeRunId);
  return {
    jobsById,
    filterCache: normalizeJobOutreachFilterCache(source.filterCache),
    runsById,
    runOrder,
    queue,
    activeRunId: runsById[activeRunId] ? activeRunId : ""
  };
}

function trimJobOutreachRuns(store, options = {}) {
  const current = normalizeJobOutreachStore(store);
  const pressure = normalizeWhitespace(options?.pressure).toLowerCase();
  const isHighPressure = pressure === "high";
  const maxTerminalRuns = isHighPressure ? 8 : 25;
  const pinnedRunIds = uniqueStrings([
    current.activeRunId,
    ...current.queue,
    ...current.runOrder.filter((runId) => isJobOutreachRunActiveStatus(current.runsById[runId]?.status))
  ]);
  const terminalRunIds = current.runOrder.filter((runId) => isJobOutreachRunTerminalStatus(current.runsById[runId]?.status));
  const seenTerminalJobIds = new Set();
  const retainedTerminalRunIds = [];
  terminalRunIds.forEach((runId) => {
    if (retainedTerminalRunIds.length >= maxTerminalRuns) {
      return;
    }
    const run = current.runsById[runId];
    if (!run) {
      return;
    }
    const jobId = normalizeWhitespace(run.jobId || run.job?.jobId);
    if (isHighPressure && jobId) {
      if (seenTerminalJobIds.has(jobId)) {
        return;
      }
      seenTerminalJobIds.add(jobId);
    }
    retainedTerminalRunIds.push(runId);
  });
  const nextRunOrder = uniqueStrings([...pinnedRunIds, ...retainedTerminalRunIds]);
  const nextRunsById = Object.fromEntries(nextRunOrder
    .map((runId) => {
      const run = current.runsById[runId];
      if (!run) {
        return [runId, null];
      }
      if (isHighPressure && isJobOutreachRunTerminalStatus(run.status) && !pinnedRunIds.includes(runId)) {
        return [runId, {
          ...run,
          importedPeopleBySearch: {},
          importedPeopleBySearchKey: {},
          rankingInput: null,
          diagnostics: null
        }];
      }
      return [runId, run];
    })
    .filter(([, run]) => Boolean(run)));
  return {
    ...current,
    runsById: nextRunsById,
    runOrder: nextRunOrder,
    queue: current.queue.filter((runId) => nextRunsById[runId]),
    activeRunId: nextRunsById[current.activeRunId] ? current.activeRunId : ""
  };
}

async function jobOutreachStoragePressure() {
  try {
    if (await isMigrated()) {
      const pressure = await estimateStoragePressure();
      return pressure >= 0.85 ? "high" : "normal";
    }
    const quotaBytes = 10 * 1024 * 1024;
    const bytesInUse = await chrome.storage.local.getBytesInUse(STORAGE_KEYS.jobOutreach);
    if (!Number.isFinite(bytesInUse) || bytesInUse <= 0) {
      return "normal";
    }
    return bytesInUse >= quotaBytes * 0.85 ? "high" : "normal";
  } catch (_error) {
    return "normal";
  }
}

function cancelJobOutreachRunInStore(store, requestId) {
  const current = normalizeJobOutreachStore(store);
  const runId = normalizeWhitespace(requestId);
  const run = current.runsById[runId];
  if (!runId || !run) {
    throw new Error("No Job Outreach run matches that id.");
  }
  if (normalizeJobOutreachRunStatus(run.status) === "queued" || normalizeJobOutreachRunStatus(run.status) === "awaiting_user_action") {
    return trimJobOutreachRuns({
      ...current,
      queue: current.queue.filter((id) => id !== runId),
      activeRunId: current.activeRunId === runId ? "" : current.activeRunId,
      runsById: {
        ...current.runsById,
        [runId]: {
          ...run,
          status: "cancelled",
          cancelRequested: false,
          updatedAt: toIsoNow(),
          completedAt: toIsoNow(),
          manualAction: null
        }
      }
    });
  }
  return {
    ...current,
    runsById: {
      ...current.runsById,
      [runId]: {
        ...run,
        cancelRequested: true,
        updatedAt: toIsoNow()
      }
    }
  };
}

function throwIfJobOutreachCancelled(runState) {
  if (runState?.cancelRequested) {
    const error = new Error("Job Outreach run cancelled.");
    error.code = "JOB_OUTREACH_CANCELLED";
    throw error;
  }
}

function dismissJobOutreachRunInStore(store, requestId) {
  const current = normalizeJobOutreachStore(store);
  const runId = normalizeWhitespace(requestId);
  const run = current.runsById[runId];
  if (!runId || !run) {
    throw new Error("No Job Outreach run matches that id.");
  }
  if (!isJobOutreachRunTerminalStatus(run.status)) {
    throw new Error("Only completed, failed, or cancelled runs can be dismissed.");
  }
  const nextRunsById = { ...current.runsById };
  delete nextRunsById[runId];
  const nextJobsById = Object.fromEntries(Object.entries(current.jobsById).map(([jobId, record]) => [
    jobId,
    record?.latestRun?.runId === runId
      ? { ...record, latestRun: null }
      : record
  ]));
  return trimJobOutreachRuns({
    ...current,
    jobsById: nextJobsById,
    runsById: nextRunsById,
    runOrder: current.runOrder.filter((id) => id !== runId),
    queue: current.queue.filter((id) => id !== runId),
    activeRunId: current.activeRunId === runId ? "" : current.activeRunId
  });
}

function promoteNextQueuedJobOutreachRun(store) {
  const current = normalizeJobOutreachStore(store);
  const [nextRunId, ...restQueue] = current.queue;
  if (!nextRunId || !current.runsById[nextRunId]) {
    return {
      store: {
        ...current,
        queue: restQueue.filter((runId) => current.runsById[runId]),
        activeRunId: ""
      },
      nextRun: null
    };
  }
  const nextRun = {
    ...current.runsById[nextRunId],
    status: "running",
    startedAt: normalizeWhitespace(current.runsById[nextRunId].startedAt) || toIsoNow(),
    updatedAt: toIsoNow(),
    cancelRequested: false
  };
  return {
    store: {
      ...current,
      activeRunId: nextRunId,
      queue: restQueue.filter((runId) => current.runsById[runId]),
      runsById: {
        ...current.runsById,
        [nextRunId]: nextRun
      }
    },
    nextRun
  };
}

const JOB_OUTREACH_FILTER_PARAMS = {
  company: "currentCompany",
  location: "geoUrn",
  school: "schoolFilter"
};

function cleanJobOutreachCompanyFilterLabel(value) {
  return cleanLinkedInCompanyDisplayName(value);
}

function normalizeJobOutreachFilterLabel(type, value) {
  const normalized = normalizeWhitespace(value);
  return normalizeWhitespace(type).toLowerCase() === "company"
    ? cleanJobOutreachCompanyFilterLabel(normalized)
    : normalized;
}

function normalizeFilterCacheKey(type, value) {
  const normalizedType = normalizeWhitespace(type).toLowerCase();
  const normalizedValue = normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return normalizedType && normalizedValue ? `${normalizedType}:${normalizedValue}` : "";
}

function normalizeJobOutreachFilterEntry(entry) {
  const source = entry && typeof entry === "object" ? entry : {};
  const type = normalizeWhitespace(source.type).toLowerCase();
  const param = JOB_OUTREACH_FILTER_PARAMS[type] || normalizeWhitespace(source.param);
  const id = normalizeWhitespace(source.id);
  const label = normalizeJobOutreachFilterLabel(type, source.label || source.selectedText || source.sourceText);
  if (!type || !param || !id || !label) {
    return null;
  }
  const sourceText = normalizeJobOutreachFilterLabel(type, source.sourceText || label);
  return {
    type,
    label,
    id,
    param,
    sourceText,
    resolvedAt: normalizeWhitespace(source.resolvedAt)
  };
}

function normalizeJobOutreachFilterCache(cache) {
  const normalized = {};
  Object.entries(cache || {}).forEach(([key, entry]) => {
    const value = normalizeJobOutreachFilterEntry(entry);
    if (!value) {
      return;
    }
    const cacheKey = normalizeFilterCacheKey(value.type, key.includes(":") ? key.split(":").slice(1).join(":") : value.sourceText);
    const sourceKey = normalizeFilterCacheKey(value.type, value.sourceText);
    const labelKey = normalizeFilterCacheKey(value.type, value.label);
    [cacheKey, sourceKey, labelKey].filter(Boolean).forEach((nextKey) => {
      normalized[nextKey] = value;
    });
  });
  return normalized;
}

function filterCacheSnapshot(stored) {
  return normalizeJobOutreachStore(stored?.jobOutreach).filterCache;
}

function parseLinkedInFilterIdsFromUrl(url) {
  const result = {};
  try {
    const parsed = new URL(normalizeUrl(url));
    Object.values(JOB_OUTREACH_FILTER_PARAMS).forEach((param) => {
      const raw = normalizeWhitespace(parsed.searchParams.get(param));
      if (!raw) {
        return;
      }
      try {
        const ids = JSON.parse(raw);
        result[param] = Array.isArray(ids) ? ids.map(normalizeWhitespace).filter(Boolean) : [];
      } catch (_error) {
        result[param] = raw.replace(/[\[\]"]/g, "").split(",").map(normalizeWhitespace).filter(Boolean);
      }
    });
  } catch (_error) {
    // Ignore malformed URLs; callers treat missing ids as unresolved.
  }
  return result;
}

function resolvedFilterFromCache(filter, filterCache) {
  const type = normalizeWhitespace(filter?.type).toLowerCase();
  const sourceText = normalizeWhitespace(filter?.sourceText || filter?.value || filter?.label);
  const cached = filterCache?.[normalizeFilterCacheKey(type, sourceText)]
    || filterCache?.[normalizeFilterCacheKey(type, filter?.label)];
  if (!cached) {
    return null;
  }
  return {
    ...cached,
    sourceText
  };
}

function searchFilterCandidates(search) {
  const criteria = search?.criteria || {};
  const filters = [];
  if (Array.isArray(search?.filters)) {
    search.filters.forEach((filter) => {
      const type = normalizeWhitespace(filter?.type).toLowerCase();
      const sourceText = normalizeWhitespace(filter?.sourceText || filter?.value || filter?.label);
      if (type && sourceText) {
        filters.push({
          type,
          sourceText,
          label: normalizeWhitespace(filter?.label || sourceText),
          id: normalizeWhitespace(filter?.id),
          param: normalizeWhitespace(filter?.param || JOB_OUTREACH_FILTER_PARAMS[type]),
          origin: normalizeWhitespace(filter?.origin)
        });
      }
    });
  }
  (Array.isArray(criteria.locations) ? criteria.locations : []).forEach((value) => filters.push({ type: "location", sourceText: value }));
  (Array.isArray(criteria.schools) ? criteria.schools : []).forEach((value) => filters.push({ type: "school", sourceText: value }));
  if (normalizeWhitespace(criteria.currentCompany)) {
    filters.push({ type: "company", sourceText: criteria.currentCompany });
  }
  const seen = new Set();
  return filters.filter((filter) => {
    const keys = [
      filter.id ? `${normalizeWhitespace(filter.type).toLowerCase()}:id:${normalizeWhitespace(filter.id)}` : "",
      normalizeFilterCacheKey(filter.type, filter.sourceText),
      normalizeFilterCacheKey(filter.type, filter.label)
    ].filter(Boolean);
    if (!keys.length || keys.some((key) => seen.has(key))) {
      return false;
    }
    keys.forEach((key) => seen.add(key));
    return true;
  });
}

function hydrateSearchFilters(search, filterCache) {
  const resolvedFilters = [];
  const unresolvedFilters = [];
  for (const filter of searchFilterCandidates(search)) {
    const explicit = normalizeJobOutreachFilterEntry(filter);
    const cached = explicit || resolvedFilterFromCache(filter, filterCache);
    if (cached) {
      resolvedFilters.push(cached);
    } else {
      unresolvedFilters.push(filter);
    }
  }
  const unresolvedCriteria = {
    locations: unresolvedFilters.filter((filter) => filter.type === "location").map((filter) => normalizeWhitespace(filter.sourceText)),
    schools: unresolvedFilters.filter((filter) => filter.type === "school").map((filter) => normalizeWhitespace(filter.sourceText)),
    currentCompany: normalizeWhitespace(unresolvedFilters.find((filter) => filter.type === "company")?.sourceText)
  };
  return {
    ...search,
    resolvedFilters,
    unresolvedFilters,
    unresolvedCriteria
  };
}

function appendResolvedFiltersToSearchUrl(url, resolvedFilters) {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) {
    return "";
  }
  const parsed = new URL(normalizedUrl);
  parsed.searchParams.set("origin", "GLOBAL_SEARCH_HEADER");
  const idsByParam = {};
  (Array.isArray(resolvedFilters) ? resolvedFilters : []).forEach((filter) => {
    const entry = normalizeJobOutreachFilterEntry(filter);
    if (!entry) {
      return;
    }
    idsByParam[entry.param] = uniqueStrings([...(idsByParam[entry.param] || []), entry.id]);
  });
  Object.entries(idsByParam).forEach(([param, ids]) => {
    if (ids.length) {
      parsed.searchParams.set(param, JSON.stringify(ids));
    }
  });
  return parsed.toString();
}

function parseLinkedInPeopleSearchUrlState(url) {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) {
    return {
      url: "",
      keywords: "",
      idsByParam: {},
      signature: ""
    };
  }
  try {
    const parsed = new URL(normalizedUrl);
    const idsByParam = parseLinkedInFilterIdsFromUrl(normalizedUrl);
    const signaturePayload = {
      path: parsed.pathname.replace(/\/+$/g, ""),
      keywords: normalizeWhitespace(parsed.searchParams.get("keywords")),
      geoUrn: uniqueStrings((idsByParam.geoUrn || []).map(normalizeWhitespace)).sort(),
      currentCompany: uniqueStrings((idsByParam.currentCompany || []).map(normalizeWhitespace)).sort(),
      schoolFilter: uniqueStrings((idsByParam.schoolFilter || []).map(normalizeWhitespace)).sort()
    };
    return {
      url: normalizedUrl,
      keywords: signaturePayload.keywords,
      idsByParam,
      signature: JSON.stringify(signaturePayload)
    };
  } catch (_error) {
    return {
      url: normalizedUrl,
      keywords: "",
      idsByParam: {},
      signature: ""
    };
  }
}

function linkedInPeopleSearchUrlSignature(url) {
  return parseLinkedInPeopleSearchUrlState(url).signature;
}

function matchingSearchFilterForAppliedFilter(search, appliedFilter) {
  const type = normalizeWhitespace(appliedFilter?.type).toLowerCase();
  const sourceText = normalizeWhitespace(appliedFilter?.value || appliedFilter?.sourceText || appliedFilter?.label);
  return [
    ...(Array.isArray(search?.unresolvedFilters) ? search.unresolvedFilters : []),
    ...(Array.isArray(search?.filters) ? search.filters : []),
    ...(Array.isArray(search?.resolvedFilters) ? search.resolvedFilters : [])
  ].find((filter) => jobOutreachFilterMatchesTarget(filter, { type, sourceText, label: sourceText })) || null;
}

function allowsResolvedSourceLabelFallback(filter) {
  return normalizeWhitespace(filter?.origin).toLowerCase() !== "custom";
}

function cacheUpdatesFromAppliedFilters(appliedFilterResult, finalUrlOverride, search) {
  const finalUrl = normalizeUrl(finalUrlOverride || appliedFilterResult?.finalUrl);
  const idsByParam = parseLinkedInFilterIdsFromUrl(finalUrl);
  const activeFilters = Array.isArray(appliedFilterResult?.activeFilters) ? appliedFilterResult.activeFilters : [];
  const indexByParam = {};
  const updates = [];
  (Array.isArray(appliedFilterResult?.appliedFilters) ? appliedFilterResult.appliedFilters : []).forEach((filter) => {
    const type = normalizeWhitespace(filter?.type).toLowerCase();
    const param = JOB_OUTREACH_FILTER_PARAMS[type];
    const ids = idsByParam[param] || [];
    const index = indexByParam[param] || 0;
    const id = normalizeWhitespace(filter?.id) || ids[index];
    if (!normalizeWhitespace(filter?.id)) {
      indexByParam[param] = index + 1;
    }
    const sourceFilter = matchingSearchFilterForAppliedFilter(search, filter);
    const sourceText = normalizeWhitespace(sourceFilter?.sourceText || filter?.value || filter?.sourceText);
    const label = resolvedLinkedInFilterLabel({
      filter: { ...(sourceFilter || {}), ...filter },
      type,
      sourceText,
      activeFilters,
      index,
      allowSourceFallback: allowsResolvedSourceLabelFallback(sourceFilter || filter)
    });
    if (type && param && id && label) {
      updates.push({
        type,
        param,
        id,
        label,
        sourceText,
        resolvedAt: toIsoNow()
      });
    }
  });
  return updates;
}

function isGenericLinkedInFilterLabel(label) {
  const normalized = normalizeWhitespace(label);
  return !normalized
    || /^\d+$/.test(normalized)
    || /^(people|all filters|reset|schools?|locations?|current companies?|companies?|1st|2nd|3rd\+?|1st connections|2nd connections|3rd\+? connections|premium actively hiring|act(?:ively)? hiring)$/i.test(normalized);
}

function filterLabelLooksLikeType(label, type) {
  const normalized = normalizeWhitespace(label);
  if (isGenericLinkedInFilterLabel(normalized)) {
    return false;
  }
  if (type === "location") {
    return /,|\b(?:area|united states|canada|kingdom|singapore|california|new york|texas|washington|remote)\b/i.test(normalized);
  }
  if (type === "school") {
    return /\b(?:university|college|school|institute|academy|som|mba|nus|mit)\b/i.test(normalized);
  }
  if (type === "company") {
    return !filterLabelLooksLikeType(normalized, "location") && !filterLabelLooksLikeType(normalized, "school");
  }
  return false;
}

function activeLinkedInFilterLabelsForType(activeFilters, type) {
  return uniqueStrings((Array.isArray(activeFilters) ? activeFilters : [])
    .map(normalizeWhitespace)
    .filter((label) => filterLabelLooksLikeType(label, type)));
}

function matchedActiveLinkedInFilterLabel(activeLabels, sourceText, fallbackIndex) {
  const sourceKey = normalizeFilterCacheKey("filter", sourceText).replace(/^filter:/, "");
  const sourceLead = normalizeWhitespace(sourceText).split(",")[0].toLowerCase();
  const matched = activeLabels.find((label) => {
    const labelKey = normalizeFilterCacheKey("filter", label).replace(/^filter:/, "");
    const lowerLabel = label.toLowerCase();
    return labelKey === sourceKey
      || (sourceLead.length >= 3 && lowerLabel.startsWith(sourceLead))
      || (sourceKey.length >= 3 && labelKey.includes(sourceKey));
  });
  return matched || activeLabels[fallbackIndex] || "";
}

function resolvedLinkedInFilterLabel({ filter, type, sourceText, activeFilters, index, allowSourceFallback = false }) {
  const selectedText = normalizeJobOutreachFilterLabel(type, filter?.selectedText);
  const selectedTextSource = normalizeWhitespace(filter?.selectedTextSource);
  const source = normalizeJobOutreachFilterLabel(type, sourceText || filter?.sourceText || filter?.value);
  if (selectedText && selectedTextSource === "linkedin_option") {
    return selectedText;
  }
  if (selectedText && selectedText.toLowerCase() !== source.toLowerCase()) {
    return selectedText;
  }
  const activeLabel = matchedActiveLinkedInFilterLabel(activeLinkedInFilterLabelsForType(activeFilters, type), source, index);
  if (activeLabel) {
    return normalizeJobOutreachFilterLabel(type, activeLabel);
  }
  if (selectedText && selectedTextSource === "existing_selection") {
    const activeLabels = (Array.isArray(activeFilters) ? activeFilters : []).map(normalizeWhitespace);
    if (activeLabels.some((label) => label.toLowerCase() === selectedText.toLowerCase())) {
      return selectedText;
    }
  }
  const existingLabel = normalizeJobOutreachFilterLabel(type, filter?.label);
  if (existingLabel && existingLabel.toLowerCase() !== source.toLowerCase()) {
    return existingLabel;
  }
  return allowSourceFallback ? source : "";
}

function cacheUpdatesFromSearchUrl(search, url, context) {
  const finalUrl = normalizeUrl(url);
  const idsByParam = parseLinkedInFilterIdsFromUrl(finalUrl);
  const activeFilters = Array.isArray(context?.peopleSearch?.activeFilters) ? context.peopleSearch.activeFilters : [];
  const resolvedCountsByParam = {};
  (Array.isArray(search?.resolvedFilters) ? search.resolvedFilters : [])
    .map(normalizeJobOutreachFilterEntry)
    .filter(Boolean)
    .forEach((entry) => {
      resolvedCountsByParam[entry.param] = Number(resolvedCountsByParam[entry.param] || 0) + 1;
    });
  const nextIndexByParam = { ...resolvedCountsByParam };
  return (Array.isArray(search?.unresolvedFilters) ? search.unresolvedFilters : [])
    .map((filter) => {
      const type = normalizeWhitespace(filter?.type).toLowerCase();
      const param = JOB_OUTREACH_FILTER_PARAMS[type];
      if (!param) {
        return null;
      }
      const ids = idsByParam[param] || [];
      const index = Number(nextIndexByParam[param] || 0);
      const id = ids[index];
      nextIndexByParam[param] = index + 1;
      const sourceText = normalizeWhitespace(filter?.sourceText || filter?.value || filter?.label);
      if (!id || !sourceText) {
        return null;
      }
      const label = resolvedLinkedInFilterLabel({
        filter,
        type,
        sourceText,
        activeFilters,
        index,
        allowSourceFallback: allowsResolvedSourceLabelFallback(filter)
      });
      if (!label) {
        return null;
      }
      return {
        type,
        param,
        id,
        label,
        sourceText,
        resolvedAt: toIsoNow()
      };
    })
    .filter(Boolean);
}

function failedFiltersFromAppliedFilters(appliedFilterResult) {
  return (Array.isArray(appliedFilterResult?.unresolvedFilters) ? appliedFilterResult.unresolvedFilters : [])
    .map((filter) => ({
      type: normalizeWhitespace(filter?.type).toLowerCase(),
      label: normalizeWhitespace(filter?.selectedText || filter?.label || filter?.value || filter?.sourceText),
      sourceText: normalizeWhitespace(filter?.value || filter?.sourceText || filter?.label),
      param: normalizeWhitespace(filter?.param || JOB_OUTREACH_FILTER_PARAMS[normalizeWhitespace(filter?.type).toLowerCase()]),
      state: "failed",
      error: normalizeWhitespace(filter?.error)
    }))
    .filter((filter) => filter.type && filter.sourceText);
}

async function mergeJobOutreachFilterCache(stored, updates) {
  const nextUpdates = (Array.isArray(updates) ? updates : [])
    .map(normalizeJobOutreachFilterEntry)
    .filter(Boolean);
  if (!nextUpdates.length) {
    return stored;
  }
  const currentStore = normalizeJobOutreachStore(stored?.jobOutreach);
  const filterCache = {
    ...currentStore.filterCache
  };
  nextUpdates.forEach((entry) => {
    [entry.sourceText, entry.label].map((value) => normalizeFilterCacheKey(entry.type, value)).filter(Boolean).forEach((key) => {
      filterCache[key] = entry;
    });
  });
  const nextStore = {
    ...currentStore,
    filterCache
  };
  const persistedStore = await persistNormalizedJobOutreachStore(nextStore);
  return {
    ...stored,
    jobOutreach: persistedStore
  };
}

function latestJobOutreachRunForPage(pageContext, stored) {
  const job = normalizeJobOutreachJob(pageContext?.job || {});
  const jobId = jobIdFromJob(job);
  if (!jobId) {
    return null;
  }
  const record = stored?.jobOutreach?.jobsById?.[jobId];
  if (!record?.latestRun) {
    return null;
  }
  return {
    jobId,
    job: record.job || job,
    latestRun: record.latestRun,
    analytics: record.analytics || null
  };
}

function jobOutreachRunsForPage(pageContext, stored) {
  const currentStore = normalizeJobOutreachStore(stored?.jobOutreach);
  const job = normalizeJobOutreachJob(pageContext?.job || {});
  const jobId = jobIdFromJob(job);
  const pageRunIds = currentStore.runOrder.filter((runId) => currentStore.runsById[runId]?.jobId === jobId);
  const activeRunIds = currentStore.runOrder.filter((runId) => isJobOutreachRunActiveStatus(currentStore.runsById[runId]?.status));
  return {
    runsById: currentStore.runsById,
    runOrder: currentStore.runOrder,
    pageRunIds,
    activeRunIds,
    selectedRunId: pageRunIds[0] || ""
  };
}

function compactJobOutreachHistoryEntry(run, searches, importedPeopleBySearch) {
  return {
    runId: run.runId,
    createdAt: run.createdAt,
    searchKeys: searches.map((search) => search.searchKey),
    keywords: searches.map((search) => ({
      searchKey: search.searchKey,
      keywords: search.keywords
    })),
    criteriaUsed: run.sharedCriteria,
    resultCounts: Object.fromEntries(
      Object.entries(importedPeopleBySearch || {}).map(([key, people]) => [key, Array.isArray(people) ? people.length : 0])
    )
  };
}

function resolveCaptureJobId(message) {
  const explicit = normalizeWhitespace(message?.jobId);
  if (explicit) {
    return explicit;
  }
  return jobIdFromJob(normalizeJobOutreachJob(message?.job || {}));
}

function jobCapturesForJobId(store, jobId) {
  if (!jobId) {
    return [];
  }
  const record = normalizeJobOutreachStore(store).jobsById[jobId];
  return record?.captures?.people || [];
}

function upsertJobPageCaptureInStore(store, job, person) {
  const currentStore = normalizeJobOutreachStore(store);
  const normalizedJob = normalizeJobOutreachJob(job || {});
  const jobId = jobIdFromJob(normalizedJob);
  if (!jobId) {
    throw new Error("Open a LinkedIn job first.");
  }
  const normalizedPerson = normalizeCapturedPerson(person);
  if (!normalizedPerson) {
    throw new Error("Could not read this person's LinkedIn profile URL.");
  }
  const now = toIsoNow();
  const existing = currentStore.jobsById[jobId] || {
    jobId,
    job: normalizedJob,
    latestRun: null,
    analytics: { totalSearchRuns: 0, lastSearchAt: "", searchTermHistory: [] },
    captures: { people: [], updatedAt: "" },
    firstSeenAt: now,
    updatedAt: now
  };
  const people = Array.isArray(existing.captures?.people) ? existing.captures.people.slice() : [];
  if (!people.some((entry) => entry.profileUrl === normalizedPerson.profileUrl)) {
    people.push(normalizedPerson);
  }
  currentStore.jobsById[jobId] = {
    ...existing,
    jobId,
    job: normalizeWhitespace(existing.job?.title) ? existing.job : normalizedJob,
    captures: { people: people.slice(-JOB_PAGE_CAPTURES_MAX), updatedAt: now },
    firstSeenAt: normalizeWhitespace(existing.firstSeenAt) || now,
    updatedAt: now
  };
  return { store: currentStore, jobId };
}

function updateJobPageCaptureInStore(store, jobId, profileUrl, edits) {
  const currentStore = normalizeJobOutreachStore(store);
  const record = currentStore.jobsById[jobId];
  if (!record) {
    throw new Error("No captured people for this job.");
  }
  const normalizedUrl = normalizeLinkedInProfileUrl(profileUrl);
  const now = toIsoNow();
  const people = (record.captures?.people || []).map((entry) => {
    if (entry.profileUrl !== normalizedUrl) {
      return entry;
    }
    const note = edits?.note !== undefined ? normalizeWhitespace(edits.note) : entry.note;
    const relationshipContext = edits?.relationshipContext !== undefined
      ? normalizeWhitespace(edits.relationshipContext)
      : entry.relationshipContext;
    return {
      ...entry,
      name: edits?.name !== undefined ? normalizeWhitespace(edits.name) : entry.name,
      headline: edits?.headline !== undefined ? normalizeWhitespace(edits.headline) : entry.headline,
      connectionDegree: edits?.connectionDegree !== undefined ? normalizeWhitespace(edits.connectionDegree) : entry.connectionDegree,
      note,
      relationshipContext,
      aiGeneratedInsight: note || relationshipContext || entry.aiGeneratedInsight,
      updatedAt: now
    };
  });
  currentStore.jobsById[jobId] = {
    ...record,
    captures: { people, updatedAt: now },
    updatedAt: now
  };
  return { store: currentStore, jobId };
}

function removeJobPageCaptureFromStore(store, jobId, profileUrl) {
  const currentStore = normalizeJobOutreachStore(store);
  const record = currentStore.jobsById[jobId];
  if (!record) {
    return { store: currentStore, jobId };
  }
  const normalizedUrl = normalizeLinkedInProfileUrl(profileUrl);
  const now = toIsoNow();
  const people = (record.captures?.people || []).filter((entry) => entry.profileUrl !== normalizedUrl);
  currentStore.jobsById[jobId] = {
    ...record,
    captures: { people, updatedAt: now },
    updatedAt: now
  };
  return { store: currentStore, jobId };
}

async function broadcastJobPageCapturesChanged(jobId, people, sourceTabId) {
  const payload = { type: MESSAGE_TYPES.JOB_PAGE_CAPTURES_CHANGED, jobId, captures: people };
  try {
    chrome.runtime.sendMessage(payload).catch(() => {});
  } catch (_error) {}
  if (typeof sourceTabId === "number") {
    try {
      chrome.tabs.sendMessage(sourceTabId, payload).catch(() => {});
    } catch (_error) {}
  }
}

async function captureJobPagePersonWorkflow(message) {
  let stored = await getStoredState();
  const { store, jobId } = upsertJobPageCaptureInStore(stored?.jobOutreach, message?.job, message?.person);
  const nextStore = await persistNormalizedJobOutreachStore(store);
  stored = { ...stored, jobOutreach: nextStore };
  const people = nextStore.jobsById[jobId]?.captures?.people || [];
  await broadcastJobPageCapturesChanged(jobId, people, message?.sourceTabId);
  return { ok: true, jobId, captures: people };
}

async function updateJobPageCaptureWorkflow(message) {
  const jobId = resolveCaptureJobId(message);
  const profileUrl = normalizeWhitespace(message?.profileUrl);
  if (!jobId || !profileUrl) {
    throw new Error("Missing job or profile reference for this edit.");
  }
  let stored = await getStoredState();
  const { store } = updateJobPageCaptureInStore(stored?.jobOutreach, jobId, profileUrl, message?.edits || {});
  const nextStore = await persistNormalizedJobOutreachStore(store);
  stored = { ...stored, jobOutreach: nextStore };
  const people = nextStore.jobsById[jobId]?.captures?.people || [];
  await broadcastJobPageCapturesChanged(jobId, people, message?.sourceTabId);
  return { ok: true, jobId, captures: people };
}

async function removeJobPagePersonWorkflow(message) {
  const jobId = resolveCaptureJobId(message);
  const profileUrl = normalizeWhitespace(message?.profileUrl);
  if (!jobId || !profileUrl) {
    throw new Error("Missing job or profile reference for this removal.");
  }
  let stored = await getStoredState();
  const { store } = removeJobPageCaptureFromStore(stored?.jobOutreach, jobId, profileUrl);
  const nextStore = await persistNormalizedJobOutreachStore(store);
  stored = { ...stored, jobOutreach: nextStore };
  const people = nextStore.jobsById[jobId]?.captures?.people || [];
  await broadcastJobPageCapturesChanged(jobId, people, message?.sourceTabId);
  return { ok: true, jobId, captures: people };
}

async function getJobPageCapturesWorkflow(message) {
  const stored = await getStoredState();
  const jobId = resolveCaptureJobId(message);
  return { ok: true, jobId, captures: jobCapturesForJobId(stored?.jobOutreach, jobId) };
}

async function saveJobOutreachLatestRun(stored, workflow) {
  const job = normalizeJobOutreachJob(workflow?.job || {});
  const jobId = jobIdFromJob(job);
  if (!jobId) {
    return { stored, savedRun: null };
  }
  const now = toIsoNow();
  const currentStore = normalizeJobOutreachStore(stored?.jobOutreach);
  const existing = currentStore.jobsById[jobId] || {
    jobId,
    firstSeenAt: now,
    analytics: {
      totalSearchRuns: 0,
      lastSearchAt: "",
      searchTermHistory: []
    }
  };
  const normalizeRunFilter = (filter) => ({
    type: normalizeWhitespace(filter?.type).toLowerCase(),
    label: normalizeJobOutreachFilterLabel(filter?.type, filter?.label || filter?.sourceText || filter?.value),
    sourceText: normalizeJobOutreachFilterLabel(filter?.type, filter?.sourceText || filter?.value || filter?.label),
    id: normalizeWhitespace(filter?.id),
    param: normalizeWhitespace(filter?.param || JOB_OUTREACH_FILTER_PARAMS[normalizeWhitespace(filter?.type).toLowerCase()]),
    state: normalizeWhitespace(filter?.state),
    origin: normalizeWhitespace(filter?.origin)
  });
  const isOneTimeCustomFilter = (filter) => filter.origin === "custom" && !filter.id;
  const searches = (Array.isArray(workflow.searches) ? workflow.searches : []).map((search) => {
    const rawFilters = (Array.isArray(search.filters) ? search.filters : [])
      .map(normalizeRunFilter)
      .filter((filter) => filter.type && filter.sourceText);
    const oneTimeCustomKeys = new Set(rawFilters
      .filter(isOneTimeCustomFilter)
      .map((filter) => normalizeFilterCacheKey(filter.type, filter.sourceText))
      .filter(Boolean));
    const filters = rawFilters.filter((filter) => !isOneTimeCustomFilter(filter));
    const unresolvedFilters = (Array.isArray(search.unresolvedFilters) ? search.unresolvedFilters : [])
      .map(normalizeRunFilter)
      .filter((filter) => filter.type && filter.sourceText && !isOneTimeCustomFilter(filter));
    const failedFilters = (Array.isArray(search.failedFilters) ? search.failedFilters : [])
      .map(normalizeRunFilter)
      .filter((filter) => filter.type && filter.sourceText && !oneTimeCustomKeys.has(normalizeFilterCacheKey(filter.type, filter.sourceText)));
    const criteriaFilters = [
      ...filters,
      ...(Array.isArray(search.resolvedFilters) ? search.resolvedFilters : []).map(normalizeRunFilter).filter((filter) => filter.type && filter.sourceText),
      ...unresolvedFilters
    ];
    const criteria = {
      locations: uniqueStrings(criteriaFilters.filter((filter) => filter.type === "location").map((filter) => filter.sourceText || filter.label)),
      schools: uniqueStrings(criteriaFilters.filter((filter) => filter.type === "school").map((filter) => filter.sourceText || filter.label)),
      currentCompany: normalizeWhitespace(criteriaFilters.find((filter) => filter.type === "company")?.sourceText || criteriaFilters.find((filter) => filter.type === "company")?.label)
    };
    return {
      index: Number(search.index || 0),
      searchKey: normalizeWhitespace(search.searchKey),
      searchNumber: Number(search.searchNumber || searchNumberFromKey(search.searchKey)),
      keywords: normalizeWhitespace(search.keywords),
      enabledCriteria: Array.isArray(search.enabledCriteria) ? search.enabledCriteria : [],
      criteria,
      filters,
      resolvedFilters: Array.isArray(search.resolvedFilters) ? search.resolvedFilters : [],
      unresolvedFilters,
      failedFilters,
      plannedUrl: normalizeUrl(search.plannedUrl),
      url: normalizeUrl(search.url),
      urlSignature: normalizeWhitespace(search.urlSignature),
      searchContract: search.searchContract && typeof search.searchContract === "object"
        ? {
          searchKey: normalizeWhitespace(search.searchContract.searchKey || search.searchKey),
          workerTabId: typeof search.searchContract.workerTabId === "number" ? search.searchContract.workerTabId : null,
          keywords: normalizeWhitespace(search.searchContract.keywords || search.keywords),
          plannedUrl: normalizeUrl(search.searchContract.plannedUrl || search.plannedUrl),
          plannedUrlSignature: normalizeWhitespace(search.searchContract.plannedUrlSignature),
          finalUrl: normalizeUrl(search.searchContract.finalUrl || search.url),
          finalUrlSignature: normalizeWhitespace(search.searchContract.finalUrlSignature || search.urlSignature),
          expectedFilterCounts: search.searchContract.expectedFilterCounts && typeof search.searchContract.expectedFilterCounts === "object"
            ? Object.fromEntries(Object.entries(search.searchContract.expectedFilterCounts).map(([param, count]) => [normalizeWhitespace(param), Math.max(0, Number(count || 0))]))
            : {}
        }
        : null
    };
  });
  const sharedCriteria = searches.reduce((criteria, search) => ({
    locations: criteria.locations.length ? criteria.locations : (Array.isArray(search.criteria?.locations) ? search.criteria.locations : []),
    schools: criteria.schools.length ? criteria.schools : (Array.isArray(search.criteria?.schools) ? search.criteria.schools : []),
    currentCompany: criteria.currentCompany || normalizeWhitespace(search.criteria?.currentCompany)
  }), { locations: [], schools: [], currentCompany: "" });
  const run = {
    runId: normalizeWhitespace(workflow.requestId) || `job_outreach_${Date.now()}`,
    jobId,
    createdAt: now,
    startedAt: now,
    completedAt: now,
    updatedAt: now,
    status: "completed",
    cancelRequested: false,
    progressText: "Ranked people ready.",
    progressDetail: `${((workflow.rankingPlan?.people || []).length || 0)} ranked people returned.`,
    progressPercent: 100,
    sourceTabId: typeof workflow.sourceTabId === "number" ? workflow.sourceTabId : null,
    workerTabId: null,
    sharedCriteria,
    searches,
    searchPlan: workflow.searchPlan || null,
    rankingInput: workflow.rankingInput || null,
    peopleBySearch: workflow.importedPeopleBySearch || {},
    peopleBySearchKey: workflow.importedPeopleBySearchKey || {},
    rankingPlan: workflow.rankingPlan || null,
    diagnostics: {
      importedCounts: Object.fromEntries(
        Object.entries(workflow.importedPeopleBySearch || {}).map(([key, people]) => [key, Array.isArray(people) ? people.length : 0])
      ),
      searchGenerationAttempt: Number(workflow.searchGenerationAttempt || 0),
      rankingGenerationAttempt: Number(workflow.rankingGenerationAttempt || 0)
    }
  };
  const history = [
    ...(Array.isArray(existing.analytics?.searchTermHistory) ? existing.analytics.searchTermHistory : []),
    compactJobOutreachHistoryEntry(run, searches, workflow.importedPeopleBySearch)
  ].slice(-20);
  currentStore.jobsById[jobId] = {
    jobId,
    job: {
      ...job,
      descriptionHash: compactHash(job.description)
    },
    latestRun: run,
    analytics: {
      totalSearchRuns: Math.max(0, Number(existing.analytics?.totalSearchRuns || 0)) + 1,
      lastSearchAt: now,
      searchTermHistory: history
    },
    captures: normalizeJobCaptures(existing),
    firstSeenAt: normalizeWhitespace(existing.firstSeenAt) || now,
    updatedAt: now
  };
  const completedRun = normalizeJobOutreachRun({
    ...run,
    job,
    importedPeopleBySearch: workflow.importedPeopleBySearch || {},
    importedPeopleBySearchKey: workflow.importedPeopleBySearchKey || {},
    rankingInput: workflow.rankingInput || null,
    diagnostics: run.diagnostics || null
  }, jobId);
  currentStore.runsById = {
    ...(currentStore.runsById || {}),
    [completedRun.runId]: completedRun
  };
  currentStore.runOrder = uniqueStrings([completedRun.runId, ...(currentStore.runOrder || [])]);
  currentStore.queue = (Array.isArray(currentStore.queue) ? currentStore.queue : []).filter((runId) => runId !== completedRun.runId);
  if (normalizeWhitespace(currentStore.activeRunId) === completedRun.runId) {
    currentStore.activeRunId = "";
  }
  const normalizedStore = await persistNormalizedJobOutreachStore(currentStore);
  return {
    stored: {
      ...stored,
      jobOutreach: normalizedStore
    },
    savedRun: latestJobOutreachRunForPage({ job }, { jobOutreach: normalizedStore })
  };
}

function normalizeJobOutreachSearches(searches) {
  const keys = jobOutreachAi?.SEARCH_KEYS || ["A", "B", "C"];
  const normalizeCriteriaLocations = (values) => {
    const raw = Array.isArray(values) ? values.map(normalizeWhitespace).filter(Boolean) : [];
    const result = [];
    for (let index = 0; index < raw.length; index += 1) {
      const current = raw[index];
      const next = raw[index + 1] || "";
      if (next && /^[A-Z]{2}$/i.test(next) && !/,/.test(current)) {
        result.push(`${current}, ${next.toUpperCase()}`);
        index += 1;
      } else {
        result.push(current.replace(/\s*\+\d+\s+more\b/i, "").trim());
      }
    }
    return uniqueStrings(result);
  };
  const normalizeCriteriaSchools = (values) => {
    const normalized = uniqueStrings((Array.isArray(values) ? values : [])
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
    }));
    return normalized.filter((school) => {
      const lower = school.toLowerCase();
      return !normalized.some((other) => other !== school && other.toLowerCase().includes(lower));
    });
  };
  return (Array.isArray(searches) ? searches : []).slice(0, 3).map((search, index) => {
    const criteria = search?.criteria || {};
    return {
      searchKey: normalizeWhitespace(search?.searchKey || keys[index] || String(index + 1)),
      searchNumber: Number(search?.searchNumber || index + 1),
      keywords: normalizeWhitespace(search?.keywords || search?.text),
      enabledCriteria: Array.isArray(search?.enabledCriteria) ? search.enabledCriteria : [],
      filters: Array.isArray(search?.filters) ? search.filters.map((filter) => ({
        type: normalizeWhitespace(filter?.type).toLowerCase(),
        label: normalizeWhitespace(filter?.label || filter?.sourceText || filter?.value),
        sourceText: normalizeWhitespace(filter?.sourceText || filter?.value || filter?.label),
        id: normalizeWhitespace(filter?.id),
        param: normalizeWhitespace(filter?.param),
        origin: normalizeWhitespace(filter?.origin)
      })).filter((filter) => filter.type && filter.sourceText) : [],
      criteria: {
        locations: normalizeCriteriaLocations(criteria.locations),
        schools: normalizeCriteriaSchools(criteria.schools),
        currentCompany: normalizeWhitespace(criteria.currentCompany)
      }
    };
  }).filter((search) => search.keywords);
}

function searchNumberFromKey(searchKey) {
  const normalized = normalizeWhitespace(searchKey).toUpperCase();
  // Reserved key for people captured directly from a job page — sorts/keys after A/B/C.
  if (normalized === "PAGE") {
    return 4;
  }
  const keys = jobOutreachAi?.SEARCH_KEYS || ["A", "B", "C"];
  const index = keys.indexOf(normalized);
  return index >= 0 ? index + 1 : 1;
}

function buildJobOutreachImportedPeopleMaps(importedSearches) {
  const importedPeopleBySearch = {};
  const importedPeopleBySearchKey = {};
  (Array.isArray(importedSearches) ? importedSearches : []).forEach((search) => {
    const searchKey = normalizeWhitespace(search?.searchKey);
    const searchNumber = Number(search?.searchNumber || searchNumberFromKey(searchKey));
    const people = Array.isArray(search?.people) ? search.people : [];
    importedPeopleBySearch[String(searchNumber)] = people;
    importedPeopleBySearchKey[searchKey] = people;
  });
  return {
    importedPeopleBySearch,
    importedPeopleBySearchKey
  };
}

function buildJobOutreachSearchSnapshot(search, importedSearchByKey) {
  const source = search && typeof search === "object" ? search : {};
  const imported = importedSearchByKey.get(normalizeWhitespace(source.searchKey)) || source;
  const searchKey = normalizeWhitespace(source.searchKey || imported.searchKey);
  const resolvedFilterUpdates = Array.isArray(imported?.resolvedFilterUpdates) ? imported.resolvedFilterUpdates : [];
  return {
    index: Number(source.index || searchNumberFromKey(searchKey) - 1),
    searchKey,
    searchNumber: Number(source.searchNumber || searchNumberFromKey(searchKey)),
    keywords: normalizeWhitespace(source.keywords),
    enabledCriteria: Array.isArray(source.enabledCriteria) ? source.enabledCriteria : [],
    criteria: source.criteria || { locations: [], schools: [], currentCompany: "" },
    filters: searchFilterCandidates(source).map((filter) => ({
      type: filter.type,
      label: normalizeWhitespace(filter.label || filter.sourceText),
      sourceText: normalizeWhitespace(filter.sourceText),
      id: normalizeWhitespace(filter.id),
      param: normalizeWhitespace(filter.param || JOB_OUTREACH_FILTER_PARAMS[filter.type]),
      origin: normalizeWhitespace(filter.origin)
    })),
    resolvedFilters: [
      ...(Array.isArray(source.resolvedFilters) ? source.resolvedFilters : []),
      ...resolvedFilterUpdates
    ],
    unresolvedFilters: Array.isArray(source.unresolvedFilters) ? source.unresolvedFilters : [],
    failedFilters: Array.isArray(imported?.failedFilters)
      ? imported.failedFilters
      : (Array.isArray(source.failedFilters) ? source.failedFilters : []),
    plannedUrl: normalizeUrl(imported?.plannedUrl || source.plannedUrl || findJobOutreachSearchPlanUrl({ searches: [source] }, searchKey)),
    url: normalizeUrl(imported?.searchUrl || imported?.url || source.url || source.searchUrl || ""),
    urlSignature: normalizeWhitespace(imported?.searchUrlSignature || imported?.sourceUrlSignature || source.urlSignature),
    searchContract: imported?.searchContract || source.searchContract || null
  };
}

function buildPersistentJobOutreachRun(runState, overrides = {}) {
  const importedSearches = (Array.isArray(runState?.importedSearches) ? runState.importedSearches : [])
    .slice()
    .sort((left, right) => searchNumberFromKey(left.searchKey) - searchNumberFromKey(right.searchKey));
  const importedSearchByKey = new Map(importedSearches.map((search) => [normalizeWhitespace(search.searchKey), search]));
  const { importedPeopleBySearch, importedPeopleBySearchKey } = buildJobOutreachImportedPeopleMaps(importedSearches);
  const searches = (Array.isArray(runState?.searches) ? runState.searches : []).map((search) => buildJobOutreachSearchSnapshot(search, importedSearchByKey));
  const sharedCriteria = searches.reduce((criteria, search) => ({
    locations: criteria.locations.length ? criteria.locations : (Array.isArray(search.criteria?.locations) ? search.criteria.locations : []),
    schools: criteria.schools.length ? criteria.schools : (Array.isArray(search.criteria?.schools) ? search.criteria.schools : []),
    currentCompany: criteria.currentCompany || normalizeWhitespace(search.criteria?.currentCompany)
  }), { locations: [], schools: [], currentCompany: "" });
  return normalizeJobOutreachRun({
    runId: overrides.runId || runState?.requestId,
    jobId: overrides.jobId || jobIdFromJob(overrides.job || runState?.job || {}),
    job: overrides.job || runState?.job || {},
    createdAt: overrides.createdAt || runState?.createdAt || toIsoNow(),
    startedAt: overrides.startedAt ?? runState?.startedAt ?? "",
    completedAt: overrides.completedAt ?? runState?.completedAt ?? "",
    updatedAt: toIsoNow(),
    sourceTabId: typeof overrides.sourceTabId === "number" ? overrides.sourceTabId : runState?.sourceTabId,
    workerTabId: typeof overrides.workerTabId === "number" ? overrides.workerTabId : runState?.workerTabId,
    status: overrides.status || runState?.status || "queued",
    cancelRequested: Object.prototype.hasOwnProperty.call(overrides, "cancelRequested")
      ? Boolean(overrides.cancelRequested)
      : Boolean(runState?.cancelRequested),
    progressText: Object.prototype.hasOwnProperty.call(overrides, "progressText")
      ? overrides.progressText
      : (runState?.progressText || ""),
    progressDetail: Object.prototype.hasOwnProperty.call(overrides, "progressDetail")
      ? overrides.progressDetail
      : (runState?.progressDetail || ""),
    progressPercent: Object.prototype.hasOwnProperty.call(overrides, "progressPercent")
      ? overrides.progressPercent
      : Number(runState?.progressPercent || 0),
    sharedCriteria,
    searches,
    searchPlan: overrides.searchPlan || runState?.searchPlan || null,
    rankingPlan: Object.prototype.hasOwnProperty.call(overrides, "rankingPlan") ? overrides.rankingPlan : (runState?.rankingPlan || null),
    rankingInput: Object.prototype.hasOwnProperty.call(overrides, "rankingInput") ? overrides.rankingInput : (runState?.rankingInput || null),
    importedPeopleBySearch: Object.prototype.hasOwnProperty.call(overrides, "importedPeopleBySearch")
      ? overrides.importedPeopleBySearch
      : importedPeopleBySearch,
    importedPeopleBySearchKey: Object.prototype.hasOwnProperty.call(overrides, "importedPeopleBySearchKey")
      ? overrides.importedPeopleBySearchKey
      : importedPeopleBySearchKey,
    diagnostics: Object.prototype.hasOwnProperty.call(overrides, "diagnostics") ? overrides.diagnostics : (runState?.diagnostics || null),
    manualAction: Object.prototype.hasOwnProperty.call(overrides, "manualAction") ? overrides.manualAction : (runState?.manualAction || null),
    error: Object.prototype.hasOwnProperty.call(overrides, "error") ? overrides.error : (runState?.error || "")
  }, overrides.jobId || jobIdFromJob(overrides.job || runState?.job || {}));
}

async function persistNormalizedJobOutreachStore(currentStore) {
  const normalizedStore = normalizeJobOutreachStore(currentStore);
  const pressure = await jobOutreachStoragePressure();
  let nextStore = trimJobOutreachRuns(normalizedStore, { pressure });

  if (await isMigrated()) {
    try {
      await persistJobOutreachToIdb(nextStore);
      return nextStore;
    } catch (error) {
      const message = String(error?.message || error || "");
      if (!/quota/i.test(message)) {
        throw error;
      }
      nextStore = trimJobOutreachRuns(normalizedStore, { pressure: "high" });
      await persistJobOutreachToIdb(nextStore);
      return nextStore;
    }
  }

  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.jobOutreach]: nextStore });
    return nextStore;
  } catch (error) {
    const message = String(error?.message || error || "");
    if (!/quota/i.test(message)) {
      throw error;
    }
    nextStore = trimJobOutreachRuns(normalizedStore, { pressure: "high" });
    await chrome.storage.local.set({ [STORAGE_KEYS.jobOutreach]: nextStore });
    return nextStore;
  }
}

async function persistJobOutreachToIdb(store) {
  const db = await openDatabase();
  const runItems = Object.values(store.runsById || {}).filter((r) => r?.runId);
  const jobItems = Object.values(store.jobsById || {}).filter((j) => j?.jobId);

  await idbClear(db, "jobOutreachRuns");
  if (runItems.length) {
    await idbPutBatch(db, "jobOutreachRuns", runItems);
  }

  await idbClear(db, "jobOutreachJobs");
  if (jobItems.length) {
    await idbPutBatch(db, "jobOutreachJobs", jobItems);
  }

  await setIdbMeta(db, "jobOutreachCoordination", {
    filterCache: store.filterCache || {},
    runOrder: store.runOrder || [],
    queue: store.queue || [],
    activeRunId: store.activeRunId || ""
  });
}

async function persistJobOutreachRunState(runState, overrides = {}, options = {}) {
  const currentStore = normalizeJobOutreachStore(runState?.stored?.jobOutreach);
  const nextRun = buildPersistentJobOutreachRun(runState, overrides);
  const nextQueue = uniqueStrings([
    ...(Array.isArray(currentStore.queue) ? currentStore.queue : []),
    ...(options.enqueue ? [nextRun.runId] : [])
  ]).filter((runId) => runId !== nextRun.runId || normalizeJobOutreachRunStatus(nextRun.status) === "queued");
  const nextStore = await persistNormalizedJobOutreachStore({
    ...currentStore,
    activeRunId: Object.prototype.hasOwnProperty.call(options, "activeRunId")
      ? normalizeWhitespace(options.activeRunId)
      : (options.setActive ? nextRun.runId : currentStore.activeRunId),
    queue: normalizeJobOutreachRunStatus(nextRun.status) === "queued"
      ? uniqueStrings([nextRun.runId, ...nextQueue])
      : nextQueue.filter((runId) => runId !== nextRun.runId),
    runsById: {
      ...currentStore.runsById,
      [nextRun.runId]: nextRun
    },
    runOrder: uniqueStrings([nextRun.runId, ...(currentStore.runOrder || [])])
  });
  runState.stored = {
    ...(runState.stored || {}),
    jobOutreach: nextStore
  };
  return nextStore.runsById[nextRun.runId];
}

async function persistTerminalJobOutreachRun(runState, overrides = {}, options = {}) {
  const currentStore = normalizeJobOutreachStore(runState?.stored?.jobOutreach);
  const nextRun = buildPersistentJobOutreachRun(runState, overrides);
  const nextStore = await persistNormalizedJobOutreachStore({
    ...currentStore,
    activeRunId: currentStore.activeRunId === nextRun.runId ? "" : currentStore.activeRunId,
    queue: (currentStore.queue || []).filter((runId) => runId !== nextRun.runId),
    runsById: {
      ...currentStore.runsById,
      [nextRun.runId]: nextRun
    },
    runOrder: uniqueStrings([nextRun.runId, ...(currentStore.runOrder || [])])
  });
  runState.stored = {
    ...(runState.stored || {}),
    jobOutreach: nextStore
  };
  if (options.removeFromPending) {
    pendingJobOutreachRuns.delete(nextRun.runId);
  }
  return nextStore.runsById[nextRun.runId];
}

async function hydrateJobOutreachRunProgress(runState, sourceTabId, progress) {
  if (!runState) {
    return null;
  }
  const manualAction = progress?.manualAction ? normalizeJobOutreachManualActionSnapshot(progress.manualAction) : null;
  runState.sourceTabId = typeof sourceTabId === "number" ? sourceTabId : runState.sourceTabId;
  runState.workerTabId = typeof progress?.workerTabId === "number" ? progress.workerTabId : runState.workerTabId;
  runState.status = manualAction
    ? normalizeJobOutreachRunStatus(manualAction.status || "awaiting_user_action")
    : normalizeJobOutreachRunStatus(progress?.status || runState.status || "running");
  runState.progressText = normalizeWhitespace(progress?.text);
  runState.progressDetail = normalizeWhitespace(progress?.detail);
  runState.progressPercent = Math.max(0, Math.min(100, Number(progress?.progressPercent || 0)));
  runState.manualAction = manualAction;
  if (manualAction) {
    runState.workerTabId = typeof manualAction.workerTabId === "number" ? manualAction.workerTabId : runState.workerTabId;
  }
  if (runState.status === "running" || runState.status === "resuming") {
    runState.startedAt = normalizeWhitespace(runState.startedAt) || toIsoNow();
  }
  const activeStatus = normalizeJobOutreachRunStatus(runState.status);
  await persistJobOutreachRunState(runState, {}, {
    setActive: activeStatus === "running" || activeStatus === "resuming" || activeStatus === "awaiting_user_action",
    activeRunId: activeStatus === "queued" ? "" : runState.requestId
  });
  return runState;
}

function buildJobOutreachQueuedResponse(runState, queuePosition) {
  return {
    ok: true,
    queued: true,
    requestId: runState.requestId,
    queuePosition,
    job: runState.job,
    searches: runState.searches,
    searchPlan: runState.searchPlan,
    rankingPlan: null,
    importedPeopleBySearch: {},
    importedPeopleBySearchKey: {},
    jobOutreachLatestRun: latestJobOutreachRunForPage({ job: runState.job }, runState.stored),
    jobOutreachFilterCache: filterCacheSnapshot(runState.stored)
  };
}

async function startQueuedJobOutreachRun(requestId) {
  const runState = pendingJobOutreachRuns.get(normalizeWhitespace(requestId));
  if (!runState) {
    return null;
  }
  runState.status = "running";
  runState.cancelRequested = false;
  runState.startedAt = normalizeWhitespace(runState.startedAt) || toIsoNow();
  await persistJobOutreachRunState(runState, {
    status: "running",
    startedAt: runState.startedAt,
    progressText: runState.progressText || "Starting queued Job Outreach.",
    progressDetail: runState.progressDetail || "A previous Job Outreach run finished, so this run is starting now.",
    progressPercent: Math.max(5, Number(runState.progressPercent || 5)),
    manualAction: null
  }, { setActive: true, activeRunId: runState.requestId });
  await sendJobOutreachProgress(runState.requestId, runState.sourceTabId, {
    text: runState.progressText || "Starting queued Job Outreach.",
    detail: runState.progressDetail || "A previous Job Outreach run finished, so this run is starting now.",
    progressPercent: Math.max(5, Number(runState.progressPercent || 5)),
    status: "running",
    workerTabId: runState.workerTabId
  });
  return continueJobOutreachWorkflow(runState, (text, meta) => persistAndSendJobOutreachProgress(runState, runState.sourceTabId, { text, ...(meta || {}) }));
}

async function maybeStartNextQueuedJobOutreachRun(stored) {
  const promoted = promoteNextQueuedJobOutreachRun(stored?.jobOutreach);
  const nextStore = await persistNormalizedJobOutreachStore(promoted.store);
  if (!promoted.nextRun?.runId) {
    return {
      ...(stored || {}),
      jobOutreach: nextStore
    };
  }
  const updatedStored = {
    ...(stored || {}),
    jobOutreach: nextStore
  };
  const runState = pendingJobOutreachRuns.get(promoted.nextRun.runId);
  if (runState) {
    runState.stored = updatedStored;
    void startQueuedJobOutreachRun(promoted.nextRun.runId).catch(async (error) => {
      const failureRunState = pendingJobOutreachRuns.get(promoted.nextRun.runId);
      if (!failureRunState) {
        return;
      }
      failureRunState.error = error?.message || String(error);
      failureRunState.status = normalizeWhitespace(error?.code) === "JOB_OUTREACH_CANCELLED" ? "cancelled" : "failed";
      await persistTerminalJobOutreachRun(failureRunState, {
        status: failureRunState.status,
        completedAt: toIsoNow(),
        progressText: failureRunState.status === "cancelled" ? "Job Outreach cancelled." : "Job Outreach failed.",
        progressDetail: failureRunState.error,
        progressPercent: Number(failureRunState.progressPercent || 0),
        error: failureRunState.error,
        manualAction: null
      }, { removeFromPending: true });
      await sendJobOutreachProgress(promoted.nextRun.runId, failureRunState.sourceTabId, {
        text: failureRunState.status === "cancelled" ? "Job Outreach cancelled." : "Job Outreach failed.",
        detail: failureRunState.error,
        progressPercent: Number(failureRunState.progressPercent || 0),
        status: failureRunState.status
      });
      await maybeStartNextQueuedJobOutreachRun(failureRunState.stored);
    });
  }
  return updatedStored;
}

async function persistAndSendJobOutreachProgress(runState, sourceTabId, progress) {
  await hydrateJobOutreachRunProgress(runState, sourceTabId, progress);
  await sendJobOutreachProgress(runState.requestId, sourceTabId, progress);
}

async function sendJobOutreachProgress(requestId, sourceTabId, progress) {
  const normalizedRequestId = normalizeWhitespace(requestId);
  if (!normalizedRequestId) {
    return;
  }
  const manualAction = progress?.manualAction && typeof progress.manualAction === "object"
    ? {
      requestId: normalizeWhitespace(progress.manualAction.requestId || normalizedRequestId),
      searchKey: normalizeWhitespace(progress.manualAction.searchKey),
      workerTabId: typeof progress.manualAction.workerTabId === "number" ? progress.manualAction.workerTabId : null,
      summary: normalizeWhitespace(progress.manualAction.summary),
      detail: normalizeWhitespace(progress.manualAction.detail),
      reason: normalizeWhitespace(progress.manualAction.reason),
      status: normalizeWhitespace(progress.manualAction.status || "awaiting_user_action"),
      progressPercent: Math.max(0, Math.min(100, Number(progress.manualAction.progressPercent || progress?.progressPercent || 0))),
      removableFilters: Array.isArray(progress.manualAction.removableFilters)
        ? progress.manualAction.removableFilters.map((filter) => ({
          type: normalizeWhitespace(filter?.type).toLowerCase(),
          label: normalizeWhitespace(filter?.label || filter?.sourceText || filter?.value),
          sourceText: normalizeWhitespace(filter?.sourceText || filter?.value || filter?.label),
          param: normalizeWhitespace(filter?.param || JOB_OUTREACH_FILTER_PARAMS[normalizeWhitespace(filter?.type).toLowerCase()])
        })).filter((filter) => filter.type && filter.sourceText)
        : []
    }
    : null;
  try {
    await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.JOB_OUTREACH_PROGRESS,
      requestId: normalizedRequestId,
      sourceTabId: typeof sourceTabId === "number" ? sourceTabId : null,
      text: normalizeWhitespace(progress?.text),
      detail: normalizeWhitespace(progress?.detail),
      progressPercent: Math.max(0, Math.min(100, Number(progress?.progressPercent || 0))),
      status: normalizeWhitespace(progress?.status),
      searchKey: normalizeWhitespace(progress?.searchKey),
      workerTabId: typeof progress?.workerTabId === "number" ? progress.workerTabId : null,
      provider: normalizeWhitespace(progress?.provider),
      outputChars: Number(progress?.outputChars || 0),
      manualAction
    });
  } catch (_error) {
    // The side panel may have closed while the job was running.
  }
}

function describePeopleSearchCriteria(criteria) {
  const parts = [];
  const company = normalizeWhitespace(criteria?.currentCompany);
  if (company) {
    parts.push(`company "${company}"`);
  }
  (Array.isArray(criteria?.locations) ? criteria.locations : []).map(normalizeWhitespace).filter(Boolean).forEach((location) => {
    parts.push(`location "${location}"`);
  });
  (Array.isArray(criteria?.schools) ? criteria.schools : []).map(normalizeWhitespace).filter(Boolean).forEach((school) => {
    parts.push(`school "${school}"`);
  });
  return parts;
}

function describeAppliedFilterErrors(appliedFilterResult) {
  const filters = Array.isArray(appliedFilterResult?.unresolvedFilters) && appliedFilterResult.unresolvedFilters.length
    ? appliedFilterResult.unresolvedFilters
    : Array.isArray(appliedFilterResult?.errors) ? appliedFilterResult.errors : [];
  return filters
    .map((entry) => {
      const type = normalizeWhitespace(entry?.type || "filter");
      const value = normalizeWhitespace(entry?.value || entry?.sourceText || entry?.label || entry?.selectedText);
      return value ? `${type} "${value}"` : "";
    })
    .filter(Boolean);
}

function peopleSearchFilterActionSummary(searchKey) {
  return `Search ${normalizeWhitespace(searchKey) || "A"} needs LinkedIn confirmation.`;
}

function peopleSearchFilterActionDetail(criteria, appliedFilterResult) {
  const filters = describeAppliedFilterErrors(appliedFilterResult);
  const fallbackFilters = appliedFilterResult ? [] : describePeopleSearchCriteria(criteria);
  const targets = filters.length ? filters : fallbackFilters;
  const targetText = targets.length ? targets.join(", ") : "the LinkedIn search filters";
  return `Open the LinkedIn search tab, confirm ${targetText}, click Show results, then return here and click Continue.`;
}

function buildPeopleSearchManualAction({ requestId, workerTabId, searchKey, criteria, appliedFilterResult, reason, progressPercent }) {
  return {
    requestId: normalizeWhitespace(requestId),
    searchKey: normalizeWhitespace(searchKey),
    workerTabId: typeof workerTabId === "number" ? workerTabId : null,
    summary: peopleSearchFilterActionSummary(searchKey),
    detail: peopleSearchFilterActionDetail(criteria, appliedFilterResult),
    reason: normalizeWhitespace(reason || appliedFilterResult?.error || "LinkedIn needs your confirmation before this search can continue."),
    removableFilters: failedFiltersFromAppliedFilters(appliedFilterResult),
    status: "awaiting_user_action",
    progressPercent: Math.max(0, Math.min(100, Number(progressPercent || 0)))
  };
}

function expectedResolvedFilterIdsByParam(search) {
  const idsByParam = {};
  (Array.isArray(search?.resolvedFilters) ? search.resolvedFilters : [])
    .map(normalizeJobOutreachFilterEntry)
    .filter(Boolean)
    .forEach((entry) => {
      idsByParam[entry.param] = uniqueStrings([...(idsByParam[entry.param] || []), entry.id]);
    });
  return idsByParam;
}

function expectedFilterCountsByParam(search) {
  const counts = Object.fromEntries(Object.entries(expectedResolvedFilterIdsByParam(search)).map(([param, ids]) => [param, ids.length]));
  (Array.isArray(search?.unresolvedFilters) ? search.unresolvedFilters : []).forEach((filter) => {
    const type = normalizeWhitespace(filter?.type).toLowerCase();
    const param = JOB_OUTREACH_FILTER_PARAMS[type];
    if (!param) {
      return;
    }
    counts[param] = Number(counts[param] || 0) + 1;
  });
  return counts;
}

function filterTypeLabelFromParam(param) {
  return {
    geoUrn: "location",
    currentCompany: "company",
    schoolFilter: "school"
  }[normalizeWhitespace(param)] || "filter";
}

function peopleSearchFilterMismatch(search, response, fallbackUrl) {
  const urlState = parseLinkedInPeopleSearchUrlState(response?.pageUrl || fallbackUrl || "");
  const expectedIds = expectedResolvedFilterIdsByParam(search);
  const expectedCounts = expectedFilterCountsByParam(search);
  const expectedKeywords = normalizeWhitespace(search?.keywords);
  if (!expectedKeywords && !Object.keys(expectedIds).length && !Object.keys(expectedCounts).length) {
    return "";
  }
  const idsByParam = urlState.idsByParam;
  const mismatches = [];
  if (expectedKeywords) {
    if (!urlState.keywords) {
      mismatches.push("keywords missing from LinkedIn URL");
    } else if (urlState.keywords !== expectedKeywords) {
      mismatches.push(`keywords expected "${expectedKeywords}" but LinkedIn URL has "${urlState.keywords}"`);
    }
  }
  Object.entries(expectedIds).forEach(([param, ids]) => {
    const actualIds = idsByParam[param] || [];
    if (ids.some((id) => !actualIds.includes(id))) {
      mismatches.push(`${filterTypeLabelFromParam(param)} ids missing from LinkedIn URL`);
    }
  });
  Object.entries(expectedCounts).forEach(([param, count]) => {
    const actualCount = (idsByParam[param] || []).length;
    if (actualCount < count) {
      mismatches.push(`${filterTypeLabelFromParam(param)} expected ${count} selection${count === 1 ? "" : "s"} but LinkedIn URL has ${actualCount}`);
    }
  });
  return uniqueStrings(mismatches).join("; ");
}

function filterTypeFromJobOutreachParam(param) {
  return {
    geoUrn: "location",
    currentCompany: "company",
    schoolFilter: "school"
  }[normalizeWhitespace(param)] || "";
}

function unresolvedFiltersForMismatch(search, response, fallbackUrl) {
  const urlState = parseLinkedInPeopleSearchUrlState(response?.pageUrl || fallbackUrl || "");
  const expectedIds = expectedResolvedFilterIdsByParam(search);
  const expectedCounts = expectedFilterCountsByParam(search);
  const idsByParam = urlState.idsByParam;
  const problemParams = new Set();
  Object.entries(expectedIds).forEach(([param, ids]) => {
    const actualIds = idsByParam[param] || [];
    if (ids.some((id) => !actualIds.includes(id))) {
      problemParams.add(param);
    }
  });
  Object.entries(expectedCounts).forEach(([param, count]) => {
    const actualCount = (idsByParam[param] || []).length;
    if (actualCount < count) {
      problemParams.add(param);
    }
  });
  const filters = [
    ...(Array.isArray(search?.unresolvedFilters) ? search.unresolvedFilters : []),
    ...(Array.isArray(search?.resolvedFilters) ? search.resolvedFilters : []),
    ...(Array.isArray(search?.filters) ? search.filters : [])
  ];
  const seen = new Set();
  return filters
    .map((filter) => {
      const type = normalizeWhitespace(filter?.type).toLowerCase();
      const param = normalizeWhitespace(filter?.param || JOB_OUTREACH_FILTER_PARAMS[type]);
      const sourceText = normalizeWhitespace(filter?.sourceText || filter?.value || filter?.label);
      const label = normalizeWhitespace(filter?.label || sourceText);
      const id = normalizeWhitespace(filter?.id);
      if (!type || !param || !sourceText || !problemParams.has(param)) {
        return null;
      }
      if (id && (idsByParam[param] || []).includes(id)) {
        return null;
      }
      const key = `${type}:${id || normalizeFilterCacheKey(type, sourceText)}`;
      if (seen.has(key)) {
        return null;
      }
      seen.add(key);
      return {
        type: type || filterTypeFromJobOutreachParam(param),
        label,
        sourceText,
        id,
        param,
        state: "failed"
      };
    })
    .filter(Boolean);
}

function buildAcceptedPeopleSearchContract({ search, plannedUrl, finalUrl, workerTabId }) {
  const planned = parseLinkedInPeopleSearchUrlState(plannedUrl);
  const final = parseLinkedInPeopleSearchUrlState(finalUrl);
  return {
    searchKey: normalizeWhitespace(search?.searchKey),
    workerTabId: typeof workerTabId === "number" ? workerTabId : null,
    keywords: normalizeWhitespace(final.keywords || planned.keywords || search?.keywords),
    plannedUrl: planned.url,
    plannedUrlSignature: planned.signature,
    finalUrl: final.url,
    finalUrlSignature: final.signature,
    expectedFilterCounts: expectedFilterCountsByParam(search)
  };
}

function attachPeopleSearchContractToPeople(people, contract) {
  const searchKey = normalizeWhitespace(contract?.searchKey);
  const sourceUrl = normalizeWhitespace(contract?.finalUrl);
  const sourceUrlSignature = normalizeWhitespace(contract?.finalUrlSignature);
  return (Array.isArray(people) ? people : []).map((person) => ({
    ...person,
    sourceSearchKey: searchKey,
    sourceSearchUrl: sourceUrl,
    sourceSearchUrlSignature: sourceUrlSignature
  }));
}

async function waitForStablePeopleSearchState(tabId, search, options = {}) {
  const attempts = Math.max(2, Number(options.attempts || 6));
  let lastResponse = null;
  let lastObservedUrl = normalizeUrl(options.fallbackUrl || options.plannedUrl || "");
  let lastMismatch = "";
  let stableSignature = "";
  let stableHits = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await delay(attempt === 1 ? 700 : 900);
    await options.onProgress?.(attempt);
    const response = await safeSendLinkedInMessage(tabId, { type: MESSAGE_TYPES.GET_PAGE_CONTEXT });
    lastResponse = response;
    const liveTab = await chrome.tabs.get(tabId).catch(() => null);
    const observedUrl = normalizeWhitespace(response?.pageUrl)
      || normalizeWhitespace(liveTab?.url)
      || lastObservedUrl
      || normalizeUrl(options.fallbackUrl || options.plannedUrl || "");
    lastObservedUrl = observedUrl;
    const mismatch = peopleSearchFilterMismatch(search, response, observedUrl);
    if (mismatch) {
      lastMismatch = mismatch;
    }
    const pageType = normalizeWhitespace(response?.pageType);
    const signature = linkedInPeopleSearchUrlSignature(observedUrl);
    const isPeopleSearchPage = pageType === "linkedin-people-search"
      && /^https:\/\/www\.linkedin\.com\/search\/results\/people\/?(?:[?#]|$)/i.test(observedUrl);
    if (!isPeopleSearchPage || mismatch || !signature) {
      stableSignature = "";
      stableHits = 0;
      continue;
    }
    if (signature === stableSignature) {
      stableHits += 1;
    } else {
      stableSignature = signature;
      stableHits = 1;
    }
    if (stableHits >= 2) {
      return {
        ok: true,
        response,
        sourceUrl: observedUrl,
        signature,
        attemptsUsed: attempt
      };
    }
  }
  return {
    ok: false,
    response: lastResponse,
    sourceUrl: lastObservedUrl,
    signature: linkedInPeopleSearchUrlSignature(lastObservedUrl),
    mismatch: lastMismatch
  };
}

async function closeTabIfPresent(tabId) {
  if (typeof tabId !== "number") {
    return;
  }
  await chrome.tabs.remove(tabId).catch(() => {});
}

async function ensureJobOutreachWorkerTab(existingTabId, desiredUrl) {
  const normalizedUrl = normalizeUrl(desiredUrl);
  if (!normalizedUrl) {
    throw new Error("A valid LinkedIn people-search URL is required.");
  }
  if (typeof existingTabId === "number") {
    try {
      const existing = await chrome.tabs.get(existingTabId);
      const updateInfo = normalizeUrl(existing.url) === normalizedUrl
        ? { active: false }
        : { url: normalizedUrl, active: false };
      const updated = await chrome.tabs.update(existing.id, updateInfo);
      try {
        await chrome.tabs.update(updated.id, { autoDiscardable: false });
      } catch (_error) {}
      await waitForTabComplete(updated.id, 16000);
      return updated;
    } catch (_error) {
      // Recreate the worker tab if the previous one no longer exists.
    }
  }
  const tab = await chrome.tabs.create({ url: normalizedUrl, active: false });
  if (!tab?.id) {
    throw new Error("Unable to open the LinkedIn search tab.");
  }
  try {
    await chrome.tabs.update(tab.id, { autoDiscardable: false });
  } catch (_error) {}
  await waitForTabComplete(tab.id, 16000);
  return tab;
}

function findJobOutreachSearchPlanUrl(searchPlan, searchKey) {
  const normalizedSearchKey = normalizeWhitespace(searchKey);
  return normalizeUrl((Array.isArray(searchPlan?.searches) ? searchPlan.searches : [])
    .find((search) => normalizeWhitespace(search.searchKey) === normalizedSearchKey)?.url);
}

function buildJobOutreachRunState({ requestId, sourceTabId, job, searches, stored, runnerOptions, searchPlan }) {
  return {
    requestId,
    sourceTabId,
    job,
    searches,
    stored,
    runnerOptions,
    searchPlan,
    importedSearches: [],
    nextSearchIndex: 0,
    workerTabId: null,
    resumeFromCurrentTab: false,
    createdAt: toIsoNow(),
    startedAt: "",
    completedAt: "",
    status: "queued",
    cancelRequested: false,
    progressText: "",
    progressDetail: "",
    progressPercent: 0,
    manualAction: null,
    rankingPlan: null,
    rankingInput: null,
    diagnostics: null,
    error: ""
  };
}

function refreshPendingJobOutreachSearches(runState) {
  const searchIndex = Number(runState?.nextSearchIndex || 0);
  const cache = filterCacheSnapshot(runState?.stored);
  runState.searches = (Array.isArray(runState?.searches) ? runState.searches : []).map((search, index) => (
    index < searchIndex ? search : hydrateSearchFilters(search, cache)
  ));
}

function jobOutreachFilterMatchesTarget(filter, target) {
  const type = normalizeWhitespace(filter?.type).toLowerCase();
  const targetType = normalizeWhitespace(target?.type).toLowerCase();
  if (!type || !targetType || type !== targetType) {
    return false;
  }
  const filterKey = normalizeFilterCacheKey(type, filter?.sourceText || filter?.value || filter?.label);
  const labelKey = normalizeFilterCacheKey(type, filter?.label || filter?.sourceText || filter?.value);
  const targetKey = normalizeFilterCacheKey(targetType, target?.sourceText || target?.value || target?.label);
  const targetLabelKey = normalizeFilterCacheKey(targetType, target?.label || target?.sourceText || target?.value);
  return Boolean(targetKey && (filterKey === targetKey || labelKey === targetKey || filterKey === targetLabelKey));
}

function removeJobOutreachFilterFromSearch(search, target) {
  const source = search && typeof search === "object" ? search : {};
  const type = normalizeWhitespace(target?.type).toLowerCase();
  const criteria = source.criteria || {};
  const withoutTarget = (filters) => (Array.isArray(filters) ? filters : [])
    .filter((filter) => !jobOutreachFilterMatchesTarget(filter, target));
  const removeCriteriaValue = (values) => (Array.isArray(values) ? values : [])
    .filter((value) => !jobOutreachFilterMatchesTarget({ type, sourceText: value, label: value }, target));
  const nextCriteria = {
    locations: type === "location" ? removeCriteriaValue(criteria.locations) : criteria.locations,
    schools: type === "school" ? removeCriteriaValue(criteria.schools) : criteria.schools,
    currentCompany: type === "company" && jobOutreachFilterMatchesTarget({ type: "company", sourceText: criteria.currentCompany }, target)
      ? ""
      : normalizeWhitespace(criteria.currentCompany)
  };
  return {
    ...source,
    filters: withoutTarget(source.filters),
    resolvedFilters: withoutTarget(source.resolvedFilters),
    unresolvedFilters: withoutTarget(source.unresolvedFilters),
    failedFilters: withoutTarget(source.failedFilters),
    criteria: nextCriteria
  };
}

function removeJobOutreachFilterFromPausedRun(runState, filter) {
  const searchIndex = Number(runState?.nextSearchIndex || 0);
  if (!runState?.searches?.[searchIndex]) {
    return null;
  }
  const target = {
    type: normalizeWhitespace(filter?.type).toLowerCase(),
    label: normalizeWhitespace(filter?.label || filter?.sourceText || filter?.value),
    sourceText: normalizeWhitespace(filter?.sourceText || filter?.value || filter?.label)
  };
  if (!target.type || !target.sourceText) {
    return null;
  }
  runState.searches[searchIndex] = hydrateSearchFilters(
    removeJobOutreachFilterFromSearch(runState.searches[searchIndex], target),
    filterCacheSnapshot(runState.stored)
  );
  runState.resumeFromCurrentTab = false;
  return target;
}

function upsertImportedJobOutreachSearch(importedSearches, nextSearch) {
  const normalizedKey = normalizeWhitespace(nextSearch?.searchKey);
  const remaining = (Array.isArray(importedSearches) ? importedSearches : []).filter((search) => normalizeWhitespace(search?.searchKey) !== normalizedKey);
  return [...remaining, nextSearch]
    .sort((left, right) => searchNumberFromKey(left.searchKey) - searchNumberFromKey(right.searchKey));
}

async function importPeopleSearchUrl(url, searchKey, expectedSearch, options, onProgress) {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl || !/^https:\/\/www\.linkedin\.com\/search\/results\/people\/?(?:[?#]|$)/i.test(normalizedUrl)) {
    throw new Error(`Search ${searchKey} did not return a valid LinkedIn people-search URL.`);
  }
  const resumeFromCurrentTab = Boolean(options?.resumeFromCurrentTab);
  let tab;
  if (resumeFromCurrentTab) {
    if (typeof options?.workerTabId !== "number") {
      throw new Error(`Search ${searchKey} cannot resume because the LinkedIn search tab is missing.`);
    }
    try {
      tab = await chrome.tabs.get(options.workerTabId);
    } catch (_error) {
      throw new Error("The LinkedIn search tab was closed. Run Search again.");
    }
    await onProgress?.(`Reading Search ${searchKey} after your LinkedIn changes.`, {
      status: "resuming_search",
      searchKey,
      workerTabId: tab.id
    });
    await waitForTabComplete(tab.id, 16000);
  } else {
    await onProgress?.("Opening your LinkedIn people search.", {
      status: "opening_search",
      searchKey,
      workerTabId: typeof options?.workerTabId === "number" ? options.workerTabId : null
    });
    tab = await ensureJobOutreachWorkerTab(options?.workerTabId, normalizedUrl);
    await onProgress?.("Waiting for LinkedIn search page to load.", {
      status: "loading_search",
      searchKey,
      workerTabId: tab.id
    });
  }

  const criteriaToResolve = expectedSearch?.unresolvedCriteria || expectedSearch?.criteria || {};
  const hasFilters = Boolean(
    normalizeWhitespace(criteriaToResolve?.currentCompany)
    || (Array.isArray(criteriaToResolve?.locations) && criteriaToResolve.locations.length)
    || (Array.isArray(criteriaToResolve?.schools) && criteriaToResolve.schools.length)
  );
  let appliedFilterResult = null;
  if (!resumeFromCurrentTab && hasFilters) {
    await onProgress?.(`Applying LinkedIn filters for Search ${searchKey}.`, {
      status: "applying_search_filters",
      searchKey,
      workerTabId: tab.id
    });
    appliedFilterResult = await sendLinkedInMessageToFrame(tab.id, 0, {
      type: MESSAGE_TYPES.APPLY_PEOPLE_SEARCH_FILTERS,
      search: {
        ...expectedSearch,
        criteria: criteriaToResolve
      }
    });
    if (!appliedFilterResult?.ok || !appliedFilterResult?.applied || appliedFilterResult?.requiresUserAction) {
      const details = Array.isArray(appliedFilterResult?.errors) && appliedFilterResult.errors.length
        ? appliedFilterResult.errors.map((entry) => entry.error || entry.value).filter(Boolean).join("; ")
        : appliedFilterResult?.error || "LinkedIn did not apply the selected filters.";
      if (appliedFilterResult?.requiresUserAction) {
        const finalUrl = normalizeWhitespace(appliedFilterResult?.finalUrl) || normalizedUrl;
        return {
          paused: true,
          workerTabId: tab.id,
          manualAction: buildPeopleSearchManualAction({
            requestId: options?.requestId,
            workerTabId: tab.id,
            searchKey,
            criteria: expectedSearch?.criteria || criteriaToResolve,
            appliedFilterResult,
            progressPercent: options?.progressPercent
          }),
          sourceUrl: finalUrl,
          resolvedFilterUpdates: cacheUpdatesFromAppliedFilters(appliedFilterResult, finalUrl, expectedSearch),
          failedFilters: failedFiltersFromAppliedFilters(appliedFilterResult)
        };
      }
      throw new Error(`Search ${searchKey} filters were not applied: ${details}`);
    }
    await delay(1800);
  }

  const stableSearchState = await waitForStablePeopleSearchState(tab.id, expectedSearch, {
    plannedUrl: normalizedUrl,
    fallbackUrl: appliedFilterResult?.finalUrl || normalizedUrl,
    onProgress: async (attempt) => onProgress?.(`Reading visible results for Search ${searchKey}.`, {
      status: "reading_search",
      searchKey,
      attempt,
      workerTabId: tab.id
    })
  });
  if (!stableSearchState.ok) {
    if (stableSearchState.mismatch) {
      const mismatchResolvedUpdates = cacheUpdatesFromSearchUrl(expectedSearch, stableSearchState.sourceUrl, stableSearchState.response);
      return {
        paused: true,
        workerTabId: tab.id,
        manualAction: buildPeopleSearchManualAction({
          requestId: options?.requestId,
          workerTabId: tab.id,
          searchKey,
          criteria: expectedSearch?.criteria || criteriaToResolve,
          appliedFilterResult: {
            unresolvedFilters: unresolvedFiltersForMismatch(expectedSearch, stableSearchState.response, stableSearchState.sourceUrl),
            error: `LinkedIn still does not show the expected search state: ${stableSearchState.mismatch}.`
          },
          reason: `LinkedIn still does not show the expected search state: ${stableSearchState.mismatch}.`,
          progressPercent: options?.progressPercent
        }),
        sourceUrl: stableSearchState.sourceUrl,
        context: stableSearchState.response,
        resolvedFilterUpdates: mismatchResolvedUpdates,
        failedFilters: unresolvedFiltersForMismatch(expectedSearch, stableSearchState.response, stableSearchState.sourceUrl)
      };
    }
    throw new Error(`Search ${searchKey} did not settle on a stable LinkedIn people-search URL.`);
  }

  const acceptedSearchContract = buildAcceptedPeopleSearchContract({
    search: expectedSearch,
    plannedUrl: normalizedUrl,
    finalUrl: stableSearchState.sourceUrl,
    workerTabId: tab.id
  });
  const stablePeople = attachPeopleSearchContractToPeople(
    stableSearchState.response?.peopleSearch?.results || [],
    acceptedSearchContract
  );
  if (stablePeople.length) {
    await onProgress?.(`Found ${stablePeople.length} visible people in Search ${searchKey}.`, {
      status: "imported_search",
      searchKey,
      count: stablePeople.length,
      workerTabId: tab.id
    });
    return {
      searchKey,
      workerTabId: tab.id,
      sourceUrl: acceptedSearchContract.finalUrl,
      sourceUrlSignature: acceptedSearchContract.finalUrlSignature,
      context: stableSearchState.response,
      people: stablePeople,
      searchContract: acceptedSearchContract,
      resolvedFilterUpdates: resumeFromCurrentTab
        ? cacheUpdatesFromSearchUrl(expectedSearch, acceptedSearchContract.finalUrl, stableSearchState.response)
        : cacheUpdatesFromAppliedFilters(appliedFilterResult, acceptedSearchContract.finalUrl, expectedSearch),
      failedFilters: resumeFromCurrentTab ? [] : failedFiltersFromAppliedFilters(appliedFilterResult)
    };
  }
  await onProgress?.(`No people were found yet for Search ${searchKey}.`, {
    status: "search_empty",
    searchKey,
    workerTabId: tab.id
  });
  return {
    searchKey,
    workerTabId: tab.id,
    sourceUrl: acceptedSearchContract.finalUrl,
    sourceUrlSignature: acceptedSearchContract.finalUrlSignature,
    context: stableSearchState.response,
    people: [],
    searchContract: acceptedSearchContract,
    resolvedFilterUpdates: resumeFromCurrentTab
      ? cacheUpdatesFromSearchUrl(expectedSearch, acceptedSearchContract.finalUrl, stableSearchState.response)
      : cacheUpdatesFromAppliedFilters(appliedFilterResult, acceptedSearchContract.finalUrl, expectedSearch),
    failedFilters: resumeFromCurrentTab ? [] : failedFiltersFromAppliedFilters(appliedFilterResult)
  };
}

async function importJobOutreachSearches(runState, progress) {
  const plannedSearches = Array.isArray(runState?.searches) ? runState.searches : [];
  const plannedCount = plannedSearches.filter((search) => findJobOutreachSearchPlanUrl(runState.searchPlan, search.searchKey)).length;
  const searchCount = Math.max(1, plannedCount);
  for (let index = Number(runState.nextSearchIndex || 0); index < plannedSearches.length; index += 1) {
    throwIfJobOutreachCancelled(runState);
    const search = runState.searches[index];
    const plannedUrl = appendResolvedFiltersToSearchUrl(
      findJobOutreachSearchPlanUrl(runState.searchPlan, search.searchKey),
      search.resolvedFilters || []
    );
    if (!plannedUrl) {
      continue;
    }
    const importBase = 36 + (index / searchCount) * 34;
    const importSpan = 34 / searchCount;
    const imported = await importPeopleSearchUrl(plannedUrl, search.searchKey, search, {
      requestId: runState.requestId,
      workerTabId: runState.workerTabId,
      resumeFromCurrentTab: Boolean(runState.resumeFromCurrentTab && index === Number(runState.nextSearchIndex || 0)),
      progressPercent: Math.min(70, importBase + importSpan * 0.5)
    }, (text, meta) => {
      const attempt = Number(meta?.attempt || 0);
      const attemptOffset = attempt ? Math.min(importSpan * 0.7, attempt * (importSpan / 6)) : 0;
      const statusOffset = meta?.status === "imported_search"
        ? importSpan
        : meta?.status === "reading_search"
          ? importSpan * 0.45 + attemptOffset
          : meta?.status === "resuming_search"
            ? importSpan * 0.18
            : meta?.status === "loading_search"
              ? importSpan * 0.25
              : importSpan * 0.1;
      return progress(`Reading Search ${search.searchKey}.`, {
        detail: text,
        progressPercent: Math.min(70, importBase + statusOffset),
        status: meta?.status || "importing_search",
        searchKey: search.searchKey,
        workerTabId: meta?.workerTabId
      });
    });
    runState.workerTabId = typeof imported?.workerTabId === "number" ? imported.workerTabId : runState.workerTabId;
    if (imported?.paused) {
      runState.nextSearchIndex = index;
      runState.resumeFromCurrentTab = true;
      runState.status = "awaiting_user_action";
      runState.manualAction = imported.manualAction || null;
      const partialResolvedUpdates = Array.isArray(imported.resolvedFilterUpdates) ? imported.resolvedFilterUpdates : [];
      if (partialResolvedUpdates.length) {
        runState.stored = await mergeJobOutreachFilterCache(runState.stored, [
          ...(Array.isArray(search.resolvedFilters) ? search.resolvedFilters : []),
          ...partialResolvedUpdates
        ]);
        refreshPendingJobOutreachSearches(runState);
      }
      pendingJobOutreachRuns.set(runState.requestId, runState);
      const manualAction = imported.manualAction;
      await progress(manualAction.summary, {
        detail: [manualAction.detail, manualAction.reason].filter(Boolean).join(" "),
        progressPercent: manualAction.progressPercent,
        status: manualAction.status,
        searchKey: manualAction.searchKey,
        workerTabId: manualAction.workerTabId,
        manualAction
      });
      return {
        ok: false,
        paused: true,
        requestId: runState.requestId,
        workerTabId: runState.workerTabId,
        manualAction,
        jobOutreachFilterCache: filterCacheSnapshot(runState.stored),
        error: `${manualAction.summary} ${manualAction.reason}`.trim()
      };
    }
    runState.resumeFromCurrentTab = false;
    runState.nextSearchIndex = index + 1;
    const importedSearch = {
      ...search,
      plannedUrl,
      searchUrl: imported.sourceUrl || plannedUrl,
      searchUrlSignature: normalizeWhitespace(imported.sourceUrlSignature),
      people: imported.people,
      importContext: imported.context || null,
      searchContract: imported.searchContract || null,
      resolvedFilterUpdates: imported.resolvedFilterUpdates || [],
      failedFilters: imported.failedFilters || []
    };
    runState.importedSearches = upsertImportedJobOutreachSearch(runState.importedSearches, importedSearch);
    runState.stored = await mergeJobOutreachFilterCache(runState.stored, [
      ...(Array.isArray(search.resolvedFilters) ? search.resolvedFilters : []),
      ...(Array.isArray(importedSearch.resolvedFilterUpdates) ? importedSearch.resolvedFilterUpdates : [])
    ]);
    refreshPendingJobOutreachSearches(runState);
    await persistJobOutreachRunState(runState, {
      status: "running",
      progressText: runState.progressText,
      progressDetail: runState.progressDetail,
      progressPercent: runState.progressPercent,
      manualAction: null
    }, { setActive: true, activeRunId: runState.requestId });
  }
  return null;
}

async function finalizeJobOutreachRun(runState, progress) {
  throwIfJobOutreachCancelled(runState);
  const sourceJobId = jobIdFromJob(runState.job);
  const importedSearches = runState.importedSearches
    .slice()
    .sort((left, right) => searchNumberFromKey(left.searchKey) - searchNumberFromKey(right.searchKey));
  // Inject people captured directly from the job page as a "PAGE" pseudo-search so they
  // rank alongside the keyword searches (A/B/C). No worker tab / search URL is involved.
  const capturedPeople = jobCapturesForJobId(runState.stored?.jobOutreach, sourceJobId);
  if (capturedPeople.length) {
    importedSearches.push({
      searchKey: "PAGE",
      searchNumber: 4,
      keywords: "From this job page",
      searchUrl: "",
      people: capturedPeople.map((person) => ({
        name: person.name,
        profileUrl: person.profileUrl,
        connectionDegree: person.connectionDegree,
        headline: person.headline,
        avatarUrl: person.avatarUrl,
        aiGeneratedInsight: person.aiGeneratedInsight || person.note || person.relationshipContext || "",
        primaryAction: ""
      }))
    });
  }
  const importedPeopleBySearch = {};
  const importedPeopleBySearchKey = {};
  for (const search of importedSearches) {
    const attributedPeople = (Array.isArray(search.people) ? search.people : []).map((person) => ({
      ...person,
      sourceJobId: normalizeWhitespace(person?.sourceJobId || sourceJobId),
      sourceSearchKey: normalizeWhitespace(person?.sourceSearchKey || search.searchKey),
      sourceSearchUrl: normalizeWhitespace(person?.sourceSearchUrl || search.searchUrl),
      sourceSearchUrlSignature: normalizeWhitespace(person?.sourceSearchUrlSignature || search.searchUrlSignature)
    }));
    importedPeopleBySearch[String(searchNumberFromKey(search.searchKey))] = attributedPeople;
    importedPeopleBySearchKey[search.searchKey] = attributedPeople;
  }
  const importedSearchByKey = new Map(importedSearches.map((search) => [search.searchKey, search]));
  const importedCount = importedSearches.reduce((total, search) => total + search.people.length, 0);
  await progress("Visible people ready.", {
    detail: `${importedCount} visible people found from ${importedSearches.length} search${importedSearches.length === 1 ? "" : "es"}.`,
    progressPercent: 72,
    status: "people_imported",
    workerTabId: runState.workerTabId
  });
  if (!importedCount) {
    const emptyResult = {
      ok: true,
      job: runState.job,
      searches: runState.searches.map((search) => ({
        index: searchNumberFromKey(search.searchKey) - 1,
        searchKey: search.searchKey,
        searchNumber: search.searchNumber,
        keywords: search.keywords,
        enabledCriteria: search.enabledCriteria,
        criteria: search.criteria,
        filters: searchFilterCandidates(search).map((filter) => ({
          type: filter.type,
          label: normalizeWhitespace(filter.label || filter.sourceText),
          sourceText: normalizeWhitespace(filter.sourceText),
          id: normalizeWhitespace(filter.id),
          param: normalizeWhitespace(filter.param || JOB_OUTREACH_FILTER_PARAMS[filter.type]),
          origin: normalizeWhitespace(filter.origin)
        })),
        resolvedFilters: [
          ...(Array.isArray(search.resolvedFilters) ? search.resolvedFilters : []),
          ...(Array.isArray(importedSearchByKey.get(search.searchKey)?.resolvedFilterUpdates)
            ? importedSearchByKey.get(search.searchKey).resolvedFilterUpdates
            : [])
        ],
        unresolvedFilters: search.unresolvedFilters || [],
        failedFilters: importedSearchByKey.get(search.searchKey)?.failedFilters || [],
        plannedUrl: importedSearchByKey.get(search.searchKey)?.plannedUrl || findJobOutreachSearchPlanUrl(runState.searchPlan, search.searchKey) || "",
        url: importedSearchByKey.get(search.searchKey)?.searchUrl || findJobOutreachSearchPlanUrl(runState.searchPlan, search.searchKey) || "",
        urlSignature: normalizeWhitespace(importedSearchByKey.get(search.searchKey)?.searchUrlSignature),
        searchContract: importedSearchByKey.get(search.searchKey)?.searchContract || null
      })),
      searchPlan: runState.searchPlan,
      rankingPlan: null,
      rankingInput: null,
      importedPeopleBySearch,
      importedPeopleBySearchKey,
      diagnostics: {
        searchPrompt: "",
        rankingPrompt: "",
        searchGeneration: {
          mode: "linkedin_ui_filters",
          provider: "none"
        },
        rankingGeneration: null,
        importedCounts: Object.fromEntries(Object.entries(importedPeopleBySearch).map(([key, people]) => [key, people.length]))
      }
    };
    const saved = await saveJobOutreachLatestRun(runState.stored, {
      ...emptyResult,
      requestId: runState.requestId,
      searchGenerationAttempt: 0,
      rankingGenerationAttempt: 0
    });
    await progress("Search finished with no visible people.", {
      detail: "LinkedIn returned no visible people across these searches. Saved the search run without ranking results.",
      progressPercent: 100,
      status: "search_empty_complete",
      workerTabId: runState.workerTabId
    });
    return {
      ...emptyResult,
      jobOutreachLatestRun: saved.savedRun || null,
      jobOutreachFilterCache: filterCacheSnapshot(saved.stored)
    };
  }

  const mapProviderProgress = (base, span, label) => (providerText, meta) => {
    const providerPercent = Math.max(0, Math.min(100, Number(meta?.progressPercent || 0)));
    const mappedPercent = Math.max(base, Math.min(base + span, base + (providerPercent / 100) * span));
    return progress(label, {
      detail: normalizeWhitespace(providerText),
      progressPercent: mappedPercent,
      status: meta?.status || "provider_running",
      provider: meta?.provider,
      outputChars: meta?.outputChars,
      workerTabId: runState.workerTabId
    });
  };
  const rankingInput = {
    job: runState.job,
    myProfile: runState.stored.myProfile,
    searches: importedSearches.map((search) => ({
      searchKey: search.searchKey,
      searchNumber: search.searchNumber,
      keywords: search.keywords,
      searchUrl: search.searchUrl,
      people: search.people
    }))
  };
  runState.rankingInput = rankingInput;
  await ensurePromptPackReady(runState.stored.promptPackSettings);
  const rankingPrompt = jobOutreachAi.buildRankingPrompt(rankingInput, runState.stored.promptPackSettings);
  await progress("AI is ranking people.", {
    detail: "Comparing visible people against the job and saved profile.",
    progressPercent: 76,
    status: "ranking_ai_started",
    workerTabId: runState.workerTabId
  });
  throwIfJobOutreachCancelled(runState);
  const rankingGeneration = await enqueueChatGptRun(() => runProviderJsonPromptWithRetry({
    prompt: rankingPrompt,
    validator: (rawOutput) => jobOutreachAi.validateRankingResponse(rawOutput, rankingInput),
    contractName: jobOutreachAi.RANKING_CONTRACT_VERSION,
    sourceTabId: runState.sourceTabId,
    runnerOptions: runState.runnerOptions,
    onProgress: mapProviderProgress(76, 20, "AI is ranking people.")
  }));
  throwIfJobOutreachCancelled(runState);
  const rankingPlan = rankingGeneration.value;
  runState.rankingPlan = rankingPlan;
  await progress("Ranking complete.", {
    detail: `${rankingPlan.people?.length || 0} ranked people returned.`,
    progressPercent: 98,
    status: "ranking_complete",
    workerTabId: runState.workerTabId
  });

  const result = {
    ok: true,
    job: runState.job,
    searches: runState.searches.map((search) => ({
      index: searchNumberFromKey(search.searchKey) - 1,
      searchKey: search.searchKey,
      searchNumber: search.searchNumber,
      keywords: search.keywords,
      enabledCriteria: search.enabledCriteria,
      criteria: search.criteria,
      filters: searchFilterCandidates(search).map((filter) => ({
        type: filter.type,
        label: normalizeWhitespace(filter.label || filter.sourceText),
        sourceText: normalizeWhitespace(filter.sourceText),
        id: normalizeWhitespace(filter.id),
        param: normalizeWhitespace(filter.param || JOB_OUTREACH_FILTER_PARAMS[filter.type]),
        origin: normalizeWhitespace(filter.origin)
      })),
      resolvedFilters: [
        ...(Array.isArray(search.resolvedFilters) ? search.resolvedFilters : []),
        ...(Array.isArray(importedSearchByKey.get(search.searchKey)?.resolvedFilterUpdates)
          ? importedSearchByKey.get(search.searchKey).resolvedFilterUpdates
          : [])
      ],
      unresolvedFilters: search.unresolvedFilters || [],
      failedFilters: importedSearchByKey.get(search.searchKey)?.failedFilters || [],
      plannedUrl: importedSearchByKey.get(search.searchKey)?.plannedUrl || findJobOutreachSearchPlanUrl(runState.searchPlan, search.searchKey) || "",
      url: importedSearchByKey.get(search.searchKey)?.searchUrl || findJobOutreachSearchPlanUrl(runState.searchPlan, search.searchKey) || "",
      urlSignature: normalizeWhitespace(importedSearchByKey.get(search.searchKey)?.searchUrlSignature),
      searchContract: importedSearchByKey.get(search.searchKey)?.searchContract || null
    })),
    searchPlan: runState.searchPlan,
    rankingPlan,
    rankingInput,
    importedPeopleBySearch,
    importedPeopleBySearchKey,
    diagnostics: {
      searchPrompt: "",
      rankingPrompt,
      searchGeneration: {
        mode: "linkedin_ui_filters",
        provider: "none"
      },
      rankingGeneration: {
        attempt: rankingGeneration.attempt,
        provider: rankingGeneration.provider,
        timings: rankingGeneration.timings || null
      },
      importedCounts: Object.fromEntries(Object.entries(importedPeopleBySearch).map(([key, people]) => [key, people.length]))
    }
  };
  runState.diagnostics = result.diagnostics;
  const saved = await saveJobOutreachLatestRun(runState.stored, {
    ...result,
    requestId: runState.requestId,
    searchGenerationAttempt: 0,
    rankingGenerationAttempt: rankingGeneration.attempt
  });
  return {
    ...result,
    jobOutreachLatestRun: saved.savedRun || null,
    jobOutreachFilterCache: filterCacheSnapshot(saved.stored)
  };
}

async function continueJobOutreachWorkflow(runState, progress) {
  let keepWorkerTabOpen = false;
  try {
    const pausedResponse = await importJobOutreachSearches(runState, progress);
    if (pausedResponse?.paused) {
      keepWorkerTabOpen = true;
      return pausedResponse;
    }
    pendingJobOutreachRuns.delete(runState.requestId);
    const result = await finalizeJobOutreachRun(runState, progress);
    runState.completedAt = toIsoNow();
    runState.status = "completed";
    runState.manualAction = null;
    await persistTerminalJobOutreachRun(runState, {
      status: "completed",
      completedAt: runState.completedAt,
      progressText: "Ranked people ready.",
      progressDetail: `${(result.rankingPlan?.people || []).length || 0} ranked people returned.`,
      progressPercent: 100,
      rankingPlan: result.rankingPlan || null,
      rankingInput: result.rankingInput || null,
      importedPeopleBySearch: result.importedPeopleBySearch || {},
      importedPeopleBySearchKey: result.importedPeopleBySearchKey || {},
      diagnostics: result.diagnostics || null,
      manualAction: null,
      error: ""
    }, { removeFromPending: true });
    // Broadcast completion so any open sidepanel can refresh from IndexedDB.
    // sendResponse(result) only works for the original port — if the sidepanel was
    // reopened while the job ran, this broadcast is the only way it learns the run finished.
    await sendJobOutreachProgress(runState.requestId, runState.sourceTabId, {
      text: "Ranked people ready.",
      detail: `${(result.rankingPlan?.people || []).length || 0} ranked people returned.`,
      progressPercent: 100,
      status: "completed"
    });
    runState.stored = await maybeStartNextQueuedJobOutreachRun(runState.stored);
    return result;
  } catch (error) {
    const cancelled = normalizeWhitespace(error?.code) === "JOB_OUTREACH_CANCELLED";
    runState.completedAt = toIsoNow();
    runState.status = cancelled ? "cancelled" : "failed";
    runState.error = error?.message || String(error);
    runState.manualAction = null;
    await persistTerminalJobOutreachRun(runState, {
      status: runState.status,
      completedAt: runState.completedAt,
      progressText: cancelled ? "Job Outreach cancelled." : "Job Outreach failed.",
      progressDetail: runState.error,
      progressPercent: Number(runState.progressPercent || 0),
      manualAction: null,
      error: runState.error
    }, { removeFromPending: true });
    await sendJobOutreachProgress(runState.requestId, runState.sourceTabId, {
      text: cancelled ? "Job Outreach cancelled." : "Job Outreach failed.",
      detail: runState.error,
      progressPercent: Number(runState.progressPercent || 0),
      status: runState.status
    });
    runState.stored = await maybeStartNextQueuedJobOutreachRun(runState.stored);
    throw error;
  } finally {
    if (!keepWorkerTabOpen) {
      await closeTabIfPresent(runState.workerTabId);
      runState.workerTabId = null;
    }
  }
}

async function runJobOutreachWorkflow(message) {
  if (!jobOutreachAi) {
    throw new Error("Job outreach AI helpers are not available.");
  }
  const requestId = normalizeWhitespace(message?.requestId) || `job_outreach_${Date.now()}`;
  const sourceTabId = typeof message.sourceTabId === "number" ? message.sourceTabId : null;
  const stored = await getStoredState();
  if (!normalizeWhitespace(stored.myProfile?.ownProfileUrl) || !normalizeWhitespace(stored.myProfile?.rawSnapshot)) {
    throw new Error("Save your sender profile first with Update Profile before running Job outreach.");
  }

  const pageContext = await getPageContext(sourceTabId);
  const job = normalizeJobOutreachJob(message.job || pageContext?.job || {});
  if (!job.title || !job.company) {
    throw new Error("Open a LinkedIn job first.");
  }
  const searches = normalizeJobOutreachSearches(message.searches)
    .map((search) => hydrateSearchFilters(search, filterCacheSnapshot(stored)));
  if (!searches.length) {
    // A run is still valid with zero keyword searches when the user has captured people
    // directly from the job page — those are injected as the "PAGE" pseudo-search at
    // finalize time and ranked on their own.
    const capturedCount = jobCapturesForJobId(stored?.jobOutreach, jobIdFromJob(job)).length;
    if (!capturedCount) {
      throw new Error("Add at least one search entry or capture people from this job page.");
    }
  }

  const promptSettings = normalizePromptSettings(stored.promptSettings || defaultPromptSettings());
  const runnerOptions = {
    provider: promptSettings.llmProvider,
    entryUrl: promptSettings.llmEntryUrl
  };
  const rawSearchPlan = jobOutreachAi.buildFallbackSearchUrlResponse({ searches });
  const searchPlan = {
    contractVersion: normalizeWhitespace(rawSearchPlan?.contractVersion || rawSearchPlan?.contract_version || jobOutreachAi.SEARCH_URL_CONTRACT_VERSION),
    searches: (Array.isArray(rawSearchPlan?.searches) ? rawSearchPlan.searches : []).map((search) => ({
      searchKey: normalizeWhitespace(search.searchKey || search.search_key),
      keywords: normalizeWhitespace(search.keywords),
      url: normalizeUrl(search.url)
    })).filter((search) => search.searchKey && search.url)
  };
  const runState = buildJobOutreachRunState({
    requestId,
    sourceTabId,
    job,
    searches,
    stored,
    runnerOptions,
    searchPlan
  });
  pendingJobOutreachRuns.set(requestId, runState);
  const currentStore = normalizeJobOutreachStore(stored?.jobOutreach);
  const activeRun = currentStore.activeRunId ? currentStore.runsById[currentStore.activeRunId] : null;
  const hasBlockingRun = Boolean(activeRun && isJobOutreachRunActiveStatus(activeRun.status));
  const progress = (text, meta) => persistAndSendJobOutreachProgress(runState, sourceTabId, {
    text,
    ...(meta || {})
  });
  if (hasBlockingRun) {
    runState.status = "queued";
    runState.progressText = "Queued...";
    runState.progressDetail = "Waiting for the current Job Outreach run to finish.";
    runState.progressPercent = 0;
    await persistJobOutreachRunState(runState, {
      status: "queued",
      progressText: runState.progressText,
      progressDetail: runState.progressDetail,
      progressPercent: 0,
      manualAction: null
    }, { enqueue: true, activeRunId: currentStore.activeRunId });
    await sendJobOutreachProgress(requestId, sourceTabId, {
      text: "Queued...",
      detail: "Waiting for the current Job Outreach run to finish.",
      progressPercent: 0,
      status: "queued"
    });
    const nextStore = normalizeJobOutreachStore(runState.stored?.jobOutreach);
    return {
      ...buildJobOutreachQueuedResponse(runState, nextStore.queue.indexOf(requestId) + 1),
      jobOutreachRuns: jobOutreachRunsForPage({ job }, runState.stored)
    };
  }
  runState.status = "running";
  runState.startedAt = toIsoNow();
  await persistJobOutreachRunState(runState, {
    status: "running",
    startedAt: runState.startedAt,
    progressText: "Checking saved profile and LinkedIn job.",
    progressDetail: "Confirming required context before running outreach.",
    progressPercent: 4,
    manualAction: null
  }, { setActive: true, activeRunId: requestId });
  await progress("Checking saved profile and LinkedIn job.", {
    detail: "Confirming required context before running outreach.",
    progressPercent: 4,
    status: "checking_context"
  });
  await progress("Preparing search criteria.", {
    detail: `${searches.length} active search${searches.length === 1 ? "" : "es"}: ${searches.map((search) => search.searchKey).join(", ")}.`,
    progressPercent: 8,
    status: "preparing_searches"
  });
  await progress("Preparing LinkedIn search.", {
    detail: "Opening keyword search in one background tab, then applying LinkedIn filters one search at a time.",
    progressPercent: 10,
    status: "preparing_linkedin_search"
  });
  await progress("Search ready.", {
    detail: `${searchPlan.searches.length} LinkedIn keyword search${searchPlan.searches.length === 1 ? "" : "es"} ready for filter application.`,
    progressPercent: 35,
    status: "search_links_ready"
  });
  return continueJobOutreachWorkflow(runState, progress);
}

async function resumeJobOutreachWorkflow(message) {
  const requestId = normalizeWhitespace(message?.requestId);
  const runState = pendingJobOutreachRuns.get(requestId);
  if (!requestId || !runState) {
    throw new Error("No paused LinkedIn search is waiting to continue.");
  }
  const sourceTabId = typeof message.sourceTabId === "number" ? message.sourceTabId : runState.sourceTabId;
  runState.sourceTabId = sourceTabId;
  runState.status = "resuming";
  runState.manualAction = null;
  const removedFilter = removeJobOutreachFilterFromPausedRun(runState, message?.removeFilter);
  const progress = (text, meta) => persistAndSendJobOutreachProgress(runState, sourceTabId, {
    text,
    ...(meta || {})
  });
  await progress(`Resuming Search ${runState.searches[runState.nextSearchIndex]?.searchKey || ""}.`, {
    detail: removedFilter
      ? `Removed ${removedFilter.type} "${removedFilter.sourceText}" from this search and continuing.`
      : "Reading the LinkedIn search tab after your filter changes.",
    progressPercent: 40,
    status: "resuming_search",
    workerTabId: runState.workerTabId
  });
  return continueJobOutreachWorkflow(runState, progress);
}

async function cancelJobOutreachWorkflow(message) {
  const requestId = normalizeWhitespace(message?.requestId);
  if (!requestId) {
    throw new Error("No Job Outreach run matches that id.");
  }
  let stored = await getStoredState();
  const nextStore = await persistNormalizedJobOutreachStore(cancelJobOutreachRunInStore(stored?.jobOutreach, requestId));
  stored = {
    ...stored,
    jobOutreach: nextStore
  };
  const run = nextStore.runsById[requestId];
  const runState = pendingJobOutreachRuns.get(requestId);
  if (runState) {
    runState.stored = stored;
    runState.cancelRequested = Boolean(run?.cancelRequested);
    runState.status = run?.status || runState.status;
    runState.manualAction = null;
  }
  if (normalizeJobOutreachRunStatus(run?.status) === "cancelled") {
    if (runState) {
      pendingJobOutreachRuns.delete(requestId);
    }
    await sendJobOutreachProgress(requestId, runState?.sourceTabId || message?.sourceTabId || run?.sourceTabId || null, {
      text: "Job Outreach cancelled.",
      detail: "This run was cancelled before completion.",
      progressPercent: Number(run?.progressPercent || 0),
      status: "cancelled"
    });
    stored = await maybeStartNextQueuedJobOutreachRun(stored);
  } else {
    await sendJobOutreachProgress(requestId, runState?.sourceTabId || message?.sourceTabId || run?.sourceTabId || null, {
      text: "Stopping after the current step.",
      detail: "This run will stop at the next safe checkpoint.",
      progressPercent: Number(run?.progressPercent || 0),
      status: run?.status || "running"
    });
  }
  return {
    ok: true,
    requestId,
    cancelled: normalizeJobOutreachRunStatus(run?.status) === "cancelled",
    jobOutreachRuns: jobOutreachRunsForPage(message?.pageContext || {}, stored),
    jobOutreachFilterCache: filterCacheSnapshot(stored)
  };
}

async function dismissJobOutreachRunWorkflow(message) {
  const requestId = normalizeWhitespace(message?.requestId);
  if (!requestId) {
    throw new Error("No Job Outreach run matches that id.");
  }
  let stored = await getStoredState();
  const nextStore = await persistNormalizedJobOutreachStore(dismissJobOutreachRunInStore(stored?.jobOutreach, requestId));
  pendingJobOutreachRuns.delete(requestId);
  stored = {
    ...stored,
    jobOutreach: nextStore
  };
  return {
    ok: true,
    requestId,
    dismissed: true,
    jobOutreachRuns: jobOutreachRunsForPage(message?.pageContext || {}, stored),
    jobOutreachFilterCache: filterCacheSnapshot(stored)
  };
}

async function openJobOutreachWorkerTab(message) {
  const requestId = normalizeWhitespace(message?.requestId);
  const pendingRun = requestId ? pendingJobOutreachRuns.get(requestId) : null;
  const workerTabId = typeof pendingRun?.workerTabId === "number"
    ? pendingRun.workerTabId
    : (typeof message?.workerTabId === "number" ? message.workerTabId : null);
  if (typeof workerTabId !== "number") {
    throw new Error("No LinkedIn search tab is waiting for confirmation.");
  }
  const tab = await chrome.tabs.update(workerTabId, { active: true });
  if (Number.isInteger(tab?.windowId)) {
    await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  }
  return {
    ok: true,
    workerTabId
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
        if (!isAssistantSessionActive()) {
          sendResponse({ ok: true, ignored: true });
          return;
        }
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
        if (!isAssistantSessionActive()) {
          sendResponse({ ok: true, ignored: true });
          return;
        }
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

      if (message.type === MESSAGE_TYPES.RUN_JOB_OUTREACH) {
        const result = await runJobOutreachWorkflow(message);
        sendResponse(result);
        return;
      }

      if (message.type === MESSAGE_TYPES.RESUME_JOB_OUTREACH) {
        const result = await resumeJobOutreachWorkflow(message);
        sendResponse(result);
        return;
      }

      if (message.type === MESSAGE_TYPES.CANCEL_JOB_OUTREACH) {
        const result = await cancelJobOutreachWorkflow(message);
        sendResponse(result);
        return;
      }

      if (message.type === MESSAGE_TYPES.DISMISS_JOB_OUTREACH_RUN) {
        const result = await dismissJobOutreachRunWorkflow(message);
        sendResponse(result);
        return;
      }

      if (message.type === MESSAGE_TYPES.OPEN_JOB_OUTREACH_WORKER_TAB) {
        const result = await openJobOutreachWorkerTab(message);
        sendResponse(result);
        return;
      }

      if (message.type === MESSAGE_TYPES.CAPTURE_JOB_PAGE_PERSON) {
        const result = await captureJobPagePersonWorkflow({ ...message, sourceTabId: message.sourceTabId ?? _sender?.tab?.id });
        sendResponse(result);
        return;
      }

      if (message.type === MESSAGE_TYPES.UPDATE_JOB_PAGE_CAPTURE) {
        const result = await updateJobPageCaptureWorkflow({ ...message, sourceTabId: message.sourceTabId ?? _sender?.tab?.id });
        sendResponse(result);
        return;
      }

      if (message.type === MESSAGE_TYPES.REMOVE_JOB_PAGE_PERSON) {
        const result = await removeJobPagePersonWorkflow({ ...message, sourceTabId: message.sourceTabId ?? _sender?.tab?.id });
        sendResponse(result);
        return;
      }

      if (message.type === MESSAGE_TYPES.GET_JOB_PAGE_CAPTURES) {
        const result = await getJobPageCapturesWorkflow(message);
        sendResponse(result);
        return;
      }

      if (message.type === MESSAGE_TYPES.CAPTURE_LINKEDIN_POST_DISCUSSION) {
        const result = await captureLinkedInPostDiscussion(message.sourceTabId);
        sendResponse(result);
        return;
      }

      if (message.type === MESSAGE_TYPES.GENERATE_POST_SUGGESTIONS) {
        const requestId = normalizeWhitespace(message?.requestId) || `post_suggestions_${Date.now()}`;
        void runPostSuggestionWorkflow({
          ...message,
          requestId
        });
        sendResponse({
          ok: true,
          queued: true,
          requestId
        });
        return;
      }

      if (message.type === MESSAGE_TYPES.GET_STORAGE_STATE) {
        const storageStateTiming = {
          storage_state_total_ms: 0,
          storage_state_get_page_context_ms: 0,
          storage_state_messaging_reload_ms: 0,
          storage_state_my_profile_activity_sync_ms: 0,
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
        stored = (await timedStep(
          storageStateTiming,
          "storage_state_my_profile_activity_sync_ms",
          async () => (await syncMyProfileActivityIfNeeded(pageContext, stored)).stored
        )) || stored;
        const hasSavedSenderProfile = Boolean(
          normalizeWhitespace(stored.myProfile?.ownProfileUrl)
          && normalizeWhitespace(stored.myProfile?.rawSnapshot)
        );
        const jobOutreachLatestRun = latestJobOutreachRunForPage(pageContext, stored);
        const jobOutreachRuns = jobOutreachRunsForPage(pageContext, stored);
        // Computed once and reused across all three sendResponse paths below
        const cachedGenerationJobs = generationJobsSnapshot();
        const cachedFilterCache = filterCacheSnapshot(stored);
        const cachedAllPeople = Object.values(stored.people || {});
        const suppressPersonWorkflow = isPendingProfilePageContext(pageContext, stored);
        if (!hasSavedSenderProfile) {
          sendResponse({
            ok: true,
            myProfile: stored.myProfile,
            fixedTail: stored.fixedTail,
            promptSettings: stored.promptSettings,
            promptPackSettings: stored.promptPackSettings,
            chatGptProjectUrl: stored.chatGptProjectUrl,
            allPeople: cachedAllPeople,
            generationJobs: cachedGenerationJobs,
            pageContext,
            jobOutreachLatestRun,
            jobOutreachRuns,
            jobOutreachFilterCache: cachedFilterCache,
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
            promptPackSettings: stored.promptPackSettings,
            chatGptProjectUrl: stored.chatGptProjectUrl,
            allPeople: cachedAllPeople,
            generationJobs: cachedGenerationJobs,
            pageContext,
            jobOutreachLatestRun,
            jobOutreachRuns,
            jobOutreachFilterCache: cachedFilterCache,
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
        const pendingProfileHandoff = getPendingProfileIdentityHandoffForPage(pageContext, stored);
        const resolutionDiagnostics = {
          sourceTabId: typeof message.sourceTabId === "number" ? message.sourceTabId : null,
          activeTabId: pageContext?.tabId ?? null,
          providerTabId: null,
          pageType: normalizeWhitespace(pageContext?.pageType),
          pageUrl: normalizeWhitespace(pageContext?.pageUrl),
          recentClickTabId: lastLinkedInClickTrace?.tabId ?? null,
          recentClickPageHrefBefore: normalizeWhitespace(lastLinkedInClickTrace?.pageHrefBefore),
          recentClickHref: normalizeWhitespace(lastLinkedInClickTrace?.clickHref),
          previewPersonId: normalizeWhitespace(pageContext?.person?.personId),
          previewProfileUrl: normalizeWhitespace(pageContext?.person?.profileUrl || pageContext?.profile?.profileUrl),
          previewThreadUrl: normalizeWhitespace(pageContext?.conversation?.threadUrl || pageContext?.person?.messagingThreadUrl),
          threadBoundPersonId: normalizeWhitespace(
            stored?.threadPersonBindings?.[
              normalizeUrl(pageContext?.conversation?.threadUrl || pageContext?.person?.messagingThreadUrl)
            ]
          ),
          tabBoundPersonId: normalizeWhitespace(stored?.tabPersonBindings?.[String(pageContext?.tabId ?? "")]),
          pendingProfileHandoffPersonId: normalizeWhitespace(pendingProfileHandoff?.record?.personId || pendingProfileHandoff?.handoff?.personId),
          pendingProfileHandoffTargetHref: normalizeWhitespace(pendingProfileHandoff?.handoff?.targetHref),
          pendingProfileHandoffResolvedAt: normalizeWhitespace(pendingProfileHandoff?.handoff?.resolvedAt),
          matchType: normalizeWhitespace(identityResolution?.matchType),
          matchedPersonId: normalizeWhitespace(identityResolution?.matchedRecord?.personId),
          matchedFullName: normalizeWhitespace(identityResolution?.matchedRecord?.fullName),
          currentPersonId: normalizeWhitespace(currentPerson?.personId),
          currentPersonFullName: normalizeWhitespace(currentPerson?.fullName),
          currentThreadUrl: normalizeWhitespace(currentPerson?.messagingThreadUrl),
          draftGeneratedAt: normalizeWhitespace(getDraftWorkspace(currentPerson)?.generatedAt)
        };
        resolutionDiagnostics.boundRecordIdentity = describeIdentityConsistency(
          identityResolution?.matchedRecord
          || stored?.people?.[resolutionDiagnostics.threadBoundPersonId]
          || stored?.people?.[resolutionDiagnostics.tabBoundPersonId]
        );
        resolutionDiagnostics.currentPersonIdentity = describeIdentityConsistency(currentPerson);
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
          promptPackSettings: stored.promptPackSettings,
          chatGptProjectUrl: stored.chatGptProjectUrl,
          allPeople: cachedAllPeople,
          generationJobs: cachedGenerationJobs,
          pageContext,
          jobOutreachLatestRun,
          jobOutreachRuns,
          jobOutreachFilterCache: cachedFilterCache,
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
        if (!isForcedFullProfileExtractionResponse(response)) {
          sendResponse({
            ok: false,
            error: "LinkedIn did not finish loading your full profile yet. Scroll the profile once, then try Refresh my profile again.",
            extractedProfile: response?.profile || null,
            extractedProfileDebug: {
              ...(response?.debug || {}),
              update_my_profile_frame_id: Number.isInteger(response?._frameId) ? response._frameId : 0,
              update_my_profile_full_profile_rejected: true,
              update_my_profile_has_section_data: hasFullProfileSectionData(response?.profile),
              update_my_profile_scroll_passes_run: Number(response?.debug?.profile_scroll_passes_run || 0),
              update_my_profile_scroll_steps_run: Number(response?.debug?.profile_scroll_steps_run || 0)
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
        const profile = normalizeMyProfileForStorage({
          ownProfileUrl: normalizeLinkedInProfileUrl(activeTab.url)
            || normalizeLinkedInProfileUrl(extractedProfile?.profileUrl || ""),
          profileData: extractedProfile,
          manualNotes: stored.myProfile?.manualNotes || "",
          fullName: extractedProfile?.fullName,
          firstName: extractedProfile?.firstName,
          headline: extractedProfile?.headline,
          location: extractedProfile?.location,
          profileSummary: "",
          about: extractedProfile?.about,
          experienceHighlights: extractedProfile?.experienceHighlights,
          educationHighlights: extractedProfile?.educationHighlights,
          activitySnippets: extractedProfile?.activitySnippets,
          languageSnippets: extractedProfile?.languageSnippets,
          visibleSignals: extractedProfile?.visibleSignals,
          profileFacts: extractedProfile?.profileFacts,
          profileCaptureMode: "full",
          rawSnapshot: response.draft?.rawSnapshot || extractedProfile?.rawSnapshot || fallbackRawSnapshot,
          updatedAt: toIsoNow(),
          latestActivitySnippets: Array.isArray(extractedProfile?.activitySnippets) ? extractedProfile.activitySnippets : (stored.myProfile?.latestActivitySnippets || []),
          lastActivitySyncedAt: Array.isArray(extractedProfile?.activitySnippets) && extractedProfile.activitySnippets.length
            ? toIsoNow()
            : normalizeWhitespace(stored.myProfile?.lastActivitySyncedAt)
        }, stored.myProfile);
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

      if (message.type === MESSAGE_TYPES.LINK_PROFILE_URL_TO_PERSON) {
        const stored = await getStoredState();
        const explicitPersonId = normalizeWhitespace(message.personId);
        const profileUrl = normalizeLinkedInProfileUrl(message.profileUrl);
        const sourceTabId = Number.isInteger(message.sourceTabId) ? message.sourceTabId : null;
        const hintedPersonRecord = message.personRecord ? normalizePersonRecord(message.personRecord) : null;
        let targetPerson = resolveLinkProfileTargetPerson(explicitPersonId, hintedPersonRecord, stored);
        if (!targetPerson?.personId) {
          throw new Error("Could not find the saved person record to link this profile URL.");
        }
        if (!profileUrl) {
          throw new Error("No LinkedIn profile URL was provided to link.");
        }
        let nextStored = stored;
        if (!stored?.people?.[targetPerson.personId]) {
          const seedResult = await upsertPersonRecord(targetPerson, stored);
          targetPerson = seedResult.merged;
          nextStored = {
            ...stored,
            people: seedResult.people,
            tabPersonBindings: seedResult.tabPersonBindings,
            threadPersonBindings: seedResult.threadPersonBindings
          };
        }
        const linkedPerson = linkProfileUrlToPersonRecord(targetPerson, profileUrl);
        const result = await upsertPersonRecord(linkedPerson, nextStored);
        nextStored = {
          ...nextStored,
          people: result.people,
          tabPersonBindings: result.tabPersonBindings,
          threadPersonBindings: result.threadPersonBindings
        };
        if (sourceTabId !== null) {
          const tabBindingResult = await ensureCurrentTabPersonBinding({ tabId: sourceTabId }, result.merged, nextStored);
          nextStored = tabBindingResult.stored;
          setPendingProfileIdentityHandoff(sourceTabId, result.merged, profileUrl);
        }
        sendResponse({
          ok: true,
          personRecord: nextStored.people?.[result.merged.personId] || result.merged
        });
        return;
      }

      if (message.type === MESSAGE_TYPES.OPEN_PERSON_MESSAGES) {
        const sourceTab = await getTabForRequest(message.sourceTabId);
        const profileUrl = normalizeLinkedInProfileUrl(message.profileUrl || "");
        const explicitPersonId = normalizeWhitespace(message.personId);
        const openMessagesStartedAt = Date.now();
        if (!sourceTab?.id) {
          throw new Error("Could not find the active LinkedIn tab.");
        }
        if (!profileUrl) {
          throw new Error("No LinkedIn profile URL is saved for this person yet.");
        }
        const targetTab = await chrome.tabs.create(buildOpenPersonMessagesTabCreateProperties(sourceTab, profileUrl));
        rememberLinkedInTab(targetTab.id, targetTab.url);
        await waitForTabComplete(targetTab.id, 12000);
        await delay(700);
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
          const resolvedPerson = await resolveExplicitOrCurrentPerson(workspaceContext, stored, explicitPersonId);
          let currentPerson = resolvedPerson.person;
          stored = resolvedPerson.stored;
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
            stored = persistenceResult.stored || stored;
            const tabBindingResult = await ensureCurrentTabPersonBinding(workspaceContext, personRecord, stored);
            stored = tabBindingResult.stored || stored;
          }
        }
        sendResponse({
          ok: true,
          profileUrl,
          navigatedToProfile: true,
          openedInNewTab: true,
          sourceTabId: sourceTab.id,
          openedTabId: targetTab.id,
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
        let stored = await getStoredState();
        const profile = normalizeMyProfileForStorage({
          ownProfileUrl: normalizeLinkedInProfileUrl(message.profile?.ownProfileUrl || ""),
          pendingProfileUrl: "",
          manualNotes: message.profile?.manualNotes || "",
          fullName: message.profile?.fullName,
          firstName: message.profile?.firstName,
          headline: message.profile?.headline,
          location: message.profile?.location,
          profileSummary: "",
          about: message.profile?.about,
          profileData: message.profile?.profileData || null,
          experienceHighlights: message.profile?.experienceHighlights,
          educationHighlights: message.profile?.educationHighlights,
          activitySnippets: message.profile?.activitySnippets,
          languageSnippets: message.profile?.languageSnippets,
          visibleSignals: message.profile?.visibleSignals,
          profileFacts: message.profile?.profileFacts,
          rawSnapshot: message.profile?.rawSnapshot || "",
          updatedAt: toIsoNow(),
          latestActivitySnippets: Array.isArray(message.profile?.latestActivitySnippets) ? message.profile.latestActivitySnippets : [],
          lastActivitySyncedAt: normalizeWhitespace(message.profile?.lastActivitySyncedAt)
        }, stored.myProfile);
        profile.latestActivitySnippets = profile.latestActivitySnippets.length
          ? profile.latestActivitySnippets
          : (Array.isArray(stored.myProfile?.latestActivitySnippets) ? stored.myProfile.latestActivitySnippets : []);
        profile.lastActivitySyncedAt = profile.lastActivitySyncedAt || normalizeWhitespace(stored.myProfile?.lastActivitySyncedAt);
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

      if (message.type === MESSAGE_TYPES.SAVE_PROMPT_PACK_SETTINGS) {
        const promptPackSettings = normalizePromptPackSettings(message.promptPackSettings || {});
        await ensurePromptPackReady(promptPackSettings);
        await chrome.storage.local.set({
          [STORAGE_KEYS.promptPackSettings]: promptPackSettings
        });
        sendResponse({ ok: true, promptPackSettings });
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
        const resolvedPerson = await resolveExplicitOrCurrentPerson(pageContext, stored, message.personId);
        stored = resolvedPerson.stored;
        const targetPerson = resolvedPerson.person;
        if (!targetPerson?.personId) {
          throw new Error("No active person is available to save a note for.");
        }
        const personRecord = mergePersonRecord(targetPerson, {
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
        const resolvedPerson = await resolveExplicitOrCurrentPerson(pageContext, stored, message.personId);
        stored = resolvedPerson.stored;
        const targetPerson = resolvedPerson.person;
        if (!targetPerson?.personId) {
          throw new Error("No active person is available to save a goal for.");
        }
        const personRecord = mergePersonRecord(targetPerson, {
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
        const resolvedPerson = await resolveExplicitOrCurrentPerson(pageContext, stored, message.personId);
        stored = resolvedPerson.stored;
        const targetPerson = resolvedPerson.person;
        if (!targetPerson?.personId) {
          throw new Error("No active person is available to link a thread to.");
        }

        const threadUrl = validateChatGptThreadUrl(message.chatGptThreadUrl || "");
        const personRecord = mergePersonRecord(targetPerson, {
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
            normalizeFixedTail(message.fixedTail ?? stored.fixedTail),
            normalizeWhitespace(message.flowType),
            {
              fullName: normalizeWhitespace(message.recipientFullName)
            },
            {
              draftCharacterLimit: normalizeDraftCharacterLimit(message.draftCharacterLimit)
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
