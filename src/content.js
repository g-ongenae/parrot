// Injected on demand: extracts the readable text of the page and mounts the Parrot panel.
// Safe to inject several times: the second injection is a no-op.

(() => {
  if (window.__parrot) return;

  const PANEL_ORIGIN = new URL(browser.runtime.getURL("/")).origin;
  const PANEL_HEIGHT = "min(680px, calc(100vh - 32px))";

  const BLOCK_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6", "P", "LI", "BLOCKQUOTE", "PRE", "DT", "DD", "FIGCAPTION"]);
  const SKIP_SELECTOR = [
    "script", "style", "noscript", "template", "svg", "canvas", "iframe", "video", "audio",
    "nav", "aside", "footer", "form", "button", "select", "textarea", "input", "dialog",
    "[hidden]", "[aria-hidden='true']", "[role='navigation']", "[role='banner']", "[role='contentinfo']",
    "[role='complementary']", ".sr-only", ".visually-hidden",
    "#comments", ".comments", ".share", ".social", ".related", ".newsletter", ".advert", ".ads", ".ad",
  ].join(",");
  const ROOT_CANDIDATES = "article, main, [role='main'], [itemprop='articleBody'], .entry-content, .post-content, .article-body, #content";

  const clean = (text) => text.replace(/\s+/g, " ").trim();

  function paragraphTextLength(el) {
    let total = 0;
    for (const p of el.querySelectorAll("p")) total += p.textContent.length;
    return total;
  }

  function pickRoot() {
    let best = null;
    let bestScore = 0;
    for (const el of document.querySelectorAll(ROOT_CANDIDATES)) {
      const score = paragraphTextLength(el);
      if (score > bestScore) [best, bestScore] = [el, score];
    }
    if (best && bestScore > 500) return best;

    // No semantic container: pick the element that directly holds the most paragraph text.
    const scores = new Map();
    for (const p of document.querySelectorAll("p")) {
      const len = clean(p.textContent).length;
      if (len < 40) continue;
      const parent = p.parentElement;
      const grandParent = parent?.parentElement;
      if (parent) scores.set(parent, (scores.get(parent) ?? 0) + len);
      if (grandParent) scores.set(grandParent, (scores.get(grandParent) ?? 0) + len / 2);
    }
    for (const [el, score] of scores) {
      if (score > bestScore) [best, bestScore] = [el, score];
    }
    return best ?? document.body;
  }

  function isVisible(el) {
    return typeof el.checkVisibility !== "function" || el.checkVisibility({ visibilityProperty: true });
  }

  function collectBlocks(root) {
    const blocks = [];
    const walk = (el) => {
      if (el.matches(SKIP_SELECTOR) || !isVisible(el)) return;
      if (BLOCK_TAGS.has(el.tagName)) {
        const text = clean(el.innerText ?? el.textContent);
        if (!text) return;
        if (/^H[1-6]$/.test(el.tagName)) blocks.push({ type: "h", text });
        else if (el.tagName === "LI") blocks.push({ type: "li", text });
        else blocks.push({ type: "p", text });
        return;
      }
      for (const child of el.children) walk(child);
    };
    walk(root);
    return blocks;
  }

  function textToBlocks(text) {
    return text
      .split(/\n+/)
      .map(clean)
      .filter(Boolean)
      .map((line) => ({ type: "p", text: line }));
  }

  function extract() {
    const selection = window.getSelection()?.toString().trim();
    if (selection && selection.length > 20) {
      return { blocks: textToBlocks(selection), fromSelection: true };
    }
    const root = pickRoot();
    let blocks = collectBlocks(root);
    const length = blocks.reduce((sum, b) => sum + b.text.length, 0);
    if (length < 200) blocks = textToBlocks(root.innerText ?? "");

    const title = clean(document.title);
    if (title && !blocks.some((b) => b.type === "h")) blocks.unshift({ type: "h", text: title });
    return { blocks, fromSelection: false };
  }

  let frame = null;
  let onMessage = null;

  function close() {
    frame?.remove();
    frame = null;
    if (onMessage) window.removeEventListener("message", onMessage);
    onMessage = null;
  }

  function open(mode) {
    close();
    const { blocks, fromSelection } = extract();
    const nonce = crypto.randomUUID();
    const job = {
      mode,
      title: clean(document.title) || location.hostname,
      url: location.href,
      lang: document.documentElement.lang || navigator.language,
      fromSelection,
      blocks,
    };

    frame = document.createElement("iframe");
    frame.src = browser.runtime.getURL("/panel/panel.html") + "#" + nonce;
    frame.title = "Parrot";
    frame.allow = "autoplay";
    frame.style.cssText = [
      "position:fixed", "top:16px", "right:16px", "width:420px", "max-width:calc(100vw - 32px)",
      `height:${PANEL_HEIGHT}`, "border:0", "border-radius:16px", "z-index:2147483647",
      "box-shadow:0 12px 40px rgba(0,0,0,.28)", "background:transparent", "color-scheme:normal",
      "transition:height .2s ease",
    ].map((rule) => rule + " !important").join(";");

    onMessage = (event) => {
      if (event.origin !== PANEL_ORIGIN || typeof event.data !== "string") return;
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.nonce !== nonce) return;
      if (msg.type === "ready") {
        frame.contentWindow.postMessage(JSON.stringify({ type: "job", nonce, job }), PANEL_ORIGIN);
      } else if (msg.type === "close") {
        close();
      } else if (msg.type === "collapse") {
        frame.style.setProperty("height", msg.collapsed ? "64px" : PANEL_HEIGHT, "important");
      }
    };
    window.addEventListener("message", onMessage);
    document.documentElement.appendChild(frame);
  }

  window.__parrot = { open, close };
})();
