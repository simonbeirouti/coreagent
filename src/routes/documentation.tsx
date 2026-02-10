import { createFileRoute } from '@tanstack/react-router'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/documentation')({
  component: Documentation,
})

function Documentation() {
  const docs = [
    {
      title: 'Getting Started',
      description: 'Learn the basics of CoreAgent',
      sections: ['Installation', 'First Steps', 'Configuration']
    },
    {
      title: 'API Reference',
      description: 'Complete API documentation',
      sections: ['Authentication', 'Models', 'Endpoints']
    },
    {
      title: 'Guides',
      description: 'Step-by-step tutorials and examples',
      sections: ['Chat Integration', 'Custom Models', 'Best Practices']
    },
    {
      title: 'Troubleshooting',
      description: 'Common issues and solutions',
      sections: ['Error Messages', 'Performance', 'Debugging']
    }
  ]

  return (
    <div className="space-y-4 px-4">
      <Card>
        <CardHeader>
          <CardTitle>Documentation</CardTitle>
          <CardDescription>
            Comprehensive guides and API reference for CoreAgent
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {docs.map((doc) => (
              <Card key={doc.title} className="hover:shadow-md transition-shadow">
                <CardHeader>
                  <CardTitle className="text-lg">{doc.title}</CardTitle>
                  <CardDescription>{doc.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1 mb-4">
                    {doc.sections.map((section) => (
                      <li key={section} className="text-sm text-muted-foreground">
                        • {section}
                      </li>
                    ))}
                  </ul>
                  <Button variant="outline" size="sm" className="w-full">
                    Read Documentation
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}