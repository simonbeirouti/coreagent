import { createFileRoute } from '@tanstack/react-router'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export const Route = createFileRoute('/models')({
  component: Models,
})

function Models() {
  const models = [
    {
      name: 'GPT-4',
      provider: 'OpenAI',
      description: 'Most capable model for complex tasks',
      status: 'active',
      capabilities: ['Text Generation', 'Code', 'Analysis']
    },
    {
      name: 'Claude 3 Opus',
      provider: 'Anthropic',
      description: 'Advanced reasoning and analysis',
      status: 'available',
      capabilities: ['Text Generation', 'Analysis', 'Creative Writing']
    },
    {
      name: 'Gemini Pro',
      provider: 'Google',
      description: 'Fast and efficient for general tasks',
      status: 'available',
      capabilities: ['Text Generation', 'Translation']
    },
    {
      name: 'DALL-E 3',
      provider: 'OpenAI',
      description: 'High-quality image generation',
      status: 'available',
      capabilities: ['Image Generation']
    }
  ]

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>AI Models</CardTitle>
          <CardDescription>
            Browse and configure available AI models
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {models.map((model) => (
              <Card key={model.name} className="relative">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{model.name}</CardTitle>
                    <Badge variant={model.status === 'active' ? 'default' : 'secondary'}>
                      {model.status}
                    </Badge>
                  </div>
                  <CardDescription className="text-sm text-muted-foreground">
                    {model.provider}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm mb-3">{model.description}</p>
                  <div className="flex flex-wrap gap-1 mb-4">
                    {model.capabilities.map((capability) => (
                      <Badge key={capability} variant="outline" className="text-xs">
                        {capability}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant={model.status === 'active' ? 'secondary' : 'default'}>
                      {model.status === 'active' ? 'Active' : 'Use Model'}
                    </Button>
                    <Button size="sm" variant="outline">
                      Configure
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}