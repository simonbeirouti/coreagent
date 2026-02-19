// User Profile TypeScript types

export type LanguageCode = 'en' | 'es' | 'fr' | 'de' | 'it' | 'pt' | 'ru' | 'zh' | 'ja' | 'ko' | 'ar' | 'hi' | 'nl' | 'pl' | 'tr' | 'vi' | 'th' | 'id' | 'ms' | 'sv' | 'da' | 'no' | 'fi' | 'cs' | 'el' | 'he' | 'uk';

export interface UserPreferences {
  communication_style?: 'concise' | 'balanced' | 'detailed';
  timezone?: string;
  runtime_execution_mode?: 'remote' | 'local_docker';
  runtime_local_image?: string;
  [key: string]: unknown;
}

export interface UserHabits {
  preferred_hours?: string;
  session_length?: 'short' | 'medium' | 'long';
  feedback_style?: 'direct' | 'constructive' | 'encouraging';
  [key: string]: unknown;
}

export interface UserWorkPatterns {
  domain?: string;
  common_tasks?: string[];
  expertise?: string[];
  [key: string]: unknown;
}

export interface UserProfile {
  id: string;
  user_id: string;
  preferences: UserPreferences;
  habits: UserHabits;
  work_patterns: UserWorkPatterns;
  language: LanguageCode;
  ai_response_language: LanguageCode;
  notifications_enabled: boolean;
  analytics_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface UpdateUserProfileRequest {
  preferences?: UserPreferences;
  habits?: UserHabits;
  work_patterns?: UserWorkPatterns;
  language?: LanguageCode;
  ai_response_language?: LanguageCode;
  notifications_enabled?: boolean;
  analytics_enabled?: boolean;
}
