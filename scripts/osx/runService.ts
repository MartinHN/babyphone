#!/usr/bin/env bun
import { spawn, type Subprocess } from "bun";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const NODE_SCRIPT = "server.js";
const BASH_SCRIPT = "launchTurn.sh";
const LOG_DIR = join(homedir(), "Library/Logs/nilophone");

await mkdir(LOG_DIR, { recursive: true });

const nodeLog = Bun.file(join(LOG_DIR, "nilophone_server.log"));
const bashLog = Bun.file(join(LOG_DIR, "nilophone_coturn.log"));
console.log("LOG in ", nodeLog)
const procs: Subprocess[] = [];
let shuttingDown = false;

function log(msg: string) {
    console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function cleanup(exitCode = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    log("Stopping services...");

    for (const proc of procs) {
        if (!proc.killed) {
            proc.kill("SIGTERM");
        }
    }

    // Give processes a moment to exit gracefully, then force-kill stragglers
    await Promise.race([
        Promise.all(procs.map((p) => p.exited)),
        Bun.sleep(5000),
    ]);

    for (const proc of procs) {
        if (!proc.killed) {
            proc.kill("SIGKILL");
        }
    }

    process.exit(exitCode);
}

process.on("SIGINT", () => cleanup(0));
process.on("SIGTERM", () => cleanup(0));

// --- Start node script ---
const nodeProc = spawn({
    cmd: ["node", NODE_SCRIPT],
    stdout: nodeLog,
    stderr: nodeLog,
});
procs.push(nodeProc);
log(`Started node script, PID ${nodeProc.pid}`);

// // --- Start bash script ---
// const bashProc = spawn({
//     cmd: ["bash", BASH_SCRIPT],
//     stdout: bashLog,
//     stderr: bashLog,
// });
// procs.push(bashProc);
// log(`Started bash script, PID ${bashProc.pid}`);

// Wait for whichever exits first, then tear down the other
const [firstExitCode, which] = await Promise.race([
    nodeProc.exited.then((code) => [code, "node"] as const),
    // bashProc.exited.then((code) => [code, "bash"] as const),
]);

log(`${which} script exited with code ${firstExitCode}`);
await cleanup(firstExitCode ?? 1);