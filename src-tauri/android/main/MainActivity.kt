package io.github.arcj137442.systorch

import android.app.ActivityManager
import android.graphics.BitmapFactory
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import io.github.arcj137442.systorch.keepalive.RuntimeKeepaliveState

/** Tauri activity with an explicit task/recents icon. */
open class MainActivity : TauriActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        intent?.let { RuntimeKeepaliveState.acceptGatewayToggleIntent(this, it) }
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // WebView's CSS safe-area values can be zero under enforced Android
        // edge-to-edge. Apply the actual native bars/cutout/IME once at the root,
        // so the first navigation row and composer remain reachable.
        val content = findViewById<android.view.View>(android.R.id.content)
        ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard.bottom))
            WindowInsetsCompat.CONSUMED
        }
        ViewCompat.requestApplyInsets(content)
        updateTaskDescription()
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        updateTaskDescription()
    }

    private fun updateTaskDescription() {
        // Use a dedicated opaque raster so Android does not fall back to the
        // adaptive-icon template when rendering the recent-tasks card.
        val icon = BitmapFactory.decodeResource(resources, R.drawable.ic_task)
        if (icon != null) {
            setTaskDescription(ActivityManager.TaskDescription(getString(R.string.app_name), icon))
        }
    }
}
