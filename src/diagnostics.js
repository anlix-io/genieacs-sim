const event = '8 DIAGNOSTICS COMPLETE';
const diagnosticDuration = 2000; // in milliseconds.

// Sets a new session, for the diagnostic complete message, to be started after
// the simulated diagnostic finishes running.
async function finish(simulator, name, func, afterMilliseconds, resolve) {
  // reference to object containing this diagnostic's execution data.
  const state = simulator.diagnosticsStates[name];

  // executing diagnostic logic after 'afterMilliseconds' and sending results.
  state.running = setTimeout(async () => {
    await func(simulator); // executing diagnostic result.
    state.running = undefined; // clearing diagnostic's timeout object.
    state.reject = undefined; // clearing diagnostic's reject function.

    simulator.runPendingActions(async () => {
      await simulator.startSession(event); // creating a new session where diagnostic complete message is sent.
      resolve(name); // next diagnostic can be executed after calling 'resolve()'.
      simulator.emit('diagnostic', name); // sent diagnostic completion event to ACS and got a response.
    });
  }, afterMilliseconds);
}

// Adds a diagnostic to a queue so it can be started (simulated) after session ends.
async function queue(simulator, name, func, afterMilliseconds) {
  // When requested, the CPE SHOULD wait until after completion of the communication session
  // with the ACS before starting the diagnostic. [[from tr069]].
  simulator.diagnosticQueue.push(() => new Promise((resolve, reject) => {
    simulator.diagnosticsStates[name].reject = reject; // saving reject so we can interrupt this diagnostic.
    finish(simulator, name, func, afterMilliseconds, resolve);
  }));
}

// clears diagnostic timeout and rejects the diagnostic.
function interrupt(simulator, name) {
  const state = simulator.diagnosticsStates[name];
  clearTimeout(state.running);
  if (state.reject) {
    // The caller of the diagnostic promise should catch the reject but ignore
    // the catch because another diagnostic may start after ACS request it.
    state.reject(name);
    state.reject = undefined; // removing reject after using it.
  }
  state.running = undefined; // removing timeout after clearing it.
}

// Helper functions.
// Produces a random MAC Address, in uniform distribution.
const randomMAC = () => "XX:XX:XX:XX:XX:XX"
  .replace(/X/g, () => "0123456789ABCDEF"[Math.random()*16|0]);
// Produces a random integer between given interval, in uniform distribution.
const randomN = (max, min=1) => Math.floor(Math.random()*(max+1-min))+min;
// Returns a random element from given array, in uniform distribution.
const getRandomFromArray = (array) => array[Math.random()*array.length|0];


/**
 * A diagnostic is an exported object with the following structure:
 * const x = {
 *   path: {tr098: String, tr181: String},
 *   run: function(simulator, modified),
 *   results: {
 *     default: function(simulator),
 *     error: function(simulator, errorName),
 *     ...: function(simulator),
 *   },
 * }
 * exports.diag = x;
 *
 * The key of the object inside 'exports' is the name of the diagnostic. In the
 * above example, the diagnostic name is 'diag'
 *
 * - 'path' is an object where each value is the path for the root node of the
 * diagnostics data branch in the tree corresponding to each TR specification.
 * Currently there are tr069 and tr181, which are selected by the simulator.TR
 * attribute defined automatically in the simulator constructor.
 *
 * - 'run' is a function that received a simulator and the modified fields from
 * a task and it should check if the modified fields implies the diagnostic
 * should be started, and if that's true, should set the initial state of the
 * that diagnostic. The ping diagnostic has instructions taken from tr069 paper.
 *
 * - 'results' is object where each value is a function that sets the final
 * results for that diagnostic. It should always have 2 keys, 'default' and
 * 'error'. Other keys are allowed too. The selected function is defined by the
 * key given as the 'result' argument in simulator.setResultForDiagnostic(name,
 * result). For the 'error' function, the argument 'errorName' is the tree's
 * DiagnosticsState value to be set which is a string defined by the protocol.
 *
 * Helper functions for a diagnostic can be added to the diagnostic structure
 * and can be called, from inside their own structure, by prefixing the call
 * with the variable name of the diagnostic structure. In the above example
 * it's called "x", so a helper function should be called by 'x.helperfunc()'.
 * */
const ping = {
  path: {
    tr098: 'InternetGatewayDevice.IPPingDiagnostics.',
    tr181: 'Device.IP.Diagnostics.IPPing.',
  },

  run: function(simulator, modified) { // executes Ping Diagnostic logic.
    const path = ping.path[simulator.TR];

    if (modified[path+'DiagnosticsState'] === undefined) {
      // Modifying any of the writable parameters except for 'DiganosticState' MUST result 
      // in its value being set to "None". [[from tr069]].
      if (
        modified[path+'Interface'] !== undefined ||
        modified[path+'Host'] !== undefined ||
        modified[path+'Timeout'] !== undefined ||
        modified[path+'NumberOfRepetitions'] !== undefined ||
        modified[path+'DataBlockSize'] !== undefined ||
        modified[path+'DSCP'] !== undefined
      ) {
        // While the test is in progress, modifying any of the writable parameters except for 'DiganosticState'
        // MUST result in the test being terminated and its value being set to "None". [[from tr069]].
        interrupt(simulator, 'ping');
        simulator.device.get(path+'DiagnosticsState')[1] = 'None';
      }
      // if no ping parameter has been modified, this diagnostic is not executed.
      return;
    }

    if (simulator.device.get(path+'DiagnosticsState')[1] !== 'Requested') return;
    // If the ACS sets the value of 'DiganosticState' to "Requested", the CPE MUST initiate the
    // corresponding diagnostic test. When writing, the only allowed value is Requested. To ensure the
    // use of the proper test parameters (the writable parameters in this object), the test parameters
    // MUST be set either prior to or at the same time as (in the same SetParameterValues) setting the
    // DiagnosticsState to Requested. [[from tr069]].

    // While the test is in progress, setting 'DiganosticState' to "Requested" (and possibly modifying
    // other writable parameters in this object) MUST result in the test being terminated and then
    // restarted using the current values of the test parameters. [[from tr069]].
    interrupt(simulator, 'ping');

    // When the test is completed, the value of 'DiganosticState' MUST be either "Complete" or
    // one of the Error values. [[from tr069]].
    // If the value of 'DiganosticState' is anything other than "Complete", the values of the
    // results parameters for this test are indeterminate. [[from tr069]].
    // When the diagnostic initiated by the ACS is completed (successfully or not), the CPE MUST
    // establish a new connection to the ACS to allow theACS to view the results, indicating the 
    // Event code "8 DIAGNOSTICS COMPLETE" in the Inform message. [[from tr069]].

    const host = simulator.device.get(path+'Host')[1];
    // checking host.
    if (host === '' || host.length > 256) {
      queue(simulator, 'ping', (simulator) => {
        simulator.device.get(path+'DiagnosticsState')[1] = 'Error_CannotResolveHostName';
      }, diagnosticDuration);
      return;
    }
    const interface = (simulator.device.get(path+'Interface') || [,''])[1];
    const timeout = parseInt((simulator.device.get(path+'Timeout') || [,1000])[1]); // unsignedInt[1:].
    const NumberOfRepetitions = parseInt((simulator.device.get(path+'NumberOfRepetitions') || [,1])[1]); // unsignedInt[1:].
    const dataBlockSize = parseInt((simulator.device.get(path+'DataBlockSize') || [,1])[1]); // unsignedInt[1:65535].
    const dscp = parseInt((simulator.device.get(path+'DSCP') || [,0])[1]); // unsignedInt[0:63].
    // checking other parameter's.
    if (
      // The value of 'Interface' MUST be either a valid interface or an empty string. An attempt to set that
      // parameter to a different value MUST be rejected as an invalid parameter value. If an empty string is
      // specified, the CPE MUST use the interface as directed by its routing policy (Forwarding table entries)
      // to determine the appropriate interface. [[from tr069]].
      interface.length > 256 || timeout < 1 || NumberOfRepetitions < 1 || 
      dataBlockSize < 1 || dataBlockSize > 65535 || dscp < 0 || dscp > 63
    ) {
      queue(simulator, 'ping', (simulator) => {
        simulator.device.get(path+'DiagnosticsState')[1] = 'Error_Other';
      }, diagnosticDuration)
      return;
    }

    // all parameters are valid.
    queue(simulator, 'ping', simulator.diagnosticsStates.ping.result, diagnosticDuration);
    // After the diagnostic is complete, the value of all result parameters (all read-only parameters in this
    // object) MUST be retained by the CPE until either this diagnostic is run again, or the CPE reboots.
  },

  results: { // possible results for a ping diagnostic.
    default: function(simulator) { // successful ping result.
      const path = ping.path[simulator.TR];
      simulator.device.get(path+'DiagnosticsState')[1] = 'Complete';
      simulator.device.get(path+'SuccessCount')[1] =
        simulator.device.get(path+'NumberOfRepetitions')[1];
      simulator.device.get(path+'FailureCount')[1] = '0';
      simulator.device.get(path+'AverageResponseTime')[1] = '11';
      simulator.device.get(path+'MinimumResponseTime')[1] = '9';
      simulator.device.get(path+'MaximumResponseTime')[1] = '14';
    },
    error: function(simulator, errorName='Error_Internal') { // internal error.
      const path = ping.path[simulator.TR];
      simulator.device.get(path+'DiagnosticsState')[1] = errorName;
    },
  },
};
exports.ping = ping;

const traceroute = {
  path: {
    tr098: 'InternetGatewayDevice.TraceRouteDiagnostics.',
    tr181: 'Device.IP.Diagnostics.TraceRoute.',
  },

  run: function(simulator, modified) {
    const path = traceroute.path[simulator.TR];

    if (modified[path+'DiagnosticsState'] === undefined) {
      if (
        modified[path+'Interface'] !== undefined ||
        modified[path+'Host'] !== undefined ||
        modified[path+'NumberOfTries'] !== undefined ||
        modified[path+'Timeout'] !== undefined ||
        modified[path+'DataBlockSize'] !== undefined ||
        modified[path+'MaxHopCount'] !== undefined
      ) {
        interrupt(simulator, 'traceroute');
        simulator.device.get(path+'DiagnosticsState')[1] = 'None';
      }
      // if no traceroute parameter has been modified, this diagnostic is not executed.
      return;
    }

    if (simulator.device.get(path+'DiagnosticsState')[1] !== 'Requested') return;

    interrupt(simulator, 'traceroute');

    const host = simulator.device.get(path+'Host')[1];
    // checking host.
    if (host === '' || host.length > 256) {
      queue(simulator, 'traceroute', (simulator) => {
        simulator.device.get(path+'DiagnosticsState')[1] = 'Error_CannotResolveHostName';
      }, diagnosticDuration);
      return;
    }
    const interface = (simulator.device.get(path+'Interface') || [,''])[1];
    const numberOfTries = parseInt((simulator.device.get(path+'NumberOfTries') || [,1])[1]);
    const timeout = parseInt((simulator.device.get(path+'Timeout') || [,1000])[1]);
    const dataBlockSize = parseInt((simulator.device.get(path+'DataBlockSize') || [,1])[1]);
    const dscp = parseInt((simulator.device.get(path+'DSCP') || [,0])[1]);
    const maxHopCount = parseInt((simulator.device.get(path+'MaxHopCount') || [,30])[1]);
    // checking other parameter's.
    if (
      interface.length > 256 || numberOfTries < 1 || numberOfTries > 3 || timeout < 1 ||
      dataBlockSize < 1 || dataBlockSize > 65535 || dscp < 0 || dscp > 63 || maxHopCount < 1 || maxHopCount > 64
    ) {
      queue(simulator, 'traceroute', (simulator) => {
        simulator.device.get(path+'DiagnosticsState')[1] = 'Error_MaxHopCountExceeded';
      }, diagnosticDuration)
      return;
    }

    // all parameters are valid.
    queue(simulator, 'traceroute', simulator.diagnosticsStates.traceroute.result, diagnosticDuration);
  },

  // Removes old traceroute results.
  eraseResult: function(simulator, path) {
    simulator.device.get(path+'RouteHopsNumberOfEntries')[1] = '0';

    const fieldSuffix = simulator.TR === 'tr098' ? 'Hop' : '';

    const fields = [
      'Host',
      'HostAddress',
      'ErrorCode',
      'RTTimes',
    ];

    let hop = 1; // starts from 1.
    while (true) {
      const routeHop = path+`RouteHops.${hop}.`;
      if (simulator.device.has(routeHop)) {
        for (let field of fields) {
          simulator.device.delete(routeHop+fieldSuffix+field);
        }
        simulator.device.delete(routeHop);
      } else {
        simulator.device.delete(path+'RouteHops.');
        break;
      }
      hop++;
    }

    delete simulator.device._sortedPaths;
  },

  // Produces hop results given some parameters.
  // When 'forcedMaxHopsError' is true, the produced result simulates a
  // traceroute result that have reached the max hops amounts and still haven't
  // reached the destination address.
  // 'amoutOfHops' is the amount of hops that will be produced in the result.
  // 'amoutOfHops' is expected to be smaller than traceroute's 'MaxHopCount'.
  produceHopResults: function(simulator, path, forcedMaxHopsError=false, amoutOfHops=8) {
    traceroute.eraseResult(simulator, path); // Erasing previous results.

    const maxHops = parseInt(simulator.device.get(path+'MaxHopCount')[1]);
    const hops = forcedMaxHopsError ? maxHops : amoutOfHops; // doing max hops or the given amount of hops.

    // Setting results.
    simulator.device.get(path+'DiagnosticsState')[1] = forcedMaxHopsError ? 'Error_MaxHopCountExceeded' : 'Complete';
    simulator.device.get(path+'ResponseTime')[1] = forcedMaxHopsError ? `${((5+2*hops)*1.025).toFixed(3)}` : '3000';
    simulator.device.get(path+'RouteHopsNumberOfEntries')[1] = hops.toString();

    const host = simulator.device.get(path+`Host`)[1];
    const tries = parseInt((simulator.device.get(path+'NumberOfTries') || [,0])[1]);

    path += 'RouteHops.';
    simulator.device.set(path, [false]); // adding "RouteHops" node to the data model.

    const fieldSuffix = simulator.TR === 'tr098' ? 'Hop' : '';

    // hop indexes start from 1. 'rtt' is a simulation of the round trip time increase with each following hop.
    for (let hop = 1, rtt = 5; hop <= hops; hop++, rtt += 5) {
      const hopPath = path+`${hop}.` // path for the i-th hop.
      simulator.device.set(hopPath, [false]); // creating node for the i-th hop.
      
      let hopHost = `hop-${hop}.com`;
      let hopHostAddress = `123.123.${123+hop}.123`;
      // if we are not forcing the max amount of hops in the last iteration, that means 
      // the last iteration has reached the target host.
      if (!forcedMaxHopsError && hop === hops) {
        hopHost = host; // we will use the 'Host' attribute as the 'HopHost' value.
        // And if the 'Host' value is an IP address, 'HopHostAddress' will be empty.
        if (hopHost.match(/\d{1,3}(\.\d{1,3}){3}/)) hopHostAddress = '';
        // That way, 'HopHost', in the last hop, will be whatever host has been defined in the 'Host' attribute.
      }
      // Result parameter indicating the Host Name if DNS is able to resolve or IP Address of a hop along
      // the discovered route.
      simulator.device.set(hopPath+fieldSuffix+'Host', [false, hopHost, 'xsd:string']);
      // If this parameter is non empty it will contain the last IP address of the host returned for this hop and the
      // HopHost will contain the Host Name returned from the reverse DNS query.
      simulator.device.set(hopPath+fieldSuffix+'HostAddress', [false, hopHostAddress, 'xsd:string']);
      // Contains the error code returned for this hop. This code is directly from the ICMP CODE field.
      simulator.device.set(hopPath+fieldSuffix+'ErrorCode', [false, 0, 'xsd:unsignedInt']);
      // Contains the comma separated list of one or more round trip times in milliseconds (one for each
      // repetition) for this hop.
      let hopRtTimes = [(rtt*1.01).toFixed(3), (rtt*0.975).toFixed(3), (rtt*1.025).toFixed(3)].slice(0, tries).toString();
      simulator.device.set(hopPath+fieldSuffix+'RTTimes', [false, hopRtTimes, 'xsd:string']);
    }
  },

  results: {
    default: function(simulator) {
      const path = traceroute.path[simulator.TR];
      traceroute.produceHopResults(simulator, path, false, 8); // Producing 8 hops.
    },
    Error_MaxHopCountExceeded: function(simulator) { // max hop count exceeded error.
      const path = traceroute.path[simulator.TR];
      traceroute.produceHopResults(simulator, path, true)
    },
    error: function(simulator, errorName='Error_Internal') {
      const path = traceroute.path[simulator.TR];
      traceroute.eraseResult(simulator, path);
      simulator.device.get(path+'DiagnosticsState')[1] = errorName;
    },
  },
};
exports.traceroute = traceroute;

const sitesurvey = {
  path: {
    tr181: 'Device.WiFi.NeighboringWiFiDiagnostic.',
  },

  run: function(simulator, modified) {
    const path = sitesurvey.path[simulator.TR];
    if (modified[path+'DiagnosticsState'] === undefined) return;

    const field = simulator.device.get(path+'DiagnosticsState');
    // this device may not implement neighboring networks diagnostic.
    if (!field) return;

    if (field[1] !== 'Requested') return;

    interrupt(simulator, 'sitesurvey');
    queue(simulator, 'sitesurvey', simulator.diagnosticsStates.sitesurvey.result, diagnosticDuration);
  },

  // Removes old site survey results.
  eraseResult: function (simulator, path) {
    simulator.device.get(path+'ResultNumberOfEntries')[1] = '0';

    const fields = [
      'BSSID',
      'BasicDataTransferRates',
      'BeaconPeriod',
      'Channel',
      'DTIMPeriod',
      'EncryptionMode',
      'Mode',
      'Noise',
      'OperatingChannelBandwidth',
      'OperatingFrequencyBand',
      'OperatingStandards',
      'Radio',
      'SSID',
      'SecurityModeEnabled',
      'SignalStrength',
      'SupportedDataTransferRates',
      'SupportedStandards',
    ];

    path += 'Result.';
    let i = 0;
    while (true) {
      const neighbourPath = path+`${i}.`;
      if (simulator.device.has(neighbourPath)) {
        for (let field of fields) {
          simulator.device.delete(neighbourPath+field);
        }
        simulator.device.delete(neighbourPath);
      } else {
        simulator.device.delete(path);
        break;
      }
      i++;
    }

    delete simulator.device._sortedPaths;
  },

  results: {
    default: function (simulator) {
      let path = sitesurvey.path[simulator.TR];

      sitesurvey.eraseResult(simulator, path);

      const n = 20; // 20 neighboring WiFi networks.
      
      simulator.device.get(path+'DiagnosticsState')[1] = 'Complete';
      simulator.device.get(path+'ResultNumberOfEntries')[1] = n.toString();

      path += 'Result.';
      simulator.device.set(path, [false]);

      for (let i = 0; i < n; i++) {
        const wifi5 = Math.random() > 0.5; // randomly assigning this network's WiFi frequency.
        const bandwidthIndex = randomN(wifi5 ? 3 : 2); // WiFi 5Ghz has 20, 40 and 80Mhz bandwidth. 2.4Ghz has 20 and 40Mhz.
        const channel = wifi5 // WiFi 5GHz channel number depends on it's bandwidth. 2.4Ghz does not.
          ? getRandomFromArray([[36,40,44,48,149,153,157,161,165],[38,46,151,159],[42,155]][bandwidthIndex-1])
          : randomN(13);

        const neighbourPath = path+`${i}.`;
        simulator.device.set(neighbourPath, [false]);
        simulator.device.set(neighbourPath+'BSSID', [false, randomMAC(), 'xsd:string']);
        simulator.device.set(neighbourPath+'BasicDataTransferRates', [false, '', 'xsd:string']);
        simulator.device.set(neighbourPath+'BeaconPeriod', [false, '0', 'xsd:unsignedInt']);
        simulator.device.set(neighbourPath+'Channel', [false, channel.toString(), 'xsd:unsignedInt']);
        simulator.device.set(neighbourPath+'DTIMPeriod', [false, '0', 'xsd:unsignedInt']);
        simulator.device.set(neighbourPath+'EncryptionMode', [false, Math.random() > 0.5 ? 'TKIP' : 'AES', 'xsd:string']);
        simulator.device.set(neighbourPath+'Mode', [false, '0', 'xsd:string']);
        simulator.device.set(neighbourPath+'Noise', [false, '0', 'xsd:unsignedInt']);
        simulator.device.set(neighbourPath+'OperatingChannelBandwidth', [false, `${(2**bandwidthIndex)*10}MHz`, 'xsd:string']);
        simulator.device.set(neighbourPath+'OperatingFrequencyBand', [false, '', 'xsd:string']);
        simulator.device.set(neighbourPath+'OperatingStandards', [false, '', 'xsd:string']);
        simulator.device.set(neighbourPath+'Radio', [false, `Device.WiFi.Radio.${wifi5 ? 2 : 1}`, 'xsd:string']);
        simulator.device.set(neighbourPath+'SSID', [false, 'my beautiful SSID '+i, 'xsd:string']);
        simulator.device.set(neighbourPath+'SecurityModeEnabled', [false, 'Encrypted', 'xsd:string']);
        simulator.device.set(neighbourPath+'SignalStrength', [false, (-randomN(95,30)).toString(), 'xsd:int']);
        simulator.device.set(neighbourPath+'SupportedDataTransferRates', [false, '', 'xsd:string']);
        simulator.device.set(neighbourPath+'SupportedStandards', [false, '', 'xsd:string']);
      }
    },
    error: function (simulator, errorName='Error_Internal') {
      const path = sitesurvey.path[simulator.TR];
      sitesurvey.eraseResult(simulator, path);
      simulator.device.get(path+'DiagnosticsState')[1] = errorName;
    },
  },
};
exports.sitesurvey = sitesurvey;

const speedtest = {
  path: {
    tr098: 'InternetGatewayDevice.DownloadDiagnostics.',
    tr181: 'Device.IP.Diagnostics.DownloadDiagnostics.',
  },

  run: function(simulator, modified) { // executes Speed test Diagnostic logic.
    const path = speedtest.path[simulator.TR];

    if (modified[path+'DiagnosticsState'] === undefined) {
      if (
        modified[path+'Interface'] !== undefined ||
        modified[path+'DownloadURL'] !== undefined ||
        modified[path+'DSCP'] !== undefined ||
        modified[path+'EthernetPriority'] !== undefined ||
        modified[path+'TimeBasedTestDuration'] !== undefined ||
        modified[path+'TimeBasedTestMeasurementInterval'] !== undefined ||
        modified[path+'TimeBasedTestMeasurementOffset'] !== undefined ||
        modified[path+'NumberOfConnections'] !== undefined ||
        modified[path+'EnablePerConnectionResults'] !== undefined
      ) {
        interrupt(simulator, 'speedtest');
        simulator.device.get(path+'DiagnosticsState')[1] = 'None';
      }
      // if no speedtest parameter has been modified, this diagnostic is not executed.
      return;
    }

    if (simulator.device.get(path+'DiagnosticsState')[1] !== 'Requested') return;

    interrupt(simulator, 'speedtest');

    // checking 'downloadURL'.
    const downloadURL = simulator.device.get(path+'DownloadURL')[1];
    if (downloadURL === '' || downloadURL.length > 2048) {
      queue(simulator, 'speedtest', (simulator) => {
        simulator.device.get(path+'DiagnosticsState')[1] = 'Error_CannotResolveHostName';
      }, diagnosticDuration);
      return;
    }
    // checking other parameter's.
    const dscp = parseInt((simulator.device.get(path+'DSCP') || [,0])[1]);
    const ethernetPriority = parseInt((simulator.device.get(path+'EthernetPriority') || [,0])[1]);
    const tbtDuration = parseInt((simulator.device.get(path+'TimeBasedTestDuration') || [,0])[1]);
    const tbtInterval = parseInt((simulator.device.get(path+'TimeBasedTestMeasurementInterval') || [,0])[1]);
    const tbtOffset = parseInt((simulator.device.get(path+'TimeBasedTestMeasurementOffset') || [,0])[1]);
    const protocol = (simulator.device.get(path+'ProtocolVersion') || [,'Any'])[1];
    const transports = new Set((
      simulator.device.get(path+'DownloadTransports') || 
      simulator.device.get('InternetGatewayDevice.Capabilities.PerformanceDiagnostic.DownloadTransports')
    )[1].split(','));
    const numberOfConnections = parseInt((simulator.device.get(path+'NumberOfConnections') || [,1])[1]);
    if (
      simulator.device.get(path+'Interface')[1].length > 256 ||
      dscp < 0 || dscp > 63 || ethernetPriority < 0 || ethernetPriority > 7 ||
      tbtDuration < 0 || tbtDuration > 999 || tbtInterval < 0 || tbtInterval > 999 || tbtOffset < 0 || tbtOffset > 255 ||
      tbtOffset > tbtInterval || tbtInterval > tbtDuration ||
      !(protocol === "Any" || protocol === "IPv4" || protocol === "IPv6") || 
      numberOfConnections < 1 || !(transports.has('HTTP') || transports.has('FTP'))
    ) {
      queue(simulator, 'speedtest', (simulator) => {
        simulator.device.get(path+'DiagnosticsState')[1] = 'Error_Other';
      }, diagnosticDuration)
      return;
    }

    // all parameters are valid.
    queue(simulator, 'speedtest', simulator.diagnosticsStates.speedtest.result, tbtDuration || diagnosticDuration);
    // After the diagnostic is complete, the value of all result parameters (all read-only parameters in this
    // object) MUST be retained by the CPE until either this diagnostic is run again, or the CPE reboots.
  },

  // Removes old speed test results.
  eraseResult: function(simulator, path) {
    simulator.device.get(path+'IncrementalResultNumberOfEntries')[1] = '0';

    const fields = [
      'TestBytesReceived',
      'TotalBytesReceived',
      'TotalBytesSent',
      'StartTime',
      'EndTime',
    ];

    path += 'IncrementalResult.';
    let i = 0;
    while (true) {
      const intervalPath = path+`${i}.`;
      if (simulator.device.has(intervalPath)) {
        for (let field of fields) {
          simulator.device.delete(intervalPath+field);
        }
        simulator.device.delete(intervalPath);
      } else {
        return;
      }
      i++;
    }

    delete simulator.device._sortedPaths;
  },

  results: { // possible results for a speedtest diagnostic.
    default: function(simulator) { // successful speedtest result.
      const path = speedtest.path[simulator.TR];

      simulator.device.get(path+'DiagnosticsState')[1] = 'Complete';

      const tbtDuration = parseInt((simulator.device.get(path+'TimeBasedTestDuration') || [,0])[1]);
      const tbtInterval = parseInt((simulator.device.get(path+'TimeBasedTestMeasurementInterval') || [,0])[1]);
      const tbtOffset = parseInt((simulator.device.get(path+'TimeBasedTestMeasurementOffset') || [,0])[1]);
      let duration = tbtDuration || diagnosticDuration/1000; // in seconds.

      const date = new Date(); // current date, to be used as end date.
      let d = new Date(date); // copy of current date, to be used in date arithmetic.
      d.setSeconds(d.getSeconds()-duration+tbtOffset); // this works for both time based and file size based testing.
      
      simulator.device.get(path+'TCPOpenRequestTime')[1] = d.toISOString().replace('Z', '000Z');
      d.setMilliseconds(d.getMilliseconds()+2);
      simulator.device.get(path+'TCPOpenResponseTime')[1] = d.toISOString().replace('Z', '000Z');
      d.setMilliseconds(d.getMilliseconds()+2);
      simulator.device.get(path+'ROMTime')[1] = d.toISOString().replace('Z', '000Z');
      d.setMilliseconds(d.getMilliseconds()+2);
      simulator.device.get(path+'BOMTime')[1] = d.toISOString().replace('Z', '000Z');
      simulator.device.get(path+'EOMTime')[1] = date.toISOString().replace('Z', '000Z');

      const throughput = 104857600; // 100MB/s.
      let v;
      const total = throughput*duration; // 100MB/s throughput throughout the duration.
      if (v = simulator.device.get(path+'PeriodOfFullLoading')) v[1] = ''+duration*0.95*10**6|0; // 95% of the duration.
      if (v = simulator.device.get(path+'TestBytesReceived')) v[1] = `${total}`;
      if (v = simulator.device.get(path+'TotalBytesReceived')) v[1] = `${total*1.05}`;
      if (v = simulator.device.get(path+'TotalBytesSent')) v[1] = `${total*0.02}`;
      if (v = simulator.device.get(path+'TestBytesReceivedUnderFullLoading')) v[1] = `${total*0.9}`;
      if (v = simulator.device.get(path+'TotalBytesReceivedUnderFullLoading')) v[1] = `${total*0.9*1.05}`;
      if (v = simulator.device.get(path+'TotalBytesSentUnderFullLoading')) v[1] = `${total*0.9*0.02}`;
      
      if (tbtInterval) {
        speedtest.eraseResult(simulator, path);

        const n = tbtDuration/tbtInterval|0;
        simulator.device.get(path+'IncrementalResultNumberOfEntries')[1] = n.toString();

        path += 'IncrementalResult.'
        simulator.device.set(path, [false]);

        const total = throughput*tbtInterval; // 100MB/s throughput throughout the duration.
        // const remainder = tbtDuration%tbtInterval;

        for (let i = 1; i <= n; i++) {
          const intervalPath = path+`${i}.`;
          simulator.device.set(intervalPath, [false]);
          simulator.device.set(intervalPath+'TestBytesReceived', [false, `${total}`, 'xsd:unsignedInt']);
          simulator.device.set(intervalPath+'TotalBytesReceived', [false, `${total*1.05}`, 'xsd:unsignedInt']);
          simulator.device.set(intervalPath+'TotalBytesSent', [false, `${total*0.02}`, 'xsd:unsignedInt']);
          simulator.device.set(intervalPath+'StartTime', [false, d.toISOString().replace('Z', '000Z'), 'xsd:dateTime']);
          d.setSeconds(d.getSeconds()+tbtInterval);
          simulator.device.set(intervalPath+'EndTime', [false, d.toISOString().replace('Z', '000Z'), 'xsd:dateTime']);
        }
      }
    },
    error: function(simulator, errorName='Error_Internal') { // internal error.
      const path = speedtest.path[simulator.TR];
      speedtest.eraseResult(simulator, path);
      simulator.device.get(path+'DiagnosticsState')[1] = errorName;
    },
    Error_Timeout: function(simulator) { // internal error.
      speedtest.results.error(simulator, 'Error_Timeout');
    },
    failed: function(simulator) { // internal error.
      speedtest.results.error(simulator, 'Error_TransferFailed');
    },
    Error_NoResponse: function(simulator) { // internal error.
      speedtest.results.error(simulator, 'Error_NoResponse');
    },
    Error_NoRouteToHost: function(simulator) { // internal error.
      speedtest.results.error(simulator, 'Error_NoRouteToHost');
    },
  },
};
exports.speedtest = speedtest;