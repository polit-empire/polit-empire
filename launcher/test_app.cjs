const { JSDOM } = require('jsdom');

JSDOM.fromURL("http://localhost:3000", {
  runScripts: "dangerously",
  resources: "usable"
}).then(dom => {
  dom.window.addEventListener('error', (event) => {
    console.error("DOM ERROR:", event.error);
  });
  dom.window.addEventListener('unhandledrejection', (event) => {
    console.error("UNHANDLED REJECTION:", event.reason);
  });
  console.log("JSDOM initialized. Waiting a bit...");
  setTimeout(() => {
    console.log("Done waiting.");
  }, 3000);
});
