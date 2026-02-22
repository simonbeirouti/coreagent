import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FileList } from '@/components/files/file-list';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ALLOWED_USER_FILE_EXTENSIONS,
  type AllowedUserFileExtension,
  type UserFileRecord,
} from '@/lib/storage';
import {
  useDeleteUserFile,
  useUploadUserFile,
  useUserFiles,
} from '@/hooks/useUserFiles';

interface UserFileBrowserProps {
  userId: string;
  mode: 'manage' | 'select';
  onSelectFile?: (file: UserFileRecord) => void;
}

export function UserFileBrowser({
  userId,
  mode,
  onSelectFile,
}: UserFileBrowserProps) {
  const [filter, setFilter] = useState<AllowedUserFileExtension | 'all'>('all');
  const { data: files = [], isLoading } = useUserFiles(userId);
  const uploadUserFile = useUploadUserFile(userId);
  const deleteUserFile = useDeleteUserFile(userId);

  const visibleFiles = useMemo(() => {
    if (filter === 'all') return files;
    return files.filter((file) => file.file_ext === filter);
  }, [files, filter]);

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const extension = file.name.split('.').pop()?.toLowerCase() || '';
      if (!ALLOWED_USER_FILE_EXTENSIONS.includes(extension as AllowedUserFileExtension)) {
        toast.error(`Unsupported file type. Allowed: ${ALLOWED_USER_FILE_EXTENSIONS.join(', ')}`);
        return;
      }
      await uploadUserFile.mutateAsync(file);
      toast.success('File uploaded');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to upload file');
    } finally {
      event.target.value = '';
    }
  };

  const handleDelete = async (file: UserFileRecord) => {
    try {
      await deleteUserFile.mutateAsync(file);
      toast.success('File deleted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete file');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Select
          value={filter}
          onValueChange={(next) => setFilter(next as AllowedUserFileExtension | 'all')}
        >
          <SelectTrigger className="w-[160px]" size="sm">
            <SelectValue placeholder="Filter type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {ALLOWED_USER_FILE_EXTENSIONS.map((ext) => (
              <SelectItem key={ext} value={ext}>
                {ext.toUpperCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label>
          <input
            type="file"
            className="hidden"
            onChange={handleUpload}
            accept=".txt,.pdf,.doc,.csv,.png,.jpg,.jpeg,.gif,.webp,text/plain,application/pdf,application/msword,text/csv,image/png,image/jpeg,image/gif,image/webp"
          />
          <Button size="sm" variant="outline" asChild>
            <span>
              <Upload className="h-3.5 w-3.5 sm:mr-1" />
              <span className="hidden sm:inline">Upload</span>
            </span>
          </Button>
        </label>
      </div>

      <ScrollArea className="h-[420px] rounded-md border p-3">
        <FileList
          files={visibleFiles}
          isLoading={isLoading}
          emptyText="No files uploaded yet."
          actionLabel={mode === 'select' ? 'Attach' : 'Use'}
          onAction={onSelectFile}
          onDelete={handleDelete}
        />
      </ScrollArea>
    </div>
  );
}
