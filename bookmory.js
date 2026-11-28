const { unzipSync, zipSync } = require("fflate");
const initSqlJs = require("sql.js");

const BOOKMORY_DATABASE = "new_bookmory.db";
const MAX_ARCHIVE_SIZE = 8 * 1024 * 1024;
const MAX_UNCOMPRESSED_SIZE = 64 * 1024 * 1024;
const MAX_DATABASE_SIZE = 32 * 1024 * 1024;
const MAX_IMPORTED_COVER_SIZE = 6 * 1024 * 1024;
const MAX_BOOKS = 10000;
const allowedImageHosts = new Set([
  "books.google.com",
  "covers.openlibrary.org",
  "dryofg8nmyqjw.cloudfront.net",
  "images-amazon.com",
  "images-eu.ssl-images-amazon.com",
  "images-na.ssl-images-amazon.com",
  "i.gr-assets.com",
  "m.media-amazon.com",
  "mrtns.sk",
  "www.mrtns.sk"
]);

class BookmoryFormatError extends Error {}

let sqlPromise;

function getSql() {
  if (!sqlPromise) sqlPromise = initSqlJs();
  return sqlPromise;
}

function readArchiveLimits(bytes) {
  const searchStart = Math.max(0, bytes.length - 65557);
  let endOffset = -1;
  for (let offset = bytes.length - 22; offset >= searchStart; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new BookmoryFormatError("Súbor nie je platný ZIP archív.");

  const entryCount = bytes.readUInt16LE(endOffset + 10);
  const directorySize = bytes.readUInt32LE(endOffset + 12);
  const directoryOffset = bytes.readUInt32LE(endOffset + 16);
  if (entryCount > 20000 || directoryOffset + directorySize > endOffset) {
    throw new BookmoryFormatError("ZIP archív má neplatnú alebo príliš veľkú tabuľku súborov.");
  }

  let offset = directoryOffset;
  let totalSize = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) {
      throw new BookmoryFormatError("ZIP archív obsahuje neplatný záznam súboru.");
    }
    const flags = bytes.readUInt16LE(offset + 8);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    if ((flags & 1) || uncompressedSize === 0xffffffff) {
      throw new BookmoryFormatError("Šifrované alebo príliš veľké ZIP súbory nie sú podporované.");
    }
    totalSize += uncompressedSize;
    if (totalSize > MAX_UNCOMPRESSED_SIZE) {
      throw new BookmoryFormatError("Rozbalený Bookmory súbor je príliš veľký.");
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
}

function timestamp(value) {
  const parsed = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function toIsoDate(value) {
  const parsed = timestamp(value);
  return parsed ? new Date(parsed).toISOString() : "";
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function getBookStatus(book) {
  const statuses = Array.isArray(book.status_list) ? book.status_list : [];
  if (statuses.includes("DONE")) return "Prečítané";
  if (statuses.includes("READING")) return "Čítam";
  // Bookmory: PAUSE = odložená, GIVE_UP = vzdaná. Obe sú rozčítané knihy mimo aktuálneho čítania.
  if (statuses.includes("PAUSE") || statuses.includes("GIVE_UP")) return "Pozastavené";
  return "Chcem čítať";
}

function getBookFormat(book) {
  const types = [...(Array.isArray(book.book_types) ? book.book_types : []), book.book_type];
  if (types.some((type) => /ebook|e-book/i.test(String(type)))) return "E-kniha";
  return types.some((type) => /hardcover/i.test(String(type))) ? "Pevná väzba" : "Mäkká väzba";
}

function safeRemoteImage(value) {
  if (typeof value !== "string" || value.length > 2000) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && allowedImageHosts.has(url.hostname)
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

function imageFromArchive(value, files) {
  if (typeof value !== "string") return "";
  const remoteImage = safeRemoteImage(value);
  if (remoteImage) return remoteImage;

  const prefix = "bookmory_data/";
  if (!value.startsWith(prefix)) return "";
  const archivePath = value.slice(prefix.length);
  const bytes = files[archivePath];
  if (!bytes || !bytes.length) return "";
  const extension = archivePath.toLowerCase().split(".").pop();
  const mimeType = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" }[extension];
  if (!mimeType) return "";
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

function toSession(read, book) {
  const pageLogs = (Array.isArray(read.page_log_list) ? read.page_log_list : [])
    .map((log) => ({ page: positiveNumber(log.page), at: timestamp(log.created_at) }))
    .filter((log) => log.page > 0)
    .sort((left, right) => left.at - right.at);
  const timers = (Array.isArray(read.read_timer_list) ? read.read_timer_list : [])
    .map((log) => ({
      at: timestamp(log.created_at || log.read_started_at),
      minutes: Math.max(0, Math.round(positiveNumber(log.elapsed_sec) / 60))
    }))
    .sort((left, right) => left.at - right.at);
  const sessions = [];
  let pageIndex = 0;

  for (const [timerIndex, timer] of timers.entries()) {
    while (pageIndex + 1 < pageLogs.length && pageLogs[pageIndex + 1].at <= timer.at) pageIndex += 1;
    const pageLog = pageLogs[pageIndex] && (!timer.at || pageLogs[pageIndex].at <= timer.at) ? pageLogs[pageIndex] : null;
    const previousPage = pageLog && pageIndex > 0 ? pageLogs[pageIndex - 1].page : 0;
    const session = {
      date: toIsoDate(timer.at || read.start || book.created_at),
      minutes: timer.minutes
    };
    if (pageLog) {
      session.page = pageLog.page;
      if (previousPage > 0 && previousPage < pageLog.page) session.startPage = previousPage;
    } else if (timerIndex === timers.length - 1 && positiveNumber(read.page) > 0) {
      session.page = positiveNumber(read.page);
    }
    if (typeof read.comment === "string" && read.comment) session.comment = read.comment;
    if (session.date) sessions.push(session);
  }

  if (!timers.length) {
    for (const [index, pageLog] of pageLogs.entries()) {
      const session = {
        date: toIsoDate(pageLog.at || read.start || book.created_at),
        minutes: 0,
        page: pageLog.page
      };
      if (index > 0 && pageLogs[index - 1].page < pageLog.page) session.startPage = pageLogs[index - 1].page;
      if (typeof read.comment === "string" && read.comment) session.comment = read.comment;
      if (session.date) sessions.push(session);
    }
  }
  return sessions;
}

function mapBookmoryBook(book, collections, files) {
  if (!book || typeof book !== "object" || Array.isArray(book) || typeof book.title !== "string" || !book.title.trim()) {
    throw new BookmoryFormatError("Bookmory archív obsahuje knihu bez platného názvu.");
  }
  const authorNames = Array.isArray(book.authors)
    ? book.authors.map((author) => typeof author === "string" ? author : author && author.name).filter(Boolean)
    : [];
  const collectionNames = (Array.isArray(book.collection_keys) ? book.collection_keys : [])
    .map((collectionKey) => collections.get(String(collectionKey)))
    .filter(Boolean);
  const bookTags = typeof book.tags === "string"
    ? book.tags.split(/\s+/).filter(Boolean)
    : Array.isArray(book.tags) ? book.tags.map(String).filter(Boolean) : [];
  const reads = Array.isArray(book.reads) ? book.reads : [];
  const sessions = reads.flatMap((read) => toSession(read, book));
  const martinusUrl = typeof book.link === "string" && /^https:\/\/(?:www\.)?martinus\.sk\//i.test(book.link)
    ? book.link
    : "";
  const status = getBookStatus(book);
  let completedAt = "";
  if (status === "Prečítané") {
    const finishedAt = Math.max(
      0,
      ...reads.map((read) => timestamp(read.end)),
      timestamp(book.last_read_done_date),
      timestamp(book.last_finished_read_date),
      timestamp(book.last_read_end_date),
      timestamp(book.first_read_done_date)
    );
    const lastSessionAt = Math.max(0, ...sessions.map((session) => timestamp(session.date)));
    completedAt = toIsoDate(finishedAt || lastSessionAt);
  }
  const mapped = {
    title: book.title,
    author: String(book.author || authorNames.join(", ")).trim(),
    isbn: String(book.isbn || ""),
    format: getBookFormat(book),
    ownership: book.owned ? "Vlastním" : "Nevlastním",
    status,
    completedAt,
    totalPages: positiveNumber(book.real_total_page || book.total_page),
    currentPage: positiveNumber(book.cur_page),
    cover: imageFromArchive(book.image, files),
    // Anotácia knihy a vlastné poznámky čitateľa sú dve rôzne veci.
    description: String(book.description || ""),
    notes: reads.map((read) => typeof read.comment === "string" ? read.comment : "").filter(Boolean).join("\n\n"),
    rating: Math.max(0, positiveNumber(book.last_read_done_star), ...reads.map((read) => positiveNumber(read.star))),
    tags: bookTags,
    bookmoryTags: bookTags,
    bookmoryCollections: collectionNames,
    bookmoryDescription: String(book.description || ""),
    bookmoryReadComments: reads.map((read) => typeof read.comment === "string" ? read.comment : "").filter(Boolean),
    sessions,
    createdAt: toIsoDate(book.created_at) || new Date().toISOString(),
    martinusUrl
  };
  return mapped;
}

// Bookmory niekedy exportuje ZIP: databáza je potom v podpriečinku alebo je v ňom vložený súbor .bookmory.
function locateBookmoryFiles(files, depth = 0) {
  if (files[BOOKMORY_DATABASE]) return files;
  const nestedDatabase = Object.keys(files).find((name) => name.endsWith(`/${BOOKMORY_DATABASE}`));
  if (nestedDatabase) {
    const prefix = nestedDatabase.slice(0, -BOOKMORY_DATABASE.length);
    const unwrapped = {};
    for (const [name, bytes] of Object.entries(files)) {
      if (name.startsWith(prefix)) unwrapped[name.slice(prefix.length)] = bytes;
    }
    return unwrapped;
  }
  if (depth < 1) {
    const inner = Object.keys(files).find((name) => /\.(bookmory|zip)$/i.test(name) && files[name].length);
    if (inner) {
      const innerBytes = Buffer.from(files[inner]);
      if (innerBytes.length > MAX_ARCHIVE_SIZE) throw new BookmoryFormatError("Vložený Bookmory súbor je príliš veľký.");
      readArchiveLimits(innerBytes);
      return locateBookmoryFiles(unzipSync(new Uint8Array(innerBytes)), depth + 1);
    }
  }
  return files;
}

async function importBookmory(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (!bytes.length || bytes.length > MAX_ARCHIVE_SIZE) {
    throw new BookmoryFormatError("Bookmory súbor je prázdny alebo väčší ako 8 MB.");
  }
  readArchiveLimits(bytes);

  let files;
  try {
    files = locateBookmoryFiles(unzipSync(new Uint8Array(bytes)));
  } catch {
    throw new BookmoryFormatError("Bookmory ZIP archív sa nepodarilo rozbaliť.");
  }
  const databaseBytes = files[BOOKMORY_DATABASE];
  if (!databaseBytes || databaseBytes.length > MAX_DATABASE_SIZE) {
    throw new BookmoryFormatError("V archíve sa nenašla platná databáza Bookmory.");
  }
  const coverBytes = Object.entries(files)
    .filter(([name]) => name.startsWith("images/books/"))
    .reduce((total, [, file]) => total + file.length, 0);
  if (coverBytes > MAX_IMPORTED_COVER_SIZE) {
    throw new BookmoryFormatError("Obálky v Bookmory súbore sú príliš veľké.");
  }

  const SQL = await getSql();
  let database;
  try {
    database = new SQL.Database(databaseBytes);
    const integrity = database.exec("PRAGMA integrity_check");
    if (integrity[0]?.values?.[0]?.[0] !== "ok") {
      throw new BookmoryFormatError("Databáza v Bookmory súbore je poškodená.");
    }
    const columns = database.exec("PRAGMA table_info(entry)")[0]?.values || [];
    if (!["store", "key", "value", "deleted"].every((name) => columns.some((column) => column[1] === name))) {
      throw new BookmoryFormatError("Databáza nemá očakávanú štruktúru Bookmory.");
    }

    const collections = new Map();
    const collectionRows = database.exec("SELECT key, value FROM entry WHERE store = 'collections' AND COALESCE(deleted, 0) = 0");
    for (const [key, value] of collectionRows[0]?.values || []) {
      try {
        const collection = JSON.parse(value);
        if (typeof collection.name === "string") collections.set(String(key), collection.name);
      } catch {
        throw new BookmoryFormatError("Databáza Bookmory obsahuje neplatnú kolekciu.");
      }
    }

    const rows = database.exec("SELECT key, value FROM entry WHERE store = 'books' AND COALESCE(deleted, 0) = 0");
    const bookRows = rows[0]?.values || [];
    if (bookRows.length > MAX_BOOKS) throw new BookmoryFormatError("Bookmory súbor obsahuje príliš veľa kníh.");
    return bookRows.map(([key, value]) => {
      let book;
      try {
        book = JSON.parse(value);
      } catch {
        throw new BookmoryFormatError("Databáza Bookmory obsahuje neplatný záznam knihy.");
      }
      return mapBookmoryBook(book, collections, files);
    });
  } catch (error) {
    if (error instanceof BookmoryFormatError) throw error;
    throw new BookmoryFormatError("Bookmory databázu sa nepodarilo načítať.");
  } finally {
    if (database) database.close();
  }
}

function bookmoryStatus(status) {
  if (status === "Prečítané") return "DONE";
  if (status === "Čítam") return "READING";
  if (status === "Pozastavené") return "PAUSE";
  return "NOT_STARTED";
}

function bookmoryBookType(book) {
  if (book.format === "E-kniha") return "eBook";
  return book.format === "Pevná väzba" ? "hardCover" : "paperBook";
}

function validImageData(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]*={0,2})$/i);
  if (!match) return null;
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length) return null;
  const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" }[match[1].toLowerCase()];
  return { bytes, extension };
}

function makeBookmoryRead(book, bookType) {
  const sessions = (Array.isArray(book.sessions) ? book.sessions : [])
    .map((session) => ({ ...session, at: timestamp(session.date) }))
    .filter((session) => session.at > 0)
    .sort((left, right) => left.at - right.at);
  const start = sessions[0]?.at || timestamp(book.createdAt) || Date.now();
  const lastSessionAt = sessions[sessions.length - 1]?.at || start;
  const end = (book.status === "Prečítané" && timestamp(book.completedAt)) || lastSessionAt;
  const pageLogs = sessions.filter((session) => positiveNumber(session.page) > 0).map((session) => ({
    page_type: "PAGE",
    page: positiveNumber(session.page),
    created_at: session.at,
    updated_at: session.at
  }));
  const timerLogs = sessions.map((session) => ({
    read_started_at: session.at,
    elapsed_sec: Math.round(positiveNumber(session.minutes) * 60),
    created_at: session.at,
    updated_at: session.at
  }));
  return {
    nth: 1,
    start,
    end: book.status === "Prečítané" ? end : 0,
    star: positiveNumber(book.rating),
    comment: book.notes || [...new Set([
      ...(Array.isArray(book.bookmoryReadComments) ? book.bookmoryReadComments : []),
      ...sessions.map((session) => session.comment)
    ].filter((comment) => typeof comment === "string" && comment))].join("\n") || null,
    status: bookmoryStatus(book.status),
    page: positiveNumber(book.currentPage),
    total_page: positiveNumber(book.totalPages),
    real_total_page: positiveNumber(book.totalPages),
    book_type: bookType,
    book_types: [bookType],
    page_type: "PAGE",
    page_log_list: pageLogs,
    read_timer_list: timerLogs,
    read_pause_list: [],
    created_at: start,
    updated_at: end
  };
}

async function exportBookmory(books) {
  const SQL = await getSql();
  const database = new SQL.Database();
  const files = {};
  const now = Date.now();
  const tagBooks = new Map();
  const authorBooks = new Map();
  const collectionIds = new Map();
  let nextAuthorId = 1;
  let nextTagId = 1;
  let nextCollectionId = now;
  let nextBookId = now;

  database.run("CREATE TABLE android_metadata (locale TEXT)");
  database.run("INSERT INTO android_metadata (locale) VALUES ('en_US')");
  database.run("CREATE TABLE entry (id INTEGER PRIMARY KEY AUTOINCREMENT, store TEXT NOT NULL, key BLOB NOT NULL, value TEXT, deleted INTEGER, UNIQUE(store, key))");
  database.run("CREATE TABLE info (id TEXT PRIMARY KEY, value TEXT)");

  const insertInfo = database.prepare("INSERT INTO info (id, value) VALUES (?, ?)");
  for (const [key, value] of [
    ["meta", JSON.stringify({ version: 1, sembast: 1 })],
    ["revision", String(books.length + 1)],
    ["deltaMinRevision", "0"],
    ["authors_store_last_id", "0"],
    ["tags_store_last_id", "0"]
  ]) insertInfo.run([key, value]);
  insertInfo.free();

  const insertEntry = database.prepare("INSERT INTO entry (store, key, value, deleted) VALUES (?, ?, ?, NULL)");
  const addEntry = (store, key, value) => insertEntry.run([store, key, JSON.stringify(value)]);
  const collectionNames = new Set();
  for (const book of books) {
    for (const name of Array.isArray(book.bookmoryCollections) ? book.bookmoryCollections : []) {
      if (typeof name === "string" && name.trim()) collectionNames.add(name.trim());
    }
  }
  for (const name of collectionNames) {
    const key = String(nextCollectionId++);
    collectionIds.set(name, key);
    addEntry("collections", key, { name, created_at: now, updated_at: now });
  }

  for (const book of books) {
    const bookId = String(nextBookId++);
    const author = String(book.author || "").trim();
    const authors = author ? author.split(/\s*,\s*/).filter(Boolean) : [];
    const type = bookmoryBookType(book);
    const tags = Array.isArray(book.bookmoryTags) ? book.bookmoryTags : Array.isArray(book.tags) ? book.tags : [];
    const tagNames = [...new Set(tags.map((tag) => String(tag).trim()).filter(Boolean))];
    for (const name of tagNames) {
      if (!tagBooks.has(name)) tagBooks.set(name, []);
      tagBooks.get(name).push(bookId);
    }
    const description = String(book.description || book.bookmoryDescription || "");
    const image = validImageData(book.cover);
    let imagePath = safeRemoteImage(book.cover);
    if (image) {
      const filename = `book_${bookId}.${image.extension}`;
      files[`images/books/${filename}`] = image.bytes;
      imagePath = `bookmory_data/images/books/${filename}`;
    }
    const bookCollections = [...new Set((Array.isArray(book.bookmoryCollections) ? book.bookmoryCollections : [])
      .map((name) => collectionIds.get(String(name).trim()))
      .filter(Boolean))];
    const record = {
      image: imagePath,
      title: String(book.title || "").trim(),
      author,
      authors,
      translators: [],
      illustrators: [],
      narrators: [],
      publisher: "",
      isbn: String(book.isbn || ""),
      publication_date: "",
      language: "",
      description,
      link: String(book.martinusUrl || ""),
      tags: tagNames.join(" "),
      tag_count: tagNames.length,
      page_type: "PAGE",
      total_page: positiveNumber(book.totalPages),
      real_total_page: positiveNumber(book.totalPages),
      cur_page: positiveNumber(book.currentPage),
      wishlist: book.status === "Chcem čítať",
      not_owned: book.ownership === "Požičané",
      owned: book.ownership === "Vlastním",
      action_plans: [],
      series_key: "",
      series_number: null,
      series_number_decimal: null,
      series_memberships: [],
      collection_keys: bookCollections,
      reads: [makeBookmoryRead(book, type)],
      purchases: [],
      gifts: [],
      disposals: [],
      rentals: [],
      lendings: [],
      status_list: [bookmoryStatus(book.status)],
      read_again_planned_at: null,
      planned_read_month: null,
      planned_read_order: null,
      first_read_start_date: null,
      last_read_end_date: null,
      first_read_done_date: null,
      last_read_done_date: null,
      last_give_up_date: null,
      nearest_return_due_date: null,
      nearest_return_due_date_with_overdue: null,
      nearest_lending_return_due_date: null,
      last_purchase_date: null,
      last_gift_received_date: null,
      last_disposed_date: null,
      last_purchase_price: null,
      note_sort_type: "CREATED_AT_DESC",
      book_type: type,
      book_types: [type],
      last_read_done_star: positiveNumber(book.rating),
      last_finished_read_date: null,
      last_finished_read_date_asc_sort: null,
      last_give_up_date_asc_sort: null,
      created_at: timestamp(book.createdAt) || now,
      updated_at: timestamp(book.updatedAt) || now
    };
    addEntry("books", bookId, record);
    for (const name of authors) {
      if (!authorBooks.has(name)) authorBooks.set(name, []);
      authorBooks.get(name).push(bookId);
    }
  }

  for (const [name, bookIds] of authorBooks) {
    const key = String(nextAuthorId++);
    addEntry("authors", key, { name, bids: bookIds, bid_count: bookIds.length });
  }
  for (const [name, bookIds] of tagBooks) {
    const key = String(nextTagId++);
    addEntry("tags", key, { name, bids: bookIds, bid_count: bookIds.length });
  }
  const updateInfo = database.prepare("UPDATE info SET value = ? WHERE id = ?");
  updateInfo.run([String(nextAuthorId - 1), "authors_store_last_id"]);
  updateInfo.run([String(nextTagId - 1), "tags_store_last_id"]);
  updateInfo.free();
  addEntry("_main", "version", { db: 0, book: 31, note: 5, tag: 1, user: 16, collection: 2, streak_cache: 10 });
  addEntry("_main", "user", {
    language: "en",
    default_book_type: "paperBook",
    default_page_type: "PAGE",
    page_type_for_e_book: "PAGE",
    page_type_for_audio_book: "PAGE"
  });
  insertEntry.free();
  const databaseFile = Buffer.from(database.export());
  database.close();

  const output = zipSync({ [BOOKMORY_DATABASE]: databaseFile, ...files }, { level: 6 });
  return Buffer.from(output);
}

module.exports = { BookmoryFormatError, exportBookmory, importBookmory, safeRemoteImage };
