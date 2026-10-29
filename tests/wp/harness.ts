import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Boots a disposable, real WordPress (PHP built-in server + SQLite) with our plugin installed.
// Returns null when PHP or the cached WordPress copy isn't available, so callers can skip.

export type WordPress = {
  url: string;
  user: string;
  appPassword: string;
  dir: string;
  php: (code: string) => string;
  stop: () => void;
};

const PLUGIN_SRC = path.resolve(__dirname, "../../integrations/wordpress/visibility-connector");

function wpSource(): string | null {
  try {
    execFileSync("php", ["-v"], { stdio: "pipe" });
  } catch {
    return null;
  }
  try {
    return execFileSync(path.resolve(__dirname, "../../scripts/wp-test-env.sh"), { encoding: "utf8" }).trim().split("\n").pop()!;
  } catch {
    return null;
  }
}

export async function startWordPress(port: number, opts: { yoastStub?: boolean; robotsFile?: string } = {}): Promise<WordPress | null> {
  const src = wpSource();
  if (!src) return null;
  const root = path.resolve(__dirname, "../../.wp-test");
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, "site-"));
  fs.cpSync(src, dir, { recursive: true });
  const url = `http://localhost:${port}`;
  const sqlite = path.join(dir, "wp-content/plugins/sqlite-database-integration-main");
  fs.writeFileSync(
    path.join(dir, "wp-content/db.php"),
    fs.readFileSync(path.join(sqlite, "db.copy"), "utf8")
      .replaceAll("{SQLITE_IMPLEMENTATION_FOLDER_PATH}", sqlite)
      .replaceAll("{SQLITE_PLUGIN}", "sqlite-database-integration-main/load.php"),
  );
  fs.writeFileSync(
    path.join(dir, "wp-config.php"),
    `<?php
define('DB_NAME','wp'); define('DB_USER',''); define('DB_PASSWORD',''); define('DB_HOST','');
define('DB_DIR', __DIR__ . '/wp-content/database/');
define('WP_HOME','${url}'); define('WP_SITEURL','${url}');
define('WP_ENVIRONMENT_TYPE','local'); // application passwords over plain http are allowed for local sites only
define('WP_DEBUG', true); define('WP_DEBUG_DISPLAY', false); define('WP_DEBUG_LOG', __DIR__ . '/debug.log');
foreach (['AUTH_KEY','SECURE_AUTH_KEY','LOGGED_IN_KEY','NONCE_KEY','AUTH_SALT','SECURE_AUTH_SALT','LOGGED_IN_SALT','NONCE_SALT'] as $k) define($k, 'test-' . $k);
$table_prefix = 'wp_';
if (!defined('ABSPATH')) define('ABSPATH', __DIR__ . '/');
require_once ABSPATH . 'wp-settings.php';
`,
  );
  fs.cpSync(PLUGIN_SRC, path.join(dir, "wp-content/plugins/visibility-connector"), { recursive: true });
  if (opts.yoastStub) {
    fs.mkdirSync(path.join(dir, "wp-content/mu-plugins"), { recursive: true });
    fs.copyFileSync(path.resolve(__dirname, "yoast-stub.php"), path.join(dir, "wp-content/mu-plugins/yoast-stub.php"));
  }
  if (opts.robotsFile) fs.writeFileSync(path.join(dir, "robots.txt"), opts.robotsFile);

  const php = (code: string) =>
    execFileSync("php", ["-d", "display_errors=stderr", "-d", "html_errors=0", "-r", `$_SERVER['HTTP_HOST']='localhost:${port}'; require '${dir}/wp-load.php'; ${code}`], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  execFileSync("php", ["-r", `define('WP_INSTALLING', true); $_SERVER['HTTP_HOST']='localhost:${port}'; require '${dir}/wp-load.php'; require ABSPATH . 'wp-admin/includes/upgrade.php'; wp_install('Test Site', 'admin', 'admin@example.com', true, '', 'admin-pass-123');`], { cwd: dir, stdio: "pipe" });
  php(`require_once ABSPATH . 'wp-admin/includes/plugin.php'; activate_plugin('visibility-connector/visibility-connector.php'); update_option('permalink_structure', '/%postname%/'); flush_rewrite_rules(); switch_theme('twentytwentyfour');`);
  const appPassword = php(`[$pw] = WP_Application_Passwords::create_new_application_password(1, ['name' => 'visibility-test']); echo $pw;`).trim();

  // Router script: lets the PHP built-in server handle pretty permalinks like Apache's rewrite rules.
  fs.writeFileSync(path.join(dir, "router.php"), `<?php $f = __DIR__ . parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH); if ($_SERVER['REQUEST_URI'] !== '/' && is_file($f)) return false; require __DIR__ . '/index.php';`);
  const server: ChildProcess = spawn("php", ["-S", `localhost:${port}`, "router.php"], { cwd: dir, stdio: "ignore" });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${url}/wp-json/`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return {
    url,
    user: "admin",
    appPassword,
    dir,
    php,
    stop: () => {
      server.kill("SIGKILL");
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
