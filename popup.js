const $ = (id) => document.getElementById(id);
let active = false;

async function baleTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\/web\.bale\.ai\//.test(tab.url || "")) throw new Error("Open web.bale.ai and select a chat first.");
  return tab;
}

function show(message, progress = null, error = false) {
  $("status").textContent = message;
  $("status").className = error ? "error" : "";
  if (progress == null) $("progress").hidden = true;
  else { $("progress").hidden = false; $("progress").value = progress; }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "BALE_EXPORT_PROGRESS") return;
  show(msg.message, msg.progress ?? 0, !!msg.error);
  if (msg.done || msg.error) setActive(false);
});

function setActive(value) {
  active = value; $("export").disabled = value; $("cancel").hidden = !value;
}

$("export").addEventListener("click", async () => {
  try {
    const tab = await baleTab(); setActive(true); show("Finding the active conversation…", 2);
    const response = await chrome.tabs.sendMessage(tab.id, { type: "BALE_EXPORT_START", includeMedia: $("media").checked, timeoutMinutes: Number($("timeout").value) });
    if (!response?.ok) throw new Error(response?.error || "The exporter could not start.");
  } catch (error) { setActive(false); show(error.message, null, true); }
});

$("cancel").addEventListener("click", async () => {
  try { const tab = await baleTab(); await chrome.tabs.sendMessage(tab.id, { type: "BALE_EXPORT_CANCEL" }); show("Cancelling…", 0); } catch {}
});
