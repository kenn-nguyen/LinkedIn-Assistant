(function initLinkedInPostExtraction() {
  const shared = globalThis.LinkedInAssistantShared || {};
  const normalizeWhitespace = shared.normalizeWhitespace || ((value) => String(value || "").replace(/\s+/g, " ").trim());
  const truncate = shared.truncate || ((value, limit = 1000) => {
    const text = String(value || "");
    return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1))}...` : text;
  });
  const uniqueStrings = shared.uniqueStrings || ((values) => {
    const seen = new Set();
    const result = [];
    for (const value of values || []) {
      const normalized = normalizeWhitespace(value);
      const key = normalized.toLowerCase();
      if (!normalized || seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(normalized);
    }
    return result;
  });

  const POST_ROOT_SELECTOR = [
    "[data-urn*='urn:li:activity']",
    "[componentkey*='FeedType_MAIN_FEED']",
    "[componentkey*='MAIN_FEED_RELEVANCE']",
    ".feed-shared-update-v2",
    ".update-components-update-v2",
    "article",
    "[role='listitem']"
  ].join(",");
  const COMMENT_ROOT_SELECTOR = "[componentkey^='replaceableComment_'], [componentkey*='replaceableComment_']";
  const TEXT_BOX_SELECTOR = "[data-testid='expandable-text-box']";
  const POST_ACTION_CONTROL_SELECTOR = "button, a, [role='button']";
  const DISCUSSION_CLICK_MAX_AGE_MS = 2 * 60 * 1000;
  const LOAD_MORE_COMMENT_MAX_CLICKS = 2;

  let lastDiscussionClick = {
    root: null,
    atMs: 0
  };

  function nowMs() {
    return Date.now();
  }

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function isElement(node) {
    return node instanceof Element;
  }

  function isVisible(node) {
    if (!isElement(node)) {
      return false;
    }
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function visibleText(node) {
    if (!node) {
      return "";
    }
    return normalizeWhitespace(node.innerText || node.textContent || "");
  }

  function visibleMultilineText(node) {
    if (!node) {
      return "";
    }
    return String(node.innerText || node.textContent || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
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

  function normalizePostUrl(href) {
    const raw = absoluteUrl(href);
    if (!raw) {
      return "";
    }
    try {
      const parsed = new URL(raw, window.location.origin);
      if (!/linkedin\.com$/i.test(parsed.hostname) && !parsed.hostname.endsWith(".linkedin.com")) {
        return raw;
      }
      if (/^\/feed\/update\/[^/]+\/?$/i.test(parsed.pathname)) {
        return `${parsed.origin}${parsed.pathname.replace(/\/?$/, "/")}`;
      }
      if (/^\/posts\/[^/]+\/?$/i.test(parsed.pathname)) {
        return `${parsed.origin}${parsed.pathname.replace(/\/?$/, "/")}`;
      }
      return raw;
    } catch (_error) {
      return raw;
    }
  }

  function isLinkedInPostPath(pathname) {
    const normalizedPath = normalizeWhitespace(pathname || "");
    return Boolean(
      /^\/feed(?:\/|$)/i.test(normalizedPath)
      || /^\/posts(?:\/|$)/i.test(normalizedPath)
      || /^\/company\/[^/]+\/posts(?:\/|$)/i.test(normalizedPath)
    );
  }

  function profileOrCompanyUrl(href) {
    const raw = absoluteUrl(href);
    if (!raw) {
      return "";
    }
    try {
      const parsed = new URL(raw, window.location.origin);
      const profile = parsed.pathname.match(/^\/in\/([^/?#]+)\/?/i);
      if (profile) {
        return `${parsed.origin}/in/${profile[1]}/`;
      }
      const company = parsed.pathname.match(/^\/company\/([^/?#]+)\/?/i);
      if (company) {
        return `${parsed.origin}/company/${company[1]}/`;
      }
    } catch (_error) {
      return raw;
    }
    return "";
  }

  function elementIsInsideComments(node) {
    return Boolean(isElement(node) && node.closest([
      COMMENT_ROOT_SELECTOR,
      "[data-testid*='commentList']",
      "[componentkey*='commentsSection']",
      "[componentkey*='commentBox']",
      "[aria-label*='comment' i][role='textbox']"
    ].join(",")));
  }

  function isCommentRoot(node) {
    return Boolean(isElement(node) && node.matches(COMMENT_ROOT_SELECTOR));
  }

  function topLevelCommentRoots(root) {
    const candidates = Array.from((root || document).querySelectorAll(COMMENT_ROOT_SELECTOR))
      .filter(isVisible);
    return candidates.filter((candidate) => !candidates.some((other) => (
      other !== candidate
      && other.contains(candidate)
      && normalizeWhitespace(other.getAttribute("componentkey") || "") === normalizeWhitespace(candidate.getAttribute("componentkey") || "")
    )));
  }

  function postTextNodes(root) {
    return Array.from((root || document).querySelectorAll(TEXT_BOX_SELECTOR))
      .filter(isVisible)
      .filter((node) => !elementIsInsideComments(node))
      .filter((node) => normalizeWhitespace(visibleMultilineText(node)).length > 0);
  }

  function hasPostActionButton(root) {
    return Array.from((root || document).querySelectorAll(POST_ACTION_CONTROL_SELECTOR))
      .filter(isVisible)
      .some((control) => {
        if (elementIsInsideComments(control)) {
          return false;
        }
        const label = normalizeWhitespace(`${control.getAttribute("aria-label") || ""} ${visibleText(control)}`);
        const hasCommentIcon = Boolean(control.querySelector("svg[id^='comment']"));
        return /\b(comment|repost|send|like)\b/i.test(label) || hasCommentIcon;
      });
  }

  function postUrlFromRoot(root) {
    const anchor = Array.from((root || document).querySelectorAll("a[href*='/feed/update/']"))
      .filter((node) => !elementIsInsideComments(node))
      .find(isVisible)
      || (root || document).querySelector("a[href*='/feed/update/']");
    return normalizePostUrl(anchor?.getAttribute("data-original-url") || anchor?.href || anchor?.getAttribute("href") || "");
  }

  function looksLikePostRoot(root) {
    if (!isElement(root) || isCommentRoot(root)) {
      return false;
    }
    if (elementIsInsideComments(root)) {
      return false;
    }
    return Boolean(
      postUrlFromRoot(root)
      || postTextNodes(root).length
      || hasPostActionButton(root)
    );
  }

  function closestPostRoot(node) {
    if (!isElement(node)) {
      return null;
    }
    const direct = node.closest(POST_ROOT_SELECTOR);
    if (looksLikePostRoot(direct)) {
      return direct;
    }
    let current = node.parentElement;
    while (current && current !== document.body) {
      if (looksLikePostRoot(current)) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function candidatePostRoots() {
    const candidates = Array.from(document.querySelectorAll(POST_ROOT_SELECTOR))
      .filter(isVisible)
      .filter(looksLikePostRoot);
    return candidates.filter((candidate) => !candidates.some((other) => (
      other !== candidate
      && candidate.contains(other)
      && postTextNodes(other).length >= postTextNodes(candidate).length
      && hasPostActionButton(other)
    )));
  }

  function viewportScore(node) {
    if (!isElement(node)) {
      return Number.POSITIVE_INFINITY;
    }
    const rect = node.getBoundingClientRect();
    const viewportMid = Math.max(0, window.innerHeight || 0) / 2;
    const nodeMid = rect.top + (rect.height / 2);
    const visibilityPenalty = rect.bottom < 0 || rect.top > (window.innerHeight || 0) ? 2000 : 0;
    return Math.abs(nodeMid - viewportMid) + visibilityPenalty;
  }

  function activeCommentEditorRoot() {
    const active = document.activeElement;
    const activeEditor = isElement(active) && (
      active.matches("[role='textbox'][aria-label*='comment' i], [contenteditable='true']")
      || active.closest("[role='textbox'][aria-label*='comment' i], [contenteditable='true']")
    );
    if (activeEditor) {
      return closestPostRoot(active.closest("[role='textbox'][aria-label*='comment' i], [contenteditable='true']") || active);
    }
    const visibleEditor = Array.from(document.querySelectorAll("[role='textbox'][aria-label*='comment' i], [contenteditable='true']"))
      .filter(isVisible)
      .find((node) => /comment/i.test(normalizeWhitespace(node.getAttribute("aria-label") || node.closest("[componentkey*='commentBox']")?.getAttribute("componentkey") || "")));
    return closestPostRoot(visibleEditor);
  }

  function activePostRoot() {
    const editorRoot = activeCommentEditorRoot();
    if (editorRoot) {
      return editorRoot;
    }
    if (
      lastDiscussionClick.root
      && lastDiscussionClick.root.isConnected
      && nowMs() - lastDiscussionClick.atMs <= DISCUSSION_CLICK_MAX_AGE_MS
      && looksLikePostRoot(lastDiscussionClick.root)
    ) {
      return lastDiscussionClick.root;
    }
    const roots = candidatePostRoots();
    return roots.slice().sort((left, right) => viewportScore(left) - viewportScore(right))[0] || null;
  }

  function isMainCommentControl(control) {
    if (!isElement(control) || !isVisible(control) || elementIsInsideComments(control)) {
      return false;
    }
    const label = normalizeWhitespace(`${control.getAttribute("aria-label") || ""} ${visibleText(control)}`);
    if (/\b(reply|replies)\b/i.test(label)) {
      return false;
    }
    const hasCommentIcon = Boolean(control.querySelector("svg[id^='comment']"));
    return hasCommentIcon && /\bcomment\b/i.test(label);
  }

  function rememberPotentialDiscussionClick(target) {
    const control = isElement(target) ? target.closest(POST_ACTION_CONTROL_SELECTOR) : null;
    if (!isMainCommentControl(control)) {
      return false;
    }
    const root = closestPostRoot(control);
    if (!root) {
      return false;
    }
    lastDiscussionClick = {
      root,
      atMs: nowMs()
    };
    return true;
  }

  function rememberPotentialPostSelection(target) {
    const root = closestPostRoot(isElement(target) ? target : null);
    if (!root) {
      return false;
    }
    lastDiscussionClick = {
      root,
      atMs: nowMs()
    };
    return true;
  }

  function actionControls(root) {
    return Array.from((root || document).querySelectorAll(POST_ACTION_CONTROL_SELECTOR))
      .filter(isVisible);
  }

  async function clickControl(control) {
    try {
      control.scrollIntoView({ block: "center", inline: "nearest" });
      await delay(80);
      control.click();
      await delay(260);
      return true;
    } catch (_error) {
      return false;
    }
  }

  async function expandInlineText(root) {
    const controls = actionControls(root)
      .filter((control) => {
        if (elementIsInsideComments(control)) {
          return false;
        }
        const label = normalizeWhitespace(`${control.getAttribute("aria-label") || ""} ${visibleText(control)}`);
        if (!label || control.getAttribute("aria-expanded") === "true") {
          return false;
        }
        return /\b(see more|show more|more)\b|…\s*more|\.{3}\s*more/i.test(label);
      })
      .slice(0, 4);
    let clicked = 0;
    for (const control of controls) {
      if (await clickControl(control)) {
        clicked += 1;
      }
    }
    if (clicked) {
      await delay(350);
    }
    return clicked;
  }

  function commentsAreOpen(root) {
    return Boolean(
      topLevelCommentRoots(root).length
      || Array.from((root || document).querySelectorAll("[role='textbox'][aria-label*='comment' i], [contenteditable='true']"))
        .some(isVisible)
    );
  }

  async function openComments(root) {
    if (commentsAreOpen(root)) {
      return { opened: false, reason: "already_open" };
    }
    const commentControl = actionControls(root).find(isMainCommentControl);
    if (commentControl) {
      const clicked = await clickControl(commentControl);
      return { opened: clicked, reason: clicked ? "comment_button" : "click_failed" };
    }
    const countControl = actionControls(root).find((control) => {
      if (elementIsInsideComments(control)) {
        return false;
      }
      const label = normalizeWhitespace(`${control.getAttribute("aria-label") || ""} ${visibleText(control)}`);
      return /\b\d+\s+comments?\b/i.test(label);
    });
    if (countControl) {
      const clicked = await clickControl(countControl);
      return { opened: clicked, reason: clicked ? "comment_count" : "click_failed" };
    }
    return { opened: false, reason: "no_control" };
  }

  async function loadVisibleComments(root) {
    let clicked = 0;
    for (let attempt = 0; attempt < LOAD_MORE_COMMENT_MAX_CLICKS; attempt += 1) {
      const control = actionControls(root).find((candidate) => {
        const label = normalizeWhitespace(`${candidate.getAttribute("aria-label") || ""} ${visibleText(candidate)}`);
        return /\b(load|show|view)\s+(more|previous)\s+comments?\b|\bmore comments?\b/i.test(label);
      });
      if (!control) {
        break;
      }
      if (await clickControl(control)) {
        clicked += 1;
      }
    }
    return clicked;
  }

  function cleanActorName(text) {
    return normalizeWhitespace(text)
      .replace(/^View\s+/i, "")
      .replace(/[’']s\s+profile.*$/i, "")
      .replace(/\b(?:Verified|Premium)\s+Profile\b.*$/i, "")
      .replace(/\s*[•·]\s*(?:1st|2nd|3rd\+?).*$/i, "")
      .replace(/\b(?:Follow|Connect|Message|Sign up)\b.*$/i, "")
      .trim();
  }

  function actorNameFromAnchor(anchor) {
    const strong = cleanActorName(visibleText(anchor.querySelector("strong")));
    if (strong) {
      return strong;
    }
    const paragraph = cleanActorName(visibleText(anchor.querySelector("p")));
    if (paragraph) {
      return paragraph;
    }
    const imageAlt = cleanActorName(normalizeWhitespace(anchor.querySelector("img[alt]")?.getAttribute("alt") || ""));
    if (imageAlt) {
      return imageAlt;
    }
    return cleanActorName(visibleText(anchor));
  }

  function actorCandidates(root) {
    const anchors = Array.from((root || document).querySelectorAll("a[href*='/in/'], a[href*='/company/']"))
      .filter((anchor) => !elementIsInsideComments(anchor))
      .map((anchor) => ({
        name: actorNameFromAnchor(anchor),
        url: profileOrCompanyUrl(anchor.href || anchor.getAttribute("href") || "")
      }))
      .filter((actor) => actor.name && actor.url && !/^(follow|connect|message|sign up)$/i.test(actor.name));
    const seen = new Set();
    const result = [];
    for (const actor of anchors) {
      const key = `${actor.name.toLowerCase()}::${actor.url.toLowerCase()}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(actor);
    }
    return result.slice(0, 6);
  }

  function primaryPostAuthor(root, actors) {
    if (!actors.length) {
      return { name: "", url: "" };
    }
    const topText = visibleText(root).slice(0, 700);
    if (/\breposted this\b/i.test(topText) && actors[1]) {
      return actors[1];
    }
    return actors[0];
  }

  function postTextBlocks(root) {
    return uniqueStrings(postTextNodes(root).map((node) => visibleMultilineText(node)))
      .filter((text) => normalizeWhitespace(text).length >= 8)
      .slice(0, 5);
  }

  function reactionSummary(root) {
    const text = visibleText(root);
    const commentsMatch = text.match(/\b(\d[\d,]*)\s+comments?\b/i);
    const repostsMatch = text.match(/\b(\d[\d,]*)\s+reposts?\b/i);
    const reactionMatch = text.match(/\b(?:and\s+)?(\d[\d,]*)\s+others?\s+reacted\b/i);
    return {
      reactionsText: normalizeWhitespace(reactionMatch?.[0] || ""),
      commentsText: normalizeWhitespace(commentsMatch?.[0] || ""),
      repostsText: normalizeWhitespace(repostsMatch?.[0] || "")
    };
  }

  function timestampFromLines(lines) {
    return lines.find((line) => /^(?:now|\d+\s*(?:s|m|h|d|w|mo|yr)s?|\d+\s+(?:second|minute|hour|day|week|month|year)s?)\b/i.test(line)) || "";
  }

  function cleanCommentAuthorName(text) {
    return cleanActorName(text)
      .replace(/\s+[•·]\s*(?:1st|2nd|3rd\+?).*$/i, "")
      .trim();
  }

  function commentTextFromRoot(commentRoot) {
    const textBoxes = Array.from(commentRoot.querySelectorAll(TEXT_BOX_SELECTOR))
      .filter(isVisible)
      .map((node) => visibleMultilineText(node))
      .filter(Boolean)
      .sort((left, right) => right.length - left.length);
    if (textBoxes[0]) {
      return truncate(textBoxes[0], 2000);
    }
    const paragraphs = Array.from(commentRoot.querySelectorAll("p"))
      .filter(isVisible)
      .map((node) => visibleMultilineText(node))
      .filter((text) => text && !/\b(?:like|reply|view more options)\b/i.test(text))
      .sort((left, right) => right.length - left.length);
    return truncate(paragraphs[0] || "", 2000);
  }

  function extractComment(commentRoot, index) {
    const authorAnchor = Array.from(commentRoot.querySelectorAll("a[href*='/in/'], a[href*='/company/']"))
      .find(isVisible);
    const authorUrl = profileOrCompanyUrl(authorAnchor?.href || authorAnchor?.getAttribute?.("href") || "");
    const authorName = cleanCommentAuthorName(actorNameFromAnchor(authorAnchor));
    const lines = uniqueStrings(visibleMultilineText(commentRoot).split("\n").map(normalizeWhitespace));
    const text = commentTextFromRoot(commentRoot);
    const urn = normalizeWhitespace(commentRoot.getAttribute("componentkey") || "").replace(/^replaceableComment_/i, "");
    return {
      index,
      authorName,
      authorUrl,
      headline: lines.find((line) => line && line !== authorName && !timestampFromLines([line]) && !line.includes(text)) || "",
      timestamp: timestampFromLines(lines),
      text,
      commentUrn: urn
    };
  }

  function extractComments(root) {
    return topLevelCommentRoots(root)
      .map((commentRoot, index) => extractComment(commentRoot, index + 1))
      .filter((comment) => normalizeWhitespace(comment.text) || normalizeWhitespace(comment.authorName))
      .slice(0, 25);
  }

  function extractPostDiscussionFromRoot(root, options = {}) {
    const actors = actorCandidates(root);
    const author = primaryPostAuthor(root, actors);
    const textBlocks = postTextBlocks(root);
    const comments = options.includeComments === false ? [] : extractComments(root);
    return {
      capturedAt: new Date().toISOString(),
      pageUrl: normalizeWhitespace(window.location.href || ""),
      postUrl: postUrlFromRoot(root),
      authorName: author.name,
      authorUrl: author.url,
      actors,
      postText: truncate(textBlocks.join("\n\n"), 6000),
      postTextBlocks: textBlocks.map((text, index) => ({ index: index + 1, text: truncate(text, 3000) })),
      comments,
      commentCount: comments.length,
      reactionSummary: reactionSummary(root),
      rawVisibleText: truncate(visibleMultilineText(root), 12000)
    };
  }

  function isSupportedPostPage() {
    if (!window.location.hostname.includes("linkedin.com")) {
      return false;
    }
    if (isLinkedInPostPath(window.location.pathname)) {
      return true;
    }
    return candidatePostRoots().length > 0;
  }

  function extractPostPageContext() {
    const root = activePostRoot();
    const supported = Boolean(isSupportedPostPage() && root);
    const postDiscussion = supported
      ? extractPostDiscussionFromRoot(root, { includeComments: true })
      : null;
    return {
      supported,
      pageType: supported || isSupportedPostPage() ? "linkedin-post" : "unsupported",
      pageUrl: window.location.href,
      title: document.title,
      postDiscussion,
      debug: {
        page_kind: "post",
        candidate_post_count: candidatePostRoots().length,
        active_post_found: Boolean(root),
        visible_comment_count: Number(postDiscussion?.commentCount || 0),
        post_text_length: normalizeWhitespace(postDiscussion?.postText || "").length
      },
      reason: supported ? "" : "Open a visible LinkedIn feed or company post."
    };
  }

  async function captureVisiblePostDiscussion() {
    const startedAtMs = nowMs();
    const root = activePostRoot();
    if (!root) {
      return {
        supported: false,
        pageType: "linkedin-post",
        pageUrl: window.location.href,
        title: document.title,
        reason: "Click the comment action on a visible LinkedIn post first.",
        postDiscussion: null,
        debug: {
          page_kind: "post",
          candidate_post_count: candidatePostRoots().length,
          active_post_found: false
        }
      };
    }

    const expandBefore = await expandInlineText(root);
    const openResult = await openComments(root);
    await delay(openResult.opened ? 600 : 180);
    const loadedComments = await loadVisibleComments(root);
    const expandAfter = await expandInlineText(root);
    const postDiscussion = extractPostDiscussionFromRoot(root, { includeComments: true });
    const supported = Boolean(
      normalizeWhitespace(postDiscussion.postText)
      || postDiscussion.comments.length
      || normalizeWhitespace(postDiscussion.postUrl)
    );

    return {
      supported,
      pageType: "linkedin-post",
      pageUrl: window.location.href,
      title: document.title,
      reason: supported ? "" : "LinkedIn did not expose visible post text or comments yet.",
      postDiscussion,
      debug: {
        page_kind: "post",
        candidate_post_count: candidatePostRoots().length,
        active_post_found: true,
        expand_clicks_before_comments: expandBefore,
        comment_open_reason: openResult.reason,
        comment_opened_by_assistant: Boolean(openResult.opened),
        load_more_comment_clicks: loadedComments,
        expand_clicks_after_comments: expandAfter,
        visible_comment_count: postDiscussion.comments.length,
        post_text_length: normalizeWhitespace(postDiscussion.postText || "").length,
        post_capture_total_ms: Math.max(0, nowMs() - startedAtMs)
      }
    };
  }

  globalThis.LinkedInAssistantPostExtraction = {
    captureVisiblePostDiscussion,
    extractPostPageContext,
    isSupportedPostPage,
    rememberPotentialDiscussionClick,
    rememberPotentialPostSelection
  };
})();
