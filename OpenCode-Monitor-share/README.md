# OpenCode Monitor + Zed 配置分享包

## 内容

- `OpenCode Monitor_0.1.0_x64-setup.exe` — Monitor 安装器(Windows x64),双击安装
- `zed-config/` — Zed 编辑器全局配置

## 安装 Monitor

双击 `OpenCode Monitor_0.1.0_x64-setup.exe`,默认选项即可。
安装后开始菜单出现 "OpenCode Monitor"。

## 安装 Zed 配置

1. 安装 Zed:https://zed.dev
2. 安装 opencode CLI(用于 ACP 集成):
   ```
   npm install -g opencode
   ```
   确认 `opencode.cmd` 的路径(通常在 `C:\Users\<你>\AppData\Roaming\npm\opencode.cmd`)

3. 找到 opencode 可执行路径:
   ```powershell
   (Get-Command opencode).Source
   ```

4. 把 `zed-config/` 里的文件复制到你的 Zed 配置目录:
   - Windows: `%APPDATA%\Zed\` 即 `C:\Users\<你>\AppData\Roaming\Zed\`

5. **必须修改的路径**(因为是分享配置,里面有原用户的绝对路径):

   **`settings.json`** — `agent_servers.OpenCode.command`:
   ```json
   "command": "C:/Users/<你的用户名>/AppData/Roaming/npm/opencode.cmd"
   ```
   注意路径用正斜杠 `/`,不是反斜杠。

   **`tasks.json`** — `command`:
   ```json
   "command": "<你安装 Monitor 的路径>\\opencode-monitor.exe"
   ```
   默认安装路径:`C:\Program Files\OpenCode Monitor\opencode-monitor.exe`
   或自定义位置都可。

6. 启动 Zed,按 `Ctrl+Shift+M` 应该会启动 Monitor。

## 关于 LLM 配置

`settings.json` 里 `language_models.openai_compatible.MOMO` 是原用户的私有 API。
你需要:
- 改成自己的 OpenAI 兼容 API 提供商,或
- 直接删除整个 `language_models` 块(用 Zed 内置的模型配置),
- 同时在 opencode 端配置你自己的认证(`~/.config/opencode/auth.json`)

## 快捷键

- `Ctrl+Shift+M` — 启动 OpenCode Monitor

## 字体/主题

`settings.json` 使用 Ayu Dark 主题,Zed 默认自带。字体大小可按需调整。
