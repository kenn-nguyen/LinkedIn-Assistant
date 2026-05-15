(function initLinkedInPeopleSearchExtraction() {
  const shared = globalThis.LinkedInAssistantShared || {};
  const normalizeWhitespace = shared.normalizeWhitespace || ((value) => String(value || "").replace(/\s+/g, " ").trim());
  const normalizeLinkedInProfileUrl = shared.normalizeLinkedInProfileUrl || ((value) => {
    const raw = normalizeWhitespace(value || "");
    if (!raw) {
      return "";
    }
    try {
      const parsed = new URL(raw, window.location.origin);
      const match = parsed.pathname.match(/^\/in\/([^/?#]+)\/?/i);
      return match ? `${parsed.origin}/in/${match[1]}/` : raw;
    } catch (_error) {
      return raw;
    }
  });

  function uniqueStrings(values) {
    const seen = new Set();
    const result = [];
    for (const value of values) {
      const normalized = normalizeWhitespace(value);
      const key = normalized.toLowerCase();
      if (!normalized || seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(normalized);
    }
    return result;
  }

  function absoluteUrl(href) {
    const raw = normalizeWhitespace(href || "");
    if (!raw) {
      return "";
    }
    try {
      return new URL(raw, window.location.origin).href;
    } catch (_error) {
      return raw;
    }
  }

  function isSupportedPeopleSearchPage() {
    return window.location.hostname.includes("linkedin.com")
      && /^\/search\/results\/people\/?$/i.test(window.location.pathname);
  }

  function profileUrlFromHref(href) {
    const normalized = absoluteUrl(href);
    if (!normalized) {
      return "";
    }
    try {
      const parsed = new URL(normalized, window.location.origin);
      const match = parsed.pathname.match(/^\/in\/([^/?#]+)\/?$/i);
      return match ? normalizeLinkedInProfileUrl(`${parsed.origin}/in/${match[1]}/`) : "";
    } catch (_error) {
      const match = normalized.match(/linkedin\.com\/in\/([^/?#]+)/i);
      return match ? `https://www.linkedin.com/in/${match[1]}/` : "";
    }
  }

  function visibleText(node) {
    if (!node) {
      return "";
    }
    return normalizeWhitespace(node.textContent || "");
  }

  function compactName(text) {
    return normalizeWhitespace(text)
      .replace(/\s*•\s*(?:1st|2nd|3rd\+?|[0-9]+(?:st|nd|rd|th))\b.*$/i, "")
      .replace(/\b(?:Verified|Premium)\b/gi, "")
      .trim();
  }

  function looksLikeName(text) {
    const normalized = compactName(text);
    return Boolean(
      normalized
      && normalized.length <= 80
      && !/(current:|past:|mutual connection|followers|view my services|send a message|invite |connect|follow)/i.test(normalized)
    );
  }

  function profileAnchors(item) {
    return Array.from(item.querySelectorAll('a[href*="/in/"]'))
      .map((anchor) => ({
        anchor,
        profileUrl: profileUrlFromHref(anchor.href || anchor.getAttribute("href")),
        text: compactName(visibleText(anchor))
      }))
      .filter((candidate) => candidate.profileUrl);
  }

  function primaryProfileAnchor(item) {
    const candidates = profileAnchors(item);
    const textCandidate = candidates.find((candidate) => looksLikeName(candidate.text));
    return textCandidate || candidates[0] || null;
  }

  function primaryAvatar(item, name) {
    const images = Array.from(item.querySelectorAll("img[src]"));
    const named = images.find((image) => {
      const alt = normalizeWhitespace(image.getAttribute("alt") || "");
      return alt && (!name || alt === name || name.includes(alt) || alt.includes(name));
    });
    const fallback = named || images.find((image) => normalizeWhitespace(image.getAttribute("alt") || "")) || images[0];
    return fallback ? absoluteUrl(fallback.getAttribute("src") || fallback.src || "") : "";
  }

  function paragraphTexts(item) {
    return uniqueStrings(Array.from(item.querySelectorAll("p")).map(visibleText));
  }

  function extractConnectionDegree(texts) {
    const joined = texts.join(" ");
    const match = joined.match(/(?:^|\s|•)(1st|2nd|3rd\+?|[0-9]+(?:st|nd|rd|th))\b/i);
    return normalizeWhitespace(match?.[1] || "");
  }

  function isMutedResultLine(text, name) {
    if (!text) {
      return true;
    }
    const normalized = normalizeWhitespace(text);
    if (name && compactName(normalized) === compactName(name)) {
      return true;
    }
    return /^(current|past):/i.test(normalized)
      || /mutual connection/i.test(normalized)
      || /\bfollowers\b/i.test(normalized)
      || /^view my services$/i.test(normalized)
      || /^message$|^connect$|^follow$/i.test(normalized);
  }

  function extractHeadlineAndLocation(texts, name) {
    const nameIndex = Math.max(0, texts.findIndex((text) => {
      const compact = compactName(text);
      return (name && compact === compactName(name)) || /\s•\s(?:1st|2nd|3rd\+?)/i.test(text);
    }));
    const candidates = texts
      .slice(nameIndex + 1)
      .filter((text) => !isMutedResultLine(text, name))
      .filter((text) => !extractAiGeneratedTextFromLine(text));
    return {
      headline: candidates[0] || "",
      location: candidates[1] || ""
    };
  }

  function primaryAction(item) {
    const controls = Array.from(item.querySelectorAll("a[href], button"));
    const match = controls.find((control) => {
      const label = normalizeWhitespace(control.getAttribute("aria-label") || visibleText(control));
      const href = normalizeWhitespace(control.getAttribute("href") || "");
      return /send a message|invite .* connect|follow/i.test(label)
        || /\/messaging\/compose\/|\/preload\/search-custom-invite\//i.test(href);
    });
    if (!match) {
      return { label: "", href: "", recipient: "" };
    }
    const aria = normalizeWhitespace(match.getAttribute("aria-label") || "");
    const text = normalizeWhitespace(visibleText(match));
    const href = absoluteUrl(match.getAttribute("href") || match.href || "");
    let label = text;
    if (/send a message/i.test(aria) || /\/messaging\/compose\//i.test(href)) {
      label = "Message";
    } else if (/invite .* connect/i.test(aria) || /\/preload\/search-custom-invite\//i.test(href)) {
      label = "Connect";
    } else if (/follow/i.test(aria || text)) {
      label = "Follow";
    }
    let recipient = "";
    try {
      const parsed = new URL(href, window.location.origin);
      recipient = normalizeWhitespace(parsed.searchParams.get("recipient") || parsed.searchParams.get("vanityName") || "");
    } catch (_error) {}
    return { label, href, recipient };
  }

  function activeFilterLabels(doc) {
    return uniqueStrings(Array.from(doc.querySelectorAll('[aria-label^="Filter by "]'))
      .map((node) => normalizeWhitespace(node.getAttribute("aria-label") || visibleText(node)).replace(/^Filter by\s+/i, "")))
      .filter((label) => !/^(people|all filters|reset)$/i.test(label));
  }

  function extractAiGeneratedTextFromLine(text) {
    const normalized = normalizeWhitespace(text);
    if (!normalized || /^AI generated$/i.test(normalized)) {
      return "";
    }
    return /you both |since \w+ \d{4}|intersection of|building products|went to/i.test(normalized)
      ? normalized.replace(/^AI generated\s*/i, "")
      : "";
  }

  function extractAiGeneratedInsight(item) {
    const icon = item.querySelector('[aria-label="AI generated"], svg[id*="signal-ai"]');
    const container = icon?.closest("div");
    const iconText = normalizeWhitespace(visibleText(container)).replace(/^AI generated\s*/i, "");
    if (iconText && !/^AI generated$/i.test(iconText)) {
      return iconText;
    }
    return paragraphTexts(item).map(extractAiGeneratedTextFromLine).find(Boolean) || "";
  }

  function extractPeopleSearchResult(item, index) {
    const primary = primaryProfileAnchor(item);
    if (!primary?.profileUrl) {
      return null;
    }
    const texts = paragraphTexts(item);
    const imageName = normalizeWhitespace(item.querySelector("img[alt]")?.getAttribute("alt") || "");
    const name = looksLikeName(primary.text) ? primary.text : compactName(imageName);
    if (!name) {
      return null;
    }
    const degree = extractConnectionDegree(texts);
    const summary = extractHeadlineAndLocation(texts, name);
    const action = primaryAction(item);
    const currentText = texts.find((text) => /^current:/i.test(text)) || "";
    const pastText = texts.find((text) => /^past:/i.test(text)) || "";
    const mutualConnectionsText = texts.find((text) => /mutual connection/i.test(text)) || "";
    const followersText = texts.find((text) => /\bfollowers\b/i.test(text)) || "";
    return {
      index,
      name,
      profileUrl: primary.profileUrl,
      avatarUrl: primaryAvatar(item, name),
      connectionDegree: degree,
      headline: summary.headline,
      location: summary.location,
      primaryAction: action.label,
      actionHref: action.href,
      actionRecipient: action.recipient,
      currentText,
      pastText,
      mutualConnectionsText,
      followersText,
      aiGeneratedInsight: extractAiGeneratedInsight(item),
      rawText: visibleText(item).slice(0, 4000)
    };
  }

  function resultItems(doc) {
    const semanticItems = Array.from(doc.querySelectorAll('[role="listitem"]'));
    if (semanticItems.length) {
      return semanticItems;
    }
    return Array.from(doc.querySelectorAll('main a[href*="/in/"]'))
      .map((anchor) => anchor.closest("li, article, div"))
      .filter(Boolean);
  }

  function extractPeopleSearchContext(doc = document) {
    const seenProfiles = new Set();
    const results = [];
    for (const item of resultItems(doc)) {
      const result = extractPeopleSearchResult(item, results.length + 1);
      if (!result || seenProfiles.has(result.profileUrl)) {
        continue;
      }
      seenProfiles.add(result.profileUrl);
      results.push(result);
    }
    const supported = isSupportedPeopleSearchPage();
    return {
      supported,
      pageType: "linkedin-people-search",
      pageUrl: window.location.href,
      title: document.title,
      reason: results.length ? "" : "No people results found.",
      peopleSearch: {
        sourceUrl: window.location.href,
        resultCount: results.length,
        activeFilters: activeFilterLabels(doc),
        results,
        extractedAt: new Date().toISOString()
      },
      debug: {
        page_kind: "people_search",
        people_search_result_count: results.length,
        people_search_active_filters: activeFilterLabels(doc),
        people_search_semantic_item_count: resultItems(doc).length
      }
    };
  }

  globalThis.LinkedInAssistantPeopleSearchExtraction = {
    isSupportedPeopleSearchPage,
    extractPeopleSearchContext,
    profileUrlFromHref
  };
})();
