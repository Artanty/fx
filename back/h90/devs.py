import ctypes
from ctypes import wintypes
winmm = ctypes.WinDLL('winmm')
class MIDIOUTCAPS(ctypes.Structure):
    _fields_ = [
        ('wMid', wintypes.WORD), ('wPid', wintypes.WORD),
        ('vDriverVersion', wintypes.WORD),
        ('szPname', ctypes.c_wchar * 32),
        ('wTechnology', wintypes.WORD), ('wVoices', wintypes.WORD),
        ('wNotes', wintypes.WORD), ('wChannelMask', wintypes.WORD),
        ('dwSupport', wintypes.DWORD),
    ]
n = winmm.midiOutGetNumDevs()
print('midiOut devices:', n)
for i in range(n):
    caps = MIDIOUTCAPS()
    r = winmm.midiOutGetDevCapsW(i, ctypes.byref(caps), ctypes.sizeof(caps))
    print(i, hex(caps.wMid), hex(caps.wPid), caps.szPname)
