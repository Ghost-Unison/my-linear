# myLinear

Linear 风格的个人任务记录系统。MVP 阶段仅支持个人使用、无鉴权；数据模型已预留多租户扩展缝，未来可开源并部署上云供他人使用。

**为什么做这个项目**：Linear 免费版对任务创建数量有限制；同时作为 Go 后端技术栈（Gin / sqlc / goose / PostgreSQL）与 React 前端体系（React / shadcn/ui / TanStack Query / dnd-kit）的练手项目。

## 文档索引

| 文档 | 内容 |
|------|------|
| [DATABASE_DESIGN.md](./DATABASE_DESIGN.md) | 数据库设计定稿（9 张表 + 4 个枚举 + ER 图 + 级联策略，v1.3） |
| [DESIGN-linear.app.md](./DESIGN-linear.app.md) | Linear 官方视觉设计 token（色彩/字体/间距/组件规格），前端主题基准 |
| [docs/product-design/P0.md](./docs/product-design/P0.md) | P0 阶段产品模块设计（阶段快照，每阶段一份） |
| [docs/product-design/P1.md](./docs/product-design/P1.md) | P1 阶段产品模块设计（Label 标签体系） |
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
│   ├── internal/            # config / router / handler（Error 响应 + Nullable 三态）/ workspace / member / project / task（业务模块，规则内化于 handler）/ store（sqlc 生成）
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

模块设计按阶段拆分为快照文档：**[docs/product-design/P0.md](./docs/product-design/P0.md)**（workspace / member / project / task CRUD + 任务列表）已定稿——后端 21 个接口全部实现，前端 P0 五个路由页面全部落地（Workspace Home / 项目列表 / 项目详情 / 任务列表 / 任务详情）。**[docs/product-design/P1.md](./docs/product-design/P1.md)**（Label 标签体系）为当前阶段快照：标签管理区 + 任务/项目打标与展示；内置固定视图取消，与 saved_view 自定义视图、列表页 filter / display options 按钮一并归入 P2。

## 功能边界（裁剪项与后置项）

裁剪（不做）：登录鉴权（P4 开源化再做）、评论、Activity 动态、附件、通知/Inbox、Cycle/Sprint、Milestone、项目 Progress 图表、Health 状态、任务编号（GHO-13）、工时估算、暗/亮主题切换（先只做暗色）。

后置：自定义视图（saved_view）与列表页 filter / display options 面板（P2）、看板拖拽排序（P3）、列表行内编辑（P3）、标签就地创建（P3）。

## 开发路线图

- **P0**：workspace / member / project / task 的 CRUD + 任务列表（按状态分组 + 两层子任务树）
- **P1**：Label 标签体系（workspace 标签 tab 管理区、任务/项目打标与展示）
- **P2**：saved_view 自定义视图、列表页 filter 按钮与 display options 按钮（分组/排序/展示属性；展示属性为纯前端渲染开关，接口返回完备行）、项目详情页完善
- **P3**：看板拖拽排序、列表行内编辑（点击列值直接修改）、标签就地创建（Linear 式 "Change or add labels" 弹层）、交互细节打磨
- **P4**：开源化（注册登录、多租户、云上部署）
