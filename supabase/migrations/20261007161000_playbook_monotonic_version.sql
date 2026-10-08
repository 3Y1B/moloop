-- CAS tokens remain strictly newer even if the system clock steps backwards.
create or replace function public.protect_playbook_version()
returns trigger language plpgsql set search_path = public as $$
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
$$;

