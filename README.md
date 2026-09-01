# Bale Chat Export

A privacy-first Chrome extension that exports one open conversation from [Bale Web](https://web.bale.ai/) into a Telegram-style ZIP archive.

## Export contents

- `messages.html` — a standalone, browsable transcript
- `result.json` — structured message data
- `media/` — photos, videos, voice messages, and files (optional)
- `README.txt` — archive summary

The extension loads older messages by scrolling the active conversation to the beginning. Extraction and ZIP creation happen locally in the browser; no chat data is sent to a third party.

Media is captured from Bale's own page context as soon as it appears. This is necessary because Bale represents many photos and voice messages with temporary `blob:` URLs that stop working after the message leaves the visible area.

## Install

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this project folder.
5. Open or refresh `https://web.bale.ai/`, sign in, and select one chat.
6. Click the extension icon and choose **Export open chat**.

After updating the extension, click its reload button on `chrome://extensions` and then refresh the Bale Web tab. Chrome does not replace an already-injected content script automatically.

Keep the Bale tab open until Chrome asks where to save the ZIP. Very large chats can use substantial memory because Chrome extensions must assemble the archive before downloading it.

## Notes

Bale Web is a private, evolving web application. The extractor deliberately uses several semantic DOM fallbacks instead of depending on one minified CSS class. Interface changes may still require selector updates.

This project is unofficial and is not affiliated with Bale or Telegram. Export only conversations you are authorized to access.
