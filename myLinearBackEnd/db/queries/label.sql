-- name: ListLabelsByWorkspace :many
SELECT * FROM label WHERE workspace_id = $1
ORDER BY created_at;


-- name: ListLabelsByWorkspaceAndScope :many
SELECT * FROM label WHERE workspace_id = $1 AND scope = $2
ORDER BY created_at;


-- name: ListLabelScopesByIds :many
-- 打标校验用：只取 id 与 scope，命中行数不足 = 有 id 不属于本工作区；行数齐但 scope 不符 = scope 不匹配
SELECT id, scope FROM label WHERE workspace_id = $1
AND id = ANY(sqlc.arg('ids')::uuid[]);


-- name: GetLabel :one
SELECT * FROM label WHERE id = $1 AND workspace_id = $2;


-- name: CreateLabel :one
INSERT INTO label (id,workspace_id, scope, name, color,created_at,updated_at)
 VALUES (gen_random_uuid(),$1, $2, $3, $4,NOW(),NOW())
RETURNING *;


-- name: UpdateLabel :one
UPDATE label SET name = $1, color = $2, updated_at = NOW()
WHERE id = $3 AND workspace_id = $4
RETURNING *;


-- name: DeleteLabel :exec
DELETE FROM label WHERE id = $1 AND workspace_id = $2;


-- name: DeleteProjectLabels :exec
DELETE FROM project_label WHERE project_id = $1;
-- name: AddProjectLabels :exec
INSERT INTO project_label (project_id, label_id) 
SELECT $1,unnest(sqlc.arg('label_ids')::uuid[]);

-- name: DeleteTaskLabels :exec
DELETE FROM task_label WHERE task_id = $1;
-- name: AddTaskLabels :exec
INSERT INTO task_label (task_id, label_id) 
SELECT $1,unnest(sqlc.arg('label_ids')::uuid[]);
