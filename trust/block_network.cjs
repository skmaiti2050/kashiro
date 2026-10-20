// Preloaded into every CLI run of the trust suite (NODE_OPTIONS=--require): any network
// attempt throws, so a run that touches the network fails the gate (spec section 9).
// Harper's inlined wasm is fetched from a data: URL, which never leaves the process: allow only that.
'use strict';
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const tls = require('node:tls');
const dgram = require('node:dgram');

function boom(what) {
  return () => {
    throw new Error(`trust suite: network access attempted (${what})`);
  };
}

http.request = http.get = boom('http');
https.request = https.get = boom('https');
net.connect = net.createConnection = boom('net');
net.Socket.prototype.connect = boom('net.Socket');
tls.connect = boom('tls');
dgram.createSocket = boom('dgram');

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input && (input.url || String(input));
  if (String(url).startsWith('data:')) return realFetch(input, init);
  return Promise.reject(new Error(`trust suite: network access attempted (fetch ${url})`));
};
