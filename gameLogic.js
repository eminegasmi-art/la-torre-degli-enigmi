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
const DOOR_COUNT = 10;
const TOTAL_TIME_MS = 12 * 60 * 1000; // 12 minuti totali per l'intera torre
const PENALTY_MS = 20 * 1000; // penalità di riferimento (compat), la reale è calcolata da penaltyForAttempt
const PENALTY_BASE_MS = 15 * 1000; // primo errore su una porta
const PENALTY_STEP_MS = 5 * 1000; // ogni errore successivo sulla STESSA porta costa di più
const SPEED_BONUS_THRESHOLD_MS = 30 * 1000; // sotto questa soglia scatta il bonus
const SPEED_BONUS_MS = 10 * 1000; // secondi recuperati risolvendo in fretta
const FINAL_DOOR_PENALTY_MULTIPLIER = 1.5; // l'ultima porta punisce di più gli errori

// Penalità per un tentativo errato: cresce a ogni errore SULLA STESSA porta
// (si azzera quando si passa alla porta successiva), ed è più severa
// sull'ultima porta per uno sprint finale con la posta più alta.
function penaltyForAttempt(attemptNumber, isFinalDoor) {
  const base = PENALTY_BASE_MS + Math.max(0, attemptNumber - 1) * PENALTY_STEP_MS;
  return Math.round(isFinalDoor ? base * FINAL_DOOR_PENALTY_MULTIPLIER : base);
}

// Bonus di tempo per aver risolto in fretta: niente bonus sull'ultima porta
// (lo sprint finale non permette di "comprare" altro tempo).
function speedBonusFor(elapsedMs, isFinalDoor) {
  if (isFinalDoor) return 0;
  return elapsedMs <= SPEED_BONUS_THRESHOLD_MS ? SPEED_BONUS_MS : 0;
}

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
    board: Array(numPlayers).fill(null),
    choices: null,
    clues: nums.map((n) => `Il tuo numero è ${n}.`),
    solution,
  };
}

// Il numero segreto ha tante CIFRE quanti sono i giocatori: ognuno conosce
// una cifra e la sua posizione. Combinandole (parlando) si ricostruisce il
// numero con certezza assoluta - niente più indizi vaghi tipo "maggiore di
// N" che da soli non bastano a determinare un numero preciso. La difficoltà
// scala naturalmente col numero di giocatori (più giocatori = più cifre).
const POETIC_TEMPLATES = [
  (d, p) => `Un'iscrizione consumata dal tempo recita: "la cifra è ${d}, posizione ${p} da sinistra".`,
  (d, p) => `Tra le rune incise si legge: la cifra è ${d}, posizione ${p} da sinistra.`,
  (d, p) => `Un vecchio indovinello sussurra: posizione ${p} da sinistra, la cifra è ${d}.`,
  (d, p) => `Nel tuo frammento di pergamena è scritto: la cifra è ${d}, posizione ${p} da sinistra.`,
  (d, p) => `Il guardiano mormora: posizione ${p} da sinistra, la cifra è ${d}.`,
];

function genPoeticClues(numPlayers) {
  const numDigits = clamp(numPlayers, 2, 6);
  const digits = [randInt(1, 9)]; // la prima cifra non è mai 0
  for (let i = 1; i < numDigits; i++) digits.push(randInt(0, 9));
  const solution = Number(digits.join(''));
  const clues = digits.map((d, i) => {
    const template = POETIC_TEMPLATES[randInt(0, POETIC_TEMPLATES.length - 1)];
    return template(d, i + 1);
  });
  return {
    type: 'poetic',
    title: 'Il Sussurro dei Numeri',
    instructions: `Ogni membro della squadra conosce una cifra del numero segreto e la sua posizione. Il numero ha ${numDigits} cifre: ricostruitelo insieme e inseritelo.`,
    boardKind: 'number',
    board: null,
    choices: null,
    clues,
    solution,
  };
}

function genLiarClue(numPlayers) {
  const X = randInt(10, 80);
  let decoys = uniqueRandomInts(6, 10, 80).filter((d) => d !== X).slice(0, 3);
  while (decoys.length < 3) {
    const d = randInt(10, 80);
    if (d !== X && !decoys.includes(d)) decoys.push(d);
  }
  const choices = shuffle([X, ...decoys]);
  const sorted = [...choices].sort((a, b) => a - b);

  // Indizi costruiti sulle soglie ESATTE delle 4 opzioni mostrate: così ogni
  // indizio distingue davvero almeno un'opzione dalle altre, invece di
  // soglie casuali che potrebbero non escludere nessuno (il bug segnalato).
  const templates = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const t = sorted[i];
    templates.push({ text: `Il numero è maggiore di ${t}.`, test: (n) => n > t });
  }
  for (let i = 1; i < sorted.length; i++) {
    const t = sorted[i];
    templates.push({ text: `Il numero è minore di ${t}.`, test: (n) => n < t });
  }
  templates.push({ text: 'Il numero è pari.', test: (n) => n % 2 === 0 });
  templates.push({ text: 'Il numero è dispari.', test: (n) => n % 2 === 1 });
  const discriminating = templates.filter((t) => {
    const vals = choices.map((c) => t.test(c));
    return vals.some((v) => v) && vals.some((v) => !v);
  });

  const liarIndex = randInt(0, numPlayers - 1);
  const clues = [];
  for (let i = 0; i < numPlayers; i++) {
    if (i === liarIndex) {
      const decoy = decoys[randInt(0, decoys.length - 1)];
      const valid = discriminating.filter((t) => t.test(decoy) && !t.test(X));
      const pool = valid.length ? valid : discriminating;
      clues.push(pool[randInt(0, pool.length - 1)].text);
    } else {
      const valid = discriminating.filter((t) => t.test(X));
      const pool = valid.length ? valid : discriminating;
      clues.push(pool[randInt(0, pool.length - 1)].text);
    }
  }
  return {
    type: 'liar',
    title: 'La Porta del Bugiardo',
    instructions: "Ognuno ha un indizio sul numero segreto, ma UNO degli indizi è falso. Confrontateli e scoprite qual è il numero vero tra le quattro opzioni.",
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
  const door = genSplitKnowledge(numPlayers, {
    type: 'levers',
    title: 'Le Leve del Meccanismo',
    instructions: 'Ogni leva ha un valore corretto da 0 a 10, noto a un solo membro della squadra. Portate ogni leva al valore giusto.',
    boardKind: 'sliderSlots',
    initialSlotValue: 0,
    solutionGen: () => randInt(0, 10),
    labelFn: (i, v) => `La leva numero ${i + 1} deve arrivare a ${v}.`,
  });
  door.sliderMax = 10;
  return door;
}

// La sequenza segue un passo costante (crescente); manca un valore, e ogni
// giocatore ne conosce uno con la sua posizione. Sempre deducibile: bastano
// due posizioni qualsiasi per calcolare il passo e ricostruire il resto.
function genMissingNumber(numPlayers) {
  const L = numPlayers + 1;
  const start = randInt(1, 15);
  const step = randInt(1, 7);
  const terms = Array.from({ length: L }, (_, i) => start + i * step);
  const missingIndex = randInt(0, L - 1);
  const solution = terms[missingIndex];
  const knownPositions = terms.map((_, i) => i).filter((i) => i !== missingIndex);
  const clues = knownPositions.map((pos) => `La posizione ${pos + 1} della sequenza vale ${terms[pos]}.`);
  return {
    type: 'missing',
    title: 'Il Numero Mancante',
    instructions: `La sequenza ha ${L} posizioni e segue un andamento regolare (si aggiunge sempre lo stesso passo). Manca il valore in posizione ${missingIndex + 1}: deducete il passo e trovatelo.`,
    boardKind: 'number',
    board: null,
    choices: null,
    clues,
    solution,
  };
}

// Stesso meccanismo affidabile de "Il Numero Mancante" (un passo costante,
// sempre deducibile con certezza), ma con ambientazione da mappa del tesoro
// e resa visiva a strisce di pergamena strappata sul client (vedi `cells`).
function genTornMap(numPlayers) {
  const L = numPlayers + 1;
  const start = randInt(5, 20);
  const step = randInt(2, 9);
  const terms = Array.from({ length: L }, (_, i) => start + i * step);
  const missingIndex = randInt(0, L - 1);
  const solution = terms[missingIndex];
  const knownPositions = terms.map((_, i) => i).filter((i) => i !== missingIndex);
  const clues = knownPositions.map((pos) => `Il tuo frammento di pergamena mostra: alla tappa ${pos + 1} del cammino, la distanza segnata è ${terms[pos]} leghe.`);
  const cells = terms.map((v, i) => ({ pos: i + 1, value: i === missingIndex ? null : v, missing: i === missingIndex }));
  return {
    type: 'map',
    title: 'La Mappa Strappata',
    instructions: `Un'antica mappa segna ${L} tappe di un cammino, con una distanza regolare tra una tappa e la successiva (sempre lo stesso passo). Un frammento è andato perso: deducete il passo e ricostruite la distanza mancante alla tappa ${missingIndex + 1}.`,
    boardKind: 'number',
    board: null,
    choices: null,
    cells,
    clues,
    solution,
  };
}

// Variante della somma segreta con operazione a sorpresa: tiene la squadra
// sveglia perché non sa mai in anticipo cosa dovrà calcolare.
function genOperation(numPlayers) {
  const opKeys = ['somma', 'differenza', 'prodotto', 'pari'];
  const op = opKeys[randInt(0, opKeys.length - 1)];
  let nums;
  let solution;
  let howLabel;
  if (op === 'somma') {
    nums = Array.from({ length: numPlayers }, () => randInt(2, 20));
    solution = nums.reduce((a, b) => a + b, 0);
    howLabel = 'Sommate tutti i numeri della squadra e inserite il totale.';
  } else if (op === 'differenza') {
    nums = Array.from({ length: numPlayers }, () => randInt(1, 50));
    solution = Math.max(...nums) - Math.min(...nums);
    howLabel = 'Calcolate la differenza tra il numero più alto e il numero più basso della squadra e inseritela.';
  } else if (op === 'prodotto') {
    nums = Array.from({ length: numPlayers }, () => randInt(2, 6));
    solution = nums.reduce((a, b) => a * b, 1);
    howLabel = 'Moltiplicate tutti i numeri della squadra tra loro e inserite il risultato.';
  } else {
    nums = Array.from({ length: numPlayers }, () => randInt(1, 50));
    solution = nums.filter((n) => n % 2 === 0).length;
    howLabel = 'Contate quanti numeri PARI ci sono in tutta la squadra e inserite il conteggio.';
  }
  return {
    type: 'operation',
    title: 'La Serratura del Calcolo',
    instructions: howLabel,
    boardKind: 'number',
    board: null,
    choices: null,
    clues: nums.map((n) => `Il tuo numero segreto è ${n}.`),
    solution,
  };
}

// Un solo giocatore vede il simbolo giusto e deve descriverlo a voce SENZA
// nominarlo; gli altri scelgono tra 4 icone mostrate sul loro schermo.
function genGuessSymbol(numPlayers) {
  const solutionIdx = randInt(0, WHEEL_SYMBOLS.length - 1);
  const describerIndex = randInt(0, numPlayers - 1);
  const decoyPool = WHEEL_SYMBOLS.map((_, i) => i).filter((i) => i !== solutionIdx);
  const decoyIdx = sample(decoyPool, Math.min(3, decoyPool.length));
  const choices = shuffle([solutionIdx, ...decoyIdx]);
  const clues = [];
  for (let i = 0; i < numPlayers; i++) {
    if (i === describerIndex) {
      clues.push(`Devi DESCRIVERE a voce questo simbolo, senza mai nominarlo: ${WHEEL_SYMBOLS[solutionIdx].label}.`);
    } else {
      clues.push('Nessun indizio per te: ascolta chi descrive il simbolo e scegli tra le opzioni mostrate.');
    }
  }
  return {
    type: 'guess',
    title: 'Lo Specchio dei Simboli',
    instructions: 'Un solo membro della squadra vede il simbolo giusto e deve descriverlo a voce senza nominarlo. Gli altri scelgono tra le opzioni mostrate.',
    boardKind: 'choice',
    board: null,
    choices,
    clues,
    solution: solutionIdx,
  };
}

// Un solo giocatore conosce il punto esatto su una scala 0-100 e deve
// guidare la squadra a voce ("più a destra", "quasi", "fermi") mentre
// qualcun altro sposta la leva condivisa. Tolleranza di qualche punto:
// serve tensione in tempo reale, non precisione chirurgica al pixel.
function genTimeLever(numPlayers) {
  const target = randInt(10, 90);
  const guideIndex = randInt(0, numPlayers - 1);
  const clues = [];
  for (let i = 0; i < numPlayers; i++) {
    if (i === guideIndex) {
      clues.push(`Solo tu conosci il punto esatto: ${target} su una scala da 0 a 100. Guida la squadra a voce ("più a destra", "quasi", "fermi") mentre qualcuno sposta la leva.`);
    } else {
      clues.push('Nessun indizio per te: ascolta chi ti guida a voce e sposta la leva quando serve.');
    }
  }
  return {
    type: 'timeLever',
    title: 'La Leva del Tempo',
    instructions: 'Un solo membro della squadra conosce il punto esatto su una scala 0-100. Deve guidare gli altri a voce finché la leva non è abbastanza precisa.',
    boardKind: 'sliderSlots',
    board: [50],
    choices: null,
    clues,
    solution: [target],
    sliderMax: 100,
    tolerance: 3,
  };
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
  missing: genMissingNumber,
  operation: genOperation,
  guess: genGuessSymbol,
  timeLever: genTimeLever,
  map: genTornMap,
};
const DOOR_TYPES = Object.keys(DOOR_GENERATORS);

function generateDoor(type, numPlayers) {
  const gen = DOOR_GENERATORS[type];
  if (!gen) throw new Error(`Tipo di porta sconosciuto: ${type}`);
  return gen(numPlayers);
}

// Sceglie `count` tipi di porta a caso, evitando ripetizioni immediate.
// Con 2 giocatori si esclude "liar": con un solo indizio vero e uno falso,
// senza un terzo punto di vista non c'è modo di distinguerli (nessuna
// "maggioranza" possibile) - il bug segnalato di "non funziona in 2".
function randomDoorPlan(count, numPlayers) {
  const availableTypes = numPlayers < 3 ? DOOR_TYPES.filter((t) => t !== 'liar') : DOOR_TYPES;
  const plan = [];
  let pool = shuffle(availableTypes);
  let last = null;
  for (let i = 0; i < count; i++) {
    if (pool.length === 0) {
      pool = shuffle(availableTypes);
      if (pool[0] === last && pool.length > 1) [pool[0], pool[1]] = [pool[1], pool[0]];
    }
    const t = pool.shift();
    plan.push(t);
    last = t;
  }
  return plan;
}

function generateDoors(count, numPlayers) {
  return randomDoorPlan(count, numPlayers).map((type) => generateDoor(type, numPlayers));
}

// ---- Verifica soluzione ---------------------------------------------------
function checkBoardCorrect(door, board) {
  switch (door.boardKind) {
    case 'number':
    case 'choice':
      return board === door.solution;
    case 'sliderSlots': {
      if (!Array.isArray(board) || board.length !== door.solution.length) return false;
      const tol = door.tolerance || 0;
      return board.every((v, i) => Math.abs(v - door.solution[i]) <= tol);
    }
    case 'sequenceSlots':
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
      // Il campo "number" è condiviso da più enigmi: la somma segreta resta
      // piccola, ma "Il Sussurro dei Numeri" può arrivare a un numero di 6
      // cifre con 6 giocatori (999999), quindi il limite dev'essere ampio.
      return clamp(Math.round(Number(action.value) || 0), 0, 999999);
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
      b[action.slot] = clamp(Math.round(Number(action.value) || 0), 0, door.sliderMax || 10);
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
  PENALTY_BASE_MS,
  PENALTY_STEP_MS,
  SPEED_BONUS_THRESHOLD_MS,
  SPEED_BONUS_MS,
  FINAL_DOOR_PENALTY_MULTIPLIER,
  DOOR_TYPES,
  WHEEL_SYMBOLS,
  COLORS,
  generateDoor,
  generateDoors,
  randomDoorPlan,
  checkBoardCorrect,
  applyBoardUpdate,
  penaltyForAttempt,
  speedBonusFor,
};
