-- Recommendation taste-signal policy and concert writer repair.
-- Applied to production on 2026-09-29.
--
-- Core rule:
--   Mere presence of an item in the library/feed is NOT a taste signal.
--   Taste evidence requires explicit user feedback: rating/comment, want, dismiss,
--   or an active taste-profile entry backed by such evidence.

create or replace function public.refresh_user_music_taste(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $function$
begin
  if p_user_id is null then return; end if;

  delete from public.user_music_preferences where user_id=p_user_id;

  insert into public.user_music_preferences(user_id,genre,evidence_count,score,updated_at)
  select
    p_user_id,
    g.genre,
    count(distinct l.item_id)::integer,
    count(distinct l.item_id)::numeric,
    now()
  from public.user_library_items l
  join public.items i on i.id=l.item_id and i.category='music'
  cross join lateral jsonb_array_elements_text(
    coalesce(i.metadata->'tags'->'genres','[]'::jsonb)
  ) as g(genre)
  where l.user_id=p_user_id
    and l.rating is not null
    and l.rating>=7
    and length(trim(g.genre))>0
  group by g.genre;
end;
$function$;

create or replace function public.sync_user_music_taste_from_library()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $function$
declare
  v_old_is_music boolean:=false;
  v_new_is_music boolean:=false;
begin
  if tg_op<>'INSERT' then
    select exists(
      select 1 from public.items i
      where i.id=old.item_id and i.category='music'
    ) into v_old_is_music;
  end if;

  if tg_op<>'DELETE' then
    select exists(
      select 1 from public.items i
      where i.id=new.item_id and i.category='music'
    ) into v_new_is_music;
  end if;

  if tg_op='DELETE' then
    if v_old_is_music and old.rating is not null and old.rating>=7 then
      perform public.refresh_user_music_taste(old.user_id);
    end if;
    return old;
  end if;

  if tg_op='INSERT' then
    if v_new_is_music and new.rating is not null and new.rating>=7 then
      perform public.refresh_user_music_taste(new.user_id);
    end if;
    return new;
  end if;

  if (
    (v_old_is_music or v_new_is_music)
    and (
      old.user_id is distinct from new.user_id
      or old.item_id is distinct from new.item_id
      or old.rating is distinct from new.rating
    )
    and (
      (old.rating is not null and old.rating>=7)
      or (new.rating is not null and new.rating>=7)
    )
  ) then
    perform public.refresh_user_music_taste(new.user_id);
    if old.user_id is distinct from new.user_id then
      perform public.refresh_user_music_taste(old.user_id);
    end if;
  end if;

  return new;
end;
$function$;

create or replace function public.get_daily_taste_signal_context(p_automation_job_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  v_user_id uuid;
  v_library jsonb;
  v_reactions jsonb;
  v_taste_profile jsonb;
  v_music_library jsonb;
  v_music_genres jsonb;
begin
  select j.user_id into v_user_id
  from public.user_automation_jobs j
  where j.id=p_automation_job_id
    and j.job_kind='daily_recommendations'
    and j.status in ('active','paused');

  if v_user_id is null then
    raise exception 'daily automation job not found';
  end if;

  select coalesce(jsonb_agg(x.obj order by x.updated_at desc),'[]'::jsonb)
  into v_library
  from (
    select
      l.updated_at,
      jsonb_build_object(
        'item_id',l.item_id,
        'category',i.category,
        'title',i.title_ru,
        'status',l.status,
        'rating',l.rating,
        'comment',nullif(btrim(coalesce(l.comment,'')),''),
        'genres',coalesce(i.metadata->'tags'->'genres',i.metadata->'genres','[]'::jsonb),
        'updated_at',l.updated_at,
        'evidence_source','library_explicit_feedback'
      ) obj
    from public.user_library_items l
    join public.items i on i.id=l.item_id
    where l.user_id=v_user_id
      and (
        l.rating is not null
        or nullif(btrim(coalesce(l.comment,'')),'') is not null
      )
    order by l.updated_at desc
    limit 300
  ) x;

  select coalesce(jsonb_agg(x.obj order by x.updated_at desc),'[]'::jsonb)
  into v_reactions
  from (
    select
      f.updated_at,
      jsonb_build_object(
        'item_id',f.item_id,
        'category',i.category,
        'title',i.title_ru,
        'reaction',case when f.status='dismissed' then 'dismissed' else 'want' end,
        'genres',coalesce(i.metadata->'tags'->'genres',i.metadata->'genres','[]'::jsonb),
        'updated_at',f.updated_at,
        'evidence_source','explicit_recommendation_reaction'
      ) obj
    from public.user_feed_items f
    join public.items i on i.id=f.item_id
    where f.recipient_user_id=v_user_id
      and (f.user_intent='want' or f.status='dismissed')
    order by f.updated_at desc
    limit 200
  ) x;

  select coalesce(jsonb_agg(x.obj order by x.confidence desc, x.preference_key),'[]'::jsonb)
  into v_taste_profile
  from (
    select
      t.confidence,
      t.preference_key,
      jsonb_build_object(
        'preference_key',t.preference_key,
        'category',t.category,
        'dimension',t.dimension,
        'preference_statement',t.preference_statement,
        'weight',t.weight,
        'confidence',t.confidence,
        'evidence_count',t.evidence_count,
        'evidence_summary',t.evidence_summary,
        'last_updated',t.last_updated
      ) obj
    from public.user_taste_profile t
    where t.user_id=v_user_id and t.status='active'
    order by t.confidence desc,abs(coalesce(t.weight,0)) desc,t.preference_key
    limit 120
  ) x;

  select coalesce(jsonb_agg(x.obj order by x.updated_at desc),'[]'::jsonb)
  into v_music_library
  from (
    select
      l.updated_at,
      jsonb_build_object(
        'item_id',l.item_id,
        'title',i.title_ru,
        'rating',l.rating,
        'comment',nullif(btrim(coalesce(l.comment,'')),''),
        'genres',coalesce(i.metadata->'tags'->'genres',i.metadata->'genres','[]'::jsonb),
        'updated_at',l.updated_at,
        'evidence_source','music_library_explicit_feedback'
      ) obj
    from public.user_library_items l
    join public.items i on i.id=l.item_id
    where l.user_id=v_user_id
      and i.category='music'
      and (
        l.rating is not null
        or nullif(btrim(coalesce(l.comment,'')),'') is not null
      )
    order by l.updated_at desc
    limit 200
  ) x;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'genre',p.genre,
      'evidence_count',p.evidence_count,
      'score',p.score,
      'updated_at',p.updated_at,
      'evidence_source','positive_rated_music'
    )
    order by p.score desc,p.evidence_count desc,p.genre
  ),'[]'::jsonb)
  into v_music_genres
  from (
    select *
    from public.user_music_preferences
    where user_id=v_user_id
    order by score desc,evidence_count desc,genre
    limit 50
  ) p;

  return jsonb_build_object(
    'contract',jsonb_build_object(
      'direct_signal_priority',jsonb_build_array(
        'task_explicit_preference_and_category_settings',
        'library_rating_and_comment',
        'explicit_want_reaction',
        'explicit_dismissed_reaction',
        'same_category_reacted_library_history',
        'active_taste_profile'
      ),
      'neutral_library_presence_is_not_taste',true,
      'library_signal_requires_explicit_feedback',true,
      'neutral_status_change_is_not_taste',true,
      'ranking_not_hard_filter',true,
      'one_signal_is_not_a_ban',true,
      'category_isolation',true,
      'concert_music_bridge',jsonb_build_object(
        'enabled',true,
        'sources',jsonb_build_array(
          'reacted_music_library_items',
          'positive_rated_music_genres'
        ),
        'neutral_music_library_presence_is_not_taste',true
      ),
      'empty_signal_fallback',
      'rank broadly popular and highly rated factual candidates; never skip a required block and never invent user taste'
    ),
    'library_items',v_library,
    'explicit_reactions',v_reactions,
    'taste_profile',v_taste_profile,
    'music_library_items',v_music_library,
    'music_library_genres',v_music_genres
  );
end;
$function$;

create or replace function public.get_daily_taste_evidence_delta(
  p_automation_job_id uuid,
  p_run_id uuid
)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  v_user_id uuid;
  v_started_at timestamptz;
  v_since timestamptz;
  v_library jsonb;
  v_intents jsonb;
  v_library_count integer;
  v_ignored_neutral_library_count integer;
  v_intent_count integer;
begin
  select j.user_id into v_user_id
  from public.user_automation_jobs j
  where j.id=p_automation_job_id
    and j.job_kind='daily_recommendations'
    and j.status in ('active','paused');

  if v_user_id is null then raise exception 'daily automation job not found'; end if;

  select r.started_at into v_started_at
  from public.daily_recommendation_runs r
  where r.id=p_run_id and r.automation_job_id=p_automation_job_id;

  if v_started_at is null then raise exception 'daily run not found for automation job'; end if;

  select max(r.completed_at) into v_since
  from public.daily_recommendation_runs r
  where r.id<>p_run_id
    and r.automation_job_id=p_automation_job_id
    and r.status in ('completed','completed_with_errors')
    and r.completed_at is not null
    and r.completed_at<v_started_at;

  v_since:=coalesce(v_since,v_started_at-interval '30 days');

  select count(*) into v_library_count
  from public.user_library_items l
  where l.user_id=v_user_id
    and l.updated_at>v_since
    and l.updated_at<=v_started_at
    and (
      l.rating is not null
      or nullif(btrim(coalesce(l.comment,'')),'') is not null
    );

  select count(*) into v_ignored_neutral_library_count
  from public.user_library_items l
  where l.user_id=v_user_id
    and l.updated_at>v_since
    and l.updated_at<=v_started_at
    and l.rating is null
    and nullif(btrim(coalesce(l.comment,'')),'') is null;

  select coalesce(jsonb_agg(x.obj order by x.updated_at),'[]'::jsonb)
  into v_library
  from (
    select
      l.updated_at,
      jsonb_build_object(
        'item_id',l.item_id,
        'category',i.category,
        'title',i.title_ru,
        'status',l.status,
        'consumption_format',case when i.category='book' then l.consumption_format else null end,
        'started_at',case when i.category='book' then l.started_at else null end,
        'completed_at',case when i.category='book' then l.completed_at else null end,
        'rating',l.rating,
        'comment',nullif(btrim(coalesce(l.comment,'')),''),
        'updated_at',l.updated_at,
        'genres',coalesce(i.metadata->'tags'->'genres',i.metadata->'genres','[]'::jsonb),
        'evidence_source','library_explicit_feedback'
      ) obj
    from public.user_library_items l
    join public.items i on i.id=l.item_id
    where l.user_id=v_user_id
      and l.updated_at>v_since
      and l.updated_at<=v_started_at
      and (
        l.rating is not null
        or nullif(btrim(coalesce(l.comment,'')),'') is not null
      )
    order by l.updated_at
    limit 500
  ) x;

  select count(*) into v_intent_count
  from public.user_feed_items f
  where f.recipient_user_id=v_user_id
    and f.updated_at>v_since
    and f.updated_at<=v_started_at
    and (f.user_intent='want' or f.status='dismissed');

  select coalesce(jsonb_agg(x.obj order by x.updated_at),'[]'::jsonb)
  into v_intents
  from (
    select
      f.updated_at,
      jsonb_build_object(
        'item_id',f.item_id,
        'category',i.category,
        'title',i.title_ru,
        'status',f.status,
        'user_intent',f.user_intent,
        'source',f.source,
        'updated_at',f.updated_at,
        'evidence_source','explicit_recommendation_reaction',
        'reaction',case
          when f.status='dismissed' then 'dismissed'
          when f.user_intent='want' then 'want'
          else null
        end
      ) obj
    from public.user_feed_items f
    join public.items i on i.id=f.item_id
    where f.recipient_user_id=v_user_id
      and f.updated_at>v_since
      and f.updated_at<=v_started_at
      and (f.user_intent='want' or f.status='dismissed')
    order by f.updated_at
    limit 300
  ) x;

  return jsonb_build_object(
    'since_at',v_since,
    'run_started_at',v_started_at,
    'source_policy','explicit_library_feedback_plus_explicit_reactions',
    'neutral_library_presence_is_not_taste',true,
    'meaningful_change_count',v_library_count+v_intent_count,
    'library_change_count',v_library_count,
    'ignored_neutral_library_change_count',v_ignored_neutral_library_count,
    'intent_change_count',v_intent_count,
    'library_changes',v_library,
    'intent_changes',v_intents
  );
end;
$function$;

-- Existing unsupported music profiles are preserved in history but removed from
-- active taste when there is no explicit music feedback/reaction.
with affected as (
  select t.*
  from public.user_taste_profile t
  where t.category='music'
    and t.status='active'
    and not exists (
      select 1
      from public.user_library_items l
      join public.items i on i.id=l.item_id
      where l.user_id=t.user_id
        and i.category='music'
        and (
          l.rating is not null
          or nullif(btrim(coalesce(l.comment,'')),'') is not null
        )
    )
    and not exists (
      select 1
      from public.user_feed_items f
      join public.items i on i.id=f.item_id
      where f.recipient_user_id=t.user_id
        and i.category='music'
        and (f.user_intent='want' or f.status='dismissed')
    )
),
history_insert as (
  insert into public.user_taste_profile_history(
    user_id,preference_key,category,dimension,preference_statement,weight,
    confidence,evidence_count,source_status,source_last_updated,observed_at,
    is_initial,automation_job_id
  )
  select
    user_id,preference_key,category,dimension,preference_statement,weight,
    confidence,evidence_count,'inactive',current_date,now(),false,automation_job_id
  from affected
  returning 1
)
update public.user_taste_profile t
set status='inactive',last_updated=current_date
where (t.user_id,t.preference_key) in (
  select user_id,preference_key from affected
);

do $$
declare
  v_user uuid;
begin
  for v_user in
    select distinct user_id
    from (
      select user_id from public.user_music_preferences
      union
      select l.user_id
      from public.user_library_items l
      join public.items i on i.id=l.item_id
      where i.category='music'
    ) q
  loop
    perform public.refresh_user_music_taste(v_user);
  end loop;
end;
$$;

-- Concert writer: dedupe is checked before completeness validation.
-- Existing canonical items can be delivered without rebuilding them.
-- New factual items with repairable missing fields are handed to the candidate
-- enrichment pipeline instead of raising and leaving the daily block stuck.
create or replace function public.upsert_daily_concert_recommendation(
  p_automation_job_id uuid,
  p_event_key text,
  p_title text,
  p_artist_name text,
  p_description text,
  p_country text,
  p_event_date date,
  p_start_time time without time zone default null::time without time zone,
  p_city text default null::text,
  p_venue text default null::text,
  p_genres jsonb default '[]'::jsonb,
  p_price_min numeric default null::numeric,
  p_price_max numeric default null::numeric,
  p_currency text default null::text,
  p_ticket_url text default null::text,
  p_event_url text default null::text,
  p_poster_url text default null::text,
  p_why_match text default null::text,
  p_match_score integer default null::integer,
  p_recommendation_mode text default 'music_fit'::text,
  p_exploration_reasons jsonb default '[]'::jsonb,
  p_source_name text default 'concert_daily_v2'::text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid;
  v_event_key text;
  v_item_key text;
  v_item_id uuid;
  v_existing_metadata jsonb;
  v_metadata jsonb;
  v_result text;
  v_norm_event_url text;
  v_norm_ticket_url text;
  v_reason_count integer;
  v_delivery_source text;
  v_provider text;
  v_policy jsonb;
  v_horizon_months integer:=2;
  v_missing_fields text[]:='{}'::text[];
  v_run_id text;
  v_handoff jsonb;
begin
  select j.user_id,j.provider
  into v_user_id,v_provider
  from public.user_automation_jobs j
  where j.id=p_automation_job_id
    and j.job_kind='daily_recommendations'
    and j.status in ('active','paused');

  if v_user_id is null then raise exception 'daily automation job not found'; end if;

  if v_provider='legacy_daily_chatgpt' then
    select s.policy into v_policy
    from public.user_recommendation_settings s
    where s.user_id=v_user_id;

    if v_policy is not null then
      v_horizon_months:=coalesce(
        (v_policy->'categories'->'concert'->>'horizon_months')::integer,
        2
      );
    end if;
  end if;

  v_event_key:=regexp_replace(
    lower(nullif(btrim(coalesce(p_event_key,'')),'')),
    '^(concert:)+',''
  );

  if v_event_key is null then raise exception 'event key is required'; end if;
  if nullif(btrim(coalesce(p_title,'')),'') is null then raise exception 'title is required'; end if;
  if p_event_date is null then raise exception 'concert date is required'; end if;

  if p_recommendation_mode not in ('music_fit','controlled_exploration','external_user') then
    raise exception 'unsupported concert recommendation mode';
  end if;

  if p_match_score is not null and (p_match_score<0 or p_match_score>100) then
    raise exception 'match score must be between 0 and 100';
  end if;

  if p_exploration_reasons is null or jsonb_typeof(p_exploration_reasons)<>'array' then
    raise exception 'exploration_reasons must be an array';
  end if;

  if p_recommendation_mode='controlled_exploration' then
    select count(distinct btrim(value))
    into v_reason_count
    from jsonb_array_elements_text(p_exploration_reasons) x(value)
    where nullif(btrim(value),'') is not null;

    if jsonb_array_length(p_exploration_reasons)<>3 or v_reason_count<>3 then
      raise exception 'controlled exploration requires exactly 3 distinct reasons';
    end if;
  elsif jsonb_array_length(p_exploration_reasons)<>0 then
    raise exception 'non-exploration recommendation must not contain exploration reasons';
  end if;

  if p_recommendation_mode<>'external_user' and p_event_date<current_date then
    raise exception 'concert date must be in the future';
  end if;

  if p_recommendation_mode<>'external_user'
     and p_event_date>(current_date+make_interval(months=>v_horizon_months))::date then
    return jsonb_build_object(
      'result',
      case when p_recommendation_mode='controlled_exploration'
        then 'exploration_quota_satisfied'
        else 'normal_quota_satisfied'
      end,
      'horizon_months',v_horizon_months,
      'deferred_by','concert_horizon'
    );
  end if;

  if p_price_min is not null and p_price_min<0
     or p_price_max is not null and p_price_max<0
     or p_price_min is not null and p_price_max is not null and p_price_min>p_price_max then
    raise exception 'invalid price range';
  end if;

  if nullif(btrim(coalesce(p_poster_url,'')),'') is not null
     and (p_poster_url!~'^https://' or p_poster_url~*'(^|[.])scdn[.]co/|spotify') then
    raise exception 'invalid concert event poster';
  end if;

  v_norm_event_url:=lower(regexp_replace(coalesce(nullif(btrim(p_event_url),''),''),'[?#].*$',''));
  v_norm_ticket_url:=lower(regexp_replace(coalesce(nullif(btrim(p_ticket_url),''),''),'[?#].*$',''));

  if v_norm_event_url ~ '^https://[^/]+/?$' then v_norm_event_url:=''; end if;
  if v_norm_ticket_url ~ '^https://[^/]+/?$' then v_norm_ticket_url:=''; end if;

  v_item_key:='concert:'||v_event_key;

  select i.id,coalesce(i.metadata,'{}'::jsonb)
  into v_item_id,v_existing_metadata
  from public.items i
  where i.category='concert'
    and (
      i.item_key=v_item_key
      or i.metadata->>'event_identity_key'=v_event_key
      or (
        v_norm_event_url<>''
        and lower(regexp_replace(
          coalesce(i.metadata->>'event_url',i.metadata->>'source_url',''),
          '[?#].*$',''
        ))=v_norm_event_url
      )
      or (
        v_norm_ticket_url<>''
        and lower(regexp_replace(coalesce(i.metadata->>'ticket_url',''),'[?#].*$',''))=v_norm_ticket_url
      )
    )
  order by case
    when i.item_key=v_item_key then 0
    when i.metadata->>'event_identity_key'=v_event_key then 1
    else 2
  end
  limit 1;

  if v_item_id is not null then
    v_delivery_source:=coalesce(
      nullif(v_norm_event_url,''),
      nullif(v_norm_ticket_url,''),
      nullif(btrim(coalesce(v_existing_metadata->>'event_url','')),''),
      nullif(btrim(coalesce(v_existing_metadata->>'ticket_url','')),''),
      nullif(btrim(coalesce(v_existing_metadata->>'source_url','')),'')
    );

    if v_delivery_source is null or v_delivery_source!~'^https://' then
      raise exception 'verified HTTPS source URL is required for existing concert delivery';
    end if;

    if p_recommendation_mode='external_user' then
      v_result:='canonical_external_ready';
    else
      v_result:=public.deliver_personal_ai_item(
        p_automation_job_id,v_item_id,
        nullif(btrim(coalesce(p_why_match,'')),''),
        p_match_score,null,p_recommendation_mode,
        coalesce(p_exploration_reasons,'[]'::jsonb),
        v_delivery_source,null
      );
    end if;

    return jsonb_build_object(
      'item_id',v_item_id,
      'item_key',v_item_key,
      'event_identity_key',v_event_key,
      'result',v_result,
      'recommendation_mode',p_recommendation_mode,
      'dedupe_hit',true,
      'new_item',false
    );
  end if;

  if v_norm_event_url='' and v_norm_ticket_url='' then
    raise exception 'event_url or ticket_url must be event-specific, not a venue homepage';
  end if;

  v_delivery_source:=coalesce(nullif(v_norm_event_url,''),nullif(v_norm_ticket_url,''));

  if nullif(btrim(coalesce(p_artist_name,'')),'') is null then
    v_missing_fields:=array_append(v_missing_fields,'artist_name');
  end if;
  if nullif(btrim(coalesce(p_description,'')),'') is null then
    v_missing_fields:=array_append(v_missing_fields,'description');
  end if;
  if nullif(btrim(coalesce(p_city,'')),'') is null then
    v_missing_fields:=array_append(v_missing_fields,'city');
  end if;
  if nullif(btrim(coalesce(p_venue,'')),'') is null then
    v_missing_fields:=array_append(v_missing_fields,'venue');
  end if;
  if p_genres is null or jsonb_typeof(p_genres)<>'array' or jsonb_array_length(p_genres)=0 then
    v_missing_fields:=array_append(v_missing_fields,'genres');
  end if;
  if nullif(btrim(coalesce(p_poster_url,'')),'') is null then
    v_missing_fields:=array_append(v_missing_fields,'poster_url');
  end if;

  if cardinality(v_missing_fields)>0 then
    if p_recommendation_mode<>'external_user'
       and nullif(btrim(coalesce(p_why_match,'')),'') is null then
      raise exception 'why_match is required for concert candidate handoff';
    end if;

    select r.id::text
    into v_run_id
    from public.daily_recommendation_runs r
    where r.automation_job_id=p_automation_job_id and r.status='running'
    order by r.started_at desc
    limit 1;

    v_handoff:=public.enqueue_daily_recommendation_candidate(
      p_automation_job_id,
      v_item_key,
      'concert',
      btrim(p_title),
      v_delivery_source,
      jsonb_strip_nulls(jsonb_build_object(
        'origin_block','concerts',
        'event_key',v_event_key,
        'event_identity_key',v_event_key,
        'title',btrim(p_title),
        'artist_name',nullif(btrim(coalesce(p_artist_name,'')),''),
        'description',nullif(btrim(coalesce(p_description,'')),''),
        'country',nullif(btrim(coalesce(p_country,'')),''),
        'year',extract(year from p_event_date)::integer,
        'event_date',p_event_date::text,
        'start_time',case when p_start_time is null then null else p_start_time::text end,
        'city',nullif(btrim(coalesce(p_city,'')),''),
        'venue',nullif(btrim(coalesce(p_venue,'')),''),
        'genres',case
          when p_genres is not null and jsonb_typeof(p_genres)='array' then p_genres
          else '[]'::jsonb
        end,
        'price_min',p_price_min,
        'price_max',p_price_max,
        'currency',nullif(btrim(coalesce(p_currency,'')),''),
        'ticket_url',nullif(v_norm_ticket_url,''),
        'event_url',nullif(v_norm_event_url,''),
        'source_url',v_delivery_source,
        'poster_url',nullif(btrim(coalesce(p_poster_url,'')),''),
        'source_name',p_source_name,
        'why_match',nullif(btrim(coalesce(p_why_match,'')),''),
        'match_score',p_match_score,
        'recommendation_mode',p_recommendation_mode,
        'exploration_reasons',coalesce(p_exploration_reasons,'[]'::jsonb),
        'repair_needed',true,
        'missing_fields',to_jsonb(v_missing_fields)
      )),
      p_match_score,
      p_recommendation_mode,
      coalesce(p_exploration_reasons,'[]'::jsonb),
      v_run_id
    );

    return jsonb_build_object(
      'result','candidate_handoff',
      'candidate_id',v_handoff->'candidate_id',
      'candidate_status',v_handoff->'status',
      'item_key',v_item_key,
      'event_identity_key',v_event_key,
      'recommendation_mode',p_recommendation_mode,
      'missing_fields',to_jsonb(v_missing_fields),
      'dedupe_hit',false,
      'new_item',true
    );
  end if;

  v_metadata:=jsonb_strip_nulls(jsonb_build_object(
    'event_identity_key',v_event_key,
    'artist_name',btrim(p_artist_name),
    'event_date',p_event_date::text,
    'start_time',case when p_start_time is null then null else p_start_time::text end,
    'city',btrim(p_city),
    'venue',btrim(p_venue),
    'venue_name',btrim(p_venue),
    'price_min',p_price_min,
    'price_max',p_price_max,
    'currency',nullif(btrim(coalesce(p_currency,'')),''),
    'ticket_url',nullif(v_norm_ticket_url,''),
    'event_url',nullif(v_norm_event_url,''),
    'source_url',v_delivery_source,
    'poster_url',nullif(btrim(coalesce(p_poster_url,'')),''),
    'source_name',p_source_name,
    'source_checked_at',current_date::text,
    'tags',jsonb_build_object('genres',p_genres)
  ));

  insert into public.items(item_key,category,title_ru,description,country,year,metadata)
  values(
    v_item_key,'concert',btrim(p_title),btrim(p_description),
    nullif(btrim(coalesce(p_country,'')),''),
    extract(year from p_event_date)::integer,
    v_metadata
  )
  returning id into v_item_id;

  if p_recommendation_mode='external_user' then
    v_result:='canonical_external_ready';
  else
    v_result:=public.deliver_personal_ai_item(
      p_automation_job_id,v_item_id,
      nullif(btrim(coalesce(p_why_match,'')),''),
      p_match_score,null,p_recommendation_mode,
      coalesce(p_exploration_reasons,'[]'::jsonb),
      v_delivery_source,null
    );
  end if;

  return jsonb_build_object(
    'item_id',v_item_id,
    'item_key',v_item_key,
    'event_identity_key',v_event_key,
    'result',v_result,
    'recommendation_mode',p_recommendation_mode,
    'dedupe_hit',false,
    'new_item',true
  );
end;
$function$;
