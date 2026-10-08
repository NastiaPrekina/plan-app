# Advisor for Android: integrated Capture beta

This is the Android shell for the real `https://app.moyadvisor.online` application.

- Uses the same account and authenticated WebView cookies as the Advisor site.
- Accepts Android ACTION_SEND links from external apps.
- Loads the shared Browser Helper parser from `/api/android-capture/script` on
  the live Advisor host after an authenticated session has been established.
- Runs the shared parser in an isolated WebView on the external HTTPS page.
  No JavaScript interface or user auth cookies are exposed to those pages.
- Asks the user before sending a capture to the real Buffer. Saved cards flow
  through the exact existing user-scoped `/api/wishlist-preview/save` or
  `/api/browser-capture/{steam,screen,book,event,place,hotel}` handlers.
- Does not store an API key or service role credentials in the APK.
- Uses a new Android application ID `online.moyadvisor.app`. It can be
  installed alongside the old capture probe `online.moyadvisor.captureprobe`.
  Do not uninstall the old probe before exporting any important history.

## How to use

1. Install the APK. Open Advisor in the app and log in to your usual account.
2. Open a product, film, book, event, game or place on your Android phone.
3. Tap **Поделиться → Advisor**. The source page is parsed with the same
   code as the desktop Browser Helper. Wait for the preview.
4. Check the category, title, photo and relevant details, then tap
   **Добавить в Буфер**.
5. Advisor displays the save result and opens its real Buffer.
   Saving requires an authorized session and enabled Capture feature.
   When session expired, go back to Advisor and log in.

No backend duplicates or migrations. This shell needs the production endpoint
`/api/android-capture/script` and place/hotel Capture API routes deployed.
When unavailable it gives an explicit error, not a false save confirmation.

## Boundaries

Tested by automated Android APK compilation and server parser contracts.
Real mobile browser/Android WebView compatibility still requires on-device QA.
External pages may block WebView or not expose needed content until fully loaded.
The app intentionally never auto-saves unconfirmed cards. Main app is not
modified in the isolated plan-app prototype repository.
