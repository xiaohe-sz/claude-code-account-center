import AppKit
import Darwin
import Foundation
import SwiftUI

// Resolve the macOS 13 property wrapper explicitly; newer SDKs also export a
// same-named State macro that is unavailable in some Swift 5 toolchains.
private typealias ViewState<Value> = SwiftUI.State<Value>

// Only the core's public JSON contract crosses this boundary. Never display or
// log raw stdout, stderr, environment values, or Foundation exception text.
private struct PublicFailure: Error, LocalizedError, Decodable {
    let code: String
    let message: String

    var errorDescription: String? { explanation }
    var explanation: String {
        switch code {
        case "NODE_MISSING", "NODE_VERSION": return "未找到可用的 Node.js 20 或更新版本。"
        case "RESOURCES_MISSING": return "应用的本地组件不完整。"
        case "CLI_NOT_FOUND": return "未找到 Claude Code 官方命令行工具。"
        case "INVALID_INPUT": return "填写的内容不符合要求，请检查名称、邮箱或路径。"
        case "INVALID_PATH", "INVALID_DIRECTORY": return "项目目录不存在、已移动，或当前用户无权访问。"
        case "ACCOUNT_NOT_FOUND", "PROJECT_NOT_FOUND": return "这条账号或项目记录已不可用，请刷新列表。"
        case "PROJECT_REQUIRED": return "请先选择一个项目。"
        case "STORE_BUSY": return "本地数据正在被其他操作使用，请稍后刷新。"
        case "UNSAFE_STORAGE": return "本地存储目录的权限或结构不符合要求。"
        case "INVALID_STATE": return "本地账号与项目记录无法读取。"
        case "STATUSLINE_CONFLICT": return "这个账号已经有其他状态栏命令，未覆盖原设置。"
        case "WEBRTC_OPEN_FAILED": return "无法打开浏览器检查页。"
        case "STATE_LIMIT", "INPUT_LIMIT": return "数据超出允许的大小，请减少输入内容。"
        case "CLI_TIMEOUT", "BRIDGE_TIMEOUT", "INPUT_TIMEOUT": return "操作超时，尚未确认执行结果。"
        case "CLI_OUTPUT_LIMIT", "RESPONSE_LIMIT": return "返回内容超过安全限制，已停止读取。"
        case "AUTH_STATUS_INVALID": return "官方工具未返回可识别的登录状态。"
        case "CLI_EXECUTION_FAILED": return "官方命令未能完成，请检查安装后重试。"
        case "TERMINAL_OPEN_FAILED": return "无法派发到终端，请检查 macOS 自动化权限。"
        case "UNSUPPORTED_PLATFORM": return "打开终端需要在 macOS 上运行。"
        case "RUNNER_MISSING": return "应用的终端启动组件缺失。"
        case "CLI_IGNORES_CONFIG_DIR": return "找到的 claude 命令不认账号目录（多半是包装脚本）。继续登录会改掉整台 Mac 的默认登录，已停止。"
        case "ACCOUNT_IS_GLOBAL": return "这个账号现在就是全局账号，不能再单独打开窗口，也不能删除。"
        case "ACCOUNT_IN_USE", "TARGET_IN_USE", "HOME_IN_USE": return "相关账号还有本应用打开的 Claude Code 窗口在运行，这次没有改动。"
        case "TARGET_NOT_SIGNED_IN": return "这个账号还没有完成官方登录，不能切到全局。"
        case "GLOBAL_NOT_MANAGED": return "当前全局登录的账号不在列表里，换走后就换不回来，所以这次没有切换。"
        case "GLOBAL_NOT_SIGNED_IN": return "这台 Mac 目前没有可导入的全局 claude.ai 登录。"
        case "GLOBAL_ALREADY_MANAGED": return "当前全局登录已经在账号列表里了。"
        case "GLOBAL_UNIDENTIFIED": return "当前全局登录缺少账号记录，无法安全切换。"
        case "GLOBAL_REFRESHING", "GLOBAL_CHANGED", "SWITCH_BUSY", "CONFIG_BUSY": return "全局登录正在变化，这次没有切换。"
        case "SWITCH_ROLLED_BACK": return "切换没有通过核对，已自动换回原来的全局账号。"
        case "SWITCH_ROLLBACK_FAILED": return "切换失败，而且没能自动换回原来的全局账号。"
        case "KEYCHAIN_UNAVAILABLE", "KEYCHAIN_WRITE_FAILED": return "macOS 钥匙串暂时无法读写，这次没有完成。"
        case "CREDENTIAL_UNUSABLE": return "钥匙串里的这份登录不是可用的 claude.ai 登录。"
        case "CONFIG_UNREADABLE": return "官方配置文件（~/.claude.json）无法读取。"
        case "PROCESS_LIST_UNAVAILABLE": return "无法检查正在运行的窗口，这次没有改动。"
        case "SETTINGS_CHANGED": return "官方设置文件刚被别的程序修改，这次没有写入。"
        case "ORCA_NOT_FOUND": return "没有找到 Orca 命令行工具。"
        case "ORCA_UNAVAILABLE", "ORCA_TIMEOUT": return "暂时连不上 Orca。"
        case "ORCA_PROJECT_NOT_FOUND": return "Orca 里没有这个项目。"
        case "ORCA_OPEN_FAILED": return "Orca 没能新建终端。"
        case "ORCA_OUTPUT_INVALID", "ORCA_OUTPUT_LIMIT": return "Orca 返回的内容无法识别。"
        default: return "本次操作未完成。"
        }
    }

    var recovery: String {
        switch code {
        case "NODE_MISSING", "NODE_VERSION":
            return "安装 Node.js 20 或更新版本后重新打开应用。自定义安装可通过 CCAC_NODE_PATH 环境变量指定可执行文件的完整路径。"
        case "CLI_NOT_FOUND", "CLI_EXECUTION_FAILED", "AUTH_STATUS_INVALID":
            return "按 Anthropic 官方说明安装或更新 Claude Code；在终端确认 claude --version 能运行，再回到这里刷新。自定义安装可通过 CLAUDE_CODE_CLI 环境变量指定完整路径。"
        case "RESOURCES_MISSING", "RUNNER_MISSING": return "请重新安装完整的应用包，再刷新检查。"
        case "TERMINAL_OPEN_FAILED": return "打开“系统设置 → 隐私与安全性 → 自动化”，允许本应用控制“终端”。先查看终端是否已打开，再决定是否重试。"
        case "STATUSLINE_CONFLICT": return "保留现有 statusLine。若要使用本应用的快照，请先在官方文档中了解状态栏配置，再自行决定是否调整。"
        case "WEBRTC_OPEN_FAILED": return "检查默认浏览器是否可用；也可以在应用资源目录中找到 network/webrtc.html 后自行打开。"
        case "UNSAFE_STORAGE", "INVALID_STATE": return "请保留现有数据，检查应用数据目录的归属、权限与记录格式后再刷新。"
        case "CLI_IGNORES_CONFIG_DIR":
            return "把环境变量 CLAUDE_CODE_CLI 设成官方 claude 可执行文件的完整路径（不是包装脚本），再重新打开本应用。详见故障排查文档。"
        case "ACCOUNT_IS_GLOBAL":
            return "直接用普通的 Claude Code 窗口（它已经在用这个账号）；或者先把全局切到别的账号。"
        case "ACCOUNT_IN_USE", "TARGET_IN_USE", "HOME_IN_USE":
            return "先关掉相关账号由本应用打开的 Claude Code 窗口，再试一次。同一份登录被两个窗口同时续期，会互相作废。"
        case "TARGET_NOT_SIGNED_IN": return "先点「打开官方登录」完成登录，再切换。"
        case "GLOBAL_NOT_MANAGED":
            return "先把当前全局账号加进来：点「导入当前全局登录」，或者添加账号后用同一个邮箱完成官方登录。"
        case "GLOBAL_REFRESHING", "GLOBAL_CHANGED", "SWITCH_BUSY", "CONFIG_BUSY": return "等一分钟再点一次。"
        case "SWITCH_ROLLED_BACK": return "正在运行的窗口继续用原来的账号。确认网络正常、目标账号的登录有效后再试。"
        case "SWITCH_ROLLBACK_FAILED":
            return "在普通终端运行 claude，用 /login 重新登录原来的账号；或者在这里把全局切回原来的账号。"
        case "KEYCHAIN_UNAVAILABLE", "KEYCHAIN_WRITE_FAILED", "CREDENTIAL_UNUSABLE":
            return "确认 Mac 已解锁、钥匙串没有被锁住；必要时对相关账号重新完成官方登录，再试一次。"
        case "ORCA_NOT_FOUND", "ORCA_UNAVAILABLE", "ORCA_TIMEOUT", "ORCA_PROJECT_NOT_FOUND", "ORCA_OPEN_FAILED", "ORCA_OUTPUT_INVALID", "ORCA_OUTPUT_LIMIT":
            return "确认 Orca 正在运行，并且在 Orca 里打开过这个项目，然后刷新。"
        case "BRIDGE_TIMEOUT", "CLI_TIMEOUT", "INPUT_TIMEOUT", "BRIDGE_FAILED", "RESPONSE_INVALID", "INTERNAL_ERROR":
            return "请先刷新数据并查看终端，确认上次操作的结果，再决定是否重试；应用不会自动重复添加或打开终端。"
        default: return "检查相关内容后刷新重试；应用不会自动重复执行本次操作。"
        }
    }

    static func local(_ code: String) -> PublicFailure { PublicFailure(code: code, message: "") }
    static func safe(_ error: Error) -> PublicFailure {
        (error as? PublicFailure) ?? .local("BRIDGE_FAILED")
    }
}

private struct BridgeEnvelope<Value: Decodable>: Decodable {
    let ok: Bool
    let data: Value?
    let error: PublicFailure?
}

private enum CoreBridge {
    static let inputLimit = 16_384
    static let outputLimit = 4_194_304
    static let timeout: TimeInterval = 22

    static func nodeURL(environment: [String: String]) throws -> URL {
        let manager = FileManager.default
        func usable(_ candidate: String) -> Bool {
            guard candidate.hasPrefix("/"), !candidate.contains("\n"), !candidate.contains("\0") else { return false }
            var directory: ObjCBool = false
            return manager.fileExists(atPath: candidate, isDirectory: &directory) &&
                !directory.boolValue && manager.isExecutableFile(atPath: candidate)
        }
        if let explicit = environment["CCAC_NODE_PATH"] {
            guard usable(explicit) else { throw PublicFailure.local("NODE_MISSING") }
            return URL(fileURLWithPath: explicit)
        }
        let search = (environment["PATH"] ?? "").split(separator: ":")
            .filter { $0.hasPrefix("/") }.map { String($0) + "/node" }
        let common = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node",
                      manager.homeDirectoryForCurrentUser.appendingPathComponent(".local/bin/node").path]
        guard let selected = (search + common).first(where: usable) else { throw PublicFailure.local("NODE_MISSING") }
        return URL(fileURLWithPath: selected)
    }

    // Every UI request runs off the main actor. All current command arguments
    // are strings; omitting an optional field uses the backend's own default.
    static func call<Value: Decodable>(_ command: String, args: [String: String] = [:],
                                      as type: Value.Type = Value.self,
                                      maxDuration: TimeInterval = timeout) async throws -> Value {
        try await Task.detached(priority: .userInitiated) {
            try decode(exchange(command, args: args, maxDuration: maxDuration), as: type)
        }.value
    }

    private static func decode<Value: Decodable>(_ data: Data, as type: Value.Type) throws -> Value {
        let envelope: BridgeEnvelope<Value>
        do { envelope = try JSONDecoder().decode(BridgeEnvelope<Value>.self, from: data) }
        catch { throw PublicFailure.local("RESPONSE_INVALID") }
        guard envelope.ok else {
            guard let failure = envelope.error, failure.code.utf8.count <= 64,
                  failure.message.utf8.count <= 1_024 else { throw PublicFailure.local("RESPONSE_INVALID") }
            throw failure
        }
        guard let value = envelope.data else { throw PublicFailure.local("RESPONSE_INVALID") }
        return value
    }

    // Nonblocking pipes share one deadline, including writes and EOF. A child
    // ignoring SIGTERM or leaving stdout open cannot block the UI indefinitely.
    private static func exchange(_ command: String, args: [String: String],
                                 maxDuration: TimeInterval = timeout) throws -> Data {
        let request: Data
        do { request = try JSONSerialization.data(withJSONObject: ["command": command, "args": args]) }
        catch { throw PublicFailure.local("INVALID_INPUT") }
        guard request.count + 1 <= inputLimit else { throw PublicFailure.local("INPUT_LIMIT") }
        var environment = ProcessInfo.processInfo.environment
        let executable = try nodeURL(environment: environment)
        for key in Array(environment.keys) {
            if key.uppercased().hasPrefix("DYLD_") ||
                ["NODE_OPTIONS", "NODE_PATH", "NODE_REPL_EXTERNAL_MODULE"].contains(key.uppercased()) {
                environment.removeValue(forKey: key)
            }
        }
        guard let resources = Bundle.main.resourceURL else { throw PublicFailure.local("RESOURCES_MISSING") }
        let cli = resources.appendingPathComponent("core/cli.mjs")
        guard FileManager.default.fileExists(atPath: cli.path) else { throw PublicFailure.local("RESOURCES_MISSING") }
        let process = Process()
        let input = Pipe()
        let output = Pipe()
        process.executableURL = executable
        process.arguments = [cli.path]
        process.environment = environment
        process.currentDirectoryURL = resources
        process.standardInput = input
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        let writer = input.fileHandleForWriting
        let reader = output.fileHandleForReading
        let writeFD = writer.fileDescriptor
        let readFD = reader.fileDescriptor
        var inputClosed = false
        defer {
            if process.isRunning { Darwin.kill(process.processIdentifier, SIGKILL) }
            if !inputClosed { try? writer.close() }
            try? reader.close()
            try? input.fileHandleForReading.close()
            try? output.fileHandleForWriting.close()
        }
        guard fcntl(writeFD, F_SETFL, O_NONBLOCK) != -1,
              fcntl(readFD, F_SETFL, O_NONBLOCK) != -1,
              fcntl(writeFD, F_SETNOSIGPIPE, 1) != -1 else { throw PublicFailure.local("BRIDGE_FAILED") }
        do { try process.run() } catch { throw PublicFailure.local("BRIDGE_FAILED") }
        // The parent must release its copies of the child's pipe ends.
        try? input.fileHandleForReading.close()
        try? output.fileHandleForWriting.close()
        let payload = request + Data([0x0A])
        let deadline = ProcessInfo.processInfo.systemUptime + maxDuration
        var sent = 0
        var result = Data()
        var buffer = [UInt8](repeating: 0, count: 16_384)
        var ended = false
        while !ended || process.isRunning {
            guard ProcessInfo.processInfo.systemUptime < deadline else { throw PublicFailure.local("BRIDGE_TIMEOUT") }
            if !inputClosed {
                let count = payload.withUnsafeBytes { bytes in
                    Darwin.write(writeFD, bytes.baseAddress!.advanced(by: sent), payload.count - sent)
                }
                if count > 0 { sent += count }
                else if count < 0 && errno != EAGAIN && errno != EINTR { throw PublicFailure.local("BRIDGE_FAILED") }
                if sent == payload.count { try? writer.close(); inputClosed = true }
            }
            if !ended {
                let count = Darwin.read(readFD, &buffer, buffer.count)
                if count > 0 {
                    guard result.count + count <= outputLimit else { throw PublicFailure.local("RESPONSE_LIMIT") }
                    result.append(contentsOf: buffer.prefix(count))
                    continue
                } else if count == 0 { ended = true }
                else if errno != EAGAIN && errno != EINTR { throw PublicFailure.local("BRIDGE_FAILED") }
            }
            // A short poll bounds idle CPU use without a blocking Foundation read.
            var descriptor = pollfd(fd: ended ? -1 : readFD, events: Int16(POLLIN), revents: 0)
            _ = Darwin.poll(&descriptor, 1, 20)
        }
        process.waitUntilExit()
        // Exit 1 is the normal backend error envelope; parse it before reporting.
        guard process.terminationReason == .exit, [0, 1].contains(process.terminationStatus) else {
            throw PublicFailure.local("BRIDGE_FAILED")
        }
        return result
    }

    static func snapshot() throws -> String {
        let data = try exchange("snapshot", args: [:])
        let _: Snapshot = try decode(data, as: Snapshot.self)
        guard let envelope = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let state = envelope["data"] as? [String: Any],
              let formatted = try? JSONSerialization.data(withJSONObject: state, options: [.prettyPrinted, .sortedKeys]) else {
            throw PublicFailure.local("RESPONSE_INVALID")
        }
        return String(decoding: formatted, as: UTF8.self)
    }
}

private struct Account: Decodable, Identifiable {
    let id: String
    let label: String
    let expectedEmail: String?
    let lastProjectId: String?
    let configDir: String
}

private struct Project: Decodable, Identifiable {
    let id: String
    let label: String
    let path: String
}

private struct OrcaProject: Decodable, Identifiable {
    let id: String
    let label: String
    let path: String
}

private struct OrcaListing: Decodable {
    let cliPath: String
    let projects: [OrcaProject]
}

private struct Snapshot: Decodable {
    let version: Int
    let revision: Int
    var accounts: [Account]
    var projects: [Project]
    var defaultAccountId: String?
    var globalAccountId: String?
}

private struct GlobalStatus: Decodable {
    let signedIn: Bool
    let email: String?
    let accountId: String?
    let switchedByApp: Bool
}

private struct SwitchReceipt: Decodable {
    let switched: Bool
    let reason: String?
    let accountId: String
    let email: String
    let probe: String?
    let runningWindows: String?
}

private struct RemovalReceipt: Decodable {
    let removed: Bool
}

private struct DefaultReceipt: Decodable {
    let defaultAccountId: String?
}

private struct DoctorReport: Decodable {
    struct Installation: Decodable {
        let available: Bool
        let path: String?
        let source: String?
        let error: PublicFailure?
    }
    let platform: String
    let architecture: String
    let nodeVersion: String
    let nodeSupported: Bool
    let terminalSupported: Bool
    let storage: String
    let cli: Installation
}

private struct AuthStatus: Decodable {
    let loggedIn: Bool
    let authMethod: String
    let apiProvider: String
    let email: String?
    let configDirectory: String?
    let matchesExpectedEmail: Bool?
    let matchesConfigDirectory: Bool?
    let ready: Bool
    let issues: [String]

    var needsAttention: Bool {
        loggedIn && (!ready || authMethod != "claude.ai" || matchesConfigDirectory == false || matchesExpectedEmail == false)
    }
    var methodDescription: String {
        switch authMethod {
        case "claude.ai": return "claude.ai（官方账号登录）"
        case "none": return "none（未登录）"
        case "oauth_token": return "oauth_token（令牌方式）"
        case "api_key": return "api_key（接口密钥）"
        case "api_key_helper": return "api_key_helper（外部密钥工具）"
        case "third_party": return "third_party（第三方服务）"
        default: return "无法识别的登录方式"
        }
    }
    var attentionText: String {
        var items: [String] = []
        if matchesExpectedEmail == false { items.append("官方返回的邮箱与备注邮箱不一致") }
        if matchesConfigDirectory == false { items.append("官方返回的配置目录与本账号目录不一致") }
        if authMethod != "claude.ai" { items.append("当前不是本应用使用的官方账号登录方式") }
        if issues.contains("UNSUPPORTED_PROVIDER") { items.append("当前服务提供方不受支持") }
        if items.isEmpty { items.append("官方状态仍有需要处理的项目") }
        return items.joined(separator: "；") + "。请在终端重新完成官方登录，再检查状态。"
    }
}

private struct TerminalReceipt: Decodable {
    let opened: Bool
    let execution: String
    let accountId: String
    let projectId: String?
    let action: String
}

private struct UsageConfiguration: Decodable {}

private struct UsageWindow: Decodable {
    let usedPercentage: Double
    let resetsAt: Double
}

private struct UsageSnapshot: Decodable {
    struct Windows: Decodable {
        let fiveHour: UsageWindow?
        let sevenDay: UsageWindow?
    }
    let status: String
    let windows: Windows
    let observedAt: String
    let reason: String
}

private struct NetworkLayer: Decodable {
    struct Observed: Decodable {
        let ip: String?
    }
    let status: String
    let reason: String
    let observed: Observed?
}

private struct NetworkReport: Decodable {
    let egress: NetworkLayer
    let routeIpv6: NetworkLayer
    let dns: NetworkLayer
    let browserWebRTC: NetworkLayer
}

private struct WebRTCPage: Decodable {
    let path: String
}

private enum CheckState {
    case unchecked
    case checking
    case checked(AuthStatus, Date)
    case failed(PublicFailure)

    var title: String {
        switch self {
        case .unchecked: return "未检查"
        case .checking: return "检查中"
        case .failed: return "错误"
        case .checked(let status, _): return !status.loggedIn ? "未登录" : status.needsAttention ? "需处理" : "已登录"
        }
    }
    var color: Color {
        switch self {
        case .unchecked: return .secondary
        case .checking: return .blue
        case .failed: return .red
        case .checked(let status, _): return !status.loggedIn || status.needsAttention ? .orange : .green
        }
    }
}

private struct UserNotice {
    let title: String
    let detail: String
}

@MainActor
private final class CenterModel: ObservableObject {
    @Published var snapshot: Snapshot?
    @Published var snapshotAvailable = false
    @Published var doctor: DoctorReport?
    @Published var environmentFailure: PublicFailure?
    @Published var failure: PublicFailure?
    @Published var notice: UserNotice?
    @Published var operation: String?
    @Published var selectingDirectory = false
    @Published var selectedAccountID: String?
    @Published var checks: [String: CheckState] = [:]
    @Published var loginDispatched: Set<String> = []
    @Published var showAddAccount = false
    @Published var usage: [String: UsageSnapshot] = [:]
    @Published var usageFailures: [String: PublicFailure] = [:]
    @Published var orcaProjects: [OrcaProject] = []
    @Published var orcaAvailable = false
    @Published var network: NetworkReport?
    @Published var networkCheckedAt: Date?
    @Published var globalStatus: GlobalStatus?

    var accounts: [Account] { snapshot?.accounts ?? [] }
    var projects: [Project] { snapshot?.projects ?? [] }
    var account: Account? { accounts.first { $0.id == selectedAccountID } }
    var busy: Bool { operation != nil || selectingDirectory }
    var canEdit: Bool { snapshotAvailable && !busy }
    var cliReady: Bool { doctor?.nodeSupported == true && doctor?.cli.available == true && doctor?.terminalSupported == true }
    var canUseCLI: Bool { canEdit && cliReady }
    func check(for id: String) -> CheckState { checks[id] ?? .unchecked }
    func lastProject(for account: Account) -> Project? { projects.first { $0.id == account.lastProjectId } }
    func isOrcaProject(_ project: Project) -> Bool { orcaProjects.contains { $0.path == project.path } }
    func isDefault(_ account: Account) -> Bool { snapshot?.defaultAccountId == account.id }
    func isGlobal(_ account: Account) -> Bool { globalStatus?.accountId == account.id }

    func refresh() {
        guard !busy else { return }
        operation = "正在刷新本地数据与环境…"
        failure = nil
        Task {
            defer { operation = nil }
            // Independent failures remain visible: missing CLI must not hide accounts.
            do {
                let current: Snapshot = try await CoreBridge.call("snapshot")
                snapshot = current
                snapshotAvailable = true
                let ids = Set(current.accounts.map(\.id))
                checks = checks.filter { ids.contains($0.key) }
                usage = usage.filter { ids.contains($0.key) }
                usageFailures = usageFailures.filter { ids.contains($0.key) }
                if !ids.contains(selectedAccountID ?? "") {
                    selectedAccountID = current.defaultAccountId.flatMap { ids.contains($0) ? $0 : nil } ?? current.accounts.first?.id
                }
                await loadGlobalStatus()
            } catch { snapshotAvailable = false; failure = .safe(error) }
            do {
                doctor = try await CoreBridge.call("doctor")
                environmentFailure = nil
            } catch { doctor = nil; environmentFailure = .safe(error) }
            Task { await self.loadOrcaProjects() }
            if snapshotAvailable, cliReady {
                operation = "正在检查各账号的官方登录状态与额度…"
                // At most three accounts at a time: each check starts Node and the official CLI.
                for batch in batches(accounts) {
                    await withTaskGroup(of: Void.self) { group in
                        for account in batch {
                            group.addTask {
                                await self.readStatus(account.id)
                                await self.readUsage(account.id)
                            }
                        }
                    }
                }
            } else if snapshotAvailable {
                for batch in batches(accounts) {
                    await withTaskGroup(of: Void.self) { group in
                        for account in batch {
                            group.addTask { await self.readUsage(account.id) }
                        }
                    }
                }
            }
        }
    }

    private func batches(_ list: [Account], size: Int = 3) -> [[Account]] {
        stride(from: 0, to: list.count, by: size).map { Array(list[$0..<min($0 + size, list.count)]) }
    }

    private func loadGlobalStatus() async {
        globalStatus = try? await CoreBridge.call("global.status")
    }

    private func reloadSnapshot() async throws {
        let current: Snapshot = try await CoreBridge.call("snapshot")
        snapshot = current
        let ids = Set(current.accounts.map(\.id))
        if !ids.contains(selectedAccountID ?? "") {
            selectedAccountID = current.defaultAccountId.flatMap { ids.contains($0) ? $0 : nil } ?? current.accounts.first?.id
        }
        await loadGlobalStatus()
    }

    private func confirm(_ title: String, _ detail: String, action: String, destructive: Bool = false) -> Bool {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = detail
        alert.alertStyle = destructive ? .critical : .warning
        let primary = alert.addButton(withTitle: action)
        if destructive { primary.hasDestructiveAction = true }
        alert.addButton(withTitle: "取消")
        return alert.runModal() == .alertFirstButtonReturn
    }

    func setDefault() {
        guard canEdit, let account else { return }
        perform("正在设为默认账号…") {
            let receipt: DefaultReceipt = try await CoreBridge.call("account.setDefault", args: ["accountId": account.id])
            guard receipt.defaultAccountId == account.id else { throw PublicFailure.local("RESPONSE_INVALID") }
            try await self.reloadSnapshot()
            self.notice = UserNotice(title: "已把默认账号设为 \(account.label)",
                                     detail: "以后打开应用会先选中这个账号。默认只影响这里的选择，不改任何登录。")
        }
    }

    func switchGlobal() {
        guard canUseCLI, let account else { return }
        let current = globalStatus?.email ?? "（目前没有全局登录）"
        guard confirm("把全局账号切到 \(account.label)？",
                      "全局账号是普通 claude 命令和普通 Orca 窗口共用的登录，现在是 \(current)。\n\n切换会：先把现在的全局登录存回它自己的账号，再把 \(account.label) 的登录放进全局，然后用新账号发一条真实的测试消息核对。核对没过会自动换回原账号。\n\n新开的普通窗口直接用新账号；已经开着的普通窗口会在下一次请求时跟着换（正在输出的那一条用旧账号说完）。本应用为单个账号单独打开的窗口不受影响。",
                      action: "切到 \(account.label)") else { return }
        perform("正在切换全局账号：保存原账号、写入新账号、发一条测试消息核对，大约需要半分钟…") {
            // Longer than every bounded step of the switch combined, so the bridge never
            // kills the core between the global write and its confirmation or rollback.
            let receipt: SwitchReceipt = try await CoreBridge.call("global.switch", args: ["accountId": account.id], maxDuration: 600)
            guard receipt.accountId == account.id else { throw PublicFailure.local("RESPONSE_INVALID") }
            try await self.reloadSnapshot()
            if receipt.switched {
                self.notice = UserNotice(title: "全局账号已切到 \(account.label)",
                                         detail: "官方状态显示 \(receipt.email)，测试消息已成功回复。新开的普通窗口直接用这个账号；已开着的普通窗口会在下一次请求时跟着换。")
            } else {
                self.notice = UserNotice(title: "\(account.label) 本来就是全局账号", detail: "没有做任何改动。")
            }
        }
    }

    func importGlobal() {
        guard canEdit, let email = globalStatus?.email, globalStatus?.accountId == nil else { return }
        let alert = NSAlert()
        alert.messageText = "把当前全局登录导入为账号？"
        alert.informativeText = "会把 \(email) 这份全局登录复制到一个新账号里，以后就能在全局之间来回切换。不会打开网页，也不会改动全局登录。"
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
        field.stringValue = String(email.split(separator: "@").first ?? "全局账号").prefix(60).description
        alert.accessoryView = field
        alert.addButton(withTitle: "导入")
        alert.addButton(withTitle: "取消")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let label = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !label.isEmpty, label.utf16.count <= 120 else { failure = .local("INVALID_INPUT"); return }
        perform("正在导入当前全局登录…") {
            let created: Account = try await CoreBridge.call("account.importGlobal", args: ["label": label])
            try await self.reloadSnapshot()
            self.selectedAccountID = created.id
            self.notice = UserNotice(title: "已导入 \(label)",
                                     detail: "它就是当前的全局账号，所以暂时不能单独打开窗口；把全局切到别的账号后就可以了。")
            await self.readStatus(created.id)
        }
    }

    func removeAccount() {
        guard canEdit, let account else { return }
        guard confirm("删除账号 \(account.label)？",
                      "会删除本应用为它保存的独立配置目录（含该目录里的会话记录）和本机钥匙串里这一份登录。你的 Claude 账号本身、项目文件夹、全局登录都不受影响。此操作不能撤销。",
                      action: "删除", destructive: true) else { return }
        perform("正在删除账号…") {
            let receipt: RemovalReceipt = try await CoreBridge.call("account.remove", args: ["accountId": account.id])
            guard receipt.removed else { throw PublicFailure.local("RESPONSE_INVALID") }
            self.checks[account.id] = nil
            self.usage[account.id] = nil
            self.selectedAccountID = nil
            try await self.reloadSnapshot()
            self.notice = UserNotice(title: "已删除 \(account.label)", detail: "这台 Mac 上这份独立登录和配置目录已移除。")
        }
    }

    func removeProject(_ project: Project) {
        guard canEdit else { return }
        guard confirm("从列表移除 \(project.label)？", "只从本应用的项目列表移除，不会删除或改动文件夹本身。", action: "移除") else { return }
        perform("正在移除项目…") {
            let receipt: RemovalReceipt = try await CoreBridge.call("project.remove", args: ["projectId": project.id])
            guard receipt.removed else { throw PublicFailure.local("RESPONSE_INVALID") }
            try await self.reloadSnapshot()
        }
    }

    private func loadOrcaProjects() async {
        do {
            let listing: OrcaListing = try await CoreBridge.call("orca.projects")
            orcaProjects = listing.projects
            orcaAvailable = true
        } catch {
            orcaProjects = []
            orcaAvailable = false
        }
    }

    func chooseAccount(_ id: String) {
        guard !busy, accounts.contains(where: { $0.id == id }) else { return }
        selectedAccountID = id
        failure = nil
        notice = nil
        if usage[id] == nil { readUsageSnapshot() }
    }

    func createAccount(label: String, email: String) {
        guard canEdit else { return }
        var args = ["label": label.trimmingCharacters(in: .whitespacesAndNewlines)]
        let email = email.trimmingCharacters(in: .whitespacesAndNewlines)
        if !email.isEmpty { args["expectedEmail"] = email }
        perform("正在添加账号…") {
            let created: Account = try await CoreBridge.call("account.create", args: args)
            self.snapshot?.accounts.append(created)
            self.selectedAccountID = created.id
            self.checks[created.id] = .unchecked
            self.showAddAccount = false
            self.notice = UserNotice(title: "本地账号已添加", detail: "下一步打开官方登录，在终端中完成 Anthropic 的登录流程。")
            await self.readUsage(created.id)
        }
    }

    func checkLogin() {
        guard canUseCLI, let id = account?.id else { return }
        operation = "正在读取官方登录状态…"
        failure = nil
        Task { await readStatus(id); operation = nil }
    }

    private func readStatus(_ id: String) async {
        checks[id] = .checking
        do {
            let status: AuthStatus = try await CoreBridge.call("auth.status", args: ["accountId": id])
            checks[id] = .checked(status, Date())
            if status.loggedIn { loginDispatched.remove(id) }
        } catch { checks[id] = .failed(.safe(error)) }
    }

    func readUsageSnapshot() {
        guard canEdit, let id = account?.id else { return }
        operation = "正在读取本地额度快照…"
        failure = nil
        Task { await readUsage(id); operation = nil }
    }

    private func readUsage(_ id: String) async {
        do {
            let snapshot: UsageSnapshot = try await CoreBridge.call("usage.snapshot", args: ["accountId": id])
            usage[id] = snapshot
            usageFailures[id] = nil
        } catch {
            usage[id] = nil
            usageFailures[id] = .safe(error)
        }
    }

    func configureUsage() {
        guard canEdit, let id = account?.id else { return }
        perform("正在配置官方状态栏快照…") {
            let _: UsageConfiguration = try await CoreBridge.call("usage.configure", args: ["accountId": id])
            await self.readUsage(id)
            self.notice = UserNotice(title: "官方状态栏快照已配置",
                                     detail: "此后在官方 Claude Code 会话中，状态栏产生数据时才会留下快照。没有数据或窗口已重置时仍显示未知。")
        }
    }

    func login() {
        guard canUseCLI, let account else { return }
        perform("正在派发官方登录到终端…如果 macOS 询问是否允许控制“终端”，请点“允许”。") {
            let receipt: TerminalReceipt = try await CoreBridge.call("auth.login", args: ["accountId": account.id], maxDuration: 140)
            guard receipt.opened, receipt.execution == "unconfirmed", receipt.accountId == account.id,
                  receipt.action == "login" else { throw PublicFailure.local("RESPONSE_INVALID") }
            self.checks[account.id] = .unchecked
            self.loginDispatched.insert(account.id)
            self.notice = UserNotice(title: "已派发官方登录 · 等待你在终端操作",
                                     detail: "尚未确认登录结果。请完成终端与官方网页中的步骤，再点击“检查登录状态”。")
        }
    }

    func pickProject() {
        guard canEdit else { return }
        selectingDirectory = true
        let panel = NSOpenPanel()
        panel.title = "选择项目目录"
        panel.message = "选择你要用 Claude Code 处理的项目文件夹。"
        panel.prompt = "添加项目"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        panel.begin { [weak self] response in
            Task { @MainActor in
                guard let self else { return }
                self.selectingDirectory = false
                guard response == .OK, let url = panel.url else { return }
                self.addProject(url)
            }
        }
    }

    private func addProject(_ url: URL, label: String? = nil) {
        guard canEdit else { return }
        perform("正在添加项目目录…") {
            var args = ["path": url.path]
            if let label, !label.isEmpty { args["label"] = label }
            let project: Project = try await CoreBridge.call("project.add", args: args)
            if let index = self.snapshot?.projects.firstIndex(where: { $0.id == project.id }) {
                self.snapshot?.projects[index] = project
            } else { self.snapshot?.projects.append(project) }
            self.notice = UserNotice(title: "项目已添加", detail: "选择项目会记住当前账号的上次项目；可选择系统 Terminal 或 Orca 打开。")
        }
    }

    func addOrcaProject(_ project: OrcaProject) {
        guard canEdit else { return }
        if projects.contains(where: { $0.path == project.path }) {
            self.notice = UserNotice(title: "项目已在列表中", detail: "可以直接选择这个项目，再从 Orca 打开。")
            return
        }
        addProject(URL(fileURLWithPath: project.path), label: project.label)
    }

    func selectProject(_ project: Project) {
        guard canEdit, let account else { return }
        perform("正在为当前账号记住项目…") { try await self.persistSelection(account.id, project.id) }
    }

    private func persistSelection(_ accountID: String, _ projectID: String) async throws {
        let updated: Account = try await CoreBridge.call("project.select", args: ["accountId": accountID, "projectId": projectID])
        guard updated.id == accountID, updated.lastProjectId == projectID,
              let index = snapshot?.accounts.firstIndex(where: { $0.id == accountID }) else {
            throw PublicFailure.local("RESPONSE_INVALID")
        }
        snapshot?.accounts[index] = updated
    }

    func openProject(_ project: Project, inOrca: Bool = false) {
        guard canUseCLI, let account else { return }
        perform(inOrca ? "正在记住项目并派发到 Orca 终端…" : "正在记住项目并派发到终端…如果 macOS 询问是否允许控制“终端”，请点“允许”。") {
            // Always persist first, including the “open last project” path.
            try await self.persistSelection(account.id, project.id)
            let command = inOrca ? "orca.open" : "terminal.open"
            let receipt: TerminalReceipt = try await CoreBridge.call(command, args: [
                "accountId": account.id, "projectId": project.id, "action": "launch"
            ], maxDuration: inOrca ? 50 : 140)
            guard receipt.opened, receipt.execution == "unconfirmed", receipt.accountId == account.id,
                  receipt.projectId == project.id, receipt.action == "launch" else { throw PublicFailure.local("RESPONSE_INVALID") }
            self.notice = UserNotice(title: inOrca ? "已在 Orca 派发新终端 · 启动结果尚未确认"
                                                   : "已派发到终端 · 启动结果尚未确认",
                                     detail: "项目：\(project.label)。\(inOrca ? "Orca 新终端固定使用 \(account.label) 的独立配置目录，已经运行的终端不会被换号。" : "请在终端查看运行结果。")这条回执不代表已经登录或启动成功。")
        }
    }

    func checkNetwork() {
        guard !busy else { return }
        perform("正在进行只读网络观察…") {
            let report: NetworkReport = try await CoreBridge.call("network.check")
            self.network = report
            self.networkCheckedAt = Date()
        }
    }

    func openWebRTC() {
        guard !busy else { return }
        perform("正在打开 WebRTC 检查页…") {
            let page: WebRTCPage = try await CoreBridge.call("network.webrtcPage")
            let url = URL(fileURLWithPath: page.path).standardizedFileURL
            let expected = Bundle.main.resourceURL?.appendingPathComponent("network/webrtc.html").standardizedFileURL
            guard url.path == expected?.path, FileManager.default.fileExists(atPath: url.path) else {
                throw PublicFailure.local("RESOURCES_MISSING")
            }
            guard NSWorkspace.shared.open(url) else { throw PublicFailure.local("WEBRTC_OPEN_FAILED") }
            self.notice = UserNotice(title: "WebRTC 检查页已交给浏览器",
                                     detail: "页面不会自动探测。请阅读隐私提示并自行点击开始；结果只留在页面，不写回应用。")
        }
    }

    private func perform(_ label: String, action: @escaping @MainActor () async throws -> Void) {
        guard !busy else { return }
        operation = label
        failure = nil
        notice = nil
        Task {
            defer { operation = nil }
            do { try await action() } catch { failure = .safe(error) }
        }
    }
}

private enum Palette {
    static let accent = Color(red: 0.05, green: 0.55, blue: 0.34)
    static let accentSoft = Color(red: 0.91, green: 0.97, blue: 0.94)
    static let warning = Color(red: 0.92, green: 0.56, blue: 0.12)
    static let danger = Color(red: 0.84, green: 0.27, blue: 0.23)
    static let card = Color(nsColor: .controlBackgroundColor)
    static let canvas = Color(nsColor: .windowBackgroundColor)
}

// Reusable cards leave room for future real data without placeholder controls.
private struct SectionCard<Content: View>: View {
    let title: String
    let symbol: String
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 15) {
            Label(title, systemImage: symbol).font(.headline)
            content
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Palette.accent.opacity(0.10)))
        .shadow(color: Color.black.opacity(0.04), radius: 8, y: 2)
    }
}

private struct StatusBadge: View {
    let title: String
    let color: Color
    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(color).frame(width: 6, height: 6)
            Text(title).font(.system(size: 11, weight: .medium))
        }
        .padding(.horizontal, 8).padding(.vertical, 4)
        .background(color.opacity(0.1), in: Capsule())
        .accessibilityElement(children: .combine)
    }
}

private struct DetailLine: View {
    let label: String
    let value: String
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text(label).foregroundStyle(.secondary).frame(width: 92, alignment: .leading)
            Text(value).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
        }.font(.system(size: 12))
    }
}

private struct UsageMeter: View {
    let title: String
    let window: UsageWindow?
    let warnBelow: Double

    private var remaining: Double? {
        guard let window else { return nil }
        return max(0, min(100, 100 - window.usedPercentage))
    }

    private var tint: Color {
        guard let remaining else { return .secondary }
        if remaining <= warnBelow / 3 { return Palette.danger }
        if remaining <= warnBelow { return Palette.warning }
        return Palette.accent
    }

    private var resetText: String {
        guard let window else { return "官方尚未提供这个窗口" }
        return "重置：" + Date(timeIntervalSince1970: window.resetsAt)
            .formatted(date: .abbreviated, time: .shortened)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text(title).font(.system(size: 12, weight: .medium)).foregroundStyle(.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(remaining.map { "\(Int($0.rounded()))%" } ?? "未知")
                    .font(.system(size: 30, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(remaining == nil ? Color.secondary : tint)
                Text(remaining == nil ? "暂无快照" : "剩余")
                    .font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary)
            }
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.secondary.opacity(0.12))
                    Capsule().fill(tint).frame(width: proxy.size.width * CGFloat((remaining ?? 0) / 100))
                }
            }
            .frame(height: 8)
            .accessibilityHidden(true)
            if let window {
                Text("已用 \(String(format: "%.1f", window.usedPercentage))% · \(resetText)")
                    .font(.system(size: 11)).foregroundStyle(.secondary)
                    .lineLimit(2)
            } else {
                Text(resetText).font(.system(size: 11)).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct SidebarQuota: View {
    let title: String
    let window: UsageWindow?
    let warnBelow: Double

    private var remaining: Double? {
        guard let window else { return nil }
        return max(0, min(100, 100 - window.usedPercentage))
    }

    private var tint: Color {
        guard let remaining else { return .secondary }
        if remaining <= warnBelow / 3 { return Palette.danger }
        if remaining <= warnBelow { return Palette.warning }
        return Palette.accent
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(title).font(.system(size: 10)).foregroundStyle(.secondary)
                Spacer(minLength: 4)
                Text(remaining.map { "\(Int($0.rounded()))%" } ?? "未知")
                    .font(.system(size: 10, weight: .semibold)).monospacedDigit()
                    .foregroundStyle(remaining == nil ? Color.secondary : tint)
            }
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.secondary.opacity(0.12))
                    Capsule().fill(tint).frame(width: proxy.size.width * CGFloat((remaining ?? 0) / 100))
                }
            }.frame(height: 5)
        }
    }
}

private struct FailureBox: View {
    let failure: PublicFailure
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(failure.explanation, systemImage: "exclamationmark.triangle.fill")
                .font(.system(size: 12, weight: .semibold)).foregroundStyle(.red)
            Text(failure.recovery).font(.system(size: 12)).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if !failure.message.isEmpty {
                DisclosureGroup("后端安全说明（原文）") {
                    Text(failure.message).font(.system(size: 11)).textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }.font(.system(size: 11)).foregroundStyle(.secondary)
            }
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.red.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
    }
}

private struct EnvironmentCard: View {
    @ObservedObject var model: CenterModel
    var body: some View {
        SectionCard(title: "本机环境", symbol: "desktopcomputer") {
            if let report = model.doctor {
                HStack {
                    Label("Node.js（本地运行组件）", systemImage: "shippingbox")
                    Spacer()
                    StatusBadge(title: report.nodeSupported ? "\(report.nodeVersion) · 可用" : "版本需更新",
                                color: report.nodeSupported ? .green : .orange)
                }.font(.system(size: 12))
                HStack {
                    Label("Claude Code 官方命令行工具", systemImage: "terminal")
                    Spacer()
                    StatusBadge(title: report.cli.available ? "已找到" : "未找到", color: report.cli.available ? .green : .orange)
                }.font(.system(size: 12))
                if let path = report.cli.path {
                    Text(path).font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary)
                        .textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                    Text("已找到表示安装路径可用；登录状态需单独检查。").font(.system(size: 11)).foregroundStyle(.secondary)
                }
                if !report.nodeSupported { FailureBox(failure: .local("NODE_VERSION")) }
                if !report.cli.available { FailureBox(failure: report.cli.error ?? .local("CLI_NOT_FOUND")) }
                if !report.terminalSupported { FailureBox(failure: .local("UNSUPPORTED_PLATFORM")) }
                DetailLine(label: "本地存储", value: report.storage == "ok" ? "检查通过" : "需处理")
            } else if let failure = model.environmentFailure {
                FailureBox(failure: failure)
                Text("环境检查未完成，暂时无法确认官方工具是否可用。").font(.system(size: 12)).foregroundStyle(.secondary)
            } else {
                HStack(spacing: 10) {
                    if model.busy { ProgressView().controlSize(.small) }
                    Text(model.busy ? "正在检查 Node.js 和官方命令行工具…" : "尚未检查本机环境")
                        .foregroundStyle(.secondary)
                }.font(.system(size: 12))
            }
            HStack {
                Text("账号与项目元数据保存在本机").font(.system(size: 11)).foregroundStyle(.secondary)
                Spacer()
                Button("重新检查") { model.refresh() }.disabled(model.busy)
            }
        }
    }
}

private struct WelcomeView: View {
    @ObservedObject var model: CenterModel
    let finish: () -> Void
    var body: some View {
        ScrollView {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 12) {
                Image(systemName: "person.crop.rectangle.stack").font(.system(size: 30)).foregroundStyle(Palette.accent)
                VStack(alignment: .leading, spacing: 4) {
                    Text("把账号和项目放在一起").font(.title2).bold()
                    Text("Claude Code Account Center · 非官方本地工具").font(.system(size: 12)).foregroundStyle(.secondary)
                }
            }
            VStack(alignment: .leading, spacing: 10) {
                Label("账号备注、项目路径、独立配置目录和最小额度快照只保存本机。", systemImage: "internaldrive")
                Label("登录交给 Anthropic 官方流程，在终端与官方网页完成。", systemImage: "arrow.up.forward.app")
                Label("只有你点「切全局到此号」或「导入当前全局登录」时，才会在本机钥匙串里复制登录；登录内容不显示、不记录、不上传。", systemImage: "lock.shield")
                Label("网络检查只在你点击后运行，不会修改系统网络设置。", systemImage: "network")
            }.font(.system(size: 13))
            EnvironmentCard(model: model)
            Text("使用顺序：添加账号 → 官方登录 → 检查状态 → 选择项目并打开 Terminal 或 Orca；需要时把某个账号切成全局账号。")
                .font(.system(size: 12)).foregroundStyle(.secondary)
            HStack {
                Text("环境有问题也可以先进入查看修复提示。").font(.system(size: 11)).foregroundStyle(.secondary)
                Spacer()
                Button("进入账号中心", action: finish).buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
            }
        }
        .padding(26)
        }
        .frame(width: 620, height: 600)
        .background(Palette.canvas)
    }
}

private struct AddAccountView: View {
    @ObservedObject var model: CenterModel
    @Environment(\.dismiss) private var dismiss
    @ViewState private var label = ""
    @ViewState private var email = ""
    @FocusState private var nameFocused: Bool
    private var trimmedLabel: String { label.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var trimmedEmail: String { email.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var valid: Bool {
        !trimmedLabel.isEmpty && trimmedLabel.utf16.count <= 120 &&
        (trimmedEmail.isEmpty || (trimmedEmail.utf16.count <= 254 &&
            trimmedEmail.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil))
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("添加本地账号").font(.title2).bold()
            Text("先起一个容易分辨的名字，再通过官方流程登录。").foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 6) {
                Text("账号名称 · 必填").font(.system(size: 12, weight: .medium))
                TextField("例如：工作账号", text: $label).focused($nameFocused).textFieldStyle(.roundedBorder)
                Text("最多 120 个字符").font(.system(size: 11)).foregroundStyle(.secondary)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("邮箱备注 · 选填").font(.system(size: 12, weight: .medium))
                TextField("例如：name@example.com", text: $email).textFieldStyle(.roundedBorder)
                Text("这只是你填写的备注，不代表邮箱已核验。官方未返回邮箱时，会明确标注无法比对。")
                    .font(.system(size: 12)).foregroundStyle(.secondary)
            }
            if let failure = model.failure { FailureBox(failure: failure) }
            HStack {
                if model.busy { ProgressView().controlSize(.small); Text("正在保存…").font(.system(size: 12)).foregroundStyle(.secondary) }
                Spacer()
                Button("取消") { dismiss() }.keyboardShortcut(.cancelAction).disabled(model.busy)
                Button("添加账号") { model.createAccount(label: label, email: email) }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(!valid || !model.canEdit)
            }
        }
        .padding(24).frame(width: 470)
        .disabled(model.busy)
        .interactiveDismissDisabled(model.busy)
        .onAppear { nameFocused = true }
    }
}

private struct AccountDetail: View {
    @ObservedObject var model: CenterModel
    let account: Account
    private var state: CheckState { model.check(for: account.id) }
    private var loginTitle: String {
        if case .checked(let status, _) = state, status.loggedIn { return "重新登录" }
        return "打开官方登录"
    }

    var body: some View {
        SectionCard(title: "官方登录", symbol: "person.crop.circle.badge.checkmark") {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(account.label).font(.system(size: 20, weight: .semibold)).textSelection(.enabled)
                    Text("每个账号使用独立的本地配置目录").font(.system(size: 12)).foregroundStyle(.secondary)
                }
                Spacer()
                if case .checking = state { ProgressView().controlSize(.small) }
                StatusBadge(title: state.title, color: state.color)
            }
            Divider()
            VStack(alignment: .leading, spacing: 8) {
                DetailLine(label: "备注邮箱", value: account.expectedEmail ?? "未填写（可选）")
                statusDetails
            }
            DisclosureGroup("查看配置目录") {
                VStack(alignment: .leading, spacing: 9) {
                    DetailLine(label: "本账号目录", value: account.configDir)
                    if case .checked(let status, _) = state {
                        DetailLine(label: "官方返回目录", value: status.configDirectory ?? "官方状态未提供配置目录")
                    }
                }.padding(.top, 8)
            }.font(.system(size: 12)).foregroundStyle(.secondary)
            if model.loginDispatched.contains(account.id) {
                Label("登录请求已派发。完成官方流程后，请在这里检查登录状态。", systemImage: "info.circle")
                    .font(.system(size: 12)).foregroundStyle(.blue)
            }
            HStack(spacing: 10) {
                Button { model.login() } label: { Label(loginTitle, systemImage: "arrow.up.forward.app") }
                    .buttonStyle(.borderedProminent).disabled(!model.canUseCLI)
                Button("检查登录状态") { model.checkLogin() }.disabled(!model.canUseCLI)
                Spacer()
            }
            Text("登录会打开 Terminal（系统终端），执行官方 auth login（登录命令），由你在官方网页完成。登录前会先确认 claude 命令确实使用这个账号的目录，避免改掉整台 Mac 的默认登录。")
                .font(.system(size: 11)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if !model.cliReady { Text("请先按下方“本机环境”的提示完成修复，再重新检查。").font(.system(size: 12)).foregroundStyle(.orange) }
        }
    }

    @ViewBuilder private var statusDetails: some View {
        switch state {
        case .unchecked:
            Text("还没有读取这个账号的官方登录状态。").font(.system(size: 12)).foregroundStyle(.secondary)
        case .checking:
            Text("正在向本机官方工具查询，请稍候…").font(.system(size: 12)).foregroundStyle(.secondary)
        case .failed(let failure): FailureBox(failure: failure)
        case .checked(let status, let date):
            DetailLine(label: "官方登录状态", value: status.loggedIn ? "已登录（官方状态返回）" : "未登录（官方状态返回）")
            DetailLine(label: "登录方式", value: status.methodDescription)
            DetailLine(label: "官方邮箱", value: status.email ?? "官方状态未提供邮箱")
            DetailLine(label: "邮箱比对", value: emailMatch(status))
            DetailLine(label: "配置目录比对", value: directoryMatch(status))
            if status.needsAttention {
                Label(status.attentionText, systemImage: "exclamationmark.circle")
                    .font(.system(size: 12)).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
            }
            Text("检查时间：\(date.formatted(date: .omitted, time: .standard)) · 仅代表这次查询结果")
                .font(.system(size: 11)).foregroundStyle(.secondary)
        }
    }

    private func emailMatch(_ status: AuthStatus) -> String {
        guard status.email != nil else { return "无法比对：官方状态未提供邮箱" }
        guard account.expectedEmail != nil else { return "未填写备注邮箱，不作比对" }
        switch status.matchesExpectedEmail {
        case true?: return "与备注邮箱一致"
        case false?: return "与备注邮箱不一致 · 需处理"
        default: return "官方状态不足，无法确认"
        }
    }
    private func directoryMatch(_ status: AuthStatus) -> String {
        switch status.matchesConfigDirectory {
        case true?: return "与本账号目录一致"
        case false?: return "与本账号目录不一致 · 需处理"
        default: return "官方状态未提供足够信息，无法确认"
        }
    }
}

private struct GlobalCard: View {
    @ObservedObject var model: CenterModel
    let account: Account
    private var globalLine: String {
        guard let status = model.globalStatus else { return "暂时无法读取" }
        guard status.signedIn, let email = status.email else { return "这台 Mac 还没有全局登录" }
        if status.accountId == account.id { return "\(email)（就是这个账号）" }
        if let id = status.accountId, let owner = model.accounts.first(where: { $0.id == id }) { return "\(email)（账号：\(owner.label)）" }
        return "\(email)（不在账号列表里）"
    }
    var body: some View {
        SectionCard(title: "全局账号与默认", symbol: "globe") {
            DetailLine(label: "当前全局", value: globalLine)
            Text("全局账号是普通 claude 命令和普通 Orca 窗口共用的那个登录。切换后，新开的普通窗口直接用新账号；已经开着的普通窗口会在下一次请求时跟着换。本应用为单个账号单独打开的窗口不受影响。")
                .font(.system(size: 12)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 10) {
                if model.isGlobal(account) {
                    Label("这个账号就是当前全局账号", systemImage: "checkmark.seal.fill")
                        .font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.accent)
                } else {
                    Button { model.switchGlobal() } label: { Label("切全局到此号", systemImage: "arrow.triangle.2.circlepath") }
                        .buttonStyle(.borderedProminent).disabled(!model.canUseCLI)
                }
                if model.isDefault(account) {
                    StatusBadge(title: "默认账号", color: .blue)
                } else {
                    Button("设为默认") { model.setDefault() }.disabled(!model.canEdit)
                }
                Spacer()
                Button(role: .destructive) { model.removeAccount() } label: { Label("删除账号", systemImage: "trash") }
                    .disabled(!model.canEdit || model.isGlobal(account))
                    .help(model.isGlobal(account) ? "先把全局切到别的账号，才能删除这个账号" : "删除这个账号在本机的独立登录和配置目录")
            }
            if let status = model.globalStatus, status.signedIn, status.accountId == nil, let email = status.email {
                HStack(alignment: .top, spacing: 10) {
                    Label("当前全局登录 \(email) 不在账号列表里。先导入它，切走以后才能切回来。", systemImage: "exclamationmark.triangle")
                        .font(.system(size: 12)).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
                    Spacer()
                    Button("导入当前全局登录") { model.importGlobal() }.disabled(!model.canEdit)
                }
            }
            Text("「设为默认」只决定打开应用时先选中哪个账号，不改任何登录。切换全局会在本机钥匙串里复制登录，并用新账号发一条测试消息核对；没通过会自动换回。")
                .font(.system(size: 11)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct UsageCard: View {
    @ObservedObject var model: CenterModel
    let account: Account
    private var snapshot: UsageSnapshot? { model.usage[account.id] }

    var body: some View {
        SectionCard(title: "官方额度快照", symbol: "gauge.with.dots.needle.33percent") {
            HStack {
                Text(account.label).font(.system(size: 20, weight: .semibold))
                Spacer()
                if let snapshot {
                    StatusBadge(title: snapshot.status == "available" ? "有快照" : "未知",
                                color: snapshot.status == "available" ? Palette.accent : .secondary)
                }
            }
            if let snapshot {
                Text("来自官方 status line 的最近本地记录").font(.system(size: 12)).foregroundStyle(.secondary)
                HStack(alignment: .top, spacing: 22) {
                    UsageMeter(title: "5 小时额度", window: snapshot.windows.fiveHour, warnBelow: 30)
                    Divider().frame(height: 92)
                    UsageMeter(title: "本周额度", window: snapshot.windows.sevenDay, warnBelow: 15)
                }
                Text("快照时间：\(observedTime(snapshot.observedAt)) · 绿色为剩余额度，不是实时余额")
                    .font(.system(size: 11)).foregroundStyle(.secondary)
                if snapshot.status != "available" {
                    Text("官方尚未提供可用窗口，或窗口已经重置。未知不是 0。")
                        .font(.system(size: 12)).foregroundStyle(.orange)
                }
            } else if let failure = model.usageFailures[account.id] {
                FailureBox(failure: failure)
            } else {
                Text(model.busy ? "正在读取本地快照…" : "尚未读取这个账号的本地快照。")
                    .font(.system(size: 12)).foregroundStyle(.secondary)
            }
            HStack(spacing: 10) {
                Button("启用官方状态栏快照") { model.configureUsage() }.disabled(!model.canEdit)
                Button("读取本地快照") { model.readUsageSnapshot() }.disabled(!model.canEdit)
                Spacer()
            }
            Text("启用会保留账号 settings.json 的其他设置，但不会覆盖已有的其他 statusLine 命令。大数字是剩余额度，小字是已用；没有数据时显示未知，不按 0 处理。")
                .font(.system(size: 11)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func observedTime(_ value: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date.formatted(date: .abbreviated, time: .standard) }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)?.formatted(date: .abbreviated, time: .standard) ?? value
    }
}

private struct NetworkCard: View {
    @ObservedObject var model: CenterModel
    var body: some View {
        SectionCard(title: "只读网络自查", symbol: "network") {
            Text("分别观察出口、路由与 IPv6、一次 DNS 解析器，以及需要单独打开的浏览器 WebRTC 页。")
                .font(.system(size: 12)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if let report = model.network {
                VStack(spacing: 12) {
                    layerRow(title: "出口地址", layer: report.egress, showsObservedIP: true)
                    layerRow(title: "路由与 IPv6", layer: report.routeIpv6)
                    layerRow(title: "单次 DNS 观察", layer: report.dns)
                    layerRow(title: "浏览器 WebRTC", layer: report.browserWebRTC)
                }
                if let checkedAt = model.networkCheckedAt {
                    Text("检查时间：\(checkedAt.formatted(date: .omitted, time: .standard)) · 只代表这次观察")
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                }
            } else {
                Text("尚未运行。只有点击下面的按钮后才会发起只读检查。")
                    .font(.system(size: 12)).foregroundStyle(.secondary)
            }
            Text("只有点击“开始只读检查”后才会连接第三方服务 api.ipify.org 和 1.1.1.1；WebRTC 页也仅在你再次点击后连接 Cloudflare STUN。")
                .font(.system(size: 11)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 10) {
                Button { model.checkNetwork() } label: { Label("开始只读检查", systemImage: "play.circle") }
                    .disabled(model.busy)
                Button("打开 WebRTC 检查页") { model.openWebRTC() }.disabled(model.busy)
                Spacer()
            }
            Text("不会修改 DNS、TUN 或代理。单次结果不证明所有连接都没有差异，也不代表账号状态；WebRTC 在浏览器页面里由你再次点击后才开始。")
                .font(.system(size: 11)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func layerRow(title: String, layer: NetworkLayer, showsObservedIP: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(title).font(.system(size: 12, weight: .medium))
                Spacer()
                StatusBadge(title: statusTitle(layer.status), color: statusColor(layer.status))
            }
            Text(reasonText(layer.reason)).font(.system(size: 11)).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if showsObservedIP, let ip = layer.observed?.ip {
                Text("观察到的出口 IP：\(ip)").font(.system(size: 11, design: .monospaced))
                    .textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func statusTitle(_ status: String) -> String {
        switch status {
        case "pass": return "本次完成"
        case "issue": return "需要查看"
        default: return "未验证"
        }
    }

    private func statusColor(_ status: String) -> Color {
        switch status {
        case "pass": return .green
        case "issue": return .orange
        default: return .secondary
        }
    }

    private func reasonText(_ reason: String) -> String {
        reason == "REQUIRES_BROWSER_TEST" ? "需要你在浏览器检查页中主动开始，应用不会代替浏览器验证。" : reason
    }
}

private struct ProjectsCard: View {
    @ObservedObject var model: CenterModel
    let account: Account
    var body: some View {
        SectionCard(title: "项目", symbol: "folder") {
            HStack(alignment: .top) {
                Text("选择后为当前账号记住上次项目。每个账号分别保存。")
                    .font(.system(size: 12)).foregroundStyle(.secondary)
                Spacer()
                if model.orcaAvailable {
                    Menu {
                        let remaining = model.orcaProjects.filter { item in
                            !model.projects.contains { $0.path == item.path }
                        }
                        if remaining.isEmpty {
                            Button("Orca 项目已全部添加") {}.disabled(true)
                        } else {
                            ForEach(remaining) { item in
                                Button(item.label) { model.addOrcaProject(item) }
                            }
                        }
                    } label: {
                        Label("从 Orca 添加", systemImage: "plus.rectangle.on.folder")
                    }.menuStyle(.borderedButton).disabled(!model.canEdit)
                }
                Button { model.pickProject() } label: { Label("添加目录", systemImage: "plus") }.disabled(!model.canEdit)
            }
            if let last = model.lastProject(for: account) {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("上次项目").font(.system(size: 11)).foregroundStyle(.secondary)
                        Text(last.label).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                    }
                    Spacer()
                    if model.isOrcaProject(last) {
                        Button("在 Orca 打开") { model.openProject(last, inOrca: true) }.disabled(!model.canUseCLI)
                    }
                    Button("再次打开上次项目") { model.openProject(last) }.disabled(!model.canUseCLI)
                }
                .padding(12).background(Palette.accent.opacity(0.07), in: RoundedRectangle(cornerRadius: 8))
            } else {
                Text("这个账号还没有选择过项目。").font(.system(size: 12)).foregroundStyle(.secondary)
            }
            if model.projects.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "folder.badge.plus").font(.system(size: 26)).foregroundStyle(.secondary)
                    Text("添加你的第一个项目目录").font(.system(size: 13, weight: .medium))
                    Text("使用系统文件选择器选择文件夹，不需要手填路径。").font(.system(size: 12)).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity).padding(.vertical, 18)
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(model.projects) { project in
                        projectRow(project)
                        if project.id != model.projects.last?.id { Divider().padding(.vertical, 8) }
                    }
                }
            }
            if model.orcaAvailable {
                Label("Orca 入口会新建一个固定使用当前账号配置目录的终端；已经运行的 Orca 终端不会被自动换号。", systemImage: "square.stack.3d.up")
                    .font(.system(size: 11)).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text("“已派发”只表示请求已交给终端。实际启动与登录结果，请以终端和官方状态检查为准。")
                .font(.system(size: 11)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func projectRow(_ project: Project) -> some View {
        HStack(spacing: 12) {
            Button { model.selectProject(project) } label: {
                HStack(spacing: 10) {
                    Image(systemName: account.lastProjectId == project.id ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(account.lastProjectId == project.id ? Palette.accent : Color.secondary)
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Text(project.label).font(.system(size: 13, weight: .medium)).foregroundStyle(.primary).lineLimit(1)
                            if model.isOrcaProject(project) {
                                Text("Orca").font(.system(size: 9, weight: .semibold))
                                    .padding(.horizontal, 5).padding(.vertical, 2)
                                    .foregroundStyle(Palette.accent).background(Palette.accentSoft, in: Capsule())
                            }
                        }
                        Text(project.path).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(2)
                            .truncationMode(.middle)
                    }
                    Spacer(minLength: 0)
                }.contentShape(Rectangle())
            }
            .buttonStyle(.plain).disabled(!model.canEdit)
            .help("为当前账号记住此项目：\(project.path)")
            .accessibilityLabel("选择项目 \(project.label)")
            if model.isOrcaProject(project) {
                Button("在 Orca 打开") { model.openProject(project, inOrca: true) }.disabled(!model.canUseCLI)
            }
            Button("在终端打开") { model.openProject(project) }.disabled(!model.canUseCLI)
            Button { model.removeProject(project) } label: { Image(systemName: "minus.circle") }
                .buttonStyle(.borderless).disabled(!model.canEdit)
                .help("从列表移除（不会删除文件夹）").accessibilityLabel("从列表移除 \(project.label)")
        }.padding(.vertical, 4)
    }
}

private struct CenterView: View {
    @StateObject private var model = CenterModel()
    @AppStorage("CCAC.completedIntroduction.v1") private var completedIntroduction = false
    @ViewState private var showingIntroduction = false
    @ViewState private var started = false

    var body: some View {
        HSplitView {
            sidebar.frame(minWidth: 210, idealWidth: 232, maxWidth: 250)
            VStack(spacing: 0) {
                header
                Divider()
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        if let failure = model.failure { FailureBox(failure: failure) }
                        if let notice = model.notice {
                            HStack(alignment: .top, spacing: 10) {
                                Image(systemName: "info.circle.fill").foregroundStyle(.blue)
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(notice.title).font(.system(size: 13, weight: .semibold))
                                    Text(notice.detail).font(.system(size: 12)).foregroundStyle(.secondary)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                                Spacer(minLength: 0)
                                Button { model.notice = nil } label: { Image(systemName: "xmark") }
                                    .buttonStyle(.plain).help("收起提示").accessibilityLabel("收起提示")
                            }.padding(12).background(Color.blue.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
                        }
                        if let account = model.account {
                            UsageCard(model: model, account: account)
                            GlobalCard(model: model, account: account)
                            AccountDetail(model: model, account: account)
                            ProjectsCard(model: model, account: account)
                        } else {
                            emptyAccounts
                        }
                        NetworkCard(model: model)
                        EnvironmentCard(model: model)
                    }
                    .padding(22).frame(maxWidth: 1_000).frame(maxWidth: .infinity)
                }
                Divider()
                HStack(spacing: 8) {
                    if model.busy { ProgressView().controlSize(.mini) }
                    Text(model.operation ?? (model.selectingDirectory ? "请选择项目目录…" : "非官方 · 本地账号、全局切换、官方额度快照、Orca 项目与只读网络自查"))
                        .font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
                    Spacer()
                }.padding(.horizontal, 20).padding(.vertical, 10)
            }.frame(minWidth: 560).background(Palette.canvas)
        }
        .frame(minWidth: 820, minHeight: 640)
        .tint(Palette.accent)
        .sheet(isPresented: $showingIntroduction) {
            WelcomeView(model: model) { completedIntroduction = true; showingIntroduction = false }
                .interactiveDismissDisabled(!completedIntroduction)
        }
        .sheet(isPresented: $model.showAddAccount) { AddAccountView(model: model) }
        .task {
            guard !started else { return }
            started = true
            showingIntroduction = !completedIntroduction
            model.refresh()
        }
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 9) {
                Image(systemName: "person.crop.rectangle.stack.fill").font(.system(size: 21)).foregroundStyle(Palette.accent)
                VStack(alignment: .leading, spacing: 3) {
                    Text("账号中心").font(.system(size: 16, weight: .semibold))
                    Text("Claude Code · 非官方").font(.system(size: 10)).foregroundStyle(.secondary)
                }
            }.padding(18)
            HStack {
                Text("本地账号").font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary)
                Spacer()
                Text("\(model.accounts.count)").font(.system(size: 11)).foregroundStyle(.secondary)
            }.padding(.horizontal, 18).padding(.bottom, 10)
            ScrollView {
                LazyVStack(spacing: 5) {
                    ForEach(model.accounts) { account in
                        let state = model.check(for: account.id)
                        let usage = model.usage[account.id]
                        Button { model.chooseAccount(account.id) } label: {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(account.label).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                HStack(spacing: 5) {
                                    StatusBadge(title: state.title, color: state.color)
                                    if model.isGlobal(account) { StatusBadge(title: "全局", color: Palette.accent) }
                                    if model.isDefault(account) { StatusBadge(title: "默认", color: .blue) }
                                }
                                if let usage, usage.status == "available" {
                                    HStack(spacing: 10) {
                                        SidebarQuota(title: "5小时·剩", window: usage.windows.fiveHour, warnBelow: 30)
                                        SidebarQuota(title: "本周·剩", window: usage.windows.sevenDay, warnBelow: 15)
                                    }
                                } else {
                                    Text("额度未知").font(.system(size: 10)).foregroundStyle(.secondary)
                                }
                            }
                            .padding(12).contentShape(Rectangle())
                            .background(model.selectedAccountID == account.id ? Palette.accentSoft : Color.clear,
                                        in: RoundedRectangle(cornerRadius: 10))
                            .overlay {
                                if model.selectedAccountID == account.id {
                                    RoundedRectangle(cornerRadius: 10).strokeBorder(Palette.accent.opacity(0.24))
                                }
                            }
                            .overlay(alignment: .leading) {
                                if model.selectedAccountID == account.id {
                                    RoundedRectangle(cornerRadius: 2).fill(Palette.accent)
                                        .frame(width: 3).padding(.vertical, 9)
                                }
                            }
                        }
                        .buttonStyle(.plain).disabled(model.busy).help(account.label)
                        .accessibilityLabel("\(account.label)，\(state.title)\(model.isGlobal(account) ? "，全局账号" : "")\(model.isDefault(account) ? "，默认账号" : "")")
                    }
                    if model.accounts.isEmpty {
                        Text(model.busy ? "正在读取账号…" : model.snapshotAvailable ? "还没有本地账号" : "账号列表暂不可用")
                            .font(.system(size: 12)).foregroundStyle(.secondary).padding(.vertical, 18)
                    }
                }.padding(.horizontal, 10)
            }
            Divider().padding(.horizontal, 14)
            Button { showAddAccount() } label: { Label("添加账号", systemImage: "plus").frame(maxWidth: .infinity) }
                .disabled(!model.canEdit).padding(14)
            Button("使用说明") { showingIntroduction = true }
                .buttonStyle(.plain).font(.system(size: 11)).foregroundStyle(.secondary)
                .padding(.horizontal, 18).padding(.bottom, 18)
        }.background(.ultraThinMaterial)
    }

    private var header: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("账号与项目").font(.system(size: 18, weight: .semibold))
                Text("选择账号，接着打开它的项目").font(.system(size: 12)).foregroundStyle(.secondary)
            }
            Spacer()
            Button { model.refresh() } label: { Label("刷新", systemImage: "arrow.clockwise") }
                .disabled(model.busy).keyboardShortcut("r", modifiers: .command)
                .help("刷新本地数据、环境、登录状态和本地额度快照")
        }.padding(.horizontal, 22).padding(.vertical, 16)
    }

    private var emptyAccounts: some View {
        SectionCard(title: "开始使用", symbol: "sparkles") {
            VStack(spacing: 12) {
                Image(systemName: "person.crop.circle.badge.plus").font(.system(size: 36)).foregroundStyle(Palette.accent)
                Text(model.snapshotAvailable ? "先添加一个本地账号" : model.busy ? "正在读取本地账号…" : "暂时无法读取账号")
                    .font(.system(size: 17, weight: .semibold))
                Text(model.snapshotAvailable ? "为账号起名，完成官方登录，再选择你的项目。" : "请查看错误提示并刷新，已有数据不会被替换。")
                    .font(.system(size: 12)).foregroundStyle(.secondary)
                Button("添加账号") { showAddAccount() }.buttonStyle(.borderedProminent).disabled(!model.canEdit)
            }.frame(maxWidth: .infinity).padding(.vertical, 24)
        }
    }

    private func showAddAccount() {
        model.failure = nil
        model.showAddAccount = true
    }
}

@main
struct AccountCenterApp: App {
    init() {
        // The smoke check still uses the exact bundled Swift -> Node -> JSON path.
        if ProcessInfo.processInfo.arguments.dropFirst() == ["--snapshot-smoke"] {
            do {
                let result = try CoreBridge.snapshot()
                FileHandle.standardOutput.write(Data((result + "\n").utf8))
                Darwin.exit(0)
            } catch {
                let failure = PublicFailure.safe(error)
                FileHandle.standardError.write(Data("Snapshot bridge check failed: \(failure.code).\n".utf8))
                Darwin.exit(1)
            }
        }
        NSApplication.shared.setActivationPolicy(.regular)
    }

    var body: some Scene {
        Window("Claude 账号中心", id: "account-center") { CenterView() }
            .defaultSize(width: 1_040, height: 780)
    }
}
