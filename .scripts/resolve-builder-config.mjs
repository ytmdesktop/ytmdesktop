import fs from "node:fs";
import path from "node:path";

function getArgFlag(flag) {
  return process.argv.includes(flag);
}

function normalizeNodeEnv(nodeEnvRaw) {
  const nodeEnv = (nodeEnvRaw ?? "").trim().toLowerCase();
  if (nodeEnv === "production") return "production";
  if (nodeEnv === "staging") return "staging";
  // Treat everything else as local/dev (development, dev, test, undefined)
  return "local";
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function ensureTrailingSlash(url) {
  if (typeof url !== "string") return url;
  return url.endsWith("/") ? url : `${url}/`;
}

/**
 * Supports `${VAR}` and `${VAR:-default}` patterns (Docker-compose style).
 * If pattern doesn't match, returns original string.
 */
function expandEnvTemplate(value) {
  if (typeof value !== "string") return value;

  const match = value.match(/^\$\{([A-Z0-9_]+)(:-([^}]*))?\}$/i);
  if (!match) return value;

  const varName = match[1];
  const fallback = match[3];
  const envValue = process.env[varName];
  if (envValue && envValue.trim()) return envValue.trim();
  if (typeof fallback === "string") return fallback;
  return "";
}

function isValidUrl(url) {
  if (typeof url !== "string" || !url.trim()) return false;
  try {
    // eslint-disable-next-line no-new
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function resolveConfigFilePath({ repoRoot, nodeEnv }) {
  if (process.env.BUILDER_CONFIG_FILE && process.env.BUILDER_CONFIG_FILE.trim()) {
    return path.resolve(repoRoot, process.env.BUILDER_CONFIG_FILE.trim());
  }

  const envFileMap = {
    local: "builder.config.local.json",
    staging: "builder.config.staging.json",
    production: "builder.config.production.json"
  };

  const candidate = path.resolve(repoRoot, envFileMap[nodeEnv]);
  if (fs.existsSync(candidate)) return candidate;

  return path.resolve(repoRoot, "builder.config.json");
}

function resolveServerUrl({ config, nodeEnv }) {
  const envOverride = process.env.BUILDER_SERVER_URL?.trim();
  if (envOverride) return ensureTrailingSlash(envOverride);

  const expanded = ensureTrailingSlash(expandEnvTemplate(config.serverUrl));
  if (isValidUrl(expanded)) return expanded;

  const fallback = "http://localhost:9863/";
  if (nodeEnv !== "local") {
    // eslint-disable-next-line no-console
    console.warn(
      `[builder-config] Warning: no valid serverUrl resolved for NODE_ENV=${nodeEnv}. ` +
        `Set BUILDER_SERVER_URL to an externally reachable URL. Falling back to ${fallback}`
    );
  }
  return fallback;
}

function main() {
  const repoRoot = process.cwd();
  const nodeEnv = normalizeNodeEnv(process.env.NODE_ENV);
  const write = getArgFlag("--write");

  const sourceConfigPath = resolveConfigFilePath({ repoRoot, nodeEnv });
  const config = readJsonFile(sourceConfigPath);

  const resolved = {
    ...config,
    serverUrl: resolveServerUrl({ config, nodeEnv })
  };

  const resolvedPath = path.resolve(repoRoot, "builder.config.resolved.json");
  fs.writeFileSync(resolvedPath, `${JSON.stringify(resolved, null, 2)}\n`, "utf8");

  if (write) {
    const targetPath = path.resolve(repoRoot, "builder.config.json");
    fs.writeFileSync(targetPath, `${JSON.stringify(resolved, null, 2)}\n`, "utf8");
  }

  // Always print the resolved config path (for CI logs / deploy scripts)
  // eslint-disable-next-line no-console
  console.log(resolvedPath);
}

main();
