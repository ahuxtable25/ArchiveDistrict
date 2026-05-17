import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

/* ── Supabase client ── */
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

/* ── Save entire app state to Supabase (upsert single row id=1) ── */
const saveState = async (listings, stockData, goals) => {
  try {
    const ts = new Date().toISOString();
    const { error } = await supabase.from("app_state").upsert({
      id: 1,
      listings,
      stock_data: stockData,
      goals,
      updated_at: ts,
    }, { onConflict: "id" });
    if (error) { console.error("Supabase save error:", error.message); return false; }
    return true;
  } catch (err) {
    console.error("Supabase save exception:", err);
    return false;
  }
};

/* ── Local version history — stores last 10 snapshots in localStorage ── */
const VERSION_KEY = "ad_versions";
const MAX_VERSIONS = 10;

const saveLocalVersion = (listings, stockData) => {
  try {
    const existing = JSON.parse(localStorage.getItem(VERSION_KEY) || "[]");
    const last = existing[0];
    const now = Date.now();
    if (last && listings.length === last.listingsCount &&
        now - new Date(last.ts).getTime() < 30000) return;

    const d = new Date();
    const today = new Date(); today.setHours(0,0,0,0);
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate()-1);
    const ts = d.toISOString();

    const dayLabel = d >= today ? "Today"
      : d >= yesterday ? "Yesterday"
      : d.toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"});
    const timeLabel = d.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});
    const label = `${dayLabel} at ${timeLabel}`;

    const entry = { ts, label, dayLabel, timeLabel, listingsCount: listings.length, listings, stockData };
    const updated = [entry, ...existing].slice(0, MAX_VERSIONS);
    localStorage.setItem(VERSION_KEY, JSON.stringify(updated));
  } catch (e) { console.warn("Version save failed:", e); }
};

const loadLocalVersions = () => {
  try { return JSON.parse(localStorage.getItem(VERSION_KEY) || "[]"); }
  catch { return []; }
};


/* ═══════════════════════════════════════════════════════════════
   ARCHIVE DISTRICT — Business OS
   Command 1: Shell + Data + Storage + CSS + Navigation
═══════════════════════════════════════════════════════════════ */

/* ─── DATE CONSTANTS ─── */
// All date helpers are FUNCTIONS so they always return today's actual date
// even if the tab has been open for days
const getToday  = () => new Date().toISOString().split("T")[0];
const getNow    = () => new Date();
const TODAY     = getToday(); // used only for initial state defaults — components call getToday() directly

// For display in header — refreshes on re-render
const getDateDisplay = () => new Date().toLocaleDateString("en-GB", {
  weekday: "long", day: "numeric", month: "short", year: "numeric",
});
const DATE_DISPLAY = getDateDisplay();

const localDateStr = (d) => {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, "0");
  const dy = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dy}`;
};

const getWeekStart = () => {
  const d = new Date();
  d.setDate(d.getDate() - (d.getDay() === 0 ? 6 : d.getDay() - 1));
  return localDateStr(d);
};
const getMonthStart = () => {
  const d = new Date();
  return localDateStr(new Date(d.getFullYear(), d.getMonth(), 1));
};
const getIsSunday = () => new Date().getDay() === 0;

// Keep these for places that reference them as constants
// but now they call the live functions
const NOW         = new Date(); // kept for chart ranges only — doesn't affect date inputs
const _wsd        = (() => { const d=new Date(); d.setDate(d.getDate()-(d.getDay()===0?6:d.getDay()-1)); return d; })();
const WEEK_START  = getWeekStart();
const MONTH_START = getMonthStart();
const IS_SUNDAY   = getIsSunday();

/* ─── PUSH NOTIFICATIONS ─── */
/* ── OneSignal — send push to all subscribed devices ── */
async function sendPushNotification(payload) {
  try {
    await fetch("/api/push", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        title:   payload.title || "ArchiveDistrict",
        message: payload.body  || "",
      }),
    });
  } catch (e) { console.warn("[OneSignal] push failed:", e); }
}

/* ─── PLATFORM CONFIG ─── */
const PLATFORMS = [
  "Depop","Vinted","eBay","Whatnot","Tilt","Facebook Marketplace","Grailed","Other",
];
const PLAT_FEES = {
  "Depop":10,"Vinted":5,"eBay":12.9,
  "Whatnot":8,"Tilt":8,
  "Facebook Marketplace":0,"Grailed":9,"Other":10,
};
const WEBSITES = ["Fleek","VWS","Depop","eBay","Vinted","Other"];

/* ─── LISTING DROPDOWN OPTIONS (from real data + common extras) ─── */
const DEFAULT_COLOURS = [
  "Black","White","Navy","Blue","Grey","Brown","Beige","Green","Red","Yellow",
  "Dark Blue","Light Blue","Black and Red","White and Grey","Olive","Orange","Purple","Pink","Multicolour",
];
const DEFAULT_TYPES = [
  "Jacket","Denim Jacket","Track Jacket","Jersey Top","Polo","Shorts","Jorts",
  "T-Shirt","Hoodie","Sweatshirt","Shirt","Trousers","Jeans","Vest","Coat","Gilet",
];
const DEFAULT_SIZES = [
  "XS","S","S/M","M","M/L","L","L/XL","XL","XXL","2XL","Regular","One Size",
];

/* ═══════════════════════════════════════════════════════════════
   STOCK DATA — 8 bundles
═══════════════════════════════════════════════════════════════ */
const STOCK_INIT = [];

/* ─── Listings seed data — empty, real data loaded from Supabase ─── */
const LISTINGS_INIT = [];

/* ═══════════════════════════════════════════════════════════════

/* ═══════════════════════════════════════════════════════════════
   HELPER FUNCTIONS
═══════════════════════════════════════════════════════════════ */
const fmt = (n) => `£${(+(n)||0).toFixed(2)}`;
const copyText = (t) => { try { navigator.clipboard.writeText(t); } catch (_) {} };

const getNextSku = (listings) => {
  const skus = listings.map(l=>l.sku).filter(s=>/^[A-Z]\d+$/.test(s));
  if (!skus.length) return "A173"; // starts after last real SKU
  const nums = skus.map(s => parseInt(s.slice(1)));
  const max  = Math.max(...nums);
  return `A${String(max + 1).padStart(3,"0")}`;
};

const getNextBundleSku = (stockData) => {
  const nums = stockData
    .map(s => parseInt((s.bundleSku||"").replace("BDL-","").replace(/^0+/,"")))
    .filter(n => !isNaN(n) && n > 0);
  return `BDL-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3,"0")}`;
};

const getTag = (name, type, brand, listings) => {
  const items = listings.filter(l=>l.name===name&&l.type===type&&l.brand===brand&&l.listed);
  const sold  = items.filter(l=>l.sold&&l.days!==null);
  if (!sold.length) return "UNKNOWN";          // 0 sold — no data
  if (sold.length < 3) return "NEW";           // 1–2 sold — too early to classify
  const t = items.length;
  const p = (n)=>t?Math.round(sold.filter(l=>l.days<=n).length/t*100):0;
  const [p7,p14,p30,p42] = [p(7),p(14),p(30),p(42)];
  if (p7>=60||p14>=80) return "FAST";
  if (p14>=50) return "MEDIUM";
  if (p42===0&&sold.length>0) return "DEAD";  // sold some but none within 42d
  return "SLOW";
};

const deriveStock = (stockData, listings) =>
  stockData.map(s => {
    // Match by BOTH bundleSku AND name so BDL-008 Detroit and BDL-008 Active stay separate
    const items       = listings.filter(l => l.bundleSku===s.bundleSku && l.name===s.name);
    const soldItems   = items.filter(l => l.sold);
    const listedItems = items.filter(l => l.listed);
    const netProceeds = soldItems.reduce((a,l) => a+(l.soldPrice||0), 0);
    // Use actual money paid for whole batch
    const totalCost   = s.totalCost || (s.sellable * (s.costPer||0));
    const costPerItem = s.sellable > 0 ? totalCost / s.sellable : (s.costPer||0);
    // Profit = revenue so far minus total batch cost (cash flow view)
    const totalProfit  = netProceeds - totalCost;
    const stockValLeft = items.filter(l=>!l.sold).length * costPerItem;
    const sellThru     = s.sellable ? Math.round(soldItems.length/s.sellable*100) : 0;
    // avgProfit per item sold = (soldPrice - costPerItem) per item
    const avgProfit    = soldItems.length ? (netProceeds - soldItems.length*costPerItem)/soldItems.length : 0;
    const avgSoldPrice = soldItems.length ? netProceeds/soldItems.length : 0;
    return {
      ...s, totalCost,
      qtySold:soldItems.length, qtyListed:listedItems.length,
      qtyListedNS:listedItems.filter(l=>!l.sold).length,
      qtyToBeListed:items.filter(l=>!l.listed&&!l.sold).length,
      qtyRemaining:items.filter(l=>!l.sold).length,
      netProceeds, stockValLeft,
      sellThru, totalProfit, avgProfit, avgSoldPrice,
    };
  });

const DEFAULT_COLS = [
  {id:"sel",          label:"",               visible:true,  locked:true,  minW:32 },
  {id:"photo",        label:"Photo",          visible:false, locked:false, minW:60 },
  {id:"bundleSku",    label:"Bundle SKU",     visible:true,  locked:false, minW:80 },
  {id:"name",         label:"Stock Name",     visible:true,  locked:false, minW:200},
  {id:"brand",        label:"Brand",          visible:true,  locked:false, minW:100},
  {id:"type",         label:"Type",           visible:true,  locked:false, minW:100},
  {id:"colour",       label:"Colour",         visible:true,  locked:false, minW:80 },
  {id:"size",         label:"Size",           visible:true,  locked:false, minW:60 },
  {id:"sku",          label:"SKU",            visible:true,  locked:false, minW:70 },
  {id:"desc",         label:"Description",    visible:true,  locked:false, minW:120},
  {id:"length",       label:"Length",         visible:true,  locked:false, minW:70 },
  {id:"pitToPit",     label:"Pit to Pit",     visible:true,  locked:false, minW:80 },
  {id:"listed",       label:"Listed?",        visible:true,  locked:false, minW:65 },
  {id:"price",        label:"Price £",        visible:true,  locked:false, minW:70 },
  {id:"sold",         label:"Sold?",          visible:true,  locked:false, minW:60 },
  {id:"soldPrice",    label:"Sold Price £",   visible:true,  locked:false, minW:85 },
  {id:"profit",       label:"Net Profit £",   visible:true,  locked:false, minW:85 },
  {id:"notes",        label:"Notes",          visible:true,  locked:false, minW:120},
  {id:"platform",     label:"Platform Sold",  visible:true,  locked:false, minW:100},
  {id:"platforms",    label:"Platforms Listed",visible:true, locked:false, minW:120},
  {id:"platformDates",label:"Listed Dates",   visible:true,  locked:false, minW:120},
  {id:"dayListed",    label:"Day Listed",     visible:true,  locked:false, minW:90 },
  {id:"daySold",      label:"Day Sold",       visible:true,  locked:false, minW:90 },
  {id:"days",         label:"Days to Sell",   visible:true,  locked:false, minW:90 },
  {id:"shipped",      label:"Shipped?",       visible:true,  locked:false, minW:75 },
];

/* ─── Default column config for Stock tab ─── */
const STOCK_COLS = [
  {id:"bundleSku",     label:"Bundle SKU",    visible:true,  locked:false, minW:85 },
  {id:"name",          label:"Stock Name",    visible:true,  locked:false, minW:200},
  {id:"website",       label:"Website",       visible:true,  locked:false, minW:90 },
  {id:"seller",        label:"Seller",        visible:false, locked:false, minW:120},
  {id:"datePurchased", label:"Date Ordered",  visible:true,  locked:false, minW:100},
  {id:"dateArrived",   label:"Date Received", visible:true,  locked:false, minW:110},
  {id:"contentDetails",label:"Contents",      visible:false, locked:false, minW:120},
  {id:"received",      label:"Rcvd Qty",      visible:true,  locked:false, minW:75 },
  {id:"sellable",      label:"Sellable",      visible:true,  locked:false, minW:70 },
  {id:"costPer",       label:"Cost/pc",       visible:true,  locked:false, minW:70 },
  {id:"totalCost",     label:"Total Cost",    visible:true,  locked:false, minW:85 },
  {id:"qtySold",       label:"Qty Sold",      visible:true,  locked:false, minW:70 },
  {id:"totalProfit",   label:"Bundle Profit", visible:true,  locked:false, minW:100},
  {id:"qtyRemaining",  label:"Remaining",     visible:true,  locked:false, minW:80 },
  {id:"qtyListed",     label:"Listed",        visible:true,  locked:false, minW:65 },
  {id:"qtyListedNS",   label:"Live",          visible:false, locked:false, minW:60 },
  {id:"qtyToBeListed", label:"To List",       visible:true,  locked:false, minW:70 },
  {id:"netProceeds",   label:"Net Proceeds",  visible:true,  locked:false, minW:100},
  {id:"stockValLeft",  label:"Stock Val Left",visible:false, locked:false, minW:100},
  {id:"sellThru",      label:"Sell-through",  visible:true,  locked:false, minW:90 },
  {id:"avgSoldPrice",  label:"Avg Sold Price",visible:true,  locked:false, minW:105},
  {id:"avgProfit",     label:"Avg Profit",    visible:true,  locked:false, minW:85 },
  {id:"restock",       label:"Restock?",      visible:true,  locked:false, minW:75 },
  {id:"imported",      label:"Imported",      visible:true,  locked:false, minW:75 },
];

/* ═══════════════════════════════════════════════════════════════
   SHARED UI PRIMITIVES
═══════════════════════════════════════════════════════════════ */
/* ─── ComboSelect — dropdown with "Add new…" option ─── */
function ComboSelect({ value, onChange, options, placeholder, style }) {
  const [adding, setAdding] = useState(false);
  const [newVal, setNewVal] = useState("");
  const allOpts = [...new Set([...options, value].filter(Boolean))].sort();

  if (adding) {
    return (
      <div style={{display:"flex",gap:5}}>
        <input
          className="finp" autoFocus
          placeholder={`Type new ${placeholder||"value"}…`}
          value={newVal}
          onChange={e=>setNewVal(e.target.value)}
          onKeyDown={e=>{
            if (e.key==="Enter" && newVal.trim()) { onChange(newVal.trim()); setAdding(false); setNewVal(""); }
            if (e.key==="Escape") { setAdding(false); setNewVal(""); }
          }}
          style={{flex:1,...(style||{})}}
        />
        <button className="btn btn-p btn-xs" onClick={()=>{ if(newVal.trim()){ onChange(newVal.trim()); setAdding(false); setNewVal(""); }}}>✓</button>
        <button className="btn btn-o btn-xs" onClick={()=>{ setAdding(false); setNewVal(""); }}>✕</button>
      </div>
    );
  }
  return (
    <select className="fsel" value={value||""} onChange={e=>{
      if (e.target.value==="__add__") { setAdding(true); }
      else onChange(e.target.value);
    }} style={style}>
      {!value && <option value="">— select —</option>}
      {allOpts.map(o=><option key={o} value={o}>{o}</option>)}
      <option value="__add__">+ Add new…</option>
    </select>
  );
}

/* ─── Table zoom ─── */
function useZoom(def=100) {
  const [zoom, setZoom] = useState(def);
  const presets = [50,75,100,125,150];
  const zoomIn  = () => setZoom(z => Math.min(200, presets.find(p=>p>z)||Math.min(z+10,200)));
  const zoomOut = () => setZoom(z => Math.max(40,  [...presets].reverse().find(p=>p<z)||Math.max(z-10,40)));
  const setPreset = (v) => setZoom(v);
  const fitView = () => setZoom(65);
  const style = (w) => ({
    transform:`scale(${zoom/100})`,
    transformOrigin:"top left",
    width: zoom < 100 ? `${10000/zoom}%` : "100%",
    minWidth: "100%",
  });
  return { zoom, zoomIn, zoomOut, setPreset, fitView, style, presets };
}

function ZoomBar({ zoom, zoomIn, zoomOut, setPreset, fitView, presets }) {
  return (
    <div className="zoom-bar">
      <button className="zb" onClick={zoomOut} title="Zoom out">−</button>
      <span className="zv">{zoom}%</span>
      <button className="zb" onClick={zoomIn} title="Zoom in">+</button>
      <div style={{display:"flex",gap:4,marginLeft:4,flexWrap:"wrap"}}>
        {presets.map(p=>(
          <button key={p} className={`zp${zoom===p?" active":""}`} onClick={()=>setPreset(p)}>{p}%</button>
        ))}
        <button className="zp" onClick={fitView}>⊡ Fit</button>
      </div>
      <span style={{marginLeft:"auto",fontSize:10,color:"var(--txd)",whiteSpace:"nowrap"}}>
        {zoom<100?"← scroll to see all cols":"drag edge to resize"}
      </span>
    </div>
  );
}

function MovTag({tag}) {
  const map={FAST:"mt mt-f",MEDIUM:"mt mt-m",SLOW:"mt mt-s",UNKNOWN:"mt mt-u",DEAD:"mt mt-d",NEW:"mt mt-n"};
  return <span className={map[tag]||"mt mt-u"}>{tag}</span>;
}

function useColWidths(cols) {
  const [widths, setWidths] = useState({});
  const startX   = useRef(null);
  const startW   = useRef(null);
  const colId    = useRef(null);
  const thRef    = useRef(null);

  const onMouseDown = (e, id, th) => {
    e.preventDefault();
    e.stopPropagation();
    startX.current  = e.clientX;
    colId.current   = id;
    thRef.current   = th;
    startW.current  = widths[id] || th.offsetWidth;

    const onMove = (ev) => {
      const diff = ev.clientX - startX.current;
      setWidths(prev => ({ ...prev, [colId.current]: Math.max(60, startW.current + diff) }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const getStyle = (id) => widths[id] ? { width: widths[id], minWidth: widths[id] } : {};
  return { getStyle, onMouseDown };
}

function STh({col,sortCol,sortDir,onSort,children,style,noSort,onResize}) {
  const thRef = useRef(null);
  const handle = onResize ? (
    <span className="col-resize" onMouseDown={e=>onResize(e,col,thRef.current)} onClick={e=>e.stopPropagation()} />
  ) : null;
  if (noSort) return <th ref={thRef} className="no-sort" style={style}>{children}{handle}</th>;
  const active = sortCol===col;
  return (
    <th ref={thRef} onClick={()=>onSort(col)} style={style}>
      {children}
      <span style={{marginLeft:4,fontSize:9,opacity:active?1:0.25}}>
        {active?(sortDir==="asc"?"▲":"▼"):"↕"}
      </span>
      {handle}
    </th>
  );
}

/* ═══════════════════════════════════════════════════════════════
   NAV CONFIG
═══════════════════════════════════════════════════════════════ */
const NAV = [
  {id:"dashboard",   label:"Dashboard",      icon:"⊞", group:"Overview" },
  {id:"stock",       label:"Stock",          icon:"◫", group:"Overview" },
  {id:"listings",    label:"Listings",       icon:"☰", group:"Overview" },
  {id:"movement",    label:"Movement",       icon:"⚡",group:"Insights" },
  {id:"listingdata", label:"Listing Data",   icon:"📋",group:"Insights" },
  {id:"marklisted",  label:"Mark as Listed", icon:"📌",group:"Tools"    },
  {id:"drafter",     label:"Listing Drafter",icon:"✍️",group:"Tools"    },
  {id:"marksold",    label:"Mark as Sold",   icon:"✓", group:"Tools"    },
  {id:"shipping",    label:"Shipping",       icon:"📦",group:"Tools"    },
  {id:"livedata",    label:"Live Data",      icon:"💰",group:"Tools"    },
  {id:"calculator",  label:"Price Calc",     icon:"🧮",group:"Tools"    },
  {id:"analytics",   label:"Analytics",      icon:"↗", group:"Reports"  },
  {id:"growth",      label:"Growth",         icon:"📈",group:"Reports"  },
  {id:"history",     label:"History",        icon:"🗂", group:"Reports"  },
  {id:"versions",    label:"Version History", icon:"🔄", group:"Reports"  },
];
const TITLES = {
  dashboard:"Dashboard",stock:"Stock Inventory",listings:"Listings",
  movement:"Movement Tracker",listingdata:"Listing Data",marklisted:"Mark as Listed",drafter:"Listing Drafter",
  marksold:"Mark as Sold",shipping:"Shipping",livedata:"Live Data",
  calculator:"Price Calculator",analytics:"Analytics",growth:"Growth",history:"History",
};

/* ═══════════════════════════════════════════════════════════════
   GLOBAL CSS
═══════════════════════════════════════════════════════════════ */
const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#f4f3f0;--sf:#ffffff;--sf2:#eeede9;--sf3:#e5e3dc;
  --bd:#dedad2;--bdd:#cbc7bd;
  --tx:#0f0f0e;--txm:#5c584f;--txd:#a8a49b;
  --ac:#c0273a;--acl:#faebec;--ach:#a31f30;--ac2:#e8c4c8;
  --gn:#1f5c35;--gnl:#e4f0e9;
  --am:#a06518;--aml:#fdf2e0;
  --nv:#1a2840;--nvl:#e4e9f2;
  --bl:#1a52a0;--bll:#e4ecf8;
  --sh:0 1px 3px rgba(0,0,0,.06),0 1px 2px rgba(0,0,0,.04);
  --shm:0 4px 24px rgba(0,0,0,.10),0 2px 8px rgba(0,0,0,.06);
  --shl:0 8px 40px rgba(0,0,0,.14);
  --sb-w:212px;--tb-h:50px;--r:6px;--r2:8px;
}
body{font-family:Arial,Helvetica,sans-serif;background:var(--bg);color:var(--tx);font-size:13px;line-height:1.5;-webkit-font-smoothing:antialiased}input,select,textarea{font-size:16px !important;}input[type=checkbox],input[type=radio]{font-size:inherit !important;}

/* Layout */
.app{display:flex;height:100vh;overflow:hidden}

/* Sidebar */
.sidebar{background:var(--sf);border-right:1px solid var(--bd);display:flex;flex-direction:column;flex-shrink:0;overflow:hidden}
.logo-area{padding:15px 13px 13px;border-bottom:1px solid rgba(255,255,255,.12);display:flex;align-items:center;gap:10px;overflow:hidden;background:var(--nv);flex-shrink:0}
.logo-badge{flex-shrink:0;background:#f0ebdb;border-radius:5px;padding:5px 7px 4px;display:flex;flex-direction:column;line-height:1.15}
.logo-badge span{font-size:6.5px;font-weight:900;color:var(--nv);letter-spacing:.4px;display:block;white-space:nowrap;text-transform:uppercase}
.logo-badge .since{font-size:5px;color:var(--ac);letter-spacing:1px;margin-top:2px}
.logo-text{overflow:hidden;white-space:nowrap}
.logo-main{font-size:13px;font-weight:900;color:#fff;text-transform:uppercase;letter-spacing:.5px;line-height:1.2}
.logo-sub{font-size:9px;font-weight:700;color:rgba(255,255,255,.38);letter-spacing:1.2px;text-transform:uppercase;margin-top:2px}
nav{padding:8px 0;flex:1;overflow-y:auto;overflow-x:hidden}
nav::-webkit-scrollbar{width:3px}
nav::-webkit-scrollbar-thumb{background:var(--bd);border-radius:2px}
.nav-group-label{font-size:8.5px;letter-spacing:2px;text-transform:uppercase;color:var(--txd);padding:10px 13px 3px;font-weight:700;white-space:nowrap}
.nav-item{display:flex;align-items:center;gap:9px;padding:8.5px 13px;cursor:pointer;font-size:11px;font-weight:700;color:var(--txm);border-left:3px solid transparent;transition:background .1s,color .1s,border-color .1s;white-space:nowrap;text-transform:uppercase;letter-spacing:.4px;user-select:none;position:relative}
.nav-item:hover{color:var(--tx);background:var(--sf2)}
.nav-item.active{color:var(--ac);border-left-color:var(--ac);background:var(--acl)}
.nav-icon{font-size:13px;width:18px;min-width:18px;text-align:center;flex-shrink:0}
.nav-dot{width:7px;height:7px;border-radius:50%;background:var(--ac);position:absolute;right:12px;top:50%;transform:translateY(-50%);box-shadow:0 0 0 2px var(--sf)}
.sb-foot{padding:11px 13px;border-top:1px solid var(--bd);font-size:10px;color:var(--txd);display:flex;align-items:center;gap:6px;overflow:hidden;white-space:nowrap;flex-shrink:0}
.live-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}

/* Main */
.main{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0}
.sunday-banner{background:var(--nv);color:#fff;padding:9px 18px;display:flex;align-items:center;justify-content:space-between;font-size:12px;font-weight:700;flex-shrink:0;gap:10px;flex-wrap:wrap}
.sunday-btn{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.25);color:#fff;padding:4px 12px;border-radius:var(--r);cursor:pointer;font-family:Arial,sans-serif;font-size:11px;font-weight:700;transition:background .12s}
.sunday-btn:hover{background:rgba(255,255,255,.22)}
.topbar{height:var(--tb-h);background:var(--sf);border-bottom:1px solid var(--bd);display:flex;align-items:center;padding:0 10px;gap:6px;flex-shrink:0;overflow-x:auto;-webkit-overflow-scrolling:touch}
.topbar::-webkit-scrollbar{display:none}
@media(max-width:640px){.tb-date{display:none!important}.topbar{gap:4px;padding:0 8px}}
.menu-tog{background:none;border:1px solid var(--bdd);border-radius:var(--r);cursor:pointer;padding:5px 9px;font-size:15px;color:var(--txm);transition:all .12s;flex-shrink:0;line-height:1}
.menu-tog:hover{background:var(--acl);border-color:var(--ac2);color:var(--ac)}
.page-title{font-size:13.5px;font-weight:900;color:var(--tx);text-transform:uppercase;letter-spacing:.5px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tb-right{display:flex;align-items:center;gap:7px;flex-shrink:0}
.tb-date{font-size:11px;color:var(--txd);white-space:nowrap}
@media(max-width:560px){.tb-date{display:none}}
@media(max-width:480px){.tb-import{display:none}}
.content{flex:1;overflow-y:auto;padding:18px 22px}
@media(max-width:600px){.content{padding:13px 13px}}

/* Buttons */
.btn{display:inline-flex;align-items:center;gap:5px;padding:6px 13px;font-family:Arial,sans-serif;font-size:11px;font-weight:700;cursor:pointer;border-radius:var(--r);border:1px solid transparent;transition:background .12s,border-color .12s,color .12s,opacity .12s;white-space:nowrap;text-transform:uppercase;letter-spacing:.4px;line-height:1}
.btn:disabled{opacity:.45;cursor:not-allowed}
.btn-sm{padding:5px 10px;font-size:10.5px}
.btn-xs{padding:3px 8px;font-size:10px}
.btn-p{background:var(--ac);color:#fff;border-color:var(--ac)}.btn-p:hover:not(:disabled){background:var(--ach)}
.btn-o{background:transparent;color:var(--txm);border-color:var(--bdd)}.btn-o:hover:not(:disabled){border-color:var(--tx);color:var(--tx);background:var(--sf2)}
.btn-g{background:var(--gn);color:#fff;border-color:var(--gn)}.btn-g:hover:not(:disabled){background:#174530}
.btn-del{background:transparent;color:var(--ac);border-color:var(--ac)}.btn-del:hover:not(:disabled){background:var(--acl)}
.btn-nv{background:var(--nv);color:#fff;border-color:var(--nv)}.btn-nv:hover:not(:disabled){background:#111e30}

/* Badges */
.badge{display:inline-block;padding:2px 7px;font-size:9.5px;font-weight:700;border-radius:3px;text-transform:uppercase;letter-spacing:.4px;white-space:nowrap}
.b-r{background:var(--acl);color:var(--ac)}.b-g{background:var(--gnl);color:var(--gn)}
.b-a{background:var(--aml);color:var(--am)}.b-n{background:var(--nvl);color:var(--nv)}
.b-b{background:var(--bll);color:var(--bl)}.b-0{background:var(--sf2);color:var(--txm);border:1px solid var(--bd)}

/* Movement tags */
.mt{display:inline-block;padding:2px 8px;font-size:9.5px;font-weight:900;border-radius:3px;text-transform:uppercase;letter-spacing:.5px;white-space:nowrap}
.mt-f{background:#daeee2;color:#155c2a}.mt-m{background:var(--aml);color:#7a4e0e}
.mt-s{background:var(--acl);color:var(--ac)}.mt-u{background:var(--sf2);color:var(--txd)}.mt-d{background:#f0e4e6;color:#7a1020}.mt-n{background:#e8eeff;color:#2a4a9a}

/* KPI cards */
.kg{display:grid;gap:10px;margin-bottom:16px}
.kg4{grid-template-columns:repeat(4,1fr)}.kg3{grid-template-columns:repeat(3,1fr)}.kg2{grid-template-columns:repeat(2,1fr)}
@media(max-width:700px){.kg4{grid-template-columns:repeat(2,1fr)}.kg3{grid-template-columns:repeat(2,1fr)}}
@media(max-width:380px){.kg4,.kg3,.kg2{grid-template-columns:1fr}}
.kc{background:var(--sf);border:1px solid var(--bd);border-radius:var(--r2);padding:14px 14px 11px;box-shadow:var(--sh);position:relative;overflow:hidden}
.kb{position:absolute;top:0;left:0;width:100%;height:3px;background:var(--ac);border-radius:var(--r2) var(--r2) 0 0}
.kb.gn{background:var(--gn)}.kb.am{background:var(--am)}.kb.nv{background:var(--nv)}.kb.bl{background:var(--bl)}
.kl{font-size:9.5px;font-weight:700;color:var(--txm);text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px}
.kv{font-size:24px;font-weight:900;color:var(--tx);line-height:1;margin-bottom:3px}
.ks{font-size:11px;color:var(--txd)}.kc.empty .kv{color:var(--txd);font-size:20px}

/* Tables */
.tw{background:var(--sf);border:1px solid var(--bd);border-radius:var(--r2);box-shadow:var(--sh)}
.ts{overflow-x:auto;overflow-y:auto;max-height:72vh;overscroll-behavior:contain;border-radius:var(--r2);-webkit-overflow-scrolling:touch}.ts::-webkit-scrollbar{height:4px;width:4px}.ts::-webkit-scrollbar-thumb{background:var(--bd);border-radius:2px}
.tbl{border-collapse:collapse;font-size:12px;table-layout:auto;min-width:100%}
@media(max-width:768px){.ts{overflow-x:auto;-webkit-overflow-scrolling:touch}.tbl{table-layout:auto}}
@media(max-width:640px){.ld-grid{grid-template-columns:1fr !important}}
.tbl thead th{position:sticky;top:0;z-index:5;background:var(--sf2);box-shadow:0 1px 0 var(--bd),0 2px 0 var(--bd)}
.tbl th{padding:8px 11px;font-size:9px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--txm);border-bottom:1px solid var(--bd);text-align:left;background:var(--sf2);white-space:nowrap;cursor:pointer;user-select:none;transition:color .1s;position:relative;overflow:visible}
.col-resize{position:absolute;right:-2px;top:0;bottom:0;width:6px;cursor:col-resize;z-index:10;background:transparent}
.col-resize:hover{background:var(--ac);opacity:.4}
.zoom-bar-placeholder{display:none}
.tbl th:hover{color:var(--tx)}.tbl th.no-sort{cursor:default}.tbl th.no-sort:hover{color:var(--txm)}
.tbl{table-layout:auto}.tbl td{padding:9px 11px;border-bottom:1px solid var(--bd);color:var(--tx);vertical-align:middle;white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis}
.tbl td.full{max-width:none;overflow:visible}
.tbl td.name-cell{min-width:180px;max-width:260px}
.zoom-bar{display:flex;align-items:center;gap:5px;padding:6px 12px;background:var(--sf2);border-bottom:1px solid var(--bd);flex-wrap:wrap}
.zoom-bar .zb{width:26px;height:26px;border:1px solid var(--bdd);border-radius:var(--r);background:var(--sf);cursor:pointer;font-size:15px;font-weight:700;color:var(--txm);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.zoom-bar .zb:hover{background:var(--sf2);color:var(--tx)}
.zoom-bar .zv{font-size:12px;font-weight:700;color:var(--tx);min-width:42px;text-align:center;flex-shrink:0}
.zp{font-size:11px;padding:3px 8px;border:1px solid var(--bdd);border-radius:20px;background:transparent;cursor:pointer;color:var(--txm);white-space:nowrap;flex-shrink:0}
.zp:hover{background:var(--sf);color:var(--tx)}
.zp.active{background:var(--acl);color:var(--ac);border-color:var(--ac)}
.zoom-preset.active{background:var(--acl);color:var(--ac);border-color:var(--ac)}
.tbl-zoom-wrap{transform-origin:top left;will-change:transform}
.tbl tr:last-child td{border-bottom:none}
.tbl tr.clickable:hover td{background:#faf9f6;cursor:pointer}
.tbl tr.sold-r td{background:#f0faf4;color:var(--txm)}.tbl tr.listed-r td{background:#fff8f0}.tbl tr.dim td{opacity:.55}.tbl tr.sel td{background:#fdf4f5}

/* Forms */
.fr{margin-bottom:11px}.fr2{display:grid;grid-template-columns:1fr 1fr;gap:10px}.fr3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
.fl{display:block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--txm);margin-bottom:4px}
.finp,.fsel,.fta{width:100%;background:var(--sf2);border:1px solid var(--bdd);color:var(--tx);font-family:Arial,sans-serif;font-size:12.5px;padding:7px 10px;border-radius:var(--r);outline:none;transition:border-color .12s,background .12s}
.finp:focus,.fsel:focus,.fta:focus{border-color:var(--ac);background:var(--sf)}
.fta{resize:vertical;min-height:66px;line-height:1.5}
.fchk{display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;user-select:none}
.fchk input{cursor:pointer;width:14px;height:14px;accent-color:var(--ac)}
.frow-chk{display:flex;gap:18px;flex-wrap:wrap}
.ei{background:var(--sf2);border:1px solid var(--bd);color:var(--tx);font-family:Arial,sans-serif;font-size:13px;font-weight:700;padding:5px 8px;border-radius:var(--r);outline:none;width:115px;text-align:right}
.ei:focus{border-color:var(--ac);background:var(--sf)}

/* Filter bar */
.filter-bar{display:flex;align-items:center;gap:8px;padding-bottom:12px;flex-wrap:wrap}
.action-bar{display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding-bottom:10px}
.action-bar .btn{flex-shrink:0}
.sw{position:relative}.si{position:absolute;left:9px;top:50%;transform:translateY(-50%);font-size:13px;color:var(--txd);pointer-events:none}
.fi{background:var(--sf);border:1px solid var(--bdd);color:var(--tx);font-family:Arial,sans-serif;font-size:12px;padding:7px 10px 7px 28px;border-radius:var(--r);outline:none;width:185px;transition:border-color .12s}
.fi:focus{border-color:var(--ac);box-shadow:0 0 0 3px var(--acl)}
.fs{background:var(--sf);border:1px solid var(--bdd);color:var(--txm);font-family:Arial,sans-serif;font-size:12px;padding:7px 10px;border-radius:var(--r);outline:none;cursor:pointer}
.tog-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 11px;font-family:Arial,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;cursor:pointer;border-radius:var(--r);border:1px solid var(--bdd);background:var(--sf);color:var(--txm);transition:all .12s;user-select:none}
.tog-btn.on{background:var(--acl);border-color:var(--ac2);color:var(--ac)}
.tog-dot{width:7px;height:7px;border-radius:50%;background:currentColor;opacity:.8}

/* Tab bar */
.tab-bar{display:flex;align-items:flex-end;border-bottom:2px solid var(--bd);margin-bottom:14px;flex-wrap:wrap}
.tab{padding:8px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--txm);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;transition:color .12s,border-color .12s;display:flex;align-items:center;gap:5px;user-select:none;white-space:nowrap}
.tab:hover{color:var(--tx)}.tab.active{color:var(--ac);border-bottom-color:var(--ac)}
.tc{background:var(--sf2);color:var(--txm);font-size:9.5px;font-weight:700;padding:1px 6px;border-radius:10px;min-width:18px;text-align:center}
.tab.active .tc{background:var(--acl);color:var(--ac)}

/* Modal */
.overlay{position:fixed;inset:0;background:rgba(15,15,14,.45);display:flex;align-items:center;justify-content:center;z-index:300;backdrop-filter:blur(2px);padding:16px}
.modal{background:var(--sf);border:1px solid var(--bd);border-radius:var(--r2);box-shadow:var(--shl);width:520px;max-width:100%;max-height:90vh;display:flex;flex-direction:column;overflow:hidden}
.mh{padding:15px 20px 12px;border-bottom:1px solid var(--bd);display:flex;justify-content:space-between;align-items:flex-start;background:var(--nv);flex-shrink:0}
.mh-title{font-size:13px;font-weight:900;color:#fff;text-transform:uppercase;letter-spacing:.4px}
.mh-sub{font-size:11px;color:rgba(255,255,255,.45);margin-top:2px}
.mh-close{background:rgba(255,255,255,.1);border:none;cursor:pointer;font-size:16px;color:rgba(255,255,255,.65);padding:2px 8px;border-radius:var(--r);transition:background .12s;line-height:1}
.mh-close:hover{background:rgba(255,255,255,.22);color:#fff}
.mb{padding:16px 20px;overflow-y:auto;flex:1}
.mf{padding:12px 20px;border-top:1px solid var(--bd);background:var(--sf2);display:flex;justify-content:flex-end;gap:8px;flex-shrink:0}

/* Drawer */
.drawer-overlay{position:fixed;inset:0;background:rgba(15,15,14,.3);z-index:400;backdrop-filter:blur(1px)}
.drawer{position:absolute;top:0;right:0;width:400px;max-width:100vw;height:100%;background:var(--sf);border-left:1px solid var(--bd);box-shadow:var(--shl);display:flex;flex-direction:column;overflow:hidden}
.drw-h{padding:15px 18px;border-bottom:1px solid var(--bd);background:var(--nv);display:flex;justify-content:space-between;align-items:center;flex-shrink:0}
.drw-title{font-size:13px;font-weight:900;color:#fff;text-transform:uppercase;letter-spacing:.4px}
.drw-b{flex:1;overflow-y:auto;padding:16px 18px}
.drw-f{padding:12px 18px;border-top:1px solid var(--bd);background:var(--sf2);display:flex;justify-content:flex-end;gap:8px;flex-shrink:0}

/* Float bar */
.float-bar{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:var(--nv);color:#fff;border-radius:var(--r2);padding:10px 18px;display:flex;align-items:center;gap:12px;box-shadow:var(--shl);z-index:100;font-size:12px;white-space:nowrap}
.fb-count{font-weight:900;background:rgba(255,255,255,.15);border-radius:4px;padding:2px 9px}
.fb-btn{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);color:#fff;padding:5px 13px;border-radius:var(--r);cursor:pointer;font-family:Arial,sans-serif;font-size:11px;font-weight:700;transition:background .12s}
.fb-btn:hover{background:rgba(255,255,255,.24)}.fb-clear{background:transparent;border-color:transparent;opacity:.55}

/* Progress */
.pw{display:flex;align-items:center;gap:7px}
.pt{height:5px;background:var(--sf2);border-radius:3px;overflow:hidden;flex:1}
.pf{height:100%;border-radius:3px;transition:width .4s ease}
.pl{font-size:11px;font-weight:700;color:var(--txm);white-space:nowrap;min-width:32px}

/* Info sections */
.ls{background:var(--sf);border:1px solid var(--bd);border-radius:var(--r2);padding:14px 16px;margin-bottom:12px;box-shadow:var(--sh)}
.lst{font-size:10.5px;font-weight:900;text-transform:uppercase;letter-spacing:.5px;color:var(--tx);border-bottom:1px solid var(--bd);padding-bottom:8px;margin-bottom:10px}
.lr{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--bd)}
.lr:last-child{border-bottom:none}.lr.tot{background:var(--sf2);margin:0 -16px;padding:7px 16px;font-weight:700}
.ll{font-size:12px;color:var(--txm)}.ll.b{font-weight:700;color:var(--tx)}
.lv{font-size:13px;font-weight:900;color:var(--tx)}.lv.gn{color:var(--gn)}.lv.rd{color:var(--ac)}

/* Column config panel */
.col-panel{position:fixed;right:8px;top:120px;background:var(--sf);border:1px solid var(--bd);border-radius:var(--r2);padding:12px;box-shadow:var(--shm);z-index:200;min-width:190px;max-width:calc(100vw - 16px);max-height:60vh;overflow-y:auto}
.col-panel-title{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--txm);margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--bd)}
.col-row{display:flex;align-items:center;justify-content:space-between;padding:3px 0;gap:8px}
.col-row label{display:flex;align-items:center;gap:7px;font-size:12px;cursor:pointer;flex:1}
.col-arrows{display:flex;flex-direction:column;gap:2px}
.col-arr{background:none;border:1px solid var(--bd);border-radius:3px;cursor:pointer;width:18px;height:15px;display:flex;align-items:center;justify-content:center;font-size:8px;color:var(--txm);transition:background .1s}
.col-arr:hover{background:var(--sf2)}

/* Shipping */
.ship-recap{background:var(--nvl);border:1px solid rgba(26,40,64,.2);border-radius:var(--r2);padding:13px 16px;margin-bottom:13px}
.ship-plat{background:var(--sf);border:1px solid var(--bd);border-radius:var(--r2);margin-bottom:11px;overflow:hidden;box-shadow:var(--sh)}
.ship-plat-h{padding:8px 13px;background:var(--sf2);border-bottom:1px solid var(--bd);font-size:10.5px;font-weight:900;text-transform:uppercase;letter-spacing:.4px;display:flex;align-items:center;justify-content:space-between}
.ship-row{display:flex;align-items:center;gap:10px;padding:9px 13px;border-bottom:1px solid var(--bd)}
.ship-row:last-child{border-bottom:none}.ship-row:hover{background:var(--sf2)}

/* Misc utilities */
.sku{font-size:11.5px;font-weight:900;color:var(--nv);letter-spacing:1.5px}
.bsku{font-size:11px;font-weight:700;color:var(--ac);letter-spacing:.5px}
.cy{color:var(--gn);font-size:14px;font-weight:700}.cn{color:var(--bdd);font-size:14px}
.divider{border:none;border-top:1px solid var(--bd);margin:14px 0}
.sh{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.st{font-size:12px;font-weight:900;color:var(--tx);text-transform:uppercase;letter-spacing:.4px}
.ss{font-size:11px;color:var(--txm);font-weight:400;margin-left:7px;text-transform:none;letter-spacing:0}
.sc{background:var(--sf);border:1px solid var(--bd);border-radius:var(--r2);padding:12px 14px;box-shadow:var(--sh);margin-bottom:10px}
.sr{display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--bd);font-size:12px}
.sr:last-child{border-bottom:none}.srl{color:var(--txm)}.srv{font-weight:700;color:var(--tx)}
.thumb{width:32px;height:32px;border-radius:4px;object-fit:cover;border:1px solid var(--bd)}
.thumb-ph{width:32px;height:32px;border-radius:4px;background:var(--sf2);border:1px solid var(--bd);display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--txd)}
.spin{display:inline-block;width:13px;height:13px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .65s linear infinite;flex-shrink:0}
@keyframes spin{to{transform:rotate(360deg)}}
.info-banner{background:var(--nvl);border:1px solid rgba(26,40,64,.18);border-radius:var(--r);padding:10px 14px;font-size:12px;color:var(--nv);margin-bottom:14px;line-height:1.6}
.pct-g{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}
.pct-c{background:var(--sf2);border:1px solid var(--bd);border-radius:var(--r);padding:9px 11px;text-align:center}
.pct-l{font-size:9.5px;font-weight:700;color:var(--txm);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}
.pct-v{font-size:16px;font-weight:900;color:var(--gn)}
.livedata-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:700px){.livedata-grid{grid-template-columns:1fr}}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:11px}
@media(max-width:640px){.two-col{grid-template-columns:1fr}}
.ana-cols{display:grid;grid-template-columns:3fr 2fr;gap:11px}
@media(max-width:700px){.ana-cols{grid-template-columns:1fr}}
.plat-grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
@media(max-width:500px){.plat-grid-4{grid-template-columns:repeat(2,1fr)}}
.hist-g{display:grid;grid-template-columns:1fr 1fr;gap:13px}
@media(max-width:640px){.hist-g{grid-template-columns:1fr}}
.calc-box{background:var(--sf);border:1px solid var(--bd);border-radius:var(--r2);padding:18px;box-shadow:var(--sh);margin-bottom:13px}
.calc-title{font-size:11.5px;font-weight:900;text-transform:uppercase;letter-spacing:.4px;margin-bottom:13px}
.calc-row{display:flex;align-items:center;gap:10px;margin-bottom:9px}
.calc-lbl{width:165px;color:var(--txm);flex-shrink:0;font-size:12px}
.calc-in{background:var(--sf2);border:1px solid var(--bdd);color:var(--tx);font-family:Arial,sans-serif;font-size:13px;font-weight:700;padding:6px 10px;border-radius:var(--r);outline:none;width:120px}
.calc-in:focus{border-color:var(--ac);background:var(--sf)}
.plat-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-top:13px}
@media(max-width:560px){.plat-cards{grid-template-columns:repeat(2,1fr)}}
.plat-card{background:var(--sf2);border:1px solid var(--bd);border-radius:var(--r2);padding:12px 13px;text-align:center}
.plat-card.best{background:var(--gnl);border-color:rgba(31,92,53,.25)}
.plat-name{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--txm);margin-bottom:7px}
.plat-price{font-size:20px;font-weight:900;color:var(--tx);margin-bottom:3px}
.plat-fee{font-size:10px;color:var(--txd);margin-top:3px}
.goal-card{background:var(--sf);border:1px solid var(--bd);border-radius:var(--r2);padding:14px 15px;box-shadow:var(--sh)}
.goal-title{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--txm);margin-bottom:4px}
.goal-track{height:7px;background:var(--sf2);border-radius:4px;overflow:hidden;margin:8px 0 5px}
.goal-fill{height:100%;border-radius:4px;transition:width .5s cubic-bezier(.4,0,.2,1)}
.goal-nums{display:flex;justify-content:space-between;font-size:11px;color:var(--txm)}
.draft-grid{display:grid;grid-template-columns:295px 1fr;gap:14px}
@media(max-width:680px){.draft-grid{grid-template-columns:1fr}}
.draft-box{background:var(--sf);border:1px solid var(--bd);border-radius:var(--r2);padding:17px;box-shadow:var(--sh)}
.dlabel{display:block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--txm);margin-bottom:4px;margin-top:12px}
.dlabel:first-child{margin-top:0}
.dsel,.dta,.din{width:100%;background:var(--sf2);border:1px solid var(--bdd);color:var(--tx);font-family:Arial,sans-serif;font-size:12.5px;padding:7px 10px;border-radius:var(--r);outline:none;transition:border .12s}
.dsel:focus,.dta:focus,.din:focus{border-color:var(--ac);background:var(--sf)}
.dta{resize:vertical;min-height:66px;line-height:1.55}
.dout{background:var(--sf2);border:1px solid var(--bd);border-radius:var(--r);padding:11px 13px;font-size:12.5px;line-height:1.75;color:var(--tx);white-space:pre-wrap;min-height:52px;position:relative;font-family:Arial,sans-serif}
.copy-btn{background:var(--sf);border:1px solid var(--bdd);border-radius:4px;cursor:pointer;padding:2px 8px;font-size:10px;font-weight:700;color:var(--txm);font-family:Arial,sans-serif;transition:border-color .12s,color .12s}
.copy-btn:hover{border-color:var(--ac);color:var(--ac)}
.icloud-tip{background:var(--nvl);border:1px solid rgba(26,40,64,.18);border-radius:var(--r);padding:8px 11px;font-size:11px;color:var(--nv);line-height:1.6;margin-bottom:9px}
.qu-wrap{display:grid;grid-template-columns:1fr 1fr;gap:13px}
@media(max-width:560px){.qu-wrap{grid-template-columns:1fr}}
.qu-box{background:var(--sf);border:1px solid var(--bd);border-radius:var(--r2);padding:15px 16px;box-shadow:var(--sh)}
.qu-title{font-size:11.5px;font-weight:900;text-transform:uppercase;letter-spacing:.4px;margin-bottom:10px}
.qu-ta{width:100%;background:var(--sf2);border:1px solid var(--bdd);color:var(--tx);font-family:Arial,sans-serif;font-size:12.5px;padding:9px 11px;border-radius:var(--r);outline:none;resize:vertical;min-height:155px;line-height:1.65}
.qu-ta:focus{border-color:var(--ac);background:var(--sf)}
.qu-row{display:flex;justify-content:space-between;align-items:center;padding:6px 9px;border-bottom:1px solid var(--bd);font-size:12px}
.qu-row:last-child{border-bottom:none}
.ana-bar-row{display:flex;align-items:center;gap:9px;margin-bottom:8px}
.ana-bar-label{font-size:11px;color:var(--txm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ana-bar-track{flex:1;height:6px;background:var(--sf2);border-radius:3px;overflow:hidden}
.ana-bar-fill{height:100%;border-radius:3px;transition:width .5s ease}
.ana-bar-val{font-size:11px;font-weight:700;white-space:nowrap;text-align:right;min-width:48px}
`;


/* ═══════════════════════════════════════════════════════════════
   SHARED — CSV export
   Exports filtered rows + visible columns as a .csv file.
   Used by every table in the app.
═══════════════════════════════════════════════════════════════ */
function exportToCSV(rows, colDefs, filename) {
  if (!rows.length) { alert("Nothing to export — check your filters."); return; }
  const visCols = colDefs.filter(c => c.visible !== false && c.id !== "sel" && c.id !== "photo");
  const header  = visCols.map(c => c.label || c.id);
  const body    = rows.map(row =>
    visCols.map(c => {
      const v = row[c.id];
      if (v == null)              return "";
      if (typeof v === "boolean") return v ? "Yes" : "No";
      if (c.id === "sellThru")    return `${v}%`;
      if (["costPer","totalCost","totalProfit","netProceeds","stockValLeft",
           "avgSoldPrice","avgProfit","price","soldPrice","profit"].includes(c.id))
        return (+(v)||0).toFixed(2);
      return String(v);
    })
  );
  const csv = [header, ...body]
    .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const a = document.createElement("a");
  a.href     = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
  a.download = filename + ".csv";
  a.click();
}

/* ═══════════════════════════════════════════════════════════════
   SHARED — Column filter hook
   Returns applyFilters (fn) and the management functions.
   Pass activeFilters + toggle + clearCol to each FilterBtn.
═══════════════════════════════════════════════════════════════ */
function useColFilters() {
  const [activeFilters, setActiveFilters] = useState({}); // { colId: string[] }

  const applyFilters = useCallback((data) =>
    data.filter(row =>
      Object.entries(activeFilters).every(([col, vals]) => {
        if (!vals || !vals.length) return true;
        const v = row[col];
        const str = typeof v === "boolean" ? (v ? "Yes" : "No") : String(v ?? "");
        return vals.includes(str);
      })
    ), [activeFilters]);

  const toggle = useCallback((col, val) => {
    setActiveFilters(prev => {
      const cur  = prev[col] || [];
      const next = cur.includes(val) ? cur.filter(v => v !== val) : [...cur, val];
      if (!next.length) { const { [col]: _, ...rest } = prev; return rest; }
      return { ...prev, [col]: next };
    });
  }, []);

  const clearCol  = useCallback((col) =>
    setActiveFilters(prev => { const { [col]: _, ...r } = prev; return r; }), []);
  const clearAll  = useCallback(() => setActiveFilters({}), []);
  const isActive  = useCallback((col) => !!(activeFilters[col]?.length), [activeFilters]);
  const activeCount = Object.values(activeFilters).filter(v => v?.length).length;

  return { activeFilters, applyFilters, toggle, clearCol, clearAll, isActive, activeCount };
}

/* ═══════════════════════════════════════════════════════════════
   SHARED — Column filter button (placed inside <th>)
   • Renders a ▽ / ▼ icon that opens a fixed-position popover
   • Popover lists all unique values for that column as checkboxes
   • If > 20 unique values, adds a search box at the top
   • Boolean values shown as Yes / No
═══════════════════════════════════════════════════════════════ */
function FilterBtn({ col, allData, activeFilters, onToggle, onClear }) {
  const [open,    setOpen]  = useState(false);
  const [pos,     setPos]   = useState({ top: 0, left: 0 });
  const [search,  setSearch]= useState("");
  const btnRef              = useRef();
  const selected            = activeFilters[col] || [];
  const active              = selected.length > 0;

  /* Compute unique display-values for this column from the FULL dataset */
  const unique = useMemo(() => {
    const set = new Set(
      allData.map(r => {
        const v = r[col];
        if (typeof v === "boolean") return v ? "Yes" : "No";
        const s = String(v ?? "");
        return s === "null" || s === "undefined" ? "" : s;
      })
    );
    return [...set].filter(v => v !== "").sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [allData, col]);

  const displayList = search.trim()
    ? unique.filter(v => v.toLowerCase().includes(search.toLowerCase()))
    : unique;

  const handleOpen = (e) => {
    e.stopPropagation();
    if (!open) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({
        top:  rect.bottom + 4,
        left: Math.min(rect.left, window.innerWidth - 200),
      });
    }
    setOpen(v => !v);
  };

  /* Close on outside click */
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const t = setTimeout(() => window.addEventListener("click", close), 60);
    return () => { clearTimeout(t); window.removeEventListener("click", close); };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleOpen}
        title={active ? `${selected.length} filter(s) active` : "Filter column"}
        style={{
          background: "none", border: "none", cursor: "pointer",
          padding: "0 3px", fontSize: 10, verticalAlign: "middle", lineHeight: 1,
          color:      active ? "var(--ac)" : "var(--txd)",
          fontWeight: active ? 900 : 400,
          flexShrink: 0,
        }}
      >
        {active ? "▼" : "▽"}
      </button>

      {open && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: "fixed", top: pos.top, left: pos.left,
            background: "#fff", border: "1px solid var(--bd)",
            borderRadius: "var(--r2)", boxShadow: "var(--shm)",
            zIndex: 600, padding: 10, minWidth: 185, maxHeight: 300, overflowY: "auto",
          }}
        >
          {/* Header */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8, paddingBottom:6, borderBottom:"1px solid var(--bd)" }}>
            <span style={{ fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:".6px", color:"var(--txm)" }}>Filter</span>
            {active && (
              <button onClick={() => { onClear(col); setOpen(false); }}
                style={{ background:"none", border:"none", cursor:"pointer", fontSize:10, color:"var(--ac)", fontWeight:700, padding:0 }}>
                Clear ✕
              </button>
            )}
          </div>

          {/* Search within popover if many values */}
          {unique.length > 20 && (
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              onClick={e => e.stopPropagation()}
              placeholder="Search values…"
              style={{
                width:"100%", marginBottom:7, padding:"5px 8px", fontSize:11,
                background:"var(--sf2)", border:"1px solid var(--bdd)",
                borderRadius:"var(--r)", outline:"none",
              }}
            />
          )}

          {/* Value list */}
          {displayList.length === 0
            ? <div style={{ fontSize:11, color:"var(--txd)" }}>No matching values</div>
            : displayList.map(val => (
              <label key={val} style={{ display:"flex", alignItems:"center", gap:8, padding:"4px 0", fontSize:12, cursor:"pointer", userSelect:"none" }}>
                <input
                  type="checkbox"
                  checked={selected.includes(val)}
                  onChange={() => onToggle(col, val)}
                  style={{ accentColor:"var(--ac)", cursor:"pointer", width:13, height:13, flexShrink:0 }}
                />
                <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{val}</span>
              </label>
            ))
          }
        </div>
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════
/* ═══════════════════════════════════════════════════════════════
   REUSABLE — Column config panel (used by every table tab)
═══════════════════════════════════════════════════════════════ */
function ColPanel({ cols, setCols, onClose }) {
  const movable = cols.filter(c => !c.locked);
  const move = (id, dir) => setCols(prev => {
    const arr = [...prev];
    const i   = arr.findIndex(c => c.id === id);
    const ti  = i + dir;
    if (ti < 0 || ti >= arr.length) return arr;
    [arr[i], arr[ti]] = [arr[ti], arr[i]];
    return arr;
  });
  const tog = (id) => setCols(prev => prev.map(c => c.id === id ? {...c, visible:!c.visible} : c));
  return (
    <>
      <div style={{position:"fixed",inset:0,zIndex:199}} onClick={onClose} />
      <div className="col-panel">
      <div className="col-panel-title">Show / Hide · Reorder</div>
      {movable.map(c => {
        const idx = cols.findIndex(x => x.id === c.id);
        return (
          <div key={c.id} className="col-row">
            <label>
              <input type="checkbox" checked={c.visible} onChange={() => tog(c.id)}
                style={{cursor:"pointer",accentColor:"var(--ac)"}} />
              {c.label}
            </label>
            <div className="col-arrows">
              <button className="col-arr" onClick={() => move(c.id, -1)}>▲</button>
              <button className="col-arr" onClick={() => move(c.id,  1)}>▼</button>
            </div>
          </div>
        );
      })}
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STOCK — Edit Stock Drawer (click any row)
═══════════════════════════════════════════════════════════════ */
function EditStockDrawer({ stock, derived, onSave, onDelete, onClose, onAddListings }) {
  const [form, setForm] = useState({ ...stock });
  const [totalPaid, setTotalPaid] = useState(
    stock.costPer && stock.sellable
      ? (stock.costPer * stock.sellable).toFixed(2)
      : ""
  );

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // When totalPaid or sellable changes, auto-calc costPer
  const handleTotalPaid = (val) => {
    setTotalPaid(val);
    const paid = parseFloat(val), qty = parseInt(form.sellable);
    if (paid > 0 && qty > 0) set("costPer", parseFloat((paid / qty).toFixed(4)));
  };
  const handleSellable = (val) => {
    set("sellable", val);
    const paid = parseFloat(totalPaid), qty = parseInt(val);
    if (paid > 0 && qty > 0) set("costPer", parseFloat((paid / qty).toFixed(4)));
  };

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={e => e.stopPropagation()}>
        <div className="drw-h">
          <div className="drw-title">Edit — {stock.bundleSku}</div>
          <button className="mh-close" onClick={onClose}>✕</button>
        </div>
        <div className="drw-b">
          <div className="fr">
            <label className="fl">Bundle Name</label>
            <input className="finp" value={form.name} onChange={e => set("name", e.target.value)} />
          </div>
          <div className="fr2">
            <div className="fr">
              <label className="fl">Website</label>
              <select className="fsel" value={form.website} onChange={e => set("website", e.target.value)}>
                {WEBSITES.map(w => <option key={w}>{w}</option>)}
              </select>
            </div>
            <div className="fr">
              <label className="fl">Seller</label>
              <input className="finp" value={form.seller} onChange={e => set("seller", e.target.value)} />
            </div>
          </div>
          <div className="fr2">
            <div className="fr">
              <label className="fl">Date Ordered</label>
              <input className="finp" type="date" value={form.datePurchased} onChange={e => set("datePurchased", e.target.value)} />
            </div>
            <div className="fr">
              <label className="fl">Date Received</label>
              <input className="finp" type="date" value={form.dateArrived} onChange={e => set("dateArrived", e.target.value)} />
            </div>
          </div>
          <div className="fr">
            <label className="fl">Content Details</label>
            <textarea className="fta" style={{minHeight:48}} value={form.contentDetails}
              onChange={e => set("contentDetails", e.target.value)} />
          </div>
          <div className="fr2">
            <div className="fr">
              <label className="fl">Pieces Received</label>
              <input className="finp" type="number" value={form.received}
                onChange={e => set("received", parseInt(e.target.value)||0)} />
            </div>
            <div className="fr">
              <label className="fl">Pieces Sellable</label>
              <input className="finp" type="number" value={form.sellable}
                onChange={e => handleSellable(e.target.value)} />
            </div>
          </div>
          {/* Cost inputs — total paid drives costPer */}
          <div style={{background:"var(--sf2)",border:"1px solid var(--bd)",borderRadius:"var(--r)",padding:"11px 12px",marginBottom:11}}>
            <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:"var(--txm)",marginBottom:9}}>
              Cost Calculation
            </div>
            <div className="fr2">
              <div className="fr" style={{marginBottom:0}}>
                <label className="fl">Total Amount Paid £</label>
                <input className="finp" type="number" step="0.01" placeholder="e.g. 462.80"
                  value={totalPaid} onChange={e => handleTotalPaid(e.target.value)} />
              </div>
              <div className="fr" style={{marginBottom:0}}>
                <label className="fl">Cost per Piece £ <span style={{color:"var(--txd)",fontWeight:400,textTransform:"none"}}>(auto)</span></label>
                <input className="finp" type="number" step="0.0001"
                  value={form.costPer}
                  onChange={e => { set("costPer", parseFloat(e.target.value)||0); }}
                  style={{fontWeight:700}} />
              </div>
            </div>
            {totalPaid && form.sellable && (
              <div style={{fontSize:11,color:"var(--txm)",marginTop:7}}>
                {fmt(parseFloat(totalPaid))} ÷ {form.sellable} pieces = <strong>{fmt(form.costPer)}</strong> per piece
              </div>
            )}
          </div>
          <div className="fr2">
            <label className="fchk">
              <input type="checkbox" checked={!!form.restock} onChange={e => set("restock", e.target.checked)} />
              Flag for restock
            </label>
            <label className="fchk">
              <input type="checkbox" checked={!!form.imported} onChange={e => set("imported", e.target.checked)} />
              Imported to listings
            </label>
          </div>
        </div>

        {/* Analytics panel */}
        {derived && derived.qtySold >= 0 && (
          <div style={{padding:"0 18px 14px"}}>
            <div className="st" style={{marginBottom:10,paddingTop:6}}>Bundle Analytics</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:10}}>
              {[
                {l:"Sold",      v:derived.qtySold,                         s:"items"},
                {l:"Remaining", v:derived.qtyRemaining,                    s:"items"},
                {l:"Listed",    v:derived.qtyListedNS,                     s:"live"},
                {l:"Revenue",   v:fmt(derived.netProceeds||0),             s:"total"},
                {l:"Profit",    v:fmt(derived.totalProfit||0),             s:"vs cost", c:(derived.totalProfit||0)>=0?"gn":"ac"},
                {l:"Sell-thru", v:`${derived.sellThru||0}%`,              s:"of batch"},
              ].map(({l,v,s,c})=>(
                <div key={l} style={{background:"var(--sf2)",border:"1px solid var(--bd)",borderRadius:"var(--r)",padding:"8px 10px",textAlign:"center"}}>
                  <div style={{fontSize:10,color:"var(--txm)",marginBottom:2}}>{l}</div>
                  <div style={{fontSize:15,fontWeight:900,color:c?`var(--${c})`:"var(--tx)"}}>{v}</div>
                  <div style={{fontSize:9,color:"var(--txd)"}}>{s}</div>
                </div>
              ))}
            </div>
            {/* Sell-through bar */}
            <div style={{marginBottom:6}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--txm)",marginBottom:3}}>
                <span>Sell-through progress</span>
                <span>{derived.qtySold||0} / {derived.sellable||0} sold</span>
              </div>
              <div style={{height:6,background:"var(--sf2)",border:"1px solid var(--bd)",borderRadius:3,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${Math.min(100,derived.sellThru||0)}%`,
                  background:(derived.sellThru||0)>=80?"var(--gn)":(derived.sellThru||0)>=40?"#f0a050":"var(--ac)",
                  borderRadius:3,transition:"width .4s"}}/>
              </div>
            </div>
            {derived.avgSoldPrice>0 && (
              <div style={{fontSize:11,color:"var(--txm)"}}>
                Avg sold price <strong>{fmt(derived.avgSoldPrice)}</strong>
                {derived.avgProfit!==0 && <span> · Avg profit per item <strong style={{color:"var(--gn)"}}>{fmt(derived.avgProfit)}</strong></span>}
              </div>
            )}
          </div>
        )}

        {/* Auto-import to listings */}
        {onAddListings && derived && (() => {
          const sellable = stock.sellable || 0;
          const alreadyCreated = (derived.qtyListedNS||0) + (derived.qtySold||0) + (derived.qtyToBeListed||0);
          const toCreate = Math.max(0, sellable - alreadyCreated);
          if (toCreate === 0) return (
            <div style={{margin:"0 18px 14px",padding:"10px 12px",background:"var(--gnl)",border:"1px solid rgba(31,92,53,.2)",borderRadius:"var(--r)",fontSize:11,color:"var(--gn)",fontWeight:700}}>
              ✓ All {sellable} items from this bundle have listing entries
            </div>
          );
          return (
            <div style={{margin:"0 18px 14px",padding:"12px 14px",background:"#fff8f0",border:"1px solid #f0c040",borderRadius:"var(--r)"}}>
              <div style={{fontSize:11,fontWeight:700,color:"#7a4e0e",marginBottom:6}}>
                📦 Auto-Import to Listings
              </div>
              <div style={{fontSize:11,color:"#7a4e0e",marginBottom:10,lineHeight:1.5}}>
                <strong>{toCreate}</strong> items from this bundle have no listing entry yet.
                Auto-import will create <strong>{toCreate}</strong> listing stubs
                with cost price, bundle name and SKUs pre-filled. You add colour/size/description after.
              </div>
              <button className="btn btn-p btn-sm" style={{width:"100%",justifyContent:"center"}}
                onClick={() => onAddListings(stock, toCreate)}>
                ⚡ Create {toCreate} listing stub{toCreate!==1?"s":""} from {stock.bundleSku}
              </button>
            </div>
          );
        })()}

        <div className="drw-f">
          <button className="btn btn-o btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-del btn-sm" onClick={() => {
            if (window.confirm(`Delete bundle ${stock.bundleSku} — ${stock.name}? This cannot be undone.`))
              onDelete(stock.bundleSku);
          }}>🗑 Delete</button>
          <button className="btn btn-p btn-sm" onClick={() => { onSave({ ...form, sellable: parseInt(form.sellable)||0, received: parseInt(form.received)||0 }); onClose(); }}>
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STOCK — Add Stock Modal
═══════════════════════════════════════════════════════════════ */
function AddStockModal({ stockData, onAdd, onClose }) {
  const nextBsku = getNextBundleSku(stockData);
  const [form, setForm] = useState({
    name:"", website:"Fleek", seller:"",
    datePurchased:TODAY, dateArrived:TODAY,
    contentDetails:"", received:"", sellable:"",
    totalPaid:"", costPer:"",
    restock:false,
  });
  const [errors, setErrors] = useState({});
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // Auto-calc costPer from totalPaid / sellable
  const handleTotalPaid = (val) => {
    set("totalPaid", val);
    const paid = parseFloat(val), qty = parseInt(form.sellable);
    if (paid > 0 && qty > 0) set("costPer", (paid / qty).toFixed(4));
  };
  const handleSellable = (val) => {
    set("sellable", val);
    const paid = parseFloat(form.totalPaid), qty = parseInt(val);
    if (paid > 0 && qty > 0) set("costPer", (paid / qty).toFixed(4));
  };

  const validate = () => {
    const e = {};
    if (!form.name.trim())  e.name     = true;
    if (!form.sellable)     e.sellable  = true;
    if (!form.costPer)      e.costPer   = true;
    setErrors(e);
    return !Object.keys(e).length;
  };

  const handleAdd = () => {
    if (!validate()) return;
    const sellable  = parseInt(form.sellable);
    const costPer   = parseFloat(form.costPer);
    const totalCost = parseFloat(form.totalPaid) || sellable * costPer;
    onAdd({
      bundleSku:      nextBsku,
      name:           form.name.trim(),
      website:        form.website,
      seller:         form.seller.trim(),
      datePurchased:  form.datePurchased,
      dateArrived:    form.dateArrived,
      contentDetails: form.contentDetails.trim(),
      received:       parseInt(form.received) || sellable,
      sellable,
      costPer,
      totalCost,
      imported:       false,
      restock:        form.restock,
    });
    onClose();
  };

  const err = (k) => errors[k] ? {borderColor:"var(--ac)"} : {};

  return (
    <div className="overlay">
      <div className="modal">
        <div className="mh">
          <div>
            <div className="mh-title">Add New Stock Bundle</div>
            <div className="mh-sub">Will be assigned {nextBsku}</div>
          </div>
          <button className="mh-close" onClick={onClose}>✕</button>
        </div>
        <div className="mb">
          <div className="fr">
            <label className="fl">Bundle / Stock Name {errors.name && <span style={{color:"var(--ac)"}}>*</span>}</label>
            <input className="finp" placeholder="e.g. Ralph Lauren Harrington Jackets"
              value={form.name} onChange={e => set("name", e.target.value)} style={err("name")} />
          </div>
          <div className="fr2">
            <div className="fr">
              <label className="fl">Website / Source</label>
              <select className="fsel" value={form.website} onChange={e => set("website", e.target.value)}>
                {WEBSITES.map(w => <option key={w}>{w}</option>)}
              </select>
            </div>
            <div className="fr">
              <label className="fl">Seller</label>
              <input className="finp" placeholder="e.g. Vintage Voyage"
                value={form.seller} onChange={e => set("seller", e.target.value)} />
            </div>
          </div>
          <div className="fr2">
            <div className="fr">
              <label className="fl">Date Ordered</label>
              <input className="finp" type="date" value={form.datePurchased}
                onChange={e => set("datePurchased", e.target.value)} />
            </div>
            <div className="fr">
              <label className="fl">Date Received</label>
              <input className="finp" type="date" value={form.dateArrived}
                onChange={e => set("dateArrived", e.target.value)} />
            </div>
          </div>
          <div className="fr">
            <label className="fl">Content Details</label>
            <textarea className="fta" style={{minHeight:48}}
              placeholder="e.g. Mixed colours, sizes S-XL"
              value={form.contentDetails} onChange={e => set("contentDetails", e.target.value)} />
          </div>
          <div className="fr2">
            <div className="fr">
              <label className="fl">Pieces Received</label>
              <input className="finp" type="number" placeholder="e.g. 26"
                value={form.received} onChange={e => set("received", e.target.value)} />
            </div>
            <div className="fr">
              <label className="fl">Pieces Sellable {errors.sellable && <span style={{color:"var(--ac)"}}>*</span>}</label>
              <input className="finp" type="number" placeholder="e.g. 26"
                value={form.sellable} onChange={e => handleSellable(e.target.value)} style={err("sellable")} />
            </div>
          </div>
          {/* Cost section */}
          <div style={{background:"var(--sf2)",border:"1px solid var(--bd)",borderRadius:"var(--r)",padding:"11px 12px",marginBottom:11}}>
            <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:"var(--txm)",marginBottom:9}}>
              Cost — enter total paid and cost/pc is calculated automatically
            </div>
            <div className="fr2" style={{marginBottom:0}}>
              <div className="fr" style={{marginBottom:0}}>
                <label className="fl">Total Amount Paid £</label>
                <input className="finp" type="number" step="0.01" placeholder="e.g. 462.80"
                  value={form.totalPaid} onChange={e => handleTotalPaid(e.target.value)} />
              </div>
              <div className="fr" style={{marginBottom:0}}>
                <label className="fl">Cost per Piece £ {errors.costPer && <span style={{color:"var(--ac)"}}>*</span>} <span style={{color:"var(--txd)",fontWeight:400,textTransform:"none"}}>(auto)</span></label>
                <input className="finp" type="number" step="0.0001" placeholder="e.g. 17.80"
                  value={form.costPer} onChange={e => set("costPer", e.target.value)} style={{...err("costPer"),fontWeight:700}} />
              </div>
            </div>
            {form.totalPaid && form.sellable && (
              <div style={{fontSize:11,color:"var(--txm)",marginTop:7}}>
                {fmt(parseFloat(form.totalPaid))} ÷ {form.sellable} pieces = <strong>{fmt(parseFloat(form.costPer))}</strong> per piece
              </div>
            )}
          </div>
          <label className="fchk">
            <input type="checkbox" checked={form.restock} onChange={e => set("restock", e.target.checked)} />
            Flag for restock when depleted
          </label>
        </div>
        <div className="mf">
          <button className="btn btn-o btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-p btn-sm" onClick={handleAdd}>Add Bundle →</button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STOCK — Import Modal
═══════════════════════════════════════════════════════════════ */
function ImportModal({ stockData, onClose }) {
  const pending = stockData.filter(s => !s.imported);
  const totalItems = pending.reduce((a,s) => a+s.sellable, 0);
  const alreadyDone = stockData.filter(s => s.imported).length;
  return (
    <div className="overlay">
      <div className="modal">
        <div className="mh">
          <div>
            <div className="mh-title">Import from Stock</div>
            <div className="mh-sub">{pending.length} batches · {totalItems} new listings · {alreadyDone} already imported</div>
          </div>
          <button className="mh-close" onClick={onClose}>✕</button>
        </div>
        <div className="mb">
          {!pending.length ? (
            <div style={{textAlign:"center",padding:"24px 0",color:"var(--txd)",fontSize:12}}>
              All batches have already been imported.
            </div>
          ) : (
            <>
              <div style={{background:"var(--gnl)",border:"1px solid rgba(31,92,53,.2)",borderRadius:"var(--r)",padding:"9px 12px",marginBottom:12,fontSize:12,color:"var(--gn)",fontWeight:700}}>
                ✓ {totalItems} listing rows will be created from {pending.length} batch{pending.length!==1?"es":""}
              </div>
              <div className="tw">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th className="no-sort">Bundle</th>
                      <th className="no-sort">Name</th>
                      <th className="no-sort">Pieces</th>
                      <th className="no-sort">Cost/pc</th>
                      <th className="no-sort">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map(s => (
                      <tr key={`${s.bundleSku}-${s.name}`}>
                        <td><span className="bsku">{s.bundleSku}</span></td>
                        <td style={{fontWeight:600}}>{s.name}</td>
                        <td style={{textAlign:"center"}}>{s.sellable}</td>
                        <td>{fmt(s.costPer)}</td>
                        <td style={{fontWeight:700}}>{fmt(s.sellable*s.costPer)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
        <div className="mf">
          <button className="btn btn-o btn-sm" onClick={onClose}>Cancel</button>
          {pending.length > 0 && (
            <button className="btn btn-p btn-sm" onClick={onClose}>Confirm Import →</button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STOCK — render one cell by column id
═══════════════════════════════════════════════════════════════ */
function StockCell({ colId, s }) {
  if (colId==="bundleSku")     return <span className="bsku">{s.bundleSku}</span>;
  if (colId==="name")          return <span style={{fontWeight:700}}>{s.name}</span>;
  if (colId==="website")       return <span className="badge b-n">{s.website}</span>;
  if (colId==="seller")        return <span style={{color:"var(--txm)",fontSize:11}}>{s.seller}</span>;
  if (colId==="datePurchased") return <span style={{color:"var(--txm)",fontSize:11}}>{s.datePurchased}</span>;
  if (colId==="dateArrived")   return <span style={{color:"var(--txm)",fontSize:11}}>{s.dateArrived}</span>;
  if (colId==="contentDetails")return <span style={{color:"var(--txm)",fontSize:11,maxWidth:140,display:"block",overflow:"hidden",textOverflow:"ellipsis"}}>{s.contentDetails}</span>;
  if (colId==="received")      return <span style={{textAlign:"center",display:"block"}}>{s.received}</span>;
  if (colId==="sellable")      return <span style={{textAlign:"center",display:"block",fontWeight:700}}>{s.sellable}</span>;
  if (colId==="costPer")       return fmt(s.costPer);
  if (colId==="totalCost")     return fmt(s.totalCost);
  if (colId==="qtySold")       return <span style={{textAlign:"center",display:"block",fontWeight:700}}>{s.qtySold}</span>;
  if (colId==="totalProfit")   return <span style={{fontWeight:700,color:s.totalProfit>0?"var(--gn)":"var(--txd)"}}>{fmt(s.totalProfit)}</span>;
  if (colId==="qtyRemaining")  return <span style={{textAlign:"center",display:"block"}}>{s.qtyRemaining}</span>;
  if (colId==="qtyListed")     return <span style={{textAlign:"center",display:"block"}}>{s.qtyListed}</span>;
  if (colId==="qtyListedNS")   return <span style={{textAlign:"center",display:"block"}}>{s.qtyListedNS}</span>;
  if (colId==="qtyToBeListed") return <span style={{textAlign:"center",display:"block",fontWeight:s.qtyToBeListed>0?700:400,color:s.qtyToBeListed>0?"var(--am)":"var(--txd)"}}>{s.qtyToBeListed||"—"}</span>;
  if (colId==="netProceeds")   return <span style={{fontWeight:700,color:"var(--gn)"}}>{fmt(s.netProceeds)}</span>;
  if (colId==="stockValLeft")  return fmt(s.stockValLeft);
  if (colId==="sellThru")      return (
    <div className="pw">
      <div className="pt" style={{width:44}}>
        <div className="pf" style={{width:`${s.sellThru}%`,background:s.sellThru>60?"var(--gn)":s.sellThru>30?"var(--am)":"var(--ac)"}} />
      </div>
      <span className="pl">{s.sellThru}%</span>
    </div>
  );
  if (colId==="avgSoldPrice")  return <span style={{fontWeight:700,color:s.avgSoldPrice>0?"var(--tx)":"var(--txd)"}}>{s.avgSoldPrice>0?fmt(s.avgSoldPrice):"—"}</span>;
  if (colId==="avgProfit")     return <span style={{fontWeight:700,color:s.avgProfit>0?"var(--gn)":"var(--txd)"}}>{s.avgProfit>0?fmt(s.avgProfit):"—"}</span>;
  if (colId==="restock")       return s.restock ? <span className="badge b-r">Yes</span> : <span style={{color:"var(--txd)"}}>—</span>;
  if (colId==="imported")      return s.imported ? <span className="cy">✓</span> : <span className="cn">○</span>;
  return "—";
}

/* ═══════════════════════════════════════════════════════════════
   STOCK TAB
═══════════════════════════════════════════════════════════════ */
const NUMERIC_STOCK_COLS = new Set([
  "received","sellable","costPer","totalCost","qtySold","totalProfit",
  "qtyRemaining","qtyListed","qtyListedNS","qtyToBeListed",
  "netProceeds","stockValLeft","sellThru","avgSoldPrice","avgProfit",
]);

function StockTab({ stockData, setStockData, listings, setListings }) {
  const [cols,         setCols]        = useState(STOCK_COLS);
  const [showColPanel, setShowColPanel]= useState(false);
  const [showAdd,      setShowAdd]     = useState(false);
  const [showImport,   setShowImport]  = useState(false);
  const [editStock,    setEditStock]   = useState(null);
  const [search,       setSearch]      = useState("");
  const [websiteFilter,setWebsiteFilter] = useState("All");
  const [restockFilter,setRestockFilter] = useState("All");
  const [sortCol,      setSortCol]     = useState(null);
  const [sortDir,      setSortDir]     = useState("asc");

  const derived = useMemo(() => deriveStock(stockData, listings), [stockData, listings]);

  const {
    filtered: colFiltered,
    filters, setFilter, clearFilter, clearAll, activeFilters,
    showPanel: showFilterPanel, setShowPanel: setShowFilterPanel,
    btnRef: filterBtnRef,
  } = useTableFilters(derived, cols);

  const onSort = (col) => {
    const sortable = NUMERIC_STOCK_COLS.has(col) || col==="bundleSku" || col==="name";
    if (!sortable) return;
    setSortDir(d => sortCol===col ? (d==="asc"?"desc":"asc") : "asc");
    setSortCol(col);
  };

  const filtered = useMemo(() => {
    let d = [...colFiltered];           // already passed through column filters
    if (search.trim()) {
      const s = search.toLowerCase();
      d = d.filter(r =>
        r.name.toLowerCase().includes(s) ||
        r.bundleSku.toLowerCase().includes(s) ||
        r.seller.toLowerCase().includes(s) ||
        r.website.toLowerCase().includes(s) ||
        r.contentDetails.toLowerCase().includes(s)
      );
    }
    if (websiteFilter !== "All") d = d.filter(r => r.website === websiteFilter);
    if (restockFilter === "Restock")    d = d.filter(r => r.restock);
    if (restockFilter === "No restock") d = d.filter(r => !r.restock);
    if (sortCol) {
      d = [...d].sort((a, b) => {
        const av = a[sortCol], bv = b[sortCol];
        if (av==null) return 1; if (bv==null) return -1;
        const res = typeof av==="number" ? av-bv : String(av).localeCompare(String(bv));
        return sortDir==="asc" ? res : -res;
      });
    }
    return d;
  }, [colFiltered, search, websiteFilter, restockFilter, sortCol, sortDir]);

  const visCols = cols.filter(c => c.visible);
  const { getStyle: getStockColStyle, onMouseDown: onStockColResize } = useColWidths(cols);
  const stockZoom = useZoom(100);
  const handleAddStock    = (ns) => setStockData(p => [...p, ns]);
  const handleDeleteStock = (bsku) => {
    setStockData(prev => prev.filter(s => s.bundleSku !== bsku));
    setEditStock(null);
  };
  const handleSaveStock = (updated) =>
    setStockData(p => p.map(s => s.bundleSku===updated.bundleSku ? updated : s));

  const handleAutoImport = (stock, count) => {
    const nextSkuNum = (() => {
      const skus = listings.map(l=>parseInt(l.sku.replace(/[^0-9]/g,"")||0)).filter(n=>!isNaN(n)&&n>0);
      return skus.length ? Math.max(...skus)+1 : 1;
    })();
    const letter = (listings[0]?.sku?.match(/^([A-Z]+)/)||["","A"])[1];
    const stubs = Array.from({length:count},(_,i)=>({
      bundleSku:  stock.bundleSku,
      name:       stock.name,
      brand:      stock.brand  || "",
      type:       stock.type   || "",
      colour:     "",
      size:       "",
      desc:       "",
      length:     "",
      pitToPit:   "",
      sku:        `${letter}${nextSkuNum+i}`,
      price:      stock.costPer || 0,
      listed:     false,
      sold:       false,
      shipped:    false,
      dayListed:  null,
      platforms:  [],
      platform:   null,
      platformDates: {},
      notes:      "⚠ Fill in colour, size and description",
    }));
    setListings(prev => [...prev, ...stubs]);
    setEditStock(null);
    alert(`✓ Created ${count} listing stub${count!==1?"s":""} for ${stock.bundleSku}. Go to Listings tab to fill in colour/size/description.`);
  };

  /* Summary KPIs */
  const totalBundles  = filtered.length;
  const totalItems    = filtered.reduce((a,s) => a+s.sellable, 0);
  const totalSpend    = filtered.reduce((a,s) => a+s.totalCost, 0);
  const totalProceeds = filtered.reduce((a,s) => a+s.netProceeds, 0);
  const totalProfit   = filtered.reduce((a,s) => a+s.totalProfit, 0);

  return (
    <div>
      {showAdd    && <AddStockModal stockData={stockData} onAdd={handleAddStock}  onClose={()=>setShowAdd(false)} />}
      {showImport && <ImportModal   stockData={stockData} onClose={()=>setShowImport(false)} />}
      {editStock  && <EditStockDrawer
        stock={editStock}
        derived={filtered.find(s=>s.bundleSku===editStock.bundleSku&&s.name===editStock.name)||editStock}
        onSave={handleSaveStock} onDelete={handleDeleteStock} onClose={()=>setEditStock(null)}
        onAddListings={handleAutoImport} />}

      {/* Summary KPIs */}
      <div className="kg kg4" style={{marginBottom:14}}>
        {[
          {l:"Bundles",      v:totalBundles,        b:"",   s:"In current view"},
          {l:"Total Items",  v:totalItems,           b:"nv", s:"Sellable pieces"},
          {l:"Total Spend",  v:fmt(totalSpend),      b:"am", s:"Stock cost"},
          {l:"Net Proceeds", v:fmt(totalProceeds),   b:"gn", s:`${fmt(totalProfit)} profit`},
        ].map(k => (
          <div key={k.l} className="kc">
            <div className={`kb ${k.b}`}/>
            <div className="kl">{k.l}</div>
            <div className="kv" style={{fontSize:typeof k.v==="string"&&k.v.startsWith("£")?18:24}}>{k.v}</div>
            <div className="ks">{k.s}</div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="filter-bar">
        <div className="sw">
          <span className="si">⌕</span>
          <input className="fi" placeholder="Search name, bundle, seller…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="fs" value={websiteFilter} onChange={e => setWebsiteFilter(e.target.value)}>
          <option value="All">All Websites</option>
          {WEBSITES.map(w => <option key={w}>{w}</option>)}
        </select>
        <select className="fs" value={restockFilter} onChange={e => setRestockFilter(e.target.value)}>
          <option value="All">All Batches</option>
          <option value="Restock">Restock flagged</option>
          <option value="No restock">No restock</option>
        </select>
      </div>

      {/* Action bar — second row */}
      <div className="action-bar">
        <div style={{position:"relative"}}>
          <button className="btn btn-o btn-sm" ref={filterBtnRef} onClick={()=>setShowFilterPanel(v=>!v)}>
            ⚡ Filters {activeFilters.length>0 && <span style={{background:"var(--ac)",color:"#fff",borderRadius:10,padding:"0 5px",fontSize:9,marginLeft:3}}>{activeFilters.length}</span>}
          </button>
          {showFilterPanel && (
            <FilterPanel colDefs={cols} rows={derived}
              filters={filters} setFilter={setFilter} clearAll={clearAll}
              onClose={()=>setShowFilterPanel(false)} anchorRef={filterBtnRef} />
          )}
        </div>
        <div style={{position:"relative"}}>
          <button className="btn btn-o btn-sm" onClick={()=>setShowColPanel(v=>!v)}>⚙ Columns</button>
          {showColPanel && <ColPanel cols={cols} setCols={setCols} onClose={()=>setShowColPanel(false)} />}
        </div>
        <button className="btn btn-o btn-sm" onClick={()=>exportToCSV(filtered, cols, "stock")}>↓ CSV</button>
        <button className="btn btn-o btn-sm" onClick={()=>setShowImport(true)}>↓ Import</button>
        <button className="btn btn-p btn-sm" onClick={()=>setShowAdd(true)}>+ Add Stock</button>
      </div>

      <FilterChips colDefs={cols} activeFilters={activeFilters} clearFilter={clearFilter} clearAll={clearAll} />

      {/* Table */}
      <div className="tw">
        <ZoomBar {...stockZoom} />
        <div className="ts">
          <div style={stockZoom.style()}>
          <table className="tbl">
            <thead>
              <tr>
                {visCols.map(c => {
                  const sortable = NUMERIC_STOCK_COLS.has(c.id) || c.id==="bundleSku" || c.id==="name";
                  const colStyle = { ...getStockColStyle(c.id), minWidth: c.minW||80 };
                  return sortable
                    ? <STh key={c.id} col={c.id} sortCol={sortCol} sortDir={sortDir} onSort={onSort} style={colStyle} onResize={onStockColResize}>{c.label}</STh>
                    : <th key={c.id} className="no-sort" style={colStyle}><span>{c.label}</span><span className="col-resize" onMouseDown={e=>onStockColResize(e,c.id,e.currentTarget.parentElement)} onClick={e=>e.stopPropagation()}/></th>;
                })}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={visCols.length} style={{textAlign:"center",padding:"28px",color:"var(--txd)"}}>
                    No bundles match your search.
                  </td>
                </tr>
              ) : filtered.map(s => {
                // Find the raw stock item (not derived) so drawer gets original data
                const rawStock = stockData.find(r => r.bundleSku===s.bundleSku && r.name===s.name) || s;
                return (
                  <tr
                    key={`${s.bundleSku}-${s.name}`}
                    className={`clickable${!s.imported?" dim":""}`}
                    onClick={() => setEditStock(rawStock)}
                    title="Click to edit"
                  >
                    {visCols.map(c => (
                      <td key={c.id}><StockCell colId={c.id} s={s} /></td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>{/* end zoom wrap */}
        </div>{/* end .ts */}
      </div>{/* end .tw */}

      {/* Footer */}
      <div style={{marginTop:8,fontSize:11,color:"var(--txd)",textAlign:"right"}}>
        {filtered.length} of {derived.length} bundle{derived.length!==1?"s":""}
        {search||websiteFilter!=="All"||restockFilter!=="All" ? " (filtered)" : ""}
        <span style={{marginLeft:12,color:"var(--txd)"}}>· Click any row to edit</span>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   LISTINGS — Edit Drawer (Command 4 — full implementation)
═══════════════════════════════════════════════════════════════ */
function EditListingDrawer({ listing, stockData, onSave, onDelete, onClose }) {
  const [form, setForm] = useState({ ...listing });
  const [dirty, setDirty] = useState(false);

  const set = (k, v) => {
    setDirty(true);
    setForm(prev => {
      const next = { ...prev, [k]: v };
      // Auto-calculate profit whenever soldPrice or price changes
      if (k === "soldPrice" || k === "price") {
        const sp = parseFloat(k === "soldPrice" ? v : next.soldPrice);
        const cp = parseFloat(k === "price"     ? v : next.price);
        if (!isNaN(sp) && !isNaN(cp)) {
          next.profit = parseFloat((sp - cp).toFixed(2));
        }
      }
      // Auto-calculate days when dayListed or daySold changes
      if ((k === "dayListed" || k === "daySold") && next.dayListed && next.daySold) {
        next.days = Math.max(0, Math.floor(
          (new Date(next.daySold) - new Date(next.dayListed)) / 86400000
        ));
      }
      return next;
    });
  };

  const handleClose = () => {
    if (dirty) {
      if (!window.confirm("You have unsaved changes. Close anyway?")) return;
    }
    onClose();
  };

  const handleSave = () => {
    onSave({
      ...form,
      price:     parseFloat(form.price)     || 0,
      soldPrice: form.soldPrice ? parseFloat(form.soldPrice) : null,
      profit:    form.profit    != null ? parseFloat(form.profit) : null,
    });
    // onSave calls onClose via the parent
  };

  /* ── Section header ── */
  const Sec = ({ label }) => (
    <div style={{
      fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"1.5px",
      color:"var(--txd)",borderBottom:"1px solid var(--bd)",paddingBottom:5,
      marginBottom:10,marginTop:16,
    }}>{label}</div>
  );

  return (
    <div className="drawer-overlay" onClick={handleClose}>
      <div className="drawer" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="drw-h">
          <div>
            <div className="drw-title">Edit — <span style={{letterSpacing:1.5}}>{listing.sku}</span></div>
            <div style={{fontSize:10,color:"rgba(255,255,255,.4)",marginTop:2}}>
              {listing.brand} {listing.type} · {listing.colour} · Size {listing.size}
            </div>
          </div>
          <button className="mh-close" onClick={handleClose}>✕</button>
        </div>

        {/* Body */}
        <div className="drw-b">

          <Sec label="Item Details" />
          <div className="fr2">
            <div className="fr">
              <label className="fl">Brand</label>
              <input className="finp" value={form.brand} onChange={e=>set("brand",e.target.value)} />
            </div>
            <div className="fr">
              <label className="fl">Type</label>
              <ComboSelect value={form.type} onChange={v=>set("type",v)} options={DEFAULT_TYPES} placeholder="type" />
            </div>
          </div>
          <div className="fr2">
            <div className="fr">
              <label className="fl">Colour</label>
              <ComboSelect value={form.colour} onChange={v=>set("colour",v)} options={DEFAULT_COLOURS} placeholder="colour" />
            </div>
            <div className="fr">
              <label className="fl">Size</label>
              <ComboSelect value={form.size} onChange={v=>set("size",v)} options={DEFAULT_SIZES} placeholder="size" />
            </div>
          </div>
          <div className="fr">
            <label className="fl">Description</label>
            <textarea className="fta" style={{minHeight:55}} value={form.desc||""}
              onChange={e=>set("desc",e.target.value)} />
          </div>
          <div className="fr2">
            <div className="fr">
              <label className="fl">Length</label>
              <input className="finp" value={form.length||""} onChange={e=>set("length",e.target.value)} />
            </div>
            <div className="fr">
              <label className="fl">Pit to Pit</label>
              <input className="finp" value={form.pitToPit||""} onChange={e=>set("pitToPit",e.target.value)} />
            </div>
          </div>

          <Sec label="Pricing" />
          <div className="fr2">
            <div className="fr">
              <label className="fl">SKU</label>
              <input className="finp" value={form.sku} onChange={e=>set("sku",e.target.value)} />
            </div>
            <div className="fr">
              <label className="fl">Cost Price £</label>
              <input className="finp" type="number" step="0.01" value={form.price}
                onChange={e=>set("price",e.target.value)} />
            </div>
          </div>
          <div className="fr2">
            <div className="fr">
              <label className="fl">Sold Price £</label>
              <input className="finp" type="number" step="0.01"
                value={form.soldPrice ?? ""} placeholder="—"
                onChange={e=>set("soldPrice", e.target.value === "" ? null : e.target.value)} />
            </div>
            <div className="fr">
              <label className="fl">
                Profit £
                <span style={{color:"var(--txd)",fontWeight:400,textTransform:"none",marginLeft:4}}>(auto)</span>
              </label>
              <input className="finp" type="number" step="0.01"
                value={form.profit ?? ""}
                onChange={e=>set("profit", e.target.value === "" ? null : parseFloat(e.target.value))}
                style={{fontWeight:700, color: form.profit > 0 ? "var(--gn)" : form.profit < 0 ? "var(--ac)" : undefined}}
              />
            </div>
          </div>

          <Sec label="Listing Info" />
          <div className="fr">
            <label className="fl">Platforms Listed On</label>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginTop:4}}>
              {MARK_LISTED_PLATS.map(p => {
                const isSelected = (form.platforms||[]).includes(p) || form.platform === p;
                const PLAT_DOTS = {
                  Depop:"#ff2300",Vinted:"#09b1ba",eBay:"#e53238",
                  Whatnot:"#7c3aed","Facebook Marketplace":"#1877f2",
                  Tilt:"#f59e0b",Grailed:"#1a1a1a",
                };
                const col = isSelected ? (PLAT_DOTS[p]||"var(--ac)") : null;
                return (
                  <button key={p}
                    onClick={() => {
                      setDirty(true);
                      const current = [...new Set([...(form.platforms||[]), form.platform].filter(Boolean))];
                      const next = current.includes(p)
                        ? current.filter(x=>x!==p)
                        : [...current, p];
                      const newDates = {...(form.platformDates||{})};
                      if (current.includes(p)) {
                        delete newDates[p]; // Remove date when platform is deselected
                      } else {
                        newDates[p] = form.dayListed || getToday(); // Add date when selected
                      }
                      setForm(prev => ({
                        ...prev,
                        platforms: next,
                        platform: next[0] || null,
                        platformDates: newDates,
                      }));
                    }}
                    style={{
                      padding:"6px 4px",fontSize:10,fontWeight:700,textAlign:"center",
                      border:`1.5px solid ${col||"var(--bd)"}`,
                      borderRadius:"var(--r)",cursor:"pointer",
                      background:col ? col+"18" : "var(--sf2)",
                      color:col||"var(--txm)",
                      transition:"all .12s",
                    }}
                  >
                    {p}{isSelected?" ✓":""}
                  </button>
                );
              })}
            </div>
            {(form.platforms||[]).length > 0 && (
              <div style={{fontSize:10,color:"var(--txd)",marginTop:5}}>
                Primary: <strong style={{color:"var(--tx)"}}>{form.platforms?.[0]||form.platform}</strong>
                {" · "}Tap to toggle
              </div>
            )}
          </div>
          <div className="fr2">
            <div className="fr">
              <label className="fl">Day Listed</label>
              <div style={{display:"flex",gap:5,alignItems:"center"}}>
                <input className="finp" type="date" value={form.dayListed||""}
                  onChange={e=>set("dayListed", e.target.value||null)}
                  style={{flex:1}} />
                {form.dayListed && (
                  <button onClick={()=>set("dayListed",null)}
                    style={{background:"none",border:"none",cursor:"pointer",color:"var(--txd)",fontSize:14,lineHeight:1,padding:"0 2px"}}
                    title="Clear date">✕</button>
                )}
              </div>
            </div>
            <div className="fr">
              <label className="fl">Day Sold</label>
              <div style={{display:"flex",gap:5,alignItems:"center"}}>
                <input className="finp" type="date" value={form.daySold||""}
                  onChange={e=>set("daySold", e.target.value||null)}
                  style={{flex:1}} />
                {form.daySold && (
                  <button onClick={()=>set("daySold",null)}
                    style={{background:"none",border:"none",cursor:"pointer",color:"var(--txd)",fontSize:14,lineHeight:1,padding:"0 2px"}}
                    title="Clear date">✕</button>
                )}
              </div>
            </div>
          </div>
          {form.dayListed && form.daySold && (
            <div style={{fontSize:11,color:"var(--txm)",marginTop:-6,marginBottom:10}}>
              Days to sell: <strong>{form.days ?? "—"}</strong>
            </div>
          )}
          <div className="fr">
            <label className="fl">Photo URL</label>
            <input className="finp" placeholder="https://…"
              value={form.photoUrl||""} onChange={e=>set("photoUrl",e.target.value)} />
          </div>
          {form.photoUrl && (
            <img src={form.photoUrl} alt=""
              style={{width:"100%",maxHeight:120,objectFit:"cover",borderRadius:"var(--r)",border:"1px solid var(--bd)",marginBottom:10}}
              onError={e=>{e.target.style.display="none";}}
            />
          )}
          <div className="fr">
            <label className="fl">Notes</label>
            <textarea className="fta" style={{minHeight:44}} value={form.notes||""}
              onChange={e=>set("notes",e.target.value)} />
          </div>

          <Sec label="Status" />
          <div className="frow-chk">
            <label className="fchk">
              <input type="checkbox" checked={!!form.listed} onChange={e=>set("listed",e.target.checked)} />
              Listed
            </label>
            <label className="fchk">
              <input type="checkbox" checked={!!form.sold} onChange={e=>set("sold",e.target.checked)} />
              Sold
            </label>
            <label className="fchk">
              <input type="checkbox" checked={!!form.shipped} onChange={e=>{
                set("shipped",e.target.checked);
                if (e.target.checked && !form.shippedDate) set("shippedDate", TODAY);
              }} />
              Shipped
            </label>
          </div>

          {/* Process Return — only shows when item is sold */}
          {form.sold && (
            <div style={{
              marginTop:14,padding:"12px 13px",
              background:"#fff8f0",border:"1px solid #f0c040",
              borderRadius:"var(--r)",
            }}>
              <div style={{fontSize:11,fontWeight:700,color:"#7a4e0e",marginBottom:8}}>
                📦 Process a Return
              </div>
              <div style={{fontSize:11,color:"#7a4e0e",marginBottom:10,lineHeight:1.5}}>
                Choose what happens after the return is received:
              </div>
              <div style={{display:"flex",gap:7}}>
                <button
                  className="btn btn-o btn-sm"
                  style={{flex:1,justifyContent:"center",fontSize:11}}
                  onClick={() => {
                    const returnDate = new Date().toISOString().split("T")[0];
                    const prevSku = form.sku;
                    setForm(prev => ({
                      ...prev,
                      sold:false, soldPrice:null, profit:null,
                      daySold:null, days:null, shipped:false, shippedDate:null,
                      listed:true,
                      notes:(prev.notes ? prev.notes + "\n" : "") + `Returned ${returnDate} — relisted`,
                    }));
                    setDirty(true);
                    sendPushNotification({
                      title: "ArchiveDistrict",
                      body:  `📦 ${prevSku} returned — relisted`,
                      tag:   `return-${prevSku}`,
                    });
                  }}
                >
                  ↩ Relist (keep live)
                </button>
                <button
                  className="btn btn-o btn-sm"
                  style={{flex:1,justifyContent:"center",fontSize:11}}
                  onClick={() => {
                    const returnDate = new Date().toISOString().split("T")[0];
                    const prevSku = form.sku;
                    setForm(prev => ({
                      ...prev,
                      sold:false, soldPrice:null, profit:null,
                      daySold:null, days:null, shipped:false, shippedDate:null,
                      listed:false, dayListed:null,
                      platforms:[], platformDates:{},
                      notes:(prev.notes ? prev.notes + "\n" : "") + `Returned ${returnDate} — pulled from platforms`,
                    }));
                    setDirty(true);
                    sendPushNotification({
                      title: "ArchiveDistrict",
                      body:  `📦 ${prevSku} returned — pulled down`,
                      tag:   `return-${prevSku}`,
                    });
                  }}
                >
                  ↩ Pull down (relist later)
                </button>
              </div>
              <div style={{fontSize:10,color:"#7a4e0e",marginTop:7,opacity:.7}}>
                Both options clear sold data and add a return note. Save Changes to confirm.
              </div>
            </div>
          )}

          {dirty && (
            <div style={{marginTop:12,fontSize:11,color:"var(--am)",fontWeight:700}}>
              ● Unsaved changes
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="drw-f">
          <button className="btn btn-o btn-sm" onClick={handleClose}>Cancel</button>
          <button className="btn btn-del btn-sm" onClick={() => {
            if (window.confirm(`Delete ${listing.sku} — ${listing.brand} ${listing.type}? This cannot be undone.`))
              onDelete(listing.sku);
          }}>🗑 Delete</button>
          <button className="btn btn-p btn-sm" onClick={handleSave}>Save Changes</button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   LISTINGS — render one table cell by column id
═══════════════════════════════════════════════════════════════ */
function ListingCell({ colId, l, onShipToggle, onSelect, selected }) {
  if (colId === "sel") return (
    <input
      type="checkbox"
      checked={selected}
      onChange={onSelect}
      onClick={e => e.stopPropagation()}
      style={{cursor:"pointer",accentColor:"var(--ac)"}}
    />
  );
  if (colId === "photo") {
    if (l.photoUrl) return (
      <img
        src={l.photoUrl}
        className="thumb"
        alt=""
        onError={e => { e.target.style.display="none"; }}
      />
    );
    return <span className="thumb-ph">—</span>;
  }
  if (colId === "bundleSku") return <span className="bsku">{l.bundleSku}</span>;
  if (colId === "name")      return (
    <span style={{fontWeight:600}}>
      {l.name}
    </span>
  );
  if (colId === "brand")    return <span style={{color:"var(--txm)"}}>{l.brand}</span>;
  if (colId === "type")     return <span className="badge b-0">{l.type}</span>;
  if (colId === "colour")   return l.colour;
  if (colId === "size")     return <span style={{color:"var(--txm)",fontWeight:600}}>{l.size}</span>;
  if (colId === "desc")     return (
    <span style={{maxWidth:130,display:"block",overflow:"hidden",textOverflow:"ellipsis",color:"var(--txm)",fontSize:11}}>
      {l.desc || "—"}
    </span>
  );
  if (colId === "length")   return <span style={{color:"var(--txm)"}}>{l.length || "—"}</span>;
  if (colId === "pitToPit") return <span style={{color:"var(--txm)"}}>{l.pitToPit || "—"}</span>;
  if (colId === "listed")   return l.listed  ? <span className="cy">✓</span> : <span className="cn">○</span>;
  if (colId === "sku")      return <span className="sku">{l.sku}</span>;
  if (colId === "price")    return fmt(l.price);
  if (colId === "sold")     return l.sold    ? <span className="cy">✓</span> : <span className="cn">○</span>;
  if (colId === "soldPrice") return (
    <span style={{fontWeight:l.soldPrice?700:400,color:l.soldPrice?"var(--tx)":"var(--txd)"}}>
      {l.soldPrice ? fmt(l.soldPrice) : "—"}
    </span>
  );
  if (colId === "profit") return (
    <span style={{fontWeight:700,color:l.profit>0?"var(--gn)":l.profit<0?"var(--ac)":"var(--txd)"}}>
      {l.profit != null ? fmt(l.profit) : "—"}
    </span>
  );
  if (colId === "notes")    return <span style={{color:"var(--txm)",fontSize:11}}>{l.notes || "—"}</span>;
  if (colId === "platform") return l.platform
    ? <span className="badge b-b">{l.platform}</span>
    : <span style={{color:"var(--txd)"}}>—</span>;
  if (colId === "platforms") {
    const plats = l.platforms?.length ? l.platforms : l.platform ? [l.platform] : [];
    return plats.length
      ? <div style={{display:"flex",flexWrap:"wrap",gap:3}}>
          {plats.map(p => <span key={p} className="badge b-b" style={{fontSize:9,padding:"1px 5px"}}>{p}</span>)}
        </div>
      : <span style={{color:"var(--txd)"}}>—</span>;
  }
  if (colId === "platformDates") {
    const pd = l.platformDates || {};
    const plats = l.platforms?.length ? l.platforms : l.platform ? [l.platform] : [];
    if (!plats.length) return <span style={{color:"var(--txd)"}}>—</span>;
    const PLAT_DOTS = {
      Depop:"#ff2300",Vinted:"#09b1ba",eBay:"#e53238",
      Whatnot:"#7c3aed",Grailed:"#1a1a1a",
      "Facebook Marketplace":"#1877f2",Tilt:"#f59e0b",
    };
    return (
      <div style={{display:"flex",flexDirection:"column",gap:2}}>
        {plats.map(p => {
          const date = pd[p] || l.dayListed;
          const col  = PLAT_DOTS[p] || "var(--txm)";
          return (
            <div key={p} style={{
              display:"inline-flex",alignItems:"center",gap:5,
              background:col+"18",border:`1px solid ${col}55`,
              borderRadius:20,padding:"2px 7px",fontSize:10,whiteSpace:"nowrap",
            }}>
              <span style={{width:6,height:6,borderRadius:"50%",background:col,flexShrink:0,display:"inline-block"}}/>
              <span style={{fontWeight:700,color:col}}>{p}</span>
              {date && <span style={{color:"#666",fontSize:9}}>
                {new Date(date).toLocaleDateString("en-GB",{day:"numeric",month:"short"})}
              </span>}
            </div>
          );
        })}
      </div>
    );
  }
  if (colId === "dayListed") return <span style={{color:"var(--txm)",fontSize:11}}>{l.dayListed || "—"}</span>;
  if (colId === "daySold")   return <span style={{color:"var(--txm)",fontSize:11}}>{l.daySold   || "—"}</span>;
  if (colId === "days")      return (
    <span style={{color:"var(--txm)"}}>
      {l.days != null ? `${l.days}d` : "—"}
    </span>
  );
  if (colId === "shipped") {
    if (!l.sold) return <span style={{color:"var(--txd)"}}>—</span>;
    return (
      <button
        className={`btn btn-xs ${l.shipped ? "btn-g" : "btn-o"}`}
        onClick={e => { e.stopPropagation(); onShipToggle(l.sku); }}
        style={{padding:"3px 8px",fontSize:10}}
      >
        {l.shipped ? "✓ Sent" : "Ship"}
      </button>
    );
  }
  return "—";
}

/* ═══════════════════════════════════════════════════════════════
   LISTINGS — Add Listing Modal (Command 4 — full implementation)
═══════════════════════════════════════════════════════════════ */
function AddListingModal({ listings, stockData, onAdd, onClose }) {
  const nextSku = getNextSku(listings);
  const [form, setForm] = useState({
    bundleSku:  stockData[0]?.bundleSku || "",
    brand:      "",
    type:       "",
    colour:     "",
    size:       "",
    desc:       "",
    length:     "",
    pitToPit:   "",
    sku:        nextSku,
    price:      "",
    listed:     false,
    dayListed:  getToday(),
    photoUrl:   "",
    notes:      "",
    platform:   null,
    platforms:  [],
  });
  const [errors, setErrors] = useState({});

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // When bundle changes, auto-fill stock details
  const handleBundleChange = (bsku) => {
    const stock = stockData.find(s => s.bundleSku === bsku);
    if (stock) {
      setForm(p => ({
        ...p,
        bundleSku: bsku,
        price: stock.costPer ? String(stock.costPer) : p.price,
        // Only fill name/brand if currently empty
        brand: p.brand || stock.brand || "",
        type:  p.type  || stock.type  || "",
      }));
    } else {
      set("bundleSku", bsku);
    }
  };

  // When bundle changes, auto-suggest cost from stock
  const selectedStock = stockData.find(s => s.bundleSku === form.bundleSku);

  const validate = () => {
    const e = {};
    if (!form.colour.trim()) e.colour = true;
    if (!form.size.trim())   e.size   = true;
    if (!form.sku.trim())    e.sku    = true;
    if (!form.price)         e.price  = true;
    setErrors(e);
    return !Object.keys(e).length;
  };

  const handleAdd = () => {
    if (!validate()) return;
    const stock = stockData.find(s => s.bundleSku === form.bundleSku);
    onAdd({
      bundleSku:  form.bundleSku,
      name:       stock?.name || "",
      brand:      form.brand.trim(),
      type:       form.type.trim(),
      colour:     form.colour.trim(),
      size:       form.size.trim(),
      desc:       form.desc.trim(),
      length:     form.length.trim(),
      pitToPit:   form.pitToPit.trim(),
      listed:     form.listed,
      sku:        form.sku.trim().toUpperCase(),
      price:      parseFloat(form.price) || 0,
      sold:       false,
      soldPrice:  null,
      profit:     null,
      notes:      form.notes.trim(),
      platform:   form.platform || null,
      dayListed:  form.listed ? (form.dayListed || getToday()) : null,
      daySold:    null,
      days:       null,
      shipped:    false,
      shippedDate:null,
      photoUrl:   form.photoUrl.trim(),
    });
    onClose();
  };

  const err = (k) => errors[k] ? { borderColor:"var(--ac)" } : {};

  return (
    <div className="overlay">
      <div className="modal">
        <div className="mh">
          <div>
            <div className="mh-title">Add New Listing</div>
            <div className="mh-sub">Next SKU: {nextSku}</div>
          </div>
          <button className="mh-close" onClick={onClose}>✕</button>
        </div>
        <div className="mb">

          {/* Bundle */}
          <div className="fr">
            <label className="fl">Stock Bundle</label>
            <select className="fsel" value={form.bundleSku}
              onChange={e => handleBundleChange(e.target.value)}>
              {stockData.map(s => (
                <option key={`${s.bundleSku}-${s.name}`} value={s.bundleSku}>
                  {s.bundleSku} — {s.name}
                </option>
              ))}
            </select>
          </div>
          {selectedStock && (
            <div style={{fontSize:11,color:"var(--txm)",marginTop:-6,marginBottom:10,display:"flex",gap:10,flexWrap:"wrap"}}>
              <span>📦 <strong>{selectedStock.name}</strong></span>
              <span>Cost/pc: <strong>{fmt(selectedStock.costPer)}</strong></span>
              <span>Remaining to list: <strong>{selectedStock.sellable - (selectedStock.qtySold||0)} items</strong></span>
            </div>
          )}

          {/* Item details */}
          <div className="fr2">
            <div className="fr">
              <label className="fl">Brand</label>
              <input className="finp" placeholder="e.g. Ralph Lauren"
                value={form.brand} onChange={e=>set("brand",e.target.value)} />
            </div>
            <div className="fr">
              <label className="fl">Type</label>
              <ComboSelect value={form.type} onChange={v=>set("type",v)} options={DEFAULT_TYPES} placeholder="type" />
            </div>
          </div>
          <div className="fr2">
            <div className="fr">
              <label className="fl">Colour {errors.colour && <span style={{color:"var(--ac)"}}>*</span>}</label>
              <ComboSelect value={form.colour} onChange={v=>set("colour",v)} options={DEFAULT_COLOURS} placeholder="colour" />
            </div>
            <div className="fr">
              <label className="fl">Size {errors.size && <span style={{color:"var(--ac)"}}>*</span>}</label>
              <ComboSelect value={form.size} onChange={v=>set("size",v)} options={DEFAULT_SIZES} placeholder="size" />
            </div>
          </div>
          <div className="fr">
            <label className="fl">Description</label>
            <textarea className="fta" style={{minHeight:50}}
              placeholder="Condition notes, style details…"
              value={form.desc} onChange={e=>set("desc",e.target.value)} />
          </div>
          <div className="fr2">
            <div className="fr">
              <label className="fl">Length</label>
              <input className="finp" placeholder="e.g. 68cm"
                value={form.length} onChange={e=>set("length",e.target.value)} />
            </div>
            <div className="fr">
              <label className="fl">Pit to Pit</label>
              <input className="finp" placeholder="e.g. 52cm"
                value={form.pitToPit} onChange={e=>set("pitToPit",e.target.value)} />
            </div>
          </div>

          {/* Pricing */}
          <div className="fr2">
            <div className="fr">
              <label className="fl">SKU {errors.sku && <span style={{color:"var(--ac)"}}>*</span>}</label>
              <input className="finp" value={form.sku}
                onChange={e=>set("sku",e.target.value.toUpperCase())} style={err("sku")} />
            </div>
            <div className="fr">
              <label className="fl">
                Cost Price £ {errors.price && <span style={{color:"var(--ac)"}}>*</span>}
                {selectedStock && <span style={{color:"var(--gn)",fontWeight:600,textTransform:"none",marginLeft:4}}>← auto-filled from bundle</span>}
              </label>
              <input className="finp" type="number" step="0.01"
                placeholder={selectedStock ? String(selectedStock.costPer) : "0.00"}
                value={form.price} onChange={e=>set("price",e.target.value)} style={err("price")} />
            </div>
          </div>

          {/* Platform + dates */}
          <div className="fr">
            <label className="fl">Platforms (if already live)</label>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginTop:4}}>
              {MARK_LISTED_PLATS.map(p => {
                const isSelected = (form.platforms||[]).includes(p);
                return (
                  <button key={p}
                    onClick={() => {
                      const current = form.platforms||[];
                      const next = current.includes(p) ? current.filter(x=>x!==p) : [...current,p];
                      set("platforms", next);
                      set("platform", next[0]||null);
                    }}
                    style={{
                      padding:"6px 4px",fontSize:10,fontWeight:700,textAlign:"center",
                      border:`1.5px solid ${isSelected?"var(--ac)":"var(--bd)"}`,
                      borderRadius:"var(--r)",cursor:"pointer",
                      background:isSelected?"var(--acl)":"var(--sf2)",
                      color:isSelected?"var(--ac)":"var(--txm)",
                    }}
                  >{p}{isSelected?" ✓":""}</button>
                );
              })}
            </div>
          </div>
          <div className="fr2">
            <div className="fr">
              <label className="fl">Day Listed</label>
              <input className="finp" type="date" value={form.dayListed}
                onChange={e=>set("dayListed",e.target.value)} />
            </div>
            <div className="fr">
              <label className="fl">Photo URL</label>
              <input className="finp" placeholder="https://…"
                value={form.photoUrl} onChange={e=>set("photoUrl",e.target.value)} />
            </div>
          </div>

          {/* Status */}
          <div className="frow-chk">
            <label className="fchk">
              <input type="checkbox" checked={form.listed}
                onChange={e=>set("listed",e.target.checked)} />
              Listed — tick once it goes live on a platform
            </label>
          </div>

          {Object.keys(errors).length > 0 && (
            <div style={{marginTop:10,fontSize:11,color:"var(--ac)",fontWeight:700}}>
              Please fill in all required fields marked with *
            </div>
          )}
        </div>
        <div className="mf">
          <button className="btn btn-o btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-p btn-sm" onClick={handleAdd}>Add Listing →</button>
        </div>
      </div>
    </div>
  );
}


const SORTABLE_LISTING_COLS = new Set(["sku","price","soldPrice","profit","days","dayListed","daySold"]);

function ListingsTab({ listings, setListings, stockData }) {
  const [cols,         setCols]        = useState(DEFAULT_COLS);
  const [showColPanel, setShowColPanel]= useState(false);
  const [showAdd,      setShowAdd]     = useState(false);
  const [activeTab,    setActiveTab]   = useState("all");
  const [showSold,     setShowSold]    = useState(true);
  const [editListing,  setEditListing] = useState(null);
  const [search,       setSearch]      = useState("");
  const [bundleFilter, setBundleFilter]= useState("All");
  const [platFilter,   setPlatFilter]  = useState("All");
  const [sizeFilter,   setSizeFilter]  = useState("All");
  const [sortCol,      setSortCol]     = useState(null);
  const [sortDir,      setSortDir]     = useState("asc");
  const [selected,     setSelected]    = useState(new Set());

  /* Column filter hook — runs on the full listings array */
  const {
    filtered: colFiltered,
    filters: colFilters, setFilter: setColFilter,
    clearFilter: clearColFilter, clearAll: clearColAll,
    activeFilters: activeColFilters,
    showPanel: showFilterPanel, setShowPanel: setShowFilterPanel,
    btnRef: filterBtnRef,
  } = useTableFilters(listings, cols);

  /* Tab counts — always from full listings */
  const counts = useMemo(() => ({
    all:      listings.length,
    active:   listings.filter(l => l.listed && !l.sold).length,
    sold:     listings.filter(l => l.sold).length,
    unlisted: listings.filter(l => !l.listed && !l.sold).length,
  }), [listings]);

  /* Filtered + sorted rows — chains after column filters */
  const rows = useMemo(() => {
    let d = [...colFiltered];

    // Tab filter
    if (activeTab === "active")   d = d.filter(l => l.listed && !l.sold);
    if (activeTab === "sold")     d = d.filter(l => l.sold);
    if (activeTab === "unlisted") d = d.filter(l => !l.listed && !l.sold);
    if (activeTab === "all" && !showSold) d = d.filter(l => !l.sold);

    // Search
    if (search.trim()) {
      const s = search.toLowerCase();
      d = d.filter(l =>
        l.sku.toLowerCase().includes(s) ||
        l.name.toLowerCase().includes(s) ||
        l.brand.toLowerCase().includes(s) ||
        l.colour.toLowerCase().includes(s) ||
        (l.platform && l.platform.toLowerCase().includes(s)) ||
        (l.notes && l.notes.toLowerCase().includes(s)) ||
        l.type.toLowerCase().includes(s)
      );
    }

    // Dropdown filters
    if (bundleFilter !== "All") d = d.filter(l => l.bundleSku === bundleFilter);
    if (platFilter   !== "All") d = d.filter(l => l.platform === platFilter);
    if (sizeFilter   !== "All") d = d.filter(l => l.size === sizeFilter);

    // Sort
    if (sortCol) {
      d = [...d].sort((a, b) => {
        const av = a[sortCol], bv = b[sortCol];
        if (av == null) return 1;
        if (bv == null) return -1;
        const res = typeof av === "number" ? av - bv : String(av).localeCompare(String(bv));
        return sortDir === "asc" ? res : -res;
      });
    }
    return d;
  }, [colFiltered, activeTab, showSold, search, bundleFilter, platFilter, sizeFilter, sortCol, sortDir]);

  const visCols = cols.filter(c => c.visible);
  const { getStyle: getColStyle, onMouseDown: onColResize } = useColWidths(cols);
  const tblZoom = useZoom(100);

  const onSort = (col) => {
    if (!SORTABLE_LISTING_COLS.has(col)) return;
    setSortDir(d => sortCol === col ? (d === "asc" ? "desc" : "asc") : "asc");
    setSortCol(col);
  };

  /* Selection helpers */
  const allSelected = rows.length > 0 && rows.every(l => selected.has(l.sku));
  const toggleAll   = () => setSelected(allSelected ? new Set() : new Set(rows.map(l => l.sku)));
  const toggleOne   = (sku) => setSelected(prev => {
    const next = new Set(prev);
    next.has(sku) ? next.delete(sku) : next.add(sku);
    return next;
  });

  /* Bulk actions */
  const bulkMarkSold = () => {
    setListings(prev => prev.map(l => {
      if (!selected.has(l.sku) || l.sold) return l;
      const days = l.dayListed
        ? Math.max(0, Math.floor((new Date(TODAY) - new Date(l.dayListed)) / 86400000))
        : 0;
      return { ...l, sold:true, daySold:getToday(), days };
    }));
    setSelected(new Set());
  };

  const bulkMarkShipped = () => {
    setListings(prev => prev.map(l => {
      if (!selected.has(l.sku) || !l.sold || l.shipped) return l;
      return { ...l, shipped:true, shippedDate:TODAY };
    }));
    setSelected(new Set());
  };

  /* Inline ship toggle */
  const toggleShip = (sku) => {
    setListings(prev => prev.map(l =>
      l.sku === sku
        ? { ...l, shipped:!l.shipped, shippedDate:!l.shipped ? TODAY : null }
        : l
    ));
  };

  /* Unique values for filter dropdowns */
  const bundleSkus = useMemo(() =>
    [...new Set(stockData.map(s => s.bundleSku))].sort(),
    [stockData]
  );
  const sizes = ["XS","S","M","L","XL","XXL","One Size"];

  return (
    <div>
      {/* Add Listing Modal */}
      {showAdd && (
        <AddListingModal
          listings={listings}
          stockData={stockData}
          onAdd={(newL) => {
            setListings(prev => [...prev, newL]);
            setShowAdd(false);
          }}
          onClose={() => setShowAdd(false)}
        />
      )}

      {editListing && (
        <EditListingDrawer
          listing={editListing}
          stockData={stockData}
          onSave={(updated) => {
            setListings(prev => prev.map(l => l.sku === updated.sku ? updated : l));
            setEditListing(null);
          }}
          onDelete={(sku) => {
            setListings(prev => prev.filter(l => l.sku !== sku));
            setEditListing(null);
          }}
          onClose={() => setEditListing(null)}
        />
      )}

      {/* ── Tab bar ── */}
      <div className="tab-bar">
        {[
          { id:"all",      label:"All Items" },
          { id:"active",   label:"Active"    },
          { id:"sold",     label:"Sold"      },
          { id:"unlisted", label:"To List"   },
        ].map(t => (
          <div
            key={t.id}
            className={`tab ${activeTab===t.id?"active":""}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
            <span className="tc">{counts[t.id]}</span>
          </div>
        ))}

        {/* Right-side controls */}
        <div style={{marginLeft:"auto",display:"flex",gap:7,alignItems:"center",paddingBottom:8,flexWrap:"wrap",justifyContent:"flex-end"}}>
          <div style={{position:"relative"}}>
            <button className="btn btn-o btn-sm" onClick={()=>setShowColPanel(v=>!v)}>⚙ Columns</button>
            {showColPanel && (
              <ColPanel cols={cols} setCols={setCols} onClose={()=>setShowColPanel(false)} />
            )}
          </div>
          <button className="btn btn-p btn-sm" onClick={()=>setShowAdd(true)}>+ Add Listing</button>
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div className="filter-bar">
        <div className="sw">
          <span className="si">⌕</span>
          <input
            className="fi"
            placeholder="SKU, brand, colour, platform…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <select className="fs" value={bundleFilter} onChange={e=>setBundleFilter(e.target.value)}>
          <option value="All">All Bundles</option>
          {bundleSkus.map(b => (
            <option key={b} value={b}>
              {b} — {stockData.find(s=>s.bundleSku===b)?.name || ""}
            </option>
          ))}
        </select>

        <select className="fs" value={platFilter} onChange={e=>setPlatFilter(e.target.value)}>
          <option value="All">All Platforms</option>
          {PLATFORMS.map(p => <option key={p}>{p}</option>)}
        </select>

        <select className="fs" value={sizeFilter} onChange={e=>setSizeFilter(e.target.value)}>
          <option value="All">All Sizes</option>
          {sizes.map(s => <option key={s}>{s}</option>)}
        </select>

        {activeTab === "all" && (
          <button
            className={`tog-btn ${showSold?"on":""}`}
            onClick={()=>setShowSold(v=>!v)}
          >
            <span className="tog-dot"/>
            {showSold ? "Sold visible" : "Sold hidden"}
          </button>
        )}

        {(search || bundleFilter!=="All" || platFilter!=="All" || sizeFilter!=="All") && (
          <button
            className="btn btn-o btn-sm"
            onClick={()=>{ setSearch(""); setBundleFilter("All"); setPlatFilter("All"); setSizeFilter("All"); }}
          >
            ✕ Clear
          </button>
        )}

        <div style={{display:"flex",gap:7,alignItems:"center",flexWrap:"wrap",flexShrink:0,marginLeft:"auto"}}>
          <span style={{fontSize:11,color:"var(--txd)"}}>
            {rows.length} row{rows.length!==1?"s":""}
            {rows.length<listings.length?" (filtered)":""}
          </span>
          <div style={{position:"relative"}}>
            <button className="btn btn-o btn-sm" ref={filterBtnRef} onClick={()=>setShowFilterPanel(v=>!v)}>
              ⚡ Filters {activeColFilters.length>0 && <span style={{background:"var(--ac)",color:"#fff",borderRadius:10,padding:"0 5px",fontSize:9,marginLeft:3}}>{activeColFilters.length}</span>}
            </button>
            {showFilterPanel && (
              <FilterPanel colDefs={cols} rows={listings}
                filters={colFilters} setFilter={setColFilter}
                clearAll={clearColAll} onClose={()=>setShowFilterPanel(false)} anchorRef={filterBtnRef} />
            )}
          </div>
          <button className="btn btn-o btn-sm"
            onClick={()=>exportToCSV(rows, cols, `listings_${activeTab}`)}>
            ↓ CSV
          </button>
        </div>
      </div>

      <FilterChips colDefs={cols} activeFilters={activeColFilters} clearFilter={clearColFilter} clearAll={clearColAll} />

      {/* ── Table ── */}
      <div className="tw">
        <ZoomBar {...tblZoom} />
        <div className="ts">
          <div style={tblZoom.style()}>
          <table className="tbl">
            <thead>
              <tr>
                {/* Select-all checkbox in header */}
                <th className="no-sort" style={{width:32,paddingRight:4}}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    style={{cursor:"pointer",accentColor:"var(--ac)"}}
                  />
                </th>
                {visCols.filter(c=>c.id!=="sel").map(c => {
                  const sortable = SORTABLE_LISTING_COLS.has(c.id);
                  const colStyle = { ...getColStyle(c.id), minWidth: c.minW||80 };
                  return sortable
                    ? <STh key={c.id} col={c.id} sortCol={sortCol} sortDir={sortDir} onSort={onSort} style={colStyle} onResize={onColResize}>{c.label}</STh>
                    : <th key={c.id} className="no-sort" style={colStyle}><span>{c.label}</span><span className="col-resize" onMouseDown={e=>onColResize(e,c.id,e.currentTarget.parentElement)} onClick={e=>e.stopPropagation()}/></th>;
                })}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={visCols.length + 1}
                    style={{textAlign:"center",padding:"32px",color:"var(--txd)"}}
                  >
                    No listings match your filters.
                  </td>
                </tr>
              ) : rows.map(l => {
                const isSel  = selected.has(l.sku);
                const rowCls = [
                  "clickable",
                  l.sold              ? "sold-r"   : "",
                  l.listed && !l.sold ? "listed-r"  : "",
                  isSel               ? "sel"       : "",
                ].filter(Boolean).join(" ");

                return (
                  <tr
                    key={l.sku}
                    className={rowCls}
                    onClick={() => setEditListing(l)}
                  >
                    {/* Checkbox cell — separate from ColPanel (always shown) */}
                    <td onClick={e=>e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={()=>toggleOne(l.sku)}
                        style={{cursor:"pointer",accentColor:"var(--ac)"}}
                      />
                    </td>
                    {visCols.filter(c=>c.id!=="sel").map(c => (
                      <td key={c.id}>
                        <ListingCell
                          colId={c.id}
                          l={l}
                          onShipToggle={toggleShip}
                          onSelect={()=>toggleOne(l.sku)}
                          selected={isSel}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>{/* end zoom wrap */}
        </div>{/* end .ts */}
      </div>{/* end .tw */}

      {/* ── Floating bulk action bar ── */}
      {selected.size > 0 && (
        <div className="float-bar">
          <span className="fb-count">{selected.size} selected</span>
          <button className="fb-btn" onClick={bulkMarkSold}>✓ Mark Sold</button>
          <button className="fb-btn" onClick={bulkMarkShipped}>📦 Mark Shipped</button>
          <button
            className="fb-btn fb-clear"
            onClick={() => setSelected(new Set())}
          >
            ✕ Clear
          </button>
        </div>
      )}
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   SHARED — Column-aware filter system
═══════════════════════════════════════════════════════════════ */
function useTableFilters(rows, colDefs) {
  const [filters, setFilters] = useState({});     // { colId: filterValue }
  const [showPanel, setShowPanel] = useState(false);

  const setFilter = (colId, val) =>
    setFilters(prev => ({ ...prev, [colId]: val }));

  const clearFilter = (colId) =>
    setFilters(prev => { const n={...prev}; delete n[colId]; return n; });

  const clearAll = () => setFilters({});

  const activeFilters = Object.entries(filters).filter(([,v]) => {
    if (v === null || v === undefined || v === "") return false;
    if (typeof v === "object") {
      return Object.values(v).some(x => x !== "" && x !== null && x !== undefined);
    }
    return true;
  });

  const filtered = useMemo(() => {
    if (!activeFilters.length) return rows;
    return rows.filter(row => {
      return activeFilters.every(([colId, fv]) => {
        const cell = row[colId];
        if (fv === null || fv === undefined || fv === "") return true;
        // Range filter { min, max }
        if (typeof fv === "object" && !Array.isArray(fv)) {
          const n = parseFloat(cell);
          if (isNaN(n)) return true;
          if (fv.min !== "" && fv.min !== undefined && n < parseFloat(fv.min)) return false;
          if (fv.max !== "" && fv.max !== undefined && n > parseFloat(fv.max)) return false;
          return true;
        }
        // Boolean filter "yes" / "no"
        if (fv === "yes") return !!cell;
        if (fv === "no")  return !cell;
        // Text / select contains
        return String(cell ?? "").toLowerCase().includes(String(fv).toLowerCase());
      });
    });
  }, [rows, filters]);

  const btnRef = useRef(null);

  return { filtered, filters, setFilter, clearFilter, clearAll, activeFilters, showPanel, setShowPanel, btnRef };
}

/* ── Filter panel component ── */
function FilterPanel({ colDefs, rows, filters, setFilter, clearAll, onClose, anchorRef }) {
  // Determine filter type from col id
  const getType = (id) => {
    if (["listed","sold","shipped","restock","imported"].includes(id)) return "bool";
    if (["price","soldPrice","profit","days","sellThru","costPer","totalCost",
         "totalProfit","netProceeds","stockValLeft","avgSoldPrice","avgProfit",
         "qtySold","qtyRemaining","qtyListed","qtyToBeListed","received","sellable","p7","p14","p21","p28","p35","p42","avgDays"].includes(id)) return "range";
    if (["dayListed","daySold","datePurchased","dateArrived"].includes(id)) return "daterange";
    return "text";
  };

  const getUnique = (id) =>
    [...new Set(rows.map(r => r[id]).filter(v => v != null && v !== ""))].sort();

  const visibleCols = colDefs.filter(c =>
    c.visible !== false && c.id !== "sel" && c.id !== "photo" && c.id !== "actions"
  );

  // Calculate position from anchor button
  const [pos, setPos] = useState({ top: 60, right: 16 });
  useEffect(() => {
    if (anchorRef?.current) {
      const r = anchorRef.current.getBoundingClientRect();
      const panelW = 320;
      const left = Math.min(r.right - panelW, window.innerWidth - panelW - 8);
      setPos({ top: r.bottom + 4, left: Math.max(8, left) });
    }
  }, []);

  return (
    <>
      {/* Backdrop to catch outside clicks */}
      <div style={{position:"fixed",inset:0,zIndex:199}} onClick={onClose} />
      <div style={{
        position:"fixed",
        top: pos.top, left: pos.left,
        background:"var(--sf)", border:"1px solid var(--bd)",
        borderRadius:"var(--r2)", padding:14, boxShadow:"0 8px 32px rgba(0,0,0,.18)",
        zIndex:200, width:320, maxHeight:"70vh", overflowY:"auto",
      }}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".6px",color:"var(--txm)"}}>
          Column Filters
        </div>
        <div style={{display:"flex",gap:7}}>
          <button className="btn btn-o btn-xs" onClick={clearAll}>Clear All</button>
          <button className="btn btn-o btn-xs" onClick={onClose}>✕</button>
        </div>
      </div>

      {visibleCols.map(col => {
        const type = getType(col.id);
        const fv   = filters[col.id];

        return (
          <div key={col.id} style={{marginBottom:10}}>
            <div style={{fontSize:10,fontWeight:700,color:"var(--txm)",textTransform:"uppercase",letterSpacing:".5px",marginBottom:3}}>
              {col.label || col.id}
            </div>

            {type === "bool" && (
              <select className="fsel" style={{width:"100%",fontSize:12}}
                value={fv||"all"}
                onChange={e => setFilter(col.id, e.target.value === "all" ? "" : e.target.value)}>
                <option value="all">All</option>
                <option value="yes">Yes ✓</option>
                <option value="no">No ○</option>
              </select>
            )}

            {type === "range" && (
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                <input className="finp" type="number" placeholder="Min"
                  style={{fontSize:12}}
                  value={fv?.min ?? ""}
                  onChange={e => setFilter(col.id, { ...(fv||{}), min: e.target.value })} />
                <input className="finp" type="number" placeholder="Max"
                  style={{fontSize:12}}
                  value={fv?.max ?? ""}
                  onChange={e => setFilter(col.id, { ...(fv||{}), max: e.target.value })} />
              </div>
            )}

            {type === "daterange" && (
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                <input className="finp" type="date" style={{fontSize:12}}
                  value={fv?.min ?? ""}
                  onChange={e => setFilter(col.id, { ...(fv||{}), min: e.target.value })} />
                <input className="finp" type="date" style={{fontSize:12}}
                  value={fv?.max ?? ""}
                  onChange={e => setFilter(col.id, { ...(fv||{}), max: e.target.value })} />
              </div>
            )}

            {type === "text" && (() => {
              const unique = getUnique(col.id);
              // Use select if ≤20 unique values, else text input
              if (unique.length > 0 && unique.length <= 20) {
                return (
                  <select className="fsel" style={{width:"100%",fontSize:12}}
                    value={fv||""}
                    onChange={e => setFilter(col.id, e.target.value)}>
                    <option value="">All</option>
                    {unique.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                );
              }
              return (
                <input className="finp" type="text" placeholder="Contains…"
                  style={{fontSize:12}}
                  value={fv||""}
                  onChange={e => setFilter(col.id, e.target.value)} />
              );
            })()}
          </div>
        );
      })}
    </div>
    </>
  );
}
function FilterChips({ colDefs, activeFilters, clearFilter, clearAll }) {
  if (!activeFilters.length) return null;
  const getLabel = (id) => colDefs.find(c => c.id === id)?.label || id;
  const getChipText = (id, fv) => {
    if (typeof fv === "object") {
      const parts = [];
      if (fv.min !== "" && fv.min != null) parts.push(`≥ ${fv.min}`);
      if (fv.max !== "" && fv.max != null) parts.push(`≤ ${fv.max}`);
      return parts.join(" ");
    }
    if (fv === "yes") return "Yes";
    if (fv === "no")  return "No";
    return String(fv);
  };

  return (
    <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:10,alignItems:"center"}}>
      {activeFilters.map(([id, fv]) => (
        <div key={id} style={{
          display:"inline-flex",alignItems:"center",gap:5,
          background:"var(--acl)",border:"1px solid var(--ac2)",
          borderRadius:20,padding:"2px 8px",fontSize:11,color:"var(--ac)",
        }}>
          <span style={{fontWeight:700}}>{getLabel(id)}:</span>
          <span>{getChipText(id, fv)}</span>
          <button onClick={() => clearFilter(id)} style={{
            background:"none",border:"none",cursor:"pointer",
            color:"var(--ac)",fontSize:12,lineHeight:1,padding:"0 1px",fontWeight:900,
          }}>×</button>
        </div>
      ))}
      {clearAll && (
        <button
          onClick={clearAll}
          style={{
            fontSize:11,fontWeight:700,color:"var(--txm)",
            background:"var(--sf2)",border:"1px solid var(--bdd)",
            borderRadius:20,padding:"2px 10px",cursor:"pointer",
          }}
        >↺ Clear all filters</button>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MOVEMENT TRACKER COLS
═══════════════════════════════════════════════════════════════ */
const MOVEMENT_COLS = [
  {id:"name",    label:"Stock Name",  visible:true },
  {id:"type",    label:"Type",        visible:true },
  {id:"brand",   label:"Brand",       visible:true },
  {id:"tag",     label:"Tag",         visible:true },
  {id:"avgDays", label:"Avg Days",    visible:true },
  {id:"avgPrice",label:"Avg List £",  visible:true },
  {id:"avgSold", label:"Avg Sold £",  visible:true },
  {id:"p7",      label:"%7d",         visible:true },
  {id:"p14",     label:"%14d",        visible:true },
  {id:"p21",     label:"%21d",        visible:false},
  {id:"p28",     label:"%28d",        visible:false},
  {id:"p35",     label:"%35d",        visible:false},
  {id:"p42",     label:"%42d",        visible:true },
  {id:"howManySold",label:"Sold",     visible:true },
  {id:"total",   label:"Listed (All)",visible:true },
  {id:"notSold", label:"Unsold",      visible:true },
];

/* ═══════════════════════════════════════════════════════════════
   MOVEMENT TRACKER
═══════════════════════════════════════════════════════════════ */
function MovementTracker({ listings }) {
  const [cols, setCols]               = useState(MOVEMENT_COLS);
  const [showColPanel, setShowColPanel] = useState(false);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const filterBtnRef = useRef(null);
  const [sortCol, setSortCol]         = useState("howManySold");
  const [sortDir, setSortDir]         = useState("desc");
  const movZoom = useZoom(100);

  const groups = useMemo(() => {
    const map = {};
    listings.filter(l => l.listed).forEach(l => {
      const k = `${l.name}||${l.type}||${l.brand}`;
      if (!map[k]) map[k] = { name:l.name, type:l.type, brand:l.brand, items:[] };
      map[k].items.push(l);
    });
    return Object.values(map).map(g => {
      const sold = g.items.filter(l => l.sold && l.days !== null);
      const t    = g.items.length;
      const p    = (n) => t ? Math.round(sold.filter(l => l.days <= n).length / t * 100) : 0;
      const tag  = getTag(g.name, g.type, g.brand, listings);
      const avgDays  = sold.length ? sold.reduce((a,l) => a+l.days, 0) / sold.length : null;
      const avgPrice = t ? g.items.reduce((a,l) => a+l.price, 0) / t : 0;
      const avgSold  = sold.length ? sold.reduce((a,l) => a+(l.soldPrice||0), 0) / sold.length : 0;
      return {
        name:g.name, type:g.type, brand:g.brand, tag,
        avgDays, avgPrice, avgSold,
        p7:p(7), p14:p(14), p21:p(21), p28:p(28), p35:p(35), p42:p(42),
        howManySold:sold.length, total:t,
        notSold:g.items.filter(l=>!l.sold).length,
      };
    });
  }, [listings]);

  const {
    filtered, filters, setFilter, clearFilter, clearAll, activeFilters,
  } = useTableFilters(groups, cols);

  const sorted = useMemo(() => {
    if (!sortCol) return filtered;
    return [...filtered].sort((a,b) => {
      const av=a[sortCol], bv=b[sortCol];
      if (av==null) return 1; if (bv==null) return -1;
      const res = typeof av==="number" ? av-bv : String(av).localeCompare(String(bv));
      return sortDir==="asc" ? res : -res;
    });
  }, [filtered, sortCol, sortDir]);

  const onSort = (col) => {
    setSortDir(d => sortCol===col ? (d==="asc"?"desc":"asc") : "desc");
    setSortCol(col);
  };

  const visCols = cols.filter(c => c.visible);

  const renderCell = (col, row) => {
    if (col==="name")     return <span style={{fontWeight:700}}>{row.name}</span>;
    if (col==="type")     return <span className="badge b-0">{row.type}</span>;
    if (col==="brand")    return <span style={{color:"var(--txm)"}}>{row.brand}</span>;
    if (col==="tag")      return <MovTag tag={row.tag} />;
    if (col==="avgDays")  return row.avgDays!=null ? <strong>{row.avgDays.toFixed(1)}d</strong> : <span style={{color:"var(--txd)"}}>—</span>;
    if (col==="avgPrice") return fmt(row.avgPrice);
    if (col==="avgSold")  return row.avgSold ? <span style={{color:"var(--gn)",fontWeight:700}}>{fmt(row.avgSold)}</span> : <span style={{color:"var(--txd)"}}>—</span>;
    if (col==="howManySold") return <span style={{fontWeight:900,color:"var(--gn)"}}>{row.howManySold}</span>;
    if (col==="total")    return row.total;
    if (col==="notSold")  return <span style={{color:"var(--txm)"}}>{row.notSold}</span>;
    // Percentage columns
    const pct = row[col];
    if (pct === undefined) return "—";
    return pct
      ? <span style={{fontWeight:700,color:pct>=60?"var(--gn)":pct>=30?"var(--am)":"var(--ac)"}}>{pct}%</span>
      : <span style={{color:"var(--txd)"}}>—</span>;
  };

  return (
    <div>
      <div className="filter-bar">
        <div style={{flex:1}} />
        <div style={{position:"relative"}}>
          <button className="btn btn-o btn-sm" ref={filterBtnRef} onClick={()=>setShowFilterPanel(v=>!v)}>
            ⚡ Filters {activeFilters.length>0 && <span style={{background:"var(--ac)",color:"#fff",borderRadius:10,padding:"0 5px",fontSize:9,marginLeft:3}}>{activeFilters.length}</span>}
          </button>
          {showFilterPanel && (
            <FilterPanel colDefs={cols} rows={groups}
              filters={filters} setFilter={setFilter} clearAll={clearAll}
              onClose={()=>setShowFilterPanel(false)} anchorRef={filterBtnRef} />
          )}
        </div>
        <div style={{position:"relative"}}>
          <button className="btn btn-o btn-sm" onClick={()=>setShowColPanel(v=>!v)}>⚙ Columns</button>
          {showColPanel && <ColPanel cols={cols} setCols={setCols} onClose={()=>setShowColPanel(false)} />}
        </div>
        <button className="btn btn-o btn-sm"
          onClick={()=>exportToCSV(sorted, cols, "movement_tracker")}>
          ↓ CSV
        </button>
      </div>


      <FilterChips colDefs={cols} activeFilters={activeFilters} clearFilter={clearFilter} clearAll={clearAll} />

      <div className="sh">
        <div className="st">
          Movement Tracker
          <span className="ss">{sorted.length} groups · Name / Type / Brand</span>
        </div>
        <div style={{fontSize:11,color:"var(--txd)"}}>Click headers to sort</div>
      </div>

      <div className="tw">
        <ZoomBar {...movZoom} />
        <div className="ts">
          <div style={movZoom.style()}>
          <table className="tbl">
            <thead>
              <tr>
                {visCols.map(c => (
                  <STh key={c.id} col={c.id} sortCol={sortCol} sortDir={sortDir} onSort={onSort}>
                    {c.label}
                  </STh>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.length===0 ? (
                <tr><td colSpan={visCols.length} style={{textAlign:"center",padding:28,color:"var(--txd)"}}>No groups match filters.</td></tr>
              ) : sorted.map((row,i) => (
                <tr key={i}>
                  {visCols.map(c => <td key={c.id}>{renderCell(c.id, row)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      </div>

      <div style={{marginTop:8,padding:"8px 12px",background:"var(--sf2)",border:"1px solid var(--bd)",borderRadius:"var(--r)",fontSize:11,color:"var(--txm)"}}>
        <strong style={{color:"var(--tx)"}}>Tag rules:</strong>&nbsp;
        <span style={{color:"#155c2a",fontWeight:700}}>FAST</span> = 60%+ in 7d or 80%+ in 14d &nbsp;·&nbsp;
        <span style={{color:"#7a4e0e",fontWeight:700}}>MEDIUM</span> = 50%+ in 14d &nbsp;·&nbsp;
        <span style={{color:"var(--ac)",fontWeight:700}}>SLOW</span> = &lt;50% by 30d &nbsp;·&nbsp;
        <span style={{color:"#7a1020",fontWeight:700}}>DEAD</span> = sold some but none within 42d &nbsp;·&nbsp;
        <span style={{color:"#2a4a9a",fontWeight:700}}>NEW</span> = 1–2 sold, too early to classify &nbsp;·&nbsp;
        <strong>UNKNOWN</strong> = 0 sold yet
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   LISTING DATA COLS
═══════════════════════════════════════════════════════════════ */
const TOLIST_COLS = [
  {id:"sku",     label:"SKU",        visible:true },
  {id:"name",    label:"Stock Name", visible:true },
  {id:"type",    label:"Type",       visible:true },
  {id:"brand",   label:"Brand",      visible:true },
  {id:"colour",  label:"Colour",     visible:true },
  {id:"size",    label:"Size",       visible:true },
  {id:"tag",     label:"Mover",      visible:true },
  {id:"bundleSku",label:"Bundle",    visible:false},
];

const ACTIVE_COLS = [
  {id:"sku",      label:"SKU",       visible:true },
  {id:"name",     label:"Stock Name",visible:true },
  {id:"type",     label:"Type",      visible:true },
  {id:"brand",    label:"Brand",     visible:true },
  {id:"colour",   label:"Colour",    visible:true },
  {id:"size",     label:"Size",      visible:true },
  {id:"price",    label:"Price",     visible:true },
  {id:"dayListed",label:"Listed On", visible:true },
  {id:"tag",      label:"Mover",     visible:true },
  {id:"bundleSku",label:"Bundle",    visible:false},
  {id:"platform", label:"Platform",  visible:false},
];

/* ═══════════════════════════════════════════════════════════════
   LISTING DATA TAB
═══════════════════════════════════════════════════════════════ */
function ListingDataTab({ listings }) {
  const [toListCols, setToListCols]   = useState(TOLIST_COLS);
  const [activeCols, setActiveCols]   = useState(ACTIVE_COLS);
  const [showToListCP,  setShowToListCP]  = useState(false);
  const [showActiveCP,  setShowActiveCP]  = useState(false);
  const activeZoom  = useZoom(100);
  const toListZoom  = useZoom(100);

  const active      = listings.filter(l => l.listed && !l.sold);
  const toBeListed  = listings.filter(l => !l.listed && !l.sold);
  // dayListed is set once (first listing) — cross-listing preserves it, so this correctly counts new listings only
  const addedThisWk = listings.filter(l => l.listed && l.dayListed && l.dayListed >= WEEK_START).length;

  // Attach mover tag to each item
  const withTag = (items) => items.map(l => ({
    ...l,
    tag: getTag(l.name, l.type, l.brand, listings),
  }));

  const taggedToList  = useMemo(() => withTag(toBeListed),  [toBeListed, listings]);
  const taggedActive  = useMemo(() => withTag(active),       [active, listings]);

  // Filter hooks for each table
  const toListF  = useTableFilters(taggedToList,  toListCols);
  const activeF  = useTableFilters(taggedActive,  activeCols);

  // By-tag breakdown
  const byTag = (arr, tag) => arr.filter(l => getTag(l.name,l.type,l.brand,listings)===tag).length;

  // Group by name+bundleSku so BDL-008 Detroit and BDL-008 Active show separately
  const byNameSku = (arr) => {
    const m={};
    arr.forEach(l => {
      const k = `${l.bundleSku}||${l.name}`;
      if(!m[k]) m[k]={name:l.name, bsku:l.bundleSku, count:0};
      m[k].count++;
    });
    return Object.values(m).sort((a,b)=>b.count-a.count);
  };

  const renderToListCell = (col, l) => {
    if (col==="sku")      return <span className="sku">{l.sku}</span>;
    if (col==="name")     return <span style={{fontWeight:600}}>{l.name}</span>;
    if (col==="type")     return <span className="badge b-0">{l.type}</span>;
    if (col==="brand")    return <span style={{color:"var(--txm)"}}>{l.brand}</span>;
    if (col==="colour")   return l.colour;
    if (col==="size")     return <span style={{color:"var(--txm)"}}>{l.size}</span>;
    if (col==="tag")      return <MovTag tag={l.tag} />;
    if (col==="bundleSku")return <span className="bsku">{l.bundleSku}</span>;
    return "—";
  };

  const renderActiveCell = (col, l) => {
    if (col==="sku")      return <span className="sku">{l.sku}</span>;
    if (col==="name")     return <span style={{fontWeight:600}}>{l.name}</span>;
    if (col==="type")     return <span className="badge b-0">{l.type}</span>;
    if (col==="brand")    return <span style={{color:"var(--txm)"}}>{l.brand}</span>;
    if (col==="colour")   return l.colour;
    if (col==="size")     return <span style={{color:"var(--txm)"}}>{l.size}</span>;
    if (col==="price")    return fmt(l.price);
    if (col==="dayListed")return <span style={{color:"var(--txm)",fontSize:11}}>{l.dayListed||"—"}</span>;
    if (col==="tag")      return <MovTag tag={l.tag} />;
    if (col==="bundleSku")return <span className="bsku">{l.bundleSku}</span>;
    if (col==="platform") return l.platform ? <span className="badge b-b">{l.platform}</span> : <span style={{color:"var(--txd)"}}>—</span>;
    return "—";
  };

  const TableSection = ({ title, subtitle, fHook, cols, setCols, showCP, setShowCP,
                          renderCell, exportName, zoom }) => {
    const visCols = cols.filter(c => c.visible);
    return (
      <div style={{marginTop:16}}>
        <div className="filter-bar" style={{paddingBottom:8}}>
          <div className="st">{title}<span className="ss">{subtitle}</span></div>
          <div style={{flex:1}}/>
          <div style={{position:"relative"}}>
            <button className="btn btn-o btn-sm" ref={fHook.btnRef} onClick={()=>fHook.setShowPanel(v=>!v)}>
              ⚡ Filters {fHook.activeFilters.length>0 && <span style={{background:"var(--ac)",color:"#fff",borderRadius:10,padding:"0 5px",fontSize:9,marginLeft:3}}>{fHook.activeFilters.length}</span>}
            </button>
            {fHook.showPanel && (
              <FilterPanel colDefs={cols} rows={fHook.filtered}
                filters={fHook.filters} setFilter={fHook.setFilter}
                clearAll={fHook.clearAll} onClose={()=>fHook.setShowPanel(false)} anchorRef={fHook.btnRef} />
            )}
          </div>
          <div style={{position:"relative"}}>
            <button className="btn btn-o btn-sm" onClick={()=>setShowCP(v=>!v)}>⚙ Columns</button>
            {showCP && <ColPanel cols={cols} setCols={setCols} onClose={()=>setShowCP(false)} />}
          </div>
          <button className="btn btn-o btn-sm"
            onClick={()=>exportToCSV(fHook.filtered, cols, exportName)}>
            ↓ CSV
          </button>
        </div>
        <FilterChips colDefs={cols} activeFilters={fHook.activeFilters} clearFilter={fHook.clearFilter} clearAll={fHook.clearAll} />
        <div className="tw">
          {zoom && <ZoomBar {...zoom} />}
          <div className="ts"><div style={zoom ? zoom.style() : {}}>
          <table className="tbl" style={{minWidth:"100%"}}>
            <thead>
              <tr>{visCols.map(c=><th key={c.id} className="no-sort" style={{minWidth:80}}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {fHook.filtered.length===0
                ? <tr><td colSpan={visCols.length} style={{textAlign:"center",padding:22,color:"var(--txd)"}}>No items match filters.</td></tr>
                : fHook.filtered.map(l=>(
                  <tr key={l.sku}>
                    {visCols.map(c=><td key={c.id}>{renderCell(c.id, l)}</td>)}
                  </tr>
                ))
              }
            </tbody>
          </table>
          </div></div>
        </div>
        <div style={{marginTop:6,fontSize:11,color:"var(--txd)",textAlign:"right"}}>
          {fHook.filtered.length} item{fHook.filtered.length!==1?"s":""}
          {fHook.activeFilters.length>0?" (filtered)":""}
        </div>
      </div>
    );
  };

  return (
    <div>
      {/* KPI Cards */}
      <div className="kg kg3">
        {[
          {l:"Active Listings",  v:active.length,     b:"",   s:"Currently live"},
          {l:"Added This Week",  v:addedThisWk,       b:"nv", s:`w/c ${WEEK_START}`},
          {l:"To Be Listed",     v:toBeListed.length, b:"am", s:"Ready to photograph & post"},
        ].map(k => (
          <div key={k.l} className="kc">
            <div className={`kb ${k.b}`}/>
            <div className="kl">{k.l}</div>
            <div className="kv">{k.v}</div>
            <div className="ks">{k.s}</div>
          </div>
        ))}
      </div>

      {/* Breakdowns — 3 columns desktop, stacked mobile */}
      <div className="ld-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:11,marginBottom:4}}>
        <div className="sc">
          <div className="st" style={{marginBottom:8}}>Active by Mover Tag</div>
          {[["FAST","mt-f"],["MEDIUM","mt-m"],["SLOW","mt-s"],["NEW","mt-n"],["UNKNOWN","mt-u"],["DEAD","mt-d"]].map(([tag,cls])=>(
            <div key={tag} className="sr">
              <span className={`mt ${cls}`}>{tag}</span>
              <span className="srv">{byTag(active,tag)}</span>
            </div>
          ))}
        </div>
        <div className="sc">
          <div className="st" style={{marginBottom:8}}>Active by Bundle</div>
          {byNameSku(active).length===0
            ? <div style={{fontSize:12,color:"var(--txd)",padding:"8px 0"}}>No active listings.</div>
            : byNameSku(active).map(b=>(
              <div key={`${b.bsku}-${b.name}`} className="sr">
                <span className="srl"><span className="bsku" style={{marginRight:5}}>{b.bsku}</span>{b.name}</span>
                <span className="srv">{b.count}</span>
              </div>
            ))
          }
        </div>
        <div className="sc">
          <div className="st" style={{marginBottom:8}}>To Be Listed by Bundle</div>
          {byNameSku(toBeListed).length===0
            ? <div style={{fontSize:12,color:"var(--txd)",padding:"8px 0"}}>All items are listed.</div>
            : byNameSku(toBeListed).map(b=>(
              <div key={`${b.bsku}-${b.name}`} className="sr">
                <span className="srl"><span className="bsku" style={{marginRight:5}}>{b.bsku}</span>{b.name}</span>
                <span className="srv">{b.count}</span>
              </div>
            ))
          }
        </div>
      </div>

      <TableSection
        title="To Be Listed"
        subtitle={`${toListF.filtered.length} items`}
        fHook={toListF}
        cols={toListCols} setCols={setToListCols}
        showCP={showToListCP} setShowCP={setShowToListCP}
        renderCell={renderToListCell}
        exportName="to_be_listed"
        zoom={toListZoom}
      />

      <TableSection
        title="Active Listings"
        subtitle={`${activeF.filtered.length} items`}
        fHook={activeF}
        cols={activeCols} setCols={setActiveCols}
        showCP={showActiveCP} setShowCP={setShowActiveCP}
        renderCell={renderActiveCell}
        exportName="active_listings"
        zoom={activeZoom}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MARK AS LISTED — Command 6
═══════════════════════════════════════════════════════════════ */
const MARK_LISTED_PLATS = [
  "Depop","Vinted","eBay","Whatnot","Tilt","Facebook Marketplace","Grailed",
];

/* ── ListingRecap — today's listing session summary ── */
const RECAP_PLAT_STYLE = {
  Depop:   {bg:"#fde8e8",col:"#993c1d"},
  Vinted:  {bg:"#e1f7f7",col:"#0f6e56"},
  eBay:    {bg:"#e6f0fb",col:"#185fa5"},
  Whatnot: {bg:"#f0ecfe",col:"#534ab7"},
  Grailed: {bg:"#f0f0f0",col:"#444"},
  "Facebook Marketplace":{bg:"#e6f0fb",col:"#185fa5"},
  Tilt:    {bg:"#fff8e1",col:"#7a4e0e"},
};

function ListingRecap({ listings, platFilt, setPlatFilt }) {
  const today = getToday();

  // Show items where:
  // (a) first listed today (dayListed === today), OR
  // (b) cross-listed today (any platformDates value === today)
  const todayItems = listings
    .filter(l => {
      if (!l.listed) return false;
      if (l.dayListed === today) return true;
      if (l.platformDates && Object.values(l.platformDates).includes(today)) return true;
      return false;
    })
    .map(l => {
      // Which platforms were added today specifically
      const todayPlats = l.platformDates
        ? Object.entries(l.platformDates).filter(([,d])=>d===today).map(([p])=>p)
        : (l.dayListed===today ? (l.platforms?.length ? l.platforms : l.platform ? [l.platform] : []) : []);
      return {
        sku: l.sku,
        name: l.name,
        colour: l.colour,
        size: l.size,
        plats: todayPlats.length ? todayPlats : (l.platforms?.length ? l.platforms : l.platform ? [l.platform] : []),
      };
    })
    .sort((a,b) => a.sku.localeCompare(b.sku));

  const platforms   = [...new Set(todayItems.flatMap(it => it.plats))];
  const crossListed = todayItems.filter(it => it.plats.length > 1).length;
  const filtered    = platFilt === "All" ? todayItems : todayItems.filter(it => it.plats.includes(platFilt));

  if (todayItems.length === 0) return null;

  return (
    <div style={{marginTop:24}}>
      <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"1.5px",
        color:"var(--txd)",marginBottom:12}}>Today's Listing Recap</div>

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14}}>
        {[
          {n:todayItems.length,  l:"Listed today"},
          {n:platforms.length,   l:"Platforms"},
          {n:crossListed,        l:"Cross-listed"},
          {n:todayItems.filter(l=>l.plats.length>1).length, l:"Multi-platform"},
        ].map(({n,l})=>(
          <div key={l} style={{background:"var(--sf2)",border:"1px solid var(--bd)",
            borderRadius:"var(--r)",padding:"10px 8px",textAlign:"center"}}>
            <div style={{fontSize:20,fontWeight:900,color:"var(--tx)"}}>{n}</div>
            <div style={{fontSize:10,color:"var(--txm)",marginTop:2}}>{l}</div>
          </div>
        ))}
      </div>

      {/* Filter pills */}
      <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap",alignItems:"center"}}>
        <span style={{fontSize:11,color:"var(--txm)"}}>Filter:</span>
        {["All",...platforms].map(p=>(
          <button key={p} onClick={()=>setPlatFilt(p)} style={{
            fontSize:11,padding:"3px 10px",borderRadius:20,cursor:"pointer",
            border:`1px solid ${platFilt===p?"var(--ac)":"var(--bdd)"}`,
            background:platFilt===p?"var(--acl)":"transparent",
            color:platFilt===p?"var(--ac)":"var(--txm)",
            fontWeight:platFilt===p?700:400,
          }}>{p}</button>
        ))}
        <span style={{marginLeft:"auto",fontSize:11,color:"var(--txd)"}}>
          {filtered.length} item{filtered.length!==1?"s":""}
        </span>
      </div>

      {/* Table */}
      <div style={{background:"var(--sf)",border:"1px solid var(--bd)",borderRadius:"var(--r2)",overflow:"hidden"}}>
        <div style={{padding:"10px 14px",borderBottom:"1px solid var(--bd)",
          display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:12,fontWeight:700}}>Today's listings</span>
          <span style={{fontSize:11,color:"var(--txd)"}}>
            {new Date().toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"})}
          </span>
        </div>
        {filtered.length === 0 ? (
          <div style={{padding:"20px",textAlign:"center",fontSize:12,color:"var(--txd)"}}>
            No listings for this platform today.
          </div>
        ) : filtered.map((it,i)=>(
          <div key={`${it.sku}-${i}`} style={{
            display:"flex",alignItems:"center",gap:10,padding:"9px 14px",
            borderBottom:i<filtered.length-1?"1px solid var(--bd)":"none",
          }}>
            <span style={{fontSize:10,fontWeight:700,color:"#1a5276",
              background:"#e8eeff",borderRadius:4,padding:"2px 6px",flexShrink:0}}>
              {it.sku}
            </span>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:12,fontWeight:600,whiteSpace:"nowrap",
                overflow:"hidden",textOverflow:"ellipsis"}}>{it.name}</div>
              <div style={{fontSize:11,color:"var(--txm)",marginTop:1}}>
                {[it.colour,it.size].filter(Boolean).join(" · ")}
              </div>
            </div>
            <div style={{display:"flex",gap:4,flexShrink:0,flexWrap:"wrap",justifyContent:"flex-end"}}>
              {it.plats.map(p=>{
                const s=RECAP_PLAT_STYLE[p]||{bg:"#f0f0f0",col:"#555"};
                return <span key={p} style={{fontSize:10,fontWeight:600,padding:"2px 7px",
                  borderRadius:20,background:s.bg,color:s.col}}>{p}</span>;
              })}
            </div>
            <span style={{fontSize:10,color:"var(--txd)",flexShrink:0,minWidth:32,textAlign:"right"}}>
              {it.time}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MarkAsListed({ listings, setListings }) {
  // Search all non-sold items — allows adding platforms to already-listed items
  const unlisted   = useMemo(() => listings.filter(l => !l.sold), [listings]);

  // ── Single-item mode ──
  const [skuInput,    setSkuInput]    = useState("");
  const [skuSearch,   setSkuSearch]   = useState("");
  const [platSel,     setPlatSel]     = useState(new Set());
  const [singleDate,  setSingleDate]  = useState(getToday());
  const [singlePrev,  setSinglePrev]  = useState(null); // preview item
  const [singleDone,  setSingleDone]  = useState(false);

  // ── Bulk mode ──
  const [bulkInput,   setBulkInput]   = useState("");
  const [bulkPlats,   setBulkPlats]   = useState(new Set());
  const [bulkDate,    setBulkDate]    = useState(getToday());
  const [bulkParsed,  setBulkParsed]  = useState([]);
  const [bulkDone,    setBulkDone]    = useState(false);

  // ── Session history ──
  const [history,     setHistory]     = useState([]);
  const [platFilt,    setPlatFilt]    = useState("All");

  // ── Tab ──
  const [mode,        setMode]        = useState("single"); // "single" | "bulk"

  /* ── Platform toggle helpers ── */
  const togglePlat = (set, setSel, p) =>
    setSel(prev => { const n = new Set(prev); n.has(p) ? n.delete(p) : n.add(p); return n; });

  const PlatGrid = ({ sel, onToggle, existingPlats=[] }) => (
    <div className="plat-grid-4">
      {MARK_LISTED_PLATS.map(p => {
        const isExisting = existingPlats.includes(p);
        const isSelected = sel.has(p);
        return (
          <button key={p}
            onClick={() => !isExisting && onToggle(p)}
            disabled={isExisting}
            title={isExisting ? `Already on ${p}` : ""}
            style={{
              padding:"7px 4px",fontSize:11,fontWeight:700,
              border:`1.5px solid ${isExisting?"#bbb":isSelected?"var(--ac)":"var(--bd)"}`,
              borderRadius:"var(--r)",cursor:isExisting?"default":"pointer",textAlign:"center",
              background:isExisting?"var(--sf2)":isSelected?"var(--acl)":"var(--sf2)",
              color:isExisting?"#aaa":isSelected?"var(--ac)":"var(--txm)",
              transition:"all .12s",opacity:isExisting?.65:1,
            }}
          >
            {p}{isExisting?" 🔒":isSelected?" ✓":""}
          </button>
        );
      })}
    </div>
  );

  /* ── Single SKU autocomplete ── */
  const skuDropdown = useMemo(() => {
    if (!skuSearch.trim()) return unlisted.slice(0, 8);
    const s = skuSearch.toLowerCase();
    return unlisted.filter(l =>
      l.sku.toLowerCase().includes(s) ||
      l.name.toLowerCase().includes(s) ||
      l.colour.toLowerCase().includes(s) ||
      l.size.toLowerCase().includes(s) ||
      l.brand.toLowerCase().includes(s)
    ).slice(0, 8);
  }, [unlisted, skuSearch]);

  const selectSku = (l) => {
    setSkuInput(l.sku);
    setSkuSearch(l.sku);
    setSinglePrev(l);
    setSingleDone(false);
  };

  const confirmSingle = () => {
    if (!singlePrev || platSel.size === 0) return;
    const platsArr = [...platSel];
    setListings(prev => prev.map(l =>
      l.sku === singlePrev.sku
        ? { ...l, listed:true, dayListed:l.dayListed||singleDate, platform:l.platform||platsArr[0], platforms:[...new Set([...(l.platforms||[]),...platsArr])], platformDates:{...(l.platformDates||{}), ...Object.fromEntries(platsArr.map(p=>[p,singleDate]))} }
        : l
    ));
    setHistory(prev => [{
      time: new Date().toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}),
      items: [{
        sku: singlePrev.sku,
        name: singlePrev.name,
        colour: singlePrev.colour,
        size: singlePrev.size,
        plats: platsArr,
      }],
    }, ...prev.slice(0,49)]);
    setSingleDone(true);
    setSinglePrev(null);
    setSkuInput(""); setSkuSearch("");
    setPlatSel(new Set());
    // Push notification
    sendPushNotification({
      title: "ArchiveDistrict",
      body:  `🏷️ ${singlePrev.sku} listed on ${platsArr.join(" and ")}`,
      tag:   `listed-${singlePrev.sku}`,
    });
  };

  /* ── Bulk mode ── */
  const parseBulk = () => {
    const lines = bulkInput.trim().split("\n").filter(l => l.trim());
    const parsed = lines.map(line => {
      const sku  = line.trim().toUpperCase();
      const item = listings.find(l => l.sku === sku && !l.sold);
      return {
        sku, item,
        found: !!item,
        alreadyListed: item?.listed ?? false,
        existingPlats: item?.platforms || [],
      };
    });
    setBulkParsed(parsed);
    setBulkDone(false);
  };

  const confirmBulk = () => {
    const valid = bulkParsed.filter(p => p.found);
    if (!valid.length || bulkPlats.size === 0) return;
    const platsArr = [...bulkPlats];
    setListings(prev => prev.map(l => {
      const u = valid.find(v => v.sku === l.sku);
      if (!u) return l;
      return {
        ...l, listed:true,
        dayListed: l.dayListed || bulkDate,
        platform: l.platform || platsArr[0],
        platforms: [...new Set([...(l.platforms||[]),...platsArr])],
        platformDates: {...(l.platformDates||{}), ...Object.fromEntries(platsArr.map(p=>[p,bulkDate]))},
      };
    }));
    setHistory(prev => [{
      time: new Date().toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}),
      items: valid.map(v => ({
        sku: v.sku,
        name: v.item?.name || v.sku,
        colour: v.item?.colour || "",
        size: v.item?.size || "",
        plats: platsArr,
      })),
    }, ...prev.slice(0,49)]);
    setBulkDone(true);
    setBulkInput(""); setBulkParsed([]);
    setBulkPlats(new Set());
    sendPushNotification({
      title: "ArchiveDistrict",
      body:  `🏷️ ${valid.length} item${valid.length!==1?"s":""} listed on ${platsArr.join(" and ")}`,
      tag:   "bulk-listed",
    });
  };

  const bulkValid = bulkParsed.filter(p => p.found);

  /* ── Info banner ── */
  const Banner = () => (
    <div className="info-banner" style={{marginBottom:14}}>
      <strong>Mark as Listed</strong> — search any unsold item. Already-listed platforms show as 🔒 — you can add new platforms on top. Use this for first-time listing and cross-listing updates.
    </div>
  );

  return (
    <div>
      <Banner />

      {/* Mode tabs */}
      <div className="tab-bar" style={{marginBottom:16}}>
        <div className={`tab ${mode==="single"?"active":""}`} onClick={()=>setMode("single")}>
          Single Item
        </div>
        <div className={`tab ${mode==="bulk"?"active":""}`} onClick={()=>setMode("bulk")}>
          Bulk (paste SKUs)
          {bulkParsed.length>0 && <span className="tc">{bulkParsed.length}</span>}
        </div>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8,paddingBottom:8}}>
          <span style={{fontSize:11,color:"var(--txd)"}}>{listings.filter(l=>!l.sold).length} unsold items</span>
        </div>
      </div>

      {/* ══ SINGLE MODE ══ */}
      {mode === "single" && (
        <div className="two-col">

          {/* Left — input */}
          <div style={{background:"var(--sf)",border:"1px solid var(--bd)",borderRadius:"var(--r2)",padding:18,boxShadow:"var(--sh)"}}>
            <div style={{fontSize:11,fontWeight:900,textTransform:"uppercase",letterSpacing:".4px",marginBottom:12}}>
              1 · Find Item
            </div>

            {/* SKU search with dropdown */}
            <div style={{position:"relative",marginBottom:14}}>
              <label className="fl">Search SKU, name, colour, size</label>
              <div className="sw" style={{width:"100%"}}>
                <span className="si">⌕</span>
                <input
                  className="fi" style={{width:"100%"}}
                  placeholder="e.g. A023 or Ralph Lauren or Navy M"
                  value={skuSearch}
                  onChange={e => { setSkuSearch(e.target.value); setSinglePrev(null); setSingleDone(false); }}
                />
              </div>
              {skuSearch && !singlePrev && skuDropdown.length > 0 && (
                <div style={{
                  position:"absolute",top:"100%",left:0,right:0,
                  background:"var(--sf)",border:"1px solid var(--bd)",
                  borderRadius:"var(--r)",boxShadow:"var(--shm)",
                  zIndex:50,maxHeight:240,overflowY:"auto",
                }}>
                  {skuDropdown.map(l => (
                    <div key={l.sku}
                      onClick={() => selectSku(l)}
                      style={{
                        padding:"9px 12px",cursor:"pointer",fontSize:12,
                        borderBottom:"1px solid var(--bd)",display:"flex",
                        justifyContent:"space-between",alignItems:"center",
                      }}
                      onMouseEnter={e=>e.currentTarget.style.background="var(--sf2)"}
                      onMouseLeave={e=>e.currentTarget.style.background=""}
                    >
                      <div>
                        <span className="sku" style={{marginRight:8}}>{l.sku}</span>
                        <span style={{color:"var(--txm)"}}>{l.brand} {l.type} · {l.colour} · {l.size}</span>
                      </div>
                      <span style={{fontSize:11,color:"var(--txd)"}}>{l.bundleSku}</span>
                    </div>
                  ))}
                </div>
              )}
              {skuSearch && unlisted.length > 0 && skuDropdown.length === 0 && (
                <div style={{marginTop:6,fontSize:11,color:"var(--txd)"}}>No unlisted items match.</div>
              )}
            </div>

            <div style={{fontSize:11,fontWeight:900,textTransform:"uppercase",letterSpacing:".4px",marginBottom:10}}>
              2 · Select Platforms
            </div>
            <PlatGrid sel={platSel} onToggle={p=>togglePlat(platSel,setPlatSel,p)} existingPlats={singlePrev?.platforms||[]} />
            {platSel.size === 0 && singlePrev && (
              <div style={{fontSize:11,color:"var(--ac)",marginTop:7,fontWeight:700}}>
                ● Tick at least one platform
              </div>
            )}

            <div style={{marginTop:14}}>
              <label className="fl">Date Listed</label>
              <input className="finp" type="date" value={singleDate}
                onChange={e=>setSingleDate(e.target.value)} style={{width:"100%"}} />
            </div>

            <button
              className="btn btn-p"
              style={{marginTop:14,width:"100%",justifyContent:"center"}}
              onClick={confirmSingle}
              disabled={!singlePrev || platSel.size===0}
            >
              ✓ Confirm — Mark as Listed
            </button>

            {singleDone && (
              <div style={{marginTop:10,background:"var(--gnl)",border:"1px solid rgba(31,92,53,.2)",borderRadius:"var(--r)",padding:"9px 12px",fontSize:12,color:"var(--gn)",fontWeight:700}}>
                ✓ Item marked as listed!
              </div>
            )}
          </div>

          {/* Right — preview */}
          <div style={{background:"var(--sf)",border:"1px solid var(--bd)",borderRadius:"var(--r2)",padding:18,boxShadow:"var(--sh)"}}>
            <div style={{fontSize:11,fontWeight:900,textTransform:"uppercase",letterSpacing:".4px",marginBottom:12}}>
              Preview
            </div>
            {!singlePrev ? (
              <div style={{textAlign:"center",padding:"40px 0",color:"var(--txd)",fontSize:12}}>
                Select an item to preview it here.
              </div>
            ) : (
              <div>
                <div style={{background:"var(--sf2)",border:"1px solid var(--bd)",borderRadius:"var(--r)",padding:"12px 14px",marginBottom:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                    <span className="sku">{singlePrev.sku}</span>
                    <span className="bsku">{singlePrev.bundleSku}</span>
                  </div>
                  <div style={{fontWeight:700,fontSize:13,marginBottom:4}}>{singlePrev.name}</div>
                  <div style={{fontSize:12,color:"var(--txm)",display:"flex",gap:10,flexWrap:"wrap"}}>
                    <span>{singlePrev.brand}</span>
                    <span>·</span>
                    <span>{singlePrev.colour}</span>
                    <span>·</span>
                    <span>Size {singlePrev.size}</span>
                  </div>
                  <div style={{marginTop:8,fontSize:12,color:"var(--txm)"}}>
                    Cost: <strong style={{color:"var(--tx)"}}>{fmt(singlePrev.price)}</strong>
                  </div>
                </div>

                {platSel.size > 0 && (
                  <div style={{marginBottom:12}}>
                    <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:"var(--txm)",marginBottom:6}}>
                      Listing on
                    </div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                      {[...platSel].map(p => (
                        <span key={p} className="badge b-b">{p}</span>
                      ))}
                    </div>
                    <div style={{fontSize:11,color:"var(--txd)",marginTop:5}}>
                      Primary: <strong>{[...platSel][0]}</strong>
                    </div>
                  </div>
                )}

                <div style={{background:"var(--gnl)",border:"1px solid rgba(31,92,53,.2)",borderRadius:"var(--r)",padding:"9px 12px",fontSize:12,color:"var(--gn)"}}>
                  <div style={{fontWeight:700,marginBottom:3}}>Will be updated:</div>
                  <div>Listed: <strong>Yes</strong></div>
                  <div>Date Listed: <strong>{singleDate}</strong></div>
                  <div>Platform(s): <strong>{platSel.size>0?[...platSel].join(", "):"—"}</strong></div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ BULK MODE ══ */}
      {mode === "bulk" && (
        <div className="two-col">

          {/* Left — input */}
          <div style={{background:"var(--sf)",border:"1px solid var(--bd)",borderRadius:"var(--r2)",padding:18,boxShadow:"var(--sh)"}}>
            <div style={{fontSize:11,fontWeight:900,textTransform:"uppercase",letterSpacing:".4px",marginBottom:10}}>
              1 · Paste SKUs (one per line)
            </div>
            <div className="info-banner" style={{marginBottom:10,fontSize:11}}>
              Type or paste SKU codes one per line — e.g. A023, A045, A067. The platform selection below applies to all of them.
            </div>
            <textarea
              className="qu-ta"
              placeholder={"A023\nA045\nA067\nA071"}
              value={bulkInput}
              onChange={e => { setBulkInput(e.target.value); setBulkParsed([]); setBulkDone(false); }}
              style={{minHeight:130}}
            />

            <div style={{marginTop:12,fontSize:11,fontWeight:900,textTransform:"uppercase",letterSpacing:".4px",marginBottom:10}}>
              2 · Select Platforms
            </div>
            <PlatGrid sel={bulkPlats} onToggle={p=>togglePlat(bulkPlats,setBulkPlats,p)} />

            <div style={{marginTop:14}}>
              <label className="fl">Date Listed</label>
              <input className="finp" type="date" value={bulkDate}
                onChange={e=>setBulkDate(e.target.value)} style={{width:"100%"}} />
            </div>

            <div style={{display:"flex",gap:8,marginTop:14}}>
              <button className="btn btn-o" style={{flex:1,justifyContent:"center"}}
                onClick={parseBulk} disabled={!bulkInput.trim()}>
                Preview →
              </button>
              {bulkParsed.length > 0 && (
                <button
                  className="btn btn-p" style={{flex:1,justifyContent:"center"}}
                  onClick={confirmBulk}
                  disabled={bulkValid.length===0 || bulkPlats.size===0}
                >
                  ✓ Confirm {bulkValid.length} item{bulkValid.length!==1?"s":""}
                </button>
              )}
            </div>

            {bulkPlats.size===0 && bulkParsed.length>0 && (
              <div style={{fontSize:11,color:"var(--ac)",marginTop:8,fontWeight:700}}>
                ● Tick at least one platform before confirming
              </div>
            )}
            {bulkDone && (
              <div style={{marginTop:10,background:"var(--gnl)",border:"1px solid rgba(31,92,53,.2)",borderRadius:"var(--r)",padding:"9px 12px",fontSize:12,color:"var(--gn)",fontWeight:700}}>
                ✓ {bulkValid.length} item{bulkValid.length!==1?"s":""} marked as listed!
              </div>
            )}
          </div>

          {/* Right — preview */}
          <div style={{background:"var(--sf)",border:"1px solid var(--bd)",borderRadius:"var(--r2)",padding:18,boxShadow:"var(--sh)"}}>
            <div style={{fontSize:11,fontWeight:900,textTransform:"uppercase",letterSpacing:".4px",marginBottom:12}}>
              Preview
              {bulkParsed.length>0 && <span className="ss">{bulkParsed.length} SKUs parsed</span>}
            </div>
            {!bulkParsed.length ? (
              <div style={{textAlign:"center",padding:"40px 0",color:"var(--txd)",fontSize:12}}>
                Paste SKUs and click Preview.
              </div>
            ) : (
              <div>
                {bulkParsed.map((p,i) => (
                  <div key={i} style={{
                    display:"flex",justifyContent:"space-between",alignItems:"center",
                    padding:"8px 10px",borderBottom:"1px solid var(--bd)",fontSize:12,
                  }}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span className="sku">{p.sku}</span>
                      {!p.found && <span className="badge b-r">Not found / sold</span>}
                      {p.found && p.alreadyListed && <span className="badge b-b">Update platforms</span>}
                      {p.found && !p.alreadyListed && <span className="badge b-g">New listing</span>}
                    </div>
                    {p.item && (
                      <div style={{fontSize:11,color:"var(--txm)",textAlign:"right"}}>
                        {p.item.colour} · {p.item.size}
                      </div>
                    )}
                  </div>
                ))}
                <div style={{marginTop:10,padding:"8px 10px",background:"var(--sf2)",borderRadius:"var(--r)",fontSize:11,color:"var(--txm)"}}>
                  <strong style={{color:"var(--gn)"}}>{bulkValid.length} ready</strong>
                  {" · "}{bulkParsed.filter(p=>!p.found).length} not found
                  {" · "}{bulkParsed.filter(p=>p.alreadyListed).length} updating platforms
                </div>
                {bulkPlats.size>0 && (
                  <div style={{marginTop:8,padding:"8px 10px",background:"var(--gnl)",borderRadius:"var(--r)",fontSize:11,color:"var(--gn)"}}>
                    Will list on: <strong>{[...bulkPlats].join(", ")}</strong>
                    <div style={{marginTop:2,opacity:.7}}>Date: {bulkDate}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Today's Listing Recap — always shown, reads from listing data */}
      <ListingRecap listings={listings} platFilt={platFilt} setPlatFilt={setPlatFilt} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   LISTING DRAFTER — Command 7 (AI-powered)
═══════════════════════════════════════════════════════════════ */
function ListingDrafter({ listings, setListings }) {
  const unlisted = useMemo(() => listings.filter(l => !l.listed && !l.sold), [listings]);

  const [selSku,      setSelSku]      = useState("");
  const [drafterSearch,setDrafterSearch]= useState("");
  const [condition,   setCondition]   = useState("Excellent");
  const [notes,       setNotes]       = useState("");
  const [photoUrl,    setPhotoUrl]    = useState("");
  const [loading,     setLoading]     = useState(false);
  const [regenLoading,setRegenLoading]= useState(false);
  const [generated,   setGenerated]   = useState(null);
  const [error,       setError]       = useState("");
  const [copied,      setCopied]      = useState("");

  const item = listings.find(l => l.sku === selSku);

  /* ── Description prompt — matches screenshot style exactly ── */
  const buildDescPrompt = (it, cond, extra, different = false) => {
    const isWaist = /^[wW]\s*\d/.test(it.pitToPit || "");
    const measLabel = isWaist ? "Waist" : "Pit to pit";
    const measValue = isWaist
      ? (it.pitToPit || "not specified").replace(/^[wW]\s*/,"").trim()
      : (it.pitToPit || "not specified");
    const allNotes = [extra, it.notes, it.desc].filter(Boolean).join(" | ") || "";

    // Extract colour mentions from description to help Claude override the tag
    const colourKeywords = ["black","white","navy","blue","grey","gray","brown","green","red",
      "yellow","orange","purple","pink","cream","beige","tan","olive","burgundy","khaki",
      "dark blue","light blue","dark green","washed","denim","faded","bleached","tie-dye",
      "multicolour","multi","stripe","striped","check","plaid","camo","floral"];
    const foundColours = allNotes
      ? colourKeywords.filter(c => allNotes.toLowerCase().includes(c))
      : [];
    const colourFromDesc = foundColours.length > 0
      ? `EXACT colour to use: "${foundColours.join(" and ")}" — write ALL of these in the title and description`
      : `EXACT colour to use: "${it.colour}" — write this IN FULL in the title, e.g. "Stussy ${it.colour} Denim Jorts"`;

    // Also check if item.colour itself contains multiple colours
    const colourNote = it.colour.toLowerCase().includes(" and ") || it.colour.toLowerCase().includes("/")
      ? `⚠ This is a multi-colour item: "${it.colour}" — include ALL colours, not just the first one`
      : "";

    return `You are writing a Depop/Vinted listing description for vintage clothing. The FIRST LINE must start exactly with "${it.brand} ${it.colour}" — this is non-negotiable.

Match this EXACT format:

${it.brand} ${it.colour} ${it.type} 🔥
[One line about the vibe, era or detail] [emoji]

Size: ${it.size}
Length: ${it.length || "[length]"}
${measLabel}: ${measValue || `[${measLabel.toLowerCase()}]`}

[One sentence: material, fit or how to style it] [emoji]
${cond} condition.

🏷️ SKU: ${it.sku}

Additional context:
${colourFromDesc}
${colourNote}
Description/notes: ${allNotes || "none"}

Rules:
- Start with "${it.brand} ${it.colour}" — ALL colours must be included, e.g. "Black and Red" not "Black"
- Max 3 emojis total
- Under 80 words total
- No hashtags
- Return ONLY the description text${different ? "\n- Write a DIFFERENT version with varied wording and emoji choice" : ""}`;
  };
  /* ── Generate ── */
  const generate = async () => {
    if (!item) return;
    setLoading(true); setError(""); setGenerated(null);
    try {
      /* Call 1 — JSON metadata */
      const r1 = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: `You are an expert vintage reseller. Generate listing metadata. Respond ONLY with valid JSON — no markdown, no backticks, no preamble.

Item: ${item.brand} ${item.type}, Colour: ${item.colour}, Size ${item.size}
Condition: ${condition}
Description/notes: ${[notes, item.notes, item.desc].filter(Boolean).join(" | ") || "none"}
SKU: ${item.sku}

IMPORTANT: The titles MUST start with exactly "${item.brand} ${item.colour}" — do not change, abbreviate or reword this prefix.
Example correct title: "${item.brand} ${item.colour} ${item.type} Size ${item.size} Vintage Streetwear"
Example WRONG title: "${item.brand} Black ${item.type}" — never drop any colour word.

Return exactly this JSON shape:
{"title":"${item.brand} ${item.colour} [add: type + size + 2-3 style keywords] max 80 chars total","ebayTitle":"${item.brand} ${item.colour} [add: type + size + style keywords] max 80 chars total","hashtags":"10 relevant hashtags each starting with #","vendooCategory":"best matching Vendoo category string"}`
          }]
        })
      });
      if (!r1.ok) {
        const errText = await r1.text();
        throw new Error(`API error ${r1.status}: ${errText}`);
      }
      const d1   = await r1.json();
      const raw1 = d1.content?.find(c => c.type === "text")?.text?.trim() || "{}";
      let meta = {};
      try { meta = JSON.parse(raw1); } catch (_) {
        const m = raw1.match(/\{[\s\S]*\}/);
        if (m) meta = JSON.parse(m[0]);
      }

      // Hard guarantee: force correct brand+colour prefix on both titles
      const reqPrefix = `${item.brand} ${item.colour}`;
      ["title","ebayTitle"].forEach(key => {
        if (!meta[key]) return;
        if (!meta[key].toLowerCase().startsWith(reqPrefix.toLowerCase())) {
          const cleaned = meta[key].replace(/^\S+\s+\S+\s*/,"").trim();
          meta[key] = `${reqPrefix} ${cleaned}`.slice(0,80).trim();
        }
      });

      /* Call 2 — description */
      const r2 = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 400,
          messages: [{ role: "user", content: buildDescPrompt(item, condition, notes) }]
        })
      });
      if (!r2.ok) {
        const errText = await r2.text();
        throw new Error(`API error ${r2.status}: ${errText}`);
      }
      const d2  = await r2.json();
      const desc = d2.content?.find(c => c.type === "text")?.text?.trim() || "";

      setGenerated({ ...meta, description: desc });
    } catch (e) {
      console.error("Drafter error:", e);
      setError(`Generation failed: ${e.message}`);
    }
    setLoading(false);
  };

  /* ── Regen description only ── */
  const regenDesc = async () => {
    if (!item || !generated) return;
    setRegenLoading(true);
    try {
      const r = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 400,
          messages: [{ role: "user", content: buildDescPrompt(item, condition, notes, true) }]
        })
      });
      const d    = await r.json();
      const desc = d.content?.find(c => c.type === "text")?.text?.trim() || "";
      setGenerated(prev => ({ ...prev, description: desc }));
    } catch (_) {}
    setRegenLoading(false);
  };

  /* ── Vendoo CSV ── */
  const exportVendoo = () => {
    if (!generated || !item) return;
    const rows = [
      ["Title","Description","Price","Brand","Size","Color","Category","Condition","Photos"],
      [
        generated.title, generated.description,
        item.price, item.brand, item.size, item.colour,
        generated.vendooCategory || item.type,
        condition, photoUrl || "",
      ],
    ];
    const csv = rows.map(r => r.map(v => `"${String(v??'').replace(/"/g,'""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    a.download = `vendoo_${item.sku}_${TODAY}.csv`;
    a.click();
  };

  /* ── Copy helper ── */
  const copy = (text, key) => {
    copyText(text);
    setCopied(key);
    setTimeout(() => setCopied(""), 1600);
  };

  /* ── Output field ── */
  const OutField = ({ label, fieldKey, extraBtn }) => (
    <div style={{ marginBottom: 13 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5 }}>
        <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:".5px", color:"var(--txm)" }}>
          {label}
        </div>
        <div style={{ display:"flex", gap:6 }}>
          {extraBtn}
          <button className="copy-btn" onClick={() => copy(generated[fieldKey], fieldKey)}>
            {copied === fieldKey ? "✓ Copied!" : "Copy"}
          </button>
        </div>
      </div>
      <div className="dout" style={{ paddingRight: extraBtn ? 12 : 12 }}>
        {generated[fieldKey]}
      </div>
    </div>
  );

  return (
    <div>
      <div className="info-banner">
        <strong>AI Listing Drafter</strong> — select an unlisted item, add condition and notes,
        then generate. Each field has its own copy button. The description matches your Depop style
        with measurements and SKU. Export a Vendoo CSV to cross-list.
      </div>

      <div className="draft-grid">
        {/* ── Left panel — inputs ── */}
        <div className="draft-box">

          <span className="dlabel">Search &amp; select unlisted item</span>

          {/* Searchable SKU field */}
          {(() => {
            const results = drafterSearch.trim()
              ? unlisted.filter(l => {
                  const s = drafterSearch.toLowerCase();
                  return (
                    l.sku.toLowerCase().includes(s) ||
                    l.brand.toLowerCase().includes(s) ||
                    l.name.toLowerCase().includes(s) ||
                    l.colour.toLowerCase().includes(s) ||
                    l.size.toLowerCase().includes(s) ||
                    l.type.toLowerCase().includes(s)
                  );
                }).slice(0, 10)
              : [];

            const showDropdown = drafterSearch.trim() && !item;

            return (
              <div style={{ position:"relative" }}>
                <div className="sw" style={{ width:"100%" }}>
                  <span className="si">⌕</span>
                  <input
                    className="fi"
                    style={{ width:"100%", paddingRight: item ? 32 : 10 }}
                    placeholder="Type SKU, brand, colour, size…"
                    value={drafterSearch}
                    onChange={e => {
                      setDrafterSearch(e.target.value);
                      // If they clear the field, also clear selection
                      if (!e.target.value) { setSelSku(""); setGenerated(null); setError(""); }
                    }}
                  />
                  {item && (
                    <button
                      onClick={() => {
                        setSelSku(""); setDrafterSearch("");
                        setGenerated(null); setError("");
                      }}
                      style={{
                        position:"absolute", right:8, top:"50%",
                        transform:"translateY(-50%)",
                        background:"none", border:"none", cursor:"pointer",
                        color:"var(--txd)", fontSize:14, lineHeight:1,
                      }}
                      title="Clear selection"
                    >✕</button>
                  )}
                </div>

                {/* Dropdown results */}
                {showDropdown && (
                  <div style={{
                    position:"absolute", top:"100%", left:0, right:0, zIndex:60,
                    background:"var(--sf)", border:"1px solid var(--bd)",
                    borderRadius:"var(--r)", boxShadow:"var(--shm)",
                    maxHeight:260, overflowY:"auto", marginTop:2,
                  }}>
                    {results.length === 0 ? (
                      <div style={{ padding:"12px 14px", fontSize:12, color:"var(--txd)" }}>
                        No unlisted items match "{drafterSearch}"
                      </div>
                    ) : results.map(l => (
                      <div
                        key={l.sku}
                        onClick={() => {
                          setSelSku(l.sku);
                          setDrafterSearch(`${l.sku} · ${l.brand} ${l.type} · ${l.colour} · ${l.size}`);
                          setGenerated(null); setError("");
                        }}
                        style={{
                          padding:"9px 13px", cursor:"pointer", fontSize:12,
                          borderBottom:"1px solid var(--bd)",
                          display:"flex", justifyContent:"space-between", alignItems:"center",
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = "var(--sf2)"}
                        onMouseLeave={e => e.currentTarget.style.background = ""}
                      >
                        <div>
                          <span className="sku" style={{ marginRight:9 }}>{l.sku}</span>
                          <span style={{ color:"var(--txm)" }}>
                            {l.brand} {l.type} · {l.colour} · Size {l.size}
                          </span>
                        </div>
                        <span style={{ fontSize:11, color:"var(--txd)", flexShrink:0, marginLeft:8 }}>
                          {l.bundleSku}
                        </span>
                      </div>
                    ))}
                    <div style={{
                      padding:"7px 13px", fontSize:10, color:"var(--txd)",
                      borderTop:"1px solid var(--bd)", fontStyle:"italic",
                    }}>
                      {unlisted.length} total unlisted · showing {results.length}
                    </div>
                  </div>
                )}

                {/* Selected item badge */}
                {item && (
                  <div style={{
                    marginTop:6, padding:"4px 10px",
                    background:"var(--acl)", border:"1px solid var(--ac2)",
                    borderRadius:20, display:"inline-flex", alignItems:"center",
                    gap:7, fontSize:11,
                  }}>
                    <span className="sku" style={{ fontSize:11 }}>{item.sku}</span>
                    <span style={{ color:"var(--ac)", fontWeight:700 }}>selected</span>
                  </div>
                )}
              </div>
            );
          })()}

          {item && (
            <>
              {/* Item summary chip */}
              <div style={{
                marginTop:10, padding:"9px 12px",
                background:"var(--sf2)", border:"1px solid var(--bd)",
                borderRadius:"var(--r)", fontSize:12,
              }}>
                <div style={{ fontWeight:700 }}>{item.name}</div>
                <div style={{ color:"var(--txm)", marginTop:3, fontSize:11 }}>
                  {item.brand} · {item.colour} · Size {item.size}
                  {item.length    && ` · L: ${item.length}`}
                  {item.pitToPit  && ` · PtP: ${item.pitToPit}`}
                </div>
                <div style={{ color:"var(--txd)", fontSize:11, marginTop:2 }}>
                  Cost: {fmt(item.price)} · SKU: {item.sku}
                </div>
              </div>

              <span className="dlabel">Condition</span>
              <select className="dsel" value={condition} onChange={e => setCondition(e.target.value)}>
                {["Excellent","Very Good","Good","Fair"].map(c => <option key={c}>{c}</option>)}
              </select>

              <span className="dlabel">Extra notes for AI <span style={{ fontWeight:400, textTransform:"none", color:"var(--txd)" }}>(optional)</span></span>
              <textarea className="dta"
                placeholder="Any flaws, unique details, special features, styling inspiration…"
                value={notes} onChange={e => setNotes(e.target.value)}
              />

              <span className="dlabel">Photo URL <span style={{ fontWeight:400, textTransform:"none", color:"var(--txd)" }}>(optional)</span></span>
              <div className="icloud-tip">
                💡 <strong>iPhone:</strong> Open shared album in Safari → tap photo → Share →
                "Copy iCloud Link". Exports to Vendoo CSV even if it won't preview here.
              </div>
              <input className="din" placeholder="https://…" value={photoUrl}
                onChange={e => setPhotoUrl(e.target.value)} />
              {photoUrl && (
                <img src={photoUrl} alt=""
                  style={{ marginTop:8, width:"100%", maxHeight:130, objectFit:"cover",
                    borderRadius:"var(--r)", border:"1px solid var(--bd)" }}
                  onError={e => { e.target.style.display = "none"; }}
                />
              )}

              <button
                className="btn btn-p"
                style={{ marginTop:14, width:"100%", justifyContent:"center" }}
                onClick={generate}
                disabled={loading}
              >
                {loading
                  ? <><span className="spin" />&nbsp;Generating…</>
                  : "✨ Generate Listing"}
              </button>

              {error && (
                <div style={{ marginTop:8, color:"var(--ac)", fontSize:12, fontWeight:700 }}>
                  {error}
                </div>
              )}
            </>
          )}

          {!item && (
            <div style={{ marginTop:20, textAlign:"center", color:"var(--txd)", fontSize:12 }}>
              Select an item above to get started.
            </div>
          )}
        </div>

        {/* ── Right panel — output ── */}
        <div className="draft-box">
          {!generated && !loading && (
            <div style={{ textAlign:"center", paddingTop:50, color:"var(--txd)", fontSize:12 }}>
              {item
                ? "Click Generate to create your listing."
                : "Select an item on the left first."}
            </div>
          )}
          {loading && (
            <div style={{ textAlign:"center", paddingTop:50 }}>
              <div style={{ fontSize:24, marginBottom:10, opacity:.2 }}>✍️</div>
              <div style={{ fontSize:12, color:"var(--txm)" }}>Writing your listing…</div>
              <div style={{ fontSize:11, color:"var(--txd)", marginTop:5 }}>Two AI calls — title then description</div>
            </div>
          )}

          {generated && (
            <>
              <OutField label="Title — Depop / Vinted" fieldKey="title" />
              <OutField label="Title — eBay" fieldKey="ebayTitle" />

              {/* Description with regen button */}
              <div style={{ marginBottom:13 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5 }}>
                  <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:".5px", color:"var(--txm)" }}>
                    Description
                  </div>
                  <div style={{ display:"flex", gap:6 }}>
                    <button className="copy-btn"
                      onClick={regenDesc}
                      disabled={regenLoading}
                      style={{ color: regenLoading ? "var(--txd)" : undefined }}
                    >
                      {regenLoading ? "…" : "↺ Regen"}
                    </button>
                    <button className="copy-btn" onClick={() => copy(generated.description, "desc")}>
                      {copied === "desc" ? "✓ Copied!" : "Copy"}
                    </button>
                  </div>
                </div>
                <div className="dout" style={{ fontFamily:"Arial,sans-serif", lineHeight:1.75 }}>
                  {generated.description}
                </div>
              </div>

              <OutField label="Hashtags" fieldKey="hashtags" />

              {/* Actions */}
              <div style={{ display:"flex", gap:8, marginTop:6, flexWrap:"wrap" }}>
                <button className="btn btn-g btn-sm" onClick={exportVendoo}>↓ Vendoo CSV</button>
                <button className="btn btn-o btn-sm" onClick={() => { setGenerated(null); setError(""); }}>
                  Start Over
                </button>
                <button className="btn btn-o btn-sm" onClick={generate} disabled={loading}>
                  ↺ Regenerate All
                </button>
              </div>

              {/* Vendoo note */}
              <div style={{
                marginTop:11, background:"var(--gnl)",
                border:"1px solid rgba(31,92,53,.2)",
                borderRadius:"var(--r)", padding:"8px 11px",
                fontSize:11, color:"var(--gn)",
              }}>
                Vendoo CSV includes: title, description, price, brand, size, colour,
                category, condition{photoUrl ? " and photo URL" : ". Add a photo URL above to include it."}.
              </div>

              {/* Vendoo category */}
              {generated.vendooCategory && (
                <div style={{ marginTop:8, fontSize:11, color:"var(--txm)" }}>
                  Suggested Vendoo category: <strong style={{ color:"var(--tx)" }}>{generated.vendooCategory}</strong>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Mark as Listed — inline at bottom of Drafter ── */}
      {item && (
        <DrafterMarkListed item={item} setListings={setListings} />
      )}
    </div>
  );
}

/* ── Drafter inline mark-as-listed panel ── */
function DrafterMarkListed({ item, setListings }) {
  const [open,      setOpen]     = useState(false);
  const [platSel,   setPlatSel]  = useState(new Set());
  const [dateL,     setDateL]    = useState(getToday());
  const [done,      setDone]     = useState(false);

  // Reset when item changes
  const prevSku = useRef(null);
  useEffect(() => {
    if (item?.sku !== prevSku.current) {
      setDone(false); setPlatSel(new Set()); setOpen(false);
      prevSku.current = item?.sku;
    }
  }, [item?.sku]);

  if (item?.listed) {
    return (
      <div style={{marginTop:18,padding:"10px 14px",background:"var(--gnl)",border:"1px solid rgba(31,92,53,.2)",borderRadius:"var(--r)",fontSize:12,color:"var(--gn)",fontWeight:700}}>
        ✓ {item.sku} is already marked as listed.
      </div>
    );
  }

  const toggle = (p) => setPlatSel(prev => { const n=new Set(prev); n.has(p)?n.delete(p):n.add(p); return n; });

  const confirm = () => {
    if (platSel.size === 0) return;
    const arr = [...platSel];
    setListings(prev => prev.map(l =>
      l.sku === item.sku
        ? { ...l, listed:true, dayListed:dateL, platform:l.platform||arr[0], platforms:[...new Set([...(l.platforms||[]),...arr])], platformDates:{...(l.platformDates||{}), ...Object.fromEntries(arr.map(p=>[p,dateL]))} }
        : l
    ));
    // Push notification
    sendPushNotification({
      title: "ArchiveDistrict",
      body:  `🏷️ ${item.sku} listed on ${arr.join(" and ")}`,
      tag:   `listed-${item.sku}`,
    });
    setDone(true);
  };

  return (
    <div style={{marginTop:18,border:"1px solid var(--bd)",borderRadius:"var(--r2)",background:"var(--sf)",boxShadow:"var(--sh)",overflow:"hidden"}}>
      {/* Header / toggle */}
      <div
        onClick={() => !done && setOpen(o=>!o)}
        style={{
          padding:"11px 16px",background:"var(--sf2)",
          display:"flex",alignItems:"center",justifyContent:"space-between",
          cursor:done?"default":"pointer",userSelect:"none",
        }}
      >
        <div style={{fontWeight:700,fontSize:12,textTransform:"uppercase",letterSpacing:".4px",color:"var(--tx)"}}>
          📌 Mark as Listed
          <span style={{fontWeight:400,color:"var(--txm)",marginLeft:8,textTransform:"none",letterSpacing:0,fontSize:11}}>
            — record where {item.sku} went live
          </span>
        </div>
        {!done && (
          <span style={{fontSize:11,color:"var(--txd)"}}>{open ? "▲ collapse" : "▼ expand"}</span>
        )}
        {done && <span className="badge b-g">✓ Listed</span>}
      </div>

      {/* Body */}
      {open && !done && (
        <div style={{padding:"14px 16px"}}>
          <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:"var(--txm)",marginBottom:8}}>
            Select platforms
          </div>
          <div className="plat-grid-4" style={{marginBottom:14}}>
            {MARK_LISTED_PLATS.map(p => (
              <button key={p} onClick={() => toggle(p)} style={{
                padding:"7px 4px",fontSize:11,fontWeight:700,
                border:`1.5px solid ${platSel.has(p)?"var(--ac)":"var(--bd)"}`,
                borderRadius:"var(--r)",cursor:"pointer",textAlign:"center",
                background:platSel.has(p)?"var(--acl)":"var(--sf2)",
                color:platSel.has(p)?"var(--ac)":"var(--txm)",
                transition:"all .12s",
              }}>
                {p}{platSel.has(p) && " ✓"}
              </button>
            ))}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
            <label className="fl" style={{marginBottom:0,whiteSpace:"nowrap"}}>Date Listed</label>
            <input className="finp" type="date" value={dateL}
              onChange={e=>setDateL(e.target.value)} style={{width:160}} />
          </div>
          <button
            className="btn btn-p"
            onClick={confirm}
            disabled={platSel.size===0}
            style={{width:"100%",justifyContent:"center"}}
          >
            ✓ Confirm — Mark {item.sku} as Listed
          </button>
          {platSel.size===0 && (
            <div style={{fontSize:11,color:"var(--ac)",marginTop:7,fontWeight:700}}>
              ● Tick at least one platform
            </div>
          )}
        </div>
      )}

      {done && (
        <div style={{padding:"12px 16px",fontSize:12,color:"var(--gn)"}}>
          ✓ <strong>{item.sku}</strong> marked as listed on <strong>{[...platSel].join(", ")}</strong> on {dateL}.
          The item will now appear in your Active Listings.
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MARK AS SOLD — Command 8
═══════════════════════════════════════════════════════════════ */
function QuickMarkSold({ listings, setListings }) {
  const unsold = useMemo(() => listings.filter(l => l.listed && !l.sold), [listings]);

  // Single mode
  const [selSku,    setSelSku]    = useState("");
  const [skuSearch, setSkuSearch] = useState("");
  const [soldPrice, setSoldPrice] = useState("");
  const [platSel,   setPlatSel]   = useState(null);
  const [soldDate,  setSoldDate]  = useState(getToday());
  const [done,      setDone]      = useState(false);
  const [history,   setHistory]   = useState([]);

  const item = listings.find(l => l.sku === selSku);
  const prevSku = useRef(null);
  useEffect(() => {
    if (selSku !== prevSku.current) {
      setDone(false); setSoldPrice(""); setPlatSel(null);
      prevSku.current = selSku;
    }
  }, [selSku]);

  const skuDropdown = useMemo(() => {
    if (!skuSearch.trim()) return unsold.slice(0,8);
    const s = skuSearch.toLowerCase();
    return unsold.filter(l =>
      l.sku.toLowerCase().includes(s) ||
      l.brand.toLowerCase().includes(s) ||
      l.colour.toLowerCase().includes(s) ||
      l.size.toLowerCase().includes(s)
    ).slice(0,8);
  }, [unsold, skuSearch]);

  const confirm = () => {
    if (!item || !soldPrice || !platSel) return;
    const price = parseFloat(soldPrice);
    const days  = item.dayListed
      ? Math.max(0, Math.floor((new Date(soldDate) - new Date(item.dayListed)) / 86400000))
      : 0;
    setListings(prev => prev.map(l => l.sku === item.sku
      ? { ...l, sold:true, soldPrice:price,
          profit: parseFloat((price - l.price).toFixed(2)),
          platform: platSel, daySold: soldDate, days, shipped:false }
      : l
    ));
    setHistory(prev => [{
      time: new Date().toLocaleTimeString(),
      sku: item.sku, name: item.name, price: fmt(price), plat: platSel,
      delistFrom: (item.platforms||[]).filter(p=>p!==platSel),
    }, ...prev.slice(0,9)]);
    // Push notification
    const delistFrom = (item.platforms||[]).filter(p=>p!==platSel);
    sendPushNotification({
      title: "ArchiveDistrict",
      body:  delistFrom.length
        ? `💰 Sold! Delist ${item.sku} from ${delistFrom.join(" and ")}`
        : `💰 ${item.sku} sold on ${platSel} for ${fmt(price)}`,
      tag:   `sold-${item.sku}`,
    });
    setDone(true);
  };

  const canConfirm = item && soldPrice && platSel;

  return (
    <div>
      <div className="info-banner">
        <strong>Mark as Sold</strong> — search for the item, enter the sold price,
        tap the platform it sold on, then confirm. One item at a time.
      </div>

      <div className="qu-wrap">
        {/* Left — input */}
        <div className="qu-box">
          <div className="qu-title">1 · Find Item</div>

          {/* SKU search */}
          <div style={{position:"relative",marginBottom:12}}>
            <label className="fl">Search SKU, brand, colour, size</label>
            <div className="sw" style={{width:"100%"}}>
              <span className="si">⌕</span>
              <input className="fi" style={{width:"100%"}}
                placeholder="e.g. A023 or Navy M"
                value={skuSearch}
                onChange={e=>{ setSkuSearch(e.target.value); if(!e.target.value){ setSelSku(""); setDone(false); }}}
              />
              {item && (
                <button onClick={()=>{ setSelSku(""); setSkuSearch(""); setDone(false); }}
                  style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",
                    background:"none",border:"none",cursor:"pointer",color:"var(--txd)",fontSize:14}}>✕</button>
              )}
            </div>
            {skuSearch && !item && skuDropdown.length > 0 && (
              <div style={{position:"absolute",top:"100%",left:0,right:0,
                background:"var(--sf)",border:"1px solid var(--bd)",borderRadius:"var(--r)",
                boxShadow:"var(--shm)",zIndex:50,maxHeight:220,overflowY:"auto",marginTop:2}}>
                {skuDropdown.map(l=>(
                  <div key={l.sku} onClick={()=>{ setSelSku(l.sku); setSkuSearch(`${l.sku} · ${l.brand} ${l.colour} ${l.size}`); }}
                    style={{padding:"9px 12px",cursor:"pointer",fontSize:12,borderBottom:"1px solid var(--bd)",
                      display:"flex",justifyContent:"space-between"}}
                    onMouseEnter={e=>e.currentTarget.style.background="var(--sf2)"}
                    onMouseLeave={e=>e.currentTarget.style.background=""}>
                    <div><span className="sku" style={{marginRight:8}}>{l.sku}</span>
                      <span style={{color:"var(--txm)"}}>{l.brand} · {l.colour} · {l.size}</span></div>
                    <span style={{color:"var(--txd)",fontSize:11}}>{l.bundleSku}</span>
                  </div>
                ))}
              </div>
            )}
            {item && <div style={{marginTop:5,fontSize:11}}><span className="badge b-g">✓ {item.sku} selected</span></div>}
          </div>

          <div className="qu-title" style={{marginTop:14}}>2 · Sold Price</div>
          <div className="sw" style={{width:"100%",marginBottom:12}}>
            <span style={{padding:"0 10px",color:"var(--txm)",fontWeight:700}}>£</span>
            <input className="fi" style={{width:"100%"}} type="text" inputMode="decimal"
              placeholder="0.00" value={soldPrice}
              onChange={e=>{ if(/^\d*\.?\d*$/.test(e.target.value)) setSoldPrice(e.target.value); }}/>
          </div>

          <div className="qu-title" style={{marginTop:4}}>3 · Platform Sold On</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginTop:6}}>
            {MARK_LISTED_PLATS.map(p=>(
              <button key={p} onClick={()=>setPlatSel(p===platSel?null:p)} style={{
                padding:"7px 4px",fontSize:11,fontWeight:700,textAlign:"center",
                border:`1.5px solid ${platSel===p?"var(--ac)":"var(--bd)"}`,
                borderRadius:"var(--r)",cursor:"pointer",
                background:platSel===p?"var(--acl)":"var(--sf2)",
                color:platSel===p?"var(--ac)":"var(--txm)",
                transition:"all .12s",
              }}>{p}{platSel===p&&" ✓"}</button>
            ))}
          </div>

          <div style={{marginTop:12}}>
            <label className="fl">Date Sold</label>
            <input className="finp" type="date" value={soldDate}
              onChange={e=>setSoldDate(e.target.value)} style={{width:"100%"}} />
          </div>

          <button className="btn btn-p" disabled={!canConfirm}
            style={{marginTop:14,width:"100%",justifyContent:"center"}} onClick={confirm}>
            ✓ Mark as Sold
          </button>
          {!platSel && item && <div style={{fontSize:11,color:"var(--ac)",marginTop:6,fontWeight:700}}>● Select the platform it sold on</div>}
          {!soldPrice && item && <div style={{fontSize:11,color:"var(--ac)",marginTop:4,fontWeight:700}}>● Enter the sold price</div>}

          {done && (
            <div style={{marginTop:10,borderRadius:"var(--r)",overflow:"hidden"}}>
              <div style={{background:"var(--gnl)",border:"1px solid rgba(31,92,53,.2)",padding:"9px 11px",fontSize:12,color:"var(--gn)",fontWeight:700}}>
                ✓ {item?.sku || "Item"} marked as sold on {platSel} for {fmt(parseFloat(soldPrice)||0)}
              </div>
              {/* Delist reminder */}
              {item?.platforms?.length > 1 && (
                <div style={{background:"#fff8f0",border:"1px solid #f0c040",borderTop:"none",padding:"10px 11px"}}>
                  <div style={{fontSize:11,fontWeight:700,color:"#7a4e0e",marginBottom:6}}>
                    📋 Remember to delist from:
                  </div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                    {item.platforms.filter(p=>p!==platSel).map(p=>{
                      const PLAT_LINKS = {
                        Depop:"https://depop.com/you/selling/",
                        Vinted:"https://www.vinted.co.uk/my/items",
                        eBay:"https://www.ebay.co.uk/mys/active",
                        Whatnot:"https://www.whatnot.com/sell",
                        Grailed:"https://www.grailed.com/sell",
                        "Facebook Marketplace":"https://www.facebook.com/marketplace/you/selling",
                        Tilt:"https://tilt.app",
                      };
                      return (
                        <a key={p} href={PLAT_LINKS[p]||"#"} target="_blank" rel="noopener noreferrer"
                          style={{display:"inline-flex",alignItems:"center",gap:5,
                            background:"var(--sf)",border:"1px solid var(--bdd)",
                            borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:700,
                            color:"var(--tx)",textDecoration:"none"}}
                        >
                          {p} →
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}
              {item?.platforms?.length <= 1 && item?.platform && item.platform !== platSel && (
                <div style={{background:"#fff8f0",border:"1px solid #f0c040",borderTop:"none",padding:"8px 11px",fontSize:11,color:"#7a4e0e",fontWeight:700}}>
                  📋 Remember to delist from: {item.platform}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right — preview */}
        <div className="qu-box">
          <div className="qu-title">Preview</div>
          {!item ? (
            <div style={{fontSize:12,color:"var(--txd)",padding:"24px 0",textAlign:"center"}}>Select an item on the left.</div>
          ) : (
            <div>
              <div style={{background:"var(--sf2)",border:"1px solid var(--bd)",borderRadius:"var(--r)",padding:"11px 13px",marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                  <span className="sku">{item.sku}</span>
                  <span className="bsku">{item.bundleSku}</span>
                </div>
                <div style={{fontWeight:700,fontSize:13,marginBottom:3}}>{item.name}</div>
                <div style={{fontSize:12,color:"var(--txm)"}}>
                  {item.brand} · {item.colour} · Size {item.size}
                </div>
                <div style={{fontSize:12,marginTop:6}}>
                  Cost: <strong>{fmt(item.price)}</strong>
                  {soldPrice && <span> · Profit: <strong style={{color:parseFloat(soldPrice)-item.price>0?"var(--gn)":"var(--ac)"}}>{fmt(parseFloat(soldPrice)-item.price)}</strong></span>}
                </div>
              </div>
              {soldPrice && platSel && (
                <div style={{background:"var(--gnl)",border:"1px solid rgba(31,92,53,.2)",borderRadius:"var(--r)",padding:"9px 12px",fontSize:12,color:"var(--gn)"}}>
                  <div style={{fontWeight:700,marginBottom:3}}>Will be updated:</div>
                  <div>Sold: <strong>Yes</strong></div>
                  <div>Sold Price: <strong>{fmt(parseFloat(soldPrice))}</strong></div>
                  <div>Platform: <strong>{platSel}</strong></div>
                  <div>Date: <strong>{soldDate}</strong></div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Session history */}
      {history.length > 0 && (
        <div style={{marginTop:14}}>
          <div className="st" style={{marginBottom:8}}>Session History</div>
          {history.map((h,i)=>(
            <div key={i} style={{background:"var(--gnl)",border:"1px solid rgba(31,92,53,.15)",
              borderRadius:"var(--r)",padding:"8px 12px",marginBottom:7,
              fontSize:12,color:"var(--gn)",display:"flex",justifyContent:"space-between"}}>
              <span>✓ <strong>{h.sku}</strong> — {h.name} sold for <strong>{h.price}</strong> on {h.plat}</span>
              {h.delistFrom?.length > 0 && (
                <span style={{fontSize:10,color:"#7a4e0e",marginLeft:8}}>delist from: {h.delistFrom.join(", ")}</span>
              )}
              <span style={{fontSize:11,opacity:.6,flexShrink:0,marginLeft:10}}>{h.time}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SHIPPING TAB — Command 8
═══════════════════════════════════════════════════════════════ */
const SHIPPING_COLS = [
  {id:"sku",        label:"SKU",        visible:true },
  {id:"name",       label:"Item",       visible:true },
  {id:"colour",     label:"Colour",     visible:true },
  {id:"size",       label:"Size",       visible:true },
  {id:"platform",   label:"Platform",   visible:true },
  {id:"soldPrice",  label:"Sold £",     visible:true },
  {id:"daySold",    label:"Sold On",    visible:false},
  {id:"bundleSku",  label:"Bundle",     visible:false},
];

function ShippingTab({ listings, setListings }) {
  const [cols,         setCols]        = useState(SHIPPING_COLS);
  const [showColPanel, setShowColPanel]= useState(false);
  const [showFilterP,  setShowFilterP] = useState(false);

  const toShip      = listings.filter(l => l.sold && !l.shipped);
  const shippedToday = listings.filter(l => l.shipped && l.shippedDate === getToday());

  const markShipped = (sku) => setListings(prev =>
    prev.map(l => l.sku === sku ? { ...l, shipped:true, shippedDate:TODAY } : l)
  );
  const markAllShipped = () => setListings(prev =>
    prev.map(l => (l.sold && !l.shipped) ? { ...l, shipped:true, shippedDate:TODAY } : l)
  );

  /* Group by platform */
  const byPlat = useMemo(() => {
    const m = {};
    toShip.forEach(l => {
      const k = l.platform || "No Platform";
      if (!m[k]) m[k] = [];
      m[k].push(l);
    });
    return Object.entries(m).sort(([,a],[,b]) => b.length - a.length);
  }, [toShip]);

  /* Filter hook for shipped-today table */
  const shippedF = useTableFilters(shippedToday, cols);
  const visCols  = cols.filter(c => c.visible);

  const renderCell = (col, l) => {
    if (col==="sku")       return <span className="sku">{l.sku}</span>;
    if (col==="name")      return <span style={{fontWeight:600}}>{l.name}</span>;
    if (col==="colour")    return l.colour;
    if (col==="size")      return <span style={{color:"var(--txm)"}}>{l.size}</span>;
    if (col==="platform")  return l.platform ? <span className="badge b-b">{l.platform}</span> : <span style={{color:"var(--txd)"}}>—</span>;
    if (col==="soldPrice") return <span style={{fontWeight:700,color:"var(--gn)"}}>{fmt(l.soldPrice)}</span>;
    if (col==="daySold")   return <span style={{color:"var(--txm)",fontSize:11}}>{l.daySold||"—"}</span>;
    if (col==="bundleSku") return <span className="bsku">{l.bundleSku}</span>;
    return "—";
  };

  return (
    <div>
      {/* Today's shipped recap */}
      <div className="ship-recap">
        <div style={{fontSize:11,fontWeight:900,textTransform:"uppercase",letterSpacing:".5px",color:"var(--nv)",marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span>📦 Shipped Today — {TODAY}</span>
          <span style={{fontWeight:400,color:"var(--nv)",opacity:.6}}>{shippedToday.length} item{shippedToday.length!==1?"s":""}</span>
        </div>
        {!shippedToday.length ? (
          <div style={{fontSize:12,color:"var(--nv)",opacity:.5}}>Nothing shipped yet today.</div>
        ) : (
          <>
            <div className="filter-bar" style={{paddingBottom:8}}>
              <div style={{flex:1}}/>
              <div style={{position:"relative"}}>
                <button className="btn btn-o btn-sm" onClick={()=>setShowFilterP(v=>!v)}>
                  ⚡ Filters {shippedF.activeFilters.length>0 && <span style={{background:"var(--ac)",color:"#fff",borderRadius:10,padding:"0 5px",fontSize:9,marginLeft:3}}>{shippedF.activeFilters.length}</span>}
                </button>
                {showFilterP && (
                  <FilterPanel colDefs={cols} rows={shippedToday}
                    filters={shippedF.filters} setFilter={shippedF.setFilter}
                    clearAll={shippedF.clearAll} onClose={()=>setShowFilterP(false)} />
                )}
              </div>
              <div style={{position:"relative"}}>
                <button className="btn btn-o btn-sm" onClick={()=>setShowColPanel(v=>!v)}>⚙ Columns</button>
                {showColPanel && <ColPanel cols={cols} setCols={setCols} onClose={()=>setShowColPanel(false)} />}
              </div>
              <button className="btn btn-o btn-sm"
                onClick={()=>exportToCSV(shippedF.filtered, cols, "shipped_today")}>
                ↓ CSV
              </button>
            </div>
            <FilterChips colDefs={cols} activeFilters={shippedF.activeFilters} clearFilter={shippedF.clearFilter} clearAll={shippedF.clearAll} />
            <div className="tw"><div className="ts">
              <table className="tbl">
                <thead><tr>{visCols.map(c=><th key={c.id} className="no-sort">{c.label}</th>)}</tr></thead>
                <tbody>
                  {shippedF.filtered.map(l=>(
                    <tr key={l.sku}>{visCols.map(c=><td key={c.id}>{renderCell(c.id,l)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div></div>
          </>
        )}
      </div>

      {/* To Ship section */}
      <div className="sh">
        <div className="st">
          To Ship
          <span className="ss">{toShip.length} awaiting dispatch</span>
        </div>
        {toShip.length > 0 && (
          <button className="btn btn-g btn-sm" onClick={markAllShipped}>
            ✓ Mark All Shipped
          </button>
        )}
      </div>

      {!toShip.length ? (
        <div className="tw" style={{padding:"30px 24px",textAlign:"center"}}>
          <div style={{fontSize:28,marginBottom:9,opacity:.2}}>✓</div>
          <div style={{fontWeight:900,textTransform:"uppercase",letterSpacing:".4px",marginBottom:5}}>All Clear</div>
          <div style={{fontSize:12,color:"var(--txm)"}}>Everything has been shipped!</div>
        </div>
      ) : byPlat.map(([plat, items]) => (
        <div key={plat} className="ship-plat">
          <div className="ship-plat-h">
            <span>{plat}</span>
            <span className="badge b-r">{items.length} to ship</span>
          </div>
          {items.map(l => (
            <div key={l.sku} className="ship-row">
              <span className="sku" style={{minWidth:52}}>{l.sku}</span>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:12}}>{l.name}</div>
                <div style={{fontSize:11,color:"var(--txm)"}}>
                  {l.colour} · {l.size} · Sold {l.daySold}
                </div>
              </div>
              <span style={{fontWeight:700,color:"var(--gn)",fontSize:13,marginRight:10}}>
                {fmt(l.soldPrice)}
              </span>
              <button className="btn btn-g btn-sm" onClick={() => markShipped(l.sku)}>
                Mark Shipped ✓
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DASHBOARD — Command 9
═══════════════════════════════════════════════════════════════ */
function Dashboard({ listings, stockData, weeklyGoal, setWeeklyGoal, monthlyGoal, setMonthlyGoal }) {
  const sold    = listings.filter(l => l.sold);
  const active  = listings.filter(l => l.listed && !l.sold);
  const soldWk  = listings.filter(l => l.sold && l.daySold && l.daySold >= WEEK_START);
  const soldMo  = listings.filter(l => l.sold && l.daySold && l.daySold >= MONTH_START);

  const totalRevenue  = sold.reduce((a,l) => a+(l.soldPrice||0), 0);
  const totalStockSpend = stockData.reduce((a,s) => a+(s.totalCost||s.sellable*s.costPer||0), 0);
  const totalProfit   = totalRevenue - totalStockSpend; // true business P&L
  // Sell-through = active / sold (matches spreadsheet)
  const sellThruPct   = sold.length ? Math.round(active.length/sold.length*100) : 0;
  // avgProfit per sale = avg (soldPrice - costPerItem) using per-listing profit field
  const avgProfit     = sold.length ? sold.reduce((a,l)=>a+(l.profit||0),0)/sold.length : 0;

  const wkProfit = soldWk.reduce((a,l) => a+(l.profit||0), 0);
  const moProfit = soldMo.reduce((a,l) => a+(l.profit||0), 0);
  const wg = parseFloat(weeklyGoal)||0;
  const mg = parseFloat(monthlyGoal)||0;
  const wPct = wg ? Math.min(100, Math.round(wkProfit/wg*100)) : 0;
  const mPct = mg ? Math.min(100, Math.round(moProfit/mg*100)) : 0;

  const GoalCard = ({ title, period, profit, goal, setGoal, val, pct }) => (
    <div style={{background:"var(--sf)",border:"1px solid var(--bd)",borderRadius:"var(--r2)",padding:"14px 15px",boxShadow:"var(--sh)"}}>
      <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:"var(--txm)",marginBottom:3}}>{title}</div>
      <div style={{fontSize:11,color:"var(--txd)",marginBottom:9}}>{period}</div>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
        <span style={{fontSize:11,color:"var(--txm)"}}>Target: £</span>
        <input
          type="text"
          inputMode="decimal"
          value={val}
          onChange={e => {
            const v = e.target.value;
            if (/^\d*\.?\d*$/.test(v)) setGoal(v);
          }}
          placeholder="0"
          style={{width:80,background:"var(--sf2)",border:"1px solid var(--bdd)",borderRadius:"var(--r)",padding:"4px 8px",fontFamily:"Arial,sans-serif",fontSize:13,fontWeight:700,outline:"none",color:"var(--tx)"}}
        />
        {goal > 0 && (
          <span style={{fontSize:12,fontWeight:700,color:pct>=100?"var(--gn)":pct>=60?"var(--am)":"var(--txm)"}}>
            {pct}%
          </span>
        )}
      </div>
      <div style={{height:7,background:"var(--sf2)",borderRadius:4,overflow:"hidden",marginBottom:5}}>
        <div style={{height:"100%",borderRadius:4,width:`${pct}%`,background:pct>=100?"var(--gn)":pct>=60?"var(--am)":"var(--ac)",transition:"width .5s ease"}} />
      </div>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"var(--txm)"}}>
        <span style={{fontWeight:700,color:"var(--gn)"}}>{fmt(profit)} made</span>
        {goal > 0 && <span>{pct<100 ? `${fmt(goal-profit)} to go` : "🎉 Goal hit!"}</span>}
      </div>
      {goal>0 && pct<100 && avgProfit>0 && (
        <div style={{fontSize:11,color:"var(--txd)",marginTop:4}}>
          ≈ {Math.ceil((goal-profit)/avgProfit)} more sales at avg {fmt(avgProfit)}
        </div>
      )}
    </div>
  );

  return (
    <div>
      {/* KPI cards */}
      <div className="kg kg4">
        {[
          {l:"Total Revenue",   v: sold.length ? fmt(totalRevenue) : "—",  b:"",   s:`${sold.length} items sold`},
          {l:"Net Profit",      v: sold.length ? fmt(totalProfit)  : "—",  b:"gn", s:"After stock costs"},
          {l:"Sell-through",    v: sold.length ? `${sellThruPct}%` : "—",  b:"nv", s:`${sold.length} of ${sold.length+active.length} items`},
          {l:"Active Listings", v: active.length,                           b:"am", s:"Currently live"},
        ].map(k => (
          <div key={k.l} className={`kc ${k.v==="—"?"empty":""}`}>
            <div className={`kb ${k.b}`}/>
            <div className="kl">{k.l}</div>
            <div className="kv" style={{fontSize:typeof k.v==="string"&&k.v.startsWith("£")?20:24}}>{k.v}</div>
            <div className="ks">{k.s}</div>
          </div>
        ))}
      </div>

      {/* Goal cards */}
      <div className="two-col" style={{marginBottom:16}}>
        <GoalCard
          title="Weekly Profit Goal" period={`w/c ${WEEK_START}`}
          profit={wkProfit} goal={wg} setGoal={setWeeklyGoal} val={weeklyGoal} pct={wPct}
        />
        <GoalCard
          title="Monthly Profit Goal"
          period={NOW.toLocaleDateString("en-GB",{month:"long",year:"numeric"})}
          profit={moProfit} goal={mg} setGoal={setMonthlyGoal} val={monthlyGoal} pct={mPct}
        />
      </div>

      {/* Quick stats row */}
      <div className="kg kg4" style={{marginBottom:0}}>
        {[
          {l:"This Week — Sold",     v: soldWk.length,                                              s:`${fmt(soldWk.reduce((a,l)=>a+(l.soldPrice||0),0))} proceeds`},
          {l:"This Month — Sold",    v: soldMo.length,                                              s:`${fmt(soldMo.reduce((a,l)=>a+(l.soldPrice||0),0))} proceeds`},
          {l:"Avg Profit / Sale",    v: avgProfit>0 ? fmt(avgProfit) : "—",                         s:"All time"},
          {l:"To Be Listed",         v: listings.filter(l=>!l.listed&&!l.sold).length,              s:"Ready to post"},
        ].map(k => (
          <div key={k.l} className={`kc ${k.v==="—"?"empty":""}`}>
            <div className="kb nv"/>
            <div className="kl">{k.l}</div>
            <div className="kv" style={{fontSize:typeof k.v==="string"&&k.v.startsWith("£")?18:24}}>{k.v}</div>
            <div className="ks">{k.s}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   LIVE DATA — Command 9
═══════════════════════════════════════════════════════════════ */
function LiveData({ listings, stockData, liveData, setLiveData }) {
  const set = (k, v) => setLiveData(prev => ({ ...prev, [k]: v }));
  const { vinted="", withdrawn="", ebayBal="", ebayPend="", depopPend="", vintedPend="", whatnotPend="", profitPocketed="", globalNotes="" } = liveData;

  // Notify 45s after notes stop changing
  const prevNotesRef = React.useRef(globalNotes);
  React.useEffect(() => {
    if (globalNotes === prevNotesRef.current) return;
    const timer = setTimeout(() => {
      if (globalNotes.trim()) {
        sendPushNotification({
          title: "ArchiveDistrict",
          body:  `📝 Note: ${globalNotes.slice(0, 80)}${globalNotes.length > 80 ? "…" : ""}`,
          tag:   "live-notes",
        });
      }
      prevNotesRef.current = globalNotes;
    }, 45000);
    return () => clearTimeout(timer);
  }, [globalNotes]);

  const v=+vinted||0, w=+withdrawn||0, eb=+ebayBal||0;
  const ep=+ebayPend||0, dp=+depopPend||0, vp=+vintedPend||0, wp=+whatnotPend||0;
  const total  = v+w+eb;
  const totalP = total+ep+dp+vp+wp;

  const sold    = listings.filter(l => l.sold);
  const active  = listings.filter(l => l.listed && !l.sold);
  const inventory = listings.filter(l => !l.sold);

  // Use actual money paid for stock (totalCost field), including undelivered bundles
  const totalSpent   = stockData.reduce((a,s) => a+(s.totalCost||s.sellable*s.costPer||0), 0);
  const totalProc    = sold.reduce((a,l) => a+(l.soldPrice||0), 0);
  // True business P&L: proceeds minus all stock spend (including unsold/undelivered)
  const net          = totalProc - totalSpent;
  const avgSP        = sold.length ? totalProc/sold.length : 0;
  const avgPr        = sold.length ? sold.reduce((a,l)=>a+(l.profit||0),0)/sold.length : 0;
  // Sell-through = active listings / total sold (matches spreadsheet formula)
  const st           = sold.length ? Math.round(active.length/sold.length*100) : 0;

  const soldWk  = listings.filter(l => l.sold && l.daySold && l.daySold >= WEEK_START);
  const soldMo  = listings.filter(l => l.sold && l.daySold && l.daySold >= MONTH_START);
  const listedWk = listings.filter(l => l.listed && l.dayListed && l.dayListed >= WEEK_START);
  const listedMo = listings.filter(l => l.listed && l.dayListed && l.dayListed >= MONTH_START);

  const stockThisWk = stockData.filter(s => s.datePurchased && s.datePurchased >= WEEK_START);
  const stockThisMo = stockData.filter(s => s.datePurchased && s.datePurchased >= MONTH_START);

  const Row = ({label, val, bold, colour}) => (
    <div className="lr">
      <span className={`ll${bold?" b":""}`}>{label}</span>
      <span className={`lv${colour?` ${colour}`:""}`}>{val}</span>
    </div>
  );

  return (
    <div className="livedata-grid">
      {/* Left column */}
      <div>
        {/* Cash */}
        <div className="ls">
          <div className="lst">💰 Liquid Cash</div>
          <div className="lr">
            <span className="ll">Vinted Balance</span>
            <input className="ei" placeholder="£0.00" inputMode="decimal" type="text" pattern="[0-9.]*" value={vinted} onChange={e=>set("vinted",e.target.value)} />
          </div>
          <div className="lr">
            <span className="ll">eBay Balance</span>
            <input className="ei" placeholder="£0.00" inputMode="decimal" type="text" pattern="[0-9.]*" value={ebayBal} onChange={e=>set("ebayBal",e.target.value)} />
          </div>
          <div className="lr">
            <span className="ll">Withdrawn / Monzo Pot</span>
            <input className="ei" placeholder="£0.00" inputMode="decimal" type="text" pattern="[0-9.]*" value={withdrawn} onChange={e=>set("withdrawn",e.target.value)} />
          </div>

          {/* Profit Pocketed — weekly log */}
          <div style={{background:"var(--gnl)",borderRadius:"var(--r)",padding:"8px 10px",marginTop:6,marginBottom:6}}>
            <div className="ll b" style={{color:"var(--gn)",marginBottom:6}}>💰 Profit Pocketed This Week</div>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <input
                id="pocketInput"
                className="ei"
                placeholder="£0.00"
                inputMode="decimal"
                type="text"
                pattern="[0-9.]*"
                style={{flex:1,background:"var(--gnl)",border:"1px solid rgba(31,92,53,.2)"}}
              />
              <button
                className="btn btn-sm"
                style={{background:"var(--gn)",color:"#fff",border:"none",whiteSpace:"nowrap"}}
                onClick={() => {
                  const input = document.getElementById("pocketInput");
                  const val = parseFloat(input.value.replace(/[^0-9.]/g,""));
                  if (!val || isNaN(val)) return;
                  const entry = { date: getToday(), amount: val, week: WEEK_START };
                  const existing = liveData.profitLog || [];
                  set("profitLog", [...existing, entry]);
                  input.value = "";
                }}
              >Log</button>
            </div>
            {/* Show this week's total */}
            {(() => {
              const log = liveData.profitLog || [];
              const wkTotal = log.filter(e => e.week === WEEK_START).reduce((a,e)=>a+e.amount,0);
              return wkTotal > 0 ? (
                <div style={{fontSize:11,color:"var(--gn)",marginTop:6,fontWeight:700}}>
                  This week: {fmt(wkTotal)}
                </div>
              ) : null;
            })()}
          </div>
          <div style={{fontSize:10,color:"var(--txm)",marginBottom:6,paddingLeft:4}}>
            Log each time you move profit to your bank — History will show weekly totals
          </div>

          <div className="lr tot"><span className="ll b">Total Cash</span><span className="lv gn">{fmt(total)}</span></div>

          <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:"var(--txm)",margin:"11px 0 5px"}}>Pending Payouts</div>
          <div className="lr"><span className="ll">eBay</span><input className="ei" placeholder="£0.00" inputMode="decimal" type="text" pattern="[0-9.]*" value={ebayPend} onChange={e=>set("ebayPend",e.target.value)} /></div>
          <div className="lr"><span className="ll">Depop</span><input className="ei" placeholder="£0.00" inputMode="decimal" type="text" pattern="[0-9.]*" value={depopPend} onChange={e=>set("depopPend",e.target.value)} /></div>
          <div className="lr"><span className="ll">Vinted</span><input className="ei" placeholder="£0.00" inputMode="decimal" type="text" pattern="[0-9.]*" value={vintedPend} onChange={e=>set("vintedPend",e.target.value)} /></div>
          <div className="lr"><span className="ll">Whatnot</span><input className="ei" placeholder="£0.00" inputMode="decimal" type="text" pattern="[0-9.]*" value={whatnotPend} onChange={e=>set("whatnotPend",e.target.value)} /></div>
          <div className="lr tot"><span className="ll b">Total + Pending</span><span className="lv gn">{fmt(totalP)}</span></div>

          <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:"var(--txm)",margin:"11px 0 7px"}}>Cash Breakdown</div>
          <div className="pct-g">
            {[80,60,40,30,20,10].map(p => (
              <div key={p} className="pct-c">
                <div className="pct-l">{p}%</div>
                <div className="pct-v">{fmt(total*(p/100))}</div>
              </div>
            ))}
          </div>
        </div>

        {/* This Week */}
        <div className="ls">
          <div className="lst">📅 This Week — w/c {WEEK_START}</div>
          <Row label="Items Listed"   val={listedWk.length} />
          <Row label="Items Sold"     val={soldWk.length} />
          <Row label="Proceeds"       val={fmt(soldWk.reduce((a,l)=>a+(l.soldPrice||0),0))} bold colour="gn" />
          <Row label="Stock Purchased" val={stockThisWk.length > 0 ? `${stockThisWk.length} batch${stockThisWk.length!==1?"es":""}` : "—"} />
          <Row label="Stock Spend"    val={stockThisWk.length ? fmt(stockThisWk.reduce((a,s)=>a+s.sellable*s.costPer,0)) : "—"} />
        </div>

        {/* This Month */}
        <div className="ls">
          <div className="lst">📆 {NOW.toLocaleDateString("en-GB",{month:"long",year:"numeric"})}</div>
          <Row label="Items Listed"   val={listedMo.length} />
          <Row label="Items Sold"     val={soldMo.length} />
          <Row label="Proceeds"       val={fmt(soldMo.reduce((a,l)=>a+(l.soldPrice||0),0))} />
          <Row label="Stock Purchased" val={stockThisMo.length > 0 ? `${stockThisMo.length} batch${stockThisMo.length!==1?"es":""}` : "—"} />
          <Row label="Stock Spend"    val={stockThisMo.length ? fmt(stockThisMo.reduce((a,s)=>a+s.sellable*s.costPer,0)) : "—"} bold colour="rd" />
        </div>
      </div>

      {/* Right column — P&L */}
      <div>
        <div className="ls">
          <div className="lst">📊 Profit & Loss — Live</div>
          <Row label="Total Spent on Stock" val={fmt(totalSpent)} colour="rd" />
          <Row label="Total Proceeds"       val={fmt(totalProc)}  colour="gn" />
          <div className="lr tot">
            <span className="ll b">Net Profit / Loss</span>
            <span className={`lv ${net>=0?"gn":"rd"}`}>{fmt(net)}</span>
          </div>
          <div style={{height:8}} />
          <Row label="Items in Inventory"   val={inventory.length} />
          <Row label="Active Listings"      val={active.length} />
          <Row label="Total Items Sold"     val={sold.length} />
          <Row label="Avg Sold Price"       val={avgSP>0?fmt(avgSP):"—"} />
          <Row label="Avg Profit / Item"    val={avgPr>0?fmt(avgPr):"—"} colour="gn" />
          <Row label="Sell-through %"       val={`${st}%`} />
          <div className="lr tot">
            <span className="ll b">Cash Available to Buy</span>
            <span className="lv gn">{fmt(total)}</span>
          </div>
        </div>
      </div>

      {/* Global Notes */}
      <div style={{marginTop:14,gridColumn:"1/-1"}}>
        <div className="ls">
          <div className="lst">📝 Global Notes</div>
          <textarea
            placeholder="Add any notes, reminders, or context here — saved automatically…"
            value={globalNotes}
            onChange={e=>set("globalNotes",e.target.value)}
            style={{
              width:"100%",minHeight:100,padding:"10px 12px",
              background:"var(--sf2)",border:"1px solid var(--bd)",
              borderRadius:"var(--r)",fontSize:13,color:"var(--tx)",
              resize:"vertical",fontFamily:"inherit",lineHeight:1.5,
              boxSizing:"border-box",marginTop:6,
            }}
          />
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PRICE CALCULATOR — Command 9
═══════════════════════════════════════════════════════════════ */
function PriceCalculator({ listings=[] }) {
  const [mode,          setMode]         = useState("manual"); // "manual" | "sku"
  const [skuSearch,     setSkuSearch]    = useState("");
  const [selectedSku,   setSelectedSku]  = useState(null);
  const [cost,          setCost]         = useState("");
  const [targetProfit,  setTargetProfit] = useState("");
  const [targetMargin,  setTargetMargin] = useState("");

  // SKU picker dropdown
  const unsold = listings.filter(l => !l.sold);
  const skuMatches = useMemo(() => {
    if (!skuSearch.trim()) return [];
    const s = skuSearch.toLowerCase();
    return unsold.filter(l =>
      l.sku.toLowerCase().includes(s) ||
      (l.brand||"").toLowerCase().includes(s) ||
      (l.colour||"").toLowerCase().includes(s) ||
      (l.size||"").toLowerCase().includes(s)
    ).slice(0, 8);
  }, [skuSearch, unsold]);

  const selectItem = (item) => {
    setSelectedSku(item);
    setSkuSearch(`${item.sku} · ${item.brand} ${item.colour} ${item.size}`);
    setCost(String(item.price || ""));
  };

  const c  = parseFloat(cost)         || 0;
  const tp = parseFloat(targetProfit) || 0;
  const tm = parseFloat(targetMargin) || 0;

  const calcFor = (fee) => {
    if (tp > 0) {
      const price = (c + tp) / (1 - fee/100);
      const net   = price * (1 - fee/100);
      return { price, net, profit: net - c };
    }
    if (tm > 0) {
      const price = c / (1 - fee/100 - tm/100);
      const net   = price * (1 - fee/100);
      return { price, net, profit: net - c };
    }
    return null;
  };

  const results = PLATFORMS
    .map(p => ({ platform:p, fee:PLAT_FEES[p], ...calcFor(PLAT_FEES[p]) }))
    .filter(r => r.price && r.price > 0);

  const best = results.length
    ? results.reduce((a,b) => a.profit > b.profit ? a : b)
    : null;

  return (
    <div>
      <div className="calc-box">
        <div className="calc-title">Price Calculator</div>

        {/* Mode toggle */}
        <div style={{display:"flex",gap:8,marginBottom:14}}>
          <button
            onClick={()=>{ setMode("manual"); setSelectedSku(null); setSkuSearch(""); }}
            style={{flex:1,padding:"7px",border:`1.5px solid ${mode==="manual"?"var(--ac)":"var(--bd)"}`,borderRadius:"var(--r)",background:mode==="manual"?"var(--acl)":"var(--sf2)",color:mode==="manual"?"var(--ac)":"var(--txm)",cursor:"pointer",fontSize:12,fontWeight:700}}
          >✎ Manual entry</button>
          <button
            onClick={()=>setMode("sku")}
            style={{flex:1,padding:"7px",border:`1.5px solid ${mode==="sku"?"var(--ac)":"var(--bd)"}`,borderRadius:"var(--r)",background:mode==="sku"?"var(--acl)":"var(--sf2)",color:mode==="sku"?"var(--ac)":"var(--txm)",cursor:"pointer",fontSize:12,fontWeight:700}}
          >🔍 Select SKU</button>
        </div>

        {/* SKU picker */}
        {mode==="sku" && (
          <div style={{marginBottom:14,position:"relative"}}>
            <label className="fl">Search SKU, brand, colour, size</label>
            <div className="sw" style={{width:"100%"}}>
              <span className="si">⌕</span>
              <input className="fi" style={{width:"100%"}} placeholder="e.g. A127 or Navy M"
                value={skuSearch}
                onChange={e=>{ setSkuSearch(e.target.value); setSelectedSku(null); setCost(""); }}
              />
            </div>
            {skuSearch && !selectedSku && skuMatches.length > 0 && (
              <div style={{position:"absolute",top:"100%",left:0,right:0,background:"var(--sf)",border:"1px solid var(--bd)",borderRadius:"var(--r)",zIndex:50,boxShadow:"var(--shm)",maxHeight:220,overflowY:"auto",marginTop:2}}>
                {skuMatches.map(l=>(
                  <div key={l.sku} onClick={()=>selectItem(l)}
                    style={{padding:"9px 12px",cursor:"pointer",fontSize:12,borderBottom:"1px solid var(--bd)",display:"flex",justifyContent:"space-between"}}
                    onMouseEnter={e=>e.currentTarget.style.background="var(--sf2)"}
                    onMouseLeave={e=>e.currentTarget.style.background=""}>
                    <div>
                      <span className="sku" style={{marginRight:8}}>{l.sku}</span>
                      <span style={{color:"var(--txm)"}}>{l.brand} · {l.colour} · {l.size}</span>
                    </div>
                    <span style={{fontWeight:700,color:"var(--tx)"}}>£{l.price?.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
            {selectedSku && (
              <div style={{marginTop:5,fontSize:11,color:"var(--gn)",fontWeight:700}}>
                ✓ {selectedSku.sku} — cost £{selectedSku.price?.toFixed(2)} loaded
              </div>
            )}
          </div>
        )}

        <div className="calc-row">
          <span className="calc-lbl">Cost paid for item £</span>
          <input className="calc-in" placeholder="e.g. 17.80"
            inputMode="decimal" type="text"
            value={cost} onChange={e=>{ if(/^\d*\.?\d*$/.test(e.target.value)) setCost(e.target.value); }} />
        </div>
        <div style={{margin:"4px 0 10px",fontSize:11,color:"var(--txd)"}}>
          Set either a target profit <strong>or</strong> a target margin — not both:
        </div>
        <div className="calc-row">
          <span className="calc-lbl">Target profit £</span>
          <input className="calc-in" placeholder="e.g. 15.00"
            inputMode="decimal" type="text"
            value={targetProfit}
            onChange={e=>{ if(/^\d*\.?\d*$/.test(e.target.value)){ setTargetProfit(e.target.value); setTargetMargin(""); }}} />
        </div>
        <div className="calc-row">
          <span className="calc-lbl">Target margin %</span>
          <input className="calc-in" placeholder="e.g. 45"
            inputMode="decimal" type="text"
            value={targetMargin}
            onChange={e=>{ if(/^\d*\.?\d*$/.test(e.target.value)){ setTargetMargin(e.target.value); setTargetProfit(""); }}} />
        </div>
      </div>

      {results.length > 0 && (
        <div className="calc-box">
          <div className="calc-title">Recommended Listing Prices</div>
          <div className="plat-cards">
            {results.map(r => (
              <div key={r.platform} className={`plat-card ${r.platform===best?.platform?"best":""}`}>
                <div className="plat-name">
                  {r.platform}
                  {r.platform===best?.platform && " 🏆"}
                </div>
                <div className="plat-price">{fmt(r.price)}</div>
                <div style={{fontSize:11,color:"var(--gn)",fontWeight:700,marginBottom:2}}>
                  Net: {fmt(r.net)}
                </div>
                <div style={{fontSize:11,color:"var(--gn)",fontWeight:700,marginBottom:3}}>
                  Profit: {fmt(r.profit)}
                </div>
                <div className="plat-fee">{r.fee}% fee</div>
              </div>
            ))}
          </div>
          {c > 0 && best && (
            <div style={{marginTop:11,fontSize:11,color:"var(--txm)",background:"var(--gnl)",padding:"8px 12px",borderRadius:"var(--r)",border:"1px solid rgba(31,92,53,.2)"}}>
              Best platform: <strong>{best.platform}</strong> — list at <strong>{fmt(best.price)}</strong> to earn <strong style={{color:"var(--gn)"}}>{fmt(best.profit)}</strong> profit
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ANALYTICS — Command 10
═══════════════════════════════════════════════════════════════ */
const SLOW_COLS = [
  {id:"sku",      label:"SKU",       visible:true },
  {id:"name",     label:"Stock Name",visible:true },
  {id:"colour",   label:"Colour",    visible:true },
  {id:"size",     label:"Size",      visible:true },
  {id:"tag",      label:"Mover",     visible:true },
  {id:"daysLive", label:"Days Live", visible:true },
  {id:"price",    label:"Cost £",    visible:true },
  {id:"bundleSku",label:"Bundle",    visible:false},
  {id:"platform", label:"Platform",  visible:false},
  {id:"dayListed",label:"Listed On", visible:false},
];

function Analytics({ listings, stockData }) {
  const [slowCols,       setSlowCols]      = useState(SLOW_COLS);
  const [showSlowCP,     setShowSlowCP]    = useState(false);
  const [slowSortCol,    setSlowSortCol]   = useState("daysLive");
  const [slowSortDir,    setSlowSortDir]   = useState("desc");

  const derived = useMemo(() => deriveStock(stockData, listings), [stockData, listings]);

  /* Slow movers — active listings 14+ days */
  const slowRaw = useMemo(() => listings
    .filter(l => l.listed && !l.sold && l.dayListed)
    .map(l => ({
      ...l,
      daysLive: Math.max(0, Math.floor(
        (new Date(TODAY) - new Date(l.dayListed)) / 86400000
      )),
      tag: getTag(l.name, l.type, l.brand, listings),
    }))
    .filter(l => l.daysLive >= 14),
  [listings]);

  const slowF = useTableFilters(slowRaw, slowCols);

  const slowSorted = useMemo(() => {
    if (!slowSortCol) return slowF.filtered;
    return [...slowF.filtered].sort((a,b) => {
      const av=a[slowSortCol], bv=b[slowSortCol];
      if (av==null) return 1; if (bv==null) return -1;
      const res = typeof av==="number" ? av-bv : String(av).localeCompare(String(bv));
      return slowSortDir==="asc" ? res : -res;
    });
  }, [slowF.filtered, slowSortCol, slowSortDir]);

  const onSlowSort = (col) => {
    setSlowSortDir(d => slowSortCol===col ? (d==="asc"?"desc":"asc") : "desc");
    setSlowSortCol(col);
  };

  /* Bar chart helper */
  const BarChart = ({ data, labelKey, valKey, colour, fmt: fmtFn, maxOverride }) => {
    const max = maxOverride || Math.max(...data.map(d => d[valKey]), 1);
    return (
      <div>
        {data.map((d,i) => (
          <div key={i} className="ana-bar-row">
            <div className="ana-bar-label" style={{width:160}}>{d[labelKey]}</div>
            <div className="ana-bar-track">
              <div className="ana-bar-fill" style={{
                width:`${Math.round((d[valKey]/max)*100)}%`,
                background: colour || "var(--ac)",
              }}/>
            </div>
            <div className="ana-bar-val">{fmtFn ? fmtFn(d[valKey]) : d[valKey]}</div>
          </div>
        ))}
      </div>
    );
  };

  const revenueData = [...derived]
    .sort((a,b) => b.netProceeds - a.netProceeds)
    .map(s => ({ label: s.name.length > 22 ? s.name.slice(0,22)+"…" : s.name, val: s.netProceeds }));

  const sellThruData = [...derived]
    .sort((a,b) => b.sellThru - a.sellThru)
    .map(s => ({ label: s.name.length > 22 ? s.name.slice(0,22)+"…" : s.name, val: s.sellThru, colour: s.sellThru>60?"var(--gn)":s.sellThru>30?"var(--am)":"var(--ac)" }));

  const renderSlowCell = (col, l) => {
    if (col==="sku")      return <span className="sku">{l.sku}</span>;
    if (col==="name")     return <span style={{fontWeight:600}}>{l.name}</span>;
    if (col==="colour")   return l.colour;
    if (col==="size")     return <span style={{color:"var(--txm)"}}>{l.size}</span>;
    if (col==="tag")      return <MovTag tag={l.tag}/>;
    if (col==="daysLive") return <span style={{fontWeight:700,color:l.daysLive>30?"var(--ac)":l.daysLive>21?"var(--am)":"var(--tx)"}}>{l.daysLive}d</span>;
    if (col==="price")    return fmt(l.price);
    if (col==="bundleSku")return <span className="bsku">{l.bundleSku}</span>;
    if (col==="platform") return l.platform ? <span className="badge b-b">{l.platform}</span> : <span style={{color:"var(--txd)"}}>—</span>;
    if (col==="dayListed")return <span style={{color:"var(--txm)",fontSize:11}}>{l.dayListed||"—"}</span>;
    return "—";
  };

  const visSlow = slowCols.filter(c => c.visible);

  return (
    <div>
      {/* Revenue + Sell-through charts */}
      <div className="ana-cols" style={{marginBottom:14}}>
        <div className="tw" style={{padding:"16px 18px"}}>
          <div className="st" style={{marginBottom:12}}>Revenue by Bundle</div>
          <BarChart
            data={revenueData}
            labelKey="label" valKey="val"
            colour="#c4a882"
            fmt={fmt}
          />
        </div>
        <div className="tw" style={{padding:"16px 18px"}}>
          <div className="st" style={{marginBottom:12}}>Sell-through %</div>
          {sellThruData.map((d,i) => (
            <div key={i} className="ana-bar-row">
              <div className="ana-bar-label" style={{width:110}}>{d.label}</div>
              <div className="ana-bar-track">
                <div className="ana-bar-fill" style={{width:`${d.val}%`,background:d.colour}}/>
              </div>
              <div className="ana-bar-val">{d.val}%</div>
            </div>
          ))}
        </div>
      </div>

      {/* Slow Movers table */}
      <div className="sh">
        <div className="st">
          Slow Movers — 14+ Days Unsold
          <span className="ss">{slowSorted.length} item{slowSorted.length!==1?"s":""}</span>
        </div>
      </div>

      <div className="filter-bar" style={{paddingBottom:10}}>
        <div style={{flex:1}}/>
        <div style={{position:"relative"}}>
          <button className="btn btn-o btn-sm" onClick={()=>slowF.setShowPanel(v=>!v)}>
            ⚡ Filters {slowF.activeFilters.length>0 && <span style={{background:"var(--ac)",color:"#fff",borderRadius:10,padding:"0 5px",fontSize:9,marginLeft:3}}>{slowF.activeFilters.length}</span>}
          </button>
          {slowF.showPanel && (
            <FilterPanel colDefs={slowCols} rows={slowRaw}
              filters={slowF.filters} setFilter={slowF.setFilter}
              clearAll={slowF.clearAll} onClose={()=>slowF.setShowPanel(false)} />
          )}
        </div>
        <div style={{position:"relative"}}>
          <button className="btn btn-o btn-sm" onClick={()=>setShowSlowCP(v=>!v)}>⚙ Columns</button>
          {showSlowCP && <ColPanel cols={slowCols} setCols={setSlowCols} onClose={()=>setShowSlowCP(false)} />}
        </div>
        <button className="btn btn-o btn-sm"
          onClick={()=>exportToCSV(slowSorted, slowCols, "slow_movers")}>
          ↓ CSV
        </button>
      </div>

      <FilterChips colDefs={slowCols} activeFilters={slowF.activeFilters} clearFilter={slowF.clearFilter} clearAll={slowF.clearAll} />

      <div className="tw"><div className="ts">
        <table className="tbl">
          <thead>
            <tr>
              {visSlow.map(c => (
                <STh key={c.id} col={c.id} sortCol={slowSortCol} sortDir={slowSortDir} onSort={onSlowSort}>
                  {c.label}
                </STh>
              ))}
            </tr>
          </thead>
          <tbody>
            {slowSorted.length===0 ? (
              <tr><td colSpan={visSlow.length} style={{textAlign:"center",padding:26,color:"var(--txd)"}}>
                {slowRaw.length===0 ? "No listings have been unsold for 14+ days. 🎉" : "No items match filters."}
              </td></tr>
            ) : slowSorted.map(l => (
              <tr key={l.sku}>
                {visSlow.map(c => <td key={c.id}>{renderSlowCell(c.id, l)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div></div>

      {/* Restock recommendations */}
      {derived.filter(s=>s.restock).length > 0 && (
        <div style={{marginTop:14}}>
          <div className="st" style={{marginBottom:10}}>Restock Recommendations</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:10}}>
            {derived.filter(s=>s.restock).map(s => (
              <div key={`${s.bundleSku}-${s.name}`} style={{padding:"11px 13px",border:"1px solid var(--bd)",borderRadius:"var(--r2)",background:"var(--sf)",boxShadow:"var(--sh)"}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                  <span style={{fontWeight:700,fontSize:12}}>{s.name.length>24?s.name.slice(0,24)+"…":s.name}</span>
                  <span className="badge b-r">Restock</span>
                </div>
                <div style={{fontSize:11,color:"var(--txm)"}}>
                  {fmt(s.avgProfit)} avg profit · {s.sellThru}% sell-through · {s.qtyRemaining} left
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   GROWTH — Command 10
═══════════════════════════════════════════════════════════════ */
function Growth({ listings, stockData }) {
  const sold    = listings.filter(l => l.sold);
  const active  = listings.filter(l => l.listed && !l.sold);
  const soldWk  = listings.filter(l => l.sold && l.daySold && l.daySold >= WEEK_START);
  const soldMo  = listings.filter(l => l.sold && l.daySold && l.daySold >= MONTH_START);
  const totalRevenue = sold.reduce((a,l)=>a+(l.soldPrice||0),0);
  const totalProfit  = sold.reduce((a,l)=>a+(l.profit||0),0);
  const st = sold.length ? Math.round(active.length/sold.length*100) : 0;

  return (
    <div>
      <div className="kg kg3" style={{marginBottom:14}}>
        {[
          {l:"All-time Revenue", v:sold.length?fmt(totalRevenue):"—", b:"",   s:`${sold.length} items sold`},
          {l:"All-time Profit",  v:sold.length?fmt(totalProfit):"—",  b:"gn", s:"Net after stock costs"},
          {l:"Sell-through %",  v:sold.length?`${st}%`:"—",           b:"nv", s:`${sold.length} of ${sold.length+active.length}`},
        ].map(k=>(
          <div key={k.l} className={`kc ${k.v==="—"?"empty":""}`}>
            <div className={`kb ${k.b}`}/>
            <div className="kl">{k.l}</div>
            <div className="kv" style={{fontSize:typeof k.v==="string"&&k.v.startsWith("£")?18:24}}>{k.v}</div>
            <div className="ks">{k.s}</div>
          </div>
        ))}
      </div>
      {/* Weekly revenue chart */}
      {(() => {
        const weeks = [];
        for (let i=11;i>=0;i--) {
          const ws=new Date(_wsd); ws.setDate(ws.getDate()-i*7);
          const we=new Date(ws);  we.setDate(we.getDate()+6);
          const wsStr=localDateStr(ws);
          const weStr=localDateStr(we);
          const wSold=sold.filter(l=>l.daySold&&l.daySold>=wsStr&&l.daySold<=weStr);
          weeks.push({
            label:ws.toLocaleDateString("en-GB",{day:"numeric",month:"short"}),
            revenue:wSold.reduce((a,l)=>a+(l.soldPrice||0),0),
            profit:wSold.reduce((a,l)=>a+(l.profit||0),0),
            count:wSold.length,
          });
        }
        const maxRev=Math.max(...weeks.map(w=>w.revenue),1);
        const maxProf=Math.max(...weeks.map(w=>Math.abs(w.profit)),1);
        return (
          <div className="tw" style={{padding:"18px 20px",marginBottom:14}}>
            <div className="st" style={{marginBottom:14}}>Revenue & Profit — Last 12 Weeks</div>
            <div style={{display:"flex",alignItems:"flex-end",gap:4,height:120}}>
              {weeks.map((w,i)=>(
                <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2,height:"100%",justifyContent:"flex-end"}}>
                  <div style={{width:"100%",position:"relative",height:"100%",display:"flex",flexDirection:"column",justifyContent:"flex-end",gap:2}}>
                    <div title={`Profit: ${fmt(w.profit)}`} style={{width:"100%",height:`${Math.round(Math.abs(w.profit)/maxProf*80)}%`,background:w.profit>=0?"var(--gn)":"var(--ac)",borderRadius:"2px 2px 0 0",opacity:.7,minHeight:w.profit?2:0}}/>
                    <div title={`Revenue: ${fmt(w.revenue)}`} style={{width:"100%",height:`${Math.round(w.revenue/maxRev*80)}%`,background:"var(--acl)",border:"1px solid var(--ac2)",borderRadius:"2px 2px 0 0",minHeight:w.revenue?2:0}}/>
                  </div>
                  <div style={{fontSize:9,color:"var(--txd)",whiteSpace:"nowrap",transform:"rotate(-45deg)",transformOrigin:"center",marginTop:4,width:30,textAlign:"center"}}>{w.label}</div>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:14,marginTop:18,fontSize:10,color:"var(--txm)"}}>
              <span><span style={{display:"inline-block",width:10,height:10,background:"var(--acl)",border:"1px solid var(--ac2)",borderRadius:2,marginRight:4,verticalAlign:"middle"}}/>Revenue</span>
              <span><span style={{display:"inline-block",width:10,height:10,background:"var(--gn)",borderRadius:2,marginRight:4,verticalAlign:"middle",opacity:.7}}/>Profit</span>
            </div>
          </div>
        );
      })()}

      <div className="two-col">
        {/* Best performing weeks */}
        {(() => {
          const weeks=[];
          for(let i=23;i>=0;i--){
            const ws=new Date(_wsd); ws.setDate(ws.getDate()-i*7);
            const we=new Date(ws);   we.setDate(we.getDate()+6);
            const wsStr=localDateStr(ws);
            const weStr=localDateStr(we);
            const wSold=sold.filter(l=>l.daySold&&l.daySold>=wsStr&&l.daySold<=weStr);
            const rev=wSold.reduce((a,l)=>a+(l.soldPrice||0),0);
            if(rev>0) weeks.push({label:ws.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"2-digit"}),revenue:rev,count:wSold.length});
          }
          weeks.sort((a,b)=>b.revenue-a.revenue);
          return (
            <div className="tw" style={{padding:"16px 18px"}}>
              <div className="st" style={{marginBottom:10}}>🏆 Best Weeks by Revenue</div>
              {weeks.slice(0,5).map((w,i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid var(--bd)",fontSize:12}}>
                  <span><span style={{fontWeight:700,color:"var(--ac)",marginRight:8}}>#{i+1}</span>{w.label}</span>
                  <span style={{fontWeight:700,color:"var(--gn)"}}>{fmt(w.revenue)}<span style={{fontSize:10,color:"var(--txd)",marginLeft:6}}>{w.count} sold</span></span>
                </div>
              ))}
              {weeks.length===0 && <div style={{fontSize:12,color:"var(--txd)"}}>No sales data yet.</div>}
            </div>
          );
        })()}

        {/* Avg profit trend by month */}
        {(() => {
          const mons=[];
          let d=new Date(2024,10,1);
          while(d<=NOW){
            const mk=d.toISOString().slice(0,7);
            const mSold=sold.filter(l=>l.daySold&&l.daySold.startsWith(mk));
            const prof=mSold.reduce((a,l)=>a+(l.profit||0),0);
            if(mSold.length) mons.push({label:d.toLocaleDateString("en-GB",{month:"short",year:"2-digit"}),avg:prof/mSold.length,count:mSold.length});
            d=new Date(d.getFullYear(),d.getMonth()+1,1);
          }
          return (
            <div className="tw" style={{padding:"16px 18px"}}>
              <div className="st" style={{marginBottom:10}}>📈 Avg Profit / Sale by Month</div>
              {mons.map((m,i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid var(--bd)",fontSize:12}}>
                  <span style={{color:"var(--txm)"}}>{m.label}</span>
                  <span style={{fontWeight:700,color:m.avg>=0?"var(--gn)":"var(--ac)"}}>{fmt(m.avg)}<span style={{fontSize:10,color:"var(--txd)",marginLeft:6}}>{m.count} sold</span></span>
                </div>
              ))}
              {mons.length===0 && <div style={{fontSize:12,color:"var(--txd)"}}>No sales data yet.</div>}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   HISTORY — Command 10
═══════════════════════════════════════════════════════════════ */
const MONTH_HIST_COLS = [
  {id:"label",      label:"Month",        visible:true },
  {id:"sold",       label:"Items Sold",   visible:true },
  {id:"proceeds",   label:"Proceeds",     visible:true },
  {id:"profit",     label:"Profit Kept",  visible:true },
  {id:"stockQty",   label:"Stock Items",  visible:true },
  {id:"stockSpend", label:"Stock Spend",  visible:true },
];
const WEEK_HIST_COLS = [
  {id:"label",      label:"Week Starting", visible:true },
  {id:"listed",     label:"Listed",        visible:true },
  {id:"sold",       label:"Sold",          visible:true },
  {id:"revenue",    label:"Revenue",       visible:true },
  {id:"profit",     label:"Profit Kept",   visible:true },
  {id:"stockSpend", label:"Stock Spend",   visible:true },
  {id:"activeLive", label:"Active at EOW", visible:true },
];

/* ═══════════════════════════════════════════════════════════════
   VERSION HISTORY — Local backup restore
═══════════════════════════════════════════════════════════════ */
function VersionHistory({ onRestore }) {
  const [versions, setVersions]     = useState([]);
  const [selected, setSelected]     = useState(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const v = loadLocalVersions();
    setVersions(v);
    if (v.length) setSelected(v[0]);
  }, []);

  const exportVersion = (v) => {
    const blob = new Blob([JSON.stringify({listings:v.listings,stockData:v.stockData},null,2)],
      {type:"application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `archivedistrict_version_${v.label.replace(/[^a-zA-Z0-9]/g,"_")}.json`;
    a.click();
  };

  return (
    <div>
      <div className="info-banner">
        <strong>Version History</strong> — The last {MAX_VERSIONS} auto-saved snapshots from this device.
        Each version can be previewed, exported as JSON, or restored.
      </div>

      {versions.length === 0 ? (
        <div className="tw" style={{padding:"32px 24px",textAlign:"center"}}>
          <div style={{fontSize:28,opacity:.15,marginBottom:12}}>🕐</div>
          <div style={{fontSize:13,color:"var(--txd)"}}>No local versions saved yet.</div>
          <div style={{fontSize:11,color:"var(--txd)",marginTop:6}}>
            Versions save automatically as you use the app, and whenever you click 💾 Save.
          </div>
        </div>
      ) : (
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}} className="ld-grid">

          {/* Version list */}
          <div>
            <div className="st" style={{marginBottom:10}}>
              Saved Versions <span className="ss">{versions.length} snapshots</span>
            </div>
            {versions.map((v,i) => (
              <div key={v.ts} onClick={() => { setSelected(v); setConfirming(false); }}
                style={{
                  padding:"10px 13px", marginBottom:7, cursor:"pointer",
                  background: selected?.ts===v.ts ? "var(--acl)" : "var(--sf)",
                  border:`1px solid ${selected?.ts===v.ts?"var(--ac)":"var(--bd)"}`,
                  borderRadius:"var(--r)", transition:"all .12s",
                }}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
                  <div style={{minWidth:0}}>
                    <div style={{fontWeight:700,fontSize:12,color:selected?.ts===v.ts?"var(--ac)":"var(--tx)",
                      display:"flex",alignItems:"center",gap:6}}>
                      {i===0 && <span style={{width:7,height:7,borderRadius:"50%",background:"var(--gn)",display:"inline-block",flexShrink:0}}/>}
                      <span style={{color:v.dayLabel==="Today"?"var(--gn)":v.dayLabel==="Yesterday"?"var(--am)":"var(--tx)"}}>
                        {v.dayLabel||v.label}
                      </span>
                      <span style={{fontSize:10,fontWeight:400,color:"var(--txd)"}}>at {v.timeLabel||""}</span>
                    </div>
                    <div style={{fontSize:11,color:"var(--txm)",marginTop:1}}>
                      {v.listingsCount} listings
                    </div>
                  </div>
                  <div style={{fontSize:10,color:"var(--txd)",textAlign:"right",flexShrink:0}}>
                    {i===0 && <div style={{color:"var(--gn)",fontWeight:700,fontSize:10}}>Latest</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Preview + actions */}
          <div>
            <div className="st" style={{marginBottom:10}}>Preview & Actions</div>
            {!selected ? (
              <div className="tw" style={{padding:"24px",textAlign:"center",color:"var(--txd)",fontSize:12}}>
                ← Select a version
              </div>
            ) : (
              <div className="tw" style={{padding:"16px 18px"}}>
                <div style={{fontSize:13,fontWeight:700,marginBottom:4}}>{selected.label}</div>
                <div style={{fontSize:11,color:"var(--txd)",marginBottom:12}}>
                  {new Date(selected.ts).toLocaleString("en-GB",{weekday:"long",day:"numeric",month:"long",hour:"2-digit",minute:"2-digit"})}
                </div>

                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
                  {[
                    ["Listings",  selected.listingsCount],
                    ["Sold",      selected.listings.filter(l=>l.sold).length],
                    ["Active",    selected.listings.filter(l=>l.listed&&!l.sold).length],
                    ["Bundles",   selected.stockData?.length||0],
                  ].map(([l,v])=>(
                    <div key={l} style={{background:"var(--sf2)",border:"1px solid var(--bd)",
                      borderRadius:"var(--r)",padding:"8px 10px",textAlign:"center"}}>
                      <div style={{fontSize:10,color:"var(--txm)"}}>{l}</div>
                      <div style={{fontSize:18,fontWeight:900}}>{v}</div>
                    </div>
                  ))}
                </div>

                {/* Export button */}
                <button className="btn btn-o btn-sm"
                  style={{width:"100%",justifyContent:"center",marginBottom:8}}
                  onClick={() => exportVersion(selected)}>
                  ↓ Export this version as JSON
                </button>

                {/* Restore button */}
                {!confirming ? (
                  <button className="btn btn-p"
                    style={{width:"100%",justifyContent:"center",
                      background:"#1a6b3a",border:"none"}}
                    onClick={()=>setConfirming(true)}>
                    ↩ Restore this version
                  </button>
                ) : (
                  <div style={{background:"#fff8f0",border:"1px solid #f0c040",
                    borderRadius:"var(--r)",padding:"12px"}}>
                    <div style={{fontSize:12,fontWeight:700,color:"#7a4e0e",marginBottom:8}}>
                      ⚠ This replaces your current data. Are you sure?
                    </div>
                    <div style={{display:"flex",gap:8}}>
                      <button className="btn btn-sm"
                        style={{flex:1,justifyContent:"center",
                          background:"#b52035",color:"#fff",border:"none",borderRadius:"var(--r)"}}
                        onClick={()=>onRestore(selected)}>
                        Yes, restore
                      </button>
                      <button className="btn btn-o btn-sm"
                        style={{flex:1,justifyContent:"center"}}
                        onClick={()=>setConfirming(false)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                <div style={{fontSize:10,color:"var(--txd)",marginTop:10,lineHeight:1.5}}>
                  After restoring, data auto-saves to Supabase within 1 second.
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function History({ listings, stockData, liveData }) {
  const [monthCols, setMonthCols] = useState(MONTH_HIST_COLS);
  const [weekCols,  setWeekCols]  = useState(WEEK_HIST_COLS);
  const [showMonthCP, setShowMonthCP] = useState(false);
  const [showWeekCP,  setShowWeekCP]  = useState(false);
  const [weekRange,   setWeekRange]   = useState("all");
  const [monthRange,  setMonthRange]  = useState("all");

  const { months, weeks } = useMemo(() => {
    // Build month keys from Nov 2024 to now
    const monthKeys = [];
    let d = new Date(2024, 10, 1);
    while (d <= NOW) {
      monthKeys.push(d.toISOString().slice(0,7));
      d = new Date(d.getFullYear(), d.getMonth()+1, 1);
    }

    const months = monthKeys.map(mk => {
      const [y,mo] = mk.split("-");
      const mListings = listings.filter(l => l.sold && l.daySold?.startsWith(mk));
      const mStock    = stockData.filter(s => s.datePurchased?.startsWith(mk));
      return {
        label: new Date(+y,+mo-1,1).toLocaleDateString("en-GB",{month:"short",year:"numeric"}),
        sold: mListings.length,
        proceeds: mListings.reduce((a,l)=>a+(l.soldPrice||0),0),
        profit:   mListings.reduce((a,l)=>a+(l.profit||0),0),
        stockQty: mStock.reduce((a,s)=>a+(s.sellable||0),0),
        stockSpend: mStock.reduce((a,s)=>a+(s.totalCost||s.sellable*s.costPer||0),0),
      };
    }).reverse(); // newest first

    // Build last 16 weeks
    const weeks = [];
    for (let i=15; i>=0; i--) {
      const ws = new Date(_wsd); ws.setDate(ws.getDate()-i*7);
      const we = new Date(ws);   we.setDate(we.getDate()+6);
      const wsStr = localDateStr(ws);
      const weStr = localDateStr(we);
      const wListed = listings.filter(l => l.dayListed && l.dayListed>=wsStr && l.dayListed<=weStr);
      const wSold   = listings.filter(l => l.sold && l.daySold && l.daySold>=wsStr && l.daySold<=weStr);
      const wStock  = stockData.filter(s => s.datePurchased && s.datePurchased>=wsStr && s.datePurchased<=weStr);
      // Active at end of week = listed & not sold by end of that week
      const activeLive = listings.filter(l => l.listed && l.dayListed && l.dayListed<=weStr && (!l.sold || l.daySold>weStr)).length;
      const profitLog  = liveData?.profitLog || [];
      const profitKept = profitLog.filter(e => e.week === wsStr).reduce((a,e)=>a+e.amount, 0);
      weeks.push({
        label:      ws.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"2-digit"}),
        listed:     wListed.length,
        sold:       wSold.length,
        revenue:    wSold.reduce((a,l)=>a+(l.soldPrice||0),0),
        profit:     wSold.reduce((a,l)=>a+(l.profit||0),0),
        stockSpend: wStock.reduce((a,s)=>a+(s.totalCost||s.sellable*s.costPer||0),0),
        activeLive,
        profitKept,
      });
    }
    weeks.reverse(); // newest first
    return { months, weeks };
  }, [listings, stockData]);

  const filteredWeeks = useMemo(() => {
    if (weekRange === "all") return weeks;
    const n = parseInt(weekRange);
    return weeks.slice(0, n);
  }, [weeks, weekRange]);

  const filteredMonths = useMemo(() => {
    if (monthRange === "all") return months;
    const n = parseInt(monthRange);
    return months.slice(0, n);
  }, [months, monthRange]);

  const weekF  = useTableFilters(filteredWeeks,  weekCols);
  const monthF = useTableFilters(filteredMonths, monthCols);

  const renderNum = (v, colour) =>
    v > 0
      ? <span style={{fontWeight:700, color:colour||"var(--tx)"}}>{fmt(v)}</span>
      : <span style={{color:"var(--txd)"}}>—</span>;

  const renderWeekCell = (col, r) => {
    if (col==="label")      return <span style={{fontWeight:700,whiteSpace:"nowrap"}}>{r.label}</span>;
    if (col==="listed")     return r.listed > 0 ? r.listed : <span style={{color:"var(--txd)"}}>—</span>;
    if (col==="sold")       return r.sold > 0 ? <span style={{fontWeight:700}}>{r.sold}</span> : <span style={{color:"var(--txd)"}}>—</span>;
    if (col==="revenue")    return renderNum(r.revenue, "var(--gn)");
    if (col==="profit")     return r.profitKept > 0 ? renderNum(r.profitKept, "var(--gn)") : <span style={{color:"var(--txd)"}}>—</span>;
    if (col==="stockSpend") return renderNum(r.stockSpend, "var(--ac)");
    if (col==="activeLive") return r.activeLive > 0 ? <span style={{fontWeight:700}}>{r.activeLive}</span> : <span style={{color:"var(--txd)"}}>—</span>;
    return "—";
  };

  const renderMonthCell = (col, r) => {
    if (col==="label")      return <span style={{fontWeight:700}}>{r.label}</span>;
    if (col==="sold")       return r.sold > 0 ? <span style={{fontWeight:700}}>{r.sold}</span> : <span style={{color:"var(--txd)"}}>—</span>;
    if (col==="proceeds")   return renderNum(r.proceeds, "var(--gn)");
    if (col==="profit")     return renderNum(r.profit,   "var(--gn)");
    if (col==="stockQty")   return r.stockQty > 0 ? r.stockQty : <span style={{color:"var(--txd)"}}>—</span>;
    if (col==="stockSpend") return renderNum(r.stockSpend, "var(--ac)");
    return "—";
  };

  const HistTable = ({ title, rows, fHook, cols, setCols, showCP, setShowCP,
                       renderCell, exportName, rangeVal, setRange, rangeOpts }) => {
    const visCols = cols.filter(c => c.visible);
    return (
      <div style={{marginBottom:18}}>
        <div className="filter-bar" style={{paddingBottom:8}}>
          <div className="st">{title}<span className="ss">{fHook.filtered.length} rows</span></div>
          <div style={{flex:1}}/>
          <select className="fs" value={rangeVal} onChange={e=>setRange(e.target.value)}>
            <option value="all">All time</option>
            {rangeOpts.map(([v,l])=><option key={v} value={v}>{l}</option>)}
          </select>
          <div style={{position:"relative"}}>
            <button className="btn btn-o btn-sm" ref={fHook.btnRef} onClick={()=>fHook.setShowPanel(v=>!v)}>
              ⚡ Filters {fHook.activeFilters.length>0 && <span style={{background:"var(--ac)",color:"#fff",borderRadius:10,padding:"0 5px",fontSize:9,marginLeft:3}}>{fHook.activeFilters.length}</span>}
            </button>
            {fHook.showPanel && (
              <FilterPanel colDefs={cols} rows={rows}
                filters={fHook.filters} setFilter={fHook.setFilter}
                clearAll={fHook.clearAll} onClose={()=>fHook.setShowPanel(false)} />
            )}
          </div>
          <div style={{position:"relative"}}>
            <button className="btn btn-o btn-sm" onClick={()=>setShowCP(v=>!v)}>⚙ Columns</button>
            {showCP && <ColPanel cols={cols} setCols={setCols} onClose={()=>setShowCP(false)} />}
          </div>
          <button className="btn btn-o btn-sm" onClick={()=>exportToCSV(fHook.filtered, cols, exportName)}>↓ CSV</button>
        </div>
        <FilterChips colDefs={cols} activeFilters={fHook.activeFilters} clearFilter={fHook.clearFilter} clearAll={fHook.clearAll} />
        <div className="tw"><div className="ts" style={{maxHeight:"none"}}>
          <table className="tbl" style={{minWidth:"100%"}}>
            <thead><tr>{visCols.map(c=><th key={c.id} className="no-sort" style={{whiteSpace:"nowrap"}}>{c.label}</th>)}</tr></thead>
            <tbody>
              {fHook.filtered.length===0
                ? <tr><td colSpan={visCols.length} style={{textAlign:"center",padding:22,color:"var(--txd)"}}>No data.</td></tr>
                : fHook.filtered.map((r,i)=>(
                  <tr key={i}>{visCols.map(c=><td key={c.id} style={{whiteSpace:"nowrap"}}>{renderCell(c.id,r)}</td>)}</tr>
                ))
              }
            </tbody>
          </table>
        </div></div>
      </div>
    );
  };

  return (
    <div>
      <HistTable
        title="Weekly History"
        rows={filteredWeeks} fHook={weekF}
        cols={weekCols} setCols={setWeekCols}
        showCP={showWeekCP} setShowCP={setShowWeekCP}
        renderCell={renderWeekCell} exportName="history_weekly"
        rangeVal={weekRange} setRange={setWeekRange}
        rangeOpts={[["4","Last 4 weeks"],["8","Last 8 weeks"],["12","Last 12 weeks"],["16","Last 16 weeks"]]}
      />
      <HistTable
        title="Monthly History"
        rows={filteredMonths} fHook={monthF}
        cols={monthCols} setCols={setMonthCols}
        showCP={showMonthCP} setShowCP={setShowMonthCP}
        renderCell={renderMonthCell} exportName="history_monthly"
        rangeVal={monthRange} setRange={setMonthRange}
        rangeOpts={[["3","Last 3 months"],["6","Last 6 months"],["12","Last 12 months"]]}
      />
    </div>
  );
}


function Placeholder({ title, icon, note }) {
  return (
    <div style={{
      display:"flex",flexDirection:"column",alignItems:"center",
      justifyContent:"center",minHeight:300,gap:13,
      background:"var(--sf)",border:"1.5px dashed var(--bdd)",
      borderRadius:"var(--r2)",padding:40,textAlign:"center",
    }}>
      <div style={{fontSize:38,opacity:.15}}>{icon}</div>
      <div style={{fontSize:12,fontWeight:900,textTransform:"uppercase",letterSpacing:".5px",color:"var(--txm)"}}>{title}</div>
      {note && <div style={{fontSize:11,color:"var(--txd)",maxWidth:290,lineHeight:1.6}}>{note}</div>}
      <div style={{background:"var(--acl)",color:"var(--ac)",fontSize:10,fontWeight:700,padding:"3px 12px",borderRadius:20,textTransform:"uppercase",letterSpacing:".5px",marginTop:4}}>
        Building next
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   APP ROOT
═══════════════════════════════════════════════════════════════ */
export default function App() {
  const [view,            setView]            = useState("dashboard");
  const [sidebarOpen,     setSidebarOpen]     = useState(true);
  const [listings,        setListingsRaw]     = useState(LISTINGS_INIT);
  const [stockData,       setStockDataRaw]    = useState(STOCK_INIT);
  const [weeklyGoal,      setWeeklyGoal]      = useState("");
  const [monthlyGoal,     setMonthlyGoal]     = useState("");
  const [liveData, setLiveDataRaw] = useState(() => {
    // Load from localStorage as fallback (survives Supabase failures)
    try {
      const saved = localStorage.getItem("ad_livedata");
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return { vinted:"", withdrawn:"", ebayBal:"", ebayPend:"", depopPend:"", vintedPend:"", whatnotPend:"" };
  });

  const setLiveData = (updater) => {
    setLiveDataRaw(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      try { localStorage.setItem("ad_livedata", JSON.stringify(next)); } catch (_) {}
      return next;
    });
  };
  const [sundayDismissed, setSundayDismissed] = useState(false);
  const [isMobile,        setIsMobile]        = useState(
    () => typeof window !== "undefined" && window.innerWidth <= 768
  );
  const [storageStatus, setStorageStatus] = useState("loading");
  const [histLen,       setHistLen]       = useState({ past:0, future:0 }); // reactive for buttons

  const hasLoaded     = useRef(false);
  const fileRef       = useRef();
  const listingsRef   = useRef(LISTINGS_INIT);  // always-fresh refs for snapshots
  const stockDataRef  = useRef(STOCK_INIT);
  const past          = useRef([]);              // undo stack  [{listings, stockData}]
  const future        = useRef([]);              // redo stack

  /* Keep refs current */
  useEffect(() => { listingsRef.current  = listings;  }, [listings]);
  useEffect(() => { stockDataRef.current = stockData; }, [stockData]);

  /* ── Snapshot helpers ── */
  const saveSnap = useCallback(() => {
    past.current.push({ listings: listingsRef.current, stockData: stockDataRef.current });
    if (past.current.length > 50) past.current.shift();
    future.current = [];
    setHistLen({ past: past.current.length, future: 0 });
  }, []);

  /* Wrapped setters — every mutation auto-saves a snapshot first */
  const setListings = useCallback((updater) => {
    saveSnap();
    setListingsRaw(updater);
  }, [saveSnap]);

  const setStockData = useCallback((updater) => {
    saveSnap();
    setStockDataRaw(updater);
  }, [saveSnap]);

  /* ── Undo ── */
  const undo = useCallback(() => {
    if (!past.current.length) return;
    const snap = past.current.pop();
    future.current.unshift({ listings: listingsRef.current, stockData: stockDataRef.current });
    if (future.current.length > 50) future.current.pop();
    setListingsRaw(snap.listings);
    setStockDataRaw(snap.stockData);
    setHistLen({ past: past.current.length, future: future.current.length });
  }, []);

  /* ── Redo ── */
  const redo = useCallback(() => {
    if (!future.current.length) return;
    const snap = future.current.shift();
    past.current.push({ listings: listingsRef.current, stockData: stockDataRef.current });
    if (past.current.length > 50) past.current.shift();
    setListingsRaw(snap.listings);
    setStockDataRaw(snap.stockData);
    setHistLen({ past: past.current.length, future: future.current.length });
  }, []);

  /* ── Keyboard shortcuts: Cmd/Ctrl+Z  and  Cmd/Ctrl+Shift+Z ── */
  useEffect(() => {
    const handler = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      // Don't intercept when typing in an input/textarea
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.key === "z" && e.shiftKey) || e.key === "y") { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  /* Mobile resize */
  useEffect(() => {
    const onResize = () => {
      const m = window.innerWidth <= 768;
      setIsMobile(m);
      if (!m) setSidebarOpen(true);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /* ── Load from Supabase on mount ── */
  useEffect(() => {
    (async () => {
      // First check if Supabase env vars are actually set
      const sbUrl = import.meta.env.VITE_SUPABASE_URL;
      const sbKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      if (!sbUrl || !sbKey || sbUrl === "undefined" || sbKey === "undefined") {
        console.error("Supabase env vars missing:", { sbUrl: !!sbUrl, sbKey: !!sbKey });
        setStorageStatus("error");
        hasLoaded.current = true;
        return;
      }
      try {
        const { data, error } = await supabase
          .from("app_state")
          .select("*")
          .eq("id", 1)
          .single();
        if (error) {
          console.error("Supabase load error:", error);
          setStorageStatus("error");
        } else if (data) {
          if (data.listings?.length)    setListingsRaw(data.listings);
          if (data.stock_data?.length)  setStockDataRaw(data.stock_data);
          if (data.goals) {
            setWeeklyGoal(data.goals.weekly   || "");
            setMonthlyGoal(data.goals.monthly || "");
            if (data.goals.liveData) setLiveData(data.goals.liveData);
          }
          setStorageStatus("saved");
        } else {
          // Table exists but no row yet — first time setup
          setStorageStatus("saved");
        }
      } catch (err) {
        console.error("Supabase connection failed:", err);
        setStorageStatus("error");
      }
      hasLoaded.current = true;
    })();
  }, []);

  /* ── Supabase Realtime — push changes from other devices instantly ── */
  useEffect(() => {
    const channel = supabase
      .channel("app_state_realtime")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "app_state", filter: "id=eq.1" },
        (payload) => {
          if (!payload.new) return;
          // Skip if WE just saved (avoid echo)
          if (isRemoteUpdate.current) return;
          // Only apply if remote data is NEWER than our last save
          const remoteTs = payload.new.updated_at;
          const localTs  = lastSaveTs.current;
          if (localTs && remoteTs && remoteTs <= localTs) return;
          isRemoteUpdate.current = true;
          setTimeout(() => { isRemoteUpdate.current = false; }, 2000);
          if (payload.new.listings?.length > 0) setListingsRaw(payload.new.listings);
          if (payload.new.stock_data?.length > 0) setStockDataRaw(payload.new.stock_data);
          if (payload.new.goals) {
            setWeeklyGoal(payload.new.goals.weekly   || "");
            setMonthlyGoal(payload.new.goals.monthly || "");
            if (payload.new.goals.liveData &&
                Object.values(payload.new.goals.liveData).some(v => v !== "")) {
              setLiveData(payload.new.goals.liveData);
            }
          }
          setStorageStatus("saved");
        }
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  /* ── Debounced save — fires 800ms after last change ── */
  const saveTimer      = useRef(null);
  const isRemoteUpdate = useRef(false);
  const lastSaveTs     = useRef(null);
  const versionTimer   = useRef(null);

  const debouncedSave = useCallback((listings, stockData, goals) => {
    if (!hasLoaded.current) return;
    setStorageStatus("loading");
    clearTimeout(saveTimer.current);
    clearTimeout(versionTimer.current);
    // Auto-save local version every 60s of changes
    versionTimer.current = setTimeout(() => {
      saveLocalVersion(listings, stockData);
    }, 60000);
    saveTimer.current = setTimeout(async () => {
      isRemoteUpdate.current = true;
      const ts = new Date().toISOString();
      lastSaveTs.current = ts;
      setTimeout(() => { isRemoteUpdate.current = false; }, 2000);
      const ok = await saveState(listings, stockData, goals);
      setStorageStatus(ok ? "saved" : "error");
      if (ok) saveLocalVersion(listings, stockData);
    }, 800);
  }, []);

  /* Trigger save whenever data changes */
  useEffect(() => {
    debouncedSave(listings, stockData, { weekly: weeklyGoal, monthly: monthlyGoal, liveData });
  }, [listings, stockData, weeklyGoal, monthlyGoal, liveData, debouncedSave]);

  /* ── beforeunload — always save to localStorage on tab close ── */
  useEffect(() => {
    const handler = () => saveLocalVersion(listings, stockData);
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [listings, stockData]);

  /* ── Hard Save — immediate force-save to Supabase + local version ── */
  const [hardSaving, setHardSaving] = useState(false);
  const [hardSaveMsg, setHardSaveMsg] = useState("");

  /* ── Register service worker + subscribe to push ── */
  /* ── OneSignal initialisation + Sunday backup reminder ── */
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async function(OneSignal) {
      await OneSignal.init({
        appId: "a7fd8f7a-3c30-4f13-8a76-8d31fcb64e5f",
        notifyButton: { enable: false },
        allowLocalhostAsSecureOrigin: true,
      });
      // Auto-subscribe if permission already granted (returning devices)
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        await OneSignal.User.PushSubscription.optIn();
      }
    });

    // Sunday 6pm backup reminder — fires if app is open at that time
    const scheduleSundayReminder = () => {
      const now  = new Date();
      const next = new Date();
      const daysUntilSun = (7 - now.getDay()) % 7 || 7;
      next.setDate(now.getDate() + daysUntilSun);
      next.setHours(18, 0, 0, 0);
      const ms = next - now;
      if (ms > 0 && ms < 7 * 24 * 60 * 60 * 1000) {
        setTimeout(() => {
          sendPushNotification({
            title: "ArchiveDistrict",
            body:  "💾 Weekly backup reminder — export your data",
            tag:   "sunday-backup",
          });
        }, ms);
      }
    };
    scheduleSundayReminder();
  }, []);




  const requestNotifPermission = () => {
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(function(OneSignal) {
      OneSignal.User.PushSubscription.optIn();
    });
  };


  const hardSave = useCallback(async () => {
    setHardSaving(true);
    setHardSaveMsg("");
    clearTimeout(saveTimer.current);
    isRemoteUpdate.current = true;
    const ts = new Date().toISOString();
    lastSaveTs.current = ts;
    setTimeout(() => { isRemoteUpdate.current = false; }, 2000);
    const ok = await saveState(listings, stockData, { weekly: weeklyGoal, monthly: monthlyGoal, liveData });
    saveLocalVersion(listings, stockData);
    const time = new Date().toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" });
    setHardSaveMsg(ok ? `✓ Saved at ${time} — ${listings.length} listings` : "✗ Save failed — check connection");
    setStorageStatus(ok ? "saved" : "error");
    setHardSaving(false);
  }, [listings, stockData, weeklyGoal, monthlyGoal, liveData]);

  /* ── Manual refresh — SAFE: only replaces if remote is newer ── */
  const [refreshing, setRefreshing] = useState(false);
  const manualRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const { data, error } = await supabase
        .from("app_state").select("*").eq("id", 1).single();
      if (data && !error) {
        const remoteTs = data.updated_at;
        const localTs  = lastSaveTs.current;
        // Only apply if remote is newer OR we have no local timestamp
        if (!localTs || !remoteTs || remoteTs > localTs) {
          if (data.listings?.length)    setListingsRaw(data.listings);
          if (data.stock_data?.length)  setStockDataRaw(data.stock_data);
          if (data.goals) {
            setWeeklyGoal(data.goals.weekly   || "");
            setMonthlyGoal(data.goals.monthly || "");
            if (data.goals.liveData) setLiveData(data.goals.liveData);
          }
          setStorageStatus("saved");
        } else {
          // Remote is older — don't overwrite, but update status
          setStorageStatus("saved");
          console.log("Refresh skipped: local data is newer than Supabase");
        }
      }
    } catch (_) {}
    setRefreshing(false);
  }, []);

  /* Shipping count for nav dot */
  const toShipCount = useMemo(
    () => listings.filter(l => l.sold && !l.shipped).length,
    [listings]
  );

  /* Grouped nav */
  const navGroups = useMemo(() => {
    const g = {};
    NAV.forEach(item => { if (!g[item.group]) g[item.group]=[]; g[item.group].push(item); });
    return g;
  }, []);

  /* JSON backup/restore */
  const exportJSON = () => {
    const payload = JSON.stringify({ exportDate:TODAY, listings, stock:stockData }, null, 2);
    const a = document.createElement("a");
    a.href = "data:application/json;charset=utf-8," + encodeURIComponent(payload);
    a.download = `archivedistrict_${TODAY}.json`;
    a.click();
  };
  const importJSON = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const d = JSON.parse(ev.target.result);
        if (d.listings) setListingsRaw(d.listings);
        if (d.stock)    setStockDataRaw(d.stock);
        setStorageStatus("loading");
        const ok = await saveState(
          d.listings || listings,
          d.stock    || stockData,
          { weekly: weeklyGoal, monthly: monthlyGoal }
        );
        if (ok) {
          setStorageStatus("saved");
        } else {
          setStorageStatus("error");
          alert("Data loaded into view but FAILED to save to database. Check your Supabase connection.");
        }
      } catch (err) {
        console.error("Import error:", err);
        alert("Invalid backup file or save failed: " + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  /* Navigate — close sidebar on mobile */
  const navigate = (id) => { setView(id); if (isMobile) setSidebarOpen(false); };

  /* Sidebar style — overlay mobile, push desktop */
  const sidebarStyle = isMobile
    ? {
        position:"fixed", top:0, left:0, height:"100vh", zIndex:200,
        width:"var(--sb-w)", minWidth:"var(--sb-w)",
        transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)",
        transition: "transform .25s cubic-bezier(.4,0,.2,1), box-shadow .25s ease",
        boxShadow: sidebarOpen ? "var(--shl)" : "none",
      }
    : {
        width:    sidebarOpen ? "var(--sb-w)" : "0",
        minWidth: sidebarOpen ? "var(--sb-w)" : "0",
        overflow: "hidden",
        transition: "width .22s ease, min-width .22s ease",
      };

  const dotColor  = storageStatus === "error" ? "var(--ac)" : "#3dbd6a";
  const dotShadow = storageStatus === "error" ? "0 0 0 2px var(--acl)" : "0 0 0 2px #d0f0de";
  const statusLabel = storageStatus === "loading" ? "Saving…" : storageStatus === "error" ? "Save error" : "Saved ✓";

  return (
    <>
      <style>{CSS}</style>
      <div className="app">

        {/* Mobile backdrop */}
        {isMobile && sidebarOpen && (
          <div onClick={() => setSidebarOpen(false)} style={{
            position:"fixed",inset:0,background:"rgba(15,15,14,.4)",
            zIndex:199,backdropFilter:"blur(1px)",
          }} />
        )}

        {/* ─── SIDEBAR ─── */}
        <div className="sidebar" style={sidebarStyle}>
          <div className="logo-area">
            <div className="logo-badge">
              <span>ARCHIVE</span>
              <span>DISTRICT</span>
              <span className="since">SINCE 2019</span>
            </div>
            <div className="logo-text">
              <div className="logo-main">Archive<br/>District</div>
              <div className="logo-sub">Business OS</div>
            </div>
          </div>

          <nav>
            {Object.entries(navGroups).map(([group, items]) => (
              <div key={group}>
                <div className="nav-group-label">{group}</div>
                {items.map(item => (
                  <div
                    key={item.id}
                    className={`nav-item ${view===item.id?"active":""}`}
                    onClick={() => navigate(item.id)}
                  >
                    <span className="nav-icon">{item.icon}</span>
                    <span style={{flex:1}}>{item.label}</span>
                    {item.id==="shipping" && toShipCount>0 && (
                      <span className="nav-dot" title={`${toShipCount} to ship`} />
                    )}
                  </div>
                ))}
              </div>
            ))}
          </nav>

          <div className="sb-foot">
            <div className="live-dot" style={{background:dotColor,boxShadow:dotShadow}} />
            <span>{statusLabel}</span>
          </div>
        </div>

        {/* ─── MAIN ─── */}
        <div className="main">
          {IS_SUNDAY && !sundayDismissed && (
            <div className="sunday-banner">
              <span>📤 Sunday reminder — export your data to Google Sheets!</span>
              <div style={{display:"flex",gap:8}}>
                <button className="sunday-btn" onClick={exportJSON}>Export JSON</button>
                <button className="sunday-btn" onClick={()=>setSundayDismissed(true)} style={{opacity:.55}}>Dismiss</button>
              </div>
            </div>
          )}

          <div className="topbar">
            <button className="menu-tog" onClick={()=>setSidebarOpen(o=>!o)} style={{flexShrink:0}}>
              {sidebarOpen && !isMobile ? "✕" : "☰"}
            </button>
            <div className="page-title" style={{flexShrink:0}}>{TITLES[view]}</div>
            <div className="tb-right" style={{display:"flex",alignItems:"center",gap:5,marginLeft:"auto",flexShrink:0}}>
              <span className="tb-date" style={{fontSize:11,color:"var(--txd)",whiteSpace:"nowrap"}}>{DATE_DISPLAY}</span>
              <button className="btn btn-o btn-sm" onClick={undo} disabled={histLen.past===0}
                title="Undo" style={{padding:"4px 8px",fontSize:13}}>↩</button>
              <button className="btn btn-o btn-sm" onClick={redo} disabled={histLen.future===0}
                title="Redo" style={{padding:"4px 8px",fontSize:13}}>↪</button>
              <input ref={fileRef} type="file" accept=".json" style={{display:"none"}} onChange={importJSON} />
              <button className="btn btn-o btn-sm" onClick={()=>fileRef.current?.click()}
                style={{whiteSpace:"nowrap"}}>↑ Import</button>
              <button className="btn btn-o btn-sm" onClick={manualRefresh} title="Refresh from database"
                disabled={refreshing} style={{padding:"4px 8px"}}>
                {refreshing ? "…" : "↻"}
              </button>
              <button className="btn btn-o btn-sm" onClick={exportJSON}
                style={{whiteSpace:"nowrap"}}>↓ Backup</button>
              {"Notification" in window && Notification.permission !== "granted" && (
                <button onClick={requestNotifPermission}
                  title="Enable push notifications"
                  style={{flexShrink:0, padding:"5px 8px", fontSize:13,
                    background:"#fff8e1", border:"1px solid #f0c040",
                    borderRadius:"var(--r)", cursor:"pointer", color:"#7a4e0e"}}>
                  🔔
                </button>
              )}
              <button onClick={hardSave} disabled={hardSaving}
                title="Force-save everything to Supabase + local backup"
                style={{
                  flexShrink:0, whiteSpace:"nowrap",
                  padding:"5px 10px", fontSize:11, fontWeight:700,
                  background:hardSaving?"var(--sf2)":"#1a6b3a",
                  color:hardSaving?"var(--txm)":"#fff",
                  border:`1px solid ${hardSaving?"var(--bdd)":"#1a6b3a"}`,
                  borderRadius:"var(--r)", cursor:hardSaving?"default":"pointer",
                  letterSpacing:".3px",
                }}>
                {hardSaving ? "…" : "💾 Save"}
              </button>
              {hardSaveMsg && (
                <span style={{fontSize:10,fontWeight:700,flexShrink:0,whiteSpace:"nowrap",
                  color:hardSaveMsg.startsWith("✓")?"var(--gn)":"var(--ac)"}}>
                  {hardSaveMsg}
                </span>
              )}
            </div>
          </div>

          <div className="content">
            {view==="dashboard"   && <Dashboard listings={listings} stockData={stockData} weeklyGoal={weeklyGoal} setWeeklyGoal={setWeeklyGoal} monthlyGoal={monthlyGoal} setMonthlyGoal={setMonthlyGoal} />}
            {view==="stock"       && <StockTab stockData={stockData} setStockData={setStockData} listings={listings} setListings={setListings} />}
            {view==="listings"    && <ListingsTab listings={listings} setListings={setListings} stockData={stockData} />}
            {view==="movement"    && <MovementTracker listings={listings} />}
            {view==="listingdata" && <ListingDataTab listings={listings} />}
            {view==="marklisted"  && <MarkAsListed listings={listings} setListings={setListings} />}
            {view==="drafter"     && <ListingDrafter listings={listings} setListings={setListings} />}
            {view==="marksold"    && <QuickMarkSold listings={listings} setListings={setListings} />}
            {view==="shipping"    && <ShippingTab listings={listings} setListings={setListings} />}
            {view==="livedata"    && <LiveData listings={listings} stockData={stockData} liveData={liveData} setLiveData={setLiveData} />}
            {view==="calculator"  && <PriceCalculator listings={listings} />}
            {view==="analytics"   && <Analytics listings={listings} stockData={stockData} />}
            {view==="growth"      && <Growth listings={listings} stockData={stockData} />}
            {view==="history"     && <History listings={listings} stockData={stockData} liveData={liveData} />}
            {view==="versions"    && <VersionHistory onRestore={(v)=>{ setListingsRaw(v.listings); setStockDataRaw(v.stockData); setView("dashboard"); }} />}
          </div>
        </div>
      </div>
    </>
  );
}
