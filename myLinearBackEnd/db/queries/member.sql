-- name: ListMembersByWorkspace :many
SELECT * FROM member WHERE workspace_id = $1 ORDER BY name;


-- name: CreateMember :one
INSERT INTO member (id,workspace_id,name,email,avatar_color,created_at,updated_at)
VALUES(
    gen_random_uuid(),$1,$2,$3,$4,NOW(),NOW()
)
RETURNING *;


-- name: UpdateMember :one
UPDATE member SET name = $1, email = $2, avatar_color = $3, updated_at=NOW()
WHERE id = $4 AND workspace_id = $5
RETURNING *;


-- name: DeleteMember :exec
DELETE FROM member WHERE id = $1 AND workspace_id = $2;


-- name: GetMember :one
SELECT * FROM member WHERE id = $1 AND workspace_id = $2;
