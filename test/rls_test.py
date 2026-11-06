"""Run supabase/schema.sql + seed.sql on a throwaway local Postgres (14+) with a small Supabase stand-in
(roles anon/authenticated, auth.jwt(), storage.buckets/objects/foldername) and check every RLS rule the two sites rely on.

    pip install psycopg2-binary
    PGHOST=/tmp PGPORT=5432 PGUSER=postgres python3 test/rls_test.py     # creates and drops database allthai_test

Never point this at a real Supabase project: it creates roles and schemas."""
import json, os, sys, uuid
import psycopg2

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'supabase') + os.sep
DSN = dict(host=os.environ.get('PGHOST', '/tmp'), port=int(os.environ.get('PGPORT', '5432')), user=os.environ.get('PGUSER', 'postgres'))

SUPABASE_STUB = r"""
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as
  $f$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $f$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.jwt() to anon, authenticated;
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now());
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, created_at timestamptz default now(), updated_at timestamptz default now(), metadata jsonb);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language plpgsql as
  $f$ declare _parts text[]; begin select string_to_array(name, '/') into _parts; return _parts[1:array_length(_parts, 1) - 1]; end $f$;
grant usage on schema storage to anon, authenticated;
grant all on storage.objects to anon, authenticated;
grant select on storage.buckets to anon, authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
"""

ok_count = 0
def ok(cond, msg):
    global ok_count
    if not cond:
        print('FAIL ·', msg); sys.exit(1)
    ok_count += 1
    print('  ok ·', msg)

def as_role(cur, role, email=None):
    cur.execute('reset role')
    claims = {'role': role}
    if email: claims['email'] = email
    cur.execute("select set_config('request.jwt.claims', %s, false)", (json.dumps(claims),))
    cur.execute('set role ' + role)

def fails(conn, sql, args=None):
    cur = conn.cursor()
    cur.execute('savepoint t')
    try:
        cur.execute(sql, args)
        n = cur.rowcount
        cur.execute('release savepoint t')
        return False, n
    except psycopg2.Error as e:
        cur.execute('rollback to savepoint t')
        return True, str(e).splitlines()[0]

def sub_row(**over):
    sid = str(uuid.uuid4())
    row = dict(id=sid, image_path='pending/' + sid + '.jpg', province_id='kanchanaburi', district_id='TH7108', category='สถานที่ท่องเที่ยว', title='สะพานไม้ยามเช้า',
               description='ทดสอบ', taken_at=None, credit_name='น้องทดสอบ', contact=None, license='allthai-nonexclusive-v1',
               consent_owner=True, consent_license=True, consent_people=True, status='pending')
    row.update(over)
    return row

def insert_sub(conn, row):
    cols = list(row)
    return fails(conn, 'insert into public.submissions (%s) values (%s)' % (','.join(cols), ','.join(['%s'] * len(cols))), [row[c] for c in cols])

def main():
    c0 = psycopg2.connect(dbname='postgres', **DSN); c0.autocommit = True
    c0.cursor().execute('drop database if exists allthai_test')
    c0.cursor().execute('create database allthai_test')
    conn = psycopg2.connect(dbname='allthai_test', **DSN); conn.autocommit = True
    cur = conn.cursor()
    cur.execute(SUPABASE_STUB)
    print('schema.sql (twice: must be re-runnable) + seed.sql (twice)')
    schema = open(ROOT + 'schema.sql', encoding='utf-8').read()
    seed = open(ROOT + 'seed.sql', encoding='utf-8').read()
    cur.execute(schema); cur.execute(schema)
    cur.execute(seed); cur.execute(seed)
    cur.execute('select count(*), count(*) filter (where status = $$draft$$) from public.questions'); n, d = cur.fetchone()
    ok(n == 10 and d == 10, 'seed: 10 questions (V2 travel), all draft')
    cur.execute('select count(*) from public.provinces'); ok(cur.fetchone()[0] == 77, 'seed: 77 provinces')
    cur.execute("select id, public, file_size_limit from storage.buckets order by id"); ok(cur.fetchall() == [('question-images', True, 5242880), ('submissions', False, 3145728)], 'buckets created (private queue, public question images)')
    cur.execute("select data->>'published_at', data->>'status' from public.questions where id = 'q-travel-0001'"); ok(cur.fetchone() == (None, 'draft'), 'trigger keeps data.status / published_at in step')

    conn.autocommit = False
    print('anon (เว็บเล่นเกม)')
    as_role(cur, 'anon')
    cur.execute('select count(*) from public.questions'); ok(cur.fetchone()[0] == 0, 'anon sees no draft questions')
    cur.execute('select count(*) from public.provinces'); ok(cur.fetchone()[0] == 77, 'anon reads provinces')
    f, info = fails(conn, 'select public.is_admin()'); ok(f, 'anon cannot call is_admin() at all')
    f, info = fails(conn, 'select private.recent_upload_count()'); ok(not f, 'anon can use the private counters (policies need them)')
    good = sub_row()
    f, info = insert_sub(conn, good); ok(not f, 'anon sends a pending photo row (with district TH7108)')
    f, info = insert_sub(conn, sub_row(district_id=None)); ok(not f, 'district is optional (older clients)')
    for label, over in [('status approved', dict(status='approved')), ('missing consent', dict(consent_people=False)),
                        ('foreign image path', dict(image_path='pending/other.jpg')), ('pre-filled review', dict(review_note='ok')),
                        ('other license', dict(license='CC BY 4.0')), ('title too long', dict(title='ก' * 121)), ('bad province id', dict(province_id='Nan; drop')),
                        ('bad district id', dict(district_id='TH71; drop')), ('district id not a pcode', dict(district_id='sangkhla'))]:
        f, info = insert_sub(conn, sub_row(**over)); ok(f, 'anon blocked: ' + label + ' (' + info[:60] + ')')
    f, info = fails(conn, "insert into public.submissions (id, image_path, province_id, title, consent_owner, consent_license, consent_people, created_at) values (%s, %s, 'nan', 'x', true, true, true, now() - interval '3 days')", (str(uuid.UUID(int=1)), 'pending/' + str(uuid.UUID(int=1)) + '.jpg'))
    ok(f, 'anon cannot backdate created_at to dodge the daily cap')
    cur.execute('select count(*) from public.submissions'); ok(cur.fetchone()[0] == 0, 'anon cannot read the queue (not even its own row)')
    f, n = fails(conn, "update public.questions set status = 'published', verified_by = 'x' where id = 'q-travel-0001'"); ok(not f and n == 0, 'anon cannot publish (0 rows)')
    f, n = fails(conn, "update public.provinces set verified = true where id = 'nan'"); ok(not f and n == 0, 'anon cannot edit provinces (0 rows)')
    f, info = fails(conn, "insert into public.questions (id, category, data) values ('q-food-9999', 'อาหาร', '{\"id\":\"q-food-9999\"}')"); ok(f, 'anon cannot add questions')
    cur.execute('select count(*) from public.admins'); ok(cur.fetchone()[0] == 0, 'anon cannot list admins')
    f, info = fails(conn, "insert into public.admins (email) values ('hacker@example.com')"); ok(f, 'anon cannot add itself as admin')
    f, info = fails(conn, "insert into storage.objects (bucket_id, name) values ('submissions', %s)", (good['image_path'],)); ok(not f, 'anon uploads into submissions/pending/')
    f, info = fails(conn, "insert into storage.objects (bucket_id, name) values ('submissions', 'other/x.jpg')"); ok(f, 'anon blocked outside pending/')
    f, info = fails(conn, "insert into storage.objects (bucket_id, name) values ('question-images', 'admin/x.jpg')"); ok(f, 'anon cannot write question images')
    cur.execute("select count(*) from storage.objects"); ok(cur.fetchone()[0] == 0, 'anon cannot list or read uploaded files')
    conn.commit()

    print('signed-in user that is not on the admin list')
    as_role(cur, 'authenticated', 'stranger@example.com')
    cur.execute('select public.is_admin()'); ok(cur.fetchone()[0] is False, 'not admin')
    cur.execute('select count(*) from public.submissions'); ok(cur.fetchone()[0] == 0, 'cannot read the queue')
    f, n = fails(conn, "update public.questions set verified_by = 'x'"); ok(not f and n == 0, 'cannot edit questions (0 rows)')
    conn.commit()

    print('admin (เว็บใส่ข้อมูล)')
    cur.execute('reset role'); cur.execute("insert into public.admins (email) values ('team@example.com')"); conn.commit()
    as_role(cur, 'authenticated', 'Team@Example.com')
    cur.execute('select public.is_admin()'); ok(cur.fetchone()[0] is True, 'admin recognised (email case-insensitive)')
    cur.execute('select count(*) from public.questions'); ok(cur.fetchone()[0] == 10, 'admin sees drafts')
    cur.execute('select id, status from public.submissions'); rows = cur.fetchall(); ok(len(rows) == 2 and all(r[1] == 'pending' for r in rows), 'admin reads the queue (2 pending rows)')
    cur.execute('select district_id from public.submissions where id = %s', (good['id'],)); ok(cur.fetchone()[0] == 'TH7108', 'admin sees the district the player picked')
    cur.execute("select count(*) from storage.objects where bucket_id = 'submissions'"); ok(cur.fetchone()[0] == 1, 'admin can read queued files (signed URLs)')
    f, n = fails(conn, "update public.submissions set status = 'approved', reviewed_by = 'team', reviewed_at = now(), public_url = 'https://x/player/a.jpg' where id = %s", (good['id'],)); ok(not f and n == 1, 'admin approves a photo')
    f, info = fails(conn, "insert into storage.objects (bucket_id, name) values ('question-images', 'player/a.jpg')"); ok(not f, 'admin copies into question-images')
    f, info = fails(conn, "update public.questions set status = 'published' where id = 'q-travel-0001'"); ok(f and 'questions_published_verified' in info, 'unverified question cannot be published (' + info[:70] + ')')
    q = "update public.questions set status = 'published', verified_by = 'team@example.com', verified_at = now(), data = jsonb_set(data, '{verified_by}', '\"team@example.com\"') where id = 'q-travel-0001'"
    f, n = fails(conn, q); ok(not f and n == 1, 'verified question published')
    cur.execute("select data->>'published_at', data->>'status' from public.questions where id = 'q-travel-0001'"); pa, st = cur.fetchone()
    ok(pa is not None and st == 'published', 'server stamps published_at (' + str(pa) + ')')
    conn.commit()
    cur.execute("update public.questions set data = jsonb_set(data, '{topic}', '\"ขนมหม้อแกงเมืองเพชร\"') where id = 'q-travel-0001'")
    cur.execute("select data->>'published_at' from public.questions where id = 'q-travel-0001'"); ok(cur.fetchone()[0] == pa, 'editing a live question keeps its published_at')
    conn.commit()
    as_role(cur, 'anon')
    cur.execute('select id from public.questions'); ok(cur.fetchall() == [('q-travel-0001',)], 'anon now sees exactly the published question')
    conn.commit()
    as_role(cur, 'authenticated', 'team@example.com')
    cur.execute("update public.questions set status = 'archived' where id = 'q-travel-0001'")
    cur.execute("select data->>'published_at', data->>'status' from public.questions where id = 'q-travel-0001'"); ok(cur.fetchone() == (None, 'archived'), 'archiving clears published_at')
    f, n = fails(conn, "update public.provinces set verified = true, data = jsonb_set(data, '{verified}', 'true') where id = 'nan'"); ok(not f and n == 1, 'admin edits a province')
    f, info = fails(conn, "update public.provinces set data = jsonb_set(data, '{id}', '\"xx\"') where id = 'nan'"); ok(f, 'province data id must match row id')
    f, n = fails(conn, "delete from public.submissions where id = %s", (good['id'],)); ok(not f and n == 1, 'admin deletes a submission')
    f, n = fails(conn, "delete from storage.objects where bucket_id = 'submissions'"); ok(not f and n == 1, 'admin deletes the queued file')
    conn.commit()

    print('daily cap (anti-spam)')
    cur.execute('reset role')
    cur.execute("insert into public.submissions (id, image_path, province_id, title, consent_owner, consent_license, consent_people) select g, 'pending/' || g::text || '.jpg', 'nan', 'spam', true, true, true from (select gen_random_uuid() g from generate_series(1, 300)) s")
    cur.execute("insert into storage.objects (bucket_id, name) select 'submissions', 'pending/' || gen_random_uuid()::text || '.jpg' from generate_series(1, 300)")
    conn.commit()
    as_role(cur, 'anon')
    f, info = insert_sub(conn, sub_row()); ok(f, 'row #301 within 24 h refused')
    f, info = fails(conn, "insert into storage.objects (bucket_id, name) values ('submissions', 'pending/z.jpg')"); ok(f, 'upload #301 within 24 h refused')
    conn.rollback()
    print('SQL TESTS PASSED (%d checks)' % ok_count)

main()
