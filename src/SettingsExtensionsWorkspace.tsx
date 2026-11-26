import {
  Check,
  CheckCircle2,
  Database,
  FolderOpen,
  FolderPlus,
  Globe2,
  HardDrive,
  PackageCheck,
  PackagePlus,
  Puzzle,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  Upload,
} from "lucide-react";
import { useMemo, useState } from "react";
import type {
  AccountGroup,
  AccountRow,
  AppSettings,
  BulkInstallExtensionsResult,
  ExtensionItem,
  ProfileExtensionsMap,
} from "./types";

interface SettingsExtensionsWorkspaceProps {
  accounts: AccountRow[];
  groups: AccountGroup[];
  settings: AppSettings | null;
  extensions: ExtensionItem[];
  profileExtensions: ProfileExtensionsMap;
  onRefreshAll: () => Promise<void>;
  onSettingsChanged: (next: AppSettings) => void;
  onChooseDatabase: () => Promise<void>;
  onCreateDatabase: () => Promise<void>;
  onNotify: (type: "success" | "error" | "info", message: string) => void;
}

const URL_PRESETS = [
  { label: "TikTok", url: "https://www.tiktok.com/" },
  { label: "TikTok Studio", url: "https://www.tiktok.com/tiktokstudio" },
  { label: "TikTok Seller VN", url: "https://seller-vn.tiktok.com/" },
  { label: "Facebook", url: "https://www.facebook.com/" },
];

export function SettingsExtensionsWorkspace({
  accounts,
  groups,
  settings,
  extensions,
  profileExtensions,
  onRefreshAll,
  onSettingsChanged,
  onChooseDatabase,
  onCreateDatabase,
  onNotify,
}: SettingsExtensionsWorkspaceProps) {
  const [selectedExtIds, setSelectedExtIds] = useState<string[]>([]);
  const [selectedProfileUids, setSelectedProfileUids] = useState<string[]>([]);
  const [groupFilter, setGroupFilter] = useState<string>("__ALL__");
  const [statusFilter, setStatusFilter] = useState<"all" | "not-installed" | "installed">("all");
  const [searchText, setSearchText] = useState("");
  const [skipInstalled, setSkipInstalled] = useState(true);
  const [busyAction, setBusyAction] = useState<string>("");
  const [lastResult, setLastResult] = useState<BulkInstallExtensionsResult | null>(null);
  const [startUrlDraft, setStartUrlDraft] = useState(settings?.defaultStartUrl || "https://www.tiktok.com/");
  const [urlUpdateModal, setUrlUpdateModal] = useState<{ ext: ExtensionItem; url: string } | null>(null);

  const extById = useMemo(() => new Map(extensions.map((ext) => [ext.id, ext])), [extensions]);

  const activeExtIds = useMemo(
    () => selectedExtIds.filter((id) => extById.has(id)),
    [selectedExtIds, extById],
  );

  // Compute per-profile installation status relative to currently selected extensions
  const profileRows = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    return accounts
      .map((acc) => {
        const uid = acc.UID || "";
        const installedRecords = (profileExtensions[uid] || []).filter((r) => r.status === "installed");
        const installedIdSet = new Set(installedRecords.map((r) => r.extensionId));
        const installedNames = installedRecords
          .map((r) => extById.get(r.extensionId)?.name)
          .filter(Boolean) as string[];

        let matchedCount = 0;
        let state: "none" | "partial" | "full" = "none";
        if (activeExtIds.length > 0) {
          matchedCount = activeExtIds.filter((id) => installedIdSet.has(id)).length;
          if (matchedCount === activeExtIds.length) state = "full";
          else if (matchedCount > 0) state = "partial";
          else state = "none";
        } else {
          state = installedRecords.length > 0 ? "full" : "none";
        }

        return {
          account: acc,
          uid,
          name: acc.Name || uid,
          folder: acc.Folder || "Không có nhóm",
          installedCount: installedRecords.length,
          installedNames,
          matchedCount,
          totalSelectedExt: activeExtIds.length,
          state,
        };
      })
      .filter((row) => {
        if (groupFilter !== "__ALL__" && row.folder !== groupFilter) return false;
        if (statusFilter === "not-installed" && row.state === "full") return false;
        if (statusFilter === "installed" && row.state !== "full") return false;
        if (query) {
          const hay = `${row.uid} ${row.name} ${row.folder} ${row.account.Email || ""}`.toLowerCase();
          if (!hay.includes(query)) return false;
        }
        return true;
      });
  }, [accounts, profileExtensions, extById, activeExtIds, groupFilter, statusFilter, searchText]);

  const stats = useMemo(() => {
    const total = profileRows.length;
    const full = profileRows.filter((r) => r.state === "full").length;
    const partial = profileRows.filter((r) => r.state === "partial").length;
    const none = total - full - partial;
    return { total, full, partial, none };
  }, [profileRows]);

  const toggleExt = (id: string) => {
    setSelectedExtIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const toggleProfile = (uid: string) => {
    setSelectedProfileUids((prev) => (prev.includes(uid) ? prev.filter((item) => item !== uid) : [...prev, uid]));
  };

  const selectAllVisible = () => {
    const visibleUids = profileRows.map((r) => r.uid);
    const allSelected = visibleUids.length > 0 && visibleUids.every((uid) => selectedProfileUids.includes(uid));
    if (allSelected) {
      setSelectedProfileUids((prev) => prev.filter((uid) => !visibleUids.includes(uid)));
    } else {
      setSelectedProfileUids((prev) => [...new Set([...prev, ...visibleUids])]);
    }
  };

  const selectOnlyNotInstalled = () => {
    const targets = profileRows.filter((r) => r.state !== "full").map((r) => r.uid);
    setSelectedProfileUids(targets);
    onNotify("info", `Đã chọn nhanh ${targets.length} profile chưa cài đủ extension.`);
  };

  const handleAddFolder = async () => {
    setBusyAction("add-folder");
    try {
      const res = await window.mmp.addExtensionFolder();
      if (res) {
        await onRefreshAll();
        setSelectedExtIds((prev) => [...new Set([...prev, res.extension.id])]);
        onNotify("success", res.message);
      }
    } catch (err) {
      onNotify("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction("");
    }
  };

  const handleAddZip = async () => {
    setBusyAction("add-zip");
    try {
      const res = await window.mmp.addExtensionZip();
      if (res) {
        await onRefreshAll();
        setSelectedExtIds((prev) => [...new Set([...prev, res.extension.id])]);
        onNotify("success", res.message);
      }
    } catch (err) {
      onNotify("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction("");
    }
  };

  const handleRemoveExt = async (ext: ExtensionItem) => {
    if (!window.confirm(`Xóa extension "${ext.name}" khỏi kho và gỡ khỏi các profile đang dùng?`)) return;
    setBusyAction(`remove-${ext.id}`);
    try {
      const res = await window.mmp.removeExtension(ext.id);
      setSelectedExtIds((prev) => prev.filter((id) => id !== ext.id));
      await onRefreshAll();
      onNotify("success", res.message);
    } catch (err) {
      onNotify("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction("");
    }
  };

  const handleUpdateAllExts = async () => {
    setBusyAction("update-all-ext");
    try {
      const res = await window.mmp.updateAllExtensions();
      await onRefreshAll();
      onNotify(res.updatedCount > 0 ? "success" : "error", res.message);
    } catch (err) {
      onNotify("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction("");
    }
  };

  const handleUpdateExtSource = async (ext: ExtensionItem) => {
    setBusyAction(`upd-src-${ext.id}`);
    try {
      const res = await window.mmp.updateExtensionFromSource(ext.id);
      await onRefreshAll();
      onNotify("success", res.message);
    } catch (err) {
      onNotify("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction("");
    }
  };

  const handleUpdateExtFolder = async (ext: ExtensionItem) => {
    setBusyAction(`upd-dir-${ext.id}`);
    try {
      const res = await window.mmp.updateExtensionFromFolder(ext.id);
      if (res) {
        await onRefreshAll();
        onNotify("success", res.message);
      }
    } catch (err) {
      onNotify("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction("");
    }
  };

  const handleUpdateExtZip = async (ext: ExtensionItem) => {
    setBusyAction(`upd-zip-${ext.id}`);
    try {
      const res = await window.mmp.updateExtensionFromZip(ext.id);
      if (res) {
        await onRefreshAll();
        onNotify("success", res.message);
      }
    } catch (err) {
      onNotify("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction("");
    }
  };

  const handleUpdateExtUrl = (ext: ExtensionItem) => {
    const defaultUrl =
      ext.remoteZipUrl ||
      (ext.name.toLowerCase().includes("tiktok")
        ? "https://github.com/datdtpl-maker/TikTok-Auto-Reply-Extension/archive/refs/heads/main.zip"
        : "");
    setUrlUpdateModal({ ext, url: defaultUrl });
  };

  const handleConfirmUpdateExtUrl = async () => {
    if (!urlUpdateModal) return;
    const { ext, url } = urlUpdateModal;
    if (!url.trim()) {
      onNotify("error", "Vui lòng nhập link tải file .ZIP (GitHub).");
      return;
    }
    setBusyAction(`upd-url-${ext.id}`);
    try {
      const res = await window.mmp.updateExtensionFromUrl({
        extensionId: ext.id,
        zipUrl: url.trim(),
      });
      setUrlUpdateModal(null);
      await onRefreshAll();
      onNotify("success", res.message);
    } catch (err) {
      onNotify("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction("");
    }
  };

  const handleBulkInstall = async () => {
    if (!activeExtIds.length) {
      onNotify("error", "Hãy chọn ít nhất 1 extension ở bước 1.");
      return;
    }
    if (!selectedProfileUids.length) {
      onNotify("error", "Hãy chọn ít nhất 1 profile ở bước 2.");
      return;
    }
    setBusyAction("bulk-install");
    try {
      const res = await window.mmp.bulkInstallExtensions({
        extensionIds: activeExtIds,
        profileUids: selectedProfileUids,
        skipInstalled,
      });
      setLastResult(res);
      await onRefreshAll();
      onNotify("success", res.message);
    } catch (err) {
      onNotify("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction("");
    }
  };

  const handleBulkUninstall = async () => {
    if (!activeExtIds.length || !selectedProfileUids.length) {
      onNotify("error", "Hãy chọn extension và profile cần gỡ.");
      return;
    }
    if (!window.confirm(`Gỡ ${activeExtIds.length} extension đã chọn khỏi ${selectedProfileUids.length} profile?`)) return;
    setBusyAction("bulk-uninstall");
    try {
      const res = await window.mmp.bulkUninstallExtensions({
        extensionIds: activeExtIds,
        profileUids: selectedProfileUids,
      });
      setLastResult(null);
      await onRefreshAll();
      onNotify("success", res.message);
    } catch (err) {
      onNotify("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction("");
    }
  };

  const handleChooseStorageRoot = async () => {
    setBusyAction("storage-root");
    try {
      const next = await window.mmp.chooseStorageRoot();
      if (next) {
        onSettingsChanged(next);
        await onRefreshAll();
        onNotify("success", `Đã chuyển thư mục dữ liệu sang ${next.storageRoot}`);
      }
    } catch (err) {
      onNotify("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction("");
    }
  };

  const handleSaveStartUrl = async (urlValue?: string) => {
    const nextUrl = (urlValue ?? startUrlDraft).trim() || "https://www.tiktok.com/";
    setStartUrlDraft(nextUrl);
    try {
      const saved = await window.mmp.saveSettings({ defaultStartUrl: nextUrl });
      onSettingsChanged(saved);
      onNotify("success", `Đã lưu URL mở profile mặc định: ${saved.defaultStartUrl}`);
    } catch (err) {
      onNotify("error", err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="mmp-settings-workspace">
      {/* SECTION 1: STORAGE & BROWSER SETTINGS */}
      <section className="mmp-card">
        <div className="mmp-card-head">
          <div>
            <p className="eyebrow">LƯU TRỮ ĐỘC LẬP & TRÌNH DUYỆT</p>
            <h2>Thư mục Database, Profile, Cookies & URL mặc định</h2>
          </div>
          <div className="mmp-head-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => window.mmp.openStorageFolder("root")}
            >
              <FolderOpen size={15} />
              Mở thư mục dữ liệu
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busyAction === "storage-root"}
              onClick={handleChooseStorageRoot}
            >
              <HardDrive size={15} />
              Đổi thư mục lưu trữ
            </button>
          </div>
        </div>

        <div className="mmp-storage-grid">
          <div className="mmp-storage-item">
            <span className="mmp-storage-label">Thư mục gốc (tách biệt hoàn toàn MetaUltra)</span>
            <code className="mmp-path-code">{settings?.storageRoot || "D:\\ManagerMultiProfile_data"}</code>
          </div>
          <div className="mmp-storage-item">
            <span className="mmp-storage-label">File Database Profile (.db)</span>
            <div className="mmp-inline-row">
              <code className="mmp-path-code">{settings?.databasePath || "—"}</code>
              <button type="button" className="secondary-button compact-btn" onClick={onChooseDatabase}>
                <Database size={14} /> Đổi DB
              </button>
              <button type="button" className="secondary-button compact-btn" onClick={onCreateDatabase}>
                <FolderPlus size={14} /> Tạo DB mới
              </button>
            </div>
          </div>
          <div className="mmp-storage-item">
            <span className="mmp-storage-label">Thư mục Cookies & Profiles</span>
            <div className="mmp-inline-row">
              <button type="button" className="secondary-button compact-btn" onClick={() => window.mmp.openStorageFolder("profiles")}>
                <FolderOpen size={14} /> Profiles
              </button>
              <button type="button" className="secondary-button compact-btn" onClick={() => window.mmp.openStorageFolder("cookies")}>
                <FolderOpen size={14} /> Cookies
              </button>
              <button type="button" className="secondary-button compact-btn" onClick={() => window.mmp.openStorageFolder("extensions")}>
                <FolderOpen size={14} /> Extensions
              </button>
            </div>
          </div>
          <div className="mmp-storage-item">
            <span className="mmp-storage-label">URL mặc định khi mở Profile (TikTok / Web)</span>
            <div className="mmp-inline-row">
              <input
                type="text"
                className="mmp-input"
                value={startUrlDraft}
                onChange={(e) => setStartUrlDraft(e.target.value)}
                placeholder="https://www.tiktok.com/"
              />
              <button type="button" className="primary-button compact-btn" onClick={() => handleSaveStartUrl()}>
                <Globe2 size={14} /> Lưu URL
              </button>
            </div>
            <div className="mmp-preset-row">
              {URL_PRESETS.map((preset) => (
                <button
                  key={preset.url}
                  type="button"
                  className={`mmp-chip-btn ${startUrlDraft === preset.url ? "active" : ""}`}
                  onClick={() => handleSaveStartUrl(preset.url)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 2: EXTENSION LIBRARY */}
      <section className="mmp-card">
        <div className="mmp-card-head">
          <div>
            <p className="eyebrow">BƯỚC 1 — KHO EXTENSION</p>
            <h2>Chọn Extension cần cài ({activeExtIds.length}/{extensions.length} đang chọn)</h2>
          </div>
          <div className="mmp-head-actions">
            {extensions.length > 0 && (
              <button
                type="button"
                className="accent-button"
                disabled={Boolean(busyAction)}
                title="Đồng bộ phiên bản mới nhất từ thư mục/zip nguồn cho toàn bộ extension và tự động áp dụng lên các profile đang dùng"
                onClick={handleUpdateAllExts}
              >
                <RefreshCw size={15} className={busyAction === "update-all-ext" ? "spin" : ""} />
                Cập nhật tất cả Extension
              </button>
            )}
            <button
              type="button"
              className="primary-button"
              disabled={Boolean(busyAction)}
              onClick={handleAddFolder}
            >
              <PackagePlus size={15} />
              Thêm thư mục Extension
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={Boolean(busyAction)}
              onClick={handleAddZip}
            >
              <Upload size={15} />
              Thêm từ file .ZIP
            </button>
          </div>
        </div>

        {extensions.length === 0 ? (
          <div className="mmp-empty-box">
            <Puzzle size={28} />
            <p>Chưa có extension nào trong kho. Bấm <strong>Thêm thư mục Extension</strong> (chứa <code>manifest.json</code>) hoặc <strong>Thêm từ file .ZIP</strong> để bắt đầu.</p>
          </div>
        ) : (
          <div className="mmp-ext-grid">
            {extensions.map((ext) => {
              const checked = activeExtIds.includes(ext.id);
              return (
                <div
                  key={ext.id}
                  className={`mmp-ext-card ${checked ? "selected" : ""}`}
                  onClick={() => toggleExt(ext.id)}
                >
                  <div className="mmp-ext-card-top">
                    <label className="mmp-ext-check" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleExt(ext.id)}
                      />
                      <strong>{ext.name}</strong>
                    </label>
                    <span className="mmp-version-pill">v{ext.version}</span>
                  </div>
                  {ext.description && <p className="mmp-ext-desc">{ext.description}</p>}
                  <div className="mmp-ext-card-foot">
                    <span className={`mmp-status-pill ${ext.exists ? "ok" : "warn"}`}>
                      {ext.exists ? `Đã cài trên ${ext.installedProfileCount} profile` : "Thiếu file trên ổ đĩa"}
                    </span>
                    <div className="mmp-ext-card-tools" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="mmp-mini-action"
                        disabled={Boolean(busyAction)}
                        title={`Cập nhật từ nguồn gốc: ${ext.sourcePath || "chưa rõ"}`}
                        onClick={() => handleUpdateExtSource(ext)}
                      >
                        <RefreshCw size={12} className={busyAction === `upd-src-${ext.id}` ? "spin" : ""} />
                        Cập nhật
                      </button>
                      <button
                        type="button"
                        className="mmp-mini-action"
                        disabled={Boolean(busyAction)}
                        title="Chọn thư mục bản mới để ghi đè cập nhật (giữ nguyên Extension ID cho mọi profile)"
                        onClick={() => handleUpdateExtFolder(ext)}
                      >
                        Thư mục
                      </button>
                      <button
                        type="button"
                        className="mmp-mini-action"
                        disabled={Boolean(busyAction)}
                        title="Chọn file .ZIP bản mới để ghi đè cập nhật (giữ nguyên Extension ID cho mọi profile)"
                        onClick={() => handleUpdateExtZip(ext)}
                      >
                        .ZIP
                      </button>
                      <button
                        type="button"
                        className="mmp-mini-action"
                        disabled={Boolean(busyAction)}
                        title="Tải trực tiếp bản mới nhất từ link GitHub ZIP (không cần tải tay)"
                        onClick={() => handleUpdateExtUrl(ext)}
                      >
                        <Globe2 size={12} className={busyAction === `upd-url-${ext.id}` ? "spin" : ""} />
                        GitHub
                      </button>
                      <button
                        type="button"
                        className="mmp-danger-link"
                        title="Xóa extension khỏi kho"
                        onClick={() => handleRemoveExt(ext)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* SECTION 3: BULK INSTALL TO PROFILES WITH DUPLICATE-PROTECTION STATUS BAR */}
      <section className="mmp-card">
        <div className="mmp-card-head">
          <div>
            <p className="eyebrow">BƯỚC 2 — CHỌN PROFILE & TRẠNG THÁI CHỐNG CÀI TRÙNG</p>
            <h2>
              Cài đặt Extension hàng loạt ({selectedProfileUids.length} profile đang chọn)
            </h2>
          </div>
          <div className="mmp-head-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={selectOnlyNotInstalled}
              disabled={profileRows.length === 0}
            >
              <CheckCircle2 size={15} />
              Chọn nhanh chưa cài ({stats.none + stats.partial})
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={!activeExtIds.length || !selectedProfileUids.length || Boolean(busyAction)}
              onClick={handleBulkUninstall}
            >
              <Trash2 size={15} />
              Gỡ Extension
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={!activeExtIds.length || !selectedProfileUids.length || Boolean(busyAction)}
              onClick={handleBulkInstall}
            >
              <PackageCheck size={15} />
              {busyAction === "bulk-install"
                ? "Đang cài..."
                : `Cài cho ${selectedProfileUids.length} profile`}
            </button>
          </div>
        </div>

        {/* Summary Status Banner */}
        <div className="mmp-status-summary-bar">
          <div className="mmp-summary-pills">
            <span className="mmp-summary-pill total">Hiển thị: {stats.total}</span>
            <span className="mmp-summary-pill done">
              <Check size={13} /> Đã cài đủ: {stats.full}
            </span>
            {stats.partial > 0 && (
              <span className="mmp-summary-pill partial">
                <ShieldAlert size={13} /> Cài một phần: {stats.partial}
              </span>
            )}
            <span className="mmp-summary-pill pending">Chưa cài: {stats.none}</span>
          </div>
          <label className="mmp-skip-toggle">
            <input
              type="checkbox"
              checked={skipInstalled}
              onChange={(e) => setSkipInstalled(e.target.checked)}
            />
            <span>Tự động bỏ qua profile đã cài extension (tránh cài trùng)</span>
          </label>
        </div>

        {/* Filters */}
        <div className="mmp-filter-bar">
          <div className="mmp-search-inline">
            <Search size={15} />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Tìm UID, tên profile, email..."
            />
          </div>
          <select
            className="mmp-select"
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
          >
            <option value="__ALL__">Tất cả nhóm ({accounts.length})</option>
            {groups.map((g) => (
              <option key={g.name} value={g.name}>
                {g.name} ({g.count})
              </option>
            ))}
          </select>
          <div className="mmp-segmented">
            <button
              type="button"
              className={statusFilter === "all" ? "active" : ""}
              onClick={() => setStatusFilter("all")}
            >
              Tất cả
            </button>
            <button
              type="button"
              className={statusFilter === "not-installed" ? "active" : ""}
              onClick={() => setStatusFilter("not-installed")}
            >
              Chưa cài
            </button>
            <button
              type="button"
              className={statusFilter === "installed" ? "active" : ""}
              onClick={() => setStatusFilter("installed")}
            >
              Đã cài
            </button>
          </div>
          <button type="button" className="secondary-button compact-btn" onClick={() => onRefreshAll()}>
            <RefreshCw size={14} /> Làm mới
          </button>
        </div>

        {/* Bulk Result Feedback */}
        {lastResult && (
          <div className="mmp-result-banner">
            <strong>{lastResult.message}</strong>
            <div className="mmp-result-list">
              {lastResult.results.slice(0, 8).map((item) => (
                <span key={item.uid} className={`mmp-result-tag ${item.status}`}>
                  {item.uid}: {item.message}
                </span>
              ))}
              {lastResult.results.length > 8 && (
                <span className="mmp-result-tag">+{lastResult.results.length - 8} profile khác</span>
              )}
            </div>
          </div>
        )}

        {/* Profiles Table with Per-Profile Extension Status Bar */}
        <div className="mmp-table-wrap">
          <table className="mmp-ext-table">
            <thead>
              <tr>
                <th style={{ width: 42 }}>
                  <input
                    type="checkbox"
                    checked={
                      profileRows.length > 0 &&
                      profileRows.every((r) => selectedProfileUids.includes(r.uid))
                    }
                    onChange={selectAllVisible}
                  />
                </th>
                <th>UID / Mã Profile</th>
                <th>Tên tài khoản</th>
                <th>Nhóm</th>
                <th>Trạng thái cài Extension</th>
                <th>Extension đã cài trên Profile</th>
              </tr>
            </thead>
            <tbody>
              {profileRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="mmp-empty-cell">
                    Chưa có profile nào khớp bộ lọc. Hãy thêm profile ở mục <strong>Tài khoản</strong> trước.
                  </td>
                </tr>
              ) : (
                profileRows.map((row) => {
                  const isSelected = selectedProfileUids.includes(row.uid);
                  const percent =
                    row.totalSelectedExt > 0
                      ? Math.round((row.matchedCount / row.totalSelectedExt) * 100)
                      : row.installedCount > 0
                        ? 100
                        : 0;

                  return (
                    <tr
                      key={row.uid}
                      className={isSelected ? "row-selected" : ""}
                      onClick={() => toggleProfile(row.uid)}
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleProfile(row.uid)}
                        />
                      </td>
                      <td className="mono-cell">{row.uid}</td>
                      <td>{row.name}</td>
                      <td>
                        <span className="group-pill">{row.folder}</span>
                      </td>
                      <td style={{ minWidth: 210 }}>
                        <div className="mmp-profile-ext-bar">
                          <div className="mmp-bar-meta">
                            {row.state === "full" ? (
                              <span className="mmp-badge-installed">
                                <Check size={12} />{" "}
                                {row.totalSelectedExt > 0
                                  ? `Đã cài (${row.matchedCount}/${row.totalSelectedExt}) — Tránh trùng`
                                  : `Đã cài ${row.installedCount} ext`}
                              </span>
                            ) : row.state === "partial" ? (
                              <span className="mmp-badge-partial">
                                Cài một phần ({row.matchedCount}/{row.totalSelectedExt})
                              </span>
                            ) : (
                              <span className="mmp-badge-none">Chưa cài</span>
                            )}
                          </div>
                          <div className="mmp-progress-track">
                            <div
                              className={`mmp-progress-fill ${row.state}`}
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td>
                        {row.installedNames.length > 0 ? (
                          <div className="mmp-ext-tags">
                            {row.installedNames.map((name) => (
                              <span key={name} className="mmp-ext-tag">
                                {name}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="muted-text">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* MODAL: UPDATE EXTENSION FROM GITHUB URL (Electron-safe, no window.prompt) */}
      {urlUpdateModal && (
        <div className="modal-backdrop" onClick={() => !busyAction && setUrlUpdateModal(null)}>
          <div className="modal-box wide" onClick={(e) => e.stopPropagation()}>
            <h3>Cập nhật "{urlUpdateModal.ext.name}" từ GitHub (.ZIP)</h3>
            <p className="muted-text" style={{ marginTop: 0, marginBottom: 10 }}>
              Tải trực tiếp bản mới nhất từ link GitHub ZIP và ghi đè tại chỗ (giữ nguyên Extension ID và toàn bộ cài đặt cũ cho mọi profile).
            </p>
            <input
              type="text"
              className="mmp-input full"
              autoFocus
              disabled={Boolean(busyAction)}
              value={urlUpdateModal.url}
              onChange={(e) => setUrlUpdateModal({ ...urlUpdateModal, url: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && handleConfirmUpdateExtUrl()}
              placeholder="https://github.com/.../archive/refs/heads/main.zip"
            />
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={Boolean(busyAction)}
                onClick={() => setUrlUpdateModal(null)}
              >
                Hủy
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={Boolean(busyAction)}
                onClick={handleConfirmUpdateExtUrl}
              >
                <Globe2 size={14} className={busyAction ? "spin" : ""} />
                {busyAction ? "Đang tải từ GitHub..." : "Tải & Cập nhật ngay"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
