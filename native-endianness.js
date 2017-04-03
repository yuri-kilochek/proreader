'use strict';

///////////////////////////////////////////////////////////////////////////////

let u16 = Uint16Array.of(1);
let u8 = new Uint8Array(u16.buffer, u16.byteOffset, u16.byteLength);
module.exports = exports = u8[0] ? 'LE' : 'BE';
