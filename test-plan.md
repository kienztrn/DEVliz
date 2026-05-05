# Multi Browser Manager — MVP Test Plan

## What changed (PR #1)
First-version MVP of an antidetect-style desktop app: Electron + React renderer with sidebar nav (5 pages), per-profile fingerprint spoofing extension, SQLite storage, and chromium launcher. Plus a follow-up commit (`d80836a`) that bundles `nanoid` into the main process to fix `ERR_REQUIRE_ESM` on boot.

## Environment
- Linux desktop, X display `:0`
- App: `npm run dev` (Electron 32 main + Vite renderer)
- Chromium for launcher: `/opt/.devin/playwright_browsers/chromium-1097/chrome-linux/chrome` (set in app Settings; chromium-finder only checks `/usr/bin/...` paths)

## Primary flow (one continuous recording)

### Test 1 — App boots without ERR_REQUIRE_ESM (regression for `d80836a`)
- **Steps**: Start `npm run dev`. Observe Electron window appears.
- **Pass criteria**: Window renders within 30s. Title bar reads "Multi Browser Manager". Sidebar shows 5 items: `Tổng quan`, `Profile`, `Tạo hàng loạt`, `Proxy`, `Cài đặt`. Stat cards on dashboard show: Profile = `0`, Proxy = `0`, Đang chạy = `0`.
- **Fail criteria**: Black window, white "JavaScript error" overlay, missing sidebar, or `ERR_REQUIRE_ESM` text visible. Without `d80836a`, the app would show the JavaScript error overlay (already verified in earlier session).
- **Adversarial check**: Without the fix, the app crashed at boot with the JavaScript error dialog — same screenshot would NOT appear. So a successful render is a strong signal.
- **Code refs**: `src/main/index.ts` (createWindow), `src/main/repositories/profile-repo.ts:1` (`import { nanoid }`), `electron.vite.config.ts:7,23` (the fix).

### Test 2 — Create single profile with randomized fingerprint
- **Steps**:
  1. Click `+ Tạo profile` quick action on Dashboard.
  2. Modal opens; type name "Test One" in `Tên` field.
  3. In Fingerprint section, change `Hệ điều hành` dropdown to `mac` (this triggers re-randomize).
  4. Click `Lưu`.
- **Pass criteria**:
  - Toast `Saved` appears.
  - Modal closes; Dashboard `Profile` stat card increments to `1`.
  - Navigate to Profile page → table shows 1 row "Test One" with a `mac` indicator and a User-Agent string starting with `Mozilla/5.0 (Macintosh;`.
- **Fail criteria**: No toast, modal stays open, stat stays at 0, or row missing, or UA shows `Windows`.
- **Adversarial check**: Picking `mac` and saving must produce a Mac UA — if the fingerprint random is broken or the OS dropdown does not propagate, the UA will not begin with `Macintosh;`.
- **Code refs**: `src/renderer/src/components/ProfileForm.tsx:34-37` (randomize on OS change), `src/shared/fingerprint-pool.ts` (UA pools).

### Test 3 — Bulk create 5 profiles with mixed OS + locale
- **Steps**:
  1. Sidebar → `Tạo hàng loạt`.
  2. Set `Tạo bao nhiêu profile?` = `5`. Set `Tên gốc` = `Bulk`.
  3. OS mix: keep `win` and `mac` checked, uncheck others.
  4. Locale pool: keep at least `en-US` and `vi-VN` selected.
  5. Click `Tạo 5 profile`.
- **Pass criteria**:
  - Toast `Đã tạo 5 profile` appears.
  - Profile page → 6 total rows (1 from Test 2 + 5 from bulk). New rows named `Bulk-001` … `Bulk-005`.
  - Among the 5 bulk rows, at least 2 different OS labels appear (i.e., not all 5 same OS).
- **Fail criteria**: Fewer than 5 rows added, all rows have same OS, names don't follow `Bulk-NNN` pattern.
- **Adversarial check**: A broken bulk create that uses only the default OS would show all 5 rows as the same OS — pass requires actual mix.
- **Code refs**: `src/renderer/src/pages/BulkCreate.tsx`, `src/main/repositories/profile-repo.ts` (bulk create handler).

### Test 4 — Add a proxy with manual entry
- **Steps**:
  1. Sidebar → `Proxy`.
  2. Click `Proxy mới`.
  3. Type: `http`, Host: `1.2.3.4`, Cổng: `8080`. Leave user/pass empty. Name: `Test proxy`.
  4. Click `Lưu`.
- **Pass criteria**:
  - Toast `Saved`.
  - Proxy table shows 1 row with `1.2.3.4:8080` and type `http`.
  - Dashboard `Proxy` stat card shows `1`.
- **Fail criteria**: Row missing, stat unchanged, validation rejects valid input.
- **Code refs**: `src/main/repositories/proxy-repo.ts`, `src/renderer/src/pages/Proxies.tsx`.

### Test 5 — Launch a profile (verify Chromium spawns + extension built)
- **Steps**:
  1. Sidebar → `Cài đặt`. Set `Đường dẫn Chromium...` to `/opt/.devin/playwright_browsers/chromium-1097/chrome-linux/chrome`. Click `Lưu`.
  2. Sidebar → `Profile`. Click the play (`▶`) button on the "Test One" row.
- **Pass criteria**:
  - A new Chromium window opens within 10s.
  - Run `pgrep -af chrome-linux/chrome` in shell → returns at least one row, and the command line contains `--user-data-dir=` + the specific profile id, plus `--load-extension=`.
  - Dashboard `Đang chạy` stat card shows `1`.
- **Fail criteria**: No new window, no chrome process spawned, error toast.
- **Adversarial check**: A broken launcher that doesn't pass `--user-data-dir` or `--load-extension` would spawn a generic Chromium without isolation. The shell pgrep verifies the actual flags.
- **Code refs**: `src/main/services/profile-launcher.ts`, `src/main/services/extension-builder.ts`, `src/main/services/chromium-finder.ts:21-22`.

### Test 6 — Switch language VI → EN
- **Steps**:
  1. Sidebar → `Cài đặt` (Vietnamese).
  2. `Ngôn ngữ` dropdown → select `English`. Click `Lưu`.
- **Pass criteria**:
  - Sidebar text changes immediately to `Dashboard` / `Profiles` / `Bulk Create` / `Proxies` / `Settings`.
  - Page heading changes from `Cài đặt` to `Settings`.
  - Save button text becomes `Save`.
- **Fail criteria**: Sidebar stays in Vietnamese, mixed language, or only some labels translate.
- **Adversarial check**: i18n done as static strings (not via `t()`) would not change. Full sidebar swap proves runtime i18n.
- **Code refs**: `src/renderer/src/pages/Settings.tsx:48-50`, `src/renderer/src/i18n.ts:244-249`, `src/renderer/src/components/Layout.tsx`.

## Out of scope (will NOT test in this run)
- Running `browserleaks.com` against spoofed fingerprint (verifying actual canvas/WebGL noise visibility) — requires open internet from inside the spawned Chromium and is a tertiary check on a feature whose plumbing is verified by Test 5. The user will validate this on Windows.
- Real proxy authentication / IP geolocation — needs a real third-party proxy. Will be tested by user with their proxy credentials on Windows.
- NSIS installer build — Windows-only, cannot run on Linux VM.

## Known constraints / caveats
- `chromium-finder.ts` does not include the Playwright Chromium path. On Linux Devin VM the test sets it manually in Settings. On Windows / macOS where Chrome is installed normally, auto-detect should work; this is documented in the report as a recommended improvement (add Playwright Chromium path).
- GitHub Actions has not been enabled by user; CI status currently shows 0/0. Code was verified locally with `npm run lint` (0 errors) + `npm run typecheck` + `npm run build` (success).
