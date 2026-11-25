import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";

const REPO_OWNER = "tailscale";
const REPO_NAME = "tailcat";
const GO_PKG = "github.com/tailscale/tailcat/cmd/tailcat@latest";
const PINNED_BINARY_SHA256 = {
  "linux/amd64":
    "0fcd3031c7f0590dac905ad45d3a48518e36bc424a550de487e31ec7fef6c242",
  "windows/amd64":
    "1b4b0753e354c95c026a5a16b79f7f694c9891e843b4b926dc2b03871e4c5fe2",
};

function parseArgs(argv) {
  const args = {
    force: false,
    noBuild: false,
    verify: false,
    allowUnverified: false,
    sha256: process.env.YTMD_TAILCAT_SHA256 || null,
    platform: process.platform,
    arch: process.arch,
    outDir: path.resolve(process.cwd(), "resources", "bin"),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--force") {
      args.force = true;
    } else if (token === "--no-build") {
      args.noBuild = true;
    } else if (token === "--verify") {
      args.verify = true;
    } else if (token === "--allow-unverified") {
      args.allowUnverified = true;
    } else if (token === "--sha256" && argv[i + 1]) {
      args.sha256 = argv[i + 1].trim().toLowerCase();
      i += 1;
    } else if (token === "--platform" && argv[i + 1]) {
      args.platform = argv[i + 1];
      i += 1;
    } else if (token === "--arch" && argv[i + 1]) {
      args.arch = argv[i + 1];
      i += 1;
    } else if (token === "--out" && argv[i + 1]) {
      args.outDir = path.resolve(argv[i + 1]);
      i += 1;
    }
  }
  return args;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function verifyFileSha256(filePath, expectedHex, label) {
  const actual = sha256File(filePath);
  const normalized = expectedHex.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`Invalid SHA-256 checksum for ${label}: ${expectedHex}`);
  }
  if (actual !== normalized) {
    throw new Error(
      `SHA-256 mismatch for ${label}: expected ${normalized}, got ${actual}`,
    );
  }
  return actual;
}

async function resolveReleaseAssetSha256(assets, asset) {
  if (typeof asset?.digest === "string" && asset.digest.startsWith("sha256:")) {
    return asset.digest.slice("sha256:".length).trim().toLowerCase();
  }
  if (!Array.isArray(assets) || !asset?.name) return null;

  const exactSidecar = assets.find(
    (a) =>
      String(a?.name ?? "").toLowerCase() ===
      `${String(asset.name).toLowerCase()}.sha256`,
  );
  const checksumsAsset =
    exactSidecar ??
    assets.find((a) =>
      /^(sha256sums|checksums)(\.txt)?$/i.test(String(a?.name ?? "")),
    );
  if (!checksumsAsset?.browser_download_url) return null;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailcat-sha-"));
  try {
    const checksumPath = path.join(tmpDir, checksumsAsset.name);
    await downloadFile(checksumsAsset.browser_download_url, checksumPath);
    const lines = fs.readFileSync(checksumPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const match = line.trim().match(/^([a-f0-9]{64})(?:\s+\*?(.+))?$/i);
      if (!match) continue;
      const [, hex, fileName] = match;
      if (!fileName || path.basename(fileName.trim()) === asset.name) {
        return hex.toLowerCase();
      }
    }
    return null;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function normalizeGoOs(platform) {
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "darwin";
  return "linux";
}

function normalizeGoArch(arch) {
  if (arch === "x64") return "amd64";
  if (arch === "arm64") return "arm64";
  if (arch === "ia32") return "386";
  return arch;
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const headers = {
      "User-Agent": "ytmdesktop-fetch-tailcat",
      Accept: "application/vnd.github+json",
    };
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    https
      .get(url, { headers }, (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          if (res.statusCode === 404) {
            resolve(null);
            return;
          }
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body));
            } catch (err) {
              reject(err);
            }
            return;
          }
          reject(
            new Error(
              `GitHub API responded with status ${res.statusCode ?? "unknown"}`,
            ),
          );
        });
      })
      .on("error", reject);
  });
}

function downloadFile(url, destPath, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const headers = {
      "User-Agent": "ytmdesktop-fetch-tailcat",
    };
    https
      .get(url, { headers }, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          if (redirectsLeft <= 0) {
            reject(new Error("Too many redirects downloading tailcat asset"));
            return;
          }
          res.resume();
          resolve(
            downloadFile(res.headers.location, destPath, redirectsLeft - 1),
          );
          return;
        }

        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          reject(
            new Error(
              `Failed downloading release asset: HTTP ${res.statusCode ?? "unknown"}`,
            ),
          );
          return;
        }

        const out = fs.createWriteStream(destPath);
        res.pipe(out);
        out.on("finish", () => {
          out.close(() => resolve());
        });
        out.on("error", reject);
      })
      .on("error", reject);
  });
}

function selectReleaseAsset(assets, goos, goarch) {
  if (!Array.isArray(assets)) return null;
  const osAliases = goos === "darwin" ? ["darwin", "macos"] : [goos];
  const archAliases =
    goarch === "amd64"
      ? ["amd64", "x86_64"]
      : goarch === "arm64"
        ? ["arm64", "aarch64"]
        : [goarch];

  const matching = assets.filter((asset) => {
    const name = String(asset?.name ?? "").toLowerCase();
    const hasOs = osAliases.some((o) => name.includes(o));
    const hasArch = archAliases.some((a) => name.includes(a));
    return (
      hasOs &&
      hasArch &&
      !name.endsWith(".deb") &&
      !name.endsWith(".rpm") &&
      !name.endsWith(".apk") &&
      !name.endsWith(".sha256") &&
      !name.endsWith(".sig") &&
      !name.endsWith(".txt")
    );
  });

  return (
    matching.find((a) => /\.(tar\.gz|tgz|zip)$/i.test(String(a?.name ?? ""))) ??
    matching[0] ??
    null
  );
}

function findBinaryRecursive(dir, binName) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = findBinaryRecursive(fullPath, binName);
      if (nested) return nested;
    } else if (entry.isFile() && entry.name === binName) {
      return fullPath;
    }
  }
  return null;
}

function extractArchive(archivePath, outDir, binName) {
  const lower = archivePath.toLowerCase();
  const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), "extract-tailcat-"));
  try {
    if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
      execFileSync("tar", ["-xzf", archivePath, "-C", extractDir], {
        stdio: "inherit",
      });
    } else if (lower.endsWith(".zip")) {
      if (process.platform === "win32") {
        execFileSync(
          "powershell",
          [
            "-NoProfile",
            "-Command",
            `Expand-Archive -Path '${archivePath}' -DestinationPath '${extractDir}' -Force`,
          ],
          { stdio: "inherit" },
        );
      } else {
        execFileSync("unzip", ["-o", archivePath, "-d", extractDir], {
          stdio: "inherit",
        });
      }
    } else {
      fs.copyFileSync(archivePath, path.join(outDir, binName));
      return;
    }

    const found = findBinaryRecursive(extractDir, binName);
    if (!found) {
      throw new Error(
        `Extracted archive ${path.basename(archivePath)} did not contain "${binName}"`,
      );
    }
    fs.copyFileSync(found, path.join(outDir, binName));
  } finally {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
}

function tryGoInstallFallback(destPath, goos, goarch) {
  try {
    execFileSync("go", ["version"], { stdio: "ignore" });
  } catch {
    return false;
  }

  const outDir = path.dirname(destPath);
  const env = {
    ...process.env,
    GOBIN: outDir,
    GOOS: goos,
    GOARCH: goarch,
  };
  console.log(`Building tailcat via Go (${GO_PKG}) into ${outDir}...`);
  execFileSync("go", ["install", GO_PKG], {
    env,
    stdio: "inherit",
  });
  return fs.existsSync(destPath);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const goos = normalizeGoOs(opts.platform);
  const goarch = normalizeGoArch(opts.arch);
  const targetKey = `${goos}/${goarch}`;
  const binName = opts.platform === "win32" ? "tailcat.exe" : "tailcat";
  const destPath = path.join(opts.outDir, binName);
  const expectedBinSha256 = opts.sha256 ?? PINNED_BINARY_SHA256[targetKey] ?? null;

  if (fs.existsSync(destPath) && !opts.force) {
    if (expectedBinSha256) {
      const actual = verifyFileSha256(destPath, expectedBinSha256, destPath);
      console.log(`Verified tailcat binary at ${destPath} (sha256: ${actual})`);
      return;
    }
    if (opts.verify && !opts.allowUnverified) {
      throw new Error(
        `No pinned SHA-256 checksum configured for ${targetKey}; pass --sha256 <hex> to verify ${destPath}`,
      );
    }
    console.log(`tailcat binary already exists at ${destPath}`);
    return;
  }

  fs.mkdirSync(opts.outDir, { recursive: true });

  const releaseUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
  let release = null;
  try {
    release = await requestJson(releaseUrl);
  } catch (err) {
    console.warn(
      `Warning: could not query GitHub releases (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  const asset = selectReleaseAsset(release?.assets, goos, goarch);
  if (asset?.browser_download_url) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-tailcat-"));
    try {
      const archivePath = path.join(tmpDir, asset.name);
      console.log(
        `Downloading ${asset.name} from ${release.tag_name ?? "latest"}...`,
      );
      await downloadFile(asset.browser_download_url, archivePath);
      const assetSha256 = await resolveReleaseAssetSha256(
        release?.assets,
        asset,
      );
      if (assetSha256) {
        verifyFileSha256(archivePath, assetSha256, asset.name);
        console.log(`Verified archive checksum for ${asset.name}`);
      } else if (!expectedBinSha256 && !opts.allowUnverified) {
        throw new Error(
          `Refusing unverified download for ${asset.name}: no release checksum or --sha256 provided`,
        );
      }
      extractArchive(archivePath, opts.outDir, binName);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  } else if (!opts.noBuild && tryGoInstallFallback(destPath, goos, goarch)) {
    // Built via go install fallback
  } else {
    console.error(
      [
        `No prebuilt ${REPO_OWNER}/${REPO_NAME} release asset found for ${goos}/${goarch}.`,
        "To build tailcat from source with Go (1.22+), run:",
        `  GOBIN="${opts.outDir}" go install ${GO_PKG}`,
        `or place the compiled "${binName}" binary at: ${destPath}`,
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  if (!fs.existsSync(destPath)) {
    throw new Error(
      `Expected tailcat binary at ${destPath}, but it was not found`,
    );
  }

  if (expectedBinSha256) {
    try {
      const actual = verifyFileSha256(destPath, expectedBinSha256, destPath);
      console.log(`Verified tailcat binary SHA-256: ${actual}`);
    } catch (err) {
      fs.rmSync(destPath, { force: true });
      throw err;
    }
  } else if (!opts.allowUnverified) {
    const actual = sha256File(destPath);
    fs.rmSync(destPath, { force: true });
    throw new Error(
      `No pinned SHA-256 for ${targetKey} (got ${actual}); pass --sha256 <hex> or --allow-unverified`,
    );
  }

  if (opts.platform !== "win32") {
    fs.chmodSync(destPath, 0o755);
  }
  console.log(`Installed tailcat binary to ${destPath}`);
}

main().catch((err) => {
  console.error("Error fetching tailcat binary:", err);
  process.exitCode = 1;
});
