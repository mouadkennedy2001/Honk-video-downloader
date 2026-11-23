package app.wasel.downloader;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Environment;

import androidx.core.content.FileProvider;

import com.chaquo.python.PyObject;
import com.chaquo.python.Python;
import com.chaquo.python.android.AndroidPlatform;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Runs the bundled Python/yt-dlp engine inside the APK. No server involved. */
@CapacitorPlugin(name = "Ytdlp")
public class YtdlpPlugin extends Plugin {
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private Python python;
    private PyObject engine;

    @Override
    public void load() {
        super.load();
        ProgressBridge.plugin = this;
        Context context = getContext().getApplicationContext();
        if (!Python.isStarted()) {
            Python.start(new AndroidPlatform(context));
        }
        python = Python.getInstance();
        engine = python.getModule("wasel_engine");
    }

    private String downloadsDir() {
        File base = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        File dir = new File(base != null ? base : getContext().getFilesDir(), "Wasel");
        if (!dir.exists()) {
            dir.mkdirs();
        }
        return dir.getAbsolutePath();
    }

    private PyObject getEngine() {
        if (engine == null) {
            python = Python.getInstance();
            engine = python.getModule("wasel_engine");
        }
        return engine;
    }

    @PluginMethod
    public void info(PluginCall call) {
        final String url = call.getString("url", "");
        executor.execute(() -> {
            try {
                String json = getEngine().callAttr("info", url).toString();
                call.resolve(new JSObject(json));
            } catch (Exception error) {
                call.reject(message(error));
            }
        });
    }

    @PluginMethod
    public void previewUrl(PluginCall call) {
        final String url = call.getString("url", "");
        final String mode = call.getString("mode", "video");
        executor.execute(() -> {
            try {
                String json = getEngine().callAttr("preview_url", url, mode).toString();
                call.resolve(new JSObject(json));
            } catch (Exception error) {
                call.reject(message(error));
            }
        });
    }

    @PluginMethod
    public void download(PluginCall call) {
        final String options = call.getString("options", "{}");
        final String folder = downloadsDir();
        executor.execute(() -> {
            try {
                // Python starts its own thread and emits progress/done/error/cancelled.
                String json = getEngine().callAttr("download", options, folder).toString();
                call.resolve(new JSObject(json));
            } catch (Exception error) {
                call.reject(message(error));
            }
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        engineCall(call, "cancel", call.getString("id", ""));
    }

    @PluginMethod
    public void pause(PluginCall call) {
        engineCall(call, "pause", call.getString("id", ""));
    }

    @PluginMethod
    public void resume(PluginCall call) {
        engineCall(call, "resume", call.getString("id", ""));
    }

    private void engineCall(PluginCall call, String method, String id) {
        executor.execute(() -> {
            try {
                getEngine().callAttr(method, id);
                call.resolve();
            } catch (Exception error) {
                call.reject(message(error));
            }
        });
    }

    @PluginMethod
    public void openPath(PluginCall call) {
        String path = call.getString("path", "");
        try {
            File file = new File(path);
            Context context = getContext();
            Uri uri = FileProvider.getUriForFile(
                    context.getApplicationContext(),
                    context.getPackageName() + ".fileprovider",
                    file);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "*/*");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject(message(error));
        }
    }

    /** Public wrapper because Plugin.notifyListeners is protected. */
    void emitToJs(String event, JSObject data) {
        notifyListeners(event, data, false);
    }

    static void emitSharedLink(String url) {
        YtdlpPlugin current = ProgressBridge.plugin;
        if (current == null) return;
        JSObject data = new JSObject();
        data.put("url", url);
        current.notifyListeners("sharedLink", data, true);
    }

    private static String message(Exception error) {
        String text = error.getMessage();
        return text == null || text.isEmpty() ? error.getClass().getSimpleName() : text;
    }
}
