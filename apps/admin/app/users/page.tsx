"use client";

import { AdminShell, ErrorList } from "@/components/admin-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useUsersQuery } from "@/lib/query/admin-queries";

export default function UsersPage() {
  const { data, isPending, error } = useUsersQuery();
  const errors = [...(data?.errors ?? []), ...(error instanceof Error ? [error.message] : [])];

  return (
    <AdminShell
      title="Users"
      description="Profiles enriched with user-level preferences and installed-skill footprint."
    >
      <Card>
        <CardHeader>
          <CardTitle>User Records</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Timezone</TableHead>
                <TableHead>Agents</TableHead>
                <TableHead>Installed Skills</TableHead>
                <TableHead>Last Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.rows ?? []).map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">{row.id}</TableCell>
                  <TableCell>{row.fullName}</TableCell>
                  <TableCell>{row.timezone}</TableCell>
                  <TableCell>{row.agents}</TableCell>
                  <TableCell>{row.installedSkills}</TableCell>
                  <TableCell>{new Date(row.updatedAt).toLocaleString()}</TableCell>
                </TableRow>
              ))}

              {isPending && (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    Loading users...
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
