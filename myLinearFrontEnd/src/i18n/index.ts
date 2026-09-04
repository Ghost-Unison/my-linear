// i18next 初始化：默认英文，localStorage 持久化，navigator 兜底。
// 资源静态打包（应用体量小，无需 HTTP 懒加载）；zh 缺 key 回退 en 而非裸露 key。
import i18n from "i18next"
import LanguageDetector from "i18next-browser-languagedetector"
import { initReactI18next } from "react-i18next"
import en from "./locales/en"
import zhCN from "./locales/zh-CN"

// <html lang> 随语言切换同步更新（i18next 不自动维护，这里显式绑定）
const applyDocumentLang = (lng: string) => {
  document.documentElement.lang = lng
}

/** 语言码是否中文语境（前缀匹配，兼容 zh / zh-CN / zh-TW 等变体）。
 * 全项目“是否中文”判断的唯一事实来源：date.ts / date-picker / LanguageSwitcher 与下方归一化均复用 */
export function isZhLocale(lng?: string): boolean {
  return (lng ?? "").toLowerCase().startsWith("zh")
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      "zh-CN": { translation: zhCN },
    },
    fallbackLng: "en",
    supportedLngs: ["en", "zh-CN"],
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "i18nextLng",
      // navigator 可能给出 "zh" / "zh-TW" 等变体：统一归一到资源键 "zh-CN"。
      // 不能用 nonExplicitSupportedLngs：它会为“是否支持”判定剔离区域码（zh-CN→zh），
      // 而 supportedLngs 中只有 "zh-CN" 没有 "zh"，反而导致 zh-CN 被判为不支持、回退英文。
      convertDetectedLanguage: (lng) => (isZhLocale(lng) ? "zh-CN" : lng),
    },
  })

i18n.on("languageChanged", applyDocumentLang)
applyDocumentLang(i18n.language || "en")

export default i18n
