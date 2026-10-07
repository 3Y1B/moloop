import CoreBluetooth
import ExpoModulesCore
import NearbyInteraction

/// The finder's radio: advertise one service UUID (the task) and scan for the other phone advertising it, sending
/// its signal strength to JS. Service UUIDs are all iOS lets a foreground app advertise, and Android scans for them.
/// Two iPhones with UWB also swap Nearby Interaction tokens over Bluetooth and range each other: distance and direction.
public class MoloopBeaconModule: Module {
  private var beacon: Beacon?

  public func definition() -> ModuleDefinition {
    Name("MoloopBeacon")

    Events("onSignal", "onNearby")

    // iOS asks on first use (when `start` creates the managers); this only says whether it was already refused.
    AsyncFunction("requestPermissions") { () -> Bool in
      CBManager.authorization != .denied && CBManager.authorization != .restricted
    }

    Function("start") { [weak self] (uuid: String) in
      guard let id = UUID(uuidString: uuid) else { throw InvalidUuidException(uuid) }
      guard let self else { return }
      self.beacon?.stop()
      self.beacon = Beacon(
        service: CBUUID(nsuuid: id),
        onSignal: { [weak self] rssi in
          self?.sendEvent("onSignal", ["rssi": rssi, "at": Date().timeIntervalSince1970 * 1000])
        },
        onNearby: { [weak self] distance, azimuth in
          // Missing keys arrive in JS as undefined: no distance yet, or no direction yet.
          var event: [String: Any] = ["at": Date().timeIntervalSince1970 * 1000]
          if let distance { event["distance"] = Double(distance) }
          if let azimuth { event["azimuth"] = Double(azimuth) }
          self?.sendEvent("onNearby", event)
        }
      )
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

/// Each iPhone's Nearby Interaction token, served as a readable characteristic under the task's service.
private let tokenCharacteristic = CBUUID(string: "6d6f6c6f-6f70-4000-8000-746f6b656e00")

/// Both managers start once Bluetooth is powered on; until then (or if it's off) nothing is heard and the screen
/// keeps searching. UWB is extra: without it (older iPhone, Android on the other end) only `onSignal` fires.
final class Beacon: NSObject, CBCentralManagerDelegate, CBPeripheralManagerDelegate, CBPeripheralDelegate, NISessionDelegate {
  private let service: CBUUID
  private let onSignal: (Int) -> Void
  private let onNearby: (Float?, Float?) -> Void
  private var central: CBCentralManager!
  private var peripheralManager: CBPeripheralManager!

  /// Nil on phones without UWB (or before iOS lets us range), and the finder stays on Bluetooth alone.
  private var session: NISession?
  private var token: Data?
  /// The other iPhone, connected only long enough to read its token.
  private var peer: CBPeripheral?
  private var ranging: NINearbyPeerConfiguration?

  init(service: CBUUID, onSignal: @escaping (Int) -> Void, onNearby: @escaping (Float?, Float?) -> Void) {
    self.service = service
    self.onSignal = onSignal
    self.onNearby = onNearby
    super.init()
    if NISession.deviceCapabilities.supportsPreciseDistanceMeasurement {
      let session = NISession()
      session.delegate = self
      session.delegateQueue = .main
      if let discoveryToken = session.discoveryToken {
        token = try? NSKeyedArchiver.archivedData(withRootObject: discoveryToken, requiringSecureCoding: true)
      }
      self.session = session
    }
    central = CBCentralManager(delegate: self, queue: .main)
    peripheralManager = CBPeripheralManager(delegate: self, queue: .main)
  }

  func stop() {
    if central.state == .poweredOn {
      central.stopScan()
      if let peer { central.cancelPeripheralConnection(peer) }
    }
    if peripheralManager.state == .poweredOn {
      peripheralManager.stopAdvertising()
      peripheralManager.removeAllServices()
    }
    session?.invalidate()
    central.delegate = nil
    peripheralManager.delegate = nil
  }

  // MARK: scanning, and reading the other iPhone's token

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
    if rssi < 0 { onSignal(rssi) }
    // Only another iPhone advertises connectable (Android's beacon isn't), so only it has a token to read.
    let connectable = (advertisementData[CBAdvertisementDataIsConnectable] as? NSNumber)?.boolValue ?? false
    guard session != nil, ranging == nil, peer == nil, connectable else { return }
    peer = peripheral
    peripheral.delegate = self
    central.connect(peripheral)
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    peripheral.discoverServices([service])
  }

  func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    peer = nil
  }

  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    // Disconnecting after the read is expected; before it, try again next time they're heard.
    peer = nil
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    guard let found = peripheral.services?.first(where: { $0.uuid == service }) else { return give(up: peripheral) }
    peripheral.discoverCharacteristics([tokenCharacteristic], for: found)
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    guard let characteristic = service.characteristics?.first(where: { $0.uuid == tokenCharacteristic }) else {
      return give(up: peripheral)
    }
    peripheral.readValue(for: characteristic)
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    defer { give(up: peripheral) }
    guard
      let session, let data = characteristic.value,
      let peerToken = try? NSKeyedUnarchiver.unarchivedObject(ofClass: NIDiscoveryToken.self, from: data)
    else { return }
    let config = NINearbyPeerConfiguration(peerToken: peerToken)
    // iPhone 14 and later only give a direction with the camera helping (ARKit, run by the framework itself).
    if NISession.deviceCapabilities.supportsCameraAssistance { config.isCameraAssistanceEnabled = true }
    ranging = config
    session.run(config)
  }

  private func give(up peripheral: CBPeripheral) {
    central.cancelPeripheralConnection(peripheral)
  }

  // MARK: advertising, with this iPhone's token to read

  func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    guard peripheral.state == .poweredOn else { return }
    guard let token else { return advertise() }
    let characteristic = CBMutableCharacteristic(type: tokenCharacteristic, properties: .read, value: token, permissions: .readable)
    let gatt = CBMutableService(type: service, primary: true)
    gatt.characteristics = [characteristic]
    peripheral.add(gatt)
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
    advertise()
  }

  private func advertise() {
    peripheralManager.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [service]])
  }

  // MARK: UWB

  func session(_ session: NISession, didUpdate nearbyObjects: [NINearbyObject]) {
    guard let object = nearbyObjects.first else { return }
    // Camera-assisted phones give a horizontal angle; the rest a direction vector, x to the right.
    let azimuth = object.horizontalAngle ?? object.direction.map { asin($0.x) }
    onNearby(object.distance, azimuth)
  }

  func session(_ session: NISession, didRemove nearbyObjects: [NINearbyObject], reason: NINearbyObject.RemovalReason) {
    // They left the finder (a new token next time) or went out of range: read their token again when heard.
    ranging = nil
  }

  func sessionSuspensionEnded(_ session: NISession) {
    if let ranging { session.run(ranging) }
  }

  func session(_ session: NISession, didInvalidateWith error: Error) {
    // Refused permission, or UWB unavailable: Bluetooth alone from here.
    self.session = nil
    ranging = nil
  }
}
