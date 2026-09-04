// 展示层日期格式化：业务日期（YYYY-MM-DD）为 civil 日期，纯字符串解析，避免时区偏移（api.md §2.7）

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]

/** 今天（本地时区）的 YYYY-MM-DD，用于逾期判断 */
export function todayLocal(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** YYYY-MM-DD → "Aug 26"（当年省略年份，跨年补 ", 2025"）；非法输入原样返回 */
export function formatYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number)
  if (!y || !m || !d) return ymd
  const base = `${MONTHS_SHORT[m - 1]} ${d}`
  return y === new Date().getFullYear() ? base : `${base}, ${y}`
}

/** RFC3339 时间戳 → "Aug 26"（本地时区展示，规则同 formatYmd）；非法输入原样返回 */
export function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric"
  return d.toLocaleDateString("en-US", opts)
}
