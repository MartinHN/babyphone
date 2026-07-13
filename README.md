# Mic Stream (LAN, WebRTC)

Streams a microphone from any device to any other device's browser over your local network. Audio flows peer-to-peer via WebRTC — the Node server only handles the initial handshake (signaling) and runs on whichever device you choose (it doesn't have to be a broadcaster or listener itself).

## Setup (one time)

Requires [Node.js](https://nodejs.org) installed on whichever device will run the relay server.

```bash
cd mic-stream
npm install
```

## Run

```bash
npm start
```

The first time you run it, it generates a self-signed HTTPS certificate covering `localhost` and the current LAN IP(s) of the device running it, saved to `certs/` (so it's reused on future runs — delete that folder to regenerate, e.g. if that device's IP changes). You'll see output like:

```
Mic Stream server running on port 3000 (HTTPS)
Open: https://192.168.1.42:3000/app.html (pick Broadcast or Listen in-app)
```

Open that URL on **any device** — you'll get a mode picker:

1. Tap **📢 Broadcast my mic** to give this device a name and start broadcasting, or **🎧 Listen to a broadcast** to pick a broadcaster from the list and listen. Use **← Change mode** at the top to switch.
2. The browser will show a certificate warning the first time (self-signed cert) — tap "Advanced" → "Proceed" (wording varies by browser). You only need to do this once per browser.
3. Audio should start playing within a second or two, with roughly 100–300ms latency on a LAN.

Multiple devices can broadcast and multiple devices can listen at the same time — see "Any device can broadcast, any device can listen" below for details. (`broadcaster.html`/`listener.html` still work as redirects to `app.html?mode=broadcast`/`?mode=listen`, kept for any old bookmarks/home-screen icons.)

### Why HTTPS?

Service workers, the Notification API, and the "Install App" prompt all require a **secure context**. Plain `http://` on a LAN IP does *not* count as one — only `https://` or `localhost` do. Without HTTPS, the install button silently never appears and background notifications don't work, with no error shown. That's the reason for the self-signed cert setup above.

If you'd rather skip the certificate-warning step entirely, an alternative on Android Chrome is: go to `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, add `http://<relay-server-ip>:3000`, and relaunch Chrome — this tells Chrome to treat that specific origin as secure without HTTPS. This only affects that one Chrome install, though, so the HTTPS approach above is better if you'll use this from multiple devices/browsers.

## Hosting on GitHub Pages

You can host the whole app (`docs/app.html`, both broadcast and listen modes) on GitHub Pages, so its install prompt and service worker use a properly trusted certificate instead of the self-signed one — no cert warning for the app itself, from either device.

**What this does and doesn't remove:** GitHub Pages solves installability/service-worker trust for the *page*. It does **not** remove the need for HTTPS on your *relay server* — the page still opens a WebSocket back to it, and browsers block plain `ws://` from an `https://` page (mixed content), so that connection is still `wss://` against the relay server's self-signed cert. You'll still need to accept that cert once, just directly rather than through the app.

**Setup:**

1. Push the contents of the `docs/` folder (in this project) to a GitHub repo — either to a branch named `gh-pages`, or to `main` with Pages configured to serve from `/docs`.
2. In the repo's Settings → Pages, set the source accordingly. You'll get a URL like `https://yourusername.github.io/mic-stream/`.
3. Run `npm start` on whichever device is your relay server — note the LAN address it prints (e.g. `192.168.1.42:3000`).
4. On each device you'll use (broadcasting or listening), open `https://192.168.1.42:3000` (the relay server's actual LAN address) directly in the browser once, and accept the certificate warning. You only need to do this once per browser/network.
5. Now open your GitHub Pages URL on each device. Enter the relay server's `address:port` (e.g. `192.168.1.42:3000`) in the "Relay server address" field — it's remembered from then on via `localStorage`. Pick Broadcast or Listen.
6. Install the app on each device. The install prompt should now appear cleanly since `github.io` has a trusted cert.

Note the relay server's LAN IP can change (new network, DHCP lease renewal, etc.) — if it does, just update the address field.

## Notes

- A free public STUN server is used by default (good enough for LAN and many home NATs); add `TURN_URLS`/`TURN_USERNAME`/`TURN_CREDENTIAL` env vars for reliable internet connectivity behind stricter NATs — see "Running the relay on the internet" below.
- If a listener can't reach the relay server, check that device's firewall allows inbound connections on the port in use.
- Multiple broadcasters and multiple listeners can be connected simultaneously; each broadcaster/listener pair gets its own peer connection.
- To change the port: `PORT=4000 npm start`.
- Some mobile browsers (iOS Safari in particular) require the page to be opened over **https** or **localhost** for `getUserMedia` — already satisfied here since the relay server serves everything over HTTPS (or is meant to sit behind one in `TRUST_PROXY` mode).

## PWA / background playback (listen mode)

`app.html` is an installable PWA (`manifest.json` + `sw.js`, shared by both modes) with, in listen mode:

- **Media Session API** integration — shows lock-screen/notification-shade playback controls and marks the tab as "playing media" to the OS/browser, which is what lets some browsers keep it running when the app is backgrounded.
- **Wake Lock** toggle — keeps the screen from sleeping while listening. This is the most *reliable* cross-platform way to guarantee uninterrupted playback, since it keeps the page fully foregrounded.
- **Auto-reconnect** — if the WebRTC connection or signaling socket drops (common right after backgrounding/foregrounding), the listener automatically retries with backoff, and also retries immediately when the tab becomes visible again.

**Install it:** open `app.html` on the phone, tap **Install App** (Android Chrome) or use Share → **Add to Home Screen** (iOS Safari), then launch it from the home screen icon.

**Realistic expectations by platform:**

| Platform | Behavior |
|---|---|
| **Android Chrome** | Generally keeps actively-playing audio running when you switch apps or lock the screen, especially once installed as a PWA with Media Session set. This is the same mechanism that lets web-based music/radio players work in the background. |
| **iOS Safari / installed PWA** | Much stricter. iOS suspends most background web page execution, including live WebRTC connections, typically within seconds to a couple minutes of backgrounding — Media Session helps but does not fully solve this. The **wake lock / keep-screen-on** option is the dependable workaround here: as long as the screen stays on and the app is frontmost, it keeps streaming. |

If you need guaranteed, indefinite background audio on iOS specifically, that generally requires a native app using `AVAudioSession` background modes — no web/PWA technique gets fully reliable background WebRTC audio there today.

## RMS level meter

In listen mode, the app shows a big segmented level meter (green → yellow → red) below the audio element, with a live dB readout and a white peak-hold marker. It's driven by a Web Audio `AnalyserNode` tapped off the incoming stream in parallel with the `<audio>` element — it doesn't affect playback, just visualizes it. The meter automatically resets when the connection drops/reconnects.

## Notification bar status

Chrome's automatic "Now Playing" media notification is unreliable for live WebRTC audio (it depends on Chrome detecting the `<audio>` element as "audible," which doesn't always trigger consistently, especially for installed PWAs). To work around this, listen mode explicitly requests notification permission on connect and posts its own persistent notification ("Mic Stream — live") with a **Stop** action, via the service worker. This is what shows up in your notification shade — make sure to allow the permission prompt when you tap Connect.

## Connection-lost alert

If the connection drops unexpectedly while listening (toggle above, on by default), you get two layers of alert, fired once per drop (not repeated on every retry):

- An **audible two-tone beep** played directly in the page — works whenever the app is foregrounded.
- A **vibrating, non-silent notification** ("⚠️ Mic Stream — connection lost") — this is the one that reaches you when the app is backgrounded or the screen is off, since page JS/audio can't run reliably then.

It clears itself automatically once the stream reconnects and audio resumes.

## Faster failure detection

Auto-reconnect used to feel much slower than a manual page reload. That's because a dead connection can go undetected for a long time by default — a closed socket doesn't always fire a `close` event promptly (mobile network switches, sleep/wake, NAT timeouts), and WebRTC's own "disconnected"/"failed" states can take many seconds to trigger. A manual reload just tears everything down instantly, which is why it felt faster.

Two watchdogs now catch this quickly instead of waiting on those slow defaults:

- **Signaling heartbeat** — the listener pings the server every 4s and expects a pong back; the server also pings every 10s and drops any socket that doesn't answer. If no pong arrives within ~9s, the listener treats the socket as dead and reconnects immediately, rather than waiting on TCP-level timeouts.
- **Audio stall watchdog** — polls `RTCPeerConnection.getStats()` every 3s once live; if no new audio bytes arrive for ~6s despite the connection still reporting "connected" (a one-sided network failure), it forces a reconnect.

The backoff between reconnect attempts is also tighter now (starts at 500ms, caps at 5s, vs. 1s–10s before), since on a LAN a fresh attempt should succeed quickly once a drop is actually detected.

## Any device can broadcast, any device can listen

The relay server (`server.js`) tracks any number of broadcasters at once, each with a name, and listeners pick which one to connect to:

- **Broadcasting:** open `app.html` on any device, pick **📢 Broadcast my mic**, give it a name (remembered per-device via `localStorage`, defaults to something sensible based on the device type), and tap **Start Broadcasting Mic**. Multiple devices can broadcast simultaneously.
- **Listening:** open `app.html` on any device, pick **🎧 Listen to a broadcast**, tap **Connect**, and you'll see a list of currently active broadcasters to choose from, with a **Refresh** button. Multiple listeners can tune into the same or different broadcasters.
- If your currently-selected broadcaster disconnects, you're notified and shown the picker again to choose another.
- If the listener itself reconnects (e.g. after a network drop) while the same broadcaster is still active, it automatically rejoins that same broadcaster rather than making you pick again.

One relay server (`node server.js`) still needs to run somewhere reachable on the LAN — it doesn't matter which device, since `app.html` is just a client pointed at it regardless of which mode you pick. The "relay server address" field is that device's address, not tied to any particular role.

## Running the relay on the internet instead of just LAN

Three things change once devices aren't on the same network:

**1. NAT traversal (STUN/TURN).** On a LAN, peers reach each other's local IPs directly. Over the internet, most devices are behind NAT, so peer connections need a STUN server to discover a public IP:port, and often a TURN relay as fallback (symmetric NAT, corporate firewalls, some mobile carriers block direct P2P entirely). Note STUN only helps the browsers' own ICE agents do the UDP hole punching — it doesn't do the punching itself, and it can't help at all if either side is behind symmetric NAT, where only a TURN relay works.

The server hands out a free public Google STUN server by default. If you run [coturn](https://github.com/coturn/coturn) (serves STUN and TURN off the same listener), set `TURN_URLS` and its STUN equivalent is derived automatically — no separate STUN config needed:

```bash
TURN_URLS=turn:your-turn-server:3478 TURN_USERNAME=user TURN_CREDENTIAL=pass node server.js
```

Use `STUN_URLS` instead/additionally if you want to point STUN somewhere independent of your TURN server:

```bash
STUN_URLS=stun:your-stun-server:3478 node server.js
```

**2. Real TLS.** `TRUST_PROXY=1` switches the server to plain HTTP, for use behind something that already terminates real HTTPS — a reverse proxy (Caddy, nginx+certbot) or a PaaS (Fly.io, Render, Railway) that provisions a Let's Encrypt cert for you automatically. Don't expose plain HTTP directly to the internet; always put a real TLS terminator in front. Example with [Caddy](https://caddyserver.com) (handles Let's Encrypt automatically) on a VPS:

```
# Caddyfile
your-domain.com {
  reverse_proxy localhost:3000
}
```
```bash
TRUST_PROXY=1 node server.js   # then run `caddy run` alongside it
```

**3. Access control.** Set `ACCESS_TOKEN` so only people who know it can register as a broadcaster or listener — otherwise anyone who finds the URL can. Both modes in `app.html` share an "Access token" field (remembered via `localStorage`) that gets sent on connect.

```bash
TRUST_PROXY=1 ACCESS_TOKEN=some-long-random-string node server.js
```

The server logs a warning on startup if it's running in internet/proxy mode without an access token set.
