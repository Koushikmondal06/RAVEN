import { Dashboard } from '../../lib/Dashboard';

// Same dashboard, contributor side up — /contributor stays a linkable entry point.
export default function ContributorPage() {
  return <Dashboard initialView="contributor" />;
}
