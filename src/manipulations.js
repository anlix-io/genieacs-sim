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

  delete this.device._sortedPaths;
}
