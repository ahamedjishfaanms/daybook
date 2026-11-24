package org.beingtechy.daybook;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DaybookAlarmPlugin.class); // our alarm-clock style reminders
        super.onCreate(savedInstanceState);
    }
}
