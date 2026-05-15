(function initLinkedInContent() {
  const shared = globalThis.LinkedInAssistantShared;
  const linkedInCommands = globalThis.LinkedInAssistantLinkedInCommands;
  const profileExtraction = globalThis.LinkedInAssistantProfileExtraction;
  const { MESSAGE_TYPES, cleanLinkedInCompanyDisplayName, firstNameFromFullName, normalizeLinkedInProfileUrl, normalizeWhitespace, truncate, uniqueStrings } = shared;
  const PROFILE_SECTION_PATTERNS = [
    /^about$/i,
    /^experience$/i,
    /^education$/i,
    /^(activity|featured|posts?)$/i,
    /^skills$/i,
    /^languages?$/i,
    /^licenses? \& certifications$/i,
    /^licenses? and certifications$/i,
    /^projects$/i,
    /^recommendations?$/i,
    /^volunteer experience$/i,
    /^honors? \& awards$/i,
    /^honors? and awards$/i,
    /^courses$/i,
    /^publications$/i,
    /^patents$/i,
    /^organizations$/i,
    /^causes$/i
  ];
  const PROFILE_EXTRACTION_SECTION_TARGETS = [
    { key: "about", pattern: /^about$/i },
    { key: "experience", pattern: /^experience$/i },
    { key: "education", pattern: /^education$/i },
    { key: "activity", pattern: /^(activity|featured|posts?)$/i },
    { key: "languages", pattern: /^languages?$/i },
    { key: "skills", pattern: /^skills$/i }
  ];
  const US_STATE_ABBREVIATIONS = {
    AL: "Alabama",
    AK: "Alaska",
    AZ: "Arizona",
    AR: "Arkansas",
    CA: "California",
    CO: "Colorado",
    CT: "Connecticut",
    DE: "Delaware",
    FL: "Florida",
    GA: "Georgia",
    HI: "Hawaii",
    ID: "Idaho",
    IL: "Illinois",
    IN: "Indiana",
    IA: "Iowa",
    KS: "Kansas",
    KY: "Kentucky",
    LA: "Louisiana",
    ME: "Maine",
    MD: "Maryland",
    MA: "Massachusetts",
    MI: "Michigan",
    MN: "Minnesota",
    MS: "Mississippi",
    MO: "Missouri",
    MT: "Montana",
    NE: "Nebraska",
    NV: "Nevada",
    NH: "New Hampshire",
    NJ: "New Jersey",
    NM: "New Mexico",
    NY: "New York",
    NC: "North Carolina",
    ND: "North Dakota",
    OH: "Ohio",
    OK: "Oklahoma",
    OR: "Oregon",
    PA: "Pennsylvania",
    RI: "Rhode Island",
    SC: "South Carolina",
    SD: "South Dakota",
    TN: "Tennessee",
    TX: "Texas",
    UT: "Utah",
    VT: "Vermont",
    VA: "Virginia",
    WA: "Washington",
    WV: "West Virginia",
    WI: "Wisconsin",
    WY: "Wyoming"
  };
  const PEOPLE_SEARCH_FILTER_PARAMS = {
    company: "currentCompany",
    location: "geoUrn",
    school: "schoolFilter"
  };

  function isVisible(element) {
    if (!(element instanceof Element)) {
      return false;
    }
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function allowHiddenMessagingDomRead() {
    return /\/preload\/?$/i.test(normalizeWhitespace(window.location.pathname || ""))
      || Boolean(document.querySelector("[data-view-name='message-overlay-conversation-bubble-item'], [data-msg-overlay-conversation-bubble-open], .msg-overlay-conversation-bubble, .msg-s-message-list-content"));
  }

  function queryVisible(selector) {
    return Array.from(document.querySelectorAll(selector)).find(isVisible) || null;
  }

  function visibleElements(selector, root) {
    return Array.from((root || document).querySelectorAll(selector)).filter(isVisible);
  }

  function queryVisibleWithin(root, selector) {
    if (allowHiddenMessagingDomRead()) {
      return queryFirstWithin(root, selector);
    }
    return Array.from((root || document).querySelectorAll(selector)).find(isVisible) || null;
  }

  function queryFirstWithin(root, selector) {
    const scope = root || document;
    if (!scope || typeof scope.querySelector !== "function") {
      return null;
    }
    return scope.querySelector(selector);
  }

  function queryFirst(selectors, root) {
    for (const selector of selectors) {
      const match = queryFirstWithin(root || document, selector);
      if (match) {
        return match;
      }
    }
    return null;
  }

  function visibleText(element) {
    if (!element) {
      return "";
    }
    if (!isVisible(element) && !allowHiddenMessagingDomRead()) {
      return "";
    }
    return normalizeWhitespace(element.innerText || element.textContent || "");
  }

  function visibleMultilineText(element) {
    if (!element) {
      return "";
    }
    if (!isVisible(element) && !allowHiddenMessagingDomRead()) {
      return "";
    }
    return String(element.innerText || element.textContent || "")
      .replace(/\r/g, "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function visibleTextLines(element) {
    const text = visibleMultilineText(element);
    if (!text) {
      return [];
    }
    return uniqueStrings(
      text
        .split("\n")
        .map((line) => normalizeWhitespace(line))
        .filter(Boolean)
    );
  }

  function ensurePageActivityOverlay() {
    let overlay = document.getElementById("linkedin-assistant-page-activity-overlay");
    if (overlay) {
      return overlay;
    }

    overlay = document.createElement("div");
    overlay.id = "linkedin-assistant-page-activity-overlay";
    overlay.setAttribute("aria-live", "polite");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.zIndex = "2147483647";
    overlay.style.display = "none";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.background = "rgba(245, 240, 232, 0.78)";
    overlay.style.backdropFilter = "blur(4px)";

    const card = document.createElement("div");
    card.style.maxWidth = "440px";
    card.style.margin = "24px";
    card.style.padding = "24px 26px";
    card.style.borderRadius = "20px";
    card.style.background = "#fffaf2";
    card.style.border = "1px solid rgba(21, 43, 77, 0.16)";
    card.style.boxShadow = "0 18px 50px rgba(21, 43, 77, 0.18)";
    card.style.fontFamily = "\"Aptos\", \"Segoe UI\", sans-serif";
    card.style.color = "#152b4d";

    const title = document.createElement("div");
    title.id = "linkedin-assistant-page-activity-overlay-title";
    title.style.fontSize = "28px";
    title.style.lineHeight = "1.1";
    title.style.fontWeight = "700";
    title.style.marginBottom = "10px";

    const message = document.createElement("div");
    message.id = "linkedin-assistant-page-activity-overlay-message";
    message.style.fontSize = "18px";
    message.style.lineHeight = "1.45";
    message.style.color = "rgba(21, 43, 77, 0.78)";

    card.appendChild(title);
    card.appendChild(message);
    overlay.appendChild(card);
    document.documentElement.appendChild(overlay);
    return overlay;
  }

  let pageActivityOverlayHideTimer = null;

  function showPageActivityOverlay(titleText, messageText, autoHideMs) {
    const overlay = ensurePageActivityOverlay();
    const title = overlay.querySelector("#linkedin-assistant-page-activity-overlay-title");
    const message = overlay.querySelector("#linkedin-assistant-page-activity-overlay-message");
    window.clearTimeout(pageActivityOverlayHideTimer);
    if (title) {
      title.textContent = normalizeWhitespace(titleText) || "Getting LinkedIn data";
    }
    if (message) {
      message.textContent = normalizeWhitespace(messageText) || "The app is syncing this page.";
    }
    overlay.style.display = "flex";
    if (Number(autoHideMs) > 0) {
      pageActivityOverlayHideTimer = window.setTimeout(() => {
        hidePageActivityOverlay();
      }, Number(autoHideMs));
    }
  }

  function hidePageActivityOverlay() {
    const overlay = document.getElementById("linkedin-assistant-page-activity-overlay");
    window.clearTimeout(pageActivityOverlayHideTimer);
    if (overlay) {
      overlay.style.display = "none";
    }
  }

  function classifyConnectionStatus(text) {
    const normalized = normalizeWhitespace(text).toLowerCase();
    if (!normalized) {
      return "unknown";
    }
    if (/\bpending\b/.test(normalized)) {
      return "pending";
    }
    if (/\b1st degree connection\b|\b1st\b|\bremove connection\b/.test(normalized)) {
      return "connected";
    }
    if (/\bconnect\b|\b2nd degree connection\b|\b3rd degree connection\b/.test(normalized)) {
      return "not_connected";
    }
    return "unknown";
  }

  function extractConnectionActionTexts(root) {
    const actionRoot = queryAny([
      ".pv-top-card-v2-ctas",
      ".pvs-profile-actions",
      ".pv-s-profile-actions",
      ".msg-thread__thread-top-card",
      ".msg-thread__thread-header",
      "main"
    ], root || document) || root || document;

    return uniqueStrings(
      Array.from(actionRoot.querySelectorAll("button, a, span"))
        .filter(isVisible)
        .map((node) => normalizeWhitespace(
          [
            node.innerText || node.textContent || "",
            node.getAttribute?.("aria-label") || ""
          ].join(" ")
        ))
        .filter(Boolean)
    );
  }

  function extractConnectionContextTexts(root) {
    const scope = root || document;
    const candidates = uniqueStrings(
      visibleTextLines(scope).filter((line) => /\b(?:1st|2nd|3rd)(?:\s+degree connection)?\b|\bpending\b|\binvitation sent\b|\bwithdraw invitation\b/i.test(line))
    );
    return candidates.slice(0, 8);
  }

  function classifyConnectionStatusFromActions(actionTexts, fallbackText) {
    const texts = Array.isArray(actionTexts) ? actionTexts.map((value) => normalizeWhitespace(value).toLowerCase()).filter(Boolean) : [];
    const combined = normalizeWhitespace([fallbackText, ...texts].join(" | ")).toLowerCase();

    if (!combined) {
      return "unknown";
    }
    if (texts.some((text) => /\b(pending|invitation sent|withdraw invitation)\b/.test(text)) || /\bpending\b/.test(combined)) {
      return "pending";
    }
    if (
      texts.some((text) => /\b(remove connection|1st degree connection|1st)\b/.test(text))
      || /\b1st(?:\s+degree connection)?\b/.test(combined)
    ) {
      return "connected";
    }
    if (
      texts.some((text) => /\b(connect|follow)\b/.test(text))
      || /\b2nd degree connection\b|\b3rd degree connection\b/.test(combined)
    ) {
      return "not_connected";
    }
    return classifyConnectionStatus(combined);
  }

  function detectConnectionStatus(root) {
    const actionTexts = extractConnectionActionTexts(root);
    const contextTexts = extractConnectionContextTexts(root);
    const actionText = normalizeWhitespace([...actionTexts, ...contextTexts].join(" | "));
    return classifyConnectionStatusFromActions(actionTexts, actionText);
  }

  function isSupportedProfilePage() {
    return window.location.hostname.includes("linkedin.com") && /^\/in\/[^/]+(?:\/.*)?$/i.test(window.location.pathname);
  }

  function hasMessagingShell() {
    const main = document.querySelector("main") || document.body || document;
    return Boolean(queryAny([
      "main .msg-conversations-container",
      "main .msg-convo-wrapper",
      "main .msg-thread--pillar",
      "main .scaffold-layout__detail .msg-thread",
      "main .scaffold-layout__detail .msg-convo-wrapper",
      "main .msg-s-message-list-container"
    ], main)) || Boolean(queryFirst([
      ".msg-overlay-bubble",
      ".msg-overlay-bubble__content",
      ".msg-overlay-conversation-bubble__content-wrapper",
      ".msg-overlay-bubble-header",
      ".msg-overlay-conversation-bubble",
      "[data-view-name='message-overlay-conversation-bubble-item']",
      ".msg-s-message-list-container",
      ".msg-s-message-list-content"
    ], document));
  }

  function isSupportedMessagingPage() {
    return window.location.hostname.includes("linkedin.com")
      && (/^\/messaging\b/i.test(window.location.pathname) || hasMessagingShell());
  }

  function isLinkedInProfileSubpage() {
    return window.location.hostname.includes("linkedin.com") && /^\/in\/[^/]+\/.+/.test(window.location.pathname);
  }

  function isSupportedJobPage() {
    return Boolean(globalThis.LinkedInAssistantJobExtraction?.isSupportedJobPage?.());
  }

  function isSupportedPeopleSearchPage() {
    return Boolean(globalThis.LinkedInAssistantPeopleSearchExtraction?.isSupportedPeopleSearchPage?.());
  }

  function isSupportedPostPage() {
    return Boolean(globalThis.LinkedInAssistantPostExtraction?.isSupportedPostPage?.());
  }

  function extractJobPageContext() {
    return globalThis.LinkedInAssistantJobExtraction?.extractJobPageContext?.()
      || {
        supported: false,
        pageType: "linkedin-job",
        pageUrl: window.location.href,
        title: document.title,
        reason: "Job extraction is unavailable."
      };
  }

  function extractPeopleSearchContext() {
    return globalThis.LinkedInAssistantPeopleSearchExtraction?.extractPeopleSearchContext?.()
      || {
        supported: false,
        pageType: "linkedin-people-search",
        pageUrl: window.location.href,
        title: document.title,
        reason: "People search extraction is unavailable."
      };
  }

  function extractPostPageContext() {
    return globalThis.LinkedInAssistantPostExtraction?.extractPostPageContext?.()
      || {
        supported: false,
        pageType: "linkedin-post",
        pageUrl: window.location.href,
        title: document.title,
        reason: "Post extraction is unavailable."
      };
  }

  function captureVisiblePostDiscussion() {
    return globalThis.LinkedInAssistantPostExtraction?.captureVisiblePostDiscussion?.()
      || Promise.resolve({
        supported: false,
        pageType: "linkedin-post",
        pageUrl: window.location.href,
        title: document.title,
        reason: "Post extraction is unavailable."
      });
  }

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function nativeSetInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    if (setter) {
      setter.call(input, value);
    } else {
      input.value = value;
    }
  }

  function clickElement(element) {
    if (!(element instanceof Element)) {
      return false;
    }
    element.scrollIntoView?.({ block: "center", inline: "center" });
    element.focus?.();
    const pointerOptions = { bubbles: true, cancelable: true, pointerType: "mouse" };
    const mouseOptions = { bubbles: true, cancelable: true, view: window };
    try {
      element.dispatchEvent(new PointerEvent("pointerdown", pointerOptions));
    } catch (_error) {
      // Older Chromium builds can omit PointerEvent in isolated extension worlds.
    }
    element.dispatchEvent(new MouseEvent("mousedown", mouseOptions));
    try {
      element.dispatchEvent(new PointerEvent("pointerup", pointerOptions));
    } catch (_error) {
      // See pointerdown fallback above.
    }
    element.dispatchEvent(new MouseEvent("mouseup", mouseOptions));
    element.click?.();
    return true;
  }

  async function dispatchTextInput(input, value) {
    input.focus();
    nativeSetInputValue(input, "");
    input.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "deleteContentBackward",
      data: null
    }));
    const text = String(value || "");
    let nextValue = "";
    for (const char of text) {
      nextValue += char;
      nativeSetInputValue(input, nextValue);
      input.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: char
      }));
      await delay(55);
    }
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function dispatchBulkTextInput(input, value) {
    input.focus();
    nativeSetInputValue(input, "");
    input.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "deleteContentBackward",
      data: null
    }));
    await delay(80);
    const text = String(value || "");
    nativeSetInputValue(input, text);
    input.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: text
    }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function dispatchKeyboardKey(element, key) {
    if (!element) {
      return;
    }
    const code = key === "ArrowDown" || key === "Enter" ? key : "";
    element.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key,
      code
    }));
    element.dispatchEvent(new KeyboardEvent("keyup", {
      bubbles: true,
      cancelable: true,
      key,
      code
    }));
  }

  function visibleButtonByText(text, options = {}) {
    const expected = normalizeWhitespace(text).toLowerCase();
    const buttons = Array.from(document.querySelectorAll("button"))
      .filter(isVisible)
      .filter((button) => normalizeWhitespace(button.innerText || button.textContent || button.getAttribute("aria-label")).toLowerCase() === expected);
    if (options.afterText) {
      const after = normalizeWhitespace(options.afterText).toLowerCase();
      return buttons.find((button) => {
        const parentText = normalizeWhitespace(button.closest("section, fieldset, div")?.innerText || "").toLowerCase();
        return parentText.includes(after);
      }) || buttons[0] || null;
    }
    return buttons[0] || null;
  }

  function buttonByText(text) {
    const expected = normalizeWhitespace(text).toLowerCase();
    return Array.from(document.querySelectorAll("button, a, [role='button']"))
      .find((button) => normalizeWhitespace(button.innerText || button.textContent || button.getAttribute("aria-label")).toLowerCase() === expected) || null;
  }

  function visibleInteractiveByText(text) {
    const expected = normalizeWhitespace(text).toLowerCase();
    return Array.from(document.querySelectorAll("button, a, [role='button']"))
      .filter(isVisible)
      .find((button) => normalizeWhitespace(button.innerText || button.textContent || button.getAttribute("aria-label")).toLowerCase() === expected) || null;
  }

  function visibleInputByPlaceholder(placeholder) {
    const expected = normalizeWhitespace(placeholder).toLowerCase();
    return Array.from(document.querySelectorAll("input"))
      .filter((input) => normalizeWhitespace(input.getAttribute("placeholder")).toLowerCase() === expected)
      .find(isVisible) || null;
  }

  function optionText(option) {
    return normalizeWhitespace(option?.innerText || option?.textContent || "");
  }

  function optionPrimaryLine(option) {
    const lines = String(option?.innerText || option?.textContent || "")
      .split(/\n+/)
      .map(normalizeWhitespace)
      .filter(Boolean);
    return lines[0] || optionText(option);
  }

  function cleanCompanySuggestionText(text) {
    return cleanLinkedInCompanyDisplayName(text);
  }

  function selectedSuggestionText(placeholder, option) {
    if (/company/i.test(normalizeWhitespace(placeholder))) {
      return cleanCompanySuggestionText(optionPrimaryLine(option));
    }
    return optionText(option);
  }

  function optionMatches(option, expected) {
    const expectedText = normalizeWhitespace(expected).toLowerCase();
    const lines = optionText(option).split("\n").map((line) => normalizeWhitespace(line).toLowerCase()).filter(Boolean);
    return lines.some((line) => line === expectedText || line.startsWith(`${expectedText} `));
  }

  function peopleFiltersText() {
    const text = document.body?.innerText || "";
    const start = text.search(/People filters/i);
    if (start < 0) {
      return "";
    }
    const tail = text.slice(start);
    const end = tail.search(/\bShow results\b/i);
    return end >= 0 ? tail.slice(0, end) : tail;
  }

  function peopleFilterLines() {
    return peopleFiltersText()
      .split("\n")
      .map(normalizeWhitespace)
      .filter(Boolean);
  }

  function selectedFilterMatchesValue(value) {
    const lines = peopleFilterLines().map((line) => line.toLowerCase());
    const expected = normalizeWhitespace(value).toLowerCase();
    if (!lines.length || !expected) {
      return false;
    }
    if (lines.some((line) => line === expected)) {
      return true;
    }
    const commaLead = normalizeWhitespace(expected.split(",")[0]);
    if (commaLead.length >= 4 && lines.some((line) => line.startsWith(`${commaLead},`) || line === commaLead)) {
      return true;
    }
    return false;
  }

  function dedupePeopleSearchFilterUrl(url) {
    try {
      const parsed = new URL(url || window.location.href);
      ["geoUrn", "currentCompany", "schoolFilter"].forEach((param) => {
        const value = parsed.searchParams.get(param);
        if (!value) {
          return;
        }
        try {
          const ids = JSON.parse(value);
          if (Array.isArray(ids)) {
            parsed.searchParams.set(param, JSON.stringify(uniqueStrings(ids)));
          }
        } catch (_error) {
          // Keep LinkedIn-owned values that are not JSON arrays.
        }
      });
      return parsed.toString();
    } catch (_error) {
      return normalizeWhitespace(url || window.location.href);
    }
  }

  function dedupeCurrentPeopleSearchFilterUrl() {
    const deduped = dedupePeopleSearchFilterUrl(window.location.href);
    if (deduped && deduped !== window.location.href) {
      window.history.replaceState(window.history.state, document.title, deduped);
    }
    return deduped || window.location.href;
  }

  function peopleSearchFilterIdsFromUrl(url, type) {
    const param = PEOPLE_SEARCH_FILTER_PARAMS[normalizeWhitespace(type).toLowerCase()];
    if (!param) {
      return [];
    }
    try {
      const parsed = new URL(url || window.location.href);
      const raw = normalizeWhitespace(parsed.searchParams.get(param));
      if (!raw) {
        return [];
      }
      try {
        const ids = JSON.parse(raw);
        return Array.isArray(ids) ? uniqueStrings(ids.map(normalizeWhitespace).filter(Boolean)) : [];
      } catch (_error) {
        return uniqueStrings(raw.replace(/[\[\]"]/g, "").split(",").map(normalizeWhitespace).filter(Boolean));
      }
    } catch (_error) {
      return [];
    }
  }

  function firstAddedFilterId(beforeIds, afterIds) {
    const before = new Set((Array.isArray(beforeIds) ? beforeIds : []).map(normalizeWhitespace));
    return (Array.isArray(afterIds) ? afterIds : []).map(normalizeWhitespace).find((id) => id && !before.has(id)) || "";
  }

  async function waitForPeopleSearchFilterCommit(type, beforeIds, timeoutMs = 9000) {
    const startedAt = Date.now();
    let latestUrl = dedupeCurrentPeopleSearchFilterUrl();
    let latestIds = peopleSearchFilterIdsFromUrl(latestUrl, type);
    let addedId = firstAddedFilterId(beforeIds, latestIds);
    while (!addedId && Date.now() - startedAt < timeoutMs) {
      await delay(450);
      latestUrl = dedupeCurrentPeopleSearchFilterUrl();
      latestIds = peopleSearchFilterIdsFromUrl(latestUrl, type);
      addedId = firstAddedFilterId(beforeIds, latestIds);
    }
    return {
      addedId,
      finalUrl: latestUrl,
      ids: latestIds
    };
  }

  function locationCandidates(value) {
    const normalized = normalizeWhitespace(value);
    const match = normalized.match(/^(.+?),\s*([A-Z]{2})$/);
    if (!match) {
      return [normalized].filter(Boolean);
    }
    const city = normalizeWhitespace(match[1]);
    const stateName = US_STATE_ABBREVIATIONS[match[2].toUpperCase()];
    return uniqueStrings([
      stateName ? `${city}, ${stateName}, United States` : "",
      stateName ? `${city}, ${stateName}` : "",
      normalized
    ]).filter(Boolean);
  }

  async function selectPeopleSearchSuggestion(placeholder, value) {
    const input = visibleInputByPlaceholder(placeholder);
    if (!input) {
      return { ok: false, value, error: `LinkedIn did not show the ${placeholder} input.` };
    }
    clickElement(input);
    await dispatchTextInput(input, value);
    await delay(2200);
    if (selectedFilterMatchesValue(value)) {
      return { ok: true, value, selectedText: value, selectedTextSource: "existing_selection" };
    }
    const options = Array.from(document.querySelectorAll('[role="option"]')).filter(isVisible);
    const option = options.find((candidate) => optionMatches(candidate, value)) || null;
    if (!option) {
      await delay(1200);
      if (selectedFilterMatchesValue(value)) {
        return { ok: true, value, selectedText: value, selectedTextSource: "existing_selection" };
      }
      return { ok: false, value, error: `LinkedIn did not show a suggestion for ${value}.` };
    }
    const selectedText = selectedSuggestionText(placeholder, option);
    clickElement(option.querySelector('[role="button"], button') || option);
    await delay(500);
    if (!selectedFilterMatchesValue(value)) {
      await delay(900);
    }
    return { ok: true, value, selectedText, selectedTextSource: "linkedin_option" };
  }

  function isPeopleSearchFiltersPanelOpen() {
    return /People filters/i.test(document.body?.innerText || "")
      || Boolean(visibleButtonByText("Add a location"))
      || Boolean(visibleInputByPlaceholder("Add a location"));
  }

  async function openPeopleSearchFiltersPanel() {
    if (isPeopleSearchFiltersPanelOpen()) {
      return true;
    }
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const allFilters = visibleButtonByText("All filters") || buttonByText("All filters");
      if (allFilters) {
        clickElement(allFilters);
      }
      await delay(allFilters ? 450 : 300);
      if (isPeopleSearchFiltersPanelOpen()) {
        return true;
      }
    }
    return false;
  }

  async function clickPeopleSearchShowResults() {
    const showResults = visibleButtonByText("Show results")
      || buttonByText("Show results");
    if (!showResults) {
      return false;
    }
    clickElement(showResults);
    await delay(1800);
    dedupeCurrentPeopleSearchFilterUrl();
    await delay(500);
    dedupeCurrentPeopleSearchFilterUrl();
    return true;
  }

  async function addPeopleSearchFilter(buttonText, placeholder, value, sectionText, candidates = [value]) {
    const existingInput = visibleInputByPlaceholder(placeholder);
    const button = visibleButtonByText(buttonText, { afterText: sectionText }) || buttonByText(buttonText);
    if (!existingInput && !button) {
      return { ok: false, value, error: `LinkedIn did not show ${buttonText}.` };
    }
    if (button) {
      clickElement(button);
      await delay(500);
    }
    let lastResult = null;
    for (const candidate of candidates.map(normalizeWhitespace).filter(Boolean)) {
      lastResult = await selectPeopleSearchSuggestion(placeholder, candidate);
      if (lastResult.ok) {
        return {
          ...lastResult,
          value,
          attemptedValue: candidate === value ? undefined : candidate
        };
      }
    }
    return {
      ...(lastResult || {}),
      ok: false,
      value,
      error: lastResult?.error || `LinkedIn did not show a suggestion for ${value}.`
    };
  }

  async function addPeopleSearchFilterAndCommit(type, buttonText, placeholder, value, sectionText, candidates = [value]) {
    const opened = await openPeopleSearchFiltersPanel();
    if (!opened) {
      return {
        ok: false,
        value,
        error: "LinkedIn did not open the All filters panel."
      };
    }
    const beforeUrl = dedupeCurrentPeopleSearchFilterUrl();
    const beforeIds = peopleSearchFilterIdsFromUrl(beforeUrl, type);
    const result = await addPeopleSearchFilter(buttonText, placeholder, value, sectionText, candidates);
    if (!result.ok) {
      return result;
    }
    const showedResults = await clickPeopleSearchShowResults();
    if (!showedResults) {
      return {
        ...result,
        ok: false,
        error: "LinkedIn did not show the Show results button after selecting the filter."
      };
    }
    const committed = await waitForPeopleSearchFilterCommit(type, beforeIds);
    if (!committed.addedId) {
      return {
        ...result,
        ok: false,
        finalUrl: committed.finalUrl,
        error: `LinkedIn selected ${value}, but did not expose a ${type} id after Show results.`
      };
    }
    return {
      ...result,
      id: committed.addedId,
      param: PEOPLE_SEARCH_FILTER_PARAMS[type],
      finalUrl: committed.finalUrl
    };
  }

  async function reconcileSelectedPeopleSearchFilters(applied, errors) {
    if (!errors.length) {
      return errors;
    }
    await delay(1800);
    const remaining = [];
    for (const error of errors) {
      if (selectedFilterMatchesValue(error.value)) {
        applied.push({
          ...error,
          ok: true,
          selectedText: error.value,
          selectedTextSource: "existing_selection",
          reconciled: true
        });
      } else {
        remaining.push(error);
      }
    }
    return remaining;
  }

  function criteriaToFilterErrors(criteria) {
    const filters = [];
    (Array.isArray(criteria?.locations) ? criteria.locations : []).forEach((value) => {
      const text = normalizeWhitespace(value);
      if (text) {
        filters.push({ type: "location", value: text, error: "Needs LinkedIn location filter match." });
      }
    });
    const company = normalizeWhitespace(criteria?.currentCompany);
    if (company) {
      filters.push({ type: "company", value: company, error: "Needs LinkedIn company filter match." });
    }
    (Array.isArray(criteria?.schools) ? criteria.schools : []).forEach((value) => {
      const text = normalizeWhitespace(value);
      if (text) {
        filters.push({ type: "school", value: text, error: "Needs LinkedIn school filter match." });
      }
    });
    return filters;
  }

  async function applyPeopleSearchFilters(search) {
    if (!isSupportedPeopleSearchPage()) {
      return { applied: false, error: "This is not a LinkedIn people search page." };
    }
    const criteria = search?.criteria || {};
    const applied = [];
    const errors = [];
    const allFilterCriteria = {
      locations: Array.isArray(criteria.locations) ? criteria.locations : [],
      schools: Array.isArray(criteria.schools) ? criteria.schools : [],
      currentCompany: normalizeWhitespace(criteria.currentCompany)
    };
    const needsFilters = Boolean(
      allFilterCriteria.currentCompany
      || allFilterCriteria.locations.length
      || allFilterCriteria.schools.length
    );
    let lastCommittedUrl = window.location.href;
    if (needsFilters) {
      for (const location of allFilterCriteria.locations) {
        const result = await addPeopleSearchFilterAndCommit("location", "Add a location", "Add a location", location, "Locations", locationCandidates(location));
        if (result.ok) {
          lastCommittedUrl = result.finalUrl || lastCommittedUrl;
          applied.push({ type: "location", ...result });
        } else {
          errors.push({ type: "location", ...result });
        }
      }
      if (allFilterCriteria.currentCompany) {
        const result = await addPeopleSearchFilterAndCommit("company", "Add a company", "Add a company", allFilterCriteria.currentCompany, "Current companies");
        if (result.ok) {
          lastCommittedUrl = result.finalUrl || lastCommittedUrl;
          applied.push({ type: "company", ...result });
        } else {
          errors.push({ type: "company", ...result });
        }
      }
      for (const school of allFilterCriteria.schools) {
        const result = await addPeopleSearchFilterAndCommit("school", "Add a school", "Add a school", school, "Schools");
        if (result.ok) {
          lastCommittedUrl = result.finalUrl || lastCommittedUrl;
          applied.push({ type: "school", ...result });
        } else {
          errors.push({ type: "school", ...result });
        }
      }
    }
    const remainingErrors = await reconcileSelectedPeopleSearchFilters(applied, errors);
    if (remainingErrors.length) {
      return {
        applied: Boolean(applied.length),
        appliedFilters: applied,
        unresolvedFilters: remainingErrors,
        errors: remainingErrors,
        requiresUserAction: true,
        finalUrl: lastCommittedUrl || window.location.href,
        activeFilters: extractPeopleSearchContext()?.peopleSearch?.activeFilters || [],
        error: "LinkedIn did not match the selected filters."
      };
    }
    const showedResults = applied.length ? true : await clickPeopleSearchShowResults();
    if (!showedResults && needsFilters) {
      return { applied: false, appliedFilters: applied, error: "LinkedIn did not show the Show results button." };
    }
    return {
      applied: true,
      appliedFilters: applied,
      unresolvedFilters: remainingErrors,
      finalUrl: lastCommittedUrl || window.location.href,
      activeFilters: extractPeopleSearchContext()?.peopleSearch?.activeFilters || []
    };
  }

  function roundMs(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return 0;
    }
    return Math.max(0, Math.round(number));
  }

  function nowMs() {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return performance.now();
    }
    return Date.now();
  }

  function mergeDebugInfo(result, debug) {
    return {
      ...result,
      debug: {
        ...(result?.debug || {}),
        ...(debug || {})
      }
    };
  }

  function getHeadingNodes() {
    return Array.from(getProfileRoot().querySelectorAll("h1, h2, h3, span[aria-hidden='true']"))
      .filter(isVisible)
      .map((node) => ({
        element: node,
        text: normalizeWhitespace(node.innerText || node.textContent || "")
      }))
      .filter((entry) => entry.text);
  }

  function isProfileSectionHeading(text) {
    const normalized = normalizeWhitespace(text);
    return PROFILE_SECTION_PATTERNS.some((pattern) => pattern.test(normalized));
  }

  function sectionScore(candidate, h1) {
    if (!candidate || !isVisible(candidate)) {
      return -1;
    }
    const rect = candidate.getBoundingClientRect();
    const text = normalizeWhitespace(candidate.innerText || "");
    const sections = candidate.querySelectorAll("section").length;
    const headings = visibleElements("h2, h3", candidate).length;
    const containsH1 = h1 ? candidate.contains(h1) : false;
    const leftBias = rect.left < window.innerWidth * 0.7 ? 1 : 0;
    const widthScore = rect.width > Math.min(1100, window.innerWidth * 0.55) ? 2 : 0;
    return (containsH1 ? 8 : 0) + sections * 2 + headings + leftBias + widthScore + Math.min(text.length / 1200, 6);
  }

  function getProfileRoot() {
    const main = document.querySelector("main");
    if (!main) {
      return document.body;
    }

    const h1 = visibleElements("h1", main)[0] || null;
    const selectorCandidates = [
      ".scaffold-layout__main",
      ".scaffold-layout-container__main",
      ".scaffold-layout__content",
      ".pv-top-card",
      "[data-view-name='profile']"
    ]
      .flatMap((selector) => visibleElements(selector, main));

    const ancestorCandidates = [];
    let current = h1;
    while (current && current !== main) {
      if (current instanceof HTMLElement) {
        ancestorCandidates.push(current);
      }
      current = current.parentElement;
    }

    const pool = Array.from(new Set([main, ...selectorCandidates, ...ancestorCandidates]));
    let best = main;
    let bestScore = -1;
    for (const candidate of pool) {
      const score = sectionScore(candidate, h1);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    return best || main;
  }

  function normalizeProfileTitleName() {
    const titleName = normalizeWhitespace(String(document.title || "").split("|")[0]);
    if (!titleName || /^linkedin$/i.test(titleName)) {
      return "";
    }
    return titleName;
  }

  function fallbackNameFromProfileUrl() {
    const profileUrl = normalizeLinkedInProfileUrl(window.location.href);
    if (!profileUrl) {
      return "";
    }
    try {
      const url = new URL(profileUrl);
      const parts = url.pathname.split("/").filter(Boolean);
      let slug = parts[0] === "in" ? parts[1] : "";
      try {
        slug = decodeURIComponent(slug);
      } catch (_error) {
        // Keep the raw slug when decoding fails.
      }
      if (!slug || /^ACo/i.test(slug)) {
        return "";
      }
      return slug
        .split("-")
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
    } catch (_error) {
      return "";
    }
  }

  function normalizePersonNameKey(value) {
    return normalizeWhitespace(value)
      .toLowerCase()
      .replace(/[^a-z0-9.\-'\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function looksLikePersonName(value) {
    const text = normalizeWhitespace(value);
    if (!text) {
      return false;
    }
    if (isProfileSectionHeading(text)) {
      return false;
    }
    if (/^(profile language|public profile(?:\s*&\s*url)?|more profiles for you|people also viewed|contact info)$/i.test(text)) {
      return false;
    }
    if (/[|:]/.test(text)) {
      return false;
    }
    const words = text.split(/\s+/).filter(Boolean);
    if (!words.length || words.length > 5) {
      return false;
    }
    if (!/^[A-Za-z][A-Za-z .'\-]+$/.test(text)) {
      return false;
    }
    const capitalizedWordCount = words.filter((word) => /^[A-Z][A-Za-z.'-]*$/.test(word)).length;
    return capitalizedWordCount >= Math.max(1, words.length - 1);
  }

  function personNameMatchScore(candidate, references) {
    const candidateKey = normalizePersonNameKey(candidate);
    if (!candidateKey) {
      return 0;
    }
    let best = 0;
    for (const reference of references) {
      const referenceKey = normalizePersonNameKey(reference);
      if (!referenceKey) {
        continue;
      }
      if (candidateKey === referenceKey) {
        best = Math.max(best, 10);
        continue;
      }
      if (candidateKey.startsWith(referenceKey) || referenceKey.startsWith(candidateKey)) {
        best = Math.max(best, 7);
        continue;
      }
      const candidateWords = candidateKey.split(" ").filter(Boolean);
      const referenceWords = referenceKey.split(" ").filter(Boolean);
      const overlap = candidateWords.filter((word) => referenceWords.includes(word)).length;
      if (overlap > 0) {
        best = Math.max(best, overlap);
      }
    }
    return best;
  }

  function findVisibleProfileHeading(root) {
    const scopedRoot = root || getProfileRoot() || document.querySelector("main") || document.body;
    const titleName = normalizeProfileTitleName();
    const slugName = fallbackNameFromProfileUrl();
    const referenceNames = [titleName, slugName].filter(Boolean);
    const candidates = Array.from(scopedRoot.querySelectorAll("h1, h2"))
      .filter(isVisible)
      .map((element) => ({
        element,
        text: normalizeWhitespace(element.innerText || element.textContent || ""),
        rect: element.getBoundingClientRect()
      }))
      .filter((entry) => entry.text)
      .filter((entry) => !isProfileSectionHeading(entry.text))
      .filter((entry) => looksLikePersonName(entry.text))
      .filter((entry) => entry.rect.top < window.innerHeight * 0.75)
      .map((entry) => ({
        ...entry,
        score:
          (personNameMatchScore(entry.text, referenceNames) * 100)
          + (entry.rect.left < window.innerWidth * 0.65 ? 15 : 0)
          + Math.max(0, 50 - Math.floor(entry.rect.top / 10))
          + Math.min(Math.floor(entry.rect.width / 50), 10)
      }))
      .sort((left, right) => right.score - left.score || left.rect.top - right.rect.top || right.rect.width - left.rect.width);
    return candidates[0]?.element || null;
  }

  function sectionHeadingText(section) {
    if (!section) {
      return "";
    }
    const heading = Array.from(section.querySelectorAll("h1, h2, h3, h4")).find(isVisible);
    return normalizeWhitespace(heading?.innerText || heading?.textContent || "");
  }

  function nearestSection(node) {
    if (!node) {
      return null;
    }
    return node.closest("section, div[data-view-name], [data-view-name='profile-card']") || node.parentElement;
  }

  function findSectionByHeading(pattern) {
    const heading = getHeadingNodes().find((entry) => pattern.test(entry.text));
    return heading ? nearestSection(heading.element) : null;
  }

  function summarizeListItem(item, limit) {
    const text = visibleText(item);
    if (!text) {
      return "";
    }
    return cleanProfileSectionItemText(text.replace(/\n+/g, " | "), limit || 220);
  }

  function cleanProfileSectionItemText(value, limit) {
    return truncate(
      normalizeWhitespace(value)
        .replace(/^(?:Experience|Education|Activity|Languages?|Licenses & certifications|Projects|Skills|Recommendations|Honors & awards|Organizations)\s*[:|]?\s+/i, "")
        .replace(/\s+\|\s+/g, " | "),
      limit
    );
  }

  function sectionText(section, limit) {
    const text = visibleText(section);
    return text ? truncate(text.replace(/\n+/g, " | "), limit) : "";
  }

  function extractSectionItems(pattern, maxItems, options) {
    const section = findSectionByHeading(pattern);
    if (!section) {
      return [];
    }
    const itemLimit = Math.max(220, Number(options?.itemLimit) || 220);
    const items = Array.from(section.querySelectorAll("li"))
      .map((item) => summarizeListItem(item, itemLimit))
      .filter(Boolean);

    if (items.length) {
      return uniqueStrings(items).slice(0, maxItems);
    }

    const text = visibleText(section);
    if (!text) {
      return [];
    }
    return uniqueStrings(text.split(" | ").map((line) => cleanProfileSectionItemText(line, itemLimit))).slice(0, maxItems);
  }

  function extractExperienceHighlights(maxItems, options) {
    const section = findSectionByHeading(/^experience$/i);
    if (!section) {
      return [];
    }
    const itemLimit = Math.max(500, Number(options?.itemLimit) || 2600);
    const structuredItems = parseExperienceEntries(visibleTextLines(section), itemLimit)
      .map((entry) => formatExperienceEntry(entry, itemLimit));
    if (structuredItems.length) {
      return uniqueStrings(structuredItems).slice(0, maxItems);
    }
    return extractSectionItems(/^experience$/i, maxItems, { itemLimit });
  }

  function extractExperienceItems(maxItems, options) {
    const section = findSectionByHeading(/^experience$/i);
    if (!section) {
      return [];
    }
    const itemLimit = Math.max(500, Number(options?.itemLimit) || 2600);
    return parseExperienceEntries(visibleTextLines(section), itemLimit).slice(0, maxItems);
  }

  function parseExperienceLines(lines, itemLimit) {
    return parseExperienceEntries(lines, itemLimit).map((entry) => formatExperienceEntry(entry, itemLimit));
  }

  function parseExperienceEntries(lines, itemLimit) {
    const cleanLines = (lines || [])
      .map((line) => normalizeWhitespace(line))
      .filter(Boolean)
      .filter((line) => !/^(Experience|Show all)$/i.test(line))
      .filter((line) => !/\slogo$/i.test(line));
    const items = [];
    let groupCompany = "";

    const isEmploymentLine = (line) => /\b(?:Full-time|Part-time|Self-employed|Freelance|Internship|Contract)\b/i.test(line || "");
    const isDateLine = (line) => /(?:\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b\s+\d{4}|\b\d{4}\b|Present)/i.test(line || "")
      && /(?:\d{4}|Present|·\s*\d+\s+(?:yr|yrs|mo|mos))/i.test(line || "");
    const isSkippableRoleLine = (line) => !line
      || /^•/.test(line)
      || isEmploymentLine(line)
      || isDateLine(line)
      || /^(Experience|Show all)$/i.test(line)
      || /\slogo$/i.test(line);
    const isRoleStart = (index) => {
      const line = cleanLines[index];
      if (isSkippableRoleLine(line)) {
        return false;
      }
      return isDateLine(cleanLines[index + 1])
        || (isEmploymentLine(cleanLines[index + 1]) && isDateLine(cleanLines[index + 2]));
    };

    for (let index = 0; index < cleanLines.length; index += 1) {
      const line = cleanLines[index];
      if (!isRoleStart(index) && isEmploymentLine(cleanLines[index + 1])) {
        groupCompany = line;
        index += 1;
        continue;
      }
      if (!isRoleStart(index)) {
        continue;
      }

      const role = line;
      let company = groupCompany;
      let employmentType = "";
      let date = "";
      let cursor = index + 1;
      if (isEmploymentLine(cleanLines[cursor])) {
        const companyEmployment = parseCompanyEmploymentLine(cleanLines[cursor]);
        company = companyEmployment.company || company;
        employmentType = companyEmployment.employmentType;
        cursor += 1;
      }
      if (isDateLine(cleanLines[cursor])) {
        date = cleanLines[cursor];
        cursor += 1;
      }

      const detailLines = [];
      while (cursor < cleanLines.length && !isRoleStart(cursor)) {
        const detail = cleanLines[cursor];
        if (!isEmploymentLine(detail) && !/\slogo$/i.test(detail) && !/^(Show all)$/i.test(detail)) {
          detailLines.push(detail);
        }
        cursor += 1;
      }

      const normalizedDetails = detailLines.map((detail) => normalizeWhitespace(detail)).filter(Boolean);
      let location = "";
      if (normalizedDetails.length > 1 && normalizedDetails[0].length <= 80 && !/[.!?]$/.test(normalizedDetails[0]) && !/^•/.test(normalizedDetails[0])) {
        location = normalizedDetails.shift();
      }
      const bullets = normalizedDetails
        .filter((detail) => /^•/.test(detail))
        .map(stripBulletMarker);
      const summary = normalizedDetails
        .filter((detail) => !/^•/.test(detail))
        .join(" ");
      items.push({
        title: role,
        company: cleanCompanyName(company),
        employmentType,
        ...parseDateRangeText(date),
        location,
        summary: truncate(normalizeWhitespace(summary), itemLimit),
        bullets: bullets.map((bullet) => truncate(bullet, 900)).filter(Boolean)
      });
      index = cursor - 1;
    }

    return items.filter((item) => item.title || item.company || item.summary);
  }

  function parseCompanyEmploymentLine(value) {
    const parts = normalizeWhitespace(value).split(/\s+·\s+/).map((part) => normalizeWhitespace(part)).filter(Boolean);
    return {
      company: cleanCompanyName(parts[0] || ""),
      employmentType: parts.slice(1).find((part) => /\b(?:Full-time|Part-time|Self-employed|Freelance|Internship|Contract)\b/i.test(part)) || ""
    };
  }

  function cleanCompanyName(value) {
    return normalizeWhitespace(value)
      .replace(/\s+·\s+(?:Full-time|Part-time|Self-employed|Freelance|Internship|Contract).*$/i, "")
      .trim();
  }

  function parseDateRangeText(value) {
    const normalized = normalizeWhitespace(value);
    const [rangeText, durationText = ""] = normalized.split(/\s+·\s+/, 2).map((part) => normalizeWhitespace(part));
    const rangeParts = normalizeWhitespace(rangeText).split(/\s+(?:-|–|—)\s+/).map((part) => normalizeWhitespace(part));
    return {
      startDateText: rangeParts[0] || "",
      endDateText: rangeParts[1] || "",
      durationText
    };
  }

  function stripBulletMarker(value) {
    return normalizeWhitespace(value).replace(/^•\s*/, "");
  }

  function formatExperienceEntry(entry, limit) {
    const detail = [
      entry.title,
      entry.company,
      entry.employmentType,
      [entry.startDateText, entry.endDateText].filter(Boolean).join(" - "),
      entry.durationText,
      entry.location,
      entry.summary,
      ...(Array.isArray(entry.bullets) ? entry.bullets.map((bullet) => `• ${bullet}`) : [])
    ].filter(Boolean).join(" ");
    return cleanProfileSectionItemText(detail, limit || 2600);
  }

  function extractSectionParagraph(pattern, limit) {
    const section = findSectionByHeading(pattern);
    if (!section) {
      return "";
    }
    const paragraphs = Array.from(section.querySelectorAll("p, span[aria-hidden='true'], div.inline-show-more-text"))
      .filter(isVisible)
      .map(visibleText)
      .filter(Boolean);

    if (paragraphs.length) {
      return truncate(paragraphs.join(" "), limit);
    }

    return truncate(visibleText(section), limit);
  }

  function extractEducationItems(maxItems) {
    const section = findSectionByHeading(/^education$/i);
    if (!section) {
      return [];
    }
    return parseEducationLines(visibleTextLines(section)).slice(0, maxItems);
  }

  function parseEducationLines(lines) {
    const cleanLines = (lines || [])
      .map((line) => normalizeWhitespace(line))
      .filter(Boolean)
      .filter((line) => !/^(Education|Show all)$/i.test(line))
      .filter((line) => !/\slogo$/i.test(line))
      .filter((line) => !/\bthumbnail\b/i.test(line))
      .filter((line) => !/journey$/i.test(line));
    const items = [];
    const isDateLine = (line) => /(?:\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b\s+\d{4}|\b\d{4}\b|Present)/i.test(line || "");
    const looksLikeSchool = (line) => /\b(?:University|College|School|Institute)\b/i.test(line || "")
      || /\b(?:Yale|NUS)\b/i.test(line || "");

    for (let index = 0; index < cleanLines.length; index += 1) {
      const school = cleanLines[index];
      if (!looksLikeSchool(school)) {
        continue;
      }
      let degree = "";
      let dateText = "";
      let cursor = index + 1;
      if (cleanLines[cursor] && !isDateLine(cleanLines[cursor]) && !looksLikeSchool(cleanLines[cursor])) {
        degree = cleanLines[cursor];
        cursor += 1;
      }
      if (isDateLine(cleanLines[cursor])) {
        dateText = cleanLines[cursor];
        cursor += 1;
      }
      const activities = [];
      const notes = [];
      while (cursor < cleanLines.length && !looksLikeSchool(cleanLines[cursor])) {
        const line = cleanLines[cursor];
        if (/^Activities and societies:/i.test(line)) {
          activities.push(...line.replace(/^Activities and societies:\s*/i, "").split(/[;,]/).map((item) => normalizeWhitespace(item)).filter(Boolean));
        } else {
          notes.push(line);
        }
        cursor += 1;
      }
      items.push({
        school,
        degree,
        ...parseDateRangeText(dateText),
        activities: uniqueStrings(activities),
        notes: normalizeWhitespace(notes.join(" "))
      });
      index = cursor - 1;
    }

    return items.filter((item) => item.school);
  }

  function formatEducationEntry(entry, limit) {
    return cleanProfileSectionItemText([
      entry.school,
      entry.degree,
      [entry.startDateText, entry.endDateText].filter(Boolean).join(" - "),
      entry.activities?.length ? `Activities: ${entry.activities.join(", ")}` : "",
      entry.notes
    ].filter(Boolean).join(" "), limit || 1800);
  }

  function extractLanguageItems(maxItems) {
    const section = findSectionByHeading(/^languages?$/i);
    if (!section) {
      return [];
    }
    const lines = visibleTextLines(section)
      .filter((line) => !/^Languages?$/i.test(line))
      .filter((line) => !/^(Show all)$/i.test(line));
    const items = [];
    for (let index = 0; index < lines.length; index += 2) {
      const language = normalizeWhitespace(lines[index]);
      const proficiency = normalizeWhitespace(lines[index + 1] || "");
      if (language) {
        items.push({ language, proficiency });
      }
    }
    return items.slice(0, maxItems);
  }

  function extractSignals(experienceHighlights, educationHighlights, location, languageSnippets, sectionSnapshots) {
    const companies = [];
    const schools = [];
    const experienceText = normalizeWhitespace([
      ...experienceHighlights,
      ...uniqueStrings(sectionSnapshots || []).filter((snapshot) => /^Experience:/i.test(snapshot))
    ].join(" | "));
    const educationText = normalizeWhitespace([
      ...educationHighlights,
      ...uniqueStrings(sectionSnapshots || []).filter((snapshot) => /^Education:/i.test(snapshot))
    ].join(" | "));

    companies.push(...companySignalsFromExperience(experienceText));
    for (const item of [educationText, ...educationHighlights]) {
      schools.push(...schoolSignalsFromEducation(item));
    }

    return {
      companies: uniqueStrings(companies).slice(0, 6),
      schools: compactSchoolSignals(schools).slice(0, 6),
      locations: uniqueStrings([location]).slice(0, 3),
      languages: languageSignalsFromSnippets(languageSnippets).slice(0, 6)
    };
  }

  function companySignalsFromExperience(value) {
    const text = normalizeWhitespace(value);
    if (!text) {
      return [];
    }
    const candidates = [];
    const patterns = [
      /\b(?:at|@)\s+([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,5})\b/g,
      /\b([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,5})\s+(?:Full-time|Part-time|Self-employed|Freelance|Internship|Contract)\b/g,
      /\b([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,5})\s+·\s+(?:Full-time|Part-time|Self-employed|Freelance|Internship|Contract)\b/g
    ];
    patterns.forEach((pattern) => {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        candidates.push(match[1]);
      }
    });
    return uniqueStrings(candidates.map(cleanCompanySignalCandidate))
      .filter((candidate) => candidate.length >= 2);
  }

  function cleanCompanySignalCandidate(candidate) {
    const normalized = normalizeWhitespace(candidate)
      .replace(/^(?:Experience|Current|Past)\s*[:|]?\s*/i, "")
      .replace(/\s*[|\u2022\u00b7].*$/, "")
      .trim();
    return normalized
      .replace(/^(?:Associate\s+)?(?:Senior\s+)?(?:Technical\s+)?(?:Product|Program|Project|Engineering|Design|Marketing|Growth|Business|Operations)\s+(?:Marketing\s+)?(?:Manager|Director|Lead|Owner|Intern|Associate|Executive)\s+/i, "")
      .replace(/^(?:Lead\s+)?Product\s+Manager\s*&\s*Founder\s+/i, "")
      .replace(/^(?:Co-)?Founder\s+/i, "")
      .trim();
  }

  function schoolSignalsFromEducation(value) {
    const text = normalizeWhitespace(value);
    if (!text) {
      return [];
    }
    const candidates = [];
    const patterns = [
      /\b[A-Z][A-Za-z&.'-]*(?:\s+[A-Z][A-Za-z&.'-]*){0,7}\s+(?:University|College|School|Institute)(?:\s+of\s+[A-Z][A-Za-z&.'-]*(?:\s+[A-Z][A-Za-z&.'-]*){0,5})?/g,
      /\b(?:University|College|School|Institute)\s+of\s+[A-Z][A-Za-z&.'-]*(?:\s+[A-Z][A-Za-z&.'-]*){0,7}\b/g,
      /\b(?:Yale SOM|NUS|IIT Bombay)\b/g,
      /\bNational University of Singapore\b/g,
      /\bYale School of Management\b/g
    ];
    patterns.forEach((pattern) => {
      candidates.push(...(text.match(pattern) || []));
    });
    if (!candidates.length && /\b(?:university|college|school|institute|som|nus|yale|stanford|duke)\b/i.test(text) && text.length <= 120) {
      candidates.push(text);
    }
    return compactSchoolSignals(candidates.map((candidate) => normalizeWhitespace(candidate)
      .replace(/^(?:Education|School)\s*[:|]?\s*/i, "")
      .replace(/\b(?:Bachelor'?s?|Master'?s?|MBA|MAM|MS|MA|BS|BA|degree|candidate|coursework|activities|societies)\b.*$/i, "")
      .replace(/\s*[|\u2022\u00b7]\s*.*$/, "")
      .trim()
    )).filter((candidate) => candidate.length >= 3);
  }

  function compactSchoolSignals(values) {
    const normalized = uniqueStrings((values || []).map((value) => normalizeWhitespace(value))
      .filter((value) => value && !/^school of management$/i.test(value)));
    return normalized.filter((candidate) => {
      const lower = candidate.toLowerCase();
      return !normalized.some((other) => other !== candidate && other.toLowerCase().includes(lower));
    });
  }

  function languageSignalsFromSnippets(languageSnippets) {
    const text = normalizeWhitespace((languageSnippets || []).join(" "));
    if (!text) {
      return [];
    }
    const knownLanguages = [
      "English",
      "Vietnamese",
      "French",
      "Spanish",
      "Chinese",
      "Mandarin",
      "Cantonese",
      "Japanese",
      "Korean",
      "German",
      "Portuguese"
    ];
    const matches = knownLanguages.filter((language) => new RegExp(`\\b${language}\\b`, "i").test(text));
    return uniqueStrings(matches.length ? matches : languageSnippets);
  }

  function getProfileSections(root) {
    return Array.from((root || getProfileRoot()).querySelectorAll("section"))
      .filter(isVisible)
      .filter((section) => {
        const heading = sectionHeadingText(section);
        return Boolean(heading) && isProfileSectionHeading(heading);
      });
  }

  function sectionSnapshotLimit(heading) {
    if (/^(activity|featured|posts?)$/i.test(heading)) {
      return 2400;
    }
    if (/^experience$/i.test(heading)) {
      return 12000;
    }
    if (/^education$/i.test(heading)) {
      return 6000;
    }
    return 3200;
  }

  function locateProfileTopCard(root) {
    const scopedRoot = root || getProfileRoot();
    const heading = findVisibleProfileHeading(scopedRoot) || queryVisibleWithin(scopedRoot, "h1, h2");
    let current = heading;
    while (current && current !== scopedRoot && current !== document.body) {
      if (isVisible(current)) {
        const lines = visibleTextLines(current);
        const text = visibleMultilineText(current);
        if (lines.length >= 3 && lines.length <= 14 && text.length <= 1600) {
          return current;
        }
      }
      current = current.parentElement;
    }

    const headingCard = heading?.closest("section, .pv-top-card, .mt2.relative, .ph5.pb5, .artdeco-card, main");
    if (headingCard && isVisible(headingCard)) {
      return headingCard;
    }
    return queryVisibleWithin(
      scopedRoot,
      ".pv-top-card, .mt2.relative, .ph5.pb5, .artdeco-card, main"
    );
  }

  function extractTopCardSnapshot(root) {
    const topCard = locateProfileTopCard(root);
    if (!topCard) {
      return "";
    }

    const richTopCardText = truncate(visibleMultilineText(topCard), 1800);
    const pieces = uniqueStrings([
      visibleText(queryVisibleWithin(topCard, "h1, h2")),
      visibleText(
        queryVisibleWithin(topCard, ".text-body-medium.break-words") ||
        queryVisibleWithin(topCard, ".pv-text-details__left-panel .text-body-medium")
      ),
      visibleText(
        queryVisibleWithin(topCard, ".text-body-small.inline.t-black--light.break-words") ||
        queryVisibleWithin(topCard, ".pv-text-details__left-panel .text-body-small")
      ),
      visibleText(queryVisibleWithin(topCard, ".inline-show-more-text")),
      visibleText(queryVisibleWithin(topCard, ".pv-contact-info__contact-type")),
      richTopCardText
    ]);

    return pieces.length ? `Top card: ${pieces.join(" | ")}` : "";
  }

  function extractTopCardIdentity(root) {
    const topCard = locateProfileTopCard(root);
    if (!topCard) {
      return { name: "", headline: "", location: "" };
    }

    const name = visibleText(findVisibleProfileHeading(topCard) || queryVisibleWithin(topCard, "h1, h2"));
    const lines = visibleTextLines(topCard);
    const normalizedName = normalizeWhitespace(name).toLowerCase();
    const cleanedLines = lines.filter((line) => {
      const normalized = normalizeWhitespace(line);
      const lower = normalized.toLowerCase();
      if (!normalized) {
        return false;
      }
      if (normalizedName && lower === normalizedName) {
        return false;
      }
      if (/^\d+(?:st|nd|rd|th)?$/i.test(normalized)) {
        return false;
      }
      if (/^\d+(?:st|nd|rd|th)\s+degree connection$/i.test(lower)) {
        return false;
      }
      if (/^(contact info|message|connect|follow|more)$/i.test(lower)) {
        return false;
      }
      if (/mutual connections?/i.test(lower)) {
        return false;
      }
      if (/^(he\/him|she\/her|they\/them)(\s*[·|]\s*\d+(?:st|nd|rd|th))?$/i.test(normalized)) {
        return false;
      }
      if (/^\d+(?:st|nd|rd|th)\s*[·|]?\s*(degree connection)?$/i.test(lower)) {
        return false;
      }
      return true;
    });

    const headline = cleanedLines.find(looksLikeProfileHeadlineLine)
      || cleanedLines.find((line) => {
        const lower = line.toLowerCase();
        if (isLikelyPronounOrDegreeLine(line)) {
          return false;
        }
        if (/contact info|mutual connections?/i.test(lower)) {
          return false;
        }
        if (/(united states|india|singapore|canada|united kingdom|uk|new york|san francisco|connecticut|california|boston|seattle|area)/i.test(lower)) {
          return false;
        }
        return line.length >= 8 && line.length <= 140;
      }) || "";

    const location = cleanedLines.find((line) => {
      const lower = line.toLowerCase();
      return /(area|united states|india|singapore|canada|united kingdom|uk|new york|san francisco|connecticut|california|boston|seattle)/i.test(lower)
        || (/,/.test(line) && !/[|]/.test(line) && lower !== headline.toLowerCase());
    }) || "";

    return { name, headline, location };
  }

  function isLikelyPronounOrDegreeLine(value) {
    const normalized = normalizeWhitespace(value).toLowerCase();
    if (!normalized) {
      return false;
    }
    return /^(he\/him|she\/her|they\/them)(\s*[·|]\s*\d+(?:st|nd|rd|th))?$/i.test(normalized)
      || /^\d+(?:st|nd|rd|th)\s*[·|]?\s*(degree connection)?$/i.test(normalized)
      || /^1st|^2nd|^3rd/.test(normalized);
  }

  function looksLikeProfileHeadlineLine(value) {
    const line = normalizeWhitespace(value);
    const lower = line.toLowerCase();
    if (!line || isLikelyPronounOrDegreeLine(line)) {
      return false;
    }
    if (/^about\b/i.test(lower)) {
      return false;
    }
    if (/contact info|mutual connections?|followers?|connection(s)?$/i.test(lower)) {
      return false;
    }
    if (/(united states|india|singapore|canada|united kingdom|uk|new york|san francisco|connecticut|california|boston|seattle|area)/i.test(lower)) {
      return false;
    }
    if (/[|]/.test(line)) {
      return true;
    }
    if (/(manager|director|founder|student|mba|som|product|engineer|strategy|marketing|sales|ads|platform|banking|fintech|ai|risk|fraud|recruiter|talent|acquisition|specialist|analyst|consultant|associate|intern)/i.test(line)) {
      return true;
    }
    if (/,/.test(line) && !/(united states|area|county|province|india|singapore|canada|uk|united kingdom)/i.test(lower)) {
      return true;
    }
    return false;
  }

  function isInjectedProfileSuggestionLine(value) {
    const line = normalizeWhitespace(value);
    const lower = line.toLowerCase();
    if (!line) {
      return false;
    }
    if (/^explore premium profiles\b/i.test(lower)) {
      return true;
    }
    const degreeMatches = line.match(/\b(?:1st|2nd|3rd\+?|\d+(?:st|nd|rd|th))\b/ig) || [];
    return /\bmessage\b/i.test(line) && degreeMatches.length >= 1;
  }

  function selectProfileHeadlineCandidate(candidates) {
    const values = Array.isArray(candidates) ? candidates : [candidates];
    for (const value of values) {
      const line = normalizeWhitespace(value);
      if (!line || isInjectedProfileSuggestionLine(line)) {
        continue;
      }
      if (looksLikeProfileHeadlineLine(line)) {
        return line;
      }
    }
    for (const value of values) {
      const line = normalizeWhitespace(value);
      if (!line || isInjectedProfileSuggestionLine(line) || isLikelyPronounOrDegreeLine(line)) {
        continue;
      }
      if (!/^about\b/i.test(line.toLowerCase())) {
        return line;
      }
    }
    return "";
  }

  function extractHeadlineNearHeading(root) {
    const scopedRoot = root || getProfileRoot();
    const heading = queryVisibleWithin(scopedRoot, "h1, h2");
    if (!heading) {
      return "";
    }
    const scopes = Array.from(new Set([
      heading.parentElement,
      heading.parentElement?.parentElement,
      locateProfileTopCard(scopedRoot),
      scopedRoot
    ].filter(Boolean)));

    for (const scope of scopes) {
      const candidates = Array.from(scope.querySelectorAll("p, div, span"))
        .filter(isVisible)
        .filter((node) => heading.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)
        .map((node) => visibleText(node))
        .map((text) => normalizeWhitespace(text))
        .filter(Boolean)
        .filter((text) => !/^about\b/i.test(text))
        .filter((text) => text.toLowerCase() !== normalizeWhitespace(visibleText(heading)).toLowerCase());
      const match = candidates.find(looksLikeProfileHeadlineLine);
      if (match) {
        return match;
      }
    }
    return "";
  }

  function topCardStabilitySignature() {
    const identity = extractTopCardIdentity(getProfileRoot());
    return JSON.stringify({
      name: normalizeWhitespace(identity.name),
      headline: normalizeWhitespace(identity.headline),
      location: normalizeWhitespace(identity.location)
    });
  }

  async function waitForStableProfileTopCard(maxChecks) {
    if (!isSupportedProfilePage()) {
      return;
    }
    const checks = Math.max(2, Number(maxChecks) || 5);
    let previousSignature = "";
    let stableCount = 0;
    for (let attempt = 0; attempt < checks; attempt += 1) {
      const signature = topCardStabilitySignature();
      if (signature && signature === previousSignature && signature !== JSON.stringify({ name: "", headline: "", location: "" })) {
        stableCount += 1;
        if (stableCount >= 1) {
          return;
        }
      } else {
        stableCount = 0;
      }
      previousSignature = signature;
      await delay(attempt < 2 ? 180 : 260);
    }
  }

  async function waitForProfilePageReady(maxChecks) {
    if (!isSupportedProfilePage()) {
      return;
    }
    const checks = Math.max(3, Number(maxChecks) || 8);
    for (let attempt = 0; attempt < checks; attempt += 1) {
      const readyState = document.readyState;
      const root = getProfileRoot();
      const hasVisibleHeading = Boolean(findVisibleProfileHeading(root || document) || queryVisibleWithin(root || document, "h1, h2"));
      const hasVisibleMain = Boolean(queryVisible("main"));
      if ((readyState === "interactive" || readyState === "complete") && hasVisibleMain && hasVisibleHeading) {
        return;
      }
      await delay(attempt < 3 ? 180 : 260);
    }
  }

  function cleanActivitySnippet(text, fullName) {
    const lines = cleanActivityLines(text, fullName);

    if (!lines.length) {
      return "";
    }

    return truncate(lines.slice(0, 6).join(" | "), 520);
  }

  function cleanActivityLines(text, fullName) {
    return String(text || "")
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => normalizeWhitespace(line))
      .filter(Boolean)
      .filter((line) => {
        if (!line) {
          return false;
        }
        if (/^activity$/i.test(line)) {
          return false;
        }
        if (/^\d[\d,]*\s+followers?$/i.test(line)) {
          return false;
        }
        if (/^(create a post|posts|comments|videos|images|show all activity|see all activity)$/i.test(line)) {
          return false;
        }
        if (/^(like|comment|repost|send)$/i.test(line)) {
          return false;
        }
        if (/^you$/i.test(line)) {
          return false;
        }
        if (fullName && line.toLowerCase() === normalizeWhitespace(fullName).toLowerCase()) {
          return false;
        }
        return true;
      });
  }

  function extractActivityTimestamp(lines) {
    return (lines || []).find((line) => /^(?:\d+\s*(?:m|h|d|w|mo|yr|yrs)|\d+\s*(?:min|mins|hour|hours|day|days|week|weeks|month|months|year|years))\s*•?(?:\s*Edited\s*•?)?$/i.test(line)) || "";
  }

  function extractActivityText(lines, timestampText) {
    const skip = new Set([
      timestampText,
      "• You",
      "You"
    ].map((line) => normalizeWhitespace(line)).filter(Boolean));
    const contentLines = (lines || [])
      .filter((line) => !skip.has(normalizeWhitespace(line)))
      .filter((line) => !/^•?\s*\d+(?:st|nd|rd|th)?$/i.test(line))
      .filter((line) => !/^View\b/i.test(line))
      .filter((line) => !/\breposted this$/i.test(line))
      .filter((line) => !(/ \| /.test(line) && line.length <= 180))
      .filter((line) => !/^(Like|Comment|Repost|Send|View analytics)$/i.test(line))
      .filter((line) => !/^\d[\d,]*\s+(?:impressions?|comments?|reposts?|reactions?)$/i.test(line));
    const firstContentIndex = contentLines.findIndex((line) => line.length >= 40 || /^["“'A-Z0-9🤖🏢👤🛠️⚖️⚠️💡]/.test(line));
    const selected = firstContentIndex >= 0 ? contentLines.slice(firstContentIndex) : contentLines;
    return truncate(selected.slice(0, 8).join(" "), 900);
  }

  function rawActivityLines(text) {
    return String(text || "")
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => normalizeWhitespace(line))
      .filter(Boolean);
  }

  function parseActivityItemsFromSectionLines(sectionText, fullName, maxItems) {
    const ownerName = normalizeWhitespace(fullName);
    const rawLines = rawActivityLines(sectionText)
      .filter((line) => !/^(Activity|Create a post|Posts|Comments|Videos|Images|Show all)$/i.test(line))
      .filter((line) => !/^\d[\d,]*\s+followers?$/i.test(line));
    const groups = [];
    let current = [];
    const isStartLine = (line) => {
      if (ownerName && line === ownerName) {
        return true;
      }
      if (ownerName && new RegExp(`^${ownerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+reposted this$`, "i").test(line)) {
        return true;
      }
      return /\breposted this$/i.test(line);
    };

    for (const line of rawLines) {
      if (isStartLine(line) && current.length) {
        groups.push(current);
        current = [line];
      } else {
        current.push(line);
      }
    }
    if (current.length) {
      groups.push(current);
    }

    return groups
      .map((group, index) => {
        const lines = cleanActivityLines(group.join("\n"), fullName);
        const timestampText = extractActivityTimestamp(lines);
        const text = extractActivityText(lines, timestampText);
        return {
          rank: index + 1,
          isLatest: index === 0,
          type: /\breposted this$/i.test(group.join(" ")) ? "repost" : "post",
          timestampText,
          text,
          source: "visible_profile_activity"
        };
      })
      .filter((item) => item.text && item.text.length >= 60)
      .slice(0, maxItems);
  }

  function extractActivityItems(maxItems, fullName) {
    const section = findSectionByHeading(/^(activity|featured|posts?)$/i);
    if (!section) {
      return [];
    }

    const linkedCandidates = Array.from(section.querySelectorAll("a[href*='/posts/'], a[href*='/activity/'], a[href*='/feed/update/']"))
      .filter(isVisible)
      .map((node) => node.closest("article, li, .artdeco-card, .update-components-update-v2, .feed-shared-update-v2") || node.parentElement);
    const fallbackCandidates = Array.from(section.querySelectorAll("article, li, .artdeco-card, .update-components-update-v2, .feed-shared-update-v2"))
      .filter(isVisible);
    const candidates = Array.from(new Set([...linkedCandidates, ...fallbackCandidates]))
      .filter(Boolean)
      .filter((node) => !Array.from(new Set([...linkedCandidates, ...fallbackCandidates])).some((other) => other && other !== node && node.contains(other) && isVisible(other)));

    const cardItems = candidates
      .map((node, index) => {
        const lines = cleanActivityLines(visibleMultilineText(node), fullName);
        const timestampText = extractActivityTimestamp(lines);
        const text = extractActivityText(lines, timestampText);
        return {
          rank: index + 1,
          isLatest: index === 0,
          type: "post",
          timestampText,
          text,
          source: "visible_profile_activity"
        };
      })
      .filter((item) => item.text && item.text.length >= 60);
    const sectionItems = parseActivityItemsFromSectionLines(visibleMultilineText(section), fullName, maxItems);
    const items = cardItems.length >= Math.min(2, maxItems)
      ? cardItems
      : sectionItems.length > cardItems.length
        ? sectionItems
        : cardItems;

    if (items.length) {
      return uniqueStrings(items.map((item) => JSON.stringify(item)))
        .map((item) => JSON.parse(item))
        .slice(0, maxItems);
    }

    const lines = cleanActivityLines(visibleMultilineText(section), fullName);
    const timestampText = extractActivityTimestamp(lines);
    const text = extractActivityText(lines, timestampText);
    return text ? [{ rank: 1, isLatest: true, type: "post", timestampText, text, source: "visible_profile_activity" }] : [];
  }

  function extractActivitySnippets(maxItems, fullName) {
    const activityItems = extractActivityItems(maxItems, fullName);
    if (activityItems.length) {
      return activityItems.map((item) => item.text).filter(Boolean);
    }
    const section = findSectionByHeading(/^(activity|featured|posts?)$/i);
    if (!section) {
      return [];
    }

    const linkedCandidates = Array.from(section.querySelectorAll("a[href*='/posts/'], a[href*='/activity/']"))
      .filter(isVisible)
      .map((node) => node.closest("article, li, .artdeco-card, .update-components-update-v2, .feed-shared-update-v2") || node.parentElement);
    const fallbackCandidates = Array.from(section.querySelectorAll("article, li, .artdeco-card, .update-components-update-v2, .feed-shared-update-v2"))
      .filter(isVisible);
    const candidates = Array.from(new Set([...linkedCandidates, ...fallbackCandidates]))
      .filter(Boolean)
      .filter((node) => !Array.from(new Set([...linkedCandidates, ...fallbackCandidates])).some((other) => other && other !== node && node.contains(other) && isVisible(other)));

    const snippets = candidates
      .map((node) => cleanActivitySnippet(visibleMultilineText(node), fullName))
      .filter((text) => text && text.length >= 60);

    if (snippets.length) {
      return uniqueStrings(snippets).slice(0, maxItems);
    }

    const fallback = cleanActivitySnippet(visibleMultilineText(section), fullName);
    return fallback ? [fallback] : [];
  }

  function extractSectionSnapshots() {
    const root = getProfileRoot();
    if (!root) {
      return [];
    }

    return uniqueStrings(
      getProfileSections(root)
        .map((section) => {
          const heading = sectionHeadingText(section);
          const body = sectionText(section, sectionSnapshotLimit(heading));
          if (!body) {
            return "";
          }
          return heading ? `${heading}: ${body}` : body;
        })
        .filter(Boolean)
    ).slice(0, 12);
  }

  function extractRawSnapshot(sectionSnapshots) {
    const root = getProfileRoot();
    const topCard = extractTopCardSnapshot(root);
    return truncate(uniqueStrings([topCard, ...sectionSnapshots]).join("\n\n"), 60000);
  }

  function hasCriticalProfileIdentity(name, headline) {
    return Boolean(normalizeWhitespace(name) && normalizeWhitespace(headline));
  }

  function extractProfile() {
    if (!isSupportedProfilePage()) {
      return {
        supported: false,
        pageType: "unsupported",
        pageUrl: window.location.href,
        title: document.title
      };
    }

    const root = getProfileRoot();
    const profileColumn = queryVisibleWithin(
      document,
      ".scaffold-layout__main, .scaffold-layout__content, main"
    ) || root;
    const topCard = locateProfileTopCard(profileColumn) || root;
    const topCardIdentity = extractTopCardIdentity(profileColumn);
    const headingName = visibleText(findVisibleProfileHeading(topCard) || findVisibleProfileHeading(profileColumn) || queryVisibleWithin(topCard, "h1, h2") || queryVisibleWithin(profileColumn, "h1, h2"));
    const titleName = normalizeProfileTitleName();
    const fallbackSlugName = fallbackNameFromProfileUrl();
    const name = headingName || topCardIdentity.name || titleName || fallbackSlugName;
    const headline = selectProfileHeadlineCandidate([
      visibleText(
        queryVisibleWithin(topCard, ".text-body-medium.break-words") ||
        queryVisibleWithin(topCard, ".pv-text-details__left-panel .text-body-medium")
      ),
      topCardIdentity.headline,
      extractHeadlineNearHeading(profileColumn),
      visibleText(
        queryVisibleWithin(profileColumn, ".text-body-medium.break-words") ||
        queryVisibleWithin(profileColumn, ".pv-text-details__left-panel .text-body-medium")
      )
    ]);
    const location = visibleText(
      queryVisibleWithin(topCard, ".text-body-small.inline.t-black--light.break-words") ||
      queryVisibleWithin(profileColumn, ".text-body-small.inline.t-black--light.break-words") ||
      queryVisibleWithin(profileColumn, ".pv-text-details__left-panel .text-body-small")
    ) || topCardIdentity.location;
    const about = extractSectionParagraph(/^about$/i, 1200);
    const profileUrl = normalizeLinkedInProfileUrl(window.location.href) || window.location.href;
    const experienceItems = extractExperienceItems(8, { itemLimit: 2600 });
    const experienceHighlights = experienceItems.length
      ? experienceItems.map((entry) => formatExperienceEntry(entry, 2600))
      : extractExperienceHighlights(8, { itemLimit: 2600 });
    const educationItems = extractEducationItems(6);
    const educationHighlights = educationItems.length
      ? educationItems.map((entry) => formatEducationEntry(entry, 1800))
      : extractSectionItems(/^education$/i, 6, { itemLimit: 1800 });
    const activityItems = extractActivityItems(3, name);
    const activitySnippets = activityItems.map((item) => item.text).filter(Boolean);
    const languageItems = extractLanguageItems(6);
    const languageSnippets = languageItems.length
      ? languageItems.map((item) => [item.language, item.proficiency].filter(Boolean).join(" "))
      : extractSectionItems(/^languages?$/i, 4, { itemLimit: 800 });
    const sectionSnapshots = extractSectionSnapshots();
    const rawSnapshot = extractRawSnapshot(sectionSnapshots);
    const visibleSignals = extractSignals(experienceHighlights, educationHighlights, location, languageSnippets, sectionSnapshots);
    const connectionStatus = detectConnectionStatus(root);

    return profileExtraction.createProfileExtractionResult({
      pageUrl: window.location.href,
      title: document.title,
      identity: {
        profileUrl,
        fullName: name,
        firstName: firstNameFromFullName(name),
        headline,
        location,
        connectionStatus
      },
      about: {
        text: about
      },
      facts: {
        identity: {
          profileUrl,
          fullName: name,
          firstName: firstNameFromFullName(name),
          headline,
          location,
          connectionStatus
        },
        about: {
          text: about
        },
        experience: experienceItems,
        education: educationItems,
        languages: languageItems,
        recentActivity: {
          source: "visible_profile_activity",
          items: activityItems
        },
        visibleSignals
      },
      compatibility: {
        experienceHighlights,
        educationHighlights,
        activitySnippets,
        languageSnippets
      },
      rawSnapshot
    });
  }

  function extractSelfProfile() {
    return extractProfile();
  }

  function buildMyProfileDraft(profile) {
    return {
      manualNotes: "",
      rawSnapshot: profile.rawSnapshot,
      updatedAt: ""
    };
  }

  function findProfileMessageAction() {
    const actionRoot = queryAny([
      ".pv-top-card-v2-ctas",
      ".pvs-profile-actions",
      ".pv-s-profile-actions",
      "main"
    ], document) || document;
    const candidates = Array.from(actionRoot.querySelectorAll("button, a, [role='button']"))
      .filter(isVisible);

    return candidates.find((node) => {
      const text = normalizeWhitespace([
        node.innerText || node.textContent || "",
        node.getAttribute?.("aria-label") || "",
        node.getAttribute?.("data-control-name") || ""
      ].join(" "));
      return Boolean(text) && /\bmessage\b/i.test(text) && !/\bcompose message\b/i.test(text);
    }) || null;
  }

  function hasMessagingOverlaySurface() {
    return Boolean(queryFirst([
      ".msg-overlay-bubble",
      ".msg-overlay-bubble__content",
      ".msg-overlay-conversation-bubble",
      ".msg-overlay-conversation-bubble-header",
      ".msg-overlay-conversation-bubble__content-wrapper",
      "[data-msg-overlay-conversation-bubble-open]",
      "[data-view-name='message-overlay-conversation-bubble-item']",
      ".msg-s-message-list-container",
      ".msg-s-message-list-content",
      ".msg-form__contenteditable",
      ".msg-form__msg-content-container"
    ], document));
  }

  function messagingSurfaceSnapshot() {
    const overlayRoot = queryFirst([
      "[data-view-name='message-overlay-conversation-bubble-item']",
      "[data-msg-overlay-conversation-bubble-open]",
      ".msg-convo-wrapper.msg-overlay-conversation-bubble",
      ".msg-overlay-conversation-bubble--is-active",
      ".msg-overlay-conversation-bubble",
      ".msg-overlay-bubble"
    ], document);
    const messageListRoot = queryFirst([
      ".msg-s-message-list-content",
      ".msg-s-message-list-container",
      ".msg-s-message-list"
    ], overlayRoot || document);
    const eventNodes = Array.from((messageListRoot || overlayRoot || document).querySelectorAll(
      ".msg-s-message-list__event, [data-event-urn], .msg-s-event-listitem"
    ));
    const composerVisible = Boolean(queryFirst([
      ".msg-form__contenteditable",
      ".msg-form__msg-content-container"
    ], overlayRoot || document));
    return {
      href: normalizeWhitespace(window.location.href),
      overlayPresent: Boolean(overlayRoot),
      messageListPresent: Boolean(messageListRoot),
      eventCount: eventNodes.length,
      composerVisible
    };
  }

  async function waitForMessagingSurfaceAfterClick(timeoutMs) {
    const startedAt = nowMs();
    const snapshots = [];

    function captureSnapshot(label) {
      const snapshot = {
        label,
        elapsedMs: roundMs(nowMs() - startedAt),
        ...messagingSurfaceSnapshot()
      };
      snapshots.push(snapshot);
      return snapshot;
    }

    const initial = captureSnapshot("initial");
    if (initial.overlayPresent || initial.messageListPresent || initial.composerVisible) {
      return { snapshot: initial, snapshots };
    }

    return new Promise((resolve) => {
      let resolved = false;
      const finish = (label) => {
        if (resolved) {
          return;
        }
        resolved = true;
        observer.disconnect();
        window.clearTimeout(timerId);
        resolve({
          snapshot: captureSnapshot(label),
          snapshots
        });
      };
      const observer = new MutationObserver(() => {
        const next = captureSnapshot("mutation");
        if (next.overlayPresent || next.messageListPresent || next.composerVisible) {
          finish("detected");
        }
      });
      observer.observe(document.documentElement || document.body || document, {
        childList: true,
        subtree: true,
        attributes: true
      });
      const timerId = window.setTimeout(() => finish("timeout"), timeoutMs);
    });
  }

  function openMessagesFromCurrentProfile() {
    if (!isSupportedProfilePage()) {
      return {
        ok: false,
        error: "Open the recipient's LinkedIn profile before opening messages."
      };
    }
    const action = findProfileMessageAction();
    if (!action) {
      return {
        ok: false,
        error: "Could not find LinkedIn's Message button on this profile."
      };
    }
    action.click();
    return {
      ok: true,
      actionHref: normalizeWhitespace(action.href || action.getAttribute?.("href") || ""),
      actionText: normalizeWhitespace(
        action.getAttribute?.("aria-label")
        || action.innerText
        || action.textContent
        || "Message"
      )
    };
  }

  async function openMessagesFromCurrentProfileAndWait() {
    const clicked = openMessagesFromCurrentProfile();
    if (!clicked?.ok) {
      return clicked;
    }

    const waitResult = await waitForMessagingSurfaceAfterClick(8000);
    const workspaceContext = linkedInCommands.extractWorkspaceContext(buildLinkedInCommandDeps());
    const visibleMessageCount = Array.isArray(workspaceContext?.conversation?.allVisibleMessages)
      ? workspaceContext.conversation.allVisibleMessages.length
      : Array.isArray(workspaceContext?.conversation?.recentMessages)
        ? workspaceContext.conversation.recentMessages.length
        : 0;
    const composeVisible = hasMessagingOverlaySurface();
    const extractedMessaging = workspaceContext?.pageType === "linkedin-messaging";
    const attempts = (waitResult?.snapshots || []).map((snapshot) => ({
      label: snapshot.label,
      elapsedMs: snapshot.elapsedMs,
      href: snapshot.href,
      overlayPresent: snapshot.overlayPresent,
      messageListPresent: snapshot.messageListPresent,
      eventCount: snapshot.eventCount,
      composerVisible: snapshot.composerVisible
    }));
    if (extractedMessaging || composeVisible || waitResult?.snapshot?.eventCount > 0) {
        return {
          ok: true,
          actionHref: clicked.actionHref || "",
          actionText: clicked.actionText,
          surfaceResult: extractedMessaging
            ? (visibleMessageCount > 0 ? "thread_visible" : "messaging_surface_no_messages")
            : (waitResult?.snapshot?.eventCount > 0 || composeVisible ? "compose_overlay_visible" : "no_surface_detected"),
        workspaceContext: extractedMessaging ? workspaceContext : null,
        debug: {
          attempts,
          finalHref: normalizeWhitespace(window.location.href),
          finalComposeVisible: composeVisible,
          finalExtractedPageType: normalizeWhitespace(workspaceContext?.pageType || ""),
          finalVisibleMessageCount: visibleMessageCount,
          finalOverlayPresent: Boolean(waitResult?.snapshot?.overlayPresent),
          finalMessageListPresent: Boolean(waitResult?.snapshot?.messageListPresent),
          finalEventCount: Number(waitResult?.snapshot?.eventCount || 0)
        }
      };
    }

    return {
      ok: true,
      actionHref: clicked.actionHref || "",
      actionText: clicked.actionText,
      surfaceResult: "no_surface_detected",
      workspaceContext: null,
      debug: {
        attempts,
        finalHref: normalizeWhitespace(window.location.href),
        finalComposeVisible: hasMessagingOverlaySurface(),
        finalExtractedPageType: isSupportedMessagingPage() ? "linkedin-messaging" : "linkedin-profile",
        finalVisibleMessageCount: 0,
        finalOverlayPresent: false,
        finalMessageListPresent: false,
        finalEventCount: 0
      }
    };
  }

  function extractOpenMessageBubbleWorkspace() {
    const overlayRoot = queryFirst([
      "[data-view-name='message-overlay-conversation-bubble-item']",
      "[data-msg-overlay-conversation-bubble-open]",
      ".msg-overlay-conversation-bubble",
      ".msg-overlay-bubble",
      ".relative.display-flex.flex-column.flex-grow-1"
    ], document);
    const contentWrapper = queryFirst([
      ".msg-overlay-conversation-bubble__content-wrapper"
    ], overlayRoot || document);
    const messageList = queryFirst([
      ".msg-s-message-list-content",
      ".msg-s-message-list-container",
      ".msg-s-message-list"
    ], contentWrapper || overlayRoot || document);
    const messageNodes = Array.from((contentWrapper || messageList || document).querySelectorAll(
      "[data-event-urn], .msg-s-event-listitem, .msg-s-message-list__event"
    ));
    const header = queryFirst([
      ".msg-overlay-conversation-bubble-header",
      ".msg-overlay-bubble-header"
    ], overlayRoot || document);
    const profileCard = queryFirst([
      ".msg-s-profile-card",
      ".msg-s-profile-card-one-to-one"
    ], overlayRoot || document);
    const profileAnchor = queryFirst([
      "a[href*='/in/']"
    ], header || profileCard || overlayRoot || document);
    const fullName = normalizeWhitespace(
      visibleText(queryFirst([
        ".msg-overlay-bubble-header__title .hoverable-link-text",
        ".msg-overlay-bubble-header__title",
        "h1",
        "h2",
        "h3"
      ], header || overlayRoot))
      || visibleText(queryFirst([
        ".profile-card-one-to-one__profile-link",
        ".artdeco-entity-lockup__title a",
        ".truncate"
      ], profileCard || overlayRoot))
      || profileAnchor?.getAttribute("title")
      || profileAnchor?.getAttribute("aria-label")
      || profileAnchor?.querySelector("img[alt]")?.getAttribute("alt")
    ).replace(/\s+Profile$/i, "");
    const headline = visibleText(queryFirst([
      ".artdeco-entity-lockup__subtitle",
      ".msg-thread__entity-lockup__subtitle",
      ".t-14"
    ], profileCard || header || overlayRoot));
    const profileUrl = normalizeLinkedInProfileUrl(profileAnchor?.href || "") || normalizeWhitespace(profileAnchor?.href || "");
    const connectionStatusText = visibleText(profileCard);

    function inferDatePrefix(label) {
      const now = new Date();
      now.setSeconds(0, 0);
      const normalized = normalizeWhitespace(label).toLowerCase();
      if (!normalized) {
        return "";
      }
      if (normalized === "today") {
        return now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      }
      if (normalized === "yesterday") {
        now.setDate(now.getDate() - 1);
        return now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      }
      const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
      const weekdayIndex = weekdays.indexOf(normalized);
      if (weekdayIndex >= 0) {
        const daysBack = (now.getDay() - weekdayIndex + 7) % 7;
        now.setDate(now.getDate() - daysBack);
        return now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      }
      const parsed = new Date(normalized);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      }
      return normalizeWhitespace(label);
    }

    const chronologicalMessages = messageNodes
      .map((node) => {
        const container = node.closest(".msg-s-message-list__event, li, article") || node.parentElement || node;
        const dateLabel = visibleText(queryFirst([".msg-s-message-list__time-heading"], container));
        const timeText = visibleText(queryFirst([".msg-s-message-group__timestamp"], node))
          || normalizeWhitespace(queryFirst([
            ".msg-s-event-with-indicator__sending-indicator[title]",
            "[data-test-msg-cross-pillar-message-sending-indicator-presenter__container][title]"
          ], node)?.getAttribute("title") || "").replace(/^sent at\s*/i, "");
        const sender = normalizeWhitespace(
          visibleText(queryFirst([".msg-s-message-group__name"], node))
          || node.querySelector("img[alt]")?.getAttribute("alt")
        ).replace(/\s+Profile$/i, "");
        const body = normalizeWhitespace(
          Array.from(node.querySelectorAll(".msg-s-event-listitem__body"))
            .map((element) => element.innerText || element.textContent || "")
            .join("\n\n")
        );
        const attachmentNames = Array.from(node.querySelectorAll(".ui-attachment__filename"))
          .map((element) => normalizeWhitespace(element.innerText || element.textContent || ""))
          .filter(Boolean);
        const text = normalizeWhitespace([body, ...attachmentNames.map((name) => `Attachment: ${name}`)].filter(Boolean).join("\n\n"));
        const timestamp = dateLabel && timeText ? `${inferDatePrefix(dateLabel)} ${timeText}` : timeText;
        return {
          sender,
          text,
          timestamp: normalizeWhitespace(timestamp)
        };
      })
      .filter((entry) => entry.sender && entry.text);

    const latestFirstMessages = chronologicalMessages.slice().reverse();
    const lastEntry = latestFirstMessages[0] || null;
    const connectionStatus = /\b1st\b|\b1st degree connection\b/i.test(connectionStatusText) ? "connected" : "unknown";
    const rawThreadText = chronologicalMessages.map((entry) => `${entry.sender}: ${entry.text}`).join("\n");

    return {
      supported: Boolean(fullName && profileUrl),
      pageType: "linkedin-messaging",
      pageUrl: normalizeLinkedInProfileUrl(window.location.href) || window.location.href,
      title: document.title,
      reason: fullName && profileUrl ? "" : "Loading selected conversation...",
      person: linkedInCommands.buildPersonIdentity({
        firstName: firstNameFromFullName(fullName),
        fullName,
        profileUrl,
        messagingThreadUrl: "",
        headline,
        location: "",
        connectionStatus,
        profileSummary: headline,
        rawSnapshot: normalizeWhitespace([fullName, headline].filter(Boolean).join("\n"))
      }),
      conversation: {
        recipientName: fullName,
        threadUrl: "",
        recentMessages: latestFirstMessages.slice(0, 8),
        allVisibleMessages: latestFirstMessages,
        lastSpeaker: normalizeWhitespace(lastEntry?.sender),
        lastMessageAt: normalizeWhitespace(lastEntry?.timestamp),
        rawThreadText: normalizeWhitespace(rawThreadText)
      },
      debug: {
        bubble_workspace_overlay_present: Boolean(overlayRoot),
        bubble_workspace_content_wrapper_present: Boolean(contentWrapper),
        bubble_workspace_message_list_present: Boolean(messageList),
        bubble_workspace_message_node_count: messageNodes.length,
        bubble_workspace_message_count: latestFirstMessages.length
      }
    };
  }

  function queryAny(selectors, root) {
    for (const selector of selectors) {
      const match = queryVisibleWithin(root || document, selector);
      if (match) {
        return match;
      }
    }
    return null;
  }

  function visibleTextFromSelectors(selectors, root) {
    return visibleText(queryAny(selectors, root));
  }

  function isLikelyMessagingRecipientName(value) {
    const normalized = normalizeWhitespace(value);
    if (!normalized) {
      return false;
    }
    const lower = normalized.toLowerCase();
    if (!/[a-z]/i.test(normalized)) {
      return false;
    }
    if (/^\d+\s+notifications?$/.test(lower)) {
      return false;
    }
    if (/^(notifications?|messaging|messages|compose message|new message|inbox)$/i.test(normalized)) {
      return false;
    }
    if (/[|·]/.test(normalized)) {
      return false;
    }
    if (/\bnotifications?\b/.test(lower) || /\bunread\b/.test(lower)) {
      return false;
    }
    return true;
  }

  function looksLikeMessagingHeadline(value, recipientName) {
    const normalized = normalizeWhitespace(value);
    if (!normalized) {
      return false;
    }
    const lower = normalized.toLowerCase();
    if (recipientName && lower === normalizeWhitespace(recipientName).toLowerCase()) {
      return false;
    }
    if (/^\d+\s+notifications?$/.test(lower)) {
      return false;
    }
    if (/^(messaging|messages|inbox|open .+ profile)$/i.test(normalized)) {
      return false;
    }
    return /[|·]/.test(normalized)
      || /\b(product|manager|leader|director|founder|chief|staff|engineer|designer|recruiter|marketing|sales|strategy|advisor|operator|investor|yale|mba|ms|ai)\b/i.test(normalized);
  }

  function extractMessagingHeaderIdentity(header) {
    if (!header) {
      return { name: "", headline: "" };
    }

    const lines = visibleTextLines(header);
    if (!lines.length) {
      return { name: "", headline: "" };
    }

    const name = lines.find((line) => isLikelyMessagingRecipientName(line)) || "";
    const headline = lines.find((line) => looksLikeMessagingHeadline(line, name)) || "";
    return { name, headline };
  }

  function currentMessagingThreadPath() {
    try {
      const url = new URL(window.location.href);
      return normalizeWhitespace(url.pathname.replace(/\/+$/, ""));
    } catch (_error) {
      return "";
    }
  }

  function findConversationSwitcherForCurrentThread() {
    const currentThreadPath = currentMessagingThreadPath();
    if (!currentThreadPath) {
      return null;
    }
    const anchors = Array.from(document.querySelectorAll(
      "a[href*='/messaging/thread/'], .msg-conversations-container__convo-item-link[href], [data-control-name='view_message_thread'][href]"
    ));
    return anchors.find((anchor) => {
      try {
        const path = new URL(anchor.href, window.location.origin).pathname.replace(/\/+$/, "");
        return path === currentThreadPath;
      } catch (_error) {
        return false;
      }
    }) || null;
  }

  function extractActiveConversationIdentity() {
    const activeItemByThreadUrl = findConversationSwitcherForCurrentThread();

    const activeItem = activeItemByThreadUrl?.closest(".msg-conversation-listitem, li, article, [role='listitem']")
      || activeItemByThreadUrl
      || queryAny([
      ".msg-conversation-listitem--is-active",
      ".msg-conversation-listitem--active",
      ".msg-conversation-listitem[aria-selected='true']",
      ".msg-conversation-listitem[aria-current='true']",
      ".msg-conversations-container__convo-item-link[aria-current='page']",
      "[data-control-name='view_message_thread'][aria-current='page']",
      "a[href*='/messaging/thread/'][aria-current='page']",
      "a[href*='/messaging/'][aria-current='page']"
    ], document);

    if (!activeItem) {
      return null;
    }

    const anchor = queryAny([
      "a[href*='/in/']",
      ".msg-conversation-card__profile-link",
      ".msg-conversation-listitem__link"
    ], activeItem);
    const threadAnchor = queryAny([
      "a[href*='/messaging/']",
      ".msg-conversations-container__convo-item-link",
      "[data-control-name='view_message_thread'][href]"
    ], activeItem);
    const name = visibleTextFromSelectors([
      ".msg-conversation-listitem__participant-names",
      ".msg-conversation-card__participant-names",
      ".msg-conversation-card__participant-name",
      "h3",
      "h4"
    ], activeItem) || visibleText(anchor);
    const headline = visibleTextFromSelectors([
      ".msg-conversation-listitem__secondary-content",
      ".msg-conversation-card__message-snippet-body",
      ".msg-conversation-card__message-snippet"
    ], activeItem);

    return {
      name,
      headline,
      profileUrl: normalizeWhitespace(anchor?.href || ""),
      threadUrl: normalizeWhitespace(threadAnchor?.href || "")
    };
  }

  function inferSenderFromNode(node) {
    const ancestorClassText = Array.from(node?.parents ? node.parents() : [])
      .map((entry) => entry?.className || "")
      .join(" ");
    const labeledAncestor = node?.closest("[aria-label]");
    const label = normalizeWhitespace(
      node?.getAttribute?.("aria-label") ||
      labeledAncestor?.getAttribute?.("aria-label") ||
      ancestorClassText ||
      node?.className ||
      ""
    ).toLowerCase();

    if (/(self|you|me|own|outgoing|from you)/i.test(label)) {
      return "You";
    }
    return "";
  }

  function ancestorClassList(node) {
    const names = [];
    let current = node;
    while (current && current !== document.body) {
      names.push(normalizeWhitespace(current.className));
      current = current.parentElement;
    }
    return names.join(" ").toLowerCase();
  }

  function extractSenderName(node, recipientName) {
    const group = node?.closest(".msg-s-message-group, .msg-s-event-listitem, li, article") || node;
    const senderFromGroup = normalizeWhitespace(
      visibleText(queryAny([
        ".msg-s-message-group__name",
        ".msg-s-event-listitem__name",
        ".msg-s-message-group__profile-link",
        "h3",
        "h4"
      ], group))
    );
    if (senderFromGroup) {
      return senderFromGroup;
    }

    const explicitSelfIndicator = queryAny([
      ".msg-s-event-with-indicator__sending-indicator[title]",
      "[data-test-msg-cross-pillar-message-sending-indicator-presenter__container][title]"
    ], node) || queryAny([
      ".msg-s-event-with-indicator__sending-indicator[title]",
      "[data-test-msg-cross-pillar-message-sending-indicator-presenter__container][title]"
    ], group);
    if (explicitSelfIndicator) {
      return "You";
    }

    const inferred = inferSenderFromNode(group) || inferSenderFromNode(node);
    if (inferred) {
      return inferred;
    }

    const classes = ancestorClassList(node);
    if (/(incoming|recipient)/i.test(classes)) {
      return recipientName || "Unknown";
    }
    if (/(self|you|outgoing)/i.test(classes)) {
      return "You";
    }

    return "";
  }

  function timestampSelectors() {
    return [
      "time",
      ".msg-s-message-group__timestamp",
      ".msg-s-event-listitem__timestamp",
      ".msg-s-message-group__time-stamp",
      ".msg-s-event-with-indicator__sending-indicator",
      "[data-test-msg-cross-pillar-message-sending-indicator-presenter__container]",
      ".msg-s-event-listitem--group-a11y-heading",
      "[data-time]",
      "[data-timestamp]"
    ];
  }

  function normalizeExtractedTimestamp(value) {
    return normalizeWhitespace(value)
      .replace(/^sent at\s+/i, "")
      .replace(/^.+?sent the following messages? at\s+/i, "");
  }

  function timestampCandidateValue(node) {
    if (!node) {
      return "";
    }

    const attributeValue = normalizeExtractedTimestamp(
      node.getAttribute?.("title")
      || node.getAttribute?.("datetime")
      || node.getAttribute?.("aria-label")
      || node.getAttribute?.("data-time")
      || node.getAttribute?.("data-timestamp")
      || ""
    );
    if (attributeValue) {
      return attributeValue;
    }

    return normalizeExtractedTimestamp(visibleText(node));
  }

  function collectTimestampCandidates(scope) {
    if (!scope) {
      return [];
    }
    const selectors = timestampSelectors();
    const direct = selectors
      .map((selector) => {
        try {
          return scope.matches?.(selector) ? scope : null;
        } catch (_error) {
          return null;
        }
      })
      .filter(Boolean);
    const descendants = Array.from(scope.querySelectorAll(selectors.join(",")));
    return Array.from(new Set([...direct, ...descendants])).filter((node) => isVisible(node) || Boolean(timestampCandidateValue(node)));
  }

  function pickNearestTimestampCandidate(node, candidates) {
    if (!node || !candidates.length) {
      return "";
    }

    const nodeRect = node.getBoundingClientRect();
    let bestValue = "";
    let bestScore = Number.POSITIVE_INFINITY;

    candidates.forEach((candidate) => {
      const text = timestampCandidateValue(candidate);
      if (!text) {
        return;
      }
      const rect = candidate.getBoundingClientRect();
      const verticalDistance = Math.abs((rect.top + rect.bottom) / 2 - (nodeRect.top + nodeRect.bottom) / 2);
      const horizontalDistance = Math.abs((rect.left + rect.right) / 2 - (nodeRect.left + nodeRect.right) / 2);
      const hasExplicitDate = /(?:\d{1,2}\/\d{1,2}\/\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},\s*\d{4})/.test(text);
      const score = verticalDistance * 10 + horizontalDistance - (hasExplicitDate ? 1000 : 0);
      if (score < bestScore) {
        bestScore = score;
        bestValue = text;
      }
    });

    return bestValue;
  }

  function extractMessageTimestamp(node, contextNode) {
    const explicitScopes = Array.from(new Set([
      node,
      node?.closest(".msg-s-event-listitem__message-bubble"),
      node?.closest(".msg-s-message-group__message-bubble"),
      node?.closest(".msg-s-event-listitem")
    ].filter(Boolean)));

    for (const scope of explicitScopes) {
      const explicitCandidate = queryAny([
        ".msg-s-event-with-indicator__sending-indicator[title]",
        "[data-test-msg-cross-pillar-message-sending-indicator-presenter__container][title]",
        "time[datetime]"
      ], scope);
      const explicitValue = timestampCandidateValue(explicitCandidate);
      if (explicitValue) {
        return explicitValue;
      }
    }

    const directScopes = Array.from(new Set([
      node,
      node?.closest(".msg-s-message-group__message-bubble"),
      node?.closest(".msg-s-message-group__msg-content"),
      node?.parentElement,
      node?.parentElement?.parentElement
    ].filter(Boolean)));

    for (const scope of directScopes) {
      const directValue = pickNearestTimestampCandidate(scope, collectTimestampCandidates(scope));
      if (directValue) {
        return directValue;
      }
    }

    const contextScopes = Array.from(new Set([
      contextNode,
      contextNode?.closest(".msg-s-message-group__messages"),
      contextNode?.closest(".msg-s-message-group"),
      contextNode?.closest(".msg-s-event-listitem"),
      contextNode?.closest("li[data-event-urn]"),
      contextNode?.closest("div[data-event-urn]"),
      contextNode?.closest("article")
    ].filter(Boolean)));

    for (const scope of contextScopes) {
      const nearbyValue = pickNearestTimestampCandidate(node, collectTimestampCandidates(scope));
      if (nearbyValue) {
        return nearbyValue;
      }
    }

    return "";
  }

  function extractDateDividerLabel(element) {
    const lines = visibleTextLines(element);
    return lines.find((line) => /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|yesterday)$/i.test(line)
      || /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,\s*\d{4})?$/i.test(line)) || "";
  }

  function inferMessageDateLabel(node, conversationRoot) {
    let current = node?.closest(".msg-s-message-group, .msg-s-event-listitem, li[data-event-urn], div[data-event-urn], article") || node;
    const root = conversationRoot || document.body;

    while (current && current !== root && current !== document.body) {
      let sibling = current.previousElementSibling;
      while (sibling) {
        const label = extractDateDividerLabel(sibling);
        if (label) {
          return label;
        }
        sibling = sibling.previousElementSibling;
      }
      current = current.parentElement;
    }

    return "";
  }

  function inferDateFromDivider(label, now) {
    const text = normalizeWhitespace(label);
    if (!text) {
      return null;
    }

    const lower = text.toLowerCase();
    const value = new Date(now);
    value.setSeconds(0, 0);

    if (lower === "today") {
      return value;
    }
    if (lower === "yesterday") {
      value.setDate(value.getDate() - 1);
      return value;
    }

    const weekdayMap = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6
    };
    if (Object.prototype.hasOwnProperty.call(weekdayMap, lower)) {
      const targetDay = weekdayMap[lower];
      const daysBack = (value.getDay() - targetDay + 7) % 7;
      value.setDate(value.getDate() - daysBack);
      return value;
    }

    const direct = new Date(`${text}${/\d{4}/.test(text) ? "" : ` ${value.getFullYear()}`}`);
    if (!Number.isNaN(direct.getTime())) {
      if (!/\d{4}/.test(text) && direct.getTime() > now.getTime() + 86400000) {
        direct.setFullYear(direct.getFullYear() - 1);
      }
      return direct;
    }

    return null;
  }

  function formatAbsoluteMessageTimestamp(timeText, dateLabel) {
    const normalizedTime = normalizeWhitespace(timeText);
    if (!normalizedTime) {
      return "";
    }
    const direct = new Date(normalizedTime);
    if (!Number.isNaN(direct.getTime())) {
      const month = direct.toLocaleString("en-US", { month: "short" });
      const day = direct.getDate();
      const year = direct.getFullYear();
      const time = direct.toLocaleString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
      return `${month} ${day}, ${year} ${time}`;
    }
    if (!/^\d{1,2}:\d{2}\s*(am|pm)$/i.test(normalizedTime)) {
      return normalizedTime;
    }

    const inferredDate = inferDateFromDivider(dateLabel, new Date());
    if (!inferredDate) {
      return normalizedTime;
    }

    const month = inferredDate.toLocaleString("en-US", { month: "short" });
    const day = inferredDate.getDate();
    const year = inferredDate.getFullYear();
    return `${month} ${day}, ${year} ${normalizedTime}`;
  }

  function cleanMessageText(text, recipientName) {
    return String(text || "")
      .replace(new RegExp(`^${recipientName}\\s*`, "i"), "")
      .replace(/view [^\n|.]+? profile/ig, "")
      .replace(/sent the following messages at/ig, "")
      .replace(/\b\d{1,2}:\d{2}\s?(?:am|pm)\b/ig, "")
      .replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b[^\n|]*/ig, "")
      .replace(/\(\s*he\/him\s*\)|\(\s*she\/her\s*\)|\(\s*they\/them\s*\)/ig, "")
      .replace(/\b\d+(?:st|nd|rd|th) degree connection\b/ig, "")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function isConversationNoise(text, recipientName) {
    const normalized = normalizeWhitespace(text).toLowerCase();
    if (!normalized) {
      return true;
    }
    if (recipientName && normalized === normalizeWhitespace(recipientName).toLowerCase()) {
      return true;
    }
    return /^(view .+ profile|message|you|sent at|1st degree connection)$/i.test(normalized)
      || /technology \& product executive|driving digital transformation|strategic advisor/i.test(normalized);
  }

  function extractConversationMessageNodes(conversationRoot) {
    const root = conversationRoot || document;
    const allGroups = Array.from(root.querySelectorAll(
      ".msg-s-message-group, .msg-s-event-listitem, li[data-event-urn], div[data-event-urn], article"
    ));
    const groups = allowHiddenMessagingDomRead()
      ? allGroups
      : allGroups.filter(isVisible);

    const nodes = [];
    const seen = new Set();

    for (const group of groups) {
      const allBubbleNodes = Array.from(group.querySelectorAll(
        ".msg-s-message-group__message-bubble, .msg-s-message-group__msg-content, .msg-s-event-listitem__message-bubble, .msg-s-event-with-indicator"
      ));
      const bubbleNodes = allowHiddenMessagingDomRead()
        ? allBubbleNodes
        : allBubbleNodes.filter(isVisible);

      if (bubbleNodes.length) {
        bubbleNodes.forEach((node) => {
          if (!seen.has(node)) {
            seen.add(node);
            nodes.push({ node, contextNode: group });
          }
        });
        continue;
      }

      if (!seen.has(group)) {
        seen.add(group);
        nodes.push({ node: group, contextNode: group });
      }
    }

    if (nodes.length) {
      return nodes;
    }

    return Array.from(root.querySelectorAll(
      ".msg-s-event-listitem__message-bubble, .msg-s-event-with-indicator, .msg-s-event-listitem__body, .msg-s-message-group__message-bubble, .msg-s-message-group__msg-content, .msg-s-event-listitem, li[data-event-urn], div[data-event-urn], article"
    )).filter((node) => allowHiddenMessagingDomRead() || isVisible(node)).map((node) => ({ node, contextNode: node }));
  }

  function extractMessageBodyText(node) {
    const contentNode = queryAny([
      ".msg-s-event-listitem__body",
      ".msg-s-message-group__message-bubble p",
      ".msg-s-event__content",
      "p"
    ], node);
    return visibleMultilineText(contentNode || node);
  }

  function extractRecentMessagesFromConversation(conversationRoot, recipientName, maxItems) {
    const candidates = extractConversationMessageNodes(conversationRoot);
    const entries = [];

    for (const candidate of candidates) {
      const node = candidate?.node || candidate;
      const contextNode = candidate?.contextNode || node;
      const rawText = extractMessageBodyText(node);
      const text = cleanMessageText(rawText, recipientName);
      if (!text || text.length < 2 || isConversationNoise(text, recipientName)) {
        continue;
      }

      const senderName = extractSenderName(node, recipientName) || "You";
      const dateLabel = inferMessageDateLabel(contextNode, conversationRoot) || inferMessageDateLabel(node, conversationRoot);
      const timestampText = extractMessageTimestamp(node, contextNode);
      const timestamp = formatAbsoluteMessageTimestamp(timestampText, dateLabel);

      const dedupeKey = `${senderName}::${text}`;
      if (entries.some((entry) => `${entry.sender}::${entry.text}` === dedupeKey)) {
        continue;
      }

      entries.push({
        sender: senderName,
        text,
        timestamp
      });
    }

    return entries.slice(-(maxItems || 8)).reverse();
  }

  function messagingDebugSummary(header, detailRoot, conversationRoot, activeConversationIdentity, headerIdentity, recipientAnchor, recipientName, profileUrl, headline, allVisibleMessages) {
    const rawCandidates = Array.from((conversationRoot || document).querySelectorAll(
      ".msg-s-event-listitem__body, .msg-s-message-group__message-bubble, .msg-s-message-group__msg-content, .msg-s-event-listitem, li[data-event-urn], div[data-event-urn], article"
    )).filter(isVisible);
    const profileLinkElements = Array.from((detailRoot || document).querySelectorAll("a[href*='/in/']"))
      .filter(isVisible)
      .map((node) => normalizeWhitespace(node.href))
      .filter(Boolean);
    const uniqueProfileLinks = uniqueStrings(profileLinkElements);
    const currentThreadSwitcher = findConversationSwitcherForCurrentThread();

    return {
      document_ready_state: document.readyState,
      current_thread_path: currentMessagingThreadPath(),
      current_thread_switcher_found: Boolean(currentThreadSwitcher),
      current_thread_switcher_href: normalizeWhitespace(currentThreadSwitcher?.href || ""),
      current_thread_switcher_text: normalizeWhitespace(visibleText(currentThreadSwitcher)),
      header_found: Boolean(header),
      detail_root_found: Boolean(detailRoot),
      conversation_root_found: Boolean(conversationRoot),
      header_text: truncate(visibleText(header || detailRoot), 600),
      detail_root_text: truncate(visibleText(detailRoot), 600),
      active_name: normalizeWhitespace(activeConversationIdentity?.name),
      active_headline: normalizeWhitespace(activeConversationIdentity?.headline),
      active_profile_url: normalizeWhitespace(activeConversationIdentity?.profileUrl),
      active_thread_url: normalizeWhitespace(activeConversationIdentity?.threadUrl),
      header_identity_name: normalizeWhitespace(headerIdentity?.name),
      header_identity_headline: normalizeWhitespace(headerIdentity?.headline),
      recipient_anchor_found: Boolean(recipientAnchor),
      recipient_anchor_text: normalizeWhitespace(visibleText(recipientAnchor)),
      recipient_anchor_url: normalizeWhitespace(recipientAnchor?.href),
      recipient_name_found: Boolean(normalizeWhitespace(recipientName)),
      recipient_name: normalizeWhitespace(recipientName),
      profile_url_found: Boolean(normalizeWhitespace(profileUrl)),
      profile_url: normalizeWhitespace(profileUrl),
      headline_found: Boolean(normalizeWhitespace(headline)),
      headline: normalizeWhitespace(headline),
      visible_profile_link_count: uniqueProfileLinks.length,
      visible_profile_link_element_count: profileLinkElements.length,
      visible_profile_links: uniqueProfileLinks.slice(0, 5),
      visible_message_count: Array.isArray(allVisibleMessages) ? allVisibleMessages.length : 0,
      visible_candidate_count: rawCandidates.length
    };
  }

  function buildLinkedInCommandDeps() {
    return {
      applyPeopleSearchFilters,
      autoScrollProfile,
      buildMyProfileDraft,
      delay,
      expandInlineTextSections,
      detectConnectionStatus,
      extractActiveConversationIdentity,
      extractJobPageContext,
      extractMessagingHeaderIdentity,
      extractOpenMessageBubbleWorkspace,
      extractPeopleSearchContext,
      extractPostPageContext,
      extractProfile,
      extractRecentMessagesFromConversation,
      hidePageActivityOverlay,
      isLinkedInProfileSubpage,
      isLikelyMessagingRecipientName,
      isSupportedJobPage,
      isSupportedMessagingPage,
      isSupportedPeopleSearchPage,
      isSupportedPostPage,
      isSupportedProfilePage,
      messagingDebugSummary,
      mergeDebugInfo,
      nowMs,
      openMessagesFromCurrentProfile,
      openMessagesFromCurrentProfileAndWait,
      queryAny,
      queryFirst,
      roundMs,
      scrollProfileForExtraction,
      scrollProfileToBottomAndWaitForStable,
      showPageActivityOverlay,
      truncate,
      visibleText,
      visibleTextFromSelectors,
      captureVisiblePostDiscussion,
      waitForProfilePageReady,
      waitForStableProfileTopCard
    };
  }

  function getScrollableHeight() {
    const scroller = getScrollContainer();
    const main = getProfileRoot();
    return Math.max(
      scroller?.scrollHeight || 0,
      scroller?.clientHeight || 0,
      document.documentElement?.scrollHeight || 0,
      document.body?.scrollHeight || 0,
      main?.scrollHeight || 0
    );
  }

  function isDocumentScroller(element) {
    return element === document.scrollingElement || element === document.documentElement || element === document.body;
  }

  function isScrollableElement(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    const style = window.getComputedStyle(element);
    const overflowY = style.overflowY || "";
    return /(auto|scroll|overlay)/i.test(overflowY) && element.scrollHeight > element.clientHeight + 120;
  }

  function getScrollContainer() {
    const root = getProfileRoot();
    let current = root;
    while (current && current !== document.body) {
      if (isScrollableElement(current)) {
        return current;
      }
      current = current.parentElement;
    }
    return document.scrollingElement || document.documentElement || document.body;
  }

  function getScrollTop(container) {
    if (isDocumentScroller(container)) {
      return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    }
    return container?.scrollTop || 0;
  }

  function getViewportHeight(container) {
    if (isDocumentScroller(container)) {
      return window.innerHeight || document.documentElement.clientHeight || 0;
    }
    return container?.clientHeight || 0;
  }

  function scrollToPosition(container, top) {
    const nextTop = Math.max(0, top);
    if (container && !isDocumentScroller(container)) {
      if (typeof container.scrollTo === "function") {
        container.scrollTo(0, nextTop);
      } else {
        container.scrollTop = nextTop;
      }
    }
    try {
      if (document.scrollingElement) {
        document.scrollingElement.scrollTop = nextTop;
      }
      document.documentElement.scrollTop = nextTop;
      document.body.scrollTop = nextTop;
      window.scrollTo(0, nextTop);
    } catch (_error) {
      // Ignore scroll write failures and continue with the best available scroller.
    }
  }

  async function scrollInSteps(container, targetTop, options) {
    const maxTop = Math.max(0, targetTop);
    const stepPx = Math.max(320, Number(options?.stepPx) || 0);
    const stepDelayMs = Math.max(80, Number(options?.stepDelayMs) || 0);
    const settleDelayMs = Math.max(0, Number(options?.settleDelayMs) || 0);
    let currentTop = Math.max(0, getScrollTop(container));
    if (Math.abs(maxTop - currentTop) <= 8) {
      if (settleDelayMs > 0) {
        await delay(settleDelayMs);
      }
      return;
    }

    const direction = maxTop > currentTop ? 1 : -1;
    while ((direction > 0 && currentTop < maxTop) || (direction < 0 && currentTop > maxTop)) {
      currentTop = direction > 0
        ? Math.min(maxTop, currentTop + stepPx)
        : Math.max(maxTop, currentTop - stepPx);
      scrollToPosition(container, currentTop);
      await delay(stepDelayMs);
    }

    if (settleDelayMs > 0) {
      await delay(settleDelayMs);
    }
  }

  function hasLoadedCoreSections() {
    return Boolean(
      findSectionByHeading(/^experience$/i) ||
      findSectionByHeading(/^education$/i) ||
      findSectionByHeading(/^skills$/i)
    );
  }

  function profileExtractionSectionKey(heading) {
    const normalizedHeading = normalizeWhitespace(heading);
    if (!normalizedHeading) {
      return "";
    }
    const match = PROFILE_EXTRACTION_SECTION_TARGETS.find((target) => target.pattern.test(normalizedHeading));
    return match ? match.key : "";
  }

  function collectLoadedProfileSectionKeys() {
    return uniqueStrings(
      getProfileSections(getProfileRoot())
        .map((section) => profileExtractionSectionKey(sectionHeadingText(section)))
        .filter(Boolean)
    );
  }

  function normalizeProfileExtractionGoals(goals) {
    if (!Array.isArray(goals) || !goals.length) {
      return [];
    }
    return uniqueStrings(
      goals
        .map((goal) => normalizeWhitespace(goal).toLowerCase())
        .filter((goal) => PROFILE_EXTRACTION_SECTION_TARGETS.some((target) => target.key === goal))
    );
  }

  function collectProfileExtractionProgress() {
    const identity = extractTopCardIdentity(getProfileRoot());
    const loadedSectionKeys = collectLoadedProfileSectionKeys();
    const sectionKeySet = new Set(loadedSectionKeys);
    return {
      hasIdentity: hasCriticalProfileIdentity(identity.name, identity.headline),
      loadedSectionKeys,
      loadedSectionCount: loadedSectionKeys.length,
      hasStructuredCoverage: sectionKeySet.has("about")
        || sectionKeySet.has("experience")
        || sectionKeySet.has("education")
        || sectionKeySet.has("activity")
        || sectionKeySet.has("languages"),
      coreLoaded: hasLoadedCoreSections()
    };
  }

  function shouldStopProfileExtractionScroll(progress, goals, nearBottom, stagnantPasses) {
    const hasExplicitGoals = Array.isArray(goals) && goals.length;
    const goalList = hasExplicitGoals ? goals : ["about", "experience", "education", "activity"];
    const goalSatisfied = goalList.every((goal) => progress.loadedSectionKeys.includes(goal));
    if (goalSatisfied) {
      return true;
    }
    if (hasExplicitGoals) {
      return nearBottom && stagnantPasses >= 3 && progress.hasStructuredCoverage;
    }
    if (nearBottom && progress.coreLoaded && progress.hasStructuredCoverage) {
      return true;
    }
    if (nearBottom && stagnantPasses >= 2 && progress.hasStructuredCoverage) {
      return true;
    }
    return false;
  }

  async function scrollDownTo(targetHeight) {
    const step = Math.max(500, Math.floor(window.innerHeight * 0.75));
    const start = Math.max(0, window.scrollY);
    for (let y = start; y < targetHeight; y += step) {
      window.scrollTo({ top: y, behavior: "auto" });
      await delay(320);
    }
    window.scrollTo({ top: targetHeight, behavior: "auto" });
    await delay(900);
  }

  async function autoScrollProfile() {
    const scroller = getScrollContainer();
    let stablePasses = 0;
    let passes = 0;
    let lastHeight = getScrollableHeight();
    if (!lastHeight) {
      return;
    }

    await scrollInSteps(scroller, 0, {
      stepPx: Math.max(320, Math.floor(getViewportHeight(scroller) * 0.7)),
      stepDelayMs: 90,
      settleDelayMs: 220
    });

    while (passes < 2) {
      passes += 1;
      const viewportHeight = Math.max(400, getViewportHeight(scroller));
      const targetBottom = Math.max(0, lastHeight - Math.floor(viewportHeight * 0.15));
      const step = Math.max(700, Math.floor(viewportHeight * 0.95));

      for (let nextTop = getScrollTop(scroller) + step; nextTop < targetBottom; nextTop += step) {
        await scrollInSteps(scroller, nextTop, {
          stepPx: Math.max(320, Math.floor(viewportHeight * 0.6)),
          stepDelayMs: 90,
          settleDelayMs: 80
        });
      }

      await scrollInSteps(scroller, targetBottom, {
        stepPx: Math.max(320, Math.floor(viewportHeight * 0.6)),
        stepDelayMs: 90,
        settleDelayMs: 220
      });
      await scrollInSteps(scroller, lastHeight, {
        stepPx: Math.max(320, Math.floor(viewportHeight * 0.55)),
        stepDelayMs: 100,
        settleDelayMs: 900
      });

      const nextHeight = getScrollableHeight();
      const coreLoaded = hasLoadedCoreSections();
      if (nextHeight <= lastHeight + 120) {
        stablePasses += 1;
      } else {
        stablePasses = 0;
      }
      lastHeight = nextHeight;
      if (stablePasses >= 2 && coreLoaded) {
        break;
      }
    }

    await scrollInSteps(scroller, 0, {
      stepPx: Math.max(320, Math.floor(getViewportHeight(scroller) * 0.7)),
      stepDelayMs: 85,
      settleDelayMs: 420
    });
  }

  async function scrollProfileForExtraction(options) {
    const scroller = getScrollContainer();
    const startedAtMs = nowMs();
    const viewportHeight = Math.max(400, getViewportHeight(scroller));
    const goals = normalizeProfileExtractionGoals(options?.sectionGoals);
    let lastHeight = getScrollableHeight();
    let progress = collectProfileExtractionProgress();
    let stabilityWaitMs = 0;
    let stabilityChecks = 0;
    let stagnantPasses = 0;
    let stepCount = 0;
    const maxSteps = Math.max(8, Number(options?.maxSteps) || 14);
    const forceInitialScroll = Boolean(options?.forceInitialScroll);

    if (!lastHeight) {
      return {
        scrollMs: 0,
        stabilityWaitMs: 0,
        stabilityChecks: 0,
        stepCount: 0,
        seenSections: []
      };
    }

    if (!progress.hasIdentity && getScrollTop(scroller) > Math.floor(viewportHeight * 0.25)) {
      await scrollInSteps(scroller, 0, {
        stepPx: Math.max(320, Math.floor(viewportHeight * 0.7)),
        stepDelayMs: 85,
        settleDelayMs: 180
      });
      progress = collectProfileExtractionProgress();
      lastHeight = getScrollableHeight();
    }

    while (stepCount < maxSteps) {
      const currentTop = getScrollTop(scroller);
      const currentHeight = getScrollableHeight();
      const bottomTop = Math.max(0, currentHeight - viewportHeight);
      const nearBottom = currentTop >= Math.max(0, bottomTop - Math.floor(viewportHeight * 0.18));

      if ((!forceInitialScroll || stepCount > 0) && shouldStopProfileExtractionScroll(progress, goals, nearBottom, stagnantPasses)) {
        break;
      }

      const nextTop = Math.min(
        bottomTop,
        currentTop + Math.max(560, Math.floor(viewportHeight * 0.88))
      );
      if (nextTop <= currentTop + 8) {
        stagnantPasses += 1;
        if (goals.length && stagnantPasses < 4) {
          const waitStartedAtMs = nowMs();
          await nudgeProfileLazyLoad(scroller);
          stabilityChecks += 1;
          stabilityWaitMs += roundMs(nowMs() - waitStartedAtMs);
          const nextHeight = getScrollableHeight();
          const nextProgress = collectProfileExtractionProgress();
          const sectionGrowth = nextProgress.loadedSectionCount - progress.loadedSectionCount;
          if (nextHeight > lastHeight + 120 || sectionGrowth > 0) {
            stagnantPasses = 0;
          }
          lastHeight = nextHeight;
          progress = nextProgress;
          continue;
        }
        if (stagnantPasses >= 2) {
          break;
        }
        const waitStartedAtMs = nowMs();
        await delay(220);
        stabilityWaitMs += roundMs(nowMs() - waitStartedAtMs);
        continue;
      }

      await scrollInSteps(scroller, nextTop, {
        stepPx: Math.max(320, Math.floor(viewportHeight * 0.6)),
        stepDelayMs: 90,
        settleDelayMs: 180
      });
      stepCount += 1;
      stabilityChecks += 1;
      const waitStartedAtMs = nowMs();
      await delay(220);
      stabilityWaitMs += roundMs(nowMs() - waitStartedAtMs);

      const nextHeight = getScrollableHeight();
      const nextProgress = collectProfileExtractionProgress();
      const sectionGrowth = nextProgress.loadedSectionCount - progress.loadedSectionCount;
      if (nextHeight <= lastHeight + 120 && sectionGrowth <= 0) {
        stagnantPasses += 1;
      } else {
        stagnantPasses = 0;
      }
      lastHeight = nextHeight;
      progress = nextProgress;
    }

    await delay(180);

    return {
      scrollMs: roundMs(nowMs() - startedAtMs),
      stabilityWaitMs,
      stabilityChecks,
      stepCount,
      seenSections: progress.loadedSectionKeys.slice(0, 8)
    };
  }

  async function nudgeProfileLazyLoad(scroller) {
    const delta = Math.max(520, Math.floor(getViewportHeight(scroller) * 0.9));
    const eventOptions = { deltaY: delta, bubbles: true, cancelable: true };
    try {
      window.dispatchEvent(new WheelEvent("wheel", eventOptions));
      document.documentElement?.dispatchEvent(new WheelEvent("wheel", eventOptions));
      document.body?.dispatchEvent(new WheelEvent("wheel", eventOptions));
    } catch (_error) {
      // WheelEvent may be restricted in some execution contexts.
    }
    try {
      if (scroller && !isDocumentScroller(scroller)) {
        scroller.scrollTop = Math.min(scroller.scrollHeight || delta, getScrollTop(scroller) + delta);
      }
      window.scrollBy({ top: delta, left: 0, behavior: "auto" });
    } catch (_error) {
      // Ignore scroll nudges that LinkedIn blocks.
    }
    await delay(480);
  }

  async function scrollProfileToBottomAndWaitForStable() {
    return scrollProfileForExtraction();
  }

  async function expandInlineTextSections() {
    const main = getProfileRoot();
    const profileSections = getProfileSections(main);
    const profileSectionSet = new Set(profileSections);
    const buttons = Array.from(main.querySelectorAll([
      "button",
      "a[role='button']",
      "div[role='button']",
      "span[role='button']",
      ".inline-show-more-text__button",
      ".lt-line-clamp__more"
    ].join(",")))
      .filter(isVisible)
      .filter((button) => {
        const text = normalizeWhitespace(button.innerText || button.textContent || "");
        const ariaLabel = normalizeWhitespace(button.getAttribute("aria-label") || "");
        const combined = normalizeWhitespace(`${text} ${ariaLabel}`);
        if (!combined) {
          return false;
        }
        if (button.closest("article, .feed-shared-update-v2, .update-components-update-v2, .feed-shared-inline-show-more-text")) {
          return false;
        }
        const href = normalizeWhitespace(button.getAttribute("href") || "");
        if (href && !href.startsWith("#") && !/^javascript:/i.test(href)) {
          return false;
        }
        if (/^(message|connect|follow|more actions|open to|share profile|send profile in a message)$/i.test(combined)) {
          return false;
        }
        if (!/(show more|see more|…\s*see more|\.{3}\s*see more|…\s*more|\.{3}\s*more|show more about|see more about|\bmore\b)/i.test(combined)) {
          return false;
        }
        const expanded = button.getAttribute("aria-expanded");
        if (expanded === "true") {
          return false;
        }
        const section = nearestSection(button);
        const heading = sectionHeadingText(section);
        const containingProfileSection = profileSections.find((profileSection) => profileSection?.contains(button)) || null;
        const containingSectionKey = profileExtractionSectionKey(sectionHeadingText(containingProfileSection));
        if (containingSectionKey === "activity" || profileExtractionSectionKey(heading) === "activity") {
          return false;
        }
        const inTopCard = Boolean(button.closest(".pv-top-card, .mt2.relative, .ph5.pb5"));
        const inProfileSection = Boolean(containingProfileSection) || (section ? profileSectionSet.has(section) : false);
        return inTopCard || inProfileSection || (!heading && !button.closest("aside, footer"));
      });

    let clicked = 0;
    for (const button of buttons) {
      try {
        button.scrollIntoView({ block: "center", inline: "nearest" });
        await delay(80);
        button.click();
        clicked += 1;
        await delay(180);
      } catch (_error) {
        // Ignore individual expansion failures and keep extracting what is available.
      }
    }

    if (clicked > 0) {
      await delay(400);
    }
  }

  function currentContextSignature() {
    const extracted = linkedInCommands.extractWorkspaceContext(buildLinkedInCommandDeps());
    const recentMessages = Array.isArray(extracted?.conversation?.recentMessages) ? extracted.conversation.recentMessages : [];
    const lastMessage = recentMessages[0] || null;
    const activeConversationIdentity = isSupportedMessagingPage() ? extractActiveConversationIdentity() : null;
    return JSON.stringify({
      href: window.location.href,
      pageType: extracted?.pageType || "",
      supported: Boolean(extracted?.supported),
      jobId: extracted?.job?.jobId || "",
      jobTitle: extracted?.job?.title || "",
      peopleSearchCount: extracted?.peopleSearch?.resultCount || 0,
      postUrl: extracted?.postDiscussion?.postUrl || "",
      postTextLength: normalizeWhitespace(extracted?.postDiscussion?.postText || "").length,
      postCommentCount: Number(extracted?.postDiscussion?.commentCount || 0),
      personId: extracted?.person?.personId || "",
      profileUrl: extracted?.person?.profileUrl || "",
      fullName: extracted?.person?.fullName || "",
      activeName: normalizeWhitespace(activeConversationIdentity?.name),
      activeProfileUrl: normalizeWhitespace(activeConversationIdentity?.profileUrl),
      activeThreadUrl: normalizeWhitespace(activeConversationIdentity?.threadUrl),
      lastSpeaker: extracted?.conversation?.lastSpeaker || "",
      lastMessageAt: extracted?.conversation?.lastMessageAt || "",
      lastMessageText: lastMessage?.text || "",
      visibleMessageCount: Array.isArray(extracted?.conversation?.allVisibleMessages)
        ? extracted.conversation.allVisibleMessages.length
        : recentMessages.length
    });
  }

  const assistantLifecycleState = {
    active: false,
    observer: null,
    debounceTimer: null,
    managedTimeouts: new Set(),
    lastSignature: "",
    clickHandler: null,
    doubleClickHandler: null,
    popstateHandler: null,
    hashchangeHandler: null,
    originalPushState: null,
    originalReplaceState: null
  };

  function managedSetTimeout(callback, delayMs) {
    const timerId = window.setTimeout(() => {
      assistantLifecycleState.managedTimeouts.delete(timerId);
      callback();
    }, delayMs);
    assistantLifecycleState.managedTimeouts.add(timerId);
    return timerId;
  }

  function clearManagedAssistantTimeouts() {
    assistantLifecycleState.managedTimeouts.forEach((timerId) => window.clearTimeout(timerId));
    assistantLifecycleState.managedTimeouts.clear();
  }

  function notifyContextChangedWhenActive() {
    if (!assistantLifecycleState.active) {
      return;
    }
    chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.PAGE_CONTEXT_CHANGED,
      href: window.location.href
    }).catch(() => {});
  }

  function scheduleAssistantContextCheck() {
    if (!assistantLifecycleState.active) {
      return;
    }
    window.clearTimeout(assistantLifecycleState.debounceTimer);
    assistantLifecycleState.debounceTimer = window.setTimeout(() => {
      assistantLifecycleState.debounceTimer = null;
      const nextSignature = currentContextSignature();
      if (!nextSignature || nextSignature === assistantLifecycleState.lastSignature) {
        return;
      }
      assistantLifecycleState.lastSignature = nextSignature;
      notifyContextChangedWhenActive();
    }, 250);
  }

  function scheduleDetailPaneRefreshBurstWhenActive() {
    if (!assistantLifecycleState.active) {
      return;
    }
    [0, 200, 500, 1000, 1800].forEach((delayMs) => {
      managedSetTimeout(() => {
        if (assistantLifecycleState.active && isSupportedMessagingPage()) {
          scheduleAssistantContextCheck();
        }
      }, delayMs);
    });
  }

  function startContextChangeNotifications() {
    if (assistantLifecycleState.active) {
      return;
    }
    assistantLifecycleState.active = true;
    assistantLifecycleState.lastSignature = currentContextSignature();

    [0, 300, 1000].forEach((delayMs) => {
      managedSetTimeout(() => {
        if (!assistantLifecycleState.active) {
          return;
        }
        assistantLifecycleState.lastSignature = currentContextSignature();
        notifyContextChangedWhenActive();
      }, delayMs);
    });

    assistantLifecycleState.observer = new MutationObserver(() => {
      if (
        isSupportedMessagingPage()
        || isSupportedProfilePage()
        || isLinkedInProfileSubpage()
        || isSupportedJobPage()
        || isSupportedPeopleSearchPage()
        || isSupportedPostPage()
      ) {
        scheduleAssistantContextCheck();
      }
    });

    if (document.body) {
      assistantLifecycleState.observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }

    assistantLifecycleState.clickHandler = (event) => {
      if (!assistantLifecycleState.active) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const clickedAnchor = target.closest("a[href]");
      const clickHref = normalizeWhitespace(clickedAnchor?.href || "");
      const clickText = normalizeWhitespace(visibleText(clickedAnchor || target));
      globalThis.LinkedInAssistantPostExtraction?.rememberPotentialDiscussionClick?.(target);
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.LINKEDIN_CLICK_TRACE,
        href: window.location.href,
        clickHref,
        clickText
      }).catch(() => {});

      if (!isSupportedMessagingPage()) {
        return;
      }

      const clickedConversationSwitcher = target.closest([
        ".msg-conversation-listitem",
        ".msg-conversations-container__convo-item-link",
        "[data-control-name='view_message_thread']",
        "a[href*='/messaging/thread/']"
      ].join(", "));

      if (clickedConversationSwitcher) {
        scheduleDetailPaneRefreshBurstWhenActive();
      }
    };
    document.addEventListener("click", assistantLifecycleState.clickHandler, true);

    assistantLifecycleState.doubleClickHandler = (event) => {
      if (!assistantLifecycleState.active) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      globalThis.LinkedInAssistantPostExtraction?.rememberPotentialPostSelection?.(target);
      if (isSupportedPostPage()) {
        scheduleAssistantContextCheck();
      }
    };
    document.addEventListener("dblclick", assistantLifecycleState.doubleClickHandler, true);

    assistantLifecycleState.popstateHandler = () => {
      scheduleAssistantContextCheck();
    };
    assistantLifecycleState.hashchangeHandler = () => {
      scheduleAssistantContextCheck();
    };
    window.addEventListener("popstate", assistantLifecycleState.popstateHandler);
    window.addEventListener("hashchange", assistantLifecycleState.hashchangeHandler);

    assistantLifecycleState.originalPushState = history.pushState.bind(history);
    history.pushState = function patchedPushState(...args) {
      const result = assistantLifecycleState.originalPushState(...args);
      scheduleAssistantContextCheck();
      return result;
    };

    assistantLifecycleState.originalReplaceState = history.replaceState.bind(history);
    history.replaceState = function patchedReplaceState(...args) {
      const result = assistantLifecycleState.originalReplaceState(...args);
      scheduleAssistantContextCheck();
      return result;
    };
  }

  function stopContextChangeNotifications() {
    if (!assistantLifecycleState.active) {
      return;
    }
    assistantLifecycleState.active = false;
    if (assistantLifecycleState.observer) {
      assistantLifecycleState.observer.disconnect();
      assistantLifecycleState.observer = null;
    }
    window.clearTimeout(assistantLifecycleState.debounceTimer);
    assistantLifecycleState.debounceTimer = null;
    clearManagedAssistantTimeouts();
    if (assistantLifecycleState.clickHandler) {
      document.removeEventListener("click", assistantLifecycleState.clickHandler, true);
      assistantLifecycleState.clickHandler = null;
    }
    if (assistantLifecycleState.doubleClickHandler) {
      document.removeEventListener("dblclick", assistantLifecycleState.doubleClickHandler, true);
      assistantLifecycleState.doubleClickHandler = null;
    }
    if (assistantLifecycleState.popstateHandler) {
      window.removeEventListener("popstate", assistantLifecycleState.popstateHandler);
      assistantLifecycleState.popstateHandler = null;
    }
    if (assistantLifecycleState.hashchangeHandler) {
      window.removeEventListener("hashchange", assistantLifecycleState.hashchangeHandler);
      assistantLifecycleState.hashchangeHandler = null;
    }
    if (assistantLifecycleState.originalPushState) {
      history.pushState = assistantLifecycleState.originalPushState;
      assistantLifecycleState.originalPushState = null;
    }
    if (assistantLifecycleState.originalReplaceState) {
      history.replaceState = assistantLifecycleState.originalReplaceState;
      assistantLifecycleState.originalReplaceState = null;
    }
    hidePageActivityOverlay();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === MESSAGE_TYPES.SET_ASSISTANT_ACTIVE) {
      if (message.active) {
        startContextChangeNotifications();
      } else {
        stopContextChangeNotifications();
      }
      sendResponse({ ok: true, active: Boolean(message.active) });
      return true;
    }
    linkedInCommands.handleMessage(buildLinkedInCommandDeps(), message, sendResponse);
    return true;
  });
})();
