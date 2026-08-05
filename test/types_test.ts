import { assertEquals } from "@std/assert";
import { activateTarget, CDP, cdp, closeTarget, createTarget, getTargets, options } from "../mod.js";
import type {
    CDPConnection,
    CDPEvent,
    CDPEventListener,
    CDPObject,
    CDPOptions,
    CDPTargetInfo,
    CDPValue
} from "../mod.js";
import { launchBrowser, withOptions } from "./helpers.js";

// This file is type checked when the tests run, so a regression in mod.d.ts
// fails the suite. The @ts-expect-error comments assert the opposite: the line
// below each one MUST be rejected, and the check fails if it ever compiles.

// deno-lint-ignore no-unused-vars
async function accepted() {
    // domains and methods
    await cdp.Page.enable();
    await cdp.Runtime.evaluate({ expression: "1 + 1" });
    await cdp.Runtime.evaluate({ expression: "1 + 1" }, "sessionId");
    await cdp.Runtime.enable(null, "sessionId");

    // parameters hold the values the protocol actually carries
    const params: CDPObject = {
        text: "x",
        count: 1,
        flag: true,
        missing: null,
        absent: undefined,
        list: [1, "x", true, null],
        nested: { deep: { deeper: 1 } }
    };
    await cdp.Emulation.setUserAgentOverride({ userAgent: "x", platform: null });
    await cdp.Runtime.evaluate(params);
    const value: CDPValue = null;

    // event listeners
    const listener: CDPEventListener = (event: CDPEvent) => {
        const type: string = event.type;
        const sessionId: string | undefined = event.sessionId;
        return void [type, sessionId, event.params];
    };
    cdp.Page.addEventListener("loadEventFired", listener);
    cdp.Page.removeEventListener("loadEventFired", listener);

    // instance members
    const instance = new CDP({ apiUrl: "http://127.0.0.1:9222" });
    const instanceOptions: CDPOptions = instance.options;
    instance.options = { connectionMaxRetry: 1 };
    const connection: CDPConnection = instance.connection;
    const closed: boolean = connection.closed;
    await connection.sendMessage("Browser.getVersion");
    await connection.sendMessage("Browser.getVersion", {});
    await connection.sendMessage("Browser.getVersion", {}, "sessionId");
    instance.reset();

    // shared options
    options.apiUrl = "http://127.0.0.1:9222";
    options.webSocketDebuggerUrl = "ws://127.0.0.1:9222/devtools/browser/x";
    options.connectionMaxRetry = 1;
    options.connectionRetryDelay = 1;

    // target functions, including the fields the browser actually returns
    const targets: CDPTargetInfo[] = await getTargets();
    const target: CDPTargetInfo = await createTarget("https://example.com/");
    const parentId: string | undefined = target.parentId;
    const described: string[] = [target.description, target.devtoolsFrontendUrl, target.title];
    // a target info is accepted as options, as the README shows
    new CDP(target).reset();
    await activateTarget(target.id);
    await closeTarget(target.id);

    return [value, instanceOptions, closed, targets, parentId, described];
}

// deno-lint-ignore no-unused-vars
async function rejected() {
    // @ts-expect-error a domain must be capitalized
    cdp.page.enable();
    // @ts-expect-error a method must not be capitalized
    cdp.Page.Enable();
    // @ts-expect-error a function is not a protocol value
    const params: CDPObject = { callback: () => {} };
    // @ts-expect-error the target functions resolve to nothing
    const activated: string = await activateTarget("id");
    // @ts-expect-error the target functions resolve to nothing
    const closed: string = await closeTarget("id");
    // @ts-expect-error the connection is read only
    cdp.connection = undefined;
    // @ts-expect-error an unknown option is rejected
    new CDP({ notAnOption: 1 });
    return [params, activated, closed];
}

Deno.test("types", async (test) => {
    // the runtime counterpart of the declarations checked above, so that the
    // two cannot drift apart again
    await test.step("the target functions resolve to undefined", async () => {
        const browser = await launchBrowser();
        try {
            await withOptions(options, { apiUrl: browser.apiUrl }, async () => {
                const target = await createTarget("about:blank");
                assertEquals(await activateTarget(target.id), undefined);
                assertEquals(await closeTarget(target.id), undefined);
            });
        } finally {
            await browser.close();
        }
    });

    await test.step("a target carries the declared fields", async () => {
        const browser = await launchBrowser();
        try {
            await withOptions(options, { apiUrl: browser.apiUrl }, async () => {
                const target = await createTarget("about:blank");
                const keys: (keyof CDPTargetInfo)[] = [
                    "id",
                    "type",
                    "title",
                    "description",
                    "url",
                    "webSocketDebuggerUrl",
                    "devtoolsFrontendUrl"
                ];
                for (const key of keys) {
                    assertEquals(typeof target[key], "string", `missing ${key}`);
                }
                await closeTarget(target.id);
            });
        } finally {
            await browser.close();
        }
    });
});
