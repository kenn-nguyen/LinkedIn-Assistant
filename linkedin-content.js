(function initLinkedInContent() {
  const shared = globalThis.LinkedInAssistantShared;
  const linkedInCommands = globalThis.LinkedInAssistantLinkedInCommands;
  const { MESSAGE_TYPES, firstNameFromFullName, normalizeLinkedInProfileUrl, normalizeWhitespace, truncate, uniqueStrings } = shared;
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

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
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

  function summarizeListItem(item) {
    const text = visibleText(item);
    if (!text) {
      return "";
    }
    return truncate(text.replace(/\n+/g, " | "), 220);
  }

  function sectionText(section, limit) {
    const text = visibleText(section);
    return text ? truncate(text.replace(/\n+/g, " | "), limit) : "";
  }

  function extractSectionItems(pattern, maxItems) {
    const section = findSectionByHeading(pattern);
    if (!section) {
      return [];
    }
    const items = Array.from(section.querySelectorAll("li"))
      .map(summarizeListItem)
      .filter(Boolean);

    if (items.length) {
      return uniqueStrings(items).slice(0, maxItems);
    }

    const text = visibleText(section);
    if (!text) {
      return [];
    }
    return uniqueStrings(text.split(" | ").map((line) => truncate(line, 220))).slice(0, maxItems);
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

  function extractSignals(experienceHighlights, educationHighlights, location, languageSnippets) {
    const companyPattern = /\b(?:at|@)\s+([A-Z][A-Za-z0-9&.\- ]{1,50})/g;
    const schoolPattern = /\b(?:University|College|School|Institute|MBA|SOM|NUS|Yale)\b[^|,]*/gi;
    const companies = [];
    const schools = [];

    for (const item of experienceHighlights) {
      let match;
      while ((match = companyPattern.exec(item)) !== null) {
        companies.push(match[1]);
      }
    }

    for (const item of educationHighlights) {
      const matches = item.match(schoolPattern) || [];
      schools.push(...matches);
    }

    return {
      companies: uniqueStrings(companies).slice(0, 6),
      schools: uniqueStrings(schools).slice(0, 6),
      locations: uniqueStrings([location]).slice(0, 3),
      languages: uniqueStrings(languageSnippets).slice(0, 6)
    };
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
      return 1200;
    }
    if (/^experience$/i.test(heading)) {
      return 2200;
    }
    return 1400;
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
    const lines = String(text || "")
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

    if (!lines.length) {
      return "";
    }

    return truncate(lines.slice(0, 6).join(" | "), 520);
  }

  function extractActivitySnippets(maxItems, fullName) {
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
    return truncate(uniqueStrings([topCard, ...sectionSnapshots]).join("\n\n"), 22000);
  }

  function buildProfileSummary(profile) {
    const primarySignals = uniqueStrings([
      profile.headline,
      profile.location,
      profile.about,
      ...(Array.isArray(profile.experienceHighlights) ? profile.experienceHighlights.slice(0, 3) : []),
      ...(Array.isArray(profile.educationHighlights) ? profile.educationHighlights.slice(0, 2) : [])
    ]);

    if (primarySignals.length) {
      return primarySignals.slice(0, 6).join("\n");
    }

    return uniqueStrings([
      profile.headline,
      profile.location,
      ...(Array.isArray(profile.activitySnippets) ? profile.activitySnippets.slice(0, 2) : []),
      ...(Array.isArray(profile.languageSnippets) ? profile.languageSnippets.slice(0, 2) : [])
    ]).slice(0, 4).join("\n");
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
    const headline = visibleText(
      queryVisibleWithin(topCard, ".text-body-medium.break-words") ||
      queryVisibleWithin(profileColumn, ".text-body-medium.break-words") ||
      queryVisibleWithin(profileColumn, ".pv-text-details__left-panel .text-body-medium")
    ) || topCardIdentity.headline || extractHeadlineNearHeading(profileColumn);
    const location = visibleText(
      queryVisibleWithin(topCard, ".text-body-small.inline.t-black--light.break-words") ||
      queryVisibleWithin(profileColumn, ".text-body-small.inline.t-black--light.break-words") ||
      queryVisibleWithin(profileColumn, ".pv-text-details__left-panel .text-body-small")
    ) || topCardIdentity.location;
    const about = extractSectionParagraph(/^about$/i, 1200);
    const experienceHighlights = extractSectionItems(/^experience$/i, 4);
    const educationHighlights = extractSectionItems(/^education$/i, 4);
    const activitySnippets = extractActivitySnippets(4, name);
    const languageSnippets = extractSectionItems(/^languages?$/i, 4);
    const sectionSnapshots = extractSectionSnapshots();
    const rawSnapshot = extractRawSnapshot(sectionSnapshots);
    const visibleSignals = extractSignals(experienceHighlights, educationHighlights, location, languageSnippets);
    const connectionStatus = detectConnectionStatus(root);
    const profileSummary = buildProfileSummary({
      headline,
      location,
      about,
      experienceHighlights,
      educationHighlights,
      activitySnippets,
      languageSnippets
    });

    const hasImmediateProfileSignals = hasCriticalProfileIdentity(name, headline);

    return {
      supported: hasImmediateProfileSignals,
      pageType: "linkedin-profile",
      pageUrl: window.location.href,
      title: document.title,
      reason: hasImmediateProfileSignals ? "" : "Loading profile...",
      profile: {
        firstName: firstNameFromFullName(name),
        fullName: name,
        profileUrl: normalizeLinkedInProfileUrl(window.location.href) || window.location.href,
        headline,
        profileSummary,
        about,
        location,
        connectionStatus,
        experienceHighlights,
        educationHighlights,
        activitySnippets,
        languageSnippets,
        visibleSignals,
        rawSnapshot
      }
    };
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
      autoScrollProfile,
      buildMyProfileDraft,
      delay,
      expandInlineTextSections,
      detectConnectionStatus,
      extractActiveConversationIdentity,
      extractMessagingHeaderIdentity,
      extractOpenMessageBubbleWorkspace,
      extractProfile,
      extractRecentMessagesFromConversation,
      hidePageActivityOverlay,
      isLinkedInProfileSubpage,
      isLikelyMessagingRecipientName,
      isSupportedMessagingPage,
      isSupportedProfilePage,
      messagingDebugSummary,
      mergeDebugInfo,
      nowMs,
      openMessagesFromCurrentProfile,
      openMessagesFromCurrentProfileAndWait,
      queryAny,
      queryFirst,
      roundMs,
      scrollProfileToBottomAndWaitForStable,
      showPageActivityOverlay,
      truncate,
      visibleText,
      visibleTextFromSelectors,
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

  async function scrollProfileToBottomAndWaitForStable() {
    const scroller = getScrollContainer();
    const startedAtMs = nowMs();
    const viewportHeight = Math.max(400, getViewportHeight(scroller));
    let lastHeight = getScrollableHeight();
    let stabilityWaitMs = 0;
    let stabilityChecks = 0;
    let stablePasses = 0;

    if (!lastHeight) {
      return {
        scrollMs: 0,
        stabilityWaitMs: 0,
        stabilityChecks: 0
      };
    }

    await scrollInSteps(scroller, 0, {
      stepPx: Math.max(320, Math.floor(viewportHeight * 0.7)),
      stepDelayMs: 85,
      settleDelayMs: 80
    });
    await scrollInSteps(scroller, lastHeight, {
      stepPx: Math.max(320, Math.floor(viewportHeight * 0.6)),
      stepDelayMs: 90,
      settleDelayMs: 260
    });

    while (stabilityChecks < 3) {
      stabilityChecks += 1;
      const waitStartedAtMs = nowMs();
      await delay(500);
      stabilityWaitMs += roundMs(nowMs() - waitStartedAtMs);

      const nextHeight = getScrollableHeight();
      const targetBottom = Math.max(0, nextHeight - Math.floor(viewportHeight * 0.1));
      await scrollInSteps(scroller, targetBottom, {
        stepPx: Math.max(320, Math.floor(viewportHeight * 0.55)),
        stepDelayMs: 85,
        settleDelayMs: 80
      });

      const coreLoaded = hasLoadedCoreSections();
      if (nextHeight <= lastHeight + 120) {
        stablePasses += 1;
      } else {
        stablePasses = 0;
      }
      lastHeight = nextHeight;

      if (stablePasses >= 1 && coreLoaded) {
        break;
      }
    }

    await scrollInSteps(scroller, 0, {
      stepPx: Math.max(320, Math.floor(viewportHeight * 0.7)),
      stepDelayMs: 85,
      settleDelayMs: 120
    });

    return {
      scrollMs: roundMs(nowMs() - startedAtMs),
      stabilityWaitMs,
      stabilityChecks
    };
  }

  async function expandInlineTextSections() {
    const main = getProfileRoot();
    const profileSections = new Set(getProfileSections(main));
    const buttons = Array.from(main.querySelectorAll("button, a[role='button'], div[role='button'], span[role='button']"))
      .filter(isVisible)
      .filter((button) => {
        const text = normalizeWhitespace(button.innerText || button.textContent || "");
        const ariaLabel = normalizeWhitespace(button.getAttribute("aria-label") || "");
        const combined = normalizeWhitespace(`${text} ${ariaLabel}`);
        if (!combined) {
          return false;
        }
        if (/^(message|connect|follow|more actions|open to|share profile|send profile in a message)$/i.test(combined)) {
          return false;
        }
        if (!/(show more|see more|…\s*see more|\.{3}\s*see more|…\s*more|\.{3}\s*more|show more about|see more about)/i.test(combined)) {
          return false;
        }
        const controls = button.getAttribute("aria-controls") || "";
        const expanded = button.getAttribute("aria-expanded");
        const section = nearestSection(button);
        const heading = sectionHeadingText(section);
        const inTopCard = Boolean(button.closest(".pv-top-card, .mt2.relative, .ph5.pb5"));
        const inProfileSection = section ? profileSections.has(section) : false;
        return (Boolean(controls) || expanded === "false") && (inTopCard || inProfileSection || (!heading && !button.closest("aside, footer")));
      });

    let clicked = 0;
    for (const button of buttons) {
      try {
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

  function setupContextChangeNotifications() {
    if (window.__linkedinAssistantContextObserverInstalled) {
      return;
    }
    window.__linkedinAssistantContextObserverInstalled = true;

    let lastSignature = "";
    let debounceTimer = null;

    const notifyContextChanged = () => {
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.PAGE_CONTEXT_CHANGED,
        href: window.location.href
      }).catch(() => {});
    };

    const checkForContextChange = () => {
      debounceTimer = null;
      const nextSignature = currentContextSignature();
      if (!nextSignature || nextSignature === lastSignature) {
        return;
      }
      lastSignature = nextSignature;
      notifyContextChanged();
    };

    const scheduleCheck = () => {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(checkForContextChange, 250);
    };

    const scheduleDetailPaneRefreshBurst = () => {
      [0, 200, 500, 1000, 1800].forEach((delayMs) => {
        window.setTimeout(() => {
          if (isSupportedMessagingPage()) {
            scheduleCheck();
          }
        }, delayMs);
      });
    };

    lastSignature = currentContextSignature();
    [0, 300, 1000].forEach((delayMs) => {
      window.setTimeout(() => {
        lastSignature = currentContextSignature();
        notifyContextChanged();
      }, delayMs);
    });

    const observer = new MutationObserver(() => {
      if (isSupportedMessagingPage() || isSupportedProfilePage() || isLinkedInProfileSubpage()) {
        scheduleCheck();
      }
    });

    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }

    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const clickedAnchor = target.closest("a[href]");
      const clickHref = normalizeWhitespace(clickedAnchor?.href || "");
      const clickText = normalizeWhitespace(visibleText(clickedAnchor || target));
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
        scheduleDetailPaneRefreshBurst();
      }
    }, true);

    window.addEventListener("popstate", scheduleCheck);
    window.addEventListener("hashchange", scheduleCheck);

    const originalPushState = history.pushState.bind(history);
    history.pushState = function patchedPushState(...args) {
      const result = originalPushState(...args);
      scheduleCheck();
      return result;
    };

    const originalReplaceState = history.replaceState.bind(history);
    history.replaceState = function patchedReplaceState(...args) {
      const result = originalReplaceState(...args);
      scheduleCheck();
      return result;
    };
  }

  setupContextChangeNotifications();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    linkedInCommands.handleMessage(buildLinkedInCommandDeps(), message, sendResponse);
    return true;
  });
})();
