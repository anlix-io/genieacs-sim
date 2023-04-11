"use strict";

function node(key, attrs = {}, value = "") {
  if (Array.isArray(value)) value = value.join("");
  let attrsStr = "";
  for (const [k, v] of Object.entries(attrs)) attrsStr += ` ${k}="${v}"`;
  if (!value) return `<${key}${attrsStr}/>`
  return `<${key}${attrsStr}>${value}</${key}>`
}

function formatXML(xml, tab = '\t', nl = '\n') {
  if (xml.indexOf('<') < 0) return xml;
  let formatted = '';
  let indent = '';
  const nodes = xml.slice(1, -1).split(/>\s*</);
  if (nodes[0][0] === '?') formatted += '<' + nodes.shift() + '>' + nl;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node[0] === '/') indent = indent.slice(tab.length); // decrease indent
    formatted += indent + '<' + node + '>' + nl;
    if (
      node[0] !== '/' && node[node.length-1] !== '/' && node.indexOf('</') < 0
    ) {
      indent += tab; // increase indent
    }
  }
  return formatted;
};

exports.node = node;
exports.formatXML = formatXML;
