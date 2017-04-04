'use strict';

let chai = require('chai');
chai.use(require('chai-as-promised'));
chai.should();

describe('Reader', async function() {
    const { Reader } = require('../');

    it('basics', async function() {
        let reader = new Reader();
        reader.input.write(Buffer.from([1, 0, 0]));
        reader.input.write(Buffer.from([0, 0, 0]));
        reader.input.write(Buffer.from([0, 2, 3]));
        reader.input.write(Buffer.from([0]));
        reader.input.end();
        await reader.readUInt32LE().should.eventually.equal(1);
        await reader.readInt32BE().should.eventually.equal(2);
        await reader.readFloatLE().should.rejectedWith(Reader.EndOfStream);
    });
});
