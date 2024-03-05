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
import cdp from "@simple-cdp/simple-cdp";

// add event listener triggered when a session is attached to a target
cdp.Target.addEventListener("attachedToTarget", onAttachedToTarget);

// enable auto-attach to new targets
await cdp.Target.setAutoAttach({
    autoAttach: true,
    flatten: true,
    waitForDebuggerOnStart: false
});

// create a new target and navigate to https://example.com
const url = "https://example.com";
await cdp.Target.createTarget({ url });

async function onAttachedToTarget({ params }) {
    // get session ID
    const { sessionId } = params;

    // enable "Runtime" domain
    await cdp.Runtime.enable(null, sessionId);
    
    // evaluate JavaScript expression
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

// find the first page target
const targets = await cdp.getTargets();
const page = targets.find(target => target.type === "page");

// set the webSocketDebuggerUrl option
cdp.options.webSocketDebuggerUrl = page.webSocketDebuggerUrl;

// enabe "Page" domain
await cdp.Page.enable();

// navigate to https://example.com
const url = "https://example.com";
await cdp.Page.navigate({ url });

// enable "Runtime" domain
await cdp.Runtime.enable();

// evaluate JavaScript expression
const expression = "41 + 1";
const { result } = await cdp.Runtime.evaluate({ expression });

// display result in the console (i.e. 42)
console.log(result.value);
```