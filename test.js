// Test della logica pura di "La Torre degli Enigmi" (node test.js)
const assert = require('assert');
const {
  DOOR_COUNT, TOTAL_TIME_MS, PENALTY_MS, PENALTY_BASE_MS, PENALTY_STEP_MS,
  SPEED_BONUS_THRESHOLD_MS, SPEED_BONUS_MS, FINAL_DOOR_PENALTY_MULTIPLIER,
  DOOR_TYPES, WHEEL_SYMBOLS, COLORS,
  generateDoor, generateDoors, randomDoorPlan, checkBoardCorrect, applyBoardUpdate,
  penaltyForAttempt, speedBonusFor, numberRiddleClue, countSolutions,
  countPermutations, countDominoArrangements, DOMINO_RUNES,
} = require('./gameLogic');

// Riconosce i 4 formati prodotti da numberRiddleClue e ne ricalcola il valore:
// serve a verificare (qui e nei test end-to-end sulla somma) che ogni indizio
// "a calcolo" incorpori davvero il numero corretto, non solo che esista.
function parseNumberRiddle(text) {
  let m;
  if ((m = text.match(/è (\d+) più (\d+)\./))) return Number(m[1]) + Number(m[2]);
  if ((m = text.match(/è (\d+) meno (\d+)\./))) return Number(m[1]) - Number(m[2]);
  if ((m = text.match(/è il doppio di (\d+)\./))) return Number(m[1]) * 2;
  if ((m = text.match(/è (\d+) moltiplicato per (\d+)\./))) return Number(m[1]) * Number(m[2]);
  throw new Error('Formato di indizio numerico non riconosciuto: ' + text);
}

let passed = 0;
function check(desc, cond) {
  assert.ok(cond, desc);
  passed++;
  console.log('  ok -', desc);
}

check('ci sono 13 tipi di porta', DOOR_TYPES.length === 13);
check('parametri di partita sensati', DOOR_COUNT >= 3 && TOTAL_TIME_MS > 0 && PENALTY_MS > 0);

// ---- Ogni generatore produce una porta valida e coerente -----------------
for (const type of DOOR_TYPES) {
  for (const numPlayers of [2, 3, 4, 6]) {
    const door = generateDoor(type, numPlayers);
    check(`[${type}/${numPlayers}p] ha titolo, istruzioni, boardKind`, !!door.title && !!door.instructions && !!door.boardKind);
    check(`[${type}/${numPlayers}p] ha esattamente ${numPlayers} indizi (uno a testa)`, door.clues.length === numPlayers);
  }
}

// ---- numberRiddleClue: il "calcolo" nell'indizio incorpora SEMPRE il valore giusto ----
for (let i = 0; i < 60; i++) {
  const target = randIntForTest(2, 20);
  const text = numberRiddleClue(target);
  check(`numberRiddleClue: "${text}" corrisponde davvero a ${target}`, parseNumberRiddle(text) === target);
}
function randIntForTest(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }

// ---- sum: la soluzione è davvero la somma dei numeri nascosti negli indizi-calcolo ----
{
  const door = generateDoor('sum', 4);
  const nums = door.clues.map((c) => parseNumberRiddle(c));
  check('sum: la soluzione è la somma dei numeri nascosti negli indizi', nums.reduce((a, b) => a + b, 0) === door.solution);
}

// ---- scale (La Bilancia degli Antenati): l'ordine dei giocatori per peso è deducibile CON CERTEZZA dai confronti a coppie ----
for (const numPlayers of [2, 3, 4, 6]) {
  const door = generateDoor('scale', numPlayers);
  check(`scale/${numPlayers}p: ha ${numPlayers} indizi (uno a testa)`, door.clues.length === numPlayers);
  check(`scale/${numPlayers}p: richiede il roster dei numeri giocatore`, door.needsRoster === true);
  check(
    `scale/${numPlayers}p: la soluzione è una permutazione valida dei numeri dei ${numPlayers} giocatori`,
    door.solution.length === numPlayers && new Set(door.solution).size === numPlayers && door.solution.every((v) => v >= 1 && v <= numPlayers)
  );
  check(
    `scale/${numPlayers}p: i confronti assegnati determinano UN SOLO ordinamento possibile (nessuna ambiguità)`,
    countPermutations(numPlayers, door._testConstraints, 2) === 1
  );
}

// ---- poetic: il numero segreto è ricostruibile CON CERTEZZA dalle cifre --
for (const numPlayers of [2, 3, 4, 5, 6]) {
  const door = generateDoor('poetic', numPlayers);
  const X = door.solution;
  const digitsFromSolution = String(X).split('').map(Number);
  check(`poetic/${numPlayers}p: il numero segreto ha esattamente ${numPlayers} cifre`, digitsFromSolution.length === numPlayers);
  const parsed = door.clues.map((c) => {
    // Frasi variate ("poetiche"): la cifra e la posizione possono comparire
    // in ordine diverso a seconda del modello scelto, quindi si estraggono
    // in modo indipendente invece di pretendere un ordine fisso.
    const dm = c.match(/cifra è (\d)/);
    const pm = c.match(/posizione (\d+)/);
    return { digit: Number(dm[1]), pos: Number(pm[1]) };
  });
  const rebuilt = Array(numPlayers).fill(null);
  parsed.forEach((p) => { rebuilt[p.pos - 1] = p.digit; });
  check(`poetic/${numPlayers}p: ricostruendo le cifre dagli indizi (posizione per posizione) si ottiene ESATTAMENTE la soluzione, senza ambiguità`, Number(rebuilt.join('')) === X);
  check(`poetic/${numPlayers}p: la prima cifra non è 0 (altrimenti il numero avrebbe meno cifre)`, digitsFromSolution[0] !== 0);
}

// ---- liar: il numero corretto è tra le opzioni, e ogni indizio distingue davvero qualcosa tra le 4 opzioni ----
for (const numPlayers of [2, 3, 4, 6]) {
  const door = generateDoor('liar', numPlayers);
  check(`liar/${numPlayers}p: la soluzione è tra le 4 opzioni mostrate`, door.choices.includes(door.solution));
  check(`liar/${numPlayers}p: ci sono 4 opzioni distinte`, new Set(door.choices).size === 4);
  // Nessun indizio deve essere vero (o falso) per TUTTE E 4 le opzioni: altrimenti
  // sarebbe un indizio inutile che non aiuta a scartare nessun candidato (il bug
  // segnalato: "potrebbe essere qualunque numero").
  const evalClue = (text, n) => {
    const gt = text.match(/maggiore di (\d+)/);
    if (gt) return n > Number(gt[1]);
    const lt = text.match(/minore di (\d+)/);
    if (lt) return n < Number(lt[1]);
    if (text.includes('pari.') && !text.includes('dispari')) return n % 2 === 0;
    if (text.includes('dispari.')) return n % 2 === 1;
    return null;
  };
  door.clues.forEach((c) => {
    const results = door.choices.map((n) => evalClue(c, n));
    const discriminates = results.some((r) => r) && results.some((r) => !r);
    check(`liar/${numPlayers}p: l'indizio "${c}" distingue almeno un'opzione dalle altre (non è vero/falso per tutte e 4)`, discriminates);
  });
}

// ---- levers/wheels/colors/toggles: board iniziale, dominio della soluzione, E -----
// unicità reale della soluzione rispetto agli indizi assegnati (il punto
// centrale della riscrittura "usa il cervello": mai un enigma con più di una
// soluzione possibile date le informazioni distribuite alla squadra).
for (const numPlayers of [2, 3, 4, 6]) {
  for (const type of ['levers', 'wheels', 'colors', 'toggles']) {
    const door = generateDoor(type, numPlayers);
    check(`${type}/${numPlayers}p: ha ${numPlayers} indizi (uno a testa)`, door.clues.length === numPlayers);
    check(
      `${type}/${numPlayers}p: gli indizi assegnati determinano UNA SOLA soluzione possibile (nessuna ambiguità)`,
      countSolutions(numPlayers, door._testNumValues, door._testConstraints, 2) === 1
    );
  }
}
{
  const door = generateDoor('levers', 3);
  check('levers: 3 leve, tutte a 0 all\'inizio', JSON.stringify(door.board) === JSON.stringify([0, 0, 0]));
  check('levers: la soluzione ha 3 valori tra 0 e sliderMax', door.solution.every((v) => v >= 0 && v <= door.sliderMax));
}
{
  const door = generateDoor('wheels', 3);
  check('wheels: 3 ruote, tutte su indice 0 all\'inizio', JSON.stringify(door.board) === JSON.stringify([0, 0, 0]));
  check('wheels: la soluzione ha indici validi', door.solution.every((v) => v >= 0 && v < WHEEL_SYMBOLS.length));
}
{
  const door = generateDoor('colors', 3);
  check('colors: 3 caselle, tutte su indice 0 all\'inizio', JSON.stringify(door.board) === JSON.stringify([0, 0, 0]));
  check('colors: la soluzione ha indici colore validi', door.solution.every((v) => v >= 0 && v < COLORS.length));
}
{
  const door = generateDoor('toggles', 3);
  check('toggles: 3 interruttori, tutti spenti all\'inizio', JSON.stringify(door.board) === JSON.stringify([false, false, false]));
  check('toggles: la soluzione è fatta di booleani', door.solution.every((v) => typeof v === 'boolean'));
}

// ---- domino (Il Domino Runico): la catena runica è ricostruibile CON CERTEZZA a partire dal sigillo, senza ambiguità di verso ----
for (const numPlayers of [2, 3, 4, 6]) {
  const door = generateDoor('domino', numPlayers);
  check(`domino/${numPlayers}p: ha ${numPlayers} indizi (uno a testa)`, door.clues.length === numPlayers);
  check(`domino/${numPlayers}p: richiede il roster dei numeri giocatore`, door.needsRoster === true);
  check(`domino/${numPlayers}p: ha un sigillo di partenza pubblico`, DOMINO_RUNES.includes(door.sealRune));
  check(`domino/${numPlayers}p: ci sono esattamente ${numPlayers} tessere`, door._testTiles.length === numPlayers);
  check(
    `domino/${numPlayers}p: dato il sigillo, esiste UNA SOLA catena valida con queste tessere (nessuna ambiguità, nemmeno per inversione)`,
    countDominoArrangements(door._testTiles, door._testSeal, 2) === 1
  );
  // door.solution.order[slot] = indice del giocatore la cui tessera va in quello slot.
  // Verifica diretta: per ogni giocatore, la sua tessera (quella descritta nel SUO indizio)
  // deve combaciare in catena nella posizione indicata dalla soluzione.
  const tileForClue = (text) => {
    const m = text.match(/rune: (\w+) e (\w+)\./);
    return { a: DOMINO_RUNES.indexOf(m[1]), b: DOMINO_RUNES.indexOf(m[2]) };
  };
  const playerTiles = door.clues.map(tileForClue);
  let needed = door._testSeal;
  let chainOk = true;
  for (let slot = 0; slot < numPlayers; slot++) {
    const playerIdx = door.solution.order[slot];
    const flipped = door.solution.flipped[slot];
    const t = playerTiles[playerIdx];
    const face = flipped ? t.b : t.a;
    const other = flipped ? t.a : t.b;
    if (face !== needed) { chainOk = false; break; }
    needed = other;
  }
  check(`domino/${numPlayers}p: applicando l'ordine e l'orientamento della soluzione, la catena combacia rune-su-rune dal sigillo in poi`, chainOk);
}

// ---- map (La Mappa Strappata): stesso principio di "missing", più i dati per la resa visiva (`cells`) ----
for (const numPlayers of [2, 3, 4, 6]) {
  const door = generateDoor('map', numPlayers);
  check(`map/${numPlayers}p: ha ${numPlayers + 1} celle totali`, door.cells.length === numPlayers + 1);
  check(`map/${numPlayers}p: esattamente una cella è "missing"`, door.cells.filter((c) => c.missing).length === 1);
  const missingCell = door.cells.find((c) => c.missing);
  check(`map/${numPlayers}p: la cella mancante non ha un valore visibile`, missingCell.value === null);
  const known = door.cells.filter((c) => !c.missing).sort((a, b) => a.pos - b.pos);
  const steps = [];
  for (let i = 1; i < known.length; i++) steps.push((known[i].value - known[0].value) / (known[i].pos - known[0].pos));
  check(`map/${numPlayers}p: tutte le celle note condividono lo stesso passo costante`, steps.every((s) => s === steps[0]));
  const reconstructed = known[0].value + steps[0] * (missingCell.pos - known[0].pos);
  check(`map/${numPlayers}p: il passo dedotto ricostruisce ESATTAMENTE il valore mancante`, reconstructed === door.solution);
  check(`map/${numPlayers}p: ha ${numPlayers} indizi (uno a testa)`, door.clues.length === numPlayers);
}

// ---- penaltyForAttempt / speedBonusFor: crescita, tetto porta finale, niente bonus sull'ultima porta ----
{
  check('penaltyForAttempt: il primo errore costa la penalità base', penaltyForAttempt(1, false) === PENALTY_BASE_MS);
  check('penaltyForAttempt: il secondo errore costa di più del primo (crescente)', penaltyForAttempt(2, false) > penaltyForAttempt(1, false));
  check('penaltyForAttempt: il terzo errore costa ancora di più del secondo', penaltyForAttempt(3, false) > penaltyForAttempt(2, false));
  check('penaltyForAttempt: sull\'ultima porta la stessa sequenza di errori costa sempre di più', penaltyForAttempt(1, true) > penaltyForAttempt(1, false));
  check('speedBonusFor: risolvendo entro la soglia si ottiene il bonus pieno', speedBonusFor(SPEED_BONUS_THRESHOLD_MS - 1, false) === SPEED_BONUS_MS);
  check('speedBonusFor: risolvendo oltre la soglia non c\'è bonus', speedBonusFor(SPEED_BONUS_THRESHOLD_MS + 1, false) === 0);
  check('speedBonusFor: sull\'ultima porta non c\'è MAI bonus, anche se velocissimi', speedBonusFor(1, true) === 0);
}

// ---- operation: la soluzione corrisponde davvero all'operazione dichiarata (su tante generazioni, copre tutti gli operatori) ----
{
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    const door = generateDoor('operation', 4);
    const nums = door.clues.map((c) => Number(c.match(/\d+/)[0]));
    const sum = nums.reduce((a, b) => a + b, 0);
    const diff = Math.max(...nums) - Math.min(...nums);
    const prod = nums.reduce((a, b) => a * b, 1);
    const evens = nums.filter((n) => n % 2 === 0).length;
    const matches = [sum, diff, prod, evens].includes(door.solution);
    check('operation: la soluzione corrisponde a una delle operazioni possibili sui numeri indicati', matches);
    if (door.instructions.includes('Sommate')) seen.add('somma');
    if (door.instructions.includes('differenza')) seen.add('differenza');
    if (door.instructions.includes('Moltiplicate')) seen.add('prodotto');
    if (door.instructions.includes('PARI')) seen.add('pari');
  }
  check('operation: su molte generazioni compaiono tutti e 4 gli operatori (somma/differenza/prodotto/pari)', seen.size === 4);
}

// ---- guess: la soluzione è tra le 4 opzioni, un solo giocatore ha l'indizio vero ----
for (const numPlayers of [2, 3, 4, 6]) {
  const door = generateDoor('guess', numPlayers);
  check(`guess/${numPlayers}p: la soluzione è tra le opzioni mostrate`, door.choices.includes(door.solution));
  check(`guess/${numPlayers}p: ci sono 4 opzioni distinte`, new Set(door.choices).size === 4);
  const describers = door.clues.filter((c) => c.startsWith('Devi DESCRIVERE'));
  check(`guess/${numPlayers}p: esattamente un giocatore deve descrivere il simbolo`, describers.length === 1);
  check(`guess/${numPlayers}p: gli altri ${numPlayers - 1} non hanno indizio`, door.clues.length - describers.length === numPlayers - 1);
}

// ---- timeLever: un solo giocatore conosce il target, tolleranza applicata correttamente ----
for (const numPlayers of [2, 3, 4, 6]) {
  const door = generateDoor('timeLever', numPlayers);
  check(`timeLever/${numPlayers}p: la soluzione è un valore singolo tra 0 e 100`, door.solution.length === 1 && door.solution[0] >= 0 && door.solution[0] <= 100);
  const guides = door.clues.filter((c) => c.startsWith('Solo tu conosci'));
  check(`timeLever/${numPlayers}p: esattamente un giocatore conosce il target`, guides.length === 1);
  check('timeLever: un valore esatto è sempre corretto', checkBoardCorrect(door, door.solution));
  check('timeLever: un valore a distanza 3 (dentro la tolleranza) è corretto', checkBoardCorrect(door, [door.solution[0] + 3]) || door.solution[0] + 3 > 100);
  check('timeLever: un valore a distanza 10 (fuori tolleranza) NON è corretto', !checkBoardCorrect(door, [Math.max(0, door.solution[0] - 10)]));
}

// ---- applyBoardUpdate: rispetta i limiti e ignora azioni incompatibili ----
{
  const door = generateDoor('sum', 3);
  let board = door.board;
  board = applyBoardUpdate(door, board, { kind: 'setNumber', value: 42 });
  check('number: setNumber imposta il valore', board === 42);
  board = applyBoardUpdate(door, board, { kind: 'setSlot', slot: 0, value: 5 });
  check('number: un\'azione incompatibile (setSlot su una porta "number") viene ignorata', board === 42);
}
{
  const door = generateDoor('levers', 3);
  let board = door.board;
  board = applyBoardUpdate(door, board, { kind: 'setSlot', slot: 1, value: 15 });
  check('levers: setSlot rispetta il limite massimo (door.sliderMax)', board[1] === door.sliderMax);
  board = applyBoardUpdate(door, board, { kind: 'setSlot', slot: 1, value: -5 });
  check('levers: setSlot rispetta il limite minimo (0)', board[1] === 0);
  board = applyBoardUpdate(door, board, { kind: 'setSlot', slot: 99, value: 5 });
  check('levers: uno slot fuori range viene ignorato (nessun crash, board invariato)', board[1] === 0);
}
{
  const door = generateDoor('wheels', 3);
  let board = door.board;
  for (let i = 0; i < WHEEL_SYMBOLS.length; i++) {
    board = applyBoardUpdate(door, board, { kind: 'cycleSlot', slot: 0 });
  }
  check('wheels: dopo un giro completo la ruota torna al simbolo di partenza', board[0] === 0);
}
{
  const door = generateDoor('toggles', 3);
  let board = door.board;
  board = applyBoardUpdate(door, board, { kind: 'toggleSlot', slot: 2 });
  check('toggles: toggleSlot accende un interruttore spento', board[2] === true);
  board = applyBoardUpdate(door, board, { kind: 'toggleSlot', slot: 2 });
  check('toggles: toggleSlot rispegne un interruttore acceso', board[2] === false);
}

// ---- checkBoardCorrect: riconosce sia il successo sia il fallimento -------
{
  const door = generateDoor('sum', 3);
  check('sum: board vuoto (null) non è la soluzione (salvo che la somma sia 0, impossibile qui)', !checkBoardCorrect(door, null));
  check('sum: il valore esatto della soluzione viene riconosciuto come corretto', checkBoardCorrect(door, door.solution));
}
{
  const door = generateDoor('levers', 3);
  check('levers: il board di partenza (tutto a 0) è corretto solo se la soluzione è [0,0,0] (raro)', checkBoardCorrect(door, [0, 0, 0]) === (JSON.stringify(door.solution) === JSON.stringify([0, 0, 0])));
  check('levers: la soluzione esatta viene sempre riconosciuta come corretta', checkBoardCorrect(door, door.solution));
}

// ---- generateDoors / randomDoorPlan: niente ripetizioni immediate, tipi validi ----
{
  const plan = randomDoorPlan(20);
  check('randomDoorPlan: lunghezza corretta', plan.length === 20);
  let noImmediateRepeat = true;
  for (let i = 1; i < plan.length; i++) if (plan[i] === plan[i - 1]) noImmediateRepeat = false;
  check('randomDoorPlan: nessuna porta uguale a quella immediatamente precedente', noImmediateRepeat);
  check('randomDoorPlan: tutti i tipi generati sono validi', plan.every((t) => DOOR_TYPES.includes(t)));
}
{
  const doors = generateDoors(DOOR_COUNT, 4);
  check(`generateDoors: genera esattamente ${DOOR_COUNT} porte`, doors.length === DOOR_COUNT);
  check('generateDoors: ogni porta ha 4 indizi (uno a giocatore)', doors.every((d) => d.clues.length === 4));
}

// ---- Con 2 giocatori "liar" non deve mai comparire (indeducibile senza un terzo punto di vista) ----
{
  const plan = randomDoorPlan(40, 2);
  check('randomDoorPlan/2p: "liar" non compare mai su 40 porte generate per una coppia', !plan.includes('liar'));
  const doors = generateDoors(DOOR_COUNT, 2);
  check('generateDoors/2p: nessuna delle porte generate è "liar"', doors.every((d) => d.type !== 'liar'));
}
{
  const plan = randomDoorPlan(40, 3);
  check('randomDoorPlan/3p: "liar" può comparire con 3 o più giocatori', plan.includes('liar') || DOOR_TYPES.length > 40 /* fallback improbabile */);
}

// ---- Simulazione end-to-end: risolvere una torre intera applicando la
// soluzione esatta a ogni porta deve sempre concludersi con successo, per
// ogni numero di giocatori, senza mai bloccarsi. ----------------------------
for (const numPlayers of [2, 3, 4, 5, 6]) {
  const doors = generateDoors(DOOR_COUNT, numPlayers);
  let allSolved = true;
  doors.forEach((door) => {
    let board = door.board;
    if (door.boardKind === 'number') {
      board = applyBoardUpdate(door, board, { kind: 'setNumber', value: door.solution });
    } else if (door.boardKind === 'choice') {
      board = applyBoardUpdate(door, board, { kind: 'setChoice', value: door.solution });
    } else if (door.boardKind === 'sequenceSlots' || door.boardKind === 'sliderSlots') {
      door.solution.forEach((v, i) => {
        board = applyBoardUpdate(door, board, { kind: 'setSlot', slot: i, value: v });
      });
    } else if (door.boardKind === 'wheelSlots') {
      door.solution.forEach((target, i) => {
        for (let s = 0; s < target; s++) board = applyBoardUpdate(door, board, { kind: 'cycleSlot', slot: i });
      });
    } else if (door.boardKind === 'colorSlots') {
      door.solution.forEach((target, i) => {
        for (let s = 0; s < target; s++) board = applyBoardUpdate(door, board, { kind: 'cycleSlot', slot: i });
      });
    } else if (door.boardKind === 'toggleSlots') {
      door.solution.forEach((target, i) => {
        if (target === true) board = applyBoardUpdate(door, board, { kind: 'toggleSlot', slot: i });
      });
    } else if (door.boardKind === 'dominoChain') {
      door.solution.order.forEach((playerIdx, slot) => {
        board = applyBoardUpdate(door, board, { kind: 'placeTile', slot, player: playerIdx, flipped: door.solution.flipped[slot] });
      });
    }
    if (!checkBoardCorrect(door, board)) allSolved = false;
  });
  check(`simulazione ${numPlayers} giocatori: applicando la soluzione esatta ogni porta risulta risolta`, allSolved);
}

console.log(`\n✅ Totale ${passed} controlli superati su gameLogic.js (La Torre degli Enigmi).`);
