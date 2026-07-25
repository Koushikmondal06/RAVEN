'use client';

import Link from 'next/link';
import { useState } from 'react';
import { type Auth, AuthPanel } from '../../lib/AuthPanel';

const IMAGE = process.env.NEXT_PUBLIC_CONTRIBUTOR_IMAGE ?? 'ghcr.io/your-org/raven-contributor';
const REGISTRY = process.env.NEXT_PUBLIC_REGISTRY_URL ?? 'http://localhost:4000';

export default function ContributorPage() {
  return (
    <main>
      <h1>RAVEN</h1>
      <p className="sub">
        Share your machine's compute, earn SOL. · <Link href="/">← Rent instead</Link>
      </p>
      <AuthPanel role="contributor" title="Become a Contributor">
        {(auth) => <Onboard auth={auth} />}
      </AuthPanel>
    </main>
  );
}

function Onboard({ auth }: { auth: Auth }) {
  const [copied, setCopied] = useState(false);
  const key = auth.contributorKey ?? 'rvn_ctb_…';
  // The daemon authenticates with only this key. The docker socket lets it launch sandboxes as
  // sibling containers on your host — the one mount the design needs; it carries no secrets.
  const cmd = `docker run -d \\
  -e RAVEN_KEY=${key} \\
  -e REGISTRY_URL=${REGISTRY} \\
  -v /var/run/docker.sock:/var/run/docker.sock \\
  ${IMAGE}`;

  return (
    <section>
      <h2>Your contributor key</h2>
      <p className="sub">
        Signed in as {auth.address}. Earnings settle to this address at each lease end. Keep the key
        secret — anyone with it can register nodes that pay out to you.
      </p>
      <code>{key}</code>
      <h2 style={{ marginTop: '1.5rem' }}>Run the daemon</h2>
      <code>{cmd}</code>
      <div className="row" style={{ marginTop: '0.75rem' }}>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(cmd).then(() => setCopied(true));
          }}
        >
          {copied ? 'Copied ✓' : 'Copy command'}
        </button>
        <button className="ghost" onClick={auth.disconnect}>
          Disconnect
        </button>
      </div>
    </section>
  );
}
