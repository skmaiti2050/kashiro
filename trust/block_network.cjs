// Preloaded into every CLI run of the trust suite (NODE_OPTIONS=--require). Fails closed: any network
// attempt (http, https, net, tls, dgram, dns, fetch other than data:) throws AND marks the run as failed,
// so code that catches the error still cannot pass the gate:
//   - the process exit code is forced to 99, whatever the program sets;
//   - the marker file named by TRUST_NET_MARKER is written with what was attempted.
// Harper's inlined wasm is fetched from a data: URL, which never leaves the process: only that is allowed.
'use strict';
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const tls = require('node:tls');
const dgram = require('node:dgram');
const dns = require('node:dns');
const { syncBuiltinESMExports } = require('node:module');

const EXIT_NETWORK = 99;
let attempted = false;

function record(what) {
  attempted = true;
  process.exitCode = EXIT_NETWORK;
  const marker = process.env.TRUST_NET_MARKER;
  if (marker) {
    try {
      fs.appendFileSync(marker, `${what}\n`);
    } catch {
      // the exit code still fails the run
    }
  }
  return new Error(`trust suite: network access attempted (${what})`);
}

function boom(what) {
  return () => {
    throw record(what);
  };
}

/**
 * Local IPC (a Unix socket or Windows named pipe, given as a path) never leaves the machine: tsx uses
 * one to talk to its parent process. Only path-based connections are allowed; host/port is network.
 */
function isLocalIpc(args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (typeof first === 'string') return !/^\d+$/.test(first);
  return !!first && typeof first === 'object' && typeof first.path === 'string' && first.port === undefined;
}

function ipcOnly(what, original) {
  return function (...args) {
    if (isLocalIpc(args)) return original.apply(this, args);
    throw record(`${what} ${JSON.stringify(args[0] && typeof args[0] === 'object' ? { host: args[0].host, port: args[0].port } : args[0])}`);
  };
}

http.request = http.get = boom('http');
https.request = https.get = boom('https');
net.connect = net.createConnection = ipcOnly('net', net.connect);
net.Socket.prototype.connect = ipcOnly('net.Socket', net.Socket.prototype.connect);
tls.connect = boom('tls');
dgram.createSocket = boom('dgram');
for (const fn of ['lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny']) {
  dns[fn] = boom(`dns.${fn}`);
  if (dns.promises[fn]) dns.promises[fn] = (...a) => Promise.reject(record(`dns.promises.${fn} ${a[0]}`));
}

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input && (input.url || String(input));
  if (String(url).startsWith('data:')) return realFetch(input, init);
  return Promise.reject(record(`fetch ${url}`));
};

// `import http from 'node:http'` in ESM code sees the patched functions only after this.
syncBuiltinESMExports();

// process.exit(0) after a caught attempt must still fail.
process.on('exit', () => {
  if (attempted) process.exitCode = EXIT_NETWORK;
});
