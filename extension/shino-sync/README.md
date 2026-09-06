# SHINO Sync — Chrome extension

Companion extension for **SHINO // CONTROL**. It registers the current ChatGPT work thread so CONTROL can show a real **Continue in ChatGPT** resume button and derive project state from the conversation.

## Load unpacked

1. Start CONTROL locally: `npm start` in the repository root.
2. Open Chrome → `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select this `extension/shino-sync` folder.
6. Open the extension popup.
7. Keep the default endpoint `http://127.0.0.1:4177/api/ingest/chatgpt`.
8. Turn on **Auto-sync this browser**.
9. On any ChatGPT project thread, use **Sync this chat now** once; v0.1.1 automatically saves the current toggle/endpoint before the capture, and later meaningful DOM changes are debounced and synced automatically.

## Privacy / safety

SHINO Sync captures only the current ChatGPT page URL, page title, readable message text exposed in the page DOM, a deterministic conversation key, and client timestamps. It does **not** read or send cookies, authorization headers, passwords, unrelated tabs, or browser history.

If ChatGPT changes its DOM and messages cannot be safely located, the extension reports **Capture unavailable** rather than inventing content.

For a remote CONTROL server, set `SHINO_SYNC_TOKEN` on the server and put the same token in the extension popup. The extension requests host permission only for the configured endpoint origin.
