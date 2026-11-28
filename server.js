const fs = require("node:fs/promises");
const path = require("node:path");
const express = require("express");
const { createHash, randomBytes, randomUUID } = require("node:crypto");
const dns = require("node:dns/promises");
const net = require("node:net");
const { BookmoryFormatError, exportBookmory, importBookmory, safeRemoteImage } = require("./bookmory");

require("dotenv").config();

const app = express();
const port = Number(process.env.PORT) || 3000;
const dataFile = path.resolve(process.env.DATA_FILE || path.join(__dirname, "data", "library.json"));
const dataDir = path.dirname(dataFile);
const allowedOwnership = new Set(["Vlastním", "Nevlastním", "Požičané"]);
const allowedStatuses = new Set(["Čítam", "Chcem čítať", "Pozastavené", "V očakávaní", "Prečítané"]);
const allowedFormats = new Set(["Pevná väzba", "Mäkká väzba", "E-kniha"]);
const legacyFormats = new Map([["Papierová", "Mäkká väzba"]]);
const allowedMartinusHosts = new Set(["martinus.sk", "www.martinus.sk"]);
const sessions = new Map();
const googleClientId = (process.env.GOOGLE_CLIENT_ID || "").trim();
const googleClientSecret = (process.env.GOOGLE_CLIENT_SECRET || "").trim();
const allowedGoogleEmails = [...new Set((process.env.GOOGLE_ALLOWED_EMAIL || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean))];
const primaryEmail = allowedGoogleEmails[0] || "";
let googleAuthConfig = null;

try {
  const baseUrl = new URL(process.env.APP_BASE_URL || "");
  const isLoopbackHttp = baseUrl.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname);
  if ((baseUrl.protocol === "https:" || isLoopbackHttp) && baseUrl.pathname === "/" &&
      !baseUrl.search && !baseUrl.hash && !baseUrl.username && !baseUrl.password &&
      googleClientId && googleClientSecret && allowedGoogleEmails.length) {
    googleAuthConfig = {
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      allowedEmails: allowedGoogleEmails,
      baseUrl: baseUrl.origin,
      redirectUri: new URL("/auth/google/callback", baseUrl).toString(),
      secureCookies: baseUrl.protocol === "https:"
    };
  }
} catch {
  // Missing or invalid OAuth settings leave the login unavailable.
}

app.disable("x-powered-by");
app.use(express.json({ limit: "12mb" }));
app.use(express.static(path.join(__dirname, "public")));

let writeQueue = Promise.resolve();
const legacyMigrations = new Map();

function cookieValue(req, name) {
  const prefix = `${name}=`;
  const cookie = (req.headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  if (!cookie) return "";
  try {
    return decodeURIComponent(cookie.slice(prefix.length));
  } catch {
    return "";
  }
}

function setCookie(res, name, value, maxAge) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (googleAuthConfig && googleAuthConfig.secureCookies) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

function getSession(req) {
  const id = cookieValue(req, "tycitaj_session");
  const session = id && sessions.get(id);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(id);
    return null;
  }
  return { id, ...session };
}

app.get("/api/auth/status", (req, res) => {
  const session = getSession(req);
  res.json({
    configured: Boolean(googleAuthConfig),
    baseUrl: googleAuthConfig ? googleAuthConfig.baseUrl : null,
    authenticated: Boolean(session),
    user: session ? { email: session.email, name: session.name, picture: session.picture } : null
  });
});

app.get("/auth/google", (req, res) => {
  if (!googleAuthConfig) {
    return res.status(503).send("Google OAuth nie je nastavený. Pozri README.md.");
  }
  const state = randomBytes(32).toString("base64url");
  setCookie(res, "tycitaj_oauth_state", state, 600);
  const params = new URLSearchParams({
    client_id: googleAuthConfig.clientId,
    redirect_uri: googleAuthConfig.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account"
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get("/auth/google/callback", async (req, res) => {
  const stateCookie = cookieValue(req, "tycitaj_oauth_state");
  setCookie(res, "tycitaj_oauth_state", "", 0);
  if (!googleAuthConfig || !req.query.state || req.query.state !== stateCookie) {
    return res.redirect("/?auth=failed");
  }
  if (req.query.error) return res.redirect("/?auth=cancelled");
  if (!req.query.code) return res.redirect("/?auth=failed");

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: String(req.query.code),
        client_id: googleAuthConfig.clientId,
        client_secret: googleAuthConfig.clientSecret,
        redirect_uri: googleAuthConfig.redirectUri,
        grant_type: "authorization_code"
      }),
      signal: AbortSignal.timeout(10000)
    });
    if (!tokenResponse.ok) throw new Error(`Google token endpoint returned HTTP ${tokenResponse.status}.`);
    const token = await tokenResponse.json();
    if (typeof token.access_token !== "string") throw new Error("Google did not return an access token.");

    const userResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(10000)
    });
    if (!userResponse.ok) throw new Error(`Google userinfo endpoint returned HTTP ${userResponse.status}.`);
    const user = await userResponse.json();
    const email = String(user.email || "").trim().toLowerCase();
    if (user.email_verified !== true || !googleAuthConfig.allowedEmails.includes(email)) {
      return res.redirect("/?auth=not-allowed");
    }

    for (const [id, session] of sessions) {
      if (session.expiresAt <= Date.now()) sessions.delete(id);
    }
    const sessionId = randomBytes(32).toString("base64url");
    sessions.set(sessionId, {
      email,
      name: String(user.name || email).slice(0, 200),
      picture: typeof user.picture === "string" && user.picture.startsWith("https://") ? user.picture : "",
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
    });
    setCookie(res, "tycitaj_session", sessionId, 7 * 24 * 60 * 60);
    res.redirect("/");
  } catch (error) {
    console.error("Google OAuth callback failed:", error.message);
    res.redirect("/?auth=failed");
  }
});

app.use("/api", (req, res, next) => {
  if (!googleAuthConfig) {
    return res.status(503).json({ error: "Google OAuth nie je nastavený. Postup nájdeš v README.md." });
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    let origin;
    try {
      origin = new URL(req.get("origin") || "").origin;
    } catch {
      return res.status(403).json({ error: "Požiadavka nemá platný pôvod." });
    }
    if (origin !== googleAuthConfig.baseUrl) {
      return res.status(403).json({ error: "Požiadavka prišla z nepovolenej stránky." });
    }
  }
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: "Prihlás sa cez Google." });
  req.user = session;
  next();
});

app.post("/api/auth/logout", (req, res) => {
  sessions.delete(req.user.id);
  setCookie(res, "tycitaj_session", "", 0);
  res.json({ ok: true });
});

function userLibraryFile(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) throw new Error("Pri používateľskej knižnici chýba e-mailová adresa.");
  const userId = createHash("sha256").update(normalizedEmail).digest("hex");
  return path.join(dataDir, "users", userId, "library.json");
}

async function readLibraryFile(filePath) {
  const contents = await fs.readFile(filePath, "utf8");
  const data = JSON.parse(contents);
  if (!data || !Array.isArray(data.books)) {
    throw new Error("Súbor knižnice nemá očakávaný formát.");
  }
  return data;
}

async function readLibrary(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const filePath = userLibraryFile(normalizedEmail);
  try {
    return await readLibraryFile(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  if (normalizedEmail !== primaryEmail) return { version: 1, books: [] };

  let migration = legacyMigrations.get(filePath);
  if (!migration) {
    migration = (async () => {
      try {
        return await readLibraryFile(filePath);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }

      let legacy;
      try {
        legacy = await readLibraryFile(dataFile);
      } catch (error) {
        if (error.code === "ENOENT") return { version: 1, books: [] };
        throw error;
      }
      await writeLibraryFile(legacy, filePath);
      return legacy;
    })();
    legacyMigrations.set(filePath, migration);
  }

  try {
    return await migration;
  } finally {
    if (legacyMigrations.get(filePath) === migration) legacyMigrations.delete(filePath);
  }
}

async function writeLibraryFile(data, filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  try {
    await fs.access(filePath);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await fs.copyFile(filePath, `${filePath}.${stamp}.bak`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const temporaryFile = `${filePath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryFile, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await fs.rename(temporaryFile, filePath);
  } catch (error) {
    await fs.rm(temporaryFile, { force: true });
    throw error;
  }
}

async function writeLibrary(data, email) {
  await writeLibraryFile(data, userLibraryFile(email));
}

function serializedWrite(operation) {
  const result = writeQueue.then(operation);
  writeQueue = result.catch(() => {});
  return result;
}

function parseMartinusUrl(value) {
  if (typeof value !== "string" || value.length > 2048) {
    throw new Error("Vlož platný odkaz na knihu z Martinus.sk.");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Vlož platný odkaz na knihu z Martinus.sk.");
  }
  if (url.protocol !== "https:" || !allowedMartinusHosts.has(url.hostname) || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("Načítanie údajov je povolené len z bezpečného odkazu na Martinus.sk.");
  }
  return url;
}

async function fetchMartinusPage(startUrl) {
  let url = startUrl;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html",
        "User-Agent": "TyCitaj/1.0 (+local book library)"
      },
      redirect: "manual",
      signal: AbortSignal.timeout(10000)
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Martinus presmeroval na neplatnú adresu.");
      await response.body?.cancel();
      const redirectedUrl = parseMartinusUrl(new URL(location, url).toString());
      if (redirects === 5) throw new Error("Martinus presmeroval príliš veľakrát.");
      url = redirectedUrl;
      continue;
    }
    if (!response.ok) throw new Error(`Martinus vrátil chybu HTTP ${response.status}.`);
    if (!response.headers.get("content-type")?.includes("text/html")) {
      throw new Error("Odkaz nevedie na HTML stránku knihy.");
    }
    return { html: await response.text(), url };
  }
  throw new Error("Stránku Martinusu sa nepodarilo načítať.");
}

function findBookSchema(value) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const match = findBookSchema(entry);
      if (match) return match;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const type = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
  if (type.includes("Book") && value.name) return value;
  for (const entry of Object.values(value)) {
    const match = findBookSchema(entry);
    if (match) return match;
  }
  return null;
}

function extractMartinusBook(html, url) {
  const scripts = html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const script of scripts) {
    try {
      const schema = findBookSchema(JSON.parse(script[1]));
      if (!schema) continue;
      const authors = Array.isArray(schema.author) ? schema.author : [schema.author];
      const author = authors
        .map((entry) => typeof entry === "string" ? entry : entry && entry.name)
        .filter(Boolean)
        .join(", ");
      const schemaFormat = String(schema.bookFormat || "");
      const isEbook = /ebook|e-book|e-kniha/i.test(`${schemaFormat} ${url.pathname}`);
      const cover = Array.isArray(schema.image) ? schema.image[0] : schema.image;
      const ratingValue = Number(schema.aggregateRating && schema.aggregateRating.ratingValue);
      const ratingCount = Number(schema.aggregateRating && schema.aggregateRating.ratingCount);
      const rating = Number.isFinite(ratingValue) && ratingValue > 0 && ratingValue <= 5
        ? { value: Math.round(ratingValue * 10) / 10, count: Number.isFinite(ratingCount) && ratingCount > 0 ? Math.round(ratingCount) : 0 }
        : null;
      const publisher = schema.publisher && typeof schema.publisher.name === "string" ? schema.publisher.name.trim().slice(0, 200) : "";
      const description = typeof schema.description === "string"
        ? schema.description.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1500)
        : "";
      return {
        rating,
        publisher,
        description,
        genres: extractMartinusGenres(html),
        title: String(schema.name).trim(),
        author,
        isbn: String(schema.isbn || "").trim(),
        totalPages: Math.max(0, Number.parseInt(schema.numberOfPages, 10) || 0),
        format: isEbook ? "E-kniha" : /hardcover/i.test(schemaFormat) ? "Pevná väzba" : /paperback/i.test(schemaFormat) ? "Mäkká väzba" : "",
        cover: typeof cover === "string" && cover.startsWith("https://mrtns.sk/") ? cover : "",
        martinusUrl: url.toString()
      };
    } catch (error) {
      if (error instanceof SyntaxError) continue;
      throw error;
    }
  }
  return null;
}

function normalizeGenres(value) {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const genres = [];
  for (const entry of list) {
    const genre = String(entry || "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (genre && !genres.some((known) => known.toLowerCase() === genre.toLowerCase())) genres.push(genre);
    if (genres.length >= 10) break;
  }
  return genres;
}

function decodeHtmlText(value) {
  return String(value || "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}

// Žánre z omrvinkovej navigácie produktu, napr. Knihy › Beletria › Romantika.
function extractMartinusGenres(html) {
  const scripts = html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const script of scripts) {
    try {
      const schema = JSON.parse(script[1]);
      const types = Array.isArray(schema["@type"]) ? schema["@type"] : [schema["@type"]];
      if (!types.includes("BreadcrumbList") || !Array.isArray(schema.itemListElement)) continue;
      const names = schema.itemListElement
        .map((entry) => entry && (entry.name || (entry.item && entry.item.name)))
        .filter((name) => typeof name === "string")
        .map((name) => name.trim())
        .filter((name) => name && !/^(knihy|e-knihy|eknihy|audioknihy|martinus|domov)$/i.test(name));
      if (names.length) return normalizeGenres(names);
    } catch (error) {
      if (error instanceof SyntaxError) continue;
      throw error;
    }
  }
  return [];
}

function extractMartinusSearchResults(html) {
  const results = [];
  for (const block of html.split('<div class="mj-product listing__item').slice(1)) {
    const link = block.match(/class="product-cover[^"]*"\s+href="(\/[^"?#]+)"/);
    const title = block.match(/listing__item__title[^>]*>\s*<a[^>]*>([^<]+)<\/a>/);
    if (!link || !title) continue;
    if (!/\/(kniha|ekniha|audiokniha)$/.test(link[1])) continue;
    const author = block.match(/list-inline--delimited"\s+title="([^"]*)"/);
    const image = block.match(/<img\s+src="(\/\/mrtns\.sk\/[^"]+)"/);
    const format = /\/ekniha(\/|$)/.test(link[1]) ? "E-kniha" : /\/audiokniha(\/|$)/.test(link[1]) ? "Audiokniha" : "Kniha";
    results.push({
      title: decodeHtmlText(title[1]).slice(0, 300),
      author: decodeHtmlText(author ? author[1] : "").slice(0, 300),
      cover: image ? `https:${image[1]}` : "",
      format,
      martinusUrl: new URL(link[1], "https://www.martinus.sk").toString()
    });
    if (results.length >= 8) break;
  }
  return results;
}

function normalizeBook(input, existing = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Kniha musí byť objekt.");
  }
  const book = { ...existing, ...input };
  book.title = String(book.title || "").trim();
  if (!book.title) throw new Error("Názov knihy je povinný.");
  if (book.title.length > 300) throw new Error("Názov knihy je príliš dlhý.");
  book.id = existing.id || input.id || randomUUID();
  book.author = String(book.author || "").trim().slice(0, 300);
  book.ownership = allowedOwnership.has(book.ownership) ? book.ownership : "Nevlastním";
  book.status = allowedStatuses.has(book.status) ? book.status : "Chcem čítať";
  if (legacyFormats.has(book.format)) book.format = legacyFormats.get(book.format);
  book.format = allowedFormats.has(book.format) ? book.format : "Mäkká väzba";
  if (book.rating !== undefined) {
    const rating = Math.round(Number(book.rating) * 2) / 2;
    book.rating = Number.isFinite(rating) && rating > 0 && rating <= 5 ? rating : 0;
  }
  if (book.martinusRating !== undefined) {
    const value = Number(book.martinusRating && book.martinusRating.value);
    const count = Number(book.martinusRating && book.martinusRating.count);
    book.martinusRating = Number.isFinite(value) && value > 0 && value <= 5
      ? { value: Math.round(value * 10) / 10, count: Number.isFinite(count) && count > 0 ? Math.round(count) : 0 }
      : null;
  }
  if (book.description !== undefined) book.description = String(book.description || "").slice(0, 5000);
  book.isbn = String(book.isbn || "").trim().slice(0, 40);
  book.martinusUrl = String(book.martinusUrl || "").trim().slice(0, 2000);
  book.notes = String(book.notes || "").slice(0, 20000);
  const isUploadedCover = typeof book.cover === "string" && book.cover.startsWith("data:image/");
  const isRemoteCover = Boolean(safeRemoteImage(book.cover));
  book.cover = isUploadedCover || isRemoteCover ? book.cover : "";
  book.totalPages = Math.max(0, Number.parseInt(book.totalPages, 10) || 0);
  book.currentPage = Math.max(0, Number.parseInt(book.currentPage, 10) || 0);
  book.sessions = Array.isArray(book.sessions) ? book.sessions : [];
  if (book.genres !== undefined) book.genres = normalizeGenres(book.genres);
  book.createdAt = existing.createdAt || input.createdAt || new Date().toISOString();
  const previousUpdate = Date.parse(existing.updatedAt);
  book.updatedAt = new Date(Number.isFinite(previousUpdate) ? Math.max(Date.now(), previousUpdate + 1) : Date.now()).toISOString();
  return book;
}

function normalizeDuplicateText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function normalizeIsbn(value) {
  return String(value || "").toUpperCase().replace(/[^0-9X]/g, "");
}

function findDuplicateBook(books, candidate, excludedId = "") {
  const title = normalizeDuplicateText(candidate.title);
  const author = normalizeDuplicateText(candidate.author);
  const isbn = normalizeIsbn(candidate.isbn);

  return books.find((book) => {
    if (excludedId && book.id === excludedId) return false;
    const existingIsbn = normalizeIsbn(book.isbn);
    if (isbn && existingIsbn && isbn === existingIsbn) return true;
    return title === normalizeDuplicateText(book.title) &&
      author === normalizeDuplicateText(book.author);
  }) || null;
}

function duplicateBookError(book) {
  return `Kniha „${book.title}“ už v knižnici existuje.`;
}

app.get("/api/books", async (req, res, next) => {
  try {
    const data = await readLibrary(req.user.email);
    res.json(data.books.map((book) => legacyFormats.has(book.format) ? { ...book, format: legacyFormats.get(book.format) } : book));
  } catch (error) {
    next(error);
  }
});

app.post("/api/lookup/martinus", async (req, res) => {
  let url;
  try {
    url = parseMartinusUrl(req.body && req.body.url);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  try {
    const page = await fetchMartinusPage(url);
    const book = extractMartinusBook(page.html, page.url);
    if (!book) return res.status(422).json({ error: "Na stránke sa nenašli údaje o knihe. Skontroluj odkaz alebo údaje doplň ručne." });
    res.json(book);
  } catch (error) {
    console.error("Nepodarilo sa načítať knihu z Martinusu:", error);
    res.status(502).json({ error: "Stránku Martinusu sa nepodarilo načítať. Skús to znova alebo údaje doplň ručne." });
  }
});

function isbn13(value) {
  const isbn = normalizeIsbn(value);
  if (/^97[89]\d{10}$/.test(isbn)) return isbn;
  if (!/^\d{9}[\dX]$/.test(isbn)) return "";
  const body = `978${isbn.slice(0, 9)}`;
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

// Vyhľadá knihu na Martinuse podľa ISBN a vráti ju len vtedy, keď ISBN produktu presne sedí.
async function findMartinusBookByIsbn(isbn) {
  const searchUrl = new URL("https://www.martinus.sk/search");
  searchUrl.searchParams.set("q", isbn);
  const search = await fetchMartinusPage(searchUrl);
  const direct = extractMartinusBook(search.html, search.url);
  if (direct && isbn13(direct.isbn) === isbn) return direct;

  const links = [];
  for (const match of search.html.matchAll(/class="product-cover[^"]*"\s+href="(\/[^"?#]+)"/g)) {
    if (!links.includes(match[1])) links.push(match[1]);
    if (links.length >= 3) break;
  }
  for (const link of links) {
    const page = await fetchMartinusPage(parseMartinusUrl(new URL(link, "https://www.martinus.sk").toString()));
    const book = extractMartinusBook(page.html, page.url);
    if (book && isbn13(book.isbn) === isbn) return book;
  }
  return null;
}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
  }
  const lower = address.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  // Verejné IPv6 adresy sú len v rozsahu 2000::/3.
  return !/^[23][0-9a-f]{3}:/.test(lower);
}

// Povolené sú len verejné HTTPS stránky; adresy vo vnútornej sieti sa odmietnu.
async function assertPublicUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Vlož platný odkaz na stránku knihy.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || String(value).length > 2048 ||
      net.isIP(host) || !host.includes(".") || /(^|\.)(localhost|local|internal|lan|home|corp|intranet)$/i.test(host)) {
    throw new Error("Načítať sa dá len verejná stránka s adresou https://.");
  }
  let addresses;
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch {
    throw new Error("Stránku na tejto adrese sa nepodarilo nájsť.");
  }
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("Načítať sa dá len verejná stránka s adresou https://.");
  }
  return url;
}

async function fetchPublicResource(startUrl, accept, maxBytes) {
  let url = await assertPublicUrl(String(startUrl));
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    const response = await fetch(url, {
      headers: { Accept: accept, "User-Agent": "TyCitaj/1.0 (+local book library)" },
      redirect: "manual",
      signal: AbortSignal.timeout(10000)
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location || redirects === 4) throw new Error("Stránka presmerovala príliš veľakrát.");
      url = await assertPublicUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new Error(`Stránka vrátila chybu HTTP ${response.status}.`);
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxBytes) throw new Error("Stránka je príliš veľká.");
      chunks.push(chunk);
    }
    return { bytes: Buffer.concat(chunks), type: (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase(), url };
  }
  throw new Error("Stránku sa nepodarilo načítať.");
}

function metaContent(html, names) {
  for (const name of names) {
    const pattern = new RegExp(`<meta\\b[^>]*(?:property|name)=["']${name}["'][^>]*>`, "i");
    const tag = html.match(pattern);
    const content = tag && tag[0].match(/content=["']([^"']*)["']/i);
    if (content && content[1].trim()) return decodeHtmlText(content[1]);
  }
  return "";
}

// Údaje o knihe z ľubovoľnej stránky: schema.org Book, inak Open Graph značky.
function extractGenericBook(html) {
  let schema = null;
  for (const script of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      schema = findBookSchema(JSON.parse(script[1]));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    if (schema) break;
  }
  const schemaAuthors = schema ? (Array.isArray(schema.author) ? schema.author : [schema.author]) : [];
  const schemaImage = schema ? (Array.isArray(schema.image) ? schema.image[0] : schema.image) : "";
  const schemaFormat = String((schema && schema.bookFormat) || "");
  const title = decodeHtmlText((schema && schema.name) || metaContent(html, ["og:title", "twitter:title"])).slice(0, 300);
  if (!title) return null;
  const pages = Number.parseInt(schema && schema.numberOfPages, 10) || Number.parseInt(metaContent(html, ["books:page_count"]), 10) || 0;
  const description = decodeHtmlText(String((schema && schema.description) || metaContent(html, ["og:description", "description"])).replace(/<[^>]*>/g, " ")).slice(0, 1500);
  return {
    title,
    author: decodeHtmlText(schemaAuthors.map((entry) => typeof entry === "string" ? entry : entry && entry.name).filter(Boolean).join(", ") ||
      metaContent(html, ["books:author", "book:author", "author"])).slice(0, 300),
    isbn: String((schema && schema.isbn) || metaContent(html, ["books:isbn", "book:isbn"])).replace(/[^0-9Xx-]/g, "").slice(0, 40),
    totalPages: Math.max(0, pages),
    format: /ebook/i.test(schemaFormat) ? "E-kniha" : /hardcover/i.test(schemaFormat) ? "Pevná väzba" : /paperback/i.test(schemaFormat) ? "Mäkká väzba" : "",
    description,
    coverUrl: typeof schemaImage === "string" && schemaImage ? schemaImage : metaContent(html, ["og:image", "twitter:image"]),
    rating: null,
    publisher: "",
    genres: []
  };
}

async function lookupBookLink(value) {
  let martinusUrl = null;
  try {
    martinusUrl = parseMartinusUrl(value);
  } catch {
    martinusUrl = null;
  }
  if (martinusUrl) {
    const page = await fetchMartinusPage(martinusUrl);
    return extractMartinusBook(page.html, page.url);
  }
  const page = await fetchPublicResource(value, "text/html", 3 * 1024 * 1024);
  if (!page.type.includes("html")) throw new Error("Odkaz nevedie na stránku knihy.");
  const html = page.bytes.toString("utf8");
  const book = extractGenericBook(html);
  if (!book) return null;
  book.martinusUrl = page.url.toString();
  book.cover = "";
  if (book.coverUrl) {
    try {
      const image = await fetchPublicResource(new URL(book.coverUrl, page.url).toString(), "image/*", 1500 * 1024);
      if (/^image\/(jpeg|png|webp|gif)$/.test(image.type)) book.cover = `data:${image.type};base64,${image.bytes.toString("base64")}`;
    } catch (error) {
      console.warn("Obálku z odkazu sa nepodarilo načítať:", error.message);
    }
  }
  delete book.coverUrl;
  return book;
}

app.post("/api/lookup/link", async (req, res) => {
  const value = req.body && req.body.url;
  if (typeof value !== "string" || !value.trim()) return res.status(400).json({ error: "Vlož odkaz na stránku knihy." });
  try {
    const book = await lookupBookLink(value.trim());
    if (!book) return res.status(422).json({ error: "Na stránke sa nenašli údaje o knihe. Skús iný odkaz alebo údaje doplň manuálne." });
    res.json(book);
  } catch (error) {
    console.error("Nepodarilo sa načítať knihu z odkazu:", error);
    const known = /^(Vlož|Načítať|Stránk|Odkaz)/.test(error.message);
    res.status(known ? 400 : 502).json({ error: known ? error.message : "Stránku sa nepodarilo načítať. Skús to znova alebo údaje doplň manuálne." });
  }
});

app.post("/api/lookup/martinus-search", async (req, res) => {
  const query = String((req.body && req.body.q) || "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (query.length < 2) return res.status(400).json({ error: "Zadaj aspoň dva znaky názvu alebo autora." });
  try {
    const searchUrl = new URL("https://www.martinus.sk/search");
    searchUrl.searchParams.set("q", query);
    const page = await fetchMartinusPage(searchUrl);
    res.json({ results: extractMartinusSearchResults(page.html) });
  } catch (error) {
    console.error("Nepodarilo sa prehľadať Martinus:", error);
    res.status(502).json({ error: "Martinus sa nepodarilo prehľadať. Skús to znova neskôr." });
  }
});

app.post("/api/lookup/martinus-isbn", async (req, res) => {
  const isbn = isbn13(req.body && req.body.isbn);
  if (!isbn) return res.status(400).json({ error: "Zadaj platné ISBN‑10 alebo ISBN‑13." });
  try {
    const book = await findMartinusBookByIsbn(isbn);
    if (!book) return res.status(404).json({ error: "Kniha s týmto ISBN sa na Martinuse nenašla." });
    res.json(book);
  } catch (error) {
    console.error("Nepodarilo sa vyhľadať knihu na Martinuse podľa ISBN:", error);
    res.status(502).json({ error: "Martinus sa nepodarilo prehľadať. Skús to znova neskôr." });
  }
});

app.post("/api/books", async (req, res, next) => {
  try {
    const book = normalizeBook(req.body);
    let duplicate;
    await serializedWrite(async () => {
      const data = await readLibrary(req.user.email);
      duplicate = findDuplicateBook(data.books, book);
      if (duplicate) return;
      data.books.unshift(book);
      await writeLibrary(data, req.user.email);
    });
    if (duplicate) return res.status(409).json({ error: duplicateBookError(duplicate), duplicateBook: duplicate });
    res.status(201).json(book);
  } catch (error) {
    if (error.message.includes("povinný") || error.message.includes("príliš dlhý") || error.message.includes("objekt")) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

app.put("/api/books/:id", async (req, res, next) => {
  try {
    let updated;
    let duplicate;
    let conflictBook;
    let unchangedBook;
    const expectedUpdatedAt = req.get("if-match");
    await serializedWrite(async () => {
      const data = await readLibrary(req.user.email);
      const index = data.books.findIndex((book) => book.id === req.params.id);
      if (index < 0) return;
      unchangedBook = data.books[index];
      if (expectedUpdatedAt && (data.books[index].updatedAt || "__missing__") !== expectedUpdatedAt) {
        conflictBook = data.books[index];
        return;
      }
      updated = normalizeBook(req.body, data.books[index]);
      duplicate = findDuplicateBook(data.books, updated, updated.id);
      if (duplicate) return;
      data.books[index] = updated;
      await writeLibrary(data, req.user.email);
    });
    if (conflictBook) return res.status(409).json({ error: "Kniha sa medzitým zmenila na serveri.", currentBook: conflictBook });
    if (!updated) return res.status(404).json({ error: "Kniha sa nenašla." });
    if (duplicate) return res.status(409).json({
      error: duplicateBookError(duplicate),
      duplicateBook: duplicate,
      currentBook: unchangedBook
    });
    res.json(updated);
  } catch (error) {
    if (error.message.includes("povinný") || error.message.includes("príliš dlhý") || error.message.includes("objekt")) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

app.delete("/api/books/:id", async (req, res, next) => {
  try {
    let removed = false;
    let conflictBook;
    const expectedUpdatedAt = req.get("if-match");
    await serializedWrite(async () => {
      const data = await readLibrary(req.user.email);
      const currentBook = data.books.find((book) => book.id === req.params.id);
      if (currentBook && expectedUpdatedAt && (currentBook.updatedAt || "__missing__") !== expectedUpdatedAt) {
        conflictBook = currentBook;
        return;
      }
      const remaining = data.books.filter((book) => book.id !== req.params.id);
      if (remaining.length === data.books.length) return;
      data.books = remaining;
      await writeLibrary(data, req.user.email);
      removed = true;
    });
    if (conflictBook) return res.status(409).json({ error: "Kniha sa medzitým zmenila na serveri.", currentBook: conflictBook });
    if (!removed) return res.status(404).json({ error: "Kniha sa nenašla." });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get("/api/export", async (req, res, next) => {
  try {
    const data = await readLibrary(req.user.email);
    if (req.query.format === "bookmory") {
      const archive = await exportBookmory(data.books);
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", 'attachment; filename="tycitaj-export.bookmory"');
      return res.send(archive);
    }
    if (req.query.format && req.query.format !== "json") {
      return res.status(400).json({ error: "Vyber formát JSON alebo Bookmory." });
    }
    res.setHeader("Content-Disposition", 'attachment; filename="tycitaj-export.json"');
    res.json({ ...data, exportedAt: new Date().toISOString() });
  } catch (error) {
    next(error);
  }
});

function decodeBookmoryUpload(value) {
  if (typeof value !== "string" || !value || value.length > 11_184_812 ||
      value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new BookmoryFormatError("Bookmory súbor sa nepodarilo načítať.");
  }
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.length > 8 * 1024 * 1024 || bytes.toString("base64") !== value) {
    throw new BookmoryFormatError("Bookmory súbor je neplatný alebo väčší ako 8 MB.");
  }
  return bytes;
}

app.post("/api/import/preview", async (req, res, next) => {
  try {
    if (!req.body || req.body.format !== "bookmory") {
      return res.status(400).json({ error: "Náhľad podporuje iba súbor Bookmory." });
    }
    const books = await importBookmory(decodeBookmoryUpload(req.body.file));
    res.json({ imported: books.length });
  } catch (error) {
    if (error instanceof BookmoryFormatError) return res.status(400).json({ error: error.message });
    next(error);
  }
});

app.post("/api/import", async (req, res, next) => {
  try {
    const importedBooks = req.body && req.body.format === "bookmory"
      ? await importBookmory(decodeBookmoryUpload(req.body.file))
      : null;
    const books = importedBooks || (Array.isArray(req.body) ? req.body : req.body && req.body.books);
    if (!Array.isArray(books)) return res.status(400).json({ error: "Import musí obsahovať zoznam kníh." });
    const normalized = books.map((book) => normalizeBook(book, book));
    const ids = new Set();
    for (const book of normalized) {
      if (ids.has(book.id)) return res.status(400).json({ error: "Import obsahuje duplicitné ID kníh." });
      ids.add(book.id);
    }
    await serializedWrite(() => writeLibrary({ version: 1, books: normalized }, req.user.email));
    res.json({ imported: normalized.length });
  } catch (error) {
    if (error instanceof BookmoryFormatError) return res.status(400).json({ error: error.message });
    if (error.message.includes("povinný") || error.message.includes("príliš dlhý") || error.message.includes("objekt")) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof SyntaxError && "body" in error) {
    return res.status(400).json({ error: "Požiadavka neobsahuje platný JSON." });
  }
  console.error(error);
  res.status(500).json({ error: "Operácia zlyhala. Skontrolujte serverové logy." });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`TyCitaj počúva na porte ${port}`);
});
