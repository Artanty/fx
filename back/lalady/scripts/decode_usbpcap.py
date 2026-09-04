#!/usr/bin/env python3
"""Decode a USBPcap USB capture into L.A. Lady HID reports.

Reads a .pcap produced by USBPcapCMD (linktype 249) and prints every L.A. Lady
HID command/response. The pedal's HID command interface shows up as 38-byte
interrupt transfers on OUT endpoint 0x01 (host->device) / IN endpoint 0x81
(device->host).

Usage:
  python scripts/decode_usbpcap.py capture.pcap
"""

import struct
import sys

COMMANDS = {
    0x30: 'PRESET_GET',
    0x31: 'PRESET_SET',
    0x32: 'CONFIG_GET_RESP',
    0x35: 'FLASH_WRITE',
    0x36: 'FLASH_READ',
    0x37: 'ERASE_ACK',
    0x38: 'PRESET_ERASE',
    0x6e: 'ACTIVE_WRITE',
    0x6f: 'CONFIG_SET',
    0x70: 'CTRL_SET',
    0x71: 'CTRL_GET',
    0x75: 'CTRL_GET2',
    0x76: 'ACTIVE_STORE',
    0x77: 'ACTIVE_SET',
    0x80: 'EEPROM_READ',
    0x81: 'EEPROM_WRITE',
}


def h(b):
    return ' '.join('%02x' % x for x in b)


def decode_report(rep, is_in):
    if not rep:
        return None
    cmd = rep[0]
    name = COMMANDS.get(cmd, 'CMD_0x%02x' % cmd)
    direction = '<-IN ' if is_in else 'OUT->'
    detail = ''
    if cmd in (0x35, 0x36):
        addr = (rep[1] << 16) | (rep[2] << 8) | rep[3]
        detail = 'addr=0x%06x data=[%s]' % (addr, h(rep[4:20]))
    elif cmd == 0x38:
        detail = 'args=[%s]' % h(rep[1:])
    elif cmd == 0x77:
        detail = 'sel=0x%02x idx=%d' % (rep[1], (rep[2] << 8) | rep[3])
    elif cmd in (0x6e, 0x76):
        detail = 'idx=%d payload=[%s]' % ((rep[1] << 8) | rep[2], h(rep[3:]))
    elif cmd == 0x6f:
        detail = 'which=0x%02x payload=[%s]' % (rep[1], h(rep[2:]))
    elif cmd in (0x80, 0x81):
        detail = 'addr=0x%02x len=0x%02x payload=[%s]' % (rep[1], rep[2], h(rep[3:64] if cmd == 0x80 else rep[3:]))
    else:
        detail = 'payload=[%s]' % h(rep[1:])
    return '%s %s %s' % (direction, name.ljust(16), detail)


def iter_packets(fn):
    with open(fn, 'rb') as f:
        data = f.read()
    if len(data) < 24:
        return
    magic = struct.unpack('<I', data[0:4])[0]
    e = '>' if magic == 0xA1B2C3D4 else '<'
    off = 24
    while off + 16 <= len(data):
        ts, usec, incl, orig = struct.unpack(e + 'IIII', data[off:off + 16])
        p = data[off + 16:off + 16 + incl]
        off += 16 + incl
        if incl < 28:
            continue
        yield p


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    fn = sys.argv[1]
    counts = {'out': 0, 'in': 0, 'skip': 0}
    for p in iter_packets(fn):
        # Locate the 38-byte HID report: marker u32 length '26 00 00 00' (38)
        # appears just before the payload, with the endpoint dir byte 6 before it.
        # The 38-byte report is preceded by a u32 length marker (26 00 00 00);
        # the direction (endpoint) byte sits immediately before it (01 = host->dev
        # OUT, 81 = device->host IN). Multiple reports can share one record.
        start = 0
        while True:
            m = p.find(b'\x26\x00\x00\x00', start)
            if m < 0:
                break
            start = m + 1
            if m + 4 + 38 > len(p):
                counts['skip'] += 1
                continue
            ep = p[m - 2] if m >= 2 else 0
            is_in = (ep & 0x80) != 0
            rep = p[m + 4:m + 4 + 38]
            line = decode_report(list(rep), is_in)
            if line:
                print(line)
                counts['in' if is_in else 'out'] += 1
    print('---')
    print('counts: host->device(OUT) %d, device->host(IN) %d, skipped %d' % (
        counts['out'], counts['in'], counts['skip']))


if __name__ == '__main__':
    main()
