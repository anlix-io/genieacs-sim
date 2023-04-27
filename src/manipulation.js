exports.addLanDevice = function (lanDevice) {
  if (!lanDevice) return; // returns when no 'lanDevice' given in argument.
  if (!(lanDevice.HostName && lanDevice.IPAddress && lanDevice.MACAddress)) return; // required fields.

  let path = 'InternetGatewayDevice.LANDevice.1.Hosts.';
  const numberOfEntriesNode = this.device[path+'HostNumberOfEntries'];
  const index = parseInt(numberOfEntriesNode[1])+1; // current entry number is 'number of entries'+1.
  numberOfEntriesNode[1] = index.toString(); // saving incremented number of entries.
  
  // 'InternetGatewayDevice.LANDevice.1.Hosts.Host' already exists, so we don't have to create it.
  path += `Host.${index}.`;
  this.device[path] = [true];
  let v = lanDevice['Active']; // taking value.
  if (v && (v.constructor === Boolean || v.constructor === String)) {
  	this.device[path+'Active'] = [false, v.toString(), 'xsd:boolean'];
  }
  v = lanDevice['AddressSource'];
  if (v && v.constructor === String) this.device[path+'AddressSource'] = [false, v, 'xsd:string'];
  v = lanDevice['ClientID'];
  if (v && v.constructor === String) this.device[path+'ClientID'] = [false, v, 'xsd:string'];
  v = lanDevice['HostName'];
  if (v && v.constructor === String) this.device[path+'HostName'] = [false, v, 'xsd:string'];
  v = lanDevice['IPAddress'];
  if (v && v.constructor === String) this.device[path+'IPAddress'] = [false, v, 'xsd:string'];
  v = lanDevice['InterfaceType'];
  if (v && v.constructor === String) this.device[path+'InterfaceType'] = [false, v, 'xsd:string'];
  v = lanDevice['Layer2Interface'];
  if (v && v.constructor === String) this.device[path+'Layer2Interface'] = [false, v, 'xsd:string'];
  v = lanDevice['LeaseTimeRemaining'];
  if (v && v.constructor === Number) this.device[path+'LeaseTimeRemaining'] = [false, v.toFixed(0), 'xsd:int'];
  v = lanDevice['MACAddress'];
  if (v && v.constructor === String) this.device[path+'MACAddress'] = [false, v, 'xsd:string'];
  v = lanDevice['UserClassID'];
  if (v && v.constructor === String) this.device[path+'UserClassID'] = [false, v, 'xsd:string'];
  v = lanDevice['VendorClassID'];
  if (v && v.constructor === String) this.device[path+'VendorClassID'] = [false, v, 'xsd:string'];
}