const models = require('./models');

// 'lanDevice' should be an object that may contain values for the following attributes: radio, active, source, name,
// mac, ip, interface, leaseTime, band, mode, rssi, snr, rate. Any attribute that is not present will be filled
// with a default value. Attribute 'radio' defines if the LAN device will be added to Wi-Fi 2.4Ghz when it equals 2,
// Wi-Fi 5.0Ghz when it equals 5 or cable when it equals undefined. Default is cable. Attribute 'mac', when not given
// will be filled with a random one.
exports.addLanDevice = function (lanDevice) {
  if (!lanDevice) return; // returns when no 'lanDevice' given in argument.

  const deviceId = this.device.get('DeviceID.ID');
  const model = models[deviceId ? deviceId[1] : ''];

  // radio should be 2, 5 or undefined, for models the we know the exact path.
  // radio 2 is 2.4Ghz, radio 5 is 5.0Ghz and radio undefined means cable.
  const radio = lanDevice['radio'];
  if (model && (radio != 2 && radio != 5 && radio !== undefined)) return;

  delete this.device._sortedPaths; // cleaning list of paths.

  let hostsPath = model ? model.hosts.path
                : this.TR === 'tr098' ? 'InternetGatewayDevice.LANDevice.1.Hosts.'
                : 'Device.Hosts.';

  // Adding to Hosts section.
  const hosts = model.hosts; // hosts parameters structure.
  let hostPath = hostsPath+'Host.';
  const hostIndex = getNextIndexInPath(this, hostPath);
  lanDevice.hostIndex = hostIndex;
  this.device.get(hostsPath+'HostNumberOfEntries')[1] = hostIndex.toString(); // saving incremented number of entries.

  // 'InternetGatewayDevice.LANDevice.1.Hosts.Host' already exists, so we don't have to create it.
  hostPath += `${hostIndex}.`;
  this.device.set(hostPath, [false]); // creating parent node for host in i-th index.
  addFieldsToPath(this, hostPath, lanDevice, hosts.fields);

  // Adding to AssociatedDevice section.
  // if no 'radio' then it's cable and 'AssociatedDevice' should not be filled.
  // if no 'model' then we don't know how to fill 'AssociatedDevice'.
  if (!model || !radio) return;
  const associated_device = model.associated_device;
  let associatedDevicePath = associated_device['path'+radio];
  const associatedDeviceIndex = getNextIndexInPath(this, associatedDevicePath);
  lanDevice.associatedDeviceIndex = associatedDeviceIndex;
  associatedDevicePath += `${associatedDeviceIndex}.`;
  createNodesForPath(this, associatedDevicePath);
  addFieldsToPath(this, associatedDevicePath, lanDevice, associated_device.fields);
}

// Adds 'lanDevice' parameters for each of the given 'fields' at the 'path' in the 'simulator' model.
// If 'lanDevice' doesn't have a parameter, the default value in 'fields' will be used.
// 'fields' should taken from value of any exported key from file "./models.js".
function addFieldsToPath(simulator, path, lanDevice, fields) {
  for (let k in fields) { // for all listed fields in the model.
    const field = fields[k];
    let v = lanDevice[k]; // take value lan device to be created.
    if (v !== undefined) {
      if (!field.valid(v)) continue; // if value is not valid, continue to next field.
      if (field.format) v = field.format(v); // if field has a format value should be formatted.
    } else {
      v = field.default || ''; // if no default value, we use an empty string.
      // if default is a function, we use its return.
      if (v.constructor === Function) v = v(lanDevice, simulator);
      // if given value is undefined, no need to format the default value.
    }
    simulator.device.set(path+field.key, [false, v, field.type]);
  }
}

// creates non leaf nodes for given path.
function createNodesForPath(simulator, fullPath) {
  let steps = fullPath.split('.')
  if (steps[steps.length-1] === '') steps.pop();
  for (let path = steps[0]+'.'; steps.length > 0; path += steps[0]+'.') {
    steps.shift();
    if (simulator.device.has(path)) continue;
    simulator.device.set(path, [false]); // creating non leaf nodes.
  }
}

// given a 'path' of a 'simulator' model, returns first non existing index, starting from 1.
// this is useful for paths that are lists, like: 'Device.Hosts.*'.
function getNextIndexInPath(simulator, path) {
  let index = 1;
  while (simulator.device.has(path+index+'.')) index++;
  return index;
}
