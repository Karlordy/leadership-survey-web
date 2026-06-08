function $(id){return document.getElementById(id);}
function setErr(msg){$("err").textContent = msg || "";}
function norm(s){return (s||"").trim();}
$("startBtn").addEventListener("click", ()=>{
  const name = norm($("name").value);
  const company = norm($("company").value);
  if(!name) return setErr("请填写真实姓名。");
  if(!company) return setErr("请填写公司名。");
  sessionStorage.setItem("rt_name", name);
  sessionStorage.setItem("rt_company", company);
  window.location.href = "./survey.html";
});
