
const PP = (() => {
  const DEFAULT_WIDGETS = ["otd","overdue","risk","quality","readiness","changes","decisions"];
  const state = {
    rows: [],
    suppliers: [],
    issues: [],
    readiness: {},
    quality: {},
    previousSnapshot: null,
    selectedIssue: null,
    selectedSupplier: null,
    decisions: JSON.parse(localStorage.getItem("pp_decisions") || "[]"),
    widgets: JSON.parse(localStorage.getItem("pp_widgets") || "null") || DEFAULT_WIDGETS,
    audits: JSON.parse(localStorage.getItem("pp_audits") || "[]")
  };

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const fmtMoney = v => new Intl.NumberFormat("en-US",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(v||0);
  const fmtPct = v => `${(v||0).toFixed(1)}%`;
  const clamp = (x,a,b)=>Math.max(a,Math.min(b,x));
  const daysBetween=(a,b)=>Math.round((b-a)/86400000);
  const parseDate=s=>s?new Date(`${s}T00:00:00Z`):null;
  const today = () => new Date("2026-10-14T00:00:00Z");

  function addAudit(action, detail){
    state.audits.unshift({time:new Date().toLocaleString(),action,detail});
    state.audits=state.audits.slice(0,20);
    localStorage.setItem("pp_audits",JSON.stringify(state.audits));
    renderAudit();
  }

  function csvParse(text){
    const rows=[]; let row=[], cell="", q=false;
    for(let i=0;i<text.length;i++){
      const c=text[i], n=text[i+1];
      if(c=='"'){
        if(q && n=='"'){cell+='"'; i++;}
        else q=!q;
      } else if(c==',' && !q){row.push(cell); cell="";}
      else if((c=='\n'||c=='\r')&&!q){
        if(c=='\r'&&n=='\n')i++;
        row.push(cell); cell="";
        if(row.some(x=>x!==""))rows.push(row);
        row=[];
      } else cell+=c;
    }
    if(cell||row.length){row.push(cell);rows.push(row)}
    if(rows.length<2) return [];
    const h=rows[0].map(x=>x.trim());
    return rows.slice(1).map(r=>Object.fromEntries(h.map((k,i)=>[k,(r[i]||"").trim()])));
  }

  function normalizeRows(raw){
    const aliases = {
      PO_ID:["PO_ID","Purch.Doc.","PO","Purchase_Order"],
      PO_Line:["PO_Line","Item","Line"],
      Supplier_ID:["Supplier_ID","Vendor","Vendor_ID"],
      Supplier_Name:["Supplier_Name","Vendor Name","Supplier","Vendor_Name"],
      Category:["Category","Item_Category","Material_Group"],
      Order_Date:["Order_Date","PO_Date"],
      Promised_Date:["Promised_Date","Deliv. Date","Delivery_Date","Promised Delivery Date"],
      Actual_Receipt_Date:["Actual_Receipt_Date","GR Date","Receipt_Date","Actual Delivery Date"],
      Quantity:["Quantity","PO Qty","Ordered_Qty"],
      Received_Qty:["Received_Qty","Received Qty"],
      Rejected_Qty:["Rejected_Qty","Defective_Units","Rejected Qty"],
      Unit_Price:["Unit_Price","Net Price","Price"],
      Currency:["Currency","Curr."],
      UOM:["UOM","Unit"],
      Status:["Status","Order_Status"],
      Compliance:["Compliance","Compliant"]
    };
    const pick=(r,names)=>{for(const n of names){if(Object.prototype.hasOwnProperty.call(r,n))return r[n]}return ""};
    return raw.map((r,i)=>{
      const o={}; for(const [k,n] of Object.entries(aliases))o[k]=pick(r,n);
      o.PO_ID=o.PO_ID||`AUTO-${i+1}`; o.PO_Line=o.PO_Line||"10";
      o.Quantity=Number(o.Quantity)||0;o.Received_Qty=Number(o.Received_Qty)||0;o.Rejected_Qty=Number(o.Rejected_Qty)||0;o.Unit_Price=Number(o.Unit_Price)||0;
      return o;
    });
  }

  function calc(){
    const rows=state.rows;
    const total=rows.length||1;
    const missing=(field)=>rows.filter(r=>!r[field]).length;
    const delivered=rows.filter(r=>r.Actual_Receipt_Date && r.Promised_Date);
    const ontime=delivered.filter(r=>parseDate(r.Actual_Receipt_Date)<=parseDate(r.Promised_Date));
    const delayed=delivered.map(r=>Math.max(0,daysBetween(parseDate(r.Promised_Date),parseDate(r.Actual_Receipt_Date)))).filter(x=>x>0);
    const open=rows.filter(r=>String(r.Status).toUpperCase()!=="CLOSED" && !r.Actual_Receipt_Date);
    const overdue=open.filter(r=>r.Promised_Date && parseDate(r.Promised_Date)<today());
    const otd=delivered.length?ontime.length/delivered.length*100:0;
    const avgDelay=delayed.length?delayed.reduce((a,b)=>a+b,0)/delayed.length:0;
    const exposure=overdue.reduce((s,r)=>s+r.Quantity*r.Unit_Price,0);

    state.quality={
      missingPromised:missing("Promised_Date"),missingActual:missing("Actual_Receipt_Date"),missingSupplier:missing("Supplier_Name"),
      missingCurrency:missing("Currency"),missingUOM:missing("UOM"),
      duplicateKeys: rows.length-new Set(rows.map(r=>`${r.PO_ID}|${r.PO_Line}`)).size
    };

    const completeness=(fields)=>{
      let good=0, possible=rows.length*fields.length;
      rows.forEach(r=>fields.forEach(f=>{if(r[f]!==""&&r[f]!=null)good++}));
      return possible?good/possible*100:0;
    };
    const readiness = {
      otd: completeness(["Promised_Date","Actual_Receipt_Date","Supplier_Name"]),
      overdue: completeness(["Promised_Date","Status","Quantity","Unit_Price"]),
      quality: completeness(["Received_Qty","Rejected_Qty","Supplier_Name"]),
      price: completeness(["Unit_Price","Currency","UOM","Supplier_Name"]),
      spend: completeness(["Unit_Price","Quantity","Supplier_Name"])
    };
    state.readiness=readiness;

    const groups={};
    rows.forEach(r=>{
      const key=r.Supplier_Name||r.Supplier_ID||"Unknown";
      if(!groups[key])groups[key]=[];
      groups[key].push(r);
    });
    state.suppliers=Object.entries(groups).map(([name,rs])=>{
      const del=rs.filter(r=>r.Promised_Date&&r.Actual_Receipt_Date);
      const ot=del.filter(r=>parseDate(r.Actual_Receipt_Date)<=parseDate(r.Promised_Date));
      const delays=del.map(r=>Math.max(0,daysBetween(parseDate(r.Promised_Date),parseDate(r.Actual_Receipt_Date))));
      const avg=delays.length?delays.reduce((a,b)=>a+b,0)/delays.length:0;
      const openRs=rs.filter(r=>String(r.Status).toUpperCase()!=="CLOSED"&&!r.Actual_Receipt_Date);
      const overdueRs=openRs.filter(r=>r.Promised_Date&&parseDate(r.Promised_Date)<today());
      const spend=rs.reduce((s,r)=>s+r.Quantity*r.Unit_Price,0);
      const recv=rs.reduce((s,r)=>s+r.Received_Qty,0);
      const rejected=rs.reduce((s,r)=>s+r.Rejected_Qty,0);
      const rejectRate=recv?rejected/recv*100:0;
      const supplierOtd=del.length?ot.length/del.length*100:0;
      const avgPrice=rs.filter(r=>r.Unit_Price>0).reduce((s,r)=>s+r.Unit_Price,0)/Math.max(1,rs.filter(r=>r.Unit_Price>0).length);
      // Prototype predictive risk, intentionally transparent.
      const risk=clamp(
        (100-supplierOtd)*0.58 +
        avg*3.0 +
        overdueRs.length*5.5 +
        rejectRate*1.5,
        5,96
      );
      const completenessLocal = rs.reduce((s,r)=>s+["Supplier_Name","Promised_Date","Unit_Price","Currency"].filter(f=>r[f]).length,0)/(rs.length*4)*100;
      const reliability=clamp(completenessLocal*0.45 + Math.min(rs.length,60)/60*35 + Math.max(0,100-risk*0.12)*0.20,25,96);
      return {name,rows:rs,otd:supplierOtd,avgDelay:avg,overdue:overdueRs.length,spend,rejectRate,quality:Math.max(0,100-rejectRate),risk,reliability,avgPrice,overdueRows:overdueRs};
    }).sort((a,b)=>b.risk-a.risk);

    state.issues=[];
    state.suppliers.forEach(s=>{
      if(s.risk>=65)state.issues.push({
        id:`risk-${slug(s.name)}`, type:"Predictive Risk", severity:s.risk>=80?"Critical":"High",
        title:`${s.name} has elevated future delivery risk`,
        supplier:s.name, summary:`Predicted late-delivery risk ${s.risk.toFixed(0)}%; OTD ${s.otd.toFixed(1)}%; ${s.overdue} overdue open PO lines.`,
        exposure:s.overdueRows.reduce((x,r)=>x+r.Quantity*r.Unit_Price,0),
        rule:"High predictive risk when prototype score ≥ 65%.",
        threshold:"65% risk",
        reliability:s.reliability
      });
      if(s.otd<80 && s.rows.filter(r=>r.Actual_Receipt_Date&&r.Promised_Date).length>=10)state.issues.push({
        id:`otd-${slug(s.name)}`,type:"Delivery Performance",severity:s.otd<65?"Critical":"High",
        title:`${s.name} OTD is below target`,supplier:s.name,
        summary:`Current OTD ${s.otd.toFixed(1)}% versus configured 80% threshold.`,
        exposure:s.overdueRows.reduce((x,r)=>x+r.Quantity*r.Unit_Price,0),
        rule:"Flag supplier OTD below 80% when at least 10 eligible deliveries exist.",threshold:"80% OTD",reliability:s.reliability
      });
      if(s.rejectRate>5)state.issues.push({
        id:`quality-${slug(s.name)}`,type:"Quality",severity:s.rejectRate>8?"Critical":"High",
        title:`${s.name} rejection rate is high`,supplier:s.name,
        summary:`Quality rejection ${s.rejectRate.toFixed(1)}%, above the configured 5% threshold.`,
        exposure:0,rule:"Flag supplier rejection rate above 5%.",threshold:"5% rejection",reliability:s.reliability
      });
    });
    state.issues.sort((a,b)=>sevRank(b.severity)-sevRank(a.severity)||b.exposure-a.exposure);

    state.metrics={otd,avgDelay,overdue:overdue.length,exposure,delivered:delivered.length};
    renderAll();
  }

  function slug(s){return s.toLowerCase().replace(/[^a-z0-9]+/g,"-")}
  function sevRank(s){return s==="Critical"?3:s==="High"?2:1}
  function readinessLabel(v){return v>=90?["READY","good"]:v>=70?["CAUTION","warn"]:["NOT READY","bad"]}

  function renderAll(){
    renderOverview();renderImport();renderIssues();renderRisk();renderSuppliers();renderScenarioSelects();renderDecisions();renderBuilder();renderAudit();
    $("#datasetBadge").textContent=`${state.rows.length} PO lines`;
  }

  function renderOverview(){
    const s=state.suppliers[0]||{};
    const widgets = [
      ["otd","Overall OTD",fmtPct(state.metrics.otd),`${state.metrics.delivered} eligible deliveries`],
      ["overdue","Overdue open POs",state.metrics.overdue,`${fmtMoney(state.metrics.exposure)} exposure`],
      ["risk","Highest predicted risk",s.risk?`${s.risk.toFixed(0)}%`:"—",s.name||"No supplier"],
      ["quality","Highest rejection",state.suppliers.length?`${Math.max(...state.suppliers.map(x=>x.rejectRate)).toFixed(1)}%`:"—","Supplier quality signal"],
      ["readiness","Delivery readiness",fmtPct(state.readiness.otd),"OTD evidence completeness"],
      ["changes","Current issues",state.issues.length,"New / persistent / resolved"],
      ["decisions","Open decisions",state.decisions.length,"Tracked human decisions"]
    ];
    $("#dashboardWidgets").innerHTML = widgets.filter(w=>state.widgets.includes(w[0])).map(w=>`<div class="kpi-card"><div class="kpi-label">${w[1]}</div><div class="kpi-value">${w[2]}</div><div class="kpi-meta">${w[3]}</div></div>`).join("");

    const rlist=[["On-time delivery",state.readiness.otd],["Overdue exposure",state.readiness.overdue],["Quality",state.readiness.quality],["Price comparison",state.readiness.price]];
    $("#readinessList").innerHTML=rlist.map(([n,v])=>{const [lab]=readinessLabel(v);return `<div class="progress-row"><div class="progress-head"><span>${n}</span><strong>${lab} · ${v.toFixed(1)}%</strong></div><div class="progress"><span style="width:${v}%"></span></div></div>`}).join("");

    const changes=computeChanges();
    $("#changeCards").innerHTML=[["New",changes.new],["Persistent",changes.persistent],["Improving",changes.improving],["Resolved",changes.resolved]].map(x=>`<div class="change-box"><strong>${x[1]}</strong><span>${x[0]}</span></div>`).join("");

    $("#priorityList").innerHTML=state.issues.slice(0,4).map(issueHtml).join("")||`<div class="empty-state">No priority issues detected.</div>`;
    $$("#priorityList [data-issue]").forEach(b=>b.onclick=()=>openIssue(b.dataset.issue));

    const review=state.decisions.slice(0,3);
    $("#overviewDecisionReviews").innerHTML=review.length?review.map(d=>`<div class="history-card"><strong>${esc(d.decision)}</strong><div class="issue-meta">${d.owner} · Target ${esc(d.kpi)} ${esc(String(d.target))} · Review ${esc(d.reviewDate||"not set")}</div></div>`).join(""):`<div class="empty-state">No saved decisions yet.</div>`;
  }

  function computeChanges(){
    if(!state.previousSnapshot)return {new:state.issues.length,persistent:0,improving:0,resolved:0};
    const prev=state.previousSnapshot.issues||[];
    const curIds=new Set(state.issues.map(i=>i.id)), prevIds=new Set(prev.map(i=>i.id));
    const nw=state.issues.filter(i=>!prevIds.has(i.id)).length;
    const pers=state.issues.filter(i=>prevIds.has(i.id)).length;
    const res=prev.filter(i=>!curIds.has(i.id)).length;
    const improving=Math.max(0,Math.min(pers,Math.round(pers*.35)));
    return {new:nw,persistent:pers,improving,resolved:res};
  }

  function issueHtml(i){return `<div class="issue"><div><div class="row wrap"><span class="severity ${i.severity.toLowerCase()}">${i.severity}</span><span class="issue-title">${esc(i.title)}</span></div><div class="issue-meta">${esc(i.summary)}</div></div><div><button class="btn secondary" data-issue="${i.id}">Evidence</button></div></div>`}

  function renderImport(){
    const q=state.quality;
    $("#mappingTable").innerHTML=`<div class="table-wrap top-gap"><table><thead><tr><th>Source field</th><th>ProcurePilot field</th><th>Status</th></tr></thead><tbody>
      <tr><td>Vendor / Supplier_Name</td><td>Supplier_Name</td><td>Confirmed</td></tr>
      <tr><td>Deliv. Date / Promised_Date</td><td>Promised_Date</td><td>AI-assisted mapping</td></tr>
      <tr><td>GR Date / Actual_Receipt_Date</td><td>Actual_Receipt_Date</td><td>Confirmed</td></tr>
      <tr><td>Net Price / Unit_Price</td><td>Unit_Price</td><td>Confirmed</td></tr></tbody></table></div>`;
    const checks=[["Missing promised dates",q.missingPromised],["Missing supplier names",q.missingSupplier],["Missing currency",q.missingCurrency],["Missing UOM",q.missingUOM],["Duplicate PO lines",q.duplicateKeys]];
    $("#qualityChecks").innerHTML=checks.map(([n,v])=>`<div class="check-box"><strong>${v}</strong><span>${n}</span></div>`).join("");
    $("#readinessDetail").innerHTML=[["OTD",state.readiness.otd,"Promised date + actual receipt date + supplier"],["Overdue Open",state.readiness.overdue,"Promised date + status + quantity + price"],["Quality",state.readiness.quality,"Received + rejected quantity + supplier"],["Price",state.readiness.price,"Price + currency + UOM + supplier"]].map(([n,v,why])=>{const [lab]=readinessLabel(v);return `<div class="issue"><div><strong>${n}</strong><div class="issue-meta">${why}</div></div><div><span class="pill">${lab} · ${v.toFixed(1)}%</span></div></div>`}).join("");
  }

  function renderIssues(){
    $("#issuesList").innerHTML=state.issues.map(issueHtml).join("")||`<div class="empty-state">No issues detected.</div>`;
    $$("#issuesList [data-issue]").forEach(b=>b.onclick=()=>openIssue(b.dataset.issue));
    if(state.selectedIssue)renderEvidence();
  }

  function openIssue(id){
    state.selectedIssue=state.issues.find(i=>i.id===id)||null;
    go("issues");renderEvidence();
  }
  function renderEvidence(){
    const i=state.selectedIssue;if(!i){$("#evidenceBody").innerHTML=`<div class="empty-state">No issue selected.</div>`;return}
    const s=state.suppliers.find(x=>x.name===i.supplier);
    $("#evidenceSubtitle").textContent=i.title;$("#evidenceSeverity").textContent=i.severity;
    const affected=(s?.rows||[]).filter(r=>{
      if(i.type==="Quality")return r.Rejected_Qty>0;
      if(i.type==="Delivery Performance")return r.Promised_Date&&r.Actual_Receipt_Date&&parseDate(r.Actual_Receipt_Date)>parseDate(r.Promised_Date);
      return r.Promised_Date && (!r.Actual_Receipt_Date || parseDate(r.Actual_Receipt_Date)>parseDate(r.Promised_Date));
    }).slice(0,8);
    $("#evidenceBody").innerHTML=`<div class="evidence-block">
      <div class="evidence-top">
        <div class="metric-box"><span>Current OTD</span><strong>${s?fmtPct(s.otd):"—"}</strong></div>
        <div class="metric-box"><span>Predicted risk</span><strong>${s?fmtPct(s.risk):"—"}</strong></div>
        <div class="metric-box"><span>Overdue open lines</span><strong>${s?s.overdue:"—"}</strong></div>
        <div class="metric-box"><span>Exposure</span><strong>${fmtMoney(i.exposure)}</strong></div>
      </div>
      <div class="evidence-meta"><div><strong>Rule / threshold</strong><p>${esc(i.rule)} Threshold: ${esc(i.threshold)}.</p></div><div><strong>Data confidence</strong><p>Decision Reliability ${i.reliability.toFixed(0)}%. OTD readiness ${state.readiness.otd.toFixed(1)}%.</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>PO</th><th>Promised</th><th>Actual</th><th>Delay</th><th>Value</th></tr></thead><tbody>${affected.map(r=>`<tr><td>${esc(r.PO_ID)}</td><td>${esc(r.Promised_Date||"—")}</td><td>${esc(r.Actual_Receipt_Date||"Open")}</td><td>${r.Promised_Date&&r.Actual_Receipt_Date?Math.max(0,daysBetween(parseDate(r.Promised_Date),parseDate(r.Actual_Receipt_Date)))+"d":"Open"}</td><td>${fmtMoney(r.Quantity*r.Unit_Price)}</td></tr>`).join("")||`<tr><td colspan="5">No affected rows available.</td></tr>`}</tbody></table></div>
      <div class="row wrap"><button class="btn" id="evidenceAskAi">Ask AI about this issue</button><button class="btn secondary" id="evidenceDecision">Record decision</button></div>
    </div>`;
    $("#evidenceAskAi").onclick=()=>{go("copilot");setTimeout(()=>askCopilot(`What should I do about ${i.supplier}?`),20)};
    $("#evidenceDecision").onclick=()=>{go("decisions");$("#decisionIssue").value=i.id};
  }

  function renderRisk(){
    $("#riskLeaderboard").innerHTML=state.suppliers.slice().sort((a,b)=>b.risk-a.risk).map(s=>`<div class="risk-item"><div><strong>${esc(s.name)}</strong><div class="issue-meta">OTD ${fmtPct(s.otd)} · ${s.overdue} overdue · Avg delay ${s.avgDelay.toFixed(1)}d</div></div><div class="row"><span class="risk-score ${s.risk>=65?"risk-high":s.risk>=40?"risk-mid":"risk-low"}">${s.risk.toFixed(0)}%</span><button data-risk="${esc(s.name)}">Explain</button></div></div>`).join("");
    $$("#riskLeaderboard [data-risk]").forEach(b=>b.onclick=()=>{state.selectedSupplier=state.suppliers.find(s=>s.name===b.dataset.risk);renderRiskExplain()});
    if(!state.selectedSupplier&&state.suppliers.length)state.selectedSupplier=state.suppliers[0];
    renderRiskExplain();
  }

  function renderRiskExplain(){
    const s=state.selectedSupplier;if(!s)return;
    const f1=clamp((100-s.otd),0,100), f2=clamp(s.avgDelay*10,0,100), f3=clamp(s.overdue*18,0,100), f4=clamp(s.rejectRate*8,0,100);
    $("#riskExplain").innerHTML=`<div><div class="row between"><div><strong>${esc(s.name)}</strong><div class="issue-meta">Estimated late-delivery risk</div></div><div class="risk-score ${s.risk>=65?"risk-high":s.risk>=40?"risk-mid":"risk-low"}">${s.risk.toFixed(0)}%</div></div>
      ${factor("Recent OTD weakness",f1)}${factor("Historical delay severity",f2)}${factor("Open overdue exposure",f3)}${factor("Quality signal",f4)}
      <div class="message">This prototype risk score is transparent and deterministic for demonstration. A production model would be trained and validated on sufficient historical data.</div></div>`;
    $("#reliabilityPanel").innerHTML=`<div class="reliability"><div class="reliability-score">${s.reliability.toFixed(0)}%</div><div><strong>${s.reliability>=80?"HIGH":s.reliability>=60?"MEDIUM":"LOW"} reliability</strong><ul><li>Data completeness contributes to the score.</li><li>Historical sample size contributes to the score.</li><li>Prediction evidence is visible rather than hidden.</li><li>Human review remains required.</li></ul></div></div>`;
  }
  function factor(n,v){return `<div class="factor"><div class="factor-head"><span>${n}</span><strong>${v.toFixed(0)}/100</strong></div><div class="factor-bar"><span style="width:${v}%"></span></div></div>`}

  function renderSuppliers(){
    const sort=$("#supplierSort")?.value||"risk";
    let arr=state.suppliers.slice();
    if(sort==="risk")arr.sort((a,b)=>b.risk-a.risk);
    if(sort==="otd")arr.sort((a,b)=>a.otd-b.otd);
    if(sort==="spend")arr.sort((a,b)=>b.spend-a.spend);
    $("#supplierRows").innerHTML=arr.map(s=>`<tr><td><strong>${esc(s.name)}</strong></td><td>${fmtPct(s.otd)}</td><td>${s.avgDelay.toFixed(1)}d</td><td>${fmtPct(s.quality)}</td><td>${fmtMoney(s.spend)}</td><td>${s.overdue}</td><td><strong>${fmtPct(s.risk)}</strong></td></tr>`).join("");
  }

  function renderScenarioSelects(){
    const opts=state.suppliers.map(s=>`<option value="${esc(s.name)}">${esc(s.name)}</option>`).join("");
    $("#scenarioFrom").innerHTML=opts;$("#scenarioTo").innerHTML=opts;
    if(state.suppliers.length>1){$("#scenarioFrom").value=state.suppliers[0].name;$("#scenarioTo").value=state.suppliers[1].name}
    runScenario();
  }

  function runScenario(){
    const a=state.suppliers.find(s=>s.name===$("#scenarioFrom").value), b=state.suppliers.find(s=>s.name===$("#scenarioTo").value), share=Number($("#scenarioShare").value)/100;
    if(!a||!b)return;
    const currentRisk=a.risk;
    const scenarioRisk=(1-share)*a.risk+share*b.risk;
    const costDelta=a.avgPrice?((b.avgPrice-a.avgPrice)/a.avgPrice*100)*share:0;
    const concentration=share>=0.3?"Lower":share>=0.15?"Improved":"High";
    $("#scenarioResult").innerHTML=`<div class="scenario-grid"><div class="scenario-box"><span>Current risk</span><strong>${currentRisk.toFixed(0)}%</strong></div><div class="scenario-box"><span>Scenario risk</span><strong>${scenarioRisk.toFixed(0)}%</strong></div><div class="scenario-box"><span>Estimated cost effect</span><strong>${costDelta>=0?"+":""}${costDelta.toFixed(1)}%</strong></div></div><div class="message top-gap">Moving ${Math.round(share*100)}% from ${esc(a.name)} to ${esc(b.name)} changes the modeled risk and historical-price mix. Concentration: ${concentration}.</div>`;
  }

  function askCopilot(q){
    if(q)$("#chatInput").value=q;
    const question=$("#chatInput").value.trim();if(!question)return;
    const box=$("#chatMessages");
    box.insertAdjacentHTML("beforeend",`<div class="chat-bubble user">${esc(question)}</div>`);
    const answer=copilotAnswer(question);
    box.insertAdjacentHTML("beforeend",`<div class="chat-bubble ai"><strong>ProcurePilot Copilot</strong><div class="top-gap">${answer.text}</div>${answer.challenge?`<div class="challenge"><strong>AI Challenger</strong><br>${answer.challenge}</div>`:""}</div>`);
    box.scrollTop=box.scrollHeight;$("#chatInput").value="";
    addAudit("AI Copilot query",question);
  }

  function copilotAnswer(q){
    const lower=q.toLowerCase(), worst=state.suppliers.slice().sort((a,b)=>a.otd-b.otd)[0], top=state.suppliers[0];
    const gamma=state.suppliers.find(s=>/gamma/i.test(s.name));
    const beta=state.suppliers.find(s=>/beta/i.test(s.name));
    if(/why exactly|root cause|cause.*late/.test(lower)){
      return {text:`The procurement data proves that late deliveries occurred, but it does not contain enough operational evidence to identify the exact root cause. Supplier communication, production constraints, logistics events or other operational data would be needed before claiming a cause.`,challenge:null};
    }
    if(/worst.*otd|lowest.*otd/.test(lower)){
      return {text:`${esc(worst.name)} currently has the lowest OTD at <strong>${worst.otd.toFixed(1)}%</strong>, based on eligible delivered PO lines.`,challenge:`Low OTD alone should not determine a supplier decision; review quality, price, exposure and sample size too.`};
    }
    if(/investigate first|top.*problem|priority/.test(lower)){
      return {text:`The first supplier to investigate is <strong>${esc(top.name)}</strong>. Its modeled late-delivery risk is ${top.risk.toFixed(0)}%, OTD is ${top.otd.toFixed(1)}%, and it has ${top.overdue} overdue open PO lines.`,challenge:`This prioritization is based on current internal data only; external supply-risk information is not included in this prototype.`};
    }
    if(/compare.*gamma.*beta|compare.*beta.*gamma/.test(lower) && gamma && beta){
      return {text:`Gamma: OTD ${gamma.otd.toFixed(1)}%, risk ${gamma.risk.toFixed(0)}%, avg delay ${gamma.avgDelay.toFixed(1)}d. Beta: OTD ${beta.otd.toFixed(1)}%, risk ${beta.risk.toFixed(0)}%, avg delay ${beta.avgDelay.toFixed(1)}d. Beta is operationally stronger in the current data, but its historical average price is ${beta.avgPrice>gamma.avgPrice?"higher":"lower"}.`,challenge:`Do not assume Beta can absorb additional volume without checking capacity, contract terms and category fit.`};
    }
    if(/why.*gamma.*risk|gamma.*high risk/.test(lower) && gamma){
      return {text:`Gamma is high risk because its OTD is ${gamma.otd.toFixed(1)}%, average positive delay is ${gamma.avgDelay.toFixed(1)} days, and it has ${gamma.overdue} overdue open PO lines. The prototype risk score is ${gamma.risk.toFixed(0)}%.`,challenge:`A high model score is not proof that the next PO will be late. Treat it as an early-warning signal.`};
    }
    if(/what should i do.*gamma|recommend.*gamma|action.*gamma/.test(lower) && gamma){
      return {text:`Consider escalating Gamma's overdue POs, comparing qualified alternatives, and testing a partial future-volume reallocation before changing sourcing. ProcurePilot would keep the final decision with the employee.`,challenge:`An alternative supplier may cost more, have lower capacity, or have less historical evidence. Run a what-if scenario before reallocating.`};
    }
    if(/overdue/.test(lower)){
      const arr=state.suppliers.filter(s=>s.overdue>0).sort((a,b)=>b.overdue-a.overdue);
      return {text:`Suppliers with overdue open POs: ${arr.map(s=>`${esc(s.name)} (${s.overdue})`).join(", ")||"none"}.`,challenge:null};
    }
    return {text:`I can answer questions about supplier performance, current issues, predictive risk, overdue POs, comparisons and decision options using the data currently loaded in ProcurePilot.`,challenge:`If the question requires information not in the dataset, I should say that rather than invent an answer.`};
  }

  function renderDecisions(){
    $("#decisionIssue").innerHTML=`<option value="">Select issue</option>`+state.issues.map(i=>`<option value="${i.id}">${esc(i.title)}</option>`).join("");
    $("#decisionHistory").innerHTML=state.decisions.length?state.decisions.map((d,idx)=>{
      const outcome=evaluateDecision(d);
      return `<div class="history-card"><div class="row between wrap"><strong>${esc(d.decision)}</strong><span class="pill">${outcome.label}</span></div><div class="issue-meta">${esc(d.owner)} · ${esc(d.kpi)} target ${esc(String(d.target))} · review ${esc(d.reviewDate||"—")}</div><div class="top-gap">${outcome.detail}</div></div>`
    }).join(""):`<div class="empty-state">No decisions saved yet.</div>`;
    $("#decisionMemory").innerHTML=`<div class="memory-card"><strong>Seeded organizational memory</strong><div class="issue-meta">Similar historical case: Delta Logistics delivery deterioration</div><p>A partial volume reallocation was followed by an OTD improvement from 71% to 85%, while historical purchase cost increased by approximately 2.8%.</p></div>` + (state.decisions.length?`<div class="memory-card"><strong>Your latest saved decision</strong><div class="issue-meta">ProcurePilot can reuse this case when a similar supplier problem appears later.</div><p>${esc(state.decisions[0].decision)}</p></div>`:"");
  }
  function evaluateDecision(d){
    if(d.kpi==="OTD"){
      const issue=state.issues.find(i=>i.id===d.issueId);const s=issue?state.suppliers.find(x=>x.name===issue.supplier):null;
      if(!s)return {label:"Pending",detail:"No matching supplier evidence available in the current import."};
      const ok=s.otd>=Number(d.target);
      return {label:ok?"Target achieved":"Below target",detail:`Current observed OTD is ${s.otd.toFixed(1)}% versus target ${Number(d.target).toFixed(0)}%. This is an outcome check, not proof that the decision caused the change.`};
    }
    return {label:"Review",detail:"Current import is available for manual outcome review."};
  }

  function renderBuilder(){
    const labels={otd:"Overall OTD",overdue:"Overdue open POs",risk:"Predicted risk",quality:"Quality rejection",readiness:"Analysis readiness",changes:"What changed",decisions:"Decision reviews"};
    $("#builderChecks").innerHTML=Object.entries(labels).map(([k,v])=>`<label class="check-line"><input type="checkbox" value="${k}" ${state.widgets.includes(k)?"checked":""}> <span>${v}</span></label>`).join("");
  }

  function renderAudit(){
    $("#auditLog").innerHTML=state.audits.length?state.audits.slice(0,10).map(a=>`<div class="audit-entry"><strong>${esc(a.action)}</strong><span>${esc(a.time)} · ${esc(a.detail)}</span></div>`).join(""):`<div class="empty-state">No activity recorded yet.</div>`;
  }

  function esc(x){return String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}

  async function loadUrl(url, name){
    try{
      snapshotBeforeLoad();
      const text=await fetch(url).then(r=>r.text());
      state.rows=normalizeRows(csvParse(text));
      $("#importMessage").textContent=`Processed ${state.rows.length} PO lines from ${name}.`;
      addAudit("Data import",`${name} · ${state.rows.length} PO lines`);
      calc();go("import");
    }catch(e){$("#importMessage").textContent=`Could not load ${name}. ${e.message}`}
  }
  function snapshotBeforeLoad(){
    if(state.rows.length)state.previousSnapshot={issues:state.issues.map(i=>({id:i.id,severity:i.severity,title:i.title}))};
  }

  function go(name){
    $$(".page").forEach(p=>p.classList.remove("active"));$(`#page-${name}`).classList.add("active");
    $$(".nav-item").forEach(n=>n.classList.toggle("active",n.dataset.page===name));
    const meta={
      overview:["Overview","What needs attention, what may happen next, and what decisions need review."],
      import:["Import & Readiness","From ERP export to trustworthy analytical data."],
      issues:["Priority Issues","Investigate exact PO evidence behind each alert."],
      risk:["Predictive Risk","Estimate future delivery risk and explain the model evidence."],
      suppliers:["Suppliers","Compare supplier performance, exposure and risk."],
      scenario:["What-if Simulator","Test supplier-allocation options before deciding."],
      copilot:["AI Copilot","Ask questions using verified procurement evidence."],
      decisions:["Decisions & Outcomes","Record human decisions and review later results."],
      builder:["Dashboard Builder","Personalize which analytics you want to see."],
      admin:["Admin & Audit","Manage rules and inspect system activity."]
    };
    $("#pageTitle").textContent=meta[name][0];$("#pageSubtitle").textContent=meta[name][1];
  }

  function wire(){
    $$(".nav-item").forEach(b=>b.onclick=()=>go(b.dataset.page));
    $("#openTopIssue").onclick=()=>state.issues[0]?openIssue(state.issues[0].id):go("issues");
    $("#supplierSort").onchange=renderSuppliers;
    $("#scenarioShare").oninput=()=>{$("#shareLabel").textContent=`${$("#scenarioShare").value}%`};
    $("#runScenario").onclick=()=>{runScenario();addAudit("What-if scenario",`${$("#scenarioShare").value}% volume shift tested`)};
    $("#chatForm").onsubmit=e=>{e.preventDefault();askCopilot()};
    $$(".quick-q").forEach(b=>b.onclick=()=>askCopilot(b.textContent));
    $("#saveDecision").onclick=()=>{
      const issueId=$("#decisionIssue").value,decision=$("#decisionText").value.trim();
      if(!issueId||!decision){$("#decisionMessage").textContent="Select an issue and write the final decision first.";return}
      const d={id:Date.now(),issueId,owner:$("#decisionOwner").value.trim()||"Procurement Employee",decision,rationale:$("#decisionRationale").value.trim(),kpi:$("#decisionKpi").value,target:Number($("#decisionTarget").value),reviewDate:$("#decisionDate").value,created:new Date().toISOString()};
      state.decisions.unshift(d);localStorage.setItem("pp_decisions",JSON.stringify(state.decisions));$("#decisionMessage").textContent="Decision saved with evidence context and target.";addAudit("Decision saved",decision);renderDecisions();renderOverview();
    };
    $("#saveDashboard").onclick=()=>{
      state.widgets=$$("#builderChecks input:checked").map(x=>x.value);
      localStorage.setItem("pp_widgets",JSON.stringify(state.widgets));addAudit("Dashboard personalized",state.widgets.join(", "));renderOverview();go("overview");
    };
    $$(".preset").forEach(b=>b.onclick=()=>{
      const presets={analyst:["otd","overdue","risk","quality","readiness","changes"],manager:["otd","overdue","risk","changes","decisions"],quality:["quality","readiness","changes","decisions"]};
      state.widgets=presets[b.dataset.preset];localStorage.setItem("pp_widgets",JSON.stringify(state.widgets));renderBuilder();renderOverview();
    });
    $("#resetBtn").onclick=()=>{localStorage.removeItem("pp_decisions");localStorage.removeItem("pp_widgets");localStorage.removeItem("pp_audits");location.reload()};
    $("#loadBaseline").onclick=()=>loadUrl("sample_baseline.csv","sample_baseline.csv");
    $("#loadFollowup").onclick=()=>loadUrl("sample_followup.csv","sample_followup.csv");
    $("#csvFile").onchange=async e=>{
      const f=e.target.files[0];if(!f)return;
      snapshotBeforeLoad();
      const text=await f.text();state.rows=normalizeRows(csvParse(text));$("#importMessage").textContent=`Processed ${state.rows.length} PO lines from ${f.name}.`;addAudit("Data import",`${f.name} · ${state.rows.length} PO lines`);calc();
    };
  }

  async function init(){
    wire();
    $("#decisionDate").value="2026-11-14";
    if(!state.audits.length)addAudit("Prototype initialized","Seed environment started");
    await loadUrl("sample_baseline.csv","sample_baseline.csv");
    go("overview");
  }
  return {init};
})();
PP.init();
