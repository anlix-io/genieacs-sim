"use strict";

const net = require("net");
const EventEmitter = require('events');
const xmlParser = require("./xml-parser");
const xmlUtils = require("./xml-utils");
const methods = require("./methods");

const NAMESPACES = {
  "soap-enc": "http://schemas.xmlsoap.org/soap/encoding/",
  "soap-env": "http://schemas.xmlsoap.org/soap/envelope/",
  "xsd": "http://www.w3.org/2001/XMLSchema",
  "xsi": "http://www.w3.org/2001/XMLSchema-instance",
  "cwmp": "urn:dslforum-org:cwmp-1-0"
};


function createSoapDocument(id, body) {
  let headerNode = xmlUtils.node(
    "soap-env:Header",
    {},
    xmlUtils.node("cwmp:ID", { "soap-env:mustUnderstand": 1 }, xmlParser.encodeEntities(id))
  );

  let bodyNode = xmlUtils.node("soap-env:Body", {}, body);
  let namespaces = {};
  for (let prefix in NAMESPACES)
    namespaces[`xmlns:${prefix}`] = NAMESPACES[prefix];

  let env = xmlUtils.node("soap-env:Envelope", namespaces, [headerNode, bodyNode]);

  return `<?xml version="1.0" encoding="UTF-8"?>\n${env}`;
}


function createFaultResponse(code, message) {
  let fault = xmlUtils.node(
    "detail",
    {},
    xmlUtils.node("cwmp:Fault", {}, [
      xmlUtils.node("FaultCode", {}, code),
      xmlUtils.node("FaultString", {}, xmlParser.encodeEntities(message))
    ])
  );

  let soapFault = xmlUtils.node("soap-env:Fault", {}, [
    xmlUtils.node("faultcode", {}, "Client"),
    xmlUtils.node("faultstring", {}, "CWMP fault"),
    fault
  ]);

  return soapFault;
}


class InvalidTaskNameError extends Error {
  constructor(name, xml, parsed) {
    super(`TR-069 Method "${name}" not supported`);
    this.xml = xml;
    this.parsed = parsed; // xml parsed by the simulator.
  }
}

class Simulator extends EventEmitter {
  device; serialNumber; macaddr; acsUrl; verbose; turnOffInforms;
  requestOptions; http; httpAgent; basicAuth;
  nextInformTimeout; pendingInform;
  pending = [];
  server;

  // simulator emits the following events
  // started: after it's already listening for connection requests from ACS.
    // no argument.
  // ready: after it has finished it's post boot communication with the ACS.
    // no argument.
  // requested: when it receives a connection request.
    // event passes an http.IncomingMessage instance as argument.
  // sent: when it sends a request to the ACS.
    // event passes an http.ClientRequest instance as argument.
  // response: when it receives a response from the ACS after sending a request to it.
    // event passes an http.IncomingMessage instance as argument.
  // error: when a connection error happens or when a task name is invalid.
    // event passes an error object.

  constructor(dataModel, serialNumber, macaddr, acsUrl, verbose, turnOffInforms) {
    super();
    this.device = dataModel;
    this.serialNumber = serialNumber;
    this.macaddr = macaddr;
    this.acsUrl = acsUrl || 'http://127.0.0.1:57547/';
    this.verbose = verbose;
    this.turnOffInforms = turnOffInforms; // controls sending informs or not.
  }

  async sendRequest(xml) {
    let headers = {};
    let body = xml || "";

    headers["Content-Length"] = body.length;
    headers["Content-Type"] = "text/xml; charset=\"utf-8\"";
    headers["Authorization"]= this.basicAuth;

    if (this.device._cookie)
      headers["Cookie"] = this.device._cookie;

    let options = {
      method: "POST",
      headers: headers,
      agent: this.httpAgent
    };

    Object.assign(options, this.requestOptions);

    return new Promise((resolve) => { // emitting all known errors.
      let request = this.http.request(options, (response) => {
        let chunks = [];
        let bytes = 0;

        response.on("data", (chunk) => {
          chunks.push(chunk);
          return bytes += chunk.length;
        }).on("end", () => {
          let offset = 0;
          body = Buffer.allocUnsafe(bytes);

          chunks.forEach((chunk) => {
            chunk.copy(body, offset, 0, chunk.length);
            return offset += chunk.length;
          });

          response.body = body.toString();

          if (Math.floor(response.statusCode / 100) !== 2) {
            let {method, href, headers} = options;
            this.emit('error', new Error(`Unexpected response code ${response.statusCode} `+
              `on '${JSON.stringify({method, href, headers})}': ${body}`));
            return;
          }

          if (+response.headers["Content-Length"] > 0 || body.length > 0)
            xml = xmlParser.parseXml(response.body);
          else
            xml = null;

          if (response.headers["set-cookie"])
            this.device._cookie = response.headers["set-cookie"];

          this.emit('response', response);
          resolve(xml);
        }).on("error", (e) => {
          this.emit('error', e);
        });
      });

      request.on('error', (e) => {
        this.emit('error', e);
      });

      let requestTimeout = 30000;
      request.setTimeout(requestTimeout, (err) => {
        this.emit('error', 
          new Error(`Socket timed out after ${requestTimeout/1000} seconds.`));
      });

      request.body = body;
      request.end(body, () => {
        this.emit('sent', request);
      });
    });
  }

  async startSession(event) {
    this.nextInformTimeout = null;
    this.pendingInform = false;
    const requestId = Math.random().toString(36).slice(-8);

    try {
      let body = methods.inform(this, event);
      let xml = createSoapDocument(requestId, body);
      await this.sendRequest(xml);
      await this.cpeRequest();
    } catch (e) {
      console.log('Simulator internal error', e);
    }
  }

  async cpeRequest() {
    let pendingTask;
    while (pendingTask = this.pending.shift()) {
      const requestId = Math.random().toString(36).slice(-8);
      const body = pendingTask();
      let xml = createSoapDocument(requestId, body);
      await this.sendRequest(xml)
    }
    let receivedXml = await this.sendRequest(null);
    await this.handleMethod(receivedXml);
  }

  async handleMethod(xml) {
    if (!xml) {
      this.httpAgent.destroy();
      if (this.turnOffInforms) return; // prevents excess messages during controlled tests.

      let informInterval = 10;
      if (this.device["Device.ManagementServer.PeriodicInformInterval"])
        informInterval = parseInt(this.device["Device.ManagementServer.PeriodicInformInterval"][1]);
      else if (this.device["InternetGatewayDevice.ManagementServer.PeriodicInformInterval"])
        informInterval = parseInt(this.device["InternetGatewayDevice.ManagementServer.PeriodicInformInterval"][1]);

      this.nextInformTimeout = setTimeout(
        this.startSession.bind(this),
        this.pendingInform ? 0 : 1000 * informInterval,
      );

      return;
    }

    let headerElement, bodyElement;
    let envelope = xml.children[0];
    for (const c of envelope.children) {
      switch (c.localName) {
        case "Header":
          headerElement = c;
          break;
        case "Body":
          bodyElement = c;
          break;
      }
    }

    let requestId;
    for (let c of headerElement.children) {
      if (c.localName === "ID") {
        requestId = xmlParser.decodeEntities(c.text);
        break;
      }
    }

    let requestElement;
    for (let c of bodyElement.children) {
      if (c.name.startsWith("cwmp:")) {
        requestElement = c;
        break;
      }''
    }
    let method = methods[requestElement.localName];

    if (!method) {
      this.emit('error', new InvalidTaskNameError(requestElement.localName, xml, requestElement));
      let body = createFaultResponse(9000, "Method not supported");
      let xml = createSoapDocument(requestId, body);
      let receivedXml = await this.sendRequest(xml);
      return this.handleMethod(receivedXml);
    }

    let body = method(this, requestElement);
    let xmlToSend = createSoapDocument(requestId, body);
    let receivedXml = await this.sendRequest(xmlToSend);
    // already received, processed, sent values back and got response from ACS.
    this.emit('task', {
      name: requestElement.localName,
      xml: xml,
      parsed: requestElement,
    });
    await this.handleMethod(receivedXml);
  }

  async listenForConnectionRequests() {
    return new Promise((resolve, reject) => {
      let ip, port;
      // Start a dummy socket to get the used local ip
      let socket = net.createConnection({
        port: this.requestOptions.port,
        host: this.requestOptions.hostname,
        family: 4
      })
      .on("error", reject)
      .on("connect", () => {
        ip = socket.address().address;
        port = socket.address().port + 1;
        socket.end();
      })
      .on("close", () => {
        let connectionRequestUrl = `http://${ip}:${port}/`;

        this.server = this.http.createServer((req, res) => {
          if (this.verbose) console.log(`Simulator ${this.serialNumber} got connection request`);

          let body = '';
          req.on('readable', () => {
            body += req.read();
          }).on('end', () => {
            res.end();
            req.body = body.toString(); // usually it's just 'null'.
            this.emit('requested', req);
          }).on('error', (e) => {
            this.emit('error', e)
          });

          // A session is ongoing when nextInformTimeout === null
          if (this.nextInformTimeout === null) {
            this.pendingInform = true;
          } else {
            clearTimeout(this.nextInformTimeout);
            this.nextInformTimeout = setTimeout(() => this.startSession("6 CONNECTION REQUEST"), 0);
          }
        }).listen(port, ip, (err) => {
          if (err) throw err;
          if (this.verbose) {
            console.log(`Simulator ${this.serialNumber} listening for connection `+
              `requests on ${connectionRequestUrl}`);
          }
          resolve(connectionRequestUrl);
        });
      });
    });
  }

  // stops running simulator instance in background so it can gracefully shut down.
  async shutDown() {
    if (this.nextInformTimeout) clearTimeout(this.nextInformTimeout);
    if (this.server) return new Promise((resolve) => this.server.close(resolve));
  }

  async start() { // this can throw an error.
    if (this.device["DeviceID.SerialNumber"])
      this.device["DeviceID.SerialNumber"][1] = this.serialNumber;
    if (this.device["Device.DeviceInfo.SerialNumber"])
      this.device["Device.DeviceInfo.SerialNumber"][1] = this.serialNumber;
    if (this.device["InternetGatewayDevice.DeviceInfo.SerialNumber"])
      this.device["InternetGatewayDevice.DeviceInfo.SerialNumber"][1] = this.serialNumber;

    if (this.device["InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1.MACAddress"])
      this.device["InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1.MACAddress"][1] = this.macaddr;

    let username = "";
    let password = "";
    if (this.device["Device.ManagementServer.Username"]) {
      username = this.device["Device.ManagementServer.Username"][1];
      password = this.device["Device.ManagementServer.Password"][1];
    } else if (this.device["InternetGatewayDevice.ManagementServer.Username"]) {
      username = this.device["InternetGatewayDevice.ManagementServer.Username"][1];
      password = this.device["InternetGatewayDevice.ManagementServer.Password"][1];
    }

    this.basicAuth = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");

    this.requestOptions = require("url").parse(this.acsUrl);
    this.http = require(this.requestOptions.protocol.slice(0, -1));
    this.httpAgent = new this.http.Agent({keepAlive: true, maxSockets: 1});

    let connectionRequestUrl = await this.listenForConnectionRequests();
    if (this.device["InternetGatewayDevice.ManagementServer.ConnectionRequestURL"]) {
      this.device["InternetGatewayDevice.ManagementServer.ConnectionRequestURL"][1] = connectionRequestUrl;
    } else if (this.device["Device.ManagementServer.ConnectionRequestURL"]) {
      this.device["Device.ManagementServer.ConnectionRequestURL"][1] = connectionRequestUrl;
    }
    // device is ready to receive requests.
    this.emit('started');

    await this.startSession();
    // device has already informed to ACS that it's online and has already 
    // received pending tasks from ACS.
    this.emit('ready');

    return this;
  }
}

exports.Simulator = Simulator;
exports.InvalidTaskNameError = InvalidTaskNameError;
