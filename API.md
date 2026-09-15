# DataShow API 文档

分两部分：**官方 API**（Obsidian 提供、本插件用到的接口）与**插件 API**（DataShow 自身导出、
可供二次开发 / 测试使用的接口）。示例均基于当前版本（插件 2.3.1，DSQL 2.6，minAppVersion 1.4.4）。

---

## 一、官方 API（Obsidian）

插件所用到的 Obsidian 公开接口，均在 `obsidian.d.ts` 中定义。

### 1. frontmatter 读写（属性编辑链路）

| API | 签名 | 用途 |
|---|---|---|
| `app.metadataCache.getFileCache(file)` | `→ CachedMetadata` | 读笔记缓存，`?.frontmatter` 取属性对象、`?.frontmatterPosition` 取 frontmatter 结束偏移 |
| `stringifyYaml(obj)` | `any → string` | 值 → YAML 文本（`IYamlCodec.stringify`，结果区「解析失效」列表渲染） |
| `parseYaml(text)` | `string → any` | YAML 文本 → 对象（`IYamlCodec.parse`；非 md 路径另走自研 `parseYamlFallback`） |
| `app.fileManager.processFrontMatter(file, fn)` | `(TFile, (fm: any) => void) → Promise<void>` | **官方原子写回**：读-改-写 frontmatter，不碰正文 |

插件内唯一写入点：`src/render/panel-view.ts` 装配保存回调（走 `IFrontmatterHost.setField`）→
`src/render/card-view.ts` 卡片字段内联编辑触发；表格 / 列表为只读，v2.0 起已无属性编辑弹窗链路：

```ts
await app.fileManager.processFrontMatter(file, (fm) => {
  fm.status = '已完成';   // 增/改
  delete fm.owner;        // 删
});
```

### 2. 索引与文件

| API | 用途 |
|---|---|
| `app.metadataCache.on("resolved" / "changed", cb)` | 全量首扫补漏（`resolved`）与 md 增量索引（`changed`，索引器内 300ms debounce） |
| `app.vault.on("delete" / "rename" / "modify" / "create", cb)` | 行删除 / 重命名同步；vault 级 `modify` / `create`（含非 md）供 `[ext]` 查询去抖重跑兜底 |
| `app.vault.getMarkdownFiles()` | md 全量首扫文件清单（`IVaultHost.listMarkdownFiles`） |
| `app.vault.getFiles()` | `[ext]` 目录范围的全文件清单（含非 md，`IExtSourceHost.listFiles`） |
| `app.vault.getFileByPath(path)` | 行路径 → `TFile`（属性读写、正文读取定位；旧 `getAbstractFileByPath` 已不再使用） |
| `app.vault.cachedRead(file)` | 读原文：frontmatter 重复键检测、非 md 自研解析、SEARCH body 预读 |
| `app.metadataCache.resolvedLinks` | 出链 / 入链（反向索引按事件失效、惰性重算，一次批量刷新内只算一次） |

### 3. 工作区 UI

| API | 用途 |
|---|---|
| `ItemView` / `WorkspaceLeaf` | 看板面板（`setState` / `getState` 持久化 boardId）与侧栏视图 |
| `Plugin` / `PluginSettingTab` / `Setting` | 插件装配与设置页 |
| `app.workspace.openLinkText(path, "", false)` | 点击文件名打开笔记 |
| `Notice` | 用户提示（`IUiHost.notify` / `warn` / `error`） |

> 内联编辑保存后无需手动刷新：`processFrontMatter` 触发 metadataCache 变更 →
> 插件索引器增量更新行仓库 → 订阅者（面板）自动重跑查询。

---

## 二、插件 API（DataShow 自身）

### 1. DSQL 查询层（`src/core/dsql/`，零 Obsidian 依赖，可直接在 Node 测试）

```ts
import { parseQuery, QueryParseError } from "./src/core/dsql/parser";
import { executeQuery, evaluateExpr, compareUtf8 } from "./src/core/dsql/executor";
```

| 导出 | 签名 | 说明 |
|---|---|---|
| `parseQuery(source)` | `string → Query` | DSQL → AST；错误 `QueryParseError`（带 line / col） |
| `executeQuery(q, rows, ctx, opts?)` | `→ ResultSet` | 执行：FROM 源解析 → [ext] 行并入 → WHILE + SEARCH 结构匹配 → 聚合遍（TOTAL）→ WHERE → COUNT → SORT / LIMIT / SELECT；`opts.debug` 收集调试信息，`opts.ingestWarnings` 并入摄取期警告，`opts.extRows` / `opts.bodies` 由面板按 FROM 范围预读后传入 |
| `evaluateExpr(expr, row, ctx, track?, warn?, vars?)` | `→ FieldValue` | 单表达式求值（面板渲染单元格共用） |
| `truthy(v)` | `FieldValue → boolean` | 裸真值判断（empty 值 / null / 0 / false / 空串 / 空数组 → 假） |
| `compareUtf8(a, b)` | `(string, string) → number` | UTF-8 字节序比较（排序 / 自动列的确定性基准；含同一性快路径） |
| `FUNCTION_NAMES` | `ReadonlySet<string>` | 内置函数名单一事实源（词法层校验用，与 `FUNCTIONS` 表同源，不会漂移） |
| `EMPTY` | `FieldValue`（symbol 哨兵） | DSQL 未赋值哨兵（`src/core/dsql/types.ts`）；仅 `**empty**()` 能识别，其余运算按 null 传播 |
| `ResultSet` | `{ view, columns, rows, globals, debug? }` | `view: ViewType`；`columns: { alias, expr, total? }[]`；`globals` = 变量表（TOTAL / COUNT 填充的槽位 + 投影遍链式派生的基准，**查询开始即建为空表、恒非 null**）；`debug` 见下 |
| `QueryDebug` | `{ from, where, sort, limit, fieldMisses, warnings, sourceStats, aggregates, search, count, executionTimeMs }` | 调试信息（`aggregates` = TOTAL 项、`search` = 各 SEARCH 模板命中统计（DSQL 2.4 起按 WHILE 迭代产出计数）、`count` = 各 COUNT 计数项，调试页对应 AGG / SEARCH / COUNT 行） |
| `QueryWarning` | `{ type, message }` | 结构化警告（除零 / 类型不匹配 / 未知函数 / TOTAL / SORT / duplicateKey 等） |

语法与语义见 [docs/DSQL-语言规范.md](docs/DSQL-语言规范.md)。

### 2. 行仓库（`src/core/index/store.ts`）

```ts
store.all(): DataRow[];                  // 全部行（按路径排序）
store.upsert(row) / upsertMany(rows);    // 增 / 批量增（批量只触发一次通知）
store.remove(path); store.count();
store.subscribe(fn): () => void;         // 订阅变更，返回退订函数
store.setIngestWarnings(path, warns);    // 归档某文件摄取警告（空数组 = 清除）
store.ingestWarnings(): IngestWarning[]; // 全库摄取警告（随查询调试信息输出）
```

`DataRow = { path, file: FileMeta, fields: Record<string, FieldValue> }`（`src/core/dsql/types.ts`）。
`IngestWarning = { type, file, field?, message, rawLines? }`（重复键等摄取期容错）。

**frontmatter 原文扫描**（`src/core/index/frontmatter.ts`）：

```ts
findDuplicateKeys(content): { field: string; rawLines: string[] }[];
```

扫描笔记原文 frontmatter 的顶层键，返回重复键及其原始行；由 `src/controller/indexer.ts` 接入，
命中则该文件从结果集剔除并计入 `duplicateKey` 警告。

### 3. 插件实例（`src/main.ts`，视图内通过 `this.plugin` 访问）

| 成员 | 说明 |
|---|---|
| `settings: DatashowSettings` | `{ openInNewTab, showDebug, decimalPlaces, boards: BoardDef[], collapsedGroups: string[] }` |
| `saveSettings()` | 持久化到 `data.json`；触发 `boardListeners`（侧栏联动） |
| `loadSettings()` | 载入并按 `normalizeBoard` 校形每个看板 |
| `addBoardListener(fn)` | 看板定义变更订阅（面板外部变更同步），返回退订函数 |
| `openBoard(boardId)` | 侧栏点击 → 打开 / 复用看板面板 |
| `activateSidebarView()` | ribbon 图标 / 命令 → 打开或聚焦侧栏 |
| `store` | 行仓库实例（见 §二.2） |

### 4. 看板定义（`BoardDef`，存于 `data.json`）

```jsonc
{
  "id": "uuid",
  "name": "看板名称",       // 侧栏显示名
  "type": "分组分类",       // 侧栏分组（自由分类），可空
  "description": "说明",
  "sql": "**TABLE_VIEW** **SELECT** ... **FROM** \"Notes\"",  // 在面板中编辑，防抖自动保存
  "viewType": ""            // ""（跟随语句）| "TABLE_VIEW" | "LIST_VIEW" | "CARD_VIEW"
}
```

### 5. 视图扩展点

- 视图类型常量：`src/core/dsql/types.ts` 的 `IMPLEMENTED_VIEWS`（`TABLE_VIEW` / `LIST_VIEW` / `CARD_VIEW`）；
- 渲染入口：`src/render/panel-view.ts` 的 `renderResultByView()`，按视图类型分派到
  `src/render/table-view.ts` / `list-view.ts` / `card-view.ts`，新增视图类型在此扩展；
- 视图与 SQL 双向同步工具：`src/utils/viewSync.ts` 的
  `applyViewType(board, type)` / `detectTypeFromSql(sql)` / `normalizeSqlView(sql, type)`（均为纯函数）。

### 6. host 层接口与依赖注入（v2.1.4 新增；v2.2.0 新增 IExportHost）

`src/host/types.ts` 是 **宿主接口与依赖契约的唯一出口**，所有跨层能力均经本文件声明；
`src/host/obsidian/` 实现适配器，`src/main.ts` 装配注入，业务层只认接口。

**八条宿主接口**（`IFrontmatterEditor` 与属性编辑弹窗链路已随 v2.0 编辑权收敛删除）：

| 接口 | 用途 | 关键方法 |
|---|---|---|
| `IVaultHost` | 数据源：列文件、读元数据与正文、订阅变更 | `listMarkdownFiles()` / `readFrontmatter(path)` / `getOutlinks(path)` / `getInlinks(path)` / `readText(path)` / `subscribe(handlers)` |
| `IOpener` | 打开笔记 | `openFile(path, opts?)` |
| `IFrontmatterHost` | 属性数据侧读写（不含 UI） | `read(path)` / `setField(path, field, value)` / `replaceAll(path, fields)` |
| `IYamlCodec` | YAML 编解码 | `parse(text)` / `stringify(value)` |
| `IStorageHost` | 带 key 的持久化槽位 | `load<T>(key)` / `save(key, data)` |
| `IUiHost` | 用户反馈与日志 | `notify(msg)` / `warn(msg)` / `error(msg)` |
| `IExtSourceHost` | [ext] 文件级读取 / SEARCH 正文读取（查询级，无常驻状态） | `listFiles(folderPaths)` / `readMd(path)` / `readNonMdText(path)` / `readBody(path)` |
| `IExportHost` | 结果导出：把文本写入 vault 相对路径（自动建目录、越界校验） | `writeExport(path, content)` |

另有 `IFileMeta`（行元数据契约，`host/obsidian/file-meta.ts` 的 `toMeta` 由 vault-host 与
ext-source-host 共用实现）与 `IRowSource`（`core/index/store.ts` 的只读数据视图，非宿主接口）：
`all(): DataRow[]` / `ingestWarnings()` / `subscribe(cb)`，供 UI 层消费行仓库快照。

**读写约定**：读路径失败一律返回 `null`（core 内不抛不 try）；写路径失败以 `reject(Error)` 上抛。

**依赖契约**（UI 层通过 Deps 获得宿主能力，不直接引用插件类或宿主实例）：

| 契约 | 使用者 | 含有的能力 |
|---|---|---|
| `PanelDeps` | `render/panel-view.ts` → `views/panel.ts` | `rows` + `settings()` + `saveSettings()` + `onBoardsChange()` + `onVaultChange()` + `extSource` + `codec` + `opener` + `frontmatter` + `ui` + `exporter` |
| `SidebarDeps` | `render/sidebar-view.ts` → `views/sidebar.ts` | `settings()` + `saveSettings()` + `openBoard()` + `onBoardsChange()` |
| `SettingsTabDeps` | `views/settings-tab.ts` | `settings()` + `saveSettings()` + `defaultBoards()` |

**移植提示**：换宿主只需重写 `main.ts` + `views/` + `host/obsidian/`（实现全部八条接口），
`core/` / `controller/` / `render/` / `settings/` / `utils/` 逐字不动；
另需宿主提供 `HTMLElement` 的 `createDiv` / `createEl` / `createSpan` / `addClass` / `toggleClass` / `isShown` 等原型扩展
（或改用 `utils/dom` 的等价实现）。

### 7. 结果导出（`src/render/export.ts` + `IExportHost`）

导出为纯函数模块（零宿主依赖），UI 层调用后由宿主接口写入 vault：

| 导出 | 签名 | 说明 |
|---|---|---|
| `resolveExportPath(raw)` | `string → { ok, path, format } \| { ok: false, reason }` | 解析 vault 相对路径；合法扩展名 `.json` / `.csv`；拒绝绝对路径、`..` 越界、非法字符、`.xlsx`（提示用 Excel 另存） |
| `exportHeaders(result, withoutId)` | `→ string[]` | 导出表头（含可选「文件」列，重名加 `_n` 后缀） |
| `rowSearchText(result, row, decimalPlaces)` | `→ string` | 行搜索文本（文件标题 + 列名 + 显示值），与结果区可见文本一致，过滤共用 |
| `filterRows(result, term, decimalPlaces)` | `→ DataRow[]` | 按已生效搜索词过滤（不区分大小写子串；空词返回全部） |
| `toJSON(result, rows, withoutId)` | `→ string` | 序列化为 JSON（保留原始类型，格式化、末尾换行）；empty 值 → `null` 且保留键 |
| `toCSV(result, rows, withoutId, decimalPlaces)` | `→ string` | 序列化为 CSV（RFC 4180：逗号分隔、CRLF、引号转义）；走 `formatCell`，null / empty 值 → `—` |
| `buildExport(format, result, rows, withoutId, decimalPlaces)` | `→ ExportPayload` | 按格式分派，返回 `{ format, data }` |

`src/render/format.ts` 的 `formatCell(value, places)` 是 null / empty 值显示文本的**唯一出口**：
三视图渲染、CSV 导出与结果区搜索文本共用（`EMPTY` 与 null 同口径 → `—`，内部 `Symbol` 不外露）。

宿主写入接口（`src/host/types.ts`，v2.2.0 新增第八条接口）：

```ts
interface IExportHost {
  writeExport(path: string, content: string): Promise<void>;  // vault 相对路径，自动建目录、越界校验
}
```

`ObsidianExportHost`（`src/host/obsidian/export-host.ts`）经 `normalizePath` 归一路径、递归 `createFolder` 建目录，
`vault.create` / `vault.modify` 写入，越出 vault 根（`..` / 前导 `/` / 盘符）直接拒绝。
