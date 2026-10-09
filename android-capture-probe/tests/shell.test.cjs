const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const main=fs.readFileSync('android-capture-probe/app/src/main/java/online/moyadvisor/captureprobe/MainActivity.java','utf8');
const queue=fs.readFileSync('android-capture-probe/app/src/main/java/online/moyadvisor/captureprobe/PendingCaptureStore.java','utf8');
const manifest=fs.readFileSync('android-capture-probe/app/src/main/AndroidManifest.xml','utf8');
test('ordinary Advisor occupies entire screen and native toolbar is absent',()=>{
  assert.match(main,/setContentView\(root\)/);
  assert.match(main,/root\.addView\(advisor, new FrameLayout\.LayoutParams\(-1, -1\)\)/);
  assert.doesNotMatch(main,/addButton\(toolbar|Button.*"Буфер"|Button.*"Advisor"/);
  assert.match(main,/captureLayer\.setVisibility\(View\.GONE\)/);
  assert.match(main,/if \(isSharedIntent\(getIntent\(\)\)\)/);
});
test('shared links do not contact the Advisor server on cold launch',()=>{
  assert.match(main,/if \(isSharedIntent\(getIntent\(\)\)\) \{\s*handleSharedIntent\(getIntent\(\)\);\s*\} else \{\s*openAdvisor\(\);/);
  assert.match(main,/source\.loadUrl\(url\)/);
  assert.match(main,/getAssets\(\)\.open\("shared-parser\.js"\)/);
  assert.doesNotMatch(main,/HttpURLConnection|new URL\(ORIGIN/);
});
test('browser auth and writes retain the same web session',()=>{
  assert.match(main,/advisor\.evaluateJavascript\(script, ignored -> pollSession/);
  assert.match(main,/fetch\('\/api\/android-capture\/session',\{credentials:'same-origin',cache:'no-store'\}\)/);
  assert.match(main,/method:'POST',credentials:'same-origin'/);
  assert.match(main,/pending\.setVerifiedOwner\(verified\)/);
  assert.match(main,/pending\.firstFor\(owner\)/);
  assert.match(main,/savedId:body\.saved\?\.id/);
  assert.match(main,/pending\.remove\(owner, itemId\)/);
});
test('capture UI only on share, local queue is owner-scoped and persistent',()=>{
  assert.match(main,/showCapture\(true\)/);
  assert.match(main,/saveButton = button\("Сохранить"/);
  assert.match(queue,/SharedPreferences/);
  assert.match(queue,/owner\.equals\(entry\.optString\("owner"\)\)/);
  assert.match(queue,/if \(!validOwner\(owner\)/);
  assert.match(manifest,/online\.moyadvisor\.captureprobe\.MainActivity|\.MainActivity/);
});
test('web file chooser is supported and source has no native JS bridge',()=>{
  assert.match(main,/onShowFileChooser/);
  assert.match(main,/FileChooserParams\.parseResult/);
  assert.doesNotMatch(main,/addJavascriptInterface/);
});
