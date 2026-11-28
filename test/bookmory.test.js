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

test("Bookmory import rejects non-archive data", async () => {
  await assert.rejects(importBookmory(Buffer.from("not a Bookmory archive")), BookmoryFormatError);
});

test("empty Bookmory backups can be imported", async () => {
  assert.deepEqual(await importBookmory(await exportBookmory([])), []);
});
