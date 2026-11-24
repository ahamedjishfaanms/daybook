package org.beingtechy.daybook;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import org.json.JSONObject;

/** Fires when a reminder is due: rings, vibrates and/or shows the full-screen alarm. */
public class AlarmReceiver extends BroadcastReceiver {
    static final String EXTRA_ALARM = "alarm";
    static final String EXTRA_ACTION = "daybook_action";
    static final String EXTRA_TASK = "daybook_task";
    static final String EXTRA_NOTIF = "daybook_notif";
    private static final long RING_FOR_MS = 3 * 60 * 1000; // stop ringing after 3 minutes

    @Override
    public void onReceive(Context c, Intent intent) {
        try {
            JSONObject a = new JSONObject(intent.getStringExtra(EXTRA_ALARM));
            fire(c, a);
        } catch (Exception ignored) {}
    }

    static void fire(Context c, JSONObject a) {
        int id = a.optInt("id");
        boolean sound = a.optBoolean("sound"), vibrate = a.optBoolean("vibrate"), popup = a.optBoolean("popup");
        String channel = ensureChannel(c, sound, popup);

        Intent full = new Intent(c, AlarmActivity.class)
            .putExtra(EXTRA_ALARM, a.toString())
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
        PendingIntent fullPi = PendingIntent.getActivity(c, id, full, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder b = new NotificationCompat.Builder(c, channel)
            .setSmallIcon(R.drawable.ic_stat_daybook)
            .setColor(Color.parseColor("#1F6F5C"))
            .setContentTitle("⏰ " + a.optString("title"))
            .setContentText(a.optString("body"))
            .setStyle(new NotificationCompat.BigTextStyle().bigText(a.optString("body")))
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(popup ? NotificationCompat.PRIORITY_MAX : NotificationCompat.PRIORITY_DEFAULT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setOngoing(sound || vibrate)
            .setTimeoutAfter(RING_FOR_MS)
            .setContentIntent(popup ? fullPi : openApp(c, id, "open", a.optString("taskId")))
            .setDeleteIntent(stopPending(c, id))
            .addAction(0, "✓ Done", openApp(c, id, "done", a.optString("taskId")))
            .addAction(0, "Snooze 10 min", openApp(c, id, "snooze", a.optString("taskId")))
            .addAction(0, "Stop", stopPending(c, id));
        if (popup) b.setFullScreenIntent(fullPi, true);
        if (!sound) b.setSilent(true);

        android.app.Notification n = b.build();
        if (sound) n.flags |= android.app.Notification.FLAG_INSISTENT; // keep ringing until you respond
        try {
            NotificationManagerCompat.from(c).notify(id, n);
        } catch (SecurityException ignored) {} // notifications permission not granted

        if (vibrate) vibrate(c);
    }

    /** One channel per (sound, popup). Alarm audio stream, so it uses the alarm volume. */
    static String ensureChannel(Context c, boolean sound, boolean popup) {
        String id = "daybook_alarm_" + (sound ? "s" : "q") + (popup ? "p" : "n");
        if (Build.VERSION.SDK_INT < 26) return id;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(id) != null) return id;
        String name = (sound ? "Ringing" : "Silent") + " reminders" + (popup ? " (pop-up)" : "");
        NotificationChannel ch = new NotificationChannel(id, name,
            popup ? NotificationManager.IMPORTANCE_HIGH : NotificationManager.IMPORTANCE_DEFAULT);
        ch.setDescription("Daybook task reminders");
        ch.enableVibration(false); // vibration is done directly (see vibrate()), so phone settings can't mute it
        ch.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        ch.setBypassDnd(true);
        if (sound) {
            Uri uri = Uri.parse("android.resource://" + c.getPackageName() + "/" + R.raw.daybook_alarm);
            ch.setSound(uri, new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build());
        } else {
            ch.setSound(null, null);
        }
        nm.createNotificationChannel(ch);
        return id;
    }

    /** About a minute of strong pulses, sent as an ALARM vibration. */
    static void vibrate(Context c) {
        Vibrator v = vibrator(c);
        if (v == null || !v.hasVibrator()) return;
        long[] cycle = {0, 900, 500, 900, 500, 900, 1300};
        long[] pattern = new long[1 + (cycle.length - 1) * 12];
        int k = 0;
        pattern[k++] = 0;
        for (int r = 0; r < 12; r++) for (int i = 1; i < cycle.length; i++) pattern[k++] = cycle[i];
        if (Build.VERSION.SDK_INT >= 33) {
            v.vibrate(VibrationEffect.createWaveform(pattern, -1),
                VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM));
        } else if (Build.VERSION.SDK_INT >= 26) {
            v.vibrate(VibrationEffect.createWaveform(pattern, -1),
                new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build());
        } else {
            v.vibrate(pattern, -1);
        }
    }

    /** Silence a ringing reminder (sound, vibration and notification). */
    static void stop(Context c, int id) {
        NotificationManagerCompat.from(c).cancel(id);
        Vibrator v = vibrator(c);
        if (v != null) v.cancel();
    }

    private static Vibrator vibrator(Context c) {
        if (Build.VERSION.SDK_INT >= 31) {
            VibratorManager vm = (VibratorManager) c.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            return vm == null ? null : vm.getDefaultVibrator();
        }
        return (Vibrator) c.getSystemService(Context.VIBRATOR_SERVICE);
    }

    /** Opens Daybook and tells the web app what to do (open / done / snooze). */
    static PendingIntent openApp(Context c, int id, String action, String taskId) {
        Intent i = new Intent(c, MainActivity.class)
            .setAction("org.beingtechy.daybook." + action)
            .putExtra(EXTRA_ACTION, action)
            .putExtra(EXTRA_TASK, taskId)
            .putExtra(EXTRA_NOTIF, id)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, id * 4 + action.length(), i,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static PendingIntent stopPending(Context c, int id) {
        Intent i = new Intent(c, StopReceiver.class).putExtra(EXTRA_NOTIF, id);
        return PendingIntent.getBroadcast(c, id, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
