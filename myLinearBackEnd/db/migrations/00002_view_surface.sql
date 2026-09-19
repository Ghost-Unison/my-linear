-- +goose Up
-- v1.4：saved_view 加 surface 列（视图归属双轨隔离，P2.md §4.1）与可空 project_id 列
-- （project_issues 面项目级 scope）；索引改建 (workspace_id, surface, entity_type)

CREATE TYPE view_surface AS ENUM
    ('tasks_page', 'projects_page', 'views_page', 'project_issues');

ALTER TABLE saved_view
    ADD COLUMN surface view_surface NOT NULL DEFAULT 'views_page',
    ADD COLUMN project_id uuid REFERENCES project (id) ON DELETE CASCADE;

DROP INDEX idx_saved_view_workspace;
CREATE INDEX idx_saved_view_workspace ON saved_view (workspace_id, surface, entity_type);

-- +goose Down

DROP INDEX idx_saved_view_workspace;
CREATE INDEX idx_saved_view_workspace ON saved_view (workspace_id, entity_type);

ALTER TABLE saved_view
    DROP COLUMN project_id,
    DROP COLUMN surface;

DROP TYPE view_surface;
