package app.wasel.downloader;

import android.content.Intent;
import android.os.Bundle;
import android.net.Uri;

import com.getcapacitor.BridgeActivity;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Single activity hosting the shared Wasel UI. */
public class MainActivity extends BridgeActivity {
    private static final Pattern URL_PATTERN = Pattern.compile("https?://[^\\s]+");

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(YtdlpPlugin.class);
        super.onCreate(savedInstanceState);
        // BridgeActivity forwards the launch intent to onNewIntent(), so the
        // share/VIEW handling below runs once without a duplicate call here.
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        String url = null;

        if (Intent.ACTION_SEND.equals(action)) {
            url = intent.getStringExtra(Intent.EXTRA_TEXT);
        } else if (Intent.ACTION_VIEW.equals(action)) {
            Uri data = intent.getData();
            if (data != null) url = data.toString();
        }

        if (url == null) return;
        Matcher matcher = URL_PATTERN.matcher(url);
        if (matcher.find()) {
            YtdlpPlugin.emitSharedLink(matcher.group());
        }
    }
}
