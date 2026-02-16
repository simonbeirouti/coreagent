import { useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { MarkdownContent } from '@/components/ui/markdown-content'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/documentation')({
  component: Documentation,
})

type DocItem = {
  title: string
  description: string
  category: string
  tags: string[]
  path: string
}

const docContentByPath = import.meta.glob('/docs/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function Documentation() {
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('All')

  const docs: DocItem[] = [
    {
      title: 'Getting Started Workflows',
      description: 'Core startup flow, validation loop, and quality gates.',
      category: 'Platform Usage',
      tags: ['onboarding', 'workflows', 'commands'],
      path: '/docs/platform/getting-started-workflows.md'
    },
    {
      title: 'Feature Map',
      description: 'Where each major capability appears in the platform UI.',
      category: 'Feature Locations',
      tags: ['routes', 'navigation', 'ux-map'],
      path: '/docs/platform/feature-map.md'
    },
    {
      title: 'Data Meaning Reference',
      description: 'Definitions for key entities, signals, and quality data.',
      category: 'Data Meaning',
      tags: ['schema', 'signals', 'reference'],
      path: '/docs/platform/data-meaning-reference.md'
    },
    {
      title: 'Feedback And Adaptation Flow',
      description: 'End-to-end lifecycle for feedback, reconciliation, and adaptation.',
      category: 'Data Meaning',
      tags: ['feedback', 'adaptation', 'reconciliation'],
      path: '/docs/platform/feedback-and-adaptation-flow.md'
    },
    {
      title: 'Dashboard Metrics Guide',
      description: 'How to interpret charts, transparency cards, and metric combinations.',
      category: 'Data Meaning',
      tags: ['dashboard', 'metrics', 'interpretation'],
      path: '/docs/platform/dashboard-metrics-guide.md'
    },
    {
      title: 'Orchestration Job Assignment Board',
      description: 'Board lanes, drag rules, and guided assignment workflow for orchestration.',
      category: 'Platform Usage',
      tags: ['orchestration', 'kanban', 'assignment', 'agents'],
      path: '/docs/platform/orchestration-job-assignment-board.md'
    },
    {
      title: 'Two-Layer Reliability Testing',
      description: 'Frontend and backend reliability suite, command matrix, and release gates.',
      category: 'Reliability & Testing',
      tags: ['testing', 'reliability', 'release-gate'],
      path: '/docs/testing/two-layer-reliability.md'
    }
  ]

  const [selectedPath, setSelectedPath] = useState<string>(docs[0]?.path ?? '')
  const documentPaneRef = useRef<HTMLDivElement>(null)

  const categories = useMemo(() => {
    return ['All', ...Array.from(new Set(docs.map((doc) => doc.category)))]
  }, [docs])

  const filteredDocs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return docs.filter((doc) => {
      const matchesCategory =
        activeCategory === 'All' || doc.category === activeCategory

      if (!matchesCategory) {
        return false
      }

      if (!normalizedQuery) {
        return true
      }

      return (
        doc.title.toLowerCase().includes(normalizedQuery) ||
        doc.description.toLowerCase().includes(normalizedQuery) ||
        doc.category.toLowerCase().includes(normalizedQuery) ||
        doc.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery))
      )
    })
  }, [activeCategory, docs, query])

  useEffect(() => {
    if (!filteredDocs.length) {
      return
    }

    const selectedStillVisible = filteredDocs.some((doc) => doc.path === selectedPath)
    if (!selectedStillVisible) {
      setSelectedPath(filteredDocs[0].path)
    }
  }, [filteredDocs, selectedPath])

  const selectedDoc = useMemo(() => {
    return docs.find((doc) => doc.path === selectedPath) ?? filteredDocs[0] ?? null
  }, [docs, filteredDocs, selectedPath])

  const selectedContent = selectedDoc ? docContentByPath[selectedDoc.path] : ''

  const handleSelectDoc = (path: string) => {
    setSelectedPath(path)
    if (window.matchMedia('(max-width: 1023px)').matches) {
      documentPaneRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  return (
    <div className="h-[calc(100vh-3.5rem)] mx-4 pb-2">
      <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="flex h-full min-h-0 flex-col gap-0 overflow-hidden p-0 lg:col-span-1">
          <CardContent className="flex h-full min-h-0 flex-col p-0">
            <div className="space-y-3 border-b p-3">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search docs by title, category, or tag..."
                aria-label="Search documentation"
              />
              <div className="flex flex-wrap gap-2">
                {categories.map((category) => (
                  <button
                    key={category}
                    type="button"
                    onClick={() => setActiveCategory(category)}
                    className={cn(
                      'rounded-md border px-2 py-1 text-xs transition-colors',
                      activeCategory === category
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-accent'
                    )}
                  >
                    {category}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
              {filteredDocs.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No documentation matches your filters.
                </p>
              ) : null}

              {filteredDocs.map((doc) => (
                <button
                  key={doc.path}
                  type="button"
                  onClick={() => handleSelectDoc(doc.path)}
                  className={cn(
                    'w-full rounded-md border p-3 text-left transition-colors',
                    selectedDoc?.path === doc.path
                      ? 'border-primary bg-accent'
                      : 'hover:bg-muted/50'
                  )}
                >
                  <p className="text-sm font-semibold">{doc.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{doc.description}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Badge variant="outline">{doc.category}</Badge>
                    {doc.tags.map((tag) => (
                      <Badge key={tag} variant="outline">{tag}</Badge>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="flex h-full min-h-0 flex-col gap-0 overflow-hidden p-0 lg:col-span-2">
          <CardContent className="flex h-full min-h-0 flex-col p-0">
            <div ref={documentPaneRef} className="border-b p-4">
              <h2 className="text-lg font-semibold">
                {selectedDoc?.title ?? 'Documentation'}
              </h2>
              <p className="text-sm text-muted-foreground">
                {selectedDoc?.description ?? 'Select a document to read.'}
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {selectedContent ? (
                <MarkdownContent content={selectedContent} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Document content is unavailable for the selected entry.
                </p>
              )}
              <div className="h-8" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
