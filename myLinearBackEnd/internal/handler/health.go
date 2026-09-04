package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Health 探活接口：同时检查数据库连通性
func Health(pool *pgxpool.Pool) gin.HandlerFunc {
	return func(c *gin.Context) {
		if err := pool.Ping(c.Request.Context()); err != nil {
			Error(c, http.StatusServiceUnavailable, "DB_UNREACHABLE", "数据库连接不可用")
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	}
}
