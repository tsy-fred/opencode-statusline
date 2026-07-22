# opencode-statusline

在 opencode TUI 侧栏底部显示会话状态信息的 TUI 插件。

模型参考：[sirmalloc/ccstatusline](https://github.com/sirmalloc/ccstatusline)（11.9k star 的 Claude Code 状态栏）

## 架构

- `.opencode/plugins/opencode-statusline.tsx` — 单文件 TUI 插件
- 文件首行必须带 `/** @jsxImportSource @opentui/solid */` pragma
- **默认导出** `{ id: "opencode-statusline", tui }`（loader 只读 default export，named exports 被忽略）
- 用 `@opencode-ai/plugin/tui` 的 `api.slots.register()` 注入 `sidebar_footer` slot
- 数据源：`api.event.on('message.updated', ...)` + `api.state.vcs?.branch` + `api.state.provider`
- 配置持久化：`api.kv`，优先级 `tui.json plugin options` > kv > 内置默认
- 配置 TUI：`/statusline` slash command → 多层 DialogSelect 面板（切换显示、编辑布局、添加组件、配色方案、配置方案、导出/导入）
- 配色：magic-context 风格——label 用 `theme.textMuted`，数值用 `theme.text`，模型/关键数值用 `theme.accent`，context 按使用率渐变色（accent → warning → error）；内置 4 套配色预设

## 关键契约（来自 opencode TUI 插件规范）

- TUI 插件**没有目录自动发现**，必须在 `tui.json` 的 `plugin` 数组显式列出
- slot renderer 签名：`(ctx: { theme }, props) => JSX.Element`（不是 `({ context }) =>`）
- `message.updated` / `session.updated` 事件载荷在 `event.properties.info`
- `AssistantMessage`：`tokens.{input,output,reasoning,cache.{read,write}}`、`cost: number`、`time.{created,completed}`、`modelID/providerID`
- context 上限：`api.state.provider` → `models[modelID].limit.context`
- `sidebar_footer` 渲染模式是 `single_winner`，与内置 `internal:sidebar-footer` 竞争
- JSX 元素是 `<box>` `<text>` `<span>`；布局属性是数字（终端格子），无 columnGap
- span 的 style 支持 `fg`, `bold`, `dim`, `bg`（类型需断言）

## Widget 数据流

```
message.updated      → properties.info (AssistantMessage) → tokens/cost/model/duration
message.part.updated → 5s 滚动窗口 chars/4 → 实时 speed
session.updated      → properties.info.cost → 累计费用
vcs.branch.updated   → git branch
api.state.provider   → 模型显示名 + context limit
api.kv               → 用户配置（显示哪些 widget、颜色等）
```

## 配置格式

优先级：`tui.json` plugin options > `api.kv`（key="opencode-statusline.config"）> 内置默认。

tui.json 配置示例：

```json
{
  "plugin": [["./.opencode/plugins/opencode-statusline.tsx", {
    "lines": [[
      { "type": "model", "color": "accent", "bold": true },
      { "type": "separator" },
      { "type": "tokens", "color": "default" }
    ], [
      { "type": "cost" },
      { "type": "separator" },
      { "type": "speed", "color": "muted" },
      { "type": "separator" },
      { "type": "git-branch", "color": "info" }
    ]]
  }]]
}
```

widget `color` 支持：theme 名（default/muted/accent/success/warning/error/info）、16 色名（cyan/brightBlack…）、xterm-256 色号（"203"）、hex（#RRGGBB）。

## 常用命令

| 命令 | 说明 |
|------|------|
| `/statusline` | 在 TUI 中交互式配置 statusline |
| `cd .opencode && npx tsc --noEmit` | typecheck 插件 |
| `opencode` | 在项目目录启动 TUI 测试插件（改配置后需重启） |

## Agents

- `.opencode/agent/dev.md` — 开发助手（编辑、typecheck、重写插件）
- `.opencode/agent/test.md` — 测试助手（渲染验证、配置检查）

## 依赖

`.opencode/package.json`：`@opencode-ai/plugin`、`solid-js`；devDeps `@opentui/core`、`@opentui/solid`、`@opencode-ai/sdk`、`typescript`（仅 typecheck 用）。
