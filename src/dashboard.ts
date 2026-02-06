import * as fs from 'fs';
import * as path from 'path';
import * as core from '@actions/core';
import { HistoryEntry } from './types';

export function generateDashboard(history: HistoryEntry[]): string {
  const data = JSON.stringify(history);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Sloppy Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0d1117;color:#e6edf3;padding:2rem}
.wrap{max-width:900px;margin:0 auto}
h1{font-size:2rem;margin-bottom:.25rem}
.sub{color:#8b949e;margin-bottom:2rem;font-size:.95rem}
.card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:2rem;margin-bottom:1.5rem}
.score-num{font-size:5rem;font-weight:800;text-align:center;line-height:1}
.score-num.s-a{color:#3fb950}.score-num.s-b{color:#58a6ff}.score-num.s-c{color:#d29922}.score-num.s-d{color:#f85149}
.score-label{text-align:center;color:#8b949e;margin-top:.5rem}
.bar{height:8px;background:#21262d;border-radius:4px;overflow:hidden;margin:1.5rem 0}
.bar-fill{height:100%;border-radius:4px;transition:width .5s}
.bar-fill.s-a{background:#3fb950}.bar-fill.s-b{background:#58a6ff}.bar-fill.s-c{background:#d29922}.bar-fill.s-d{background:#f85149}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1rem;margin-bottom:1.5rem}
.stat{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:1rem;text-align:center}
.stat-val{font-size:1.5rem;font-weight:700;color:#e6edf3}
.stat-label{font-size:.8rem;color:#8b949e;margin-top:.25rem}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:.6rem .75rem;border-bottom:1px solid #21262d;font-size:.9rem}
th{color:#8b949e;font-weight:600;font-size:.8rem;text-transform:uppercase;letter-spacing:.05em}
.empty{text-align:center;color:#8b949e;padding:4rem;font-size:1.1rem}
canvas{width:100%!important;max-height:250px}
a{color:#58a6ff;text-decoration:none}
a:hover{text-decoration:underline}
</style>
</head>
<body>
<div class="wrap">
<h1>Sloppy</h1>
<p class="sub">Code quality over time</p>
<div id="app"></div>
</div>
<script>
const D=${data};
const $=document.getElementById('app');
if(!D||!D.length){$.innerHTML='<div class="empty">No runs yet. Add Sloppy to your repo to get started.</div>';}
else{
const L=D[D.length-1];
const g=L.score>=90?'a':L.score>=70?'b':L.score>=50?'c':'d';
const totalFixed=D.reduce((s,d)=>s+d.fixed,0);
const totalRuns=D.length;
let h='<div class="card"><div class="score-num s-'+g+'">'+L.score+'</div>';
h+='<div class="score-label">out of 100 &middot; '+L.date+'</div>';
h+='<div class="bar"><div class="bar-fill s-'+g+'" style="width:'+L.score+'%"></div></div></div>';
h+='<div class="stats">';
h+='<div class="stat"><div class="stat-val">'+totalRuns+'</div><div class="stat-label">Total Runs</div></div>';
h+='<div class="stat"><div class="stat-val">'+totalFixed+'</div><div class="stat-label">Issues Fixed</div></div>';
h+='<div class="stat"><div class="stat-val">'+L.passes+'</div><div class="stat-label">Last Passes</div></div>';
h+='<div class="stat"><div class="stat-val">'+L.agent+'</div><div class="stat-label">Agent</div></div>';
h+='</div>';
if(D.length>1){
h+='<div class="card"><h3 style="margin-bottom:1rem;font-size:1rem">Score History</h3>';
h+='<div style="display:flex;align-items:end;height:120px;gap:4px;padding-bottom:1rem">';
for(let i=0;i<D.length;i++){
const d=D[i];const pct=d.score;
const c=pct>=90?'#3fb950':pct>=70?'#58a6ff':pct>=50?'#d29922':'#f85149';
h+='<div style="flex:1;background:'+c+';height:'+pct+'%;border-radius:3px 3px 0 0;min-width:8px" title="Run #'+d.run+': '+pct+'/100"></div>';
}
h+='</div></div>';
}
h+='<div class="card"><h3 style="margin-bottom:1rem;font-size:1rem">Run History</h3>';
h+='<table><thead><tr><th>Run</th><th>Date</th><th>Score</th><th>Fixed</th><th>Passes</th><th>Mode</th></tr></thead><tbody>';
for(let i=D.length-1;i>=0;i--){
const d=D[i];
const c=d.score>=90?'s-a':d.score>=70?'s-b':d.score>=50?'s-c':'s-d';
h+='<tr><td>#'+d.run+'</td><td>'+d.date+'</td><td><strong class="'+c+'" style="color:inherit">'+d.score+'</strong></td>';
h+='<td>'+d.fixed+'</td><td>'+d.passes+'</td><td>'+d.mode+'</td></tr>';
}
h+='</tbody></table></div>';
$.innerHTML=h;
}
</script>
</body>
</html>`;
}

export function deployDashboard(history: HistoryEntry[]): void {
  const cwd = process.env.GITHUB_WORKSPACE || process.cwd();
  const dir = path.join(cwd, '.sloppy', 'site');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), generateDashboard(history));
  core.info('Dashboard written to .sloppy/site/index.html (upload with actions/upload-artifact to download)');
}
