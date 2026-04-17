create table if not exists public.bookshelf_books (
  id text primary key,
  title text not null,
  author text not null,
  cover text not null,
  progress integer not null default 0,
  status text not null default 'unread',
  category text not null default 'Uncategorized',
  is_archived boolean not null default false,
  description jsonb,
  publisher text,
  size text,
  pages integer,
  publish_date text,
  author_en text,
  rating numeric,
  reviews integer,
  created_at timestamptz not null default now()
);

create table if not exists public.library_books (
  id text primary key,
  title text not null,
  author text not null,
  cover text not null,
  progress integer not null default 0,
  status text not null default 'unread',
  category text not null default 'Uncategorized',
  is_archived boolean not null default false,
  description jsonb,
  publisher text,
  size text,
  pages integer,
  publish_date text,
  author_en text,
  rating numeric,
  reviews integer,
  created_at timestamptz not null default now()
);

create table if not exists public.book_files (
  book_id text primary key references public.bookshelf_books (id) on delete cascade,
  file_type text not null check (file_type in ('txt', 'epub')),
  file_path text not null,
  text_content text,
  text_encoding text,
  created_at timestamptz not null default now()
);

create table if not exists public.reading_progress (
  book_id text primary key references public.bookshelf_books (id) on delete cascade,
  chapter_index integer not null default 0,
  total_chapters integer not null default 1,
  scroll_percent numeric not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists idx_bookshelf_books_created_at on public.bookshelf_books (created_at desc);
create index if not exists idx_library_books_created_at on public.library_books (created_at desc);
create index if not exists idx_book_files_created_at on public.book_files (created_at desc);
create index if not exists idx_reading_progress_updated_at on public.reading_progress (updated_at desc);

insert into storage.buckets (id, name, public)
values ('books', 'books', false)
on conflict (id) do nothing;
