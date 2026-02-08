import { createFileRoute } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTheme } from '@/components/theme-provider'
import { Header } from '@/components/header'
import { useState, useEffect } from 'react'

export const Route = createFileRoute('/settings')({
  component: Settings,
})

function Settings() {
  const { theme, setTheme } = useTheme()

  // Initial values (would typically come from a settings store/API)
  const initialValues = {
    theme,
    language: 'en',
    notifications: true,
    autoUpdates: true,
    analytics: false,
  }

  // Current state values
  const [language, setLanguage] = useState(initialValues.language)
  const [notifications, setNotifications] = useState(initialValues.notifications)
  const [autoUpdates, setAutoUpdates] = useState(initialValues.autoUpdates)
  const [analytics, setAnalytics] = useState(initialValues.analytics)
  const [hasChanges, setHasChanges] = useState(false)

  // Check for changes whenever any setting changes
  useEffect(() => {
    const hasAnyChanges =
      theme !== initialValues.theme ||
      language !== initialValues.language ||
      notifications !== initialValues.notifications ||
      autoUpdates !== initialValues.autoUpdates ||
      analytics !== initialValues.analytics

    setHasChanges(hasAnyChanges)
  }, [theme, language, notifications, autoUpdates, analytics])

  const handleThemeChange = (value: string) => {
    setTheme(value as "dark" | "light" | "system")
  }

  const handleSaveSettings = () => {
    // Here you would typically save to a backend/store
    console.log('Saving settings:', {
      theme,
      language,
      notifications,
      autoUpdates,
      analytics,
    })
    // Reset hasChanges after saving
    setHasChanges(false)
  }

  return (
    <div className="space-y-4 px-4">
      <Header title="Application Settings" description="Configure your CoreAgent preferences">
        {hasChanges && (
          <Button onClick={handleSaveSettings}>Save Settings</Button>
        )}
      </Header>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="theme">Theme</Label>
            <Select value={theme} onValueChange={handleThemeChange}>
              <SelectTrigger className="w-full mt-1">
                <SelectValue placeholder="Select theme" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
                <SelectItem value="system">System</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="language">Language</Label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger id="language" className="w-full mt-1">
                <SelectValue placeholder="Select language" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="es">Spanish</SelectItem>
                <SelectItem value="fr">French</SelectItem>
                <SelectItem value="de">German</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="notifications">Enable Notifications</Label>
            <p className="text-sm text-muted-foreground">Receive notifications for important updates</p>
          </div>
          <Switch
            id="notifications"
            checked={notifications}
            onCheckedChange={setNotifications}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="auto-updates">Auto Updates</Label>
            <p className="text-sm text-muted-foreground">Automatically download and install updates</p>
          </div>
          <Switch
            id="auto-updates"
            checked={autoUpdates}
            onCheckedChange={setAutoUpdates}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="analytics">Analytics</Label>
            <p className="text-sm text-muted-foreground">Help improve CoreAgent by sharing anonymous usage data</p>
          </div>
          <Switch
            id="analytics"
            checked={analytics}
            onCheckedChange={setAnalytics}
          />
        </div>
      </div>
    </div>
  )
}