# Iranian Messenger Chat Export

A privacy-first Chrome extension that exports one open conversation from **Bale**, **Eitaa**, or **Rubika** Web into a Telegram-style ZIP archive. Everything runs inside your browser — no chat data leaves the machine.

Supported sites:

| Site | Adapter |
| --- | --- |
| `https://web.bale.ai/` | Bale's own React interface |
| `https://web.eitaa.com/` | Telegram Web K fork |
| `https://web.rubika.ir/` | Telegram Web K fork |

## Export contents

```
Bale گروه طراحی_2026-09-02.zip
├── messages.html   standalone transcript: day separators, replies, inline media, search box
├── result.json     structured message data (Telegram-export-like schema)
├── media/          photos, stickers, video, voice notes and files
└── README.txt      archive summary
```

`messages.html` opens in any browser, works offline, is right-to-left aware, follows your
system light/dark theme, and has a search field that filters the transcript.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Open (or refresh) a supported messenger site, sign in, and select one chat.
5. Click the extension icon and choose **Export open chat**.

After updating the extension, press its reload button on `chrome://extensions` **and** refresh
the messenger tab — Chrome does not replace an already-injected content script.

## How it works

**History loading.** The exporter scrolls the conversation upwards, harvesting messages on every
pass. Telegram-style clients drop off-screen messages from the DOM, so each pass merges into what
was already collected rather than replacing it — a message that gains an image or a longer caption
later keeps the richer version. If the chat was scrolled up when you started, it first jumps to the
newest message so the tail is not missed. Messages are re-sorted chronologically before writing.

**Media.** Photos and voice notes are frequently backed by `blob:` URLs that the app revokes the
moment a message scrolls out of view, so media is fetched the instant it appears rather than at the
end. Because `blob:` URLs are readable only inside the page's own JavaScript world, `main-world.js`
runs there and hands the bytes back to the extension. Network downloads are limited to six at a
time; `blob:` reads bypass the queue since they are in-memory and time-critical.

Reply thumbnails, avatars, emoji images and file-type badges are deliberately excluded — they are
interface chrome, not message content.

**Timestamps.** Bale and Eitaa expose a real epoch on each message. Rubika does not, so its Persian
day heading (`یکشنبه، 11 مرداد 1405`) plus the message clock are converted from the Jalali calendar
to produce genuine ISO timestamps in `result.json`.

## Known limits

- **Files must be downloaded once inside the app first.** These clients keep an undownloaded
  document entirely out of the page, so the archive can only record its name. Open the message,
  press download, then export again.
- Sticker and voice capture depends on what the client has actually materialised in the DOM.
- The archive is assembled in memory before Chrome saves it, so very large chats use substantial
  memory. Keep the tab open until the download prompt appears. Archives are capped at 4 GB.
- These are private, evolving web apps. Each site has a dedicated adapter plus semantic fallbacks,
  but interface changes may still require selector updates.

## Development

The parsers are plain DOM code and can be exercised offline against a saved page
(`Ctrl+S` → *Webpage, Single File*) using jsdom — see the adapters in `content.js`:
`messageNodes`, `parseBale`, and `parseTelegramStyle`.

```
manifest.json    MV3 manifest
content.js       adapters, history loading, media capture, HTML/JSON writers
main-world.js    page-world fetch bridge for blob: media
lib/zip.js       dependency-free store-only ZIP writer
popup.*          extension popup
content.css      in-page progress toast
```

## Legal

Unofficial; not affiliated with Bale, Eitaa, Rubika, or Telegram. Export only conversations you are
authorised to access.
