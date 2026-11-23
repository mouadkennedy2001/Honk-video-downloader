package app.wasel.downloader;

import com.getcapacitor.JSObject;

import org.json.JSONObject;

/** Static entry point used by the Python engine to reach the Capacitor plugin. */
public final class ProgressBridge {
    static volatile YtdlpPlugin plugin;

    private ProgressBridge() {}

    public static void emit(String json) {
        YtdlpPlugin current = plugin;
        if (current == null) return;
        try {
            JSONObject object = new JSONObject(json);
            String type = object.optString("type", "progress");
            current.emitToJs(type, new JSObject(json));
        } catch (Exception ignored) {
            // The WebView may not be attached yet during early startup.
        }
    }
}
