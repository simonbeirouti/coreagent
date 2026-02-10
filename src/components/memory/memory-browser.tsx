import { useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { useRelevantMemories } from '@/hooks/useMemory';

interface MemoryBrowserProps {
  agentId: string;
  conversationId?: string;
}

export function MemoryBrowser({ agentId, conversationId }: MemoryBrowserProps) {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const { data: memories = [], isLoading, isFetching, refetch, error } = useRelevantMemories(
    agentId,
    submittedQuery,
    conversationId,
    !!submittedQuery
  );
  const errorMessage = error instanceof Error ? error.message : null;
  const sortedMemories = [...memories].sort((a, b) => b.similarity - a.similarity);

  const handleSearch = async () => {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 3) return;

    // If user submits the same query again, force a refetch to get fresh results.
    if (trimmedQuery === submittedQuery) {
      await refetch();
      return;
    }

    setSubmittedQuery(trimmedQuery);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex shrink-0 gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleSearch();
            }
          }}
          placeholder="Search agent memory semantically..."
        />
        <Button
          onClick={() => void handleSearch()}
          disabled={query.trim().length < 3}
          className="cursor-pointer"
          size="icon"
        >
          <Search className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1">
        {isLoading || isFetching ? (
          <p className="text-sm text-muted-foreground">Searching memory...</p>
        ) : errorMessage ? (
          <p className="text-sm text-destructive">
            Memory search failed: {errorMessage}
          </p>
        ) : submittedQuery ? (
          sortedMemories.length ? (
            <ScrollArea className="h-full max-h-[60vh]">
              <Accordion type="multiple" className="px-2">
                {sortedMemories.map((memory) => (
                  <AccordionItem key={memory.message_id} value={memory.message_id}>
                    <AccordionTrigger className="cursor-pointer py-3">
                      <div className="flex w-full items-center justify-between pr-2 text-left">
                        <span className="text-xs capitalize text-muted-foreground">{memory.role}</span>
                        <span className="text-xs text-muted-foreground">
                          similarity {(memory.similarity * 100).toFixed(0)}%
                        </span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-2">
                        <div className="text-sm whitespace-pre-wrap">{memory.content}</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(memory.created_at).toLocaleString()}
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </ScrollArea>
          ) : (
            <p className="text-sm text-muted-foreground">No matching memories found.</p>
          )
        ) : (
          <p className="text-sm text-muted-foreground">
            Enter a query to search prior conversation memory.
          </p>
        )}
      </div>
    </div>
  );
}

