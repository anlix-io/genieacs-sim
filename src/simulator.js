"use strict";

const net = require("net");
const EventEmitter = require('events');
const xmlParser = require("./xml-parser");
const xmlUtils = require("./xml-utils");
const methods = require("./methods");
const diagnostics = require("./diagnostics");
const manipulations = require("./manipulations");

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
  constructor(name, request) {
    super(`TR-069 Method "${name}" not supported`);
    this.request = request; // xml parsed by the simulator.
  }
}


class Simulator extends EventEmitter {
  device; serialNumber; mac; acsUrl; verbose; periodicInformsDisabled;
  requestOptions; http; httpAgent; basicAuth; server;
  nextInformTimeout; pendingAcsRequest;
  pendingMessages = [];
  pendingEvents = [];
  diagnosticsStates = {}; // state data for available diagnostics.
  diagnosticQueue = []; // queue for diagnostic waiting to be executed.
  diagnosticSlots = 1; // only one diagnostic can run in any given time.

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
  // task: when a task is executed fully executed and responded to ACS
    // event passes the parsed task structure and a tree of objects;
  // diagnostic: when a diagnostic is finished ACS has been notified.
   // event passes the name of the finished diagnostic.

  constructor(device, serialNumber, mac, acsUrl, verbose, periodicInformsDisabled) {
    super();
    this.device = device;
    this.serialNumber = serialNumber;
    this.mac = mac;
    this.acsUrl = acsUrl || 'http://127.0.0.1:57547/';
    this.verbose = verbose;
    this.periodicInformsDisabled = periodicInformsDisabled; // controls sending periodic informs or not.

    // defining which cwmp model version this device is using.
    if (this.device.get('InternetGatewayDevice.ManagementServer.URL')) this.TR = 'tr069';
    else if (this.device.get('Device.ManagementServer.URL')) this.TR = 'tr181';

    for (let key in diagnostics) {
      this.diagnosticsStates[key] = {}; // initializing diagnostic state attributes.
      this.setResultForDiagnostic(key); // setting default result for diagnostic.
    }

    for (let key in manipulations) {
      this[key] = manipulations[key].bind(this);
    }
  }

  // turns on, off or toggles periodic informs.
  setPeriodicInforms(bool) {
    if (bool === undefined) { // toggling value.
      this.periodicInformsDisabled = !this.periodicInformsDisabled;
    } else if (bool.constructor === Boolean) { // setting value.
      this.periodicInformsDisabled = !bool; // variable name represents a negation.
    }

    if (this.periodicInformsDisabled) { // if on and should be off, clears timeout.
      clearTimeout(this.nextInformTimeout);
      this.nextInformTimeout = undefined;
    } else if (!this.nextInformTimeout) { // if off and should be on, sets next.
      this.setNextPeriodicInform();
    }
  }
  togglePeriodicInforms = () => setPeriodicInforms();

  // stops running simulator instance in background so it can gracefully shut down.
  async shutDown() {
    for (let key in this.diagnosticsStates) clearTimeout(this.diagnosticsStates[key].running);
    if (this.nextInformTimeout) {
      clearTimeout(this.nextInformTimeout);
      this.nextInformTimeout = undefined;
    }
    if (this.server) {
      await new Promise((resolve) => this.server.close(resolve));
      this.server = undefined;
    }
  }

  async start() { // this can throw an error.
    if (this.server) {
      console.log(`Simulator ${this.serialNumber} already started`);
      return;
    }

    let v; // auxiliary variable to store a simulator.device value of a key.

    if (v = this.device.get("DeviceID.SerialNumber")) v[1] = this.serialNumber;
    if (v = this.device.get("Device.DeviceInfo.SerialNumber")) v[1] = this.serialNumber;
    if (v = this.device.get("InternetGatewayDevice.DeviceInfo.SerialNumber")) v[1] = this.serialNumber;

    if (v = this.device.get("InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1.MACAddress")) v[1] = this.mac;
    else if (v = this.device.get("InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.MACAddress")) v[1] = this.mac;
    if (v = this.device.get("Device.Ethernet.Interface.1.MACAddress")) v[1] = this.mac;
    else if (v = this.device.get("Device.Ethernet.Interface.2.MACAddress")) v[1] = this.mac;
    else if (v = this.device.get("Device.Ethernet.Link.1.MACAddress")) v[1] = this.mac;


    let username = "";
    let password = "";
    if (v = this.device.get("Device.ManagementServer.Username")) {
      username = v[1];
      password = this.device.get("Device.ManagementServer.Password")[1];
    } else if (v = this.device.get("InternetGatewayDevice.ManagementServer.Username")) {
      username = v[1];
      password = this.device.get("InternetGatewayDevice.ManagementServer.Password")[1];
    }

    this.basicAuth = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");

    this.requestOptions = require("url").parse(this.acsUrl);
    this.http = require(this.requestOptions.protocol.slice(0, -1));
    this.httpAgent = new this.http.Agent({keepAlive: true, maxSockets: 1});

    let connectionRequestUrl = await this.listenForConnectionRequests();
    if (v = this.device.get("InternetGatewayDevice.ManagementServer.ConnectionRequestURL")) v[1] = connectionRequestUrl;
    else if (v = this.device.get("Device.ManagementServer.ConnectionRequestURL")) v[1] = connectionRequestUrl;

    // device is ready to receive requests.
    this.emit('started');

    await this.startSession();
    // device has already informed, to ACS, that it is online and has already 
    // received pending tasks from ACS.
    this.emit('ready');

    return this;
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
        const connectionRequestUrl = `http://${ip}:${port}/`;

        this.server = this.http.createServer((req, res) => {
          if (this.verbose) console.log(`Simulator ${this.serialNumber} got connection request`);
          res.end();
          this.emit('requested');
          this.startSession("6 CONNECTION REQUEST");
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

  async startSession(event) {
    // A session is ongoing when nextInformTimeout === null
    if (this.nextInformTimeout === null) {
      this.pendingAcsRequest = true;
      return;
    }
    this.pendingAcsRequest = false;
    clearTimeout(this.nextInformTimeout); // clears timeout in case there is an scheduled session.
    this.nextInformTimeout = null;

    try {
      let body = methods.inform(this, event);
      await this.sendRequest(body);
      await this.cpeRequest();
    } catch (e) {
      console.log('Simulator internal error.', e);
    }

    this.nextInformTimeout = undefined; // the soonest point where session has ended.
    
    this.setNextPeriodicInform(); // sets timeout for next periodic inform.
    
    this.runRequestedDiagnostics(); // executing diagnostic after session has ended.
    
    this.runPendingEvents(); // starting sessions that were waiting current session to finish.
  }

  async cpeRequest() {
    let pendingMessage;
    while (pendingMessage = this.pendingMessages.shift()) {
      await pendingMessage((body) => this.sendRequest(body));
    }
    const receivedXml = await this.sendRequest(null);
    await this.handleMethod(receivedXml);
  }

  async sendRequest(content, requestId) {
    let headers = {};
    if (!requestId) requestId = Math.random().toString(36).slice(-8);
    let xml = content ? createSoapDocument(requestId, content) : undefined;
    let body = xml ||  "";

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

  async handleMethod(xml) {
    if (!xml) {
      this.httpAgent.destroy();
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
      }
    }
    let method = methods[requestElement.localName];

    if (!method) {
      this.emit('error', new InvalidTaskNameError(requestElement.localName, requestElement));
      let body = createFaultResponse(9000, "Method not supported");
      let receivedXml = await this.sendRequest(body, requestId);
      return this.handleMethod(receivedXml);
    }

    let body = method(this, requestElement);
    let receivedXml = await this.sendRequest(body, requestId);
    // already received, processed, sent values back and got response from ACS.
    this.emit('task', requestElement);
    await this.handleMethod(receivedXml);
  }

  // sets a timeout to send a periodic inform using configured inform interval.
  setNextPeriodicInform() {
    // if there's a timeout already running, we'll stop it before setting another.
    if (this.nextInformTimeout) clearTimeout(this.nextInformTimeout);

    // if ACS has sent a request during a session, we start a new session.
    if (this.pendingAcsRequest) return this.startSession();

    // if periodic inform is disabled, we don't put 'startSession()' in a timeout.
    if (this.periodicInformsDisabled) return;

    let informInterval = 10;
    let v;
    if (v = this.device.get("Device.ManagementServer.PeriodicInformInterval"))
      informInterval = parseInt(v[1]);
    else if (v = this.device.get("InternetGatewayDevice.ManagementServer.PeriodicInformInterval"))
      informInterval = parseInt(v[1]);

    this.nextInformTimeout = setTimeout(this.startSession.bind(this), 1000*informInterval);
  }

  // Given a 'result' key and a diagnostic 'name', sets next diagnostic result for the function that
  // represents that key. In case of error, returns a string containing the error message, else returns nothing.
  setResultForDiagnostic(name, result='default') {
    const diagnostic = diagnostics[name];
    if (!diagnostic) {
      return `Simulator ${this.serialNumber} has no diagnostic named '${name}'.`;
    }

    const state = this.diagnosticsStates[name];
    if (state.running && state.running._destroyed === false) {
      console.log(`Simulator ${this.serialNumber} warning: '${name}' diagnostic already running. `+
        `You might want to set the expected result before initiating the diagnostic.`);
    }

    const nextResultFunc = diagnostic.results[result];
    if (!nextResultFunc) {
      return `Simulator ${this.serialNumber} has no '${result}' result `+
        `that can be expected for a '${name}' diagnostic.`
    }

    state.result = nextResultFunc;
  }

  async runRequestedDiagnostics() {
    // if diagnostic execution is fully occupied we don't execute anything this round.
    if (!this.diagnosticSlots) return;

    let diagnostic;
    while (diagnostic = this.diagnosticQueue.shift()) {
      this.diagnosticSlots--; // consuming a diagnostic execution slot.
      await diagnostic()
        .catch(() => {}); // interrupted diagnostics are rejected.
      this.diagnosticSlots++; // returning a diagnostic execution slot.
    }
  }

  async runPendingEvents(eventFunc) {
    if (eventFunc) this.pendingEvents.push(eventFunc);

    // if there is an on going session.
    if (this.nextInformTimeout === null) return;

    let pendingEvent;
    while (pendingEvent = this.pendingEvents.shift()) {
      await pendingEvent();
    }
  }
}

exports.Simulator = Simulator;
exports.InvalidTaskNameError = InvalidTaskNameError;
