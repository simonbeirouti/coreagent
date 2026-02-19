"use client";

import { AdminShell, ErrorList } from "@/components/admin-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SKILLS_REGISTRY_LIFECYCLE } from "@/lib/admin/platform-docs";
import { useSkillsQuery } from "@/lib/query/admin-queries";

export default function SkillsPage() {
  const { data, isPending, error } = useSkillsQuery();
  const errors = [...(data?.errors ?? []), ...(error instanceof Error ? [error.message] : [])];

  return (
    <AdminShell
      title="Skills Registry"
      description="Catalog, policy status, install footprint, and unresolved advisory exposure for registry-managed skills."
    >
      <Card>
        <CardHeader>
          <CardTitle>Lifecycle Gate</CardTitle>
          <CardDescription>{SKILLS_REGISTRY_LIFECYCLE.join(" -> ")}</CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Skill Catalog</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Skill</TableHead>
                <TableHead>Impl Key</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead>Latest Version</TableHead>
                <TableHead>Policy</TableHead>
                <TableHead>Installs</TableHead>
                <TableHead>Open Advisories</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.rows ?? []).map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <p className="font-medium">{row.name}</p>
                    <p className="text-muted-foreground font-mono text-xs">{row.skillId}</p>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.implementationKey}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{row.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{row.risk}</Badge>
                  </TableCell>
                  <TableCell>{row.latestVersion}</TableCell>
                  <TableCell>{row.policyStatus}</TableCell>
                  <TableCell>{row.installs}</TableCell>
                  <TableCell>{row.unresolvedAdvisories}</TableCell>
                  <TableCell>{new Date(row.updatedAt).toLocaleString()}</TableCell>
                </TableRow>
              ))}

              {isPending && (
                <TableRow>
                  <TableCell colSpan={9} className="text-muted-foreground">
                    Loading skills...
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <ErrorList errors={errors} />
    </AdminShell>
  );
}
