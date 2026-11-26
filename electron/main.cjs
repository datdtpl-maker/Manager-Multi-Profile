const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_DATABASE_PATH,
  DEFAULT_STORAGE_ROOT,
  createAccount,
  createAccountGroup,
  deleteAccountGroup,
  deleteAccounts,
  ensureDatabase,
  ensureStorageDirs,
  moveAccountsToGroup,
  readProfileDatabase,
  renameAccountGroup,
  saveAccountSession,
  updateAccount,
} = require("./database.cjs");
const { ExtensionService } = require("./extension-service.cjs");
const { BrowserService, DEFAULT_TIKTOK_URL, generateTotpDetails } = require("./browser-service.cjs");

app.setName("Manager Multi Profile");
app.setAppUserModelId("vn.anti.managermultiprofile");

function preferencesPath() {
  return path.join(app.getPath("userData"), "preferences.json");
}

function loadPreferences() {
  try {
    const data = JSON.parse(fs.readFileSync(preferencesPath(), "utf8"));
    const storageRoot = data?.storageRoot || DEFAULT_STORAGE_ROOT;
    return {
      storageRoot,
      databasePath: data?.databasePath || path.join(storageRoot, "database.db"),
      defaultStartUrl: data?.defaultStartUrl || DEFAULT_TIKTOK_URL,
    };
  } catch {
    return {
      storageRoot: DEFAULT_STORAGE_ROOT,
      databasePath: DEFAULT_DATABASE_PATH,
      defaultStartUrl: DEFAULT_TIKTOK_URL,
    };
  }
}

function savePreferences(nextPrefs) {
  const merged = {
    ...loadPreferences(),
    ...nextPrefs,
  };
  fs.mkdirSync(path.dirname(preferencesPath()), { recursive: true });
  fs.writeFileSync(preferencesPath(), JSON.stringify(merged, null, 2), "utf8");
  return merged;
}

function getStorageRoot() {
  const prefs = loadPreferences();
  ensureStorageDirs(prefs.storageRoot);
  return prefs.storageRoot;
}

function getCookiesDir() {
  return path.join(getStorageRoot(), "cookies");
}

function wasmPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "sql-wasm.wasm")
    : require.resolve("sql.js/dist/sql-wasm.wasm");
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[|"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const extensionService = new ExtensionService(getStorageRoot);
const browserService = new BrowserService(app, {
  getStorageRoot,
  extensionService,
  onOpenChange: (openUids) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send("browser:open-changed", openUids);
      }
    }
  },
});

function createWindow() {
  const window = new BrowserWindow({
    width: 1500,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: "#F8FAFC",
    icon: path.join(__dirname, "..", "assets", "icon.png"),
    show: false,
    title: "Manager Multi Profile",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());

  if (app.isPackaged) {
    window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  } else {
    window.loadURL("http://127.0.0.1:5173");
  }
}

app.whenReady().then(() => {
  const prefs = loadPreferences();
  ensureStorageDirs(prefs.storageRoot);
  ensureDatabase(prefs.databasePath);

  // Settings & Storage
  ipcMain.handle("settings:get", () => {
    const current = loadPreferences();
    const dirs = ensureStorageDirs(current.storageRoot);
    return {
      ...current,
      profilesDir: dirs.profiles,
      cookiesDir: dirs.cookies,
      extensionsDir: dirs.extensions,
      backupsDir: dirs.backups,
    };
  });

  ipcMain.handle("settings:save", (_event, payload) => {
    const next = savePreferences({
      storageRoot: payload?.storageRoot || loadPreferences().storageRoot,
      databasePath: payload?.databasePath || loadPreferences().databasePath,
      defaultStartUrl: payload?.defaultStartUrl || DEFAULT_TIKTOK_URL,
    });
    const dirs = ensureStorageDirs(next.storageRoot);
    ensureDatabase(next.databasePath);
    return {
      ...next,
      profilesDir: dirs.profiles,
      cookiesDir: dirs.cookies,
      extensionsDir: dirs.extensions,
      backupsDir: dirs.backups,
    };
  });

  ipcMain.handle("storage:choose-root", async () => {
    const picked = await dialog.showOpenDialog({
      title: "Chọn thư mục lưu trữ Database, Profile, Cookies & Extensions",
      properties: ["openDirectory", "createDirectory"],
      defaultPath: getStorageRoot(),
    });
    if (picked.canceled || !picked.filePaths[0]) return null;
    const newRoot = picked.filePaths[0];
    const dirs = ensureStorageDirs(newRoot);
    const newDbPath = path.join(newRoot, "database.db");
    ensureDatabase(newDbPath);
    const saved = savePreferences({ storageRoot: newRoot, databasePath: newDbPath });
    return {
      ...saved,
      profilesDir: dirs.profiles,
      cookiesDir: dirs.cookies,
      extensionsDir: dirs.extensions,
      backupsDir: dirs.backups,
    };
  });

  ipcMain.handle("storage:open-folder", async (_event, subFolder) => {
    const dirs = ensureStorageDirs(getStorageRoot());
    const target = subFolder && dirs[subFolder] ? dirs[subFolder] : dirs.root;
    await shell.openPath(target);
    return target;
  });

  // Database
  ipcMain.handle("database:load", async () => {
    const prefs = loadPreferences();
    ensureStorageDirs(prefs.storageRoot);
    return readProfileDatabase(prefs.databasePath, wasmPath());
  });

  ipcMain.handle("database:choose", async () => {
    const picked = await dialog.showOpenDialog({
      title: "Chọn file database SQLite (.db)",
      defaultPath: getStorageRoot(),
      properties: ["openFile"],
      filters: [{ name: "SQLite Database", extensions: ["db", "sqlite", "sqlite3"] }],
    });
    if (picked.canceled || !picked.filePaths[0]) return null;
    const databasePath = picked.filePaths[0];
    savePreferences({ databasePath });
    return readProfileDatabase(databasePath, wasmPath());
  });

  ipcMain.handle("database:create", async () => {
    const picked = await dialog.showSaveDialog({
      title: "Tạo file database profile mới",
      defaultPath: path.join(getStorageRoot(), "profiles-new.db"),
      filters: [{ name: "SQLite Database", extensions: ["db"] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    const databasePath = ensureDatabase(picked.filePath);
    savePreferences({ databasePath });
    return readProfileDatabase(databasePath, wasmPath());
  });

  // Accounts & Groups
  ipcMain.handle("accounts:create-group", (_event, name) => {
    const prefs = loadPreferences();
    return createAccountGroup(prefs.databasePath, name, { storageRoot: prefs.storageRoot });
  });

  ipcMain.handle("accounts:rename-group", (_event, payload) => {
    const prefs = loadPreferences();
    return renameAccountGroup(prefs.databasePath, payload?.oldName, payload?.newName, {
      storageRoot: prefs.storageRoot,
    });
  });

  ipcMain.handle("accounts:delete-group", (_event, payload) => {
    const prefs = loadPreferences();
    return deleteAccountGroup(prefs.databasePath, payload?.groupName, payload?.moveToGroup, {
      storageRoot: prefs.storageRoot,
    });
  });

  ipcMain.handle("accounts:move-to-group", (_event, payload) => {
    const prefs = loadPreferences();
    return moveAccountsToGroup(prefs.databasePath, payload?.uids, payload?.groupName, {
      storageRoot: prefs.storageRoot,
    });
  });

  ipcMain.handle("accounts:create-account", (_event, payload) => {
    const prefs = loadPreferences();
    return createAccount(prefs.databasePath, payload, {
      storageRoot: prefs.storageRoot,
      cookiesDir: getCookiesDir(),
      defaultStartUrl: prefs.defaultStartUrl,
    });
  });

  ipcMain.handle("accounts:bulk-create", (_event, payload) => {
    const prefs = loadPreferences();
    const items = Array.isArray(payload?.accounts) ? payload.accounts : [];
    if (!items.length) throw new Error("Danh sách profile nhập hàng loạt đang trống.");
    let createdCount = 0;
    let skippedCount = 0;
    const errors = [];
    for (const item of items) {
      try {
        createAccount(prefs.databasePath, item, {
          storageRoot: prefs.storageRoot,
          cookiesDir: getCookiesDir(),
          defaultStartUrl: prefs.defaultStartUrl,
        });
        createdCount += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("đã tồn tại")) skippedCount += 1;
        else errors.push(`${item?.UID || "?"}: ${msg}`);
      }
    }
    return {
      createdCount,
      skippedCount,
      errors,
      message: `Đã nhập ${createdCount} profile mới${skippedCount ? `, bỏ qua ${skippedCount} trùng UID` : ""}${errors.length ? `, ${errors.length} lỗi` : ""}.`,
    };
  });

  ipcMain.handle("accounts:update-account", (_event, payload) => {
    const prefs = loadPreferences();
    return updateAccount(prefs.databasePath, payload, {
      storageRoot: prefs.storageRoot,
      cookiesDir: getCookiesDir(),
    });
  });

  ipcMain.handle("accounts:delete-accounts", (_event, uids) => {
    const prefs = loadPreferences();
    return deleteAccounts(prefs.databasePath, uids, { storageRoot: prefs.storageRoot });
  });

  ipcMain.handle("accounts:export", async (_event, payload) => {
    const columns = Array.isArray(payload?.columns) ? payload.columns : [];
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    const defaultName = payload?.defaultName || "profiles-export.csv";
    const picked = await dialog.showSaveDialog({
      title: "Xuất danh sách profile",
      defaultPath: path.join(getStorageRoot(), defaultName),
      filters: [
        { name: "CSV (UTF-8)", extensions: ["csv"] },
        { name: "Text (| separated)", extensions: ["txt"] },
      ],
    });
    if (picked.canceled || !picked.filePath) return { canceled: true };
    const separator = picked.filePath.toLowerCase().endsWith(".txt") ? "|" : ",";
    const header = columns.map(csvCell).join(separator);
    const body = rows.map((row) => columns.map((col) => csvCell(row[col])).join(separator));
    fs.writeFileSync(picked.filePath, `\uFEFF${[header, ...body].join("\r\n")}`, "utf8");
    return { canceled: false, filePath: picked.filePath, count: rows.length };
  });

  // Browser & Cookies
  ipcMain.handle("browser:status", () => browserService.status());
  ipcMain.handle("browser:setup", () => browserService.setup());
  ipcMain.handle("browser:update", () => browserService.update());
  ipcMain.handle("browser:totp", (_event, secret) => generateTotpDetails(secret));
  ipcMain.handle("browser:open-uids", () => browserService.getOpenUids());

  ipcMain.handle("browser:launch", async (_event, payload) => {
    const prefs = loadPreferences();
    return browserService.launch(
      payload?.account,
      payload?.mode || "open",
      prefs.defaultStartUrl,
      payload?.overrideUrl || "",
      payload?.windowBounds || null,
    );
  });

  ipcMain.handle("browser:save-cookies-bulk", async (_event, uidsRaw) => {
    const prefs = loadPreferences();
    const openSet = new Set(browserService.getOpenUids());
    const targets = Array.isArray(uidsRaw) && uidsRaw.length
      ? uidsRaw.filter((u) => openSet.has(u))
      : [...openSet];
    if (!targets.length) throw new Error("Không có profile nào đang mở để lưu cookie.");
    let savedCount = 0;
    const failed = [];
    for (const uid of targets) {
      try {
        const saved = await browserService.saveCookies(uid);
        saveAccountSession(
          prefs.databasePath,
          {
            uid: saved.uid,
            status: saved.statusLabel,
            cookieHeader: saved.cookieJson,
            updateCookie: true,
            platform: saved.platform,
          },
          { storageRoot: prefs.storageRoot, cookiesDir: getCookiesDir() },
        );
        savedCount += 1;
      } catch (err) {
        failed.push(`${uid}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return {
      savedCount,
      total: targets.length,
      failed,
      message: `Đã lưu cookie thành công cho ${savedCount}/${targets.length} profile đang mở${failed.length ? ` (${failed.length} lỗi)` : ""}.`,
    };
  });

  ipcMain.handle("browser:save-cookies", async (_event, uid) => {
    const prefs = loadPreferences();
    const saved = await browserService.saveCookies(uid);
    let databaseUpdated = false;
    try {
      saveAccountSession(
        prefs.databasePath,
        {
          uid: saved.uid,
          status: saved.statusLabel,
          cookieHeader: saved.cookieJson,
          updateCookie: true,
          platform: saved.platform,
        },
        { storageRoot: prefs.storageRoot, cookiesDir: getCookiesDir() },
      );
      databaseUpdated = true;
    } catch (err) {
      console.error("Không thể cập nhật cookie vào DB:", err);
    }
    return {
      ...saved,
      saved: true,
      databaseUpdated,
    };
  });

  ipcMain.handle("browser:close", (_event, uid) => browserService.close(uid));

  // Extensions (Bulk Install & Status)
  ipcMain.handle("extensions:list", () => extensionService.listExtensions());
  ipcMain.handle("extensions:profile-map", () => extensionService.getProfileExtensionsMap());

  ipcMain.handle("extensions:add-folder", async () => {
    const picked = await dialog.showOpenDialog({
      title: "Chọn thư mục Chrome Extension (chứa manifest.json)",
      properties: ["openDirectory"],
    });
    if (picked.canceled || !picked.filePaths[0]) return null;
    return extensionService.addExtensionFromFolder(picked.filePaths[0]);
  });

  ipcMain.handle("extensions:add-zip", async () => {
    const picked = await dialog.showOpenDialog({
      title: "Chọn file .ZIP chứa Chrome Extension",
      properties: ["openFile"],
      filters: [{ name: "Extension Archive (.zip)", extensions: ["zip"] }],
    });
    if (picked.canceled || !picked.filePaths[0]) return null;
    return extensionService.addExtensionFromZip(picked.filePaths[0]);
  });

  ipcMain.handle("extensions:remove", (_event, extensionId) => extensionService.removeExtension(extensionId));
  ipcMain.handle("extensions:update-all", () => extensionService.updateAllExtensionsFromSource());
  ipcMain.handle("extensions:update-source", (_event, extensionId) => extensionService.updateExtensionFromSource(extensionId));
  ipcMain.handle("extensions:update-folder", async (_event, extensionId) => {
    const picked = await dialog.showOpenDialog({
      title: "Chọn thư mục phiên bản Extension mới (chứa manifest.json)",
      properties: ["openDirectory"],
    });
    if (picked.canceled || !picked.filePaths[0]) return null;
    return extensionService.updateExtensionFromFolder(extensionId, picked.filePaths[0]);
  });
  ipcMain.handle("extensions:update-zip", async (_event, extensionId) => {
    const picked = await dialog.showOpenDialog({
      title: "Chọn file .ZIP phiên bản Extension mới",
      properties: ["openFile"],
      filters: [{ name: "Extension Archive (.zip)", extensions: ["zip"] }],
    });
    if (picked.canceled || !picked.filePaths[0]) return null;
    return extensionService.updateExtensionFromZip(extensionId, picked.filePaths[0]);
  });
  ipcMain.handle("extensions:update-url", (_event, payload) =>
    extensionService.updateExtensionFromUrl(payload?.extensionId, payload?.zipUrl),
  );
  ipcMain.handle("extensions:bulk-install", (_event, payload) => extensionService.bulkInstallExtensions(payload || {}));
  ipcMain.handle("extensions:bulk-uninstall", (_event, payload) => extensionService.bulkUninstallExtensions(payload || {}));

  ipcMain.on("clipboard:copy", (_event, text) => clipboard.writeText(String(text ?? "")));

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", async () => {
  await browserService.closeAll().catch(() => {});
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
