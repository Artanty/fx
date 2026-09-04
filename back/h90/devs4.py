import ctypes
from ctypes import wintypes
winmm = ctypes.WinDLL('winmm')
class C(ctypes.Structure):
    _pack_ = 1
    _fields_ = [
        ('wMid', wintypes.WORD), ('wPid', wintypes.WORD),
        ('vDriverVersion', wintypes.WORD),
        ('szPname', ctypes.c_char * 32),
        ('wTechnology', wintypes.WORD), ('wVoices', wintypes.WORD),
        ('wNotes', wintypes.WORD), ('wChannelMask', wintypes.WORD),
        ('dwSupport', wintypes.DWORD),
    ]
n = winmm.midiOutGetNumDevs()
for i in range(n):
    c = C()
    r = winmm.midiOutGetDevCapsA(i, ctypes.byref(c), ctypes.sizeof(c))
    name = c.szPname.decode('latin1').rstrip('\x00').rstrip()
    print(i, hex(c.wMid), hex(c.wPid), 'tech', c.wTechnology, repr(name))
