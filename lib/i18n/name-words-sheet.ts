/** The offline review sheet for name words: one HTML file, nothing loaded from the web, progress kept in the reviewer's browser. */
export function sheet(rows: { word: string; fighters: number; fully: number; suggestion?: string }[]): string {
  const data = JSON.stringify(rows).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Arabic spellings of name words</title>
<style>body{font:15px system-ui;margin:0 auto;max-width:760px;padding:16px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #8884;padding:6px;text-align:start}input{font:18px system-ui;width:100%;direction:rtl;box-sizing:border-box}button{font:inherit;padding:4px 10px}.done{opacity:.5}.sticky{position:sticky;top:0;background:Canvas;padding:8px 0}</style>
<h1>Arabic spellings of name words</h1>
<p>Each row is one word from fighters' names, with the machine's suggested Arabic (as Arabic sports media would write it). <b>Looks right</b> approves it; or fix the Arabic and press <b>Save edit</b>; <b>Skip</b> leaves it. Words you approve are shown on fighter pages. Your progress is kept in this browser; press <b>Download</b> when you stop and send the file back.</p>
<div class="sticky"><span id="n"></span> <button id="dl">Download my review</button> <input id="q" placeholder="search" style="width:40%;direction:ltr"></div>
<table><thead><tr><th>Word</th><th>Fighters</th><th>Arabic</th><th></th></tr></thead><tbody id="b"></tbody></table>
<script>
const ROWS=${data};const KEY="ringside-name-words-"+ROWS.length;let st={};try{st=JSON.parse(localStorage.getItem(KEY)||"{}")}catch(e){}
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(st))}catch(e){}};
const b=document.getElementById("b"),n=document.getElementById("n"),q=document.getElementById("q");
function draw(){b.textContent="";const f=q.value.toLowerCase();let done=0;ROWS.forEach((r,i)=>{const s=st[r.word];if(s)done++;if(f&&!r.word.toLowerCase().includes(f)&&!(r.suggestion||"").includes(f))return;
const tr=document.createElement("tr");if(s)tr.className="done";
const w=document.createElement("td");w.lang="en";w.dir="ltr";w.textContent=r.word;
const c=document.createElement("td");c.textContent=r.fighters+" (complete: "+r.fully+")";
const a=document.createElement("td");const inp=document.createElement("input");inp.value=(s&&s.ar)||r.suggestion||"";inp.lang="ar";a.append(inp);
const k=document.createElement("td");
const ok=document.createElement("button");ok.textContent="Looks right";ok.onclick=()=>{st[r.word]={ar:inp.value.trim(),edited:inp.value.trim()!==(r.suggestion||"")};save();draw()};
const sk=document.createElement("button");sk.textContent="Skip";sk.onclick=()=>{delete st[r.word];save();draw()};
k.append(ok," ",sk);tr.append(w,c,a,k);b.append(tr)});n.textContent=done+" of "+ROWS.length+" reviewed"}
q.oninput=draw;
document.getElementById("dl").onclick=()=>{const o={words:st};const l=document.createElement("a");l.href=URL.createObjectURL(new Blob([JSON.stringify(o,null,1)],{type:"application/json"}));l.download="name-words-review.json";l.click()};
draw();
</script></html>`;
}

