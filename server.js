// Mic Stream — WebRTC signaling server (LAN or internet)
//
// LAN mode (default):
//   node server.js
//   Serves self-signed HTTPS directly. Open https://<lan-ip>:3000/app.html
//   on any device — pick "Broadcast" or "Listen" from the in-app menu.
//
// Internet mode:
//   TRUST_PROXY=1 node server.js
//   Serves plain HTTP — use this when deploying behind something that already
//   terminates real TLS for you (a reverse proxy like Caddy/nginx with a
//   Let's Encrypt cert, or a PaaS like Fly.io/Render that provisions HTTPS
//   automatically).
//
// The server itself never touches audio — it only relays small JSON
// signaling messages so devices can set up direct (or TURN-relayed) WebRTC
// connections with each other. The access token is generated/persisted here
// (see ensureAccessToken below); STUN/TURN config is optional and, if
// present, loaded from certs/turn-config.json (see buildIceServerConfig) —
// otherwise relay-mode clients still configure it themselves in-app, and
// manual/QR mode always does, since it never talks to this server at all.
//
const https = require("https");
const http = require("http");
const { WebSocketServer } = require("ws");
const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const selfsigned = require("selfsigned");

const TRUST_PROXY = process.env.TRUST_PROXY === "1";

const CERT_DIR = path.join(__dirname, "certs");
const KEY_PATH = path.join(CERT_DIR, "key.pem");
const CERT_PATH = path.join(CERT_DIR, "cert.pem");
const TOKEN_PATH = path.join(CERT_DIR, "access-token.txt");

// Anyone who can reach this server can broadcast or listen — there's no other
// access control. This token is the gate: every WebSocket connection must
// present it (as a query param) or gets rejected before any message is
// processed. Set ACCESS_TOKEN yourself to pin a stable value across restarts
// (e.g. in a systemd unit or docker-compose env); otherwise one is generated
// once and persisted alongside the TLS cert, so it survives restarts too.
function ensureAccessToken() {
  if (process.env.ACCESS_TOKEN) return process.env.ACCESS_TOKEN;
  if (fs.existsSync(TOKEN_PATH)) return fs.readFileSync(TOKEN_PATH, "utf8").trim();
  const token = crypto.randomBytes(16).toString("hex");
  fs.mkdirSync(CERT_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_PATH, token);
  return token;
}
const ACCESS_TOKEN = ensureAccessToken();
const TURN_CONFIG_PATH = path.join(CERT_DIR, "turn-config.json");

// Optional: serve STUN/TURN config to clients over the WebSocket itself, so
// they don't need to manually fill in Advanced STUN/TURN (or have it baked
// into a shareable link). Only reaches relay-mode clients — manual/QR mode
// never talks to this server, so it still needs its own local config.
//
// Loaded from certs/turn-config.json (alongside the cert and access token —
// same "generated/persisted config lives here" pattern), not env vars, so
// it's one file to edit rather than several vars to keep in sync. Expected
// shape:
//   {
//     "stunUrls": ["stun:example.com:3478"],
//     "turnUrls": ["turn:example.com:3478"],
//     "turnSecret": "shared secret matching your TURN server's static-auth-secret",
//     "turnCredentialTtlSeconds": 86400
//   }
// TURN needs credentials, two ways:
//   - Ephemeral (recommended): "turnSecret" matching your TURN server's
//     static-auth-secret (coturn: use-auth-secret + static-auth-secret in
//     turnserver.conf). A fresh, time-limited credential is generated per
//     connection — nothing long-lived to leak.
//   - Static: "turnStaticUsername" + "turnStaticCredential" directly —
//     simpler, but the same credential goes to every client indefinitely
//     (fine for e.g. a free TURN service that only offers static creds).
// File missing or unparsable just means no STUN/TURN is served — not fatal.
function toUrlArray(value) {
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

function loadTurnConfig() {
  if (!fs.existsSync(TURN_CONFIG_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(TURN_CONFIG_PATH, "utf8"));
  } catch (err) {
    console.warn(`Could not parse ${TURN_CONFIG_PATH}: ${err.message} — STUN/TURN will not be served.`);
    return {};
  }
}

const turnConfig = loadTurnConfig();
const STUN_URLS = toUrlArray(turnConfig.stunUrls);
const TURN_URLS = toUrlArray(turnConfig.turnUrls);
const TURN_SECRET = turnConfig.turnSecret || null;
const TURN_STATIC_USERNAME = turnConfig.turnStaticUsername || null;
const TURN_STATIC_CREDENTIAL = turnConfig.turnStaticCredential || null;
const TURN_CREDENTIAL_TTL_SECONDS = Number(turnConfig.turnCredentialTtlSeconds || 86400);

function buildIceServerConfig() {
  const servers = [];
  if (STUN_URLS.length) servers.push({ urls: STUN_URLS });

  if (TURN_URLS.length) {
    if (TURN_SECRET) {
      // coturn-style ephemeral credential: username is an expiry timestamp,
      // credential is base64(HMAC-SHA1(secret, username)).
      const expiry = Math.floor(Date.now() / 1000) + TURN_CREDENTIAL_TTL_SECONDS;
      const username = String(expiry);
      const credential = crypto.createHmac("sha1", TURN_SECRET).update(username).digest("base64");
      servers.push({ urls: TURN_URLS, username, credential });
    } else if (TURN_STATIC_USERNAME && TURN_STATIC_CREDENTIAL) {
      servers.push({ urls: TURN_URLS, username: TURN_STATIC_USERNAME, credential: TURN_STATIC_CREDENTIAL });
    }
  }
  return servers;
}

function getLanAddresses() {
  const nets = os.networkInterfaces();
  const addrs = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) addrs.push(net.address);
    }
  }
  return addrs;
}

function ensureCert() {
  if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)) {
    return { key: fs.readFileSync(KEY_PATH), cert: fs.readFileSync(CERT_PATH) };
  }

  console.log("No certificate found — generating a self-signed one for your LAN...");
  const lanAddrs = getLanAddresses();
  const altNames = [
    { type: 2, value: "localhost" }, // DNS
    { type: 7, ip: "127.0.0.1" }, // IP
    ...lanAddrs.map((ip) => ({ type: 7, ip })),
  ];

  const attrs = [{ name: "commonName", value: "mic-stream.local" }];
  const pems = selfsigned.generate(attrs, {
    days: 3650,
    keySize: 2048,
    extensions: [{ name: "subjectAltName", altNames }],
  });

  fs.mkdirSync(CERT_DIR, { recursive: true });
  fs.writeFileSync(KEY_PATH, pems.private);
  fs.writeFileSync(CERT_PATH, pems.cert);
  console.log(`Certificate saved to ${CERT_DIR} (covers: ${["localhost", "127.0.0.1", ...lanAddrs].join(", ")})`);
  return { key: pems.private, cert: pems.cert };
}

const app = express();
app.use(express.static(__dirname + "/public"));

let server;
if (TRUST_PROXY) {
  server = http.createServer(app);
} else {
  const { key, cert } = ensureCert();
  server = https.createServer({ key, cert }, app);
}
const wss = new WebSocketServer({ server });

const broadcasters = new Map(); // id -> { ws, name }
const listeners = new Map(); // id -> { ws, broadcasterId }
let nextBroadcasterId = 1;
let nextListenerId = 1;

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcasterList() {
  return Array.from(broadcasters.entries()).map(([id, b]) => ({ id, name: b.name }));
}

function pushBroadcasterListToAllListeners() {
  const list = broadcasterList();
  for (const { ws } of listeners.values()) {
    send(ws, { type: "broadcaster-list", broadcasters: list });
  }
}

wss.on("connection", (ws, req) => {
  const reqUrl = new URL(req.url, "http://localhost"); // base is irrelevant, just need query parsing
  if (reqUrl.searchParams.get("token") !== ACCESS_TOKEN) {
    ws.close(4001, "Unauthorized");
    return;
  }

  let role = null;
  let id = null;
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "ping") {
      send(ws, { type: "pong" });
      return;
    }

    if (msg.type === "register") {
      role = msg.role;
      if (role === "broadcaster") {
        id = String(nextBroadcasterId++);
        const name = (msg.name || "Unnamed device").slice(0, 60);
        broadcasters.set(id, { ws, name });
        send(ws, { type: "welcome", id, iceServers: buildIceServerConfig() });
        console.log(`Broadcaster connected: "${name}" (${id})`);
        pushBroadcasterListToAllListeners();
      } else if (role === "listener") {
        id = String(nextListenerId++);
        listeners.set(id, { ws, broadcasterId: null });
        send(ws, { type: "welcome", id, iceServers: buildIceServerConfig() });
        send(ws, { type: "broadcaster-list", broadcasters: broadcasterList() });
        console.log(`Listener connected: ${id}`);
      }
      return;
    }

    if (msg.type === "list-broadcasters" && role === "listener") {
      send(ws, { type: "broadcaster-list", broadcasters: broadcasterList() });
      return;
    }

    // A listener picks which broadcaster to receive audio from
    if (msg.type === "listen" && role === "listener") {
      const target = broadcasters.get(msg.broadcasterId);
      if (!target) {
        send(ws, { type: "broadcaster-gone", id: msg.broadcasterId });
        return;
      }
      const listener = listeners.get(id);
      listener.broadcasterId = msg.broadcasterId;
      send(target.ws, { type: "listener-join", id });
      return;
    }

    // Relay signaling messages between a broadcaster and one of its listeners
    if (msg.type === "offer" && role === "broadcaster") {
      const listener = listeners.get(msg.id);
      if (listener) send(listener.ws, { type: "offer", sdp: msg.sdp, id: msg.id });
    } else if (msg.type === "answer" && role === "listener") {
      const listener = listeners.get(id);
      const b = listener && broadcasters.get(listener.broadcasterId);
      if (b) send(b.ws, { type: "answer", sdp: msg.sdp, id });
    } else if (msg.type === "ice") {
      if (role === "broadcaster") {
        const listener = listeners.get(msg.id);
        if (listener) send(listener.ws, { type: "ice", candidate: msg.candidate, id: msg.id });
      } else if (role === "listener") {
        const listener = listeners.get(id);
        const b = listener && broadcasters.get(listener.broadcasterId);
        if (b) send(b.ws, { type: "ice", candidate: msg.candidate, id });
      }
    }
  });

  ws.on("close", () => {
    if (role === "broadcaster" && id) {
      const b = broadcasters.get(id);
      broadcasters.delete(id);
      console.log(`Broadcaster disconnected: "${b ? b.name : "?"}" (${id})`);
      // Tell any listeners currently tuned into this broadcaster it's gone
      for (const [lid, listener] of listeners.entries()) {
        if (listener.broadcasterId === id) {
          send(listener.ws, { type: "broadcaster-gone", id });
        }
      }
      pushBroadcasterListToAllListeners();
    } else if (role === "listener" && id) {
      const listener = listeners.get(id);
      listeners.delete(id);
      if (listener && listener.broadcasterId) {
        const b = broadcasters.get(listener.broadcasterId);
        if (b) send(b.ws, { type: "listener-leave", id });
      }
      console.log(`Listener disconnected: ${id}`);
    }
  });
});

// Protocol-level ping every 10s — catches connections that are dead at the
// TCP/network level but haven't fired a 'close' event yet (common on mobile
// networks switching, laptop sleep, etc). Without this, a stale connection
// can sit unnoticed for a long time.
const HEARTBEAT_MS = 10000;
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate(); // no pong since last check — drop it
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_MS);

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`\nMic Stream server running on port ${PORT} (${TRUST_PROXY ? "HTTP, behind proxy" : "HTTPS, self-signed"})`);
  console.log(`Access token: ${ACCESS_TOKEN}`);

  if (TRUST_PROXY) {
    console.log(`Running in internet/proxy mode. Make sure whatever sits in front of this`);
    console.log(`(reverse proxy or PaaS) terminates real HTTPS and forwards here on port ${PORT}.`);
    console.log(`Open: https://<your-public-domain>/app.html?token=${ACCESS_TOKEN} (pick Broadcast or Listen in-app)`);
  } else {
    const addrs = getLanAddresses();
    const host = addrs[0] || "<this-device-lan-ip>";
    console.log(`Open: https://${host}:${PORT}/app.html?token=${ACCESS_TOKEN} (pick Broadcast or Listen in-app)`);
    console.log(`\nYour browser will warn about an untrusted certificate the first`);
    console.log(`time — that's expected for a self-signed cert. Tap "Advanced" ->`);
    console.log(`"Proceed" (or equivalent) to continue. You only need to do this once`);
    console.log(`per browser.`);
  }

  console.log(`\nThe token above is required on every connection — anyone without it is`);
  console.log(`rejected before any signaling happens. It's generated once and persisted in`);
  console.log(`${TOKEN_PATH} (survives restarts); set ACCESS_TOKEN yourself to pin a specific`);
  console.log(`value instead. Share the URL above (with ?token=...) — app.html's "Copy`);
  console.log(`shareable link" bakes it in the same way it does the server address.`);

  if (STUN_URLS.length || TURN_URLS.length) {
    console.log(`\nServing STUN/TURN config to relay-mode clients over the WebSocket`);
    console.log(`(from ${TURN_CONFIG_PATH} — STUN: ${STUN_URLS.length || "none"}, TURN: ${TURN_URLS.length || "none"}` +
      `${TURN_URLS.length ? `, credentials: ${TURN_SECRET ? "ephemeral" : "static"}` : ""}).`);
  } else {
    console.log(`\nNo TURN config found at ${TURN_CONFIG_PATH} — relay-mode clients still`);
    console.log(`need their own Advanced STUN/TURN set locally (Settings) if they're outside`);
    console.log(`your LAN. To serve it from here instead, create that file:`);
    console.log(`  {`);
    console.log(`    "turnUrls": ["turn:your-turn-host:3478"],`);
    console.log(`    "turnSecret": "shared secret matching your TURN server's static-auth-secret"`);
    console.log(`  }`);
  }
  console.log("");
});