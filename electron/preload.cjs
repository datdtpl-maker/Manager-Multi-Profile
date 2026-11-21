const { clipboard, contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mmp", {
  // Settings & Storage
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (payload) => ipcRenderer.invoke("settings:save", payload),
  chooseStorageRoot: () => ipcRenderer.invoke("storage:choose-root"),
  openStorageFolder: (subFolder) => ipcRenderer.invoke("storage:open-folder", subFolder),

  // Database
  loadDatabase: () => ipcRenderer.invoke("database:load"),
  chooseDatabase: () => ipcRenderer.invoke("database:choose"),
  createDatabase: () => ipcRenderer.invoke("database:create"),

  // Accounts & Groups
  createAccountGroup: (name) => ipcRenderer.invoke("accounts:create-group", name),
  renameAccountGroup: (payload) => ipcRenderer.invoke("accounts:rename-group", payload),
  deleteAccountGroup: (payload) => ipcRenderer.invoke("accounts:delete-group", payload),
  moveAccountsToGroup: (payload) => ipcRenderer.invoke("accounts:move-to-group", payload),
  createAccount: (payload) => ipcRenderer.invoke("accounts:create-account", payload),
  updateAccount: (payload) => ipcRenderer.invoke("accounts:update-account", payload),
  deleteAccounts: (uids) => ipcRenderer.invoke("accounts:delete-accounts", uids),
  exportAccounts: (payload) => ipcRenderer.invoke("accounts:export", payload),

  // Browser & Cookies
  browserStatus: () => ipcRenderer.invoke("browser:status"),
  setupBrowser: () => ipcRenderer.invoke("browser:setup"),
  updateBrowser: () => ipcRenderer.invoke("browser:update"),
  generateTotp: (secret) => ipcRenderer.invoke("browser:totp", secret),
  getOpenProfiles: () => ipcRenderer.invoke("browser:open-uids"),
  launchBrowser: (payload) => ipcRenderer.invoke("browser:launch", payload),
  saveBrowserCookies: (uid) => ipcRenderer.invoke("browser:save-cookies", uid),
  closeBrowser: (uid) => ipcRenderer.invoke("browser:close", uid),

  // Extensions
  listExtensions: () => ipcRenderer.invoke("extensions:list"),
  getProfileExtensions: () => ipcRenderer.invoke("extensions:profile-map"),
  addExtensionFolder: () => ipcRenderer.invoke("extensions:add-folder"),
  addExtensionZip: () => ipcRenderer.invoke("extensions:add-zip"),
  removeExtension: (extensionId) => ipcRenderer.invoke("extensions:remove", extensionId),
  updateAllExtensions: () => ipcRenderer.invoke("extensions:update-all"),
  updateExtensionFromSource: (extensionId) => ipcRenderer.invoke("extensions:update-source", extensionId),
  updateExtensionFromFolder: (extensionId) => ipcRenderer.invoke("extensions:update-folder", extensionId),
  updateExtensionFromZip: (extensionId) => ipcRenderer.invoke("extensions:update-zip", extensionId),
  bulkInstallExtensions: (payload) => ipcRenderer.invoke("extensions:bulk-install", payload),
  bulkUninstallExtensions: (payload) => ipcRenderer.invoke("extensions:bulk-uninstall", payload),

  // Clipboard
  copyText: (value) => clipboard.writeText(String(value ?? "")),
});
