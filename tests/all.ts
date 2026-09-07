/**
 * @module tests/all
 * @description 测试入口：注册并执行七套件（esbuild 打包后由 node 运行）
 *
 * 用例按示例面板三大类组织：功能示例 / 数学示例 / DSQL 语言示例，
 * 另含 store / 摄取层 / viewSync / normalizeBoard 四套件；被测层零 Obsidian 依赖。
 */

import "./feature.test";
import "./math.test";
import "./dsql-language.test";
import "./store.test";
import "./ingest.test";
import "./viewSync.test";
import "./normalizeBoard.test";
