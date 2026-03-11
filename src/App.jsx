import { useState, useEffect, useCallback, useRef } from "react";

// ─── Helpers ────────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 10);
const today = () => new Date().toISOString().split("T")[0];
const fmt = (n, currency = "TWD") =>
  new Intl.NumberFormat("zh-TW", { style: "currency", currency, maximumFractionDigits: currency === "TWD" ? 0 : 2 }).format(n);
const fmtPlain = (n) => new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 }).format(n);

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

// ─── Default Data ────────────────────────────────────────────────────────────
const DEFAULT_CATS = [
  { id: "food", label: "餐飲", icon: "🍜", color: "#FF6B6B" },
  { id: "transport", label: "交通", icon: "🚇", color: "#4ECDC4" },
  { id: "shopping", label: "購物", icon: "🛍️", color: "#FFE66D" },
  { id: "entertainment", label: "娛樂", icon: "🎮", color: "#A8E6CF" },
  { id: "health", label: "醫療", icon: "💊", color: "#FF8B94" },
  { id: "housing", label: "住房", icon: "🏠", color: "#B4A7D6" },
  { id: "income", label: "收入", icon: "💰", color: "#69DB7C", fixed: true },
  { id: "other", label: "其他", icon: "📦", color: "#DEE2E6" },
];

const DEFAULT_RECORDS = [
  { id: uid(), date: "2026-03-10", category: "food", desc: "早餐便當", amount: -85, type: "expense" },
  { id: uid(), date: "2026-03-10", category: "transport", desc: "捷運月票", amount: -1280, type: "expense" },
  { id: uid(), date: "2026-03-09", category: "income", desc: "三月薪資", amount: 48000, type: "income" },
  { id: uid(), date: "2026-03-09", category: "shopping", desc: "UNIQLO", amount: -1590, type: "expense" },
  { id: uid(), date: "2026-03-08", category: "entertainment", desc: "電影票", amount: -360, type: "expense" },
];

const DEFAULT_LOANS = [
  { id: uid(), name: "車貸", icon: "🚗", color: "#4ECDC4", principal: 500000, rate: 2.5, totalMonths: 60, paidMonths: 12, startDate: "2025-03-01" },
  { id: uid(), name: "房貸", icon: "🏠", color: "#B4A7D6", principal: 8000000, rate: 1.8, totalMonths: 240, paidMonths: 24, startDate: "2024-03-01" },
];

// ─── Loan Math ────────────────────────────────────────────────────────────────
function calcLoan(principal, annualRate, months) {
  if (!principal || !months) return { monthly: 0, totalPayment: 0, totalInterest: 0 };
  if (annualRate === 0) { const m = principal / months; return { monthly: m, totalPayment: m * months, totalInterest: 0 }; }
  const r = annualRate / 100 / 12;
  const monthly = principal * r * Math.pow(1 + r, months) / (Math.pow(1 + r, months) - 1);
  return { monthly, totalPayment: monthly * months, totalInterest: monthly * months - principal };
}

function loanSchedule(principal, annualRate, months, paidMonths) {
  const r = annualRate / 100 / 12;
  let balance = principal;
  const rows = [];
  if (annualRate === 0) {
    const mp = principal / months;
    for (let i = 1; i <= Math.min(months, paidMonths + 3); i++) {
      balance -= mp;
      rows.push({ month: i, principal: mp, interest: 0, balance: Math.max(0, balance) });
    }
  } else {
    const monthly = calcLoan(principal, annualRate, months).monthly;
    for (let i = 1; i <= Math.min(months, paidMonths + 3); i++) {
      const interest = balance * r;
      const prin = monthly - interest;
      balance -= prin;
      rows.push({ month: i, principal: prin, interest, balance: Math.max(0, balance) });
    }
  }
  return rows;
}

// ─── Currency Data ─────────────────────────────────────────────────────────
const CURRENCIES = [
  { code: "TWD", name: "台幣", symbol: "NT$", flag: "🇹🇼" },
  { code: "USD", name: "美元", symbol: "$", flag: "🇺🇸" },
  { code: "JPY", name: "日圓", symbol: "¥", flag: "🇯🇵" },
  { code: "EUR", name: "歐元", symbol: "€", flag: "🇪🇺" },
  { code: "CNY", name: "人民幣", symbol: "¥", flag: "🇨🇳" },
  { code: "KRW", name: "韓元", symbol: "₩", flag: "🇰🇷" },
  { code: "HKD", name: "港幣", symbol: "HK$", flag: "🇭🇰" },
  { code: "GBP", name: "英鎊", symbol: "£", flag: "🇬🇧" },
  { code: "AUD", name: "澳幣", symbol: "A$", flag: "🇦🇺" },
  { code: "SGD", name: "新幣", symbol: "S$", flag: "🇸🇬" },
  { code: "THB", name: "泰銖", symbol: "฿", flag: "🇹🇭" },
];
const FALLBACK_RATES = { TWD:1, USD:32.5, JPY:0.217, EUR:35.2, CNY:4.48, KRW:0.0237, HKD:4.16, GBP:41.2, AUD:21.0, SGD:24.1, THB:0.91 };

// ─── Notification Helper ────────────────────────────────────────────────────
async function requestNotifPermission() {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission !== "denied") {
    const result = await Notification.requestPermission();
    return result;
  }
  return Notification.permission;
}

function scheduleNotif(title, body, delayMs = 0) {
  if (Notification.permission !== "granted") return;
  setTimeout(() => new Notification(title, { body, icon: "/favicon.ico" }), delayMs);
}

// Calculate days until next payment (based on startDate day-of-month)
function daysUntilNextPayment(loan) {
  const start = new Date(loan.startDate);
  const payDay = start.getDate();
  const now = new Date();
  let next = new Date(now.getFullYear(), now.getMonth(), payDay);
  if (next <= now) next = new Date(now.getFullYear(), now.getMonth() + 1, payDay);
  return Math.ceil((next - now) / (1000 * 60 * 60 * 24));
}

// ─── Icons ──────────────────────────────────────────────────────────────────
const EMOJI_OPTIONS = ["🍜","🚇","🛍️","🎮","💊","🏠","💰","📦","☕","🍺","✈️","🎵","📚","💻","🐶","🏋️","🎁","💇","🚗","⛽","🏥","🎓","🏖️","🍕","🎯","💡","🔧","🧴","🏪","🎪"];
const COLOR_OPTIONS = ["#FF6B6B","#4ECDC4","#FFE66D","#A8E6CF","#FF8B94","#B4A7D6","#69DB7C","#DEE2E6","#F4A261","#E9C46A","#2A9D8F","#E76F51","#457B9D","#A8DADC","#F72585","#7209B7"];

// ─── Main App ────────────────────────────────────────────────────────────────
export default function App() {
  const [records, setRecords] = useState(() => load("v2_records", DEFAULT_RECORDS));
  const [categories, setCategories] = useState(() => load("v2_cats", DEFAULT_CATS));
  const [loans, setLoans] = useState(() => load("v2_loans", DEFAULT_LOANS));
  const [tab, setTab] = useState("home");
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(false);
  // Sub-views
  const [subView, setSubView] = useState(null); // "addRecord"|"addLoan"|"editLoan"|"addCat"|"loanDetail"
  const [selectedLoan, setSelectedLoan] = useState(null);
  const [filterMonth, setFilterMonth] = useState("2026-03");

  // Forms
  const emptyRecord = { type: "expense", amount: "", category: "food", desc: "", date: today() };
  const emptyLoan = { name: "", icon: "🚗", color: "#4ECDC4", principal: "", rate: "", totalMonths: "", paidMonths: "0", startDate: today() };
  const emptyCat = { label: "", icon: "📦", color: "#4ECDC4" };
  const [recordForm, setRecordForm] = useState(emptyRecord);
  const [loanForm, setLoanForm] = useState(emptyLoan);
  const [catForm, setCatForm] = useState(emptyCat);

  // Loan calculator
  const [calc, setCalc] = useState({ principal: "1000000", rate: "2.5", months: "240" });

  // Currency
  const [fx, setFx] = useState({ from: "USD", to: "TWD", amount: "1000" });
  const [fxRates, setFxRates] = useState(() => load("v2_fxrates", FALLBACK_RATES));
  const [fxLoading, setFxLoading] = useState(false);
  const [fxUpdated, setFxUpdated] = useState(() => load("v2_fxupdated", null));
  // Gold
  const [goldUSD, setGoldUSD] = useState(() => load("v2_gold_usd", null)); // price per troy oz in USD
  const [goldLoading, setGoldLoading] = useState(false);
  const [goldUnit, setGoldUnit] = useState("tael"); // tael(台兩) | gram | oz
  // Notifications
  const [notifPerm, setNotifPerm] = useState(() => typeof Notification !== "undefined" ? Notification.permission : "unsupported");
  const notifChecked = useRef(false);

  useEffect(() => { save("v2_records", records); }, [records]);
  useEffect(() => { save("v2_cats", categories); }, [categories]);
  useEffect(() => { save("v2_loans", loans); }, [loans]);

  // ── Live FX fetch (frankfurter.app, free & no key needed) ──
  const fetchRates = useCallback(async () => {
    setFxLoading(true);
    setGoldLoading(true);
    try {
      const res = await fetch("https://api.frankfurter.app/latest?from=TWD&to=USD,JPY,EUR,CNY,KRW,HKD,GBP,AUD,SGD,THB");
      const data = await res.json();
      const rates = { TWD: 1 };
      for (const [code, val] of Object.entries(data.rates)) {
        rates[code] = 1 / val;
      }
      setFxRates(rates);
      const now = new Date().toLocaleString("zh-TW", { month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit" });
      setFxUpdated(now);
      save("v2_fxrates", rates);
      save("v2_fxupdated", now);

      // Fetch gold price (USD per troy oz) via metals-api fallback: use open-source goldprice.org API
      // We use a CORS-friendly public endpoint
      try {
        const gRes = await fetch("https://api.frankfurter.app/latest?from=XAU&to=USD");
        const gData = await gRes.json();
        // XAU = 1 troy oz of gold; gData.rates.USD = price of 1 oz in USD
        if (gData.rates?.USD) {
          setGoldUSD(gData.rates.USD);
          save("v2_gold_usd", gData.rates.USD);
        }
      } catch { /* keep cached */ }
    } catch { /* silently fallback */ }
    setFxLoading(false);
    setGoldLoading(false);
  }, []);

  useEffect(() => { fetchRates(); }, [fetchRates]);

  // ── Loan reminder check on load ──
  useEffect(() => {
    if (notifChecked.current || notifPerm !== "granted") return;
    notifChecked.current = true;
    loans.forEach(l => {
      const days = daysUntilNextPayment(l);
      const { monthly } = calcLoan(l.principal, l.rate, l.totalMonths);
      const remaining = l.totalMonths - l.paidMonths;
      if (remaining <= 0) return;
      if (days <= 3) {
        scheduleNotif(`💳 ${l.name} 還款提醒`, `${days === 0 ? "今天" : `還有 ${days} 天`}需還款 ${fmt(monthly)}，剩餘 ${remaining} 期`);
      }
    });
  }, [loans, notifPerm]);

  const sync = useCallback(() => {
    setSyncing(true);
    setTimeout(() => { setSyncing(false); setSynced(true); setTimeout(() => setSynced(false), 2000); }, 1200);
  }, []);

  // ── Record actions ──
  const addRecord = () => {
    if (!recordForm.amount || isNaN(+recordForm.amount)) return;
    const amt = recordForm.type === "expense" ? -Math.abs(+recordForm.amount) : +Math.abs(+recordForm.amount);
    setRecords(p => [{ id: uid(), ...recordForm, amount: amt }, ...p]);
    setRecordForm(emptyRecord);
    setSubView(null);
    sync();
  };
  const delRecord = (id) => { setRecords(p => p.filter(r => r.id !== id)); sync(); };

  // ── Loan actions ──
  const saveLoan = () => {
    if (!loanForm.name || !loanForm.principal) return;
    if (loanForm.id) {
      setLoans(p => p.map(l => l.id === loanForm.id ? { ...loanForm, principal: +loanForm.principal, rate: +loanForm.rate, totalMonths: +loanForm.totalMonths, paidMonths: +loanForm.paidMonths } : l));
    } else {
      setLoans(p => [...p, { id: uid(), ...loanForm, principal: +loanForm.principal, rate: +loanForm.rate, totalMonths: +loanForm.totalMonths, paidMonths: +loanForm.paidMonths }]);
    }
    setLoanForm(emptyLoan);
    setSubView(null);
    sync();
  };
  const delLoan = (id) => { setLoans(p => p.filter(l => l.id !== id)); setSubView(null); };
  const payMonth = (id) => {
    setLoans(p => p.map(l => l.id === id ? { ...l, paidMonths: Math.min(l.paidMonths + 1, l.totalMonths) } : l));
    sync();
  };

  // ── Category actions ──
  const addCat = () => {
    if (!catForm.label) return;
    setCategories(p => [...p, { id: uid(), ...catForm }]);
    setCatForm(emptyCat);
    setSubView(null);
  };
  const delCat = (id) => setCategories(p => p.filter(c => c.fixed || c.id !== id));

  // ── Derived ──
  const monthRecords = records.filter(r => r.date.startsWith(filterMonth));
  const totalIncome = monthRecords.filter(r => r.type === "income").reduce((s, r) => s + r.amount, 0);
  const totalExpense = monthRecords.filter(r => r.type === "expense").reduce((s, r) => s + Math.abs(r.amount), 0);
  const balance = totalIncome - totalExpense;
  const expCats = categories.filter(c => c.id !== "income");
  const catOf = (id) => categories.find(c => c.id === id) || { icon: "📦", label: "其他", color: "#888" };
  const catStats = expCats.map(c => ({ ...c, total: Math.abs(monthRecords.filter(r => r.category === c.id && r.type === "expense").reduce((s, r) => s + r.amount, 0)) })).filter(c => c.total > 0).sort((a, b) => b.total - a.total);
  const grouped = monthRecords.reduce((acc, r) => { (acc[r.date] ??= []).push(r); return acc; }, {});

  // Loan calc
  const calcResult = calcLoan(+calc.principal, +calc.rate, +calc.months);

  // FX (live rates)
  const fxResult = () => {
    const amt = parseFloat(fx.amount) || 0;
    const inTwd = amt * (fxRates[fx.from] || FALLBACK_RATES[fx.from] || 1);
    const out = inTwd / (fxRates[fx.to] || FALLBACK_RATES[fx.to] || 1);
    return out;
  };
  const fxCrossRate = () => {
    const fromTwd = fxRates[fx.from] || FALLBACK_RATES[fx.from] || 1;
    const toTwd = fxRates[fx.to] || FALLBACK_RATES[fx.to] || 1;
    return (fromTwd / toTwd).toFixed(4);
  };

  const MONTHS = ["2026-01","2026-02","2026-03"];

  // ──────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'Noto Sans TC', sans-serif", background: "#0F0F13", minHeight: "100vh", color: "#F0EEE9", maxWidth: 480, margin: "0 auto", position: "relative" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400;500;700&family=DM+Serif+Display&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
        ::-webkit-scrollbar{width:3px;}::-webkit-scrollbar-thumb{background:#333;border-radius:2px;}
        .card{background:#1A1A22;border-radius:18px;padding:18px;}
        .btn{border:none;cursor:pointer;font-family:inherit;transition:all .15s;}
        .btn:active{transform:scale(0.96);}
        .fade{animation:fade .25s ease;}
        @keyframes fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        input,select{outline:none;font-family:inherit;color:#F0EEE9;}
        @keyframes spin{to{transform:rotate(360deg)}}
        .spin{animation:spin 1s linear infinite;display:inline-block;}
        .serif{font-family:'DM Serif Display',serif;}
        .tag{display:inline-flex;align-items:center;padding:3px 10px;border-radius:20px;font-size:11px;background:#1E1E28;}
        .overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:100;display:flex;align-items:flex-end;justify-content:center;max-width:480px;left:50%;transform:translateX(-50%);}
        .sheet{background:#141418;border-radius:24px 24px 0 0;padding:24px 20px 40px;width:100%;max-height:85vh;overflow-y:auto;}
        .inp{background:#222;border:1.5px solid #2A2A35;border-radius:12px;padding:10px 14px;font-size:14px;width:100%;}
        .inp:focus{border-color:#4ECDC4;}
        .row{display:flex;justify-content:space-between;align-items:center;}
      `}</style>

      {/* Header */}
      <div style={{ padding: "20px 20px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 10, color: "#555", letterSpacing: 3, textTransform: "uppercase" }}>MoneyFlow</div>
          <div style={{ fontSize: 17, fontWeight: 700, marginTop: 1 }}>財務管理</div>
        </div>
        <button className="btn" onClick={sync} style={{ background: "#1A1A22", borderRadius: 12, padding: "7px 13px", display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: synced ? "#69DB7C" : "#666" }}>
          {syncing
            ? <span className="spin" style={{ width: 12, height: 12, border: "2px solid #333", borderTop: "2px solid #4ECDC4", borderRadius: "50%" }} />
            : <span style={{ width: 7, height: 7, borderRadius: "50%", background: synced ? "#69DB7C" : "#333", display: "inline-block" }} />}
          {syncing ? "同步中" : synced ? "已同步" : "同步"}
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, padding: "14px 20px 0", overflowX: "auto" }}>
        {[["home","⊞","總覽"],["loans","🏦","貸款"],["calc","🧮","試算"],["fx","💱","匯率"],["cats","🏷️","分類"]].map(([id,ic,lb]) => (
          <button key={id} onClick={() => { setTab(id); setSubView(null); }} className="btn" style={{ flexShrink: 0, padding: "7px 14px", borderRadius: 20, background: tab === id ? "#4ECDC4" : "#1A1A22", color: tab === id ? "#0F0F13" : "#666", fontSize: 12, fontWeight: tab === id ? 700 : 400, display: "flex", gap: 5, alignItems: "center" }}>
            {ic} {lb}
          </button>
        ))}
      </div>

      {/* Body */}
      <div style={{ padding: "16px 20px 110px", overflowY: "auto", maxHeight: "calc(100vh - 130px)" }} className="fade">

        {/* ── HOME ── */}
        {tab === "home" && <>
          <div style={{ background: "linear-gradient(135deg,#1E3A5F,#0F2340,#1A1A22)", borderRadius: 22, padding: 22, marginBottom: 14, position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: -30, right: -30, width: 110, height: 110, borderRadius: "50%", background: "rgba(78,205,196,.06)" }} />
            <div style={{ fontSize: 10, color: "rgba(255,255,255,.35)", letterSpacing: 2, marginBottom: 4 }}>{filterMonth} 結餘</div>
            <div className="serif" style={{ fontSize: 36, color: balance >= 0 ? "#A8E6CF" : "#FF8B94" }}>{fmt(balance)}</div>
            <div style={{ display: "flex", gap: 20, marginTop: 16 }}>
              <div><div style={{ fontSize: 9, color: "rgba(255,255,255,.3)", marginBottom: 2 }}>收入</div><div style={{ color: "#69DB7C", fontWeight: 600, fontSize: 14 }}>+{fmt(totalIncome)}</div></div>
              <div style={{ width: 1, background: "rgba(255,255,255,.08)" }} />
              <div><div style={{ fontSize: 9, color: "rgba(255,255,255,.3)", marginBottom: 2 }}>支出</div><div style={{ color: "#FF6B6B", fontWeight: 600, fontSize: 14 }}>-{fmt(totalExpense)}</div></div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 7, marginBottom: 14, overflowX: "auto" }}>
            {MONTHS.map(m => (
              <button key={m} onClick={() => setFilterMonth(m)} className="btn" style={{ flexShrink: 0, padding: "5px 13px", borderRadius: 18, background: filterMonth === m ? "#4ECDC4" : "#1A1A22", color: filterMonth === m ? "#0F0F13" : "#666", fontSize: 12, fontWeight: filterMonth === m ? 700 : 400 }}>{m.replace("-","/")}</button>
            ))}
          </div>

          {catStats.length > 0 && <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: "#555", marginBottom: 12 }}>本月支出分布</div>
            {catStats.slice(0, 5).map(c => (
              <div key={c.id} style={{ marginBottom: 10 }}>
                <div className="row" style={{ fontSize: 12, marginBottom: 4 }}><span>{c.icon} {c.label}</span><span style={{ color: "#bbb" }}>{fmt(c.total)}</span></div>
                <div style={{ height: 4, background: "#1E1E26", borderRadius: 2 }}><div style={{ height: "100%", width: `${Math.min(100,(c.total/totalExpense)*100)}%`, background: c.color, borderRadius: 2, transition: "width .5s ease" }} /></div>
              </div>
            ))}
          </div>}

          <div style={{ fontSize: 11, color: "#555", marginBottom: 10 }}>最近記錄</div>
          {Object.keys(grouped).sort((a,b)=>b.localeCompare(a)).slice(0,7).map(date => (
            <div key={date} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: "#444", marginBottom: 7 }}>{date}</div>
              {grouped[date].map(r => {
                const c = catOf(r.category);
                return (
                  <div key={r.id} className="card" style={{ marginBottom: 7, padding: "12px 14px", display: "flex", alignItems: "center", gap: 11 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 11, background: c.color+"22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0 }}>{c.icon}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.desc}</div>
                      <div style={{ fontSize: 10, color: "#555", marginTop: 1 }}>{c.label}</div>
                    </div>
                    <span style={{ fontWeight: 700, fontSize: 14, color: r.amount > 0 ? "#69DB7C" : "#FF6B6B" }}>{r.amount > 0 ? "+" : ""}{fmt(r.amount)}</span>
                    <button onClick={() => delRecord(r.id)} className="btn" style={{ color: "#333", background: "none", fontSize: 17, padding: "0 2px" }}>×</button>
                  </div>
                );
              })}
            </div>
          ))}
          {monthRecords.length === 0 && <div style={{ textAlign: "center", color: "#333", padding: "40px 0", fontSize: 13 }}>本月尚無記錄</div>}
        </>}

        {/* ── LOANS ── */}
        {tab === "loans" && !subView && <>
          <div className="row" style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>貸款專案</div>
            <div style={{ display: "flex", gap: 8 }}>
              {notifPerm !== "granted" && notifPerm !== "unsupported" && (
                <button onClick={async () => { const p = await requestNotifPermission(); setNotifPerm(p); }} className="btn" style={{ background: "#FFE66D22", color: "#FFE66D", padding: "7px 12px", borderRadius: 12, fontSize: 12, fontWeight: 600 }}>🔔 開啟提醒</button>
              )}
              {notifPerm === "granted" && <span style={{ fontSize: 11, color: "#69DB7C", padding: "7px 0" }}>🔔 提醒已開啟</span>}
              <button onClick={() => { setLoanForm(emptyLoan); setSubView("addLoan"); }} className="btn" style={{ background: "#4ECDC422", color: "#4ECDC4", padding: "7px 14px", borderRadius: 12, fontSize: 13, fontWeight: 600 }}>＋ 新增</button>
            </div>
          </div>
          {loans.length === 0 && <div style={{ textAlign: "center", color: "#333", padding: "40px 0" }}>尚無貸款專案</div>}
          {loans.map(l => {
            const { monthly, totalInterest } = calcLoan(l.principal, l.rate, l.totalMonths);
            const remaining = l.totalMonths - l.paidMonths;
            const paidPct = l.paidMonths / l.totalMonths;
            const remainAmt = monthly * remaining;
            const days = daysUntilNextPayment(l);
            const urgent = days <= 3 && remaining > 0;
            return (
              <div key={l.id} className="card" style={{ marginBottom: 12, cursor: "pointer", borderLeft: `3px solid ${l.color}` }} onClick={() => { setSelectedLoan(l); setSubView("loanDetail"); }}>
                <div className="row" style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 38, height: 38, borderRadius: 12, background: l.color+"22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, position: "relative" }}>
                      {l.icon}
                      {urgent && <span style={{ position: "absolute", top: -4, right: -4, width: 10, height: 10, borderRadius: "50%", background: "#FF6B6B", border: "2px solid #0F0F13" }} />}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", gap: 6 }}>
                        {l.name}
                        {urgent && <span style={{ fontSize: 10, background: "#FF6B6B22", color: "#FF6B6B", padding: "2px 7px", borderRadius: 8 }}>{days === 0 ? "今日還款" : `${days}天後還款`}</span>}
                      </div>
                      <div style={{ fontSize: 10, color: "#555", marginTop: 1 }}>年利率 {l.rate}% · 每月{days}日</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 10, color: "#555" }}>每月還款</div>
                    <div className="serif" style={{ fontSize: 18, color: l.color }}>{fmt(monthly)}</div>
                  </div>
                </div>
                <div style={{ height: 6, background: "#1E1E26", borderRadius: 3, marginBottom: 8 }}>
                  <div style={{ height: "100%", width: `${paidPct*100}%`, background: l.color, borderRadius: 3 }} />
                </div>
                <div className="row" style={{ fontSize: 11, color: "#555" }}>
                  <span>已還 <b style={{ color: "#bbb" }}>{l.paidMonths}</b> 期</span>
                  <span>剩 <b style={{ color: "#FF8B94" }}>{remaining}</b> 期 · {fmt(remainAmt)}</span>
                  <span>共 {l.totalMonths} 期</span>
                </div>
              </div>
            );
          })}
        </>}

        {tab === "loans" && subView === "loanDetail" && selectedLoan && (() => {
          const l = loans.find(x => x.id === selectedLoan.id) || selectedLoan;
          const { monthly, totalPayment, totalInterest } = calcLoan(l.principal, l.rate, l.totalMonths);
          const remaining = l.totalMonths - l.paidMonths;
          const schedule = loanSchedule(l.principal, l.rate, l.totalMonths, l.paidMonths);
          return (
            <div className="fade">
              <button onClick={() => setSubView(null)} className="btn" style={{ color: "#4ECDC4", background: "none", fontSize: 13, marginBottom: 14 }}>← 返回</button>
              <div className="row" style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 42, height: 42, borderRadius: 13, background: l.color+"22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>{l.icon}</div>
                  <div><div style={{ fontWeight: 700, fontSize: 17 }}>{l.name}</div><div style={{ fontSize: 11, color: "#555" }}>年利率 {l.rate}%</div></div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => { setLoanForm({ ...l, principal: String(l.principal), rate: String(l.rate), totalMonths: String(l.totalMonths), paidMonths: String(l.paidMonths) }); setSubView("addLoan"); }} className="btn" style={{ background: "#1A1A22", color: "#888", padding: "6px 10px", borderRadius: 10, fontSize: 12 }}>編輯</button>
                  <button onClick={() => delLoan(l.id)} className="btn" style={{ background: "#FF6B6B22", color: "#FF6B6B", padding: "6px 10px", borderRadius: 10, fontSize: 12 }}>刪除</button>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                {[["貸款總額", fmt(l.principal)],["每月還款", fmt(monthly)],["總利息", fmt(totalInterest)],["剩餘期數", `${remaining} 期`]].map(([k,v]) => (
                  <div key={k} className="card" style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>{k}</div>
                    <div className="serif" style={{ fontSize: 16, color: l.color }}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{ height: 8, background: "#1A1A22", borderRadius: 4, marginBottom: 6 }}>
                <div style={{ height: "100%", width: `${(l.paidMonths/l.totalMonths)*100}%`, background: l.color, borderRadius: 4, transition: "width .5s" }} />
              </div>
              <div className="row" style={{ fontSize: 11, color: "#555", marginBottom: 16 }}>
                <span>已還 {l.paidMonths} 期 ({Math.round(l.paidMonths/l.totalMonths*100)}%)</span>
                <span>剩 {remaining} 期</span>
              </div>
              <button onClick={() => payMonth(l.id)} className="btn" style={{ width: "100%", padding: 13, borderRadius: 14, background: remaining > 0 ? `linear-gradient(135deg,${l.color},${l.color}99)` : "#1A1A22", color: remaining > 0 ? "#0F0F13" : "#444", fontWeight: 700, fontSize: 14, marginBottom: 16 }} disabled={remaining === 0}>
                {remaining > 0 ? `✓ 標記本期已還款 (${fmt(monthly)})` : "🎉 貸款已還清！"}
              </button>
              <div style={{ fontSize: 11, color: "#555", marginBottom: 10 }}>還款明細</div>
              <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", padding: "10px 14px", borderBottom: "1px solid #222", fontSize: 10, color: "#555" }}>
                  <span>期數</span><span style={{textAlign:"right"}}>本金</span><span style={{textAlign:"right"}}>利息</span><span style={{textAlign:"right"}}>餘額</span>
                </div>
                {schedule.map((row, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", padding: "9px 14px", borderBottom: "1px solid #1A1A22", fontSize: 11, background: row.month <= l.paidMonths ? "#1E1E2A" : "transparent", color: row.month <= l.paidMonths ? "#555" : "#bbb" }}>
                    <span style={{ color: row.month === l.paidMonths + 1 ? l.color : undefined }}>{row.month <= l.paidMonths ? "✓" : ""} {row.month}</span>
                    <span style={{textAlign:"right"}}>{fmtPlain(row.principal)}</span>
                    <span style={{textAlign:"right"}}>{fmtPlain(row.interest)}</span>
                    <span style={{textAlign:"right"}}>{fmtPlain(row.balance)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {tab === "loans" && subView === "addLoan" && (
          <div className="fade">
            <button onClick={() => setSubView(selectedLoan ? "loanDetail" : null)} className="btn" style={{ color: "#4ECDC4", background: "none", fontSize: 13, marginBottom: 16 }}>← 取消</button>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 18 }}>{loanForm.id ? "編輯貸款" : "新增貸款"}</div>
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <div style={{ width: 56, height: 56, borderRadius: 15, background: loanForm.color+"22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, flexShrink: 0 }}>{loanForm.icon}</div>
              <input className="inp" value={loanForm.name} onChange={e => setLoanForm(p => ({...p, name: e.target.value}))} placeholder="貸款名稱（例：房貸）" />
            </div>
            <div style={{ fontSize: 11, color: "#555", marginBottom: 8 }}>選擇圖示</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
              {EMOJI_OPTIONS.map(e => <button key={e} onClick={() => setLoanForm(p => ({...p, icon: e}))} className="btn" style={{ fontSize: 20, padding: 6, borderRadius: 10, background: loanForm.icon===e ? "#4ECDC422" : "#1A1A22", border: loanForm.icon===e ? "1.5px solid #4ECDC4" : "1.5px solid transparent" }}>{e}</button>)}
            </div>
            <div style={{ fontSize: 11, color: "#555", marginBottom: 8 }}>顏色</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 16 }}>
              {COLOR_OPTIONS.map(c => <button key={c} onClick={() => setLoanForm(p => ({...p, color: c}))} className="btn" style={{ width: 28, height: 28, borderRadius: "50%", background: c, border: loanForm.color===c ? "3px solid #fff" : "3px solid transparent" }} />)}
            </div>
            {[["貸款金額（元）","principal","number"],["年利率（%）","rate","number"],["總期數（月）","totalMonths","number"],["已還期數","paidMonths","number"]].map(([label, key, type]) => (
              <div key={key} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: "#555", marginBottom: 6 }}>{label}</div>
                <input className="inp" type={type} value={loanForm[key]} onChange={e => setLoanForm(p => ({...p, [key]: e.target.value}))} placeholder={label} />
              </div>
            ))}
            <button onClick={saveLoan} className="btn" style={{ width: "100%", padding: 14, borderRadius: 14, background: "linear-gradient(135deg,#4ECDC4,#44A8A0)", color: "#0F0F13", fontWeight: 700, fontSize: 15, marginTop: 8 }}>儲存貸款</button>
          </div>
        )}

        {/* ── CALC ── */}
        {tab === "calc" && (
          <div className="fade">
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 18 }}>貸款試算</div>
            {[["貸款金額（元）","principal"],["年利率（%）","rate"],["貸款期數（月）","months"]].map(([label, key]) => (
              <div key={key} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: "#555", marginBottom: 6 }}>{label}</div>
                <input className="inp" type="number" value={calc[key]} onChange={e => setCalc(p => ({...p, [key]: e.target.value}))} placeholder={label} />
              </div>
            ))}
            <div style={{ background: "linear-gradient(135deg,#1E3A5F,#0F2340)", borderRadius: 20, padding: 22, marginTop: 20 }}>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,.35)", marginBottom: 14, letterSpacing: 1 }}>試算結果</div>
              {[["每月應還", fmt(calcResult.monthly), "#4ECDC4"],["貸款總額", fmt(+calc.principal || 0), "#bbb"],["總利息", fmt(calcResult.totalInterest), "#FF8B94"],["總還款額", fmt(calcResult.totalPayment), "#bbb"]].map(([k, v, color]) => (
                <div key={k} className="row" style={{ marginBottom: 14 }}>
                  <span style={{ fontSize: 13, color: "#888" }}>{k}</span>
                  <span className="serif" style={{ fontSize: k === "每月應還" ? 24 : 16, color }}>{v}</span>
                </div>
              ))}
              {+calc.principal > 0 && +calc.months > 0 && (
                <div>
                  <div style={{ height: 1, background: "rgba(255,255,255,.06)", margin: "12px 0" }} />
                  <div style={{ fontSize: 10, color: "#555" }}>利息佔比</div>
                  <div style={{ height: 6, background: "#0F2340", borderRadius: 3, marginTop: 6 }}>
                    <div style={{ height: "100%", width: `${Math.min(100, calcResult.totalInterest / calcResult.totalPayment * 100)}%`, background: "#FF8B94", borderRadius: 3 }} />
                  </div>
                  <div style={{ fontSize: 10, color: "#FF8B94", marginTop: 4, textAlign: "right" }}>{(calcResult.totalInterest / calcResult.totalPayment * 100).toFixed(1)}%</div>
                </div>
              )}
            </div>
            {/* Amortization preview */}
            {+calc.principal > 0 && +calc.months > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 11, color: "#555", marginBottom: 10 }}>前幾期攤還表</div>
                <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", padding: "9px 14px", borderBottom: "1px solid #222", fontSize: 10, color: "#555" }}>
                    <span>期</span><span style={{textAlign:"right"}}>本金</span><span style={{textAlign:"right"}}>利息</span><span style={{textAlign:"right"}}>餘額</span>
                  </div>
                  {loanSchedule(+calc.principal, +calc.rate, +calc.months, 0).slice(0, 6).map((r, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", padding: "8px 14px", borderBottom: "1px solid #1A1A22", fontSize: 11, color: "#bbb" }}>
                      <span>{r.month}</span>
                      <span style={{textAlign:"right"}}>{fmtPlain(r.principal)}</span>
                      <span style={{textAlign:"right"}}>{fmtPlain(r.interest)}</span>
                      <span style={{textAlign:"right"}}>{fmtPlain(r.balance)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── FX ── */}
        {tab === "fx" && (
          <div className="fade">
            <div className="row" style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>匯率 & 黃金</div>
              <button onClick={fetchRates} className="btn" style={{ background: "#1A1A22", color: fxLoading ? "#4ECDC4" : "#666", padding: "6px 12px", borderRadius: 10, fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                <span className={fxLoading ? "spin" : ""} style={{ display: "inline-block" }}>↻</span>
                {fxLoading ? "更新中..." : "刷新匯率"}
              </button>
            </div>
            <div style={{ fontSize: 10, color: "#444", marginBottom: 14 }}>
              {fxUpdated ? `⚡ 即時匯率 · 上次更新：${fxUpdated}` : "⚡ 即時匯率（frankfurter.app）"}
            </div>

            {/* Gold Card */}
            {(() => {
              const usdPerOz = goldUSD || 3100; // fallback approx
              const twdPerUSD = fxRates["USD"] || FALLBACK_RATES["USD"];
              const twdPerOz = usdPerOz * twdPerUSD;
              // 1 troy oz = 31.1035 g; 1 台兩 = 37.5g
              const twdPerGram = twdPerOz / 31.1035;
              const twdPerTael = twdPerGram * 37.5;
              const units = [
                { key: "tael", label: "台兩", sublabel: "37.5g", value: twdPerTael },
                { key: "gram", label: "公克", sublabel: "1g", value: twdPerGram },
                { key: "oz",   label: "英兩", sublabel: "troy oz", value: twdPerOz },
              ];
              const active = units.find(u => u.key === goldUnit);
              return (
                <div style={{ background: "linear-gradient(135deg,#2A1F0A,#1A1508)", borderRadius: 20, padding: 20, marginBottom: 16, border: "1px solid #3A2E0A" }}>
                  <div className="row" style={{ marginBottom: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 22 }}>🥇</span>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: "#E9C46A" }}>黃金即時價格</div>
                        <div style={{ fontSize: 10, color: "#6A5A2A", marginTop: 1 }}>
                          {goldUSD ? `國際金價 $${fmtPlain(usdPerOz)}/oz` : "參考價格"}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                      {units.map(u => (
                        <button key={u.key} onClick={() => setGoldUnit(u.key)} className="btn" style={{ padding: "4px 9px", borderRadius: 8, background: goldUnit === u.key ? "#E9C46A22" : "#1A1508", color: goldUnit === u.key ? "#E9C46A" : "#6A5A2A", fontSize: 11, border: goldUnit === u.key ? "1px solid #E9C46A44" : "1px solid transparent" }}>{u.label}</button>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <div className="serif" style={{ fontSize: 34, color: "#E9C46A" }}>
                      {goldLoading ? "—" : `NT$ ${fmtPlain(active.value)}`}
                    </div>
                    <div style={{ fontSize: 12, color: "#6A5A2A" }}>/ {active.sublabel}</div>
                  </div>
                  <div style={{ display: "flex", gap: 16, marginTop: 14, paddingTop: 14, borderTop: "1px solid #2A2008" }}>
                    {units.filter(u => u.key !== goldUnit).map(u => (
                      <div key={u.key}>
                        <div style={{ fontSize: 10, color: "#6A5A2A", marginBottom: 2 }}>{u.label} ({u.sublabel})</div>
                        <div style={{ fontSize: 13, color: "#C4A43A", fontWeight: 600 }}>NT$ {fmtPlain(u.value)}</div>
                      </div>
                    ))}
                    <div>
                      <div style={{ fontSize: 10, color: "#6A5A2A", marginBottom: 2 }}>USD / oz</div>
                      <div style={{ fontSize: 13, color: "#C4A43A", fontWeight: 600 }}>${fmtPlain(usdPerOz)}</div>
                    </div>
                  </div>
                </div>
              );
            })()}
            <div className="card" style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: "#555", marginBottom: 8 }}>金額</div>
              <input className="inp" type="number" value={fx.amount} onChange={e => setFx(p => ({...p, amount: e.target.value}))} placeholder="輸入金額" style={{ fontSize: 28, fontWeight: 700, background: "none", border: "none", padding: 0, width: "100%" }} />
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: "#555", marginBottom: 6 }}>從</div>
                <select value={fx.from} onChange={e => setFx(p => ({...p, from: e.target.value}))} className="inp" style={{ background: "#222" }}>
                  {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.flag} {c.code} {c.name}</option>)}
                </select>
              </div>
              <button onClick={() => setFx(p => ({...p, from: p.to, to: p.from}))} className="btn" style={{ background: "#1A1A22", borderRadius: 12, width: 40, height: 40, fontSize: 18, color: "#4ECDC4", marginTop: 18, flexShrink: 0 }}>⇄</button>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: "#555", marginBottom: 6 }}>換成</div>
                <select value={fx.to} onChange={e => setFx(p => ({...p, to: e.target.value}))} className="inp" style={{ background: "#222" }}>
                  {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.flag} {c.code} {c.name}</option>)}
                </select>
              </div>
            </div>
            <div style={{ background: "linear-gradient(135deg,#1E3A5F,#0F2340)", borderRadius: 20, padding: 24, textAlign: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,.35)", marginBottom: 8 }}>{fx.amount || "0"} {fx.from} =</div>
              <div className="serif" style={{ fontSize: 36, color: "#4ECDC4" }}>
                {fxLoading ? "—" : new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 }).format(fxResult())}
              </div>
              <div style={{ fontSize: 14, color: "#888", marginTop: 4 }}>{fx.to}</div>
              <div style={{ fontSize: 10, color: "#444", marginTop: 12 }}>1 {fx.from} ≈ {fxCrossRate()} {fx.to}</div>
            </div>
            {/* Shopping helper: show price in multiple currencies */}
            <div style={{ fontSize: 11, color: "#555", marginBottom: 10 }}>海外購物快速換算（以輸入金額為準）</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {CURRENCIES.filter(c => c.code !== fx.from).map(c => {
                const inTwd = (parseFloat(fx.amount)||1) * (fxRates[fx.from]||FALLBACK_RATES[fx.from]||1);
                const out = inTwd / (fxRates[c.code]||FALLBACK_RATES[c.code]||1);
                return (
                  <div key={c.code} className="card" style={{ padding: "11px 13px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setFx(p => ({...p, to: c.code}))}>
                    <span style={{ fontSize: 12 }}>{c.flag} {c.code}</span>
                    <span style={{ fontSize: 12, color: fx.to === c.code ? "#4ECDC4" : "#bbb", fontWeight: 600 }}>{fxLoading ? "—" : new Intl.NumberFormat("zh-TW",{maximumFractionDigits:1}).format(out)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── CATS ── */}
        {tab === "cats" && (
          <div className="fade">
            <div className="row" style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>自訂分類</div>
              <button onClick={() => setSubView("addCat")} className="btn" style={{ background: "#4ECDC422", color: "#4ECDC4", padding: "7px 14px", borderRadius: 12, fontSize: 13, fontWeight: 600 }}>＋ 新增</button>
            </div>
            {subView === "addCat" && (
              <div className="card" style={{ marginBottom: 16, borderLeft: "2px solid #4ECDC4" }}>
                <div style={{ fontSize: 12, color: "#4ECDC4", marginBottom: 12, fontWeight: 600 }}>新增分類</div>
                <input className="inp" value={catForm.label} onChange={e => setCatForm(p => ({...p, label: e.target.value}))} placeholder="分類名稱" style={{ marginBottom: 10 }} />
                <div style={{ fontSize: 11, color: "#555", marginBottom: 7 }}>圖示</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                  {EMOJI_OPTIONS.map(e => <button key={e} onClick={() => setCatForm(p => ({...p, icon: e}))} className="btn" style={{ fontSize: 18, padding: 5, borderRadius: 9, background: catForm.icon===e ? "#4ECDC422" : "#1E1E26", border: catForm.icon===e ? "1.5px solid #4ECDC4" : "1.5px solid transparent" }}>{e}</button>)}
                </div>
                <div style={{ fontSize: 11, color: "#555", marginBottom: 7 }}>顏色</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
                  {COLOR_OPTIONS.map(c => <button key={c} onClick={() => setCatForm(p => ({...p, color: c}))} className="btn" style={{ width: 26, height: 26, borderRadius: "50%", background: c, border: catForm.color===c ? "3px solid #fff" : "3px solid transparent" }} />)}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setSubView(null)} className="btn" style={{ flex: 1, padding: 11, borderRadius: 11, background: "#1E1E26", color: "#666", fontSize: 13 }}>取消</button>
                  <button onClick={addCat} className="btn" style={{ flex: 2, padding: 11, borderRadius: 11, background: "linear-gradient(135deg,#4ECDC4,#44A8A0)", color: "#0F0F13", fontWeight: 700, fontSize: 13 }}>新增</button>
                </div>
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {categories.map(c => (
                <div key={c.id} className="card" style={{ display: "flex", alignItems: "center", gap: 12, borderLeft: `3px solid ${c.color}` }}>
                  <div style={{ width: 38, height: 38, borderRadius: 11, background: c.color+"22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{c.icon}</div>
                  <div style={{ flex: 1, fontWeight: 500 }}>{c.label}</div>
                  {!c.fixed && <button onClick={() => delCat(c.id)} className="btn" style={{ background: "#FF6B6B22", color: "#FF6B6B", padding: "5px 10px", borderRadius: 8, fontSize: 12 }}>刪除</button>}
                  {c.fixed && <span style={{ fontSize: 10, color: "#444" }}>預設</span>}
                </div>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* Bottom Add Button (home only) */}
      {tab === "home" && !subView && (
        <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 50 }}>
          <button onClick={() => setSubView("addRecord")} className="btn" style={{ width: 58, height: 58, borderRadius: 18, background: "linear-gradient(135deg,#4ECDC4,#44A8A0)", color: "#0F0F13", fontSize: 28, fontWeight: 700, boxShadow: "0 8px 30px rgba(78,205,196,.35)" }}>＋</button>
        </div>
      )}

      {/* Add Record Sheet */}
      {subView === "addRecord" && (
        <div className="overlay" onClick={e => { if (e.target === e.currentTarget) setSubView(null); }}>
          <div className="sheet">
            <div className="row" style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>新增記帳</div>
              <button onClick={() => setSubView(null)} className="btn" style={{ color: "#555", background: "none", fontSize: 22 }}>×</button>
            </div>
            <div style={{ display: "flex", background: "#1E1E26", borderRadius: 14, padding: 3, marginBottom: 16 }}>
              {[["expense","支出"],["income","收入"]].map(([v, l]) => (
                <button key={v} onClick={() => setRecordForm(p => ({...p, type: v, category: v === "income" ? "income" : "food"}))} className="btn" style={{ flex: 1, padding: 10, borderRadius: 12, background: recordForm.type === v ? (v==="expense"?"#FF6B6B22":"#69DB7C22") : "transparent", color: recordForm.type === v ? (v==="expense"?"#FF6B6B":"#69DB7C") : "#555", fontWeight: 600, fontSize: 14 }}>{l}</button>
              ))}
            </div>
            <input className="inp" type="number" value={recordForm.amount} onChange={e => setRecordForm(p => ({...p, amount: e.target.value}))} placeholder="金額" style={{ fontSize: 28, fontWeight: 700, marginBottom: 12, background: "#1A1A22", border: "none" }} />
            <div style={{ fontSize: 11, color: "#555", marginBottom: 8 }}>分類</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 14 }}>
              {categories.filter(c => recordForm.type === "income" ? c.id === "income" : c.id !== "income").map(c => (
                <button key={c.id} onClick={() => setRecordForm(p => ({...p, category: c.id}))} className="btn" style={{ padding: "7px 12px", borderRadius: 20, background: recordForm.category === c.id ? c.color+"33" : "#1E1E26", border: `1.5px solid ${recordForm.category === c.id ? c.color : "transparent"}`, color: recordForm.category === c.id ? c.color : "#666", fontSize: 12, display: "flex", gap: 5, alignItems: "center" }}>
                  {c.icon} {c.label}
                </button>
              ))}
            </div>
            <input className="inp" value={recordForm.desc} onChange={e => setRecordForm(p => ({...p, desc: e.target.value}))} placeholder="備註（選填）" style={{ marginBottom: 10 }} />
            <input className="inp" type="date" value={recordForm.date} onChange={e => setRecordForm(p => ({...p, date: e.target.value}))} style={{ marginBottom: 16 }} />
            <button onClick={addRecord} className="btn" style={{ width: "100%", padding: 15, borderRadius: 14, background: "linear-gradient(135deg,#4ECDC4,#44A8A0)", color: "#0F0F13", fontWeight: 700, fontSize: 15 }}>確認記帳</button>
          </div>
        </div>
      )}
    </div>
  );
}