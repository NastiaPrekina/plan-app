const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const main = fs.readFileSync("android-capture-probe/app/src/main/java/online/moyadvisor/captureprobe/MainActivity.java","utf8");
const queue = fs.readFileSync("android-capture-probe/app/src/main/java/online/moyadvisor/captureprobe/PendingCaptureStore.java","utf8");
const manifest = fs.readFileSync("android-capture-probe/app/src/main/AndroidManifest.xml","utf8");

test("ordinary Advisor remains full-screen and capture only appears after ACTION_SEND", () => {
  assert.match(main,/root\.addView\(advisor, new FrameLayout\.LayoutParams\(-1, -1\)\)/);
  assert.match(main,/captureLayer\.setVisibility\(View\.GONE\)/);
  assert.match(main,/if \(isSharedIntent\(getIntent\(\)\)\)/);
  assert.doesNotMatch(main,/addButton\(toolbar|saveButton|setPreview\(/);
});
test("no preview or manual confirmation: sharing auto-enqueues", () => {
  assert.match(main,/result\.optBoolean\("incomplete"\) \|\| !validForAutomaticSave\(capture\)/);
  assert.match(main,/enqueueAutomatically\(capture\)/);
  assert.match(main,/pending\.enqueue\(owner, capture\)/);
  assert.doesNotMatch(main,/Button.*"Сохранить"|ScrollView scroller|Карточка готова к проверке/);
  assert.match(main,/finishShare\(true, "Ссылка принята\. Добавим в Буфер, когда Advisor будет доступен\."\)/);
});
test("shared URL never loads unavailable Advisor on cold start and returns to source app", () => {
  assert.match(main,/if \(isSharedIntent\(getIntent\(\)\)\) \{\s*handleSharedIntent\(getIntent\(\)\);\s*\} else \{\s*openAdvisor\(\);/);
  assert.match(main,/source\.loadUrl\(url\)/);
  assert.match(main,/getAssets\(\)\.open\("shared-parser\.js"\)/);
  assert.match(main,/moveTaskToBack\(true\)/);
  assert.doesNotMatch(main,/HttpURLConnection|addJavascriptInterface/);
});
test("capture is conservative without a preview, source path validated", () => {
  assert.match(main,/sameSourcePage\(origin, current\)/);
  assert.match(main,/private boolean sameSourcePage/);
  assert.match(main,/title\.length\(\) < 4/);
  assert.match(main,/capture\.optDouble\("price", 0\) > 0/);
  assert.match(main,/case "event":/);
  assert.match(main,/return !capture\.optString\("city"\)\.isEmpty\(\)/);
});
test("queue is user-scoped and only server confirmation removes entries", () => {
  assert.match(main,/fetch\('\/api\/android-capture\/session',\{credentials:'same-origin',cache:'no-store'\}\)/);
  assert.match(main,/pending\.setVerifiedOwner\(verified\)/);
  assert.match(main,/pending\.firstFor\(owner\)/);
  assert.match(main,/savedId:body\.saved\?\.id/);
  assert.match(main,/pending\.remove\(owner, itemId\)/);
  assert.match(main,/notifyUser\("Добавлено в Буфер"/);
  assert.match(queue,/owner\.equals\(entry\.optString\("owner"\)\)/);
  assert.match(queue,/if \(!validOwner\(owner\)/);
  assert.match(queue,/SharedPreferences/);
});
test("notifications are optional, web file picker and share intents remain", () => {
  assert.match(main,/Toast\.makeText/);
  assert.match(main,/checkSelfPermission\("android\.permission\.POST_NOTIFICATIONS"\)/);
  assert.match(main,/onShowFileChooser/);
  assert.match(main,/FileChooserParams\.parseResult/);
  assert.match(manifest,/android\.intent\.action\.SEND/);
  assert.match(manifest,/android\.permission\.POST_NOTIFICATIONS/);
});
