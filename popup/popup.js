const message = document.getElementById("message");

function warn(text) {
  message.hidden = false;
  message.textContent = text;
}

loadSettings().then((s) => {
  const voice = s.ttsProvider === "openai" ? `OpenAI ${s.openaiVoice}` : PROVIDER_LABELS.browser;
  document.getElementById("config").textContent = `${summaryModelLabel(s)} · ${voice}`;
  if (!summaryProviderReady(s)) warn(`Summaries need a ${PROVIDER_LABELS[s.summaryProvider]} API key: open Settings.`);
});

for (const button of document.querySelectorAll(".action")) {
  button.addEventListener("click", async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    try {
      await launchParrot(tab.id, button.dataset.mode);
      window.close();
    } catch (err) {
      console.warn(err);
      warn("Parrot can't read this page. Browser pages, the add-on store and PDF viewer are off-limits to extensions.");
    }
  });
}

document.getElementById("settings").addEventListener("click", () => {
  browser.runtime.openOptionsPage();
  window.close();
});
