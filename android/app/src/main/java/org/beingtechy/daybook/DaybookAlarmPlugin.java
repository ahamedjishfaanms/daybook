package org.beingtechy.daybook;

import android.app.NotificationManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONObject;

/** JavaScript bridge: window.Capacitor "DaybookAlarm". */
@CapacitorPlugin(name = "DaybookAlarm")
public class DaybookAlarmPlugin extends Plugin {

    /** schedule({ alarms: [{id, taskId, title, body, at, sound, vibrate, popup}] }) — replaces all. */
    @PluginMethod
    public void schedule(PluginCall call) {
        JSArray list = call.getArray("alarms", new JSArray());
        try {
            AlarmScheduler.scheduleAll(getContext(), new JSONArray(list.toString()));
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not schedule alarms: " + e.getMessage());
        }
    }

    @PluginMethod
    public void cancelAll(PluginCall call) {
        AlarmScheduler.cancelAll(getContext());
        call.resolve();
    }

    /** stop({ id }) — silence a ringing reminder. */
    @PluginMethod
    public void stop(PluginCall call) {
        AlarmReceiver.stop(getContext(), call.getInt("id", 0));
        call.resolve();
    }

    /** test({ title, body, sound, vibrate, popup, delaySeconds }) — fires a one-off alarm. */
    @PluginMethod
    public void test(PluginCall call) {
        try {
            JSONObject a = new JSONObject();
            a.put("id", 424242);
            a.put("taskId", "test");
            a.put("title", call.getString("title", "Test reminder"));
            a.put("body", call.getString("body", "This is how Daybook reminds you."));
            a.put("sound", call.getBoolean("sound", true));
            a.put("vibrate", call.getBoolean("vibrate", true));
            a.put("popup", call.getBoolean("popup", true));
            a.put("at", System.currentTimeMillis() + 1000L * call.getInt("delaySeconds", 5));
            AlarmScheduler.setOne(getContext(), a);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    /** Android 14+: may the app show full-screen alarms? */
    @PluginMethod
    public void canFullScreen(PluginCall call) {
        boolean ok = true;
        if (Build.VERSION.SDK_INT >= 34) {
            NotificationManager nm = getContext().getSystemService(NotificationManager.class);
            ok = nm != null && nm.canUseFullScreenIntent();
        }
        JSObject r = new JSObject();
        r.put("granted", ok);
        call.resolve(r);
    }

    @PluginMethod
    public void openFullScreenSettings(PluginCall call) {
        try {
            Intent i;
            if (Build.VERSION.SDK_INT >= 34) {
                i = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
                    Uri.parse("package:" + getContext().getPackageName()));
            } else {
                i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + getContext().getPackageName()));
            }
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        } catch (Exception ignored) {}
        call.resolve();
    }

    /** Daybook opened from an alarm button: tell the web app (kept until it starts listening). */
    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent == null) return;
        String action = intent.getStringExtra(AlarmReceiver.EXTRA_ACTION);
        if (action == null) return;
        AlarmReceiver.stop(getContext(), intent.getIntExtra(AlarmReceiver.EXTRA_NOTIF, 0));
        JSObject data = new JSObject();
        data.put("action", action);
        data.put("taskId", intent.getStringExtra(AlarmReceiver.EXTRA_TASK));
        intent.removeExtra(AlarmReceiver.EXTRA_ACTION); // handle once
        notifyListeners("alarmAction", data, true);
    }
}
