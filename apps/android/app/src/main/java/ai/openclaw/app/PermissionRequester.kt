package ai.openclaw.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume

class PermissionRequester internal constructor(
  private val activity: ComponentActivity,
  launcherFactory: ((Map<String, Boolean>) -> Unit) -> ActivityResultLauncher<Array<String>>,
) {
  private data class PendingPermissionRequest(
    val deferred: CompletableDeferred<Map<String, Boolean>>,
    var timedOut: Boolean = false,
  )

  private class PermissionRequestSlot(
    val launcher: ActivityResultLauncher<Array<String>>,
    var request: PendingPermissionRequest? = null,
  )

  constructor(activity: ComponentActivity) : this(
    activity = activity,
    launcherFactory = { callback ->
      activity.registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions(), callback)
    },
  )

  private val mutex = Mutex()
  private val requestSlotsLock = Any()
  private val mainHandler = Handler(Looper.getMainLooper())
  private val launchers = List(4) { createPermissionRequestSlot(launcherFactory) }

  suspend fun requestIfMissing(
    permissions: List<String>,
    timeoutMs: Long = 20_000,
  ): Map<String, Boolean> {
    return mutex.withLock {
      while (true) {
        val missing =
          permissions.filter { perm ->
            ContextCompat.checkSelfPermission(activity, perm) != PackageManager.PERMISSION_GRANTED
          }
        if (missing.isEmpty()) {
          return permissions.associateWith { true }
        }

        val needsRationale =
          missing.any { ActivityCompat.shouldShowRequestPermissionRationale(activity, it) }
        if (needsRationale) {
          val proceed = showRationaleDialog(missing)
          if (!proceed) {
            return permissions.associateWith { perm ->
              ContextCompat.checkSelfPermission(activity, perm) == PackageManager.PERMISSION_GRANTED
            }
          }
        }

        val deferred = CompletableDeferred<Map<String, Boolean>>()
        val request = PendingPermissionRequest(deferred)
        val slot = reservePermissionRequestSlot(request)
        try {
          withContext(Dispatchers.Main) {
            slot.launcher.launch(missing.toTypedArray())
          }
        } catch (err: Throwable) {
          clearPermissionRequestSlot(slot, request)
          throw err
        }

        val result =
          try {
            withTimeout(timeoutMs) { deferred.await() }
          } catch (err: TimeoutCancellationException) {
            request.timedOut = true
            throw err
          }

        val merged =
          permissions.associateWith { perm ->
            val nowGranted =
              ContextCompat.checkSelfPermission(activity, perm) == PackageManager.PERMISSION_GRANTED
            result[perm] == true || nowGranted
          }

        val denied =
          merged.filterValues { !it }.keys.filter {
            !ActivityCompat.shouldShowRequestPermissionRationale(activity, it)
          }
        if (denied.isNotEmpty()) {
          showSettingsDialog(denied)
        }

        return merged
      }
      error("unreachable")
    }
  }

  private fun createPermissionRequestSlot(
    launcherFactory: ((Map<String, Boolean>) -> Unit) -> ActivityResultLauncher<Array<String>>,
  ): PermissionRequestSlot {
    var slot: PermissionRequestSlot? = null
    val launcher = launcherFactory { result -> completePermissionRequest(checkNotNull(slot), result) }
    val created = PermissionRequestSlot(launcher)
    slot = created
    return created
  }

  private fun reservePermissionRequestSlot(request: PendingPermissionRequest): PermissionRequestSlot =
    synchronized(requestSlotsLock) {
      val slot = launchers.firstOrNull { it.request == null } ?: error("permission request launcher busy")
      slot.request = request
      slot
    }

  private fun completePermissionRequest(
    slot: PermissionRequestSlot,
    result: Map<String, Boolean>,
  ) {
    val request =
      synchronized(requestSlotsLock) {
        slot.request.also {
          slot.request = null
        }
      } ?: return
    if (request.timedOut) return
    request.deferred.complete(result)
  }

  private fun clearPermissionRequestSlot(
    slot: PermissionRequestSlot,
    request: PendingPermissionRequest,
  ) {
    synchronized(requestSlotsLock) {
      if (slot.request === request) {
        slot.request = null
      }
    }
  }

  private suspend fun showRationaleDialog(permissions: List<String>): Boolean =
    withContext(Dispatchers.Main) {
      if (activity.isFinishing || activity.isDestroyed) {
        return@withContext false
      }
      suspendCancellableCoroutine { cont ->
        val lifecycle = activity.lifecycle
        var dialog: AlertDialog? = null
        var observer: LifecycleEventObserver? = null
        val finished = AtomicBoolean(false)
        val removeObserver = {
          observer?.let(lifecycle::removeObserver)
          observer = null
        }

        fun finish(result: Boolean?) {
          if (!finished.compareAndSet(false, true)) return
          removeObserver()
          dialog?.dismiss()
          if (result != null) {
            cont.resume(result)
          }
        }
        val actualObserver =
          LifecycleEventObserver { _, event ->
            if (event != Lifecycle.Event.ON_DESTROY) return@LifecycleEventObserver
            finish(false)
          }
        observer = actualObserver
        lifecycle.addObserver(actualObserver)
        cont.invokeOnCancellation {
          mainHandler.post {
            finish(null)
          }
        }
        dialog =
          AlertDialog
            .Builder(activity)
            .setTitle("需要权限")
            .setMessage(buildRationaleMessage(permissions))
            .setPositiveButton("继续") { _, _ -> finish(true) }
            .setNegativeButton("暂不") { _, _ -> finish(false) }
            .setOnCancelListener { finish(false) }
            .show()
      }
    }

  private suspend fun showSettingsDialog(permissions: List<String>) =
    withContext(Dispatchers.Main) {
      if (activity.isFinishing || activity.isDestroyed) return@withContext
      val lifecycle = activity.lifecycle
      var dialog: AlertDialog? = null
      var observer: LifecycleEventObserver? = null
      val removeObserver = {
        observer?.let(lifecycle::removeObserver)
        observer = null
      }
      val actualObserver =
        LifecycleEventObserver { _, event ->
          if (event != Lifecycle.Event.ON_DESTROY) return@LifecycleEventObserver
          removeObserver()
          dialog?.dismiss()
        }
      observer = actualObserver
      lifecycle.addObserver(actualObserver)
      dialog =
        AlertDialog
          .Builder(activity)
          .setTitle("在设置中启用权限")
          .setMessage(buildSettingsMessage(permissions))
          .setPositiveButton("打开设置") { _, _ ->
            if (activity.isFinishing || activity.isDestroyed) return@setPositiveButton
            val intent =
              Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", activity.packageName, null),
              )
            activity.startActivity(intent)
          }.setNegativeButton("取消", null)
          .setOnDismissListener { removeObserver() }
          .show()
    }

  private fun buildRationaleMessage(permissions: List<String>): String {
    val labels = permissions.map { permissionLabel(it) }
    return "OpenClaw needs ${labels.joinToString(", ")} permissions to continue."
  }

  private fun buildSettingsMessage(permissions: List<String>): String {
    val labels = permissions.map { permissionLabel(it) }
    return "Please enable ${labels.joinToString(", ")} in Android Settings to continue."
  }

  private fun permissionLabel(permission: String): String =
    when (permission) {
      Manifest.permission.CAMERA -> "相机"
      Manifest.permission.RECORD_AUDIO -> "麦克风"
      Manifest.permission.SEND_SMS -> "Send SMS"
      Manifest.permission.READ_SMS -> "Read SMS"
      Manifest.permission.READ_CONTACTS -> "读取联系人"
      Manifest.permission.WRITE_CONTACTS -> "写入联系人"
      Manifest.permission.READ_CALENDAR -> "读取日历"
      Manifest.permission.WRITE_CALENDAR -> "写入日历"
      Manifest.permission.READ_CALL_LOG -> "读取通话记录"
      Manifest.permission.ACTIVITY_RECOGNITION -> "Motion Activity"
      Manifest.permission.READ_MEDIA_IMAGES -> "照片"
      Manifest.permission.READ_EXTERNAL_STORAGE -> "照片"
      else -> permission
    }
}
