import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const prod = process.argv[2] === "production";
const here = path.dirname(fileURLToPath(import.meta.url));

const OUT_FILE = path.join(here, "dist", "main.js");

const SYNC_TARGETS = [
  path.join(here, "test-vault-local", ".obsidian", "plugins", "data-show"),
  path.join(here, "test-vault", ".obsidian", "plugins", "data-show"),
];

const SYNC_FILES = [
  { from: OUT_FILE, to: "main.js" },
  { from: path.join(here, "manifest.json"), to: "manifest.json" },
  { from: path.join(here, "styles.css"), to: "styles.css" },
];

const context = await esbuild.context({
  entryPoints: [path.join(here, "src", "main.ts")],
  bundle: true,
  external: ["obsidian", "electron"],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  absWorkingDir: here,
  outfile: OUT_FILE,
});

/** 把构建产物与插件元文件同步到各个测试库的插件目录。 */
function syncToVaults() {
  for (const dir of SYNC_TARGETS) {
    fs.mkdirSync(dir, { recursive: true });
    for (const { from, to } of SYNC_FILES) {
      if (!fs.existsSync(from)) continue;
      fs.copyFileSync(from, path.join(dir, to));
    }
  }
  console.log("[esbuild] synced -> " + SYNC_TARGETS.map((d) => path.relative(here, d)).join(", "));
}

/** 监听打包图之外的静态文件（manifest / styles），变化后触发重建并同步。 */
function watchStaticFiles() {
  for (const file of [path.join(here, "manifest.json"), path.join(here, "styles.css")]) {
    fs.watchFile(file, { interval: 300 }, async () => {
      try {
        await context.rebuild();
        syncToVaults();
      } catch (err) {
        console.warn("[esbuild] rebuild failed:", err?.message ?? err);
      }
    });
  }
}

if (prod) {
  await context.rebuild();
  syncToVaults();
  await context.dispose();
  process.exit(0);
} else {
  await context.watch();
  watchStaticFiles();
  syncToVaults();
}
