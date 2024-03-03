# Introduction

simple-cdp is a JavaScript library to interact with the Chrome DevTools Protocol.

# Install

```sh
npm install simple-cdp
```

# Usage example

```js
// import the module
import cdp from "simple-cdp";

// wait for connection to be ready
await cdp.ready;

// add event listener
cdp.Target.addEventListener("attachedToTarget", async ({ detail: { params } }) => {
    const { sessionId } = params;
    // send command to enable runtime
    await cdp.Runtime.enable(null, sessionId);
    // send command to evaluate expression
    const { result } = await cdp.Runtime.evaluate({ expression: "1 + 1" }, sessionId);
    console.log(result.value);
});
// send command to create a new target
await Target.setAutoAttach({
    autoAttach: true,
    flatten: true,
    waitForDebuggerOnStart: false,
});
await cdp.Target.createTarget({ url: "https://example.com" });
```