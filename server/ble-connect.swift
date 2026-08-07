import CoreBluetooth
import Foundation

let MIDI_SVC = CBUUID(string: "03B80E5A-EDE8-4B33-A751-6CE34EC4C700")

class Conn: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    var central: CBCentralManager!
    var periph: CBPeripheral?

    override init() {
        super.init()
        central = CBCentralManager(delegate: self, queue: nil)
    }

    func centralManagerDidUpdateState(_ c: CBCentralManager) {
        guard c.state == .poweredOn else { print("central state:", c.state.rawValue); return }
        let matches = c.retrieveConnectedPeripherals(withServices: [MIDI_SVC])
        print("retrieved connected w/ MIDI svc:", matches.map { $0.name ?? $0.identifier.uuidString })
        if let p = matches.first {
            periph = p
            p.delegate = self
            c.connect(p)
        } else {
            print("no connected MIDI peripheral found; falling back to scan")
            c.scanForPeripherals(withServices: [MIDI_SVC], options: nil)
        }
    }

    func centralManager(_ c: CBCentralManager, didDiscover p: CBPeripheral,
                        advertisementData: [String: Any], rssi: NSNumber) {
        print("discovered:", p.name ?? "?", p.identifier.uuidString)
        c.stopScan()
        periph = p
        p.delegate = self
        c.connect(p)
    }

    func centralManager(_ c: CBCentralManager, didConnect p: CBPeripheral) {
        print("CONNECTED:", p.name ?? p.identifier.uuidString)
        p.discoverServices(nil)
    }
    func centralManager(_ c: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) {
        print("FAILED to connect:", error?.localizedDescription ?? "?")
    }
    func centralManager(_ c: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) {
        print("DISCONNECTED:", error?.localizedDescription ?? "clean")
    }

    func peripheral(_ p: CBPeripheral, didDiscoverServices error: Error?) {
        if let e = error { print("svc error:", e); return }
        for s in p.services ?? [] {
            print("  service:", s.uuid.uuidString)
            p.discoverCharacteristics(nil, for: s)
        }
    }
    func peripheral(_ p: CBPeripheral, didDiscoverCharacteristicsFor s: CBService, error: Error?) {
        for ch in s.characteristics ?? [] {
            print("    char:", ch.uuid.uuidString,
                  "props:", String(format: "0x%02X", ch.properties.rawValue))
            if ch.properties.contains(.notify) {
                p.setNotifyValue(true, for: ch)
            }
            if ch.properties.contains(.read) {
                p.readValue(for: ch)
            }
        }
    }
    func peripheral(_ p: CBPeripheral, didUpdateNotificationStateFor ch: CBCharacteristic, error: Error?) {
        print("    notified:", ch.uuid.uuidString, error?.localizedDescription ?? "OK")
    }
    func peripheral(_ p: CBPeripheral, didUpdateValueFor ch: CBCharacteristic, error: Error?) {
        if let d = ch.value {
            print("    RX[\(ch.uuid.uuidString)]:", d.map { String(format: "%02X", $0) }.joined(separator: " "))
        }
    }
}

setbuf(stdout, nil)
print("PID:", getpid())
let c = Conn()
RunLoop.main.run()
