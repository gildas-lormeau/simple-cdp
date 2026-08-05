/// <reference types="../mod.d.ts" />

import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { CDP, closeTarget, createTarget, options } from "../mod.js";
import { launchBrowser, settlesWithin, startStubServer, withOptions } from "./helpers.js";

// These document defects that are known and not fixed yet, so they are skipped
// by default. Run them with:
//
//   KNOWN_ISSUES=1 deno task test
//
// When a defect is fixed, move its test into the matching suite.
const ignore = Deno.env.get("KNOWN_ISSUES") === undefined;
const HANG_TIMEOUT = 4000;

Deno.test({
    name: "known issues",
    ignore,
    async fn(test) {
        const browser = await launchBrowser();
        const { apiUrl } = browser;
        try {
            await test.step("a dropped connection rejects the requests in flight", async () => {
                await withOptions(options, { apiUrl }, async () => {
                    const target = await createTarget("about:blank");
                    const cdp = new CDP({ webSocketDebuggerUrl: target.webSocketDebuggerUrl });
                    await cdp.Runtime.enable();
                    const pending = cdp.Runtime.evaluate({
                        expression: "new Promise(() => {})",
                        awaitPromise: true
                    });
                    await closeTarget(target.id);
                    assertEquals(await settlesWithin(pending, HANG_TIMEOUT), "rejected");
                });
            });

            await test.step("a command sent on a dead connection rejects", async () => {
                await withOptions(options, { apiUrl }, async () => {
                    const target = await createTarget("about:blank");
                    const cdp = new CDP({ webSocketDebuggerUrl: target.webSocketDebuggerUrl });
                    await cdp.Runtime.enable();
                    await closeTarget(target.id);
                    // let the socket finish closing
                    await new Promise((resolve) => setTimeout(resolve, 500));
                    const call = cdp.Runtime.evaluate({ expression: "1" });
                    assertEquals(await settlesWithin(call, HANG_TIMEOUT), "rejected");
                });
            });

            await test.step("a domain is not thenable", async () => {
                const cdp = new CDP({ apiUrl });
                // any unknown property becomes a command, which makes a domain
                // look like a promise and hangs `return cdp.Page` in async code
                assertNotEquals(typeof cdp.Page.then, "function");
                // adopting a thenable calls then(resolve, reject), which sends a
                // "Page.then" command instead of settling the promise
                const resolved = Promise.resolve(cdp.Page);
                assertEquals(await settlesWithin(resolved, HANG_TIMEOUT), "resolved");
                cdp.reset();
            });

            await test.step("a domain does not expose the proxy handler", async () => {
                const cdp = new CDP({ apiUrl });
                // `get` is the name of the trap, so it used to be returned instead
                // of being resolved as a protocol command
                const error = await assertRejects(() => cdp.Page.get());
                assertEquals(error.code, -32601);
                cdp.reset();
            });

            await test.step("createTarget preserves the whole URL", async () => {
                await withOptions(options, { apiUrl }, async () => {
                    const url = "https://example.com/?a=1&b=2#frag";
                    const target = await createTarget(url);
                    try {
                        assertEquals(target.url, url);
                    } finally {
                        await closeTarget(target.id);
                    }
                });
            });

            await test.step("an unknown response id does not raise an uncaught error", async () => {
                // a response whose request is no longer pending reaches the
                // message handler, which destructures the missing entry and
                // throws out of the WebSocket listener, aborting the process
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
                    assertEquals(await settlesWithin(call, HANG_TIMEOUT), "resolved");
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
    }
});
