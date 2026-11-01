// The Parrot panel, framed into the page by content.js. It receives the extracted page as a "job",
// then summarizes and/or reads it out loud.

const $ = (id) => document.getElementById(id);
const nonce = location.hash.slice(1);

let settings;
let job;
let speaker;
let view = "original"; // which text is displayed: "summary" | "original"
let playingView = null; // which text the speaker is reading
let summaryText = "";
let summaryState = "idle"; // idle | running | done | error
let summaryAbort = null;
let renderQueued = false;
let summaryUsage = null; // token counts of the summary request
let speechUsage = { characters: 0, cost: 0, priced: true, model: "" }; // OpenAI voice, all chunks

function post(message) {
  window.parent.postMessage(JSON.stringify({ ...message, nonce }), "*");
}

window.addEventListener("message", (event) => {
  if (event.source !== window.parent || typeof event.data !== "string") return;
  let message;
  try {
    message = JSON.parse(event.data);
  } catch {
    return;
  }
  if (message.nonce === nonce && message.type === "job" && !job) start(message.job);
});
post({ type: "ready" });

// ---------- text -> blocks -> chunks ----------

const stripInline = (text) => text.replace(/\*\*|__|`/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

function parseSummary(markdown) {
  const blocks = [];
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ type: "p", text: paragraph.join(" ") });
    paragraph = [];
  };
  for (const raw of markdown.split("\n")) {
    const line = stripInline(raw.trim());
    let match;
    if (!line) flush();
    else if ((match = line.match(/^#{1,6}\s+(.*)/))) {
      flush();
      blocks.push({ type: "h", text: match[1] });
    } else if ((match = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)/))) {
      flush();
      blocks.push({ type: "li", text: match[1] });
    } else paragraph.push(line);
  }
  flush();
  return blocks;
}

function blocksToText(blocks) {
  return blocks
    .map((b) => (b.type === "h" ? `## ${b.text}` : b.type === "li" ? `- ${b.text}` : b.text))
    .join("\n\n");
}

function blocksFor(which) {
  return which === "summary" ? parseSummary(summaryText) : job.blocks;
}

// Renders blocks into the content area; each chunk becomes a clickable span the speaker can highlight.
function render() {
  renderQueued = false;
  const content = $("content");
  const blocks = blocksFor(view);
  const fragment = document.createDocumentFragment();
  let list = null;
  let index = 0;

  for (const block of blocks) {
    let el;
    if (block.type === "li") {
      if (!list) {
        list = document.createElement("ul");
        fragment.append(list);
      }
      el = document.createElement("li");
      list.append(el);
    } else {
      list = null;
      el = document.createElement(block.type === "h" ? "h3" : "p");
      fragment.append(el);
    }
    for (const chunk of chunkText(block.text, speaker.chunkSize, job.lang)) {
      const span = document.createElement("span");
      span.className = "chunk";
      span.dataset.index = index++;
      span.textContent = chunk;
      el.append(span);
    }
  }

  if (!blocks.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = view === "summary" && summaryState !== "running" ? "No summary yet." : view === "summary" ? "" : "No readable text found on this page.";
    fragment.append(empty);
  }

  const wasAtBottom = content.scrollTop + content.clientHeight >= content.scrollHeight - 8;
  content.replaceChildren(fragment);
  if (playingView === view && isActive()) highlight(speaker.index, false);
  else if (summaryState === "running" && view === "summary" && wasAtBottom) content.scrollTop = content.scrollHeight;
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(render);
}

function chunksFor(which) {
  const chunks = [];
  for (const block of blocksFor(which)) chunks.push(...chunkText(block.text, speaker.chunkSize, job.lang));
  return chunks;
}

function highlight(index, scroll = true) {
  for (const el of document.querySelectorAll(".chunk.current")) el.classList.remove("current");
  if (playingView !== view) return;
  const el = document.querySelector(`.chunk[data-index="${index}"]`);
  if (!el) return;
  el.classList.add("current");
  if (scroll) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// ---------- UI state ----------

function setStatus(text) {
  $("status").hidden = !text;
  $("status-text").textContent = text ?? "";
}

function showError(message) {
  $("error").hidden = !message;
  $("error-text").textContent = message ?? "";
}

function explain(err) {
  if (err instanceof TypeError && /fetch|network/i.test(err.message)) {
    return `${err.message}\nCheck your connection, and that Parrot is allowed to reach the provider (Settings → Save grants access).`;
  }
  return err.message ?? String(err);
}

function showView(which) {
  view = which;
  for (const tab of document.querySelectorAll(".tabs button")) {
    tab.setAttribute("aria-selected", String(tab.dataset.view === which));
  }
  render();
  updatePlayer();
}

function isActive() {
  return ["playing", "paused", "loading"].includes(speaker?.state);
}

function updatePlayer() {
  const state = speaker?.state ?? "stopped";
  const activeHere = playingView === view && isActive();
  const [icon, label] = !activeHere
    ? ["▶", view === "summary" ? "Listen to summary" : "Listen"]
    : state === "playing"
      ? ["❚❚", "Pause"]
      : state === "loading"
        ? ["…", "Loading"]
        : ["▶", "Resume"];
  $("play-icon").textContent = icon;
  $("play-label").textContent = label;
  $("play").disabled = view === "summary" && summaryState !== "done";
  $("stop").disabled = state === "stopped" || state === "done";
}

// What this page has cost so far: the summary request plus any OpenAI speech.
function updateUsage() {
  const parts = [];
  const details = [];
  let cost = 0;
  let priced = true;
  if (summaryUsage) {
    const summaryCost = costOf(summaryUsage);
    const tokens = `${formatCount(summaryUsage.input + summaryUsage.cacheRead + summaryUsage.cacheWrite)} in · ${formatCount(summaryUsage.output)} out`;
    details.push(`Summary (${summaryUsage.model}): ${tokens} tokens${summaryCost == null ? ", price unknown" : ` = ${formatCost(summaryCost)}`}`);
    if (summaryCost == null) {
      priced = false;
      parts.push(`${tokens} tokens`);
    } else cost += summaryCost;
  }
  if (speechUsage.characters) {
    details.push(
      `Voice (${speechUsage.model}): ${formatCount(speechUsage.characters)} characters${speechUsage.priced ? ` ≈ ${formatCost(speechUsage.cost)}` : ", price unknown"}`,
    );
    if (speechUsage.priced) cost += speechUsage.cost;
    else priced = false;
  }
  if (!details.length) return;
  if (cost || priced) parts.unshift(`≈ ${formatCost(cost)}`);
  $("usage").hidden = false;
  $("usage").textContent = parts.join(" · ");
  $("usage").title = [...details, "Estimated from list prices."].join("\n");
}

function onSpeechUsage(usage) {
  const cost = costOf(usage);
  speechUsage.characters += usage.characters;
  speechUsage.model = usage.model;
  if (cost == null) speechUsage.priced = false;
  else speechUsage.cost += cost;
  recordUsage(cost);
  updateUsage();
}

// ---------- actions ----------

async function summarize() {
  if (summaryState === "running" || summaryState === "done") return;
  showError(null);
  if (!summaryProviderReady(settings)) {
    summaryState = "error";
    showError(`Add your ${PROVIDER_LABELS[settings.summaryProvider]} API key in the settings to get summaries.`);
    updatePlayer();
    return;
  }
  summaryState = "running";
  summaryText = "";
  summaryAbort = new AbortController();
  setStatus(`Summarizing with ${summaryModelLabel(settings)}…`);
  updatePlayer();
  try {
    const onUsage = (usage) => {
      summaryUsage = usage;
      recordUsage(costOf(usage));
      updateUsage();
    };
    for await (const delta of streamSummary(settings, job, blocksToText(job.blocks), summaryAbort.signal, onUsage)) {
      summaryText += delta;
      if (view === "summary") scheduleRender();
    }
    summaryState = "done";
  } catch (err) {
    if (err.name === "AbortError") return;
    summaryState = "error";
    showError(explain(err));
  } finally {
    setStatus(null);
    if (view === "summary") render();
    updatePlayer();
  }
}

function listen(which) {
  showError(null);
  if (!ttsProviderReady(settings)) {
    showError("Add your OpenAI API key in the settings to use OpenAI voices, or switch to the browser voice.");
    return;
  }
  const chunks = chunksFor(which);
  if (!chunks.length) return;
  playingView = which;
  speaker.play(chunks, 0);
}

function onPlayClick() {
  const state = speaker.state;
  if (playingView === view && state === "playing") speaker.pause();
  else if (playingView === view && state === "paused") speaker.resume();
  else if (playingView !== view || state === "stopped" || state === "done") listen(view);
}

function onChunkClick(event) {
  const el = event.target.closest(".chunk");
  if (!el || (view === "summary" && summaryState !== "done")) return;
  const index = Number(el.dataset.index);
  if (playingView === view && speaker.state !== "stopped" && speaker.state !== "done") speaker.seek(index);
  else {
    if (!ttsProviderReady(settings)) return listen(view); // shows the error
    playingView = view;
    speaker.play(chunksFor(view), index);
  }
}

async function copyText() {
  const text = view === "summary" ? summaryText.trim() : blocksToText(job.blocks);
  try {
    await navigator.clipboard.writeText(text);
    $("copy").textContent = "✓";
  } catch {
    $("copy").textContent = "!";
  }
  setTimeout(() => ($("copy").textContent = "⧉"), 1200);
}

function close() {
  speaker?.stop();
  summaryAbort?.abort();
  post({ type: "close" });
}

// ---------- startup ----------

async function start(incoming) {
  job = incoming;
  settings = await loadSettings();
  speaker = new Speaker(settings, job.lang);

  $("page-title").textContent = job.title;
  $("page-title").title = job.url;
  $("selection-badge").hidden = !job.fromSelection;
  $("rate").value = String(settings.rate);

  speaker.addEventListener("chunk", (e) => highlight(e.detail));
  speaker.addEventListener("state", (e) => {
    if (e.detail === "done" || e.detail === "stopped") highlight(-1);
    if (e.detail === "loading") setStatus("Preparing audio…");
    else if ($("status-text").textContent === "Preparing audio…") setStatus(null);
    updatePlayer();
  });
  speaker.addEventListener("error", (e) => showError(explain(e.detail)));
  speaker.addEventListener("usage", (e) => onSpeechUsage(e.detail));

  if (job.mode === "read") {
    showView("original");
    listen("original");
  } else {
    showView("summary");
    await summarize();
    if (job.mode === "both" && summaryState === "done") listen("summary");
  }
}

for (const tab of document.querySelectorAll(".tabs button")) {
  tab.addEventListener("click", () => {
    showView(tab.dataset.view);
    if (tab.dataset.view === "summary") summarize();
  });
}
$("content").addEventListener("click", onChunkClick);
$("play").addEventListener("click", onPlayClick);
$("stop").addEventListener("click", () => speaker?.stop());
$("rate").addEventListener("change", () => {
  const rate = Number($("rate").value);
  speaker?.setRate(rate);
  saveSettings({ rate });
});
$("copy").addEventListener("click", copyText);
$("close").addEventListener("click", close);
$("open-settings").addEventListener("click", () => browser.runtime.openOptionsPage());
$("collapse").addEventListener("click", () => {
  const collapsed = document.body.classList.toggle("collapsed");
  $("collapse").textContent = collapsed ? "+" : "–";
  post({ type: "collapse", collapsed });
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") close();
});
