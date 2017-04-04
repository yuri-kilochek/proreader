'use strict';

const { PassThrough: PassThroughStream } = require('stream');

const Error = require('es6-error');

const nativeEndianness = require('./native-endianness');

///////////////////////////////////////////////////////////////////////////////

const DEFAULT_ENDIANNESS = Symbol('DEFAULT_ENDIANNESS');

const INPUT = Symbol('INPUT');
const BYTES_READ = Symbol('BYTES_READ');
const BYTES_UNREAD = Symbol('BYTES_UNREAD');

const RESOLVE = Symbol('RESOLVE');

const READ_CHUNK = Symbol('READ_CHUNK');
const UNREAD_CHUNK = Symbol('UNREAD_CHUNK');

const READ_BUFFER = Symbol('READ_BUFFER');
const READ_TYPED_ARRAY = Symbol('READ_TYPED_ARRAY');

class Reader {
    constructor({
        defaultEndianness = nativeEndianness,
    } = {}) {
        this[DEFAULT_ENDIANNESS] = defaultEndianness;

        this[INPUT] = new PassThroughStream();
        this[BYTES_READ] = 0;
        this[BYTES_UNREAD] = undefined;

        this[RESOLVE] = null;

        let onData = (chunk) => {
            if (chunk.length === 0) { return; }
            this[INPUT].pause();
            this[BYTES_READ] += chunk.length;
            if (this[BYTES_UNREAD] !== undefined) {
                this[BYTES_UNREAD] -= chunk.length;
            }
            let resolve = this[RESOLVE]; this[RESOLVE] = null;
            resolve(chunk);
        };
        let onEnd = () => {
            this[INPUT].removeListener('data', onData);
            this[BYTES_UNREAD] = 0;
            if (this[RESOLVE]) {
                let resolve = this[RESOLVE]; this[RESOLVE] = null;
                resolve(null);
            }
        };
        this[INPUT].on('data', onData).pause();
        this[INPUT].once('end', onEnd);
    }

    get defaultEndianness() {
        return this[DEFAULT_ENDIANNESS];
    }

    get input() {
        return this[INPUT];
    }

    get bytesRead() {
        return this[BYTES_READ];
    }

    get bytesUnread() {
        return this[BYTES_UNREAD];
    }

    [READ_CHUNK]() {
        return new Promise((resolve) => {
            if (this[BYTES_UNREAD] === 0) {
                resolve(null);
                return;
            }
            this[RESOLVE] = resolve;
            this[INPUT].resume();
        });
    }

    [UNREAD_CHUNK](chunk) {
        if (chunk.length === 0) { return; }
        if (this[BYTES_UNREAD] !== 0) {
            this[INPUT].unshift(chunk);
            return;
        }
        this[INPUT] = new PassThroughStream();
        this[INPUT].end(chunk);
        this[BYTES_UNREAD] = chunk.length;
    }

    async [READ_BUFFER](buffer, blockLength) {
        let offset = 0;
        while (offset < buffer.length) {
            let chunk = await this[READ_CHUNK]();
            if (!chunk) { break; }
            let length = Math.min(buffer.length - offset, chunk.length);
            chunk.copy(buffer, offset, 0, length);
            offset += length;
            if (length === chunk.length) { continue; }
            chunk = chunk.slice(length);
            this[UNREAD_CHUNK](chunk);
        }
        let blockCount = Math.floor(offset / blockLength);
        let excess = buffer.slice(blockCount * blockLength, offset);
        excess = Buffer.from(excess);
        this[UNREAD_CHUNK](excess);
        return blockCount;
    }

    async [READ_TYPED_ARRAY](typedArray, blockLength, endianness) {
        let elementLength = typedArray.constructor.BYTES_PER_ELEMENT;
        let buffer = Buffer.from(
            typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
        let blockCount = await this[READ_BUFFER](
            buffer, blockLength * elementLength);
        if (endianness !== nativeEndianness) {
            let readPart = buffer.slice(
                0, blockCount * blockLength * elementLength);
            readPart[`swap${elementLength * 8}`]();
        }
        return blockCount;
    }

    async read(container, {
        blockLength = 1,
        endianness,
        allowPart = false,
    } = {}) {
        if (endianness === undefined) {
            endianness = this[DEFAULT_ENDIANNESS];
        }
        let blockCount = await Buffer.isBuffer(container)
            ? this[READ_BUFFER](container, blockLength)
            : this[READ_TYPED_ARRAY](container, blockLength, endianness);
        if (allowPart) { return blockCount; }
        if (blockCount * blockLength < container.length) {
            let error = new EndOfInput();
            Object.defineProperties(error, {
                container: { value: container },
                blockCount: { value: blockCount },
            });
            throw error;
        }
    }

    async readString(codeUnitCount) {
        let buffer = Buffer.allocUnsafe(codeUnitCount);
        let blockCount = await this[READ_BUFFER](buffer, codeUnitCount);
        if (blockCount == 0) { throw new EndOfInput(); }
        let string = buffer.toString();
        return string;
    }
}

for (let endianness of ['LE', 'BE']) {
    Object.assign(Reader.prototype, {
        [`read${endianness}`](container, options = {}) {
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
            endianness,
        } = {}) {
            if (endianness === undefined) {
                endianness = this[DEFAULT_ENDIANNESS];
            }
            let typedArray = new TypedArray(1);
            let blockCount = await this[READ_TYPED_ARRAY](
                typedArray, 1, endianness);
            if (blockCount == 0) { throw new EndOfInput(); }
            return typedArray[0];
        },
    });
    for (let endianness of ['LE', 'BE']) {
        Object.assign(Reader.prototype, {
            [`${methodName}${endianness}`]() {
                return this[methodName]({ endianness });
            },
        });
    }
}

module.exports = exports = Reader;

class EndOfInput extends Error {}
exports.EndOfInput = EndOfInput;
