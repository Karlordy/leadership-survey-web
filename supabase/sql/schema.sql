-- 1) 在 Supabase -> SQL Editor 执行
-- 2) 本方案：前端不直连表；只调用 Edge Function（由服务端用 service_role 写入）
-- 3) 因为用户在中国，建议部署前端到 Cloudflare（海外）时注意访问；Supabase 本身可能也需评估可达性。

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  name text not null,
  company text not null,

  answers_raw jsonb not null,

  -- 后台生成
  answers_adjusted jsonb not null,
  subscores jsonb not null,
  dimscores jsonb not null,
  focus_low3 jsonb not null,
  focus_high2 jsonb not null,
  insight_text text not null
);

create index if not exists submissions_name_company_idx on public.submissions (name, company);

alter table public.submissions enable row level security;

-- 不创建 anon 的 insert/select policy（默认全部拒绝）
-- 你作为管理员，可在 Supabase Dashboard 里查看/导出。
