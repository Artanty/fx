import CoreBluetooth
import Foundation

class Scanner: NSObject, CBCentralManagerDelegate {
    var central: CBCentralManager!
    var seen: [UUID: (name: String?, rssi: Int)] = [:]
    let deadline = Date().addingTimeInterval(12)

    override init() {
        super.init()
        central = CBCentralManager(delegate: self, queue: nil)
    }
    func centralManagerDidUpdateState(_ c: CBCentralManager) {
        if c.state == .poweredOn {
            print("scanning...")
            c.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
        } else {
            print("central state:", c.state.rawValue)
        }
    }
    func centralManager(_ c: CBCentralManager, didDiscover p: CBPeripheral,
                        advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let name = p.name ?? (advertisementData[CBAdvertisementDataLocalNameKey] as? String) ?? "?"
        let svcs = (advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID]) ?? []
        seen[p.identifier] = (name, RSSI.intValue)
        if Date() > deadline {
            print("--- scan results ---")
            for (_, v) in seen {
                print(String(format: "%-30s rssi=%5d  svcs=%@", (v.name ?? "?"), v.rssi,
                             svcs.map { $0.uuidString }.joined(separator: ",")))
            }
            c.stopScan()
            exit(0)
        }
        if name.lowercased().contains("xc-05987") || name.lowercased().contains("h90") {
            print("FOUND:", name, p.identifier.uuidString, "rssi", RSSI.intValue,
                  "svcs", svcs.map { $0.uuidString }.joined(separator: ","))
        }
    }
}

setbuf(stdout, nil)
setbuf(stderr, nil)
print("PID:", getpid())
let s = Scanner()
RunLoop.main.run()
