/** Per-lease egress firewall. buildNftRuleset() is pure and unit-tested; apply/remove/readCounter
 *  shell out to nft + tc (UNVERIFIED here — need root + nftables on the host).
 *
 *  The ruleset, keyed to the lease's tap/veth, blocks the abuse that isolation does nothing about:
 *  default-drop outbound, DNS only to the configured resolver, only the buyer's allowlisted
 *  CIDRs/ports, and it drops the cloud metadata IP and every RFC1918 range except the lease's own
 *  /30. New connections are rate-limited and drops counted per lease. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { EgressPolicy } from '../../../shared/types.js';

const run = promisify(execFile);

const table = (leaseId: string) => `raven_${leaseId.slice(0, 8)}`;

/** Returns the nftables ruleset text for a lease. Pure — no host calls, so it is testable. */
export function buildNftRuleset(leaseId: string, iface: string, ownCidr: string, policy: EgressPolicy): string {
  const t = table(leaseId);
  const resolver = policy.dnsResolver ?? '1.1.1.1';
  const rate = policy.newConnsPerMinute ?? 120;

  const allowRules: string[] = [];
  // DNS only to the configured resolver.
  allowRules.push(`ip daddr ${resolver} udp dport 53 accept`);
  allowRules.push(`ip daddr ${resolver} tcp dport 53 accept`);
  if (policy.mode === 'open') {
    allowRules.push('accept');
  } else if (policy.mode === 'allowlist') {
    const cidrs = policy.allowCidrs ?? [];
    const ports = policy.allowPorts ?? [];
    for (const cidr of cidrs) {
      if (ports.length) allowRules.push(`ip daddr ${cidr} tcp dport { ${ports.join(', ')} } accept`);
      else allowRules.push(`ip daddr ${cidr} accept`);
    }
  }
  // mode === 'deny-all' adds nothing beyond DNS.

  return [
    `table inet ${t} {`,
    `  chain egress {`,
    `    type filter hook forward priority 0; policy drop;`,
    `    iifname != "${iface}" accept`, // only filter traffic leaving this lease's iface
    `    ct state established,related accept`,
    // Block metadata + RFC1918, but keep the lease's own /30 reachable (host side of the link).
    `    ip daddr 169.254.169.254 counter drop`,
    `    ip daddr ${ownCidr} accept`,
    `    ip daddr { 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 } counter drop`,
    // Rate-limit new outbound connections.
    `    ct state new limit rate over ${rate}/minute counter drop`,
    ...allowRules.map((r) => `    ${r}`),
    `    counter drop`, // default-drop counter = this lease's drop tally
    `  }`,
    `}`,
  ].join('\n');
}

/** Loads the lease's ruleset and caps bandwidth with tc. UNVERIFIED — needs root + nft + tc. */
export async function applyEgress(leaseId: string, iface: string, ownCidr: string, policy: EgressPolicy): Promise<void> {
  const ruleset = buildNftRuleset(leaseId, iface, ownCidr, policy);
  await run('nft', ['-f', '-'], { input: ruleset } as never).catch((e) => {
    throw new Error(`nft load failed for ${leaseId}: ${(e as Error).message}`);
  });
  if (policy.mbitCap && policy.mbitCap > 0) {
    await run('tc', ['qdisc', 'replace', 'dev', iface, 'root', 'tbf', 'rate', `${policy.mbitCap}mbit`, 'burst', '32kbit', 'latency', '400ms']).catch(() => {});
  }
}

export async function removeEgress(leaseId: string, iface: string): Promise<void> {
  await run('nft', ['delete', 'table', 'inet', table(leaseId)]).catch(() => {});
  await run('tc', ['qdisc', 'del', 'dev', iface, 'root']).catch(() => {});
}

/** The default-drop chain's counter = packets this lease tried to send and we blocked. */
export async function readDropCounter(leaseId: string): Promise<number> {
  try {
    const { stdout } = await run('nft', ['-j', 'list', 'table', 'inet', table(leaseId)]);
    const json = JSON.parse(stdout) as { nftables: Array<Record<string, unknown>> };
    let packets = 0;
    for (const item of json.nftables) {
      const c = (item as { counter?: { packets?: number } }).counter;
      if (c?.packets) packets += c.packets;
    }
    return packets;
  } catch {
    return 0;
  }
}
