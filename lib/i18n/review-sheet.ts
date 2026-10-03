import type { Flag, Value } from "./review";

/** What the offline review sheet is built from. Everything is embedded in the page: it needs no server and loads nothing from the web. */
export interface SheetData {
  build: string;
  generatedAt: string;
  entries: { key: string; group: string; files: string[]; plural: string | null; ar: Value; status: "machine" | "reviewed" | "changed"; flags: Flag[] }[];
  groups: string[];
  glossary: { term: string; ar: string; strings: number; missing: { key: string; ar: string }[] }[];
  names: { en: string; ar: string; source: string; reviewed: boolean }[];
  questions: { title: string; body: string }[];
}

const embed = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c").replace(new RegExp("[\\u2028\\u2029]", "g"), " ");

/** The self-contained HTML a native speaker opens in a browser: filter, edit, approve, flag, and download their changes as one JSON file. */
export function buildSheet(data: SheetData): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ringside: Arabic review</title>
<style>
:root{--bg:#0b0b0e;--panel:#14141a;--panel2:#1b1b23;--line:#2a2a34;--text:#ecebe6;--muted:#9a9aa6;--gold:#d9b25f;--red:#ff6a64;--green:#3ecf8e;--blue:#6aa3ff}
@media (prefers-color-scheme:light){:root{--bg:#f6f5f1;--panel:#fff;--panel2:#efeee9;--line:#d8d6cf;--text:#191919;--muted:#5d5d66;--gold:#8a6a1c;--red:#b3261e;--green:#1c7a52;--blue:#1e5bc6}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
header{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line);padding:10px 16px}
h1{font-size:18px;margin:0 0 6px}main{max-width:980px;margin:0 auto;padding:16px}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
input,select,textarea,button{font:inherit;color:inherit;background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:6px 10px}
button{cursor:pointer}button:hover{border-color:var(--gold)}button.on{border-color:var(--gold);color:var(--gold)}
button.primary{background:var(--gold);color:#111;border-color:var(--gold);font-weight:600}
:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
nav.tabs{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:10px 0}
.card.flag{border-color:var(--red)}.card.done{border-color:var(--green)}.card.edit{border-color:var(--gold)}
.meta{display:flex;flex-wrap:wrap;gap:6px;font-size:12px;color:var(--muted);margin-bottom:6px}
.chip{border:1px solid var(--line);border-radius:99px;padding:1px 8px;font-size:12px}
.chip.check{border-color:var(--red);color:var(--red)}.chip.note{border-color:var(--gold);color:var(--gold)}.chip.ok{border-color:var(--green);color:var(--green)}
.en{direction:ltr;text-align:left;margin:4px 0;font-size:15px}.en mark{background:transparent;color:var(--blue);font-weight:600}
textarea.ar{width:100%;min-height:54px;direction:rtl;text-align:right;font-size:18px;line-height:1.7;font-family:"Geeza Pro","Noto Naskh Arabic","Segoe UI",sans-serif;resize:vertical}
.forms{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px}.forms label{display:block;font-size:12px;color:var(--muted)}
.warn{color:var(--red);font-size:13px;margin:4px 0}.actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.note{width:100%;margin-top:6px}small,.muted{color:var(--muted)}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
td.a{direction:rtl;text-align:right}ul.q li{margin:10px 0}.sr{position:absolute;left:-9999px}
.progress{height:6px;background:var(--panel2);border-radius:9px;overflow:hidden;min-width:160px}.progress>i{display:block;height:100%;background:var(--green)}
[hidden]{display:none!important}
</style></head><body>
<header>
  <h1>Ringside · Arabic review <small class="muted" id="build"></small></h1>
  <div class="bar">
    <label>Your name <input id="reviewer" size="18" autocomplete="name"></label>
    <span id="count" class="muted" aria-live="polite"></span><span class="progress" aria-hidden="true"><i id="bar"></i></span>
    <button id="export" class="primary" title="Saves everything you have approved, edited or flagged to a file you send back">Download my review</button>
    <button id="resume" title="Load a file you downloaded earlier and carry on">Continue from a file…</button><input id="file" type="file" accept=".json,application/json" hidden>
  </div>
  <nav class="tabs" aria-label="Sections"><button data-tab="help" class="on">Start here</button><button data-tab="questions">Questions for you</button><button data-tab="strings">Strings</button><button data-tab="terms">Terminology</button><button data-tab="names">Names</button></nav>
</header>
<main>
<section id="tab-help">
  <div class="card"><h2>What this is</h2>
  <p>Every Arabic sentence on the site was written by a machine. Nothing here is marked “reviewed” until you say so. For each string you can <b>approve it as it is</b>, <b>edit it</b>, or <b>flag it for discussion</b>. Then press “Download my review” and send the file back; it is checked and applied.</p>
  <p>Work in whatever order suits you. Strings are listed most-seen first (navigation, home, fighter pages). You do not have to finish: whatever you do not touch simply stays “machine-written”. Your work is saved in this browser as you go.</p>
  <p dir="rtl" lang="ar" style="font-size:18px;line-height:1.8"><b>ما هذا؟</b> كُتبت كل جملة عربية في الموقع بواسطة آلة، ولا تُعدّ أي جملة «مراجَعة» إلا إذا أقررتها أنت. لكل جملة يمكنك <b>إقرارها كما هي</b> أو <b>تعديلها</b> أو <b>وضع علامة للنقاش</b>. ثم اضغط «Download my review» وأرسل الملف. لا يلزمك إنهاء كل شيء؛ ما لا تلمسه يبقى «كتابة آلية».</p></div>
  <div class="card"><h2>What to look at</h2><ul>
  <li><b>Meaning:</b> does the Arabic say what the English says, with the same numbers?</li>
  <li><b>Register:</b> modern standard Arabic, the way a Saudi sports desk writes. Too stiff? Too colloquial?</li>
  <li><b>Gender:</b> the English often says he/she. The site aims for wording that works for either, or has both forms. Flag anything that reads as male-only when it could be a woman.</li>
  <li><b>Keep the {placeholders} and &lt;tags&gt;</b> exactly: they are filled in by the site (names, numbers). The sheet warns you if one goes missing.</li>
  <li><b>Plural strings</b> have six forms (zero, one, two, few, many, other); the example number shows which is which.</li>
  <li>Red chips are mechanical checks that probably need a change; gold chips are only notes and are often fine.</li></ul></div>
</section>
<section id="tab-questions" hidden><div id="qs"></div></section>
<section id="tab-strings" hidden>
  <div class="bar" style="margin:8px 0"><select id="group" aria-label="Group"></select><select id="stat" aria-label="Show"><option value="">All</option><option value="untouched">Not yet reviewed by you</option><option value="approved">Approved</option><option value="edited">Edited</option><option value="flagged">Flagged</option><option value="checks">Has a red check</option><option value="notes">Has a note</option></select><input id="q" type="search" placeholder="Search English or Arabic" size="26" aria-label="Search"></div>
  <div id="list"></div><p><button id="more">Show more</button></p>
</section>
<section id="tab-terms" hidden><p class="muted">Boxing terms the site says the same way every time. If a rendering is wrong, write the better one: it goes back to the glossary and the strings that do not use it are listed.</p><div id="terms"></div></section>
<section id="tab-names" hidden><p class="muted">Arabic spellings of fighter, trainer, gym, event and place names. Most are machine transliterations of fictional demo names; real names need a person who knows how each is written in Arabic. Edit the Arabic, or tick “OK” for the ones that are right.</p><div class="bar" style="margin:8px 0"><select id="nstat" aria-label="Show names"><option value="">All</option><option value="untouched">Not yet reviewed by you</option><option value="approved">OK</option><option value="edited">Edited</option></select><input id="nq" type="search" placeholder="Search" size="22" aria-label="Search names"></div><div id="nlist"></div><p><button id="nmore">Show more</button></p></section>
</main>
<script id="data" type="application/json">${embed(data)}</script>
<script>
(function(){
var D=JSON.parse(document.getElementById("data").textContent);
var KEY="ringside-arabic-review:"+D.build;
var S={reviewer:"",e:{},n:{},g:{}};try{S=Object.assign(S,JSON.parse(localStorage.getItem(KEY)||"{}"))}catch(_){}
var $=function(id){return document.getElementById(id)};
var FORMS=["zero","one","two","few","many","other"],EX={zero:0,one:1,two:2,few:3,many:11,other:100};
function save(){try{localStorage.setItem(KEY,JSON.stringify(S))}catch(_){}progress()}
function el(t,a,c){var x=document.createElement(t);for(var k in (a||{})){if(k==="class")x.className=a[k];else if(k==="text")x.textContent=a[k];else x.setAttribute(k,a[k])}(c||[]).forEach(function(y){x.appendChild(typeof y==="string"?document.createTextNode(y):y)});return x}
function ph(s){return (String(s).match(/\\{\\w+\\}|<\\/?\\w+>/g)||[]).sort().join(" ")}
function arText(e){return typeof e.ar==="string"?e.ar:e.ar.other}
function cur(e){var st=S.e[e.key];return st&&st.ar!==undefined?st.ar:e.ar}
function mark(en){var f=document.createDocumentFragment(),parts=en.split(/(\\{\\w+\\}|<\\/?\\w+>)/);parts.forEach(function(p){f.appendChild(/^[{<]/.test(p)?el("mark",{text:p}):document.createTextNode(p))});return f}
function problems(e,val){var out=[],want=ph(e.key);var vals=typeof val==="string"?[val]:Object.keys(val).map(function(k){return val[k]});
 if(e.plural===null){vals.forEach(function(v){if(ph(v)!==want)out.push("placeholders should be: "+(want||"none"))})}else if(typeof val==="object"){FORMS.forEach(function(f){if(!String(val[f]||"").trim())out.push("the "+f+" form is empty")})}
 if(vals.some(function(v){return !String(v).trim()}))out.push("empty text");return out.filter(function(x,i,a){return a.indexOf(x)===i})}
var page={strings:50,names:100};
function filtered(){var g=$("group").value,s=$("stat").value,q=$("q").value.trim().toLowerCase();
 return D.entries.filter(function(e){var st=(S.e[e.key]||{}).status;
  if(g&&e.group!==g)return false;
  if(s==="untouched"&&st)return false;if(s==="approved"&&st!=="approved")return false;if(s==="edited"&&st!=="edited")return false;if(s==="flagged"&&st!=="flagged")return false;
  if(s==="checks"&&!e.flags.some(function(f){return f.severity==="check"}))return false;if(s==="notes"&&!e.flags.some(function(f){return f.severity==="note"}))return false;
  if(q&&(e.key+" "+JSON.stringify(e.ar)).toLowerCase().indexOf(q)<0)return false;return true})}
function setStatus(e,status,patch){S.e[e.key]=Object.assign({},S.e[e.key]||{},{status:status},patch||{});save()}
function card(e){
 var st=S.e[e.key]||{},c=el("article",{class:"card "+(st.status==="flagged"?"flag":st.status==="approved"?"done":st.status==="edited"?"edit":""),"aria-label":e.key});
 var meta=el("div",{class:"meta"},[el("span",{class:"chip",text:e.group})]);
 if(e.status==="reviewed")meta.appendChild(el("span",{class:"chip ok",text:"reviewed before"}));if(e.status==="changed")meta.appendChild(el("span",{class:"chip note",text:"changed since last review"}));
 e.flags.forEach(function(f){meta.appendChild(el("span",{class:"chip "+f.severity,text:f.note,title:f.code}))});
 if(st.status)meta.appendChild(el("span",{class:"chip ok",text:"you: "+st.status}));
 c.appendChild(meta);
 var en=el("div",{class:"en"});en.appendChild(mark(e.key));c.appendChild(en);
 if(e.plural!==null){var one=el("div",{class:"en muted"});one.appendChild(document.createTextNode("(singular: "));one.appendChild(mark(e.plural));one.appendChild(document.createTextNode(")"));c.appendChild(one)}
 var warn=el("div",{class:"warn","aria-live":"polite"});
 var onEdit=function(){var v=read();var p=problems(e,v);warn.textContent=p.join(" · ");var changed=JSON.stringify(v)!==JSON.stringify(e.ar);if(changed&&!p.length)setStatus(e,"edited",{ar:v});else if(!changed&&(S.e[e.key]||{}).status==="edited"){delete S.e[e.key].ar;setStatus(e,"approved")}};
 var inputs={};
 function read(){if(e.plural===null)return inputs.one.value;var o={};FORMS.forEach(function(f){o[f]=inputs[f].value});return o}
 var value=cur(e);
 if(e.plural===null){var t=el("textarea",{class:"ar",lang:"ar",dir:"rtl","aria-label":"Arabic for: "+e.key});t.value=value;t.addEventListener("input",onEdit);inputs.one=t;c.appendChild(t)}
 else{var grid=el("div",{class:"forms"});FORMS.forEach(function(f){var lab=el("label",{text:f+" (e.g. "+EX[f]+")"});var t=el("textarea",{class:"ar",lang:"ar",dir:"rtl","aria-label":f+" form for: "+e.key});t.value=value[f]||"";t.addEventListener("input",onEdit);inputs[f]=t;lab.appendChild(t);grid.appendChild(lab)});c.appendChild(grid)}
 c.appendChild(warn);
 var acts=el("div",{class:"actions"});
 var ok=el("button",{type:"button",text:"✓ Looks right"});ok.addEventListener("click",function(){var v=read();var p=problems(e,v);if(p.length){warn.textContent=p.join(" · ");return}var changed=JSON.stringify(v)!==JSON.stringify(e.ar);setStatus(e,changed?"edited":"approved",changed?{ar:v}:{});render()});
 var fl=el("button",{type:"button",text:"⚑ Needs discussion"});var note=el("input",{class:"note",placeholder:"What is the question? (optional)","aria-label":"Note for: "+e.key,hidden:""});note.value=st.note||"";
 fl.addEventListener("click",function(){note.hidden=false;note.focus();setStatus(e,"flagged",{note:note.value})});note.addEventListener("input",function(){setStatus(e,"flagged",{note:note.value})});if(st.status==="flagged")note.hidden=false;
 var rs=el("button",{type:"button",text:"Reset"});rs.addEventListener("click",function(){delete S.e[e.key];save();render()});
 acts.appendChild(ok);acts.appendChild(fl);acts.appendChild(rs);c.appendChild(acts);c.appendChild(note);return c}
function render(){var list=filtered(),box=$("list");box.textContent="";list.slice(0,page.strings).forEach(function(e){box.appendChild(card(e))});$("more").hidden=list.length<=page.strings;$("more").textContent="Show more ("+(list.length-page.strings)+" left)";if(!list.length)box.appendChild(el("p",{class:"muted",text:"Nothing matches."}));progress()}
function progress(){var t=Object.keys(S.e).length,tn=Object.keys(S.n).length;$("count").textContent=t+" of "+D.entries.length+" strings and "+tn+" names touched";$("bar").style.width=(100*t/D.entries.length)+"%"}
function nfiltered(){var s=$("nstat").value,q=$("nq").value.trim().toLowerCase();return D.names.filter(function(n){var st=(S.n[n.en]||{}).status;if(s==="untouched"&&st)return false;if(s==="approved"&&st!=="approved")return false;if(s==="edited"&&st!=="edited")return false;if(q&&(n.en+" "+n.ar).toLowerCase().indexOf(q)<0)return false;return true})}
function nrender(){var l=nfiltered(),box=$("nlist");box.textContent="";var t=el("table",{},[]);l.slice(0,page.names).forEach(function(n){var st=S.n[n.en]||{};var tr=el("tr");tr.appendChild(el("td",{text:n.en}));var inp=el("input",{lang:"ar",dir:"rtl","aria-label":"Arabic for "+n.en,size:"24"});inp.value=st.ar!==undefined?st.ar:n.ar;inp.addEventListener("input",function(){if(inp.value!==n.ar&&inp.value.trim()){S.n[n.en]={status:"edited",ar:inp.value.trim()}}else{delete S.n[n.en]}save()});var td=el("td",{class:"a"});td.appendChild(inp);tr.appendChild(td);var ok=el("input",{type:"checkbox","aria-label":"OK: "+n.en});ok.checked=st.status==="approved";ok.addEventListener("change",function(){if(ok.checked)S.n[n.en]={status:"approved"};else delete S.n[n.en];save()});var tk=el("td");tk.appendChild(ok);tk.appendChild(document.createTextNode(" OK"));tr.appendChild(tk);t.appendChild(tr)});box.appendChild(t);$("nmore").hidden=l.length<=page.names;$("nmore").textContent="Show more ("+(l.length-page.names)+" left)"}
function terms(){var box=$("terms");box.textContent="";var t=el("table");t.appendChild(el("tr",{},[el("th",{text:"English term"}),el("th",{text:"Arabic used"}),el("th",{text:"Strings"}),el("th",{text:"Strings that do not seem to use it"})]));
 D.glossary.forEach(function(g){var tr=el("tr");tr.appendChild(el("td",{text:g.term}));var td=el("td",{class:"a"});var inp=el("input",{lang:"ar",dir:"rtl","aria-label":"Arabic for the term "+g.term,size:"20"});inp.value=(S.g[g.term]!==undefined?S.g[g.term]:g.ar);inp.addEventListener("input",function(){if(inp.value.trim()&&inp.value!==g.ar)S.g[g.term]=inp.value.trim();else delete S.g[g.term];save()});td.appendChild(inp);tr.appendChild(td);tr.appendChild(el("td",{text:String(g.strings)}));
  var m=el("td");if(g.missing.length){var d=el("details");d.appendChild(el("summary",{text:g.missing.length+" to look at"}));var ul=el("ul");g.missing.slice(0,40).forEach(function(x){ul.appendChild(el("li",{text:x.key+"  →  "+x.ar}))});d.appendChild(ul);m.appendChild(d)}else m.textContent="–";tr.appendChild(m);t.appendChild(tr)});box.appendChild(t)}
function questions(){var box=$("qs");D.questions.forEach(function(q){var c=el("div",{class:"card"});c.appendChild(el("h2",{text:q.title}));c.appendChild(el("p",{text:q.body}));var ta=el("textarea",{rows:"3",style:"width:100%","aria-label":"Your answer: "+q.title,placeholder:"Your answer (any language)"});ta.value=S.q&&S.q[q.title]||"";ta.addEventListener("input",function(){(S.q=S.q||{})[q.title]=ta.value;save()});c.appendChild(ta);box.appendChild(c)})}
function tab(name){["help","questions","strings","terms","names"].forEach(function(t){$("tab-"+t).hidden=t!==name});document.querySelectorAll("nav.tabs button").forEach(function(b){b.classList.toggle("on",b.dataset.tab===name)});if(name==="strings")render();if(name==="names")nrender()}
document.querySelectorAll("nav.tabs button").forEach(function(b){b.addEventListener("click",function(){tab(b.dataset.tab)})});
$("group").appendChild(el("option",{value:"",text:"All groups"}));D.groups.forEach(function(g){var n=D.entries.filter(function(e){return e.group===g}).length;if(n)$("group").appendChild(el("option",{value:g,text:g+" ("+n+")"}))});
["group","stat","q"].forEach(function(i){$(i).addEventListener("input",function(){page.strings=50;render()})});$("more").addEventListener("click",function(){page.strings+=50;render()});
["nstat","nq"].forEach(function(i){$(i).addEventListener("input",function(){page.names=100;nrender()})});$("nmore").addEventListener("click",function(){page.names+=100;nrender()});
$("reviewer").value=S.reviewer||"";$("reviewer").addEventListener("input",function(){S.reviewer=$("reviewer").value;save()});$("build").textContent="build "+D.build+" · "+D.entries.length+" strings";
$("export").addEventListener("click",function(){var name=($("reviewer").value||"").trim();if(!name){alert("Please type your name first (top left): the review is recorded under it.");$("reviewer").focus();return}
 var entries=[],bad=[];Object.keys(S.e).forEach(function(k){var st=S.e[k],e=D.entries.find(function(x){return x.key===k});if(!e)return;var o={key:k,status:st.status};if(st.status==="edited"){o.ar=st.ar;var p=problems(e,st.ar);if(p.length){bad.push(k);return}}if(st.status==="flagged")o.note=st.note||"";entries.push(o)});
 if(bad.length&&!confirm(bad.length+" edited strings have a problem (a missing {placeholder} or an empty plural form) and will be left out. Continue?"))return;
 var names=Object.keys(S.n).map(function(k){return {en:k,ar:S.n[k].ar||(D.names.find(function(n){return n.en===k})||{}).ar||"",status:S.n[k].status}});
 var glossary=Object.keys(S.g).map(function(k){return {term:k,ar:S.g[k]}});
 var out={format:"ringside-arabic-review/1",reviewer:name,at:new Date().toISOString(),build:D.build,entries:entries,names:names,glossary:glossary,answers:S.q||{}};
 var a=el("a",{href:URL.createObjectURL(new Blob([JSON.stringify(out,null,1)],{type:"application/json"})),download:"arabic-review-"+name.replace(/[^\\w]+/g,"-")+"-"+out.at.slice(0,10)+".json"});document.body.appendChild(a);a.click();a.remove()});
$("resume").addEventListener("click",function(){$("file").click()});
$("file").addEventListener("change",function(){var f=$("file").files[0];if(!f)return;f.text().then(function(t){var j=JSON.parse(t);if(j.reviewer){S.reviewer=j.reviewer;$("reviewer").value=j.reviewer}(j.entries||[]).forEach(function(x){S.e[x.key]={status:x.status,ar:x.ar,note:x.note}});(j.names||[]).forEach(function(x){S.n[x.en]={status:x.status,ar:x.ar}});(j.glossary||[]).forEach(function(x){S.g[x.term]=x.ar});S.q=j.answers||S.q;save();render();nrender();terms()}).catch(function(){alert("That file could not be read.")})});
questions();terms();progress();
})();
</script></body></html>
`;
}
