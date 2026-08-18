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

// Invece di dire il numero direttamente, lo si nasconde in un piccolo calcolo:
// resta deducibile con ASSOLUTA certezza (è solo aritmetica), ma richiede
// un primo passo mentale a ciascuno prima ancora di parlare con gli altri.
function numberRiddleClue(target) {
  const templates = [];
  const a1 = randInt(1, Math.max(1, target - 1));
  templates.push(`Il tuo numero segreto è ${a1} più ${target - a1}.`);
  const extra = randInt(1, 10);
  templates.push(`Il tuo numero segreto è ${target + extra} meno ${extra}.`);
  if (target % 2 === 0) templates.push(`Il tuo numero segreto è il doppio di ${target / 2}.`);
  for (const f of [2, 3, 4, 5]) {
    if (target % f === 0 && target / f !== target) {
      templates.push(`Il tuo numero segreto è ${f} moltiplicato per ${target / f}.`);
      break;
    }
  }
  return sample(templates, 1)[0];
}

function genSumSecret(numPlayers) {
  const nums = Array.from({ length: numPlayers }, () => randInt(2, 20));
  const solution = nums.reduce((a, b) => a + b, 0);
  return {
    type: 'sum',
    title: 'La Serratura dei Numeri',
    instructions: 'Ogni membro della squadra conosce un piccolo calcolo che nasconde un numero segreto. Risolvetelo, sommate tutti i numeri della squadra e inserite il totale.',
    boardKind: 'number',
    board: null,
    choices: null,
    clues: nums.map((n) => numberRiddleClue(n)),
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

// ---- Motore a vincoli per gli enigmi "a conoscenza divisa" ---------------
// In passato ogni giocatore riceveva semplicemente il valore esatto della
// propria casella/ruota/leva/interruttore: bastava dettarlo a voce, zero
// deduzione reale. Ora invece la squadra riceve indizi RELAZIONALI
// (uguaglianze, differenze, esclusioni, conteggi...) che vanno incrociati
// parlando per dedurre la soluzione: la generazione verifica sempre - per
// forza bruta, lo spazio di ricerca è piccolo - che l'insieme di indizi
// assegnato determini UNA SOLA soluzione possibile, mai ambigua (stesso
// principio "deducibile con certezza" delle altre porte).

// Conta (fino a `cap`, ci basta sapere se è 0, 1 o "più di 1") quante
// assegnazioni in [0,numValues)^numSlots soddisfano tutti i constraints.
// Pruning: appena una posizione è assegnata, si verificano subito i vincoli
// che dipendono solo da posizioni già note (deps), scartando i rami non
// validi il prima possibile invece di aspettare la foglia.
function countSolutions(numSlots, numValues, constraints, cap) {
  const byMaxDep = Array.from({ length: numSlots }, () => []);
  constraints.forEach((c) => {
    const maxDep = c.deps && c.deps.length ? Math.max(...c.deps) : numSlots - 1;
    byMaxDep[Math.min(maxDep, numSlots - 1)].push(c);
  });
  let count = 0;
  const assignment = new Array(numSlots).fill(0);
  function rec(pos) {
    if (count >= cap) return;
    if (pos === numSlots) { count++; return; }
    for (let v = 0; v < numValues; v++) {
      assignment[pos] = v;
      if (byMaxDep[pos].every((c) => c.test(assignment))) rec(pos + 1);
      if (count >= cap) return;
    }
  }
  rec(0);
  return count;
}

function valueLabel(kind, v) {
  if (kind === 'colors') return COLORS[v].label;
  if (kind === 'wheels') return WHEEL_SYMBOLS[v].label;
  if (kind === 'toggles') return v ? 'ACCESO' : 'SPENTO';
  return String(v);
}

// Costruisce il "pool" di affermazioni VERE sulla soluzione `sol` (nota solo
// alla generazione, mai al client): coppie di uguaglianza/differenza/ordine,
// conteggi globali, e infine i vincoli "diretti" (il vecchio comportamento)
// usati solo come ultima risorsa per garantire l'unicità. Si preferiscono
// vincoli "forti" (che scartano molte possibilità) a quelli deboli tipo
// "non è questo singolo valore": con domini grandi (le leve, 9 valori) un
// indizio debole da solo non basta a nulla e finiva per gonfiare a dismisura
// il numero di indizi necessari - qui si evita alla radice.
function buildConstraintPool(sol, numValues, kind) {
  const n = sol.length;
  const relational = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (sol[i] === sol[j]) {
        const text = kind === 'toggles'
          ? `Gli interruttori ${i + 1} e ${j + 1} devono essere nello stesso stato (entrambi accesi o entrambi spenti).`
          : kind === 'levers'
          ? `Le leve ${i + 1} e ${j + 1} devono arrivare allo stesso valore.`
          : kind === 'wheels'
          ? `Le ruote ${i + 1} e ${j + 1} devono mostrare lo stesso simbolo.`
          : `Le caselle ${i + 1} e ${j + 1} devono avere lo stesso colore.`;
        relational.push({ text, deps: [i, j], test: (a) => a[i] === a[j] });
      } else if (kind === 'levers') {
        // Per domini numerici grandi, "diverso" da solo è troppo debole:
        // si usano solo confronto d'ordine e somma, molto più discriminanti.
        if (sol[i] > sol[j]) relational.push({ text: `La leva ${i + 1} deve arrivare più in alto della leva ${j + 1}.`, deps: [i, j], test: (a) => a[i] > a[j] });
        else relational.push({ text: `La leva ${j + 1} deve arrivare più in alto della leva ${i + 1}.`, deps: [i, j], test: (a) => a[j] > a[i] });
        const s = sol[i] + sol[j];
        relational.push({ text: `La somma dei valori delle leve ${i + 1} e ${j + 1} deve essere ${s}.`, deps: [i, j], test: (a) => a[i] + a[j] === s });
      } else {
        const text = kind === 'toggles'
          ? `Tra gli interruttori ${i + 1} e ${j + 1}, uno deve essere acceso e l'altro spento.`
          : kind === 'wheels'
          ? `Le ruote ${i + 1} e ${j + 1} devono mostrare simboli diversi tra loro.`
          : `Le caselle ${i + 1} e ${j + 1} devono avere colori diversi tra loro.`;
        relational.push({ text, deps: [i, j], test: (a) => a[i] !== a[j] });
      }
    }
  }
  if (kind === 'colors' || kind === 'wheels') {
    [...new Set(sol)].forEach((v) => {
      const k = sol.filter((x) => x === v).length;
      const text = kind === 'wheels'
        ? (k === 1
          ? `In totale, esattamente 1 ruota deve mostrare il simbolo ${valueLabel(kind, v)}.`
          : `In totale, esattamente ${k} ruote devono mostrare il simbolo ${valueLabel(kind, v)}.`)
        : (k === 1
          ? `In totale, esattamente 1 casella deve avere il colore ${valueLabel(kind, v)}.`
          : `In totale, esattamente ${k} caselle devono avere il colore ${valueLabel(kind, v)}.`);
      relational.push({ text, test: (a) => a.filter((x) => x === v).length === k });
    });
  }
  if (kind === 'toggles') {
    const k = sol.filter(Boolean).length;
    const text = k === 0
      ? 'In totale, nessun interruttore deve essere ACCESO.'
      : k === 1
      ? 'In totale, esattamente 1 interruttore deve essere ACCESO.'
      : `In totale, esattamente ${k} interruttori devono essere ACCESI.`;
    relational.push({ text, test: (a) => a.filter(Boolean).length === k });
  }
  const directs = [];
  for (let i = 0; i < n; i++) {
    const text = kind === 'levers'
      ? `La leva ${i + 1} deve arrivare a ${sol[i]}.`
      : kind === 'wheels'
      ? `La ruota ${i + 1} deve mostrare: ${valueLabel(kind, sol[i])}.`
      : kind === 'toggles'
      ? `L'interruttore ${i + 1} deve essere ${valueLabel(kind, sol[i])}.`
      : `La casella ${i + 1} deve essere ${valueLabel(kind, sol[i])}.`;
    directs.push({ text, deps: [i], test: (a) => a[i] === sol[i] });
  }
  return { relational, directs };
}

// Scegli greedy un sottoinsieme di vincoli che determina la soluzione in modo
// univoco: prova prima quelli relazionali (in ordine casuale), e solo se non
// bastano ricorre ai "diretti" uno a uno finché la soluzione non è unica
// (nel caso limite, con tutti i diretti presenti l'unicità è garantita).
function pickConstraints(sol, numValues, kind, numPlayers) {
  const n = sol.length;
  const { relational, directs } = buildConstraintPool(sol, numValues, kind);
  const relShuffled = shuffle(relational);
  const dirShuffled = shuffle(directs);
  const chosen = [];
  const isUnique = () => countSolutions(n, numValues, chosen, 2) === 1;
  for (const c of relShuffled) {
    if (isUnique()) break;
    chosen.push(c);
  }
  for (const c of dirShuffled) {
    if (isUnique()) break;
    chosen.push(c);
  }
  // Se restano giocatori senza nemmeno un indizio proprio, aggiungi altri
  // vincoli veri (anche ridondanti) dal pool: nessuno resta fuori dalla
  // discussione se è evitabile.
  if (chosen.length < numPlayers) {
    const used = new Set(chosen);
    for (const c of [...relShuffled, ...dirShuffled]) {
      if (chosen.length >= numPlayers) break;
      if (!used.has(c)) chosen.push(c);
    }
  }
  return chosen;
}

function distributeClueTexts(chosen, numPlayers) {
  const buckets = Array.from({ length: numPlayers }, () => []);
  chosen.forEach((c, idx) => buckets[idx % numPlayers].push(c.text));
  return buckets.map((b) => (b.length ? b.join(' · ') : 'Nessun indizio diretto per te: ascolta gli altri, i loro indizi bastano a dedurre anche la tua parte.'));
}

function genConstraintDoor(numPlayers, kind, config) {
  const sol = Array.from({ length: numPlayers }, () => randInt(0, config.numValues - 1));
  const chosen = pickConstraints(sol, config.numValues, kind, numPlayers);
  const clues = distributeClueTexts(chosen, numPlayers);
  const door = {
    type: config.type,
    title: config.title,
    instructions: config.instructions,
    boardKind: config.boardKind,
    board: Array(numPlayers).fill(config.initialSlotValue),
    choices: null,
    clues,
    solution: kind === 'toggles' ? sol.map(Boolean) : sol,
  };
  // Solo per i test automatici (node test.js): mai incluso nei campi che il
  // server invia ai client (vedi la whitelist in server.js).
  door._testConstraints = chosen;
  door._testNumValues = config.numValues;
  if (config.sliderMax) door.sliderMax = config.sliderMax;
  return door;
}

function genLevers(numPlayers) {
  return genConstraintDoor(numPlayers, 'levers', {
    type: 'levers',
    title: 'Le Leve del Meccanismo',
    instructions: 'Ogni leva ha un valore corretto da 0 a 8, ma nessuno lo conosce direttamente: incrociate a voce gli indizi (confronti, somme, esclusioni...) per dedurre il valore di ognuna, poi portatela lì.',
    boardKind: 'sliderSlots',
    initialSlotValue: 0,
    numValues: 9,
    sliderMax: 8,
  });
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
  return genConstraintDoor(numPlayers, 'wheels', {
    type: 'wheels',
    title: 'Le Rune Girevoli',
    instructions: 'Ogni ruota ha un simbolo corretto, ma nessuno lo conosce direttamente: incrociate a voce gli indizi (uguaglianze, esclusioni, conteggi...) per dedurre il simbolo di ognuna, poi toccatele per farle girare.',
    boardKind: 'wheelSlots',
    initialSlotValue: 0,
    numValues: WHEEL_SYMBOLS.length,
  });
}

function genColors(numPlayers) {
  return genConstraintDoor(numPlayers, 'colors', {
    type: 'colors',
    title: 'Il Quadro dei Colori',
    instructions: 'Ogni casella ha un colore corretto, ma nessuno lo conosce direttamente: incrociate a voce gli indizi (uguaglianze, esclusioni, conteggi...) per dedurre il colore di ognuna, poi toccatele per cambiarlo.',
    boardKind: 'colorSlots',
    initialSlotValue: 0,
    numValues: COLORS.length,
  });
}

function genToggles(numPlayers) {
  return genConstraintDoor(numPlayers, 'toggles', {
    type: 'toggles',
    title: 'Gli Interruttori del Sigillo',
    instructions: "Ogni interruttore ha uno stato corretto, ma nessuno lo conosce direttamente: incrociate a voce gli indizi (uguaglianze, conteggi...) per dedurre quali vanno accesi, poi toccateli.",
    boardKind: 'toggleSlots',
    initialSlotValue: false,
    numValues: 2,
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
  numberRiddleClue,
  countSolutions,
};
