const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { readCookieFromDisk, safeFileId, saveCookieToDisk } = require("./database.cjs");

const DEFAULT_TIKTOK_URL = "https://www.tiktok.com/";

function clean(value) {
  return value == null ? "" : String(value).trim();
}

function defaultDomainForUrl(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    const parts = host.split(".").filter(Boolean);
    if (parts.length >= 2) return `.${parts.slice(-2).join(".")}`;
    return `.${host}`;
  } catch {
    return ".tiktok.com";
  }
}

function normalizeUrl(rawUrl, fallback = DEFAULT_TIKTOK_URL) {
  const value = clean(rawUrl);
  if (!value) return fallback;
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

function ensureProfileMaximizedPreference(profileDir) {
  try {
    const prefPath = path.join(profileDir, "Default", "Preferences");
    if (fs.existsSync(prefPath)) {
      const prefs = JSON.parse(fs.readFileSync(prefPath, "utf8"));
      if (prefs && typeof prefs === "object") {
        if (!prefs.browser) prefs.browser = {};
        if (!prefs.browser.window_placement) prefs.browser.window_placement = {};
        prefs.browser.window_placement.maximized = true;
        prefs.browser.window_placement.top = 0;
        prefs.browser.window_placement.left = 0;
        fs.writeFileSync(prefPath, JSON.stringify(prefs), "utf8");
      }
    }
  } catch {
    // Non-fatal
  }
}

async function maximizeWindow(context, page) {
  if (!page) return;
  try {
    await page.bringToFront().catch(() => {});
  } catch {}
  try {
    const session = await context.newCDPSession(page);
    const { windowId } = await session.send("Browser.getWindowForTarget");
    if (windowId) {
      await session.send("Browser.setWindowBounds", {
        windowId,
        bounds: { windowState: "maximized" },
      });
    }
    await session.detach().catch(() => {});
  } catch {}
}

function parseProxyConfig(rawProxy) {
  const raw = clean(rawProxy);
  if (!raw) return undefined;
  try {
    if (/^(https?|socks5):\/\//i.test(raw)) {
      const url = new URL(raw);
      return {
        server: `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}`,
        username: url.username ? decodeURIComponent(url.username) : undefined,
        password: url.password ? decodeURIComponent(url.password) : undefined,
      };
    }
    const parts = raw.split(":");
    if (parts.length === 2) {
      return { server: `http://${parts[0]}:${parts[1]}` };
    }
    if (parts.length >= 4) {
      return {
        server: `http://${parts[0]}:${parts[1]}`,
        username: parts[2],
        password: parts.slice(3).join(":"),
      };
    }
  } catch {
    // Ignore malformed proxy
  }
  return undefined;
}

function browserLaunchOptions(profileDir, { headless = false, extensionPaths = [], proxy } = {}) {
  const args = [
    "--start-maximized",
    "--disable-blink-features=AutomationControlled",
    "--disable-infobars",
    "--no-default-browser-check",
    "--no-first-run",
    "--disable-session-crashed-bubble",
    "--hide-crash-restore-bubble",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
  ];

  const validExtensions = (Array.isArray(extensionPaths) ? extensionPaths : []).filter(
    (dir) => dir && fs.existsSync(path.join(dir, "manifest.json")),
  );
  if (validExtensions.length) {
    const joined = validExtensions.join(",");
    args.push(`--disable-extensions-except=${joined}`);
    args.push(`--load-extension=${joined}`);
  }

  const options = {
    userDataDir: profileDir,
    headless: Boolean(headless),
    viewport: null,
    args,
  };
  if (proxy) options.proxy = proxy;
  return options;
}

function normalizeJsonCookie(cookie, fallbackDomain) {
  if (!cookie || typeof cookie !== "object") return null;
  const name = clean(cookie.name);
  const value = cookie.value == null ? "" : String(cookie.value);
  if (!name) return null;
  const normalized = {
    name,
    value,
    domain: clean(cookie.domain) || fallbackDomain || ".tiktok.com",
    path: clean(cookie.path) || "/",
    secure: cookie.secure !== false,
    httpOnly: Boolean(cookie.httpOnly),
  };
  const exp = Number(cookie.expires ?? cookie.expirationDate);
  if (Number.isFinite(exp) && exp > 0) normalized.expires = exp;
  const sameSite = clean(cookie.sameSite);
  if (["Strict", "Lax", "None"].includes(sameSite)) {
    normalized.sameSite = sameSite;
  } else if (/^no_restriction$/i.test(sameSite)) {
    normalized.sameSite = "None";
  } else if (/^lax$/i.test(sameSite)) {
    normalized.sameSite = "Lax";
  } else if (/^strict$/i.test(sameSite)) {
    normalized.sameSite = "Strict";
  }
  return normalized;
}

function parseCookies(rawValue, targetUrl = DEFAULT_TIKTOK_URL) {
  const raw = clean(rawValue);
  if (!raw) throw new Error("Profile chưa có cookie trong database hoặc ổ đĩa.");
  const fallbackDomain = defaultDomainForUrl(targetUrl);

  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      const cookies = Array.isArray(parsed)
        ? parsed.map((c) => normalizeJsonCookie(c, fallbackDomain)).filter(Boolean)
        : [];
      if (cookies.length) return cookies;
    } catch {
      // Fall through to header parsing
    }
  }

  const cookies = [];
  for (const segment of raw.split(";")) {
    const separator = segment.indexOf("=");
    if (separator <= 0) continue;
    const name = segment.slice(0, separator).trim();
    const value = segment.slice(separator + 1).trim();
    if (!name) continue;
    cookies.push({ name, value, domain: fallbackDomain, path: "/", secure: true });
  }
  if (!cookies.length) throw new Error("Không nhận diện được định dạng cookie của profile.");
  return cookies;
}

function base32Decode(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of secret) {
    const value = alphabet.indexOf(character);
    if (value < 0) throw new Error("Mã 2FA không phải Base32 hợp lệ.");
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function extractTotpSecret(rawValue) {
  const raw = clean(rawValue).toUpperCase();
  const groupedSecret = raw.replace(/[\s-]+/g, "");
  if (/^[A-Z2-7]{16,}$/.test(groupedSecret)) return groupedSecret;
  const candidates = raw.split(/[^A-Z2-7]+/).filter((value) => value.length >= 16);
  return candidates.sort((left, right) => right.length - left.length)[0] || "";
}

function generateTotp(rawSecret, timestamp = Date.now()) {
  const secret = extractTotpSecret(rawSecret);
  if (!secret) throw new Error("Profile không có secret 2FA Base32 hợp lệ.");
  const counter = Math.floor(timestamp / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", base32Decode(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}

function generateTotpDetails(rawSecret, timestamp = Date.now()) {
  const seconds = Math.floor(timestamp / 1000);
  return {
    code: generateTotp(rawSecret, timestamp),
    expiresIn: 30 - (seconds % 30),
  };
}

function detectSessionState(cookies, currentUrl) {
  const url = String(currentUrl || "").toLowerCase();
  const names = new Set((cookies || []).filter((c) => c.value).map((c) => c.name));

  const isTikTok = url.includes("tiktok.com") || cookies.some((c) => String(c.domain || "").includes("tiktok.com"));
  if (isTikTok) {
    const loggedIn =
      names.has("sessionid") ||
      names.has("sessionid_ss") ||
      names.has("sid_tt") ||
      names.has("uid_tt");
    return {
      platform: "TikTok",
      loggedIn,
      statusLabel: loggedIn ? "Live" : "Chưa login",
    };
  }

  const isFacebook = url.includes("facebook.com") || cookies.some((c) => String(c.domain || "").includes("facebook.com"));
  if (isFacebook) {
    const loggedIn = names.has("c_user") && names.has("xs");
    return {
      platform: "Facebook",
      loggedIn,
      statusLabel: loggedIn ? "Live" : "Chưa login",
    };
  }

  return {
    platform: "Web",
    loggedIn: cookies.length > 0,
    statusLabel: cookies.length > 0 ? "Live" : "Chưa login",
  };
}

class BrowserService {
  constructor(app, { getStorageRoot, extensionService }) {
    this.app = app;
    this.getStorageRoot = getStorageRoot;
    this.extensionService = extensionService;
    this.modulePromise = null;
    this.sessions = new Map();
  }

  async module() {
    if (!this.modulePromise) this.modulePromise = import("cloakbrowser");
    return this.modulePromise;
  }

  profilesRoot() {
    const dir = path.join(this.getStorageRoot(), "profiles");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  cookiesRoot() {
    const dir = path.join(this.getStorageRoot(), "cookies");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  profilePath(uid) {
    const id = safeFileId(uid);
    if (!id) throw new Error("Profile không có UID hợp lệ.");
    return path.join(this.profilesRoot(), id);
  }

  getOpenUids() {
    return [...this.sessions.keys()];
  }

  async status() {
    const cloak = await this.module();
    const info = typeof cloak.binaryInfo === "function" ? cloak.binaryInfo() : null;
    let wrapperVersion = "";
    try {
      wrapperVersion = clean(require("../package.json").dependencies?.cloakbrowser);
    } catch {}
    return {
      available: true,
      installed: Boolean(info?.installed || info?.path || info?.binaryPath),
      version: clean(info?.version || info?.browserVersion),
      tier: clean(info?.tier || "free"),
      wrapperVersion,
    };
  }

  async setup() {
    const cloak = await this.module();
    if (typeof cloak.ensureBinary !== "function") throw new Error("CloakBrowser không hỗ trợ ensureBinary.");
    await cloak.ensureBinary();
    return this.status();
  }

  async update() {
    const cloak = await this.module();
    const before = await this.status();
    let reportedVersion = null;
    if (before.tier === "pro") {
      if (typeof cloak.ensureBinary !== "function") throw new Error("CloakBrowser không hỗ trợ cập nhật binary Pro.");
      const previousAutoUpdate = process.env.CLOAKBROWSER_AUTO_UPDATE;
      process.env.CLOAKBROWSER_AUTO_UPDATE = "true";
      try {
        await cloak.ensureBinary();
      } finally {
        if (previousAutoUpdate == null) delete process.env.CLOAKBROWSER_AUTO_UPDATE;
        else process.env.CLOAKBROWSER_AUTO_UPDATE = previousAutoUpdate;
      }
    } else {
      if (typeof cloak.checkForUpdate !== "function") throw new Error("CloakBrowser không hỗ trợ kiểm tra cập nhật.");
      reportedVersion = await cloak.checkForUpdate();
    }
    const after = await this.status();
    const updated = Boolean(reportedVersion || (before.version && after.version && before.version !== after.version));
    return {
      ...after,
      previousVersion: before.version,
      updated,
      message: updated
        ? `Đã cập nhật CloakBrowser từ ${before.version || "bản cũ"} lên ${after.version || reportedVersion}.`
        : `Không tìm thấy bản mới; CloakBrowser ${after.version || "hiện tại"} được giữ nguyên.`,
    };
  }

  async launch(account, mode = "open", defaultStartUrl = DEFAULT_TIKTOK_URL, overrideUrl = "") {
    if (!account || typeof account !== "object") throw new Error("Dữ liệu profile không hợp lệ.");
    if (!["open", "cookie"].includes(mode)) throw new Error("Chế độ mở trình duyệt không hợp lệ.");
    const uid = clean(account.UID);
    if (!uid) throw new Error("Profile không có UID hợp lệ.");

    const cleanOverride = clean(overrideUrl);
    const targetUrl = cleanOverride
      ? normalizeUrl(cleanOverride, DEFAULT_TIKTOK_URL)
      : normalizeUrl(account.StartUrl, normalizeUrl(defaultStartUrl, DEFAULT_TIKTOK_URL));

    const existing = this.sessions.get(uid);
    if (existing) {
      const page = existing.pages()[0] || (await existing.newPage());
      await maximizeWindow(existing, page);
      if (cleanOverride) {
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => {});
        return {
          uid,
          mode,
          state: "already-open",
          message: `Profile đang mở — đã chuyển sang ${targetUrl}.`,
        };
      }
      return {
        uid,
        mode,
        state: "already-open",
        message: "Profile này đang mở. Đã đưa cửa sổ lên trước.",
      };
    }

    let cookiesToInject = null;
    if (mode === "cookie") {
      const diskCookie = readCookieFromDisk(this.cookiesRoot(), uid);
      const rawCookie = clean(account.Cookie || account.Cookie_2) || diskCookie;
      cookiesToInject = parseCookies(rawCookie, targetUrl);
    }

    const cloak = await this.module();
    const profileDir = this.profilePath(uid);
    fs.mkdirSync(profileDir, { recursive: true });
    ensureProfileMaximizedPreference(profileDir);

    const extensionPaths = this.extensionService
      ? this.extensionService.getResolvedExtensionPathsForProfile(uid)
      : [];
    const proxy = parseProxyConfig(account.Proxy);
    const options = browserLaunchOptions(profileDir, {
      headless: false,
      extensionPaths,
      proxy,
    });

    const context = await cloak.launchPersistentContext(options);
    this.sessions.set(uid, context);
    context.on("close", () => this.sessions.delete(uid));

    try {
      const page = context.pages()[0] || (await context.newPage());
      await maximizeWindow(context, page);

      if (mode === "cookie" && cookiesToInject && cookiesToInject.length) {
        await context.addCookies(cookiesToInject);
      }

      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => {});
      const currentCookies = await context.cookies().catch(() => []);
      const session = detectSessionState(currentCookies, page.url());
      const extNote = extensionPaths.length ? ` • ${extensionPaths.length} extension` : "";

      return {
        uid,
        mode,
        state: session.loggedIn ? "logged-in" : "attention",
        loadedExtensions: extensionPaths.length,
        message:
          mode === "cookie"
            ? `Đã nạp ${cookiesToInject?.length || 0} cookie và mở ${targetUrl}${extNote}.`
            : `Đã mở profile "${uid}" tại ${targetUrl}${extNote}.`,
      };
    } catch (error) {
      await context.close().catch(() => {});
      this.sessions.delete(uid);
      throw error;
    }
  }

  async saveCookies(uid) {
    const key = clean(uid);
    if (!key) throw new Error("Thiếu UID profile.");
    const context = this.sessions.get(key);
    if (!context) {
      throw new Error("Profile chưa mở. Hãy mở profile và đăng nhập trước khi lưu cookie.");
    }

    const page = context.pages()[0];
    const currentUrl = page ? page.url() : DEFAULT_TIKTOK_URL;
    const allCookies = await context.cookies();
    if (!allCookies.length) {
      throw new Error("Không tìm thấy cookie nào trong phiên trình duyệt hiện tại.");
    }

    const session = detectSessionState(allCookies, currentUrl);
    // Prioritize cookies of the active platform if TikTok/Facebook, otherwise keep all
    let selectedCookies = allCookies;
    if (session.platform === "TikTok") {
      const tt = allCookies.filter((c) => String(c.domain || "").toLowerCase().includes("tiktok"));
      if (tt.length) selectedCookies = tt;
    } else if (session.platform === "Facebook") {
      const fb = allCookies.filter((c) => String(c.domain || "").toLowerCase().includes("facebook"));
      if (fb.length) selectedCookies = fb;
    }

    const serialized = JSON.stringify(selectedCookies);
    const fileSaved = saveCookieToDisk(this.cookiesRoot(), key, serialized, {
      status: session.statusLabel,
      platform: session.platform,
      url: currentUrl,
      count: selectedCookies.length,
    });

    return {
      uid: key,
      state: session.loggedIn ? "live" : "attention",
      statusLabel: session.statusLabel,
      platform: session.platform,
      cookieCount: selectedCookies.length,
      cookieJson: serialized,
      fileSaved,
      message: session.loggedIn
        ? `Đã lưu ${selectedCookies.length} cookie (${session.platform} — Live).`
        : `Đã lưu ${selectedCookies.length} cookie (${session.platform} — Chưa thấy phiên đăng nhập).`,
    };
  }

  async close(uid) {
    const key = clean(uid);
    const context = this.sessions.get(key);
    if (!context) return { closed: false };
    this.sessions.delete(key);
    await context.close().catch(() => {});
    return { closed: true };
  }

  async closeAll() {
    const entries = [...this.sessions.entries()];
    this.sessions.clear();
    await Promise.allSettled(entries.map(([, ctx]) => ctx.close()));
  }
}

module.exports = {
  BrowserService,
  DEFAULT_TIKTOK_URL,
  generateTotpDetails,
};
