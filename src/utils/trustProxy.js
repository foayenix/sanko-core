'use strict';

// Reads TRUST_PROXY into a value for Express's 'trust proxy' setting.
//
// Behind a reverse proxy or tunnel every request arrives from the proxy's own
// address, so without this setting the portal rate limits would count all
// visitors as one client. With it, Express takes the client address from
// X-Forwarded-For, but only through the hops named here.
//
//   unset or blank   trust nothing; req.ip is the connecting address (default)
//   1                trust one hop, e.g. a single load balancer or tunnel
//   10.0.0.0/8,::1   trust only these proxy addresses or subnets
//   loopback         Express's names: loopback, linklocal, uniquelocal
//
// "true" is refused. It trusts every hop, so any client could name its own
// address in X-Forwarded-For and escape the rate limits.

const net = require('node:net');
const { env } = require('./env');

const NAMES = new Set(['loopback', 'linklocal', 'uniquelocal']);

function isAddressOrSubnet(value) {
  const [address, bits, extra] = value.split('/');
  const version = net.isIP(address);
  if (!version || extra !== undefined) return false;
  if (bits === undefined) return true;
  if (!/^\d{1,3}$/.test(bits)) return false;
  return Number(bits) <= (version === 4 ? 32 : 128);
}

function trustProxy(raw = env('TRUST_PROXY')) {
  if (raw === undefined) return false;
  const value = raw.trim();
  if (value === '' || value === 'false') return false;
  if (value === 'true') {
    throw new Error(
      'TRUST_PROXY=true would let any client set its own address. ' +
        'Use a hop count such as 1, or the proxy addresses.',
    );
  }
  if (/^\d+$/.test(value)) return Number(value);
  const parts = value.split(',').map(part => part.trim());
  const invalid = parts.filter(part => !NAMES.has(part) && !isAddressOrSubnet(part));
  if (invalid.length) throw new Error(`TRUST_PROXY has invalid entries: ${invalid.join(', ')}`);
  return parts;
}

module.exports = { trustProxy };
