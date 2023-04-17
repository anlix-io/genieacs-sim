function finish(simulator, name, func, afterMilliseconds) {
  simulator.diagnosticsStates[name].running = setTimeout(async () => {
    await func(simulator);
    await simulator.startSession('8 DIAGNOSTICS COMPLETE');
    simulator.emit('diagnostic', name);
  }, afterMilliseconds);
}

const ping = {
  // executes Ping Diagnostic logic.
  run: function(simulator, modified) {
    if (modified['InternetGatewayDevice.IPPingDiagnostics.DiagnosticsState'] === undefined) {
      // Modifying any of the writable parameters except for 'DiganosticState' MUST result 
      // in its value being set to "None".
      if (
        modified['InternetGatewayDevice.IPPingDiagnostics.Host'] !== undefined ||
        modified['InternetGatewayDevice.IPPingDiagnostics.Interface'] !== undefined ||
        modified['InternetGatewayDevice.IPPingDiagnostics.Timeout'] !== undefined ||
        modified['InternetGatewayDevice.IPPingDiagnostics.NumberOfRepetitions'] !== undefined ||
        modified['InternetGatewayDevice.IPPingDiagnostics.DataBlockSize'] !== undefined ||
        modified['InternetGatewayDevice.IPPingDiagnostics.DSCP'] !== undefined
      ) {
        // While the test is in progress, modifying any of the writable parameters except for
        // 'DiganosticState' MUST result in the test being terminated and its value being set to "None".
        clearTimeout(simulator.diagnosticsStates.ping.running);
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
    clearTimeout(simulator.diagnosticsStates.ping.running);

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
      finish(simulator, 'ping', (simulator) => {
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
      !(dataBlockSize >= 0 && dataBlockSize < 65536) || !(dscp > -1 && dscp < 64) ||
      !(parseInt(simulator.device['InternetGatewayDevice.IPPingDiagnostics.Timeout'][1]) > 0) ||
      !(parseInt(simulator.device['InternetGatewayDevice.IPPingDiagnostics.NumberOfRepetitions'][1]) > 0)
    ) {
      finish(simulator, 'ping', (simulator) => {
        simulator.device['InternetGatewayDevice.IPPingDiagnostics.DiagnosticsState'][1] = 'Error_Other';
      }, 50)
      return;
    }

    // all parameters are valid.
    finish(simulator, 'ping', simulator.diagnosticsStates.ping.result, 1000);
    // After the diagnostic is complete, the value of all result parameters (all read-only parameters in this
    // object) MUST be retained by the CPE until either this diagnostic is run again, or the CPE reboots.
  },

  results: {
    default: function(simulator) {
      // When requested, the CPE SHOULD wait until after completion of the communication session with the
      // ACS before starting the diagnostic.
      simulator.device['InternetGatewayDevice.IPPingDiagnostics.DiagnosticsState'][1] = 'Complete';
      simulator.device['InternetGatewayDevice.IPPingDiagnostics.SuccessCount'][1] =
        simulator.device['InternetGatewayDevice.IPPingDiagnostics.NumberOfRepetitions'][1];
      simulator.device['InternetGatewayDevice.IPPingDiagnostics.FailureCount'][1] = '0';
      simulator.device['InternetGatewayDevice.IPPingDiagnostics.AverageResponseTime'][1] = '11';
      simulator.device['InternetGatewayDevice.IPPingDiagnostics.MinimumResponseTime'][1] = '9';
      simulator.device['InternetGatewayDevice.IPPingDiagnostics.MaximumResponseTime'][1] = '14';
    },
    error: function(simulator) {
      // forced error.
      simulator.device['InternetGatewayDevice.IPPingDiagnostics.DiagnosticsState'][1] = 'Error_Internal';
    },
  },
};
exports.ping = ping;
