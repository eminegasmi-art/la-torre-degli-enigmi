// Test della logica pura di "La Torre degli Enigmi" (node test.js)
const assert = require('assert');
const {
  DOOR_COUNT, TOTAL_TIME_MS, PENALTY_MS, DOOR_TYPES, WHEEL_SYMBOLS, COLORS,
  generateDoor, generateDoors, randomDoorPlan, checkBoardCorrect, applyBoardUpdate,
} = require('./gameLogic');

let passed = 0;
function check(desc, cond) {
  assert.ok(cond, desc);
  passed++;
  console.log('  ok -', desc);
}

check('ci sono 12 tipi di porta', DOOR_TYPES.length === 12);
check('parametri di partita sensati', DOOR_COUNT >= 3 && TOTAL_TIME_MS > 0 && PENALTY_MS > 0);

// ---- Ogni generatore produce una porta valida e coerente -----------------
for (const type of DOOR_TYPES) {
  for (const numPlayers of [2, 3, 4, 6]) {
    const door = generateDoor(type, numPlayers);
    check(`[${type}/${numPlayers}p] ha titolo, istruzioni, boardKind`, !!door.title && !!door.instructions && !!door.boardKind);
    check(`[${type}/${numPlayers}p] ha esattamente ${numPlayers} indizi (uno a testa)`, door.clues.length === numPlayers);
  }
}

// ---- sum: la soluzione è davvero la somma degli indizi --------------------
{
  const door = generateDoor('sum', 4);
  const nums = door.clues.map((c) => Number(c.match(/\d+/)[0]));
  check('sum: la soluzione è la somma dei numeri indicati negli indizi', nums.reduce((a, b) => a + b, 0) === door.solution);
}

// ---- sequence: la soluzione è l'ordinamento crescente dei numeri ----------
{
  const door = generateDoor('sequence', 5);
  const nums = door.clues.map((c) => Number(c.match(/\d+/)[0]));
  const sorted = [...nums].sort((a, b) => a - b);
  check('sequence: la soluzione è i numeri della squadra in ordine crescente', JSON.stringify(sorted) === JSON.stringify(door.solution));
  check('sequence: i numeri sono tutti distinti', new Set(nums).size === nums.length);
}

// ---- poetic: il numero segreto è ricostruibile CON CERTEZZA dalle cifre --
for (const numPlayers of [2, 3, 4, 5, 6]) {
  const door = generateDoor('poetic', numPlayers);
  const X = door.solution;
  const digitsFromSolution = String(X).split('').map(Number);
  check(`poetic/${numPlayers}p: il numero segreto ha esattamente ${numPlayers} cifre`, digitsFromSolution.length === numPlayers);
  const parsed = door.clues.map((c) => {
    const m = c.match(/cifra segreta è (\d), in posizione (\d+)/);
    return { digit: Number(m[1]), pos: Number(m[2]) };
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

// ---- levers/wheels/colors/toggles: board iniziale ha la lunghezza giusta e non è già risolto (salvo rara coincidenza) ----
{
  const door = generateDoor('levers', 3);
  check('levers: 3 leve, tutte a 0 all\'inizio', JSON.stringify(door.board) === JSON.stringify([0, 0, 0]));
  check('levers: la soluzione ha 3 valori tra 0 e 10', door.solution.every((v) => v >= 0 && v <= 10));
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

// ---- missing: il valore mancante è coerente con un passo costante --------
for (const numPlayers of [2, 3, 4, 6]) {
  const door = generateDoor('missing', numPlayers);
  const known = door.clues.map((c) => {
    const m = c.match(/posizione (\d+) della sequenza vale (\d+)/);
    return { pos: Number(m[1]), val: Number(m[2]) };
  });
  known.sort((a, b) => a.pos - b.pos);
  // Tutte le coppie di posizioni note devono
  // condividere lo STESSO passo costante, e quel passo applicato a una
  // qualsiasi posizione nota deve produrre esattamente la soluzione nella
  // posizione mancante.
  const steps = [];
  for (let i = 1; i < known.length; i++) {
    steps.push((known[i].val - known[0].val) / (known[i].pos - known[0].pos));
  }
  const allSameStep = steps.every((s) => s === steps[0]);
  check(`missing/${numPlayers}p: tutte le posizioni note condividono lo stesso passo costante`, allSameStep);
  const inferred = known[0].val + steps[0] * (0 - known[0].pos); // valore alla posizione 0 (base)
  // ricostruiamo l'intera sequenza dal passo dedotto e verifichiamo la soluzione
  const missingPosGuess = door.instructions.match(/posizione (\d+):/);
  check(`missing/${numPlayers}p: ha ${numPlayers} indizi (uno a testa) e un'istruzione con la posizione mancante`, door.clues.length === numPlayers && !!missingPosGuess);
  const missingPos = Number(missingPosGuess[1]);
  const reconstructed = inferred + steps[0] * missingPos;
  check(`missing/${numPlayers}p: il passo dedotto dagli indizi ricostruisce ESATTAMENTE il valore mancante`, reconstructed === door.solution);
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
  check('levers: setSlot rispetta il limite massimo (10)', board[1] === 10);
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
    }
    if (!checkBoardCorrect(door, board)) allSolved = false;
  });
  check(`simulazione ${numPlayers} giocatori: applicando la soluzione esatta ogni porta risulta risolta`, allSolved);
}

console.log(`\n✅ Totale ${passed} controlli superati su gameLogic.js (La Torre degli Enigmi).`);
