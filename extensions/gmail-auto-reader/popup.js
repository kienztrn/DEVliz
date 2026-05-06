/* global chrome */
(() => {
  'use strict';

  const GMAIL_URL = 'https://mail.google.com/mail/u/0/#inbox';

  const els = {
    status: document.getElementById('status-pill'),
    statusDetail: document.getElementById('status-detail'),
    readSeconds: document.getElementById('readSeconds'),
    maxItems: document.getElementById('maxItems'),
    humanLike: document.getElementById('humanLike'),
    startBtn: document.getElementById('startBtn'),
    stopBtn: document.getElementById('stopBtn'),
  };

  const STORAGE_KEYS = ['readSeconds', 'maxItems', 'humanLike'];

  function setStatus(state, detail) {
    els.status.classList.remove(
      'pill-idle',
      'pill-running',
      'pill-error',
      'pill-done',
    );
    const map = {
      idle: ['pill-idle', 'Idle'],
      running: ['pill-running', 'Running'],
      done: ['pill-done', 'Done'],
      error: ['pill-error', 'Error'],
      stopped: ['pill-idle', 'Stopped'],
    };
    const [cls, label] = map[state] || map.idle;
    els.status.classList.add(cls);
    els.status.textContent = label;
    if (detail) els.statusDetail.textContent = detail;
  }

  function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(STORAGE_KEYS, (vals) => {
        if (typeof vals.readSeconds === 'number')
          els.readSeconds.value = vals.readSeconds;
        if (typeof vals.maxItems === 'number')
          els.maxItems.value = vals.maxItems;
        if (typeof vals.humanLike === 'boolean')
          els.humanLike.checked = vals.humanLike;
        resolve();
      });
    });
  }

  function saveSettings() {
    const payload = {
      readSeconds: clampInt(els.readSeconds.value, 1, 120, 5),
      maxItems: clampInt(els.maxItems.value, 1, 200, 50),
      humanLike: !!els.humanLike.checked,
    };
    return new Promise((resolve) => {
      chrome.storage.sync.set(payload, () => resolve(payload));
    });
  }

  function clampInt(value, min, max, fallback) {
    const n = parseInt(value, 10);
    if (Number.isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  async function findGmailTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ url: 'https://mail.google.com/*' }, (tabs) => {
        resolve(tabs && tabs.length ? tabs[0] : null);
      });
    });
  }

  async function openOrFocusGmail() {
    const existing = await findGmailTab();
    if (existing) {
      await new Promise((resolve) => {
        chrome.tabs.update(existing.id, { active: true }, () => resolve());
      });
      if (existing.windowId !== undefined) {
        try {
          chrome.windows.update(existing.windowId, { focused: true });
        } catch (_) {
          /* ignore */
        }
      }
      return existing;
    }
    return new Promise((resolve) => {
      chrome.tabs.create({ url: GMAIL_URL, active: true }, (tab) => {
        resolve(tab);
      });
    });
  }

  function sendToTab(tabId, message) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { ok: true });
      });
    });
  }

  async function start() {
    els.startBtn.disabled = true;
    setStatus('running', 'Đang mở Gmail…');
    const settings = await saveSettings();

    // Set autoStart so when content script attaches it will start running.
    await new Promise((resolve) => {
      chrome.storage.local.set({ autoStart: true, autoStartTs: Date.now() }, () =>
        resolve(),
      );
    });

    const tab = await openOrFocusGmail();
    if (!tab || !tab.id) {
      setStatus('error', 'Không mở được tab Gmail.');
      els.startBtn.disabled = false;
      return;
    }

    // Try to send "start" — content script may not be ready yet on a fresh tab.
    // Retry a few times.
    let resp = null;
    for (let i = 0; i < 10; i++) {
      resp = await sendToTab(tab.id, { type: 'gar:start', settings });
      if (resp && resp.ok) break;
      await new Promise((r) => setTimeout(r, 600));
    }

    if (resp && resp.ok) {
      setStatus('running', 'Đã bắt đầu trong Gmail.');
    } else {
      // Content script will read autoStart from storage when it loads.
      setStatus('running', 'Sẽ tự bắt đầu khi Gmail load xong.');
    }
    els.startBtn.disabled = false;
  }

  async function stop() {
    await new Promise((resolve) => {
      chrome.storage.local.set({ autoStart: false }, () => resolve());
    });
    const tab = await findGmailTab();
    if (!tab) {
      setStatus('stopped', 'Không thấy tab Gmail.');
      return;
    }
    const resp = await sendToTab(tab.id, { type: 'gar:stop' });
    if (resp && resp.ok) {
      setStatus('stopped', 'Đã gửi lệnh dừng.');
    } else {
      setStatus('stopped', 'Đã đặt cờ dừng.');
    }
  }

  async function refreshStatusFromTab() {
    const tab = await findGmailTab();
    if (!tab) {
      setStatus('idle', 'Sẵn sàng. Bấm Start để bắt đầu.');
      return;
    }
    const resp = await sendToTab(tab.id, { type: 'gar:status' });
    if (resp && resp.ok && resp.status) {
      const s = resp.status;
      if (s.running) {
        setStatus(
          'running',
          `Đang đọc email ${s.processed + 1}/${s.maxItems}` +
            (s.subject ? ` — ${s.subject}` : ''),
        );
      } else if (s.lastPhase === 'finished') {
        setStatus('done', `Xong. Đã đọc ${s.processed} email.`);
      } else if (s.lastPhase === 'error') {
        setStatus('error', s.lastMessage || 'Có lỗi.');
      } else if (s.lastPhase === 'no-unread') {
        setStatus('done', 'Không có email chưa đọc.');
      } else {
        setStatus('idle', 'Sẵn sàng trong Gmail.');
      }
    } else {
      setStatus('idle', 'Sẵn sàng. Bấm Start để bắt đầu.');
    }
  }

  els.startBtn.addEventListener('click', start);
  els.stopBtn.addEventListener('click', stop);
  ['change', 'input'].forEach((ev) => {
    els.readSeconds.addEventListener(ev, () => saveSettings());
    els.maxItems.addEventListener(ev, () => saveSettings());
    els.humanLike.addEventListener(ev, () => saveSettings());
  });

  // Listen for status pushes from content script.
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'gar:progress') return;
    const p = msg.progress || {};
    if (p.phase === 'started') {
      setStatus('running', `Bắt đầu — tối đa ${p.total} email.`);
    } else if (p.phase === 'opening' || p.phase === 'reading') {
      setStatus(
        'running',
        `${p.phase === 'opening' ? 'Đang mở' : 'Đang đọc'} ${p.index}/${p.total}` +
          (p.subject ? ` — ${p.subject}` : ''),
      );
    } else if (p.phase === 'done-item') {
      setStatus('running', `Đọc xong ${p.index}/${p.total}.`);
    } else if (p.phase === 'finished') {
      setStatus('done', `Hoàn tất. Đã đọc ${p.total} email.`);
    } else if (p.phase === 'no-unread') {
      setStatus('done', 'Không còn email chưa đọc.');
    } else if (p.phase === 'error') {
      setStatus('error', p.message || 'Có lỗi.');
    } else if (p.phase === 'stopped') {
      setStatus('stopped', `Đã dừng ở ${p.index || 0}/${p.total || 0}.`);
    }
  });

  loadSettings().then(refreshStatusFromTab);
})();
