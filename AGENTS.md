# Engineering Guide

Act as an excellent frontend technical lead. Write code like a disciplined technical lead. Favor a single source of truth, simple monolith-first design, clear module boundaries, and boring maintainable solutions over clever abstractions. Keep logic centralized, avoid duplicated rules and premature generalization, and make data flow explicit. Prefer small cohesive functions, stable interfaces, descriptive names, and constants over scattered magic values. Extend existing patterns before introducing new ones, keep changes incremental and backward compatible, and make failure modes visible with validation, logs, and predictable error handling. Optimize for readability, operability, and long-term maintenance.

Prefer reasonably small files. As a default, keep files within a typical few hundred lines of code; if a file grows beyond that, treat it as a signal to split responsibilities unless there is a clear reason not to.

## Product Requirements

### Person Identity Is The Source Of Truth

- Treat `personId` as the single source of truth for recipient state across the extension.
- The side panel cards on LinkedIn profile pages and LinkedIn messaging pages must render from the same stored person record when they refer to the same `personId`.
- Do not treat profile-page state and messaging-page state as separate long-lived records for the same person.

### Own Profile Is Separate

- The sender's own LinkedIn profile is a separate record and is not part of the recipient `personId` database.
- Do not create a recipient `personId` record for the user's own profile.
- Do not merge the sender profile into recipient identity resolution, tab bindings, thread bindings, drafts, or card state.
- Sender profile capture should read and write only the dedicated own-profile storage record.

### What Comes From The Database

- Stable recipient data must be read from the stored person record keyed by `personId`.
- Stable data includes prior AI assessments, generated drafts, recipient summaries, extracted profile context, saved notes, saved goals, thread links, and any other durable relationship context.
- When a page is opened, the UI should populate cards from the stored person record first, then merge in any newly observed page data if it is fresher.

### What Can Be Refreshed From The Page

- The currently open LinkedIn page may contribute newly observed data for the active `personId`.
- Page-derived updates are mainly incremental observations such as:
  - new messages
  - new activity snippets
  - new connection status
  - refreshed profile fields from an explicit profile refresh
- New page observations should update the stored record for that same `personId`, not create a separate competing record for the same real person.

### Person Id Resolution

- `personId` is resolved when a supported LinkedIn page is opened.
- On messaging pages, `personId` must also be recalculated when the user switches to a different person in the conversation list.
- Once the page resolves a person, all card state, saves, refreshes, imports, and draft generation should operate against that resolved `personId`.
- `personId` should be derived only from the clean LinkedIn `/in/<slug>/` profile slug, with noise such as query params removed.
- On messaging pages, use the slug from the messaging-surface profile URL such as `ACoAAAL64OkB7N9yWpzDPHP89H8LKcKRslC0VjM`.
- On profile pages, use the public slug such as `jameslavela`.
- Do not generate `personId` from names, thread URLs, or other fallback rules.
- Cross-surface reuse should rely on stored profile URL aliases plus the `full name + first 15 normalized characters of the headline/subtitle` signature so profile and messaging pages converge on the same record regardless of which surface was seen first.

### Cross-Surface Consistency

- If a person has both a messaging thread and a profile page, both surfaces must read and write the same stored record.
- Refreshing profile context on the profile page must make that profile context available immediately on the messaging page for the same `personId`.
- Importing or syncing messages on the messaging page must remain visible on the profile page for the same `personId`.
- The product should behave as one unified person workspace keyed by `personId`, not as separate profile and messaging workspaces.

### LinkedIn Full Profile Extraction

- Full LinkedIn profile extraction is one shared extraction workflow used by both sender own-profile capture and recipient profile capture.
- Do not maintain separate extraction rules for own profile versus recipient profile unless the difference is strictly about where the result is stored.
- Frontend architecture should treat extraction as a layered pipeline:
  - DOM extraction layer: reads LinkedIn and returns normalized raw profile fields only
  - extraction orchestration layer: controls retries, waits, scroll passes, expand passes, and extraction mode
  - persistence layer: decides whether the result is saved to own-profile storage or recipient `personId` storage
- The DOM extraction layer should not know whether the caller is own-profile capture or recipient profile refresh.
- The orchestration layer may receive mode flags such as `lightweight`, `full`, or `forceScrollPass`, but it should still call the same underlying extractor functions.
- The persistence layer should be the only layer that knows whether the extracted profile belongs to the sender record or a recipient person record.
- The shared full extraction workflow should use the existing retry-based profile extractor with full timing mode, not the lightweight page-state extractor.
- Full extraction should use a section-driven progressive scan instead of repeated top-to-bottom-to-top scrolling.
- Full extraction should first capture the top card, then scroll downward only as needed to collect missing sections, then stop when required sections are found or the page is clearly exhausted.
- Full extraction should avoid unconditional scroll-back-to-top behavior during the same extraction run.
- Full extraction should avoid multiple full-page sweeps unless a prior pass clearly failed to load required sections.
- Full extraction should prefer targeted section completion over generic "scroll everything again" retries.
- Recipient full-profile extraction should use the normal full extractor.
- Sender own-profile extraction should use the same full extractor but force the initial scroll pass so the sender snapshot is not saved from a partial top-of-page view.
- The extraction workflow should favor the same normalized fields across both cases:
  - full name
  - first name
  - clean LinkedIn profile URL
  - headline/subtitle
  - location
  - connection status when applicable
  - full raw profile snapshot
  - normalized structured profile data used to build profile memory
- Full profile extraction should use the profile page as the source of truth and should perform the full scroll pass needed to capture the complete profile context, not just the visible top card.
- Full profile extraction should be deterministic and reusable. The same profile page content should produce the same normalized extracted fields regardless of whether the caller is own-profile save or recipient-profile refresh.
- Full profile extraction should not create or mutate recipient identity by itself beyond providing clean profile evidence such as profile URL, full name, and headline.
- Full profile extraction should populate normalized structured profile data including about text, experience highlights, education highlights, activity snippets, language snippets, visible signals, profile summary, and raw snapshot.
- A recipient full-profile refresh should only be considered successful when the code path recognizes it as a full profile extraction context, not just a lightweight profile read.
- Own-profile extraction should write only to the dedicated sender profile record.
- Recipient full-profile extraction should write only to the resolved recipient `personId` record.
- Recipient full-profile extraction should update the stored profile context, profile memory, raw snapshot, recent profile changes, latest structured profile data, and mark `profileCaptureMode` as `full`.
- The full extractor should expose explicit completion signals such as:
  - top card captured
  - about captured or confirmed absent
  - experience captured or confirmed absent
  - education captured or confirmed absent
  - activity captured or confirmed absent
- The orchestrator should decide completion from those section-level signals, not from raw scroll height alone.

### LinkedIn Extraction Design

- The extension should expose three extraction products only:
  - messaging context extraction
  - profile full extraction
  - profile lightweight extraction
- The preferred frontend design for full profile extraction is:
  - Phase 1: top-card capture without scrolling
  - Phase 2: section discovery from the currently visible profile DOM
  - Phase 3: downward progressive scroll only until missing required sections are found
  - Phase 4: one final extraction pass after any inline expansions
- Messaging extraction should own messaging-specific DOM rules only:
  - recipient identity visible in the thread header
  - messaging profile URL alias
  - messaging thread URL
  - visible conversation content
- Profile extraction should own profile-page DOM rules only:
  - full structured profile fields
  - raw profile snapshot
  - activity snippets visible on the profile page
- Do not let messaging extraction and profile extraction duplicate each other's selector logic.
- Profile extraction should separate raw DOM reading from scroll strategy so selector quality can improve without changing scroll behavior.
- Scroll strategy should be stateful and goal-based:
  - track which required sections are already captured
  - only scroll for sections still missing
  - stop early when enough structured content is already present
- Expand-inline behavior should be targeted:
  - only click "see more/show more" controls that belong to profile sections still needed
  - do not run broad expansion passes repeatedly once the target sections are already captured
- `GET_PAGE_CONTEXT` should use:
  - messaging extraction on messaging pages
  - lightweight profile extraction on profile pages
- Explicit profile refresh operations should use full profile extraction, not lightweight extraction.
- Own-profile save should use full profile extraction with forced scroll.
- Recipient profile refresh should use full profile extraction and should fail clearly if LinkedIn did not reach a true full-profile extraction context.
- The output contract of profile extraction should be stable and normalized enough that callers can reuse it without post-hoc branching by caller type.
- The side panel should render from stored data first and treat extraction results as observations to merge, not as UI state assembled ad hoc in the panel.

### How To Use The Extractor

- Use messaging context extraction when the current page is a LinkedIn messaging thread and the caller needs recipient identity, messaging profile URL, thread URL, or visible conversation content.
- Use lightweight profile extraction when the caller only needs current profile-page state for page context, lightweight refresh, or quick activity sync.
- Use full profile extraction when the caller needs durable profile context that will be persisted, compared for changes, or used to rebuild profile memory.
- Use full profile extraction with forced scroll for sender own-profile capture.
- Use full profile extraction for recipient profile refresh.
- Do not use lightweight profile extraction for explicit recipient profile refresh or sender own-profile save.
- Do not call raw DOM extraction helpers directly from product workflows when an extraction product already exists for that use case.
- Do not implement full extraction as a generic "scroll to top, scroll to bottom, then scroll back to top" loop.
- Do not use scroll height stabilization as the primary definition of extraction success.
- Callers should choose the extractor by workflow intent, not by convenience:
  - page-state read -> lightweight profile extraction
  - durable profile capture -> full profile extraction
  - messaging thread read -> messaging context extraction
- After extraction returns, identity resolution and persistence should happen outside the extractor.
- The extractor should return normalized data and diagnostics; the caller should decide whether to persist, merge, ignore, or retry.

### LinkedIn Quick Activity Extraction

- Quick activity extraction is a separate lightweight workflow from full profile extraction.
- Quick activity extraction exists to refresh recent activity signals quickly without paying the cost or risk of a full profile recrawl.
- Quick activity extraction should be allowed to run off the lightweight profile page read path used for general page-state refreshes.
- The lightweight profile read path should stay fast-path oriented: if the top card already yields enough core fields, it may skip the full scroll/extract behavior.
- Quick activity extraction should only target incremental activity-oriented data such as:
  - recent activity snippets
  - latest visible posts or engagement summaries
  - recent timestamped activity evidence
  - other lightweight freshness signals already defined by the product
- Quick activity extraction should not be responsible for rebuilding the full raw profile snapshot.
- Quick activity extraction should not overwrite stable profile fields such as full name, profile URL, headline, or location unless those fields are explicitly refreshed by the full profile extraction workflow.
- Quick activity extraction should merge into the existing stored record for the resolved person and only update activity-specific fields plus associated freshness timestamps such as `latestActivitySnippets` and `lastActivitySyncedAt`.
- Quick activity extraction should be a no-op when no new activity snippets are present or when the stored activity snippets are unchanged.
- The extension should treat full profile extraction and quick activity extraction as separate operations with different cost, scope, and storage effects.

### Sidepanel Lifecycle And Off Mode

- Closing the extension sidepanel must put the LinkedIn assistant into `off` mode for LinkedIn pages.
- `Off` mode means the extension is not merely idle while still monitoring; it must stop passive page monitoring work so it does not interfere with LinkedIn or consume unnecessary CPU or memory.
- When the sidepanel is closed:
  - LinkedIn content scripts must stop mutation observers
  - LinkedIn content scripts must stop page-context change timers and deferred refresh bursts
  - LinkedIn content scripts must stop emitting `PAGE_CONTEXT_CHANGED` and click-trace notifications
  - LinkedIn page overlays owned by the extension must be hidden
  - background logic must ignore passive LinkedIn page-change events and must not fan out UI refresh messages
- Content scripts may remain injected in the page because of browser extension constraints, but they must become inert while the sidepanel is closed.
- The active/inactive state must have one source of truth in the background, driven by the sidepanel session lifecycle rather than duplicated local heuristics.
- Opening the sidepanel must reactivate the assistant and allow content scripts to resume observation for supported LinkedIn pages.
- Closing the sidepanel must deactivate the assistant without requiring a page reload.
- Activation and deactivation should be explicit lifecycle transitions, not indirect consequences of message-send failures.
- The sidepanel should establish a long-lived session connection to the background when it opens and release that session when it unloads.
- Background listeners such as tab updates, history-state changes, and passive page-context notifications must be gated by whether an active sidepanel session exists.
- In-flight passive refresh work should be ignored once the sidepanel session that started it is gone.
- Explicit user-started actions may continue if the product intentionally allows them, but passive monitoring must stay off until the sidepanel is reopened.
