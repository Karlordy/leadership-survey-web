// Supabase Edge Function: submit-survey
// 功能：
// 1) 校验同一「姓名+公司」默认最多提交 5 次，可由后台额外开放重测次数
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
  "model_version": "2026-06-16.32-subdimensions.v2",
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
      "text": "我在必要时能对棘手的问题做出决策",
      "reverse": false
    },
    {
      "id": 2,
      "code": "Q002",
      "dimension": "成就导向",
      "subitem": "决断力",
      "text": "我能够及时做出决定",
      "reverse": false
    },
    {
      "id": 3,
      "code": "Q003",
      "dimension": "成就导向",
      "subitem": "决断力",
      "text": "我不需要获得别人的认可也能够果断做出决定",
      "reverse": false
    },
    {
      "id": 4,
      "code": "Q004",
      "dimension": "成就导向",
      "subitem": "领导效能",
      "text": "总体而言，我的领导力行之有效",
      "reverse": false
    },
    {
      "id": 5,
      "code": "Q005",
      "dimension": "成就导向",
      "subitem": "领导效能",
      "text": "我是那种别人立志成为的领导",
      "reverse": false
    },
    {
      "id": 6,
      "code": "Q006",
      "dimension": "成就导向",
      "subitem": "领导效能",
      "text": "我能根据不同成员的能力分配任务，而不是事事亲自处理",
      "reverse": false
    },
    {
      "id": 7,
      "code": "Q007",
      "dimension": "成就导向",
      "subitem": "取得成果",
      "text": "对于关键事务，我足以胜任并且能够取得好成果",
      "reverse": false
    },
    {
      "id": 8,
      "code": "Q008",
      "dimension": "成就导向",
      "subitem": "取得成果",
      "text": "为追求结果，我总是干劲十足",
      "reverse": false
    },
    {
      "id": 9,
      "code": "Q009",
      "dimension": "成就导向",
      "subitem": "取得成果",
      "text": "我能够准确预测当前行动的结果",
      "reverse": false
    },
    {
      "id": 10,
      "code": "Q010",
      "dimension": "成就导向",
      "subitem": "使命愿景",
      "text": "我致力于服务他人与世界，这是我的主动选择",
      "reverse": false
    },
    {
      "id": 11,
      "code": "Q011",
      "dimension": "成就导向",
      "subitem": "使命愿景",
      "text": "我对自己所拥护的愿景身体力行",
      "reverse": false
    },
    {
      "id": 12,
      "code": "Q012",
      "dimension": "成就导向",
      "subitem": "使命愿景",
      "text": "我能清晰讲述愿景以让组织团结起来",
      "reverse": false
    },
    {
      "id": 13,
      "code": "Q013",
      "dimension": "成就导向",
      "subitem": "战略关注",
      "text": "我提出的战略方向都经过深思熟虑",
      "reverse": false
    },
    {
      "id": 14,
      "code": "Q014",
      "dimension": "成就导向",
      "subitem": "战略关注",
      "text": "我持续关注外部环境的趋势，因为这些趋势会影响公司当前及未来的发展",
      "reverse": false
    },
    {
      "id": 15,
      "code": "Q015",
      "dimension": "成就导向",
      "subitem": "战略关注",
      "text": "我能够指明公司的战略方向，让公司得以繁盛发展",
      "reverse": false
    },
    {
      "id": 16,
      "code": "Q016",
      "dimension": "系统意识",
      "subitem": "持续性产出",
      "text": "我可以在短期的绩效与组织的长期健康发展之间取得平衡",
      "reverse": false
    },
    {
      "id": 17,
      "code": "Q017",
      "dimension": "系统意识",
      "subitem": "持续性产出",
      "text": "我合理分配资源，以免耗尽人员的精力",
      "reverse": false
    },
    {
      "id": 18,
      "code": "Q018",
      "dimension": "系统意识",
      "subitem": "持续性产出",
      "text": "我的领导能力让组织得以繁盛发展",
      "reverse": false
    },
    {
      "id": 19,
      "code": "Q019",
      "dimension": "系统意识",
      "subitem": "关心社会",
      "text": "我在创造社会福利和短期盈利之间寻求平衡",
      "reverse": false
    },
    {
      "id": 20,
      "code": "Q020",
      "dimension": "系统意识",
      "subitem": "关心社会",
      "text": "我强调企业的社会责任",
      "reverse": false
    },
    {
      "id": 21,
      "code": "Q021",
      "dimension": "系统意识",
      "subitem": "关心社会",
      "text": "我会思考企业行为对客户、员工、行业或社会的长期影响",
      "reverse": false
    },
    {
      "id": 22,
      "code": "Q022",
      "dimension": "系统意识",
      "subitem": "平衡",
      "text": "我可以在财务目标与其他组织目标之间取得平衡",
      "reverse": false
    },
    {
      "id": 23,
      "code": "Q023",
      "dimension": "系统意识",
      "subitem": "平衡",
      "text": "我可以在工作与生活之间取得平衡",
      "reverse": false
    },
    {
      "id": 24,
      "code": "Q024",
      "dimension": "系统意识",
      "subitem": "平衡",
      "text": "遇到需要协商的事情时，我会使双方的利益最大化",
      "reverse": false
    },
    {
      "id": 25,
      "code": "Q025",
      "dimension": "系统意识",
      "subitem": "系统思考",
      "text": "我重新设计系统，以同时解决多个问题",
      "reverse": false
    },
    {
      "id": 26,
      "code": "Q026",
      "dimension": "系统意识",
      "subitem": "系统思考",
      "text": "我会挖掘事件背后更深层次的意义",
      "reverse": false
    },
    {
      "id": 27,
      "code": "Q027",
      "dimension": "系统意识",
      "subitem": "系统思考",
      "text": "我能看到系统组织中各部分之间的关联性",
      "reverse": false
    },
    {
      "id": 28,
      "code": "Q028",
      "dimension": "系统意识",
      "subitem": "资源统筹",
      "text": "我能协调不同资源形成合力，而不是让各环节各自为战",
      "reverse": false
    },
    {
      "id": 29,
      "code": "Q029",
      "dimension": "系统意识",
      "subitem": "资源统筹",
      "text": "当资源有限时，我能准确判断哪些投入最关键",
      "reverse": false
    },
    {
      "id": 30,
      "code": "Q030",
      "dimension": "系统意识",
      "subitem": "资源统筹",
      "text": "我能根据目标合理配置人力、时间、资金和外部资源",
      "reverse": false
    },
    {
      "id": 31,
      "code": "Q031",
      "dimension": "自我觉察",
      "subitem": "沉着",
      "text": "在压力或冲突中，我通常能保持情绪稳定",
      "reverse": false
    },
    {
      "id": 32,
      "code": "Q032",
      "dimension": "自我觉察",
      "subitem": "沉着",
      "text": "我可以轻松地应付压力",
      "reverse": false
    },
    {
      "id": 33,
      "code": "Q033",
      "dimension": "自我觉察",
      "subitem": "沉着",
      "text": "面对突发问题时，我能先稳定局面，再做后续打算",
      "reverse": false
    },
    {
      "id": 34,
      "code": "Q034",
      "dimension": "自我觉察",
      "subitem": "反思自省",
      "text": "我能够找到充足的时间反省自我",
      "reverse": false
    },
    {
      "id": 35,
      "code": "Q035",
      "dimension": "自我觉察",
      "subitem": "反思自省",
      "text": "我审视自己行动背后的假设",
      "reverse": false
    },
    {
      "id": 36,
      "code": "Q036",
      "dimension": "自我觉察",
      "subitem": "反思自省",
      "text": "我善于从错误中学习",
      "reverse": false
    },
    {
      "id": 37,
      "code": "Q037",
      "dimension": "自我觉察",
      "subitem": "无私领导",
      "text": "我专注做事而不需邀功",
      "reverse": false
    },
    {
      "id": 38,
      "code": "Q038",
      "dimension": "自我觉察",
      "subitem": "无私领导",
      "text": "我不太热衷于让别人记住我的功劳",
      "reverse": false
    },
    {
      "id": 39,
      "code": "Q039",
      "dimension": "自我觉察",
      "subitem": "无私领导",
      "text": "我愿意把机会、资源和舞台交给团队成员",
      "reverse": false
    },
    {
      "id": 40,
      "code": "Q040",
      "dimension": "自我觉察",
      "subitem": "学习者",
      "text": "我能够虚心听取批评，还会通过提问以帮助自己更好地去理解对方",
      "reverse": false
    },
    {
      "id": 41,
      "code": "Q041",
      "dimension": "自我觉察",
      "subitem": "学习者",
      "text": "我认为要让自己感觉良好，就需要不断学习",
      "reverse": false
    },
    {
      "id": 42,
      "code": "Q042",
      "dimension": "自我觉察",
      "subitem": "学习者",
      "text": "我会把经验沉淀成方法，而不是只停留在感受",
      "reverse": false
    },
    {
      "id": 43,
      "code": "Q043",
      "dimension": "自我觉察",
      "subitem": "正直真实",
      "text": "别人不愿讨论的棘手话题，我也会带上台面",
      "reverse": false
    },
    {
      "id": 44,
      "code": "Q044",
      "dimension": "自我觉察",
      "subitem": "正直真实",
      "text": "我在会议上勇于发表自己的意见，即便对有争议的问题也直言不讳",
      "reverse": false
    },
    {
      "id": 45,
      "code": "Q045",
      "dimension": "自我觉察",
      "subitem": "正直真实",
      "text": "无论顺境逆境，我都坚持自己的价值观",
      "reverse": false
    },
    {
      "id": 46,
      "code": "Q046",
      "dimension": "协同赋能",
      "subitem": "关爱",
      "text": "我的关心能让团队感到被看见，而不是只被要求结果",
      "reverse": false
    },
    {
      "id": 47,
      "code": "Q047",
      "dimension": "协同赋能",
      "subitem": "关爱",
      "text": "我可以跟别人建立温暖且充满关怀的关系",
      "reverse": false
    },
    {
      "id": 48,
      "code": "Q048",
      "dimension": "协同赋能",
      "subitem": "关爱",
      "text": "我能关注团队成员的状态、感受和真实困难",
      "reverse": false
    },
    {
      "id": 49,
      "code": "Q049",
      "dimension": "协同赋能",
      "subitem": "团队合作",
      "text": "我为达成一致寻求共识",
      "reverse": false
    },
    {
      "id": 50,
      "code": "Q050",
      "dimension": "协同赋能",
      "subitem": "团队合作",
      "text": "我授权他人领导工作，促进团队成员之间的合作",
      "reverse": false
    },
    {
      "id": 51,
      "code": "Q051",
      "dimension": "协同赋能",
      "subitem": "团队合作",
      "text": "我善于调节冲突",
      "reverse": false
    },
    {
      "id": 52,
      "code": "Q052",
      "dimension": "协同赋能",
      "subitem": "培育",
      "text": "我协助下属制定其发展计划",
      "reverse": false
    },
    {
      "id": 53,
      "code": "Q053",
      "dimension": "协同赋能",
      "subitem": "培育",
      "text": "我营造积极的氛围使得他人能够做到最好",
      "reverse": false
    },
    {
      "id": 54,
      "code": "Q054",
      "dimension": "协同赋能",
      "subitem": "培育",
      "text": "我给别人反馈时，会重点关注如何帮助对方成长",
      "reverse": false
    },
    {
      "id": 55,
      "code": "Q055",
      "dimension": "协同赋能",
      "subitem": "人际交往",
      "text": "遇到冲突时，我可以准确地复述对方的观点",
      "reverse": false
    },
    {
      "id": 56,
      "code": "Q056",
      "dimension": "协同赋能",
      "subitem": "人际交往",
      "text": "在人际关系出现问题时，我主动承担相应责任",
      "reverse": false
    },
    {
      "id": 57,
      "code": "Q057",
      "dimension": "协同赋能",
      "subitem": "人际交往",
      "text": "我会直接处理干扰团队表现的问题",
      "reverse": false
    },
    {
      "id": 58,
      "code": "Q058",
      "dimension": "协同赋能",
      "subitem": "协作者",
      "text": "我能在困境中安定人心",
      "reverse": false
    },
    {
      "id": 59,
      "code": "Q059",
      "dimension": "协同赋能",
      "subitem": "协作者",
      "text": "我能尊重不同意见，并把它们整合进更好的方案",
      "reverse": false
    },
    {
      "id": 60,
      "code": "Q060",
      "dimension": "协同赋能",
      "subitem": "协作者",
      "text": "我愿意与他人共同完成目标，而不是凡事独自推动",
      "reverse": false
    },
    {
      "id": 61,
      "code": "Q061",
      "dimension": "控制",
      "subitem": "工作狂",
      "text": "我容易把更多投入当成解决问题的主要方式",
      "reverse": false
    },
    {
      "id": 62,
      "code": "Q062",
      "dimension": "控制",
      "subitem": "工作狂",
      "text": "我把自己逼的太紧",
      "reverse": false
    },
    {
      "id": 63,
      "code": "Q063",
      "dimension": "控制",
      "subitem": "工作狂",
      "text": "我常常觉得只要自己再多扛一点，事情就能推进",
      "reverse": false
    },
    {
      "id": 64,
      "code": "Q064",
      "dimension": "控制",
      "subitem": "完美",
      "text": "我过分努力地要把每件事情都做到最好",
      "reverse": false
    },
    {
      "id": 65,
      "code": "Q065",
      "dimension": "控制",
      "subitem": "完美",
      "text": "我需要在所有情况下都出类拔萃",
      "reverse": false
    },
    {
      "id": 66,
      "code": "Q066",
      "dimension": "控制",
      "subitem": "完美",
      "text": "我认为达到平均水平远远不够",
      "reverse": false
    },
    {
      "id": 67,
      "code": "Q067",
      "dimension": "控制",
      "subitem": "野心",
      "text": "我需要得到别人的仰慕",
      "reverse": false
    },
    {
      "id": 68,
      "code": "Q068",
      "dimension": "控制",
      "subitem": "野心",
      "text": "我的野心很大",
      "reverse": false
    },
    {
      "id": 69,
      "code": "Q069",
      "dimension": "控制",
      "subitem": "野心",
      "text": "为了得到最终成果，我会牺牲他人的利益",
      "reverse": false
    },
    {
      "id": 70,
      "code": "Q070",
      "dimension": "控制",
      "subitem": "专制",
      "text": "我非常强势",
      "reverse": false
    },
    {
      "id": 71,
      "code": "Q071",
      "dimension": "控制",
      "subitem": "专制",
      "text": "我直接下命令，而不是通过影响的方式让他人做事",
      "reverse": false
    },
    {
      "id": 72,
      "code": "Q072",
      "dimension": "控制",
      "subitem": "专制",
      "text": "我必须按自己的方式行事",
      "reverse": false
    },
    {
      "id": 73,
      "code": "Q073",
      "dimension": "防御",
      "subitem": "傲慢",
      "text": "我自视过高",
      "reverse": false
    },
    {
      "id": 74,
      "code": "Q074",
      "dimension": "防御",
      "subitem": "傲慢",
      "text": "当我确信自己是对的时，就不想听不同意见",
      "reverse": false
    },
    {
      "id": 75,
      "code": "Q075",
      "dimension": "防御",
      "subitem": "傲慢",
      "text": "我时常会快速否定别人的观点",
      "reverse": false
    },
    {
      "id": 76,
      "code": "Q076",
      "dimension": "防御",
      "subitem": "距离感",
      "text": "我保持冷淡的态度",
      "reverse": false
    },
    {
      "id": 77,
      "code": "Q077",
      "dimension": "防御",
      "subitem": "距离感",
      "text": "别人难以了解我",
      "reverse": false
    },
    {
      "id": 78,
      "code": "Q078",
      "dimension": "防御",
      "subitem": "距离感",
      "text": "我与他人情感疏离",
      "reverse": false
    },
    {
      "id": 79,
      "code": "Q079",
      "dimension": "防御",
      "subitem": "挑剔",
      "text": "我当着别人的面批评他人",
      "reverse": false
    },
    {
      "id": 80,
      "code": "Q080",
      "dimension": "防御",
      "subitem": "挑剔",
      "text": "我尝尝愤世嫉俗",
      "reverse": false
    },
    {
      "id": 81,
      "code": "Q081",
      "dimension": "防御",
      "subitem": "挑剔",
      "text": "我对他人的期待很高",
      "reverse": false
    },
    {
      "id": 82,
      "code": "Q082",
      "dimension": "防御",
      "subitem": "自我辩护",
      "text": "当别人指出我的问题时，我习惯先解释原因",
      "reverse": false
    },
    {
      "id": 83,
      "code": "Q083",
      "dimension": "防御",
      "subitem": "自我辩护",
      "text": "我有时会通过强调外部困难来证明自己的判断",
      "reverse": false
    },
    {
      "id": 84,
      "code": "Q084",
      "dimension": "防御",
      "subitem": "自我辩护",
      "text": "面对冲突时，我不愿第一个承认自己的责任",
      "reverse": false
    },
    {
      "id": 85,
      "code": "Q085",
      "dimension": "顺从",
      "subitem": "保守",
      "text": "我在规则内办事",
      "reverse": false
    },
    {
      "id": 86,
      "code": "Q086",
      "dimension": "顺从",
      "subitem": "保守",
      "text": "我总是在界限内活动",
      "reverse": false
    },
    {
      "id": 87,
      "code": "Q087",
      "dimension": "顺从",
      "subitem": "保守",
      "text": "我遵循固有的做事方式",
      "reverse": false
    },
    {
      "id": 88,
      "code": "Q088",
      "dimension": "顺从",
      "subitem": "被动",
      "text": "我缺乏动力",
      "reverse": false
    },
    {
      "id": 89,
      "code": "Q089",
      "dimension": "顺从",
      "subitem": "被动",
      "text": "我做事被动",
      "reverse": false
    },
    {
      "id": 90,
      "code": "Q090",
      "dimension": "顺从",
      "subitem": "被动",
      "text": "我有时会因为犹豫而错过关键时机",
      "reverse": false
    },
    {
      "id": 91,
      "code": "Q091",
      "dimension": "顺从",
      "subitem": "归属",
      "text": "我不太愿意做可能让自己被孤立的决定",
      "reverse": false
    },
    {
      "id": 92,
      "code": "Q092",
      "dimension": "顺从",
      "subitem": "归属",
      "text": "我需要得到别人的接纳和认可",
      "reverse": false
    },
    {
      "id": 93,
      "code": "Q093",
      "dimension": "顺从",
      "subitem": "归属",
      "text": "我会为了不让他人失望而采用他们的观点",
      "reverse": false
    },
    {
      "id": 94,
      "code": "Q094",
      "dimension": "顺从",
      "subitem": "取悦",
      "text": "我担心别人怎么看我",
      "reverse": false
    },
    {
      "id": 95,
      "code": "Q095",
      "dimension": "顺从",
      "subitem": "取悦",
      "text": "我用迎合的方法来取悦他人",
      "reverse": false
    },
    {
      "id": 96,
      "code": "Q096",
      "dimension": "顺从",
      "subitem": "取悦",
      "text": "我有时会为了让气氛和谐而降低标准或边界",
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
const MAX_SUBMISSIONS_PER_NAME_COMPANY = 5;

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

async function supaRetestAllowance(url: string, serviceKey: string, name: string, company: string) {
  const nameEnc = encodeURIComponent(name);
  const compEnc = encodeURIComponent(company);

  const endpoint =
    `${url.replace(/\/$/, "")}/rest/v1/survey_retest_allowances?select=extra_allowed` +
    `&real_name=eq.${nameEnc}` +
    `&company=eq.${compEnc}` +
    `&is_active=eq.true`;

  const resp = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      Accept: "application/json",
    },
  });

  if (!resp.ok) {
    console.warn(`retest allowance lookup skipped: ${resp.status} ${await resp.text().catch(() => "")}`);
    return 0;
  }

  const rows = await resp.json().catch(() => []);
  if (!Array.isArray(rows)) return 0;

  return rows.reduce((sum, row) => {
    const n = Number(row?.extra_allowed || 0);
    return sum + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;

  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
    .join(",")}}`;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function safeFilePart(value: string) {
  return String(value || "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

function buildReportSnapshot(submission: any, computed: ReturnType<typeof compute>, createdAt?: string) {
  return {
    name: submission.name,
    company: submission.company,
    submission_created_at: createdAt || null,
    answers_raw: submission.answers_raw ?? null,
    answers_adjusted: computed.adjusted,
    subscores: computed.subscores,
    dimscores: computed.dimscores,
    focus_low3: computed.focus_low3,
    focus_high2: computed.focus_high2,
    insight_text: computed.insight_text,
  };
}

async function getJsonRows(url: string, serviceKey: string, endpointPath: string) {
  const endpoint = `${url.replace(/\/$/, "")}${endpointPath}`;
  const resp = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      Accept: "application/json",
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`select failed: ${resp.status} ${text}`);
  }

  const rows = await resp.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function supaFindExistingSubmission(
  url: string,
  serviceKey: string,
  args: { name: string; company: string; submissionKey?: string; answersHash?: string },
) {
  const baseSelect = "select=id,created_at,name,real_name,company";

  if (args.submissionKey) {
    try {
      const rows = await getJsonRows(
        url,
        serviceKey,
        `/rest/v1/submissions?${baseSelect}&submission_key=eq.${encodeURIComponent(args.submissionKey)}&limit=1`,
      );
      if (rows[0]?.id) return rows[0];
    } catch (e) {
      console.warn(`submission_key lookup skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (args.answersHash) {
    try {
      const rows = await getJsonRows(
        url,
        serviceKey,
        `/rest/v1/submissions?${baseSelect}&company=eq.${encodeURIComponent(args.company)}&answers_hash=eq.${encodeURIComponent(args.answersHash)}&limit=20`,
      );
      const hit = rows.find((row) => {
        const rowName = String(row?.real_name ?? row?.name ?? "").trim();
        return rowName === args.name;
      });
      if (hit?.id) return hit;
    } catch (e) {
      console.warn(`answers_hash lookup skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return null;
}

async function supaInsertSubmission(url: string, serviceKey: string, payload: any) {
  const endpoint = `${url.replace(/\/$/, "")}/rest/v1/submissions?select=id,created_at`;

  async function post(body: any) {
    return await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(body),
    });
  }

  let resp = await post(payload);
  if (!resp.ok) {
    const text = await resp.text();
    if (/submission_key|answers_hash|questions_version|scale_step|PGRST204/i.test(text)) {
      const legacyPayload = { ...payload };
      delete legacyPayload.submission_key;
      delete legacyPayload.answers_hash;
      delete legacyPayload.questions_version;
      delete legacyPayload.scale_step;
      resp = await post(legacyPayload);
      if (!resp.ok) {
        const retryText = await resp.text();
        throw new Error(`insert failed: ${resp.status} ${retryText}`);
      }
    } else {
      throw new Error(`insert failed: ${resp.status} ${text}`);
    }
  }

  const rows = await resp.json().catch(() => []);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row?.id) throw new Error("insert failed: missing inserted submission id");
  return row;
}

async function supaEnsureReport(url: string, serviceKey: string, payload: any) {
  try {
    const rows = await getJsonRows(
      url,
      serviceKey,
      `/rest/v1/reports?select=id&submission_id=eq.${encodeURIComponent(payload.submission_id)}&limit=1`,
    );
    if (rows[0]?.id) return rows[0];
  } catch (e) {
    console.warn(`report existence lookup skipped: ${e instanceof Error ? e.message : String(e)}`);
  }

  const endpoint = `${url.replace(/\/$/, "")}/rest/v1/reports?select=id`;
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const t = await resp.text();
    if (resp.status === 409) return null;
    throw new Error(`report insert failed: ${resp.status} ${t}`);
  }

  const rows = await resp.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] : null;
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

    // 同名+公司默认最多 5 次；后台可额外开放重测次数。
    const submissionKey = String(body?.submission_key ?? "").trim();
    const answersHash = await sha256Hex(stableStringify(answers_raw));

    const existingSubmission = await supaFindExistingSubmission(url, serviceKey, {
      name: realName,
      company,
      submissionKey,
      answersHash,
    });

    if (existingSubmission?.id) {
      const computed = compute(answers_raw as Record<string, unknown>);
      const snapshot = buildReportSnapshot(
        { name: realName, company, answers_raw },
        computed,
        existingSubmission.created_at,
      );
      const displayFileName = `${safeFilePart(realName) || "未命名"}-${safeFilePart(company) || "公司"}-领导力测评报告.pdf`;
      await supaEnsureReport(url, serviceKey, {
        submission_id: existingSubmission.id,
        status: "queued",
        error: null,
        snapshot,
        file_name: displayFileName,
        updated_at: new Date().toISOString(),
      });
      return jsonRes({ ok: true, deduped: true, submission_id: existingSubmission.id });
    }

    const count = await supaCount(url, serviceKey, realName, company);
    const extraAllowed = await supaRetestAllowance(url, serviceKey, realName, company);
    const maxAllowed = MAX_SUBMISSIONS_PER_NAME_COMPANY + extraAllowed;
    if (count >= maxAllowed) {
      return jsonRes({
        code: "submission_limit_reached",
        error: `该姓名和公司已提交 ${count} 次，已达到当前上限 ${maxAllowed} 次。如需重新测评，请联系教练或管理员为你开放重测。`,
        submission_count: count,
        max_submissions: maxAllowed,
        base_limit: MAX_SUBMISSIONS_PER_NAME_COMPANY,
        extra_allowed: extraAllowed,
      }, 403);
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
    submission_key: submissionKey || null,
    answers_hash: answersHash,
    questions_version: String(body?.questions_version ?? QUESTION_BANK.model_version ?? "v1"),
    scale_step: Number(body?.scale_step ?? SCALE_STEP),
  };


    const inserted = await supaInsertSubmission(url, serviceKey, payload);
    const snapshot = buildReportSnapshot(payload, computed, inserted.created_at);
    const displayFileName = `${safeFilePart(realName) || "未命名"}-${safeFilePart(company) || "公司"}-领导力测评报告.pdf`;

    await supaEnsureReport(url, serviceKey, {
      submission_id: inserted.id,
      status: "queued",
      error: null,
      snapshot,
      file_name: displayFileName,
      updated_at: new Date().toISOString(),
    });

    return jsonRes({ ok: true, submission_id: inserted.id });
  } catch (e: any) {
    return jsonRes({ error: "提交失败：" + (e?.message ?? String(e)) }, 500);
  }
});
