
-- Create a table for public profiles
create table profiles (
  id uuid references auth.users on delete cascade not null primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  full_name text
);

-- Set up Row Level Security (RLS)
-- See https://supabase.com/docs/guides/auth/row-level-security for more details.
alter table profiles
  enable row level security;

create policy "Public profiles are viewable by everyone." on profiles
  for select using (true);

create policy "Users can insert their own profile." on profiles
  for insert with check ((select auth.uid()) = id);

create policy "Users can update own profile." on profiles
  for update using ((select auth.uid()) = id);

-- This trigger automatically creates a profile entry when a new user signs up via Supabase Auth.
-- See https://supabase.com/docs/guides/auth/managing-user-data#using-triggers for more details.
create function public.handle_new_user()
returns trigger
set search_path = ''
as $$
begin
  insert into public.profiles (id, created_at, updated_at, full_name)
  values (new.id, timezone('utc'::text, now()), timezone('utc'::text, now()), new.raw_user_meta_data->>'full_name');
  return new;
end;
$$ language plpgsql security definer;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Function to update updated_at timestamp
create function public.handle_profile_update()
returns trigger
set search_path = ''
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$ language plpgsql security definer;

-- Trigger to update updated_at on profile changes
create trigger on_profile_updated
  before update on public.profiles
  for each row execute procedure public.handle_profile_update();

-- Set up Storage Buckets for CoreAgent assets

-- Avatars bucket (public read, owner-only write/update/delete)
insert into storage.buckets (id, name)
  values ('avatars', 'avatars');

-- Screenshots bucket (owner-only for all operations)
insert into storage.buckets (id, name)
  values ('screenshots', 'screenshots');

-- Audio bucket (owner-only for all operations)
insert into storage.buckets (id, name)
  values ('audio', 'audio');

-- Perception logs bucket (owner-only for all operations)
insert into storage.buckets (id, name)
  values ('perception-logs', 'perception-logs');

-- Set up access controls for storage.
-- See https://supabase.com/docs/guides/storage#policy-examples for more details.

-- Avatars bucket policies (public read, owner-only CRUD)
create policy "Avatar images are publicly accessible." on storage.objects
  for select using (bucket_id = 'avatars');

create policy "Users can upload their own avatar." on storage.objects
  for insert with check (
    bucket_id = 'avatars'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

create policy "Users can update their own avatar." on storage.objects
  for update using (
    bucket_id = 'avatars'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

create policy "Users can delete their own avatar." on storage.objects
  for delete using (
    bucket_id = 'avatars'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

-- Screenshots bucket policies (owner-only)
create policy "Users can view their own screenshots." on storage.objects
  for select using (
    bucket_id = 'screenshots'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

create policy "Users can upload their own screenshots." on storage.objects
  for insert with check (
    bucket_id = 'screenshots'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

create policy "Users can update their own screenshots." on storage.objects
  for update using (
    bucket_id = 'screenshots'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

create policy "Users can delete their own screenshots." on storage.objects
  for delete using (
    bucket_id = 'screenshots'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

-- Audio bucket policies (owner-only)
create policy "Users can view their own audio files." on storage.objects
  for select using (
    bucket_id = 'audio'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

create policy "Users can upload their own audio files." on storage.objects
  for insert with check (
    bucket_id = 'audio'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

create policy "Users can update their own audio files." on storage.objects
  for update using (
    bucket_id = 'audio'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

create policy "Users can delete their own audio files." on storage.objects
  for delete using (
    bucket_id = 'audio'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

-- Perception logs bucket policies (owner-only)
create policy "Users can view their own perception logs." on storage.objects
  for select using (
    bucket_id = 'perception-logs'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

create policy "Users can upload their own perception logs." on storage.objects
  for insert with check (
    bucket_id = 'perception-logs'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

create policy "Users can update their own perception logs." on storage.objects
  for update using (
    bucket_id = 'perception-logs'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

create policy "Users can delete their own perception logs." on storage.objects
  for delete using (
    bucket_id = 'perception-logs'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );