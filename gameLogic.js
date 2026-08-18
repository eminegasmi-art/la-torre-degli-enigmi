// Logica pura del gioco "La Torre degli Enigmi" - coop 2-6 giocatori.
// Nessuna dipendenza esterna, testabile con "node test.js".
//
// Idea di fondo: la squadra deve superare una sequenza di PORTE prima che
// scada un tempo condiviso (la clessidra). Ogni porta ha:
//   - board: uno stato condiviso, modificabile in tempo reale da chiunque
//     (un numero, una sequenza, delle leve, delle ruote simboliche, dei
//     colori, degli interruttori)
//   - clues: un indizio privato e diverso per ciascun giocatore, che aiuta
//     a dedurre come dev'essere il board
//   - solution: nascosta, mai inviata ai client, verificata solo quando la
//     squadra preme "Conferma"
// A differenza degli altri giochi della saga, qui SI PUÒ parlare
// liberamente: è proprio il punto, coordinarsi a voce.

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sample(arr, n) {
  return shuffle(arr).slice(0, n);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// Genera `count` interi distinti nell'intervallo [min,max] (inclusivo).
function uniqueRandomInts(count, min, max) {
  const pool = [];
  for (let v = min; v <= max; v++) pool.push(v);
  return sample(pool, Math.min(count, pool.length));
}

// ---- Palette condivise (usate sia dalla logica che dal client) ----------
const WHEEL_SYMBOLS = [
  { key: 'gem', label: 'Gemma' },
  { key: 'key', label: 'Chiave' },
  { key: 'heart', label: 'Cuore' },
  { key: 'crown', label: 'Corona' },
  { key: 'trophy', label: 'Coppa' },
  { key: 'castle', label: 'Castello' },
];

const COLORS = [
  { key: 'rosso', hex: '#b23a3a', label: 'Rosso' },
  { key: 'blu', hex: '#2e6da4', label: 'Blu' },
  { key: 'verde', hex: '#2e8b57', label: 'Verde' },
  { key: 'giallo', hex: '#c9a227', label: 'Giallo' },
  { key: 'viola', hex: '#7d3c98', label: 'Viola' },
];

// ---- Parametri di partita -------------------------------------------------
const DOOR_COUNT = 5;
const TOTAL_TIME_MS = 8 * 60 * 1000; // 8 minuti totali per l'intera torre
const PENALTY_MS = 20 * 1000; // penalità per ogni tentativo errato

// ---- Generatori dei singoli tipi di porta --------------------------------

function genSumSecret(numPlayers) {
  const nums = Array.from({ length: numPlayers }, () => randInt(2, 20));
  const solution = nums.reduce((a, b) => a + b, 0);
  return {
    type: 'sum',
    title: 'La Serratura dei Numeri',
    instructions: 'Ogni membro della squadra conosce un numero segreto. Sommateli tutti e inserite il totale.',
    boardKind: 'number',
    board: null,
    choices: null,
    clues: nums.map((n) => `Il tuo numero segreto è ${n}.`),
    solution,
  };
}

function genBrokenSequence(numPlayers) {
  const nums = uniqueRandomInts(numPlayers, 1, 60);
  const solution = [...nums].sort((a, b) => a - b);
  return {
    type: 'sequence',
    title: 'La Scala Crescente',
    instructions: 'Ognuno conosce un numero. Sistemate tutti i numeri della squadra in ordine crescente, da sinistra a destra.',
    boardKind: 'sequenceSlots',
    board: Array(numPlayers).fill(1),
    choices: null,
    clues: nums.map((n) => `Il tuo numero è ${n}.`),
    solution,
  };
}

function genPoeticClues(numPlayers) {
  const X = randInt(10, 80);
  const candidates = [];
  candidates.push(X % 2 === 0 ? 'Il numero è pari.' : 'Il numero è dispari.');
  for (let k = 0; k < 3; k++) {
    const below = X - randInt(1, Math.max(1, X - 1));
    if (below >= 0) candidates.push(`Il numero è maggiore di ${below}.`);
  }
  for (let k = 0; k < 3; k++) {
    const above = X + randInt(1, 30);
    candidates.push(`Il numero è minore di ${above}.`);
  }
  if (X % 2 === 0) candidates.push(`Il numero è il doppio di ${X / 2}.`);
  if (X * 2 <= 99) candidates.push(`Il numero è la metà di ${X * 2}.`);
  const digitSum = String(X).split('').reduce((a, d) => a + Number(d), 0);
  candidates.push(`La somma delle sue cifre è ${digitSum}.`);
  [2, 3, 5, 7].forEach((d) => {
    if (X % d === 0) candidates.push(`Il numero è divisibile per ${d}.`);
  });
  const unique = Array.from(new Set(candidates));
  const chosen = sample(unique, Math.min(numPlayers, unique.length));
  while (chosen.length < numPlayers) chosen.push('Il numero è compreso tra 1 e 99.');
  return {
    type: 'poetic',
    title: 'Il Sussurro dei Numeri',
    instructions: 'Ognuno conosce un indizio vero su un numero segreto. Combinateli a voce e inserite il numero.',
    boardKind: 'number',
    board: null,
    choices: null,
    clues: chosen,
    solution: X,
  };
}

function clueAbout(n) {
  const opts = [
    `Il numero è ${n % 2 === 0 ? 'pari' : 'dispari'}.`,
    `Il numero è maggiore di ${Math.max(0, n - randInt(3, 15))}.`,
    `Il numero è minore di ${n + randInt(3, 15)}.`,
  ];
  return opts[randInt(0, opts.length - 1)];
}

function genLiarClue(numPlayers) {
  const X = randInt(10, 80);
  let decoys = uniqueRandomInts(6, 10, 80).filter((d) => d !== X).slice(0, 3);
  while (decoys.length < 3) decoys.push(randInt(10, 80));
  const choices = shuffle([X, ...decoys]);
  const liarIndex = randInt(0, numPlayers - 1);
  const clues = [];
  for (let i = 0; i < numPlayers; i++) {
    if (i === liarIndex) {
      const decoy = decoys[randInt(0, decoys.length - 1)];
      clues.push(clueAbout(decoy));
    } else {
      clues.push(clueAbout(X));
    }
  }
  return {
    type: 'liar',
    title: 'La Porta del Bugiardo',
    instructions: "Ognuno ha un indizio sul numero segreto, ma UNO degli indizi è falso. Scoprite il numero vero tra le quattro opzioni.",
    boardKind: 'choice',
    board: null,
    choices,
    clues,
    solution: X,
  };
}

// Generatore generico per i 4 enigmi a "conoscenza divisa": un valore per
// slot, un giocatore per slot, chiunque può modificare qualsiasi slot sul
// board condiviso.
function genSplitKnowledge(numPlayers, config) {
  const solution = Array.from({ length: numPlayers }, (_, i) => config.solutionGen(i));
  const clues = solution.map((v, i) => config.labelFn(i, v));
  return {
    type: config.type,
    title: config.title,
    instructions: config.instructions,
    boardKind: config.boardKind,
    board: Array(numPlayers).fill(config.initialSlotValue),
    choices: null,
    clues,
    solution,
  };
}

function genLevers(numPlayers) {
  return genSplitKnowledge(numPlayers, {
    type: 'levers',
    title: 'Le Leve del Meccanismo',
    instructions: 'Ogni leva ha un valore corretto da 0 a 10, noto a un solo membro della squadra. Portate ogni leva al valore giusto.',
    boardKind: 'sliderSlots',
    initialSlotValue: 0,
    solutionGen: () => randInt(0, 10),
    labelFn: (i, v) => `La leva numero ${i + 1} deve arrivare a ${v}.`,
  });
}

function genWheels(numPlayers) {
  return genSplitKnowledge(numPlayers, {
    type: 'wheels',
    title: 'Le Rune Girevoli',
    instructions: 'Ogni ruota ha un simbolo corretto. Toccatele per farle girare fino al simbolo giusto.',
    boardKind: 'wheelSlots',
    initialSlotValue: 0,
    solutionGen: () => randInt(0, WHEEL_SYMBOLS.length - 1),
    labelFn: (i, v) => `La ruota numero ${i + 1} deve mostrare: ${WHEEL_SYMBOLS[v].label}.`,
  });
}

function genColors(numPlayers) {
  return genSplitKnowledge(numPlayers, {
    type: 'colors',
    title: 'Il Quadro dei Colori',
    instructions: 'Ogni casella ha un colore corretto. Toccatele per cambiarne il colore.',
    boardKind: 'colorSlots',
    initialSlotValue: 0,
    solutionGen: () => randInt(0, COLORS.length - 1),
    labelFn: (i, v) => `La casella numero ${i + 1} deve diventare: ${COLORS[v].label}.`,
  });
}

function genToggles(numPlayers) {
  return genSplitKnowledge(numPlayers, {
    type: 'toggles',
    title: 'Gli Interruttori del Sigillo',
    instructions: "Ogni interruttore ha uno stato corretto. Toccateli per accenderli o spegnerli.",
    boardKind: 'toggleSlots',
    initialSlotValue: false,
    solutionGen: () => Math.random() < 0.5,
    labelFn: (i, v) => `L'interruttore numero ${i + 1} deve essere ${v ? 'ACCESO' : 'SPENTO'}.`,
  });
}

const DOOR_GENERATORS = {
  sum: genSumSecret,
  sequence: genBrokenSequence,
  poetic: genPoeticClues,
  liar: genLiarClue,
  levers: genLevers,
  wheels: genWheels,
  colors: genColors,
  toggles: genToggles,
};
const DOOR_TYPES = Object.keys(DOOR_GENERATORS);

function generateDoor(type, numPlayers) {
  const gen = DOOR_GENERATORS[type];
  if (!gen) throw new Error(`Tipo di porta sconosciuto: ${type}`);
  return gen(numPlayers);
}

// Sceglie `count` tipi di porta a caso, evitando ripetizioni immediate.
function randomDoorPlan(count) {
  const plan = [];
  let pool = shuffle(DOOR_TYPES);
  let last = null;
  for (let i = 0; i < count; i++) {
    if (pool.length === 0) {
      pool = shuffle(DOOR_TYPES);
      if (pool[0] === last && pool.length > 1) [pool[0], pool[1]] = [pool[1], pool[0]];
    }
    const t = pool.shift();
    plan.push(t);
    last = t;
  }
  return plan;
}

function generateDoors(count, numPlayers) {
  return randomDoorPlan(count).map((type) => generateDoor(type, numPlayers));
}

// ---- Verifica soluzione ---------------------------------------------------
function checkBoardCorrect(door, board) {
  switch (door.boardKind) {
    case 'number':
    case 'choice':
      return board === door.solution;
    case 'sequenceSlots':
    case 'sliderSlots':
    case 'wheelSlots':
    case 'colorSlots':
      if (!Array.isArray(board) || board.length !== door.solution.length) return false;
      return board.every((v, i) => v === door.solution[i]);
    case 'toggleSlots':
      if (!Array.isArray(board) || board.length !== door.solution.length) return false;
      return board.every((v, i) => Boolean(v) === Boolean(door.solution[i]));
    default:
      return false;
  }
}

// ---- Applica una modifica al board condiviso (validata e "clampata") -----
function applyBoardUpdate(door, board, action) {
  const b = Array.isArray(board) ? [...board] : board;
  switch (door.boardKind) {
    case 'number':
      if (!action || action.kind !== 'setNumber') return board;
      return clamp(Math.round(Number(action.value) || 0), 0, 999);
    case 'choice':
      if (!action || action.kind !== 'setChoice') return board;
      if (!door.choices.includes(action.value)) return board;
      return action.value;
    case 'sequenceSlots':
      if (!action || action.kind !== 'setSlot') return board;
      if (action.slot < 0 || action.slot >= b.length) return board;
      b[action.slot] = clamp(Math.round(Number(action.value) || 1), 1, 99);
      return b;
    case 'sliderSlots':
      if (!action || action.kind !== 'setSlot') return board;
      if (action.slot < 0 || action.slot >= b.length) return board;
      b[action.slot] = clamp(Math.round(Number(action.value) || 0), 0, 10);
      return b;
    case 'wheelSlots':
      if (!action || action.kind !== 'cycleSlot') return board;
      if (action.slot < 0 || action.slot >= b.length) return board;
      b[action.slot] = (b[action.slot] + 1) % WHEEL_SYMBOLS.length;
      return b;
    case 'colorSlots':
      if (!action || action.kind !== 'cycleSlot') return board;
      if (action.slot < 0 || action.slot >= b.length) return board;
      b[action.slot] = (b[action.slot] + 1) % COLORS.length;
      return b;
    case 'toggleSlots':
      if (!action || action.kind !== 'toggleSlot') return board;
      if (action.slot < 0 || action.slot >= b.length) return board;
      b[action.slot] = !b[action.slot];
      return b;
    default:
      return board;
  }
}

module.exports = {
  DOOR_COUNT,
  TOTAL_TIME_MS,
  PENALTY_MS,
  DOOR_TYPES,
  WHEEL_SYMBOLS,
  COLORS,
  generateDoor,
  generateDoors,
  randomDoorPlan,
  checkBoardCorrect,
  applyBoardUpdate,
};
