# Multi Browser Manager — MVP Test Report

**PR**: [#1 — feat: Multi Browser Manager MVP](https://github.com/kienztrn/DEVliz/pull/1)
**Session**: https://app.devin.ai/sessions/4070c30b8b69494995cb20c311e185f7
**Tested on**: Linux (Devin VM), Electron 32, Chromium 1097 (Playwright build)
**Recording**: [video.mp4](https://app.devin.ai/attachments/158ab083-9ec6-495e-b151-f95adacd7c10/rec-47e643f8-cd03-4e81-b91a-ebb773477ca2-edited.mp4)

## TL;DR
Found and fixed one boot-blocking bug (`ERR_REQUIRE_ESM` from `nanoid` v5 ESM-only) before testing — fix in commit `d80836a`. After the fix, all 6 primary tests **passed**. The launcher correctly spawns Chromium with per-profile `--user-data-dir` + `--load-extension` + spoofed UA / locale / window-size; i18n switches the entire UI live; bulk create produces a real OS mix.

## Escalations
- **Caveat 1 — chromium-finder doesn't include Playwright Chromium path.** Auto-detect (`src/main/services/chromium-finder.ts:21-22`) checks `/usr/bin/google-chrome` etc., which don't exist on this Linux VM. I worked around by setting the path manually in Settings. On Windows / macOS where Chrome is installed normally this should be a non-issue, but consider also probing `/opt/.devin/playwright_browsers/...` for dev environments.
- **Caveat 2 — WebGL vendor not OS-aligned.** When OS = `mac`, the randomized fingerprint shows `WebGL Vendor: Google Inc. (Intel)` + `Renderer: ANGLE (Intel(R) UHD Graphics 630 Direct3D)` — that Direct3D string is Windows-only and would be inconsistent for a Mac fingerprint. UA / locale / timezone / screen are fine; WebGL pool just isn't keyed by OS yet. Easy follow-up.
- **CI not running** — GitHub Actions is still disabled on the new repo. Local `npm run lint` (0 errors), `npm run typecheck`, `npm run build` all pass. Enable Actions in repo settings to get CI green.
- **Did NOT test** with a real third-party proxy (no creds available on Devin VM) and did not visit `browserleaks.com` from inside the spawned Chromium. The launcher plumbing is verified by the process-flag inspection below; user should validate IP/canvas changes with their own proxy on Windows.

## Test results

| # | Test | Result |
|---|---|---|
| 1 | App boots without `ERR_REQUIRE_ESM` (regression for `d80836a`) | passed |
| 2 | Create single profile with mac OS → UA starts with `Mozilla/5.0 (Macintosh;` | passed |
| 3 | Bulk-create 5 profiles with OS mix `[win, mac]` → 5 rows, 3 win + 2 mac | passed |
| 4 | Add proxy `1.2.3.4:8080` http → row appears | passed |
| 5 | Launch profile → Chromium spawns with `--user-data-dir` + `--load-extension` + Mac UA | passed |
| 6 | Switch language vi → en → entire UI swaps live | passed |

## Evidence

### Test 1 — App boots
| App boots cleanly |
|---|
| ![Boot](https://app.devin.ai/attachments/3459ac29-5d00-4a88-a725-e1b0ea036322/screenshot_025bd9583f2b4c1a9869353ef4e48613.png) |
| Sidebar: Tổng quan / Profile / Tạo hàng loạt / Proxy / Cài đặt; stats 0/0/0; no error overlay. |

### Test 2 — Create profile (mac UA)
| Profile form (mac OS picked → UA starts with `Macintosh;`) | Profile saved in list (mac) |
|---|---|
| ![Form](https://app.devin.ai/attachments/6155ada1-81ca-4c92-ae66-e7e7c1f065b2/screenshot_674e2c14c311483d9c4ed5b2a49c7eb1.png) | ![List](https://app.devin.ai/attachments/1660319e-43ca-4155-8c85-bf04062af459/screenshot_b678778d696842168d41796b0ad1ea07.png) |

### Test 3 — Bulk create 5 profiles
| Profile list with 5 bulk + 1 single |
|---|
| ![Bulk](https://app.devin.ai/attachments/54328eab-ae13-4af4-ac83-4c50de2aca56/screenshot_f283fc73b2304eefa463db6a856bfe48.png) |
| Bulk-001 (win), Bulk-002 (mac), Bulk-003 (win), Bulk-004 (mac), Bulk-005 (win) — real OS mix. |

### Test 4 — Add proxy
| Proxy listed |
|---|
| ![Proxy](https://app.devin.ai/attachments/f0d76941-2c0f-438e-a4aa-7e8165ac2311/screenshot_a176a99b7e1e46919250d8ee6e13b5fa.png) |

### Test 5 — Launch (most adversarial check)
| Spawned Chromium window (about:blank) |
|---|
| ![Spawned](https://app.devin.ai/attachments/e53653fd-68a2-4593-a3a7-b096b57f57bb/screenshot_2df58210ba1d4e888ba2f27f1e212dbe.png) |

`pgrep -af "chrome-linux/chrome"` immediately after click:

```
13811 /opt/.devin/playwright_browsers/chromium-1097/chrome-linux/chrome
  --user-data-dir=/home/ubuntu/.config/multi-browser-manager/profiles/kuGzU3ovsRBa/user-data
  --load-extension=/home/ubuntu/.config/multi-browser-manager/profiles/kuGzU3ovsRBa/extension
  --disable-extensions-except=/home/ubuntu/.config/multi-browser-manager/profiles/kuGzU3ovsRBa/extension
  --no-first-run --no-default-browser-check
  --disable-features=Translate,InterestFeedContentSuggestions,PrivacySandboxSettings4,OptimizationHints
  --user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36
  --lang=en-US --accept-lang=en-US,en;q=0.9,en;q=0.8
  --window-size=1536,864
  --force-device-scale-factor=1.25
  --force-webrtc-ip-handling-policy=disable_non_proxied_udp
  about:blank
```

All launcher flags from `profile-launcher.ts` are present, profile id matches the saved profile, MV3 extension dir is loaded — this would NOT happen if the launcher / extension-builder were broken.

### Test 6 — i18n vi → en (live)
| 🔴 Vietnamese (Cài đặt / Lưu) | 🟢 English (Settings / Save) |
|---|---|
| ![VI](https://app.devin.ai/attachments/0bcb0e3c-c6b7-458e-a393-afa655035b26/screenshot_8149cee47a484e888a2a9ab7611a4d4b.png) | ![EN](https://app.devin.ai/attachments/73cfdb37-089d-4041-836d-a1264fd0bbe6/screenshot_783653370d37410da07192aa06cf0d72.png) |
| Sidebar fully Vietnamese, page title `Cài đặt`, button `Lưu`. | Sidebar fully English, page title `Settings`, button `Save`, dashboard counts persist (Profiles=6, Proxies=1). |
