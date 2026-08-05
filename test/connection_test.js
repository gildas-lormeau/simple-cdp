import { assert, assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { CDP, CONNECTION_CLOSED_ERROR_CODE, closeTarget, createTarget, options } from "../mod.js";
import { launchBrowser, settlesWithin, startStubServer, waitFor, withOptions } from "./helpers.js";

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

        // the connection is replaced when it is lost, so the lifecycle is
        // observable on the instance, which outlives it
        await test.step("reports the connection lifecycle on the instance", async () => {
            const cdp = new CDP({ apiUrl });
            const lifecycle = [];
            cdp.addEventListener("open", () => lifecycle.push("open"));
            cdp.addEventListener("close", () => lifecycle.push("close"));
            await cdp.Browser.getVersion();
            cdp.connection.close();
            await cdp.Browser.getVersion();
            cdp.reset();
            await waitFor(() => lifecycle.length === 4);
            assertEquals(lifecycle, ["open", "close", "open", "close"]);
        });

        await test.step("exposes the current connection when open is dispatched", async () => {
            const cdp = new CDP({ apiUrl });
            let connected;
            cdp.addEventListener("open", () => (connected = cdp.connection !== undefined));
            await cdp.Browser.getVersion();
            assertEquals(connected, true);
            cdp.reset();
        });

        await test.step("dispatches a CloseEvent carrying the reason", async () => {
            const cdp = new CDP({ apiUrl });
            const closed = Promise.withResolvers();
            cdp.addEventListener("close", (event) => closed.resolve(event));
            await cdp.Browser.getVersion();
            cdp.reset();
            const event = await closed.promise;
            assert(event instanceof CloseEvent);
            assertEquals(event.type, "close");
            assertEquals(typeof event.reason, "string");
        });

        // the lifecycle listeners belong to the instance, not to the connection
        await test.step("keeps the lifecycle listeners across reset()", async () => {
            const cdp = new CDP({ apiUrl });
            let opened = 0;
            cdp.addEventListener("open", () => opened++);
            await cdp.Browser.getVersion();
            cdp.reset();
            await cdp.Browser.getVersion();
            assertEquals(opened, 2);
            cdp.reset();
        });

        // a listener the connection has already dropped must not be registered
        // again on the connection replacing it
        await test.step("does not reapply a once listener that has fired", async () => {
            const cdp = new CDP({ apiUrl });
            let count = 0;
            cdp.Page.addEventListener("loadEventFired", () => count++, { once: true });
            await cdp.Browser.getVersion();
            cdp.connection.dispatchEvent(new Event("Page.loadEventFired"));
            assertEquals(count, 1);
            cdp.connection.close();
            await cdp.Browser.getVersion();
            cdp.connection.dispatchEvent(new Event("Page.loadEventFired"));
            assertEquals(count, 1);
            cdp.reset();
        });

        await test.step("reapplies a once listener that has not fired", async () => {
            const cdp = new CDP({ apiUrl });
            let count = 0;
            cdp.Page.addEventListener("loadEventFired", () => count++, { once: true });
            await cdp.Browser.getVersion();
            cdp.connection.close();
            await cdp.Browser.getVersion();
            cdp.connection.dispatchEvent(new Event("Page.loadEventFired"));
            cdp.connection.dispatchEvent(new Event("Page.loadEventFired"));
            assertEquals(count, 1);
            cdp.reset();
        });

        await test.step("does not reapply an aborted listener", async () => {
            const cdp = new CDP({ apiUrl });
            const controller = new AbortController();
            let count = 0;
            cdp.Page.addEventListener("loadEventFired", () => count++, {
                signal: controller.signal
            });
            await cdp.Browser.getVersion();
            controller.abort();
            cdp.connection.close();
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
