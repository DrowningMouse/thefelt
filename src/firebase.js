// ═══════════════════════════════════════════════
//  THE FELT — Firebase Realtime Database
//  Handles: users, games, and live game sync
// ═══════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, get, onValue, update, remove }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAdo99TgIOc01oN67crUS1ECV7YCcMktcs",
  authDomain: "thefelt-136e9.firebaseapp.com",
  databaseURL: "https://thefelt-136e9-default-rtdb.firebaseio.com",
  projectId: "thefelt-136e9",
  storageBucket: "thefelt-136e9.firebasestorage.app",
  messagingSenderId: "693850023801",
  appId: "1:693850023801:web:aef85437fa7705aad871a8"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ── USERS & GAMES (shared across all devices) ──

export async function fbGetAllData() {
  const snapshot = await get(ref(db, "/"));
  if (!snapshot.exists()) return { users: {}, games: [] };
  const val = snapshot.val() || {};
  return {
    users: val.users || {},
    games: val.games ? Object.values(val.games) : [],
    quotes: val.quotes || null
  };
}

export function fbSaveUser(user) {
  return set(ref(db, `users/${user.id}`), user);
}

export function fbDeleteUser(uid) {
  return remove(ref(db, `users/${uid}`));
}

export function fbUpdateUser(uid, data) {
  return update(ref(db, `users/${uid}`), data);
}

export function fbSaveGame(game) {
  return set(ref(db, `games/${game.id}`), game);
}

export function fbDeleteGame(gid) {
  return remove(ref(db, `games/${gid}`));
}

export function fbSaveQuotes(quotes) {
  return set(ref(db, "quotes"), quotes);
}

// ── LIVE GAME (real-time) ──────────────────────

export function fbStartLiveGame(gameData) {
  return set(ref(db, "liveGame"), gameData);
}

export function fbWatchLiveGame(callback) {
  return onValue(ref(db, "liveGame"), snapshot => {
    callback(snapshot.exists() ? snapshot.val() : null);
  });
}

export async function fbAddBuyIn(userId, newTotal, buyIns) {
  return update(ref(db, `liveGame/players/${userId}`), { totalBuyIn: newTotal, buyIns });
}

export function fbCashOutPlayer(userId, cashOut) {
  return update(ref(db, `liveGame/players/${userId}`), { cashOut, cashedOut: true });
}

export function fbUndoCashOut(userId) {
  return update(ref(db, `liveGame/players/${userId}`), { cashOut: 0, cashedOut: false });
}

export function fbAddPlayerToLiveGame(userId, playerData) {
  return set(ref(db, `liveGame/players/${userId}`), playerData);
}

export function fbEndLiveGame() {
  return remove(ref(db, "liveGame"));
}

export async function fbGetLiveGame() {
  const snapshot = await get(ref(db, "liveGame"));
  return snapshot.exists() ? snapshot.val() : null;
}
