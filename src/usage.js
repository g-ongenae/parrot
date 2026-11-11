// Token usage and cost: list prices, per-request cost, and a running total kept in storage.
// Prices are US dollars per million tokens (or per million characters for TTS), list prices
// at the time of writing. Unknown models (custom providers, new releases) show tokens only.

const CLAUDE_PRICES = {
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-fable-5": { input: 10, output: 50 },
  "claude-mythos-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  // Prompts over 100K tokens are billed at the long-context rate.
  "claude-haiku-5-5": { input: 0.1, output: 0.5, long: { above: 100_000, input: 0.5, output: 2.5 } },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

const OPENAI_PRICES = {
  "gpt-5.6-sol": { input: 4, output: 20, cacheRead: 0.4 },
  "gpt-5.6-terra": { input: 2, output: 12, cacheRead: 0.2 },
  "gpt-5.6-luna": { input: 0.2, output: 1.2, cacheRead: 0.02 },
  "gpt-5.4": { input: 2.5, output: 15, cacheRead: 0.25 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5, cacheRead: 0.075 },
  "gpt-5.4-nano": { input: 0.2, output: 1.25, cacheRead: 0.02 },
  "gpt-5": { input: 1.25, output: 10, cacheRead: 0.125 },
  "gpt-5-mini": { input: 0.25, output: 2, cacheRead: 0.025 },
  "gpt-5-nano": { input: 0.05, output: 0.4, cacheRead: 0.005 },
  "gpt-4.1": { input: 2, output: 8, cacheRead: 0.5 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6, cacheRead: 0.1 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4, cacheRead: 0.025 },
  "gpt-4o": { input: 2.5, output: 10, cacheRead: 1.25 },
  "gpt-4o-mini": { input: 0.15, output: 0.6, cacheRead: 0.075 },
};

// Per million characters. gpt-4o-mini-tts is billed by audio tokens (~$0.015 per minute):
// at ~900 spoken characters a minute that is roughly $15 per million characters.
const TTS_PRICES = {
  "gpt-4o-mini-tts": 15,
  "tts-1-hd": 30,
  "tts-1": 15,
};

// Longest matching prefix, so "claude-opus-5-5" wins over "claude-opus-5" and dated or
// suffixed model names still find their base price.
function lookupPrice(table, model) {
  const key = Object.keys(table)
    .filter((name) => model === name || model.startsWith(`${name}-`))
    .sort((a, b) => b.length - a.length)[0];
  return key ? table[key] : null;
}

// usage: { provider, model, input, output, cacheRead, cacheWrite } for summaries,
//        { provider: "openai-tts", model, characters } for speech.
function costOf(usage) {
  if (usage.provider === "openai-tts") {
    const perMillion = lookupPrice(TTS_PRICES, usage.model);
    return perMillion == null ? null : (usage.characters * perMillion) / 1e6;
  }
  const table = usage.provider === "anthropic" ? CLAUDE_PRICES : usage.provider === "openai" ? OPENAI_PRICES : null;
  const base = table && lookupPrice(table, usage.model);
  if (!base) return null;
  const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
  const price = base.long && promptTokens > base.long.above ? { ...base, ...base.long } : base;
  const cacheRead = price.cacheRead ?? price.input * 0.1;
  return (
    (usage.input * price.input +
      usage.cacheWrite * price.input * 1.25 +
      usage.cacheRead * cacheRead +
      usage.output * price.output) /
    1e6
  );
}

function formatCost(dollars) {
  if (dollars === 0) return "$0";
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
  return `$${dollars.toFixed(dollars < 1 ? 3 : 2)}`;
}

const formatCount = (n) => (n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString("en-US"));

// ---------- running total ----------

const USAGE_KEY = "usageTotals";
const EMPTY_TOTALS = { cost: 0, requests: 0, unpriced: 0, since: null };
let pendingWrite = Promise.resolve();

async function loadUsageTotals() {
  const { [USAGE_KEY]: totals } = await browser.storage.local.get(USAGE_KEY);
  return { ...EMPTY_TOTALS, ...totals };
}

// Writes are chained so concurrent requests (prefetched audio chunks) don't overwrite each other.
function recordUsage(cost) {
  pendingWrite = pendingWrite
    .then(async () => {
      const totals = await loadUsageTotals();
      totals.requests += 1;
      if (cost == null) totals.unpriced += 1;
      else totals.cost += cost;
      totals.since ??= new Date().toISOString();
      await browser.storage.local.set({ [USAGE_KEY]: totals });
    })
    .catch((err) => console.warn("Parrot: could not save usage", err));
  return pendingWrite;
}

function resetUsageTotals() {
  return browser.storage.local.remove(USAGE_KEY);
}
