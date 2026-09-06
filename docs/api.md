# myLinear API 契约

> **文档性质**：单一活文档，随开发阶段持续更新。每个接口标注引入阶段（`P0` / `P1` / `P2`）。
> **上游依据**：[DATABASE_DESIGN.md](../DATABASE_DESIGN.md)（v1.3）、[docs/product-design/P0.md](./product-design/P0.md)、[docs/product-design/P1.md](./product-design/P1.md)。
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
| 400 | `LABEL_SCOPE_MISMATCH` | 标签 scope 与目标类型不匹配（如任务挂了 project 标签，规则 R6） |
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
| handler（按资源分包：workspace / member / project / task / label） | path/body → DTO 解析与格式校验、业务规则 R1~R6、PATCH presence 合并、动态排序、事务编排、组装响应模型（TaskRow/ProjectRow 等）、按 §1 错误码表写错误响应 |
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
- **读-改-写的已知限制（lost update）**：两个并发 PATCH 各自“读旧行 → 合并 → 全字段写回”，后提交者会把先提交者的非目标字段覆盖回去。**P1 已把 `GetXxx` 与后续写入收进同一事务，但这并不能防住 lost update**：READ COMMITTED 下普通 SELECT 不加锁，两个事务能读到同一旧版本，而 UPDATE 写入的是 Go 内存中基于旧版本的合并结果（事务化真正消除的是校验→写入之间的 TOCTOU，以及多写操作的原子性）。单 workspace 小团队场景接受此限制；若需严格化，三选一：
  - ① 悲观锁：`SELECT ... FOR UPDATE`。**`GetTask` / `GetProject` 带 `LEFT JOIN`，必须写 `FOR UPDATE OF 别名`**，否则 PG 报 `FOR UPDATE cannot be applied to the nullable side of an outer join`；
  - ② 乐观并发：UPDATE 追加 `AND updated_at = $读到的值`、改 `:execrows`，影响 0 行 → `409 CONFLICT` 由前端重试（需在本节登记新错误码）；
  - ③ SERIALIZABLE 隔离级别：一方报 `40001 serialization_failure`，必须配重试循环。

  注：`UpdateMember` / `UpdateWorkspace` 同为读-改-写但**刻意不开事务**——只有单条写，事务对原子性零收益、对 lost update 亦零收益。原则：事务仅在「多条写」或「校验-写需原子性」时有价值。
- 创建时“不传”与“传null”同义，都是没有这个值，所以创建时不需要三态包装

### 2.5 事务与级联速查

| 接口 | 写操作组合（顺序执行） | 显式事务 |
|------|----------------------|---------|
| POST /projects | `CreateProject` + `AddProjectMembers` + `AddProjectLabels`（后两者恒定调用，空数组 `unnest` 插 0 行） | ✔ |
| PUT /projects/:id/labels | `DeleteProjectLabels` + `AddProjectLabels`（全量替换） | ✔ |
| PATCH /projects/:id | `UpdateProject`（+ `memberIds` 出现即 `DeleteProjectMembers`，非 null 再 `AddProjectMembers`；显式 null = 只删不增） | ✔ |
| DELETE /projects/:id | `SoftDeleteProject` + `DetachProjectTasks` | ✔ |
| POST /tasks | `CreateTask` + `AddTaskLabels`（恒定调用，空数组 `unnest` 插 0 行） | ✔ |
| PUT /tasks/:id/labels | `DeleteTaskLabels` + `AddTaskLabels`（全量替换） | ✔ |
| PATCH /tasks/:id | `UpdateTask`（+ projectId 变更时 `SyncSubtreeProject`） | ✔ |
| DELETE /tasks/:id | `SoftDeleteTaskSubtree` 单条递归 CTE，天然原子 | — |
| DELETE /workspaces/:id | 仅 `DeleteWorkspace`；member/project/task/label/联结表/saved_view 全部由外键 `CASCADE` 物理级联 | — |
| DELETE /members/:id | 仅 `DeleteMember`；`project_member` 行 `CASCADE`，`assignee_id`/`lead_id`/`created_by` 由外键 `SET NULL` | — |

约定：
- 成员替换 = `DeleteProjectMembers`（按 projectId 全删）+ `AddProjectMembers`（`INSERT ... SELECT $1, unnest($2::uuid[])` 批量插入），比增量 diff 更简单可靠（单项目成员量小）。
- handler 层事务模板：`tx, _ := pool.Begin(ctx)` → `q := store.New(pool).WithTx(tx)` → 多次调用 → `tx.Commit(ctx)`（defer Rollback 兜底）。
- **事务边界**：`ShouldBindJSON` 与纯格式校验（必填字段、枚举合法性、priority 范围）留在 `pool.Begin` **之前**——畸形请求不该占用池连接与事务，也保证“畸形 body + 不存在 id”统一返 400 而非 404；所有**需要查库的校验**（lead/member/assignee 存在性、R6 标签校验、读-改-写的基准行）进事务并改用 `q`，消除校验→写入之间的 TOCTOU；`tx.Commit` 之后再用非事务 `queries` 重读装配响应。仅单条写、无查库校验的接口（POST/PATCH `/labels`、PATCH `/members/:id`、PATCH `/workspaces/:id`）**刻意不开事务**——事务只买 TOCTOU 消除与多写原子性，不防 lost update（§2.4）。
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

### 2.9 行完备原则（P2 兼容）

列表/详情响应携带**展示选项可能用到的全部字段**（P0 已有 status/priority/assignee/dueDate/project 等，P1 补 labels）。理由：P2 的 display options 面板（分组/排序/展示属性）是前端对已取回平铺行集的内存操作，切换开关不发请求：

- **不引入动态字段查询参数**（不做 `fields=...` sparse fieldsets）：sqlc 生成固定形状结构体，动态列破坏类型安全；前端响应类型退化为 Partial；TanStack Query 缓存键被展示配置污染（一切换即 refetch）。
- **saved_view.config（P2）后端 opaque 存储**：CRUD 原样存、原样返回，不解释 `visible_fields` / `group_by` / `order_by` 等键；前端读取 config 后自行应用，仅 `filters` 部分翻译成列表接口查询参数时才发请求。
- 若未来某展示属性需要行里目前没有的数据（如状态停留时长），做法是把该字段加进行契约、永远返回，仍不做动态选择。

---

## 3. 业务规则（handler 层保证，对应 DATABASE_DESIGN §6）

| # | 规则 | 落点 |
|---|------|------|
| R1 | workspace_id 一致性：task 有项目时必须与项目同 workspace | 创建/移动任务 |
| R2 | 同一项目内 lead ∉ project_member | 创建/更新项目 |
| R3 | 任务 assignee ∈ 本 workspace 成员 ∪ {空}（与项目 lead/members 解绑，对齐 Linear：项目成员仅为干系人概念，不构成指派边界） | 创建/更新任务 |
| R4 | 子任务与父任务 project 一致（父无项目则子也无项目）；移动任务 project 时同步整棵子树 | 创建/更新任务 |
| R5 | 软删 project：事务内 `deleted_at=now()` + 其下 task `project_id=NULL`（外键不触发，须显式脱离）；软删 task：单条递归 UPDATE 级联整棵子树 | 删除接口 |
| R6 | 打标（含创建时 labelIds）时 label 属同 workspace 且 scope 匹配目标类型（task_label 只引用 scope='task'，project_label 同理） | 打标 PUT / 创建 labelIds |

## 4. 对象模型

```jsonc
// Workspace
{ "id": "uuid", "name": "...", "description": "...", "createdAt": "...", "updatedAt": "..." }

// Member
{ "id": "uuid", "name": "...", "email": "... | null", "avatarColor": "#5e6ad2" }   // hex；P1 前遗留行可能为 ''

// MemberRef（嵌入用精简引用）
{ "id": "uuid", "name": "...", "avatarColor": "..." }

// LabelRef（嵌入任务/项目行，P1）
{ "id": "uuid", "name": "...", "color": "#EB5757" }

// Label（LabelRef + scope，标签管理区，P1）
{ "id": "uuid", "scope": "task | project", "name": "...", "color": "#EB5757" }

// ProjectRef（嵌入任务行）
{ "id": "uuid", "name": "..." }

// ProjectRow（项目列表行）
{
  "id": "uuid", "name": "...", "status": "backlog", "priority": 0,
  "lead": MemberRef | null,
  "startDate": "2026-08-01 | null", "targetDate": "2026-10-01 | null",
  "taskCount": 12,                       // 未软删任务数（含子任务）
  "labels": LabelRef[],                  // P1：行完备原则（§2.9）；P1 列表不渲染，P2 display options 消费
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
  "labels": LabelRef[],                  // P1：行完备原则（§2.9），列表行 chip 渲染
  "createdAt": "...", "updatedAt": "..."
}

// TaskDetail = TaskRow + { "description": "...", "parent": { "id", "title", "status", "doneCount", "totalCount" } | null }（parent 见 §8 GetTask）

// TaskNode（子树节点，subtree 接口返回，平铺 + depth）
{ "id": "uuid", "parentId": "uuid", "depth": 1,
  "title": "...", "status": "done", "priority": 0,
  "project": ProjectRef | null,            // 与父任务一致（R4）；带上使接口自包含，子任务行可直接渲染项目徽标
  "assignee": MemberRef | null, "dueDate": "... | null",
  "labels": LabelRef[] }                 // P1：子任务行与列表行同渲染
```

> 说明：列表统一返回**平铺数组**（含 `parentId`），前端负责按 status 分组与树形组装；子任务进度徽标 x/y 由前端从 subtree 数组计算（x = status='done' 的节点数，y = 节点总数）。嵌入的 labels 数组按 created_at 升序，空为 `[]`（非 null）。

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
**请求**: `{ "name": "必填", "email": "可选", "avatarColor": "必填 hex" }` → **201**: `Member`。
avatarColor 必填 + hex 校验为 P1 修订（前端调色板默认预选色，不存在无色场景；与 label.color 同一套 `IsHexColor` 校验）。
重名 → `409 NAME_CONFLICT`（唯一索引 `(workspace_id, name)` 兜底，捕获 `23505` 映射）。
→ sqlc: `CreateMember`

### PATCH /workspaces/:wid/members/:memberId `P0`
**请求**: `{ "name"?, "email"?, "avatarColor"? }`（显式 `null` 清空 email；avatarColor 传则必须 hex，显式 `null` → `400`，不允许置空）→ **200**: `Member`。
重名 → `409 NAME_CONFLICT`（同 POST，捕获 `23505` 映射）。
→ sqlc: `UpdateMember`（全字段覆盖，presence 合并）

### DELETE /workspaces/:wid/members/:memberId `P0`
硬删除；其名下任务 assignee、项目 lead、created_by 由数据库置 NULL。→ **204**（同 workspace 删除，幂等）。
→ sqlc: `DeleteMember`（仅此一条；`project_member` 行及引用字段由外键自动处理，见 §2.5）

## 7. Project 接口（嵌套于 workspace）

### GET /workspaces/:wid/projects `P0`
**参数**: `sort=name|createdAt|priority|status`（默认 `createdAt`）、`order=asc|desc`（默认 `desc`）。
**响应** `200`: `ProjectRow[]`（不含已软删）。
→ sqlc: `ListProjectsByWorkspace`：`WHERE workspace_id AND deleted_at IS NULL`；`LEFT JOIN member` 取 lead 三列；标量子查询统计未软删 taskCount；P1 增 `ListLabelsByProjectIds` 批量组装 labels（行完备原则 §2.9，列表不渲染；`ORDER BY pl.project_id, l.created_at` 保证组内升序，map 未命中的项目由 converter 兜底为 `[]`）。**排序由 handler 层内存完成**（§2.2），主查询 SQL 不带 ORDER BY

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
  "labelIds": ["uuid"],         // 可选（P1），可空数组；scope 必须为 project（R6）
  "startDate": "可选", "targetDate": "可选"
}
```
**201**: `ProjectDetail`。`leadId ∈ memberIds` → `400 LEAD_MEMBER_CONFLICT`；`name` 为空、`status`/`priority` 非法（priority 限 0~4）、`leadId`/`memberIds` 含非本工作区成员 → `400 VALIDATION_FAILED`；`labelIds` 含非本工作区标签 → `400 CROSS_WORKSPACE`，含 `scope=task` 标签 → `400 LABEL_SCOPE_MISMATCH`（R6，handler 先去重再校验）。
→ sqlc: `CreateProject` + `AddProjectMembers` + `AddProjectLabels`（同一事务，见 §2.5；leadId/memberIds/labelIds 三组查库校验均在事务内，事务边界见 §2.5）

### GET /workspaces/:wid/projects/:projectId `P0`
**响应** `200`: `ProjectDetail`（含 members 列表）。
→ sqlc: `GetProject`（`deleted_at IS NULL`）+ `ListProjectMembers`（`member JOIN project_member`）+ `ListProjectLabels`（P1 组装 labels，单项目直查，`ORDER BY l.created_at`）

### PATCH /workspaces/:wid/projects/:projectId `P0`
**请求**: 创建字段全可选；`memberIds` 为**全量替换**语义（传则整体覆盖，缺席不动；传 `[]` 或显式 `null` 均为清空全部成员）。字段合法性校验同 POST。→ **200**: `ProjectDetail`。
→ sqlc: `UpdateProject`（全字段覆盖，presence 合并）+ 传了 memberIds 时 `DeleteProjectMembers` + `AddProjectMembers`；同一事务，先校验 R2

### DELETE /workspaces/:wid/projects/:projectId `P0`
软删除（**规则 R5**）：事务内置 `deleted_at`，并将其下未软删 task 的 `project_id` 置 NULL（任务保留）。→ **204**；目标不存在（含已软删、跨工作区）→ **404**。
→ sqlc: `SoftDeleteProject`（`:execrows`，影响行数为 0 即 404；`DetachProjectTasks` 不受此约束，无关联任务影响 0 行属正常）+ `DetachProjectTasks`（同一事务；外键 SET NULL 仅对硬删生效，软删必须显式脱离，见 §2.3）

### GET /workspaces/:wid/projects/:projectId/tasks `P0`
项目详情页的任务列表。**响应** `200`: `TaskRow[]`（平铺含子任务，按 status、createdAt 排序）。
→ sqlc: `ListTasksByProject`（`deleted_at IS NULL`；`LEFT JOIN member` 取 assignee；固定排序同 §2.2 任务列表）；P1 增 `ListLabelsByTaskIds` 批量组装 labels（handler 内存分组避免 N+1，空为 []）

## 8. Task 接口（嵌套于 workspace）

### GET /workspaces/:wid/tasks `P0`
任务列表页主查询。**参数**: `filter=all|active|backlog`（默认 `all`；active = todo + in_progress）。
**响应** `200`: `TaskRow[]`（平铺含子任务，按 status 枚举序、createdAt 排序）。
→ sqlc: `ListTasksByWorkspace`：`deleted_at IS NULL` + statuses 数组可选筛选（§2.2）+ 固定排序 + `LEFT JOIN project/member` 组装 ProjectRef/assignee；走 `(workspace_id, parent_id)` 部分索引；P1 增 `ListLabelsByTaskIds` 批量取标签 handler 组装（空为 []）

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
  "dueDate": "可选",
  "labelIds": ["uuid"]          // 可选（P1），可空数组；scope 必须为 task（R6）
}
```
规则：
- 传 `parentId` → 子任务，`projectId` 忽略并继承父任务（R4），workspace 取父任务的（R1）
- 传 `projectId` → 校验项目属于该 workspace（否则 `400 CROSS_WORKSPACE`）
- 传 `assigneeId` → 校验为本工作区成员（R3，否则 `400 INVALID_ASSIGNEE`）
- 传 `labelIds` → 含非本工作区标签 `400 CROSS_WORKSPACE`，含 `scope=project` 标签 `400 LABEL_SCOPE_MISMATCH`（R6，handler 先去重再校验）

**201**: `TaskDetail`。
→ sqlc: `CreateTask` + `AddTaskLabels`（同一事务，见 §2.5；workspace_id 由 handler 层解析写入：传 parentId → 继承父任务；传 projectId → 取项目所在 workspace；否则取路径 wid）

### GET /workspaces/:wid/tasks/:taskId `P0`
**响应** `200`: `TaskDetail`（含 `parent: {id, title, status, doneCount, totalCount} | null`：父任务引用及其**后代**完成统计，供子任务详情页 "Sub-issue of" 行渲染；无父为 null）。
→ sqlc: `GetTask`（`id + workspace_id + deleted_at IS NULL` 三条件，未命中即 404；`LEFT JOIN task pt` 取父 status/title + 顶层递归 CTE 聚合父任务后代统计，口径同 §4 徽标）+ `ListTaskLabels`（P1 组装 labels，单任务直查，`ORDER BY l.created_at`）

### GET /workspaces/:wid/tasks/:taskId/subtree `P0`
子任务区数据源。**响应** `200`: `TaskNode[]`（递归 CTE 取全部后代，按 depth、createdAt 排序；前端组装两层树并计算 x/y 徽标）。
→ sqlc: `IfTaskExist`（锚点存在性）+ `GetTaskSubtree`：单条 `WITH RECURSIVE`（锚点 = 自身 depth 0，输出 `depth > 0` 的全部后代；`ORDER BY depth, created_at`；`LEFT JOIN project/member` 取 project/assignee 引用；全程 `deleted_at IS NULL`）；P1 增 `ListLabelsByTaskIds` 组装子任务行 labels。
锚点必须先单独判存在：子树查询只输出 `depth > 0`，“无子任务”与“任务不存在”同样返回空数组，不先区分就无法给 404。用 `IfTaskExist`（`EXISTS` 点查）而不用 `GetTask`——后者带 3 个 `LEFT JOIN` + 父任务统计递归 CTE，仅用于存在性判断太重。

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

## 9. Label 接口（嵌套于 workspace） `P1`

> schema 已在初始迁移就绪（label / task_label / project_label，唯一约束 `(workspace_id, scope, name)`），本阶段无新迁移。label 硬删除，联结行由外键 CASCADE（DATABASE_DESIGN §5）。

### GET /workspaces/:wid/labels `P1`
**参数**: `scope=task|project` 可选，缺席返回该 workspace 全部标签。
**响应** `200`: `Label[]`（created_at 升序）。
→ sqlc: `ListLabelsByWorkspace` / `ListLabelsByWorkspaceAndScope`（scope 缺席走前者；枚举参数不可传空串——PG 枚举转换报错——故拆两条查询而非 NULL 哨兵）

### POST /workspaces/:wid/labels `P1`
**请求**: `{ "name": "必填", "color": "#EB5757 必填", "scope": "task|project 必填" }` → **201**: `Label`。
同 scope 重名 → `409 NAME_CONFLICT`（唯一索引兜底，捕获 `23505` 映射）；name 为空、color 非 hex、scope 非法 → `400 VALIDATION_FAILED`。
→ sqlc: `CreateLabel`

### PATCH /workspaces/:wid/labels/:labelId `P1`
**请求**: `{ "name"?, "color"? }`（presence 合并，§2.4）→ **200**: `Label`。重名 → `409` 同 POST。
→ sqlc: `UpdateLabel`（全字段覆盖）

### DELETE /workspaces/:wid/labels/:labelId `P1`
硬删除；task_label / project_label 联结行由外键 CASCADE，任务/项目本体不受影响。→ **204**（同 workspace 删除，幂等）。
→ sqlc: `DeleteLabel`

### PUT /workspaces/:wid/tasks/:taskId/labels `P1`
**请求**: `{ "labelIds": ["uuid"] }`（**全量替换**语义）。三态同 PATCH（§2.4）：字段**缺席 = 不动**（仍做存在性校验并返 200 + 当前 TaskDetail）；`[]` 与**显式 `null` 均 = 清空全部标签**。
规则（R6）：labelIds 含非本 workspace 标签 → `400 CROSS_WORKSPACE`；含 scope='project' 标签 → `400 LABEL_SCOPE_MISMATCH`；任务不存在（含已软删、跨工作区）→ `404`。
**200**: `TaskDetail`（带新 labels，前端直接更新缓存）。
→ sqlc: `IfTaskExist` + `DeleteTaskLabels` + `AddTaskLabels`（同一事务，见 §2.5）；R6 校验经 `ListLabelScopesByIds`。四个打标入口（两个 POST 的 labelIds + 两个 PUT）统一走 label 包 `CheckLabelIDsLegal`：内含纯校验核心 `ValidateAndDedupeLabelIDs`（去重 + 命中行数不足 = CROSS_WORKSPACE、scope 不符 = LABEL_SCOPE_MISMATCH），并集中做 §1 错误码映射——错误码是对外契约，不得在四个 handler 里各抄一遍

### PUT /workspaces/:wid/projects/:projectId/labels `P1`
同任务打标（三态同；scope='task' 标签 → `LABEL_SCOPE_MISMATCH`；项目不存在含已软删 → `404`）。**200**: `ProjectDetail`。
→ sqlc: `IfProjectExists` + `DeleteProjectLabels` + `AddProjectLabels`（同一事务）；R6 校验同上走 `CheckLabelIDsLegal`

### 创建时 labelIds `P1`
POST /tasks 与 POST /projects 请求体新增可选 `labelIds: []`，校验规则同上述 PUT，联结行与创建同一事务写入（见 §2.5）。**两个 PATCH 接口均不含 label 字段**：标签变更统一走上表 PUT 子资源，避免两套替换语义入口。

---

## 10. 后序阶段接口索引

- **P2**：saved_view CRUD（`/workspaces/:wid/views`）；列表接口筛选参数扩展（statuses 数组机制照抄扩展 `label_ids` / `assignee_ids` 等，§2.2）；展示选项（分组/排序/展示属性）纯前端无接口（§2.9）
- **P3+**：拖拽排序、行内编辑复用 PATCH（无新接口）；标签就地创建复用 POST /labels
