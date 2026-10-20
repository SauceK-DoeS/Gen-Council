// background.js - AI Council Local MV3 Service Worker
// Multi-strategy scrapers, active-tab resolution, and resilient DOM status checkers

const serviceConfigs = {
  chatgpt: {
    matchFn: (url) => url.includes("chatgpt.com") || url.includes("openai.com"),
    launchUrl: "https://chatgpt.com/",
    injector: injectChatGPT,
    scraper: scrapeChatGPT,
    statusChecker: checkChatGPTStatus
  },
  claude: {
    matchFn: (url) => url.includes("claude.ai"),
    launchUrl: "https://claude.ai/",
    injector: injectClaude,
    scraper: scrapeClaude,
    statusChecker: checkClaudeStatus
  },
  gemini: {
    matchFn: (url) => url.includes("gemini.google.com") || url.includes("bard.google.com"),
    launchUrl: "https://gemini.google.com/app",
    injector: injectGemini,
    scraper: scrapeGemini,
    statusChecker: checkGeminiStatus
  },
  grok: {
    matchFn: (url) => url.includes("grok.com") || (url.includes("x.com") && url.includes("grok")) || (url.includes("twitter.com") && url.includes("grok")),
    launchUrl: "https://grok.com/",
    injector: injectGrok,
    scraper: scrapeGrok,
    statusChecker: checkGrokStatus
  }
};

async function getStoredTabs() {
  const data = await chrome.storage.local.get("councilTabs");
  return data.councilTabs || {};
}

// Checks if a tab exists AND its current URL matches the service
async function isTabMatchingService(tabId, matchFn) {
  if (!tabId) return false;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab) return false;
    const url = (tab.url || tab.pendingUrl || "").toLowerCase();
    return matchFn(url);
  } catch (e) {
    return false;
  }
}

// Dynamically finds the correct, living tab for a service
async function getValidTabForService(service, allTabs, stored) {
  const cfg = serviceConfigs[service];

  // 1. Verify stored tab ID
  const storedId = stored[service];
  if (storedId && (await isTabMatchingService(storedId, cfg.matchFn))) {
    return storedId;
  }

  // 2. Scan open tabs for this service
  const matchingTabs = allTabs.filter(t => {
    const url = (t.url || t.pendingUrl || "").toLowerCase();
    return cfg.matchFn(url);
  });

  if (matchingTabs.length === 0) return null;

  // 3. Prioritize active tab if user is currently looking at it
  const activeTab = matchingTabs.find(t => t.active);
  if (activeTab) {
    stored[service] = activeTab.id;
    return activeTab.id;
  }

  // 4. Prioritize tab with a conversation/chat route over empty root
  const convTab = matchingTabs.find(t => {
    const u = (t.url || "").toLowerCase();
    return u.includes("/c/") || u.includes("/chat") || u.includes("/app");
  });
  if (convTab) {
    stored[service] = convTab.id;
    return convTab.id;
  }

  // 5. Fallback to newest matching tab
  const chosen = matchingTabs[matchingTabs.length - 1];
  stored[service] = chosen.id;
  return chosen.id;
}

// Single-pass atomic tab resolution for DISPATCH (respects targetServices filter)
async function resolveAllTabs(targetServices) {
  const services = Array.isArray(targetServices)
    ? targetServices
    : ["chatgpt", "claude", "gemini", "grok"];

  if (services.length === 0) return {};

  const allTabs = await chrome.tabs.query({});
  const stored = await getStoredTabs();
  const resolved = {};

  for (const service of services) {
    const cfg = serviceConfigs[service];
    if (!cfg) continue;
    let tabId = await getValidTabForService(service, allTabs, stored);

    if (tabId) {
      resolved[service] = { tabId, isNew: false };
      stored[service] = tabId;
      continue;
    }

    const newTab = await chrome.tabs.create({ url: cfg.launchUrl, active: false });
    resolved[service] = { tabId: newTab.id, isNew: true };
    stored[service] = newTab.id;
  }

  await chrome.storage.local.set({ councilTabs: stored });
  return resolved;
}

function waitForTabReady(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      if (tab && tab.status === "complete") return resolve();
      const listener = (tid, changeInfo) => {
        if (tid === tabId && changeInfo.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 7000);
    });
  });
}

// Send to single service
async function sendToService(service, promptText) {
  const currentTabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const originTabId = currentTabs.length > 0 ? currentTabs[0].id : null;

  const tabMap = await resolveAllTabs([service]);
  const target = tabMap[service];

  if (!target || !target.tabId) {
    return { success: false, error: "Tab not found" };
  }

  // Activate tab and focus its window so it has genuine OS/window focus
  try {
    const tabObj = await chrome.tabs.get(target.tabId);
    if (tabObj && tabObj.windowId) {
      await chrome.windows.update(tabObj.windowId, { focused: true });
    }
  } catch (e) {}
  await chrome.tabs.update(target.tabId, { active: true });

  if (target.isNew) {
    await waitForTabReady(target.tabId);
    await new Promise(r => setTimeout(r, 2200));
  } else {
    await new Promise(r => setTimeout(r, 450));
  }

  const execResult = await chrome.scripting.executeScript({
    target: { tabId: target.tabId },
    func: serviceConfigs[service].injector,
    args: [promptText]
  });

  const detail = execResult && execResult[0] ? execResult[0].result : null;

  // Restore origin tab focus if different
  if (originTabId && originTabId !== target.tabId) {
    try {
      await chrome.tabs.update(originTabId, { active: true });
    } catch (e) {}
  }

  return { tabId: target.tabId, detail, success: detail && detail.status === "sent" };
}

// Scrape single service
async function scrapeSingleService(service) {
  const allTabs = await chrome.tabs.query({});
  const stored = await getStoredTabs();
  const tabId = await getValidTabForService(service, allTabs, stored);

  if (!tabId) return "";

  try {
    const execRes = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: serviceConfigs[service].scraper
    });
    return execRes && execRes[0] ? execRes[0].result : "";
  } catch (e) {
    console.error(`[AI Council] Scrape error for ${service}:`, e);
    return "";
  }
}

// Dispatch to targeted tabs sequentially with focus (fixes background tab execution)
async function dispatchToAll(promptText, targetServices) {
  const services = Array.isArray(targetServices)
    ? targetServices
    : ["chatgpt", "claude", "gemini", "grok"];

  if (services.length === 0) return {};

  const currentTabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const originTabId = currentTabs.length > 0 ? currentTabs[0].id : null;

  const tabMap = await resolveAllTabs(services);
  const results = {};

  for (const service of services) {
    try {
      const target = tabMap[service];
      if (!target || !target.tabId) {
        results[service] = { success: false, error: "Tab not resolved" };
        continue;
      }

      // Bring tab and window to focus so React/ProseMirror/Angular event listeners respond
      try {
        const tabObj = await chrome.tabs.get(target.tabId);
        if (tabObj && tabObj.windowId) {
          await chrome.windows.update(tabObj.windowId, { focused: true });
        }
      } catch (e) {}
      await chrome.tabs.update(target.tabId, { active: true });

      if (target.isNew) {
        await waitForTabReady(target.tabId);
        await new Promise(r => setTimeout(r, 2200));
      } else {
        await new Promise(r => setTimeout(r, 450));
      }

      const execResult = await chrome.scripting.executeScript({
        target: { tabId: target.tabId },
        func: serviceConfigs[service].injector,
        args: [promptText]
      });

      const detail = execResult && execResult[0] ? execResult[0].result : null;
      results[service] = { success: detail && detail.status === "sent", detail };
    } catch (err) {
      console.error(`[AI Council] Error injecting into ${service}:`, err);
      results[service] = { success: false, error: err.message };
    }
  }

  // Restore focus back to AI Council Chamber
  if (originTabId) {
    try {
      await chrome.tabs.update(originTabId, { active: true });
    } catch (e) {}
  }

  return results;
}

// Passive status check (only inspects active tabs, NEVER opens tabs)
async function checkAllStatus(targetServices) {
  const allTabs = await chrome.tabs.query({});
  const stored = await getStoredTabs();
  const services = ["chatgpt", "claude", "gemini", "grok"];
  const status = {};

  await Promise.all(
    services.map(async (service) => {
      // If targetServices is specified, skip tab check for models routed through MCP
      if (Array.isArray(targetServices) && !targetServices.includes(service)) {
        status[service] = { tabFound: false, isGenerating: false, isReady: false, chars: 0, isMcpOnly: true };
        return;
      }

      try {
        const cfg = serviceConfigs[service];
        const tabId = await getValidTabForService(service, allTabs, stored);

        if (tabId) {
          const res = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: cfg.statusChecker
          });
          const detail = res && res[0] ? res[0].result : { isGenerating: false, isReady: false, chars: 0 };
          status[service] = { tabFound: true, ...detail };
        } else {
          status[service] = { tabFound: false, isGenerating: false, isReady: false, chars: 0 };
        }
      } catch (e) {
        console.error(`Status check error for ${service}:`, e);
        status[service] = { tabFound: true, isGenerating: false, isReady: false, chars: 0, error: e.message };
      }
    })
  );

  await chrome.storage.local.set({ councilTabs: stored });
  return status;
}

// Scrape latest responses (passive inspect only, respects targetServices)
async function scrapeAllResponses(targetServices) {
  const services = Array.isArray(targetServices)
    ? targetServices
    : ["chatgpt", "claude", "gemini", "grok"];

  if (services.length === 0) return {};

  const allTabs = await chrome.tabs.query({});
  const stored = await getStoredTabs();
  const results = {};

  await Promise.all(
    services.map(async (service) => {
      try {
        const cfg = serviceConfigs[service];
        if (!cfg) return;
        const tabId = await getValidTabForService(service, allTabs, stored);

        if (tabId) {
          const execRes = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: cfg.scraper
          });
          results[service] = execRes && execRes[0] ? execRes[0].result : "";
        } else {
          results[service] = "";
        }
      } catch (e) {
        console.error(`Scrape error for ${service}:`, e);
        results[service] = "";
      }
    })
  );

  await chrome.storage.local.set({ councilTabs: stored });
  return results;
}

// ---------------- DOM INJECTION FUNCTIONS ---------------- //

function injectGrok(promptText) {
  return new Promise((resolve) => {
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;

      const closeBtn = document.querySelector('button[aria-label="Close"], button[aria-label="Dismiss"]');
      if (closeBtn && closeBtn.offsetParent !== null) closeBtn.click();

      const el = document.querySelector("textarea") ||
                 document.querySelector('div[contenteditable="true"]') ||
                 document.querySelector('[data-testid="tweetTextarea_0"]') ||
                 document.querySelector('input[type="text"]');

      if (el) {
        clearInterval(interval);
        el.focus();
        el.click();

        try {
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        } catch (e) {}

        if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
          try {
            const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
            setter.call(el, promptText);
          } catch (e) {
            el.value = promptText;
          }
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }

        document.execCommand("selectAll", false, null);
        document.execCommand("insertText", false, promptText);
        try {
          el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: promptText }));
        } catch (e) {}
        el.dispatchEvent(new Event("input", { bubbles: true }));

        let sendAttempts = 0;
        const sendCheck = setInterval(() => {
          sendAttempts++;
          let sendBtn = document.querySelector('button[type="submit"]');

          if (!sendBtn) {
            const btns = Array.from(document.querySelectorAll("button"));
            sendBtn = btns.find(b => {
              const aria = (b.getAttribute("aria-label") || "").toLowerCase();
              const text = (b.innerText || "").toLowerCase();
              if (text.includes("grok 2") || text.includes("grok 3") || text.includes("think") || text.includes("model") || text.includes("attach")) {
                return false;
              }
              return aria.includes("submit") || aria.includes("send") || (aria.includes("grok") && !text.includes("grok"));
            });
          }

          if (!sendBtn) {
            const form = el.closest("form") || el.closest("div:has(button)");
            if (form) {
              const formBtns = Array.from(form.querySelectorAll("button")).filter(b => {
                const text = (b.innerText || "").toLowerCase();
                return !text.includes("grok 2") && !text.includes("grok 3") && !text.includes("model");
              });
              if (formBtns.length > 0) sendBtn = formBtns[formBtns.length - 1];
            }
          }

          const isReady = sendBtn && !sendBtn.disabled && sendBtn.getAttribute("aria-disabled") !== "true";
          if (isReady) {
            clearInterval(sendCheck);
            sendBtn.removeAttribute("disabled");
            ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach(evt => {
              sendBtn.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window }));
            });
            resolve({ status: "sent", method: "button_click" });
          } else if (sendAttempts >= 8) {
            clearInterval(sendCheck);
            if (sendBtn) {
              sendBtn.removeAttribute("disabled");
              sendBtn.click();
            }
            ["keydown", "keypress", "keyup"].forEach(type => {
              el.dispatchEvent(new KeyboardEvent(type, {
                key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true
              }));
            });
            resolve({ status: "sent", method: sendBtn ? "button_and_enter" : "enter_only" });
          }
        }, 120);

      } else if (attempts > 20) {
        clearInterval(interval);
        resolve({ status: "failed", reason: "grok_not_found" });
      }
    }, 150);
  });
}

function injectChatGPT(promptText) {
  return new Promise((resolve) => {
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;

      const closeBtn = document.querySelector('button[data-testid="close-button"], button[aria-label="Close"], button[aria-label="Dismiss"]');
      if (closeBtn) closeBtn.click();

      const el = document.querySelector("#prompt-textarea") ||
                 document.querySelector('div[contenteditable="true"]') ||
                 document.querySelector("textarea");

      if (el) {
        clearInterval(interval);
        el.focus();
        el.click();

        try {
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        } catch (e) {}

        if (el.tagName === "TEXTAREA") {
          try {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
            setter.call(el, promptText);
          } catch (e) {
            el.value = promptText;
          }
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
          document.execCommand("selectAll", false, null);
          const ok = document.execCommand("insertText", false, promptText);
          if (!ok || !el.textContent.includes(promptText.slice(0, 5))) {
            el.innerHTML = `<p>${promptText.replace(/\n/g, '<br>')}</p>`;
          }
          try {
            el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: promptText }));
          } catch (e) {}
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }

        let sendAttempts = 0;
        const sendCheck = setInterval(() => {
          sendAttempts++;
          const btn = document.querySelector('button[data-testid="send-button"]') ||
                      document.querySelector('button[aria-label*="Send"]');

          const isReady = btn && !btn.disabled && btn.getAttribute("aria-disabled") !== "true";
          if (isReady) {
            clearInterval(sendCheck);
            btn.removeAttribute("disabled");
            ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach(evt => {
              btn.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window }));
            });
            resolve({ status: "sent", method: "button_click" });
          } else if (sendAttempts >= 8) {
            clearInterval(sendCheck);
            if (btn) {
              btn.removeAttribute("disabled");
              btn.click();
            }
            ["keydown", "keypress", "keyup"].forEach(type => {
              el.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
            });
            resolve({ status: "sent", method: "enter_press" });
          }
        }, 120);

      } else if (attempts > 20) {
        clearInterval(interval);
        resolve({ status: "failed", reason: "chatgpt_textarea_not_found" });
      }
    }, 150);
  });
}

function injectClaude(promptText) {
  return new Promise((resolve) => {
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;

      const el = document.querySelector('div.ProseMirror[contenteditable="true"]') ||
                 document.querySelector('div[contenteditable="true"]');

      if (el) {
        clearInterval(interval);
        el.focus();
        el.click();

        try {
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        } catch (e) {}

        document.execCommand("selectAll", false, null);
        const ok = document.execCommand("insertText", false, promptText);
        if (!ok || !el.textContent.includes(promptText.slice(0, 5))) {
          el.innerHTML = `<p>${promptText.replace(/\n/g, '<br>')}</p>`;
        }
        try {
          el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: promptText }));
        } catch (e) {}
        el.dispatchEvent(new Event("input", { bubbles: true }));

        let sendAttempts = 0;
        const sendCheck = setInterval(() => {
          sendAttempts++;
          const btn = document.querySelector('button[aria-label*="Send"]') ||
                      document.querySelector('button[aria-label="Send Message"]') ||
                      document.querySelector('fieldset button:last-child');

          const isReady = btn && !btn.disabled && btn.getAttribute("aria-disabled") !== "true";
          if (isReady) {
            clearInterval(sendCheck);
            btn.removeAttribute("disabled");
            ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach(evt => {
              btn.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window }));
            });
            resolve({ status: "sent", method: "button_click" });
          } else if (sendAttempts >= 8) {
            clearInterval(sendCheck);
            if (btn) {
              btn.removeAttribute("disabled");
              btn.click();
            }
            ["keydown", "keypress", "keyup"].forEach(type => {
              el.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
            });
            resolve({ status: "sent", method: "enter_press" });
          }
        }, 120);

      } else if (attempts > 20) {
        clearInterval(interval);
        resolve({ status: "failed", reason: "claude_input_not_found" });
      }
    }, 150);
  });
}

function injectGemini(promptText) {
  return new Promise((resolve) => {
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;

      const dismissBtn = document.querySelector('button[aria-label="Dismiss"], button.dismiss-button');
      if (dismissBtn) dismissBtn.click();

      const el = document.querySelector('rich-textarea div[contenteditable="true"]') ||
                 document.querySelector('div.ql-editor') ||
                 document.querySelector('div[contenteditable="true"]');

      if (el) {
        clearInterval(interval);
        el.focus();
        el.click();

        try {
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        } catch (e) {}

        document.execCommand("selectAll", false, null);
        const ok = document.execCommand("insertText", false, promptText);
        if (!ok || !el.textContent.includes(promptText.slice(0, 5))) {
          el.innerHTML = `<p>${promptText.replace(/\n/g, '<br>')}</p>`;
        }
        try {
          el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: promptText }));
        } catch (e) {}
        el.dispatchEvent(new Event("input", { bubbles: true }));

        let sendAttempts = 0;
        const sendCheck = setInterval(() => {
          sendAttempts++;
          const btn = document.querySelector('button[aria-label*="Send"]') ||
                      document.querySelector('button.send-button') ||
                      document.querySelector('.send-button-container button');

          const isReady = btn && !btn.disabled && btn.getAttribute("aria-disabled") !== "true";
          if (isReady) {
            clearInterval(sendCheck);
            btn.removeAttribute("disabled");
            ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach(evt => {
              btn.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window }));
            });
            resolve({ status: "sent", method: "button_click" });
          } else if (sendAttempts >= 8) {
            clearInterval(sendCheck);
            if (btn) {
              btn.removeAttribute("disabled");
              btn.click();
            }
            ["keydown", "keypress", "keyup"].forEach(type => {
              el.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
            });
            resolve({ status: "sent", method: "enter_press" });
          }
        }, 120);

      } else if (attempts > 20) {
        clearInterval(interval);
        resolve({ status: "failed", reason: "gemini_input_not_found" });
      }
    }, 150);
  });
}

// ---------------- SELF-CONTAINED STATUS CHECKERS ---------------- //

function checkChatGPTStatus() {
  const stopBtn = document.querySelector(
    'button[data-testid="stop-button"], ' +
    'button[aria-label*="Stop"], ' +
    'button[aria-label*="stop"], ' +
    '[data-is-streaming="true"]'
  );
  const isGenerating = !!stopBtn;

  let text = "";

  // Strategy A: data-message-author-role="assistant"
  const assistantNodes = document.querySelectorAll('[data-message-author-role="assistant"]');
  if (assistantNodes.length > 0) {
    const lastNode = assistantNodes[assistantNodes.length - 1];
    const prose = lastNode.querySelector('.markdown, [class*="markdown"], [class*="prose"]') || lastNode;
    text = (prose.innerText || "").trim();
  }

  // Strategy B: Located via Copy button container (ChatGPT puts copy buttons only on assistant responses)
  if (!text || text.length < 10) {
    const copyBtns = Array.from(document.querySelectorAll('button[aria-label*="Copy"], button[aria-label*="copy"], button[data-testid*="copy"]'));
    if (copyBtns.length > 0) {
      const lastCopy = copyBtns[copyBtns.length - 1];
      const turn = lastCopy.closest('article, [data-testid^="conversation-turn-"], [class*="conversation-turn"], div[class*="group"]');
      if (turn) {
        const prose = turn.querySelector('.markdown, [class*="markdown"], [class*="prose"]') || turn;
        text = (prose.innerText || "").trim();
      }
    }
  }

  // Strategy C: Markdown / Prose elements
  if (!text || text.length < 10) {
    const markdowns = Array.from(document.querySelectorAll('.markdown, [class*="markdown"], [class*="prose"]'));
    for (let i = markdowns.length - 1; i >= 0; i--) {
      const md = markdowns[i];
      if (!md.closest('[data-message-author-role="user"]')) {
        const candidate = (md.innerText || "").trim();
        if (candidate.length > 10) {
          text = candidate;
          break;
        }
      }
    }
  }

  // Strategy D: Articles / conversation-turns
  if (!text || text.length < 10) {
    const articles = Array.from(document.querySelectorAll('article, [data-testid^="conversation-turn-"], [class*="conversation-turn"]'));
    for (let i = articles.length - 1; i >= 0; i--) {
      const art = articles[i];
      if (!art.querySelector('[data-message-author-role="user"]')) {
        const candidate = (art.innerText || "").trim();
        if (candidate.length > 10) {
          text = candidate;
          break;
        }
      }
    }
  }

  // Strategy E: Any agent turn or message bubble
  if (!text || text.length < 10) {
    const turns = document.querySelectorAll('.agent-turn, [class*="agent-turn"], div[data-message-id]');
    if (turns.length > 0) {
      text = (turns[turns.length - 1].innerText || "").trim();
    }
  }

  // Strategy F: Look inside <main> for paragraph content
  if (!text || text.length < 10) {
    const main = document.querySelector('main');
    if (main) {
      const ps = Array.from(main.querySelectorAll('p'));
      if (ps.length > 0) {
        const lastP = ps[ps.length - 1];
        const parent = lastP.parentElement;
        if (parent && !parent.closest('form')) {
          text = (parent.innerText || "").trim();
        }
      }
    }
  }

  const chars = text.length;
  const isReady = !isGenerating && chars > 15;

  return {
    isGenerating: isGenerating,
    isReady: isReady,
    chars: chars,
    turnCount: assistantNodes.length
  };
}

function checkClaudeStatus() {
  const isGenerating = !!document.querySelector('button[aria-label*="Stop"], [data-is-streaming="true"]');
  const turns = document.querySelectorAll('div[data-testid="user-message"] ~ div, .font-claude-message');
  const turnCount = turns.length;
  let text = "";
  if (turns.length > 0) {
    text = turns[turns.length - 1].innerText.trim();
  } else {
    const msgs = document.querySelectorAll('.standard-markdown');
    if (msgs.length > 0) text = msgs[msgs.length - 1].innerText.trim();
  }
  const chars = text.length;
  return {
    isGenerating: isGenerating,
    isReady: !isGenerating && chars > 15,
    chars: chars,
    turnCount: turnCount
  };
}

function checkGeminiStatus() {
  const isGenerating = !!document.querySelector('button[aria-label*="Stop"], .sparkle-animation');
  const msgs = document.querySelectorAll('message-content, .model-response-text, div[aria-label="Model response"]');
  const turnCount = msgs.length;
  let text = "";
  if (msgs.length > 0) {
    text = msgs[msgs.length - 1].innerText.trim();
  } else {
    const mds = document.querySelectorAll('.markdown');
    if (mds.length > 0) text = mds[mds.length - 1].innerText.trim();
  }
  const chars = text.length;
  return {
    isGenerating: isGenerating,
    isReady: !isGenerating && chars > 15,
    chars: chars,
    turnCount: turnCount
  };
}

function checkGrokStatus() {
  const isGenerating = !!document.querySelector('button[aria-label*="Stop"]');
  const msgs = document.querySelectorAll('.message-bubble, [data-testid="messageEntry"], article');
  const turnCount = msgs.length;
  let text = "";
  if (msgs.length > 0) {
    text = msgs[msgs.length - 1].innerText.trim();
  } else {
    const bubbles = document.querySelectorAll('div[dir="auto"]');
    if (bubbles.length > 1) text = bubbles[bubbles.length - 1].innerText.trim();
  }
  const chars = text.length;
  return {
    isGenerating: isGenerating,
    isReady: !isGenerating && chars > 15,
    chars: chars,
    turnCount: turnCount
  };
}

// ---------------- DEEP SCRAPING FUNCTIONS ---------------- //

function scrapeChatGPT() {
  let text = "";

  // Strategy A: data-message-author-role="assistant"
  const assistantNodes = document.querySelectorAll('[data-message-author-role="assistant"]');
  if (assistantNodes.length > 0) {
    const lastNode = assistantNodes[assistantNodes.length - 1];
    const prose = lastNode.querySelector('.markdown, [class*="markdown"], [class*="prose"]') || lastNode;
    text = (prose.innerText || "").trim();
    if (text.length > 10) return text;
  }

  // Strategy B: Located via Copy button container
  const copyBtns = Array.from(document.querySelectorAll('button[aria-label*="Copy"], button[aria-label*="copy"], button[data-testid*="copy"]'));
  if (copyBtns.length > 0) {
    const lastCopy = copyBtns[copyBtns.length - 1];
    const turn = lastCopy.closest('article, [data-testid^="conversation-turn-"], [class*="conversation-turn"], div[class*="group"]');
    if (turn) {
      const prose = turn.querySelector('.markdown, [class*="markdown"], [class*="prose"]') || turn;
      text = (prose.innerText || "").trim();
      if (text.length > 10) return text;
    }
  }

  // Strategy C: Markdown / Prose elements
  const markdowns = Array.from(document.querySelectorAll('.markdown, [class*="markdown"], [class*="prose"]'));
  if (markdowns.length > 0) {
    for (let i = markdowns.length - 1; i >= 0; i--) {
      const md = markdowns[i];
      if (!md.closest('[data-message-author-role="user"]')) {
        text = (md.innerText || "").trim();
        if (text.length > 10) return text;
      }
    }
  }

  // Strategy D: Articles / conversation-turns
  const articles = Array.from(document.querySelectorAll('article, [data-testid^="conversation-turn-"], [class*="conversation-turn"]'));
  if (articles.length > 0) {
    for (let i = articles.length - 1; i >= 0; i--) {
      const art = articles[i];
      if (!art.querySelector('[data-message-author-role="user"]')) {
        const prose = art.querySelector('.markdown, [class*="markdown"], [class*="prose"]') || art;
        text = (prose.innerText || "").trim();
        if (text.length > 10) return text;
      }
    }
  }

  // Strategy E: Agent turn
  const agentTurns = document.querySelectorAll('.agent-turn, [class*="agent-turn"], div[data-message-id]');
  if (agentTurns.length > 0) {
    text = (agentTurns[agentTurns.length - 1].innerText || "").trim();
    if (text.length > 10) return text;
  }

  // Strategy F: Look inside <main>
  const main = document.querySelector('main');
  if (main) {
    const ps = Array.from(main.querySelectorAll('p'));
    if (ps.length > 0) {
      const lastP = ps[ps.length - 1];
      const parent = lastP.parentElement;
      if (parent && !parent.closest('form')) {
        return (parent.innerText || "").trim();
      }
    }
  }

  return "";
}

function scrapeClaude() {
  const turns = document.querySelectorAll('div[data-testid="user-message"] ~ div, .font-claude-message');
  if (turns.length > 0) {
    const last = turns[turns.length - 1];
    const text = (last.innerText || "").trim();
    if (text.length > 5) return text;
  }
  const msgs = document.querySelectorAll('.standard-markdown, [class*="font-claude-message"]');
  if (msgs.length > 0) return msgs[msgs.length - 1].innerText.trim();
  return "";
}

function scrapeGemini() {
  const msgs = document.querySelectorAll('message-content, .model-response-text, .response-container-content, div[aria-label="Model response"]');
  if (msgs.length > 0) {
    const last = msgs[msgs.length - 1];
    const text = (last.innerText || "").trim();
    if (text.length > 5) return text;
  }
  const renderedText = document.querySelectorAll('.markdown');
  if (renderedText.length > 0) {
    const last = renderedText[renderedText.length - 1];
    if (!last.closest('[data-message-author-role="user"]')) {
      return (last.innerText || "").trim();
    }
  }
  return "";
}

function scrapeGrok() {
  const msgs = document.querySelectorAll('.message-bubble, [data-testid="messageEntry"], .grok-response, article');
  if (msgs.length > 0) {
    const last = msgs[msgs.length - 1];
    const text = (last.innerText || "").trim();
    if (text.length > 5) return text;
  }
  const bubbles = document.querySelectorAll('div[dir="auto"]');
  if (bubbles.length > 1) return bubbles[bubbles.length - 1].innerText.trim();
  return "";
}

// ---------------- MESSAGE LISTENER ---------------- //

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "DISPATCH_PROMPT") {
    dispatchToAll(request.prompt, request.targets).then((results) => {
      sendResponse({ status: "complete", results });
    });
    return true;
  }

  if (request.action === "SEND_SINGLE") {
    sendToService(request.service, request.prompt).then((result) => {
      sendResponse({ status: "complete", result });
    });
    return true;
  }

  if (request.action === "CHECK_GENERATION_STATUS") {
    checkAllStatus(request.targets).then((status) => {
      sendResponse({ status });
    });
    return true;
  }

  if (request.action === "AUTO_SEND_PEER_REVIEWS") {
    const targets = Array.isArray(request.targets)
      ? request.targets
      : Object.keys(request.prompts || {});

    if (targets.length === 0) {
      sendResponse({ status: "complete", results: {} });
      return true;
    }

    (async () => {
      const currentTabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const originTabId = currentTabs.length > 0 ? currentTabs[0].id : null;
      const results = {};

      for (const s of targets) {
        if (request.prompts && request.prompts[s]) {
          results[s] = await sendToService(s, request.prompts[s]);
        }
      }

      if (originTabId) {
        try {
          await chrome.tabs.update(originTabId, { active: true });
        } catch (e) {}
      }

      sendResponse({ status: "complete", results });
    })();
    return true;
  }

  if (request.action === "SCRAPE_ALL") {
    scrapeAllResponses(request.targets).then((answers) => {
      sendResponse({ answers });
    });
    return true;
  }

  if (request.action === "SCRAPE_SINGLE") {
    scrapeSingleService(request.service).then((answer) => {
      sendResponse({ answer });
    });
    return true;
  }
});
