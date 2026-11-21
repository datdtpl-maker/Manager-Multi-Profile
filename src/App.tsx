import {
  Check,
  Columns3,
  Copy,
  Cookie as CookieIcon,
  Database,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Globe2,
  KeyRound,
  Layers3,
  LoaderCircle,
  Moon,
  Play,
  Puzzle,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Square,
  Sun,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { SettingsExtensionsWorkspace } from "./SettingsExtensionsWorkspace";
import type {
  AccountRow,
  AppSettings,
  BrowserStatus,
  ExtensionItem,
  ProfileDatabaseData,
  ProfileExtensionsMap,
} from "./types";

const DEFAULT_COLUMNS = ["UID", "Name", "Platform", "Email", "Folder", "Status", "LastActive"];
const SENSITIVE_FIELDS = new Set(["password", "twofa", "passmail", "cookie", "token", "cookie_2"]);

const LABELS: Record<string, string> = {
  ID: "ID",
  UID: "UID / Mã Profile",
  Name: "Tên tài khoản",
  Platform: "Nền tảng",
  StartUrl: "URL khởi chạy",
  Email: "Email",
  Password: "Mật khẩu",
  TwoFA: "Mã 2FA",
  Phone: "Số điện thoại",
  Proxy: "Proxy",
  Cookie: "Cookie",
  Cookie_2: "Cookie phụ",
  Token: "Token",
  UserAgent: "User Agent",
  Folder: "Nhóm",
  Status: "Trạng thái",
  Note: "Ghi chú",
  LastActive: "Hoạt động gần nhất",
  CreateTime: "Thời gian tạo",
  DateImport: "Ngày nhập",
};

const GROUP_DOT_COLORS = ["#0d9488", "#f97316", "#10b981", "#8b5cf6", "#ec4899", "#eab308", "#06b6d4"];

const BULK_URL_PRESETS = [
  { label: "TikTok", url: "https://www.tiktok.com/" },
  { label: "TikTok Business Suite", url: "https://www.tiktok.com/business-suite" },
  { label: "TikTok Studio", url: "https://www.tiktok.com/tiktokstudio" },
  { label: "TikTok Seller VN", url: "https://seller-vn.tiktok.com/" },
  { label: "Facebook", url: "https://www.facebook.com/" },
];

function dotColorFor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return GROUP_DOT_COLORS[hash % GROUP_DOT_COLORS.length];
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatTimestamp(raw: string) {
  if (!raw) return "—";
  const num = Number(raw);
  if (Number.isFinite(num) && num > 1_500_000_000 && num < 9_999_999_999) {
    return new Date(num * 1000).toLocaleString("vi-VN");
  }
  return raw;
}

function maskValue(key: string, value: string) {
  if (!value) return "—";
  if (!SENSITIVE_FIELDS.has(key.toLowerCase())) return value;
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}••••••${value.slice(-4)}`;
}

function statusTone(status: string) {
  const s = (status || "").toLowerCase();
  if (s.includes("live") || s.includes("online") || s.includes("active")) return "live";
  if (s.includes("die") || s.includes("lock") || s.includes("ban") || s.includes("checkpoint")) return "die";
  return "neutral";
}

function MmpBrandMark() {
  return (
    <svg width="36" height="36" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="mmpBg" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0D9488" />
          <stop offset="100%" stopColor="#065F46" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#mmpBg)" />
      <rect x="11" y="13" width="29" height="22" rx="6" fill="#CCFBF1" fillOpacity="0.38" />
      <rect x="17" y="19" width="30" height="23" rx="6" fill="#F0FDFA" fillOpacity="0.72" />
      <rect x="22" y="25" width="31" height="25" rx="6" fill="#FFFFFF" />
      <circle cx="28" cy="31" r="2.2" fill="#F97316" />
      <circle cx="34" cy="31" r="2.2" fill="#14B8A6" />
      <circle cx="40" cy="31" r="2.2" fill="#10B981" />
      <rect x="27" y="37" width="12" height="3.2" rx="1.6" fill="#0F172A" />
      <rect x="27" y="42.5" width="20" height="3" rx="1.5" fill="#94A3B8" />
      <rect x="42" y="36.5" width="6" height="4" rx="2" fill="#F97316" />
    </svg>
  );
}

export function App() {
  const [darkMode, setDarkMode] = useState(false);
  const [activeView, setActiveView] = useState<"accounts" | "settings">("accounts");
  const [selectedGroup, setSelectedGroup] = useState<string>("__ALL__");

  const [data, setData] = useState<ProfileDatabaseData | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [browserStatus, setBrowserStatus] = useState<BrowserStatus | null>(null);
  const [extensions, setExtensions] = useState<ExtensionItem[]>([]);
  const [profileExtensions, setProfileExtensions] = useState<ProfileExtensionsMap>({});
  const [openProfiles, setOpenProfiles] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyUid, setBusyUid] = useState<string>("");
  const [browserBusy, setBrowserBusy] = useState(false);
  const [updatingExtensions, setUpdatingExtensions] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; account: AccountRow } | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const deferredSearch = useDeferredValue(searchInput);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(DEFAULT_COLUMNS);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [selectedUids, setSelectedUids] = useState<string[]>([]);

  const [activeAccount, setActiveAccount] = useState<AccountRow | null>(null);
  const [editDraft, setEditDraft] = useState<AccountRow | null>(null);
  const [revealSensitive, setRevealSensitive] = useState(false);
  const [totpInfo, setTotpInfo] = useState<{ code: string; expiresIn: number } | null>(null);

  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [renameTargetGroup, setRenameTargetGroup] = useState<string | null>(null);
  const [renameGroupValue, setRenameGroupValue] = useState("");
  const [showMoveGroup, setShowMoveGroup] = useState(false);
  const [moveTargetGroup, setMoveTargetGroup] = useState("");
  const [showBulkLaunch, setShowBulkLaunch] = useState(false);
  const [bulkUrlMode, setBulkUrlMode] = useState<"profile" | "custom">("custom");
  const [bulkCustomUrl, setBulkCustomUrl] = useState("https://www.tiktok.com/");
  const [bulkLaunchMode, setBulkLaunchMode] = useState<"open" | "cookie">("open");
  const [bulkDelaySeconds, setBulkDelaySeconds] = useState(1.5);
  const [bulkSaveAsDefaultUrl, setBulkSaveAsDefaultUrl] = useState(false);
  const [bulkLaunching, setBulkLaunching] = useState<{ current: number; total: number } | null>(null);
  const [showAddProfile, setShowAddProfile] = useState(false);
  const [newProfileDraft, setNewProfileDraft] = useState<AccountRow>({
    UID: "",
    Name: "",
    Platform: "TikTok",
    StartUrl: "https://www.tiktok.com/",
    Email: "",
    Password: "",
    TwoFA: "",
    Phone: "",
    Proxy: "",
    Cookie: "",
    Folder: "Không có nhóm",
    Note: "",
  });

  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const notify = (type: "success" | "error" | "info", message: string) => {
    setToast({ type, message });
  };

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? "dark" : "light";
  }, [darkMode]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [contextMenu]);

  const refreshAll = async () => {
    try {
      setError("");
      const [dbData, appSettings, bStatus, extList, profExtMap, openUids] = await Promise.all([
        window.mmp.loadDatabase(),
        window.mmp.getSettings(),
        window.mmp.browserStatus().catch(() => null),
        window.mmp.listExtensions().catch(() => []),
        window.mmp.getProfileExtensions().catch(() => ({})),
        window.mmp.getOpenProfiles().catch(() => []),
      ]);
      setData(dbData);
      setSettings(appSettings);
      if (bStatus) setBrowserStatus(bStatus);
      setExtensions(extList);
      setProfileExtensions(profExtMap);
      setOpenProfiles(openUids);
      setNewProfileDraft((prev) => ({
        ...prev,
        StartUrl: prev.StartUrl || appSettings.defaultStartUrl || "https://www.tiktok.com/",
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshAll();
  }, []);

  const extById = useMemo(() => new Map(extensions.map((ext) => [ext.id, ext])), [extensions]);

  const filteredAccounts = useMemo(() => {
    if (!data) return [];
    const tokens = deferredSearch
      .split(/[\r\n,]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    return data.accounts.filter((acc) => {
      const folder = (acc.Folder || "").trim() || "Không có nhóm";
      if (selectedGroup !== "__ALL__" && folder !== selectedGroup) return false;
      if (!tokens.length) return true;
      const hay = `${acc.UID || ""} ${acc.Name || ""} ${acc.Email || ""} ${acc.Phone || ""} ${acc.Platform || ""} ${acc.Note || ""}`.toLowerCase();
      return tokens.some((token) => hay.includes(token));
    });
  }, [data, selectedGroup, deferredSearch]);

  const stats = useMemo(() => {
    const accounts = data?.accounts || [];
    const withCookie = accounts.filter((a) => Boolean((a.Cookie || a.Cookie_2 || "").trim())).length;
    const withExt = accounts.filter((a) => (profileExtensions[a.UID] || []).some((r) => r.status === "installed")).length;
    return {
      total: accounts.length,
      groups: data?.groups.length || 0,
      withCookie,
      withExt,
    };
  }, [data, profileExtensions]);

  const handleChooseDatabase = async () => {
    try {
      const next = await window.mmp.chooseDatabase();
      if (next) {
        setData(next);
        setSelectedGroup("__ALL__");
        setSelectedUids([]);
        const updatedSettings = await window.mmp.getSettings();
        setSettings(updatedSettings);
        notify("success", `Đã chuyển sang database: ${next.databasePath}`);
      }
    } catch (err) {
      notify("error", err instanceof Error ? err.message : String(err));
    }
  };

  const handleCreateDatabase = async () => {
    try {
      const next = await window.mmp.createDatabase();
      if (next) {
        setData(next);
        setSelectedGroup("__ALL__");
        setSelectedUids([]);
        const updatedSettings = await window.mmp.getSettings();
        setSettings(updatedSettings);
        notify("success", `Đã tạo database mới: ${next.databasePath}`);
      }
    } catch (err) {
      notify("error", err instanceof Error ? err.message : String(err));
    }
  };

  const handleBrowserSetupOrUpdate = async () => {
    setBrowserBusy(true);
    try {
      if (!browserStatus?.installed) {
        const res = await window.mmp.setupBrowser();
        setBrowserStatus(res);
        notify("success", "Đã cài đặt CloakBrowser sẵn sàng.");
      } else {
        const res = await window.mmp.updateBrowser();
        setBrowserStatus(res);
        notify("info", res.message);
      }
    } catch (err) {
      notify("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBrowserBusy(false);
    }
  };

  const handleUpdateAllExtensionsQuick = async () => {
    setUpdatingExtensions(true);
    try {
      const res = await window.mmp.updateAllExtensions();
      await refreshAll();
      notify(res.updatedCount > 0 ? "success" : "error", res.message);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : String(err));
    } finally {
      setUpdatingExtensions(false);
    }
  };

  const openEditDrawer = (acc: AccountRow) => {
    setActiveAccount(acc);
    setEditDraft({ ...acc });
    setRevealSensitive(false);
    setTotpInfo(null);
  };

  const handleLaunch = async (account: AccountRow, mode: "open" | "cookie") => {
    const uid = account.UID;
    setBusyUid(uid);
    try {
      const res = await window.mmp.launchBrowser({ account, mode });
      const openUids = await window.mmp.getOpenProfiles();
      setOpenProfiles(openUids);
      notify(res.state === "logged-in" || res.state === "already-open" ? "success" : "info", res.message);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusyUid("");
    }
  };

  const handleSaveCookies = async (uid: string) => {
    setBusyUid(uid);
    try {
      const res = await window.mmp.saveBrowserCookies(uid);
      await refreshAll();
      notify("success", res.message);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusyUid("");
    }
  };

  const handleCloseBrowser = async (uid: string) => {
    setBusyUid(uid);
    try {
      await window.mmp.closeBrowser(uid);
      const openUids = await window.mmp.getOpenProfiles();
      setOpenProfiles(openUids);
      notify("info", `Đã đóng trình duyệt profile "${uid}".`);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusyUid("");
    }
  };

  const handleBulkLaunchStart = async () => {
    const accountsByUid = new Map((data?.accounts || []).map((a) => [a.UID, a]));
    const targets = selectedUids.map((uid) => accountsByUid.get(uid)).filter(Boolean) as AccountRow[];
    if (!targets.length) {
      notify("error", "Chưa chọn profile nào để mở.");
      return;
    }

    const customUrl = bulkUrlMode === "custom" ? bulkCustomUrl.trim() : "";
    if (bulkUrlMode === "custom" && !customUrl) {
      notify("error", "Vui lòng nhập URL muốn mở hoặc chọn dùng URL riêng của từng profile.");
      return;
    }

    if (bulkUrlMode === "custom" && bulkSaveAsDefaultUrl && customUrl) {
      try {
        const saved = await window.mmp.saveSettings({ defaultStartUrl: customUrl });
        setSettings(saved);
      } catch {
        // Non-fatal
      }
    }

    const delayMs = Math.max(0, Math.min(30, Number(bulkDelaySeconds) || 0)) * 1000;
    setBulkLaunching({ current: 0, total: targets.length });
    let okCount = 0;
    const failedUids: string[] = [];

    for (let i = 0; i < targets.length; i += 1) {
      const acc = targets[i];
      setBulkLaunching({ current: i + 1, total: targets.length });
      try {
        await window.mmp.launchBrowser({
          account: acc,
          mode: bulkLaunchMode,
          overrideUrl: customUrl,
        });
        okCount += 1;
      } catch {
        failedUids.push(acc.UID);
      }
      if (i < targets.length - 1 && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    const openUids = await window.mmp.getOpenProfiles().catch(() => []);
    setOpenProfiles(openUids);
    setBulkLaunching(null);
    setShowBulkLaunch(false);
    notify(
      failedUids.length ? "info" : "success",
      failedUids.length
        ? `Đã mở ${okCount}/${targets.length} profile (lỗi: ${failedUids.slice(0, 3).join(", ")}${failedUids.length > 3 ? "..." : ""}).`
        : `Đã mở hàng loạt thành công ${okCount}/${targets.length} profile.`,
    );
  };

  const handleBulkCloseSelected = async () => {
    const toClose = selectedUids.filter((uid) => openProfiles.includes(uid));
    if (!toClose.length) return;
    await Promise.allSettled(toClose.map((uid) => window.mmp.closeBrowser(uid)));
    const openUids = await window.mmp.getOpenProfiles().catch(() => []);
    setOpenProfiles(openUids);
    notify("info", `Đã đóng ${toClose.length} trình duyệt đang mở.`);
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    try {
      const res = await window.mmp.createAccountGroup(newGroupName.trim());
      setShowCreateGroup(false);
      setNewGroupName("");
      await refreshAll();
      setSelectedGroup(res.groupName);
      notify("success", res.message);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : String(err));
    }
  };

  const handleRenameGroup = async () => {
    if (!renameTargetGroup || !renameGroupValue.trim()) return;
    try {
      const res = await window.mmp.renameAccountGroup({
        oldName: renameTargetGroup,
        newName: renameGroupValue.trim(),
      });
      setRenameTargetGroup(null);
      setRenameGroupValue("");
      if (selectedGroup === renameTargetGroup) setSelectedGroup(res.groupName);
      await refreshAll();
      notify("success", res.message);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteGroup = async (groupName: string) => {
    if (!window.confirm(`Xóa nhóm "${groupName}"? Các profile bên trong sẽ được chuyển về "Không có nhóm".`)) return;
    try {
      const res = await window.mmp.deleteAccountGroup({ groupName, moveToGroup: "Không có nhóm" });
      if (selectedGroup === groupName) setSelectedGroup("__ALL__");
      await refreshAll();
      notify("success", res.message);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : String(err));
    }
  };

  const handleMoveSelectedToGroup = async () => {
    if (!selectedUids.length || !moveTargetGroup) return;
    try {
      const res = await window.mmp.moveAccountsToGroup({ uids: selectedUids, groupName: moveTargetGroup });
      setShowMoveGroup(false);
      setSelectedUids([]);
      await refreshAll();
      notify("success", res.message);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteSelectedAccounts = async () => {
    if (!selectedUids.length) return;
    if (!window.confirm(`Xóa ${selectedUids.length} profile đã chọn khỏi database?`)) return;
    try {
      const res = await window.mmp.deleteAccounts(selectedUids);
      setSelectedUids([]);
      await refreshAll();
      notify("success", res.message);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : String(err));
    }
  };

  const handleCreateProfile = async () => {
    const uid = (newProfileDraft.UID || "").trim();
    if (!uid) {
      notify("error", "Vui lòng nhập UID hoặc tên mã Profile (ví dụ: tiktok_01).");
      return;
    }
    try {
      const res = await window.mmp.createAccount({
        ...newProfileDraft,
        UID: uid,
        Name: (newProfileDraft.Name || "").trim() || uid,
      });
      setShowAddProfile(false);
      setNewProfileDraft({
        UID: "",
        Name: "",
        Platform: "TikTok",
        StartUrl: settings?.defaultStartUrl || "https://www.tiktok.com/",
        Email: "",
        Password: "",
        TwoFA: "",
        Phone: "",
        Proxy: "",
        Cookie: "",
        Folder: selectedGroup !== "__ALL__" ? selectedGroup : "Không có nhóm",
        Note: "",
      });
      await refreshAll();
      notify("success", res.message);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : String(err));
    }
  };

  const handleSaveEditDrawer = async () => {
    if (!editDraft || !editDraft.UID) return;
    try {
      const res = await window.mmp.updateAccount({ ...editDraft, UID: editDraft.UID });
      await refreshAll();
      setActiveAccount({ ...editDraft });
      notify("success", res.message);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : String(err));
    }
  };

  const handleExport = async () => {
    if (!filteredAccounts.length) return;
    try {
      const res = await window.mmp.exportAccounts({
        columns: visibleColumns,
        rows: filteredAccounts,
        defaultName: `manager-multi-profile-${filteredAccounts.length}.csv`,
      });
      if (!res.canceled) {
        notify("success", `Đã xuất ${res.count} profile ra ${res.filePath}`);
      }
    } catch (err) {
      notify("error", err instanceof Error ? err.message : String(err));
    }
  };

  const handleGenerateTotp = async (secret: string) => {
    try {
      const info = await window.mmp.generateTotp(secret);
      setTotpInfo(info);
      window.mmp.copyText(info.code);
      notify("success", `Mã 2FA: ${info.code} (còn ${info.expiresIn}s) — đã copy!`);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : String(err));
    }
  };

  const toggleSelectRow = (uid: string) => {
    setSelectedUids((prev) => (prev.includes(uid) ? prev.filter((item) => item !== uid) : [...prev, uid]));
  };

  const toggleSelectAll = () => {
    const visibleIds = filteredAccounts.map((a) => a.UID);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedUids.includes(id));
    if (allSelected) {
      setSelectedUids((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      setSelectedUids((prev) => [...new Set([...prev, ...visibleIds])]);
    }
  };

  const allColumnNames = useMemo(() => {
    const cols = data?.columns.map((c) => c.name) || DEFAULT_COLUMNS;
    return cols.filter((c) => c.toLowerCase() !== "id");
  }, [data]);

  if (loading) {
    return (
      <div className="center-state">
        <LoaderCircle size={28} className="spin" />
        <p>Đang khởi tạo Manager Multi Profile...</p>
      </div>
    );
  }

  return (
    <div className="mmp-app">
      {/* DISTINCTIVE TOP COMMAND BAR */}
      <header className="mmp-header">
        <div className="mmp-header-brand">
          <MmpBrandMark />
          <div>
            <h1>Manager Multi Profile</h1>
            <span>Multi-Browser & Extension Hub</span>
          </div>
        </div>

        <nav className="mmp-top-tabs">
          <button
            type="button"
            className={`mmp-top-tab ${activeView === "accounts" ? "active" : ""}`}
            onClick={() => setActiveView("accounts")}
          >
            <Users size={15} />
            <span>Quản lý Profile</span>
            <span className="mmp-tab-pill">{data?.accounts.length || 0}</span>
          </button>
          <button
            type="button"
            className={`mmp-top-tab ${activeView === "settings" ? "active" : ""}`}
            onClick={() => setActiveView("settings")}
          >
            <Settings size={15} />
            <span>Cài đặt & Extension</span>
            <span className="mmp-tab-pill">{extensions.length}</span>
          </button>
        </nav>

        <div className="mmp-header-right">
          <button
            type="button"
            className="mmp-db-chip"
            title={`Database đang kết nối: ${data?.databasePath || ""}\nClick để đổi file database`}
            onClick={handleChooseDatabase}
          >
            <Database size={14} />
            <code>{data?.databasePath?.split("\\").pop() || "database.db"}</code>
            {data && <span className="size-pill">{formatBytes(data.databaseSize)}</span>}
          </button>
          <button type="button" className="secondary-button compact-btn" onClick={handleCreateDatabase}>
            <FolderPlus size={14} /> Tạo DB
          </button>
          <button type="button" className="icon-button" title="Làm mới dữ liệu" onClick={() => refreshAll()}>
            <RefreshCw size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Đổi giao diện Sáng / Tối"
            onClick={() => setDarkMode((v) => !v)}
          >
            {darkMode ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </header>

      {toast && (
        <div className={`mmp-toast ${toast.type}`}>
          <span>{toast.message}</span>
          <button type="button" onClick={() => setToast(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      {error && (
        <div className="mmp-error-banner">
          <strong>Lỗi:</strong> {error}
        </div>
      )}

      {/* BODY */}
      <div className="mmp-body">
        {activeView === "settings" ? (
          <main className="mmp-settings-scroll">
            <SettingsExtensionsWorkspace
              accounts={data?.accounts || []}
              groups={data?.groups || []}
              settings={settings}
              extensions={extensions}
              profileExtensions={profileExtensions}
              onRefreshAll={refreshAll}
              onSettingsChanged={setSettings}
              onChooseDatabase={handleChooseDatabase}
              onCreateDatabase={handleCreateDatabase}
              onNotify={notify}
            />
          </main>
        ) : (
          <div className="mmp-accounts-layout">
            {/* LIGHT FLOATING GROUP RAIL */}
            <aside className="mmp-group-rail">
              <div className="mmp-rail-head">
                <span>NHÓM PROFILE</span>
                <button
                  type="button"
                  className="mmp-rail-add"
                  title="Tạo nhóm mới"
                  onClick={() => setShowCreateGroup(true)}
                >
                  <FolderPlus size={14} /> Mới
                </button>
              </div>

              <div className="mmp-rail-list">
                <button
                  type="button"
                  className={`mmp-rail-item ${selectedGroup === "__ALL__" ? "active" : ""}`}
                  onClick={() => setSelectedGroup("__ALL__")}
                >
                  <span className="mmp-rail-item-left">
                    <Layers3 size={15} />
                    <span>Tất cả profile</span>
                  </span>
                  <span className="mmp-rail-count">{data?.accounts.length || 0}</span>
                </button>

                {(data?.groups || []).map((group) => (
                  <div
                    key={group.name}
                    className={`mmp-rail-group-row ${selectedGroup === group.name ? "active" : ""}`}
                  >
                    <button
                      type="button"
                      className="mmp-rail-group-btn"
                      onClick={() => setSelectedGroup(group.name)}
                    >
                      <span className="mmp-rail-item-left">
                        <span className="mmp-group-dot" style={{ background: dotColorFor(group.name) }} />
                        <span className="nav-label">{group.name}</span>
                      </span>
                      <span className="mmp-rail-count">{group.count}</span>
                    </button>
                    {group.name !== "Không có nhóm" && (
                      <div className="mmp-rail-actions">
                        <button
                          type="button"
                          title="Đổi tên nhóm"
                          onClick={() => {
                            setRenameTargetGroup(group.name);
                            setRenameGroupValue(group.name);
                          }}
                        >
                          <Edit3 size={12} />
                        </button>
                        <button
                          type="button"
                          title="Xóa nhóm"
                          onClick={() => handleDeleteGroup(group.name)}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="mmp-rail-foot">
                <button
                  type="button"
                  className="primary-button full-btn"
                  onClick={() => {
                    setNewProfileDraft((prev) => ({
                      ...prev,
                      Folder: selectedGroup !== "__ALL__" ? selectedGroup : "Không có nhóm",
                      StartUrl: settings?.defaultStartUrl || "https://www.tiktok.com/",
                    }));
                    setShowAddProfile(true);
                  }}
                >
                  <UserPlus size={15} />
                  Thêm Profile mới
                </button>
                <div className="mmp-isolation-pill">
                  <ShieldCheck size={14} />
                  <span>Lưu riêng tại D:\ManagerMultiProfile_data</span>
                </div>
              </div>
            </aside>

            {/* MAIN ACCOUNTS WORKSPACE */}
            <main className="mmp-main-panel">
              {/* HERO STRIP (COMPACT EMERALD-TEAL) */}
              <section className="mmp-hero-strip">
                <div className="mmp-hero-top">
                  <div>
                    <div className="mmp-hero-title-row">
                      <h2>{selectedGroup === "__ALL__" ? "Tất cả Profile" : selectedGroup}</h2>
                      <span className={`status-dot-pill ${browserStatus?.installed ? "ready" : "pending"}`}>
                        CloakBrowser: {browserStatus?.installed ? "Sẵn sàng" : "Chưa cài"}
                      </span>
                      {openProfiles.length > 0 && (
                        <span className="status-dot-pill running">Đang mở: {openProfiles.length}</span>
                      )}
                    </div>
                    <p className="mmp-hero-sub">
                      URL mặc định: <strong>{settings?.defaultStartUrl || "https://www.tiktok.com/"}</strong>
                      {" • "}
                      DB: <code>{data?.databasePath}</code>
                    </p>
                  </div>

                  <div className="mmp-hero-actions">
                    <button
                      type="button"
                      className="secondary-button compact-btn"
                      disabled={browserBusy}
                      onClick={handleBrowserSetupOrUpdate}
                    >
                      <Globe2 size={14} className={browserBusy ? "spin" : ""} />
                      {browserStatus?.installed ? "Cập nhật Browser" : "Cài Browser"}
                    </button>
                    <button
                      type="button"
                      className="primary-button compact-btn"
                      disabled={updatingExtensions || extensions.length === 0}
                      title="Cập nhật bản mới nhất cho tất cả Extension đã thêm — mọi profile đang cài sẽ tự nhận bản mới"
                      onClick={handleUpdateAllExtensionsQuick}
                    >
                      <RefreshCw size={14} className={updatingExtensions ? "spin" : ""} />
                      {updatingExtensions ? "Đang cập nhật Ext..." : "Cập nhật Extension"}
                    </button>
                    <button
                      type="button"
                      className="accent-button compact-btn"
                      onClick={() => setActiveView("settings")}
                    >
                      <Puzzle size={14} />
                      Cài Extension hàng loạt
                    </button>
                    <button
                      type="button"
                      className="secondary-button compact-btn"
                      disabled={filteredAccounts.length === 0}
                      onClick={handleExport}
                    >
                      <Download size={14} />
                      Xuất ({filteredAccounts.length})
                    </button>
                  </div>
                </div>

                <div className="mmp-kpi-strip">
                  <div className="mmp-kpi-pill">
                    <Users size={14} />
                    <span>Tổng profile</span>
                    <strong>{stats.total}</strong>
                  </div>
                  <div className="mmp-kpi-pill">
                    <Layers3 size={14} />
                    <span>Nhóm</span>
                    <strong>{stats.groups}</strong>
                  </div>
                  <div className="mmp-kpi-pill">
                    <CookieIcon size={14} />
                    <span>Đã lưu Cookie</span>
                    <strong>{stats.withCookie}</strong>
                  </div>
                  <div className="mmp-kpi-pill">
                    <Puzzle size={14} />
                    <span>Đã cài Extension</span>
                    <strong>{stats.withExt}</strong>
                  </div>
                </div>
              </section>

              {/* SEARCH & BULK ACTION BAR */}
              <div className="toolbar-row">
                <div className="search-box">
                  <Search size={15} />
                  <textarea
                    rows={1}
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Tìm nhanh 1 hoặc nhiều profile (dán UID, tên, email — mỗi dòng hoặc ngăn dấu phẩy)"
                  />
                  <span className="query-count">{filteredAccounts.length} kết quả</span>
                </div>

                <div className="toolbar-right">
                  {selectedUids.length > 0 && (
                    <div className="bulk-account-actions">
                      <span className="bulk-count">Chọn {selectedUids.length}</span>
                      <button
                        type="button"
                        className="primary-button compact-btn"
                        disabled={Boolean(bulkLaunching)}
                        onClick={() => {
                          setBulkCustomUrl(settings?.defaultStartUrl || "https://www.tiktok.com/");
                          setShowBulkLaunch(true);
                        }}
                      >
                        <Play size={13} />
                        {bulkLaunching
                          ? `Đang mở ${bulkLaunching.current}/${bulkLaunching.total}...`
                          : `Mở hàng loạt (${selectedUids.length})`}
                      </button>
                      {selectedUids.some((uid) => openProfiles.includes(uid)) && (
                        <button
                          type="button"
                          className="secondary-button compact-btn danger-outline"
                          onClick={handleBulkCloseSelected}
                        >
                          <Square size={13} /> Đóng đang mở
                        </button>
                      )}
                      <button
                        type="button"
                        className="secondary-button compact-btn"
                        onClick={() => {
                          setMoveTargetGroup(data?.groups[0]?.name || "Không có nhóm");
                          setShowMoveGroup(true);
                        }}
                      >
                        <FolderInput size={14} /> Chuyển nhóm
                      </button>
                      <button
                        type="button"
                        className="secondary-button compact-btn danger-outline"
                        onClick={handleDeleteSelectedAccounts}
                      >
                        <Trash2 size={14} /> Xóa
                      </button>
                    </div>
                  )}

                  <div className="column-picker-wrap">
                    <button
                      type="button"
                      className="secondary-button compact-btn"
                      onClick={() => setShowColumnPicker((v) => !v)}
                    >
                      <Columns3 size={14} /> Cột
                    </button>
                    {showColumnPicker && (
                      <div className="column-picker-menu">
                        {allColumnNames.map((col) => (
                          <label key={col} className="column-option">
                            <input
                              type="checkbox"
                              checked={visibleColumns.includes(col)}
                              onChange={() =>
                                setVisibleColumns((prev) =>
                                  prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col],
                                )
                              }
                            />
                            <span>{LABELS[col] || col}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* ACCOUNTS TABLE */}
              <div className="table-card">
                <div className="table-scroll">
                  <table className="accounts-table">
                    <thead>
                      <tr>
                        <th className="check-column">
                          <input
                            type="checkbox"
                            checked={
                              filteredAccounts.length > 0 &&
                              filteredAccounts.every((a) => selectedUids.includes(a.UID))
                            }
                            onChange={toggleSelectAll}
                          />
                        </th>
                        {visibleColumns.map((col) => (
                          <th key={col}>{LABELS[col] || col}</th>
                        ))}
                        <th>Extension</th>
                        <th className="actions-col">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAccounts.length === 0 ? (
                        <tr>
                          <td colSpan={visibleColumns.length + 3} className="empty-table">
                            <div className="empty-table-inner">
                              <Users size={28} />
                              <p>Chưa có profile nào trong mục này.</p>
                              <button
                                type="button"
                                className="primary-button"
                                onClick={() => setShowAddProfile(true)}
                              >
                                <UserPlus size={15} /> Tạo profile đầu tiên
                              </button>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        filteredAccounts.map((acc) => {
                          const uid = acc.UID;
                          const isSelected = selectedUids.includes(uid);
                          const isOpen = openProfiles.includes(uid);
                          const isBusy = busyUid === uid;
                          const installedExts = (profileExtensions[uid] || []).filter((r) => r.status === "installed");
                          const extNames = installedExts
                            .map((r) => extById.get(r.extensionId)?.name)
                            .filter(Boolean)
                            .join(", ");
                          const initial = (acc.Name || uid || "P").trim().slice(0, 1).toUpperCase();

                          return (
                            <tr
                              key={uid}
                              className={isSelected ? "selected" : ""}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                const menuW = 220;
                                const menuH = 290;
                                const x = Math.min(e.clientX, window.innerWidth - menuW - 12);
                                const y = Math.min(e.clientY, window.innerHeight - menuH - 12);
                                setContextMenu({ x: Math.max(8, x), y: Math.max(8, y), account: acc });
                              }}
                            >
                              <td className="check-column">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleSelectRow(uid)}
                                />
                              </td>
                              {visibleColumns.map((col) => {
                                const val = acc[col] || "";
                                if (col === "UID") {
                                  return (
                                    <td key={col} className="cell-uid">
                                      <div className="mmp-uid-cell">
                                        <span className="mmp-avatar" style={{ background: dotColorFor(uid) }}>
                                          {initial}
                                        </span>
                                        <button
                                          type="button"
                                          className="uid-link"
                                          title="Click để copy UID"
                                          onClick={() => {
                                            window.mmp.copyText(val);
                                            notify("info", `Đã copy UID: ${val}`);
                                          }}
                                        >
                                          <span className="cell-text">{val}</span>
                                        </button>
                                      </div>
                                    </td>
                                  );
                                }
                                if (col === "Platform") {
                                  const isTikTok = val.toLowerCase().includes("tiktok");
                                  return (
                                    <td key={col}>
                                      <span className={`mmp-platform-pill ${isTikTok ? "tiktok" : ""}`}>
                                        {val || "TikTok"}
                                      </span>
                                    </td>
                                  );
                                }
                                if (col === "Folder") {
                                  return (
                                    <td key={col}>
                                      <span className="group-pill">{val || "Không có nhóm"}</span>
                                    </td>
                                  );
                                }
                                if (col === "Status") {
                                  return (
                                    <td key={col}>
                                      <span className={`status-pill ${isOpen ? "running" : statusTone(val)}`}>
                                        {isOpen ? "Đang mở" : val || "Chưa login"}
                                      </span>
                                    </td>
                                  );
                                }
                                if (col === "LastActive") {
                                  return <td key={col}>{formatTimestamp(val)}</td>;
                                }
                                return (
                                  <td key={col} className={`cell-${col.toLowerCase()}`}>
                                    <span className="cell-text">{maskValue(col, val)}</span>
                                  </td>
                                );
                              })}
                              <td>
                                {installedExts.length > 0 ? (
                                  <span className="mmp-ext-count-pill installed" title={extNames}>
                                    <Check size={12} /> {installedExts.length} ext
                                  </span>
                                ) : (
                                  <span className="mmp-ext-count-pill none">0 ext</span>
                                )}
                              </td>
                              <td className="actions-col">
                                <div className="row-actions">
                                  {isOpen ? (
                                    <button
                                      type="button"
                                      className="row-btn danger"
                                      disabled={isBusy}
                                      onClick={() => handleCloseBrowser(uid)}
                                    >
                                      <Square size={12} /> Đóng
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      className="row-btn primary"
                                      disabled={isBusy}
                                      title="Mở profile trình duyệt (tự nạp extension đã cài)"
                                      onClick={() => handleLaunch(acc, "open")}
                                    >
                                      <Play size={12} /> Mở
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="row-btn cookie"
                                    disabled={isBusy}
                                    title="Mở profile bằng Cookie đã lưu"
                                    onClick={() => handleLaunch(acc, "cookie")}
                                  >
                                    <CookieIcon size={12} /> Nạp CK
                                  </button>
                                  <button
                                    type="button"
                                    className="row-btn save"
                                    disabled={isBusy}
                                    title="Lưu Cookie từ trình duyệt đang mở vào Database & ổ đĩa"
                                    onClick={() => handleSaveCookies(uid)}
                                  >
                                    <Save size={12} /> Lưu CK
                                  </button>
                                  <button
                                    type="button"
                                    className="row-btn ghost"
                                    onClick={() => openEditDrawer(acc)}
                                  >
                                    Xem
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </main>
          </div>
        )}
      </div>

      {/* RIGHT-CLICK CONTEXT MENU FOR PROFILE ROW */}
      {contextMenu && (
        <div
          className="mmp-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mmp-context-head">
            <strong>{contextMenu.account.Name || contextMenu.account.UID}</strong>
            <span>{contextMenu.account.UID}</span>
          </div>
          <button
            type="button"
            className="mmp-context-item"
            onClick={() => {
              const target = contextMenu.account;
              setContextMenu(null);
              openEditDrawer(target);
            }}
          >
            <Edit3 size={14} /> Sửa thông tin Profile
          </button>
          {openProfiles.includes(contextMenu.account.UID) ? (
            <button
              type="button"
              className="mmp-context-item"
              onClick={() => {
                const uid = contextMenu.account.UID;
                setContextMenu(null);
                handleCloseBrowser(uid);
              }}
            >
              <Square size={14} /> Đóng trình duyệt
            </button>
          ) : (
            <button
              type="button"
              className="mmp-context-item"
              onClick={() => {
                const target = contextMenu.account;
                setContextMenu(null);
                handleLaunch(target, "open");
              }}
            >
              <Play size={14} /> Mở Profile
            </button>
          )}
          <button
            type="button"
            className="mmp-context-item"
            onClick={() => {
              const target = contextMenu.account;
              setContextMenu(null);
              handleLaunch(target, "cookie");
            }}
          >
            <CookieIcon size={14} /> Mở bằng Cookie (Nạp CK)
          </button>
          <button
            type="button"
            className="mmp-context-item"
            onClick={() => {
              const uid = contextMenu.account.UID;
              setContextMenu(null);
              handleSaveCookies(uid);
            }}
          >
            <Save size={14} /> Lưu Cookie (Lưu CK)
          </button>
          <div className="mmp-context-sep" />
          <button
            type="button"
            className="mmp-context-item"
            onClick={() => {
              const uid = contextMenu.account.UID;
              setContextMenu(null);
              if (!selectedUids.includes(uid)) setSelectedUids([uid]);
              setMoveTargetGroup(data?.groups[0]?.name || "Không có nhóm");
              setShowMoveGroup(true);
            }}
          >
            <FolderInput size={14} /> Chuyển nhóm
          </button>
          <button
            type="button"
            className="mmp-context-item"
            onClick={() => {
              const uid = contextMenu.account.UID;
              setContextMenu(null);
              window.mmp.copyText(uid);
              notify("info", `Đã copy UID: ${uid}`);
            }}
          >
            <Copy size={14} /> Copy UID
          </button>
          <div className="mmp-context-sep" />
          <button
            type="button"
            className="mmp-context-item danger"
            onClick={async () => {
              const uid = contextMenu.account.UID;
              const label = contextMenu.account.Name || uid;
              setContextMenu(null);
              if (!window.confirm(`Xóa profile "${label}" (${uid}) khỏi database?`)) return;
              try {
                const res = await window.mmp.deleteAccounts([uid]);
                setSelectedUids((prev) => prev.filter((id) => id !== uid));
                await refreshAll();
                notify("success", res.message);
              } catch (err) {
                notify("error", err instanceof Error ? err.message : String(err));
              }
            }}
          >
            <Trash2 size={14} /> Xóa Profile
          </button>
        </div>
      )}

      {/* DETAIL / EDIT DRAWER */}
      {activeAccount && editDraft && (
        <div className="drawer-backdrop" onClick={() => setActiveAccount(null)}>
          <div className="detail-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <div>
                <p className="eyebrow">CHI TIẾT PROFILE</p>
                <h3>{activeAccount.Name || activeAccount.UID}</h3>
              </div>
              <div className="drawer-head-actions">
                <button
                  type="button"
                  className="secondary-button compact-btn"
                  onClick={() => setRevealSensitive((v) => !v)}
                >
                  {revealSensitive ? <EyeOff size={14} /> : <Eye size={14} />}
                  {revealSensitive ? "Ẩn bảo mật" : "Hiện bảo mật"}
                </button>
                <button type="button" className="icon-button" onClick={() => setActiveAccount(null)}>
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="drawer-body">
              {["UID", "Name", "Platform", "StartUrl", "Folder", "Status", "Email", "Password", "TwoFA", "Phone", "Proxy", "Cookie", "Note"].map(
                (field) => {
                  const isSensitive = SENSITIVE_FIELDS.has(field.toLowerCase());
                  const value = editDraft[field] || "";
                  return (
                    <div key={field} className="drawer-field">
                      <div className="drawer-field-label">
                        <label>{LABELS[field] || field}</label>
                        <div className="drawer-field-tools">
                          {field === "TwoFA" && value && (
                            <button
                              type="button"
                              className="mini-link-btn"
                              onClick={() => handleGenerateTotp(value)}
                            >
                              <KeyRound size={12} /> Lấy mã 2FA
                            </button>
                          )}
                          {value && (
                            <button
                              type="button"
                              className="mini-link-btn"
                              onClick={() => {
                                window.mmp.copyText(value);
                                notify("info", `Đã copy ${LABELS[field] || field}`);
                              }}
                            >
                              <Copy size={12} /> Copy
                            </button>
                          )}
                        </div>
                      </div>
                      {field === "Cookie" || field === "Note" ? (
                        <textarea
                          rows={field === "Cookie" ? 4 : 2}
                          className="mmp-textarea"
                          value={!revealSensitive && isSensitive && value ? maskValue(field, value) : value}
                          readOnly={!revealSensitive && isSensitive}
                          onChange={(e) => setEditDraft({ ...editDraft, [field]: e.target.value })}
                        />
                      ) : field === "Folder" ? (
                        <select
                          className="mmp-select full"
                          value={value || "Không có nhóm"}
                          onChange={(e) => setEditDraft({ ...editDraft, Folder: e.target.value })}
                        >
                          <option value="Không có nhóm">Không có nhóm</option>
                          {(data?.groups || [])
                            .filter((g) => g.name !== "Không có nhóm")
                            .map((g) => (
                              <option key={g.name} value={g.name}>
                                {g.name}
                              </option>
                            ))}
                        </select>
                      ) : (
                        <input
                          type={!revealSensitive && isSensitive ? "password" : "text"}
                          className="mmp-input full"
                          value={value}
                          readOnly={field === "UID"}
                          onChange={(e) => setEditDraft({ ...editDraft, [field]: e.target.value })}
                        />
                      )}
                    </div>
                  );
                },
              )}

              {totpInfo && (
                <div className="mmp-totp-box">
                  <KeyRound size={16} />
                  <span>
                    Mã 2FA: <strong>{totpInfo.code}</strong> (hết hạn sau {totpInfo.expiresIn}s)
                  </span>
                </div>
              )}
            </div>

            <div className="drawer-foot">
              <button type="button" className="secondary-button" onClick={() => setActiveAccount(null)}>
                Đóng
              </button>
              <button type="button" className="primary-button" onClick={handleSaveEditDrawer}>
                <Save size={15} /> Lưu thay đổi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CREATE GROUP */}
      {showCreateGroup && (
        <div className="modal-backdrop" onClick={() => setShowCreateGroup(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3>Tạo nhóm quản lý mới</h3>
            <p className="muted-text">Ví dụ: TikTok Nuôi, TikTok Live, TikTok Shop...</p>
            <input
              type="text"
              className="mmp-input full"
              autoFocus
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateGroup()}
              placeholder="Nhập tên nhóm..."
            />
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setShowCreateGroup(false)}>
                Hủy
              </button>
              <button type="button" className="primary-button" onClick={handleCreateGroup}>
                Tạo nhóm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: RENAME GROUP */}
      {renameTargetGroup && (
        <div className="modal-backdrop" onClick={() => setRenameTargetGroup(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3>Đổi tên nhóm "{renameTargetGroup}"</h3>
            <input
              type="text"
              className="mmp-input full"
              autoFocus
              value={renameGroupValue}
              onChange={(e) => setRenameGroupValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRenameGroup()}
            />
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setRenameTargetGroup(null)}>
                Hủy
              </button>
              <button type="button" className="primary-button" onClick={handleRenameGroup}>
                Lưu tên mới
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: BULK LAUNCH PROFILES */}
      {showBulkLaunch && (
        <div className="modal-backdrop" onClick={() => !bulkLaunching && setShowBulkLaunch(false)}>
          <div className="modal-box wide" onClick={(e) => e.stopPropagation()}>
            <h3>Mở hàng loạt {selectedUids.length} Profile</h3>

            <div className="modal-form-grid" style={{ marginBottom: 12 }}>
              <label>
                <span>Chế độ URL lúc mở</span>
                <select
                  className="mmp-select full"
                  value={bulkUrlMode}
                  disabled={Boolean(bulkLaunching)}
                  onChange={(e) => setBulkUrlMode(e.target.value as "profile" | "custom")}
                >
                  <option value="custom">Mở cùng 1 URL cấu hình bên dưới</option>
                  <option value="profile">Dùng URL riêng của từng profile (StartUrl)</option>
                </select>
              </label>

              <label>
                <span>Chế độ mở trình duyệt</span>
                <select
                  className="mmp-select full"
                  value={bulkLaunchMode}
                  disabled={Boolean(bulkLaunching)}
                  onChange={(e) => setBulkLaunchMode(e.target.value as "open" | "cookie")}
                >
                  <option value="open">Mở trực tiếp (giữ session profile)</option>
                  <option value="cookie">Mở bằng Cookie đã lưu (Nạp CK)</option>
                </select>
              </label>
            </div>

            {bulkUrlMode === "custom" && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 5, color: "var(--text-muted)" }}>
                  URL lúc mở cho {selectedUids.length} profile
                </label>
                <input
                  type="text"
                  className="mmp-input full"
                  disabled={Boolean(bulkLaunching)}
                  value={bulkCustomUrl}
                  onChange={(e) => setBulkCustomUrl(e.target.value)}
                  placeholder="https://www.tiktok.com/"
                />
                <div className="mmp-preset-row" style={{ marginTop: 8 }}>
                  {BULK_URL_PRESETS.map((preset) => (
                    <button
                      key={preset.url}
                      type="button"
                      disabled={Boolean(bulkLaunching)}
                      className={`mmp-chip-btn ${bulkCustomUrl === preset.url ? "active" : ""}`}
                      onClick={() => setBulkCustomUrl(preset.url)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <label className="mmp-skip-toggle" style={{ marginTop: 10 }}>
                  <input
                    type="checkbox"
                    checked={bulkSaveAsDefaultUrl}
                    disabled={Boolean(bulkLaunching)}
                    onChange={(e) => setBulkSaveAsDefaultUrl(e.target.checked)}
                  />
                  <span>Lưu URL này làm URL mặc định của tool</span>
                </label>
              </div>
            )}

            <label style={{ display: "block", marginBottom: 4 }}>
              <span style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4, color: "var(--text-muted)" }}>
                Độ trễ giữa mỗi profile (giây) — tránh giật máy khi mở nhiều profile
              </span>
              <input
                type="number"
                min={0}
                max={30}
                step={0.5}
                className="mmp-input"
                style={{ width: 120 }}
                disabled={Boolean(bulkLaunching)}
                value={bulkDelaySeconds}
                onChange={(e) => setBulkDelaySeconds(Number(e.target.value))}
              />
            </label>

            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={Boolean(bulkLaunching)}
                onClick={() => setShowBulkLaunch(false)}
              >
                Hủy
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={Boolean(bulkLaunching)}
                onClick={handleBulkLaunchStart}
              >
                <Play size={14} />
                {bulkLaunching
                  ? `Đang mở ${bulkLaunching.current}/${bulkLaunching.total}...`
                  : `Mở ngay ${selectedUids.length} profile`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: MOVE TO GROUP */}
      {showMoveGroup && (
        <div className="modal-backdrop" onClick={() => setShowMoveGroup(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3>Chuyển {selectedUids.length} profile sang nhóm</h3>
            <select
              className="mmp-select full"
              value={moveTargetGroup}
              onChange={(e) => setMoveTargetGroup(e.target.value)}
            >
              <option value="Không có nhóm">Không có nhóm</option>
              {(data?.groups || [])
                .filter((g) => g.name !== "Không có nhóm")
                .map((g) => (
                  <option key={g.name} value={g.name}>
                    {g.name}
                  </option>
                ))}
            </select>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setShowMoveGroup(false)}>
                Hủy
              </button>
              <button type="button" className="primary-button" onClick={handleMoveSelectedToGroup}>
                Chuyển nhóm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ADD PROFILE */}
      {showAddProfile && (
        <div className="modal-backdrop" onClick={() => setShowAddProfile(false)}>
          <div className="modal-box wide" onClick={(e) => e.stopPropagation()}>
            <h3>Thêm Profile mới</h3>
            <div className="modal-form-grid">
              <label>
                <span>UID / Mã Profile *</span>
                <input
                  type="text"
                  className="mmp-input full"
                  placeholder="vd: tiktok_shop_01 hoặc @username"
                  value={newProfileDraft.UID}
                  onChange={(e) => setNewProfileDraft({ ...newProfileDraft, UID: e.target.value })}
                />
              </label>
              <label>
                <span>Tên hiển thị</span>
                <input
                  type="text"
                  className="mmp-input full"
                  placeholder="Tên tài khoản TikTok"
                  value={newProfileDraft.Name}
                  onChange={(e) => setNewProfileDraft({ ...newProfileDraft, Name: e.target.value })}
                />
              </label>
              <label>
                <span>Nền tảng</span>
                <input
                  type="text"
                  className="mmp-input full"
                  value={newProfileDraft.Platform}
                  onChange={(e) => setNewProfileDraft({ ...newProfileDraft, Platform: e.target.value })}
                />
              </label>
              <label>
                <span>Nhóm</span>
                <select
                  className="mmp-select full"
                  value={newProfileDraft.Folder}
                  onChange={(e) => setNewProfileDraft({ ...newProfileDraft, Folder: e.target.value })}
                >
                  <option value="Không có nhóm">Không có nhóm</option>
                  {(data?.groups || [])
                    .filter((g) => g.name !== "Không có nhóm")
                    .map((g) => (
                      <option key={g.name} value={g.name}>
                        {g.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                <span>Email</span>
                <input
                  type="text"
                  className="mmp-input full"
                  value={newProfileDraft.Email}
                  onChange={(e) => setNewProfileDraft({ ...newProfileDraft, Email: e.target.value })}
                />
              </label>
              <label>
                <span>Mật khẩu</span>
                <input
                  type="text"
                  className="mmp-input full"
                  value={newProfileDraft.Password}
                  onChange={(e) => setNewProfileDraft({ ...newProfileDraft, Password: e.target.value })}
                />
              </label>
              <label>
                <span>URL khởi chạy</span>
                <input
                  type="text"
                  className="mmp-input full"
                  value={newProfileDraft.StartUrl}
                  onChange={(e) => setNewProfileDraft({ ...newProfileDraft, StartUrl: e.target.value })}
                />
              </label>
              <label>
                <span>Proxy (tùy chọn)</span>
                <input
                  type="text"
                  className="mmp-input full"
                  placeholder="host:port hoặc host:port:user:pass"
                  value={newProfileDraft.Proxy}
                  onChange={(e) => setNewProfileDraft({ ...newProfileDraft, Proxy: e.target.value })}
                />
              </label>
            </div>
            <label style={{ display: "block", marginTop: 10 }}>
              <span style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                Cookie ban đầu (JSON hoặc chuỗi cookie — tùy chọn)
              </span>
              <textarea
                rows={3}
                className="mmp-textarea"
                placeholder="Dán cookie TikTok (nếu đã có) hoặc bỏ trống để mở profile đăng nhập thủ công rồi bấm Lưu CK"
                value={newProfileDraft.Cookie}
                onChange={(e) => setNewProfileDraft({ ...newProfileDraft, Cookie: e.target.value })}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setShowAddProfile(false)}>
                Hủy
              </button>
              <button type="button" className="primary-button" onClick={handleCreateProfile}>
                <UserPlus size={15} /> Tạo Profile
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
