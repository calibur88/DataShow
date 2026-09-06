import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const prod = process.argv[2] === "production";
const here = path.dirname(fileURLToPath(import.meta.url));

const TEST_VAULT_PLUGIN_DIR = path.join(
  here,
  "test-vault",
  ".obsidian",
  "plugins",
  "data-show",
);

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
  outfile: path.join(here, "main.js"),
});

async function copyToTestVault() {
  fs.mkdirSync(TEST_VAULT_PLUGIN_DIR, { recursive: true });
  for (const name of ["main.js", "manifest.json", "styles.css"]) {
    fs.copyFileSync(path.join(here, name), path.join(TEST_VAULT_PLUGIN_DIR, name));
  }
}

if (prod) {
  await context.rebuild();
  await copyToTestVault();
  process.exit(0);
} else {
  await context.watch();
  void copyToTestVault();
}
