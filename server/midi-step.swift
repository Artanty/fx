import CoreMIDI
import Foundation

setbuf(stdout, nil)
print("step1: creating client...")
var client = MIDIClientRef()
let s1 = MIDIClientCreate("T" as CFString, nil, nil, &client)
print("step1 done:", s1)
print("step2: count sources...")
let n = MIDIGetNumberOfSources()
print("step2 done:", n)
print("step3: count dests...")
let d = MIDIGetNumberOfDestinations()
print("step3 done:", d)
for i in 0..<n {
    var v: Unmanaged<CFString>?
    MIDIObjectGetStringProperty(MIDIGetSource(i), kMIDIPropertyDisplayName, &v)
    print("src", i, v?.takeRetainedValue() as String? ?? "?")
}
for i in 0..<d {
    var v: Unmanaged<CFString>?
    MIDIObjectGetStringProperty(MIDIGetDestination(i), kMIDIPropertyDisplayName, &v)
    print("dst", i, v?.takeRetainedValue() as String? ?? "?")
}
print("done")
