import { lookup as dnsLookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';

/**
 * Server-side download of an image URL for `attach_image({url})`, guarded against SSRF:
 * https only; every address the host resolves to must be public (checked after DNS, and the
 * connection is pinned to the checked address, so a second lookup cannot rebind it);
 * redirects are followed by hand (at most 3) and checked the same way; size and time are capped.
 */

export interface FetchOptions {
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
  /** DNS lookup (tests pass a fake one). */
  lookup: (host: string) => Promise<{ address: string; family: number }[]>;
  /** Addresses that must never be contacted. */
  blocked: BlockList;
  /** Extra CA certificates (tests use a self-signed server). */
  ca?: string | Buffer;
}

/** Private, loopback, link-local, CGNAT, multicast, documentation and other non-public ranges. */
export function privateRanges(): BlockList {
  const list = new BlockList();
  for (const [net, prefix] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ] as const)
    list.addSubnet(net, prefix, 'ipv4');
  for (const [net, prefix] of [
    ['::', 128],
    ['::1', 128],
    ['64:ff9b::', 96],
    ['100::', 64],
    ['2001::', 23],
    ['2001:db8::', 32],
    ['2002::', 16],
    ['fc00::', 7],
    ['fe80::', 10],
    ['fec0::', 10],
    ['ff00::', 8],
  ] as const)
    list.addSubnet(net, prefix, 'ipv6');
  return list;
}

export const DEFAULT_FETCH: FetchOptions = {
  timeoutMs: 10_000,
  maxBytes: 10 * 1024 * 1024,
  maxRedirects: 3,
  lookup: (host) => dnsLookup(host, { all: true, verbatim: true }),
  blocked: privateRanges(),
};

export class FetchRefused extends Error {
  override name = 'FetchRefused';
}

/** IPv4 address embedded in an IPv4-mapped IPv6 address (`::ffff:127.0.0.1`). */
function mappedV4(address: string): string | undefined {
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  return m?.[1];
}

export function isBlockedAddress(address: string, blocked: BlockList): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  if (family === 6) {
    const v4 = mappedV4(address);
    if (v4) return blocked.check(v4, 'ipv4') || blocked.check(address, 'ipv6');
    return blocked.check(address, 'ipv6');
  }
  return blocked.check(address, 'ipv4');
}

/** Resolve a host and return one address, refusing when any of its addresses is non-public. */
async function vet(host: string, opts: FetchOptions): Promise<{ address: string; family: 4 | 6 }> {
  const bare = host.replace(/^\[|\]$/g, '');
  const addresses = isIP(bare) ? [{ address: bare, family: isIP(bare) }] : await opts.lookup(bare);
  if (!addresses.length) throw new FetchRefused(`${host} does not resolve`);
  for (const a of addresses) {
    if (isBlockedAddress(a.address, opts.blocked))
      throw new FetchRefused(`refusing to fetch from ${host}: ${a.address} is a private or local address`);
  }
  const first = addresses[0] as { address: string; family: number };
  return { address: first.address, family: first.family === 6 ? 6 : 4 };
}

export interface Fetched {
  data: Buffer;
  contentType?: string;
  url: string;
}

/** Download `url` under the SSRF rules above. */
export async function fetchImageUrl(url: string, options: Partial<FetchOptions> = {}): Promise<Fetched> {
  const opts = { ...DEFAULT_FETCH, ...options };
  const deadline = Date.now() + opts.timeoutMs;
  let current = url;
  for (let hop = 0; ; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      throw new FetchRefused(`invalid URL: ${current}`);
    }
    if (parsed.protocol !== 'https:') throw new FetchRefused(`only https URLs are allowed (got ${parsed.protocol})`);
    if (parsed.username || parsed.password) throw new FetchRefused('URLs with credentials are not allowed');
    const target = await vet(parsed.hostname, opts);
    const res = await get(parsed, target, opts, deadline);
    if (res.redirect) {
      if (hop >= opts.maxRedirects) throw new FetchRefused(`too many redirects (max ${opts.maxRedirects})`);
      current = new URL(res.redirect, parsed).toString();
      continue;
    }
    return {
      data: res.data ?? Buffer.alloc(0),
      ...(res.contentType ? { contentType: res.contentType } : {}),
      url: current,
    };
  }
}

function get(
  url: URL,
  target: { address: string; family: 4 | 6 },
  opts: FetchOptions,
  deadline: number,
): Promise<{ redirect?: string; data?: Buffer; contentType?: string }> {
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      reject(new FetchRefused(`timed out after ${opts.timeoutMs / 1000} s`));
      return;
    }
    const req = request(
      url,
      {
        method: 'GET',
        headers: { 'User-Agent': 'taskpack-mcp', Accept: 'image/*,application/pdf' },
        // Connect to the vetted address only; the hostname is still used for TLS (SNI + certificate).
        // (Node asks for all addresses when it may race IPv4 and IPv6.)
        lookup: ((_host: string, o: { all?: boolean }, cb: (...args: unknown[]) => void) =>
          o.all
            ? cb(null, [{ address: target.address, family: target.family }])
            : cb(null, target.address, target.family)) as never,
        ...(opts.ca ? { ca: opts.ca } : {}),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          resolve({ redirect: res.headers.location });
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new FetchRefused(`download failed: HTTP ${status}`));
          return;
        }
        const declared = Number(res.headers['content-length'] ?? 0);
        if (declared > opts.maxBytes) {
          res.destroy();
          reject(new FetchRefused(`image is too large (${declared} bytes, max ${opts.maxBytes})`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > opts.maxBytes) {
            res.destroy();
            reject(new FetchRefused(`image is too large (max ${opts.maxBytes} bytes)`));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          clearTimeout(timer);
          const contentType = res.headers['content-type'];
          resolve({ data: Buffer.concat(chunks), ...(contentType ? { contentType } : {}) });
        });
        res.on('error', reject);
      },
    );
    const timer = setTimeout(() => {
      req.destroy(new FetchRefused(`timed out after ${opts.timeoutMs / 1000} s`));
    }, remaining);
    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err instanceof FetchRefused ? err : new FetchRefused(`download failed: ${err.message}`));
    });
    req.on('close', () => clearTimeout(timer));
    req.end();
  });
}
