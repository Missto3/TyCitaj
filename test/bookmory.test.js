const assert = require("node:assert/strict");
const test = require("node:test");
const { BookmoryFormatError, exportBookmory, importBookmory } = require("../bookmory");

test("Bookmory export imports books, covers, collections and reading sessions", async () => {
  const archive = await exportBookmory([{
    title: "Testovacia kniha",
    author: "Testovací autor",
    isbn: "9780000000000",
    format: "E-kniha",
    ownership: "Vlastním",
    status: "Čítam",
    totalPages: 300,
    currentPage: 120,
    cover: "data:image/png;base64,aGVsbG8=",
    notes: "Poznámka",
    tags: ["#fantasy"],
    bookmoryCollections: ["Obľúbené"],
    sessions: [
      {
        date: "2026-11-28T12:00:00.000Z",
        minutes: 30,
        startPage: 100,
        page: 120
      },
      { date: "2026-11-28T12:30:00.000Z", minutes: 0 }
    ]
  }]);

  const [book] = await importBookmory(archive);
  assert.equal(book.title, "Testovacia kniha");
  assert.equal(book.status, "Čítam");
  assert.equal(book.format, "E-kniha");
  assert.equal(book.currentPage, 120);
  assert.deepEqual(book.tags, ["#fantasy"]);
  assert.deepEqual(book.bookmoryCollections, ["Obľúbené"]);
  assert.match(book.cover, /^data:image\/png;base64,/);
  assert.equal(book.sessions[0].minutes, 30);
  assert.equal(book.sessions[0].page, 120);
  assert.equal(book.sessions.length, 2);
  assert.equal(book.sessions[1].minutes, 0);
});

test("Bookmory round trip keeps the completion date of finished books", async () => {
  const archive = await exportBookmory([
    { title: "Dočítaná s dátumom", status: "Prečítané", completedAt: "2026-03-05T10:00:00.000Z", sessions: [] },
    {
      title: "Dočítaná bez dátumu",
      status: "Prečítané",
      sessions: [{ date: "2026-02-01T08:00:00.000Z", minutes: 20, page: 50 }]
    },
    { title: "Rozčítaná", status: "Čítam", sessions: [] }
  ]);

  const books = await importBookmory(archive);
  const byTitle = Object.fromEntries(books.map((book) => [book.title, book]));
  assert.equal(byTitle["Dočítaná s dátumom"].completedAt, "2026-03-05T10:00:00.000Z");
  assert.equal(byTitle["Dočítaná bez dátumu"].completedAt, "2026-02-01T08:00:00.000Z");
  assert.equal(byTitle["Rozčítaná"].completedAt, "");
});

test("Bookmory round trip keeps paused books out of the reading status", async () => {
  const [book] = await importBookmory(await exportBookmory([
    { title: "Odložená kniha", status: "Pozastavené", totalPages: 200, currentPage: 80, sessions: [] }
  ]));
  assert.equal(book.status, "Pozastavené");
  assert.equal(book.currentPage, 80);
});

test("Bookmory backups wrapped in a ZIP file can be imported", async () => {
  const { unzipSync, zipSync } = require("fflate");
  const backup = await exportBookmory([{ title: "Kniha zo ZIP súboru", status: "Čítam", sessions: [] }]);

  const nestedFile = Buffer.from(zipSync({ "bookmory_20261128.bookmory": new Uint8Array(backup) }));
  assert.equal((await importBookmory(nestedFile))[0].title, "Kniha zo ZIP súboru");

  const folderEntries = {};
  for (const [name, bytes] of Object.entries(unzipSync(new Uint8Array(backup)))) folderEntries[`bookmory/${name}`] = bytes;
  const folderZip = Buffer.from(zipSync(folderEntries));
  assert.equal((await importBookmory(folderZip))[0].title, "Kniha zo ZIP súboru");
});

test("Bookmory import rejects non-archive data", async () => {
  await assert.rejects(importBookmory(Buffer.from("not a Bookmory archive")), BookmoryFormatError);
});

test("empty Bookmory backups can be imported", async () => {
  assert.deepEqual(await importBookmory(await exportBookmory([])), []);
});
