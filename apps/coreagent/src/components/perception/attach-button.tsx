import React from 'react';
import { Button } from '@/components/ui/button';
import { ChevronRight, FolderOpen, Paperclip, Upload } from 'lucide-react';
import type { UserFileRecord } from '@/lib/storage';
import { useAuth } from '@/hooks/use-auth';
import { useRecentUserFiles, useUploadUserFile } from '@/hooks/useUserFiles';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { UserFileBrowser } from '@/components/files/user-file-browser';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ALLOWED_USER_FILE_EXTENSIONS, MAX_ATTACHMENT_BYTES } from '@/lib/storage';
import { toast } from 'sonner';

interface AttachButtonProps {
  onAttach?: (file: UserFileRecord) => void;
  disabled?: boolean;
}

export function AttachButton({
  onAttach,
  disabled,
}: AttachButtonProps) {
  const { user } = useAuth();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const uploadUserFile = useUploadUserFile(user?.id || '');
  const { data: recentFiles = [] } = useRecentUserFiles(user?.id || '', 5);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const attachableRecentFiles = React.useMemo(
    () =>
      recentFiles.filter(
        (file) =>
          !file.id.startsWith('temp-') &&
          !file.storage_path.startsWith('pending/') &&
          file.storage_path.trim().length > 0
      ),
    [recentFiles]
  );

  const handleUploadClick = () => {
    fileInputRef.current?.click();
    setMenuOpen(false);
  };

  const handleSelectFile = (file: UserFileRecord) => {
    if (file.id.startsWith('temp-') || file.storage_path.startsWith('pending/')) {
      toast.warning('File is still uploading. Please wait a moment and try again.');
      return;
    }
    onAttach?.(file);
    setMenuOpen(false);
  };

  const openExplorer = () => {
    setMenuOpen(false);
    setOpen(true);
  };

  const handleUploadFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.error(
        `File too large. Maximum size is 5MB (${file.size} bytes selected).`
      );
      return;
    }

    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    if (!ALLOWED_USER_FILE_EXTENSIONS.includes(extension as (typeof ALLOWED_USER_FILE_EXTENSIONS)[number])) {
      toast.error(`Unsupported file type. Allowed: ${ALLOWED_USER_FILE_EXTENSIONS.join(', ')}`);
      return;
    }

    try {
      if (!user?.id) {
        toast.error('You must be logged in to attach files');
        return;
      }
      const result = await uploadUserFile.mutateAsync(file);
      onAttach?.(result.record);
      if (!onAttach) {
        toast.success('File uploaded');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to upload');
    } finally {
      event.target.value = '';
    }
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept=".txt,.pdf,.doc,.csv,.png,.jpg,.jpeg,.gif,.webp,text/plain,application/pdf,application/msword,text/csv,image/png,image/jpeg,image/gif,image/webp"
        onChange={handleUploadFileSelect}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              disabled={disabled || uploadUserFile.isPending}
              size="default"
              variant="outline"
              className="shrink-0"
              title="Attach file"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuItem onClick={handleUploadClick}>
              <Upload className="h-4 w-4" />
              Upload a file
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Paperclip className="h-4 w-4" />
                Recent
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-64">
                {attachableRecentFiles.length > 0 ? (
                  attachableRecentFiles.slice(0, 5).map((file) => (
                    <DropdownMenuItem key={file.id} onClick={() => handleSelectFile(file)}>
                      <span className="max-w-[180px] truncate">{file.file_name}</span>
                      <ChevronRight className="ml-auto h-4 w-4 opacity-60" />
                    </DropdownMenuItem>
                  ))
                ) : (
                  <DropdownMenuItem onClick={openExplorer}>
                    <FolderOpen className="h-4 w-4" />
                    Open explorer
                  </DropdownMenuItem>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onClick={openExplorer}>
              <FolderOpen className="h-4 w-4" />
              Open explorer
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DialogContent className="w-full sm:min-w-2/3">
          <DialogHeader>
            <DialogTitle>Attach from your assets</DialogTitle>
          </DialogHeader>
          <div className="w-full">
            <UserFileBrowser
              userId={user?.id || ''}
              mode="select"
              onSelectFile={handleSelectFile}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}