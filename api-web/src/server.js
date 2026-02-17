const { app } = require("./app");
const { port } = require("./config");

function start() {
  app.listen(port, "0.0.0.0", () => {
    console.log("[api-web] listening on :" + port);
  });
}

start();
