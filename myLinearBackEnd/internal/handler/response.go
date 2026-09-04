package handler

import "github.com/gin-gonic/gin"

// Error 按 api.md 约定的错误格式返回：{ "error": { "code": "...", "message": "..." } }
func Error(c *gin.Context, status int, code, message string) {
	c.AbortWithStatusJSON(status, gin.H{
		"error": gin.H{
			"code":    code,
			"message": message,
		},
	})
}
