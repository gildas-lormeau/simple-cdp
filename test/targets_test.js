/// <reference types="../mod.d.ts" />

import { assert, assertEquals, assertRejects } from "@std/assert";
import {
    activateTarget,
    closeTarget,
    CONNECTION_ERROR_CODE,
    CONNECTION_REFUSED_ERROR_CODE,
    createTarget,
    getTargets,
    options
} from "../mod.js";
import { launchBrowser, withOptions } from "./helpers.js";

/**
 * Reserve a port and release it, so that connecting to it is refused
 */
function getClosedPort() {
    const listener = Deno.listen({ port: 0 });
    const { port } = listener.addr;
    listener.close();
    return port;
}

Deno.test("target methods", async (test) => {
    const browser = await launchBrowser();
    const { apiUrl } = browser;
    try {
        await test.step("list the open targets", async () => {
            await withOptions(options, { apiUrl }, async () => {
                const targets = await getTargets();
                assert(Array.isArray(targets));
                const page = targets.find((target) => target.type === "page");
                assert(page !== undefined);
                assertEquals(typeof page.id, "string");
                assertEquals(typeof page.webSocketDebuggerUrl, "string");
            });
        });

        await test.step("create a target", async () => {
            await withOptions(options, { apiUrl }, async () => {
                const target = await createTarget("https://example.com/");
                assertEquals(typeof target.id, "string");
                const targets = await getTargets();
                assert(targets.some(({ id }) => id === target.id));
                await closeTarget(target.id);
            });
        });

        await test.step("activate a target", async () => {
            await withOptions(options, { apiUrl }, async () => {
                const target = await createTarget("about:blank");
                await activateTarget(target.id);
                await closeTarget(target.id);
            });
        });

        await test.step("close a target", async () => {
            await withOptions(options, { apiUrl }, async () => {
                const target = await createTarget("about:blank");
                await closeTarget(target.id);
                const targets = await getTargets();
                assert(!targets.some(({ id }) => id === target.id));
            });
        });
    } finally {
        await browser.close();
    }
});

Deno.test("connection errors", async (test) => {
    // regression: the error built for HTTP failures used to be wrapped in a
    // second Error, which dropped both the code and the status
    await test.step("expose the code and status of an HTTP error", async () => {
        const server = Deno.serve(
            { port: 0, onListen() {} },
            () => new Response("nope", { status: 404 })
        );
        try {
            const apiUrl = `http://127.0.0.1:${server.addr.port}`;
            await withOptions(options, { apiUrl }, async () => {
                const error = await assertRejects(() => getTargets());
                assertEquals(error.code, CONNECTION_ERROR_CODE);
                assertEquals(error.status, 404);
            });
        } finally {
            await server.shutdown();
        }
    });

    await test.step("expose the code of a refused connection", async () => {
        const apiUrl = `http://127.0.0.1:${getClosedPort()}`;
        await withOptions(
            options,
            { apiUrl, connectionMaxRetry: 1, connectionRetryDelay: 10 },
            async () => {
                const error = await assertRejects(() => getTargets());
                assertEquals(error.code, CONNECTION_REFUSED_ERROR_CODE);
            }
        );
    });

    await test.step("retry a refused connection the configured number of times", async () => {
        const port = getClosedPort();
        const apiUrl = `http://127.0.0.1:${port}`;
        await withOptions(
            options,
            { apiUrl, connectionMaxRetry: 3, connectionRetryDelay: 100 },
            async () => {
                const start = performance.now();
                await assertRejects(() => getTargets());
                const elapsed = performance.now() - start;
                // three retries spaced by 100ms
                assert(elapsed >= 300, `gave up after ${Math.round(elapsed)}ms`);
            }
        );
    });
});
