/** The egress ruleset generator is a security boundary, so pin its shape. Run: tsx nft.test.ts */
import { ok } from 'node:assert/strict';
import { buildNftRuleset } from './nft.js';

const iface = 'rvn1234abcd';
const ownCidr = '172.31.10.0/30';

// Every mode: default-drop, metadata blocked, RFC1918 blocked, own /30 allowed.
for (const mode of ['deny-all', 'allowlist', 'open'] as const) {
  const rs = buildNftRuleset('lease-1234abcd', iface, ownCidr, { mode, dnsResolver: '1.1.1.1' });
  ok(/policy drop;/.test(rs), `${mode}: chain must default to drop`);
  ok(rs.includes('ip daddr 169.254.169.254 counter drop'), `${mode}: must drop cloud metadata`);
  ok(rs.includes('10.0.0.0/8'), `${mode}: must drop RFC1918`);
  ok(rs.includes(`ip daddr ${ownCidr} accept`), `${mode}: must allow the lease's own /30`);
  ok(rs.includes('dport 53 accept'), `${mode}: must allow DNS to the resolver`);
  ok(/limit rate over \d+\/minute/.test(rs), `${mode}: must rate-limit new connections`);
}

// deny-all must not accept arbitrary traffic; open must.
const deny = buildNftRuleset('l', iface, ownCidr, { mode: 'deny-all' });
ok(!/\n\s{4}accept\n/.test(deny), 'deny-all must not blanket-accept');
const open = buildNftRuleset('l', iface, ownCidr, { mode: 'open' });
ok(/\n\s{4}accept\n/.test(open), 'open must blanket-accept');

// allowlist opens exactly the requested CIDR+ports and nothing else.
const allow = buildNftRuleset('l', iface, ownCidr, {
  mode: 'allowlist',
  allowCidrs: ['93.184.216.0/24'],
  allowPorts: [443, 80],
});
ok(allow.includes('ip daddr 93.184.216.0/24 tcp dport { 443, 80 } accept'), 'allowlist must open the CIDR+ports');
ok(!/\n\s{4}accept\n/.test(allow), 'allowlist must not blanket-accept');

console.log('nft ok');
