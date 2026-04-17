import { sfxMiss, sfxHit, sfxSunk, sfxAtomic, sfxWeaponReceived, sfxVictory, sfxDefeat, sfxReplay, startMusic } from './audio.js';
import { Bot, BOT_DELAY_MS } from './bot.js';

// ═══════════════════════════════════════════════════════════════
// BATAILLE NAVALE — app.js (v3)
// ═══════════════════════════════════════════════════════════════

const SHIPS_CONFIG = [
  { id: "carrier",    name: "Porte-avions", size: 5, emoji: "🛳️" },
  { id: "cruiser",   name: "Croiseur",      size: 4, emoji: "🚢" },
  { id: "destroyer", name: "Destroyer",     size: 3, emoji: "⛴️" },
  { id: "submarine", name: "Sous-marin",    size: 3, emoji: "🤿" },
  { id: "torpedo",   name: "Torpilleur",    size: 2, emoji: "🚤" },
];

const WEAPONS_CONFIG = {
  cross:  { id: "cross",  name: "Mine en croix",    icon: "💣" },
  random: { id: "random", name: "Frappe aléatoire", icon: "🎲" },
  atomic: { id: "atomic", name: "Bombe atomique",   icon: "☢️" },
};

const state = {
  pseudo: "", roomCode: "", role: null,
  ablyClient: null, channel: null, opponentPseudo: "",
  myGrid: Array(100).fill(null), myShips: {},
  selectedShip: null, orientation: "h", placedShips: new Set(),
  myTurn: false, opponentGrid: Array(100).fill(null),
  myGridState: Array(100).fill(null),
  weapons: { cross: 0, random: 0, atomic: 0 },
  selectedWeapon: "normal", turnCount: 0, nextWeaponIn: 0,
  score: { me: 0, opp: 0 }, myShipHP: {}, opponentSunk: [],
  placementConfirmed: false, opponentPlacementDone: false,
  // Bot
  vsBot: false, bot: null, botGrid: null, botShipHP: {},
};

function generateCode() { return Math.random().toString(36).substring(2,8).toUpperCase(); }
function idx(r,c) { return r*10+c; }
function toRC(i) { return { r: Math.floor(i/10), c: i%10 }; }

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s=>s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

function showNotif(msg, duration=2500) {
  const o=document.getElementById("notif-overlay");
  document.getElementById("notif-box").innerHTML=msg;
  o.classList.remove("hidden");
  setTimeout(()=>o.classList.add("hidden"),duration);
}

function showWeaponReceived(weaponId) {
  const w=WEAPONS_CONFIG[weaponId];
  const el=document.createElement("div");
  el.className="weapon-received";
  el.innerHTML=`🎁 Nouvelle arme !<br>${w.icon} ${w.name}`;
  document.body.appendChild(el);
  setTimeout(()=>el.remove(),3100);
}

// ── Cinématique navire coulé ──────────────────────────────────
function showShipSunk(shipId, isMine) {
  const ship = SHIPS_CONFIG.find(s=>s.id===shipId);
  if (!ship) return;
  const el = document.createElement("div");
  el.className = "ship-sunk-notif";
  if (isMine) {
    el.innerHTML = `💀 Ton ${ship.name} a été coulé !`;
    el.classList.add("sunk-mine");
  } else {
    el.innerHTML = `💥 ${ship.emoji} ${ship.name} ennemi coulé !`;
    el.classList.add("sunk-enemy");
  }
  document.body.appendChild(el);
  setTimeout(()=>el.remove(), 3500);
}

function rollNextWeaponDelay() { return Math.floor(Math.random()*6)+3; }

// ── ABLY ─────────────────────────────────────────────────────

async function connectAbly(clientId) {
  const ably=new Ably.Realtime({ authUrl:`/api/ably-token?clientId=${encodeURIComponent(clientId)}` });
  await new Promise((res,rej)=>{ ably.connection.once("connected",res); ably.connection.once("failed",rej); });
  state.ablyClient=ably;
}
function publish(event,data) { state.channel.publish(event,{...data,from:state.pseudo}); }

// ── ACCUEIL ──────────────────────────────────────────────────

document.getElementById("btn-create").addEventListener("click", async()=>{
  const pseudo=document.getElementById("input-pseudo").value.trim();
  if(!pseudo){showNotif("Entre ton pseudo d'abord ! 😅");return;}
  state.pseudo=pseudo; state.role="host"; state.roomCode=generateCode();
  try{await connectAbly(pseudo);}catch(e){showNotif("Erreur de connexion 😬");return;}
  state.channel=state.ablyClient.channels.get(`bataille-navale:${state.roomCode}`);
  subscribeChannel();
  document.getElementById("lobby-code").textContent=state.roomCode;
  showScreen("screen-lobby");
});

document.getElementById("btn-join").addEventListener("click", async()=>{
  const pseudo=document.getElementById("input-pseudo").value.trim();
  const code=document.getElementById("input-code").value.trim().toUpperCase();
  if(!pseudo){showNotif("Entre ton pseudo d'abord ! 😅");return;}
  if(!code||code.length!==6){showNotif("Entre un code valide (6 caractères) 🤔");return;}
  state.pseudo=pseudo; state.role="guest"; state.roomCode=code;
  try{await connectAbly(pseudo);}catch(e){showNotif("Erreur de connexion 😬");return;}
  state.channel=state.ablyClient.channels.get(`bataille-navale:${code}`);
  subscribeChannel();
  showScreen("screen-lobby");
  document.getElementById("lobby-code").textContent=code;
  document.querySelector(".lobby-container h2").textContent="🎯 Connexion en cours...";
  setTimeout(()=>publish("join",{pseudo}),500);
});

// ── BOT MODE ─────────────────────────────────────────────────

document.getElementById("btn-vs-bot").addEventListener("click", () => {
  const pseudo = document.getElementById("input-pseudo").value.trim();
  if (!pseudo) { showNotif("Entre ton pseudo d'abord ! 😅"); return; }
  state.pseudo = pseudo;
  showScreen("screen-bot-level");
});

["easy", "medium", "hard"].forEach(level => {
  document.getElementById(`btn-level-${level}`).addEventListener("click", () => {
    state.vsBot = true;
    state.role = "host";
    state.opponentPseudo = level === "easy" ? "🤖 Robot (Facile)" : level === "medium" ? "🧠 Robot (Moyen)" : "💀 Robot (Difficile)";
    state.bot = new Bot(level);
    const { grid, ships } = Bot.placeShips(SHIPS_CONFIG);
    state.botGrid = grid;
    state.botShipHP = {};
    SHIPS_CONFIG.forEach(s => { state.botShipHP[s.id] = s.size; });
    startPlacement();
  });
});

document.getElementById("btn-copy-code").addEventListener("click",()=>{
  const link=`${window.location.origin}${window.location.pathname}?code=${state.roomCode}`;
  navigator.clipboard.writeText(link).then(()=>showNotif("📋 Lien copié !"));
});

window.addEventListener("load",()=>{
  const params=new URLSearchParams(window.location.search);
  const code=params.get("code");
  if(code) document.getElementById("input-code").value=code.toUpperCase();
});

// ── ABONNEMENTS ───────────────────────────────────────────────

function subscribeChannel() {
  const ch=state.channel;

  ch.subscribe("join",(msg)=>{
    if(state.role!=="host") return;
    state.opponentPseudo=msg.data.pseudo;
    publish("welcome",{pseudo:state.pseudo});
    startPlacement();
  });

  ch.subscribe("welcome",(msg)=>{
    if(state.role!=="guest") return;
    state.opponentPseudo=msg.data.pseudo;
    startPlacement();
  });

  ch.subscribe("placement-done",(msg)=>{
    if(msg.data.from===state.pseudo) return;
    state.opponentPlacementDone=true;
    if(state.placementConfirmed && state.role==="host") {
      publish("game-start",{});
      startGame(true);
    }
  });

  ch.subscribe("game-start",(msg)=>{
    if(state.role!=="guest") return;
    startGame(false);
  });

  ch.subscribe("fire",(msg)=>{
    if(msg.data.from===state.pseudo) return;
    handleIncomingFire(msg.data);
  });

  ch.subscribe("fire-result",(msg)=>{
    if(msg.data.from===state.pseudo) return;
    handleFireResult(msg.data);
  });

  ch.subscribe("chat",(msg)=>{
    if(msg.data.from===state.pseudo) return;
    addChatMessage(msg.data.from,msg.data.text,false);
  });

  ch.subscribe("replay",(msg)=>{
    if(msg.data.from===state.pseudo) return;
    startPlacement();
  });

  ch.subscribe("disconnect",(msg)=>{
    if(msg.data.from===state.pseudo) return;
    showNotif("😢 Ton adversaire s'est déconnecté.<br>La page va se recharger...",4000);
    setTimeout(()=>location.reload(),4500);
  });
}

// ── PLACEMENT ─────────────────────────────────────────────────

function startPlacement() {
  state.placementConfirmed=false;
  state.opponentPlacementDone=false;
  state.opponentSunk=[];
  resetPlacementState();
  buildPlacementGrid();
  buildShipsList();
  showScreen("screen-placement");
}

function resetPlacementState() {
  state.myGrid=Array(100).fill(null);
  state.myShips={}; state.placedShips=new Set();
  state.selectedShip=null; state.orientation="h";
  document.getElementById("btn-rotate").textContent="🔄 Horizontal";
}

function buildShipsList() {
  const list=document.getElementById("ships-list"); list.innerHTML="";
  SHIPS_CONFIG.forEach(ship=>{
    const el=document.createElement("div");
    el.className="ship-item"; el.dataset.id=ship.id;
    el.innerHTML=`<div>
      <div class="ship-name">${ship.emoji} ${ship.name}</div>
      <div class="ship-size">${ship.size} cases</div>
      <div class="ship-visual">${'<div class="ship-square"></div>'.repeat(ship.size)}</div>
    </div>`;
    el.addEventListener("click",()=>selectShip(ship.id));
    list.appendChild(el);
  });
}

function selectShip(id) {
  if(state.placedShips.has(id)) return;
  state.selectedShip=id;
  document.querySelectorAll(".ship-item").forEach(el=>el.classList.toggle("selected",el.dataset.id===id));
}

document.getElementById("btn-rotate").addEventListener("click",()=>{
  state.orientation=state.orientation==="h"?"v":"h";
  document.getElementById("btn-rotate").textContent=state.orientation==="h"?"🔄 Horizontal":"🔄 Vertical";
});

document.getElementById("btn-random-place").addEventListener("click",()=>{
  randomPlaceAll(); updatePlacementGrid(); updateConfirmButton();
});

document.getElementById("btn-confirm-placement").addEventListener("click",()=>{
  if(state.placedShips.size<SHIPS_CONFIG.length) return;
  if(state.placementConfirmed) return;
  state.placementConfirmed=true;
  document.getElementById("btn-confirm-placement").textContent="⏳ En attente de l'adversaire...";
  document.getElementById("btn-confirm-placement").disabled=true;
  if (state.vsBot) {
    startGame(true); // joueur commence toujours
    return;
  }
  publish("placement-done",{});
  if(state.opponentPlacementDone && state.role==="host") {
    publish("game-start",{});
    startGame(true);
  }
});

function buildPlacementGrid() {
  const grid=document.getElementById("placement-grid"); grid.innerHTML="";
  for(let i=0;i<100;i++){
    const cell=document.createElement("div");
    cell.className="cell"; cell.dataset.idx=i;
    cell.addEventListener("click",()=>placeCellClick(i));
    cell.addEventListener("mouseenter",()=>placeCellHover(i));
    cell.addEventListener("mouseleave",()=>clearPreview());
    grid.appendChild(cell);
  }
}

function placeCellClick(i) {
  if(!state.selectedShip){showNotif("Sélectionne un bateau d'abord ! 🚢");return;}
  const ship=SHIPS_CONFIG.find(s=>s.id===state.selectedShip);
  const cells=getShipCells(i,ship.size,state.orientation);
  if(!cells||!canPlace(cells)) return;
  cells.forEach(ci=>{state.myGrid[ci]=state.selectedShip;});
  state.myShips[state.selectedShip]=cells.map(ci=>toRC(ci));
  state.placedShips.add(state.selectedShip);
  document.querySelector(`.ship-item[data-id="${state.selectedShip}"]`).classList.add("placed");
  state.selectedShip=null;
  document.querySelectorAll(".ship-item").forEach(el=>el.classList.remove("selected"));
  updatePlacementGrid(); updateConfirmButton();
}

function placeCellHover(i) {
  if(!state.selectedShip) return;
  clearPreview();
  const ship=SHIPS_CONFIG.find(s=>s.id===state.selectedShip);
  const cells=getShipCells(i,ship.size,state.orientation);
  if(!cells) return;
  const valid=canPlace(cells);
  cells.forEach(ci=>{
    const el=document.querySelector(`#placement-grid .cell[data-idx="${ci}"]`);
    if(el) el.classList.add(valid?"ship-preview":"ship-invalid");
  });
}

function clearPreview() {
  document.querySelectorAll("#placement-grid .cell").forEach(el=>el.classList.remove("ship-preview","ship-invalid"));
}

function getShipCells(startIdx,size,orientation) {
  const {r,c}=toRC(startIdx); const cells=[];
  for(let i=0;i<size;i++){
    const nr=r+(orientation==="v"?i:0);
    const nc=c+(orientation==="h"?i:0);
    if(nr>=10||nc>=10) return null;
    cells.push(idx(nr,nc));
  }
  return cells;
}

function canPlace(cells) { return cells.every(ci=>state.myGrid[ci]===null); }

function updatePlacementGrid() {
  document.querySelectorAll("#placement-grid .cell").forEach((el,i)=>{
    el.className="cell";
    if(state.myGrid[i]) el.classList.add("ship");
  });
}

function updateConfirmButton() {
  const btn=document.getElementById("btn-confirm-placement");
  btn.disabled=state.placedShips.size<SHIPS_CONFIG.length;
  if(!btn.disabled) btn.textContent="✅ Valider";
}

function randomPlaceAll() {
  state.myGrid=Array(100).fill(null); state.myShips={}; state.placedShips=new Set();
  SHIPS_CONFIG.forEach(ship=>{
    let placed=false,attempts=0;
    while(!placed&&attempts<500){
      attempts++;
      const orientation=Math.random()<0.5?"h":"v";
      const startIdx=Math.floor(Math.random()*100);
      const cells=getShipCells(startIdx,ship.size,orientation);
      if(!cells||!canPlace(cells)) continue;
      cells.forEach(ci=>{state.myGrid[ci]=ship.id;});
      state.myShips[ship.id]=cells.map(ci=>toRC(ci));
      state.placedShips.add(ship.id); placed=true;
    }
  });
  document.querySelectorAll(".ship-item").forEach(el=>{el.classList.add("placed");el.classList.remove("selected");});
  state.selectedShip=null;
}

// ── DÉMARRAGE DU JEU ─────────────────────────────────────────

function startGame(myTurnFirst) {
  state.myTurn=myTurnFirst;
  state.opponentGrid=Array(100).fill(null);
  state.myGridState=Array(100).fill(null);
  state.weapons={cross:0,random:0,atomic:0};
  state.selectedWeapon="normal"; state.turnCount=0;
  state.nextWeaponIn=rollNextWeaponDelay();
  state.myShipHP={}; state.opponentSunk=[];
  SHIPS_CONFIG.forEach(s=>{state.myShipHP[s.id]=s.size;});
  buildGameGrids(); buildWeaponList(); buildShipStatus();
  updateTurnIndicator(); updateScoreBar();
  document.getElementById("score-name-me").textContent=state.pseudo;
  document.getElementById("score-name-opp").textContent=state.opponentPseudo;
  showScreen("screen-game");
  startMusic();
}

// ── GRILLES ───────────────────────────────────────────────────

function buildGameGrids() {
  buildGrid("my-grid",false); buildGrid("opponent-grid",true);
  renderMyGrid(); renderOpponentGrid();
}

function buildGrid(id,clickable) {
  const grid=document.getElementById(id); grid.innerHTML="";
  for(let i=0;i<100;i++){
    const cell=document.createElement("div"); cell.className="cell"; cell.dataset.idx=i;
    if(clickable) cell.addEventListener("click",()=>fireAtCell(i));
    grid.appendChild(cell);
  }
}

function renderMyGrid() {
  document.querySelectorAll("#my-grid .cell").forEach((el,i)=>{
    el.className="cell";
    if(state.myGrid[i]) el.classList.add("ship");
    if(state.myGridState[i]==="hit") el.classList.add("hit");
    if(state.myGridState[i]==="miss") el.classList.add("miss");
  });
}

function renderOpponentGrid() {
  document.querySelectorAll("#opponent-grid .cell").forEach((el,i)=>{
    el.className="cell";
    if(state.opponentGrid[i]==="hit") el.classList.add("hit");
    if(state.opponentGrid[i]==="miss") el.classList.add("miss");
    if(state.opponentGrid[i]==="sunk") el.classList.add("sunk");
  });
}

// ── ARSENAL ───────────────────────────────────────────────────

function buildWeaponList() {
  const list=document.getElementById("weapon-list");
  list.innerHTML=`<div class="weapon-item normal-selected" data-weapon="normal" onclick="selectWeapon('normal')">
    <span class="weapon-icon">🔫</span>
    <div class="weapon-info"><div class="weapon-name">Tir normal</div></div>
  </div>`;
  Object.values(WEAPONS_CONFIG).forEach(w=>{
    const el=document.createElement("div");
    el.className="weapon-item"; el.dataset.weapon=w.id; el.style.opacity="0.4";
    el.onclick=()=>selectWeapon(w.id);
    el.innerHTML=`<span class="weapon-icon">${w.icon}</span>
      <div class="weapon-info"><div class="weapon-name">${w.name}</div></div>
      <span class="weapon-count" id="wcount-${w.id}">0</span>`;
    list.appendChild(el);
  });
}

window.selectWeapon=function(id){
  if(id!=="normal"&&state.weapons[id]<=0) return;
  state.selectedWeapon=id;
  document.querySelectorAll(".weapon-item").forEach(el=>{
    el.classList.remove("selected","normal-selected");
    if(el.dataset.weapon===id) el.classList.add(id==="normal"?"normal-selected":"selected");
  });
};

function updateWeaponCounts() {
  Object.keys(WEAPONS_CONFIG).forEach(id=>{
    const el=document.getElementById(`wcount-${id}`);
    if(el) el.textContent=state.weapons[id];
    const item=document.querySelector(`.weapon-item[data-weapon="${id}"]`);
    if(item) item.style.opacity=state.weapons[id]>0?"1":"0.4";
  });
}

function addWeapon(weaponId) { state.weapons[weaponId]++; updateWeaponCounts(); showWeaponReceived(weaponId); sfxWeaponReceived(); }

// ── TIRER ─────────────────────────────────────────────────────

function fireAtCell(i) {
  if(!state.myTurn){showNotif("C'est le tour de ton adversaire ! ⏳");return;}
  if(state.opponentGrid[i]!==null){showNotif("Tu as déjà tiré ici ! 🙄");return;}
  const weapon=state.selectedWeapon;
  let targets=getTargetCells(i,weapon).filter(ci=>state.opponentGrid[ci]===null);
  if(targets.length===0){showNotif("Toutes ces cases ont déjà été ciblées !");return;}
  if(weapon!=="normal"){
    state.weapons[weapon]--; updateWeaponCounts();
    if(state.weapons[weapon]<=0) selectWeapon("normal");
  }
  // Ne pas encore céder le tour — on attend le résultat
  if(weapon==="atomic") sfxAtomic();
  if (state.vsBot) {
    processBotDefense(targets, weapon);
    return;
  }
  publish("fire",{targets,weapon,mainTarget:i});
}

function getTargetCells(mainIdx,weapon) {
  if(weapon==="normal") return [mainIdx];
  if(weapon==="cross"){
    const {r,c}=toRC(mainIdx); const cells=[mainIdx];
    if(r>0) cells.push(idx(r-1,c)); if(r<9) cells.push(idx(r+1,c));
    if(c>0) cells.push(idx(r,c-1)); if(c<9) cells.push(idx(r,c+1));
    return cells;
  }
  if(weapon==="random"){
    const cells=new Set([mainIdx]); const available=[];
    for(let i=0;i<100;i++) if(i!==mainIdx&&state.opponentGrid[i]===null) available.push(i);
    shuffle(available);
    for(let i=0;i<Math.min(5,available.length);i++) cells.add(available[i]);
    return [...cells];
  }
  if(weapon==="atomic") return getAtomicCells(mainIdx);
  return [mainIdx];
}

// ── Losange option A — rayon 2, ~13 cases ────────────────────
// Pattern :
//   O
//  OOO
// OOOOO
//  OOO
//   O
function getAtomicCells(mainIdx) {
  const {r:cr,c:cc}=toRC(mainIdx);
  const cells=new Set();
  for(let r=0;r<10;r++){
    for(let c=0;c<10;c++){
      const dr=Math.abs(r-cr);
      const dc=Math.abs(c-cc);
      // Losange : |dr| + |dc| <= 2
      if(dr+dc<=2) cells.add(idx(r,c));
    }
  }
  return [...cells];
}

function shuffle(arr){
  for(let i=arr.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]]=[arr[j],arr[i]];
  }
}

// ── RÉCEPTION TIR ENNEMI ──────────────────────────────────────

function handleIncomingFire(data) {
  const {targets}=data; const results=[];
  const newlySunkShips=[];

  targets.forEach(ci=>{
    const shipId=state.myGrid[ci];
    if(shipId&&state.myGridState[ci]!=="hit"){
      state.myGridState[ci]="hit"; state.myShipHP[shipId]--;
      sfxHit();
      const sunk=state.myShipHP[shipId]<=0;
      if(sunk) newlySunkShips.push(shipId);
      results.push({idx:ci,result:"hit",shipId,sunk});
    } else if(!shipId&&state.myGridState[ci]===null){
      state.myGridState[ci]="miss";
      results.push({idx:ci,result:"miss",shipId:null,sunk:false});
      sfxMiss();
    }
  });

  renderMyGrid(); buildShipStatus();

  // Cinématique côté défenseur
  newlySunkShips.forEach(shipId=>{ showShipSunk(shipId, true); sfxSunk(); });

  const allSunk=SHIPS_CONFIG.every(s=>state.myShipHP[s.id]<=0);

  // Rejouer uniquement si la case PRINCIPALE (celle cliquée) est un hit
  const mainResult = results.find(r => r.idx === data.mainTarget);
  const anyHit = mainResult ? mainResult.result === "hit" : false;

  publish("fire-result",{results,gameOver:allSunk,anyHit,newlySunkShips});

  if(allSunk){endGame(false);return;}

  // L'adversaire rejoue si hit, sinon c'est mon tour
  if(!anyHit){
    state.myTurn=true;
    updateTurnIndicator();
  }
  // Si anyHit : l'adversaire continue, state.myTurn reste false
}

// ── RÉSULTATS DE MES TIRS ─────────────────────────────────────

function handleFireResult(data) {
  const {results,gameOver,anyHit,newlySunkShips}=data;

  results.forEach(r=>{
    if(r.result==="hit"){
      state.opponentGrid[r.idx]="hit";
    } else {
      state.opponentGrid[r.idx]="miss";
    }
  });

  // Cinématique navires coulés côté attaquant
  if(newlySunkShips && newlySunkShips.length>0){
    newlySunkShips.forEach(shipId=>{
      if(!state.opponentSunk.includes(shipId)){
        state.opponentSunk.push(shipId);
        showShipSunk(shipId, false);
      }
    });
  }

  renderOpponentGrid();
  if(gameOver){endGame(true);return;}

  // Distribution d'arme (seulement quand le tour change vraiment)
  if(!anyHit){
    state.turnCount++; state.nextWeaponIn--;
    if(state.nextWeaponIn<=0){
      const keys=Object.keys(WEAPONS_CONFIG);
      addWeapon(keys[Math.floor(Math.random()*keys.length)]);
      state.nextWeaponIn=rollNextWeaponDelay();
    }
    // Mon tour est terminé, c'est l'adversaire
    state.myTurn=false;
  } else {
    // J'ai touché → je rejoue
    state.myTurn=true;
    showNotif("🎯 Touché ! Tu rejoues !", 1800);
  }

  updateTurnIndicator();
}

// ── TOUR ─────────────────────────────────────────────────────

function updateTurnIndicator() {
  const el=document.getElementById("turn-indicator");
  const txt=document.getElementById("turn-text");
  el.className="turn-indicator";
  if(state.myTurn){el.classList.add("my-turn");txt.textContent="🎯 À TOI DE TIRER !";}
  else{el.classList.add("opp-turn");txt.textContent=`⏳ ${state.opponentPseudo} tire...`;}
}

function buildShipStatus() {
  const container=document.getElementById("my-ships-status"); container.innerHTML="";
  SHIPS_CONFIG.forEach(ship=>{
    const sunk=state.myShipHP[ship.id]<=0;
    const el=document.createElement("div");
    el.className=`ship-status-item${sunk?" sunk-ship":""}`;
    el.innerHTML=`<div class="ship-status-dot${sunk?" sunk":""}"></div><span>${ship.emoji} ${ship.name}</span>`;
    container.appendChild(el);
  });
}

// ── CHAT ─────────────────────────────────────────────────────

document.getElementById("btn-send-chat").addEventListener("click",sendChat);
document.getElementById("chat-input").addEventListener("keydown",e=>{if(e.key==="Enter")sendChat();});
document.querySelectorAll(".emoji-btn").forEach(btn=>{
  btn.addEventListener("click",()=>{
    const emoji=btn.dataset.emoji;
    publish("chat",{text:emoji}); addChatMessage(state.pseudo,emoji,true);
  });
});

function sendChat(){
  const input=document.getElementById("chat-input"); const text=input.value.trim();
  if(!text) return;
  publish("chat",{text}); addChatMessage(state.pseudo,text,true); input.value="";
}

function addChatMessage(sender,text,isMe){
  const box=document.getElementById("chat-messages");
  const msg=document.createElement("div");
  msg.className=`chat-msg ${isMe?"me":"opponent"}`;
  msg.innerHTML=`<div class="sender">${sender}</div>${text}`;
  box.appendChild(msg); box.scrollTop=box.scrollHeight;
}

// ── FIN DE PARTIE ─────────────────────────────────────────────

// ── LOGIQUE BOT ───────────────────────────────────────────────

function processBotDefense(targets, weapon) {
  // Calculer les résultats sur la grille du bot
  const results = [];
  const newlySunkShips = [];

  targets.forEach(ci => {
    const shipId = state.botGrid[ci];
    if (shipId && state.opponentGrid[ci] === null) {
      state.opponentGrid[ci] = "hit";
      state.botShipHP[shipId]--;
      const sunk = state.botShipHP[shipId] <= 0;
      if (sunk) newlySunkShips.push(shipId);
      results.push({ idx: ci, result: "hit", shipId, sunk });
    } else if (!shipId && state.opponentGrid[ci] === null) {
      state.opponentGrid[ci] = "miss";
      results.push({ idx: ci, result: "miss", shipId: null, sunk: false });
    }
  });

  renderOpponentGrid();

  // Cinématique navires coulés
  newlySunkShips.forEach(shipId => {
    if (!state.opponentSunk.includes(shipId)) {
      state.opponentSunk.push(shipId);
      showShipSunk(shipId, false);
      sfxSunk();
    }
  });

  // Rejouer uniquement si la case PRINCIPALE est un hit
  const mainResult = results.find(r => r.idx === targets[0]);
  const anyHit = mainResult ? mainResult.result === "hit" : false;
  if (!anyHit) sfxMiss();
  else if (newlySunkShips.length === 0) sfxHit();

  // Vérifier victoire joueur
  const allBotSunk = SHIPS_CONFIG.every(s => state.botShipHP[s.id] <= 0);
  if (allBotSunk) { endGame(true); return; }

  // Distribution d'arme
  const givenWeapon = state.bot.tickWeapon();
  if (givenWeapon) { addWeapon(givenWeapon); }

  if (anyHit) {
    // Le joueur rejoue
    state.myTurn = true;
    showNotif("🎯 Touché ! Tu rejoues !", 1800);
    updateTurnIndicator();
  } else {
    // Tour du bot
    state.myTurn = false;
    updateTurnIndicator();
    setTimeout(doBotTurn, BOT_DELAY_MS);
  }
}

function doBotTurn() {
  if (!state.vsBot) return;

  // Le bot choisit son tir
  const { mainIdx, weapon, targets } = state.bot.decideShot(state.myGridState.map((v,i) => v));

  // Son atomique si applicable
  if (weapon === "atomic") sfxAtomic();

  // Calculer les résultats sur la grille du joueur
  const results = [];
  const newlySunkShips = [];
  const filteredTargets = targets.filter(ci => state.myGridState[ci] === null);

  filteredTargets.forEach(ci => {
    const shipId = state.myGrid[ci];
    if (shipId) {
      state.myGridState[ci] = "hit";
      state.myShipHP[shipId]--;
      sfxHit();
      const sunk = state.myShipHP[shipId] <= 0;
      if (sunk) newlySunkShips.push(shipId);
      results.push({ idx: ci, result: "hit", shipId, sunk });
    } else {
      state.myGridState[ci] = "miss";
      sfxMiss();
      results.push({ idx: ci, result: "miss", shipId: null, sunk: false });
    }
  });

  // Feedback au bot pour sa stratégie
  state.bot.processFeedback(filteredTargets, results, state.myGridState);

  renderMyGrid();
  buildShipStatus();

  // Cinématique navires coulés
  newlySunkShips.forEach(shipId => { showShipSunk(shipId, true); sfxSunk(); });

  // Vérifier défaite joueur
  const allPlayerSunk = SHIPS_CONFIG.every(s => state.myShipHP[s.id] <= 0);
  if (allPlayerSunk) { endGame(false); return; }

  // Le bot rejoue seulement si sa case principale était un hit
  const botMainResult = results.find(r => r.idx === mainIdx);
  const anyHit = botMainResult ? botMainResult.result === "hit" : false;

  if (anyHit) {
    // Bot rejoue
    showNotif(`⚠️ ${state.opponentPseudo} a touché ! Il rejoue...`, 1800);
    setTimeout(doBotTurn, BOT_DELAY_MS);
  } else {
    // Retour au joueur
    state.myTurn = true;
    updateTurnIndicator();
  }
}

function endGame(iWon){
  if(iWon){ state.score.me++; sfxVictory(); } else { state.score.opp++; sfxDefeat(); }
  document.getElementById("end-icon").textContent=iWon?"🏆":"💀";
  document.getElementById("end-title").textContent=iWon?"Victoire !":"Défaite !";
  document.getElementById("end-subtitle").textContent=iWon
    ?"Tu as coulé toute la flotte adverse ! Bravo !"
    :"Ta flotte a été anéantie... Courage !";
  document.getElementById("end-score-me").textContent=`${state.pseudo} : ${state.score.me}`;
  document.getElementById("end-score-opp").textContent=`${state.opponentPseudo} : ${state.score.opp}`;
  showScreen("screen-end");
}

document.getElementById("btn-replay").addEventListener("click",()=>{
  if (state.vsBot) {
    // Replacer les bateaux du bot
    const { grid, ships } = Bot.placeShips(SHIPS_CONFIG);
    state.botGrid = grid;
    state.botShipHP = {};
    SHIPS_CONFIG.forEach(s => { state.botShipHP[s.id] = s.size; });
    state.bot.reset();
    startPlacement();
    return;
  }
  publish("replay",{});
  startPlacement();
});

function updateScoreBar(){
  document.getElementById("score-val-me").textContent=state.score.me;
  document.getElementById("score-val-opp").textContent=state.score.opp;
}

window.addEventListener("beforeunload",()=>{if(state.channel) publish("disconnect",{});});
