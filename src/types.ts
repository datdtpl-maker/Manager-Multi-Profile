export type AccountRow = Record<string, string>;

export interface AccountColumn {
  name: string;
  type: string;
}

export interface AccountGroup {
  name: string;
  count: number;
}

export interface ProfileDatabaseData {
  databasePath: string;
  databaseModifiedAt: string;
  databaseSize: number;
  columns: AccountColumn[];
  accounts: AccountRow[];
  groups: AccountGroup[];
}

export interface AppSettings {
  storageRoot: string;
  databasePath: string;
  defaultStartUrl: string;
  profilesDir: string;
  cookiesDir: string;
  extensionsDir: string;
  backupsDir: string;
}

export interface ExportPayload {
  columns: string[];
  rows: AccountRow[];
  defaultName: string;
}

export interface BrowserStatus {
  available: boolean;
  installed: boolean;
  version: string;
  tier: string;
  wrapperVersion: string;
}

export interface BrowserUpdateResult extends BrowserStatus {
  previousVersion: string;
  updated: boolean;
  message: string;
}

export interface BrowserLaunchResult {
  uid: string;
  mode: "open" | "cookie";
  state: "logged-in" | "attention" | "already-open";
  loadedExtensions?: number;
  message: string;
}

export interface BrowserCookieResult {
  uid: string;
  state: "live" | "attention";
  statusLabel: string;
  platform: string;
  cookieCount: number;
  cookieJson?: string;
  saved: boolean;
  databaseUpdated: boolean;
  fileSaved?: boolean;
  message: string;
}

export interface ExtensionItem {
  id: string;
  name: string;
  version: string;
  description: string;
  manifestVersion: number;
  dirPath: string;
  sourcePath: string;
  addedAt: string;
  exists: boolean;
  installedProfileCount: number;
}

export interface ProfileExtensionRecord {
  extensionId: string;
  installedAt: string;
  status: "installed" | "missing";
}

export type ProfileExtensionsMap = Record<string, ProfileExtensionRecord[]>;

export interface BulkExtensionResultItem {
  uid: string;
  status: "installed" | "partial" | "skipped";
  installedNames: string[];
  skippedNames: string[];
  message: string;
}

export interface ExtensionUpdateResult {
  id: string;
  name: string;
  previousVersion: string;
  version: string;
  versionChanged: boolean;
  affectedProfiles: number;
  message: string;
}

export interface BulkUpdateExtensionsResult {
  updatedCount: number;
  errorCount: number;
  totalAffected: number;
  results: ExtensionUpdateResult[];
  errors: Array<{ id: string; name: string; message: string }>;
  message: string;
}

export interface BulkInstallExtensionsResult {
  installedCount: number;
  skippedCount: number;
  totalProfiles: number;
  results: BulkExtensionResultItem[];
  message: string;
}

declare global {
  interface Window {
    mmp: {
      getSettings: () => Promise<AppSettings>;
      saveSettings: (payload: Partial<Pick<AppSettings, "storageRoot" | "databasePath" | "defaultStartUrl">>) => Promise<AppSettings>;
      chooseStorageRoot: () => Promise<AppSettings | null>;
      openStorageFolder: (subFolder?: "root" | "profiles" | "cookies" | "extensions" | "backups") => Promise<string>;

      loadDatabase: () => Promise<ProfileDatabaseData>;
      chooseDatabase: () => Promise<ProfileDatabaseData | null>;
      createDatabase: () => Promise<ProfileDatabaseData | null>;

      createAccountGroup: (name: string) => Promise<{ groupName: string; created: boolean; backupPath: string; message: string }>;
      renameAccountGroup: (payload: { oldName: string; newName: string }) => Promise<{ oldName: string; groupName: string; updated: boolean; affectedAccounts: number; backupPath: string; message: string }>;
      deleteAccountGroup: (payload: { groupName: string; moveToGroup?: string }) => Promise<{ groupName: string; deleted: boolean; movedAccounts: number; moveToGroup: string; backupPath: string; message: string }>;
      moveAccountsToGroup: (payload: { uids: string[]; groupName: string }) => Promise<{ groupName: string; moved: number; backupPath: string; message: string }>;
      createAccount: (payload: Partial<AccountRow> & { UID: string }) => Promise<{ uid: string; created: boolean; backupPath?: string; message: string }>;
      updateAccount: (payload: Partial<AccountRow> & { UID: string }) => Promise<{ uid: string; updated: boolean; backupPath?: string; message: string }>;
      deleteAccounts: (uids: string[]) => Promise<{ deleted: number; backupPath?: string; message: string }>;
      exportAccounts: (payload: ExportPayload) => Promise<{ canceled: boolean; filePath?: string; count?: number }>;

      browserStatus: () => Promise<BrowserStatus>;
      setupBrowser: () => Promise<BrowserStatus>;
      updateBrowser: () => Promise<BrowserUpdateResult>;
      generateTotp: (secret: string) => Promise<{ code: string; expiresIn: number }>;
      getOpenProfiles: () => Promise<string[]>;
      launchBrowser: (payload: { account: AccountRow; mode: "open" | "cookie"; overrideUrl?: string }) => Promise<BrowserLaunchResult>;
      saveBrowserCookies: (uid: string) => Promise<BrowserCookieResult>;
      closeBrowser: (uid: string) => Promise<{ closed: boolean }>;

      listExtensions: () => Promise<ExtensionItem[]>;
      getProfileExtensions: () => Promise<ProfileExtensionsMap>;
      addExtensionFolder: () => Promise<{ extension: ExtensionItem; message: string } | null>;
      addExtensionZip: () => Promise<{ extension: ExtensionItem; message: string } | null>;
      removeExtension: (extensionId: string) => Promise<{ removed: boolean; id: string; message: string }>;
      updateAllExtensions: () => Promise<BulkUpdateExtensionsResult>;
      updateExtensionFromSource: (extensionId: string) => Promise<ExtensionUpdateResult>;
      updateExtensionFromFolder: (extensionId: string) => Promise<ExtensionUpdateResult | null>;
      updateExtensionFromZip: (extensionId: string) => Promise<ExtensionUpdateResult | null>;
      bulkInstallExtensions: (payload: { extensionIds: string[]; profileUids: string[]; skipInstalled?: boolean }) => Promise<BulkInstallExtensionsResult>;
      bulkUninstallExtensions: (payload: { extensionIds: string[]; profileUids: string[] }) => Promise<{ removedCount: number; totalProfiles: number; message: string }>;

      copyText: (value: string) => void;
    };
  }
}
