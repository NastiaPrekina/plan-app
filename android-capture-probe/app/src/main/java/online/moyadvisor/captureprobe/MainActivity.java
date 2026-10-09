package online.moyadvisor.captureprobe;

import android.app.Activity;
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
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
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
    private TextView status, queueInfo, preview;
    private Button saveButton;
    private ValueCallback<Uri[]> uploadCallback;
    private String sharedUrl, parser;
    private JSONObject currentCapture;
    private boolean captureVisible = false, sessionBusy = false, syncBusy = false;
    private int captureGeneration = 0, saveGeneration = 0, sessionGeneration = 0;
    private long lastSessionCheckAt = 0;
    private String currentSyncOwner = "";
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

    private Button button(String value, View.OnClickListener onClick) {
        Button button = new Button(this);
        button.setAllCaps(false);
        button.setText(value);
        button.setTextSize(13);
        button.setOnClickListener(onClick);
        return button;
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

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        captureLayer.addView(header, new LinearLayout.LayoutParams(-1, dp(54)));
        TextView heading = text("Добавить в Буфер", 19);
        heading.setTypeface(null, 1);
        header.addView(heading, new LinearLayout.LayoutParams(0, -2, 1));
        Button close = button("✕", v -> leaveCapture());
        close.setContentDescription("Закрыть захват");
        header.addView(close, new LinearLayout.LayoutParams(dp(52), dp(48)));

        queueInfo = text("", 12);
        queueInfo.setPadding(dp(4), dp(3), dp(4), dp(5));
        queueInfo.setOnClickListener(v -> {
            if (!captureVisible) return;
            if (!advisorHost(advisor.getUrl())) {
                status.setText("Для отправки включите VPN и откройте Advisor.");
            } else {
                verifySession(true);
            }
        });
        captureLayer.addView(queueInfo);

        status = text("Открываю страницу товара…", 14);
        status.setPadding(dp(4), dp(7), dp(4), dp(10));
        captureLayer.addView(status);

        // A separate WebView is required for rendering source DOM. It stays
        // behind an opaque, non-interactive preview while it loads, so the
        // user sees Advisor's capture UI, not a second browser application.
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
                status.setText("Нельзя читать служебную страницу вместо товара.");
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                captureGeneration++;
                currentCapture = null;
                setPreview(null);
                status.setText("Загружаю карточку…");
            }
            @Override public void onPageFinished(WebView view, String url) {
                int generation = captureGeneration;
                handler.postDelayed(() -> injectParser(generation), 350);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) status.setText("Страница не открылась: " + error.getDescription());
            }
        });
        worker.addView(source, new FrameLayout.LayoutParams(-1, -1));
        LinearLayout overlay = new LinearLayout(this);
        overlay.setOrientation(LinearLayout.VERTICAL);
        overlay.setBackgroundColor(Color.rgb(248, 250, 249));
        overlay.setGravity(Gravity.CENTER);
        TextView hint = text("Карточка распознаётся на телефоне.\nVPN для этого не требуется.", 14);
        hint.setGravity(Gravity.CENTER);
        hint.setPadding(dp(28), dp(14), dp(28), dp(14));
        overlay.addView(hint);
        worker.addView(overlay, new FrameLayout.LayoutParams(-1, -1));

        ScrollView scroller = new ScrollView(this);
        captureLayer.addView(scroller, new LinearLayout.LayoutParams(-1, dp(165)));
        preview = text("Данные появятся после распознавания.", 14);
        preview.setTextIsSelectable(true);
        preview.setPadding(dp(8), dp(12), dp(8), dp(12));
        scroller.addView(preview);

        LinearLayout actions = new LinearLayout(this);
        captureLayer.addView(actions, new LinearLayout.LayoutParams(-1, dp(54)));
        Button retry = button("Повторить", v -> retry());
        actions.addView(retry, new LinearLayout.LayoutParams(0, -1, 1));
        saveButton = button("Сохранить", v -> enqueue());
        saveButton.setEnabled(false);
        actions.addView(saveButton, new LinearLayout.LayoutParams(0, -1, 2));
        showQueueCount();
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
        showCapture(false);
        if (advisor.getUrl() == null) advisor.loadUrl(ORIGIN + "/");
        else verifySession(false);
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
        showCapture(true);
        currentCapture = null;
        setPreview(null);
        showQueueCount();
        if (url == null) {
            status.setText("Не удалось найти ссылку HTTPS. Попробуйте «Поделиться» ещё раз.");
            return;
        }
        sharedUrl = url;
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
            status.setText("Ошибка встроенного парсера: " + ex.getMessage());
            return null;
        }
    }

    private void retry() {
        setPreview(null);
        if (source.getUrl() == null && sharedUrl != null) source.loadUrl(sharedUrl);
        else injectParser(captureGeneration);
    }

    private void injectParser(int generation) {
        if (generation != captureGeneration || !captureVisible) return;
        String script = sharedParser();
        if (script == null) return;
        status.setText("Распознаю карточку…");
        source.evaluateJavascript(script, ignored -> {
            if (generation == captureGeneration) pollCapture(generation, 0);
        });
    }

    private JSONObject decoded(String value) {
        try {
            Object parsed = new JSONTokener(value).nextValue();
            return new JSONObject(parsed instanceof String ? (String) parsed : String.valueOf(parsed));
        } catch (Exception exception) { return null; }
    }

    private void pollCapture(int generation, int step) {
        if (generation != captureGeneration || !captureVisible) return;
        if (step > 22) {
            status.setText("Не удалось завершить захват. Попробуйте ещё раз.");
            return;
        }
        handler.postDelayed(() -> source.evaluateJavascript(
            "JSON.stringify(window.__paAndroidCaptureResult || null)", raw -> {
                if (generation != captureGeneration || !captureVisible) return;
                JSONObject result = decoded(raw);
                if (result == null || !result.optBoolean("done")) {
                    pollCapture(generation, step + 1);
                    return;
                }
                JSONObject capture = result.optJSONObject("capture");
                if (capture == null) {
                    status.setText(result.optString("error", "Карточка не распознана."));
                    return;
                }
                Uri origin = Uri.parse(capture.optString("sourceUrl", ""));
                Uri current = Uri.parse(source.getUrl() == null ? "" : source.getUrl());
                if (!"https".equalsIgnoreCase(origin.getScheme())
                        || origin.getHost() == null || current.getHost() == null
                        || !origin.getHost().equalsIgnoreCase(current.getHost())) {
                    status.setText("Источник карточки не соответствует открытой странице.");
                    return;
                }
                currentCapture = capture;
                setPreview(capture);
                status.setText(result.optBoolean("incomplete")
                    ? "Некоторые поля неполные — проверьте данные перед сохранением."
                    : "Проверьте карточку и нажмите «Сохранить».");
            }), 550);
    }

    private String categoryName(String kind) {
        switch (kind) {
            case "product": return "Товар";
            case "game": return "Игра";
            case "screen": return "Фильм / сериал";
            case "book": return "Книга / аудиокнига";
            case "event": return "Событие";
            case "place": return "Заведение";
            case "hotel": return "Отель";
            default: return "Карточка";
        }
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

    private void setPreview(JSONObject card) {
        if (card == null) {
            preview.setText("Данные появятся после распознавания.");
            saveButton.setEnabled(false);
            return;
        }
        String title = card.optString("title", "");
        StringBuilder body = new StringBuilder(categoryName(card.optString("kind")))
            .append("\n").append(title);
        if (!card.isNull("price") && card.has("price"))
            body.append("\nЦена: ").append(card.optString("price")).append(" ").append(card.optString("currency"));
        if (!card.optString("startDate").isEmpty()) body.append("\nДата: ").append(card.optString("startDate"));
        if (!card.optString("venueName").isEmpty()) body.append("\nМесто: ").append(card.optString("venueName"));
        body.append("\nИсточник: ").append(card.optString("sourceUrl"));
        preview.setText(body.toString());
        saveButton.setEnabled(endpoint(card.optString("kind")) != null
            && title.trim().length() >= 4 && !title.trim().equals("..."));
    }

    private void showQueueCount() {
        if (queueInfo == null || pending == null) return;
        String owner = pending.owner();
        int count = owner.isEmpty() ? pending.totalCount() : pending.countFor(owner);
        queueInfo.setText(count > 0
            ? "На телефоне: " + count + " · отправятся в Буфер при доступном Advisor"
            : "Сохраним карточку здесь и отправим в Буфер при подключении");
    }

    private void enqueue() {
        if (currentCapture == null) return;
        String owner = pending.owner();
        if (owner.isEmpty()) {
            status.setText("Вход в Advisor ещё не подтверждён. Откройте приложение с VPN, "
                + "войдите и дождитесь проверки аккаунта. Возвращаться к товару не нужно.");
            return;
        }
        if (!pending.enqueue(owner, currentCapture)) {
            status.setText("Не удалось сохранить карточку на телефоне или очередь заполнена.");
            return;
        }
        currentCapture = null;
        setPreview(null);
        showQueueCount();
        status.setText("Сохранено на телефоне. Откройте Advisor с VPN — карточка попадёт в Буфер.");
        Toast.makeText(this, "Сохранено на телефоне", Toast.LENGTH_SHORT).show();
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
                showQueueCount();
                if (!prior.isEmpty() && !prior.equals(verified)) {
                    if (captureVisible) status.setText("Аккаунт изменён. Очередь предыдущего пользователя не отправляется.");
                    return;
                }
                if (pending.countFor(verified) > 0) {
                    syncBusy = true;
                    currentSyncOwner = verified;
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
            showQueueCount();
            if (syncedThisPass > 0) {
                Toast.makeText(this, "В Буфер отправлено: " + syncedThisPass, Toast.LENGTH_LONG).show();
                if (!captureVisible && advisor.getUrl() != null
                        && advisor.getUrl().startsWith(ORIGIN + "/capture")) advisor.reload();
                if (captureVisible) status.setText("Все ожидающие карточки отправлены в Буфер: " + syncedThisPass);
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
                showQueueCount();
                syncOne(owner);
            }), 390);
    }

    private void syncFailed(String problem) {
        syncBusy = false;
        showQueueCount();
        if (captureVisible) status.setText("Очередь сохранена. " + problem);
        else if (syncedThisPass > 0)
            Toast.makeText(this, "Отправлено " + syncedThisPass + ", остальное осталось на телефоне", Toast.LENGTH_LONG).show();
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
        if (pending != null && advisor != null && !captureVisible)
            handler.postDelayed(() -> verifySession(false), 650);
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
