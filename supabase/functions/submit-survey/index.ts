// Supabase Edge Function: submit-survey
// 功能：
// 1) 校验同一「姓名+公司」最多提交 2 次
// 2) 后台计算：96题、32子项、7维度、能力最低3、限制最高3、解读文本
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
  code?: string;
  dimension: string;
  subitem: string;
  text: string;
  reverse: boolean;
};

type Subitem = {
  dimension: string;
  subitem: string;
  hemisphere?: string;
  interpretation?: string;
};

type QuestionBank = {
  model_version?: string;
  scale: {
    min: number;
    max: number;
    step?: number;
    labels: string[];
  };
  dimensions: string[];
  subitems: Subitem[];
  questions: Question[];
};

// ===== 题库（96题 / 32子项，内嵌以避免 Edge Function 运行时读文件失败）=====
const QUESTION_BANK: QuestionBank = {
  "model_version": "2026-06-08.32-subdimensions.v1",
  "scale": {
    "min": 1,
    "max": 5,
    "step": 0.5,
    "labels": [
      "非常不同意",
      "不同意",
      "一般",
      "同意",
      "非常同意"
    ]
  },
  "dimensions": [
    "成就导向",
    "系统意识",
    "自我觉察",
    "协同赋能",
    "控制",
    "防御",
    "顺从"
  ],
  "subitems": [
    {
      "dimension": "成就导向",
      "subitem": "决断力",
      "hemisphere": "top",
      "interpretation": "ability"
    },
    {
      "dimension": "成就导向",
      "subitem": "领导效能",
      "hemisphere": "top",
      "interpretation": "ability"
    },
    {
      "dimension": "成就导向",
      "subitem": "取得成果",
      "hemisphere": "top",
      "interpretation": "ability"
    },
    {
      "dimension": "成就导向",
      "subitem": "使命愿景",
      "hemisphere": "top",
      "interpretation": "ability"
    },
    {
      "dimension": "成就导向",
      "subitem": "战略关注",
      "hemisphere": "top",
      "interpretation": "ability"
    },
    {
      "dimension": "系统意识",
      "subitem": "持续性产出",
      "hemisphere": "top",
      "interpretation": "ability"
    },
    {
      "dimension": "系统意识",
      "subitem": "关心社会",
      "hemisphere": "top",
      "interpretation": "ability"
    },
    {
      "dimension": "系统意识",
      "subitem": "平衡",
      "hemisphere": "top",
      "interpretation": "ability"
    },
    {
      "dimension": "系统意识",
      "subitem": "系统思考",
      "hemisphere": "top",
      "interpretation": "ability"
    },
    {
      "dimension": "系统意识",
      "subitem": "资源统筹",
      "hemisphere": "top",
      "interpretation": "ability"
    },
    {
      "dimension": "自我觉察",
      "subitem": "沉着",
      "hemisphere": "top",
      "interpretation": "ability"
    },
    {
      "dimension": "自我觉察",
      "subitem": "反思自省",
      "hemisphere": "top",
      "interpretation": "ability"
    },
    {
      "dimension": "自我觉察",
      "subitem": "无私领导",
      "hemisphere": "top",
      "interpretation": "ability"
    },
    {
      "dimension": "自我觉察",
      "subitem": "学习者",
      "hemisphere": "top",
      "interpretation": "ability"
    },
    {
      "dimension": "自我觉察",
      "subitem": "正直真实",
      "hemisphere": "top",
      "interpretation": "ability"
    },
    {
      "dimension": "协同赋能",
      "subitem": "关爱",
      "hemisphere": "top",
      "interpretation": "ability"
    },
    {
      "dimension": "协同赋能",
      "subitem": "团队合作",
      "hemisphere": "top",
      "interpretation": "ability"
    },
    {
      "dimension": "协同赋能",
      "subitem": "培育",
      "hemisphere": "top",
      "interpretation": "ability"
    },
    {
      "dimension": "协同赋能",
      "subitem": "人际交往",
      "hemisphere": "top",
      "interpretation": "ability"
    },
    {
      "dimension": "协同赋能",
      "subitem": "协作者",
      "hemisphere": "top",
      "interpretation": "ability"
    },
    {
      "dimension": "控制",
      "subitem": "工作狂",
      "hemisphere": "bottom",
      "interpretation": "limit"
    },
    {
      "dimension": "控制",
      "subitem": "完美",
      "hemisphere": "bottom",
      "interpretation": "limit"
    },
    {
      "dimension": "控制",
      "subitem": "野心",
      "hemisphere": "bottom",
      "interpretation": "limit"
    },
    {
      "dimension": "控制",
      "subitem": "专制",
      "hemisphere": "bottom",
      "interpretation": "limit"
    },
    {
      "dimension": "防御",
      "subitem": "傲慢",
      "hemisphere": "bottom",
      "interpretation": "limit"
    },
    {
      "dimension": "防御",
      "subitem": "距离感",
      "hemisphere": "bottom",
      "interpretation": "limit"
    },
    {
      "dimension": "防御",
      "subitem": "挑剔",
      "hemisphere": "bottom",
      "interpretation": "limit"
    },
    {
      "dimension": "防御",
      "subitem": "自我辩护",
      "hemisphere": "bottom",
      "interpretation": "limit"
    },
    {
      "dimension": "顺从",
      "subitem": "保守",
      "hemisphere": "bottom",
      "interpretation": "limit"
    },
    {
      "dimension": "顺从",
      "subitem": "被动",
      "hemisphere": "bottom",
      "interpretation": "limit"
    },
    {
      "dimension": "顺从",
      "subitem": "归属",
      "hemisphere": "bottom",
      "interpretation": "limit"
    },
    {
      "dimension": "顺从",
      "subitem": "取悦",
      "hemisphere": "bottom",
      "interpretation": "limit"
    }
  ],
  "questions": [
    {
      "id": 1,
      "code": "Q001",
      "dimension": "成就导向",
      "subitem": "决断力",
      "text": "面对复杂情况时，我能够在信息不完全的情况下做出必要决策。",
      "reverse": false
    },
    {
      "id": 2,
      "code": "Q002",
      "dimension": "成就导向",
      "subitem": "决断力",
      "text": "当团队犹豫不决时，我能帮助大家明确方向并推动行动。",
      "reverse": false
    },
    {
      "id": 3,
      "code": "Q003",
      "dimension": "成就导向",
      "subitem": "决断力",
      "text": "我不会因为担心出错而长期拖延关键决定。",
      "reverse": false
    },
    {
      "id": 4,
      "code": "Q004",
      "dimension": "成就导向",
      "subitem": "领导效能",
      "text": "我能通过清晰目标和有效管理，让团队持续产生成果。",
      "reverse": false
    },
    {
      "id": 5,
      "code": "Q005",
      "dimension": "成就导向",
      "subitem": "领导效能",
      "text": "我能根据不同成员的能力分配任务，而不是事事亲自处理。",
      "reverse": false
    },
    {
      "id": 6,
      "code": "Q006",
      "dimension": "成就导向",
      "subitem": "领导效能",
      "text": "我的管理方式能帮助团队提升效率，而不是只依赖个人努力。",
      "reverse": false
    },
    {
      "id": 7,
      "code": "Q007",
      "dimension": "成就导向",
      "subitem": "取得成果",
      "text": "我重视把目标转化为具体行动、责任人和完成时间。",
      "reverse": false
    },
    {
      "id": 8,
      "code": "Q008",
      "dimension": "成就导向",
      "subitem": "取得成果",
      "text": "我会持续跟进关键事项，确保结果真正落地。",
      "reverse": false
    },
    {
      "id": 9,
      "code": "Q009",
      "dimension": "成就导向",
      "subitem": "取得成果",
      "text": "当目标推进受阻时，我会主动寻找解决路径，而不是停留在抱怨。",
      "reverse": false
    },
    {
      "id": 10,
      "code": "Q010",
      "dimension": "成就导向",
      "subitem": "使命愿景",
      "text": "我能向团队清楚表达组织的方向和长期价值。",
      "reverse": false
    },
    {
      "id": 11,
      "code": "Q011",
      "dimension": "成就导向",
      "subitem": "使命愿景",
      "text": "我能让团队理解当前工作与更大目标之间的关系。",
      "reverse": false
    },
    {
      "id": 12,
      "code": "Q012",
      "dimension": "成就导向",
      "subitem": "使命愿景",
      "text": "我会用愿景和意义感帮助团队保持投入。",
      "reverse": false
    },
    {
      "id": 13,
      "code": "Q013",
      "dimension": "成就导向",
      "subitem": "战略关注",
      "text": "我能识别当前阶段最重要的事情，并主动做取舍。",
      "reverse": false
    },
    {
      "id": 14,
      "code": "Q014",
      "dimension": "成就导向",
      "subitem": "战略关注",
      "text": "我不会轻易被临时机会或外部噪音打乱优先级。",
      "reverse": false
    },
    {
      "id": 15,
      "code": "Q015",
      "dimension": "成就导向",
      "subitem": "战略关注",
      "text": "我能帮助团队聚焦关键目标，而不是同时做太多事情。",
      "reverse": false
    },
    {
      "id": 16,
      "code": "Q016",
      "dimension": "系统意识",
      "subitem": "持续性产出",
      "text": "我重视建立稳定机制，而不是只靠临时冲刺完成任务。",
      "reverse": false
    },
    {
      "id": 17,
      "code": "Q017",
      "dimension": "系统意识",
      "subitem": "持续性产出",
      "text": "我会关注团队是否能长期、稳定、可预期地产生成果。",
      "reverse": false
    },
    {
      "id": 18,
      "code": "Q018",
      "dimension": "系统意识",
      "subitem": "持续性产出",
      "text": "当成果不稳定时，我会优先检查流程和机制。",
      "reverse": false
    },
    {
      "id": 19,
      "code": "Q019",
      "dimension": "系统意识",
      "subitem": "关心社会",
      "text": "我会思考企业行为对客户、员工、行业或社会的长期影响。",
      "reverse": false
    },
    {
      "id": 20,
      "code": "Q020",
      "dimension": "系统意识",
      "subitem": "关心社会",
      "text": "在追求经营结果时，我也会关注组织责任和外部价值。",
      "reverse": false
    },
    {
      "id": 21,
      "code": "Q021",
      "dimension": "系统意识",
      "subitem": "关心社会",
      "text": "我希望企业不只是赚钱，也能创造积极影响。",
      "reverse": false
    },
    {
      "id": 22,
      "code": "Q022",
      "dimension": "系统意识",
      "subitem": "平衡",
      "text": "我能在业务目标、资源、人员状态和长期发展之间保持平衡。",
      "reverse": false
    },
    {
      "id": 23,
      "code": "Q023",
      "dimension": "系统意识",
      "subitem": "平衡",
      "text": "我不会为了短期结果长期透支团队。",
      "reverse": false
    },
    {
      "id": 24,
      "code": "Q024",
      "dimension": "系统意识",
      "subitem": "平衡",
      "text": "在安排任务时，我会考虑团队的承载能力和节奏。",
      "reverse": false
    },
    {
      "id": 25,
      "code": "Q025",
      "dimension": "系统意识",
      "subitem": "系统思考",
      "text": "遇到问题时，我会关注背后的结构原因，而不是只处理表面现象。",
      "reverse": false
    },
    {
      "id": 26,
      "code": "Q026",
      "dimension": "系统意识",
      "subitem": "系统思考",
      "text": "我习惯从流程、角色、资源和机制之间的关系看问题。",
      "reverse": false
    },
    {
      "id": 27,
      "code": "Q027",
      "dimension": "系统意识",
      "subitem": "系统思考",
      "text": "我会通过复盘减少同类问题反复出现。",
      "reverse": false
    },
    {
      "id": 28,
      "code": "Q028",
      "dimension": "系统意识",
      "subitem": "资源统筹",
      "text": "我能根据目标合理配置人力、时间、资金和外部资源。",
      "reverse": false
    },
    {
      "id": 29,
      "code": "Q029",
      "dimension": "系统意识",
      "subitem": "资源统筹",
      "text": "当资源有限时，我能判断哪些投入最关键。",
      "reverse": false
    },
    {
      "id": 30,
      "code": "Q030",
      "dimension": "系统意识",
      "subitem": "资源统筹",
      "text": "我能协调不同资源形成合力，而不是让各环节各自为战。",
      "reverse": false
    },
    {
      "id": 31,
      "code": "Q031",
      "dimension": "自我觉察",
      "subitem": "沉着",
      "text": "在压力或冲突中，我通常能保持情绪稳定。",
      "reverse": false
    },
    {
      "id": 32,
      "code": "Q032",
      "dimension": "自我觉察",
      "subitem": "沉着",
      "text": "面对突发问题时，我能先稳定局面，再做判断。",
      "reverse": false
    },
    {
      "id": 33,
      "code": "Q033",
      "dimension": "自我觉察",
      "subitem": "沉着",
      "text": "我的情绪不容易让团队陷入紧张或混乱。",
      "reverse": false
    },
    {
      "id": 34,
      "code": "Q034",
      "dimension": "自我觉察",
      "subitem": "反思自省",
      "text": "我愿意复盘自己的判断、行为和管理方式。",
      "reverse": false
    },
    {
      "id": 35,
      "code": "Q035",
      "dimension": "自我觉察",
      "subitem": "反思自省",
      "text": "当事情没有做好时，我会先检查自己的责任和盲点。",
      "reverse": false
    },
    {
      "id": 36,
      "code": "Q036",
      "dimension": "自我觉察",
      "subitem": "反思自省",
      "text": "我能从反馈中看到自己的模式，而不是只关注对错。",
      "reverse": false
    },
    {
      "id": 37,
      "code": "Q037",
      "dimension": "自我觉察",
      "subitem": "无私领导",
      "text": "我愿意把机会、资源和舞台交给团队成员。",
      "reverse": false
    },
    {
      "id": 38,
      "code": "Q038",
      "dimension": "自我觉察",
      "subitem": "无私领导",
      "text": "我不会把团队成果过度归因于自己。",
      "reverse": false
    },
    {
      "id": 39,
      "code": "Q039",
      "dimension": "自我觉察",
      "subitem": "无私领导",
      "text": "我能为了组织整体利益，放下个人面子或短期得失。",
      "reverse": false
    },
    {
      "id": 40,
      "code": "Q040",
      "dimension": "自我觉察",
      "subitem": "学习者",
      "text": "我愿意持续学习新方法，并应用到实际管理中。",
      "reverse": false
    },
    {
      "id": 41,
      "code": "Q041",
      "dimension": "自我觉察",
      "subitem": "学习者",
      "text": "面对不熟悉的问题时，我愿意承认不足并主动学习。",
      "reverse": false
    },
    {
      "id": 42,
      "code": "Q042",
      "dimension": "自我觉察",
      "subitem": "学习者",
      "text": "我会把经验沉淀成方法，而不是只停留在感受。",
      "reverse": false
    },
    {
      "id": 43,
      "code": "Q043",
      "dimension": "自我觉察",
      "subitem": "正直真实",
      "text": "我通常能真实表达自己的判断，而不是刻意包装。",
      "reverse": false
    },
    {
      "id": 44,
      "code": "Q044",
      "dimension": "自我觉察",
      "subitem": "正直真实",
      "text": "我能在压力下坚持原则和底线。",
      "reverse": false
    },
    {
      "id": 45,
      "code": "Q045",
      "dimension": "自我觉察",
      "subitem": "正直真实",
      "text": "我愿意承认问题，而不是用表面理由掩盖真实情况。",
      "reverse": false
    },
    {
      "id": 46,
      "code": "Q046",
      "dimension": "协同赋能",
      "subitem": "关爱",
      "text": "我能关注团队成员的状态、感受和真实困难。",
      "reverse": false
    },
    {
      "id": 47,
      "code": "Q047",
      "dimension": "协同赋能",
      "subitem": "关爱",
      "text": "我会在关键时刻给予成员必要的支持和理解。",
      "reverse": false
    },
    {
      "id": 48,
      "code": "Q048",
      "dimension": "协同赋能",
      "subitem": "关爱",
      "text": "我的关心能让团队感到被看见，而不是只被要求结果。",
      "reverse": false
    },
    {
      "id": 49,
      "code": "Q049",
      "dimension": "协同赋能",
      "subitem": "团队合作",
      "text": "我重视团队之间的协同，而不是只强调个人表现。",
      "reverse": false
    },
    {
      "id": 50,
      "code": "Q050",
      "dimension": "协同赋能",
      "subitem": "团队合作",
      "text": "我能推动不同角色围绕共同目标合作。",
      "reverse": false
    },
    {
      "id": 51,
      "code": "Q051",
      "dimension": "协同赋能",
      "subitem": "团队合作",
      "text": "当团队出现协作问题时，我会主动帮助澄清责任和接口。",
      "reverse": false
    },
    {
      "id": 52,
      "code": "Q052",
      "dimension": "协同赋能",
      "subitem": "培育",
      "text": "我愿意花时间培养团队成员的能力。",
      "reverse": false
    },
    {
      "id": 53,
      "code": "Q053",
      "dimension": "协同赋能",
      "subitem": "培育",
      "text": "我会把方法教给别人，而不是长期让别人依赖我。",
      "reverse": false
    },
    {
      "id": 54,
      "code": "Q054",
      "dimension": "协同赋能",
      "subitem": "培育",
      "text": "我会给成员承担责任和成长的机会。",
      "reverse": false
    },
    {
      "id": 55,
      "code": "Q055",
      "dimension": "协同赋能",
      "subitem": "人际交往",
      "text": "我能与不同性格、不同立场的人建立有效沟通。",
      "reverse": false
    },
    {
      "id": 56,
      "code": "Q056",
      "dimension": "协同赋能",
      "subitem": "人际交往",
      "text": "我能在关系中保持真诚和边界。",
      "reverse": false
    },
    {
      "id": 57,
      "code": "Q057",
      "dimension": "协同赋能",
      "subitem": "人际交往",
      "text": "我通常能通过沟通降低误解和摩擦。",
      "reverse": false
    },
    {
      "id": 58,
      "code": "Q058",
      "dimension": "协同赋能",
      "subitem": "协作者",
      "text": "我愿意与他人共同完成目标，而不是凡事独自推动。",
      "reverse": false
    },
    {
      "id": 59,
      "code": "Q059",
      "dimension": "协同赋能",
      "subitem": "协作者",
      "text": "我能尊重不同意见，并把它们整合进更好的方案。",
      "reverse": false
    },
    {
      "id": 60,
      "code": "Q060",
      "dimension": "协同赋能",
      "subitem": "协作者",
      "text": "我能让团队成员感觉自己是共同参与者，而不是单纯执行者。",
      "reverse": false
    },
    {
      "id": 61,
      "code": "Q061",
      "dimension": "控制",
      "subitem": "工作狂",
      "text": "当结果压力上升时，我容易通过加班或透支来解决问题。",
      "reverse": false
    },
    {
      "id": 62,
      "code": "Q062",
      "dimension": "控制",
      "subitem": "工作狂",
      "text": "我常常觉得只要自己再多扛一点，事情就能推进。",
      "reverse": false
    },
    {
      "id": 63,
      "code": "Q063",
      "dimension": "控制",
      "subitem": "工作狂",
      "text": "我容易把高投入、高强度当成解决问题的主要方式。",
      "reverse": false
    },
    {
      "id": 64,
      "code": "Q064",
      "dimension": "控制",
      "subitem": "完美",
      "text": "我容易因为细节还不够好而延迟推进。",
      "reverse": false
    },
    {
      "id": 65,
      "code": "Q065",
      "dimension": "控制",
      "subitem": "完美",
      "text": "我对结果和过程的要求常常让别人感到压力。",
      "reverse": false
    },
    {
      "id": 66,
      "code": "Q066",
      "dimension": "控制",
      "subitem": "完美",
      "text": "我有时会因为追求完美而降低团队行动速度。",
      "reverse": false
    },
    {
      "id": 67,
      "code": "Q067",
      "dimension": "控制",
      "subitem": "野心",
      "text": "我有时会过度追求更高目标，忽略团队当前承载能力。",
      "reverse": false
    },
    {
      "id": 68,
      "code": "Q068",
      "dimension": "控制",
      "subitem": "野心",
      "text": "当我想赢或想证明自己时，容易推动团队过度加速。",
      "reverse": false
    },
    {
      "id": 69,
      "code": "Q069",
      "dimension": "控制",
      "subitem": "野心",
      "text": "我可能会为了更大的成果，低估过程中的风险和代价。",
      "reverse": false
    },
    {
      "id": 70,
      "code": "Q070",
      "dimension": "控制",
      "subitem": "专制",
      "text": "当事情推进不顺时，我容易直接下命令或替别人做决定。",
      "reverse": false
    },
    {
      "id": 71,
      "code": "Q071",
      "dimension": "控制",
      "subitem": "专制",
      "text": "我有时会用强势拍板来减少讨论和分歧。",
      "reverse": false
    },
    {
      "id": 72,
      "code": "Q072",
      "dimension": "控制",
      "subitem": "专制",
      "text": "在压力下，我容易要求别人按我的方式执行。",
      "reverse": false
    },
    {
      "id": 73,
      "code": "Q073",
      "dimension": "防御",
      "subitem": "傲慢",
      "text": "当我确信自己是对的时，不太容易听进不同意见。",
      "reverse": false
    },
    {
      "id": 74,
      "code": "Q074",
      "dimension": "防御",
      "subitem": "傲慢",
      "text": "我有时会快速否定别人的观点。",
      "reverse": false
    },
    {
      "id": 75,
      "code": "Q075",
      "dimension": "防御",
      "subitem": "傲慢",
      "text": "在团队讨论中，我可能让别人不敢表达真实想法。",
      "reverse": false
    },
    {
      "id": 76,
      "code": "Q076",
      "dimension": "防御",
      "subitem": "距离感",
      "text": "当压力变大时，我会减少沟通，倾向于自己处理问题。",
      "reverse": false
    },
    {
      "id": 77,
      "code": "Q077",
      "dimension": "防御",
      "subitem": "距离感",
      "text": "我不太愿意让别人看到我的压力或脆弱。",
      "reverse": false
    },
    {
      "id": 78,
      "code": "Q078",
      "dimension": "防御",
      "subitem": "距离感",
      "text": "团队有时会觉得我难以接近或不容易理解。",
      "reverse": false
    },
    {
      "id": 79,
      "code": "Q079",
      "dimension": "防御",
      "subitem": "挑剔",
      "text": "在压力下，我更容易看到问题、差错和不足。",
      "reverse": false
    },
    {
      "id": 80,
      "code": "Q080",
      "dimension": "防御",
      "subitem": "挑剔",
      "text": "我指出问题时，有时会让别人感到被否定。",
      "reverse": false
    },
    {
      "id": 81,
      "code": "Q081",
      "dimension": "防御",
      "subitem": "挑剔",
      "text": "我对标准的强调有时会让团队进入防御状态。",
      "reverse": false
    },
    {
      "id": 82,
      "code": "Q082",
      "dimension": "防御",
      "subitem": "自我辩护",
      "text": "当别人指出我的问题时，我容易先解释原因。",
      "reverse": false
    },
    {
      "id": 83,
      "code": "Q083",
      "dimension": "防御",
      "subitem": "自我辩护",
      "text": "我有时会通过强调外部困难来保护自己的判断。",
      "reverse": false
    },
    {
      "id": 84,
      "code": "Q084",
      "dimension": "防御",
      "subitem": "自我辩护",
      "text": "面对反馈时，我不总是能第一时间承认自己的责任。",
      "reverse": false
    },
    {
      "id": 85,
      "code": "Q085",
      "dimension": "顺从",
      "subitem": "保守",
      "text": "面对不确定时，我倾向于选择更稳妥的路径。",
      "reverse": false
    },
    {
      "id": 86,
      "code": "Q086",
      "dimension": "顺从",
      "subitem": "保守",
      "text": "我有时会为了避免出错而放弃突破机会。",
      "reverse": false
    },
    {
      "id": 87,
      "code": "Q087",
      "dimension": "顺从",
      "subitem": "保守",
      "text": "我更容易关注风险，而不是可能的增长空间。",
      "reverse": false
    },
    {
      "id": 88,
      "code": "Q088",
      "dimension": "顺从",
      "subitem": "被动",
      "text": "当信息不充分时，我容易等待更多条件成熟再行动。",
      "reverse": false
    },
    {
      "id": 89,
      "code": "Q089",
      "dimension": "顺从",
      "subitem": "被动",
      "text": "我有时会因为犹豫而错过关键时机。",
      "reverse": false
    },
    {
      "id": 90,
      "code": "Q090",
      "dimension": "顺从",
      "subitem": "被动",
      "text": "当问题不够明确时，我可能会延迟做决定。",
      "reverse": false
    },
    {
      "id": 91,
      "code": "Q091",
      "dimension": "顺从",
      "subitem": "归属",
      "text": "我希望自己被团队或重要关系接纳。",
      "reverse": false
    },
    {
      "id": 92,
      "code": "Q092",
      "dimension": "顺从",
      "subitem": "归属",
      "text": "为了保持归属感，我有时会压下真实想法。",
      "reverse": false
    },
    {
      "id": 93,
      "code": "Q093",
      "dimension": "顺从",
      "subitem": "归属",
      "text": "我不太愿意做可能让自己被孤立的决定。",
      "reverse": false
    },
    {
      "id": 94,
      "code": "Q094",
      "dimension": "顺从",
      "subitem": "取悦",
      "text": "我有时会过度照顾他人感受，避免让别人不舒服。",
      "reverse": false
    },
    {
      "id": 95,
      "code": "Q095",
      "dimension": "顺从",
      "subitem": "取悦",
      "text": "面对冲突时，我可能会先维持关系，而不是直接处理问题。",
      "reverse": false
    },
    {
      "id": 96,
      "code": "Q096",
      "dimension": "顺从",
      "subitem": "取悦",
      "text": "我有时会为了让气氛和谐而降低标准或边界。",
      "reverse": false
    }
  ]
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

function buildInsight(low3: any[], high3: any[]) {
  const lowNames = low3.map((x) => `${x.dim}-${x.sub}`).join("、");
  const highNames = high3.map((x) => `${x.dim}-${x.sub}`).join("、");
  return [
    `能力结构：最低3子项（发展关注）= ${lowNames}`,
    `限制模式：最高3子项（压力触发点）= ${highNames}`,
    `建议：从能力最低3项里选1项做提升重点；从限制最高3项里选1项做管理重点（90天行动表）。`,
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

  // 4) focus：能力最低3 + 限制最高3
  const ability = subscores
    .filter((s) => abilityDims.has(s.dim) && typeof s.score === "number")
    .sort((a, b) => (a.score as number) - (b.score as number));

  const mode = subscores
    .filter((s) => modeDims.has(s.dim) && typeof s.score === "number")
    .sort((a, b) => (b.score as number) - (a.score as number));

  const focus_low3 = ability.slice(0, 3);
  const focus_high2 = mode.slice(0, 3);
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
