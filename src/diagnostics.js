const methods = require("./methods");

const event = '8 DIAGNOSTICS COMPLETE';
const diagnosticDuration = 2000; // in milliseconds.

async function finish(simulator, name, func, afterMilliseconds, resolve) {
  // reference to object containing this diagnostic's execution data.
  const state = simulator.diagnosticsStates[name];

  // executing diagnostic logic after 'afterMilliseconds' and sending results.
  state.running = setTimeout(async () => {
    await func(simulator); // executing diagnostic result.
    state.running = undefined; // clearing diagnostic's timeout object.
    state.reject = undefined; // clearing diagnostic's reject function.

    simulator.runPendingEvents(async () => {
      await simulator.startSession(event); // creating a new session where diagnostic complete message is sent.
      resolve(); // next diagnostic can be executed after calling 'resolve()'.
      simulator.emit('diagnostic', name); // sent diagnostic completion event to ACS and got a response.
    });
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

const randomMAC = () => "XX:XX:XX:XX:XX:XX".replace(/X/g, () => "0123456789ABCDEF"[Math.random()*16|0]);

const randomN = (max, min=1) => Math.floor(Math.random()*(max+1-min))+min;

const getRandomFromArray = (array) => array[Math.random()*array.length|0];


const ping = {
  path: {
    tr098: 'InternetGatewayDevice.IPPingDiagnostics.',
    tr181: 'Device.IP.Diagnostics.IPPing.',
  },

  run: function(simulator, modified) { // executes Ping Diagnostic logic.
    const path = ping.path[simulator.TR];

    if (modified[path+'DiagnosticsState'] === undefined) {
      // Modifying any of the writable parameters except for 'DiganosticState' MUST result 
      // in its value being set to "None".
      if (
        modified[path+'Interface'] !== undefined ||
        modified[path+'Host'] !== undefined ||
        modified[path+'Timeout'] !== undefined ||
        modified[path+'NumberOfRepetitions'] !== undefined ||
        modified[path+'DataBlockSize'] !== undefined ||
        modified[path+'DSCP'] !== undefined
      ) {
        // While the test is in progress, modifying any of the writable parameters except for
        // 'DiganosticState' MUST result in the test being terminated and its value being set to "None".
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

    const host = simulator.device.get(path+'Host')[1];
    // checking host.
    if (host === '' || host.length > 256) {
      queue(simulator, 'ping', (simulator) => {
        simulator.device.get(path+'DiagnosticsState')[1] = 'Error_CannotResolveHostName';
      }, diagnosticDuration);
      return;
    }
    const dataBlockSize = parseInt((simulator.device.get(path+'DataBlockSize') || [,1])[1]);
    const dscp = parseInt((simulator.device.get(path+'DSCP') || [,0])[1]);
    // checking other parameter's.
    if (
      // The value of 'Interface' MUST be either a valid interface or an empty string. An attempt to set that
      // parameter to a different value MUST be rejected as an invalid parameter value. If an empty string is
      // specified, the CPE MUST use the interface as directed by its routing policy (Forwarding table entries)
      // to determine the appropriate interface.
      (simulator.device.get(path+'Interface') || [,''])[1].length > 256 ||
      !(dataBlockSize >= 1 && dataBlockSize < 65536) || !(dscp > -1 && dscp < 64) ||
      !((parseInt(simulator.device.get(path+'Timeout') || [,1000])[1]) > 0) ||
      !((parseInt(simulator.device.get(path+'NumberOfRepetitions') || [,1])[1]) > 0)
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
    error: function(simulator) { // internal error.
      const path = ping.path[simulator.TR];
      simulator.device.get(path+'DiagnosticsState')[1] = 'Error_Internal';
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
    const numberOfTries = parseInt((simulator.device.get(path+'NumberOfTries') || [,1])[1]);
    const dataBlockSize = parseInt((simulator.device.get(path+'DataBlockSize') || [,1])[1]);
    const dscp = parseInt((simulator.device.get(path+'DSCP') || [,0])[1]);
    const maxHopCount = parseInt((simulator.device.get(path+'MaxHopCount') || [,30])[1]);
    // checking other parameter's.
    if (
      (simulator.device.get(path+'Interface') || [,''])[1].length > 256 ||
      numberOfTries < 1 || numberOfTries > 3 ||
      (parseInt(simulator.device.get(path+'Timeout') || [,1000])[1]) < 1 ||
      dataBlockSize < 1 || dataBlockSize > 65535 || dscp < 0 || dscp > 63 ||
      maxHopCount < 1 || maxHopCount > 64
    ) {
      queue(simulator, 'traceroute', (simulator) => {
        simulator.device.get(path+'DiagnosticsState')[1] = 'Error_MaxHopCountExceeded';
      }, diagnosticDuration)
      return;
    }

    // all parameters are valid.
    queue(simulator, 'traceroute', simulator.diagnosticsStates.traceroute.result, diagnosticDuration);
  },

  eraseResult: function(simulator, path) { // erasing old results.
    simulator.device.get(path+'RouteHopsNumberOfEntries')[1] = '0';

    const fieldSuffix = simulator.TR === 'tr098' ? 'Hop' : '';

    let hop = 1; // starts from 1.
    while (true) {
      const routeHop = path+`RouteHops.${hop}.`;
      if (simulator.device.has(routeHop)) {
        simulator.device.delete(routeHop+fieldSuffix+'Host');
        simulator.device.delete(routeHop+fieldSuffix+'HostAddress');
        simulator.device.delete(routeHop+fieldSuffix+'ErrorCode');
        simulator.device.delete(routeHop+fieldSuffix+'RTTimes');
        simulator.device.delete(routeHop);
      } else {
        simulator.device.delete(path+'RouteHops.');
        break;
      }
      hop++;
    }

    delete simulator.device._sortedPaths;
  },
  produceHopResults: function (simulator, path, forcedMaxHops=false, amoutOfHops=8) {
    traceroute.eraseResult(simulator, path);

    const maxHops = parseInt(simulator.device.get(path+'MaxHopCount')[1]);
    const hops = forcedMaxHops ? maxHops : amoutOfHops; // doing max hops or the given amount of hops.

    simulator.device.get(path+'DiagnosticsState')[1] = forcedMaxHops ? 'Error_MaxHopCountExceeded' : 'Complete';
    simulator.device.get(path+'ResponseTime')[1] = forcedMaxHops ? `${((5+2*hops)*1.025).toFixed(3)}` : '3000';
    simulator.device.get(path+'RouteHopsNumberOfEntries')[1] = hops.toString();

    const host = simulator.device.get(path+`Host`)[1];
    const tries = parseInt(simulator.device.get(path+'NumberOfTries')[1]);

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
      if (!forcedMaxHops && hop === hops) {
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
      traceroute.produceHopResults(simulator, path, false, 8);
    },
    error: function(simulator) { // max hop count exceeded error.
      const path = traceroute.path[simulator.TR];
      traceroute.produceHopResults(simulator, path, true)
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

  eraseResult: function (simulator, path) {
    simulator.device.get(path+'ResultNumberOfEntries')[1] = '0';

    let fields = [
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
    error: function (simulator) {
      const path = sitesurvey.path[simulator.TR];
      sitesurvey.eraseResult(simulator, path);
      simulator.device.get(path+'DiagnosticsState')[1] = 'Error';
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
    const transports = new Set(simulator.device.get(path+'DownloadTransports')[1].split(','));
    if (
      simulator.device.get(path+'Interface')[1].length > 256 ||
      dscp < 0 || dscp > 63 || ethernetPriority < 0 || ethernetPriority > 7 ||
      tbtDuration < 0 || tbtDuration > 999 || tbtInterval < 0 || tbtInterval > 999 || tbtOffset < 0 || tbtOffset > 255 ||
      tbtOffset > tbtInterval || tbtInterval > tbtDuration ||
      !(protocol === "Any" || protocol === "IPv4" || protocol === "IPv6") || 
      parseInt(simulator.device.get(path+'NumberOfConnections')[1]) < 1 ||
      !(transports.has('HTTP') || transports.has('FTP'))
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

  eraseResult: function(simulator, path) {
    simulator.device.get(path+'IncrementalResultNumberOfEntries')[1] = '0';

    let fields = [
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
        simulator.device.delete(path);
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
    error: function(simulator, err='Error_Internal') { // internal error.
      const path = speedtest.path[simulator.TR];
      speedtest.eraseResult(simulator, path);
      simulator.device.get(path+'DiagnosticsState')[1] = err;
    },
    timeout: function(simulator) { // internal error.
      speedtest.results.error(simulator, 'Error_Timeout');
    },
    failed: function(simulator) { // internal error.
      speedtest.results.error(simulator, 'Error_TransferFailed');
    },
    noresponse: function(simulator) { // internal error.
      speedtest.results.error(simulator, 'Error_NoResponse');
    },
    noroute: function(simulator) { // internal error.
      speedtest.results.error(simulator, 'Error_NoRouteToHost');
    },
  },
};
exports.speedtest = speedtest;