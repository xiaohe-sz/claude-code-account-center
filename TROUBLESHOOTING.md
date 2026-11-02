# Troubleshooting

These notes match version 0.2.0 of this repository. Examples use placeholders such as `person@example.com` and `~/Projects/demo`.

[中文在后文。](#中文)

Official CLI install and login: <https://code.claude.com/docs/en/quickstart> and <https://code.claude.com/docs/en/authentication>.

## Node.js was not found

The window can say: `未找到 Node.js 20 或更新版本。可通过 CCAC_NODE_PATH 指定完整路径。`

A graphical app often does not load the PATH from a shell profile, so a Node.js installed only through a version manager can be invisible. Install Node.js 20 or newer from <https://nodejs.org/>, or point `CCAC_NODE_PATH` at that `node` binary by its absolute path. The app also looks on `PATH` and in a few common locations, including `/opt/homebrew/bin/node`.

Check the binary you intend to use:

```sh
node --version
```

The major version must be 20 or greater. `npm test` uses the `node` that runs npm.

## The official CLI was not found

Install Claude Code with Anthropic's instructions, then open a new terminal and run:

```sh
claude --version
```

The launcher looks at an explicit path first, then `CLAUDE_CODE_CLI`, then `PATH`, then common locations such as `~/.local/bin/claude` and `/opt/homebrew/bin/claude`. A missing or non-executable explicit path is not replaced by a later guess. Set `CLAUDE_CODE_CLI` to the absolute path if the GUI cannot see the shell PATH.

This search does not prove the file is Anthropic's signed build. Install it from the official instructions.

## Terminal automation permission

Login and launch need permission to control Terminal. The first time, macOS may show the reason stored in the app: open the official Claude Code CLI in Terminal for the selected local account and project.

The app waits up to two minutes for you to answer that macOS prompt. If the wait runs out, answer the prompt and click the button again.

If opening Terminal fails, the core reports `TERMINAL_OPEN_FAILED` and asks you to check the automation permission. In System Settings, look under Privacy & Security, then Automation, and allow this app to control Terminal. Quit and reopen the app after changing that permission.

A successful open only means Terminal accepted the script. Finish login in the official CLI. The launcher does not watch that login.

## Login refused: the claude command ignores the account folder

`CLI_IGNORES_CONFIG_DIR` means the `claude` the app found reported a different configuration directory than the account's own. This happens when `claude` is a wrapper script that removes `CLAUDE_CONFIG_DIR`. Logging in through it would sign in the whole Mac instead of one account, so the app stops. Set `CLAUDE_CODE_CLI` to the official binary itself (for example the `claude` or `claude.exe` inside the official installation), then reopen the app. A Finder-launched app reads it with `launchctl setenv CLAUDE_CODE_CLI /absolute/path` or `open --env CLAUDE_CODE_CLI=/absolute/path`.

## Global switch did not happen

- `GLOBAL_NOT_MANAGED`: the current global login is not one of your accounts, so after switching away nothing could switch it back. Click **Import current global login**, or add an account and log in with that email, then switch.
- `TARGET_NOT_SIGNED_IN`: finish the official login for the selected account first.
- `TARGET_IN_USE`, `HOME_IN_USE`: a session this app opened for one of the two accounts is still running. Close it first; two processes renewing one login invalidate each other.
- `GLOBAL_REFRESHING`, `GLOBAL_CHANGED`, `SWITCH_BUSY`: the global login was renewing or changing at that moment. Wait a minute and retry.
- `SWITCH_ROLLED_BACK`: the official status or the test request with the new account failed, and the previous global login was restored. Check the network and that the selected account's login still works (open it in its own window), then retry.
- `SWITCH_ROLLBACK_FAILED`: the restore also failed. Run `claude` in a normal Terminal and use `/login` to sign in again, or switch global back to the previous account in the app.
- `ACCOUNT_IS_GLOBAL`: the account is currently the global copy. Use an ordinary Claude window, or switch global to another account before opening it on its own or deleting it.

## Not logged in

A project launch asks the official CLI for authentication status in that account's configuration directory. The account is not ready when the status is logged out (`NOT_LOGGED_IN`), when the method is not `claude.ai` (`UNSUPPORTED_AUTH_METHOD`), when the provider is not accepted (`UNSUPPORTED_PROVIDER`), when both emails are present and they differ (`EMAIL_MISMATCH`), or when a reported configuration directory differs (`CONFIG_DIRECTORY_MISMATCH`). A status that omits the email, or omits the configuration directory, does not raise those two codes by itself. The launch then stops with `AUTH_NOT_READY` and does not replace the last project.

Run the official login in that account's own directory and finish it in the browser. The launcher's login command is `auth login` with no extra login flags. An API key or another provider left in the environment is not used as a substitute: those variables are removed from the launched process.

The 0.2.0 window includes buttons for official login and for checking the official status. A dispatched login still has to be finished in Terminal and the official website.

## Quota stays unknown

Unknown means no usable current snapshot is stored. It does not mean the allowance is zero, and it is not a live balance from an API.

First click `启用官方状态栏快照` for the account, then use the official Claude Code session. Official status-line data, including rate-limit fields, appears only in the situations Anthropic documents: <https://code.claude.com/docs/en/statusline>. Each window can be absent independently, and a window whose reset time has passed is shown as unknown again. This app does not call a usage API or invent a refresh.

## statusLine conflict

`statusLine` in an account's official settings is the official client's own command. The launcher's explicit configuration action installs its own command while preserving other settings. If a different `statusLine` command already exists, configuration stops with `STATUSLINE_CONFLICT` and leaves the file unchanged. Running `/statusline` inside an official session edits the official settings in the configuration directory you are using. Leave an existing `statusLine` as it is if you still want it.

A command previously generated by this launcher and recorded in its private state can be migrated after the app or Node path changes. An unrecorded lookalike remains a conflict. If the settings file changes during configuration, `SETTINGS_CHANGED` stops the write so the newer content is preserved; review that external change and retry. Without a lock shared with the official CLI, this check cannot prevent every possible concurrent write.

Do not paste status-line JSON into an issue. It can contain a session id and a transcript path.

## Network result stays unverified

`unverified` means that observation was not made, timed out, was unavailable, or did not return enough recognizable data. That is not a `pass`. Click `开始只读检查` to run the three command-line observations. The browser WebRTC layer intentionally remains `unverified` in the app because a CLI check cannot prove what a browser does.

The manual WebRTC page must be opened and started by you. Opening [guide.html](guide.html) does not contact a STUN server. A result in a browser tab is not written into launcher state. See [Privacy](PRIVACY.md).

This app does not edit system DNS, TUN, or proxy settings. A single observation does not describe every other lookup or program.

## The build is unsigned in the Developer ID sense

`npm run build` on macOS Apple Silicon produces `dist/Claude Code Account Center.app` and applies a local ad-hoc signature. It does not use a Developer ID certificate, and it does not submit the app for notarization.

The build stops with `This build requires macOS on Apple Silicon.` on other machines. If `swiftc` is missing, install Apple's command-line developer tools and run the build again:

```sh
xcode-select --install
```

macOS can warn when you open an ad-hoc build. This repository does not document turning off Gatekeeper. Apple describes the warning here: <https://support.apple.com/en-us/102445>. Prefer the copy you just built from this source over a bundle sent by someone else.

Other window messages:

- `应用资源不完整，请重新构建。` Run `npm run build` again from a clean source tree.
- `暂时无法读取本地数据，请检查存储目录权限与数据格式。` The support folder must belong to you, must not be a symlink, and must not be readable by other users. Do not loosen those permissions.
- `无法运行本地数据组件，请检查 Node.js 安装与应用构建。` Check Node.js and rebuild.

## 中文

# 故障排查

这些说明对应该仓库的 0.2.0。例子只用占位符，例如 `person@example.com` 和 `~/Projects/demo`。

官方 CLI 的安装和登录：<https://code.claude.com/docs/en/quickstart> 与 <https://code.claude.com/docs/en/authentication>。

## 找不到 Node.js

窗口可能显示：`未找到 Node.js 20 或更新版本。可通过 CCAC_NODE_PATH 指定完整路径。`

图形应用常常不会加载 shell 配置文件里的 PATH，所以只装在版本管理器里的 Node.js 可能看不见。请从 <https://nodejs.org/> 安装 20 或更新版本，或把 `CCAC_NODE_PATH` 设成那个 `node` 程序的绝对路径。应用也会在 `PATH` 和少数常见位置里找，其中包括 `/opt/homebrew/bin/node`。

先确认你要用的程序：

```sh
node --version
```

主版本号必须大于或等于 20。`npm test` 使用的是运行 npm 的那个 `node`。

## 找不到官方 CLI

按 Anthropic 的说明安装 Claude Code，然后新开一个终端运行：

```sh
claude --version
```

启动器先看明确指定的路径，再看 `CLAUDE_CODE_CLI`，再看 `PATH`，然后才看常见位置，例如 `~/.local/bin/claude` 和 `/opt/homebrew/bin/claude`。明确指定的路径不存在或不能执行时，不会再猜下一个。图形界面看不到 shell 的 PATH 时，把 `CLAUDE_CODE_CLI` 设成绝对路径。

这次查找不能证明文件就是 Anthropic 签名过的构建。请按官方说明安装。

## Terminal 自动化权限

登录和开工需要控制 Terminal 的权限。第一次时，macOS 可能显示应用里写好的理由：为所选的本地账号和项目，在 Terminal 中打开官方 Claude Code CLI。

应用会等你回应这个 macOS 提示最多两分钟。超时了就先处理提示，再点一次按钮。

如果打不开 Terminal，核心会给出 `TERMINAL_OPEN_FAILED`，并提示检查自动化权限。打开系统设置，进入隐私与安全性，再进入自动化，允许这个应用控制 Terminal。改完权限后退出并重新打开应用。

打开成功只表示 Terminal 接受了脚本。请在官方 CLI 里完成登录。启动器不监视这次登录。

## 登录被拒绝：claude 命令不认账号目录

`CLI_IGNORES_CONFIG_DIR` 表示应用找到的 `claude` 报出的配置目录不是这个账号自己的目录。通常是因为 `claude` 是一个会删掉 `CLAUDE_CONFIG_DIR` 的包装脚本。通过它登录会改掉整台 Mac 的登录，而不是只登这一个账号，所以应用停下了。把 `CLAUDE_CODE_CLI` 设成官方程序本身（例如官方安装目录里的 `claude` 或 `claude.exe`），再重新打开应用。从访达打开的应用可以用 `launchctl setenv CLAUDE_CODE_CLI /绝对路径`，或者 `open --env CLAUDE_CODE_CLI=/绝对路径` 读到它。

## 全局没有切换成功

- `GLOBAL_NOT_MANAGED`：现在的全局登录不在账号列表里，切走后就没有办法切回来。先点「导入当前全局登录」，或者添加账号后用那个邮箱登录，再切换。
- `TARGET_NOT_SIGNED_IN`：先给选中的账号完成官方登录。
- `TARGET_IN_USE`、`HOME_IN_USE`：本应用为这两个账号之一打开的会话还在运行。先关掉；同一份登录被两个进程续期会互相作废。
- `GLOBAL_REFRESHING`、`GLOBAL_CHANGED`、`SWITCH_BUSY`：那一刻全局登录正在续期或变化。等一分钟再试。
- `SWITCH_ROLLED_BACK`：官方状态或新账号的测试请求没通过，已经恢复原来的全局登录。检查网络，并确认选中账号的登录还有效（单独开它的窗口试一下），再重试。
- `SWITCH_ROLLBACK_FAILED`：恢复也失败了。在普通终端运行 `claude`，用 `/login` 重新登录；或者在应用里把全局切回原来的账号。
- `ACCOUNT_IS_GLOBAL`：这个账号现在就是全局副本。直接用普通 Claude 窗口；要单独打开或删除它，先把全局切到别的账号。

## 还没有登录

项目开工会在该账号的配置目录里向官方 CLI 查询认证状态。下面这些情况都还没准备好：已登出（`NOT_LOGGED_IN`）、方式不是 `claude.ai`（`UNSUPPORTED_AUTH_METHOD`）、提供方不被接受（`UNSUPPORTED_PROVIDER`）、两边都有邮箱但不一致（`EMAIL_MISMATCH`）、状态报出的配置目录不一致（`CONFIG_DIRECTORY_MISMATCH`）。状态里没有邮箱，或没有配置目录时，不会单凭这一点产生后两个代码。开工会以 `AUTH_NOT_READY` 停止，并且不会替换上次项目。

请在这个账号自己的目录里运行官方登录，并在浏览器里完成。启动器的登录命令是 `auth login`，没有额外登录参数。留在环境里的 API 密钥或其他提供方不会被拿来顶替：这些变量会从被启动的进程中去掉。

0.2.0 的窗口有官方登录和检查状态按钮。派发之后，仍要在 Terminal 和官方网页里完成登录。

## 额度一直是未知

未知表示没有存下一份当前可用的快照。它不表示额度为 0，也不是接口返回的当时余额。

先为这个账号点击「启用官方状态栏快照」，再使用官方 Claude Code 会话。官方 status line 数据（包括限额字段）只在 Anthropic 文档写明的情况下出现：<https://code.claude.com/docs/en/statusline>。两个窗口可以各自缺失；重置时间已过的窗口会重新显示未知。本应用不调用额度接口，也不伪造刷新。

## statusLine 冲突

账号官方设置里的 `statusLine`，是官方客户端自己的命令。你明确点击配置时，启动器会安装自己的命令并保留其他设置。如果已经有另一条 `statusLine` 命令，配置会以 `STATUSLINE_CONFLICT` 停止，原文件不变。在官方会话里运行 `/statusline`，改的是你正在使用的那个配置目录里的官方设置。如果你还需要已有的 `statusLine`，就让它保持原样。

应用或 Node 路径变化后，启动器只能迁移它以前生成并记录在私有状态里的命令；没有记录的外部近似命令仍然是冲突。配置期间如果设置文件被别的程序改动，会以 `SETTINGS_CHANGED` 停止写入，保留较新的内容；先查看外部改动再重试。由于没有与官方 CLI 共用的锁，这项检查不能防止所有可能的并发写入。

不要把 status line 的 JSON 贴进 Issue。里面可能有会话编号和会话记录路径。

## 网络结果一直是未验证

`unverified` 表示这项观察没有做、超时、不可用，或没有返回足够的可识别数据。这不是 `pass`。点击「开始只读检查」才会运行三项命令行观察。浏览器 WebRTC 一层在应用里有意保持 `unverified`，因为命令行检查不能证明浏览器的行为。

WebRTC 手动页要由你自己打开并点击开始。打开 [guide.html](guide.html) 不会联系 STUN 服务器。浏览器标签里的结果不会写入启动器状态。见[隐私](PRIVACY.md)。

本应用不修改系统 DNS、TUN 或代理。单次观察不能描述其他每一次查询或其他程序。

## 构建没有 Developer ID 签名

在 Apple Silicon 的 macOS 上，`npm run build` 会生成 `dist/Claude Code Account Center.app`，并做本机 ad-hoc 签名。它不使用 Developer ID 证书，也不把应用提交公证。

在其他机器上，构建会停止并提示 `This build requires macOS on Apple Silicon.`。如果没有 `swiftc`，先安装 Apple 的命令行开发工具，再重新构建：

```sh
xcode-select --install
```

打开 ad-hoc 构建时，macOS 可能会报警。本仓库不写关闭 Gatekeeper 的做法。Apple 对这类警告的说明在这里：<https://support.apple.com/en-us/102445>。请优先使用你刚从这份源码构建出来的副本，而不是别人传来的应用包。

窗口上的其他句子：

- `应用资源不完整，请重新构建。` 在干净的源码目录里重新运行 `npm run build`。
- `暂时无法读取本地数据，请检查存储目录权限与数据格式。` 支持文件夹必须属于你，不能是符号链接，也不能让其他用户读取。不要放宽这些权限。
- `无法运行本地数据组件，请检查 Node.js 安装与应用构建。` 检查 Node.js，然后重新构建。
