// Reads a list of text chunks out loud with either the browser's built-in voices or OpenAI TTS.
// Emits: "chunk" (detail: index), "state" (detail: "loading" | "playing" | "paused" | "stopped" | "done"),
// "error" (detail: Error), "usage" (detail: usage of one OpenAI speech request, see usage.js).

const CHUNK_SIZE = { browser: 280, openai: 1200 };

function splitSentences(text, lang) {
  if (typeof Intl.Segmenter === "function") {
    try {
      return [...new Intl.Segmenter(lang || undefined, { granularity: "sentence" }).segment(text)].map((s) => s.segment);
    } catch {
      // unsupported locale tag: fall through to the regex
    }
  }
  return text.match(/[^.!?…]+[.!?…]*\s*/g) ?? [text];
}

// Splits text into chunks of at most `max` characters, cutting between sentences when possible.
function chunkText(text, max, lang) {
  const chunks = [];
  let current = "";
  const push = () => {
    if (current.trim()) chunks.push(current);
    current = "";
  };
  for (const sentence of splitSentences(text, lang)) {
    if (current && current.length + sentence.length > max) push();
    if (sentence.length <= max) {
      current += sentence;
      continue;
    }
    for (const word of sentence.split(/(?<=\s)/)) {
      if (current && current.length + word.length > max) push();
      current += word;
    }
  }
  push();
  return chunks;
}

// What is shown on screen may contain light markdown; what is spoken should not.
function speakable(text) {
  return text.replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim();
}

class Speaker extends EventTarget {
  constructor(settings, lang) {
    super();
    this.settings = settings;
    this.lang = lang;
    this.engine = settings.ttsProvider === "openai" ? "openai" : "browser";
    this.chunkSize = CHUNK_SIZE[this.engine];
    this.rate = Number(settings.rate) || 1;
    this.chunks = [];
    this.index = 0;
    this.state = "stopped";
    this.generation = 0;
    this.audio = null;
    this.audioCache = new Map();
    this.abort = null;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  setState(state) {
    this.state = state;
    this.emit("state", state);
  }

  play(chunks, start = 0) {
    this.stop();
    this.chunks = chunks;
    this.playFrom(start);
  }

  seek(index) {
    if (!this.chunks.length) return;
    this.halt();
    this.playFrom(index);
  }

  playFrom(index) {
    const generation = ++this.generation;
    if (index >= this.chunks.length) {
      this.setState("done");
      return;
    }
    this.index = index;
    this.emit("chunk", index);
    const next = () => {
      if (generation === this.generation) this.playFrom(index + 1);
    };
    const fail = (err) => {
      if (generation !== this.generation || err?.name === "AbortError") return;
      this.setState("stopped");
      this.emit("error", err);
    };
    if (this.engine === "openai") this.playOpenAI(index, generation, next).catch(fail);
    else this.playBrowser(index, next, fail);
  }

  pickVoice() {
    const voices = speechSynthesis.getVoices();
    if (this.settings.browserVoice) {
      const chosen = voices.find((v) => v.voiceURI === this.settings.browserVoice);
      if (chosen) return chosen;
    }
    const base = (this.lang || "").toLowerCase().split("-")[0];
    if (!base) return null;
    const matching = voices.filter((v) => v.lang.toLowerCase().startsWith(base));
    return matching.find((v) => v.localService && v.default) ?? matching.find((v) => v.localService) ?? matching[0] ?? null;
  }

  playBrowser(index, next, fail) {
    const utterance = new SpeechSynthesisUtterance(speakable(this.chunks[index]));
    const voice = this.pickVoice();
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else if (this.lang) {
      utterance.lang = this.lang;
    }
    utterance.rate = this.rate;
    utterance.onend = next;
    utterance.onerror = (e) => {
      if (e.error !== "interrupted" && e.error !== "canceled") fail(new Error(`Speech error: ${e.error}`));
    };
    speechSynthesis.speak(utterance);
    this.setState("playing");
  }

  fetchAudio(index) {
    if (index >= this.chunks.length) return null;
    this.abort ??= new AbortController();
    if (!this.audioCache.has(index)) {
      const text = speakable(this.chunks[index]);
      const request = openaiSpeech(this.settings, text, this.abort.signal).then((blob) => {
        this.emit("usage", { provider: "openai-tts", model: this.settings.openaiTtsModel.trim(), characters: text.length });
        return URL.createObjectURL(blob);
      });
      request.catch(() => {}); // surfaced when this chunk is actually played
      this.audioCache.set(index, request);
    }
    return this.audioCache.get(index);
  }

  async playOpenAI(index, generation, next) {
    if (!this.audioCache.has(index)) this.setState("loading");
    const url = await this.fetchAudio(index);
    this.fetchAudio(index + 1); // prefetch so there is no gap between chunks
    this.fetchAudio(index + 2);
    if (generation !== this.generation) return;

    this.audio ??= new Audio();
    this.audio.src = url;
    this.audio.playbackRate = this.rate;
    this.audio.onended = next;
    try {
      await this.audio.play();
      this.setState("playing");
    } catch (err) {
      if (err.name === "NotAllowedError") this.setState("paused"); // autoplay blocked: wait for the play button
      else throw err;
    }
  }

  pause() {
    if (this.state !== "playing") return;
    if (this.engine === "openai") this.audio?.pause();
    else speechSynthesis.pause();
    this.setState("paused");
  }

  resume() {
    if (this.state !== "paused") return;
    if (this.engine === "openai") {
      this.audio?.play().then(() => this.setState("playing"), (err) => this.emit("error", err));
    } else {
      speechSynthesis.resume();
      this.setState("playing");
    }
  }

  // Interrupts the current chunk but keeps downloaded audio, so a seek restarts instantly.
  halt() {
    this.generation++;
    if (this.engine === "browser") {
      speechSynthesis.cancel();
      speechSynthesis.resume();
    }
    if (this.audio) {
      this.audio.onended = null;
      this.audio.pause();
    }
  }

  stop() {
    this.halt();
    this.abort?.abort();
    this.abort = null;
    this.audio?.removeAttribute("src");
    for (const request of this.audioCache.values()) request.then(URL.revokeObjectURL, () => {});
    this.audioCache.clear();
    if (this.state !== "stopped") this.setState("stopped");
  }

  setRate(rate) {
    this.rate = rate;
    if (this.engine === "openai") {
      if (this.audio) this.audio.playbackRate = rate;
    } else if (this.state === "playing") {
      this.seek(this.index); // browser voices only pick up a new rate on the next utterance
    }
  }
}
