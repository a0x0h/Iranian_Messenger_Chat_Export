(() => {
  "use strict";

  /* --------------------------------------------------------------- platform */

  const VERSION = "2.1.0";
  const PLATFORM =
    location.hostname === "web.eitaa.com" ? "eitaa" :
    location.hostname === "web.rubika.ir" ? "rubika" : "bale";
  const PLATFORM_NAME = { bale: "Bale", eitaa: "Eitaa", rubika: "Rubika" }[PLATFORM];
  // Eitaa and Rubika are both forks of Telegram Web K, so they share one adapter.
  const TG = PLATFORM !== "bale";

  let job = null;

  /* -------------------------------------------------------------- utilities */

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const latinDigits = s => String(s ?? "")
    .replace(/[۰-۹]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x06f0 + 48))
    .replace(/[٠-٩]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x0660 + 48));

  const clean = s => String(s ?? "")
    .replace(/[\u200b-\u200f\u202a-\u202e\ufeff]/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const safe = (s, fallback = "") => clean(s)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 80)
    .trim() || fallback;

  const hasExtension = s => /\.[a-z0-9]{1,8}$/i.test(String(s || ""));

  const visible = el => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  };

  const matches = (el, selector) => { try { return el.matches(selector); } catch { return false; } };
  const closest = (el, selector) => { try { return el.closest(selector); } catch { return null; } };

  const fetchableUrl = value => {
    try { return ["http:", "https:", "blob:"].includes(new URL(value, location.href).protocol); }
    catch { return false; }
  };

  const MIME_EXTENSIONS = {
    "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif",
    "image/svg+xml": ".svg", "image/bmp": ".bmp", "video/mp4": ".mp4", "video/webm": ".webm",
    "video/quicktime": ".mov", "audio/ogg": ".ogg", "audio/opus": ".opus", "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a", "audio/wav": ".wav", "application/pdf": ".pdf", "application/zip": ".zip",
  };
  const mimeExtension = mime => MIME_EXTENSIONS[String(mime || "").split(";")[0].trim().toLowerCase()] || "";

  const bytesLabel = n => {
    if (!n) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
  };

  /* ------------------------------------------------------ Jalali date helper */

  // Rubika prints only a Persian day heading ("یکشنبه، 11 مرداد 1405") plus a
  // clock, so real timestamps have to be reconstructed from those two strings.
  const PERSIAN_MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
    "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];

  function jalaliToGregorian(jy, jm, jd) {
    jy += 1595;
    let days = -355668 + 365 * jy + Math.floor(jy / 33) * 8 + Math.floor(((jy % 33) + 3) / 4) + jd +
      (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
    let gy = 400 * Math.floor(days / 146097);
    days %= 146097;
    if (days > 36524) {
      gy += 100 * Math.floor(--days / 36524);
      days %= 36524;
      if (days >= 365) days++;
    }
    gy += 4 * Math.floor(days / 1461);
    days %= 1461;
    if (days > 365) {
      gy += Math.floor((days - 1) / 365);
      days = (days - 1) % 365;
    }
    let gd = days + 1;
    const leap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
    const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let gm = 0;
    while (gm < 12 && gd > lengths[gm]) { gd -= lengths[gm]; gm++; }
    return [gy, gm + 1, gd];
  }

  let cachedJalaliYear = 0;
  function currentJalaliYear() {
    if (cachedJalaliYear) return cachedJalaliYear;
    try {
      cachedJalaliYear = Number(latinDigits(new Intl.DateTimeFormat("en-u-ca-persian", { year: "numeric" })
        .format(new Date()).replace(/[^\d۰-۹]/g, "")));
    } catch { cachedJalaliYear = 0; }
    return cachedJalaliYear || 1404;
  }

  function parseClock(text) {
    const found = /(\d{1,2})\s*:\s*(\d{2})(?:\s*:\s*(\d{2}))?/.exec(latinDigits(text));
    if (!found) return null;
    let hours = Number(found[1]);
    if (/ب\s*\.?\s*ظ|PM/i.test(text)) { if (hours < 12) hours += 12; }
    else if (/ق\s*\.?\s*ظ|AM/i.test(text)) { if (hours === 12) hours = 0; }
    return [hours, Number(found[2]), Number(found[3] || 0)];
  }

  /** "یکشنبه، 11 مرداد 1405" + "11:30" -> ISO string, or "" when unparsable. */
  function persianDateToIso(dayText, timeText) {
    const day = latinDigits(clean(dayText));
    if (!day) return "";
    const month = PERSIAN_MONTHS.findIndex(name => day.includes(name));
    if (month < 0) return "";
    const numbers = (day.match(/\d{1,4}/g) || []).map(Number);
    const dayNumber = numbers.find(n => n >= 1 && n <= 31);
    const year = numbers.find(n => n >= 1200 && n <= 1600) || currentJalaliYear();
    if (!dayNumber) return "";
    const [gy, gm, gd] = jalaliToGregorian(year, month + 1, dayNumber);
    const clock = parseClock(timeText) || [0, 0, 0];
    const date = new Date(gy, gm - 1, gd, clock[0], clock[1], clock[2]);
    return isNaN(date.getTime()) ? "" : date.toISOString();
  }

  /* ------------------------------------------------------------ text reader */

  const BLOCK_TAGS = new Set(["DIV", "P", "PRE", "LI", "UL", "OL", "BLOCKQUOTE", "SECTION",
    "ARTICLE", "TABLE", "TR", "H1", "H2", "H3", "H4", "H5", "H6", "FIGURE"]);
  const IGNORED_TAGS = new Set(["SCRIPT", "STYLE", "CANVAS", "TEMPLATE", "NOSCRIPT", "svg", "SVG"]);

  /**
   * Reads visible message text from a live node.
   *
   * innerText is not enough here: Eitaa renders emoji as <img alt="🌿"> and both
   * apps duplicate the clock into a hidden ".inner" node, so emoji would vanish
   * and timestamps would appear twice inside the message body.
   */
  function readText(root, skipSelector) {
    if (!root) return "";
    let out = "";
    const newline = () => { if (out && !out.endsWith("\n")) out += "\n"; };

    (function walk(node) {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) { out += child.nodeValue; continue; }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        const tag = child.tagName;
        if (IGNORED_TAGS.has(tag)) continue;
        if (tag === "BR") { out += "\n"; continue; }
        if (child.hidden) continue;
        if (skipSelector && matches(child, skipSelector)) continue;
        if (tag === "IMG") {
          // Eitaa renders emoji as images, and those alts are part of the
          // sentence. Every other alt describes an attachment, not the text.
          if (/emoji/i.test(String(child.className || ""))) out += clean(child.getAttribute("alt"));
          continue;
        }
        const block = BLOCK_TAGS.has(tag);
        if (block) newline();
        walk(child);
        if (block) newline();
      }
    })(root);

    return clean(out);
  }

  /* ------------------------------------------- media bridge into page world */

  const pendingPageFetches = new Map();

  window.addEventListener("message", event => {
    const response = event.data;
    if (event.source !== window || response?.channel !== "BALE_EXPORT_MEDIA_RESPONSE") return;
    const pending = pendingPageFetches.get(response.id);
    if (!pending) return;
    pendingPageFetches.delete(response.id);
    clearTimeout(pending.timer);
    if (response.ok && response.buffer && typeof response.buffer.byteLength === "number") {
      pending.resolve({ bytes: new Uint8Array(response.buffer), mime: response.mime || "" });
    } else {
      pending.reject(new Error(response.error || `${PLATFORM_NAME} could not read this media`));
    }
  });

  function fetchInPage(url) {
    return new Promise((resolve, reject) => {
      if (!fetchableUrl(url)) { reject(new Error("Unsupported media URL")); return; }
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        pendingPageFetches.delete(id);
        reject(new Error("Media request timed out"));
      }, 45000);
      pendingPageFetches.set(id, { resolve, reject, timer });
      window.postMessage({ channel: "BALE_EXPORT_MEDIA_REQUEST", id, url }, "*");
    });
  }

  // Network media is queued so a long chat cannot open hundreds of parallel
  // requests. blob: URLs bypass the queue because the app revokes them as soon
  // as the message scrolls out of view.
  const queue = { active: 0, limit: 6, waiting: [] };
  function pumpQueue() {
    while (queue.active < queue.limit && queue.waiting.length) {
      const next = queue.waiting.shift();
      queue.active++;
      next.task().then(next.resolve, next.reject).finally(() => { queue.active--; pumpQueue(); });
    }
  }
  const enqueue = task => new Promise((resolve, reject) => {
    queue.waiting.push({ task, resolve, reject });
    pumpQueue();
  });

  function beginMediaCapture(item) {
    if (!job || !job.includeMedia || !item.url || !fetchableUrl(item.url) || job.mediaCache.has(item.url)) return;
    const start = () => fetchInPage(item.url);
    const settled = (item.url.startsWith("blob:") ? start() : enqueue(start))
      .then(value => ({ ok: true, ...value }), error => ({ ok: false, error: error?.message || String(error) }));
    job.mediaCache.set(item.url, settled);
  }

  /* ----------------------------------------------------------------- toast */

  function toastElement() {
    let t = document.getElementById("bale-export-toast");
    if (t) return t;
    t = document.createElement("div");
    t.id = "bale-export-toast";
    t.innerHTML = '<div class="bx-head"><span class="bx-msg"></span>' +
      '<button class="bx-cancel" type="button">Cancel</button></div>' +
      '<progress max="100" value="0"></progress>';
    t.querySelector(".bx-cancel").addEventListener("click", () => {
      if (job) { job.cancelled = true; notify("Cancelling…", null); }
    });
    document.documentElement.append(t);
    return t;
  }

  function notify(message, progress, done = false, error = false) {
    const t = toastElement();
    t.querySelector(".bx-msg").textContent = message;
    t.classList.toggle("bx-error", !!error);
    const bar = t.querySelector("progress");
    const cancel = t.querySelector(".bx-cancel");
    bar.hidden = done || error || progress == null;
    if (!bar.hidden) bar.value = progress || 0;
    cancel.hidden = done || error;
    try { chrome.runtime.sendMessage({ type: "BALE_EXPORT_PROGRESS", message, progress, done, error })?.catch?.(() => {}); }
    catch { /* popup closed or extension reloaded */ }
    if (done || error) setTimeout(() => t.remove(), 8000);
  }

  /* --------------------------------------------------- conversation lookup */

  function findConversation() {
    if (TG) {
      const messageSelector = PLATFORM === "eitaa" ? ".bubble[data-mid]" : ".bubbles-group[data-msg-id]";
      const inner = [...document.querySelectorAll(".bubbles-inner")].find(el => el.querySelector(messageSelector));
      const scroller = inner && closest(inner, ".scrollable.scrollable-y");
      if (scroller) return scroller;
    }
    const baleScroller = document.getElementById("message_list_scroller_id");
    if (baleScroller && baleScroller.querySelector("[data-sid][data-date]")) return baleScroller;

    const candidates = [...document.querySelectorAll('[role="main"],main,[class*="chat" i],[class*="message" i]')].filter(visible);
    let best = null, score = 0;
    for (const el of candidates) {
      const hints = el.querySelectorAll('[data-message-id],[class*="message" i],[class*="bubble" i],time').length;
      const r = el.getBoundingClientRect();
      const value = hints * 20 + (r.width * r.height) / (innerWidth * innerHeight);
      if (hints >= 1 && value > score) { best = el; score = value; }
    }
    if (!best) throw new Error(`No open conversation found. Open a chat in ${PLATFORM_NAME} Web and try again.`);
    return best;
  }

  function scrollParent(root) {
    if (root.id === "message_list_scroller_id" || matches(root, ".scrollable.scrollable-y")) return root;
    const all = [root, ...root.querySelectorAll("*")];
    return all
      .filter(el => /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 50)
      .sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth)[0] || root;
  }

  function titleOf(root) {
    if (TG) {
      const title = [...document.querySelectorAll(".chat-info .user-title .peer-title, .chat-info .peer-title, .topbar .peer-title")]
        .find(el => visible(el) && clean(el.textContent));
      if (title) return clean(title.textContent);
    }
    const baleTitle = document.querySelector('[aria-label="ChatAppBar"] p');
    if (baleTitle && clean(baleTitle.textContent)) return clean(baleTitle.textContent);

    const headers = [...document.querySelectorAll('header,h1,h2,[class*="header" i],[class*="title" i]')].filter(visible);
    const q = root.getBoundingClientRect();
    const near = headers.filter(el => {
      const r = el.getBoundingClientRect();
      return r.left < q.right && r.right > q.left && r.top < q.top + 180;
    });
    const chosen = near.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
    return clean(chosen?.textContent) || `${PLATFORM_NAME} chat`;
  }

  /* ----------------------------------------------------------- message list */

  function messageNodes(root) {
    if (PLATFORM === "eitaa") return [...root.querySelectorAll(".bubbles-inner .bubble[data-mid]:not(.service)")];
    if (PLATFORM === "rubika") return [...root.querySelectorAll(".bubbles-inner .bubbles-group[data-msg-id]")];

    const bale = [...root.querySelectorAll('[data-sid][data-date][aria-label="message-item"]')];
    if (bale.length) return bale;

    const exact = [...root.querySelectorAll('[data-message-id],[data-mid],[id^="message" i],[class*="message-container" i],[class*="message-item" i]')];
    const pool = exact.length ? exact : [...root.querySelectorAll('[class*="message" i],[class*="bubble" i]')];
    return pool.filter((el, i) => {
      if (!clean(el.textContent) && !el.querySelector("img,video,audio,a[href]")) return false;
      return !pool.some((other, j) => j !== i && el.contains(other) && other.getBoundingClientRect().height > 20);
    });
  }

  /* ------------------------------------------------------------------ media */

  // Thumbnails that belong to a quoted reply, an avatar or a chrome icon are not
  // message media; capturing them duplicates files and pollutes the archive.
  const MEDIA_SKIP = [
    ".reply", ".reply-wrapper", ".reply-media", ".reply-content",
    "avatar-element", ".avatar-element", ".dialog-avatar", '[aria-label="avatar"]',
    ".document-ico", ".preloader-container", ".bubble-beside-button", ".checkbox-field",
    ".bubble-select-checkbox", ".pinned-container", ".chat-input", ".reactions",
    '[data-sentry-component="Preview"]', '[data-sentry-component="DocumentIcon"]',
  ].join(",");

  // Extra containers whose <img> children are chrome (file-type badges, link
  // favicons) rather than message content. Applied to images only, so a real
  // download link inside the same card is still collected.
  const IMAGE_SKIP = '[data-testid="document-message"],[data-sentry-component="DocumentPreview"],.document-container,.audio,.web-page-preview-resizer';

  const MEDIA_TAGS = 'img,video,audio,source,a[download],a[href^="blob:"]';

  function mediaType(el, classes) {
    if (el.tagName === "VIDEO") return /round/i.test(classes) ? "video_message" : "video";
    if (el.tagName === "AUDIO") return "voice";
    if (el.tagName === "SOURCE") return closest(el, "video") ? "video" : "voice";
    if (el.tagName === "IMG") return /sticker/i.test(classes) ? "sticker" : "photo";
    return "file";
  }

  function mediaFrom(node) {
    const items = [];
    const add = item => {
      if (item.url && items.some(x => x.url === item.url)) return;
      if (!item.url && item.name && items.some(x => x.name === item.name)) return;
      items.push(item);
      beginMediaCapture(item);
    };

    for (const el of node.querySelectorAll(MEDIA_TAGS)) {
      if (closest(el, MEDIA_SKIP)) continue;
      const classes = String(el.className || "");
      if (/(^|[\s-])emoji|custom-emoji|avatar/i.test(`${classes} ${el.getAttribute("alt") || ""}`)) continue;
      if (el.tagName === "IMG") {
        if (closest(el, IMAGE_SKIP)) continue;
        // Bale marks its inline type badges with "file"/"sticker" classes and
        // exposes no separate sticker asset, so those images are page chrome.
        if (!TG && /\bfile\b|sticker/i.test(classes)) continue;
        // Reaction and status icons are tiny; real media never is.
        if (el.naturalWidth && el.naturalWidth < 40 && el.naturalHeight < 40) continue;
      }

      const url = el.currentSrc || el.getAttribute("src") || el.getAttribute("href") || "";
      if (!url || !fetchableUrl(url)) continue;

      const declared = clean(el.getAttribute("download") || el.getAttribute("title") || el.getAttribute("alt"));
      const fromUrl = url.startsWith("blob:") ? "" : (() => {
        try { return decodeURIComponent(new URL(url, location.href).pathname.split("/").pop() || ""); }
        catch { return ""; }
      })();
      const name = el.hasAttribute("download") ? declared
        : hasExtension(declared) ? declared
        : hasExtension(fromUrl) ? fromUrl : "";

      add({ type: mediaType(el, classes), url, name });
    }

    for (const item of documentPlaceholders(node)) add(item);
    return items;
  }

  /** Files and voice notes the app has not downloaded yet expose no URL at all. */
  function documentPlaceholders(node) {
    const items = [];
    const note = `${PLATFORM_NAME} keeps this file out of the page until it is downloaded. Open the message, press download, then export again.`;

    if (TG) {
      for (const doc of node.querySelectorAll(".document-container,.document")) {
        if (closest(doc, MEDIA_SKIP)) continue;
        const name = clean(doc.querySelector(".document-name")?.textContent) || clean(doc.querySelector("middle-ellipsis-element")?.textContent);
        if (!name) continue;
        const size = clean(doc.querySelector(".document-size")?.firstChild?.nodeValue);
        items.push({ type: "file", url: "", name, size, error: note });
      }
      for (const audio of node.querySelectorAll(".audio")) {
        if (closest(audio, MEDIA_SKIP)) continue;
        const name = clean(audio.querySelector(".audio-title")?.textContent) || "voice message";
        items.push({ type: "voice", url: "", name, error: note });
      }
      return items;
    }

    for (const preview of node.querySelectorAll('[data-testid="document-message"],[data-sentry-component="DocumentPreview"],.document-container')) {
      const card = closest(preview, "a") || preview.parentElement;
      if (!card) continue;
      const direct = clean(preview.querySelector(".document-name,middle-ellipsis-element")?.textContent);
      const name = direct || [...card.querySelectorAll('p,[dir="auto"]')].map(el => clean(el.textContent)).find(hasExtension);
      if (name) items.push({ type: "file", url: "", name, error: note });
    }
    return items;
  }

  /* ---------------------------------------------------------------- parsing */

  const parseMessage = (node, index) => TG ? parseTelegramStyle(node, index) : parseBale(node, index);

  function parseBale(node, index) {
    const own =
      !!node.querySelector('[aria-label="RightBubble-icon"],use[href="#bi-RightBubble"],use[xlink\\:href="#bi-RightBubble"]') ||
      !!closest(node, '[class*="outgoing" i],[class*="out-message" i],[class*="own" i],[data-outgoing="true"]') ||
      /outgoing|is-mine|from-me/i.test(node.className);

    const bottom = node.querySelector('[data-sentry-component="MessageBottomFC"]');
    // The footer also carries the "edited" marker and delivery state, so prefer
    // the paragraph that actually reads as a clock.
    const timeEl =
      [...(bottom?.querySelectorAll("p") || [])].find(p => /\d{1,2}\s*:\s*\d{2}/.test(latinDigits(p.textContent))) ||
      bottom?.querySelector("p:last-of-type") ||
      node.querySelector('time,[datetime],[class*="time" i],[class*="date" i]');
    const epoch = Number(node.dataset.date) || 0;
    const date = epoch ? new Date(epoch).toISOString()
      : (timeEl?.getAttribute("datetime") || timeEl?.getAttribute("title") || clean(timeEl?.textContent) || "");
    const senderEl = node.querySelector('[data-sentry-component="BaseBubbleFC"] > div > div:first-child p span[dir="auto"], [class*="sender" i],[class*="author" i],[class*="name" i]');
    const replyEl = node.querySelector('[data-sentry-component="Preview"],[class*="reply" i],[class*="quote" i]');

    const media = mediaFrom(node);
    const containers = [...node.querySelectorAll('[data-sentry-component="NewTextContainerFC"]')]
      .filter(el => !closest(el, '[data-sentry-component="Preview"]'))
      .map(el => readText(el))
      .filter(Boolean);

    let text = containers.join("\n");
    if (!containers.length) {
      text = readText(node);
      for (const strip of [bottom, senderEl, replyEl]) {
        const part = strip && readText(strip);
        if (part) text = text.replace(part, "").trim();
      }
    }

    return {
      id: node.dataset.sid || node.dataset.messageId || node.dataset.mid || node.id || "",
      type: "message",
      date,
      date_unixtime: epoch ? String(Math.floor(epoch / 1000)) : "",
      display_time: clean(timeEl?.textContent),
      day: "",
      edited: /ویرایش شده|edited/i.test(clean(bottom?.textContent)),
      from: own ? "You" : (clean(senderEl?.textContent) || job?.title || "Other"),
      from_id: "",
      direction: own ? "outgoing" : "incoming",
      reply_to: readText(replyEl),
      forwarded_from: "",
      text,
      media,
      _sort: epoch || 0,
      _index: index,
    };
  }

  const TG_TEXT_SKIP = [
    ".time", ".reply", ".reactions", ".document-container", ".document", ".audio",
    ".attachment", ".media-container", ".bubble-tail", ".name", ".checkbox-field",
    ".bubble-beside-button", ".message-status", ".preloader-container",
    ".bubble-select-checkbox", ".bubble-name-forwarded", ".web-page-preview-resizer",
  ].join(",");

  function parseTelegramStyle(container, index) {
    const bubble = PLATFORM === "rubika" ? (container.querySelector(".bubble") || container) : container;
    const own = bubble.classList.contains("is-out");
    const id = PLATFORM === "rubika" ? (container.dataset.msgId || "") : (bubble.dataset.mid || "");

    const timeEl = bubble.querySelector("[rb-message-time],.time");
    // The clock is duplicated into a hidden ".inner" node; read only the first span.
    const displayTime = clean((timeEl?.querySelector(".i18n,span") || timeEl)?.textContent);
    const day = clean(container.closest(".bubbles-date-group")?.querySelector(".service.is-date .service-msg")?.textContent);

    const epoch = Number(bubble.dataset.timestamp) || 0;
    const date = epoch ? new Date(epoch * 1000).toISOString()
      : (persianDateToIso(day, displayTime) || clean(`${day} ${displayTime}`));

    const nameEl = bubble.querySelector(".bubble-content > .name, .bubble-content-wrapper > .name, .name");
    const forwardEl = bubble.querySelector(".bubble-name-forwarded");
    const sender = own ? "You"
      : clean(nameEl?.querySelector(".peer-title")?.textContent || nameEl?.textContent) || job?.title || "Other";

    const replyEl = bubble.querySelector(".reply");
    const replyText = replyEl ? clean([
      clean(replyEl.querySelector(".reply-title")?.textContent),
      readText(replyEl.querySelector(".reply-subtitle")),
    ].filter(Boolean).join(": ")) : "";

    const textRoot = bubble.querySelector("[rb-message-text]") || bubble.querySelector(".message");
    const text = readText(textRoot, TG_TEXT_SKIP);

    const sortable = epoch ? epoch * 1000 : (Number(latinDigits(id)) || 0);

    return {
      id: id || "",
      type: "message",
      date,
      date_unixtime: epoch ? String(epoch) : (Date.parse(date) ? String(Math.floor(Date.parse(date) / 1000)) : ""),
      display_time: displayTime,
      day,
      edited: !!timeEl?.querySelector(".edited"),
      from: sender,
      from_id: bubble.dataset.peerId || "",
      direction: own ? "outgoing" : "incoming",
      reply_to: replyText,
      forwarded_from: clean(forwardEl?.querySelector(".peer-title")?.textContent || forwardEl?.textContent),
      text,
      media: mediaFrom(bubble),
      _sort: sortable,
      _index: index,
    };
  }

  /* -------------------------------------------------------- history loading */

  const messageKey = m => m.id
    ? `id:${m.id}`
    : `x:${m.date}|${m.from}|${m.direction}|${m.text.slice(0, 160)}`;

  /**
   * A message can be re-read several times while scrolling: images finish
   * loading, captions expand. Keep the richest version rather than the first.
   */
  function mergeMessage(kept, fresh) {
    if (fresh.text.length > kept.text.length) kept.text = fresh.text;
    if (!kept.date && fresh.date) kept.date = fresh.date;
    if (!kept.date_unixtime && fresh.date_unixtime) kept.date_unixtime = fresh.date_unixtime;
    if (!kept.day && fresh.day) kept.day = fresh.day;
    if (!kept.reply_to && fresh.reply_to) kept.reply_to = fresh.reply_to;
    if (!kept.forwarded_from && fresh.forwarded_from) kept.forwarded_from = fresh.forwarded_from;
    if (!kept._sort && fresh._sort) kept._sort = fresh._sort;
    kept.edited = kept.edited || fresh.edited;
    for (const item of fresh.media) {
      const known = kept.media.some(x => item.url ? x.url === item.url : (!x.url && x.name === item.name));
      if (known) continue;
      if (item.url && item.name) {
        // Drop the "not downloaded yet" placeholder once a real URL shows up.
        const placeholder = kept.media.findIndex(x => !x.url && x.name === item.name);
        if (placeholder >= 0) kept.media.splice(placeholder, 1);
      }
      kept.media.push(item);
    }
  }

  function nearBottom(scroller) {
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < scroller.clientHeight;
  }

  function nudge(scroller, top) {
    scroller.scrollTop = top;
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: top === 0 ? -1200 : 1200, bubbles: true }));
  }

  async function loadHistory(root, timeoutMinutes) {
    const scroller = scrollParent(root);
    const start = Date.now();
    const limit = timeoutMinutes ? timeoutMinutes * 60000 : Infinity;
    const seen = new Map();
    let collected = [];

    const harvest = prepend => {
      const fresh = [];
      messageNodes(root).forEach((node, i) => {
        let parsed;
        try { parsed = parseMessage(node, i); } catch { return; }
        const key = messageKey(parsed);
        const kept = seen.get(key);
        if (kept) { mergeMessage(kept, parsed); return; }
        seen.set(key, parsed);
        fresh.push(parsed);
      });
      if (fresh.length) collected = prepend ? [...fresh, ...collected] : [...collected, ...fresh];
      return fresh.length;
    };

    // Start from the newest message so the tail of the chat is never missed,
    // then walk upwards through the history.
    if (!nearBottom(scroller)) {
      notify("Jumping to the newest message…", 4);
      for (let i = 0; i < 3 && !job.cancelled; i++) {
        nudge(scroller, scroller.scrollHeight);
        await sleep(700);
      }
      harvest(false);
    }

    let stable = 0, round = 0, signature = "", count = 0;
    while (!job.cancelled && Date.now() - start < limit && stable < 6) {
      harvest(true);
      const nodes = messageNodes(root);
      const nextSignature = `${nodes.length}:${scroller.scrollHeight}:${nodes[0]?.dataset?.mid || nodes[0]?.dataset?.msgId || nodes[0]?.dataset?.sid || ""}`;
      stable = nextSignature === signature && collected.length === count ? stable + 1 : 0;
      signature = nextSignature;
      count = collected.length;
      round++;

      notify(`Loading older messages… ${collected.length} collected`, Math.min(45, 5 + round));
      nudge(scroller, 0);
      scroller.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", code: "Home", bubbles: true }));
      await sleep(900 + Math.min(stable, 3) * 400);
    }

    harvest(true);
    if (job.cancelled) throw new Error("Export cancelled.");
    if (Date.now() - start >= limit) notify("Time limit reached; exporting everything loaded so far.", 48);

    // Restore chronological order when every message carries a comparable key.
    if (collected.length && collected.every(m => m._sort > 0)) {
      collected.sort((a, b) => a._sort - b._sort || a._index - b._index);
    }
    return collected;
  }

  /* ---------------------------------------------------------- media archive */

  async function downloadMedia(messages, zip) {
    const all = messages.flatMap(m => m.media);
    const used = new Set();
    let done = 0, saved = 0, failed = 0;

    for (const item of all) {
      if (job.cancelled) throw new Error("Export cancelled.");
      try {
        if (!item.url) throw new Error(item.error || `${PLATFORM_NAME} did not expose a downloadable URL for this item`);
        const captured = await (job.mediaCache.get(item.url) ||
          fetchInPage(item.url).then(v => ({ ok: true, ...v }), e => ({ ok: false, error: e?.message || String(e) })));
        if (!captured.ok) throw new Error(captured.error);

        const fallbackExt = { photo: ".jpg", sticker: ".webp", video: ".mp4", video_message: ".mp4", voice: ".ogg", file: "" }[item.type] || "";
        let base = safe(item.name, "");
        if (!hasExtension(base)) {
          base = (base || `${item.type}_${String(done + 1).padStart(4, "0")}`) + (mimeExtension(captured.mime) || fallbackExt);
        }
        let path = `media/${base}`;
        let n = 2;
        while (used.has(path)) path = `media/${base.replace(/(\.[^.]+)?$/, `_${n++}$1`)}`;
        used.add(path);

        if (!zip.add(path, captured.bytes)) throw new Error("Archive size limit reached (4 GB)");
        item.path = path;
        item.mime_type = captured.mime;
        item.size_bytes = captured.bytes.length;
        delete item.url;
        delete item.error;
        saved++;
      } catch (error) {
        item.error = /^[A-Z]/.test(error.message) ? error.message : `Could not download: ${error.message}`;
        delete item.url;
        failed++;
      }
      done++;
      notify(`Downloading media… ${done} of ${all.length}`, 55 + Math.round((done / Math.max(all.length, 1)) * 30));
    }
    return { total: all.length, saved, failed };
  }

  /* --------------------------------------------------------- HTML transcript */

  const LINK = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]])/g;
  const richText = value => esc(value).replace(LINK, url => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`).replace(/\n/g, "<br>");

  function dayLabel(message) {
    if (message.day) return message.day;
    const time = Date.parse(message.date);
    if (!time) return "";
    try { return new Date(time).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }); }
    catch { return message.date.slice(0, 10); }
  }

  function renderMedia(item) {
    const label = esc(item.name || item.path || item.type);
    if (!item.path) {
      const reason = item.error || "Media files were not included in this export.";
      return `<div class="attach missing"><span class="kind">${esc(item.type)}</span> ${esc(item.name || "")}` +
        `<em>${esc(reason)}</em></div>`;
    }
    const href = encodeURI(item.path);
    if (item.type === "photo" || item.type === "sticker") {
      return `<a class="attach image" href="${href}" target="_blank"><img src="${href}" alt="${label}" loading="lazy"></a>`;
    }
    if (item.type === "video" || item.type === "video_message") {
      return `<div class="attach"><video src="${href}" controls preload="metadata"></video></div>`;
    }
    if (item.type === "voice") {
      return `<div class="attach"><audio src="${href}" controls preload="none"></audio></div>`;
    }
    return `<a class="attach file" href="${href}" download><span class="kind">file</span> ${label}` +
      `${item.size_bytes ? `<em>${bytesLabel(item.size_bytes)}</em>` : ""}</a>`;
  }

  function renderMessage(message) {
    const header = [
      `<b class="who">${esc(message.from)}</b>`,
      message.display_time || message.date ? `<span class="when">${esc(message.display_time || message.date)}</span>` : "",
      message.edited ? '<span class="tag">edited</span>' : "",
    ].filter(Boolean).join("");

    return `<article class="msg ${message.direction}" data-search="${esc((message.from + " " + message.text).toLowerCase())}">` +
      `<div class="head">${header}</div>` +
      (message.forwarded_from ? `<div class="forward">Forwarded from ${esc(message.forwarded_from)}</div>` : "") +
      (message.reply_to ? `<blockquote dir="auto">${richText(message.reply_to)}</blockquote>` : "") +
      (message.text ? `<div class="text" dir="auto">${richText(message.text)}</div>` : "") +
      message.media.map(renderMedia).join("") +
      "</article>";
  }

  function htmlDocument(title, messages, meta) {
    const body = [];
    let currentDay = null;
    for (const message of messages) {
      const label = dayLabel(message);
      if (label && label !== currentDay) {
        currentDay = label;
        body.push(`<div class="day"><span>${esc(label)}</span></div>`);
      }
      body.push(renderMessage(message));
    }

    const stats = [
      `${messages.length} messages`,
      meta.media.total ? `${meta.media.saved} of ${meta.media.total} media files` : "no media",
      `exported ${esc(new Date(meta.exportedAt).toLocaleString())}`,
    ].join(" · ");

    return `<!doctype html>
<html lang="fa" dir="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — ${esc(meta.platform)} export</title>
<style>
  :root{--bg:#e9eef2;--panel:#fff;--ink:#152431;--muted:#6b7b88;--in:#fff;--out:#e4f5cf;--line:#d7e0e7;--accent:#1c8fc4}
  @media (prefers-color-scheme:dark){:root{--bg:#12191f;--panel:#1b242c;--ink:#e6edf3;--muted:#93a3af;--in:#1f2a33;--out:#26402c;--line:#2c3944;--accent:#4bb7ea}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 "Vazirmatn","Segoe UI",system-ui,sans-serif}
  .wrap{max-width:920px;margin:0 auto;padding:24px 16px 80px}
  header.top{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:20px 22px;margin-bottom:18px}
  header.top h1{margin:0 0 6px;font-size:22px;word-break:break-word}
  header.top p{margin:0;color:var(--muted);font-size:13px}
  .tools{display:flex;gap:10px;align-items:center;margin:14px 0 0}
  .tools input{flex:1;min-width:0;padding:9px 12px;border:1px solid var(--line);border-radius:10px;background:transparent;color:inherit;font:inherit}
  .tools span{color:var(--muted);font-size:12px;white-space:nowrap}
  .day{display:flex;justify-content:center;margin:20px 0 12px}
  .day span{background:#00000018;color:var(--muted);border-radius:999px;padding:4px 14px;font-size:12px}
  @media (prefers-color-scheme:dark){.day span{background:#ffffff14}}
  .msg{max-width:78%;background:var(--in);border:1px solid var(--line);border-radius:14px;padding:9px 13px;margin:8px 0;box-shadow:0 1px 2px #00000012;overflow-wrap:anywhere}
  .msg.outgoing{margin-inline-start:auto;background:var(--out)}
  .head{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;font-size:12px}
  .who{color:var(--accent)}
  .when{color:var(--muted);margin-inline-start:auto}
  .tag{color:var(--muted);font-style:italic}
  .forward{font-size:12px;color:var(--muted);margin-top:3px}
  blockquote{margin:6px 0;padding-inline-start:10px;border-inline-start:3px solid var(--accent);color:var(--muted);font-size:13px}
  .text{margin-top:4px;white-space:pre-wrap}
  .text a{color:var(--accent)}
  .attach{display:block;margin-top:8px;font-size:13px;color:var(--accent);text-decoration:none}
  .attach img,.attach video{display:block;max-width:100%;max-height:420px;border-radius:10px}
  .attach audio{width:100%;max-width:340px}
  .attach.file{border:1px solid var(--line);border-radius:10px;padding:8px 10px;display:flex;gap:8px;align-items:center}
  .attach .kind{background:#00000012;border-radius:6px;padding:1px 7px;font-size:11px;color:var(--muted);text-transform:uppercase}
  .attach em{color:var(--muted);font-style:normal;font-size:12px}
  .missing{color:var(--muted);border:1px dashed var(--line);border-radius:10px;padding:8px 10px}
  .missing em{display:block;margin-top:2px;font-size:11px}
  .hidden{display:none}
  footer{text-align:center;color:var(--muted);font-size:12px;padding:24px 0}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <h1 dir="auto">${esc(title)}</h1>
    <p>${stats}</p>
    <div class="tools">
      <input id="q" type="search" placeholder="Search this transcript…" autocomplete="off">
      <span id="count"></span>
    </div>
  </header>
  <main id="log">
${body.join("\n")}
  </main>
  <footer>Generated locally by ${esc(meta.platform)} Chat Export · schema ${esc(meta.schemaVersion)}</footer>
</div>
<script>
(function(){
  var box=document.getElementById('q'),count=document.getElementById('count');
  var items=[].slice.call(document.querySelectorAll('.msg'));
  var days=[].slice.call(document.querySelectorAll('.day'));
  function total(){count.textContent=items.filter(function(m){return !m.classList.contains('hidden')}).length+' shown';}
  box.addEventListener('input',function(){
    var q=box.value.trim().toLowerCase();
    items.forEach(function(m){m.classList.toggle('hidden',!!q&&m.dataset.search.indexOf(q)<0)});
    days.forEach(function(d){d.classList.toggle('hidden',!!q)});
    total();
  });
  total();
})();
<\/script>
</body>
</html>`;
  }

  /* -------------------------------------------------------------------- run */

  async function run(options) {
    try {
      const root = findConversation();
      job.title = titleOf(root);
      notify(`Reading “${job.title}”…`, 3);

      const messages = await loadHistory(root, options.timeoutMinutes);
      if (!messages.length) throw new Error("No messages were found in the open conversation.");
      notify(`Found ${messages.length} messages.`, 50);

      const zip = new BaleZipStore();
      const exportedAt = new Date().toISOString();
      let media = { total: 0, saved: 0, failed: 0 };

      if (options.includeMedia) {
        media = await downloadMedia(messages, zip);
      } else {
        for (const message of messages) for (const item of message.media) delete item.url;
        media.total = messages.reduce((n, m) => n + m.media.length, 0);
      }

      notify("Building archive…", 90);
      for (const message of messages) { delete message._sort; delete message._index; }

      const meta = { platform: PLATFORM_NAME, schemaVersion: "2.0", exportedAt, media };
      const result = {
        about: `${PLATFORM_NAME} chat export produced by Iranian Messenger Chat Export ${VERSION}`,
        schema_version: meta.schemaVersion,
        exported_at: exportedAt,
        source: { app: PLATFORM_NAME, platform: PLATFORM, url: location.origin },
        name: job.title,
        type: "personal_chat",
        id: "",
        stats: { messages: messages.length, media_total: media.total, media_saved: media.saved, media_failed: media.failed },
        messages,
      };

      zip.add("result.json", JSON.stringify(result, null, 2));
      zip.add("messages.html", htmlDocument(job.title, messages, meta));
      zip.add("README.txt", [
        `${PLATFORM_NAME} chat export`,
        `Chat:     ${job.title}`,
        `Messages: ${messages.length}`,
        `Media:    ${media.saved} saved, ${media.failed} unavailable, ${media.total} referenced`,
        `Exported: ${exportedAt}`,
        "",
        "Open messages.html in a browser to read this archive.",
        "result.json holds the same conversation as structured data.",
        "media/ holds every file that could be read from the page.",
      ].join("\n"));

      const blob = zip.blob();
      const url = URL.createObjectURL(blob);
      const filename = `${safe(`${PLATFORM_NAME} ${job.title}`, PLATFORM_NAME)}_${exportedAt.slice(0, 10)}.zip`;
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.style.display = "none";
      document.documentElement.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 120000);

      notify(`Done — ${messages.length} messages, ${bytesLabel(zip.size)} archive.`, 100, true);
    } catch (error) {
      notify(error?.message || String(error), null, false, true);
    } finally {
      job = null;
    }
  }

  /* -------------------------------------------------------------- messaging */

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type === "BALE_EXPORT_PING") {
      respond({ ok: true, version: VERSION, platform: PLATFORM, name: PLATFORM_NAME, busy: !!job });
      return;
    }
    if (message.type === "BALE_EXPORT_CANCEL") {
      if (job) job.cancelled = true;
      respond({ ok: true });
      return;
    }
    if (message.type !== "BALE_EXPORT_START") return;
    if (job) { respond({ ok: false, error: "An export is already running." }); return; }
    job = { cancelled: false, includeMedia: !!message.includeMedia, mediaCache: new Map(), title: "" };
    run(message);
    respond({ ok: true });
  });
})();
