package handler

import (
	"net/http"

	"github.com/google/uuid"

	"github.com/gin-gonic/gin"
)

// IsHexColor 校验字符串是否为 hex 颜色：以 '#' 开头，后跟 3 位或 6 位十六进制数字（大小写不敏感）。
// 与 api.md / DATABASE_DESIGN 约定的格式一致，如 #EB5757（6 位）、#5e6ad2、#abc（3 位简写）。
func IsHexColor(s string) bool {
	// 合法长度只可能是 "#RGB"(4) 或 "#RRGGBB"(7)
	if len(s) != 4 && len(s) != 7 {
		return false
	}
	if s[0] != '#' {
		return false
	}
	for i := 1; i < len(s); i++ {
		c := s[i]
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F') {
			return false
		}
	}
	return true
}

// 把parseUUID的校验也放到这里
func ParseUUIDParam(c *gin.Context, name string) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param(name))
	if err != nil {
		Error(c, http.StatusBadRequest, "VALIDATION_FAILED", name+" 不符合 UUID 格式")
		return uuid.Nil, false
	}
	return id, true
}
