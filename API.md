# DataShow API 文档

分两部分：**官方 API**（Obsidian 提供、本插件用到的接口）与**插件 API**（DataShow 自身导出、
可供二次开发 / 测试使用的接口）。示例均基于当前版本（插件 2.1.4，DSQL 2.0，minAppVersion 1.4.4）。

---

## 一、官方 API（Obsidian）

插件所用到的 Obsidian 公开接口，均在 `obsidian.d.ts` 中定义。

### 1. frontmatter 读写（属性编辑链路）

| API | 签名 | 用途 |
|---|---|---|
| `app.metadataCache.getFileCache(file)` | `→ CachedMetadata` | 读笔记缓存，`?.frontmatter` 取属性对象 |
| `stringifyYaml(obj)` | `any → string` | 属性对象 → YAML 文本（编辑弹窗展示） |
| `parseYaml(text)` | `string → any` | YAML 文本 → 对象（保存前校验，失败抛错） |
| `app.fileManager.processFrontMatter(file, fn)` | `(TFile, (fm: any) => void) → Promise<void>` | **官方原子写回**：读-改-写 frontmatter，不碰正文 |

插件内写入点（`src/render/panel-view.ts` 装配保存回调 → `src/render/card-view.ts` 内联编辑触发；
`src/host/obsidian/frontmatter-modal.ts` 属性弹窗）：

```ts
await app.fileManager.processFrontMatter(file, (fm) => {
  fm.status = '已完成';   // 增/改
  delete fm.owner;        // 删
});
```

### 2. 索引与文件

| API | 用途 |
|---|---|
| `app.metadataCache.on("changed" / "deleted" / "resolve", cb)` | 增量索引监听（索引器首扫 + debounce 增量） |
| `app.vault.getMarkdownFiles()` | 全量首扫的文件清单 |
| `app.vault.getAbstractFileByPath(path)` | 行路径 → `TFile`（属性编辑定位文件） |

### 3. 工作区 UI

| API | 用途 |
|---|---|
| `ItemView` / `WorkspaceLeaf` | 看板面板（`setState` / `getState` 持久化 boardId）与侧栏视图 |
| `Modal` | frontmatter 编辑弹窗基类 |
| `Plugin` / `PluginSettingTab` / `Setting` | 插件装配与设置页 |
| `app.workspace.openLinkText(path, "", false)` | 点击文件名打开笔记 |

> 内联编辑与弹窗保存后无需手动刷新：`processFrontMatter` 触发 metadataCache 变更 →
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
| `executeQuery(q, rows, ctx, opts?)` | `→ ResultSet` | 执行：聚合遍 → FROM / WHERE / SORT / LIMIT / SELECT；`opts.debug` 收集调试信息，`opts.ingestWarnings` 并入摄取期警告 |
| `evaluateExpr(expr, row, ctx, track?, warn?, vars?)` | `→ FieldValue` | 单表达式求值（面板渲染单元格共用） |
| `truthy(v)` | `FieldValue → boolean` | 裸真值判断（empty 值 / null / 0 / false / 空串 / 空数组 → 假） |
| `compareUtf8(a, b)` | `(string, string) → number` | UTF-8 字节序比较（排序 / 自动列的确定性基准） |
| `EMPTY` | `FieldValue`（symbol 哨兵） | DSQL 未赋值哨兵（`src/core/dsql/types.ts`）；仅 `**empty**()` 能识别，其余运算按 null 传播 |
| `ResultSet` | `{ view, columns, rows, globals, debug? }` | `view: ViewType`；`columns: { alias, expr }[]`；`debug` 见下 |
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

### 6. host 层接口与依赖注入（v2.1.4 新增）

`src/host/types.ts` 是 **宿主接口与依赖契约的唯一出口**，所有跨层能力均经本文件声明；
`src/host/obsidian/` 实现适配器，`src/main.ts` 装配注入，业务层只认接口。

| 接口 | 用途 | 关键方法 |
|---|---|---|
| `IVaultHost` | 数据源：列文件、读元数据与正文、订阅变更 | `listMarkdownFiles()` / `readFrontmatter(path)` / `getOutlinks(path)` / `getInlinks(path)` / `readText(path)` / `subscribe(handlers)` |
| `IOpener` | 打开笔记 | `openFile(path, opts?)` |
| `IFrontmatterHost` | 属性数据侧读写（不含 UI） | `read(path)` / `setField(path, field, value)` / `replaceAll(path, fields)` |
| `IFrontmatterEditor` | 属性编辑弹窗（UI 侧） | `openEditor(path, onSaved)` |
| `IYamlCodec` | YAML 编解码 | `parse(text)` / `stringify(value)` |
| `IStorageHost` | 带 key 的持久化槽位 | `load<T>(key)` / `save(key, data)` |
| `IUiHost` | 用户反馈与日志 | `notify(msg)` / `warn(msg)` / `error(msg)` |
| `IRowSource` | UI 只读数据视图 | `all(): DataRow[]` / `ingestWarnings()` / `subscribe(cb)` |

**读写约定**：读路径失败一律返回 `null`（core 内不抛不 try）；写路径失败以 `reject(Error)` 上抛。

**依赖契约**（UI 层通过 Deps 获得宿主能力，不直接引用插件类或宿主实例）：

| 契约 | 使用者 | 含有的能力 |
|---|---|---|
| `PanelDeps` | `render/panel-view.ts` → `views/panel.ts` | `rows` + `settings()` + `saveSettings()` + `onBoardsChange()` + `opener` + `frontmatter` + `editor` + `ui` |
| `SidebarDeps` | `render/sidebar-view.ts` → `views/sidebar.ts` | `settings()` + `saveSettings()` + `openBoard()` + `onBoardsChange()` |
| `SettingsTabDeps` | `views/settings-tab.ts` | `settings()` + `saveSettings()` + `defaultBoards()` |

**移植提示**：换宿主只需重写 `main.ts` + `views/` + `host/obsidian/`（实现全部七条接口），
`core/` / `controller/` / `render/` / `settings/` / `utils/` 逐字不动；
另需宿主提供 `HTMLElement` 的 `createDiv` / `createEl` / `createSpan` / `addClass` / `toggleClass` / `isShown` 等原型扩展
（或改用 `utils/dom` 的等价实现）。
