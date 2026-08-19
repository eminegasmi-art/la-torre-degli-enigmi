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

const ORDINALS_IT = ['primo', 'secondo', 'terzo', 'quarto', 'quinto', 'sesto'];

// Conta (fino a `cap`) quante permutazioni di 0..n-1 soddisfano tutti i
// constraints: usata per verificare che i confronti scelti individuino UNA
// SOLA classifica possibile, esattamente come per gli enigmi a vincoli.
function countPermutations(n, constraints, cap) {
  let count = 0;
  const perm = new Array(n).fill(-1);
  const usedRank = new Array(n).fill(false);
  function rec(i) {
    if (count >= cap) return;
    if (i === n) { count++; return; }
    for (let r = 0; r < n; r++) {
      if (usedRank[r]) continue;
      perm[i] = r;
      usedRank[r] = true;
      if (constraints.every((c) => c.deps.every((d) => d <= i) ? c.test(perm) : true)) rec(i + 1);
      usedRank[r] = false;
      if (count >= cap) return;
    }
  }
  rec(0);
  return count;
}

// Ogni giocatore ha un oggetto di peso diverso (una classifica nascosta, non
// un valore assoluto). Gli indizi sono confronti a coppie ("il tuo pesa più
// di quello del Giocatore 3") che la squadra deve incrociare a voce per
// ricostruire l'intera classifica - mai un singolo indizio dà la posizione
// esatta, a meno che non sia necessario per garantire l'unicità.
function genScale(numPlayers) {
  const n = numPlayers;
  const rank = shuffle(Array.from({ length: n }, (_, i) => i)); // rank[i] = posizione (0=più leggero) dell'oggetto del giocatore i
  const pairs = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([i, j]);
  const shuffledPairs = shuffle(pairs);
  const cluesByPlayer = Array.from({ length: n }, () => []);
  const chosen = [];
  const isUnique = () => countPermutations(n, chosen, 2) === 1;
  for (const [i, j] of shuffledPairs) {
    if (isUnique()) break;
    const iHeavier = rank[i] > rank[j];
    chosen.push({ deps: [Math.max(i, j)], test: (p) => (iHeavier ? p[i] > p[j] : p[i] < p[j]) });
    cluesByPlayer[i].push(`Il tuo oggetto pesa ${iHeavier ? 'più' : 'meno'} di quello del Giocatore ${j + 1}.`);
    cluesByPlayer[j].push(`Il tuo oggetto pesa ${iHeavier ? 'meno' : 'più'} di quello del Giocatore ${i + 1}.`);
  }
  // Ultima risorsa (rara con pochi giocatori): posizione assoluta in classifica.
  let gi = 0;
  const directOrder = shuffle(Array.from({ length: n }, (_, i) => i));
  while (!isUnique() && gi < n) {
    const i = directOrder[gi++];
    chosen.push({ deps: [i], test: (p) => p[i] === rank[i] });
    cluesByPlayer[i].push(`Il tuo oggetto è il ${ORDINALS_IT[rank[i]] || rank[i] + 1 + 'º'} più leggero della squadra.`);
  }
  // Nessuno resta senza nemmeno un indizio, se possibile.
  for (const [i, j] of shuffledPairs) {
    if (cluesByPlayer.every((c) => c.length > 0)) break;
    if (cluesByPlayer[i].length === 0) {
      const iHeavier = rank[i] > rank[j];
      cluesByPlayer[i].push(`Il tuo oggetto pesa ${iHeavier ? 'più' : 'meno'} di quello del Giocatore ${j + 1}.`);
    }
  }
  const clues = cluesByPlayer.map((c) => (c.length ? c.join(' · ') : 'Nessun confronto diretto per te: ascolta gli altri per dedurre la posizione del tuo oggetto.'));
  const order = new Array(n);
  rank.forEach((r, i) => { order[r] = i + 1; }); // order[posizione] = numero del giocatore (1-based), dal più leggero al più pesante
  const door = {
    type: 'scale',
    title: 'La Bilancia degli Antenati',
    instructions: `Ogni membro della squadra porta un oggetto di peso diverso. Confrontate a voce gli indizi (chi pesa più o meno di chi) e disponete i numeri dei ${n} giocatori in ordine di peso, dal più leggero (a sinistra) al più pesante (a destra). Guarda l'elenco dei numeri della squadra qui sopra.`,
    boardKind: 'sequenceSlots',
    board: Array(n).fill(null),
    choices: null,
    clues,
    solution: order,
    needsRoster: true,
  };
  door._testConstraints = chosen;
  return door;
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

// v2.1: prima ogni giocatore riceveva la cifra esatta + la sua posizione -
// pura dettatura, zero deduzione ("molto banale" nel feedback reale). Ora la
// maggior parte delle cifre si deduce da indizi RELAZIONALI tra posizioni
// (confronti, somme, uguaglianze, pari/dispari): solo le cifre che restano
// davvero ambigue anche dopo tutti i confronti disponibili ricevono un
// indizio diretto, come ultima risorsa per garantire comunque l'unicità.
function genPoeticClues(numPlayers) {
  const numDigits = clamp(numPlayers, 2, 6);
  const digits = [randInt(1, 9)]; // la prima cifra non è mai 0
  for (let i = 1; i < numDigits; i++) digits.push(randInt(0, 9));
  const solution = Number(digits.join(''));

  const n = numDigits;
  const pool = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (digits[i] === digits[j]) {
        pool.push({ text: `Le cifre in posizione ${i + 1} e ${j + 1} sono UGUALI.`, deps: [i, j], test: (a) => a[i] === a[j] });
      } else {
        pool.push({ text: `Le cifre in posizione ${i + 1} e ${j + 1} sono DIVERSE tra loro.`, deps: [i, j], test: (a) => a[i] !== a[j] });
        pool.push(
          digits[i] > digits[j]
            ? { text: `La cifra in posizione ${i + 1} è maggiore di quella in posizione ${j + 1}.`, deps: [i, j], test: (a) => a[i] > a[j] }
            : { text: `La cifra in posizione ${j + 1} è maggiore di quella in posizione ${i + 1}.`, deps: [i, j], test: (a) => a[j] > a[i] }
        );
      }
      const s = digits[i] + digits[j];
      pool.push({ text: `La somma delle cifre in posizione ${i + 1} e ${j + 1} è ${s}.`, deps: [i, j], test: (a) => a[i] + a[j] === s });
    }
    pool.push({ text: `La cifra in posizione ${i + 1} è ${digits[i] % 2 === 0 ? 'PARI' : 'DISPARI'}.`, deps: [i], test: (a) => (a[i] % 2 === 0) === (digits[i] % 2 === 0) });
  }
  const directs = digits.map((d, i) => {
    const template = POETIC_TEMPLATES[randInt(0, POETIC_TEMPLATES.length - 1)];
    return { text: template(d, i + 1), deps: [i], test: (a) => a[i] === d };
  });

  const shuffledPool = shuffle(pool);
  const chosen = [];
  const isUnique = () => countSolutions(n, 10, chosen, 2) === 1;
  for (const c of shuffledPool) {
    if (isUnique()) break;
    chosen.push(c);
  }
  for (const c of shuffle(directs)) {
    if (isUnique()) break;
    chosen.push(c);
  }
  if (chosen.length < numPlayers) {
    const used = new Set(chosen);
    for (const c of [...shuffledPool, ...directs]) {
      if (chosen.length >= numPlayers) break;
      if (!used.has(c)) chosen.push(c);
    }
  }
  const clues = distributeClueTexts(chosen, numPlayers);
  const door = {
    type: 'poetic',
    title: 'Il Sussurro dei Numeri',
    instructions: `Il numero segreto ha ${numDigits} cifre. Quasi nessuno conosce una cifra esatta da solo: incrociate a voce gli indizi (confronti, somme, uguaglianze, pari/dispari) posizione per posizione per dedurre ogni cifra, poi inserite il numero completo.`,
    boardKind: 'number',
    board: null,
    choices: null,
    clues,
    solution,
  };
  door._testConstraints = chosen;
  door._testNumValues = 10;
  return door;
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

// ---- Il Domino Runico -----------------------------------------------------
// Nomi di rune usati SOLO nel testo degli indizi (non servono icone): un
// pool più ampio dei 6 simboli delle ruote evita che con 6 giocatori (7
// valori necessari nella catena) si sia costretti a ripetizioni.
const DOMINO_RUNES = ['Fuoco', 'Ghiaccio', 'Terra', 'Aria', 'Luce', 'Ombra', 'Tempo', 'Sangue'];

// Conta (fino a `cap`) quante catene complete e valide si possono formare con
// l'insieme di tessere date, partendo dalla faccia `startFace` (il sigillo
// pubblico): ogni tessera non ancora usata che abbia una faccia uguale al
// valore "richiesto" può proseguire la catena, in uno dei due versi.
function countDominoArrangements(tiles, startFace, cap) {
  const used = new Array(tiles.length).fill(false);
  let count = 0;
  function rec(needed, placed) {
    if (count >= cap) return;
    if (placed === tiles.length) { count++; return; }
    for (let t = 0; t < tiles.length; t++) {
      if (used[t] || count >= cap) continue;
      const { a, b } = tiles[t];
      if (a === needed) {
        used[t] = true;
        rec(b, placed + 1);
        used[t] = false;
      }
      if (b === needed && b !== a && count < cap) {
        used[t] = true;
        rec(a, placed + 1);
        used[t] = false;
      }
    }
  }
  rec(startFace, 0);
  return count;
}

// Ogni giocatore ha una tessera con due rune (una coppia consecutiva di una
// catena nascosta), senza sapere quale faccia va a sinistra o a destra. Un
// "sigillo" pubblico e fisso segna dove deve iniziare la catena (evita
// l'ambiguità classica del domino: la catena letta al contrario sarebbe
// altrettanto valida senza un punto di partenza riconoscibile). Prima di
// consegnare le tessere si verifica - per forza bruta, lo spazio di ricerca
// è piccolo - che esista UNA SOLA disposizione valida: altrimenti si
// rigenera la catena da capo.
function genDomino(numPlayers) {
  const n = numPlayers;
  let path;
  let naturalTiles;
  let attempts = 0;
  do {
    attempts++;
    path = Array.from({ length: n + 1 }, () => randInt(0, DOMINO_RUNES.length - 1));
    naturalTiles = Array.from({ length: n }, (_, i) => ({ a: path[i], b: path[i + 1] }));
  } while (
    (path[n] === path[0] || countDominoArrangements(naturalTiles, path[0], 2) !== 1)
    && attempts < 500
  );

  // Assegna le tessere "naturali" ai giocatori con un ordine casuale, così
  // "il giocatore N ha la tessera N-esima" non è mai una scorciatoia valida.
  const perm = shuffle(Array.from({ length: n }, (_, i) => i)); // perm[player] = posizione naturale della sua tessera
  const inversePerm = new Array(n);
  perm.forEach((naturalPos, player) => { inversePerm[naturalPos] = player; });

  const clues = perm.map((naturalPos) => {
    const t = naturalTiles[naturalPos];
    return `La tua tessera runica mostra due rune: ${DOMINO_RUNES[t.a]} e ${DOMINO_RUNES[t.b]}.`;
  });

  const door = {
    type: 'domino',
    title: 'Il Domino Runico',
    instructions: `Ogni giocatore ha in segreto una tessera con DUE rune (il tuo indizio qui sotto), ma non sa se vanno lette da sinistra a destra o al contrario. Passo 1: a turno, ognuno dice a voce le due rune della propria tessera. Passo 2: partendo dal Sigillo mostrato sul board (la runa di partenza fissa), decidete insieme quale tessera attacca per prima, facendo combaciare una faccia uguale al Sigillo. Passo 3: sul board, tocca il tuo gettone col numero qui sotto per selezionarlo, poi tocca lo slot della catena dove va messo; se il verso è sbagliato, tocca di nuovo lo slot pieno per capovolgerlo (⇨/⇦). Continuate finché la catena di ${n} tessere è completa senza buchi.`,
    boardKind: 'dominoChain',
    board: Array.from({ length: n }, () => null), // ogni slot: null oppure { player, flipped }
    choices: null,
    sealRune: DOMINO_RUNES[path[0]],
    clues,
    solution: { order: inversePerm, flipped: new Array(n).fill(false) },
    needsRoster: true,
  };
  // Solo per i test automatici: le tessere "naturali" nell'ordine corretto
  // e il sigillo, mai inviati al client (vedi whitelist in server.js).
  door._testTiles = naturalTiles;
  door._testSeal = path[0];
  return door;
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

// ---- v2.1: "La Serratura dei Numeri" e "La Serratura del Calcolo" erano
// strutturalmente identiche (numero privato -> lo si dice a voce -> un
// calcolo semplice) e senza vera deduzione: chi aveva il numero lo diceva e
// basta. Le due sono state unite in un solo enigma più profondo qui sotto
// ("La Cripta dei Numeri"), che usa lo stesso motore a vincoli relazionali
// di leve/ruote/colori/interruttori invece di dare mai il numero diretto.
// Ogni membro della squadra ha un numero segreto da 1 a NUMBER_VAULT_RANGE,
// ma nessuno lo conosce direttamente: si deduce incrociando confronti,
// somme a coppie e conteggi di numeri pari, poi si inserisce il numero DI
// OGNI giocatore nella casella corrispondente (serve la striscia roster).
const NUMBER_VAULT_RANGE = 20; // valori reali 1..20 (internamente 0..19, offset +1)

function genNumbersVault(numPlayers) {
  const n = numPlayers;
  const sol = Array.from({ length: n }, () => randInt(0, NUMBER_VAULT_RANGE - 1)); // dominio interno 0..19
  const pool = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (sol[i] === sol[j]) {
        pool.push({ text: `Il numero del Giocatore ${i + 1} e quello del Giocatore ${j + 1} sono UGUALI.`, deps: [i, j], test: (a) => a[i] === a[j] });
      } else if (sol[i] > sol[j]) {
        pool.push({ text: `Il numero del Giocatore ${i + 1} è maggiore di quello del Giocatore ${j + 1}.`, deps: [i, j], test: (a) => a[i] > a[j] });
      } else {
        pool.push({ text: `Il numero del Giocatore ${j + 1} è maggiore di quello del Giocatore ${i + 1}.`, deps: [i, j], test: (a) => a[j] > a[i] });
      }
      const realSum = sol[i] + sol[j] + 2; // +2 = offset di +1 su ciascuno dei due valori reali
      pool.push({ text: `La somma dei numeri del Giocatore ${i + 1} e del Giocatore ${j + 1} è ${realSum}.`, deps: [i, j], test: (a) => a[i] + a[j] === sol[i] + sol[j] });
    }
    pool.push({ text: `Il numero del Giocatore ${i + 1} è ${sol[i] % 2 === 0 ? 'PARI' : 'DISPARI'}.`, deps: [i], test: (a) => (a[i] % 2 === 0) === (sol[i] % 2 === 0) });
  }
  const evenCount = sol.filter((v) => v % 2 === 0).length;
  pool.push({
    text: evenCount === 0 ? 'In totale, nessun giocatore ha un numero pari.' : `In totale, esattamente ${evenCount} giocatori hanno un numero pari.`,
    test: (a) => a.filter((v) => v % 2 === 0).length === evenCount,
  });
  const directs = sol.map((v, i) => ({ text: `Il numero del Giocatore ${i + 1} è ${v + 1}.`, deps: [i], test: (a) => a[i] === v }));

  const shuffledPool = shuffle(pool);
  const chosen = [];
  const isUnique = () => countSolutions(n, NUMBER_VAULT_RANGE, chosen, 2) === 1;
  for (const c of shuffledPool) {
    if (isUnique()) break;
    chosen.push(c);
  }
  for (const c of shuffle(directs)) {
    if (isUnique()) break;
    chosen.push(c);
  }
  if (chosen.length < n) {
    const used = new Set(chosen);
    for (const c of [...shuffledPool, ...directs]) {
      if (chosen.length >= n) break;
      if (!used.has(c)) chosen.push(c);
    }
  }
  const clues = distributeClueTexts(chosen, n);
  const door = {
    type: 'numbers',
    title: 'La Cripta dei Numeri',
    instructions: `Ogni membro della squadra ha un numero segreto da 1 a ${NUMBER_VAULT_RANGE}, ma nessuno lo conosce direttamente: incrociate a voce gli indizi (confronti, somme, pari/dispari...) per dedurre il numero di ognuno, poi inserite il numero del Giocatore N nella casella N. Guarda l'elenco dei numeri della squadra qui sopra.`,
    boardKind: 'sequenceSlots',
    board: Array(n).fill(null),
    choices: null,
    clues,
    solution: sol.map((v) => v + 1),
    needsRoster: true,
  };
  door._testConstraints = chosen;
  door._testNumValues = NUMBER_VAULT_RANGE;
  return door;
}

// v2.1: prima era un solo simbolo, un solo "narratore" lo descriveva e gli
// altri sceglievano tra 4 icone senza nessuna informazione propria - un
// mimo semplice, zero deduzione per il resto della squadra ("molto base" nel
// feedback reale). Ora sono 3 simboli da azzeccare: il narratore li vede e
// li descrive tutti e tre a voce (senza mai nominarli), ma il resto della
// squadra riceve ANCHE indizi relazionali incrociati tra i 3 simboli (stesso
// motore a vincoli di ruote/colori/interruttori) da usare per verificare e
// correggere quello che sentono - mimo E logica insieme, molto più lungo.
const GUESS_SLOT_COUNT = 3;

function genGuessSymbol(numPlayers) {
  const n = Math.min(GUESS_SLOT_COUNT, WHEEL_SYMBOLS.length);
  const sol = Array.from({ length: n }, () => randInt(0, WHEEL_SYMBOLS.length - 1));
  const describerIndex = randInt(0, numPlayers - 1);
  const listenerCount = Math.max(1, numPlayers - 1);
  const chosen = pickConstraints(sol, WHEEL_SYMBOLS.length, 'wheels', listenerCount);
  const buckets = distributeClueTexts(chosen, listenerCount);

  const clues = [];
  let bi = 0;
  for (let i = 0; i < numPlayers; i++) {
    if (i === describerIndex) {
      const list = sol.map((v, idx) => `simbolo ${idx + 1} = ${WHEEL_SYMBOLS[v].label}`).join(', ');
      clues.push(`Tu vedi tutti e ${n} i simboli corretti, ma NON puoi mai nominarli: descrivili a voce uno alla volta (forma, cosa rappresentano, a cosa somigliano...) finché la squadra non li indovina. In ordine: ${list}.`);
    } else {
      clues.push(buckets[bi] || 'Nessun indizio diretto per te: ascolta chi descrive e incrocialo con quello che dicono gli altri.');
      bi++;
    }
  }
  const door = {
    type: 'guess',
    title: 'Lo Specchio dei Simboli',
    instructions: `Un solo membro della squadra vede i ${n} simboli corretti e li descrive a voce, uno alla volta, senza mai nominarli. Tutti gli altri hanno anche indizi incrociati sulle relazioni tra i simboli (uguali, diversi, quanti in totale...): usateli per verificare quello che sentite, poi toccate le ruote per farle girare.`,
    boardKind: 'wheelSlots',
    board: Array(n).fill(0),
    choices: null,
    clues,
    solution: sol,
  };
  door._testConstraints = chosen;
  door._testNumValues = WHEEL_SYMBOLS.length;
  return door;
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
  numbers: genNumbersVault,
  scale: genScale,
  poetic: genPoeticClues,
  liar: genLiarClue,
  levers: genLevers,
  wheels: genWheels,
  colors: genColors,
  toggles: genToggles,
  domino: genDomino,
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
    case 'dominoChain': {
      if (!Array.isArray(board) || board.length !== door.solution.order.length) return false;
      return board.every((slot, i) => (
        slot != null && slot.player === door.solution.order[i] && Boolean(slot.flipped) === Boolean(door.solution.flipped[i])
      ));
    }
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
    case 'dominoChain': {
      if (!action || action.slot == null || action.slot < 0 || action.slot >= b.length) return board;
      if (action.kind === 'placeTile') {
        const player = Math.round(Number(action.player));
        if (!Number.isFinite(player) || player < 0 || player >= b.length) return board;
        // Ogni giocatore ha una sola tessera: se era già posizionata altrove,
        // la si "toglie" da lì prima di metterla nel nuovo slot.
        for (let i = 0; i < b.length; i++) {
          if (b[i] && b[i].player === player) b[i] = null;
        }
        b[action.slot] = { player, flipped: !!action.flipped };
        return b;
      }
      if (action.kind === 'clearSlot') {
        b[action.slot] = null;
        return b;
      }
      if (action.kind === 'flipSlot') {
        if (b[action.slot]) b[action.slot] = { ...b[action.slot], flipped: !b[action.slot].flipped };
        return b;
      }
      return board;
    }
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
  countPermutations,
  countDominoArrangements,
  DOMINO_RUNES,
};
