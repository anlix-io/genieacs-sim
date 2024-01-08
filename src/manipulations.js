// Set of methods to manipulate the TR069 tree structure of a device.

const models = require('./models');
const utils = require('./manipulations_utils');
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
  const hostIndex = utils.getNextIndexInPath(this, hostPath);
  lanDevice.hostIndex = hostIndex;
  this.device.get(hostsPath+'HostNumberOfEntries')[1] = hostIndex.toString(); // saving incremented number of entries.

  // 'InternetGatewayDevice.LANDevice.1.Hosts.Host' already exists, so we don't have to create it.
  hostPath += `${hostIndex}.`;
  this.device.set(hostPath, [false]); // creating parent node for host in i-th index.
  utils.addFieldsToPath(this, hostPath, lanDevice, hosts.fields);

  // Adding to AssociatedDevice section.
  // if no 'radio' then it's cable and 'AssociatedDevice' should not be filled.
  // if no 'model' then we don't know how to fill 'AssociatedDevice'.
  if (!model || !radio) return;
  const associated_device = model.associated_device;
  let associatedDevicePath = associated_device['path'+radio];
  const associatedDeviceIndex = utils.getNextIndexInPath(this, associatedDevicePath);
  lanDevice.associatedDeviceIndex = associatedDeviceIndex;
  associatedDevicePath += `${associatedDeviceIndex}.`;
  utils.createNodesForPath(this, associatedDevicePath);
  utils.addFieldsToPath(this, associatedDevicePath, lanDevice, associated_device.fields);
}
