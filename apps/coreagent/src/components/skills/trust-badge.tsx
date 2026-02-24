import { Badge } from '@/components/ui/badge';

export function TrustBadge({ trusted }: { trusted?: boolean | null }) {
  if (!trusted) {
    return <Badge variant="outline">Unreviewed</Badge>;
  }
  return <Badge variant="secondary">Trusted</Badge>;
}
