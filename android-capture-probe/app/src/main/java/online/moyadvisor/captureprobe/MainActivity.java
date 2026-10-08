package online.moyadvisor.captureprobe;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MainActivity extends Activity {
    private static final Pattern LINK = Pattern.compile("https?://[^\\s<>\"']+", Pattern.CASE_INSENSITIVE);
    private static final int MAX_RECORDS = 25;
    private static final int EXPORT_REQUEST = 501;
    private static final String PREFS = "advisor_capture_test_local_v4";
    private static final String HISTORY = "capture_history";
    private static final String REPORT_URI = "content://online.moyadvisor.captureprobe.reports/report.json";

    private WebView browser;
    private EditText urlInput;
    private TextView status;
    private Button historyButton;
    private LinearLayout lowerContent;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private String probeScript;
    private String latestReport = "Отчёт пока не готов.";
    private int navigationCounter = 0;
    private boolean showingHistory = false;
    private JSONArray records = new JSONArray();

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        probeScript = loadAsset("probe.js");
        records = loadHistory();
        buildUi();
        configureWebView();
        handleIntent(getIntent());
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private int dp(int px) {
        return Math.round(px * getResources().getDisplayMetrics().density);
    }

    private TextView label(String text, int size) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(size);
        view.setTextColor(Color.rgb(39, 48, 50));
        return view;
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(10), dp(9), dp(10), dp(9));
        root.setBackgroundColor(Color.WHITE);
        setContentView(root);

        root.addView(label("Advisor · Android захват v0.5", 19));
        TextView subtitle = label("Черновики сохраняются только на этом телефоне, не в Буфере Advisor.", 11);
        subtitle.setPadding(0, dp(3), 0, dp(5));
        root.addView(subtitle);

        urlInput = new EditText(this);
        urlInput.setSingleLine(true);
        urlInput.setTextSize(13);
        urlInput.setHint("https://... или Поделиться → Advisor");
        urlInput.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        root.addView(urlInput, new LinearLayout.LayoutParams(-1, dp(43)));

        LinearLayout row1 = buttonRow(root);
        addButton(row1, "Открыть", v -> openUrl(urlInput.getText().toString()));
        addButton(row1, "Проверить", v -> probe(navigationCounter));
        addButton(row1, "Копировать", v -> copyText(latestReport, "Текущий отчёт скопирован"));

        status = label("Отправь ссылку из приложения через «Поделиться».", 12);
        status.setPadding(0, dp(6), 0, dp(5));
        root.addView(status);

        browser = new WebView(this);
        root.addView(browser, new LinearLayout.LayoutParams(-1, dp(230)));

        LinearLayout row2 = buttonRow(root);
        historyButton = addButton(row2, "История", v -> {
            showingHistory = !showingHistory;
            renderLowerContent();
        });
        addButton(row2, "Отправить файл", v -> shareReportFile());
        addButton(row2, "Сохранить JSON", v -> saveReportFile());

        ScrollView scroll = new ScrollView(this);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        lowerContent = new LinearLayout(this);
        lowerContent.setOrientation(LinearLayout.VERTICAL);
        lowerContent.setPadding(dp(4), dp(8), dp(4), dp(4));
        scroll.addView(lowerContent);
        renderLowerContent();
    }

    private LinearLayout buttonRow(LinearLayout parent) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        parent.addView(row, new LinearLayout.LayoutParams(-1, dp(45)));
        return row;
    }

    private Button addButton(LinearLayout row, String title, View.OnClickListener callback) {
        Button button = new Button(this);
        button.setText(title);
        button.setAllCaps(false);
        button.setTextSize(11);
        button.setPadding(0, 0, 0, 0);
        row.addView(button, new LinearLayout.LayoutParams(0, dp(45), 1));
        button.setOnClickListener(callback);
        return button;
    }

    private void renderLowerContent() {
        if (lowerContent == null) return;
        lowerContent.removeAllViews();
        if (historyButton != null) historyButton.setText(
            showingHistory ? "Результат" : "История (" + records.length() + ")"
        );
        if (!showingHistory) {
            TextView title = label("Последний захват", 15);
            lowerContent.addView(title);
            TextView info = label(latestReport, 11);
            info.setTextIsSelectable(true);
            info.setPadding(0, dp(8), 0, dp(8));
            lowerContent.addView(info);
            return;
        }

        TextView title = label("На телефоне: " + records.length() + " из " + MAX_RECORDS + " последних захватов", 14);
        lowerContent.addView(title);
        TextView note = label("Нажми запись, чтобы открыть подробности. «Отправить файл» передаёт вложение без текстового сообщения. «Сохранить JSON» сохраняет документ в выбранную папку.", 11);
        note.setPadding(0, dp(6), 0, dp(8));
        lowerContent.addView(note);
        if (records.length() == 0) {
            lowerContent.addView(label("Пока нет сохранённых проверок.", 13));
        } else {
            for (int i = 0; i < records.length(); i++) {
                final JSONObject entry = records.optJSONObject(i);
                if (entry == null) continue;
                String category = categoryName(entry.optString("detectedCategory"));
                String titleText = entry.optString("captureTitle", "Без названия");
                String readiness = entry.optBoolean("captureReady", false) ? "✓" : "⚠";
                TextView item = label(readiness + " " + category + " · " + titleText + "\n"
                    + entry.optString("sourceProvider", "") + " · " + entry.optString("capturePriceCandidate", ""), 13);
                item.setPadding(dp(6), dp(7), dp(6), dp(9));
                item.setBackgroundColor(i % 2 == 0 ? Color.rgb(245, 248, 247) : Color.WHITE);
                item.setOnClickListener(v -> {
                    latestReport = entry.toString();
                    showingHistory = false;
                    renderLowerContent();
                    status.setText("Открыт сохранённый черновик. Это не запись в Буфер.");
                });
                lowerContent.addView(item);
            }
        }
        Button copyAll = new Button(this);
        copyAll.setText("Скопировать все результаты одним JSON");
        copyAll.setTextSize(12);
        copyAll.setAllCaps(false);
        copyAll.setOnClickListener(v -> copyText(batch().toString(), "Скопированы все " + records.length() + " записей одним JSON."));
        lowerContent.addView(copyAll);

        Button clear = new Button(this);
        clear.setText("Очистить локальную историю");
        clear.setTextSize(12);
        clear.setAllCaps(false);
        clear.setOnClickListener(v -> new AlertDialog.Builder(this)
            .setTitle("Очистить результаты?")
            .setMessage("Удалятся только локальные тестовые захваты на этом телефоне.")
            .setNegativeButton("Отмена", null)
            .setPositiveButton("Очистить", (dialog, which) -> {
                records = new JSONArray();
                saveHistory();
                renderLowerContent();
                status.setText("Локальная история очищена.");
            }).show());
        lowerContent.addView(clear);
    }

    private static String categoryName(String category) {
        switch (category) {
            case "product": return "Товар";
            case "movie": return "Фильм";
            case "series": return "Сериал";
            case "game": return "Игра";
            case "book": return "Книга";
            case "audiobook": return "Аудиокнига";
            case "place": return "Заведение";
            case "event": return "Событие";
            default: return "Не распознано";
        }
    }

    private void configureWebView() {
        WebSettings settings = browser.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setSafeBrowsingEnabled(true);
        browser.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int progress) {
                if (progress < 100) status.setText("Загрузка: " + progress + "%");
            }
        });
        browser.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri target = request.getUrl();
                if (!"https".equalsIgnoreCase(target.getScheme())) {
                    status.setText("Небезопасный переход заблокирован: " + target.getScheme());
                    return true;
                }
                return false;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                navigationCounter++;
                status.setText("Открываю: " + url);
            }
            @Override public void onPageFinished(WebView view, String url) {
                final int count = navigationCounter;
                status.setText("Страница открылась. Проверяю через 2 и 6 секунд.");
                handler.postDelayed(() -> { if (count == navigationCounter) probe(count); }, 2000);
                handler.postDelayed(() -> { if (count == navigationCounter) probe(count); }, 6000);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    status.setText("Страница не загрузилась: " + error.getDescription());
                    storeFailure("Ошибка открытия", request.getUrl() == null ? "" : request.getUrl().toString(), error.getDescription().toString());
                }
            }
        });
    }

    private void handleIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String shared = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (shared == null || shared.trim().isEmpty()) shared = intent.getStringExtra(Intent.EXTRA_HTML_TEXT);
        if (shared == null || shared.trim().isEmpty()) return;
        String url = firstHttps(shared);
        if (url == null) {
            urlInput.setText(shared);
            status.setText("Ссылка HTTPS не обнаружена.");
            return;
        }
        urlInput.setText(url);
        openUrl(url);
    }

    private static String firstHttps(String text) {
        if (text == null) return null;
        Matcher matcher = LINK.matcher(text);
        if (!matcher.find()) return null;
        String candidate = matcher.group();
        while (candidate.endsWith(".") || candidate.endsWith(",") || candidate.endsWith(")") || candidate.endsWith("]")) {
            candidate = candidate.substring(0, candidate.length() - 1);
        }
        return candidate;
    }

    private void openUrl(String text) {
        String url = firstHttps(text);
        if (url == null) {
            status.setText("Нужна HTTPS-ссылка.");
            return;
        }
        try {
            Uri parsed = Uri.parse(url);
            if (!"https".equalsIgnoreCase(parsed.getScheme()) || parsed.getHost() == null) {
                status.setText("Разрешены только HTTPS-страницы.");
                return;
            }
            urlInput.setText(url);
            showingHistory = false;
            renderLowerContent();
            browser.loadUrl(url);
        } catch (Exception ex) {
            status.setText("Некорректная ссылка.");
        }
    }

    private void probe(int count) {
        if (browser == null || browser.getUrl() == null) {
            status.setText("Сначала открой страницу.");
            return;
        }
        status.setText("Считываю данные открытой страницы…");
        browser.evaluateJavascript(probeScript, value -> {
            if (count != navigationCounter) return;
            try {
                Object decoded = new JSONTokener(value).nextValue();
                String objectText = decoded instanceof String ? (String) decoded : String.valueOf(decoded);
                JSONObject result = new JSONObject(objectText);
                latestReport = result.toString(2);
                if (!result.has("error")) {
                    recordCapture(result);
                    String category = categoryName(result.optString("detectedCategory"));
                    String suffix = result.optBoolean("captureReady") ? "основные поля найдены" : "нужна проверка полей";
                    status.setText(category + ": " + suffix + ". Сохранено локально.");
                } else {
                    status.setText("Ошибка парсера: " + result.optString("error"));
                }
                if (!showingHistory) renderLowerContent();
                else if (historyButton != null) historyButton.setText("Результат");
            } catch (Exception ex) {
                latestReport = String.valueOf(value);
                status.setText("Ошибка обработки ответа: " + ex.getMessage());
                renderLowerContent();
            }
        });
    }

    private void storeFailure(String title, String url, String reason) {
        try {
            JSONObject failure = new JSONObject();
            failure.put("version", 4);
            failure.put("pageUrl", url);
            failure.put("detectedCategory", "unknown");
            failure.put("captureTitle", title);
            failure.put("problemHint", reason);
            failure.put("captureReady", false);
            recordCapture(failure);
        } catch (Exception ignored) {}
    }

    private void recordCapture(JSONObject result) {
        try {
            JSONObject reduced = new JSONObject();
            String[] keys = new String[]{
                "version", "sourceProvider", "detectedCategory", "externalId", "sourceUrl",
                "captureReady", "missingFields", "captureTitle", "titleSource",
                "captureImage", "capturePriceCandidate", "priceCandidates",
                "priceObservations", "structuredPrice", "imageOptions",
                "yearCandidate", "genres", "originalTitle", "problemHint", "capture", "jsonLdTypes"
            };
            for (String key : keys) if (result.has(key)) reduced.put(key, result.get(key));
            reduced.put("pageUrl", withoutTracking(result.optString("pageUrl", "")));
            reduced.put("capturedAt", System.currentTimeMillis());
            String identity = stableKey(reduced.optString("sourceUrl", reduced.optString("pageUrl")), reduced.optString("externalId"));
            reduced.put("_key", identity);

            JSONArray next = new JSONArray();
            next.put(reduced);
            for (int i = 0; i < records.length() && next.length() < MAX_RECORDS; i++) {
                JSONObject item = records.optJSONObject(i);
                if (item == null || identity.equals(item.optString("_key"))) continue;
                next.put(item);
            }
            records = next;
            saveHistory();
            if (historyButton != null && !showingHistory) historyButton.setText("История (" + records.length() + ")");
        } catch (Exception ex) {
            status.setText("Не удалось сохранить локальный результат: " + ex.getMessage());
        }
    }

    private static String stableKey(String url, String id) {
        Uri uri = Uri.parse(withoutTracking(url));
        String host = uri.getHost();
        return (host == null ? "" : host.toLowerCase()) + (uri.getPath() == null ? "" : uri.getPath()) + "|" + id;
    }

    private static String withoutTracking(String value) {
        try {
            Uri uri = Uri.parse(value);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null) return "";
            return uri.buildUpon().clearQuery().fragment(null).build().toString();
        } catch (Exception ex) { return ""; }
    }

    private JSONArray loadHistory() {
        String raw = getSharedPreferences(PREFS, MODE_PRIVATE).getString(HISTORY, "[]");
        try { return new JSONArray(raw); }
        catch (Exception ignored) { return new JSONArray(); }
    }

    private void saveHistory() {
        SharedPreferences.Editor editor = getSharedPreferences(PREFS, MODE_PRIVATE).edit();
        editor.putString(HISTORY, records.toString());
        editor.apply();
    }

    private JSONObject batch() {
        JSONObject output = new JSONObject();
        try {
            output.put("format", "advisor-android-probe");
            output.put("version", 4);
            output.put("note", "Локальные диагностические результаты. Не сохранено в Буфер.");
            output.put("captures", records);
        } catch (Exception ignored) {}
        return output;
    }

    private boolean writeCacheReport() {
        try (FileOutputStream output = new FileOutputStream(new File(getCacheDir(), "capture-report.json"))) {
            output.write(batch().toString(2).getBytes(StandardCharsets.UTF_8));
            return true;
        } catch (Exception ex) {
            status.setText("Не удалось подготовить JSON: " + ex.getMessage());
            return false;
        }
    }

    private void shareReportFile() {
        if (records.length() == 0) {
            status.setText("Сначала проверь хотя бы одну страницу.");
            return;
        }
        if (!writeCacheReport()) return;
        try {
            Uri uri = Uri.parse(REPORT_URI);
            // Do not include EXTRA_TEXT: some share targets pick the text and
            // silently drop EXTRA_STREAM, leaving only "Сводный отчёт ...".
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("application/octet-stream");
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            ClipData clip = ClipData.newRawUri("Advisor-Android-capture-report.json", uri);
            send.setClipData(clip);
            Intent chooser = Intent.createChooser(send, "Отправить JSON как файл");
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            chooser.setClipData(clip);
            startActivity(chooser);
            status.setText("Выбери приложение, которое принимает файлы. Передаётся JSON-документ.");
        } catch (Exception ex) {
            status.setText("Не удалось отправить файл: " + ex.getMessage() + ". Используй «Сохранить JSON».");
        }
    }

    private void saveReportFile() {
        if (records.length() == 0) {
            status.setText("Сначала проверь хотя бы одну страницу.");
            return;
        }
        try {
            Intent save = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            save.addCategory(Intent.CATEGORY_OPENABLE);
            save.setType("application/json");
            save.putExtra(Intent.EXTRA_TITLE, "Advisor-Android-capture-report.json");
            startActivityForResult(save, EXPORT_REQUEST);
            status.setText("Выбери «Загрузки» и нажми «Сохранить». История остаётся на телефоне.");
        } catch (Exception ex) {
            status.setText("Не удалось открыть выбор папки: " + ex.getMessage());
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != EXPORT_REQUEST) return;
        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
            status.setText("Сохранение отменено. История по-прежнему на телефоне.");
            return;
        }
        Uri uri = data.getData();
        byte[] content = batch().toString(2).getBytes(StandardCharsets.UTF_8);
        try (OutputStream stream = getContentResolver().openOutputStream(uri, "wt")) {
            if (stream == null) throw new IllegalStateException("Нет доступа к файлу");
            stream.write(content);
            stream.flush();
        } catch (Exception ex) {
            status.setText("Не удалось записать JSON: " + ex.getMessage());
            return;
        }
        try (InputStream check = getContentResolver().openInputStream(uri)) {
            if (check == null) throw new IllegalStateException("Нет доступа к записанному файлу");
            ByteArrayOutputStream verify = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int length;
            while ((length = check.read(buffer)) != -1) verify.write(buffer, 0, length);
            byte[] persisted = verify.toByteArray();
            if (persisted.length != content.length
                || new JSONObject(new String(persisted, StandardCharsets.UTF_8))
                    .getJSONArray("captures").length() != records.length()) {
                throw new IllegalStateException("Число записей или размер файла не совпадает");
            }
            status.setText("JSON сохранён: " + records.length() + " проверок, " + content.length
                + " байт. Теперь прикрепи файл в чат.");
            Toast.makeText(this, "Файл проверен: " + records.length() + " записей", Toast.LENGTH_LONG).show();
        } catch (Exception ex) {
            status.setText("JSON записан, но проверить файл не удалось: " + ex.getMessage());
        }
    }

    private void copyText(String content, String message) {
        ClipboardManager manager = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        manager.setPrimaryClip(ClipData.newPlainText("Advisor Capture Test", content));
        status.setText(message);
    }

    private String loadAsset(String file) {
        try (InputStream input = getAssets().open(file);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            return output.toString(StandardCharsets.UTF_8.name());
        } catch (Exception ex) {
            return "JSON.stringify({error: 'Не удалось загрузить probe.js'})";
        }
    }

    @Override protected void onDestroy() {
        navigationCounter++;
        browser.destroy();
        super.onDestroy();
    }
}
