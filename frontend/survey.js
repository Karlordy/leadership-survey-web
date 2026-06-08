let DATA = null;
let answers = {};
let page = 0;
const pageSize = 32;

// ✅ 9档选项：1~5，步长0.5
const SCALE_OPTIONS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

// ✅ 文字只给整数档
const SCALE_LABELS = {
  1: "非常不同意",
  2: "不同意",
  3: "一般",
  4: "同意",
  5: "非常同意",
};

function $(id) { return document.getElementById(id); }

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[s]));
}
function norm(s) { return (s || "").trim(); }

async function loadData() {
  const res = await fetch("./questions.json");
  if (!res.ok) throw new Error("无法加载 questions.json");
  DATA = await res.json();
}

function updateProgress() {
  const total = DATA.questions.length;
  const done = Object.keys(answers).filter(k => answers[k] != null).length;
  const pct = Math.round(done / total * 100);
  $("progressBar").style.width = pct + "%";
  $("progressText").textContent = `${done} / ${total}`;
}

function updatePageHint() {
  const total = DATA.questions.length;
  const start = page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, total);
  const maxPage = Math.ceil(total / pageSize);

  const text = `当前页：第 ${start}–${end} 题（共 ${total} 题｜第 ${page + 1}/${maxPage} 页）`;
  const el1 = $("pageHint");
  const el2 = $("pageHint2");
  if (el1) el1.textContent = text;
  if (el2) el2.textContent = text;

  // 按页禁用按钮（体验更明确）
  const btnPrev = $("btnPrev");
  const btnNext = $("btnNext");
  if (btnPrev) btnPrev.disabled = page <= 0;
  if (btnNext) btnNext.disabled = page >= maxPage - 1;
}

function renderPage() {
  const list = $("questionList");
  list.innerHTML = "";

  const start = page * pageSize;
  const end = start + pageSize;
  const qs = DATA.questions.slice(start, end);

  for (const q of qs) {
    const el = document.createElement("div");
    el.className = "q";

    el.innerHTML = `
      <div class="qHead">
        <div class="qTitle">Q${q.id}. ${escapeHtml(q.text)}</div>
      </div>

      <div class="scale" data-qid="${q.id}">
        ${SCALE_OPTIONS.map(v => {
          const active = Number(answers[q.id]) === v;
          const label = SCALE_LABELS[v]; // 半分档为 undefined
          return `
            <label class="opt ${active ? "active" : ""}">
              <input type="radio" name="q_${q.id}" value="${v}" ${active ? "checked" : ""}/>
              <div><b>${v}</b></div>
              ${label ? `<div class="small muted">${escapeHtml(label)}</div>` : ``}
            </label>
          `;
        }).join("")}
      </div>
    `;

    list.appendChild(el);

    const scale = el.querySelector(".scale");
    scale.addEventListener("click", (e) => {
      const opt = e.target.closest(".opt");
      if (!opt) return;

      const v = parseFloat(opt.querySelector("input").value);
      answers[q.id] = v;

      scale.querySelectorAll(".opt").forEach(o => o.classList.remove("active"));
      opt.classList.add("active");

      updateProgress();
    });
  }

  updateProgress();
  updatePageHint();
}

function firstUnanswered() {
  for (const q of DATA.questions) {
    if (answers[q.id] == null) return q.id;
  }
  return null;
}

function jumpToUnanswered() {
  const qid = firstUnanswered();
  if (qid == null) { alert("已全部作答 ✅"); return; }

  const idx = DATA.questions.findIndex(q => q.id === qid);
  page = Math.floor(idx / pageSize);

  renderPage();

  setTimeout(() => {
    const el = document.querySelector(`.scale[data-qid="${qid}"]`);
    if (el) el.closest(".q").scrollIntoView({ behavior: "smooth", block: "center" });
  }, 50);
}

async function submit() {
  $("submitErr").textContent = "";
  const name = norm(sessionStorage.getItem("rt_name"));
  const company = norm(sessionStorage.getItem("rt_company"));
  if (!name || !company) { $("submitErr").textContent = "缺少姓名/公司信息，请返回首页重新开始。"; return; }

  const missing = firstUnanswered();
  if (missing != null) { $("submitErr").textContent = "还有未作答题目，请先完成作答。"; jumpToUnanswered(); return; }

  const url = window.SUPABASE_URL;
  const anon = window.SUPABASE_ANON_KEY;
  const fnName = window.SUPABASE_FUNCTION_NAME || "submit-survey";
  if (!url || String(url).includes("YOUR_PROJECT_REF") || !anon || String(anon).includes("YOUR_SUPABASE")) {
    $("submitErr").textContent = "尚未配置 Supabase。请在 config.js 填入 SUPABASE_URL 与 SUPABASE_ANON_KEY。";
    return;
  }

  const endpoint = `${url.replace(/\/$/, "")}/functions/v1/${fnName}`;
  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${anon}`,
        "apikey": anon
      },
      body: JSON.stringify({
        name,
        company,
        answers_raw: answers,     // 包含小数
        questions_version: "v1",
        scale_step: 0.5,
      })
    });

    const out = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      $("submitErr").textContent = (out && out.error) ? out.error : `提交失败（${resp.status}）`;
      return;
    }

    sessionStorage.removeItem("rt_name");
    sessionStorage.removeItem("rt_company");
    window.location.href = "./done.html";
  } catch (e) {
    $("submitErr").textContent = "网络或服务异常，请稍后重试。";
  }
}

(async function init() {
  await loadData();

  const name = norm(sessionStorage.getItem("rt_name"));
  const company = norm(sessionStorage.getItem("rt_company"));
  $("who").textContent = name && company ? `${name}｜${company}` : "";

  $("btnPrev").addEventListener("click", () => {
    page = Math.max(0, page - 1);
    renderPage();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  $("btnNext").addEventListener("click", () => {
    const maxPage = Math.ceil(DATA.questions.length / pageSize) - 1;
    page = Math.min(maxPage, page + 1);
    renderPage();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  $("btnJump").addEventListener("click", jumpToUnanswered);
  $("submitBtn").addEventListener("click", submit);

  renderPage();
})();
