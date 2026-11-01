# Security policy

Claude Code Account Center is an unofficial local launcher. It is not an Anthropic product. This file describes the boundaries of version 0.1.0 as they exist in this repository. It is not a promise about Claude.ai, account enforcement, or network anonymity.

[中文在后文。](#中文)

## Threat model

**What the launcher stores and starts**

- Account labels, an optional expected email, project paths, and the last project id, in a private directory under the home folder, or under `CCAC_STATE_DIR` when that variable is set.
- One private configuration directory per account. The official CLI may later write its own files there after you log in. This launcher does not inventory or upload those files.
- A Terminal window that runs the official `claude` binary for login or for a project session.

**What a report should treat as in scope**

- The launcher reading, copying, logging, or sending a Claude.ai token, session, or official credential file.
- One account's configuration directory being reused for a different account.
- A project path, account label, or CLI path changing which program runs, or changing the command beyond the official `auth login`, the official authentication-status check, or a project launch with no extra arguments.
- The launcher rewriting the shell profile, the Mac-wide Claude configuration, system DNS, TUN, or proxy settings.
- A public error or the SwiftUI window echoing secrets, raw CLI output, or the contents of an authentication response.
- Storage that follows a symlink, or storage that other local users can read, being accepted.
- The build script presenting an ad-hoc signature as a Developer ID signature or as notarization.

**Out of scope for this project**

- Anthropic account security, billing, and official-client bugs. Report those to Anthropic.
- Malware already running as your user. That process can read your home folder, including any official credential files the CLI has written.
- A replaced `claude` or `node` binary. Discovery checks that the path is an executable file. It does not check a publisher signature.
- Account limits, blocks, or platform enforcement. This project does not claim to influence them.
- Hiding your address from networks, DNS resolvers, or websites. The user-initiated observations in [guide.html](guide.html) reveal the addresses needed for those individual checks; they do not provide anonymity.

**What version 0.1.0 does**

- Login runs the official CLI as `auth login` inside the selected account's configuration directory. No extra login flags are added. Login output is not captured.
- A project launch first asks the official CLI for authentication status. The account is ready only for a logged-in `claude.ai` session. A configuration directory included in that status must match this account. An email included in that status must match the stored expected email when one was stored. The documented status response is parsed in memory; only a small allowlist reaches the caller, and the raw JSON is not persisted or included in public errors.
- The launched process gets `CLAUDE_CONFIG_DIR` for that account. Other `ANTHROPIC_*` and `CLAUDE_*` variables, and a short list of dynamic-loader and Node injection variables, are removed from that process only. The system network configuration is not edited. Proxy variables already in the environment are left in place.
- Terminal is opened with a fixed AppleScript. The account and project values travel in one quoted command argument. Success means Terminal accepted the script. It does not mean the official login succeeded.
- Quota configuration is explicit and per account. It preserves other settings and refuses to overwrite a different existing `statusLine` command. The status-line payload is reduced to a small allowlist before a snapshot is stored.
- Network commands use fixed argument arrays without a shell, with deadlines and output limits. The WebRTC page requires a separate user click in the browser and does not write its result back to the launcher.
- Local metadata is written in the same directory, with owner-only permissions, after a private-file check. Public errors use fixed sentences.

**Residual risk**

The ad-hoc signature only detects some accidental changes to the bundle you just built. Anyone who can rewrite that bundle can replace it. The official CLI, once you start it, talks to Anthropic under Anthropic's own policy: <https://code.claude.com/docs/en/data-usage>.

## Reporting a vulnerability

Use GitHub private vulnerability reporting when it is enabled:

<https://github.com/xiaohe-sz/claude-code-account-center/security/advisories/new>

GitHub's own steps: <https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability>

These documents do not claim that private reporting is already turned on for the repository. If that page is unavailable, open a public GitHub Issue. In an Issue, describe the bug and the version. Do not attach a token, session file, credential file, status-line JSON, authentication JSON, raw log, or a personal home-directory path. Quote an error code if you have one.

Please allow time for a maintainer to read the report before discussing it in public.

## If a credential is exposed

1. Stop copying the material into issues, chats, or screenshots.
2. Sign out or revoke it on the official account side. The official CLI command is `claude auth logout`, and it applies to the configuration directory in `CLAUDE_CONFIG_DIR`. Official reference: <https://code.claude.com/docs/en/cli-reference>. This launcher cannot revoke a cloud session for you.
3. If the exposed file was inside an account directory created by this launcher, quit the app before you remove that local directory. Removing it deletes the local isolated copy. It does not recall a copy that already left the machine.
4. If the secret was posted on GitHub, remove that post as well. Treat the secret as compromised anyway.
5. Do not send the secret to the maintainer to prove the incident.

## 中文

# 安全说明

Claude Code Account Center 是非官方的本机启动器，不是 Anthropic 的产品。这份文件描述的是本仓库 0.1.0 版已经做到的边界。它不承诺 Claude.ai 的账号处理结果，也不承诺网络匿名。

## 威胁模型

**启动器保存和启动的东西**

- 账号标签、可选的预期邮箱、项目路径、上次项目编号。位置在当前用户家目录下的私有文件夹；如果设置了 `CCAC_STATE_DIR`，就用那个目录。
- 每个账号一个私有配置目录。你用官方 CLI 登录之后，官方 CLI 可能往里面写入它自己的文件。本启动器不清点、也不上传这些文件。
- 一个 Terminal 窗口，用来运行官方 `claude` 程序做登录或项目会话。

**适合在本项目报告的问题**

- 启动器读取、复制、记录或发送了 Claude.ai 令牌、会话或官方凭据文件。
- 一个账号的配置目录被另一个账号拿去用。
- 项目路径、账号标签或 CLI 路径让实际运行的程序变了，或者让命令超出这三种：官方 `auth login`、官方认证状态检查、不带额外参数的项目开工。
- 启动器改写了 shell 配置文件、整台 Mac 的 Claude 配置、系统 DNS、TUN 或代理。
- 公开错误信息或 SwiftUI 窗口回显了秘密、CLI 原始输出，或认证响应的内容。
- 启动器接受了符号链接存储，或接受了其他本机用户也能读的存储。
- 构建脚本把 ad-hoc 签名说成 Developer ID 签名或公证。

**不属于本项目**

- Anthropic 账号安全、账单和官方客户端自身的缺陷。请向 Anthropic 报告。
- 已经以你的用户身份运行的恶意程序。它可以直接读你的家目录，包括官方 CLI 写下的凭据文件。
- 被掉包的 `claude` 或 `node`。本项目只检查路径是不是可执行文件，不检查发布者签名。
- 账号限额、限制或平台处理。本项目不声称能影响这些事。
- 对网络、DNS 解析器或网站隐藏地址。你主动运行[使用指南](guide.html)里的观察时，会把完成各次检查所需的地址暴露给应答方；这些检查不提供匿名。

**0.1.0 实际做的事**

- 登录在所选账号的配置目录里运行官方 CLI 的 `auth login`，不加额外登录参数。登录输出不会被抓取。
- 项目开工前先向官方 CLI 查询认证状态。只有已登录的 `claude.ai` 会话才算准备好。状态里如果带了配置目录，必须和这个账号一致。状态里如果带了邮箱，而且本地存过预期邮箱，两者必须一致。官方文档规定的状态响应只在本机内存解析；调用方只收到一小份允许字段，原始 JSON 不落盘，也不进入公开错误信息。
- 被启动的进程会得到这个账号的 `CLAUDE_CONFIG_DIR`。这个进程里的其他 `ANTHROPIC_*`、`CLAUDE_*`，以及一小列动态链接器和 Node 注入变量，会被去掉。系统网络配置不会被修改。环境里原来就有的代理变量会留下来。
- Terminal 用一段固定的 AppleScript 打开。账号和项目的值放在单独的、已加引号的命令参数里。成功只表示 Terminal 接受了这段脚本，不表示官方登录已经成功。
- 额度配置由你明确点击，并按账号分别处理。它保留其他设置，也不会覆盖已有的其他 `statusLine` 命令。状态栏数据只保留一小份允许字段后才保存快照。
- 网络命令使用固定参数数组，不经过 shell，并有超时和输出上限。WebRTC 页需要你在浏览器里再次点击，结果不会写回启动器。
- 本地元数据写在同一目录，先做私有文件检查，并用仅所有者可读写的权限保存。公开错误使用固定句子。

**仍然存在的风险**

ad-hoc 签名只能帮助发现你刚构建出来的应用包被改过一部分。能改写这个应用包的人可以换掉它。官方 CLI 一旦启动，会按 Anthropic 自己的政策与 Anthropic 通信：<https://code.claude.com/docs/en/data-usage>。

## 如何报告漏洞

私人漏洞报告已启用时，使用 GitHub Security Advisory（安全公告，一种不公开贴出细节的报告入口）：

<https://github.com/xiaohe-sz/claude-code-account-center/security/advisories/new>

GitHub 官方步骤：<https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability>

这套文档不声称该仓库已经打开了私人报告。如果那个页面不可用，就开一条公开 Issue。Issue 里写清缺陷和版本。不要附上令牌、会话文件、凭据文件、status line JSON、认证 JSON、原始日志或个人家目录路径。可以引用错误代码。

请给维护者阅读报告的时间，再公开讨论细节。

## 凭据已经暴露时

1. 停止把材料复制到 Issue、聊天或截图里。
2. 在官方账号一侧退出或吊销。官方 CLI 的命令是 `claude auth logout`，它作用于 `CLAUDE_CONFIG_DIR` 指向的配置目录。官方说明：<https://code.claude.com/docs/en/cli-reference>。本启动器不能替你吊销云端会话。
3. 如果暴露的文件在本启动器建立的账号目录里，先退出应用，再删除那个本机目录。删除的是本机这份隔离副本，收不回已经离开这台机器的副本。
4. 如果秘密已经发到 GitHub，把那条内容也删掉。即使删了，也要把这个秘密视为已经失效。
5. 不要把秘密发给维护者当作证据。
