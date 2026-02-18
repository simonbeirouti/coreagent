"use client";

import { AdminShell, ErrorList } from "@/components/admin-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AgentState } from "@/lib/admin/types";
import { useAgentsQuery, useUpdateAgentStateMutation } from "@/lib/query/admin-queries";

const AGENT_STATES: AgentState[] = ["active", "paused", "stopped"];

export default function AgentsPage() {
  const { data, isPending, error } = useAgentsQuery();
  const stateMutation = useUpdateAgentStateMutation();

  const errors = [
    ...(data?.errors ?? []),
    ...(error instanceof Error ? [error.message] : []),
    ...(stateMutation.error instanceof Error ? [stateMutation.error.message] : []),
  ];

  return (
    <AdminShell
      title="Agents"
      description="Operational view of model assignment, runtime status, capability coverage, and open orchestration workload."
    >
      <Card>
        <CardHeader>
          <CardTitle>Agent Runtime</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Provider/Model</TableHead>
                <TableHead>Mission</TableHead>
                <TableHead>Abilities</TableHead>
                <TableHead>Open Tasks</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.rows ?? []).map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <p className="font-medium">{row.name}</p>
                    <p className="text-muted-foreground font-mono text-xs">{row.id}</p>
                  </TableCell>
                  <TableCell className="space-y-2">
                    <Select
                      value={row.state}
                      onValueChange={(nextValue) => {
                        stateMutation.mutate({
                          agentId: row.id,
                          state: nextValue as AgentState,
                        });
                      }}
                    >
                      <SelectTrigger size="sm" className="w-[120px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {AGENT_STATES.map((state) => (
                          <SelectItem key={state} value={state}>
                            {state}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>{row.provider}</TableCell>
                  <TableCell className="max-w-sm whitespace-normal wrap-break-words align-top">
                    {row.mission}
                  </TableCell>
                  <TableCell>
                    {row.enabledAbilities}/{row.abilities}
                  </TableCell>
                  <TableCell>{row.openTasks}</TableCell>
                  <TableCell>{new Date(row.updatedAt).toLocaleString()}</TableCell>
                </TableRow>
              ))}

              {isPending && (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">
                    Loading agents...
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
