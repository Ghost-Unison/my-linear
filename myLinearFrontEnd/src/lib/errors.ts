// 错误展示层：把后端中文 message / 网络异常映射为 i18n key，未命中回退后端原文。
// 页面侧存储原始 error 对象（unknown），渲染期经 displayError 解析，保证切换语言即时刷新。
import type { TFunction } from "i18next"
import { ApiError } from "@/api/client"

// 已知 HTTP 状态 → 本地化文案 key（后端 message 为中文，按状态归一化展示）
const STATUS_KEY: Record<number, string> = {
  400: "errors.badRequest",
  404: "errors.notFoundGeneric",
  409: "errors.conflict",
}

// 业务错误码 → 本地化文案 key（api.md §1）：优先于状态映射——同为 400，
// 泛化的 badRequest 会吞掉对用户有指导意义的语义（如 R6 标签 scope 不匹配）
const CODE_KEY: Record<string, string> = {
  LABEL_SCOPE_MISMATCH: "errors.labelScopeMismatch",
}

/** ApiError 先按 code 查业务码表，再按 status 映射；均未命中回退后端 message（空则 fallbackKey）。非 ApiError（断网等）→ errors.network */
export function translateError(t: TFunction, err: unknown, fallbackKey: string): string {
  if (err instanceof ApiError) {
    const key = CODE_KEY[err.code] ?? STATUS_KEY[err.status]
    if (key) return t(key)
    return err.message || t(fallbackKey)
  }
  return t("errors.network")
}

/**
 * 统一错误解析：
 * - null/undefined → null（无错误）
 * - string → 视为 i18n key（前端本地校验，如 "validation.titleRequired"）
 * - 其他 → translateError（ApiError 映射 / 网络异常）
 */
export function displayError(
  t: TFunction,
  error: unknown,
  fallbackKey: string,
): string | null {
  if (error == null) return null
  if (typeof error === "string") return t(error)
  return translateError(t, error, fallbackKey)
}
