-- +goose Up
-- myLinear 初始 schema，对应根目录 DATABASE_DESIGN.md（v1.3 定稿）
-- 目标数据库：PostgreSQL 17（gen_random_uuid() 为内置函数，无需扩展）

-- 枚举类型 -----------------------------------------------------------------

CREATE TYPE task_status AS ENUM
    ('backlog', 'todo', 'in_progress', 'done', 'canceled');

CREATE TYPE project_status AS ENUM
    ('backlog', 'planned', 'in_progress', 'completed', 'canceled');

CREATE TYPE label_scope AS ENUM
    ('task', 'project');

CREATE TYPE view_entity AS ENUM
    ('task', 'project');

-- 工作区 -------------------------------------------------------------------

CREATE TABLE workspace (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    description text NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 成员（责任人名片；user_id 预留未来绑定登录账号） ----------------------------

CREATE TABLE member (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
    name         text NOT NULL,
    email        text,
    avatar_color text NOT NULL DEFAULT '',
    user_id      uuid,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, name)
);

CREATE INDEX idx_member_workspace ON member (workspace_id);

-- 项目 ---------------------------------------------------------------------

CREATE TABLE project (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
    name         text NOT NULL,
    description  text NOT NULL DEFAULT '',
    status       project_status NOT NULL DEFAULT 'backlog',
    priority     smallint NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 4),
    lead_id      uuid REFERENCES member (id) ON DELETE SET NULL,
    start_date   date,
    target_date  date,
    created_by   uuid REFERENCES member (id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    deleted_at   timestamptz
);

CREATE INDEX idx_project_workspace_active ON project (workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_project_lead ON project (lead_id);

-- 项目成员（与 lead 互斥，由应用层保证） -------------------------------------

CREATE TABLE project_member (
    project_id uuid NOT NULL REFERENCES project (id) ON DELETE CASCADE,
    member_id  uuid NOT NULL REFERENCES member (id) ON DELETE CASCADE,
    PRIMARY KEY (project_id, member_id)
);

CREATE INDEX idx_project_member_member ON project_member (member_id);

-- 任务 / 子任务（parent_id 自引用）
-- project_id 可空：任务可以不归属任何项目（对齐 Linear）；
-- workspace_id 直接挂在任务上，保证无项目任务也能按 workspace 查询与级联。

CREATE TABLE task (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
    project_id   uuid REFERENCES project (id) ON DELETE SET NULL,
    parent_id    uuid REFERENCES task (id) ON DELETE CASCADE,
    title        text NOT NULL,
    description  text NOT NULL DEFAULT '',
    status       task_status NOT NULL DEFAULT 'todo',
    priority     smallint NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 4),
    assignee_id  uuid REFERENCES member (id) ON DELETE SET NULL,
    due_date     date,
    created_by   uuid REFERENCES member (id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    deleted_at   timestamptz,
    CHECK (parent_id != id)
);

CREATE INDEX idx_task_workspace_parent ON task (workspace_id, parent_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_task_project ON task (project_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_task_assignee ON task (assignee_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_task_due_date ON task (due_date) WHERE deleted_at IS NULL;

-- 标签（scope 区分任务标签 / 项目标签） --------------------------------------

CREATE TABLE label (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
    scope        label_scope NOT NULL,
    name         text NOT NULL,
    color        text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, scope, name)
);

-- 标签联结表 -----------------------------------------------------------------

CREATE TABLE task_label (
    task_id  uuid NOT NULL REFERENCES task (id) ON DELETE CASCADE,
    label_id uuid NOT NULL REFERENCES label (id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, label_id)
);

CREATE INDEX idx_task_label_label ON task_label (label_id);

CREATE TABLE project_label (
    project_id uuid NOT NULL REFERENCES project (id) ON DELETE CASCADE,
    label_id   uuid NOT NULL REFERENCES label (id) ON DELETE CASCADE,
    PRIMARY KEY (project_id, label_id)
);

CREATE INDEX idx_project_label_label ON project_label (label_id);

-- 看板视图配置（避开 SQL 关键字 VIEW）
-- entity_type：任务视图 / 项目视图；description：视图描述；config：筛选+展示控制的 jsonb

CREATE TABLE saved_view (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
    entity_type  view_entity NOT NULL,
    name         text NOT NULL,
    description  text NOT NULL DEFAULT '',
    config       jsonb NOT NULL DEFAULT '{}',
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_saved_view_workspace ON saved_view (workspace_id, entity_type);

-- +goose Down

DROP TABLE IF EXISTS saved_view;
DROP TABLE IF EXISTS project_label;
DROP TABLE IF EXISTS task_label;
DROP TABLE IF EXISTS label;
DROP TABLE IF EXISTS task;
DROP TABLE IF EXISTS project_member;
DROP TABLE IF EXISTS project;
DROP TABLE IF EXISTS member;
DROP TABLE IF EXISTS workspace;

DROP TYPE IF EXISTS view_entity;
DROP TYPE IF EXISTS label_scope;
DROP TYPE IF EXISTS project_status;
DROP TYPE IF EXISTS task_status;
