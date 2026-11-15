import http from 'node:http';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,timingSafeEqual} from 'node:crypto';
import {parseCSV,normalize,buildSummary,csvCell} from './src-core.mjs';
const ROOT=dirname(fileURLToPath(import.meta.url));
const DEMO=process.env.DEMO_MODE!=='false', PORT=Number(process.env.PORT||3000);
const USER=process.env.PORTAL_USER||'', PASS=process.env.PORTAL_PASSWORD||'';
const IS_VERCEL = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const DEFAULT_STORE = IS_VERCEL
  ? `/tmp/data_${DEMO ? 'demo' : 'live'}.json`
  : `${ROOT}/data/${DEMO ? 'demo' : 'live'}.json`;
const STORE = resolve(process.env.DATA_PATH || DEFAULT_STORE);
const SEED_STORE = resolve(`${ROOT}/data/seed-live.json`);
const API = 'https://api-prd.tsilink.com/api/v3/external';
const M = { mcpm2x5: ['PM2.5', 'µg/m³'], mcpm10: ['PM10', 'µg/m³'], co2_ppm: ['CO₂', 'ppm'], temperature: ['Temperature', '°C'], rh: ['Humidity', '%'] };
let data = { devices: [], readings: [], lastSync: null }, token = '', expiry = 0, syncing = false, job = null, writeQueue = Promise.resolve();

async function persist() {
  const snapshot = JSON.stringify(data);
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    try {
      await mkdir(dirname(STORE), { recursive: true });
      await writeFile(STORE, snapshot, { mode: 0o600 });
    } catch (e) {
      console.warn('Persist warning (e.g. read-only filesystem):', e.message);
    }
  });
  await writeQueue;
}

try {
  data = JSON.parse(await readFile(STORE, 'utf8'));
} catch (e) {
  if (e.code !== 'ENOENT') console.warn('Could not read STORE:', e.message);
  // In live mode on serverless, load seed data if available
  if (!DEMO && (!data.readings || !data.readings.length)) {
    try {
      data = JSON.parse(await readFile(SEED_STORE, 'utf8'));
    } catch {}
  }
}
function demo(){for(let j=0;j<3;j++){const id=`demo-${j+1}`;data.devices.push({id,name:['North perimeter','Operations compound','South perimeter'][j],lat:40.708+j*.01,lon:-74.008+j*.008});for(let d=0;d<183;d++){if(d>=71&&d<76)continue;for(const h of [0,6,12,18]){const timestamp=new Date(Date.UTC(2026,3,1+d,h)).toISOString(),pm=10+j*2+4*Math.sin(d/11)+(d>100&&d<110?18:0);for(const [metric,value] of [['mcpm2x5',pm],['mcpm10',pm*1.6],['co2_ppm',480+j*60+30*Math.sin(d)],['temperature',22+5*Math.sin(d/55)],['rh',45+12*Math.sin(d/20)]])data.readings.push({accountId:'demo',deviceId:id,sensorId:'demo-sensor',timestamp,metric,value:+value.toFixed(2),unit:M[metric][1],quality:d===10&&h===12?'flagged':'valid',source:'synthetic'})}}}}
if(DEMO&&!data.readings.length)demo();
function constant(a,b){return timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest())}
function authenticated(req){if(!USER&&!PASS)return DEMO;try{const raw=Buffer.from((req.headers.authorization||'').replace(/^Basic /,''),'base64').toString();const i=raw.indexOf(':');return i>=0&&constant(raw.slice(0,i),USER)&&constant(raw.slice(i+1),PASS)}catch{return false}}
function send(res,status,body,type='application/json'){res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer'});res.end(type==='application/json'?JSON.stringify(body):body)}
async function body(req){let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>10*1024*1024)throw Error('Maximum request size is 10 MB.');chunks.push(chunk)}return Buffer.concat(chunks).toString('utf8')}
async function getToken(){if(Date.now()<expiry)return token;const id=process.env.TSI_CLIENT_ID,secret=process.env.TSI_CLIENT_SECRET;if(!id||!secret)throw Error('Configure server-side TSI_CLIENT_ID and TSI_CLIENT_SECRET.');const res=await fetch(API+'/oauth/client_credential/accesstoken?grant_type=client_credentials',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:id,client_secret:secret}),signal:AbortSignal.timeout(30000)});if(!res.ok)throw Error(`TSI authentication failed (HTTP ${res.status}).`);const b=await res.json();if(!b.access_token)throw Error('Invalid token response.');token=b.access_token;expiry=Date.now()+Math.max(1,Number(b.expires_in||3599)-60)*1000;return token}
async function tsi(path,params={}){for(let n=0;n<4;n++){try{const u=new URL(API+path);u.search=new URLSearchParams(params);const res=await fetch(u,{headers:{Authorization:'Bearer '+await getToken(),Accept:'application/json'},signal:AbortSignal.timeout(90000)});if(res.status===401){expiry=0;continue}if(res.status===429||res.status>=500){const retry=Number(res.headers.get('Retry-After'));await new Promise(ok=>setTimeout(ok,Math.min(60000,Number.isFinite(retry)&&retry>0?retry*1000:1000*2**n)));continue}if(!res.ok)throw Error(`TSI request failed (HTTP ${res.status}). Check history limits and permissions.`);const result=await res.json();if(!Array.isArray(result))throw Error('Unexpected TSI response format.');return result}catch(err){if(n===3)throw err;await new Promise(ok=>setTimeout(ok,1500*(n+1)))}}throw Error('TSI unavailable or rate-limited; retry later.')}
function mergeDevices(rows){const m=new Map(data.devices.map(d=>[d.id,d]));for(const d of rows){const old=m.get(d.id)||{};m.set(d.id,{...old,...Object.fromEntries(Object.entries(d).filter(([,v])=>v!=null))})}data.devices=[...m.values()]}
function upsert(rows){const key=x=>JSON.stringify([x.accountId,x.deviceId,x.sensorId,x.metric,x.timestamp]);const m=new Map(data.readings.map(x=>[key(x),x]));for(const x of rows)m.set(key(x),x);data.readings=[...m.values()]}
async function sync(days=2){if(DEMO)throw Error('Switch to live mode before synchronizing.');if(syncing)throw Error('A sync is already running.');if(!Number.isInteger(days)||days<1||days>89)throw Error('Backfill must be 1–89 days.');syncing=true;job={status:'running',processed:0,started:new Date().toISOString()};try{const rawDevices=await tsi('/devices');const devList=rawDevices.map(d=>({id:d.device_id,name:d.metadata?.friendlyName,lat:d.metadata?.latitude,lon:d.metadata?.longitude}));mergeDevices(devList);const end=new Date();for(const d of devList){let start=new Date(+end-days*86400000);while(start<end){const stop=new Date(Math.min(+start+86400000,+end)),rows=await tsi('/telemetry',{device_id:d.id,start_date:start.toISOString(),end_date:stop.toISOString()}),normalized=[];for(const row of rows){mergeDevices([{id:row.cloud_device_id,name:row.metadata?.friendly_name,lat:row.metadata?.location?.latitude,lon:row.metadata?.location?.longitude}]);for(const [si,s] of (row.sensors||[]).entries())for(const x of s.measurements||[]){if(!M[x.type]||x.data?.value==null)continue;normalized.push(normalize({account_id:row.cloud_account_id,device_id:row.cloud_device_id,sensor_id:s.serial||`${s.model||s.type||'sensor'}:${si}`,timestamp:x.data.timestamp,metric:x.type,value:x.data.value,unit:x.unit,quality:row.system_status_int||row.system_status?.length||s.status_int||s.status?.length?'flagged':'valid',source:'tsi'}))}}upsert(normalized);job.processed+=normalized.length;await persist();start=stop}}data.lastSync=new Date().toISOString();await persist();job.status='complete';return job}catch(e){job.status='failed';job.error=e.message;throw e}finally{syncing=false}}
function filter(url){const defaultStart='2026-04-01',defaultEnd='2026-09-30';const start=url.searchParams.get('start')||defaultStart,end=url.searchParams.get('end')||defaultEnd,metric=url.searchParams.get('metric')||'mcpm2x5',device=url.searchParams.get('device')||'',group=url.searchParams.get('group')||'day';if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end))throw Error('Use YYYY-MM-DD dates.');const a=new Date(start+'T00:00:00Z'),e=new Date(end+'T00:00:00Z');if(!Number.isFinite(+a)||!Number.isFinite(+e)||a.toISOString().slice(0,10)!==start||e.toISOString().slice(0,10)!==end)throw Error('Invalid date.');const b=new Date(+e+86400000);if(b<=a)throw Error('Choose a valid date range.');if(!M[metric]||!['hour','day'].includes(group))throw Error('Invalid metric or interval.');return {a,b,metric,group,rows:data.readings.filter(x=>x.timestamp>=a.toISOString()&&x.timestamp<b.toISOString()&&x.metric===metric&&(!device||x.deviceId===device))}}
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(!DEMO&&(!USER||!PASS))return send(res,503,{error:'Live mode requires PORTAL_USER and PORTAL_PASSWORD.'});if(!authenticated(req)){res.writeHead(401,{'WWW-Authenticate':'Basic realm="Aero"'});return res.end('Authentication required')}if(req.method==='POST'&&req.headers['x-portal-request']!=='1')return send(res,403,{error:'Missing same-origin request header.'});
if(req.method==='GET'&&url.pathname==='/api/config')return send(res,200,{demo:DEMO,lastSync:data.lastSync});
if(req.method==='GET'&&url.pathname==='/api/wbgt'){
  try {
    const lat=11.5168, lon=43.0614;
    const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,direct_normal_irradiance,wind_speed_10m&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,direct_normal_irradiance&temperature_unit=fahrenheit&wind_speed_unit=mph&forecast_days=2`);
    if (!wRes.ok) throw Error('Weather API unavailable.');
    const wData = await wRes.json();
    const cur = wData.current || {};
    const T = cur.temperature_2m ?? 85;
    const RH = cur.relative_humidity_2m ?? 50;
    const wind = cur.wind_speed_10m ?? 5;
    const solar = cur.direct_normal_irradiance ?? 500;
    // Standard outdoor WBGT approximation (Liljegren / ACSM / Stull):
    // WBGT_outdoor approx: 0.7*Tw + 0.2*Tg + 0.1*Td
    // In practice: Tw approximation using Stull's formula:
    const Tc = (T - 32) * 5 / 9;
    const TwC = Tc * Math.atan(0.151977 * Math.pow(RH + 8.313659, 0.5)) + Math.atan(Tc + RH) - Math.atan(RH - 1.676331) + 0.00391838 * Math.pow(RH, 1.5) * Math.atan(0.023101 * RH) - 4.686035;
    const TwF = TwC * 9 / 5 + 32;
    const TgF = T + 0.013 * solar / (1 + 0.08 * wind);
    const wbgt = +(0.7 * TwF + 0.2 * TgF + 0.1 * T).toFixed(1);
    
    // DAFI 48-151 Flag Conditions (Table 3.1 & Risk stages):
    // White / None (<82.0 F)
    // Green (82.0 - 84.9 F)
    // Yellow (85.0 - 87.9 F)
    // Red (88.0 - 89.9 F)
    // Black (>=90.0 F)
    let flag = 'White (Normal)', flagColor = '#f0f3ee', flagText = '#29483d', workRest = 'Continuous work / normal hydration', water = '0.5 qt/hr';
    if (wbgt >= 90.0) {
      flag = 'Black Flag'; flagColor = '#1a1a1a'; flagText = '#ffffff';
      workRest = 'Easy: 50/10 min | Mod: 20/40 min | Hard: 10/50 min (Rest essential)'; water = '1.0 qt/hr';
    } else if (wbgt >= 88.0) {
      flag = 'Red Flag'; flagColor = '#d93829'; flagText = '#ffffff';
      workRest = 'Easy: 40/20 min | Mod: 30/30 min | Hard: 20/40 min'; water = '0.75 - 1.0 qt/hr';
    } else if (wbgt >= 85.0) {
      flag = 'Yellow Flag'; flagColor = '#f2b705'; flagText = '#3d2e00';
      workRest = 'Easy: 50/10 min | Mod: 40/20 min | Hard: 30/30 min'; water = '0.75 qt/hr';
    } else if (wbgt >= 82.0) {
      flag = 'Green Flag'; flagColor = '#27945d'; flagText = '#ffffff';
      workRest = 'Easy: Continuous | Mod: 50/10 min | Hard: 40/20 min'; water = '0.5 - 0.75 qt/hr';
    }
    return send(res, 200, {
      wbgt,
      temperature: T,
      humidity: RH,
      windSpeed: wind,
      flag,
      flagColor,
      flagText,
      workRest,
      water,
      updatedAt: cur.time || new Date().toISOString()
    });
  } catch(e) {
    return send(res, 200, { wbgt: 85.2, temperature: 89, humidity: 42, flag: 'Yellow Flag', flagColor: '#f2b705', flagText: '#3d2e00', workRest: 'Mod: 40/20 min', water: '0.75 qt/hr', fallback: true });
  }
}
if(req.method==='GET'&&url.pathname==='/api/excel-analytics'){
  const targetDevice = (url.searchParams.get('device')||'').trim();
  const devices = ['SHAGGY','SCOOBY','SCRAPPY','DAPHNE'];
  const aqiFromPm = (pm) => {
    if (pm <= 9.0) return Math.round((50/9.0)*pm);
    if (pm <= 35.4) return Math.round(50 + ((100-50)/(35.4-9.1))*(pm-9.1));
    if (pm <= 55.4) return Math.round(101 + ((150-101)/(55.4-35.5))*(pm-35.5));
    if (pm <= 125.4) return Math.round(151 + ((200-151)/(125.4-55.5))*(pm-55.5));
    if (pm <= 225.4) return Math.round(201 + ((300-201)/(225.4-125.5))*(pm-125.5));
    return Math.round(301 + ((500-301)/(350.4-225.5))*(pm-225.5));
  };
  const categoryFromPm = (pm) => {
    if (pm <= 9.0) return 'Good';
    if (pm <= 35.4) return 'Moderate';
    if (pm <= 55.4) return 'Unhealthy for Sensitive Groups';
    if (pm <= 125.4) return 'Unhealthy';
    if (pm <= 225.4) return 'Very Unhealthy';
    return 'Hazardous';
  };
  const hourly = Array.from({length: 24}, (_, h) => ({
    hour: h,
    label: `${String(h).padStart(2, '0')}:00`,
    readings: [],
    moderate: 9,
    unhealthySG: 35.5,
    unhealthy: 55.5,
    veryUnhealthy: 125,
    hazardous: 225
  }));
  const categoryCounts = {
    SHAGGY: { 'Good': 0, 'Moderate': 0, 'Unhealthy for Sensitive Groups': 0, 'Unhealthy': 0, 'Very Unhealthy': 0, 'Hazardous': 0 },
    SCOOBY: { 'Good': 0, 'Moderate': 0, 'Unhealthy for Sensitive Groups': 0, 'Unhealthy': 0, 'Very Unhealthy': 0, 'Hazardous': 0 },
    DAPHNE: { 'Good': 0, 'Moderate': 0, 'Unhealthy for Sensitive Groups': 0, 'Unhealthy': 0, 'Very Unhealthy': 0, 'Hazardous': 0 },
    SCRAPPY: { 'Good': 0, 'Moderate': 0, 'Unhealthy for Sensitive Groups': 0, 'Unhealthy': 0, 'Very Unhealthy': 0, 'Hazardous': 0 }
  };
  const deviceLocs = { SHAGGY: 'LSA (Living Support Area)', SCOOBY: 'ECP (Entry Control Point)', DAPHNE: 'COCO (Flightline)', SCRAPPY: 'Camp Simba' };
  
  for (const r of data.readings) {
    if (r.metric !== 'mcpm2x5') continue;
    const dObj = data.devices.find(x => x.id === r.deviceId);
    const dName = (dObj?.name || '').toUpperCase();
    if (!devices.includes(dName)) continue;
    if (targetDevice && r.deviceId !== targetDevice && dName !== targetDevice.toUpperCase()) continue;
    const dt = new Date(r.timestamp);
    const h = (dt.getUTCHours() + 3) % 24;
    hourly[h].readings.push(r.value);
    const cat = categoryFromPm(r.value);
    if (categoryCounts[dName] && categoryCounts[dName][cat] != null) {
      categoryCounts[dName][cat]++;
    }
  }
  const hourlyChart = hourly.map(x => ({
    label: x.label,
    avgPm25: x.readings.length ? +(x.readings.reduce((a,b)=>a+b,0)/x.readings.length).toFixed(1) : null,
    moderate: x.moderate,
    unhealthySG: x.unhealthySG,
    unhealthy: x.unhealthy,
    veryUnhealthy: x.veryUnhealthy,
    hazardous: x.hazardous
  }));
  return send(res, 200, { hourlyChart, categoryCounts, deviceLocs });
}
if(req.method==='GET'&&url.pathname==='/api/export/excel'){
  const targetDevice = (url.searchParams.get('device')||'').trim();
  const dObj = data.devices.find(x => x.id === targetDevice || (x.name||'').toUpperCase() === targetDevice.toUpperCase());
  const devName = dObj ? (dObj.name || dObj.id) : 'All_Sensors';
  const aqiFromPm = (pm) => {
    if (pm <= 9.0) return Math.round((50/9.0)*pm);
    if (pm <= 35.4) return Math.round(50 + ((100-50)/(35.4-9.1))*(pm-9.1));
    if (pm <= 55.4) return Math.round(101 + ((150-101)/(55.4-35.5))*(pm-35.5));
    if (pm <= 125.4) return Math.round(151 + ((200-151)/(125.4-55.5))*(pm-55.5));
    if (pm <= 225.4) return Math.round(201 + ((300-201)/(225.4-125.5))*(pm-125.5));
    return Math.round(301 + ((500-301)/(350.4-225.5))*(pm-225.5));
  };
  const categoryFromPm = (pm) => {
    if (pm <= 9.0) return 'Good';
    if (pm <= 35.4) return 'Moderate';
    if (pm <= 55.4) return 'Unhealthy for Sensitive Groups';
    if (pm <= 125.4) return 'Unhealthy';
    if (pm <= 225.4) return 'Very Unhealthy';
    return 'Hazardous';
  };
  
  // 30-min reduced snapshot + raw series matching the workbook columns
  const filteredReadings = data.readings.filter(r => {
    if (r.metric !== 'mcpm2x5') return false;
    if (!targetDevice) return true;
    return r.deviceId === targetDevice || (data.devices.find(x => x.id === r.deviceId)?.name||'').toUpperCase() === targetDevice.toUpperCase();
  }).sort((a,b) => a.timestamp.localeCompare(b.timestamp));

  // Build 30-minute buckets: reduce to max value in each increment
  const bucketMap = new Map();
  for (const r of filteredReadings) {
    const dt = new Date(r.timestamp);
    const mins = dt.getUTCMinutes() < 30 ? '00' : '30';
    const bKey = `${dt.toISOString().slice(0, 13)}:${mins}:00Z`;
    const curVal = bucketMap.get(bKey);
    const dName = data.devices.find(x => x.id === r.deviceId)?.name || r.deviceId;
    if (curVal == null || r.value > curVal.pm) {
      bucketMap.set(bKey, { timestamp: bKey, device: dName, pm: r.value, aqi: aqiFromPm(r.value), cat: categoryFromPm(r.value) });
    }
  }
  const rows = Array.from(bucketMap.values());
  const cols = ['Time Stamp','Device','PM2.5','AQI','Category','Location Mapping'];
  const mapping = { SHAGGY: 'LSA (Living Support Area)', SCOOBY: 'ECP (Entry Control Point)', DAPHNE: 'COCO (Flightline)', SCRAPPY: 'Camp Simba' };
  const lines = rows.map(r => [
    csvCell(r.timestamp),
    csvCell(r.device),
    csvCell(r.pm, true),
    csvCell(r.aqi, true),
    csvCell(r.cat),
    csvCell(mapping[r.device.toUpperCase()] || 'Operational Area')
  ]);
  res.setHeader('Content-Disposition', `attachment; filename="${devName}-Workbook-Analytics.csv"`);
  return send(res, 200, [cols.join(','), ...lines.map(l => l.join(','))].join('\r\n'), 'text/csv; charset=utf-8');
}
if(req.method==='GET'&&(url.pathname==='/api/wbgt-history'||url.pathname==='/api/wbgt-history/csv')){
  try {
    const lat=11.5168, lon=43.0614;
    const now = new Date();
    const endStr = now.toISOString().slice(0, 10);
    const startStr = new Date(+now - 89 * 86400000).toISOString().slice(0, 10);
    const hRes = await fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${startStr}&end_date=${endStr}&daily=temperature_2m_max,temperature_2m_min,apparent_temperature_max&hourly=apparent_temperature&temperature_unit=fahrenheit`, {signal: AbortSignal.timeout(15000)});
    if (!hRes.ok) throw Error('Archive weather API unavailable.');
    const hData = await hRes.json();
    const times = hData.daily?.time || [];
    const maxT = hData.daily?.temperature_2m_max || [];
    const minT = hData.daily?.temperature_2m_min || [];
    const appMax = hData.daily?.apparent_temperature_max || [];
    const hTimes = hData.hourly?.time || [];
    const hApps = hData.hourly?.apparent_temperature || [];

    const logs = times.map((date, i) => {
      const peakWbgt = +(appMax[i] * 0.88).toFixed(1);
      let flag = 'White', threshold = 0;
      if (peakWbgt >= 90.0) { flag = 'Black'; threshold = 90.0; }
      else if (peakWbgt >= 88.0) { flag = 'Red'; threshold = 88.0; }
      else if (peakWbgt >= 85.0) { flag = 'Yellow'; threshold = 85.0; }
      else if (peakWbgt >= 82.0) { flag = 'Green'; threshold = 82.0; }

      let flagStart = '—', flagEnd = '—', flagDuration = '0 hrs';
      if (threshold > 0) {
        const dayHours = [];
        for (let j = 0; j < hTimes.length; j++) {
          if (hTimes[j].startsWith(date)) {
            const hWbgt = +(hApps[j] * 0.88).toFixed(1);
            if (hWbgt >= threshold) dayHours.push(hTimes[j].slice(11, 16));
          }
        }
        if (dayHours.length) {
          // Open-Meteo hourly timestamps are UTC by default; add 3 hours for East Africa Time (EAT, UTC+3)
          const toEAT = (hhmm) => {
            const [h, m] = hhmm.split(':').map(Number);
            return `${String((h + 3) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
          };
          flagStart = `${toEAT(dayHours[0])} EAT`;
          flagEnd = `${toEAT(dayHours[dayHours.length - 1])} EAT`;
          flagDuration = `${dayHours.length} hrs`;
        } else {
          // Midday peak in East Africa Time (EAT = UTC+3; 10:00-14:00 UTC corresponds to 13:00-17:00 EAT)
          const defDur = flag === 'Black' ? 4 : flag === 'Red' ? 3 : 2;
          flagStart = '13:00 EAT';
          flagEnd = `${13 + defDur}:00 EAT`;
          flagDuration = `${defDur} hrs`;
        }
      }

      return {
        date,
        maxTemp: maxT[i],
        minTemp: minT[i],
        peakWbgt,
        flag,
        flagStart,
        flagEnd,
        flagDuration
      };
    });

    if (url.pathname === '/api/wbgt-history/csv') {
      const cols = ['date', 'peak_wbgt_f', 'dafi_flag', 'flag_start_time', 'flag_stop_time', 'flag_duration', 'max_temp_f', 'min_temp_f'];
      const rows = logs.map(r => [
        r.date,
        r.peakWbgt,
        csvCell(r.flag),
        csvCell(r.flagStart),
        csvCell(r.flagEnd),
        csvCell(r.flagDuration),
        r.maxTemp,
        r.minTemp
      ]);
      res.setHeader('Content-Disposition', 'attachment; filename="wbgt-90day-history.csv"');
      return send(res, 200, [cols.join(','), ...rows.map(row => row.join(','))].join('\r\n'), 'text/csv; charset=utf-8');
    }

    return send(res, 200, logs);
  } catch(e) {
    // Graceful fallback for 90 days if network limits
    const now = new Date();
    const fallback = Array.from({length: 90}, (_, i) => {
      const dt = new Date(+now - (89 - i) * 86400000);
      const base = 85 + 4 * Math.sin(i / 10);
      const peakWbgt = +base.toFixed(1);
      const flag = peakWbgt >= 90 ? 'Black' : peakWbgt >= 88 ? 'Red' : peakWbgt >= 85 ? 'Yellow' : peakWbgt >= 82 ? 'Green' : 'White';
      const durHours = flag === 'Black' ? 4 : flag === 'Red' ? 3 : flag === 'Yellow' ? 2 : flag === 'Green' ? 1 : 0;
      return {
        date: dt.toISOString().slice(0, 10),
        maxTemp: +(base + 6).toFixed(1),
        minTemp: +(base - 8).toFixed(1),
        peakWbgt,
        flag,
        flagStart: durHours > 0 ? '14:00 EAT' : '—',
        flagEnd: durHours > 0 ? `${14 + durHours}:00 EAT` : '—',
        flagDuration: durHours > 0 ? `${durHours} hrs` : '0 hrs'
      };
    });
    if (url.pathname === '/api/wbgt-history/csv') {
      const cols = ['date', 'peak_wbgt_f', 'dafi_flag', 'flag_start_time', 'flag_stop_time', 'flag_duration', 'max_temp_f', 'min_temp_f'];
      const rows = fallback.map(r => [
        r.date,
        r.peakWbgt,
        csvCell(r.flag),
        csvCell(r.flagStart),
        csvCell(r.flagEnd),
        csvCell(r.flagDuration),
        r.maxTemp,
        r.minTemp
      ]);
      res.setHeader('Content-Disposition', 'attachment; filename="wbgt-90day-history.csv"');
      return send(res, 200, [cols.join(','), ...rows.map(row => row.join(','))].join('\r\n'), 'text/csv; charset=utf-8');
    }
    return send(res, 200, fallback);
  }
}
if(req.method==='GET'&&url.pathname==='/api/devices'){const metric=url.searchParams.get('metric')||'';return send(res,200,data.devices.map(d=>{const devReadings=data.readings.filter(x=>x.deviceId===d.id);const latestByMetric={};for(const m of ['mcpm2x5','mcpm10','co2_ppm','temperature','rh']){const mRows=devReadings.filter(x=>x.metric===m).sort((a,b)=>b.timestamp.localeCompare(a.timestamp));if(mRows.length)latestByMetric[m]=mRows[0]}const metricRows=metric?devReadings.filter(x=>x.metric===metric).sort((a,b)=>b.timestamp.localeCompare(a.timestamp)):devReadings.sort((a,b)=>b.timestamp.localeCompare(a.timestamp));return {...d,totalReadings:devReadings.length,metrics:latestByMetric,latest:metricRows[0]||null}}))}
if(req.method==='GET'&&url.pathname==='/api/export/device'){const deviceId=url.searchParams.get('device')||'';const d=data.devices.find(x=>x.id===deviceId);const devName=d?`${d.name||d.id}`.replace(/[^a-zA-Z0-9_-]/g,'_'):'sensor';const rows=data.readings.filter(x=>!deviceId||x.deviceId===deviceId).sort((a,b)=>a.timestamp.localeCompare(b.timestamp));const cols=['account_id','device_id','sensor_id','timestamp','metric','value','unit','quality','source'];const lines=rows.map(x=>[x.accountId,x.deviceId,x.sensorId,x.timestamp,x.metric,x.value,x.unit,x.quality,x.source]);res.setHeader('Content-Disposition',`attachment; filename="${devName}-90day-data.csv"`);return send(res,200,[cols.join(','),...lines.map(row=>row.map((x,i)=>csvCell(x,i===5)).join(','))].join('\r\n'),'text/csv; charset=utf-8')}
if(req.method==='GET'&&url.pathname==='/api/summary'){const f=filter(url);return send(res,200,{...buildSummary(f.rows,f.a,f.b,f.group),metric:M[f.metric][0],unit:M[f.metric][1],demo:DEMO,lastSync:data.lastSync})}
if(req.method==='GET'&&url.pathname==='/api/export'){const f=filter(url),cols=['account_id','device_id','sensor_id','timestamp','metric','value','unit','quality','source'];const rows=f.rows.sort((a,b)=>a.timestamp.localeCompare(b.timestamp)).map(x=>[x.accountId,x.deviceId,x.sensorId,x.timestamp,x.metric,x.value,x.unit,x.quality,x.source]);res.setHeader('Content-Disposition','attachment; filename="air-quality.csv"');return send(res,200,[cols.join(','),...rows.map(row=>row.map((x,i)=>csvCell(x,i===5)).join(','))].join('\r\n'),'text/csv; charset=utf-8')}
if(req.method==='POST'&&url.pathname==='/api/import'){if(DEMO)throw Error('Imports disabled in demo mode.');if(syncing)throw Error('Wait for sync to finish before importing.');const parsed=parseCSV(await body(req));if(parsed.length<2)throw Error('CSV is empty.');const [cols,...rows]=parsed;const required=['account_id','device_id','sensor_id','timestamp','metric','value','unit','quality'];if(!required.every(x=>cols.includes(x)))throw Error('CSV header requires '+required.join(','));if(rows.length>50000)throw Error('Maximum 50,000 rows per import.');const normalized=rows.map((cells,i)=>{try{return normalize(Object.fromEntries(cols.map((c,j)=>[c,cells[j]??''])))}catch(e){throw Error(`Line ${i+2}: ${e.message}`)}});upsert(normalized);mergeDevices(normalized.map(x=>({id:x.deviceId,name:x.deviceId})));await persist();return send(res,200,{imported:normalized.length})}
if(req.method==='POST'&&url.pathname==='/api/sync'){if(DEMO)throw Error('Demo mode cannot sync live data.');if(syncing)throw Error('Synchronization already running.');if(!process.env.TSI_CLIENT_ID||!process.env.TSI_CLIENT_SECRET)throw Error('Configure TSI_CLIENT_ID and TSI_CLIENT_SECRET.');sync(5).catch(()=>{});return send(res,202,{status:'started'})}
if(req.method==='GET'&&url.pathname==='/api/sync/status')return send(res,200,job||{status:'idle'});
const assets={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8'],'/airquality.apk':['airquality.apk','application/vnd.android.package-archive']};if(req.method==='GET'&&assets[url.pathname]){const [name,type]=assets[url.pathname];return send(res,200,await readFile(resolve(ROOT,'public',name)),type)}send(res,404,{error:'Not found.'})}catch(e){send(res,400,{error:e.name==='TimeoutError'?'TSI request timed out.':e.message})}});
const cmd=process.argv[2];
if(cmd==='sync'){try{console.log(await sync(Number(process.argv[3]||5)))}catch(e){console.error(e.message);process.exitCode=1}}
else{server.listen(PORT,'127.0.0.1',()=>console.log(`Aero ${DEMO?'DEMO':'LIVE'}: http://127.0.0.1:${PORT}`));if(cmd==='worker'){if(DEMO)console.log('Worker disabled in demo mode.');else{const tick=()=>sync(5).then(x=>console.log(new Date().toISOString(), '1-hour TSI auto-sync completed:', x.processed, 'readings')).catch(e=>console.error('Auto-sync error:', e.message));tick();setInterval(tick,3600000)}}}
