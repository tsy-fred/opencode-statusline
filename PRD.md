# PRD: opencode-statusline

一个开源的 opencode TUI 插件，在侧栏底部显示实时会话状态信息。

## 背景

opencode 缺少类似 [Claude Code statusline](https://github.com/kcchien/claude-code-statusline) 的常驻状态显示。已有插件（opencode-throughput、opencode-token-tracker）使用 toast 或侧栏面板，都不是常驻的输入框上方/侧栏底部状态栏。

参考 [ccstatusline](https://github.com/sirmalloc/ccstatusline)（11.9k star）的 widget 配置模型和颜色自定义系统。

## 目标指标

| 指标 | 类型 | 数据来源 |
|------|------|---------|
| 模型名 | `model` | `api.state.config` |
| Token 使用量 | `tokens` | `message.updated` → `message.tokens` |
| 生成速度 | `speed` | `message.part.updated` 时间差 |
| 累计费用 | `cost` | `message.updated` → `message.cost` |
| Context 使用率 | `context-pct` | `message.updated` 上下文数据 |
| Context 进度条 | `context-bar` | 同上，渐变绿色→黄色→红色 |
| Git 分支 | `git-branch` | `api.state.vcs.branch` |
| 会话耗时 | `duration` | `AssistantMessage.time` |
| 自定义文字 | `text` | 用户配置 |
| 分隔符 | `separator` | 固定 |

## 可配置项

通过 `api.kv` 存储（key=`statuslineConfig`）：

- `lines`: widget 列表（多行、每行多个 widget），每个 widget 可设置：
  - `type`: widget 类型
  - `color`: 前景色（16色名 / 256色代码 / hex #RRGGBB）
  - `bold`: 是否加粗（boolean）
  - `dim`: 是否暗淡（boolean）
  - `hide`: 是否隐藏（boolean）
- 全局：`colorLevel` (0-3)

## 非目标

- 不做独立 CLI 工具（ccstatusline 那种模式）
- 不做 Powerline 分隔符（opencode TUI 内 SolidJS 渲染，非 ANSI）
- 不做交互式配置 TUI（初期通过 `api.kv` 直接配置）

## 实施计划

1. ✅ 项目结构搭建（AGENTS.md、opencode.json、PRD.md）
2. ✅ 插件骨架：TUI slot 注册 + 初始渲染
3. ✅ 数据收集：`message.updated` 事件订阅 + `api.state.session.messages` 回填历史
4. ✅ Widget 系统：每种 type 的渲染逻辑（含 context-bar、智能 separator）
5. ✅ 配置系统：`api.kv` 读写 + `tui.json` plugin options 覆盖
6. ✅ 测试与调优（script + pyte 截屏验证，200x50 终端）
