// ═══════════════════════════════════════════════
//  THE FELT — Firebase Realtime Database
//  Used exclusively for the Live Game feature
// ═══════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, onValue, update, remove, get }
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

// ── LIVE GAME API ──────────────────────────────

// Start a new live game — overwrites any existing one
export function fbStartLiveGame(gameData) {
  return set(ref(db, "liveGame"), gameData);
}

// Listen to live game changes in real time
export function fbWatchLiveGame(callback) {
  const gameRef = ref(db, "liveGame");
  return onValue(gameRef, snapshot => {
    callback(snapshot.exists() ? snapshot.val() : null);
  });
}

// Add a buy-in to a player (last-write-wins)
export function fbAddBuyIn(userId, newTotal) {
  return update(ref(db, `liveGame/players/${userId}`), { totalBuyIn: newTotal });
}

// Mark a player as cashed out
export function fbCashOutPlayer(userId, cashOut) {
  return update(ref(db, `liveGame/players/${userId}`), {
    cashOut,
    cashedOut: true
  });
}

// Undo a cash-out
export function fbUndoCashOut(userId) {
  return update(ref(db, `liveGame/players/${userId}`), {
    cashOut: 0,
    cashedOut: false
  });
}

// Add a player to the live game mid-game
export function fbAddPlayerToLiveGame(userId, playerData) {
  return set(ref(db, `liveGame/players/${userId}`), playerData);
}

// End the live game — remove from Firebase after saving
export function fbEndLiveGame() {
  return remove(ref(db, "liveGame"));
}

// One-time read to check if a live game exists
export async function fbGetLiveGame() {
  const snapshot = await get(ref(db, "liveGame"));
  return snapshot.exists() ? snapshot.val() : null;
}
