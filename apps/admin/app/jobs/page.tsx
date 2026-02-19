"use client";

import { AdminShell, ErrorList } from "@/components/admin-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useJobsQuery } from "@/lib/query/admin-queries";

export default function JobsPage() {
  const { data, isPending, error } = useJobsQuery();
  const errors = [...(data?.errors ?? []), ...(error instanceof Error ? [error.message] : [])];

  return (
    <AdminShell
      title="Jobs"
      description="Live orchestration run board with status, priority, queue pressure, and execution latency from task attempts."
    >
      <Card>
        <CardHeader>
          <CardTitle>Orchestration Runs</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Total Tasks</TableHead>
                <TableHead>Open Tasks</TableHead>
                <TableHead>Avg Attempt Latency</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.rows ?? []).map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <p className="font-medium">{row.title}</p>
                    <p className="text-muted-foreground font-mono text-xs">{row.id}</p>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{row.status}</Badge>
                  </TableCell>
                  <TableCell>{row.priority}</TableCell>
                  <TableCell>{row.taskCount}</TableCell>
                  <TableCell>{row.openTaskCount}</TableCell>
                  <TableCell>{row.avgLatencyMs === null ? "-" : `${row.avgLatencyMs} ms`}</TableCell>
                  <TableCell>{new Date(row.updatedAt).toLocaleString()}</TableCell>
                </TableRow>
              ))}

              {isPending && (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">
                    Loading jobs...
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
