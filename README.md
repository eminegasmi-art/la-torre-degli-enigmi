# La Torre degli Enigmi 🏰🔒

Gioco cooperativo online per 2-6 giocatori. La squadra deve superare **5
porte magiche** prima che si esaurisca una clessidra condivisa da 8 minuti.

**A differenza degli altri giochi della saga, qui si può parlare
liberamente** — anzi, è proprio il punto: coordinarsi a voce.

## Come si gioca
- Ogni porta è un enigma generato al momento, pescato a caso tra 12 tipi
  (diverso ogni partita): somme segrete, sequenze da ricostruire, numeri
  segreti da ricostruire cifra per cifra, un numero mancante da dedurre da
  una sequenza, un'operazione a sorpresa (somma/differenza/prodotto/conta i
  pari), un bugiardo da smascherare, leve da portare al valore giusto, una
  leva di precisione guidata a voce, ruote simboliche da far girare, un
  simbolo da descrivere senza nominarlo, colori da abbinare, interruttori da
  sistemare.
- Ognuno vede sul proprio telefono **un indizio privato diverso**, che aiuta
  a capire come dev'essere configurata la porta (il "board" condiviso).
- Il board è visibile e modificabile da chiunque, in tempo reale: descrivetevi
  a voce cosa sapete e mettetelo a posto insieme.
- Quando pensate di avercela fatta, premete **Conferma soluzione**. Giusto →
  si passa alla porta successiva. Sbagliato → si perdono 20 secondi dalla
  clessidra, ma si può riprovare subito.
- Si vince superando tutte e 5 le porte prima che il tempo scada.

## Pubblicare il server (una volta sola)

Questo è un progetto **separato e indipendente** da eventuali altri giochi
della stessa famiglia: usa un repository GitHub proprio e un servizio Render
proprio, così non si tocca nulla di ciò che già funziona altrove.

### 1. Carica il progetto su GitHub
1. Vai su [github.com](https://github.com) e crea un **nuovo repository**
   (es. `la-torre-degli-enigmi`), spuntalo **Public**, poi **Create repository**.
2. Tocca **Add file → Upload files** e carica: `server.js`, `gameLogic.js`,
   `index.html`, `package.json`.
3. Conferma con **Commit changes**.

### 2. Collega il repository a Render
1. Vai su [render.com](https://render.com) (puoi accedere con l'account GitHub).
2. Tocca **New → Web Service**.
3. Seleziona il repository `la-torre-degli-enigmi` appena creato.
4. Imposta:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free
5. Tocca **Deploy Web Service** e aspetta il completamento.
6. Al termine Render dà un link tipo `https://la-torre-degli-enigmi.onrender.com`.

Nota: col piano gratuito di Render il server "si addormenta" dopo un po' di
inattività; il primo caricamento dopo una pausa può richiedere ~30-60 secondi
per svegliarsi. Il passo 3 qui sotto elimina questa attesa.

### 3. Tenetelo sempre sveglio (consigliato, un'altra volta sola)
Così quando aprite l'app dal telefono è già pronta, senza aspettare.
1. Vai su [uptimerobot.com](https://uptimerobot.com) e crea un account gratuito.
2. Tocca **Add New Monitor**.
3. Tipo: **HTTP(s)**, Nome: `La Torre degli Enigmi`, URL: incolla il link che ti ha dato Render.
4. Intervallo: **5 minuti**, poi **Create Monitor**.

Da questo momento UptimeRobot "visita" il vostro server ogni 5 minuti,
impedendogli di addormentarsi: quando aprite l'app è sempre già sveglia.

### 4. Giocate
- Ognuno apre il link dal proprio telefono (reti diverse, nessun problema).
- Uno fonda la spedizione e condivide il codice a 4 caratteri con gli altri.
- Quando tutti sono dentro, l'host tocca **Entra nella Torre**.

## File del progetto
- `server.js` — server Express + Socket.io, stato della stanza (unica fonte di verità).
- `gameLogic.js` — logica pura degli enigmi (generazione porte, verifica soluzioni), senza dipendenze.
- `index.html` — interfaccia mobile-friendly.
- `test.js` — test automatici (`node test.js`, nessuna dipendenza da installare).

## Sviluppo locale (opzionale)
```
npm install
npm start
```
Poi apri `http://localhost:3000` nel browser.
