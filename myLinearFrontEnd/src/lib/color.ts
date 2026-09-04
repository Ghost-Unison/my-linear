// 头像色板：Linear 产品内标签色系（见 DESIGN-linear.app.md Known Gaps）
export const AVATAR_PALETTE = [
  "#5e6ad2", // lavender（品牌色）
  "#2d9cdb", // blue
  "#27a644", // green
  "#f2994a", // orange
  "#eb5757", // red
  "#9b51e0", // purple
  "#f2c94c", // yellow
  "#bb6bd9", // pink
] as const

/** 未设置 avatarColor 时按名字散列取确定性颜色 */
export function colorFor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length]
}
