#!/usr/bin/env node
// back/c4/norns/connect.js - zero-dependency Node CLI for reaching the norns
// from any client computer. See back/c4/docs/norns-connect-profiles.md.
// Resolution order: active profile hostOverride > host > defaultHost (mDNS).
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const dns = require('dns');
const cp = require('child_process');

const CFG = path.join(__dirname, 'profiles.json');

function load() {
  return JSON.parse(fs.readFileSync(CFG, 'utf8'));
}

function save(cfg) {
  const tmp = CFG + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n');
  fs.renameSync(tmp, CFG);
}

function die(msg) {
  console.error('connect: ' + msg);
  process.exit(1);
}

function resolveTarget(cfg) {
  const p = cfg.profiles[cfg.active];
  if (!p) die(`unknown active profile '${cfg.active}'`);
  return p.hostOverride || p.host || cfg.defaultHost;
}

function userAt(cfg) {
  return cfg.user + '@' + resolveTarget(cfg);
}

function probePort(host, port, timeoutMs) {
  return new Promise((done) => {
    const sock = net.connect({ host: host, port: port });
    let settled = false;
    const fin = (ok, why) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      done({ ok: ok, why: why });
    };
    sock.setTimeout(timeoutMs || 2500);
    sock.once('connect', () => fin(true, 'OK'));
    sock.once('timeout', () => fin(false, 'TIMEOUT'));
    sock.once('error', (e) => fin(false, e.code || e.message));
  });
}

function usage() {
  console.log(
    'usage: node connect.js <command> [args]\n' +
    '\n' +
    '  list               show profiles, active marker, resolved target\n' +
    '  use <name>         switch the active profile\n' +
    '  resolve            print current target + tcp/22 probe result\n' +
    '  ssh [--] [args..]  run ssh <user>@<target> args..\n' +
    '  scp <src..> <dest> run scp; bare norns: / : targets expand to <user>@<target>:\n' +
    '  discover           try norns.local first; else arp -a by nornsMac -> hostOverride\n' +
    '  key                install the local ssh public key onto the norns\n' +
    '  help               this message'
  );
}

function cmdList() {
  const cfg = load();
  for (const name of Object.keys(cfg.profiles)) {
    const p = cfg.profiles[name];
    const marker = name === cfg.active ? '->' : '  ';
    const source = p.hostOverride ? 'discover' : p.host ? 'host' : 'mDNS';
    const target = p.hostOverride || p.host || cfg.defaultHost;
    console.log(marker + ' ' + name.padEnd(12) + ' ' + target.padEnd(22) + ' (' + source + ')');
  }
}

function cmdUse(name) {
  const cfg = load();
  if (!cfg.profiles[name]) die(`no profile '${name}' in profiles.json`);
  cfg.active = name;
  save(cfg);
  console.log(name + ' active -> ' + resolveTarget(cfg));
}

async function cmdResolve() {
  const cfg = load();
  const target = resolveTarget(cfg);
  const r = await probePort(target, 22);
  console.log(cfg.active + ': ' + target + '  tcp/22 ' + (r.ok ? 'OK' : r.why));
  if (!r.ok) process.exitCode = 1;
}

function startInteractive(bin, args) {
  const kid = cp.spawn(bin, args, { stdio: 'inherit' });
  kid.on('exit', (c) => process.exit(c == null ? 1 : c));
}

function cmdSsh(args) {
  const cfg = load();
  if (args[0] === '--') args.shift();
  startInteractive('ssh', [userAt(cfg)].concat(args));
}

function cmdScp(args) {
  const cfg = load();
  const at = userAt(cfg);
  const mapped = args.map((a) => {
    let s = a;
    if (s.startsWith('norns:')) {
      s = s.slice('norns:'.length)
        .replace(/^\u2192/, '');
      return at + ':' + s;
    }
    if (s === ':') return at + ':';
    return s;
  });
  startInteractive('scp', mapped);
}

function mDNSUsesTarget(cfg) {
  return new Promise((done) => {
    dns.lookup(cfg.defaultHost, (err, addr) => {
      if (err) return done(false);
      probePort(addr, 22).then((r) => done(r.ok));
    });
  });
}

function findMacInArp(prefixHex) {
  return new Promise((done) => {
    const out = [];
    const kid = cp.spawn('arp', ['-a']);
    kid.stdout.on('data', (d) => out.push(d));
    kid.on('error', () => done(null));
    kid.on('close', () => {
      const text = out.join('');
      for (const line of text.split(/\r?\n/)) {
        const macM = line.match(/([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}/);
        if (!macM) continue;
        const hex = macM[0].replace(/[^0-9a-fA-F]/g, '').toLowerCase();
        if (!hex.startsWith(prefixHex)) continue;
        const ipM = line.match(/(\d{1,3}\.){3}\d{1,3}/);
        if (ipM) return done(ipM[0]);
      }
      done(null);
    });
  });
}

async function cmdDiscover() {
  const cfg = load();
  if (await mDNSUsesTarget(cfg)) {
    console.log('mDNS OK: ' + cfg.defaultHost + ' answers ssh - already reachable, nothing to store');
    return;
  }
  if (!cfg.nornsMac) die('nornsMac not configured; cannot arp-discover');
  const prefixHex = cfg.nornsMac.replace(/[^0-9a-fA-F]/g, '').toLowerCase().slice(0, 6);
  const ip = await findMacInArp(prefixHex);
  if (!ip) {
    console.log('not found via mDNS or arp (' + cfg.nornsMac + ')');
    process.exitCode = 1;
    return;
  }
  const p = cfg.profiles[cfg.active];
  p.hostOverride = ip;
  save(cfg);
  console.log('discovered ' + ip + ' -> stored as profiles.' + cfg.active + '.hostOverride');
}

function findPubKey() {
  const dir = path.join(os.homedir(), '.ssh');
  for (const name of ['id_ed25519.pub', 'id_rsa.pub', 'id_ecdsa.pub']) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) {
      const key = fs.readFileSync(p, 'utf8').trim().split('\n')[0];
      return { key: key, file: p };
    }
  }
  die('no pubkey in ~/.ssh (id_ed25519.pub / id_rsa.pub / id_ecdsa.pub) - generate one first');
}

function cmdKey(cfg) {
  const { key, file } = findPubKey();
  const at = userAt(cfg);
  const parts = key.split(/\s+/, 2).join(' ');
  const check = cp.spawn('ssh', [at, 'cat ~/.ssh/authorized_keys 2>/dev/null'], {
    stdio: ['inherit', 'pipe', 'inherit'],
  });
  let remote = '';
  check.stdout.on('data', (d) => (remote += d));
  check.on('exit', () => {
    if (remote.split('\n').some((l) => l.startsWith(parts))) {
      console.log('key already installed on ' + at + ' (' + file + ')');
      return;
    }
    const kid = cp.spawn(
      'ssh',
      [at, 'set -e; umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; chmod 600 ~/.ssh/authorized_keys; cat >> ~/.ssh/authorized_keys'],
      { stdio: ['pipe', 'inherit', 'inherit'] }
    );
    kid.stdin.write(key + '\n');
    kid.stdin.end();
    kid.on('exit', (c) => {
      if (c === 0) console.log('installed ' + file + ' on ' + at);
      else process.exit(c == null ? 1 : c);
    });
  });
}

const cmd = process.argv[2];
const args = process.argv.slice(3);

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  usage();
  process.exit(cmd ? 0 : 1);
}

(async () => {
  const cfg = load();
  switch (cmd) {
    case 'list':
      return cmdList();
    case 'use':
      if (!args[0]) die('usage: connect.js use <name>');
      return cmdUse(args[0]);
    case 'resolve':
      return cmdResolve();
    case 'ssh':
      return cmdSsh(args);
    case 'scp':
      if (args.length < 2) die('usage: connect.js scp <src..> <dest>');
      return cmdScp(args);
    case 'discover':
      return cmdDiscover();
    case 'key':
      return cmdKey(cfg);
    default:
      die(`unknown command '${cmd}' (try 'help')`);
  }
})();