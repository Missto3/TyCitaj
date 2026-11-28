# TyCitaj – požiadavky a stav úprav

Pracovné poznámky k úpravám aplikácie. Zdroj požiadaviek: dokument `upravy tycitaj.docx`, screenshoty z aplikácie Bookmory a správy z 28. 11. 2026.

Stav: všetky úpravy sú zatiaľ len v pracovnom adresári, nič nie je commitnuté. Testuje sa ručne v prehliadači na `http://localhost:3000`.

## Pravidlá práce

- Necommitovať a nepushovať, kým o to autor výslovne nepožiada. Úpravy testuje sám.
- Dizajn musí byť vlastný. Bookmory je inšpirácia pre funkcie, nie predloha na kopírovanie 1:1. Cieľ: lepšie, zaujímavejšie, interaktívnejšie.
- Vždy riešiť web aj mobilné zobrazenie.
- Potvrdenia a hlášky sú okná v dizajne aplikácie, nie systémové okná prehliadača.

## Požiadavky z dokumentu (prepis)

1. **Pridať knihu je maličké.** Má byť výrazné, podľa screenshotov ako hlavná akcia.
2. **Rozčítané knihy** majú byť na domovskej obrazovke výrazné (ako na fotke 2 z Bookmory).
3. **Časovač nedáva spätnú väzbu.** Po spustení sa nezmení farba ani nič iné, používateľ nevie, že stopky bežia alebo že sa niečo načítava.
4. **Úprava nameraného času pred uložením.** Príklad: stopky bežia 30 minút, dám pauzu, zabudnem ich zapnúť a zistím to až pri ukladaní. Treba vedieť čas pridať alebo ubrať.
5. **Formát Bookmory.** Vedieť načítať zálohu Bookmory do aplikácie a pri exporte ponúknuť výber formátu (JSON aj Bookmory). Toto bola prvá priorita.
6. **Widget, notifikačná lišta, zamknutá obrazovka.** Otázka, či vieme pri bežiacom čase ukázať stopky v lište a na lockscreene, prípadne spraviť widget.
7. **Poradie kníh pri výbere pre časovač.** Od najnovšej aktivity po najstaršiu: kniha čítaná včera je pred knihou čítanou pred tromi dňami, práve pridaná kniha je pred rozčítanou. Rozhoduje posledný záznam o knihe.
8. **Reset časovača.** Chýba tlačidlo na vynulovanie, keď sa stopky spustia omylom.
9. **Štatistiky sa nedajú rozkliknúť.** Po kliknutí napr. na „Čas s knihou“ sa má ukázať podrobnejšia štatistika.
10. **Prečítané knihy ukazujú 0** pre mesiac aj rok, hoci po importe z Bookmory tam prečítané knihy sú.

## Ďalšie požiadavky (správy z 28. 11. 2026)

11. Vynulovanie stopiek má potvrdiť okno v dizajne aplikácie, nie chybová hláška prehliadača.
12. Čítanie má byť výraznejšie: pri čítaní sa má otvoriť celá stránka s časovačom, nie popup.
13. „Zapísať čítanie spätne“: pri poli „Po stranu“ ukázať, koľko strán kniha má.
14. Na kartách kníh sa „Prečítané“ zobrazovalo viackrát. Opraviť.
15. Pri pridávaní knihy podľa ISBN vyhľadať knihu na Martinuse a spárovať ju. Zistiť, ako to robí Bookmory (slovenské knihy aj obálky tam fungujú).
16. Vo výbere knihy pre časovač pridať skener čiarového kódu, zoznam nechať.
17. APK pre Android (widgety, notifikácia, lockscreen).
18. V profile pri „Záloha a prenos“ pridať hromadné doplnenie údajov z Martinusu pre knihy bez odkazu, postupne na pozadí.
19. „Nedávne čítanie“ v profile: posledných 5 záznamov.
20. Dizajn nesmie byť kópiou Bookmory. Prejsť súčasné pravidlá UI/UX a upraviť web aj mobil.

## Stav

| # | Požiadavka | Stav |
|---|---|---|
| 1 | Pridať knihu výraznejšie | Hotové: väčšie tlačidlo na webe, plávajúce tlačidlo „Pridať knihu“ na mobile |
| 2 | Rozčítané knihy výrazne | Hotové: sekcia „Práve čítam“ s hlavnou knihou, pokrokom, odhadom do konca a týždenným prehľadom |
| 3 | Spätná väzba časovača | Hotové: farba, pulzujúci stav, čas v titulku karty |
| 4 | Úprava času pred uložením | Hotové: „Upraviť čas“ s ±5 minút |
| 5 | Formát Bookmory | Už bol v repozitári (import aj export s výberom formátu); doplnený dátum dočítania |
| 6 | Notifikácia pri čítaní | Čiastočne: webová notifikácia na Androide (aj lockscreen), čas v nej netiká |
| 7 | Poradie kníh pre časovač | Hotové |
| 8 | Reset časovača | Hotové: „Vynulovať“ s potvrdením |
| 9 | Detail štatistík | Hotové: každá karta sa dá rozkliknúť |
| 10 | Prečítané knihy 0 | Opravené; treba znova importovať zálohu Bookmory |
| 11 | Potvrdenie v dizajne appky | Hotové (aj pri odstránení knihy) |
| 12 | Režim čítania na celú stránku | Hotové, vlastný dizajn |
| 13 | Počet strán pri zápise čítania | Hotové |
| 14 | Duplicitné „Prečítané“ | Opravené |
| 15 | Martinus podľa ISBN | Hotové; vzorka 10 kníh: 10 nájdených |
| 16 | Skener vo výbere knihy | Hotové |
| 17 | APK | Odložené (pozri nižšie) |
| 18 | Hromadné doplnenie z Martinusu | Hotové: Profil → Doplniť údaje z Martinusu |
| 19 | Nedávne čítanie: 5 | Hotové |
| 20 | Vlastný dizajn | Prerobené; čaká na ručnú kontrolu vzhľadu |

## Tretie kolo (28. 11. 2026, večer)

| # | Požiadavka | Stav |
|---|---|---|
| 21 | Hodnotenie knihy z Martinusu | Hotové: v podrobnostiach knihy hviezdičky, počet hodnotení, anotácia a vydavateľ; načíta sa pri otvorení a týždeň sa pamätá v prehliadači |
| 22 | „Čas na čítanie“ sa bije s „Práve čítam“ | Hotové: karta stopiek je skrytá, všetko ovláda „Práve čítam“ a režim čítania; inú knihu vyberie tlačidlo „Iná kniha“ |
| 23 | „Čítať teraz“ v náhľade knihy | Hotové: hlavné tlačidlo v podrobnostiach knihy |
| 24 | Podrobnosti knihy podľa pravidiel UI/UX | Prerobené: úvodný blok s pokrokom, akcie prilepené dole, väčšie písmo, záznamy po 5 |
| 25 | Profil podľa pravidiel UI/UX | Prerobené: súhrn, panely s riadkami, väčšie tlačidlá, priebeh dopĺňania z Martinusu |
| 26 | Prejsť ostatné stránky a navrhnúť úpravy | Návrhy nižšie, čakajú na rozhodnutie |

### Návrhy pre ostatné stránky (zatiaľ nerobené)

- **Polička:** tlačidlá úpravy na obálke sú malé; filtre presunúť do jedného riadku čipov s počtami; pridať triedenie (posledná aktivita, názov, autor).
- **Všetky knihy:** zlúčiť s poličkou ako prepínač mriežka/zoznam, dve takmer rovnaké stránky mätú.
- **Štatistiky:** pridať ročný prehľad čítania po dňoch (mriežka ako kalendár) a nastaviteľný ročný cieľ namiesto pevných 24 kníh.
- **Pridanie knihy:** rozdeliť na kroky (1. nájsť podľa ISBN, skenera alebo odkazu, 2. skontrolovať údaje, 3. stav a strany); dnes je to jeden dlhý formulár.
- **Všeobecne:** drobné texty 9–11 px zväčšiť aspoň na 12 px, zjednotiť výšku tlačidiel na 44 px a viac.

## Štvrté kolo (28. 11. 2026, noc)

| # | Požiadavka | Stav |
|---|---|---|
| 27 | Stav „Pozastavené“ pre odložené knihy | Hotové: nový stav, kniha zmizne z „Práve čítam“; v podrobnostiach tlačidlo „Odložiť“ a „Vrátiť sa ku knihe“; import z Bookmory mapuje PAUSE aj GIVE_UP na „Pozastavené“ |
| 28 | Úprava knihy – UI/UX | Prerobené: sekcie, väčšie polia, uloženie prilepené dole |
| 29 | Pridať knihu len „+“ a výber spôsobu | Hotové: ISBN/skener, názov alebo autor (výber z výsledkov Martinusu), odkaz z Martinusu, prípadne ručne |
| 30 | Žánre a triedenie podľa žánrov | Hotové: žánre z Martinusu (omrvinková navigácia produktu), pole vo formulári, filter vo „Všetky knihy“; hromadné doplnenie v profile |
| 31 | „Všetky knihy“ – filtre podľa všetkého | Hotové: hľadanie, stav, žáner, vlastníctvo, formát, zoradenie |
| 32 | „Moja polička“ – len všetky a stav | Hotové: riadok čipov s počtami |
| 33 | Skener na poličke | Hotové: nájdená kniha otvorí podrobnosti, nenájdená ponúkne pridanie |
| 34 | Kontrola importu – vlastníctvo | Záloha Bookmory nemá vlastníctvo vyplnené pri žiadnej z 211 kníh (owned aj not_owned sú false), import je správny |
| 35 | „Iná kniha“ z hlavnej karty preč | Hotové |
| 36 | Bežiace stopky na hlavnej karte výraznejšie | Hotové: farebný panel s veľkým časom, pauzou a „Otvoriť čítanie“ |
| 37 | Zjednotiť dizajn a farby | Hotové: jednotné tlačidlá, okná, formuláre a potvrdzovacie okno; fialová pri stave „Čítam“ nahradená jantárovou |

Návrhy z tretieho kola: body „Pridanie knihy“ a filtre sú týmto vyriešené; ostáva zlúčenie poličky so zoznamom a kalendárový prehľad v štatistikách.

## Piate kolo (29. 11. 2026)

| # | Požiadavka | Stav |
|---|---|---|
| 38 | Skener ISBN vo „Všetky knihy“ | Hotové: tlačidlo vedľa hľadania; nájdená kniha otvorí podrobnosti, nenájdená ponúkne pridanie |
| 39 | Lepšie štatistiky | Hotové: kalendár čítania za rok, dočítané knihy po mesiacoch (alebo rokoch), žánre, autori, rekordy a zaujímavosti, nastaviteľný ročný cieľ |
| 40 | Ikony prehrať/pauza | Hotové: kreslené ikony namiesto textových znakov na hlavnej karte a v podrobnostiach knihy |
| 41 | Výber formátu exportu v profile | Hotové: prepínač TyCitaj / Bookmory namiesto systémového zoznamu; výbery vo filtroch majú vlastný vzhľad |
| 42 | Import ZIP z Bookmory | Hotové: .zip s databázou v podpriečinku alebo s vloženým súborom .bookmory |

Štatistiky vychádzajú z toho, čo čitatelia v podobných aplikáciách chcú najčastejšie: dni do dočítania, najdlhšia a najkratšia kniha, top autori a žánre, prehľad po mesiacoch a kalendár pravidelnosti.

## Šieste kolo (29. 11. 2026)

| # | Požiadavka | Stav |
|---|---|---|
| 43 | Formát: pevná väzba, mäkká väzba, e-kniha | Hotové; staré „Papierová“ sa zobrazí ako „Mäkká väzba“, import z Bookmory rozlišuje paperBook / hardCover / eBook |
| 44 | Hľadanie podľa názvu alebo autora všade | Hotové: jeden zoznam výsledkov, Martinus prvý, potom Google Books a Open Library; výsledok z katalógu sa podľa ISBN doplní z Martinusu |
| 45 | „Odkaz“ namiesto „Odkaz z Martinusu“ | Hotové: načíta údaje z ľubovoľnej verejnej stránky knihy (schema.org alebo Open Graph), len https a len verejné adresy |
| 46 | „Vyplniť údaje manuálne“ | Hotové |
| 47 | Polička zoradená podľa poslednej aktivity | Hotové |
| 48 | Hodnotenie na kartách poličky | Hotové: vlastné hodnotenie, inak hodnotenie z Martinusu |
| 49 | Vlastné hodnotenie knihy | Hotové: hviezdičky v podrobnostiach, aj polovičné; importuje sa z Bookmory |
| 50 | Poznámky nie sú anotácia | Hotové: anotácia je „O knihe“, „Moje poznámky“ sú len texty používateľa; import z Bookmory ich rozdeľuje |
| 51 | Ikony v režime čítania | Hotové: kreslená šípka a mesiac |
| 52 | Oznámenia (toast) | Prerobené: tmavozelená zaoblená bublina |
| 53 | Kalendár čítania: dni v týždni vľavo | Hotové |
| 54 | Štatistiky: zjednotený dizajn | Hotové: rovnaké karty, farby a písmo, prepínač obdobia |
| 55 | Ikony navigácie a období | Hotové: jedna sada kreslených ikon aj pre stavy, formát a vlastníctvo |

## Siedme kolo (29. 11. 2026)

| # | Požiadavka | Stav |
|---|---|---|
| 56 | Kalendár: prekrývajúce sa mesiace, zobraziť aktuálne obdobie | Opravené: mesiac sa označí len v týždni, kde sa začína; kalendár sa posunie na dnešok |
| 57 | Nesprávna väzba (pevná vs. mäkká) | Dopĺňanie z Martinusu teraz opraví aj väzbu podľa ISBN; treba ho spustiť znova |
| 58 | Úprava knihy vyzerá inak než podrobnosti | Prerobené: rovnaká hlavička, úvodný blok s obálkou, po uložení alebo zrušení návrat do podrobností |
| 59 | Mesiac v režime čítania | Nová ikona, pri zapnutom nočnom režime slnko a zvýraznenie |
| 60 | „Doplniť čítanie“ zjednotiť s režimom čítania | Prerobené: obálka knihy, rýchly výber minút, strana „/ celkom“, rovnaký podklad a tlačidlá |
| 61 | Hľadanie bez diakritiky | Hotové na poličke, vo všetkých knihách aj vo výbere knihy |
| 62 | Podrobnosti knihy s veľa údajmi | Prerobené: žánre a hodnotenia na celú šírku, moje hodnotenie a Martinus vedľa seba |
| 63 | Štatistiky na širokom displeji | Kalendár a dočítané knihy sú vedľa seba |
| 64 | Nadpisy inou sadou písma | Príčina: písma Playfair Display a DM Sans sa nenačítavali; teraz sú v `public/fonts` a fungujú aj offline |
| 65 | Text „moje“ pri hodnotení na karte | Odstránené: vlastné hodnotenie je jantárové, hodnotenie z Martinusu tlmené s popisom |

## Ôsme kolo (29. 11. 2026)

| # | Požiadavka | Stav |
|---|---|---|
| 66 | Obálka sa mení kliknutím na obálku, nie dole | Hotové: výber súboru aj „Odstrániť obálku“ sú pri obálke v úvode úpravy |
| 67 | Úprava drží poradie podrobností | Hotové: úvod, stav, formát, žánre, strany, moje poznámky; ISBN a odkaz sú na konci |
| 68 | Podrobnosti sa otvárajú vždy hore | Opravené |
| 69 | Rozbité podrobnosti na malom telefóne | Opravené: staré pravidlo pre úzke displeje kolidovalo s novým rozložením |

## Deviate kolo (29. 11. 2026)

| # | Požiadavka | Stav |
|---|---|---|
| 70 | Import oboch výstupov Bookmory (`.bookmory` aj `bookmory.zip <dátum>`) | Hotové: typ súboru sa určuje podľa obsahu, nie podľa prípony; oba súbory dajú 211 kníh |
| 71 | Export: názvy formátov namiesto „Bookmory“ | Hotové: JSON, CSV, ZIP s krátkym vysvetlením |
| 72 | Export CSV | Hotové: stĺpce kompatibilné s Goodreads a StoryGraph plus údaje TyCitaj, kódovanie UTF‑8 s BOM pre Excel |

## Čo sa zmenilo v kóde

- `public/index.html`: sekcia „Práve čítam“, režim čítania, potvrdzovacie okno, detail štatistík, úprava a vynulovanie času, skener pre stopky, hromadné doplnenie z Martinusu, notifikácia.
- `server.js`: `POST /api/lookup/martinus-isbn` – vyhľadá knihu na Martinuse podľa ISBN a vráti ju len pri presnej zhode ISBN.
- `bookmory.js`: import aj export dátumu dočítania (`completedAt`).
- `public/service-worker.js`: kliknutie na notifikáciu vráti do aplikácie.
- `test/bookmory.test.js`: test zachovania dátumu dočítania.

## Dizajn: z čoho vychádza

Použité pravidlá zo súčasnej praxe UI/UX:

- Hlavné akcie v dolnej časti obrazovky v dosahu palca (pauza a uloženie v režime čítania, plávajúce „Pridať knihu“).
- Dotykové ciele aspoň 44–48 px.
- Mikrointerakcie ako potvrdenie akcie: pulzujúci stav, kruh cieľa, jemný pohyb obálky, vibrácia pri splnení cieľa.
- Postupné odkrývanie: základ je viditeľný hneď, detaily (štatistiky, úprava času) až po kliknutí.
- Rešpektovanie nastavenia „obmedziť pohyb“ a čitateľný kontrast aj v nočnom režime.

Vlastné prvky, ktoré Bookmory nemá:

- Kruh okolo obálky ukazuje plnenie cieľa čítania (15, 30, 60 minút alebo voľne).
- Posuvník a rýchle kroky strán (−1, +1, +5, +10) priamo počas čítania.
- Živé údaje: prečítané v tomto čítaní, tempo, odhad času do konca knihy.
- Nočný režim obrazovky čítania a ponechanie zapnutého displeja.
- Týždenný prehľad čítania a prepínanie medzi rozčítanými knihami na domovskej obrazovke.

## Zistenia

- **Bookmory** berie knihy z Goodreads (v zálohe 63 odkazov na goodreads.com) a obálky z Amazonu a Goodreads. Goodreads nemá verejné API.
- **Martinus** sa dá prehľadať podľa ISBN zo servera; produktová stránka obsahuje ISBN, počet strán, autora a obálku.
- **Záloha Bookmory** má dátum dočítania pri 117 zo 155 prečítaných kníh; 38 kníh dátum nemá vôbec.

## Odložené: APK pre Android

Zatiaľ sa nerobí. Prekážky:

- Na pracovnom počítači nie je Java, Android SDK ani Gradle, APK sa nedá zostaviť ani otestovať.
- Aplikácia potrebuje verejnú HTTPS adresu servera.
- Prihlásenie cez Google nefunguje v obyčajnom WebView; widget a tikajúca notifikácia potrebujú natívnu časť s vlastným prihlásením voči serveru.

Pred začatím treba rozhodnúť: inštalácia Android Studia a adresa, na ktorej aplikácia beží.

## Otvorené

- Ručne skontrolovať nový vzhľad na webe aj mobile.
- Znova importovať zálohu Bookmory, aby sa doplnili dátumy dočítania.
- README ešte nepopisuje nové funkcie.
