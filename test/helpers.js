/// <reference types="../mod.d.ts" />

const CHROME_PATHS = {
    darwin: [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
    ],
    linux: [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser"
    ],
    windows: [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
    ]
};
const BROWSER_ARGS = [
    "--headless=new",
    // port 0 lets the browser pick a free port, which it reports on stderr
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "about:blank"
];
const DEBUGGER_PORT_REGEXP = /ws:\/\/127\.0\.0\.1:(\d+)\//;

/**
 * Locate a Chromium-based browser, honoring the CHROME_PATH environment
 * variable when set
 */
function getBrowserPath() {
    const browserPath = Deno.env.get("CHROME_PATH");
    if (browserPath !== undefined) {
        return browserPath;
    }
    const paths = CHROME_PATHS[Deno.build.os] ?? [];
    for (const path of paths) {
        try {
            Deno.statSync(path);
            return path;
        } catch {
            // try the next candidate
        }
    }
    throw new Error(
        `no Chromium-based browser found for ${Deno.build.os}, set CHROME_PATH to run the tests`
    );
}

/**
 * Read the debugging port the browser reports on stderr, then keep draining
 * the stream so the browser never blocks on a full pipe
 */
async function readDebuggerPort(stderr) {
    const reader = stderr.getReader();
    const decoder = new TextDecoder();
    let output = "";
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) {
                throw new Error(`browser exited without reporting a port:\n${output}`);
            }
            output += decoder.decode(value, { stream: true });
            const match = output.match(DEBUGGER_PORT_REGEXP);
            if (match !== null) {
                return Number(match[1]);
            }
        }
    } finally {
        reader.releaseLock();
    }
}

/**
 * Start a headless browser on a free port with a throwaway profile
 *
 * A non-default user data directory is mandatory since Chrome 136, which
 * ignores the remote debugging switches when pointed at the default profile.
 */
export async function launchBrowser() {
    const userDataDir = await Deno.makeTempDir({ prefix: "simple-cdp-test-" });
    const browserProcess = new Deno.Command(getBrowserPath(), {
        args: [...BROWSER_ARGS, `--user-data-dir=${userDataDir}`],
        stdout: "null",
        stderr: "piped"
    }).spawn();
    const port = await readDebuggerPort(browserProcess.stderr);
    const drained = browserProcess.stderr.pipeTo(new WritableStream()).catch(() => {});
    return {
        apiUrl: `http://127.0.0.1:${port}`,
        async close() {
            try {
                browserProcess.kill();
            } catch {
                // already gone
            }
            await browserProcess.status;
            await drained;
            await Deno.remove(userDataDir, { recursive: true }).catch(() => {});
        }
    };
}

/**
 * Run a function with temporary values applied to the shared options object,
 * restoring the previous state afterwards
 */
export async function withOptions(options, overrides, fn) {
    const saved = Object.assign({}, options);
    Object.assign(options, overrides);
    try {
        return await fn();
    } finally {
        for (const key of Object.keys(options)) {
            delete options[key];
        }
        Object.assign(options, saved);
    }
}

/**
 * Resolve to "hung" when a promise does not settle in time, so that tests can
 * assert on missing rejections without stalling the suite
 */
export function settlesWithin(promise, timeout) {
    let timeoutId;
    const settled = promise.then(() => "resolved", () => "rejected");
    const hung = new Promise((resolve) => (timeoutId = setTimeout(() => resolve("hung"), timeout)));
    return Promise.race([settled, hung]).finally(() => clearTimeout(timeoutId));
}

/**
 * Start a WebSocket server standing in for a browser, so that connection
 * behavior can be tested without driving a real one
 */
export function startStubServer(onConnection) {
    const sockets = new Set();
    const server = Deno.serve({ port: 0, onListen() {} }, (request) => {
        const { socket, response } = Deno.upgradeWebSocket(request);
        sockets.add(socket);
        socket.addEventListener("close", () => sockets.delete(socket));
        onConnection(socket);
        return response;
    });
    return {
        webSocketDebuggerUrl: `ws://127.0.0.1:${server.addr.port}`,
        async close() {
            for (const socket of sockets) {
                socket.close();
            }
            await server.shutdown();
        }
    };
}

/**
 * Poll a condition until it holds, since the browser applies some operations
 * asynchronously after acknowledging them
 */
export async function waitFor(condition, timeout = 4000, delay = 50) {
    const deadline = performance.now() + timeout;
    while (performance.now() < deadline) {
        if (await condition()) {
            return true;
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
    }
    return false;
}

/**
 * Attach to a page target and return its session ID
 */
export async function attachToPage(cdp, url = "about:blank") {
    const { targetId } = await cdp.Target.createTarget({ url });
    const { sessionId } = await cdp.Target.attachToTarget({ targetId, flatten: true });
    return { targetId, sessionId };
}
