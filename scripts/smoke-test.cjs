const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const db = require("../electron/database.cjs");
const { ExtensionService } = require("../electron/extension-service.cjs");

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mmp-smoke-"));
  try {
    const dirs = db.ensureStorageDirs(tmp);
    const dbPath = path.join(tmp, "database.db");
    db.ensureDatabase(dbPath);

    // 1. Groups & TikTok profiles
    db.createAccountGroup(dbPath, "TikTok Nuoi", { storageRoot: tmp });
    db.createAccount(
      dbPath,
      { UID: "tiktok_user_01", Name: "Shop 01", Folder: "TikTok Nuoi", Platform: "TikTok" },
      { storageRoot: tmp, cookiesDir: dirs.cookies },
    );
    db.createAccount(
      dbPath,
      { UID: "tiktok_user_02", Name: "Shop 02", Folder: "TikTok Nuoi", Platform: "TikTok" },
      { storageRoot: tmp, cookiesDir: dirs.cookies },
    );

    // 2. Cookie save & disk sync
    const sampleCookies = JSON.stringify([
      { name: "sessionid", value: "abc123", domain: ".tiktok.com", path: "/", secure: true, httpOnly: true },
    ]);
    db.saveAccountSession(
      dbPath,
      { uid: "tiktok_user_01", status: "Live", cookieHeader: sampleCookies, updateCookie: true, platform: "TikTok" },
      { storageRoot: tmp, cookiesDir: dirs.cookies },
    );
    const diskCookie = db.readCookieFromDisk(dirs.cookies, "tiktok_user_01");
    if (!diskCookie.includes("sessionid")) throw new Error("Cookie disk save/read failed");

    // 3. Read back via sql.js
    const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
    const loaded = await db.readProfileDatabase(dbPath, wasmPath);
    if (loaded.accounts.length !== 2) throw new Error(`Expected 2 accounts, got ${loaded.accounts.length}`);
    if (!loaded.groups.some((g) => g.name === "TikTok Nuoi" && g.count === 2)) {
      throw new Error("Group count mismatch");
    }

    // 4. Bulk Extension install & duplicate skip
    const extSrc = path.join(tmp, "sample-ext");
    fs.mkdirSync(extSrc, { recursive: true });
    fs.writeFileSync(
      path.join(extSrc, "manifest.json"),
      JSON.stringify({ manifest_version: 3, name: "TikTok Helper", version: "1.2.0" }),
    );
    const extSvc = new ExtensionService(() => tmp);
    const added = extSvc.addExtensionFromFolder(extSrc);

    const r1 = extSvc.bulkInstallExtensions({
      extensionIds: [added.extension.id],
      profileUids: ["tiktok_user_01"],
      skipInstalled: true,
    });
    const r2 = extSvc.bulkInstallExtensions({
      extensionIds: [added.extension.id],
      profileUids: ["tiktok_user_01", "tiktok_user_02"],
      skipInstalled: true,
    });
    if (r1.installedCount !== 1 || r1.skippedCount !== 0) {
      throw new Error("First install unexpected result: " + JSON.stringify(r1));
    }
    if (r2.installedCount !== 1 || r2.skippedCount !== 1) {
      throw new Error("Duplicate skip failed: " + JSON.stringify(r2));
    }

    const resolvedPaths = extSvc.getResolvedExtensionPathsForProfile("tiktok_user_01");
    if (resolvedPaths.length !== 1) throw new Error("Resolved extension paths failed");

    // 5. In-place extension update from source (keeps same dirPath & updates version for all profiles)
    fs.writeFileSync(
      path.join(extSrc, "manifest.json"),
      JSON.stringify({ manifest_version: 3, name: "TikTok Helper", version: "1.3.0" }),
    );
    const upd = await extSvc.updateAllExtensionsFromSource();
    if (upd.updatedCount !== 1 || upd.results[0].version !== "1.3.0" || upd.results[0].affectedProfiles !== 2) {
      throw new Error("Extension update failed: " + JSON.stringify(upd));
    }
    const resolvedAfter = extSvc.getResolvedExtensionPathsForProfile("tiktok_user_01");
    if (resolvedAfter[0] !== resolvedPaths[0]) {
      throw new Error("Extension dirPath changed after update (would break Chrome Extension ID)");
    }

    console.log("SMOKE_TEST_PASSED", {
      accounts: loaded.accounts.length,
      groups: loaded.groups.length,
      firstInstall: r1.message,
      secondInstallDuplicateSkip: r2.message,
      extensionUpdate: upd.message,
      resolvedExtensionPaths: resolvedAfter.length,
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("SMOKE_TEST_FAILED:", err);
  process.exit(1);
});
