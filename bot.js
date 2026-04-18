// ═══════════════════════════════════════════════════════════════
// BATAILLE NAVALE — bot.js (v2)
// Niveau difficile : algorithme de densité de probabilité
// ═══════════════════════════════════════════════════════════════

export const BOT_DELAY_MS = 1500;

export class Bot {
  constructor(level) {
    this.level = level;
    this.reset();
  }

  reset() {
    this.remaining = Array.from({length: 100}, (_, i) => i);
    this.huntQueue = [];
    this.lastHit = null;
    this.direction = null;
    this.dirHits = [];
    this.weapons = { cross: 0, random: 0, atomic: 0 };
    this.nextWeaponIn = this._rollWeaponDelay();
    this.turnCount = 0;
    // Bateaux restants côté joueur (pour calcul de densité)
    this.remainingShips = [5, 4, 3, 3, 2];
  }

  _rollWeaponDelay() { return Math.floor(Math.random() * 6) + 3; }

  tickWeapon() {
    this.turnCount++;
    this.nextWeaponIn--;
    if (this.nextWeaponIn <= 0) {
      const keys = ['cross', 'random', 'atomic'];
      const given = keys[Math.floor(Math.random() * keys.length)];
      this.weapons[given]++;
      this.nextWeaponIn = this._rollWeaponDelay();
      return given;
    }
    return null;
  }

  // ── Choix de l'arme (intelligent) ───────────────────────────
  _chooseWeapon(opponentGrid, mainIdx) {
    if (this.level === 'easy') return 'normal';

    // Niveau moyen : utilisation aléatoire simple
    if (this.level === 'medium') {
      const available = Object.entries(this.weapons).filter(([k,v]) => v > 0).map(([k]) => k);
      if (available.length > 0 && Math.random() < 0.35) {
        const chosen = available[Math.floor(Math.random() * available.length)];
        this.weapons[chosen]--;
        return chosen;
      }
      return 'normal';
    }

    // Niveau difficile : choix stratégique
    const {r, c} = toRC(mainIdx);

    // Mine en croix : si un hit adjacent existe → très efficace
    if (this.weapons.cross > 0) {
      const neighbors = getNeighbors(mainIdx);
      const hasAdjacentHit = neighbors.some(n => opponentGrid[n] === 'hit');
      if (hasAdjacentHit) {
        this.weapons.cross--;
        return 'cross';
      }
    }

    // Bombe atomique : si zone dense non explorée (>= 8 cases vierges dans le losange)
    if (this.weapons.atomic > 0) {
      const atomicCells = this._getAtomicCells(mainIdx);
      const virginInZone = atomicCells.filter(ci => opponentGrid[ci] === null).length;
      if (virginInZone >= 8) {
        this.weapons.atomic--;
        return 'atomic';
      }
    }

    // Frappe aléatoire : en phase de recherche (pas de hunt en cours)
    if (this.weapons.random > 0 && this.huntQueue.length === 0 && !this.direction) {
      if (Math.random() < 0.5) {
        this.weapons.random--;
        return 'random';
      }
    }

    // Mine en croix : utiliser si disponible avec 40% de chance
    if (this.weapons.cross > 0 && Math.random() < 0.4) {
      this.weapons.cross--;
      return 'cross';
    }

    return 'normal';
  }

  // ── Calcul des cases ciblées ─────────────────────────────────
  getTargets(mainIdx, weapon, opponentGrid) {
    if (weapon === 'normal') return [mainIdx];

    if (weapon === 'cross') {
      const {r, c} = toRC(mainIdx);
      const cells = [mainIdx];
      if (r > 0) cells.push(idx(r-1, c));
      if (r < 9) cells.push(idx(r+1, c));
      if (c > 0) cells.push(idx(r, c-1));
      if (c < 9) cells.push(idx(r, c+1));
      return cells;
    }

    if (weapon === 'random') {
      const cells = new Set([mainIdx]);
      const available = [];
      for (let i = 0; i < 100; i++) {
        if (i !== mainIdx && opponentGrid[i] === null) available.push(i);
      }
      shuffle(available);
      for (let i = 0; i < Math.min(5, available.length); i++) cells.add(available[i]);
      return [...cells];
    }

    if (weapon === 'atomic') return this._getAtomicCells(mainIdx);
    return [mainIdx];
  }

  _getAtomicCells(mainIdx) {
    const {r: cr, c: cc} = toRC(mainIdx);
    const cells = new Set();
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 10; c++) {
        if (Math.abs(r-cr) + Math.abs(c-cc) <= 2) cells.add(idx(r, c));
      }
    }
    return [...cells];
  }

  // ── Décision principale ──────────────────────────────────────
  decideShot(opponentGrid) {
    let mainIdx;

    switch (this.level) {
      case 'easy':   mainIdx = this._shotEasy(opponentGrid); break;
      case 'medium': mainIdx = this._shotMedium(opponentGrid); break;
      case 'hard':   mainIdx = this._shotHard(opponentGrid); break;
      default:       mainIdx = this._shotEasy(opponentGrid);
    }

    const weapon = this._chooseWeapon(opponentGrid, mainIdx);
    const targets = this.getTargets(mainIdx, weapon, opponentGrid)
      .filter(ci => opponentGrid[ci] === null);

    return { mainIdx, weapon, targets };
  }

  // ── FACILE ───────────────────────────────────────────────────
  _shotEasy(opponentGrid) {
    const available = this.remaining.filter(i => opponentGrid[i] === null);
    return available[Math.floor(Math.random() * available.length)];
  }

  // ── MOYEN ────────────────────────────────────────────────────
  _shotMedium(opponentGrid) {
    this.huntQueue = this.huntQueue.filter(i => opponentGrid[i] === null);
    if (this.huntQueue.length > 0) return this.huntQueue.shift();
    return this._shotEasy(opponentGrid);
  }

  // ── DIFFICILE : densité de probabilité ───────────────────────
  _shotHard(opponentGrid) {
    this.huntQueue = this.huntQueue.filter(i => opponentGrid[i] === null);

    // Phase destruction : suivre une direction établie
    if (this.direction && this.dirHits.length >= 1) {
      const next = this._nextInDirection(opponentGrid);
      if (next !== null) return next;
      this.direction = this._opposite(this.direction);
      const nextOpp = this._nextInDirection(opponentGrid);
      if (nextOpp !== null) return nextOpp;
      this.direction = null;
      this.dirHits = [];
    }

    // Phase chasse : file de cases adjacentes à des hits
    if (this.huntQueue.length > 0) return this.huntQueue.shift();

    // Phase recherche : carte de densité de probabilité
    return this._densityShot(opponentGrid);
  }

  // ── Algorithme de densité de probabilité ────────────────────
  // Pour chaque case vierge, compte combien de placements valides
  // des bateaux restants peuvent couvrir cette case.
  // Tire sur la case avec le score le plus élevé.
  _densityShot(opponentGrid) {
    const scores = new Array(100).fill(0);

    this.remainingShips.forEach(size => {
      // Horizontal
      for (let r = 0; r < 10; r++) {
        for (let c = 0; c <= 10 - size; c++) {
          const cells = Array.from({length: size}, (_, i) => idx(r, c+i));
          if (this._placementValid(cells, opponentGrid)) {
            cells.forEach(ci => { if (opponentGrid[ci] === null) scores[ci]++; });
          }
        }
      }
      // Vertical
      for (let c = 0; c < 10; c++) {
        for (let r = 0; r <= 10 - size; r++) {
          const cells = Array.from({length: size}, (_, i) => idx(r+i, c));
          if (this._placementValid(cells, opponentGrid)) {
            cells.forEach(ci => { if (opponentGrid[ci] === null) scores[ci]++; });
          }
        }
      }
    });

    // Trouver le score max parmi les cases non tirées
    let maxScore = 0;
    let bestCells = [];
    for (let i = 0; i < 100; i++) {
      if (opponentGrid[i] !== null) continue;
      if (scores[i] > maxScore) { maxScore = scores[i]; bestCells = [i]; }
      else if (scores[i] === maxScore) bestCells.push(i);
    }

    if (bestCells.length === 0) return this._shotEasy(opponentGrid);
    return bestCells[Math.floor(Math.random() * bestCells.length)];
  }

  // Un placement est valide si toutes les cases sont soit vierges, soit des hits
  _placementValid(cells, opponentGrid) {
    return cells.every(ci => opponentGrid[ci] === null || opponentGrid[ci] === 'hit');
  }

  // ── Navigation directionnelle ─────────────────────────────────
  _nextInDirection(opponentGrid) {
    if (!this.direction || this.dirHits.length === 0) return null;
    const dirs = { up:[-1,0], down:[1,0], left:[0,-1], right:[0,1] };
    const [dr, dc] = dirs[this.direction];
    const last = this.dirHits[this.dirHits.length - 1];
    const {r, c} = toRC(last);
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nr > 9 || nc < 0 || nc > 9) return null;
    const next = idx(nr, nc);
    if (opponentGrid[next] !== null) return null;
    return next;
  }

  _opposite(dir) {
    return { up:'down', down:'up', left:'right', right:'left' }[dir];
  }

  // ── Feedback après un tir ────────────────────────────────────
  processFeedback(targets, results, opponentGrid) {
    // Retirer les cases tirées de remaining
    targets.forEach(ci => {
      const pos = this.remaining.indexOf(ci);
      if (pos !== -1) this.remaining.splice(pos, 1);
    });

    if (this.level === 'easy') return;

    const hits = results.filter(r => r.result === 'hit' && !r.sunk);
    const sunkShips = results.filter(r => r.sunk);

    // Bateau coulé : mettre à jour remainingShips et réinitialiser la chasse
    sunkShips.forEach(r => {
      const ship = this._findSunkShip(r.shipId);
      if (ship) {
        const idx = this.remainingShips.indexOf(ship.size);
        if (idx !== -1) this.remainingShips.splice(idx, 1);
      }
      // Vider la file et réinitialiser la direction
      this.huntQueue = [];
      this.direction = null;
      this.dirHits = [];
      this.lastHit = null;
    });

    // Nouveau hit : ajouter voisins à la file
    hits.forEach(r => {
      const neighbors = getNeighbors(r.idx);
      neighbors.forEach(n => {
        if (opponentGrid[n] === null && !this.huntQueue.includes(n)) {
          this.huntQueue.push(n);
        }
      });

      // Niveau difficile : établir une direction
      if (this.level === 'hard' && this.lastHit !== null) {
        const prev = toRC(this.lastHit);
        const curr = toRC(r.idx);
        if (curr.r === prev.r - 1)      this.direction = 'up';
        else if (curr.r === prev.r + 1) this.direction = 'down';
        else if (curr.c === prev.c - 1) this.direction = 'left';
        else if (curr.c === prev.c + 1) this.direction = 'right';
        if (this.direction) this.dirHits.push(r.idx);
      }
      this.lastHit = r.idx;
    });
  }

  _findSunkShip(shipId) {
    const sizes = { carrier:5, cruiser:4, destroyer:3, submarine:3, torpedo:2 };
    return shipId && sizes[shipId] ? { size: sizes[shipId] } : null;
  }

  // ── Placement aléatoire des bateaux du bot ───────────────────
  static placeShips(shipsConfig) {
    const grid = Array(100).fill(null);
    const ships = {};

    shipsConfig.forEach(ship => {
      let placed = false, attempts = 0;
      while (!placed && attempts < 500) {
        attempts++;
        const orientation = Math.random() < 0.5 ? 'h' : 'v';
        const startIdx = Math.floor(Math.random() * 100);
        const {r, c} = toRC(startIdx);
        const cells = [];
        let valid = true;
        for (let i = 0; i < ship.size; i++) {
          const nr = r + (orientation === 'v' ? i : 0);
          const nc = c + (orientation === 'h' ? i : 0);
          if (nr >= 10 || nc >= 10) { valid = false; break; }
          const ci = idx(nr, nc);
          if (grid[ci] !== null) { valid = false; break; }
          cells.push(ci);
        }
        if (!valid) continue;
        cells.forEach(ci => { grid[ci] = ship.id; });
        ships[ship.id] = cells.map(ci => toRC(ci));
        placed = true;
      }
    });

    return { grid, ships };
  }
}

// ── Utilitaires ───────────────────────────────────────────────
function idx(r, c) { return r * 10 + c; }
function toRC(i) { return { r: Math.floor(i/10), c: i%10 }; }

function getNeighbors(i) {
  const {r, c} = toRC(i);
  const neighbors = [];
  if (r > 0) neighbors.push(idx(r-1, c));
  if (r < 9) neighbors.push(idx(r+1, c));
  if (c > 0) neighbors.push(idx(r, c-1));
  if (c < 9) neighbors.push(idx(r, c+1));
  return neighbors;
}

function shuffle(arr) {
  for (let i = arr.length-1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i+1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
