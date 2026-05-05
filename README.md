# Multi Browser Manager

> ⚠️ **Use responsibly.** This is a tool for managing multiple legitimate browser sessions and isolating them via proxies. Do **not** use it to violate the terms of service of any website, commit fraud, or evade lawful enforcement.

A self-hosted desktop app (Electron + React + TypeScript) for managing many isolated browser profiles, each with its own proxy and fingerprint, similar in spirit to apps like HideMyAcc, GoLogin, AdsPower, Multilogin, and Dolphin Anty.

Built and maintained by [@kienztrn](https://github.com/kienztrn).

---

## Features (MVP)

### Profiles
- ✅ Create a single profile with custom fingerprint, proxy, group, start URL, notes
- ✅ **Bulk create** N profiles at once with template + OS / locale / timezone pools
- ✅ List, search, edit, clone, delete profiles
- ✅ Multi-select to launch / delete many at once

### Proxy
- ✅ Manage HTTP / HTTPS / SOCKS5 proxies (with optional username/password)
- ✅ Test a proxy (real IP, country, city, latency via ip-api.com)
- ✅ Bulk import proxies from text, accepting common formats:
  - `host:port`
  - `host:port:user:pass`
  - `scheme://user:pass@host:port`
  - `user:pass@host:port`

### Browser launcher
Each profile launches a separate Chromium-family browser on the host. The launcher auto-detects browsers in this priority order: **Brave → Vivaldi → ungoogled-chromium → Edge → Opera → Yandex → Chrome** (Chrome last so privacy-focused forks win when present). You can override the binary path in **Settings → Browser binary**. The Settings page shows which browser was detected and at what path. Each profile launches the chosen browser with:
- Dedicated `--user-data-dir` so cookies, local storage, history are fully isolated
- `--proxy-server=` flag for the assigned proxy
- Internal MV3 extension for proxy authentication and fingerprint spoofing
- WebRTC IP handling policy set to `disable_non_proxied_udp` (prevents real IP leaks)

### Fingerprint spoofing
The internal extension patches:
- `navigator.userAgent`, `platform`, `language`, `languages`, `hardwareConcurrency`, `deviceMemory`
- `screen.{width,height,availWidth,availHeight,colorDepth,pixelDepth}`, `devicePixelRatio`
- `Intl.DateTimeFormat` / `Date.prototype.getTimezoneOffset` (timezone)
- `WebGLRenderingContext.getParameter` (UNMASKED_VENDOR_WEBGL, UNMASKED_RENDERER_WEBGL)
- Canvas (`getImageData` + `toDataURL` noise)
- AudioContext (analyser frequency data noise)
- WebRTC (disabled mode)
- Sets `User-Agent` and `Accept-Language` headers via `declarativeNetRequest`

### UI
- Sidebar navigation (Dashboard / Profiles / Bulk Create / Proxies / Settings)
- Dark slate theme with brand blue accents (Tailwind CSS)
- Modals for create/edit/import flows
- i18n: **Vietnamese + English**, switchable in Settings
- Toast notifications

### Automation
- ✅ **Automation page** with "Run automation" button + confirm modal ("Bạn muốn chạy chứ?")
- ✅ **Gmail rotate-unread** workflow per profile: opens `mail.google.com`, dismisses popups, clicks each unread email, scrolls, waits 5–7s, then returns to inbox, on a 2–3s/5–7s human-like cadence
- Profiles that are not running are launched directly with `mail.google.com`. Profiles already running need a Gmail tab open (the in-extension content script polls a localhost command queue every 5s).
- Live log shows `queued → launched → started → opening → reading → done-item → finished` events.

### Storage
Local SQLite (`better-sqlite3`) at `userData/mbm.db`:
- `profiles` — profile records with serialized fingerprint JSON
- `proxies` — proxy records with last test info
- `settings` — key/value app settings

---

## Architecture

```
src/
├── main/                   # Electron main process (Node)
│   ├── index.ts            # window/app lifecycle
│   ├── db.ts               # SQLite + migrations
│   ├── ipc-handlers.ts     # all ipcMain.handle registrations
│   ├── repositories/       # CRUD layer for profiles/proxies/settings
│   └── services/
│       ├── chromium-finder.ts      # locate installed Chrome/Edge/Brave
│       ├── extension-builder.ts    # generate per-profile MV3 extension
│       ├── profile-launcher.ts     # spawn/stop browser processes
│       ├── proxy-tester.ts         # test proxy via electron net + ip-api
│       └── proxy-importer.ts       # parse text proxy lists
├── preload/index.ts        # contextBridge -> window.mbm.*
├── shared/                 # types + IPC channel constants + fingerprint pool
└── renderer/               # React UI (Vite)
    ├── index.html
    └── src/
        ├── App.tsx
        ├── i18n.ts
        ├── store.ts        # zustand store
        ├── components/     # Layout, Modal, ProfileForm
        └── pages/          # Dashboard, Profiles, Proxies, BulkCreate, Settings
```

## Requirements

- Node.js 20+ and npm 10+
- A Chromium-family browser installed: Google Chrome / Microsoft Edge / Brave / Chromium
- Windows, macOS, or Linux

## Development

```bash
npm install
npm run dev          # start in dev mode with HMR
npm run typecheck    # tsc --noEmit on both projects
npm run lint
npm run build        # bundles main + preload + renderer into ./out
```

## Building installers

```bash
npm run build:win    # Windows NSIS installer in ./release
npm run build:mac    # macOS DMG
npm run build:linux  # Linux AppImage
```

> **Note for Windows users:** `better-sqlite3` is a native module. After `npm install`, electron-builder runs `install-app-deps` to recompile it for the bundled Electron version. If it fails, install build tools: `npm install --global windows-build-tools` (PowerShell as Admin) or install Visual Studio Build Tools with the "Desktop development with C++" workload.

## How it works

When you click **Launch** on a profile:

1. The launcher resolves the Chromium binary (auto-detect or from Settings).
2. It writes a fresh per-profile MV3 extension into `userData/profiles/<id>/extension/` containing:
   - `manifest.json` (declares webRequest + declarativeNetRequest + content_scripts world=MAIN)
   - `rules.json` (header rewrite for User-Agent and Accept-Language)
   - `background.js` (`webRequest.onAuthRequired` → injects proxy basic auth credentials)
   - `content.js` (the JS that patches navigator, screen, Intl, WebGL, Canvas, Audio, WebRTC)
3. It spawns Chromium with:
   ```
   --user-data-dir=<profile-dir>
   --load-extension=<extension-dir>
   --disable-extensions-except=<extension-dir>
   --proxy-server=<scheme>://<host>:<port>
   --user-agent=<UA>
   --window-size=<w,h>
   --force-device-scale-factor=<dpr>
   --force-webrtc-ip-handling-policy=disable_non_proxied_udp
   ```
4. The child process is tracked; on exit, the profile flips back to `idle`.

## Limitations

- Fingerprint spoofing here is **practical** — it bypasses common detection but is not bulletproof against advanced services that compare hundreds of signals or run TLS fingerprinting (JA3/JA4) at the network level. For that, you need a forked Chromium build (which Multilogin / Octo etc. do).
- The internal extension is loaded via `--load-extension`, which Chrome warns about on launch. This is normal and expected.
- WebRTC modes: only `disabled` and `proxy-only` are wired into Chromium flags; `real` leaves the browser default.
- Concurrent launches insert a 250ms stagger to avoid stampeding the OS.

## Roadmap

- [ ] Cookie import/export (Netscape + JSON)
- [ ] Playwright-based automation runner per profile
- [ ] Tag system + advanced filters
- [ ] Optional cloud sync of profiles
- [ ] More fingerprint vectors (fonts, plugins, battery, gamepad)

## License

MIT — see `LICENSE` (TODO).
