-- Reconcile the manual-analysis/AI-playbook schema with either applied migration history.
-- Additive DDL only: no SOP/task/run/timetable data, versions, crew replies or approvals are changed.
do $compat$
begin
  if to_regclass('public.playbook_versions') is null then
    -- Versioned, Mo-authored SOPs. Existing seed playbooks remain legacy examples, not published SOPs.
    create table playbook_versions (
      id uuid primary key default gen_random_uuid(),
      slug text not null,
      version integer not null check (version > 0),
      status text not null default 'draft' check (status in ('draft','published','disabled')),
      content jsonb not null check (jsonb_typeof(content) = 'object' and content->>'slug' = slug),
      created_by uuid not null references profiles,
      created_at timestamptz not null default clock_timestamp(),
      updated_at timestamptz not null default clock_timestamp(),
      published_at timestamptz,
      unique(slug, version),
      check ((status = 'draft' and published_at is null) or (status <> 'draft' and published_at is not null))
    );
    create unique index playbook_one_published_version on playbook_versions(slug) where status = 'published';

    create function protect_playbook_version() returns trigger language plpgsql set search_path = '' as $function$
    begin
      if TG_OP = 'DELETE' then
        if OLD.status <> 'draft' then raise exception 'Published playbook history cannot be deleted'; end if;
        return OLD;
      end if;
      if OLD.slug <> NEW.slug or OLD.version <> NEW.version or OLD.created_by <> NEW.created_by then
        raise exception 'Playbook identity is immutable';
      end if;
      if OLD.status <> 'draft' then
        if OLD.content is distinct from NEW.content or OLD.published_at is distinct from NEW.published_at
          or NEW.status <> 'disabled' then
          raise exception 'Published playbook content is immutable; revise it as a new draft';
        end if;
      end if;
      NEW.updated_at = clock_timestamp();
      return NEW;
    end;
    $function$;
    create trigger protect_playbook_version before update or delete on playbook_versions
      for each row execute function protect_playbook_version();


  end if;
end;
$compat$;

-- Restore protection only if absent/non-monotonic. A previously applied monotonic function is left alone.
do $compat$
begin
  if to_regproc('public.protect_playbook_version') is null
      or position('OLD.updated_at + interval ''1 microsecond''' in
        pg_get_functiondef(to_regproc('public.protect_playbook_version'))) = 0 then
    -- CAS tokens remain strictly newer even if the system clock steps backwards.
    create or replace function public.protect_playbook_version()
    returns trigger language plpgsql set search_path = public as $function$
    begin
      if TG_OP = 'DELETE' then
        if OLD.status <> 'draft' then
          raise exception 'Published playbook revisions cannot be deleted';
        end if;
        return OLD;
      end if;
      if NEW.slug <> OLD.slug or NEW.version <> OLD.version or NEW.created_by is distinct from OLD.created_by
          or NEW.created_at is distinct from OLD.created_at then
        raise exception 'Playbook identity is immutable';
      end if;
      if OLD.status <> 'draft' and (
          NEW.content is distinct from OLD.content or NEW.published_at is distinct from OLD.published_at
          or NEW.status <> 'disabled') then
        raise exception 'Published playbook revisions are immutable; create a new draft';
      end if;
      NEW.updated_at = greatest(clock_timestamp(), OLD.updated_at + interval '1 microsecond');
      return NEW;
    end;
    $function$;

  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.playbook_versions'::regclass
      and tgname = 'protect_playbook_version' and not tgisinternal) then
    create trigger protect_playbook_version before update or delete on public.playbook_versions
      for each row execute function public.protect_playbook_version();
  end if;
end;
$compat$;

create unique index if not exists playbook_one_published_version
  on public.playbook_versions(slug) where status = 'published';
alter table public.playbook_versions enable row level security;
-- RLS does not guard TRUNCATE; clients receive only the read privilege, never destructive grants.
revoke all on public.playbook_versions from anon, authenticated;
grant select on public.playbook_versions to authenticated;

do $compat$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
      and tablename = 'playbook_versions' and policyname = 'Mo reads playbook versions') then
    create policy "Mo reads playbook versions" on playbook_versions for select to authenticated
      using (exists(select 1 from profiles where id = (select auth.uid()) and role::text in ('coordinator','safety_lead','admin')));
  end if;
end;
$compat$;

do $compat$
begin
  if not exists (select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'playbook_versions') then
    alter publication supabase_realtime add table public.playbook_versions;
  end if;
end;
$compat$;

