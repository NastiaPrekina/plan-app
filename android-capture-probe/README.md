# Advisor Android v0.9 beta: normal full-screen app + reliable account binding

## What changed

- The main screen is **only the regular Advisor web app**, with its own
  navigation (Для меня, Планы, Библиотека, Поездки, etc.). The separate
  native toolbar with Advisor / Buffer / Send / Capture has been removed.
- The native capture screen appears only after Android's **Share → Advisor**
  action. It has a compact heading, close, the captured card and a save button.
- Critical offline-share fix: opening a shared Ozon/WB URL on a cold start does
  **not load or reload** the Advisor website while VPN is off. The authenticated
  page is preserved in its WebView across share intents.
- Auth fix: account verification uses a trusted **same-origin fetch inside the
  logged-in Advisor WebView** to GET /api/android-capture/session, rather than
  a separate native HTTP client that manually replays cookies. Queue syncing
  also posts via that same authenticated browser session.
- Auth verification is retried after app navigation/login and on foreground
  resume; the private queue remains strictly bound to a server-verified user ID.
  Switching accounts cannot upload the previous user's captures.
- Offline capture still uses the bundled unmodified Browser Helper parser.
  Captures are queued locally and only sent when Advisor becomes reachable.
- The normal app supports Android's system file picker for web file uploads.
- No server/database migration or change to existing Buffer save APIs.

## Testing

1. Start Advisor under VPN and sign into your normal account inside the app.
   There is **no extra native navigation bar**. The main UI is the website.
2. Turn VPN off. Share an Ozon product via Android Share → Advisor.
   The external page is parsed without contacting app.moyadvisor.online.
3. Save the card. It should say saved **on the phone**.
4. Restore VPN, open Advisor normally, and allow the app to upload its queue.
   The item should appear in the real Buffer.
5. If a queued item was left from v0.8, **do not uninstall the old APK** before
   successfully syncing it. Debug signatures can vary between Actions builds.

## Previous v0.8 notes

## VPN-independent capture

The APK **bundles the generated JavaScript from the production Browser Helper**
at build time in `app/src/main/assets/shared-parser.js`. The source snapshot
was generated directly from:
- `NastiaPrekina/personal-advisor-app` `src/features/wishlist/browser-helper/context-package.ts`
- its five shared source parser fragments (Event, Place, Trip.com and hotels)
- the canonical place classification configuration.

The APK no longer fetches `/api/android-capture/script` while capturing a
product. Future parser improvements require regenerating this asset from
the upstream source and rebuilding the APK, not writing a separate parser.

## Offline-to-Advisor workflow

1. With VPN enabled, launch **Advisor** APK, sign in to your account, and open
   the real Buffer once. This caches ONLY the last server-verified user ID.
2. Disable VPN, share pages from Ozon, Wildberries or other apps using Android
   "Поделиться → Advisor". The source page is opened and parsed locally.
3. Review the preview and tap **В очередь Буфера**. The capture is durably
   saved in Android's private app data with the verified user's ID.
4. Re-enable VPN and open **Advisor** inside the APK. The app verifies the
   authenticated account via `GET /api/android-capture/session` and sends the
   pending captures using the existing per-category Buffer APIs. The toolbar
   also offers **Отправить** for a manual retry.
5. Only after the server returns an HTTP 2xx response with a valid `saved.id`
   is an entry removed from the device. Network errors, rejections, and
   connection loss preserve it; partial batches resume later.

The server, not the client, determines the user on each write. If the
authenticated account changes, pending captures belonging to another user
stay on the device and **will not** be uploaded into the new account.
No login cookies, passwords, bearer tokens, or shared secret are persisted
in the capture queue. There is a bounded 60-card limit and source-URL
deduplication. Automatic sync requires reopening the app with connectivity,
not a continuously running Android background service.

## Release and testing

- This build changes only the APK and adds a small authenticated
  `/api/android-capture/session` route; no new DB tables or migrations.
- The production Advisor UI remains its existing web app.
- Android's WebView may fail to load an external website, even if Chrome can.
- The bundle and native app compile, but the real Android + VPN flow must
  be verified on the device.
- Android debug APK signing keys may differ between GitHub Actions runs.
  Do NOT uninstall an APK with unsent queued items: uninstall wipes the queue.
  Save them while connected to Advisor before updating. If no queue is pending,
  uninstalling an older beta and installing v0.8 is safe.
