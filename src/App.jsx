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

/* ── Version history now lives server-side in app_state_snapshots ──
   Auto-filled once a day at 6am UK time by a Supabase pg_cron job (see
   supabase_schema.sql). The manual Save button upserts today's row on
   demand. See the VersionHistory component below for reads. ── */
const saveManualSnapshot = async (listings, stockData, goals) => {
  try {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" }); // YYYY-MM-DD
    const { error } = await supabase.from("app_state_snapshots").upsert({
      snapshot_date: today,
      listings,
      stock_data: stockData,
      goals,
      manual: true,
    }, { onConflict: "snapshot_date" });
    if (error) { console.warn("Manual snapshot save failed:", error.message); return false; }
    return true;
  } catch (e) {
    console.warn("Manual snapshot save exception:", e);
    return false;
  }
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
  // Check notification preferences from appSettings
  if (payload.notifKey !== undefined) {
    try {
      const saved = localStorage.getItem("ad_livedata");
      if (saved) {
        const ld = JSON.parse(saved);
        const as = { ...DEFAULT_APP_SETTINGS, ...(ld?.appSettings||{}) };
        const enabled = as[payload.notifKey] !== undefined ? as[payload.notifKey] : true;
        if (!enabled) return;
      }
    } catch (_) {}
  }
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
const DEFAULT_PLATFORMS = [
  "Depop","Vinted","eBay","Whatnot","Tilt","Facebook Marketplace","Grailed","Other",
];
// Both updated at runtime from customPlatforms (see App useEffect)
let PLATFORMS          = DEFAULT_PLATFORMS;
let MARK_LISTED_PLATS  = DEFAULT_PLATFORMS;
const PLAT_FEES = {
  "Depop":10,"Vinted":5,"eBay":12.9,
  "Whatnot":8,"Tilt":8,
  "Facebook Marketplace":0,"Grailed":9,"Other":10,
};
const WEBSITES = ["Fleek","VWS","Depop","eBay","Vinted","Other"];

/* ─── PLATFORM FAMILY UTILITIES ───
   "Vinted 1", "Vinted 2" → family "Vinted"
   Used everywhere data is DISPLAYED or GROUPED.
   Dropdowns for SELECTING a platform always use the full name.
─── */
const PLAT_FAMILY_BASES = ["Depop","Vinted","eBay","Whatnot","Tilt","Facebook Marketplace","Grailed","Other"];
const PLAT_COLOURS = {
  Depop:"#ff2300", Vinted:"#09b1ba", eBay:"#e53238",
  Whatnot:"#7c3aed", Grailed:"#1a1a1a",
  "Facebook Marketplace":"#1877f2", Tilt:"#f59e0b",
};
const getPlatFamily = (name) => {
  if (!name) return name;
  const match = PLAT_FAMILY_BASES.find(b => name.toLowerCase().startsWith(b.toLowerCase()));
  return match || name;
};
const getPlatColour = (name) => {
  if (!name) return "#888";
  if (PLAT_COLOURS[name]) return PLAT_COLOURS[name];
  const base = getPlatFamily(name);
  return PLAT_COLOURS[base] || "#888";
};
const getPlatFamilies = (plats) => [...new Set((plats||[]).map(getPlatFamily))];
const listingHasFamily = (l, family) => {
  const allPlats = [...new Set([...(l.platforms||[]), l.platform].filter(Boolean))];
  return allPlats.some(p => getPlatFamily(p) === family);
};

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

/* ── App-wide settings — stored in liveData.appSettings ── */
const DEFAULT_APP_SETTINGS = {
  currency:         "£",
  dateFormat:       "DD/MM",
  slowMoverDays:    14,
  sellThruWarning:  60,
  cashBuffer:       85,
  defaultCondition: "Excellent",
  defaultAccounts:  [],
  compactMode:      false,
  sidebarCollapsed: false,
  notifSold:        true,
  notifListed:      true,
  notifReturn:      true,
  notifShipped:     false,
  notifSundayBackup:true,
  notifNotes:       true,
  crossListPlats:     null, // null = all platform families visible
  hiddenListedPlats:  [],   // platforms hidden from Mark as Listed
  hiddenSoldPlats:    [],   // platforms hidden from Mark as Sold
  customTypes:        [],
  customColours:    [],
  customSizes:      [],
};
const getAS = (liveData) => ({ ...DEFAULT_APP_SETTINGS, ...(liveData?.appSettings||{}) });
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
  if (sold.length < 3 && sold.length < items.length) return "NEW"; // too early only if unsold items remain
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
    // If multiple bundles share the same bundleSku (e.g. BDL-008 edge case),
    // use compound key bundleSku+name to keep them separate.
    // For all other bundles use bundleSku only — name mismatches won't break the count.
    const dupeSku = stockData.filter(s2 => s2.bundleSku === s.bundleSku).length > 1;
    const items = dupeSku
      ? listings.filter(l => l.bundleSku===s.bundleSku && l.name===s.name)
      : listings.filter(l => l.bundleSku===s.bundleSku);
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
function ComboSelect({ value, onChange, options, placeholder, style, onAddCustom }) {
  const [adding, setAdding] = useState(false);
  const [newVal, setNewVal] = useState("");
  const allOpts = [...new Set([...options, value].filter(Boolean))].sort();

  const confirmAdd = () => {
    const v = newVal.trim();
    if (!v) return;
    onChange(v);
    if (onAddCustom) onAddCustom(v);
    setAdding(false);
    setNewVal("");
  };

  if (adding) {
    return (
      <div style={{display:"flex",gap:5}}>
        <input
          className="finp" autoFocus
          placeholder={`Type new ${placeholder||"value"}…`}
          value={newVal}
          onChange={e=>setNewVal(e.target.value)}
          onKeyDown={e=>{
            if (e.key==="Enter") confirmAdd();
            if (e.key==="Escape") { setAdding(false); setNewVal(""); }
          }}
          style={{flex:1,...(style||{})}}
        />
        <button className="btn btn-p btn-xs" onClick={confirmAdd}>✓</button>
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
  {id:"settings",    label:"Settings",        icon:"⚙️", group:"Settings"  },
];
const TITLES = {
  dashboard:"Dashboard",stock:"Stock Inventory",listings:"Listings",
  movement:"Movement Tracker",listingdata:"Listing Data",marklisted:"Mark as Listed",drafter:"Listing Drafter",
  marksold:"Mark as Sold",shipping:"Shipping",livedata:"Live Data",
  calculator:"Price Calculator",analytics:"Analytics",growth:"Growth",history:"History",
  settings:"Settings",
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
.content{flex:1;overflow-y:auto;overflow-x:hidden;padding:18px 22px}
@media(max-width:600px){.content{padding:13px 13px;overflow-x:hidden}}

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
.tbl td.name-cell{min-width:160px;max-width:280px;white-space:normal;word-break:break-word;font-size:11px}
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
.tbl tr.sold-r td{background:#f0faf4;color:var(--txm)}.tbl tr.listed-r td{background:#fff8f0}.tbl tr.return-r td{background:#fdf0f0}.tbl tr.dim td{opacity:.55}.tbl tr.sel td{background:#fdf4f5}

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
.sw{position:relative;width:100%;box-sizing:border-box}.si{position:absolute;left:9px;top:50%;transform:translateY(-50%);font-size:13px;color:var(--txd);pointer-events:none}
.fi{background:var(--sf);border:1px solid var(--bdd);color:var(--tx);font-family:Arial,sans-serif;font-size:12px;padding:7px 10px 7px 28px;border-radius:var(--r);outline:none;width:100%;transition:border-color .12s;box-sizing:border-box}
.fi:focus{border-color:var(--ac);box-shadow:0 0 0 3px var(--acl)}
.fs{background:var(--sf);border:1px solid var(--bdd);color:var(--txm);font-family:Arial,sans-serif;font-size:12px;padding:7px 10px;border-radius:var(--r);outline:none;cursor:pointer;max-width:100%;box-sizing:border-box;min-width:0}
.tog-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 11px;font-family:Arial,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;cursor:pointer;border-radius:var(--r);border:1px solid var(--bdd);background:var(--sf);color:var(--txm);transition:all .12s;user-select:none}
.tog-btn.on{background:var(--acl);border-color:var(--ac2);color:var(--ac)}
.tog-dot{width:7px;height:7px;border-radius:50%;background:currentColor;opacity:.8}

/* Tab bar */
.tab-bar{display:flex;align-items:flex-end;border-bottom:2px solid var(--bd);margin-bottom:14px;flex-wrap:wrap}
.tab{padding:7px 9px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;color:var(--txm);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;transition:color .12s,border-color .12s;display:flex;align-items:center;gap:4px;user-select:none;white-space:nowrap}
.tab:hover{color:var(--tx)}.tab.active{color:var(--ac);border-bottom-color:var(--ac)}
.tc{background:var(--sf2);color:var(--txm);font-size:9.5px;font-weight:700;padding:1px 6px;border-radius:10px;min-width:18px;text-align:center}.tc-ret{background:var(--acl);color:var(--ac)}
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
.compact .tbl td{padding:5px 8px !important}
.compact .tbl th{padding:5px 8px !important}
.compact .kv{font-size:18px !important}
.compact .kc{padding:9px 10px 7px !important}
`;


/* ═══════════════════════════════════════════════════════════════
   SHARED — CSV export
   Exports filtered rows + visible columns as a .csv file.
   Used by every table in the app.
═══════════════════════════════════════════════════════════════ */
function exportToCSV(rows, colDefs, filename) {
  if (!rows.length) { alert("Nothing to export — check your filters."); return; }
  const visCols = colDefs.filter(c => c.id !== "sel" && c.id !== "photo"); // export all cols regardless of visibility
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
              <select className="fsel" value={WEBSITES.includes(form.website)&&form.website!=="Other"?form.website:"Other"}
                onChange={e => set("website", e.target.value === "Other" ? "" : e.target.value)}>
                {WEBSITES.map(w => <option key={w}>{w}</option>)}
              </select>
              {(!WEBSITES.includes(form.website)||form.website==="Other"||!form.website) && (
                <input className="finp" style={{marginTop:5}} placeholder="Type website / source..."
                  value={WEBSITES.includes(form.website)&&form.website!=="Other"?"":form.website}
                  onChange={e => set("website", e.target.value)} />
              )}
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
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <input className="finp" style={{flex:1}} type="date" value={form.dateArrived||""} onChange={e => set("dateArrived", e.target.value)} />
                {form.dateArrived && (
                  <button type="button" onClick={() => set("dateArrived", "")}
                    style={{background:"none",border:"none",cursor:"pointer",color:"var(--txd)",fontSize:16,padding:"0 4px",lineHeight:1}}>×</button>
                )}
              </div>
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
                onChange={e => set("received", e.target.value === "" ? "" : parseInt(e.target.value)||0)}
                onBlur={e => { if (e.target.value === "" || isNaN(parseInt(e.target.value))) set("received", 0); }} />
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
          const sellable = parseInt(form.sellable)||parseInt(stock.sellable)||0;
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
              onDelete(stock.bundleSku, stock.name);
          }}>🗑 Delete</button>
          <button className="btn btn-p btn-sm" onClick={() => { onSave({ ...form, sellable: parseInt(form.sellable)||0, received: parseInt(form.received)||0, _originalName: stock.name }); onClose(); }}>
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
              <select className="fsel" value={WEBSITES.includes(form.website)&&form.website!=="Other"?form.website:"Other"}
                onChange={e => set("website", e.target.value === "Other" ? "" : e.target.value)}>
                {WEBSITES.map(w => <option key={w}>{w}</option>)}
              </select>
              {(!WEBSITES.includes(form.website)||form.website==="Other"||!form.website) && (
                <input className="finp" style={{marginTop:5}} placeholder="Type website / source..."
                  value={WEBSITES.includes(form.website)&&form.website!=="Other"?"":form.website}
                  onChange={e => set("website", e.target.value)} />
              )}
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
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <input className="finp" style={{flex:1}} type="date" value={form.dateArrived||""}
                  onChange={e => set("dateArrived", e.target.value)} />
                {form.dateArrived && (
                  <button type="button" onClick={() => set("dateArrived", "")}
                    style={{background:"none",border:"none",cursor:"pointer",color:"var(--txd)",fontSize:16,padding:"0 4px",lineHeight:1}}>×</button>
                )}
              </div>
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
                        <td style={{fontWeight:600,fontSize:11,whiteSpace:"normal",wordBreak:"break-word",maxWidth:200}}>{s.name}</td>
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
  if (colId==="name")          return <span style={{fontWeight:700,fontSize:11,whiteSpace:"normal",wordBreak:"break-word"}}>{s.name}</span>;
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

// Exports stock data in the exact column order the Google Sheets STOCK tab expects
// Columns: Date Purchased | Date Arrived | Bundle SKU | Website | Seller | Stock Name
//          | Sellable Pieces | Cost per Piece | Content Details | Received Pieces | Imported
function exportStockForSheets(stockData) {
  const headers = [
    "Date Purchased","Date Arrived","Bundle SKU","Website","Seller","Stock Name",
    "Sellable Pieces","Cost per Piece","Content Details","Received Pieces","Imported (1=yes)",
  ];
  const rows = stockData.map(s => [
    s.datePurchased  || "",
    s.dateArrived    || "",
    s.bundleSku      || "",
    s.website        || "",
    s.seller         || "",
    s.name           || "",
    s.sellable       || "",
    s.costPer        != null ? Number(s.costPer).toFixed(4) : "",
    s.contentDetails || "",
    s.received       || "",
    s.imported       ? 1 : 0,
  ]);
  const csv = [headers, ...rows]
    .map(r => r.map(v => {
      const s = String(v ?? "");
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g,'""')}"` : s;
    }).join(","))
    .join("\r\n");
  const a = document.createElement("a");
  a.href = "data:text/csv;charset=utf-8,\uFEFF" + encodeURIComponent(csv);
  a.download = `AD_Stock_ForSheets_${TODAY}.csv`;
  a.click();
}

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
  const handleAddStock    = (ns) => {
    // Prevent duplicate SKU — if this SKU already exists with a different name, bump to next
    const hasDupe = stockData.some(s => s.bundleSku === ns.bundleSku && s.name !== ns.name);
    const safeSku = hasDupe ? getNextBundleSku([...stockData, {bundleSku: ns.bundleSku}]) : ns.bundleSku;
    setStockData(p => [...p, { ...ns, bundleSku: safeSku }]);
  };
  const handleDeleteStock = (bsku, originalName) => {
    setStockData(prev => prev.filter(s => !(s.bundleSku === bsku && s.name === originalName)));
    setEditStock(null);
  };
  const handleSaveStock = (updated) => {
    const oldName = updated._originalName;
    const newName = updated.name;
    const nameChanged = oldName && oldName !== newName;
    // Update stock row
    setStockData(p => p.map(s =>
      s.bundleSku === updated.bundleSku && s.name === oldName
        ? { ...updated, _originalName: undefined }
        : s
    ));
    // If name changed, cascade to all listings with same bundleSku + old name
    if (nameChanged) {
      setListings(p => p.map(l =>
        l.bundleSku === updated.bundleSku && l.name === oldName
          ? { ...l, name: newName }
          : l
      ));
    }
  };

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
      notes:      "",
    }));
    setListings(prev => [...prev, ...stubs]);
    setStockData(prev => prev.map(s =>
      s.bundleSku === stock.bundleSku && s.name === stock.name
        ? { ...s, imported: true }
        : s
    ));
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
        <button className="btn btn-o btn-sm" title="Export in exact column order for Google Sheets STOCK tab"
          onClick={()=>exportStockForSheets(stockData)}
          style={{background:"var(--gnl)",borderColor:"var(--gn)",color:"var(--gn)",fontWeight:700}}>
          → Sheets
        </button>
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
function EditListingDrawer({ listing, stockData, onSave, onDelete, onClose, liveData, setLiveData }) {
  const as = getAS(liveData);
  const typeOpts   = [...new Set([...DEFAULT_TYPES,   ...(as.customTypes   ||[])])].sort();
  const colourOpts = [...new Set([...DEFAULT_COLOURS, ...(as.customColours ||[])])].sort();
  const sizeOpts   = [...new Set([...DEFAULT_SIZES,   ...(as.customSizes   ||[])])].sort();

  const addCustomOption = (field, value) => {
    if (!setLiveData) return;
    setLiveData(prev => {
      const prevAS = prev?.appSettings || {};
      const existing = prevAS[field] || [];
      if (existing.includes(value)) return prev;
      return { ...prev, appSettings: { ...prevAS, [field]: [...existing, value] } };
    });
  };

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
              <ComboSelect value={form.type} onChange={v=>set("type",v)} options={typeOpts} placeholder="type"
                onAddCustom={v=>addCustomOption("customTypes",v)} />
            </div>
          </div>
          <div className="fr2">
            <div className="fr">
              <label className="fl">Colour</label>
              <ComboSelect value={form.colour} onChange={v=>set("colour",v)} options={colourOpts} placeholder="colour"
                onAddCustom={v=>addCustomOption("customColours",v)} />
            </div>
            <div className="fr">
              <label className="fl">Size</label>
              <ComboSelect value={form.size} onChange={v=>set("size",v)} options={sizeOpts} placeholder="size"
                onAddCustom={v=>addCustomOption("customSizes",v)} />
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
                const col = isSelected ? getPlatColour(p) : null;
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

          {/* Process Return — shows when item is sold */}
          {form.sold && !form.pendingReturn && (
            <div style={{marginTop:14,padding:"12px 13px",background:"#fff8f0",border:"1px solid #f0c040",borderRadius:"var(--r)"}}>
              <div style={{fontSize:11,fontWeight:700,color:"#7a4e0e",marginBottom:6}}>📦 Process a Return</div>
              <div style={{fontSize:11,color:"#7a4e0e",marginBottom:8,lineHeight:1.5}}>
                Buyer sending it back? Raise a return to track it in Shipping while it's in transit.
              </div>
              <div className="fr">
                <label className="fl">Return Reason</label>
                <input
                  className="finp"
                  placeholder="e.g. Not as described, doesn't fit…"
                  value={form._returnReasonDraft||""}
                  onChange={e => setForm(prev => ({...prev, _returnReasonDraft: e.target.value}))}
                />
              </div>
              <button
                className="btn btn-o btn-sm"
                style={{width:"100%",justifyContent:"center",marginTop:4}}
                onClick={() => {
                  const returnDate = new Date().toISOString().split("T")[0];
                  const reason = form._returnReasonDraft || "";
                  const prevSku = form.sku;
                  setForm(prev => ({
                    ...prev,
                    pendingReturn: true,
                    returnReason: reason,
                    returnDate,
                    _returnReasonDraft: undefined,
                    // Clear sold data immediately — item is being returned
                    sold: false, soldPrice: null, profit: null,
                    daySold: null, days: null, shipped: false, shippedDate: null,
                    listed: false,
                    notes: (prev.notes ? prev.notes + "\n" : "") + `Return raised ${returnDate}${reason ? " — " + reason : ""}`,
                  }));
                  setDirty(true);
                  sendPushNotification({
                    title: "ArchiveDistrict",
                    body:  `↩ ${prevSku} — return raised${reason ? ": " + reason : ""}`,
                    tag:   `return-raised-${prevSku}`,
      notifKey: "notifReturn",
                  });
                }}
              >
                ↩ Raise Return
              </button>
            </div>
          )}

          {/* Return In Transit — shows when pendingReturn is true */}
          {form.pendingReturn && (
            <div style={{marginTop:14,padding:"12px 13px",background:"var(--acl)",border:"1px solid var(--ac2)",borderRadius:"var(--r)"}}>
              <div style={{fontSize:11,fontWeight:700,color:"var(--ac)",marginBottom:4}}>↩ Return In Transit</div>
              {form.returnReason && (
                <div style={{fontSize:11,color:"var(--txm)",marginBottom:8}}>Reason: {form.returnReason}</div>
              )}
              <div style={{fontSize:11,color:"var(--txm)",marginBottom:10,lineHeight:1.5}}>
                Item is on its way back. Once received, choose what to do with it:
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
                      pendingReturn:false, returnReason:"", returnDate:"",
                      notes:(prev.notes ? prev.notes + "\n" : "") + `Returned ${returnDate} — relisted`,
                    }));
                    setDirty(true);
                    sendPushNotification({
                      title: "ArchiveDistrict",
                      body:  `📦 ${prevSku} returned — relisted`,
                      tag:   `return-${prevSku}`,
      notifKey: "notifReturn",
                    });
                  }}
                >
                  ↩ Relist
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
                      pendingReturn:false, returnReason:"", returnDate:"",
                      notes:(prev.notes ? prev.notes + "\n" : "") + `Returned ${returnDate} — re-inventoried`,
                    }));
                    setDirty(true);
                    sendPushNotification({
                      title: "ArchiveDistrict",
                      body:  `📦 ${prevSku} returned — re-inventoried`,
                      tag:   `return-${prevSku}`,
      notifKey: "notifReturn",
                    });
                  }}
                >
                  📦 Re-inventory
                </button>
              </div>
              <div style={{fontSize:10,color:"var(--ac)",marginTop:7,opacity:.8}}>
                Relist = back to active at same price · Re-inventory = back to unlisted, reassess price
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
  if (colId === "platform") {
    // Show family name (e.g. "Vinted 1" → "Vinted")
    const fam = l.platform ? getPlatFamily(l.platform) : null;
    return fam ? <span className="badge b-b">{fam}</span> : <span style={{color:"var(--txd)"}}>—</span>;
  }
  if (colId === "platforms") {
    const plats = l.platforms?.length ? l.platforms : l.platform ? [l.platform] : [];
    // Deduplicate by family so "Vinted 1" and "Vinted 2" show as one "Vinted" badge
    const families = getPlatFamilies(plats);
    return families.length
      ? <div style={{display:"flex",flexWrap:"wrap",gap:3}}>
          {families.map(f => <span key={f} className="badge b-b" style={{fontSize:9,padding:"1px 5px"}}>{f}</span>)}
        </div>
      : <span style={{color:"var(--txd)"}}>—</span>;
  }
  if (colId === "platformDates") {
    const pd = l.platformDates || {};
    const plats = l.platforms?.length ? l.platforms : l.platform ? [l.platform] : [];
    if (!plats.length) return <span style={{color:"var(--txd)"}}>—</span>;
    // Group by family — show earliest date per family
    const familyMap = {};
    plats.forEach(p => {
      const fam = getPlatFamily(p);
      const date = pd[p] || l.dayListed;
      if (!familyMap[fam] || (date && date < familyMap[fam].date)) {
        familyMap[fam] = { date };
      }
    });
    return (
      <div style={{display:"flex",flexDirection:"column",gap:2}}>
        {Object.entries(familyMap).map(([fam, {date}]) => {
          const col = getPlatColour(fam);
          return (
            <div key={fam} style={{
              display:"inline-flex",alignItems:"center",gap:5,
              background:col+"18",border:`1px solid ${col}55`,
              borderRadius:20,padding:"2px 7px",fontSize:10,whiteSpace:"nowrap",
            }}>
              <span style={{width:6,height:6,borderRadius:"50%",background:col,flexShrink:0,display:"inline-block"}}/>
              <span style={{fontWeight:700,color:col}}>{fam}</span>
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
function AddListingModal({ listings, stockData, onAdd, onClose, liveData, setLiveData }) {
  const as = getAS(liveData);
  const typeOpts   = [...new Set([...DEFAULT_TYPES,   ...(as.customTypes   ||[])])].sort();
  const colourOpts = [...new Set([...DEFAULT_COLOURS, ...(as.customColours ||[])])].sort();
  const sizeOpts   = [...new Set([...DEFAULT_SIZES,   ...(as.customSizes   ||[])])].sort();

  const addCustomOption = (field, value) => {
    if (!setLiveData) return;
    setLiveData(prev => {
      const prevAS = prev?.appSettings || {};
      const existing = prevAS[field] || [];
      if (existing.includes(value)) return prev;
      return { ...prev, appSettings: { ...prevAS, [field]: [...existing, value] } };
    });
  };

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
              <ComboSelect value={form.type} onChange={v=>set("type",v)} options={typeOpts} placeholder="type"
                onAddCustom={v=>addCustomOption("customTypes",v)} />
            </div>
          </div>
          <div className="fr2">
            <div className="fr">
              <label className="fl">Colour {errors.colour && <span style={{color:"var(--ac)"}}>*</span>}</label>
              <ComboSelect value={form.colour} onChange={v=>set("colour",v)} options={colourOpts} placeholder="colour"
                onAddCustom={v=>addCustomOption("customColours",v)} />
            </div>
            <div className="fr">
              <label className="fl">Size {errors.size && <span style={{color:"var(--ac)"}}>*</span>}</label>
              <ComboSelect value={form.size} onChange={v=>set("size",v)} options={sizeOpts} placeholder="size"
                onAddCustom={v=>addCustomOption("customSizes",v)} />
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



/* ═══════════════════════════════════════════════════════════════
   LISTINGS — Bulk Edit Drawer
═══════════════════════════════════════════════════════════════ */
function BulkEditDrawer({ selectedSkus, listings, setListings, customPlatforms, liveData, setLiveData, initialMode, onClose }) {
  const as       = getAS(liveData);
  const typeOpts   = [...new Set([...DEFAULT_TYPES,   ...(as.customTypes   ||[])])].sort();
  const colourOpts = [...new Set([...DEFAULT_COLOURS, ...(as.customColours ||[])])].sort();
  const sizeOpts   = [...new Set([...DEFAULT_SIZES,   ...(as.customSizes   ||[])])].sort();
  const _platforms = customPlatforms || DEFAULT_PLATFORMS;

  const addCustomOption = (field, value) => {
    if (!setLiveData) return;
    setLiveData(prev => {
      const prevAS = prev?.appSettings || {};
      const existing = prevAS[field] || [];
      if (existing.includes(value)) return prev;
      return { ...prev, appSettings: { ...prevAS, [field]: [...existing, value] } };
    });
  };

  // Mode: "listed" | "edit"
  const [mode, setMode] = useState(initialMode || "edit");

  // Mark as Listed state
  const [platSel,  setPlatSel]  = useState(new Set());
  const [dateL,    setDateL]    = useState(getToday());
  const [listedDone, setListedDone] = useState(false);

  // Full edit state — blank = don't overwrite
  const [form, setForm] = useState({
    brand: "", type: "", colour: "", size: "", condition: "",
    price: "", notes: "", platform: "",
  });

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const togglePlat = (p) => setPlatSel(prev => { const n=new Set(prev); n.has(p)?n.delete(p):n.add(p); return n; });

  const applyListed = () => {
    if (platSel.size === 0) return;
    const arr = [...platSel];
    setListings(prev => prev.map(l => {
      if (!selectedSkus.has(l.sku) || l.sold) return l;
      return {
        ...l,
        listed: true,
        dayListed: l.dayListed || dateL,
        platform: l.platform || arr[0],
        platforms: [...new Set([...(l.platforms||[]), ...arr])],
        platformDates: { ...(l.platformDates||{}), ...Object.fromEntries(arr.map(p=>[p, dateL])) },
      };
    }));
    setListedDone(true);
  };

  const applyEdit = () => {
    setListings(prev => prev.map(l => {
      if (!selectedSkus.has(l.sku)) return l;
      const updates = {};
      if (form.brand.trim())     updates.brand     = form.brand.trim();
      if (form.type.trim())      updates.type      = form.type.trim();
      if (form.colour.trim())    updates.colour    = form.colour.trim();
      if (form.size.trim())      updates.size      = form.size.trim();
      if (form.condition.trim()) updates.condition = form.condition.trim();
      if (form.price !== "")     updates.price     = parseFloat(form.price) || l.price;
      if (form.notes.trim())     updates.notes     = form.notes.trim();
      return { ...l, ...updates };
    }));
    onClose();
  };

  const count = selectedSkus.size;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" style={{maxWidth:520,maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        <div className="mh">
          <div style={{fontWeight:700,fontSize:15}}>Bulk Edit — {count} item{count!==1?"s":""}</div>
          <button className="cls" onClick={onClose}>✕</button>
        </div>

        {/* Mode tabs */}
        <div style={{display:"flex",gap:6,padding:"12px 18px 0",borderBottom:"1px solid var(--bd)"}}>
          {[["edit","✏ Full Edit"],["listed","📌 Mark as Listed"]].map(([id,label])=>(
            <button key={id} onClick={()=>setMode(id)} style={{
              padding:"6px 14px",fontSize:12,fontWeight:700,borderRadius:"var(--r) var(--r) 0 0",cursor:"pointer",
              border:"1.5px solid var(--bd)",borderBottom:"none",
              background:mode===id?"var(--sf)":"var(--sf2)",
              color:mode===id?"var(--tx)":"var(--txm)",
              marginBottom:-1,
            }}>{label}</button>
          ))}
        </div>

        <div style={{padding:"16px 18px"}}>

          {/* ── MARK AS LISTED mode ── */}
          {mode==="listed" && (
            listedDone ? (
              <div style={{padding:"14px",background:"var(--gnl)",border:"1px solid rgba(31,92,53,.2)",borderRadius:"var(--r)",fontSize:13,color:"var(--gn)",fontWeight:700,textAlign:"center"}}>
                ✓ {count} item{count!==1?"s":""} marked as listed on {[...platSel].join(", ")}
              </div>
            ) : (
              <>
                <div style={{fontSize:12,color:"var(--txm)",marginBottom:14}}>
                  Select the platform(s) and date. Only items not yet marked as listed will be updated.
                </div>
                <div style={{fontWeight:700,fontSize:11,textTransform:"uppercase",letterSpacing:".5px",color:"var(--txm)",marginBottom:8}}>Platforms</div>
                <div className="plat-grid-4" style={{marginBottom:14}}>
                  {_platforms.filter(p=>!(as.hiddenListedPlats||[]).includes(p)).map(p=>(
                    <button key={p} onClick={()=>togglePlat(p)} style={{
                      padding:"7px 4px",fontSize:11,fontWeight:700,textAlign:"center",
                      border:`1.5px solid ${platSel.has(p)?"var(--ac)":"var(--bd)"}`,
                      borderRadius:"var(--r)",cursor:"pointer",
                      background:platSel.has(p)?"var(--acl)":"var(--sf2)",
                      color:platSel.has(p)?"var(--ac)":"var(--txm)",transition:"all .12s",
                    }}>{p}{platSel.has(p)&&" ✓"}</button>
                  ))}
                </div>
                <div className="fr" style={{marginBottom:14}}>
                  <label className="fl">Date Listed</label>
                  <input className="finp" type="date" value={dateL} onChange={e=>setDateL(e.target.value)} style={{width:"100%"}} />
                </div>
                {platSel.size===0 && <div style={{fontSize:11,color:"var(--ac)",fontWeight:700,marginBottom:8}}>● Select at least one platform</div>}
                <button className="btn btn-p" disabled={platSel.size===0} style={{width:"100%",justifyContent:"center"}} onClick={applyListed}>
                  📌 Mark {count} item{count!==1?"s":""} as Listed
                </button>
              </>
            )
          )}

          {/* ── FULL EDIT mode ── */}
          {mode==="edit" && (
            <>
              <div style={{fontSize:12,color:"var(--txm)",marginBottom:14}}>
                Only filled fields will be updated. Leave blank to keep each item's existing value.
              </div>
              <div className="fr2">
                <div className="fr">
                  <label className="fl">Brand</label>
                  <input className="finp" placeholder="Leave blank to keep" value={form.brand} onChange={e=>set("brand",e.target.value)} />
                </div>
                <div className="fr">
                  <label className="fl">Type</label>
                  <ComboSelect value={form.type} onChange={v=>set("type",v)} options={typeOpts} placeholder="type"
                    onAddCustom={v=>addCustomOption("customTypes",v)} />
                </div>
              </div>
              <div className="fr2">
                <div className="fr">
                  <label className="fl">Colour</label>
                  <ComboSelect value={form.colour} onChange={v=>set("colour",v)} options={colourOpts} placeholder="colour"
                    onAddCustom={v=>addCustomOption("customColours",v)} />
                </div>
                <div className="fr">
                  <label className="fl">Size</label>
                  <ComboSelect value={form.size} onChange={v=>set("size",v)} options={sizeOpts} placeholder="size"
                    onAddCustom={v=>addCustomOption("customSizes",v)} />
                </div>
              </div>
              <div className="fr2">
                <div className="fr">
                  <label className="fl">Condition</label>
                  <select className="fsel" value={form.condition} onChange={e=>set("condition",e.target.value)}>
                    <option value="">— keep existing —</option>
                    {["New with tags","New without tags","Excellent","Good","Fair"].map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="fr">
                  <label className="fl">Price £</label>
                  <input className="finp" type="text" inputMode="decimal" placeholder="Leave blank to keep"
                    value={form.price} onChange={e=>{ if(/^\d*\.?\d*$/.test(e.target.value)) set("price",e.target.value); }} />
                </div>
              </div>
              <div className="fr">
                <label className="fl">Notes</label>
                <textarea className="fta" style={{minHeight:48}} placeholder="Leave blank to keep"
                  value={form.notes} onChange={e=>set("notes",e.target.value)} />
              </div>
              <div style={{display:"flex",gap:8,marginTop:6}}>
                <button className="btn btn-o btn-sm" style={{flex:1,justifyContent:"center"}} onClick={onClose}>Cancel</button>
                <button className="btn btn-p" style={{flex:2,justifyContent:"center"}} onClick={applyEdit}>
                  ✓ Apply to {count} item{count!==1?"s":""}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const SORTABLE_LISTING_COLS = new Set(["sku","price","soldPrice","profit","days","dayListed","daySold"]);

function ListingsTab({ listings, setListings, stockData, customPlatforms, liveData, setLiveData }) {
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
  const [showBulkEdit, setShowBulkEdit]= useState(false);
  const [bulkEditMode, setBulkEditMode]= useState("edit");

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
    all:           listings.length,
    active:        listings.filter(l => l.listed && !l.sold).length,
    sold:          listings.filter(l => l.sold).length,
    unlisted:      listings.filter(l => !l.listed && !l.sold).length,
    pendingReturn: listings.filter(l => l.pendingReturn).length,
  }), [listings]);

  /* Filtered + sorted rows — chains after column filters */
  const rows = useMemo(() => {
    let d = [...colFiltered];

    // Tab filter
    if (activeTab === "active")   d = d.filter(l => l.listed && !l.sold);
    if (activeTab === "sold")     d = d.filter(l => l.sold);
    if (activeTab === "unlisted") d = d.filter(l => !l.listed && !l.sold);
    if (activeTab === "pendingReturn") d = d.filter(l => l.pendingReturn);
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
    if (platFilter   !== "All") d = d.filter(l => listingHasFamily(l, platFilter));
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
    stockData.slice().sort((a,b) => a.bundleSku.localeCompare(b.bundleSku)),
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
          liveData={liveData}
          setLiveData={setLiveData}
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
          liveData={liveData}
          setLiveData={setLiveData}
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

      {showBulkEdit && (
        <BulkEditDrawer
          selectedSkus={selected}
          listings={listings}
          setListings={setListings}
          customPlatforms={customPlatforms}
          liveData={liveData}
          setLiveData={setLiveData}
          initialMode={bulkEditMode}
          onClose={() => setShowBulkEdit(false)}
        />
      )}

      {/* ── Controls row above tabs ── */}
      <div style={{display:"flex",justifyContent:"flex-end",alignItems:"center",gap:7,marginBottom:8}}>
        <div style={{position:"relative"}}>
          <button className="btn btn-o btn-sm" onClick={()=>setShowColPanel(v=>!v)}>⚙ Columns</button>
          {showColPanel && (
            <ColPanel cols={cols} setCols={setCols} onClose={()=>setShowColPanel(false)} />
          )}
        </div>
        <button className="btn btn-p btn-sm" onClick={()=>setShowAdd(true)}>+ Add Listing</button>
      </div>

      {/* ── Tab bar ── */}
      <div className="tab-bar">
        {[
          { id:"all",      label:"All Items" },
          { id:"active",   label:"Active"    },
          { id:"sold",     label:"Sold"      },
          { id:"unlisted", label:"To List"   },
          ...(counts.pendingReturn > 0 ? [{ id:"pendingReturn", label:"Returns" }] : []),
        ].map(t => (
          <div
            key={t.id}
            className={`tab ${activeTab===t.id?"active":""}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
            <span className={`tc${t.id==="pendingReturn"?" tc-ret":""}`}>{counts[t.id]}</span>
          </div>
        ))}
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
          {bundleSkus.map((s,i) => (
            <option key={`${s.bundleSku}-${i}`} value={s.bundleSku}>
              {s.bundleSku} — {s.name}
            </option>
          ))}
        </select>

        <select className="fs" value={platFilter} onChange={e=>setPlatFilter(e.target.value)}>
          <option value="All">All Platforms</option>
          {getPlatFamilies(customPlatforms||DEFAULT_PLATFORMS).map(f => <option key={f} value={f}>{f}</option>)}
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
                  l.pendingReturn     ? "return-r"  : "",
                  !l.pendingReturn && l.sold              ? "sold-r"   : "",
                  !l.pendingReturn && l.listed && !l.sold ? "listed-r"  : "",
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
          <button className="fb-btn" onClick={()=>{ setBulkEditMode("listed"); setShowBulkEdit(true); }}>📌 Mark as Listed</button>
          <button className="fb-btn" onClick={bulkMarkSold}>✓ Mark Sold</button>
          <button className="fb-btn" onClick={bulkMarkShipped}>📦 Mark Shipped</button>
          <button className="fb-btn" style={{background:"var(--acl)",color:"var(--ac)",border:"1.5px solid var(--ac)"}}
            onClick={()=>{ setBulkEditMode("edit"); setShowBulkEdit(true); }}>✏ Full Edit</button>
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
  {id:"name",    label:"Stock Name",  visible:true, minW:200 },
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
    if (col==="name")     return <span style={{fontWeight:700,fontSize:11,whiteSpace:"normal",wordBreak:"break-word"}}>{row.name}</span>;
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
                  {visCols.map(c => <td key={c.id} className={c.id==="name"?"name-cell":""} title={c.id==="name"?row.name:undefined}>{renderCell(c.id, row)}</td>)}
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
        <span style={{color:"#2a4a9a",fontWeight:700}}>NEW</span> = 1–2 sold with unsold items remaining — too early to classify &nbsp;·&nbsp;
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
/* ═══════════════════════════════════════════════════════════════
   CROSS-LIST TAB — lives inside Listing Data
   Shows active listings grouped by bundle for each platform they
   are NOT yet on. Platform picker driven by Settings.
═══════════════════════════════════════════════════════════════ */
function CrossListTab({ listings, visiblePlats }) {
  const [selPlat,  setSelPlat]  = useState(() => visiblePlats[0] || "");
  const [search,   setSearch]   = useState("");
  const [expanded, setExpanded] = useState({}); // true = open, default closed
  const [copied,   setCopied]   = useState(null);

  const active = listings.filter(l => l.listed && !l.sold);

  // Reset selected platform if it's no longer visible
  const selPlatSafe = visiblePlats.includes(selPlat) ? selPlat : (visiblePlats[0] || "");

  const platStats = visiblePlats.map(p => ({
    plat:    p,
    missing: active.filter(l => !listingHasFamily(l, p)).length,
  }));

  const missing = useMemo(() => {
    let d = active.filter(l => !listingHasFamily(l, selPlatSafe));
    if (search.trim()) {
      const s = search.toLowerCase();
      d = d.filter(l =>
        l.sku.toLowerCase().includes(s) ||
        l.colour.toLowerCase().includes(s) ||
        (l.name||"").toLowerCase().includes(s) ||
        l.size.toLowerCase().includes(s)
      );
    }
    return d;
  }, [selPlatSafe, search, active]);

  const byBundle = useMemo(() => {
    const out = {};
    missing.forEach(l => {
      const key = `${l.bundleSku}||${l.name}`;
      if (!out[key]) out[key] = { bsku: l.bundleSku, name: l.name, items: [] };
      out[key].items.push(l);
    });
    return Object.values(out).sort((a, b) => b.items.length - a.items.length);
  }, [missing]);

  const alreadyOn = active.filter(l => listingHasFamily(l, selPlatSafe)).length;
  const selCol    = getPlatColour(selPlatSafe);

  const copy = (skus, key) => {
    copyText(skus.join("\n"));
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const toggleBundle = (key) =>
    setExpanded(p => ({ ...p, [key]: !p[key] }));

  if (!visiblePlats.length) return (
    <div style={{background:"var(--sf)",border:"1px solid var(--bd)",borderRadius:"var(--r2)",padding:"28px 24px",textAlign:"center",color:"var(--txd)",fontSize:12}}>
      No platforms configured. Go to Settings → Listings to set up cross-list platforms.
    </div>
  );

  return (
    <div>
      {/* Platform picker */}
      <div style={{display:"grid",gridTemplateColumns:`repeat(${Math.min(visiblePlats.length,5)},1fr)`,gap:8,marginBottom:14}}>
        {platStats.map(({ plat, missing: n }) => {
          const col   = getPlatColour(plat);
          const isSel = plat === selPlatSafe;
          return (
            <button key={plat}
              onClick={() => { setSelPlat(plat); setSearch(""); setCopied(null); setExpanded({}); }}
              style={{
                padding:"11px 8px",border:`2px solid ${isSel ? col : "var(--bd)"}`,
                borderRadius:"var(--r2)",cursor:"pointer",textAlign:"center",
                background:isSel ? col+"14" : "var(--sf)",
                boxShadow:isSel ? `0 0 0 3px ${col}22` : "var(--sh)",
                transition:"all .14s",fontFamily:"Arial,sans-serif",outline:"none",
              }}>
              <div style={{width:9,height:9,borderRadius:"50%",background:col,margin:"0 auto 6px"}}/>
              <div style={{fontSize:11,fontWeight:700,color:isSel?col:"var(--txm)",marginBottom:3}}>{getPlatFamily(plat)}</div>
              {n === 0
                ? <div style={{fontSize:10,fontWeight:700,color:"var(--gn)"}}>✓ all done</div>
                : <div style={{fontSize:10,fontWeight:700,color:isSel?col:"var(--am)"}}>{n} to add</div>
              }
            </button>
          );
        })}
      </div>

      {/* Main panel */}
      <div style={{background:"var(--sf)",border:"1px solid var(--bd)",borderRadius:"var(--r2)",overflow:"hidden",boxShadow:"var(--sh)"}}>
        {/* Header row 1: platform name + stats + copy all */}
        <div style={{padding:"12px 16px 0"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:9}}>
            <div style={{width:10,height:10,borderRadius:"50%",background:selCol,flexShrink:0}}/>
            <span style={{fontWeight:900,fontSize:14,color:selCol}}>{getPlatFamily(selPlatSafe)}</span>
            <span style={{fontSize:12,color:"var(--txm)"}}>
              {missing.length} to list · {alreadyOn} already on
            </span>
            <div style={{flex:1}}/>
            <button
              onClick={() => copy(missing.map(l => l.sku), "all")}
              disabled={missing.length === 0}
              style={{
                display:"inline-flex",alignItems:"center",gap:6,padding:"6px 13px",
                borderRadius:20,cursor:missing.length?"pointer":"default",
                border:"1px solid var(--bdd)",
                background:copied==="all"?"var(--gnl)":"var(--sf)",
                color:copied==="all"?"var(--gn)":"var(--txm)",
                fontFamily:"Arial,sans-serif",fontSize:11,fontWeight:700,
                transition:"all .12s",flexShrink:0,opacity:missing.length===0?.4:1,
              }}>
              <span style={{fontSize:13}}>{copied==="all"?"✓":"⎘"}</span>
              {copied==="all" ? "Copied!" : `Copy ${missing.length} SKUs`}
            </button>
          </div>
          {/* Header row 2: search — full width */}
          <div style={{position:"relative",paddingBottom:12,borderBottom:"1px solid var(--bd)"}}>
            <span style={{position:"absolute",left:9,top:"50%",transform:"translateY(-60%)",fontSize:13,color:"var(--txd)",pointerEvents:"none"}}>⌕</span>
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Filter SKU, colour…"
              style={{
                width:"100%",background:"var(--sf2)",border:"1px solid var(--bdd)",
                borderRadius:20,padding:"6px 12px 6px 28px",
                fontFamily:"Arial,sans-serif",fontSize:12,outline:"none",
                transition:"border-color .12s",boxSizing:"border-box",
              }}
              onFocus={e=>e.target.style.borderColor="var(--ac)"}
              onBlur={e=>e.target.style.borderColor="var(--bdd)"}
            />
          </div>
        </div>

        {/* Bundle list */}
        {missing.length === 0 ? (
          <div style={{padding:"32px 24px",textAlign:"center"}}>
            <div style={{fontSize:22,marginBottom:8}}>✓</div>
            <div style={{fontWeight:900,color:"var(--gn)",textTransform:"uppercase",letterSpacing:".4px",fontSize:12,marginBottom:4}}>
              All covered
            </div>
            <div style={{fontSize:12,color:"var(--txd)"}}>
              Every active listing is already on {getPlatFamily(selPlatSafe)}.
            </div>
          </div>
        ) : byBundle.map((bundle, bi) => {
          const bundleKey  = `${bundle.bsku}||${bundle.name}`;
          const isOpen     = !!expanded[bundleKey];
          const bundleSkus = bundle.items.map(l => l.sku);
          const isBCopied  = copied === bundleKey;
          return (
            <div key={bundleKey} style={{borderBottom:bi<byBundle.length-1?"1px solid var(--bd)":"none"}}>
              {/* Bundle header */}
              <div onClick={() => toggleBundle(bundleKey)}
                style={{
                  display:"flex",alignItems:"center",gap:10,padding:"10px 16px",
                  background:isOpen?"var(--sf)":"var(--sf2)",
                  cursor:"pointer",userSelect:"none",
                  borderBottom:isOpen?"1px solid var(--bd)":"none",
                }}>
                <span style={{fontSize:10,color:"var(--txd)",flexShrink:0,width:10}}>{isOpen?"▾":"▸"}</span>
                <span className="bsku">{bundle.bsku}</span>
                <span style={{fontWeight:700,fontSize:12,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {bundle.name}
                </span>
                <span style={{fontSize:11,color:"var(--txd)",flexShrink:0}}>
                  {bundle.items.length} item{bundle.items.length!==1?"s":""}
                </span>
              </div>

              {/* Item rows */}
              {isOpen && bundle.items.map((l, i) => {
                const onPlats = [...new Set([...(l.platforms||[]), l.platform].filter(Boolean))];
                return (
                  <div key={l.sku} style={{
                    display:"flex",alignItems:"center",gap:10,
                    padding:"9px 16px 9px 36px",
                    borderBottom:i<bundle.items.length-1?"1px solid var(--bd)":"none",
                    background:"var(--sf)",
                  }}>
                    <span className="sku" style={{minWidth:52,flexShrink:0}}>{l.sku}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <span style={{fontWeight:700,fontSize:12}}>{l.colour}</span>
                      <span style={{fontSize:11,color:"var(--txm)",marginLeft:6}}>Size {l.size} · {l.type}</span>
                    </div>
                    {/* Platform pills — what it's currently ON */}
                    <div style={{display:"flex",gap:4,flexWrap:"wrap",justifyContent:"flex-end"}}>
                      {onPlats.map(p => {
                        const fam = getPlatFamily(p);
                        const c   = getPlatColour(p);
                        return (
                          <span key={p} style={{
                            display:"inline-block",padding:"3px 9px",borderRadius:20,
                            fontSize:11,fontWeight:700,color:c,
                            background:c+"15",border:`1.5px solid ${c}55`,
                            whiteSpace:"nowrap",
                          }}>{fam}</span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* Bundle footer — SKU strip + copy */}
              {isOpen && (
                <div style={{
                  display:"flex",alignItems:"center",gap:10,padding:"7px 16px",
                  background:"var(--sf2)",borderTop:"1px solid var(--bd)",
                }}>
                  <span style={{fontSize:10,color:"var(--txd)",flexShrink:0}}>SKUs:</span>
                  <span style={{fontSize:11,color:"var(--txm)",flex:1,fontFamily:"monospace",letterSpacing:".5px"}}>
                    {bundleSkus.join("  ")}
                  </span>
                  <button onClick={() => copy(bundleSkus, bundleKey)}
                    style={{
                      display:"inline-flex",alignItems:"center",gap:5,
                      padding:"4px 12px",borderRadius:20,cursor:"pointer",
                      border:"1px solid var(--bdd)",
                      background:isBCopied?"var(--gnl)":"var(--sf)",
                      color:isBCopied?"var(--gn)":"var(--txm)",
                      fontFamily:"Arial,sans-serif",fontSize:11,fontWeight:700,
                      transition:"all .12s",flexShrink:0,
                    }}>
                    <span>{isBCopied?"✓":"⎘"}</span>
                    {isBCopied?"Copied!":"Copy"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {missing.length > 0 && (
        <div style={{marginTop:9,fontSize:11,color:"var(--txd)"}}>
          Copy SKUs → paste into <strong style={{color:"var(--txm)"}}>Mark as Listed → Bulk mode</strong> to cross-list in one go.
        </div>
      )}
    </div>
  );
}

function ListingDataTab({ listings, liveData }) {
  const [toListCols, setToListCols]   = useState(TOLIST_COLS);
  const [activeCols, setActiveCols]   = useState(ACTIVE_COLS);
  const [showToListCP,  setShowToListCP]  = useState(false);
  const [showActiveCP,  setShowActiveCP]  = useState(false);
  const [ldTab,         setLdTab]         = useState("tolist"); // "tolist" | "active" | "crosslist"
  const activeZoom  = useZoom(100);
  const toListZoom  = useZoom(100);

  // Cross-list: platforms from settings (null = all families)
  const as            = getAS(liveData);
  const crossListPlats = as.crossListPlats || PLAT_FAMILY_BASES;

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
    if (col==="name")     return <span style={{fontWeight:600,fontSize:11,whiteSpace:"normal",wordBreak:"break-word"}}>{l.name}</span>;
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
    if (col==="name")     return <span style={{fontWeight:600,fontSize:11,whiteSpace:"normal",wordBreak:"break-word"}}>{l.name}</span>;
    if (col==="type")     return <span className="badge b-0">{l.type}</span>;
    if (col==="brand")    return <span style={{color:"var(--txm)"}}>{l.brand}</span>;
    if (col==="colour")   return l.colour;
    if (col==="size")     return <span style={{color:"var(--txm)"}}>{l.size}</span>;
    if (col==="price")    return fmt(l.price);
    if (col==="dayListed")return <span style={{color:"var(--txm)",fontSize:11}}>{l.dayListed||"—"}</span>;
    if (col==="tag")      return <MovTag tag={l.tag} />;
    if (col==="bundleSku")return <span className="bsku">{l.bundleSku}</span>;
    if (col==="platform") return l.platform ? <span className="badge b-b">{getPlatFamily(l.platform)}</span> : <span style={{color:"var(--txd)"}}>—</span>;
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

  // Cross-list gap count for tab badge
  const crossNeedsCount = active.filter(l =>
    crossListPlats.some(p => !listingHasFamily(l, p))
  ).length;

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

      {/* Tab bar */}
      <div className="tab-bar">
        <div className={`tab ${ldTab==="tolist"?"active":""}`} onClick={()=>setLdTab("tolist")}>
          To Be Listed <span className="tc">{toBeListed.length}</span>
        </div>
        <div className={`tab ${ldTab==="active"?"active":""}`} onClick={()=>setLdTab("active")}>
          Active <span className="tc">{active.length}</span>
        </div>
        <div className={`tab ${ldTab==="crosslist"?"active":""}`} onClick={()=>setLdTab("crosslist")}>
          Cross-List
          <span className={`tc${ldTab!=="crosslist"&&crossNeedsCount>0?" tc-ret":""}`}>
            {crossNeedsCount}
          </span>
        </div>
      </div>

      {/* To Be Listed tab */}
      {ldTab === "tolist" && (
        <>
          {/* Breakdowns */}
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
        </>
      )}

      {/* Active tab */}
      {ldTab === "active" && (
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
      )}

      {/* Cross-List tab */}
      {ldTab === "crosslist" && (
        <CrossListTab listings={listings} visiblePlats={crossListPlats} />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MARK AS LISTED — Command 6
═══════════════════════════════════════════════════════════════ */
// MARK_LISTED_PLATS is now dynamic — see customPlatforms in App

/* ── ListingRecap — today's listing session summary ── */

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

  const platforms   = getPlatFamilies(todayItems.flatMap(it => it.plats));
  const crossListed = todayItems.filter(it => it.plats.length > 1).length;
  const filtered    = platFilt === "All" ? todayItems : todayItems.filter(it => it.plats.some(p => getPlatFamily(p) === platFilt));

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
              {getPlatFamilies(it.plats).map(fam=>{
                const col=getPlatColour(fam);
                return <span key={fam} style={{fontSize:10,fontWeight:600,padding:"2px 7px",
                  borderRadius:20,background:col+"18",color:col,border:`1px solid ${col}55`}}>{fam}</span>;
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

function MarkAsListed({ listings, setListings, customPlatforms, liveData }) {
  // Search all non-sold items — allows adding platforms to already-listed items
  const unlisted   = useMemo(() => listings.filter(l => !l.sold), [listings]);
  const _as        = getAS(liveData);
  const _hidden    = _as.hiddenListedPlats || [];
  const _platforms = (customPlatforms || DEFAULT_PLATFORMS).filter(p => !_hidden.includes(p));

  // ── Single-item mode ──
  const [skuInput,    setSkuInput]    = useState("");
  const [skuSearch,   setSkuSearch]   = useState("");
  const [platSel,     setPlatSel]     = useState(() => new Set(getAS(liveData).defaultAccounts||[]));
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
      {_platforms.map(p => {
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
      notifKey: "notifListed",
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
      notifKey: "notifListed",
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
function ListingDrafter({ listings, setListings, liveData }) {
  const unlisted = useMemo(() => listings.filter(l => !l.sold), [listings]);

  const [selSku,      setSelSku]      = useState("");
  const [drafterSearch,setDrafterSearch]= useState("");
  const [condition,   setCondition]   = useState(() => getAS(liveData).defaultCondition || "Excellent");
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

          <span className="dlabel">Search &amp; select item (unlisted or listed)</span>

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
                        No items match "{drafterSearch}"
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
                {item.desc && (
                  <div style={{ marginTop:7, paddingTop:7, borderTop:"1px solid var(--bd)", fontSize:11, color:"var(--txm)", lineHeight:1.5 }}>
                    <span style={{ fontWeight:700, color:"var(--txd)", textTransform:"uppercase", letterSpacing:".4px", fontSize:9 }}>Description </span>
                    {item.desc}
                  </div>
                )}
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
        <DrafterMarkListed item={item} setListings={setListings} liveData={liveData} />
      )}
    </div>
  );
}

/* ── Drafter inline mark-as-listed panel ── */
function DrafterMarkListed({ item, setListings, liveData }) {
  const _as        = getAS(liveData);
  const _hidden    = _as.hiddenListedPlats || [];
  const _platforms = MARK_LISTED_PLATS.filter(p => !_hidden.includes(p));
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
      notifKey: "notifListed",
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
            {_platforms.map(p => (
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
function QuickMarkSold({ listings, setListings, customPlatforms, liveData }) {
  const unsold = useMemo(() => listings.filter(l => l.listed && !l.sold), [listings]);
  const _as        = getAS(liveData);
  const _hidden    = _as.hiddenSoldPlats || [];
  const _platforms = (customPlatforms || DEFAULT_PLATFORMS).filter(p => !_hidden.includes(p));

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
      notifKey: "notifSold",
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
            {_platforms.map(p=>(
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
  const [resolving,    setResolving]   = useState(null);

  const toShip        = listings.filter(l => l.sold && !l.shipped && !l.pendingReturn);
  const awaitingReturn = listings.filter(l => l.pendingReturn);
  const shippedToday = listings.filter(l => l.shipped && l.shippedDate === getToday());

  const markShipped = (sku) => setListings(prev =>
    prev.map(l => l.sku === sku ? { ...l, shipped:true, shippedDate:TODAY } : l)
  );
  const markAllShipped = () => setListings(prev =>
    prev.map(l => (l.sold && !l.shipped) ? { ...l, shipped:true, shippedDate:TODAY } : l)
  );

  /* Group by platform family (e.g. "Vinted 1" and "Vinted 2" → "Vinted") */
  const byPlat = useMemo(() => {
    const m = {};
    toShip.forEach(l => {
      // Group by exact account name (e.g. "Vinted 1", "Vinted 2") not family
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
    if (col==="platform")  return l.platform ? <span className="badge b-b">{getPlatFamily(l.platform)}</span> : <span style={{color:"var(--txd)"}}>—</span>;
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
      ) : byPlat.map(([plat, items]) => {
        const family = getPlatFamily(plat);
        const col    = getPlatColour(plat);
        return (
        <div key={plat} className="ship-plat">
          <div className="ship-plat-h">
            <span style={{display:"flex",alignItems:"center",gap:7}}>
              <span style={{width:8,height:8,borderRadius:"50%",background:col,display:"inline-block",flexShrink:0}}/>
              {plat}
              {family !== plat && (
                <span style={{fontSize:9,fontWeight:700,color:"var(--txd)",textTransform:"uppercase",letterSpacing:".4px"}}>
                  {family}
                </span>
              )}
            </span>
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
        );
      })}

      {/* ── Awaiting Returns ── only shown when active returns exist */}
      {awaitingReturn.length > 0 && (
        <div style={{marginTop:18}}>
          <div className="sh" style={{borderLeft:"3px solid var(--ac)",paddingLeft:10,marginLeft:-3}}>
            <div className="st" style={{color:"var(--ac)"}}>
              ↩ Awaiting Returns
              <span className="ss" style={{color:"var(--txm)"}}>{awaitingReturn.length} item{awaitingReturn.length!==1?"s":""} in transit</span>
            </div>
          </div>
          {awaitingReturn.map(l => (
            <div key={l.sku} className="ship-plat">
              <div key={l.sku} className="ship-row" style={{flexWrap:"wrap",gap:8,background:"#fdf0f0",borderLeft:"3px solid var(--ac)",borderRadius:"0 var(--r) var(--r) 0"}}>
                <span className="sku" style={{minWidth:52}}>{l.sku}</span>
                <div style={{flex:1,minWidth:120}}>
                  <div style={{fontWeight:700,fontSize:12}}>{l.name}</div>
                  <div style={{fontSize:11,color:"var(--txm)"}}>
                    {l.colour} · {l.size}
                    {l.returnReason && <span style={{marginLeft:6,color:"var(--ac)"}}>— {l.returnReason}</span>}
                  </div>
                  {l.returnDate && (
                    <div style={{fontSize:10,color:"var(--txd)",marginTop:1}}>Raised {l.returnDate}</div>
                  )}
                </div>
                {resolving === l.sku ? (
                  <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                    <span style={{fontSize:11,color:"var(--txm)",fontWeight:700}}>Received — choose:</span>
                    <button
                      className="btn btn-g btn-sm"
                      onClick={() => {
                        const returnDate = getToday();
                        setListings(prev => prev.map(item => item.sku !== l.sku ? item : {
                          ...item,
                          sold:false, soldPrice:null, profit:null,
                          daySold:null, days:null, shipped:false, shippedDate:null,
                          listed:true,
                          pendingReturn:false, returnReason:"", returnDate:"",
                          notes:(item.notes ? item.notes + "\n" : "") + `Returned ${returnDate} — relisted`,
                        }));
                        setResolving(null);
                        sendPushNotification({
                          title: "ArchiveDistrict",
                          body: `↩ ${l.sku} returned — relisted`,
                          tag: `return-${l.sku}`,
        notifKey: "notifReturn",
                        });
                      }}
                    >↩ Relist</button>
                    <button
                      className="btn btn-o btn-sm"
                      onClick={() => {
                        const returnDate = getToday();
                        setListings(prev => prev.map(item => item.sku !== l.sku ? item : {
                          ...item,
                          sold:false, soldPrice:null, profit:null,
                          daySold:null, days:null, shipped:false, shippedDate:null,
                          listed:false, dayListed:null,
                          platforms:[], platformDates:{},
                          pendingReturn:false, returnReason:"", returnDate:"",
                          notes:(item.notes ? item.notes + "\n" : "") + `Returned ${returnDate} — re-inventoried`,
                        }));
                        setResolving(null);
                        sendPushNotification({
                          title: "ArchiveDistrict",
                          body: `↩ ${l.sku} returned — re-inventoried`,
                          tag: `return-${l.sku}`,
        notifKey: "notifReturn",
                        });
                      }}
                    >📦 Re-inventory</button>
                    <button
                      className="btn btn-o btn-sm"
                      style={{color:"var(--txd)"}}
                      onClick={() => setResolving(null)}
                    >Cancel</button>
                  </div>
                ) : (
                  <button
                    className="btn btn-o btn-sm"
                    style={{color:"var(--nv)",borderColor:"var(--nv)",fontWeight:700}}
                    onClick={() => setResolving(l.sku)}
                  >
                    Mark Received ✓
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DASHBOARD — Command 9
═══════════════════════════════════════════════════════════════ */
function GoalCard({ title, period, profit, revenue, profitGoal, setProfit, profitVal, profitPct, revGoal, setRev, revVal, revPct, avgProfit, modeKey }) {
  const [mode, setModeState] = useState(() => {
    try { return localStorage.getItem(modeKey) || "profit"; } catch { return "profit"; }
  });
  const toggleMode = () => {
    const next = mode === "profit" ? "revenue" : "profit";
    setModeState(next);
    try { localStorage.setItem(modeKey, next); } catch {}
  };
  const isProfit  = mode === "profit";
  const actual    = isProfit ? profit   : revenue;
  const goal      = isProfit ? profitGoal : revGoal;
  const setGoal   = isProfit ? setProfit  : setRev;
  const val       = isProfit ? profitVal  : revVal;
  const pct       = isProfit ? profitPct  : revPct;
  const secondary = isProfit ? revenue    : profit;
  const secLabel  = isProfit ? "revenue"  : "profit";
  const barColor  = pct>=100 ? "var(--gn)" : pct>=60 ? "var(--am)" : "var(--ac)";
  return (
    <div style={{background:"var(--sf)",border:"1px solid var(--bd)",borderRadius:"var(--r2)",padding:"14px 15px",boxShadow:"var(--sh)"}}>
      {/* Header row with title and mode toggle */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
        <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:"var(--txm)"}}>{title}</div>
        {/* Toggle switch */}
        <div style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer"}} onClick={toggleMode}>
          <span style={{fontSize:9,color:"var(--txd)",fontWeight:700}}>{isProfit?"PROFIT":"REVENUE"}</span>
          <div style={{width:30,height:17,borderRadius:9,background:isProfit?"var(--nv)":"var(--gn)",position:"relative",transition:"background .2s",flexShrink:0}}>
            <div style={{width:13,height:13,borderRadius:"50%",background:"#fff",position:"absolute",top:2,left:isProfit?2:15,transition:"left .2s",boxShadow:"0 1px 3px rgba(0,0,0,.25)"}}/>
          </div>
        </div>
      </div>
      <div style={{fontSize:11,color:"var(--txd)",marginBottom:9}}>{period}</div>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
        <span style={{fontSize:11,color:"var(--txm)"}}>Target: £</span>
        <input
          type="text" inputMode="decimal" value={val}
          onChange={e => { const v=e.target.value; if(/^\d*\.?\d*$/.test(v)) setGoal(v); }}
          placeholder="0"
          style={{width:80,background:"var(--sf2)",border:"1px solid var(--bdd)",borderRadius:"var(--r)",padding:"4px 8px",fontFamily:"Arial,sans-serif",fontSize:13,fontWeight:700,outline:"none",color:"var(--tx)"}}
        />
        {goal > 0 && (
          <span style={{fontSize:12,fontWeight:700,color:barColor}}>{pct}%</span>
        )}
      </div>
      <div style={{height:7,background:"var(--sf2)",borderRadius:4,overflow:"hidden",marginBottom:5}}>
        <div style={{height:"100%",borderRadius:4,width:`${pct}%`,background:barColor,transition:"width .5s ease"}} />
      </div>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"var(--txm)"}}>
        <span style={{fontWeight:700,color:"var(--gn)"}}>{fmt(actual)} {isProfit?"made":"revenue"}</span>
        {goal > 0 && <span>{pct<100 ? `${fmt(goal-actual)} to go` : "🎉 Goal hit!"}</span>}
      </div>
      {/* Secondary metric */}
      <div style={{fontSize:10,color:"var(--txd)",marginTop:5}}>
        {fmt(secondary)} {secLabel} this period
      </div>
      {isProfit && goal>0 && pct<100 && avgProfit>0 && (
        <div style={{fontSize:10,color:"var(--txd)",marginTop:1}}>
          ≈ {Math.ceil((goal-actual)/avgProfit)} more sales at avg {fmt(avgProfit)}
        </div>
      )}
    </div>
  );
}

function Dashboard({ listings, stockData, weeklyGoal: wgProp, setWeeklyGoal, monthlyGoal: mgProp, setMonthlyGoal, weeklyRevGoal: wrgProp, setWeeklyRevGoal, monthlyRevGoal: mrgProp, setMonthlyRevGoal, liveData }) {
  // Prefer goals from appSettings (Settings tab) — fall back to App state props
  const as = getAS(liveData);
  const weeklyGoal     = as.weeklyGoal     || wgProp  || "";
  const monthlyGoal    = as.monthlyGoal    || mgProp  || "";
  const weeklyRevGoal  = as.weeklyRevGoal  || wrgProp || "";
  const monthlyRevGoal = as.monthlyRevGoal || mrgProp || "";
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

  const wkProfit  = soldWk.reduce((a,l) => a+(l.profit||0), 0);
  const moProfit  = soldMo.reduce((a,l) => a+(l.profit||0), 0);
  const wkRevenue = soldWk.reduce((a,l) => a+(l.soldPrice||0), 0);
  const moRevenue = soldMo.reduce((a,l) => a+(l.soldPrice||0), 0);
  const wg  = parseFloat(weeklyGoal)||0;
  const mg  = parseFloat(monthlyGoal)||0;
  const wrg = parseFloat(weeklyRevGoal)||0;
  const mrg = parseFloat(monthlyRevGoal)||0;
  const wPct  = wg  ? Math.min(100, Math.round(wkProfit/wg*100))   : 0;
  const mPct  = mg  ? Math.min(100, Math.round(moProfit/mg*100))   : 0;
  const wrPct = wrg ? Math.min(100, Math.round(wkRevenue/wrg*100)) : 0;
  const mrPct = mrg ? Math.min(100, Math.round(moRevenue/mrg*100)) : 0;



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
          title="Weekly Goal" period={`w/c ${WEEK_START}`}
          profit={wkProfit} revenue={wkRevenue}
          profitGoal={wg} setProfit={setWeeklyGoal} profitVal={weeklyGoal} profitPct={wPct}
          revGoal={wrg} setRev={setWeeklyRevGoal} revVal={weeklyRevGoal} revPct={wrPct}
          avgProfit={avgProfit} modeKey="weeklyGoalMode"
        />
        <GoalCard
          title="Monthly Goal"
          period={NOW.toLocaleDateString("en-GB",{month:"long",year:"numeric"})}
          profit={moProfit} revenue={moRevenue}
          profitGoal={mg} setProfit={setMonthlyGoal} profitVal={monthlyGoal} profitPct={mPct}
          revGoal={mrg} setRev={setMonthlyRevGoal} revVal={monthlyRevGoal} revPct={mrPct}
          avgProfit={avgProfit} modeKey="monthlyGoalMode"
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
function LiveData({ listings, stockData, liveData, setLiveData, customPlatforms }) {
  const set = (k, v) => setLiveData(prev => ({ ...prev, [k]: v }));
  const { vinted="", withdrawn="", ebayBal="", ebayPend="", depopPend="", vintedPend="", whatnotPend="", profitPocketed="", globalNotes="" } = liveData;

  const [pocketInput, setPocketInput] = useState("");

  // Notify 45s after notes stop changing
  const prevNotesRef = useRef(globalNotes);
  useEffect(() => {
    if (globalNotes === prevNotesRef.current) return;
    const timer = setTimeout(() => {
      if (globalNotes.trim()) {
        sendPushNotification({
          title: "ArchiveDistrict",
          body:  `📝 Note: ${globalNotes.slice(0, 80)}${globalNotes.length > 80 ? "…" : ""}`,
          tag:   "live-notes",
        notifKey: "notifNotes",
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
                className="ei"
                placeholder="£0.00"
                inputMode="decimal"
                type="text"
                pattern="[0-9.]*"
                value={pocketInput}
                onChange={e=>setPocketInput(e.target.value)}
                style={{flex:1,background:"var(--gnl)",border:"1px solid rgba(31,92,53,.2)"}}
              />
              <button
                className="btn btn-sm"
                style={{background:"var(--gn)",color:"#fff",border:"none",whiteSpace:"nowrap"}}
                onClick={() => {
                  const val = parseFloat(pocketInput.replace(/[^0-9.]/g,""));
                  if (!val || isNaN(val)) return;
                  const entry = { date: getToday(), amount: val, week: WEEK_START };
                  set("profitLog", [...(liveData.profitLog||[]), entry]);
                  setPocketInput("");
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
            {[80,60,40,30,20,10].map(p => {
              const isBuffer = p === (getAS(liveData).cashBuffer||85);
              return (
                <div key={p} className="pct-c" style={isBuffer?{background:"var(--gnl)",border:"1px solid rgba(31,92,53,.25)"}:{}}>
                  <div className="pct-l" style={isBuffer?{color:"var(--gn)",fontWeight:900}:{}}>{p}%{isBuffer?" ★":""}</div>
                  <div className="pct-v">{fmt(total*(p/100))}</div>
                </div>
              );
            })}
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

function InfoTip({ children }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{display:"inline-block",verticalAlign:"middle",marginLeft:6}}>
      <span onClick={() => setOpen(v=>!v)}
        style={{display:"inline-flex",alignItems:"center",justifyContent:"center",
          width:16,height:16,borderRadius:"50%",background:open?"var(--nv)":"var(--sf2)",
          border:"1px solid var(--bdd)",color:open?"#fff":"var(--txd)",
          fontSize:9,fontWeight:900,cursor:"pointer",fontStyle:"italic",
          fontFamily:"Georgia,serif",flexShrink:0,transition:"all .12s",userSelect:"none"}}>
        i
      </span>
      {open && (
        <div style={{background:"var(--nv)",color:"#fff",borderRadius:"var(--r2)",
          padding:"12px 14px",fontSize:11,lineHeight:1.6,marginTop:8,
          position:"relative",animation:"fadeIn .15s ease"}}>
          <button onClick={() => setOpen(false)}
            style={{position:"absolute",top:8,right:10,background:"rgba(255,255,255,.15)",
              border:"none",color:"#fff",width:18,height:18,borderRadius:"50%",
              cursor:"pointer",fontSize:11,lineHeight:"18px",textAlign:"center"}}>×</button>
          {children}
        </div>
      )}
    </span>
  );
}

function Analytics({ listings, stockData, customPlatforms: cpArg, liveData }) {
  const [slowCols,    setSlowCols]   = useState(SLOW_COLS);
  const [showSlowCP,  setShowSlowCP] = useState(false);
  const [slowSortCol, setSlowSortCol]= useState("daysLive");
  const [slowSortDir, setSlowSortDir]= useState("desc");
  const [selPlat,     setSelPlat]    = useState(null);

  const derived = useMemo(() => deriveStock(stockData, listings), [stockData, listings]);

  /* ── Platform performance ── */
  const platformStats = useMemo(() => {
    const plats = cpArg || DEFAULT_PLATFORMS;
    const families = getPlatFamilies(plats);
    return families.map(family => {
      const familyPlats = plats.filter(p => getPlatFamily(p) === family);
      const platListings = listings.filter(l =>
        l.listed && familyPlats.some(fp => l.platforms?.includes(fp) || l.platform === fp)
      );
      const soldItems = platListings.filter(l => l.sold);
      const revenue   = soldItems.reduce((a,l)=>a+(l.soldPrice||0),0);
      const avgDays   = soldItems.length
        ? soldItems.reduce((a,l)=>a+(l.days||0),0)/soldItems.length : 0;
      const avgPrice  = soldItems.length ? revenue/soldItems.length : 0;
      const sellThru  = platListings.length
        ? Math.round(soldItems.length/platListings.length*100) : 0;
      if (!platListings.length) return null;
      const displayName = family; // always show base family name
      const itemMap = {};
      soldItems.forEach(l => {
        const key = `${l.name}||${l.type||""}`;
        if (!itemMap[key]) itemMap[key] = {name:l.name,type:l.type,sold:0,revenue:0,days:0};
        itemMap[key].sold++;
        itemMap[key].revenue += l.soldPrice||0;
        itemMap[key].days    += l.days||0;
      });
      const topItems = Object.values(itemMap)
        .sort((a,b)=>b.sold-a.sold).slice(0,5)
        .map(it => ({...it,
          avgPrice: it.sold ? it.revenue/it.sold : 0,
          avgDays:  it.sold ? it.days/it.sold    : 0,
        }));
      return { name:displayName, family, items:platListings.length, sold:soldItems.length,
        revenue, avgDays, avgPrice, sellThru, topItems };
    }).filter(Boolean);
  }, [listings, cpArg]);

  const minDays  = platformStats.length ? Math.min(...platformStats.map(p=>p.avgDays||999)) : 0;
  const maxPrice = platformStats.length ? Math.max(...platformStats.map(p=>p.avgPrice))     : 0;

  /* ── Restock intelligence ── */
  const restockItems = useMemo(() => {
    return derived.map(s => {
      const tag = (() => {
        const items = listings.filter(l=>l.bundleSku===s.bundleSku&&l.name===s.name&&l.listed);
        const sold  = items.filter(l=>l.sold&&l.days!=null);
        if (!sold.length) return "UNKNOWN";
        if (sold.length<3&&sold.length<items.length) return "NEW";
        const t=items.length;
        const p=n=>t?Math.round(sold.filter(l=>l.days<=n).length/t*100):0;
        if(p(7)>=60||p(14)>=80) return "FAST";
        if(p(14)>=50) return "MEDIUM";
        if(p(42)===0) return "DEAD";
        return "SLOW";
      })();
      const stWarn = getAS(liveData).sellThruWarning||60;
      const autoFlag = s.sellThru>=stWarn && (tag==="FAST"||tag==="MEDIUM") && s.qtyRemaining<=5;
      if (!autoFlag && !s.restock) return null;
      const urgency = s.qtyRemaining<=2&&tag==="FAST" ? "critical"
        : s.qtyRemaining<=4||tag==="MEDIUM"            ? "high"
        : "watch";
      return {...s, tag, urgency, autoFlag};
    }).filter(Boolean)
    .filter((item,idx,arr)=>arr.findIndex(x=>x.bundleSku===item.bundleSku&&x.name===item.name)===idx)
    .sort((a,b)=>
      ["critical","high","watch"].indexOf(a.urgency)-["critical","high","watch"].indexOf(b.urgency)
    );
  }, [derived, listings]);

  /* ── Slow movers ── */
  const slowRaw = useMemo(() => listings
    .filter(l => l.listed && !l.sold && l.dayListed)
    .map(l => ({
      ...l,
      daysLive: Math.max(0,Math.floor((new Date(TODAY)-new Date(l.dayListed))/86400000)),
      tag: getTag(l.name,l.type,l.brand,listings),
    }))
    .filter(l => l.daysLive >= (getAS(liveData).slowMoverDays||14)),
  [listings]);

  const slowF = useTableFilters(slowRaw, slowCols);
  const slowSorted = useMemo(() => {
    if (!slowSortCol) return slowF.filtered;
    return [...slowF.filtered].sort((a,b) => {
      const av=a[slowSortCol], bv=b[slowSortCol];
      if(av==null) return 1; if(bv==null) return -1;
      const res=typeof av==="number"?av-bv:String(av).localeCompare(String(bv));
      return slowSortDir==="asc"?res:-res;
    });
  }, [slowF.filtered, slowSortCol, slowSortDir]);

  const onSlowSort = col => {
    setSlowSortDir(d=>slowSortCol===col?(d==="asc"?"desc":"asc"):"desc");
    setSlowSortCol(col);
  };

  const renderSlowCell = (col,l) => {
    if (col==="sku")      return <span className="sku">{l.sku}</span>;
    if (col==="name")     return <span style={{fontWeight:600,fontSize:11,whiteSpace:"normal",wordBreak:"break-word"}}>{l.name}</span>;
    if (col==="colour")   return l.colour;
    if (col==="size")     return <span style={{color:"var(--txm)"}}>{l.size}</span>;
    if (col==="tag")      return <MovTag tag={l.tag}/>;
    if (col==="daysLive") return <span style={{fontWeight:700,color:l.daysLive>30?"var(--ac)":l.daysLive>21?"var(--am)":"var(--tx)"}}>{l.daysLive}d</span>;
    if (col==="price")    return fmt(l.price);
    if (col==="bundleSku")return <span className="bsku">{l.bundleSku}</span>;
    if (col==="platform") return l.platform?<span className="badge b-b">{getPlatFamily(l.platform)}</span>:<span style={{color:"var(--txd)"}}>—</span>;
    if (col==="dayListed")return <span style={{color:"var(--txm)",fontSize:11}}>{l.dayListed||"—"}</span>;
    return "—";
  };
  const visSlow = slowCols.filter(c=>c.visible);

  const selPlatData = platformStats.find(p=>p.name===selPlat);

  return (
    <div>
      {/* ── RESTOCK INTELLIGENCE ── */}
      <div className="sh" style={{marginBottom:8}}>
        <div className="st">Restock Intelligence
          <InfoTip>
            <strong>Auto-detected</strong> — no manual flagging needed.<br/><br/>
            Criteria: sell-through ≥60% + FAST or MEDIUM tag + ≤5 remaining.<br/><br/>
            <strong>⚠ Now</strong> = critically low on a fast seller.<br/>
            <strong>↑ Soon</strong> = running low, order soon.<br/>
            <strong>Watch</strong> = not urgent yet.
          </InfoTip>
        </div>
        <div className="ss" style={{marginLeft:4}}>Auto-detected + manually flagged</div>
      </div>

      {restockItems.length > 0 ? (
        <>
          <div className="kg3" style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:12}}>
            {[
              {l:"Restock Now",  v:restockItems.filter(r=>r.urgency==="critical").length, c:"var(--ac)"},
              {l:"Restock Soon", v:restockItems.filter(r=>r.urgency==="high").length,     c:"var(--am)"},
              {l:"Watching",     v:restockItems.filter(r=>r.urgency==="watch").length,    c:"var(--txm)"},
            ].map(k=>(
              <div key={k.l} className="kc">
                <div className="kl">{k.l}</div>
                <div className="kv" style={{color:k.c,fontSize:20}}>{k.v}</div>
                <div className="ks">bundles</div>
              </div>
            ))}
          </div>
          <div className="tw"><div className="ts">
            <table className="tbl">
              <thead><tr>
                <th>Bundle</th><th>Remaining</th><th>Sell-through</th>
                <th>Avg Days</th><th>Avg Profit</th><th>Signal</th><th>Source</th>
              </tr></thead>
              <tbody>
                {restockItems.map((r,i)=>(
                  <tr key={i}>
<td style={{fontWeight:700,fontSize:11,whiteSpace:"normal",wordBreak:"break-word",maxWidth:160}}>{r.name}</td>
                    <td><span style={{fontWeight:700,color:r.qtyRemaining<=2?"var(--ac)":r.qtyRemaining<=4?"var(--am)":"var(--tx)"}}>{r.qtyRemaining} left</span></td>
                    <td>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <div style={{width:48,height:5,background:"var(--sf3)",borderRadius:3,overflow:"hidden",flexShrink:0}}>
                          <div style={{height:"100%",width:`${r.sellThru}%`,background:r.sellThru>=75?"var(--gn)":"var(--am)",borderRadius:3}}/>
                        </div>
                        <span style={{fontWeight:700,fontSize:11}}>{r.sellThru}%</span>
                      </div>
                    </td>
                    <td style={{color:"var(--txm)"}}>{r.avgDays||"—"}d</td>
                    <td style={{fontWeight:700,color:"var(--gn)"}}>{r.avgProfit?fmt(r.avgProfit):"—"}</td>
                    <td>
                      {r.urgency==="critical"&&<span className="badge b-r">⚠ Now</span>}
                      {r.urgency==="high"    &&<span className="badge b-am">↑ Soon</span>}
                      {r.urgency==="watch"   &&<span style={{fontSize:10,color:"var(--txd)",fontWeight:700}}>Watch</span>}
                    </td>
                    <td><span style={{fontSize:10,color:"var(--txd)"}}>{r.autoFlag?"⚡ Auto":"📌 Manual"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div></div>
        </>
      ) : (
        <div className="tw" style={{padding:"24px",textAlign:"center",color:"var(--txd)",fontSize:12}}>
          No restock candidates right now — all bundles have healthy stock levels.
        </div>
      )}

      {/* ── PLATFORM PERFORMANCE ── */}
      <div style={{marginTop:14}}>
        <div className="sh" style={{marginBottom:8}}>
          <div className="st">Platform Performance
            <InfoTip>
              <strong>Platform Performance</strong> shows how each sales channel is performing across all your listings.<br/><br/>
              <strong>Sell-through %</strong> = sold ÷ total listed on that platform.<br/>
              <strong>Avg Days</strong> = how quickly items sell once listed.<br/><br/>
              Tap any row to expand the top 5 selling items on that platform.
            </InfoTip>
          </div>
          <div className="ss" style={{marginLeft:4}}>Tap a row to see top sellers</div>
        </div>

        {platformStats.length > 0 && (() => {
          const fastest  = platformStats.reduce((a,b)=>b.avgDays&&(!a.avgDays||b.avgDays<a.avgDays)?b:a);
          const highPrice= platformStats.reduce((a,b)=>b.avgPrice>a.avgPrice?b:a);
          const topRev   = platformStats.reduce((a,b)=>b.revenue>a.revenue?b:a);
          return (
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:12}}>
              {[
                {l:"Fastest",       v:fastest.name,   s:`${fastest.avgDays.toFixed(1)}d avg`,     c:"var(--gn)"},
                {l:"Highest Price", v:highPrice.name, s:`${fmt(highPrice.avgPrice)} avg`,          c:"var(--nv)"},
                {l:"Most Revenue",  v:topRev.name,    s:`${fmt(topRev.revenue)} total`,            c:"var(--am)"},
              ].map(k=>(
                <div key={k.l} className="kc">
                  <div className="kl">{k.l}</div>
                  <div className="kv" style={{color:k.c,fontSize:16}}>{k.v}</div>
                  <div className="ks">{k.s}</div>
                </div>
              ))}
            </div>
          );
        })()}

        <div className="tw">
          <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
            <table className="tbl" style={{minWidth:500}}>
              <thead><tr>
                <th>Platform</th><th>Listed</th><th>Sold</th><th>Sell-through</th>
                <th>Avg Days</th><th>Avg Price</th><th>Revenue</th>
              </tr></thead>
              <tbody>
                {platformStats.map(p=>{
                  const sel  = selPlat===p.name;
                  const fast = p.avgDays===minDays;
                  const high = p.avgPrice===maxPrice;
                  return (
                    <tr key={p.name} className={sel?"selected-row":""} style={{cursor:"pointer"}}
                      onClick={()=>setSelPlat(sel?null:p.name)}>
                      <td>
                        <span style={{fontSize:10,color:"var(--txd)",marginRight:6}}>{sel?"▼":"▶"}</span>
                        <span style={{fontWeight:700}}>{p.name}</span>
                      </td>
                      <td style={{color:"var(--txm)"}}>{p.items}</td>
                      <td style={{fontWeight:700}}>{p.sold}</td>
                      <td>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <div style={{width:40,height:5,background:"var(--sf3)",borderRadius:3,overflow:"hidden",flexShrink:0}}>
                            <div style={{height:"100%",width:`${p.sellThru}%`,background:p.sellThru>=60?"var(--gn)":p.sellThru>=45?"var(--am)":"var(--ac)",borderRadius:3}}/>
                          </div>
                          <span style={{fontWeight:700,fontSize:11}}>{p.sellThru}%</span>
                        </div>
                      </td>
                      <td style={{fontWeight:fast?700:400,color:fast?"var(--gn)":"var(--txm)"}}>
                        {p.avgDays.toFixed(1)}d{fast?" ⚡":""}
                      </td>
                      <td style={{fontWeight:700,color:high?"var(--nv)":"var(--tx)"}}>
                        {fmt(p.avgPrice)}{high?" 🏆":""}
                      </td>
                      <td style={{fontWeight:700}}>{fmt(p.revenue)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {selPlatData && (
            <div style={{background:"var(--nvl)",borderTop:"2px solid var(--nv)",padding:"14px 16px"}}>
              <div style={{fontSize:10,fontWeight:900,textTransform:"uppercase",letterSpacing:".6px",color:"var(--nv)",marginBottom:10}}>
                Top Sellers on {selPlatData.name}
              </div>
              <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
              <table className="tbl" style={{fontSize:11,minWidth:380}}>
                <thead><tr>
                  <th>Item</th><th>Type</th><th>Sold</th><th>Avg Price</th><th>Avg Days</th>
                </tr></thead>
                <tbody>
                  {selPlatData.topItems.map((item,i)=>(
                    <tr key={i}>
<td style={{fontWeight:600,fontSize:11,whiteSpace:"normal",wordBreak:"break-word",maxWidth:160}}>{item.name}</td>
                      <td style={{color:"var(--txm)"}}>{item.type||"—"}</td>
                      <td style={{fontWeight:700}}>{item.sold}</td>
                      <td style={{fontWeight:700,color:"var(--gn)"}}>{fmt(item.avgPrice)}</td>
                      <td style={{fontWeight:700,color:item.avgDays<10?"var(--gn)":item.avgDays<20?"var(--am)":"var(--ac)"}}>
                        {item.avgDays.toFixed(1)}d
                      </td>
                    </tr>
                  ))}
                  {selPlatData.topItems.length===0&&(
                    <tr><td colSpan={5} style={{textAlign:"center",padding:16,color:"var(--txd)",fontSize:11}}>No sales data for this platform yet.</td></tr>
                  )}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── SLOW MOVERS ── */}
      <div style={{marginTop:14}}>
        <div className="sh">
          <div className="st">Slow Movers — 14+ Days Unsold
            <span className="ss" style={{marginLeft:6}}>{slowSorted.length} item{slowSorted.length!==1?"s":""}</span>
          </div>
        </div>

        <div className="filter-bar" style={{paddingBottom:10}}>
          <div style={{flex:1}}/>
          <div style={{position:"relative"}}>
            <button className="btn btn-o btn-sm" onClick={()=>slowF.setShowPanel(v=>!v)}>
              ⚡ Filters {slowF.activeFilters.length>0&&<span style={{background:"var(--ac)",color:"#fff",borderRadius:10,padding:"0 5px",fontSize:9,marginLeft:3}}>{slowF.activeFilters.length}</span>}
            </button>
            {slowF.showPanel&&(<FilterPanel colDefs={slowCols} rows={slowRaw} filters={slowF.filters} setFilter={slowF.setFilter} clearAll={slowF.clearAll} onClose={()=>slowF.setShowPanel(false)}/>)}
          </div>
          <div style={{position:"relative"}}>
            <button className="btn btn-o btn-sm" onClick={()=>setShowSlowCP(v=>!v)}>⚙ Columns</button>
            {showSlowCP&&<ColPanel cols={slowCols} setCols={setSlowCols} onClose={()=>setShowSlowCP(false)}/>}
          </div>
          <button className="btn btn-o btn-sm" onClick={()=>exportToCSV(slowSorted,slowCols,"slow_movers")}>↓ CSV</button>
        </div>

        <FilterChips colDefs={slowCols} activeFilters={slowF.activeFilters} clearFilter={slowF.clearFilter} clearAll={slowF.clearAll}/>

        <div className="tw"><div className="ts">
          <table className="tbl">
            <thead><tr>
              {visSlow.map(c=>(
                <STh key={c.id} col={c.id} sortCol={slowSortCol} sortDir={slowSortDir} onSort={onSlowSort}>{c.label}</STh>
              ))}
            </tr></thead>
            <tbody>
              {slowSorted.length===0?(
                <tr><td colSpan={visSlow.length} style={{textAlign:"center",padding:26,color:"var(--txd)"}}>
                  {slowRaw.length===0?"No listings have been unsold for 14+ days. 🎉":"No items match filters."}
                </td></tr>
              ):slowSorted.map(l=>(
                <tr key={l.sku}>{visSlow.map(c=><td key={c.id}>{renderSlowCell(c.id,l)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div></div>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   GROWTH — Command 10
═══════════════════════════════════════════════════════════════ */
function Growth({ listings, stockData }) {
  const [cashMode, setCashMode] = useState("chart");

  const sold   = listings.filter(l=>l.sold);
  const active = listings.filter(l=>l.listed&&!l.sold);
  const totalRevenue = sold.reduce((a,l)=>a+(l.soldPrice||0),0);
  const totalProfit  = sold.reduce((a,l)=>a+(l.profit||0),0);
  const st = (sold.length+active.length) ? Math.round(sold.length/(sold.length+active.length)*100) : 0;

  /* ── Cash Flow — last 8 weeks ── */
  const cashWeeks = useMemo(() => {
    const weeks = [];
    for (let i=7;i>=0;i--) {
      const ws=new Date(_wsd); ws.setDate(ws.getDate()-i*7);
      const we=new Date(ws);   we.setDate(we.getDate()+6);
      const wsStr=localDateStr(ws), weStr=localDateStr(we);
      const moneyIn  = sold.filter(l=>l.daySold&&l.daySold>=wsStr&&l.daySold<=weStr)
                           .reduce((a,l)=>a+(l.soldPrice||0),0);
      const moneyOut = stockData.filter(s=>s.datePurchased&&s.datePurchased>=wsStr&&s.datePurchased<=weStr)
                                .reduce((a,s)=>a+(s.totalCost||0),0);
      weeks.push({
        label: ws.toLocaleDateString("en-GB",{day:"numeric",month:"short"}),
        moneyIn, moneyOut, net: moneyIn-moneyOut,
      });
    }
    let running = 0;
    weeks.forEach(w => { running += w.net; w.balance = running; });
    return weeks;
  }, [sold, stockData]);

  const maxCash = Math.max(...cashWeeks.map(w=>Math.max(w.moneyIn,w.moneyOut)),1);
  const minBal  = Math.min(...cashWeeks.map(w=>w.balance),0);
  const maxBal  = Math.max(...cashWeeks.map(w=>w.balance),1);
  const balRange= maxBal-minBal||1;
  const svgH    = 50;
  const balPoints = cashWeeks.map((w,i)=>{
    const x = cashWeeks.length===1 ? 50 : (i/(cashWeeks.length-1))*100;
    const y = svgH-5-((w.balance-minBal)/balRange)*(svgH-10);
    return {x,y,w};
  });

  /* ── 12-week revenue/profit ── */
  const weeks12 = useMemo(() => {
    const weeks=[];
    for(let i=11;i>=0;i--){
      const ws=new Date(_wsd); ws.setDate(ws.getDate()-i*7);
      const we=new Date(ws);   we.setDate(we.getDate()+6);
      const wsStr=localDateStr(ws), weStr=localDateStr(we);
      const wSold=sold.filter(l=>l.daySold&&l.daySold>=wsStr&&l.daySold<=weStr);
      weeks.push({
        label:ws.toLocaleDateString("en-GB",{day:"numeric",month:"short"}),
        revenue:wSold.reduce((a,l)=>a+(l.soldPrice||0),0),
        profit:wSold.reduce((a,l)=>a+(l.profit||0),0),
        count:wSold.length,
      });
    }
    return weeks;
  }, [sold]);
  const maxRev = Math.max(...weeks12.map(w=>w.revenue),1);

  /* ── Best weeks (24-week window) ── */
  const bestWeeks = useMemo(() => {
    const weeks=[];
    for(let i=23;i>=0;i--){
      const ws=new Date(_wsd); ws.setDate(ws.getDate()-i*7);
      const we=new Date(ws);   we.setDate(we.getDate()+6);
      const wsStr=localDateStr(ws), weStr=localDateStr(we);
      const wSold=sold.filter(l=>l.daySold&&l.daySold>=wsStr&&l.daySold<=weStr);
      const rev=wSold.reduce((a,l)=>a+(l.soldPrice||0),0);
      if(rev>0) weeks.push({label:ws.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"2-digit"}),revenue:rev,count:wSold.length});
    }
    return [...weeks].sort((a,b)=>b.revenue-a.revenue);
  }, [sold]);

  /* ── Monthly avg profit ── */
  const monthlyAvg = useMemo(() => {
    const mons=[];
    let d=new Date(2024,10,1);
    while(d<=NOW){
      const mk=d.toISOString().slice(0,7);
      const mSold=sold.filter(l=>l.daySold&&l.daySold.startsWith(mk));
      const prof=mSold.reduce((a,l)=>a+(l.profit||0),0);
      if(mSold.length) mons.push({label:d.toLocaleDateString("en-GB",{month:"short",year:"2-digit"}),avg:prof/mSold.length,count:mSold.length});
      d=new Date(d.getFullYear(),d.getMonth()+1,1);
    }
    return mons;
  }, [sold]);

  return (
    <div>
      {/* KPI cards */}
      <div className="kg kg3" style={{marginBottom:14}}>
        {[
          {l:"All-time Revenue",v:sold.length?fmt(totalRevenue):"—",b:"",   s:`${sold.length} items sold`},
          {l:"All-time Profit", v:sold.length?fmt(totalProfit):"—", b:"gn", s:"Net after stock costs"},
          {l:"Sell-through %",  v:`${st}%`,                          b:"nv", s:`${sold.length} of ${sold.length+active.length}`},
        ].map(k=>(
          <div key={k.l} className="kc">
            <div className={`kb ${k.b}`}/>
            <div className="kl">{k.l}</div>
            <div className="kv" style={{fontSize:typeof k.v==="string"&&k.v.startsWith("£")?18:24}}>{k.v}</div>
            <div className="ks">{k.s}</div>
          </div>
        ))}
      </div>

      {/* ── CASH FLOW (first) ── */}
      <div className="tw" style={{padding:"18px 20px",marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:4}}>
              <div className="st">Cash Flow — Last 8 Weeks</div>
              <InfoTip>
                <strong>Cash Flow</strong> tracks money moving in and out of your business each week.<br/><br/>
                <strong style={{color:"#a8e6b0"}}>Green bars</strong> = sales proceeds that week.<br/>
                <strong style={{color:"#f4a4a4"}}>Red bars</strong> = stock purchased that week.<br/><br/>
                The <strong>balance line</strong> shows your running cash position — use it to judge whether you can afford the next bale before committing.
              </InfoTip>
            </div>
            <div className="ss">Money in (sales) vs money out (stock spend)</div>
          </div>
          <div style={{display:"flex",gap:8}}>
            {["chart","table"].map(m=>(
              <button key={m} onClick={()=>setCashMode(m)}
                style={{padding:"4px 12px",fontSize:11,fontWeight:700,border:"1px solid var(--bdd)",
                  borderRadius:20,cursor:"pointer",
                  background:cashMode===m?"var(--nv)":"var(--sf)",
                  color:cashMode===m?"#fff":"var(--txm)"}}>
                {m==="chart"?"Chart":"Table"}
              </button>
            ))}
          </div>
        </div>

        {cashMode==="chart" && (
          <div>
            {/* Bars */}
            <div style={{display:"flex",gap:6,alignItems:"flex-end",height:100,marginBottom:8}}>
              {cashWeeks.map((w,i)=>(
                <div key={i} style={{flex:1,display:"flex",gap:2,alignItems:"flex-end",height:"100%"}}>
                  <div style={{flex:1,height:`${Math.round(w.moneyIn/maxCash*100)}%`,
                    background:"var(--gnl)",border:"1px solid var(--gn)",
                    borderRadius:"2px 2px 0 0",minHeight:w.moneyIn?2:0}}/>
                  {w.moneyOut>0
                    ? <div style={{flex:1,height:`${Math.round(w.moneyOut/maxCash*100)}%`,
                        background:"var(--acl)",border:"1px solid var(--ac2)",
                        borderRadius:"2px 2px 0 0",minHeight:2}}/>
                    : <div style={{flex:1}}/>
                  }
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:6,marginBottom:14}}>
              {cashWeeks.map((w,i)=>(
                <div key={i} style={{flex:1,fontSize:7,color:"var(--txd)",textAlign:"center"}}>{w.label}</div>
              ))}
            </div>
            {/* Balance sparkline */}
            <div style={{background:"var(--sf2)",borderRadius:"var(--r)",padding:"10px 12px",marginBottom:10}}>
              <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:"var(--txd)",marginBottom:8}}>
                Running Cash Balance
              </div>
              <svg width="100%" height={svgH} style={{overflow:"visible",display:"block"}}>
                {balPoints.map((pt,i)=>{
                  if(i===0) return null;
                  const prev=balPoints[i-1];
                  return <line key={i}
                    x1={`${prev.x}%`} y1={prev.y}
                    x2={`${pt.x}%`}   y2={pt.y}
                    stroke="var(--nv)" strokeWidth="2" strokeLinecap="round"/>;
                })}
                {balPoints.map((pt,i)=>(
                  <circle key={i} cx={`${pt.x}%`} cy={pt.y} r="3" fill="var(--nv)"/>
                ))}
              </svg>
              <div style={{display:"flex",justifyContent:"space-between",marginTop:4,fontSize:10}}>
                <span style={{color:"var(--txd)"}}>8-week net: {cashWeeks.reduce((a,w)=>a+w.net,0)>=0?"+":""}{fmt(cashWeeks.reduce((a,w)=>a+w.net,0))}</span>
                <span style={{fontWeight:700,color:cashWeeks.at(-1).balance>=0?"var(--nv)":"var(--ac)"}}>
                  Current balance: {fmt(cashWeeks.at(-1).balance)}
                </span>
              </div>
            </div>
            <div style={{display:"flex",gap:14,fontSize:10,color:"var(--txm)"}}>
              <span><span style={{display:"inline-block",width:10,height:10,background:"var(--gnl)",border:"1px solid var(--gn)",borderRadius:2,marginRight:4,verticalAlign:"middle"}}/> Money In</span>
              <span><span style={{display:"inline-block",width:10,height:10,background:"var(--acl)",border:"1px solid var(--ac2)",borderRadius:2,marginRight:4,verticalAlign:"middle"}}/> Stock Spend</span>
            </div>
          </div>
        )}

        {cashMode==="table" && (
          <table className="tbl">
            <thead><tr><th>Week</th><th>Money In</th><th>Stock Spend</th><th>Net</th><th>Running Balance</th></tr></thead>
            <tbody>
              {cashWeeks.map((w,i)=>(
                <tr key={i}>
                  <td style={{fontWeight:700}}>{w.label}</td>
                  <td style={{color:"var(--gn)",fontWeight:700}}>{w.moneyIn>0?fmt(w.moneyIn):"—"}</td>
                  <td style={{color:w.moneyOut>0?"var(--ac)":"var(--txd)"}}>{w.moneyOut>0?fmt(w.moneyOut):"—"}</td>
                  <td style={{fontWeight:700,color:w.net>=0?"var(--gn)":"var(--ac)"}}>{w.net>=0?"+":""}{fmt(w.net)}</td>
                  <td style={{fontWeight:700,color:w.balance<0?"var(--ac)":"var(--nv)"}}>{fmt(w.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── REVENUE & PROFIT CHART (second) ── */}
      <div className="tw" style={{padding:"18px 20px",marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",gap:4,marginBottom:14}}>
          <div className="st">Revenue & Profit — Last 12 Weeks</div>
          <InfoTip>
            <strong style={{color:"#f4a4a4"}}>Pink bars</strong> = total revenue (what buyers paid) that week.<br/><br/>
            <strong style={{color:"#a8e6b0"}}>Green bars</strong> = net profit — revenue minus your stock cost. Overlaid inside the pink bar.<br/><br/>
            A small green bar inside a large pink bar means thin margins that week — worth investigating which items sold.
          </InfoTip>
        </div>
        <div style={{display:"flex",alignItems:"flex-end",gap:4,height:120,overflow:"hidden",minWidth:0}}>
          {weeks12.map((w,i)=>(
            <div key={i} style={{flex:"1 1 0",minWidth:0,display:"flex",flexDirection:"column",alignItems:"center",height:"100%",justifyContent:"flex-end"}}>
              <div style={{width:"100%",height:"100%",position:"relative"}}>
                <div title={`Revenue: ${fmt(w.revenue)}`} style={{position:"absolute",bottom:0,left:0,right:0,
                  height:`${Math.round(w.revenue/maxRev*100)}%`,background:"var(--acl)",
                  border:"1px solid var(--ac2)",borderRadius:"2px 2px 0 0",minHeight:w.revenue?2:0}}/>
                <div title={`Profit: ${fmt(w.profit)}`} style={{position:"absolute",bottom:0,left:"15%",right:"15%",
                  height:`${Math.round(Math.max(0,w.profit)/maxRev*100)}%`,
                  background:w.profit>=0?"var(--gn)":"var(--ac)",
                  borderRadius:"2px 2px 0 0",opacity:.85,minHeight:w.profit?2:0}}/>
              </div>
              <div style={{fontSize:9,color:"var(--txd)",whiteSpace:"nowrap",
                transform:"rotate(-45deg)",transformOrigin:"center",marginTop:4,width:30,textAlign:"center"}}>
                {w.label}
              </div>
            </div>
          ))}
        </div>
        <div style={{display:"flex",gap:14,marginTop:18,fontSize:10,color:"var(--txm)"}}>
          <span><span style={{display:"inline-block",width:10,height:10,background:"var(--acl)",border:"1px solid var(--ac2)",borderRadius:2,marginRight:4,verticalAlign:"middle"}}/>Revenue</span>
          <span><span style={{display:"inline-block",width:10,height:10,background:"var(--gn)",borderRadius:2,marginRight:4,verticalAlign:"middle",opacity:.7}}/>Profit</span>
        </div>
      </div>

      {/* ── BEST WEEKS + MONTHLY AVG ── */}
      <div className="two-col">
        <div className="tw" style={{padding:"16px 18px"}}>
          <div style={{display:"flex",alignItems:"center",gap:4,marginBottom:10}}>
            <div className="st">🏆 Best Weeks by Revenue</div>
            <InfoTip>
              Your top 5 revenue weeks of all time. Useful for spotting seasonality — if your best weeks cluster around the same months, plan restocking and listing volume around those peaks.
            </InfoTip>
          </div>
          {bestWeeks.slice(0,5).map((w,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
              padding:"6px 0",borderBottom:"1px solid var(--bd)",fontSize:12}}>
              <span><span style={{fontWeight:700,color:"var(--ac)",marginRight:8}}>#{i+1}</span>{w.label}</span>
              <span style={{fontWeight:700,color:"var(--gn)"}}>{fmt(w.revenue)}<span style={{fontSize:10,color:"var(--txd)",marginLeft:6}}>{w.count} sold</span></span>
            </div>
          ))}
          {bestWeeks.length===0&&<div style={{fontSize:12,color:"var(--txd)"}}>No sales data yet.</div>}
        </div>

        <div className="tw" style={{padding:"16px 18px"}}>
          <div className="st" style={{marginBottom:10}}>📈 Avg Profit / Sale by Month</div>
          {monthlyAvg.map((m,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
              padding:"6px 0",borderBottom:"1px solid var(--bd)",fontSize:12}}>
              <span style={{color:"var(--txm)"}}>{m.label}</span>
              <span style={{fontWeight:700,color:m.avg>=0?"var(--gn)":"var(--ac)"}}>{fmt(m.avg)}<span style={{fontSize:10,color:"var(--txd)",marginLeft:6}}>{m.count} sold</span></span>
            </div>
          ))}
          {monthlyAvg.length===0&&<div style={{fontSize:12,color:"var(--txd)"}}>No sales data yet.</div>}
        </div>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   HISTORY — Command 10
═══════════════════════════════════════════════════════════════ */
const MONTH_HIST_COLS = [
  {id:"label",      label:"Month",           visible:true },
  {id:"sold",       label:"Items Sold",      visible:true },
  {id:"listed",     label:"Items Listed",    visible:true },
  {id:"proceeds",   label:"Proceeds",        visible:true },
  {id:"profit",     label:"Profit Kept",     visible:true },
  {id:"stockQty",   label:"Items Purchased", visible:true },
  {id:"stockSpend", label:"Stock Purchased (£)", visible:true },
];
const WEEK_HIST_COLS = [
  {id:"label",      label:"Week Starting", visible:true },
  {id:"listed",     label:"Listed",        visible:true },
  {id:"sold",       label:"Sold",          visible:true },
  {id:"revenue",    label:"Revenue",       visible:true },
  {id:"profit",     label:"Profit Kept",   visible:true },
  {id:"stockSpend", label:"Stock Purchased (£)",   visible:true },
  {id:"activeLive", label:"Active at EOW", visible:true },
];

/* ═══════════════════════════════════════════════════════════════
   VERSION HISTORY — Local backup restore
═══════════════════════════════════════════════════════════════ */
function VersionHistory({ onRestore }) {
  const [versions, setVersions]     = useState([]);
  const [selected, setSelected]     = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("app_state_snapshots")
        .select("snapshot_date, listings, stock_data, manual, created_at")
        .order("snapshot_date", { ascending: false });
      if (cancelled) return;
      if (error) { console.error("Failed to load version history:", error.message); setLoading(false); return; }

      const today     = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
      const yesterday = new Date(Date.now() - 86400000).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
      const v = (data || []).map(row => {
        const d = new Date(row.snapshot_date + "T00:00:00");
        const dayLabel = row.snapshot_date === today ? "Today"
          : row.snapshot_date === yesterday ? "Yesterday"
          : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
        const timeLabel = new Date(row.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
        return {
          ts: row.created_at,
          dayLabel, timeLabel,
          label: `${dayLabel} at ${timeLabel}${row.manual ? " — Manual save" : ""}`,
          listingsCount: row.listings?.length || 0,
          listings: row.listings || [],
          stockData: row.stock_data || [],
          manual: !!row.manual,
        };
      });
      setVersions(v);
      if (v.length) setSelected(v[0]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const exportVersion = (v) => {
    // ── Pure-JS XLSX builder — no library or CDN needed ──
    const esc = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    const buildSheet = (rows) => {
      if (!rows.length) return { xml: '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>', rels: [] };
      const cols = Object.keys(rows[0]);
      const toCol = (i) => { let s="",n=i+1; while(n>0){s=String.fromCharCode(65+(n-1)%26)+s;n=Math.floor((n-1)/26);} return s; };
      const sharedStrings = []; const ssMap = {};
      const si = (val) => { const k=String(val); if(ssMap[k]===undefined){ssMap[k]=sharedStrings.length;sharedStrings.push(k);} return ssMap[k]; };
      let xml = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
      // Header row
      xml += '<row r="1">';
      cols.forEach((c,ci) => { xml += `<c r="${toCol(ci)}1" t="s"><v>${si(c)}</v></c>`; });
      xml += '</row>';
      // Data rows
      rows.forEach((row, ri) => {
        xml += `<row r="${ri+2}">`;
        cols.forEach((c, ci) => {
          const val = row[c];
          const ref = `${toCol(ci)}${ri+2}`;
          if (val === "" || val === null || val === undefined) {
            xml += `<c r="${ref}"/>`;
          } else if (typeof val === "number") {
            xml += `<c r="${ref}"><v>${val}</v></c>`;
          } else {
            xml += `<c r="${ref}" t="s"><v>${si(String(val))}</v></c>`;
          }
        });
        xml += '</row>';
      });
      xml += '</sheetData></worksheet>';
      const ssXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">${sharedStrings.map(s=>`<si><t xml:space="preserve">${esc(s)}</t></si>`).join("")}</sst>`;
      return { xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${xml}`, ssXml };
    };

    // ── Derive computed stock fields ──
    const stockRows = v.stockData.map(s => {
      const dupeSku  = v.stockData.filter(s2 => s2.bundleSku === s.bundleSku).length > 1;
      const items    = dupeSku ? v.listings.filter(l=>l.bundleSku===s.bundleSku&&l.name===s.name) : v.listings.filter(l=>l.bundleSku===s.bundleSku);
      const soldItems   = items.filter(l=>l.sold);
      const listedItems = items.filter(l=>l.listed);
      const netProceeds = soldItems.reduce((a,l)=>a+(l.soldPrice||0),0);
      const totalCost   = s.totalCost||(s.sellable*(s.costPer||0));
      const costPerItem = s.sellable>0?totalCost/s.sellable:(s.costPer||0);
      const totalProfit = netProceeds-totalCost;
      const stockValLeft= items.filter(l=>!l.sold).length*costPerItem;
      const sellThru    = s.sellable?Math.round(soldItems.length/s.sellable*100):0;
      const avgProfit   = soldItems.length?(netProceeds-soldItems.length*costPerItem)/soldItems.length:0;
      const avgSoldPrice= soldItems.length?netProceeds/soldItems.length:0;
      return {
        "Bundle SKU":s.bundleSku||"","Stock Name":s.name||"","Website":s.website||"","Seller":s.seller||"",
        "Date Ordered":s.datePurchased||"","Date Received":s.dateArrived||"","Contents":s.contentDetails||"",
        "Received Qty":s.received||0,"Sellable":s.sellable||0,
        "Cost/pc":costPerItem!=null?+costPerItem.toFixed(4):0,"Total Cost":+totalCost.toFixed(2),
        "Qty Sold":soldItems.length,"Qty Listed":listedItems.length,
        "Qty Remaining":items.filter(l=>!l.sold).length,"To List":items.filter(l=>!l.listed&&!l.sold).length,
        "Net Proceeds":+netProceeds.toFixed(2),"Bundle Profit":+totalProfit.toFixed(2),
        "Stock Val Left":+stockValLeft.toFixed(2),"Sell-through %":sellThru,
        "Avg Sold Price":soldItems.length?+avgSoldPrice.toFixed(2):"","Avg Profit":soldItems.length?+avgProfit.toFixed(2):"",
        "Restock?":s.restock?"Yes":"No","Imported":s.imported?"Yes":"No",
      };
    });

    // ── Listings sheet ──
    const listingRows = v.listings.map(l => ({
      "SKU":l.sku||"","Bundle SKU":l.bundleSku||"","Stock Name":l.name||"","Brand":l.brand||"",
      "Type":l.type||"","Colour":l.colour||"","Size":l.size||"","Description":l.desc||"",
      "Length":l.length||"","Pit to Pit":l.pitToPit||"",
      "Price":l.price!=null?+Number(l.price).toFixed(2):"",
      "Listed?":l.listed?"Yes":"No","Day Listed":l.dayListed||"",
      "Platforms":Array.isArray(l.platforms)?l.platforms.join(", "):(l.platform||""),
      "Platform Sold":l.platform||"","Sold?":l.sold?"Yes":"No",
      "Sold Price":l.soldPrice!=null?+Number(l.soldPrice).toFixed(2):"",
      "Net Profit":l.profit!=null?+Number(l.profit).toFixed(2):"",
      "Day Sold":l.daySold||"","Days to Sell":l.days!=null?l.days:"",
      "Shipped?":l.shipped?"Yes":"No","Shipped Date":l.shippedDate||"",
      "Pending Return?":l.pendingReturn?"Yes":"No","Return Reason":l.returnReason||"","Notes":l.notes||"",
    }));

    // ── Build two separate sheets with their own shared string tables ──
    const sheet1 = buildSheet(listingRows);
    const sheet2 = buildSheet(stockRows);

    // ── Assemble XLSX (ZIP) manually using a simple binary builder ──
    const enc = (s) => new TextEncoder().encode(s);
    const crc32 = (data) => {
      let c=0xFFFFFFFF; const t=new Uint32Array(256);
      for(let i=0;i<256;i++){let k=i;for(let j=0;j<8;j++)k=k&1?(0xEDB88320^(k>>>1)):k>>>1;t[i]=k;}
      for(let i=0;i<data.length;i++)c=t[(c^data[i])&0xFF]^(c>>>8);
      return (c^0xFFFFFFFF)>>>0;
    };
    const u32le = (n) => { const b=new Uint8Array(4); new DataView(b.buffer).setUint32(0,n,true); return b; };
    const u16le = (n) => { const b=new Uint8Array(2); new DataView(b.buffer).setUint16(0,n,true); return b; };
    const cat   = (...arrays) => { const total=arrays.reduce((a,b)=>a+b.length,0); const out=new Uint8Array(total); let off=0; arrays.forEach(a=>{out.set(a,off);off+=a.length;}); return out; };

    const makeEntry = (name, content) => {
      const nameBytes = enc(name);
      const crc = crc32(content);
      const local = cat(
        new Uint8Array([0x50,0x4B,0x03,0x04,0x14,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00]),
        u32le(crc), u32le(content.length), u32le(content.length),
        u16le(nameBytes.length), u16le(0),
        nameBytes, content
      );
      return { name: nameBytes, local, crc, size: content.length };
    };

    // Minimal XLSX content files
    const wbXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Listings" sheetId="1" r:id="rId1"/><sheet name="Stock" sheetId="2" r:id="rId2"/></sheets></workbook>`;
    const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`;
    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

    // Merge shared strings from both sheets into one table
    const allStrings = []; const allMap = {};
    const reindex = (ssXml) => {
      const matches = [...ssXml.matchAll(/<t xml:space="preserve">([\s\S]*?)<\/t>/g)];
      return matches.map(m => { const s=m[1].replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"'); if(allMap[s]===undefined){allMap[s]=allStrings.length;allStrings.push(s);} return allMap[s]; });
    };

    // Re-run sheet builds pointing at the combined string table
    const rebuildSheet = (rows) => {
      if (!rows.length) return enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>`);
      const cols = Object.keys(rows[0]);
      const toCol = (i) => { let s="",n=i+1; while(n>0){s=String.fromCharCode(65+(n-1)%26)+s;n=Math.floor((n-1)/26);} return s; };
      const si = (val) => { const k=String(val); if(allMap[k]===undefined){allMap[k]=allStrings.length;allStrings.push(k);} return allMap[k]; };
      let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>`;
      xml += `<row r="1">`; cols.forEach((c,ci)=>{ xml+=`<c r="${toCol(ci)}1" t="s"><v>${si(c)}</v></c>`; }); xml+=`</row>`;
      rows.forEach((row,ri)=>{
        xml+=`<row r="${ri+2}">`;
        cols.forEach((c,ci)=>{
          const val=row[c]; const ref=`${toCol(ci)}${ri+2}`;
          if(val===""||val===null||val===undefined){ xml+=`<c r="${ref}"/>`; }
          else if(typeof val==="number"){ xml+=`<c r="${ref}"><v>${val}</v></c>`; }
          else{ xml+=`<c r="${ref}" t="s"><v>${si(String(val))}</v></c>`; }
        });
        xml+=`</row>`;
      });
      xml+=`</sheetData></worksheet>`;
      return enc(xml);
    };

    const s1bytes = rebuildSheet(listingRows);
    const s2bytes = rebuildSheet(stockRows);
    const ssXmlFinal = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${allStrings.length}" uniqueCount="${allStrings.length}">${allStrings.map(s=>`<si><t xml:space="preserve">${esc(s)}</t></si>`).join("")}</sst>`;

    const files = [
      makeEntry("[Content_Types].xml",       enc(contentTypes)),
      makeEntry("_rels/.rels",               enc(rootRels)),
      makeEntry("xl/workbook.xml",           enc(wbXml)),
      makeEntry("xl/_rels/workbook.xml.rels",enc(wbRels)),
      makeEntry("xl/worksheets/sheet1.xml",  s1bytes),
      makeEntry("xl/worksheets/sheet2.xml",  s2bytes),
      makeEntry("xl/sharedStrings.xml",      enc(ssXmlFinal)),
    ];

    // Build ZIP central directory
    let offset = 0;
    const locals = files.map(f => { const l=f.local; offset+=l.length; return l; });
    const centralDir = files.map((f, i) => {
      let off = files.slice(0,i).reduce((a,x)=>a+x.local.length,0);
      return cat(
        new Uint8Array([0x50,0x4B,0x01,0x02,0x14,0x00,0x14,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00]),
        u32le(f.crc), u32le(f.size), u32le(f.size),
        u16le(f.name.length), u16le(0), u16le(0), u16le(0), u16le(0),
        u32le(0), u32le(off), f.name
      );
    });
    const cdSize   = centralDir.reduce((a,b)=>a+b.length,0);
    const cdOffset = locals.reduce((a,b)=>a+b.length,0);
    const eocd = cat(
      new Uint8Array([0x50,0x4B,0x05,0x06,0x00,0x00,0x00,0x00]),
      u16le(files.length), u16le(files.length),
      u32le(cdSize), u32le(cdOffset), u16le(0)
    );

    const zip = cat(...locals, ...centralDir, eocd);
    const blob = new Blob([zip], {type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ArchiveDistrict_${v.label.replace(/[^a-zA-Z0-9]/g,"_")}.xlsx`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div>
      <div className="info-banner">
        <strong>Version History</strong> — One automatic snapshot every day at 6am (UK time), plus any manual 💾 saves. Keeps a rolling 14 days, synced to your account so it's the same on every device.
      </div>

      {loading ? (
        <div className="tw" style={{padding:"32px 24px",textAlign:"center",color:"var(--txd)",fontSize:12}}>
          Loading…
        </div>
      ) : versions.length === 0 ? (
        <div className="tw" style={{padding:"32px 24px",textAlign:"center"}}>
          <div style={{fontSize:28,opacity:.15,marginBottom:12}}>🕐</div>
          <div style={{fontSize:13,color:"var(--txd)"}}>No snapshots yet.</div>
          <div style={{fontSize:11,color:"var(--txd)",marginTop:6}}>
            The first automatic snapshot runs at 6am UK time. Click 💾 Save in the top bar to create one right now.
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
                      display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                      {i===0 && <span style={{width:7,height:7,borderRadius:"50%",background:"var(--gn)",display:"inline-block",flexShrink:0}}/>}
                      <span style={{color:v.dayLabel==="Today"?"var(--gn)":v.dayLabel==="Yesterday"?"var(--am)":"var(--tx)"}}>
                        {v.dayLabel||v.label}
                      </span>
                      <span style={{fontSize:10,fontWeight:400,color:"var(--txd)"}}>at {v.timeLabel||""}</span>
                      {v.manual && <span style={{fontSize:9,fontWeight:700,background:"var(--nvl)",color:"var(--nv)",borderRadius:3,padding:"1px 5px"}}>💾 Manual</span>}
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
                  ↓ Export as XLSX (Listings + Stock)
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
      monthKeys.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
      d = new Date(d.getFullYear(), d.getMonth()+1, 1);
    }

    const months = monthKeys.map(mk => {
      const [y,mo] = mk.split("-");
      const mListings = listings.filter(l => l.sold && l.daySold?.startsWith(mk));
      const mListed   = listings.filter(l => l.dayListed?.startsWith(mk));
      const mStock    = stockData.filter(s => s.datePurchased?.startsWith(mk));
      const profitLog = liveData?.profitLog || [];
      const profitKept = profitLog.filter(e => e.date?.startsWith(mk)).reduce((a,e)=>a+e.amount, 0);
      return {
        label: new Date(+y,+mo-1,1).toLocaleDateString("en-GB",{month:"short",year:"numeric"}),
        sold: mListings.length,
        listed: mListed.length,
        proceeds: mListings.reduce((a,l)=>a+(l.soldPrice||0),0),
        profit:   mListings.reduce((a,l)=>a+(l.profit||0),0),
        profitKept,
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
    if (col==="listed")     return r.listed > 0 ? <span style={{fontWeight:700}}>{r.listed}</span> : <span style={{color:"var(--txd)"}}>—</span>;
    if (col==="proceeds")   return renderNum(r.proceeds, "var(--gn)");
    if (col==="profit")     return r.profitKept > 0 ? renderNum(r.profitKept, "var(--gn)") : <span style={{color:"var(--txd)"}}>—</span>;
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

/* ═══════════════════════════════════════════════════════════════
   SETTINGS — Platform management
═══════════════════════════════════════════════════════════════ */
/* ── Settings helper components — top-level so React identity is stable ── */
function SettingsHeader({ title, sub }) {
  return (
    <div style={{marginBottom:16}}>
      <div style={{fontWeight:900,fontSize:12,textTransform:"uppercase",letterSpacing:".5px",color:"var(--txm)",marginBottom:2}}>{title}</div>
      {sub && <div style={{fontSize:11,color:"var(--txd)",lineHeight:1.5}}>{sub}</div>}
    </div>
  );
}
function SettingRow({ label, children }) {
  return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 0",borderBottom:"1px solid var(--bd)",gap:12}}>
      <span style={{fontSize:12,color:"var(--txm)",flex:1}}>{label}</span>
      <div style={{flexShrink:0}}>{children}</div>
    </div>
  );
}
function SettingToggle({ value, onChange }) {
  return (
    <div onClick={()=>onChange(!value)} style={{width:38,height:22,borderRadius:11,background:value?"var(--gn)":"var(--bdd)",position:"relative",cursor:"pointer",transition:"background .2s",flexShrink:0}}>
      <div style={{width:16,height:16,borderRadius:"50%",background:"#fff",position:"absolute",top:3,left:value?19:3,transition:"left .2s",boxShadow:"0 1px 3px rgba(0,0,0,.2)"}}/>
    </div>
  );
}
function SettingNumInput({ value, onChange, min, max, placeholder, width=110 }) {
  return (
    <input type="number" min={min} max={max} placeholder={placeholder}
      value={value||""} onChange={e=>onChange(e.target.value)}
      style={{width,minWidth:0,background:"var(--sf2)",border:"1px solid var(--bdd)",borderRadius:"var(--r)",padding:"5px 8px",fontFamily:"Arial,sans-serif",fontSize:12,fontWeight:700,outline:"none",textAlign:"right"}}/>
  );
}

function SettingsContact() {
  const [type,    setType]    = useState("question");
  const [name,    setName]    = useState("");
  const [email,   setEmail]   = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [status,  setStatus]  = useState("idle"); // idle | sending | sent | error

  const submit = async () => {
    if (!subject.trim() || !message.trim()) return;
    setStatus("sending");
    const { error } = await supabase.from("contact_submissions").insert({
      user_name: name.trim() || null,
      user_email: email.trim() || null,
      type,
      subject: subject.trim(),
      message: message.trim(),
    });
    if (error) { setStatus("error"); return; }
    setStatus("sent");
    setSubject(""); setMessage("");
    setTimeout(() => setStatus("idle"), 3000);
  };

  return (
    <div className="tw" style={{padding:"18px 20px",marginBottom:14}}>
      <SettingsHeader title="Contact Us" sub="Send a question, suggestion, or bug report." />
      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
        {[
          {id:"question",   label:"Question"},
          {id:"suggestion", label:"Suggestion"},
          {id:"issue",      label:"Issue"},
        ].map(t => (
          <button key={t.id} onClick={()=>setType(t.id)}
            style={{padding:"6px 14px",fontSize:11,fontWeight:700,borderRadius:20,cursor:"pointer",
              border:`1.5px solid ${type===t.id?"var(--ac)":"var(--bd)"}`,
              background:type===t.id?"var(--acl)":"var(--sf2)",
              color:type===t.id?"var(--ac)":"var(--txm)",transition:"all .12s"}}>
            {t.label}
          </button>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="Your name (optional)"
          style={{background:"var(--sf2)",border:"1px solid var(--bdd)",borderRadius:"var(--r)",padding:"7px 10px",fontFamily:"Arial,sans-serif",fontSize:12,outline:"none"}}/>
        <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="Your email (optional)"
          style={{background:"var(--sf2)",border:"1px solid var(--bdd)",borderRadius:"var(--r)",padding:"7px 10px",fontFamily:"Arial,sans-serif",fontSize:12,outline:"none"}}/>
      </div>
      <input value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Subject"
        style={{width:"100%",background:"var(--sf2)",border:"1px solid var(--bdd)",borderRadius:"var(--r)",padding:"7px 10px",fontFamily:"Arial,sans-serif",fontSize:12,outline:"none",marginBottom:10,boxSizing:"border-box"}}/>
      <textarea value={message} onChange={e=>setMessage(e.target.value)} placeholder="Message" rows={5}
        style={{width:"100%",background:"var(--sf2)",border:"1px solid var(--bdd)",borderRadius:"var(--r)",padding:"9px 10px",fontFamily:"Arial,sans-serif",fontSize:12,outline:"none",resize:"vertical",boxSizing:"border-box",marginBottom:12}}/>
      <div style={{display:"flex",justifyContent:"flex-end",alignItems:"center",gap:10}}>
        {status==="sent"  && <span style={{fontSize:11,color:"var(--gn)",fontWeight:700}}>✓ Sent — thanks!</span>}
        {status==="error" && <span style={{fontSize:11,color:"var(--ac)",fontWeight:700}}>Couldn't send — try again</span>}
        <button onClick={submit} disabled={status==="sending"||!subject.trim()||!message.trim()}
          style={{background:"var(--gn)",color:"#fff",border:"none",borderRadius:"var(--r)",padding:"8px 20px",cursor:"pointer",fontSize:12,fontWeight:700,opacity:(status==="sending"||!subject.trim()||!message.trim())?.55:1}}>
          {status==="sending"?"Sending…":"Send"}
        </button>
      </div>
    </div>
  );
}

function Settings({ liveData, setLiveData, customPlatforms, setListings, onRestoreVersion, exportJSON, initialTab }) {
  // platformAccounts shape: { Vinted: ["Vinted 1","Vinted 2"], Depop: ["Depop"], ... }
  const initAccounts = () => {
    const pa = liveData?.platformAccounts;
    if (pa && typeof pa === "object" && !Array.isArray(pa)) return pa;
    // Migrate from old flat array OR build from scratch
    const flat = Array.isArray(liveData?.platforms) ? liveData.platforms : [];
    const result = {};
    PLAT_FAMILY_BASES.forEach(base => {
      // Find any accounts in old flat list belonging to this base
      const matches = flat.filter(p => getPlatFamily(p) === base);
      result[base] = matches.length ? matches : [base];
    });
    return result;
  };

  const [accounts,  setAccounts]  = useState(initAccounts);
  const [expanded,  setExpanded]  = useState({});   // { platform: true/false }
  const [editKey,   setEditKey]   = useState(null);  // { platform, idx }
  const [editVal,   setEditVal]   = useState("");
  const [newAccVal, setNewAccVal] = useState({});    // { platform: inputValue }
  const [saved,     setSaved]     = useState(false);
  const pendingRenames = useRef({});                 // { oldAccountName: newAccountName }

  const toggleExpand = (plat) => setExpanded(p => ({ ...p, [plat]: !p[plat] }));

  const addAccount = (plat) => {
    const v = (newAccVal[plat] || "").trim();
    if (!v) return;
    const allAccounts = Object.values(accounts).flat();
    if (allAccounts.includes(v)) return; // duplicate
    setAccounts(prev => ({ ...prev, [plat]: [...(prev[plat]||[]), v] }));
    setNewAccVal(prev => ({ ...prev, [plat]: "" }));
  };

  const deleteAccount = (plat, idx) => {
    setAccounts(prev => {
      const updated = prev[plat].filter((_,i) => i !== idx);
      // Always keep at least one account per platform (the platform name itself)
      return { ...prev, [plat]: updated.length ? updated : [plat] };
    });
  };

  const startEdit = (plat, idx) => {
    setEditKey({ plat, idx });
    setEditVal(accounts[plat][idx]);
  };

  const saveEdit = () => {
    if (!editKey) return;
    const v = editVal.trim();
    if (!v) return;
    const { plat, idx } = editKey;
    const oldName = accounts[plat][idx];
    if (oldName !== v) {
      // Chain renames correctly
      const existingOrig = Object.keys(pendingRenames.current).find(
        k => pendingRenames.current[k] === oldName
      );
      if (existingOrig) pendingRenames.current[existingOrig] = v;
      else pendingRenames.current[oldName] = v;
    }
    setAccounts(prev => ({
      ...prev,
      [plat]: prev[plat].map((a, i) => i === idx ? v : a),
    }));
    setEditKey(null); setEditVal("");
  };

  const save = () => {
    // Derive flat account list for customPlatforms
    const flatAccounts = Object.values(accounts).flat();
    // Cascade renames into listing data
    const renames = pendingRenames.current;
    if (Object.keys(renames).length > 0 && setListings) {
      setListings(prev => prev.map(l => {
        let changed = false;
        let platform      = l.platform;
        let platforms_    = l.platforms ? [...l.platforms] : [];
        let platformDates = l.platformDates ? { ...l.platformDates } : {};
        if (platform && renames[platform]) { platform = renames[platform]; changed = true; }
        platforms_ = platforms_.map(p => { if (renames[p]) { changed = true; return renames[p]; } return p; });
        const newDates = {};
        Object.entries(platformDates).forEach(([k, v]) => { newDates[renames[k]||k] = v; if (renames[k]) changed = true; });
        if (!changed) return l;
        return { ...l, platform, platforms: platforms_, platformDates: newDates };
      }));
    }
    pendingRenames.current = {};
    setLiveData(prev => ({ ...prev, platformAccounts: accounts, platforms: flatAccounts }));
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  };

  const resetToDefaults = () => {
    const def = {};
    PLAT_FAMILY_BASES.forEach(b => { def[b] = [b]; });
    setAccounts(def);
    pendingRenames.current = {};
  };

  const [settingsTab, setSettingsTab] = useState(initialTab || "preferences");
  const as = getAS(liveData);
  const setAS = (key, val) => setLiveData(p => ({ ...p, appSettings: { ...getAS(p), [key]: val } }));

  return (
    <div style={{maxWidth:560,margin:"0 auto",padding:"0 4px"}}>
      <div style={{fontWeight:900,fontSize:16,marginBottom:4}}>Settings</div>
      <div style={{fontSize:12,color:"var(--txd)",marginBottom:16}}>App-wide preferences</div>

      {/* Tab bar */}
      <div className="tab-bar" style={{marginBottom:18}}>
        {[
          {id:"preferences", label:"Preferences"},
          {id:"listings_",   label:"Listings"},
          {id:"stock_",      label:"Stock"},
          {id:"notifs",      label:"Notifications"},
          {id:"data",        label:"Data"},
          {id:"contact",     label:"Contact Us"},
        ].map(t => (
          <div key={t.id} className={`tab ${settingsTab===t.id?"active":""}`} onClick={()=>setSettingsTab(t.id)}>{t.label}</div>
        ))}
      </div>

      <div>

      {/* ── PREFERENCES TAB (Goals + Thresholds + Currency/Dates + Appearance) ── */}
      {settingsTab==="preferences" && (
      <>
      <div className="tw" style={{padding:"18px 20px",marginBottom:14}}>
        <SettingsHeader title="Weekly & Monthly Goals" sub="Set default targets — shown on the Dashboard. These persist across sessions." />
        <SettingRow label="Weekly profit target £"><SettingNumInput value={as.weeklyGoal} onChange={v=>setAS("weeklyGoal",v)} placeholder="e.g. 250" /></SettingRow>
        <SettingRow label="Weekly revenue target £"><SettingNumInput value={as.weeklyRevGoal} onChange={v=>setAS("weeklyRevGoal",v)} placeholder="e.g. 500" /></SettingRow>
        <SettingRow label="Monthly profit target £"><SettingNumInput value={as.monthlyGoal} onChange={v=>setAS("monthlyGoal",v)} placeholder="e.g. 1000" /></SettingRow>
        <SettingRow label="Monthly revenue target £"><SettingNumInput value={as.monthlyRevGoal} onChange={v=>setAS("monthlyRevGoal",v)} placeholder="e.g. 2000" /></SettingRow>
        <div style={{height:10}}/>
        <SettingsHeader title="Thresholds" sub="Used throughout the app to flag underperformance." />
        <SettingRow label="Sell-through warning %"><SettingNumInput value={as.sellThruWarning} onChange={v=>setAS("sellThruWarning",+v)} min={1} max={100} placeholder="60" /></SettingRow>
        <SettingRow label="Slow mover threshold (days unsold)"><SettingNumInput value={as.slowMoverDays} onChange={v=>setAS("slowMoverDays",+v)} min={1} max={365} placeholder="14" /></SettingRow>
      </div>
      <div className="tw" style={{padding:"18px 20px",marginBottom:14}}>
        <SettingsHeader title="Currency & Dates" />
        <SettingRow label="Currency symbol">
          <select value={as.currency||"£"} onChange={e=>setAS("currency",e.target.value)}
            style={{background:"var(--sf2)",border:"1px solid var(--bdd)",borderRadius:"var(--r)",padding:"5px 9px",fontFamily:"Arial,sans-serif",fontSize:12,outline:"none"}}>
            {["£","$","€","¥","₹","A$","C$"].map(c=><option key={c} value={c}>{c}</option>)}
          </select>
        </SettingRow>
        <SettingRow label="Date format">
          <select value={as.dateFormat||"DD/MM"} onChange={e=>setAS("dateFormat",e.target.value)}
            style={{background:"var(--sf2)",border:"1px solid var(--bdd)",borderRadius:"var(--r)",padding:"5px 9px",fontFamily:"Arial,sans-serif",fontSize:12,outline:"none"}}>
            <option value="DD/MM">DD/MM/YY</option>
            <option value="MM/DD">MM/DD/YY</option>
          </select>
        </SettingRow>
        <div style={{height:10}}/>
        <SettingsHeader title="Appearance" />
        <SettingRow label="Compact mode — smaller table rows"><SettingToggle value={!!as.compactMode} onChange={v=>setAS("compactMode",v)} /></SettingRow>
        <SettingRow label="Sidebar collapsed by default (mobile)"><SettingToggle value={!!as.sidebarCollapsed} onChange={v=>setAS("sidebarCollapsed",v)} /></SettingRow>
      </div>
      </>
      )}

      {/* ── LISTINGS TAB (Platforms & Accounts + Drafter + Cross-List + Dropdowns) ── */}
      {settingsTab==="listings_" && (
      <>
      <div className="tw" style={{padding:"18px 20px",marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <div style={{fontWeight:900,fontSize:12,textTransform:"uppercase",letterSpacing:".5px",color:"var(--txm)"}}>Sales Platforms & Accounts</div>
          <button onClick={resetToDefaults}
            style={{fontSize:10,color:"var(--txd)",background:"none",border:"none",cursor:"pointer",textDecoration:"underline"}}>
            Reset to defaults
          </button>
        </div>
        <div style={{fontSize:11,color:"var(--txd)",marginBottom:16,lineHeight:1.6}}>
          Platforms are fixed. Add named accounts under each platform to track multiple accounts separately — e.g. Vinted Main + Vinted 2. All data groups by platform globally.
        </div>

        {PLAT_FAMILY_BASES.map(plat => {
          const col   = getPlatColour(plat);
          const accs  = accounts[plat] || [plat];
          const isOpen = !!expanded[plat];
          return (
            <div key={plat} style={{marginBottom:8,border:"1px solid var(--bd)",borderRadius:"var(--r2)",overflow:"hidden"}}>
              <div onClick={() => toggleExpand(plat)} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:"var(--sf2)",cursor:"pointer",userSelect:"none",borderBottom:isOpen?"1px solid var(--bd)":"none"}}>
                <span style={{width:10,height:10,borderRadius:"50%",background:col,flexShrink:0,display:"inline-block"}}/>
                <span style={{flex:1,fontWeight:700,fontSize:13}}>{plat}</span>
                <span style={{fontSize:11,color:"var(--txd)"}}>{accs.length} account{accs.length!==1?"s":""}</span>
                <span style={{fontSize:11,color:"var(--txd)",marginLeft:4}}>{isOpen?"▲":"▼"}</span>
              </div>
              {isOpen && (
                <div style={{padding:"10px 14px",background:"var(--sf)"}}>
                  {accs.map((acc, idx) => {
                    const isEditing = editKey?.plat === plat && editKey?.idx === idx;
                    return (
                      <div key={idx} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:"1px solid var(--bd)"}}>
                        {isEditing ? (
                          <>
                            <input value={editVal} onChange={e=>setEditVal(e.target.value)}
                              onKeyDown={e=>{if(e.key==="Enter")saveEdit();if(e.key==="Escape"){setEditKey(null);setEditVal("");}}}
                              autoFocus style={{flex:1,background:"var(--sf2)",border:"1px solid var(--ac)",borderRadius:"var(--r)",padding:"4px 8px",fontFamily:"Arial,sans-serif",fontSize:12,outline:"none"}}/>
                            <button onClick={saveEdit} style={{background:"var(--gn)",color:"#fff",border:"none",borderRadius:"var(--r)",padding:"4px 10px",cursor:"pointer",fontSize:11,fontWeight:700}}>Save</button>
                            <button onClick={()=>{setEditKey(null);setEditVal("");}} style={{background:"var(--sf2)",color:"var(--txm)",border:"1px solid var(--bdd)",borderRadius:"var(--r)",padding:"4px 8px",cursor:"pointer",fontSize:11}}>✕</button>
                          </>
                        ) : (
                          <>
                            <span style={{flex:1,fontSize:12,fontWeight:500,padding:"2px 8px",borderRadius:20,background:col+"15",color:col,border:`1px solid ${col}44`,display:"inline-block"}}>{acc}</span>
                            <button onClick={()=>startEdit(plat,idx)} style={{background:"var(--sf2)",border:"1px solid var(--bdd)",borderRadius:"var(--r)",padding:"3px 10px",cursor:"pointer",fontSize:11,color:"var(--txm)",flexShrink:0}}>Rename</button>
                            {accs.length>1 && <button onClick={()=>deleteAccount(plat,idx)} style={{background:"var(--acl)",border:"1px solid var(--ac2)",borderRadius:"var(--r)",padding:"3px 8px",cursor:"pointer",fontSize:11,color:"var(--ac)",fontWeight:700,flexShrink:0}}>✕</button>}
                          </>
                        )}
                      </div>
                    );
                  })}
                  <div style={{display:"flex",gap:7,marginTop:10}}>
                    <input value={newAccVal[plat]||""} onChange={e=>setNewAccVal(prev=>({...prev,[plat]:e.target.value}))}
                      onKeyDown={e=>e.key==="Enter"&&addAccount(plat)}
                      placeholder={`Add ${plat} account name…`}
                      style={{flex:1,background:"var(--sf2)",border:"1px solid var(--bdd)",borderRadius:"var(--r)",padding:"5px 9px",fontFamily:"Arial,sans-serif",fontSize:12,outline:"none"}}/>
                    <button onClick={()=>addAccount(plat)} style={{background:col,color:"#fff",border:"none",borderRadius:"var(--r)",padding:"5px 12px",cursor:"pointer",fontSize:11,fontWeight:700,flexShrink:0}}>+ Add</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <div style={{marginTop:16,display:"flex",justifyContent:"flex-end",gap:10,alignItems:"center"}}>
          {saved && <span style={{fontSize:11,color:"var(--gn)",fontWeight:700}}>✓ Saved — changes applied globally</span>}
          <button onClick={save} style={{background:"var(--gn)",color:"#fff",border:"none",borderRadius:"var(--r)",padding:"8px 20px",cursor:"pointer",fontSize:12,fontWeight:700}}>Save Platforms</button>
        </div>
        <div style={{fontSize:10,color:"var(--txd)",lineHeight:1.6,marginTop:10}}>
          Renaming an account updates all matching listing data on Save. Data always groups by platform globally.
        </div>
      </div>

      <div className="tw" style={{padding:"18px 20px",marginBottom:14}}>
        <SettingsHeader title="Listing Drafter" sub="Pre-fills the condition field when you open the Drafter." />
        <SettingRow label="Default condition">
          <select value={as.defaultCondition||"Excellent"} onChange={e=>setAS("defaultCondition",e.target.value)}
            style={{background:"var(--sf2)",border:"1px solid var(--bdd)",borderRadius:"var(--r)",padding:"5px 9px",fontFamily:"Arial,sans-serif",fontSize:12,outline:"none"}}>
            {["Excellent","Very Good","Good","Fair"].map(c=><option key={c}>{c}</option>)}
          </select>
        </SettingRow>
        <div style={{height:10}}/>
        <SettingsHeader title="Mark as Listed" sub="These accounts will be pre-ticked when you open Mark as Listed." />
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:7,marginTop:4}}>
          {(customPlatforms||DEFAULT_PLATFORMS).map(p => {
            const sel = (as.defaultAccounts||[]).includes(p);
            const col = getPlatColour(p);
            return (
              <button key={p} onClick={()=>{ const cur=as.defaultAccounts||[]; setAS("defaultAccounts",sel?cur.filter(x=>x!==p):[...cur,p]); }}
                style={{padding:"7px 4px",fontSize:11,fontWeight:700,textAlign:"center",border:`1.5px solid ${sel?col:"var(--bd)"}`,borderRadius:"var(--r)",cursor:"pointer",background:sel?col+"18":"var(--sf2)",color:sel?col:"var(--txm)",transition:"all .12s"}}>
                {p}{sel?" ✓":""}
              </button>
            );
          })}
        </div>
        <div style={{height:10}}/>
        <SettingsHeader title="Cross-List Tracker — Platforms" sub="Choose which platforms appear in the Cross-List tab in Listing Data. Toggle off any platforms you don't actively sell on." />
        <div style={{display:"flex",flexDirection:"column",gap:0}}>
          {PLAT_FAMILY_BASES.map((p, i) => {
            const col   = getPlatColour(p);
            const saved = as.crossListPlats || PLAT_FAMILY_BASES;
            const isOn  = saved.includes(p);
            const isLast= i === PLAT_FAMILY_BASES.length - 1;
            return (
              <div key={p} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"11px 0",borderBottom:isLast?"none":"1px solid var(--bd)",gap:12}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:10,height:10,borderRadius:"50%",background:col,flexShrink:0}}/>
                  <span style={{fontSize:13,color:"var(--tx)",fontWeight:500}}>{p}</span>
                </div>
                <div onClick={()=>{
                    const cur = as.crossListPlats || PLAT_FAMILY_BASES;
                    const next = isOn ? cur.filter(x=>x!==p) : [...cur, p];
                    if (next.length > 0) setAS("crossListPlats", next);
                  }}
                  style={{width:38,height:22,borderRadius:11,background:isOn?"var(--gn)":"var(--bdd)",position:"relative",cursor:"pointer",transition:"background .2s",flexShrink:0}}>
                  <div style={{width:16,height:16,borderRadius:"50%",background:"#fff",position:"absolute",top:3,left:isOn?19:3,transition:"left .2s",boxShadow:"0 1px 3px rgba(0,0,0,.2)"}}/>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{marginTop:10,padding:"9px 12px",background:"var(--nvl)",borderRadius:"var(--r)",fontSize:11,color:"var(--nv)"}}>
          {(as.crossListPlats||PLAT_FAMILY_BASES).length} platform{(as.crossListPlats||PLAT_FAMILY_BASES).length!==1?"s":""} visible in Cross-List tab
        </div>
        <div style={{height:14}}/>
        <div style={{height:6}}/>
        <SettingsHeader title="Mark as Listed — Hidden Platforms" sub="These platforms will not appear in the Mark as Listed flow." />
        <div style={{display:"flex",flexWrap:"wrap",gap:7,marginBottom:4}}>
          {(customPlatforms||DEFAULT_PLATFORMS).map(p => {
            const hidden = (as.hiddenListedPlats||[]).includes(p);
            return (
              <button key={p} onClick={()=>{
                const cur = as.hiddenListedPlats||[];
                setAS("hiddenListedPlats", hidden ? cur.filter(x=>x!==p) : [...cur,p]);
              }} style={{
                padding:"5px 12px",fontSize:11,fontWeight:700,borderRadius:20,cursor:"pointer",
                border:`1.5px solid ${hidden?"var(--ac)":"var(--bd)"}`,
                background:hidden?"var(--acl)":"var(--sf2)",
                color:hidden?"var(--ac)":"var(--txm)",transition:"all .12s",
              }}>{hidden?"🚫 ":""}{p}</button>
            );
          })}
        </div>
        <div style={{fontSize:10,color:"var(--txd)",marginBottom:14,lineHeight:1.6}}>
          Highlighted = hidden from Mark as Listed. Tap to toggle.
        </div>
        <SettingsHeader title="Mark as Sold — Hidden Platforms" sub="These platforms will not appear in the Mark as Sold flow." />
        <div style={{display:"flex",flexWrap:"wrap",gap:7,marginBottom:4}}>
          {(customPlatforms||DEFAULT_PLATFORMS).map(p => {
            const hidden = (as.hiddenSoldPlats||[]).includes(p);
            return (
              <button key={p} onClick={()=>{
                const cur = as.hiddenSoldPlats||[];
                setAS("hiddenSoldPlats", hidden ? cur.filter(x=>x!==p) : [...cur,p]);
              }} style={{
                padding:"5px 12px",fontSize:11,fontWeight:700,borderRadius:20,cursor:"pointer",
                border:`1.5px solid ${hidden?"var(--ac)":"var(--bd)"}`,
                background:hidden?"var(--acl)":"var(--sf2)",
                color:hidden?"var(--ac)":"var(--txm)",transition:"all .12s",
              }}>{hidden?"🚫 ":""}{p}</button>
            );
          })}
        </div>
        <div style={{fontSize:10,color:"var(--txd)",marginBottom:14,lineHeight:1.6}}>
          Highlighted = hidden from Mark as Sold. Tap to toggle.
        </div>
        <SettingsHeader title="Custom Dropdown Options" sub="Manage types, colours, and sizes you've added via the dropdowns. Built-in defaults cannot be removed." />
        {[
          { field:"customTypes",   label:"Types",   colour:"#1a5276" },
          { field:"customColours", label:"Colours", colour:"#1a6b3a" },
          { field:"customSizes",   label:"Sizes",   colour:"#6b3a1a" },
        ].map(({ field, label, colour }) => {
          const items = as[field] || [];
          return (
            <div key={field} style={{marginBottom:14,border:"1px solid var(--bd)",borderRadius:"var(--r2)",overflow:"hidden"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"9px 14px",background:"var(--sf2)",borderBottom:items.length?"1px solid var(--bd)":"none"}}>
                <span style={{fontWeight:700,fontSize:12,color:"var(--tx)"}}>{label}</span>
                <span style={{fontSize:11,color:"var(--txd)"}}>{items.length} custom</span>
              </div>
              {items.length === 0 ? (
                <div style={{padding:"12px 14px",fontSize:11,color:"var(--txd)"}}>No custom {label.toLowerCase()} added yet.</div>
              ) : (
                <div style={{padding:"8px 14px",display:"flex",flexWrap:"wrap",gap:7}}>
                  {items.map((item, idx) => (
                    <div key={idx} style={{display:"inline-flex",alignItems:"center",gap:5,background:colour+"12",border:`1px solid ${colour}44`,borderRadius:20,padding:"3px 10px",fontSize:11}}>
                      <span style={{fontWeight:600,color:colour}}>{item}</span>
                      <button
                        onClick={() => {
                          const next = items.filter((_,i) => i !== idx);
                          setAS(field, next);
                        }}
                        title={`Remove ${item}`}
                        style={{background:"none",border:"none",cursor:"pointer",color:colour,fontSize:13,lineHeight:1,padding:"0 0 0 2px",fontWeight:700,opacity:.7,transition:"opacity .12s"}}
                        onMouseEnter={e=>e.target.style.opacity=1}
                        onMouseLeave={e=>e.target.style.opacity=.7}
                      >×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <div style={{fontSize:10,color:"var(--txd)",lineHeight:1.6}}>
          Custom options are removed from the dropdowns immediately. Any listings already using a removed value keep it.
        </div>
      </div>
      </>
      )}

      {/* ── STOCK TAB ── */}
      {settingsTab==="stock_" && (
      <div className="tw" style={{padding:"18px 20px",marginBottom:14}}>
        <SettingsHeader title="Stock Purchasing" sub="Guides your buying decisions on the Live Data tab." />
        <SettingRow label="Cash buffer guideline %"><SettingNumInput value={as.cashBuffer} onChange={v=>setAS("cashBuffer",+v)} min={1} max={100} placeholder="85" /></SettingRow>
        <div style={{fontSize:11,color:"var(--txd)",marginTop:8,lineHeight:1.6}}>
          Example: at 85%, if your liquid cash is £500 the highlighted tile shows £425 as your safe spending limit.
        </div>
      </div>
      )}

      {/* ── NOTIFICATIONS TAB ── */}
      {settingsTab==="notifs" && (
      <div className="tw" style={{padding:"18px 20px",marginBottom:14}}>
        <SettingsHeader title="Push Notifications" sub="Choose which events trigger a push notification." />
        {[
          {key:"notifSold",         label:"Item sold",                  def:true },
          {key:"notifListed",       label:"Item marked as listed",      def:true},
          {key:"notifReturn",       label:"Return raised",              def:true },
          {key:"notifShipped",      label:"Item shipped",               def:false},
          {key:"notifSundayBackup", label:"Sunday backup reminder",     def:true },
          {key:"notifNotes",        label:"Global notes updated",       def:true},
        ].map(({key,label,def}) => (
          <SettingRow key={key} label={label}>
            <SettingToggle value={as[key]!==undefined?!!as[key]:def} onChange={v=>setAS(key,v)} />
          </SettingRow>
        ))}
        <div style={{fontSize:11,color:"var(--txd)",marginTop:12,lineHeight:1.6}}>
          Push notifications require browser permission. Tap the 🔔 icon in the top bar to enable.
        </div>
      </div>
      )}

      {/* ── DATA TAB (Export + Version History) ── */}
      {settingsTab==="data" && (
      <>
      {exportJSON && (
        <div className="tw" style={{padding:"18px 20px",marginBottom:14}}>
          <SettingsHeader title="Export" sub="Download everything as a single XLSX workbook (Listings + Stock)." />
          <button onClick={exportJSON}
            style={{background:"var(--gn)",color:"#fff",border:"none",borderRadius:"var(--r)",padding:"8px 20px",cursor:"pointer",fontSize:12,fontWeight:700}}>
            ↓ Export as XLSX
          </button>
        </div>
      )}
      <VersionHistory onRestore={onRestoreVersion} />
      </>
      )}

      {/* ── CONTACT US TAB ── */}
      {settingsTab==="contact" && <SettingsContact />}

      </div>

    </div>
  );
}

export default function App() {
  const [view,            setView]            = useState("dashboard");
  const [sidebarOpen,     setSidebarOpen]     = useState(() => {
    try {
      const saved = localStorage.getItem("ad_livedata");
      if (saved) { const p = JSON.parse(saved); return !p?.appSettings?.sidebarCollapsed; }
    } catch {}
    return true;
  });
  const [listings,        setListingsRaw]     = useState(LISTINGS_INIT);
  const [stockData,       setStockDataRaw]    = useState(STOCK_INIT);
  const [weeklyGoal,      setWeeklyGoal]      = useState("");
  const [monthlyGoal,     setMonthlyGoal]     = useState("");
  const [weeklyRevGoal,   setWeeklyRevGoal]   = useState("");
  const [monthlyRevGoal,  setMonthlyRevGoal]  = useState("");
  const [liveData, setLiveDataRaw] = useState(() => {
    // Load from localStorage as fallback (survives Supabase failures)
    try {
      const saved = localStorage.getItem("ad_livedata");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed === "object" && parsed !== null) {
          // Ensure globalNotes always exists
          return { globalNotes:"", ...parsed };
        }
      }
    } catch (_) {}
    return { vinted:"", withdrawn:"", ebayBal:"", ebayPend:"", depopPend:"", vintedPend:"", whatnotPend:"", globalNotes:"" };
  });

  // Derive flat account list from two-tier platformAccounts structure
  // Falls back to old flat platforms array, then DEFAULT_PLATFORMS
  const customPlatforms = useMemo(() => {
    const pa = liveData?.platformAccounts;
    if (pa && typeof pa === "object" && !Array.isArray(pa)) {
      // New two-tier structure — flatten all accounts in platform order
      return Object.values(pa).flat().filter(Boolean);
    }
    // Legacy: old flat array
    if (Array.isArray(liveData?.platforms) && liveData.platforms.length) {
      return liveData.platforms;
    }
    return DEFAULT_PLATFORMS;
  }, [liveData?.platformAccounts, liveData?.platforms]);

  // Keep module-level aliases in sync so all components see the current list
  useEffect(() => {
    PLATFORMS         = customPlatforms;
    MARK_LISTED_PLATS = customPlatforms;
  }, [customPlatforms]);

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
    setListingsRaw(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      const ts = new Date().toISOString();
      const prevMap = new Map(prev.map(l => [l.sku, l]));
      // Stamp updatedAt on any listing that was added or changed
      return next.map(l => {
        const p = prevMap.get(l.sku);
        return (!p || p !== l) ? { ...l, updatedAt: ts } : l;
      });
    });
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

  /* Keep the focused field visible above the mobile on-screen keyboard —
     applies everywhere (search boxes, forms) via one listener rather than
     scrolling logic in every individual input. */
  useEffect(() => {
    const handleFocusIn = (e) => {
      const tag = e.target?.tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") return;
      setTimeout(() => {
        e.target.scrollIntoView({ block: "center", behavior: "smooth" });
      }, 300); // wait for the keyboard's open animation to finish
    };
    document.addEventListener("focusin", handleFocusIn);
    return () => document.removeEventListener("focusin", handleFocusIn);
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
            setWeeklyGoal(data.goals.weekly      || "");
            setMonthlyGoal(data.goals.monthly    || "");
            setWeeklyRevGoal(data.goals.weeklyRev   || "");
            setMonthlyRevGoal(data.goals.monthlyRev || "");
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

  /* ── Per-item merge — keeps newest version of each listing ── */
  const mergeListings = (local, remote) => {
    const localMap  = new Map(local.map(l => [l.sku, l]));
    const remoteMap = new Map(remote.map(l => [l.sku, l]));
    const allSkus   = new Set([...localMap.keys(), ...remoteMap.keys()]);
    return [...allSkus].map(sku => {
      const loc = localMap.get(sku);
      const rem = remoteMap.get(sku);
      if (!loc) return rem;   // new listing from remote device
      if (!rem) return loc;   // new listing from local device
      // Both have it — keep whichever was updated more recently
      if (!loc.updatedAt) return rem;
      if (!rem.updatedAt) return loc;
      return loc.updatedAt >= rem.updatedAt ? loc : rem;
    });
  };

  /* ── Supabase Realtime — push changes from other devices instantly ── */
  const channelRef = useRef(null);

  const applyRemotePayload = useCallback((data) => {
    if (!data) return;
    if (isRemoteUpdate.current) return;
    const remoteTs = data.updated_at;
    const localTs  = lastSaveTs.current;
    if (localTs && remoteTs && remoteTs <= localTs) return;
    isRemoteUpdate.current = true;
    setTimeout(() => { isRemoteUpdate.current = false; }, 2000);
    if (data.listings?.length > 0) {
      const merged = mergeListings(listingsRef.current, data.listings);
      setListingsRaw(merged);
    }
    if (data.stock_data?.length > 0 &&
        data.stock_data.length >= stockDataRef.current.length)
      setStockDataRaw(data.stock_data);
    if (data.goals) {
      setWeeklyGoal(data.goals.weekly   || "");
      setMonthlyGoal(data.goals.monthly || "");
      if (data.goals.liveData?.profitLog)
        setLiveData(prev => ({ ...prev, profitLog: data.goals.liveData.profitLog }));
    }
    setStorageStatus("saved");
  }, []);

  const subscribeRealtime = useCallback(() => {
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    channelRef.current = supabase
      .channel("app_state_realtime")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "app_state", filter: "id=eq.1" },
        (payload) => applyRemotePayload(payload.new)
      )
      .subscribe();
  }, [applyRemotePayload]);

  useEffect(() => {
    subscribeRealtime();
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current); };
  }, [subscribeRealtime]);

  /* ── Visibility handler — re-fetch + reconnect when app comes to foreground ── */
  useEffect(() => {
    const onVisible = async () => {
      if (document.visibilityState !== "visible") return;
      // Always re-fetch when returning to the app (home screen → app, tab switch etc.)
      // Bypass both guards so stale state never blocks the refresh
      try {
        const { data } = await supabase
          .from("app_state").select("*").eq("id", 1).single();
        if (data) {
          // Clear both guards temporarily so applyRemotePayload always applies
          const savedTs     = lastSaveTs.current;
          const savedRemote = isRemoteUpdate.current;
          lastSaveTs.current      = null;
          isRemoteUpdate.current  = false;
          applyRemotePayload(data);
          // Restore — don't clobber a save that may have just completed
          lastSaveTs.current     = savedTs;
          isRemoteUpdate.current = savedRemote;
        }
      } catch (_) {}
      // Reconnect real-time if channel dropped
      const state = channelRef.current?.state;
      if (state === "closed" || state === "errored" || !state) {
        subscribeRealtime();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [applyRemotePayload, subscribeRealtime]);

  /* ── Debounced save — fires 800ms after last change ── */
  const saveTimer      = useRef(null);
  const isRemoteUpdate = useRef(false);
  const lastSaveTs     = useRef(null);
  const versionTimer   = useRef(null);

  const debouncedSave = useCallback((listings, stockData, goals) => {
    if (!hasLoaded.current) return;
    if (isRemoteUpdate.current) return; // don't echo remote updates back to Supabase
    setStorageStatus("loading");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      isRemoteUpdate.current = true;
      const ts = new Date().toISOString();
      lastSaveTs.current = ts;
      setTimeout(() => { isRemoteUpdate.current = false; }, 2000);
      const ok = await saveState(listings, stockData, goals);
      setStorageStatus(ok ? "saved" : "error");
    }, 800);
  }, []);

  /* Trigger save whenever data changes */
  useEffect(() => {
    debouncedSave(listings, stockData, { weekly: weeklyGoal, monthly: monthlyGoal, weeklyRev: weeklyRevGoal, monthlyRev: monthlyRevGoal, liveData });
  }, [listings, stockData, weeklyGoal, monthlyGoal, weeklyRevGoal, monthlyRevGoal, liveData, debouncedSave]);

  /* ── Hard Save — immediate force-save to Supabase + a manual snapshot ── */
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
          notifKey: "notifSundayBackup",
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
    const ok = await saveState(listings, stockData, { weekly: weeklyGoal, monthly: monthlyGoal, weeklyRev: weeklyRevGoal, monthlyRev: monthlyRevGoal, liveData });
    if (ok) saveManualSnapshot(listings, stockData, { weekly: weeklyGoal, monthly: monthlyGoal, weeklyRev: weeklyRevGoal, monthlyRev: monthlyRevGoal, liveData });
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
            setWeeklyGoal(data.goals.weekly      || "");
            setMonthlyGoal(data.goals.monthly    || "");
            setWeeklyRevGoal(data.goals.weeklyRev   || "");
            setMonthlyRevGoal(data.goals.monthlyRev || "");
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
    () => listings.filter(l => l.sold && !l.shipped && !l.pendingReturn).length,
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
    // Pure-JS XLSX export — no library or CDN needed
    const esc=(s)=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    const enc=(s)=>new TextEncoder().encode(s);
    const crc32=(data)=>{const t=new Uint32Array(256);for(let i=0;i<256;i++){let k=i;for(let j=0;j<8;j++)k=k&1?(0xEDB88320^(k>>>1)):k>>>1;t[i]=k;}let c=0xFFFFFFFF;for(let i=0;i<data.length;i++)c=t[(c^data[i])&0xFF]^(c>>>8);return(c^0xFFFFFFFF)>>>0;};
    const u32le=(n)=>{const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,n,true);return b;};
    const u16le=(n)=>{const b=new Uint8Array(2);new DataView(b.buffer).setUint16(0,n,true);return b;};
    const cat=(...arrays)=>{const total=arrays.reduce((a,b)=>a+b.length,0);const out=new Uint8Array(total);let off=0;arrays.forEach(a=>{out.set(a,off);off+=a.length;});return out;};
    const allStrings=[];const allMap={};
    const si=(val)=>{const k=String(val??"");if(allMap[k]===undefined){allMap[k]=allStrings.length;allStrings.push(k);}return allMap[k];};
    const toCol=(i)=>{let s="",n=i+1;while(n>0){s=String.fromCharCode(65+(n-1)%26)+s;n=Math.floor((n-1)/26);}return s;};
    const buildSheet=(rows)=>{
      if(!rows.length)return enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>`);
      const cols=Object.keys(rows[0]);
      let xml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>`;
      xml+=`<row r="1">`;cols.forEach((c,ci)=>{xml+=`<c r="${toCol(ci)}1" t="s"><v>${si(c)}</v></c>`;});xml+=`</row>`;
      rows.forEach((row,ri)=>{
        xml+=`<row r="${ri+2}">`;
        cols.forEach((c,ci)=>{const val=row[c];const ref=`${toCol(ci)}${ri+2}`;
          if(val===""||val===null||val===undefined){xml+=`<c r="${ref}"/>`;}
          else if(typeof val==="number"){xml+=`<c r="${ref}"><v>${val}</v></c>`;}
          else{xml+=`<c r="${ref}" t="s"><v>${si(String(val))}</v></c>`;}
        });xml+=`</row>`;
      });
      xml+=`</sheetData></worksheet>`;return enc(xml);
    };
    const makeEntry=(name,content)=>{const nb=enc(name);const crc=crc32(content);
      const local=cat(new Uint8Array([0x50,0x4B,0x03,0x04,0x14,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00]),u32le(crc),u32le(content.length),u32le(content.length),u16le(nb.length),u16le(0),nb,content);
      return{nb,local,crc,size:content.length};};
    // Listing rows
    const listingRows=listings.map(l=>({
      "SKU":l.sku||"","Bundle SKU":l.bundleSku||"","Stock Name":l.name||"","Brand":l.brand||"",
      "Type":l.type||"","Colour":l.colour||"","Size":l.size||"","Description":l.desc||"",
      "Length":l.length||"","Pit to Pit":l.pitToPit||"",
      "Price":l.price!=null?+Number(l.price).toFixed(2):"",
      "Listed?":l.listed?"Yes":"No","Day Listed":l.dayListed||"",
      "Platforms":Array.isArray(l.platforms)?l.platforms.join(", "):(l.platform||""),
      "Platform Sold":l.platform||"","Sold?":l.sold?"Yes":"No",
      "Sold Price":l.soldPrice!=null?+Number(l.soldPrice).toFixed(2):"",
      "Net Profit":l.profit!=null?+Number(l.profit).toFixed(2):"",
      "Day Sold":l.daySold||"","Days to Sell":l.days!=null?l.days:"",
      "Shipped?":l.shipped?"Yes":"No","Shipped Date":l.shippedDate||"",
      "Pending Return?":l.pendingReturn?"Yes":"No","Return Reason":l.returnReason||"","Notes":l.notes||"",
    }));
    // Stock rows with derived fields
    const stockRows=deriveStock(stockData,listings).map(s=>({
      "Bundle SKU":s.bundleSku||"","Stock Name":s.name||"","Website":s.website||"","Seller":s.seller||"",
      "Date Ordered":s.datePurchased||"","Date Received":s.dateArrived||"","Contents":s.contentDetails||"",
      "Received Qty":s.received||0,"Sellable":s.sellable||0,
      "Cost/pc":s.costPer!=null?+Number(s.costPer).toFixed(4):0,
      "Total Cost":+Number(s.totalCost||0).toFixed(2),
      "Qty Sold":s.qtySold||0,"Qty Listed":s.qtyListed||0,
      "Qty Remaining":s.qtyRemaining||0,"To List":s.qtyToBeListed||0,
      "Net Proceeds":+Number(s.netProceeds||0).toFixed(2),
      "Bundle Profit":+Number(s.totalProfit||0).toFixed(2),
      "Stock Val Left":+Number(s.stockValLeft||0).toFixed(2),
      "Sell-through %":s.sellThru||0,
      "Avg Sold Price":s.avgSoldPrice?+Number(s.avgSoldPrice).toFixed(2):"",
      "Avg Profit":s.avgProfit?+Number(s.avgProfit).toFixed(2):"",
      "Restock?":s.restock?"Yes":"No","Imported":s.imported?"Yes":"No",
    }));
    const s1=buildSheet(listingRows);
    const s2=buildSheet(stockRows);
    const ssXml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${allStrings.length}" uniqueCount="${allStrings.length}">${allStrings.map(s=>`<si><t xml:space="preserve">${esc(s)}</t></si>`).join("")}</sst>`;
    const wbXml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Listings" sheetId="1" r:id="rId1"/><sheet name="Stock" sheetId="2" r:id="rId2"/></sheets></workbook>`;
    const wbRels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
    const ctXml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`;
    const rootRels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
    const files=[
      makeEntry("[Content_Types].xml",enc(ctXml)),
      makeEntry("_rels/.rels",enc(rootRels)),
      makeEntry("xl/workbook.xml",enc(wbXml)),
      makeEntry("xl/_rels/workbook.xml.rels",enc(wbRels)),
      makeEntry("xl/worksheets/sheet1.xml",s1),
      makeEntry("xl/worksheets/sheet2.xml",s2),
      makeEntry("xl/sharedStrings.xml",enc(ssXml)),
    ];
    let cdOff=0;const locals=files.map(f=>{cdOff+=f.local.length;return f.local;});
    const centralDir=files.map((f,i)=>{const off=files.slice(0,i).reduce((a,x)=>a+x.local.length,0);
      return cat(new Uint8Array([0x50,0x4B,0x01,0x02,0x14,0x00,0x14,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00]),u32le(f.crc),u32le(f.size),u32le(f.size),u16le(f.nb.length),u16le(0),u16le(0),u16le(0),u16le(0),u32le(0),u32le(off),f.nb);});
    const cdSize=centralDir.reduce((a,b)=>a+b.length,0);
    const eocd=cat(new Uint8Array([0x50,0x4B,0x05,0x06,0x00,0x00,0x00,0x00]),u16le(files.length),u16le(files.length),u32le(cdSize),u32le(cdOff),u16le(0));
    const zip=cat(...locals,...centralDir,eocd);
    const blob=new Blob([zip],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download=`ArchiveDistrict_${TODAY}.xlsx`;
    a.click();URL.revokeObjectURL(a.href);
  };
  const importJSON = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const d = JSON.parse(ev.target.result);
        if (d.listings) setListingsRaw(d.listings);
        if (d.stock)    setStockDataRaw(d.stock);
        if (d.goals?.weekly)     setWeeklyGoal(d.goals.weekly);
        if (d.goals?.monthly)    setMonthlyGoal(d.goals.monthly);
        if (d.goals?.weeklyRev)  setWeeklyRevGoal(d.goals.weeklyRev);
        if (d.goals?.monthlyRev) setMonthlyRevGoal(d.goals.monthlyRev);
        if (d.liveData)       setLiveData(d.liveData);
        setStorageStatus("loading");
        const ok = await saveState(
          d.listings || listings,
          d.stock    || stockData,
          { weekly: d.goals?.weekly || weeklyGoal, monthly: d.goals?.monthly || monthlyGoal, weeklyRev: d.goals?.weeklyRev || weeklyRevGoal, monthlyRev: d.goals?.monthlyRev || monthlyRevGoal }
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
      <div className={`app${getAS(liveData).compactMode?" compact":""}`}>

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
                <button className="sunday-btn" onClick={exportJSON}>Export XLSX</button>
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
                style={{whiteSpace:"nowrap"}}>↓ Backup XLSX</button>
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
            {view==="dashboard"   && <Dashboard listings={listings} stockData={stockData} weeklyGoal={weeklyGoal} setWeeklyGoal={setWeeklyGoal} monthlyGoal={monthlyGoal} setMonthlyGoal={setMonthlyGoal} weeklyRevGoal={weeklyRevGoal} setWeeklyRevGoal={setWeeklyRevGoal} monthlyRevGoal={monthlyRevGoal} setMonthlyRevGoal={setMonthlyRevGoal} liveData={liveData} />}
            {view==="stock"       && <StockTab stockData={stockData} setStockData={setStockData} listings={listings} setListings={setListings} />}
            {view==="listings"    && <ListingsTab listings={listings} setListings={setListings} stockData={stockData} customPlatforms={customPlatforms} liveData={liveData} setLiveData={setLiveData} />}
            {view==="movement"    && <MovementTracker listings={listings} />}
            {view==="listingdata" && <ListingDataTab listings={listings} liveData={liveData} />}
            {view==="marklisted"  && <MarkAsListed listings={listings} setListings={setListings} customPlatforms={customPlatforms} liveData={liveData} />}
            {view==="drafter"     && <ListingDrafter listings={listings} setListings={setListings} liveData={liveData} />}
            {view==="marksold"    && <QuickMarkSold listings={listings} setListings={setListings} customPlatforms={customPlatforms} liveData={liveData} />}
            {view==="shipping"    && <ShippingTab listings={listings} setListings={setListings} />}
            {view==="livedata"    && <LiveData listings={listings} stockData={stockData} liveData={liveData} setLiveData={setLiveData} customPlatforms={customPlatforms} />}
            {view==="calculator"  && <PriceCalculator listings={listings} />}
            {view==="analytics"   && <Analytics listings={listings} stockData={stockData} customPlatforms={customPlatforms} liveData={liveData} />}
            {view==="growth"      && <Growth listings={listings} stockData={stockData} />}
            {view==="history"     && <History listings={listings} stockData={stockData} liveData={liveData} />}
            {view==="settings"    && <Settings liveData={liveData} setLiveData={setLiveData} customPlatforms={customPlatforms} setListings={setListings} exportJSON={exportJSON} onRestoreVersion={(v)=>{ setListingsRaw(v.listings); setStockDataRaw(v.stockData); setView("dashboard"); }} />}
          </div>
        </div>
      </div>
    </>
  );
}
