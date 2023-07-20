"use strict";

const http = require("http");
const https = require("https");
const xmlParser = require("./xml-parser");
const xmlUtils = require("./xml-utils");
const diagnostics = require("./diagnostics");
const models = require('./models');

const INFORM_PARAMS = [
  "Device.DeviceInfo.SpecVersion",
  "InternetGatewayDevice.DeviceInfo.SpecVersion",
  "Device.DeviceInfo.HardwareVersion",
  "InternetGatewayDevice.DeviceInfo.HardwareVersion",
  "Device.DeviceInfo.SoftwareVersion",
  "InternetGatewayDevice.DeviceInfo.SoftwareVersion",
  "Device.DeviceInfo.ProvisioningCode",
  "InternetGatewayDevice.DeviceInfo.ProvisioningCode",
  "Device.ManagementServer.ParameterKey",
  "InternetGatewayDevice.ManagementServer.ParameterKey",
  "Device.ManagementServer.ConnectionRequestURL",
  "InternetGatewayDevice.ManagementServer.ConnectionRequestURL",
  "Device.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress",
  "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress",
  "Device.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress",
  "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress",
  "InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1.MACAddress"
];


function inform(simulator, event) {
  const device = simulator.device;
  let v;
  let manufacturer = "";
  if (v = device.get("DeviceID.Manufacturer")) {
    manufacturer = xmlUtils.node(
      "Manufacturer",
      {},
      xmlParser.encodeEntities(v[1])
    );
  } else if (v = device.get("Device.DeviceInfo.Manufacturer")) {
    manufacturer = xmlUtils.node(
      "Manufacturer",
      {}, 
      xmlParser.encodeEntities(v[1])
    );
  } else if (v = device.get("InternetGatewayDevice.DeviceInfo.Manufacturer")) {
    manufacturer = xmlUtils.node(
      "Manufacturer",
      {},
      xmlParser.encodeEntities(v[1])
    );
  }

  let oui = "";
  if (v = device.get("DeviceID.OUI")) {
    oui = xmlUtils.node(
      "OUI",
      {},
      xmlParser.encodeEntities(v[1])
    );
  } else if (v = device.get("Device.DeviceInfo.ManufacturerOUI")) {
    oui = xmlUtils.node(
      "OUI",
      {},
      xmlParser.encodeEntities(v[1])
    );
  } else if (v = device.get("InternetGatewayDevice.DeviceInfo.ManufacturerOUI")) {
    oui = xmlUtils.node(
      "OUI",
      {},
      xmlParser.encodeEntities(v[1])
    );
  }

  let productClass = "";
  if (v = device.get("DeviceID.ProductClass")) {
    productClass = xmlUtils.node(
      "ProductClass",
      {},
      xmlParser.encodeEntities(v[1])
    );
  } else if (v = device.get("Device.DeviceInfo.ProductClass")) {
    productClass = xmlUtils.node(
      "ProductClass",
      {},
      xmlParser.encodeEntities(v[1])
    );
  } else if (v = device.get("InternetGatewayDevice.DeviceInfo.ProductClass")) {
    productClass = xmlUtils.node(
      "ProductClass",
      {},
      xmlParser.encodeEntities(v[1])
    );
  }

  let serialNumber = "";
  if (v = device.get("DeviceID.SerialNumber")) {
    serialNumber = xmlUtils.node(
      "SerialNumber",
      {},
      xmlParser.encodeEntities(v[1])
    );
  } else if (v = device.get("Device.DeviceInfo.SerialNumber")) {
    serialNumber = xmlUtils.node(
      "SerialNumber",
      {},
      xmlParser.encodeEntities(v[1])
      );
  } else if (v = device.get("InternetGatewayDevice.DeviceInfo.SerialNumber")) {
    serialNumber = xmlUtils.node(
      "SerialNumber",
      {},
      xmlParser.encodeEntities(v[1])
    );
  }

  let macAddr = "";
  if (v = device.get("InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1.MACAddress")) {
    macAddr = xmlUtils.node(
      "MACAddress",
      {},
      xmlParser.encodeEntities(v[1])
    );
  }

  let deviceId = xmlUtils.node("DeviceId", {}, [manufacturer, oui, productClass, serialNumber]);

  let eventStruct = xmlUtils.node(
    "EventStruct",
    {},
    [
      xmlUtils.node("EventCode", {}, event || "2 PERIODIC"),
      xmlUtils.node("CommandKey")
    ]
  );

  let evnt = xmlUtils.node("Event", {
    "soap-enc:arrayType": "cwmp:EventStruct[1]"
  }, eventStruct);

  let params = [];
  for (let p of INFORM_PARAMS) {
    let param = device.get(p);
    if (!param)
      continue;

    params.push(xmlUtils.node("ParameterValueStruct", {}, [
      xmlUtils.node("Name", {}, p),
      xmlUtils.node("Value", {"xsi:type": param[2]}, xmlParser.encodeEntities(param[1]))
    ]));
  }

  let parameterList = xmlUtils.node("ParameterList", {
    "soap-enc:arrayType": `cwmp:ParameterValueStruct[${INFORM_PARAMS.length}]`
  }, params);

  let inform = xmlUtils.node("cwmp:Inform", {}, [
    deviceId,
    evnt,
    xmlUtils.node("MaxEnvelopes", {}, "1"),
    xmlUtils.node("CurrentTime", {}, new Date().toISOString()),
    xmlUtils.node("RetryCount", {}, "0"),
    parameterList
  ]);

  return inform;
}

function getSortedPaths(device) {
  if (device._sortedPaths) return device._sortedPaths;
  const ignore = new Set(["DeviceID", "Downloads", "Tags", "Events", "Reboot", "FactoryReset", "VirtalParameters"]);
  device._sortedPaths = Array.from(device.keys()).filter(p => p[0] !== "_" && !ignore.has(p.split(".")[0])).sort();
  return device._sortedPaths;
}


function GetParameterNames(simulator, request) {
  const device = simulator.device;
  let parameterNames = getSortedPaths(device);

  let parameterPath, nextLevel;
  for (let c of request.children) {
    switch (c.name) {
      case "ParameterPath":
        parameterPath = c.text;
        break;
      case "NextLevel":
        nextLevel = Boolean(JSON.parse(c.text));
        break;
    }
  }

  let parameterList = [];

  if (nextLevel) {
    for (let p of parameterNames) {
      if (p.startsWith(parameterPath) && p.length > parameterPath.length + 1) {
        let i = p.indexOf(".", parameterPath.length + 1);
        if (i === -1 || i === p.length - 1)
          parameterList.push(p);
      }
    }
  } else {
    for (let p of parameterNames) {
      if (p.startsWith(parameterPath))
        parameterList.push(p);
    }
  }

  let params = [];
  for (let p of parameterList) {
    params.push(
      xmlUtils.node("ParameterInfoStruct", {}, [
        xmlUtils.node("Name", {}, p),
        xmlUtils.node("Writable", {}, String(device.get(p)[0]))
      ])
    );
  }

  let response = xmlUtils.node(
    "cwmp:GetParameterNamesResponse",
    {},
    xmlUtils.node(
      "ParameterList",
      { "soap-enc:arrayType": `cwmp:ParameterInfoStruct[${parameterList.length}]` },
      params
    )
  );

  return response;
}


function GetParameterValues(simulator, request) {
  const device = simulator.device;
  let parameterNames = request.children[0].children;

  let params = []
  for (let p of parameterNames) {
    let name = p.text;
    let [_, value, type] = device.get(name);
    let valueStruct = xmlUtils.node("ParameterValueStruct", {}, [
      xmlUtils.node("Name", {}, name),
      xmlUtils.node("Value", { "xsi:type": type }, xmlParser.encodeEntities(value))
    ]);
    params.push(valueStruct);
  }

  let response = xmlUtils.node(
    "cwmp:GetParameterValuesResponse",
    {},
    xmlUtils.node(
      "ParameterList",
      { "soap-enc:arrayType": "cwmp:ParameterValueStruct[" + parameterNames.length + "]" },
      params
    )
  );

  return response;
}


function SetParameterValues(simulator, request) {
  const device = simulator.device;
  let parameterValues = request.children[0].children;

  const modified = {}; // received parameters to be set.
  for (let p of parameterValues) {
    let name, value;
    for (let c of p.children) {
      switch (c.localName) {
        case "Name":
          name = c.text;
          break;
        case "Value":
          value = c;
          break;
      }
    }

    const v = device.get(name);
    v[1] = xmlParser.decodeEntities(value.text);
    v[2] = xmlParser.parseAttrs(value.attrs).find(a => a.localName === "type").value;
    modified[name] = true;
  }

  // running each diagnostic logic.
  // their logic includes whether they have to be executed or not.
  for (let key in diagnostics) {
    diagnostics[key].run(simulator, modified);
  }

  let response = xmlUtils.node("cwmp:SetParameterValuesResponse", {}, xmlUtils.node("Status", {}, "0"));
  return response;
}


function AddObject(simulator, request) {
  const device = simulator.device;
  let objectName = request.children[0].text;
  let instanceNumber;
  
  const deviceId = device.get('DeviceID.ID');
  const model = models[deviceId && deviceId[1]];

  if (model && model.addObject && model.addObject[objectName]) {
    instanceNumber = model.addObject[objectName](simulator, objectName);
  } else {
    instanceNumber = 1;

    while (device.has(`${objectName}${instanceNumber}.`))
      instanceNumber += 1;

    device.set(`${objectName}${instanceNumber}.`, [true]);

    const defaultValues = {
      "xsd:boolean": "false",
      "xsd:int": "0",
      "xsd:unsignedInt": "0",
      "xsd:dateTime": "0001-01-01T00:00:00Z"
    };

    for (let p of getSortedPaths(device)) {
      if (p.startsWith(objectName) && p.length > objectName.length) {
        let n = `${objectName}${instanceNumber}${p.slice(p.indexOf(".", objectName.length))}`;
        if (!device.has(n)) {
          const v = device.get(p);
          device.set(n, [v[0], defaultValues[v[2]] || "", v[2]]);
        }
      }
    }
  }

  let response = xmlUtils.node("cwmp:AddObjectResponse", {}, [
    xmlUtils.node("InstanceNumber", {}, String(instanceNumber)),
    xmlUtils.node("Status", {}, "0")
  ]);
  delete device._sortedPaths;
  return response;
}


function DeleteObject(simulator, request) {
  const device = simulator.device;
  let objectName = request.children[0].text;

  for (let p of device.keys()) {
    if (p.startsWith(objectName))
      device.delete(p);
  }

  let response = xmlUtils.node("cwmp:DeleteObjectResponse", {}, xmlUtils.node("Status", {}, "0"));
  delete device._sortedPaths;
  return response;
}


function Download(simulator, request) {
  let commandKey, url;
  for (let c of request.children) {
    switch (c.name) {
      case "CommandKey":
        commandKey = xmlParser.decodeEntities(c.text);
        break;
      case "URL":
        url = xmlParser.decodeEntities(c.text);
        break;
    }
  }

  let faultCode = "9010";
  let faultString = "Download timeout";

  let client;
  if (url.startsWith("http://")) client = http;
  else if (url.startsWith("https://")) client = https;

  if (client) {
    client.get(url, (res) => {
      if (res.statusCode === 200) {
        faultCode = "0";
        faultString = "";
      } else {
        faultCode = "9016";
        faultString = `Unexpected response ${res.statusCode}`;
        res.resume(); // Consume response data to free up memory.
        return;
      }

      let body = [];
      res.on("data", (chunk) => body.push(chunk));
      res.on("end", async () => {
        body = body.join('');
        
        // if data is in JSON format containing the new software version,
        // we update the 'SoftwareVersion' in the model tree.
        let data;
        try {
          data = JSON.parse(body.toString('utf8'));
        } catch (e) {
          // in case of error, ignore content.
          console.log('Error parsing Download body to json.', e)
          console.log('File content:', body)
        }
        // console.log('download data', data);
        if (data !== undefined && data.constructor === Object && data.version) {
          simulator.device.get(simulator.TR === 'tr098'
            ? 'InternetGatewayDevice.DeviceInfo.SoftwareVersion'
            : 'Device.DeviceInfo.SoftwareVersion')[1] = data.version;
        }

        // creating a new session where transfer complete message is sent.
        // waiting 2 seconds before sending pending 'TransferComplete'.
        setTimeout(() => simulator.runPendingEvents(() => simulator.startSession()), 2000);
      });
    }).on("error", (err) => {
      faultString = err.message;
    });
  }

  const startTime = new Date();

  simulator.pendingMessages.push(async (send) => {
    let fault = xmlUtils.node("FaultStruct", {}, [
      xmlUtils.node("FaultCode", {}, faultCode),
      xmlUtils.node("FaultString", {}, xmlParser.encodeEntities(faultString))
    ]);
    let request = xmlUtils.node("cwmp:TransferComplete", {}, [
      xmlUtils.node("CommandKey", {}, commandKey),
      xmlUtils.node("StartTime", {}, startTime.toISOString()),
      xmlUtils.node("CompleteTime", {}, new Date().toISOString()),
      fault
    ]);
    return send(request);
  });

  let response = xmlUtils.node("cwmp:DownloadResponse", {}, [
    xmlUtils.node("Status", {}, "1"),
    xmlUtils.node("StartTime", {}, "0001-01-01T00:00:00Z"),
    xmlUtils.node("CompleteTime", {}, "0001-01-01T00:00:00Z")
  ]);

  return response;
}


exports.inform = inform;
exports.GetParameterNames = GetParameterNames;
exports.GetParameterValues = GetParameterValues;
exports.SetParameterValues = SetParameterValues;
exports.AddObject = AddObject;
exports.DeleteObject = DeleteObject;
exports.Download = Download;
