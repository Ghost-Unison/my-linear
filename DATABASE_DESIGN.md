# myLinear 数据库设计文档

> 版本：v1.4（定稿）
> 变更：v1.2 task 独立实体化（project_id 可空 + workspace_id 直挂）；v1.3 saved_view 增加 entity_type / description；**v1.4 saved_view 增加 surface（view_surface 四值枚举）+ 可空 project_id（project_issues 面项目级 scope），索引改建 (workspace_id, surface, entity_type)**
> 目标数据库：PostgreSQL 17（本地 Docker 实例）
> 设计方式：database-first，goose 迁移文件为唯一 schema 真相，sqlc 生成类型安全的查询代码

---

## 1. 全局约定

| 项目 | 决策 |
|------|------|
| 主键 | `uuid`，默认 `gen_random_uuid()`（PG 13+ 内置，无需扩展） |
| 时间戳 | `created_at` / `updated_at` 用 `timestamptz`，默认 `now()` |
| 业务日期 | `date`（project.start_date / target_date，task.due_date） |
| 软删除 | 仅 task / project（`deleted_at timestamptz NULL`），其余表硬删除 |
| 排序 | 不落库。查询时按 `title` / `created_at` / `priority` / `status` / `assignee` 等字段排序；未来若需看板拖拽排序再通过迁移加 `sort_order` |
| 多租户预留 | 业务表均挂 `workspace_id`；`member.user_id` 预留绑定登录账号；project / task 带 `created_by` |
| 优先级 | 不入枚举表，统一 `smallint` + `CHECK (BETWEEN 0 AND 4)`：0=无 1=紧急 2=高 3=中 4=低 |

## 2. 枚举定义

```sql
CREATE TYPE task_status AS ENUM
  ('backlog', 'todo', 'in_progress', 'done', 'canceled');

CREATE TYPE project_status AS ENUM
  ('backlog', 'planned', 'in_progress', 'completed', 'canceled');

CREATE TYPE label_scope AS ENUM
  ('task', 'project');

CREATE TYPE view_entity AS ENUM
  ('task', 'project');
```

注意：PostgreSQL 枚举加值容易（`ALTER TYPE ... ADD VALUE`）、删值难（需重建类型），枚举清单须在设计阶段定准。

## 3. ER 图

```mermaid
erDiagram
    workspace ||--o{ project : "包含"
    workspace ||--o{ member : "包含"
    workspace ||--o{ label : "包含"
    workspace ||--o{ saved_view : "包含"
    workspace ||--o{ task : "包含"
    project |o--o{ task : "可选归属"
    task ||--o{ task : "parent_id 自引用 = 子任务"
    member ||--o{ project : "lead (可无)"
    project ||--o{ project_member : "项目成员"
    member ||--o{ project_member : "参与"
    member ||--o{ task : "assignee"
    task }o--o{ label : "task_label (scope=task)"
    project }o--o{ label : "project_label (scope=project)"

    workspace {
        uuid id PK
        text name
        text description
    }
    member {
        uuid id PK
        uuid workspace_id FK
        text name
        text email
        text avatar_color
        uuid user_id "预留, 未来绑定账号"
    }
    project {
        uuid id PK
        uuid workspace_id FK
        text name
        project_status status
        smallint priority
        uuid lead_id FK "可无 (No lead)"
        date start_date
        date target_date
        uuid created_by FK
        timestamptz deleted_at
    }
    project_member {
        uuid project_id PK, FK
        uuid member_id PK, FK
    }
    task {
        uuid id PK
        uuid workspace_id FK
        uuid project_id FK "可空"
        uuid parent_id FK "可空, 自引用"
        text title
        task_status status
        smallint priority
        uuid assignee_id FK
        date due_date
        uuid created_by FK
        timestamptz deleted_at
    }
    label {
        uuid id PK
        uuid workspace_id FK
        label_scope scope "task 或 project"
        text name
        text color
    }
    task_label {
        uuid task_id PK, FK
        uuid label_id PK, FK
    }
    project_label {
        uuid project_id PK, FK
        uuid label_id PK, FK
    }
    saved_view {
        uuid id PK
        uuid workspace_id FK
        view_entity entity_type "task 或 project"
        view_surface surface "视图归属面（v1.4）"
        uuid project_id FK, NULL "project_issues 面项目级 scope（v1.4）"
        text name
        text description
        jsonb config
    }
```

## 4. 逐表定义

### 4.1 workspace — 工作区

| 列 | 类型 | 约束 | 说明 |
|----|------|------|------|
| id | uuid | PK, DEFAULT gen_random_uuid() | |
| name | text | NOT NULL | |
| description | text | NOT NULL DEFAULT '' | |
| created_at | timestamptz | NOT NULL DEFAULT now() | |
| updated_at | timestamptz | NOT NULL DEFAULT now() | |

### 4.2 member — 成员（责任人名片）

| 列 | 类型 | 约束 | 说明 |
|----|------|------|------|
| id | uuid | PK | |
| workspace_id | uuid | NOT NULL, FK→workspace ON DELETE CASCADE | |
| name | text | NOT NULL | 显示名 |
| email | text | NULL | 仅作记录；未来做登录时可再加唯一约束 |
| avatar_color | text | NOT NULL DEFAULT '' | 头像底色，hex 如 `#5e6ad2` |
| user_id | uuid | NULL | 预留：未来绑定登录账号 |
| created_at / updated_at | timestamptz | NOT NULL DEFAULT now() | |

约束：`UNIQUE (workspace_id, name)` —— 同一工作区内成员名不重复。

### 4.3 project — 项目

| 列 | 类型 | 约束 | 说明 |
|----|------|------|------|
| id | uuid | PK | |
| workspace_id | uuid | NOT NULL, FK→workspace ON DELETE CASCADE | |
| name | text | NOT NULL | |
| description | text | NOT NULL DEFAULT '' | |
| status | project_status | NOT NULL DEFAULT 'backlog' | |
| priority | smallint | NOT NULL DEFAULT 0, CHECK (0–4) | |
| lead_id | uuid | NULL, FK→member ON DELETE SET NULL | 负责人，可无（No lead） |
| start_date | date | NULL | 开始时间 |
| target_date | date | NULL | 目标完成时间 |
| created_by | uuid | NULL, FK→member ON DELETE SET NULL | 创建者 |
| created_at / updated_at | timestamptz | NOT NULL DEFAULT now() | |
| deleted_at | timestamptz | NULL | 软删除标记 |

索引：`(workspace_id) WHERE deleted_at IS NULL`

### 4.4 project_member — 项目成员

承载"实际完成项目下任务的人"这层关系（与 lead 区分）。

| 列 | 类型 | 约束 |
|----|------|------|
| project_id | uuid | FK→project ON DELETE CASCADE，联合主键之一 |
| member_id | uuid | FK→member ON DELETE CASCADE，联合主键之一 |

索引：`(member_id)` —— 反查"某人参与了哪些项目"。

### 4.5 task — 任务 / 子任务（核心表）

任务可以不归属任何项目（对齐 Linear：issue 是独立实体，project 是可选归属）。因此 workspace_id 直接挂在任务上，无项目任务也能按 workspace 查询与级联。

| 列 | 类型 | 约束 | 说明 |
|----|------|------|------|
| id | uuid | PK | |
| workspace_id | uuid | NOT NULL, FK→workspace ON DELETE CASCADE | 应用层带入；有项目时必须与项目同 workspace |
| project_id | uuid | NULL, FK→project ON DELETE SET NULL | 空 = 无项目任务；项目删除时任务脱离项目（保留本体） |
| parent_id | uuid | NULL, FK→task ON DELETE CASCADE | 空=顶级任务，非空=子任务 |
| title | text | NOT NULL | |
| description | text | NOT NULL DEFAULT '' | |
| status | task_status | NOT NULL DEFAULT 'todo' | 新建默认 todo |
| priority | smallint | NOT NULL DEFAULT 0, CHECK (0–4) | |
| assignee_id | uuid | NULL, FK→member ON DELETE SET NULL | 责任人 |
| due_date | date | NULL | 目标完成时间 |
| created_by | uuid | NULL, FK→member ON DELETE SET NULL | |
| created_at / updated_at | timestamptz | NOT NULL DEFAULT now() | |
| deleted_at | timestamptz | NULL | 软删除标记 |

约束与索引：
- `CHECK (parent_id != id)` 防止自指
- `(workspace_id, parent_id) WHERE deleted_at IS NULL` —— 任务列表页主查询
- `(project_id) WHERE deleted_at IS NULL` —— 项目详情页任务列表
- `(assignee_id) WHERE deleted_at IS NULL` —— "我的任务"查询
- `(due_date) WHERE deleted_at IS NULL` —— 按截止日期筛选/排序

### 4.6 label — 标签（分任务/项目两类）

| 列 | 类型 | 约束 | 说明 |
|----|------|------|------|
| id | uuid | PK | |
| workspace_id | uuid | NOT NULL, FK→workspace ON DELETE CASCADE | |
| scope | label_scope | NOT NULL | `task`=任务标签，`project`=项目标签 |
| name | text | NOT NULL | |
| color | text | NOT NULL | hex 色值，如 `#EB5757` |
| created_at / updated_at | timestamptz | NOT NULL DEFAULT now() | |

约束：`UNIQUE (workspace_id, scope, name)` —— 两类标签允许同名，同类别内不重名。

### 4.7 task_label — 任务标签联结表

| 列 | 类型 | 约束 |
|----|------|------|
| task_id | uuid | FK→task ON DELETE CASCADE，联合主键之一 |
| label_id | uuid | FK→label ON DELETE CASCADE，联合主键之一 |

索引：`(label_id)` —— 按标签反查任务。子任务同为 task 行，直接复用本表。

### 4.8 project_label — 项目标签联结表

| 列 | 类型 | 约束 |
|----|------|------|
| project_id | uuid | FK→project ON DELETE CASCADE，联合主键之一 |
| label_id | uuid | FK→label ON DELETE CASCADE，联合主键之一 |

索引：`(label_id)`。

### 4.9 saved_view — 看板视图配置

> 命名为 `saved_view` 以避开 SQL 关键字 `VIEW`；对应 Linear 的 View 功能。

| 列 | 类型 | 约束 | 说明 |
|----|------|------|------|
| id | uuid | PK | |
| workspace_id | uuid | NOT NULL, FK→workspace ON DELETE CASCADE | |
| entity_type | view_entity | NOT NULL | `task`=任务视图，`project`=项目视图（对齐 Views 页两个 tab） |
| surface | view_surface | NOT NULL DEFAULT 'views_page' | **v1.4**：视图归属面 `tasks_page / projects_page / views_page / project_issues`（双轨隔离，P2.md §4.1） |
| project_id | uuid | NULL, FK→project ON DELETE CASCADE | **v1.4**：仅 project_issues 面非空（项目级 scope）；删项目 CASCADE 其 view |
| name | text | NOT NULL | 视图名，如“按优先级看板” |
| description | text | NOT NULL DEFAULT '' | 视图描述 |
| config | jsonb | NOT NULL DEFAULT '{}' | 筛选 + 展示控制配置 |
| created_at / updated_at | timestamptz | NOT NULL DEFAULT now() | |

索引：`(workspace_id, surface, entity_type)` —— 页面级 tab 行 / Views 页分 tab / 项目级关联查询（**v1.4 改建**，原 `(workspace_id, entity_type)`）。

surface 与 entity_type 一致性由后端强制：`tasks_page ⇒ task`、`projects_page ⇒ project`、`project_issues ⇒ task ∧ project_id 必传且属同 workspace`；`views_page` 两者皆可；project_id 仅 project_issues 面可非空。

config 结构约定（**后端 opaque**：CRUD 原样存、原样返回、不解释内容，仅要求 JSON object；契约见 P2.md §4.2——filters 有序条件列表 + display 面板四 section 状态，camelCase）：

```json
{
  "filters": [{ "field": "status", "op": "isAnyOf", "values": ["todo", "in_progress"] }],
  "display": { "groupBy": "priority", "ordering": { "field": "createdAt", "dir": "desc" }, "visible": { "priority": true }, "showSubtasks": true, "nesting": true }
}
```

> **jsonb 归一化注（v1.4 实测登记）**：jsonb 二进制存储会归一化键序/空白/重复键，读回与写入**字节不等价但语义等价**。“原样返回”指语义原样（不解释、不增删键）；前端偏离比对（currentState vs view.config）必须用解析后对象深比较，禁字符串比对。

### 4.10 字段必填性约定（创建时）

project 与 task 遵循同一原则：**业务属性中只有 status 和 priority 必填**（前端正常必传，数据库默认值兜底，不传也不会报错）；除标识字段外，其余业务属性全部可空。

**创建 project 时**：

| 字段 | 必填性 | 缺省行为 |
|------|--------|----------|
| name | 必填（标识字段） | — |
| status | 必填，前端必传 | 未传时数据库兜底为 `'backlog'` |
| priority | 必填，前端必传 | 未传时数据库兜底为 `0`（无） |
| description / lead_id / start_date / target_date / created_by / 标签 / 成员 | 全部可空 | NULL / 无关联行 |

**创建 task 时**：

| 字段 | 必填性 | 缺省行为 |
|------|--------|----------|
| title | 必填（标识字段） | — |
| project_id | 可空 | 任务可以不归属项目；归属时由弹窗/详情页选择或从项目上下文带入 |
| workspace_id | 结构必填 | 应用层自动带入（有项目时与项目同 workspace，无项目时取当前 workspace），无需用户填写 |
| status | 必填，前端必传 | 未传时数据库兜底为 `'todo'` |
| priority | 必填，前端必传 | 未传时数据库兜底为 `0`（无） |
| description / parent_id / assignee_id / due_date / created_by / 标签 | 全部可空 | NULL / 无关联行 |

注：name / title 保留为必填，是把它们视为"标识字段"（列表中总得有个可显示的东西）。若希望完全对齐 Linear 允许无标题任务（显示 Untitled）的行为，把 title 改为 `NOT NULL DEFAULT ''` 即可，schema 其他部分不受影响。

## 5. 级联删除策略

核心原则：**"绑定关系"随删除消散（SET NULL / 联结行级联），"业务本体"不受影响**。member 和 label 是元数据，task 和 project 才是数据本体。

| 删除对象 | 删除方式 | 关联数据处理 |
|----------|----------|--------------|
| workspace | 硬删除 | 其下 project / task / member / label / saved_view / project_member / 联结行全部 CASCADE 硬删（罕见且明确的毁灭性操作） |
| member | 硬删除 | task.assignee_id、project.lead_id、project/task.created_by → SET NULL（任务变未指派、项目变 No lead，历史保留）；project_member 联结行 CASCADE |
| label | 硬删除 | task_label / project_label 联结行 CASCADE，任务和项目本体不受影响 |
| project | 应用层软删除 | 软删时应用层将其下 task 的 project_id 置 NULL（任务保留为无项目任务，不级联删除）；硬删时 task.project_id SET NULL，project_member / project_label CASCADE |
| task | 应用层软删除 | 软删时应用层级联软删整棵子任务树；硬删时子任务 CASCADE、task_label CASCADE |

## 6. 应用层规则（后端保证）

数据库约束表达不了、由后端业务逻辑保证的规则：

1. 同一项目内，lead 不能同时出现在 project_member 中（一人不能既是负责人又是成员）
2. task.assignee ∈ {所属 workspace 成员} ∪ {空}（2026-09 起与项目 lead/member 解绑，对齐 Linear：项目成员仅为干系人概念，不构成指派边界）
3. 子任务与父任务同 workspace 且 project 一致（父任务无项目则子任务也无项目）
4. 软删 task 时级联软删其子树；软删 project 时不删任务，仅将其下 task 的 project_id 置 NULL
5. 打标签时 label.scope 与目标类型匹配（task_label 只引用 scope='task' 的标签，project_label 同理）

## 7. 典型查询与索引自查

| 场景 | 查询路径 | 索引 |
|------|----------|------|
| 工作区任务列表（任务列表页，按状态分组） | `WHERE workspace_id=? AND deleted_at IS NULL` | ✅ (workspace_id, parent_id) 部分索引 |
| 项目任务列表（项目详情页） | `WHERE project_id=? AND deleted_at IS NULL` | ✅ (project_id) 部分索引 |
| 子任务树 | 从 task.id 出发的递归 CTE（`WITH RECURSIVE`） | ✅ parent_id 在复合索引中 |
| 我负责的所有任务 | `WHERE assignee_id=? AND deleted_at IS NULL` | ✅ |
| 按标签筛选任务 | task_label JOIN | ✅ 双向索引 |
| 近期到期任务 | `WHERE due_date < ?` | ✅ |
| 项目列表排序 | `ORDER BY priority / status / name / created_at` | 个人数据量无需额外索引 |
