'use strict';

const { PassThrough: PassThroughStream } = require('stream');

const Error = require('es6-error');

const nativeEndianness = require('./native-endianness');

///////////////////////////////////////////////////////////////////////////////

class Reader {
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

    _readChunk() {
        return new Promise((resolve, reject) => {
            this._resolve = resolve;
            this._reject = reject;
            this._dispatch();
        });
    }

    _unreadChunk(chunk) {
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

    async _readBuffer(buffer, blockLength) {
        let offset = 0;
        while (offset < buffer.length) {
            let chunk = await this._readChunk();
            if (!chunk) { break; }
            let length = Math.min(buffer.length - offset, chunk.length);
            chunk.copy(buffer, offset, 0, length);
            offset += length;
            if (length == chunk.length) { continue; }
            chunk = chunk.slice(length);
            this._unreadChunk(chunk);
        }
        let blockCount = Math.floor(offset / blockLength);
        let excess = buffer.slice(blockCount * blockLength, offset);
        excess = Buffer.from(excess);
        this._unreadChunk(excess);
        return blockCount;
    }

    async _readTypedArray(typedArray, blockLength, endianness) {
        let elementLength = typedArray.constructor.BYTES_PER_ELEMENT;
        let buffer = Buffer.from(
            typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
        let blockCount = await this._readBuffer(
            buffer, blockLength * elementLength);
        if (endianness != nativeEndianness) {
            let readPart = buffer.slice(
                0, blockCount * blockLength * elementLength);
            readPart[`swap${elementLength * 8}`]();
        }
        return blockCount;
    }

    get bytesRemain() {
        return this._bytesRemain;
    }

    async read(container, {
        blockLength = 1,
        endianness = nativeEndianness,
        allowPart = false,
    } = {}) {
        let blockCount = Buffer.isBuffer(container)
            ? await this._readBuffer(container, blockLength)
            : await this._readTypedArray(container, blockLength, endianness);
        if (allowPart) { return blockCount; }
        if (blockCount * blockLength < container.length) {
            let error = new NotEnoughError();
            Object.defineProperties(error, {
                container: { value: container },
                blockCount: { value: blockCount },
            });
            throw error;
        }
    }
}

for (let endianness of ['LE', 'BE']) {
    Object.assign(Reader.prototype, {
        async [`read${endianness}`](container, options = {}) {
            options = Object.assign({}, options, { endianness });
            return this.read(container, options);
        },
    });
}

for (let [methodTypeName, TypedArray] of [
    ['Int8', Int8Array],
    ['Int16', Int8Array],
    ['Int32', Int32Array],
    ['UInt8', Uint8Array],
    ['UInt16', Uint16Array],
    ['UInt32', Uint32Array],
    ['Float', Float32Array],
    ['Double', Float64Array],
]) {
    const methodName = `read${methodTypeName}`;
    Object.assign(Reader.prototype, {
        async [methodName]({
            endianness = nativeEndianness,
        } = {}) {
            let typedArray = new TypedArray(1);
            let blockCount = await this._readTypedArray(
                typedArray, 1, endianness);
            if (blockCount == 0) { throw new NotEnoughError(); }
            return typedArray[0];
        },
    });
    for (let endianness of ['LE', 'BE']) {
        Object.assign(Reader.prototype, {
            async [`${methodName}${endianness}`]() {
                return this[methodName]({ endianness });
            },
        });
    }
}

module.exports = exports = Reader;

class NotEnoughError extends Error {}
exports.NotEnoughError = NotEnoughError;
