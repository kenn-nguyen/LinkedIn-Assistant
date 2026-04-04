(function initGeminiContent() {
  const shared = globalThis.LinkedInAssistantShared;
  const { MESSAGE_TYPES, normalizeWhitespace } = shared;

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function queryButtons() {
    return Array.from(document.querySelectorAll("button, [role='button'], a"));
  }

  function isVisible(element) {
    if (!(element instanceof Element)) {
      return false;
    }
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function queryComposer() {
    const candidates = [
      document.querySelector("rich-textarea div[contenteditable='true']"),
      document.querySelector("div[contenteditable='true'][role='textbox']"),
      document.querySelector("div[contenteditable='true'][aria-label*='message' i]"),
      document.querySelector("textarea[aria-label*='message' i]"),
      document.querySelector("textarea")
    ].filter(Boolean);

    return candidates.find((element) => isVisible(element)) || null;
  }

  function composerTextValue(composer) {
    return normalizeWhitespace(
      ("value" in (composer || {}) ? composer?.value : composer?.innerText || composer?.textContent || "")
    );
  }

  function allMessageCount() {
    return assistantMessageElements().length + document.querySelectorAll("user-query, .query-text-line").length;
  }

  function assistantMessageElements() {
    const selectors = [
      "message-content",
      "[data-turn-role='model']",
      "[data-author='model']",
      ".model-response-text",
      ".response-content message-content",
      ".response-container .markdown"
    ];

    return Array.from(document.querySelectorAll(selectors.join(", ")))
      .filter((element) => isVisible(element))
      .filter((element) => {
        const text = normalizeWhitespace(element.innerText || element.textContent || "");
        return Boolean(text) && !element.closest("footer, form");
      });
  }

  function isGenerating() {
    return Boolean(
      queryButtons().find((button) => {
        const label = normalizeWhitespace(
          button.getAttribute("aria-label")
          || button.getAttribute("data-test-id")
          || button.getAttribute("mattooltip")
          || button.innerText
          || button.textContent
          || ""
        );
        return /stop|cancel/i.test(label);
      })
    );
  }

  function latestAssistantText() {
    const elements = assistantMessageElements();
    const lastElement = elements[elements.length - 1];
    return normalizeWhitespace(lastElement?.innerText || lastElement?.textContent || "");
  }

  async function ensureReady(maxWaitMs) {
    const started = Date.now();
    while (Date.now() - started < maxWaitMs) {
      if (/gemini\.google\.com/i.test(window.location.href) && queryComposer()) {
        return;
      }
      await delay(300);
    }
    throw new Error("Gemini page did not finish loading before prompt submission.");
  }

  async function waitForComposer(maxWaitMs) {
    const started = Date.now();
    while (Date.now() - started < maxWaitMs) {
      const composer = queryComposer();
      if (composer) {
        return composer;
      }
      await delay(400);
    }
    throw new Error("Gemini composer is not available on the page.");
  }

  async function setComposerText(text) {
    await ensureReady(12000);
    const composer = await waitForComposer(20000);
    composer.focus();

    if ("value" in composer) {
      const prototype = Object.getPrototypeOf(composer);
      const descriptor = prototype ? Object.getOwnPropertyDescriptor(prototype, "value") : null;
      if (descriptor?.set) {
        descriptor.set.call(composer, "");
        descriptor.set.call(composer, text);
      } else {
        composer.value = "";
        composer.value = text;
      }
      composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      composer.dispatchEvent(new Event("change", { bubbles: true }));
      await delay(100);
      return;
    }

    composer.textContent = "";
    composer.textContent = text;
    composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    await delay(100);
  }

  function findSendButton() {
    const selectors = [
      "button[aria-label*='send' i]",
      "button[data-test-id*='send' i]",
      "[role='button'][aria-label*='send' i]"
    ];
    const direct = selectors
      .map((selector) => document.querySelector(selector))
      .find((element) => element && isVisible(element));
    if (direct) {
      return direct;
    }

    return queryButtons().find((button) => {
      const label = normalizeWhitespace(
        button.getAttribute("aria-label")
        || button.getAttribute("data-test-id")
        || button.getAttribute("mattooltip")
        || button.innerText
        || button.textContent
        || ""
      );
      return /send|submit/i.test(label) && isVisible(button);
    }) || null;
  }

  async function waitForSubmissionStart(previousAssistantCount, previousMessageCount, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (isGenerating() || assistantMessageElements().length > previousAssistantCount || allMessageCount() > previousMessageCount) {
        return true;
      }
      await delay(150);
    }
    return false;
  }

  async function submitPrompt(previousAssistantCount, previousMessageCount) {
    const sendButton = findSendButton();
    if (!sendButton) {
      throw new Error("Send button not found on Gemini.");
    }
    if ("disabled" in sendButton && sendButton.disabled) {
      await delay(250);
    }
    sendButton.click();
    if (await waitForSubmissionStart(previousAssistantCount, previousMessageCount, 5000)) {
      return;
    }

    const composer = queryComposer();
    if (composer) {
      composer.focus();
      composer.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", code: "Enter" }));
      composer.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter", code: "Enter" }));
      if (await waitForSubmissionStart(previousAssistantCount, previousMessageCount, 3500)) {
        return;
      }
    }

    throw new Error("Gemini did not start a new response after prompt submission.");
  }

  async function waitForAssistantResponse(maxWaitMs, stallWaitMs) {
    const start = Date.now();
    let lastProgressAt = start;
    let lastText = "";
    let stablePolls = 0;
    const settleMs = Math.min(Math.max(2500, Math.floor(stallWaitMs / 2)), 6000);

    while (Date.now() - start < maxWaitMs) {
      const elements = assistantMessageElements();
      const lastElement = elements[elements.length - 1];
      const currentText = normalizeWhitespace(lastElement?.innerText || lastElement?.textContent || "");
      const generating = isGenerating();

      if (currentText !== lastText) {
        lastProgressAt = Date.now();
      }

      if (currentText && currentText === lastText && !generating) {
        stablePolls += 1;
        if (stablePolls >= 2 || Date.now() - lastProgressAt >= settleMs) {
          return { status: "complete", rawOutput: currentText };
        }
      } else {
        stablePolls = 0;
        lastText = currentText;
      }

      if (!generating && Date.now() - lastProgressAt > stallWaitMs) {
        return {
          status: currentText ? "stalled" : "no_response",
          rawOutput: currentText
        };
      }

      await delay(1500);
    }

    return {
      status: isGenerating() ? "still_generating" : "stalled",
      rawOutput: lastText
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
      try {
        if (message.type === MESSAGE_TYPES.RUN_PROMPT || message.type === MESSAGE_TYPES.RETRY_RUN) {
          const previousAssistantCount = assistantMessageElements().length;
          const previousMessageCount = allMessageCount();
          await setComposerText(message.prompt || "");
          const composer = queryComposer();
          const composerText = composerTextValue(composer);
          if (!composerText) {
            throw new Error("Prompt text was not inserted into the Gemini composer.");
          }
          await submitPrompt(previousAssistantCount, previousMessageCount);
          sendResponse({ ok: true, messageCount: allMessageCount(), currentUrl: window.location.href });
          return;
        }

        if (message.type === MESSAGE_TYPES.GET_PROVIDER_STATE || message.type === MESSAGE_TYPES.GET_CHATGPT_STATE) {
          const latestText = latestAssistantText();
          sendResponse({
            ok: true,
            currentUrl: window.location.href,
            title: document.title,
            hasComposer: Boolean(queryComposer()),
            isGenerating: isGenerating(),
            latestResponseLength: latestText.length,
            latestResponseText: latestText
          });
          return;
        }

        if (message.type === MESSAGE_TYPES.READ_RESPONSE) {
          const result = await waitForAssistantResponse(
            Number(message.maxWaitMs) || 180000,
            Number(message.stallWaitMs) || 45000
          );
          sendResponse({ ok: true, ...result });
          return;
        }
      } catch (error) {
        sendResponse({ ok: false, error: error.message || String(error) });
      }
    })();
    return true;
  });
})();
