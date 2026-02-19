import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type ShellProps = {
  section?: "dashboard" | "users" | "agents" | "skills" | "jobs" | "tools";
  title: string;
  description: string;
  children: React.ReactNode;
};

export function AdminShell({ title, description, children }: ShellProps) {
  return (
    <div className="mx-auto flex w-full flex-1 flex-col gap-4">
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h2>
        <p className="text-muted-foreground max-w-4xl text-sm md:text-base">{description}</p>
      </header>
      {children}
    </div>
  );
}

type ErrorListProps = {
  errors: string[];
};

export function ErrorList({ errors }: ErrorListProps) {
  if (errors.length === 0) {
    return null;
  }

  return (
    <Alert variant="destructive">
      <AlertTitle>Data Source Errors</AlertTitle>
      <AlertDescription>
        <ul className="list-disc space-y-1 pl-5">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
