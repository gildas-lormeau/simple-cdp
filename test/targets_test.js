import { assert, assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import {
    activateTarget,
    closeTarget,
    CONNECTION_ERROR_CODE,
    CONNECTION_REFUSED_ERROR_CODE,
    createTarget,
    getTargets,
    options
} from "../mod.js";
import { launchBrowser, waitFor, withOptions } from "./helpers.js";

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

        // regression: the URL was interpolated into the query string as is, so
        // everything from the first separator on was lost
        await test.step("create a target with a URL carrying a query and a fragment", async () => {
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
                // the browser acknowledges the request before the target is gone
                const closed = await waitFor(async () => {
                    const targets = await getTargets();
                    return !targets.some(({ id }) => id === target.id);
                });
                assert(closed, "the target is still listed");
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

    // waiting is what can be cancelled, so the signal interrupts the retries
    // instead of leaving the caller to wait them out
    await test.step("stop retrying when the signal is aborted", async () => {
        const apiUrl = `http://127.0.0.1:${getClosedPort()}`;
        await withOptions(
            options,
            { apiUrl, connectionMaxRetry: 20, connectionRetryDelay: 500 },
            async () => {
                const controller = new AbortController();
                const start = performance.now();
                setTimeout(() => controller.abort(), 300);
                const error = await assertRejects(() => getTargets({ signal: controller.signal }));
                const elapsed = performance.now() - start;
                assertEquals(error.name, "AbortError");
                // without the signal this would run for 20 x 500ms
                assert(elapsed < 3000, `gave up only after ${Math.round(elapsed)}ms`);
            }
        );
    });

    await test.step("give the deadline of an AbortSignal.timeout", async () => {
        const apiUrl = `http://127.0.0.1:${getClosedPort()}`;
        await withOptions(
            options,
            { apiUrl, connectionMaxRetry: 20, connectionRetryDelay: 500 },
            async () => {
                const error = await assertRejects(() => getTargets({ signal: AbortSignal.timeout(300) }));
                assertEquals(error.name, "TimeoutError");
            }
        );
    });

    await test.step("reject with the reason of the signal", async () => {
        const apiUrl = `http://127.0.0.1:${getClosedPort()}`;
        await withOptions(options, { apiUrl }, async () => {
            const controller = new AbortController();
            controller.abort(new Error("shutting down"));
            const error = await assertRejects(() => getTargets({ signal: controller.signal }));
            assertEquals(error.message, "shutting down");
        });
    });

    // an aborted request is not a browser that cannot be reached
    await test.step("not retry an aborted request", async () => {
        const apiUrl = `http://127.0.0.1:${getClosedPort()}`;
        await withOptions(
            options,
            { apiUrl, connectionMaxRetry: 20, connectionRetryDelay: 500 },
            async () => {
                const controller = new AbortController();
                controller.abort();
                const start = performance.now();
                const error = await assertRejects(() => getTargets({ signal: controller.signal }));
                assertNotEquals(error.code, CONNECTION_REFUSED_ERROR_CODE);
                assert(performance.now() - start < 1000, "the aborted request was retried");
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
