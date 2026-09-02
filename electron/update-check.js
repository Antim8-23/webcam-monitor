const https = require("https");
const { URL } = require("url");

const LATEST_JSON_URL =
  "https://jati-digital.de/downloads/webcam-monitor/latest.json";
const ALLOWED_HOST = "jati-digital.de";
const DOWNLOAD_PATH_PREFIX =
  "https://jati-digital.de/downloads/webcam-monitor/";
const MAX_RESPONSE_BYTES = 100 * 1024;
const REQUEST_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;

const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

function parseSemVer(version) {
  if (typeof version !== "string") {
    return null;
  }
  const match = SEMVER_PATTERN.exec(version.trim());
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemVer(a, b) {
  const parsedA = parseSemVer(a);
  const parsedB = parseSemVer(b);
  if (!parsedA || !parsedB) {
    throw new Error("Invalid semver");
  }
  for (let i = 0; i < 3; i += 1) {
    if (parsedA[i] > parsedB[i]) {
      return 1;
    }
    if (parsedA[i] < parsedB[i]) {
      return -1;
    }
  }
  return 0;
}

function isSemVerGreater(latest, current) {
  return compareSemVer(latest, current) > 0;
}

function isAllowedHost(hostname) {
  return hostname.toLowerCase() === ALLOWED_HOST;
}

function isAllowedDownloadUrl(urlString) {
  try {
    const url = new URL(urlString);
    if (url.protocol !== "https:") {
      return false;
    }
    if (!isAllowedHost(url.hostname)) {
      return false;
    }
    return url.href.startsWith(DOWNLOAD_PATH_PREFIX);
  } catch {
    return false;
  }
}

function fetchUrl(urlString, redirectsLeft) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(urlString);
    } catch {
      reject(new Error("Invalid URL"));
      return;
    }

    if (url.protocol !== "https:") {
      reject(new Error("Only HTTPS is allowed"));
      return;
    }
    if (!isAllowedHost(url.hostname)) {
      reject(new Error("Unexpected host"));
      return;
    }

    const req = https.request(
      {
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "WebcamMonitor-UpdateCheck",
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        if (
          [301, 302, 307, 308].includes(res.statusCode) &&
          res.headers.location
        ) {
          res.resume();
          if (redirectsLeft <= 0) {
            reject(new Error("Too many redirects"));
            return;
          }
          let redirectUrl;
          try {
            redirectUrl = new URL(res.headers.location, urlString);
          } catch {
            reject(new Error("Invalid redirect URL"));
            return;
          }
          if (redirectUrl.protocol !== "https:") {
            reject(new Error("Redirect to non-HTTPS URL"));
            return;
          }
          if (!isAllowedHost(redirectUrl.hostname)) {
            reject(new Error("Redirect to foreign host"));
            return;
          }
          fetchUrl(redirectUrl.href, redirectsLeft - 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        const chunks = [];
        let totalBytes = 0;

        res.on("data", (chunk) => {
          totalBytes += chunk.length;
          if (totalBytes > MAX_RESPONSE_BYTES) {
            req.destroy();
            reject(new Error("Response too large"));
            return;
          }
          chunks.push(chunk);
        });

        res.on("end", () => {
          resolve(Buffer.concat(chunks).toString("utf8"));
        });
      }
    );

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
    req.on("error", reject);
    req.end();
  });
}

function fetchLatestJson() {
  return fetchUrl(LATEST_JSON_URL, MAX_REDIRECTS);
}

function validateLatestJson(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Invalid JSON root");
  }

  if (data.schemaVersion !== 1) {
    throw new Error("Invalid schemaVersion");
  }
  if (data.app !== "Webcam Monitor") {
    throw new Error("Invalid app name");
  }
  if (data.channel !== "stable") {
    throw new Error("Invalid channel");
  }
  if (!parseSemVer(data.version)) {
    throw new Error("Invalid version");
  }
  if (
    typeof data.releaseDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(data.releaseDate)
  ) {
    throw new Error("Invalid releaseDate");
  }

  const portable = data.portable;
  if (!portable || typeof portable !== "object") {
    throw new Error("Missing portable metadata");
  }
  if (typeof portable.url !== "string" || !isAllowedDownloadUrl(portable.url)) {
    throw new Error("Invalid portable.url");
  }
  const expectedPortableName = `WebcamMonitor-portable-v${data.version}.exe`;
  if (portable.fileName !== expectedPortableName) {
    throw new Error("portable.fileName does not match version");
  }
  if (
    typeof portable.size !== "number" ||
    !Number.isFinite(portable.size) ||
    portable.size <= 0
  ) {
    throw new Error("Invalid portable.size");
  }
  if (
    typeof portable.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(portable.sha256)
  ) {
    throw new Error("Invalid portable.sha256");
  }

  let releaseNotes = "";
  if (data.releaseNotes !== undefined && data.releaseNotes !== null) {
    if (typeof data.releaseNotes !== "string") {
      throw new Error("Invalid releaseNotes");
    }
    releaseNotes = data.releaseNotes;
  }

  return {
    version: data.version,
    releaseDate: data.releaseDate,
    downloadUrl: portable.url,
    releaseNotes,
  };
}

function createNoUpdateResult(currentVersion) {
  return {
    currentVersion,
    latestVersion: currentVersion,
    updateAvailable: false,
    downloadUrl: null,
    releaseNotes: "",
    releaseDate: "",
  };
}

async function checkForUpdates(currentVersion) {
  if (!parseSemVer(currentVersion)) {
    console.warn("Update check skipped: invalid current version");
    return createNoUpdateResult(String(currentVersion || ""));
  }

  try {
    const body = await fetchLatestJson();
    const parsed = JSON.parse(body);
    const validated = validateLatestJson(parsed);
    const updateAvailable = isSemVerGreater(
      validated.version,
      currentVersion
    );

    return {
      currentVersion,
      latestVersion: validated.version,
      updateAvailable,
      downloadUrl: updateAvailable ? validated.downloadUrl : null,
      releaseNotes: validated.releaseNotes,
      releaseDate: validated.releaseDate,
    };
  } catch (error) {
    console.warn("Update check failed:", error.message);
    return createNoUpdateResult(currentVersion);
  }
}

module.exports = {
  LATEST_JSON_URL,
  DOWNLOAD_PATH_PREFIX,
  parseSemVer,
  compareSemVer,
  isSemVerGreater,
  isAllowedDownloadUrl,
  validateLatestJson,
  checkForUpdates,
};
