import ctypes
from ctypes import wintypes
winmm = ctypes.WinDLL('winmm')
class C(ctypes.Structure):
    _fields_ = [
        ('wMid', wintypes.WORD), ('wPid', wintypes.WORD),
        ('vDriverVersion', wintypes.WORD),
        ('szPname', wintypes.WCHAR * 32),
        ('wTechnology', wintypes.WORD), ('wVoices', wintypes.WORD),
        ('wNotes', wintypes.WORD), ('wChannelMask', wintypes.WORD),
        ('dwSupport', wintypes.DWORD),
    ]
n = winmm.midiOutGetNumDevs()
for i in range(n):
    c = C()
    r = winmm.midiOutGetDevCapsW(i, ctypes.byref(c), ctypes.sizeof(c))
    name = ''.join(c.szPname).rstrip('\x00')
    print(i, hex(c.wMid), hex(c.wPid), 'tech', c.wTechnology, repr(name))
