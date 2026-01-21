const loaded = require("./app");

// app.js export 형태가 뭐든( module.exports = app  /  module.exports = { app } ) 둘 다 대응
const app =
  (loaded && typeof loaded.listen === "function" && loaded) ||
  (loaded && loaded.app && typeof loaded.app.listen === "function" && loaded.app);

if (!app) {
  throw new Error("api-wms: src/app.js must export an express app (module.exports = app OR { app })");
}

const port = Number(process.env.PORT || 3000);
app.listen(port, "0.0.0.0", () => {
  console.log(`api-wms listening on ${port}`);
});
