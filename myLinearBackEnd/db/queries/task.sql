-- name: ListTasksByWorkspace :many
SELECT t.*, p.name AS project_name, m.name AS assignee_name, m.avatar_color AS assignee_avatar_color, pt.title AS parent_title
FROM task t
LEFT JOIN project p ON t.project_id = p.id
LEFT JOIN member m ON t.assignee_id = m.id
LEFT JOIN task pt ON t.parent_id = pt.id
WHERE t.workspace_id = $1 AND t.deleted_at IS NULL
AND (cardinality(sqlc.arg('statuses') ::task_status[]) = 0 OR t.status = ANY(sqlc.arg('statuses') ::task_status[]))
ORDER BY CASE t.status WHEN 'backlog' THEN 1 WHEN 'todo' THEN 2 WHEN 'in_progress' THEN 3 WHEN 'done' THEN 4 ELSE 5 END, t.created_at
;


-- name: ListTasksByProject :many
SELECT t.*, p.name AS project_name, m.name AS assignee_name, m.avatar_color AS assignee_avatar_color, pt.title AS parent_title
FROM task t 
LEFT JOIN project p ON t.project_id = p.id
LEFT JOIN member m ON t.assignee_id = m.id
LEFT JOIN task pt ON t.parent_id = pt.id
WHERE t.project_id = $1 AND t.workspace_id = $2 AND t.deleted_at IS NULL
ORDER BY CASE t.status WHEN 'backlog' THEN 1 WHEN 'todo' THEN 2 WHEN 'in_progress' THEN 3 WHEN 'done' THEN 4 ELSE 5 END, t.created_at
;


-- name: CreateTask :one
INSERT INTO task (id,workspace_id,project_id,parent_id,title,description,status,priority,assignee_id,due_date,created_at,updated_at)
VALUES(
    gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW()
)
RETURNING *;


-- name: GetTask :one
-- 父任务引用（status/title）+ 父任务后代完成统计（口径同 Sub-issues 徽标 api.md §4），
-- 供子任务详情页 "Sub-issue of" 行渲染（对齐 Linear）；无父时父列为 NULL、统计为 NULL。
-- 统计用顶层递归 CTE 算全量 (root → 后代) 闭包再聚合（sqlc 解析器不支持 LATERAL 内嵌递归）
WITH RECURSIVE d AS (
    SELECT c.parent_id AS root_id, c.id, c.status
    FROM task c
    WHERE c.parent_id IS NOT NULL AND c.deleted_at IS NULL
    UNION ALL
    SELECT d.root_id, c.id, c.status
    FROM task c JOIN d ON c.parent_id = d.id
    WHERE c.deleted_at IS NULL
), ps AS (
    SELECT root_id, COUNT(*) FILTER (WHERE status = 'done') AS done_count, COUNT(*) AS total_count
    FROM d GROUP BY root_id
)
SELECT t.*, p.name AS project_name, m.name AS assignee_name, m.avatar_color AS assignee_avatar_color,
pt.title AS parent_title, pt.status AS parent_status,
ps.done_count AS parent_sub_done, ps.total_count AS parent_sub_total
FROM task t
LEFT JOIN project p ON t.project_id = p.id
LEFT JOIN member m ON t.assignee_id = m.id
LEFT JOIN task pt ON t.parent_id = pt.id
LEFT JOIN ps ON ps.root_id = t.parent_id
WHERE t.id = $1 
AND t.workspace_id = $2 AND t.deleted_at IS NULL;


-- name: GetTaskSubtree :many
-- get s.due_date lead to **time.Time
WITH RECURSIVE subtree AS (
    SELECT t.id, t.parent_id, 0 AS depth
    FROM task t
    WHERE t.id = $1 AND t.workspace_id = $2 AND t.deleted_at IS NULL
    UNION ALL
    SELECT t.id, t.parent_id, s.depth + 1
    FROM task t
    JOIN subtree s ON t.parent_id = s.id
    WHERE t.workspace_id = $2 AND t.deleted_at IS NULL
)
SELECT t.id, t.parent_id, s.depth, t.title, t.status, t.priority,
       t.due_date, t.created_at,
       t.project_id, p.name AS project_name,
       t.assignee_id, m.name AS assignee_name, m.avatar_color AS assignee_avatar_color
FROM subtree s
JOIN task t ON t.id = s.id
LEFT JOIN project p ON t.project_id = p.id
LEFT JOIN member m ON t.assignee_id = m.id
WHERE s.depth > 0
ORDER BY s.depth, t.created_at;

-- name: UpdateTask :one
UPDATE task SET project_id = $1, title = $2, description = $3, status = $4, priority = $5, assignee_id = $6, due_date = $7, updated_at=NOW()
WHERE id = $8 AND workspace_id = $9 AND deleted_at IS NULL
RETURNING *;

-- name: SyncSubtreeProject :exec
WITH RECURSIVE subtree AS (
    SELECT t.id FROM task t WHERE t.parent_id = $1 AND t.deleted_at IS NULL
    UNION ALL
    SELECT t.id FROM task t JOIN subtree s ON t.parent_id = s.id WHERE t.deleted_at IS NULL
)
UPDATE task SET project_id = $2, updated_at = NOW()
WHERE id IN (SELECT id FROM subtree);


-- DeleteTask can be done with SoftDeleteTaskSubtree
-- UPDATE task SET deleted_at=NOW() WHERE id = $1;


-- name: SoftDeleteTaskSubtree :execrows
WITH RECURSIVE subtree AS (
    SELECT t.id FROM task t WHERE t.id = $1 AND t.workspace_id = $2 AND t.deleted_at IS NULL
    UNION ALL
    SELECT t.id FROM task t JOIN subtree s ON t.parent_id = s.id WHERE t.workspace_id = $2 AND t.deleted_at IS NULL
)
UPDATE task SET deleted_at = NOW(), updated_at = NOW()
WHERE id IN (SELECT id FROM subtree);