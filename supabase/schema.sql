-- ออลไทย · โครงสร้างฐานข้อมูลบน Supabase
-- วิธีใช้: Supabase → SQL Editor → วางทั้งไฟล์ → Run (รันซ้ำได้ ไม่ลบข้อมูล)
--
-- ใครทำอะไรได้
--   เว็บเล่นเกม (ไม่ล็อกอิน, anon key)  อ่านคำถามที่ "เผยแพร่" + ป้ายจังหวัด, ส่งภาพเข้าคิวรอตรวจ
--   เว็บใส่ข้อมูล (ล็อกอิน + อีเมลอยู่ในตาราง admins)  อ่าน/แก้ทุกอย่าง, ตรวจภาพ, เผยแพร่คำถาม
--   ผู้เล่นอ่านคิวภาพหรือข้อมูลผู้ส่งไม่ได้ และภาพในคิวอยู่ใน bucket ส่วนตัว

-- ---------------------------------------------------------------- 1. ทีมงาน
create table if not exists public.admins (
  email      text primary key check (email = lower(email)),
  note       text,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
-- ไม่มี policy: อ่านหรือเขียนตารางนี้ผ่าน API ไม่ได้ เพิ่มอีเมลได้ทาง SQL Editor เท่านั้น (ขั้นที่ 3 ใน README)

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins a where a.email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;   -- เว็บใส่ข้อมูลถามหลังล็อกอิน ผู้เล่นไม่ต้องใช้
revoke execute on function public.is_admin() from anon;

-- ---------------------------------------------------------------- 2. ป้ายจังหวัด (คะแนนส่วน A)
create table if not exists public.provinces (
  id         text primary key,
  data       jsonb not null,
  verified   boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint provinces_data_id check (data ->> 'id' = id)
);

-- ---------------------------------------------------------------- 3. คำถาม
create table if not exists public.questions (
  id          text primary key check (id ~ '^q-[a-z]+-[0-9]{4,}$'),
  category    text not null check (category in ('อาหาร', 'กีฬา', 'เทศกาลและวัฒนธรรม', 'สถานที่ท่องเที่ยว')),
  status      text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  data        jsonb not null,
  verified_by text,
  verified_at timestamptz,
  updated_at  timestamptz not null default now(),
  constraint questions_data_id check (data ->> 'id' = id),
  -- กฎจาก handoff: ห้ามเผยแพร่ข้อมูลที่ยังไม่ได้ตรวจ
  constraint questions_published_verified check (status <> 'published' or verified_by is not null)
);

-- เวลาแก้ล่าสุด + เวลาเผยแพร่ใช้นาฬิกาเซิร์ฟเวอร์
-- (ข้อที่เผยแพร่วันนี้เข้ารอบรายวันตั้งแต่พรุ่งนี้ ชุดของวันนี้จึงไม่เปลี่ยนกลางวัน)
create or replace function public.questions_before_write() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if new.status = 'published' then
    if tg_op = 'INSERT' or old.status <> 'published' then
      new.data := jsonb_set(new.data, '{published_at}', to_jsonb(now()));
    else
      new.data := jsonb_set(new.data, '{published_at}', coalesce(old.data -> 'published_at', 'null'::jsonb));
    end if;
  else
    new.data := jsonb_set(new.data, '{published_at}', 'null'::jsonb);
  end if;
  new.data := jsonb_set(new.data, '{status}', to_jsonb(new.status));
  return new;
end $$;
drop trigger if exists questions_before_write on public.questions;
create trigger questions_before_write before insert or update on public.questions
  for each row execute function public.questions_before_write();

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists provinces_touch on public.provinces;
create trigger provinces_touch before insert or update on public.provinces
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- 4. ภาพจากผู้เล่น (คิวรอตรวจ)
create table if not exists public.submissions (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  image_path      text not null,
  province_id     text not null check (province_id ~ '^[a-z-]+$'),
  category        text check (category is null or category in ('อาหาร', 'กีฬา', 'เทศกาลและวัฒนธรรม', 'สถานที่ท่องเที่ยว')),
  title           text not null check (char_length(title) between 1 and 120),
  description     text check (char_length(description) <= 600),
  taken_at        text check (char_length(taken_at) <= 60),
  credit_name     text check (char_length(credit_name) <= 60),
  contact         text check (char_length(contact) <= 120),
  license         text not null default 'allthai-nonexclusive-v1',
  consent_owner   boolean not null,
  consent_license boolean not null,
  consent_people  boolean not null,
  review_note     text,
  reviewed_at     timestamptz,
  reviewed_by     text,
  public_url      text,
  -- แถวต้องชี้ไปที่ไฟล์ของตัวเองเท่านั้น
  constraint submissions_image_path check (image_path = 'pending/' || id::text || '.jpg')
);
create index if not exists submissions_status_created on public.submissions (status, created_at desc);

-- กันสแปม: รับภาพใหม่ได้ไม่เกิน 300 ภาพต่อ 24 ชั่วโมง (รวมทุกคน) ปรับตัวเลขได้ใน policy ด้านล่าง
-- ตัวนับอยู่ใน schema "private" ซึ่งไม่เปิดผ่าน API ใช้ได้เฉพาะใน policy
create schema if not exists private;
grant usage on schema private to anon, authenticated;
create or replace function private.recent_submission_count() returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.submissions where created_at > now() - interval '1 day';
$$;
create or replace function private.recent_upload_count() returns integer
language sql stable security definer set search_path = public, storage as $$
  select count(*)::int from storage.objects where bucket_id = 'submissions' and created_at > now() - interval '1 day';
$$;
revoke all on function private.recent_submission_count() from public;
revoke all on function private.recent_upload_count() from public;
grant execute on function private.recent_submission_count() to anon, authenticated;
grant execute on function private.recent_upload_count() to anon, authenticated;
drop function if exists public.recent_submission_count();
drop function if exists public.recent_upload_count();

-- ---------------------------------------------------------------- 5. สิทธิ์ (Row Level Security)
alter table public.provinces   enable row level security;
alter table public.questions   enable row level security;
alter table public.submissions enable row level security;

drop policy if exists "provinces: everyone reads" on public.provinces;
create policy "provinces: everyone reads" on public.provinces
  for select to anon, authenticated using (true);
drop policy if exists "provinces: admins manage" on public.provinces;
create policy "provinces: admins manage" on public.provinces
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "questions: everyone reads published" on public.questions;
create policy "questions: everyone reads published" on public.questions
  for select to anon, authenticated using (status = 'published');
drop policy if exists "questions: admins manage" on public.questions;
create policy "questions: admins manage" on public.questions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "submissions: anyone sends a pending photo" on public.submissions;
create policy "submissions: anyone sends a pending photo" on public.submissions
  for insert to anon, authenticated
  with check (
    status = 'pending'
    and consent_owner and consent_license and consent_people
    and license = 'allthai-nonexclusive-v1'
    and review_note is null and reviewed_at is null and reviewed_by is null and public_url is null
    and created_at between now() - interval '1 minute' and now() + interval '1 minute'
    and private.recent_submission_count() < 300
  );
drop policy if exists "submissions: admins manage" on public.submissions;
create policy "submissions: admins manage" on public.submissions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------- 6. ที่เก็บไฟล์ภาพ (Storage)
-- submissions      ส่วนตัว: ภาพที่ผู้เล่นส่ง (JPEG ไม่เกิน 3 MB, เว็บย่อให้ก่อนส่ง)
-- question-images  สาธารณะ: ภาพที่ผ่านการตรวจหรือทีมอัปโหลดเพื่อใช้ในคำถาม
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('submissions', 'submissions', false, 3145728, array['image/jpeg']),
  ('question-images', 'question-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "allthai: players upload pending photos" on storage.objects;
create policy "allthai: players upload pending photos" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'submissions' and (storage.foldername(name))[1] = 'pending' and private.recent_upload_count() < 300);
drop policy if exists "allthai: admins manage submitted photos" on storage.objects;
create policy "allthai: admins manage submitted photos" on storage.objects
  for all to authenticated
  using (bucket_id = 'submissions' and public.is_admin()) with check (bucket_id = 'submissions' and public.is_admin());
drop policy if exists "allthai: admins manage question images" on storage.objects;
create policy "allthai: admins manage question images" on storage.objects
  for all to authenticated
  using (bucket_id = 'question-images' and public.is_admin()) with check (bucket_id = 'question-images' and public.is_admin());

-- ---------------------------------------------------------------- 7. เพิ่มอีเมลทีมงาน (แก้อีเมลแล้วรันบรรทัดนี้แยก)
-- insert into public.admins (email) values ('your-email@example.com') on conflict do nothing;
