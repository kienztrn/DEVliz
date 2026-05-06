/* global chrome */
(() => {
  'use strict';

  if (window.__GAR_LOADED__) return;
  window.__GAR_LOADED__ = true;

  const TAG = '[gmail-auto-reader]';

  const state = {
    running: false,
    stopRequested: false,
    processed: 0,
    maxItems: 0,
    subject: '',
    lastPhase: 'idle',
    lastMessage: '',
  };

  // ---------- Overlay ----------

  let overlay;
  let overlayPill;
  let overlayDetail;
  let overlayStartBtn;
  let overlayStopBtn;
  let overlayCloseBtn;

  function buildOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'gar-overlay';
    overlay.dataset.state = 'visible';
    overlay.innerHTML = `
      <div class="gar-row">
        <span class="gar-title">Gmail Auto Reader</span>
        <span class="gar-pill" data-state="idle">Idle</span>
      </div>
      <div class="gar-detail">Sẵn sàng. Bấm Start để mở từng email chưa đọc.</div>
      <div class="gar-actions">
        <button class="gar-start" type="button">Start</button>
        <button class="gar-stop" type="button">Stop</button>
        <button class="gar-secondary gar-hide" type="button" title="Ẩn overlay">×</button>
      </div>
    `;
    document.documentElement.appendChild(overlay);
    overlayPill = overlay.querySelector('.gar-pill');
    overlayDetail = overlay.querySelector('.gar-detail');
    overlayStartBtn = overlay.querySelector('.gar-start');
    overlayStopBtn = overlay.querySelector('.gar-stop');
    overlayCloseBtn = overlay.querySelector('.gar-hide');

    overlayStartBtn.addEventListener('click', () => {
      loadSettings().then((settings) => startAutomation(settings));
    });
    overlayStopBtn.addEventListener('click', () => requestStop());
    overlayCloseBtn.addEventListener('click', () => {
      overlay.dataset.state = 'hidden';
    });
  }

  function setOverlay(pillState, label, detail) {
    if (!overlay) return;
    overlayPill.dataset.state = pillState;
    overlayPill.textContent = label;
    if (detail !== undefined) overlayDetail.textContent = detail;
    overlayStartBtn.disabled = state.running;
    overlayStopBtn.disabled = !state.running;
  }

  // ---------- Settings + storage ----------

  function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(
        ['readSeconds', 'maxItems', 'humanLike'],
        (vals) => {
          resolve({
            readSeconds:
              typeof vals.readSeconds === 'number' ? vals.readSeconds : 5,
            maxItems: typeof vals.maxItems === 'number' ? vals.maxItems : 50,
            humanLike: typeof vals.humanLike === 'boolean' ? vals.humanLike : true,
          });
        },
      );
    });
  }

  // ---------- Helpers ----------

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function rand(min, max) {
    return Math.floor(min + Math.random() * (max - min + 1));
  }

  function jitter(baseMs, humanLike) {
    if (!humanLike) return baseMs;
    const variance = Math.floor(baseMs * 0.2);
    return rand(baseMs - variance, baseMs + variance);
  }

  function postProgress(phase, extra) {
    extra = extra || {};
    state.lastPhase = phase;
    if (extra.message) state.lastMessage = extra.message;
    if (extra.subject !== undefined) state.subject = extra.subject;
    if (extra.index !== undefined) state.processed = extra.index;
    if (extra.total !== undefined) state.maxItems = extra.total;
    try {
      chrome.runtime.sendMessage({
        type: 'gar:progress',
        progress: Object.assign({ phase }, extra),
      });
    } catch (_) {
      /* popup may be closed; that's fine */
    }
    updateOverlayFromState(phase, extra);
  }

  function updateOverlayFromState(phase, extra) {
    extra = extra || {};
    if (phase === 'started') {
      setOverlay('running', 'Running', `Bắt đầu — tối đa ${extra.total} email.`);
    } else if (phase === 'opening' || phase === 'reading') {
      const verb = phase === 'opening' ? 'Đang mở' : 'Đang đọc';
      const subj = extra.subject ? ` — ${extra.subject}` : '';
      setOverlay('running', 'Running', `${verb} ${extra.index}/${extra.total}${subj}`);
    } else if (phase === 'done-item') {
      setOverlay(
        'running',
        'Running',
        `Đã đọc ${extra.index}/${extra.total}.`,
      );
    } else if (phase === 'finished') {
      setOverlay('done', 'Done', `Hoàn tất. Đã đọc ${extra.total} email.`);
    } else if (phase === 'no-unread') {
      setOverlay('done', 'Done', 'Không còn email chưa đọc.');
    } else if (phase === 'error') {
      setOverlay('error', 'Error', extra.message || 'Có lỗi.');
    } else if (phase === 'stopped') {
      setOverlay(
        'idle',
        'Stopped',
        `Đã dừng ở ${extra.index || 0}/${extra.total || 0}.`,
      );
    } else if (phase === 'dismiss-popup') {
      setOverlay('running', 'Running', extra.message || 'Đã đóng popup.');
    }
  }

  // ---------- Gmail DOM helpers (adapted from DEVliz extension-builder) ----------

  function dismissPopups() {
    let dismissed = 0;
    const dismissTexts = [
      'got it',
      'no thanks',
      'skip',
      'maybe later',
      'cancel',
      'close',
      'bỏ qua',
      'để sau',
      'đừng hỏi lại',
      'đã hiểu',
      'không, cảm ơn',
    ];
    try {
      const buttons = document.querySelectorAll('button, [role="button"]');
      buttons.forEach((btn) => {
        const txt = (btn.textContent || '').trim().toLowerCase();
        const aria = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
        const target = txt || aria;
        if (!target) return;
        for (let i = 0; i < dismissTexts.length; i++) {
          if (target.indexOf(dismissTexts[i]) !== -1) {
            try {
              btn.click();
              dismissed++;
            } catch (_) {
              /* ignore */
            }
            break;
          }
        }
      });
    } catch (_) {
      /* ignore */
    }
    return dismissed;
  }

  function findUnreadRow() {
    // Primary selector: Gmail marks unread rows with `zE` on the `tr.zA`.
    const r = document.querySelector('tr.zE');
    if (r) return r;
    // Fallback: rows whose accessible label ends with "unread".
    const labeled = document.querySelector(
      'tr.zA[aria-labelledby] [aria-label$="unread"]',
    );
    if (labeled) {
      const row = labeled.closest ? labeled.closest('tr.zA') : null;
      if (row) return row;
    }
    return null;
  }

  function rowSubject(row) {
    if (!row) return '';
    try {
      const subjEl = row.querySelector(
        '[role="link"] span, .y6 span, .bog span, .bog',
      );
      if (subjEl) return (subjEl.textContent || '').trim().slice(0, 200);
      return (row.textContent || '').trim().slice(0, 100);
    } catch (_) {
      return '';
    }
  }

  async function navigateBackToInbox() {
    try {
      const back = document.querySelector(
        '[aria-label="Back to Inbox"], [aria-label*="quay lại"], [data-tooltip*="Back to Inbox"]',
      );
      if (back) {
        back.click();
        return;
      }
    } catch (_) {
      /* ignore */
    }
    try {
      history.back();
    } catch (_) {
      /* ignore */
    }
    if (location.hash && location.hash.indexOf('#inbox') !== 0) {
      try {
        location.hash = '#inbox';
      } catch (_) {
        /* ignore */
      }
    }
  }

  async function waitForInbox(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (
        location.hash.indexOf('#inbox') === 0 &&
        document.querySelector('table[role="grid"], table.F.cf.zt')
      ) {
        return true;
      }
      await sleep(300);
    }
    return false;
  }

  async function waitForGmailReady(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (document.querySelector('table[role="grid"], table.F.cf.zt, tr.zA')) {
        return true;
      }
      await sleep(400);
    }
    return false;
  }

  // ---------- Automation ----------

  function requestStop() {
    state.stopRequested = true;
    setOverlay('idle', 'Stopping…', 'Đang dừng…');
  }

  async function startAutomation(settings) {
    if (state.running) {
      console.warn(TAG, 'already running');
      return;
    }
    state.running = true;
    state.stopRequested = false;
    state.processed = 0;
    state.subject = '';

    const readSeconds = clamp(
      typeof settings.readSeconds === 'number' ? settings.readSeconds : 5,
      1,
      120,
    );
    const maxItems = clamp(
      typeof settings.maxItems === 'number' ? settings.maxItems : 50,
      1,
      200,
    );
    const humanLike = settings.humanLike !== false;
    const readMs = readSeconds * 1000;
    const openMs = 2000; // small wait for the email to render before scrolling

    state.maxItems = maxItems;

    try {
      postProgress('started', { total: maxItems });

      await waitForGmailReady(15000);

      // Make sure we are on the inbox.
      if (location.hash && location.hash.indexOf('#inbox') !== 0) {
        try {
          location.hash = '#inbox';
        } catch (_) {
          /* ignore */
        }
        await sleep(1500);
      }

      const dismissed = dismissPopups();
      if (dismissed > 0) {
        postProgress('dismiss-popup', {
          message: `${dismissed} popup(s) đã đóng.`,
        });
      }
      await sleep(1500);

      let processed = 0;
      for (let i = 0; i < maxItems; i++) {
        if (state.stopRequested) {
          postProgress('stopped', { index: processed, total: maxItems });
          return;
        }

        dismissPopups();

        const row = findUnreadRow();
        if (!row) {
          postProgress('no-unread', { index: processed, total: processed });
          break;
        }
        const subject = rowSubject(row);
        postProgress('opening', {
          index: processed + 1,
          total: maxItems,
          subject,
        });

        try {
          row.click();
        } catch (_) {
          postProgress('error', {
            index: processed + 1,
            message: 'click failed',
          });
          await sleep(500);
          continue;
        }

        await sleep(jitter(openMs, humanLike));
        if (state.stopRequested) {
          postProgress('stopped', { index: processed, total: maxItems });
          return;
        }

        try {
          window.scrollBy({
            top: 400 + Math.floor(Math.random() * 300),
            behavior: 'smooth',
          });
        } catch (_) {
          /* ignore */
        }
        postProgress('reading', {
          index: processed + 1,
          total: maxItems,
          subject,
        });

        await sleep(jitter(readMs, humanLike));
        if (state.stopRequested) {
          postProgress('stopped', { index: processed, total: maxItems });
          return;
        }

        await navigateBackToInbox();
        await waitForInbox(5000);
        await sleep(jitter(800, humanLike));

        processed++;
        postProgress('done-item', {
          index: processed,
          total: maxItems,
          subject,
        });
      }

      postProgress('finished', { total: processed });
    } catch (e) {
      postProgress('error', { message: (e && e.message) || String(e) });
    } finally {
      state.running = false;
      // Clear one-shot autoStart so reloading Gmail manually doesn't re-trigger.
      try {
        chrome.storage.local.set({ autoStart: false });
      } catch (_) {
        /* ignore */
      }
    }
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  // ---------- Message bus ----------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string') return false;
    if (msg.type === 'gar:start') {
      const settings = msg.settings || {};
      loadSettings().then((stored) => {
        startAutomation(Object.assign({}, stored, settings));
      });
      sendResponse({ ok: true });
      return false;
    }
    if (msg.type === 'gar:stop') {
      requestStop();
      sendResponse({ ok: true });
      return false;
    }
    if (msg.type === 'gar:status') {
      sendResponse({
        ok: true,
        status: {
          running: state.running,
          processed: state.processed,
          maxItems: state.maxItems,
          subject: state.subject,
          lastPhase: state.lastPhase,
          lastMessage: state.lastMessage,
        },
      });
      return false;
    }
    return false;
  });

  // ---------- Bootstrap ----------

  function init() {
    buildOverlay();
    setOverlay('idle', 'Idle', 'Sẵn sàng. Bấm Start để mở từng email chưa đọc.');

    // Honor one-shot autoStart from popup. Only respect it if it was set in
    // the last 30 seconds so navigating away and back later doesn't re-trigger.
    chrome.storage.local.get(['autoStart', 'autoStartTs'], (vals) => {
      if (vals && vals.autoStart && vals.autoStartTs) {
        const age = Date.now() - vals.autoStartTs;
        if (age < 30 * 1000) {
          chrome.storage.local.set({ autoStart: false });
          loadSettings().then((settings) => startAutomation(settings));
        }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
