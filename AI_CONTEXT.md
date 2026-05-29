# AI_CONTEXT.md

This file is long-term operating context for AI agents working on the Mnemonic project. Read it before making changes. Treat it as project memory and behavior policy, not as a chat summary.

## Mandatory AI Read-First Rule

AI agents working in this repo must read `AI_CONTEXT.md` before making code, data, UI, or deployment changes. This document is the project memory and the user's standing instructions.

Every future rule, principle, product decision, user preference, behavior, workflow, keyboard shortcut, deployment, data, UI change, verification lesson, or gotcha must be synchronized into `AI_CONTEXT.md` in the same task. Do not leave the AI document stale after code changes or after the user clarifies a standing rule.

When the user says "以后", "以后所有", "规则", "原则", "改动", "记住", "AI 文档", or gives a standing preference, treat it as persistent project memory and update this document immediately unless the user explicitly says it is temporary.

User standing instruction, verbatim: "我所提过的要求都写进ai文档包括这一句话". Treat every explicit requirement the user has raised in the project as AI-document material, including this sentence itself.

Project terminology: "三端同步" means synchronizing the project across GitHub, the local workspace, and the production server. Do not use "三端同步" to describe the three personal word-state pages.

When a new behavior is added to a repeated workflow, do not implement it in only one visible place. For the personal word-state workflow, use "三状态列表同步": apply every equivalent operation to `熟练` (`/me/known`), `模糊` (`/me/fuzzy`), and `生词本` (`/me/unknown`). If the same word-card behavior also exists in the level/word browsing surface, update that surface too.

For word-card operations, "每一步操作" includes opening cards, linked-word opening, left/right navigation, `V/O/X` marking, undo buttons, undo shortcuts (`Shift+R`, `⌘Z`/`Ctrl+Z`), save-state UI, deletion/restore flows, close behavior, and any keyboard or mouse equivalent. Do not say a task is complete after testing only one list. Verify all three personal lists, and verify the shared browsing surface when applicable.

Current explicit user requirements captured from the personal-center word-card work:

- Personal-center status cards/modules must open their corresponding pages.
- Personal-center word-card behavior should match the outside level/word page wherever the same operation exists.
- `熟练`, `模糊`, and `生词本` are a synchronized three-surface workflow; do not implement or verify only one.
- Opened word cards must be keyboard-operable: `← / →` switch previous/next, `V / O / X` mark states, and undo works through both the visible undo button and shortcuts.
- Same-state `V/O/X` cancels the active mark, for example pressing `X` in `生词本` removes the unknown mark.
- Keyboard shortcuts must work even when browser focus is on the popup/card surface; support physical key codes where needed for Chinese input-method compatibility.
- The blue selected outline belongs to the underlying word tile/row only, not to the popup card itself.
- When a popup opens, switches words, or closes, the underlying selected tile/row must remain outlined in blue and scroll toward the page center if it is outside the viewport.
- All future rules, principles, changes, user preferences, gotchas, and verification lessons must be synchronized to `AI_CONTEXT.md`.

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

As of 2026-05-27, before public internet release, Mnemonic should not include a community/posting/social product surface. Do not add community pages, user posts, comments, friend/follow chat, private messaging, or social feeds at this stage. The near-term public release should focus on making word-card creation, review, display, ranking, and moderation reliable.

Word-card public-sharing direction from the user on 2026-05-27:

- User-created word cards can be private or submitted for public display.
- Anonymous visitors may read/search/open public word cards, follow word-card links, play pronunciation, and use lightweight learning interactions before logging in. Guest word marks/bookmarks, word-card like/dislike feedback, and personal card ordering should be stored locally with a small warning that unlogged data may be lost. If the visitor logs in or registers in time, merge those guest records into the account. Anonymous card writing should stay as local draft work until login/registration, then the user can submit/save under their account.
- The word-card editing area should have a clear "whether public" option. If public, the card enters `PENDING_REVIEW` and waits for administrator/reviewer approval before public display.
- Publicly visible word cards should not support comments or post-style discussion.
- Public word cards can receive like/dislike feedback. A like should also function as saving/collecting the card.
- User clarification from 2026-05-27: likes and dislikes are a single per-user reaction state per word card. One account can only leave one active reaction on one card at a time: like counts as `+1`, dislike counts as `-1`, switching reaction replaces the old one, and the default feedback sort uses net score `likeCount - dislikeCount`.
- Public word-card UI should not visibly separate "official cards" and "user cards"; the system may keep internal provenance/status markers, but learners should see a unified set of memory methods.
- Default visible card ordering should be: the current user's personally pinned cards first, then remaining visible cards sorted by net feedback score from high to low.
- When a user's public word-card submission passes review, the user's word-card contribution count should increase by 1 and keep accumulating over time. This should be a clear contribution count, not only a vague score.

Public-release permission and data-protection rules from the user on 2026-05-27:

- Ordinary accounts must be strictly blocked from `/repository` ("单词仓库") and related repository review/repair routes. Remove or hide every ordinary-account entry point, and enforce the block server-side so direct URL entry is also denied.
- As of 2026-05-29, public registration must require a 6-digit email verification code before account creation. The registration form should keep `username` hidden and continue auto-generating a unique internal `username` from the email, but it should expose a send-code action and require `verificationCode` on submit. Production email must not silently mock successful delivery when the configured real email provider is missing or invalid; it should fail visibly so users do not wait for a nonexistent message. Tencent Cloud SES is an accepted low-cost provider for this project via `EMAIL_PROVIDER=tencent-ses`; use the ordinary shared SES service rather than paid independent IP, and configure `TENCENTCLOUD_SECRET_ID`, `TENCENTCLOUD_SECRET_KEY`, `TENCENT_SES_REGION`, `TENCENT_SES_FROM`, and `TENCENT_SES_TEMPLATE_ID` only in server environment files, never in Git.
- Tencent Cloud SES setup state from 2026-05-29: domain `mail.mnemonic.top` is verified in the `ap-hongkong` region using shared IP. DNS records under `mnemonic.top` are `mail MX mxbiz1.qq.com.`, `mail TXT v=spf1 include:qcloudmail.com ~all`, `qcloud._domainkey.mail TXT` for the Tencent DKIM key, and `_dmarc.mail TXT v=DMARC1; p=none`. The SES sender address is `noreply@mail.mnemonic.top` with alias `Mnemonic`. Template `181063` is named `Mnemonic 邮箱验证码`, uses variables `{{code}}` and `{{ttlMinutes}}`, and was submitted for review at `2026-05-29 18:15:28` Asia/Shanghai. Do not enable independent IP unless the user explicitly asks.
- Ordinary accounts' maximum editing permission is their own user-created word cards. They may create private cards, edit their own cards, delete/archive their own cards, reorder/pin their own visible cards, and submit their own cards for public review. They must not edit official cards, word meanings, word metadata, repository data, import drafts, audit/repair queues, or admin/reviewer workflows.
- Deleting word cards follows the same ownership boundary: ordinary/personal users can delete only word cards they created themselves. They cannot delete other public word cards. Cross-user public-card deletion is administrator-only. Official-card deletion remains an editor/admin maintenance workflow unless the user explicitly tightens that rule.
- If an already-public user card is edited by its author, the changed content must return to pending review before public display.
- Protect data from loss: keep versions before edits/deletes where practical, archive instead of hard-deleting user cards, preserve audit logs for important writes, and avoid broad/bulk destructive operations without explicit review and backup.
- User update from 2026-05-27: the visible product name for `/repository` should become "管理员中心" rather than "单词仓库". The internal route may remain `/repository`, but the surface can also hold quiet backend/account metrics such as account totals, ordinary-account counts, ordinary-user-created word-card counts, pending public submissions, and private/public user-card totals.

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

Current high-priority visual principle from the user, verbatim: "一眼看过去什么都不多,但你点一下刚好就是你需要的,所有东西都像被认真删过。" Treat this as a standing product/design rule. Mnemonic should feel quiet, sparse, deliberate, and useful on click. Do not add modules, marketing copy, decorative gradients, complex illustrations, stacked SaaS cards, noisy icons, or visual explanations unless the user explicitly requests them.

Product north star from the user's 2026-05-25 mobile/UI critique: Mnemonic should be a "memory machine", not a pretty word-library showcase or database browser. This is product direction and project memory, not permission to redesign pages without an explicit implementation request.

- Build from the question "Can the user remember one word in 30 seconds?" rather than from the data structure. First-run experience should prove the mnemonic method, not repeat the brand name.
- The core loop should be: see the word -> get a memory hook -> form a mental image -> take an immediate test -> schedule review -> see mastery progress.
- The product promise should be closer to "给我一个你记不住的词，我让你现在记住" than "我有很多英语单词，你可以来看".
- Homepage direction: reduce repeated `mnemonic` branding, make the user and the memory action the hero, use user-language search copy such as `输入你记不住的单词，例如 despise`, and provide a strong primary action like `开始今天 20 个词`. A sample card should demonstrate a real memory hook and a tiny test, not behave like a normal dictionary entry.
- Vocabulary/level page direction: avoid leading with database concepts like `96 WORDS`, `第 1/18 页`, or a large paginated wall of words. Lead with today's learning/review task, mastery/review/new-word counts, and a single obvious primary action such as `开始今日学习` or `继续复习`. Full word-list browsing should be secondary.
- Hidden meanings (`••••••`) are acceptable only inside an explicit self-test mode with clear context such as "先看英文，点击显示释义". In ordinary browsing, show the core meaning and learning status directly.
- Word cards should be structured around memory, not dictionary lookup: word + pronunciation, core Chinese meaning, memory hook, structure/root explanation, one real example, related/confusable/antonym chain, and test/review controls.
- The word chain/relationship graph must be explanatory, not decorative. Lines should communicate labeled relationships or useful distinctions, e.g. `memory -> remember: 记住`, `memory -> recall: 回想起`.
- Every major learning surface needs one dominant next action. Secondary controls such as search, refresh, show/hide, save, pagination, and icon-only tools must not visually compete with the learning path.
- Brand voice should use product/user language rather than system language: prefer `记住这个词`, `输入你记不住的单词`, `今日新词`, `待复习`, `我的记忆进度` over generic labels like `查看详情`, `Search a word`, `96 WORDS`, or unexplained pagination.
- Visual direction should stay unified as quiet paper/book-like study software: warm paper/off-white, near-ink text, deep wine accent, restrained dark mode using dark gray rather than harsh black console styling, consistent home/level/profile/repository tone, and fewer but stronger buttons. Do not add decoration that does not help memory.
- Recommended brand promise candidates to keep in mind: `把单词变成画面。`, `用词链，记住难词。`, `不是背单词，是看懂单词为什么是这个意思。`, `一个词，一条链，一次记住。` The strongest current direction is `把单词变成画面。`

## Desktop And Mobile Product Direction

As of 2026-05-19, the local website should evolve as one URL/shared-data app with separate desktop and mobile UI modes, not two independent sites.

The desktop experience should keep the current dense workflow unless the user explicitly requests a redesign. Mobile may use a different interaction model because the screen is smaller and touch operation is stricter, but it must reuse the same data, auth, APIs, card-editing rules, and core business logic.

Technical scaffold:

- `DeviceModeProvider` in `src/components/device-mode-provider.tsx` detects `desktop`/`mobile` by viewport width, with `mobile` currently defined as `max-width: 767px`.
- The provider also detects touch-like input and writes `data-device-mode` plus `data-input-mode` onto `<html>` for styling, debugging, and future behavior switches.
- Use `ResponsiveModeSwitch`, `DesktopModeOnly`, and `MobileModeOnly` from `src/components/responsive-mode-switch.tsx` when a page needs separate desktop/mobile surfaces under the same route.
- Prefer viewport and interaction constraints over User-Agent sniffing. User-Agent can be used later as an additional hint, but it should not be the primary source of truth.
- Do not duplicate business logic between desktop and mobile components. Extract shared data loading, persistence, keyboard/marking rules, and card APIs first; split only presentation and interaction layers when the mobile workflow genuinely needs its own shape.

Current mobile vocabulary direction:

- On mobile, `/` and `/words` should open directly into a 3D ring-style vocabulary category navigation, not the traditional desktop landing page. The selected mobile ring visual is the warm paper editorial mockup the user chose: full-screen ivory/paper texture, centered serif-like `选择词库` title, top-right personal-center icon only, and a large tilted cream-glass orbital ring with pearl nodes and soft champagne shadows. The current implementation uses `public/assets/mobile-ring-scene.png` as the non-stretched visual base derived from the chosen mockup, with real clickable category labels/nodes animated above it. The moving labels/nodes must be computed from the same original image coordinate system and rendered through the same object-fit/cropping math as the scene image, so balls stay on the visible ring on real mobile browsers with different address-bar viewport ratios. Do not use free-floating anchor points in viewport percentages. The ring labels must auto-rotate smoothly along the orbital track while remaining clickable; users should not be able to drag or manually control the rotation. Do not use a stretched full-screen screenshot as the UI, because it freezes the ring and compresses the Chinese text on real phone browser viewports. Do not keep inactive decorative controls such as a top-left hamburger menu. The mobile ring page should occupy exactly one visual screen and not scroll to reveal other page backgrounds or bottom strips.
- Desktop `/` and `/words` should keep the existing structure unless the user explicitly asks to redesign desktop.
- As of 2026-05-22, desktop `/` was explicitly redesigned as a minimal Apple-style home page: warm off-white background, top-only minimal nav with `首页` and `我的`, serif `mnemonic` hero, one search bar, vocabulary buttons, one horizontal preview card, and one small down arrow. Do not reintroduce a dark left sidebar, `词库`/`词链` nav entries, marketing sections, SaaS card stacks, decorative gradients, or extra modules.
- Desktop `/` supports day/night/system theme switching from the top bar. The home search must stay in-page: typing into the search bar calls `/api/word-search`, shows a compact result popover, and clicking a result opens that word's card on the home page without changing the URL. The default `memory` preview card's `查看详情` button must also open the `memory` word card in-place, not navigate to `/word/memory`.
- Home in-page word cards must render real mnemonic card content, including images and `[[word:...]]` related-word links. Do not collapse home cards into plain text if that removes images or links. Related-word links inside the home card should be intercepted and opened as the next in-page home word card rather than navigating away.
- Vocabulary entry buttons currently include `随机`, `二级`, `三级`, `高考3500`, `四级`, and `六级`. `随机` is not a Prisma `LevelTag`; it is the `/levels/random` route and means an all-word mixed list with no tag filter.
- Desktop `/levels/[level]` was also redesigned to match the quiet home style: top bar, compact hero, restrained controls, simple word cards/list, no old oversized red rule or decorative illustration. `/levels/random` should reuse this surface and load all words without a level-tag filter. Route transitions from home to level pages must not flash white in dark mode; keep global `--mn-bg` dark-aware and provide restrained loading states when needed.
- Desktop personal center pages were redesigned on 2026-05-23 to match the quiet home/level style. `/me` should stay as a sparse profile page with a low-noise identity header, one three-part learning status strip (`熟练` / `模糊` / `生词本`), and a thin-line personal directory for `我的记忆卡`, `收件箱`, reviewer/admin entries, and repository access when permitted. Do not restore the old red-rule `InteriorHero`, cubist/dot decoration, SaaS-like module cards, hover shadow card stacks, marketing copy, or busy dashboard layout. Related pages under `/me` should share the same warm off-white/dark-mode profile surface, restrained subhero, row/list treatments, and the existing word-card popup behavior.
- As of 2026-05-26, `/repository` (now visibly named "管理员中心") should no longer act as a general maintenance dashboard or full-dictionary browser. The user explicitly asked to remove everything except the current human-facing work piles from the visible repository page, including the workload component. Keep background data, logs, helper functions, and recoverable direct workflows if useful, but do not show the workload panel, full dictionary/category/letter filters, import/repair/new-word shortcuts, route-fill package, or stacked maintenance panels inside the visible admin center unless the user asks to bring one back.
- As of 2026-05-28, the visible `/repository` admin center no longer shows the old top work-pile chips `待救援`, `已修复`, and `PDF人工`; those modules were removed as no longer useful. The visible default repository scope is the missing-card word list rather than the old rescue/PDF work piles.
- As of 2026-05-27, the visible `/repository` admin center search bar is a global word search, not a current-list filter. Typing searches all words through `/api/word-search`, keeps the selected list/level unchanged, and clicking a result opens the normal word-card popup/tray in place.
- As of 2026-05-28, `/repository` also has a local-only word-card statistics panel. It shows missing-card word count and existing-card word count using the active-card definition `MnemonicEntry.status != ARCHIVED`. Missing-card stats must be broken down by vocabulary category, for example `二级 missing/total`, `三级 missing/total`, etc.; each category link routes to the same admin word-list surface with `scope=missingCards&level=<category-slug>`, and clicking a listed word must open the normal word-card popup/tray.
- As of 2026-05-29, `/repository` has an admin-only `scope=labelArtifactCleanup` word pack labeled `OCR/逻辑清理词包`. It is built from `AuditLog.action = MNEMONIC_LABEL_ARTIFACT_CLEANUP` on `entityType = MnemonicEntry`, plus the focused `glare`-like logic review set in `tmp/glare-like-logic-audit/latest.json`. The pack currently deduplicates to 44 words: the original 29-word `glare` same-batch cleanup/rewrite set plus all 18 glare-like logic findings, with overlaps such as `glare`, `gland`, and `tan` counted once. This pack must stay on the ordinary word-list surface (`mn-level-word-grid` / `mn-level-word-card` or normal list rows) and each word must open the normal word-card popup/tray; do not turn it into a separate dense admin table or custom preview layout.
- In the `OCR/逻辑清理词包`, the small `X` on a word card is not a repository delete control. It only records `AuditLog.action = REPOSITORY_LABEL_ARTIFACT_CLEANUP_PACK_EXCLUDE` on `entityType = Word` and removes that word from this pack; the `Word`, its `MnemonicEntry` cards, links, review data, and normal word-page visibility must remain intact. The same rule applies to the list-view bulk control for this pack: it should say/remove from pack, not delete words. Ordinary repository scopes may keep their explicit delete behavior.
- As of 2026-05-28, the `/repository` backend/account metric strip should support "查看详情" inside the admin center. Clicking account-total or account-related cards opens a quiet account-detail table on the same page through `account=<detail-scope>`, showing account identity, role/status, user-card counts, learning counts, contribution counts, and timestamps. Do not send the user back to the old `/admin/users` surface for this overview.
- As of 2026-05-28, the `/repository` global search input must not float above word-card popups. When any `MemoryCardTray` word card is open, close/hide the repository search field and popover and blur the search input so the word card is visually unobstructed.
- As of 2026-05-26, repository work-pile cards should support a quiet pass marker: a small check control marks "我觉得可以通过" for the current scope, persisted through repository review-pass audit actions. Repository and similar repair panes should default to keyboard review flow: left/right selects previous/next word, Space opens the selected word card when focus is not already on a control, and Esc closes the open word-card popup. Do not add visible shortcut explanations unless the user asks.
- As of 2026-05-26, edit modes should default to a 3-second autosave plus an explicit manual-save marker/status. When a persisted edit surface changes, debounce backend autosave for 3 seconds, show saving/saved/error state, and keep a clear manual save control/indicator so the user never has to guess whether content was saved. For new records without a persisted id yet, autosave may create the record and then continue editing that same record. Apply this convention to future repair panes and card/meaning editors unless the user explicitly requests a different save model.
- The PDF source-fill manual review batch uses `AuditLog.action = PDF_SOURCE_CARD_FILL_MANUAL_REVIEW` on `entityType = Word`. The mutual-related-link rescue batch uses `AuditLog.action = MNEMONIC_LINK_CYCLE_RESCUE_REVIEW` on `entityType = Word`, excluding words that also have `AuditLog.action = MNEMONIC_LINK_CYCLE_RESCUE_DONE`. The restored rescue batch uses `MNEMONIC_LINK_CYCLE_RESCUE_DONE` to show words already repaired by the 2026-05-26 rescue restore pass. The restore marker was `Codex link-cycle rescue restore 2026-05-26`; it restored 14 archived/no-active official cards, rewrote 30 active PDF reverse-cycle cards into standalone/root/stem cards with no `[[word:...]]` related links, and left 28 words in the rescue scope for later review.
- As of 2026-05-25, future missing-card route-fill tasks ("旧词记新词", "缺卡补全", "route-fill", user-provided pairs like "quarrel记住quarrelsome", "biochemistry记住biochemist", "current记住concurrent", "military记住militant", "portray/portrait记住portrayal", "actual记住actuality", "attend记住attendance", "courage记住courageous", "modern记住modernize", or "leader记住leadership", or similar high-confidence derivation/prefix/suffix/spelling/embedded-familiar-word/shared-root-stem/reverse-word-family/shape/meaning-extension cleanup) must use the Codex skill at `/Users/mr.mao/.codex/skills/mnemonic-route-fill/SKILL.md`. That workflow is local-only, backup-first, dry-run-first, fills only `confidence >= 0.85`, puts all other missing cards into review, does not include example sentences inside mnemonic content, and marks generated official entries with `Codex route-fill:`. Explicit user-provided routes should be treated as direct candidates: if the target is missing a card, the base exists, and the relationship is natural (for example `quarrel -> quarrelsome` via `-some`, `biochemistry -> biochemist` via the `-istry/-ist` word family, `current -> concurrent` via `con-` + `current`, `military -> militant` via the shared `mili-/milit-` military/war stem, `portray -> portrayal` via verb + noun-forming `-al`, `actual -> actuality` via `-ity`, `attend -> attendance` via `-ance`, `courage -> courageous` via `-ous`, `modern -> modernize` via `-ize`, or `leader -> leadership` via `-ship`), add the card; if the target already has a normal card, do not overwrite it and report that it already exists. Do not limit automatic scanning to cases where the target is longer than the base or is only a plain prefix/suffix addition; also search familiar longer base words, embedded familiar words, shared root/stem families, verb-to-noun `-al`, `-ity/-cy`, `-ance/-ence`, `-ous/-ic`, `-ize/-en`, `-ship/-hood`, `-ant/-ent` transformations, and light spelling transformations, but only when the meaning route is obvious and not a forced story. Same-family helper words such as `portrait` for `portrayal` may be added to the final `相关单词` block when they strengthen memory, but do not present helper words as direct etymology or force a route. False-friend-looking pairs such as `ponderous <- ponder`, `heraldic <- herald`, or `stringent <- string` must stay in review unless a clearer base route is found.
- As of 2026-05-28, new-base expansion must affect only words that currently have no active mnemonic card. For example, adding or approving `joy` may generate route-fill candidates such as `enjoy`, `joyful`, or `joyfully`, but if `joyful` already has an active card, that existing `joyful` card must not be rewritten, relinked, replaced, reordered, or otherwise influenced by the newly added `joy` route. The new base can only create cards for missing-card targets, such as using `joy` to fill a missing `enjoy` card when the `en- + joy` route is natural. Existing normal cards are protected even if a newer base word would provide a cleaner route.
- As of 2026-05-28, route-fill capability boundaries should be explicit when implementing or reviewing new-base expansion. It may automatically accept only mechanical, learner-visible word-family routes where form and meaning both line up: meaningful prefix additions such as `able -> unable/enable/disable`, `understand -> misunderstand`, `use -> reuse/misuse`, and `connect -> disconnect/reconnect`; stable suffix or spelling transformations such as `able -> ability/ably`, `create -> creator/creation/creative`, `develop -> development`, `enjoy -> enjoyment/enjoyable`, and `happy -> happiness`; person/agent routes and their safe reverse direction such as `sing <-> singer`, `dance <-> dancer`, `create <-> creator`, when the target side is missing a card; and ordinary spelling changes such as dropped final `e`, `y -> i`, or doubled consonants. It must not auto-fill routes based only on contained letters or loose semantic similarity, for example `able -> table/stable/fable`, `able -> capable`, `rest -> restaurant`, or any route that needs remote etymology to sound convincing. Multi-step routes should be generated through their natural intermediate base rather than jumping too far, for example prefer `enable -> enablement` over direct `able -> enablement`.
- As of 2026-05-28, AI-generated route-fill/new-base expansion cards should not silently become normal official cards. Because this content is written by AI, add an administrator-only human review layer before final publication: future implementations should provide an "AI 单词延伸单词卡审核" surface inside `/repository`/管理员中心 where generated extension cards can be inspected, opened in the normal word-card popup/editor, approved, rejected, or sent back for manual editing. During the trial phase, this workflow should be available only to administrator accounts, not ordinary users or broad public contribution flows.
- As of 2026-05-28, the local AI extension route-fill batch must be handled by Codex manual pre-review, not by dumping 1000+ drafts on the user and not by rule-script triage. The over-broad quarantine was corrected: 13 user-approved AI extension official cards were restored to active `APPROVED` cards, their drafts were restored to `SAVED`, and then Codex manually reviewed the 1325 unapproved compact draft records for route logic, target-meaning fit, and readable phrasing. 422 cards judged readable/logically connected were promoted back to `DRAFT` for user review; the other 903 remain `DISCARDED` and should be treated as unwanted unless the user explicitly asks to revisit them. New automatic generation remains paused, but manually reviewing and approving the currently promoted batch is allowed.
- Future AI extension/new-base work must treat route and meaning as two separate gates. A visible spelling relation is not enough. The base route must naturally explain the target's actual core meaning, and the target Chinese meaning must be source-verified or manually corrected before the card can become official. Example failure: `liberal -> illiberal` via `il-` may explain a "not liberal / not free / not open-minded" direction, but it must not directly claim unrelated or unverified Chinese glosses such as `狭隘的；无教养的；吝啬的` unless that sense is explicitly checked and the memory route explains it.
- Prefix-route AI generation is especially high risk. Do not use a bypass like "some Chinese characters overlap" to accept prefix candidates. For prefixes such as `un-/in-/im-/il-/ir-/non-/dis-/mis-/re-/over-/under-/inter-/en-`, the prefix meaning itself must visibly fit the target meaning, and the base word must actually help remember that meaning. Otherwise reject/keep out of the AI extension queue.
- As of 2026-05-28, the preferred trial UX for new-base expansion is inline with the word-card editing page rather than a separate noisy generator page. When an administrator finishes writing or saving a brand-new base word card such as `able`, the editor may show a quiet row of small clickable candidate chips/buttons for missing-card extension targets such as `ability`, `enable`, or `disable`. These controls should feel like light related-word jump/generate actions, not a large modal or marketing panel. Clicking a candidate should let the admin inspect the candidate route and proposed card; if acceptable, the admin can create/send it into the AI extension review flow with one clear action. The candidate list must still obey all existing route-fill rules: only missing-card targets, no overwriting existing active cards, no loose contained-letter routes, and no direct publication without human review.
- Current local trial implementation of AI extension review uses existing `ImportDraft` rows rather than a new table: generated extension drafts have `source = "ai-extension-route-fill"` and `status = DRAFT`; approving one creates an official `MnemonicEntry` only after rechecking that the target still has no active card, marks the entry with `Codex route-fill: ...; ai-extension-review`, syncs wiki links, and updates the draft to `SAVED`; rejecting updates the draft to `DISCARDED`. Keep this provenance if the feature is later promoted into a dedicated schema.
- AI extension review drafts should render as proposed word-card previews, using the same memory-card reading styles, editable-card behavior, and rendered wiki links as normal word cards. Do not show raw admin rows, plain Markdown blocks, or the ordinary missing-word grid inside the `AI延伸待审` scope; that scope is for reviewing and rewriting the generated card draft itself, not opening a blank target word card. The reviewer must be able to click the pencil/edit control, rewrite the AI draft in-place, autosave or manually save the draft, and only then approve it into an official card.
- AI extension route-fill draft content should use this reusable card template. The `例：` block means affix/construction examples, not sentence examples; do not add an `例句：` section inside mnemonic card content.

```markdown
带你背：

[base_word] 为已经记忆过的单词，表示 [base_meaning]；
[target_word] 可以通过 [base_word] 来记：
[说明构词 / 拼写 / 词义变化逻辑]。
由此记住 [target_word] 表示 [target_meaning]。

词根词缀积累：

[词缀 / 构词点说明]

例：
[example_1]（中文）
[example_2]（中文）
[example_3]（中文）

相关单词：
[[word:base_word]]
[[word:optional_helper_word]]
```

- As of 2026-05-28, bulk AI extension scanning is supported by `scripts/create-ai-extension-review-batch.ts`. It scans base words that already have active cards against missing-card target words, applies mechanical prefix/suffix/spelling/reverse-agent rules plus Chinese-meaning alignment filtering, and writes only `ImportDraft` rows with `source = "ai-extension-route-fill"` when run with `--apply`. The first batch wrote 1337 drafts and 1337 audit logs with action `AI_EXTENSION_ROUTE_FILL_BATCH_DRAFT_CREATE`; `absurd -> absurdity` is included. The review page paginates AI extension drafts at 120 compact modules per page and should show the true total count, not only the currently loaded page.
- AI extension review should not default to a page full of huge expanded word-card previews. The default review view should be compact: each generated word occupies a small module showing the target, base route, meaning, split/rule, and confidence. Opening/clicking that module should open a normal fixed word-card popup/tray, matching the usual word-card display logic instead of expanding inline and pushing the list around. Approve/reject controls live inside that popup. The normal page should stay scannable when hundreds or thousands of generated drafts are waiting. Future word/card display logic should reference the normal word page popup/tray behavior first, not invent a separate oversized display pattern for each admin workflow.
- Expanded AI extension draft previews should use normal word-card sizing, roughly the same constrained width and viewport-contained height as the existing word-card popup, not a full-width or over-tall giant card. Long draft content should scroll inside the card popup.
- As of 2026-05-28, related word links inside the AI extension draft popup must open that related word's normal word-card popup/tray in place, not navigate away and not show a smaller plain info popover. The reviewer should be able to close the related word card and return to the same AI extension draft popup.
- As of 2026-05-28, AI extension draft `splitText` must be the target word's own pipe-separated spelling split, for example `strang | le`. It must not contain route-operation notation such as `base + -y`, `base - e + -ant`, arrows, plus signs, Chinese explanation, or suffix hyphens. Parenthetical letter hints are allowed when they are part of the top split itself, for example `sym｜(m)m｜etry`; validation should treat parenthetical letters as optional, because some indicate a doubled/echoed spelling hint and some indicate a letter not counted in the final spelling. If the split cannot normalize back to the target word after removing separators and resolving parenthetical letters as optional, leave it empty rather than showing a misleading construction formula.
- AI extension review keyboard flow is required: left/right arrows switch the selected draft and, when a card popup is open, switch the open card; Space opens the selected draft when closed and closes the popup when open; Esc closes the popup; Enter approves the open draft into an official card, then automatically advances to the next draft. Approval must be undoable from the review flow, restoring the draft to pending review and removing the generated card from active display. Do not hijack shortcuts while the user is typing or while a button/link/form control is handling its own native Enter/Space action.
- Route-fill/new-base expansion decisions should use this decision record before writing:

```json
{
  "target_word": "",
  "can_use_known_word_method": true,
  "base_word": "",
  "route_type": "suffix / spelling / derivation / meaning_extension / shape",
  "confidence": 0.0,
  "reason": ""
}
```

- Only write a formal card when all three conditions hold: `base_word` and `target_word` have a clear visible form relationship; the construction/spelling/meaning change can be explained in one natural sentence; the Chinese meanings connect directly without a forced story. If the word only looks somewhat similar, needs remote etymology, or the meaning does not land cleanly, keep it in review.
- As of 2026-05-28, standalone AI-written scene cards requested by the user should not be placed in `AI延伸待审`, because that queue specifically means route-fill/new-base extension review. Use a separate administrator-center place named `AI生成单词卡`, backed by `ImportDraft.source = "ai-generated-word-card"` and `status = DRAFT`, for user-requested AI-generated word-card batches. These cards must remain drafts until the user personally reviews and explicitly approves publication; do not auto-convert them into active `MnemonicEntry` cards or publish them in bulk. After the user pointed out that this page had no review button, the required review UX is explicit: opening an AI-generated draft card must expose `审核通过` and `驳回` actions, allow the admin to edit/save the draft before approval, disable approval if the target word already has an active card, and make manual approval undoable by restoring the draft to `DRAFT` and archiving the generated official card.
- As of 2026-05-28, the standalone AI-generated scene-card workflow is also formalized as the local Codex skill `/Users/mr.mao/.codex/skills/ai-generated-word-cards/SKILL.md`. Future requests such as "AI生成单词卡", "给缺卡词生成可选图片单词卡", "放到管理员中心等我查看", or similar scene/image-based Chinese mnemonic-card batches must use that skill. Keep it distinct from `/Users/mr.mao/.codex/skills/mnemonic-route-fill/SKILL.md`: route-fill is for mechanical known-word extensions, while `AI生成单词卡` is for standalone scene cards stored in `ImportDraft.source = "ai-generated-word-card"`.
- As of 2026-05-28, all English-word display surfaces should use the normal word page as the standard display logic, not one-off custom tiles. The reference surface is the ordinary level word page such as `/levels/cet6`: quiet page chrome, compact `mn-level-word-grid` / `mn-level-word-card` and `mn-level-word-list` / `mn-level-word-row` layouts, same card-opening behavior, and normal `MemoryCardTray`/word-card reading logic. This includes `AI生成单词卡`, `AI延伸待审`, administrator word lists, and personal word lists wherever they are presenting words rather than a specialized form/table. Do not invent a separate admin-only oversized display style when the standard word-page pattern can be reused.
- As of 2026-05-29, word-card edit mode must also be globally unified. Any word-card editing surface must match the normal word page / normal `MemoryCardTray` editing mode in structure, field order, spacing, controls, save/autosave behavior, rendered Markdown/wiki-link preview expectations, and permission/disabled states. This is not limited to `AI生成单词卡` or `AI延伸待审`: administrator-center draft popups, AI review queues, repaired-card review desks, personal word lists, level pages, and any future word-card popup/editor must reuse the same component or deliberately mirror the same edit-mode contract. Do not create a custom admin-only edit layout, raw Markdown-only block, giant inline editor, different action placement, or inconsistent save affordance when the normal word-page editor can support the workflow.
- As of 2026-05-29, word-card reading/display mode must be globally unified too. Every place that displays a mnemonic word card body must display it like the normal word page card: same meaning panel, `记忆卡` section, title styling, split display, Markdown/wiki-link rendering, image placement, empty-card state, scroll containment, dark/light surfaces, and compact metadata/action placement. This applies to `AI生成单词卡`, `AI延伸待审`, repaired-card review desks, repository/admin previews, search results that open cards, personal lists, level pages, and any future card popup. Workflow-specific actions such as `审核通过`, `驳回`, `撤回`, or route metadata may be added around the card, but the card body itself must reuse or mirror the normal `MemoryCardTray` reading component; do not create custom admin-only card-body layouts.
- The `ai-generated-word-cards` skill is allowed and expected to keep evolving. When the user corrects card-writing logic, scene quality, image standards, review flow, or display behavior for `AI生成单词卡`, update `/Users/mr.mao/.codex/skills/ai-generated-word-cards/SKILL.md` and this AI document in the same task.
- For `AI生成单词卡`, images are efficiency aids, not decoration. If a usable image already exists, do not delete or clear it merely because the text route can stand alone; keep the image reference because pictures speed review and memory. Generate or attach images when it is time-efficient and the scene is not misleading. Skip image generation only when it would slow the batch down, create a weak/incorrect visual route, or attach a picture to content that should stay blank. Blank/`暂不生成` drafts may keep image metadata as reusable material, but they must not become approvable just because an image exists.
- For `AI生成单词卡`, prefer using every visible element of the word when it is natural. Be sensitive to Chinese pinyin and near-sound anchors: for example `gasp` can use `gas` = 气体 and `p` as “喷”的 pinyin initial, imagining gas being sprayed/breathed out of the mouth to land on “n. 喘气；v. 喘息；渴望；气喘吁吁地说”. If the logic is wrong or forced, leave the card blank/skip it rather than writing a 牵强 bridge; `eclipse` is a warning example.
- For `AI生成单词卡` and formal mnemonic cards, explicit word links are required when a target word A is remembered through another English word/anchor B. B must be written with the system word-link syntax `[[word:B]]` or `[[word:B|label]]`, not left as plain text. But a word counts as a `熟词`/`旧词`/base anchor only when it exists in `Word` and already has at least one active, non-archived mnemonic card. Mere presence in the word table is not enough: if B has no active memory card, do not use `熟词/含义联想` or “A 基于 B” to write the card; leave the draft blank/skip it or first create/review B's own card. Example: `crumb` exists but has no active card, so `crumble` must not be written as `crumb + le`; that draft should stay `暂不生成` until a better route exists.
- The first `AI生成单词卡` batch is `cet6-scene-cards-20260528`: 10 CET6 missing-card words (`abide`, `abreast`, `baffle`, `bleak`, `clench`, `clog`, `crumble`, `eclipse`, `fling`, `gasp`) were written only as `ImportDraft` rows with `source = "ai-generated-word-card"`, not as active `MnemonicEntry` cards. After the 2026-05-28 refinement, generated images for the batch should be preserved when they exist; `gasp` uses `gas + p=喷`; `eclipse` is deliberately left blank/`暂不生成` because the previous logic was too forced; `crumble` is also left blank because `crumb` has no active memory card and cannot be treated as a familiar base. Blank AI-generated drafts must not be approvable until rewritten, though their image metadata can remain as reusable review material. Creation script: `/Users/mr.mao/Desktop/Mnemonic/scripts/create-ai-generated-word-card-batch.ts`; dry-run/apply reports and snapshots live under `/Users/mr.mao/Desktop/Mnemonic/tmp/ai-generated-word-cards/`.
- The second `AI生成单词卡` batch is `cet6-scene-cards-20260528-batch2`: 15 CET6 missing-card words (`antenna`, `beak`, `bouquet`, `cavity`, `deadlock`, `embargo`, `overflow`, `flap`, `harass`, `hose`, `hostage`, `knob`, `meadow`, `meticulous`, `mingle`) were created as `ImportDraft.source = "ai-generated-word-card"` review drafts. After user feedback, `meticulous` and `hose` have generated images; `mingle`, `hostage`, and `harass` are deliberately blank/`暂不生成` in the script because their previous routes were too jumpy or forced. The remaining pending drafts were cleaned so active-card anchors appear only in `相关单词：`, not inline in `带你背：`; linked anchors include `ant`, `bird`, `mouth`, `flower`, `cave`, `dead`, `lock`, `bar`, `go`, `over`, `flow`, `pipe`, and `water`. Creation script: `/Users/mr.mao/Desktop/Mnemonic/scripts/create-ai-generated-word-card-batch-20260528-2.ts`; dry-run/apply plans and snapshots live under `/Users/mr.mao/Desktop/Mnemonic/tmp/ai-generated-word-cards/`.
- User feedback from the second `AI生成单词卡` batch must feed future writing: avoid sound jumps like `mingle -> 混了`; if a sound bridge is used, every step must be explicit with element hints such as `捏(no)把(b)`. Do not put `[[word:...]]` links inline inside `带你背：`; mention anchors plainly in the body and put the actual links only under the dedicated `相关单词：` block. Strong scene routes such as `meticulous -> 每题扣` should get images when helpful; `meadow` improved by adding the precise cue `很多羊都(dow)在草地上咩咩(mea)叫`; `hose` works better as a personified water pipe that visibly “吼”出水 with an exaggerated image. If a user calls a route unsuitable, blank it or leave it for manual rewrite rather than patching around the weak route.
- Second-batch cleanup also showed that "almost sound-like" routes need an explicit element map before they are acceptable: `bouquet` was rewritten as `不(bou)可(quet)` plus "不可以只送一朵，要送一束花"; `cavity` was tightened to the visible `cav | ity` route from `cave`; `harass -> 哈，扰死` was blanked because the bridge was still too jumpy.
- On internal word browsing/recitation pages, the space bar is a word-card toggle shortcut: when no word card is open it opens the selected word (or the first visible word if none is selected); when a card is open it closes the active card. Do not hijack space while the user is typing or focused on buttons/links/inputs.
- On mobile level pages (`/levels/...`), the word browser should be list-first/list-only, with the traditional grid/list switching UI hidden.
- Mobile level word pages should expose global search inside the current level page, using the same `/api/word-search` backend logic. Mobile search must not route to `/search?q=...`; it displays results in the current page, and tapping a result opens that word in the existing word-card popup.
- Mobile word-card popups should keep the existing `MemoryCardTray` card mechanism. Mobile cards navigate with visible left/right arrow buttons, not swipe gestures and not invisible side tap zones, so related-word links inside the card remain tappable. Do not mark words by mobile card swipe unless the user asks to reintroduce that. While a word-card popup is open, the page behind it must not be manually scrollable or movable; the system may still auto-position the underlying selected word row/card. Mobile word-card popups should keep a fixed viewport-contained card size rather than shrinking/scaling the whole card; content should scroll inside the card.
- As of 2026-05-28, mobile word-card popups must render their text on fully opaque card, header, and scroll-content surfaces in light, dark, and system themes. Do not use translucent/glass/backdrop-filter layers for the card reading surface; the underlying word list may be dimmed, but it must not bleed through card text.
- Mobile word-card marking controls live inside the card header under the word/phonetic area: check = `熟悉/KNOWN`, circle = `模糊/FUZZY`, cross = `生词/UNKNOWN`. Mobile cards can expose compact edit controls: new-card creation uses the same logic as desktop, memory-card tabs switch cards, double-tap a tab to pin/promote it, long-press a tab to edit it, and dragging a tab out of the card deletes it through the normal permission/undo flow. Word-card switching on mobile should use the visible previous/next arrow buttons; do not use swipe gestures or invisible side tap zones because they interfere with related-word links.
- As of 2026-05-25, home supports day/night/system theme switching, including a compact mobile home theme button, and should also follow the system when `data-theme="system"`. Mobile/home search inputs must stay visually transparent inside the designed search container; do not let global dark-mode `input` fallback rules create a black rectangle in WebKit/WeChat mobile browsers. Other mobile study surfaces should not gain extra theme controls unless the user asks for them.
- As of 2026-05-27, the in-app usage manual opened from the top-bar book icon is a public user-facing "使用说明", not a developer/project manual. Keep it synchronized when adding or changing visible learner workflows, but keep it terse. The manual must be device-specific: mobile view shows only mobile learner features, and desktop view shows only desktop learner features. Do not include local-development opening instructions such as LAN URLs or `localhost`, admin center/repository/reviewer/repair workflows, internal work piles, AI/developer notes, or any other non-public product operations.
- The usage manual should auto-open only for anonymous/guest users on their first visit in that browser, tracked through local storage. Any logged-in account state must never trigger the manual automatically, though the user can still open it manually from the book icon.
- When the usage manual opens, any active search input or search result panel from home, top-bar word memory search, mobile level search, or admin global search must blur/close/hide so it cannot visually block the manual content on mobile browsers.

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
- Words listed only under `词汇扩充` are vocabulary expansion/display text, not memory anchors, and must not be promoted into `相关单词` wiki links. Add a `[[word:...]]` related-word link only when the current target word is explicitly remembered through that linked base word in the card's memory route.
- The related-word memory graph must not create dependency ping-pong. If A's card uses B as the memory base, B's card must not use A as its own memory base. For AI-generated or repaired cards that create A↔B or longer related-link cycles, preserve the direction from derived/less familiar target word to base/more familiar word; remove accidental reverse links or archive the bad reverse-generated card when the card body itself depends on the wrong direction.
- User clarification from 2026-05-26: when the user asks to handle `A 链 B、B 链 A` cycles by "择一删除", that means do not silently make a word card disappear. Prefer removing the mistaken related-word link, rewriting the card away from the reverse dependency, or moving the word into an explicit manual-review package. Archive a whole mnemonic card only when the card body itself is unsafe, and then make the affected word visible in a manual-review scope/report.
- Postmortem from 2026-05-26 PDF source-fill: a PDF source card can say a simpler/base word is remembered through a longer/derived word, such as `technique` through `technical` or `satisfy` through `satisfaction`. If the linked derived word already has an active card that remembers it through the simpler/base word, do not auto-fill the reverse PDF card as official. Put it into manual review or rewrite it from a non-cyclic base/root before publishing.
- Do not create related links for OCR ghosts, malformed fragments, or words not actually used as memory anchors.
- Do not invent source content. If uncertain, preserve less and report.
- Missing mnemonic-card images should be generated from the card's concrete mnemonic scene, not from the dictionary meaning alone. The image prompt must preserve the card's objects, action, spatial relationship, arrows/circles, and "as shown" cues as tightly as possible, while avoiding unrelated decoration, readable text, logos, and UI screenshots. The user's preferred style is realistic, emotionally exaggerated, and low-text: use cinematic/real-world scenes with strong facial expressions, body language, scale, contrast, and drama when it helps memory, while keeping readable text to a minimum or none.

### Formatting Rules For Cards

- No random line breaks.
- Single `~` characters in mnemonic text are often used for tone, sound, or OCR/source punctuation such as `嗡~`; they must render as literal text, not Markdown deletion/strikethrough. The renderer should only treat double-tilde `~~text~~` as deletion formatting.
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
- If split text cannot be made to exactly match the target word after removing separators, set it to empty/null. Parenthetical letter hints inside the top split are valid, for example `sym｜(m)m｜etry`; when checking a split with parentheses, treat each parenthetical letter group as optional and preserve the original parenthetical split if one optional-resolution path spells the target word.
- As of 2026-05-28, when the user asks to fix or scan `划分`, this means only the dedicated top split field / the initial `划分：...` line rendered before `带你背：`. Do not scan, rewrite, or treat explanatory wording inside the `带你背：` body as the split field.

### Card Writing Lessons From Full Repository Scan

As of 2026-05-28, a read-only scan reviewed all local `MnemonicEntry` rows to extract existing card-writing logic. Scan artifact: `/Users/mr.mao/Desktop/Mnemonic/tmp/card-pattern-study/latest.md`; machine-readable artifact: `/Users/mr.mao/Desktop/Mnemonic/tmp/card-pattern-study/latest.json`.

Scan baseline:

- `MnemonicEntry` total: `12833`; active non-archived entries: `12280`; active official entries: `12276`; words with at least one active card: `12259`.
- Active card length is compact: median `234` chars, p75 `286`, p90 `399`. Future normal cards should usually stay in the 200-400 character range unless the source card genuinely needs a longer scene, image, or distinction.
- Dominant sections in active cards: `带你背：` (`12205`), `相关单词：` (`9969`), `词根词缀积累：` (`5293`), `例：` (`4440`). Treat `带你背：` as the core card body and `相关单词：` as the graph/link block.
- Existing method signals: known/familiar word routes (`10478` cards), affix/root routes (`8755`), scene/mental-image routes (`3911`), sound routes (`2736`), shape/split routes (`1608`), contrast/collocation support (`1165`/`993`).
- Source-style cards often use the pattern `针对第N个元素...` (`2730` cards), `综合考虑...` (`2977`), `含义联想法` (`2037`), `谐音记忆法` (`1321`), `词根词缀分析` (`1443`), and `字形联想` (`1194`).

Practical writing rules learned from the repository:

- A good card answers one question first: "how can a Chinese learner remember this target word now?" It is not a dictionary paragraph and not a decorative story. Start from the memory route, then land on the target Chinese meaning.
- Treat the learner as a Chinese reader with zero hidden English/etymology background. Do not use an obscure English base word, root, or prefix as if the learner already knows it. If a base such as `bide` or a component such as `breast` is used, first give the learner a Chinese foothold or a visible familiar bridge, then explain why that bridge helps the target word.
- Every route step must be explicit. For example, do not jump from `a + breast` directly to "standing side by side"; say `a` can be read as "一个/一条", then connect it to "一条线", and only then explain several people's chests on one line as "并排". The memory route should show its intermediate reasoning instead of asking the learner to infer it.
- Concrete scene quality matters. When using sound/shape/meaning association, make the scene specific enough to trigger emotion, movement, and visual memory. Example standard: for `abide`, `a` means one and `bide` can sound like "拜的"; imagine one Tibetan pilgrim on the road to Lhasa repeatedly kneeling and prostrating, enduring hardship along the way, which anchors "忍受；容忍"; the viewer is moved and stops there, which anchors "停留". For `abreast`, `a` can extend from "一个" to "一条", and familiar `breast` means chest; imagine a military-training instructor requiring the line to be perfectly straight, with everyone's chests forming one straight line, which anchors "并排地".
- Prefer visible, learner-verifiable anchors: an already-known word, a familiar word block, a clear prefix/suffix/root, a stable spelling change, a useful sound cue, or a concrete scene. Do not force remote etymology, loose semantic similarity, or "contains these letters" reasoning.
- The best common shape is: `带你背：` -> explain the anchor(s) and transformation -> `综合考虑` or `由此记住` -> target meaning. If the route is word-family/route-fill, use the concise form: "`base` 为已经记忆过的单词，表示...；`suffix/prefix/spelling point`...；由此记住 `target` 表示...。"
- For source-style multi-element cards, name each element's method only when useful: `含义联想法`, `谐音记忆法`, `词根词缀分析`, `字形联想`. Then combine them once with `综合考虑`. Avoid stacking many mini-explanations if one clean anchor already explains the word.
- For route-fill/new-base cards, use mechanical and meaning-aligned transformations only: suffix, prefix, derivation, reverse word-family, shared visible stem, light spelling change, or natural meaning extension. The route must explain the target's actual Chinese meaning, not merely resemble the spelling.
- `词根词缀积累：` is valuable when the card teaches a reusable affix/stem point. Keep it short and pair it with `例：` construction examples. In AI extension cards, `例：` means affix/construction examples, not sentence examples.
- `常见搭配：`, `词义辨析：`, `对比辨析：`, and `词汇扩充：` are optional support sections. Include them only when they directly reduce confusion or improve recall. Do not add them as filler.
- `相关单词：` should contain wiki links only for real memory anchors or essential helper words used by the card. Do not link every word mentioned in prose, do not link OCR fragments, and do not create reverse dependency cycles. Direction should usually be derived/less familiar target -> base/more familiar anchor.
- `splitText` is a strict top split field, not a derivation formula. It may contain separators and optional parenthetical letter hints, but after normalization it must spell the target word; otherwise leave it empty. Body explanations may discuss transformations, but the stored split should remain the target spelling split.
- Images are useful only when they depict the card's concrete memory scene. Existing active cards include hundreds of image-backed mnemonics, but future image prompts must preserve the objects/action/spatial relation of the mnemonic route, not merely illustrate the dictionary meaning.
- Existing legacy/source cards may contain `例句：` in `contentMarkdown`, but future AI-generated, route-fill, and repaired cards should not add sentence examples inside `MnemonicEntry.contentMarkdown`. Sentence examples belong to `Word.exampleSentence` and `Word.exampleTranslation`; construction examples under `例：` are acceptable when they teach the affix or pattern.
- Tone should be concise Chinese teacher language: direct, accurate, slightly vivid when a scene helps memory, and never AI-flavored. Avoid padding such as "这个单词很重要", vague encouragement, unsupported claims, or invented source facts.
- If a route fails any of these gates, leave it blank or send it to review: visible form relation, direct meaning fit, source/meaning verification, no cross-card contamination, no related-link cycle, no misleading split, no example leakage.

### Word Card UI Behavior

- Word cards should open as word-card popups/trays, not as full page navigation, unless the user explicitly asks for a separate page.
- The current popup path uses `/api/word-card/:slug` and `MemoryCardTray`.
- Reuse `WordCardPopupButton` or the existing popup-fetch pattern when adding new word opening behavior.
- Dedicated browsing surfaces, such as Codex repaired cards, should open the same word-card popup.
- Personal-center word-card behavior must stay synchronized across all three state lists: `熟练`, `模糊`, and `生词本`. Any shortcut, button, navigation, undo, mark, delete, restore, open, close, or save-status change added to one of these lists must be added to the other two in the same change.
- Shared word-card popup behavior must also stay synchronized with the level/word browsing surface (`LevelWordBrowser`) when the same operation exists there.
- Keyboard contract: opened word-card popups support `← / →` circular previous/next navigation, `V / O / X` marking as known/fuzzy/unknown, and undo via `Shift+R` plus `⌘Z`/`Ctrl+Z`. Same-state keys must behave like pressing the active mark button again: pressing `X` while a word is already in `生词本`, `O` while already in `模糊`, or `V` while already in `熟练` cancels that mark.
- Selection follow contract: when a word-card popup opens, switches with `← / →`, or closes, the corresponding word tile/row in the underlying list must show the blue selected outline. The popup/card tray itself must not show a blue focus outline. If the selected word is below or above the current viewport, the page must scroll the list so the selected tile/row follows into view and lands around the page center. This applies to `/me/known`, `/me/fuzzy`, `/me/unknown`, and shared level browsing surfaces.
- Verification contract: for personal-center word-card changes, test `/me/known`, `/me/fuzzy`, and `/me/unknown` separately. A passing test in only one list is not enough.

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

## Local Development Startup And Browser Opening

When the user asks to open the local website (`本地`, `打开网站`, `打开本地网站`), do not run `next dev` directly. Always use the project startup wrapper:

```bash
npm run dev
```

Current behavior:

- `npm run dev` runs `node scripts/dev-open.mjs --no-open`.
- `npm run dev:open` runs the same wrapper and also opens the OS default browser.
- The local app URL is `http://localhost:3001/`.
- In Codex, prefer `npm run dev` and then open/show `http://localhost:3001/` in the in-app browser.

Why this matters: the level pages depend on local PostgreSQL. If an agent starts only Next.js while Postgres is stopped, `/levels/cet6` and similar pages render "本地数据库未连接" / "暂时无法读取词库". That is a startup failure, not a level-page UI bug.

The startup wrapper handles the required database setup before launching Next:

- reads `DATABASE_URL` from the environment, `.env.local`, or `.env`;
- checks whether the local database target is reachable;
- if local Postgres is not reachable and Docker is stopped on macOS, opens `/Applications/Docker.app` and waits for Docker;
- runs `docker compose up -d postgres`;
- waits for the `mnemonic-postgres` container to accept connections;
- runs `prisma generate`;
- runs `prisma migrate deploy`;
- seeds only when the `Word` table is empty, so existing local data is not duplicated.

Correct verification after opening:

```bash
docker compose ps
curl -fsS http://localhost:3001/api/word-card/memory | head -c 300
curl -fsS -I http://localhost:3001/levels/cet6
```

The `mnemonic-postgres` container should be `healthy`, and `http://localhost:3001/levels/cet6` should show the word list/count instead of "本地数据库未连接". In the current local database, a healthy full dataset has roughly 41k words.

Opening lesson from 2026-05-29: do not treat homepage `200 OK` as a successful local-site handoff. The homepage can render while PostgreSQL is down, but login, `/me`, level pages, and word-card APIs will fail with Prisma errors such as `Can't reach database server at localhost:5432`. Before telling the user the local website is ready, verify at least one database-backed route or API. Preferred quick checks are `docker compose ps`, `/api/word-card/memory`, `/levels/cet6`, and, when the user showed a login error, an actual local seed-account login that reaches `/me`.

If `http://localhost:3001/` is already listening but database-backed pages fail, do not only reload the browser and do not call the app "opened". Check whether Docker/Postgres stopped after the dev server was launched. Start Docker Desktop if needed, run `docker compose up -d postgres`, wait until `mnemonic-postgres` is `healthy`, then retry the database-backed checks. If the Next process was started outside the wrapper, replace it with `npm run dev` so future restarts keep the database preparation path.

If an agent intentionally needs to skip database startup, it may use `node scripts/dev-open.mjs --skip-db`, but it must expect database-backed pages to show unavailable states. Do not use `--skip-db` when the user simply wants the website opened.

## Logic-Audit Card Repair Workflow

The user requested a durable workflow for repairing the remaining words in the repository logic-audit summary. The scope is the "剩余" words in the 单词仓库 logic audit panel: words present in `tmp/mnemonic-logic-audit/latest.json` issues and not currently listed in `fixedWordIds`.

Hard workflow requirements from the user:

- Read the card before changing it. Do not modify from the issue title alone.
- Repair one word/card at a time, with manual judgment for that card.
- Do not invent broad rules and then apply them in bulk.
- Do not do blanket regex rewrite of card bodies as a substitute for reading.
- Preserve card quality and compare against already-passed cards when format is uncertain.
- Detect and repair logic errors, OCR errors, simplified/traditional Chinese mix-ups, and format errors, but do not limit review only to those categories.
- After all repairs are done, summarize the changes made.

Helper workflow script:

```bash
npm run logic-audit:repair -- status
npm run logic-audit:repair -- next --limit=8 --out=tmp/logic-audit-card-repair/next.json
npm run logic-audit:repair -- apply --input=tmp/logic-audit-card-repair/repair-plan.json
```

The helper script is intentionally not a bulk fixer:

- `status` reports current remaining/fixed counts.
- `next` exports the next highest-priority remaining words with full issue evidence, current card markdown, dictionary fields, examples, related-word block, attention hints for traditional/OCR artifacts, and a `beforeHash`.
- The AI/human must then read each exported word one by one and write explicit per-word repair decisions into an apply JSON.
- `apply` verifies `beforeHash`, backs up every touched entry under `tmp/logic-audit-card-repair/backups/`, writes `MnemonicEntryVersion`, regenerates `contentHtml`/`plainText`, syncs wiki links, records `AuditLog`, and marks the word fixed only for explicit `repaired` or `confirmed_ok` decisions.
- If the current card is already clean and the old issue is stale, use `confirmed_ok` with a reason rather than making cosmetic edits.
- If the word cannot be repaired confidently, use `skipped`; do not mark fixed.

Current local status when the workflow was created on 2026-05-25:

- raw logic-audit issue rows: 2112
- unique issue words: 1853
- fixed issue words: 616
- remaining issue words: 1237
- next priority starts with P1 words such as `invalid`, `irony`, and `irrespective`.

Automation notes from 2026-05-25:

- The cron automation named `Logic audit card repair` was deleted because it opened many separate Codex task windows and used English prompts.
- Replacement follow-up: current-thread heartbeat named `单词卡逻辑修复跟进`.
- Cadence: every 1 minute in the current thread.
- It may check every minute, but it must not start overlapping work. A new batch may begin only after the previous batch has finished and reported results in the current thread.
- It must use Chinese, stay in the same conversation, and process only small batches with per-word reading/judgment.
- Efficiency update from 2026-05-25: for this current-thread repair workflow, default to about 12 words per completed round; if the exported words are low-risk split/derivation/OCR fixes, it is acceptable to handle up to 16 in one round. This is only a batching/verification efficiency change: each word still requires full card/evidence/dictionary/example/related-word reading, and no broad rule-based body rewrite is allowed.
- Efficiency is allowed in mechanical checks: combine JSON validation, split sanity checks, related-word existence lookup, status checks, and representative `/api/word-card/:slug` reads into fixed commands/scripts. Do not automate the actual prose repair decision.
- Each batch must output changed words, confirmed-ok words, skipped words, backup/run report paths, and remaining count.
- User feedback on 2026-05-25: do not create automation behavior that opens many separate Codex windows/tasks when the user expects work to continue in the same conversation. Do not write automation prompts/output in English for this Chinese project workflow; use Chinese unless the user asks otherwise.
- For logic-audit card repair, prefer continuing in the current thread or using a manually triggered single run. Do not re-enable a cron automation unless the user explicitly asks for separate background task windows.

## Production Server Access

This project is deployed on the user's Tencent Cloud Lighthouse server. Future AI agents may use this section to connect and operate the server when the user asks for deployment, database migration, logs, or production debugging.

Do not write private keys, database passwords, `.env` contents, or dump files into Git. The information below intentionally includes only connection metadata, a local private-key path, and the registered public key.

Server:

- Provider: Tencent Cloud Lighthouse
- OS: Ubuntu 22.04
- Public IP: `124.221.123.13`
- SSH user: `ubuntu`
- Preferred SSH private key path on the user's Mac: `/Users/mr.mao/.ssh/mnemonic_tencent_lighthouse`
- Legacy SSH private key path from older notes: `/Users/mr.mao/Downloads/123.pem` (missing on 2026-05-23)
- Registered SSH public keys:

```text
ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCYlDj8rPeV8tHO6C01IhsXV1T13Qfbj+7XHvZvoSJQ+yqdwGbA1OHbBVmev/6sO7+4k0R+SRRBbt/d8c8vWibp3tkTN5axjEoAnX/y7KqWtjW92g3D+ruXkqpe2adGA7djMsOTVtwjt1zB7RDp7NzG+w66v+7aRqFX5uUtEQ4RibNoDEnvZ4Jfx5+VyjQMh7jgVSW7xNrZIfpgRBhCHKnSKtFmLJhGezv8OBaU4hAqAXa9IowGzffPV+ojeUBYPYNLBMMyA22Q+Iq/1eSgKtnRlaw9dDmIsqthUZLDWx5vfZFhzWZhuuvAT4KsPkMT6LHOj+YRhiEocBg7Hvs6+Kc9 skey-9yox8hu9
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILVZJj5FH4bLLAupyLVxPshQvFZYZFSp9VzqgGWeE3qQ codex-mnemonic-20260523
```

SSH command:

```bash
ssh -i /Users/mr.mao/.ssh/mnemonic_tencent_lighthouse -o IdentitiesOnly=yes ubuntu@124.221.123.13
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
ssh -i /Users/mr.mao/.ssh/mnemonic_tencent_lighthouse -o IdentitiesOnly=yes ubuntu@124.221.123.13 'cd ~/Mnemonic && git status --short'
ssh -i /Users/mr.mao/.ssh/mnemonic_tencent_lighthouse -o IdentitiesOnly=yes ubuntu@124.221.123.13 'sudo systemctl status mnemonic --no-pager --full'
ssh -i /Users/mr.mao/.ssh/mnemonic_tencent_lighthouse -o IdentitiesOnly=yes ubuntu@124.221.123.13 'cd ~/Mnemonic && npm run build && sudo systemctl restart mnemonic'
ssh -i /Users/mr.mao/.ssh/mnemonic_tencent_lighthouse -o IdentitiesOnly=yes ubuntu@124.221.123.13 'journalctl -u mnemonic -n 120 --no-pager'
```

Database:

- Server database is local PostgreSQL on `127.0.0.1:5432`.
- Database name: `mnemonic`.
- Database URL is stored only in `/home/ubuntu/Mnemonic/.env`; do not copy the password into docs or chat unless the user explicitly asks.
- The server has PostgreSQL 14 installed, while local dumps may come from PostgreSQL 16. Use the Docker `postgres:16-alpine` client for PG16 custom-format dump restore.

Safe DB command pattern:

```bash
ssh -i /Users/mr.mao/.ssh/mnemonic_tencent_lighthouse -o IdentitiesOnly=yes ubuntu@124.221.123.13 \
  'cd ~/Mnemonic && set -a && . ./.env && set +a && DBURL=${DATABASE_URL%\?schema=public} && psql "$DBURL" -c "select count(*) from \"Word\";"'
```

Production data notes from 2026-05-16:

- Local database dump restored to the server successfully.
- After restore, server counts were approximately: `Word=41730`, `MnemonicEntry=7867`, `MemoryNode=8755`, `MemoryLink=7300`, `User=7`, `ImportDraft=13469`.
- `public/uploads/` is intentionally ignored by Git. When migrating/restoring DB content that references uploaded images, sync uploads separately:

```bash
rsync -av --ignore-existing \
  -e 'ssh -i /Users/mr.mao/.ssh/mnemonic_tencent_lighthouse -o IdentitiesOnly=yes' \
  public/uploads/ ubuntu@124.221.123.13:/home/ubuntu/Mnemonic/public/uploads/

ssh -i /Users/mr.mao/.ssh/mnemonic_tencent_lighthouse -o IdentitiesOnly=yes ubuntu@124.221.123.13 'sudo systemctl restart mnemonic'
```

## Fast Local-Source Sync SOP

Use this path when the user asks to synchronize "以本地为准", "最新数据和改动", "同步到 GitHub 和腾讯云", or similar. This is a full local-source sync across GitHub, local data, and the production server; it covers code, PostgreSQL data, and uploaded image files. Do not put `.env`, private keys, database passwords, dump files, `backups/`, or `public/uploads/` into Git.

Mandatory sync-method iteration rule:

- Every time code, database data, uploaded assets, or any combination of them is synchronized between local, GitHub, and Tencent Cloud, first review the previous sync records and current bottlenecks, then choose the fastest safe path for the actual change scope. Do not blindly run the full local-source sync if a narrower code-only, docs-only, uploads-only, or data-only path is sufficient and safer.
- During and after every sync, identify at least one concrete opportunity to make future syncs faster, safer, simpler, or more verifiable. If the current SOP already looks optimal, explicitly record that no better path was found and why.
- Before the final report for any sync, update this AI document with the chosen path, what was faster or safer than the previous approach, any new reusable command/path/check discovered, and any remaining bottleneck. Treat this AI-doc update as a required sync step, not optional documentation work.

Production version policy:

- Current public production version is `1.2`, set by the completed 2026-05-28 image-delivery sync.
- For every future upload/sync/deploy that changes production code, database content, or uploaded assets, increment the version by `0.1` (`1.1`, `1.2`, `1.3`, ...).
- Every future sync must record the version in this document before the final report. The record should include version, date, commit hash, GitHub push status, Tencent Cloud deployment status, local source dump path when data is restored, server pre-restore backup path when data is restored, core table counts, upload file counts, and HTTP/API health checks.

Completed sync records:

- Version `1.1`, 2026-05-28: commit `645dd34` pushed to GitHub `origin/main` via GitHub Desktop after local HTTPS/SSH CLI credentials were unavailable; Tencent Cloud `/home/ubuntu/Mnemonic` fast-forwarded to `645dd34`; `mnemonic.service` restarted and verified `active`; local preflight passed `npm run typecheck`, `git diff --check`, and `npm run build`; server passed `npm ci --no-audit --no-fund`, `npm run db:deploy` with no pending migrations, and `NODE_OPTIONS=--max_old_space_size=1536 npm run build`. Data restore was not performed because this was a code-only sync; local dump path and server pre-restore backup path are not applicable. Core table counts matched local/server: `Word=41794`, `MnemonicEntry=12817`, `MemoryNode=12911`, `MemoryLink=12270`, `User=7`, `ImportDraft=13469`. Upload file counts matched local/server: `public/uploads=757`. Health checks: homepage `http://124.221.123.13:3000/` returned `200 OK`; `/register` rendered only email, display-name, and password fields without username or verification-code fields; `/api/word-card/memory` returned real JSON.
- Version `1.2`, 2026-05-28: commit `8537bd7` pushed to GitHub `origin/main` via GitHub Desktop after CLI HTTPS credentials were still unavailable; Tencent Cloud `/home/ubuntu/Mnemonic` fast-forwarded to `8537bd7`; `mnemonic.service` and `nginx` verified `active`; local preflight passed `npm run typecheck`, `git diff --check`, `npm run build`, `npm run images:optimize`, and a renderer check that rewrote the porcelain card image to `.display.webp` while keeping `data-original-src`; server passed `npm ci --no-audit --no-fund`, `npm run db:deploy` with no pending migrations, `npm run images:optimize`, and `NODE_OPTIONS=--max_old_space_size=1536 npm run build`. Data restore was not performed because database content was unchanged; local dump path and server pre-restore backup path are not applicable. Server generated `757` WebP display variants; `public/uploads` file count became `1514` total files with `757` `.display.webp` files. Core table counts matched local/server: `Word=41794`, `MnemonicEntry=12817`, `MemoryNode=12911`, `MemoryLink=12270`, `User=7`, `ImportDraft=13469`. Health checks: homepage `http://124.221.123.13/` returned `200 OK`; `/api/word-card/porcelain` returned HTML using `/uploads/generated-mnemonic-images/porcelain-cmp6sr4g-1779620995052.display.webp` and kept the original PNG in `data-original-src`; the WebP response returned `200 OK`, `Content-Type: image/webp`, `Content-Length: 37762`, and one-year cache headers through Nginx. Nginx backup path: `/etc/nginx/backups/mnemonic-memory.bak-20260528-104201`.

Sync-method iteration records:

- Version `1.1`, 2026-05-28 improvement: classify the sync by changed surfaces before running it. For this sync, the faster safe path was `code-only` for the app change and `docs-only fast-forward` for the later AI_CONTEXT record, so future similar syncs should skip database dump/restore and `public/uploads` rsync unless schema/data/assets actually changed. Reusable check: after code-only deploy, still compare core table counts and upload counts once as a guardrail, but do not create/restore dumps. Reusable GitHub fallback: if CLI push fails with local HTTPS/SSH credential issues, use GitHub Desktop `Push origin`, then verify `git rev-parse --short HEAD` equals `git rev-parse --short origin/main`. Remaining bottleneck: GitHub CLI credentials are not configured on this Mac, so fully terminal-based sync still depends on fixing GitHub auth or using GitHub Desktop as the fallback.
- Version `1.2`, 2026-05-28 improvement: for image-delivery changes, do not rsync the whole `public/uploads` tree or restore database content when originals already match. The faster path is to commit the optimizer/rendering code, pull it on the server, run `npm run images:optimize` directly on the server's existing originals, then verify representative image byte size and download time. This avoided transferring roughly `1.3GB` of originals and produced only about `30-31MB` of display WebP derivatives. Reusable check: compare one representative before/after image through the public URL; porcelain changed from a `2,004,292` byte PNG taking about `3.656s` over the public network to a `37,762` byte WebP taking about `0.044s`. Nginx direct `/uploads/` serving with `alias /home/ubuntu/Mnemonic/public/uploads/` and one-year immutable cache is a good cheap-server baseline, but if `alias` points into `/home/ubuntu`, ensure `/home/ubuntu` has execute permission for traversal (`drwxr-x--x`) or Nginx returns `403`. Remaining bottleneck: users opening port `3000` directly still bypass Nginx cache headers, though the app now serves the much smaller WebP URL; the long-term path remains a real domain plus Tencent COS/CDN after备案.

Fastest safe order:

1. Scope and optimize the sync path: decide whether the change is docs-only, code-only, uploads-only, data-only, or full local-source sync; review the last sync record; note the fastest safe path and any expected bottleneck before running the sync.
2. Local preflight: check `git status --short --branch`, `git fetch origin`, `npm run typecheck -- --pretty false`, and `npm run build` when code changed. If `prisma/schema.prisma` changed, make sure a matching migration exists before deployment; `npx prisma migrate status` must be clean locally.
3. Commit and push code/reports to GitHub. Prefer CLI `git push origin main`; if HTTPS credentials fail on this Mac, use GitHub Desktop's `Push origin` button and then verify `git rev-parse --short HEAD` equals `git rev-parse --short origin/main`.
4. In parallel after preflight, create a local source dump and a server pre-restore backup only when database content will be restored or overwritten. The server backup must complete before any restore. Keep both dump paths in the final report and, if this is a notable production sync, record them in this document.
5. Transfer the local dump to `/home/ubuntu/Mnemonic/backups/db-dumps/` and sync `public/uploads/` with `rsync -az --delete` only when local is intentionally the source of truth. Use `--ignore-existing` only for additive image migration, not for full local-source sync.
6. On the server: stop `mnemonic.service`, `git pull --ff-only origin main`, restore the local dump over the server database with the Docker `postgres:16-alpine` client only when data restore is in scope, run `npm ci --no-audit --no-fund`, `npm run db:deploy`, `NODE_OPTIONS=--max_old_space_size=1536 npm run build`, then restart the service.
7. Verify all three layers: local/GitHub/server commit hashes match; server service is `active`; homepage returns `200 OK`; `/api/word-card/memory` returns real JSON; local and server counts match for `Word`, `MnemonicEntry`, `MemoryNode`, `MemoryLink`, `User`, and `ImportDraft` when data was synced; local and server `public/uploads` file counts match when uploads were synced.
8. Before the final report, update this document with the version/sync record and the sync-method iteration note: chosen path, improvement over the previous path, new reusable command/check if any, and unresolved bottleneck if any.

Reusable command skeleton:

```bash
# Local code verification and push
git fetch origin
git status --short --branch
npm run typecheck -- --pretty false
npm run build
git add -A
git commit -m "Sync latest mnemonic data and tools"
git push origin main

# If CLI push fails because HTTPS credentials are unavailable, push with GitHub Desktop, then verify:
git fetch origin
git rev-parse --short HEAD
git rev-parse --short origin/main
```

```bash
# Local source database dump
ts=$(date +%Y%m%d-%H%M%S)
mkdir -p backups/db-dumps
dump="backups/db-dumps/mnemonic-local-source-${ts}.dump"
docker exec mnemonic-postgres pg_dump -U mnemonic -d mnemonic -Fc --no-owner --no-acl > "$dump"
ls -lh "$dump"
```

```bash
# Server pre-restore backup
ssh -i /Users/mr.mao/.ssh/mnemonic_tencent_lighthouse -o IdentitiesOnly=yes ubuntu@124.221.123.13 \
  'cd ~/Mnemonic && mkdir -p backups/db-dumps && set -a && . ./.env && set +a && DBURL=${DATABASE_URL%\?schema=public} && ts=$(date +%Y%m%d-%H%M%S) && pg_dump "$DBURL" -Fc --no-owner --no-acl -f "backups/db-dumps/server-before-local-sync-${ts}.dump" && ls -lh "backups/db-dumps/server-before-local-sync-${ts}.dump"'
```

```bash
# Transfer local dump and uploaded files
dump=$(ls -t backups/db-dumps/mnemonic-local-source-*.dump | head -n 1)
rsync -az --stats \
  -e 'ssh -i /Users/mr.mao/.ssh/mnemonic_tencent_lighthouse -o IdentitiesOnly=yes' \
  "$dump" ubuntu@124.221.123.13:/home/ubuntu/Mnemonic/backups/db-dumps/

ssh -i /Users/mr.mao/.ssh/mnemonic_tencent_lighthouse -o IdentitiesOnly=yes ubuntu@124.221.123.13 \
  'mkdir -p /home/ubuntu/Mnemonic/public/uploads'
rsync -az --delete --stats \
  -e 'ssh -i /Users/mr.mao/.ssh/mnemonic_tencent_lighthouse -o IdentitiesOnly=yes' \
  public/uploads/ ubuntu@124.221.123.13:/home/ubuntu/Mnemonic/public/uploads/
```

```bash
# Server deploy and local-source database restore
ssh -i /Users/mr.mao/.ssh/mnemonic_tencent_lighthouse -o IdentitiesOnly=yes ubuntu@124.221.123.13 \
  'set -e; sudo systemctl stop mnemonic; cd ~/Mnemonic; git fetch origin; git pull --ff-only origin main; dump=$(ls -t backups/db-dumps/mnemonic-local-source-*.dump | head -n 1); dump_base=$(basename "$dump"); set -a; . ./.env; set +a; DBURL=${DATABASE_URL%\?schema=public}; psql "$DBURL" -v ON_ERROR_STOP=1 -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid();" >/dev/null; sudo docker run --rm --network host -v "$PWD/backups/db-dumps:/dumps:ro" -e DBURL="$DBURL" -e DUMP="$dump_base" postgres:16-alpine sh -lc '\''pg_restore --clean --if-exists --no-owner --no-acl --dbname "$DBURL" "/dumps/$DUMP"'\''; npm ci --no-audit --no-fund; npm run db:deploy; NODE_OPTIONS=--max_old_space_size=1536 npm run build; sudo systemctl restart mnemonic; sudo systemctl is-active mnemonic'
```

```bash
# Final verification
git status --short --branch
git rev-parse --short HEAD
git rev-parse --short origin/main

ssh -i /Users/mr.mao/.ssh/mnemonic_tencent_lighthouse -o IdentitiesOnly=yes ubuntu@124.221.123.13 \
  'cd ~/Mnemonic && git status --short --branch && git rev-parse --short HEAD && sudo systemctl is-active mnemonic && find public/uploads -type f | wc -l && du -sh public/uploads | awk '\''{print $1}'\'''

curl -fsS -I http://124.221.123.13:3000/ | sed -n '1,12p'
curl -fsS http://124.221.123.13:3000/api/word-card/memory | head -c 300
```

Important production gotchas:

- 2026-05-23 deployment recovery: HTTPS GitHub push was completed via GitHub Desktop, and production was recovered after an interrupted `npm install`/build caused high memory pressure. A 2GB swapfile now exists on the server at `/swapfile` and is persisted in `/etc/fstab`; keep it for future Next.js builds on this 2GB instance.
- 2026-05-23 server drift: before pulling commit `433a899`, uncommitted server-only changes were preserved with `git stash push -u -m pre-sync-20260523-server-local-changes`. Do not drop this stash unless the user explicitly confirms it is obsolete.
- 2026-05-25 local-source sync: local commit `6978416` was pushed to GitHub via GitHub Desktop because command-line HTTPS push had no usable credential. Production was then fast-forwarded to that commit, local PostgreSQL was dumped and restored over the server database, and `public/uploads/` was synced with `rsync --delete` from local to server. A server pre-restore dump was saved under `/home/ubuntu/Mnemonic/backups/db-dumps/server-before-local-sync-20260525-205628.dump`; the local source dump was `backups/db-dumps/mnemonic-local-source-20260525-205628.dump`. Post-restore production counts were `Word=41794`, `MnemonicEntry=12350`, `MemoryNode=12616`, `MemoryLink=11880`, `User=7`, `ImportDraft=13469`. `npm ci`, `npm run db:deploy`, `NODE_OPTIONS=--max_old_space_size=1536 npm run build`, and `sudo systemctl restart mnemonic` all completed; `http://124.221.123.13:3000/` returned `200 OK` and `/api/word-card/memory` returned real card data.
- Version `1.0`, 2026-05-27 local-source sync: local commit `2e92aea` was pushed to GitHub via GitHub Desktop because command-line HTTPS push had no usable credential. Production was fast-forwarded to that commit, local PostgreSQL was dumped and restored over the server database, and `public/uploads/` was synced with `rsync --delete` from local to server. A server pre-restore dump was saved under `/home/ubuntu/Mnemonic/backups/db-dumps/server-before-local-sync-20260527-215900.dump`; the local source dump was `backups/db-dumps/mnemonic-local-source-20260527-215859.dump`. Post-restore production counts were `Word=41794`, `MnemonicEntry=12817`, `MemoryNode=12911`, `MemoryLink=12270`, `User=7`, `ImportDraft=13469`. Local and server upload file counts both returned `757`. `npm ci`, `npm run db:deploy`, `NODE_OPTIONS=--max_old_space_size=1536 npm run build`, and `sudo systemctl restart mnemonic` all completed; `http://124.221.123.13:3000/` returned `200 OK` and `/api/word-card/memory` returned real card data.
- Recommended production deploy flow on this server: `sudo systemctl stop mnemonic`, `npm ci --no-audit --no-fund`, `npm run db:deploy`, `NODE_OPTIONS=--max_old_space_size=1536 npm run build`, then `sudo systemctl restart mnemonic` and verify `http://124.221.123.13:3000/`.
- The site currently runs over plain HTTP. Session cookies must not be forced to `Secure` unless `NEXT_PUBLIC_APP_URL` is HTTPS.
- When the user is looking at the public server or says the app is server-backed / synchronized across devices, local code edits and local builds are not enough. Deploy the scoped change to `/home/ubuntu/Mnemonic`, rebuild, restart `mnemonic.service`, and verify the server-rendered result before saying the UI is fixed.
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
- On `/repository`, the logic audit problem area is an English-only tile workflow: click/Space opens or closes the shared word-card tray, `← / →` switch selected problem words, and `V` marks/unmarks the current problem word. If a logic-audit word-card popup is open, `V` marks that card as repaired and automatically switches to the next problem word.
- Logic audit repair marks must save defensively: every mark still writes to localStorage immediately, and the panel also has an explicit 保存 button plus a 3-second autosave to `/api/mnemonic-logic-audit/repair-progress`, which persists `fixedWordIds` into `/Users/mr.mao/Desktop/Mnemonic/tmp/mnemonic-logic-audit/latest.json` without changing the database schema or word-card data. Writes to this JSON report must be atomic (temp file + rename) so a simultaneous page reload never reads a half-written report.

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

Current Codex P0 repair review UI:

- `/repository/codex-p0-repair` should behave as an AI review desk, not a dense data-admin table.
- Default mode is a focused one-card review flow: left side shows current website content, right side shows AI repair issue/suggestion/diff, and the bottom action bar handles `通过`, `编辑后通过`, `跳过`, and `标记严重错误`.
- A compact list mode remains available only for filtering and jumping to a card. It should show only word, simplified error type, priority, status, and an enter-review action.
- Simplified error categories are: `OCR乱码`, `错别字`, `异常换行`, `内容缺失`, `AI乱改`, `需要人工判断`.
- Review shortcuts are part of the UI contract: `A` approve, `E` edit, `S` skip, `F` severe, `←/→` previous/next.
- Editing from this review desk must save a pending review draft/status, not directly overwrite `Word` or `MnemonicEntry` formal data. The current implementation stores non-approved Codex review states in `tmp/mnemonic-logic-audit/latest.json` via `/api/codex-p0-review` and records an `AuditLog`.
- Approved state still uses `fixedWordIds` in the logic audit report; pending edited/skipped/severe states live in `codexP0ReviewStates`.
- The global site header is intentionally hidden on this route so the review desk has only its own minimal top bar.
- The review desk's `返回单词仓库` and `退出审核` links intentionally use normal `<a href="/repository">` full-page navigation instead of Next.js client `Link`, because local Next dev hot-reload can leave a stale `/repository/page.js` chunk and trigger `ChunkLoadError` when returning from this route.
- If repository-page buttons appear visually present but do nothing, check browser/network for `/_next/static/chunks/app/repository/page.js` 404. That means the local Next dev server is serving stale chunks after route/UI edits. Restart `npm run dev` and clear generated `.next` if needed before debugging button state logic.

Repository logic audit panel interaction:

- The logic-audit problem area on `/repository` should not show dense issue cards by default. Each problem word should render as a compact English-only module.
- The `123 逻辑修复复查` area on `/repository` must stay visually simple: show repaired words as compact word modules in a grid, and show the selected word's change summary in a small side pane. Do not render each repaired word as a large expanded row with multiple visible cards/sections by default; the user explicitly found that view annoying.
- Clicking an English module opens the shared `MemoryCardTray` word-card popup for that word.
- While a logic-audit word card is open, `← / →` should switch to the previous/next problem word card in the current filtered problem-word list.
- Closing the popup should leave the corresponding English module selected with the blue outline and scroll it into view, matching the outside word-card follow behavior.
- Pressing `Space` in the logic-audit problem area opens/closes the selected or active problem word card.
- Pressing `V` in the logic-audit problem area marks/unmarks the selected or active problem word as repaired.
- When a logic-audit word card popup is open, pressing `V` should mark the current card as repaired and immediately switch to the next problem word card in the current filtered list.

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
