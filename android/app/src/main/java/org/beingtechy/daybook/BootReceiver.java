package org.beingtechy.daybook;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Android clears alarms on reboot; put Daybook's reminders back. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        AlarmScheduler.restore(c);
    }
}
