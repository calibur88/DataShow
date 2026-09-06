# DataShow API 文档

分两部分：**官方 API**（Obsidian 提供本插件用到的接口）与**插件 API**（DataShow 自身导出、可供二次开发/测试使用的接口）。示例均基于当前版本（插件 1.7.0，DSQL 1.3）。

---

## 一、官方 API（Obsidian）

插件所用到的 Obsidian 公开接口，均在 `obsidian.d.ts` 中定义：

### 1. frontmatter 读写（属性编辑链路）

| API | 签名 | 用途 |
|---|---|---|
| `app.metadataCache.getFileCache(file)` | `→ CachedMetadata` | 读笔记缓存，`?.frontmatter` 取属性对象 |
| `stringifyYaml(obj)` | `any → string` | 属性对象 → YAML 文本（编辑弹窗展示） |
| `parseYaml(text)` | `string → any` | YAML 文本 → 对象（保存前校验，失败抛错） |
| `app.fileManager.processFrontMatter(file, fn)` | `(TFile, (fm: any) => void) → Promise<void>` | **官方原子写回**：读-改-写 frontmatter，不碰正文 |

插件内唯一写入点（`src/views/frontmatter-modal.ts`、`src/views/panel.ts`）：

```ts
await app.fileManager.processFrontMatter(file, (fm) => {
  fm.status = '已完成';   // 增/改
  delete fm.owner;        // 删
});
```

### 2. 索引与文件

| API | 用途 |
|---|---|
| `app.metadataCache.on("changed" / "deleted" / "resolve", cb)` | 增量索引监听（scanner 首扫 + debounce 增量） |
| `app.vault.getMarkdownFiles()` | 全量首扫的文件清单 |
| `app.vault.getAbstractFileByPath(path)` | 行路径 → `TFile`（属性编辑定位文件） |

### 3. 工作区 UI

| API | 用途 |
|---|---|
| `ItemView` / `WorkspaceLeaf` | 看板面板（`setState/getState` 持久化 boardId）与侧栏视图 |
| `Modal` | frontmatter 编辑弹窗基类 |
| `Plugin` / `PluginSettingTab` / `Setting` | 插件装配与设置页 |
| `app.workspace.openLinkText(path, "", false)` | 点击文件名打开笔记 |

> 内联编辑与弹窗保存后无需手动刷新：`processFrontMatter` 触发 metadataCache 变更 →
> 插件 scanner 增量更新行仓库 → 订阅者（面板）自动重跑查询。

---

## 二、插件 API（DataShow 自身）

### 1. DSQL 查询层（`src/query/`，零 Obsidian 依赖，可直接在 Node 测试）

```ts
import { parseQuery, QueryParseError } from "src/query/parser";
import { executeQuery, evaluateExpr, compareUtf8 } from "src/query/executor";
```

| 导出 | 签名 | 说明 |
|---|---|---|
| `parseQuery(source)` | `string → Query` | DSQL → AST；错误 `QueryParseError`（带 line/col） |
| `executeQuery(q, rows, ctx, opts?)` | `→ ResultSet` | 执行：FROM→WHERE→SORT→LIMIT；`opts.debug` 收集调试信息 |
| `evaluateExpr(expr, row, ctx, track?, warn?)` | `→ FieldValue` | 单表达式求值（面板渲染单元格共用） |
| `compareUtf8(a, b)` | `(string, string) → number` | UTF-8 字节序比较（排序/自动列的确定性基准） |
| `ResultSet` | `{ view, columns, rows, debug? }` | `columns: {alias, expr}[]`；`debug` 见下 |

语法与语义见 [`data_show/docs/DSQL-EBNF.md`](data_show/docs/DSQL-EBNF.md)。

### 2. 行仓库（`src/index/store.ts`）

```ts
store.all(): DataRow[];                  // 全部行（按路径排序）
store.upsert(row) / upsertMany(rows);    // 增/批量增（批量只触发一次通知）
store.remove(path); store.count();
store.subscribe(fn): () => void;         // 订阅变更，返回退订函数
```

`DataRow = { path, file: FileMeta, fields: Record<string, FieldValue> }`（`src/types.ts`）。

### 3. 插件实例（`src/main.ts`，`this.plugin`）

| 成员 | 说明 |
|---|---|
| `settings: DatashowSettings` | `{ openInNewTab, showDebug, decimalPlaces, boards: BoardDef[] }` |
| `saveSettings()` | 持久化到 data.json；触发 `boardListeners`（侧栏联动） |
| `addBoardListener(fn)` | 看板定义变更订阅（面板外部变更同步） |
| `openBoard(boardId)` | 侧栏点击 → 打开/复用看板面板 |
| `store` | 行仓库实例（上面 §2） |

### 4. 看板定义（`BoardDef`，存于 data.json）

```jsonc
{
  "id": "uuid",
  "name": "看板名称",       // 侧栏显示名
  "type": "分组类型",       // 侧栏分组，可空
  "description": "说明",
  "sql": "**TABLE** **SELECT** ... **FROM** \"Notes\"",  // 在面板中编辑，防抖自动保存
  "viewOverride": ""        // ""（跟随语句）| "table" | "list"
}
```

### 5. 视图扩展点（规划中）

视图类型常量在 `src/types.ts` 的 `IMPLEMENTED_VIEWS`（当前 `table` / `list`）；
渲染入口为 `panel.ts` 的 `renderResultSet()`，新增视图类型在此分支。
