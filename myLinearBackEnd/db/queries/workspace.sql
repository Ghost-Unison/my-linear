-- name: ListWorkspaces :many
SELECT * FROM workspace ORDER BY created_at ASC;


-- name: CreateWorkspace :one
INSERT INTO workspace (id,name,description,created_at,updated_at)
VALUES(
    gen_random_uuid(),$1,$2,NOW(),NOW()
)
RETURNING *;


-- name: GetWorkspace :one
SELECT * FROM workspace WHERE id = $1;


-- name: UpdateWorkspace :one
UPDATE workspace SET name = $1, description= $2,updated_at=NOW() WHERE id = $3
RETURNING *;


-- name: DeleteWorkspace :exec
DELETE FROM workspace WHERE id = $1;