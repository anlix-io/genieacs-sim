// const possibleRssiFieldNames = ['SignalStrength', 'AssociatedDeviceRssi', 'X_HW_RSSI', 'RSSI',
//   'X_TP_StaSignalStrength', 'X_ZTE-COM_RSSI', 'X_ZTE-COM_WLAN_RSSI', 'X_DLINK_RSSI', 'X_CT-COM_RSSI',
//   'WLAN_RSSI', 'X_ITBS_WLAN_ClientSignalStrength', 'X_ITBS_WLAN_ClientSignalStrength'];

// validation.
const typeIs = (v, t) => v.constructor === t;
const isBoolean = (v) => typeIs(v, Boolean);
const isString = (v) => typeIs(v, String);
const isNumber = (v) => typeIs(v, Number);
const isPositiveNumber = (v) => isNumber(v) && v > 0;
const isMacAddress = (v) => isString(v) && /^(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(v);
const isIPv4 = (v) => isString(v) && /^(?:25[0-5]|2[0-4]\d|1?\d{0,2})(?:\.(?:25[0-5]|2[0-4]\d|1?\d{0,2})){3}$/.test(v);
const bandwidths = {'20': true, '40': true, '80': true, '160': true}
const isBandwidth = (v) => isNumber(v) && bandwidths[v];
const modes = {n: true, ac: true, ax: true, a: true, b: true, g: true};
const isMode = (v) => modes[v];
const isRssi = (v) => isNumber(v) && v < 0;

// formatting.
const toString = (v) => v.toString();
const toInteger = (v) => v.toFixed(0);
const toBandwidth = (v) => `${v}MHz`;

// default value generators.
const randomMac = () => "XX:XX:XX:XX:XX:XX".replace(/X/g, () => "0123456789abcdef".charAt(Math.floor(Math.random()*16)));
const basicDefaultRadioMode = (landDevice) => landDevice.radio === 2 ? 'n' : 'ac';
const basicDefaultInterface = (landDevice) => landDevice.radio !== undefined ? '802.11' : 'Ethernet';
const tplinkDefaultInterface = (landDevice) => landDevice.radio !== undefined ? 'Wi-Fi' : '';
const defautIpv4 = (landDevice, simulator) => {
  const ipParts = simulator.device.get(simulator.TR === 'tr098'
    ? 'InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.IPInterface.1.IPInterfaceIPAddress'
    : 'Device.IP.Interface.1.IPv4Address.1.IPAddress'
  )[1].split('.'); // getting CPE dhcp server IP.
  let lastPart = parseInt(ipParts[3]);
  lastPart += landDevice.hostIndex;
  if (lastPart > 255) throw new Error('IP overflow when adding new device.');
  ipParts[3] = ''+lastPart; // lan device IP will be CPE IP incremented by device index.
  return ipParts.join('.');
}

// a starting point of each field that belongs to 'Hosts' and 'AssociatedDevice' through several models.
const standard = {
  active: {key: 'Active', type: 'xsd:boolean', default: 'true', valid: isBoolean, format: toString},
  source: {key: 'AddressSource', type: 'xsd:string', default: 'DHCP', valid: isString}, // another possible value is 'Static'.
  name: {key: 'HostName', type: 'xsd:string', valid: isString},
  mac: {key: 'MACAddress', type: 'xsd:string', default: randomMac, valid: isMacAddress},
  ip: {key: 'IPAddress', type: 'xsd:string', default: defautIpv4, valid: isIPv4},
  interface: {key: 'InterfaceType', type: 'xsd:string', default: basicDefaultInterface, valid: isString},
  leaseTime: {key: 'LeaseTimeRemaining', type: 'xsd:int', default: '86207', valid: isPositiveNumber, format: toInteger},
  band: {key: 'Bandwidth', type: 'xsd:string', default: '20MHz', valid: isBandwidth, format: toBandwidth},
  mode: {key: 'Standard', type: 'xsd:string', default: basicDefaultRadioMode, valid: isMode},
  rssi: {key: 'SignalStrength', type: 'xsd:int', default: '-57', valid: isRssi, format: toInteger},
  snr: {key: 'SignalNoiseRatio', type: 'xsd:int', default: '42', valid: isPositiveNumber, format: toInteger},
  rate: {key: 'LastDataTransmitRate', type: 'xsd:unsignedInt', default: '144000', valid: isPositiveNumber, format: toInteger},
};

// returns a new object that copies the values of both given objects but prefers the values of the second.
const copy = (obj, modifications={}) => {
  let ret = {};
  for (let k in obj) ret[k] = modifications[k] || obj[k];
  return ret;
};

// For each model, contains the necessary fields to be added to 'Hosts' and 'AssociatedDevice' according to an actual CPE. 
// Each field has its key name, its data type, a valid default value and, if the default value is not being used, a
// validation function to be tested against and a format function.
module.exports = { // key is simulator.device.get('DeviceID.ID').
  '9CA2F4-IGD-22282X5007025': { // tplink EC220-G5 V2.
    hosts: {
      path: 'InternetGatewayDevice.LANDevice.1.Hosts.',
      fields: {
        active: standard.active,
        source: standard.source,
        name: standard.name,
        mac: standard.mac,
        ip: standard.ip,
        interface: copy(standard.interface, {default: tplinkDefaultInterface}),
        leaseTime: standard.leaseTime,
      },
    },
    associated_device: {
      path2: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.AssociatedDevice.',
      path5: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.AssociatedDevice.',
      fields: {
        mac: copy(standard.mac, {key: 'AssociatedDeviceMACAddress'}),
        band: copy(standard.band, {key: 'X_TP_StaBandWidth', default: '20M', format: (v) => `${v}M`}),
        mode: copy(standard.mode, {
          key: 'X_TP_StaStandard',
          default: (landDevice) => '11'+basicDefaultRadioMode(landDevice),
          format: (v) => '11'+v,
        }),
        rssi: copy(standard.rssi, {key: 'X_TP_StaSignalStrength', type: 'xsd:string'}),
        rate: copy(standard.rate, {key: 'X_TP_StaConnectionSpeed'}),
      },
    },
  },
  '9CA2F4-EC220%2DG5-22275K2000315': { // tplink EC220-G5 V3.
    hosts: {
      path: 'Device.Hosts.',
      fields: {
        active: standard.active,
        name: standard.name,
        ip: standard.ip,
        leaseTime: standard.leaseTime,
        mac: copy(standard.mac, {key: 'PhysAddress'}),
      },
    },
    associated_device: {
      path2: 'Device.WiFi.AccessPoint.1.AssociatedDevice.',
      path5: 'Device.WiFi.AccessPoint.3.AssociatedDevice.',
      fields: {
        mac: standard.mac,
        band: standard.band,
        mode: standard.mode,
        rssi: standard.rssi,
        rate: copy(standard.rate, {key: 'LastDataDownlinkRate'}),
      }
    },
  },
  '1C61B4-Device2-2226469000523': { // tplink EX220.
    hosts: {
      path: 'Device.Hosts.',
      fields: {
        active: standard.active,
        source: standard.source,
        name: standard.name,
        ip: standard.ip,
        interface: copy(standard.interface, {default: tplinkDefaultInterface}),
        leaseTime: standard.leaseTime,
        mac: copy(standard.mac, {key: 'PhysAddress'}),
      },
    },
    associated_device: {
      path2: 'Device.WiFi.MultiAP.APDevice.1.Radio.1.AP.2.AssociatedDevice.',
      path5: 'Device.WiFi.MultiAP.APDevice.1.Radio.2.AP.2.AssociatedDevice.',
      fields: {
        mac: standard.mac,
        rssi: copy(standard.rssi, {type: 'xsd:unsignedInt', default: '110', valid: isPositiveNumber}),
        rate: copy(standard.rate, {key: 'LastDataDownlinkRate'}),
      }
    },
  },
  '1C61B4-Device2-22275A7000395': { // tplink XX230V.
    hosts: {
      path: 'Device.Hosts.',
      fields: {
        active: standard.active,
        source: standard.source,
        name: standard.name,
        ip: standard.ip,
        leaseTime: standard.leaseTime,
        mac: copy(standard.mac, {key: 'PhysAddress'}),
      },
    },
    associated_device: {
      path2: 'Device.WiFi.MultiAP.APDevice.1.Radio.1.AP.2.AssociatedDevice.',
      path5: 'Device.WiFi.MultiAP.APDevice.1.Radio.2.AP.2.AssociatedDevice.',
      fields: {
        mac: standard.mac,
        rssi: copy(standard.rssi, {type: 'xsd:unsignedInt', default: '110', valid: isPositiveNumber}),
        rate: copy(standard.rate, {key: 'LastDataDownlinkRate'}),
      }
    },
  },
  'C0B101-ZXHN%20H199A-ZTEYH86LCN10105': { // multilaser H199.
    hosts: {
      path: 'InternetGatewayDevice.LANDevice.1.Hosts.',
      fields: {
        active: standard.active,
        source: standard.source,
        name: standard.name,
        ip: standard.ip,
        interface: standard.interface,
        leaseTime: standard.leaseTime,
        mac: standard.mac,
      },
    },
    associated_device: {
      path2: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.AssociatedDevice.',
      path5: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.AssociatedDevice.',
      fields: {
        mac: copy(standard.mac, {key: 'AssociatedDeviceMACAddress'}),
        band: copy(standard.band, {key: 'AssociatedDeviceBandWidth'}),
        snr: copy(standard.snr, {key: 'X_ZTE-COM_SNR'}),
        rate: copy(standard.rate, {key: 'AssociatedDeviceRate'}),
        rssi: copy(standard.rssi, {key: 'AssociatedDeviceRssi'}),
      }
    },
  },
  '00E04C-W5%2D2100G-D8365F659C6E': { // intelbras w5 2100g.
     hosts: {
      path: 'InternetGatewayDevice.LANDevice.1.Hosts.',
      fields: {
        active: standard.active,
        source: standard.source,
        name: standard.name,
        ip: standard.ip,
        interface: standard.interface,
        leaseTime: standard.leaseTime,
        mac: standard.mac,
      },
    },
    associated_device: {
      path2: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.AssociatedDevice.',
      path5: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.AssociatedDevice.',
      fields: {
        mac: copy(standard.mac, {key: 'AssociatedDeviceMACAddress'}),
        rate: copy(standard.rate, {type: 'xsd:string', default: (d) => d.radio === 2 ? '6' : '24'}),
      }
    },
  },
  '00259E-EG8145V5-48575443A94196A5': { // Huawei EG8145 V5
    hosts: {
      path: 'InternetGatewayDevice.LANDevice.1.Hosts.',
      fields: {
        active: standard.active,
        source: standard.source,
        name: standard.name,
        ip: standard.ip,
        interface: standard.interface,
        leaseTime: standard.leaseTime,
        mac: standard.mac,
      },
    },
    associated_device: {
      path2: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.AssociatedDevice.',
      path5: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.AssociatedDevice.',
      fields: {
        mac: copy(standard.mac, {key: 'AssociatedDeviceMACAddress'}),
        // band: standard.band,
        snr: copy(standard.snr, {key: 'X_HW_SNR'}),
        rssi: copy(standard.rssi, {key: 'X_HW_RSSI'}),
        rate: copy(standard.rate, {key: 'X_HW_TxRate'}),
      }
    },
  },
  '9075BC-G%2D1425G%2DA-ALCLFC265D6F': { // Nokia G-1425G-A
    hosts: {
      path: 'InternetGatewayDevice.LANDevice.1.Hosts.',
      fields: {
        active: standard.active,
        source: standard.source,
        name: standard.name,
        ip: standard.ip,
        interface: standard.interface,
        leaseTime: standard.leaseTime,
        mac: standard.mac,
      },
    },
    associated_device: {
      path2: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.AssociatedDevice.',
      path5: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.AssociatedDevice.',
      fields: {
        mac: copy(standard.mac, {key: 'AssociatedDeviceMACAddress'}),
        // band: standard.band,
        mode: copy(standard.mode, {key: 'OperatingStandard'}),
        rate: copy(standard.rate, {key: 'LastDataDownlinkRate', type: 'xsd:int', default: '144000'}),
        rssi: standard.rssi,
      },
    },
  },
};
