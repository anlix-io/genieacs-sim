let fakeGenie = {}

const simulator = require("./simulator");
const csvParser = require("./csv-parser");
const fs = require("fs");
const path = require("path");
const cluster = require("cluster");


fakeGenie.runSimulation = function(acsUrl, dataModel, serialNumber, macAddr) {
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
  simulator.start(device, serialNumber, macAddr, acsUrl);
}

fakeGenie.forkSimulations = function(acsUrl, qty, serialNumber, dataModel, intervalMs) {
  if (!/^(http|https):\/\//.test(acsUrl)) {
    console.error("Invalid ACS URL");
    process.exit(1);
  }
  for (let mac = 211866461732864, i = 0; i < qty; ++ i) {
    setTimeout(function() {
      mac = mac + 3;
      var nmac = new Array( 6 ).join( '00' )    // '000000000000'
        .match( /../g )            // [ '00', '00', '00', '00', '00', '00' ]
        .concat( 
            mac.toString( 16 )     // "4a8926c44578"
              .match( /.{1,2}/g ) // ["4a", "89", "26", "c4", "45", "78"]
        )                          // ["00", "00", "00", "00", "00", "00", "4a", "89", "26", "c4", "45", "78"]
        .reverse()                 // ["78", "45", "c4", "26", "89", "4a", "00", "00", "00", "00", "00", "00", ]
        .slice( 0, 6 )             // ["78", "45", "c4", "26", "89", "4a" ]
        .join( ':' );

      let env = {
        "MAC_ADDR": nmac,
        "SERIAL_NUMBER": `00000${serialNumber + i}`.slice(-6),
        "ACS_URL": acsUrl,
        "DATA_MODEL": dataModel,
      };
      let worker = cluster.fork(env);
      worker.env = env;
    }, i  * intervalMs)
  }
}

module.exports = fakeGenie;