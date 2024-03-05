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

Start a Chromium-based browser or Firefox with the switch `--remote-debugging-port=9222` and run the script below.

```js
// import the module (replace with "simple-cdp" if using NPM)
import cdp from "@simple-cdp/simple-cdp";

// wait for connection to be ready
await cdp.ready;

// add event listener triggered when a session is attached
cdp.Target.addEventListener("attachedToTarget", onAttachedToTarget);

// send command to create a new target
const url = "https://example.com";
const { targetId } = await cdp.Target.createTarget({ url });

// send command to attach a session to the target
await cdp.Target.attachToTarget({ targetId });

async function onAttachedToTarget({ params }) {
    // get session ID
    const { sessionId } = params;

    // send command to enable runtime
    await cdp.Runtime.enable(null, sessionId);
    
    // send command to evaluate expression
    const expression = "41 + 1";
    const { result } = await cdp.Runtime.evaluate({ expression }, sessionId);
    
    // display result in the console (i.e. 42)
    console.log(result.value);
}
```

Alternatively, you can also pass the `webSocketDebuggerUrl` option directly and avoid handling the session ID.
```js
// import the module (replace with "simple-cdp" if using NPM)
import cdp from "@simple-cdp/simple-cdp";

// wait for connection to be ready
await cdp.ready;

// find the first page target
const targets = await cdp.getTargets();
const page = targets.find(target => target.type === "page");

// set the webSocketDebuggerUrl option
cdp.options.webSocketDebuggerUrl = page.webSocketDebuggerUrl;

// add event listener triggered when a session is attached
cdp.Target.addEventListener("attachedToTarget", onAttachedToTarget);

// send command to create a new target
const url = "https://example.com";
const { targetId } = await cdp.Target.createTarget({ url });

// send command to attach a session to the target
await cdp.Target.attachToTarget({ targetId });

async function onAttachedToTarget() {
    // send command to enable runtime
    await cdp.Runtime.enable();

    // send command to evaluate expression
    const expression = "41 + 1";
    const { result } = await cdp.Runtime.evaluate({ expression });

    // display result in the console (i.e. 42)
    console.log(result.value);
}
```