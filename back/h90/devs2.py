import ctypes
from ctypes import wintypes
winmm = ctypes.WinDLL('winmm')
class C(ctypes.Structure):
    _fields_ = [
        ('wMid', wintypes.WORD), ('wPid', wintypes.WORD),
        ('vDriverVersion', wintypes.WORD),
        ('szPname', ctypes.c_char * 32),
        ('wTechnology', wintypes.WORD), ('wVoices', wintypes.WORD),
        ('wNotes', wintypes.WORD), ('wChannelMask', wintypes.WORD),
        ('dwSupport', wintypes.DWORD),
    ]
n = winmm.midiOutGetNumDevs()
print('devices', n)
for i in range(n):
    c = C()
    r = winmm.midiOutGetDevCapsW(i, ctypes.byref(c), ctypes.sizeof(c))
    print(i, hex(c.wMid), hex(c.wPid), repr(c.szPname))
