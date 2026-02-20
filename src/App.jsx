import { useState, useEffect, useRef } from "react";

// ─── Moon Phase ───────────────────────────────────────────────────────────────
function getMoonPhase(dateStr) {
  const date = dateStr ? new Date(dateStr) : new Date();
  const year = date.getFullYear(), month = date.getMonth()+1, day = date.getDate();
  let r = year % 100; r %= 19; if (r > 9) r -= 19;
  r = ((r*11)%30)+month+day; if (month < 3) r += 2;
  r -= year < 2000 ? 4 : 8.3; r = Math.floor(r+0.5)%30;
  const age = r < 0 ? r+30 : r;
  const phases = [
    { name:"New Moon",        emoji:"🌑", illumination:0,   activity:"Deer feel secure — may move any time of day" },
    { name:"Waxing Crescent", emoji:"🌒", illumination:25,  activity:"Increasing nighttime movement" },
    { name:"First Quarter",   emoji:"🌓", illumination:50,  activity:"Transitional — mixed movement patterns" },
    { name:"Waxing Gibbous",  emoji:"🌔", illumination:75,  activity:"Building toward peak lunar activity" },
    { name:"Full Moon",       emoji:"🌕", illumination:100, activity:"Peak feeding at night — less daytime movement" },
    { name:"Waning Gibbous",  emoji:"🌖", illumination:75,  activity:"Still active from full moon energy" },
    { name:"Last Quarter",    emoji:"🌗", illumination:50,  activity:"Activity returning to normal patterns" },
    { name:"Waning Crescent", emoji:"🌘", illumination:25,  activity:"Transitioning back toward new moon" },
  ];
  const index = Math.round(age/3.75)%8;
  return { ...phases[index], age: Math.round(age), daysUntilFull: age<15?15-age:30-age };
}

// ─── Weather API ──────────────────────────────────────────────────────────────
const WMO_CODES = { 0:"Clear",1:"Mainly Clear",2:"Partly Cloudy",3:"Overcast",45:"Foggy",48:"Foggy",51:"Light Drizzle",53:"Drizzle",55:"Heavy Drizzle",61:"Light Rain",63:"Rain",65:"Heavy Rain",71:"Light Snow",73:"Snow",75:"Heavy Snow",80:"Rain Showers",81:"Rain Showers",82:"Heavy Showers",95:"Thunderstorm" };
const WMO_EMOJI = { 0:"☀️",1:"🌤",2:"⛅",3:"☁️",45:"🌫️",48:"🌫️",51:"🌦",53:"🌦",55:"🌧️",61:"🌧️",63:"🌧️",65:"🌧️",71:"🌨️",73:"🌨️",75:"❄️",80:"🌦",81:"🌧️",82:"⛈️",95:"⛈️" };
const WIND_DIRS = ["N","NE","E","SE","S","SW","W","NW"];

async function fetchWeather(lat, lng) {
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,wind_speed_10m,wind_direction_10m,surface_pressure,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph&pressure_msl=hPa`);
    const data = await res.json();
    const c = data.current;
    return { condition:WMO_CODES[c.weather_code]||"Clear", emoji:WMO_EMOJI[c.weather_code]||"🌤", temp:Math.round(c.temperature_2m), wind:Math.round(c.wind_speed_10m), windDir:WIND_DIRS[Math.round(c.wind_direction_10m/45)%8], pressure:(c.surface_pressure*0.02953).toFixed(2), live:true };
  } catch { return null; }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getCurrentPos() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject("no geo");
    navigator.geolocation.getCurrentPosition(resolve, reject);
  });
}
function distKm(lat1,lng1,lat2,lng2) {
  const R=6371,dLat=(lat2-lat1)*Math.PI/180,dLng=(lng2-lng1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function getPropertyCenter(property) {
  if (property.centerLat&&property.centerLng) return {lat:property.centerLat,lng:property.centerLng};
  const wc=[...property.stands,...(property.cameras||[])].filter(s=>s.lat&&s.lng);
  if (!wc.length) return null;
  return {lat:wc.reduce((s,x)=>s+x.lat,0)/wc.length,lng:wc.reduce((s,x)=>s+x.lng,0)/wc.length};
}
function getTimeOfDay(hour) {
  if (hour>=5&&hour<9) return "Early Morning"; if (hour>=9&&hour<12) return "Morning";
  if (hour>=12&&hour<15) return "Midday"; if (hour>=15&&hour<18) return "Afternoon";
  if (hour>=18&&hour<21) return "Evening"; return "Night";
}
function getBestTimeForStand(standName, sightings) {
  const entries=sightings.filter(s=>s.stand===standName);
  if (!entries.length) return null;
  const tc=entries.reduce((acc,s)=>{ acc[s.timeOfDay]=(acc[s.timeOfDay]||0)+s.deer.reduce((a,d)=>a+(d.count||1),0); return acc; },{});
  return Object.entries(tc).sort((a,b)=>b[1]-a[1])[0]?.[0]||null;
}

// ─── Claude AI deer analysis ──────────────────────────────────────────────────
async function analyzePhotoWithClaude(base64Data, mediaType) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({
      model:"claude-sonnet-4-20250514",
      max_tokens:1000,
      messages:[{
        role:"user",
        content:[
          { type:"image", source:{type:"base64", media_type:mediaType, data:base64Data} },
          { type:"text", text:`You are an expert deer biologist analyzing a trail camera photo. Identify all deer visible and respond ONLY with a JSON object (no markdown, no backticks):
{
  "deer": [
    {
      "type": "buck" | "doe" | "fawn" | "unknown",
      "count": number,
      "age": "Yearling (1.5yr)" | "Young (2.5yr)" | "Mature (3.5yr+)" | null,
      "behaviors": ["Feeding","Moving","Bedding","Rutting","Sparring","Alert"],
      "antlerDescription": "string describing rack if buck, null otherwise",
      "confidence": "high" | "medium" | "low",
      "notes": "any other observations"
    }
  ],
  "totalDeer": number,
  "imageQuality": "good" | "fair" | "poor",
  "summary": "one sentence summary"
}
If no deer are visible, return {"deer":[],"totalDeer":0,"imageQuality":"good","summary":"No deer detected in this image."}`
        }
        ]
      }]
    })
  });
  const data = await res.json();
  const text = data.content?.map(c=>c.text||"").join("");
  const clean = text.replace(/```json|```/g,"").trim();
  return JSON.parse(clean);
}

// ─── EXIF date extraction ─────────────────────────────────────────────────────
function extractExifDate(base64) {
  try {
    const binary = atob(base64.substring(0, 2000));
    const dateRegex = /(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/;
    const match = binary.match(dateRegex);
    if (match) {
      return { date:`${match[1]}-${match[2]}-${match[3]}`, time:`${match[4]}:${match[5]}` };
    }
  } catch {}
  return null;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const BEHAVIORS = ["Feeding","Moving","Bedding","Rutting","Sparring","Alert"];
const BUCK_AGES  = ["Yearling (1.5yr)","Young (2.5yr)","Mature (3.5yr+)"];
const MAP_LAYERS = {
  street:    { url:"https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", attr:"© OpenStreetMap", label:"Map" },
  satellite: { url:"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", attr:"© Esri", label:"Satellite" },
  topo:      { url:"https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", attr:"© OpenTopoMap", label:"Topo" },
};

// ─── Default data ─────────────────────────────────────────────────────────────
const DEFAULT_PROPERTIES = [
  { id:"prop1", name:"Johnson Farm", centerLat:null, centerLng:null,
    stands:[
      {name:"North Ridge Stand",lat:38.2420,lng:-92.4510},
      {name:"Creek Bottom",lat:38.2310,lng:-92.4620},
      {name:"Oak Flat",lat:38.2380,lng:-92.4480},
    ],
    cameras:[
      {id:"cam1",name:"Oak Scrape Cam",lat:38.2395,lng:-92.4495,make:"Browning",notes:"Facing north scrape"},
      {id:"cam2",name:"Creek Crossing Cam",lat:38.2318,lng:-92.4608,make:"SpyPoint",notes:""},
    ],
  },
  { id:"prop2", name:"River Bottoms", centerLat:null, centerLng:null,
    stands:[
      {name:"South Field Edge",lat:38.1270,lng:-92.5550},
      {name:"Pinch Point",lat:38.1450,lng:-92.5600},
      {name:"Big Timber",lat:38.1340,lng:-92.5430},
    ],
    cameras:[],
  },
];

const SAMPLE_SIGHTINGS = [
  { id:1, propertyId:"prop1", date:"2024-11-08", time:"06:42", timeOfDay:"Early Morning", stand:"North Ridge Stand", location:{lat:38.242,lng:-92.451}, locationMethod:"gps", deer:[{type:"buck",age:"Mature (3.5yr+)",count:1,behaviors:["Rutting","Moving"]}], weather:{condition:"Clear",emoji:"☀️",temp:34,wind:8,windDir:"NW",pressure:"30.12",live:false}, moon:getMoonPhase("2024-11-08"), notes:"Big 10-pointer working a scrape line" },
  { id:2, propertyId:"prop1", date:"2024-11-05", time:"17:15", timeOfDay:"Evening", stand:"Creek Bottom", location:null, locationMethod:"stand", deer:[{type:"doe",count:3,behaviors:["Feeding"]},{type:"fawn",count:2,behaviors:["Feeding"]}], weather:{condition:"Partly Cloudy",emoji:"⛅",temp:48,wind:5,windDir:"S",pressure:"29.78",live:false}, moon:getMoonPhase("2024-11-05"), notes:"Family group in the clover plot" },
  { id:3, propertyId:"prop2", date:"2024-10-28", time:"06:15", timeOfDay:"Early Morning", stand:"Pinch Point", location:{lat:38.145,lng:-92.560}, locationMethod:"gps", deer:[{type:"buck",age:"Young (2.5yr)",count:2,behaviors:["Moving","Sparring"]}], weather:{condition:"Clear",emoji:"☀️",temp:41,wind:12,windDir:"NW",pressure:"30.45",live:false}, moon:getMoonPhase("2024-10-28"), notes:"Two young bucks sparring near scrape" },
];

// ─── Sample camera photos (no real images, just metadata stubs) ───────────────
const SAMPLE_PHOTOS = [
  { id:"ph1", propertyId:"prop1", cameraId:"cam1", cameraName:"Oak Scrape Cam", date:"2024-11-08", time:"02:14", timeOfDay:"Night", weather:{condition:"Clear",emoji:"☀️",temp:31,wind:4,windDir:"NW",pressure:"30.15",live:false}, moon:getMoonPhase("2024-11-08"), aiAnalysis:{deer:[{type:"buck",count:1,age:"Mature (3.5yr+)",behaviors:["Moving"],antlerDescription:"Wide 8-pointer, estimated 130\" B&C",confidence:"high"}],totalDeer:1,imageQuality:"good",summary:"Mature buck moving through scrape area at night."}, notes:"", duplicate:false, imageData:null },
  { id:"ph2", propertyId:"prop1", cameraId:"cam1", cameraName:"Oak Scrape Cam", date:"2024-11-08", time:"02:16", timeOfDay:"Night", weather:{condition:"Clear",emoji:"☀️",temp:31,wind:4,windDir:"NW",pressure:"30.15",live:false}, moon:getMoonPhase("2024-11-08"), aiAnalysis:{deer:[{type:"buck",count:1,age:"Mature (3.5yr+)",behaviors:["Moving"],antlerDescription:"Wide 8-pointer, same deer as 02:14",confidence:"high"}],totalDeer:1,imageQuality:"good",summary:"Same mature buck, 2 minutes later."}, notes:"", duplicate:true, imageData:null },
  { id:"ph3", propertyId:"prop1", cameraId:"cam2", cameraName:"Creek Crossing Cam", date:"2024-11-06", time:"17:42", timeOfDay:"Evening", weather:{condition:"Partly Cloudy",emoji:"⛅",temp:46,wind:6,windDir:"S",pressure:"29.80",live:false}, moon:getMoonPhase("2024-11-06"), aiAnalysis:{deer:[{type:"doe",count:2,behaviors:["Moving"],antlerDescription:null,confidence:"high"},{type:"fawn",count:1,behaviors:["Moving"],antlerDescription:null,confidence:"medium"}],totalDeer:3,imageQuality:"fair",summary:"Doe with fawn crossing creek at dusk."}, notes:"", duplicate:false, imageData:null },
];

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function DeerTracker() {
  const [view,           setView]           = useState("log");
  const [properties,     setProperties]     = useState(DEFAULT_PROPERTIES);
  const [activePropId,   setActivePropId]   = useState("prop1");
  const [sightings,      setSightings]      = useState(SAMPLE_SIGHTINGS);
  const [photos,         setPhotos]         = useState(SAMPLE_PHOTOS);
  const [form,           setForm]           = useState(null);
  const [saving,         setSaving]         = useState(false);
  const [saved,          setSaved]          = useState(false);
  const [liveWeather,    setLiveWeather]    = useState(null);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [showPropMenu,   setShowPropMenu]   = useState(false);

  // Stand management
  const [addStandOpen,  setAddStandOpen]  = useState(false);
  const [newStandName,  setNewStandName]  = useState("");
  const [newStandLat,   setNewStandLat]   = useState("");
  const [newStandLng,   setNewStandLng]   = useState("");
  const [locatingStand, setLocatingStand] = useState(false);
  const [editingStand,  setEditingStand]  = useState(null);
  const [editStandVal,  setEditStandVal]  = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);

  // Camera management
  const [addCamOpen,    setAddCamOpen]    = useState(false);
  const [newCamName,    setNewCamName]    = useState("");
  const [newCamMake,    setNewCamMake]    = useState("");
  const [newCamLat,     setNewCamLat]     = useState("");
  const [newCamLng,     setNewCamLng]     = useState("");
  const [newCamNotes,   setNewCamNotes]   = useState("");
  const [locatingCam,   setLocatingCam]   = useState(false);
  const [confirmDelCam, setConfirmDelCam] = useState(null);

  // Property management
  const [showAddProperty,   setShowAddProperty]   = useState(false);
  const [newPropName,       setNewPropName]        = useState("");
  const [newPropLat,        setNewPropLat]         = useState("");
  const [newPropLng,        setNewPropLng]         = useState("");
  const [locatingProp,      setLocatingProp]       = useState(false);
  const [confirmDeleteProp, setConfirmDeleteProp]  = useState(null);

  const activeProperty = properties.find(p=>p.id===activePropId)||properties[0];
  const stands         = activeProperty?.stands||[];
  const cameras        = activeProperty?.cameras||[];
  const propSightings  = sightings.filter(s=>s.propertyId===activePropId);
  const propPhotos     = photos.filter(p=>p.propertyId===activePropId);
  const todayMoon      = getMoonPhase(new Date().toISOString().split("T")[0]);

  useEffect(() => {
    setWeatherLoading(true);
    (async()=>{
      try {
        const pos = await getCurrentPos();
        const {latitude:lat,longitude:lng} = pos.coords;
        let nearest=null, nearestDist=Infinity;
        properties.forEach(p=>{ const c=getPropertyCenter(p); if(!c) return; const d=distKm(lat,lng,c.lat,c.lng); if(d<nearestDist){nearestDist=d;nearest=p;} });
        if (nearest&&nearestDist<50) setActivePropId(nearest.id);
        setLiveWeather(await fetchWeather(lat,lng));
      } catch { setLiveWeather(await fetchWeather(38.25,-92.45)); }
      setWeatherLoading(false);
    })();
  }, []);

  async function startNewEntry() {
    const now=new Date(), dateStr=now.toISOString().split("T")[0];
    let weather=liveWeather;
    if (!weather) { try { const pos=await getCurrentPos(); weather=await fetchWeather(pos.coords.latitude,pos.coords.longitude); } catch { weather=await fetchWeather(38.25,-92.45); } }
    setForm({date:dateStr,time:now.toTimeString().slice(0,5),timeOfDay:getTimeOfDay(now.getHours()),locationMethod:null,stand:null,location:null,weather:weather||{condition:"Clear",emoji:"☀️",temp:45,wind:8,windDir:"NW",pressure:"30.00",live:false},moon:getMoonPhase(dateStr),groups:[{type:"buck",count:1,age:"Mature (3.5yr+)",behaviors:[]}],notes:""});
    setView("new");
  }
  async function detectLocation() {
    try { const pos=await getCurrentPos(); const{latitude:lat,longitude:lng}=pos.coords; const weather=await fetchWeather(lat,lng); setForm(f=>({...f,locationMethod:"gps",location:{lat,lng},weather:weather||f.weather})); }
    catch { const lat=38.2341+(Math.random()-.5)*.01,lng=-92.4562+(Math.random()-.5)*.01; setForm(f=>({...f,locationMethod:"gps",location:{lat,lng}})); }
  }
  function addGroup() { setForm(f=>({...f,groups:[...f.groups,{type:"doe",count:1,age:null,behaviors:[]}]})); }
  function updateGroup(i,key,val) { setForm(f=>{ const g=[...f.groups]; g[i]={...g[i],[key]:val}; if(key==="type"&&val!=="buck") g[i].age=null; return {...f,groups:g}; }); }
  function toggleBehavior(i,b) { setForm(f=>{ const g=[...f.groups]; const bh=g[i].behaviors.includes(b)?g[i].behaviors.filter(x=>x!==b):[...g[i].behaviors,b]; g[i]={...g[i],behaviors:bh}; return {...f,groups:g}; }); }
  function removeGroup(i) { setForm(f=>({...f,groups:f.groups.filter((_,idx)=>idx!==i)})); }
  async function saveSighting() {
    setSaving(true); await new Promise(r=>setTimeout(r,600));
    setSightings(s=>[{id:Date.now(),propertyId:activePropId,...form,deer:form.groups},...s]);
    setSaving(false); setSaved(true);
    setTimeout(()=>{setSaved(false);setView("log");},1200);
  }

  function updateActiveProperty(fn) { setProperties(ps=>ps.map(p=>p.id===activePropId?fn(p):p)); }

  // Stand CRUD
  function addStand() {
    const name=newStandName.trim(); if(!name||stands.find(s=>s.name===name)) return;
    const lat=parseFloat(newStandLat)||null,lng=parseFloat(newStandLng)||null;
    updateActiveProperty(p=>({...p,stands:[...p.stands,{name,lat,lng}]}));
    setNewStandName("");setNewStandLat("");setNewStandLng("");setAddStandOpen(false);
  }
  async function useCurrentLocationForStand() {
    setLocatingStand(true);
    try { const pos=await getCurrentPos(); setNewStandLat(pos.coords.latitude.toFixed(6)); setNewStandLng(pos.coords.longitude.toFixed(6)); }
    catch { alert("Could not get location."); }
    setLocatingStand(false);
  }
  function saveEditStand(i) {
    const name=editStandVal.trim(); if(!name) return;
    const old=stands[i].name;
    updateActiveProperty(p=>({...p,stands:p.stands.map((s,idx)=>idx===i?{...s,name}:s)}));
    setSightings(s=>s.map(sg=>sg.stand===old?{...sg,stand:name}:sg));
    setEditingStand(null);
  }
  function deleteStand(i) { updateActiveProperty(p=>({...p,stands:p.stands.filter((_,idx)=>idx!==i)})); setConfirmDelete(null); }

  // Camera CRUD
  function addCamera() {
    const name=newCamName.trim(); if(!name) return;
    const id="cam_"+Date.now();
    const lat=parseFloat(newCamLat)||null,lng=parseFloat(newCamLng)||null;
    updateActiveProperty(p=>({...p,cameras:[...(p.cameras||[]),{id,name,make:newCamMake.trim(),lat,lng,notes:newCamNotes.trim()}]}));
    setNewCamName("");setNewCamMake("");setNewCamLat("");setNewCamLng("");setNewCamNotes("");setAddCamOpen(false);
  }
  async function useCurrentLocationForCam() {
    setLocatingCam(true);
    try { const pos=await getCurrentPos(); setNewCamLat(pos.coords.latitude.toFixed(6)); setNewCamLng(pos.coords.longitude.toFixed(6)); }
    catch { alert("Could not get location."); }
    setLocatingCam(false);
  }
  function deleteCamera(id) {
    updateActiveProperty(p=>({...p,cameras:(p.cameras||[]).filter(c=>c.id!==id)}));
    setConfirmDelCam(null);
  }

  // Property CRUD
  async function useCurrentLocationForProp() {
    setLocatingProp(true);
    try { const pos=await getCurrentPos(); setNewPropLat(pos.coords.latitude.toFixed(6)); setNewPropLng(pos.coords.longitude.toFixed(6)); }
    catch { alert("Could not get location."); }
    setLocatingProp(false);
  }
  function addProperty() {
    const name=newPropName.trim(); if(!name) return;
    const id="prop_"+Date.now();
    setProperties(ps=>[...ps,{id,name,centerLat:parseFloat(newPropLat)||null,centerLng:parseFloat(newPropLng)||null,stands:[],cameras:[]}]);
    setActivePropId(id);
    setNewPropName("");setNewPropLat("");setNewPropLng("");setShowAddProperty(false);
  }
  function deleteProperty(id) {
    setProperties(ps=>ps.filter(p=>p.id!==id));
    if(activePropId===id) setActivePropId(properties.find(p=>p.id!==id)?.id||null);
    setConfirmDeleteProp(null);
  }

  // Insights
  const totalDeer  = propSightings.reduce((s,e)=>s+e.deer.reduce((a,d)=>a+(d.count||1),0),0);
  const buckCount  = propSightings.reduce((s,e)=>s+e.deer.filter(d=>d.type==="buck").reduce((a,d)=>a+(d.count||1),0),0);
  const bestStands = Object.entries(propSightings.reduce((acc,s)=>{ const k=s.stand||"GPS"; acc[k]=(acc[k]||0)+s.deer.reduce((a,d)=>a+(d.count||1),0); return acc; },{})).sort((a,b)=>b[1]-a[1]);
  const bestTimes  = Object.entries(propSightings.reduce((acc,s)=>{ acc[s.timeOfDay]=(acc[s.timeOfDay]||0)+1; return acc; },{})).sort((a,b)=>b[1]-a[1]);
  const moonMap    = propSightings.reduce((acc,s)=>{ if(!s.moon) return acc; const k=s.moon.name; acc[k]=(acc[k]||0)+s.deer.reduce((a,d)=>a+(d.count||1),0); return acc; },{});
  const bestMoon   = Object.entries(moonMap).sort((a,b)=>b[1]-a[1]);

  const propHeader = (
    <div style={{ position:"relative" }} onClick={e=>e.stopPropagation()}>
      <button onClick={()=>setShowPropMenu(v=>!v)} style={{ background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",color:"#c8d8a8",borderRadius:8,padding:"7px 11px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"Georgia,serif",display:"flex",alignItems:"center",gap:5 }}>
        🏕 {activeProperty?.name||"Select"} <span style={{fontSize:10,color:"#6a7a5a"}}>▼</span>
      </button>
      {showPropMenu && (
        <div style={{ position:"absolute",top:"calc(100% + 6px)",right:0,background:"#1a2215",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,minWidth:200,zIndex:50,boxShadow:"0 8px 32px rgba(0,0,0,0.5)",overflow:"hidden" }}>
          {properties.map(p=>(
            <div key={p.id} style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",cursor:"pointer",background:p.id===activePropId?"rgba(168,196,100,0.1)":"transparent",borderBottom:"1px solid rgba(255,255,255,0.05)" }} onClick={()=>{setActivePropId(p.id);setShowPropMenu(false);}}>
              <span style={{ fontSize:13,color:p.id===activePropId?"#a8c464":"#c8d8a8",fontWeight:p.id===activePropId?700:400 }}>{p.id===activePropId?"✓ ":""}{p.name}</span>
              {properties.length>1&&<button onClick={e=>{e.stopPropagation();setConfirmDeleteProp(p.id);setShowPropMenu(false);}} style={{ background:"none",border:"none",color:"#6a4a4a",fontSize:12,cursor:"pointer",padding:"0 2px" }}>✕</button>}
            </div>
          ))}
          <div style={{ padding:"8px 14px",borderTop:"1px solid rgba(255,255,255,0.05)" }}>
            {!showAddProperty ? (
              <button onClick={()=>setShowAddProperty(true)} style={{ background:"none",border:"none",color:"#6a8a5a",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif",padding:0 }}>+ Add Property</button>
            ) : (
              <div>
                <input value={newPropName} onChange={e=>setNewPropName(e.target.value)} placeholder="Property name" autoFocus style={{...inputStyle,fontSize:12,padding:"7px 10px",marginBottom:6}}/>
                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:6 }}>
                  <input value={newPropLat} onChange={e=>setNewPropLat(e.target.value)} placeholder="Lat (opt)" style={{...inputStyle,fontSize:11,padding:"6px 8px"}}/>
                  <input value={newPropLng} onChange={e=>setNewPropLng(e.target.value)} placeholder="Lng (opt)" style={{...inputStyle,fontSize:11,padding:"6px 8px"}}/>
                </div>
                <button onClick={useCurrentLocationForProp} disabled={locatingProp} style={{ background:"none",border:"none",color:"#6a8a5a",fontSize:11,cursor:"pointer",fontFamily:"Georgia,serif",marginBottom:6,display:"block" }}>{locatingProp?"📡 Detecting…":"📡 Use Current Location"}</button>
                {newPropLat&&newPropLng&&<div style={{fontSize:11,color:"#a8c464",marginBottom:6}}>✓ {parseFloat(newPropLat).toFixed(4)}, {parseFloat(newPropLng).toFixed(4)}</div>}
                <div style={{ display:"flex",gap:6 }}>
                  <button onClick={addProperty} disabled={!newPropName.trim()} style={{ background:newPropName.trim()?"#4a5d2d":"rgba(255,255,255,0.05)",color:newPropName.trim()?"#e8dcc8":"#4a5a3a",border:"none",borderRadius:6,padding:"6px 10px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif" }}>Add</button>
                  <button onClick={()=>{setShowAddProperty(false);setNewPropName("");}} style={{ background:"none",border:"none",color:"#6a7a5a",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif" }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div style={{ minHeight:"100vh",background:"#0d1117",fontFamily:"Georgia,serif",color:"#e8dcc8",position:"relative" }} onClick={()=>showPropMenu&&setShowPropMenu(false)}>
      <div style={{ position:"fixed",inset:0,pointerEvents:"none",zIndex:0,background:"radial-gradient(ellipse at 20% 20%, rgba(74,93,45,0.15) 0%, transparent 60%), radial-gradient(ellipse at 80% 80%, rgba(139,90,43,0.1) 0%, transparent 60%)" }}/>

      <header style={{ position:"relative",zIndex:20,borderBottom:"1px solid rgba(255,255,255,0.08)",padding:"12px 24px",background:"rgba(13,17,23,0.97)",backdropFilter:"blur(10px)" }}>
        <div style={{ maxWidth:720,margin:"0 auto" }}>
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:5 }}>
            <div style={{ display:"flex",alignItems:"center",gap:10 }}>
              <span style={{ fontSize:20 }}>🦌</span>
              <h1 style={{ margin:0,fontSize:18,fontWeight:700,letterSpacing:"0.02em" }}>TrackLog</h1>
            </div>
            <div style={{ display:"flex",alignItems:"center",gap:8 }}>
              {propHeader}
              {view!=="new"&&<button onClick={startNewEntry} style={{ background:"#4a5d2d",color:"#e8dcc8",border:"none",borderRadius:8,padding:"7px 14px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"Georgia,serif",boxShadow:"0 2px 12px rgba(74,93,45,0.4)" }}>+ Log</button>}
            </div>
          </div>
          <div style={{ fontSize:11,color:"#5a6a4a",paddingLeft:30 }}>
            {todayMoon.emoji} {todayMoon.name} · {todayMoon.illumination}%
            {liveWeather&&<span> · {liveWeather.emoji} {liveWeather.temp}°F {liveWeather.windDir} {liveWeather.wind}mph <span style={{color:"#3a5a3a"}}>LIVE</span></span>}
            {weatherLoading&&<span style={{color:"#3a4a3a"}}> · fetching weather…</span>}
          </div>
        </div>
      </header>

      {confirmDeleteProp&&(
        <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center" }}>
          <div style={{ background:"#1a2215",border:"1px solid rgba(255,80,80,0.3)",borderRadius:12,padding:24,maxWidth:320,margin:"0 20px" }}>
            <p style={{ margin:"0 0 16px",fontSize:14,color:"#e8dcc8" }}>Delete "{properties.find(p=>p.id===confirmDeleteProp)?.name}"? All its stands and cameras will be removed.</p>
            <div style={{ display:"flex",gap:10 }}>
              <button onClick={()=>deleteProperty(confirmDeleteProp)} style={sBtnStyle("rgba(200,60,60,0.2)","#ff8080")}>Delete</button>
              <button onClick={()=>setConfirmDeleteProp(null)} style={sBtnStyle("rgba(255,255,255,0.05)","#6a7a5a")}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {view!=="new"&&(
        <nav style={{ display:"flex",maxWidth:720,margin:"0 auto",padding:"0 24px",borderBottom:"1px solid rgba(255,255,255,0.06)",position:"relative",zIndex:10,overflowX:"auto" }}>
          {[["log","Sightings"],["cameras","📷 Cameras"],["map","Map"],["insights","Insights"],["stands","Stands"]].map(([v,label])=>(
            <button key={v} onClick={()=>setView(v)} style={{ background:"none",border:"none",color:view===v?"#a8c464":"#6a7a5a",padding:"13px 14px 11px",fontSize:13,fontWeight:600,cursor:"pointer",borderBottom:view===v?"2px solid #a8c464":"2px solid transparent",fontFamily:"Georgia,serif",letterSpacing:"0.04em",transition:"color 0.2s",whiteSpace:"nowrap" }}>{label}</button>
          ))}
        </nav>
      )}

      <main style={{ maxWidth:720,margin:"0 auto",padding:"20px 24px 80px",position:"relative",zIndex:10 }}>

        {/* ── LOG ── */}
        {view==="log"&&(
          <div>
            {liveWeather&&(
              <div style={{ background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:12,padding:"12px 16px",marginBottom:16,display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8 }}>
                {[[liveWeather.emoji+" "+liveWeather.condition,"Conditions"],[liveWeather.temp+"°F","Temperature"],[liveWeather.wind+"mph "+liveWeather.windDir,"Wind"],[liveWeather.pressure+'"',"Pressure"]].map(([val,label])=>(
                  <div key={label} style={{ textAlign:"center" }}>
                    <div style={{ fontSize:13,fontWeight:700,color:"#c8d8a8" }}>{val}</div>
                    <div style={{ fontSize:10,color:"#4a5a3a",textTransform:"uppercase",letterSpacing:"0.08em",marginTop:1 }}>{label}</div>
                  </div>
                ))}
              </div>
            )}
            <p style={{ margin:"0 0 16px",color:"#6a7a5a",fontSize:13 }}>{propSightings.length} entries · {totalDeer} deer · {activeProperty?.name}</p>
            {propSightings.length===0&&<div style={{ textAlign:"center",padding:"60px 20px",color:"#4a5a3a" }}><div style={{fontSize:48,marginBottom:16}}>🦌</div><p>No sightings logged for {activeProperty?.name} yet.</p></div>}
            <div style={{ display:"flex",flexDirection:"column",gap:12 }}>
              {propSightings.map(s=><SightingCard key={s.id} s={s}/>)}
            </div>
          </div>
        )}

        {/* ── CAMERAS ── */}
        {view==="cameras"&&(
          <CameraView
            cameras={cameras} photos={propPhotos} activeProperty={activeProperty}
            liveWeather={liveWeather}
            addCamOpen={addCamOpen} setAddCamOpen={setAddCamOpen}
            newCamName={newCamName} setNewCamName={setNewCamName}
            newCamMake={newCamMake} setNewCamMake={setNewCamMake}
            newCamLat={newCamLat} setNewCamLat={setNewCamLat}
            newCamLng={newCamLng} setNewCamLng={setNewCamLng}
            newCamNotes={newCamNotes} setNewCamNotes={setNewCamNotes}
            locatingCam={locatingCam} useCurrentLocationForCam={useCurrentLocationForCam}
            addCamera={addCamera}
            confirmDelCam={confirmDelCam} setConfirmDelCam={setConfirmDelCam}
            deleteCamera={deleteCamera}
            onAddPhoto={(photo)=>setPhotos(ps=>[photo,...ps])}
            onDeletePhoto={(id)=>setPhotos(ps=>ps.filter(p=>p.id!==id))}
            onMarkDuplicate={(id,val)=>setPhotos(ps=>ps.map(p=>p.id===id?{...p,duplicate:val}:p))}
            onUpdateNotes={(id,notes)=>setPhotos(ps=>ps.map(p=>p.id===id?{...p,notes}:p))}
            propId={activePropId}
          />
        )}

        {/* ── MAP ── */}
        {view==="map"&&<MapView stands={stands} cameras={cameras} sightings={propSightings} propertyName={activeProperty?.name}/>}

        {/* ── INSIGHTS ── */}
        {view==="insights"&&(
          <div style={{ display:"flex",flexDirection:"column",gap:16 }}>
            <div style={{ background:"rgba(74,93,45,0.12)",border:"1px solid rgba(168,196,100,0.2)",borderRadius:12,padding:16 }}>
              <p style={{ margin:"0 0 6px",fontSize:12,color:"#a8c464",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase" }}>💡 Recommendation · {activeProperty?.name}</p>
              <p style={{ margin:0,fontSize:14,color:"#c8d8a8",lineHeight:1.6 }}>
                {propSightings.length>=2
                  ? `Based on your data, ${bestStands[0]?.[0]} during ${bestTimes[0]?.[0]} shows the highest activity.${bestMoon[0]?` Deer movement peaks for you around the ${bestMoon[0][0]}.`:""}`
                  : "Log more sightings to unlock predictive recommendations for this property."}
              </p>
            </div>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
              <StatCard label="Total Deer" value={totalDeer} icon="🦌"/>
              <StatCard label="Bucks Seen" value={buckCount} icon="🏆"/>
              <StatCard label="Hunt Sessions" value={propSightings.length} icon="📋"/>
              <StatCard label="Camera Photos" value={propPhotos.filter(p=>!p.duplicate).length} icon="📷"/>
            </div>
            <InsightPanel title="🎯 Top Stand Sites">
              {bestStands.length===0?<p style={{color:"#4a5a3a",fontSize:13,margin:0}}>No data yet.</p>:bestStands.slice(0,4).map(([stand,count],i)=><RankRow key={stand} rank={i+1} label={stand} value={`${count} deer`} max={bestStands[0][1]}/>)}
            </InsightPanel>
            <InsightPanel title="⏰ Best Times to Hunt">
              {bestTimes.length===0?<p style={{color:"#4a5a3a",fontSize:13,margin:0}}>No data yet.</p>:bestTimes.slice(0,4).map(([time,count],i)=><RankRow key={time} rank={i+1} label={time} value={`${count} sightings`} max={bestTimes[0][1]}/>)}
            </InsightPanel>
            <InsightPanel title="🌕 Activity by Moon Phase">
              {bestMoon.length===0?<p style={{color:"#4a5a3a",fontSize:13,margin:0}}>Log more sightings to see moon data.</p>:bestMoon.map(([phase,count],i)=><RankRow key={phase} rank={i+1} label={phase} value={`${count} deer`} max={bestMoon[0][1]}/>)}
            </InsightPanel>
          </div>
        )}

        {/* ── STANDS ── */}
        {view==="stands"&&(
          <div>
            <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16 }}>
              <p style={{ margin:0,color:"#6a7a5a",fontSize:13 }}>{stands.length} stand{stands.length!==1?"s":""} on {activeProperty?.name}</p>
              <button onClick={()=>{setAddStandOpen(v=>!v);setNewStandName("");setNewStandLat("");setNewStandLng("");}} style={{ background:addStandOpen?"rgba(168,196,100,0.15)":"rgba(255,255,255,0.05)",border:addStandOpen?"1px solid rgba(168,196,100,0.4)":"1px solid rgba(255,255,255,0.1)",color:addStandOpen?"#a8c464":"#8a9a7a",borderRadius:8,padding:"8px 14px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"Georgia,serif",transition:"all 0.2s" }}>{addStandOpen?"✕ Close":"+ Add Stand"}</button>
            </div>
            {addStandOpen&&(
              <div style={{ background:"rgba(168,196,100,0.05)",border:"1px solid rgba(168,196,100,0.15)",borderRadius:12,padding:16,marginBottom:16 }}>
                <p style={{ margin:"0 0 10px",fontSize:12,color:"#a8c464",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em" }}>New Stand</p>
                <input value={newStandName} onChange={e=>setNewStandName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addStand()} placeholder="Stand name" style={{...inputStyle,marginBottom:8}}/>
                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8 }}>
                  <input value={newStandLat} onChange={e=>setNewStandLat(e.target.value)} placeholder="Latitude (optional)" style={inputStyle}/>
                  <input value={newStandLng} onChange={e=>setNewStandLng(e.target.value)} placeholder="Longitude (optional)" style={inputStyle}/>
                </div>
                <button onClick={useCurrentLocationForStand} disabled={locatingStand} style={{ background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",color:locatingStand?"#4a5a3a":"#8a9a7a",borderRadius:8,padding:"8px 14px",fontSize:12,cursor:locatingStand?"wait":"pointer",fontFamily:"Georgia,serif",marginBottom:8,transition:"all 0.2s" }}>{locatingStand?"📡 Detecting…":"📡 Use Current Location"}</button>
                {newStandLat&&newStandLng&&<div style={{fontSize:12,color:"#a8c464",marginBottom:8}}>✓ {parseFloat(newStandLat).toFixed(4)}, {parseFloat(newStandLng).toFixed(4)}</div>}
                <button onClick={addStand} disabled={!newStandName.trim()} style={{ background:newStandName.trim()?"#4a5d2d":"rgba(255,255,255,0.05)",color:newStandName.trim()?"#e8dcc8":"#3a4a2a",border:"none",borderRadius:8,padding:"10px 18px",fontSize:13,fontWeight:600,cursor:newStandName.trim()?"pointer":"default",fontFamily:"Georgia,serif",transition:"all 0.2s" }}>+ Add Stand</button>
              </div>
            )}
            <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
              {stands.map((stand,i)=>{
                const sc=propSightings.filter(s=>s.stand===stand.name).length;
                const dc=propSightings.filter(s=>s.stand===stand.name).reduce((sum,s)=>sum+s.deer.reduce((a,d)=>a+(d.count||1),0),0);
                const bestTime=getBestTimeForStand(stand.name,propSightings);
                return (
                  <div key={i} style={{ background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:12,padding:"12px 16px" }}>
                    {editingStand===i?(
                      <div style={{ display:"flex",gap:8,alignItems:"center" }}>
                        <input value={editStandVal} onChange={e=>setEditStandVal(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")saveEditStand(i);if(e.key==="Escape")setEditingStand(null);}} autoFocus style={{...inputStyle,flex:1}}/>
                        <button onClick={()=>saveEditStand(i)} style={sBtnStyle("#4a5d2d","#a8c464")}>Save</button>
                        <button onClick={()=>setEditingStand(null)} style={sBtnStyle("rgba(255,255,255,0.05)","#6a7a5a")}>Cancel</button>
                      </div>
                    ):confirmDelete===i?(
                      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",gap:8 }}>
                        <span style={{ fontSize:13,color:"#ff8080" }}>Delete "{stand.name}"?</span>
                        <div style={{ display:"flex",gap:8 }}>
                          <button onClick={()=>deleteStand(i)} style={sBtnStyle("rgba(200,60,60,0.2)","#ff8080")}>Delete</button>
                          <button onClick={()=>setConfirmDelete(null)} style={sBtnStyle("rgba(255,255,255,0.05)","#6a7a5a")}>Cancel</button>
                        </div>
                      </div>
                    ):(
                      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between" }}>
                        <div>
                          <div style={{ fontSize:14,fontWeight:700,color:"#e8dcc8",marginBottom:2 }}>📌 {stand.name}</div>
                          <div style={{ fontSize:12,color:"#4a5a3a" }}>{sc} hunt{sc!==1?"s":""} · {dc} deer{stand.lat&&stand.lng?` · ${stand.lat.toFixed(3)}, ${stand.lng.toFixed(3)}`:" · no coords yet"}</div>
                          {bestTime&&<div style={{ fontSize:12,color:"#a8c464",marginTop:2 }}>⏰ Best time: {bestTime}</div>}
                        </div>
                        <div style={{ display:"flex",gap:8 }}>
                          <button onClick={()=>{setEditingStand(i);setEditStandVal(stand.name);}} style={sBtnStyle("rgba(255,255,255,0.05)","#8a9a7a")}>Edit</button>
                          <button onClick={()=>setConfirmDelete(i)} style={sBtnStyle("rgba(200,60,60,0.1)","#ff6060")}>✕</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {stands.length===0&&<div style={{ textAlign:"center",padding:"40px 20px",color:"#4a5a3a" }}><div style={{fontSize:36,marginBottom:10}}>📌</div><p>No stands yet. Add your first one above!</p></div>}
            </div>
          </div>
        )}

        {/* ── NEW ENTRY ── */}
        {view==="new"&&form&&(
          <div>
            <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:24 }}>
              <button onClick={()=>setView("log")} style={{ background:"none",border:"1px solid rgba(255,255,255,0.12)",color:"#8a9a7a",borderRadius:8,padding:"8px 14px",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif" }}>← Back</button>
              <h2 style={{ margin:0,fontSize:18,fontWeight:700 }}>New Sighting · <span style={{color:"#6a8a5a",fontSize:14}}>{activeProperty?.name}</span></h2>
            </div>
            <Section title="📍 Location">
              <div style={{ display:"flex",gap:10,marginBottom:12 }}>
                <OptionBtn active={form.locationMethod==="gps"} onClick={detectLocation}>📡 Auto-detect GPS</OptionBtn>
                <OptionBtn active={form.locationMethod==="stand"} onClick={()=>setForm(f=>({...f,locationMethod:"stand",location:null}))}>📌 Choose Stand</OptionBtn>
              </div>
              {form.locationMethod==="gps"&&form.location&&<div style={{ background:"rgba(168,196,100,0.08)",borderRadius:8,padding:"10px 14px",fontSize:13,color:"#a8c464" }}>✓ GPS locked · {form.location.lat.toFixed(4)}, {form.location.lng.toFixed(4)}</div>}
              {form.locationMethod==="stand"&&stands.length>0&&<select value={form.stand||""} onChange={e=>setForm(f=>({...f,stand:e.target.value}))} style={inputStyle}><option value="">Select a stand…</option>{stands.map(s=><option key={s.name} value={s.name}>{s.name}</option>)}</select>}
              {form.locationMethod==="stand"&&stands.length===0&&<div style={{ background:"rgba(200,100,60,0.1)",borderRadius:8,padding:"10px 14px",fontSize:13,color:"#c8906a" }}>No stands saved for {activeProperty?.name} yet.</div>}
            </Section>
            <Section title="🕐 Date & Time">
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
                <div><label style={labelStyle}>Date</label><input type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value,moon:getMoonPhase(e.target.value)}))} style={inputStyle}/></div>
                <div><label style={labelStyle}>Time</label><input type="time" value={form.time} onChange={e=>{const h=parseInt(e.target.value.split(":")[0]);setForm(f=>({...f,time:e.target.value,timeOfDay:getTimeOfDay(h)}));}} style={inputStyle}/></div>
              </div>
              <div style={{ marginTop:8,fontSize:12,color:"#7a8a6a" }}>Period: <span style={{color:"#a8c464"}}>{form.timeOfDay}</span></div>
            </Section>
            <Section title="🌕 Moon Phase">
              <div style={{ background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,padding:14,display:"flex",alignItems:"center",gap:16 }}>
                <span style={{ fontSize:42,lineHeight:1 }}>{form.moon.emoji}</span>
                <div>
                  <div style={{ fontSize:15,fontWeight:700,color:"#e8dcc8",marginBottom:3 }}>{form.moon.name}</div>
                  <div style={{ fontSize:12,color:"#6a7a5a",marginBottom:4 }}>{form.moon.illumination}% illuminated · Day {form.moon.age} of cycle</div>
                  <div style={{ fontSize:12,color:"#8a9a8a",lineHeight:1.4 }}>{form.moon.activity}</div>
                </div>
              </div>
            </Section>
            <Section title="🌤 Weather">
              <div style={{ background:"rgba(255,255,255,0.04)",borderRadius:10,padding:14,display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,fontSize:13 }}>
                <div><span style={{color:"#6a7a5a"}}>Condition</span><br/><span style={{color:"#e8dcc8"}}>{form.weather.emoji} {form.weather.condition}</span></div>
                <div><span style={{color:"#6a7a5a"}}>Temperature</span><br/><span style={{color:"#e8dcc8"}}>{form.weather.temp}°F</span></div>
                <div><span style={{color:"#6a7a5a"}}>Wind</span><br/><span style={{color:"#e8dcc8"}}>{form.weather.wind}mph {form.weather.windDir}</span></div>
                <div><span style={{color:"#6a7a5a"}}>Pressure</span><br/><span style={{color:"#e8dcc8"}}>{form.weather.pressure}"</span></div>
              </div>
            </Section>
            <Section title="🦌 Deer Groups">
              {form.groups.map((g,i)=>(
                <div key={i} style={{ background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,padding:14,marginBottom:10,position:"relative" }}>
                  {form.groups.length>1&&<button onClick={()=>removeGroup(i)} style={{ position:"absolute",top:10,right:10,background:"rgba(255,80,80,0.15)",border:"none",color:"#ff6060",borderRadius:6,width:24,height:24,cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center" }}>×</button>}
                  <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 80px",gap:10,marginBottom:10 }}>
                    <div><label style={labelStyle}>Type</label><select value={g.type} onChange={e=>updateGroup(i,"type",e.target.value)} style={inputStyle}><option value="buck">Buck</option><option value="doe">Doe</option><option value="fawn">Fawn</option></select></div>
                    {g.type==="buck"&&<div><label style={labelStyle}>Age</label><select value={g.age||""} onChange={e=>updateGroup(i,"age",e.target.value)} style={inputStyle}>{BUCK_AGES.map(a=><option key={a} value={a}>{a}</option>)}</select></div>}
                    <div style={{ gridColumn:g.type==="buck"?3:"2 / span 2" }}><label style={labelStyle}>Count</label><input type="number" min="1" max="30" value={g.count} onChange={e=>updateGroup(i,"count",parseInt(e.target.value)||1)} style={{...inputStyle,textAlign:"center"}}/></div>
                  </div>
                  <div>
                    <label style={{...labelStyle,display:"block",marginBottom:6}}>Behavior</label>
                    <div style={{ display:"flex",flexWrap:"wrap",gap:6 }}>
                      {BEHAVIORS.map(b=><button key={b} onClick={()=>toggleBehavior(i,b)} style={{ background:g.behaviors.includes(b)?"rgba(168,196,100,0.2)":"rgba(255,255,255,0.05)",border:g.behaviors.includes(b)?"1px solid rgba(168,196,100,0.5)":"1px solid rgba(255,255,255,0.08)",color:g.behaviors.includes(b)?"#a8c464":"#6a7a5a",borderRadius:6,padding:"5px 10px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif",transition:"all 0.15s" }}>{b}</button>)}
                    </div>
                  </div>
                </div>
              ))}
              <button onClick={addGroup} style={{ background:"none",border:"1px dashed rgba(255,255,255,0.12)",color:"#6a7a5a",borderRadius:8,padding:"10px 16px",width:"100%",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif" }}>+ Add Another Group</button>
            </Section>
            <Section title="📝 Notes">
              <textarea value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Wind direction, scrape activity, travel corridors…" style={{...inputStyle,minHeight:80,resize:"vertical",lineHeight:1.6}}/>
            </Section>
            <button onClick={saveSighting} disabled={saving||saved} style={{ width:"100%",background:saved?"#2a5a1a":"#4a5d2d",color:"#e8dcc8",border:"none",borderRadius:10,padding:"16px",fontSize:15,fontWeight:700,cursor:saving?"wait":"pointer",fontFamily:"Georgia,serif",letterSpacing:"0.04em",boxShadow:"0 4px 20px rgba(74,93,45,0.4)",transition:"all 0.3s" }}>
              {saved?"✓ Saved!":saving?"Saving…":"Save Sighting"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Camera View ──────────────────────────────────────────────────────────────
function CameraView({ cameras, photos, activeProperty, liveWeather, addCamOpen, setAddCamOpen, newCamName, setNewCamName, newCamMake, setNewCamMake, newCamLat, setNewCamLat, newCamLng, setNewCamLng, newCamNotes, setNewCamNotes, locatingCam, useCurrentLocationForCam, addCamera, confirmDelCam, setConfirmDelCam, deleteCamera, onAddPhoto, onDeletePhoto, onMarkDuplicate, onUpdateNotes, propId }) {
  const [camTab,       setCamTab]       = useState("photos"); // photos | manage
  const [analyzing,    setAnalyzing]    = useState(false);
  const [selectedPhoto,setSelectedPhoto]= useState(null);
  const [showDupes,    setShowDupes]    = useState(false);
  const fileInputRef = useRef(null);

  const visiblePhotos = showDupes ? photos : photos.filter(p=>!p.duplicate);
  const dupeCount = photos.filter(p=>p.duplicate).length;

  async function handleFileImport(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    for (const file of files) {
      setAnalyzing(true);
      try {
        const base64 = await new Promise((res,rej) => {
          const reader = new FileReader();
          reader.onload = () => res(reader.result.split(",")[1]);
          reader.onerror = rej;
          reader.readAsDataURL(file);
        });
        const mediaType = file.type || "image/jpeg";
        const now = new Date();
        const exif = extractExifDate(base64);
        const date = exif?.date || now.toISOString().split("T")[0];
        const time = exif?.time || now.toTimeString().slice(0,5);
        const hour = parseInt(time.split(":")[0]);
        const moon = getMoonPhase(date);
        let weather = liveWeather || {condition:"Unknown",emoji:"🌤",temp:"—",wind:"—",windDir:"—",pressure:"—",live:false};

        // Check for duplicate (same camera, within 5 min of existing photo)
        const newTs = new Date(`${date}T${time}`).getTime();
        const isDupe = photos.some(p => {
          const pts = new Date(`${p.date}T${p.time}`).getTime();
          return p.cameraId === (cameras[0]?.id||"") && Math.abs(newTs-pts) < 5*60*1000;
        });

        let aiAnalysis = null;
        try { aiAnalysis = await analyzePhotoWithClaude(base64, mediaType); }
        catch { aiAnalysis = {deer:[],totalDeer:0,imageQuality:"unknown",summary:"AI analysis unavailable — check API connection."}; }

        const photo = {
          id: "ph_"+Date.now()+"_"+Math.random().toString(36).slice(2),
          propertyId: propId, cameraId: cameras[0]?.id||"manual", cameraName: cameras[0]?.name||"Imported",
          date, time, timeOfDay: getTimeOfDay(hour), weather, moon,
          aiAnalysis, notes:"", duplicate: isDupe,
          imageData: `data:${mediaType};base64,${base64}`,
        };
        onAddPhoto(photo);
      } catch(err) { console.error("Import error:",err); }
    }
    setAnalyzing(false);
    e.target.value = "";
  }

  return (
    <div>
      {/* Tab bar */}
      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16 }}>
        <div style={{ display:"flex",gap:0,background:"rgba(255,255,255,0.04)",borderRadius:8,padding:3 }}>
          {[["photos","Photos"],["manage","Cameras"]].map(([t,label])=>(
            <button key={t} onClick={()=>setCamTab(t)} style={{ background:camTab===t?"rgba(168,196,100,0.15)":"none",border:camTab===t?"1px solid rgba(168,196,100,0.3)":"1px solid transparent",color:camTab===t?"#a8c464":"#6a7a5a",borderRadius:6,padding:"7px 16px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"Georgia,serif",transition:"all 0.2s" }}>{label}</button>
          ))}
        </div>
        {camTab==="photos"&&(
          <div style={{ display:"flex",gap:8,alignItems:"center" }}>
            {dupeCount>0&&(
              <button onClick={()=>setShowDupes(v=>!v)} style={{ background:showDupes?"rgba(255,160,60,0.15)":"rgba(255,255,255,0.05)",border:showDupes?"1px solid rgba(255,160,60,0.4)":"1px solid rgba(255,255,255,0.1)",color:showDupes?"#ffa03c":"#6a7a5a",borderRadius:8,padding:"7px 12px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif" }}>
                {showDupes?"Hide":"Show"} {dupeCount} dupe{dupeCount!==1?"s":""}
              </button>
            )}
            <button onClick={()=>fileInputRef.current?.click()} disabled={analyzing} style={{ background:"#4a5d2d",color:"#e8dcc8",border:"none",borderRadius:8,padding:"8px 14px",fontSize:12,fontWeight:600,cursor:analyzing?"wait":"pointer",fontFamily:"Georgia,serif",boxShadow:"0 2px 8px rgba(74,93,45,0.4)" }}>
              {analyzing?"🔍 Analyzing…":"📥 Import Photos"}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" multiple style={{display:"none"}} onChange={handleFileImport}/>
          </div>
        )}
        {camTab==="manage"&&(
          <button onClick={()=>setAddCamOpen(v=>!v)} style={{ background:addCamOpen?"rgba(168,196,100,0.15)":"rgba(255,255,255,0.05)",border:addCamOpen?"1px solid rgba(168,196,100,0.4)":"1px solid rgba(255,255,255,0.1)",color:addCamOpen?"#a8c464":"#8a9a7a",borderRadius:8,padding:"8px 14px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"Georgia,serif" }}>{addCamOpen?"✕ Close":"+ Add Camera"}</button>
        )}
      </div>

      {/* PHOTOS TAB */}
      {camTab==="photos"&&(
        <div>
          {analyzing&&(
            <div style={{ background:"rgba(168,196,100,0.08)",border:"1px solid rgba(168,196,100,0.2)",borderRadius:12,padding:16,marginBottom:16,display:"flex",alignItems:"center",gap:12 }}>
              <div style={{ fontSize:24 }}>🔍</div>
              <div>
                <div style={{ fontSize:14,fontWeight:700,color:"#a8c464",marginBottom:2 }}>AI Analyzing Photo…</div>
                <div style={{ fontSize:12,color:"#6a7a5a" }}>Identifying deer, age class, behavior, and antler description</div>
              </div>
            </div>
          )}
          <p style={{ margin:"0 0 16px",color:"#6a7a5a",fontSize:13 }}>{visiblePhotos.length} photo{visiblePhotos.length!==1?"s":""} · {photos.filter(p=>!p.duplicate&&p.aiAnalysis?.totalDeer>0).reduce((s,p)=>s+p.aiAnalysis.totalDeer,0)} deer detected</p>
          {visiblePhotos.length===0&&(
            <div style={{ textAlign:"center",padding:"50px 20px",color:"#4a5a3a" }}>
              <div style={{ fontSize:48,marginBottom:12 }}>📷</div>
              <p style={{ marginBottom:16 }}>No photos yet for {activeProperty?.name}.</p>
              <button onClick={()=>fileInputRef.current?.click()} style={{ background:"#4a5d2d",color:"#e8dcc8",border:"none",borderRadius:8,padding:"10px 20px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"Georgia,serif" }}>📥 Import from Camera Roll</button>
              <input ref={fileInputRef} type="file" accept="image/*" multiple style={{display:"none"}} onChange={handleFileImport}/>
            </div>
          )}
          <div style={{ display:"flex",flexDirection:"column",gap:12 }}>
            {visiblePhotos.map(photo=>(
              <PhotoCard key={photo.id} photo={photo} onDelete={onDeletePhoto} onMarkDuplicate={onMarkDuplicate} onUpdateNotes={onUpdateNotes} onSelect={setSelectedPhoto}/>
            ))}
          </div>
        </div>
      )}

      {/* MANAGE CAMERAS TAB */}
      {camTab==="manage"&&(
        <div>
          {addCamOpen&&(
            <div style={{ background:"rgba(168,196,100,0.05)",border:"1px solid rgba(168,196,100,0.15)",borderRadius:12,padding:16,marginBottom:16 }}>
              <p style={{ margin:"0 0 10px",fontSize:12,color:"#a8c464",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em" }}>New Camera</p>
              <input value={newCamName} onChange={e=>setNewCamName(e.target.value)} placeholder="Camera name (e.g. Oak Scrape Cam)" style={{...inputStyle,marginBottom:8}}/>
              <input value={newCamMake} onChange={e=>setNewCamMake(e.target.value)} placeholder="Make/model (e.g. Browning Strike Force)" style={{...inputStyle,marginBottom:8}}/>
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8 }}>
                <input value={newCamLat} onChange={e=>setNewCamLat(e.target.value)} placeholder="Latitude (optional)" style={inputStyle}/>
                <input value={newCamLng} onChange={e=>setNewCamLng(e.target.value)} placeholder="Longitude (optional)" style={inputStyle}/>
              </div>
              <button onClick={useCurrentLocationForCam} disabled={locatingCam} style={{ background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",color:locatingCam?"#4a5a3a":"#8a9a7a",borderRadius:8,padding:"8px 14px",fontSize:12,cursor:locatingCam?"wait":"pointer",fontFamily:"Georgia,serif",marginBottom:8,transition:"all 0.2s" }}>{locatingCam?"📡 Detecting…":"📡 Use Current Location"}</button>
              {newCamLat&&newCamLng&&<div style={{fontSize:12,color:"#a8c464",marginBottom:8}}>✓ {parseFloat(newCamLat).toFixed(4)}, {parseFloat(newCamLng).toFixed(4)}</div>}
              <input value={newCamNotes} onChange={e=>setNewCamNotes(e.target.value)} placeholder="Notes (facing direction, target feature…)" style={{...inputStyle,marginBottom:8}}/>
              <button onClick={addCamera} disabled={!newCamName.trim()} style={{ background:newCamName.trim()?"#4a5d2d":"rgba(255,255,255,0.05)",color:newCamName.trim()?"#e8dcc8":"#3a4a2a",border:"none",borderRadius:8,padding:"10px 18px",fontSize:13,fontWeight:600,cursor:newCamName.trim()?"pointer":"default",fontFamily:"Georgia,serif",transition:"all 0.2s" }}>+ Add Camera</button>
            </div>
          )}
          <p style={{ margin:"0 0 12px",color:"#6a7a5a",fontSize:13 }}>{cameras.length} camera{cameras.length!==1?"s":""} on {activeProperty?.name}</p>
          <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
            {cameras.map(cam=>{
              const camPhotos=photos.filter(p=>p.cameraId===cam.id&&!p.duplicate);
              const camDeer=camPhotos.reduce((s,p)=>s+(p.aiAnalysis?.totalDeer||0),0);
              return (
                <div key={cam.id} style={{ background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:12,padding:"12px 16px" }}>
                  {confirmDelCam===cam.id?(
                    <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",gap:8 }}>
                      <span style={{ fontSize:13,color:"#ff8080" }}>Delete "{cam.name}"?</span>
                      <div style={{ display:"flex",gap:8 }}>
                        <button onClick={()=>deleteCamera(cam.id)} style={sBtnStyle("rgba(200,60,60,0.2)","#ff8080")}>Delete</button>
                        <button onClick={()=>setConfirmDelCam(null)} style={sBtnStyle("rgba(255,255,255,0.05)","#6a7a5a")}>Cancel</button>
                      </div>
                    </div>
                  ):(
                    <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between" }}>
                      <div>
                        <div style={{ fontSize:14,fontWeight:700,color:"#e8dcc8",marginBottom:2 }}>📷 {cam.name}</div>
                        <div style={{ fontSize:12,color:"#4a5a3a" }}>
                          {cam.make&&<span>{cam.make} · </span>}
                          {camPhotos.length} photo{camPhotos.length!==1?"s":""} · {camDeer} deer detected
                          {cam.lat&&cam.lng&&<span> · {cam.lat.toFixed(3)}, {cam.lng.toFixed(3)}</span>}
                        </div>
                        {cam.notes&&<div style={{ fontSize:12,color:"#6a7a5a",marginTop:2,fontStyle:"italic" }}>{cam.notes}</div>}
                      </div>
                      <button onClick={()=>setConfirmDelCam(cam.id)} style={sBtnStyle("rgba(200,60,60,0.1)","#ff6060")}>✕</button>
                    </div>
                  )}
                </div>
              );
            })}
            {cameras.length===0&&<div style={{ textAlign:"center",padding:"40px 20px",color:"#4a5a3a" }}><div style={{fontSize:36,marginBottom:10}}>📷</div><p>No cameras yet on {activeProperty?.name}. Add your first one!</p></div>}
          </div>
        </div>
      )}

      {/* Photo detail modal */}
      {selectedPhoto&&<PhotoModal photo={selectedPhoto} onClose={()=>setSelectedPhoto(null)} onDelete={(id)=>{onDeletePhoto(id);setSelectedPhoto(null);}} onMarkDuplicate={onMarkDuplicate} onUpdateNotes={onUpdateNotes}/>}
    </div>
  );
}

// ─── Photo Card ───────────────────────────────────────────────────────────────
function PhotoCard({ photo, onDelete, onMarkDuplicate, onUpdateNotes, onSelect }) {
  const ai = photo.aiAnalysis;
  const hasBuck = ai?.deer?.some(d=>d.type==="buck");
  return (
    <div style={{ background:"rgba(255,255,255,0.03)",border:photo.duplicate?"1px solid rgba(255,160,60,0.3)":hasBuck?"1px solid rgba(168,196,100,0.15)":"1px solid rgba(255,255,255,0.07)",borderLeft:photo.duplicate?"3px solid #ffa03c":hasBuck?"3px solid #a8c464":"1px solid rgba(255,255,255,0.07)",borderRadius:12,padding:"14px 16px" }}>
      <div style={{ display:"flex",gap:12 }}>
        {/* Thumbnail */}
        <div onClick={()=>photo.imageData&&onSelect(photo)} style={{ width:72,height:72,borderRadius:8,overflow:"hidden",flexShrink:0,background:"rgba(255,255,255,0.05)",display:"flex",alignItems:"center",justifyContent:"center",cursor:photo.imageData?"pointer":"default",border:"1px solid rgba(255,255,255,0.08)" }}>
          {photo.imageData ? <img src={photo.imageData} style={{width:"100%",height:"100%",objectFit:"cover"}}/> : <span style={{fontSize:28}}>📷</span>}
        </div>
        <div style={{ flex:1,minWidth:0 }}>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4 }}>
            <div>
              <div style={{ fontSize:13,fontWeight:700,color:"#e8dcc8" }}>{photo.cameraName}</div>
              <div style={{ fontSize:11,color:"#6a7a5a" }}>{photo.date} · {photo.time} · {photo.timeOfDay} · {photo.moon?.emoji} {photo.moon?.name}</div>
            </div>
            {photo.duplicate&&<span style={{ fontSize:10,background:"rgba(255,160,60,0.15)",border:"1px solid rgba(255,160,60,0.3)",color:"#ffa03c",borderRadius:4,padding:"2px 6px",fontWeight:700,whiteSpace:"nowrap",marginLeft:8 }}>DUPE</span>}
          </div>
          {ai&&(
            <div style={{ fontSize:12,marginBottom:6 }}>
              {ai.totalDeer===0 ? (
                <span style={{color:"#4a5a3a"}}>No deer detected</span>
              ) : ai.deer?.map((d,i)=>(
                <div key={i} style={{ color:"#c8d8a8",marginBottom:2 }}>
                  <span style={{color:d.type==="buck"?"#a8c464":"#8a9a7a",fontWeight:700}}>{d.count} {d.type}</span>
                  {d.age&&<span style={{color:"#6a7a5a"}}> · {d.age}</span>}
                  {d.antlerDescription&&<span style={{color:"#8a8a6a"}}> · {d.antlerDescription}</span>}
                  {d.behaviors?.length>0&&<span style={{color:"#5a6a4a"}}> · {d.behaviors.join(", ")}</span>}
                </div>
              ))}
              {ai.summary&&<div style={{color:"#5a6a4a",fontSize:11,marginTop:3,fontStyle:"italic"}}>{ai.summary}</div>}
            </div>
          )}
          <div style={{ display:"flex",gap:6,flexWrap:"wrap" }}>
            <button onClick={()=>onSelect(photo)} style={sBtnStyle("rgba(255,255,255,0.05)","#8a9a7a")}>View</button>
            <button onClick={()=>onMarkDuplicate(photo.id,!photo.duplicate)} style={sBtnStyle(photo.duplicate?"rgba(255,160,60,0.15)":"rgba(255,255,255,0.05)",photo.duplicate?"#ffa03c":"#6a7a5a")}>{photo.duplicate?"✓ Dupe":"Mark Dupe"}</button>
            <button onClick={()=>onDelete(photo.id)} style={sBtnStyle("rgba(200,60,60,0.1)","#ff6060")}>Delete</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Photo Modal ──────────────────────────────────────────────────────────────
function PhotoModal({ photo, onClose, onDelete, onMarkDuplicate, onUpdateNotes }) {
  const ai = photo.aiAnalysis;
  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:20 }} onClick={onClose}>
      <div style={{ background:"#0d1117",border:"1px solid rgba(255,255,255,0.1)",borderRadius:16,maxWidth:560,width:"100%",maxHeight:"90vh",overflow:"auto" }} onClick={e=>e.stopPropagation()}>
        {photo.imageData&&<img src={photo.imageData} style={{width:"100%",borderRadius:"16px 16px 0 0",maxHeight:320,objectFit:"cover"}}/>}
        <div style={{ padding:20 }}>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12 }}>
            <div>
              <div style={{ fontSize:15,fontWeight:700,color:"#e8dcc8",marginBottom:2 }}>📷 {photo.cameraName}</div>
              <div style={{ fontSize:12,color:"#6a7a5a" }}>{photo.date} · {photo.time} · {photo.timeOfDay}</div>
              <div style={{ fontSize:12,color:"#6a7a5a" }}>{photo.moon?.emoji} {photo.moon?.name} · {photo.weather?.emoji} {photo.weather?.condition} {photo.weather?.temp!=="—"?`${photo.weather?.temp}°F`:""}</div>
            </div>
            <button onClick={onClose} style={{ background:"none",border:"none",color:"#6a7a5a",fontSize:20,cursor:"pointer",padding:0,lineHeight:1 }}>✕</button>
          </div>
          {ai&&(
            <div style={{ background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,padding:14,marginBottom:12 }}>
              <div style={{ fontSize:11,color:"#a8c464",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:8 }}>🔍 AI Analysis</div>
              {ai.totalDeer===0?<p style={{color:"#4a5a3a",margin:0,fontSize:13}}>No deer detected.</p>:ai.deer?.map((d,i)=>(
                <div key={i} style={{ marginBottom:10,paddingBottom:10,borderBottom:i<ai.deer.length-1?"1px solid rgba(255,255,255,0.05)":"none" }}>
                  <div style={{ fontSize:14,fontWeight:700,color:d.type==="buck"?"#a8c464":"#c8d8a8",marginBottom:3 }}>{d.count} {d.type}{d.count>1?"s":""}{d.age?` · ${d.age}`:""}</div>
                  {d.antlerDescription&&<div style={{ fontSize:12,color:"#a8a860",marginBottom:2 }}>🦌 {d.antlerDescription}</div>}
                  {d.behaviors?.length>0&&<div style={{ fontSize:12,color:"#6a7a5a",marginBottom:2 }}>Behavior: {d.behaviors.join(", ")}</div>}
                  {d.notes&&<div style={{ fontSize:12,color:"#5a6a4a",fontStyle:"italic" }}>{d.notes}</div>}
                  <div style={{ fontSize:11,color:"#3a4a3a",marginTop:3 }}>Confidence: {d.confidence}</div>
                </div>
              ))}
              {ai.summary&&<div style={{fontSize:12,color:"#5a6a4a",marginTop:4,fontStyle:"italic",borderTop:"1px solid rgba(255,255,255,0.05)",paddingTop:8}}>{ai.summary}</div>}
            </div>
          )}
          <div style={{ display:"flex",gap:8,flexWrap:"wrap" }}>
            <button onClick={()=>onMarkDuplicate(photo.id,!photo.duplicate)} style={sBtnStyle(photo.duplicate?"rgba(255,160,60,0.15)":"rgba(255,255,255,0.05)",photo.duplicate?"#ffa03c":"#6a7a5a")}>{photo.duplicate?"✓ Marked Duplicate":"Mark as Duplicate"}</button>
            <button onClick={()=>{onDelete(photo.id);onClose();}} style={sBtnStyle("rgba(200,60,60,0.2)","#ff8080")}>Delete Photo</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Map View ─────────────────────────────────────────────────────────────────
function MapView({ stands, cameras, sightings, propertyName }) {
  const mapRef=useRef(null), leafletMap=useRef(null), tileLayerRef=useRef(null), markersRef=useRef([]);
  const [activeLayer,  setActiveLayer]  = useState("street");
  const [showStands,   setShowStands]   = useState(true);
  const [showCameras,  setShowCameras]  = useState(true);
  const [showSightings,setShowSightings]= useState(true);

  useEffect(()=>{
    if (!document.getElementById("leaflet-css")) { const l=document.createElement("link"); l.id="leaflet-css"; l.rel="stylesheet"; l.href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"; document.head.appendChild(l); }
    if (!window.L) { const s=document.createElement("script"); s.src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"; s.onload=()=>initMap(); document.head.appendChild(s); }
    else initMap();
    return ()=>{ if(leafletMap.current){leafletMap.current.remove();leafletMap.current=null;} };
  },[]);

  useEffect(()=>{ if(leafletMap.current) renderMarkers(); },[stands,cameras,sightings,showStands,showCameras,showSightings]);

  useEffect(()=>{
    if(!leafletMap.current||!window.L) return;
    if(tileLayerRef.current) leafletMap.current.removeLayer(tileLayerRef.current);
    const l=MAP_LAYERS[activeLayer];
    tileLayerRef.current=window.L.tileLayer(l.url,{attribution:l.attr,maxZoom:18}).addTo(leafletMap.current);
  },[activeLayer]);

  function initMap(){
    if(leafletMap.current||!mapRef.current) return;
    const L=window.L;
    const all=[...stands,...cameras].filter(x=>x.lat&&x.lng);
    const center=all.length?[all[0].lat,all[0].lng]:[38.235,-92.455];
    leafletMap.current=L.map(mapRef.current,{zoomControl:true}).setView(center,14);
    const l=MAP_LAYERS[activeLayer];
    tileLayerRef.current=L.tileLayer(l.url,{attribution:l.attr,maxZoom:18}).addTo(leafletMap.current);
    renderMarkers();
  }

  function renderMarkers(){
    const L=window.L; if(!L||!leafletMap.current) return;
    markersRef.current.forEach(m=>leafletMap.current.removeLayer(m)); markersRef.current=[];

    if(showStands) stands.forEach(s=>{
      if(!s.lat||!s.lng) return;
      const icon=L.divIcon({className:"",html:`<div style="background:#4a5d2d;border:2px solid #a8c464;border-radius:50% 50% 50% 0;width:20px;height:20px;transform:rotate(-45deg);box-shadow:0 2px 8px rgba(0,0,0,0.5)"></div>`,iconSize:[20,20],iconAnchor:[10,20]});
      const m=L.marker([s.lat,s.lng],{icon}).addTo(leafletMap.current).bindPopup(`<div style="font-family:Georgia,serif;color:#1a2a0a"><b>📌 ${s.name}</b></div>`);
      markersRef.current.push(m);
    });

    if(showCameras) cameras.forEach(c=>{
      if(!c.lat||!c.lng) return;
      const icon=L.divIcon({className:"",html:`<div style="background:#2a4a6a;border:2px solid #6ab0f0;border-radius:6px;width:20px;height:20px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.5);font-size:11px">📷</div>`,iconSize:[20,20],iconAnchor:[10,10]});
      const m=L.marker([c.lat,c.lng],{icon}).addTo(leafletMap.current).bindPopup(`<div style="font-family:Georgia,serif;color:#1a2a0a"><b>📷 ${c.name}</b>${c.make?`<br><span style="font-size:11px">${c.make}</span>`:""}</div>`);
      markersRef.current.push(m);
    });

    if(showSightings) sightings.filter(s=>s.location?.lat).forEach(s=>{
      const hasBuck=s.deer.some(d=>d.type==="buck");
      const icon=L.divIcon({className:"",html:`<div style="background:${hasBuck?"#c8a020":"#8a6a30"};border:2px solid ${hasBuck?"#f0c840":"#c8a060"};border-radius:50%;width:12px;height:12px;box-shadow:0 2px 6px rgba(0,0,0,0.4)"></div>`,iconSize:[12,12],iconAnchor:[6,6]});
      markersRef.current.push(L.marker([s.location.lat,s.location.lng],{icon}).addTo(leafletMap.current).bindPopup(`<div style="font-family:Georgia,serif;color:#1a2a0a"><b>${hasBuck?"🦌 Buck":"🦌 Sighting"}</b><br>${s.date} · ${s.timeOfDay}</div>`));
    });
  }

  return (
    <div>
      {/* Layer toggle */}
      <div style={{ display:"flex",gap:8,marginBottom:10,flexWrap:"wrap" }}>
        {Object.entries(MAP_LAYERS).map(([key,l])=>(
          <button key={key} onClick={()=>setActiveLayer(key)} style={{ background:activeLayer===key?"#4a5d2d":"rgba(255,255,255,0.05)",border:activeLayer===key?"1px solid #a8c464":"1px solid rgba(255,255,255,0.1)",color:activeLayer===key?"#a8c464":"#6a7a5a",borderRadius:8,padding:"7px 14px",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:600,transition:"all 0.2s" }}>{l.label}</button>
        ))}
      </div>
      {/* Layer visibility toggles */}
      <div style={{ display:"flex",gap:8,marginBottom:12,flexWrap:"wrap" }}>
        {[[showStands,setShowStands,"📌 Stands","#a8c464"],[showCameras,setShowCameras,"📷 Cameras","#6ab0f0"],[showSightings,setShowSightings,"🦌 Sightings","#c8a020"]].map(([active,setFn,label,color])=>(
          <button key={label} onClick={()=>setFn(v=>!v)} style={{ background:active?`${color}22`:"rgba(255,255,255,0.04)",border:active?`1px solid ${color}66`:"1px solid rgba(255,255,255,0.08)",color:active?color:"#4a5a3a",borderRadius:6,padding:"5px 12px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif",transition:"all 0.2s" }}>{active?"✓ ":""}{label}</button>
        ))}
      </div>
      <div ref={mapRef} style={{ height:440,borderRadius:12,overflow:"hidden",border:"1px solid rgba(255,255,255,0.1)",background:"#1a2a1a" }}/>
      <p style={{ margin:"8px 0 0",fontSize:12,color:"#4a5a3a" }}>Tap any pin to see details · {propertyName}</p>
    </div>
  );
}

// ─── Shared Components ────────────────────────────────────────────────────────
function SightingCard({ s }) {
  const [open,setOpen]=useState(false);
  const totalDeer=s.deer.reduce((sum,d)=>sum+(d.count||1),0), hasBuck=s.deer.some(d=>d.type==="buck");
  return (
    <div onClick={()=>setOpen(!open)} style={{ background:"rgba(255,255,255,0.03)",borderRadius:12,padding:"14px 16px",cursor:"pointer",border:hasBuck?"1px solid rgba(168,196,100,0.15)":"1px solid rgba(255,255,255,0.07)",borderLeft:hasBuck?"3px solid #a8c464":"1px solid rgba(255,255,255,0.07)",transition:"background 0.2s" }}>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start" }}>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:14,fontWeight:700,color:"#e8dcc8",marginBottom:3 }}>{s.stand||(s.location?`GPS · ${s.location.lat.toFixed(3)}, ${s.location.lng.toFixed(3)}`:"Unknown")}</div>
          <div style={{ fontSize:12,color:"#6a7a5a" }}>{s.date} · {s.time} · {s.timeOfDay}{s.moon&&<span style={{marginLeft:8}}>{s.moon.emoji} {s.moon.name}</span>}</div>
        </div>
        <div style={{ textAlign:"right",marginLeft:12 }}>
          <div style={{ fontSize:20,fontWeight:800,color:hasBuck?"#a8c464":"#8a9a7a" }}>{totalDeer}</div>
          <div style={{ fontSize:10,color:"#4a5a3a",textTransform:"uppercase",letterSpacing:"0.08em" }}>deer</div>
        </div>
      </div>
      {open&&(
        <div style={{ marginTop:12,paddingTop:12,borderTop:"1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10 }}>
            <div style={{ fontSize:12 }}><span style={{ color:"#4a5a3a",textTransform:"uppercase",letterSpacing:"0.08em",fontSize:10 }}>Deer</span><div style={{ color:"#c8d8a8",marginTop:2 }}>{s.deer.map((d,i)=><div key={i}>{d.count} {d.type}{d.age?` (${d.age.split("(")[0].trim()})`:""} · {d.behaviors?.join(", ")||"—"}</div>)}</div></div>
            <div style={{ fontSize:12 }}><span style={{ color:"#4a5a3a",textTransform:"uppercase",letterSpacing:"0.08em",fontSize:10 }}>Weather</span><div style={{ color:"#c8d8a8",marginTop:2 }}>{s.weather.emoji} {s.weather.condition}<br/>{s.weather.temp}°F · {s.weather.wind}mph {s.weather.windDir}{s.weather.live&&<span style={{color:"#4a7a3a",marginLeft:4,fontSize:10}}>LIVE</span>}</div></div>
          </div>
          {s.moon&&<div style={{ fontSize:12,color:"#6a7a5a",marginBottom:8 }}>{s.moon.emoji} <span style={{color:"#8a9a8a"}}>{s.moon.name}</span> · {s.moon.illumination}% lit</div>}
          {s.notes&&<div style={{ fontSize:12,color:"#8a9a7a",fontStyle:"italic",lineHeight:1.5 }}>"{s.notes}"</div>}
        </div>
      )}
    </div>
  );
}
function Section({title,children}){return <div style={{marginBottom:20}}><h3 style={{margin:"0 0 10px",fontSize:13,fontWeight:700,color:"#6a7a5a",letterSpacing:"0.08em",textTransform:"uppercase"}}>{title}</h3>{children}</div>;}
function StatCard({label,value,icon}){return <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:12,padding:16,textAlign:"center"}}><div style={{fontSize:24,marginBottom:4}}>{icon}</div><div style={{fontSize:26,fontWeight:800,color:"#a8c464"}}>{value}</div><div style={{fontSize:11,color:"#4a5a3a",textTransform:"uppercase",letterSpacing:"0.1em",marginTop:2}}>{label}</div></div>;}
function InsightPanel({title,children}){return <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:12,padding:16}}><h3 style={{margin:"0 0 14px",fontSize:13,fontWeight:700,color:"#8a9a7a",letterSpacing:"0.06em"}}>{title}</h3><div style={{display:"flex",flexDirection:"column",gap:10}}>{children}</div></div>;}
function RankRow({rank,label,value,max}){const pct=Math.round((parseInt(value)/max)*100);return <div><div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:4}}><span style={{color:"#c8d8a8"}}><span style={{color:"#4a5a3a",marginRight:8}}>#{rank}</span>{label}</span><span style={{color:"#a8c464",fontWeight:700}}>{value}</span></div><div style={{height:4,background:"rgba(255,255,255,0.06)",borderRadius:2}}><div style={{height:"100%",width:`${pct}%`,background:"#4a5d2d",borderRadius:2,transition:"width 0.6s"}}/></div></div>;}
function OptionBtn({active,onClick,children}){return <button onClick={onClick} style={{flex:1,background:active?"rgba(168,196,100,0.15)":"rgba(255,255,255,0.04)",border:active?"1px solid rgba(168,196,100,0.4)":"1px solid rgba(255,255,255,0.08)",color:active?"#a8c464":"#6a7a5a",borderRadius:8,padding:"10px",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif",transition:"all 0.2s"}}>{children}</button>;}
function sBtnStyle(bg,color){return{background:bg,color,border:"none",borderRadius:6,padding:"6px 12px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:600,whiteSpace:"nowrap"};}
const inputStyle={width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",color:"#e8dcc8",borderRadius:8,padding:"10px 12px",fontSize:13,fontFamily:"Georgia,serif",boxSizing:"border-box",outline:"none",colorScheme:"dark"};
const labelStyle={fontSize:11,color:"#4a5a3a",textTransform:"uppercase",letterSpacing:"0.08em",display:"block",marginBottom:4};
