// supabase/functions/generate-report/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";

type Json = Record<string, unknown>;

/** ---------------- CORS ----------------
 * 关键点：
 * 1) 预检 OPTIONS 必须返回 200/204
 * 2) Allow-Headers 最稳的做法：回显浏览器请求的 Access-Control-Request-Headers
 */
function buildCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") ?? "*";
  const reqHeaders = req.headers.get("access-control-request-headers");
  const allowHeaders =
    reqHeaders ??
    "content-type, apikey, authorization, x-client-info, x-request-id, x-admin-secret";

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": allowHeaders,
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function jsonResponse(req: Request, body: Json, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...buildCorsHeaders(req),
    },
  });
}

async function readJsonBody(req: Request): Promise<any> {
  const raw = await req.text().catch(() => "");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const err: any = new Error("Invalid JSON body");
    err.status = 400;
    throw err;
  }
}

// ---------------- 固定字典（排序&分组） ----------------
const DIMS_TOP = ["成就导向", "系统意识", "自我觉察", "协同赋能"];
const DIMS_BOTTOM = ["顺从", "防御", "控制"];
const ALL_DIMS = [...DIMS_TOP, ...DIMS_BOTTOM];

const SUB_TOP = [
  "使命愿景",
  "战略关注",
  "取得成果",
  "系统思考",
  "平衡",
  "持续产出",
  "反思自省",
  "学习者",
  "沉着",
  "关爱",
  "培育",
  "团队合作",
];
const SUB_BOTTOM = ["取悦", "被动", "保守", "傲慢", "距离感", "挑剔", "完美", "专制", "工作狂"];
const ALL_SUBS = [...SUB_TOP, ...SUB_BOTTOM];

// ---------------- 分数工具 ----------------
function round2(n: number) {
  return Math.round(n * 100) / 100;
}
function clamp15(n: number) {
  return Math.max(1, Math.min(5, n));
}
function fmt2(v: any) {
  if (typeof v === "number" && Number.isFinite(v)) return v.toFixed(2);
  return "-";
}
function numOrNull(v: any): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return round2(v);
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return round2(n);
  }
  return null;
}

// subscores 兼容：[{sub,score}] / [["使命愿景",2.5]] / {使命愿景:2.5}
function normalizeSubScores(raw: any): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const name of ALL_SUBS) out[name] = null;

  if (Array.isArray(raw)) {
    for (const it of raw) {
      if (Array.isArray(it) && it.length >= 2) {
        const k = String(it[0] ?? "").trim();
        if (!k) continue;
        if (!ALL_SUBS.includes(k)) continue;
        const v = numOrNull(it[1]);
        out[k] = v == null ? null : round2(clamp15(v));
        continue;
      }
      const k = String(it?.sub ?? it?.subName ?? it?.sub_name ?? it?.name ?? it?.label ?? "").trim();
      if (!k) continue;
      if (!ALL_SUBS.includes(k)) continue;
      const v = numOrNull(it?.score ?? it?.value ?? it?.avg ?? it?.mean ?? it?.result);
      out[k] = v == null ? null : round2(clamp15(v));
    }
    return out;
  }

  if (raw && typeof raw === "object") {
    for (const [k0, v0] of Object.entries(raw)) {
      const k = String(k0 ?? "").trim();
      if (!k) continue;
      if (!ALL_SUBS.includes(k)) continue;
      const v = numOrNull(v0);
      out[k] = v == null ? null : round2(clamp15(v));
    }
  }
  return out;
}

function normalizeDimScores(raw: any): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const d of ALL_DIMS) out[d] = null;

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const d of ALL_DIMS) {
      const v = numOrNull((raw as any)[d]);
      out[d] = v == null ? null : round2(clamp15(v));
    }
    return out;
  }

  if (Array.isArray(raw)) {
    for (const it of raw) {
      const k = String(it?.dim ?? it?.dimName ?? it?.name ?? it?.label ?? "").trim();
      if (!k) continue;
      if (!ALL_DIMS.includes(k)) continue;
      const v = numOrNull(it?.score ?? it?.value ?? it?.avg ?? it?.mean);
      out[k] = v == null ? null : round2(clamp15(v));
    }
  }
  return out;
}

function scoreSubmission(submission: any) {
  const sub_scores = normalizeSubScores(submission?.subscores);
  const dim_scores = normalizeDimScores(submission?.dimscores);

  const dimVals = Object.values(dim_scores).filter((v) => typeof v === "number") as number[];
  const overall = dimVals.length ? round2(dimVals.reduce((a, b) => a + b, 0) / dimVals.length) : null;

  return {
    version: 3,
    scale: { min: 1, max: 5, step: 0.5 },
    dim_scores,
    sub_scores,
    overall,
    groups: {
      top: { dims: DIMS_TOP, subs: SUB_TOP },
      bottom: { dims: DIMS_BOTTOM, subs: SUB_BOTTOM },
    },
    insight_text: submission?.insight_text ?? null,
    focus_low3: submission?.focus_low3 ?? null,
    focus_high2: submission?.focus_high2 ?? null,
  };
}

// ---------------- 鉴权：Bearer Token + ADMIN_EMAILS ----------------
function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice("bearer ".length).trim();
}
function parseAdminEmails() {
  return (Deno.env.get("ADMIN_EMAILS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
async function assertAdminByJwt(req: Request, adminClient: any) {
  const token = getBearerToken(req);
  if (!token) {
    const err: any = new Error("Missing Authorization Bearer token.");
    err.status = 401;
    throw err;
  }

  const { data, error } = await adminClient.auth.getUser(token);
  if (error || !data?.user) {
    const err: any = new Error(`Invalid token. ${error?.message ?? ""}`.trim());
    err.status = 401;
    throw err;
  }

  const email = data.user.email ?? "";
  const admins = parseAdminEmails();
  if (admins.length > 0 && !admins.includes(email)) {
    const err: any = new Error("Forbidden (not admin).");
    err.status = 403;
    throw err;
  }

  return data.user;
}

// ---------------- 字体下载：assets/fonts 与 Reports/fonts ----------------
type FontKey = "Regular" | "Bold";
const FONT_FILE: Record<FontKey, string> = {
  Regular: "NotoSansSC-Regular.ttf",
  Bold: "NotoSansSC-Bold.ttf",
};

const fontCache = new Map<string, Uint8Array>();

function encodePath(path: string) {
  return path
    .split("/")
    .filter((s) => s.length > 0)
    .map((s) => encodeURIComponent(s))
    .join("/");
}

function assertTtfBytes(bytes: Uint8Array, label: string) {
  if (!bytes || bytes.length < 4) throw new Error(`字体文件为空：${label}`);

  const b0 = bytes[0], b1 = bytes[1], b2 = bytes[2], b3 = bytes[3];
  const isTTF =
    (b0 === 0x00 && b1 === 0x01 && b2 === 0x00 && b3 === 0x00) ||
    (b0 === 0x74 && b1 === 0x72 && b2 === 0x75 && b3 === 0x65) ||
    (b0 === 0x74 && b1 === 0x74 && b2 === 0x63 && b3 === 0x66);

  if (!isTTF) {
    const head = new TextDecoder().decode(bytes.slice(0, 160)).replace(/\s+/g, " ");
    throw new Error(`字体文件格式不对：${label}\n文件头预览：${head}`);
  }

  if (bytes.length < 200_000) {
    throw new Error(`字体文件体积异常偏小：${label}，size=${bytes.length} bytes（很可能不是字体）`);
  }
}

async function downloadFromStorage(opts: {
  adminClient: any;
  supabaseUrl: string;
  serviceKey: string;
  bucket: string;
  path: string;
}): Promise<Uint8Array> {
  const { adminClient, supabaseUrl, serviceKey, bucket, path } = opts;

  // 1) supabase-js download
  const { data, error } = await adminClient.storage.from(bucket).download(path);
  if (!error && data) {
    const ab = await data.arrayBuffer();
    return new Uint8Array(ab);
  }

  // 2) fallback：直连 storage API
  const url = `${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodePath(path)}`;
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`字体下载失败：${bucket}/${path}\nHTTP ${resp.status}\n${text.slice(0, 200)}`);
  }

  const ab = await resp.arrayBuffer();
  return new Uint8Array(ab);
}

async function loadFontBytes(opts: {
  adminClient: any;
  supabaseUrl: string;
  serviceKey: string;
  kind: FontKey;
}): Promise<Uint8Array> {
  const { adminClient, supabaseUrl, serviceKey, kind } = opts;
  const cacheKey = `NotoSansSC-${kind}`;
  if (fontCache.has(cacheKey)) return fontCache.get(cacheKey)!;

  const file = FONT_FILE[kind];

  const candidates: Array<{ bucket: string; path: string }> = [
    { bucket: "assets", path: `fonts/${file}` },
    { bucket: "Reports", path: `fonts/${file}` },
  ];

  const forcedBucket = (Deno.env.get(`FONT_${kind.toUpperCase()}_BUCKET`) ?? "").trim();
  const forcedPath = (Deno.env.get(`FONT_${kind.toUpperCase()}_PATH`) ?? "").trim();
  if (forcedBucket && forcedPath) candidates.unshift({ bucket: forcedBucket, path: forcedPath });

  let lastErr: any = null;
  for (const c of candidates) {
    try {
      const bytes = await downloadFromStorage({
        adminClient,
        supabaseUrl,
        serviceKey,
        bucket: c.bucket,
        path: c.path,
      });
      assertTtfBytes(bytes, `${c.bucket}/${c.path}`);
      fontCache.set(cacheKey, bytes);
      return bytes;
    } catch (e) {
      lastErr = e;
    }
  }

  throw new Error(
    `无法加载字体 ${file}。已尝试：${candidates.map((c) => `${c.bucket}/${c.path}`).join(" , ")}\n最后错误：${String(
      lastErr?.message || lastErr
    )}`
  );
}

// ---------------- 文件名工具 ----------------
function safeFilePartAscii(s: string) {
  let x = String(s ?? "").trim();
  x = x.replace(/[^\x20-\x7E]+/g, "_");
  x = x.replace(/[\\\/:*?"<>|]/g, "_");
  x = x.replace(/\s+/g, "_").replace(/_+/g, "_");
  x = x.replace(/^[-_]+/, "").replace(/[-_]+$/, "").slice(0, 60);
  return x || "file";
}
function safeDisplayFileName(s: string) {
  return String(s ?? "")
    .replace(/[\\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------- DataURL -> Uint8Array(PNG) ----------------
function parsePngDataUrl(dataUrl: string): Uint8Array {
  const s = String(dataUrl || "");
  const m = s.match(/^data:image\/png;base64,(.+)$/);
  if (!m) throw new Error("radar_png_data_url 不是合法的 data:image/png;base64,...");
  const b64 = m[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ---------------- focus_low3/high2 格式化 ----------------
function normalizeFocusList(x: any): Array<{ name: string; score: number | null }> {
  if (!x) return [];
  const arr = Array.isArray(x) ? x : [x];
  const out: Array<{ name: string; score: number | null }> = [];
  for (const it of arr) {
    if (typeof it === "string") out.push({ name: it, score: null });
    else if (it && typeof it === "object") {
      const name =
        String((it as any).sub ?? (it as any).name ?? (it as any).label ?? "").trim() || "—";
      const score = numOrNull((it as any).score ?? (it as any).value);
      out.push({ name, score });
    }
  }
  return out.filter((a) => a.name && a.name !== "—");
}

// ---------------- PDF：模板B卡片式布局（两页） ----------------
async function buildPdfBytes(opts: {
  submission: any;
  result: any;
  reportId: string;
  radarPngBytes?: Uint8Array | null;
  adminClient: any;
  supabaseUrl: string;
  serviceKey: string;
}): Promise<Uint8Array> {
  const { submission, result, reportId, radarPngBytes, adminClient, supabaseUrl, serviceKey } = opts;

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const pageW = 595;
  const pageH = 842;
  const margin = 40;
  const contentW = pageW - margin * 2;

  const regularBytes = await loadFontBytes({ adminClient, supabaseUrl, serviceKey, kind: "Regular" });
  const boldBytes = await loadFontBytes({ adminClient, supabaseUrl, serviceKey, kind: "Bold" });

  // ✅ 中文更稳：默认不子集化（避免部分阅读器/子集映射导致的拆字/间距异常）
  // 如需缩小体积：在 Supabase Function env 里设 PDF_FONT_SUBSET=1
  const subset = (Deno.env.get("PDF_FONT_SUBSET") ?? "0") === "1";

  const fontR = await pdfDoc.embedFont(regularBytes, { subset });
  const fontB = await pdfDoc.embedFont(boldBytes, { subset });

  const C = {
    ink: rgb(0.0588, 0.0902, 0.1647), // #0f172a
    muted: rgb(0.3922, 0.4549, 0.5451), // #64748b
    line: rgb(0.8863, 0.9098, 0.9412), // #e2e8f0
    soft: rgb(0.9725, 0.9804, 0.9882), // #f8fafc
    accent: rgb(0.4863, 0.2275, 0.9294), // #7c3aed
    lowBg: rgb(0.99, 0.95, 0.95),
    highBg: rgb(0.95, 0.99, 0.96),
  };

  function drawCard(page: any, x: number, y: number, w: number, h: number, fill = rgb(1, 1, 1)) {
    page.drawRectangle({ x, y, width: w, height: h, color: fill, borderColor: C.line, borderWidth: 1 });
  }

  function drawText(
    page: any,
    text: string,
    x: number,
    y: number,
    size = 11,
    bold = false,
    color = C.ink
  ) {
    page.drawText(String(text ?? ""), { x, y, size, font: bold ? fontB : fontR, color });
  }

  function wrapLines(text: string, maxW: number, size: number, bold = false): string[] {
    const font = bold ? fontB : fontR;
    const s = String(text ?? "");
    if (!s) return [""];

    const parts = s.split(/\n/);
    const lines: string[] = [];

    for (const part of parts) {
      const chars = part.split("");
      let line = "";
      for (const ch of chars) {
        const test = line + ch;
        const w = font.widthOfTextAtSize(test, size);
        if (w <= maxW || line.length === 0) line = test;
        else {
          lines.push(line);
          line = ch;
        }
      }
      lines.push(line || "");
    }
    return lines;
  }

  function drawParagraph(
    page: any,
    text: string,
    x: number,
    yTop: number,
    maxW: number,
    size: number,
    lineH: number,
    color = C.ink,
    bold = false
  ) {
    const lines = wrapLines(text, maxW, size, bold);
    let y = yTop;
    for (const ln of lines) {
      drawText(page, ln, x, y, size, bold, color);
      y -= lineH;
    }
    return y;
  }

  const nameZh = String(submission.name ?? "").trim();
  const companyZh = String(submission.company ?? "").trim();
  const submittedAt = String(submission.created_at ?? "");
  const low3 = normalizeFocusList(result.focus_low3);
  const high2 = normalizeFocusList(result.focus_high2);

  // ---------- PAGE 1 ----------
  const page1 = pdfDoc.addPage([pageW, pageH]);

  const headerH = 64;
  drawCard(page1, margin, pageH - margin - headerH, contentW, headerH, rgb(1, 1, 1));
  page1.drawRectangle({
    x: margin + 12,
    y: pageH - margin - headerH + 14,
    width: 36,
    height: 36,
    color: rgb(0.96, 0.94, 0.99),
    borderColor: rgb(0.85, 0.80, 0.98),
    borderWidth: 1,
  });
  drawText(page1, "圆桌", margin + 20, pageH - margin - headerH + 28, 12, true, C.accent);

  drawText(page1, "领导力测评报告", margin + 60, pageH - margin - 26, 16, true, C.ink);
  drawText(page1, "模板B｜摘要 + 明细（卡片式）", margin + 60, pageH - margin - 44, 10, false, C.muted);

  const rightX = margin + contentW - 200;
  drawText(page1, `报告日期：${new Date().toISOString().slice(0, 10)}`, rightX, pageH - margin - 28, 10, false, C.muted);
  drawText(page1, `报告编号：${reportId}`, rightX, pageH - margin - 44, 10, false, C.muted);

  const infoH = 52;
  const infoY = pageH - margin - headerH - 14 - infoH;
  drawCard(page1, margin, infoY, contentW, infoH, C.soft);

  const col1 = margin + 12;
  const col2 = margin + contentW * 0.36;
  const col3 = margin + contentW * 0.70;

  drawText(page1, "姓名", col1, infoY + 32, 10, true, C.muted);
  drawText(page1, nameZh || "-", col1, infoY + 14, 12, true, C.ink);

  drawText(page1, "公司", col2, infoY + 32, 10, true, C.muted);
  drawText(page1, companyZh || "-", col2, infoY + 14, 12, true, C.ink);

  drawText(page1, "测评时间", col3, infoY + 32, 10, true, C.muted);
  drawText(page1, submittedAt ? submittedAt.slice(0, 19).replace("T", " ") : "-", col3, infoY + 14, 11, true, C.ink);

  const gap = 17;
  const usable = contentW - gap;
  const leftW = (usable * 1.85) / (1.85 + 0.60);
  const rightW = usable - leftW;
  const gridTop = infoY - 14;
  const gridH = 420;
  const leftX = margin;
  const rightX2 = margin + leftW + gap;
  const gridY = gridTop - gridH;

  const radarH = 250;
  drawCard(page1, leftX, gridTop - radarH, leftW, radarH, rgb(1, 1, 1));
  drawText(page1, "领导力雷达图（7维 / 21子项）", leftX + 12, gridTop - 22, 11, true, C.ink);

  const radarBoxX = leftX + 12;
  const radarBoxY = gridTop - radarH + 12;
  const radarBoxW = leftW - 24;
  const radarBoxH = radarH - 42;

  page1.drawRectangle({
    x: radarBoxX,
    y: radarBoxY,
    width: radarBoxW,
    height: radarBoxH,
    borderColor: rgb(0.70, 0.74, 0.80),
    borderWidth: 1,
    color: rgb(1, 1, 1),
  });

  if (radarPngBytes && radarPngBytes.length > 0) {
    try {
      const img = await pdfDoc.embedPng(radarPngBytes);
      const scale = Math.min(radarBoxW / img.width, radarBoxH / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;
      const ix = radarBoxX + (radarBoxW - w) / 2;
      const iy = radarBoxY + (radarBoxH - h) / 2;
      page1.drawImage(img, { x: ix, y: iy, width: w, height: h });
    } catch {
      drawText(page1, "（雷达图嵌入失败）", radarBoxX + 10, radarBoxY + radarBoxH / 2, 10, false, C.muted);
    }
  } else {
    drawText(page1, "（此处将嵌入雷达图 PNG）", radarBoxX + 10, radarBoxY + radarBoxH / 2, 10, false, C.muted);
  }
  drawText(page1, "PDF 中会嵌入与你网页预览一致的雷达图 PNG。", radarBoxX + 8, radarBoxY + 6, 9, false, C.muted);

  const focusH = gridH - radarH - 12;
  const focusTop = gridTop - radarH - 12;
  drawCard(page1, leftX, focusTop - focusH, leftW, focusH, rgb(1, 1, 1));
  drawText(page1, "关键关注点", leftX + 12, focusTop - 22, 11, true, C.ink);

  let cy = focusTop - 44;
  drawText(page1, "最低3项（能力项）", leftX + 12, cy, 10, true, C.muted);
  cy -= 16;

  function drawChip(page: any, x: number, y: number, text: string, kind: "low" | "high") {
    const padX = 8;
    const padY = 4;
    const size = 10;
    const w = fontB.widthOfTextAtSize(text, size) + padX * 2;
    const h = size + padY * 2;
    page.drawRectangle({
      x,
      y,
      width: w,
      height: h,
      color: kind === "low" ? rgb(0.99, 0.94, 0.94) : rgb(0.94, 0.99, 0.95),
      borderColor: kind === "low" ? rgb(0.94, 0.75, 0.75) : rgb(0.75, 0.94, 0.80),
      borderWidth: 1,
    });
    drawText(page, text, x + padX, y + padY, size, true, C.ink);
    return { w, h };
  }

  let chipX = leftX + 12;
  const chipY1 = cy - 12;
  for (const it of low3.slice(0, 3)) {
    const t = `${it.name} ${it.score != null ? it.score.toFixed(2) : "-"}`;
    const r = drawChip(page1, chipX, chipY1, t, "low");
    chipX += r.w + 6;
    if (chipX > leftX + leftW - 120) break;
  }
  cy -= 38;

  drawText(page1, "最高2项（限制项）", leftX + 12, cy, 10, true, C.muted);
  cy -= 16;

  chipX = leftX + 12;
  const chipY2 = cy - 12;
  for (const it of high2.slice(0, 2)) {
    const t = `${it.name} ${it.score != null ? it.score.toFixed(2) : "-"}`;
    const r = drawChip(page1, chipX, chipY2, t, "high");
    chipX += r.w + 6;
  }
  cy -= 38;

  drawParagraph(
    page1,
    "说明：能力项取最低3；限制项取最高2，用于反映当前最需要被关注的结构特征。",
    leftX + 12,
    cy,
    leftW - 24,
    9,
    12,
    C.muted,
    false
  );

  const kpiH = 78;
  drawCard(page1, rightX2, gridTop - kpiH, rightW, kpiH, C.soft);
  drawText(page1, "综合得分", rightX2 + 12, gridTop - 26, 11, true, C.muted);
  drawText(page1, `${fmt2(result.overall)}`, rightX2 + 12, gridTop - 56, 24, true, C.ink);
  drawText(page1, "/ 5.00", rightX2 + 12 + 64, gridTop - 46, 11, true, C.muted);

  const dimCardTop = gridTop - kpiH - 12;
  const dimCardH = gridH - kpiH - 12;
  drawCard(page1, rightX2, dimCardTop - dimCardH, rightW, dimCardH, rgb(1, 1, 1));
  drawText(page1, "7大维度得分", rightX2 + 12, dimCardTop - 22, 11, true, C.ink);

  let dy = dimCardTop - 44;
  const rowH = 38;
  for (const d of ALL_DIMS) {
    page1.drawRectangle({
      x: rightX2 + 12,
      y: dy - rowH + 8,
      width: rightW - 24,
      height: rowH - 10,
      color: rgb(1, 1, 1),
      borderColor: C.line,
      borderWidth: 1,
    });
    drawText(page1, d, rightX2 + 22, dy - 18, 11, true, C.ink);
    drawText(page1, fmt2((result.dim_scores as any)?.[d]), rightX2 + rightW - 46, dy - 18, 11, true, C.ink);
    dy -= rowH;
    if (dy < gridY + 20) break;
  }

  const insightTop = gridY - 14;
  const insightH = 120;
  drawCard(page1, margin, insightTop - insightH, contentW, insightH, rgb(1, 1, 1));
  drawText(page1, "洞察摘要", margin + 12, insightTop - 22, 11, true, C.ink);
  drawText(page1, "控制在 3～4 行，仅做现状分析", margin + contentW - 190, insightTop - 22, 9, false, C.muted);
  const insightText = String(result.insight_text ?? "").trim() || "—";
  drawParagraph(page1, insightText, margin + 12, insightTop - 44, contentW - 24, 11, 16, C.ink, false);

  const footerY = insightTop - insightH - 16;
  drawText(page1, "保密提示：本报告仅供本人及教练团队用于成长辅导与复盘，不建议公开传播。", margin, footerY, 9, false, C.muted);
  drawText(page1, "量表口径：1.00～5.00；限制项越高代表压力情境下该模式出现概率越高。", margin, footerY - 14, 9, false, C.muted);

  // ---------- PAGE 2 ----------
  const page2 = pdfDoc.addPage([pageW, pageH]);
  drawCard(page2, margin, pageH - margin - headerH, contentW, headerH, rgb(1, 1, 1));
  page2.drawRectangle({
    x: margin + 12,
    y: pageH - margin - headerH + 14,
    width: 36,
    height: 36,
    color: rgb(0.96, 0.94, 0.99),
    borderColor: rgb(0.85, 0.80, 0.98),
    borderWidth: 1,
  });
  drawText(page2, "圆桌", margin + 20, pageH - margin - headerH + 28, 12, true, C.accent);
  drawText(page2, "领导力测评报告", margin + 60, pageH - margin - 26, 16, true, C.ink);
  drawText(page2, "模板B｜明细页（维度 + 子项表格）", margin + 60, pageH - margin - 44, 10, false, C.muted);

  drawText(page2, `姓名：${nameZh || "-"}`, margin + contentW - 220, pageH - margin - 28, 10, false, C.muted);
  drawText(page2, `公司：${companyZh || "-"}`, margin + contentW - 220, pageH - margin - 44, 10, false, C.muted);

  let yTop2 = pageH - margin - headerH - 14;

  drawText(page2, "7大维度得分明细", margin, yTop2, 12, true, C.ink);
  yTop2 -= 14;

  const tableX = margin;
  const tableW = contentW;
  const tableRowH = 26;
  const thH = 28;
  const dimTableH = thH + tableRowH * 7;

  drawCard(page2, tableX, yTop2 - dimTableH, tableW, dimTableH, rgb(1, 1, 1));
  page2.drawRectangle({ x: tableX, y: yTop2 - thH, width: tableW, height: thH, color: C.soft, borderColor: C.line, borderWidth: 1 });
  drawText(page2, "维度", tableX + 10, yTop2 - 18, 10, true, C.muted);
  drawText(page2, "得分", tableX + 260, yTop2 - 18, 10, true, C.muted);
  drawText(page2, "解释", tableX + 330, yTop2 - 18, 10, true, C.muted);

  const dimExplain: Record<string, string> = {
    "成就导向": "关注目标与成果，以行动推进结果；相关子项：使命愿景、战略关注、取得成果。",
    "系统意识": "从全局看结构与因果，做系统化取舍；相关子项：系统思考、平衡、持续产出。",
    "自我觉察": "复盘与学习，保持稳定内核；相关子项：反思自省、学习者、沉着。",
    "协同赋能": "建立信任与合作，发展他人；相关子项：关爱、培育、团队合作。",
    "顺从": "压力下倾向于迎合或回避冲突；相关子项：取悦、被动、保守。",
    "防御": "压力下倾向于自我保护、距离、挑剔；相关子项：傲慢、距离感、挑剔。",
    "控制": "压力下倾向于高标准强推动；相关子项：完美、专制、工作狂。",
  };

  let ry = yTop2 - thH - tableRowH + 8;
  for (const d of ALL_DIMS) {
    page2.drawRectangle({
      x: tableX,
      y: ry - 8,
      width: tableW,
      height: tableRowH,
      color: rgb(1, 1, 1),
      borderColor: C.line,
      borderWidth: 1,
    });
    drawText(page2, d, tableX + 10, ry, 10, true, C.ink);
    drawText(page2, fmt2((result.dim_scores as any)?.[d]), tableX + 260, ry, 10, true, C.ink);
    drawParagraph(page2, dimExplain[d] || "—", tableX + 330, ry + 2, tableW - 340, 9, 11, C.muted, false);
    ry -= tableRowH;
  }
  yTop2 = yTop2 - dimTableH - 18;

  drawText(page2, "21个子项得分明细", margin, yTop2, 12, true, C.ink);
  yTop2 -= 14;

  const low3 = normalizeFocusList(result.focus_low3);
  const high2 = normalizeFocusList(result.focus_high2);
  const lowSet = new Set(low3.map((x) => x.name));
  const highSet = new Set(high2.map((x) => x.name));

  function drawSubTable(title: string, subs: string[], yTop: number, kind: "top" | "bottom") {
    drawText(page2, title, margin, yTop, 10, true, C.muted);
    yTop -= 10;

    const th = 26;
    const rowH2 = 24;
    const h = th + rowH2 * subs.length;
    drawCard(page2, margin, yTop - h, contentW, h, rgb(1, 1, 1));

    page2.drawRectangle({ x: margin, y: yTop - th, width: contentW, height: th, color: C.soft, borderColor: C.line, borderWidth: 1 });
    drawText(page2, "子项", margin + 10, yTop - 17, 10, true, C.muted);
    drawText(page2, "得分", margin + 260, yTop - 17, 10, true, C.muted);
    drawText(page2, "备注", margin + 330, yTop - 17, 10, true, C.muted);

    let yy = yTop - th - rowH2 + 7;
    for (const sub of subs) {
      const isLow = kind === "top" && lowSet.has(sub);
      const isHigh = kind === "bottom" && highSet.has(sub);

      if (isLow) page2.drawRectangle({ x: margin, y: yy - 7, width: contentW, height: rowH2, color: C.lowBg });
      if (isHigh) page2.drawRectangle({ x: margin, y: yy - 7, width: contentW, height: rowH2, color: C.highBg });

      page2.drawRectangle({
        x: margin,
        y: yy - 7,
        width: contentW,
        height: rowH2,
        borderColor: C.line,
        borderWidth: 1,
        color: rgb(1, 1, 1),
        opacity: 0,
      });

      if (isLow) page2.drawRectangle({ x: margin, y: yy - 7, width: 3, height: rowH2, color: rgb(0.92, 0.66, 0.66) });
      if (isHigh) page2.drawRectangle({ x: margin, y: yy - 7, width: 3, height: rowH2, color: rgb(0.66, 0.92, 0.72) });

      drawText(page2, sub, margin + 10, yy, 10, true, C.ink);
      drawText(page2, fmt2((result.sub_scores as any)?.[sub]), margin + 260, yy, 10, true, C.ink);

      if (isLow) {
        drawText(page2, "偏弱", margin + 330, yy, 9, true, rgb(0.86, 0.15, 0.15));
        drawText(page2, "｜建议优先建立稳定机制与清晰口径。", margin + 360, yy, 9, false, C.muted);
      } else if (isHigh) {
        drawText(page2, "偏强", margin + 330, yy, 9, true, rgb(0.10, 0.64, 0.29));
        drawText(page2, "｜建议关注表达方式，降低协作摩擦。", margin + 360, yy, 9, false, C.muted);
      } else {
        drawText(page2, "——", margin + 330, yy, 9, false, C.muted);
      }

      yy -= rowH2;
    }
    return yTop - h - 14;
  }

  yTop2 = drawSubTable("A. 能力子项（上半区 12 项）", SUB_TOP, yTop2, "top");
  yTop2 = drawSubTable("B. 限制子项（下半区 9 项）", SUB_BOTTOM, yTop2, "bottom");

  return await pdfDoc.save();
}

// ---------------- 主函数 ----------------
Deno.serve(async (req) => {
  // ✅ 预检必须先处理（但注意：verify_jwt 必须关闭，否则这里可能执行不到）
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: buildCorsHeaders(req) });
  }

  if (req.method !== "POST") {
    return jsonResponse(req, { ok: false, error: "Method Not Allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !serviceKey) {
      return jsonResponse(
        req,
        { ok: false, error: "Missing SUPABASE_URL/PROJECT_URL or SUPABASE_SERVICE_ROLE_KEY/SERVICE_ROLE_KEY" },
        500
      );
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ✅ 你自己的鉴权
    const user = await assertAdminByJwt(req, admin);

    const payload = await readJsonBody(req);
    const submissionId = payload?.submission_id;
    const mode = payload?.mode; // "signed_url" | undefined
    const radarDataUrl = payload?.radar_png_data_url as string | undefined;
    const displayFileNameFromClient = payload?.display_file_name as string | undefined;

    if (!submissionId || typeof submissionId !== "string") {
      return jsonResponse(req, { ok: false, error: "Missing submission_id" }, 400);
    }

    const { data: submission, error: subErr } = await admin
      .from("submissions")
      .select("id, name, company, subscores, dimscores, insight_text, focus_low3, focus_high2, created_at")
      .eq("id", submissionId)
      .single();

    if (subErr || !submission) {
      return jsonResponse(req, { ok: false, error: "Submission not found", details: subErr?.message ?? null }, 404);
    }

    const result = scoreSubmission(submission);

    const { data: reportRow, error: repErr } = await admin
      .from("reports")
      .upsert(
        { submission_id: submissionId, report_json: result, updated_at: new Date().toISOString() },
        { onConflict: "submission_id" }
      )
      .select("id, submission_id, created_at, pdf_path, file_name, radar_path")
      .single();

    if (repErr || !reportRow) {
      return jsonResponse(req, { ok: false, error: "Failed to upsert report", details: repErr?.message ?? null }, 500);
    }

    const reportId = reportRow.id as string;
    const bucket = Deno.env.get("REPORTS_BUCKET") ?? "Reports";

    const nameZh = String(submission.name ?? "").trim();
    const companyZh = String(submission.company ?? "").trim();
    // ✅ 文件名：姓名 + 公司 + 个人领导力报告.pdf
    // ✅ 文件名：姓名-公司-个人领导力报告.pdf
    const baseNameZh = `${nameZh || ""}-${companyZh || ""}-个人领导力报告.pdf`
      .replace(/^-+/, "")   // 防止姓名为空导致开头是 "-"
      .replace(/-+$/, "")   // 防止公司为空导致结尾是 "-"
      .replace(/--+/g, "-"); // 防止出现多个连续 "-"

    const displayFileName =
      safeDisplayFileName(displayFileNameFromClient || baseNameZh) || "个人领导力报告.pdf";



    // 只要下载链接
    if (mode === "signed_url") {
      const pdfPath = reportRow.pdf_path;
      if (!pdfPath) {
        return jsonResponse(req, { ok: false, error: "该报告还没有生成 pdf_path，请先点击生成PDF(含雷达图)" }, 400);
      }
      const { data: signed, error: signErr } = await admin.storage.from(bucket).createSignedUrl(pdfPath, 60 * 10);
      if (signErr || !signed?.signedUrl) {
        return jsonResponse(req, { ok: false, error: "Failed to create signed url", details: signErr?.message ?? null }, 500);
      }
      return jsonResponse(req, {
        ok: true,
        report: reportRow,
        result,
        pdf: { bucket, path: pdfPath, filename: displayFileName, url: signed.signedUrl },
        user: { id: user.id, email: user.email },
      });
    }

    // 解析雷达图 PNG（可选）
    let radarPngBytes: Uint8Array | null = null;
    if (radarDataUrl) radarPngBytes = parsePngDataUrl(radarDataUrl);

    // 先存 radar
    let radarPath: string | null = null;
    if (radarPngBytes) {
      radarPath = `radar/${reportId}/radar.png`;
      const pngBlob = new Blob([radarPngBytes], { type: "image/png" });
      const { error: upPngErr } = await admin.storage.from(bucket).upload(radarPath, pngBlob, {
        contentType: "image/png",
        upsert: true,
      });
      if (upPngErr) {
        return jsonResponse(req, { ok: false, error: "Failed to upload radar png", details: upPngErr.message ?? String(upPngErr) }, 500);
      }
    }

    // 生成 PDF
    const pdfBytes = await buildPdfBytes({
      submission,
      result,
      reportId,
      radarPngBytes,
      adminClient: admin,
      supabaseUrl,
      serviceKey,
    });

    const nameAscii = safeFilePartAscii(nameZh);
    const companyAscii = safeFilePartAscii(companyZh);
    const storageFileName = `${nameAscii}-${companyAscii}-leadership-report.pdf`.replace(/^[-_]+/, "");
    const pdfPath = `pdf/${reportId}/${storageFileName}`;

    const pdfBlob = new Blob([pdfBytes], { type: "application/pdf" });
    const { error: upErr } = await admin.storage.from(bucket).upload(pdfPath, pdfBlob, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (upErr) {
      return jsonResponse(req, { ok: false, error: "Failed to upload PDF", details: upErr.message ?? String(upErr) }, 500);
    }

    await admin
      .from("reports")
      .update({
        status: "done",
        error: null,
        pdf_path: pdfPath,
        radar_path: radarPath,
        file_name: displayFileName,
        updated_at: new Date().toISOString(),
      })
      .eq("id", reportId);

    const { data: signed, error: signErr } = await admin.storage.from(bucket).createSignedUrl(pdfPath, 60 * 10);
    if (signErr || !signed?.signedUrl) {
      return jsonResponse(req, { ok: false, error: "Failed to create signed url", details: signErr?.message ?? null }, 500);
    }

    return jsonResponse(req, {
      ok: true,
      report: reportRow,
      result,
      pdf: { bucket, path: pdfPath, storage_key: storageFileName, filename: displayFileName, url: signed.signedUrl },
      radar: radarPath ? { bucket, path: radarPath } : null,
      user: { id: user.id, email: user.email },
    });
  } catch (e: any) {
    const status = Number(e?.status ?? 500);
    return jsonResponse(req, { ok: false, error: e?.message ?? "Unknown error" }, status);
  }
});
