'use strict';

const { PassThrough: PassThroughStream } = require('stream');

const Reader = require('./reader.js');

(async () => {
    let rs = new PassThroughStream();
    let pr = new Reader(rs);
    let a = new Uint32Array(2);
    rs.write(Buffer.from([1, 0, 0, 0]));
    rs.write(Buffer.from([2, 0, 0]));
    rs.write(Buffer.from([0, 3]));
    rs.write(Buffer.from([0, 0, 0]));
    rs.write('foobar');
    rs.write(Buffer.from([0, 0]));
    rs.end();
    console.log(await pr.read(a), a, pr.bytesRemain);
    console.log(await pr.read(a.subarray(1), { allowPart: true }), a, pr.bytesRemain);
    console.log(await pr.readString(6));
    console.log(await pr.readUInt16LE(), pr.bytesRemain);
})().catch(console.error);

//for (let endianness of ['LE', 'BE']) {
//    Object.assign(ProReader.prototype, {
//        [`read${endianness}`](thing) {
//            if (Buffer.isBuffer(thing)) {
//                return this[`_readBuffer${endianness}`](thing);
//            }
//            this[`_readTypedArray${endianness}`](thing);
//        },
//    });
//}

