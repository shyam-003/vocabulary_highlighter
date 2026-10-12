-- Supabase PostgreSQL Schema for Vocabulary Highlighter System

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- 1. Users Profile Table (Mirrors auth.users)
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Vocabulary Words Table
create table if not exists public.vocabulary_words (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  word text not null,
  normalized_word text not null,
  status text not null default 'known' check (status in ('known', 'unknown')),
  cefr_level text check (cefr_level in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2') or cefr_level is null),
  definition text,
  part_of_speech text,
  example_sentence text,
  pronunciation text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unique_user_normalized_word unique (user_id, normalized_word)
);

-- 3. Indexes for Fast Searching & Filtering
create index if not exists idx_vocab_user_norm on public.vocabulary_words(user_id, normalized_word);
create index if not exists idx_vocab_user_status on public.vocabulary_words(user_id, status);
create index if not exists idx_vocab_user_cefr on public.vocabulary_words(user_id, cefr_level);
create index if not exists idx_vocab_user_created on public.vocabulary_words(user_id, created_at desc);

-- 4. Enable Row Level Security (RLS)
alter table public.users enable row level security;
alter table public.vocabulary_words enable row level security;

-- 5. RLS Policies (Users can only access their own records)
create policy "Users can read own profile" on public.users for select using (auth.uid() = id);
create policy "Users can insert own profile" on public.users for insert with check (auth.uid() = id);
create policy "Users can update own profile" on public.users for update using (auth.uid() = id);

create policy "Users can read own vocabulary" on public.vocabulary_words for select using (auth.uid() = user_id);
create policy "Users can insert own vocabulary" on public.vocabulary_words for insert with check (auth.uid() = user_id);
create policy "Users can update own vocabulary" on public.vocabulary_words for update using (auth.uid() = user_id);
create policy "Users can delete own vocabulary" on public.vocabulary_words for delete using (auth.uid() = user_id);

-- 6. Auto User Provisioning Trigger
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
