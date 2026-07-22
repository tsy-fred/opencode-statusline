/** @jsxImportSource @opentui/solid */
import { createRoot, createSignal } from "solid-js"
import type { RGBA } from "@opentui/core"
import type { TuiPlugin, TuiPluginModule, TuiPluginApi, TuiThemeCurrent, TuiDialogSelectOption } from "@opencode-ai/plugin/tui"
import type { AssistantMessage, TextPart } from "@opencode-ai/sdk/v2"
import { homedir } from "os"
import { join } from "path"
import { copyFile, writeFile, readFile, mkdir } from "fs/promises"

// ─── Types ───────────────────────────────────────────────────────────

interface StatusData {
  model: string
  contextLimit: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheWriteTokens: number
  totalCost: number
  contextPct: number
  speed: number
  durationMs: number
  cacheHitRate: number
  messageCount: number
  gitBranch: string | undefined
}

const INITIAL_DATA: StatusData = {
  model: "",
  contextLimit: 0,
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cacheWriteTokens: 0,
  totalCost: 0,
  contextPct: 0,
  speed: 0,
  durationMs: 0,
  cacheHitRate: -1,
  messageCount: 0,
  gitBranch: undefined,
}

type WidgetType =
  | "model"
  | "tokens"
  | "speed"
  | "cost"
  | "context-pct"
  | "context-bar"
  | "git-branch"
  | "duration"
  | "reasoning"
  | "cache-write"
  | "total-tokens"
  | "messages"
  | "cache-hit-rate"
  | "separator"
  | "text"

interface WidgetDef {
  type: WidgetType
  color?: string
  bold?: boolean
  dim?: boolean
  hide?: boolean
  text?: string
}

type Locale = "zh-CN" | "en"

interface StatuslineConfig {
  lines: WidgetDef[][]
  locale?: Locale
}

const DEFAULT_CONFIG: StatuslineConfig = {
  locale: "zh-CN",
  lines: [
    [
      { type: "model", bold: true },
      { type: "separator" },
      { type: "tokens" },
      { type: "separator" },
      { type: "context-pct" },
    ],
    [{ type: "context-bar" }],
    [
      { type: "cost" },
      { type: "separator" },
      { type: "speed" },
      { type: "separator" },
      { type: "duration" },
      { type: "separator" },
      { type: "git-branch" },
    ],
  ],
}

const ALL_WIDGET_TYPES: WidgetType[] = [
  "model", "tokens", "speed", "cost", "context-pct", "context-bar",
  "git-branch", "duration", "reasoning", "cache-write", "total-tokens",
  "messages", "cache-hit-rate", "separator", "text",
]

// ─── i18n ────────────────────────────────────────────────────────────────

interface Messages {
  presets: Array<{ title: string; description: string }>
  toggleRow: (label: string, lineNum: number) => string
  mainTitle: string
  mainToggle: string; mainToggleDesc: string
  mainMove: string; mainMoveDesc: string
  mainAdd: string; mainAddDesc: string
  mainReset: string; mainResetDesc: string
  mainPreset: string; mainPresetDesc: string
  mainProfiles: string; mainProfilesDesc: string
  mainDone: string
  toggleTitle: string; toggleBack: string
  moveTitle: string; moveBack: string
  moveLineTitle: (n: number) => string; moveLineDesc: (visible: number, total: number) => string
  widgetActionsBack: string
  widgetLeft: string; widgetRight: string
  widgetMoveLine: string; widgetHide: string; widgetShow: string; widgetColor: string; widgetDelete: string
  addTypeTitle: string; addLineTitle: string; addPositionTitle: string; addNewLine: string; addAppendLine: string; addBack: string
  moveTargetTitle: string
  posAtStart: string; posBefore: (label: string) => string; posAfter: (label: string) => string
  posBeforeNext: (label: string) => string; posEnd: string; posEmptyRow: string
  presetTitle: string; presetBack: string
  profilesTitle: string; profilesSave: string; profilesSaveDesc: (count: number) => string
  profilesLoad: string; profilesLoadDesc: string; profilesDelete: string
  profilesExport: string; profilesExportDesc: (path: string) => string; profilesImport: string; profilesImportDesc: string
  profilesBack: string
  profileLoadTitle: string; profileLoadDesc: (lines: number) => string; profileLoadBack: string
  profileDeleteTitle: string; profileDeleteBack: string
  colorTitle: string; colorClear: string; colorClearDesc: string; colorBack: string
  colorOptions: Array<{ label: string; value: string | undefined }>
  installFailTitle: string; installFailMsg: string; installFailNoDirTitle: string; installFailNoDirMsg: string
  installSuccessTitle: string; installSuccessMsg: string
  nextProfileName: (i: number) => string
  noVisible: string
  localeTitle: string
  widgetLabel: Record<WidgetType, string>
  defaultText: string
}

const zhCN: Messages = {
  presets: [
    { title: "默认", description: "官方风格：模型名高亮加粗，其余默认" },
    { title: "醒目", description: "数据值全高亮：费用警告色、速度成功色、分支信息色" },
    { title: "柔和", description: "统一淡灰色调，低视觉干扰" },
    { title: "素净", description: "无加粗，所有值使用默认色" },
  ],
  toggleRow: (label, ln) => `第 ${ln + 1} 行`,
  mainTitle: "Statusline 配置",
  mainToggle: "切换组件显示", mainToggleDesc: "显示或隐藏现有组件",
  mainMove: "编辑布局", mainMoveDesc: "调整组件位置、删除组件",
  mainAdd: "添加组件", mainAddDesc: "插入新组件到指定位置",
  mainReset: "↺ 恢复默认", mainResetDesc: "重置为出厂配置",
  mainPreset: "🎨 配色方案", mainPresetDesc: "应用预设配色",
  mainProfiles: "📁 配置文件", mainProfilesDesc: "多方案保存、加载、导入导出",
  mainDone: "✓ 完成",
  toggleTitle: "切换组件显示", toggleBack: "← 返回主菜单",
  moveTitle: "选择要编辑的行", moveBack: "← 返回主菜单",
  moveLineTitle: (n) => `第 ${n + 1} 行: `,
  moveLineDesc: (visible, total) => `${visible} 个可见 · ${total} 个组件`,
  widgetActionsBack: "← 返回",
  widgetLeft: "◀ 左移", widgetRight: "▶ 右移",
  widgetMoveLine: "⬇ 移到其他行",
  widgetHide: "👁 隐藏", widgetShow: "👁 显示",
  widgetColor: "🎨 更换颜色",   widgetDelete: "✕ 删除", moveTargetTitle: "移动到哪一行？",
  addTypeTitle: "添加组件 — 选择类型", addLineTitle: "添加到哪一行？", addPositionTitle: "插入到哪个位置？",
  addNewLine: "➕ 新建一行", addAppendLine: "➕ 在此行末尾添加组件", addBack: "← 返回",
  posAtStart: "最前面", posBefore: (l: string) => `在「${l}」之前`, posAfter: (l: string) => `第 ${l} 之后`,
  posBeforeNext: (l: string) => `在「${l}」之前`, posEnd: "即末尾", posEmptyRow: "末尾（空行）",
  presetTitle: "选择配色方案", presetBack: "← 返回主菜单",
  profilesTitle: "配置文件管理",
  profilesSave: "💾 保存当前配置", profilesSaveDesc: (count) => count > 0 ? `已有 ${count} 个方案` : "尚无已保存的方案",
  profilesLoad: "📂 加载配置方案", profilesLoadDesc: "从已保存的方案中切换",
  profilesDelete: "🗑 删除配置方案",
  profilesExport: "📤 导出到文件", profilesExportDesc: (path) => `保存到 ${path}`,
  profilesImport: "📥 从文件导入", profilesImportDesc: "从 JSON 文件恢复配置",
  profilesBack: "← 返回主菜单",
  profileLoadTitle: "选择要加载的方案", profileLoadDesc: (lines) => `${lines} 行`, profileLoadBack: "← 返回",
  profileDeleteTitle: "选择要删除的方案", profileDeleteBack: "← 返回",
  colorTitle: "选择颜色", colorClear: "清除自定义颜色", colorClearDesc: "恢复为无自定义颜色", colorBack: "← 返回",
  colorOptions: [
    { label: "默认主题色", value: undefined },
    { label: "muted (柔和)", value: "muted" },
    { label: "accent (强调)", value: "accent" },
    { label: "success (成功绿)", value: "success" },
    { label: "warning (警告黄)", value: "warning" },
    { label: "error (错误红)", value: "error" },
    { label: "info (信息蓝)", value: "info" },
    { label: "cyan (青色)", value: "cyan" },
    { label: "清除自定义颜色", value: "" },
  ],
  installFailTitle: "安装失败", installFailMsg: "无法复制文件",
  installFailNoDirTitle: "安装失败", installFailNoDirMsg: "无法获取项目目录",
  installSuccessTitle: "已安装到全局", installSuccessMsg: "重启 opencode 后所有会话生效",
  nextProfileName: (i) => `方案 ${i}`,
  noVisible: "(无可见组件)",
  localeTitle: "切换语言 / Switch Language",
  defaultText: "Text",
  widgetLabel: {
    model: "模型名", tokens: "Token 用量", speed: "生成速度", cost: "累计费用",
    "context-pct": "Context 百分比", "context-bar": "Context 进度条", "git-branch": "Git 分支",
    duration: "会话耗时", reasoning: "思考 tokens", "cache-write": "缓存写入",
    "total-tokens": "总 Token 用量", messages: "消息数", "cache-hit-rate": "缓存命中率",
    separator: "分隔符", text: "自定义文字",
  },
}

const en: Messages = {
  presets: [
    { title: "Default", description: "Official style: model name in accent + bold, rest default" },
    { title: "Vibrant", description: "All data highlighted: cost in warning, speed in success, branch in info" },
    { title: "Subtle", description: "Uniform muted gray, low visual noise" },
    { title: "Clean", description: "No bold, all values in default color" },
  ],
  toggleRow: (_label, ln) => `Row ${ln + 1}`,
  mainTitle: "Statusline Config",
  mainToggle: "Toggle Widgets", mainToggleDesc: "Show or hide existing widgets",
  mainMove: "Edit Layout", mainMoveDesc: "Move or delete widgets",
  mainAdd: "Add Widget", mainAddDesc: "Insert a new widget",
  mainReset: "↺ Reset to Default", mainResetDesc: "Restore factory configuration",
  mainPreset: "🎨 Color Preset", mainPresetDesc: "Apply a preset color scheme",
  mainProfiles: "📁 Profiles", mainProfilesDesc: "Save, load, import and export configurations",
  mainDone: "✓ Done",
  toggleTitle: "Toggle Widget Visibility", toggleBack: "← Back to Main Menu",
  moveTitle: "Select a Row to Edit", moveBack: "← Back to Main Menu",
  moveLineTitle: (n) => `Row ${n + 1}: `,
  moveLineDesc: (visible, total) => `${visible} visible · ${total} widgets`,
  widgetActionsBack: "← Back",
  widgetLeft: "◀ Move Left", widgetRight: "▶ Move Right",
  widgetMoveLine: "⬇ Move to Another Row",
  widgetHide: "👁 Hide", widgetShow: "👁 Show",
  widgetColor: "🎨 Change Color",   widgetDelete: "✕ Delete", moveTargetTitle: "Move to which row?",
  addTypeTitle: "Add Widget — Select Type", addLineTitle: "Add to which row?", addPositionTitle: "Insert at which position?",
  addNewLine: "➕ New Row", addAppendLine: "➕ Append to This Row", addBack: "← Back",
  posAtStart: "At start", posBefore: (l: string) => `before "${l}"`, posAfter: (l: string) => `After "${l}"`,
  posBeforeNext: (l: string) => `before "${l}"`, posEnd: "(end)", posEmptyRow: "End (empty row)",
  presetTitle: "Select a Color Preset", presetBack: "← Back to Main Menu",
  profilesTitle: "Profile Manager",
  profilesSave: "💾 Save Current Config", profilesSaveDesc: (count) => count > 0 ? `${count} profile(s) saved` : "No saved profiles yet",
  profilesLoad: "📂 Load Profile", profilesLoadDesc: "Switch to a saved profile",
  profilesDelete: "🗑 Delete Profile",
  profilesExport: "📤 Export to File", profilesExportDesc: (path) => `Save to ${path}`,
  profilesImport: "📥 Import from File", profilesImportDesc: "Restore configuration from a JSON file",
  profilesBack: "← Back to Main Menu",
  profileLoadTitle: "Select a Profile to Load", profileLoadDesc: (lines) => `${lines} line(s)`, profileLoadBack: "← Back",
  profileDeleteTitle: "Select a Profile to Delete", profileDeleteBack: "← Back",
  colorTitle: "Select a Color", colorClear: "Clear Custom Color", colorClearDesc: "Restore default color", colorBack: "← Back",
  colorOptions: [
    { label: "Default (theme)", value: undefined },
    { label: "muted", value: "muted" },
    { label: "accent", value: "accent" },
    { label: "success", value: "success" },
    { label: "warning", value: "warning" },
    { label: "error", value: "error" },
    { label: "info", value: "info" },
    { label: "cyan", value: "cyan" },
    { label: "Clear custom color", value: "" },
  ],
  installFailTitle: "Installation Failed", installFailMsg: "Could not copy file",
  installFailNoDirTitle: "Installation Failed", installFailNoDirMsg: "Could not determine project directory",
  installSuccessTitle: "Installed Globally", installSuccessMsg: "Restart opencode for it to take effect on all sessions",
  nextProfileName: (i) => `Profile ${i}`,
  noVisible: "(no visible widgets)",
  localeTitle: "Switch Language",
  defaultText: "Text",
  widgetLabel: {
    model: "Model", tokens: "Token Usage", speed: "Speed", cost: "Cost",
    "context-pct": "Context %", "context-bar": "Context Bar", "git-branch": "Git Branch",
    duration: "Duration", reasoning: "Reasoning", "cache-write": "Cache Write",
    "total-tokens": "Total Tokens", messages: "Messages", "cache-hit-rate": "Cache Hit Rate",
    separator: "Separator", text: "Custom Text",
  },
}

function getMessages(locale?: Locale): Messages {
  return locale === "en" ? en : zhCN
}

let WIDGET_LABELS: Record<WidgetType, string> = zhCN.widgetLabel

function setLocale(locale: Locale) {
  const m = getMessages(locale)
  WIDGET_LABELS = m.widgetLabel
}

// ─── Color Presets ─────────────────────────────────────────────────────

interface NamedPreset {
  title: string
  description: string
  colors: Partial<Record<WidgetType, { color?: string; bold?: boolean; dim?: boolean }>>
}

const PRESET_COLORS: NamedPreset[] = [
  {
    title: "", description: "",
    colors: {
      model: { color: "accent", bold: true },
    },
  },
  {
    title: "", description: "",
    colors: {
      model: { color: "accent", bold: true },
      cost: { color: "warning" },
      speed: { color: "success" },
      duration: { color: "info" },
      "git-branch": { color: "info", bold: true },
      "cache-hit-rate": { color: "success" },
    },
  },
  {
    title: "", description: "",
    colors: {
      model: { color: "muted" },
      tokens: { color: "muted" },
      speed: { color: "muted" },
      cost: { color: "muted" },
      duration: { color: "muted" },
      "git-branch": { color: "muted" },
      reasoning: { color: "muted" },
      "cache-write": { color: "muted" },
      "total-tokens": { color: "muted" },
      messages: { color: "muted" },
      "cache-hit-rate": { color: "muted" },
      "context-pct": { color: "muted" },
      "context-bar": { color: "muted" },
    },
  },
  {
    title: "", description: "",
    colors: {
      model: { bold: false },
    },
  },
]

function getPresets(locale?: Locale): NamedPreset[] {
  const m = getMessages(locale)
  return PRESET_COLORS.map((p, i) => ({
    title: m.presets[i]?.title ?? p.title,
    description: m.presets[i]?.description ?? p.description,
    colors: p.colors,
  }))
}

// ─── Color helpers ────────────────────────────────────────────────────

const ANSI16: Record<string, [number, number, number]> = {
  black: [0, 0, 0], red: [205, 49, 49], green: [13, 188, 121], yellow: [229, 229, 16],
  blue: [36, 114, 200], magenta: [188, 63, 188], cyan: [17, 168, 205], white: [229, 229, 229],
  brightBlack: [102, 102, 102], brightRed: [241, 76, 76], brightGreen: [35, 209, 139],
  brightYellow: [245, 245, 67], brightBlue: [59, 142, 234], brightMagenta: [214, 112, 214],
  brightCyan: [41, 184, 219], brightWhite: [255, 255, 255],
}

function xterm256(n: number): [number, number, number] {
  if (n < 16) return Object.values(ANSI16)[n] ?? [255, 255, 255]
  if (n >= 232) { const v = 8 + (n - 232) * 10; return [v, v, v] }
  const i = n - 16
  const conv = (x: number) => (x === 0 ? 0 : 55 + x * 40)
  return [conv(Math.floor(i / 36)), conv(Math.floor((i % 36) / 6)), conv(i % 6)]
}

function mkRgba(r: number, g: number, b: number): RGBA {
  return { r: r / 255, g: g / 255, b: b / 255, a: 1 } as RGBA
}

function resolveColor(theme: TuiThemeCurrent, color?: string): RGBA | undefined {
  if (!color) return undefined
  switch (color) {
    case "default": return theme.text
    case "muted": return theme.textMuted
    case "accent": return theme.accent
    case "success": return theme.success
    case "warning": return theme.warning
    case "error": return theme.error
    case "info": return theme.info
  }
  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    return mkRgba(parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16))
  }
  if (ANSI16[color]) return mkRgba(...ANSI16[color])
  if (/^\d{1,3}$/.test(color)) {
    const n = Number(color)
    if (n >= 0 && n <= 255) return mkRgba(...xterm256(n))
  }
  return undefined
}

// ─── Formatters ───────────────────────────────────────────────────────

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function fmtDuration(ms: number): string {
  if (ms <= 0) return ""
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  if (m > 0) return `${m}m${s}s`
  return `${s}s`
}

function contextColor(theme: TuiThemeCurrent, pct: number): RGBA {
  if (pct >= 80) return theme.error
  if (pct >= 65) return theme.warning
  return theme.accent
}

function dimBg(color: RGBA): RGBA {
  return { r: color.r, g: color.g, b: color.b, a: 0.1 } as RGBA
}

// ─── Widget rendering ─────────────────────────────────────────────────

interface Segment {
  text: string
  color: RGBA
  bold: boolean
  dim: boolean
  bg?: RGBA
}

function renderWidget(w: WidgetDef, data: StatusData, theme: TuiThemeCurrent): Segment[] | null {
  const bold = w.bold ?? false
  const dim = w.dim ?? false
  const custom = resolveColor(theme, w.color)
  const muted = theme.textMuted

  const seg = (text: string, color: RGBA, b = false, d = false, bg?: RGBA): Segment => ({
    text,
    color,
    bold: b || bold,
    dim: d || dim,
    bg,
  })
  const val = (text: string, fallback: RGBA, b = false, bg?: RGBA) => seg(text, custom ?? fallback, b, false, bg)

  switch (w.type) {
    case "separator":
      return [seg("│", muted, false, true)]

    case "text":
      return w.text ? [seg(w.text, custom ?? theme.text)] : null

    case "model": {
      const name = data.model || "—"
      const display = name.length > 20 ? name.slice(0, 18) + "…" : name
      return [val(display, theme.accent, true)]
    }

    case "tokens":
      return [
        seg("↑", muted),
        val(fmtTokens(data.inputTokens), theme.text),
        seg(" ", muted),
        seg("↓", muted),
        val(fmtTokens(data.outputTokens), theme.text),
      ]

    case "speed":
      if (data.speed <= 0) return [seg("— tok/s", muted)]
      return [val(data.speed.toFixed(1), theme.text), seg(" tok/s", muted)]

    case "cost": {
      const color = data.totalCost > 10 ? theme.error : data.totalCost > 1 ? theme.warning : theme.text
      return [val(`$${data.totalCost.toFixed(2)}`, color, false, dimBg(color))]
    }

    case "context-pct": {
      if (data.contextPct <= 0) return null
      return [val(`${data.contextPct}%`, contextColor(theme, data.contextPct)), seg(" ctx", muted)]
    }

    case "context-bar": {
      if (data.contextPct <= 0) return null
      const width = 15
      const filled = Math.round((Math.min(data.contextPct, 100) / 100) * width)
      const bar = "█".repeat(filled) + "░".repeat(width - filled)
      return [val(bar, contextColor(theme, data.contextPct))]
    }

    case "reasoning":
      return [seg("R ", muted), val(fmtTokens(data.reasoningTokens), theme.text)]

    case "cache-write":
      return data.cacheWriteTokens > 0
        ? [seg("CW ", muted), val(fmtTokens(data.cacheWriteTokens), theme.text)]
        : null

    case "total-tokens": {
      const total = data.inputTokens + data.outputTokens + data.reasoningTokens
      if (total <= 0) return null
      return [val(fmtTokens(total), theme.accent, true), seg(" total", muted)]
    }

    case "messages":
      return [seg("#", muted), val(String(data.messageCount), theme.text)]

    case "cache-hit-rate": {
      if (data.cacheHitRate < 0) return null
      const pct = Math.round(data.cacheHitRate * 100)
      const barColor = pct >= 80 ? theme.success : pct >= 50 ? theme.warning : theme.error
      const width = 10
      const filled = Math.round((Math.min(pct, 100) / 100) * width)
      const bar = "█".repeat(filled) + "░".repeat(width - filled)
      return [val(bar, barColor), seg(` ${pct}%`, barColor)]
    }

    case "duration":
      return data.durationMs > 0 ? [val(fmtDuration(data.durationMs), muted)] : null

    case "git-branch":
      return data.gitBranch
        ? [seg("", muted), val(` ${data.gitBranch}`, theme.text)]
        : null

    default:
      return null
  }
}

// ─── Config validation & helpers ──────────────────────────────────────

const KV_KEY = "opencode-statusline.config"
const PROFILES_KEY = "opencode-statusline.profiles"

function isValidConfig(v: unknown): v is StatuslineConfig {
  return (
    typeof v === "object" &&
    v !== null &&
    Array.isArray((v as StatuslineConfig).lines) &&
    (v as StatuslineConfig).lines.every(
      (line) => Array.isArray(line) && line.every((w) => typeof w === "object" && w !== null && typeof (w as WidgetDef).type === "string")
    )
  )
}

function cloneConfig(c: StatuslineConfig): StatuslineConfig {
  return JSON.parse(JSON.stringify(c))
}

function applyPreset(cfg: StatuslineConfig, preset: NamedPreset): StatuslineConfig {
  const out = cloneConfig(cfg)
  for (const line of out.lines) {
    for (const w of line) {
      const pc = preset.colors[w.type]
      if (pc) {
        if (pc.color !== undefined) w.color = pc.color
        if (pc.bold !== undefined) w.bold = pc.bold
        if (pc.dim !== undefined) w.dim = pc.dim
      }
    }
  }
  return out
}

// ─── Profiles ──────────────────────────────────────────────────────────

type Profiles = Record<string, StatuslineConfig>

async function loadProfiles(api: TuiPluginApi): Promise<Profiles> {
  return (await api.kv.get(PROFILES_KEY)) ?? ({} as Profiles)
}

function saveProfiles(api: TuiPluginApi, profiles: Profiles) {
  api.kv.set(PROFILES_KEY, profiles)
}

function profileNameExists(profiles: Profiles, name: string): boolean {
  return Object.keys(profiles).some((k) => k === name)
}

function nextProfileName(profiles: Profiles, locale?: Locale): string {
  const m = getMessages(locale)
  let i = 1
  let name: string
  do { name = m.nextProfileName(i++) } while (profileNameExists(profiles, name))
  return name
}

// ─── Export / Import ───────────────────────────────────────────────────

function exportPath(): string {
  return join(homedir(), ".config", "opencode", "statusline-config.json")
}

interface WidgetItem {
  line: number
  col: number
  def: WidgetDef
}

function flattenWidgets(cfg: StatuslineConfig): WidgetItem[] {
  const items: WidgetItem[] = []
  cfg.lines.forEach((line, li) => line.forEach((def, ci) => items.push({ line: li, col: ci, def })))
  return items
}

// ─── Global Install ────────────────────────────────────────────────────

async function tryInstallGlobal(api: TuiPluginApi, locale?: Locale) {
  const m = getMessages(locale)
  try {
    const projectDir = api.state.path.directory
    if (!projectDir) {
      api.ui.toast({ variant: "error", title: m.installFailNoDirTitle, message: m.installFailNoDirMsg })
      return
    }

    const srcPath = join(projectDir, ".opencode", "plugins", "opencode-statusline.tsx")
    const configDir = join(homedir(), ".config", "opencode")
    const pluginDir = join(configDir, "plugins")
    const pluginDest = join(pluginDir, "opencode-statusline.tsx")

    await mkdir(pluginDir, { recursive: true })
    await copyFile(srcPath, pluginDest)

    const tuiPath = join(configDir, "tui.json")
    const raw = await readFile(tuiPath, "utf-8")
    const json = JSON.parse(raw)
    if (!json.plugin) json.plugin = []
    const entry = pluginDest
    const oldEntry = "plugins/opencode-statusline.tsx"
    if (!json.plugin.some((p: unknown) => typeof p === "string" && p === entry)) {
      json.plugin = json.plugin.filter((p: unknown) => typeof p !== "string" || p !== oldEntry)
      json.plugin.push(entry)
      await writeFile(tuiPath, JSON.stringify(json, null, 2) + "\n")
    }

    api.ui.toast({ variant: "success", title: m.installSuccessTitle, message: m.installSuccessMsg })
  } catch (e) {
    const msg = e instanceof Error ? e.message + (e.stack ? " | " + e.stack.split("\n")[1]?.trim() : "") : `${e}`
    api.ui.toast({ variant: "error", title: m.installFailTitle, message: msg })
  }
}

// ─── Dialog: Main Menu ───────────────────────────────────────────────

function showMainMenu(
  api: TuiPluginApi,
  config: () => StatuslineConfig,
  setConfig: (c: StatuslineConfig) => void,
) {
  const m = getMessages(config().locale)
  const DialogSelect = api.ui.DialogSelect
  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => (
    <DialogSelect
      title={m.mainTitle}
      options={[
        { title: m.mainToggle, value: "toggle", description: m.mainToggleDesc },
        { title: m.mainMove, value: "move", description: m.mainMoveDesc },
        { title: m.mainAdd, value: "add", description: m.mainAddDesc },
        { title: m.mainReset, value: "reset", description: m.mainResetDesc },
        { title: m.mainPreset, value: "preset", description: m.mainPresetDesc },
        { title: m.mainProfiles, value: "profiles", description: m.mainProfilesDesc },
        { title: m.mainDone, value: "done" },
      ]}
      onSelect={(opt) => {
        if (!opt) return
        switch (opt.value) {
          case "toggle": showToggleDialog(api, config, setConfig); break
          case "move": showLinePickerForMove(api, config, setConfig); break
          case "add": showAddWidgetTypePicker(api, config, setConfig); break
          case "reset": {
            commitConfig(api, config, setConfig, cloneConfig(DEFAULT_CONFIG))
            showMainMenu(api, config, setConfig)
            break
          }
          case "preset": showPresetPicker(api, config, setConfig); break
          case "profiles": showProfileMenu(api, config, setConfig); break
          case "done": return
        }
      }}
    />
  ))
}

// ─── Dialog: Color Preset Picker ───────────────────────────────────────

function showPresetPicker(
  api: TuiPluginApi,
  config: () => StatuslineConfig,
  setConfig: (c: StatuslineConfig) => void,
) {
  const m = getMessages(config().locale)
  const presets = getPresets(config().locale)
  const DialogSelect = api.ui.DialogSelect
  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => (
    <DialogSelect
      title={m.presetTitle}
      options={[
        ...presets.map((p) => ({ title: p.title, value: p, description: p.description })),
        { title: m.presetBack, value: null, description: "" },
      ]}
      onSelect={(opt) => {
        if (!opt || opt.value === null) { showMainMenu(api, config, setConfig); return }
        commitConfig(api, config, setConfig, applyPreset(config(), opt.value as NamedPreset))
        showMainMenu(api, config, setConfig)
      }}
    />
  ))
}

// ─── Dialog: Profile Menu ──────────────────────────────────────────────

async function showProfileMenu(
  api: TuiPluginApi,
  config: () => StatuslineConfig,
  setConfig: (c: StatuslineConfig) => void,
) {
  const m = getMessages(config().locale)
  const DialogSelect = api.ui.DialogSelect
  const profiles = await loadProfiles(api)
  const count = Object.keys(profiles).length
  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => (
    <DialogSelect
      title={m.profilesTitle}
      options={[
        { title: m.profilesSave, value: "save", description: m.profilesSaveDesc(count) },
        { title: m.profilesLoad, value: "load", description: m.profilesLoadDesc },
        { title: m.profilesDelete, value: "delete", description: "" },
        { title: m.profilesExport, value: "export", description: m.profilesExportDesc(exportPath()) },
        { title: m.profilesImport, value: "import", description: m.profilesImportDesc },
        { title: "🌐 " + m.localeTitle, value: "locale", description: config().locale ?? "zh-CN" },
        { title: m.profilesBack, value: null, description: "" },
      ]}
      onSelect={async (opt) => {
        if (!opt || opt.value === null) { showMainMenu(api, config, setConfig); return }
        switch (opt.value) {
          case "locale": showLocalePickerDialog(api, config, setConfig); break
          case "save": {
            const p = await loadProfiles(api)
            const name = nextProfileName(p, config().locale)
            p[name] = cloneConfig(config())
            saveProfiles(api, p)
            showProfileMenu(api, config, setConfig)
            break
          }
          case "load": showProfileLoadDialog(api, config, setConfig); break
          case "delete": showProfileDeleteDialog(api, config, setConfig); break
          case "export": {
            await writeFile(exportPath(), JSON.stringify(config(), null, 2))
            showProfileMenu(api, config, setConfig)
            break
          }
          case "import": {
            const raw = await readFile(exportPath(), "utf-8")
            const imported = JSON.parse(raw) as StatuslineConfig
            if (imported.lines && Array.isArray(imported.lines)) {
              commitConfig(api, config, setConfig, imported)
            }
            showProfileMenu(api, config, setConfig)
            break
          }
        }
      }}
    />
  ))
}

async function showProfileLoadDialog(
  api: TuiPluginApi,
  config: () => StatuslineConfig,
  setConfig: (c: StatuslineConfig) => void,
) {
  const m = getMessages(config().locale)
  const DialogSelect = api.ui.DialogSelect
  const profiles = await loadProfiles(api)
  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => (
    <DialogSelect
      title={m.profileLoadTitle}
      options={[
        ...Object.entries(profiles).map(([name, _cfg]) => ({
          title: name,
          value: name,
          description: m.profileLoadDesc(_cfg.lines.length),
        })),
        { title: m.profileLoadBack, value: null, description: "" },
      ]}
      onSelect={async (opt) => {
        if (!opt || opt.value === null) { showProfileMenu(api, config, setConfig); return }
        const p = await loadProfiles(api)
        const selected = p[opt.value as string]
        if (selected) {
          commitConfig(api, config, setConfig, cloneConfig(selected))
        }
        showProfileMenu(api, config, setConfig)
      }}
    />
  ))
}

async function showProfileDeleteDialog(
  api: TuiPluginApi,
  config: () => StatuslineConfig,
  setConfig: (c: StatuslineConfig) => void,
) {
  const m = getMessages(config().locale)
  const DialogSelect = api.ui.DialogSelect
  const profiles = await loadProfiles(api)
  const entries = Object.entries(profiles)
  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => (
    <DialogSelect
      title={m.profileDeleteTitle}
      options={[
        ...entries.map(([name]) => ({ title: `✕ ${name}`, value: name, description: "" })),
        { title: m.profileDeleteBack, value: null, description: "" },
      ]}
      onSelect={async (opt) => {
        if (!opt || opt.value === null) { showProfileMenu(api, config, setConfig); return }
        const name = opt.value as string
        const p = await loadProfiles(api)
        delete p[name]
        saveProfiles(api, p)
        showProfileMenu(api, config, setConfig)
      }}
    />
  ))
}

// ─── Dialog: Locale picker ────────────────────────────────────────────

function showLocalePickerDialog(
  api: TuiPluginApi,
  config: () => StatuslineConfig,
  setConfig: (c: StatuslineConfig) => void,
) {
  const m = getMessages(config().locale)
  const DialogSelect = api.ui.DialogSelect
  api.ui.dialog.setSize("medium")
  const current = config().locale ?? "zh-CN"
  api.ui.dialog.replace(() => (
    <DialogSelect
      title={m.localeTitle}
      options={[
        { title: `${current === "zh-CN" ? "●" : "○"} 中文`, value: "zh-CN", description: "" },
        { title: `${current === "en" ? "●" : "○"} English`, value: "en", description: "" },
        { title: m.profilesBack, value: null, description: "" },
      ]}
      onSelect={async (opt) => {
        if (!opt || opt.value === null) { showProfileMenu(api, config, setConfig); return }
        const locale = opt.value as Locale
        const next: StatuslineConfig = { ...config(), locale }
        commitConfig(api, config, setConfig, next)
        showProfileMenu(api, config, setConfig)
      }}
    />
  ))
}

// ─── Dialog: Toggle visibility ────────────────────────────────────────

function showToggleDialog(
  api: TuiPluginApi,
  config: () => StatuslineConfig,
  setConfig: (c: StatuslineConfig) => void,
) {
  const m = getMessages(config().locale)
  const list = flattenWidgets(config())
  const options: TuiDialogSelectOption<{ line: number; col: number } | null>[] = list.map((it) => ({
    title: `${it.def.hide ? "[ ]" : "[x]"} ${WIDGET_LABELS[it.def.type] ?? it.def.type}${it.def.text ? ` "${it.def.text}"` : ""}`,
    value: { line: it.line, col: it.col },
    description: m.toggleRow(WIDGET_LABELS[it.def.type] ?? it.def.type, it.line),
  }))
  options.unshift({ title: m.toggleBack, value: null, description: "" })

  const DialogSelect = api.ui.DialogSelect
  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => (
    <DialogSelect
      title={m.toggleTitle}
      options={options}
      onSelect={(opt) => {
        if (!opt || opt.value === null) { showMainMenu(api, config, setConfig); return }
        const { line, col } = opt.value
        commitConfig(api, config, setConfig, {
          lines: config().lines.map((l, li) =>
            l.map((w, ci) => (li === line && ci === col ? { ...w, hide: !w.hide } : { ...w }))
          ),
        })
        setTimeout(() => showToggleDialog(api, config, setConfig), 0)
      }}
    />
  ))
}

// ─── Dialog: Edit Layout — Line picker ────────────────────────────────

function linePreview(line: WidgetDef[], locale?: Locale): string {
  const m = getMessages(locale)
  const shown = line.filter((w) => !w.hide)
  if (shown.length === 0) return m.noVisible
  return shown
    .map((w) => {
      switch (w.type) {
        case "separator": return "│"
        case "context-bar": return "▤▤"
        case "text": return w.text || "txt"
        case "model": return "M"
        case "tokens": return "↑↓"
        case "speed": return "tok/s"
        case "cost": return "$"
        case "context-pct": return "%"
        case "duration": return "⏱"
        case "git-branch": return "git"
      }
    })
    .join(" ")
}

function showLinePickerForMove(
  api: TuiPluginApi,
  config: () => StatuslineConfig,
  setConfig: (c: StatuslineConfig) => void,
) {
  const m = getMessages(config().locale)
  const options: TuiDialogSelectOption<number | null>[] = config().lines.map((line, li) => ({
    title: `${m.moveLineTitle(li)}${linePreview(line, config().locale)}`,
    value: li,
    description: m.moveLineDesc(line.filter((w) => !w.hide).length, line.length),
  }))
  options.push({ title: m.moveBack, value: null, description: "" })

  const DialogSelect = api.ui.DialogSelect
  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => (
    <DialogSelect
      title={m.moveTitle}
      options={options}
      onSelect={(opt) => {
        if (!opt || opt.value === null) { showMainMenu(api, config, setConfig); return }
        showWidgetListForLine(api, config, setConfig, opt.value)
      }}
    />
  ))
}

// ─── Dialog: Edit Layout — Widget list in line ────────────────────────

function showWidgetListForLine(
  api: TuiPluginApi,
  config: () => StatuslineConfig,
  setConfig: (c: StatuslineConfig) => void,
  lineIdx: number,
) {
  const m = getMessages(config().locale)
  const line = config().lines[lineIdx]
  const options: TuiDialogSelectOption<{ action: string; col?: number } | null>[] = line.map((w, ci) => ({
    title: `${w.hide ? "[ ] " : ""}${WIDGET_LABELS[w.type] ?? w.type}${w.text ? ` "${w.text}"` : ""}${w.color ? ` (${w.color})` : ""}`,
    value: { action: "select", col: ci },
    description: `#${ci + 1}`,
  }))
  options.push({ title: m.addAppendLine, value: { action: "append" }, description: "" })
  options.push({ title: m.widgetActionsBack, value: null, description: "" })

  const DialogSelect = api.ui.DialogSelect
  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => (
    <DialogSelect
      title={m.moveLineTitle(lineIdx)}
      options={options}
      onSelect={(opt) => {
        if (!opt || opt.value === null) { showLinePickerForMove(api, config, setConfig); return }
        if (opt.value.action === "append") {
          showAddWidgetTypePickerToLine(api, config, setConfig, lineIdx, line.length)
          return
        }
        if (opt.value.action === "select") {
          showWidgetActions(api, config, setConfig, lineIdx, opt.value.col!)
        }
      }}
    />
  ))
}

// ─── Dialog: Widget actions (left/right/delete/color/etc) ─────────────

function showWidgetActions(
  api: TuiPluginApi,
  config: () => StatuslineConfig,
  setConfig: (c: StatuslineConfig) => void,
  lineIdx: number,
  col: number,
) {
  const m = getMessages(config().locale)
  const locale = config().locale
  const widget = config().lines[lineIdx][col]
  const widgetLabel = WIDGET_LABELS[widget.type] ?? widget.type

  const options: TuiDialogSelectOption<string | null>[] = []

  if (col > 0) {
    const prevLabel = WIDGET_LABELS[config().lines[lineIdx][col - 1].type] ?? config().lines[lineIdx][col - 1].type
    options.push({ title: m.widgetLeft, value: "left", description: prevLabel })
  }
  if (col < config().lines[lineIdx].length - 1) {
    const nextLabel = WIDGET_LABELS[config().lines[lineIdx][col + 1].type] ?? config().lines[lineIdx][col + 1].type
    options.push({ title: m.widgetRight, value: "right", description: nextLabel })
  }
  if (config().lines.length > 1) {
    options.push({ title: m.widgetMoveLine, value: "move-line", description: "" })
  }
  options.push({ title: widget.hide ? m.widgetShow : m.widgetHide, value: "toggle", description: "" })
  options.push({ title: m.widgetColor, value: "color", description: "" })
  options.push({ title: m.widgetDelete, value: "delete", description: "" })
  options.push({ title: m.widgetActionsBack, value: null, description: "" })

  const DialogSelect = api.ui.DialogSelect
  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => (
    <DialogSelect
      title={`${widgetLabel}`}
      options={options}
      onSelect={(opt) => {
        if (!opt || opt.value === null) { showWidgetListForLine(api, config, setConfig, lineIdx); return }
        const { lines } = cloneConfig(config())

        switch (opt.value) {
          case "left": {
            const a = lines[lineIdx][col - 1]
            const b = lines[lineIdx][col]
            lines[lineIdx][col - 1] = b
            lines[lineIdx][col] = a
            commitConfig(api, config, setConfig, { lines })
            setTimeout(() => showWidgetActions(api, config, setConfig, lineIdx, col - 1), 0)
            break
          }
          case "right": {
            const a = lines[lineIdx][col]
            const b = lines[lineIdx][col + 1]
            lines[lineIdx][col] = b
            lines[lineIdx][col + 1] = a
            commitConfig(api, config, setConfig, { lines })
            setTimeout(() => showWidgetActions(api, config, setConfig, lineIdx, col + 1), 0)
            break
          }
          case "move-line": {
            showMoveTargetDialog(api, config, setConfig, lineIdx, col)
            break
          }
          case "toggle": {
            lines[lineIdx][col].hide = !lines[lineIdx][col].hide
            commitConfig(api, config, setConfig, { lines })
            setTimeout(() => showWidgetActions(api, config, setConfig, lineIdx, col), 0)
            break
          }
          case "color": {
            showColorPicker(api, config, setConfig, lineIdx, col)
            break
          }
          case "delete": {
            lines[lineIdx].splice(col, 1)
            const removedLine = lines[lineIdx].length === 0
            if (removedLine) lines.splice(lineIdx, 1)
            commitConfig(api, config, setConfig, { lines })
            if (removedLine) {
              if (lines.length === 0) {
                const reset = cloneConfig(DEFAULT_CONFIG)
                setConfig(reset)
                api.kv.set(KV_KEY, reset)
                showMainMenu(api, config, setConfig)
              } else {
                showLinePickerForMove(api, config, setConfig)
              }
            } else {
              setTimeout(() => showWidgetListForLine(api, config, setConfig, lineIdx), 0)
            }
            break
          }
        }
      }}
    />
  ))
}

// ─── Dialog: Move target line picker ──────────────────────────────────

function showMoveTargetDialog(
  api: TuiPluginApi,
  config: () => StatuslineConfig,
  setConfig: (c: StatuslineConfig) => void,
  srcIdx: number,
  col: number,
) {
  const m = getMessages(config().locale)
  const options: TuiDialogSelectOption<number | null>[] = config().lines
    .map((line, li) => ({
      title: `${m.moveLineTitle(li)}${linePreview(line, config().locale)}`,
      value: li,
      description: `${line.length} widgets`,
    }))
    .filter((o) => o.value !== srcIdx)
  options.push({ title: m.widgetActionsBack, value: null, description: "" })

  const DialogSelect = api.ui.DialogSelect
  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => (
    <DialogSelect
      title={m.moveTargetTitle}
      options={options}
      onSelect={(opt) => {
        if (!opt || opt.value === null) { showWidgetActions(api, config, setConfig, srcIdx, col); return }
        const { lines } = cloneConfig(config())
        const widget = lines[srcIdx].splice(col, 1)[0]
        let targetIdx = opt.value
        if (lines[srcIdx].length === 0) {
          lines.splice(srcIdx, 1)
          if (targetIdx > srcIdx) targetIdx--
        }
        lines[targetIdx].push(widget)
        commitConfig(api, config, setConfig, { lines })
        showLinePickerForMove(api, config, setConfig)
      }}
    />
  ))
}

// ─── Dialog: Color picker ─────────────────────────────────────────────

function showColorPicker(
  api: TuiPluginApi,
  config: () => StatuslineConfig,
  setConfig: (c: StatuslineConfig) => void,
  lineIdx: number,
  col: number,
) {
  const m = getMessages(config().locale)
  const widget = config().lines[lineIdx][col]
  const options: TuiDialogSelectOption<string | undefined | null>[] = m.colorOptions.map((o) => ({
    title: `${widget.color === o.value ? "●" : "○"} ${o.label}`,
    value: o.value,
    description: o.value ? `color: "${o.value}"` : o.value === "" ? m.colorClearDesc : "",
  }))
  options.push({ title: m.colorBack, value: null, description: "" })

  const DialogSelect = api.ui.DialogSelect
  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => (
    <DialogSelect
      title={m.colorTitle}
      options={options}
      onSelect={(opt) => {
        if (!opt || opt.value === null) { showWidgetActions(api, config, setConfig, lineIdx, col); return }
        const { lines } = cloneConfig(config())
        const newColor = opt.value === "" ? undefined : opt.value
        if (newColor) lines[lineIdx][col].color = newColor
        else delete lines[lineIdx][col].color
        commitConfig(api, config, setConfig, { lines })
        setTimeout(() => showWidgetActions(api, config, setConfig, lineIdx, col), 0)
      }}
    />
  ))
}

// ─── Dialog: Add widget — type picker ─────────────────────────────────

function showAddWidgetTypePicker(
  api: TuiPluginApi,
  config: () => StatuslineConfig,
  setConfig: (c: StatuslineConfig) => void,
) {
  const m = getMessages(config().locale)
  const options: TuiDialogSelectOption<WidgetType | null>[] = ALL_WIDGET_TYPES.map((t) => ({
    title: WIDGET_LABELS[t] ?? t,
    value: t,
    description: "",
  }))
  options.push({ title: m.presetBack, value: null, description: "" })

  const DialogSelect = api.ui.DialogSelect
  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => (
    <DialogSelect
      title={m.addTypeTitle}
      options={options}
      onSelect={(opt) => {
        if (!opt || opt.value === null) { showMainMenu(api, config, setConfig); return }
        showAddWidgetLinePicker(api, config, setConfig, opt.value)
      }}
    />
  ))
}

// ─── Dialog: Add widget — target line picker ──────────────────────────

function showAddWidgetLinePicker(
  api: TuiPluginApi,
  config: () => StatuslineConfig,
  setConfig: (c: StatuslineConfig) => void,
  wtype: WidgetType,
) {
  const m = getMessages(config().locale)
  const options: TuiDialogSelectOption<number | null>[] = config().lines.map((line, li) => ({
    title: `${m.moveLineTitle(li)}${linePreview(line, config().locale)}`,
    value: li,
    description: `${line.length} widgets`,
  }))
  options.push({ title: m.addNewLine, value: -1, description: "" })
  options.push({ title: m.addBack, value: null, description: m.addTypeTitle })

  const DialogSelect = api.ui.DialogSelect
  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => (
    <DialogSelect
      title={m.addLineTitle}
      options={options}
      onSelect={(opt) => {
        if (!opt || opt.value === null) { showAddWidgetTypePicker(api, config, setConfig); return }
        if (opt.value === -1) {
          const { lines } = cloneConfig(config())
          const widget: WidgetDef = { type: wtype }
          if (wtype === "text") widget.text = m.defaultText
          lines.push([widget])
          commitConfig(api, config, setConfig, { lines })
          showMainMenu(api, config, setConfig)
          return
        }
        showAddWidgetPositionPicker(api, config, setConfig, wtype, opt.value)
      }}
    />
  ))
}

// ─── Dialog: Add widget — position picker ─────────────────────────────

function showAddWidgetPositionPicker(
  api: TuiPluginApi,
  config: () => StatuslineConfig,
  setConfig: (c: StatuslineConfig) => void,
  wtype: WidgetType,
  lineIdx: number,
) {
  const m = getMessages(config().locale)
  const line = config().lines[lineIdx]
  const total = line.length
  const options: TuiDialogSelectOption<number | null>[] = [
    { title: m.posAtStart, value: 0, description: line.length > 0 ? m.posBefore(WIDGET_LABELS[line[0].type] ?? line[0].type) : "" },
  ]
  for (let i = 0; i < total; i++) {
    const at = i + 1
    const label = WIDGET_LABELS[line[i].type] ?? line[i].type
    if (at < total) {
      const nextLabel = WIDGET_LABELS[line[at].type] ?? line[at].type
      options.push({ title: m.posAfter(label), value: at, description: m.posBeforeNext(nextLabel) })
    } else {
      options.push({ title: m.posAfter(label), value: at, description: m.posEnd })
    }
  }
  if (total === 0) {
    options.push({ title: m.posEmptyRow, value: 0, description: "" })
  }
  options.push({ title: m.addBack, value: null, description: m.addLineTitle })

  const DialogSelect = api.ui.DialogSelect
  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => (
    <DialogSelect
      title={m.addPositionTitle}
      options={options}
      onSelect={(opt) => {
        if (!opt || opt.value === null) { showAddWidgetLinePicker(api, config, setConfig, wtype); return }
        const { lines } = cloneConfig(config())
        const widget: WidgetDef = { type: wtype }
        if (wtype === "text") widget.text = m.defaultText
        lines[lineIdx].splice(opt.value, 0, widget)
        commitConfig(api, config, setConfig, { lines })
        showMainMenu(api, config, setConfig)
      }}
    />
  ))
}

// ─── Dialog: Add widget to specific line (from edit layout) ───────────

function showAddWidgetTypePickerToLine(
  api: TuiPluginApi,
  config: () => StatuslineConfig,
  setConfig: (c: StatuslineConfig) => void,
  lineIdx: number,
  insertIdx: number,
) {
  const m = getMessages(config().locale)
  const options: TuiDialogSelectOption<WidgetType | null>[] = ALL_WIDGET_TYPES.map((t) => ({
    title: WIDGET_LABELS[t] ?? t,
    value: t,
    description: "",
  }))
  options.push({ title: m.widgetActionsBack, value: null, description: "" })

  const DialogSelect = api.ui.DialogSelect
  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => (
    <DialogSelect
      title={m.addTypeTitle}
      options={options}
      onSelect={(opt) => {
        if (!opt || opt.value === null) { showWidgetListForLine(api, config, setConfig, lineIdx); return }
        const { lines } = cloneConfig(config())
        const widget: WidgetDef = { type: opt.value }
        if (opt.value === "text") widget.text = m.defaultText
        lines[lineIdx].splice(insertIdx, 0, widget)
        commitConfig(api, config, setConfig, { lines })
        setTimeout(() => showWidgetListForLine(api, config, setConfig, lineIdx), 0)
      }}
    />
  ))
}

// ─── Config commit helper ─────────────────────────────────────────────

function commitConfig(
  api: TuiPluginApi,
  config: () => StatuslineConfig,
  setConfig: (c: StatuslineConfig) => void,
  next: StatuslineConfig,
) {
  const prevLocale = config().locale
  setConfig(next)
  api.kv.set(KV_KEY, next)
  if (next.locale && next.locale !== prevLocale) {
    setLocale(next.locale)
  }
}

// ─── Plugin entry ─────────────────────────────────────────────────────

const tui: TuiPlugin = async (api, options, meta) => {
  createRoot((dispose) => {
    const [data, setData] = createSignal<StatusData>(INITIAL_DATA)
    // Priority: tui.json plugin options > kv > built-in default
    const kvConfig = api.kv.get<unknown>(KV_KEY)
    const optionsConfig = isValidConfig(options?.lines ? options : null)
      ? (options as unknown as StatuslineConfig)
      : undefined
    const initialConfig = optionsConfig ?? (isValidConfig(kvConfig) ? kvConfig : DEFAULT_CONFIG)
    const [config, setConfig] = createSignal<StatuslineConfig>(initialConfig)
    if (!kvConfig && !optionsConfig) api.kv.set(KV_KEY, DEFAULT_CONFIG)
    setLocale(initialConfig.locale ?? "zh-CN")

    function modelDisplayName(providerID: string, modelID: string): { name: string; limit: number } {
      const provider = api.state.provider.find((p) => p.id === providerID)
      const model = provider?.models[modelID]
      return {
        name: model?.name ?? `${providerID}/${modelID}`,
        limit: model?.limit.context ?? 0,
      }
    }

    function applyAssistantMessage(msg: AssistantMessage) {
      setData((prev) => {
        const next = { ...prev }
        const { name, limit } = modelDisplayName(msg.providerID, msg.modelID)
        next.model = name
        if (limit > 0) next.contextLimit = limit
        next.inputTokens = msg.tokens.input + msg.tokens.cache.read
        next.outputTokens = msg.tokens.output
        next.reasoningTokens = msg.tokens.reasoning
        next.cacheWriteTokens = msg.tokens.cache.write
        if (next.contextLimit > 0) {
          const used = msg.tokens.input + msg.tokens.cache.read + msg.tokens.output + msg.tokens.reasoning
          next.contextPct = Math.min(100, Math.round((used / next.contextLimit) * 100))
        }
        const cacheRead = msg.tokens.cache.read
        const freshInput = msg.tokens.input
        next.cacheHitRate = cacheRead + freshInput > 0 ? cacheRead / (cacheRead + freshInput) : -1

        if (msg.time.completed && msg.time.created) {
          next.durationMs = msg.time.completed - msg.time.created
          if (msg.tokens.output > 0 && next.durationMs > 0) {
            next.speed = (msg.tokens.output / next.durationMs) * 1000
          }
        }
        return next
      })
    }

    const unsubMessage = api.event.on("message.updated", (event) => {
      const info = event.properties.info
      if (info.role === "assistant") applyAssistantMessage(info)
    })

    let backfilledSessionID = ""
    let backfillAttempts = 0

    function backfill(sessionID: string) {
      if (!sessionID) return
      if (sessionID !== backfilledSessionID) {
        backfilledSessionID = sessionID
        backfillAttempts = 0
      }
      const msgs = api.state.session.messages(sessionID)
      if (msgs.length === 0) {
        if (backfillAttempts < 8) {
          backfillAttempts++
          setTimeout(() => backfill(backfilledSessionID), 700)
        }
        return
      }
      const assistants = msgs.filter((m) => m.role === "assistant") as AssistantMessage[]
      const lastAssistant = [...assistants].reverse().find((m) => m.time.completed) ?? assistants[assistants.length - 1]
      if (lastAssistant) applyAssistantMessage(lastAssistant)
      const ses = api.state.session.get(sessionID)
      if (typeof ses?.cost === "number") {
        setData((prev) => ({ ...prev, totalCost: ses.cost! }))
      }
      setData((prev) => ({ ...prev, messageCount: msgs.length }))
    }

    const unsubSession = api.event.on("session.updated", (event) => {
      const ses = event.properties.info
      setData((prev) => ({
        ...prev,
        totalCost: typeof ses.cost === "number" ? ses.cost : prev.totalCost,
      }))
    })

    const partSamples: { t: number; chars: number }[] = []
    let lastPartChars = 0
    let lastPartMessageID = ""
    const unsubPart = api.event.on("message.part.updated", (event) => {
      const part = event.properties.part
      if (part.type !== "text") return
      const text = (part as TextPart).text ?? ""
      const now = Date.now()
      if (part.messageID !== lastPartMessageID) {
        lastPartMessageID = part.messageID
        lastPartChars = 0
        partSamples.length = 0
      }
      const delta = Math.max(0, text.length - lastPartChars)
      lastPartChars = text.length
      if (delta === 0) return
      partSamples.push({ t: now, chars: delta })
      const cutoff = now - 5000
      while (partSamples.length && partSamples[0].t < cutoff) partSamples.shift()
      if (partSamples.length >= 2) {
        const span = (partSamples[partSamples.length - 1].t - partSamples[0].t) / 1000
        if (span > 0.2) {
          const chars = partSamples.reduce((s, x) => s + x.chars, 0)
          setData((prev) => ({ ...prev, speed: chars / 4 / span }))
        }
      }
    })

    const unsubVcs = api.event.on("vcs.branch.updated", (event) => {
      setData((prev) => ({ ...prev, gitBranch: event.properties.branch }))
    })

    setData((prev) => ({ ...prev, gitBranch: api.state.vcs?.branch }))

    const cmdM = getMessages(initialConfig.locale)
    api.keymap.registerLayer({
      commands: [
        {
          name: "opencode-statusline.configure",
          title: cmdM.mainTitle,
          category: "Plugin",
          namespace: "palette",
          slashName: "statusline",
          run() {
            showMainMenu(api, config, setConfig)
          },
        },
        {
          name: "opencode-statusline.global-install",
          title: cmdM.installSuccessTitle,
          category: "Plugin",
          namespace: "palette",
          slashName: "statusline-global",
          async run() {
            await tryInstallGlobal(api, initialConfig.locale)
          },
        },
      ],
    })

    api.lifecycle.onDispose(() => {
      unsubMessage()
      unsubSession()
      unsubPart()
      unsubVcs()
      dispose()
    })

    api.slots.register({
      slots: {
        sidebar_footer: (ctx, props) => {
          const theme = ctx.theme.current
          backfill(props.session_id)
          return (
            <box
              flexDirection="column"
              paddingLeft={1}
              paddingRight={1}
              paddingTop={1}
              gap={1}
              border={["top"]}
              borderColor={theme.borderSubtle}
            >
              {config().lines.map((line) => {
                const rendered = line
                  .filter((w) => !w.hide)
                  .map((w) => ({ w, segs: renderWidget(w, data(), theme) }))
                  .filter((x): x is { w: WidgetDef; segs: Segment[] } => x.segs !== null && x.segs.length > 0)
                const widgets = rendered.filter((x, i) => {
                  if (x.w.type !== "separator") return true
                  const prev = rendered[i - 1]
                  const next = rendered[i + 1]
                  return !!prev && !!next && prev.w.type !== "separator" && next.w.type !== "separator"
                })
                if (widgets.length === 0) return null
                return (
                  <text>
                    {widgets.flatMap(({ segs }, i) => {
                      const spans = segs.map((s) => (
                        <span style={{ fg: s.color, bold: s.bold, dim: s.dim, bg: s.bg } as never}>{s.text}</span>
                      ))
                      return i < widgets.length - 1 ? [...spans, " "] : spans
                    })}
                  </text>
                )
              })}
            </box>
          )
        },
      },
    })
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "opencode-statusline",
  tui,
}

export default plugin
