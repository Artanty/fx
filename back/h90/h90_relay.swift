import CoreBluetooth
import Foundation

let MIDI_SVC = CBUUID(string: "03B80E5A-EDE8-4B33-A751-6CE34EC4C700")
let MIDI_CHAR = CBUUID(string: "7772E5DB-3868-4112-A1A9-F2669D106BF3")

class Relay: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    var central: CBCentralManager!
    var periph: CBPeripheral?
    var char: CBCharacteristic?
    var tx: CBCharacteristic?
    var ts: UInt16 = 0x1C68
    var sysEx: [UInt8] = []
    var sent = false
    let payload: [UInt8]?

    init(payload: [UInt8]?) {
        self.payload = payload
        super.init()
        central = CBCentralManager(delegate: self, queue: nil)
    }

    func centralManagerDidUpdateState(_ c: CBCentralManager) {
        guard c.state == .poweredOn else { print("central state:", c.state.rawValue); return }
        let matches = c.retrieveConnectedPeripherals(withServices: [MIDI_SVC])
        print("retrieved:", matches.map { $0.name ?? "?" })
        let want = ProcessInfo.processInfo.environment["H90_DEVICE"]
        let chosen = matches.first { want == nil || $0.name?.lowercased().contains(want!.lowercased()) == true }
            ?? matches.first
        if let p = chosen {
            periph = p; p.delegate = self; c.connect(p)
        } else {
            print("no connected MIDI peripheral; scanning")
            c.scanForPeripherals(withServices: [MIDI_SVC], options: nil)
        }
    }
    func centralManager(_ c: CBCentralManager, didDiscover p: CBPeripheral, advertisementData: [String: Any], rssi: NSNumber) {
        print("discovered:", p.name ?? "?", p.identifier.uuidString)
        c.stopScan(); periph = p; p.delegate = self; c.connect(p)
    }
    func centralManager(_ c: CBCentralManager, didConnect p: CBPeripheral) {
        print("CONNECTED:", p.name ?? "?")
        p.discoverServices([MIDI_SVC])
    }
    func centralManager(_ c: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) {
        print("connect FAILED:", error?.localizedDescription ?? "?")
    }
    func centralManager(_ c: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) {
        print("DISCONNECTED:", error?.localizedDescription ?? "clean")
    }

    func peripheral(_ p: CBPeripheral, didDiscoverServices error: Error?) {
        for s in p.services ?? [] where s.uuid == MIDI_SVC {
            p.discoverCharacteristics([MIDI_CHAR], for: s)
        }
    }
    func peripheral(_ p: CBPeripheral, didDiscoverCharacteristicsFor s: CBService, error: Error?) {
        for ch in s.characteristics ?? [] where ch.uuid == MIDI_CHAR {
            print("char:", ch.uuid.uuidString, "props", String(format: "0x%02X", ch.properties.rawValue),
                  "maxWr:", p.maximumWriteValueLength(for: .withoutResponse),
                  "maxWrResp:", p.maximumWriteValueLength(for: .withResponse))
            char = ch
            p.setNotifyValue(true, for: ch)
        }
    }
    func peripheral(_ p: CBPeripheral, didUpdateNotificationStateFor ch: CBCharacteristic, error: Error?) {
        print("notify on:", ch.uuid.uuidString, error?.localizedDescription ?? "OK")
        if error == nil, let pl = payload, !sent {
            sent = true
            let delay = ProcessInfo.processInfo.environment["H90_DELAY"].flatMap { Double($0) } ?? 0.3
            print("will send in \(delay)s")
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { self.sendSysEx(pl, to: p) }
        }
    }

    func sendSysEx(_ data: [UInt8], to p: CBPeripheral) {
        guard let ch = char else { print("no char"); return }
        var body = data
        var offset = 0
        var packetNum = 0
        let maxData = p.maximumWriteValueLength(for: .withoutResponse)
        let chunk = maxData > 3 ? maxData - 3 : 20
        print("sending \(data.count) bytes, chunk=\(chunk)")
        while offset < body.count {
            let n = min(chunk, body.count - offset)
            var pkt: [UInt8]
            let midi = Array(body[offset..<offset+n])
            if packetNum == 0 {
                pkt = [0x80 | UInt8((ts >> 7) & 0x3F), UInt8(ts & 0x7F)] + midi
            } else {
                ts &+= 1
                pkt = [0x00, UInt8(ts & 0x7F)] + midi
            }
            p.writeValue(Data(pkt), for: ch, type: .withoutResponse)
            offset += n
            packetNum += 1
        }
        print("sent \(packetNum) packets")
    }

    func peripheral(_ p: CBPeripheral, didUpdateValueFor ch: CBCharacteristic, error: Error?) {
        guard let d = ch.value, !d.isEmpty else { return }
        let bytes = [UInt8](d)
        var i = 0
        var out: [UInt8] = []
        while i < bytes.count {
            let b = bytes[i]
            if b == 0x00 && i + 1 < bytes.count {
                i += 2
                continue
            }
            if b & 0x80 != 0 && i + 1 < bytes.count {
                i += 2
                continue
            }
            out.append(b)
            i += 1
        }
        if out.first == 0xF0 {
            sysEx += out
            if let f7 = out.firstIndex(of: 0xF7) {
                _ = f7
                print("RX_SYSEX[\(sysEx.count)]:", sysEx.map { String(format: "%02X", $0) }.joined(separator: " "))
                sysEx = []
            }
        } else {
            print("RX_MSG[\(out.count)]:", out.map { String(format: "%02X", $0) }.joined(separator: " "))
        }
    }
}

setbuf(stdout, nil)
var payload: [UInt8]? = nil
if CommandLine.arguments.count > 1 {
    let path = CommandLine.arguments[1]
    if let d = FileManager.default.contents(atPath: path) {
        payload = [UInt8](d)
        print("payload: \(path) \(payload!.count) bytes, first:", payload!.prefix(12).map { String(format: "%02X", $0) }.joined(separator: " "))
    } else {
        print("cannot read payload file:", path)
    }
}
print("PID:", getpid())
let r = Relay(payload: payload)
RunLoop.main.run()
