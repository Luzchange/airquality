const $=id=>document.getElementById(id);let chart,diurnalChart,exposureChart,latest,serial=0,showStandby=false;
function formatEAT(iso) {
  if (!iso) return '';
  const dt = new Date(iso);
  const eat = new Date(+dt + 3 * 3600000);
  const y = eat.getUTCFullYear();
  const m = String(eat.getUTCMonth() + 1).padStart(2, '0');
  const d = String(eat.getUTCDate()).padStart(2, '0');
  const hr = String(eat.getUTCHours()).padStart(2, '0');
  const min = String(eat.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${hr}:${min} EAT`;
}
function setDefaultDates(){
  const now = new Date();
  const past90 = new Date(+now - 89 * 86400000);
  if (!$('start').value) $('start').value = past90.toISOString().slice(0, 10);
  if (!$('end').value) $('end').value = now.toISOString().slice(0, 10);
}
const params=()=>new URLSearchParams(Object.fromEntries(['start','end','metric','device','group'].map(k=>[k,$(k).value])));
const fmt=n=>n==null?'—':Number(n).toLocaleString(undefined,{maximumFractionDigits:1});const note=s=>$('notice').textContent=s;
async function api(url,options={}){const r=await fetch(url,options);let d;try{d=await r.json()}catch{throw Error('Unexpected server response.')}if(!r.ok)throw Error(d.error||'Request failed.');return d}

let baseWbgt = 78.0;

function computeWbgtFlag(val){
  if (val >= 90.0) {
    return {
      flag: 'Black Flag',
      flagColor: '#1a1a1a',
      flagText: '#ffffff',
      easy: '50 / 10 min',
      waterEasy: '1.0 qt/hr',
      mod: '20 / 40 min',
      waterMod: '1.0 qt/hr',
      hard: '10 / 50 min',
      waterHard: '1.0 qt/hr'
    };
  } else if (val >= 88.0) {
    return {
      flag: 'Red Flag',
      flagColor: '#d93829',
      flagText: '#ffffff',
      easy: 'Continuous (NL)',
      waterEasy: '0.75 qt/hr',
      mod: '30 / 30 min',
      waterMod: '0.75 qt/hr',
      hard: '20 / 40 min',
      waterHard: '1.0 qt/hr'
    };
  } else if (val >= 85.0) {
    return {
      flag: 'Yellow Flag',
      flagColor: '#f2b705',
      flagText: '#3d2e00',
      easy: 'Continuous (NL)',
      waterEasy: '0.75 qt/hr',
      mod: '40 / 20 min',
      waterMod: '0.75 qt/hr',
      hard: '30 / 30 min',
      waterHard: '1.0 qt/hr'
    };
  } else if (val >= 82.0) {
    return {
      flag: 'Green Flag',
      flagColor: '#27945d',
      flagText: '#ffffff',
      easy: 'Continuous (NL)',
      waterEasy: '0.5 qt/hr',
      mod: '50 / 10 min',
      waterMod: '0.75 qt/hr',
      hard: '30 / 30 min',
      waterHard: '1.0 qt/hr'
    };
  }
  return {
    flag: 'White (Normal)',
    flagColor: '#f0f3ee',
    flagText: '#29483d',
    easy: 'Continuous (NL)',
    waterEasy: '0.5 qt/hr',
    mod: 'Continuous (NL)',
    waterMod: '0.75 qt/hr',
    hard: '40 / 20 min',
    waterHard: '0.75 qt/hr'
  };
}

function updateWbgtDisplay(){
  const add = Number($('wbgt-gear-select')?.value || 0);
  const effective = +(baseWbgt + add).toFixed(1);
  const info = computeWbgtFlag(effective);
  
  if ($('effective-wbgt-val')) $('effective-wbgt-val').textContent = `${effective} °F`;
  const badge = $('wbgt-flag-badge');
  if (badge) {
    badge.textContent = info.flag;
    badge.style.background = info.flagColor;
    badge.style.color = info.flagText;
    badge.style.borderColor = info.flagText;
  }
  const flagCell = $('table-flag-cell');
  if (flagCell) {
    flagCell.textContent = info.flag;
    flagCell.style.background = info.flagColor;
    flagCell.style.color = info.flagText;
  }
  if ($('wr-easy')) $('wr-easy').textContent = info.easy;
  if ($('water-easy')) $('water-easy').textContent = info.waterEasy;
  if ($('wr-mod')) $('wr-mod').textContent = info.mod;
  if ($('water-mod')) $('water-mod').textContent = info.waterMod;
  if ($('wr-hard')) $('wr-hard').textContent = info.hard;
  if ($('water-hard')) $('water-hard').textContent = info.waterHard;
}

async function loadWBGTHistory(){
  try {
    const tbody = $('wbgt-history-table');
    if (!tbody) return;
    const list = await api('/api/wbgt-history');
    tbody.replaceChildren();
    for (const row of list.slice().reverse()) {
      const tr = document.createElement('tr');
      const flagColors = {
        'Black': { bg: '#1a1a1a', text: '#ffffff' },
        'Red': { bg: '#d93829', text: '#ffffff' },
        'Yellow': { bg: '#f2b705', text: '#3d2e00' },
        'Green': { bg: '#27945d', text: '#ffffff' },
        'White': { bg: '#f0f3ee', text: '#29483d' }
      };
      const col = flagColors[row.flag] || flagColors.White;
      const start = row.flagStart || row.blackStart || '—';
      const stop = row.flagEnd || row.blackEnd || '—';
      const duration = row.flagDuration || row.blackDuration || '0 hrs';
      const isElevated = row.flag !== 'White' && start !== '—';

      tr.innerHTML = `
        <td><strong>${row.date}</strong></td>
        <td><strong>${row.peakWbgt} °F</strong></td>
        <td><span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;background:${col.bg};color:${col.text}">${row.flag} Flag</span></td>
        <td style="${row.flag==='Black'?'font-weight:700;color:#b71c1c':row.flag==='Red'?'font-weight:700;color:#c62828':row.flag==='Yellow'?'font-weight:600;color:#b26a00':''}">${start}</td>
        <td style="${row.flag==='Black'?'font-weight:700;color:#b71c1c':row.flag==='Red'?'font-weight:700;color:#c62828':row.flag==='Yellow'?'font-weight:600;color:#b26a00':''}">${stop}</td>
        <td><span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:11px;${row.flag==='Black'?'background:#ffebee;color:#b71c1c;font-weight:700':row.flag==='Red'?'background:#fbe9e7;color:#d84315;font-weight:700':row.flag==='Yellow'?'background:#fff8e1;color:#b26a00;font-weight:600':row.flag==='Green'?'background:#e8f5e9;color:#2e7d32;font-weight:600':'color:#78867a'}">${duration}</span></td>
        <td>${row.maxTemp} °F</td>
        <td>${row.minTemp} °F</td>
      `;
      tbody.append(tr);
    }
  } catch(e) { console.error('WBGT history error:', e); }
}

async function loadWBGT(){
  try {
    const w = await api('/api/wbgt');
    baseWbgt = Number(w.wbgt) || 78.0;
    if ($('wbgt-val')) $('wbgt-val').textContent = `${baseWbgt} °F`;
    if ($('wbgt-category')) $('wbgt-category').textContent = `Baseline (No Gear)`;
    if ($('wbgt-temp')) $('wbgt-temp').textContent = `${w.temperature} °F`;
    if ($('wbgt-rh')) $('wbgt-rh').textContent = `${w.humidity} %`;
    if ($('wbgt-wind')) $('wbgt-wind').textContent = `${w.windSpeed} mph`;
    updateWbgtDisplay();
    loadWBGTHistory();
  } catch(e) { console.error('WBGT error:', e); }
}

async function loadAnalyticsCharts(selectedDev=''){
  try {
    const devParam = selectedDev ? `?device=${encodeURIComponent(selectedDev)}` : '';
    const data = await api('/api/excel-analytics' + devParam);
    if (!window.Chart) return;
    
    // 1. Diurnal Hourly 24-hr Chart with EPA AQI Category thresholds
    const ctxDiurnal = $('diurnalChart');
    if (ctxDiurnal) {
      if (diurnalChart) diurnalChart.destroy();
      const labels = data.hourlyChart.map(x => x.label);
      const avgPm = data.hourlyChart.map(x => x.avgPm25);
      const devTitle = selectedDev ? ` (${selectedDev})` : ' (All Active)';
      diurnalChart = new Chart(ctxDiurnal, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: `PM2.5 concentration (µg/m³)${devTitle}`,
              data: avgPm,
              borderColor: '#18382f',
              backgroundColor: '#18382f',
              borderWidth: 3,
              pointRadius: 4,
              pointBackgroundColor: '#18382f',
              tension: 0.2,
              order: 1
            },
            {
              label: 'Moderate (9 µg/m³)',
              data: data.hourlyChart.map(x => x.moderate),
              borderColor: '#2bb673',
              borderDash: [5, 5],
              borderWidth: 1.5,
              pointRadius: 0,
              fill: false,
              order: 6
            },
            {
              label: 'Unhealthy for Sensitive Groups (35.5 µg/m³)',
              data: data.hourlyChart.map(x => x.unhealthySG),
              borderColor: '#f2b705',
              borderDash: [5, 5],
              borderWidth: 1.5,
              pointRadius: 0,
              fill: false,
              order: 5
            },
            {
              label: 'Unhealthy (55.5 µg/m³)',
              data: data.hourlyChart.map(x => x.unhealthy),
              borderColor: '#f2711c',
              borderDash: [5, 5],
              borderWidth: 1.5,
              pointRadius: 0,
              fill: false,
              order: 4
            },
            {
              label: 'Very Unhealthy (125 µg/m³)',
              data: data.hourlyChart.map(x => x.veryUnhealthy),
              borderColor: '#b03060',
              borderDash: [5, 5],
              borderWidth: 1.5,
              pointRadius: 0,
              fill: false,
              order: 3
            },
            {
              label: 'Hazardous (225 µg/m³)',
              data: data.hourlyChart.map(x => x.hazardous),
              borderColor: '#731728',
              borderDash: [5, 5],
              borderWidth: 2,
              pointRadius: 0,
              fill: false,
              order: 2
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.raw != null ? c.raw + ' µg/m³' : '—'}` } }
          },
          scales: {
            x: { grid: { display: false } },
            y: { title: { display: true, text: 'PM2.5 concentration (µg/m³)' }, beginAtZero: true }
          }
        }
      });
    }

    // 2. AQI Category Exposure Distribution Chart (Stacked or Grouped Bar)
    const ctxExp = $('exposureChart');
    if (ctxExp) {
      if (exposureChart) exposureChart.destroy();
      const devNames = selectedDev ? [selectedDev.toUpperCase()] : ['SHAGGY', 'SCOOBY', 'DAPHNE', 'SCRAPPY'];
      const categories = ['Good', 'Moderate', 'Unhealthy for Sensitive Groups', 'Unhealthy', 'Very Unhealthy', 'Hazardous'];
      const colors = ['#2bb673', '#ecd03c', '#f2994a', '#eb5757', '#9b51e0', '#6f1927'];
      const locNames = { SHAGGY: 'SHAGGY (LSA)', SCOOBY: 'SCOOBY (ECP)', DAPHNE: 'DAPHNE (COCO)', SCRAPPY: 'SCRAPPY (Camp Simba)' };
      
      const datasets = categories.map((cat, idx) => ({
        label: cat,
        data: devNames.map(dev => {
          const counts = data.categoryCounts[dev] || {};
          const c = counts[cat] || 0;
          return +(c / 12).toFixed(1); // 5-minute samples converted to hours (count / 12)
        }),
        backgroundColor: colors[idx]
      }));

      exposureChart = new Chart(ctxExp, {
        type: 'bar',
        data: {
          labels: devNames.map(d => locNames[d] || d),
          datasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'right', labels: { boxWidth: 10, font: { size: 10 } } },
            tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.raw} hours` } }
          },
          scales: {
            x: { stacked: true },
            y: { stacked: true, title: { display: true, text: 'Hours Logged' } }
          }
        }
      });
    }
  } catch(e) { console.error('Analytics chart error:', e); }
}

function renderSensorCards(devices){
  const container=$('sensor-cards');if(!container)return;
  container.replaceChildren();
  
  const standbyNames = ['VELMA', 'FRED'];
  const activeDevs = devices.filter(d => !standbyNames.includes((d.name||'').toUpperCase()));
  const standbyDevs = devices.filter(d => standbyNames.includes((d.name||'').toUpperCase()));
  
  const countEl=$('sensor-count');
  if(countEl) countEl.textContent = `${activeDevs.length} active instruments` + (showStandby ? ` · ${standbyDevs.length} standby visible` : ` · 2 standby hidden`);

  for(const d of devices){
    const isStandby = standbyNames.includes((d.name||'').toUpperCase());
    const card=document.createElement('div');
    card.className='sensor-card' + (isStandby && !showStandby ? ' hidden-standby' : '');
    const top=document.createElement('div');top.className='sensor-top';
    const titleWrap=document.createElement('div');
    const h3=document.createElement('h3');
    const siteMapping = { SHAGGY: 'LSA', SCOOBY: 'ECP', DAPHNE: 'COCO', SCRAPPY: 'MBK' }[(d.name||'').toUpperCase()];
    h3.textContent = siteMapping ? `${d.name} (${siteMapping})` : (d.name||d.id);
    const serial=document.createElement('div');serial.className='sensor-serial';serial.textContent=d.serial?`Serial: ${d.serial}`:`ID: ${d.id}`;
    titleWrap.append(h3,serial);
    const badge=document.createElement('span');
    badge.className='sensor-status-badge '+(d.totalReadings>0?'status-active':'status-idle');
    badge.textContent=d.totalReadings>0?`${d.totalReadings.toLocaleString()} records`:(isStandby ? 'Offline (Standby)' : 'Standby');
    top.append(titleWrap,badge);
    const metrics=document.createElement('div');metrics.className='sensor-metrics';
    const mCols=[{id:'mcpm2x5',lbl:'PM2.5',unit:'µg/m³'},{id:'mcpm10',lbl:'PM10',unit:'µg/m³'},{id:'co2_ppm',lbl:'CO₂',unit:'ppm'}];
    for(const m of mCols){
      const box=document.createElement('div');
      const val=d.metrics?.[m.id]?.value;
      
      // Determine danger/warning/normal/nodata color-coding:
      let colorClass = 'metric-nodata';
      if (val != null) {
        if (m.id === 'mcpm2x5') {
          if (val > 55.4) colorClass = 'metric-danger';       // Unhealthy+
          else if (val > 35.4) colorClass = 'metric-warning'; // Sensitive groups / elevated
          else colorClass = 'metric-normal';                  // Good / Moderate
        } else if (m.id === 'mcpm10') {
          if (val > 254) colorClass = 'metric-danger';
          else if (val > 154) colorClass = 'metric-warning';
          else colorClass = 'metric-normal';
        } else if (m.id === 'co2_ppm') {
          if (val > 2000) colorClass = 'metric-danger';       // Dangerously high indoor/confined CO2
          else if (val > 1000) colorClass = 'metric-warning'; // Elevated / ventilation alert
          else colorClass = 'metric-normal';
        }
      }
      box.className = `sensor-metric-box ${colorClass}`;
      box.innerHTML=`<div class="sensor-metric-lbl">${m.lbl} (${m.unit})</div><div class="sensor-metric-val">${val!=null?fmt(val):'—'}</div>`;
      metrics.append(box);
    }
    const footer=document.createElement('div');footer.className='sensor-footer';
    const time=document.createElement('div');time.className='sensor-time';
    const latestTime=d.latest?.timestamp;
    time.textContent=latestTime?`Updated: ${formatEAT(latestTime)}`:'No logged data';
    const dlBtn=document.createElement('button');dlBtn.className='dl-btn';
    dlBtn.innerHTML='📥 Download 90 Day CSVs';
    dlBtn.onclick=(e)=>{e.stopPropagation();location.href=`/api/export/device?device=${encodeURIComponent(d.id)}`};
    footer.append(time,dlBtn);
    card.append(top,metrics,footer);
    card.style.cursor='pointer';
    card.onclick=()=>{$('device').value=d.id;load()};
    container.append(card);
  }
}
async function load(){const id=++serial;$('apply').disabled=true;try{const p=params(),[d,devices]=await Promise.all([api('/api/summary?'+p),api('/api/devices?metric='+p.get('metric'))]);if(id!==serial)return;latest={...d,filters:Object.fromEntries(p)};const selected=p.get('device');$('device').replaceChildren(new Option('All devices',''),...devices.map(x=>new Option(x.name||x.id,x.id)));$('device').value=selected;const deviceLabel=$('device').selectedOptions[0]?.textContent||'Selected device';latest.title=`${d.metric} · ${p.get('group')==='day'?'Daily':'Hourly'} summary`;latest.subtitle=`${p.get('start')} through ${p.get('end')} inclusive · EAT · ${deviceLabel}`;$('mode').textContent=d.demo?'DEMONSTRATION DATA':'LIVE ARCHIVE';const s=d.stats;$('mean').textContent=fmt(s.mean)+' '+d.unit;$('peak').textContent=fmt(s.peak)+' '+d.unit;$('coverage').textContent=fmt(s.coverage)+'%';$('coverage-detail').textContent=`${s.populated} / ${s.expected} populated buckets`;$('samples').textContent=fmt(s.total);$('sample-detail').textContent=`${fmt(s.valid)} valid · ${fmt(s.total-s.valid)} flagged`;$('synced').textContent=d.lastSync?'Last sync: '+formatEAT(d.lastSync):'No live sync recorded';$('chart-title').textContent=latest.title;$('range').textContent=latest.subtitle;note((d.demo?'DEMO: synthetic readings and illustrative New York locations—not your instruments. ':'')+'Coverage counts buckets containing any valid data, not complete fleet uptime. TSI history is limited to 90 days; older historical rotations require an imported CSV archive.');const points=new Map(d.points.map(p=>[p.bucket,p])),labels=[],means=[],lows=[],highs=[];let t=new Date(p.get('start')+'T00:00:00Z'),end=new Date(p.get('end')+'T00:00:00Z');end.setUTCDate(end.getUTCDate()+1);$('table').replaceChildren();while(t<end){const key=t.toISOString().slice(0,p.get('group')==='day'?10:13),v=points.get(key);labels.push(key);means.push(v?.mean??null);lows.push(v?.low??null);highs.push(v?.high??null);if(v){const row=document.createElement('tr');for(const text of [key,fmt(v.mean),fmt(v.low),fmt(v.high),String(v.devices)]){const cell=document.createElement('td');cell.textContent=text;row.append(cell)}$('table').append(row)}t=new Date(+t+(p.get('group')==='day'?86400000:3600000))}if(chart)chart.destroy();if(window.Chart)chart=new Chart($('chart'),{type:'line',data:{labels,datasets:[{label:'Minimum',data:lows,borderWidth:0,pointRadius:0},{label:'Maximum',data:highs,borderWidth:0,pointRadius:0,fill:0,backgroundColor:'rgba(52,133,101,.13)'},{label:`Mean ${d.metric} (${d.unit})`,data:means,borderColor:'#277657',borderWidth:2,pointRadius:0,spanGaps:false,tension:0}]},options:{responsive:true,maintainAspectRatio:false,animation:false,interaction:{intersect:false,mode:'index'},plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{maxTicksLimit:8,maxRotation:0}},y:{title:{display:true,text:d.unit},grid:{color:'#eef1eb'}}}}});else note('Chart library unavailable; the data table and CSV are still available.');renderSensorCards(devices);loadWBGT();loadAnalyticsCharts()}catch(e){note(e.message)}finally{if(id===serial)$('apply').disabled=false}}
async function action(id,fn){$(id).disabled=true;try{await fn()}catch(e){note(e.message)}finally{$(id).disabled=false}}
$('apply').onclick=load;$('rotation').onclick=()=>{const now=new Date();const past=new Date(+now-89*86400000);$('start').value=past.toISOString().slice(0,10);$('end').value=now.toISOString().slice(0,10);$('group').value='day';load()};if($('recent'))$('recent').onclick=()=>{const now=new Date();const past=new Date(+now-7*86400000);$('start').value=past.toISOString().slice(0,10);$('end').value=now.toISOString().slice(0,10);$('group').value='hour';load()};if($('toggle-standby-btn'))$('toggle-standby-btn').onclick=()=>{showStandby=!showStandby;$('toggle-standby-btn').textContent=showStandby?'Hide Standby (Velma & Fred)':'Show Standby (Velma & Fred)';load()};$('csv').onclick=()=>{if(latest)location.href='/api/export?'+new URLSearchParams(latest.filters)};$('graph').onclick=()=>{if(!chart||!latest)return;const source=$('chart'),c=document.createElement('canvas');c.width=Math.max(1000,source.width);c.height=source.height+140;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,c.width,c.height);x.fillStyle='#18382f';x.font='20px sans-serif';x.fillText((latest.demo?'DEMO — ':'')+latest.title,20,30);x.font='13px sans-serif';x.fillText(latest.subtitle,20,54);x.fillText(`Coverage ${fmt(latest.stats.coverage)}% · Equal-weight means · Flagged excluded · Gaps not zero-filled`,20,78);x.drawImage(source,0,100,c.width,source.height);const a=document.createElement('a');a.download=`air-quality-${latest.filters.start}-${latest.filters.end}.png`;a.href=c.toDataURL();a.click()};$('import').onclick=()=>action('import',async()=>{const f=$('upload').files[0];if(!f)throw Error('Choose a CSV file.');if(!confirm(`Import ${f.name}? Validated duplicate readings replace stored values. Only import trusted records.`))return;const result=await api('/api/import',{method:'POST',headers:{'Content-Type':'text/csv','X-Portal-Request':'1'},body:await f.text()});await load();note(`Imported ${result.imported} records.`)});$('sync').onclick=()=>action('sync',async()=>{await api('/api/sync',{method:'POST',headers:{'X-Portal-Request':'1'}});note('Synchronization running…');for(let i=0;i<300;i++){await new Promise(ok=>setTimeout(ok,2000));const job=await api('/api/sync/status');if(job.status==='failed')throw Error(job.error);if(job.status==='complete'){await load();note(`Synchronized ${job.processed} measurements.`);return}}note('Sync still running; check status later.')});

if($('wbgt-gear-select')){
  $('wbgt-gear-select').onchange = () => {
    updateWbgtDisplay();
  };
}

if($('analytics-sensor-select')){
  $('analytics-sensor-select').onchange=()=>{
    loadAnalyticsCharts($('analytics-sensor-select').value);
  };
}
if($('download-excel-btn')){
  $('download-excel-btn').onclick=()=>{
    const sel = $('analytics-sensor-select')?.value || '';
    location.href = `/api/export/excel?device=${encodeURIComponent(sel)}`;
  };
}

function loadInit(){
  setDefaultDates();
  load();
  setInterval(() => {
    loadWBGT();
    loadAnalyticsCharts($('analytics-sensor-select')?.value || '');
  }, 3600000);
}
loadInit();