(() => {
  const databaseName = "tycitaj-offline";
  const databaseVersion = 1;
  let databasePromise;

  function openDatabase() {
    if (!databasePromise) {
      databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName, databaseVersion);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains("cache")) {
            database.createObjectStore("cache", { keyPath: "key" });
          }
          if (!database.objectStoreNames.contains("outbox")) {
            database.createObjectStore("outbox", { keyPath: "key" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Offline úložisko sa nepodarilo otvoriť."));
        request.onblocked = () => reject(new Error("Offline úložisko čaká na zatvorenie inej karty TyCitaj."));
      });
    }
    return databasePromise;
  }

  async function requestFrom(storeName, mode, action) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      const request = action(store);
      let result;
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error || new Error("Operácia v offline úložisku zlyhala."));
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error || new Error("Zápis do offline úložiska zlyhal."));
      transaction.onabort = () => reject(transaction.error || new Error("Zápis do offline úložiska bol prerušený."));
    });
  }

  async function persistBooksAndOperation(email, books, operationKey, operation) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(["cache", "outbox"], "readwrite");
      transaction.objectStore("cache").put({ key: `books:${email}`, value: books });
      if (operation) transaction.objectStore("outbox").put(operation);
      else transaction.objectStore("outbox").delete(operationKey);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Offline zmena sa nepodarilo uložiť."));
      transaction.onabort = () => reject(transaction.error || new Error("Offline zmena bola prerušená."));
    });
  }

  window.TyCitajOffline = {
    getCache(key) {
      return requestFrom("cache", "readonly", (store) => store.get(key));
    },
    putCache(key, value) {
      return requestFrom("cache", "readwrite", (store) => store.put({ key, value }));
    },
    deleteCache(key) {
      return requestFrom("cache", "readwrite", (store) => store.delete(key));
    },
    getOutbox(email) {
      return requestFrom("outbox", "readonly", (store) => store.getAll())
        .then((items) => items.filter((item) => item.email === email));
    },
    getOutboxItem(key) {
      return requestFrom("outbox", "readonly", (store) => store.get(key));
    },
    putOutbox(item) {
      return requestFrom("outbox", "readwrite", (store) => store.put(item));
    },
    deleteOutbox(key) {
      return requestFrom("outbox", "readwrite", (store) => store.delete(key));
    },
    saveMutation(email, books, operation) {
      return persistBooksAndOperation(email, books, operation.key, operation);
    },
    completeMutation(email, books, operationKey) {
      return persistBooksAndOperation(email, books, operationKey, null);
    },
    async clearAccount(email) {
      const database = await openDatabase();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(["cache", "outbox"], "readwrite");
        const cache = transaction.objectStore("cache");
        const outbox = transaction.objectStore("outbox");
        cache.delete(`books:${email}`);
        cache.delete(`account:${email}`);
        const request = outbox.getAll();
        request.onsuccess = () => {
          request.result.filter((item) => item.email === email)
            .forEach((item) => outbox.delete(item.key));
        };
        request.onerror = () => reject(request.error || new Error("Offline zmeny sa nepodarilo vymazať."));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error("Offline účet sa nepodarilo vymazať."));
        transaction.onabort = () => reject(transaction.error || new Error("Odstránenie offline účtu bolo prerušené."));
      });
    }
  };
})();
