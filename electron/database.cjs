const fs = require("node:fs");
const path = require("node:path");
const initSqlJs = require("sql.js");

const DEFAULT_STORAGE_ROOT = "D:\\ManagerMultiProfile_data";
const DEFAULT_DATABASE_PATH = path.join(DEFAULT_STORAGE_ROOT, "database.db");

let sqlPromise;
const backedUpDatabases = new Map();

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function safeFileId(value) {
  return String(value == null ? "" : value)
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 96);
}

function getSql(wasmPath) {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({ locateFile: () => wasmPath });
  }
  return sqlPromise;
}

function queryObjects(database, sql) {
  const result = database.exec(sql)[0];
  if (!result) return [];
  return result.values.map((values) =>
    Object.fromEntries(
      result.columns.map((column, index) => [column, values[index] == null ? "" : String(values[index])]),
    ),
  );
}

function findColumn(columns, expectedName) {
  return columns.find((column) => String(column.name).toLowerCase() === expectedName.toLowerCase())?.name;
}

function backupPathFor(databasePath, storageRoot) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 17);
  const backupsDir = path.join(storageRoot || path.dirname(databasePath), "backups");
  fs.mkdirSync(backupsDir, { recursive: true });
  const baseName = path.basename(databasePath, path.extname(databasePath));
  return path.join(backupsDir, `${baseName}.mmp-backup-${stamp}.db`);
}

function createBackupOnce(database, databasePath, storageRoot) {
  if (backedUpDatabases.has(databasePath)) return backedUpDatabases.get(databasePath);
  const backupPath = backupPathFor(databasePath, storageRoot);
  const escapedPath = backupPath.replaceAll("'", "''");
  database.exec(`VACUUM INTO '${escapedPath}'`);
  backedUpDatabases.set(databasePath, backupPath);
  return backupPath;
}

function ensureStorageDirs(storageRoot = DEFAULT_STORAGE_ROOT) {
  const root = path.resolve(storageRoot || DEFAULT_STORAGE_ROOT);
  const dirs = {
    root,
    profiles: path.join(root, "profiles"),
    cookies: path.join(root, "cookies"),
    extensions: path.join(root, "extensions"),
    backups: path.join(root, "backups"),
  };
  for (const dir of Object.values(dirs)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dirs;
}

function ensureDatabase(databasePath) {
  const resolved = path.resolve(databasePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(resolved);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec(`
      CREATE TABLE IF NOT EXISTS "accounts" (
        "ID" INTEGER PRIMARY KEY AUTOINCREMENT,
        "UID" TEXT NOT NULL UNIQUE,
        "Name" TEXT DEFAULT '',
        "Platform" TEXT DEFAULT 'TikTok',
        "StartUrl" TEXT DEFAULT 'https://www.tiktok.com/',
        "Email" TEXT DEFAULT '',
        "Password" TEXT DEFAULT '',
        "TwoFA" TEXT DEFAULT '',
        "Phone" TEXT DEFAULT '',
        "Proxy" TEXT DEFAULT '',
        "Cookie" TEXT DEFAULT '',
        "Cookie_2" TEXT DEFAULT '',
        "Token" TEXT DEFAULT '',
        "UserAgent" TEXT DEFAULT '',
        "Folder" TEXT DEFAULT 'Không có nhóm',
        "Status" TEXT DEFAULT 'Chưa login',
        "Note" TEXT DEFAULT '',
        "LastActive" TEXT DEFAULT '',
        "CreateTime" TEXT DEFAULT '',
        "DateImport" TEXT DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS "folders" (
        "ID" INTEGER PRIMARY KEY AUTOINCREMENT,
        "Name" TEXT NOT NULL UNIQUE
      );
    `);

    // Add missing optional columns gracefully if opening an older/imported DB
    const existingCols = db.prepare('PRAGMA table_info("accounts")').all();
    const hasCol = (name) => Boolean(findColumn(existingCols, name));
    const optionalCols = [
      ["Platform", "TEXT DEFAULT 'TikTok'"],
      ["StartUrl", "TEXT DEFAULT ''"],
      ["Note", "TEXT DEFAULT ''"],
    ];
    for (const [colName, colDef] of optionalCols) {
      if (!hasCol(colName)) {
        try {
          db.exec(`ALTER TABLE "accounts" ADD COLUMN ${quoteIdentifier(colName)} ${colDef}`);
        } catch {
          // Ignore if schema cannot be altered
        }
      }
    }
  } finally {
    db.close();
  }
  return resolved;
}

function saveCookieToDisk(cookiesDir, uid, cookiePayload, metadata = {}) {
  const safeUid = safeFileId(uid);
  const rawCookie = String(cookiePayload == null ? "" : cookiePayload).trim();
  if (!safeUid || !rawCookie) return false;
  try {
    fs.mkdirSync(cookiesDir, { recursive: true });
    const txtPath = path.join(cookiesDir, `${safeUid}.txt`);
    fs.writeFileSync(txtPath, rawCookie, "utf8");

    const jsonPath = path.join(cookiesDir, `${safeUid}.json`);
    const record = {
      uid: String(uid).trim(),
      cookie: rawCookie,
      updatedAt: new Date().toISOString(),
      status: metadata.status || "Live",
      ...metadata,
    };
    fs.writeFileSync(jsonPath, JSON.stringify(record, null, 2), "utf8");
    return true;
  } catch (error) {
    console.error("Lỗi lưu cookie ra disk:", error);
    return false;
  }
}

function readCookieFromDisk(cookiesDir, uid) {
  const safeUid = safeFileId(uid);
  if (!safeUid || !cookiesDir) return "";
  const jsonPath = path.join(cookiesDir, `${safeUid}.json`);
  if (fs.existsSync(jsonPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      if (parsed?.cookie) return String(parsed.cookie).trim();
      if (parsed?.cookieHeader) return String(parsed.cookieHeader).trim();
    } catch {
      // Fall through to txt
    }
  }
  const txtPath = path.join(cookiesDir, `${safeUid}.txt`);
  if (fs.existsSync(txtPath)) {
    try {
      const val = fs.readFileSync(txtPath, "utf8").trim();
      if (val) return val;
    } catch {
      // Ignore
    }
  }
  return "";
}

async function readProfileDatabase(databasePath, wasmPath) {
  const resolved = ensureDatabase(databasePath);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error("Đường dẫn database không phải là một file.");

  const SQL = await getSql(wasmPath);
  const buffer = fs.readFileSync(resolved);
  const database = new SQL.Database(new Uint8Array(buffer));
  try {
    const columnsRaw = queryObjects(database, 'PRAGMA table_info("accounts")');
    const columns = columnsRaw.map((row) => ({ name: row.name, type: row.type || "TEXT" }));
    const accounts = queryObjects(database, 'SELECT * FROM "accounts" ORDER BY rowid DESC');

    const folderCounts = new Map();
    for (const acc of accounts) {
      const folder = String(acc.Folder || "").trim() || "Không có nhóm";
      folderCounts.set(folder, (folderCounts.get(folder) || 0) + 1);
    }

    let folderNames = [];
    try {
      const folderRows = queryObjects(database, 'SELECT * FROM "folders"');
      folderNames = folderRows
        .map((row) => String(row.Name || row.name || "").trim())
        .filter(Boolean);
    } catch {
      folderNames = [];
    }

    const seen = new Set();
    const groups = [];
    for (const name of [...folderNames, ...folderCounts.keys()]) {
      const cleanName = String(name || "").trim();
      if (!cleanName || cleanName === "Không có nhóm") continue;
      const key = cleanName.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      groups.push({ name: cleanName, count: folderCounts.get(cleanName) || 0 });
    }

    if (folderCounts.get("Không có nhóm")) {
      groups.push({ name: "Không có nhóm", count: folderCounts.get("Không có nhóm") });
    }

    return {
      databasePath: resolved,
      databaseModifiedAt: stat.mtime.toISOString(),
      databaseSize: stat.size,
      columns,
      accounts,
      groups,
    };
  } finally {
    database.close();
  }
}

function saveAccountSession(databasePath, payload, options = {}) {
  const { DatabaseSync } = require("node:sqlite");
  const resolved = ensureDatabase(databasePath);
  const uid = payload?.uid == null ? "" : String(payload.uid).trim();
  const status = payload?.status == null ? "" : String(payload.status).trim();
  const cookieHeader = payload?.cookieHeader == null ? "" : String(payload.cookieHeader);
  const updateCookie = Boolean(payload?.updateCookie);
  if (!uid) throw new Error("Không có UID để cập nhật database.");
  if (!status) throw new Error("Không có trạng thái tài khoản để cập nhật.");
  if (updateCookie && !cookieHeader) throw new Error("Không có cookie hợp lệ để lưu.");

  const database = new DatabaseSync(resolved);
  try {
    database.exec("PRAGMA busy_timeout = 5000");
    const columns = database.prepare('PRAGMA table_info("accounts")').all();
    const uidColumn = findColumn(columns, "UID");
    const cookieColumn = findColumn(columns, "Cookie");
    const statusColumn = findColumn(columns, "Status");
    const lastActiveColumn = findColumn(columns, "LastActive");
    if (!uidColumn || !statusColumn || (updateCookie && !cookieColumn)) {
      throw new Error("Database thiếu cột UID, Cookie hoặc Status cần thiết.");
    }

    const exists = database
      .prepare(`SELECT 1 AS found FROM "accounts" WHERE ${quoteIdentifier(uidColumn)} = ? LIMIT 1`)
      .get(uid);
    if (!exists) throw new Error("Không tìm thấy UID trong database đang mở.");

    const backupPath = createBackupOnce(database, resolved, options.storageRoot);
    const assignments = [`${quoteIdentifier(statusColumn)} = ?`];
    const values = [status];
    if (updateCookie) {
      assignments.push(`${quoteIdentifier(cookieColumn)} = ?`);
      values.push(cookieHeader);
      if (options.cookiesDir) {
        saveCookieToDisk(options.cookiesDir, uid, cookieHeader, {
          status,
          platform: payload.platform || "TikTok",
        });
      }
    }
    if (lastActiveColumn) {
      assignments.push(`${quoteIdentifier(lastActiveColumn)} = ?`);
      values.push(String(Math.floor(Date.now() / 1000)));
    }
    values.push(uid);

    database.exec("BEGIN IMMEDIATE");
    try {
      database
        .prepare(`UPDATE "accounts" SET ${assignments.join(", ")} WHERE ${quoteIdentifier(uidColumn)} = ?`)
        .run(...values);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }

    return { uid, status, updated: true, backupPath };
  } finally {
    database.close();
  }
}

function createAccountGroup(databasePath, rawName, options = {}) {
  const { DatabaseSync } = require("node:sqlite");
  const resolved = ensureDatabase(databasePath);
  const groupName = String(rawName == null ? "" : rawName).trim();
  if (!groupName) throw new Error("Tên nhóm không được để trống.");
  if (groupName === "Không có nhóm") throw new Error("Không thể tạo nhóm trùng tên mặc định.");

  const database = new DatabaseSync(resolved);
  try {
    database.exec("PRAGMA busy_timeout = 5000");
    const backupPath = createBackupOnce(database, resolved, options.storageRoot);
    const folderCols = database.prepare('PRAGMA table_info("folders")').all();
    const nameCol = findColumn(folderCols, "Name") || "Name";

    const exists = database
      .prepare(`SELECT 1 AS f FROM "folders" WHERE LOWER(${quoteIdentifier(nameCol)}) = LOWER(?) LIMIT 1`)
      .get(groupName);
    if (exists) throw new Error(`Nhóm "${groupName}" đã tồn tại.`);

    database.prepare(`INSERT INTO "folders" (${quoteIdentifier(nameCol)}) VALUES (?)`).run(groupName);
    return { groupName, created: true, backupPath, message: `Đã tạo nhóm "${groupName}".` };
  } finally {
    database.close();
  }
}

function renameAccountGroup(databasePath, oldNameRaw, newNameRaw, options = {}) {
  const { DatabaseSync } = require("node:sqlite");
  const resolved = ensureDatabase(databasePath);
  const oldName = String(oldNameRaw == null ? "" : oldNameRaw).trim();
  const newName = String(newNameRaw == null ? "" : newNameRaw).trim();
  if (!oldName || !newName) throw new Error("Tên nhóm cũ và mới không được để trống.");
  if (oldName === "Không có nhóm" || newName === "Không có nhóm") {
    throw new Error("Không thể đổi tên nhóm mặc định.");
  }

  const database = new DatabaseSync(resolved);
  try {
    database.exec("PRAGMA busy_timeout = 5000");
    const backupPath = createBackupOnce(database, resolved, options.storageRoot);
    const accCols = database.prepare('PRAGMA table_info("accounts")').all();
    const folderCol = findColumn(accCols, "Folder");
    const folderCols = database.prepare('PRAGMA table_info("folders")').all();
    const nameCol = findColumn(folderCols, "Name") || "Name";

    const duplicate = database
      .prepare(`SELECT 1 AS f FROM "folders" WHERE LOWER(${quoteIdentifier(nameCol)}) = LOWER(?) AND LOWER(${quoteIdentifier(nameCol)}) != LOWER(?) LIMIT 1`)
      .get(newName, oldName);
    if (duplicate) throw new Error(`Nhóm "${newName}" đã tồn tại.`);

    let affectedAccounts = 0;
    database.exec("BEGIN IMMEDIATE");
    try {
      const updatedFolder = database
        .prepare(`UPDATE "folders" SET ${quoteIdentifier(nameCol)} = ? WHERE LOWER(${quoteIdentifier(nameCol)}) = LOWER(?)`)
        .run(newName, oldName);
      if (updatedFolder.changes === 0) {
        database.prepare(`INSERT INTO "folders" (${quoteIdentifier(nameCol)}) VALUES (?)`).run(newName);
      }
      if (folderCol) {
        const accRes = database
          .prepare(`UPDATE "accounts" SET ${quoteIdentifier(folderCol)} = ? WHERE LOWER(${quoteIdentifier(folderCol)}) = LOWER(?)`)
          .run(newName, oldName);
        affectedAccounts = Number(accRes.changes || 0);
      }
      database.exec("COMMIT");
    } catch (err) {
      database.exec("ROLLBACK");
      throw err;
    }

    return {
      oldName,
      groupName: newName,
      updated: true,
      affectedAccounts,
      backupPath,
      message: `Đã đổi tên nhóm "${oldName}" thành "${newName}" (${affectedAccounts} profile).`,
    };
  } finally {
    database.close();
  }
}

function deleteAccountGroup(databasePath, groupNameRaw, moveToGroupRaw = "Không có nhóm", options = {}) {
  const { DatabaseSync } = require("node:sqlite");
  const resolved = ensureDatabase(databasePath);
  const groupName = String(groupNameRaw == null ? "" : groupNameRaw).trim();
  const moveToGroup = String(moveToGroupRaw == null ? "" : moveToGroupRaw).trim() || "Không có nhóm";
  if (!groupName || groupName === "Không có nhóm") throw new Error("Không thể xóa nhóm mặc định.");

  const database = new DatabaseSync(resolved);
  try {
    database.exec("PRAGMA busy_timeout = 5000");
    const backupPath = createBackupOnce(database, resolved, options.storageRoot);
    const accCols = database.prepare('PRAGMA table_info("accounts")').all();
    const folderCol = findColumn(accCols, "Folder");
    const folderCols = database.prepare('PRAGMA table_info("folders")').all();
    const nameCol = findColumn(folderCols, "Name") || "Name";

    let movedAccounts = 0;
    database.exec("BEGIN IMMEDIATE");
    try {
      if (folderCol) {
        const res = database
          .prepare(`UPDATE "accounts" SET ${quoteIdentifier(folderCol)} = ? WHERE LOWER(${quoteIdentifier(folderCol)}) = LOWER(?)`)
          .run(moveToGroup, groupName);
        movedAccounts = Number(res.changes || 0);
      }
      database
        .prepare(`DELETE FROM "folders" WHERE LOWER(${quoteIdentifier(nameCol)}) = LOWER(?)`)
        .run(groupName);
      database.exec("COMMIT");
    } catch (err) {
      database.exec("ROLLBACK");
      throw err;
    }

    return {
      groupName,
      deleted: true,
      movedAccounts,
      moveToGroup,
      backupPath,
      message: `Đã xóa nhóm "${groupName}" (chuyển ${movedAccounts} profile sang "${moveToGroup}").`,
    };
  } finally {
    database.close();
  }
}

function moveAccountsToGroup(databasePath, uidsRaw, groupNameRaw, options = {}) {
  const { DatabaseSync } = require("node:sqlite");
  const resolved = ensureDatabase(databasePath);
  const uids = [...new Set((Array.isArray(uidsRaw) ? uidsRaw : []).map((v) => String(v || "").trim()).filter(Boolean))];
  const groupName = String(groupNameRaw == null ? "" : groupNameRaw).trim() || "Không có nhóm";
  if (!uids.length) throw new Error("Chưa chọn profile nào để chuyển nhóm.");

  const database = new DatabaseSync(resolved);
  try {
    database.exec("PRAGMA busy_timeout = 5000");
    const backupPath = createBackupOnce(database, resolved, options.storageRoot);
    const accCols = database.prepare('PRAGMA table_info("accounts")').all();
    const uidCol = findColumn(accCols, "UID");
    const folderCol = findColumn(accCols, "Folder");
    if (!uidCol || !folderCol) throw new Error("Database thiếu cột UID hoặc Folder.");

    let moved = 0;
    database.exec("BEGIN IMMEDIATE");
    try {
      if (groupName !== "Không có nhóm") {
        const folderCols = database.prepare('PRAGMA table_info("folders")').all();
        const nameCol = findColumn(folderCols, "Name") || "Name";
        const exists = database
          .prepare(`SELECT 1 AS f FROM "folders" WHERE LOWER(${quoteIdentifier(nameCol)}) = LOWER(?) LIMIT 1`)
          .get(groupName);
        if (!exists) {
          database.prepare(`INSERT INTO "folders" (${quoteIdentifier(nameCol)}) VALUES (?)`).run(groupName);
        }
      }

      const stmt = database.prepare(
        `UPDATE "accounts" SET ${quoteIdentifier(folderCol)} = ? WHERE ${quoteIdentifier(uidCol)} = ?`,
      );
      for (const uid of uids) {
        const res = stmt.run(groupName, uid);
        moved += Number(res.changes || 0);
      }
      database.exec("COMMIT");
    } catch (err) {
      database.exec("ROLLBACK");
      throw err;
    }

    return { groupName, moved, backupPath, message: `Đã chuyển ${moved} profile sang nhóm "${groupName}".` };
  } finally {
    database.close();
  }
}

function createAccount(databasePath, payload, options = {}) {
  const { DatabaseSync } = require("node:sqlite");
  const resolved = ensureDatabase(databasePath);
  const uid = payload?.UID == null ? "" : String(payload.UID).trim();
  if (!uid) throw new Error("Bắt buộc phải nhập UID / Mã profile.");

  const database = new DatabaseSync(resolved);
  try {
    database.exec("PRAGMA busy_timeout = 5000");
    const columns = database.prepare('PRAGMA table_info("accounts")').all();
    const uidColumn = findColumn(columns, "UID");
    if (!uidColumn) throw new Error("Database thiếu cột UID.");

    const exists = database
      .prepare(`SELECT 1 AS found FROM "accounts" WHERE ${quoteIdentifier(uidColumn)} = ? LIMIT 1`)
      .get(uid);
    if (exists) throw new Error(`Profile với UID "${uid}" đã tồn tại trong database.`);

    const backupPath = createBackupOnce(database, resolved, options.storageRoot);
    const nowSeconds = String(Math.floor(Date.now() / 1000));
    const nowIso = new Date().toISOString();

    const fullPayload = {
      Platform: "TikTok",
      StartUrl: options.defaultStartUrl || "https://www.tiktok.com/",
      Status: "Chưa login",
      Folder: "Không có nhóm",
      CreateTime: nowIso,
      DateImport: nowIso,
      LastActive: nowSeconds,
      ...payload,
      UID: uid,
    };

    const insertCols = [];
    const placeholders = [];
    const values = [];

    for (const col of columns) {
      const colName = col.name;
      if (colName.toLowerCase() === "id") continue;
      if (fullPayload[colName] !== undefined && fullPayload[colName] !== null) {
        insertCols.push(quoteIdentifier(colName));
        placeholders.push("?");
        values.push(String(fullPayload[colName]));
      }
    }

    database.exec("BEGIN IMMEDIATE");
    try {
      const sql = `INSERT INTO "accounts" (${insertCols.join(", ")}) VALUES (${placeholders.join(", ")})`;
      database.prepare(sql).run(...values);

      const folderName = String(fullPayload.Folder || "").trim();
      if (folderName && folderName !== "Không có nhóm") {
        const folderColumns = database.prepare('PRAGMA table_info("folders")').all();
        const folderNameColumn = findColumn(folderColumns, "Name") || "Name";
        const hasFolder = database
          .prepare(`SELECT 1 AS f FROM "folders" WHERE LOWER(${quoteIdentifier(folderNameColumn)}) = LOWER(?) LIMIT 1`)
          .get(folderName);
        if (!hasFolder) {
          database.prepare(`INSERT INTO "folders" (${quoteIdentifier(folderNameColumn)}) VALUES (?)`).run(folderName);
        }
      }
      database.exec("COMMIT");
    } catch (err) {
      database.exec("ROLLBACK");
      throw err;
    }

    const cookieVal = fullPayload.Cookie || fullPayload.Cookie_2;
    if (options.cookiesDir && cookieVal && String(cookieVal).trim().length > 5) {
      saveCookieToDisk(options.cookiesDir, uid, String(cookieVal).trim(), {
        name: fullPayload.Name || "",
        status: fullPayload.Status || "Chưa login",
        platform: fullPayload.Platform || "TikTok",
      });
    }

    return { uid, created: true, backupPath, message: `Đã thêm profile "${uid}" thành công.` };
  } finally {
    database.close();
  }
}

function updateAccount(databasePath, payload, options = {}) {
  const { DatabaseSync } = require("node:sqlite");
  const resolved = ensureDatabase(databasePath);
  const uid = payload?.UID == null ? "" : String(payload.UID).trim();
  if (!uid) throw new Error("Thiếu UID profile để cập nhật.");

  const database = new DatabaseSync(resolved);
  try {
    database.exec("PRAGMA busy_timeout = 5000");
    const columns = database.prepare('PRAGMA table_info("accounts")').all();
    const uidColumn = findColumn(columns, "UID");
    if (!uidColumn) throw new Error("Database thiếu cột UID.");

    const exists = database
      .prepare(`SELECT 1 AS found FROM "accounts" WHERE ${quoteIdentifier(uidColumn)} = ? LIMIT 1`)
      .get(uid);
    if (!exists) throw new Error(`Không tìm thấy profile UID "${uid}".`);

    const backupPath = createBackupOnce(database, resolved, options.storageRoot);
    const assignments = [];
    const values = [];

    for (const col of columns) {
      const colName = col.name;
      if (colName.toLowerCase() === "id" || colName.toLowerCase() === "uid") continue;
      if (Object.prototype.hasOwnProperty.call(payload, colName)) {
        assignments.push(`${quoteIdentifier(colName)} = ?`);
        values.push(payload[colName] == null ? "" : String(payload[colName]));
      }
    }

    if (!assignments.length) {
      return { uid, updated: false, backupPath, message: "Không có trường nào thay đổi." };
    }

    values.push(uid);
    database.exec("BEGIN IMMEDIATE");
    try {
      database
        .prepare(`UPDATE "accounts" SET ${assignments.join(", ")} WHERE ${quoteIdentifier(uidColumn)} = ?`)
        .run(...values);

      const folderName = String(payload.Folder || "").trim();
      if (folderName && folderName !== "Không có nhóm") {
        const folderColumns = database.prepare('PRAGMA table_info("folders")').all();
        const folderNameColumn = findColumn(folderColumns, "Name") || "Name";
        const hasFolder = database
          .prepare(`SELECT 1 AS f FROM "folders" WHERE LOWER(${quoteIdentifier(folderNameColumn)}) = LOWER(?) LIMIT 1`)
          .get(folderName);
        if (!hasFolder) {
          database.prepare(`INSERT INTO "folders" (${quoteIdentifier(folderNameColumn)}) VALUES (?)`).run(folderName);
        }
      }
      database.exec("COMMIT");
    } catch (err) {
      database.exec("ROLLBACK");
      throw err;
    }

    const cookieVal = payload.Cookie || payload.Cookie_2;
    if (options.cookiesDir && cookieVal && String(cookieVal).trim().length > 5) {
      saveCookieToDisk(options.cookiesDir, uid, String(cookieVal).trim(), {
        name: payload.Name || "",
        status: payload.Status || "Live",
        platform: payload.Platform || "TikTok",
      });
    }

    return { uid, updated: true, backupPath, message: `Đã cập nhật profile "${uid}".` };
  } finally {
    database.close();
  }
}

function deleteAccounts(databasePath, uidsRaw, options = {}) {
  const { DatabaseSync } = require("node:sqlite");
  const resolved = ensureDatabase(databasePath);
  const uids = [...new Set((Array.isArray(uidsRaw) ? uidsRaw : []).map((v) => String(v || "").trim()).filter(Boolean))];
  if (!uids.length) throw new Error("Chưa chọn profile nào để xóa.");

  const database = new DatabaseSync(resolved);
  try {
    database.exec("PRAGMA busy_timeout = 5000");
    const backupPath = createBackupOnce(database, resolved, options.storageRoot);
    const columns = database.prepare('PRAGMA table_info("accounts")').all();
    const uidColumn = findColumn(columns, "UID");
    if (!uidColumn) throw new Error("Database thiếu cột UID.");

    let deleted = 0;
    database.exec("BEGIN IMMEDIATE");
    try {
      const stmt = database.prepare(`DELETE FROM "accounts" WHERE ${quoteIdentifier(uidColumn)} = ?`);
      for (const uid of uids) {
        const res = stmt.run(uid);
        deleted += Number(res.changes || 0);
      }
      database.exec("COMMIT");
    } catch (err) {
      database.exec("ROLLBACK");
      throw err;
    }

    return { deleted, backupPath, message: `Đã xóa ${deleted} profile khỏi database.` };
  } finally {
    database.close();
  }
}

module.exports = {
  DEFAULT_DATABASE_PATH,
  DEFAULT_STORAGE_ROOT,
  createAccount,
  createAccountGroup,
  deleteAccountGroup,
  deleteAccounts,
  ensureDatabase,
  ensureStorageDirs,
  moveAccountsToGroup,
  readCookieFromDisk,
  readProfileDatabase,
  renameAccountGroup,
  safeFileId,
  saveAccountSession,
  saveCookieToDisk,
  updateAccount,
};
