import CoreMIDI
import Foundation

let targetName = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "XC-05987 Bluetooth Proxy"
let payloadHex = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "F0 1C 77 00 01 48 00 71 0C 00 F7"

var client = MIDIClientRef()
MIDIClientCreate("TestSender" as CFString, nil, nil, &client)

var target: MIDIEndpointRef = 0
for i in 0..<MIDIGetNumberOfSources() {
    let e = MIDIGetSource(i)
    var v: Unmanaged<CFString>?
    if MIDIObjectGetStringProperty(e, kMIDIPropertyDisplayName, &v) == noErr {
        if let s = v?.takeRetainedValue() as String?, s.contains(targetName) { target = e }
    }
}
print("found source: \(target != 0 ? "yes" : "NO")")

var outPort = MIDIPortRef()
MIDIOutputPortCreate(client, "TestOut" as CFString, &outPort)

let bytes = payloadHex.split(separator: " ").compactMap { UInt8($0, radix: 16) }
var packetList = MIDIPacketList()
var packet = MIDIPacketListInit(&packetList)
bytes.withUnsafeBufferPointer { buf in
    packet = MIDIPacketListAdd(&packetList, 4096, packet, 0, buf.count, buf.baseAddress!)
}
let status = MIDISend(outPort, target, &packetList)
print("send status: \(status) bytes: \(bytes.count)")
