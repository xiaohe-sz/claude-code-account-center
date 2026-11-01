# Privacy

Claude Code Account Center is an unofficial local tool. Version 0.1.0 keeps launcher metadata on this Mac. It does not add its own analytics, and it does not send launcher metadata to the author.

[中文在后文。](#中文)

The official CLI is a separate program. After you start it, its network use is covered by Anthropic's documents, not by this file:

- <https://code.claude.com/docs/en/data-usage>
- <https://privacy.claude.com/>

## Local state

Unless `CCAC_STATE_DIR` is set to another absolute path, metadata is stored at:

```text
~/Library/Application Support/ClaudeCodeAccountCenter
```

`state.json` contains:

- `version` and `revision`
- accounts: `id`, `label`, `expectedEmail` (or null), `lastProjectId` (or null)
- projects: `id`, `label`, `path`

Each account also has a directory:

```text
accounts/<account-id>/config
```

That directory is the `CLAUDE_CONFIG_DIR` for processes this launcher starts. The launcher creates the directory. It does not put a token in it. If you later complete an official login, the official CLI may write its own files there. Those files stay on this Mac unless you or the official CLI move them. This launcher does not read them to copy a session, and it does not upload them.

A status check runs the documented official `auth status --json` command and parses its response in memory. Only the allowlisted authentication fields reach the window. The raw response is not written to launcher storage or included in public errors. This status-output parsing is distinct from reading official credential files, which the launcher does not do.

The window can show the metadata above, including the configuration path, because that is the local snapshot. Do not publish that view.

There is no telemetry endpoint in this repository.

## Status line snapshot: minimum fields

A quota figure in this project is only a recent local snapshot of what the official status line already contained. It is not a request to a usage API. Official field names are documented by Anthropic: <https://code.claude.com/docs/en/statusline>.

A stored snapshot under `usage/<account-id>.json` is limited to a schema/status marker, a short fixed reason, and:

| Field | Meaning |
| --- | --- |
| `observedAt` | Time when the snapshot was taken |
| `windows.fiveHour.usedPercentage` | `rate_limits.five_hour.used_percentage` if present and valid |
| `windows.fiveHour.resetsAt` | `rate_limits.five_hour.resets_at` if present and valid |
| `windows.sevenDay.usedPercentage` | `rate_limits.seven_day.used_percentage` if present and valid |
| `windows.sevenDay.resetsAt` | `rate_limits.seven_day.resets_at` if present and valid |

A stored snapshot must not include `session_id`, `transcript_path`, workspace paths, cost, email, tokens, or the raw status-line JSON. Absent or expired windows stay unknown. They are not filled from another service.

The launcher configures its status-line command only after you click the configuration button. It preserves other settings and refuses to overwrite a different existing `statusLine` command.

## Network observations

No network observation runs until you click the check button. Each one shows the answering service what that check needs:

- A public-IP request reveals the source address of that request to the service that answers it. The exit layer displays that observed address in the window for comparison with the browser page; redact it in public screenshots.
- One DNS observation reveals the looked-up name to the resolver that receives that one query. It does not describe every later lookup.
- A STUN request reveals the address required to answer it to that STUN service.
- The browser WebRTC page runs only after you open it and click its own start button. Its result is not written into `state.json`, the account directory, or any other launcher file. Closing the page drops the page's own result. The general guide does not embed that probe.

These checks do not change system DNS, TUN, or proxy settings. One finished check is not a statement that every program on the Mac behaves the same way.

## 中文

# 隐私

Claude Code Account Center 是非官方的本机工具。0.1.0 把启动器自己的元数据留在这台 Mac 上。它不加自己的统计，也不把这些元数据发给作者。

官方 CLI 是另一个程序。你启动它之后，网络使用以 Anthropic 的文档为准，不以这份文件为准：

- <https://code.claude.com/docs/en/data-usage>
- <https://privacy.claude.com/>

## 本地状态

没有把 `CCAC_STATE_DIR` 设成其他绝对路径时，元数据在：

```text
~/Library/Application Support/ClaudeCodeAccountCenter
```

`state.json` 里有：

- `version` 和 `revision`
- 账号：`id`、`label`、`expectedEmail`（或 null）、`lastProjectId`（或 null）
- 项目：`id`、`label`、`path`

每个账号还有一个目录：

```text
accounts/<账号 id>/config
```

这个目录就是启动器启动的进程所用的 `CLAUDE_CONFIG_DIR`。目录由启动器创建。启动器不往里面放令牌。你之后如果完成官方登录，官方 CLI 可能往里面写入它自己的文件。这些文件留在这台 Mac 上，除非你或官方 CLI 把它们移走。启动器不会为了复制会话去读它们，也不会上传它们。

状态检查会运行官方文档规定的 `auth status --json`，并在本机内存解析响应。窗口只收到允许列出的认证状态字段。原始响应不会写进启动器存储，也不会进入公开错误信息。解析这个状态响应不等于读取官方凭据文件；启动器不读取那些凭据文件。

窗口可以显示上面的元数据，包括配置目录路径，因为那就是本地快照。不要把这个窗口公开出去。

本仓库没有统计上报地址。

## status line 快照：最小字段

本项目里的额度数字，只表示官方 status line 已经包含过的内容的最近一份本地快照。它不是向额度接口发出的请求。官方字段名以 Anthropic 的文档为准：<https://code.claude.com/docs/en/statusline>。

`usage/<账号 id>.json` 里的快照只包含 schema/status 标记、短的固定原因，以及：

| 字段 | 含义 |
| --- | --- |
| `observedAt` | 取到这份快照的时间 |
| `windows.fiveHour.usedPercentage` | 官方数据里如果有有效的 `rate_limits.five_hour.used_percentage` 就记下它 |
| `windows.fiveHour.resetsAt` | 官方数据里如果有有效的 `rate_limits.five_hour.resets_at` 就记下它 |
| `windows.sevenDay.usedPercentage` | 官方数据里如果有有效的 `rate_limits.seven_day.used_percentage` 就记下它 |
| `windows.sevenDay.resetsAt` | 官方数据里如果有有效的 `rate_limits.seven_day.resets_at` 就记下它 |

保存下来的快照不得包含 `session_id`、`transcript_path`、工作区路径、费用、邮箱、令牌，或 status line 的原始 JSON。缺失或已经重置的窗口保持未知，不用别的服务去补。

只有你点击配置按钮后，启动器才会配置它的 status line 命令。它保留其他设置，并拒绝覆盖已有的其他 `statusLine` 命令。

## 网络观察

只有你点击检查按钮后，才会运行网络观察。每一项只让应答的服务看到完成该项所需要的信息：

- 公共 IP 请求会把这次请求的来源地址暴露给应答的服务。出口层会在窗口里显示观察到的地址，方便与浏览器页面对照；公开截图前请遮住它。
- 单次 DNS 观察会把这次查询的名字暴露给接到这一次查询的解析器。它不描述之后的每一次查询。
- STUN 请求会把完成应答所需的地址暴露给那个 STUN 服务。
- 浏览器 WebRTC 页只有你自己打开并再次点击它的开始按钮后才会运行。它的结果不写入 `state.json`、账号目录或任何其他启动器文件。关掉页面，页面自己的结果就没有了。普通使用指南不内嵌该探测。

这些检查不修改系统 DNS、TUN 或代理。做完一次检查，不等于这台 Mac 上的每个程序都会一样。
