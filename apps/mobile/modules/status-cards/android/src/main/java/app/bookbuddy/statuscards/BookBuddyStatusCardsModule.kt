package app.bookbuddy.statuscards

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.service.notification.StatusBarNotification
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

private const val CHANNEL = "bookbuddy-status-cards"
private const val TAG = "bookbuddy-status-card"
private const val NUMBER = 1
private const val CARD_ID = "app.bookbuddy.statuscards.cardId"
private const val EXPIRES = "app.bookbuddy.statuscards.expiresAt"

class BookBuddyStatusCardsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BookBuddyStatusCards")

    AsyncFunction("start") { id: String, json: String ->
      val activity = appContext.currentActivity
      val context = appContext.reactContext
      if (context == null || activity == null || activity.isFinishing || activity.isDestroyed || existing(context) != null) false
      else post(context, id, JSONObject(json))
    }

    AsyncFunction("update") { id: String, json: String ->
      val context = appContext.reactContext
      if (context == null || existing(context)?.notification?.extras?.getString(CARD_ID) != id) false
      else post(context, id, JSONObject(json))
    }

    AsyncFunction("redact") { id: String ->
      val context = appContext.reactContext
      val current = context?.let(::existing)?.notification
      if (context == null || current == null || current.extras.getString(CARD_ID) != id || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) false
      else {
        val fallback = current.publicVersion
        val remaining = current.extras.getLong(EXPIRES) - System.currentTimeMillis()
        if (remaining <= 0) {
          manager(context).cancel(TAG, NUMBER)
          false
        } else {
          if (fallback != null) {
            val clean = Notification.Builder.recoverBuilder(context, fallback)
              .setVisibility(Notification.VISIBILITY_PRIVATE)
              .setOnlyAlertOnce(true)
              .setTimeoutAfter(remaining)
              .build()
            manager(context).notify(TAG, NUMBER, clean)
          }
          true
        }
      }
    }

    AsyncFunction("stop") { id: String ->
      appContext.reactContext?.let { context ->
        if (existing(context)?.notification?.extras?.getString(CARD_ID) == id) manager(context).cancel(TAG, NUMBER)
      }
      Unit
    }

    AsyncFunction("clear") { keeping: String? ->
      val context = appContext.reactContext
      val current = context?.let(::existing)
      if (context == null || current == null) false
      else if (keeping != null && current.notification.extras.getString(CARD_ID) == keeping) true
      else {
        manager(context).cancel(TAG, NUMBER)
        false
      }
    }
  }

  private fun manager(context: Context) = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  private fun existing(context: Context): StatusBarNotification? =
    manager(context).activeNotifications.firstOrNull { it.tag == TAG && it.id == NUMBER }

  private fun post(context: Context, id: String, card: JSONObject): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false // Android OS timeouts require API 26.
    val manager = manager(context)
    if (!manager.areNotificationsEnabled() || (manager.getNotificationChannel(CHANNEL)?.importance ?: 0) == NotificationManager.IMPORTANCE_NONE) return false
    val url = Uri.parse(card.getString("url"))
    val path = url.path ?: return false
    if (url.scheme != "bookbuddy" || !url.host.isNullOrEmpty() || !(path.startsWith("/c/jobs/") ||
        path.startsWith("/c/session-bookings/") || path.startsWith("/w/shifts/") || path.startsWith("/f/cover/"))) return false
    val launcher = context.packageManager.getLaunchIntentForPackage(context.packageName)?.component ?: return false
    val open = Intent(Intent.ACTION_VIEW, url).setComponent(launcher)
      .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val tap = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val now = System.currentTimeMillis()
    val expiresAt = card.getLong("expiresAt")
    if (expiresAt <= now) {
      manager.cancel(TAG, NUMBER)
      return false
    }
    val staleAt = card.getLong("staleAt")
    val preview = card.getJSONObject("preview")
    val details = card.optJSONObject("details")
    val publicPreview = if (now >= staleAt) card.optJSONObject("stalePreview") ?: preview else preview
    val privatePreview = if (now >= staleAt) card.optJSONObject("staleDetails") ?: publicPreview else details ?: publicPreview
    // Expo provisions the isolated channel and permission. Use the platform's ordinary builder for the
    // OS timeout, a public fallback, and separate collapsed and expanded copy (not exposed by Expo).
    val deadline = if (now < staleAt) minOf(staleAt, expiresAt) else expiresAt
    val fallback = render(context, publicPreview, id, tap, deadline, now)
    val notification = if (privatePreview === publicPreview) fallback else render(context, privatePreview, id, tap, deadline, now, fallback)
    manager.notify(TAG, NUMBER, notification)
    return true
  }

  @android.annotation.TargetApi(Build.VERSION_CODES.O)
  private fun render(context: Context, model: JSONObject, id: String, tap: PendingIntent, expiresAt: Long, now: Long, publicVersion: Notification? = null): Notification {
    val summary = model.getString("summary")
    val expanded = if (model.isNull("expanded")) summary else summary + "\n" + model.getString("expanded")
    val builder = Notification.Builder(context, CHANNEL)
      .setSmallIcon(android.R.drawable.ic_popup_reminder)
      .setContentTitle(model.getString("title"))
      .setContentText(summary)
      .setStyle(Notification.BigTextStyle().bigText(expanded))
      .setContentIntent(tap)
      .setOngoing(true)
      .setAutoCancel(false)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setVisibility(Notification.VISIBILITY_PRIVATE)
      .setTimeoutAfter(expiresAt - now)
      .setExtras(Bundle().apply { putString(CARD_ID, id); putLong(EXPIRES, expiresAt) })
    if (publicVersion != null) builder.setPublicVersion(publicVersion)
    if (!model.isNull("steps")) builder.setProgress(model.getInt("steps"), model.getInt("progress"), false)
    if (!model.isNull("timerFrom")) {
      builder.setWhen(model.getLong("timerFrom")).setShowWhen(true).setUsesChronometer(true)
    } else if (!model.isNull("timerUntil") && model.getLong("timerUntil") == expiresAt) {
      builder.setWhen(expiresAt).setShowWhen(true).setUsesChronometer(true).setChronometerCountDown(true)
    }
    return builder.build()
  }
}
