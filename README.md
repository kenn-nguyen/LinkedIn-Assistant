# LinkedIn Outreach Assistant

Microsoft Edge Manifest V3 extension that drafts short personalized LinkedIn outreach messages by:

1. reading the active LinkedIn profile,
2. combining that context with your saved sender profile,
3. opening the ChatGPT website,
4. opening a fresh chat inside your configured ChatGPT project tab,
5. asking for a short recipient summary plus 5 ranked personalized openers in strict JSON,
6. letting you edit an opener and copy the final combined message.

## What it does

- `Generate lines` on a LinkedIn profile page
  - extracts visible recipient profile context
  - opens a fresh ChatGPT project tab and sends a strict prompt there
  - parses a recipient summary plus 5 ranked candidate openers
  - lets you edit an opener and copy the combined message with your fixed text

- `Settings`
  - lets you edit the default ChatGPT project URL used for generation
  - lets you edit the full prompt template before it is sent

- `Update My Profile` on your own LinkedIn profile page
  - extracts a fuller raw snapshot from the visible LinkedIn profile page
  - auto-saves raw profile text locally
  - lets you optionally tweak raw text and keep a short manual note

## Install in Edge

1. Open `edge://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this folder: `/Users/kennng/Documents/Linkedin-Assistant`
5. Pin the extension and open its side panel

## Current assumptions

- Edge-first MVP
- No backend and no API usage
- Uses a visible logged-in ChatGPT tab
- Opens a new background ChatGPT project tab for each generation attempt
- Stores data in `chrome.storage.local`
- Focused on drafting and copying, not auto-sending

## Identity model

- Recipient state is keyed by `personId`.
- The same `personId` must back both the LinkedIn profile page and the LinkedIn messaging page for the same person.
- Stable card content comes from the stored person record for that `personId`, including saved profile context, summaries, AI assessments, drafts, notes, goals, and thread links.
- The open LinkedIn page is used to detect fresh observations, such as new messages, updated connection status, new activity snippets, or a refreshed profile snapshot, and those observations update that same stored person record.
- Profile and messaging are two views of one person workspace, not two separate sources of truth.
- The sender's own LinkedIn profile is stored separately and is not a recipient `personId` record.
- The extension must not create or maintain a recipient person record for the user's own profile.

## Edge compatibility

- Microsoft Edge supports the same Chrome Extension APIs used here, including Manifest V3, side panel, tabs, storage, and content scripts.
- The code still uses the standard `chrome.*` extension namespace; that is correct for Edge extensions too.
- If you later want Chrome support as well, this same folder can still be loaded in Chrome without further code changes.

## Notes

- ChatGPT website automation is inherently brittle because selectors can change.
- The default ChatGPT project URL is `https://chatgpt.com/g/g-p-69cdbe678a208191a84916a6be92a7bb-ld/project` and can be changed in Settings.
- The extension retries automatically, then shows manual recovery with the exact prompt and raw output.
- The fixed tail is embedded exactly as requested.
