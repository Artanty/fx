import CoreMIDI
import Foundation

setbuf(stdout, nil)

func name(_ e: MIDIObjectRef, _ prop: CFString) -> String {
    var v: Unmanaged<CFString>?
    if MIDIObjectGetStringProperty(e, prop, &v) == noErr, let s = v?.takeRetainedValue() as String? {
        return s
    }
    return ""
}
func online(_ e: MIDIObjectRef) -> Bool {
    var v: Int32 = 0
    MIDIObjectGetIntegerProperty(e, kMIDIPropertyOffline, &v)
    return v == 0
}

print("== SOURCES ==")
for i in 0..<MIDIGetNumberOfSources() {
    let e = MIDIGetSource(i)
    print(String(format: "%2d src   %-40s online=%d", i, name(e, kMIDIPropertyDisplayName), online(e) ? 1 : 0))
}
print("== DESTINATIONS ==")
for i in 0..<MIDIGetNumberOfDestinations() {
    let e = MIDIGetDestination(i)
    print(String(format: "%2d dest  %-40s online=%d", i, name(e, kMIDIPropertyDisplayName), online(e) ? 1 : 0))
}
