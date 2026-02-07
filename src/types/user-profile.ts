// User Profile TypeScript types

export interface UserPreferences {
  communication_style?: 'concise' | 'balanced' | 'detailed';
  language?: string;
  timezone?: string;
  [key: string]: any;
}

export interface UserHabits {
  preferred_hours?: string;
  session_length?: 'short' | 'medium' | 'long';
  feedback_style?: 'direct' | 'constructive' | 'encouraging';
  [key: string]: any;
}

export interface UserWorkPatterns {
  domain?: string;
  common_tasks?: string[];
  expertise?: string[];
  [key: string]: any;
}

export interface UserProfile {
  id: string;
  user_id: string;
  preferences: UserPreferences;
  habits: UserHabits;
  work_patterns: UserWorkPatterns;
  created_at: string;
  updated_at: string;
}

export interface UpdateUserProfileRequest {
  preferences?: UserPreferences;
  habits?: UserHabits;
  work_patterns?: UserWorkPatterns;
}
