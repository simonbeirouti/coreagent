import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTheme } from '@/components/theme-provider'
import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/hooks/use-auth'
import { useUserProfile, useUpdateUserProfile } from '@/hooks/useUserProfile'
import { Spinner } from '@/components/ui/spinner'
import { Header } from '@/components/header'
import { ScrollArea } from '@/components/ui/scroll-area'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { X, Trash2, Settings as SettingsIcon, Save } from 'lucide-react'
import { toast } from 'sonner'
import supabase from '@/lib/supabase'
import type { LanguageCode, UserPreferences, UserHabits, UserWorkPatterns } from '@/types/user-profile'

// Tag Input Component for adding/removing items with comma/enter
function TagInput({ value, onChange, placeholder }: { value: string[], onChange: (values: string[]) => void, placeholder: string }) {
  const [inputValue, setInputValue] = useState('')

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addValue()
    }
  }

  const addValue = () => {
    const trimmedValue = inputValue.trim()
    if (trimmedValue && !value.includes(trimmedValue)) {
      onChange([...value, trimmedValue])
      setInputValue('')
    }
  }

  const removeValue = (valueToRemove: string) => {
    onChange(value.filter(v => v !== valueToRemove))
  }

  return (
    <div className="relative">
      <div className="min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
        <div className="flex flex-wrap items-center gap-1">
          {value.map((val) => (
            <Badge key={val} variant="secondary" className="flex items-center gap-1 h-6 px-2 text-xs">
              {val}
              <button
                onClick={() => removeValue(val)}
                className="ml-1 cursor-pointer hover:bg-destructive/20 rounded-full p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={addValue}
            placeholder={value.length === 0 ? placeholder : ""}
            className="border-0 p-0 h-6 min-w-20 flex-1 focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/settings')({
  component: Settings,
})

const LANGUAGE_OPTIONS: { value: LanguageCode; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ru', label: 'Russian' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'ar', label: 'Arabic' },
  { value: 'hi', label: 'Hindi' },
]

const TIMEZONE_OPTIONS = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Australia/Sydney',
]

function Settings() {
  const { theme, setTheme } = useTheme()
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  // Loading and error states
  const [deleting, setDeleting] = useState(false)

  // Use the user profile hook
  const { data: profile, isLoading, error } = useUserProfile(user?.id || '')
  const updateProfileMutation = useUpdateUserProfile()

  // Form state - General settings
  const [language, setLanguage] = useState<LanguageCode>('en')
  const [aiResponseLanguage, setAiResponseLanguage] = useState<LanguageCode>('en')
  const [notifications, setNotifications] = useState(true)
  const [analytics, setAnalytics] = useState(false)

  // Form state - Preferences
  const [communicationStyle, setCommunicationStyle] = useState<'concise' | 'balanced' | 'detailed'>('balanced')
  const [timezone, setTimezone] = useState('UTC')

  // Form state - Habits
  const [preferredHours, setPreferredHours] = useState('')
  const [sessionLength, setSessionLength] = useState<'short' | 'medium' | 'long'>('medium')
  const [feedbackStyle, setFeedbackStyle] = useState<'direct' | 'constructive' | 'encouraging'>('constructive')

  // Form state - Work patterns
  const [domain, setDomain] = useState('')
  const [commonTasks, setCommonTasks] = useState<string[]>([])
  const [expertise, setExpertise] = useState<string[]>([])

  // Track changes
  const [hasChanges, setHasChanges] = useState(false)

  // Initialize form state from profile data
  useEffect(() => {
    if (!profile) return

    // Populate form state from profile
    setLanguage(profile.language)
    setAiResponseLanguage(profile.ai_response_language)
    setNotifications(profile.notifications_enabled)
    setAnalytics(profile.analytics_enabled)

    // Preferences
    setCommunicationStyle(profile.preferences?.communication_style || 'balanced')
    setTimezone(profile.preferences?.timezone || 'UTC')

    // Habits
    setPreferredHours(profile.habits?.preferred_hours || '')
    setSessionLength(profile.habits?.session_length || 'medium')
    setFeedbackStyle(profile.habits?.feedback_style || 'constructive')

    // Work patterns
    setDomain(profile.work_patterns?.domain || '')
    setCommonTasks(profile.work_patterns?.common_tasks || [])
    setExpertise(profile.work_patterns?.expertise || [])
  }, [profile])

  // Check for changes
  useEffect(() => {
    if (!profile) return

    const hasAnyChanges =
      language !== profile.language ||
      aiResponseLanguage !== profile.ai_response_language ||
      notifications !== profile.notifications_enabled ||
      analytics !== profile.analytics_enabled ||
      communicationStyle !== (profile.preferences?.communication_style || 'balanced') ||
      timezone !== (profile.preferences?.timezone || 'UTC') ||
      preferredHours !== (profile.habits?.preferred_hours || '') ||
      sessionLength !== (profile.habits?.session_length || 'medium') ||
      feedbackStyle !== (profile.habits?.feedback_style || 'constructive') ||
      domain !== (profile.work_patterns?.domain || '') ||
      JSON.stringify(commonTasks) !== JSON.stringify(profile.work_patterns?.common_tasks || []) ||
      JSON.stringify(expertise) !== JSON.stringify(profile.work_patterns?.expertise || [])

    setHasChanges(hasAnyChanges)
  }, [profile, language, aiResponseLanguage, notifications, analytics, communicationStyle, timezone, preferredHours, sessionLength, feedbackStyle, domain, commonTasks, expertise])

  const handleThemeChange = (value: string) => {
    setTheme(value as 'dark' | 'light' | 'system')
  }

  const handleSaveSettings = async () => {
    if (!user?.id) return

    try {
      await updateProfileMutation.mutateAsync({
        userId: user.id,
        updates: {
          language,
          ai_response_language: aiResponseLanguage,
          notifications_enabled: notifications,
          analytics_enabled: analytics,
          preferences: {
            communication_style: communicationStyle,
            timezone,
          } as UserPreferences,
          habits: {
            preferred_hours: preferredHours || undefined,
            session_length: sessionLength,
            feedback_style: feedbackStyle,
          } as UserHabits,
          work_patterns: {
            domain: domain || undefined,
            common_tasks: commonTasks.length > 0 ? commonTasks : undefined,
            expertise: expertise.length > 0 ? expertise : undefined,
          } as UserWorkPatterns,
        },
      })

      setHasChanges(false)
      toast.success('Settings saved successfully')
    } catch (err) {
      console.error('Failed to save settings:', err)
      toast.error('Failed to save settings')
    }
  }

  const handleDeleteAccount = async () => {
    if (!user?.id) return

    setDeleting(true)

    try {
      // Delete user from Supabase Auth (this will cascade delete all data due to foreign keys)
      const { error: deleteError } = await supabase.rpc('delete_user')

      if (deleteError) {
        throw deleteError
      }

      // Sign out and redirect to login
      await signOut()
      toast.success('Account deleted successfully')
      navigate({ to: '/' })
    } catch (err) {
      console.error('Failed to delete account:', err)
      toast.error('Failed to delete account. Please try again.')
    } finally {
      setDeleting(false)
    }
  }


  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner className="h-8 w-8" />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <ScrollArea className="h-full">
        <div className="px-4 space-y-4">
          {error && (
            <div className="bg-destructive/10 text-destructive py-2 rounded-md">
              {error instanceof Error ? error.message : 'An error occurred'}
            </div>
          )}

          <Header title="Application Settings" description="Configure your CoreAgent preferences">
            {hasChanges && (
              <Button onClick={handleSaveSettings} disabled={updateProfileMutation.isPending} className="cursor-pointer">
                {updateProfileMutation.isPending ? <Spinner className="h-4 w-4 mr-2" /> : <Save className="mr-2 h-4 w-4" />}
                {updateProfileMutation.isPending ? 'Saving...' : 'Save Settings'}
              </Button>
            )}
          </Header>

          <div className="flex flex-col lg:flex-row gap-4">
            {/* Main Content - Left Side */}
            <div className="flex-1 space-y-4 order-2 lg:order-1">
              {/* Communication Preferences */}
              <Card>
                <CardHeader>
                  <CardTitle>Communication Preferences</CardTitle>
                  <CardDescription>How you prefer AI agents to communicate with you</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="communication-style">Communication Style</Label>
                      <Select value={communicationStyle} onValueChange={(v) => setCommunicationStyle(v as typeof communicationStyle)}>
                        <SelectTrigger id="communication-style" className="w-full mt-1 cursor-pointer">
                          <SelectValue placeholder="Select style" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="concise">Concise - Brief and to the point</SelectItem>
                          <SelectItem value="balanced">Balanced - Clear with context</SelectItem>
                          <SelectItem value="detailed">Detailed - Comprehensive explanations</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="timezone">Timezone</Label>
                      <Select value={timezone} onValueChange={setTimezone}>
                        <SelectTrigger id="timezone" className="w-full mt-1 cursor-pointer">
                          <SelectValue placeholder="Select timezone" />
                        </SelectTrigger>
                        <SelectContent>
                          {TIMEZONE_OPTIONS.map(tz => (
                            <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Work Habits */}
              <Card>
                <CardHeader>
                  <CardTitle>Work Habits</CardTitle>
                  <CardDescription>Your typical working patterns and preferences</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="preferred-hours">Preferred Working Hours</Label>
                      <Input
                        id="preferred-hours"
                        placeholder="e.g., 9am-5pm, mornings, evenings"
                        value={preferredHours}
                        onChange={(e) => setPreferredHours(e.target.value)}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="session-length">Typical Session Length</Label>
                      <Select value={sessionLength} onValueChange={(v) => setSessionLength(v as typeof sessionLength)}>
                        <SelectTrigger id="session-length" className="w-full mt-1 cursor-pointer">
                          <SelectValue placeholder="Select length" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="short">Short (under 15 min)</SelectItem>
                          <SelectItem value="medium">Medium (15-60 min)</SelectItem>
                          <SelectItem value="long">Long (over 60 min)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="feedback-style">Feedback Style</Label>
                    <p className="text-sm text-muted-foreground mb-1">How you prefer to receive feedback from AI agents</p>
                    <Select value={feedbackStyle} onValueChange={(v) => setFeedbackStyle(v as typeof feedbackStyle)}>
                      <SelectTrigger id="feedback-style" className="w-full cursor-pointer">
                        <SelectValue placeholder="Select style" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="direct">Direct - Straightforward and honest</SelectItem>
                        <SelectItem value="constructive">Constructive - Balanced with suggestions</SelectItem>
                        <SelectItem value="encouraging">Encouraging - Positive and supportive</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              {/* Work Context */}
              <Card>
                <CardHeader>
                  <CardTitle>Work Context</CardTitle>
                  <CardDescription>Help AI agents understand your professional context</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="domain">Domain / Industry</Label>
                    <Input
                      id="domain"
                      placeholder="e.g., Software Development, Marketing, Finance"
                      value={domain}
                      onChange={(e) => setDomain(e.target.value)}
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label>Common Tasks</Label>
                    <p className="text-sm text-muted-foreground mb-2">Tasks you frequently need help with</p>
                    <TagInput
                      value={commonTasks}
                      onChange={setCommonTasks}
                      placeholder="Type a task and press Enter or comma to add..."
                    />
                  </div>

                  <div>
                    <Label>Technical Expertise</Label>
                    <p className="text-sm text-muted-foreground mb-2">Technologies, languages, or skills you're proficient in</p>
                    <TagInput
                      value={expertise}
                      onChange={setExpertise}
                      placeholder="Type a technology or skill and press Enter or comma to add..."
                    />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Sidebar - Right Side */}
            <div className="w-full lg:w-80 space-y-4 order-1 lg:order-2">
              {/* General Settings */}
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <SettingsIcon className="h-5 w-5" />
                    <div>
                      <CardTitle>General Settings</CardTitle>
                      <CardDescription>App preferences</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="theme">Theme</Label>
                    <Select value={theme} onValueChange={handleThemeChange}>
                      <SelectTrigger className="w-full mt-1 cursor-pointer">
                        <SelectValue placeholder="Select theme" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="light">Light</SelectItem>
                        <SelectItem value="dark">Dark</SelectItem>
                        <SelectItem value="system">System</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="language">UI Language</Label>
                      <Select value={language} onValueChange={(v) => setLanguage(v as LanguageCode)}>
                        <SelectTrigger id="language" className="w-full mt-1 cursor-pointer">
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          {LANGUAGE_OPTIONS.map(opt => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="ai-language">AI Language</Label>
                      <Select value={aiResponseLanguage} onValueChange={(v) => setAiResponseLanguage(v as LanguageCode)}>
                        <SelectTrigger id="ai-language" className="w-full mt-1 cursor-pointer">
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          {LANGUAGE_OPTIONS.map(opt => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="notifications">Notifications</Label>
                      <p className="text-xs text-muted-foreground">Important updates</p>
                    </div>
                    <Switch
                      id="notifications"
                      checked={notifications}
                      onCheckedChange={setNotifications}
                      className="cursor-pointer"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="analytics">Analytics</Label>
                      <p className="text-xs text-muted-foreground">Anonymous usage data</p>
                    </div>
                    <Switch
                      id="analytics"
                      checked={analytics}
                      onCheckedChange={setAnalytics}
                      className="cursor-pointer"
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Danger Zone */}
              <Card className="border-destructive">
                <CardHeader>
                  <CardTitle className="text-destructive">Danger Zone</CardTitle>
                  <CardDescription>Irreversible actions</CardDescription>
                </CardHeader>
                <CardContent>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" className="w-full cursor-pointer" disabled={deleting}>
                        {deleting ? <Spinner className="h-4 w-4 mr-2" /> : <Trash2 className="mr-2 h-4 w-4" />}
                        Delete Account
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Account</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete your account? This action cannot be undone.
                          All your data, including agents, conversations, and settings will be permanently deleted.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleDeleteAccount}
                          className="cursor-pointer bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Delete Account
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
