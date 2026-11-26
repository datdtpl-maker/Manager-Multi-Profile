const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { safeFileId } = require("./database.cjs");

function clean(value) {
  return value == null ? "" : String(value).trim();
}

function findManifestRoot(dirPath, maxDepth = 3) {
  const direct = path.join(dirPath, "manifest.json");
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) {
    return dirPath;
  }
  if (maxDepth <= 0) return null;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || entry.name === "__MACOSX") continue;
    const found = findManifestRoot(path.join(dirPath, entry.name), maxDepth - 1);
    if (found) return found;
  }
  return null;
}

function readManifestMeta(extensionDir) {
  const manifestPath = path.join(extensionDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error("Thư mục không chứa file manifest.json hợp lệ của Chrome Extension.");
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("Không thể đọc file manifest.json (JSON không hợp lệ).");
  }
  let name = clean(manifest.name);
  let description = clean(manifest.description);

  // Resolve __MSG_*__ i18n keys if present
  if (name.startsWith("__MSG_") || description.startsWith("__MSG_")) {
    const localeCandidates = [manifest.default_locale, "en", "en_US", "vi"].filter(Boolean);
    for (const locale of localeCandidates) {
      const msgPath = path.join(extensionDir, "_locales", locale, "messages.json");
      if (fs.existsSync(msgPath)) {
        try {
          const messages = JSON.parse(fs.readFileSync(msgPath, "utf8").replace(/^\uFEFF/, ""));
          const resolveKey = (raw) => {
            const match = raw.match(/^__MSG_(.+)__$/);
            if (!match) return raw;
            const entry = messages[match[1]] || messages[match[1].toLowerCase()];
            return clean(entry?.message) || raw;
          };
          name = resolveKey(name);
          description = resolveKey(description);
          break;
        } catch {
          // Ignore malformed locale file
        }
      }
    }
  }

  return {
    name: name || path.basename(extensionDir),
    version: clean(manifest.version) || "1.0.0",
    description,
    manifestVersion: Number(manifest.manifest_version) || 3,
  };
}

class ExtensionService {
  constructor(getStorageRoot) {
    this.getStorageRoot = getStorageRoot;
  }

  extensionsRoot() {
    const dir = path.join(this.getStorageRoot(), "extensions");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  libraryDir() {
    const dir = path.join(this.extensionsRoot(), "lib");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  registryPath() {
    return path.join(this.extensionsRoot(), "registry.json");
  }

  profilesRoot() {
    const dir = path.join(this.getStorageRoot(), "profiles");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  loadRegistry() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.registryPath(), "utf8"));
      return {
        extensions: Array.isArray(parsed?.extensions) ? parsed.extensions : [],
        profileMap: parsed?.profileMap && typeof parsed.profileMap === "object" ? parsed.profileMap : {},
      };
    } catch {
      return { extensions: [], profileMap: {} };
    }
  }

  saveRegistry(registry) {
    fs.mkdirSync(this.extensionsRoot(), { recursive: true });
    fs.writeFileSync(this.registryPath(), JSON.stringify(registry, null, 2), "utf8");
  }

  listExtensions() {
    const registry = this.loadRegistry();
    return registry.extensions.map((ext) => {
      const exists = Boolean(ext.dirPath && fs.existsSync(path.join(ext.dirPath, "manifest.json")));
      let installedProfileCount = 0;
      for (const records of Object.values(registry.profileMap)) {
        if (Array.isArray(records) && records.some((item) => item.extensionId === ext.id)) {
          installedProfileCount += 1;
        }
      }
      return {
        ...ext,
        exists,
        installedProfileCount,
      };
    });
  }

  getProfileExtensionsMap() {
    const registry = this.loadRegistry();
    const validIds = new Set(
      registry.extensions
        .filter((ext) => ext.dirPath && fs.existsSync(path.join(ext.dirPath, "manifest.json")))
        .map((ext) => ext.id),
    );
    const result = {};
    for (const [uid, records] of Object.entries(registry.profileMap)) {
      if (!Array.isArray(records)) continue;
      result[uid] = records.map((item) => ({
        extensionId: item.extensionId,
        installedAt: item.installedAt || "",
        status: validIds.has(item.extensionId) ? "installed" : "missing",
      }));
    }
    return result;
  }

  getResolvedExtensionPathsForProfile(uid) {
    const key = clean(uid);
    if (!key) return [];
    const registry = this.loadRegistry();
    const records = registry.profileMap[key];
    if (!Array.isArray(records) || !records.length) return [];

    const byId = new Map(registry.extensions.map((ext) => [ext.id, ext]));
    const paths = [];
    for (const record of records) {
      const ext = byId.get(record.extensionId);
      if (ext?.dirPath && fs.existsSync(path.join(ext.dirPath, "manifest.json"))) {
        paths.push(ext.dirPath);
      }
    }
    return [...new Set(paths)];
  }

  addExtensionFromFolder(folderPath) {
    const resolved = path.resolve(folderPath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error("Thư mục extension không tồn tại.");
    }
    const manifestRoot = findManifestRoot(resolved, 2);
    if (!manifestRoot) {
      throw new Error("Không tìm thấy file manifest.json trong thư mục đã chọn.");
    }
    const meta = readManifestMeta(manifestRoot);
    const slug = safeFileId(meta.name).toLowerCase() || "extension";
    const id = `${slug}-${crypto.randomBytes(4).toString("hex")}`;
    const destDir = path.join(this.libraryDir(), id);

    fs.cpSync(manifestRoot, destDir, { recursive: true, force: true });

    const registry = this.loadRegistry();
    const entry = {
      id,
      name: meta.name,
      version: meta.version,
      description: meta.description,
      manifestVersion: meta.manifestVersion,
      dirPath: destDir,
      sourcePath: resolved,
      addedAt: new Date().toISOString(),
    };
    registry.extensions.unshift(entry);
    this.saveRegistry(registry);

    return {
      extension: { ...entry, exists: true, installedProfileCount: 0 },
      message: `Đã thêm extension "${meta.name}" (v${meta.version}) vào kho.`,
    };
  }

  addExtensionFromZip(zipPath) {
    const resolved = path.resolve(zipPath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      throw new Error("File .zip extension không tồn tại.");
    }
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mmp-ext-"));
    try {
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Expand-Archive -LiteralPath '${resolved.replaceAll("'", "''")}' -DestinationPath '${tempDir.replaceAll("'", "''")}' -Force`,
        ],
        { windowsHide: true, timeout: 60_000 },
      );
      const manifestRoot = findManifestRoot(tempDir, 3);
      if (!manifestRoot) {
        throw new Error("File .zip không chứa manifest.json hợp lệ của Chrome Extension.");
      }
      const added = this.addExtensionFromFolder(manifestRoot);
      // Update sourcePath to the original zip file
      const registry = this.loadRegistry();
      const target = registry.extensions.find((ext) => ext.id === added.extension.id);
      if (target) {
        target.sourcePath = resolved;
        this.saveRegistry(registry);
      }
      return {
        ...added,
        extension: { ...added.extension, sourcePath: resolved },
      };
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore temp cleanup failure
      }
    }
  }

  removeExtension(extensionId) {
    const id = clean(extensionId);
    if (!id) throw new Error("Thiếu ID extension để xóa.");
    const registry = this.loadRegistry();
    const index = registry.extensions.findIndex((ext) => ext.id === id);
    if (index < 0) throw new Error("Không tìm thấy extension trong kho.");

    const [removed] = registry.extensions.splice(index, 1);
    for (const uid of Object.keys(registry.profileMap)) {
      const list = registry.profileMap[uid];
      if (!Array.isArray(list)) continue;
      registry.profileMap[uid] = list.filter((item) => item.extensionId !== id);
      if (!registry.profileMap[uid].length) delete registry.profileMap[uid];
    }
    this.saveRegistry(registry);

    if (removed?.dirPath && removed.dirPath.startsWith(this.libraryDir())) {
      try {
        fs.rmSync(removed.dirPath, { recursive: true, force: true });
      } catch {
        // Ignore disk cleanup error
      }
    }

    return { removed: true, id, message: `Đã xóa extension "${removed.name}" khỏi kho.` };
  }

  applyUpdateFiles(registry, ext, manifestRoot, newSourcePath) {
    const previousVersion = ext.version || "";
    const meta = readManifestMeta(manifestRoot);

    fs.mkdirSync(ext.dirPath, { recursive: true });
    // Remove old files that might no longer exist (ignore locked files safely)
    try {
      for (const entry of fs.readdirSync(ext.dirPath)) {
        try {
          fs.rmSync(path.join(ext.dirPath, entry), { recursive: true, force: true });
        } catch {
          // Ignore if browser holds a lock on a file; cpSync below will overwrite what it can
        }
      }
    } catch {
      // Ignore
    }

    fs.cpSync(manifestRoot, ext.dirPath, { recursive: true, force: true });

    ext.name = meta.name;
    ext.version = meta.version;
    ext.description = meta.description;
    ext.manifestVersion = meta.manifestVersion;
    if (newSourcePath) ext.sourcePath = newSourcePath;
    ext.updatedAt = new Date().toISOString();

    const byId = new Map(registry.extensions.map((item) => [item.id, item]));
    let affectedProfiles = 0;
    for (const [uid, records] of Object.entries(registry.profileMap)) {
      if (Array.isArray(records) && records.some((r) => r.extensionId === ext.id)) {
        affectedProfiles += 1;
        this.syncProfileMarker(uid, records, byId);
      }
    }

    this.saveRegistry(registry);

    const versionChanged = previousVersion !== meta.version;
    const versionText = versionChanged ? `v${previousVersion} → v${meta.version}` : `v${meta.version} (đã đồng bộ code mới nhất)`;
    return {
      id: ext.id,
      name: ext.name,
      previousVersion,
      version: ext.version,
      versionChanged,
      affectedProfiles,
      message: `Đã cập nhật "${ext.name}" (${versionText}) cho ${affectedProfiles} profile.`,
    };
  }

  updateExtensionFromFolder(extensionId, folderPath) {
    const id = clean(extensionId);
    const resolved = path.resolve(folderPath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error("Thư mục extension nguồn không tồn tại.");
    }
    const manifestRoot = findManifestRoot(resolved, 2);
    if (!manifestRoot) {
      throw new Error("Không tìm thấy file manifest.json trong thư mục đã chọn.");
    }
    const registry = this.loadRegistry();
    const ext = registry.extensions.find((item) => item.id === id);
    if (!ext) throw new Error("Không tìm thấy extension trong kho.");
    return this.applyUpdateFiles(registry, ext, manifestRoot, resolved);
  }

  updateExtensionFromZip(extensionId, zipPath) {
    const id = clean(extensionId);
    const resolved = path.resolve(zipPath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      throw new Error("File .zip extension nguồn không tồn tại.");
    }
    const registry = this.loadRegistry();
    const ext = registry.extensions.find((item) => item.id === id);
    if (!ext) throw new Error("Không tìm thấy extension trong kho.");

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mmp-ext-upd-"));
    try {
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Expand-Archive -LiteralPath '${resolved.replaceAll("'", "''")}' -DestinationPath '${tempDir.replaceAll("'", "''")}' -Force`,
        ],
        { windowsHide: true, timeout: 60_000 },
      );
      const manifestRoot = findManifestRoot(tempDir, 3);
      if (!manifestRoot) {
        throw new Error("File .zip không chứa manifest.json hợp lệ của Chrome Extension.");
      }
      return this.applyUpdateFiles(registry, ext, manifestRoot, resolved);
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    }
  }

  async updateExtensionFromSource(extensionId) {
    const id = clean(extensionId);
    const registry = this.loadRegistry();
    const ext = registry.extensions.find((item) => item.id === id);
    if (!ext) throw new Error("Không tìm thấy extension trong kho.");
    const src = clean(ext.sourcePath);
    const remoteUrl = clean(ext.remoteZipUrl);

    // Ưu tiên kéo từ remoteZipUrl nếu đã lưu link GitHub và không có thư mục source code local
    if (remoteUrl && (!src || !fs.existsSync(src) || !fs.statSync(src).isDirectory())) {
      return this.updateExtensionFromUrl(id, remoteUrl);
    }

    if (!src || !fs.existsSync(src)) {
      if (remoteUrl) return this.updateExtensionFromUrl(id, remoteUrl);
      throw new Error(`Không tìm thấy nguồn gốc của "${ext.name}" (${src || "trống"}). Hãy bấm nút "GitHub" hoặc chọn thư mục/.ZIP bản mới.`);
    }
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      return this.updateExtensionFromFolder(id, src);
    }
    if (stat.isFile() && src.toLowerCase().endsWith(".zip")) {
      return this.updateExtensionFromZip(id, src);
    }
    throw new Error(`Nguồn gốc "${src}" không phải thư mục hoặc file .zip hợp lệ.`);
  }

  async updateExtensionFromUrl(extensionId, zipUrlRaw) {
    const id = clean(extensionId);
    const zipUrl = clean(zipUrlRaw);
    if (!/^https?:\/\//i.test(zipUrl)) {
      throw new Error("URL tải file .zip không hợp lệ (phải bắt đầu bằng http:// hoặc https://).");
    }
    const registryBefore = this.loadRegistry();
    const existing = registryBefore.extensions.find((item) => item.id === id);
    if (!existing) throw new Error("Không tìm thấy extension trong kho.");
    const prevSourcePath = existing.sourcePath;

    const resp = await fetch(zipUrl, { redirect: "follow" });
    if (!resp.ok) {
      throw new Error(`Không tải được file .zip từ URL (HTTP ${resp.status}).`);
    }
    const buffer = Buffer.from(await resp.arrayBuffer());
    if (buffer.length < 100) {
      throw new Error("File tải về quá nhỏ hoặc không phải file .zip hợp lệ.");
    }

    const tempZip = path.join(os.tmpdir(), `mmp-remote-ext-${Date.now()}.zip`);
    try {
      fs.writeFileSync(tempZip, buffer);
      const res = this.updateExtensionFromZip(id, tempZip);
      // Keep original local sourcePath if it existed, and save remoteZipUrl for future 1-click remote updates
      const registryAfter = this.loadRegistry();
      const target = registryAfter.extensions.find((item) => item.id === id);
      if (target) {
        target.remoteZipUrl = zipUrl;
        if (prevSourcePath && prevSourcePath !== tempZip) {
          target.sourcePath = prevSourcePath;
        }
        this.saveRegistry(registryAfter);
      }
      return res;
    } finally {
      try {
        fs.rmSync(tempZip, { force: true });
      } catch {}
    }
  }

  async updateAllExtensionsFromSource() {
    const registry = this.loadRegistry();
    if (!registry.extensions.length) {
      throw new Error("Chưa có extension nào trong kho để cập nhật.");
    }
    const results = [];
    const errors = [];
    for (const ext of registry.extensions) {
      try {
        const res = await this.updateExtensionFromSource(ext.id);
        results.push(res);
      } catch (err) {
        errors.push({
          id: ext.id,
          name: ext.name,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const updatedCount = results.length;
    const totalAffected = results.reduce((sum, item) => sum + (item.affectedProfiles || 0), 0);
    const summaryParts = results.map((r) => `${r.name} (${r.versionChanged ? `v${r.previousVersion}→v${r.version}` : `v${r.version}`})`);
    return {
      updatedCount,
      errorCount: errors.length,
      totalAffected,
      results,
      errors,
      message:
        updatedCount > 0
          ? `Đã cập nhật ${updatedCount} extension: ${summaryParts.join(", ")}${errors.length ? ` (${errors.length} lỗi)` : ""}. Mở lại profile đang chạy (nếu có) để áp dụng bản mới.`
          : `Không cập nhật được extension nào (${errors[0]?.message || "thiếu nguồn gốc"}).`,
    };
  }

  syncProfileMarker(uid, records, byId) {
    try {
      const profileDir = path.join(this.profilesRoot(), safeFileId(uid));
      fs.mkdirSync(profileDir, { recursive: true });
      const markerPath = path.join(profileDir, "mmp-extensions.json");
      const payload = {
        uid,
        updatedAt: new Date().toISOString(),
        extensions: records.map((rec) => {
          const ext = byId.get(rec.extensionId);
          return {
            id: rec.extensionId,
            name: ext?.name || rec.extensionId,
            version: ext?.version || "",
            dirPath: ext?.dirPath || "",
            installedAt: rec.installedAt,
          };
        }),
      };
      fs.writeFileSync(markerPath, JSON.stringify(payload, null, 2), "utf8");
    } catch {
      // Non-fatal marker sync error
    }
  }

  bulkInstallExtensions({ extensionIds, profileUids, skipInstalled = true }) {
    const extIds = [...new Set((Array.isArray(extensionIds) ? extensionIds : []).map(clean).filter(Boolean))];
    const uids = [...new Set((Array.isArray(profileUids) ? profileUids : []).map(clean).filter(Boolean))];
    if (!extIds.length) throw new Error("Vui lòng chọn ít nhất 1 extension để cài đặt.");
    if (!uids.length) throw new Error("Vui lòng chọn ít nhất 1 profile để cài extension.");

    const registry = this.loadRegistry();
    const byId = new Map(registry.extensions.map((ext) => [ext.id, ext]));

    const validExtIds = [];
    for (const id of extIds) {
      const ext = byId.get(id);
      if (!ext || !fs.existsSync(path.join(ext.dirPath, "manifest.json"))) {
        throw new Error(`Extension "${ext?.name || id}" bị thiếu file manifest.json trên ổ đĩa.`);
      }
      validExtIds.push(id);
    }

    const now = new Date().toISOString();
    let installedCount = 0;
    let skippedCount = 0;
    const results = [];

    for (const uid of uids) {
      const currentList = Array.isArray(registry.profileMap[uid]) ? [...registry.profileMap[uid]] : [];
      const existingIds = new Set(currentList.map((item) => item.extensionId));
      const newlyAddedNames = [];
      const skippedNames = [];

      for (const extId of validExtIds) {
        const ext = byId.get(extId);
        if (existingIds.has(extId)) {
          if (skipInstalled) {
            skippedCount += 1;
            skippedNames.push(ext.name);
            continue;
          }
          const idx = currentList.findIndex((item) => item.extensionId === extId);
          if (idx >= 0) currentList[idx] = { extensionId: extId, installedAt: now };
          installedCount += 1;
          newlyAddedNames.push(ext.name);
        } else {
          currentList.push({ extensionId: extId, installedAt: now });
          existingIds.add(extId);
          installedCount += 1;
          newlyAddedNames.push(ext.name);
        }
      }

      registry.profileMap[uid] = currentList;
      this.syncProfileMarker(uid, currentList, byId);

      const status =
        newlyAddedNames.length > 0 && skippedNames.length > 0
          ? "partial"
          : newlyAddedNames.length > 0
            ? "installed"
            : "skipped";

      const parts = [];
      if (newlyAddedNames.length) parts.push(`Cài mới: ${newlyAddedNames.join(", ")}`);
      if (skippedNames.length) parts.push(`Bỏ qua (đã cài): ${skippedNames.join(", ")}`);

      results.push({
        uid,
        status,
        installedNames: newlyAddedNames,
        skippedNames,
        message: parts.join(" | "),
      });
    }

    this.saveRegistry(registry);

    return {
      installedCount,
      skippedCount,
      totalProfiles: uids.length,
      results,
      message: `Hoàn tất: cài mới ${installedCount} lượt, bỏ qua ${skippedCount} lượt đã cài trùng trên ${uids.length} profile.`,
    };
  }

  bulkUninstallExtensions({ extensionIds, profileUids }) {
    const extIds = new Set((Array.isArray(extensionIds) ? extensionIds : []).map(clean).filter(Boolean));
    const uids = [...new Set((Array.isArray(profileUids) ? profileUids : []).map(clean).filter(Boolean))];
    if (!extIds.size) throw new Error("Vui lòng chọn ít nhất 1 extension để gỡ.");
    if (!uids.length) throw new Error("Vui lòng chọn ít nhất 1 profile để gỡ extension.");

    const registry = this.loadRegistry();
    const byId = new Map(registry.extensions.map((ext) => [ext.id, ext]));
    let removedCount = 0;

    for (const uid of uids) {
      const currentList = Array.isArray(registry.profileMap[uid]) ? registry.profileMap[uid] : [];
      const nextList = currentList.filter((item) => {
        if (extIds.has(item.extensionId)) {
          removedCount += 1;
          return false;
        }
        return true;
      });
      if (nextList.length) registry.profileMap[uid] = nextList;
      else delete registry.profileMap[uid];
      this.syncProfileMarker(uid, nextList, byId);
    }

    this.saveRegistry(registry);
    return {
      removedCount,
      totalProfiles: uids.length,
      message: `Đã gỡ ${removedCount} lượt extension trên ${uids.length} profile.`,
    };
  }
}

module.exports = { ExtensionService };
