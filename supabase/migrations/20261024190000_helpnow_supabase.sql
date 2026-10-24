create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 80),
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.helper_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  skills text[] not null default '{}',
  service_radius_km integer check (service_radius_km is null or service_radius_km between 1 and 500),
  is_paused boolean not null default false,
  availability_schedule jsonb check (availability_schedule is null or jsonb_typeof(availability_schedule) = 'object'),
  check (skills <@ array['medical', 'transport', 'essentials', 'other']::text[]),
  updated_at timestamptz not null default now()
);

create table public.help_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  requester_name text not null,
  title text not null check (char_length(title) between 1 and 120),
  description text not null check (char_length(description) between 10 and 2000),
  category text not null check (category in ('medical', 'transport', 'essentials', 'other')),
  urgency text not null default 'normal' check (urgency in ('normal', 'urgent', 'critical')),
  status text not null default 'open' check (status in ('open', 'accepted', 'in_progress', 'resolved', 'cancelled', 'unfulfilled', 'flagged')),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  location_label text not null check (char_length(location_label) between 1 and 200),
  ai_summary text,
  reports integer not null default 0 check (reports >= 0),
  in_progress_at timestamptz,
  resolved_at timestamptz,
  unfulfilled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.help_assignments (
  request_id uuid primary key references public.help_requests (id) on delete cascade,
  requester_id uuid not null references public.profiles (id) on delete cascade,
  helper_id uuid not null references public.profiles (id) on delete cascade,
  helper_name text not null,
  accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (request_id, helper_id),
  check (requester_id <> helper_id)
);

create table public.help_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.help_requests (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  sender_name text not null,
  text text not null check (char_length(text) between 1 and 1000),
  created_at timestamptz not null default now()
);

create table public.help_request_reports (
  request_id uuid not null references public.help_requests (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (request_id, reporter_id)
);

create index help_requests_status_created_idx on public.help_requests (status, created_at desc);
create index help_requests_requester_created_idx on public.help_requests (requester_id, created_at desc);
create index help_requests_category_status_idx on public.help_requests (category, status);
create index help_requests_location_idx on public.help_requests (latitude, longitude);
create index help_assignments_helper_idx on public.help_assignments (helper_id, accepted_at desc);
create index help_messages_request_created_idx on public.help_messages (request_id, created_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger helper_preferences_set_updated_at
before update on public.helper_preferences
for each row execute function public.set_updated_at();

create trigger help_requests_set_updated_at
before update on public.help_requests
for each row execute function public.set_updated_at();

create or replace function public.prepare_help_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select p.display_name into new.requester_name
  from public.profiles p
  where p.id = new.requester_id;
  if new.requester_name is null then
    raise exception 'A profile is required to create a request.';
  end if;
  new.latitude = round(new.latitude::numeric, 2)::double precision;
  new.longitude = round(new.longitude::numeric, 2)::double precision;
  return new;
end;
$$;

create trigger help_requests_prepare_insert
before insert on public.help_requests
for each row execute function public.prepare_help_request();

create or replace function public.prepare_help_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select p.display_name into new.sender_name
  from public.profiles p
  where p.id = new.sender_id;
  if new.sender_name is null then
    raise exception 'A profile is required to send a message.';
  end if;
  return new;
end;
$$;

create trigger help_messages_prepare_insert
before insert on public.help_messages
for each row execute function public.prepare_help_message();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, email)
  values (
    new.id,
    case
      when char_length(coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(coalesce(new.email, ''), '@', 1), 'Community member')) between 2 and 80
        then coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(coalesce(new.email, ''), '@', 1), 'Community member')
      else 'Community member'
    end,
    coalesce(new.email, '')
  );
  insert into public.helper_preferences (user_id) values (new.id);
  return new;
end;
$$;

insert into public.profiles (id, display_name, email)
select
  u.id,
  case
    when char_length(coalesce(nullif(trim(u.raw_user_meta_data ->> 'name'), ''), split_part(coalesce(u.email, ''), '@', 1), 'Community member')) between 2 and 80
      then coalesce(nullif(trim(u.raw_user_meta_data ->> 'name'), ''), split_part(coalesce(u.email, ''), '@', 1), 'Community member')
    else 'Community member'
  end,
  coalesce(u.email, '')
from auth.users u
on conflict (id) do nothing;

insert into public.helper_preferences (user_id)
select p.id from public.profiles p
on conflict (user_id) do nothing;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

alter table public.profiles enable row level security;
alter table public.helper_preferences enable row level security;
alter table public.help_requests enable row level security;
alter table public.help_assignments enable row level security;
alter table public.help_messages enable row level security;
alter table public.help_request_reports enable row level security;
grant usage on schema public to authenticated;

create policy "Users can read their own profile"
on public.profiles for select to authenticated
using (id = (select auth.uid()));

create policy "Users can update their own profile"
on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy "Users can read their helper preferences"
on public.helper_preferences for select to authenticated
using (user_id = (select auth.uid()));

create policy "Users can create their helper preferences"
on public.helper_preferences for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "Users can update their helper preferences"
on public.helper_preferences for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "Users can read discoverable and participating requests"
on public.help_requests for select to authenticated
using (
  status = 'open'
  or requester_id = (select auth.uid())
  or exists (
    select 1 from public.help_assignments a
    where a.request_id = id and a.helper_id = (select auth.uid())
  )
);

create policy "Users can create their own open requests"
on public.help_requests for insert to authenticated
with check (
  requester_id = (select auth.uid())
  and status in ('open', 'flagged')
);

create policy "Participants can view assignments"
on public.help_assignments for select to authenticated
using (
  requester_id = (select auth.uid())
  or helper_id = (select auth.uid())
);

create policy "Participants can read request messages"
on public.help_messages for select to authenticated
using (
  exists (
    select 1 from public.help_requests r
    where r.id = request_id
      and (
        r.requester_id = (select auth.uid())
        or exists (
          select 1 from public.help_assignments a
          where a.request_id = r.id and a.helper_id = (select auth.uid())
        )
      )
  )
);

create policy "Participants can send request messages"
on public.help_messages for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and exists (
    select 1 from public.help_requests r
    where r.id = request_id
      and (
        r.requester_id = (select auth.uid())
        or exists (
          select 1 from public.help_assignments a
          where a.request_id = r.id and a.helper_id = (select auth.uid())
        )
      )
  )
);

revoke all on public.help_request_reports from anon, authenticated;
revoke all on public.profiles from anon, authenticated;
revoke all on public.helper_preferences from anon, authenticated;
revoke all on public.help_requests from anon, authenticated;
revoke all on public.help_assignments from anon, authenticated;
revoke all on public.help_messages from anon, authenticated;
grant select (id, display_name, email, created_at, updated_at), update (display_name)
on public.profiles to authenticated;
grant select, insert, update on public.helper_preferences to authenticated;
grant select (
  id, requester_id, requester_name, title, description, category, urgency, status,
  latitude, longitude, ai_summary, reports, in_progress_at, resolved_at,
  unfulfilled_at, created_at, updated_at
) on public.help_requests to authenticated;
grant insert (
  requester_id, requester_name, title, description, category, urgency, status,
  latitude, longitude, location_label, ai_summary
) on public.help_requests to authenticated;
grant select (request_id, requester_id, helper_id, helper_name, accepted_at, created_at)
on public.help_assignments to authenticated;
grant select, insert on public.help_messages to authenticated;

create or replace function public.claim_help_request(p_request_id uuid)
returns public.help_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_request public.help_requests;
  v_helper_name text;
begin
  if v_user_id is null then
    raise exception 'Sign in to accept a request.';
  end if;

  select * into v_request
  from public.help_requests
  where id = p_request_id
  for update;

  if not found then raise exception 'Request not found.'; end if;
  if v_request.requester_id = v_user_id then
    raise exception 'You cannot accept your own request.';
  end if;
  if v_request.status <> 'open' then
    raise exception 'This request is no longer open.';
  end if;
  if exists (
    select 1 from public.helper_preferences hp
    where hp.user_id = v_user_id and hp.is_paused
  ) then
    raise exception 'Pause receiving requests is enabled for your account.';
  end if;

  select p.display_name into v_helper_name
  from public.profiles p
  where p.id = v_user_id;

  insert into public.help_assignments (request_id, requester_id, helper_id, helper_name)
  values (p_request_id, v_request.requester_id, v_user_id, coalesce(v_helper_name, 'Community member'));

  update public.help_requests
  set status = 'accepted'
  where id = p_request_id
  returning * into v_request;
  return v_request;
end;
$$;

create or replace function public.transition_help_request(p_request_id uuid, p_status text)
returns public.help_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_request public.help_requests;
  v_helper_id uuid;
begin
  if v_user_id is null then raise exception 'Sign in to update a request.'; end if;
  if p_status not in ('in_progress', 'resolved', 'cancelled', 'unfulfilled', 'open') then
    raise exception 'Invalid status.';
  end if;

  select * into v_request
  from public.help_requests
  where id = p_request_id
  for update;
  if not found then raise exception 'Request not found.'; end if;

  select helper_id into v_helper_id
  from public.help_assignments
  where request_id = p_request_id;

  if p_status = 'in_progress' then
    if v_helper_id is distinct from v_user_id or v_request.status <> 'accepted' then
      raise exception 'You are not allowed to make this status change.';
    end if;
    update public.help_requests set status = p_status, in_progress_at = now()
    where id = p_request_id returning * into v_request;
  elsif p_status = 'resolved' then
    if v_user_id not in (v_request.requester_id, v_helper_id) or v_request.status <> 'in_progress' then
      raise exception 'You are not allowed to make this status change.';
    end if;
    update public.help_requests set status = p_status, resolved_at = now()
    where id = p_request_id returning * into v_request;
  elsif p_status = 'cancelled' then
    if v_user_id <> v_request.requester_id or v_request.status not in ('open', 'accepted', 'in_progress') then
      raise exception 'You are not allowed to make this status change.';
    end if;
    delete from public.help_assignments where request_id = p_request_id;
    update public.help_requests set status = p_status
    where id = p_request_id returning * into v_request;
  elsif p_status = 'unfulfilled' then
    if v_user_id <> v_request.requester_id or v_request.status <> 'open' then
      raise exception 'You are not allowed to make this status change.';
    end if;
    update public.help_requests set status = p_status, unfulfilled_at = now()
    where id = p_request_id returning * into v_request;
  else
    if v_user_id is distinct from v_helper_id or v_request.status not in ('accepted', 'in_progress') then
      raise exception 'You are not allowed to make this status change.';
    end if;
    delete from public.help_assignments where request_id = p_request_id;
    update public.help_requests set status = 'open', in_progress_at = null
    where id = p_request_id returning * into v_request;
  end if;
  return v_request;
end;
$$;

create or replace function public.report_help_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_request public.help_requests;
  v_report_count integer;
begin
  if v_user_id is null then raise exception 'Sign in to report a request.'; end if;
  select * into v_request from public.help_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found.'; end if;
  if v_request.requester_id = v_user_id then raise exception 'You cannot report your own request.'; end if;

  insert into public.help_request_reports (request_id, reporter_id)
  values (p_request_id, v_user_id)
  on conflict do nothing;
  if not found then raise exception 'You have already reported this request.'; end if;

  select count(*) into v_report_count from public.help_request_reports where request_id = p_request_id;
  update public.help_requests
  set reports = v_report_count, status = case when v_report_count >= 3 then 'flagged' else status end
  where id = p_request_id returning * into v_request;
  return jsonb_build_object('reports', v_request.reports, 'status', v_request.status);
end;
$$;

revoke all on function public.claim_help_request(uuid) from public, anon;
revoke all on function public.transition_help_request(uuid, text) from public, anon;
revoke all on function public.report_help_request(uuid) from public, anon;
grant execute on function public.claim_help_request(uuid) to authenticated;
grant execute on function public.transition_help_request(uuid, text) to authenticated;
grant execute on function public.report_help_request(uuid) to authenticated;
