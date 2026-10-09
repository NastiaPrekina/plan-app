package online.moyadvisor.captureprobe;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.view.View;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The actual Advisor website is the user interface and the source of auth.
 * An isolated WebView reads shared public pages with the shared server parser.
 * It never receives a native JavaScript bridge, token, or Advisor cookies.
 * User-approved saves are sent from the authenticated Advisor WebView to the
 * EXISTING per-category server endpoints, bound to that session's userId.
 */
public class MainActivity extends Activity {
    private static final String APP_ORIGIN = "https://app.moyadvisor.online";
    private static final String APP_HOST = "app.moyadvisor.online";
    private static final String SESSION_URL = APP_ORIGIN + "/api/android-capture/session";
    private static final Pattern HTTPS_LINK = Pattern.compile("https://[^\\s<>\"']+", Pattern.CASE_INSENSITIVE);
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView appView, sourceView;
    private LinearLayout captureScreen;
    private TextView message, preview;
    private Button saveButton;
    private boolean showingCapture = false;
    private boolean saveBusy = false;
    private int captureSequence = 0;
    private int saveSequence = 0;
    private JSONObject currentCapture;
    private String parserScript;
    private String sharedUrl;
    private PendingCaptureStore pending;
    private TextView queueStatus;
    private boolean checkingSession = false;
    private long lastSessionCheck = 0;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        pending = new PendingCaptureStore(this);
        buildUi();
        appView.loadUrl(APP_ORIGIN + "/capture");
        handleShare(getIntent());
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleShare(intent);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private TextView makeText(String value, int size) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(Color.rgb(45, 53, 55));
        return view;
    }

    private Button addButton(LinearLayout row, String text, View.OnClickListener callback) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextSize(12);
        button.setAllCaps(false);
        button.setOnClickListener(callback);
        row.addView(button, new LinearLayout.LayoutParams(0, dp(46), 1));
        return button;
    }

    private void configureWebView(WebView view) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setSafeBrowsingEnabled(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, false);
        view.setWebChromeClient(new WebChromeClient());
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setBackgroundColor(Color.WHITE);
        root.setOrientation(LinearLayout.VERTICAL);
        setContentView(root);
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setOrientation(LinearLayout.HORIZONTAL);
        root.addView(toolbar, new LinearLayout.LayoutParams(-1, dp(50)));
        addButton(toolbar, "Advisor", v -> openAdvisor(APP_ORIGIN + "/"));
        addButton(toolbar, "Буфер", v -> openAdvisor(APP_ORIGIN + "/capture"));
        addButton(toolbar, "Отправить", v -> checkSessionAndSync(true));
        addButton(toolbar, "Захват", v -> {
            if (sharedUrl == null) {
                Toast.makeText(this, "Откройте карточку в другом приложении → Поделиться → Advisor", Toast.LENGTH_LONG).show();
                return;
            }
            showCapture(true);
        });

        FrameLayout frame = new FrameLayout(this);
        root.addView(frame, new LinearLayout.LayoutParams(-1, 0, 1));
        appView = new WebView(this);
        configureWebView(appView);
        appView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !"https".equalsIgnoreCase(request.getUrl().getScheme());
            }
            @Override public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
                if (url.startsWith(APP_ORIGIN) && !url.contains("/login")) {
                    checkSessionAndSync(false);
                }
            }
        });
        frame.addView(appView, new FrameLayout.LayoutParams(-1, -1));

        captureScreen = new LinearLayout(this);
        captureScreen.setOrientation(LinearLayout.VERTICAL);
        captureScreen.setPadding(dp(9), dp(5), dp(9), dp(5));
        captureScreen.setBackgroundColor(Color.WHITE);
        frame.addView(captureScreen, new FrameLayout.LayoutParams(-1, -1));
        captureScreen.setVisibility(View.GONE);

        queueStatus = makeText("Очередь Буфера: 0", 12);
        queueStatus.setPadding(dp(4), dp(3), dp(4), dp(5));
        captureScreen.addView(queueStatus);
        message = makeText("Поделитесь ссылкой на карточку.", 13);
        message.setPadding(dp(4), dp(4), dp(4), dp(7));
        captureScreen.addView(message);

        sourceView = new WebView(this);
        configureWebView(sourceView);
        sourceView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !"https".equalsIgnoreCase(request.getUrl().getScheme());
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                captureSequence++;
                currentCapture = null;
                updatePreview(null);
                message.setText("Загружается страница источника…");
            }
            @Override public void onPageFinished(WebView view, String url) {
                int current = captureSequence;
                handler.postDelayed(() -> loadSharedParser(current), 500);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    message.setText("Не удалось открыть страницу источника: " + error.getDescription());
                }
            }
        });
        captureScreen.addView(sourceView, new LinearLayout.LayoutParams(-1, 0, 1));

        ScrollView scroller = new ScrollView(this);
        captureScreen.addView(scroller, new LinearLayout.LayoutParams(-1, dp(137)));
        preview = makeText("После загрузки появится предварительная карточка.", 13);
        preview.setTextIsSelectable(true);
        preview.setPadding(dp(7), dp(7), dp(7), dp(7));
        scroller.addView(preview);

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        captureScreen.addView(actions, new LinearLayout.LayoutParams(-1, dp(52)));
        addButton(actions, "Повторить", v -> retryCapture());
        saveButton = addButton(actions, "В очередь Буфера", v -> saveToBuffer());
        saveButton.setEnabled(false);
        addButton(actions, "Войти", v -> openAdvisor(APP_ORIGIN + "/capture"));
        updateQueueStatus();
    }

    private void openAdvisor(String url) {
        showCapture(false);
        appView.loadUrl(url);
        checkSessionAndSync(false);
    }

    private void showCapture(boolean visible) {
        showingCapture = visible;
        captureScreen.setVisibility(visible ? View.VISIBLE : View.GONE);
        appView.setVisibility(visible ? View.GONE : View.VISIBLE);
    }

    private static String firstHttps(String raw) {
        if (raw == null) return null;
        Matcher matcher = HTTPS_LINK.matcher(raw);
        if (!matcher.find()) return null;
        String value = matcher.group();
        while (value.endsWith(".") || value.endsWith(",") || value.endsWith(")") || value.endsWith("]")) {
            value = value.substring(0, value.length() - 1);
        }
        try {
            Uri url = Uri.parse(value);
            return "https".equalsIgnoreCase(url.getScheme()) && url.getHost() != null ? value : null;
        } catch (Exception ignored) {
            return null;
        }
    }

    private void handleShare(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String raw = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (raw == null || raw.isEmpty()) raw = intent.getStringExtra(Intent.EXTRA_HTML_TEXT);
        String url = firstHttps(raw);
        if (url == null) {
            showCapture(true);
            message.setText("В сообщении нет HTTPS-ссылки на карточку.");
            return;
        }
        sharedUrl = url;
        currentCapture = null;
        saveBusy = false;
        showCapture(true);
        sourceView.loadUrl(url);
    }

    private void retryCapture() {
        currentCapture = null;
        updatePreview(null);
        if (sourceView.getUrl() == null) {
            if (sharedUrl != null) sourceView.loadUrl(sharedUrl);
        } else {
            loadSharedParser(captureSequence);
        }
    }

    private String bundledParser() {
        if (parserScript != null) return parserScript;
        try (InputStream input = getAssets().open("shared-parser.js");
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int len;
            while ((len = input.read(buffer)) != -1) {
                if (output.size() + len > 400_000) {
                    throw new IllegalStateException("Слишком большой общий парсер.");
                }
                output.write(buffer, 0, len);
            }
            String script = output.toString(StandardCharsets.UTF_8.name());
            if (!script.contains("captureForKind") || !script.contains("__paAndroidCaptureResult")) {
                throw new IllegalStateException("В APK отсутствует общий парсер Advisor.");
            }
            parserScript = script;
            return parserScript;
        } catch (Exception error) {
            message.setText("Не удалось открыть встроенный парсер: " + error.getMessage());
            return null;
        }
    }

    private void loadSharedParser(int sequence) {
        if (sequence != captureSequence) return;
        String script = bundledParser();
        if (script == null) return;
        message.setText("Распознаю карточку локальным парсером Advisor…");
        sourceView.evaluateJavascript(script, value -> {
            if (sequence == captureSequence) pollCapture(sequence, 0);
        });
    }

    private JSONObject jsonFromJavascript(String value) {
        try {
            Object decoded = new JSONTokener(value).nextValue();
            String data = decoded instanceof String ? (String) decoded : String.valueOf(decoded);
            return new JSONObject(data);
        } catch (Exception ignored) {
            return null;
        }
    }

    private void pollCapture(int sequence, int attempt) {
        if (sequence != captureSequence) return;
        if (attempt > 20) {
            message.setText("Источник отвечает слишком долго. Попробуйте ещё раз.");
            return;
        }
        handler.postDelayed(() -> sourceView.evaluateJavascript(
            "JSON.stringify(window.__paAndroidCaptureResult || null)", raw -> {
                if (sequence != captureSequence) return;
                JSONObject result = jsonFromJavascript(raw);
                if (result == null || !result.optBoolean("done")) {
                    pollCapture(sequence, attempt + 1);
                    return;
                }
                JSONObject capture = result.optJSONObject("capture");
                if (capture == null) {
                    message.setText(result.optString("error", "Карточка не распознана. Повторите попытку."));
                    updatePreview(null);
                    return;
                }
                String original = capture.optString("sourceUrl", "");
                String current = sourceView.getUrl();
                if (!"https".equalsIgnoreCase(Uri.parse(original).getScheme())
                    || current == null
                    || !original.equals(current) && !original.equals(current.split("\\?")[0])
                    && !(Uri.parse(current).getHost() != null
                        && Uri.parse(current).getHost().equalsIgnoreCase(Uri.parse(original).getHost()))) {
                    message.setText("Ссылка карточки не совпадает с открытым источником. Сохранение отменено.");
                    updatePreview(null);
                    return;
                }
                currentCapture = capture;
                updatePreview(capture);
                message.setText(result.optBoolean("incomplete")
                    ? "Карточка распознана не полностью — проверьте поля перед сохранением."
                    : "Карточка готова к проверке. Сохранение только по нажатию.");
            }), 1000);
    }

    private String categoryName(String type) {
        switch (type) {
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

    private void updatePreview(JSONObject capture) {
        if (capture == null) {
            preview.setText("Предпросмотр пока недоступен.");
            saveButton.setEnabled(false);
            return;
        }
        String type = capture.optString("kind", "");
        String title = capture.optString("title", "");
        StringBuilder details = new StringBuilder(categoryName(type)).append(": ").append(title);
        if (capture.has("price") && !capture.isNull("price")) {
            details.append("\nЦена: ").append(capture.optString("price"))
                .append(" ").append(capture.optString("currency", ""));
        }
        if (capture.has("startDate") && !capture.isNull("startDate")) {
            details.append("\nДата: ").append(capture.optString("startDate"));
        }
        if (capture.has("venueName") && !capture.isNull("venueName")) {
            details.append("\nМесто: ").append(capture.optString("venueName"));
        }
        details.append("\nИсточник: ").append(capture.optString("sourceUrl", ""));
        preview.setText(details.toString());
        saveButton.setEnabled(!saveBusy && title.trim().length() > 3 && !title.trim().equals("..."));
    }

    private String endpointForKind(String kind) {
        switch (kind) {
            case "game": return "/api/browser-capture/steam";
            case "screen": return "/api/browser-capture/screen";
            case "book": return "/api/browser-capture/book";
            case "event": return "/api/browser-capture/event";
            case "place": return "/api/browser-capture/place";
            case "hotel": return "/api/browser-capture/hotel";
            case "product": return "/api/wishlist-preview/save";
            default: return null;
        }
    }

    private void updateQueueStatus() {
        if (queueStatus == null || pending == null) return;
        String owner = pending.owner();
        int count = owner.isEmpty() ? pending.totalCount() : pending.countFor(owner);
        queueStatus.setText("На телефоне: " + count + " ожидают отправки в Буфер"
            + (owner.isEmpty() ? " · сначала войдите в Advisor с VPN" : ""));
    }

    private void saveToBuffer() {
        if (currentCapture == null || saveBusy) return;
        if (endpointForKind(currentCapture.optString("kind")) == null) {
            message.setText("Неизвестный тип карточки. Захват не сохранён.");
            return;
        }
        String owner = pending.owner();
        if (owner.isEmpty()) {
            message.setText("Сначала один раз откройте Advisor под VPN и войдите в аккаунт. "
                + "После этого можно сохранять товары без VPN. Карточка пока не поставлена в очередь.");
            return;
        }
        if (!pending.enqueue(owner, currentCapture)) {
            message.setText("Не удалось сохранить карточку в памяти телефона или очередь заполнена. "
                + "Ничего не отправлено.");
            return;
        }
        currentCapture = null;
        updatePreview(null);
        updateQueueStatus();
        message.setText("Карточка сохранена на телефоне. Включите VPN и откройте Advisor: "
            + "очередь отправится в ваш Буфер. Можно продолжать добавлять товары.");
        Toast.makeText(this, "Сохранено на телефоне · отправим при подключении", Toast.LENGTH_LONG).show();
    }

    private static final class HttpAnswer {
        final int status;
        final String body;
        HttpAnswer(int status, String body) { this.status=status; this.body=body; }
    }

    /**
     * Cookies are taken only from the Advisor WebView. Never sent to source
     * pages or persisted with captured cards. The server decides the user.
     */
    private HttpAnswer advisorRequest(String endpoint, String cookie, String json)
        throws Exception {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(APP_ORIGIN + endpoint);
            connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(6500);
            connection.setReadTimeout(16000);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Cookie", cookie);
            if (json != null) {
                connection.setRequestMethod("POST");
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
                if (bytes.length > 100_000) throw new IllegalStateException("Карточка слишком большая.");
                try (java.io.OutputStream out = connection.getOutputStream()) { out.write(bytes); }
            }
            int status = connection.getResponseCode();
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            String result = "";
            if (stream != null) {
                try (InputStream input = stream;
                     ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[4096];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (out.size() + count > 120_000) throw new IllegalStateException("Слишком большой ответ сервера.");
                        out.write(buffer, 0, count);
                    }
                    result = out.toString(StandardCharsets.UTF_8.name());
                }
            }
            return new HttpAnswer(status, result);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void checkSessionAndSync(boolean userInitiated) {
        if (checkingSession) return;
        long now = System.currentTimeMillis();
        if (!userInitiated && now - lastSessionCheck < 8000) return;
        checkingSession = true;
        new Thread(() -> {
            String problem = null;
            String verified = null;
            int sent = 0;
            boolean differentAccount = false;
            try {
                CookieManager.getInstance().flush();
                String cookies = CookieManager.getInstance().getCookie(APP_ORIGIN);
                if (cookies == null || cookies.isEmpty()) throw new IllegalStateException("Сначала войдите в Advisor.");
                HttpAnswer response = advisorRequest("/api/android-capture/session", cookies, null);
                if (response.status != 200) throw new IllegalStateException(
                    response.status == 401 ? "Нужно войти в Advisor." :
                    response.status == 403 ? "Нет доступа к Буферу в этом аккаунте." :
                    "Нет связи с Advisor (код " + response.status + ").");
                JSONObject session = new JSONObject(response.body);
                verified = session.optString("userId", "");
                String oldOwner = pending.owner();
                pending.setVerifiedOwner(verified);
                differentAccount = !oldOwner.isEmpty() && !oldOwner.equals(verified);
                // Only read entries for the just-verified account. Switching the
                // Advisor login can NEVER transfer another account's captures.
                for (int index=0; index<60; index++) {
                    JSONObject queued = pending.firstFor(verified);
                    if (queued == null) break;
                    JSONObject capture = queued.optJSONObject("capture");
                    String id = queued.optString("id");
                    if (capture == null || id.isEmpty()) break;
                    String path = endpointForKind(capture.optString("kind"));
                    if (path == null) throw new IllegalStateException(
                        "В очереди неподдерживаемая карточка. Она сохранена локально.");
                    HttpAnswer save = advisorRequest(path, cookies,
                        "{\"capture\":" + capture.toString() + "}");
                    JSONObject result;
                    try { result = new JSONObject(save.body); }
                    catch (Exception e) { throw new IllegalStateException(
                        "Не получено подтверждение сохранения. Карточка осталась в очереди."); }
                    JSONObject saved = result.optJSONObject("saved");
                    if (save.status < 200 || save.status >= 300
                        || saved == null || saved.optString("id").isEmpty()) {
                        throw new IllegalStateException(
                            result.optString("error", "Сервер не подтвердил сохранение (" + save.status + ")."));
                    }
                    if (!pending.remove(verified, id)) {
                        throw new IllegalStateException("Карточка записана в Буфер, но локальная очередь не обновлена.");
                    }
                    sent++;
                }
            } catch (Exception ex) {
                problem = ex.getMessage();
            }
            final int sentCount = sent;
            final String failure = problem;
            final boolean accountChanged = differentAccount;
            final String user = verified;
            handler.post(() -> {
                checkingSession = false;
                lastSessionCheck = failure == null ? System.currentTimeMillis() : 0;
                updateQueueStatus();
                if (sentCount > 0) {
                    Toast.makeText(this, "В Буфер отправлено: " + sentCount,
                        Toast.LENGTH_LONG).show();
                    if (!showingCapture && appView.getUrl() != null
                        && appView.getUrl().startsWith(APP_ORIGIN + "/capture")) {
                        appView.reload();
                    }
                }
                if (showingCapture) {
                    if (failure != null && userInitiated) {
                        message.setText("Синхронизация: " + failure
                            + " Ожидающие карточки остались на телефоне.");
                    } else if (sentCount > 0) {
                        message.setText("Отправлено в настоящий Буфер: " + sentCount
                            + ". Остальные записи, если есть, сохраняются на телефоне.");
                    } else if (accountChanged) {
                        message.setText("Вошли в другой аккаунт. Чужая очередь не отправлена. "
                            + "Вернитесь в прежний аккаунт, чтобы передать его карточки.");
                    } else if (userInitiated && failure == null) {
                        message.setText("Соединение с Advisor есть, очередь текущего аккаунта пуста.");
                    }
                } else if (userInitiated && failure != null) {
                    Toast.makeText(this, "Очередь сохранена: " + failure,
                        Toast.LENGTH_LONG).show();
                }
            });
        }).start();
    }

    @Override protected void onResume() {
        super.onResume();
        if (pending != null) handler.postDelayed(() -> checkSessionAndSync(false), 650);
    }

    @Override public void onBackPressed() {
        if (showingCapture) {
            showCapture(false);
        } else if (appView.canGoBack()) {
            appView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override protected void onDestroy() {
        captureSequence++;
        saveSequence++;
        sourceView.destroy();
        appView.destroy();
        super.onDestroy();
    }
}
