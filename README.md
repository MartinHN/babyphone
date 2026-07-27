# NiloPhone (Mic Stream) — WebRTC baby monitor / mic streamer

Streams a microphone (and optionally video, and talkback audio) from any
device to any other device's browser. Audio flows peer-to-peer via WebRTC —
nothing but small signaling messages ever touches a server.

There are **two independent ways to set up that peer connection** — pick
whichever fits your situation:

| | **Manual (QR code)** | **Relay server (WebSocket)** |
|---|---|---|
| Setup | None — scan a QR code between two devices | `node server.js` running somewhere reachable by both devices |
| Auto-reconnect | No — a dropped connection needs a fresh QR scan | Yes, with backoff |
| Auto-discovery of broadcasters | No | Yes — pick from a live list |
| Works over mobile data | No — needs same network (or a VPN like Tailscale), no TURN/relay path | Yes, if a TURN server is configured |
| Multiple simultaneous listeners | One at a time | Yes |

Both modes support every other feature in this app equally (video-on-demand,
push-to-talk, VOX, etc.) — the choice only affects *how the two devices find
and connect to each other*, not what they can do once connected.

## Manual (QR code) mode — no setup at all

Open `app.html` on both devices (from GitHub Pages, or any static host —
see below). On the broadcaster, pick **📢 Broadcast my mic**; on the
listener, pick **🎧 Listen to a broadcast**, with "Manual (QR code)" selected
as the connection method. The broadcaster shows a QR code; the listener
scans it and shows one back; the broadcaster scans that. Connected — no
server, no account, no setup. Good for the same WiFi network, or a
site-to-site VPN like Tailscale where both devices have routable IPs.

The trade-off: if the connection drops, you need to scan a fresh QR to
reconnect (no auto-retry), and it doesn't traverse most mobile-carrier NAT at
all (no TURN relay in the picture).

## Relay server mode — auto-discovery, auto-reconnect, works anywhere

This is what the rest of this README covers in detail.

### Setup (one time)

Requires [Node.js](https://nodejs.org) installed on whichever device will run
the relay server. **`server.js` itself has zero required npm dependencies** —
it implements its own static file server and WebSocket server directly
against Node's built-in `http`/`https`/`crypto` modules. The only optional
dependency is `selfsigned`, needed just for generating a self-signed HTTPS
certificate in LAN mode (see below):

```bash
cd mic-stream
npm install   # only actually installs the optional selfsigned package
```

If you're deploying in internet/proxy mode (`TRUST_PROXY=1`, see further
down), you can skip `npm install` entirely — `node server.js` is all that's
needed, since that mode never touches the self-signed-cert code path at all.

### Run

```bash
npm start
```

The first time you run it, it:
- Generates a self-signed HTTPS certificate covering `localhost` and the
  current LAN IP(s) of the device running it.
- Generates a random access token.

Both are saved to `certs/` (so they're reused on future runs — delete that
folder to regenerate either one, e.g. if that device's IP changes). You'll
see output like:

```
Access token: 7f3a9c2e1b8d4f6a...
Open: https://192.168.1.42:3000/app.html?token=7f3a9c2e1b8d4f6a... (pick Broadcast or Listen in-app)
```

**The access token is always required** — every connection (broadcaster or
listener) is rejected before any signaling happens unless it presents the
correct one. This isn't optional/internet-only; it's checked in LAN mode too.
Open the URL the server prints (with `?token=...` already in it) and the
token gets cached in that browser's `localStorage`, so you only need the full
URL once per browser — after that, just the base address works. Set your own
`ACCESS_TOKEN=some-value` env var if you'd rather pin a specific value
instead of the generated one.

Open that URL on **any device** — you'll get a mode picker:

1. Tap **📢 Broadcast my mic** to give this device a name and start
   broadcasting, or **🎧 Listen to a broadcast** to pick a broadcaster from
   the list and listen. Use **← Change mode** at the top to switch.
2. The browser will show a certificate warning the first time (self-signed
   cert) — tap "Advanced" → "Proceed" (wording varies by browser). You only
   need to do this once per browser.
3. Audio should start playing within a second or two, with roughly
   100–300ms latency on a LAN.

Multiple devices can broadcast and multiple devices can listen at the same
time — see "Any device can broadcast, any device can listen" below.

### Why HTTPS?

Service workers, the Notification API, and the "Install App" prompt all
require a **secure context**. Plain `http://` on a LAN IP does *not* count as
one — only `https://` or `localhost` do. Without HTTPS, the install button
silently never appears and background notifications don't work, with no
error shown. That's the reason for the self-signed cert setup above.

If you'd rather skip the certificate-warning step entirely, an alternative on
Android Chrome is: go to
`chrome://flags/#unsafely-treat-insecure-origin-as-secure`, add
`http://<relay-server-ip>:3000`, and relaunch Chrome — this tells Chrome to
treat that specific origin as secure without HTTPS. This only affects that
one Chrome install, though, so the HTTPS approach above is better if you'll
use this from multiple devices/browsers.

## Hosting on GitHub Pages

You can host the app itself (`docs/app.html`) on GitHub Pages, so its install
prompt and service worker use a properly trusted certificate instead of the
self-signed one — no cert warning for the app itself, from either device.
This works for *either* signaling mode — manual/QR mode doesn't need a relay
server at all, so this is all you need for that; for relay mode, keep reading.

**What this does and doesn't remove:** GitHub Pages solves
installability/service-worker trust for the *page*. It does **not** remove
the need for HTTPS on your *relay server*, if you're using relay mode — the
page still opens a WebSocket back to it, and browsers block plain `ws://`
from an `https://` page (mixed content), so that connection is still `wss://`
against the relay server's self-signed cert. You'll still need to accept
that cert once, just directly rather than through the app.

**Setup (for relay mode):**

1. Push the contents of the `docs/` folder (in this project) to a GitHub
   repo — either to a branch named `gh-pages`, or to `main` with Pages
   configured to serve from `/docs`.
2. In the repo's Settings → Pages, set the source accordingly. You'll get a
   URL like `https://yourusername.github.io/mic-stream/`.
3. Run `npm start` on whichever device is your relay server — note the LAN
   address and access token it prints (e.g. `192.168.1.42:3000`).
4. On each device you'll use (broadcasting or listening), open
   `https://192.168.1.42:3000/app.html?token=...` (the exact URL the server
   printed) directly in the browser once, and accept the certificate
   warning. You only need to do this once per browser/network.
5. Now open your GitHub Pages URL on each device, with relay selected as the
   connection method. Enter the relay server's `address:port` and the access
   token in the Settings panel — both are remembered from then on via
   `localStorage`. Better yet: use **Share via QR** or **Copy link** in
   Settings on a device that's already configured — it bakes the address and
   token into the URL, so the next device just scans/opens it and everything
   is pre-filled automatically.
6. Install the app on each device. The install prompt should now appear
   cleanly since `github.io` has a trusted cert.

Note the relay server's LAN IP can change (new network, DHCP lease renewal,
etc.) — if it does, just update the address field (or re-share a fresh
link/QR).

## Notes

- A free public STUN server is used by default (good enough for LAN and many
  home NATs); see "Running the relay on the internet" below for TURN setup.
- If a listener can't reach the relay server, check that device's firewall
  allows inbound connections on the port in use.
- Multiple broadcasters and multiple listeners can be connected
  simultaneously; each broadcaster/listener pair gets its own peer
  connection.
- To change the port: `PORT=4000 npm start`.
- Some mobile browsers (iOS Safari in particular) require the page to be
  opened over **https** or **localhost** for `getUserMedia` — already
  satisfied here since the relay server serves everything over HTTPS (or is
  meant to sit behind one in `TRUST_PROXY` mode).

## Push-to-talk

Once connected, listeners get a "Hold to Talk" button to speak back to the
broadcaster — hold it down, the broadcaster hears you; release, and
transmission stops entirely (not just muted — genuinely near-zero bandwidth
while released, since the underlying track is swapped to `null` rather than
just silenced). Works in both connection modes.

## Voice-activated sending (VOX)

An optional listener-side setting: when enabled, the broadcaster's mic only
actually transmits while it detects sound above a threshold you set,
muting (again, genuinely — swapping the track to `null`, not just silencing
it) during quiet periods to save bandwidth. Your preference is remembered on
your device and sent to the broadcaster automatically every time you
connect. Works in both connection modes.

## Video on demand

Listeners get a "Show Video" button with a resolution picker
(Low/Medium/High) and, if the broadcaster's device has more than one camera,
a camera picker too — switching either happens live, without interrupting
the audio. The broadcaster's camera is only powered on when a listener
actually requests it (not just hidden from view the rest of the time), and
turns fully off again when no longer requested. Works in both connection
modes.

## PWA / background playback (listen mode)

`app.html` is an installable PWA (`manifest.json` + `sw.js`, shared by both
modes) with, in listen mode:

- **Media Session API** integration — shows lock-screen/notification-shade
  playback controls (play/pause/stop) and marks the tab as "playing media" to
  the OS/browser, which is what lets some browsers keep it running when the
  app is backgrounded. "Pause" mutes local playback only, without dropping
  the connection — resuming is instant rather than reconnecting from
  scratch.
- **Wake Lock** toggle — keeps the screen from sleeping while
  broadcasting *or* listening. This is the most *reliable* cross-platform way
  to guarantee uninterrupted playback, since it keeps the page fully
  foregrounded. Uses [NoSleep.js](https://github.com/richtr/NoSleep.js),
  which itself prefers the native Screen Wake Lock API where the browser
  supports it, falling back to an older trick (a silent looping video) only
  where it doesn't.
- **Auto-reconnect** (relay mode only) — if the WebRTC connection or
  signaling socket drops (common right after backgrounding/foregrounding),
  the listener automatically retries with backoff, and also retries
  immediately when the tab becomes visible again. Manual/QR mode has no
  auto-reconnect by design — see the mode comparison table at the top.

**Install it:** open `app.html` on the phone, tap **Install App** (Android
Chrome) or use Share → **Add to Home Screen** (iOS Safari), then launch it
from the home screen icon.

**Realistic expectations by platform:**

| Platform | Behavior |
|---|---|
| **Android Chrome** | Generally keeps actively-playing audio running when you switch apps or lock the screen, especially once installed as a PWA with Media Session set. This is the same mechanism that lets web-based music/radio players work in the background. |
| **iOS Safari / installed PWA** | Much stricter. iOS suspends most background web page execution, including live WebRTC connections, typically within seconds to a couple minutes of backgrounding — Media Session helps but does not fully solve this. The **wake lock / keep-screen-on** option is the dependable workaround here: as long as the screen stays on and the app is frontmost, it keeps streaming. |

If you need guaranteed, indefinite background audio on iOS specifically, that
generally requires a native app using `AVAudioSession` background modes — no
web/PWA technique gets fully reliable background WebRTC audio there today.

## RMS level meter

In listen mode, the app shows a big segmented level meter (green → yellow →
red) below the audio element, with a live dB readout and a white peak-hold
marker. It's driven by a Web Audio `AnalyserNode` tapped off the incoming
stream in parallel with the `<audio>` element — it doesn't affect playback,
just visualizes it. Redraws are skipped entirely when the level hasn't
actually changed since the last frame (common during silence/VOX-gated
quiet), so it's cheap to leave running for a whole session. The meter
automatically resets when the connection drops/reconnects.

## Notification bar status

Chrome's automatic "Now Playing" media notification is unreliable for live
WebRTC audio on its own, so listen mode additionally requests notification
permission on connect and posts its own persistent notification
("NiloPhone — live") with a **Stop** action, via the service worker. Make
sure to allow the permission prompt when you tap Connect.

## Connection-lost alert

If the connection drops unexpectedly while listening (toggle above, on by
default), you get two layers of alert, fired once per drop (not repeated on
every retry):

- An **audible two-tone beep** played directly in the page — works whenever
  the app is foregrounded.
- A **vibrating, non-silent notification** ("⚠️ NiloPhone — connection
  lost") — this is the one that reaches you when the app is backgrounded or
  the screen is off, since page JS/audio can't run reliably then.

It clears itself automatically once the stream reconnects and audio resumes.

## Faster failure detection

Auto-reconnect used to feel much slower than a manual page reload. That's
because a dead connection can go undetected for a long time by default — a
closed socket doesn't always fire a `close` event promptly (mobile network
switches, sleep/wake, NAT timeouts), and WebRTC's own "disconnected"/"failed"
states can take many seconds to trigger. A manual reload just tears
everything down instantly, which is why it felt faster.

Two watchdogs now catch this quickly instead of waiting on those slow
defaults (relay mode only — see below):

- **Signaling heartbeat** — the listener pings the server every 4s and
  expects a pong back; the server also pings every 10s and drops any socket
  that doesn't answer. If no pong arrives within ~9s, the listener treats the
  socket as dead and reconnects immediately, rather than waiting on
  TCP-level timeouts.
- **Audio stall watchdog** — polls `RTCPeerConnection.getStats()` every 3s
  once live; if no new audio bytes arrive for ~6s despite the connection
  still reporting "connected" (a one-sided network failure), it forces a
  reconnect. In manual/QR mode (no auto-reconnect), this instead surfaces a
  clear "connection appears lost, scan a new QR" message.

The backoff between reconnect attempts is also tight (starts at 500ms, caps
at 5s), since on a LAN a fresh attempt should succeed quickly once a drop is
actually detected.

## Any device can broadcast, any device can listen (relay mode)

The relay server (`server.js`) tracks any number of broadcasters at once,
each with a name, and listeners pick which one to connect to:

- **Broadcasting:** open `app.html` on any device, pick **📢 Broadcast my
  mic**, give it a name (remembered per-device via `localStorage`, defaults
  to something sensible based on the device type), and tap **Start
  Broadcasting Mic**. Multiple devices can broadcast simultaneously.
- **Listening:** open `app.html` on any device, pick **🎧 Listen to a
  broadcast**. If you have a remembered broadcaster and it's the only one
  currently available, you're connected to it automatically — no picker
  needed. Otherwise (multiple broadcasters online, or your usual one isn't
  among them) you'll see the list to choose from, with a **Refresh** button.
  Multiple listeners can tune into the same or different broadcasters.
- If your currently-selected broadcaster disconnects, you're notified and
  shown the picker again to choose another.
- If the listener itself reconnects (e.g. after a network drop) while the
  same broadcaster is still active, it automatically rejoins that same
  broadcaster rather than making you pick again — matched by name, since the
  server assigns a fresh id each time a broadcaster reconnects.

One relay server (`node server.js`) still needs to run somewhere reachable
on the LAN — it doesn't matter which device, since `app.html` is just a
client pointed at it regardless of which mode you pick. The "relay server
address" field is that device's address, not tied to any particular role.

## Running the relay on the internet instead of just LAN

Three things change once devices aren't on the same network:

**1. NAT traversal (STUN/TURN).** On a LAN, peers reach each other's local
IPs directly. Over the internet, most devices are behind NAT, so peer
connections need a STUN server to discover a public IP:port, and often a
TURN relay as fallback (symmetric NAT, corporate firewalls, some mobile
carriers block direct P2P entirely). Note STUN only helps the browsers' own
ICE agents do the UDP hole punching — it doesn't do the punching itself, and
it can't help at all if either side is behind symmetric NAT, where only a
TURN relay works.

The server hands out a free public Google STUN server by default. To serve
your own STUN/TURN config to relay-mode clients automatically (so nobody has
to type STUN/TURN details into the app themselves), create
**`certs/turn-config.json`** next to the certificate and access token:

```json
{
  "turnUrls": ["turn:your-turn-server:3478"],
  "turnSecret": "shared secret matching your TURN server's static-auth-secret",
  "turnCredentialTtlSeconds": 86400
}
```

If you run [coturn](https://github.com/coturn/coturn) (serves STUN and TURN
off the same listener) with `use-auth-secret` configured, `turnSecret`
matching its `static-auth-secret` gets you fresh, time-limited credentials
generated per connection — nothing long-lived to leak. If your TURN provider
only offers a fixed username/password instead (e.g. a free TURN service),
use `turnStaticUsername`/`turnStaticCredential` in the same file instead of
`turnSecret`. Add `"stunUrls": [...]` too if you want STUN pointed somewhere
independent of your TURN server. The server logs whether it found and
loaded this file on startup.

This config is served automatically to relay-mode clients over the
WebSocket connection itself, in relay mode's `"welcome"` message — nothing to
configure client-side. **Manual/QR mode never talks to this server at all**,
so it still needs STUN/TURN configured locally in the app (Settings →
Advanced) if you need it to reach beyond the same network.

**2. Real TLS.** `TRUST_PROXY=1` switches the server to plain HTTP, for use
behind something that already terminates real HTTPS — a reverse proxy
(Caddy, nginx+certbot) or a PaaS (Fly.io, Render, Railway) that provisions a
Let's Encrypt cert for you automatically. Don't expose plain HTTP directly to
the internet; always put a real TLS terminator in front. In this mode,
`server.js` needs no npm dependencies installed at all — the self-signed
cert code path (the only thing needing `selfsigned`) is never reached.
Example with [Caddy](https://caddyserver.com) (handles Let's Encrypt
automatically) on a VPS:

```
# Caddyfile
your-domain.com {
  reverse_proxy localhost:3000
}
```
```bash
TRUST_PROXY=1 node server.js   # then run `caddy run` alongside it
```

**3. Access control.** Already covered above — the access token is always
required, generated automatically and persisted to `certs/access-token.txt`,
or set `ACCESS_TOKEN=some-long-random-string` yourself to pin a specific
value across restarts.