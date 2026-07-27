-- RLS 策略 + Supabase Auth 接入  (Issue MAO-2)
-- 在 Prisma 迁移建表之后应用本文件（psql $DATABASE_URL -f supabase/rls.sql，或作为 Supabase migration）。
-- 任何 Prisma 迁移若重建这些表，需重新应用本文件。

-- ============ 1. 注册触发器：auth.users → accounts ============
-- 新用户注册时自动建 Account 行（id = auth.uid()），前端无需再手动插。
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.accounts (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ 2. 开启 RLS ============
alter table public.accounts      enable row level security;
alter table public.profiles      enable row level security;
alter table public.plans         enable row level security;
alter table public.plan_versions enable row level security;

-- ============ 3. 账号级隔离：account_id = auth.uid() ============
-- accounts：用户只能读写自己的账号行
create policy "accounts_self_select" on public.accounts
  for select using (id = auth.uid());
create policy "accounts_self_update" on public.accounts
  for update using (id = auth.uid()) with check (id = auth.uid());

-- profiles：只能访问自己账号下的考生档案
create policy "profiles_owner_all" on public.profiles
  for all
  using (account_id = auth.uid())
  with check (account_id = auth.uid());

-- plans：只能访问自己账号下的方案（account_id 冗余字段，免 join）
create policy "plans_owner_all" on public.plans
  for all
  using (account_id = auth.uid())
  with check (account_id = auth.uid());

-- plan_versions：只能访问自己账号下的版本
create policy "versions_owner_all" on public.plan_versions
  for all
  using (account_id = auth.uid())
  with check (account_id = auth.uid());

-- ============ 4. 说明：档案级"不串"由应用层保证 ============
-- 同一规划人员账号下可见其全部档案（这是"管多个客户"的需求）。
-- "做 X 档案时不串进 Y" 是请求级上下文：每个请求带 profile_id（= AI工程师 的"档案上下文"参数），
-- 应用层校验 profile_id 属于当前账号后，再以此 profile_id 过滤 plans/versions。
-- 账号间隔离由上方 RLS 强制（A 看不到 B 的任何数据）。
