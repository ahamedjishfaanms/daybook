package org.beingtechy.daybook;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.text.DateFormat;
import java.util.Date;
import org.json.JSONObject;

/** Full-screen alarm page: shows over the lock screen and wakes the screen up. */
public class AlarmActivity extends Activity {
    private static final int GREEN = Color.parseColor("#1F6F5C");
    private static final int GREEN_DARK = Color.parseColor("#154E41");
    private static final int CREAM = Color.parseColor("#F4F3EF");
    private int notifId;
    private String taskId = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        showOverLockScreen();

        JSONObject a;
        try {
            a = new JSONObject(getIntent().getStringExtra(AlarmReceiver.EXTRA_ALARM));
        } catch (Exception e) {
            finish();
            return;
        }
        notifId = a.optInt("id");
        taskId = a.optString("taskId");

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setBackgroundColor(GREEN);
        int pad = dp(28);
        root.setPadding(pad, dp(72), pad, dp(40));

        TextView bell = text("⏰", 64, Color.WHITE, false);
        root.addView(bell);

        TextView clock = text(DateFormat.getTimeInstance(DateFormat.SHORT).format(new Date()), 64, Color.WHITE, true);
        clock.setPadding(0, dp(8), 0, 0);
        root.addView(clock);

        TextView title = text(a.optString("title"), 28, Color.WHITE, true);
        title.setPadding(0, dp(18), 0, 0);
        title.setMaxLines(4);
        title.setEllipsize(TextUtils.TruncateAt.END);
        root.addView(title);

        TextView body = text(a.optString("body"), 17, Color.argb(220, 255, 255, 255), false);
        body.setPadding(0, dp(10), 0, 0);
        body.setMaxLines(5);
        root.addView(body);

        View spacer = new View(this);
        root.addView(spacer, new LinearLayout.LayoutParams(1, 0, 1f));

        root.addView(button("✓  Mark done", CREAM, GREEN, v -> act("done")), full(dp(60)));
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams half = new LinearLayout.LayoutParams(0, dp(56), 1f);
        half.setMargins(0, 0, dp(6), 0);
        row.addView(button("Snooze 10 min", GREEN_DARK, Color.WHITE, v -> act("snooze")), half);
        LinearLayout.LayoutParams half2 = new LinearLayout.LayoutParams(0, dp(56), 1f);
        half2.setMargins(dp(6), 0, 0, 0);
        row.addView(button("Open task", GREEN_DARK, Color.WHITE, v -> act("open")), half2);
        LinearLayout.LayoutParams rowLp = full(dp(56));
        rowLp.setMargins(0, dp(12), 0, 0);
        root.addView(row, rowLp);

        Button dismiss = button("Dismiss", GREEN, Color.argb(200, 255, 255, 255), v -> {
            AlarmReceiver.stop(this, notifId);
            finish();
        });
        LinearLayout.LayoutParams dLp = full(dp(52));
        dLp.setMargins(0, dp(8), 0, 0);
        root.addView(dismiss, dLp);

        setContentView(root);
    }

    /** Stop ringing, then open Daybook so the web app records Done / Snooze. */
    private void act(String action) {
        AlarmReceiver.stop(this, notifId);
        Intent i = new Intent(this, MainActivity.class)
            .setAction("org.beingtechy.daybook." + action)
            .putExtra(AlarmReceiver.EXTRA_ACTION, action)
            .putExtra(AlarmReceiver.EXTRA_TASK, taskId)
            .putExtra(AlarmReceiver.EXTRA_NOTIF, notifId)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(i);
        finish();
    }

    @Override
    public void onBackPressed() {
        // Back = dismiss, like a clock app
        AlarmReceiver.stop(this, notifId);
        super.onBackPressed();
    }

    private void showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = getSystemService(KeyguardManager.class);
            if (km != null) km.requestDismissKeyguard(this, null);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setStatusBarColor(GREEN);
        getWindow().setNavigationBarColor(GREEN);
    }

    private TextView text(String s, int sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        t.setGravity(Gravity.CENTER);
        if (bold) t.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        return t;
    }

    private Button button(String label, int bg, int fg, View.OnClickListener l) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        b.setTextColor(fg);
        b.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        GradientDrawable d = new GradientDrawable();
        d.setColor(bg);
        d.setCornerRadius(dp(16));
        b.setBackground(d);
        b.setStateListAnimator(null);
        b.setOnClickListener(l);
        return b;
    }

    private LinearLayout.LayoutParams full(int h) {
        return new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, h);
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
