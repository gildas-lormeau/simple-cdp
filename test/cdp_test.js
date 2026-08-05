/// <reference types="../mod.d.ts" />

import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { CDP } from "../mod.js";
import { attachToPage, launchBrowser } from "./helpers.js";

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
