let fakeGenie = {}

const simulator = require("./simulator");
const csvParser = require("./csv-parser");
const fs = require("fs");
const path = require("path");
const cluster = require('cluster');

fakeGenie.runSimulation = function(acsUrl, dataModel, serialNumber, macAddr, verbose=false) {
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
  return simulator.start(device, serialNumber, macAddr, acsUrl, verbose);
}

module.exports = fakeGenie;