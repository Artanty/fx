"""Send a MIDI Control Change to a Source Audio L.A. Lady pedal via Windows MME.

The pedal's engage/bypass is bound to CC 102 (in Neuro); 0 = off, 127 = on.
Targets the "Source Audio One Series" MIDI out port.

Usage:
  python midi_cc.py <on|off> [device_idx] [channel] [cc]
Defaults: device_idx=3, channel=3, cc=102.
  python midi_cc.py on      # CC 102 value 127
  python midi_cc.py off     # CC 102 value 0
Exit code 0 on success.
"""
import ctypes
import sys
from ctypes import wintypes

winmm = ctypes.WinDLL('winmm')

DEFAULT_DEV = 3
DEFAULT_CH = 3
DEFAULT_CC = 102


def send_cc(dev, channel_1based, cc, value):
    winmm.midiOutOpen.argtypes = [ctypes.POINTER(ctypes.c_void_p), wintypes.UINT, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD]
    winmm.midiOutOpen.restype = ctypes.c_uint
    winmm.midiOutShortMsg.argtypes = [ctypes.c_void_p, wintypes.DWORD]
    winmm.midiOutShortMsg.restype = ctypes.c_uint

    h = ctypes.c_void_p()
    err = winmm.midiOutOpen(ctypes.byref(h), dev, 0, 0, 0)
    if err != 0:
        return False, 'midiOutOpen err {}'.format(err)
    status = 0xB0 | ((channel_1based - 1) & 0x0F)
    msg = status | (cc << 8) | (value << 16)
    err = winmm.midiOutShortMsg(h, msg)
    winmm.midiOutClose(h)
    return err == 0, 'midiOutShortMsg err {}'.format(err)


def main():
    if len(sys.argv) < 2:
        print('usage: midi_cc.py <on|off> [device_idx] [channel] [cc]')
        return 2
    state = sys.argv[1].lower()
    if state not in ('on', 'off'):
        print('state must be on or off')
        return 2
    dev = int(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_DEV
    ch = int(sys.argv[3]) if len(sys.argv) > 3 else DEFAULT_CH
    cc = int(sys.argv[4]) if len(sys.argv) > 4 else DEFAULT_CC
    value = 127 if state == 'on' else 0

    ok, msg = send_cc(dev, ch, cc, value)
    print('send dev={} ch={} cc={} {}={{}} -> {} {}'.format(dev, ch, cc, state, value, ok, msg))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
