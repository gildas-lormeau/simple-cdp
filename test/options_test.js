import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { CDP, cdp, getTargets, options } from "../mod.js";
import { launchBrowser, withOptions } from "./helpers.js";

Deno.test("shared options", async (test) => {
    const browser = await launchBrowser();
    const { apiUrl } = browser;
    try {
        // regression: the shared options used to be copied into the instance when
        // the module was evaluated, so the exported object could never reach the
        // cdp singleton and it stayed pinned to the default API URL
        await test.step("reach the cdp singleton after the module is imported", async () => {
            await withOptions(options, { apiUrl }, async () => {
                assertEquals(cdp.options.apiUrl, apiUrl);
                const { protocolVersion } = await cdp.Browser.getVersion();
                assertEquals(protocolVersion, "1.3");
                cdp.reset();
            });
        });

        await test.step("reach the static target methods", async () => {
            await withOptions(options, { apiUrl }, async () => {
                const targets = await getTargets();
                assert(targets.some((target) => target.type === "page"));
            });
        });

        await test.step("keep the singleton and the static methods in agreement", async () => {
            await withOptions(options, { apiUrl }, async () => {
                const targets = await getTargets();
                const { targetInfos } = await cdp.Target.getTargets();
                const ids = targetInfos.map(({ targetId }) => targetId);
                assert(targets.every(({ id }) => ids.includes(id)));
                cdp.reset();
            });
        });
    } finally {
        await browser.close();
    }
});

Deno.test("instance options", async (test) => {
    const browser = await launchBrowser();
    const { apiUrl } = browser;
    try {
        await test.step("inherit the shared options", () =>
            withOptions(options, { apiUrl, connectionRetryDelay: 123 }, () => {
                const instance = new CDP({ connectionMaxRetry: 3 });
                assertEquals(instance.options.apiUrl, apiUrl);
                assertEquals(instance.options.connectionRetryDelay, 123);
                assertEquals(instance.options.connectionMaxRetry, 3);
            }));

        await test.step("do not leak back into the shared options", () =>
            withOptions(options, { apiUrl, connectionMaxRetry: 20 }, () => {
                const instance = new CDP({ apiUrl });
                instance.options.connectionMaxRetry = 99;
                assertEquals(options.connectionMaxRetry, 20);
                assertNotEquals(cdp.options.connectionMaxRetry, 99);
            }));

        // regression: the proxy had no set trap, so assigning to options wrote a
        // property on the proxy target and the setter was never reached
        await test.step("accept a whole object assignment", () => {
            const instance = new CDP({ apiUrl });
            instance.options = { connectionRetryDelay: 42 };
            assertEquals(instance.options.connectionRetryDelay, 42);
        });

        await test.step("merge rather than replace on assignment", () => {
            const instance = new CDP({ apiUrl });
            instance.options = { connectionRetryDelay: 42 };
            assertEquals(instance.options.apiUrl, apiUrl);
        });

        await test.step("accept a property mutation", () => {
            const instance = new CDP({ apiUrl });
            instance.options.connectionRetryDelay = 7;
            assertEquals(instance.options.connectionRetryDelay, 7);
        });

        await test.step("are used when the connection is opened", async () => {
            const instance = new CDP({ apiUrl });
            const { protocolVersion } = await instance.Browser.getVersion();
            assertEquals(protocolVersion, "1.3");
            instance.reset();
        });
    } finally {
        await browser.close();
    }
});
