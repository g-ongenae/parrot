// Keyboard shortcuts (Alt+Shift+S / R / L) open Parrot without going through the popup.

browser.commands.onCommand.addListener(async (command, tab) => {
  const target = tab ?? (await browser.tabs.query({ active: true, currentWindow: true }))[0];
  if (!target?.id) return;
  try {
    await launchParrot(target.id, command);
  } catch (err) {
    console.warn("Parrot cannot run on this page:", err);
  }
});

// ---------- summary cache ----------
// Kept here because the panel, framed in the page, has no storage.session in Firefox.
// The panel asks for entries by message (see getCachedSummary in src/providers.js).

const SUMMARY_CACHE_KEY = "summaryCache";
const SUMMARY_CACHE_SIZE = 50;

async function loadSummaryCache() {
  const { [SUMMARY_CACHE_KEY]: entries } = await browser.storage.session.get(SUMMARY_CACHE_KEY);
  return entries ?? [];
}

// Most recent first; the oldest entries are dropped past SUMMARY_CACHE_SIZE.
async function putSummary(key, text) {
  const entries = (await loadSummaryCache()).filter((entry) => entry.key !== key);
  entries.unshift({ key, text });
  await browser.storage.session.set({ [SUMMARY_CACHE_KEY]: entries.slice(0, SUMMARY_CACHE_SIZE) });
}

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "summaryCache.get") {
    return loadSummaryCache().then((entries) => entries.find((entry) => entry.key === message.key)?.text ?? null);
  }
  if (message?.type === "summaryCache.put") return putSummary(message.key, message.text);
  return undefined;
});
