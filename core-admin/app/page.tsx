"use client";

import { AdminShell, ErrorList } from "@/components/admin-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useOverviewQuery } from "@/lib/query/admin-queries";
import { CORE_TOOL_CLASSES, SKILLS_REGISTRY_LIFECYCLE } from "@/lib/admin/platform-docs";

export default function Home() {
  const { data, isPending, error } = useOverviewQuery();

  const errors = [
    ...(data?.errors ?? []),
    ...(data?.configError ? [data.configError] : []),
    ...(error instanceof Error ? [error.message] : []),
  ];

  return (
    <AdminShell
      title="Operations Overview"
      description="Admin surface for CoreAgent runtime entities aligned with ai-core-tools and skills-registry lifecycle enforcement."
    >
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {(data?.cards ?? []).map((card) => (
          <Card key={card.label} className="py-4">
            <CardHeader className="pb-2">
              <CardDescription>{card.label}</CardDescription>
              <CardTitle className="text-3xl">{card.value}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-sm">{card.hint}</p>
            </CardContent>
          </Card>
        ))}

        {isPending && (
          <Card className="col-span-full py-4">
            <CardContent className="text-muted-foreground text-sm">Loading overview...</CardContent>
          </Card>
        )}
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>AI Core Tool Classes</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {CORE_TOOL_CLASSES.map((toolClass) => (
                <li key={toolClass.name} className="space-y-1">
                  <p className="font-medium">{toolClass.name}</p>
                  <p className="text-muted-foreground text-sm">{toolClass.notes}</p>
                  <div className="flex flex-wrap gap-2">
                    {toolClass.keys.map((key) => (
                      <Badge key={key} variant="outline">
                        {key}
                      </Badge>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Skills Registry Lifecycle</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2">
              {SKILLS_REGISTRY_LIFECYCLE.map((stage, index) => (
                <li key={stage} className="text-sm">
                  <Badge className="mr-2" variant="secondary">
                    {index + 1}
                  </Badge>
                  <span className="font-mono">{stage}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </section>

      <ErrorList errors={errors} />
    </AdminShell>
  );
}
