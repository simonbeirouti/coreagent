import { createFileRoute } from '@tanstack/react-router'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/playground/history')({
  component: History,
})

function History() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Chat History</CardTitle>
          <CardDescription>
            View and manage your previous conversations
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 cursor-pointer">
                <div>
                  <h4 className="font-medium">Conversation {i}</h4>
                  <p className="text-sm text-muted-foreground">Last updated 2 days ago</p>
                </div>
                <div className="flex gap-2">
                  <button className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90">
                    Open
                  </button>
                  <button className="px-3 py-1 text-xs border rounded hover:bg-muted">
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}