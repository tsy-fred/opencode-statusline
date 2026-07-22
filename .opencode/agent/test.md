---
description: Statusline TUI 插件测试代理。负责渲染验证、typecheck、配置检查。
mode: subagent
---

# opencode-statusline 测试

## Typecheck
```sh
cd .opencode && npx tsc --noEmit
```

## 渲染验证（script + pyte）
```sh
# 清除 KV（重置为默认配置）
python3 -c "import json, os; p=os.path.expanduser('~/.local/state/opencode/kv.json'); d=json.load(open(p)); d.pop('opencode-statusline.config',None); json.dump(d,open(p,'w'))"

# 启动 TUI 并截取渲染结果
script -q /tmp/oc-test.txt sh -c 'stty cols 200 rows 50; opencode -c' > /dev/null 2>&1 &
OPPID=$!
sleep 25
kill $OPPID 2>/dev/null; sleep 1; kill -9 $OPPID 2>/dev/null

# 渲染为文本（检查 46-50 行附近的状态栏）
python3 /tmp/render_tui.py /tmp/oc-test.txt | sed -n '46,50p'
```

## 验证 checklist
- [ ] `npx tsc --noEmit` 无报错
- [ ] 状态栏渲染行可见（48-50 行附近应有 model / tokens / cost / speed / duration 文本）
- [ ] 开启 `/statusline` 对话框，检查 widget 切换、布局编辑、配色方案等功能

## 日志检查
```sh
# 插件加载记录
python3 -c "import json, os; d=json.load(open(os.path.expanduser('~/.local/state/opencode/plugin-meta.json'))); print(d.get('opencode-statusline',{}).get('load_count','not found'))"
# KV 配置读取
python3 -c "import json, os; d=json.load(open(os.path.expanduser('~/.local/state/opencode/kv.json'))); print(d.get('opencode-statusline.config','(not set)'))"
```
