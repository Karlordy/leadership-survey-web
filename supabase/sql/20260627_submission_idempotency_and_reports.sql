-- Run once in Supabase SQL Editor before or together with the new submit-survey function.
-- Purpose:
-- 1) make survey submission retries idempotent under weak network
-- 2) keep question/version metadata for future audits

alter table public.submissions
  add column if not exists submission_key text,
  add column if not exists answers_hash text,
  add column if not exists questions_version text,
  add column if not exists scale_step numeric;

create unique index if not exists submissions_submission_key_uidx
  on public.submissions (submission_key)
  where submission_key is not null;

create index if not exists submissions_company_answers_hash_idx
  on public.submissions (company, answers_hash)
  where answers_hash is not null;

