// ═══════════════════════════════════════════════════════════════
// BATAILLE NAVALE — bot.js
// IA à trois niveaux : facile, moyen, difficile
// ═══════════════════════════════════════════════════════════════

const BOT_DELAY = 1500; // ms de "réflexion"

export class Bot {
  constructor(level) {
    this.level = level; // "easy" | "medium" | "hard"
    this.reset();
  }

  reset() {
    // Cases non encore ciblées
    this.remaining = Array.from({length: 100}, (_, i) => i);
    // File de cases à explorer après un hit (niveaux moyen/difficile)
    this.huntQueue = [];
    // Dernier hit pour le niveau difficile
    this.lastHit = null;
    // Direction en cours (difficile)
    this.direction = null;
    // Hits consécutifs dans la direction (difficile)
    this.dirHits = [];
    // Armes disponibles
    this.weapons = { cross: 0, random: 0, atomic: 0 };
    this.nextWeaponIn = this._rollWeaponDelay();
    this.turnCount = 0;
  }

  _rollWeaponDelay() {
    return Math.floor(Math.random() * 6) + 3;
  }

  // Appelé après chaque tir du bot pour distribuer les armes
  tickWeapon() {
    this.turnCount++;
    this.nextWeaponIn--;
    if (this.nextWeaponIn <= 0) {
      const keys = ["cross", "random", "atomic"];
      const given = keys[Math.floor(Math.random() * keys.length)];
      this.weapons[given]++;
      this.nextWeaponIn = this._rollWeaponDelay();
      return given; // retourne l'arme reçue pour l'afficher
    }
    return null;
  }

  // Choisit l'arme à utiliser
  _chooseWeapon() {
    if (this.level === "easy") return "normal";
    // Moyen et difficile : utilise les armes si disponibles, avec une probabilité
    const available = Object.entries(this.weapons)
      .filter(([k, v]) => v > 0)
      .map(([k]) => k);
    if (available.length === 0) return "normal";
    // 40% de chance d'utiliser une arme spéciale si disponible
    if (Math.random() < 0.4) {
      const chosen = available[Math.floor(Math.random() * available.length)];
      this.weapons[chosen]--;
      return chosen;
    }
    return "normal";
  }

  // Calcule les cases ciblées selon l'arme et la case principale
  getTargets(mainIdx, weapon, opponentGrid) {
    const idx = (r, c) => r * 10 + c;
    const toRC = i => ({ r: Math.floor(i / 10), c: i % 10 });

    if (weapon === "normal") return [mainIdx];

    if (weapon === "cross") {
      const { r, c } = toRC(mainIdx);
      const cells = [mainIdx];
      if (r > 0) cells.push(idx(r-1, c));
      if (r < 9) cells.push(idx(r+1, c));
      if (c > 0) cells.push(idx(r, c-1));
      if (c < 9) cells.push(idx(r, c+1));
      return cells;
    }

    if (weapon === "random") {
      const cells = new Set([mainIdx]);
      const available = [];
      for (let i = 0; i < 100; i++) {
        if (i !== mainIdx && opponentGrid[i] === null) available.push(i);
      }
      this._shuffle(available);
      for (let i = 0; i < Math.min(5, available.length); i++) cells.add(available[i]);
      return [...cells];
    }

    if (weapon === "atomic") {
      const { r: cr, c: cc } = toRC(mainIdx);
      const cells = new Set();
      for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 10; c++) {
          const dr = Math.abs(r - cr);
          const dc = Math.abs(c - cc);
          if (dr + dc <= 2) cells.add(idx(r, c));
        }
      }
      return [...cells];
    }

    return [mainIdx];
  }

  // Décision principale : retourne { mainIdx, weapon, targets }
  decideShot(opponentGrid) {
    const weapon = this._chooseWeapon();
    let mainIdx;

    switch (this.level) {
      case "easy":
        mainIdx = this._shotEasy(opponentGrid);
        break;
      case "medium":
        mainIdx = this._shotMedium(opponentGrid);
        break;
      case "hard":
        mainIdx = this._shotHard(opponentGrid);
        break;
      default:
        mainIdx = this._shotEasy(opponentGrid);
    }

    const targets = this.getTargets(mainIdx, weapon, opponentGrid)
      .filter(ci => opponentGrid[ci] === null);

    return { mainIdx, weapon, targets };
  }

  // ── FACILE : tir complètement aléatoire ──────────────────────
  _shotEasy(opponentGrid) {
    const available = this.remaining.filter(i => opponentGrid[i] === null);
    return available[Math.floor(Math.random() * available.length)];
  }

  // ── MOYEN : aléatoire + chasse autour des hits ───────────────
  _shotMedium(opponentGrid) {
    // Vider la file des cases déjà tirées
    this.huntQueue = this.huntQueue.filter(i => opponentGrid[i] === null);

    if (this.huntQueue.length > 0) {
      return this.huntQueue.shift();
    }
    return this._shotEasy(opponentGrid);
  }

  // ── DIFFICILE : chasse + destruction en ligne ─────────────────
  _shotHard(opponentGrid) {
    this.huntQueue = this.huntQueue.filter(i => opponentGrid[i] === null);

    // Si on a une direction établie, continuer dans cette direction
    if (this.direction && this.dirHits.length >= 1) {
      const nextInDir = this._nextInDirection(opponentGrid);
      if (nextInDir !== null) return nextInDir;
      // Direction bloquée → essayer l'autre sens
      this.direction = this._oppositeDirection(this.direction);
      const nextOpp = this._nextInDirection(opponentGrid);
      if (nextOpp !== null) return nextOpp;
      // Les deux sens bloqués → reset direction
      this.direction = null;
      this.dirHits = [];
    }

    if (this.huntQueue.length > 0) {
      return this.huntQueue.shift();
    }

    // Pattern en damier pour optimiser (difficile)
    const checkerboard = this.remaining.filter(i => {
      const r = Math.floor(i / 10), c = i % 10;
      return (r + c) % 2 === 0 && opponentGrid[i] === null;
    });
    if (checkerboard.length > 0) {
      return checkerboard[Math.floor(Math.random() * checkerboard.length)];
    }
    return this._shotEasy(opponentGrid);
  }

  _nextInDirection(opponentGrid) {
    if (!this.direction || this.dirHits.length === 0) return null;
    const toRC = i => ({ r: Math.floor(i / 10), c: i % 10 });
    const idx = (r, c) => r * 10 + c;

    const dirs = { up: [-1,0], down: [1,0], left: [0,-1], right: [0,1] };
    const [dr, dc] = dirs[this.direction];

    // Partir du dernier hit dans cette direction
    const last = this.dirHits[this.dirHits.length - 1];
    const { r, c } = toRC(last);
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nr > 9 || nc < 0 || nc > 9) return null;
    const next = idx(nr, nc);
    if (opponentGrid[next] !== null) return null;
    return next;
  }

  _oppositeDirection(dir) {
    return { up: "down", down: "up", left: "right", right: "left" }[dir];
  }

  // Appelé après un résultat de tir pour mettre à jour la stratégie
  processFeedback(targets, results, opponentGrid) {
    const toRC = i => ({ r: Math.floor(i / 10), c: i % 10 });
    const idx = (r, c) => r * 10 + c;

    // Retirer les cases tirées de "remaining"
    targets.forEach(ci => {
      const pos = this.remaining.indexOf(ci);
      if (pos !== -1) this.remaining.splice(pos, 1);
    });

    if (this.level === "easy") return;

    const hits = results.filter(r => r.result === "hit" && !r.sunk);
    const sunkShips = results.filter(r => r.sunk);

    // Si un bateau est coulé, vider la file liée à ce bateau
    if (sunkShips.length > 0) {
      this.huntQueue = [];
      this.direction = null;
      this.dirHits = [];
      this.lastHit = null;
    }

    // Pour chaque hit non coulé, ajouter les voisins à la file
    hits.forEach(r => {
      const { r: row, c: col } = toRC(r.idx);
      const neighbors = [];
      if (row > 0) neighbors.push(idx(row-1, col));
      if (row < 9) neighbors.push(idx(row+1, col));
      if (col > 0) neighbors.push(idx(row, col-1));
      if (col < 9) neighbors.push(idx(row, col+1));

      neighbors.forEach(n => {
        if (opponentGrid[n] === null && !this.huntQueue.includes(n)) {
          this.huntQueue.push(n);
        }
      });

      // Pour le niveau difficile : établir une direction
      if (this.level === "hard") {
        if (this.lastHit !== null) {
          const prev = toRC(this.lastHit);
          const curr = toRC(r.idx);
          if (curr.r === prev.r - 1) this.direction = "up";
          else if (curr.r === prev.r + 1) this.direction = "down";
          else if (curr.c === prev.c - 1) this.direction = "left";
          else if (curr.c === prev.c + 1) this.direction = "right";
          if (this.direction) this.dirHits.push(r.idx);
        }
        this.lastHit = r.idx;
      }
    });
  }

  // Placement aléatoire des bateaux du bot
  static placeShips(shipsConfig) {
    const grid = Array(100).fill(null);
    const ships = {};
    const idx = (r, c) => r * 10 + c;
    const toRC = i => ({ r: Math.floor(i / 10), c: i % 10 });

    shipsConfig.forEach(ship => {
      let placed = false, attempts = 0;
      while (!placed && attempts < 500) {
        attempts++;
        const orientation = Math.random() < 0.5 ? "h" : "v";
        const startIdx = Math.floor(Math.random() * 100);
        const { r, c } = toRC(startIdx);
        const cells = [];
        let valid = true;
        for (let i = 0; i < ship.size; i++) {
          const nr = r + (orientation === "v" ? i : 0);
          const nc = c + (orientation === "h" ? i : 0);
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

  _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }
}

export const BOT_DELAY_MS = BOT_DELAY;
