# Lumi Assist

**Version 0.1.9**

A Chrome side-panel assistant for personalized, human LinkedIn outreach and referral hunting. **Local-first, drafts only — it never sends anything for you.**

> **Chrome Web Store:** https://chromewebstore.google.com/detail/lumi-assist/dhacmggmaimafkomjfpadeagfpbjgifh

Lumi reads the LinkedIn page you're on, combines it with your saved profile, and uses a logged-in AI website (ChatGPT or Gemini) to draft a short, natural message or email that you review, edit, and copy yourself.

<!-- Screenshots — drop images in later:
![Side panel drafting a message](docs/screenshot-sidepanel.png)
![Job outreach ranked results](docs/screenshot-job-outreach.png)
![Capturing people from a job page](docs/screenshot-job-capture.png)
-->

## What it does

### ✍️ Message drafting
Drafts a LinkedIn message that fits where the conversation actually is — a first touch, a reply, or a follow-up — and reads the recent exchange rather than mechanically pushing an ask (if the other person dropped a topic, it eases off). Optional "under 300 characters" mode for connection notes.

### 📧 Email drafting
When someone is inactive on LinkedIn, draft an outreach **email** (subject + body) from the same context, so you can reach them another way. Reuses your profile and the relationship context.

### 🎯 Job outreach & referral hunting
On a LinkedIn job page:
- Run up to three keyword people-searches (A / B / C) and let the AI **rank** who's worth contacting for that specific role.
- **Capture people directly off the job page** — the "hiring team" and "people in your network" cards get a **+ Add** button; captured people show in a dedicated **Job page** tab where you can edit or add them manually. They're ranked alongside your keyword-search results.
- One-click **"Find hiring posts"** link to search LinkedIn posts where that team is talking about hiring.

### 👤 Sender profile capture
Save a snapshot of your own LinkedIn profile once; it becomes the "who's reaching out" context for every draft.

## How it works

1. You open a LinkedIn profile, thread, or job.
2. Lumi extracts the visible context and combines it with your saved sender profile.
3. It drives a **logged-in ChatGPT or Gemini tab** to generate the draft (strict JSON in, editable text out).
4. You edit and copy — Lumi never auto-sends.

> **Note:** generation works by automating the AI website in a tab, which is inherently brittle (site selectors change). Lumi retries automatically and, if it still can't parse a result, shows manual recovery with the exact prompt and raw output. An **API-based provider path is a planned direction and is not shipped yet.**

## Install (from source)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this repository's folder
5. Pin the extension and open its **side panel**

_(Once published, install from the Chrome Web Store link above instead.)_

## Quick start

1. **Set your profile** — open your own LinkedIn profile and click **Update Profile**.
2. **Open a target** — a person's profile/thread, or a job page.
3. **Draft** — click **Message** or **Email** on a person, or run **Job outreach** on a job.
4. **Edit & copy** — tweak the draft and copy it into LinkedIn / your email client.

## Settings & providers

- **AI provider** — choose ChatGPT or Gemini and set the entry URL (e.g. a ChatGPT project URL) that Lumi opens for generation. The default is configurable in Settings.
- **Prompt packs** — the prompt templates (message, email, job-outreach ranking, etc.) live in `prompt-packs/` and can be edited.
- **Character limit** — an optional "under 300 chars" toggle that constrains drafts (applies to messages and emails).

## Privacy & permissions

- **Local-first.** Your data lives in your browser — large data (contacts, run history, captures) in **IndexedDB**, small config in `chrome.storage.local`. There is **no backend and no Lumi server**.
- **Drafts only.** Lumi never sends messages, connection requests, or emails on your behalf.
- **Your AI session.** Generation uses your own logged-in ChatGPT/Gemini tab; Lumi doesn't store your AI credentials.

| Permission | Why it's used |
|---|---|
| `sidePanel` | Runs the Lumi UI as a Chrome side panel. |
| `storage` | Saves your profile, drafts, and settings locally. |
| `scripting` | Injects the LinkedIn helper scripts **on demand**, only when you're using Lumi. |
| `tabs` | Finds/opens the LinkedIn and AI-provider tabs it coordinates. |
| `activeTab` | Reads the LinkedIn page you're actively viewing. |
| `webNavigation` | Detects LinkedIn's in-app navigation so context stays in sync. |
| `clipboardWrite` | Copies a finished draft to your clipboard. |
| `host_permissions`: `www.linkedin.com` | Read LinkedIn page context and (on demand) inject the helper scripts. |
| `host_permissions`: `chatgpt.com`, `chat.openai.com`, `gemini.google.com` | Drive the AI website to generate drafts. |

## Architecture (for contributors)

Three coordinated parts:

- **Side panel** (`sidepanel.html` / `sidepanel.js` / `sidepanel.css`) — the UI: profiles, drafting, job outreach, settings.
- **Background service worker** (`background.js`) — orchestration: storage, identity resolution, provider runs, job-outreach runs, and content-script injection.
- **LinkedIn content scripts** (`linkedin-content.js`, `linkedin-commands.js`, `linkedin-library/**`, `linkedin-*-extraction.js`) — page extraction and the on-page capture buttons.

Key design points:

- **On-demand, deferred injection.** LinkedIn content scripts are **not** injected declaratively. The service worker injects them only into the focused LinkedIn tab while the side panel is open, and only **after** the page has finished loading — so opening LinkedIn tabs stays fast and the extension doesn't compete with LinkedIn's render.
- **Prompt-pack system** (`prompt-packs/default/**`) — each capability (message, email, job-outreach ranking, search URLs, post suggestions) is a template + contract loaded at runtime.
- **IndexedDB storage** with time/size-based cleanup policies for contacts, runs, and captures.
- **Tests:** `node --test tests/*.test.mjs`.

### Identity model

- Recipient state is keyed by `personId`.
- The same `personId` must back both the LinkedIn profile page and the LinkedIn messaging page for the same person.
- Stable card content comes from the stored person record for that `personId`, including saved profile context, summaries, AI assessments, drafts, notes, goals, and thread links.
- The open LinkedIn page is used to detect fresh observations, such as new messages, updated connection status, new activity snippets, or a refreshed profile snapshot, and those observations update that same stored person record.
- Profile and messaging are two views of one person workspace, not two separate sources of truth.
- The sender's own LinkedIn profile is stored separately and is not a recipient `personId` record.
- The extension must not create or maintain a recipient person record for the user's own profile.

### Chrome compatibility

- Manifest V3; uses the standard `chrome.*` namespace (side panel, tabs, storage, scripting, webNavigation, content scripts).
- The same folder should also load in Edge without code changes.

## Notes & caveats

- AI-website automation is brittle by nature — selectors on ChatGPT/Gemini can change; expect occasional manual-recovery prompts.
- Generation retries automatically before falling back to manual recovery (which shows the exact prompt and raw output).
- The "fixed tail" text you configure is appended to drafts exactly as entered.
- **Not affiliated with, endorsed by, or sponsored by LinkedIn, OpenAI, or Google.** Use it in accordance with those services' terms.
