# TyCitaj

Súkromná webová knižnica na sledovanie papierových kníh a e-kníh. Aplikácia je v slovenčine, ponúka pomocné vyhľadávanie v Google Books a Open Library a vie načítať údaje priamo z odkazu na knihu v Martinuse.

## Spustenie cez Docker

Skopírujte `.env.example` do `.env` a doplňte údaje Google OAuth podľa časti **Prihlásenie cez Google**. Bez nich aplikácia zobrazí prihlasovaciu obrazovku a API knižnice zostane uzamknuté.

```sh
docker compose up -d --build
```

Otvorte `http://IP_ADRESA_SERVERA:3000`. Aplikácia nepoužíva SQL databázu; každá schválená e-mailová adresa má vlastný JSON súbor v `./data/users/<hash-email>/library.json`, vrátane čítacích záznamov a pokroku. Docker zachová súbory cez mapovanie `./data:/app/data`.

Pri prvej návšteve sa existujúci spoločný `./data/library.json` skopíruje do knižnice prvého e-mailu v `GOOGLE_ALLOWED_EMAIL`; pôvodný súbor zostane nedotknutý. Ostatné účty začnú s prázdnou knižnicou. Pred každou ďalšou zmenou vlastného súboru server vytvorí časovú zálohu vedľa neho.

## Lokálny vývoj

Vyžaduje Node.js 20 alebo novší.

```sh
npm install
npm start
```

Premenné prostredia: `PORT` (predvolene `3000`), `DATA_FILE` (predvolene `./data/library.json`, používa sa aj ako zdroj pri migrácii starej knižnice) a nastavenia Google OAuth uvedené nižšie.

## Prihlásenie cez Google

1. V Google Cloud Console vytvor OAuth klienta typu **Web application** a nakonfiguruj obrazovku súhlasu.
2. Pridaj presnú hodnotu `APP_BASE_URL` medzi autorizované originy, napríklad `http://localhost:3000`.
3. Pridaj callback adresu `${APP_BASE_URL}/auth/google/callback` medzi autorizované redirect URI, napríklad `http://localhost:3000/auth/google/callback`.
4. V `.env` nastav `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_BASE_URL` a `GOOGLE_ALLOWED_EMAIL` na Gmail účty, ktorým povoľuješ prístup. Viac adries oddeľ čiarkou, napríklad `prvy@gmail.com,druhy@gmail.com`.
5. Reštartuj aplikáciu (`docker compose up -d --build`).

Na lokálnom počítači funguje OAuth cez `http://localhost`. Pri prístupe z telefónu alebo cez internet použi HTTPS adresu (napríklad Cloudflare Tunnel) a tú istú adresu nastav ako `APP_BASE_URL` aj v Google Cloud Console. Nepoužívaj HTTP LAN IP pre Google callback. Súbor `.env` obsahuje tajný kľúč a nesmie sa zdieľať ani commitovať.

Prihlásenie povoľuje iba overené e-mailové adresy uvedené v `GOOGLE_ALLOWED_EMAIL`; viac adries oddeľ čiarkou. Po zmene `.env` reštartuj aplikáciu. Relácie platia najviac 7 dní a po reštarte servera sa z bezpečnostných dôvodov zrušia.

## Funkcie

- Polička aj zoznam s vyhľadávaním a filtrami stavu, vlastníctva a formátu; priebeh čítania zobrazuje strany aj percentá.
- Ručné pridanie a úprava, obálka knihy, ISBN, poznámky a vlastný odkaz na Martinus.sk.
- Skener EAN‑13 pri ISBN doplní kód do formulára a vyhľadá údaje v katalógoch; skener pri hľadaní na poličke iba vyhľadá knihu v tvojej knižnici a nič nepridáva.
- Po vložení odkazu na produktovú stránku Martinusu aplikácia načíta názov, autora, ISBN, počet strán, formát a obálku. Načítanie závisí od dostupnosti stránky a jej štruktúrovaných údajov.
- Google Books a Open Library sú len pomôcky; pri chýbajúcich údajoch možno použiť Martinus odkaz alebo všetko vyplniť ručne.
- Stav „V očakávaní“ zobrazuje dátum vydania a odpočet dní.
- Kliknutie na knihu otvorí jej podrobnosti vrátane uloženého času, strán, čítacích záznamov, poznámok a odkazu na Martinus.
- Stopky zobrazujú aktuálnu stranu z celkového počtu strán a ukladajú celé minúty, dátum aj rozsah strán. Knihu možno vybrať priamo v paneli stopiek; pri ich spustení sa jej stav automaticky nastaví na „Čítam“.
- Zabudnuté čítanie možno doplniť alebo upraviť ručne. Štatistiky majú samostatnú stránku s mesačným, ročným a celkovým prehľadom, aktuálnou a najdlhšou čitateľskou sériou a ročnou výzvou 24 kníh; nedávne záznamy zobrazujú posledných 10 a dajú sa rozbaliť.
- V profile možno exportovať zálohu vo formáte JSON TyCitaj alebo Bookmory a importovať JSON zálohu alebo súbor `.bookmory`. Import nahradí celú knižnicu a pred potvrdením zobrazí upozornenie; server pred zápisom vytvorí záložnú kópiu. Pri prenose z Bookmory sa zachovajú knihy, obálky, štítky, kolekcie, stav, pokrok a dostupné čítacie záznamy.

## Offline používanie

Po prvom online prihlásení sa knižnica uloží v prehliadači cez IndexedDB. Knihy možno prezerať, pridávať, upravovať, mazať a zapisovať čítanie aj bez spojenia; zmeny sa odošlú po návrate internetu alebo pri ďalšom otvorení appky. Neodoslané úpravy zostanú uložené aj po zatvorení karty. Ak sa tá istá kniha medzitým zmení na inom zariadení, TyCitaj zachová obe verzie a ponúkne výber. Import zálohy vyžaduje internet a nedá sa spustiť, kým čakajú neodoslané zmeny.

Na inštaláciu ako aplikácie otvor HTTPS adresu v Chrome a v menu zvoľ **Inštalovať aplikáciu**; v Safari na iPhone použi **Zdieľať → Pridať na plochu**. Aplikácia sa potom otvorí bez panela s adresou prehliadača. Ak už máš vytvorenú staršiu ikonu, odstráň ju a nainštaluj aplikáciu znova.

Pre inštaláciu a opätovné otvorenie appky bez internetu je potrebný HTTPS alebo `localhost`, pretože prehliadače povoľujú Service Worker iba v zabezpečenom kontexte. Cez HTTP adresu domácej siete môže už otvorená stránka ďalej používať lokálne uloženú knižnicu, ale appku po zatvorení bez internetu znovu nenačítaš. Prvé prihlásenie a načítanie knižnice musí prebehnúť online.

## Nasadenie a prístup

Mapovanie portu je určené na domácu sieť. Pred vystavením cez Cloudflare Tunnel nastav HTTPS `APP_BASE_URL` a zodpovedajúce autorizované Google OAuth URL. Mobilný skener kamery vyžaduje HTTPS a povolený prístup ku kamere; cez obyčajnú HTTP adresu lokálnej siete nemusí byť dostupný. Gemini API integrácia zatiaľ nie je súčasťou projektu.
