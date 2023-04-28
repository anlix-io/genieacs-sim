const methods = require("./methods");

const event = '8 DIAGNOSTICS COMPLETE';

async function finish(simulator, name, func, afterMilliseconds, resolve) {
  // reference to object containing this diagnostic's execution data.
  const state = simulator.diagnosticsStates[name];

  // executing diagnostic logic after 'afterMilliseconds' and sending results.
  state.running = setTimeout(async () => {
    await func(simulator); // executing diagnostic result.
    state.running = undefined; // clearing diagnostic's timeout object.
    state.reject = undefined; // clearing diagnostic's reject function.

    // if there isn't an on going session.
    if (simulator.nextInformTimeout !== null) {
      await simulator.startSession(event); // creating a new session where diagnostic complete message is sent.
      resolve(); // next diagnostic can be executed after calling 'resolve()'.
      simulator.emit('diagnostic', name); // sent diagnostic completion event to ACS and got a response.
      return;
    }

    // if there is an on going session.
    // adding a send call of this diagnostic complete message event content to pending queue.
    simulator.pending.push(async (send) => {
      const body = methods.inform(simulator, event); // building a diagnostic complete message.
      await send(body); // sending content and waiting response.
      simulator.emit('diagnostic', name); // sent diagnostic completion event to ACS and got a response.
    });
    resolve(); // next diagnostic can be executed after calling 'resolve()'.
  }, afterMilliseconds);
}

async function queue(simulator, name, func, afterMilliseconds) {
  // When requested, the CPE SHOULD wait until after completion of the communication session
  // with the ACS before starting the diagnostic.
  simulator.diagnosticQueue.push(() =>
    new Promise((resolve, reject) => {
      simulator.diagnosticsStates[name].reject = reject; // saving reject so we can interrupt diagnostic.
      finish(simulator, name, func, afterMilliseconds, resolve);
    })
  );
}

// clears diagnostic timeout and rejects the diagnostic.
function interrupt(simulator, name) {
  const state = simulator.diagnosticsStates[name];
  clearTimeout(state.running);
  if (state.reject) {
    state.reject();
    state.reject = undefined;
  }
  state.running = undefined;
}

const ping = {
  run: function(simulator, modified) { // executes Ping Diagnostic logic.
    if (modified['InternetGatewayDevice.IPPingDiagnostics.DiagnosticsState'] === undefined) {
      // Modifying any of the writable parameters except for 'DiganosticState' MUST result 
      // in its value being set to "None".
      if (
        modified['InternetGatewayDevice.IPPingDiagnostics.Interface'] !== undefined ||
        modified['InternetGatewayDevice.IPPingDiagnostics.Host'] !== undefined ||
        modified['InternetGatewayDevice.IPPingDiagnostics.Timeout'] !== undefined ||
        modified['InternetGatewayDevice.IPPingDiagnostics.NumberOfRepetitions'] !== undefined ||
        modified['InternetGatewayDevice.IPPingDiagnostics.DataBlockSize'] !== undefined ||
        modified['InternetGatewayDevice.IPPingDiagnostics.DSCP'] !== undefined
      ) {
        // While the test is in progress, modifying any of the writable parameters except for
        // 'DiganosticState' MUST result in the test being terminated and its value being set to "None".
        interrupt(simulator, 'ping');
        simulator.device['InternetGatewayDevice.IPPingDiagnostics.DiagnosticsState'][1] = 'None';
      }
      // if no ping parameter has been modified, this diagnostic is not executed.
      return;
    }

    if (simulator.device['InternetGatewayDevice.IPPingDiagnostics.DiagnosticsState'][1] !== 'Requested') return;
    // If the ACS sets the value of 'DiganosticState' to "Requested", the CPE MUST initiate the
    // corresponding diagnostic test. When writing, the only allowed value is Requested. To ensure the
    // use of the proper test parameters (the writable parameters in this object), the test parameters
    // MUST be set either prior to or at the same time as (in the same SetParameterValues) setting the
    // DiagnosticsState to Requested.

    // While the test is in progress, setting 'DiganosticState' to "Requested" (and possibly modifying
    // other writable parameters in this object) MUST result in the test being terminated and then
    // restarted using the current values of the test parameters.
    interrupt(simulator, 'ping');

    // When the test is completed, the value of 'DiganosticState' MUST be either "Complete" or
    // one of the Error values.
    // If the value of 'DiganosticState' is anything other than "Complete", the values of the
    // results parameters for this test are indeterminate.
    // When the diagnostic initiated by the ACS is completed (successfully or not), the CPE MUST
    // establish a new connection to the ACS to allow theACS to view the results, indicating the 
    // Event code "8 DIAGNOSTICS COMPLETE" in the Inform message.

    const host = simulator.device['InternetGatewayDevice.IPPingDiagnostics.Host'][1];
    // checking host.
    if (host === '' || host.length > 256) {
      queue(simulator, 'ping', (simulator) => {
        simulator.device['InternetGatewayDevice.IPPingDiagnostics.DiagnosticsState'][1] = 'Error_CannotResolveHostName';
      }, 50);
      return;
    }
    const dataBlockSize = parseInt(simulator.device['InternetGatewayDevice.IPPingDiagnostics.DataBlockSize'][1]);
    const dscp = parseInt(simulator.device['InternetGatewayDevice.IPPingDiagnostics.DSCP'][1]);
    // checking other parameter's.
    if (
      // The value of 'Interface' MUST be either a valid interface or an empty string. An attempt to set that
      // parameter to a different value MUST be rejected as an invalid parameter value. If an empty string is
      // specified, the CPE MUST use the interface as directed by its routing policy (Forwarding table entries)
      // to determine the appropriate interface.
      simulator.device['InternetGatewayDevice.IPPingDiagnostics.Interface'][1].length > 256 ||
      !(dataBlockSize >= 1 && dataBlockSize < 65536) || !(dscp > -1 && dscp < 64) ||
      !(parseInt(simulator.device['InternetGatewayDevice.IPPingDiagnostics.Timeout'][1]) > 0) ||
      !(parseInt(simulator.device['InternetGatewayDevice.IPPingDiagnostics.NumberOfRepetitions'][1]) > 0)
    ) {
      queue(simulator, 'ping', (simulator) => {
        simulator.device['InternetGatewayDevice.IPPingDiagnostics.DiagnosticsState'][1] = 'Error_Other';
      }, 50)
      return;
    }

    // all parameters are valid.
    queue(simulator, 'ping', simulator.diagnosticsStates.ping.result, 500);  // small timeout to finish fast.
    // After the diagnostic is complete, the value of all result parameters (all read-only parameters in this
    // object) MUST be retained by the CPE until either this diagnostic is run again, or the CPE reboots.
  },

  results: { // possible results for a ping diagnostic.
    default: function(simulator) { // successful ping result.
      simulator.device['InternetGatewayDevice.IPPingDiagnostics.DiagnosticsState'][1] = 'Complete';
      simulator.device['InternetGatewayDevice.IPPingDiagnostics.SuccessCount'][1] =
        simulator.device['InternetGatewayDevice.IPPingDiagnostics.NumberOfRepetitions'][1];
      simulator.device['InternetGatewayDevice.IPPingDiagnostics.FailureCount'][1] = '0';
      simulator.device['InternetGatewayDevice.IPPingDiagnostics.AverageResponseTime'][1] = '11';
      simulator.device['InternetGatewayDevice.IPPingDiagnostics.MinimumResponseTime'][1] = '9';
      simulator.device['InternetGatewayDevice.IPPingDiagnostics.MaximumResponseTime'][1] = '14';
    },
    error: function(simulator) { // internal error.
      simulator.device['InternetGatewayDevice.IPPingDiagnostics.DiagnosticsState'][1] = 'Error_Internal';
    },
  },
};
exports.ping = ping;

const traceroute = {
  run: function(simulator, modified) {
    if (modified['InternetGatewayDevice.TraceRouteDiagnostics.DiagnosticsState'] === undefined) {
      if (
        modified['InternetGatewayDevice.TraceRouteDiagnostics.Interface'] !== undefined ||
        modified['InternetGatewayDevice.TraceRouteDiagnostics.Host'] !== undefined ||
        modified['InternetGatewayDevice.TraceRouteDiagnostics.NumberOfTries'] !== undefined ||
        modified['InternetGatewayDevice.TraceRouteDiagnostics.Timeout'] !== undefined ||
        modified['InternetGatewayDevice.TraceRouteDiagnostics.DataBlockSize'] !== undefined ||
        modified['InternetGatewayDevice.TraceRouteDiagnostics.MaxHopCount'] !== undefined
      ) {
        interrupt(simulator, 'traceroute');
        simulator.device['InternetGatewayDevice.TraceRouteDiagnostics.DiagnosticsState'][1] = 'None';
      }
      // if no traceroute parameter has been modified, this diagnostic is not executed.
      return;
    }

    if (simulator.device['InternetGatewayDevice.TraceRouteDiagnostics.DiagnosticsState'][1] !== 'Requested') return;

    interrupt(simulator, 'traceroute');

    const host = simulator.device['InternetGatewayDevice.TraceRouteDiagnostics.Host'][1];
    // checking host.
    if (host === '' || host.length > 256) {
      queue(simulator, 'traceroute', (simulator) => {
        simulator.device['InternetGatewayDevice.TraceRouteDiagnostics.DiagnosticsState'][1] = 'Error_CannotResolveHostName';
      }, 50);
      return;
    }
    const numberOfTries = parseInt(simulator.device['InternetGatewayDevice.TraceRouteDiagnostics.NumberOfTries'][1]);
    const dataBlockSize = parseInt(simulator.device['InternetGatewayDevice.TraceRouteDiagnostics.DataBlockSize'][1]);
    const dscp = parseInt(simulator.device['InternetGatewayDevice.TraceRouteDiagnostics.DSCP'][1]);
    const maxHopCount = parseInt(simulator.device['InternetGatewayDevice.TraceRouteDiagnostics.MaxHopCount'][1]);
    // checking other parameter's.
    if (
      simulator.device['InternetGatewayDevice.TraceRouteDiagnostics.Interface'][1].length > 256 ||
      numberOfTries < 1 || numberOfTries > 3 ||
      parseInt(simulator.device['InternetGatewayDevice.TraceRouteDiagnostics.Timeout'][1]) < 1 ||
      dataBlockSize < 1 || dataBlockSize > 65535 || dscp < 0 || dscp > 63 ||
      maxHopCount < 1 || maxHopCount > 64
    ) {
      queue(simulator, 'traceroute', (simulator) => {
        simulator.device['InternetGatewayDevice.TraceRouteDiagnostics.DiagnosticsState'][1] = 'Error_MaxHopCountExceeded';
      }, 50)
      return;
    }

    // all parameters are valid.
    queue(simulator, 'traceroute', simulator.diagnosticsStates.traceroute.result, 500); // small timeout to finish fast.
  },

  eraseOldResult: function(simulator) { // erasing old results.
    simulator.device['InternetGatewayDevice.TraceRouteDiagnostics.RouteHopsNumberOfEntries'][1] = '0';

    let hop = 1; // starts from 1.
    while (true) {
      const hopRoute = `InternetGatewayDevice.TraceRouteDiagnostics.RouteHops.${hop}.`;
      if (simulator.device[hopRoute]) {
        delete simulator.device[hopRoute];
        delete simulator.device[hopRoute+'HopHost'];
        delete simulator.device[hopRoute+'HopHostAddress'];
        delete simulator.device[hopRoute+'HopErrorCode'];
        delete simulator.device[hopRoute+'HopRTTimes'];
      } else {
        delete simulator.device['InternetGatewayDevice.TraceRouteDiagnostics.RouteHops.'];
        break;
      }
      hop++;
    }

    delete simulator.device._sortedPaths;
  },
  produceHopResults: function (simulator, forcedMaxHops=false, amoutOfHops=8) {
    traceroute.eraseOldResult(simulator);

    let path = 'InternetGatewayDevice.TraceRouteDiagnostics.';

    const maxHops = parseInt(simulator.device[path+'MaxHopCount'][1]);
    const hops = forcedMaxHops ? maxHops : amoutOfHops; // doing max hops or the given amount of hops.

    simulator.device[path+'DiagnosticsState'][1] = forcedMaxHops ? 'Error_MaxHopCountExceeded' : 'Complete';
    simulator.device[path+'ResponseTime'][1] = forcedMaxHops ? `${((5+2*hops)*1.025).toFixed(3)}` : '3000';
    simulator.device[path+'RouteHopsNumberOfEntries'][1] = `${hops}`;

    const host = simulator.device[path+`Host`][1];
    const tries = parseInt(simulator.device[path+'NumberOfTries'][1]);

    path += 'RouteHops.';
    simulator.device[path] = [false]; // adding "RouteHops" node to the data model.

    // hop indexes start from 1. 'rtt' is a simulation of the round trip time increase with each following hop.
    for (let hop = 1, rtt = 5; hop <= hops; hop++, rtt += 5) {
      const hopPath = path+`${hop}.` // path for the i-th hop.
      simulator.device[hopPath] = [false]; // creating node for the i-th hop.
      
      let hopHost = `hop-${hop}.com`;
      let hopHostAddress = `123.123.${123+hop}.123`;
      // if we are not forcing the max amount of hops in the last iteration, that means 
      // the last iteration has reached the target host.
      if (!forcedMaxHops && hop === hops-1) {
        hopHost = host; // we will use the 'Host' attribute as the 'HopHost' value.
        // And if the 'Host' value is an IP address, 'HopHostAddress' will be empty.
        if (hopHost.match(/\d{1,3}(\.\d{1,3}){3}/)) hopHostAddress = '';
        // That way, 'HopHost', in the last hop, will be whatever host has been defined in the 'Host' attribute.
      }
      // Result parameter indicating the Host Name if DNS is able to resolve or IP Address of a hop along
      // the discovered route.
      simulator.device[hopPath+'HopHost'] = [false, hopHost, 'xsd:string'];
      // If this parameter is non empty it will contain the last IP address of the host returned for this hop and the
      // HopHost will contain the Host Name returned from the reverse DNS query.
      simulator.device[hopPath+'HopHostAddress'] = [false, hopHostAddress, 'xsd:string'];
      // Contains the error code returned for this hop. This code is directly from the ICMP CODE field.
      simulator.device[hopPath+'HopErrorCode'] = [false, 0, 'xsd:unsignedInt'];
      // Contains the comma separated list of one or more round trip times in milliseconds (one for each
      // repetition) for this hop.
      let hopRtTimes = [(rtt*1.01).toFixed(3), (rtt*0.975).toFixed(3), (rtt*1.025).toFixed(3)].slice(0, tries).toString();
      simulator.device[hopPath+'HopRTTimes'] = [false, hopRtTimes, 'xsd:string'];
    }
  },

  results: {
    default: function(simulator) {
      traceroute.produceHopResults(simulator, false, 8);
    },
    error: function(simulator) { // max hop count exceeded error.
      traceroute.produceHopResults(simulator, true)
    },
  }
};
exports.traceroute = traceroute;
