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

```js
// import the module
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

async function onAttachedToTarget ({ params }) => {
    // get session ID
    const { sessionId } = params;

    // send command to enable runtime
    await cdp.Runtime.enable(null, sessionId);
    
    // send command to evaluate expression
    const expression = "1 + 1";
    const { result } = await cdp.Runtime.evaluate({ expression }, sessionId);
    
    // display result in the console
    console.log(result.value);
}
```