-- RLS 策略 + Supabase Auth 接入  (Issue MAO-2)
-- 在 Prisma 迁移建表之后应用本文件：
--   psql "$DIRECT_DATABASE_URL" -f supabase/rls.sql
--   （或 npm run db:rls；本地 supabase 见 docs/DATA-MODEL.md §5）
-- 任何 Prisma 迁移若重建这些表，需重新应用本文件（RLS policy 不由 Prisma 管）。
--
-- 隔离两层（均在 DB 层强制，QA 可在数据库层直接验证）：
--   账号级：A 看不到 B 的任何行            -> account_id = auth.uid()
--   档案级：plan/version 的 account_id 必须等于其引用的 profile/plan 的 account_id
--           -> WITH CHECK 里用相关子查询比对；子查询受 RLS 约束，
--              若 profile_id 指向“别人账号的档案”，子查询返回 NULL -> 拒绝（防串档）。

-- ============ 1. 注册触发器：auth.users → accounts ============
-- 新用户注册时自动建 Account 行（id = auth.uid()），前端无需手动插。
-- security definer：以表 owner 身份运行，绕过 accounts 的 RLS，使注册时的自动插入成功。
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- 显式带 created_at/updated_at：Prisma 的 @updatedAt 在 DB 层不生成默认值，
  -- 原始插入（如本触发器）不填会触发 NOT NULL 违约。
  insert into public.accounts (id, email, created_at, updated_at)
  values (new.id, new.email, now(), now());
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

-- ============ 3. accounts：只能读写自己的账号行 ============
-- 行由注册触发器(security definer)创建，用户无需 INSERT 权限。
create policy "accounts_self_select" on public.accounts
  for select using (id = auth.uid());
create policy "accounts_self_update" on public.accounts
  for update using (id = auth.uid()) with check (id = auth.uid());

-- ============ 4. profiles / plans / plan_versions：账号级 + 档案级，单策略 AND ============
-- 单条 FOR ALL 策略，WITH CHECK = (账号级) AND (档案级归属一致)，避免多 permissive 策略被 OR。
-- profile_id / plan_id 子查询受 RLS 约束：指向别人账号的档案/方案时返回 NULL -> 整体非真 -> 拒绝。

-- profiles：仅账号级（profiles 不引用别的档案）
create policy "profiles_owner_all" on public.profiles
  for all
  using (account_id = auth.uid())
  with check (account_id = auth.uid());

-- plans：账号级 + 档案级（account_id 必须等于 profile_id 指向档案的 account_id）
create policy "plans_owner_all" on public.plans
  for all
  using (account_id = auth.uid())
  with check (
    account_id = auth.uid()
    and account_id = (select p.account_id from public.profiles p where p.id = plans.profile_id)
  );

-- plan_versions：账号级 + 档案级（account_id 必须等于 plan_id 指向方案的 account_id）
create policy "versions_owner_all" on public.plan_versions
  for all
  using (account_id = auth.uid())
  with check (
    account_id = auth.uid()
    and account_id = (select pl.account_id from public.plans pl where pl.id = plan_versions.plan_id)
  );

-- ============ 5. 应用层职责（仍需做，但不再是唯一防线）============
-- 规划人员账号下可见其全部档案（这是“管多个客户”的需求）。
-- “当前正在为哪个档案做规划”是请求级上下文：每个请求带 profile_id（= AI工程师 的 profile_id 参数），
-- 应用层据此过滤 plans/versions 列表。即使应用层传错 account_id/profile_id 组合，DB 也拒绝串档写入，
-- 数据不会落到别的账号。账号间不可见由 §3/§4 的 RLS 强制。
