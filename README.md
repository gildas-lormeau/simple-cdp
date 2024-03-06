# Introduction

simple-cdp is a JavaScript library to interact with the [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/).

# Install

You can install the library:

- from JSR:

```sh
deno add @simple-cdp/simple-cdp
```

- from NPM:

```sh
npm install simple-cdp
```

# Usage example

Start a Chromium-based browser with the switch `--remote-debugging-port=9222` and run the script below.

```js
// import the module (replace with "simple-cdp" if using NPM)
import { cdp } from "@simple-cdp/simple-cdp";

// enable auto-attach to new targets
await cdp.Target.setAutoAttach({
    autoAttach: true,
    flatten: true,
    waitForDebuggerOnStart: false
});

// add event listener triggered when a session is attached to a target
cdp.Target.addEventListener("attachedToTarget", onAttachedToTarget);

// create a new target and navigate to https://example.com
const url = "https://example.com";
await cdp.Target.createTarget({ url });

async function onAttachedToTarget({ params }) {
    // get session ID
    const { sessionId, targetInfo } = params;

    // check if the target is a page
    if (targetInfo.type === "page") {
        // enable "Runtime" domain
        await cdp.Runtime.enable(null, sessionId);

        // evaluate JavaScript expression
        const expression = "41 + 1";
        const { result } = await cdp.Runtime.evaluate({ expression }, sessionId);

        // display result in the console (i.e. 42)
        console.log(result.value);
    }
}
```

You can also create a `CDP` instance from the target's information, which eliminates the need to manage the session ID.
```js
// import the module (replace with "simple-cdp" if using NPM)
import { createTarget, CDP } from "@simple-cdp/simple-cdp";

// navigate to https://example.com
const url = "https://example.com";
const { webSocketDebuggerUrl } = await createTarget(url);

// create a CDP instance for the target
const cdp = new CDP({ webSocketDebuggerUrl });

// enable "Runtime" domain
await cdp.Runtime.enable();

// evaluate JavaScript expression
const expression = "41 + 1";
const { result } = await cdp.Runtime.evaluate({ expression });

// display result in the console (i.e. 42)
console.log(result.value);
```