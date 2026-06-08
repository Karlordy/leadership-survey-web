// Supabase Edge Function: submit-survey
// 功能：
// 1) 校验同一「姓名+公司」最多提交 2 次
// 2) 后台计算：反向计分、21子项、7维度、能力最低3、模式最高2、解读文本
// 3) 写入 public.submissions
//
// 部署：supabase functions deploy submit-survey
// Secrets（任一套均可）：
// - PROJECT_URL + SERVICE_ROLE_KEY（推荐）
// - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY（兼容）

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// ===== CORS（统一配置）=====
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

// ===== 题库结构 =====
type Question = {
  id: number;
  dimension: string;
  subitem: string;
  text: string;
  reverse: boolean;
};

type Subitem = { dimension: string; subitem: string };

// ===== 题库（内嵌，不再读取文件，避免 path not found）=====
const QUESTION_BANK = {
  scale: {
    min: 1,
    max: 5,
    step: 0.5, // ✅ 新增：支持 0.5 步长
    labels: ["非常不同意", "不同意", "一般", "同意", "非常同意"],
  },
  dimensions: ["成就导向", "系统意识", "自我觉察", "协同赋能", "顺从", "防御", "控制"],
  subitems: [
    { dimension: "成就导向", subitem: "使命愿景" },
    { dimension: "成就导向", subitem: "战略关注" },
    { dimension: "成就导向", subitem: "取得成果" },
    { dimension: "系统意识", subitem: "系统思考" },
    { dimension: "系统意识", subitem: "平衡" },
    { dimension: "系统意识", subitem: "持续产出" },
    { dimension: "自我觉察", subitem: "反思自省" },
    { dimension: "自我觉察", subitem: "学习者" },
    { dimension: "自我觉察", subitem: "沉着" },
    { dimension: "协同赋能", subitem: "关爱" },
    { dimension: "协同赋能", subitem: "培育" },
    { dimension: "协同赋能", subitem: "团队合作" },
    { dimension: "顺从", subitem: "取悦" },
    { dimension: "顺从", subitem: "被动" },
    { dimension: "顺从", subitem: "保守" },
    { dimension: "防御", subitem: "傲慢" },
    { dimension: "防御", subitem: "距离感" },
    { dimension: "防御", subitem: "挑剔" },
    { dimension: "控制", subitem: "完美" },
    { dimension: "控制", subitem: "专制" },
    { dimension: "控制", subitem: "工作狂" },
  ],
  questions: [
    { id: 1, dimension: "成就导向", subitem: "使命愿景", text: "我对组织或事业未来3–5年的发展方向有清晰判断", reverse: false },
    { id: 2, dimension: "成就导向", subitem: "使命愿景", text: "我的决策通常能与长期使命保持一致", reverse: false },
    { id: 3, dimension: "成就导向", subitem: "使命愿景", text: "我很少从长期视角思考自己正在做的事情", reverse: true },
    { id: 4, dimension: "成就导向", subitem: "战略关注", text: "我能在复杂事务中迅速识别最关键的问题", reverse: false },
    { id: 5, dimension: "成就导向", subitem: "战略关注", text: "我会主动放弃低价值事项以集中资源", reverse: false },
    { id: 6, dimension: "成就导向", subitem: "战略关注", text: "我的精力常被大量琐碎事务分散", reverse: true },
    { id: 7, dimension: "成就导向", subitem: "取得成果", text: "我负责的关键目标通常能如期或超额完成", reverse: false },
    { id: 8, dimension: "成就导向", subitem: "取得成果", text: "我能持续把想法转化为可衡量的成果", reverse: false },
    { id: 9, dimension: "成就导向", subitem: "取得成果", text: "我更关注投入和努力，而不是最终结果", reverse: true },

    { id: 10, dimension: "系统意识", subitem: "系统思考", text: "我在决策时会考虑不同因素之间的相互影响", reverse: false },
    { id: 11, dimension: "系统意识", subitem: "系统思考", text: "我能看到问题背后的结构性原因", reverse: false },
    { id: 12, dimension: "系统意识", subitem: "系统思考", text: "我更习惯解决表面问题而非系统问题", reverse: true },
    { id: 13, dimension: "系统意识", subitem: "平衡", text: "我能在短期收益与长期发展之间做出权衡", reverse: false },
    { id: 14, dimension: "系统意识", subitem: "平衡", text: "我会同时关注绩效、人才和组织健康", reverse: false },
    { id: 15, dimension: "系统意识", subitem: "平衡", text: "我在决策时常偏向单一目标而忽视整体", reverse: true },
    { id: 16, dimension: "系统意识", subitem: "持续产出", text: "我的决策通常能带来可持续的成果", reverse: false },
    { id: 17, dimension: "系统意识", subitem: "持续产出", text: "我更关注机制建设而不仅是一次性成功", reverse: false },
    { id: 18, dimension: "系统意识", subitem: "持续产出", text: "我的成果往往依赖个人投入而难以持续", reverse: true },

    { id: 19, dimension: "自我觉察", subitem: "反思自省", text: "我会定期复盘自己的决策和行为", reverse: false },
    { id: 20, dimension: "自我觉察", subitem: "反思自省", text: "出现问题时，我会优先反思自身责任", reverse: false },
    { id: 21, dimension: "自我觉察", subitem: "反思自省", text: "我很少系统反思自己的决策过程", reverse: true },
    { id: 22, dimension: "自我觉察", subitem: "学习者", text: "我持续主动学习新的认知或方法", reverse: false },
    { id: 23, dimension: "自我觉察", subitem: "学习者", text: "我愿意修正原有观点以适应新变化", reverse: false },
    { id: 24, dimension: "自我觉察", subitem: "学习者", text: "我更依赖过去经验而非持续学习", reverse: true },
    { id: 25, dimension: "自我觉察", subitem: "沉着", text: "在压力情境下，我能保持冷静和理性", reverse: false },
    { id: 26, dimension: "自我觉察", subitem: "沉着", text: "面对不确定性，我仍能稳定做出判断", reverse: false },
    { id: 27, dimension: "自我觉察", subitem: "沉着", text: "情绪波动常影响我的决策质量", reverse: true },

    { id: 28, dimension: "协同赋能", subitem: "关爱", text: "我真正在意团队成员的状态与感受", reverse: false },
    { id: 29, dimension: "协同赋能", subitem: "关爱", text: "我愿意花时间理解他人的困难", reverse: false },
    { id: 30, dimension: "协同赋能", subitem: "关爱", text: "我更关注事情而非人的感受", reverse: true },
    { id: 31, dimension: "协同赋能", subitem: "培育", text: "我会有意识地培养团队成员的能力", reverse: false },
    { id: 32, dimension: "协同赋能", subitem: "培育", text: "我给予建设性反馈帮助他人成长", reverse: false },
    { id: 33, dimension: "协同赋能", subitem: "培育", text: "我更关注短期产出而非他人成长", reverse: true },
    { id: 34, dimension: "协同赋能", subitem: "团队合作", text: "我能促进不同角色之间的有效协作", reverse: false },
    { id: 35, dimension: "协同赋能", subitem: "团队合作", text: "我鼓励开放讨论而非单向指令", reverse: false },
    { id: 36, dimension: "协同赋能", subitem: "团队合作", text: "我更习惯单独决策而非团队协作", reverse: true },

    { id: 37, dimension: "顺从", subitem: "取悦", text: "我常为了不引发冲突而压抑真实想法", reverse: false },
    { id: 38, dimension: "顺从", subitem: "取悦", text: "我在意他人是否认可我的决定", reverse: false },
    { id: 39, dimension: "顺从", subitem: "取悦", text: "即便不被认同，我也能坚持自己的判断", reverse: true },
    { id: 40, dimension: "顺从", subitem: "被动", text: "在关键时刻，我倾向等待他人推动", reverse: false },
    { id: 41, dimension: "顺从", subitem: "被动", text: "我较少主动打破既有安排", reverse: false },
    { id: 42, dimension: "顺从", subitem: "被动", text: "我会主动为结果负责并推动进展", reverse: true },
    { id: 43, dimension: "顺从", subitem: "保守", text: "我更倾向维持现状而非尝试改变", reverse: false },
    { id: 44, dimension: "顺从", subitem: "保守", text: "我对不确定性保持谨慎甚至回避", reverse: false },
    { id: 45, dimension: "顺从", subitem: "保守", text: "我愿意承担必要风险以推动突破", reverse: true },

    { id: 46, dimension: "防御", subitem: "傲慢", text: "我较难接受他人对我的质疑", reverse: false },
    { id: 47, dimension: "防御", subitem: "傲慢", text: "我更相信自己的判断而忽略他人意见", reverse: false },
    { id: 48, dimension: "防御", subitem: "傲慢", text: "我能坦然承认并修正自己的错误", reverse: true },
    { id: 49, dimension: "防御", subitem: "距离感", text: "我习惯与他人保持心理距离", reverse: false },
    { id: 50, dimension: "防御", subitem: "距离感", text: "我不太愿意暴露真实想法或感受", reverse: false },
    { id: 51, dimension: "防御", subitem: "距离感", text: "我能与团队建立真诚而开放的关系", reverse: true },
    { id: 52, dimension: "防御", subitem: "挑剔", text: "我更容易看到他人的不足", reverse: false },
    { id: 53, dimension: "防御", subitem: "挑剔", text: "我在反馈中常以批评为主", reverse: false },
    { id: 54, dimension: "防御", subitem: "挑剔", text: "我能以鼓励方式促进他人改进", reverse: true },

    { id: 55, dimension: "控制", subitem: "完美", text: "我很难接受事情“不够完美”", reverse: false },
    { id: 56, dimension: "控制", subitem: "完美", text: "我对细节的要求常超出必要程度", reverse: false },
    { id: 57, dimension: "控制", subitem: "完美", text: "我能接受“足够好”而非完美", reverse: true },
    { id: 58, dimension: "控制", subitem: "专制", text: "我更相信指令而非授权", reverse: false },
    { id: 59, dimension: "控制", subitem: "专制", text: "我倾向由自己掌控关键决策", reverse: false },
    { id: 60, dimension: "控制", subitem: "专制", text: "我能放心让他人承担重要责任", reverse: true },
    { id: 61, dimension: "控制", subitem: "工作狂", text: "我常以牺牲休息来换取进度", reverse: false },
    { id: 62, dimension: "控制", subitem: "工作狂", text: "我的投入强度有时让他人感到压力", reverse: false },
    { id: 63, dimension: "控制", subitem: "工作狂", text: "我能在事业追求与身心状态之间保持平衡", reverse: true },
  ] as Question[],
};

const QUESTIONS: Question[] = QUESTION_BANK.questions;
const SUBITEMS: Subitem[] = QUESTION_BANK.subitems;
const DIMENSIONS: string[] = QUESTION_BANK.dimensions;

// ✅ 评分规则（支持 0.5 步长）
const SCALE_MIN = QUESTION_BANK.scale.min;
const SCALE_MAX = QUESTION_BANK.scale.max;
const SCALE_STEP = QUESTION_BANK.scale.step ?? 0.5;

// ===== 维度分组（能力/限制）=====
const abilityDims = new Set(["成就导向", "系统意识", "自我觉察", "协同赋能"]);
const modeDims = new Set(["顺从", "防御", "控制"]);

// ===== 工具函数 =====
function avg(arr: number[]) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function buildInsight(low3: any[], high2: any[]) {
  const lowNames = low3.map((x) => `${x.dim}-${x.sub}`).join("、");
  const highNames = high2.map((x) => `${x.dim}-${x.sub}`).join("、");
  return [
    `能力结构：最低3子项（能力天花板）= ${lowNames}`,
    `限制模式：最高2子项（压力触发点）= ${highNames}`,
    `建议：从能力最低3项里选1项做提升重点；从模式最高2项里选1项做管理重点（90天行动表）。`,
  ].join("\n");
}

// ✅ 校验：必须是 1~5 且 0.5 步长
function isValidScore(v: unknown): boolean {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return false;
  if (n < SCALE_MIN || n > SCALE_MAX) return false;
  const k = n / SCALE_STEP;
  return Math.abs(k - Math.round(k)) < 1e-9;
}

// ✅ 校验 answers_raw：只校验题库中出现的题（忽略多余字段）
function validateAnswers(answers_raw: Record<string, unknown>) {
  for (const q of QUESTIONS) {
    const raw = answers_raw[String(q.id)];
    if (!isValidScore(raw)) {
      throw new Error(`Invalid score for Q${q.id}`);
    }
  }
}

// ===== Supabase 写库（PostgREST）=====
async function supaCount(url: string, serviceKey: string, name: string, company: string) {

  const nameEnc = encodeURIComponent(name);
  const compEnc = encodeURIComponent(company);

  const endpoint =
    `${url.replace(/\/$/, "")}/rest/v1/submissions?select=id` +
    `&company=eq.${compEnc}` +
    `&or=(real_name.eq.${nameEnc},name.eq.${nameEnc})`;

  const resp = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      Prefer: "count=exact",
    },
  });

  if (!resp.ok) throw new Error(`count failed: ${resp.status}`);
  const cr = resp.headers.get("content-range"); // e.g. 0-0/12
  if (!cr) return 0;
  const total = parseInt(cr.split("/")[1] || "0", 10);
  return Number.isFinite(total) ? total : 0;
}

async function supaInsert(url: string, serviceKey: string, payload: any) {
  const endpoint = `${url.replace(/\/$/, "")}/rest/v1/submissions`;
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`insert failed: ${resp.status} ${t}`);
  }
}

// ===== 计算逻辑 =====
function compute(answers_raw: Record<string, unknown>) {
  // 1) adjusted answers（反向计分）
  const adjusted: Record<string, number> = {};
  for (const q of QUESTIONS) {
    const raw0 = answers_raw[String(q.id)];
    const raw = typeof raw0 === "number" ? raw0 : Number(raw0);
    if (!Number.isFinite(raw)) continue;

    // ✅ 通用反向：min+max-raw（兼容小数）
    adjusted[String(q.id)] = q.reverse ? ((SCALE_MIN + SCALE_MAX) - raw) : raw;
  }

  // 2) subScores（按子项算均分）
  const subscores: Array<{ dim: string; sub: string; score: number | null }> = [];
  for (const si of SUBITEMS) {
    const qids = QUESTIONS
      .filter((q) => q.dimension === si.dimension && q.subitem === si.subitem)
      .map((q) => String(q.id));

    const vals = qids
      .map((id) => adjusted[id])
      .filter((v) => typeof v === "number") as number[];

    const score = (qids.length > 0 && vals.length === qids.length) ? avg(vals) : null;
    subscores.push({ dim: si.dimension, sub: si.subitem, score });
  }

  // 3) dimScores（维度均分：由子项均分再均分）
  const dimscores: Record<string, number | null> = {};
  for (const dim of DIMENSIONS) {
    const vals = subscores
      .filter((s) => s.dim === dim && typeof s.score === "number")
      .map((s) => s.score as number);

    dimscores[dim] = vals.length > 0 ? avg(vals) : null;
  }

  // 4) focus：能力最低3 + 模式最高2
  const ability = subscores
    .filter((s) => abilityDims.has(s.dim) && typeof s.score === "number")
    .sort((a, b) => (a.score as number) - (b.score as number));

  const mode = subscores
    .filter((s) => modeDims.has(s.dim) && typeof s.score === "number")
    .sort((a, b) => (b.score as number) - (a.score as number));

  const focus_low3 = ability.slice(0, 3);
  const focus_high2 = mode.slice(0, 2);
  const insight_text = buildInsight(focus_low3, focus_high2);

  return { adjusted, subscores, dimscores, focus_low3, focus_high2, insight_text };
}

// ===== 主入口 =====
serve(async (req) => {
  // ✅ 预检请求：必须最先处理，并且永远返回 CORS headers
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return jsonRes({ error: "Method Not Allowed" }, 405);
    }

    const body = await req.json().catch(() => ({}));
    const realName = String(body?.real_name ?? body?.name ?? "").trim();
    const company = String(body?.company ?? body?.company_name ?? "").trim();

    const answers_raw = body?.answers_raw;

    if (!realName || !company) return jsonRes({ error: "缺少姓名或公司名" }, 400);
    if (!answers_raw || typeof answers_raw !== "object") return jsonRes({ error: "缺少答案" }, 400);

    // ✅ 新增：后端校验 1~5 且 0.5 步长（防止绕过前端提交）
    try {
      validateAnswers(answers_raw as Record<string, unknown>);
    } catch (e: any) {
      return jsonRes({ error: e?.message ?? "答案不合法" }, 400);
    }

    const url =
      Deno.env.get("PROJECT_URL") ??
      Deno.env.get("SUPABASE_URL") ??
      "";

    const serviceKey =
      Deno.env.get("SERVICE_ROLE_KEY") ??
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
      "";

    if (!url || !serviceKey) {
      return jsonRes({
        error: "服务未配置（缺少环境变量）",
        debug: {
          hasProjectUrl: !!Deno.env.get("PROJECT_URL"),
          hasSupabaseUrl: !!Deno.env.get("SUPABASE_URL"),
          hasServiceRoleKey: !!Deno.env.get("SERVICE_ROLE_KEY"),
          hasSupabaseServiceRoleKey: !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
        },
      }, 500);
    }

    // 同名+公司最多2次
    const count = await supaCount(url, serviceKey, realName, company);
    if (count >= 2) {
      return jsonRes({ error: "该姓名+公司已提交2次，无法再次提交。请联系教练。" }, 403);
    }

    // 后台计算
    const computed = compute(answers_raw as Record<string, unknown>);

  const payload = {
    // ✅ 同时写两份，兼容数据库约束/旧字段
    real_name: realName,
    name: realName,
    company,

    answers_raw,
    answers_adjusted: computed.adjusted,
    subscores: computed.subscores,
    dimscores: computed.dimscores,
    focus_low3: computed.focus_low3,
    focus_high2: computed.focus_high2,
    insight_text: computed.insight_text,
  };


    await supaInsert(url, serviceKey, payload);
    return jsonRes({ ok: true });
  } catch (e: any) {
    return jsonRes({ error: "提交失败：" + (e?.message ?? String(e)) }, 500);
  }
});
