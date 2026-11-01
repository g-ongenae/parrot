// Shared settings: defaults, load/save, and the host permissions each setup needs.

const PARROT_DEFAULTS = {
  // Summary
  summaryProvider: "anthropic", // anthropic | openai | custom
  anthropicKey: "",
  anthropicModel: "claude-haiku-5-5",
  openaiKey: "",
  openaiModel: "gpt-5-mini",
  customBaseUrl: "http://localhost:11434/v1",
  customKey: "",
  customModel: "llama3.2",
  summaryLength: "medium", // short | medium | detailed
  summaryLanguage: "", // empty = same language as the page

  // Read aloud
  ttsProvider: "browser", // browser | openai
  browserVoice: "", // voiceURI, empty = best match for the page language
  openaiTtsModel: "gpt-4o-mini-tts",
  openaiVoice: "coral",
  rate: 1,
};

const PROVIDER_LABELS = {
  anthropic: "Claude",
  openai: "ChatGPT",
  custom: "OpenAI-compatible",
  browser: "Browser voice",
};

async function loadSettings() {
  const stored = await browser.storage.local.get(PARROT_DEFAULTS);
  return { ...PARROT_DEFAULTS, ...stored };
}

function saveSettings(values) {
  return browser.storage.local.set(values);
}

function requiredOrigins(s) {
  const origins = new Set();
  if (s.summaryProvider === "anthropic") origins.add("https://api.anthropic.com/*");
  if (s.summaryProvider === "openai" || s.ttsProvider === "openai") origins.add("https://api.openai.com/*");
  if (s.summaryProvider === "custom") {
    try {
      origins.add(new URL(s.customBaseUrl).origin + "/*");
    } catch {
      // invalid URL is reported by the options page
    }
  }
  return [...origins];
}

function summaryProviderReady(s) {
  if (s.summaryProvider === "anthropic") return Boolean(s.anthropicKey);
  if (s.summaryProvider === "openai") return Boolean(s.openaiKey);
  return Boolean(s.customBaseUrl && s.customModel);
}

function ttsProviderReady(s) {
  return s.ttsProvider !== "openai" || Boolean(s.openaiKey);
}

function summaryModel(settings) {
  return { anthropic: settings.anthropicModel, openai: settings.openaiModel, custom: settings.customModel }[settings.summaryProvider].trim();
}

function summaryModelLabel(settings) {
  return `${PROVIDER_LABELS[settings.summaryProvider]} (${summaryModel(settings)})`;
}
