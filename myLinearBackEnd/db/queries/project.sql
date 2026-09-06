-- name: ListProjectsByWorkspace :many
SELECT p.*,m.name AS lead_name, m.avatar_color AS lead_avatar_color,
(SELECT COUNT(*) FROM task WHERE project_id = p.id AND deleted_at IS NULL) AS task_count 
FROM project p 
LEFT JOIN member m ON p.lead_id = m.id
WHERE p.workspace_id = $1 AND p.deleted_at IS NULL;


-- name: ListProjectMembers :many
SELECT m.* 
FROM project_member pm
JOIN member m ON pm.member_id = m.id
WHERE pm.project_id = $1
ORDER BY m.name;


-- name: ListProjectLabels :many
-- 项目详情用：labels 按 created_at 升序（api.md §4）
SELECT l.*
FROM project_label pl
JOIN label l ON pl.label_id = l.id
WHERE pl.project_id = $1
ORDER BY l.created_at;


-- name: ListLabelsByProjectIds :many
-- 项目列表批量组装用：一次取回全部项目的标签，handler 内存分组避免 N+1
-- 每个项目组内仍须 created_at 升序（api.md §4），故 ORDER BY 带上 l.created_at
SELECT pl.project_id, l.*
FROM project_label pl
JOIN label l ON pl.label_id = l.id
WHERE pl.project_id = ANY(sqlc.arg('project_ids')::uuid[])
ORDER BY pl.project_id, l.created_at;


-- name: CreateProject :one
INSERT INTO project (id,workspace_id,name,description,status,priority,lead_id,start_date,target_date,created_at,updated_at)
VALUES(
    gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW()
)
RETURNING *;


-- name: AddProjectMembers :exec
INSERT INTO project_member (project_id, member_id)
SELECT $1, unnest(sqlc.arg('member_ids')::uuid[]);


-- name: GetProject :one
SELECT p.*, m.name AS lead_name, m.avatar_color AS lead_avatar_color,
(SELECT COUNT(*) FROM task WHERE project_id = p.id AND deleted_at IS NULL) AS task_count 
FROM project p 
LEFT JOIN member m ON p.lead_id = m.id
WHERE p.id = $1
AND p.workspace_id = $2 AND p.deleted_at IS NULL;

-- name: IfProjectExists :one
-- 判断项目是否存在 用GetProject太复杂，所以单独写一个判断
SELECT EXISTS(SELECT 1 FROM project WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL);


-- name: UpdateProject :one
UPDATE project SET name = $1, description = $2, status = $3, priority = $4, lead_id = $5, start_date = $6, target_date = $7, updated_at=NOW() 
WHERE id = $8 AND workspace_id = $9 AND deleted_at IS NULL
RETURNING *;


-- name: DeleteProjectMembers :exec
DELETE FROM project_member WHERE project_id = $1;


-- name: SoftDeleteProject :execrows
UPDATE project SET deleted_at=NOW() WHERE id = $1 AND workspace_id = $2;


-- name: DetachProjectTasks :exec
UPDATE task SET project_id = NULL, updated_at=NOW()
WHERE project_id = $1 AND deleted_at IS NULL;
