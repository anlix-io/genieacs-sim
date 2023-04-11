const csvParser = require("./csv-parser");
const fs = require("fs");
const path = require("path");
const cluster = require('cluster');
const { Simulator, InvalidTaskNameError } = require("./simulator");
const { formatXML } = require("./xml-utils");

const fakeGenie = {};

fakeGenie.createSimulator = function(
  acsUrl, dataModel, serialNumber, macAddr, verbose=false, periodicInformsDisabled=false
) {
  let device;
  const data = fs.readFileSync(dataModel);
  if (path.parse(dataModel).ext.toLowerCase() === '.csv') {
    const rows = csvParser.reduce(csvParser.parseCsv(data.toString()));
    device = {};
    for (const row of rows) {
      const isObject = row["Object"] === "true";
      let id = row["Parameter"];
      if (isObject) id += ".";

      device[id] = [row["Writable"] === "true"];
      if (!isObject) {
        device[id].push(row["Value"] || "");
        if (row["Value type"] != null) device[id].push(row["Value type"]);
      }
    }
  } else {
    device = JSON.parse(data);
  }
  return new Simulator(device, serialNumber, macAddr, acsUrl, verbose, periodicInformsDisabled);
}

fakeGenie.InvalidTaskNameError = InvalidTaskNameError;
fakeGenie.formatXML = formatXML;

module.exports = fakeGenie;