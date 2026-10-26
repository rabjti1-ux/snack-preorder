package com.snackpreorder.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;

/**
 * 零食预订 APP：用系统 WebView 打开店铺网页。
 * 客户版打开店铺首页，商家版打开 /admin（由打包配置决定）。
 * 额外做了：选图片上传、拨打电话、返回键、连不上服务器时修改地址、系统通知。
 */
public class MainActivity extends Activity {

    private static final int REQ_FILE = 1001;
    private static final int REQ_NOTIFY = 1002;
    private static final String CHANNEL_ID = "orders";
    private static final String PREFS = "snack";
    private static final String KEY_SERVER = "server";

    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private boolean errorShown = false;
    private boolean inForeground = false;
    private int noticeId = 1;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (BuildConfig.IS_MERCHANT) {
            // 商家版：打开时屏幕常亮，方便营业时随时看到新订单
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }

        webView = new WebView(this);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                 // 客户身份和购物车存在 localStorage
        s.setMediaPlaybackRequiresUserGesture(false); // 新订单提示音
        s.setTextZoom(100);
        s.setUserAgentString(s.getUserAgentString() + " SnackPreorderApp/" + BuildConfig.VERSION_NAME);

        webView.addJavascriptInterface(new Bridge(), "SnackApp");
        webView.setWebViewClient(new Client());
        webView.setWebChromeClient(new Chrome());

        createChannel();
        askNotificationPermission();
        load();
    }

    // ---------- 服务器地址 ----------

    private String serverUrl() {
        SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        String url = p.getString(KEY_SERVER, "");
        if (url == null || url.isEmpty()) url = BuildConfig.SERVER_URL;
        url = url.trim();
        while (url.endsWith("/")) url = url.substring(0, url.length() - 1);
        return url;
    }

    private boolean isConfigured(String url) {
        return (url.startsWith("http://") || url.startsWith("https://")) && !url.contains("请改成");
    }

    private void load() {
        errorShown = false;
        String base = serverUrl();
        if (!isConfigured(base)) {
            askServer();
            return;
        }
        webView.loadUrl(base + BuildConfig.START_PATH);
    }

    private boolean isOwnPage(Uri u) {
        String scheme = u.getScheme();
        if (!"http".equals(scheme) && !"https".equals(scheme)) return false;
        Uri base = Uri.parse(serverUrl());
        return u.getHost() != null && u.getHost().equalsIgnoreCase(base.getHost()) && u.getPort() == base.getPort();
    }

    private void openExternal(Uri u) {
        Intent i = "tel".equals(u.getScheme()) ? new Intent(Intent.ACTION_DIAL, u) : new Intent(Intent.ACTION_VIEW, u);
        try {
            startActivity(i);
        } catch (Exception ignored) {
            // 手机上没有能打开这个链接的应用
        }
    }

    private void showError(String detail) {
        if (errorShown || isFinishing()) return;
        errorShown = true;
        new AlertDialog.Builder(this)
                .setTitle("连不上店铺")
                .setMessage("请检查手机网络。如果店铺服务器的地址变了，点「修改地址」。\n\n当前地址：" + serverUrl()
                        + (detail == null || detail.isEmpty() ? "" : "\n（" + detail + "）"))
                .setCancelable(false)
                .setPositiveButton("重试", (d, w) -> load())
                .setNegativeButton("修改地址", (d, w) -> askServer())
                .show();
    }

    private void askServer() {
        if (isFinishing()) return;
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setSingleLine(true);
        input.setHint("例如 http://192.168.1.23:3000");
        String cur = serverUrl();
        if (isConfigured(cur)) input.setText(cur);
        int pad = (int) (20 * getResources().getDisplayMetrics().density);
        FrameLayout box = new FrameLayout(this);
        box.setPadding(pad, pad / 2, pad, 0);
        box.addView(input);
        new AlertDialog.Builder(this)
                .setTitle("店铺地址")
                .setMessage("填写店主给你的网址")
                .setView(box)
                .setCancelable(false)
                .setPositiveButton("保存", (d, w) -> {
                    String v = input.getText().toString().trim();
                    if (!v.isEmpty() && !v.startsWith("http://") && !v.startsWith("https://")) v = "http://" + v;
                    getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_SERVER, v).apply();
                    load();
                })
                .setNegativeButton("用默认地址", (d, w) -> {
                    getSharedPreferences(PREFS, MODE_PRIVATE).edit().remove(KEY_SERVER).apply();
                    load();
                })
                .show();
    }

    // ---------- 网页行为 ----------

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            if (isOwnPage(u)) return false; // 店铺自己的页面在 APP 里打开
            openExternal(u);                // 电话、其他网站交给系统
            return true;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) {
                CharSequence d = error.getDescription();
                showError(d == null ? "" : d.toString());
            }
        }
    }

    private class Chrome extends WebChromeClient {
        // 商家上传商品图片时，打开相册选图
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            try {
                startActivityForResult(params.createIntent(), REQ_FILE);
                return true;
            } catch (Exception e) {
                fileCallback = null;
                return false;
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                fileCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    // ---------- 系统通知（网页通过 window.SnackApp 调用） ----------

    private class Bridge {
        /** 显示一条系统通知。onlyInBackground 为 true 时，APP 在前台就不弹（网页里已经有提示）。 */
        @JavascriptInterface
        public void showNotice(String title, String body, boolean onlyInBackground) {
            runOnUiThread(() -> {
                if (onlyInBackground && inForeground) return;
                postNotice(title, body);
            });
        }

        @JavascriptInterface
        public String version() {
            return BuildConfig.VERSION_NAME;
        }
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm == null) return;
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID,
                    BuildConfig.IS_MERCHANT ? "新订单提醒" : "预订状态提醒", NotificationManager.IMPORTANCE_HIGH);
            ch.enableVibration(true);
            nm.createNotificationChannel(ch);
        }
    }

    private void askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFY);
        }
    }

    private void postNotice(String title, String body) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL_ID)
                : legacyBuilder();
        b.setSmallIcon(R.drawable.ic_notify)
                .setContentTitle(title == null ? "" : title)
                .setContentText(body == null ? "" : body)
                .setStyle(new Notification.BigTextStyle().bigText(body == null ? "" : body))
                .setAutoCancel(true)
                .setContentIntent(pi);
        nm.notify(noticeId++, b.build());
    }

    @SuppressWarnings("deprecation")
    private Notification.Builder legacyBuilder() {
        return new Notification.Builder(this)
                .setPriority(Notification.PRIORITY_HIGH)
                .setDefaults(Notification.DEFAULT_ALL);
    }

    // ---------- 生命周期 ----------

    @Override
    protected void onResume() {
        super.onResume();
        inForeground = true;
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onPause() {
        inForeground = false;
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
