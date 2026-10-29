package io.github.arcj137442.systorch.keepalive

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.service.quicksettings.TileService

internal object RuntimeKeepaliveState {
    @Volatile var foregroundServiceActive: Boolean = false
    const val EXTRA_TOGGLE_GATEWAY = "jev-switch.toggle-gateway"
    const val EXTRA_GATEWAY_RUNNING = "jev-switch.gateway-running"
    private const val PREFS_NAME = "jev-switch.keepalive"
    private const val KEY_ENABLED = "enabled"
    private const val KEY_GATEWAY_RUNNING = "gateway-running"
    private const val KEY_PENDING_GATEWAY_TOGGLE = "pending-gateway-toggle"

    fun setState(context: Context, enabled: Boolean, gatewayRunning: Boolean) {
        prefs(context).edit()
            .putBoolean(KEY_ENABLED, enabled)
            .putBoolean(KEY_GATEWAY_RUNNING, gatewayRunning)
            .apply()
        reconcile(context)
        requestTileRefresh(context)
    }

    fun enabled(context: Context): Boolean = prefs(context).getBoolean(KEY_ENABLED, true)

    fun gatewayRunning(context: Context): Boolean = prefs(context).getBoolean(KEY_GATEWAY_RUNNING, false)

    fun markPendingGatewayToggle(context: Context) {
        prefs(context).edit().putBoolean(KEY_PENDING_GATEWAY_TOGGLE, true).apply()
    }

    fun acceptGatewayToggleIntent(context: Context, intent: Intent): Boolean {
        if (!intent.getBooleanExtra(EXTRA_TOGGLE_GATEWAY, false)) return false
        // The same Activity intent can be reused during recreation. Accept a
        // gesture once, whether this is a cold launch or onNewIntent.
        intent.removeExtra(EXTRA_TOGGLE_GATEWAY)
        markPendingGatewayToggle(context)
        return true
    }

    fun takePendingGatewayToggle(context: Context): Boolean {
        val preferences = prefs(context)
        val pending = preferences.getBoolean(KEY_PENDING_GATEWAY_TOGGLE, false)
        if (pending) preferences.edit().putBoolean(KEY_PENDING_GATEWAY_TOGGLE, false).apply()
        return pending
    }

    fun reconcile(context: Context) {
        if (enabled(context) && gatewayRunning(context)) {
            val intent = serviceIntent(context)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
            else context.startService(intent)
        } else {
            context.stopService(serviceIntent(context))
        }
    }

    fun requestTileRefresh(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            TileService.requestListeningState(
                context,
                ComponentName(context.packageName, "io.github.arcj137442.jevswitch.keepalive.JevGatewayTileService"),
            )
        }
    }

    fun launchIntent(context: Context, toggle: Boolean = true): Intent? {
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
        return launch.apply {
            putExtra(EXTRA_TOGGLE_GATEWAY, toggle)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
    }

    // Installed components are compatibility anchors, unlike the implementation
    // package. Keep old notifications, pinned launcher entries and QS tiles valid.
    private fun serviceIntent(context: Context) = Intent().setClassName(
        context.packageName, "io.github.arcj137442.jevswitch.keepalive.JevKeepaliveService"
    )

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
}
