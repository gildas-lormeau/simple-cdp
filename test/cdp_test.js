import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { CDP } from "../mod.js";
import { attachToPage, launchBrowser, settlesWithin, startStubServer, waitFor } from "./helpers.js";

Deno.test("protocol", async (test) => {
    const browser = await launchBrowser();
    const { apiUrl } = browser;
    try {
        await test.step("resolves a domain method to a protocol command", async () => {
            const cdp = new CDP({ apiUrl });
            const { protocolVersion, product } = await cdp.Browser.getVersion();
            assertEquals(protocolVersion, "1.3");
            assertStringIncludes(product, "Chrome");
            cdp.reset();
        });

        await test.step("passes parameters and returns the result", async () => {
            const cdp = new CDP({ apiUrl });
            const { sessionId } = await attachToPage(cdp);
            await cdp.Runtime.enable(null, sessionId);
            const { result } = await cdp.Runtime.evaluate({ expression: "41 + 1" }, sessionId);
            assertEquals(result.value, 42);
            cdp.reset();
        });

        await test.step("routes calls to the session passed as second argument", async () => {
            const cdp = new CDP({ apiUrl });
            const first = await attachToPage(cdp, "about:blank");
            const second = await attachToPage(cdp, "about:blank");
            await cdp.Runtime.enable(null, first.sessionId);
            await cdp.Runtime.enable(null, second.sessionId);
            await cdp.Runtime.evaluate({ expression: "globalThis.marker = 'first'" }, first.sessionId);
            const { result } = await cdp.Runtime.evaluate(
                { expression: "globalThis.marker ?? 'unset'" },
                second.sessionId
            );
            assertEquals(result.value, "unset");
            cdp.reset();
        });

        await test.step("rejects with the protocol error code and the failing call", async () => {
            const cdp = new CDP({ apiUrl });
            const error = await assertRejects(() => cdp.Browser.thisCommandDoesNotExist());
            assertEquals(error.code, -32601);
            assertStringIncludes(error.message, "Browser.thisCommandDoesNotExist");
            cdp.reset();
        });

        await test.step("keeps working after a failed call", async () => {
            const cdp = new CDP({ apiUrl });
            await assertRejects(() => cdp.Browser.thisCommandDoesNotExist());
            const { protocolVersion } = await cdp.Browser.getVersion();
            assertEquals(protocolVersion, "1.3");
            cdp.reset();
        });

        // regression: a domain resolved every unknown name to a command, so it
        // was thenable and hung when a promise adopted it
        await test.step("does not make a domain look like a promise", async () => {
            const cdp = new CDP({ apiUrl });
            assertEquals(cdp.Page.then, undefined);
            const adopted = Promise.resolve(cdp.Page);
            assertEquals(await settlesWithin(adopted, 4000), "resolved");
            cdp.reset();
        });

        // regression: the listener methods used to live on the proxy handler, so
        // the get trap itself was reachable as a domain method
        await test.step("does not expose the proxy handler as a command", async () => {
            const cdp = new CDP({ apiUrl });
            const error = await assertRejects(() => cdp.Page.get());
            assertEquals(error.code, -32601);
            cdp.reset();
        });

        await test.step("exposes the listener methods on a domain", () => {
            const cdp = new CDP({ apiUrl });
            assertEquals(typeof cdp.Page.addEventListener, "function");
            assertEquals(typeof cdp.Page.removeEventListener, "function");
        });

        // regression: stringifying or serializing a domain used to resolve
        // toString, valueOf and toJSON to commands, sending them to the browser
        // and throwing when the result was not a primitive
        await test.step("describes a domain without sending a command", async () => {
            const sent = [];
            const stub = startStubServer((socket) =>
                socket.addEventListener("message", ({ data }) => {
                    const { id, method } = JSON.parse(data);
                    sent.push(method);
                    socket.send(JSON.stringify({ id, result: {} }));
                })
            );
            try {
                const cdp = new CDP({ webSocketDebuggerUrl: stub.webSocketDebuggerUrl });
                await cdp.Browser.getVersion();
                sent.length = 0;
                assertEquals(`${cdp.Page}`, "[CDPDomain Page]");
                assertEquals(String(cdp.Target), "[CDPDomain Target]");
                assertEquals(cdp.Page + "", "[CDPDomain Page]");
                assertEquals(JSON.stringify(cdp.Page), "{}");
                assertEquals(cdp.Page.then, undefined);
                assertEquals(sent, []);
                cdp.reset();
            } finally {
                await stub.close();
            }
        });
    } finally {
        await browser.close();
    }
});

Deno.test("events", async (test) => {
    const browser = await launchBrowser();
    const { apiUrl } = browser;
    try {
        await test.step("delivers domain events to listeners", async () => {
            const cdp = new CDP({ apiUrl });
            const { sessionId } = await attachToPage(cdp);
            const fired = Promise.withResolvers();
            cdp.Page.addEventListener("loadEventFired", (event) => fired.resolve(event));
            await cdp.Page.enable(null, sessionId);
            await cdp.Page.navigate({ url: "data:text/html,<title>loaded</title>" }, sessionId);
            const event = await fired.promise;
            assertEquals(event.type, "Page.loadEventFired");
            assertEquals(event.sessionId, sessionId);
            assert(event.params.timestamp > 0);
            cdp.reset();
        });

        await test.step("registers listeners added before the connection is open", async () => {
            const cdp = new CDP({ apiUrl });
            const fired = Promise.withResolvers();
            // no command has been sent yet, so the connection does not exist
            assertEquals(cdp.connection, undefined);
            cdp.Page.addEventListener("loadEventFired", (event) => fired.resolve(event));
            const { sessionId } = await attachToPage(cdp);
            await cdp.Page.enable(null, sessionId);
            await cdp.Page.navigate({ url: "data:text/html,<title>loaded</title>" }, sessionId);
            const event = await fired.promise;
            assertEquals(event.type, "Page.loadEventFired");
            cdp.reset();
        });

        // regression: the queued listeners were flushed by the first call on the
        // same domain, so a listener on a domain that was never called directly
        // was silently dropped
        await test.step("registers a listener queued for another domain", async () => {
            const cdp = new CDP({ apiUrl });
            let count = 0;
            cdp.Page.addEventListener("loadEventFired", () => count++);
            await cdp.Target.getTargets();
            cdp.connection.dispatchEvent(new Event("Page.loadEventFired"));
            assertEquals(count, 1);
            cdp.reset();
        });

        // the pattern documented in the README: let the browser report the
        // sessions, then drive each target through the session it reports
        await test.step("delivers auto-attached sessions to a listener", async () => {
            const cdp = new CDP({ apiUrl });
            const sessions = new Map();
            await cdp.Target.setAutoAttach({
                autoAttach: true,
                flatten: true,
                waitForDebuggerOnStart: false
            });
            cdp.Target.addEventListener("attachedToTarget", ({ params }) => {
                const { sessionId, targetInfo } = params;
                if (targetInfo.type === "page") {
                    sessions.set(targetInfo.targetId, sessionId);
                }
            });
            const { targetId } = await cdp.Target.createTarget({ url: "about:blank" });
            const attached = await waitFor(() => sessions.has(targetId));
            assert(attached, "no session was reported for the new target");
            // the reported session must be usable without attaching explicitly
            const sessionId = sessions.get(targetId);
            await cdp.Runtime.enable(null, sessionId);
            const { result } = await cdp.Runtime.evaluate({ expression: "41 + 1" }, sessionId);
            assertEquals(result.value, 42);
            await cdp.Target.closeTarget({ targetId });
            cdp.reset();
        });

        // regression: the event data used to be assigned as writable properties,
        // so a listener could rewrite what the next ones received
        await test.step("protects the event data from the listeners", async () => {
            const stub = startStubServer((socket) =>
                socket.addEventListener("message", ({ data }) => {
                    socket.send(JSON.stringify({ id: JSON.parse(data).id, result: {} }));
                    socket.send(JSON.stringify({
                        method: "Page.loadEventFired",
                        params: { real: 1 },
                        sessionId: "abc"
                    }));
                })
            );
            try {
                const cdp = new CDP({ webSocketDebuggerUrl: stub.webSocketDebuggerUrl });
                const received = Promise.withResolvers();
                cdp.Page.addEventListener("loadEventFired", (event) => {
                    try {
                        event.params = { hijacked: true };
                        event.sessionId = "spoofed";
                    } catch {
                        // read-only in strict mode
                    }
                });
                cdp.Page.addEventListener("loadEventFired", (event) => received.resolve(event));
                await cdp.Browser.getVersion();
                const event = await received.promise;
                assertEquals(event.params, { real: 1 });
                assertEquals(event.sessionId, "abc");
                assertEquals(event.type, "Page.loadEventFired");
                assert(event instanceof Event);
                cdp.reset();
            } finally {
                await stub.close();
            }
        });

        // the listener options are forwarded to the connection, so they behave
        // as they do on any EventTarget
        await test.step("honours the once option", async () => {
            const cdp = new CDP({ apiUrl });
            let count = 0;
            cdp.Page.addEventListener("loadEventFired", () => count++, { once: true });
            await cdp.Browser.getVersion();
            cdp.connection.dispatchEvent(new Event("Page.loadEventFired"));
            cdp.connection.dispatchEvent(new Event("Page.loadEventFired"));
            assertEquals(count, 1);
            cdp.reset();
        });

        await test.step("honours the signal option", async () => {
            const cdp = new CDP({ apiUrl });
            const controller = new AbortController();
            let count = 0;
            cdp.Page.addEventListener("loadEventFired", () => count++, {
                signal: controller.signal
            });
            await cdp.Browser.getVersion();
            cdp.connection.dispatchEvent(new Event("Page.loadEventFired"));
            controller.abort();
            cdp.connection.dispatchEvent(new Event("Page.loadEventFired"));
            assertEquals(count, 1);
            cdp.reset();
        });

        // the idiom the README documents for waiting on a single event
        await test.step("resolves a promise from a once listener", async () => {
            const cdp = new CDP({ apiUrl });
            const { sessionId } = await attachToPage(cdp);
            const loaded = new Promise((resolve) =>
                cdp.Page.addEventListener("loadEventFired", resolve, { once: true })
            );
            await cdp.Page.enable(null, sessionId);
            await cdp.Page.navigate({ url: "data:text/html,<title>once</title>" }, sessionId);
            const event = await loaded;
            assertEquals(event.type, "Page.loadEventFired");
            cdp.reset();
        });

        await test.step("stops delivering to removed listeners", async () => {
            const cdp = new CDP({ apiUrl });
            const { sessionId } = await attachToPage(cdp);
            let count = 0;
            const listener = () => count++;
            cdp.Page.addEventListener("loadEventFired", listener);
            await cdp.Page.enable(null, sessionId);
            await cdp.Page.navigate({ url: "data:text/html,<title>one</title>" }, sessionId);
            while (count === 0) {
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
            cdp.Page.removeEventListener("loadEventFired", listener);
            await cdp.Page.navigate({ url: "data:text/html,<title>two</title>" }, sessionId);
            await new Promise((resolve) => setTimeout(resolve, 500));
            assertEquals(count, 1);
            cdp.reset();
        });
    } finally {
        await browser.close();
    }
});

Deno.test("instance members", async (test) => {
    const browser = await launchBrowser();
    const { apiUrl } = browser;
    try {
        // regression: the proxy used to hand back unbound methods, so calling
        // reset() through it threw on the first private field access
        await test.step("reset() closes the connection and allows reconnecting", async () => {
            const cdp = new CDP({ apiUrl });
            await cdp.Browser.getVersion();
            assert(cdp.connection !== undefined);
            cdp.reset();
            assertEquals(cdp.connection, undefined);
            const { protocolVersion } = await cdp.Browser.getVersion();
            assertEquals(protocolVersion, "1.3");
            cdp.reset();
        });

        await test.step("reset() is a no-op when no connection was opened", () => {
            const cdp = new CDP({ apiUrl });
            cdp.reset();
            assertEquals(cdp.connection, undefined);
        });

        await test.step("exposes the connection once a command has been sent", async () => {
            const cdp = new CDP({ apiUrl });
            assertEquals(cdp.connection, undefined);
            await cdp.Browser.getVersion();
            assert(cdp.connection instanceof EventTarget);
            assertEquals(typeof cdp.connection.sendMessage, "function");
            cdp.reset();
        });

        // the instance is disposable, so it can be declared with `using`
        await test.step("closes the connection when disposed", async () => {
            let connection;
            {
                using cdp = new CDP({ apiUrl });
                await cdp.Browser.getVersion();
                connection = cdp.connection;
                assertEquals(connection.closed, false);
            }
            assertEquals(connection.closed, true);
        });

        await test.step("disposes when the block throws", async () => {
            let connection;
            try {
                using cdp = new CDP({ apiUrl });
                await cdp.Browser.getVersion();
                connection = cdp.connection;
                throw new Error("failure inside the block");
            } catch {
                // the disposal runs before the error propagates
            }
            assertEquals(connection.closed, true);
        });

        await test.step("disposes to the same state as reset()", async () => {
            const cdp = new CDP({ apiUrl });
            let count = 0;
            cdp.Page.addEventListener("loadEventFired", () => count++);
            await cdp.Browser.getVersion();
            cdp[Symbol.dispose]();
            assertEquals(cdp.connection, undefined);
            await cdp.Browser.getVersion();
            cdp.connection.dispatchEvent(new Event("Page.loadEventFired"));
            assertEquals(count, 0);
            cdp.reset();
        });

        await test.step("sends commands through an explicit webSocketDebuggerUrl", async () => {
            const discovery = new CDP({ apiUrl });
            await discovery.Browser.getVersion();
            const response = await fetch(`${apiUrl}/json/version`);
            const { webSocketDebuggerUrl } = await response.json();
            discovery.reset();
            const cdp = new CDP({ webSocketDebuggerUrl });
            const { protocolVersion } = await cdp.Browser.getVersion();
            assertEquals(protocolVersion, "1.3");
            cdp.reset();
        });
    } finally {
        await browser.close();
    }
});
