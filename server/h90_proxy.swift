import CoreMIDI
import Foundation
import Darwin

let args = CommandLine.arguments
let logPath = args.count > 1 ? args[1] : "/tmp/h90_proxy.txt"
let idPath = args.count > 2 ? args[2] : "/tmp/h90_proxy_ids.txt"
let deviceName = args.count > 3 ? args[3] : "XC-05987 Bluetooth"

let fd = open(logPath, O_WRONLY | O_CREAT | O_APPEND, 0o644)
let fh = FileHandle(fileDescriptor: fd)
fh.seekToEndOfFile()

func logLine(_ s: String) {
    let line = s + "\n"
    if let d = line.data(using: .utf8) { fh.write(d) }
    print(s)
}

func stringProp(_ obj: MIDIObjectRef, _ prop: CFString) -> String? {
    var v: Unmanaged<CFString>?
    guard MIDIObjectGetStringProperty(obj, prop, &v) == noErr else { return nil }
    return v?.takeRetainedValue() as String?
}

func uniqueID(_ e: MIDIEndpointRef) -> Int32 {
    var id: Int32 = 0
    MIDIObjectGetIntegerProperty(e, kMIDIPropertyUniqueID, &id)
    return id
}

// ---- find real BLE endpoints ----
var realSrc: MIDIEndpointRef = 0
var realDest: MIDIEndpointRef = 0
for i in 0..<MIDIGetNumberOfSources() {
    let e = MIDIGetSource(i)
    if let n = stringProp(e, kMIDIPropertyDisplayName), n.contains(deviceName) { realSrc = e }
    if let n = stringProp(e, kMIDIPropertyName), n.contains(deviceName) { realSrc = e }
}
for i in 0..<MIDIGetNumberOfDestinations() {
    let e = MIDIGetDestination(i)
    if let n = stringProp(e, kMIDIPropertyDisplayName), n.contains(deviceName) { realDest = e }
    if let n = stringProp(e, kMIDIPropertyName), n.contains(deviceName) { realDest = e }
}

logLine("--- proxy started \(Date()) ---")
logLine("real source: \(realSrc != 0 ? stringProp(realSrc, kMIDIPropertyDisplayName) ?? "?" : "NOT FOUND")")
logLine("real dest:   \(realDest != 0 ? stringProp(realDest, kMIDIPropertyDisplayName) ?? "?" : "NOT FOUND")")

// ---- client ----
var client = MIDIClientRef()
MIDIClientCreate("H90ProxyClient" as CFString, nil, nil, &client)

// ---- output port (used for forwarding both directions) ----
var outPort = MIDIPortRef()
MIDIOutputPortCreate(client, "H90ProxyOut" as CFString, &outPort)

// ---- virtual destination: app sends here; we log TX + forward to realDest ----
let proxyName = deviceName + " Proxy"
var virtDest = MIDIEndpointRef()
let destReadProc: MIDIReadProc = { pktlist, _, _ in
    var hex = ""
    var pkt = pktlist.pointee.packet
    for _ in 0..<pktlist.pointee.numPackets {
        let len = Int(pkt.length)
        let bytes = withUnsafeBytes(of: &pkt.data) { Array($0.prefix(len)) }
        hex += bytes.map { String(format: "%02X", $0) }.joined()
        pkt = MIDIPacketNext(&pkt).pointee
    }
    if !hex.isEmpty { logLine("TX \(Date()) \(hex)") }
    if realDest != 0 {
        MIDISend(outPort, realDest, pktlist)
    }
}
MIDIDestinationCreate(client, proxyName as CFString, destReadProc, nil, &virtDest)

// ---- virtual source: app reads here; we forward pedal RX to it ----
var virtSrc = MIDIEndpointRef()
MIDISourceCreate(client, proxyName as CFString, &virtSrc)

let vSrcID = uniqueID(virtSrc)
let vDestID = uniqueID(virtDest)
logLine("VIRTUAL SRC uniqueID: \(vSrcID)  (app's midiInputPortIdentifier endpoint)")
logLine("VIRTUAL DEST uniqueID: \(vDestID)  (app's midiOutputPortIdentifier endpoint)")
do {
    try "VIRTUAL_SRC=\(vSrcID)\nVIRTUAL_DEST=\(vDestID)\n".write(toFile: idPath, atomically: true, encoding: .utf8)
} catch { logLine("could not write id file: \(error)") }

// ---- SysEx reassembly: BLE delivers one large message as many raw fragments ----
var sysexBuf = [UInt8]()
var inSysex = false

func sendCompleteMessage(_ bytes: [UInt8]) {
    let cap = bytes.count + 128
    var buf = [UInt8](repeating: 0, count: cap)
    let status = buf.withUnsafeMutableBytes { raw -> OSStatus in
        let pl = raw.bindMemory(to: MIDIPacketList.self).baseAddress!
        var p = MIDIPacketListInit(pl)
        bytes.withUnsafeBufferPointer { b in
            p = MIDIPacketListAdd(pl, cap, p, 0, b.count, b.baseAddress!)
        }
        return MIDIReceived(virtSrc, pl)
    }
    if status != noErr && status != -1 {
        logLine("RX-CMPL MIDIReceived status=\(status)")
    }
}

let srcReadProc: MIDIReadProc = { pktlist, _, _ in
    var hex = ""
    var pkt = pktlist.pointee.packet
    for _ in 0..<pktlist.pointee.numPackets {
        let len = Int(pkt.length)
        let bytes = withUnsafeBytes(of: &pkt.data) { Array($0.prefix(len)) }
        hex += bytes.map { String(format: "%02X", $0) }.joined()
        for b in bytes {
            if b == 0xF0 {
                if inSysex && !sysexBuf.isEmpty { sendCompleteMessage(sysexBuf) }
                sysexBuf = [b]
                inSysex = true
            } else if b == 0xF7 && inSysex {
                sysexBuf.append(b)
                let msg = sysexBuf
                sysexBuf = []
                inSysex = false
                sendCompleteMessage(msg)
            } else if inSysex {
                sysexBuf.append(b)
            }
        }
        pkt = MIDIPacketNext(&pkt).pointee
    }
    if !hex.isEmpty {
        logLine("RX \(Date()) \(hex)")
        logLine("RX-CMPL \(Date()) reassembled=\(sysexBuf.count) inSysex=\(inSysex)")
    }
}
var inPort = MIDIPortRef()
MIDIInputPortCreate(client, "H90ProxyIn" as CFString, srcReadProc, nil, &inPort)
if realSrc != 0 {
    MIDIPortConnectSource(inPort, realSrc, nil)
}

logLine("proxy ready. listening. (ctrl-c to stop)")
print("PID: \(getpid())")
fflush(stdout)

if args.count > 4 && args[4] == "selftest" {
    let marker = "F0 7E 7F 06 01 F7"
    let mb = marker.split(separator: " ").compactMap { UInt8($0, radix: 16) }
    DispatchQueue.global().async {
        while true {
            var buf = [UInt8](repeating: 0, count: 4096)
            let pl = buf.withUnsafeMutableBytes { $0.bindMemory(to: MIDIPacketList.self).baseAddress! }
            var p = MIDIPacketListInit(pl)
            mb.withUnsafeBufferPointer { bytes in
                p = MIDIPacketListAdd(pl, 4096, p, 0, bytes.count, bytes.baseAddress!)
            }
            let st = MIDIReceived(virtSrc, pl)
            print("selftest send to virtSrc status=\(st)")
            fflush(stdout)
            usleep(3000000)
        }
    }
}

signal(SIGINT) { _ in
    logLine("--- proxy stopped \(Date()) ---")
    exit(0)
}
RunLoop.main.run()
