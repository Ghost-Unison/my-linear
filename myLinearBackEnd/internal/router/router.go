package router

import (
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"mylinear/internal/handler"
	"mylinear/internal/member"
	"mylinear/internal/project"
	"mylinear/internal/task"
	"mylinear/internal/workspace"
)

// New 装配 Gin 引擎与路由。业务模块按 api.md 约定挂载在 /api/v1 下，
// 资源路由嵌套于 /workspaces/:workspaceId（P4 鉴权中间件可挂在该分组上）。
func New(pool *pgxpool.Pool) *gin.Engine {
	r := gin.Default()

	r.GET("/healthz", handler.Health(pool))

	v1 := r.Group("/api/v1")
	// workspace 路由按 api.md §5 挂载
	workspaces := v1.Group("/workspaces")
	{
		workspaces.GET("", workspace.ListWorkspaces(pool))
		workspaces.POST("", workspace.CreateWorkspace(pool))
		workspaces.GET("/:workspaceId", workspace.GetWorkspace(pool))
		workspaces.PATCH("/:workspaceId", workspace.UpdateWorkspace(pool))
		workspaces.DELETE("/:workspaceId", workspace.DeleteWorkspace(pool))

		members := workspaces.Group("/:workspaceId/members")
		{
			members.GET("", member.ListMembersByWorkspace(pool))
			members.POST("", member.CreateMember(pool))
			members.PATCH("/:memberId", member.UpdateMember(pool))
			members.DELETE("/:memberId", member.DeleteMember(pool))
		}
		projects := workspaces.Group("/:workspaceId/projects")
		{
			projects.GET("", project.ListProjectsByWorkspace(pool))
			projects.POST("", project.CreateProject(pool))
			projects.GET("/:projectId", project.GetProject(pool))
			projects.PATCH("/:projectId", project.UpdateProject(pool))
			projects.DELETE("/:projectId", project.SoftDeleteProject(pool))
			projects.GET("/:projectId/tasks", task.GetTasksByProject(pool))
		}

		tasks := workspaces.Group("/:workspaceId/tasks")
		{
			tasks.GET("", task.ListTasksByWorkspace(pool))
			tasks.POST("", task.CreateTask(pool))
			tasks.GET("/:taskId", task.GetTask(pool))
			tasks.GET("/:taskId/subtree", task.GetTaskSubtree(pool))
			tasks.PATCH("/:taskId", task.UpdateTask(pool))
			tasks.DELETE("/:taskId", task.SoftDeleteTask(pool))
		}
	}

	return r
}
