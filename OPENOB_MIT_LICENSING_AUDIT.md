# OPENOB MIT LICENSING ADVERSARIAL AUDIT

**Mode:** AUDIT ONLY — no files modified, no commits.
**Target:** committed main `1a90a0da42082dfe38b8e70897487c54a43d9f3f` ("docs: add MIT license") — == origin/main, tracked tree clean.
**Environment:** Windows 10, Node 22, Chromium 1.62.1.
**Question:** Can OpenOb be publicly distributed under MIT as currently committed without an obvious licensing or attribution problem?

---

## AUDIT 1 — LICENSE file — PASS

Root `LICENSE` exists, plain text, repository-root discoverable. Compared **byte-for-byte** against the canonical MIT template (GitHub `choosealicense.com/gh-pages/_licenses/mit.txt`): **21 lines == 21 lines; the only difference is the template placeholders `[year] [fullname]` correctly filled as `Copyright (c) 2026 Joseph R. Long`**. No clause removed, altered, added, or paraphrased; no custom restrictions appended. (opensource.org direct fetch 403'd a bot — comparison used GitHub's canonical template, same OSI text.)

## AUDIT 2 — GitHub recognition — PASS (observed)

`GET /repos/sumosizedginger/OpenOb` → `visibility: public`, `license: MIT`. `GET /repos/.../license` → `spdx_id: MIT | name: MIT License | path: LICENSE`. **GitHub recognizes the repository as MIT License** — observed via API, not assumed. Repo is now **public** (previous audit's private-repo 404 is resolved).

## AUDIT 3 — Package metadata — PASS

All **13** `package.json` files (root, apps/desktop, apps/gateway, apps/web, packages/ai|core|desktop|index|markdown|plugin|vault|workspace, examples/plugin-template) declare `"license": "MIT"`. Root declares `"author": "Joseph R. Long"`; sub-packages omit `author` — acceptable metadata (holder is fixed by the LICENSE copyright line; no package implies MIT for separately-licensed content). No conflicting license declarations anywhere.

## AUDIT 4 — README / documentation — PASS

`README.md:73` — "OpenOb is open-source software licensed under the **MIT License**." Consistent. All other "proprietary" hits (docs/CONSTITUTION.md, DECISIONS.md, LEARN_OPENOB.md, START_HERE.md) refer to _rejecting proprietary document formats / no vendor lock-in_ — they are product claims, not licensing claims, and do not contradict MIT. No "all rights reserved" or proprietary-license assertions.

## AUDIT 5 — Third-party dependencies — PASS

`package-lock.json` + `node_modules` direct-dep survey: **zero copyleft** (no GPL / AGPL / SSPL / LGPL / MPL / BUSL / Elastic anywhere). License distribution: 247 MIT, 32 ISC, 15 BSD-3-Clause, 11 Apache-2.0, 9 BSD-2-Clause, 8 BlueOak-1.0.0, 2 WTFPL, 1 CC-BY-4.0, 1 Python-2.0, 1 0BSD, 0 UNKNOWN. All permissive and MIT-compatible. Attribution obligations exist only in the normal permissive sense (satisfied at source level via node_modules + lockfile); no source-distribution or copyleft obligations triggered. The CC-BY-4.0 item is content-licensed, not code, and compatible.

## AUDIT 6 — Copied / vendored code — PASS

No `vendor/`, `third_party/`, or `third-party/` directories outside node_modules. No `NOTICE` file required at source level — no in-repo copied third-party source identified (brand master is owner-supplied; the icon generator is first-party OSS tooling). npm dependencies are package linkage, not copied source.

## AUDIT 7 — Brand / creative assets — policy consideration (MINOR)

The blanket MIT grant covers the brand assets (`assets/brand/*`, icons, favicons) by default — the license commit's uniform `"license": "MIT"` across all packages makes owner intent clear, which the audit treats as valid. No separate trademark statement exists. **Policy note only** (a trademark statement is customary for brand protection but is not a licensing defect and the audit explicitly forbids manufacturing a blocker here).

## AUDIT 8 — Contributions — MINOR

No `CONTRIBUTING.md`, CLA, or DCO. GitHub's default is inbound = outbound under the repository license, so outside contributions would reasonably be MIT. For an early open-source project this is acceptable (audit: lack of a CLA is not a blocker). A short CONTRIBUTING.md is optional future hygiene.

## AUDIT 9 — History — PASS

All 91 commits are by the single owner (`sumosizedginger <Donttouchmyshit420@gmail.com>`). No identifiable third-party code in history. Provenance of AI-assisted code is owner-directed; no evidence of incompatible third-party material. No speculative copyright conclusion warranted.

## AUDIT 10 — Pages publication — PASS (one MINOR)

The public deployment serves the static bundle. Source-level obligations (MIT notices) are satisfied in the repository; the minified browser bundle preserves only **one** `Copyright` banner comment across the main JS (third-party MIT dep notices are otherwise stripped by minification). Practical release level: common practice for bundled artifacts; an optional `THIRD_PARTY_NOTICES`/legal-comment banner would be attribution hygiene (**MINOR**, not a distribution blocker — no dep requires more than notice preservation, and none is excluded from the MIT grant). Nothing intentionally excluded from MIT is exposed by the artifact; no notice-requiring vendored files are bundled.

## AUDIT 11 — Security / secrets — PASS

License commit diff = `LICENSE` + one `"license": "MIT"`/`"author"` line per package.json — **0 secret patterns** (no keys, tokens, `sk-*`, private-key blocks). No tracked `.env`, `.pem`, `.key`, or `id_rsa` files in the repo. The Pages artifact was previously scanned clean (no secrets, no sourcemaps). Repo being public introduces no new exposure from this change.

## AUDIT 12 — Scope discipline — PASS

The license commit touched **only** `LICENSE` and the 13 `package.json` files (license/author metadata). No application code, CI behavior, Electron packaging, Pages deployment, tests, or security logic changed. Narrowly scoped to licensing alignment.

---

## FINDING REGISTER

| #   | Class | Finding                                                                                                                                                            |
| --- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F-1 | MINOR | No `CONTRIBUTING.md`/CLA/DCO; GitHub inbound=outbound default covers it — optional future hygiene (Audit 8).                                                       |
| F-2 | MINOR | No trademark statement for brand assets under the blanket MIT grant — policy consideration, not a defect (Audit 7).                                                |
| F-3 | MINOR | Minified Pages bundle preserves only 1 third-party copyright banner; optional `THIRD_PARTY_NOTICES` or legal-comment retention for attribution hygiene (Audit 10). |
| F-4 | MINOR | Sub-package `package.json` files omit `author` — cosmetic metadata only, holder fixed by LICENSE (Audit 3).                                                        |

No BLOCKER and no MATERIAL finding. All four are policy/hygiene notes.

---

## VERDICT

# MIT LICENSING VERIFIED WITH NON-BLOCKING FINDINGS

The LICENSE is canonical MIT (byte-verified), correctly attributed to `Copyright (c) 2026 Joseph R. Long`, GitHub recognizes it as MIT, all 13 package manifests are aligned, documentation agrees, no dependency (copyleft or unknown-license) conflicts with MIT distribution, no copied/vendored code carries incompatible terms, no secrets were introduced by the license commit, and the commit was narrowly scoped. The four MINOR findings (contributing guidance, trademark statement, bundle notice retention, author metadata) are optional policy/hygiene items that do not block public distribution.

# PUBLIC REPOSITORY / GITHUB PAGES LICENSING CLEAR

The repository is **public**; GitHub shows MIT License; the live Pages site **https://sumosizedginger.github.io/OpenOb/ returns 200 and boots correctly** (title "OpenOb", app rendered, logo loaded, zero failed requests — verified by execution); `LICENSE` is served via raw.githubusercontent (200); the public artifact contains nothing intentionally excluded from the MIT grant, no notice-required vendored files, and no secrets. Publishing under MIT through GitHub Pages raises no licensing, attribution, dependency, or repository-policy problem in the current committed state.
