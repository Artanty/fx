#!/bin/sh
# On-norns (or any Linux ARMv7) build of the c4hid bridge. See norns-port.md.
set -e
cc -O2 -Wall c4hid.c -o c4hid
file c4hid
echo "ok: ./c4hid"