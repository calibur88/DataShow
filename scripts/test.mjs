/** 用 esbuild 打包测试入口后交给 node 执行（query / index / utils 层零 Obsidian 依赖）。 */
import esbuild from "esbuild";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const entry = path.join(root, "tests", "all.ts");
const outfile = path.join(root, ".test-out.cjs");

if (!fs.existsSync(entry)) {
  console.error(`[test] 找不到测试入口: ${entry}`);
  process.exit(1);
}

try {
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "es2018",
    absWorkingDir: root,
    outfile,
    logLevel: "silent",
  });
} catch (err) {
  console.error("[test] 打包失败:", err?.message ?? err);
  process.exit(1);
}

const result = spawnSync(process.execPath, [outfile], { stdio: "inherit", cwd: root });
fs.rmSync(outfile, { force: true });
process.exit(result.status ?? 1);
