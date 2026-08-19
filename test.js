// Test della logica pura di "La Torre degli Enigmi" (node test.js)
//
// NOTA v2.4: questo file era rimasto fermo alla v1 (parlava ancora di tipi
// di porta ritirati da tempo: "sum", "operation", "toggles", "map", del
// vecchio "guess" a 1 simbolo/4 scelte...) perché nelle consegne v2.1/v2.2/
// v2.3 non era mai stato caricato in sessione - la verifica veniva fatta con
// harness manuali temporanei (verify.js, non nel repo). Da qui in poi
// aggiornarlo ad ogni consegna che tocca gameLogic.js, esattamente come gli
// altri file: è la fonte di verità che l'utente può rilanciare da solo con
// "node test.js" / "npm test" in qualunque momento, gli harness temporanei
// restano un ripiego per le sessioni in cui questo file non è disponibile.
const assert = require('assert');
const {
  DOOR_COUNT, TOTAL_TIME_MS, PENALTY_MS, PENALTY_BASE_MS, PENALTY_STEP_MS,
  SPEED_BONUS_THRESHOLD_MS, SPEED_BONUS_MS, FINAL_DOOR_PENALTY_MULTIPLIER,
  DOOR_TYPES, WHEEL_SYMBOLS, COLORS,
  generateDoor, generateDoors, randomDoorPlan, checkBoardCorrect, applyBoardUpdate,
  penaltyForAttempt, speedBonusFor, numberRiddleClue, countSolutions,
  countPermutations, countDominoArrangements, countMatchings, DOMINO_RUNES, LOCK_TAG,
} = require('./gameLogic');

function parseNumberRiddle(text) {
  let m;
  if ((m = text.match(/è (\d+) più (\d+)\./))) return Number(m[1]) + Number(m[2]);
  if ((m = text.match(/è (\d+) meno (\d+)\./))) return Number(m[1]) - Number(m[2]);
  if ((m = text.match(/è il doppio di (\d+)\./))) return Number(m[1]) * 2;
  if ((m = text.match(/è (\d+) moltiplicato per (\d+)\./))) return Number(m[1]) * Number(m[2]);
  throw new Error('Formato di indizio numerico non riconosciuto: ' + text);
}
function randIntForTest(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }

let passed = 0;
function check(desc, cond) {
  assert.ok(cond, desc);
  passed++;
  console.log('  ok -', desc);
}

check('ci sono 13 tipi di porta', DOOR_TYPES.length === 13);
check('nessun tipo ritirato è ancora presente (sum/operation/toggles/map)', ['sum', 'operation', 'toggles', 'map'].every((t) => !DOOR_TYPES.includes(t)));
check('parametri di partita sensati', DOOR_COUNT >= 3 && TOTAL_TIME_MS > 0 && PENALTY_MS > 0);

// ---- Ogni generatore produce una porta valida e coerente -----------------
for (const type of DOOR_TYPES) {
  for (const numPlayers of [2, 3, 4, 6]) {
    if (type === 'liar' && numPlayers < 3) continue;
    const door = generateDoor(type, numPlayers);
    check(`[${type}/${numPlayers}p] ha titolo, istruzioni, boardKind`, !!door.title && !!door.instructions && !!door.boardKind);
    check(`[${type}/${numPlayers}p] ha esattamente ${numPlayers} indizi (uno a testa)`, door.clues.length === numPlayers);
  }
}

// ---- numberRiddleClue: il "calcolo" nell'indizio incorpora SEMPRE il valore giusto (funzione ancora esportata, oggi non usata da nessun generatore attivo) ----
for (let i = 0; i < 30; i++) {
  const target = randIntForTest(2, 20);
  const text = numberRiddleClue(target);
  check(`numberRiddleClue: "${text}" corrisponde davvero a ${target}`, parseNumberRiddle(text) === target);
}

// ---- v2.1 "ruolo vincolato" (LOCK_TAG): esattamente un giocatore bloccato per i 3 tipi che lo usano, mai per gli altri ----
const LOCKED_TYPES = new Set(['timeLever', 'guess', 'poetic']);
for (const type of DOOR_TYPES) {
  for (const numPlayers of [2, 3, 4, 6]) {
    if (type === 'liar' && numPlayers < 3) continue;
    const door = generateDoor(type, numPlayers);
    const lockedCount = door.clues.filter((c) => c.startsWith(LOCK_TAG)).length;
    if (LOCKED_TYPES.has(type)) {
      check(`[${type}/${numPlayers}p] esattamente 1 indizio ha il marcatore "ruolo vincolato"`, lockedCount === 1);
    } else {
      check(`[${type}/${numPlayers}p] nessun indizio ha il marcatore "ruolo vincolato" (non previsto per questo tipo)`, lockedCount === 0);
    }
  }
}

// ---- numbers (La Cripta dei Numeri): i numeri 1..20 sono ricostruibili CON CERTEZZA dagli indizi relazionali ----
for (const numPlayers of [2, 3, 4, 6]) {
  const door = generateDoor('numbers', numPlayers);
  check(`numbers/${numPlayers}p: richiede il roster dei numeri giocatore`, door.needsRoster === true);
  check(`numbers/${numPlayers}p: la soluzione ha ${numPlayers} valori tra 1 e 20`, door.solution.length === numPlayers && door.solution.every((v) => v >= 1 && v <= 20));
  check(
    `numbers/${numPlayers}p: gli indizi assegnati determinano UNA SOLA soluzione possibile (nessuna ambiguità)`,
    countSolutions(numPlayers, door._testNumValues, door._testConstraints, 2) === 1
  );
}

// ---- scale (La Bilancia degli Antenati): l'ordine dei giocatori per peso è deducibile CON CERTEZZA dai confronti a coppie ----
for (const numPlayers of [2, 3, 4, 6]) {
  const door = generateDoor('scale', numPlayers);
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

// ---- poetic (Il Sussurro dei Numeri): cifre dedotte da indizi relazionali, più un Custode vincolato con un'ancora certa ----
for (const numPlayers of [2, 3, 4, 5, 6]) {
  const door = generateDoor('poetic', numPlayers);
  const X = door.solution;
  const numDigits = String(X).length;
  check(`poetic/${numPlayers}p: il numero segreto ha esattamente ${numPlayers} cifre`, numDigits === numPlayers);
  check(`poetic/${numPlayers}p: la prima cifra non è 0`, String(X)[0] !== '0');
  check(
    `poetic/${numPlayers}p: gli indizi (Custode incluso) determinano UNA SOLA soluzione a ${numPlayers} cifre`,
    countSolutions(numPlayers, door._testNumValues, door._testConstraints, 2) === 1
  );
  const custode = door.clues.find((c) => c.startsWith(LOCK_TAG));
  check(`poetic/${numPlayers}p: il Custode ha un'ancora "conosci questa cifra con certezza"`, !!custode && custode.includes('conosci questa cifra con certezza'));
}

// ---- liar (La Porta del Bugiardo): 1 bugiardo sotto i 5 giocatori, 2 da 5 in su; la verità resta sempre in maggioranza ----
for (const numPlayers of [3, 4, 5, 6]) {
  const door = generateDoor('liar', numPlayers);
  check(`liar/${numPlayers}p: la soluzione è tra le 4 opzioni mostrate`, door.choices.includes(door.solution));
  check(`liar/${numPlayers}p: ci sono 4 opzioni distinte`, new Set(door.choices).size === 4);
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
    check(`liar/${numPlayers}p: l'indizio "${c}" distingue almeno un'opzione dalle altre`, discriminates);
  });
  const falseCount = door.clues.filter((c) => !evalClue(c, door.solution)).length;
  const expectedLiars = numPlayers >= 5 ? 2 : 1;
  check(`liar/${numPlayers}p: esattamente ${expectedLiars} indizi risultano falsi rispetto alla soluzione vera (la verità resta in maggioranza)`, falseCount === expectedLiars);
  check(`liar/${numPlayers}p: le istruzioni indicano il numero corretto di bugiardi`, door.instructions.includes(expectedLiars === 1 ? 'UNO degli indizi' : 'ESATTAMENTE 2'));
}

// ---- levers/wheels/colors: board iniziale, dominio della soluzione, e unicità reale della soluzione rispetto agli indizi assegnati ----
for (const numPlayers of [2, 3, 4, 6]) {
  for (const type of ['levers', 'wheels', 'colors']) {
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

// ---- domino (Il Domino Runico): la catena runica è ricostruibile CON CERTEZZA a partire dal sigillo, senza ambiguità di verso ----
for (const numPlayers of [2, 3, 4, 6]) {
  const door = generateDoor('domino', numPlayers);
  check(`domino/${numPlayers}p: richiede il roster dei numeri giocatore`, door.needsRoster === true);
  check(`domino/${numPlayers}p: ha un sigillo di partenza pubblico`, DOMINO_RUNES.includes(door.sealRune));
  check(`domino/${numPlayers}p: ci sono esattamente ${numPlayers} tessere`, door._testTiles.length === numPlayers);
  check(
    `domino/${numPlayers}p: dato il sigillo, esiste UNA SOLA catena valida con queste tessere (nessuna ambiguità, nemmeno per inversione)`,
    countDominoArrangements(door._testTiles, door._testSeal, 2) === 1
  );
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

// ---- guess (Lo Specchio dei Simboli): 3 simboli, un narratore vincolato + indizi relazionali per il resto della squadra ----
for (const numPlayers of [2, 3, 4, 6]) {
  const door = generateDoor('guess', numPlayers);
  check(`guess/${numPlayers}p: boardKind è wheelSlots con 3 simboli`, door.boardKind === 'wheelSlots' && door.solution.length === 3);
  check(`guess/${numPlayers}p: la soluzione ha indici simbolo validi`, door.solution.every((v) => v >= 0 && v < WHEEL_SYMBOLS.length));
  const describers = door.clues.filter((c) => c.startsWith(LOCK_TAG));
  check(`guess/${numPlayers}p: esattamente un narratore (vincolato, non può toccare le ruote)`, describers.length === 1);
  check(`guess/${numPlayers}p: il narratore vede tutti e 3 i simboli corretti nel proprio indizio`, describers[0].includes('Tu vedi tutti e 3 i simboli corretti'));
}

// ---- timeLever (La Leva del Tempo): un solo giocatore vincolato conosce il target, tolleranza applicata correttamente ----
for (const numPlayers of [2, 3, 4, 6]) {
  const door = generateDoor('timeLever', numPlayers);
  check(`timeLever/${numPlayers}p: la soluzione è un valore singolo tra 0 e 100`, door.solution.length === 1 && door.solution[0] >= 0 && door.solution[0] <= 100);
  const guides = door.clues.filter((c) => c.startsWith(LOCK_TAG));
  check(`timeLever/${numPlayers}p: esattamente un giocatore vincolato conosce il target`, guides.length === 1);
  check('timeLever: un valore esatto è sempre corretto', checkBoardCorrect(door, door.solution));
  check('timeLever: un valore a distanza 3 (dentro la tolleranza) è corretto', checkBoardCorrect(door, [door.solution[0] + 3]) || door.solution[0] + 3 > 100);
  check('timeLever: un valore a distanza 10 (fuori tolleranza) NON è corretto', !checkBoardCorrect(door, [Math.max(0, door.solution[0] - 10)]));
}

// ---- tapSequence (Il Sentiero a Tappe): stesso principio della bilancia, ma l'azione è FISICA (tocchi in ordine) ----
for (const numPlayers of [2, 3, 4, 6]) {
  const door = generateDoor('tapSequence', numPlayers);
  check(`tapSequence/${numPlayers}p: richiede il roster dei numeri giocatore`, door.needsRoster === true);
  check(`tapSequence/${numPlayers}p: la soluzione è una permutazione di ${numPlayers} indici (0-based)`, door.solution.length === numPlayers && new Set(door.solution).size === numPlayers && door.solution.every((v) => v >= 0 && v < numPlayers));
  check(
    `tapSequence/${numPlayers}p: i confronti assegnati determinano UN SOLO ordinamento possibile`,
    countPermutations(numPlayers, door._testConstraints, 2) === 1
  );
  let board = [];
  door.solution.forEach((slotIdx) => { board = applyBoardUpdate(door, board, { kind: 'tapSlot', slot: slotIdx }); });
  check(`tapSequence/${numPlayers}p: toccando le rune nell'ordine della soluzione il board risulta corretto`, checkBoardCorrect(door, board));
  const resetBoard = applyBoardUpdate(door, board, { kind: 'resetSequence' });
  check('tapSequence: resetSequence svuota il board', resetBoard.length === 0);
}

// ---- ritual (Il Rituale a Tempo): battito dedotto dagli indizi relazionali, tolleranza di 1 battito ----
for (const numPlayers of [2, 3, 4, 6]) {
  const door = generateDoor('ritual', numPlayers);
  check(`ritual/${numPlayers}p: richiede il roster dei numeri giocatore`, door.needsRoster === true);
  check(`ritual/${numPlayers}p: la soluzione ha ${numPlayers} battiti tra 0 e 7`, door.solution.length === numPlayers && door.solution.every((v) => v >= 0 && v <= 7));
  check(
    `ritual/${numPlayers}p: gli indizi assegnati determinano UN SOLO insieme di battiti possibile`,
    countSolutions(numPlayers, door._testNumValues, door._testConstraints, 2) === 1
  );
  check('ritual: premendo esattamente al battito giusto il board è corretto', checkBoardCorrect(door, door.solution));
  const offBy2 = door.solution.map((v) => Math.max(0, v - 2));
  check('ritual: premendo a 2 battiti di distanza (fuori tolleranza) il board NON è corretto', !checkBoardCorrect(door, offBy2) || door.solution.every((v, i) => Math.abs(offBy2[i] - v) <= door.tolerance));
}

// ---- mosaic (Il Mosaico ad Abbinamento): 6 rune, 3 coppie nascoste dedotte da frammenti di conoscenza distribuita ----
for (const numPlayers of [2, 3, 4, 6]) {
  const door = generateDoor('mosaic', numPlayers);
  check('mosaic: 6 rune, board vuoto all\'inizio', door.solution.length === 6 && door.board.length === 6);
  check('mosaic: la soluzione è un accoppiamento perfetto valido (simmetrico, senza auto-coppie)', door.solution.every((p, i) => p !== i && door.solution[p] === i));
  check(
    `mosaic/${numPlayers}p: i frammenti assegnati determinano UN SOLO abbinamento possibile`,
    countMatchings(6, door._testConstraints, 2) === 1
  );
  let board = Array(6).fill(null);
  const done = new Array(6).fill(false);
  door.solution.forEach((partner, i) => {
    if (done[i] || done[partner]) return;
    board = applyBoardUpdate(door, board, { kind: 'connectSlots', a: i, b: partner });
    done[i] = true; done[partner] = true;
  });
  check(`mosaic/${numPlayers}p: collegando le coppie della soluzione il board risulta corretto`, checkBoardCorrect(door, board));
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

// ---- applyBoardUpdate: rispetta i limiti e ignora azioni incompatibili ----
{
  const door = generateDoor('poetic', 3); // boardKind: 'number'
  let board = door.board;
  board = applyBoardUpdate(door, board, { kind: 'setNumber', value: 42 });
  check('number: setNumber imposta il valore', board === 42);
  board = applyBoardUpdate(door, board, { kind: 'setSlot', slot: 0, value: 5 });
  check('number: un\'azione incompatibile (setSlot su una porta "number") viene ignorata', board === 42);
}
{
  const door = generateDoor('liar', 3); // boardKind: 'choice'
  let board = null;
  board = applyBoardUpdate(door, board, { kind: 'setChoice', value: door.choices[0] });
  check('choice: setChoice imposta il valore se è tra le opzioni valide', board === door.choices[0]);
  const before = board;
  board = applyBoardUpdate(door, board, { kind: 'setChoice', value: 999999 });
  check('choice: un valore non tra le opzioni valide viene ignorato', board === before);
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

// ---- checkBoardCorrect: riconosce sia il successo sia il fallimento -------
{
  const door = generateDoor('poetic', 3);
  check('number: board vuoto (null) non è la soluzione (salvo che il numero sia 0, impossibile qui)', !checkBoardCorrect(door, null));
  check('number: il valore esatto della soluzione viene riconosciuto come corretto', checkBoardCorrect(door, door.solution));
}
{
  const door = generateDoor('levers', 3);
  check('levers: il board di partenza (tutto a 0) è corretto solo se la soluzione è [0,0,0] (raro)', checkBoardCorrect(door, [0, 0, 0]) === (JSON.stringify(door.solution) === JSON.stringify([0, 0, 0])));
  check('levers: la soluzione esatta viene sempre riconosciuta come corretta', checkBoardCorrect(door, door.solution));
}

// ---- generateDoors / randomDoorPlan: niente ripetizioni immediate, tipi validi ----
{
  const plan = randomDoorPlan(20, 4);
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
  check('randomDoorPlan/3p: "liar" può comparire con 3 o più giocatori', plan.includes('liar'));
}

// ---- Simulazione end-to-end: risolvere una torre intera applicando la
// soluzione esatta a ogni porta deve sempre concludersi con successo, per
// ogni numero di giocatori, senza mai bloccarsi. ----------------------------
function applyFullSolution(door) {
  let board = door.board;
  switch (door.boardKind) {
    case 'number':
      return applyBoardUpdate(door, board, { kind: 'setNumber', value: door.solution });
    case 'choice':
      return applyBoardUpdate(door, board, { kind: 'setChoice', value: door.solution });
    case 'sequenceSlots':
    case 'sliderSlots':
      door.solution.forEach((v, i) => { board = applyBoardUpdate(door, board, { kind: 'setSlot', slot: i, value: v }); });
      return board;
    case 'wheelSlots':
    case 'colorSlots':
      door.solution.forEach((target, i) => { for (let s = 0; s < target; s++) board = applyBoardUpdate(door, board, { kind: 'cycleSlot', slot: i }); });
      return board;
    case 'dominoChain':
      door.solution.order.forEach((playerIdx, slot) => { board = applyBoardUpdate(door, board, { kind: 'placeTile', slot, player: playerIdx, flipped: door.solution.flipped[slot] }); });
      return board;
    case 'tapSequence':
      door.solution.forEach((slotIdx) => { board = applyBoardUpdate(door, board, { kind: 'tapSlot', slot: slotIdx }); });
      return board;
    case 'pulseSlots':
      door.solution.forEach((v, i) => { board = applyBoardUpdate(door, board, { kind: 'pressAtBeat', slot: i, beat: v }); });
      return board;
    case 'matchPairs': {
      const done = new Array(door.solution.length).fill(false);
      door.solution.forEach((partner, i) => {
        if (done[i] || done[partner]) return;
        board = applyBoardUpdate(door, board, { kind: 'connectSlots', a: i, b: partner });
        done[i] = true; done[partner] = true;
      });
      return board;
    }
    default:
      throw new Error('boardKind sconosciuto: ' + door.boardKind);
  }
}
for (const numPlayers of [2, 3, 4, 5, 6]) {
  const doors = generateDoors(DOOR_COUNT, numPlayers);
  let allSolved = true;
  doors.forEach((door) => {
    const board = applyFullSolution(door);
    if (!checkBoardCorrect(door, board)) allSolved = false;
  });
  check(`simulazione ${numPlayers} giocatori: applicando la soluzione esatta ogni porta risulta risolta`, allSolved);
}

// ---- Copertura ampia: ripete generazione + risoluzione molte volte per
// ogni tipo/numero di giocatori, per stanare bug rari di generazione
// casuale che una singola run potrebbe non incontrare mai. -----------------
{
  let wideRuns = 0;
  for (const type of DOOR_TYPES) {
    for (let numPlayers = 2; numPlayers <= 6; numPlayers++) {
      if (type === 'liar' && numPlayers < 3) continue;
      for (let r = 0; r < 15; r++) {
        wideRuns++;
        const door = generateDoor(type, numPlayers);
        const board = applyFullSolution(door);
        assert.ok(checkBoardCorrect(door, board), `[copertura ampia] ${type}/${numPlayers}p run${r}: la soluzione vera non è stata accettata`);
      }
    }
  }
  check(`copertura ampia: ${wideRuns} generazioni extra, tutte risolte correttamente applicando la soluzione vera`, true);
}

console.log(`\n✅ Totale ${passed} controlli superati su gameLogic.js (La Torre degli Enigmi).`);
