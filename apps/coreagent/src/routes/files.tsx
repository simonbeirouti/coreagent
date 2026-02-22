import { createFileRoute } from '@tanstack/react-router';
import { Header } from '@/components/header';
import { useAuth } from '@/hooks/use-auth';
import { UserFileBrowser } from '@/components/files/user-file-browser';

export const Route = createFileRoute('/files')({
  component: FilesPage,
});

function FilesPage() {
  const { user } = useAuth();

  if (!user?.id) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Sign in to manage files.
      </div>
    );
  }

  return (
    <div className="space-y-6 px-4">
      <Header
        title="Files"
        description="Upload and manage private files shared across all your agent chats."
      />
        <UserFileBrowser userId={user.id} mode="manage" />
    </div>
  );
}
