import CoreBluetooth
import ExpoModulesCore

/// The finder's radio: advertise one service UUID (the task) and scan for the other phone advertising it, sending
/// its signal strength to JS. Service UUIDs are all iOS lets a foreground app advertise, and Android scans for them.
public class MoloopBeaconModule: Module {
  private var beacon: Beacon?

  public func definition() -> ModuleDefinition {
    Name("MoloopBeacon")

    Events("onSignal")

    // iOS asks on first use (when `start` creates the managers); this only says whether it was already refused.
    AsyncFunction("requestPermissions") { () -> Bool in
      CBManager.authorization != .denied && CBManager.authorization != .restricted
    }

    Function("start") { [weak self] (uuid: String) in
      guard let id = UUID(uuidString: uuid) else { throw InvalidUuidException(uuid) }
      guard let self else { return }
      self.beacon?.stop()
      self.beacon = Beacon(service: CBUUID(nsuuid: id)) { [weak self] rssi in
        self?.sendEvent("onSignal", ["rssi": rssi, "at": Date().timeIntervalSince1970 * 1000])
      }
    }

    Function("stop") {
      self.beacon?.stop()
      self.beacon = nil
    }

    OnDestroy {
      self.beacon?.stop()
    }
  }
}

final class InvalidUuidException: GenericException<String>, @unchecked Sendable {
  override var reason: String { "Not a UUID: \(param)" }
}

/// Both managers start once Bluetooth is powered on; until then (or if it's off) nothing is heard and the screen
/// keeps searching.
final class Beacon: NSObject, CBCentralManagerDelegate, CBPeripheralManagerDelegate {
  private let service: CBUUID
  private let onSignal: (Int) -> Void
  private var central: CBCentralManager!
  private var peripheral: CBPeripheralManager!

  init(service: CBUUID, onSignal: @escaping (Int) -> Void) {
    self.service = service
    self.onSignal = onSignal
    super.init()
    central = CBCentralManager(delegate: self, queue: .main)
    peripheral = CBPeripheralManager(delegate: self, queue: .main)
  }

  func stop() {
    if central.state == .poweredOn { central.stopScan() }
    if peripheral.state == .poweredOn { peripheral.stopAdvertising() }
    central.delegate = nil
    peripheral.delegate = nil
  }

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    guard central.state == .poweredOn else { return }
    // Duplicates on: every advertisement heard is a fresh RSSI reading, not just the first.
    central.scanForPeripherals(withServices: [service], options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
  }

  func centralManager(
    _ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber
  ) {
    let rssi = RSSI.intValue
    // 127 means "not available".
    guard rssi < 0 else { return }
    onSignal(rssi)
  }

  func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    guard peripheral.state == .poweredOn else { return }
    peripheral.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [service]])
  }
}
