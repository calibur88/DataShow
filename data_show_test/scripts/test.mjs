/** 用 esbuild 打包测试入口后交给 node 执行（query 层零 Obsidian 依赖）。 */
import esbuild from "esbuild";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outfile = path.join(here, "..", ".test-out.cjs");

await esbuild.build({
  entryPoints: [path.join(here, "..", "tests", "all.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  absWorkingDir: here,
  outfile,
  logLevel: "silent",
});

const result = spawnSync(process.execPath, [outfile], { stdio: "inherit" });
fs.rmSync(outfile, { force: true });
process.exit(result.status ?? 1);
