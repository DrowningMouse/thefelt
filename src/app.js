// ═══════════════════════════════════════════════
//  THE FELT — Poker Tracker
//  app.js
// ═══════════════════════════════════════════════

const SITE_PASSWORD = "allin"; // Change this to your own secret
const ADMIN_EMAIL = "dylan.r.minto@gmail.com"; // ← your admin email

function isAdmin() {
  return currentUser && currentUser.email === ADMIN_EMAIL;
}

// ── STATE ──────────────────────────────────────
let currentUser = null;
let allData = { users: {}, games: [] };

// Active game being built (local, non-live)
let activeGame = {
  date: new Date().toISOString().split("T")[0],
  name: "",
  entries: [],
};

// Cash-out modal target
let cashoutTargetIdx = null;

// Live game state
let liveGame = null;          // current snapshot from Firebase
let liveUnsubscribe = null;   // Firebase listener cleanup fn
let rebuyTargetId = null;     // userId for re-buy modal
let liveCashoutTargetId = null; // userId for live cashout modal

// ── FIREBASE SETUP (compat SDK loaded via CDN in index.html) ──
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAdo99TgIOc01oN67crUS1ECV7YCcMktcs",
  authDomain: "thefelt-136e9.firebaseapp.com",
  databaseURL: "https://thefelt-136e9-default-rtdb.firebaseio.com",
  projectId: "thefelt-136e9",
  storageBucket: "thefelt-136e9.firebasestorage.app",
  messagingSenderId: "693850023801",
  appId: "1:693850023801:web:aef85437fa7705aad871a8"
};

let db = null; // Firebase database reference

function initFirebase() {
  try {
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.database();
    return true;
  } catch(e) {
    console.warn("Firebase init failed:", e);
    return false;
  }
}

// ── PERSISTENCE ────────────────────────────────
// loadData() — keeps backwards compat for all the call sites
// Just ensures allData is populated; real data comes from Firebase on init/login
function loadData() {
  // allData is already populated from Firebase on startup and after every write
  // Only fall back to localStorage if allData is genuinely empty
  if (!allData || (!Object.keys(allData.users || {}).length && !(allData.games || []).length)) {
    loadFromLocal();
  }
}

async function loadDataFromFirebase() {
  if (!db) { loadFromLocal(); return; }
  try {
    const snap = await db.ref("/").get();
    if (snap.exists()) {
      const val = snap.val() || {};
      allData = {
        users: val.users || {},
        games: val.games ? Object.values(val.games) : [],
        quotes: val.quotes || null
      };
    } else {
      allData = { users: {}, games: [] };
    }
    // Keep localStorage in sync
    localStorage.setItem("thefelt_data", JSON.stringify(allData));
  } catch(e) {
    console.warn("Firebase load failed, using local cache:", e);
    loadFromLocal();
  }
}

function loadFromLocal() {
  try {
    const raw = localStorage.getItem("thefelt_data");
    allData = raw ? JSON.parse(raw) : { users: {}, games: [] };
  } catch(e) {
    allData = { users: {}, games: [] };
  }
}

function saveData() {
  try { localStorage.setItem("thefelt_data", JSON.stringify(allData)); } catch(e) {}
}

async function fbSet(path, value) {
  if (!db) return;
  await db.ref(path).set(value);
}

async function fbUpdate(path, value) {
  if (!db) return;
  await db.ref(path).update(value);
}

async function fbRemove(path) {
  if (!db) return;
  await db.ref(path).remove();
}

function fbWatch(path, callback) {
  if (!db) return () => {};
  const ref = db.ref(path);
  ref.on("value", snap => callback(snap.exists() ? snap.val() : null));
  return () => ref.off("value");
}

// ── INIT ───────────────────────────────────────
(async function init() {
  // 1. Initialise Firebase
  initFirebase();

  // 2. Watch for live game updates
  fbWatch("liveGame", onLiveGameUpdate);

  // 3. Load all data from Firebase (awaited on startup)
  await loadDataFromFirebase();

  // 4. Seed on first launch if empty
  await maybeSeedData();

  // 5. Restore session
  try {
    const uid = localStorage.getItem("thefelt_user");
    if (uid && allData.users[uid]) {
      currentUser = allData.users[uid];
      enterApp();
    }
  } catch(e) {}

  // 6. Keyboard shortcuts
  const liveCashoutInput = document.getElementById("live-cashout-amount");
  if (liveCashoutInput) liveCashoutInput.addEventListener("keydown", e => { if (e.key === "Enter") confirmLiveCashout(); });
  const rebuyInput = document.getElementById("rebuy-amount");
  if (rebuyInput) rebuyInput.addEventListener("keydown", e => { if (e.key === "Enter") confirmRebuy(); });
})();

// ── SEED DATA (runs once on first load if DB is empty) ──
async function maybeSeedData() {
  if (!db) return;
  const hasUsers = Object.keys(allData.users || {}).length > 0;
  const hasGames = (allData.games || []).length > 0;
  if (hasUsers && hasGames) return; // already seeded

  const users = [
    { id:"seed_u1", email:"dylan.r.minto@gmail.com", realname:"Dylan",      username:"Limpy",      password:btoa("poker123") },
    { id:"seed_u2", email:"shortstack@thefelt.app",  realname:"James O'Sullivan",  username:"JacksOffSuit", password:btoa("poker123") },
    { id:"seed_u3", email:"riverrat@thefelt.app",    realname:"Mike Brennan",      username:"RiverRat",   password:btoa("poker123") },
    { id:"seed_u4", email:"acehigh@thefelt.app",     realname:"Connor Walsh",      username:"AceHigh",    password:btoa("poker123") },
    { id:"seed_u5", email:"bluffmaster@thefelt.app", realname:"Sarah Kelly",       username:"BluffMaster",password:btoa("poker123") },
  ];

  function calcSeed(entries) {
    const bals = entries.map(e => ({ u: e.userId, v: e.cashOut - e.buyIn }));
    const d = bals.filter(x => x.v < -0.005).map(x => ({...x}));
    const c = bals.filter(x => x.v > 0.005).map(x => ({...x}));
    d.sort((a,b) => a.v - b.v); c.sort((a,b) => b.v - a.v);
    const t = []; let i = 0, j = 0;
    while (i < d.length && j < c.length) {
      const amt = Math.min(-d[i].v, c[j].v);
      if (amt > 0.005) t.push({ from: d[i].u, to: c[j].u, amount: Math.round(amt * 100) / 100 });
      d[i].v += amt; c[j].v -= amt;
      if (Math.abs(d[i].v) < 0.005) i++;
      if (Math.abs(c[j].v) < 0.005) j++;
    }
    return t;
  }

  const games = [
    {
      id:"seed_g1", date:"2026-02-14", name:"Valentine's Day Massacre",
      entries:[
        {userId:"seed_u1",buyIn:100,cashOut:220},
        {userId:"seed_u2",buyIn:100,cashOut:30},
        {userId:"seed_u3",buyIn:100,cashOut:175},
        {userId:"seed_u4",buyIn:100,cashOut:50},
        {userId:"seed_u5",buyIn:100,cashOut:25},
      ]
    },
    {
      id:"seed_g2", date:"2026-03-07", name:"Friday Night Game",
      entries:[
        {userId:"seed_u1",buyIn:200,cashOut:350},
        {userId:"seed_u2",buyIn:100,cashOut:0},
        {userId:"seed_u3",buyIn:100,cashOut:75},
        {userId:"seed_u4",buyIn:100,cashOut:225},
        {userId:"seed_u5",buyIn:100,cashOut:0},
      ]
    },
    {
      id:"seed_g3", date:"2026-03-14", name:"Pi Day Poker",
      entries:[
        {userId:"seed_u1",buyIn:100,cashOut:50},
        {userId:"seed_u2",buyIn:100,cashOut:275},
        {userId:"seed_u3",buyIn:100,cashOut:150},
        {userId:"seed_u4",buyIn:100,cashOut:0},
        {userId:"seed_u5",buyIn:100,cashOut:25},
      ]
    },
  ].map(g => ({ ...g, settlement: calcSeed(g.entries) }));

  // Write to Firebase
  for (const u of users) {
    if (!allData.users[u.id]) await fbSet("users/" + u.id, u);
  }
  for (const g of games) {
    await fbSet("games/" + g.id, g);
  }

  // Reload so allData reflects seed
  await loadDataFromFirebase();
}

// ── UTILS ──────────────────────────────────────
function initials(name) {
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

// Renders username + real name stacked
function nameBlock(username, realname, size = "normal") {
  if (size === "sm") {
    return `<div style="display:flex;flex-direction:column;gap:1px;overflow:hidden;min-width:0">
      <span style="font-size:12px;color:#f5f0e8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${username}</span>
      ${realname ? `<span style="font-size:10px;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${realname}</span>` : ""}
    </div>`;
  }
  return `<div style="display:flex;flex-direction:column;gap:1px">
    <span style="font-size:14px;color:#f5f0e8">${username}</span>
    ${realname ? `<span style="font-size:11px;color:var(--text-dim)">${realname}</span>` : ""}
  </div>`;
}

function fmtNet(v) {
  if (Math.abs(v) < 0.005) return "$0.00";
  return (v > 0 ? "+$" : "-$") + Math.abs(v).toFixed(2);
}

function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2400);
}

function setLoading(btnId, loading, label) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? "..." : label;
}

// ── AUTH ───────────────────────────────────────
function switchAuthTab(tab) {
  document.getElementById("login-form").style.display = tab === "login" ? "block" : "none";
  document.getElementById("signup-form").style.display = tab === "signup" ? "block" : "none";
  document.querySelectorAll(".tab-btn").forEach((b, i) =>
    b.classList.toggle("active", (i === 0 && tab === "login") || (i === 1 && tab === "signup"))
  );
  document.getElementById("auth-hint").textContent =
    tab === "login" ? "Sign in with your email and password" : "Get the club password from your host";
}

async function doLogin() {
  const email = document.getElementById("login-email").value.trim().toLowerCase();
  const pass = document.getElementById("login-pass").value;
  const err = document.getElementById("login-err");
  err.style.display = "none";
  document.getElementById("login-btn").textContent = "...";
  document.getElementById("login-btn").disabled = true;
  await loadDataFromFirebase();
  document.getElementById("login-btn").textContent = "Deal Me In";
  document.getElementById("login-btn").disabled = false;
  const user = Object.values(allData.users).find(u => u.email === email);
  if (!user || user.password !== btoa(pass)) {
    err.textContent = "Invalid email or password.";
    err.style.display = "block";
    return;
  }
  currentUser = user;
  localStorage.setItem("thefelt_user", user.id);
  enterApp();
}

async function doSignup() {
  const sitePass = document.getElementById("signup-site-pass").value;
  const email = document.getElementById("signup-email").value.trim().toLowerCase();
  const realname = document.getElementById("signup-realname").value.trim();
  const username = document.getElementById("signup-username").value.trim();
  const pass = document.getElementById("signup-pass").value;
  const err = document.getElementById("signup-err");
  err.style.display = "none";

  if (sitePass !== SITE_PASSWORD) {
    err.textContent = "Wrong club password. Ask your host.";
    err.style.display = "block"; return;
  }
  if (!email || !realname || !username || !pass) {
    err.textContent = "All fields are required.";
    err.style.display = "block"; return;
  }
  if (pass.length < 6) {
    err.textContent = "Password must be at least 6 characters.";
    err.style.display = "block"; return;
  }

  document.getElementById("signup-btn").textContent = "...";
  document.getElementById("signup-btn").disabled = true;
  await loadDataFromFirebase();

  if (Object.values(allData.users).find(u => u.email === email)) {
    err.textContent = "Email already registered.";
    err.style.display = "block";
    document.getElementById("signup-btn").textContent = "Claim My Seat";
    document.getElementById("signup-btn").disabled = false;
    return;
  }
  if (Object.values(allData.users).find(u => u.username.toLowerCase() === username.toLowerCase())) {
    err.textContent = "That table name is taken.";
    err.style.display = "block";
    document.getElementById("signup-btn").textContent = "Claim My Seat";
    document.getElementById("signup-btn").disabled = false;
    return;
  }

  const id = "u_" + Date.now();
  const user = { id, email, realname, username, password: btoa(pass) };
  allData.users[id] = user;

  // Save to Firebase
  try {
    await fbSet("users/" + user.id, user);
  } catch(e) { saveData(); }

  currentUser = user;
  localStorage.setItem("thefelt_user", id);
  document.getElementById("signup-btn").textContent = "Claim My Seat";
  document.getElementById("signup-btn").disabled = false;
  enterApp();
}

// ── RESET PASSWORD ─────────────────────────────
let resetTargetUser = null; // user found in step 1

function showResetForm(show = true) {
  document.getElementById("login-form").style.display = show ? "none" : "block";
  document.getElementById("reset-form").style.display = show ? "block" : "none";
  document.getElementById("signup-form").style.display = "none";
  // Reset state
  document.getElementById("reset-email").value = "";
  document.getElementById("reset-newpass") && (document.getElementById("reset-newpass").value = "");
  document.getElementById("reset-confirmpass") && (document.getElementById("reset-confirmpass").value = "");
  document.getElementById("reset-step2").style.display = "none";
  document.getElementById("reset-err").style.display = "none";
  document.getElementById("reset-btn").textContent = "Continue";
  document.getElementById("reset-btn").onclick = doResetStep;
  document.getElementById("auth-hint").textContent = show ? "Enter your registered email to reset your password" : "Sign in with your email and password";
  resetTargetUser = null;
}

function doResetStep() {
  const err = document.getElementById("reset-err");
  err.style.display = "none";

  // Step 1 — verify email exists
  if (!resetTargetUser) {
    const email = document.getElementById("reset-email").value.trim().toLowerCase();
    if (!email) { err.textContent = "Enter your email address."; err.style.display = "block"; return; }
    loadData();
    const user = Object.values(allData.users).find(u => u.email === email);
    if (!user) { err.textContent = "No account found with that email."; err.style.display = "block"; return; }
    resetTargetUser = user;
    document.getElementById("reset-step2").style.display = "block";
    document.getElementById("reset-email").disabled = true;
    document.getElementById("reset-btn").textContent = "Set New Password";
    document.getElementById("reset-btn").onclick = doResetPassword;
    setTimeout(() => document.getElementById("reset-newpass").focus(), 80);
    return;
  }
  doResetPassword();
}

async function doResetPassword() {
  const err = document.getElementById("reset-err");
  err.style.display = "none";
  const newPass = document.getElementById("reset-newpass").value;
  const confirm = document.getElementById("reset-confirmpass").value;
  if (!newPass || newPass.length < 6) { err.textContent = "Password must be at least 6 characters."; err.style.display = "block"; return; }
  if (newPass !== confirm) { err.textContent = "Passwords don't match."; err.style.display = "block"; return; }
  await loadData();
  if (!allData.users[resetTargetUser.id]) { err.textContent = "Account not found."; err.style.display = "block"; return; }
  allData.users[resetTargetUser.id].password = btoa(newPass);
  saveData();
  try { await fbSet("users/" + resetTargetUser.id, allData.users[resetTargetUser.id]); } catch(e) {}
  showToast("Password updated — please sign in");
  showResetForm(false);
  resetTargetUser = null;
}

function logout() {
  currentUser = null;
  localStorage.removeItem("thefelt_user");
  document.getElementById("landing").classList.add("active");
  document.getElementById("app").classList.remove("active");
}

function enterApp() {
  document.getElementById("landing").classList.remove("active");
  document.getElementById("app").classList.add("active");
  document.getElementById("topbar-username").textContent = currentUser.username;
  document.getElementById("topbar-avatar").textContent = initials(currentUser.username);
  activeGame = { date: new Date().toISOString().split("T")[0], name: "", entries: [] };
  document.getElementById("admin-tab").style.display = isAdmin() ? "block" : "none";
  switchTab("dashboard", document.querySelector(".nav-item"));
}

// ── TABS ───────────────────────────────────────
function switchTab(tab, el) {
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  if (el) el.classList.add("active");
  ["dashboard", "live", "history", "profile", "stats", "admin"].forEach(t => {
    document.getElementById("tab-" + t).style.display = t === tab ? "block" : "none";
  });
  if (tab === "dashboard") renderDashboard();
  if (tab === "live") renderLiveTab();
  if (tab === "history") renderHistory();
  if (tab === "profile") renderProfile();
  if (tab === "stats") renderStats();
  if (tab === "admin") renderAdmin();
}

// ── DASHBOARD ──────────────────────────────────
const POKER_QUOTES = [
  { text: "Poker is a skill game pretending to be a chance game.", attr: "James Altucher" },
  { text: "The cardinal sin in poker is going bust.", attr: "Al Alvarez" },
  { text: "In poker, you're not playing the cards — you're playing the people.", attr: "Daniel Negreanu" },
  { text: "Fold and live to fold again.", attr: "Stu Ungar" },
  { text: "Poker is war. People pretend it's a game.", attr: "Doyle Brunson" },
  { text: "Limit poker is a science, but no-limit is an art.", attr: "Jack Straus" },
  { text: "If there weren't luck involved, I would win every time.", attr: "Phil Hellmuth" },
  { text: "I never go looking for a sucker. I look for a champion and make a sucker of him.", attr: "Canada Bill Jones" },
  { text: "The chips in front of you are just the score. The game is everything else.", attr: "Anonymous" },
  { text: "Poker doesn't build character — it reveals it.", attr: "Anonymous" },
  { text: "Aggression without discipline is just donation.", attr: "Anonymous" },
  { text: "Tonight someone at this table makes a decision they'll think about for a week. Make sure it isn't you.", attr: "Anonymous" },
  { text: "Every hand is a battle. Every session is a war.", attr: "Anonymous" },
  { text: "Poker is a hard way to make an easy living.", attr: "Doyle Brunson" },
  { text: "The dangerous player is not the one with the best cards — it's the one with the clearest mind.", attr: "Anonymous" },
  { text: "You can shear a sheep many times, but skin it only once.", attr: "Amarillo Slim" },
  { text: "All the money you win at poker was someone else's plan.", attr: "Anonymous" },
  { text: "A man with money is no match against a man on a mission.", attr: "Doyle Brunson" },
  { text: "The strongest move at the table is knowing when you're beat.", attr: "Anonymous" },
  { text: "Trust your reads. Doubt your ego.", attr: "Anonymous" },
  { text: "There is more to poker than life.", attr: "Tom McEvoy" },
  { text: "The goal is not to win the hand — it's to win the session.", attr: "Anonymous" },
  { text: "Show me a good loser and I'll show you a loser.", attr: "Stu Ungar" },
  { text: "Nobody is always a winner, and anybody who says he is, is either a liar or doesn't play poker.", attr: "Amarillo Slim" },
  { text: "The best hand is the one you never had to show.", attr: "Anonymous" },
  { text: "Position is power. Act accordingly.", attr: "Anonymous" },
  { text: "Scared money never wins.", attr: "Anonymous" },
  { text: "Even a fish won't get caught if it keeps its mouth shut.", attr: "Anonymous" },
  { text: "The mark of a great poker player is making the right decision when the wrong one feels easier.", attr: "Anonymous" },
  { text: "The best bluff is the one you never had to make.", attr: "Anonymous" },
];

function getDailyQuote() {
  const pool = (allData.quotes && allData.quotes.length) ? allData.quotes : POKER_QUOTES;
  const now = new Date();
  const seed = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  return pool[seed % pool.length];
}

function renderDashboard() {
  const el = document.getElementById("tab-dashboard");
  loadData();
  const games = allData.games || [];
  // Sort by date descending, most recent first
  const sorted = [...games].sort((a, b) => {
    const da = a.date || ""; const db2 = b.date || "";
    if (da > db2) return -1; if (da < db2) return 1;
    // Same date — use id as tiebreaker (live_ + timestamp)
    return (b.id || "").localeCompare(a.id || "");
  });
  const lastGame = sorted[0];
  const quote = getDailyQuote();

  let html = `
    <div class="g-card" style="border-color:rgba(201,168,76,0.25);background:rgba(0,0,0,0.15);margin-bottom:1.25rem">
      <div style="font-size:10px;color:var(--gold);letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;opacity:0.8">Quote of the Day</div>
      <div style="font-family:'Playfair Display',serif;font-size:16px;color:#f5f0e8;line-height:1.55;font-style:italic">"${quote.text}"</div>
      <div style="font-size:12px;color:var(--gold);margin-top:10px;opacity:0.75">— ${quote.attr}</div>
    </div>
  `;

  html += `<div class="section-title">Last Game Settlement</div>`;

  if (!lastGame) {
    html += '<div class="g-card"><div class="empty-state">No games played yet.</div></div>';
  } else {
    const s = lastGame.settlement || [];
    const gameLabel = lastGame.name ? `${lastGame.name}` : lastGame.date;
    const gameSub = lastGame.name ? lastGame.date : "";
    html += '<div class="g-card">';
    html += `<div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid rgba(201,168,76,0.1)">
      <div style="font-family:'Playfair Display',serif;font-size:15px;color:var(--gold)">${gameLabel}</div>
      ${gameSub ? `<div style="font-size:12px;color:var(--text-dim);margin-top:2px">${gameSub}</div>` : ""}
      <div style="font-size:11px;color:var(--text-dim);margin-top:3px">${s.length} transaction${s.length !== 1 ? "s" : ""} to settle</div>
    </div>`;
    if (!s.length) {
      html += '<div class="empty-state" style="padding:0.5rem 0">Everyone broke even!</div>';
    } else {
      s.forEach(t => {
        const fromUser = allData.users[t.from];
        const toUser = allData.users[t.to];
        const fromName = fromUser?.username || "?";
        const toName = toUser?.username || "?";
        const fromReal = fromUser?.realname || "";
        const toReal = toUser?.realname || "";
        html += `<div class="settle-row">
          <div class="avatar" style="width:24px;height:24px;font-size:9px">${initials(fromName)}</div>
          <div>
            <div style="font-size:13px;font-weight:500">${fromName}</div>
            ${fromReal ? `<div style="font-size:10px;color:var(--text-dim)">${fromReal}</div>` : ""}
          </div>
          <span class="arrow">→</span>
          <div class="avatar" style="width:24px;height:24px;font-size:9px;background:rgba(110,207,138,0.15);border-color:rgba(110,207,138,0.3)">${initials(toName)}</div>
          <div>
            <div style="font-size:13px;font-weight:500">${toName}</div>
            ${toReal ? `<div style="font-size:10px;color:var(--text-dim)">${toReal}</div>` : ""}
          </div>
          <span class="gold-badge" style="margin-left:auto">$${t.amount.toFixed(2)}</span>
        </div>`;
      });
    }
    html += "</div>";
  }

  el.innerHTML = html;
}

// ── NEW GAME ───────────────────────────────────
function renderGame() {
  const el = document.getElementById("tab-game");
  const activePlayers = activeGame.entries.filter(e => !e.cashedOut).length;
  const totalBuyIn = activeGame.entries.reduce((s, e) => s + e.buyIn, 0);
  const totalCashOut = activeGame.entries.reduce((s, e) => s + (e.cashedOut ? e.cashOut : 0), 0);

  let html = `<div class="section-title">New Game</div>`;

  if (activeGame.entries.length > 0) {
    html += `<div class="live-badge"><div class="live-dot"></div> Game in progress</div>`;
  }

  html += `<div class="g-card">
    <span class="g-label">Game Name <span style="color:var(--text-dim);font-size:10px">(optional — useful if playing multiple games in a day)</span></span>
    <input class="g-input" type="text" id="gname" placeholder='e.g. "Friday Night Game 1"' maxlength="40" value="${activeGame.name}" oninput="activeGame.name=this.value">
    <span class="g-label">Date</span>
    <input class="g-input" type="date" id="gdate" value="${activeGame.date}" onchange="activeGame.date=this.value">
  `;

  if (activeGame.entries.length > 0) {
    html += `<div class="pot-summary">
      <span style="color:var(--text-muted)">Total buy-in: <strong style="color:var(--text-primary)">$${totalBuyIn.toFixed(2)}</strong></span>
      <span style="color:var(--text-muted)">Cashed out: <strong style="color:var(--success)">$${totalCashOut.toFixed(2)}</strong></span>
    </div>`;

    html += `<div class="ge-label-row">
      <span class="ge-label">Player</span>
      <span class="ge-label" style="text-align:center">Buy-in ($)</span>
      <span class="ge-label" style="text-align:center">Cash-out ($)</span>
      <span class="ge-label"></span>
      <span class="ge-label"></span>
    </div>`;

    activeGame.entries.forEach((e, i) => {
      const u = allData.users[e.userId];
      const name = u?.username || "?";
      const isOut = e.cashedOut;
      const buyInInput = `<input class="g-input" style="margin-bottom:0;padding:5px 7px;font-size:12px;text-align:center" type="number" min="0" placeholder="0" value="${e.buyIn || ""}" ${isOut ? "disabled" : `oninput="activeGame.entries[${i}].buyIn=parseFloat(this.value)||0"`}>`;
      const cashOutInput = `<input class="g-input" style="margin-bottom:0;padding:5px 7px;font-size:12px;text-align:center;${isOut ? "color:var(--success);border-color:rgba(110,207,138,0.35);" : ""}" type="number" min="0" placeholder="—" value="${isOut ? e.cashOut : (e.cashOut || "")}" ${isOut ? "disabled" : `oninput="activeGame.entries[${i}].cashOut=parseFloat(this.value)||0"`}>`;
      const confirmBtn = isOut
        ? `<button class="icon-btn" style="color:var(--success);border-color:rgba(110,207,138,0.3)" onclick="undoCashout(${i})" title="Undo">↺</button>`
        : `<button class="icon-btn" style="color:var(--success);border-color:rgba(110,207,138,0.3)" onclick="confirmCashout(${i})" title="Confirm cash-out">✓</button>`;
      html += `<div class="player-game-row${isOut ? " cashed-out" : ""}">
        <div style="display:flex;align-items:center;gap:6px;overflow:hidden">
          <div class="avatar" style="width:22px;height:22px;font-size:9px${isOut ? ";opacity:0.5" : ""}">${initials(name)}</div>
          <span style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}</span>
          <span class="status-pill${isOut ? " out" : ""}">${isOut ? "out" : "in"}</span>
        </div>
        ${buyInInput}
        ${cashOutInput}
        ${confirmBtn}
        <button class="icon-btn remove-btn" onclick="removeEntry(${i})" title="Remove">✕</button>
      </div>`;
    });
  } else {
    html += '<div class="empty-state" style="padding:1rem 0">No players yet — add your crew below.</div>';
  }

  html += `<div style="display:flex;gap:8px;margin-top:0.75rem;flex-wrap:wrap;align-items:center">
    <button class="btn-sm" onclick="openPlayerModal()">+ Add player</button>`;

  if (activeGame.entries.length > 0) {
    const allCashedOut = activeGame.entries.length > 0 && activeGame.entries.every(e => e.cashedOut);
    html += `<button class="btn-sm" onclick="addRebuy()" style="color:var(--text-muted)">+ Re-buy</button>`;
    html += `<button class="btn-sm primary" style="margin-left:auto" onclick="saveGame()" ${!allCashedOut ? 'title="Cash out all players first"' : ""}>End &amp; Save ↗</button>`;
    html += `<button class="btn-sm danger" onclick="clearGame()">Clear</button>`;
  }

  html += "</div></div>";

  // Settlement preview
  html += `<div id="settlement-preview-wrap">`;
  if (activeGame.entries.some(e => e.cashedOut)) {
    const preview = buildSettlementPreview();
    if (preview.length) {
      html += `<div class="section-title" style="margin-top:1rem">Settlement Preview</div><div class="g-card"><div id="settlement-preview">`;
      preview.forEach(t => {
        html += `<div class="settle-row">
          <span style="font-weight:500">${allData.users[t.from]?.username || "?"}</span>
          <span class="arrow">→</span>
          <span style="font-weight:500">${allData.users[t.to]?.username || "?"}</span>
          <span class="gold-badge" style="margin-left:auto">$${t.amount.toFixed(2)}</span>
        </div>`;
      });
      html += `</div></div>`;
    } else {
      html += `<div id="settlement-preview"></div>`;
    }
  } else {
    html += `<div id="settlement-preview"></div>`;
  }
  html += `</div>`;

  el.innerHTML = html;
}

function buildSettlementPreview() {
  const cashedEntries = activeGame.entries.filter(e => e.cashedOut);
  if (cashedEntries.length < 2) return [];
  return calcSettlement(cashedEntries);
}

function removeEntry(i) {
  activeGame.entries.splice(i, 1);
  renderGame();
}

function confirmCashout(i) {
  const amount = activeGame.entries[i].cashOut;
  if (isNaN(amount) || amount < 0) {
    showToast("Enter a valid cash-out amount first");
    return;
  }
  activeGame.entries[i].cashedOut = true;
  renderGame();
  refreshSettlementPreview();
}

function refreshSettlementPreview() {
  const cashedEntries = activeGame.entries.filter(e => e.cashedOut);
  const previewEl = document.getElementById("settlement-preview");
  if (!previewEl) return;
  if (cashedEntries.length >= 2) {
    const txns = buildSettlementPreview();
    previewEl.innerHTML = txns.length
      ? txns.map(t => `<div class="settle-row">
          <span style="font-weight:500">${allData.users[t.from]?.username || "?"}</span>
          <span class="arrow">→</span>
          <span style="font-weight:500">${allData.users[t.to]?.username || "?"}</span>
          <span class="gold-badge" style="margin-left:auto">$${t.amount.toFixed(2)}</span>
        </div>`).join("")
      : "";
  } else {
    previewEl.innerHTML = "";
  }
}

function undoCashout(i) {
  activeGame.entries[i].cashedOut = false;
  activeGame.entries[i].cashOut = 0;
  renderGame();
}

function openPlayerModal() {
  loadData();
  const inGame = activeGame.entries.map(e => e.userId);
  const avail = Object.values(allData.users).filter(u => !inGame.includes(u.id));
  const el = document.getElementById("player-modal-list");
  if (!avail.length) {
    el.innerHTML = '<div class="empty-state">All registered players are in this game.<br>They can join at <strong style="color:var(--gold)">thefelt.app</strong></div>';
  } else {
    el.innerHTML = avail.map(u => `
      <div class="player-pick-row" onclick="addToGame('${u.id}')">
        <div class="avatar">${initials(u.username)}</div>
        <div>
          <div style="font-size:14px">${u.username}</div>
          <div style="font-size:11px;color:var(--text-dim)">${u.email}</div>
        </div>
      </div>
    `).join("");
  }
  document.getElementById("player-modal").classList.add("open");
}

function closePlayerModal() { document.getElementById("player-modal").classList.remove("open"); }

function addToGame(userId) {
  activeGame.entries.push({ userId, buyIn: 0, cashOut: 0, cashedOut: false });
  closePlayerModal();
  renderGame();
}

function addRebuy() {
  // Allows adding a player who already cashed out back in (re-buy)
  openPlayerModal();
}

// ── CASH OUT MODAL ─────────────────────────────
function openCashout(idx) {
  cashoutTargetIdx = idx;
  const e = activeGame.entries[idx];
  const u = allData.users[e.userId];
  document.getElementById("cashout-title").textContent = `Cash Out — ${u?.username || "Player"}`;
  document.getElementById("cashout-amount").value = "";
  document.getElementById("cashout-err").style.display = "none";
  document.getElementById("cashout-modal").classList.add("open");
  setTimeout(() => document.getElementById("cashout-amount").focus(), 100);
}

function closeCashoutModal() {
  document.getElementById("cashout-modal").classList.remove("open");
  cashoutTargetIdx = null;
}

function confirmCashout() {
  const amount = parseFloat(document.getElementById("cashout-amount").value);
  const errEl = document.getElementById("cashout-err");
  errEl.style.display = "none";
  if (isNaN(amount) || amount < 0) {
    errEl.textContent = "Enter a valid amount.";
    errEl.style.display = "block"; return;
  }
  if (cashoutTargetIdx === null) return;
  activeGame.entries[cashoutTargetIdx].cashOut = amount;
  activeGame.entries[cashoutTargetIdx].cashedOut = true;
  closeCashoutModal();
  renderGame();
}

// ── SETTLEMENT ─────────────────────────────────
function calcSettlement(entries) {
  const bals = entries.map(e => ({ userId: e.userId, bal: e.cashOut - e.buyIn }));
  const debtors = bals.filter(b => b.bal < -0.005).map(b => ({ ...b }));
  const creditors = bals.filter(b => b.bal > 0.005).map(b => ({ ...b }));
  debtors.sort((a, b) => a.bal - b.bal);
  creditors.sort((a, b) => b.bal - a.bal);
  const txns = []; let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amt = Math.min(-debtors[i].bal, creditors[j].bal);
    if (amt > 0.005) txns.push({ from: debtors[i].userId, to: creditors[j].userId, amount: Math.round(amt * 100) / 100 });
    debtors[i].bal += amt; creditors[j].bal -= amt;
    if (Math.abs(debtors[i].bal) < 0.005) i++;
    if (Math.abs(creditors[j].bal) < 0.005) j++;
  }
  return txns;
}

async function saveGame() {
  if (!activeGame.entries.length) { showToast("No players in this game"); return; }

  const notCashedOut = activeGame.entries.filter(e => !e.cashedOut).map(e => allData.users[e.userId]?.username);
  if (notCashedOut.length > 0) {
    showToast(`Still at the table: ${notCashedOut.join(", ")}`);
    return;
  }

  const entries = activeGame.entries.map(e => ({ userId: e.userId, buyIn: e.buyIn, cashOut: e.cashOut }));
  const totalIn = entries.reduce((s, e) => s + e.buyIn, 0);
  const totalOut = entries.reduce((s, e) => s + e.cashOut, 0);
  if (Math.abs(totalIn - totalOut) > 1.00) {
    showToast(`Buy-ins ($${totalIn.toFixed(2)}) ≠ cash-outs ($${totalOut.toFixed(2)})`);
    return;
  }

  loadData();
  if (!allData.games) allData.games = [];
  const newGame = {
    id: "g_" + Date.now(),
    date: activeGame.date,
    name: activeGame.name || "",
    entries,
    settlement: calcSettlement(entries)
  };
  allData.games.push(newGame);
  saveData();

  // Write to Firebase
  try { await fbSet("games/" + newGame.id, newGame); } catch(e) {}

  activeGame = { date: new Date().toISOString().split("T")[0], name: "", entries: [] };
  showToast("Game saved!");
  const nav = document.querySelectorAll(".nav-item");
  nav.forEach(n => n.classList.remove("active"));
  nav[0].classList.add("active");
  switchTab("dashboard", nav[0]);
}

function clearGame() {
  if (!confirm("Clear this game? All entries will be lost.")) return;
  activeGame = { date: new Date().toISOString().split("T")[0], name: "", entries: [] };
  renderGame();
}

// ── HISTORY ────────────────────────────────────
function renderHistory() {
  const el = document.getElementById("tab-history");
  loadData();
  const games = [...(allData.games || [])].sort((a, b) => {
    const da = a.date || ""; const db2 = b.date || "";
    if (da > db2) return -1; if (da < db2) return 1;
    return (b.id || "").localeCompare(a.id || "");
  });
  let html = `<div class="section-title">Game History</div>`;
  if (!games.length) {
    html += '<div class="g-card"><div class="empty-state">No games yet.</div></div>';
    el.innerHTML = html; return;
  }
  games.forEach(g => {
    const pot = g.entries.reduce((s, e) => s + e.buyIn, 0);
    const playerNames = g.entries.map(e => allData.users[e.userId]?.username || "?").join(", ");
    const displayName = g.name ? g.name : g.date;
    const subtitle = g.name ? g.date : "";
    html += `<div class="g-card" style="cursor:pointer" onclick="showGameDetail('${g.id}')">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-weight:500;font-size:14px">${displayName}</div>
          ${subtitle ? `<div style="font-size:11px;color:var(--gold-light);opacity:0.7;margin-top:1px">${subtitle}</div>` : ""}
          <div class="history-meta">${g.entries.length} players · ${g.settlement?.length || 0} transactions to settle</div>
        </div>
        <span class="chip">$${pot.toFixed(0)}</span>
      </div>
      <div style="font-size:11px;color:var(--text-dim);margin-top:6px">${playerNames}</div>
    </div>`;
  });
  el.innerHTML = html;
}

function showGameDetail(gid) {
  loadData();
  const g = allData.games.find(x => x.id === gid);
  if (!g) return;
  const results = g.entries.map(e => ({
    name: allData.users[e.userId]?.username || "?",
    buyIn: e.buyIn, cashOut: e.cashOut, net: e.cashOut - e.buyIn
  })).sort((a, b) => b.net - a.net);
  const s = g.settlement || [];
  let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
    <div>
      <div class="modal-title" style="margin-bottom:0">${g.name || g.date}</div>
      ${g.name ? `<div style="font-size:12px;color:var(--text-dim);margin-top:2px">${g.date}</div>` : ""}
    </div>
    ${isAdmin() ? `<button class="btn-sm danger" onclick="deleteGame('${g.id}')">Delete</button>` : ""}
  </div><div style="margin-bottom:1rem">`;

  results.forEach(r => {
    const cls = r.net > 0 ? "net-pos" : r.net < 0 ? "net-neg" : "net-zero";
    html += `<div class="ldb-row">
      <div class="avatar" style="width:24px;height:24px;font-size:9px">${initials(r.name)}</div>
      <div style="flex:1">
        <div style="font-size:13px">${r.name}</div>
        <div style="font-size:11px;color:var(--text-dim)">In: $${r.buyIn.toFixed(2)} → Out: $${r.cashOut.toFixed(2)}</div>
      </div>
      <div class="${cls}" style="font-size:13px">${fmtNet(r.net)}</div>
    </div>`;
  });

  html += `</div><div style="border-top:1px solid rgba(201,168,76,0.15);padding-top:1rem;margin-bottom:0.75rem;font-size:12px;color:var(--text-muted);letter-spacing:1px;text-transform:uppercase">Settlement · ${s.length} transaction${s.length !== 1 ? "s" : ""}</div>`;

  if (!s.length) {
    html += '<div class="empty-state" style="padding:0.5rem 0">Everyone broke even!</div>';
  } else {
    s.forEach(t => {
      const fromUser = allData.users[t.from];
      const toUser = allData.users[t.to];
      const fromName = fromUser?.username || "?";
      const toName = toUser?.username || "?";
      const fromReal = fromUser?.realname || "";
      const toReal = toUser?.realname || "";
      html += `<div class="settle-row">
        <div class="avatar" style="width:24px;height:24px;font-size:9px">${initials(fromName)}</div>
        <div>
          <div style="font-size:13px;font-weight:500">${fromName}</div>
          ${fromReal ? `<div style="font-size:10px;color:var(--text-dim)">${fromReal}</div>` : ""}
        </div>
        <span class="arrow">→</span>
        <div class="avatar" style="width:24px;height:24px;font-size:9px;background:rgba(110,207,138,0.15);border-color:rgba(110,207,138,0.3)">${initials(toName)}</div>
        <div>
          <div style="font-size:13px;font-weight:500">${toName}</div>
          ${toReal ? `<div style="font-size:10px;color:var(--text-dim)">${toReal}</div>` : ""}
        </div>
        <span class="gold-badge" style="margin-left:auto">$${t.amount.toFixed(2)}</span>
      </div>`;
    });
  }
  html += `<div class="modal-footer"><button class="btn-sm" onclick="closeDetailModal()">Close</button></div>`;
  document.getElementById("detail-modal-body").innerHTML = html;
  document.getElementById("detail-modal").classList.add("open");
}

function closeDetailModal() { document.getElementById("detail-modal").classList.remove("open"); }

async function deleteGame(gid) {
  if (!isAdmin()) { showToast("Admin access required"); return; }
  if (!confirm("Delete this game? This cannot be undone.")) return;
  await loadData();
  allData.games = allData.games.filter(g => g.id !== gid);
  saveData();
  try { await fbRemove("games/" + gid); } catch(e) {}
  closeDetailModal();
  showToast("Game deleted");
  renderHistory();
}

// ── PROFILE ────────────────────────────────────
function renderProfile() {
  const el = document.getElementById("tab-profile");
  loadData();
  const games = allData.games || [];
  let net = 0, gs = 0, wins = 0, bigWin = -Infinity, bigLoss = Infinity;
  games.forEach(g => {
    const e = g.entries.find(x => x.userId === currentUser.id);
    if (e) { const n = e.cashOut - e.buyIn; net += n; gs++; if (n > 0) wins++; if (n > bigWin) bigWin = n; if (n < bigLoss) bigLoss = n; }
  });
  if (gs === 0) { bigWin = 0; bigLoss = 0; }
  const netCls = net > 0 ? "pos" : net < 0 ? "neg" : "";

  el.innerHTML = `
    <div class="section-title">My Stats</div>
    <div class="g-card" style="display:flex;align-items:center;gap:12px;margin-bottom:1rem">
      <div class="avatar" style="width:48px;height:48px;font-size:18px;background:rgba(201,168,76,0.2);border-color:var(--gold)">${initials(currentUser.username)}</div>
      <div>
        <div style="font-size:18px;font-weight:500;color:var(--gold)">${currentUser.username}</div>
        ${currentUser.realname ? `<div style="font-size:13px;color:var(--text-primary)">${currentUser.realname}</div>` : ""}
        <div style="font-size:12px;color:var(--text-dim)">${currentUser.email}</div>
      </div>
    </div>
    <div class="stat-grid">
      <div class="stat-box"><div class="stat-label">Games</div><div class="stat-val">${gs}</div></div>
      <div class="stat-box"><div class="stat-label">Wins</div><div class="stat-val">${wins}</div></div>
      <div class="stat-box"><div class="stat-label">Lifetime net</div><div class="stat-val ${netCls}">${fmtNet(net)}</div></div>
      <div class="stat-box"><div class="stat-label">Win rate</div><div class="stat-val">${gs ? Math.round(wins / gs * 100) : 0}%</div></div>
    </div>
    <div class="stat-grid">
      <div class="stat-box"><div class="stat-label">Best session</div><div class="stat-val pos">${gs ? fmtNet(bigWin) : "—"}</div></div>
      <div class="stat-box"><div class="stat-label">Worst session</div><div class="stat-val neg">${gs ? fmtNet(bigLoss) : "—"}</div></div>
    </div>
  `;
}

// ── STATS (LEADERBOARD) ────────────────────────
function renderStats() {
  const el = document.getElementById("tab-stats");
  loadData();
  const users = Object.values(allData.users);
  const games = allData.games || [];

  const stats = users.map(u => {
    let net = 0, gs = 0, wins = 0;
    games.forEach(g => {
      const e = g.entries.find(x => x.userId === u.id);
      if (e) { const n = e.cashOut - e.buyIn; net += n; gs++; if (n > 0) wins++; }
    });
    return { ...u, net, games: gs, wins };
  }).sort((a, b) => b.net - a.net);

  const totalPot = games.reduce((s, g) => s + g.entries.reduce((ss, e) => ss + e.buyIn, 0), 0);

  let html = `
    <div class="section-title">Leaderboard</div>
    <div class="stat-grid">
      <div class="stat-box"><div class="stat-label">Games played</div><div class="stat-val">${games.length}</div></div>
      <div class="stat-box"><div class="stat-label">Total money played</div><div class="stat-val">$${totalPot.toFixed(0)}</div></div>
    </div>
    <div class="g-card">
  `;

  if (!stats.length) {
    html += '<div class="empty-state">No players yet.</div>';
  } else {
    stats.forEach((p, i) => {
      const cls = p.net > 0 ? "net-pos" : p.net < 0 ? "net-neg" : "net-zero";
      const isMe = p.id === currentUser.id;
      html += `<div class="ldb-row">
        <div class="rank-num">${i + 1}</div>
        <div class="avatar" style="${isMe ? "border-color:var(--gold);background:rgba(201,168,76,0.25)" : ""}">${initials(p.username)}</div>
        <div style="flex:1">
          <div class="ldb-name" style="${isMe ? "color:var(--gold)" : ""}">${p.username}${isMe ? " ★" : ""}</div>
          ${p.realname ? `<div style="font-size:11px;color:var(--text-dim)">${p.realname}</div>` : ""}
          <div class="ldb-sub">${p.games} games · ${p.wins} wins</div>
        </div>
        <div class="${cls}">${fmtNet(p.net)}</div>
      </div>`;
    });
  }
  html += "</div>";
  el.innerHTML = html;
}

// ── ADMIN ──────────────────────────────────────
function renderAdmin() {
  if (!isAdmin()) { showToast("Admin access required"); return; }
  const el = document.getElementById("tab-admin");
  loadData();
  const users = Object.values(allData.users);
  const games = allData.games || [];

  let html = `<div class="section-title">Admin Panel</div>`;

  // ── Players ──
  html += `<div class="section-title" style="font-size:16px;margin-bottom:0.75rem">Players (${users.length})</div>
    <div class="g-card" style="margin-bottom:1.25rem">`;
  if (!users.length) {
    html += '<div class="empty-state">No players registered.</div>';
  } else {
    const games = allData.games || [];
    users.forEach(u => {
      const isSelf = u.id === currentUser.id;
      let net = 0, gs = 0;
      games.forEach(g => {
        const e = g.entries.find(x => x.userId === u.id);
        if (e) { net += e.cashOut - e.buyIn; gs++; }
      });
      const netCls = net > 0 ? "color:#6ecf8a" : net < 0 ? "color:#e07070" : "color:var(--text-dim)";
      html += `<div class="ldb-row">
        <div class="avatar" style="width:28px;height:28px;font-size:10px">${initials(u.username)}</div>
        <div style="flex:1">
          <div style="font-size:13px;color:#f5f0e8">${u.username}${isSelf ? " <span style='font-size:10px;color:var(--text-dim)'>(you)</span>" : ""}</div>
          ${u.realname ? `<div style="font-size:12px;color:var(--text-primary)">${u.realname}</div>` : ""}
          <div style="font-size:11px;color:var(--text-dim)">${u.email} · ${gs} game${gs !== 1 ? "s" : ""} · <span style="${netCls}">${fmtNet(net)}</span></div>
        </div>
        ${isSelf ? "" : `<button class="btn-sm danger" style="padding:4px 10px;font-size:12px" onclick="removePlayer('${u.id}')">Remove</button>`}
      </div>`;
    });
  }
  html += `</div>`;

  el.innerHTML = html;
}

async function removePlayer(uid) {
  if (!isAdmin()) return;
  await loadData();
  const u = allData.users[uid];
  if (!u) return;
  const gamesPlayed = (allData.games || []).filter(g => g.entries.find(e => e.userId === uid)).length;
  const msg = `Remove ${u.username} (${u.email}) from the club?\n\nThey have played in ${gamesPlayed} game${gamesPlayed !== 1 ? "s" : ""}. Their game history will be preserved in records but their account will be deleted.\n\nThis cannot be undone.`;
  if (!confirm(msg)) return;
  delete allData.users[uid];
  saveData();
  try { await fbRemove("users/" + uid); } catch(e) {}
  showToast(`${u.username} removed`);
  renderAdmin();
}

function addQuote() {
  if (!isAdmin()) return;
  const text = document.getElementById("new-quote-text").value.trim();
  const attr = document.getElementById("new-quote-attr").value.trim() || "Anonymous";
  if (!text) { showToast("Enter a quote first"); return; }
  loadData();
  if (!allData.quotes) allData.quotes = POKER_QUOTES.map(q => ({ ...q }));
  allData.quotes.push({ text, attr });
  saveData();
  showToast("Quote added ✓");
  renderAdmin();
}

function deleteQuote(idx) {
  if (!isAdmin()) return;
  if (!confirm("Delete this quote?")) return;
  loadData();
  if (!allData.quotes) allData.quotes = POKER_QUOTES.map(q => ({ ...q }));
  allData.quotes.splice(idx, 1);
  saveData();
  showToast("Quote deleted");
  renderAdmin();
}

// ── LIVE GAME ───────────────────────────────────

// Called every time Firebase pushes an update
function onLiveGameUpdate(game) {
  liveGame = game;
  updateLiveDot();
  // If live tab is currently visible, re-render it
  const liveEl = document.getElementById("tab-live");
  if (liveEl && liveEl.style.display !== "none") renderLiveTab();
}

function updateLiveDot() {
  const dot = document.getElementById("live-dot");
  if (!dot) return;
  if (liveGame) {
    dot.style.display = "inline-block";
  } else {
    dot.style.display = "none";
  }
}

function renderLiveTab() {
  const el = document.getElementById("tab-live");
  if (!currentUser) return;

  if (!liveGame) {
    // No active game — show start form
    renderLiveStartForm(el);
    return;
  }

  // Active game exists — show the live tracker
  renderLiveTracker(el);
}

function renderLiveStartForm(el) {
  loadData();
  const users = Object.values(allData.users);
  let html = `
    <div class="section-title">Start Live Game</div>
    <div class="g-card">
      <span class="g-label">Game Name <span style="font-size:10px;color:var(--text-dim)">(optional)</span></span>
      <input class="g-input" type="text" id="lg-name" placeholder='e.g. "Saturday Night Game"' maxlength="40">
      <span class="g-label">Date</span>
      <input class="g-input" type="date" id="lg-date" value="${new Date().toISOString().split("T")[0]}">
      <span class="g-label">Starting buy-in per player ($)</span>
      <input class="g-input" type="number" min="0" id="lg-buyin" placeholder="e.g. 100">
      <span class="g-label">Select players</span>
      <div id="lg-player-select" style="margin-bottom:0.75rem">
        ${users.map(u => `
          <label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(201,168,76,0.08);cursor:pointer">
            <input type="checkbox" value="${u.id}" id="lgp-${u.id}" style="width:16px;height:16px;accent-color:var(--gold)">
            <div class="avatar" style="width:26px;height:26px;font-size:10px">${initials(u.username)}</div>
            <span style="font-size:14px">${u.username}</span>
          </label>
        `).join("")}
      </div>
      <button class="btn-sm primary" style="width:100%;padding:10px" onclick="startLiveGame()">Start Live Game ↗</button>
    </div>`;
  el.innerHTML = html;
}

async function startLiveGame() {
  loadData();
  const name = document.getElementById("lg-name").value.trim();
  const date = document.getElementById("lg-date").value;
  const buyInAmt = parseFloat(document.getElementById("lg-buyin").value) || 0;
  const checked = [...document.querySelectorAll("#lg-player-select input:checked")].map(i => i.value);

  if (!checked.length) { showToast("Select at least one player"); return; }

  const players = {};
  checked.forEach(uid => {
    players[uid] = {
      userId: uid,
      username: allData.users[uid]?.username || "?",
      totalBuyIn: buyInAmt,
      buyIns: buyInAmt > 0 ? [{ amount: buyInAmt, at: Date.now() }] : [],
      cashOut: 0,
      cashedOut: false
    };
  });

  const gameData = {
    id: "live_" + Date.now(),
    name: name || "",
    date,
    startedBy: currentUser.id,
    startedAt: Date.now(),
    players,
    active: true
  };

  try {
    await fbSet("liveGame", gameData);
    showToast("Live game started!");
    // Switch to live tab
    const navItems = document.querySelectorAll(".nav-item");
    navItems.forEach(n => n.classList.remove("active"));
    document.querySelector('[data-tab="live"]').classList.add("active");
  } catch (e) {
    showToast("Error starting game — check connection");
  }
}

function renderLiveTracker(el) {
  loadData();
  const g = liveGame;
  const players = g.players || {};
  const isStarter = g.startedBy === currentUser.id || isAdmin();
  const totalPot = Object.values(players).reduce((s, p) => s + (p.totalBuyIn || 0), 0);
  const cashedOut = Object.values(players).filter(p => p.cashedOut).reduce((s, p) => s + (p.cashOut || 0), 0);

  let html = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:0.75rem">
      <div class="live-badge"><div class="live-dot"></div> Live Game</div>
      ${g.name ? `<span style="font-family:'Playfair Display',serif;font-size:16px;color:var(--gold)">${g.name}</span>` : ""}
    </div>
    <div class="pot-summary" style="margin-bottom:1rem">
      <span style="color:var(--text-muted)">Total pot: <strong style="color:#f5f0e8">$${totalPot.toFixed(2)}</strong></span>
      <span style="color:var(--text-muted)">Cashed out: <strong style="color:#6ecf8a">$${cashedOut.toFixed(2)}</strong></span>
    </div>
    <div class="g-card" style="margin-bottom:1rem">
      <div style="display:grid;grid-template-columns:1fr 90px 80px 60px;gap:8px;margin-bottom:6px;align-items:end">
        <span class="ge-label">Player</span>
        <span class="ge-label" style="text-align:center">Total buy-in</span>
        <span class="ge-label" style="text-align:center">+ Buy-in</span>
        ${isStarter ? `<span class="ge-label" style="text-align:center">Cash Out</span>` : `<span class="ge-label"></span>`}
      </div>`;

  Object.values(players).forEach(p => {
    const uname = p.username || allData.users[p.userId]?.username || "?";
    const realname = allData.users[p.userId]?.realname || "";
    const ini = initials(uname);
    const buyIns = p.buyIns || [];

    if (p.cashedOut) {
      html += `
        <div style="display:grid;grid-template-columns:1fr 90px 80px 60px;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid rgba(201,168,76,0.08);opacity:0.6">
          <div style="display:flex;align-items:center;gap:6px;overflow:hidden">
            <div class="avatar" style="width:24px;height:24px;font-size:9px;opacity:0.5">${ini}</div>
            <div style="overflow:hidden;min-width:0">
              <div style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${uname}</div>
              ${realname ? `<div style="font-size:10px;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${realname}</div>` : ""}
            </div>
            ${p.userId === g.startedBy ? `<span style="font-size:10px;color:var(--gold);flex-shrink:0" title="Game owner">★</span>` : ""}
            <span class="status-pill out">out</span>
          </div>
          <span style="font-size:13px;color:#6ecf8a;text-align:center">$${(p.totalBuyIn||0).toFixed(0)}</span>
          <span></span>
          <div style="display:flex;justify-content:center">
            ${isStarter ? `<button class="icon-btn undo" onclick="liveUndoCashout('${p.userId}')" title="Undo">↺</button>` : ""}
          </div>
        </div>`;
    } else {
      html += `
        <div style="display:grid;grid-template-columns:1fr 90px 80px 60px;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid rgba(201,168,76,0.08)">
          <div style="display:flex;align-items:center;gap:6px;overflow:hidden">
            <div class="avatar" style="width:24px;height:24px;font-size:9px">${ini}</div>
            <div style="overflow:hidden;min-width:0">
              <div style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${uname}</div>
              ${realname ? `<div style="font-size:10px;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${realname}</div>` : ""}
              ${buyIns.length > 1 ? `<div style="font-size:10px;color:var(--text-dim)">${buyIns.length} buy-ins</div>` : ""}
            </div>
            ${p.userId === g.startedBy ? `<span style="font-size:10px;color:var(--gold);flex-shrink:0" title="Game owner">★</span>` : ""}
            <span class="status-pill">in</span>
          </div>
          <span style="font-size:14px;font-weight:500;color:#f5f0e8;text-align:center;white-space:nowrap">$${(p.totalBuyIn||0).toFixed(0)}</span>
          <div style="display:flex;justify-content:center">
            <button class="icon-btn" style="border-color:rgba(201,168,76,0.5);color:var(--gold);font-size:11px;width:auto;padding:0 8px" onclick="openRebuy('${p.userId}','${uname}')">+ Buy-in</button>
          </div>
          <div style="display:flex;justify-content:center">
            ${isStarter ? `<button class="icon-btn confirm" onclick="openLiveCashout('${p.userId}','${uname}')" title="Cash out">✓</button>` : ""}
          </div>
        </div>`;
    }
  });

  html += `</div>`;

  // Add player mid-game
  html += `<button class="btn-sm" style="margin-bottom:0.75rem" onclick="openLiveAddPlayer()">+ Add player</button>`;

  // Settlement preview
  const cashedPlayers = Object.values(players).filter(p => p.cashedOut);
  if (cashedPlayers.length >= 2) {
    const entries = Object.values(players).map(p => ({
      userId: p.userId,
      buyIn: p.totalBuyIn || 0,
      cashOut: p.cashOut || 0
    }));
    const txns = calcSettlement(entries.filter(e => {
      const pl = players[e.userId];
      return pl && pl.cashedOut;
    }));
    if (txns.length) {
      html += `<div class="section-title" style="margin-top:0.5rem;font-size:16px">Settlement Preview</div><div class="g-card" style="margin-bottom:1rem">`;
      txns.forEach(t => {
        const fromUser = allData.users[t.from];
        const toUser = allData.users[t.to];
        const fromName = players[t.from]?.username || fromUser?.username || "?";
        const toName = players[t.to]?.username || toUser?.username || "?";
        const fromReal = fromUser?.realname || "";
        const toReal = toUser?.realname || "";
        html += `<div class="settle-row">
          <div class="avatar" style="width:24px;height:24px;font-size:9px">${initials(fromName)}</div>
          <div>
            <div style="font-size:13px;font-weight:500">${fromName}</div>
            ${fromReal ? `<div style="font-size:10px;color:var(--text-dim)">${fromReal}</div>` : ""}
          </div>
          <span class="arrow">→</span>
          <div class="avatar" style="width:24px;height:24px;font-size:9px;background:rgba(110,207,138,0.15);border-color:rgba(110,207,138,0.3)">${initials(toName)}</div>
          <div>
            <div style="font-size:13px;font-weight:500">${toName}</div>
            ${toReal ? `<div style="font-size:10px;color:var(--text-dim)">${toReal}</div>` : ""}
          </div>
          <span class="gold-badge" style="margin-left:auto">$${t.amount.toFixed(2)}</span>
        </div>`;
      });
      html += `</div>`;
    }
  }

  // End game — only for starter
  if (isStarter) {
    const allOut = Object.values(players).every(p => p.cashedOut);
    html += `
      <div style="display:flex;gap:8px;margin-top:0.5rem">
        <button class="btn-sm primary" style="flex:1" onclick="endLiveGame()" ${!allOut ? 'title="Cash out all players first"' : ""}>
          End &amp; Save ↗
        </button>
        <button class="btn-sm danger" onclick="cancelLiveGame()">Cancel Game</button>
      </div>
      ${!allOut ? `<div style="font-size:11px;color:var(--text-dim);margin-top:6px;text-align:center">${Object.values(players).filter(p=>!p.cashedOut).length} player${Object.values(players).filter(p=>!p.cashedOut).length!==1?"s":""} still at the table</div>` : ""}`;
  } else {
    html += `<div style="font-size:12px;color:var(--text-dim);text-align:center;margin-top:0.5rem">Game started by ${allData.users[g.startedBy]?.username || "host"} · only they can end it</div>`;
  }

  el.innerHTML = html;
}

// ── RE-BUY MODAL ───────────────────────────────
function openRebuy(userId, username) {
  rebuyTargetId = userId;
  document.getElementById("rebuy-title").textContent = `Add Buy-in — ${username}`;
  const current = liveGame?.players?.[userId]?.totalBuyIn || 0;
  document.getElementById("rebuy-sub").textContent = `Current total: $${current.toFixed(0)}`;
  document.getElementById("rebuy-amount").value = "";
  document.getElementById("rebuy-err").style.display = "none";
  document.getElementById("rebuy-modal").classList.add("open");
  setTimeout(() => document.getElementById("rebuy-amount").focus(), 80);
}

function closeRebuyModal() {
  document.getElementById("rebuy-modal").classList.remove("open");
  rebuyTargetId = null;
}

async function confirmRebuy() {
  const amt = parseFloat(document.getElementById("rebuy-amount").value);
  const err = document.getElementById("rebuy-err");
  err.style.display = "none";
  if (isNaN(amt) || amt <= 0) { err.textContent = "Enter a valid amount."; err.style.display = "block"; return; }

  const current = liveGame?.players?.[rebuyTargetId]?.totalBuyIn || 0;
  const newTotal = current + amt;

  try {
    const buyIns = [...(liveGame?.players?.[rebuyTargetId]?.buyIns || []), { amount: amt, at: Date.now() }];
    await fbUpdate("liveGame/players/" + rebuyTargetId, { totalBuyIn: newTotal, buyIns });
    showToast(`+$${amt} buy-in added`);
    closeRebuyModal();
  } catch (e) {
    showToast("Error — check connection");
  }
}

// ── LIVE CASH-OUT ──────────────────────────────
function openLiveCashout(userId, username) {
  liveCashoutTargetId = userId;
  document.getElementById("live-cashout-title").textContent = `Cash Out — ${username}`;
  const buyIn = liveGame?.players?.[userId]?.totalBuyIn || 0;
  document.getElementById("live-cashout-sub").textContent = `Total buy-in: $${buyIn.toFixed(0)}`;
  document.getElementById("live-cashout-amount").value = "";
  document.getElementById("live-cashout-err").style.display = "none";
  document.getElementById("live-cashout-modal").classList.add("open");
  setTimeout(() => document.getElementById("live-cashout-amount").focus(), 80);
}

function closeLiveCashout() {
  document.getElementById("live-cashout-modal").classList.remove("open");
  liveCashoutTargetId = null;
}

async function confirmLiveCashout() {
  const amt = parseFloat(document.getElementById("live-cashout-amount").value);
  const err = document.getElementById("live-cashout-err");
  err.style.display = "none";
  if (isNaN(amt) || amt < 0) { err.textContent = "Enter a valid amount."; err.style.display = "block"; return; }
  try {
    await fbUpdate("liveGame/players/" + liveCashoutTargetId, { cashOut: amt, cashedOut: true });
    showToast("Cashed out ✓");
    closeLiveCashout();
  } catch (e) {
    showToast("Error — check connection");
  }
}

async function liveUndoCashout(userId) {
  try {
    await fbUpdate("liveGame/players/" + userId, { cashOut: 0, cashedOut: false });
    showToast("Cash-out undone");
  } catch (e) {
    showToast("Error — check connection");
  }
}

// ── ADD PLAYER MID-GAME ────────────────────────
function openLiveAddPlayer() {
  loadData();
  const inGame = Object.keys(liveGame?.players || {});
  const avail = Object.values(allData.users).filter(u => !inGame.includes(u.id));
  const el = document.getElementById("player-modal-list");
  if (!avail.length) {
    el.innerHTML = '<div class="empty-state">All players are already in this game.</div>';
  } else {
    el.innerHTML = avail.map(u => `
      <div class="player-pick-row" onclick="addPlayerToLiveGame('${u.id}')">
        <div class="avatar">${initials(u.username)}</div>
        <div>
          <div style="font-size:14px">${u.username}</div>
          <div style="font-size:11px;color:var(--text-dim)">${u.email}</div>
        </div>
      </div>
    `).join("");
  }
  document.getElementById("player-modal").classList.add("open");
}

async function addPlayerToLiveGame(userId) {
  loadData();
  const u = allData.users[userId];
  closePlayerModal();
  try {
    await fbSet("liveGame/players/" + userId, {
      userId,
      username: u.username,
      totalBuyIn: 0,
      buyIns: [],
      cashOut: 0,
      cashedOut: false
    });
    showToast(`${u.username} added to game`);
  } catch (e) {
    showToast("Error — check connection");
  }
}

// ── END / CANCEL LIVE GAME ─────────────────────
async function endLiveGame() {
  if (!liveGame) { showToast("No active game found"); return; }

  const players = liveGame.players || {};
  if (!Object.keys(players).length) { showToast("No players in this game"); return; }

  // Check all players cashed out
  const notOut = Object.values(players).filter(p => !p.cashedOut).map(p => p.username);
  if (notOut.length) { showToast(`Still at table: ${notOut.join(", ")}`); return; }

  const entries = Object.values(players).map(p => ({
    userId: p.userId,
    buyIn: parseFloat(p.totalBuyIn) || 0,
    cashOut: parseFloat(p.cashOut) || 0
  }));

  const totalIn  = entries.reduce((s, e) => s + e.buyIn, 0);
  const totalOut = entries.reduce((s, e) => s + e.cashOut, 0);

  // Warn but don't block if amounts don't balance exactly
  if (Math.abs(totalIn - totalOut) > 1) {
    const proceed = confirm(`Heads up: buy-ins ($${totalIn.toFixed(2)}) don't equal cash-outs ($${totalOut.toFixed(2)}). Difference of $${Math.abs(totalIn-totalOut).toFixed(2)}.\n\nSave anyway?`);
    if (!proceed) return;
  }

  const newGame = {
    id: liveGame.id || ("g_" + Date.now()),
    date: liveGame.date || new Date().toISOString().split("T")[0],
    name: liveGame.name || "",
    entries,
    settlement: calcSettlement(entries)
  };

  showToast("Saving…");

  try {
    await fbSet("games/" + newGame.id, newGame);
    await fbRemove("liveGame");
    // Update allData immediately so dashboard renders without waiting for Firebase
    if (!allData.games) allData.games = [];
    allData.games.push(newGame);
    localStorage.setItem("thefelt_data", JSON.stringify(allData));
    showToast("Game saved! ✓");
  } catch(e) {
    console.warn("Firebase save failed:", e);
    if (!allData.games) allData.games = [];
    allData.games.push(newGame);
    saveData();
    try { await fbRemove("liveGame"); } catch(e2) {}
    showToast("Game saved locally ✓");
  }

  const nav = document.querySelectorAll(".nav-item");
  nav.forEach(n => n.classList.remove("active"));
  nav[0].classList.add("active");
  switchTab("dashboard", nav[0]);
}

async function cancelLiveGame() {
  if (!confirm("Cancel this live game? All buy-in data will be lost.")) return;
  await fbRemove("liveGame");
  showToast("Game cancelled");
  renderLiveTab();
}

// ── END ──────────────────────────────────────
