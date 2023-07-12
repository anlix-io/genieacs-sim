// Adds 'lanDevice' parameters for each of the given 'fields' at the 'path' in the 'simulator' model.
// If 'lanDevice' doesn't have a parameter, the default value in 'fields' will be used.
// 'fields' should taken from value of any exported key from file "./models.js".
const addFieldsToPath = function(simulator, path, lanDevice, fields, writable=false) {
  for (let k in fields) { // for all listed fields in the model.
    const field = fields[k];
    let v = lanDevice[k]; // taking value from LAN device to be created.
    if (v !== undefined) {
      if (!field.valid(v)) continue; // if value is not valid, continue to next field.
      if (field.format) v = field.format(v); // if field has a format value should be formatted.
    } else {
      v = field.default || ''; // if no default value, we use an empty string.
      // if default is a function, we use its return.
      if (v.constructor === Function) v = v(lanDevice, simulator);
      // if given value is undefined, no need to format the default value.
    }
    simulator.device.set(path+field.key, [writable, v, field.type]);
  }
}
exports.addFieldsToPath = addFieldsToPath;

// creates non leaf nodes for given path.
const createNodesForPath = function(simulator, fullPath) {
  let steps = fullPath.split('.')
  if (steps[steps.length-1] === '') steps.pop();
  for (let path = steps[0]+'.'; steps.length > 0; path += steps[0]+'.') {
    steps.shift();
    if (simulator.device.has(path)) continue;
    simulator.device.set(path, [false]); // creating non leaf nodes.
  }
}
exports.createNodesForPath = createNodesForPath;

// given a 'path' of a 'simulator' model, returns first non existing index, starting from 1.
// this is useful for paths that are lists, like: 'Device.Hosts.*'.
const getNextIndexInPath = function(simulator, path) {
  let index = 1;
  while (simulator.device.has(path+index+'.')) index++;
  return index;
}
exports.getNextIndexInPath = getNextIndexInPath;
