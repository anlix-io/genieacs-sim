const possibleRssiFieldNames = ['SignalStrength', 'AssociatedDeviceRssi', 'X_HW_RSSI', 'RSSI',
  'X_TP_StaSignalStrength', 'X_ZTE-COM_RSSI', 'X_ZTE-COM_WLAN_RSSI', 'X_DLINK_RSSI', 'X_CT-COM_RSSI',
  'WLAN_RSSI', 'X_ITBS_WLAN_ClientSignalStrength', 'X_ITBS_WLAN_ClientSignalStrength'];

exports.addLanDevice = function (lanDevice) {
  if (!lanDevice) return; // returns when no 'lanDevice' given in argument.
  if (!(lanDevice.HostName && lanDevice.IPAddress && lanDevice.MACAddress)) return; // required fields.

  let hostsPath = this.TR === 'tr069'
    ? 'InternetGatewayDevice.LANDevice.1.Hosts.'
    : 'Device.Hosts.';

  const numberOfEntriesNode = this.device.get(hostsPath+'HostNumberOfEntries');
  const index = parseInt(numberOfEntriesNode[1])+1; // current entry number is 'number of entries'+1.
  numberOfEntriesNode[1] = index.toString(); // saving incremented number of entries.
  
  // 'InternetGatewayDevice.LANDevice.1.Hosts.Host' already exists,
  // so we don't have to create it and, also, we seem to not need it.
  hostsPath += `Host.${index}.`;
  this.device.set(hostsPath, [true]); // creating parent node for host in i-th index.
  let v = lanDevice['Active']; // taking value.
  if (v && v.constructor === Boolean) { // checking 'lanDevice' attribute's data type.
  	this.device.set(hostsPath+'Active', [false, v.toString(), 'xsd:boolean']); // adding key value pair for attribute.
  }
  v = lanDevice['AddressSource'];
  if (v && v.constructor === String) this.device.set(hostsPath+'AddressSource', [false, v, 'xsd:string']);
  v = lanDevice['ClientID'];
  if (v && v.constructor === String) this.device.set(hostsPath+'ClientID', [false, v, 'xsd:string']);
  v = lanDevice['HostName'];
  if (v && v.constructor === String) this.device.set(hostsPath+'HostName', [false, v, 'xsd:string']);
  v = lanDevice['IPAddress'];
  if (v && v.constructor === String) this.device.set(hostsPath+'IPAddress', [false, v, 'xsd:string']);
  v = lanDevice['IPv4AddressNumberOfEntries'];
  if (v && v.constructor === String) this.device.set(hostsPath+'IPv4AddressNumberOfEntries', [false, v, 'xsd:unsignedInt']);
  v = lanDevice['IPv6Address'];
  if (v && v.constructor === String) this.device.set(hostsPath+'IPv6Address', [false, v, 'xsd:string']);
  v = lanDevice['IPv6AddressNumberOfEntries'];
  if (v && v.constructor === String) this.device.set(hostsPath+'IPv6AddressNumberOfEntries', [false, v, 'xsd:unsignedInt']);
  v = lanDevice['IPv6LinkLocal'];
  if (v && v.constructor === String) this.device.set(hostsPath+'IPv6LinkLocal', [false, v, 'xsd:string']);
  v = lanDevice['InterfaceType'];
  if (v && v.constructor === String) this.device.set(hostsPath+'InterfaceType', [false, v, 'xsd:string']);
  v = lanDevice['Layer2Interface'];
  let radio = lanDevice['radio'];
  if (v === undefined && radio !== undefined) {
    v = this.TR === 'tr069' 
      ? `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${radio}`
      : `Device.WiFi.MultiAP.APDevice.1.Radio.${radio}.AP.2`;
  }
  if (v && v.constructor === String) this.device.set(hostsPath+'Layer2Interface', [false, v, 'xsd:string']);
  v = lanDevice['LeaseTimeRemaining'];
  if (v && v.constructor === Number) this.device.set(hostsPath+'LeaseTimeRemaining', [false, v.toFixed(0), 'xsd:int']);
  v = lanDevice['MACAddress'];
  if (v && v.constructor === String) this.device.set(hostsPath+'MACAddress', [false, v, 'xsd:string']);
  v = lanDevice['PhysAddress'];
  if (v && v.constructor === String) this.device.set(hostsPath+'PhysAddress', [false, v, 'xsd:string']);
  v = lanDevice['UserClassID'];
  if (v && v.constructor === String) this.device.set(hostsPath+'UserClassID', [false, v, 'xsd:string']);
  v = lanDevice['VendorClassID'];
  if (v && v.constructor === String) this.device.set(hostsPath+'VendorClassID', [false, v, 'xsd:string']);

  // associatedDevicesPath = this.TR === 'tr069'
  //   ? `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${1}.AssociatedDevice.`
  //   : `Device.WiFi.MultiAP.APDevice.1.Radio.${}.AP.2.AssociatedDevice.`;

  let associatedDevicesPath = lanDevice['Layer2Interface']+`.AssociatedDevice.${index}`;
  createNodesForPath(this, associatedDevicesPath)
  associatedDevicesPath += '.'+

  v = lanDevice['rssi'];
  for (let name of possibleRssiFieldNames) {
    this.device.set(associatedDevicesPath+name, [false, v.toString(), 'xsd:int']);
  }

  delete this.device._sortedPaths;
}

function createNodesForPath(simulator, fullPath) {
  let steps = fullPath.split('.');
  for (let path = steps[0]; steps.length > 0; path += '.'+steps[0]) {
    steps.shift();
    if (simulator.device.has(path)) continue;
    simulator.device.set(path, [false]);
  }
}
