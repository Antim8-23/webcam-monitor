const https = require("https");
const crypto = require("crypto");
const fs = require("fs");
const { URL } = require("url");

const LATEST_JSON_URL =
  "https://jati-digital.de/downloads/webcam-monitor/latest.json";
const ALLOWED_HOST = "jati-digital.de";
const DOWNLOAD_PATH_PREFIX =
  "https://jati-digital.de/downloads/webcam-monitor/";
const MAX_RESPONSE_BYTES = 100 * 1024;
const MAX_UPDATE_FILE_BYTES = 1024 * 1024 * 1024;
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

function validateReleaseFile(file, version, kind) {
  if (!file || typeof file !== "object") {
    throw new Error(`Missing ${kind} metadata`);
  }
  if (typeof file.url !== "string" || !isAllowedDownloadUrl(file.url)) {
    throw new Error(`Invalid ${kind}.url`);
  }
  const expectedFileName = `WebcamMonitor-${kind}-v${version}.exe`;
  if (file.fileName !== expectedFileName) {
    throw new Error(`${kind}.fileName does not match version`);
  }
  if (
    typeof file.size !== "number" ||
    !Number.isFinite(file.size) ||
    file.size <= 0 ||
    file.size > MAX_UPDATE_FILE_BYTES
  ) {
    throw new Error(`Invalid ${kind}.size`);
  }
  if (typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) {
    throw new Error(`Invalid ${kind}.sha256`);
  }

  return {
    fileName: file.fileName,
    url: file.url,
    size: file.size,
    sha256: file.sha256,
  };
}

function downloadUpdateFile(file, destinationPath, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    if (!file || !isAllowedDownloadUrl(file.url)) {
      reject(new Error("Invalid update download URL"));
      return;
    }

    let url;
    try {
      url = new URL(file.url);
    } catch {
      reject(new Error("Invalid update download URL"));
      return;
    }

    const partialPath = `${destinationPath}.part`;
    const fail = (error) => {
      fs.rm(partialPath, { force: true }, () => reject(error));
    };

    const req = https.request(
      {
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { "User-Agent": "WebcamMonitor-Updater" },
        timeout: 30000,
      },
      (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) {
            fail(new Error("Too many redirects"));
            return;
          }
          let redirectUrl;
          try {
            redirectUrl = new URL(res.headers.location, file.url);
          } catch {
            fail(new Error("Invalid redirect URL"));
            return;
          }
          if (!isAllowedDownloadUrl(redirectUrl.href)) {
            fail(new Error("Unexpected redirect URL"));
            return;
          }
          downloadUpdateFile({ ...file, url: redirectUrl.href }, destinationPath, redirectsLeft - 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          res.resume();
          fail(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        const advertisedLength = Number(res.headers["content-length"] || 0);
        if (advertisedLength && advertisedLength !== file.size) {
          res.resume();
          fail(new Error("Unexpected update file size"));
          return;
        }

        const output = fs.createWriteStream(partialPath, { flags: "w" });
        const hash = crypto.createHash("sha256");
        let bytesWritten = 0;
        let settled = false;
        const rejectOnce = (error) => {
          if (!settled) {
            settled = true;
            output.destroy();
            fail(error);
          }
        };

        res.on("data", (chunk) => {
          bytesWritten += chunk.length;
          if (bytesWritten > file.size || bytesWritten > MAX_UPDATE_FILE_BYTES) {
            req.destroy();
            rejectOnce(new Error("Update file exceeds expected size"));
            return;
          }
          hash.update(chunk);
        });
        res.on("error", rejectOnce);
        output.on("error", rejectOnce);
        output.on("finish", () => {
          if (settled) {
            return;
          }
          const digest = hash.digest("hex");
          if (bytesWritten !== file.size || digest !== file.sha256) {
            rejectOnce(new Error("Downloaded update failed integrity check"));
            return;
          }
          settled = true;
          fs.rename(partialPath, destinationPath, (error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve(destinationPath);
          });
        });
        res.pipe(output);
      }
    );

    req.on("timeout", () => {
      req.destroy();
      fail(new Error("Update download timeout"));
    });
    req.on("error", fail);
    req.end();
  });
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

  const portable = validateReleaseFile(data.portable, data.version, "portable");
  const installer = validateReleaseFile(data.installer, data.version, "setup");

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
    portable,
    installer,
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
    portable: null,
    installer: null,
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
      portable: updateAvailable ? validated.portable : null,
      installer: updateAvailable ? validated.installer : null,
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
  downloadUpdateFile,
  validateLatestJson,
  checkForUpdates,
};
