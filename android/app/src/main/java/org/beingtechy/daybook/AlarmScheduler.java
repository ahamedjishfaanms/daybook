package org.beingtechy.daybook;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Keeps the list of upcoming reminders in AlarmManager (and in SharedPreferences, so they can be
 * restored after a reboot). Each alarm is a JSON object:
 * {id:int, taskId, title, body, at:epochMillis, sound:bool, vibrate:bool, popup:bool}
 */
public final class AlarmScheduler {
    static final String ACTION_FIRE = "org.beingtechy.daybook.ALARM";
    private static final String PREFS = "daybook_alarms";
    private static final String KEY = "alarms";

    private AlarmScheduler() {}

    /** Replace every scheduled reminder with this list. */
    public static synchronized void scheduleAll(Context c, JSONArray alarms) {
        cancelStored(c);
        JSONArray kept = new JSONArray();
        long now = System.currentTimeMillis();
        for (int i = 0; i < alarms.length(); i++) {
            JSONObject a = alarms.optJSONObject(i);
            if (a == null || a.optLong("at") <= now) continue;
            set(c, a);
            kept.put(a);
        }
        prefs(c).edit().putString(KEY, kept.toString()).apply();
    }

    public static synchronized void cancelAll(Context c) {
        cancelStored(c);
        prefs(c).edit().remove(KEY).apply();
    }

    /** After a reboot or app update: put the stored reminders back. */
    public static synchronized void restore(Context c) {
        try {
            scheduleAll(c, new JSONArray(prefs(c).getString(KEY, "[]")));
        } catch (Exception ignored) {}
    }

    /** Schedule one alarm without touching the stored list (used by "Test my alarm"). */
    public static void setOne(Context c, JSONObject a) {
        set(c, a);
    }

    private static void set(Context c, JSONObject a) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        int id = a.optInt("id");
        long at = a.optLong("at");
        PendingIntent fire = firePending(c, id, a.toString(), PendingIntent.FLAG_UPDATE_CURRENT);
        boolean exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
        if (exact) {
            // Same API alarm-clock apps use: exact, and allowed to fire in battery-saving (Doze) mode.
            Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            PendingIntent show = PendingIntent.getActivity(c, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, show), fire);
        } else if (Build.VERSION.SDK_INT >= 23) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, fire);
        } else {
            am.set(AlarmManager.RTC_WAKEUP, at, fire);
        }
    }

    private static void cancelStored(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        try {
            JSONArray old = new JSONArray(prefs(c).getString(KEY, "[]"));
            for (int i = 0; i < old.length(); i++) {
                JSONObject a = old.optJSONObject(i);
                if (a == null) continue;
                PendingIntent pi = firePending(c, a.optInt("id"), null, PendingIntent.FLAG_NO_CREATE);
                if (pi != null) {
                    am.cancel(pi);
                    pi.cancel();
                }
            }
        } catch (Exception ignored) {}
    }

    private static PendingIntent firePending(Context c, int id, String json, int flag) {
        Intent i = new Intent(c, AlarmReceiver.class).setAction(ACTION_FIRE);
        if (json != null) i.putExtra(AlarmReceiver.EXTRA_ALARM, json);
        return PendingIntent.getBroadcast(c, id, i, flag | PendingIntent.FLAG_IMMUTABLE);
    }

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
