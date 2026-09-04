import CoreMIDI
import Foundation

setbuf(stdout, nil)

let listenOnly = CommandLine.arguments.contains("--listen")
var payloadPath = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "/tmp/poll.bin"
var payload = Data()
if !listenOnly {
    payload = FileManager.default.contents(atPath: payloadPath)!
}
let bytes = [UInt8](payload)
print("payload:", payloadPath, bytes.count, "first:", bytes.prefix(10).map { String(format: "%02X", $0) }.joined(separator: " "))

var client = MIDIClientRef()
MIDIClientCreate("Probe" as CFString, nil, nil, &client)

var rxLogPath: String? = nil
if let li = CommandLine.arguments.firstIndex(of: "--listen"), CommandLine.arguments.count > li + 1 {
    let arg = CommandLine.arguments[li + 1]
    if Int(arg) == nil { rxLogPath = arg } else if CommandLine.arguments.count > li + 2 {
        rxLogPath = CommandLine.arguments[li + 2]
    }
}
var listenSecs = 12
if let li = CommandLine.arguments.firstIndex(of: "--listen"), CommandLine.arguments.count > li + 1, let s = Int(CommandLine.arguments[li + 1]) {
    listenSecs = s
}

var inPort = MIDIPortRef()
MIDIInputPortCreate(client, "ProbeIn" as CFString, { (pktList: UnsafePointer<MIDIPacketList>, srcConn: UnsafeMutableRawPointer?, refCon: UnsafeMutableRawPointer?) in
    var p = pktList.pointee.packet
    var out = ""
    for _ in 0..<pktList.pointee.numPackets {
        let bytes = withUnsafePointer(to: &p.data) {
            $0.withMemoryRebound(to: UInt8.self, capacity: Int(p.length)) { $0 }
        }
        for j in 0..<Int(p.length) { out += String(format: "%02X ", bytes[j]) }
        p = MIDIPacketNext(&p).pointee
    }
    print("RX:", out)
    if let logPath = rxLogPath {
        let stamp = Date()
        if let fh = FileHandle(forWritingAtPath: logPath) {
            fh.seekToEndOfFile()
            fh.write("RX \(stamp) \(out)\n".data(using: .utf8)!)
            fh.closeFile()
        }
    }
}, nil, &inPort)

print("sources:")
for i in 0..<MIDIGetNumberOfSources() {
    var v: Unmanaged<CFString>?
    MIDIObjectGetStringProperty(MIDIGetSource(i), kMIDIPropertyDisplayName, &v)
    print("  src[\(i)]:", v?.takeRetainedValue() as String? ?? "?")
}
print("dests:")
for i in 0..<MIDIGetNumberOfDestinations() {
    var v: Unmanaged<CFString>?
    MIDIObjectGetStringProperty(MIDIGetDestination(i), kMIDIPropertyDisplayName, &v)
    print("  dest[\(i)]:", v?.takeRetainedValue() as String? ?? "?")
}

for i in 0..<MIDIGetNumberOfSources() {
    var v: Unmanaged<CFString>?
    MIDIObjectGetStringProperty(MIDIGetSource(i), kMIDIPropertyDisplayName, &v)
    let name = v?.takeRetainedValue() as String? ?? ""
    if listenOnly && !name.contains("H90") { continue }
    MIDIPortConnectSource(inPort, MIDIGetSource(i), nil)
}

var outPort = MIDIPortRef()
MIDIOutputPortCreate(client, "ProbeOut" as CFString, &outPort)

if !listenOnly {
    var packetList = MIDIPacketList()
    var packet = MIDIPacketListInit(&packetList)
    bytes.withUnsafeBufferPointer { buf in
        packet = MIDIPacketListAdd(&packetList, 4096, packet, 0, buf.count, buf.baseAddress!)
    }
    for i in 0..<MIDIGetNumberOfDestinations() {
        let st = MIDISend(outPort, MIDIGetDestination(i), &packetList)
        print("sent to dest[\(i)] status:", st)
    }
} else {
    print("listen-only mode", "secs=", listenSecs, "log=", rxLogPath ?? "-")
}

let start = Date()
while Date().timeIntervalSince(start) < Double(listenSecs) {
    RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.5))
}
print("done")
