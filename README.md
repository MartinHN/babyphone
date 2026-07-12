# Mic Stream (LAN, WebRTC)

Streams your laptop's microphone to your phone's browser over your local network. Audio flows peer-to-peer via WebRTC — the Node server only handles the initial handshake (signaling).

## Setup (one time)

Requires [Node.js](https://nodejs.org) installed on the laptop.

```bash
cd mic-stream
npm install
```

## Run

```bash
npm start
```

The first time you run it, it generates a self-signed HTTPS certificate covering `localhost` and your current LAN IP(s), saved to `certs/` (so it's reused on future runs — delete that folder to regenerate, e.g. if your laptop's IP changes). You'll see output like:

```
Mic Stream server running on port 3000 (HTTPS)
On this laptop, open:  https://localhost:3000/broadcaster.html
On your phone, open:   https://192.168.1.42:3000/listener.html
```

1. On your **laptop**, open the `broadcaster.html` URL, click **Start Broadcasting Mic**, and allow microphone access.
2. On your **phone**, make sure it's on the **same Wi-Fi/LAN**, then open the `listener.html` URL and tap **Connect & Listen**.
3. Both browsers will show a certificate warning the first time (self-signed cert) — tap "Advanced" → "Proceed" (wording varies by browser). You only need to do this once per browser.
4. Audio should start playing within a second or two, with roughly 100–300ms latency.

### Why HTTPS?

Service workers, the Notification API, and the "Install App" prompt all require a **secure context**. Plain `http://` on a LAN IP does *not* count as one — only `https://` or `localhost` do. Without HTTPS, the install button silently never appears and background notifications don't work, with no error shown. That's the reason for the self-signed cert setup above.

If you'd rather skip the certificate-warning step entirely, an alternative on Android Chrome is: go to `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, add `http://<laptop-ip>:3000`, and relaunch Chrome — this tells Chrome to treat that specific origin as secure without HTTPS. This only affects that one Chrome install, though, so the HTTPS approach above is better if you'll use this from multiple devices/browsers.

## Hosting the listener on GitHub Pages

You can host just the listener (receiving) app on GitHub Pages, so its install prompt and service worker use a properly trusted certificate instead of the self-signed one — no cert warning for the app itself.

**What this does and doesn't remove:** GitHub Pages solves installability/service-worker trust for the *page*. It does **not** remove the need for HTTPS on your *LAN server* — the page still opens a WebSocket back to your laptop, and browsers block plain `ws://` from an `https://` page (mixed content), so that connection is still `wss://` against your laptop's self-signed cert. You'll still need to accept that cert once, just directly rather than through the app.

**Setup:**

1. Push the contents of the `docs/` folder (in this project) to a GitHub repo — either to a branch named `gh-pages`, or to `main` with Pages configured to serve from `/docs`.
2. In the repo's Settings → Pages, set the source accordingly. You'll get a URL like `https://yourusername.github.io/mic-stream/`.
3. On your laptop, run `npm start` as usual — note the LAN address it prints (e.g. `192.168.1.42:3000`).
4. On your phone, open `https://192.168.1.42:3000` (your laptop's actual LAN address) directly in the browser once, and accept the certificate warning. You only need to do this once per browser/network.
5. Now open your GitHub Pages URL (`https://yourusername.github.io/mic-stream/`). Enter the laptop's `address:port` (e.g. `192.168.1.42:3000`) in the "Laptop address" field — it's remembered from then on via `localStorage`.
6. Install the app and connect as before. The install prompt should now appear cleanly since `github.io` has a trusted cert.

Note the laptop's LAN IP can change (new network, DHCP lease renewal, etc.) — if it does, just update the address field on the listener page.

The `broadcaster.html` page stays on the laptop's own local server (it needs to run there anyway, to access the laptop's mic) — no need to host it anywhere else.

## Notes

- No STUN/TURN server is configured since this is LAN-only — both devices must be on the same network.
- If the phone can't reach the laptop, check the laptop's firewall allows inbound connections on port 3000 (HTTPS now, same port).
- Multiple phones can connect simultaneously; each gets its own peer connection.
- To change the port: `PORT=4000 npm start`.
- Some mobile browsers (iOS Safari in particular) require the page to be opened over **https** or **localhost** for `getUserMedia`, but since only the *laptop* captures audio and the *phone* just plays it back, this restriction doesn't affect the listener page.

## Listener as a PWA / background playback

The listener page (`public/listener.html`) is now a installable PWA (`manifest.json` + `sw.js`) with:

- **Media Session API** integration — shows lock-screen/notification-shade playback controls and marks the tab as "playing media" to the OS/browser, which is what lets some browsers keep it running when the app is backgrounded.
- **Wake Lock** toggle — keeps the screen from sleeping while listening. This is the most *reliable* cross-platform way to guarantee uninterrupted playback, since it keeps the page fully foregrounded.
- **Auto-reconnect** — if the WebRTC connection or signaling socket drops (common right after backgrounding/foregrounding), the listener automatically retries with backoff, and also retries immediately when the tab becomes visible again.

**Install it:** open `listener.html` on the phone, tap **Install App** (Android Chrome) or use Share → **Add to Home Screen** (iOS Safari), then launch it from the home screen icon.

**Realistic expectations by platform:**

| Platform | Behavior |
|---|---|
| **Android Chrome** | Generally keeps actively-playing audio running when you switch apps or lock the screen, especially once installed as a PWA with Media Session set. This is the same mechanism that lets web-based music/radio players work in the background. |
| **iOS Safari / installed PWA** | Much stricter. iOS suspends most background web page execution, including live WebRTC connections, typically within seconds to a couple minutes of backgrounding — Media Session helps but does not fully solve this. The **wake lock / keep-screen-on** option is the dependable workaround here: as long as the screen stays on and the app is frontmost, it keeps streaming. |

If you need guaranteed, indefinite background audio on iOS specifically, that generally requires a native app using `AVAudioSession` background modes — no web/PWA technique gets fully reliable background WebRTC audio there today.

## RMS level meter

The listener page shows a big segmented level meter (green → yellow → red) below the audio element, with a live dB readout and a white peak-hold marker. It's driven by a Web Audio `AnalyserNode` tapped off the incoming stream in parallel with the `<audio>` element — it doesn't affect playback, just visualizes it. The meter automatically resets when the connection drops/reconnects.

## Notification bar status

Chrome's automatic "Now Playing" media notification is unreliable for live WebRTC audio (it depends on Chrome detecting the `<audio>` element as "audible," which doesn't always trigger consistently, especially for installed PWAs). To work around this, the listener explicitly requests notification permission on connect and posts its own persistent notification ("Mic Stream — live") with a **Stop** action, via the service worker. This is what shows up in your notification shade — make sure to allow the permission prompt when you tap Connect.
