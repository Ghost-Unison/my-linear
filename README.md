# myLinear

Linear 风格的个人任务记录系统。MVP 阶段仅支持个人使用、无鉴权；数据模型已预留多租户扩展缝，未来可开源并部署上云供他人使用。

**为什么做这个项目**：Linear 免费版对任务创建数量有限制；同时作为 Go 后端技术栈（Gin / sqlc / goose / PostgreSQL）与 React 前端体系（React / shadcn/ui / TanStack Query / dnd-kit）的练手项目。

## 文档索引

| 文档 | 内容 |
|------|------|
| [DATABASE_DESIGN.md](./DATABASE_DESIGN.md) | 数据库设计定稿（9 张表 + 5 个枚举 + ER 图 + 级联策略，v1.4） |
| [DESIGN-linear.app.md](./DESIGN-linear.app.md) | Linear 官方视觉设计 token（色彩/字体/间距/组件规格），前端主题基准 |
| [docs/product-design/P0.md](./docs/product-design/P0.md) | P0 阶段产品模块设计（阶段快照，每阶段一份） |
| [docs/product-design/P1.md](./docs/product-design/P1.md) | P1 阶段产品模块设计（Label 标签体系） |
| [docs/product-design/P2.md](./docs/product-design/P2.md) | P2 阶段产品模块设计（视图体系：Filter / Display options / saved_view，当前阶段） |
| [docs/api.md](./docs/api.md) | API 契约（单一活文档，随阶段更新，接口标注引入阶段） |

## 技术栈

- **后端**：Go + Gin（REST/JSON）+ sqlc + goose + pgx，PostgreSQL 17
- **前端**：React 18 + TypeScript + Vite + shadcn/ui + TanStack Query + dnd-kit + Zustand
- **形态**：前后端分离的纯 Web 应用，本地运行

## 目录结构

```
myLinear/
├── README.md                # 本文档（项目门面，随阶段更新）
├── DATABASE_DESIGN.md       # 数据库设计定稿
├── DESIGN-linear.app.md     # Linear 视觉设计 token
├── docs/
│   ├── product-design/      # 产品模块设计（每阶段一份快照：P0.md / P1.md ...）
│   └── api.md               # API 契约
├── myLinearBackEnd/         # Go 后端（module: mylinear）
│   ├── cmd/server/          # 入口 main.go（加载配置 → 连接池 → 路由 → 优雅关闭）
│   ├── internal/            # config / router / handler（Error 响应 + Nullable 三态 + 校验）/ workspace / member / project / task / label（业务模块，规则内化于 handler）/ store（sqlc 生成）
│   ├── db/migrations/       # goose 迁移
│   ├── db/queries/          # sqlc 查询
│   └── sqlc.yaml
└── myLinearFrontEnd/        # React 前端（Vite + TS，@ 别名指向 src）
    └── src/
        ├── api/             # fetch 封装（/api/v1）
        ├── components/      # layout（布局）+ ui（shadcn 基础件，按需 npx shadcn add）+ workspace / project / task（业务组件）
        ├── pages/           # 路由页面（对应 P0 §4）
        ├── hooks/ stores/ lib/
        └── index.css        # Linear 暗色 token（shadcn CSS 变量）
```

## 本地运行

前置：本地 Docker 的 PostgreSQL 17 已启动，并建好数据库（如 `mylinear`）。

```bash
# 1. 数据库迁移（goose）
cd myLinearBackEnd
goose -dir db/migrations postgres "postgres://postgres:postgres@localhost:5432/mylinear?sslmode=disable" up

# 2. 重新生成 sqlc 代码（db/queries/*.sql 变更后执行）
sqlc generate

# 3. 后端（:8080；配置见 .env.example，复制为 .env 或直接改环境变量）
go run ./cmd/server

# 4. 前端（:5173；/api 已代理到 8080，无跨域问题）
cd myLinearFrontEnd
npm run dev
```

---

# 产品设计

> 定位：参考 Linear 的页面布局与信息架构，但**功能上做最大简化**。
> 视觉美感与交互动效后续迭代优化，先保证功能闭环、信息层级正确。

模块设计按阶段拆分为快照文档：**[docs/product-design/P0.md](./docs/product-design/P0.md)**（workspace / member / project / task CRUD + 任务列表）已定稿——后端 21 个接口全部实现，前端 P0 五个路由页面全部落地（Workspace Home / 项目列表 / 项目详情 / 任务列表 / 任务详情）。**[docs/product-design/P1.md](./docs/product-design/P1.md)**（Label 标签体系）**已完成**——后端 6 个新接口与 7 个既有接口的形状扩展全部实现，前端标签管理区（chip 流 + hover 编辑/删除 + 删除二次确认）、任务/项目打标、列表行与子任务行 chip 簇全部落地；并提前做完了原属 P3 的「标签就地创建」：两个详情页的 Labels 行升级为 Linear 同款交互——已打标签逐个可点 chip + 圆形「+」共用同一枚面板（搜索 / 复选 / 无匹配时就地新建选色），实现为 Project / Task 共用的共享组件 `ui/label-picker.tsx`。内置固定视图取消。**[docs/product-design/P2.md](./docs/product-design/P2.md) 为当前阶段**：三面 Filter / Display options 与四面 saved_view 后端接口已完成；Projects / Tasks 列表及项目详情 View 的创建、编辑、查看、删除、另存及覆盖保存已完成，三面沿用同一套交互逻辑；Tasks 保留 Active/Backlog/All，项目详情保留 Overview/Tasks 并按当前项目隔离视图。**浏览临时层与编辑草稿隔离、切 tab 暂存/Cancel 丢弃、新建无蓝点/Reset、Reset 还原保存值**的现行规则与验收例子集中在 P2.md **§4.4.1**，不再随 Linear 行为变动自动调整。workspace 级 Views 页与全量回归仍待完成。项目详情本轮构建、浏览器功能回归及主要布局截图验证通过，含草稿隔离、跨项目拦截、模拟失败重试和保存中切 tab；测试视图已清理。历史列表页完整视觉回归及已知异常仍单列保留，详见 P2.md §6 V3。

## 功能边界（裁剪项与后置项）

裁剪（不做）：登录鉴权（P4 开源化再做）、评论、Activity 动态、附件、通知/Inbox、Cycle/Sprint、Milestone、项目 Progress 图表、Health 状态、任务编号（GHO-13）、工时估算、暗/亮主题切换（先只做暗色）。

后置：看板拖拽排序（P3）、列表行内编辑（P3）。（原列 P3 的「标签就地创建」已随 P1 提前实现；自定义视图 saved_view 与列表页 filter / display options 面板为当前 P2 阶段主体，进度见下方路线图与 [docs/product-design/P2.md](./docs/product-design/P2.md)）

## 开发路线图

- **P0**：workspace / member / project / task 的 CRUD + 任务列表（按状态分组 + 两层子任务树）
- **P1**：Label 标签体系（workspace 标签 tab 管理区、任务/项目打标与展示）——**已完成**，并提前做完原属 P3 的标签就地创建
- **P2**（进行中）：**已完成** tasks_page / projects_page / project_issues 三面 Filter / Display options、四面 saved_view 后端接口，以及 Projects / Tasks 列表和项目详情 View 创建/编辑/查看/删除/另存/覆盖与 Filter/Display 联动；**待完成** workspace 级 Views 页与全量回归。已登记异常仍待修，不计为已解决（见 P2.md §6）。
- **P3**：看板拖拽排序、列表行内编辑（点击列值直接修改）、交互细节打磨
- **P4**：开源化（注册登录、多租户、云上部署）

---

## 已知遗留（留待最终优化阶段处理）

已确认、但当前阶段刻意不修的问题，集中记在这里免得后续重复排查。

### 1. 窄视口 + 右侧属性抽屉同开时，详情字段行可能横向溢出

- **现象**：视口约 844px 且详情页右侧属性抽屉展开时，overview 主区内容列被压到约 216px；字段行组件 `ui/field-row.tsx`（左列 7.5rem 字段名 + 右列 `minmax(0,1fr)`）的右列只剩约 80px，而单枚标签 chip 约 115px，出现横向溢出（`scrollWidth > clientWidth`）。
- **影响面**：项目详情（抽屉 w-96）与任务详情（抽屉 w-80）**主区**的字段行。抽屉内部的 Labels 行不受影响（实测值列 202–266px，chip 正常换行）；弹层定位也不受影响（右缘判据用 `PANEL_MAX_W = 260`，窄视口下走右对齐分支，实测与触发器右缘误差 0.01px）。
- **为什么现在不改**：`minmax(0,1fr)` 允许列收缩到小于单个 chip 宽度，是既有栅格语义而非某次重构引入；正常使用不会在 844px 窄窗下同时展开抽屉。
- **可选修法**（择一，均属响应式行为变更，动手前需单独确认）：① 按断点隐藏抽屉（如 `hidden xl:flex`，窄屏只保留主区）；② 窄屏收窄字段名左列给右列让位；③ 字段行右列加 `overflow-x-auto`，把溢出降级为局部滚动而不撑破布局。

### 2. 弹层打开期间父容器滚动，弹层位置不跟随

- **现象**：Select / MultiSelect / DatePicker / 标签面板都是打开瞬间用 `useLayoutEffect` 快照触发元素的视口坐标（`position: fixed` + portal 到 body），未监听 scroll / resize，因此弹层开着时滚动页面或抽屉，弹层会停在原位与触发元素脱节。
- **为什么现在不改**：弹层内任意点击（含滚动条拖动之外的区域）与 Escape / 外部点击都会立即关闭，实际很难在开着的状态下滚动容器；跟随需要引入 scroll/resize 监听与重算，P0/P1 阶段判定为不划算。
- **可选修法**：给打开态挂 `scroll`（capture，覆盖祖先滚动容器）与 `resize` 监听重算坐标，或直接改用 Radix Popover / Floating UI 的自动跟随与碰撞检测。
