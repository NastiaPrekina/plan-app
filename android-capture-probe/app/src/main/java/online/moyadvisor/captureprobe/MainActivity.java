package online.moyadvisor.captureprobe;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.content.pm.PackageManager;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import android.view.WindowManager;
import android.webkit.ValueCallback;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The ordinary Advisor web UI is the entire Android app.
 * Only Android ACTION_SEND opens a temporary native Capture overlay.
 *
 * Authentication and Buffer writes are checked INSIDE the trusted Advisor
 * WebView with same-origin fetch, never by exporting cookies to native HTTP.
 * Source websites run in a separate, JS-bridge-free WebView and never see
 * Advisor auth. The shared desktop parser is bundled for VPN-free capture.
 */
public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://app.moyadvisor.online";
    private static final String HOST = "app.moyadvisor.online";
    private static final Pattern LINK = Pattern.compile("https://[^\\s<>\"']+", Pattern.CASE_INSENSITIVE);
    private static final int FILE_PICKER_CODE = 603;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private PendingCaptureStore pending;
    private WebView advisor, source;
    private LinearLayout captureLayer;
    private TextView status;
    private ValueCallback<Uri[]> uploadCallback;
    private String parser;
    private boolean captureCompleted = false;
    private boolean captureVisible = false, sessionBusy = false, syncBusy = false;
    private int captureGeneration = 0, saveGeneration = 0, sessionGeneration = 0;
    private long lastSessionCheckAt = 0;
    private int syncedThisPass = 0;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        pending = new PendingCaptureStore(this);
        buildUi();
        // Critical: an ACTION_SEND can arrive while VPN is OFF. Never load
        // Advisor then: doing so would replace the user's working page with an
        // offline/error/login state and make previously verified auth look lost.
        if (isSharedIntent(getIntent())) {
            handleSharedIntent(getIntent());
        } else {
            openAdvisor();
        }
        handler.postDelayed(this::periodicAccountCheck, 7000);
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (isSharedIntent(intent)) handleSharedIntent(intent);
        else openAdvisor();
    }

    private boolean isSharedIntent(Intent intent) {
        return intent != null && Intent.ACTION_SEND.equals(intent.getAction());
    }

    private int dp(int number) {
        return Math.round(number * getResources().getDisplayMetrics().density);
    }

    private TextView text(String value, int size) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(Color.rgb(40, 48, 50));
        return view;
    }

    private void webSettings(WebView webview) {
        WebSettings s = webview.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportMultipleWindows(false);
        s.setSafeBrowsingEnabled(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webview, false);
        webview.setBackgroundColor(Color.WHITE);
    }

    private boolean advisorHost(String input) {
        try {
            Uri uri = Uri.parse(input);
            return "https".equalsIgnoreCase(uri.getScheme()) && HOST.equalsIgnoreCase(uri.getHost());
        } catch (Exception ignored) { return false; }
    }

    private void showExternalUrl(Uri uri) {
        if (!"https".equalsIgnoreCase(uri.getScheme())) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
        catch (Exception error) { Toast.makeText(this, "Не удалось открыть ссылку", Toast.LENGTH_SHORT).show(); }
    }

    private void buildUi() {
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        getWindow().setStatusBarColor(Color.WHITE);
        getWindow().setNavigationBarColor(Color.BLACK);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);
        setContentView(root);

        advisor = new WebView(this);
        webSettings(advisor);
        advisor.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view,
                    ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (uploadCallback != null) uploadCallback.onReceiveValue(null);
                uploadCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_PICKER_CODE);
                    return true;
                } catch (Exception exception) {
                    uploadCallback = null;
                    return false;
                }
            }
        });
        advisor.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                // A login redirect replaces the JavaScript realm. Any previous
                // session check or write is no longer authoritative.
                sessionGeneration++;
                saveGeneration++;
                sessionBusy = false;
                syncBusy = false;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                Uri uri = request.getUrl();
                if (advisorHost(uri.toString())) return false;
                showExternalUrl(uri);
                return true;
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (!advisorHost(url)) return;
                CookieManager.getInstance().flush();
                // Login is an app route/redirect. Follow it with several checks,
                // because Supabase cookies may be set AFTER onPageFinished.
                handler.postDelayed(() -> verifySession(false), 500);
                handler.postDelayed(() -> verifySession(false), 4500);
                handler.postDelayed(() -> verifySession(false), 13500);
            }
        });
        root.addView(advisor, new FrameLayout.LayoutParams(-1, -1));

        captureLayer = new LinearLayout(this);
        captureLayer.setOrientation(LinearLayout.VERTICAL);
        captureLayer.setBackgroundColor(Color.WHITE);
        captureLayer.setPadding(dp(12), dp(4), dp(12), dp(10));
        root.addView(captureLayer, new FrameLayout.LayoutParams(-1, -1));
        captureLayer.setVisibility(View.GONE);

        status = text("Получаем карточку…", 18);
        status.setGravity(Gravity.CENTER);
        status.setPadding(dp(22), dp(25), dp(22), dp(25));
        captureLayer.addView(status, new LinearLayout.LayoutParams(-1, dp(110)));

        // Source WebView is attached and laid out for dynamic product sites,
        // but covered by an opaque status layer. No preview or confirmation UI.
        FrameLayout worker = new FrameLayout(this);
        captureLayer.addView(worker, new LinearLayout.LayoutParams(-1, 0, 1));
        source = new WebView(this);
        webSettings(source);
        source.setWebChromeClient(new WebChromeClient());
        source.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                Uri target = request.getUrl();
                if ("https".equalsIgnoreCase(target.getScheme()) && !HOST.equalsIgnoreCase(target.getHost())) return false;
                finishShare(false, "Ссылку не удалось обработать. Карточка не добавлена.");
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                captureGeneration++;
                status.setText("Распознаём карточку…");
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (captureCompleted) return;
                int generation = captureGeneration;
                handler.postDelayed(() -> injectParser(generation), 350);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) finishShare(false, "Не удалось открыть страницу товара.");
            }
        });
        worker.addView(source, new FrameLayout.LayoutParams(-1, -1));
        LinearLayout overlay = new LinearLayout(this);
        overlay.setOrientation(LinearLayout.VERTICAL);
        overlay.setBackgroundColor(Color.rgb(248, 250, 249));
        overlay.setGravity(Gravity.CENTER);
        TextView hint = text("Advisor обрабатывает ссылку…", 15);
        hint.setGravity(Gravity.CENTER);
        hint.setPadding(dp(28), dp(14), dp(28), dp(14));
        overlay.addView(hint);
        worker.addView(overlay, new FrameLayout.LayoutParams(-1, -1));

    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_PICKER_CODE || uploadCallback == null) return;
        uploadCallback.onReceiveValue(
            WebChromeClient.FileChooserParams.parseResult(resultCode, data));
        uploadCallback = null;
    }

    private void showCapture(boolean visible) {
        captureVisible = visible;
        captureLayer.setVisibility(visible ? View.VISIBLE : View.GONE);
        advisor.setVisibility(visible ? View.INVISIBLE : View.VISIBLE);
    }

    private void openAdvisor() {
        showCapture(false);
        if (advisor.getUrl() == null) advisor.loadUrl(ORIGIN + "/");
        else verifySession(false);
    }

    private void leaveCapture() {
        captureGeneration++;
        captureCompleted = true;
        showCapture(false);
        // Do not fetch Advisor while VPN may be disabled.
        moveTaskToBack(true);
    }

    private String firstHttps(String text) {
        if (text == null) return null;
        Matcher matcher = LINK.matcher(text);
        if (!matcher.find()) return null;
        String result = matcher.group();
        while (result.endsWith(".") || result.endsWith(",")
                || result.endsWith(")") || result.endsWith("]")) {
            result = result.substring(0, result.length() - 1);
        }
        try {
            Uri uri = Uri.parse(result);
            return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null
                && !HOST.equalsIgnoreCase(uri.getHost()) ? result : null;
        } catch (Exception exception) { return null; }
    }

    private void handleSharedIntent(Intent intent) {
        String payload = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (payload == null || payload.isEmpty()) payload = intent.getStringExtra(Intent.EXTRA_HTML_TEXT);
        String url = firstHttps(payload);
        captureGeneration++;
        captureCompleted = false;
        showCapture(true);
        status.setText("Получаем карточку…");
        if (url == null) {
            finishShare(false, "Не удалось получить ссылку. Карточка не добавлена.");
            return;
        }
        source.loadUrl(url);
    }

    private String sharedParser() {
        if (parser != null) return parser;
        try (InputStream input = getAssets().open("shared-parser.js");
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = input.read(buf)) >= 0) {
                if (output.size() + n > 400000) throw new IllegalStateException("Слишком большой парсер");
                output.write(buf, 0, n);
            }
            String result = output.toString(StandardCharsets.UTF_8.name());
            if (!result.contains("captureForKind") || !result.contains("__paAndroidCaptureResult"))
                throw new IllegalStateException("Не найдена общая логика распознавания");
            parser = result;
            return result;
        } catch (Exception ex) {
            finishShare(false, "Не удалось обработать ссылку.");
            return null;
        }
    }

    private void injectParser(int generation) {
        if (generation != captureGeneration || !captureVisible || captureCompleted) return;
        String script = sharedParser();
        if (script == null) return;
        status.setText("Распознаём карточку…");
        source.evaluateJavascript(script, ignored -> {
            if (generation == captureGeneration && !captureCompleted) pollCapture(generation, 0);
        });
    }

    private JSONObject decoded(String value) {
        try {
            Object parsed = new JSONTokener(value).nextValue();
            return new JSONObject(parsed instanceof String ? (String) parsed : String.valueOf(parsed));
        } catch (Exception exception) { return null; }
    }

    private void pollCapture(int generation, int step) {
        if (generation != captureGeneration || !captureVisible || captureCompleted) return;
        if (step > 30) {
            finishShare(false, "Не удалось распознать карточку. Попробуйте ещё раз.");
            return;
        }
        handler.postDelayed(() -> source.evaluateJavascript(
            "JSON.stringify(window.__paAndroidCaptureResult || null)", raw -> {
                if (generation != captureGeneration || !captureVisible || captureCompleted) return;
                JSONObject result = decoded(raw);
                if (result == null || !result.optBoolean("done")) {
                    pollCapture(generation, step + 1);
                    return;
                }
                JSONObject capture = result.optJSONObject("capture");
                if (capture == null) {
                    finishShare(false, "Карточка не распознана и не добавлена.");
                    return;
                }
                Uri origin = Uri.parse(capture.optString("sourceUrl", ""));
                Uri current = Uri.parse(source.getUrl() == null ? "" : source.getUrl());
                if (!sameSourcePage(origin, current)) {
                    finishShare(false, "Ссылка не соответствует карточке. Не добавлено.");
                    return;
                }
                if (result.optBoolean("incomplete") || !validForAutomaticSave(capture)) {
                    finishShare(false, "Недостаточно данных для добавления. Карточка не сохранена.");
                    return;
                }
                enqueueAutomatically(capture);
            }), 550);
    }

    private String endpoint(String kind) {
        switch (kind) {
            case "product": return "/api/wishlist-preview/save";
            case "game": return "/api/browser-capture/steam";
            case "screen": return "/api/browser-capture/screen";
            case "book": return "/api/browser-capture/book";
            case "event": return "/api/browser-capture/event";
            case "place": return "/api/browser-capture/place";
            case "hotel": return "/api/browser-capture/hotel";
            default: return null;
        }
    }


    /**
     * No confirmation screen: only unambiguous, adequately populated cards
     * can be stored automatically. Incomplete captures fail closed.
     */
    private boolean validForAutomaticSave(JSONObject capture) {
        if (capture == null) return false;
        String kind = capture.optString("kind", "");
        String title = capture.optString("title", "").trim();
        String url = capture.optString("sourceUrl", "");
        if (endpoint(kind) == null || title.length() < 4 || title.equals("...")
                || title.equalsIgnoreCase("распродажа") || !url.startsWith("https://")) return false;
        switch (kind) {
            case "product":
                return capture.optDouble("price", 0) > 0 && !capture.optString("imageUrl").isEmpty();
            case "event":
                return !capture.optString("city").isEmpty()
                    && !capture.optString("venueName").isEmpty()
                    && !capture.optString("imageUrl").isEmpty()
                    && (!capture.optString("startDate").isEmpty()
                        || "recurring_booking".equals(capture.optString("occurrenceType")));
            case "book":
            case "screen":
            case "game":
            case "place":
            case "hotel":
                return !capture.optString("imageUrl").isEmpty();
            default: return false;
        }
    }


    private boolean sameSourcePage(Uri card, Uri page) {
        if (!"https".equalsIgnoreCase(card.getScheme()) || card.getHost() == null
                || page.getHost() == null || !card.getHost().equalsIgnoreCase(page.getHost())) return false;
        String a = card.getPath() == null ? "/" : card.getPath().replaceAll("/+$", "");
        String b = page.getPath() == null ? "/" : page.getPath().replaceAll("/+$", "");
        if (a.equals(b)) return true;
        // Some shops change human-readable slugs after redirect, retaining
        // their stable product or catalog ID. Never accept same-domain-only.
        String idA = stablePageId(a), idB = stablePageId(b);
        return !idA.isEmpty() && idA.equals(idB);
    }

    private String stablePageId(String path) {
        Matcher wb = Pattern.compile("/catalog/(\\d{6,})/", Pattern.CASE_INSENSITIVE).matcher(path);
        if (wb.find()) return wb.group(1);
        Matcher kp = Pattern.compile("/(?:film|series)/(\\d+)", Pattern.CASE_INSENSITIVE).matcher(path);
        if (kp.find()) return kp.group(1);
        Matcher steam = Pattern.compile("/app/(\\d+)", Pattern.CASE_INSENSITIVE).matcher(path);
        if (steam.find()) return steam.group(1);
        Matcher tail = Pattern.compile("(?:-|/)(\\d{6,})(?:/?$)").matcher(path);
        return tail.find() ? tail.group(1) : "";
    }

    private void enqueueAutomatically(JSONObject capture) {
        String owner = pending.owner();
        if (owner.isEmpty()) {
            finishShare(false, "Не удалось сохранить: сначала войдите в Advisor.");
            return;
        }
        if (!pending.enqueue(owner, capture)) {
            finishShare(false, "Не удалось сохранить. Возможно, память очереди заполнена.");
            return;
        }
        finishShare(true, "Ссылка принята. Добавим в Буфер, когда Advisor будет доступен.");
        // When already connected, attempt immediate user-scoped upload.
        // Failure will never remove the queued card.
        if (advisorHost(advisor.getUrl())) verifySession(false);
    }

    private void finishShare(boolean accepted, String message) {
        if (captureCompleted) return;
        captureCompleted = true;
        captureGeneration++;
        status.setText(message);
        Toast.makeText(this, message, accepted ? Toast.LENGTH_SHORT : Toast.LENGTH_LONG).show();
        notifyUser(accepted ? "Сохранено на телефоне" : "Не удалось добавить",
            message, accepted ? 1201 : 1202);
        // Return to the source app without opening Advisor (VPN may be OFF).
        handler.postDelayed(() -> {
            if (captureCompleted && captureVisible) leaveCapture();
        }, accepted ? 900 : 2200);
    }

    private void notifyUser(String title, String detail, int id) {
        if (Build.VERSION.SDK_INT >= 33 &&
                checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
            return; // Toast remains available; no disruptive permission prompt.
        }
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager == null) return;
        String channel = "advisor_buffer";
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(new NotificationChannel(
                channel, "Advisor · Буфер", NotificationManager.IMPORTANCE_DEFAULT));
        }
        Notification notification = new Notification.Builder(this, channel)
            .setSmallIcon(android.R.drawable.stat_sys_upload_done)
            .setContentTitle(title)
            .setContentText(detail)
            .setStyle(new Notification.BigTextStyle().bigText(detail))
            .setAutoCancel(true)
            .build();
        manager.notify(id, notification);
    }

    private void verifySession(boolean explicit) {
        if (sessionBusy || syncBusy || !advisorHost(advisor.getUrl())) return;
        long now = System.currentTimeMillis();
        if (!explicit && now - lastSessionCheckAt < 3000) return;
        lastSessionCheckAt = now;
        sessionBusy = true;
        final int generation = ++sessionGeneration;
        final String requestId = UUID.randomUUID().toString();
        String script = "(function(){"
            + "const id=" + JSONObject.quote(requestId) + ";"
            + "window.__paAndroidSession={id:id,done:false};"
            + "fetch('/api/android-capture/session',{credentials:'same-origin',cache:'no-store'})"
            + ".then(async r=>{const data=await r.json().catch(()=>({}));"
            + "window.__paAndroidSession={id:id,done:true,ok:r.ok,status:r.status,"
            + "userId:data.userId||'',error:data.error||''};})"
            + ".catch(()=>{window.__paAndroidSession={id:id,done:true,ok:false,"
            + "status:0,error:'Нет связи с Advisor'};});"
            + "return true;})()";
        advisor.evaluateJavascript(script, ignored -> pollSession(generation, requestId, 0, explicit));
    }

    private void pollSession(int generation, String id, int step, boolean explicit) {
        if (generation != sessionGeneration) return;
        if (step > 26) {
            sessionBusy = false;
            if (explicit && captureVisible) status.setText("Сервер не ответил. Очередь не потеряна.");
            return;
        }
        handler.postDelayed(() -> advisor.evaluateJavascript(
            "JSON.stringify(window.__paAndroidSession||null)", answer -> {
                if (generation != sessionGeneration) return;
                JSONObject result = decoded(answer);
                if (result == null || !id.equals(result.optString("id")) || !result.optBoolean("done")) {
                    pollSession(generation, id, step + 1, explicit);
                    return;
                }
                sessionBusy = false;
                if (!result.optBoolean("ok")) {
                    if (explicit && captureVisible)
                        status.setText(result.optInt("status") == 401
                            ? "Войдите в Advisor с VPN. Карточки на телефоне сохранены."
                            : result.optString("error", "Соединение недоступно."));
                    return;
                }
                String verified = result.optString("userId", "");
                String prior = pending.owner();
                try { pending.setVerifiedOwner(verified); }
                catch (Exception error) {
                    if (captureVisible) status.setText("Ошибка подтверждения аккаунта.");
                    return;
                }
                if (!prior.isEmpty() && !prior.equals(verified)) {
                    if (captureVisible) status.setText("Аккаунт изменён. Очередь предыдущего пользователя не отправляется.");
                    return;
                }
                if (pending.countFor(verified) > 0) {
                    syncBusy = true;
                    syncedThisPass = 0;
                    syncOne(verified);
                } else if (explicit && captureVisible) {
                    status.setText("Аккаунт подтверждён. Ожидающих карточек нет.");
                }
            }), 430);
    }

    private void syncOne(String owner) {
        if (!syncBusy || !advisorHost(advisor.getUrl())) { syncBusy = false; return; }
        JSONObject next = pending.firstFor(owner);
        if (next == null) {
            syncBusy = false;
            if (syncedThisPass > 0) {
                String message = syncedThisPass == 1
                    ? "Карточка добавлена в Буфер." : "Добавлено в Буфер: " + syncedThisPass;
                Toast.makeText(this, message, Toast.LENGTH_LONG).show();
                notifyUser("Добавлено в Буфер", message, 1203);
                if (!captureVisible && advisor.getUrl() != null
                        && advisor.getUrl().startsWith(ORIGIN + "/capture")) advisor.reload();
            }
            return;
        }
        JSONObject capture = next.optJSONObject("capture");
        String itemId = next.optString("id");
        String path = capture == null ? null : endpoint(capture.optString("kind"));
        if (path == null || itemId.isEmpty()) {
            syncFailed("Очередная карточка повреждена или её категория не поддерживается.");
            return;
        }
        int generation = ++saveGeneration;
        String reqId = UUID.randomUUID().toString();
        String payload = "{\"capture\":" + capture.toString() + "}";
        String javascript = "(function(){const id=" + JSONObject.quote(reqId) + ";"
            + "window.__paAndroidSave={id:id,done:false};"
            + "fetch(" + JSONObject.quote(path) + ",{method:'POST',credentials:'same-origin',"
            + "headers:{'content-type':'application/json'},body:" + JSONObject.quote(payload) + "})"
            + ".then(async r=>{const body=await r.json().catch(()=>({}));"
            + "window.__paAndroidSave={id:id,done:true,ok:r.ok,savedId:body.saved?.id||'',"
            + "error:body.error||body.message||'',code:r.status};})"
            + ".catch(()=>{window.__paAndroidSave={id:id,done:true,ok:false,error:'Нет соединения'};});"
            + "return true;})()";
        advisor.evaluateJavascript(javascript, ignored ->
            pollSave(owner, itemId, reqId, generation, 0));
    }

    private void pollSave(String owner, String itemId, String reqId, int generation, int step) {
        if (!syncBusy || generation != saveGeneration) return;
        if (step > 46) { syncFailed("Нет подтверждения сервера. Повторите при подключении."); return; }
        handler.postDelayed(() -> advisor.evaluateJavascript(
            "JSON.stringify(window.__paAndroidSave||null)", raw -> {
                if (!syncBusy || generation != saveGeneration) return;
                JSONObject result = decoded(raw);
                if (result == null || !reqId.equals(result.optString("id")) || !result.optBoolean("done")) {
                    pollSave(owner, itemId, reqId, generation, step + 1);
                    return;
                }
                if (!result.optBoolean("ok") || result.optString("savedId").isEmpty()) {
                    syncFailed(result.optString("error", "Сервер не подтвердил сохранение."));
                    return;
                }
                if (!pending.remove(owner, itemId)) {
                    syncFailed("Сервер сохранил карточку, но локальная очередь не обновилась.");
                    return;
                }
                syncedThisPass++;
                syncOne(owner);
            }), 390);
    }

    private void syncFailed(String problem) {
        syncBusy = false;
        if (syncedThisPass > 0) {
            Toast.makeText(this, "Часть карточек добавлена, остальные сохраняются на телефоне", Toast.LENGTH_LONG).show();
        }
        notifyUser("Карточка ещё не отправлена",
            "Сохранили на телефоне. Повторим отправку при доступном Advisor.", 1204);
    }

    private void periodicAccountCheck() {
        // Short checks help recognize SPA login without a top native toolbar.
        // Do not generate traffic on the critical path after the account has
        // been verified and there is no pending work.
        if (!isFinishing() && !captureVisible && advisorHost(advisor.getUrl())) {
            String owner = pending.owner();
            if (owner.isEmpty() || pending.countFor(owner) > 0) verifySession(false);
        }
        if (!isFinishing()) handler.postDelayed(this::periodicAccountCheck, 10500);
    }

    @Override protected void onResume() {
        super.onResume();
        if (pending == null || advisor == null || captureVisible) return;
        if (advisor.getUrl() == null && !isSharedIntent(getIntent())) {
            advisor.loadUrl(ORIGIN + "/");
        } else {
            handler.postDelayed(() -> verifySession(false), 650);
        }
    }

    @Override public void onBackPressed() {
        if (captureVisible) leaveCapture();
        else if (advisor.canGoBack()) advisor.goBack();
        else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        captureGeneration++;
        saveGeneration++;
        sessionGeneration++;
        handler.removeCallbacksAndMessages(null);
        if (uploadCallback != null) uploadCallback.onReceiveValue(null);
        if (source != null) source.destroy();
        if (advisor != null) advisor.destroy();
        super.onDestroy();
    }
}
