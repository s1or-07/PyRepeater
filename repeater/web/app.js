const DEFAULT_REQ =
  "GET / HTTP/1.1\n" +
  "Host: example.com\n" +
  "User-Agent: RepeaterClone/1.0\n" +
  "Accept: */*\n" +
  "Connection: close\n\n";

let tabs = [], active = 0, seq = 1, controller = null;
let reqView = "pretty", respView = "pretty";
const inspOpen = {"Request headers": true};   // estado de secciones del inspector

/* ---------- utilidades de escape ---------- */
function esc(s){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
function escAll(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function escForJson(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

/* ---------- resaltado de sintaxis ---------- */
function statusCls(n){return n<300?'s2':n<400?'s3':n<500?'s4':'s5';}

function highlightJSON(text){
  let s = escForJson(text);
  return s.replace(
    /("(?:\\.|[^"\\])*"\s*:?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?)/g,
    (m)=>{
      let cls='j-num';
      if(m[0]==='"'){ cls = /:\s*$/.test(m) ? 'j-key' : 'j-str'; }
      else if(/^(true|false)$/.test(m)) cls='j-bool';
      else if(m==='null') cls='j-null';
      return '<span class="'+cls+'">'+m+'</span>';
    });
}

function highlightHTML(text){
  let s = escAll(text);
  s = s.replace(/&lt;(\/?)([\w:.-]+)((?:(?!&gt;)[\s\S])*?)(\/?)&gt;/g,
    (m, slash, name, attrs, selfc)=>{
      const a = attrs.replace(/([\w:.-]+)(=)(&quot;[\s\S]*?&quot;|&#39;[\s\S]*?&#39;|[^\s&]+)/g,
        '<span class="x-attr">$1</span><span class="x-pun">$2</span><span class="x-val">$3</span>');
      return '<span class="x-pun">&lt;'+slash+'</span><span class="x-tag">'+esc(name)+'</span>'+a+'<span class="x-pun">'+selfc+'&gt;</span>';
    });
  return s;
}

function renderHead(lines, isResp){
  const out = [];
  for(let i=0;i<lines.length;i++){
    const ln = lines[i];
    if(i===0){
      if(isResp){
        const m = ln.match(/^(\S+)\s+(\d{3})\s*(.*)$/);
        if(m){ const c=statusCls(+m[2]);
          out.push('<span class="t-ver">'+esc(m[1])+'</span> <span class="t-status '+c+'">'+esc(m[2])+(m[3]?' '+esc(m[3]):'')+'</span>'); continue; }
      } else {
        const m = ln.match(/^(\S+)\s+(.*?)\s+(\S+)$/);
        if(m){ out.push('<span class="t-method">'+esc(m[1])+'</span> <span class="t-path">'+esc(m[2])+'</span> <span class="t-ver">'+esc(m[3])+'</span>'); continue; }
      }
      out.push(esc(ln));
    } else {
      const ci = ln.indexOf(':');
      if(ci>0) out.push('<span class="t-hname">'+esc(ln.slice(0,ci))+'</span><span class="t-hval">'+esc(ln.slice(ci))+'</span>');
      else out.push(esc(ln));
    }
  }
  return out.join('\n');
}

// Devuelve { html } resaltando una petición/respuesta completa.
function highlightMessage(text, isResp, prettyBody){
  text = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n');
  const sep = text.indexOf('\n\n');
  let head, body, hasBody=false;
  if(sep>=0){ head=text.slice(0,sep); body=text.slice(sep+2); hasBody=true; }
  else head=text, body='';
  const lines = head.split('\n');

  let ct='';
  for(let i=1;i<lines.length;i++){
    const ci=lines[i].indexOf(':');
    if(ci>0 && lines[i].slice(0,ci).trim().toLowerCase()==='content-type'){ ct=lines[i].slice(ci+1).toLowerCase(); break; }
  }
  let bodyHtml='';
  if(hasBody){
    let b=body;
    if(prettyBody && ct.includes('json')){ try{ b=JSON.stringify(JSON.parse(body),null,2);}catch(e){} }
    if(ct.includes('json')) bodyHtml=highlightJSON(b);
    else if(ct.includes('html')||ct.includes('xml')||ct.includes('svg')) bodyHtml=highlightHTML(b);
    else bodyHtml=esc(b);
  }
  const headHtml = renderHead(lines, isResp);
  return { html: headHtml + (hasBody ? '\n\n'+bodyHtml : '') };
}

/* ---------- modelo de pestañas ---------- */
function newTab(o={}){
  const id=seq++;
  return Object.assign({
    id, name:"Tab "+id,
    target:"https://example.com", request:DEFAULT_REQ, notes:"",
    optCL:true, optRedir:false, optTLS:false,
    history:[], histIndex:-1
  }, o);
}
function curTab(){return tabs[active];}

function parseTarget(t){
  try{ const u=new URL(t.includes("://")?t:"https://"+t);
    return {scheme:u.protocol.replace(":",""), host:u.hostname,
            port:u.port?parseInt(u.port):(u.protocol==="https:"?443:80)}; }
  catch(e){ return {scheme:"https",host:t.trim(),port:443}; }
}

function init(){
  tabs=[newTab({name:"Tab 1"})]; active=0;
  // listeners del editor (una sola vez)
  const ta=document.getElementById("request");
  ta.addEventListener("input", onReqInput);
  ta.addEventListener("scroll", ()=>{
    const hl=document.getElementById("reqHL"), g=document.getElementById("reqGutter");
    hl.scrollTop=ta.scrollTop; hl.scrollLeft=ta.scrollLeft; g.scrollTop=ta.scrollTop;
  });
  renderTabs(); loadTabIntoUI();
}

/* ---------- pestañas UI ---------- */
function renderTabs(){
  const bar=document.getElementById("tabsbar"); bar.innerHTML="";
  tabs.forEach((t,i)=>{
    const el=document.createElement("div");
    el.className="tab"+(i===active?" active":""); el.onclick=()=>switchTab(i);
    const nm=document.createElement("span"); nm.className="name"; nm.contentEditable=true; nm.textContent=t.name;
    nm.onclick=e=>e.stopPropagation(); nm.oninput=()=>{t.name=nm.textContent;};
    el.appendChild(nm);
    if(tabs.length>1){ const x=document.createElement("span"); x.className="x"; x.textContent="×";
      x.onclick=e=>{e.stopPropagation();closeTab(i);}; el.appendChild(x); }
    bar.appendChild(el);
  });
  const add=document.createElement("button"); add.className="addtab"; add.textContent="+";
  add.title="Nueva pestaña"; add.onclick=addTab; bar.appendChild(add);
}
function addTab(){ tabs.push(newTab({name:"Tab "+(tabs.length+1)})); active=tabs.length-1; renderTabs(); loadTabIntoUI(); }
function closeTab(i){ tabs.splice(i,1); if(active>=tabs.length)active=tabs.length-1; renderTabs(); loadTabIntoUI(); }
function switchTab(i){ active=i; renderTabs(); loadTabIntoUI(); }

/* ---------- carga/sincronización ---------- */
function loadTabIntoUI(){
  const t=curTab();
  document.getElementById("target").value=t.target;
  document.getElementById("request").value=t.request;
  document.getElementById("notes").value=t.notes;
  document.getElementById("optCL").checked=t.optCL;
  document.getElementById("optRedir").checked=t.optRedir;
  document.getElementById("optTLS").checked=t.optTLS;
  onReqInput(true);
  renderResponse();
  updateHistInfo();
}
function syncTab(){
  const t=curTab();
  t.target=document.getElementById("target").value;
  t.request=document.getElementById("request").value;
  t.notes=document.getElementById("notes").value;
  t.optCL=document.getElementById("optCL").checked;
  t.optRedir=document.getElementById("optRedir").checked;
  t.optTLS=document.getElementById("optTLS").checked;
  document.getElementById("proto").textContent = parseTarget(t.target).scheme==="https"?"HTTP/1 · TLS":"HTTP/1";
}

function loadFromUrl(){
  const raw=document.getElementById("loadUrl").value.trim(); if(!raw) return;
  let u; try{ u=new URL(raw.includes("://")?raw:"https://"+raw);}catch(e){alert("URL no válida");return;}
  const t=curTab();
  t.target=u.protocol+"//"+u.host;
  const path=(u.pathname||"/")+(u.search||"");
  t.request="GET "+path+" HTTP/1.1\nHost: "+u.hostname+"\nUser-Agent: RepeaterClone/1.0\nAccept: */*\nConnection: close\n\n";
  t.histIndex=-1;
  loadTabIntoUI();
}

/* ---------- editor request ---------- */
function onReqInput(skipSync){
  if(!skipSync) syncTab();
  const v=document.getElementById("request").value;
  document.getElementById("reqHL").innerHTML=highlightMessage(v,false,false).html;
  const n=v.split('\n').length;
  let g=""; for(let i=1;i<=n;i++) g+=i+"\n";
  document.getElementById("reqGutter").textContent=g;
  document.getElementById("reqHex").textContent=toHexDump(v);
  renderInspector();
}
function setReqView(v){
  reqView=v;
  document.querySelectorAll('.reqcol .st').forEach(e=>e.classList.toggle('active',e.dataset.v===v));
  const ed=document.getElementById("reqEditor");
  ed.classList.toggle('raw', v==='raw');
  ed.classList.toggle('hex', v==='hex');
}
function toHexDump(str){
  const bytes=new TextEncoder().encode(str); let out=[];
  for(let i=0;i<bytes.length;i+=16){
    const slice=bytes.slice(i,i+16);
    const hex=[...slice].map(b=>b.toString(16).padStart(2,'0')).join(' ').padEnd(47,' ');
    const asc=[...slice].map(b=>(b>=32&&b<127)?String.fromCharCode(b):'.').join('');
    out.push(i.toString(16).padStart(8,'0')+'  '+hex+'  '+asc);
  }
  return out.join('\n')||'(vacío)';
}

/* ---------- envío ---------- */
async function sendRequest(){
  syncTab();
  const t=curTab(); const tgt=parseTarget(t.target);
  if(!tgt.host){ alert("Indica un Target válido."); return; }
  document.getElementById("sendBtn").disabled=true;
  document.getElementById("cancelBtn").disabled=false;
  document.getElementById("statusInfo").textContent="Enviando...";
  controller=new AbortController();
  try{
    const r=await fetch("/api/send",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({scheme:tgt.scheme,host:tgt.host,port:tgt.port,request:t.request,
        updateContentLength:t.optCL,followRedirects:t.optRedir,verifyTls:t.optTLS}),
      signal:controller.signal});
    const data=await r.json();
    t.history.push({request:t.request,target:t.target,response:data});
    t.histIndex=-1;
    renderResponse(); updateHistInfo();
  }catch(e){
    if(e.name==="AbortError") document.getElementById("statusInfo").textContent="Cancelado.";
    else { curTab().history.push({request:t.request,target:t.target,response:{ok:false,error:String(e)}}); renderResponse(); updateHistInfo(); }
  }finally{
    document.getElementById("sendBtn").disabled=false;
    document.getElementById("cancelBtn").disabled=true; controller=null;
  }
}
function cancelRequest(){ if(controller) controller.abort(); }

/* ---------- respuesta ---------- */
function currentResponse(){
  const t=curTab();
  if(t.histIndex>=0 && t.history[t.histIndex]) return t.history[t.histIndex].response;
  if(t.history.length) return t.history[t.history.length-1].response;
  return null;
}
function setRespView(v){
  respView=v;
  document.querySelectorAll('.respcol .st').forEach(e=>e.classList.toggle('active',e.dataset.v===v));
  renderResponse();
}
function setStatusBar(data){
  const si=document.getElementById("statusInfo"), ti=document.getElementById("timeInfo"), zi=document.getElementById("sizeInfo");
  if(!data){ si.textContent="Listo."; ti.textContent=""; zi.textContent=""; return; }
  if(!data.ok){ si.innerHTML='<span class="badge b5">ERROR</span>'; ti.textContent=""; zi.textContent=""; return; }
  si.innerHTML='<span class="badge b'+String(data.status)[0]+'">'+data.status+' '+escAll(data.reason)+'</span>'
    +(data.redirects?' <span style="margin-left:6px">↪ '+data.redirects+' redir</span>':'');
  ti.textContent="⏱ "+data.timeMs+" ms";
  zi.textContent="📦 "+data.sizeBytes.toLocaleString()+" bytes";
}
function renderResponse(){
  const data=currentResponse();
  const grid=document.getElementById("respGrid");
  const frame=document.getElementById("respRender");
  frame.style.display="none"; grid.style.display="";
  setStatusBar(data);
  renderInspector();
  if(!data){ grid.innerHTML=""; return; }
  if(!data.ok){ grid.innerHTML='<div class="gnum">!</div><div class="gline err">⚠ '+escAll(data.error||"Error")+'</div>'; return; }

  if(respView==="render"){
    grid.style.display="none"; frame.style.display="block";
    const ct=(data.headers.find(h=>h[0].toLowerCase()==="content-type")||["",""])[1].toLowerCase();
    frame.srcdoc = ct.includes("html") ? data.body
      : '<body style="font-family:sans-serif;color:#666;padding:14px">Sin contenido HTML para renderizar.</body>';
    return;
  }

  let lineHtmls;
  if(respView==="raw"){
    lineHtmls = data.raw.split("\n").map(esc);
  } else if(respView==="headers"){
    const text=data.version+" "+data.status+" "+data.reason+"\n"+data.headers.map(h=>h[0]+": "+h[1]).join("\n");
    lineHtmls = highlightMessage(text,true,false).html.split("\n");
  } else { // pretty
    const text=data.version+" "+data.status+" "+data.reason+"\n"+data.headers.map(h=>h[0]+": "+h[1]).join("\n")+"\n\n"+data.body;
    lineHtmls = highlightMessage(text,true,true).html.split("\n");
  }
  let html="";
  for(let i=0;i<lineHtmls.length;i++)
    html+='<div class="gnum">'+(i+1)+'</div><div class="gline">'+(lineHtmls[i]||"&nbsp;")+'</div>';
  grid.innerHTML=html;
}

/* ---------- historial ---------- */
function updateHistInfo(){
  const t=curTab(), n=t.history.length;
  const idx=t.histIndex>=0?(t.histIndex+1):n;
  document.getElementById("histInfo").textContent=n?(idx+"/"+n):"0/0";
}
function histPrev(){
  const t=curTab(); if(!t.history.length) return;
  if(t.histIndex<0) t.histIndex=t.history.length-1;
  if(t.histIndex>0) t.histIndex--;
  applyHistory();
}
function histNext(){
  const t=curTab(); if(!t.history.length||t.histIndex<0) return;
  if(t.histIndex<t.history.length-1) t.histIndex++; else t.histIndex=-1;
  applyHistory();
}
function applyHistory(){
  const t=curTab();
  const h=t.histIndex>=0?t.history[t.histIndex]:t.history[t.history.length-1];
  if(h){ t.request=h.request; t.target=h.target;
    document.getElementById("request").value=h.request;
    document.getElementById("target").value=h.target;
    onReqInput(true);
  }
  renderResponse(); updateHistInfo();
}

/* ---------- Inspector ---------- */
function parseRequest(){
  const raw=document.getElementById("request").value.replace(/\r/g,"");
  const sep=raw.indexOf("\n\n");
  const head=sep>=0?raw.slice(0,sep):raw, body=sep>=0?raw.slice(sep+2):"";
  const lines=head.split("\n");
  const rl=(lines[0]||"").split(" ");
  const method=rl[0]||"", path=rl[1]||"";
  const headers=[]; let cookies=[];
  for(let i=1;i<lines.length;i++){
    const ci=lines[i].indexOf(":"); if(ci<=0) continue;
    const k=lines[i].slice(0,ci).trim(), v=lines[i].slice(ci+1).trim();
    headers.push([k,v]);
    if(k.toLowerCase()==="cookie")
      cookies=v.split(";").map(s=>s.trim()).filter(Boolean).map(s=>{const e=s.indexOf("=");return e>0?[s.slice(0,e),s.slice(e+1)]:[s,""];});
  }
  let query=[]; const q=path.indexOf("?");
  if(q>=0) query=path.slice(q+1).split("&").map(s=>{const e=s.indexOf("=");
    try{return e>0?[decodeURIComponent(s.slice(0,e)),decodeURIComponent(s.slice(e+1))]:[decodeURIComponent(s),""];}catch(_){return e>0?[s.slice(0,e),s.slice(e+1)]:[s,""];}});
  let bodyParams=[];
  const ctH=headers.find(h=>h[0].toLowerCase()==="content-type");
  if(ctH && ctH[1].toLowerCase().includes("x-www-form-urlencoded") && body.trim())
    bodyParams=body.trim().split("&").map(s=>{const e=s.indexOf("=");return e>0?[s.slice(0,e),s.slice(e+1)]:[s,""];});
  return {method,path:q>=0?path.slice(0,q):path,query,headers,cookies,bodyParams};
}
function renderInspector(){
  const r=parseRequest();
  const resp=currentResponse();
  const respHeaders=(resp&&resp.ok)?resp.headers:[];
  let html="";
  html+=isec("Request attributes",2,[["Method",r.method],["Path",r.path]]);
  html+=isec("Request query parameters",r.query.length,r.query);
  html+=isec("Request body parameters",r.bodyParams.length,r.bodyParams);
  html+=isec("Request cookies",r.cookies.length,r.cookies);
  html+=isec("Request headers",r.headers.length,r.headers);
  html+=isec("Response headers",respHeaders.length,respHeaders);
  document.getElementById("inspector").innerHTML=html;
}
function isec(title,count,pairs){
  const open=inspOpen[title]?"open":"";
  let rows="";
  if(pairs.length) for(const[k,v]of pairs) rows+='<div class="kv"><b>'+escAll(k)+'</b><span>'+escAll(v)+'</span></div>';
  else rows='<div class="empty">—</div>';
  return '<div class="isec '+open+'"><div class="ihead" onclick="toggleSec(this,\''+escAll(title).replace(/'/g,"")+'\')">'
    +'<span class="lt"><span class="chev">▸</span>'+escAll(title)+'</span><span class="cnt">'+count+'</span></div>'
    +'<div class="ibody">'+rows+'</div></div>';
}
function toggleSec(el,title){ const s=el.parentElement; s.classList.toggle("open"); inspOpen[title]=s.classList.contains("open"); }

/* ---------- Grupo paralelo (race conditions) ---------- */
function toggleGroupPop(){
  const p=document.getElementById("groupPop");
  p.style.display = p.style.display==="none" ? "block" : "none";
}
async function sendGroup(){
  syncTab();
  const useTabs=document.getElementById("gpTabs").checked;
  let requests=[];
  if(useTabs){
    requests=tabs.map(t=>{const g=parseTarget(t.target);return {scheme:g.scheme,host:g.host,port:g.port,request:t.request};});
  } else {
    const t=curTab(), g=parseTarget(t.target);
    const count=Math.max(2,Math.min(100,parseInt(document.getElementById("gpCount").value)||20));
    for(let i=0;i<count;i++) requests.push({scheme:g.scheme,host:g.host,port:g.port,request:t.request});
  }
  if(!requests.length || !requests[0].host){ alert("Indica un Target válido."); return; }
  document.getElementById("groupPop").style.display="none";
  document.getElementById("sendBtn").disabled=true;
  document.getElementById("statusInfo").textContent="Enviando grupo en paralelo ("+requests.length+")...";
  try{
    const r=await fetch("/api/send_group",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({requests,updateContentLength:curTab().optCL,verifyTls:curTab().optTLS})});
    const data=await r.json();
    if(!data.ok){ alert("Error: "+(data.error||"desconocido")); document.getElementById("statusInfo").textContent="Error."; return; }
    curTab().groupResults=data.results;
    showGroupModal(data.results);
    document.getElementById("statusInfo").textContent="Grupo enviado ("+data.results.length+").";
  }catch(e){ alert("Error: "+e); }
  finally{ document.getElementById("sendBtn").disabled=false; }
}
function showGroupModal(results){
  const counts={}; let okc=0;
  results.forEach(r=>{ if(r&&r.ok){okc++; counts[r.status]=(counts[r.status]||0)+1;} });
  const summary=Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([s,c])=>c+"×"+s).join("  ·  ")||"sin respuestas válidas";
  document.getElementById("gmSummary").innerHTML=
    "<b>"+results.length+"</b> peticiones enviadas · <b>"+okc+"</b> respondidas · estados: <b>"+escAll(summary)+"</b>"
    +"<br><span style='color:#80868b'>El <b>Orden</b> es la secuencia real de llegada. Si un estado aparece más veces de lo que debería, ahí está la race condition.</span>";
  const rows=results.map((r,i)=>({r,i})).sort((a,b)=>{
    const ao=(a.r&&a.r.recvOffsetMs!=null)?a.r.recvOffsetMs:1e9, bo=(b.r&&b.r.recvOffsetMs!=null)?b.r.recvOffsetMs:1e9; return ao-bo;
  });
  let html='<div class="gm-row gm-head"><span>#</span><span>Orden</span><span>Estado</span><span>Tiempo</span><span>Bytes</span><span></span></div>';
  rows.forEach(({r,i})=>{
    if(!r){ html+='<div class="gm-row"><span>'+(i+1)+'</span><span>-</span><span class="b5">sin datos</span><span></span><span></span><span></span></div>'; return; }
    if(!r.ok){ html+='<div class="gm-row"><span>'+(i+1)+'</span><span>-</span><span class="b5">ERROR</span><span style="grid-column:span 2">'+escAll(r.error||"")+'</span><span></span></div>'; return; }
    const cls='b'+String(r.status)[0];
    html+='<div class="gm-row"><span>'+(i+1)+'</span><span><b>'+(r.order||"-")+'</b></span>'
      +'<span><span class="badge '+cls+'">'+r.status+' '+escAll(r.reason||"")+'</span></span>'
      +'<span>'+(r.timeMs!=null?r.timeMs+" ms":"")+'</span>'
      +'<span>'+(r.sizeBytes!=null?r.sizeBytes.toLocaleString():0)+'</span>'
      +'<span><button class="ghost mini" onclick="viewGroupResult('+i+')">Ver</button></span></div>';
  });
  document.getElementById("gmTable").innerHTML=html;
  document.getElementById("groupModal").style.display="flex";
}
function viewGroupResult(i){
  const r=curTab().groupResults&&curTab().groupResults[i];
  if(!r||!r.ok) return;
  curTab().history.push({request:curTab().request,target:curTab().target,response:r});
  curTab().histIndex=-1;
  closeGroup(); respView="pretty";
  document.querySelectorAll('.respcol .st').forEach(e=>e.classList.toggle('active',e.dataset.v==="pretty"));
  renderResponse(); updateHistInfo();
}
function closeGroup(){ document.getElementById("groupModal").style.display="none"; }

init();
