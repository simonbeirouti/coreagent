import { createFileRoute } from '@tanstack/react-router'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export const Route = createFileRoute('/playground/settings')({
  component: PlaygroundSettings,
})

function PlaygroundSettings() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Playground Settings</CardTitle>
          <CardDescription>
            Configure your AI playground preferences
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div>
              <Label htmlFor="default-model">Default Model</Label>
              <select
                id="default-model"
                className="w-full mt-1 px-3 py-2 border rounded-md"
                defaultValue="gpt-4"
              >
                <option value="gpt-4">GPT-4</option>
                <option value="claude-3">Claude 3</option>
                <option value="gemini">Gemini Pro</option>
              </select>
            </div>

            <div>
              <Label htmlFor="temperature">Temperature</Label>
              <Input
                id="temperature"
                type="range"
                min="0"
                max="2"
                step="0.1"
                defaultValue="0.7"
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Controls randomness: 0 = deterministic, 2 = very creative
              </p>
            </div>

            <div>
              <Label htmlFor="max-tokens">Max Tokens</Label>
              <Input
                id="max-tokens"
                type="number"
                defaultValue="2048"
                className="mt-1"
              />
            </div>

            <div className="flex items-center space-x-2">
              <input type="checkbox" id="auto-save" defaultChecked />
              <Label htmlFor="auto-save">Auto-save conversations</Label>
            </div>

            <div className="flex items-center space-x-2">
              <input type="checkbox" id="stream-responses" defaultChecked />
              <Label htmlFor="stream-responses">Stream responses</Label>
            </div>
          </div>

          <div className="pt-4 border-t">
            <Button>Save Settings</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}