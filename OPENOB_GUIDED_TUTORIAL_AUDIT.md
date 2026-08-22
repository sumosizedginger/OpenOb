# OPENOB_GUIDED_TUTORIAL_AUDIT

**Guided Tutorial / Learn Center Product Audit (committed main `18c3c74`)**

- **Audited HEAD:** `18c3c74fc2ac53e53f63b7de1735e8cf0b0b82a6` — "feat(onboarding): add guided OpenOb tutorial and learn center"
- **Auditor:** DeepSeek (adversarial second model) — AUDIT ONLY, no production code modified
- **Method:** code review (engine/chapters/targets/storage) + real **packaged** `win-unpacked/OpenOb.exe` runtime runs (fresh profiles, restarts, keyboard-only, 1366×768, vault hashing) + full test suites
- **Scope:** onboarding only; not a broad architecture audit

---

## 0. VERDICT

# ⛔ STOP — not ready for dogfood yet

**Two exact blockers:**

1. **B-1 (P2, release gate): the onboarding Welcome modal breaks 3 pre-existing AI e2e tests → the e2e suite and `verify:full` are RED on committed main.** The `.welcome-modal-overlay` intercepts pointer events in fresh sessions, so `tests/e2e/ai-gateway.spec.ts` ("Gateway AI Secret Protection & Zero-Browser-Storage Guarantee", "Standalone Mode Cloud BYOK Isolation Notice", "Truthful Model Discovery & Error State in UI") time out at 30s clicking "Connect to Gateway" (error: `welcome-modal-overlay intercepts pointer events`). Reproduced 3/3 in isolation.
2. **B-2 (P2, accuracy §17): the tutorial and the app's own Keyboard Shortcuts cheat sheet teach 5 things that are not true of the current app:**
   - `Ctrl+\` described as **"Toggle left file sidebar"** — the binding actually toggles **Split View** (`App.tsx:242`); sidebar toggle is **Ctrl+B**.
   - `Ctrl+N` — **"Create new note"** — **no `Ctrl+N` key binding exists anywhere** (the New Note button's `title="New Note (Ctrl+N)"` is itself a pre-existing UI inconsistency the tutorial inherited).
   - `Ctrl+Shift+P` — **"Command Palette"** — **no such binding**; only `Ctrl+P` exists (Quick Open / palette).
   - `F2` — **"Rename active or selected note"** — **no F2 binding**; rename is a per-item icon button in the tree.
   - **"Delete with confirmation"** (`chapters.ts:162`) — `deletePath` (`useVault.ts:1417`) deletes **without any confirmation dialog**.

   Fix is small either way (bind the missing keys / correct the copy). The shortcut claims appear in both `KeyboardShortcutsModal.tsx` and `chapters.ts`.

---

## 1. WHAT PASSES (verified by execution)

| §   | Check                                                                                                                                                                                                                        | Result                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 1   | Fresh profile, packaged exe: workspace ready → Welcome appears (brand mark ✓, "Welcome to OpenOb" ✓, Start Tour ✓, Skip ✓); no tutorial before readiness                                                                     | ✅                               |
| 2   | **Skip persists**: Skip → `desktop-config.json` gains `onboardingState:{version:1, dismissedFirstRun:true}` → restart (new ephemeral gateway port) → **no welcome**; More → **Learn OpenOb** reachable                       | ✅                               |
| 3   | Replay: Quick Tour re-runnable from Learn Center; completion (`quickTourCompleted`) does not disable learning                                                                                                                | ✅                               |
| 4   | **Electron persistence**: onboarding state lives in `userData/desktop-config.json` (not browser origin/localStorage) → survives ephemeral port changes                                                                       | ✅                               |
| 5   | **Vault integrity (CRITICAL)**: sha256 over every file in a test vault **before == after** a keyboard-only 5-step Quick Tour run — **byte-identical** (`MIDTOUR_IDENTICAL=true`); full flow also produced `VAULT_CHANGED=[]` | ✅                               |
| 6   | **Dirty buffer survives** a chapter run started mid-edit (text still in the editor; no reload/discard)                                                                                                                       | ✅                               |
| 7   | Read-only workspace: tutorial runs (integrity test `read-only workspace` ✓); no write-scope dependency                                                                                                                       | ✅                               |
| 8   | AI chapter with no configuration: teaches the UI, makes no model/API calls, no crash (integrity test ✓)                                                                                                                      | ✅                               |
| 9   | Quick Tour covers all 10 required topics (vault, sidebar, editor, split/preview, search, inspector, views, graph, AI, plugins) in 13 steps, each explaining _why_                                                            | ✅                               |
| 10  | Density: step copy is 1–3 sentences; no walls of text                                                                                                                                                                        | ✅                               |
| 11  | Targeting: `data-tour` IDs (TOUR_TARGETS), not nth-child chains                                                                                                                                                              | ✅                               |
| 12  | Missing target: centered fallback card, escapable, no frozen overlay (code + tests)                                                                                                                                          | ✅                               |
| 13  | Keyboard: ArrowRight/ArrowLeft next/back, Escape skip/close, Enter; no global Enter steal; focus restored                                                                                                                    | ✅                               |
| 15  | **1366×768**: tour card fully onscreen (probe: left 16, right 376, top 43, bottom 256 in 1366×768)                                                                                                                           | ✅                               |
| 16  | Learn Center: 11 individual chapters (no sequential lock), completion/replay status                                                                                                                                          | ✅                               |
| 18  | Views wording: "Markdown remains truth / properties are fields / views present results", explicitly "no proprietary database lock-in"                                                                                        | ✅                               |
| 19  | AI truth: "AI proposes edits—it never silently overwrites your work", visual diff preview, human review/accept before disk                                                                                                   | ✅                               |
| 20  | Plugin truth: "explicit capability scopes (read, write, notify); cannot access arbitrary network or unauthorized files" — correctly does **not** claim sandboxing                                                            | ✅                               |
| 21  | Agents chapter: no session credentials/tokens/secrets exposed; the only token mention is the conceptual OCC "version token" in the data-safety chapter                                                                       | ✅                               |
| 22  | Conflict education: plain language (Reload external / Keep Your Draft / copy), no OCC implementation jargon                                                                                                                  | ✅                               |
| 24  | Performance: no constant DOM scanning (event/ResizeObserver-driven); no typing/scroll jank observed                                                                                                                          | ✅                               |
| 25  | **Packaged Electron**: full first-run/tour/skip/restart/replay verified in `win-unpacked/OpenOb.exe` (brand assets + tooltips fine)                                                                                          | ✅                               |
| 26  | Docs: `docs/ONBOARDING_ARCHITECTURE.md` + `docs/LEARN_OPENOB.md` mirror the real feature set                                                                                                                                 | ✅                               |
| 27  | Gate                                                                                                                                                                                                                         | ❌ **B-1** (e2e red) — see below |

**Gate detail (§27):** `npm ci` ✅ · format ✅ (after removing my temp spec) · lint ✅ · typecheck ✅ · unit **441/441 (69 files)** ✅ · build ✅ · test:desktop ✅ · e2e **37 passed / 3 failed** (the 3 AI tests above) ❌ · pack ✅ · tracked tree clean (0) ✅.

---

## 2. P3 NOTES (non-blocking)

- `qt-graph` targets the Global Graph button which lives inside the **collapsed More menu**; no prepare action opens that menu, so the step renders as a centered card without a spotlight (graceful fallback, but the highlight is lost). Consider a `prepareAction` that opens the More menu.
- Escaping the Quick Tour leaves first-run **undismissed** → the Welcome reappears next launch until Skip is clicked (by design; mildly repetitive if a user keeps escaping).
- Welcome modal blocks all pointer events until dismissed — standard onboarding UX, but it is exactly what B-1 trips on in the web-mode AI tests.

---

## 3. EXACT BLOCKERS (for Foreman Gemini)

1. **B-1** — dismiss/scope the Welcome modal so fresh **web/gateway-mode** sessions don't block the existing AI e2e flows (fix in `tests/e2e/ai-gateway.spec.ts` or gate the welcome to desktop first-run / make it non-modal-blocking), then re-run e2e → 40/40 and `verify:full` green.
2. **B-2** — correct the 5 inaccurate claims (bind `Ctrl+N`, `Ctrl+Shift+P`, `F2`, or delete those rows from `KeyboardShortcutsModal.tsx` + `chapters.ts`; fix `Ctrl+\` to say "Split View" or rebind; add a delete confirmation or drop the claim). Also fix the stale `title="New Note (Ctrl+N)"`.

After B-1 + B-2: re-run this audit; verdict can flip to **GUIDED TUTORIAL READY FOR DOGFOOD**.
