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
  /**
   * Simulator, by extending EventEmitter, emits the following events:
   * 'started' - After it's already listening for connection requests from ACS.
   * No argument in callback.
   * 
   * 'ready': After it has finished its post boot communication with the ACS.
   * No argument in callback.
   * 
   * 'requested'- When it receives a connection request.
   * No argument in callback.
   * 
   * 'sent' - At every request sent to the ACS.
   * Passes an http.ClientRequest instance as argument in callback.
   * 
   * 'response' - At every a response received from the ACS.
   * Passes an http.IncomingMessage instance as argument in callback.
   * 
   * 'error' - When a connection error happens or when a task name is invalid.
   * Passes an error object as argument in callback.
   * 
   * 'task' - After ACS receives confirmation that a task has run.
   * Passes the task structure as argument in callback.
   * 
   * 'diagnostic' - After ACS has been notified that a diganostic has finished.
   * Passes the name of the finished diagnostic as argument in callback.
   * 
   * 'sessionStart' - When a tr069 session is about to start.
   * Passes the cwmp event string as argument in callback.
   * 
   * 'sessionEnd' - After both ACS and CPE send empty strings.
   * Passes the cwmp event string as argument in callback.
   * */


  serialNumber; mac; // Simulator identification values.
  device; // Data structure to hold tr069 data (tr069 tree).
  acsUrl; // Simulator will send requests to ACS though this url.
  verbose; // Flag to control legacy print messages of connections received.
  periodicInformsDisabled; // Flag to disable automatic informs.

  // Attributes used by basic communication between ACS and Simulator.
  requestOptions; http; httpAgent; basicAuth; server;
  onGoingSession; // Read only flags that indicates a session is currently running.
  nextInformTimeout; // Timeout object for the next automatic inform. Or undefined.
  // Internal flag to indicate the ACS sent a requested during an session.
  pendingAcsRequest;
  // Read only flag to inform if the Class instance is running.
  enabled;
  // Array of CWMP messages to be sent at the start of the next session.
  pendingMessages = [];
  // Array of actions that will run, sequentially, after current session
  // finishes or, if no sessions is running, right away.
  pendingActions = [];

  // Diagnostics data. Should not be touched by simulator users./ 
  // State data for available diagnostics. Each key is the name of an available
  // diagnostic and each value is state data for the corresponding diagnostic.
  // Each diagnostic holds the following state data:
  // - running: Timeout object for the timeout that simulates the diagnostic running in background.
  // - reject: Promise.reject function to interrupt the simulated diagnostic
  // - result: Function where the consequences of a diagnostic being run is set.
  diagnosticsStates = {};
  diagnosticQueue = []; // Queue for diagnostics waiting to be executed.
  diagnosticSlots = 1; // Controls the amount diagnostics running in parallel.

  constructor(device, serialNumber, mac, acsUrl, verbose, periodicInformsDisabled) {
    super();
    this.device = device;
    this.serialNumber = serialNumber;
    this.mac = mac;
    this.acsUrl = acsUrl || 'http://127.0.0.1:57547/';
    this.verbose = verbose;
    this.periodicInformsDisabled = periodicInformsDisabled;

    // defining which cwmp model version this device is using.
    if (this.device.get('InternetGatewayDevice.ManagementServer.URL')) this.TR = 'tr098';
    else if (this.device.get('Device.ManagementServer.URL')) this.TR = 'tr181';

    // Setting initial state of each implemented diagnostic.
    for (let key in diagnostics) {
      this.diagnosticsStates[key] = {}; // initializing diagnostic state attributes.
      this.setResultForDiagnostic(key); // setting default result for diagnostic.
    }

    // In order to have a set of methods from a different module be part of the
    // Simulator Class, we add each of the modules methods to this instance and
    // make 'this' be the methods scoped 'this'.
    for (let key in manipulations) {
      this[key] = manipulations[key].bind(this);
    }
  }

  // Enables of disables periodic informs.
  // Given 'true' turns on, given 'false' turns off or given 'undefined' toggles.
  setPeriodicInforms(bool) {
    if (bool === undefined) { // toggling value.
      this.periodicInformsDisabled = !this.periodicInformsDisabled;
    } else if (bool.constructor === Boolean) { // setting value.
      this.periodicInformsDisabled = !bool; // variable name represents a negation.
    }

    if (this.periodicInformsDisabled) { // To disable, clears timeout.
      clearTimeout(this.nextInformTimeout);
      this.nextInformTimeout = undefined;
    } else if (!this.nextInformTimeout) { // To enable, sets next periodic inform.
      this.setNextPeriodicInform();
    }
  }
  // Toggles periodic informs.
  togglePeriodicInforms = () => setPeriodicInforms();

  // Stops running simulator instance in background so it can gracefully shut down.
  async shutDown() {
    // Stops each running timeout representing a diagnostic being run.
    for (let key in this.diagnosticsStates) {
      clearTimeout(this.diagnosticsStates[key].running);
    }
    // Stops the timeout for the next periodic inform
    if (this.nextInformTimeout) {
      clearTimeout(this.nextInformTimeout);
      this.nextInformTimeout = undefined;
    }
    // Closes the http server.
    if (this.server) {
      await new Promise((resolve) => this.server.close(resolve));
      this.server = undefined;
    }
    this.enabled = false; // flags this simulator as not working (because javascript don't let us delete objects).
  }

  // Start procedure for a simulator coming online. Can throw an errors.
  async start() { 
    if (this.server) {
      console.log(`Simulator ${this.serialNumber} already started`);
      return this;
    }
    this.enabled = true; // flags this simulator as a working simulator (because javascript don't let us delete objects).

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

    let connectionRequestUrl = await this.listenForConnectionRequests(); // Can throw error here.
    if (v = this.device.get("InternetGatewayDevice.ManagementServer.ConnectionRequestURL")) v[1] = connectionRequestUrl;
    else if (v = this.device.get("Device.ManagementServer.ConnectionRequestURL")) v[1] = connectionRequestUrl;

    // device is ready to receive requests.
    this.emit('started');

    await this.startSession();
    // device has already informed, to ACS, that it is online and has already
    // received pending tasks from ACS and is now waiting for something to do.
    this.emit('ready');

    return this; // returning this Simulator instance.
  }

  // Instances an http(s) server in order to listen for connection
  // requests coming from the ACS.
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
          if (this.onGoingSession) {
            this.pendingAcsRequest = true;
          } else {
            this.startSession("6 CONNECTION REQUEST");
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

  // Backbone for the communication between simulator and ACS.
  // Starts a session with the ACS and, only after it finishes, executes side jobs.
  async startSession(event="2 PERIODIC") {
    if (!this.enabled) return; // if simulator has been shutdown, ignore new session.

    this.onGoingSession = true; // session starts here.
    clearTimeout(this.nextInformTimeout); // clears timeout in case there is an scheduled session.
    this.emit('sessionStart', event);
    this.pendingAcsRequest = false;

    try {
      let body = methods.inform(this, event);
      await this.sendRequest(body);
      await this.cpeRequest();
    } catch (e) {
      console.log('Simulator internal error.', e);
    }

    this.onGoingSession = false; // the soonest point where session has ended.
    this.emit('sessionEnd', event);
    
    // if ACS has sent a request during a session, we start a new session.
    if (this.pendingAcsRequest) return this.startSession();

    this.setNextPeriodicInform(); // sets timeout for next periodic inform.

    this.runRequestedDiagnostics(); // executing diagnostic after session has ended.

    this.runPendingActions(); // starting actions that were waiting current session to finish.
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
    let reqBody = xml ||  "";

    headers["Content-Length"] = reqBody.length;
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
          let resBody = Buffer.allocUnsafe(bytes);

          chunks.forEach((chunk) => {
            chunk.copy(resBody, offset, 0, chunk.length);
            return offset += chunk.length;
          });

          response.body = resBody.toString();

          if (Math.floor(response.statusCode / 100) !== 2) {
            let {method, href, headers} = options;
            this.emit('error', new Error(`Unexpected response code ${response.statusCode} with body '${resBody}', `+
              `on request '${JSON.stringify({method, href, headers})}' and body '${xmlUtils.formatXML(reqBody)}'.`));
            return;
          }

          if (+response.headers["Content-Length"] > 0 || resBody.length > 0)
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

      request.body = reqBody;
      request.end(reqBody, () => {
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

  // Runs queued diagnostic if possible.
  async runRequestedDiagnostics() {
    // if diagnostic execution is fully occupied we don't start anything
    // because there is a logic flux already inside the loop, running all
    // diagnostics sequentially.
    if (!this.diagnosticSlots) return;

    let diagnostic;
    while (diagnostic = this.diagnosticQueue.shift()) {
      this.diagnosticSlots--; // consuming a diagnostic execution slot.
      await diagnostic()
        .catch(() => {}); // interrupted diagnostics are ignored.
      this.diagnosticSlots++; // returning a diagnostic execution slot.
    }
  }

  // Runs queued promise function if no session is running.
  async runPendingActions(actionFunc) {
    if (actionFunc) this.pendingActions.push(actionFunc);

    // if there is an on going session we don't run any pending events and wait
    // the current session to call this function again.
    if (this.onGoingSession) return;

    let pendingAction;
    while (pendingAction = this.pendingActions.shift()) {
      await pendingAction();
    }
  }
}

exports.Simulator = Simulator;
exports.InvalidTaskNameError = InvalidTaskNameError;
