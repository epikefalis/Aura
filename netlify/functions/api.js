const serverlessExpress = require("@vendia/serverless-express");
const { app } = require("../../server/index");

exports.handler = serverlessExpress({ app });
