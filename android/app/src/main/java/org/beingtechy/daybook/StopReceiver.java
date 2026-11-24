package org.beingtechy.daybook;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** "Stop" on the notification, or the notification swiped away: silence it. */
public class StopReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        AlarmReceiver.stop(c, intent.getIntExtra(AlarmReceiver.EXTRA_NOTIF, 0));
    }
}
