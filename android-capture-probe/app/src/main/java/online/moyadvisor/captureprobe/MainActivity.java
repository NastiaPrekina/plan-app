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
    private static final String PARSER_URL = APP_ORIGIN + "/api/android-capture/script";
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

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
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
            }
        });
        frame.addView(appView, new FrameLayout.LayoutParams(-1, -1));

        captureScreen = new LinearLayout(this);
        captureScreen.setOrientation(LinearLayout.VERTICAL);
        captureScreen.setPadding(dp(9), dp(5), dp(9), dp(5));
        captureScreen.setBackgroundColor(Color.WHITE);
        frame.addView(captureScreen, new FrameLayout.LayoutParams(-1, -1));
        captureScreen.setVisibility(View.GONE);

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
        saveButton = addButton(actions, "Добавить в Буфер", v -> saveToBuffer());
        saveButton.setEnabled(false);
        addButton(actions, "Войти", v -> openAdvisor(APP_ORIGIN + "/capture"));
    }

    private void openAdvisor(String url) {
        showCapture(false);
        appView.loadUrl(url);
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
            parserScript = null;
            loadSharedParser(captureSequence);
        }
    }

    private void loadSharedParser(int sequence) {
        if (sequence != captureSequence) return;
        message.setText("Получаю общий парсер Advisor…");
        new Thread(() -> {
            String script = parserScript;
            String failure = null;
            if (script == null) {
                HttpURLConnection connection = null;
                try {
                    CookieManager.getInstance().flush();
                    String cookies = CookieManager.getInstance().getCookie(APP_ORIGIN);
                    connection = (HttpURLConnection) new URL(PARSER_URL).openConnection();
                    connection.setInstanceFollowRedirects(false);
                    connection.setConnectTimeout(8000);
                    connection.setReadTimeout(12000);
                    connection.setRequestProperty("Accept", "application/javascript");
                    if (cookies != null && !cookies.isEmpty()) {
                        connection.setRequestProperty("Cookie", cookies);
                    }
                    int code = connection.getResponseCode();
                    if (code != 200) throw new IllegalStateException(
                        code == 401 ? "Нужно войти в Advisor." :
                        code == 403 ? "Для аккаунта пока закрыт доступ к Буферу." :
                        "Сервер Advisor вернул " + code);
                    if (!"application/javascript".equals(
                        String.valueOf(connection.getContentType()).split(";")[0].trim())) {
                        throw new IllegalStateException("Сервер вернул не JavaScript-парсер.");
                    }
                    try (InputStream input = connection.getInputStream();
                         ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                        byte[] buffer = new byte[8192];
                        int count;
                        while ((count = input.read(buffer)) != -1) {
                            if (bytes.size() + count > 400_000) {
                                throw new IllegalStateException("Слишком большой ответ сервера.");
                            }
                            bytes.write(buffer, 0, count);
                        }
                        script = bytes.toString(StandardCharsets.UTF_8.name());
                    }
                    if (!script.contains("captureForKind") || !script.contains("__paAndroidCaptureResult")) {
                        throw new IllegalStateException("На сервере нет актуального Android-парсера.");
                    }
                    parserScript = script;
                } catch (Exception error) {
                    failure = error.getMessage();
                } finally {
                    if (connection != null) connection.disconnect();
                }
            }
            final String finalScript = script;
            final String finalFailure = failure;
            handler.post(() -> {
                if (sequence != captureSequence) return;
                if (finalFailure != null || finalScript == null) {
                    message.setText("Не удалось получить парсер: " + finalFailure
                        + " Откройте «Войти», авторизуйтесь и нажмите «Повторить».");
                    return;
                }
                message.setText("Распознаю карточку общим парсером Advisor…");
                sourceView.evaluateJavascript(finalScript, value -> {
                    if (sequence == captureSequence) pollCapture(sequence, 0);
                });
            });
        }).start();
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

    private void saveToBuffer() {
        if (currentCapture == null || saveBusy) return;
        String endpoint = endpointForKind(currentCapture.optString("kind"));
        if (endpoint == null) {
            message.setText("Неподдерживаемый тип карточки. Не сохранено.");
            return;
        }
        Uri appUri = Uri.parse(appView.getUrl() == null ? "" : appView.getUrl());
        if (!"https".equalsIgnoreCase(appUri.getScheme())
            || !APP_HOST.equalsIgnoreCase(appUri.getHost())) {
            message.setText("Сначала откройте Advisor и войдите в свой аккаунт.");
            return;
        }
        saveBusy = true;
        saveButton.setEnabled(false);
        message.setText("Сохраняю в Буфер вашего аккаунта…");
        final int sequence = ++saveSequence;
        final String body = "{\"capture\":" + currentCapture.toString() + "}";
        new Thread(() -> {
            HttpURLConnection connection = null;
            boolean ok = false;
            String error = null;
            try {
                CookieManager.getInstance().flush();
                String cookie = CookieManager.getInstance().getCookie(APP_ORIGIN);
                if (cookie == null || cookie.isEmpty()) {
                    throw new IllegalStateException("Сначала войдите в Advisor.");
                }
                connection = (HttpURLConnection) new URL(APP_ORIGIN + endpoint).openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(9000);
                connection.setReadTimeout(20000);
                connection.setRequestMethod("POST");
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                connection.setRequestProperty("Accept", "application/json");
                connection.setRequestProperty("Cookie", cookie);
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                if (bytes.length > 100_000) throw new IllegalStateException("Слишком большая карточка.");
                try (java.io.OutputStream out = connection.getOutputStream()) {
                    out.write(bytes);
                }
                int code = connection.getResponseCode();
                if (code >= 300 && code < 400) throw new IllegalStateException(
                    "Сессия истекла. Войдите в Advisor и повторите.");
                String responseText = "";
                InputStream stream = code >= 400 ? connection.getErrorStream() : connection.getInputStream();
                if (stream != null) {
                    try (InputStream input = stream;
                         ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                        byte[] buffer = new byte[4096];
                        int count;
                        while ((count = input.read(buffer)) != -1) {
                            if (output.size() + count > 100_000) throw new IllegalStateException("Слишком длинный ответ сервера.");
                            output.write(buffer, 0, count);
                        }
                        responseText = output.toString(StandardCharsets.UTF_8.name());
                    }
                }
                JSONObject response = new JSONObject(responseText);
                JSONObject saved = response.optJSONObject("saved");
                ok = code >= 200 && code < 300 && saved != null
                    && saved.optString("id").length() > 0;
                if (!ok) error = response.optString("error", code == 401
                    ? "Сессия истекла. Войдите в Advisor." : "Сохранение не подтверждено сервером (" + code + ").");
            } catch (Exception e) {
                error = e.getMessage() != null ? e.getMessage() : "Сетевая ошибка.";
            } finally {
                if (connection != null) connection.disconnect();
            }
            final boolean success = ok;
            final String failure = error;
            handler.post(() -> {
                if (sequence != saveSequence) return;
                saveBusy = false;
                if (success) {
                    message.setText("Карточка сохранена в настоящий Буфер.");
                    Toast.makeText(this, "Добавлено в Буфер Advisor", Toast.LENGTH_LONG).show();
                    currentCapture = null;
                    saveButton.setEnabled(false);
                    openAdvisor(APP_ORIGIN + "/capture");
                    // Navigation above fetches fresh user-scoped Buffer contents.
                } else {
                    message.setText("Не сохранено: " + (failure == null ? "Неизвестная ошибка." : failure)
                        + " Для входа нажмите «Войти».");
                    saveButton.setEnabled(true);
                }
            });
        }).start();
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
