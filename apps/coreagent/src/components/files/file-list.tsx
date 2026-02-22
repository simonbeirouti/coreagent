import { Button } from '@/components/ui/button';
import { FileText, Trash2 } from 'lucide-react';
import type { UserFileRecord } from '@/lib/storage';

interface FileListProps {
  files: UserFileRecord[];
  isLoading?: boolean;
  emptyText?: string;
  actionLabel?: string;
  onAction?: (file: UserFileRecord) => void;
  onDelete?: (file: UserFileRecord) => void;
}

export function FileList({
  files,
  isLoading = false,
  emptyText = 'No files found.',
  actionLabel = 'Select',
  onAction,
  onDelete,
}: FileListProps) {
  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading files...</div>;
  }

  if (files.length === 0) {
    return <div className="text-sm text-muted-foreground">{emptyText}</div>;
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
      {files.map((file) => (
        <div
          key={file.id}
          className="flex min-h-[108px] flex-col justify-between gap-3 rounded-md border bg-card p-2"
        >
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{file.file_name}</div>
            <div className="text-xs text-muted-foreground">
              {file.file_ext.toUpperCase()} • {(file.size_bytes / 1024).toFixed(1)} KB
            </div>
          </div>
          <div className={`flex items-center gap-2 ${onAction ? '' : 'justify-end'}`}>
            {onAction ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onAction(file)}
                title={`${actionLabel} ${file.file_name}`}
                aria-label={`${actionLabel} ${file.file_name}`}
                className="flex-1"
              >
                <FileText className="h-3.5 w-3.5" />
              </Button>
            ) : null}
            {onDelete ? (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => onDelete(file)}
                className={onAction ? 'flex-1' : 'flex-1'}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
