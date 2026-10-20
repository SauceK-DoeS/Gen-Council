// bridge.js - Runs inside the AI Council Web App tab
console.log("[AI Council Bridge] Content script initialized on Council Chamber.");

window.postMessage({ type: "COUNCIL_BRIDGE_READY" }, "*");

window.addEventListener("message", (event) => {
  if (!event.data || typeof event.data !== "object") return;

  if (event.data.type === "CHECK_BRIDGE") {
    window.postMessage({ type: "COUNCIL_BRIDGE_READY" }, "*");
  }

  // Dispatch Round 1 Prompt to targeted tabs (only tabs selected by user)
  if (event.data.type === "COUNCIL_RUN_PROMPT") {
    chrome.runtime.sendMessage({ 
      action: "DISPATCH_PROMPT", 
      prompt: event.data.prompt,
      targets: event.data.targets 
    }, (response) => {
      window.postMessage({
        type: "COUNCIL_DISPATCH_RESULT",
        result: response
      }, "*");
    });
  }

  // Retry sending to just ONE specific model tab
  if (event.data.type === "COUNCIL_SEND_SINGLE") {
    chrome.runtime.sendMessage({ 
      action: "SEND_SINGLE", 
      service: event.data.service, 
      prompt: event.data.prompt 
    }, (response) => {
      window.postMessage({
        type: "COUNCIL_SINGLE_RESULT",
        service: event.data.service,
        result: response
      }, "*");
    });
  }

  // Check live generation status across targeted tabs
  if (event.data.type === "COUNCIL_CHECK_STATUS") {
    chrome.runtime.sendMessage({ 
      action: "CHECK_GENERATION_STATUS",
      targets: event.data.targets
    }, (response) => {
      window.postMessage({
        type: "COUNCIL_STATUS_RESULT",
        status: response ? response.status : null
      }, "*");
    });
  }

  // Auto-fetch latest responses from targeted tabs
  if (event.data.type === "COUNCIL_AUTO_FETCH") {
    chrome.runtime.sendMessage({ 
      action: "SCRAPE_ALL",
      targets: event.data.targets
    }, (response) => {
      window.postMessage({
        type: "COUNCIL_FETCHED_ANSWERS",
        answers: response ? response.answers : null
      }, "*");
    });
  }

  // Auto-fetch just ONE specific AI tab's response
  if (event.data.type === "COUNCIL_FETCH_SINGLE") {
    chrome.runtime.sendMessage({ action: "SCRAPE_SINGLE", service: event.data.service }, (response) => {
      window.postMessage({
        type: "COUNCIL_FETCHED_SINGLE_ANSWER",
        service: event.data.service,
        answer: response ? response.answer : ""
      }, "*");
    });
  }

  // Auto-dispatch tailored peer review prompts to targeted tabs
  if (event.data.type === "COUNCIL_AUTO_DISPATCH_PEER_REVIEWS") {
    chrome.runtime.sendMessage({ 
      action: "AUTO_SEND_PEER_REVIEWS", 
      prompts: event.data.prompts,
      targets: event.data.targets
    }, (response) => {
      window.postMessage({
        type: "COUNCIL_PEER_DISPATCH_RESULT",
        result: response
      }, "*");
    });
  }

  // Auto-fetch latest peer reviews from targeted tabs for automated scoring
  if (event.data.type === "COUNCIL_FETCH_SCORES") {
    chrome.runtime.sendMessage({ 
      action: "SCRAPE_ALL",
      targets: event.data.targets
    }, (response) => {
      window.postMessage({
        type: "COUNCIL_FETCHED_SCORES",
        reviews: response ? response.answers : null
      }, "*");
    });
  }
});
