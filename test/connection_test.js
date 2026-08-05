/// <reference types="../mod.d.ts" />

import { assert, assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { CDP, CONNECTION_CLOSED_ERROR_CODE, closeTarget, createTarget, options } from "../mod.js";
import { launchBrowser, settlesWithin, startStubServer, withOptions } from "./helpers.js";

const SETTLE_TIMEOUT = 4000;

Deno.test("connection lifecycle", async (test) => {
    const browser = await launchBrowser();
    const { apiUrl } = browser;
    try {
        // regression: pending requests used to be left unsettled when the socket
        // went away, so callers waited forever with no error
        await test.step("rejects the requests in flight when the connection drops", async () => {
            await withOptions(options, { apiUrl }, async () => {
                const target = await createTarget("about:blank");
                const cdp = new CDP({ webSocketDebuggerUrl: target.webSocketDebuggerUrl });
                await cdp.Runtime.enable();
                const pending = cdp.Runtime.evaluate({
                    expression: "new Promise(() => {})",
                    awaitPromise: true
                });
                await closeTarget(target.id);
                const error = await assertRejects(() => pending);
                assertEquals(error.code, CONNECTION_CLOSED_ERROR_CODE);
            });
        });

        await test.step("names the failing call in the rejection", async () => {
            await withOptions(options, { apiUrl }, async () => {
                const target = await createTarget("about:blank");
                const cdp = new CDP({ webSocketDebuggerUrl: target.webSocketDebuggerUrl });
                await cdp.Runtime.enable();
                const pending = cdp.Runtime.evaluate({
                    expression: "new Promise(() => {})",
                    awaitPromise: true
                });
                await closeTarget(target.id);
                const error = await assertRejects(() => pending);
                assert(
                    error.message.includes("Runtime.evaluate"),
                    `unexpected message: ${error.message}`
                );
            });
        });

        await test.step("reports a closed connection", async () => {
            const cdp = new CDP({ apiUrl });
            await cdp.Browser.getVersion();
            assertEquals(cdp.connection.closed, false);
            cdp.connection.close();
            assertEquals(cdp.connection.closed, true);
            cdp.reset();
        });

        await test.step("rejects a command sent on a closed connection", async () => {
            const cdp = new CDP({ apiUrl });
            await cdp.Browser.getVersion();
            const { connection } = cdp;
            connection.close();
            const error = await assertRejects(() => connection.sendMessage("Browser.getVersion", {}));
            assertEquals(error.code, CONNECTION_CLOSED_ERROR_CODE);
            cdp.reset();
        });

        // regression: an id with no matching pending request used to be
        // destructured, throwing out of the WebSocket listener
        await test.step("ignores a response with an unknown id", async () => {
            const stub = startStubServer((socket) => {
                socket.addEventListener("open", () =>
                    socket.send(JSON.stringify({ id: 123456, result: {} }))
                );
                socket.addEventListener("message", ({ data }) =>
                    socket.send(JSON.stringify({ id: JSON.parse(data).id, result: { ok: true } }))
                );
            });
            const uncaught = [];
            const onError = (event) => {
                uncaught.push(event.error ?? event.reason);
                event.preventDefault();
            };
            globalThis.addEventListener("error", onError);
            try {
                const cdp = new CDP({ webSocketDebuggerUrl: stub.webSocketDebuggerUrl });
                const call = cdp.Browser.getVersion();
                assertEquals(await settlesWithin(call, SETTLE_TIMEOUT), "resolved");
                assertEquals(uncaught.map((error) => String(error)), []);
                cdp.reset();
            } finally {
                globalThis.removeEventListener("error", onError);
                await stub.close();
            }
        });
    } finally {
        await browser.close();
    }
});

Deno.test("reconnection", async (test) => {
    const browser = await launchBrowser();
    const { apiUrl } = browser;
    try {
        await test.step("opens a new connection after the previous one is lost", async () => {
            const cdp = new CDP({ apiUrl });
            await cdp.Browser.getVersion();
            const connection = cdp.connection;
            connection.close();
            const { protocolVersion } = await cdp.Browser.getVersion();
            assertEquals(protocolVersion, "1.3");
            assertNotEquals(cdp.connection, connection);
            assertEquals(cdp.connection.closed, false);
            cdp.reset();
        });

        await test.step("reapplies the event listeners to the new connection", async () => {
            const cdp = new CDP({ apiUrl });
            let count = 0;
            cdp.Page.addEventListener("loadEventFired", () => count++);
            await cdp.Browser.getVersion();
            cdp.connection.close();
            await cdp.Browser.getVersion();
            cdp.connection.dispatchEvent(new Event("Page.loadEventFired"));
            assertEquals(count, 1);
            cdp.reset();
        });

        // an explicit reset is a clean slate, unlike an involuntary disconnection
        await test.step("drops the event listeners on reset()", async () => {
            const cdp = new CDP({ apiUrl });
            let count = 0;
            cdp.Page.addEventListener("loadEventFired", () => count++);
            await cdp.Browser.getVersion();
            cdp.reset();
            await cdp.Browser.getVersion();
            cdp.connection.dispatchEvent(new Event("Page.loadEventFired"));
            assertEquals(count, 0);
            cdp.reset();
        });

        // regression: every concurrent caller used to open its own socket, and
        // all but the last were leaked
        await test.step("opens a single connection for concurrent calls", async () => {
            const NativeWebSocket = globalThis.WebSocket;
            let count = 0;
            globalThis.WebSocket = class extends NativeWebSocket {
                constructor(url) {
                    count++;
                    super(url);
                }
            };
            try {
                const cdp = new CDP({ apiUrl });
                await Promise.all(Array.from({ length: 5 }, () => cdp.Browser.getVersion()));
                assertEquals(count, 1);
                cdp.reset();
            } finally {
                globalThis.WebSocket = NativeWebSocket;
            }
        });
    } finally {
        await browser.close();
    }
});
