const form = document.getElementById("form");
const savedLabel = document.getElementById("saved");
const voiceSelect = document.getElementById("browser-voices");
let current = { ...PARROT_DEFAULTS };
let testSpeaker = null;

function fields() {
  return [...form.querySelectorAll("[name]")];
}

function fill(values) {
  for (const el of fields()) {
    if (el.type === "radio") el.checked = el.value === values[el.name];
    else el.value = String(values[el.name] ?? "");
  }
}

function read() {
  const values = {};
  for (const el of fields()) {
    if (el.type === "radio") {
      if (el.checked) values[el.name] = el.value;
    } else if (!(el.name in values)) {
      values[el.name] = el.name === "rate" ? Number(el.value) : el.value.trim();
    }
  }
  return values;
}

function updateVisibility() {
  const values = read();
  for (const el of form.querySelectorAll("[data-show]")) {
    const [, key, negate, expected] = el.dataset.show.match(/^(\w+)(!?)=(\w+)$/);
    el.hidden = (values[key] === expected) === Boolean(negate);
  }
}

function populateVoices() {
  const voices = speechSynthesis.getVoices().sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
  voiceSelect.replaceChildren(voiceSelect.options[0]);
  for (const voice of voices) {
    voiceSelect.append(new Option(`${voice.name} (${voice.lang})`, voice.voiceURI));
  }
  voiceSelect.value = current.browserVoice;
}

// The same API key field appears in two sections; keep the copies in sync.
form.addEventListener("input", (event) => {
  const el = event.target;
  if (el.name) for (const twin of form.querySelectorAll(`[name="${el.name}"]:not([type=radio])`)) twin.value = el.value;
  savedLabel.hidden = true;
});
form.addEventListener("change", updateVisibility);

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const values = read();
  if (values.summaryProvider === "custom") {
    try {
      new URL(values.customBaseUrl);
    } catch {
      savedLabel.hidden = false;
      savedLabel.textContent = "The base URL is not a valid URL.";
      return;
    }
  }
  // Must be called synchronously from the click so Firefox shows the permission prompt.
  const permission = browser.permissions.request({ origins: requiredOrigins(values) });
  permission
    .catch(() => false)
    .then(async (granted) => {
      await saveSettings(values);
      current = { ...current, ...values };
      savedLabel.hidden = false;
      savedLabel.textContent = granted ? "Saved ✓" : "Saved, but Parrot wasn't allowed to reach the provider. Save again to retry.";
    });
});

document.getElementById("test-voice").addEventListener("click", () => {
  testSpeaker?.stop();
  const settings = { ...current, ...read() };
  if (!ttsProviderReady(settings)) {
    savedLabel.hidden = false;
    savedLabel.textContent = "Add an OpenAI API key to test OpenAI voices.";
    return;
  }
  testSpeaker = new Speaker(settings, navigator.language);
  testSpeaker.addEventListener("error", (e) => {
    savedLabel.hidden = false;
    savedLabel.textContent = e.detail.message;
  });
  testSpeaker.play(["Hi, I'm Parrot. Too long? Do listen."]);
});

loadSettings().then((settings) => {
  current = settings;
  fill(settings);
  populateVoices();
  updateVisibility();
});
speechSynthesis.addEventListener("voiceschanged", populateVoices);
