"use client";

import { AdminShell, ErrorList } from "@/components/admin-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CORE_TOOL_CLASSES } from "@/lib/admin/platform-docs";
import { useToolsQuery } from "@/lib/query/admin-queries";

export default function ToolsPage() {
  const { data, isPending, error } = useToolsQuery();
  const errors = [...(data?.errors ?? []), ...(error instanceof Error ? [error.message] : [])];

  return (
    <AdminShell
      title="Tools"
      description="Source-of-truth ability registry and per-agent enablement coverage aligned with AI core tool policy."
    >
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {CORE_TOOL_CLASSES.map((toolClass) => (
          <Card key={toolClass.name}>
            <CardHeader>
              <CardTitle>{toolClass.name}</CardTitle>
              <CardDescription>{toolClass.notes}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {toolClass.keys.map((key) => (
                <Badge key={key} variant="outline">
                  {key}
                </Badge>
              ))}
            </CardContent>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Ability Registry</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ability</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Implementation Key</TableHead>
                <TableHead>Assigned Agents</TableHead>
                <TableHead>Enabled Agents</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.rows ?? []).map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>{row.category}</TableCell>
                  <TableCell className="font-mono text-xs">{row.implementationKey}</TableCell>
                  <TableCell>{row.assignedToAgents}</TableCell>
                  <TableCell>{row.enabledOnAgents}</TableCell>
                </TableRow>
              ))}

              {isPending && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    Loading tools...
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
