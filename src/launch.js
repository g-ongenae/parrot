// Injects the content script into a tab and opens the Parrot panel in the given mode.
// mode: "summarize" | "read" | "both"

async function launchParrot(tabId, mode) {
  await browser.scripting.executeScript({ target: { tabId }, files: ["/src/content.js"] });
  await browser.scripting.executeScript({
    target: { tabId },
    func: (m) => window.__parrot.open(m),
    args: [mode],
  });
}
