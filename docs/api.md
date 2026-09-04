# myLinear API 契约

> **文档性质**：单一活文档，随开发阶段持续更新。每个接口标注引入阶段（`P0` / `P1` / `P2`）。
> **上游依据**：[DATABASE_DESIGN.md](../DATABASE_DESIGN.md)（v1.3）、[docs/product-design/P0.md](./product-design/P0.md)。
> **实现链**：本文档 → `db/queries/*.sql`（sqlc）→ Gin handler（业务规则内化于此，见 §2.1）。每个接口标注对应的 sqlc 查询名。

---

## 1. 通用约定

| 项目 | 约定 |
|------|------|
| Base URL | `/api/v1`（版本前缀为未来演进预留） |
| 数据格式 | JSON，字段 camelCase |
| ID | uuid 字符串 |
| 时间戳 | RFC3339（`timestamptz`，如 `2026-08-27T10:30:00+08:00`） |
| 业务日期 | `YYYY-MM-DD`（`date`，如 `2026-10-01`） |
| 鉴权 | 无（P4 引入，路由结构已按 workspace 嵌套预留中间件挂载点） |
| 分页 | P0 不做（个人数据量）；未来加 `cursor` 参数 |

**运维端点**：`GET /healthz`（挂在 `/api/v1` 之外）：探活 + 数据库连通性检查，200 `{"status":"ok"}`；库不可达 → 503 `DB_UNREACHABLE`。

**PATCH 语义**：部分更新。字段**缺席 = 不修改**；字段**传了值（含零值、空串）= 一定更新**；可空字段传显式 `null` = **置空**（如 `{"leadId": null}` 表示移除负责人）。合并实现采用 presence 模式，见 §2.4。

**成功状态码**：`GET`/`PATCH` → 200；`POST` → 201；`DELETE` → 204（无响应体）。

**错误格式**：

```json
{ "error": { "code": "NAME_CONFLICT", "message": "同工作区内成员名重复" } }
```

| HTTP | code | 场景 |
|------|------|------|
| 400 | `VALIDATION_FAILED` | 字段校验失败（缺必填、格式错） |
| 400 | `LEAD_MEMBER_CONFLICT` | lead 同时出现在 members 中（规则 R2） |
| 400 | `INVALID_ASSIGNEE` | assignee 不是本工作区成员（规则 R3） |
| 400 | `CROSS_WORKSPACE` | 引用的资源不属于该 workspace |
| 404 | `NOT_FOUND` | 资源不存在或已软删 |
| 409 | `NAME_CONFLICT` | 违反唯一约束（workspace 内成员重名等）；捕获 PG 错误码 `23505` 映射 |
| 500 | `INTERNAL` | 未预期服务端错误的兜底（数据库失败等） |

设计理由（为什么错误体嵌套一层 `error`，而非平铺 `{code, message}`）：

- **判别性**：`error` 键即判别标签——成功响应永远不含此键，前端 `'error' in body` 即可区分成败；平铺则只能靠“是否碰巧有 code 字段”猜测，且业务对象若自带 code 字段（如优惠码）会撞名。
- **命名空间与可扩展**：`details`（字段级错误）、`traceId` 等扩展字段只在 `error.*` 内部生长，响应顶层形状不变。
- **分层分工**：HTTP 状态码表达成败大类（粒度粗，一个 400 涵盖多种失败）；`error.code` 提供机器可读的细类供前端分支处理，`error.message` 给人看。
- **成功响应不包信封**（不写 `{data: ...}`）：成功调用占绝大多数，裸放数据更简洁。此为 Stripe/GitHub 风格；业界另有统一信封派（JSON-RPC）与 RFC 7807 标准（`application/problem+json`），本项目均不采用。

## 2. 实现约定（sqlc / 分层）

> sqlc 不是 ORM：没有自动 `updated_at`、没有软删过滤、没有零值省略——一切在 SQL 与 Go 代码中**显式**表达。本节统一各接口的实现模式，下文接口处只标注差异点。

### 2.1 分层职责

| 层 | 职责 |
|----|------|
| handler（按资源分包：workspace / member / project / task） | path/body → DTO 解析与格式校验、业务规则 R1~R5、PATCH presence 合并、动态排序、事务编排、组装响应模型（TaskRow/ProjectRow 等）、按 §1 错误码表写错误响应 |
| store（sqlc） | 单条 SQL 的类型安全执行；跨表写操作由 handler 编排多条 sqlc 调用，用 `store.New(pool).WithTx(tx)` 串成事务 |

> P0 未拆独立 service 包（`internal/service/` 目录预留）：业务规则与编排职责内化于各资源的 handler 中。本文档后续的业务规则落点均指 handler 层。

### 2.2 筛选与排序

- **筛选下沉 SQL**，用数组参数表达可选枚举集合（空数组 = 不过滤）：

  ```sql
  AND (cardinality(sqlc.arg('statuses')::task_status[]) = 0
       OR status = ANY(sqlc.arg('statuses')::task_status[]))
  ```

  handler 层映射：`filter=all → {}`、`active → {todo,in_progress}`、`backlog → {backlog}`。空筛选语义必须传**非 nil 空切片**（`[]store.TaskStatus{}`，不能传 nil），枚举数组参数的 pgx 类型注册与 nil 切片陷阱见 §2.8。
- **固定排序写死 SQL**。任务列表统一为（status 枚举序 + created_at 升序）：

  ```sql
  ORDER BY CASE status WHEN 'backlog' THEN 1 WHEN 'todo' THEN 2 WHEN 'in_progress' THEN 3
           WHEN 'done' THEN 4 ELSE 5 END, created_at
  ```

- **动态排序放 handler 层**（仅项目列表 `sort`/`order`）：PG 不支持 `ORDER BY` 列名参数化，P0 不分页且数据量小，查出后按白名单字段（`name/createdAt/priority/status`）内存排序，SQL 不写 ORDER BY。`status` 按生命周期业务序（backlog → planned → in_progress → completed → canceled）而非字典序；同值项保持原相对顺序（稳定排序）。

### 2.3 审计字段与软删

- 每条 UPDATE 显式 `SET updated_at = NOW()`；INSERT 依赖列默认值即可。
- task / project 的所有 Get / List / Update 显式 `deleted_at IS NULL`（已软删 = 404 / 不出现在列表 / 不可更新）。
- 嵌套路由下，Get / Update / Delete 均带 `workspace_id` 双条件（如 `WHERE id = $1 AND workspace_id = $2`），防跨 workspace 访问，未命中即 404。
- **硬删 ≠ 软删**：外键 `ON DELETE CASCADE / SET NULL` 只在**物理 DELETE** 时触发；软删是 UPDATE，不触发任何外键动作，级联效果必须显式写 SQL。

### 2.4 PATCH 合并（presence 模式）

统一语义：**字段传了（含零值、空串）必更新；没传不动；可空字段显式 `null` = 置空**。
Go 的 `encoding/json` 无法区分"缺席"与"显式 null"（指针都解为 `nil`），因此：

1. 请求 DTO 全部字段用泛型三态包装 `handler.Nullable[T]`（`internal/handler/wrapper.go`）：

   ```go
   type Nullable[T any] struct {
       Set   bool // 字段是否出现（UnmarshalJSON 被调用即 true）
       Valid bool // 是否非 null
       Value T
   }

   type UpdateMemberDTO struct {
       Name        handler.Nullable[string] `json:"name"`
       Email       handler.Nullable[string] `json:"email"`
       AvatarColor handler.Nullable[string] `json:"avatarColor"`
   }
   ```

   三态判定：字段缺席 → `UnmarshalJSON` 不被调用，`Set=false`；显式 `null` → `Set=true, Valid=false`；有值（含空串/空数组） → `Set=true, Valid=true, Value=值`。

2. handler 层**读-改-写**：`GetXxx` 取旧记录 → 仅应用 `Set=true` 的字段（`Valid=false` = 置空）→ 调用全字段覆盖式 `UpdateXxx`。
3. Update 类 SQL 一律全字段覆盖（可编辑字段全集），sqlc Params 由实体直接填充，不做逐字段 COALESCE。
4. 显式 `null` 的落库值取决于列可空性：可空列（email / leadId / assigneeId / dueDate / startDate / targetDate / projectId）写 `NULL`；`NOT NULL DEFAULT ''` 列（description / avatarColor）写空串。

开发心得（三态与读-改-写的选型依据）：

- **更新时“不传”与“传 null”必须区分**：若不区分（如 `nil` 一律 = 不更新），则没有“清空”通道——任务移出项目、取消指派、清除截止日期都是一等功能，数据库中已有值必须能更新成 NULL。
- 业界对照：PUT 全量替换天然支持三态，但并发下整对象互相覆盖；GraphQL 在协议层即可区分 absent 与 null（Linear 本身即如此）；REST + PATCH 只能手工做 presence 追踪，本项目 DTO 的 `Nullable[T].Set` 就是这个追踪。
- **读-改-写的已知限制**：两个并发 PATCH 各自“读旧行 → 合并 → 全字段写回”，后提交者会把先提交者的非目标字段覆盖回去。P0 单 workspace 小团队场景接受此限制；若需严格化，在同一事务内用 `SELECT ... FOR UPDATE` 锁住旧行即可。
- 创建时“不传”与“传null”同义，都是没有这个值，所以创建时不需要三态包装

### 2.5 事务与级联速查

| 接口 | 写操作组合（顺序执行） | 显式事务 |
|------|----------------------|---------|
| POST /projects | `CreateProject` + `AddProjectMembers` | ✔ |
| PATCH /projects/:id | `UpdateProject`（+ 传了 memberIds 时 `DeleteProjectMembers` + `AddProjectMembers`） | ✔ |
| DELETE /projects/:id | `SoftDeleteProject` + `DetachProjectTasks` | ✔ |
| PATCH /tasks/:id | `UpdateTask`（+ projectId 变更时 `SyncSubtreeProject`） | ✔ |
| DELETE /tasks/:id | `SoftDeleteTaskSubtree` 单条递归 CTE，天然原子 | — |
| DELETE /workspaces/:id | 仅 `DeleteWorkspace`；member/project/task/label/联结表/saved_view 全部由外键 `CASCADE` 物理级联 | — |
| DELETE /members/:id | 仅 `DeleteMember`；`project_member` 行 `CASCADE`，`assignee_id`/`lead_id`/`created_by` 由外键 `SET NULL` | — |

约定：
- 成员替换 = `DeleteProjectMembers`（按 projectId 全删）+ `AddProjectMembers`（`INSERT ... SELECT $1, unnest($2::uuid[])` 批量插入），比增量 diff 更简单可靠（单项目成员量小）。
- handler 层事务模板：`tx, _ := pool.Begin(ctx)` → `q := store.New(pool).WithTx(tx)` → 多次调用 → `tx.Commit(ctx)`（defer Rollback 兜底）。
- 唯一约束冲突（如成员重名）由数据库兜底：捕获 PG 错误码 `23505` → 映射 `409 NAME_CONFLICT`。

### 2.6 sqlc 类型映射（可空列配置）

目标：可空列一律生成指针（`*time.Time` / `*uuid.UUID` / `*civil.Date` / `*string`），业务代码只判 nil，不碰 pgtype 包装类型。sqlc.yaml 配置规则（均经实测验证）：

- `emit_pointers_for_null_types: true` **只对无 override 的类型生效**（text 等可空列靠它得到 `*string`）。
- 有 override 的类型（uuid / timestamptz / date / jsonb）**必须自写 `nullable: true` 规则**；缺失时可空列回退为 pgtype 包装（`pgtype.UUID`、`pgtype.Date`），而不是“基础类型 + 指针”。
- **双指针陷阱**：timestamptz 的 nullable 规则若写字符串 `"*time.Time"`，会被二次指针化为 `**time.Time`（time.Time 是 sqlc 内置认识的类型）；必须改用结构化 go_type：

  ```yaml
  - db_type: "timestamptz"
    nullable: true
    go_type:
      import: "time"
      type: "Time"
      pointer: true
  ```

  uuid 与 date 不受此坑影响（`"*github.com/google/uuid.UUID"`、`"*cloud.google.com/go/civil.Date"` 为外部包路径，按不透明字符串直接采用；date 的契约语义见 §2.7）。
- 基本类型不可写 `"*string"`（报 not a Go basic type）——可空 text 只能靠 `emit_pointers_for_null_types`。
- **验证方法**：改配置后 `sqlc generate` 成功不代表类型正确，必须检查 models.go 中代表性可空列（date / timestamptz / uuid / text 各挑一个）是否为单指针。

### 2.7 业务日期（date 列）：civil.Date 一贯到底

契约：`date` 列（startDate / targetDate / dueDate）在 wire 上是 `YYYY-MM-DD`（§1）。实现机制：

- **语义**：`date` 是无时区日历日，不是“时刻”。`time.Time` 带时区且 `encoding/json` 对其钉死 RFC3339，直接当 wire 类型会同时造成格式错配（前端传 `YYYY-MM-DD` 被 400）与时区串日隐患（本地零点 ↔ UTC 零点换算后日期差一天）。
- **类型**：`date` 列经 sqlc override 映射为 `cloud.google.com/go/civil.Date`（需 ≥ v0.120.0），store 层、DTO、响应模型共用同一类型，**三层零转换**：
  - JSON：civil.Date 实现 `encoding.TextMarshaler`，`encoding/json` 对其实现按字符串编解码 → 只收/只产 `YYYY-MM-DD`，非法值（含 RFC3339 全时间戳）由绑定层 400 拒绝。
  - DB：实现 `sql.Scanner` / `driver.Valuer`，pgx 直接编解码（Scan 收 pgx 解出的 `time.Time`；Value 产 `"YYYY-MM-DD"` 字符串写入 date 列）。
- **PATCH 三态**：可空日期字段用 `handler.Nullable[civil.Date]`；presence 合并一行 `got.X = req.X.ValuePtr()`（Set 且 Valid → 取指针；显式 `null` → nil 置空；缺席 → 外层 `if .Set` 挡住不动）。
- 对照：`timestamptz`（createdAt / updatedAt 等）是真正的时刻，保持 `time.Time`，不走本节规则。

### 2.8 自定义枚举数组参数：pgx 连接级类型注册

现象：枚举数组参数（如 `sqlc.arg('statuses')::task_status[]`）运行时 500，报 `unable to encode []store.TaskStatus ... unknown type (OID xxxx): cannot find encode plan`。该问题曾潜伏在 `ListTasksByWorkspace` 中直到任务列表接口首次被调用才暴露。

- **根因**：pgx v5 默认 TypeMap 不含数据库自定义枚举类型。单值枚举参数（如 CreateTask 的 status）能正常工作只是侥幸——Go named type 的底层 string 回退编码机制兜底了；数组参数要求对应 OID 上注册了 `ArrayCodec`，没有此回退，直接编码失败。
- **处理**：连接池创建时逐连接注册类型（已在 `cmd/server/main.go` 落地，实测 pgx v5.10 通过）：

  ```go
  poolCfg, err := pgxpool.ParseConfig(cfg.DatabaseURL)
  poolCfg.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
      types, err := conn.LoadTypes(ctx, []string{
          "task_status", "_task_status",
          "project_status", "_project_status",
          "label_scope", "_label_scope",
          "view_entity", "_view_entity",
      })
      if err != nil {
          return fmt.Errorf("load enum types: %w", err)
      }
      conn.TypeMap().RegisterTypes(types)
      return nil
  }
  pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
  ```

  要点：
  - 数组类型名带下划线前缀（`_task_status`）；`LoadTypes` 的递归 CTE 自动保证元素类型先于数组注册（数组 Codec 构建时要在 TypeMap 找到元素类型，顺序反了会报错），枚举与其数组一起传入即可，无需手工排序。
  - **新增自定义枚举时必须同步加入此清单**，否则用到其数组参数的接口会重蹈覆辙。
  - 替代方案（未采用）：SQL 改 `::text[]` + Go 传 `[]string`，省去注册但失去 sqlc 类型安全。
- **配套的 nil 切片陷阱**：`cardinality(sqlc.arg('statuses'))=0` 表示“空筛选”，Go 侧必须传**非 nil 空切片**（`[]store.TaskStatus{}`）；传 nil 会被 pgx 编成 SQL NULL，`cardinality(NULL)=NULL` 使整个谓词为 NULL，查询静默返回空集（不报错，最难排查）。

---

## 3. 业务规则（handler 层保证，对应 DATABASE_DESIGN §6）

| # | 规则 | 落点 |
|---|------|------|
| R1 | workspace_id 一致性：task 有项目时必须与项目同 workspace | 创建/移动任务 |
| R2 | 同一项目内 lead ∉ project_member | 创建/更新项目 |
| R3 | 任务 assignee ∈ 本 workspace 成员 ∪ {空}（与项目 lead/members 解绑，对齐 Linear：项目成员仅为干系人概念，不构成指派边界） | 创建/更新任务 |
| R4 | 子任务与父任务 project 一致（父无项目则子也无项目）；移动任务 project 时同步整棵子树 | 创建/更新任务 |
| R5 | 软删 project：事务内 `deleted_at=now()` + 其下 task `project_id=NULL`（外键不触发，须显式脱离）；软删 task：单条递归 UPDATE 级联整棵子树 | 删除接口 |

## 4. 对象模型

```jsonc
// Workspace
{ "id": "uuid", "name": "...", "description": "...", "createdAt": "...", "updatedAt": "..." }

// Member
{ "id": "uuid", "name": "...", "email": "... | null", "avatarColor": "#5e6ad2 | ''" }

// MemberRef（嵌入用精简引用）
{ "id": "uuid", "name": "...", "avatarColor": "..." }

// ProjectRef（嵌入任务行）
{ "id": "uuid", "name": "..." }

// ProjectRow（项目列表行）
{
  "id": "uuid", "name": "...", "status": "backlog", "priority": 0,
  "lead": MemberRef | null,
  "startDate": "2026-08-01 | null", "targetDate": "2026-10-01 | null",
  "taskCount": 12,                       // 未软删任务数（含子任务）
  "createdAt": "...", "updatedAt": "..."
}

// ProjectDetail = ProjectRow + { "description": "...", "members": MemberRef[] }

// TaskRow（列表行）
{
  "id": "uuid", "parentId": "uuid | null",
  "title": "...", "status": "todo", "priority": 0,
  "project": ProjectRef | null,
  "assignee": MemberRef | null,
  "dueDate": "2026-10-01 | null",
  "createdAt": "...", "updatedAt": "..."
}

// TaskDetail = TaskRow + { "description": "...", "parent": { "id", "title", "status", "doneCount", "totalCount" } | null }（parent 见 §8 GetTask）

// TaskNode（子树节点，subtree 接口返回，平铺 + depth）
{ "id": "uuid", "parentId": "uuid", "depth": 1,
  "title": "...", "status": "done", "priority": 0,
  "project": ProjectRef | null,            // 与父任务一致（R4）；带上使接口自包含，子任务行可直接渲染项目徽标
  "assignee": MemberRef | null, "dueDate": "... | null" }
```

> 说明：列表统一返回**平铺数组**（含 `parentId`），前端负责按 status 分组与树形组装；子任务进度徽标 x/y 由前端从 subtree 数组计算（x = status='done' 的节点数，y = 节点总数）。

---

## 5. Workspace 接口

### GET /workspaces `P0`
侧边栏列表。**响应** `200`: `Workspace[]`（按 createdAt 升序）。
→ sqlc: `ListWorkspaces`（`ORDER BY created_at ASC`）

### POST /workspaces `P0`
**请求**: `{ "name": "...", "description": "可选" }` → **201**: `Workspace`。
→ sqlc: `CreateWorkspace`

### GET /workspaces/:workspaceId `P0`
**响应** `200`: `Workspace`。
→ sqlc: `GetWorkspace`

### PATCH /workspaces/:workspaceId `P0`
**请求**: `{ "name"?: "...", "description"?: "..." }` → **200**: `Workspace`。
→ sqlc: `UpdateWorkspace`（全字段覆盖；handler 读-改-写 presence 合并，见 §2.4）

### DELETE /workspaces/:workspaceId `P0`
硬删除，级联其下全部数据（毁灭性操作，前端需二次确认）。→ **204**（`:exec` 不校验行数，目标不存在同样返回 204，幂等）。
→ sqlc: `DeleteWorkspace`（仅此一条物理 DELETE；全部子表由外键 `CASCADE` 级联，无需各表删除方法，见 §2.5）

## 6. Member 接口（嵌套于 workspace）

### GET /workspaces/:wid/members `P0`
**响应** `200`: `Member[]`（按 name 排序）。
→ sqlc: `ListMembersByWorkspace`（`ORDER BY name`）

### POST /workspaces/:wid/members `P0`
**请求**: `{ "name": "必填", "email": "可选", "avatarColor": "可选" }` → **201**: `Member`。
重名 → `409 NAME_CONFLICT`（唯一索引 `(workspace_id, name)` 兜底，捕获 `23505` 映射）。
→ sqlc: `CreateMember`

### PATCH /workspaces/:wid/members/:memberId `P0`
**请求**: `{ "name"?, "email"?, "avatarColor"? }`（显式 `null` 清空 email）→ **200**: `Member`。
重名 → `409 NAME_CONFLICT`（同 POST，捕获 `23505` 映射）。
→ sqlc: `UpdateMember`（全字段覆盖，presence 合并）

### DELETE /workspaces/:wid/members/:memberId `P0`
硬删除；其名下任务 assignee、项目 lead、created_by 由数据库置 NULL。→ **204**（同 workspace 删除，幂等）。
→ sqlc: `DeleteMember`（仅此一条；`project_member` 行及引用字段由外键自动处理，见 §2.5）

## 7. Project 接口（嵌套于 workspace）

### GET /workspaces/:wid/projects `P0`
**参数**: `sort=name|createdAt|priority|status`（默认 `createdAt`）、`order=asc|desc`（默认 `desc`）。
**响应** `200`: `ProjectRow[]`（不含已软删）。
→ sqlc: `ListProjectsByWorkspace`：`WHERE workspace_id AND deleted_at IS NULL`；`LEFT JOIN member` 取 lead 三列；标量子查询统计未软删 taskCount。**排序由 handler 层内存完成**（§2.2），SQL 不带 ORDER BY

### POST /workspaces/:wid/projects `P0`
**请求**:
```jsonc
{
  "name": "必填",
  "description": "可选",
  "status": "backlog",          // 前端必传，默认 backlog
  "priority": 0,                // 前端必传，默认 0
  "leadId": "uuid | null",
  "memberIds": ["uuid"],        // 可空数组
  "startDate": "可选", "targetDate": "可选"
}
```
**201**: `ProjectDetail`。`leadId ∈ memberIds` → `400 LEAD_MEMBER_CONFLICT`；`name` 为空、`status`/`priority` 非法（priority 限 0~4）、`leadId`/`memberIds` 含非本工作区成员 → `400 VALIDATION_FAILED`。
→ sqlc: `CreateProject` + `AddProjectMembers`（同一事务，见 §2.5）

### GET /workspaces/:wid/projects/:projectId `P0`
**响应** `200`: `ProjectDetail`（含 members 列表）。
→ sqlc: `GetProject`（`deleted_at IS NULL`）+ `ListProjectMembers`（`member JOIN project_member`）

### PATCH /workspaces/:wid/projects/:projectId `P0`
**请求**: 创建字段全可选；`memberIds` 为**全量替换**语义（传则整体覆盖，缺席不动；传 `[]` 或显式 `null` 均为清空全部成员）。字段合法性校验同 POST。→ **200**: `ProjectDetail`。
→ sqlc: `UpdateProject`（全字段覆盖，presence 合并）+ 传了 memberIds 时 `DeleteProjectMembers` + `AddProjectMembers`；同一事务，先校验 R2

### DELETE /workspaces/:wid/projects/:projectId `P0`
软删除（**规则 R5**）：事务内置 `deleted_at`，并将其下未软删 task 的 `project_id` 置 NULL（任务保留）。→ **204**；目标不存在（含已软删、跨工作区）→ **404**。
→ sqlc: `SoftDeleteProject`（`:execrows`，影响行数为 0 即 404；`DetachProjectTasks` 不受此约束，无关联任务影响 0 行属正常）+ `DetachProjectTasks`（同一事务；外键 SET NULL 仅对硬删生效，软删必须显式脱离，见 §2.3）

### GET /workspaces/:wid/projects/:projectId/tasks `P0`
项目详情页的任务列表。**响应** `200`: `TaskRow[]`（平铺含子任务，按 status、createdAt 排序）。
→ sqlc: `ListTasksByProject`（`deleted_at IS NULL`；`LEFT JOIN member` 取 assignee；固定排序同 §2.2 任务列表）

## 8. Task 接口（嵌套于 workspace）

### GET /workspaces/:wid/tasks `P0`
任务列表页主查询。**参数**: `filter=all|active|backlog`（默认 `all`；active = todo + in_progress）。
**响应** `200`: `TaskRow[]`（平铺含子任务，按 status 枚举序、createdAt 排序）。
→ sqlc: `ListTasksByWorkspace`：`deleted_at IS NULL` + statuses 数组可选筛选（§2.2）+ 固定排序 + `LEFT JOIN project/member` 组装 ProjectRef/assignee；走 `(workspace_id, parent_id)` 部分索引

### POST /workspaces/:wid/tasks `P0`
**请求**:
```jsonc
{
  "title": "必填",
  "description": "可选",
  "status": "todo",             // 前端必传（默认选中点击的分组）
  "priority": 0,                // 前端必传，默认 0
  "projectId": "uuid | null",   // 可选：任务可不归属项目
  "parentId": "uuid | null",    // 可选：创建子任务
  "assigneeId": "uuid | null",
  "dueDate": "可选"
}
```
规则：
- 传 `parentId` → 子任务，`projectId` 忽略并继承父任务（R4），workspace 取父任务的（R1）
- 传 `projectId` → 校验项目属于该 workspace（否则 `400 CROSS_WORKSPACE`）
- 传 `assigneeId` → 校验为本工作区成员（R3，否则 `400 INVALID_ASSIGNEE`）

**201**: `TaskDetail`。
→ sqlc: `CreateTask`（workspace_id 由 handler 层解析写入：传 parentId → 继承父任务；传 projectId → 取项目所在 workspace；否则取路径 wid）

### GET /workspaces/:wid/tasks/:taskId `P0`
**响应** `200`: `TaskDetail`（含 `parent: {id, title, status, doneCount, totalCount} | null`：父任务引用及其**后代**完成统计，供子任务详情页 "Sub-issue of" 行渲染；无父为 null）。
→ sqlc: `GetTask`（`id + workspace_id + deleted_at IS NULL` 三条件，未命中即 404；`LEFT JOIN task pt` 取父 status/title + 顶层递归 CTE 聚合父任务后代统计，口径同 §4 徽标）

### GET /workspaces/:wid/tasks/:taskId/subtree `P0`
子任务区数据源。**响应** `200`: `TaskNode[]`（递归 CTE 取全部后代，按 depth、createdAt 排序；前端组装两层树并计算 x/y 徽标）。
→ sqlc: `GetTaskSubtree`：单条 `WITH RECURSIVE`（锚点 = 自身 depth 0，输出 `depth > 0` 的全部后代；`ORDER BY depth, created_at`；`LEFT JOIN project/member` 取 project/assignee 引用；全程 `deleted_at IS NULL`）

### PATCH /workspaces/:wid/tasks/:taskId `P0`
**请求**: `{ "title"?, "description"?, "status"?, "priority"?, "assigneeId"?, "dueDate"?, "projectId"? }`
规则：
- `projectId` 变更（含置空）→ 事务内同步整棵子树的 project（R4）；跨 workspace 值 → `400 CROSS_WORKSPACE`
- `assigneeId` 变更 → 校验为本工作区成员（R3）

**200**: `TaskDetail`。
→ sqlc: `UpdateTask`（全字段覆盖，presence 合并）+ projectId 变更时 `SyncSubtreeProject`（`WITH RECURSIVE` 收集后代批量置 project_id）；同一事务

### DELETE /workspaces/:wid/tasks/:taskId `P0`
软删除（**规则 R5**）：单条递归 UPDATE 级联整棵子树。→ **204**；目标不存在（含已软删、跨工作区）→ **404**。
→ sqlc: `SoftDeleteTaskSubtree`（单条 `WITH RECURSIVE` CTE：锚点含自身 + 全部未软删后代，`SET deleted_at = NOW()`；天然原子，无需显式事务）

---

## 9. 后序阶段接口（占位索引）

- **P1**：Label CRUD（`GET/POST/PATCH/DELETE /workspaces/:wid/labels?scope=task|project`）、任务/项目打标（`PUT .../tasks/:id/labels`、`PUT .../projects/:id/labels` 全量替换）、内置视图（纯前端，无接口）
- **P2**：saved_view CRUD（`/workspaces/:wid/views`）、任务/项目列表的过滤器参数扩展
- **P3+**：拖拽排序、行内编辑复用 PATCH（无新接口）
