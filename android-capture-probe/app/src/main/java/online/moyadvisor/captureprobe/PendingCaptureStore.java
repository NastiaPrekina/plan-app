package online.moyadvisor.captureprobe;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.UUID;

/**
 * Durable, user-scoped outbox: no cookies, tokens, or passwords are persisted.
 * Local drafts are never uploaded for a different authenticated account.
 * remove() is called only after the server confirms a saved item ID.
 */
public final class PendingCaptureStore {
    private static final String PREFS = "advisor_android_pending_v1";
    private static final String QUEUE = "outbox";
    private static final String OWNER = "last_verified_owner";
    private static final int LIMIT = 60;
    private final SharedPreferences prefs;

    public PendingCaptureStore(Context context) {
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public synchronized String owner() {
        return prefs.getString(OWNER, "");
    }

    public synchronized void setVerifiedOwner(String userId) {
        if (!validOwner(userId)) throw new IllegalArgumentException("Invalid account");
        prefs.edit().putString(OWNER, userId).commit();
    }

    private static boolean validOwner(String userId) {
        return userId != null && userId.matches("(?i)[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}");
    }

    private JSONArray read() {
        try { return new JSONArray(prefs.getString(QUEUE, "[]")); }
        catch (Exception e) { return new JSONArray(); }
    }

    private boolean write(JSONArray array) {
        return prefs.edit().putString(QUEUE, array.toString()).commit();
    }

    public synchronized int countFor(String owner) {
        int count = 0;
        JSONArray queue = read();
        for (int i=0; i<queue.length(); i++) {
            JSONObject entry = queue.optJSONObject(i);
            if (entry != null && owner.equals(entry.optString("owner"))) count++;
        }
        return count;
    }

    public synchronized int totalCount() {
        return read().length();
    }

    public synchronized boolean enqueue(String owner, JSONObject capture) {
        if (!validOwner(owner) || capture == null) return false;
        String kind = capture.optString("kind");
        String url = capture.optString("sourceUrl");
        if (kind.isEmpty() || !url.startsWith("https://")) return false;
        JSONArray previous = read();
        JSONArray next = new JSONArray();
        for (int i=0; i<previous.length(); i++) {
            JSONObject entry = previous.optJSONObject(i);
            if (entry == null) continue;
            JSONObject earlier = entry.optJSONObject("capture");
            if (owner.equals(entry.optString("owner")) && earlier != null
                && kind.equals(earlier.optString("kind"))
                && url.equals(earlier.optString("sourceUrl"))) continue;
            next.put(entry);
        }
        if (next.length() >= LIMIT) return false;
        try {
            JSONObject entry = new JSONObject();
            entry.put("id", UUID.randomUUID().toString());
            entry.put("owner", owner);
            entry.put("capture", new JSONObject(capture.toString()));
            entry.put("createdAt", System.currentTimeMillis());
            next.put(entry);
            return write(next);
        } catch (Exception e) {
            return false;
        }
    }

    public synchronized JSONObject firstFor(String owner) {
        JSONArray queue = read();
        for (int i=0; i<queue.length(); i++) {
            JSONObject entry = queue.optJSONObject(i);
            if (entry != null && owner.equals(entry.optString("owner"))) {
                try { return new JSONObject(entry.toString()); }
                catch (Exception ignored) { return null; }
            }
        }
        return null;
    }

    public synchronized boolean remove(String owner, String id) {
        if (!validOwner(owner) || id == null) return false;
        JSONArray queue = read(), remaining = new JSONArray();
        boolean found = false;
        for (int i=0; i<queue.length(); i++) {
            JSONObject entry = queue.optJSONObject(i);
            if (entry == null) continue;
            if (owner.equals(entry.optString("owner")) && id.equals(entry.optString("id"))) {
                found = true;
                continue;
            }
            remaining.put(entry);
        }
        return found && write(remaining);
    }
}
