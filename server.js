// Mic Stream — LAN WebRTC signaling server
//
// Run:  node server.js
// Then on the LAPTOP open:  https://localhost:3000/broadcaster.html
// And on the PHONE open:    https://<laptop-lan-ip>:3000/listener.html
//
// The server itself never touches audio — it only relays small JSON
// signaling messages so the two browsers can set up a direct WebRTC
// connection. Audio then flows peer-to-peer over your LAN.
//
// This serves HTTPS with a self-signed certificate (auto-generated on
// first run, covering your LAN IPs). That's required because service
// workers, the notification API, and the "Install App" prompt only work
// in a "secure context" — plain http:// on a LAN IP does NOT count as
// one (only https:// or localhost do), so without this none of that
// would work on the phone. Your phone's browser will show a
// certificate warning the first time — that's expected for a
// self-signed cert; tap through "Advanced -> Proceed" once.

const express = require("express");
const https = require("https");
const { WebSocketServer } = require("ws");
const os = require("os");
const fs = require("fs");
const path = require("path");
const selfsigned = require("selfsigned");

const CERT_DIR = path.join(__dirname, "certs");
const KEY_PATH = path.join(CERT_DIR, "key.pem");
const CERT_PATH = path.join(CERT_DIR, "cert.pem");

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

const { key, cert } = ensureCert();
const server = https.createServer({ key, cert }, app);
const wss = new WebSocketServer({ server });

let broadcaster = null; // the single laptop connection
const listeners = new Map(); // id -> ws

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

let nextId = 1;

wss.on("connection", (ws) => {
  let role = null;
  let id = null;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "register") {
      role = msg.role;
      if (role === "broadcaster") {
        broadcaster = ws;
        console.log("Broadcaster (laptop) connected");
        // Tell it about any listeners already waiting
        for (const lid of listeners.keys()) {
          send(broadcaster, { type: "listener-join", id: lid });
        }
      } else if (role === "listener") {
        id = String(nextId++);
        listeners.set(id, ws);
        send(ws, { type: "welcome", id });
        console.log(`Listener (phone) connected: ${id}`);
        if (broadcaster) send(broadcaster, { type: "listener-join", id });
      }
      return;
    }

    // Relay signaling messages between broadcaster and a specific listener
    if (msg.type === "offer" && role === "broadcaster") {
      send(listeners.get(msg.id), { type: "offer", sdp: msg.sdp, id: msg.id });
    } else if (msg.type === "answer" && role === "listener") {
      send(broadcaster, { type: "answer", sdp: msg.sdp, id });
    } else if (msg.type === "ice") {
      if (role === "broadcaster") {
        send(listeners.get(msg.id), { type: "ice", candidate: msg.candidate, id: msg.id });
      } else if (role === "listener") {
        send(broadcaster, { type: "ice", candidate: msg.candidate, id });
      }
    }
  });

  ws.on("close", () => {
    if (role === "broadcaster") {
      broadcaster = null;
      console.log("Broadcaster disconnected");
    } else if (role === "listener" && id) {
      listeners.delete(id);
      if (broadcaster) send(broadcaster, { type: "listener-leave", id });
      console.log(`Listener disconnected: ${id}`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  const addrs = getLanAddresses();
  console.log(`\nMic Stream server running on port ${PORT} (HTTPS)`);
  console.log(`On this laptop, open:  https://localhost:${PORT}/broadcaster.html`);
  if (addrs.length) {
    console.log(`On your phone, open:   https://${addrs[0]}:${PORT}/listener.html`);
  } else {
    console.log(`Find this laptop's LAN IP and open https://<that-ip>:${PORT}/listener.html on your phone`);
  }
  console.log(`\nYour browser/phone will warn about an untrusted certificate the first`);
  console.log(`time — that's expected for a self-signed cert. Tap "Advanced" ->`);
  console.log(`"Proceed" (or equivalent) to continue. You only need to do this once`);
  console.log(`per browser.\n`);
});
