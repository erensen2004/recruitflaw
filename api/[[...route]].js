const handlerModule = require("../artifacts/api-server/dist/vercel.cjs");

module.exports = handlerModule.default ?? handlerModule;
