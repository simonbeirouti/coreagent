import { Button } from '@/components/ui/button';
import { ALLOWED_USER_FILE_EXTENSIONS, type AllowedUserFileExtension } from '@/lib/storage';
import { cn } from '@/lib/utils';

interface FileTypeFilterProps {
  value: AllowedUserFileExtension | 'all';
  onChange: (next: AllowedUserFileExtension | 'all') => void;
}

export function FileTypeFilter({ value, onChange }: FileTypeFilterProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant={value === 'all' ? 'default' : 'outline'}
        onClick={() => onChange('all')}
      >
        All
      </Button>
      {ALLOWED_USER_FILE_EXTENSIONS.map((ext) => (
        <Button
          key={ext}
          size="sm"
          variant={value === ext ? 'default' : 'outline'}
          className={cn('uppercase')}
          onClick={() => onChange(ext)}
        >
          {ext}
        </Button>
      ))}
    </div>
  );
}
