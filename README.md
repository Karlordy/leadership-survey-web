# yuanzhuo-leadership-survey

圆桌经营会领导力测评学员端。

当前项目是静态前端 + Supabase Edge Function：

- `frontend/`: 学员填写问卷的静态页面。
- `supabase/functions/submit-survey/`: 提交问卷、校验次数、计算分数并写入 `submissions`。
- `supabase/functions/generate-report/`: 旧版 Supabase 报告函数，当前主要报告链路已经迁移到 `yuanzhuo-report-api`。
- `supabase/sql/schema.sql`: `submissions` 表结构。

## Current State

当前问卷仍是旧版 63 题 / 21 子项结构。后续目标是升级为：

- 7 个大维度
- 32 个小维度
- 每个小维度 3 题
- 共 96 题

升级时需要同步修改：

- `frontend/questions.json`
- `supabase/functions/submit-survey/index.ts`
- `supabase/functions/submit-survey/questions.json`
- 管理端读取字段与报告生成链路

## Frontend Deploy

部署 `frontend/` 目录到静态站点。

部署前需要提供真实配置文件：

```powershell
copy frontend\config.example.js frontend\config.js
```

然后编辑 `frontend/config.js`：

```js
window.SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co";
window.SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";
window.SUPABASE_FUNCTION_NAME = "submit-survey";
```

`frontend/config.js` 是环境配置文件，不提交到 Git。

## Supabase Deploy

建表：

```bash
supabase db push
```

或在 Supabase SQL Editor 执行：

```txt
supabase/sql/schema.sql
```

部署提交函数：

```bash
cd supabase
supabase login
supabase link --project-ref <project_ref>
supabase secrets set SUPABASE_URL=<project_url>
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service_role_key>
supabase functions deploy submit-survey
```

不要把 `SUPABASE_SERVICE_ROLE_KEY` 放进前端或 GitHub。

## Local Test

直接打开或部署静态文件：

```txt
frontend/index.html
frontend/survey.html
frontend/done.html
```

确保 `frontend/questions.json` 和 `frontend/config.js` 与页面同目录可访问。

## GitHub Safety Rules

- 仓库建议设为 private。
- 不提交 `frontend/config.js`、`.env`、payload、日志、Supabase `.temp`。
- service role key 只放在 Supabase secrets 中。
