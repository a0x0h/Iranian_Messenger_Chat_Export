const $ = id => document.getElementById(id);

const SUPPORTED = {
  "web.bale.ai": "Bale",
  "web.eitaa.com": "Eitaa",
  "web.rubika.ir": "Rubika",
};

const DEFAULTS = { media: true, timeout: "15" };

function friendlyError(error) {
  const message = error?.message || String(error || "Unknown error");
  if (/receiving end does not exist|could not establish connection|message port closed/i.test(message)) {
    return new Error("Chat Export is not active in this tab. Refresh the messenger page, reopen the chat, and try again.");
  }
  if (/cannot access contents|extensions gallery cannot be scripted/i.test(message)) {
    return new Error("Chrome cannot access this page. Open the chat directly in Bale, Eitaa, or Rubika Web.");
  }
  return error instanceof Error ? error : new Error(message);
}

async function messengerTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let host = "";
  try { host = new URL(tab?.url || "").hostname; } catch { /* about:blank and friends */ }
  const platform = SUPPORTED[host];
  if (!tab || !platform) throw new Error("Open a chat in Bale, Eitaa, or Rubika Web first.");
  return { ...tab, platform };
}

function show(message, progress = null, error = false) {
  $("status").textContent = message;
  $("status").className = error ? "error" : "";
  const bar = $("progress");
  bar.hidden = progress == null;
  if (!bar.hidden) bar.value = progress;
}

function setActive(running) {
  $("export").disabled = running;
  $("cancel").hidden = !running;
  $("media").disabled = running;
  $("timeout").disabled = running;
}

async function loadSettings() {
  try {
    const saved = await chrome.storage.local.get(DEFAULTS);
    $("media").checked = saved.media !== false;
    $("timeout").value = String(saved.timeout ?? DEFAULTS.timeout);
  } catch { /* storage unavailable; defaults from the markup stand */ }
}

function rememberSettings() {
  try { chrome.storage.local.set({ media: $("media").checked, timeout: $("timeout").value }); } catch {}
}

chrome.runtime.onMessage.addListener(msg => {
  if (msg.type !== "BALE_EXPORT_PROGRESS") return;
  show(msg.message, msg.progress ?? null, !!msg.error);
  if (msg.done || msg.error) setActive(false);
});

$("media").addEventListener("change", rememberSettings);
$("timeout").addEventListener("change", rememberSettings);

$("export").addEventListener("click", async () => {
  try {
    const tab = await messengerTab();
    setActive(true);
    show(`Finding the active ${tab.platform} conversation…`, 2);

    const ready = await chrome.tabs.sendMessage(tab.id, { type: "BALE_EXPORT_PING" });
    if (!ready?.ok) throw new Error(`Chat Export is not ready. Refresh ${tab.platform} Web and try again.`);
    if (ready.busy) throw new Error("An export is already running in this tab.");

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "BALE_EXPORT_START",
      includeMedia: $("media").checked,
      timeoutMinutes: Number($("timeout").value),
    });
    if (!response?.ok) throw new Error(response?.error || "The exporter could not start.");
  } catch (error) {
    setActive(false);
    show(friendlyError(error).message, null, true);
  }
});

$("cancel").addEventListener("click", async () => {
  try {
    const tab = await messengerTab();
    await chrome.tabs.sendMessage(tab.id, { type: "BALE_EXPORT_CANCEL" });
    show("Cancelling…", 0);
  } catch { /* the tab went away; the toast in the page handles the rest */ }
});

(async () => {
  await loadSettings();
  try {
    const tab = await messengerTab();
    $("app-title").textContent = `${tab.platform} Chat Export`;
    $("app-subtitle").textContent = "Archive one conversation";
    const ready = await chrome.tabs.sendMessage(tab.id, { type: "BALE_EXPORT_PING" });
    if (!ready?.ok) return;
    if (ready.busy) {
      setActive(true);
      show(`An export is running in this ${tab.platform} tab…`, 0);
    } else {
      show(`Ready to export the open ${tab.platform} conversation.`);
    }
  } catch (error) {
    show(friendlyError(error).message, null, true);
  }
})();
