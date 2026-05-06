# Gmail Auto Reader (Chrome extension)

A small standalone Chrome extension (Manifest V3) that opens Gmail and rotates
through every unread email in the Inbox: open → wait a few seconds → back to
inbox → next unread → repeat until none are left.

It's a stripped-down sibling of the **Gmail rotate-unread** automation that
ships inside the DEVliz Electron app — no profiles, no proxies, no Electron, no
network calls. Just install the extension into your normal Chrome profile and
click the toolbar icon.

> ⚠️ **Use responsibly.** Don't use this to violate any service's terms of use.
> "Reading" an email here only means clicking it; Gmail will mark the email as
> read as a result. Be careful — once an email is opened, it's no longer
> unread.

## Features

- One-click "Open Gmail & Start" from the toolbar popup.
- Auto-detects unread rows via Gmail's `tr.zE` class (with an `aria-label`
  fallback).
- Configurable read time per email (1–120s) and max number of emails (1–200).
- Optional human-like cadence (±20% jitter on every wait).
- Floating overlay inside Gmail with live progress and an emergency Stop
  button.
- Auto-dismisses common Gmail "Got it" / "No thanks" / "Bỏ qua" popups before
  iterating.
- All state is stored in `chrome.storage` only. No network requests at all.

## Install (unpacked, for development)

1. Open Chrome and go to `chrome://extensions`.
2. Toggle **Developer mode** in the top-right.
3. Click **Load unpacked** and pick the `extensions/gmail-auto-reader/` folder
   in this repo.
4. Pin the extension to the toolbar.
5. Click the icon → **Mở Gmail & Bắt đầu** (Open Gmail & Start).

## How it works

```
popup.html ─ click "Start" ─▶ popup.js
                                │
                                ├─ chrome.storage.local.set({ autoStart: true })
                                ├─ chrome.tabs.create({ url: mail.google.com })
                                └─ chrome.tabs.sendMessage(tab, "gar:start")
                                            │
                                            ▼
                                       content.js  (running on mail.google.com)
                                            │
                                            ├─ overlay UI (status + Stop button)
                                            ├─ findUnreadRow() → click row
                                            ├─ wait jitter(readMs)
                                            ├─ navigateBackToInbox()
                                            └─ repeat until no more unread
```

The content script also reads the `autoStart` flag on load (with a 30s freshness
window), so the popup → new-tab → content-script handshake works even if the
content script isn't ready yet when the popup tries to send the first message.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest. `host_permissions` limited to `https://mail.google.com/*`. |
| `background.js` | Service worker. Sets defaults on install; lets surfaces ask for "open or focus a Gmail tab". |
| `popup.html` / `popup.css` / `popup.js` | Toolbar popup UI: Start, Stop, settings, live status. |
| `content.css` / `content.js` | Injected into Gmail; runs the rotation loop and shows the floating overlay. |
| `icons/icon-16.png` etc. | Toolbar / store icons. |

## Permissions

| Permission | Why |
| --- | --- |
| `storage` | Persist user settings + the one-shot `autoStart` flag. |
| `tabs` | Find an existing Gmail tab so we focus it instead of opening duplicates. |
| `scripting` | Reserved for future targeted re-injection; not strictly required today. |
| `host_permissions: https://mail.google.com/*` | The content script + tab queries are scoped to Gmail only. |

## Limitations

- Gmail's DOM changes from time to time. The selectors here mirror the ones
  used by DEVliz's `extension-builder.ts` Gmail watcher (primary: `tr.zE`,
  fallback: `aria-label$="unread"`). If Google ships a new layout, these may
  need an update.
- Only the current account's `#inbox` view is iterated. Other labels
  (`#label/Foo`, `#imp`, etc.) are not visited.
- Once an email is opened, Gmail marks it as read — there's no way to "preview
  without marking read" through the UI; that's a Gmail limitation, not
  ours.
