exports.addLanDevice = function (lanDevice) {
  if (!lanDevice) return; // returns when no 'lanDevice' given in argument.
  if (!(lanDevice.HostName && lanDevice.IPAddress && lanDevice.MACAddress)) return; // required fields.

  let path = this.TR === 'tr069'
    ? 'InternetGatewayDevice.LANDevice.1.Hosts.'
    : 'Device.Hosts.';

  const numberOfEntriesNode = this.device[path+'HostNumberOfEntries'];
  const index = parseInt(numberOfEntriesNode[1])+1; // current entry number is 'number of entries'+1.
  numberOfEntriesNode[1] = index.toString(); // saving incremented number of entries.
  
  // 'InternetGatewayDevice.LANDevice.1.Hosts.Host' already exists,
  // so we don't have to create it and, also, we seem to not need it.
  path += `Host.${index}.`;
  this.device[path] = [true]; // creating parent node for host in i-th index.
  let v = lanDevice['Active']; // taking value.
  if (v && v.constructor === Boolean) { // checking 'lanDevice' attribute's data type.
  	this.device[path+'Active'] = [false, v.toString(), 'xsd:boolean']; // adding key value pair for attribute.
  }
  v = lanDevice['AddressSource'];
  if (v && v.constructor === String) this.device[path+'AddressSource'] = [false, v, 'xsd:string'];
  v = lanDevice['ClientID'];
  if (v && v.constructor === String) this.device[path+'ClientID'] = [false, v, 'xsd:string'];
  v = lanDevice['HostName'];
  if (v && v.constructor === String) this.device[path+'HostName'] = [false, v, 'xsd:string'];
  v = lanDevice['IPAddress'];
  if (v && v.constructor === String) this.device[path+'IPAddress'] = [false, v, 'xsd:string'];
  v = lanDevice['IPv4AddressNumberOfEntries'];
  if (v && v.constructor === String) this.device[path+'IPv4AddressNumberOfEntries'] = [false, v, 'xsd:unsignedInt'];
  v = lanDevice['IPv6Address'];
  if (v && v.constructor === String) this.device[path+'IPv6Address'] = [false, v, 'xsd:string'];
  v = lanDevice['IPv6AddressNumberOfEntries'];
  if (v && v.constructor === String) this.device[path+'IPv6AddressNumberOfEntries'] = [false, v, 'xsd:unsignedInt'];
  v = lanDevice['IPv6LinkLocal'];
  if (v && v.constructor === String) this.device[path+'IPv6LinkLocal'] = [false, v, 'xsd:string'];
  v = lanDevice['InterfaceType'];
  if (v && v.constructor === String) this.device[path+'InterfaceType'] = [false, v, 'xsd:string'];
  v = lanDevice['Layer2Interface'];
  if (v && v.constructor === String) this.device[path+'Layer2Interface'] = [false, v, 'xsd:string'];
  v = lanDevice['LeaseTimeRemaining'];
  if (v && v.constructor === Number) this.device[path+'LeaseTimeRemaining'] = [false, v.toFixed(0), 'xsd:int'];
  v = lanDevice['MACAddress'];
  if (v && v.constructor === String) this.device[path+'MACAddress'] = [false, v, 'xsd:string'];
  v = lanDevice['PhysAddress'];
  if (v && v.constructor === String) this.device[path+'PhysAddress'] = [false, v, 'xsd:string'];
  v = lanDevice['UserClassID'];
  if (v && v.constructor === String) this.device[path+'UserClassID'] = [false, v, 'xsd:string'];
  v = lanDevice['VendorClassID'];
  if (v && v.constructor === String) this.device[path+'VendorClassID'] = [false, v, 'xsd:string'];

  delete this.device._sortedPaths;
}
