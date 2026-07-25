/** The sandbox: one Docker container per lease, reachable over an outbound bore tunnel.
 *
 *  There is deliberately no backend interface here. The daemon ran a pluggable SandboxBackend
 *  (docker / gvisor / firecracker) with an isolation tier advertised per node; that machinery is gone
 *  along with the tiers, so this is a thin re-export of the container plumbing in oci.ts. */
export type { SandboxHandle, SandboxSpec } from './types.js';
export { type OciConfig, destroyContainer, listContainers, runContainer } from './oci.js';
