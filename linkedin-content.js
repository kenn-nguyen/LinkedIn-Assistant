(function initLinkedInContent() {
  const shared = globalThis.LinkedInAssistantShared;
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

  function queryVisible(selector) {
    return Array.from(document.querySelectorAll(selector)).find(isVisible) || null;
  }

  function visibleElements(selector, root) {
    return Array.from((root || document).querySelectorAll(selector)).filter(isVisible);
  }

  function queryVisibleWithin(root, selector) {
    return Array.from((root || document).querySelectorAll(selector)).find(isVisible) || null;
  }

  function visibleText(element) {
    if (!element || !isVisible(element)) {
      return "";
    }
    return normalizeWhitespace(element.innerText || element.textContent || "");
  }

  function visibleMultilineText(element) {
    if (!element || !isVisible(element)) {
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
    ], main));
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
    const topCardSnapshot = extractTopCardSnapshot(profileColumn);
    const activitySnippets = extractActivitySnippets(3, name);
    const sectionSnapshots = getProfileSections(profileColumn)
      .map((section) => {
        const heading = sectionHeadingText(section);
        if (!heading) {
          return "";
        }
        if (/^(activity|featured|posts?)$/i.test(heading)) {
          const items = activitySnippets;
          return items.length ? `Activity: ${items.join(" | ")}` : "";
        }
        const body = sectionText(section, sectionSnapshotLimit(heading));
        return body ? `${heading}: ${body}` : "";
      })
      .filter(Boolean);
    const rawSnapshot = truncate(uniqueStrings([
      topCardSnapshot,
      ...sectionSnapshots
    ]).join("\n\n"), 18000);
    const connectionStatus = detectConnectionStatus(root);
    const profileSummary = buildProfileSummary({
      headline,
      location,
      about: "",
      experienceHighlights: [],
      educationHighlights: [],
      activitySnippets: [],
      languageSnippets: []
    });

    return {
      supported: Boolean(rawSnapshot && rawSnapshot.length > 120),
      pageType: "linkedin-profile",
      pageUrl: window.location.href,
      title: document.title,
      reason: rawSnapshot && rawSnapshot.length > 120 ? "" : "Loading profile...",
      profile: {
        firstName: firstNameFromFullName(name),
        fullName: name,
        profileUrl: normalizeLinkedInProfileUrl(window.location.href) || window.location.href,
        headline,
        profileSummary,
        about: "",
        location,
        connectionStatus,
        experienceHighlights: [],
        educationHighlights: [],
        activitySnippets: [],
        languageSnippets: [],
        visibleSignals: {
          companies: [],
          schools: [],
          locations: uniqueStrings([location]).slice(0, 3),
          languages: []
        },
        rawSnapshot
      }
    };
  }

  function buildMyProfileDraft(profile) {
    return {
      manualNotes: "",
      rawSnapshot: profile.rawSnapshot,
      updatedAt: ""
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
    const groups = Array.from(root.querySelectorAll(
      ".msg-s-message-group, .msg-s-event-listitem, li[data-event-urn], div[data-event-urn], article"
    )).filter(isVisible);

    const nodes = [];
    const seen = new Set();

    for (const group of groups) {
      const bubbleNodes = Array.from(group.querySelectorAll(
        ".msg-s-message-group__message-bubble, .msg-s-message-group__msg-content, .msg-s-event-listitem__message-bubble, .msg-s-event-with-indicator"
      )).filter(isVisible);

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
    )).filter(isVisible).map((node) => ({ node, contextNode: node }));
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

  function extractMessagingContext() {
    if (!isSupportedMessagingPage()) {
      return {
        supported: false,
        pageType: "unsupported",
        pageUrl: window.location.href,
        title: document.title
      };
    }

    const messagingRoot = document.querySelector("main") || document;
    const detailRoot = queryAny([
      ".scaffold-layout__detail .msg-convo-wrapper",
      ".scaffold-layout__detail .msg-thread.msg-thread--pillar",
      ".scaffold-layout__detail .msg-thread",
      ".scaffold-layout__detail"
    ], messagingRoot) || messagingRoot;
    const header = queryAny([
      ".msg-title-bar",
      ".shared-title-bar",
      ".msg-thread__thread-top-card",
      ".msg-thread__thread-header",
      ".msg-thread__topcard",
      ".msg-overlay-bubble-header",
      ".msg-conversations-container__convo-details",
      ".msg-thread-bubble-header"
    ], detailRoot);
    const conversationRoot = queryAny([
      ".msg-s-message-list-container",
      ".msg-s-message-list",
      ".msg-thread__content",
      ".msg-thread__messages-container",
      ".msg-thread",
      ".msg-overlay-bubble__content"
    ], detailRoot) || detailRoot;
    const activeConversationIdentity = extractActiveConversationIdentity();
    const headerIdentity = extractMessagingHeaderIdentity(header);
    const recipientAnchor = queryAny([
      ".msg-thread__link-to-profile",
      ".msg-title-bar .msg-thread__link-to-profile",
      ".msg-entity-lockup a[href*='/in/']",
      "a[href*='/in/']",
      ".msg-thread__topcard-link",
      "[data-control-name='view_profile']"
    ], header || detailRoot);
    const headerRecipientName = visibleTextFromSelectors([
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
      visibleText(recipientAnchor),
      headerRecipientName
    ].find((value) => isLikelyMessagingRecipientName(value)) || "";
    const headline = visibleTextFromSelectors([
      ".msg-entity-lockup__entity-info",
      ".msg-entity-lockup__presence-status",
      ".msg-thread__entity-lockup__subtitle",
      ".msg-thread__topcard-subtitle",
      ".artdeco-entity-lockup__subtitle",
      ".t-14"
    ], header || detailRoot) || normalizeWhitespace(headerIdentity?.headline) || normalizeWhitespace(activeConversationIdentity?.headline);
    const profileUrl = normalizeWhitespace(recipientAnchor?.href || activeConversationIdentity?.profileUrl || "");
    const messagingThreadUrl = normalizeWhitespace(activeConversationIdentity?.threadUrl || window.location.href);
    const profileCard = queryAny([
      ".msg-s-profile-card",
      ".msg-thread__thread-top-card",
      ".msg-thread__topcard",
      ".msg-title-bar"
    ], detailRoot) || header || detailRoot;
    const allVisibleMessages = extractRecentMessagesFromConversation(conversationRoot, recipientName, 20);
    const recentMessages = allVisibleMessages.slice(0, 8);
    const lastEntry = recentMessages[0] || null;
    const rawThreadText = truncate(
      allVisibleMessages.length
        ? allVisibleMessages.map((entry) => `${entry.sender}: ${entry.text}`).join("\n")
        : visibleText(conversationRoot),
      7000
    );
    const firstName = firstNameFromFullName(recipientName);
    const personId = shared.personIdFromProfileUrl(profileUrl, recipientName);
    const connectionStatus = detectConnectionStatus(header || document);
    const hasCriticalMessagingIdentity = Boolean(normalizeWhitespace(recipientName) && normalizeWhitespace(profileUrl));
    const recipientSnapshot = truncate(uniqueStrings([
      recipientName,
      headline
    ]).join("\n"), 1000);

    return {
      supported: hasCriticalMessagingIdentity,
      pageType: "linkedin-messaging",
      pageUrl: window.location.href,
      title: document.title,
      reason: hasCriticalMessagingIdentity ? "" : "Loading selected conversation...",
      debug: messagingDebugSummary(
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
      person: {
        personId,
        firstName,
        fullName: recipientName,
        profileUrl,
        messagingThreadUrl,
        headline,
        location: "",
        connectionStatus,
        profileSummary: truncate(uniqueStrings([headline]).join(" | "), 600),
        rawSnapshot: recipientSnapshot || truncate(visibleText(profileCard), 1000)
      },
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

  function extractWorkspaceContext() {
    if (isSupportedProfilePage()) {
      const extracted = extractProfile();
      const extractedPerson = extracted.profile
        ? {
          personId: shared.personIdFromProfileUrl(extracted.profile.profileUrl, extracted.profile.fullName),
          firstName: extracted.profile.firstName,
          fullName: extracted.profile.fullName,
          profileUrl: extracted.profile.profileUrl,
          headline: extracted.profile.headline,
          location: extracted.profile.location,
          connectionStatus: extracted.profile.connectionStatus,
          profileSummary: extracted.profile.profileSummary,
          rawSnapshot: extracted.profile.rawSnapshot
        }
        : null;
      return {
        supported: extracted.supported,
        pageType: extracted.pageType,
        pageUrl: extracted.pageUrl,
        title: extracted.title,
        person: extractedPerson,
        profile: extracted.profile || null,
        conversation: null,
        debug: {
          page_kind: "profile",
          person_found: Boolean(extracted.profile?.fullName),
          connection_status: extracted.profile?.connectionStatus || ""
        }
      };
    }

    if (isSupportedMessagingPage()) {
      const messaging = extractMessagingContext();
      return {
        ...messaging,
        profile: messaging.person || null
      };
    }

    return {
      supported: false,
      pageType: "unsupported",
      pageUrl: window.location.href,
      title: document.title
    };
  }

  async function extractProfileWithRetries(options) {
    const lightweight = Boolean(options?.lightweight);
    const attempts = lightweight ? 2 : 3;
    const startedAtMs = nowMs();
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
      profile_total_ms: 0
    };
    let latest = null;
    let stepStartedAtMs = nowMs();
    latest = extractProfile();
    timing.profile_initial_extract_ms = roundMs(nowMs() - stepStartedAtMs);
    if (latest?.supported && normalizeWhitespace(latest?.profile?.fullName) && normalizeWhitespace(latest?.profile?.headline)) {
      timing.profile_fast_path = true;
      timing.profile_total_ms = roundMs(nowMs() - startedAtMs);
      return mergeDebugInfo(latest, timing);
    }

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      timing.profile_attempts_completed = attempt;
      stepStartedAtMs = nowMs();
      await waitForProfilePageReady(lightweight ? 3 : 6);
      timing.profile_wait_ready_ms += roundMs(nowMs() - stepStartedAtMs);
      stepStartedAtMs = nowMs();
      await waitForStableProfileTopCard(lightweight ? 2 : 4);
      timing.profile_wait_stable_ms += roundMs(nowMs() - stepStartedAtMs);
      if (!lightweight) {
        stepStartedAtMs = nowMs();
        await autoScrollProfile();
        await autoScrollProfile();
        timing.profile_auto_scroll_ms += roundMs(nowMs() - stepStartedAtMs);
        stepStartedAtMs = nowMs();
        await expandInlineTextSections();
        await expandInlineTextSections();
        timing.profile_expand_inline_ms += roundMs(nowMs() - stepStartedAtMs);
      }
      stepStartedAtMs = nowMs();
      latest = extractProfile();
      timing.profile_extract_ms += roundMs(nowMs() - stepStartedAtMs);
      if (latest?.supported && normalizeWhitespace(latest?.profile?.fullName) && normalizeWhitespace(latest?.profile?.headline)) {
        timing.profile_total_ms = roundMs(nowMs() - startedAtMs);
        return mergeDebugInfo(latest, timing);
      }
      if (attempt < attempts) {
        await delay(lightweight ? 140 * attempt : 220 * attempt);
      }
    }
    timing.profile_total_ms = roundMs(nowMs() - startedAtMs);
    return mergeDebugInfo(latest || extractProfile(), timing);
  }

  async function extractSelfProfileWithRetries() {
    const warmupAttempts = 8;
    let latest = null;
    for (let attempt = 1; attempt <= warmupAttempts; attempt += 1) {
      latest = extractSelfProfile();
      if (latest?.supported && normalizeWhitespace(latest?.profile?.rawSnapshot)) {
        break;
      }
      if (attempt < warmupAttempts) {
        await delay(250 * attempt);
      }
    }

    await autoScrollProfile();
    await expandInlineTextSections();
    await autoScrollProfile();
    await expandInlineTextSections();

    const fullExtract = extractSelfProfile();
    if (fullExtract?.supported && normalizeWhitespace(fullExtract?.profile?.rawSnapshot)) {
      return fullExtract;
    }

    return latest || extractSelfProfile();
  }

  async function extractRecipientProfileWithFullRetries() {
    const extracted = await extractSelfProfileWithRetries();
    return mergeDebugInfo(extracted, {
      ...(extracted?.debug || {}),
      profile_timing_mode: "sender_equivalent_full"
    });
  }

  async function extractMessagingContextWithRetries() {
    let latest = extractWorkspaceContext();
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
      await delay(delayMs);
      latest = extractWorkspaceContext();
    }

    return latest;
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
    if (isDocumentScroller(container)) {
      window.scrollTo(0, Math.max(0, top));
      return;
    }
    if (container && typeof container.scrollTo === "function") {
      container.scrollTo(0, Math.max(0, top));
      return;
    }
    if (container) {
      container.scrollTop = Math.max(0, top);
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
    const extracted = extractWorkspaceContext();
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
    (async () => {
      try {
        if (message.type === MESSAGE_TYPES.GET_PAGE_CONTEXT) {
          const extracted = isSupportedMessagingPage()
            ? await extractMessagingContextWithRetries()
            : isSupportedProfilePage()
              ? await extractProfileWithRetries({ lightweight: true })
              : extractWorkspaceContext();
          const unsupportedReason = isLinkedInProfileSubpage()
            ? "Open the main LinkedIn profile page, not an activity or details subpage."
            : !isSupportedProfilePage() && !isSupportedMessagingPage()
              ? "Open a LinkedIn profile or 1:1 messaging thread."
              : undefined;
          const extractedPerson = extracted?.profile
            ? {
              personId: shared.personIdFromProfileUrl(extracted.profile.profileUrl, extracted.profile.fullName),
              firstName: extracted.profile.firstName,
              fullName: extracted.profile.fullName,
              profileUrl: extracted.profile.profileUrl,
              headline: extracted.profile.headline,
              location: extracted.profile.location,
              connectionStatus: extracted.profile.connectionStatus,
              profileSummary: extracted.profile.profileSummary,
              rawSnapshot: extracted.profile.rawSnapshot
            }
            : null;
          sendResponse({
            ok: true,
            supported: extracted.supported,
            pageType: extracted.pageType,
            pageUrl: extracted.pageUrl,
            title: extracted.title,
            person: extracted.person || extractedPerson || null,
            profile: extracted.profile || null,
            conversation: extracted.conversation || null,
            debug: extracted.debug || null,
            reason: extracted.supported ? undefined : (extracted.reason || unsupportedReason)
          });
          return;
        }

        if (message.type === MESSAGE_TYPES.SHOW_PAGE_ACTIVITY_OVERLAY) {
          showPageActivityOverlay(message.title, message.message, message.autoHideMs);
          sendResponse({ ok: true });
          return;
        }

        if (message.type === MESSAGE_TYPES.HIDE_PAGE_ACTIVITY_OVERLAY) {
          hidePageActivityOverlay();
          sendResponse({ ok: true });
          return;
        }

        if (message.type === MESSAGE_TYPES.EXTRACT_WORKSPACE_CONTEXT) {
          const workspaceStartedAtMs = nowMs();
          if (isSupportedProfilePage()) {
            const extracted = await extractRecipientProfileWithFullRetries();
            const extractedPerson = extracted?.profile
              ? {
                personId: shared.personIdFromProfileUrl(extracted.profile.profileUrl, extracted.profile.fullName),
                firstName: extracted.profile.firstName,
                fullName: extracted.profile.fullName,
                profileUrl: extracted.profile.profileUrl,
                headline: extracted.profile.headline,
                location: extracted.profile.location,
                connectionStatus: extracted.profile.connectionStatus,
                profileSummary: extracted.profile.profileSummary,
                rawSnapshot: extracted.profile.rawSnapshot
              }
              : null;
            sendResponse({
              ok: true,
              supported: extracted.supported,
              pageType: extracted.pageType,
              pageUrl: extracted.pageUrl,
              title: extracted.title,
              person: extractedPerson,
              profile: extracted.profile || null,
              conversation: null,
              debug: {
                ...(extracted.debug || {}),
                page_kind: "profile",
                person_found: Boolean(extracted.profile?.fullName),
                connection_status: extracted.profile?.connectionStatus || "",
                workspace_context_total_ms: roundMs(nowMs() - workspaceStartedAtMs),
                workspace_context_scroll_mode: "sender_equivalent_full",
                workspace_context_extract_ms: roundMs(extracted.debug?.profile_extract_ms || 0)
              }
            });
            return;
          }

          const workspaceTiming = {
            workspace_context_total_ms: 0,
            workspace_context_scroll_mode: "none",
            workspace_context_scroll_pass_1_ms: 0,
            workspace_context_expand_pass_1_ms: 0,
            workspace_context_scroll_pass_2_ms: 0,
            workspace_context_expand_pass_2_ms: 0,
            workspace_context_scroll_stability_wait_ms: 0,
            workspace_context_scroll_stability_checks: 0,
            workspace_context_extract_ms: 0
          };
          const extractStartedAtMs = nowMs();
          const extracted = extractWorkspaceContext();
          workspaceTiming.workspace_context_extract_ms = roundMs(nowMs() - extractStartedAtMs);
          workspaceTiming.workspace_context_total_ms = roundMs(nowMs() - workspaceStartedAtMs);
          if (!extracted.supported) {
            sendResponse({ ok: false, error: "This LinkedIn page is not supported yet." });
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

        if (message.type === MESSAGE_TYPES.EXTRACT_RECIPIENT) {
          const extracted = await extractRecipientProfileWithFullRetries();
          if (!extracted.supported) {
            sendResponse({ ok: false, error: "This page is not a supported LinkedIn profile." });
            return;
          }
          sendResponse({ ok: true, profile: extracted.profile });
          return;
        }

        if (message.type === MESSAGE_TYPES.EXTRACT_SELF_PROFILE) {
          const extracted = await extractSelfProfileWithRetries();
          if (!extracted.supported) {
            sendResponse({ ok: false, error: "This page is not a supported LinkedIn profile." });
            return;
          }
          sendResponse({ ok: true, draft: buildMyProfileDraft(extracted.profile), profile: extracted.profile });
          return;
        }
      } catch (error) {
        sendResponse({ ok: false, error: error.message || String(error) });
      }
    })();
    return true;
  });
})();
