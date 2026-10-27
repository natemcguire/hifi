import AuthenticationServices
import CryptoKit
import SwiftUI

struct SpotifyPlaylist: Identifiable, Hashable {
    let id: String
    let name: String
    let detail: String
    var url: URL { URL(string: "https://open.spotify.com/playlist/\(id)")! }
}

// The listener's own Spotify account: sign in with PKCE (no secret in the app),
// heart songs into their Liked Songs, and list their playlists. Nate's Software's
// playlist always sits at the top of that list.
@MainActor
final class SpotifyAccount: NSObject, ObservableObject {
    static let shared = SpotifyAccount()

    @Published private(set) var isConnected = false
    @Published private(set) var playlists: [SpotifyPlaylist] = []
    @Published private(set) var natePlaylist: SpotifyPlaylist?
    @Published private(set) var liked: [String: Bool] = [:]  // Spotify track id → in Liked Songs
    @Published private(set) var problem: String?
    @Published var showConnect = false
    // Spotify lets HIFI's shared app sign in only a handful of listeners, so anyone
    // else can plug in a Spotify app of their own (Client ID only, PKCE, no secret).
    @Published private(set) var ownClientId = UserDefaults.standard.string(forKey: "spotifyClientId")
    @Published var showSetup = false

    static let redirect = "https://nates-software.com/hifi/spotify/callback"
    private static let scopes = "user-library-read user-library-modify playlist-read-private playlist-read-collaborative"
    private var sharedClientId: String?
    private var clientId: String? { ownClientId ?? sharedClientId }
    private var access: (token: String, expires: Date)?
    private var session: ASWebAuthenticationSession?
    private var pending: (state: String, verifier: String)?  // the sign-in in progress
    private var trackIds: [String: String] = [:]  // "artist\ntitle" → id found by search

    override init() {
        super.init()
        isConnected = Keychain.read() != nil
        Task { await loadConfig() }
    }

    // MARK: Sign in

    func connect() {
        Task {
            await loadConfig()
            guard let clientId else { return fail("Spotify isn't reachable right now. Try again in a minute.") }
            showSetup = false
            let verifier = Self.random(48), state = "app." + Self.random(24)
            pending = (state, verifier)
            var authorize = URLComponents(string: "https://accounts.spotify.com/authorize")!
            authorize.queryItems = [
                .init(name: "client_id", value: clientId), .init(name: "response_type", value: "code"),
                .init(name: "redirect_uri", value: Self.redirect), .init(name: "scope", value: Self.scopes),
                .init(name: "state", value: state), .init(name: "code_challenge_method", value: "S256"),
                .init(name: "code_challenge", value: Self.base64url(Data(SHA256.hash(data: Data(verifier.utf8))))),
            ]
            let session = ASWebAuthenticationSession(url: authorize.url!, callback: .customScheme("nswhifi")) { [weak self] url, error in
                Task { @MainActor in await self?.finish(url, error: error, state: state, verifier: verifier) }
            }
            session.presentationContextProvider = self
            self.session = session
            session.start()
        }
    }

    // Chrome, as the Mac's sign-in browser, can open nswhifi:// as an ordinary link
    // instead of handing it to the sign-in session, so the app finishes it here.
    func handle(_ url: URL) {
        guard url.scheme == "nswhifi", url.host == "spotify", let pending else { return }
        session?.cancel()
        Task { await finish(url, error: nil, state: pending.state, verifier: pending.verifier) }
    }

    private func finish(_ url: URL?, error: Error?, state: String, verifier: String) async {
        if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
            return
        }
        guard pending?.state == state else { return }  // already finished
        session = nil
        pending = nil
        let items = URLComponents(url: url ?? URL(string: "x:")!, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let value = { (name: String) in items.first { $0.name == name }?.value }
        guard value("state") == state, let code = value("code") else {
            return fail(value("error") == "access_denied" ? "Spotify wasn't connected." : "Spotify sign-in didn't finish. Try again.")
        }
        guard let tokens = await token(["grant_type": "authorization_code", "code": code, "redirect_uri": Self.redirect, "code_verifier": verifier]) else {
            return fail("Spotify sign-in didn't finish. Try again.")
        }
        store(tokens)
        problem = nil
        showConnect = false
        await refreshPlaylists()
    }

    func disconnect() {
        Keychain.delete()
        access = nil
        isConnected = false
        playlists = []
        liked = [:]
    }

    // A refresh token only works with the app that issued it, so switching apps signs out.
    func useOwnApp(_ id: String?) {
        let id = id?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard id != ownClientId else { return }
        disconnect()
        ownClientId = id
        UserDefaults.standard.set(id, forKey: "spotifyClientId")
    }

    static func isClientId(_ text: String) -> Bool {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.count == 32 && text.allSatisfy(\.isHexDigit)
    }

    // MARK: Heart

    // Adds or removes the song from the listener's Liked Songs. Without an
    // account yet, the heart opens the sign-in screen instead.
    func toggleHeart(trackId: String?, artist: String, title: String) {
        guard isConnected else { showConnect = true; return }
        Task {
            guard let id = await resolve(trackId: trackId, artist: artist, title: title) else { return fail("Couldn't find this song on Spotify.") }
            let save = !(liked[id] ?? false)
            liked[id] = save  // show it right away; undo if Spotify says no
            let ok = await call(save ? "PUT" : "DELETE", "/me/tracks?ids=\(id)") != nil
            if !ok { liked[id] = !save; fail("Spotify didn't save that. Try again.") }
        }
    }

    func isLiked(trackId: String?, artist: String, title: String) -> Bool {
        guard let id = trackId ?? trackIds[artist + "\n" + title] else { return false }
        return liked[id] ?? false
    }

    // Looks up whether the current song is already liked, so the heart starts filled.
    func check(trackId: String?, artist: String, title: String) async {
        guard isConnected, let id = await resolve(trackId: trackId, artist: artist, title: title), liked[id] == nil,
              let data = await call("GET", "/me/tracks/contains?ids=\(id)"),
              let result = try? JSONDecoder().decode([Bool].self, from: data), let saved = result.first else { return }
        liked[id] = saved
    }

    private func resolve(trackId: String?, artist: String, title: String) async -> String? {
        if let trackId { return trackId }
        let key = artist + "\n" + title
        if let known = trackIds[key] { return known }
        let query = "track:\(title) artist:\(artist)".addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        struct Search: Decodable { struct Tracks: Decodable { struct Item: Decodable { let id: String }; let items: [Item] }; let tracks: Tracks }
        guard let data = await call("GET", "/search?type=track&limit=1&q=\(query)"),
              let id = (try? JSONDecoder().decode(Search.self, from: data))?.tracks.items.first?.id else { return nil }
        trackIds[key] = id
        return id
    }

    // MARK: Playlists

    func refreshPlaylists() async {
        await loadConfig()
        guard isConnected else { playlists = []; return }
        struct Page: Decodable {
            struct Item: Decodable { struct Tracks: Decodable { let total: Int? }; let id: String; let name: String; let tracks: Tracks?; let items: Tracks? }
            let items: [Item?]
        }
        guard let data = await call("GET", "/me/playlists?limit=50"), let page = try? JSONDecoder().decode(Page.self, from: data) else { return }
        playlists = page.items.compactMap { $0 }.filter { $0.id != natePlaylist?.id }.map {
            let count = $0.tracks?.total ?? $0.items?.total
            return SpotifyPlaylist(id: $0.id, name: $0.name, detail: count.map { "\($0) songs" } ?? "Playlist")
        }
    }

    // MARK: Spotify Web API

    private func call(_ method: String, _ path: String) async -> Data? {
        guard let token = await accessToken() else { return nil }
        var request = URLRequest(url: URL(string: "https://api.spotify.com/v1" + path)!)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if method == "PUT" { request.httpBody = Data(); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let status = (response as? HTTPURLResponse)?.statusCode else { return nil }
        if status == 401 { access = nil }
        // Signed in, but this account isn't on the shared app's Spotify list.
        if status == 403, ownClientId == nil, String(decoding: data, as: UTF8.self).contains("registered") {
            showSetup = true
            showConnect = true
        }
        return (200..<300).contains(status) ? data : nil
    }

    private func accessToken() async -> String? {
        if let access, access.expires > .now { return access.token }
        guard let refresh = Keychain.read() else { isConnected = false; return nil }
        guard let tokens = await token(["grant_type": "refresh_token", "refresh_token": refresh]) else { return nil }
        store(tokens)
        return access?.token
    }

    private struct Tokens: Decodable { let access_token: String; let refresh_token: String?; let expires_in: Double? }

    private func token(_ form: [String: String]) async -> Tokens? {
        guard let clientId else { return nil }
        var request = URLRequest(url: URL(string: "https://accounts.spotify.com/api/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var body = URLComponents()
        body.queryItems = (form.merging(["client_id": clientId]) { a, _ in a }).map { URLQueryItem(name: $0.key, value: $0.value) }
        request.httpBody = body.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B").data(using: .utf8)
        guard let (data, response) = try? await URLSession.shared.data(for: request) else { return nil }
        if (response as? HTTPURLResponse)?.statusCode == 400, form["grant_type"] == "refresh_token" { disconnect() }  // revoked
        return try? JSONDecoder().decode(Tokens.self, from: data)
    }

    private func store(_ tokens: Tokens) {
        access = (tokens.access_token, .now + (tokens.expires_in ?? 3600) - 60)
        if let refresh = tokens.refresh_token { Keychain.write(refresh) }  // PKCE refresh tokens rotate
        isConnected = true
    }

    // The client ID and Nate's playlist come from nates-software.com, so neither is baked in.
    private func loadConfig() async {
        guard sharedClientId == nil || natePlaylist == nil else { return }
        struct Config: Decodable { let playlist: String?; let clientId: String? }
        guard let (data, _) = try? await URLSession.shared.data(from: URL(string: "https://nates-software.com/api/hifi-spotify")!),
              let config = try? JSONDecoder().decode(Config.self, from: data) else { return }
        sharedClientId = config.clientId
        if let id = config.playlist?.split(separator: "/").last.map(String.init) {
            natePlaylist = SpotifyPlaylist(id: id, name: "Nate's Software HIFI", detail: "Picked from HIFI")
        }
    }

    private func fail(_ message: String) {
        problem = message
        Task {
            try? await Task.sleep(for: .seconds(3))
            if problem == message { problem = nil }
        }
    }

    private static func random(_ bytes: Int) -> String {
        base64url(Data((0..<bytes).map { _ in UInt8.random(in: 0...255) }))
    }

    private static func base64url(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

extension SpotifyAccount: ASWebAuthenticationPresentationContextProviding {
    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            #if os(iOS)
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            return scenes.flatMap(\.windows).first { $0.isKeyWindow } ?? ASPresentationAnchor()
            #else
            return NSApplication.shared.keyWindow ?? ASPresentationAnchor()
            #endif
        }
    }
}

// The refresh token, kept in this device's Keychain only.
private enum Keychain {
    private static let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                               kSecAttrService as String: "com.natesoftware.hifi.spotify",
                                               kSecAttrAccount as String: "refresh"]

    static func read() -> String? {
        var item: CFTypeRef?
        var search = query
        search[kSecReturnData as String] = true
        guard SecItemCopyMatching(search as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func write(_ value: String) {
        delete()
        var item = query
        item[kSecValueData as String] = Data(value.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(item as CFDictionary, nil)
    }

    static func delete() { SecItemDelete(query as CFDictionary) }
}

// MARK: Connect screen

// A big white page before Spotify's own sign-in: what connecting does, one button.
struct SpotifyConnectView: View {
    @ObservedObject var spotify: SpotifyAccount
    @State private var beat = false

    var body: some View {
        ZStack {
            Color.white.ignoresSafeArea()
            if spotify.showSetup {
                SpotifyOwnAppView(spotify: spotify)
            } else {
                intro
            }
        }
        .preferredColorScheme(.light)
    }

    private var intro: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 24)
            ZStack {
                Circle().fill(Color(hex: "#e5484d").opacity(0.10)).frame(width: 172, height: 172)
                    .scaleEffect(beat ? 1.06 : 0.94)
                Circle().fill(Color(hex: "#e5484d").opacity(0.16)).frame(width: 124, height: 124)
                Image(systemName: "heart.fill")
                    .font(.system(size: 62, weight: .bold))
                    .foregroundStyle(Color(hex: "#e5484d"))
                    .scaleEffect(beat ? 1.08 : 1)
            }
            .animation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: beat)
            .onAppear { beat = true }
            .padding(.bottom, 30)
            Text("Keep the songs you love")
                .font(.system(size: 32, weight: .heavy))
                .multilineTextAlignment(.center)
                .padding(.bottom, 12)
            (Text("Connect Spotify and every ") + Text("♥").foregroundColor(Color(hex: "#e5484d")) + Text(" in HIFI lands in your Liked Songs."))
                .font(.system(size: 17))
                .foregroundStyle(Color(hex: "#555"))
                .multilineTextAlignment(.center)
                .padding(.bottom, 28)
            VStack(alignment: .leading, spacing: 14) {
                perk("heart.fill", "Heart a song on the radio, it's saved")
                perk("music.note.list", "Your playlists, right on the click wheel")
                perk("sparkles", "Nate's Software HIFI playlist up top")
            }
            .frame(maxWidth: 380, alignment: .leading)
            Spacer(minLength: 28)
            Button { spotify.connect() } label: {
                Label("Connect Spotify", systemImage: "waveform")
                    .font(.system(size: 19, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: 380, minHeight: 58)
                    .background(Capsule().fill(Color(hex: "#1db954")))
                    .shadow(color: Color(hex: "#1db954").opacity(0.35), radius: 14, y: 6)
            }
            .buttonStyle(.plain)
            .keyboardShortcut(.defaultAction)
            if let problem = spotify.problem {
                Text(problem).font(.system(size: 15)).foregroundStyle(.orange)
                    .multilineTextAlignment(.center).padding(.top, 12)
            }
            Button("Not now") { spotify.showConnect = false }
                .buttonStyle(.plain)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Color(hex: "#555"))
                .padding(.top, 18)
            Text("Free, no ads. HIFI never sees your Spotify password, and you can disconnect any time in Settings.")
                .font(.system(size: 13))
                .foregroundStyle(Color(hex: "#999"))
                .multilineTextAlignment(.center)
                .frame(maxWidth: 380)
                .padding(.top, 18)
            Button(spotify.ownClientId == nil ? "Use your own Spotify app" : "Using your own Spotify app") { spotify.showSetup = true }
                .buttonStyle(.plain)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color(hex: "#1db954"))
                .padding(.top, 8).padding(.bottom, 20)
        }
        .foregroundStyle(Color(hex: "#111"))
        .padding(.horizontal, 28)
    }

    private func perk(_ icon: String, _ text: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Color(hex: "#e5484d"))
                .frame(width: 34, height: 34)
                .background(Circle().fill(Color(hex: "#e5484d").opacity(0.10)))
            Text(text).font(.system(size: 16, weight: .medium)).foregroundStyle(Color(hex: "#333"))
        }
    }
}

// Spotify's own steps for making a free app in its developer dashboard, then a
// field for its Client ID. HIFI signs in through that app from then on.
struct SpotifyOwnAppView: View {
    @ObservedObject var spotify: SpotifyAccount
    @State private var clientId = ""
    @State private var copied = false
    @Environment(\.openURL) private var openURL

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("Use your own Spotify app")
                    .font(.system(size: 28, weight: .heavy))
                    .padding(.bottom, 10)
                Text("Spotify lets HIFI's app sign in only a few listeners. Make your own free Spotify app and HIFI connects through it instead. It takes two minutes and needs Spotify Premium.")
                    .font(.system(size: 16))
                    .foregroundStyle(Color(hex: "#555"))
                    .padding(.bottom, 24)
                step(1, "Open Spotify's developer dashboard and press Create app.") {
                    pill("Open dashboard", icon: "arrow.up.right") { openURL(URL(string: "https://developer.spotify.com/dashboard/create")!) }
                }
                step(2, "Name it anything. Under Redirect URIs, add this address:") {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(SpotifyAccount.redirect)
                            .font(.system(size: 14, design: .monospaced))
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                        pill(copied ? "Copied" : "Copy", icon: copied ? "checkmark" : "doc.on.doc") { copy(SpotifyAccount.redirect) }
                    }
                }
                step(3, "Tick Web API, agree to the terms and press Save.") { EmptyView() }
                step(4, "Copy the Client ID from your app's page and paste it here. Never the Client Secret.") {
                    TextField("Client ID", text: $clientId)
                        .font(.system(size: 15, design: .monospaced))
                        .textFieldStyle(.plain)
                        .autocorrectionDisabled()
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        #endif
                        .padding(12)
                        .background(RoundedRectangle(cornerRadius: 10).fill(Color(hex: "#f2f2f4")))
                }
                Button { spotify.useOwnApp(clientId); spotify.connect() } label: {
                    Label("Connect with my app", systemImage: "waveform")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 54)
                        .background(Capsule().fill(Color(hex: "#1db954")))
                }
                .buttonStyle(.plain)
                .keyboardShortcut(.defaultAction)
                .disabled(!SpotifyAccount.isClientId(clientId))
                .opacity(SpotifyAccount.isClientId(clientId) ? 1 : 0.4)
                .padding(.top, 8)
                if let problem = spotify.problem {
                    Text(problem).font(.system(size: 15)).foregroundStyle(.orange).padding(.top, 12)
                }
                HStack {
                    Button("Back") { spotify.showSetup = false }
                    Spacer()
                    if spotify.ownClientId != nil {
                        Button("Use HIFI's app again") { spotify.useOwnApp(nil); spotify.showSetup = false }
                    }
                }
                .buttonStyle(.plain)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color(hex: "#555"))
                .padding(.top, 20)
            }
            .foregroundStyle(Color(hex: "#111"))
            .frame(maxWidth: 440)
            .padding(.horizontal, 28).padding(.vertical, 32)
            .frame(maxWidth: .infinity)
        }
        .onAppear { clientId = spotify.ownClientId ?? "" }
    }

    private func step<Content: View>(_ number: Int, _ text: String, @ViewBuilder _ content: () -> Content) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Text("\(number)")
                .font(.system(size: 14, weight: .heavy))
                .foregroundStyle(.white)
                .frame(width: 28, height: 28)
                .background(Circle().fill(Color(hex: "#1db954")))
            VStack(alignment: .leading, spacing: 10) {
                Text(text).font(.system(size: 16, weight: .medium)).foregroundStyle(Color(hex: "#333"))
                    .fixedSize(horizontal: false, vertical: true)
                content()
            }
        }
        .padding(.bottom, 22)
    }

    private func pill(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color(hex: "#1db954"))
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(Capsule().fill(Color(hex: "#1db954").opacity(0.12)))
        }
        .buttonStyle(.plain)
    }

    private func copy(_ text: String) {
        #if os(iOS)
        UIPasteboard.general.string = text
        #else
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #endif
        copied = true
    }
}
