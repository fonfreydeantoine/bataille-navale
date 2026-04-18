import { sfxMiss, sfxHit, sfxSunk, sfxAtomic, sfxWeaponReceived, sfxVictory, sfxDefeat, startMusic } from './audio.js';
import { Bot, BOT_DELAY_MS } from './bot.js';

// ═══════════════════════════════════════════════════════════════
// BATAILLE NAVALE — app.js (v5 — grille unique)
// ═══════════════════════════════════════════════════════════════

const SHIPS_CONFIG = [
  { id:"carrier",    name:"Porte-avions", size:5, emoji:"🛳️" },
  { id:"cruiser",   name:"Croiseur",      size:4, emoji:"🚢" },
  { id:"destroyer", name:"Destroyer",     size:3, emoji:"⛴️" },
  { id:"submarine", name:"Sous-marin",    size:3, emoji:"🤿" },
  { id:"torpedo",   name:"Torpilleur",    size:2, emoji:"🚤" },
];

const WEAPONS_CONFIG = {
  cross:  { id:"cross",  name:"Mine en croix",    icon:"💣" },
  random: { id:"random", name:"Frappe aléatoire", icon:"🎲" },
  atomic: { id:"atomic", name:"Bombe atomique",   icon:"☢️" },
};

const TOTAL_SHIP_CELLS = SHIPS_CONFIG.reduce((s,sh)=>s+sh.size,0); // 17

const state = {
  pseudo:"", roomCode:"", role:null,
  ablyClient:null, channel:null, opponentPseudo:"",
  // Grilles (index 0-99)
  myGrid:     Array(100).fill(null), // shipId ou null
  myShips:    {},
  myGridState:Array(100).fill(null), // "hit"|"miss"|null
  myShipHP:   {},
  opponentGrid:Array(100).fill(null), // "hit"|"miss"|"sunk"|null (ce qu'on connaît)
  opponentSunk:[],
  // Placement
  selectedShip:null, orientation:"h", placedShips:new Set(),
  // Jeu
  myTurn:false,
  weapons:{ cross:0, random:0, atomic:0 },
  selectedWeapon:"normal",
  turnCount:0, nextWeaponIn:0,
  score:{ me:0, opp:0 },
  placementConfirmed:false, opponentPlacementDone:false,
  // Timer
  timerInterval:null, timerSeconds:0,
  // Bot
  vsBot:false, bot:null, botGrid:null, botShipHP:{},
};

// ── Utilitaires ───────────────────────────────────────────────
function idx(r,c){ return r*10+c; }
function toRC(i){ return { r:Math.floor(i/10), c:i%10 }; }
function generateCode(){ return Math.random().toString(36).substring(2,8).toUpperCase(); }

function showScreen(id){
  document.querySelectorAll(".screen").forEach(s=>s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}
function showNotif(msg,duration=2500){
  const o=document.getElementById("notif-overlay");
  document.getElementById("notif-box").innerHTML=msg;
  o.classList.remove("hidden");
  setTimeout(()=>o.classList.add("hidden"),duration);
}
function showWeaponReceived(weaponId){
  const w=WEAPONS_CONFIG[weaponId];
  const el=document.createElement("div");
  el.className="weapon-received";
  el.innerHTML=`🎁 Nouvelle arme !<br>${w.icon} ${w.name}`;
  document.body.appendChild(el);
  setTimeout(()=>el.remove(),3100);
}
function showShipSunk(shipId, isMine){
  const ship=SHIPS_CONFIG.find(s=>s.id===shipId);
  if(!ship) return;
  const el=document.createElement("div");
  el.className="ship-sunk-notif";
  el.classList.add(isMine?"sunk-mine":"sunk-enemy");
  el.innerHTML=isMine?`💀 Ton ${ship.name} a été coulé !`:`💥 ${ship.emoji} ${ship.name} ennemi coulé !`;
  document.body.appendChild(el);
  setTimeout(()=>el.remove(),3500);
}
function rollNextWeaponDelay(){ return Math.floor(Math.random()*7)+8; } // 8-14 tours

// ── ABLY ──────────────────────────────────────────────────────
async function connectAbly(clientId){
  const ably=new Ably.Realtime({ authUrl:`/api/ably-token?clientId=${encodeURIComponent(clientId)}` });
  await new Promise((res,rej)=>{ ably.connection.once("connected",res); ably.connection.once("failed",rej); });
  state.ablyClient=ably;
}
function publish(event,data){ state.channel.publish(event,{...data,from:state.pseudo}); }

// ── ACCUEIL ───────────────────────────────────────────────────
document.getElementById("btn-create").addEventListener("click",async()=>{
  const pseudo=document.getElementById("input-pseudo").value.trim();
  if(!pseudo){ showNotif("Entre ton pseudo d'abord ! 😅"); return; }
  state.pseudo=pseudo; state.role="host"; state.roomCode=generateCode();
  try{ await connectAbly(pseudo); }catch(e){ showNotif("Erreur de connexion 😬"); return; }
  state.channel=state.ablyClient.channels.get(`bataille-navale:${state.roomCode}`);
  subscribeChannel();
  document.getElementById("lobby-code").textContent=state.roomCode;
  showScreen("screen-lobby");
});

document.getElementById("btn-join").addEventListener("click",async()=>{
  const pseudo=document.getElementById("input-pseudo").value.trim();
  const code=document.getElementById("input-code").value.trim().toUpperCase();
  if(!pseudo){ showNotif("Entre ton pseudo d'abord ! 😅"); return; }
  if(!code||code.length!==6){ showNotif("Entre un code valide (6 caractères) 🤔"); return; }
  state.pseudo=pseudo; state.role="guest"; state.roomCode=code;
  try{ await connectAbly(pseudo); }catch(e){ showNotif("Erreur de connexion 😬"); return; }
  state.channel=state.ablyClient.channels.get(`bataille-navale:${code}`);
  subscribeChannel();
  showScreen("screen-lobby");
  document.getElementById("lobby-code").textContent=code;
  document.querySelector(".lobby-container h2").textContent="🎯 Connexion en cours...";
  setTimeout(()=>publish("join",{pseudo}),500);
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

// ── BOT ───────────────────────────────────────────────────────
document.getElementById("btn-vs-bot").addEventListener("click",()=>{
  const pseudo=document.getElementById("input-pseudo").value.trim();
  if(!pseudo){ showNotif("Entre ton pseudo d'abord ! 😅"); return; }
  state.pseudo=pseudo;
  showScreen("screen-bot-level");
});

["easy","medium","hard"].forEach(level=>{
  document.getElementById(`btn-level-${level}`).addEventListener("click",()=>{
    state.vsBot=true; state.role="host";
    state.opponentPseudo=level==="easy"?"🤖 Robot (Facile)":level==="medium"?"🧠 Robot (Moyen)":"💀 Robot (Difficile)";
    state.bot=new Bot(level);
    const {grid,ships}=Bot.placeShips(SHIPS_CONFIG);
    state.botGrid=grid;
    state.botShipHP={};
    SHIPS_CONFIG.forEach(s=>{ state.botShipHP[s.id]=s.size; });
    startPlacement();
  });
});

// ── ABONNEMENTS ───────────────────────────────────────────────
function subscribeChannel(){
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
    if(state.placementConfirmed&&state.role==="host"){ publish("game-start",{}); startGame(true); }
  });
  ch.subscribe("game-start",()=>{ if(state.role!=="guest") return; startGame(false); });
  ch.subscribe("fire",(msg)=>{ if(msg.data.from===state.pseudo) return; handleIncomingFire(msg.data); });
  ch.subscribe("fire-result",(msg)=>{ if(msg.data.from===state.pseudo) return; handleFireResult(msg.data); });
  ch.subscribe("chat",(msg)=>{ if(msg.data.from===state.pseudo) return; addChatMessage(msg.data.from,msg.data.text,false); });
  ch.subscribe("replay",(msg)=>{ if(msg.data.from===state.pseudo) return; startPlacement(); });
  ch.subscribe("disconnect",(msg)=>{
    if(msg.data.from===state.pseudo) return;
    showNotif("😢 Ton adversaire s'est déconnecté.<br>La page va se recharger...",4000);
    setTimeout(()=>location.reload(),4500);
  });
}

// ── PLACEMENT ─────────────────────────────────────────────────
function startPlacement(){
  state.placementConfirmed=false;
  state.opponentPlacementDone=false;
  state.opponentSunk=[];
  state.myGrid=Array(100).fill(null);
  state.myShips={}; state.placedShips=new Set();
  state.selectedShip=null; state.orientation="h";
  document.getElementById("btn-rotate").textContent="🔄 Horizontal";
  buildShipsList();
  buildPlacementGrid();
  showScreen("screen-placement");
}

function buildShipsList(){
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

function selectShip(id){
  if(state.placedShips.has(id)) return;
  state.selectedShip=id;
  document.querySelectorAll(".ship-item").forEach(el=>el.classList.toggle("selected",el.dataset.id===id));
}

document.getElementById("btn-rotate").addEventListener("click",()=>{
  state.orientation=state.orientation==="h"?"v":"h";
  document.getElementById("btn-rotate").textContent=state.orientation==="h"?"🔄 Horizontal":"🔄 Vertical";
});
document.getElementById("btn-random-place").addEventListener("click",()=>{ randomPlaceAll(); updatePlacementGrid(); updateConfirmButton(); });

document.getElementById("btn-confirm-placement").addEventListener("click",()=>{
  if(state.placedShips.size<SHIPS_CONFIG.length) return;
  if(state.placementConfirmed) return;
  state.placementConfirmed=true;
  document.getElementById("btn-confirm-placement").textContent="⏳ En attente de l'adversaire...";
  document.getElementById("btn-confirm-placement").disabled=true;
  if(state.vsBot){ startGame(true); return; }
  publish("placement-done",{});
  if(state.opponentPlacementDone&&state.role==="host"){ publish("game-start",{}); startGame(true); }
});

function buildPlacementGrid(){
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

function placeCellClick(i){
  if(!state.selectedShip){ showNotif("Sélectionne un bateau d'abord ! 🚢"); return; }
  const ship=SHIPS_CONFIG.find(s=>s.id===state.selectedShip);
  const cells=getShipCells(i,ship.size,state.orientation);
  if(!cells||!canPlace(cells,null)) return;
  cells.forEach(ci=>{ state.myGrid[ci]=state.selectedShip; });
  state.myShips[state.selectedShip]=cells.map(ci=>toRC(ci));
  state.placedShips.add(state.selectedShip);
  document.querySelector(`.ship-item[data-id="${state.selectedShip}"]`).classList.add("placed");
  state.selectedShip=null;
  document.querySelectorAll(".ship-item").forEach(el=>el.classList.remove("selected"));
  updatePlacementGrid(); updateConfirmButton();
}

function placeCellHover(i){
  if(!state.selectedShip) return;
  clearPreview();
  const ship=SHIPS_CONFIG.find(s=>s.id===state.selectedShip);
  const cells=getShipCells(i,ship.size,state.orientation);
  if(!cells) return;
  const valid=canPlace(cells,null);
  cells.forEach(ci=>{
    const el=document.querySelector(`#placement-grid .cell[data-idx="${ci}"]`);
    if(el) el.classList.add(valid?"mine-preview":"mine-invalid");
  });
}
function clearPreview(){
  document.querySelectorAll("#placement-grid .cell").forEach(el=>el.classList.remove("mine-preview","mine-invalid"));
}

function getShipCells(startIdx,size,orientation){
  const {r,c}=toRC(startIdx); const cells=[];
  for(let i=0;i<size;i++){
    const nr=r+(orientation==="v"?i:0);
    const nc=c+(orientation==="h"?i:0);
    if(nr>=10||nc>=10) return null;
    cells.push(idx(nr,nc));
  }
  return cells;
}
function canPlace(cells){ return cells.every(ci=>state.myGrid[ci]===null); }

function updatePlacementGrid(){
  document.querySelectorAll("#placement-grid .cell").forEach((el,i)=>{
    el.className="cell";
    if(state.myGrid[i]) el.classList.add("mine");
  });
}
function updateConfirmButton(){
  const btn=document.getElementById("btn-confirm-placement");
  btn.disabled=state.placedShips.size<SHIPS_CONFIG.length;
  if(!btn.disabled) btn.textContent="✅ Valider";
}
function randomPlaceAll(){
  state.myGrid=Array(100).fill(null); state.myShips={}; state.placedShips=new Set();
  SHIPS_CONFIG.forEach(ship=>{
    let placed=false,attempts=0;
    while(!placed&&attempts<500){
      attempts++;
      const orientation=Math.random()<0.5?"h":"v";
      const startIdx=Math.floor(Math.random()*100);
      const cells=getShipCells(startIdx,ship.size,orientation);
      if(!cells||!canPlace(cells)) continue;
      cells.forEach(ci=>{ state.myGrid[ci]=ship.id; });
      state.myShips[ship.id]=cells.map(ci=>toRC(ci));
      state.placedShips.add(ship.id); placed=true;
    }
  });
  document.querySelectorAll(".ship-item").forEach(el=>{ el.classList.add("placed"); el.classList.remove("selected"); });
  state.selectedShip=null;
}

// ── DÉMARRAGE DU JEU ──────────────────────────────────────────
function startGame(myTurnFirst){
  state.myTurn=myTurnFirst;
  state.opponentGrid=Array(100).fill(null);
  state.myGridState=Array(100).fill(null);
  state.weapons={cross:0,random:0,atomic:0};
  state.selectedWeapon="normal";
  state.turnCount=0; state.nextWeaponIn=rollNextWeaponDelay();
  state.myShipHP={}; state.opponentSunk=[];
  SHIPS_CONFIG.forEach(s=>{ state.myShipHP[s.id]=s.size; });

  buildMainGrid();
  buildWeaponList();
  updateTurnIndicator();
  updateScoreBar();
  updateProgressBars();

  document.getElementById("score-name-me").textContent=state.pseudo;
  document.getElementById("score-name-opp").textContent=state.opponentPseudo;
  document.getElementById("label-me").textContent=state.pseudo;
  document.getElementById("label-opp").textContent=state.opponentPseudo;

  showScreen("screen-game");
  startMusic();
}

// ── GRILLE UNIQUE ──────────────────────────────────────────────
// La grille a 20 colonnes : 0-9 = ma flotte (gauche), 10-19 = flotte adverse (droite)
// Chaque case de la grille visuele mappe vers :
//   colonne visuelle 0-9  → index grille 0-99 (ma flotte)
//   colonne visuelle 10-19 → index grille 0-99 (flotte adverse)

function buildMainGrid(){
  const grid=document.getElementById("main-grid"); grid.innerHTML="";

  // Séparateur
  const divider=document.createElement("div");
  divider.className="grid-divider";
  grid.appendChild(divider);

  // 10 rangées × 20 colonnes = 200 cellules
  for(let r=0;r<10;r++){
    for(let col=0;col<20;col++){
      const cell=document.createElement("div");
      cell.className="cell";
      if(col<10){
        // Ma flotte
        const gi=idx(r,col);
        cell.dataset.side="me"; cell.dataset.gi=gi;
      } else {
        // Flotte adverse — cliquable
        const gi=idx(r,col-10);
        cell.dataset.side="opp"; cell.dataset.gi=gi;
        cell.classList.add("attackable");
        cell.addEventListener("click",()=>fireAtCell(gi));
      }
      grid.appendChild(cell);
    }
  }
  renderMainGrid();
}

function renderMainGrid(){
  document.querySelectorAll("#main-grid .cell").forEach(cell=>{
    const side=cell.dataset.side;
    const gi=parseInt(cell.dataset.gi);
    cell.className="cell";
    if(side==="opp") cell.classList.add("attackable");

    if(side==="me"){
      // Ma flotte
      if(state.myGrid[gi]) cell.classList.add("mine");
      const st=state.myGridState[gi];
      if(st==="hit"){
        const shipId=state.myGrid[gi];
        if(state.myShipHP[shipId]<=0) cell.classList.add("sunk-mine");
        else cell.classList.add("hit-mine");
      }
      if(st==="miss") cell.classList.add("miss");
    } else {
      // Flotte adverse
      const st=state.opponentGrid[gi];
      if(st==="hit") cell.classList.add("hit-opp");
      if(st==="miss") cell.classList.add("miss");
      if(st==="sunk") cell.classList.add("sunk-opp");
    }
  });
}

// ── TIMER ─────────────────────────────────────────────────────
function startTimer(){
  stopTimer();
  state.timerSeconds=30;
  updateTimerBar(30);
  state.timerInterval=setInterval(()=>{
    state.timerSeconds--;
    updateTimerBar(state.timerSeconds);
    if(state.timerSeconds<=0){ stopTimer(); autoFire(); }
  },1000);
}
function stopTimer(){
  if(state.timerInterval){ clearInterval(state.timerInterval); state.timerInterval=null; }
  updateTimerBar(0);
}
function updateTimerBar(seconds){
  const bar=document.getElementById("timer-bar");
  const label=document.getElementById("timer-label");
  if(!bar||!label) return;
  bar.style.width=(seconds/30*100)+"%";
  label.textContent=seconds>0?seconds+"s":"";
  bar.style.background=seconds>15?"var(--green)":seconds>8?"var(--yellow)":"var(--coral)";
}
function autoFire(){
  if(!state.myTurn) return;
  const available=[];
  for(let i=0;i<100;i++) if(state.opponentGrid[i]===null) available.push(i);
  if(available.length===0) return;
  const randIdx=available[Math.floor(Math.random()*available.length)];
  showNotif("⏰ Temps écoulé ! Tir automatique !",2000);
  const prev=state.selectedWeapon; state.selectedWeapon="normal";
  fireAtCell(randIdx);
  state.selectedWeapon=prev;
}

// ── TOUR ──────────────────────────────────────────────────────
function updateTurnIndicator(){
  const el=document.getElementById("turn-indicator");
  const txt=document.getElementById("turn-text");
  el.className="turn-indicator";
  if(state.myTurn){
    el.classList.add("my-turn"); txt.textContent="🎯 À TOI DE TIRER !";
    startTimer();
  } else {
    el.classList.add("opp-turn"); txt.textContent=`⏳ ${state.opponentPseudo} tire...`;
    stopTimer();
  }
}

// ── PROGRESSION ───────────────────────────────────────────────
function updateProgressBars(){
  // Ma flotte
  const myHit=state.myGridState.filter(v=>v==="hit").length;
  const myPct=(myHit/TOTAL_SHIP_CELLS)*100;
  const myEl=document.getElementById("prog-my-bar");
  const myLabel=document.getElementById("prog-my-label");
  const myShips=document.getElementById("prog-my-ships");
  if(myEl) myEl.style.width=myPct+"%";
  if(myLabel) myLabel.textContent=(TOTAL_SHIP_CELLS-myHit)+" cases";
  if(myShips){
    const mySunk=SHIPS_CONFIG.filter(s=>state.myShipHP[s.id]<=0).length;
    myShips.textContent="🚢".repeat(SHIPS_CONFIG.length-mySunk)+"💀".repeat(mySunk);
  }
  // Flotte adverse
  const oppHit=state.opponentGrid.filter(v=>v==="hit"||v==="sunk").length;
  const oppPct=(oppHit/TOTAL_SHIP_CELLS)*100;
  const oppEl=document.getElementById("prog-opp-bar");
  const oppLabel=document.getElementById("prog-opp-label");
  const oppShips=document.getElementById("prog-opp-ships");
  if(oppEl) oppEl.style.width=oppPct+"%";
  if(oppLabel) oppLabel.textContent=(TOTAL_SHIP_CELLS-oppHit)+" cases";
  if(oppShips){
    const oppSunk=state.opponentSunk.length;
    oppShips.textContent="🚢".repeat(SHIPS_CONFIG.length-oppSunk)+"💀".repeat(oppSunk);
  }
}

// ── ARSENAL ───────────────────────────────────────────────────
function buildWeaponList(){
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
function updateWeaponCounts(){
  Object.keys(WEAPONS_CONFIG).forEach(id=>{
    const el=document.getElementById(`wcount-${id}`);
    if(el) el.textContent=state.weapons[id];
    const item=document.querySelector(`.weapon-item[data-weapon="${id}"]`);
    if(item) item.style.opacity=state.weapons[id]>0?"1":"0.4";
  });
}
function addWeapon(weaponId){
  state.weapons[weaponId]++;
  updateWeaponCounts();
  showWeaponReceived(weaponId);
  sfxWeaponReceived();
}

// ── TIRER ─────────────────────────────────────────────────────
function fireAtCell(i){
  if(!state.myTurn){ showNotif("C'est le tour de ton adversaire ! ⏳"); return; }
  if(state.opponentGrid[i]!==null){ showNotif("Tu as déjà tiré ici ! 🙄"); return; }
  const weapon=state.selectedWeapon;
  let targets=getTargetCells(i,weapon).filter(ci=>state.opponentGrid[ci]===null);
  if(targets.length===0){ showNotif("Toutes ces cases ont déjà été ciblées !"); return; }
  if(weapon!=="normal"){ state.weapons[weapon]--; updateWeaponCounts(); if(state.weapons[weapon]<=0) selectWeapon("normal"); }
  if(weapon==="atomic") sfxAtomic();
  if(state.vsBot){ processBotDefense(targets,weapon,i); return; }
  publish("fire",{targets,weapon,mainTarget:i});
}

function getTargetCells(mainIdx,weapon){
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
  if(weapon==="atomic"){
    const {r:cr,c:cc}=toRC(mainIdx); const cells=new Set();
    for(let r=0;r<10;r++) for(let c=0;c<10;c++){
      if(Math.abs(r-cr)+Math.abs(c-cc)<=2) cells.add(idx(r,c));
    }
    return [...cells];
  }
  return [mainIdx];
}

function shuffle(arr){
  for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; }
}

// ── RÈGLE REJOUER ─────────────────────────────────────────────
// Rejoue si : case principale = hit ET pas coulé
function shouldReplay(mainTarget, results){
  const mainResult=results.find(r=>r.idx===mainTarget);
  if(!mainResult) return false;
  if(mainResult.result!=="hit") return false;
  if(mainResult.sunk) return false; // coulé = pas de rejouer
  return true;
}

// ── RÉCEPTION TIR ENNEMI ──────────────────────────────────────
function handleIncomingFire(data){
  const {targets,mainTarget}=data;
  const results=[]; const newlySunkShips=[];

  targets.forEach(ci=>{
    const shipId=state.myGrid[ci];
    if(shipId&&state.myGridState[ci]!=="hit"){
      state.myGridState[ci]="hit"; state.myShipHP[shipId]--;
      const sunk=state.myShipHP[shipId]<=0;
      if(sunk) newlySunkShips.push(shipId);
      results.push({idx:ci,result:"hit",shipId,sunk});
    } else if(!shipId&&state.myGridState[ci]===null){
      state.myGridState[ci]="miss";
      results.push({idx:ci,result:"miss",shipId:null,sunk:false});
    }
  });

  renderMainGrid(); updateProgressBars();
  newlySunkShips.forEach(shipId=>{ showShipSunk(shipId,true); sfxSunk(); });

  const allSunk=SHIPS_CONFIG.every(s=>state.myShipHP[s.id]<=0);
  const replay=shouldReplay(mainTarget,results);

  // Arme offerte si on coule un bateau
  newlySunkShips.forEach(()=>{
    const keys=Object.keys(WEAPONS_CONFIG);
    publish("weapon-for-opponent",{ weaponId:keys[Math.floor(Math.random()*keys.length)] });
  });

  publish("fire-result",{results,gameOver:allSunk,replay,newlySunkShips});

  if(allSunk){ endGame(false); return; }

  // Si l'adversaire rejoue, le tour reste à lui → moi je n'ai pas le tour
  if(!replay){
    state.myTurn=true; updateTurnIndicator();
  }
  // Si replay : l'adversaire continue, on attend
}

// ── RÉSULTATS DE MES TIRS ─────────────────────────────────────
function handleFireResult(data){
  const {results,gameOver,replay,newlySunkShips}=data;

  results.forEach(r=>{
    state.opponentGrid[r.idx]=r.sunk?"sunk":r.result==="hit"?"hit":"miss";
  });

  // Si navires coulés, marquer toutes leurs cases comme sunk
  if(newlySunkShips&&newlySunkShips.length>0){
    newlySunkShips.forEach(shipId=>{
      if(!state.opponentSunk.includes(shipId)){
        state.opponentSunk.push(shipId);
        showShipSunk(shipId,false); sfxSunk();
        // Arme bonus pour avoir coulé
        const keys=Object.keys(WEAPONS_CONFIG);
        addWeapon(keys[Math.floor(Math.random()*keys.length)]);
      }
    });
  }

  // Sons
  const mainHit=results.find(r=>r.result==="hit"&&results[0].idx===r.idx);
  const anyHitResult=results.some(r=>r.result==="hit");
  if(anyHitResult&&newlySunkShips.length===0) sfxHit();
  else if(!anyHitResult) sfxMiss();

  renderMainGrid(); updateProgressBars();
  if(gameOver){ endGame(true); return; }

  // Distribution d'arme par intervalle
  if(!replay){
    state.turnCount++; state.nextWeaponIn--;
    if(state.nextWeaponIn<=0){
      const keys=Object.keys(WEAPONS_CONFIG);
      addWeapon(keys[Math.floor(Math.random()*keys.length)]);
      state.nextWeaponIn=rollNextWeaponDelay();
    }
    state.myTurn=false;
  } else {
    state.myTurn=true;
    showNotif("🎯 Touché ! Tu rejoues !",1800);
  }
  updateTurnIndicator();
}

// ── BOT MODE ──────────────────────────────────────────────────
function processBotDefense(targets,weapon,mainTarget){
  const results=[]; const newlySunkShips=[];
  targets.forEach(ci=>{
    const shipId=state.botGrid[ci];
    if(shipId&&state.opponentGrid[ci]===null){
      state.opponentGrid[ci]="hit"; state.botShipHP[shipId]--;
      const sunk=state.botShipHP[shipId]<=0;
      if(sunk){ newlySunkShips.push(shipId); state.opponentGrid[ci]="sunk"; }
      results.push({idx:ci,result:"hit",shipId,sunk});
    } else if(!shipId&&state.opponentGrid[ci]===null){
      state.opponentGrid[ci]="miss";
      results.push({idx:ci,result:"miss",shipId:null,sunk:false});
    }
  });

  newlySunkShips.forEach(shipId=>{
    if(!state.opponentSunk.includes(shipId)){
      state.opponentSunk.push(shipId);
      showShipSunk(shipId,false); sfxSunk();
      // Arme bonus
      const keys=Object.keys(WEAPONS_CONFIG);
      addWeapon(keys[Math.floor(Math.random()*keys.length)]);
    }
  });

  const anyHit=results.some(r=>r.result==="hit");
  if(anyHit&&newlySunkShips.length===0) sfxHit();
  else if(!anyHit) sfxMiss();

  renderMainGrid(); updateProgressBars();

  const allBotSunk=SHIPS_CONFIG.every(s=>state.botShipHP[s.id]<=0);
  if(allBotSunk){ endGame(true); return; }

  // Distribution arme intervalle
  const given=state.bot.tickWeapon();
  if(given) addWeapon(given);

  const replay=shouldReplay(mainTarget,results);
  if(replay){
    state.myTurn=true;
    showNotif("🎯 Touché ! Tu rejoues !",1800);
    updateTurnIndicator();
  } else {
    state.myTurn=false;
    updateTurnIndicator();
    setTimeout(doBotTurn,BOT_DELAY_MS);
  }
}

function doBotTurn(){
  if(!state.vsBot) return;
  const {mainIdx,weapon,targets}=state.bot.decideShot(state.myGridState);
  if(weapon==="atomic") sfxAtomic();

  const results=[]; const newlySunkShips=[];
  const filtered=targets.filter(ci=>state.myGridState[ci]===null);

  filtered.forEach(ci=>{
    const shipId=state.myGrid[ci];
    if(shipId){
      state.myGridState[ci]="hit"; state.myShipHP[shipId]--;
      sfxHit();
      const sunk=state.myShipHP[shipId]<=0;
      if(sunk) newlySunkShips.push(shipId);
      results.push({idx:ci,result:"hit",shipId,sunk});
    } else {
      state.myGridState[ci]="miss"; sfxMiss();
      results.push({idx:ci,result:"miss",shipId:null,sunk:false});
    }
  });

  state.bot.processFeedback(filtered,results,state.myGridState);
  renderMainGrid(); updateProgressBars();
  newlySunkShips.forEach(shipId=>{ showShipSunk(shipId,true); sfxSunk(); });

  const allSunk=SHIPS_CONFIG.every(s=>state.myShipHP[s.id]<=0);
  if(allSunk){ endGame(false); return; }

  const replay=shouldReplay(mainIdx,results);
  if(replay){
    showNotif(`⚠️ ${state.opponentPseudo} a touché ! Il rejoue...`,1800);
    setTimeout(doBotTurn,BOT_DELAY_MS);
  } else {
    state.myTurn=true; updateTurnIndicator();
  }
}

// ── CHAT ──────────────────────────────────────────────────────
document.getElementById("btn-send-chat").addEventListener("click",sendChat);
document.getElementById("chat-input").addEventListener("keydown",e=>{ if(e.key==="Enter") sendChat(); });
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
function endGame(iWon){
  stopTimer();
  if(iWon){ state.score.me++; sfxVictory(); } else { state.score.opp++; sfxDefeat(); }
  document.getElementById("end-icon").textContent=iWon?"🏆":"💀";
  document.getElementById("end-title").textContent=iWon?"Victoire !":"Défaite !";
  document.getElementById("end-subtitle").textContent=iWon?"Tu as coulé toute la flotte adverse ! Bravo !":"Ta flotte a été anéantie... Courage !";
  document.getElementById("end-score-me").textContent=`${state.pseudo} : ${state.score.me}`;
  document.getElementById("end-score-opp").textContent=`${state.opponentPseudo} : ${state.score.opp}`;
  showScreen("screen-end");
}

document.getElementById("btn-replay").addEventListener("click",()=>{
  if(state.vsBot){
    const {grid}=Bot.placeShips(SHIPS_CONFIG);
    state.botGrid=grid; state.botShipHP={};
    SHIPS_CONFIG.forEach(s=>{ state.botShipHP[s.id]=s.size; });
    state.bot.reset();
    startPlacement(); return;
  }
  publish("replay",{}); startPlacement();
});

function updateScoreBar(){
  document.getElementById("score-val-me").textContent=state.score.me;
  document.getElementById("score-val-opp").textContent=state.score.opp;
}

window.addEventListener("beforeunload",()=>{ if(state.channel) publish("disconnect",{}); });
