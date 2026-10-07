package expo.modules.moloopbeacon

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Build
import android.os.ParcelUuid
import android.util.Log
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID

/**
 * The finder's radio: advertise one service UUID (the task) and scan for the other phone advertising it, sending its
 * signal strength to JS. A service UUID is the one advertisement both iOS (foreground) and Android can send and read.
 */
class MoloopBeaconModule : Module() {
  private var beacon: Beacon? = null

  override fun definition() = ModuleDefinition {
    Name("MoloopBeacon")

    Events("onSignal")

    AsyncFunction("requestPermissions") { promise: Promise ->
      val permissions = appContext.permissions
      if (permissions == null) {
        promise.resolve(false)
      } else {
        permissions.askForPermissions(
          { results -> promise.resolve(results.values.all { it.status == PermissionsStatus.GRANTED }) },
          *PERMISSIONS,
        )
      }
    }

    Function("start") { uuid: String ->
      val context = appContext.reactContext ?: throw CodedException("No Android context")
      val service = try {
        UUID.fromString(uuid)
      } catch (e: IllegalArgumentException) {
        throw CodedException("Not a UUID: $uuid", e)
      }
      beacon?.stop()
      beacon = Beacon(context, service) { rssi ->
        sendEvent("onSignal", mapOf("rssi" to rssi, "at" to System.currentTimeMillis().toDouble()))
      }.also { it.start() }
    }

    Function("stop") {
      beacon?.stop()
      beacon = null
    }

    OnDestroy {
      beacon?.stop()
    }
  }

  private companion object {
    // Android 12+ has its own Bluetooth permissions. Location too, because scan results without it (or the
    // neverForLocation flag, which can filter beacons out) come back empty on some phones.
    val PERMISSIONS: Array<String> =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_ADVERTISE, Manifest.permission.ACCESS_FINE_LOCATION)
      } else {
        arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
      }
  }
}

/** Permissions are asked for by `requestPermissions` before `start`; a refused one just means nothing is heard. */
@SuppressLint("MissingPermission")
class Beacon(context: Context, service: UUID, private val onSignal: (Int) -> Unit) {
  private val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
  private val uuid = ParcelUuid(service)

  private val advertising = object : AdvertiseCallback() {
    override fun onStartFailure(errorCode: Int) {
      Log.w(TAG, "advertising failed: $errorCode")
    }
  }

  private val scanning = object : ScanCallback() {
    override fun onScanResult(callbackType: Int, result: ScanResult) = onSignal(result.rssi)
    override fun onBatchScanResults(results: MutableList<ScanResult>) = results.forEach { onSignal(it.rssi) }
    override fun onScanFailed(errorCode: Int) {
      Log.w(TAG, "scanning failed: $errorCode")
    }
  }

  fun start() {
    if (adapter?.isEnabled != true) throw CodedException("Bluetooth is off")
    try {
      adapter.bluetoothLeAdvertiser?.startAdvertising(
        AdvertiseSettings.Builder()
          .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
          .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
          .setConnectable(false)
          .build(),
        // 128-bit UUID (18 bytes) fits the 31-byte packet only without the device name.
        AdvertiseData.Builder().addServiceUuid(uuid).setIncludeDeviceName(false).setIncludeTxPowerLevel(false).build(),
        advertising,
      )
      adapter.bluetoothLeScanner?.startScan(
        listOf(ScanFilter.Builder().setServiceUuid(uuid).build()),
        ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(),
        scanning,
      )
    } catch (e: SecurityException) {
      throw CodedException("Bluetooth permission not granted", e)
    }
  }

  fun stop() {
    try {
      adapter?.bluetoothLeAdvertiser?.stopAdvertising(advertising)
      adapter?.bluetoothLeScanner?.stopScan(scanning)
    } catch (e: Exception) {
      // Bluetooth turned off or permission revoked mid-way: there's nothing left to stop.
      Log.w(TAG, "stop: ${e.message}")
    }
  }

  private companion object {
    const val TAG = "MoloopBeacon"
  }
}
