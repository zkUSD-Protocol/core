import { Cache } from "o1js";
import { compiledFiles } from "./compiled-files";

const DB_NAME = "mina-cache";
const STORE_NAME = "compiled-files";
const DB_VERSION = 1;

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
};

const fetchFiles = async () => {
  console.log("Starting fetchFiles...");
  try {
    // Try to get files from IndexedDB first
    console.log("Opening IndexedDB...");
    const db = await openDB();
    console.log("IndexedDB opened successfully");

    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    console.log("Created transaction and store");

    const cachedFiles = await new Promise<any[]>((resolve, reject) => {
      console.log("Attempting to get all files from store...");
      const request = store.getAll();
      request.onerror = () => {
        console.error("Error getting files from store:", request.error);
        reject(request.error);
      };
      request.onsuccess = () => {
        console.log(
          `Retrieved ${request.result?.length || 0} files from cache`
        );
        resolve(request.result);
      };
    });

    if (cachedFiles && cachedFiles.length > 0) {
      console.log("Found cached files, processing...");
      const filesMap = cachedFiles.reduce((acc: any, file: any) => {
        acc[file.file.name] = file;
        return acc;
      }, {});
      console.log(
        "Files map created:",
        Object.keys(filesMap).length,
        "entries"
      );
      // Log a sample entry to verify structure
      const sampleKey = Object.keys(filesMap)[0];
      console.log("Sample entry structure:", {
        key: sampleKey,
        hasFile: !!filesMap[sampleKey].file,
        hasData: !!filesMap[sampleKey].data,
      });
      return filesMap;
    }
    console.log("No cached files found, proceeding to fetch");
  } catch (error) {
    console.error("Failed to read from IndexedDB:", error);
  }

  // If not in cache or error occurred, fetch files
  console.log("Starting to fetch files from server...");
  const files = await Promise.all(
    compiledFiles.map((file) => {
      console.log(`Fetching file: ${file.name}`);
      return Promise.all([
        fetch(`http://localhost:3000//assets/cache/${file.name}`).then((res) =>
          res.text()
        ),
      ]).then(([data]) => ({ file, data }));
    })
  ).then((cacheList) => {
    console.log(`Fetched ${cacheList.length} files from server`);
    return cacheList.reduce((acc: any, { file, data }) => {
      acc[file.name] = { file, data };
      return acc;
    }, {});
  });

  // Try to store in IndexedDB
  const storeInChunks = async (files: any) => {
    const CHUNK_SIZE = 5; // Process 5 files at a time
    const fileEntries = Object.entries(files);
    console.log(
      `Starting to store ${fileEntries.length} files in chunks of ${CHUNK_SIZE}`
    );

    for (let i = 0; i < fileEntries.length; i += CHUNK_SIZE) {
      const chunk = fileEntries.slice(i, i + CHUNK_SIZE);
      console.log(
        `Processing chunk ${i / CHUNK_SIZE + 1} of ${Math.ceil(
          fileEntries.length / CHUNK_SIZE
        )}`
      );

      try {
        const db = await openDB();
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);

        // Store chunk of files
        chunk.forEach(([key, fileData]: [string, any]) => {
          console.log(`Attempting to store: ${key}`);
          const request = store.put(fileData, key);

          request.onerror = () => {
            console.error(`Failed to store file ${key}:`, request.error);
          };

          request.onsuccess = () => {
            console.log(`Successfully stored: ${key}`);
          };
        });

        // Wait for the transaction to complete
        await new Promise((resolve, reject) => {
          transaction.oncomplete = () => {
            console.log(`Chunk ${i / CHUNK_SIZE + 1} stored successfully`);
            resolve(undefined);
          };
          transaction.onerror = () => {
            console.error(
              `Error storing chunk ${i / CHUNK_SIZE + 1}:`,
              transaction.error
            );
            reject(transaction.error);
          };
          transaction.onabort = () => {
            console.error(
              `Transaction aborted for chunk ${i / CHUNK_SIZE + 1}:`,
              transaction.error
            );
            reject(transaction.error);
          };
        });
      } catch (error) {
        console.error(`Failed to save chunk ${i / CHUNK_SIZE + 1}:`, error);
        throw error; // Re-throw to handle it in the outer try-catch
      }
    }
  };

  try {
    console.log("Attempting to store fetched files in IndexedDB...");
    await storeInChunks(files);
    console.log("Successfully stored all files in IndexedDB");
  } catch (error) {
    console.error("Failed to save to IndexedDB:", error);
  }

  // Verify storage
  try {
    const db = await openDB();
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);

    const count = await new Promise<number>((resolve, reject) => {
      const request = store.count();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });

    console.log(`Verification: ${count} files are now stored in IndexedDB`);
  } catch (error) {
    console.error("Failed to verify storage:", error);
  }

  console.log("Returning fetched files");
  return files;
};

const FileSystem = (files: any): Cache => ({
  read({ persistentId, dataType }: any) {
    try {
      console.log("Looking in cache", { persistentId, dataType });
      return new TextEncoder().encode(files[persistentId].data);
    } catch (error) {
      console.log("Didnt find in cache", { persistentId, dataType });
      console.log("error", error);

      return undefined;
    }
    // read current uniqueId, return data if it matches
    if (!files[persistentId]) {
      console.log("read");
      console.log({ persistentId, dataType });

      return undefined;
    }

    // const currentId = files[persistentId].header;

    // if (currentId !== uniqueId) {
    //   console.log("current id did not match persistent id");

    //   return undefined;
    // }

    if (dataType === "string") {
      console.log("found in cache", { persistentId, dataType });

      return new TextEncoder().encode(files[persistentId].data);
    }
    // else {
    //   let buffer = readFileSync(resolve(cacheDirectory, persistentId));
    //   return new Uint8Array(buffer.buffer);
    // }

    return undefined;
  },
  write({ persistentId, dataType }: any, data: any) {
    console.log("write");
    console.log({ persistentId, dataType });
  },
  canWrite: true,
});

export { FileSystem, fetchFiles };
