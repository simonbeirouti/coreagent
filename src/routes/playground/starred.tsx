import { createFileRoute } from '@tanstack/react-router'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Star } from 'lucide-react'

export const Route = createFileRoute('/playground/starred')({
  component: Starred,
})

function Starred() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Star className="h-5 w-5 fill-yellow-400 text-yellow-400" />
            Starred Conversations
          </CardTitle>
          <CardDescription>
            Your favorite and most important conversations
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 cursor-pointer">
                <div>
                  <h4 className="font-medium">Important Conversation {i}</h4>
                  <p className="text-sm text-muted-foreground">Starred on Dec {i + 10}, 2024</p>
                </div>
                <div className="flex gap-2">
                  <button className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90">
                    Open
                  </button>
                  <button className="px-3 py-1 text-xs border rounded hover:bg-muted">
                    <Star className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {(![1, 2, 3] || [1, 2, 3].length === 0) && (
            <div className="text-center py-8">
              <Star className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No starred conversations</h3>
              <p className="text-muted-foreground">
                Star important conversations to find them quickly here
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}