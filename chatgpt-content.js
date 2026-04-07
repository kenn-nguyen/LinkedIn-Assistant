(function initChatGptContent() {
  const shared = globalThis.LinkedInAssistantShared;
  const { MESSAGE_TYPES, normalizeWhitespace } = shared;

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function queryComposer() {
    return (
      document.querySelector("#prompt-textarea") ||
      document.querySelector("div#prompt-textarea[contenteditable='true']") ||
      document.querySelector("div[contenteditable='true'][data-testid='composer-input']") ||
      document.querySelector("textarea[data-id]") ||
      document.querySelector("textarea") ||
      document.querySelector("div[contenteditable='true'][id='prompt-textarea']")
    );
  }

  function queryButtons() {
    return Array.from(document.querySelectorAll("button, a"));
  }

  function allMessageCount() {
    return Array.from(document.querySelectorAll("[data-message-author-role]")).length;
  }

  function assistantMessageCount() {
    return assistantMessageElements().length;
  }

  function composerTextValue(composer) {
    return normalizeWhitespace(
      ("value" in (composer || {}) ? composer?.value : composer?.innerText || composer?.textContent || "")
    );
  }

  function findButtonByText(pattern) {
    return queryButtons().find((button) => pattern.test(normalizeWhitespace(button.innerText || button.textContent || ""))) || null;
  }

  function findSendButton() {
    return (
      document.querySelector("button[data-testid='send-button']") ||
      queryButtons().find((button) => {
        const label = normalizeWhitespace(
          button.getAttribute("aria-label") ||
          button.getAttribute("data-testid") ||
          button.innerText ||
          button.textContent ||
          ""
        );
        return /send|submit/i.test(label);
      }) ||
      null
    );
  }

  function isGenerating() {
    const directStopButton = document.querySelector(
      "button[data-testid='stop-button'], button[aria-label*='Stop generating' i], button[aria-label*='Stop streaming' i]"
    );
    if (directStopButton) {
      return true;
    }

    return Boolean(
      queryButtons().find((button) => {
        const label = normalizeWhitespace(
          button.getAttribute("aria-label") ||
          button.getAttribute("data-testid") ||
          button.innerText ||
          button.textContent ||
          ""
        );
        return /^(stop generating|stop streaming|stop)$/i.test(label);
      })
    );
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
    throw new Error("ChatGPT composer is not available on the project page.");
  }

  async function ensureChatReady(maxWaitMs) {
    const started = Date.now();
    while (Date.now() - started < maxWaitMs) {
      if (/chatgpt\.com|chat\.openai\.com/i.test(window.location.href) && queryComposer()) {
        return;
      }
      await delay(300);
    }
    throw new Error("ChatGPT page did not finish loading before prompt submission.");
  }

  async function setComposerText(text) {
    await ensureChatReady(10000);
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

  async function waitForSubmissionStart(previousAssistantCount, previousMessageCount, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (isGenerating() || assistantMessageCount() > previousAssistantCount || allMessageCount() > previousMessageCount) {
        return true;
      }

      await delay(150);
    }
    return false;
  }

  async function submitPrompt(previousAssistantCount, previousMessageCount) {
    const sendButton = findSendButton();
    if (!sendButton) {
      throw new Error("Send button not found on ChatGPT.");
    }
    if (sendButton.disabled) {
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

    throw new Error("ChatGPT did not start a new response after prompt submission.");
  }

  function assistantMessageElements() {
    return Array.from(document.querySelectorAll("[data-message-author-role='assistant']"));
  }

  function latestAssistantText() {
    const elements = assistantMessageElements();
    const lastElement = elements[elements.length - 1];
    return normalizeWhitespace(lastElement?.innerText || lastElement?.textContent || "");
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
          return {
            status: "complete",
            rawOutput: currentText
          };
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
          const previousAssistantCount = assistantMessageCount();
          const previousMessageCount = allMessageCount();
          await setComposerText(message.prompt || "");
          const composer = queryComposer();
          const composerText = composerTextValue(composer);
          if (!composerText) {
            throw new Error("Prompt text was not inserted into the ChatGPT composer.");
          }
          await submitPrompt(previousAssistantCount, previousMessageCount);
          sendResponse({ ok: true, messageCount: allMessageCount(), currentUrl: window.location.href });
          return;
        }

        if (message.type === MESSAGE_TYPES.GET_CHATGPT_STATE || message.type === MESSAGE_TYPES.GET_PROVIDER_STATE) {
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
