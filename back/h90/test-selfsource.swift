import CoreMIDI
import Foundation

var client = MIDIClientRef()
MIDIClientCreate("SelfSourceTest" as CFString, nil, nil, &client)

var src = MIDIEndpointRef()
MIDISourceCreate(client, "SelfSourceTest" as CFString, &src)
print("created source")

var outPort = MIDIPortRef()
MIDIOutputPortCreate(client, "TestOut" as CFString, &outPort)

let payloadHex = "F0 1C 77 00 01 48 00 71 0C 00 F7"
let bytes = payloadHex.split(separator: " ").compactMap { UInt8($0, radix: 16) }

var packetList = MIDIPacketList()
for n in 0..<3 {
    var packet = MIDIPacketListInit(&packetList)
    bytes.withUnsafeBufferPointer { buf in
        packet = MIDIPacketListAdd(&packetList, 4096, packet, 0, buf.count, buf.baseAddress!)
    }
    let status = MIDISend(outPort, src, &packetList)
    print("send #\(n) status: \(status)")
    usleep(500000)
}
RunLoop.main.run()
