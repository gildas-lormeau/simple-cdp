# Introduction

simple-cdp is a JavaScript library to interact with the Chrome DevTools Protocol.

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

```js
// import the module
import cdp from "@simple-cdp/simple-cdp";

// wait for connection to be ready
await cdp.ready;

// add event listener
cdp.Target.addEventListener("attachedToTarget", async ({ params }) => {
    const { sessionId } = params;
    // send command to enable runtime
    await cdp.Runtime.enable(null, sessionId);
    // send command to evaluate expression
    const { result } = await cdp.Runtime.evaluate({ expression: "1 + 1" }, sessionId);
    // display result in the console
    console.log(result.value);
});

// send command to create a new target
const { targetId } = await cdp.Target.createTarget({ url: "https://example.com" });
// send command to attach to the target
await cdp.Target.attachToTarget({ targetId });
```