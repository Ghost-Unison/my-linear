-- name: ListViewsBySurface :many
SELECT * FROM saved_view
WHERE workspace_id = $1 AND surface = $2
ORDER BY created_at;

-- name: ListViewsBySurfaceAndEntityType :many
SELECT * FROM saved_view
WHERE workspace_id = $1 AND surface = $2 AND entity_type = $3
ORDER BY created_at;

-- name: ListViewsByProject :many
SELECT * FROM saved_view
WHERE workspace_id = $1 AND surface = 'project_issues' AND project_id = $2
ORDER BY created_at;

-- name: GetView :one
SELECT * FROM saved_view
WHERE id = $1 AND workspace_id = $2;

-- name: CreateView :one
INSERT INTO saved_view (workspace_id, entity_type, surface, project_id, name, description, config)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- 读-改-写：handler 先 GetView 取基准行合并 presence 字段后全量写回（单条写不开事务，api.md §2.4）
-- name: UpdateView :one
UPDATE saved_view
SET name = $3, description = $4, config = $5, updated_at = now()
WHERE id = $1 AND workspace_id = $2
RETURNING *;

-- name: DeleteView :exec
DELETE FROM saved_view
WHERE id = $1 AND workspace_id = $2;
