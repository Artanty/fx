/*
 * c4hid.c - Source Audio C4 Synth raw-HID CLI bridge for monome norns.
 *
 * Zero-dependency POSIX (open/read/write/poll on /dev/hidraw), statically
 * cross-compiled for the norns (ARMv7). Mirrors the JS protocol in
 * back/c4/src/c4Hid.js + c4Protocol.js. See back/c4/docs/norns-port.md.
 *
 * Framing note: on Linux hidraw the report ID is NOT part of the write
 * (hidapi linux/hid.c hid_write() writes data verbatim), so reports are
 * 38 bytes with no leading 0x00. The 0x00 prefix is only needed on the
 * Windows HID-class API used by the web backend.
 *
 * Usage:
 *   c4hid identify                 device summary (model/fw/presets/active/node)
 *   c4hid names                    one row per preset: "<idx>\t<name>"
 *   c4hid name <idx>               single preset name
 *   c4hid body <idx>               256 lowercase hex chars (128-byte body)
 *   c4hid activate <idx>           switch the active/live preset
 *
 * Device discovery: scan /dev/hidraw*, match VID 0x29a4 / PID 0x0302 via the
 * sysfs uevent, open, then confirm with a CONFIG_GET (0x45 -> 0x32). All
 * commands exit non-zero with a message on stderr on device/timeout errors.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <unistd.h>
#include <fcntl.h>
#include <poll.h>
#include <dirent.h>
#include <time.h>

#define AS_VID            0x29a4
#define AS_PID            0x0302
#define REPORT_LEN        38
#define PAYLOAD_LEN       32
#define EEPROM_SIZE       256
#define C4_PRESET_BASE    0x080000
#define C4_PRESET_PITCH   0x1000
#define C4_DATA_OFF       0x20
#define C4_DATA_SIZE      0x80
#define C4_NAME_OFF       0xa0
#define C4_NAME_SIZE      32
#define C4_PRESET_COUNT   128
#define WRITE_ROW         16

#define C_CONF_GET        0x45
#define C_FLASH_READ      0x36
#define C_CTRL_SET        0x70
#define C_ACTIVE_STORE    0x76
#define C_ACTIVE_SET      0x77
#define C_ACTIVE_WRITE    0x6e
#define C_EEPROM_READ     0x80
#define C_EEPROM_WRITE    0x81
#define R_CONF_GET        0x32

static int g_fd = -1;
static char g_node[64] = "";
static char g_hid_name[128] = "";

static void die(const char *msg) { fprintf(stderr, "c4hid: %s\n", msg); exit(1); }
static void die_errno(const char *msg) { fprintf(stderr, "c4hid: %s: %s\n", msg, strerror(errno)); exit(1); }

static long long now_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (long long)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

static void sleep_ms(int ms) {
    struct timespec ts;
    ts.tv_sec = ms / 1000;
    ts.tv_nsec = (long)(ms % 1000) * 1000000L;
    nanosleep(&ts, NULL);
}

static int hex_nib(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

static int hex_byte(const char *s) {
    int hi = hex_nib(s[0]);
    int lo = hex_nib(s[1]);
    if (hi < 0 || lo < 0) return -1;
    return (hi << 4) | lo;
}

/* sysfs uevent for a hidraw node; returns 1 and fills g_hid_name if the node
 * is a Source Audio device with VID=0x29a4 and PID=0x0302 (C4 Synth). */
static int match_uevent(const char *hidraw_name) {
    char line[256];
    char path[160];
    int vid_ok = 0, pid_ok = 0;
    FILE *f;

    snprintf(path, sizeof(path), "/sys/class/hidraw/%s/device/uevent", hidraw_name);
    f = fopen(path, "r");
    if (!f) return 0;
    g_hid_name[0] = 0;
    while (fgets(line, sizeof(line), f)) {
        char *nl = strchr(line, '\n');
        if (nl) *nl = 0;
        if (strncmp(line, "HID_ID=", 7) == 0) {
            char *c = line + 7;
            while (*c && *c != ':') c++;
            if (*c) {
                unsigned int vid = (unsigned int)strtoul(c + 1, &c, 16);
                if (*c == ':') {
                    unsigned int pid = (unsigned int)strtoul(c + 1, &c, 16);
                    vid_ok = (vid == AS_VID);
                    pid_ok = (pid == AS_PID);
                }
            }
        } else if (strncmp(line, "HID_NAME=", 9) == 0) {
            snprintf(g_hid_name, sizeof(g_hid_name), "%s", line + 9);
        }
        if (vid_ok && pid_ok) break;
    }
    fclose(f);
    return vid_ok && pid_ok;
}

/* --- report I/O ---------------------------------------------------------- */

static void report_send(const unsigned char *rep) {
    int n = (int)write(g_fd, rep, REPORT_LEN);
    if (n != REPORT_LEN) die_errno("hid write");
}

/* Read one input report with a poll timeout; returns payload length (>0) or 0
 * on timeout. */
static int report_read(unsigned char *out, int timeout_ms) {
    struct pollfd p;
    int r, n;
    p.fd = g_fd;
    p.events = POLLIN;
    r = poll(&p, 1, timeout_ms);
    if (r <= 0) return 0;
    n = (int)read(g_fd, out, REPORT_LEN);
    if (n < 0) {
        if (errno == EAGAIN || errno == EINTR) return 0;
        die_errno("hid read");
    }
    return n;
}

/* Send a report and read reports until one whose header is `expect` arrives.
 * parseReply semantics (c4Protocol.js): payload follows the header byte either
 * at offset 1 (reply[0] == expect) or offset 2 (reply[1] == expect). Returns
 * payload length or -1 on timeout. */
static int request(const unsigned char *rep, int expect, unsigned char *out, int out_cap, int timeout_ms) {
    long long deadline = now_ms() + timeout_ms;
    report_send(rep);
    while (now_ms() < deadline) {
        unsigned char buf[REPORT_LEN];
        int n = report_read(buf, (int)(deadline - now_ms()));
        int plen = 0;
        const unsigned char *pl = NULL;
        if (n <= 0) continue;
        if (buf[0] == expect) { pl = buf + 1; plen = n - 1; }
        else if (n > 1 && buf[1] == expect) { pl = buf + 2; plen = n - 2; }
        if (pl) {
            if (plen > out_cap) plen = out_cap;
            memcpy(out, pl, plen);
            return plen;
        }
    }
    return -1;
}

/* --- C4 operations (match c4Protocol.js) --------------------------------- */

static int flash_read(unsigned char *out32, unsigned long addr) {
    unsigned char r[REPORT_LEN];
    int len;
    memset(r, 0, sizeof(r));
    r[0] = C_FLASH_READ;
    r[1] = (unsigned char)((addr >> 16) & 0xff);
    r[2] = (unsigned char)((addr >> 8) & 0xff);
    r[3] = (unsigned char)(addr & 0xff);
    r[4] = 0;
    len = request(r, C_FLASH_READ, out32, PAYLOAD_LEN, 1500);
    if (len < 0) die("flash read timeout");
    return len;
}

/* Read len bytes at page-relative offset off (16-byte rows, like readRegion). */
static void read_region(unsigned char *out, int idx, int off, int len) {
    unsigned long base = C4_PRESET_BASE + (unsigned long)(idx & 0x7f) * C4_PRESET_PITCH;
    int k;
    for (k = 0; k < len; k += WRITE_ROW) {
        int want = WRITE_ROW;
        unsigned char chunk[PAYLOAD_LEN];
        if (len - k < want) want = len - k;
        flash_read(chunk, base + (unsigned long)off + k);
        memcpy(out + k, chunk, (size_t)want);
    }
}

static int config_payload(unsigned char *out) {
    unsigned char r[REPORT_LEN];
    int len;
    memset(r, 0, sizeof(r));
    r[0] = C_CONF_GET;
    len = request(r, R_CONF_GET, out, REPORT_LEN - 1, 1500);
    if (len < 0) return -1;
    if (len < 8) return -1;
    return len;
}

static void preset_name_of(int idx, char *out, int cap) {
    unsigned long addr = C4_PRESET_BASE + (unsigned long)(idx & 0x7f) * C4_PRESET_PITCH + C4_NAME_OFF;
    unsigned char block[PAYLOAD_LEN];
    int i, len = 0, end = PAYLOAD_LEN;
    flash_read(block, addr);
    for (i = 0; i < PAYLOAD_LEN; i++) if (block[i] == 0) { end = i; break; }
    while (end > 0 && (block[end - 1] == ' ' || block[end - 1] == '\t')) end--;
    len = end < cap - 1 ? end : cap - 1;
    memcpy(out, block, (size_t)len);
    out[len] = 0;
}

/* Open the C4: find, open, and CONFIG_GET-verify a matching hidraw node. */
static void device_open(void) {
    DIR *d;
    struct dirent *e;
    int matched = 0;

    d = opendir("/dev");
    if (!d) die_errno("opendir /dev");
    while ((e = readdir(d))) {
        unsigned char cfg[REPORT_LEN];
        char path[64];
        int fd, ok;
        if (strncmp(e->d_name, "hidraw", 6)) continue;
        if (!match_uevent(e->d_name)) continue;
        matched++;
        snprintf(path, sizeof(path), "/dev/%s", e->d_name);
        fd = open(path, O_RDWR);
        if (fd < 0) continue;
        g_fd = fd;
        strncpy(g_node, path, sizeof(g_node) - 1);
        ok = (config_payload(cfg) >= 0);
        if (ok) {
            closedir(d);
            return;
        }
        close(fd);
        g_fd = -1;
    }
    closedir(d);
    if (!matched)
        die("no hidraw node matches Source Audio VID/PID (0x29a4/0x0302) - is the C4 powered via the norns USB host port?");
    die("hidraw node matched but none answered CONFIG_GET - wrong interface or the device is busy; try unplug/replug the C4");
}

/* --- commands ------------------------------------------------------------ */

static void cmd_identify(void) {
    unsigned char cfg[REPORT_LEN];
    int fw;
    device_open();
    if (config_payload(cfg) < 0) die("config read failed");
    fw = (cfg[1] << 8) | cfg[0];
    printf("model    %u\n", (unsigned)cfg[2]);
    printf("fw       %d\n", fw);
    printf("presets  %u\n", (unsigned)cfg[3]);
    printf("active   %u\n", (unsigned)cfg[4]);
    printf("channel  %u\n", (unsigned)cfg[7]);
    printf("node     %s\n", g_node);
    if (g_hid_name[0]) printf("name     %s\n", g_hid_name);
    close(g_fd);
}

static void cmd_names(void) {
    char name[C4_NAME_SIZE + 1];
    int i;
    device_open();
    for (i = 0; i < C4_PRESET_COUNT; i++) {
        preset_name_of(i, name, sizeof(name));
        printf("%d\t%s\n", i, name);
    }
    close(g_fd);
}

static int parse_idx(const char *s) {
    long v = strtol(s, NULL, 10);
    if (v < 0 || v >= C4_PRESET_COUNT) die("index out of range (0..127)");
    return (int)v;
}

static void cmd_name(const char *idx_s) {
    char name[C4_NAME_SIZE + 1];
    int idx = parse_idx(idx_s);
    device_open();
    preset_name_of(idx, name, sizeof(name));
    printf("%d\t%s\n", idx, name);
    close(g_fd);
}

static void cmd_body(const char *idx_s) {
    int idx = parse_idx(idx_s);
    unsigned char body[C4_DATA_SIZE];
    int i;
    device_open();
    read_region(body, idx, C4_DATA_OFF, C4_DATA_SIZE);
    for (i = 0; i < C4_DATA_SIZE; i++) printf("%02x", body[i]);
    printf("\n");
    close(g_fd);
}

static void cmd_activate(const char *idx_s) {
    int idx = parse_idx(idx_s);
    unsigned char r[REPORT_LEN];
    unsigned char dummy[REPORT_LEN];
    int n;
    device_open();
    memset(r, 0, sizeof(r));
    r[0] = C_ACTIVE_SET;
    r[1] = (unsigned char)(idx & 0x7f);
    r[2] = 0;
    report_send(r);
    sleep_ms(500);
    n = report_read(dummy, 1500);
    if (n <= 0) fprintf(stderr, "c4hid: warning: no reply (preset may still have switched)\n");
    printf("ok %d\n", idx);
    close(g_fd);
}

int main(int argc, char **argv) {
    const char *cmd;

    if (argc < 2) {
        fprintf(stderr, "usage: c4hid <identify|names|name IDX|body IDX|activate IDX>\n");
        return 2;
    }
    cmd = argv[1];
    if (strcmp(cmd, "identify") == 0) {
        if (argc != 2) return 2;
        cmd_identify();
    } else if (strcmp(cmd, "names") == 0) {
        if (argc != 2) return 2;
        cmd_names();
    } else if (strcmp(cmd, "name") == 0) {
        if (argc != 3) return 2;
        cmd_name(argv[2]);
    } else if (strcmp(cmd, "body") == 0) {
        if (argc != 3) return 2;
        cmd_body(argv[2]);
    } else if (strcmp(cmd, "activate") == 0) {
        if (argc != 3) return 2;
        cmd_activate(argv[2]);
    } else {
        fprintf(stderr, "c4hid: unknown command '%s'\n", cmd);
        return 2;
    }
    return 0;
}