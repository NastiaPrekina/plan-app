# Advisor Android Capture Test (isolated prototype)

This is **not** Personal Advisor and does not connect to the production database.
This proof-of-concept tests whether an Android WebView can open pages shared
from mobile apps and read the DOM metadata needed for existing capture parsers.

## v0.4: end-to-end local pilot (one installation, batch testing)

- Shares from Android open in HTTPS-only WebView and automatically yield structured
  capture drafts, not just page metadata. Source heuristics cover Ozon, Wildberries,
  Yandex Market, Steam, Kinopoisk, LitRes, Yandex Afisha, Kassir, KudaGo and
  food establishment pages on maps (within existing Advisor category limits).
- Up to 25 recent results are persisted **only on this device**. Re-capturing a
  source replaces its previous entry. Product prices remain unverified candidates,
  and missing author/address/date fields are flagged instead of invented.
- New **История** shows results and incomplete statuses; a tap opens details.
- New **Отправить всё** shares a single local JSON attachment via the Android
  chooser, for example to Telegram or email. **JSON-файл** saves the same batch
  through Android's system file picker. No cross-device copying of 10 JSON reports.
- No login, storage permissions, production endpoints or writes to Advisor.
  The on-device history is removed if the probe app is uninstalled.
- No production user release note: all changes are in an isolated test application.

**Test flow**: install v0.4 once, then share a sample item from each source you use
(Ozon, WB, Yandex Market, Steam, Kinopoisk movie/series, LitRes book/audiobook,
events and food places). Review History; use **Отправить всё** once when done.
The bundled report includes source URL without tracking query parameters,
detected fields, missing data and proposed capture payloads. Check report
for personal information before sharing it externally.

## v0.3 diagnostic changes

- Fix Wildberries product title selection: prioritize the page's product-specific
  browser title and ignore promotional headings like "РАСПРОДАЖА" and h1 rating.
- Trim the Wildberries product ID suffix from displayed names while preserving it
  separately as `externalId`.
- Report `titleSource` and `priceObservations` with surrounding text for diagnosing
  price mismatches. The guessed price is **not** validated as the main product price.
- Keep the v0.2 Kinopoisk Movie JSON-LD image, year and genre extraction unchanged.

## v0.2 diagnostic changes

- Categorize Kinopoisk movies/series independently from products; do not treat
  streaming/rental offers like product prices.
- Read titles and image URLs from JSON-LD, using Kinopoisk's Movie entity first.
- Work around Wildberries' generic page metadata, misleading "h1" rating and
  logo image. Probe product gallery image candidates from visible DOM images.
- Keep multiple observed product prices, label them as unverified candidates;
  never imply that the first price text is always the main product's real price.
- No changes to production Advisor's parsers or UI.

## Install and use

1. Install the debug APK on a physical Android device (Android 8.0+).
2. Open a product/page in Ozon, Wildberries, Yandex Market, Kinopoisk, LitRes, etc.
3. Tap Share → Advisor · Тест захвата.
4. Wait until the page has loaded and two automated checks (about 2/6 seconds after finish).
5. Inspect "captureTitle", "captureImage", "detectedCategory",
   "capturePriceCandidate" and "imageOptions".
6. Use Copy to share a report, **after redacting any private URLs or details**.

The app also accepts a link pasted manually into the input.
It never sends capture output to Advisor. External websites still receive normal
browser traffic, just as they would in Chrome.

## Safety and scope

- Dedicated debug package online.moyadvisor.captureprobe; will not replace PWA.
- HTTPS-only, file access disabled, no JavaScript-to-native bridge.
- No login, credentials, personal data storage, backend writes, or production APIs.
- A page that works in Chrome may fail inside WebView; that is the point of the test.
- Android WebView cookie state is separate from Chrome.
- This prototype tests generic metadata only, not complete source-specific capture.
- There is no production release note: no user-facing application has changed.
