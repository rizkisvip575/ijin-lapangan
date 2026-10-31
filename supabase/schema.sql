-- Skema database untuk aplikasi Izin Lapangan di Supabase.
-- Jalankan sekali di Supabase Dashboard -> SQL Editor -> New query -> Run.
-- Aman dijalankan ulang.

create table if not exists public.documents (
  collection text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  rev bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

create sequence if not exists public.documents_rev_seq as bigint;

-- Setiap insert/update menaikkan rev, sehingga klien bisa bertanya
-- "apa yang berubah sejak rev N" tanpa membaca seluruh tabel.
create or replace function public.documents_touch_rev()
returns trigger
language plpgsql
as $$
begin
  new.rev := nextval('public.documents_rev_seq');
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists documents_touch_rev on public.documents;
create trigger documents_touch_rev
before insert or update on public.documents
for each row execute function public.documents_touch_rev();

create index if not exists documents_rev_idx on public.documents (rev);
create index if not exists documents_collection_idx on public.documents (collection);

-- Hanya service role (dipakai server Vercel) yang boleh menyentuh tabel ini.
-- Kunci anon/public tidak punya akses sama sekali.
alter table public.documents enable row level security;
revoke all on table public.documents from anon, authenticated;
grant all on table public.documents to service_role;
grant usage, select on sequence public.documents_rev_seq to service_role;

-- Lanjutkan urutan rev dari data yang sudah ada.
do $$
begin
  perform setval(
    'public.documents_rev_seq',
    coalesce((select max(rev) from public.documents), 0) + 1,
    false
  );
end;
$$;
