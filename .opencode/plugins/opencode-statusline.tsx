/** @jsxImportSource @opentui/solid */
import { createRoot, createSignal, type Accessor } from "solid-js"
import type { RGBA } from "@opentui/core"
import type { TuiPlugin, TuiPluginModule, TuiPluginApi, TuiPluginMeta, TuiThemeCurrent, TuiDialogSelectOption } from "@opencode-ai/plugin/tui"
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

interface StatuslineConfig {
  lines: WidgetDef[][]
}

const DEFAULT_CONFIG: StatuslineConfig = {
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

const WIDGET_LABELS: Record<WidgetType, string> = {
  model: "模型名",
  tokens: "Token 用量",
  speed: "生成速度",
  cost: "累计费用",
  "context-pct": "Context 百分比",
  "context-bar": "Context 进度条",
  "git-branch": "Git 分支",
  duration: "会话耗时",
  reasoning: "思考 tokens",
  "cache-write": "缓存写入",
  "total-tokens": "总 Token 用量",
  messages: "消息数",
  "cache-hit-rate": "缓存命中率",
  separator: "分隔符",
  text: "自定义文字",
}

const ALL_WIDGET_TYPES: WidgetType[] = [
  "model", "tokens", "speed", "cost", "context-pct", "context-bar",
  "git-branch", "duration", "reasoning", "cache-write", "total-tokens",
  "messages", "cache-hit-rate", "separator", "text",
]

// ─── Color Presets ─────────────────────────────────────────────────────

interface NamedPreset {
  title: string
  description: string
  colors: Partial<Record<WidgetType, { color?: string; bold?: boolean; dim?: boolean }>>
}

const PRESETS: NamedPreset[] = [
  {
    title: "默认", description: "官方风格：模型名高亮加粗，其余默认",
    colors: {
      model: { color: "accent", bold: true },
    },
  },
  {
    title: "醒目", description: "数据值全高亮：费用警告色、速度成功色、分支信息色",
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
    title: "柔和", description: "统一淡灰色调，低视觉干扰",
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
    title: "素净", description: "无加粗，所有值使用默认色",
    colors: {
      model: { bold: false },
    },
  },
]

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
const EXPORT_PATH = "~/.config/opencode/statusline-config.json"

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

function nextProfileName(profiles: Profiles): string {
  let i = 1
  while (profileNameExists(profiles, `方案 ${i}`)) i++
  return `方案 ${i}`
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

async function tryInstallGlobal(api: TuiPluginApi) {
  try {
    const projectDir = api.state.path.directory
    if (!projectDir) {
      api.ui.toast({ variant: "error", title: "安装失败", message: "无法获取项目目录" })
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
    const entry = "plugins/opencode-statusline.tsx"
    if (!json.plugin.some((p: unknown) => typeof p === "string" && p === entry)) {
      json.plugin.push(entry)
      await writeFile(tuiPath, JSON.stringify(json, null, 2) + "\n")
    }

    api.ui.toast({ variant: "success", title: "已安装到全局", message: "重启 opencode 后所有会话生效" })
  } catch (e) {
    const msg = e instanceof Error ? e.message + (e.stack ? " | " + e.stack.split("\n")[1]?.trim() : "") : `${e}`
    api.ui.toast({ variant: "error", title: "安装失败", message: msg })
  }
}

// ─── Dialog: Main Menu ───────────────────────────────────────────────

function showMainMenu(
  api: TuiPluginApi,
  config: () => StatuslineConfig,
  setConfig: (c: StatuslineConfig) => void,
) {
  const DialogSelect = api.ui.DialogSelect
  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => (
    <DialogSelect
      title="Statusline 配置"
      options={[
        { title: "切换组件显示", value: "toggle", description: "显示或隐藏现有组件" },
        { title: "编辑布局", value: "move", description: "调整组件位置、删除组件" },
        { title: "添加组件", value: "add", description: "插入新组件到指定位置" },
        { title: "↺ 恢复默认", value: "reset", description: "重置为出厂配置" },
        { title: "🎨 配色方案", value: "preset", description: "应用预设配色" },
        { title: "📁 配置文件", value: "profiles", description: "多方案保存、加载、导入导出" },
        { title: "✓ 完成", value: "done" },
      ]}
      onSelect={(opt) => {
        if (!opt) return
        switch (opt.value) {
          case "toggle": showToggleDialog(api, config, setConfig); break
          case "move": showLinePickerForMove(api, config, setConfig); break
          case "add": showAddWidgetTypePicker(api, config, setConfig); break
          case "reset": {
            const next = cloneConfig(DEFAULT_CONFIG)
            setConfig(next)
            api.kv.set(KV_KEY, next)
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
  const DialogSelect = api.ui.DialogSelect
  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => (
    <DialogSelect
      title="选择配色方案"
      options={[
        ...PRESETS.map((p) => ({ title: p.title, value: p, description: p.description })),
        { title: "← 返回主菜单", value: null, description: "" },
      ]}
      onSelect={(opt) => {
        if (!opt || opt.value === null) { showMainMenu(api, config, setConfig); return }
        const next = applyPreset(config(), opt.value as NamedPreset)
        setConfig(next)
        api.kv.set(KV_KEY, next)
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
  const DialogSelect = api.ui.DialogSelect
  const profiles = await loadProfiles(api)
  const count = Object.keys(profiles).length
  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => (
    <DialogSelect
      title="配置文件管理"
      options={[
        { title: `💾 保存当前配置`, value: "save", description: count > 0 ? `已有 ${count} 个方案` : "尚无已保存的方案" },
        { title: `📂 加载配置方案`, value: "load", description: "从已保存的方案中切换" },
        { title: `🗑 删除配置方案`, value: "delete", description: "" },
        { title: `📤 导出到文件`, value: "export", description: `保存到 ${exportPath()}` },
        { title: `📥 从文件导入`, value: "import", description: "从 JSON 文件恢复配置" },
        { title: "← 返回主菜单", value: null, description: "" },
      ]}
      onSelect={async (opt) => {
        if (!opt || opt.value === null) { showMainMenu(api, config, setConfig); return }
        switch (opt.value) {
          case "save": {
            const p = await loadProfiles(api)
            const name = nextProfileName(p)
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
              setConfig(imported)
              api.kv.set(KV_KEY, imported)
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
  const DialogSelect = api.ui.DialogSelect
  const profiles = await loadProfiles(api)
  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => (
    <DialogSelect
      title="选择要加载的方案"
      options={[
        ...Object.entries(profiles).map(([name, _cfg]) => ({
          title: name,
          value: name,
          description: `${_cfg.lines.length} 行`,
        })),
        { title: "← 返回", value: null, description: "" },
      ]}
      onSelect={async (opt) => {
        if (!opt || opt.value === null) { showProfileMenu(api, config, setConfig); return }
        const p = await loadProfiles(api)
        const selected = p[opt.value as string]
        if (selected) {
          setConfig(cloneConfig(selected))
          api.kv.set(KV_KEY, selected)
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
  const DialogSelect = api.ui.DialogSelect
  const profiles = await loadProfiles(api)
  const entries = Object.entries(profiles)
  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => (
    <DialogSelect
      title="选择要删除的方案"
      options={[
        ...entries.map(([name]) => ({ title: `✕ ${name}`, value: name, description: "" })),
        { title: "← 返回", value: null, description: "" },
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

// ─── Dialog: Toggle visibility ────────────────────────────────────────

function showToggleDialog(
  api: TuiPluginApi,
  config: () => StatuslineConfig,
  setConfig: (c: StatuslineConfig) => void,
) {
  const list = flattenWidgets(config())
  const options: TuiDialogSelectOption<{ line: number; col: number } | null>[] = list.map((it) => ({
    title: `${it.def.hide ? "[ ]" : "[x]"} ${WIDGET_LABELS[it.def.type] ?? it.def.type}${it.def.text ? ` "${it.def.text}"` : ""}`,
    value: { line: it.line, col: it.col },
    description: `第 ${it.line + 1} 行`,
  }))
  options.unshift({ title: "← 返回主菜单", value: null, description: "" })

  const DialogSelect = api.ui.DialogSelect
  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => (
    <DialogSelect
      title="切换组件显示"
      options={options}
      onSelect={(opt) => {
        if (!opt || opt.value === null) { showMainMenu(api, config, setConfig); return }
        const { line, col } = opt.value
        const next: StatuslineConfig = {
          lines: config().lines.map((l, li) =>
            l.map((w, ci) => (li === line && ci === col ? { ...w, hide: !w.hide } : { ...w }))
          ),
        }
        setConfig(next)
        api.kv.set(KV_KEY, next)
        setTimeout(() => showToggleDialog(api, config, setConfig), 0)
      }}
    />
  ))
}

// ─── Dialog: Edit Layout — Line picker ────────────────────────────────

function linePreview(line: WidgetDef[]): string {
  const shown = line.filter((w) => !w.hide)
  if (shown.length === 0) return "(无可见组件)"
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
  const options: TuiDialogSelectOption<number | null>[] = config().lines.map((line, li) => ({
    title: `第 ${li + 1} 行: ${linePreview(line)}`,
    value: li,
    description: `${line.filter((w) => !w.hide).length} 个可见 · ${line.length} 个组件`,
  }))
  options.push({ title: "← 返回主菜单", value: null, description: "" })

  const DialogSelect = api.ui.DialogSelect
  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => (
    <DialogSelect
      title="选择要编辑的行"
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
  const line = config().lines[lineIdx]
  const options: TuiDialogSelectOption<{ action: string; col?: number } | null>[] = line.map((w, ci) => ({
    title: `${w.hide ? "[ ] " : ""}${WIDGET_LABELS[w.type] ?? w.type}${w.text ? ` "${w.text}"` : ""}${w.color ? ` (${w.color})` : ""}`,
    value: { action: "select", col: ci },
    description: `位置 ${ci + 1}`,
  }))
  options.push({ title: "➕ 在此行末尾添加组件", value: { action: "append" }, description: "" })
  options.push({ title: "← 返回行选择", value: null, description: "" })

  const DialogSelect = api.ui.DialogSelect
  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => (
    <DialogSelect
      title={`第 ${lineIdx + 1} 行`}
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
  const widget = config().lines[lineIdx][col]
  const widgetLabel = WIDGET_LABELS[widget.type] ?? widget.type

  const options: TuiDialogSelectOption<string | null>[] = []

  if (col > 0) {
    const prevLabel = WIDGET_LABELS[config().lines[lineIdx][col - 1].type] ?? config().lines[lineIdx][col - 1].type
    options.push({ title: "◀ 左移", value: "left", description: `与「${prevLabel}」交换` })
  }
  if (col < config().lines[lineIdx].length - 1) {
    const nextLabel = WIDGET_LABELS[config().lines[lineIdx][col + 1].type] ?? config().lines[lineIdx][col + 1].type
    options.push({ title: "▶ 右移", value: "right", description: `与「${nextLabel}」交换` })
  }
  if (config().lines.length > 1) {
    options.push({ title: "⬇ 移到其他行", value: "move-line", description: "将组件移动到另一行" })
  }
  options.push({ title: widget.hide ? "👁 显示" : "👁 隐藏", value: "toggle", description: "" })
  options.push({ title: "🎨 更换颜色", value: "color", description: "" })
  options.push({ title: "✕ 删除", value: "delete", description: "" })
  options.push({ title: "← 返回", value: null, description: "返回组件列表" })

  const DialogSelect = api.ui.DialogSelect
  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => (
    <DialogSelect
      title={`${widgetLabel} 操作`}
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
  const options: TuiDialogSelectOption<number | null>[] = config().lines
    .map((line, li) => ({
      title: `第 ${li + 1} 行: ${linePreview(line)}`,
      value: li,
      description: `${line.length} 个组件`,
    }))
    .filter((o) => o.value !== srcIdx)
  options.push({ title: "← 返回", value: null, description: "" })

  const DialogSelect = api.ui.DialogSelect
  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => (
    <DialogSelect
      title="移动到哪一行？"
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

const COLOR_OPTIONS = [
  { label: "默认主题色", value: undefined },
  { label: "muted (柔和)", value: "muted" },
  { label: "accent (强调)", value: "accent" },
  { label: "success (成功绿)", value: "success" },
  { label: "warning (警告黄)", value: "warning" },
  { label: "error (错误红)", value: "error" },
  { label: "info (信息蓝)", value: "info" },
  { label: "cyan (青色)", value: "cyan" },
  { label: "清除自定义颜色", value: "" },
]

function showColorPicker(
  api: TuiPluginApi,
  config: () => StatuslineConfig,
  setConfig: (c: StatuslineConfig) => void,
  lineIdx: number,
  col: number,
) {
  const widget = config().lines[lineIdx][col]
  const options: TuiDialogSelectOption<string | undefined | null>[] = COLOR_OPTIONS.map((o) => ({
    title: `${widget.color === o.value ? "●" : "○"} ${o.label}`,
    value: o.value,
    description: o.value ? `color: "${o.value}"` : o.value === "" ? "恢复为无自定义颜色" : "使用组件默认颜色",
  }))
  options.push({ title: "← 返回", value: null, description: "" })

  const DialogSelect = api.ui.DialogSelect
  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => (
    <DialogSelect
      title="选择颜色"
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
  const options: TuiDialogSelectOption<WidgetType | null>[] = ALL_WIDGET_TYPES.map((t) => ({
    title: WIDGET_LABELS[t] ?? t,
    value: t,
    description: "",
  }))
  options.push({ title: "← 返回主菜单", value: null, description: "" })

  const DialogSelect = api.ui.DialogSelect
  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => (
    <DialogSelect
      title="添加组件 — 选择类型"
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
  const options: TuiDialogSelectOption<number | null>[] = config().lines.map((line, li) => ({
    title: `第 ${li + 1} 行: ${linePreview(line)}`,
    value: li,
    description: `${line.length} 个组件`,
  }))
  options.push({ title: "➕ 新建一行", value: -1, description: "在末尾新增一行" })
  options.push({ title: "← 返回", value: null, description: "重新选择类型" })

  const DialogSelect = api.ui.DialogSelect
  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => (
    <DialogSelect
      title="添加到哪一行？"
      options={options}
      onSelect={(opt) => {
        if (!opt || opt.value === null) { showAddWidgetTypePicker(api, config, setConfig); return }
        if (opt.value === -1) {
          const { lines } = cloneConfig(config())
          const widget: WidgetDef = { type: wtype }
          if (wtype === "text") widget.text = "Text"
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
  const line = config().lines[lineIdx]
  const total = line.length
  const options: TuiDialogSelectOption<number | null>[] = [
    { title: "最前面", value: 0, description: line.length > 0 ? `在「${WIDGET_LABELS[line[0].type] ?? line[0].type}」之前` : "" },
  ]
  for (let i = 0; i < total; i++) {
    const at = i + 1
    const label = WIDGET_LABELS[line[i].type] ?? line[i].type
    if (at < total) {
      const nextLabel = WIDGET_LABELS[line[at].type] ?? line[at].type
      options.push({ title: `第 ${label} 之后`, value: at, description: `在「${nextLabel}」之前` })
    } else {
      options.push({ title: `第 ${label} 之后`, value: at, description: "即末尾" })
    }
  }
  if (total === 0) {
    options.push({ title: "末尾（空行）", value: 0, description: "" })
  }
  options.push({ title: "← 返回", value: null, description: "重新选择行" })

  const DialogSelect = api.ui.DialogSelect
  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => (
    <DialogSelect
      title="插入到哪个位置？"
      options={options}
      onSelect={(opt) => {
        if (!opt || opt.value === null) { showAddWidgetLinePicker(api, config, setConfig, wtype); return }
        const { lines } = cloneConfig(config())
        const widget: WidgetDef = { type: wtype }
        if (wtype === "text") widget.text = "Text"
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
  const options: TuiDialogSelectOption<WidgetType | null>[] = ALL_WIDGET_TYPES.map((t) => ({
    title: WIDGET_LABELS[t] ?? t,
    value: t,
    description: "",
  }))
  options.push({ title: "← 返回", value: null, description: "" })

  const DialogSelect = api.ui.DialogSelect
  api.ui.dialog.setSize("medium")
  api.ui.dialog.replace(() => (
    <DialogSelect
      title="添加组件到末尾 — 选择类型"
      options={options}
      onSelect={(opt) => {
        if (!opt || opt.value === null) { showWidgetListForLine(api, config, setConfig, lineIdx); return }
        const { lines } = cloneConfig(config())
        const widget: WidgetDef = { type: opt.value }
        if (opt.value === "text") widget.text = "Text"
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
  setConfig(next)
  api.kv.set(KV_KEY, next)
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

    api.keymap.registerLayer({
      commands: [
        {
          name: "opencode-statusline.configure",
          title: "配置状态栏组件",
          category: "Plugin",
          namespace: "palette",
          slashName: "statusline",
          run() {
            showMainMenu(api, config, setConfig)
          },
        },
        {
          name: "opencode-statusline.global-install",
          title: "全局安装状态栏（跨所有 opencode 项目生效）",
          category: "Plugin",
          namespace: "palette",
          slashName: "statusline-global",
          async run() {
            await tryInstallGlobal(api)
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
