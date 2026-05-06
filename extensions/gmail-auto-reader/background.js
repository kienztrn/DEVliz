/* global chrome */
'use strict';

const GMAIL_URL = 'https://mail.google.com/mail/u/0/#inbox';

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(
    ['readSeconds', 'maxItems', 'humanLike'],
    (vals) => {
      const defaults = {};
      if (typeof vals.readSeconds !== 'number') defaults.readSeconds = 5;
      if (typeof vals.maxItems !== 'number') defaults.maxItems = 50;
      if (typeof vals.humanLike !== 'boolean') defaults.humanLike = true;
      if (Object.keys(defaults).length > 0) {
        chrome.storage.sync.set(defaults);
      }
    },
  );
});

// Allow other extension surfaces (popup, content script) to ask the background
// to open / focus a Gmail tab.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'gar:open-gmail') return false;
  chrome.tabs.query({ url: 'https://mail.google.com/*' }, (tabs) => {
    if (tabs && tabs.length > 0) {
      const t = tabs[0];
      chrome.tabs.update(t.id, { active: true });
      if (t.windowId !== undefined) {
        try {
          chrome.windows.update(t.windowId, { focused: true });
        } catch (_) {
          /* ignore */
        }
      }
      sendResponse({ ok: true, tabId: t.id, created: false });
    } else {
      chrome.tabs.create({ url: GMAIL_URL, active: true }, (tab) => {
        sendResponse({ ok: true, tabId: tab && tab.id, created: true });
      });
    }
  });
  return true; // keep channel open for async sendResponse
});
