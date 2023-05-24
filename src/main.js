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
  let device = new Map();
  const data = fs.readFileSync(`${__dirname}/../models/${dataModel}.csv`);
  const rows = csvParser.reduce(csvParser.parseCsv(data.toString()));
  for (const row of rows) {
    const isObject = row["Object"] === "true";
    let id = row["Parameter"];
    if (isObject) id += ".";

    const v = [row["Writable"] === "true"];
    if (!isObject) {
      v.push(row["Value"] || "");
      const t = row["Value type"];
      if (t != null) v.push(t);
    }
    device.set(id, v);
  }
  return new Simulator(device, serialNumber, macAddr, acsUrl, verbose, periodicInformsDisabled);
}

fakeGenie.InvalidTaskNameError = InvalidTaskNameError;
fakeGenie.formatXML = formatXML;

module.exports = fakeGenie;