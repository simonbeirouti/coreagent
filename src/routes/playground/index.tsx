import { createFileRoute } from '@tanstack/react-router'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/playground/')({
  component: Playground,
})

function Playground() {
  return (
    <div className="grid auto-rows-min gap-4 md:grid-cols-3">
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="text-xl font-bold">Playground</CardTitle>
          <CardDescription>
            Experiment with AI models and test different configurations
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="bg-muted/50 rounded-lg p-6 text-center">
              <h3 className="text-lg font-medium mb-2">AI Playground</h3>
              <p className="text-muted-foreground">
                Start a new conversation or continue from your history
              </p>
              <div className="mt-4 flex gap-2 justify-center">
                <button className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90">
                  New Chat
                </button>
                <button className="px-4 py-2 border rounded-md hover:bg-muted">
                  Browse History
                </button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <button className="w-full text-left px-3 py-2 rounded hover:bg-muted">
              Generate Code
            </button>
            <button className="w-full text-left px-3 py-2 rounded hover:bg-muted">
              Analyze Text
            </button>
            <button className="w-full text-left px-3 py-2 rounded hover:bg-muted">
              Create Images
            </button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Recent Models</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm">GPT-4</span>
              <span className="text-xs text-muted-foreground">Active</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Claude 3</span>
              <span className="text-xs text-muted-foreground">Available</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}