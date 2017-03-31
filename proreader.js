const { PassThrough: PassThroughStream } = require('stream');

const isPlainObject = require('is-plain-object');
const Error = require('es6-error');

///////////////////////////////////////////////////////////////////////////////

const nativeEndianness = (() => {
    let u16 = Uint16Array.of(1);
    let u8 = new Uint8Array(u16.buffer, u16.byteOffset, u16.byteLength);
    return u8[0] ? 'LE' : 'BE';
})();

class ProReader {
    constructor(stream) {
        this._stream = new PassThroughStream();

        this._error = null;
        this._data = [];
        this._end = false;

        this._bytesRemain = undefined;

        this._resolve = null;
        this._reject = null;

        stream.once('error', this._errorHandler = (error) => {
            this._stream.removeListener('data', this._dataHandler);
            this._stream.removeListener('end', this._endHandler);
            this._error = error;
            this._bytesRemain = 0;
            for (let chunk of this._data) {
                this._bytesRemain += chunk.length;
            }
            this._dispatch();
        });
        this._stream.on('data', this._dataHandler = (chunk) => {
            this._data.push(chunk);
            this._dispatch();
        }).pause();
        this._stream.once('end', this._endHandler = () => {
            stream.removeListener('error', this._errorHandler);
            this._stream.removeListener('data', this._dataHandler);
            this._end = true;
            this._bytesRemain = 0;
            for (let chunk of this._data) {
                this._bytesRemain += chunk.length;
            }
            this._dispatch();
        });

        stream.pipe(this._stream);
    }

    _getChunk() {
        return new Promise((resolve, reject) => {
            this._resolve = resolve;
            this._reject = reject;
            this._dispatch();
        });
    }

    _ungetChunk(chunk) {
        this._data.unshift(chunk);
        if (this._end || this._error) {
            this._bytesRemain += chunk.length;
        }
    }

    _dispatch() {
        if (!this._resolve) {
            if (!this._end && !this._error) {
                this._stream.pause();
            }
            return;
        }
        if (this._data.length > 0) {
            if (!this._end && !this._error) {
                this._stream.pause();
            }
            let chunk = this._data.shift();
            if (this._end || this._error) {
                this._bytesRemain -= chunk.length;
            }
            let resolve = this._resolve;
            this._resolve = null;
            this._reject = null;
            resolve(chunk);
            return;
        }
        if (this._end) {
            let resolve = this._resolve;
            this._resolve = null;
            this._reject = null;
            resolve(null);
            return;
        }
        if (this._error) {
            let reject = this._reject;
            this._resolve = null;
            this._reject = null;
            reject(this._error);
            return;
        }
        this._stream.resume();
    }

    async _fillBuffer(buffer) {
        let offset = 0;
        while (offset < buffer.length) {
            let chunk = await this._getChunk();
            if (!chunk) { break; }
            let length = Math.min(buffer.length - offset, chunk.length);
            chunk.copy(buffer, offset, 0, length);
            offset += length;
            if (length == chunk.length) { continue; }
            chunk = chunk.slice(length);
            this._ungetChunk(chunk);
        }
        return offset;
    }

    async _fillTypedArray(typedArray, endianness) {
        let bytesPerElement = typedArray.constructor.BYTES_PER_ELEMENT;
        let buffer = Buffer.from(typedArray.buffer,
                                 typedArray.byteOffset,
                                 typedArray.byteLength);
        let byteLength = await this._fillBuffer(buffer);
        let length = Math.floor(byteLength / bytesPerElement);
        let chunk = buffer.slice(length * bytesPerElement, byteLength);
        if (chunk.length > 0) {
            chunk = Buffer.from(chunk);
            this._ungetChunk(chunk);
        }
        if (endianness != nativeEndianness) {
            buffer = buffer.slice(0, length * bytesPerElement);
            buffer[`swap${bytesPerElement * 8}`]();
        }
        return length;
    }

    get bytesRemain() {
        return this._bytesRemain;
    }

    async fill(container, endianness, options) {
        if (isPlainObject(endianness)) {
            options = endianness;
            endianness = undefined;
        }
        endianness = endianness || nativeEndianness;
        let { partial = false } = options || {};

        let length;
        if (Buffer.isBuffer(container)) {
            length = await this._fillBuffer(container);
        } else {
            length = await this._fillTypedArray(container, endianness);
        }
        if (partial) {
            return length;
        }
        if (length < container.length) {
            let error = new NotEnoughError();
            Object.defineProperties(error, {
                container: { value: container },
                length: { value: length },
            });
            throw error;
        }
        return container;
    }

    fillLE(container, options) {
        return this.fill(container, 'LE', options);
    }

    fillBE(container, options) {
        return this.fill(container, 'BE', options);
    }
};

for (let [bufferName, TypedArray] of [
    ['Int8', Int8Array],
    ['Int16', Int8Array],
    ['Int32', Int32Array],
    ['UInt8', Uint8Array],
    ['UInt16', Uint16Array],
    ['UInt32', Uint32Array],
    ['Float', Float32Array],
    ['Double', Float64Array],
]) {
    const methodName = `read${bufferName}`;
    Object.assign(ProReader.prototype, {
        async [methodName](endianness = nativeEndianness) {
            let typedArray = new TypedArray(1);
            let length = await this._fillTypedArray(typedArray, endianness);
            if (length == 0) {
                throw new NotEnoughError();
            }
            return typedArray[0];
        },

        [methodName + 'LE'](endianness) {
            return this[methodName]('LE');
        },

        [methodName + 'BE'](endianness) {
            return this[methodName]('LE');
        },
    });
}

module.exports = exports = ProReader;

class NotEnoughError extends Error {};
exports.NotEnoughError = NotEnoughError;

(async () => {
    let rs = new PassThroughStream();
    let pr = new ProReader(rs);
    let a = new Uint32Array(2);
    rs.write(Buffer.from([1, 0, 0, 0]));
    rs.write(Buffer.from([2, 0, 0]));
    rs.write(Buffer.from([0, 3]));
    rs.write(Buffer.from([0, 0, 0, 4]));
    rs.write(Buffer.from([0, 0]));
    rs.end();
    console.log(await pr.fill(a), a, pr.bytesRemain);
    console.log(await pr.fill(a, { partial: true }), a, pr.bytesRemain);
    console.log(await pr.readUInt32LE());
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

