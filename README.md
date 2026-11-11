# 🦜 Parrot — TL;DL, Too Long, Do Listen

A Firefox extension that reads the current page and either:

1. **Summarizes** it: the gist streams into a side panel (Claude, ChatGPT, or any OpenAI-compatible model)
2. **Reads it out loud**, unchanged, sentence by sentence with highlighting
3. **Both**: summarizes, then reads the summary out loud

If you select text first, Parrot works on the selection instead of the whole page.

## Install (development)

```sh
npm install
npm start          # launches a fresh Firefox profile with Parrot loaded
```

Or load it into your own Firefox: `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → pick `manifest.json`.
A temporary add-on stays until Firefox restarts. To keep it for good, run `npm run build` and sign the zip on [addons.mozilla.org](https://addons.mozilla.org/developers/) (an unlisted add-on is fine for personal use).

Requires Firefox 140+.

## Setup

Open the settings (popup → **Settings**) and choose:

- **Summary provider**:
  - **Claude**: Anthropic API key, default model `claude-haiku-5-5`, the cheapest (`claude-sonnet-5-5` / `claude-opus-5-5` cost more and can catch more nuance)
  - **ChatGPT**: OpenAI API key, default model `gpt-5.6-luna`, the cheapest (`gpt-5.6-terra` / `gpt-5.6-sol` cost more). Models OpenAI shuts down on 2026-12-11 (`gpt-5`, `gpt-5-mini`, `gpt-5-nano`, `gpt-5-pro`, `o3`, `o3-pro`) are switched to their replacement automatically
  - **Other**: any OpenAI-compatible `/chat/completions` endpoint (Ollama, LM Studio, Mistral, OpenRouter, Groq…)
- **Voice**:
  - **Browser voice**: free and offline, uses your system voices
  - **OpenAI voice**: natural voices (`gpt-4o-mini-tts`), needs an OpenAI key. Claude has no text-to-speech API.

Click **Save**: Firefox asks for permission to reach the provider you picked.

## Use

- Click the parrot in the toolbar, then **Summarize**, **Read out loud**, or **Summarize & read**.
- Shortcuts: `Alt+Shift+S` summarize, `Alt+Shift+R` read, `Alt+Shift+L` summarize & read.
- In the panel: play/pause, stop, speed. Click any sentence to jump there. Switch between **Summary** and **Original**, or copy the text.

## Cost

The panel shows what the current page has cost so far (summary + OpenAI voice), e.g. `≈ $0.036`; hover it for the token breakdown. The popup shows the running total since the last reset.

Token counts come from the provider; dollar amounts are estimates from the list prices in `src/usage.js`, so update that table when prices change. Models without a known price (custom providers, new releases) show token counts only. The browser voice is free.

To keep costs down, Parrot:

- reuses a summary for the rest of the browser session when you summarize the same page again with the same settings (the panel shows `cached`);
- sends at most the first 100,000 characters of a page (about 25k tokens): longer pages are summarized from their beginning, and the panel shows how much was covered;
- drops query strings and fragments (mostly tracking parameters) from the URL it sends;
- asks OpenAI reasoning models (`gpt-5*`, `o*`) for `low` reasoning effort, as Claude already gets `low` effort.

## Layout

```
manifest.json
src/content.js     page text extraction + mounts the panel iframe
src/providers.js   Claude / OpenAI / OpenAI-compatible streaming summaries, OpenAI TTS
src/usage.js       list prices, cost per request, running total
src/speech.js      chunked playback (browser speechSynthesis or OpenAI audio), highlighting, seek
src/settings.js    defaults and storage
panel/             the side panel (runs as an extension page, so API keys never reach the website)
popup/             toolbar popup
options/           settings page
icons/parrot.svg
```

## Privacy

API keys are stored in `browser.storage.local` and are sent only to the provider you pick. Page text leaves your machine only when you ask for a summary, or for reading aloud with an OpenAI voice.
