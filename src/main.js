const csvParser = require("./csv-parser");
const fs = require("fs");
const path = require("path");
const cluster = require('cluster');
const { Simulator, InvalidTaskNameError } = require("./simulator");
const { formatXML } = require("./xml-utils");

// Instances a simulator using given csv model file name and returns it.
// - 'acsUrl' is the url the Simulator uses when sending requests to ACS.
// - 'dataModel' is the csv file name that contains tr069 data from a CPE. This
// name should not be prefixed with the directory path and should be only the
// file name inside the ../models/ directory without the ".csv" file extension.
// - 'serialNumber' and 'macAddr' are used to uniquely identify the CPE.
// - 'verbose' is a flag that controls legacy messages printed when a
// connection is received.
// - 'periodicInformsDisabled' is a flag to disable automatic informs.
module.exports.createSimulator = function(
  acsUrl, dataModel, serialNumber, macAddr, verbose=false, periodicInformsDisabled=false
) {
  let device = new Map(); // Tr069 tree data structure.
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

// Exporting error class.
module.exports.InvalidTaskNameError = InvalidTaskNameError;
// Exporting XML formatting function.
module.exports.formatXML = formatXML;
