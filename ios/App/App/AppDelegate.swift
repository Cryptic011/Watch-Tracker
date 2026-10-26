import UIKit
import Capacitor
import UserNotifications
import CryptoKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    var window: UIWindow?
    static var pendingNotification: [String: String]?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
        configuration.delegateClass = SceneDelegate.self
        return configuration
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .list])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        if let item = info["itemId"] as? String, let account = info["accountId"] as? String {
            DispatchQueue.main.async {
                Self.pendingNotification = ["itemId": item, "accountId": account]
                NotificationCenter.default.post(name: .watchLogNotification, object: nil)
            }
        }
        completionHandler()
    }
}

extension Notification.Name {
    static let watchLogNotification = Notification.Name("WatchLogNotification")
}

class WatchLogViewController: CAPBridgeViewController {
    private var observers: [NSObjectProtocol] = []
    private let controls = WatchLogControls()

    override func viewDidLoad() {
        super.viewDidLoad()
        guard let webView else { return }
        // Web content and controls are siblings. Only the web content scrolls.
        let host = UIView()
        host.backgroundColor = .systemBackground
        view = host
        webView.translatesAutoresizingMaskIntoConstraints = false
        host.addSubview(webView)
        controls.translatesAutoresizingMaskIntoConstraints = false
        host.addSubview(controls)
        controls.isHidden = true
        controls.action = { [weak self] action in
            guard ["library", "settings", "search"].contains(action) else { return }
            self?.webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('watchlog:native-control',{detail:'\(action)'}))", completionHandler: nil)
        }
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: host.leadingAnchor), webView.trailingAnchor.constraint(equalTo: host.trailingAnchor),
            webView.topAnchor.constraint(equalTo: host.topAnchor), webView.bottomAnchor.constraint(equalTo: host.bottomAnchor),
            controls.leadingAnchor.constraint(equalTo: host.safeAreaLayoutGuide.leadingAnchor),
            controls.trailingAnchor.constraint(equalTo: host.safeAreaLayoutGuide.trailingAnchor),
            controls.bottomAnchor.constraint(equalTo: host.keyboardLayoutGuide.topAnchor),
            controls.heightAnchor.constraint(equalToConstant: 78)
        ])
    }

    func updateControls(visible: Bool, tab: String, searchVisible: Bool, dark: Bool) {
        controls.isHidden = !visible
        controls.update(tab: tab, searchVisible: searchVisible, dark: dark)
    }
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(WatchLogNativePlugin())
        observers.append(NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.webView?.evaluateJavaScript("window.dispatchEvent(new Event('watchlog:native-active'))", completionHandler: nil)
            if #available(iOS 16.0, *) { UNUserNotificationCenter.current().setBadgeCount(0) }
        })
        observers.append(NotificationCenter.default.addObserver(forName: .watchLogNotification, object: nil, queue: .main) { [weak self] _ in
            self?.webView?.evaluateJavaScript("window.dispatchEvent(new Event('watchlog:native-notification'))", completionHandler: nil)
        })
    }
    deinit { observers.forEach(NotificationCenter.default.removeObserver) }
}

@objc(WatchLogNativePlugin)
class WatchLogNativePlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "WatchLogNativePlugin"
    let jsName = "WatchLogNative"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "replaceReminders", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelReminders", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "testReminder", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareBackup", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeNotification", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateControls", returnType: CAPPluginReturnPromise)
    ]
    private var queue: Task<Void, Never>?
    private let prefix = "watchlog."

    @objc func updateControls(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let controller = self.bridge?.viewController as? WatchLogViewController else { call.resolve(["ready": false]); return }
            controller.updateControls(visible: call.getBool("visible") ?? false, tab: call.getString("tab") ?? "library", searchVisible: call.getBool("searchVisible") ?? false, dark: call.getBool("dark") ?? false)
            call.resolve(["ready": true])
        }
    }

    private func permission(_ settings: UNNotificationSettings) -> String {
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral: return "granted"
        case .denied: return "denied"
        default: return "prompt"
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            call.resolve(["permission": self.permission(settings)])
        }
    }

    @objc func takeNotification(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(AppDelegate.pendingNotification ?? [:])
            AppDelegate.pendingNotification = nil
        }
    }

    @objc func requestPermission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, error in
            if let error { call.reject(error.localizedDescription); return }
            self.status(call)
        }
    }

    private func enqueue(_ operation: @escaping () async -> Void) {
        // Complete replacements in order so an older call cannot restore a
        // previous account's reminders after logout or account switching.
        let previous = queue
        queue = Task { await previous?.value; await operation() }
    }

    @objc func replaceReminders(_ call: CAPPluginCall) {
        guard let rows = call.getArray("requests", JSObject.self), rows.count <= 60 else { call.reject("Invalid reminder schedule."); return }
        var requests: [UNNotificationRequest] = []
        for row in rows {
            guard let id = row["id"] as? String, id.count <= 2048,
                  let at = row["at"] as? Double, at.isFinite,
                  let title = row["title"] as? String,
                  let body = row["body"] as? String,
                  let item = row["itemId"] as? String,
                  let account = row["accountId"] as? String else { call.reject("Invalid reminder."); return }
            let interval = at / 1000 - Date().timeIntervalSince1970
            guard interval > 1 else { continue }
            let content = UNMutableNotificationContent()
            content.title = String(title.prefix(200)); content.body = String(body.prefix(500)); content.sound = .default
            content.userInfo = ["itemId": item, "accountId": account]
            content.threadIdentifier = "watched-tracker-releases"
            let digest = SHA256.hash(data: Data(id.utf8)).map { String(format: "%02x", $0) }.joined()
            requests.append(UNNotificationRequest(identifier: prefix + digest, content: content, trigger: UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false)))
        }
        enqueue {
            let center = UNUserNotificationCenter.current()
            let settings = await center.notificationSettings()
            guard self.permission(settings) == "granted" else { call.reject("Enable iPhone notifications first."); return }
            let pending = await center.pendingNotificationRequests()
            center.removePendingNotificationRequests(withIdentifiers: pending.filter { $0.identifier.hasPrefix(self.prefix) }.map(\.identifier))
            do {
                for request in requests { try await center.add(request) }
                call.resolve(["count": requests.count])
            } catch {
                center.removePendingNotificationRequests(withIdentifiers: requests.map(\.identifier))
                call.reject("Could not schedule reminders: " + error.localizedDescription)
            }
        }
    }

    @objc func cancelReminders(_ call: CAPPluginCall) {
        enqueue {
            let center = UNUserNotificationCenter.current()
            let pending = await center.pendingNotificationRequests()
            center.removePendingNotificationRequests(withIdentifiers: pending.filter { $0.identifier.hasPrefix(self.prefix) }.map(\.identifier))
            let delivered = await center.deliveredNotifications()
            center.removeDeliveredNotifications(withIdentifiers: delivered.map(\.request.identifier).filter { $0.hasPrefix(self.prefix) })
            call.resolve()
        }
    }

    @objc func testReminder(_ call: CAPPluginCall) {
        enqueue {
            let center = UNUserNotificationCenter.current()
            guard self.permission(await center.notificationSettings()) == "granted" else { call.reject("Enable iPhone notifications first."); return }
            let content = UNMutableNotificationContent()
            content.title = "Test reminder"; content.body = "Watched Tracker notifications are connected on this iPhone."; content.sound = .default
            do {
                try await center.add(UNNotificationRequest(identifier: self.prefix + "test", content: content, trigger: UNTimeIntervalNotificationTrigger(timeInterval: 2, repeats: false)))
                call.resolve()
            } catch { call.reject(error.localizedDescription) }
        }
    }

    @objc func shareBackup(_ call: CAPPluginCall) {
        guard let text = call.getString("text"), text.utf8.count <= 20_000_000,
              let data = text.data(using: .utf8),
              let backup = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              backup["format"] as? String == "watchlog-library-backup" else { call.reject("Invalid library backup."); return }
        DispatchQueue.main.async {
            do {
                let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                let url = folder.appendingPathComponent("Watched-Tracker-backup.json")
                try data.write(to: url, options: [.atomic, .completeFileProtection])
                let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
                sheet.completionWithItemsHandler = { _, _, _, _ in try? FileManager.default.removeItem(at: folder) }
                guard let viewController = self.bridge?.viewController else { call.reject("Sharing is unavailable."); try? FileManager.default.removeItem(at: folder); return }
                sheet.popoverPresentationController?.sourceView = viewController.view
                sheet.popoverPresentationController?.sourceRect = CGRect(x: viewController.view.bounds.midX, y: viewController.view.bounds.midY, width: 1, height: 1)
                viewController.present(sheet, animated: true) { call.resolve() }
            } catch { call.reject(error.localizedDescription) }
        }
    }
}
