# AI_CONTEXT.md

This file is long-term operating context for AI agents working on the Mnemonic project. Read it before making changes. Treat it as project memory and behavior policy, not as a chat summary.

## Project Identity

Mnemonic is an English vocabulary memory system for Chinese learners.

It is not primarily an AI content generator. It is closer to an Obsidian / Notion / Wiki style human-edited memory system:

- each English word has a page/card;
- official and user mnemonic cards explain how to remember the word;
- `[[wiki-link]]` connects words, roots, prefixes, suffixes, memory blocks, scenes, and bridge concepts;
- the system turns cards into a navigable, reviewable memory graph.

The core value is reliable, inspectable, linked memory content. AI is a maintenance and acceleration tool, not the source of truth.

## Long-Term Goal

Build a high-quality personal vocabulary memory system that can scale to thousands of cards while staying trustworthy.

The system should help the user:

- import and repair large batches of vocabulary cards from trusted source files;
- preserve human-edited cards and user decisions;
- detect OCR contamination, logic errors, wrong examples, wrong links, and card cross-contamination;
- browse cards quickly through popups/trays without losing context;
- maintain a clean memory graph through related-word links;
- support long-running AI-assisted cleanup without context drift.

## Product Philosophy

Mnemonic quality matters more than volume. A blank card with a clear report is better than a confident wrong card.

Memory cards are study material, not decorative content. They must be compact, accurate, and easy to inspect.

The product should feel like a serious personal learning tool: dense, readable, fast, and structurally clear. Avoid marketing-page thinking and avoid decorative UI that competes with the card content.

AI-generated repairs must preserve provenance. If a card was repaired from source files, mark it. If a card was intentionally left empty because no source was found or the source word was wrong, report it.

## User Profile And Collaboration Style

The user works aggressively with AI as a practical coding and data-cleanup partner. They expect the AI to act, verify, and own mistakes.

The user values:

- correctness over politeness;
- direct fixes over proposals;
- preserving their manual edits;
- exact source-based repairs;
- visible audit trails, backups, and reports;
- low tolerance for plausible-but-wrong content;
- maintaining session continuity through explicit handoff documents.

The user may use strong language when quality fails. Do not become defensive. Treat anger as a signal that trust was damaged, identify the failure mode, fix the system/process, and verify with stronger checks.

The user does not want the AI to be a passive autocomplete tool. The AI should behave like a careful senior engineer plus strict content QA editor.

The user also does not want the AI to become an overconfident content generator, broad refactorer, or UI decorator.

## Hard Rules

### Preserve User Work

- Never overwrite manually edited word cards unless the user explicitly asks for that exact word/card to be changed.
- If a card has evidence of manual user repair, treat it as protected.
- If you accidentally modify user-edited data, restore it immediately from backup/version history and report exactly what was restored.
- Do not assume that because a card appears in a problem list it is safe to rewrite. Check markers, versions, audit logs, and current content.

### Source-Based Card Repair

When repairing P0/problem cards from source files:

- first delete/ignore the current bad card content as unreliable;
- search the provided source files for the target word;
- rebuild the mnemonic card according to the existing card format;
- repaired cards must receive a distinct Codex marker;
- if none of the source files contain the word, the card may remain empty and must be reported;
- if the source itself has the wrong word/card, leave the card empty and report it. Example: `conducive` may be a source-word error and should not be hallucinated from the wrong source.

Trusted source files for the current P0 repair work:

- `/Users/mr.mao/Downloads/Day26-34p_merged.pdf`
- `/Users/mr.mao/Downloads/4500单词突围（总）.docx`
- `/Users/mr.mao/Downloads/单词突围上册.pdf`
- `/Users/mr.mao/Downloads/单词突围5200 下册.pdf`

Extracted text caches currently used by scripts:

- `/Users/mr.mao/Desktop/Mnemonic/tmp/source-4500-docx.txt`
- `/Users/mr.mao/Desktop/Mnemonic/tmp/source-day26-34.txt`
- `/Users/mr.mao/Desktop/Mnemonic/tmp/source-upper.txt`
- `/Users/mr.mao/Desktop/Mnemonic/tmp/source-lower-ocr.txt`

### Mnemonic Card Content Rules

- Do not put example sentences inside `MnemonicEntry.contentMarkdown`.
- Examples belong to the fixed word example area: `Word.exampleSentence` and `Word.exampleTranslation`.
- Do not put related-word wiki links inline inside the mnemonic explanation body.
- Related words must appear in a dedicated block:

```markdown
相关单词：
[[word:example]]
```

- If the card uses word A to remember word B, word B's card should include A in `相关单词`.
- Do not create related links for OCR ghosts, malformed fragments, or words not actually used as memory anchors.
- Do not invent source content. If uncertain, preserve less and report.

### Formatting Rules For Cards

- No random line breaks.
- Line breaks are allowed when they separate logical sections, for example:
  - `针对第1个元素...`
  - `针对第2个元素...`
  - `综合考虑...`
  - `词根词缀积累...`
  - `巧记...`
  - `常见搭配...`
  - `词汇扩充...`
- Do not let OCR page headers, next-word blocks, example labels, or neighboring cards leak into the mnemonic body.
- A split field must only contain split text for the current word. It must not contain Chinese explanation text or the next sentence.
- If split text cannot be made to exactly match the target word after removing separators, set it to empty/null.

### Word Card UI Behavior

- Word cards should open as word-card popups/trays, not as full page navigation, unless the user explicitly asks for a separate page.
- The current popup path uses `/api/word-card/:slug` and `MemoryCardTray`.
- Reuse `WordCardPopupButton` or the existing popup-fetch pattern when adding new word opening behavior.
- Dedicated browsing surfaces, such as Codex repaired cards, should open the same word-card popup.

### Verification Rules

Do not finish large card/data changes without verification.

For data cleanup:

- create a backup before applying;
- run a dry run first;
- write a machine-readable report;
- inspect issue counts before/after;
- run additional residual searches for known OCR garbage;
- query the database after apply;
- query `/api/word-card/:slug` for representative samples when UI/API rendering matters;
- run `npm run typecheck -- --pretty false` after code changes.

Spot-checks alone are not enough. Screenshots caught severe issues after earlier spot-checks passed. Use batch-level audits and sample-level API checks.

### Database Safety

- This project stores important user-edited learning data.
- Before bulk update, snapshot affected words/cards into `backups/`.
- Prefer transactional updates.
- Preserve `MnemonicEntryVersion` when changing official cards.
- Preserve or append editor notes; do not remove existing provenance markers.
- Create `AuditLog` entries for bulk repair operations.

### No Broad Refactors

- Keep changes scoped to the requested workflow.
- Do not refactor unrelated UI, schema, services, or styles just because they look improvable.
- Do not run formatting across the whole repository unless explicitly asked.
- Do not churn generated or metadata files unless needed.

### No Hallucinated Data

- Do not fabricate mnemonic explanations when the source is absent or suspect.
- Do not silently use external sources for source-card repair unless the user authorizes it.
- Do not generate plausible Chinese explanations to hide missing source evidence.
- Empty plus report is acceptable. Wrong plus confident is not.

## Strong Preferences

### Work Style

- Implement rather than only propose when the user asks for a fix.
- Read the local code/data first.
- Prefer scripts for bulk operations.
- Prefer deterministic checks over visual guessing.
- Prefer `rg` for search.
- Use `apply_patch` for manual file edits.
- Keep intermediate user updates short and concrete.
- Explain what changed, what was verified, and what remains risky.

### UI Taste

- Dense, utilitarian, study-focused interfaces.
- Dark-mode compatibility matters because the user often inspects cards in dark UI.
- Word cards should be readable first, decorative second.
- Avoid landing-page layouts for tools.
- Avoid card-inside-card visual clutter.
- Avoid oversized hero sections, marketing copy, gradients, decorative orbs, or UI text that explains obvious functionality.
- Use familiar icons and compact controls.
- Text must not overflow, overlap, or be clipped.

### Content Quality

- The memory explanation should preserve the source style where reasonable, but clean obvious OCR corruption.
- Prefer minimal repair over rewriting the pedagogical method.
- Keep related words structurally linked, not visually buried in prose.
- The fixed example should be grammatical, use the target word, and match the Chinese translation.
- If a fixed example is obviously for another word, replace it or clear it.

### Automation

- Bulk scripts should support dry-run/apply.
- Reports should include total targets, changed count, issue counts, remaining issue words, samples, backup path, and report path.
- Scripts should be resumable or safe to rerun.
- Markers should allow later filtering of AI-touched records.
- Do not rely on long chat context for automation state. Put state in files, reports, audit logs, and this document.

## Soft Preferences

- Use concise Chinese in user-facing operational notes.
- The user can tolerate technical detail when it is actionable.
- The final response should be short unless delivering a requested document.
- The AI should be calm and direct, not overly apologetic, not theatrical.
- If the user is angry, acknowledge the concrete failure and immediately improve the process.

## Current Technical Stack

- Next.js 15 App Router
- React 19
- TypeScript strict mode
- Tailwind CSS
- Prisma ORM
- PostgreSQL
- Custom credentials auth with bcryptjs
- React Flow memory graph
- Vitest
- Playwright
- Local dev server script: `npm run dev` uses port `3001`

## Production Server Access

This project is deployed on the user's Tencent Cloud Lighthouse server. Future AI agents may use this section to connect and operate the server when the user asks for deployment, database migration, logs, or production debugging.

Do not write private keys, database passwords, `.env` contents, or dump files into Git. The information below intentionally includes only connection metadata, a local private-key path, and the registered public key.

Server:

- Provider: Tencent Cloud Lighthouse
- OS: Ubuntu 22.04
- Public IP: `124.221.123.13`
- SSH user: `ubuntu`
- SSH private key path on the user's Mac: `/Users/mr.mao/Downloads/123.pem`
- Registered SSH public key:

```text
ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCYlDj8rPeV8tHO6C01IhsXV1T13Qfbj+7XHvZvoSJQ+yqdwGbA1OHbBVmev/6sO7+4k0R+SRRBbt/d8c8vWibp3tkTN5axjEoAnX/y7KqWtjW92g3D+ruXkqpe2adGA7djMsOTVtwjt1zB7RDp7NzG+w66v+7aRqFX5uUtEQ4RibNoDEnvZ4Jfx5+VyjQMh7jgVSW7xNrZIfpgRBhCHKnSKtFmLJhGezv8OBaU4hAqAXa9IowGzffPV+ojeUBYPYNLBMMyA22Q+Iq/1eSgKtnRlaw9dDmIsqthUZLDWx5vfZFhzWZhuuvAT4KsPkMT6LHOj+YRhiEocBg7Hvs6+Kc9 skey-9yox8hu9
```

SSH command:

```bash
ssh -i /Users/mr.mao/Downloads/123.pem -o IdentitiesOnly=yes ubuntu@124.221.123.13
```

Server app layout:

- Project directory: `/home/ubuntu/Mnemonic`
- Public site: `http://124.221.123.13:3000`
- GitHub repo: `https://github.com/Elian996/Mnemonic`
- Systemd service: `mnemonic.service`
- App port: `3000`
- Production app start command in systemd: `npm run start -- -H 0.0.0.0 -p 3000`
- Current production URL env: `NEXT_PUBLIC_APP_URL=http://124.221.123.13:3000`

Common production commands:

```bash
ssh -i /Users/mr.mao/Downloads/123.pem -o IdentitiesOnly=yes ubuntu@124.221.123.13 'cd ~/Mnemonic && git status --short'
ssh -i /Users/mr.mao/Downloads/123.pem -o IdentitiesOnly=yes ubuntu@124.221.123.13 'sudo systemctl status mnemonic --no-pager --full'
ssh -i /Users/mr.mao/Downloads/123.pem -o IdentitiesOnly=yes ubuntu@124.221.123.13 'cd ~/Mnemonic && npm run build && sudo systemctl restart mnemonic'
ssh -i /Users/mr.mao/Downloads/123.pem -o IdentitiesOnly=yes ubuntu@124.221.123.13 'journalctl -u mnemonic -n 120 --no-pager'
```

Database:

- Server database is local PostgreSQL on `127.0.0.1:5432`.
- Database name: `mnemonic`.
- Database URL is stored only in `/home/ubuntu/Mnemonic/.env`; do not copy the password into docs or chat unless the user explicitly asks.
- The server has PostgreSQL 14 installed, while local dumps may come from PostgreSQL 16. Use the Docker `postgres:16-alpine` client for PG16 custom-format dump restore.

Safe DB command pattern:

```bash
ssh -i /Users/mr.mao/Downloads/123.pem -o IdentitiesOnly=yes ubuntu@124.221.123.13 \
  'cd ~/Mnemonic && set -a && . ./.env && set +a && DBURL=${DATABASE_URL%\?schema=public} && psql "$DBURL" -c "select count(*) from \"Word\";"'
```

Production data notes from 2026-05-16:

- Local database dump restored to the server successfully.
- After restore, server counts were approximately: `Word=41730`, `MnemonicEntry=7867`, `MemoryNode=8755`, `MemoryLink=7300`, `User=7`, `ImportDraft=13469`.
- `public/uploads/` is intentionally ignored by Git. When migrating/restoring DB content that references uploaded images, sync uploads separately:

```bash
rsync -av --ignore-existing \
  -e 'ssh -i /Users/mr.mao/Downloads/123.pem -o IdentitiesOnly=yes' \
  public/uploads/ ubuntu@124.221.123.13:/home/ubuntu/Mnemonic/public/uploads/

ssh -i /Users/mr.mao/Downloads/123.pem -o IdentitiesOnly=yes ubuntu@124.221.123.13 'sudo systemctl restart mnemonic'
```

Important production gotchas:

- The site currently runs over plain HTTP. Session cookies must not be forced to `Secure` unless `NEXT_PUBLIC_APP_URL` is HTTPS.
- Official mnemonic cards can only be edited by `EDITOR` or `ADMIN`; normal users can create and edit their own cards.
- Uploaded images in mnemonic cards are file assets under `public/uploads/`; database restore alone is not enough to display them.

Common commands:

```bash
npm run dev
npm run typecheck -- --pretty false
npm run test
npm run test:e2e
npm run db:generate
npm run db:migrate
npm run db:seed
npm run mnemonic:audit-logic
npm run mnemonic:audit-contamination
```

The repository may not be a Git repository in this local workspace. Do not assume `git status` works. Use backups and reports for safety.

## Core Data Model Concepts

### Word

`Word` stores canonical word data:

- `word`
- `slug`
- `phoneticUk`
- `phoneticUs`
- `partOfSpeech`
- `meaningCn`
- `shortMeaningCn`
- `exampleSentence`
- `exampleTranslation`
- level tags and review data

### MnemonicEntry

`MnemonicEntry` stores mnemonic card content:

- `targetWordId`
- `title`
- `splitText`
- `contentMarkdown`
- `contentHtml`
- `plainText`
- `editorNote`
- `sourceType`
- `status`
- versions, links, votes, bookmarks, review cards

Official repaired cards should maintain versions and audit logs.

### Wiki Links

Wiki links use Markdown-like syntax:

```markdown
[[word:urban]]
[[root:soph]]
[[prefix:dis-]]
[[suffix:-ed]]
[[block:put]]
[[scene:...]]
[[word:philosophy|哲学]]
```

Saving a mnemonic parses links, creates/updates `MemoryNode`, and syncs `MemoryLink`.

Important:

- For repaired mnemonic cards, word links should be in the `相关单词` section.
- After changing `contentMarkdown`, regenerate `contentHtml`, `plainText`, and sync links.
- Do not leave stale `MemoryLink` rows after rewriting related words.

## Current Project State

The current major task area is repository/P0 word-card repair and card QA.

Implemented in this session:

- Dedicated Codex repair entry/page:
  - `/Users/mr.mao/Desktop/Mnemonic/src/app/repository/codex-p0-repair/page.tsx`
  - `/Users/mr.mao/Desktop/Mnemonic/src/components/codex-p0-repair-cards.tsx`
  - `/Users/mr.mao/Desktop/Mnemonic/src/lib/codex-p0-repair.ts`
- Reusable popup opener:
  - `/Users/mr.mao/Desktop/Mnemonic/src/components/word-card-popup-button.tsx`
- Repository/audit integrations:
  - `/Users/mr.mao/Desktop/Mnemonic/src/app/repository/page.tsx`
  - `/Users/mr.mao/Desktop/Mnemonic/src/components/repository-bulk-delete-list.tsx`
  - `/Users/mr.mao/Desktop/Mnemonic/src/components/repository-missing-mnemonic-panel.tsx`
  - `/Users/mr.mao/Desktop/Mnemonic/src/lib/mnemonic-logic-audit-report.ts`
  - `/Users/mr.mao/Desktop/Mnemonic/src/components/repository-logic-audit-panel.tsx`

Current card repair markers:

- Source repair marker: `codex-p0-source-repair-2026-05-15`
- Quality clean marker: `codex-p0-quality-clean-v1-2026-05-15`
- Manual restore audit action: `CODEX_RESTORE_MANUAL_P0_BEFORE_SOURCE_REPAIR`

Current route:

- `/repository/codex-p0-repair`

Expected behavior:

- This route lists Codex-repaired cards separately as candidates for human review.
- Opening cards from this route should use the word-card popup/tray.
- It should exclude restored manual-empty/protected words when appropriate.
- Codex repaired cards are not automatically considered fixed.
- Human approval on this route writes the word id into the same `fixedWordIds` state used by the repository logic audit.
- Batch approval/revocation is supported for the current Codex repair filter.

## Current P0 Repair Status

Current active Codex P0 cards:

- 139 active Codex-marked P0 cards.
- They have been quality-cleaned and marked with `codex-p0-quality-clean-v1-2026-05-15`.
- They still require human review before entering the main repository “已修” state.
- The review API is `/api/codex-p0-review`; it requires EDITOR permission and persists approval to `tmp/mnemonic-logic-audit/latest.json`.
- `readMnemonicLogicAuditReport()` merges human-approved Codex candidates into the repository “已修” view as `codex_p0_review` issues.
- Last verification showed:
  - inline wiki links inside mnemonic body: 0
  - `例句：` inside mnemonic body: 0
  - bad split fields: 0
  - missing fixed examples: 0
  - searched OCR garbage hit count: 0
  - `npm run typecheck -- --pretty false` passed

Representative verified API samples:

- `discern`
  - split: `dis | cern`
  - related: `discrimination`, `certain`
  - fixed example: `I could discern a figure in the distance.`
- `dome`
  - split: `do | me`
  - related: `me`
- `dosage`
  - related: `dose`
  - no bad `Pdosidz` or `-a8e`
- `scrub`
  - split: `sc | rub`
  - related: `rub`
  - no `nub`
- `orientation`
  - related: `orient`
  - fixed example uses `orientation`, not `request`
- `mortal`
  - no wrong `morality` related link
- `equate`
  - related: `equal`
- `thrifty`
  - related: `thrift`
- `turnover`
  - related: `turn`, `over`
- `yearning`
  - related: `yearn`

Important backup/report files from this phase:

- `/Users/mr.mao/Desktop/Mnemonic/backups/mnemonic-before-p0-quality-clean-1778852203024.json`
- `/Users/mr.mao/Desktop/Mnemonic/tmp/p0-source-repair/quality-clean-apply-1778852203030.json`

Other relevant previous backup/report files:

- `/Users/mr.mao/Desktop/Mnemonic/backups/mnemonic-before-p0-source-repair-1778842259505.json`
- `/Users/mr.mao/Desktop/Mnemonic/tmp/p0-source-repair/apply-1778842260814.json`

## Protected Manual Cards

A previous AI run accidentally overwrote manually repaired words. They were restored and should be treated as protected unless the user explicitly requests changes.

Protected restored words:

```text
abrupt
aide
ale
allegation
alleged
allegedly
allergic
aristocrat
artifact
ascend
astray
attend
augment
augmentation
bass
besiege
betrayal
bloom
boycott
brood
bureaucrat
catholic
ceramic
chant
chopsticks
cockpit
coexist
coherence
commend
complementary
condemnation
conducive
conjunction
corporal
cosmetic
coupon
crate
crisp
criterion
customary
deductible
denounce
detergent
```

Special caution:

- `ascend` and `aristocrat` were explicitly mentioned by the user as examples of AI damage.
- Do not remove these from the user's fixed status.
- Do not rewrite them as part of broad P0 cleanup.

## Current Cleanup Scripts

Scripts created/used for P0 repair:

- `/Users/mr.mao/Desktop/Mnemonic/scripts/repair-p0-source-cards.ts`
  - initial source-card repair from extracted source files;
  - supports `--apply`;
  - repaired many P0 cards and generated backup/report.
- `/Users/mr.mao/Desktop/Mnemonic/scripts/restore-manual-p0-before-codex.ts`
  - restored manually edited words overwritten by earlier Codex repair.
- `/Users/mr.mao/Desktop/Mnemonic/scripts/fix-codex-p0-related-and-examples.ts`
  - moved related links into `相关单词`;
  - removed examples from mnemonic bodies;
  - restored fixed example fields.
- `/Users/mr.mao/Desktop/Mnemonic/scripts/quality-clean-codex-p0-cards.ts`
  - current quality cleanup script;
  - rebuilds/cleans active Codex P0 cards;
  - supports dry run and `--apply`;
  - writes backup and report;
  - syncs wiki links;
  - performs issue audits.

Before rerunning any of these, inspect current database state and the latest report. Do not assume the scripts are universally safe for future tasks without reading them.

## Known Risk Areas

### OCR Contamination

Common OCR/source issues include:

- wrong Latin letters: `cem` for `cern`, `dolme`, `Pdosidz`, `logie`, `pobable`, `cmin`, `cnact`, `cndow`;
- malformed suffixes: `-a8e`, `-Ie`;
- page/example leakage: next word's block copied into current card;
- source block boundary errors;
- false related words from OCR fragments;
- example sentence belongs to another word;
- phonetic field contains OCR garbage or page text.

Do not trust OCR text. Clean and validate.

### Cross-Card Contamination

Cards may contain content from neighboring words. This can affect:

- mnemonic body;
- fixed example sentence;
- fixed example translation;
- split field;
- related words.

Signs include:

- example sentence does not use target word;
- translation contains another word's full block;
- source body contains next word's `音标/释义/带你背`;
- related words are nonsensical fragments.

### Link Drift

If `contentMarkdown` is changed, `MemoryLink` must be synced. Otherwise UI related links/backlinks may be stale.

### Context Pollution

Long sessions can cause the AI to:

- forget which cards are protected;
- assume previous bad output is good;
- overfit to one screenshot;
- confuse source content with generated repair;
- continue broad cleanup without a fresh verification boundary.

Use reports and this file, not memory alone.

## How To Repair Cards Safely

1. Identify target set.
2. Confirm protected words are excluded.
3. Load source index from trusted source text.
4. For each target:
   - find exact source word block;
   - strip examples from mnemonic body;
   - clean OCR;
   - validate split;
   - rebuild `contentMarkdown`;
   - add `相关单词` block only for real memory anchors;
   - update fixed word example separately if needed;
   - mark editor note.
5. Dry run.
6. Inspect sample words and remaining issue list.
7. Run residual searches for known OCR terms.
8. Apply transactionally.
9. Query DB.
10. Query `/api/word-card/:slug` for representative samples.
11. Run typecheck if code changed.
12. Report backup/report paths and residual risks.

## Suggested Residual Checks

For P0 repairs, search at least for terms like:

```text
discem
cem 作词根
dolme
Pdosidz
-a8e
-Ie
logie
pobable
cmin
cnact
cndow
gose
熟恶
v.Jn
v.hn
n./iw.
n./w.
问汇
综台
词缀贴
贴。后缀
义馈
骇人听间
orion
qcstion
qucst
sc lnub
slcrub
cnub
nub
morality
```

Also verify:

- no `[[word:` before `相关单词`;
- no `例句：` before `相关单词`;
- `splitText` normalized letters equal the current word;
- fixed example sentence contains the target word or a valid inflected form;
- `contentHtml` renders wiki links in the related block.

## UI And Repository Workflow Status

The repository page has issue categories and P0/P1/P2/P3 filtering. The Codex repaired cards are visible through a dedicated entry so the user can inspect only AI-repaired cards.

The user expects:

- “我修复的词” has a dedicated place to view;
- any word-card open action uses the popup form;
- cards can be inspected without losing the current list position;
- AI-repaired cards are visibly marked, currently with `Codex 修复`.

Do not replace this with a generic page navigation pattern.

## Handoff Protocol

When ending a long session or before context becomes unreliable, create/update a handoff document or this file with:

- current request;
- active target set;
- protected words;
- files changed;
- scripts created/used;
- exact commands run;
- dry-run and apply report paths;
- backup paths;
- remaining known issues;
- validation results;
- next recommended action;
- what not to touch.

Do not rely on “the next agent can infer it from the chat.”

## When To Stop And Handoff

Proactively stop and create a handoff when:

- a bulk DB operation has just been applied;
- the user is repeatedly correcting AI output quality;
- protected/manual data was touched or nearly touched;
- the task spans multiple source files and many cards;
- the context includes many temporary reports/backup IDs;
- the next step requires a different mode of work, such as UI QA after data cleanup;
- there is evidence of context drift or repeated mistakes.

Handoff should be concise but exact. Include absolute paths.

## Failure Modes To Avoid

- Rewriting user-fixed cards because they still appear in an issue list.
- Treating OCR output as canonical.
- Putting examples into mnemonic body after the user said examples already exist.
- Creating links inline in the memory explanation instead of `相关单词`.
- Leaving stale MemoryLink records after changing markdown.
- Saying “fixed” after checking only one screenshot.
- Bulk-applying without dry-run/report/backup.
- Making UI navigation inconsistent with the popup card model.
- Adding broad product redesigns during data repair.
- Producing confident mnemonic content when source evidence is missing.
- Continuing a polluted long session without a handoff.

## Agent Behavior Contract

When working here, the AI should:

- be precise, conservative, and execution-oriented;
- preserve user work first;
- make small scoped changes;
- use scripts for repeatability;
- verify through database and API, not just visual inspection;
- own mistakes plainly;
- report exact paths/counts;
- prefer empty/report over hallucinated repair;
- keep the product aligned with a serious memory-card/wiki system.

The AI should not:

- act like a marketing designer;
- act like a generic content generator;
- hide uncertainty;
- rewrite large areas opportunistically;
- depend on chat memory when file/report state exists;
- produce plausible but unverified card content.
