(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.SarLocalExportCore = api;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
return (() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __commonJS = (cb, mod) => function __require2() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };

  // node_modules/base64-js/index.js
  var require_base64_js = __commonJS({
    "node_modules/base64-js/index.js"(exports) {
      "use strict";
      exports.byteLength = byteLength;
      exports.toByteArray = toByteArray;
      exports.fromByteArray = fromByteArray;
      var lookup = [];
      var revLookup = [];
      var Arr = typeof Uint8Array !== "undefined" ? Uint8Array : Array;
      var code = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      for (i = 0, len = code.length; i < len; ++i) {
        lookup[i] = code[i];
        revLookup[code.charCodeAt(i)] = i;
      }
      var i;
      var len;
      revLookup["-".charCodeAt(0)] = 62;
      revLookup["_".charCodeAt(0)] = 63;
      function getLens(b64) {
        var len2 = b64.length;
        if (len2 % 4 > 0) {
          throw new Error("Invalid string. Length must be a multiple of 4");
        }
        var validLen = b64.indexOf("=");
        if (validLen === -1) validLen = len2;
        var placeHoldersLen = validLen === len2 ? 0 : 4 - validLen % 4;
        return [validLen, placeHoldersLen];
      }
      function byteLength(b64) {
        var lens = getLens(b64);
        var validLen = lens[0];
        var placeHoldersLen = lens[1];
        return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
      }
      function _byteLength(b64, validLen, placeHoldersLen) {
        return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
      }
      function toByteArray(b64) {
        var tmp;
        var lens = getLens(b64);
        var validLen = lens[0];
        var placeHoldersLen = lens[1];
        var arr = new Arr(_byteLength(b64, validLen, placeHoldersLen));
        var curByte = 0;
        var len2 = placeHoldersLen > 0 ? validLen - 4 : validLen;
        var i2;
        for (i2 = 0; i2 < len2; i2 += 4) {
          tmp = revLookup[b64.charCodeAt(i2)] << 18 | revLookup[b64.charCodeAt(i2 + 1)] << 12 | revLookup[b64.charCodeAt(i2 + 2)] << 6 | revLookup[b64.charCodeAt(i2 + 3)];
          arr[curByte++] = tmp >> 16 & 255;
          arr[curByte++] = tmp >> 8 & 255;
          arr[curByte++] = tmp & 255;
        }
        if (placeHoldersLen === 2) {
          tmp = revLookup[b64.charCodeAt(i2)] << 2 | revLookup[b64.charCodeAt(i2 + 1)] >> 4;
          arr[curByte++] = tmp & 255;
        }
        if (placeHoldersLen === 1) {
          tmp = revLookup[b64.charCodeAt(i2)] << 10 | revLookup[b64.charCodeAt(i2 + 1)] << 4 | revLookup[b64.charCodeAt(i2 + 2)] >> 2;
          arr[curByte++] = tmp >> 8 & 255;
          arr[curByte++] = tmp & 255;
        }
        return arr;
      }
      function tripletToBase64(num) {
        return lookup[num >> 18 & 63] + lookup[num >> 12 & 63] + lookup[num >> 6 & 63] + lookup[num & 63];
      }
      function encodeChunk(uint8, start, end) {
        var tmp;
        var output = [];
        for (var i2 = start; i2 < end; i2 += 3) {
          tmp = (uint8[i2] << 16 & 16711680) + (uint8[i2 + 1] << 8 & 65280) + (uint8[i2 + 2] & 255);
          output.push(tripletToBase64(tmp));
        }
        return output.join("");
      }
      function fromByteArray(uint8) {
        var tmp;
        var len2 = uint8.length;
        var extraBytes = len2 % 3;
        var parts = [];
        var maxChunkLength = 16383;
        for (var i2 = 0, len22 = len2 - extraBytes; i2 < len22; i2 += maxChunkLength) {
          parts.push(encodeChunk(uint8, i2, i2 + maxChunkLength > len22 ? len22 : i2 + maxChunkLength));
        }
        if (extraBytes === 1) {
          tmp = uint8[len2 - 1];
          parts.push(
            lookup[tmp >> 2] + lookup[tmp << 4 & 63] + "=="
          );
        } else if (extraBytes === 2) {
          tmp = (uint8[len2 - 2] << 8) + uint8[len2 - 1];
          parts.push(
            lookup[tmp >> 10] + lookup[tmp >> 4 & 63] + lookup[tmp << 2 & 63] + "="
          );
        }
        return parts.join("");
      }
    }
  });

  // node_modules/ieee754/index.js
  var require_ieee754 = __commonJS({
    "node_modules/ieee754/index.js"(exports) {
      exports.read = function(buffer, offset, isLE, mLen, nBytes) {
        var e, m;
        var eLen = nBytes * 8 - mLen - 1;
        var eMax = (1 << eLen) - 1;
        var eBias = eMax >> 1;
        var nBits = -7;
        var i = isLE ? nBytes - 1 : 0;
        var d = isLE ? -1 : 1;
        var s = buffer[offset + i];
        i += d;
        e = s & (1 << -nBits) - 1;
        s >>= -nBits;
        nBits += eLen;
        for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {
        }
        m = e & (1 << -nBits) - 1;
        e >>= -nBits;
        nBits += mLen;
        for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {
        }
        if (e === 0) {
          e = 1 - eBias;
        } else if (e === eMax) {
          return m ? NaN : (s ? -1 : 1) * Infinity;
        } else {
          m = m + Math.pow(2, mLen);
          e = e - eBias;
        }
        return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
      };
      exports.write = function(buffer, value, offset, isLE, mLen, nBytes) {
        var e, m, c;
        var eLen = nBytes * 8 - mLen - 1;
        var eMax = (1 << eLen) - 1;
        var eBias = eMax >> 1;
        var rt = mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0;
        var i = isLE ? 0 : nBytes - 1;
        var d = isLE ? 1 : -1;
        var s = value < 0 || value === 0 && 1 / value < 0 ? 1 : 0;
        value = Math.abs(value);
        if (isNaN(value) || value === Infinity) {
          m = isNaN(value) ? 1 : 0;
          e = eMax;
        } else {
          e = Math.floor(Math.log(value) / Math.LN2);
          if (value * (c = Math.pow(2, -e)) < 1) {
            e--;
            c *= 2;
          }
          if (e + eBias >= 1) {
            value += rt / c;
          } else {
            value += rt * Math.pow(2, 1 - eBias);
          }
          if (value * c >= 2) {
            e++;
            c /= 2;
          }
          if (e + eBias >= eMax) {
            m = 0;
            e = eMax;
          } else if (e + eBias >= 1) {
            m = (value * c - 1) * Math.pow(2, mLen);
            e = e + eBias;
          } else {
            m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
            e = 0;
          }
        }
        for (; mLen >= 8; buffer[offset + i] = m & 255, i += d, m /= 256, mLen -= 8) {
        }
        e = e << mLen | m;
        eLen += mLen;
        for (; eLen > 0; buffer[offset + i] = e & 255, i += d, e /= 256, eLen -= 8) {
        }
        buffer[offset + i - d] |= s * 128;
      };
    }
  });

  // node_modules/buffer/index.js
  var require_buffer = __commonJS({
    "node_modules/buffer/index.js"(exports) {
      "use strict";
      var base64 = require_base64_js();
      var ieee754 = require_ieee754();
      var customInspectSymbol = typeof Symbol === "function" && typeof Symbol["for"] === "function" ? Symbol["for"]("nodejs.util.inspect.custom") : null;
      exports.Buffer = Buffer2;
      exports.SlowBuffer = SlowBuffer;
      exports.INSPECT_MAX_BYTES = 50;
      var K_MAX_LENGTH = 2147483647;
      exports.kMaxLength = K_MAX_LENGTH;
      Buffer2.TYPED_ARRAY_SUPPORT = typedArraySupport();
      if (!Buffer2.TYPED_ARRAY_SUPPORT && typeof console !== "undefined" && typeof console.error === "function") {
        console.error(
          "This browser lacks typed array (Uint8Array) support which is required by `buffer` v5.x. Use `buffer` v4.x if you require old browser support."
        );
      }
      function typedArraySupport() {
        try {
          var arr = new Uint8Array(1);
          var proto = { foo: function() {
            return 42;
          } };
          Object.setPrototypeOf(proto, Uint8Array.prototype);
          Object.setPrototypeOf(arr, proto);
          return arr.foo() === 42;
        } catch (e) {
          return false;
        }
      }
      Object.defineProperty(Buffer2.prototype, "parent", {
        enumerable: true,
        get: function() {
          if (!Buffer2.isBuffer(this)) return void 0;
          return this.buffer;
        }
      });
      Object.defineProperty(Buffer2.prototype, "offset", {
        enumerable: true,
        get: function() {
          if (!Buffer2.isBuffer(this)) return void 0;
          return this.byteOffset;
        }
      });
      function createBuffer(length) {
        if (length > K_MAX_LENGTH) {
          throw new RangeError('The value "' + length + '" is invalid for option "size"');
        }
        var buf = new Uint8Array(length);
        Object.setPrototypeOf(buf, Buffer2.prototype);
        return buf;
      }
      function Buffer2(arg, encodingOrOffset, length) {
        if (typeof arg === "number") {
          if (typeof encodingOrOffset === "string") {
            throw new TypeError(
              'The "string" argument must be of type string. Received type number'
            );
          }
          return allocUnsafe(arg);
        }
        return from(arg, encodingOrOffset, length);
      }
      Buffer2.poolSize = 8192;
      function from(value, encodingOrOffset, length) {
        if (typeof value === "string") {
          return fromString(value, encodingOrOffset);
        }
        if (ArrayBuffer.isView(value)) {
          return fromArrayView(value);
        }
        if (value == null) {
          throw new TypeError(
            "The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " + typeof value
          );
        }
        if (isInstance(value, ArrayBuffer) || value && isInstance(value.buffer, ArrayBuffer)) {
          return fromArrayBuffer(value, encodingOrOffset, length);
        }
        if (typeof SharedArrayBuffer !== "undefined" && (isInstance(value, SharedArrayBuffer) || value && isInstance(value.buffer, SharedArrayBuffer))) {
          return fromArrayBuffer(value, encodingOrOffset, length);
        }
        if (typeof value === "number") {
          throw new TypeError(
            'The "value" argument must not be of type number. Received type number'
          );
        }
        var valueOf = value.valueOf && value.valueOf();
        if (valueOf != null && valueOf !== value) {
          return Buffer2.from(valueOf, encodingOrOffset, length);
        }
        var b = fromObject(value);
        if (b) return b;
        if (typeof Symbol !== "undefined" && Symbol.toPrimitive != null && typeof value[Symbol.toPrimitive] === "function") {
          return Buffer2.from(
            value[Symbol.toPrimitive]("string"),
            encodingOrOffset,
            length
          );
        }
        throw new TypeError(
          "The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " + typeof value
        );
      }
      Buffer2.from = function(value, encodingOrOffset, length) {
        return from(value, encodingOrOffset, length);
      };
      Object.setPrototypeOf(Buffer2.prototype, Uint8Array.prototype);
      Object.setPrototypeOf(Buffer2, Uint8Array);
      function assertSize(size) {
        if (typeof size !== "number") {
          throw new TypeError('"size" argument must be of type number');
        } else if (size < 0) {
          throw new RangeError('The value "' + size + '" is invalid for option "size"');
        }
      }
      function alloc(size, fill, encoding) {
        assertSize(size);
        if (size <= 0) {
          return createBuffer(size);
        }
        if (fill !== void 0) {
          return typeof encoding === "string" ? createBuffer(size).fill(fill, encoding) : createBuffer(size).fill(fill);
        }
        return createBuffer(size);
      }
      Buffer2.alloc = function(size, fill, encoding) {
        return alloc(size, fill, encoding);
      };
      function allocUnsafe(size) {
        assertSize(size);
        return createBuffer(size < 0 ? 0 : checked(size) | 0);
      }
      Buffer2.allocUnsafe = function(size) {
        return allocUnsafe(size);
      };
      Buffer2.allocUnsafeSlow = function(size) {
        return allocUnsafe(size);
      };
      function fromString(string, encoding) {
        if (typeof encoding !== "string" || encoding === "") {
          encoding = "utf8";
        }
        if (!Buffer2.isEncoding(encoding)) {
          throw new TypeError("Unknown encoding: " + encoding);
        }
        var length = byteLength(string, encoding) | 0;
        var buf = createBuffer(length);
        var actual = buf.write(string, encoding);
        if (actual !== length) {
          buf = buf.slice(0, actual);
        }
        return buf;
      }
      function fromArrayLike(array) {
        var length = array.length < 0 ? 0 : checked(array.length) | 0;
        var buf = createBuffer(length);
        for (var i = 0; i < length; i += 1) {
          buf[i] = array[i] & 255;
        }
        return buf;
      }
      function fromArrayView(arrayView) {
        if (isInstance(arrayView, Uint8Array)) {
          var copy = new Uint8Array(arrayView);
          return fromArrayBuffer(copy.buffer, copy.byteOffset, copy.byteLength);
        }
        return fromArrayLike(arrayView);
      }
      function fromArrayBuffer(array, byteOffset, length) {
        if (byteOffset < 0 || array.byteLength < byteOffset) {
          throw new RangeError('"offset" is outside of buffer bounds');
        }
        if (array.byteLength < byteOffset + (length || 0)) {
          throw new RangeError('"length" is outside of buffer bounds');
        }
        var buf;
        if (byteOffset === void 0 && length === void 0) {
          buf = new Uint8Array(array);
        } else if (length === void 0) {
          buf = new Uint8Array(array, byteOffset);
        } else {
          buf = new Uint8Array(array, byteOffset, length);
        }
        Object.setPrototypeOf(buf, Buffer2.prototype);
        return buf;
      }
      function fromObject(obj) {
        if (Buffer2.isBuffer(obj)) {
          var len = checked(obj.length) | 0;
          var buf = createBuffer(len);
          if (buf.length === 0) {
            return buf;
          }
          obj.copy(buf, 0, 0, len);
          return buf;
        }
        if (obj.length !== void 0) {
          if (typeof obj.length !== "number" || numberIsNaN(obj.length)) {
            return createBuffer(0);
          }
          return fromArrayLike(obj);
        }
        if (obj.type === "Buffer" && Array.isArray(obj.data)) {
          return fromArrayLike(obj.data);
        }
      }
      function checked(length) {
        if (length >= K_MAX_LENGTH) {
          throw new RangeError("Attempt to allocate Buffer larger than maximum size: 0x" + K_MAX_LENGTH.toString(16) + " bytes");
        }
        return length | 0;
      }
      function SlowBuffer(length) {
        if (+length != length) {
          length = 0;
        }
        return Buffer2.alloc(+length);
      }
      Buffer2.isBuffer = function isBuffer(b) {
        return b != null && b._isBuffer === true && b !== Buffer2.prototype;
      };
      Buffer2.compare = function compare(a, b) {
        if (isInstance(a, Uint8Array)) a = Buffer2.from(a, a.offset, a.byteLength);
        if (isInstance(b, Uint8Array)) b = Buffer2.from(b, b.offset, b.byteLength);
        if (!Buffer2.isBuffer(a) || !Buffer2.isBuffer(b)) {
          throw new TypeError(
            'The "buf1", "buf2" arguments must be one of type Buffer or Uint8Array'
          );
        }
        if (a === b) return 0;
        var x = a.length;
        var y = b.length;
        for (var i = 0, len = Math.min(x, y); i < len; ++i) {
          if (a[i] !== b[i]) {
            x = a[i];
            y = b[i];
            break;
          }
        }
        if (x < y) return -1;
        if (y < x) return 1;
        return 0;
      };
      Buffer2.isEncoding = function isEncoding(encoding) {
        switch (String(encoding).toLowerCase()) {
          case "hex":
          case "utf8":
          case "utf-8":
          case "ascii":
          case "latin1":
          case "binary":
          case "base64":
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return true;
          default:
            return false;
        }
      };
      Buffer2.concat = function concat(list, length) {
        if (!Array.isArray(list)) {
          throw new TypeError('"list" argument must be an Array of Buffers');
        }
        if (list.length === 0) {
          return Buffer2.alloc(0);
        }
        var i;
        if (length === void 0) {
          length = 0;
          for (i = 0; i < list.length; ++i) {
            length += list[i].length;
          }
        }
        var buffer = Buffer2.allocUnsafe(length);
        var pos = 0;
        for (i = 0; i < list.length; ++i) {
          var buf = list[i];
          if (isInstance(buf, Uint8Array)) {
            if (pos + buf.length > buffer.length) {
              Buffer2.from(buf).copy(buffer, pos);
            } else {
              Uint8Array.prototype.set.call(
                buffer,
                buf,
                pos
              );
            }
          } else if (!Buffer2.isBuffer(buf)) {
            throw new TypeError('"list" argument must be an Array of Buffers');
          } else {
            buf.copy(buffer, pos);
          }
          pos += buf.length;
        }
        return buffer;
      };
      function byteLength(string, encoding) {
        if (Buffer2.isBuffer(string)) {
          return string.length;
        }
        if (ArrayBuffer.isView(string) || isInstance(string, ArrayBuffer)) {
          return string.byteLength;
        }
        if (typeof string !== "string") {
          throw new TypeError(
            'The "string" argument must be one of type string, Buffer, or ArrayBuffer. Received type ' + typeof string
          );
        }
        var len = string.length;
        var mustMatch = arguments.length > 2 && arguments[2] === true;
        if (!mustMatch && len === 0) return 0;
        var loweredCase = false;
        for (; ; ) {
          switch (encoding) {
            case "ascii":
            case "latin1":
            case "binary":
              return len;
            case "utf8":
            case "utf-8":
              return utf8ToBytes(string).length;
            case "ucs2":
            case "ucs-2":
            case "utf16le":
            case "utf-16le":
              return len * 2;
            case "hex":
              return len >>> 1;
            case "base64":
              return base64ToBytes(string).length;
            default:
              if (loweredCase) {
                return mustMatch ? -1 : utf8ToBytes(string).length;
              }
              encoding = ("" + encoding).toLowerCase();
              loweredCase = true;
          }
        }
      }
      Buffer2.byteLength = byteLength;
      function slowToString(encoding, start, end) {
        var loweredCase = false;
        if (start === void 0 || start < 0) {
          start = 0;
        }
        if (start > this.length) {
          return "";
        }
        if (end === void 0 || end > this.length) {
          end = this.length;
        }
        if (end <= 0) {
          return "";
        }
        end >>>= 0;
        start >>>= 0;
        if (end <= start) {
          return "";
        }
        if (!encoding) encoding = "utf8";
        while (true) {
          switch (encoding) {
            case "hex":
              return hexSlice(this, start, end);
            case "utf8":
            case "utf-8":
              return utf8Slice(this, start, end);
            case "ascii":
              return asciiSlice(this, start, end);
            case "latin1":
            case "binary":
              return latin1Slice(this, start, end);
            case "base64":
              return base64Slice(this, start, end);
            case "ucs2":
            case "ucs-2":
            case "utf16le":
            case "utf-16le":
              return utf16leSlice(this, start, end);
            default:
              if (loweredCase) throw new TypeError("Unknown encoding: " + encoding);
              encoding = (encoding + "").toLowerCase();
              loweredCase = true;
          }
        }
      }
      Buffer2.prototype._isBuffer = true;
      function swap(b, n, m) {
        var i = b[n];
        b[n] = b[m];
        b[m] = i;
      }
      Buffer2.prototype.swap16 = function swap16() {
        var len = this.length;
        if (len % 2 !== 0) {
          throw new RangeError("Buffer size must be a multiple of 16-bits");
        }
        for (var i = 0; i < len; i += 2) {
          swap(this, i, i + 1);
        }
        return this;
      };
      Buffer2.prototype.swap32 = function swap32() {
        var len = this.length;
        if (len % 4 !== 0) {
          throw new RangeError("Buffer size must be a multiple of 32-bits");
        }
        for (var i = 0; i < len; i += 4) {
          swap(this, i, i + 3);
          swap(this, i + 1, i + 2);
        }
        return this;
      };
      Buffer2.prototype.swap64 = function swap64() {
        var len = this.length;
        if (len % 8 !== 0) {
          throw new RangeError("Buffer size must be a multiple of 64-bits");
        }
        for (var i = 0; i < len; i += 8) {
          swap(this, i, i + 7);
          swap(this, i + 1, i + 6);
          swap(this, i + 2, i + 5);
          swap(this, i + 3, i + 4);
        }
        return this;
      };
      Buffer2.prototype.toString = function toString() {
        var length = this.length;
        if (length === 0) return "";
        if (arguments.length === 0) return utf8Slice(this, 0, length);
        return slowToString.apply(this, arguments);
      };
      Buffer2.prototype.toLocaleString = Buffer2.prototype.toString;
      Buffer2.prototype.equals = function equals(b) {
        if (!Buffer2.isBuffer(b)) throw new TypeError("Argument must be a Buffer");
        if (this === b) return true;
        return Buffer2.compare(this, b) === 0;
      };
      Buffer2.prototype.inspect = function inspect() {
        var str = "";
        var max = exports.INSPECT_MAX_BYTES;
        str = this.toString("hex", 0, max).replace(/(.{2})/g, "$1 ").trim();
        if (this.length > max) str += " ... ";
        return "<Buffer " + str + ">";
      };
      if (customInspectSymbol) {
        Buffer2.prototype[customInspectSymbol] = Buffer2.prototype.inspect;
      }
      Buffer2.prototype.compare = function compare(target, start, end, thisStart, thisEnd) {
        if (isInstance(target, Uint8Array)) {
          target = Buffer2.from(target, target.offset, target.byteLength);
        }
        if (!Buffer2.isBuffer(target)) {
          throw new TypeError(
            'The "target" argument must be one of type Buffer or Uint8Array. Received type ' + typeof target
          );
        }
        if (start === void 0) {
          start = 0;
        }
        if (end === void 0) {
          end = target ? target.length : 0;
        }
        if (thisStart === void 0) {
          thisStart = 0;
        }
        if (thisEnd === void 0) {
          thisEnd = this.length;
        }
        if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
          throw new RangeError("out of range index");
        }
        if (thisStart >= thisEnd && start >= end) {
          return 0;
        }
        if (thisStart >= thisEnd) {
          return -1;
        }
        if (start >= end) {
          return 1;
        }
        start >>>= 0;
        end >>>= 0;
        thisStart >>>= 0;
        thisEnd >>>= 0;
        if (this === target) return 0;
        var x = thisEnd - thisStart;
        var y = end - start;
        var len = Math.min(x, y);
        var thisCopy = this.slice(thisStart, thisEnd);
        var targetCopy = target.slice(start, end);
        for (var i = 0; i < len; ++i) {
          if (thisCopy[i] !== targetCopy[i]) {
            x = thisCopy[i];
            y = targetCopy[i];
            break;
          }
        }
        if (x < y) return -1;
        if (y < x) return 1;
        return 0;
      };
      function bidirectionalIndexOf(buffer, val, byteOffset, encoding, dir) {
        if (buffer.length === 0) return -1;
        if (typeof byteOffset === "string") {
          encoding = byteOffset;
          byteOffset = 0;
        } else if (byteOffset > 2147483647) {
          byteOffset = 2147483647;
        } else if (byteOffset < -2147483648) {
          byteOffset = -2147483648;
        }
        byteOffset = +byteOffset;
        if (numberIsNaN(byteOffset)) {
          byteOffset = dir ? 0 : buffer.length - 1;
        }
        if (byteOffset < 0) byteOffset = buffer.length + byteOffset;
        if (byteOffset >= buffer.length) {
          if (dir) return -1;
          else byteOffset = buffer.length - 1;
        } else if (byteOffset < 0) {
          if (dir) byteOffset = 0;
          else return -1;
        }
        if (typeof val === "string") {
          val = Buffer2.from(val, encoding);
        }
        if (Buffer2.isBuffer(val)) {
          if (val.length === 0) {
            return -1;
          }
          return arrayIndexOf(buffer, val, byteOffset, encoding, dir);
        } else if (typeof val === "number") {
          val = val & 255;
          if (typeof Uint8Array.prototype.indexOf === "function") {
            if (dir) {
              return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset);
            } else {
              return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset);
            }
          }
          return arrayIndexOf(buffer, [val], byteOffset, encoding, dir);
        }
        throw new TypeError("val must be string, number or Buffer");
      }
      function arrayIndexOf(arr, val, byteOffset, encoding, dir) {
        var indexSize = 1;
        var arrLength = arr.length;
        var valLength = val.length;
        if (encoding !== void 0) {
          encoding = String(encoding).toLowerCase();
          if (encoding === "ucs2" || encoding === "ucs-2" || encoding === "utf16le" || encoding === "utf-16le") {
            if (arr.length < 2 || val.length < 2) {
              return -1;
            }
            indexSize = 2;
            arrLength /= 2;
            valLength /= 2;
            byteOffset /= 2;
          }
        }
        function read(buf, i2) {
          if (indexSize === 1) {
            return buf[i2];
          } else {
            return buf.readUInt16BE(i2 * indexSize);
          }
        }
        var i;
        if (dir) {
          var foundIndex = -1;
          for (i = byteOffset; i < arrLength; i++) {
            if (read(arr, i) === read(val, foundIndex === -1 ? 0 : i - foundIndex)) {
              if (foundIndex === -1) foundIndex = i;
              if (i - foundIndex + 1 === valLength) return foundIndex * indexSize;
            } else {
              if (foundIndex !== -1) i -= i - foundIndex;
              foundIndex = -1;
            }
          }
        } else {
          if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength;
          for (i = byteOffset; i >= 0; i--) {
            var found = true;
            for (var j = 0; j < valLength; j++) {
              if (read(arr, i + j) !== read(val, j)) {
                found = false;
                break;
              }
            }
            if (found) return i;
          }
        }
        return -1;
      }
      Buffer2.prototype.includes = function includes(val, byteOffset, encoding) {
        return this.indexOf(val, byteOffset, encoding) !== -1;
      };
      Buffer2.prototype.indexOf = function indexOf(val, byteOffset, encoding) {
        return bidirectionalIndexOf(this, val, byteOffset, encoding, true);
      };
      Buffer2.prototype.lastIndexOf = function lastIndexOf(val, byteOffset, encoding) {
        return bidirectionalIndexOf(this, val, byteOffset, encoding, false);
      };
      function hexWrite(buf, string, offset, length) {
        offset = Number(offset) || 0;
        var remaining = buf.length - offset;
        if (!length) {
          length = remaining;
        } else {
          length = Number(length);
          if (length > remaining) {
            length = remaining;
          }
        }
        var strLen = string.length;
        if (length > strLen / 2) {
          length = strLen / 2;
        }
        for (var i = 0; i < length; ++i) {
          var parsed = parseInt(string.substr(i * 2, 2), 16);
          if (numberIsNaN(parsed)) return i;
          buf[offset + i] = parsed;
        }
        return i;
      }
      function utf8Write(buf, string, offset, length) {
        return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length);
      }
      function asciiWrite(buf, string, offset, length) {
        return blitBuffer(asciiToBytes(string), buf, offset, length);
      }
      function base64Write(buf, string, offset, length) {
        return blitBuffer(base64ToBytes(string), buf, offset, length);
      }
      function ucs2Write(buf, string, offset, length) {
        return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length);
      }
      Buffer2.prototype.write = function write(string, offset, length, encoding) {
        if (offset === void 0) {
          encoding = "utf8";
          length = this.length;
          offset = 0;
        } else if (length === void 0 && typeof offset === "string") {
          encoding = offset;
          length = this.length;
          offset = 0;
        } else if (isFinite(offset)) {
          offset = offset >>> 0;
          if (isFinite(length)) {
            length = length >>> 0;
            if (encoding === void 0) encoding = "utf8";
          } else {
            encoding = length;
            length = void 0;
          }
        } else {
          throw new Error(
            "Buffer.write(string, encoding, offset[, length]) is no longer supported"
          );
        }
        var remaining = this.length - offset;
        if (length === void 0 || length > remaining) length = remaining;
        if (string.length > 0 && (length < 0 || offset < 0) || offset > this.length) {
          throw new RangeError("Attempt to write outside buffer bounds");
        }
        if (!encoding) encoding = "utf8";
        var loweredCase = false;
        for (; ; ) {
          switch (encoding) {
            case "hex":
              return hexWrite(this, string, offset, length);
            case "utf8":
            case "utf-8":
              return utf8Write(this, string, offset, length);
            case "ascii":
            case "latin1":
            case "binary":
              return asciiWrite(this, string, offset, length);
            case "base64":
              return base64Write(this, string, offset, length);
            case "ucs2":
            case "ucs-2":
            case "utf16le":
            case "utf-16le":
              return ucs2Write(this, string, offset, length);
            default:
              if (loweredCase) throw new TypeError("Unknown encoding: " + encoding);
              encoding = ("" + encoding).toLowerCase();
              loweredCase = true;
          }
        }
      };
      Buffer2.prototype.toJSON = function toJSON() {
        return {
          type: "Buffer",
          data: Array.prototype.slice.call(this._arr || this, 0)
        };
      };
      function base64Slice(buf, start, end) {
        if (start === 0 && end === buf.length) {
          return base64.fromByteArray(buf);
        } else {
          return base64.fromByteArray(buf.slice(start, end));
        }
      }
      function utf8Slice(buf, start, end) {
        end = Math.min(buf.length, end);
        var res = [];
        var i = start;
        while (i < end) {
          var firstByte = buf[i];
          var codePoint = null;
          var bytesPerSequence = firstByte > 239 ? 4 : firstByte > 223 ? 3 : firstByte > 191 ? 2 : 1;
          if (i + bytesPerSequence <= end) {
            var secondByte, thirdByte, fourthByte, tempCodePoint;
            switch (bytesPerSequence) {
              case 1:
                if (firstByte < 128) {
                  codePoint = firstByte;
                }
                break;
              case 2:
                secondByte = buf[i + 1];
                if ((secondByte & 192) === 128) {
                  tempCodePoint = (firstByte & 31) << 6 | secondByte & 63;
                  if (tempCodePoint > 127) {
                    codePoint = tempCodePoint;
                  }
                }
                break;
              case 3:
                secondByte = buf[i + 1];
                thirdByte = buf[i + 2];
                if ((secondByte & 192) === 128 && (thirdByte & 192) === 128) {
                  tempCodePoint = (firstByte & 15) << 12 | (secondByte & 63) << 6 | thirdByte & 63;
                  if (tempCodePoint > 2047 && (tempCodePoint < 55296 || tempCodePoint > 57343)) {
                    codePoint = tempCodePoint;
                  }
                }
                break;
              case 4:
                secondByte = buf[i + 1];
                thirdByte = buf[i + 2];
                fourthByte = buf[i + 3];
                if ((secondByte & 192) === 128 && (thirdByte & 192) === 128 && (fourthByte & 192) === 128) {
                  tempCodePoint = (firstByte & 15) << 18 | (secondByte & 63) << 12 | (thirdByte & 63) << 6 | fourthByte & 63;
                  if (tempCodePoint > 65535 && tempCodePoint < 1114112) {
                    codePoint = tempCodePoint;
                  }
                }
            }
          }
          if (codePoint === null) {
            codePoint = 65533;
            bytesPerSequence = 1;
          } else if (codePoint > 65535) {
            codePoint -= 65536;
            res.push(codePoint >>> 10 & 1023 | 55296);
            codePoint = 56320 | codePoint & 1023;
          }
          res.push(codePoint);
          i += bytesPerSequence;
        }
        return decodeCodePointsArray(res);
      }
      var MAX_ARGUMENTS_LENGTH = 4096;
      function decodeCodePointsArray(codePoints) {
        var len = codePoints.length;
        if (len <= MAX_ARGUMENTS_LENGTH) {
          return String.fromCharCode.apply(String, codePoints);
        }
        var res = "";
        var i = 0;
        while (i < len) {
          res += String.fromCharCode.apply(
            String,
            codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
          );
        }
        return res;
      }
      function asciiSlice(buf, start, end) {
        var ret = "";
        end = Math.min(buf.length, end);
        for (var i = start; i < end; ++i) {
          ret += String.fromCharCode(buf[i] & 127);
        }
        return ret;
      }
      function latin1Slice(buf, start, end) {
        var ret = "";
        end = Math.min(buf.length, end);
        for (var i = start; i < end; ++i) {
          ret += String.fromCharCode(buf[i]);
        }
        return ret;
      }
      function hexSlice(buf, start, end) {
        var len = buf.length;
        if (!start || start < 0) start = 0;
        if (!end || end < 0 || end > len) end = len;
        var out = "";
        for (var i = start; i < end; ++i) {
          out += hexSliceLookupTable[buf[i]];
        }
        return out;
      }
      function utf16leSlice(buf, start, end) {
        var bytes = buf.slice(start, end);
        var res = "";
        for (var i = 0; i < bytes.length - 1; i += 2) {
          res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256);
        }
        return res;
      }
      Buffer2.prototype.slice = function slice(start, end) {
        var len = this.length;
        start = ~~start;
        end = end === void 0 ? len : ~~end;
        if (start < 0) {
          start += len;
          if (start < 0) start = 0;
        } else if (start > len) {
          start = len;
        }
        if (end < 0) {
          end += len;
          if (end < 0) end = 0;
        } else if (end > len) {
          end = len;
        }
        if (end < start) end = start;
        var newBuf = this.subarray(start, end);
        Object.setPrototypeOf(newBuf, Buffer2.prototype);
        return newBuf;
      };
      function checkOffset(offset, ext, length) {
        if (offset % 1 !== 0 || offset < 0) throw new RangeError("offset is not uint");
        if (offset + ext > length) throw new RangeError("Trying to access beyond buffer length");
      }
      Buffer2.prototype.readUintLE = Buffer2.prototype.readUIntLE = function readUIntLE(offset, byteLength2, noAssert) {
        offset = offset >>> 0;
        byteLength2 = byteLength2 >>> 0;
        if (!noAssert) checkOffset(offset, byteLength2, this.length);
        var val = this[offset];
        var mul = 1;
        var i = 0;
        while (++i < byteLength2 && (mul *= 256)) {
          val += this[offset + i] * mul;
        }
        return val;
      };
      Buffer2.prototype.readUintBE = Buffer2.prototype.readUIntBE = function readUIntBE(offset, byteLength2, noAssert) {
        offset = offset >>> 0;
        byteLength2 = byteLength2 >>> 0;
        if (!noAssert) {
          checkOffset(offset, byteLength2, this.length);
        }
        var val = this[offset + --byteLength2];
        var mul = 1;
        while (byteLength2 > 0 && (mul *= 256)) {
          val += this[offset + --byteLength2] * mul;
        }
        return val;
      };
      Buffer2.prototype.readUint8 = Buffer2.prototype.readUInt8 = function readUInt8(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert) checkOffset(offset, 1, this.length);
        return this[offset];
      };
      Buffer2.prototype.readUint16LE = Buffer2.prototype.readUInt16LE = function readUInt16LE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert) checkOffset(offset, 2, this.length);
        return this[offset] | this[offset + 1] << 8;
      };
      Buffer2.prototype.readUint16BE = Buffer2.prototype.readUInt16BE = function readUInt16BE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert) checkOffset(offset, 2, this.length);
        return this[offset] << 8 | this[offset + 1];
      };
      Buffer2.prototype.readUint32LE = Buffer2.prototype.readUInt32LE = function readUInt32LE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert) checkOffset(offset, 4, this.length);
        return (this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16) + this[offset + 3] * 16777216;
      };
      Buffer2.prototype.readUint32BE = Buffer2.prototype.readUInt32BE = function readUInt32BE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert) checkOffset(offset, 4, this.length);
        return this[offset] * 16777216 + (this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3]);
      };
      Buffer2.prototype.readIntLE = function readIntLE(offset, byteLength2, noAssert) {
        offset = offset >>> 0;
        byteLength2 = byteLength2 >>> 0;
        if (!noAssert) checkOffset(offset, byteLength2, this.length);
        var val = this[offset];
        var mul = 1;
        var i = 0;
        while (++i < byteLength2 && (mul *= 256)) {
          val += this[offset + i] * mul;
        }
        mul *= 128;
        if (val >= mul) val -= Math.pow(2, 8 * byteLength2);
        return val;
      };
      Buffer2.prototype.readIntBE = function readIntBE(offset, byteLength2, noAssert) {
        offset = offset >>> 0;
        byteLength2 = byteLength2 >>> 0;
        if (!noAssert) checkOffset(offset, byteLength2, this.length);
        var i = byteLength2;
        var mul = 1;
        var val = this[offset + --i];
        while (i > 0 && (mul *= 256)) {
          val += this[offset + --i] * mul;
        }
        mul *= 128;
        if (val >= mul) val -= Math.pow(2, 8 * byteLength2);
        return val;
      };
      Buffer2.prototype.readInt8 = function readInt8(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert) checkOffset(offset, 1, this.length);
        if (!(this[offset] & 128)) return this[offset];
        return (255 - this[offset] + 1) * -1;
      };
      Buffer2.prototype.readInt16LE = function readInt16LE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert) checkOffset(offset, 2, this.length);
        var val = this[offset] | this[offset + 1] << 8;
        return val & 32768 ? val | 4294901760 : val;
      };
      Buffer2.prototype.readInt16BE = function readInt16BE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert) checkOffset(offset, 2, this.length);
        var val = this[offset + 1] | this[offset] << 8;
        return val & 32768 ? val | 4294901760 : val;
      };
      Buffer2.prototype.readInt32LE = function readInt32LE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert) checkOffset(offset, 4, this.length);
        return this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16 | this[offset + 3] << 24;
      };
      Buffer2.prototype.readInt32BE = function readInt32BE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert) checkOffset(offset, 4, this.length);
        return this[offset] << 24 | this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3];
      };
      Buffer2.prototype.readFloatLE = function readFloatLE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert) checkOffset(offset, 4, this.length);
        return ieee754.read(this, offset, true, 23, 4);
      };
      Buffer2.prototype.readFloatBE = function readFloatBE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert) checkOffset(offset, 4, this.length);
        return ieee754.read(this, offset, false, 23, 4);
      };
      Buffer2.prototype.readDoubleLE = function readDoubleLE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert) checkOffset(offset, 8, this.length);
        return ieee754.read(this, offset, true, 52, 8);
      };
      Buffer2.prototype.readDoubleBE = function readDoubleBE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert) checkOffset(offset, 8, this.length);
        return ieee754.read(this, offset, false, 52, 8);
      };
      function checkInt(buf, value, offset, ext, max, min) {
        if (!Buffer2.isBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance');
        if (value > max || value < min) throw new RangeError('"value" argument is out of bounds');
        if (offset + ext > buf.length) throw new RangeError("Index out of range");
      }
      Buffer2.prototype.writeUintLE = Buffer2.prototype.writeUIntLE = function writeUIntLE(value, offset, byteLength2, noAssert) {
        value = +value;
        offset = offset >>> 0;
        byteLength2 = byteLength2 >>> 0;
        if (!noAssert) {
          var maxBytes = Math.pow(2, 8 * byteLength2) - 1;
          checkInt(this, value, offset, byteLength2, maxBytes, 0);
        }
        var mul = 1;
        var i = 0;
        this[offset] = value & 255;
        while (++i < byteLength2 && (mul *= 256)) {
          this[offset + i] = value / mul & 255;
        }
        return offset + byteLength2;
      };
      Buffer2.prototype.writeUintBE = Buffer2.prototype.writeUIntBE = function writeUIntBE(value, offset, byteLength2, noAssert) {
        value = +value;
        offset = offset >>> 0;
        byteLength2 = byteLength2 >>> 0;
        if (!noAssert) {
          var maxBytes = Math.pow(2, 8 * byteLength2) - 1;
          checkInt(this, value, offset, byteLength2, maxBytes, 0);
        }
        var i = byteLength2 - 1;
        var mul = 1;
        this[offset + i] = value & 255;
        while (--i >= 0 && (mul *= 256)) {
          this[offset + i] = value / mul & 255;
        }
        return offset + byteLength2;
      };
      Buffer2.prototype.writeUint8 = Buffer2.prototype.writeUInt8 = function writeUInt8(value, offset, noAssert) {
        value = +value;
        offset = offset >>> 0;
        if (!noAssert) checkInt(this, value, offset, 1, 255, 0);
        this[offset] = value & 255;
        return offset + 1;
      };
      Buffer2.prototype.writeUint16LE = Buffer2.prototype.writeUInt16LE = function writeUInt16LE(value, offset, noAssert) {
        value = +value;
        offset = offset >>> 0;
        if (!noAssert) checkInt(this, value, offset, 2, 65535, 0);
        this[offset] = value & 255;
        this[offset + 1] = value >>> 8;
        return offset + 2;
      };
      Buffer2.prototype.writeUint16BE = Buffer2.prototype.writeUInt16BE = function writeUInt16BE(value, offset, noAssert) {
        value = +value;
        offset = offset >>> 0;
        if (!noAssert) checkInt(this, value, offset, 2, 65535, 0);
        this[offset] = value >>> 8;
        this[offset + 1] = value & 255;
        return offset + 2;
      };
      Buffer2.prototype.writeUint32LE = Buffer2.prototype.writeUInt32LE = function writeUInt32LE(value, offset, noAssert) {
        value = +value;
        offset = offset >>> 0;
        if (!noAssert) checkInt(this, value, offset, 4, 4294967295, 0);
        this[offset + 3] = value >>> 24;
        this[offset + 2] = value >>> 16;
        this[offset + 1] = value >>> 8;
        this[offset] = value & 255;
        return offset + 4;
      };
      Buffer2.prototype.writeUint32BE = Buffer2.prototype.writeUInt32BE = function writeUInt32BE(value, offset, noAssert) {
        value = +value;
        offset = offset >>> 0;
        if (!noAssert) checkInt(this, value, offset, 4, 4294967295, 0);
        this[offset] = value >>> 24;
        this[offset + 1] = value >>> 16;
        this[offset + 2] = value >>> 8;
        this[offset + 3] = value & 255;
        return offset + 4;
      };
      Buffer2.prototype.writeIntLE = function writeIntLE(value, offset, byteLength2, noAssert) {
        value = +value;
        offset = offset >>> 0;
        if (!noAssert) {
          var limit = Math.pow(2, 8 * byteLength2 - 1);
          checkInt(this, value, offset, byteLength2, limit - 1, -limit);
        }
        var i = 0;
        var mul = 1;
        var sub = 0;
        this[offset] = value & 255;
        while (++i < byteLength2 && (mul *= 256)) {
          if (value < 0 && sub === 0 && this[offset + i - 1] !== 0) {
            sub = 1;
          }
          this[offset + i] = (value / mul >> 0) - sub & 255;
        }
        return offset + byteLength2;
      };
      Buffer2.prototype.writeIntBE = function writeIntBE(value, offset, byteLength2, noAssert) {
        value = +value;
        offset = offset >>> 0;
        if (!noAssert) {
          var limit = Math.pow(2, 8 * byteLength2 - 1);
          checkInt(this, value, offset, byteLength2, limit - 1, -limit);
        }
        var i = byteLength2 - 1;
        var mul = 1;
        var sub = 0;
        this[offset + i] = value & 255;
        while (--i >= 0 && (mul *= 256)) {
          if (value < 0 && sub === 0 && this[offset + i + 1] !== 0) {
            sub = 1;
          }
          this[offset + i] = (value / mul >> 0) - sub & 255;
        }
        return offset + byteLength2;
      };
      Buffer2.prototype.writeInt8 = function writeInt8(value, offset, noAssert) {
        value = +value;
        offset = offset >>> 0;
        if (!noAssert) checkInt(this, value, offset, 1, 127, -128);
        if (value < 0) value = 255 + value + 1;
        this[offset] = value & 255;
        return offset + 1;
      };
      Buffer2.prototype.writeInt16LE = function writeInt16LE(value, offset, noAssert) {
        value = +value;
        offset = offset >>> 0;
        if (!noAssert) checkInt(this, value, offset, 2, 32767, -32768);
        this[offset] = value & 255;
        this[offset + 1] = value >>> 8;
        return offset + 2;
      };
      Buffer2.prototype.writeInt16BE = function writeInt16BE(value, offset, noAssert) {
        value = +value;
        offset = offset >>> 0;
        if (!noAssert) checkInt(this, value, offset, 2, 32767, -32768);
        this[offset] = value >>> 8;
        this[offset + 1] = value & 255;
        return offset + 2;
      };
      Buffer2.prototype.writeInt32LE = function writeInt32LE(value, offset, noAssert) {
        value = +value;
        offset = offset >>> 0;
        if (!noAssert) checkInt(this, value, offset, 4, 2147483647, -2147483648);
        this[offset] = value & 255;
        this[offset + 1] = value >>> 8;
        this[offset + 2] = value >>> 16;
        this[offset + 3] = value >>> 24;
        return offset + 4;
      };
      Buffer2.prototype.writeInt32BE = function writeInt32BE(value, offset, noAssert) {
        value = +value;
        offset = offset >>> 0;
        if (!noAssert) checkInt(this, value, offset, 4, 2147483647, -2147483648);
        if (value < 0) value = 4294967295 + value + 1;
        this[offset] = value >>> 24;
        this[offset + 1] = value >>> 16;
        this[offset + 2] = value >>> 8;
        this[offset + 3] = value & 255;
        return offset + 4;
      };
      function checkIEEE754(buf, value, offset, ext, max, min) {
        if (offset + ext > buf.length) throw new RangeError("Index out of range");
        if (offset < 0) throw new RangeError("Index out of range");
      }
      function writeFloat(buf, value, offset, littleEndian, noAssert) {
        value = +value;
        offset = offset >>> 0;
        if (!noAssert) {
          checkIEEE754(buf, value, offset, 4, 34028234663852886e22, -34028234663852886e22);
        }
        ieee754.write(buf, value, offset, littleEndian, 23, 4);
        return offset + 4;
      }
      Buffer2.prototype.writeFloatLE = function writeFloatLE(value, offset, noAssert) {
        return writeFloat(this, value, offset, true, noAssert);
      };
      Buffer2.prototype.writeFloatBE = function writeFloatBE(value, offset, noAssert) {
        return writeFloat(this, value, offset, false, noAssert);
      };
      function writeDouble(buf, value, offset, littleEndian, noAssert) {
        value = +value;
        offset = offset >>> 0;
        if (!noAssert) {
          checkIEEE754(buf, value, offset, 8, 17976931348623157e292, -17976931348623157e292);
        }
        ieee754.write(buf, value, offset, littleEndian, 52, 8);
        return offset + 8;
      }
      Buffer2.prototype.writeDoubleLE = function writeDoubleLE(value, offset, noAssert) {
        return writeDouble(this, value, offset, true, noAssert);
      };
      Buffer2.prototype.writeDoubleBE = function writeDoubleBE(value, offset, noAssert) {
        return writeDouble(this, value, offset, false, noAssert);
      };
      Buffer2.prototype.copy = function copy(target, targetStart, start, end) {
        if (!Buffer2.isBuffer(target)) throw new TypeError("argument should be a Buffer");
        if (!start) start = 0;
        if (!end && end !== 0) end = this.length;
        if (targetStart >= target.length) targetStart = target.length;
        if (!targetStart) targetStart = 0;
        if (end > 0 && end < start) end = start;
        if (end === start) return 0;
        if (target.length === 0 || this.length === 0) return 0;
        if (targetStart < 0) {
          throw new RangeError("targetStart out of bounds");
        }
        if (start < 0 || start >= this.length) throw new RangeError("Index out of range");
        if (end < 0) throw new RangeError("sourceEnd out of bounds");
        if (end > this.length) end = this.length;
        if (target.length - targetStart < end - start) {
          end = target.length - targetStart + start;
        }
        var len = end - start;
        if (this === target && typeof Uint8Array.prototype.copyWithin === "function") {
          this.copyWithin(targetStart, start, end);
        } else {
          Uint8Array.prototype.set.call(
            target,
            this.subarray(start, end),
            targetStart
          );
        }
        return len;
      };
      Buffer2.prototype.fill = function fill(val, start, end, encoding) {
        if (typeof val === "string") {
          if (typeof start === "string") {
            encoding = start;
            start = 0;
            end = this.length;
          } else if (typeof end === "string") {
            encoding = end;
            end = this.length;
          }
          if (encoding !== void 0 && typeof encoding !== "string") {
            throw new TypeError("encoding must be a string");
          }
          if (typeof encoding === "string" && !Buffer2.isEncoding(encoding)) {
            throw new TypeError("Unknown encoding: " + encoding);
          }
          if (val.length === 1) {
            var code = val.charCodeAt(0);
            if (encoding === "utf8" && code < 128 || encoding === "latin1") {
              val = code;
            }
          }
        } else if (typeof val === "number") {
          val = val & 255;
        } else if (typeof val === "boolean") {
          val = Number(val);
        }
        if (start < 0 || this.length < start || this.length < end) {
          throw new RangeError("Out of range index");
        }
        if (end <= start) {
          return this;
        }
        start = start >>> 0;
        end = end === void 0 ? this.length : end >>> 0;
        if (!val) val = 0;
        var i;
        if (typeof val === "number") {
          for (i = start; i < end; ++i) {
            this[i] = val;
          }
        } else {
          var bytes = Buffer2.isBuffer(val) ? val : Buffer2.from(val, encoding);
          var len = bytes.length;
          if (len === 0) {
            throw new TypeError('The value "' + val + '" is invalid for argument "value"');
          }
          for (i = 0; i < end - start; ++i) {
            this[i + start] = bytes[i % len];
          }
        }
        return this;
      };
      var INVALID_BASE64_RE = /[^+/0-9A-Za-z-_]/g;
      function base64clean(str) {
        str = str.split("=")[0];
        str = str.trim().replace(INVALID_BASE64_RE, "");
        if (str.length < 2) return "";
        while (str.length % 4 !== 0) {
          str = str + "=";
        }
        return str;
      }
      function utf8ToBytes(string, units) {
        units = units || Infinity;
        var codePoint;
        var length = string.length;
        var leadSurrogate = null;
        var bytes = [];
        for (var i = 0; i < length; ++i) {
          codePoint = string.charCodeAt(i);
          if (codePoint > 55295 && codePoint < 57344) {
            if (!leadSurrogate) {
              if (codePoint > 56319) {
                if ((units -= 3) > -1) bytes.push(239, 191, 189);
                continue;
              } else if (i + 1 === length) {
                if ((units -= 3) > -1) bytes.push(239, 191, 189);
                continue;
              }
              leadSurrogate = codePoint;
              continue;
            }
            if (codePoint < 56320) {
              if ((units -= 3) > -1) bytes.push(239, 191, 189);
              leadSurrogate = codePoint;
              continue;
            }
            codePoint = (leadSurrogate - 55296 << 10 | codePoint - 56320) + 65536;
          } else if (leadSurrogate) {
            if ((units -= 3) > -1) bytes.push(239, 191, 189);
          }
          leadSurrogate = null;
          if (codePoint < 128) {
            if ((units -= 1) < 0) break;
            bytes.push(codePoint);
          } else if (codePoint < 2048) {
            if ((units -= 2) < 0) break;
            bytes.push(
              codePoint >> 6 | 192,
              codePoint & 63 | 128
            );
          } else if (codePoint < 65536) {
            if ((units -= 3) < 0) break;
            bytes.push(
              codePoint >> 12 | 224,
              codePoint >> 6 & 63 | 128,
              codePoint & 63 | 128
            );
          } else if (codePoint < 1114112) {
            if ((units -= 4) < 0) break;
            bytes.push(
              codePoint >> 18 | 240,
              codePoint >> 12 & 63 | 128,
              codePoint >> 6 & 63 | 128,
              codePoint & 63 | 128
            );
          } else {
            throw new Error("Invalid code point");
          }
        }
        return bytes;
      }
      function asciiToBytes(str) {
        var byteArray = [];
        for (var i = 0; i < str.length; ++i) {
          byteArray.push(str.charCodeAt(i) & 255);
        }
        return byteArray;
      }
      function utf16leToBytes(str, units) {
        var c, hi, lo;
        var byteArray = [];
        for (var i = 0; i < str.length; ++i) {
          if ((units -= 2) < 0) break;
          c = str.charCodeAt(i);
          hi = c >> 8;
          lo = c % 256;
          byteArray.push(lo);
          byteArray.push(hi);
        }
        return byteArray;
      }
      function base64ToBytes(str) {
        return base64.toByteArray(base64clean(str));
      }
      function blitBuffer(src, dst, offset, length) {
        for (var i = 0; i < length; ++i) {
          if (i + offset >= dst.length || i >= src.length) break;
          dst[i + offset] = src[i];
        }
        return i;
      }
      function isInstance(obj, type) {
        return obj instanceof type || obj != null && obj.constructor != null && obj.constructor.name != null && obj.constructor.name === type.name;
      }
      function numberIsNaN(obj) {
        return obj !== obj;
      }
      var hexSliceLookupTable = (function() {
        var alphabet = "0123456789abcdef";
        var table = new Array(256);
        for (var i = 0; i < 16; ++i) {
          var i16 = i * 16;
          for (var j = 0; j < 16; ++j) {
            table[i16 + j] = alphabet[i] + alphabet[j];
          }
        }
        return table;
      })();
    }
  });

  // node_modules/jszip/dist/jszip.min.js
  var require_jszip_min = __commonJS({
    "node_modules/jszip/dist/jszip.min.js"(exports, module) {
      !(function(e) {
        if ("object" == typeof exports && "undefined" != typeof module) module.exports = e();
        else if ("function" == typeof define && define.amd) define([], e);
        else {
          ("undefined" != typeof window ? window : "undefined" != typeof globalThis ? globalThis : "undefined" != typeof self ? self : this).JSZip = e();
        }
      })(function() {
        return (function s(a, o, h) {
          function u(r, e2) {
            if (!o[r]) {
              if (!a[r]) {
                var t = "function" == typeof __require && __require;
                if (!e2 && t) return t(r, true);
                if (l) return l(r, true);
                var n = new Error("Cannot find module '" + r + "'");
                throw n.code = "MODULE_NOT_FOUND", n;
              }
              var i = o[r] = { exports: {} };
              a[r][0].call(i.exports, function(e3) {
                var t2 = a[r][1][e3];
                return u(t2 || e3);
              }, i, i.exports, s, a, o, h);
            }
            return o[r].exports;
          }
          for (var l = "function" == typeof __require && __require, e = 0; e < h.length; e++) u(h[e]);
          return u;
        })({ 1: [function(e, t, r) {
          "use strict";
          var d = e("./utils"), c = e("./support"), p = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
          r.encode = function(e2) {
            for (var t2, r2, n, i, s, a, o, h = [], u = 0, l = e2.length, f = l, c2 = "string" !== d.getTypeOf(e2); u < e2.length; ) f = l - u, n = c2 ? (t2 = e2[u++], r2 = u < l ? e2[u++] : 0, u < l ? e2[u++] : 0) : (t2 = e2.charCodeAt(u++), r2 = u < l ? e2.charCodeAt(u++) : 0, u < l ? e2.charCodeAt(u++) : 0), i = t2 >> 2, s = (3 & t2) << 4 | r2 >> 4, a = 1 < f ? (15 & r2) << 2 | n >> 6 : 64, o = 2 < f ? 63 & n : 64, h.push(p.charAt(i) + p.charAt(s) + p.charAt(a) + p.charAt(o));
            return h.join("");
          }, r.decode = function(e2) {
            var t2, r2, n, i, s, a, o = 0, h = 0, u = "data:";
            if (e2.substr(0, u.length) === u) throw new Error("Invalid base64 input, it looks like a data url.");
            var l, f = 3 * (e2 = e2.replace(/[^A-Za-z0-9+/=]/g, "")).length / 4;
            if (e2.charAt(e2.length - 1) === p.charAt(64) && f--, e2.charAt(e2.length - 2) === p.charAt(64) && f--, f % 1 != 0) throw new Error("Invalid base64 input, bad content length.");
            for (l = c.uint8array ? new Uint8Array(0 | f) : new Array(0 | f); o < e2.length; ) t2 = p.indexOf(e2.charAt(o++)) << 2 | (i = p.indexOf(e2.charAt(o++))) >> 4, r2 = (15 & i) << 4 | (s = p.indexOf(e2.charAt(o++))) >> 2, n = (3 & s) << 6 | (a = p.indexOf(e2.charAt(o++))), l[h++] = t2, 64 !== s && (l[h++] = r2), 64 !== a && (l[h++] = n);
            return l;
          };
        }, { "./support": 30, "./utils": 32 }], 2: [function(e, t, r) {
          "use strict";
          var n = e("./external"), i = e("./stream/DataWorker"), s = e("./stream/Crc32Probe"), a = e("./stream/DataLengthProbe");
          function o(e2, t2, r2, n2, i2) {
            this.compressedSize = e2, this.uncompressedSize = t2, this.crc32 = r2, this.compression = n2, this.compressedContent = i2;
          }
          o.prototype = { getContentWorker: function() {
            var e2 = new i(n.Promise.resolve(this.compressedContent)).pipe(this.compression.uncompressWorker()).pipe(new a("data_length")), t2 = this;
            return e2.on("end", function() {
              if (this.streamInfo.data_length !== t2.uncompressedSize) throw new Error("Bug : uncompressed data size mismatch");
            }), e2;
          }, getCompressedWorker: function() {
            return new i(n.Promise.resolve(this.compressedContent)).withStreamInfo("compressedSize", this.compressedSize).withStreamInfo("uncompressedSize", this.uncompressedSize).withStreamInfo("crc32", this.crc32).withStreamInfo("compression", this.compression);
          } }, o.createWorkerFrom = function(e2, t2, r2) {
            return e2.pipe(new s()).pipe(new a("uncompressedSize")).pipe(t2.compressWorker(r2)).pipe(new a("compressedSize")).withStreamInfo("compression", t2);
          }, t.exports = o;
        }, { "./external": 6, "./stream/Crc32Probe": 25, "./stream/DataLengthProbe": 26, "./stream/DataWorker": 27 }], 3: [function(e, t, r) {
          "use strict";
          var n = e("./stream/GenericWorker");
          r.STORE = { magic: "\0\0", compressWorker: function() {
            return new n("STORE compression");
          }, uncompressWorker: function() {
            return new n("STORE decompression");
          } }, r.DEFLATE = e("./flate");
        }, { "./flate": 7, "./stream/GenericWorker": 28 }], 4: [function(e, t, r) {
          "use strict";
          var n = e("./utils");
          var o = (function() {
            for (var e2, t2 = [], r2 = 0; r2 < 256; r2++) {
              e2 = r2;
              for (var n2 = 0; n2 < 8; n2++) e2 = 1 & e2 ? 3988292384 ^ e2 >>> 1 : e2 >>> 1;
              t2[r2] = e2;
            }
            return t2;
          })();
          t.exports = function(e2, t2) {
            return void 0 !== e2 && e2.length ? "string" !== n.getTypeOf(e2) ? (function(e3, t3, r2, n2) {
              var i = o, s = n2 + r2;
              e3 ^= -1;
              for (var a = n2; a < s; a++) e3 = e3 >>> 8 ^ i[255 & (e3 ^ t3[a])];
              return -1 ^ e3;
            })(0 | t2, e2, e2.length, 0) : (function(e3, t3, r2, n2) {
              var i = o, s = n2 + r2;
              e3 ^= -1;
              for (var a = n2; a < s; a++) e3 = e3 >>> 8 ^ i[255 & (e3 ^ t3.charCodeAt(a))];
              return -1 ^ e3;
            })(0 | t2, e2, e2.length, 0) : 0;
          };
        }, { "./utils": 32 }], 5: [function(e, t, r) {
          "use strict";
          r.base64 = false, r.binary = false, r.dir = false, r.createFolders = true, r.date = null, r.compression = null, r.compressionOptions = null, r.comment = null, r.unixPermissions = null, r.dosPermissions = null;
        }, {}], 6: [function(e, t, r) {
          "use strict";
          var n = null;
          n = "undefined" != typeof Promise ? Promise : e("lie"), t.exports = { Promise: n };
        }, { lie: 37 }], 7: [function(e, t, r) {
          "use strict";
          var n = "undefined" != typeof Uint8Array && "undefined" != typeof Uint16Array && "undefined" != typeof Uint32Array, i = e("pako"), s = e("./utils"), a = e("./stream/GenericWorker"), o = n ? "uint8array" : "array";
          function h(e2, t2) {
            a.call(this, "FlateWorker/" + e2), this._pako = null, this._pakoAction = e2, this._pakoOptions = t2, this.meta = {};
          }
          r.magic = "\b\0", s.inherits(h, a), h.prototype.processChunk = function(e2) {
            this.meta = e2.meta, null === this._pako && this._createPako(), this._pako.push(s.transformTo(o, e2.data), false);
          }, h.prototype.flush = function() {
            a.prototype.flush.call(this), null === this._pako && this._createPako(), this._pako.push([], true);
          }, h.prototype.cleanUp = function() {
            a.prototype.cleanUp.call(this), this._pako = null;
          }, h.prototype._createPako = function() {
            this._pako = new i[this._pakoAction]({ raw: true, level: this._pakoOptions.level || -1 });
            var t2 = this;
            this._pako.onData = function(e2) {
              t2.push({ data: e2, meta: t2.meta });
            };
          }, r.compressWorker = function(e2) {
            return new h("Deflate", e2);
          }, r.uncompressWorker = function() {
            return new h("Inflate", {});
          };
        }, { "./stream/GenericWorker": 28, "./utils": 32, pako: 38 }], 8: [function(e, t, r) {
          "use strict";
          function A(e2, t2) {
            var r2, n2 = "";
            for (r2 = 0; r2 < t2; r2++) n2 += String.fromCharCode(255 & e2), e2 >>>= 8;
            return n2;
          }
          function n(e2, t2, r2, n2, i2, s2) {
            var a, o, h = e2.file, u = e2.compression, l = s2 !== O.utf8encode, f = I.transformTo("string", s2(h.name)), c = I.transformTo("string", O.utf8encode(h.name)), d = h.comment, p = I.transformTo("string", s2(d)), m = I.transformTo("string", O.utf8encode(d)), _ = c.length !== h.name.length, g = m.length !== d.length, b = "", v = "", y = "", w = h.dir, k = h.date, x = { crc32: 0, compressedSize: 0, uncompressedSize: 0 };
            t2 && !r2 || (x.crc32 = e2.crc32, x.compressedSize = e2.compressedSize, x.uncompressedSize = e2.uncompressedSize);
            var S = 0;
            t2 && (S |= 8), l || !_ && !g || (S |= 2048);
            var z = 0, C = 0;
            w && (z |= 16), "UNIX" === i2 ? (C = 798, z |= (function(e3, t3) {
              var r3 = e3;
              return e3 || (r3 = t3 ? 16893 : 33204), (65535 & r3) << 16;
            })(h.unixPermissions, w)) : (C = 20, z |= (function(e3) {
              return 63 & (e3 || 0);
            })(h.dosPermissions)), a = k.getUTCHours(), a <<= 6, a |= k.getUTCMinutes(), a <<= 5, a |= k.getUTCSeconds() / 2, o = k.getUTCFullYear() - 1980, o <<= 4, o |= k.getUTCMonth() + 1, o <<= 5, o |= k.getUTCDate(), _ && (v = A(1, 1) + A(B(f), 4) + c, b += "up" + A(v.length, 2) + v), g && (y = A(1, 1) + A(B(p), 4) + m, b += "uc" + A(y.length, 2) + y);
            var E = "";
            return E += "\n\0", E += A(S, 2), E += u.magic, E += A(a, 2), E += A(o, 2), E += A(x.crc32, 4), E += A(x.compressedSize, 4), E += A(x.uncompressedSize, 4), E += A(f.length, 2), E += A(b.length, 2), { fileRecord: R.LOCAL_FILE_HEADER + E + f + b, dirRecord: R.CENTRAL_FILE_HEADER + A(C, 2) + E + A(p.length, 2) + "\0\0\0\0" + A(z, 4) + A(n2, 4) + f + b + p };
          }
          var I = e("../utils"), i = e("../stream/GenericWorker"), O = e("../utf8"), B = e("../crc32"), R = e("../signature");
          function s(e2, t2, r2, n2) {
            i.call(this, "ZipFileWorker"), this.bytesWritten = 0, this.zipComment = t2, this.zipPlatform = r2, this.encodeFileName = n2, this.streamFiles = e2, this.accumulate = false, this.contentBuffer = [], this.dirRecords = [], this.currentSourceOffset = 0, this.entriesCount = 0, this.currentFile = null, this._sources = [];
          }
          I.inherits(s, i), s.prototype.push = function(e2) {
            var t2 = e2.meta.percent || 0, r2 = this.entriesCount, n2 = this._sources.length;
            this.accumulate ? this.contentBuffer.push(e2) : (this.bytesWritten += e2.data.length, i.prototype.push.call(this, { data: e2.data, meta: { currentFile: this.currentFile, percent: r2 ? (t2 + 100 * (r2 - n2 - 1)) / r2 : 100 } }));
          }, s.prototype.openedSource = function(e2) {
            this.currentSourceOffset = this.bytesWritten, this.currentFile = e2.file.name;
            var t2 = this.streamFiles && !e2.file.dir;
            if (t2) {
              var r2 = n(e2, t2, false, this.currentSourceOffset, this.zipPlatform, this.encodeFileName);
              this.push({ data: r2.fileRecord, meta: { percent: 0 } });
            } else this.accumulate = true;
          }, s.prototype.closedSource = function(e2) {
            this.accumulate = false;
            var t2 = this.streamFiles && !e2.file.dir, r2 = n(e2, t2, true, this.currentSourceOffset, this.zipPlatform, this.encodeFileName);
            if (this.dirRecords.push(r2.dirRecord), t2) this.push({ data: (function(e3) {
              return R.DATA_DESCRIPTOR + A(e3.crc32, 4) + A(e3.compressedSize, 4) + A(e3.uncompressedSize, 4);
            })(e2), meta: { percent: 100 } });
            else for (this.push({ data: r2.fileRecord, meta: { percent: 0 } }); this.contentBuffer.length; ) this.push(this.contentBuffer.shift());
            this.currentFile = null;
          }, s.prototype.flush = function() {
            for (var e2 = this.bytesWritten, t2 = 0; t2 < this.dirRecords.length; t2++) this.push({ data: this.dirRecords[t2], meta: { percent: 100 } });
            var r2 = this.bytesWritten - e2, n2 = (function(e3, t3, r3, n3, i2) {
              var s2 = I.transformTo("string", i2(n3));
              return R.CENTRAL_DIRECTORY_END + "\0\0\0\0" + A(e3, 2) + A(e3, 2) + A(t3, 4) + A(r3, 4) + A(s2.length, 2) + s2;
            })(this.dirRecords.length, r2, e2, this.zipComment, this.encodeFileName);
            this.push({ data: n2, meta: { percent: 100 } });
          }, s.prototype.prepareNextSource = function() {
            this.previous = this._sources.shift(), this.openedSource(this.previous.streamInfo), this.isPaused ? this.previous.pause() : this.previous.resume();
          }, s.prototype.registerPrevious = function(e2) {
            this._sources.push(e2);
            var t2 = this;
            return e2.on("data", function(e3) {
              t2.processChunk(e3);
            }), e2.on("end", function() {
              t2.closedSource(t2.previous.streamInfo), t2._sources.length ? t2.prepareNextSource() : t2.end();
            }), e2.on("error", function(e3) {
              t2.error(e3);
            }), this;
          }, s.prototype.resume = function() {
            return !!i.prototype.resume.call(this) && (!this.previous && this._sources.length ? (this.prepareNextSource(), true) : this.previous || this._sources.length || this.generatedError ? void 0 : (this.end(), true));
          }, s.prototype.error = function(e2) {
            var t2 = this._sources;
            if (!i.prototype.error.call(this, e2)) return false;
            for (var r2 = 0; r2 < t2.length; r2++) try {
              t2[r2].error(e2);
            } catch (e3) {
            }
            return true;
          }, s.prototype.lock = function() {
            i.prototype.lock.call(this);
            for (var e2 = this._sources, t2 = 0; t2 < e2.length; t2++) e2[t2].lock();
          }, t.exports = s;
        }, { "../crc32": 4, "../signature": 23, "../stream/GenericWorker": 28, "../utf8": 31, "../utils": 32 }], 9: [function(e, t, r) {
          "use strict";
          var u = e("../compressions"), n = e("./ZipFileWorker");
          r.generateWorker = function(e2, a, t2) {
            var o = new n(a.streamFiles, t2, a.platform, a.encodeFileName), h = 0;
            try {
              e2.forEach(function(e3, t3) {
                h++;
                var r2 = (function(e4, t4) {
                  var r3 = e4 || t4, n3 = u[r3];
                  if (!n3) throw new Error(r3 + " is not a valid compression method !");
                  return n3;
                })(t3.options.compression, a.compression), n2 = t3.options.compressionOptions || a.compressionOptions || {}, i = t3.dir, s = t3.date;
                t3._compressWorker(r2, n2).withStreamInfo("file", { name: e3, dir: i, date: s, comment: t3.comment || "", unixPermissions: t3.unixPermissions, dosPermissions: t3.dosPermissions }).pipe(o);
              }), o.entriesCount = h;
            } catch (e3) {
              o.error(e3);
            }
            return o;
          };
        }, { "../compressions": 3, "./ZipFileWorker": 8 }], 10: [function(e, t, r) {
          "use strict";
          function n() {
            if (!(this instanceof n)) return new n();
            if (arguments.length) throw new Error("The constructor with parameters has been removed in JSZip 3.0, please check the upgrade guide.");
            this.files = /* @__PURE__ */ Object.create(null), this.comment = null, this.root = "", this.clone = function() {
              var e2 = new n();
              for (var t2 in this) "function" != typeof this[t2] && (e2[t2] = this[t2]);
              return e2;
            };
          }
          (n.prototype = e("./object")).loadAsync = e("./load"), n.support = e("./support"), n.defaults = e("./defaults"), n.version = "3.10.1", n.loadAsync = function(e2, t2) {
            return new n().loadAsync(e2, t2);
          }, n.external = e("./external"), t.exports = n;
        }, { "./defaults": 5, "./external": 6, "./load": 11, "./object": 15, "./support": 30 }], 11: [function(e, t, r) {
          "use strict";
          var u = e("./utils"), i = e("./external"), n = e("./utf8"), s = e("./zipEntries"), a = e("./stream/Crc32Probe"), l = e("./nodejsUtils");
          function f(n2) {
            return new i.Promise(function(e2, t2) {
              var r2 = n2.decompressed.getContentWorker().pipe(new a());
              r2.on("error", function(e3) {
                t2(e3);
              }).on("end", function() {
                r2.streamInfo.crc32 !== n2.decompressed.crc32 ? t2(new Error("Corrupted zip : CRC32 mismatch")) : e2();
              }).resume();
            });
          }
          t.exports = function(e2, o) {
            var h = this;
            return o = u.extend(o || {}, { base64: false, checkCRC32: false, optimizedBinaryString: false, createFolders: false, decodeFileName: n.utf8decode }), l.isNode && l.isStream(e2) ? i.Promise.reject(new Error("JSZip can't accept a stream when loading a zip file.")) : u.prepareContent("the loaded zip file", e2, true, o.optimizedBinaryString, o.base64).then(function(e3) {
              var t2 = new s(o);
              return t2.load(e3), t2;
            }).then(function(e3) {
              var t2 = [i.Promise.resolve(e3)], r2 = e3.files;
              if (o.checkCRC32) for (var n2 = 0; n2 < r2.length; n2++) t2.push(f(r2[n2]));
              return i.Promise.all(t2);
            }).then(function(e3) {
              for (var t2 = e3.shift(), r2 = t2.files, n2 = 0; n2 < r2.length; n2++) {
                var i2 = r2[n2], s2 = i2.fileNameStr, a2 = u.resolve(i2.fileNameStr);
                h.file(a2, i2.decompressed, { binary: true, optimizedBinaryString: true, date: i2.date, dir: i2.dir, comment: i2.fileCommentStr.length ? i2.fileCommentStr : null, unixPermissions: i2.unixPermissions, dosPermissions: i2.dosPermissions, createFolders: o.createFolders }), i2.dir || (h.file(a2).unsafeOriginalName = s2);
              }
              return t2.zipComment.length && (h.comment = t2.zipComment), h;
            });
          };
        }, { "./external": 6, "./nodejsUtils": 14, "./stream/Crc32Probe": 25, "./utf8": 31, "./utils": 32, "./zipEntries": 33 }], 12: [function(e, t, r) {
          "use strict";
          var n = e("../utils"), i = e("../stream/GenericWorker");
          function s(e2, t2) {
            i.call(this, "Nodejs stream input adapter for " + e2), this._upstreamEnded = false, this._bindStream(t2);
          }
          n.inherits(s, i), s.prototype._bindStream = function(e2) {
            var t2 = this;
            (this._stream = e2).pause(), e2.on("data", function(e3) {
              t2.push({ data: e3, meta: { percent: 0 } });
            }).on("error", function(e3) {
              t2.isPaused ? this.generatedError = e3 : t2.error(e3);
            }).on("end", function() {
              t2.isPaused ? t2._upstreamEnded = true : t2.end();
            });
          }, s.prototype.pause = function() {
            return !!i.prototype.pause.call(this) && (this._stream.pause(), true);
          }, s.prototype.resume = function() {
            return !!i.prototype.resume.call(this) && (this._upstreamEnded ? this.end() : this._stream.resume(), true);
          }, t.exports = s;
        }, { "../stream/GenericWorker": 28, "../utils": 32 }], 13: [function(e, t, r) {
          "use strict";
          var i = e("readable-stream").Readable;
          function n(e2, t2, r2) {
            i.call(this, t2), this._helper = e2;
            var n2 = this;
            e2.on("data", function(e3, t3) {
              n2.push(e3) || n2._helper.pause(), r2 && r2(t3);
            }).on("error", function(e3) {
              n2.emit("error", e3);
            }).on("end", function() {
              n2.push(null);
            });
          }
          e("../utils").inherits(n, i), n.prototype._read = function() {
            this._helper.resume();
          }, t.exports = n;
        }, { "../utils": 32, "readable-stream": 16 }], 14: [function(e, t, r) {
          "use strict";
          t.exports = { isNode: "undefined" != typeof Buffer, newBufferFrom: function(e2, t2) {
            if (Buffer.from && Buffer.from !== Uint8Array.from) return Buffer.from(e2, t2);
            if ("number" == typeof e2) throw new Error('The "data" argument must not be a number');
            return new Buffer(e2, t2);
          }, allocBuffer: function(e2) {
            if (Buffer.alloc) return Buffer.alloc(e2);
            var t2 = new Buffer(e2);
            return t2.fill(0), t2;
          }, isBuffer: function(e2) {
            return Buffer.isBuffer(e2);
          }, isStream: function(e2) {
            return e2 && "function" == typeof e2.on && "function" == typeof e2.pause && "function" == typeof e2.resume;
          } };
        }, {}], 15: [function(e, t, r) {
          "use strict";
          function s(e2, t2, r2) {
            var n2, i2 = u.getTypeOf(t2), s2 = u.extend(r2 || {}, f);
            s2.date = s2.date || /* @__PURE__ */ new Date(), null !== s2.compression && (s2.compression = s2.compression.toUpperCase()), "string" == typeof s2.unixPermissions && (s2.unixPermissions = parseInt(s2.unixPermissions, 8)), s2.unixPermissions && 16384 & s2.unixPermissions && (s2.dir = true), s2.dosPermissions && 16 & s2.dosPermissions && (s2.dir = true), s2.dir && (e2 = g(e2)), s2.createFolders && (n2 = _(e2)) && b.call(this, n2, true);
            var a2 = "string" === i2 && false === s2.binary && false === s2.base64;
            r2 && void 0 !== r2.binary || (s2.binary = !a2), (t2 instanceof c && 0 === t2.uncompressedSize || s2.dir || !t2 || 0 === t2.length) && (s2.base64 = false, s2.binary = true, t2 = "", s2.compression = "STORE", i2 = "string");
            var o2 = null;
            o2 = t2 instanceof c || t2 instanceof l ? t2 : p.isNode && p.isStream(t2) ? new m(e2, t2) : u.prepareContent(e2, t2, s2.binary, s2.optimizedBinaryString, s2.base64);
            var h2 = new d(e2, o2, s2);
            this.files[e2] = h2;
          }
          var i = e("./utf8"), u = e("./utils"), l = e("./stream/GenericWorker"), a = e("./stream/StreamHelper"), f = e("./defaults"), c = e("./compressedObject"), d = e("./zipObject"), o = e("./generate"), p = e("./nodejsUtils"), m = e("./nodejs/NodejsStreamInputAdapter"), _ = function(e2) {
            "/" === e2.slice(-1) && (e2 = e2.substring(0, e2.length - 1));
            var t2 = e2.lastIndexOf("/");
            return 0 < t2 ? e2.substring(0, t2) : "";
          }, g = function(e2) {
            return "/" !== e2.slice(-1) && (e2 += "/"), e2;
          }, b = function(e2, t2) {
            return t2 = void 0 !== t2 ? t2 : f.createFolders, e2 = g(e2), this.files[e2] || s.call(this, e2, null, { dir: true, createFolders: t2 }), this.files[e2];
          };
          function h(e2) {
            return "[object RegExp]" === Object.prototype.toString.call(e2);
          }
          var n = { load: function() {
            throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.");
          }, forEach: function(e2) {
            var t2, r2, n2;
            for (t2 in this.files) n2 = this.files[t2], (r2 = t2.slice(this.root.length, t2.length)) && t2.slice(0, this.root.length) === this.root && e2(r2, n2);
          }, filter: function(r2) {
            var n2 = [];
            return this.forEach(function(e2, t2) {
              r2(e2, t2) && n2.push(t2);
            }), n2;
          }, file: function(e2, t2, r2) {
            if (1 !== arguments.length) return e2 = this.root + e2, s.call(this, e2, t2, r2), this;
            if (h(e2)) {
              var n2 = e2;
              return this.filter(function(e3, t3) {
                return !t3.dir && n2.test(e3);
              });
            }
            var i2 = this.files[this.root + e2];
            return i2 && !i2.dir ? i2 : null;
          }, folder: function(r2) {
            if (!r2) return this;
            if (h(r2)) return this.filter(function(e3, t3) {
              return t3.dir && r2.test(e3);
            });
            var e2 = this.root + r2, t2 = b.call(this, e2), n2 = this.clone();
            return n2.root = t2.name, n2;
          }, remove: function(r2) {
            r2 = this.root + r2;
            var e2 = this.files[r2];
            if (e2 || ("/" !== r2.slice(-1) && (r2 += "/"), e2 = this.files[r2]), e2 && !e2.dir) delete this.files[r2];
            else for (var t2 = this.filter(function(e3, t3) {
              return t3.name.slice(0, r2.length) === r2;
            }), n2 = 0; n2 < t2.length; n2++) delete this.files[t2[n2].name];
            return this;
          }, generate: function() {
            throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.");
          }, generateInternalStream: function(e2) {
            var t2, r2 = {};
            try {
              if ((r2 = u.extend(e2 || {}, { streamFiles: false, compression: "STORE", compressionOptions: null, type: "", platform: "DOS", comment: null, mimeType: "application/zip", encodeFileName: i.utf8encode })).type = r2.type.toLowerCase(), r2.compression = r2.compression.toUpperCase(), "binarystring" === r2.type && (r2.type = "string"), !r2.type) throw new Error("No output type specified.");
              u.checkSupport(r2.type), "darwin" !== r2.platform && "freebsd" !== r2.platform && "linux" !== r2.platform && "sunos" !== r2.platform || (r2.platform = "UNIX"), "win32" === r2.platform && (r2.platform = "DOS");
              var n2 = r2.comment || this.comment || "";
              t2 = o.generateWorker(this, r2, n2);
            } catch (e3) {
              (t2 = new l("error")).error(e3);
            }
            return new a(t2, r2.type || "string", r2.mimeType);
          }, generateAsync: function(e2, t2) {
            return this.generateInternalStream(e2).accumulate(t2);
          }, generateNodeStream: function(e2, t2) {
            return (e2 = e2 || {}).type || (e2.type = "nodebuffer"), this.generateInternalStream(e2).toNodejsStream(t2);
          } };
          t.exports = n;
        }, { "./compressedObject": 2, "./defaults": 5, "./generate": 9, "./nodejs/NodejsStreamInputAdapter": 12, "./nodejsUtils": 14, "./stream/GenericWorker": 28, "./stream/StreamHelper": 29, "./utf8": 31, "./utils": 32, "./zipObject": 35 }], 16: [function(e, t, r) {
          "use strict";
          t.exports = e("stream");
        }, { stream: void 0 }], 17: [function(e, t, r) {
          "use strict";
          var n = e("./DataReader");
          function i(e2) {
            n.call(this, e2);
            for (var t2 = 0; t2 < this.data.length; t2++) e2[t2] = 255 & e2[t2];
          }
          e("../utils").inherits(i, n), i.prototype.byteAt = function(e2) {
            return this.data[this.zero + e2];
          }, i.prototype.lastIndexOfSignature = function(e2) {
            for (var t2 = e2.charCodeAt(0), r2 = e2.charCodeAt(1), n2 = e2.charCodeAt(2), i2 = e2.charCodeAt(3), s = this.length - 4; 0 <= s; --s) if (this.data[s] === t2 && this.data[s + 1] === r2 && this.data[s + 2] === n2 && this.data[s + 3] === i2) return s - this.zero;
            return -1;
          }, i.prototype.readAndCheckSignature = function(e2) {
            var t2 = e2.charCodeAt(0), r2 = e2.charCodeAt(1), n2 = e2.charCodeAt(2), i2 = e2.charCodeAt(3), s = this.readData(4);
            return t2 === s[0] && r2 === s[1] && n2 === s[2] && i2 === s[3];
          }, i.prototype.readData = function(e2) {
            if (this.checkOffset(e2), 0 === e2) return [];
            var t2 = this.data.slice(this.zero + this.index, this.zero + this.index + e2);
            return this.index += e2, t2;
          }, t.exports = i;
        }, { "../utils": 32, "./DataReader": 18 }], 18: [function(e, t, r) {
          "use strict";
          var n = e("../utils");
          function i(e2) {
            this.data = e2, this.length = e2.length, this.index = 0, this.zero = 0;
          }
          i.prototype = { checkOffset: function(e2) {
            this.checkIndex(this.index + e2);
          }, checkIndex: function(e2) {
            if (this.length < this.zero + e2 || e2 < 0) throw new Error("End of data reached (data length = " + this.length + ", asked index = " + e2 + "). Corrupted zip ?");
          }, setIndex: function(e2) {
            this.checkIndex(e2), this.index = e2;
          }, skip: function(e2) {
            this.setIndex(this.index + e2);
          }, byteAt: function() {
          }, readInt: function(e2) {
            var t2, r2 = 0;
            for (this.checkOffset(e2), t2 = this.index + e2 - 1; t2 >= this.index; t2--) r2 = (r2 << 8) + this.byteAt(t2);
            return this.index += e2, r2;
          }, readString: function(e2) {
            return n.transformTo("string", this.readData(e2));
          }, readData: function() {
          }, lastIndexOfSignature: function() {
          }, readAndCheckSignature: function() {
          }, readDate: function() {
            var e2 = this.readInt(4);
            return new Date(Date.UTC(1980 + (e2 >> 25 & 127), (e2 >> 21 & 15) - 1, e2 >> 16 & 31, e2 >> 11 & 31, e2 >> 5 & 63, (31 & e2) << 1));
          } }, t.exports = i;
        }, { "../utils": 32 }], 19: [function(e, t, r) {
          "use strict";
          var n = e("./Uint8ArrayReader");
          function i(e2) {
            n.call(this, e2);
          }
          e("../utils").inherits(i, n), i.prototype.readData = function(e2) {
            this.checkOffset(e2);
            var t2 = this.data.slice(this.zero + this.index, this.zero + this.index + e2);
            return this.index += e2, t2;
          }, t.exports = i;
        }, { "../utils": 32, "./Uint8ArrayReader": 21 }], 20: [function(e, t, r) {
          "use strict";
          var n = e("./DataReader");
          function i(e2) {
            n.call(this, e2);
          }
          e("../utils").inherits(i, n), i.prototype.byteAt = function(e2) {
            return this.data.charCodeAt(this.zero + e2);
          }, i.prototype.lastIndexOfSignature = function(e2) {
            return this.data.lastIndexOf(e2) - this.zero;
          }, i.prototype.readAndCheckSignature = function(e2) {
            return e2 === this.readData(4);
          }, i.prototype.readData = function(e2) {
            this.checkOffset(e2);
            var t2 = this.data.slice(this.zero + this.index, this.zero + this.index + e2);
            return this.index += e2, t2;
          }, t.exports = i;
        }, { "../utils": 32, "./DataReader": 18 }], 21: [function(e, t, r) {
          "use strict";
          var n = e("./ArrayReader");
          function i(e2) {
            n.call(this, e2);
          }
          e("../utils").inherits(i, n), i.prototype.readData = function(e2) {
            if (this.checkOffset(e2), 0 === e2) return new Uint8Array(0);
            var t2 = this.data.subarray(this.zero + this.index, this.zero + this.index + e2);
            return this.index += e2, t2;
          }, t.exports = i;
        }, { "../utils": 32, "./ArrayReader": 17 }], 22: [function(e, t, r) {
          "use strict";
          var n = e("../utils"), i = e("../support"), s = e("./ArrayReader"), a = e("./StringReader"), o = e("./NodeBufferReader"), h = e("./Uint8ArrayReader");
          t.exports = function(e2) {
            var t2 = n.getTypeOf(e2);
            return n.checkSupport(t2), "string" !== t2 || i.uint8array ? "nodebuffer" === t2 ? new o(e2) : i.uint8array ? new h(n.transformTo("uint8array", e2)) : new s(n.transformTo("array", e2)) : new a(e2);
          };
        }, { "../support": 30, "../utils": 32, "./ArrayReader": 17, "./NodeBufferReader": 19, "./StringReader": 20, "./Uint8ArrayReader": 21 }], 23: [function(e, t, r) {
          "use strict";
          r.LOCAL_FILE_HEADER = "PK", r.CENTRAL_FILE_HEADER = "PK", r.CENTRAL_DIRECTORY_END = "PK", r.ZIP64_CENTRAL_DIRECTORY_LOCATOR = "PK\x07", r.ZIP64_CENTRAL_DIRECTORY_END = "PK", r.DATA_DESCRIPTOR = "PK\x07\b";
        }, {}], 24: [function(e, t, r) {
          "use strict";
          var n = e("./GenericWorker"), i = e("../utils");
          function s(e2) {
            n.call(this, "ConvertWorker to " + e2), this.destType = e2;
          }
          i.inherits(s, n), s.prototype.processChunk = function(e2) {
            this.push({ data: i.transformTo(this.destType, e2.data), meta: e2.meta });
          }, t.exports = s;
        }, { "../utils": 32, "./GenericWorker": 28 }], 25: [function(e, t, r) {
          "use strict";
          var n = e("./GenericWorker"), i = e("../crc32");
          function s() {
            n.call(this, "Crc32Probe"), this.withStreamInfo("crc32", 0);
          }
          e("../utils").inherits(s, n), s.prototype.processChunk = function(e2) {
            this.streamInfo.crc32 = i(e2.data, this.streamInfo.crc32 || 0), this.push(e2);
          }, t.exports = s;
        }, { "../crc32": 4, "../utils": 32, "./GenericWorker": 28 }], 26: [function(e, t, r) {
          "use strict";
          var n = e("../utils"), i = e("./GenericWorker");
          function s(e2) {
            i.call(this, "DataLengthProbe for " + e2), this.propName = e2, this.withStreamInfo(e2, 0);
          }
          n.inherits(s, i), s.prototype.processChunk = function(e2) {
            if (e2) {
              var t2 = this.streamInfo[this.propName] || 0;
              this.streamInfo[this.propName] = t2 + e2.data.length;
            }
            i.prototype.processChunk.call(this, e2);
          }, t.exports = s;
        }, { "../utils": 32, "./GenericWorker": 28 }], 27: [function(e, t, r) {
          "use strict";
          var n = e("../utils"), i = e("./GenericWorker");
          function s(e2) {
            i.call(this, "DataWorker");
            var t2 = this;
            this.dataIsReady = false, this.index = 0, this.max = 0, this.data = null, this.type = "", this._tickScheduled = false, e2.then(function(e3) {
              t2.dataIsReady = true, t2.data = e3, t2.max = e3 && e3.length || 0, t2.type = n.getTypeOf(e3), t2.isPaused || t2._tickAndRepeat();
            }, function(e3) {
              t2.error(e3);
            });
          }
          n.inherits(s, i), s.prototype.cleanUp = function() {
            i.prototype.cleanUp.call(this), this.data = null;
          }, s.prototype.resume = function() {
            return !!i.prototype.resume.call(this) && (!this._tickScheduled && this.dataIsReady && (this._tickScheduled = true, n.delay(this._tickAndRepeat, [], this)), true);
          }, s.prototype._tickAndRepeat = function() {
            this._tickScheduled = false, this.isPaused || this.isFinished || (this._tick(), this.isFinished || (n.delay(this._tickAndRepeat, [], this), this._tickScheduled = true));
          }, s.prototype._tick = function() {
            if (this.isPaused || this.isFinished) return false;
            var e2 = null, t2 = Math.min(this.max, this.index + 16384);
            if (this.index >= this.max) return this.end();
            switch (this.type) {
              case "string":
                e2 = this.data.substring(this.index, t2);
                break;
              case "uint8array":
                e2 = this.data.subarray(this.index, t2);
                break;
              case "array":
              case "nodebuffer":
                e2 = this.data.slice(this.index, t2);
            }
            return this.index = t2, this.push({ data: e2, meta: { percent: this.max ? this.index / this.max * 100 : 0 } });
          }, t.exports = s;
        }, { "../utils": 32, "./GenericWorker": 28 }], 28: [function(e, t, r) {
          "use strict";
          function n(e2) {
            this.name = e2 || "default", this.streamInfo = {}, this.generatedError = null, this.extraStreamInfo = {}, this.isPaused = true, this.isFinished = false, this.isLocked = false, this._listeners = { data: [], end: [], error: [] }, this.previous = null;
          }
          n.prototype = { push: function(e2) {
            this.emit("data", e2);
          }, end: function() {
            if (this.isFinished) return false;
            this.flush();
            try {
              this.emit("end"), this.cleanUp(), this.isFinished = true;
            } catch (e2) {
              this.emit("error", e2);
            }
            return true;
          }, error: function(e2) {
            return !this.isFinished && (this.isPaused ? this.generatedError = e2 : (this.isFinished = true, this.emit("error", e2), this.previous && this.previous.error(e2), this.cleanUp()), true);
          }, on: function(e2, t2) {
            return this._listeners[e2].push(t2), this;
          }, cleanUp: function() {
            this.streamInfo = this.generatedError = this.extraStreamInfo = null, this._listeners = [];
          }, emit: function(e2, t2) {
            if (this._listeners[e2]) for (var r2 = 0; r2 < this._listeners[e2].length; r2++) this._listeners[e2][r2].call(this, t2);
          }, pipe: function(e2) {
            return e2.registerPrevious(this);
          }, registerPrevious: function(e2) {
            if (this.isLocked) throw new Error("The stream '" + this + "' has already been used.");
            this.streamInfo = e2.streamInfo, this.mergeStreamInfo(), this.previous = e2;
            var t2 = this;
            return e2.on("data", function(e3) {
              t2.processChunk(e3);
            }), e2.on("end", function() {
              t2.end();
            }), e2.on("error", function(e3) {
              t2.error(e3);
            }), this;
          }, pause: function() {
            return !this.isPaused && !this.isFinished && (this.isPaused = true, this.previous && this.previous.pause(), true);
          }, resume: function() {
            if (!this.isPaused || this.isFinished) return false;
            var e2 = this.isPaused = false;
            return this.generatedError && (this.error(this.generatedError), e2 = true), this.previous && this.previous.resume(), !e2;
          }, flush: function() {
          }, processChunk: function(e2) {
            this.push(e2);
          }, withStreamInfo: function(e2, t2) {
            return this.extraStreamInfo[e2] = t2, this.mergeStreamInfo(), this;
          }, mergeStreamInfo: function() {
            for (var e2 in this.extraStreamInfo) Object.prototype.hasOwnProperty.call(this.extraStreamInfo, e2) && (this.streamInfo[e2] = this.extraStreamInfo[e2]);
          }, lock: function() {
            if (this.isLocked) throw new Error("The stream '" + this + "' has already been used.");
            this.isLocked = true, this.previous && this.previous.lock();
          }, toString: function() {
            var e2 = "Worker " + this.name;
            return this.previous ? this.previous + " -> " + e2 : e2;
          } }, t.exports = n;
        }, {}], 29: [function(e, t, r) {
          "use strict";
          var h = e("../utils"), i = e("./ConvertWorker"), s = e("./GenericWorker"), u = e("../base64"), n = e("../support"), a = e("../external"), o = null;
          if (n.nodestream) try {
            o = e("../nodejs/NodejsStreamOutputAdapter");
          } catch (e2) {
          }
          function l(e2, o2) {
            return new a.Promise(function(t2, r2) {
              var n2 = [], i2 = e2._internalType, s2 = e2._outputType, a2 = e2._mimeType;
              e2.on("data", function(e3, t3) {
                n2.push(e3), o2 && o2(t3);
              }).on("error", function(e3) {
                n2 = [], r2(e3);
              }).on("end", function() {
                try {
                  var e3 = (function(e4, t3, r3) {
                    switch (e4) {
                      case "blob":
                        return h.newBlob(h.transformTo("arraybuffer", t3), r3);
                      case "base64":
                        return u.encode(t3);
                      default:
                        return h.transformTo(e4, t3);
                    }
                  })(s2, (function(e4, t3) {
                    var r3, n3 = 0, i3 = null, s3 = 0;
                    for (r3 = 0; r3 < t3.length; r3++) s3 += t3[r3].length;
                    switch (e4) {
                      case "string":
                        return t3.join("");
                      case "array":
                        return Array.prototype.concat.apply([], t3);
                      case "uint8array":
                        for (i3 = new Uint8Array(s3), r3 = 0; r3 < t3.length; r3++) i3.set(t3[r3], n3), n3 += t3[r3].length;
                        return i3;
                      case "nodebuffer":
                        return Buffer.concat(t3);
                      default:
                        throw new Error("concat : unsupported type '" + e4 + "'");
                    }
                  })(i2, n2), a2);
                  t2(e3);
                } catch (e4) {
                  r2(e4);
                }
                n2 = [];
              }).resume();
            });
          }
          function f(e2, t2, r2) {
            var n2 = t2;
            switch (t2) {
              case "blob":
              case "arraybuffer":
                n2 = "uint8array";
                break;
              case "base64":
                n2 = "string";
            }
            try {
              this._internalType = n2, this._outputType = t2, this._mimeType = r2, h.checkSupport(n2), this._worker = e2.pipe(new i(n2)), e2.lock();
            } catch (e3) {
              this._worker = new s("error"), this._worker.error(e3);
            }
          }
          f.prototype = { accumulate: function(e2) {
            return l(this, e2);
          }, on: function(e2, t2) {
            var r2 = this;
            return "data" === e2 ? this._worker.on(e2, function(e3) {
              t2.call(r2, e3.data, e3.meta);
            }) : this._worker.on(e2, function() {
              h.delay(t2, arguments, r2);
            }), this;
          }, resume: function() {
            return h.delay(this._worker.resume, [], this._worker), this;
          }, pause: function() {
            return this._worker.pause(), this;
          }, toNodejsStream: function(e2) {
            if (h.checkSupport("nodestream"), "nodebuffer" !== this._outputType) throw new Error(this._outputType + " is not supported by this method");
            return new o(this, { objectMode: "nodebuffer" !== this._outputType }, e2);
          } }, t.exports = f;
        }, { "../base64": 1, "../external": 6, "../nodejs/NodejsStreamOutputAdapter": 13, "../support": 30, "../utils": 32, "./ConvertWorker": 24, "./GenericWorker": 28 }], 30: [function(e, t, r) {
          "use strict";
          if (r.base64 = true, r.array = true, r.string = true, r.arraybuffer = "undefined" != typeof ArrayBuffer && "undefined" != typeof Uint8Array, r.nodebuffer = "undefined" != typeof Buffer, r.uint8array = "undefined" != typeof Uint8Array, "undefined" == typeof ArrayBuffer) r.blob = false;
          else {
            var n = new ArrayBuffer(0);
            try {
              r.blob = 0 === new Blob([n], { type: "application/zip" }).size;
            } catch (e2) {
              try {
                var i = new (self.BlobBuilder || self.WebKitBlobBuilder || self.MozBlobBuilder || self.MSBlobBuilder)();
                i.append(n), r.blob = 0 === i.getBlob("application/zip").size;
              } catch (e3) {
                r.blob = false;
              }
            }
          }
          try {
            r.nodestream = !!e("readable-stream").Readable;
          } catch (e2) {
            r.nodestream = false;
          }
        }, { "readable-stream": 16 }], 31: [function(e, t, s) {
          "use strict";
          for (var o = e("./utils"), h = e("./support"), r = e("./nodejsUtils"), n = e("./stream/GenericWorker"), u = new Array(256), i = 0; i < 256; i++) u[i] = 252 <= i ? 6 : 248 <= i ? 5 : 240 <= i ? 4 : 224 <= i ? 3 : 192 <= i ? 2 : 1;
          u[254] = u[254] = 1;
          function a() {
            n.call(this, "utf-8 decode"), this.leftOver = null;
          }
          function l() {
            n.call(this, "utf-8 encode");
          }
          s.utf8encode = function(e2) {
            return h.nodebuffer ? r.newBufferFrom(e2, "utf-8") : (function(e3) {
              var t2, r2, n2, i2, s2, a2 = e3.length, o2 = 0;
              for (i2 = 0; i2 < a2; i2++) 55296 == (64512 & (r2 = e3.charCodeAt(i2))) && i2 + 1 < a2 && 56320 == (64512 & (n2 = e3.charCodeAt(i2 + 1))) && (r2 = 65536 + (r2 - 55296 << 10) + (n2 - 56320), i2++), o2 += r2 < 128 ? 1 : r2 < 2048 ? 2 : r2 < 65536 ? 3 : 4;
              for (t2 = h.uint8array ? new Uint8Array(o2) : new Array(o2), i2 = s2 = 0; s2 < o2; i2++) 55296 == (64512 & (r2 = e3.charCodeAt(i2))) && i2 + 1 < a2 && 56320 == (64512 & (n2 = e3.charCodeAt(i2 + 1))) && (r2 = 65536 + (r2 - 55296 << 10) + (n2 - 56320), i2++), r2 < 128 ? t2[s2++] = r2 : (r2 < 2048 ? t2[s2++] = 192 | r2 >>> 6 : (r2 < 65536 ? t2[s2++] = 224 | r2 >>> 12 : (t2[s2++] = 240 | r2 >>> 18, t2[s2++] = 128 | r2 >>> 12 & 63), t2[s2++] = 128 | r2 >>> 6 & 63), t2[s2++] = 128 | 63 & r2);
              return t2;
            })(e2);
          }, s.utf8decode = function(e2) {
            return h.nodebuffer ? o.transformTo("nodebuffer", e2).toString("utf-8") : (function(e3) {
              var t2, r2, n2, i2, s2 = e3.length, a2 = new Array(2 * s2);
              for (t2 = r2 = 0; t2 < s2; ) if ((n2 = e3[t2++]) < 128) a2[r2++] = n2;
              else if (4 < (i2 = u[n2])) a2[r2++] = 65533, t2 += i2 - 1;
              else {
                for (n2 &= 2 === i2 ? 31 : 3 === i2 ? 15 : 7; 1 < i2 && t2 < s2; ) n2 = n2 << 6 | 63 & e3[t2++], i2--;
                1 < i2 ? a2[r2++] = 65533 : n2 < 65536 ? a2[r2++] = n2 : (n2 -= 65536, a2[r2++] = 55296 | n2 >> 10 & 1023, a2[r2++] = 56320 | 1023 & n2);
              }
              return a2.length !== r2 && (a2.subarray ? a2 = a2.subarray(0, r2) : a2.length = r2), o.applyFromCharCode(a2);
            })(e2 = o.transformTo(h.uint8array ? "uint8array" : "array", e2));
          }, o.inherits(a, n), a.prototype.processChunk = function(e2) {
            var t2 = o.transformTo(h.uint8array ? "uint8array" : "array", e2.data);
            if (this.leftOver && this.leftOver.length) {
              if (h.uint8array) {
                var r2 = t2;
                (t2 = new Uint8Array(r2.length + this.leftOver.length)).set(this.leftOver, 0), t2.set(r2, this.leftOver.length);
              } else t2 = this.leftOver.concat(t2);
              this.leftOver = null;
            }
            var n2 = (function(e3, t3) {
              var r3;
              for ((t3 = t3 || e3.length) > e3.length && (t3 = e3.length), r3 = t3 - 1; 0 <= r3 && 128 == (192 & e3[r3]); ) r3--;
              return r3 < 0 ? t3 : 0 === r3 ? t3 : r3 + u[e3[r3]] > t3 ? r3 : t3;
            })(t2), i2 = t2;
            n2 !== t2.length && (h.uint8array ? (i2 = t2.subarray(0, n2), this.leftOver = t2.subarray(n2, t2.length)) : (i2 = t2.slice(0, n2), this.leftOver = t2.slice(n2, t2.length))), this.push({ data: s.utf8decode(i2), meta: e2.meta });
          }, a.prototype.flush = function() {
            this.leftOver && this.leftOver.length && (this.push({ data: s.utf8decode(this.leftOver), meta: {} }), this.leftOver = null);
          }, s.Utf8DecodeWorker = a, o.inherits(l, n), l.prototype.processChunk = function(e2) {
            this.push({ data: s.utf8encode(e2.data), meta: e2.meta });
          }, s.Utf8EncodeWorker = l;
        }, { "./nodejsUtils": 14, "./stream/GenericWorker": 28, "./support": 30, "./utils": 32 }], 32: [function(e, t, a) {
          "use strict";
          var o = e("./support"), h = e("./base64"), r = e("./nodejsUtils"), u = e("./external");
          function n(e2) {
            return e2;
          }
          function l(e2, t2) {
            for (var r2 = 0; r2 < e2.length; ++r2) t2[r2] = 255 & e2.charCodeAt(r2);
            return t2;
          }
          e("setimmediate"), a.newBlob = function(t2, r2) {
            a.checkSupport("blob");
            try {
              return new Blob([t2], { type: r2 });
            } catch (e2) {
              try {
                var n2 = new (self.BlobBuilder || self.WebKitBlobBuilder || self.MozBlobBuilder || self.MSBlobBuilder)();
                return n2.append(t2), n2.getBlob(r2);
              } catch (e3) {
                throw new Error("Bug : can't construct the Blob.");
              }
            }
          };
          var i = { stringifyByChunk: function(e2, t2, r2) {
            var n2 = [], i2 = 0, s2 = e2.length;
            if (s2 <= r2) return String.fromCharCode.apply(null, e2);
            for (; i2 < s2; ) "array" === t2 || "nodebuffer" === t2 ? n2.push(String.fromCharCode.apply(null, e2.slice(i2, Math.min(i2 + r2, s2)))) : n2.push(String.fromCharCode.apply(null, e2.subarray(i2, Math.min(i2 + r2, s2)))), i2 += r2;
            return n2.join("");
          }, stringifyByChar: function(e2) {
            for (var t2 = "", r2 = 0; r2 < e2.length; r2++) t2 += String.fromCharCode(e2[r2]);
            return t2;
          }, applyCanBeUsed: { uint8array: (function() {
            try {
              return o.uint8array && 1 === String.fromCharCode.apply(null, new Uint8Array(1)).length;
            } catch (e2) {
              return false;
            }
          })(), nodebuffer: (function() {
            try {
              return o.nodebuffer && 1 === String.fromCharCode.apply(null, r.allocBuffer(1)).length;
            } catch (e2) {
              return false;
            }
          })() } };
          function s(e2) {
            var t2 = 65536, r2 = a.getTypeOf(e2), n2 = true;
            if ("uint8array" === r2 ? n2 = i.applyCanBeUsed.uint8array : "nodebuffer" === r2 && (n2 = i.applyCanBeUsed.nodebuffer), n2) for (; 1 < t2; ) try {
              return i.stringifyByChunk(e2, r2, t2);
            } catch (e3) {
              t2 = Math.floor(t2 / 2);
            }
            return i.stringifyByChar(e2);
          }
          function f(e2, t2) {
            for (var r2 = 0; r2 < e2.length; r2++) t2[r2] = e2[r2];
            return t2;
          }
          a.applyFromCharCode = s;
          var c = {};
          c.string = { string: n, array: function(e2) {
            return l(e2, new Array(e2.length));
          }, arraybuffer: function(e2) {
            return c.string.uint8array(e2).buffer;
          }, uint8array: function(e2) {
            return l(e2, new Uint8Array(e2.length));
          }, nodebuffer: function(e2) {
            return l(e2, r.allocBuffer(e2.length));
          } }, c.array = { string: s, array: n, arraybuffer: function(e2) {
            return new Uint8Array(e2).buffer;
          }, uint8array: function(e2) {
            return new Uint8Array(e2);
          }, nodebuffer: function(e2) {
            return r.newBufferFrom(e2);
          } }, c.arraybuffer = { string: function(e2) {
            return s(new Uint8Array(e2));
          }, array: function(e2) {
            return f(new Uint8Array(e2), new Array(e2.byteLength));
          }, arraybuffer: n, uint8array: function(e2) {
            return new Uint8Array(e2);
          }, nodebuffer: function(e2) {
            return r.newBufferFrom(new Uint8Array(e2));
          } }, c.uint8array = { string: s, array: function(e2) {
            return f(e2, new Array(e2.length));
          }, arraybuffer: function(e2) {
            return e2.buffer;
          }, uint8array: n, nodebuffer: function(e2) {
            return r.newBufferFrom(e2);
          } }, c.nodebuffer = { string: s, array: function(e2) {
            return f(e2, new Array(e2.length));
          }, arraybuffer: function(e2) {
            return c.nodebuffer.uint8array(e2).buffer;
          }, uint8array: function(e2) {
            return f(e2, new Uint8Array(e2.length));
          }, nodebuffer: n }, a.transformTo = function(e2, t2) {
            if (t2 = t2 || "", !e2) return t2;
            a.checkSupport(e2);
            var r2 = a.getTypeOf(t2);
            return c[r2][e2](t2);
          }, a.resolve = function(e2) {
            for (var t2 = e2.split("/"), r2 = [], n2 = 0; n2 < t2.length; n2++) {
              var i2 = t2[n2];
              "." === i2 || "" === i2 && 0 !== n2 && n2 !== t2.length - 1 || (".." === i2 ? r2.pop() : r2.push(i2));
            }
            return r2.join("/");
          }, a.getTypeOf = function(e2) {
            return "string" == typeof e2 ? "string" : "[object Array]" === Object.prototype.toString.call(e2) ? "array" : o.nodebuffer && r.isBuffer(e2) ? "nodebuffer" : o.uint8array && e2 instanceof Uint8Array ? "uint8array" : o.arraybuffer && e2 instanceof ArrayBuffer ? "arraybuffer" : void 0;
          }, a.checkSupport = function(e2) {
            if (!o[e2.toLowerCase()]) throw new Error(e2 + " is not supported by this platform");
          }, a.MAX_VALUE_16BITS = 65535, a.MAX_VALUE_32BITS = -1, a.pretty = function(e2) {
            var t2, r2, n2 = "";
            for (r2 = 0; r2 < (e2 || "").length; r2++) n2 += "\\x" + ((t2 = e2.charCodeAt(r2)) < 16 ? "0" : "") + t2.toString(16).toUpperCase();
            return n2;
          }, a.delay = function(e2, t2, r2) {
            setImmediate(function() {
              e2.apply(r2 || null, t2 || []);
            });
          }, a.inherits = function(e2, t2) {
            function r2() {
            }
            r2.prototype = t2.prototype, e2.prototype = new r2();
          }, a.extend = function() {
            var e2, t2, r2 = {};
            for (e2 = 0; e2 < arguments.length; e2++) for (t2 in arguments[e2]) Object.prototype.hasOwnProperty.call(arguments[e2], t2) && void 0 === r2[t2] && (r2[t2] = arguments[e2][t2]);
            return r2;
          }, a.prepareContent = function(r2, e2, n2, i2, s2) {
            return u.Promise.resolve(e2).then(function(n3) {
              return o.blob && (n3 instanceof Blob || -1 !== ["[object File]", "[object Blob]"].indexOf(Object.prototype.toString.call(n3))) && "undefined" != typeof FileReader ? new u.Promise(function(t2, r3) {
                var e3 = new FileReader();
                e3.onload = function(e4) {
                  t2(e4.target.result);
                }, e3.onerror = function(e4) {
                  r3(e4.target.error);
                }, e3.readAsArrayBuffer(n3);
              }) : n3;
            }).then(function(e3) {
              var t2 = a.getTypeOf(e3);
              return t2 ? ("arraybuffer" === t2 ? e3 = a.transformTo("uint8array", e3) : "string" === t2 && (s2 ? e3 = h.decode(e3) : n2 && true !== i2 && (e3 = (function(e4) {
                return l(e4, o.uint8array ? new Uint8Array(e4.length) : new Array(e4.length));
              })(e3))), e3) : u.Promise.reject(new Error("Can't read the data of '" + r2 + "'. Is it in a supported JavaScript type (String, Blob, ArrayBuffer, etc) ?"));
            });
          };
        }, { "./base64": 1, "./external": 6, "./nodejsUtils": 14, "./support": 30, setimmediate: 54 }], 33: [function(e, t, r) {
          "use strict";
          var n = e("./reader/readerFor"), i = e("./utils"), s = e("./signature"), a = e("./zipEntry"), o = e("./support");
          function h(e2) {
            this.files = [], this.loadOptions = e2;
          }
          h.prototype = { checkSignature: function(e2) {
            if (!this.reader.readAndCheckSignature(e2)) {
              this.reader.index -= 4;
              var t2 = this.reader.readString(4);
              throw new Error("Corrupted zip or bug: unexpected signature (" + i.pretty(t2) + ", expected " + i.pretty(e2) + ")");
            }
          }, isSignature: function(e2, t2) {
            var r2 = this.reader.index;
            this.reader.setIndex(e2);
            var n2 = this.reader.readString(4) === t2;
            return this.reader.setIndex(r2), n2;
          }, readBlockEndOfCentral: function() {
            this.diskNumber = this.reader.readInt(2), this.diskWithCentralDirStart = this.reader.readInt(2), this.centralDirRecordsOnThisDisk = this.reader.readInt(2), this.centralDirRecords = this.reader.readInt(2), this.centralDirSize = this.reader.readInt(4), this.centralDirOffset = this.reader.readInt(4), this.zipCommentLength = this.reader.readInt(2);
            var e2 = this.reader.readData(this.zipCommentLength), t2 = o.uint8array ? "uint8array" : "array", r2 = i.transformTo(t2, e2);
            this.zipComment = this.loadOptions.decodeFileName(r2);
          }, readBlockZip64EndOfCentral: function() {
            this.zip64EndOfCentralSize = this.reader.readInt(8), this.reader.skip(4), this.diskNumber = this.reader.readInt(4), this.diskWithCentralDirStart = this.reader.readInt(4), this.centralDirRecordsOnThisDisk = this.reader.readInt(8), this.centralDirRecords = this.reader.readInt(8), this.centralDirSize = this.reader.readInt(8), this.centralDirOffset = this.reader.readInt(8), this.zip64ExtensibleData = {};
            for (var e2, t2, r2, n2 = this.zip64EndOfCentralSize - 44; 0 < n2; ) e2 = this.reader.readInt(2), t2 = this.reader.readInt(4), r2 = this.reader.readData(t2), this.zip64ExtensibleData[e2] = { id: e2, length: t2, value: r2 };
          }, readBlockZip64EndOfCentralLocator: function() {
            if (this.diskWithZip64CentralDirStart = this.reader.readInt(4), this.relativeOffsetEndOfZip64CentralDir = this.reader.readInt(8), this.disksCount = this.reader.readInt(4), 1 < this.disksCount) throw new Error("Multi-volumes zip are not supported");
          }, readLocalFiles: function() {
            var e2, t2;
            for (e2 = 0; e2 < this.files.length; e2++) t2 = this.files[e2], this.reader.setIndex(t2.localHeaderOffset), this.checkSignature(s.LOCAL_FILE_HEADER), t2.readLocalPart(this.reader), t2.handleUTF8(), t2.processAttributes();
          }, readCentralDir: function() {
            var e2;
            for (this.reader.setIndex(this.centralDirOffset); this.reader.readAndCheckSignature(s.CENTRAL_FILE_HEADER); ) (e2 = new a({ zip64: this.zip64 }, this.loadOptions)).readCentralPart(this.reader), this.files.push(e2);
            if (this.centralDirRecords !== this.files.length && 0 !== this.centralDirRecords && 0 === this.files.length) throw new Error("Corrupted zip or bug: expected " + this.centralDirRecords + " records in central dir, got " + this.files.length);
          }, readEndOfCentral: function() {
            var e2 = this.reader.lastIndexOfSignature(s.CENTRAL_DIRECTORY_END);
            if (e2 < 0) throw !this.isSignature(0, s.LOCAL_FILE_HEADER) ? new Error("Can't find end of central directory : is this a zip file ? If it is, see https://stuk.github.io/jszip/documentation/howto/read_zip.html") : new Error("Corrupted zip: can't find end of central directory");
            this.reader.setIndex(e2);
            var t2 = e2;
            if (this.checkSignature(s.CENTRAL_DIRECTORY_END), this.readBlockEndOfCentral(), this.diskNumber === i.MAX_VALUE_16BITS || this.diskWithCentralDirStart === i.MAX_VALUE_16BITS || this.centralDirRecordsOnThisDisk === i.MAX_VALUE_16BITS || this.centralDirRecords === i.MAX_VALUE_16BITS || this.centralDirSize === i.MAX_VALUE_32BITS || this.centralDirOffset === i.MAX_VALUE_32BITS) {
              if (this.zip64 = true, (e2 = this.reader.lastIndexOfSignature(s.ZIP64_CENTRAL_DIRECTORY_LOCATOR)) < 0) throw new Error("Corrupted zip: can't find the ZIP64 end of central directory locator");
              if (this.reader.setIndex(e2), this.checkSignature(s.ZIP64_CENTRAL_DIRECTORY_LOCATOR), this.readBlockZip64EndOfCentralLocator(), !this.isSignature(this.relativeOffsetEndOfZip64CentralDir, s.ZIP64_CENTRAL_DIRECTORY_END) && (this.relativeOffsetEndOfZip64CentralDir = this.reader.lastIndexOfSignature(s.ZIP64_CENTRAL_DIRECTORY_END), this.relativeOffsetEndOfZip64CentralDir < 0)) throw new Error("Corrupted zip: can't find the ZIP64 end of central directory");
              this.reader.setIndex(this.relativeOffsetEndOfZip64CentralDir), this.checkSignature(s.ZIP64_CENTRAL_DIRECTORY_END), this.readBlockZip64EndOfCentral();
            }
            var r2 = this.centralDirOffset + this.centralDirSize;
            this.zip64 && (r2 += 20, r2 += 12 + this.zip64EndOfCentralSize);
            var n2 = t2 - r2;
            if (0 < n2) this.isSignature(t2, s.CENTRAL_FILE_HEADER) || (this.reader.zero = n2);
            else if (n2 < 0) throw new Error("Corrupted zip: missing " + Math.abs(n2) + " bytes.");
          }, prepareReader: function(e2) {
            this.reader = n(e2);
          }, load: function(e2) {
            this.prepareReader(e2), this.readEndOfCentral(), this.readCentralDir(), this.readLocalFiles();
          } }, t.exports = h;
        }, { "./reader/readerFor": 22, "./signature": 23, "./support": 30, "./utils": 32, "./zipEntry": 34 }], 34: [function(e, t, r) {
          "use strict";
          var n = e("./reader/readerFor"), s = e("./utils"), i = e("./compressedObject"), a = e("./crc32"), o = e("./utf8"), h = e("./compressions"), u = e("./support");
          function l(e2, t2) {
            this.options = e2, this.loadOptions = t2;
          }
          l.prototype = { isEncrypted: function() {
            return 1 == (1 & this.bitFlag);
          }, useUTF8: function() {
            return 2048 == (2048 & this.bitFlag);
          }, readLocalPart: function(e2) {
            var t2, r2;
            if (e2.skip(22), this.fileNameLength = e2.readInt(2), r2 = e2.readInt(2), this.fileName = e2.readData(this.fileNameLength), e2.skip(r2), -1 === this.compressedSize || -1 === this.uncompressedSize) throw new Error("Bug or corrupted zip : didn't get enough information from the central directory (compressedSize === -1 || uncompressedSize === -1)");
            if (null === (t2 = (function(e3) {
              for (var t3 in h) if (Object.prototype.hasOwnProperty.call(h, t3) && h[t3].magic === e3) return h[t3];
              return null;
            })(this.compressionMethod))) throw new Error("Corrupted zip : compression " + s.pretty(this.compressionMethod) + " unknown (inner file : " + s.transformTo("string", this.fileName) + ")");
            this.decompressed = new i(this.compressedSize, this.uncompressedSize, this.crc32, t2, e2.readData(this.compressedSize));
          }, readCentralPart: function(e2) {
            this.versionMadeBy = e2.readInt(2), e2.skip(2), this.bitFlag = e2.readInt(2), this.compressionMethod = e2.readString(2), this.date = e2.readDate(), this.crc32 = e2.readInt(4), this.compressedSize = e2.readInt(4), this.uncompressedSize = e2.readInt(4);
            var t2 = e2.readInt(2);
            if (this.extraFieldsLength = e2.readInt(2), this.fileCommentLength = e2.readInt(2), this.diskNumberStart = e2.readInt(2), this.internalFileAttributes = e2.readInt(2), this.externalFileAttributes = e2.readInt(4), this.localHeaderOffset = e2.readInt(4), this.isEncrypted()) throw new Error("Encrypted zip are not supported");
            e2.skip(t2), this.readExtraFields(e2), this.parseZIP64ExtraField(e2), this.fileComment = e2.readData(this.fileCommentLength);
          }, processAttributes: function() {
            this.unixPermissions = null, this.dosPermissions = null;
            var e2 = this.versionMadeBy >> 8;
            this.dir = !!(16 & this.externalFileAttributes), 0 == e2 && (this.dosPermissions = 63 & this.externalFileAttributes), 3 == e2 && (this.unixPermissions = this.externalFileAttributes >> 16 & 65535), this.dir || "/" !== this.fileNameStr.slice(-1) || (this.dir = true);
          }, parseZIP64ExtraField: function() {
            if (this.extraFields[1]) {
              var e2 = n(this.extraFields[1].value);
              this.uncompressedSize === s.MAX_VALUE_32BITS && (this.uncompressedSize = e2.readInt(8)), this.compressedSize === s.MAX_VALUE_32BITS && (this.compressedSize = e2.readInt(8)), this.localHeaderOffset === s.MAX_VALUE_32BITS && (this.localHeaderOffset = e2.readInt(8)), this.diskNumberStart === s.MAX_VALUE_32BITS && (this.diskNumberStart = e2.readInt(4));
            }
          }, readExtraFields: function(e2) {
            var t2, r2, n2, i2 = e2.index + this.extraFieldsLength;
            for (this.extraFields || (this.extraFields = {}); e2.index + 4 < i2; ) t2 = e2.readInt(2), r2 = e2.readInt(2), n2 = e2.readData(r2), this.extraFields[t2] = { id: t2, length: r2, value: n2 };
            e2.setIndex(i2);
          }, handleUTF8: function() {
            var e2 = u.uint8array ? "uint8array" : "array";
            if (this.useUTF8()) this.fileNameStr = o.utf8decode(this.fileName), this.fileCommentStr = o.utf8decode(this.fileComment);
            else {
              var t2 = this.findExtraFieldUnicodePath();
              if (null !== t2) this.fileNameStr = t2;
              else {
                var r2 = s.transformTo(e2, this.fileName);
                this.fileNameStr = this.loadOptions.decodeFileName(r2);
              }
              var n2 = this.findExtraFieldUnicodeComment();
              if (null !== n2) this.fileCommentStr = n2;
              else {
                var i2 = s.transformTo(e2, this.fileComment);
                this.fileCommentStr = this.loadOptions.decodeFileName(i2);
              }
            }
          }, findExtraFieldUnicodePath: function() {
            var e2 = this.extraFields[28789];
            if (e2) {
              var t2 = n(e2.value);
              return 1 !== t2.readInt(1) ? null : a(this.fileName) !== t2.readInt(4) ? null : o.utf8decode(t2.readData(e2.length - 5));
            }
            return null;
          }, findExtraFieldUnicodeComment: function() {
            var e2 = this.extraFields[25461];
            if (e2) {
              var t2 = n(e2.value);
              return 1 !== t2.readInt(1) ? null : a(this.fileComment) !== t2.readInt(4) ? null : o.utf8decode(t2.readData(e2.length - 5));
            }
            return null;
          } }, t.exports = l;
        }, { "./compressedObject": 2, "./compressions": 3, "./crc32": 4, "./reader/readerFor": 22, "./support": 30, "./utf8": 31, "./utils": 32 }], 35: [function(e, t, r) {
          "use strict";
          function n(e2, t2, r2) {
            this.name = e2, this.dir = r2.dir, this.date = r2.date, this.comment = r2.comment, this.unixPermissions = r2.unixPermissions, this.dosPermissions = r2.dosPermissions, this._data = t2, this._dataBinary = r2.binary, this.options = { compression: r2.compression, compressionOptions: r2.compressionOptions };
          }
          var s = e("./stream/StreamHelper"), i = e("./stream/DataWorker"), a = e("./utf8"), o = e("./compressedObject"), h = e("./stream/GenericWorker");
          n.prototype = { internalStream: function(e2) {
            var t2 = null, r2 = "string";
            try {
              if (!e2) throw new Error("No output type specified.");
              var n2 = "string" === (r2 = e2.toLowerCase()) || "text" === r2;
              "binarystring" !== r2 && "text" !== r2 || (r2 = "string"), t2 = this._decompressWorker();
              var i2 = !this._dataBinary;
              i2 && !n2 && (t2 = t2.pipe(new a.Utf8EncodeWorker())), !i2 && n2 && (t2 = t2.pipe(new a.Utf8DecodeWorker()));
            } catch (e3) {
              (t2 = new h("error")).error(e3);
            }
            return new s(t2, r2, "");
          }, async: function(e2, t2) {
            return this.internalStream(e2).accumulate(t2);
          }, nodeStream: function(e2, t2) {
            return this.internalStream(e2 || "nodebuffer").toNodejsStream(t2);
          }, _compressWorker: function(e2, t2) {
            if (this._data instanceof o && this._data.compression.magic === e2.magic) return this._data.getCompressedWorker();
            var r2 = this._decompressWorker();
            return this._dataBinary || (r2 = r2.pipe(new a.Utf8EncodeWorker())), o.createWorkerFrom(r2, e2, t2);
          }, _decompressWorker: function() {
            return this._data instanceof o ? this._data.getContentWorker() : this._data instanceof h ? this._data : new i(this._data);
          } };
          for (var u = ["asText", "asBinary", "asNodeBuffer", "asUint8Array", "asArrayBuffer"], l = function() {
            throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.");
          }, f = 0; f < u.length; f++) n.prototype[u[f]] = l;
          t.exports = n;
        }, { "./compressedObject": 2, "./stream/DataWorker": 27, "./stream/GenericWorker": 28, "./stream/StreamHelper": 29, "./utf8": 31 }], 36: [function(e, l, t) {
          (function(t2) {
            "use strict";
            var r, n, e2 = t2.MutationObserver || t2.WebKitMutationObserver;
            if (e2) {
              var i = 0, s = new e2(u), a = t2.document.createTextNode("");
              s.observe(a, { characterData: true }), r = function() {
                a.data = i = ++i % 2;
              };
            } else if (t2.setImmediate || void 0 === t2.MessageChannel) r = "document" in t2 && "onreadystatechange" in t2.document.createElement("script") ? function() {
              var e3 = t2.document.createElement("script");
              e3.onreadystatechange = function() {
                u(), e3.onreadystatechange = null, e3.parentNode.removeChild(e3), e3 = null;
              }, t2.document.documentElement.appendChild(e3);
            } : function() {
              setTimeout(u, 0);
            };
            else {
              var o = new t2.MessageChannel();
              o.port1.onmessage = u, r = function() {
                o.port2.postMessage(0);
              };
            }
            var h = [];
            function u() {
              var e3, t3;
              n = true;
              for (var r2 = h.length; r2; ) {
                for (t3 = h, h = [], e3 = -1; ++e3 < r2; ) t3[e3]();
                r2 = h.length;
              }
              n = false;
            }
            l.exports = function(e3) {
              1 !== h.push(e3) || n || r();
            };
          }).call(this, "undefined" != typeof globalThis ? globalThis : "undefined" != typeof self ? self : "undefined" != typeof window ? window : {});
        }, {}], 37: [function(e, t, r) {
          "use strict";
          var i = e("immediate");
          function u() {
          }
          var l = {}, s = ["REJECTED"], a = ["FULFILLED"], n = ["PENDING"];
          function o(e2) {
            if ("function" != typeof e2) throw new TypeError("resolver must be a function");
            this.state = n, this.queue = [], this.outcome = void 0, e2 !== u && d(this, e2);
          }
          function h(e2, t2, r2) {
            this.promise = e2, "function" == typeof t2 && (this.onFulfilled = t2, this.callFulfilled = this.otherCallFulfilled), "function" == typeof r2 && (this.onRejected = r2, this.callRejected = this.otherCallRejected);
          }
          function f(t2, r2, n2) {
            i(function() {
              var e2;
              try {
                e2 = r2(n2);
              } catch (e3) {
                return l.reject(t2, e3);
              }
              e2 === t2 ? l.reject(t2, new TypeError("Cannot resolve promise with itself")) : l.resolve(t2, e2);
            });
          }
          function c(e2) {
            var t2 = e2 && e2.then;
            if (e2 && ("object" == typeof e2 || "function" == typeof e2) && "function" == typeof t2) return function() {
              t2.apply(e2, arguments);
            };
          }
          function d(t2, e2) {
            var r2 = false;
            function n2(e3) {
              r2 || (r2 = true, l.reject(t2, e3));
            }
            function i2(e3) {
              r2 || (r2 = true, l.resolve(t2, e3));
            }
            var s2 = p(function() {
              e2(i2, n2);
            });
            "error" === s2.status && n2(s2.value);
          }
          function p(e2, t2) {
            var r2 = {};
            try {
              r2.value = e2(t2), r2.status = "success";
            } catch (e3) {
              r2.status = "error", r2.value = e3;
            }
            return r2;
          }
          (t.exports = o).prototype.finally = function(t2) {
            if ("function" != typeof t2) return this;
            var r2 = this.constructor;
            return this.then(function(e2) {
              return r2.resolve(t2()).then(function() {
                return e2;
              });
            }, function(e2) {
              return r2.resolve(t2()).then(function() {
                throw e2;
              });
            });
          }, o.prototype.catch = function(e2) {
            return this.then(null, e2);
          }, o.prototype.then = function(e2, t2) {
            if ("function" != typeof e2 && this.state === a || "function" != typeof t2 && this.state === s) return this;
            var r2 = new this.constructor(u);
            this.state !== n ? f(r2, this.state === a ? e2 : t2, this.outcome) : this.queue.push(new h(r2, e2, t2));
            return r2;
          }, h.prototype.callFulfilled = function(e2) {
            l.resolve(this.promise, e2);
          }, h.prototype.otherCallFulfilled = function(e2) {
            f(this.promise, this.onFulfilled, e2);
          }, h.prototype.callRejected = function(e2) {
            l.reject(this.promise, e2);
          }, h.prototype.otherCallRejected = function(e2) {
            f(this.promise, this.onRejected, e2);
          }, l.resolve = function(e2, t2) {
            var r2 = p(c, t2);
            if ("error" === r2.status) return l.reject(e2, r2.value);
            var n2 = r2.value;
            if (n2) d(e2, n2);
            else {
              e2.state = a, e2.outcome = t2;
              for (var i2 = -1, s2 = e2.queue.length; ++i2 < s2; ) e2.queue[i2].callFulfilled(t2);
            }
            return e2;
          }, l.reject = function(e2, t2) {
            e2.state = s, e2.outcome = t2;
            for (var r2 = -1, n2 = e2.queue.length; ++r2 < n2; ) e2.queue[r2].callRejected(t2);
            return e2;
          }, o.resolve = function(e2) {
            if (e2 instanceof this) return e2;
            return l.resolve(new this(u), e2);
          }, o.reject = function(e2) {
            var t2 = new this(u);
            return l.reject(t2, e2);
          }, o.all = function(e2) {
            var r2 = this;
            if ("[object Array]" !== Object.prototype.toString.call(e2)) return this.reject(new TypeError("must be an array"));
            var n2 = e2.length, i2 = false;
            if (!n2) return this.resolve([]);
            var s2 = new Array(n2), a2 = 0, t2 = -1, o2 = new this(u);
            for (; ++t2 < n2; ) h2(e2[t2], t2);
            return o2;
            function h2(e3, t3) {
              r2.resolve(e3).then(function(e4) {
                s2[t3] = e4, ++a2 !== n2 || i2 || (i2 = true, l.resolve(o2, s2));
              }, function(e4) {
                i2 || (i2 = true, l.reject(o2, e4));
              });
            }
          }, o.race = function(e2) {
            var t2 = this;
            if ("[object Array]" !== Object.prototype.toString.call(e2)) return this.reject(new TypeError("must be an array"));
            var r2 = e2.length, n2 = false;
            if (!r2) return this.resolve([]);
            var i2 = -1, s2 = new this(u);
            for (; ++i2 < r2; ) a2 = e2[i2], t2.resolve(a2).then(function(e3) {
              n2 || (n2 = true, l.resolve(s2, e3));
            }, function(e3) {
              n2 || (n2 = true, l.reject(s2, e3));
            });
            var a2;
            return s2;
          };
        }, { immediate: 36 }], 38: [function(e, t, r) {
          "use strict";
          var n = {};
          (0, e("./lib/utils/common").assign)(n, e("./lib/deflate"), e("./lib/inflate"), e("./lib/zlib/constants")), t.exports = n;
        }, { "./lib/deflate": 39, "./lib/inflate": 40, "./lib/utils/common": 41, "./lib/zlib/constants": 44 }], 39: [function(e, t, r) {
          "use strict";
          var a = e("./zlib/deflate"), o = e("./utils/common"), h = e("./utils/strings"), i = e("./zlib/messages"), s = e("./zlib/zstream"), u = Object.prototype.toString, l = 0, f = -1, c = 0, d = 8;
          function p(e2) {
            if (!(this instanceof p)) return new p(e2);
            this.options = o.assign({ level: f, method: d, chunkSize: 16384, windowBits: 15, memLevel: 8, strategy: c, to: "" }, e2 || {});
            var t2 = this.options;
            t2.raw && 0 < t2.windowBits ? t2.windowBits = -t2.windowBits : t2.gzip && 0 < t2.windowBits && t2.windowBits < 16 && (t2.windowBits += 16), this.err = 0, this.msg = "", this.ended = false, this.chunks = [], this.strm = new s(), this.strm.avail_out = 0;
            var r2 = a.deflateInit2(this.strm, t2.level, t2.method, t2.windowBits, t2.memLevel, t2.strategy);
            if (r2 !== l) throw new Error(i[r2]);
            if (t2.header && a.deflateSetHeader(this.strm, t2.header), t2.dictionary) {
              var n2;
              if (n2 = "string" == typeof t2.dictionary ? h.string2buf(t2.dictionary) : "[object ArrayBuffer]" === u.call(t2.dictionary) ? new Uint8Array(t2.dictionary) : t2.dictionary, (r2 = a.deflateSetDictionary(this.strm, n2)) !== l) throw new Error(i[r2]);
              this._dict_set = true;
            }
          }
          function n(e2, t2) {
            var r2 = new p(t2);
            if (r2.push(e2, true), r2.err) throw r2.msg || i[r2.err];
            return r2.result;
          }
          p.prototype.push = function(e2, t2) {
            var r2, n2, i2 = this.strm, s2 = this.options.chunkSize;
            if (this.ended) return false;
            n2 = t2 === ~~t2 ? t2 : true === t2 ? 4 : 0, "string" == typeof e2 ? i2.input = h.string2buf(e2) : "[object ArrayBuffer]" === u.call(e2) ? i2.input = new Uint8Array(e2) : i2.input = e2, i2.next_in = 0, i2.avail_in = i2.input.length;
            do {
              if (0 === i2.avail_out && (i2.output = new o.Buf8(s2), i2.next_out = 0, i2.avail_out = s2), 1 !== (r2 = a.deflate(i2, n2)) && r2 !== l) return this.onEnd(r2), !(this.ended = true);
              0 !== i2.avail_out && (0 !== i2.avail_in || 4 !== n2 && 2 !== n2) || ("string" === this.options.to ? this.onData(h.buf2binstring(o.shrinkBuf(i2.output, i2.next_out))) : this.onData(o.shrinkBuf(i2.output, i2.next_out)));
            } while ((0 < i2.avail_in || 0 === i2.avail_out) && 1 !== r2);
            return 4 === n2 ? (r2 = a.deflateEnd(this.strm), this.onEnd(r2), this.ended = true, r2 === l) : 2 !== n2 || (this.onEnd(l), !(i2.avail_out = 0));
          }, p.prototype.onData = function(e2) {
            this.chunks.push(e2);
          }, p.prototype.onEnd = function(e2) {
            e2 === l && ("string" === this.options.to ? this.result = this.chunks.join("") : this.result = o.flattenChunks(this.chunks)), this.chunks = [], this.err = e2, this.msg = this.strm.msg;
          }, r.Deflate = p, r.deflate = n, r.deflateRaw = function(e2, t2) {
            return (t2 = t2 || {}).raw = true, n(e2, t2);
          }, r.gzip = function(e2, t2) {
            return (t2 = t2 || {}).gzip = true, n(e2, t2);
          };
        }, { "./utils/common": 41, "./utils/strings": 42, "./zlib/deflate": 46, "./zlib/messages": 51, "./zlib/zstream": 53 }], 40: [function(e, t, r) {
          "use strict";
          var c = e("./zlib/inflate"), d = e("./utils/common"), p = e("./utils/strings"), m = e("./zlib/constants"), n = e("./zlib/messages"), i = e("./zlib/zstream"), s = e("./zlib/gzheader"), _ = Object.prototype.toString;
          function a(e2) {
            if (!(this instanceof a)) return new a(e2);
            this.options = d.assign({ chunkSize: 16384, windowBits: 0, to: "" }, e2 || {});
            var t2 = this.options;
            t2.raw && 0 <= t2.windowBits && t2.windowBits < 16 && (t2.windowBits = -t2.windowBits, 0 === t2.windowBits && (t2.windowBits = -15)), !(0 <= t2.windowBits && t2.windowBits < 16) || e2 && e2.windowBits || (t2.windowBits += 32), 15 < t2.windowBits && t2.windowBits < 48 && 0 == (15 & t2.windowBits) && (t2.windowBits |= 15), this.err = 0, this.msg = "", this.ended = false, this.chunks = [], this.strm = new i(), this.strm.avail_out = 0;
            var r2 = c.inflateInit2(this.strm, t2.windowBits);
            if (r2 !== m.Z_OK) throw new Error(n[r2]);
            this.header = new s(), c.inflateGetHeader(this.strm, this.header);
          }
          function o(e2, t2) {
            var r2 = new a(t2);
            if (r2.push(e2, true), r2.err) throw r2.msg || n[r2.err];
            return r2.result;
          }
          a.prototype.push = function(e2, t2) {
            var r2, n2, i2, s2, a2, o2, h = this.strm, u = this.options.chunkSize, l = this.options.dictionary, f = false;
            if (this.ended) return false;
            n2 = t2 === ~~t2 ? t2 : true === t2 ? m.Z_FINISH : m.Z_NO_FLUSH, "string" == typeof e2 ? h.input = p.binstring2buf(e2) : "[object ArrayBuffer]" === _.call(e2) ? h.input = new Uint8Array(e2) : h.input = e2, h.next_in = 0, h.avail_in = h.input.length;
            do {
              if (0 === h.avail_out && (h.output = new d.Buf8(u), h.next_out = 0, h.avail_out = u), (r2 = c.inflate(h, m.Z_NO_FLUSH)) === m.Z_NEED_DICT && l && (o2 = "string" == typeof l ? p.string2buf(l) : "[object ArrayBuffer]" === _.call(l) ? new Uint8Array(l) : l, r2 = c.inflateSetDictionary(this.strm, o2)), r2 === m.Z_BUF_ERROR && true === f && (r2 = m.Z_OK, f = false), r2 !== m.Z_STREAM_END && r2 !== m.Z_OK) return this.onEnd(r2), !(this.ended = true);
              h.next_out && (0 !== h.avail_out && r2 !== m.Z_STREAM_END && (0 !== h.avail_in || n2 !== m.Z_FINISH && n2 !== m.Z_SYNC_FLUSH) || ("string" === this.options.to ? (i2 = p.utf8border(h.output, h.next_out), s2 = h.next_out - i2, a2 = p.buf2string(h.output, i2), h.next_out = s2, h.avail_out = u - s2, s2 && d.arraySet(h.output, h.output, i2, s2, 0), this.onData(a2)) : this.onData(d.shrinkBuf(h.output, h.next_out)))), 0 === h.avail_in && 0 === h.avail_out && (f = true);
            } while ((0 < h.avail_in || 0 === h.avail_out) && r2 !== m.Z_STREAM_END);
            return r2 === m.Z_STREAM_END && (n2 = m.Z_FINISH), n2 === m.Z_FINISH ? (r2 = c.inflateEnd(this.strm), this.onEnd(r2), this.ended = true, r2 === m.Z_OK) : n2 !== m.Z_SYNC_FLUSH || (this.onEnd(m.Z_OK), !(h.avail_out = 0));
          }, a.prototype.onData = function(e2) {
            this.chunks.push(e2);
          }, a.prototype.onEnd = function(e2) {
            e2 === m.Z_OK && ("string" === this.options.to ? this.result = this.chunks.join("") : this.result = d.flattenChunks(this.chunks)), this.chunks = [], this.err = e2, this.msg = this.strm.msg;
          }, r.Inflate = a, r.inflate = o, r.inflateRaw = function(e2, t2) {
            return (t2 = t2 || {}).raw = true, o(e2, t2);
          }, r.ungzip = o;
        }, { "./utils/common": 41, "./utils/strings": 42, "./zlib/constants": 44, "./zlib/gzheader": 47, "./zlib/inflate": 49, "./zlib/messages": 51, "./zlib/zstream": 53 }], 41: [function(e, t, r) {
          "use strict";
          var n = "undefined" != typeof Uint8Array && "undefined" != typeof Uint16Array && "undefined" != typeof Int32Array;
          r.assign = function(e2) {
            for (var t2 = Array.prototype.slice.call(arguments, 1); t2.length; ) {
              var r2 = t2.shift();
              if (r2) {
                if ("object" != typeof r2) throw new TypeError(r2 + "must be non-object");
                for (var n2 in r2) r2.hasOwnProperty(n2) && (e2[n2] = r2[n2]);
              }
            }
            return e2;
          }, r.shrinkBuf = function(e2, t2) {
            return e2.length === t2 ? e2 : e2.subarray ? e2.subarray(0, t2) : (e2.length = t2, e2);
          };
          var i = { arraySet: function(e2, t2, r2, n2, i2) {
            if (t2.subarray && e2.subarray) e2.set(t2.subarray(r2, r2 + n2), i2);
            else for (var s2 = 0; s2 < n2; s2++) e2[i2 + s2] = t2[r2 + s2];
          }, flattenChunks: function(e2) {
            var t2, r2, n2, i2, s2, a;
            for (t2 = n2 = 0, r2 = e2.length; t2 < r2; t2++) n2 += e2[t2].length;
            for (a = new Uint8Array(n2), t2 = i2 = 0, r2 = e2.length; t2 < r2; t2++) s2 = e2[t2], a.set(s2, i2), i2 += s2.length;
            return a;
          } }, s = { arraySet: function(e2, t2, r2, n2, i2) {
            for (var s2 = 0; s2 < n2; s2++) e2[i2 + s2] = t2[r2 + s2];
          }, flattenChunks: function(e2) {
            return [].concat.apply([], e2);
          } };
          r.setTyped = function(e2) {
            e2 ? (r.Buf8 = Uint8Array, r.Buf16 = Uint16Array, r.Buf32 = Int32Array, r.assign(r, i)) : (r.Buf8 = Array, r.Buf16 = Array, r.Buf32 = Array, r.assign(r, s));
          }, r.setTyped(n);
        }, {}], 42: [function(e, t, r) {
          "use strict";
          var h = e("./common"), i = true, s = true;
          try {
            String.fromCharCode.apply(null, [0]);
          } catch (e2) {
            i = false;
          }
          try {
            String.fromCharCode.apply(null, new Uint8Array(1));
          } catch (e2) {
            s = false;
          }
          for (var u = new h.Buf8(256), n = 0; n < 256; n++) u[n] = 252 <= n ? 6 : 248 <= n ? 5 : 240 <= n ? 4 : 224 <= n ? 3 : 192 <= n ? 2 : 1;
          function l(e2, t2) {
            if (t2 < 65537 && (e2.subarray && s || !e2.subarray && i)) return String.fromCharCode.apply(null, h.shrinkBuf(e2, t2));
            for (var r2 = "", n2 = 0; n2 < t2; n2++) r2 += String.fromCharCode(e2[n2]);
            return r2;
          }
          u[254] = u[254] = 1, r.string2buf = function(e2) {
            var t2, r2, n2, i2, s2, a = e2.length, o = 0;
            for (i2 = 0; i2 < a; i2++) 55296 == (64512 & (r2 = e2.charCodeAt(i2))) && i2 + 1 < a && 56320 == (64512 & (n2 = e2.charCodeAt(i2 + 1))) && (r2 = 65536 + (r2 - 55296 << 10) + (n2 - 56320), i2++), o += r2 < 128 ? 1 : r2 < 2048 ? 2 : r2 < 65536 ? 3 : 4;
            for (t2 = new h.Buf8(o), i2 = s2 = 0; s2 < o; i2++) 55296 == (64512 & (r2 = e2.charCodeAt(i2))) && i2 + 1 < a && 56320 == (64512 & (n2 = e2.charCodeAt(i2 + 1))) && (r2 = 65536 + (r2 - 55296 << 10) + (n2 - 56320), i2++), r2 < 128 ? t2[s2++] = r2 : (r2 < 2048 ? t2[s2++] = 192 | r2 >>> 6 : (r2 < 65536 ? t2[s2++] = 224 | r2 >>> 12 : (t2[s2++] = 240 | r2 >>> 18, t2[s2++] = 128 | r2 >>> 12 & 63), t2[s2++] = 128 | r2 >>> 6 & 63), t2[s2++] = 128 | 63 & r2);
            return t2;
          }, r.buf2binstring = function(e2) {
            return l(e2, e2.length);
          }, r.binstring2buf = function(e2) {
            for (var t2 = new h.Buf8(e2.length), r2 = 0, n2 = t2.length; r2 < n2; r2++) t2[r2] = e2.charCodeAt(r2);
            return t2;
          }, r.buf2string = function(e2, t2) {
            var r2, n2, i2, s2, a = t2 || e2.length, o = new Array(2 * a);
            for (r2 = n2 = 0; r2 < a; ) if ((i2 = e2[r2++]) < 128) o[n2++] = i2;
            else if (4 < (s2 = u[i2])) o[n2++] = 65533, r2 += s2 - 1;
            else {
              for (i2 &= 2 === s2 ? 31 : 3 === s2 ? 15 : 7; 1 < s2 && r2 < a; ) i2 = i2 << 6 | 63 & e2[r2++], s2--;
              1 < s2 ? o[n2++] = 65533 : i2 < 65536 ? o[n2++] = i2 : (i2 -= 65536, o[n2++] = 55296 | i2 >> 10 & 1023, o[n2++] = 56320 | 1023 & i2);
            }
            return l(o, n2);
          }, r.utf8border = function(e2, t2) {
            var r2;
            for ((t2 = t2 || e2.length) > e2.length && (t2 = e2.length), r2 = t2 - 1; 0 <= r2 && 128 == (192 & e2[r2]); ) r2--;
            return r2 < 0 ? t2 : 0 === r2 ? t2 : r2 + u[e2[r2]] > t2 ? r2 : t2;
          };
        }, { "./common": 41 }], 43: [function(e, t, r) {
          "use strict";
          t.exports = function(e2, t2, r2, n) {
            for (var i = 65535 & e2 | 0, s = e2 >>> 16 & 65535 | 0, a = 0; 0 !== r2; ) {
              for (r2 -= a = 2e3 < r2 ? 2e3 : r2; s = s + (i = i + t2[n++] | 0) | 0, --a; ) ;
              i %= 65521, s %= 65521;
            }
            return i | s << 16 | 0;
          };
        }, {}], 44: [function(e, t, r) {
          "use strict";
          t.exports = { Z_NO_FLUSH: 0, Z_PARTIAL_FLUSH: 1, Z_SYNC_FLUSH: 2, Z_FULL_FLUSH: 3, Z_FINISH: 4, Z_BLOCK: 5, Z_TREES: 6, Z_OK: 0, Z_STREAM_END: 1, Z_NEED_DICT: 2, Z_ERRNO: -1, Z_STREAM_ERROR: -2, Z_DATA_ERROR: -3, Z_BUF_ERROR: -5, Z_NO_COMPRESSION: 0, Z_BEST_SPEED: 1, Z_BEST_COMPRESSION: 9, Z_DEFAULT_COMPRESSION: -1, Z_FILTERED: 1, Z_HUFFMAN_ONLY: 2, Z_RLE: 3, Z_FIXED: 4, Z_DEFAULT_STRATEGY: 0, Z_BINARY: 0, Z_TEXT: 1, Z_UNKNOWN: 2, Z_DEFLATED: 8 };
        }, {}], 45: [function(e, t, r) {
          "use strict";
          var o = (function() {
            for (var e2, t2 = [], r2 = 0; r2 < 256; r2++) {
              e2 = r2;
              for (var n = 0; n < 8; n++) e2 = 1 & e2 ? 3988292384 ^ e2 >>> 1 : e2 >>> 1;
              t2[r2] = e2;
            }
            return t2;
          })();
          t.exports = function(e2, t2, r2, n) {
            var i = o, s = n + r2;
            e2 ^= -1;
            for (var a = n; a < s; a++) e2 = e2 >>> 8 ^ i[255 & (e2 ^ t2[a])];
            return -1 ^ e2;
          };
        }, {}], 46: [function(e, t, r) {
          "use strict";
          var h, c = e("../utils/common"), u = e("./trees"), d = e("./adler32"), p = e("./crc32"), n = e("./messages"), l = 0, f = 4, m = 0, _ = -2, g = -1, b = 4, i = 2, v = 8, y = 9, s = 286, a = 30, o = 19, w = 2 * s + 1, k = 15, x = 3, S = 258, z = S + x + 1, C = 42, E = 113, A = 1, I = 2, O = 3, B = 4;
          function R(e2, t2) {
            return e2.msg = n[t2], t2;
          }
          function T(e2) {
            return (e2 << 1) - (4 < e2 ? 9 : 0);
          }
          function D(e2) {
            for (var t2 = e2.length; 0 <= --t2; ) e2[t2] = 0;
          }
          function F(e2) {
            var t2 = e2.state, r2 = t2.pending;
            r2 > e2.avail_out && (r2 = e2.avail_out), 0 !== r2 && (c.arraySet(e2.output, t2.pending_buf, t2.pending_out, r2, e2.next_out), e2.next_out += r2, t2.pending_out += r2, e2.total_out += r2, e2.avail_out -= r2, t2.pending -= r2, 0 === t2.pending && (t2.pending_out = 0));
          }
          function N(e2, t2) {
            u._tr_flush_block(e2, 0 <= e2.block_start ? e2.block_start : -1, e2.strstart - e2.block_start, t2), e2.block_start = e2.strstart, F(e2.strm);
          }
          function U(e2, t2) {
            e2.pending_buf[e2.pending++] = t2;
          }
          function P(e2, t2) {
            e2.pending_buf[e2.pending++] = t2 >>> 8 & 255, e2.pending_buf[e2.pending++] = 255 & t2;
          }
          function L(e2, t2) {
            var r2, n2, i2 = e2.max_chain_length, s2 = e2.strstart, a2 = e2.prev_length, o2 = e2.nice_match, h2 = e2.strstart > e2.w_size - z ? e2.strstart - (e2.w_size - z) : 0, u2 = e2.window, l2 = e2.w_mask, f2 = e2.prev, c2 = e2.strstart + S, d2 = u2[s2 + a2 - 1], p2 = u2[s2 + a2];
            e2.prev_length >= e2.good_match && (i2 >>= 2), o2 > e2.lookahead && (o2 = e2.lookahead);
            do {
              if (u2[(r2 = t2) + a2] === p2 && u2[r2 + a2 - 1] === d2 && u2[r2] === u2[s2] && u2[++r2] === u2[s2 + 1]) {
                s2 += 2, r2++;
                do {
                } while (u2[++s2] === u2[++r2] && u2[++s2] === u2[++r2] && u2[++s2] === u2[++r2] && u2[++s2] === u2[++r2] && u2[++s2] === u2[++r2] && u2[++s2] === u2[++r2] && u2[++s2] === u2[++r2] && u2[++s2] === u2[++r2] && s2 < c2);
                if (n2 = S - (c2 - s2), s2 = c2 - S, a2 < n2) {
                  if (e2.match_start = t2, o2 <= (a2 = n2)) break;
                  d2 = u2[s2 + a2 - 1], p2 = u2[s2 + a2];
                }
              }
            } while ((t2 = f2[t2 & l2]) > h2 && 0 != --i2);
            return a2 <= e2.lookahead ? a2 : e2.lookahead;
          }
          function j(e2) {
            var t2, r2, n2, i2, s2, a2, o2, h2, u2, l2, f2 = e2.w_size;
            do {
              if (i2 = e2.window_size - e2.lookahead - e2.strstart, e2.strstart >= f2 + (f2 - z)) {
                for (c.arraySet(e2.window, e2.window, f2, f2, 0), e2.match_start -= f2, e2.strstart -= f2, e2.block_start -= f2, t2 = r2 = e2.hash_size; n2 = e2.head[--t2], e2.head[t2] = f2 <= n2 ? n2 - f2 : 0, --r2; ) ;
                for (t2 = r2 = f2; n2 = e2.prev[--t2], e2.prev[t2] = f2 <= n2 ? n2 - f2 : 0, --r2; ) ;
                i2 += f2;
              }
              if (0 === e2.strm.avail_in) break;
              if (a2 = e2.strm, o2 = e2.window, h2 = e2.strstart + e2.lookahead, u2 = i2, l2 = void 0, l2 = a2.avail_in, u2 < l2 && (l2 = u2), r2 = 0 === l2 ? 0 : (a2.avail_in -= l2, c.arraySet(o2, a2.input, a2.next_in, l2, h2), 1 === a2.state.wrap ? a2.adler = d(a2.adler, o2, l2, h2) : 2 === a2.state.wrap && (a2.adler = p(a2.adler, o2, l2, h2)), a2.next_in += l2, a2.total_in += l2, l2), e2.lookahead += r2, e2.lookahead + e2.insert >= x) for (s2 = e2.strstart - e2.insert, e2.ins_h = e2.window[s2], e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[s2 + 1]) & e2.hash_mask; e2.insert && (e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[s2 + x - 1]) & e2.hash_mask, e2.prev[s2 & e2.w_mask] = e2.head[e2.ins_h], e2.head[e2.ins_h] = s2, s2++, e2.insert--, !(e2.lookahead + e2.insert < x)); ) ;
            } while (e2.lookahead < z && 0 !== e2.strm.avail_in);
          }
          function Z(e2, t2) {
            for (var r2, n2; ; ) {
              if (e2.lookahead < z) {
                if (j(e2), e2.lookahead < z && t2 === l) return A;
                if (0 === e2.lookahead) break;
              }
              if (r2 = 0, e2.lookahead >= x && (e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[e2.strstart + x - 1]) & e2.hash_mask, r2 = e2.prev[e2.strstart & e2.w_mask] = e2.head[e2.ins_h], e2.head[e2.ins_h] = e2.strstart), 0 !== r2 && e2.strstart - r2 <= e2.w_size - z && (e2.match_length = L(e2, r2)), e2.match_length >= x) if (n2 = u._tr_tally(e2, e2.strstart - e2.match_start, e2.match_length - x), e2.lookahead -= e2.match_length, e2.match_length <= e2.max_lazy_match && e2.lookahead >= x) {
                for (e2.match_length--; e2.strstart++, e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[e2.strstart + x - 1]) & e2.hash_mask, r2 = e2.prev[e2.strstart & e2.w_mask] = e2.head[e2.ins_h], e2.head[e2.ins_h] = e2.strstart, 0 != --e2.match_length; ) ;
                e2.strstart++;
              } else e2.strstart += e2.match_length, e2.match_length = 0, e2.ins_h = e2.window[e2.strstart], e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[e2.strstart + 1]) & e2.hash_mask;
              else n2 = u._tr_tally(e2, 0, e2.window[e2.strstart]), e2.lookahead--, e2.strstart++;
              if (n2 && (N(e2, false), 0 === e2.strm.avail_out)) return A;
            }
            return e2.insert = e2.strstart < x - 1 ? e2.strstart : x - 1, t2 === f ? (N(e2, true), 0 === e2.strm.avail_out ? O : B) : e2.last_lit && (N(e2, false), 0 === e2.strm.avail_out) ? A : I;
          }
          function W(e2, t2) {
            for (var r2, n2, i2; ; ) {
              if (e2.lookahead < z) {
                if (j(e2), e2.lookahead < z && t2 === l) return A;
                if (0 === e2.lookahead) break;
              }
              if (r2 = 0, e2.lookahead >= x && (e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[e2.strstart + x - 1]) & e2.hash_mask, r2 = e2.prev[e2.strstart & e2.w_mask] = e2.head[e2.ins_h], e2.head[e2.ins_h] = e2.strstart), e2.prev_length = e2.match_length, e2.prev_match = e2.match_start, e2.match_length = x - 1, 0 !== r2 && e2.prev_length < e2.max_lazy_match && e2.strstart - r2 <= e2.w_size - z && (e2.match_length = L(e2, r2), e2.match_length <= 5 && (1 === e2.strategy || e2.match_length === x && 4096 < e2.strstart - e2.match_start) && (e2.match_length = x - 1)), e2.prev_length >= x && e2.match_length <= e2.prev_length) {
                for (i2 = e2.strstart + e2.lookahead - x, n2 = u._tr_tally(e2, e2.strstart - 1 - e2.prev_match, e2.prev_length - x), e2.lookahead -= e2.prev_length - 1, e2.prev_length -= 2; ++e2.strstart <= i2 && (e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[e2.strstart + x - 1]) & e2.hash_mask, r2 = e2.prev[e2.strstart & e2.w_mask] = e2.head[e2.ins_h], e2.head[e2.ins_h] = e2.strstart), 0 != --e2.prev_length; ) ;
                if (e2.match_available = 0, e2.match_length = x - 1, e2.strstart++, n2 && (N(e2, false), 0 === e2.strm.avail_out)) return A;
              } else if (e2.match_available) {
                if ((n2 = u._tr_tally(e2, 0, e2.window[e2.strstart - 1])) && N(e2, false), e2.strstart++, e2.lookahead--, 0 === e2.strm.avail_out) return A;
              } else e2.match_available = 1, e2.strstart++, e2.lookahead--;
            }
            return e2.match_available && (n2 = u._tr_tally(e2, 0, e2.window[e2.strstart - 1]), e2.match_available = 0), e2.insert = e2.strstart < x - 1 ? e2.strstart : x - 1, t2 === f ? (N(e2, true), 0 === e2.strm.avail_out ? O : B) : e2.last_lit && (N(e2, false), 0 === e2.strm.avail_out) ? A : I;
          }
          function M(e2, t2, r2, n2, i2) {
            this.good_length = e2, this.max_lazy = t2, this.nice_length = r2, this.max_chain = n2, this.func = i2;
          }
          function H() {
            this.strm = null, this.status = 0, this.pending_buf = null, this.pending_buf_size = 0, this.pending_out = 0, this.pending = 0, this.wrap = 0, this.gzhead = null, this.gzindex = 0, this.method = v, this.last_flush = -1, this.w_size = 0, this.w_bits = 0, this.w_mask = 0, this.window = null, this.window_size = 0, this.prev = null, this.head = null, this.ins_h = 0, this.hash_size = 0, this.hash_bits = 0, this.hash_mask = 0, this.hash_shift = 0, this.block_start = 0, this.match_length = 0, this.prev_match = 0, this.match_available = 0, this.strstart = 0, this.match_start = 0, this.lookahead = 0, this.prev_length = 0, this.max_chain_length = 0, this.max_lazy_match = 0, this.level = 0, this.strategy = 0, this.good_match = 0, this.nice_match = 0, this.dyn_ltree = new c.Buf16(2 * w), this.dyn_dtree = new c.Buf16(2 * (2 * a + 1)), this.bl_tree = new c.Buf16(2 * (2 * o + 1)), D(this.dyn_ltree), D(this.dyn_dtree), D(this.bl_tree), this.l_desc = null, this.d_desc = null, this.bl_desc = null, this.bl_count = new c.Buf16(k + 1), this.heap = new c.Buf16(2 * s + 1), D(this.heap), this.heap_len = 0, this.heap_max = 0, this.depth = new c.Buf16(2 * s + 1), D(this.depth), this.l_buf = 0, this.lit_bufsize = 0, this.last_lit = 0, this.d_buf = 0, this.opt_len = 0, this.static_len = 0, this.matches = 0, this.insert = 0, this.bi_buf = 0, this.bi_valid = 0;
          }
          function G(e2) {
            var t2;
            return e2 && e2.state ? (e2.total_in = e2.total_out = 0, e2.data_type = i, (t2 = e2.state).pending = 0, t2.pending_out = 0, t2.wrap < 0 && (t2.wrap = -t2.wrap), t2.status = t2.wrap ? C : E, e2.adler = 2 === t2.wrap ? 0 : 1, t2.last_flush = l, u._tr_init(t2), m) : R(e2, _);
          }
          function K(e2) {
            var t2 = G(e2);
            return t2 === m && (function(e3) {
              e3.window_size = 2 * e3.w_size, D(e3.head), e3.max_lazy_match = h[e3.level].max_lazy, e3.good_match = h[e3.level].good_length, e3.nice_match = h[e3.level].nice_length, e3.max_chain_length = h[e3.level].max_chain, e3.strstart = 0, e3.block_start = 0, e3.lookahead = 0, e3.insert = 0, e3.match_length = e3.prev_length = x - 1, e3.match_available = 0, e3.ins_h = 0;
            })(e2.state), t2;
          }
          function Y(e2, t2, r2, n2, i2, s2) {
            if (!e2) return _;
            var a2 = 1;
            if (t2 === g && (t2 = 6), n2 < 0 ? (a2 = 0, n2 = -n2) : 15 < n2 && (a2 = 2, n2 -= 16), i2 < 1 || y < i2 || r2 !== v || n2 < 8 || 15 < n2 || t2 < 0 || 9 < t2 || s2 < 0 || b < s2) return R(e2, _);
            8 === n2 && (n2 = 9);
            var o2 = new H();
            return (e2.state = o2).strm = e2, o2.wrap = a2, o2.gzhead = null, o2.w_bits = n2, o2.w_size = 1 << o2.w_bits, o2.w_mask = o2.w_size - 1, o2.hash_bits = i2 + 7, o2.hash_size = 1 << o2.hash_bits, o2.hash_mask = o2.hash_size - 1, o2.hash_shift = ~~((o2.hash_bits + x - 1) / x), o2.window = new c.Buf8(2 * o2.w_size), o2.head = new c.Buf16(o2.hash_size), o2.prev = new c.Buf16(o2.w_size), o2.lit_bufsize = 1 << i2 + 6, o2.pending_buf_size = 4 * o2.lit_bufsize, o2.pending_buf = new c.Buf8(o2.pending_buf_size), o2.d_buf = 1 * o2.lit_bufsize, o2.l_buf = 3 * o2.lit_bufsize, o2.level = t2, o2.strategy = s2, o2.method = r2, K(e2);
          }
          h = [new M(0, 0, 0, 0, function(e2, t2) {
            var r2 = 65535;
            for (r2 > e2.pending_buf_size - 5 && (r2 = e2.pending_buf_size - 5); ; ) {
              if (e2.lookahead <= 1) {
                if (j(e2), 0 === e2.lookahead && t2 === l) return A;
                if (0 === e2.lookahead) break;
              }
              e2.strstart += e2.lookahead, e2.lookahead = 0;
              var n2 = e2.block_start + r2;
              if ((0 === e2.strstart || e2.strstart >= n2) && (e2.lookahead = e2.strstart - n2, e2.strstart = n2, N(e2, false), 0 === e2.strm.avail_out)) return A;
              if (e2.strstart - e2.block_start >= e2.w_size - z && (N(e2, false), 0 === e2.strm.avail_out)) return A;
            }
            return e2.insert = 0, t2 === f ? (N(e2, true), 0 === e2.strm.avail_out ? O : B) : (e2.strstart > e2.block_start && (N(e2, false), e2.strm.avail_out), A);
          }), new M(4, 4, 8, 4, Z), new M(4, 5, 16, 8, Z), new M(4, 6, 32, 32, Z), new M(4, 4, 16, 16, W), new M(8, 16, 32, 32, W), new M(8, 16, 128, 128, W), new M(8, 32, 128, 256, W), new M(32, 128, 258, 1024, W), new M(32, 258, 258, 4096, W)], r.deflateInit = function(e2, t2) {
            return Y(e2, t2, v, 15, 8, 0);
          }, r.deflateInit2 = Y, r.deflateReset = K, r.deflateResetKeep = G, r.deflateSetHeader = function(e2, t2) {
            return e2 && e2.state ? 2 !== e2.state.wrap ? _ : (e2.state.gzhead = t2, m) : _;
          }, r.deflate = function(e2, t2) {
            var r2, n2, i2, s2;
            if (!e2 || !e2.state || 5 < t2 || t2 < 0) return e2 ? R(e2, _) : _;
            if (n2 = e2.state, !e2.output || !e2.input && 0 !== e2.avail_in || 666 === n2.status && t2 !== f) return R(e2, 0 === e2.avail_out ? -5 : _);
            if (n2.strm = e2, r2 = n2.last_flush, n2.last_flush = t2, n2.status === C) if (2 === n2.wrap) e2.adler = 0, U(n2, 31), U(n2, 139), U(n2, 8), n2.gzhead ? (U(n2, (n2.gzhead.text ? 1 : 0) + (n2.gzhead.hcrc ? 2 : 0) + (n2.gzhead.extra ? 4 : 0) + (n2.gzhead.name ? 8 : 0) + (n2.gzhead.comment ? 16 : 0)), U(n2, 255 & n2.gzhead.time), U(n2, n2.gzhead.time >> 8 & 255), U(n2, n2.gzhead.time >> 16 & 255), U(n2, n2.gzhead.time >> 24 & 255), U(n2, 9 === n2.level ? 2 : 2 <= n2.strategy || n2.level < 2 ? 4 : 0), U(n2, 255 & n2.gzhead.os), n2.gzhead.extra && n2.gzhead.extra.length && (U(n2, 255 & n2.gzhead.extra.length), U(n2, n2.gzhead.extra.length >> 8 & 255)), n2.gzhead.hcrc && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending, 0)), n2.gzindex = 0, n2.status = 69) : (U(n2, 0), U(n2, 0), U(n2, 0), U(n2, 0), U(n2, 0), U(n2, 9 === n2.level ? 2 : 2 <= n2.strategy || n2.level < 2 ? 4 : 0), U(n2, 3), n2.status = E);
            else {
              var a2 = v + (n2.w_bits - 8 << 4) << 8;
              a2 |= (2 <= n2.strategy || n2.level < 2 ? 0 : n2.level < 6 ? 1 : 6 === n2.level ? 2 : 3) << 6, 0 !== n2.strstart && (a2 |= 32), a2 += 31 - a2 % 31, n2.status = E, P(n2, a2), 0 !== n2.strstart && (P(n2, e2.adler >>> 16), P(n2, 65535 & e2.adler)), e2.adler = 1;
            }
            if (69 === n2.status) if (n2.gzhead.extra) {
              for (i2 = n2.pending; n2.gzindex < (65535 & n2.gzhead.extra.length) && (n2.pending !== n2.pending_buf_size || (n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), F(e2), i2 = n2.pending, n2.pending !== n2.pending_buf_size)); ) U(n2, 255 & n2.gzhead.extra[n2.gzindex]), n2.gzindex++;
              n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), n2.gzindex === n2.gzhead.extra.length && (n2.gzindex = 0, n2.status = 73);
            } else n2.status = 73;
            if (73 === n2.status) if (n2.gzhead.name) {
              i2 = n2.pending;
              do {
                if (n2.pending === n2.pending_buf_size && (n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), F(e2), i2 = n2.pending, n2.pending === n2.pending_buf_size)) {
                  s2 = 1;
                  break;
                }
                s2 = n2.gzindex < n2.gzhead.name.length ? 255 & n2.gzhead.name.charCodeAt(n2.gzindex++) : 0, U(n2, s2);
              } while (0 !== s2);
              n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), 0 === s2 && (n2.gzindex = 0, n2.status = 91);
            } else n2.status = 91;
            if (91 === n2.status) if (n2.gzhead.comment) {
              i2 = n2.pending;
              do {
                if (n2.pending === n2.pending_buf_size && (n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), F(e2), i2 = n2.pending, n2.pending === n2.pending_buf_size)) {
                  s2 = 1;
                  break;
                }
                s2 = n2.gzindex < n2.gzhead.comment.length ? 255 & n2.gzhead.comment.charCodeAt(n2.gzindex++) : 0, U(n2, s2);
              } while (0 !== s2);
              n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), 0 === s2 && (n2.status = 103);
            } else n2.status = 103;
            if (103 === n2.status && (n2.gzhead.hcrc ? (n2.pending + 2 > n2.pending_buf_size && F(e2), n2.pending + 2 <= n2.pending_buf_size && (U(n2, 255 & e2.adler), U(n2, e2.adler >> 8 & 255), e2.adler = 0, n2.status = E)) : n2.status = E), 0 !== n2.pending) {
              if (F(e2), 0 === e2.avail_out) return n2.last_flush = -1, m;
            } else if (0 === e2.avail_in && T(t2) <= T(r2) && t2 !== f) return R(e2, -5);
            if (666 === n2.status && 0 !== e2.avail_in) return R(e2, -5);
            if (0 !== e2.avail_in || 0 !== n2.lookahead || t2 !== l && 666 !== n2.status) {
              var o2 = 2 === n2.strategy ? (function(e3, t3) {
                for (var r3; ; ) {
                  if (0 === e3.lookahead && (j(e3), 0 === e3.lookahead)) {
                    if (t3 === l) return A;
                    break;
                  }
                  if (e3.match_length = 0, r3 = u._tr_tally(e3, 0, e3.window[e3.strstart]), e3.lookahead--, e3.strstart++, r3 && (N(e3, false), 0 === e3.strm.avail_out)) return A;
                }
                return e3.insert = 0, t3 === f ? (N(e3, true), 0 === e3.strm.avail_out ? O : B) : e3.last_lit && (N(e3, false), 0 === e3.strm.avail_out) ? A : I;
              })(n2, t2) : 3 === n2.strategy ? (function(e3, t3) {
                for (var r3, n3, i3, s3, a3 = e3.window; ; ) {
                  if (e3.lookahead <= S) {
                    if (j(e3), e3.lookahead <= S && t3 === l) return A;
                    if (0 === e3.lookahead) break;
                  }
                  if (e3.match_length = 0, e3.lookahead >= x && 0 < e3.strstart && (n3 = a3[i3 = e3.strstart - 1]) === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3]) {
                    s3 = e3.strstart + S;
                    do {
                    } while (n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && i3 < s3);
                    e3.match_length = S - (s3 - i3), e3.match_length > e3.lookahead && (e3.match_length = e3.lookahead);
                  }
                  if (e3.match_length >= x ? (r3 = u._tr_tally(e3, 1, e3.match_length - x), e3.lookahead -= e3.match_length, e3.strstart += e3.match_length, e3.match_length = 0) : (r3 = u._tr_tally(e3, 0, e3.window[e3.strstart]), e3.lookahead--, e3.strstart++), r3 && (N(e3, false), 0 === e3.strm.avail_out)) return A;
                }
                return e3.insert = 0, t3 === f ? (N(e3, true), 0 === e3.strm.avail_out ? O : B) : e3.last_lit && (N(e3, false), 0 === e3.strm.avail_out) ? A : I;
              })(n2, t2) : h[n2.level].func(n2, t2);
              if (o2 !== O && o2 !== B || (n2.status = 666), o2 === A || o2 === O) return 0 === e2.avail_out && (n2.last_flush = -1), m;
              if (o2 === I && (1 === t2 ? u._tr_align(n2) : 5 !== t2 && (u._tr_stored_block(n2, 0, 0, false), 3 === t2 && (D(n2.head), 0 === n2.lookahead && (n2.strstart = 0, n2.block_start = 0, n2.insert = 0))), F(e2), 0 === e2.avail_out)) return n2.last_flush = -1, m;
            }
            return t2 !== f ? m : n2.wrap <= 0 ? 1 : (2 === n2.wrap ? (U(n2, 255 & e2.adler), U(n2, e2.adler >> 8 & 255), U(n2, e2.adler >> 16 & 255), U(n2, e2.adler >> 24 & 255), U(n2, 255 & e2.total_in), U(n2, e2.total_in >> 8 & 255), U(n2, e2.total_in >> 16 & 255), U(n2, e2.total_in >> 24 & 255)) : (P(n2, e2.adler >>> 16), P(n2, 65535 & e2.adler)), F(e2), 0 < n2.wrap && (n2.wrap = -n2.wrap), 0 !== n2.pending ? m : 1);
          }, r.deflateEnd = function(e2) {
            var t2;
            return e2 && e2.state ? (t2 = e2.state.status) !== C && 69 !== t2 && 73 !== t2 && 91 !== t2 && 103 !== t2 && t2 !== E && 666 !== t2 ? R(e2, _) : (e2.state = null, t2 === E ? R(e2, -3) : m) : _;
          }, r.deflateSetDictionary = function(e2, t2) {
            var r2, n2, i2, s2, a2, o2, h2, u2, l2 = t2.length;
            if (!e2 || !e2.state) return _;
            if (2 === (s2 = (r2 = e2.state).wrap) || 1 === s2 && r2.status !== C || r2.lookahead) return _;
            for (1 === s2 && (e2.adler = d(e2.adler, t2, l2, 0)), r2.wrap = 0, l2 >= r2.w_size && (0 === s2 && (D(r2.head), r2.strstart = 0, r2.block_start = 0, r2.insert = 0), u2 = new c.Buf8(r2.w_size), c.arraySet(u2, t2, l2 - r2.w_size, r2.w_size, 0), t2 = u2, l2 = r2.w_size), a2 = e2.avail_in, o2 = e2.next_in, h2 = e2.input, e2.avail_in = l2, e2.next_in = 0, e2.input = t2, j(r2); r2.lookahead >= x; ) {
              for (n2 = r2.strstart, i2 = r2.lookahead - (x - 1); r2.ins_h = (r2.ins_h << r2.hash_shift ^ r2.window[n2 + x - 1]) & r2.hash_mask, r2.prev[n2 & r2.w_mask] = r2.head[r2.ins_h], r2.head[r2.ins_h] = n2, n2++, --i2; ) ;
              r2.strstart = n2, r2.lookahead = x - 1, j(r2);
            }
            return r2.strstart += r2.lookahead, r2.block_start = r2.strstart, r2.insert = r2.lookahead, r2.lookahead = 0, r2.match_length = r2.prev_length = x - 1, r2.match_available = 0, e2.next_in = o2, e2.input = h2, e2.avail_in = a2, r2.wrap = s2, m;
          }, r.deflateInfo = "pako deflate (from Nodeca project)";
        }, { "../utils/common": 41, "./adler32": 43, "./crc32": 45, "./messages": 51, "./trees": 52 }], 47: [function(e, t, r) {
          "use strict";
          t.exports = function() {
            this.text = 0, this.time = 0, this.xflags = 0, this.os = 0, this.extra = null, this.extra_len = 0, this.name = "", this.comment = "", this.hcrc = 0, this.done = false;
          };
        }, {}], 48: [function(e, t, r) {
          "use strict";
          t.exports = function(e2, t2) {
            var r2, n, i, s, a, o, h, u, l, f, c, d, p, m, _, g, b, v, y, w, k, x, S, z, C;
            r2 = e2.state, n = e2.next_in, z = e2.input, i = n + (e2.avail_in - 5), s = e2.next_out, C = e2.output, a = s - (t2 - e2.avail_out), o = s + (e2.avail_out - 257), h = r2.dmax, u = r2.wsize, l = r2.whave, f = r2.wnext, c = r2.window, d = r2.hold, p = r2.bits, m = r2.lencode, _ = r2.distcode, g = (1 << r2.lenbits) - 1, b = (1 << r2.distbits) - 1;
            e: do {
              p < 15 && (d += z[n++] << p, p += 8, d += z[n++] << p, p += 8), v = m[d & g];
              t: for (; ; ) {
                if (d >>>= y = v >>> 24, p -= y, 0 === (y = v >>> 16 & 255)) C[s++] = 65535 & v;
                else {
                  if (!(16 & y)) {
                    if (0 == (64 & y)) {
                      v = m[(65535 & v) + (d & (1 << y) - 1)];
                      continue t;
                    }
                    if (32 & y) {
                      r2.mode = 12;
                      break e;
                    }
                    e2.msg = "invalid literal/length code", r2.mode = 30;
                    break e;
                  }
                  w = 65535 & v, (y &= 15) && (p < y && (d += z[n++] << p, p += 8), w += d & (1 << y) - 1, d >>>= y, p -= y), p < 15 && (d += z[n++] << p, p += 8, d += z[n++] << p, p += 8), v = _[d & b];
                  r: for (; ; ) {
                    if (d >>>= y = v >>> 24, p -= y, !(16 & (y = v >>> 16 & 255))) {
                      if (0 == (64 & y)) {
                        v = _[(65535 & v) + (d & (1 << y) - 1)];
                        continue r;
                      }
                      e2.msg = "invalid distance code", r2.mode = 30;
                      break e;
                    }
                    if (k = 65535 & v, p < (y &= 15) && (d += z[n++] << p, (p += 8) < y && (d += z[n++] << p, p += 8)), h < (k += d & (1 << y) - 1)) {
                      e2.msg = "invalid distance too far back", r2.mode = 30;
                      break e;
                    }
                    if (d >>>= y, p -= y, (y = s - a) < k) {
                      if (l < (y = k - y) && r2.sane) {
                        e2.msg = "invalid distance too far back", r2.mode = 30;
                        break e;
                      }
                      if (S = c, (x = 0) === f) {
                        if (x += u - y, y < w) {
                          for (w -= y; C[s++] = c[x++], --y; ) ;
                          x = s - k, S = C;
                        }
                      } else if (f < y) {
                        if (x += u + f - y, (y -= f) < w) {
                          for (w -= y; C[s++] = c[x++], --y; ) ;
                          if (x = 0, f < w) {
                            for (w -= y = f; C[s++] = c[x++], --y; ) ;
                            x = s - k, S = C;
                          }
                        }
                      } else if (x += f - y, y < w) {
                        for (w -= y; C[s++] = c[x++], --y; ) ;
                        x = s - k, S = C;
                      }
                      for (; 2 < w; ) C[s++] = S[x++], C[s++] = S[x++], C[s++] = S[x++], w -= 3;
                      w && (C[s++] = S[x++], 1 < w && (C[s++] = S[x++]));
                    } else {
                      for (x = s - k; C[s++] = C[x++], C[s++] = C[x++], C[s++] = C[x++], 2 < (w -= 3); ) ;
                      w && (C[s++] = C[x++], 1 < w && (C[s++] = C[x++]));
                    }
                    break;
                  }
                }
                break;
              }
            } while (n < i && s < o);
            n -= w = p >> 3, d &= (1 << (p -= w << 3)) - 1, e2.next_in = n, e2.next_out = s, e2.avail_in = n < i ? i - n + 5 : 5 - (n - i), e2.avail_out = s < o ? o - s + 257 : 257 - (s - o), r2.hold = d, r2.bits = p;
          };
        }, {}], 49: [function(e, t, r) {
          "use strict";
          var I = e("../utils/common"), O = e("./adler32"), B = e("./crc32"), R = e("./inffast"), T = e("./inftrees"), D = 1, F = 2, N = 0, U = -2, P = 1, n = 852, i = 592;
          function L(e2) {
            return (e2 >>> 24 & 255) + (e2 >>> 8 & 65280) + ((65280 & e2) << 8) + ((255 & e2) << 24);
          }
          function s() {
            this.mode = 0, this.last = false, this.wrap = 0, this.havedict = false, this.flags = 0, this.dmax = 0, this.check = 0, this.total = 0, this.head = null, this.wbits = 0, this.wsize = 0, this.whave = 0, this.wnext = 0, this.window = null, this.hold = 0, this.bits = 0, this.length = 0, this.offset = 0, this.extra = 0, this.lencode = null, this.distcode = null, this.lenbits = 0, this.distbits = 0, this.ncode = 0, this.nlen = 0, this.ndist = 0, this.have = 0, this.next = null, this.lens = new I.Buf16(320), this.work = new I.Buf16(288), this.lendyn = null, this.distdyn = null, this.sane = 0, this.back = 0, this.was = 0;
          }
          function a(e2) {
            var t2;
            return e2 && e2.state ? (t2 = e2.state, e2.total_in = e2.total_out = t2.total = 0, e2.msg = "", t2.wrap && (e2.adler = 1 & t2.wrap), t2.mode = P, t2.last = 0, t2.havedict = 0, t2.dmax = 32768, t2.head = null, t2.hold = 0, t2.bits = 0, t2.lencode = t2.lendyn = new I.Buf32(n), t2.distcode = t2.distdyn = new I.Buf32(i), t2.sane = 1, t2.back = -1, N) : U;
          }
          function o(e2) {
            var t2;
            return e2 && e2.state ? ((t2 = e2.state).wsize = 0, t2.whave = 0, t2.wnext = 0, a(e2)) : U;
          }
          function h(e2, t2) {
            var r2, n2;
            return e2 && e2.state ? (n2 = e2.state, t2 < 0 ? (r2 = 0, t2 = -t2) : (r2 = 1 + (t2 >> 4), t2 < 48 && (t2 &= 15)), t2 && (t2 < 8 || 15 < t2) ? U : (null !== n2.window && n2.wbits !== t2 && (n2.window = null), n2.wrap = r2, n2.wbits = t2, o(e2))) : U;
          }
          function u(e2, t2) {
            var r2, n2;
            return e2 ? (n2 = new s(), (e2.state = n2).window = null, (r2 = h(e2, t2)) !== N && (e2.state = null), r2) : U;
          }
          var l, f, c = true;
          function j(e2) {
            if (c) {
              var t2;
              for (l = new I.Buf32(512), f = new I.Buf32(32), t2 = 0; t2 < 144; ) e2.lens[t2++] = 8;
              for (; t2 < 256; ) e2.lens[t2++] = 9;
              for (; t2 < 280; ) e2.lens[t2++] = 7;
              for (; t2 < 288; ) e2.lens[t2++] = 8;
              for (T(D, e2.lens, 0, 288, l, 0, e2.work, { bits: 9 }), t2 = 0; t2 < 32; ) e2.lens[t2++] = 5;
              T(F, e2.lens, 0, 32, f, 0, e2.work, { bits: 5 }), c = false;
            }
            e2.lencode = l, e2.lenbits = 9, e2.distcode = f, e2.distbits = 5;
          }
          function Z(e2, t2, r2, n2) {
            var i2, s2 = e2.state;
            return null === s2.window && (s2.wsize = 1 << s2.wbits, s2.wnext = 0, s2.whave = 0, s2.window = new I.Buf8(s2.wsize)), n2 >= s2.wsize ? (I.arraySet(s2.window, t2, r2 - s2.wsize, s2.wsize, 0), s2.wnext = 0, s2.whave = s2.wsize) : (n2 < (i2 = s2.wsize - s2.wnext) && (i2 = n2), I.arraySet(s2.window, t2, r2 - n2, i2, s2.wnext), (n2 -= i2) ? (I.arraySet(s2.window, t2, r2 - n2, n2, 0), s2.wnext = n2, s2.whave = s2.wsize) : (s2.wnext += i2, s2.wnext === s2.wsize && (s2.wnext = 0), s2.whave < s2.wsize && (s2.whave += i2))), 0;
          }
          r.inflateReset = o, r.inflateReset2 = h, r.inflateResetKeep = a, r.inflateInit = function(e2) {
            return u(e2, 15);
          }, r.inflateInit2 = u, r.inflate = function(e2, t2) {
            var r2, n2, i2, s2, a2, o2, h2, u2, l2, f2, c2, d, p, m, _, g, b, v, y, w, k, x, S, z, C = 0, E = new I.Buf8(4), A = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
            if (!e2 || !e2.state || !e2.output || !e2.input && 0 !== e2.avail_in) return U;
            12 === (r2 = e2.state).mode && (r2.mode = 13), a2 = e2.next_out, i2 = e2.output, h2 = e2.avail_out, s2 = e2.next_in, n2 = e2.input, o2 = e2.avail_in, u2 = r2.hold, l2 = r2.bits, f2 = o2, c2 = h2, x = N;
            e: for (; ; ) switch (r2.mode) {
              case P:
                if (0 === r2.wrap) {
                  r2.mode = 13;
                  break;
                }
                for (; l2 < 16; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                if (2 & r2.wrap && 35615 === u2) {
                  E[r2.check = 0] = 255 & u2, E[1] = u2 >>> 8 & 255, r2.check = B(r2.check, E, 2, 0), l2 = u2 = 0, r2.mode = 2;
                  break;
                }
                if (r2.flags = 0, r2.head && (r2.head.done = false), !(1 & r2.wrap) || (((255 & u2) << 8) + (u2 >> 8)) % 31) {
                  e2.msg = "incorrect header check", r2.mode = 30;
                  break;
                }
                if (8 != (15 & u2)) {
                  e2.msg = "unknown compression method", r2.mode = 30;
                  break;
                }
                if (l2 -= 4, k = 8 + (15 & (u2 >>>= 4)), 0 === r2.wbits) r2.wbits = k;
                else if (k > r2.wbits) {
                  e2.msg = "invalid window size", r2.mode = 30;
                  break;
                }
                r2.dmax = 1 << k, e2.adler = r2.check = 1, r2.mode = 512 & u2 ? 10 : 12, l2 = u2 = 0;
                break;
              case 2:
                for (; l2 < 16; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                if (r2.flags = u2, 8 != (255 & r2.flags)) {
                  e2.msg = "unknown compression method", r2.mode = 30;
                  break;
                }
                if (57344 & r2.flags) {
                  e2.msg = "unknown header flags set", r2.mode = 30;
                  break;
                }
                r2.head && (r2.head.text = u2 >> 8 & 1), 512 & r2.flags && (E[0] = 255 & u2, E[1] = u2 >>> 8 & 255, r2.check = B(r2.check, E, 2, 0)), l2 = u2 = 0, r2.mode = 3;
              case 3:
                for (; l2 < 32; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                r2.head && (r2.head.time = u2), 512 & r2.flags && (E[0] = 255 & u2, E[1] = u2 >>> 8 & 255, E[2] = u2 >>> 16 & 255, E[3] = u2 >>> 24 & 255, r2.check = B(r2.check, E, 4, 0)), l2 = u2 = 0, r2.mode = 4;
              case 4:
                for (; l2 < 16; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                r2.head && (r2.head.xflags = 255 & u2, r2.head.os = u2 >> 8), 512 & r2.flags && (E[0] = 255 & u2, E[1] = u2 >>> 8 & 255, r2.check = B(r2.check, E, 2, 0)), l2 = u2 = 0, r2.mode = 5;
              case 5:
                if (1024 & r2.flags) {
                  for (; l2 < 16; ) {
                    if (0 === o2) break e;
                    o2--, u2 += n2[s2++] << l2, l2 += 8;
                  }
                  r2.length = u2, r2.head && (r2.head.extra_len = u2), 512 & r2.flags && (E[0] = 255 & u2, E[1] = u2 >>> 8 & 255, r2.check = B(r2.check, E, 2, 0)), l2 = u2 = 0;
                } else r2.head && (r2.head.extra = null);
                r2.mode = 6;
              case 6:
                if (1024 & r2.flags && (o2 < (d = r2.length) && (d = o2), d && (r2.head && (k = r2.head.extra_len - r2.length, r2.head.extra || (r2.head.extra = new Array(r2.head.extra_len)), I.arraySet(r2.head.extra, n2, s2, d, k)), 512 & r2.flags && (r2.check = B(r2.check, n2, d, s2)), o2 -= d, s2 += d, r2.length -= d), r2.length)) break e;
                r2.length = 0, r2.mode = 7;
              case 7:
                if (2048 & r2.flags) {
                  if (0 === o2) break e;
                  for (d = 0; k = n2[s2 + d++], r2.head && k && r2.length < 65536 && (r2.head.name += String.fromCharCode(k)), k && d < o2; ) ;
                  if (512 & r2.flags && (r2.check = B(r2.check, n2, d, s2)), o2 -= d, s2 += d, k) break e;
                } else r2.head && (r2.head.name = null);
                r2.length = 0, r2.mode = 8;
              case 8:
                if (4096 & r2.flags) {
                  if (0 === o2) break e;
                  for (d = 0; k = n2[s2 + d++], r2.head && k && r2.length < 65536 && (r2.head.comment += String.fromCharCode(k)), k && d < o2; ) ;
                  if (512 & r2.flags && (r2.check = B(r2.check, n2, d, s2)), o2 -= d, s2 += d, k) break e;
                } else r2.head && (r2.head.comment = null);
                r2.mode = 9;
              case 9:
                if (512 & r2.flags) {
                  for (; l2 < 16; ) {
                    if (0 === o2) break e;
                    o2--, u2 += n2[s2++] << l2, l2 += 8;
                  }
                  if (u2 !== (65535 & r2.check)) {
                    e2.msg = "header crc mismatch", r2.mode = 30;
                    break;
                  }
                  l2 = u2 = 0;
                }
                r2.head && (r2.head.hcrc = r2.flags >> 9 & 1, r2.head.done = true), e2.adler = r2.check = 0, r2.mode = 12;
                break;
              case 10:
                for (; l2 < 32; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                e2.adler = r2.check = L(u2), l2 = u2 = 0, r2.mode = 11;
              case 11:
                if (0 === r2.havedict) return e2.next_out = a2, e2.avail_out = h2, e2.next_in = s2, e2.avail_in = o2, r2.hold = u2, r2.bits = l2, 2;
                e2.adler = r2.check = 1, r2.mode = 12;
              case 12:
                if (5 === t2 || 6 === t2) break e;
              case 13:
                if (r2.last) {
                  u2 >>>= 7 & l2, l2 -= 7 & l2, r2.mode = 27;
                  break;
                }
                for (; l2 < 3; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                switch (r2.last = 1 & u2, l2 -= 1, 3 & (u2 >>>= 1)) {
                  case 0:
                    r2.mode = 14;
                    break;
                  case 1:
                    if (j(r2), r2.mode = 20, 6 !== t2) break;
                    u2 >>>= 2, l2 -= 2;
                    break e;
                  case 2:
                    r2.mode = 17;
                    break;
                  case 3:
                    e2.msg = "invalid block type", r2.mode = 30;
                }
                u2 >>>= 2, l2 -= 2;
                break;
              case 14:
                for (u2 >>>= 7 & l2, l2 -= 7 & l2; l2 < 32; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                if ((65535 & u2) != (u2 >>> 16 ^ 65535)) {
                  e2.msg = "invalid stored block lengths", r2.mode = 30;
                  break;
                }
                if (r2.length = 65535 & u2, l2 = u2 = 0, r2.mode = 15, 6 === t2) break e;
              case 15:
                r2.mode = 16;
              case 16:
                if (d = r2.length) {
                  if (o2 < d && (d = o2), h2 < d && (d = h2), 0 === d) break e;
                  I.arraySet(i2, n2, s2, d, a2), o2 -= d, s2 += d, h2 -= d, a2 += d, r2.length -= d;
                  break;
                }
                r2.mode = 12;
                break;
              case 17:
                for (; l2 < 14; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                if (r2.nlen = 257 + (31 & u2), u2 >>>= 5, l2 -= 5, r2.ndist = 1 + (31 & u2), u2 >>>= 5, l2 -= 5, r2.ncode = 4 + (15 & u2), u2 >>>= 4, l2 -= 4, 286 < r2.nlen || 30 < r2.ndist) {
                  e2.msg = "too many length or distance symbols", r2.mode = 30;
                  break;
                }
                r2.have = 0, r2.mode = 18;
              case 18:
                for (; r2.have < r2.ncode; ) {
                  for (; l2 < 3; ) {
                    if (0 === o2) break e;
                    o2--, u2 += n2[s2++] << l2, l2 += 8;
                  }
                  r2.lens[A[r2.have++]] = 7 & u2, u2 >>>= 3, l2 -= 3;
                }
                for (; r2.have < 19; ) r2.lens[A[r2.have++]] = 0;
                if (r2.lencode = r2.lendyn, r2.lenbits = 7, S = { bits: r2.lenbits }, x = T(0, r2.lens, 0, 19, r2.lencode, 0, r2.work, S), r2.lenbits = S.bits, x) {
                  e2.msg = "invalid code lengths set", r2.mode = 30;
                  break;
                }
                r2.have = 0, r2.mode = 19;
              case 19:
                for (; r2.have < r2.nlen + r2.ndist; ) {
                  for (; g = (C = r2.lencode[u2 & (1 << r2.lenbits) - 1]) >>> 16 & 255, b = 65535 & C, !((_ = C >>> 24) <= l2); ) {
                    if (0 === o2) break e;
                    o2--, u2 += n2[s2++] << l2, l2 += 8;
                  }
                  if (b < 16) u2 >>>= _, l2 -= _, r2.lens[r2.have++] = b;
                  else {
                    if (16 === b) {
                      for (z = _ + 2; l2 < z; ) {
                        if (0 === o2) break e;
                        o2--, u2 += n2[s2++] << l2, l2 += 8;
                      }
                      if (u2 >>>= _, l2 -= _, 0 === r2.have) {
                        e2.msg = "invalid bit length repeat", r2.mode = 30;
                        break;
                      }
                      k = r2.lens[r2.have - 1], d = 3 + (3 & u2), u2 >>>= 2, l2 -= 2;
                    } else if (17 === b) {
                      for (z = _ + 3; l2 < z; ) {
                        if (0 === o2) break e;
                        o2--, u2 += n2[s2++] << l2, l2 += 8;
                      }
                      l2 -= _, k = 0, d = 3 + (7 & (u2 >>>= _)), u2 >>>= 3, l2 -= 3;
                    } else {
                      for (z = _ + 7; l2 < z; ) {
                        if (0 === o2) break e;
                        o2--, u2 += n2[s2++] << l2, l2 += 8;
                      }
                      l2 -= _, k = 0, d = 11 + (127 & (u2 >>>= _)), u2 >>>= 7, l2 -= 7;
                    }
                    if (r2.have + d > r2.nlen + r2.ndist) {
                      e2.msg = "invalid bit length repeat", r2.mode = 30;
                      break;
                    }
                    for (; d--; ) r2.lens[r2.have++] = k;
                  }
                }
                if (30 === r2.mode) break;
                if (0 === r2.lens[256]) {
                  e2.msg = "invalid code -- missing end-of-block", r2.mode = 30;
                  break;
                }
                if (r2.lenbits = 9, S = { bits: r2.lenbits }, x = T(D, r2.lens, 0, r2.nlen, r2.lencode, 0, r2.work, S), r2.lenbits = S.bits, x) {
                  e2.msg = "invalid literal/lengths set", r2.mode = 30;
                  break;
                }
                if (r2.distbits = 6, r2.distcode = r2.distdyn, S = { bits: r2.distbits }, x = T(F, r2.lens, r2.nlen, r2.ndist, r2.distcode, 0, r2.work, S), r2.distbits = S.bits, x) {
                  e2.msg = "invalid distances set", r2.mode = 30;
                  break;
                }
                if (r2.mode = 20, 6 === t2) break e;
              case 20:
                r2.mode = 21;
              case 21:
                if (6 <= o2 && 258 <= h2) {
                  e2.next_out = a2, e2.avail_out = h2, e2.next_in = s2, e2.avail_in = o2, r2.hold = u2, r2.bits = l2, R(e2, c2), a2 = e2.next_out, i2 = e2.output, h2 = e2.avail_out, s2 = e2.next_in, n2 = e2.input, o2 = e2.avail_in, u2 = r2.hold, l2 = r2.bits, 12 === r2.mode && (r2.back = -1);
                  break;
                }
                for (r2.back = 0; g = (C = r2.lencode[u2 & (1 << r2.lenbits) - 1]) >>> 16 & 255, b = 65535 & C, !((_ = C >>> 24) <= l2); ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                if (g && 0 == (240 & g)) {
                  for (v = _, y = g, w = b; g = (C = r2.lencode[w + ((u2 & (1 << v + y) - 1) >> v)]) >>> 16 & 255, b = 65535 & C, !(v + (_ = C >>> 24) <= l2); ) {
                    if (0 === o2) break e;
                    o2--, u2 += n2[s2++] << l2, l2 += 8;
                  }
                  u2 >>>= v, l2 -= v, r2.back += v;
                }
                if (u2 >>>= _, l2 -= _, r2.back += _, r2.length = b, 0 === g) {
                  r2.mode = 26;
                  break;
                }
                if (32 & g) {
                  r2.back = -1, r2.mode = 12;
                  break;
                }
                if (64 & g) {
                  e2.msg = "invalid literal/length code", r2.mode = 30;
                  break;
                }
                r2.extra = 15 & g, r2.mode = 22;
              case 22:
                if (r2.extra) {
                  for (z = r2.extra; l2 < z; ) {
                    if (0 === o2) break e;
                    o2--, u2 += n2[s2++] << l2, l2 += 8;
                  }
                  r2.length += u2 & (1 << r2.extra) - 1, u2 >>>= r2.extra, l2 -= r2.extra, r2.back += r2.extra;
                }
                r2.was = r2.length, r2.mode = 23;
              case 23:
                for (; g = (C = r2.distcode[u2 & (1 << r2.distbits) - 1]) >>> 16 & 255, b = 65535 & C, !((_ = C >>> 24) <= l2); ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                if (0 == (240 & g)) {
                  for (v = _, y = g, w = b; g = (C = r2.distcode[w + ((u2 & (1 << v + y) - 1) >> v)]) >>> 16 & 255, b = 65535 & C, !(v + (_ = C >>> 24) <= l2); ) {
                    if (0 === o2) break e;
                    o2--, u2 += n2[s2++] << l2, l2 += 8;
                  }
                  u2 >>>= v, l2 -= v, r2.back += v;
                }
                if (u2 >>>= _, l2 -= _, r2.back += _, 64 & g) {
                  e2.msg = "invalid distance code", r2.mode = 30;
                  break;
                }
                r2.offset = b, r2.extra = 15 & g, r2.mode = 24;
              case 24:
                if (r2.extra) {
                  for (z = r2.extra; l2 < z; ) {
                    if (0 === o2) break e;
                    o2--, u2 += n2[s2++] << l2, l2 += 8;
                  }
                  r2.offset += u2 & (1 << r2.extra) - 1, u2 >>>= r2.extra, l2 -= r2.extra, r2.back += r2.extra;
                }
                if (r2.offset > r2.dmax) {
                  e2.msg = "invalid distance too far back", r2.mode = 30;
                  break;
                }
                r2.mode = 25;
              case 25:
                if (0 === h2) break e;
                if (d = c2 - h2, r2.offset > d) {
                  if ((d = r2.offset - d) > r2.whave && r2.sane) {
                    e2.msg = "invalid distance too far back", r2.mode = 30;
                    break;
                  }
                  p = d > r2.wnext ? (d -= r2.wnext, r2.wsize - d) : r2.wnext - d, d > r2.length && (d = r2.length), m = r2.window;
                } else m = i2, p = a2 - r2.offset, d = r2.length;
                for (h2 < d && (d = h2), h2 -= d, r2.length -= d; i2[a2++] = m[p++], --d; ) ;
                0 === r2.length && (r2.mode = 21);
                break;
              case 26:
                if (0 === h2) break e;
                i2[a2++] = r2.length, h2--, r2.mode = 21;
                break;
              case 27:
                if (r2.wrap) {
                  for (; l2 < 32; ) {
                    if (0 === o2) break e;
                    o2--, u2 |= n2[s2++] << l2, l2 += 8;
                  }
                  if (c2 -= h2, e2.total_out += c2, r2.total += c2, c2 && (e2.adler = r2.check = r2.flags ? B(r2.check, i2, c2, a2 - c2) : O(r2.check, i2, c2, a2 - c2)), c2 = h2, (r2.flags ? u2 : L(u2)) !== r2.check) {
                    e2.msg = "incorrect data check", r2.mode = 30;
                    break;
                  }
                  l2 = u2 = 0;
                }
                r2.mode = 28;
              case 28:
                if (r2.wrap && r2.flags) {
                  for (; l2 < 32; ) {
                    if (0 === o2) break e;
                    o2--, u2 += n2[s2++] << l2, l2 += 8;
                  }
                  if (u2 !== (4294967295 & r2.total)) {
                    e2.msg = "incorrect length check", r2.mode = 30;
                    break;
                  }
                  l2 = u2 = 0;
                }
                r2.mode = 29;
              case 29:
                x = 1;
                break e;
              case 30:
                x = -3;
                break e;
              case 31:
                return -4;
              case 32:
              default:
                return U;
            }
            return e2.next_out = a2, e2.avail_out = h2, e2.next_in = s2, e2.avail_in = o2, r2.hold = u2, r2.bits = l2, (r2.wsize || c2 !== e2.avail_out && r2.mode < 30 && (r2.mode < 27 || 4 !== t2)) && Z(e2, e2.output, e2.next_out, c2 - e2.avail_out) ? (r2.mode = 31, -4) : (f2 -= e2.avail_in, c2 -= e2.avail_out, e2.total_in += f2, e2.total_out += c2, r2.total += c2, r2.wrap && c2 && (e2.adler = r2.check = r2.flags ? B(r2.check, i2, c2, e2.next_out - c2) : O(r2.check, i2, c2, e2.next_out - c2)), e2.data_type = r2.bits + (r2.last ? 64 : 0) + (12 === r2.mode ? 128 : 0) + (20 === r2.mode || 15 === r2.mode ? 256 : 0), (0 == f2 && 0 === c2 || 4 === t2) && x === N && (x = -5), x);
          }, r.inflateEnd = function(e2) {
            if (!e2 || !e2.state) return U;
            var t2 = e2.state;
            return t2.window && (t2.window = null), e2.state = null, N;
          }, r.inflateGetHeader = function(e2, t2) {
            var r2;
            return e2 && e2.state ? 0 == (2 & (r2 = e2.state).wrap) ? U : ((r2.head = t2).done = false, N) : U;
          }, r.inflateSetDictionary = function(e2, t2) {
            var r2, n2 = t2.length;
            return e2 && e2.state ? 0 !== (r2 = e2.state).wrap && 11 !== r2.mode ? U : 11 === r2.mode && O(1, t2, n2, 0) !== r2.check ? -3 : Z(e2, t2, n2, n2) ? (r2.mode = 31, -4) : (r2.havedict = 1, N) : U;
          }, r.inflateInfo = "pako inflate (from Nodeca project)";
        }, { "../utils/common": 41, "./adler32": 43, "./crc32": 45, "./inffast": 48, "./inftrees": 50 }], 50: [function(e, t, r) {
          "use strict";
          var D = e("../utils/common"), F = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258, 0, 0], N = [16, 16, 16, 16, 16, 16, 16, 16, 17, 17, 17, 17, 18, 18, 18, 18, 19, 19, 19, 19, 20, 20, 20, 20, 21, 21, 21, 21, 16, 72, 78], U = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577, 0, 0], P = [16, 16, 16, 16, 17, 17, 18, 18, 19, 19, 20, 20, 21, 21, 22, 22, 23, 23, 24, 24, 25, 25, 26, 26, 27, 27, 28, 28, 29, 29, 64, 64];
          t.exports = function(e2, t2, r2, n, i, s, a, o) {
            var h, u, l, f, c, d, p, m, _, g = o.bits, b = 0, v = 0, y = 0, w = 0, k = 0, x = 0, S = 0, z = 0, C = 0, E = 0, A = null, I = 0, O = new D.Buf16(16), B = new D.Buf16(16), R = null, T = 0;
            for (b = 0; b <= 15; b++) O[b] = 0;
            for (v = 0; v < n; v++) O[t2[r2 + v]]++;
            for (k = g, w = 15; 1 <= w && 0 === O[w]; w--) ;
            if (w < k && (k = w), 0 === w) return i[s++] = 20971520, i[s++] = 20971520, o.bits = 1, 0;
            for (y = 1; y < w && 0 === O[y]; y++) ;
            for (k < y && (k = y), b = z = 1; b <= 15; b++) if (z <<= 1, (z -= O[b]) < 0) return -1;
            if (0 < z && (0 === e2 || 1 !== w)) return -1;
            for (B[1] = 0, b = 1; b < 15; b++) B[b + 1] = B[b] + O[b];
            for (v = 0; v < n; v++) 0 !== t2[r2 + v] && (a[B[t2[r2 + v]]++] = v);
            if (d = 0 === e2 ? (A = R = a, 19) : 1 === e2 ? (A = F, I -= 257, R = N, T -= 257, 256) : (A = U, R = P, -1), b = y, c = s, S = v = E = 0, l = -1, f = (C = 1 << (x = k)) - 1, 1 === e2 && 852 < C || 2 === e2 && 592 < C) return 1;
            for (; ; ) {
              for (p = b - S, _ = a[v] < d ? (m = 0, a[v]) : a[v] > d ? (m = R[T + a[v]], A[I + a[v]]) : (m = 96, 0), h = 1 << b - S, y = u = 1 << x; i[c + (E >> S) + (u -= h)] = p << 24 | m << 16 | _ | 0, 0 !== u; ) ;
              for (h = 1 << b - 1; E & h; ) h >>= 1;
              if (0 !== h ? (E &= h - 1, E += h) : E = 0, v++, 0 == --O[b]) {
                if (b === w) break;
                b = t2[r2 + a[v]];
              }
              if (k < b && (E & f) !== l) {
                for (0 === S && (S = k), c += y, z = 1 << (x = b - S); x + S < w && !((z -= O[x + S]) <= 0); ) x++, z <<= 1;
                if (C += 1 << x, 1 === e2 && 852 < C || 2 === e2 && 592 < C) return 1;
                i[l = E & f] = k << 24 | x << 16 | c - s | 0;
              }
            }
            return 0 !== E && (i[c + E] = b - S << 24 | 64 << 16 | 0), o.bits = k, 0;
          };
        }, { "../utils/common": 41 }], 51: [function(e, t, r) {
          "use strict";
          t.exports = { 2: "need dictionary", 1: "stream end", 0: "", "-1": "file error", "-2": "stream error", "-3": "data error", "-4": "insufficient memory", "-5": "buffer error", "-6": "incompatible version" };
        }, {}], 52: [function(e, t, r) {
          "use strict";
          var i = e("../utils/common"), o = 0, h = 1;
          function n(e2) {
            for (var t2 = e2.length; 0 <= --t2; ) e2[t2] = 0;
          }
          var s = 0, a = 29, u = 256, l = u + 1 + a, f = 30, c = 19, _ = 2 * l + 1, g = 15, d = 16, p = 7, m = 256, b = 16, v = 17, y = 18, w = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0], k = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13], x = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 7], S = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15], z = new Array(2 * (l + 2));
          n(z);
          var C = new Array(2 * f);
          n(C);
          var E = new Array(512);
          n(E);
          var A = new Array(256);
          n(A);
          var I = new Array(a);
          n(I);
          var O, B, R, T = new Array(f);
          function D(e2, t2, r2, n2, i2) {
            this.static_tree = e2, this.extra_bits = t2, this.extra_base = r2, this.elems = n2, this.max_length = i2, this.has_stree = e2 && e2.length;
          }
          function F(e2, t2) {
            this.dyn_tree = e2, this.max_code = 0, this.stat_desc = t2;
          }
          function N(e2) {
            return e2 < 256 ? E[e2] : E[256 + (e2 >>> 7)];
          }
          function U(e2, t2) {
            e2.pending_buf[e2.pending++] = 255 & t2, e2.pending_buf[e2.pending++] = t2 >>> 8 & 255;
          }
          function P(e2, t2, r2) {
            e2.bi_valid > d - r2 ? (e2.bi_buf |= t2 << e2.bi_valid & 65535, U(e2, e2.bi_buf), e2.bi_buf = t2 >> d - e2.bi_valid, e2.bi_valid += r2 - d) : (e2.bi_buf |= t2 << e2.bi_valid & 65535, e2.bi_valid += r2);
          }
          function L(e2, t2, r2) {
            P(e2, r2[2 * t2], r2[2 * t2 + 1]);
          }
          function j(e2, t2) {
            for (var r2 = 0; r2 |= 1 & e2, e2 >>>= 1, r2 <<= 1, 0 < --t2; ) ;
            return r2 >>> 1;
          }
          function Z(e2, t2, r2) {
            var n2, i2, s2 = new Array(g + 1), a2 = 0;
            for (n2 = 1; n2 <= g; n2++) s2[n2] = a2 = a2 + r2[n2 - 1] << 1;
            for (i2 = 0; i2 <= t2; i2++) {
              var o2 = e2[2 * i2 + 1];
              0 !== o2 && (e2[2 * i2] = j(s2[o2]++, o2));
            }
          }
          function W(e2) {
            var t2;
            for (t2 = 0; t2 < l; t2++) e2.dyn_ltree[2 * t2] = 0;
            for (t2 = 0; t2 < f; t2++) e2.dyn_dtree[2 * t2] = 0;
            for (t2 = 0; t2 < c; t2++) e2.bl_tree[2 * t2] = 0;
            e2.dyn_ltree[2 * m] = 1, e2.opt_len = e2.static_len = 0, e2.last_lit = e2.matches = 0;
          }
          function M(e2) {
            8 < e2.bi_valid ? U(e2, e2.bi_buf) : 0 < e2.bi_valid && (e2.pending_buf[e2.pending++] = e2.bi_buf), e2.bi_buf = 0, e2.bi_valid = 0;
          }
          function H(e2, t2, r2, n2) {
            var i2 = 2 * t2, s2 = 2 * r2;
            return e2[i2] < e2[s2] || e2[i2] === e2[s2] && n2[t2] <= n2[r2];
          }
          function G(e2, t2, r2) {
            for (var n2 = e2.heap[r2], i2 = r2 << 1; i2 <= e2.heap_len && (i2 < e2.heap_len && H(t2, e2.heap[i2 + 1], e2.heap[i2], e2.depth) && i2++, !H(t2, n2, e2.heap[i2], e2.depth)); ) e2.heap[r2] = e2.heap[i2], r2 = i2, i2 <<= 1;
            e2.heap[r2] = n2;
          }
          function K(e2, t2, r2) {
            var n2, i2, s2, a2, o2 = 0;
            if (0 !== e2.last_lit) for (; n2 = e2.pending_buf[e2.d_buf + 2 * o2] << 8 | e2.pending_buf[e2.d_buf + 2 * o2 + 1], i2 = e2.pending_buf[e2.l_buf + o2], o2++, 0 === n2 ? L(e2, i2, t2) : (L(e2, (s2 = A[i2]) + u + 1, t2), 0 !== (a2 = w[s2]) && P(e2, i2 -= I[s2], a2), L(e2, s2 = N(--n2), r2), 0 !== (a2 = k[s2]) && P(e2, n2 -= T[s2], a2)), o2 < e2.last_lit; ) ;
            L(e2, m, t2);
          }
          function Y(e2, t2) {
            var r2, n2, i2, s2 = t2.dyn_tree, a2 = t2.stat_desc.static_tree, o2 = t2.stat_desc.has_stree, h2 = t2.stat_desc.elems, u2 = -1;
            for (e2.heap_len = 0, e2.heap_max = _, r2 = 0; r2 < h2; r2++) 0 !== s2[2 * r2] ? (e2.heap[++e2.heap_len] = u2 = r2, e2.depth[r2] = 0) : s2[2 * r2 + 1] = 0;
            for (; e2.heap_len < 2; ) s2[2 * (i2 = e2.heap[++e2.heap_len] = u2 < 2 ? ++u2 : 0)] = 1, e2.depth[i2] = 0, e2.opt_len--, o2 && (e2.static_len -= a2[2 * i2 + 1]);
            for (t2.max_code = u2, r2 = e2.heap_len >> 1; 1 <= r2; r2--) G(e2, s2, r2);
            for (i2 = h2; r2 = e2.heap[1], e2.heap[1] = e2.heap[e2.heap_len--], G(e2, s2, 1), n2 = e2.heap[1], e2.heap[--e2.heap_max] = r2, e2.heap[--e2.heap_max] = n2, s2[2 * i2] = s2[2 * r2] + s2[2 * n2], e2.depth[i2] = (e2.depth[r2] >= e2.depth[n2] ? e2.depth[r2] : e2.depth[n2]) + 1, s2[2 * r2 + 1] = s2[2 * n2 + 1] = i2, e2.heap[1] = i2++, G(e2, s2, 1), 2 <= e2.heap_len; ) ;
            e2.heap[--e2.heap_max] = e2.heap[1], (function(e3, t3) {
              var r3, n3, i3, s3, a3, o3, h3 = t3.dyn_tree, u3 = t3.max_code, l2 = t3.stat_desc.static_tree, f2 = t3.stat_desc.has_stree, c2 = t3.stat_desc.extra_bits, d2 = t3.stat_desc.extra_base, p2 = t3.stat_desc.max_length, m2 = 0;
              for (s3 = 0; s3 <= g; s3++) e3.bl_count[s3] = 0;
              for (h3[2 * e3.heap[e3.heap_max] + 1] = 0, r3 = e3.heap_max + 1; r3 < _; r3++) p2 < (s3 = h3[2 * h3[2 * (n3 = e3.heap[r3]) + 1] + 1] + 1) && (s3 = p2, m2++), h3[2 * n3 + 1] = s3, u3 < n3 || (e3.bl_count[s3]++, a3 = 0, d2 <= n3 && (a3 = c2[n3 - d2]), o3 = h3[2 * n3], e3.opt_len += o3 * (s3 + a3), f2 && (e3.static_len += o3 * (l2[2 * n3 + 1] + a3)));
              if (0 !== m2) {
                do {
                  for (s3 = p2 - 1; 0 === e3.bl_count[s3]; ) s3--;
                  e3.bl_count[s3]--, e3.bl_count[s3 + 1] += 2, e3.bl_count[p2]--, m2 -= 2;
                } while (0 < m2);
                for (s3 = p2; 0 !== s3; s3--) for (n3 = e3.bl_count[s3]; 0 !== n3; ) u3 < (i3 = e3.heap[--r3]) || (h3[2 * i3 + 1] !== s3 && (e3.opt_len += (s3 - h3[2 * i3 + 1]) * h3[2 * i3], h3[2 * i3 + 1] = s3), n3--);
              }
            })(e2, t2), Z(s2, u2, e2.bl_count);
          }
          function X(e2, t2, r2) {
            var n2, i2, s2 = -1, a2 = t2[1], o2 = 0, h2 = 7, u2 = 4;
            for (0 === a2 && (h2 = 138, u2 = 3), t2[2 * (r2 + 1) + 1] = 65535, n2 = 0; n2 <= r2; n2++) i2 = a2, a2 = t2[2 * (n2 + 1) + 1], ++o2 < h2 && i2 === a2 || (o2 < u2 ? e2.bl_tree[2 * i2] += o2 : 0 !== i2 ? (i2 !== s2 && e2.bl_tree[2 * i2]++, e2.bl_tree[2 * b]++) : o2 <= 10 ? e2.bl_tree[2 * v]++ : e2.bl_tree[2 * y]++, s2 = i2, u2 = (o2 = 0) === a2 ? (h2 = 138, 3) : i2 === a2 ? (h2 = 6, 3) : (h2 = 7, 4));
          }
          function V(e2, t2, r2) {
            var n2, i2, s2 = -1, a2 = t2[1], o2 = 0, h2 = 7, u2 = 4;
            for (0 === a2 && (h2 = 138, u2 = 3), n2 = 0; n2 <= r2; n2++) if (i2 = a2, a2 = t2[2 * (n2 + 1) + 1], !(++o2 < h2 && i2 === a2)) {
              if (o2 < u2) for (; L(e2, i2, e2.bl_tree), 0 != --o2; ) ;
              else 0 !== i2 ? (i2 !== s2 && (L(e2, i2, e2.bl_tree), o2--), L(e2, b, e2.bl_tree), P(e2, o2 - 3, 2)) : o2 <= 10 ? (L(e2, v, e2.bl_tree), P(e2, o2 - 3, 3)) : (L(e2, y, e2.bl_tree), P(e2, o2 - 11, 7));
              s2 = i2, u2 = (o2 = 0) === a2 ? (h2 = 138, 3) : i2 === a2 ? (h2 = 6, 3) : (h2 = 7, 4);
            }
          }
          n(T);
          var q = false;
          function J(e2, t2, r2, n2) {
            P(e2, (s << 1) + (n2 ? 1 : 0), 3), (function(e3, t3, r3, n3) {
              M(e3), n3 && (U(e3, r3), U(e3, ~r3)), i.arraySet(e3.pending_buf, e3.window, t3, r3, e3.pending), e3.pending += r3;
            })(e2, t2, r2, true);
          }
          r._tr_init = function(e2) {
            q || ((function() {
              var e3, t2, r2, n2, i2, s2 = new Array(g + 1);
              for (n2 = r2 = 0; n2 < a - 1; n2++) for (I[n2] = r2, e3 = 0; e3 < 1 << w[n2]; e3++) A[r2++] = n2;
              for (A[r2 - 1] = n2, n2 = i2 = 0; n2 < 16; n2++) for (T[n2] = i2, e3 = 0; e3 < 1 << k[n2]; e3++) E[i2++] = n2;
              for (i2 >>= 7; n2 < f; n2++) for (T[n2] = i2 << 7, e3 = 0; e3 < 1 << k[n2] - 7; e3++) E[256 + i2++] = n2;
              for (t2 = 0; t2 <= g; t2++) s2[t2] = 0;
              for (e3 = 0; e3 <= 143; ) z[2 * e3 + 1] = 8, e3++, s2[8]++;
              for (; e3 <= 255; ) z[2 * e3 + 1] = 9, e3++, s2[9]++;
              for (; e3 <= 279; ) z[2 * e3 + 1] = 7, e3++, s2[7]++;
              for (; e3 <= 287; ) z[2 * e3 + 1] = 8, e3++, s2[8]++;
              for (Z(z, l + 1, s2), e3 = 0; e3 < f; e3++) C[2 * e3 + 1] = 5, C[2 * e3] = j(e3, 5);
              O = new D(z, w, u + 1, l, g), B = new D(C, k, 0, f, g), R = new D(new Array(0), x, 0, c, p);
            })(), q = true), e2.l_desc = new F(e2.dyn_ltree, O), e2.d_desc = new F(e2.dyn_dtree, B), e2.bl_desc = new F(e2.bl_tree, R), e2.bi_buf = 0, e2.bi_valid = 0, W(e2);
          }, r._tr_stored_block = J, r._tr_flush_block = function(e2, t2, r2, n2) {
            var i2, s2, a2 = 0;
            0 < e2.level ? (2 === e2.strm.data_type && (e2.strm.data_type = (function(e3) {
              var t3, r3 = 4093624447;
              for (t3 = 0; t3 <= 31; t3++, r3 >>>= 1) if (1 & r3 && 0 !== e3.dyn_ltree[2 * t3]) return o;
              if (0 !== e3.dyn_ltree[18] || 0 !== e3.dyn_ltree[20] || 0 !== e3.dyn_ltree[26]) return h;
              for (t3 = 32; t3 < u; t3++) if (0 !== e3.dyn_ltree[2 * t3]) return h;
              return o;
            })(e2)), Y(e2, e2.l_desc), Y(e2, e2.d_desc), a2 = (function(e3) {
              var t3;
              for (X(e3, e3.dyn_ltree, e3.l_desc.max_code), X(e3, e3.dyn_dtree, e3.d_desc.max_code), Y(e3, e3.bl_desc), t3 = c - 1; 3 <= t3 && 0 === e3.bl_tree[2 * S[t3] + 1]; t3--) ;
              return e3.opt_len += 3 * (t3 + 1) + 5 + 5 + 4, t3;
            })(e2), i2 = e2.opt_len + 3 + 7 >>> 3, (s2 = e2.static_len + 3 + 7 >>> 3) <= i2 && (i2 = s2)) : i2 = s2 = r2 + 5, r2 + 4 <= i2 && -1 !== t2 ? J(e2, t2, r2, n2) : 4 === e2.strategy || s2 === i2 ? (P(e2, 2 + (n2 ? 1 : 0), 3), K(e2, z, C)) : (P(e2, 4 + (n2 ? 1 : 0), 3), (function(e3, t3, r3, n3) {
              var i3;
              for (P(e3, t3 - 257, 5), P(e3, r3 - 1, 5), P(e3, n3 - 4, 4), i3 = 0; i3 < n3; i3++) P(e3, e3.bl_tree[2 * S[i3] + 1], 3);
              V(e3, e3.dyn_ltree, t3 - 1), V(e3, e3.dyn_dtree, r3 - 1);
            })(e2, e2.l_desc.max_code + 1, e2.d_desc.max_code + 1, a2 + 1), K(e2, e2.dyn_ltree, e2.dyn_dtree)), W(e2), n2 && M(e2);
          }, r._tr_tally = function(e2, t2, r2) {
            return e2.pending_buf[e2.d_buf + 2 * e2.last_lit] = t2 >>> 8 & 255, e2.pending_buf[e2.d_buf + 2 * e2.last_lit + 1] = 255 & t2, e2.pending_buf[e2.l_buf + e2.last_lit] = 255 & r2, e2.last_lit++, 0 === t2 ? e2.dyn_ltree[2 * r2]++ : (e2.matches++, t2--, e2.dyn_ltree[2 * (A[r2] + u + 1)]++, e2.dyn_dtree[2 * N(t2)]++), e2.last_lit === e2.lit_bufsize - 1;
          }, r._tr_align = function(e2) {
            P(e2, 2, 3), L(e2, m, z), (function(e3) {
              16 === e3.bi_valid ? (U(e3, e3.bi_buf), e3.bi_buf = 0, e3.bi_valid = 0) : 8 <= e3.bi_valid && (e3.pending_buf[e3.pending++] = 255 & e3.bi_buf, e3.bi_buf >>= 8, e3.bi_valid -= 8);
            })(e2);
          };
        }, { "../utils/common": 41 }], 53: [function(e, t, r) {
          "use strict";
          t.exports = function() {
            this.input = null, this.next_in = 0, this.avail_in = 0, this.total_in = 0, this.output = null, this.next_out = 0, this.avail_out = 0, this.total_out = 0, this.msg = "", this.state = null, this.data_type = 2, this.adler = 0;
          };
        }, {}], 54: [function(e, t, r) {
          (function(e2) {
            !(function(r2, n) {
              "use strict";
              if (!r2.setImmediate) {
                var i, s, t2, a, o = 1, h = {}, u = false, l = r2.document, e3 = Object.getPrototypeOf && Object.getPrototypeOf(r2);
                e3 = e3 && e3.setTimeout ? e3 : r2, i = "[object process]" === {}.toString.call(r2.process) ? function(e4) {
                  process.nextTick(function() {
                    c(e4);
                  });
                } : (function() {
                  if (r2.postMessage && !r2.importScripts) {
                    var e4 = true, t3 = r2.onmessage;
                    return r2.onmessage = function() {
                      e4 = false;
                    }, r2.postMessage("", "*"), r2.onmessage = t3, e4;
                  }
                })() ? (a = "setImmediate$" + Math.random() + "$", r2.addEventListener ? r2.addEventListener("message", d, false) : r2.attachEvent("onmessage", d), function(e4) {
                  r2.postMessage(a + e4, "*");
                }) : r2.MessageChannel ? ((t2 = new MessageChannel()).port1.onmessage = function(e4) {
                  c(e4.data);
                }, function(e4) {
                  t2.port2.postMessage(e4);
                }) : l && "onreadystatechange" in l.createElement("script") ? (s = l.documentElement, function(e4) {
                  var t3 = l.createElement("script");
                  t3.onreadystatechange = function() {
                    c(e4), t3.onreadystatechange = null, s.removeChild(t3), t3 = null;
                  }, s.appendChild(t3);
                }) : function(e4) {
                  setTimeout(c, 0, e4);
                }, e3.setImmediate = function(e4) {
                  "function" != typeof e4 && (e4 = new Function("" + e4));
                  for (var t3 = new Array(arguments.length - 1), r3 = 0; r3 < t3.length; r3++) t3[r3] = arguments[r3 + 1];
                  var n2 = { callback: e4, args: t3 };
                  return h[o] = n2, i(o), o++;
                }, e3.clearImmediate = f;
              }
              function f(e4) {
                delete h[e4];
              }
              function c(e4) {
                if (u) setTimeout(c, 0, e4);
                else {
                  var t3 = h[e4];
                  if (t3) {
                    u = true;
                    try {
                      !(function(e5) {
                        var t4 = e5.callback, r3 = e5.args;
                        switch (r3.length) {
                          case 0:
                            t4();
                            break;
                          case 1:
                            t4(r3[0]);
                            break;
                          case 2:
                            t4(r3[0], r3[1]);
                            break;
                          case 3:
                            t4(r3[0], r3[1], r3[2]);
                            break;
                          default:
                            t4.apply(n, r3);
                        }
                      })(t3);
                    } finally {
                      f(e4), u = false;
                    }
                  }
                }
              }
              function d(e4) {
                e4.source === r2 && "string" == typeof e4.data && 0 === e4.data.indexOf(a) && c(+e4.data.slice(a.length));
              }
            })("undefined" == typeof self ? void 0 === e2 ? this : e2 : self);
          }).call(this, "undefined" != typeof globalThis ? globalThis : "undefined" != typeof self ? self : "undefined" != typeof window ? window : {});
        }, {}] }, {}, [10])(10);
      });
    }
  });

  // node_modules/pizzip/js/base64.js
  var require_base64 = __commonJS({
    "node_modules/pizzip/js/base64.js"(exports) {
      "use strict";
      var _keyStr = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
      exports.encode = function(input) {
        var output = "";
        var chr1, chr2, chr3, enc1, enc2, enc3, enc4;
        var i = 0;
        while (i < input.length) {
          chr1 = input.charCodeAt(i++);
          chr2 = input.charCodeAt(i++);
          chr3 = input.charCodeAt(i++);
          enc1 = chr1 >> 2;
          enc2 = (chr1 & 3) << 4 | chr2 >> 4;
          enc3 = (chr2 & 15) << 2 | chr3 >> 6;
          enc4 = chr3 & 63;
          if (isNaN(chr2)) {
            enc3 = enc4 = 64;
          } else if (isNaN(chr3)) {
            enc4 = 64;
          }
          output = output + _keyStr.charAt(enc1) + _keyStr.charAt(enc2) + _keyStr.charAt(enc3) + _keyStr.charAt(enc4);
        }
        return output;
      };
      exports.decode = function(input) {
        var output = "";
        var chr1, chr2, chr3;
        var enc1, enc2, enc3, enc4;
        var i = 0;
        input = input.replace(/[^A-Za-z0-9\+\/\=]/g, "");
        while (i < input.length) {
          enc1 = _keyStr.indexOf(input.charAt(i++));
          enc2 = _keyStr.indexOf(input.charAt(i++));
          enc3 = _keyStr.indexOf(input.charAt(i++));
          enc4 = _keyStr.indexOf(input.charAt(i++));
          chr1 = enc1 << 2 | enc2 >> 4;
          chr2 = (enc2 & 15) << 4 | enc3 >> 2;
          chr3 = (enc3 & 3) << 6 | enc4;
          output += String.fromCharCode(chr1);
          if (enc3 !== 64) {
            output += String.fromCharCode(chr2);
          }
          if (enc4 !== 64) {
            output += String.fromCharCode(chr3);
          }
        }
        return output;
      };
    }
  });

  // node_modules/pizzip/js/support.js
  var require_support = __commonJS({
    "node_modules/pizzip/js/support.js"(exports) {
      "use strict";
      exports.base64 = true;
      exports.array = true;
      exports.string = true;
      exports.arraybuffer = typeof ArrayBuffer !== "undefined" && typeof Uint8Array !== "undefined";
      exports.nodebuffer = typeof Buffer !== "undefined";
      exports.uint8array = typeof Uint8Array !== "undefined";
      if (typeof ArrayBuffer === "undefined") {
        exports.blob = false;
      } else {
        buffer = new ArrayBuffer(0);
        try {
          exports.blob = new Blob([buffer], {
            type: "application/zip"
          }).size === 0;
        } catch (_unused) {
          try {
            Builder = window.BlobBuilder || window.WebKitBlobBuilder || window.MozBlobBuilder || window.MSBlobBuilder;
            builder = new Builder();
            builder.append(buffer);
            exports.blob = builder.getBlob("application/zip").size === 0;
          } catch (_unused2) {
            exports.blob = false;
          }
        }
      }
      var buffer;
      var Builder;
      var builder;
    }
  });

  // node_modules/pako/dist/pako.es5.min.js
  var require_pako_es5_min = __commonJS({
    "node_modules/pako/dist/pako.es5.min.js"(exports, module) {
      !(function(t, e) {
        "object" == typeof exports && "undefined" != typeof module ? e(exports) : "function" == typeof define && define.amd ? define(["exports"], e) : e((t = "undefined" != typeof globalThis ? globalThis : t || self).pako = {});
      })(exports, (function(t) {
        "use strict";
        function e(t2) {
          for (var e2 = t2.length; --e2 >= 0; ) t2[e2] = 0;
        }
        var a = 256, n = 286, i = 30, r = 15, s = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]), o = new Uint8Array([0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]), l = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 7]), h = new Uint8Array([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]), d = new Array(576);
        e(d);
        var _ = new Array(60);
        e(_);
        var f = new Array(512);
        e(f);
        var u = new Array(256);
        e(u);
        var c = new Array(29);
        e(c);
        var w, m, b, g = new Array(i);
        function p(t2, e2, a2, n2, i2) {
          this.static_tree = t2, this.extra_bits = e2, this.extra_base = a2, this.elems = n2, this.max_length = i2, this.has_stree = t2 && t2.length;
        }
        function v(t2, e2) {
          this.dyn_tree = t2, this.max_code = 0, this.stat_desc = e2;
        }
        e(g);
        var k = function(t2) {
          return t2 < 256 ? f[t2] : f[256 + (t2 >>> 7)];
        }, y = function(t2, e2) {
          t2.pending_buf[t2.pending++] = 255 & e2, t2.pending_buf[t2.pending++] = e2 >>> 8 & 255;
        }, x = function(t2, e2, a2) {
          t2.bi_valid > 16 - a2 ? (t2.bi_buf |= e2 << t2.bi_valid & 65535, y(t2, t2.bi_buf), t2.bi_buf = e2 >> 16 - t2.bi_valid, t2.bi_valid += a2 - 16) : (t2.bi_buf |= e2 << t2.bi_valid & 65535, t2.bi_valid += a2);
        }, z = function(t2, e2, a2) {
          x(t2, a2[2 * e2], a2[2 * e2 + 1]);
        }, A = function(t2, e2) {
          var a2 = 0;
          do {
            a2 |= 1 & t2, t2 >>>= 1, a2 <<= 1;
          } while (--e2 > 0);
          return a2 >>> 1;
        }, E = function(t2, e2, a2) {
          var n2, i2, s2 = new Array(16), o2 = 0;
          for (n2 = 1; n2 <= r; n2++) o2 = o2 + a2[n2 - 1] << 1, s2[n2] = o2;
          for (i2 = 0; i2 <= e2; i2++) {
            var l2 = t2[2 * i2 + 1];
            0 !== l2 && (t2[2 * i2] = A(s2[l2]++, l2));
          }
        }, R = function(t2) {
          var e2;
          for (e2 = 0; e2 < n; e2++) t2.dyn_ltree[2 * e2] = 0;
          for (e2 = 0; e2 < i; e2++) t2.dyn_dtree[2 * e2] = 0;
          for (e2 = 0; e2 < 19; e2++) t2.bl_tree[2 * e2] = 0;
          t2.dyn_ltree[512] = 1, t2.opt_len = t2.static_len = 0, t2.sym_next = t2.matches = 0;
        }, Z = function(t2) {
          t2.bi_valid > 8 ? y(t2, t2.bi_buf) : t2.bi_valid > 0 && (t2.pending_buf[t2.pending++] = t2.bi_buf), t2.bi_buf = 0, t2.bi_valid = 0;
        }, S = function(t2, e2, a2, n2) {
          var i2 = 2 * e2, r2 = 2 * a2;
          return t2[i2] < t2[r2] || t2[i2] === t2[r2] && n2[e2] <= n2[a2];
        }, U = function(t2, e2, a2) {
          for (var n2 = t2.heap[a2], i2 = a2 << 1; i2 <= t2.heap_len && (i2 < t2.heap_len && S(e2, t2.heap[i2 + 1], t2.heap[i2], t2.depth) && i2++, !S(e2, n2, t2.heap[i2], t2.depth)); ) t2.heap[a2] = t2.heap[i2], a2 = i2, i2 <<= 1;
          t2.heap[a2] = n2;
        }, D = function(t2, e2, n2) {
          var i2, r2, l2, h2, d2 = 0;
          if (0 !== t2.sym_next) do {
            i2 = 255 & t2.pending_buf[t2.sym_buf + d2++], i2 += (255 & t2.pending_buf[t2.sym_buf + d2++]) << 8, r2 = t2.pending_buf[t2.sym_buf + d2++], 0 === i2 ? z(t2, r2, e2) : (l2 = u[r2], z(t2, l2 + a + 1, e2), 0 !== (h2 = s[l2]) && (r2 -= c[l2], x(t2, r2, h2)), i2--, l2 = k(i2), z(t2, l2, n2), 0 !== (h2 = o[l2]) && (i2 -= g[l2], x(t2, i2, h2)));
          } while (d2 < t2.sym_next);
          z(t2, 256, e2);
        }, T = function(t2, e2) {
          var a2, n2, i2, s2 = e2.dyn_tree, o2 = e2.stat_desc.static_tree, l2 = e2.stat_desc.has_stree, h2 = e2.stat_desc.elems, d2 = -1;
          for (t2.heap_len = 0, t2.heap_max = 573, a2 = 0; a2 < h2; a2++) 0 !== s2[2 * a2] ? (t2.heap[++t2.heap_len] = d2 = a2, t2.depth[a2] = 0) : s2[2 * a2 + 1] = 0;
          for (; t2.heap_len < 2; ) s2[2 * (i2 = t2.heap[++t2.heap_len] = d2 < 2 ? ++d2 : 0)] = 1, t2.depth[i2] = 0, t2.opt_len--, l2 && (t2.static_len -= o2[2 * i2 + 1]);
          for (e2.max_code = d2, a2 = t2.heap_len >> 1; a2 >= 1; a2--) U(t2, s2, a2);
          i2 = h2;
          do {
            a2 = t2.heap[1], t2.heap[1] = t2.heap[t2.heap_len--], U(t2, s2, 1), n2 = t2.heap[1], t2.heap[--t2.heap_max] = a2, t2.heap[--t2.heap_max] = n2, s2[2 * i2] = s2[2 * a2] + s2[2 * n2], t2.depth[i2] = (t2.depth[a2] >= t2.depth[n2] ? t2.depth[a2] : t2.depth[n2]) + 1, s2[2 * a2 + 1] = s2[2 * n2 + 1] = i2, t2.heap[1] = i2++, U(t2, s2, 1);
          } while (t2.heap_len >= 2);
          t2.heap[--t2.heap_max] = t2.heap[1], (function(t3, e3) {
            var a3, n3, i3, s3, o3, l3, h3 = e3.dyn_tree, d3 = e3.max_code, _2 = e3.stat_desc.static_tree, f2 = e3.stat_desc.has_stree, u2 = e3.stat_desc.extra_bits, c2 = e3.stat_desc.extra_base, w2 = e3.stat_desc.max_length, m2 = 0;
            for (s3 = 0; s3 <= r; s3++) t3.bl_count[s3] = 0;
            for (h3[2 * t3.heap[t3.heap_max] + 1] = 0, a3 = t3.heap_max + 1; a3 < 573; a3++) (s3 = h3[2 * h3[2 * (n3 = t3.heap[a3]) + 1] + 1] + 1) > w2 && (s3 = w2, m2++), h3[2 * n3 + 1] = s3, n3 > d3 || (t3.bl_count[s3]++, o3 = 0, n3 >= c2 && (o3 = u2[n3 - c2]), l3 = h3[2 * n3], t3.opt_len += l3 * (s3 + o3), f2 && (t3.static_len += l3 * (_2[2 * n3 + 1] + o3)));
            if (0 !== m2) {
              do {
                for (s3 = w2 - 1; 0 === t3.bl_count[s3]; ) s3--;
                t3.bl_count[s3]--, t3.bl_count[s3 + 1] += 2, t3.bl_count[w2]--, m2 -= 2;
              } while (m2 > 0);
              for (s3 = w2; 0 !== s3; s3--) for (n3 = t3.bl_count[s3]; 0 !== n3; ) (i3 = t3.heap[--a3]) > d3 || (h3[2 * i3 + 1] !== s3 && (t3.opt_len += (s3 - h3[2 * i3 + 1]) * h3[2 * i3], h3[2 * i3 + 1] = s3), n3--);
            }
          })(t2, e2), E(s2, d2, t2.bl_count);
        }, O = function(t2, e2, a2) {
          var n2, i2, r2 = -1, s2 = e2[1], o2 = 0, l2 = 7, h2 = 4;
          for (0 === s2 && (l2 = 138, h2 = 3), e2[2 * (a2 + 1) + 1] = 65535, n2 = 0; n2 <= a2; n2++) i2 = s2, s2 = e2[2 * (n2 + 1) + 1], ++o2 < l2 && i2 === s2 || (o2 < h2 ? t2.bl_tree[2 * i2] += o2 : 0 !== i2 ? (i2 !== r2 && t2.bl_tree[2 * i2]++, t2.bl_tree[32]++) : o2 <= 10 ? t2.bl_tree[34]++ : t2.bl_tree[36]++, o2 = 0, r2 = i2, 0 === s2 ? (l2 = 138, h2 = 3) : i2 === s2 ? (l2 = 6, h2 = 3) : (l2 = 7, h2 = 4));
        }, I = function(t2, e2, a2) {
          var n2, i2, r2 = -1, s2 = e2[1], o2 = 0, l2 = 7, h2 = 4;
          for (0 === s2 && (l2 = 138, h2 = 3), n2 = 0; n2 <= a2; n2++) if (i2 = s2, s2 = e2[2 * (n2 + 1) + 1], !(++o2 < l2 && i2 === s2)) {
            if (o2 < h2) do {
              z(t2, i2, t2.bl_tree);
            } while (0 != --o2);
            else 0 !== i2 ? (i2 !== r2 && (z(t2, i2, t2.bl_tree), o2--), z(t2, 16, t2.bl_tree), x(t2, o2 - 3, 2)) : o2 <= 10 ? (z(t2, 17, t2.bl_tree), x(t2, o2 - 3, 3)) : (z(t2, 18, t2.bl_tree), x(t2, o2 - 11, 7));
            o2 = 0, r2 = i2, 0 === s2 ? (l2 = 138, h2 = 3) : i2 === s2 ? (l2 = 6, h2 = 3) : (l2 = 7, h2 = 4);
          }
        }, F = false, L = function(t2, e2, a2, n2) {
          x(t2, 0 + (n2 ? 1 : 0), 3), Z(t2), y(t2, a2), y(t2, ~a2), a2 && t2.pending_buf.set(t2.window.subarray(e2, e2 + a2), t2.pending), t2.pending += a2;
        }, N = function(t2, e2, n2, i2) {
          var r2, s2, o2 = 0;
          t2.level > 0 ? (2 === t2.strm.data_type && (t2.strm.data_type = (function(t3) {
            var e3, n3 = 4093624447;
            for (e3 = 0; e3 <= 31; e3++, n3 >>>= 1) if (1 & n3 && 0 !== t3.dyn_ltree[2 * e3]) return 0;
            if (0 !== t3.dyn_ltree[18] || 0 !== t3.dyn_ltree[20] || 0 !== t3.dyn_ltree[26]) return 1;
            for (e3 = 32; e3 < a; e3++) if (0 !== t3.dyn_ltree[2 * e3]) return 1;
            return 0;
          })(t2)), T(t2, t2.l_desc), T(t2, t2.d_desc), o2 = (function(t3) {
            var e3;
            for (O(t3, t3.dyn_ltree, t3.l_desc.max_code), O(t3, t3.dyn_dtree, t3.d_desc.max_code), T(t3, t3.bl_desc), e3 = 18; e3 >= 3 && 0 === t3.bl_tree[2 * h[e3] + 1]; e3--) ;
            return t3.opt_len += 3 * (e3 + 1) + 5 + 5 + 4, e3;
          })(t2), r2 = t2.opt_len + 3 + 7 >>> 3, (s2 = t2.static_len + 3 + 7 >>> 3) <= r2 && (r2 = s2)) : r2 = s2 = n2 + 5, n2 + 4 <= r2 && -1 !== e2 ? L(t2, e2, n2, i2) : 4 === t2.strategy || s2 === r2 ? (x(t2, 2 + (i2 ? 1 : 0), 3), D(t2, d, _)) : (x(t2, 4 + (i2 ? 1 : 0), 3), (function(t3, e3, a2, n3) {
            var i3;
            for (x(t3, e3 - 257, 5), x(t3, a2 - 1, 5), x(t3, n3 - 4, 4), i3 = 0; i3 < n3; i3++) x(t3, t3.bl_tree[2 * h[i3] + 1], 3);
            I(t3, t3.dyn_ltree, e3 - 1), I(t3, t3.dyn_dtree, a2 - 1);
          })(t2, t2.l_desc.max_code + 1, t2.d_desc.max_code + 1, o2 + 1), D(t2, t2.dyn_ltree, t2.dyn_dtree)), R(t2), i2 && Z(t2);
        }, B = { _tr_init: function(t2) {
          F || (!(function() {
            var t3, e2, a2, h2, v2, k2 = new Array(16);
            for (a2 = 0, h2 = 0; h2 < 28; h2++) for (c[h2] = a2, t3 = 0; t3 < 1 << s[h2]; t3++) u[a2++] = h2;
            for (u[a2 - 1] = h2, v2 = 0, h2 = 0; h2 < 16; h2++) for (g[h2] = v2, t3 = 0; t3 < 1 << o[h2]; t3++) f[v2++] = h2;
            for (v2 >>= 7; h2 < i; h2++) for (g[h2] = v2 << 7, t3 = 0; t3 < 1 << o[h2] - 7; t3++) f[256 + v2++] = h2;
            for (e2 = 0; e2 <= r; e2++) k2[e2] = 0;
            for (t3 = 0; t3 <= 143; ) d[2 * t3 + 1] = 8, t3++, k2[8]++;
            for (; t3 <= 255; ) d[2 * t3 + 1] = 9, t3++, k2[9]++;
            for (; t3 <= 279; ) d[2 * t3 + 1] = 7, t3++, k2[7]++;
            for (; t3 <= 287; ) d[2 * t3 + 1] = 8, t3++, k2[8]++;
            for (E(d, 287, k2), t3 = 0; t3 < i; t3++) _[2 * t3 + 1] = 5, _[2 * t3] = A(t3, 5);
            w = new p(d, s, 257, n, r), m = new p(_, o, 0, i, r), b = new p(new Array(0), l, 0, 19, 7);
          })(), F = true), t2.l_desc = new v(t2.dyn_ltree, w), t2.d_desc = new v(t2.dyn_dtree, m), t2.bl_desc = new v(t2.bl_tree, b), t2.bi_buf = 0, t2.bi_valid = 0, R(t2);
        }, _tr_stored_block: L, _tr_flush_block: N, _tr_tally: function(t2, e2, n2) {
          return t2.pending_buf[t2.sym_buf + t2.sym_next++] = e2, t2.pending_buf[t2.sym_buf + t2.sym_next++] = e2 >> 8, t2.pending_buf[t2.sym_buf + t2.sym_next++] = n2, 0 === e2 ? t2.dyn_ltree[2 * n2]++ : (t2.matches++, e2--, t2.dyn_ltree[2 * (u[n2] + a + 1)]++, t2.dyn_dtree[2 * k(e2)]++), t2.sym_next === t2.sym_end;
        }, _tr_align: function(t2) {
          x(t2, 2, 3), z(t2, 256, d), (function(t3) {
            16 === t3.bi_valid ? (y(t3, t3.bi_buf), t3.bi_buf = 0, t3.bi_valid = 0) : t3.bi_valid >= 8 && (t3.pending_buf[t3.pending++] = 255 & t3.bi_buf, t3.bi_buf >>= 8, t3.bi_valid -= 8);
          })(t2);
        } }, C = function(t2, e2, a2, n2) {
          for (var i2 = 65535 & t2 | 0, r2 = t2 >>> 16 & 65535 | 0, s2 = 0; 0 !== a2; ) {
            a2 -= s2 = a2 > 2e3 ? 2e3 : a2;
            do {
              r2 = r2 + (i2 = i2 + e2[n2++] | 0) | 0;
            } while (--s2);
            i2 %= 65521, r2 %= 65521;
          }
          return i2 | r2 << 16 | 0;
        }, M = new Uint32Array((function() {
          for (var t2, e2 = [], a2 = 0; a2 < 256; a2++) {
            t2 = a2;
            for (var n2 = 0; n2 < 8; n2++) t2 = 1 & t2 ? 3988292384 ^ t2 >>> 1 : t2 >>> 1;
            e2[a2] = t2;
          }
          return e2;
        })()), H = function(t2, e2, a2, n2) {
          var i2 = M, r2 = n2 + a2;
          t2 ^= -1;
          for (var s2 = n2; s2 < r2; s2++) t2 = t2 >>> 8 ^ i2[255 & (t2 ^ e2[s2])];
          return -1 ^ t2;
        }, j = { 2: "need dictionary", 1: "stream end", 0: "", "-1": "file error", "-2": "stream error", "-3": "data error", "-4": "insufficient memory", "-5": "buffer error", "-6": "incompatible version" }, K = { Z_NO_FLUSH: 0, Z_PARTIAL_FLUSH: 1, Z_SYNC_FLUSH: 2, Z_FULL_FLUSH: 3, Z_FINISH: 4, Z_BLOCK: 5, Z_TREES: 6, Z_OK: 0, Z_STREAM_END: 1, Z_NEED_DICT: 2, Z_ERRNO: -1, Z_STREAM_ERROR: -2, Z_DATA_ERROR: -3, Z_MEM_ERROR: -4, Z_BUF_ERROR: -5, Z_NO_COMPRESSION: 0, Z_BEST_SPEED: 1, Z_BEST_COMPRESSION: 9, Z_DEFAULT_COMPRESSION: -1, Z_FILTERED: 1, Z_HUFFMAN_ONLY: 2, Z_RLE: 3, Z_FIXED: 4, Z_DEFAULT_STRATEGY: 0, Z_BINARY: 0, Z_TEXT: 1, Z_UNKNOWN: 2, Z_DEFLATED: 8 }, P = B._tr_init, Y = B._tr_stored_block, G = B._tr_flush_block, X = B._tr_tally, W = B._tr_align, q = K.Z_NO_FLUSH, J = K.Z_PARTIAL_FLUSH, Q = K.Z_FULL_FLUSH, V = K.Z_FINISH, $ = K.Z_BLOCK, tt = K.Z_OK, et = K.Z_STREAM_END, at = K.Z_STREAM_ERROR, nt = K.Z_DATA_ERROR, it = K.Z_BUF_ERROR, rt = K.Z_DEFAULT_COMPRESSION, st = K.Z_FILTERED, ot = K.Z_HUFFMAN_ONLY, lt = K.Z_RLE, ht = K.Z_FIXED, dt = K.Z_DEFAULT_STRATEGY, _t = K.Z_UNKNOWN, ft = K.Z_DEFLATED, ut = 258, ct = 262, wt = 42, mt = 113, bt = 666, gt = function(t2, e2) {
          return t2.msg = j[e2], e2;
        }, pt = function(t2) {
          return 2 * t2 - (t2 > 4 ? 9 : 0);
        }, vt = function(t2) {
          for (var e2 = t2.length; --e2 >= 0; ) t2[e2] = 0;
        }, kt = function(t2) {
          var e2, a2, n2, i2 = t2.w_size;
          n2 = e2 = t2.hash_size;
          do {
            a2 = t2.head[--n2], t2.head[n2] = a2 >= i2 ? a2 - i2 : 0;
          } while (--e2);
          n2 = e2 = i2;
          do {
            a2 = t2.prev[--n2], t2.prev[n2] = a2 >= i2 ? a2 - i2 : 0;
          } while (--e2);
        }, yt = function(t2, e2, a2) {
          return (e2 << t2.hash_shift ^ a2) & t2.hash_mask;
        }, xt = function(t2) {
          var e2 = t2.state, a2 = e2.pending;
          a2 > t2.avail_out && (a2 = t2.avail_out), 0 !== a2 && (t2.output.set(e2.pending_buf.subarray(e2.pending_out, e2.pending_out + a2), t2.next_out), t2.next_out += a2, e2.pending_out += a2, t2.total_out += a2, t2.avail_out -= a2, e2.pending -= a2, 0 === e2.pending && (e2.pending_out = 0));
        }, zt = function(t2, e2) {
          G(t2, t2.block_start >= 0 ? t2.block_start : -1, t2.strstart - t2.block_start, e2), t2.block_start = t2.strstart, xt(t2.strm);
        }, At = function(t2, e2) {
          t2.pending_buf[t2.pending++] = e2;
        }, Et = function(t2, e2) {
          t2.pending_buf[t2.pending++] = e2 >>> 8 & 255, t2.pending_buf[t2.pending++] = 255 & e2;
        }, Rt = function(t2, e2, a2, n2) {
          var i2 = t2.avail_in;
          return i2 > n2 && (i2 = n2), 0 === i2 ? 0 : (t2.avail_in -= i2, e2.set(t2.input.subarray(t2.next_in, t2.next_in + i2), a2), 1 === t2.state.wrap ? t2.adler = C(t2.adler, e2, i2, a2) : 2 === t2.state.wrap && (t2.adler = H(t2.adler, e2, i2, a2)), t2.next_in += i2, t2.total_in += i2, i2);
        }, Zt = function(t2, e2) {
          var a2, n2, i2 = t2.max_chain_length, r2 = t2.strstart, s2 = t2.prev_length, o2 = t2.nice_match, l2 = t2.strstart > t2.w_size - ct ? t2.strstart - (t2.w_size - ct) : 0, h2 = t2.window, d2 = t2.w_mask, _2 = t2.prev, f2 = t2.strstart + ut, u2 = h2[r2 + s2 - 1], c2 = h2[r2 + s2];
          t2.prev_length >= t2.good_match && (i2 >>= 2), o2 > t2.lookahead && (o2 = t2.lookahead);
          do {
            if (h2[(a2 = e2) + s2] === c2 && h2[a2 + s2 - 1] === u2 && h2[a2] === h2[r2] && h2[++a2] === h2[r2 + 1]) {
              r2 += 2, a2++;
              do {
              } while (h2[++r2] === h2[++a2] && h2[++r2] === h2[++a2] && h2[++r2] === h2[++a2] && h2[++r2] === h2[++a2] && h2[++r2] === h2[++a2] && h2[++r2] === h2[++a2] && h2[++r2] === h2[++a2] && h2[++r2] === h2[++a2] && r2 < f2);
              if (n2 = ut - (f2 - r2), r2 = f2 - ut, n2 > s2) {
                if (t2.match_start = e2, s2 = n2, n2 >= o2) break;
                u2 = h2[r2 + s2 - 1], c2 = h2[r2 + s2];
              }
            }
          } while ((e2 = _2[e2 & d2]) > l2 && 0 != --i2);
          return s2 <= t2.lookahead ? s2 : t2.lookahead;
        }, St = function(t2) {
          var e2, a2, n2, i2 = t2.w_size;
          do {
            if (a2 = t2.window_size - t2.lookahead - t2.strstart, t2.strstart >= i2 + (i2 - ct) && (t2.window.set(t2.window.subarray(i2, i2 + i2 - a2), 0), t2.match_start -= i2, t2.strstart -= i2, t2.block_start -= i2, t2.insert > t2.strstart && (t2.insert = t2.strstart), kt(t2), a2 += i2), 0 === t2.strm.avail_in) break;
            if (e2 = Rt(t2.strm, t2.window, t2.strstart + t2.lookahead, a2), t2.lookahead += e2, t2.lookahead + t2.insert >= 3) for (n2 = t2.strstart - t2.insert, t2.ins_h = t2.window[n2], t2.ins_h = yt(t2, t2.ins_h, t2.window[n2 + 1]); t2.insert && (t2.ins_h = yt(t2, t2.ins_h, t2.window[n2 + 3 - 1]), t2.prev[n2 & t2.w_mask] = t2.head[t2.ins_h], t2.head[t2.ins_h] = n2, n2++, t2.insert--, !(t2.lookahead + t2.insert < 3)); ) ;
          } while (t2.lookahead < ct && 0 !== t2.strm.avail_in);
        }, Ut = function(t2, e2) {
          var a2, n2, i2, r2 = t2.pending_buf_size - 5 > t2.w_size ? t2.w_size : t2.pending_buf_size - 5, s2 = 0, o2 = t2.strm.avail_in;
          do {
            if (a2 = 65535, i2 = t2.bi_valid + 42 >> 3, t2.strm.avail_out < i2) break;
            if (i2 = t2.strm.avail_out - i2, a2 > (n2 = t2.strstart - t2.block_start) + t2.strm.avail_in && (a2 = n2 + t2.strm.avail_in), a2 > i2 && (a2 = i2), a2 < r2 && (0 === a2 && e2 !== V || e2 === q || a2 !== n2 + t2.strm.avail_in)) break;
            s2 = e2 === V && a2 === n2 + t2.strm.avail_in ? 1 : 0, Y(t2, 0, 0, s2), t2.pending_buf[t2.pending - 4] = a2, t2.pending_buf[t2.pending - 3] = a2 >> 8, t2.pending_buf[t2.pending - 2] = ~a2, t2.pending_buf[t2.pending - 1] = ~a2 >> 8, xt(t2.strm), n2 && (n2 > a2 && (n2 = a2), t2.strm.output.set(t2.window.subarray(t2.block_start, t2.block_start + n2), t2.strm.next_out), t2.strm.next_out += n2, t2.strm.avail_out -= n2, t2.strm.total_out += n2, t2.block_start += n2, a2 -= n2), a2 && (Rt(t2.strm, t2.strm.output, t2.strm.next_out, a2), t2.strm.next_out += a2, t2.strm.avail_out -= a2, t2.strm.total_out += a2);
          } while (0 === s2);
          return (o2 -= t2.strm.avail_in) && (o2 >= t2.w_size ? (t2.matches = 2, t2.window.set(t2.strm.input.subarray(t2.strm.next_in - t2.w_size, t2.strm.next_in), 0), t2.strstart = t2.w_size, t2.insert = t2.strstart) : (t2.window_size - t2.strstart <= o2 && (t2.strstart -= t2.w_size, t2.window.set(t2.window.subarray(t2.w_size, t2.w_size + t2.strstart), 0), t2.matches < 2 && t2.matches++, t2.insert > t2.strstart && (t2.insert = t2.strstart)), t2.window.set(t2.strm.input.subarray(t2.strm.next_in - o2, t2.strm.next_in), t2.strstart), t2.strstart += o2, t2.insert += o2 > t2.w_size - t2.insert ? t2.w_size - t2.insert : o2), t2.block_start = t2.strstart), t2.high_water < t2.strstart && (t2.high_water = t2.strstart), s2 ? 4 : e2 !== q && e2 !== V && 0 === t2.strm.avail_in && t2.strstart === t2.block_start ? 2 : (i2 = t2.window_size - t2.strstart, t2.strm.avail_in > i2 && t2.block_start >= t2.w_size && (t2.block_start -= t2.w_size, t2.strstart -= t2.w_size, t2.window.set(t2.window.subarray(t2.w_size, t2.w_size + t2.strstart), 0), t2.matches < 2 && t2.matches++, i2 += t2.w_size, t2.insert > t2.strstart && (t2.insert = t2.strstart)), i2 > t2.strm.avail_in && (i2 = t2.strm.avail_in), i2 && (Rt(t2.strm, t2.window, t2.strstart, i2), t2.strstart += i2, t2.insert += i2 > t2.w_size - t2.insert ? t2.w_size - t2.insert : i2), t2.high_water < t2.strstart && (t2.high_water = t2.strstart), i2 = t2.bi_valid + 42 >> 3, r2 = (i2 = t2.pending_buf_size - i2 > 65535 ? 65535 : t2.pending_buf_size - i2) > t2.w_size ? t2.w_size : i2, ((n2 = t2.strstart - t2.block_start) >= r2 || (n2 || e2 === V) && e2 !== q && 0 === t2.strm.avail_in && n2 <= i2) && (a2 = n2 > i2 ? i2 : n2, s2 = e2 === V && 0 === t2.strm.avail_in && a2 === n2 ? 1 : 0, Y(t2, t2.block_start, a2, s2), t2.block_start += a2, xt(t2.strm)), s2 ? 3 : 1);
        }, Dt = function(t2, e2) {
          for (var a2, n2; ; ) {
            if (t2.lookahead < ct) {
              if (St(t2), t2.lookahead < ct && e2 === q) return 1;
              if (0 === t2.lookahead) break;
            }
            if (a2 = 0, t2.lookahead >= 3 && (t2.ins_h = yt(t2, t2.ins_h, t2.window[t2.strstart + 3 - 1]), a2 = t2.prev[t2.strstart & t2.w_mask] = t2.head[t2.ins_h], t2.head[t2.ins_h] = t2.strstart), 0 !== a2 && t2.strstart - a2 <= t2.w_size - ct && (t2.match_length = Zt(t2, a2)), t2.match_length >= 3) if (n2 = X(t2, t2.strstart - t2.match_start, t2.match_length - 3), t2.lookahead -= t2.match_length, t2.match_length <= t2.max_lazy_match && t2.lookahead >= 3) {
              t2.match_length--;
              do {
                t2.strstart++, t2.ins_h = yt(t2, t2.ins_h, t2.window[t2.strstart + 3 - 1]), a2 = t2.prev[t2.strstart & t2.w_mask] = t2.head[t2.ins_h], t2.head[t2.ins_h] = t2.strstart;
              } while (0 != --t2.match_length);
              t2.strstart++;
            } else t2.strstart += t2.match_length, t2.match_length = 0, t2.ins_h = t2.window[t2.strstart], t2.ins_h = yt(t2, t2.ins_h, t2.window[t2.strstart + 1]);
            else n2 = X(t2, 0, t2.window[t2.strstart]), t2.lookahead--, t2.strstart++;
            if (n2 && (zt(t2, false), 0 === t2.strm.avail_out)) return 1;
          }
          return t2.insert = t2.strstart < 2 ? t2.strstart : 2, e2 === V ? (zt(t2, true), 0 === t2.strm.avail_out ? 3 : 4) : t2.sym_next && (zt(t2, false), 0 === t2.strm.avail_out) ? 1 : 2;
        }, Tt = function(t2, e2) {
          for (var a2, n2, i2; ; ) {
            if (t2.lookahead < ct) {
              if (St(t2), t2.lookahead < ct && e2 === q) return 1;
              if (0 === t2.lookahead) break;
            }
            if (a2 = 0, t2.lookahead >= 3 && (t2.ins_h = yt(t2, t2.ins_h, t2.window[t2.strstart + 3 - 1]), a2 = t2.prev[t2.strstart & t2.w_mask] = t2.head[t2.ins_h], t2.head[t2.ins_h] = t2.strstart), t2.prev_length = t2.match_length, t2.prev_match = t2.match_start, t2.match_length = 2, 0 !== a2 && t2.prev_length < t2.max_lazy_match && t2.strstart - a2 <= t2.w_size - ct && (t2.match_length = Zt(t2, a2), t2.match_length <= 5 && (t2.strategy === st || 3 === t2.match_length && t2.strstart - t2.match_start > 4096) && (t2.match_length = 2)), t2.prev_length >= 3 && t2.match_length <= t2.prev_length) {
              i2 = t2.strstart + t2.lookahead - 3, n2 = X(t2, t2.strstart - 1 - t2.prev_match, t2.prev_length - 3), t2.lookahead -= t2.prev_length - 1, t2.prev_length -= 2;
              do {
                ++t2.strstart <= i2 && (t2.ins_h = yt(t2, t2.ins_h, t2.window[t2.strstart + 3 - 1]), a2 = t2.prev[t2.strstart & t2.w_mask] = t2.head[t2.ins_h], t2.head[t2.ins_h] = t2.strstart);
              } while (0 != --t2.prev_length);
              if (t2.match_available = 0, t2.match_length = 2, t2.strstart++, n2 && (zt(t2, false), 0 === t2.strm.avail_out)) return 1;
            } else if (t2.match_available) {
              if ((n2 = X(t2, 0, t2.window[t2.strstart - 1])) && zt(t2, false), t2.strstart++, t2.lookahead--, 0 === t2.strm.avail_out) return 1;
            } else t2.match_available = 1, t2.strstart++, t2.lookahead--;
          }
          return t2.match_available && (n2 = X(t2, 0, t2.window[t2.strstart - 1]), t2.match_available = 0), t2.insert = t2.strstart < 2 ? t2.strstart : 2, e2 === V ? (zt(t2, true), 0 === t2.strm.avail_out ? 3 : 4) : t2.sym_next && (zt(t2, false), 0 === t2.strm.avail_out) ? 1 : 2;
        };
        function Ot(t2, e2, a2, n2, i2) {
          this.good_length = t2, this.max_lazy = e2, this.nice_length = a2, this.max_chain = n2, this.func = i2;
        }
        var It = [new Ot(0, 0, 0, 0, Ut), new Ot(4, 4, 8, 4, Dt), new Ot(4, 5, 16, 8, Dt), new Ot(4, 6, 32, 32, Dt), new Ot(4, 4, 16, 16, Tt), new Ot(8, 16, 32, 32, Tt), new Ot(8, 16, 128, 128, Tt), new Ot(8, 32, 128, 256, Tt), new Ot(32, 128, 258, 1024, Tt), new Ot(32, 258, 258, 4096, Tt)];
        function Ft() {
          this.strm = null, this.status = 0, this.pending_buf = null, this.pending_buf_size = 0, this.pending_out = 0, this.pending = 0, this.wrap = 0, this.gzhead = null, this.gzindex = 0, this.method = ft, this.last_flush = -1, this.w_size = 0, this.w_bits = 0, this.w_mask = 0, this.window = null, this.window_size = 0, this.prev = null, this.head = null, this.ins_h = 0, this.hash_size = 0, this.hash_bits = 0, this.hash_mask = 0, this.hash_shift = 0, this.block_start = 0, this.match_length = 0, this.prev_match = 0, this.match_available = 0, this.strstart = 0, this.match_start = 0, this.lookahead = 0, this.prev_length = 0, this.max_chain_length = 0, this.max_lazy_match = 0, this.level = 0, this.strategy = 0, this.good_match = 0, this.nice_match = 0, this.dyn_ltree = new Uint16Array(1146), this.dyn_dtree = new Uint16Array(122), this.bl_tree = new Uint16Array(78), vt(this.dyn_ltree), vt(this.dyn_dtree), vt(this.bl_tree), this.l_desc = null, this.d_desc = null, this.bl_desc = null, this.bl_count = new Uint16Array(16), this.heap = new Uint16Array(573), vt(this.heap), this.heap_len = 0, this.heap_max = 0, this.depth = new Uint16Array(573), vt(this.depth), this.sym_buf = 0, this.lit_bufsize = 0, this.sym_next = 0, this.sym_end = 0, this.opt_len = 0, this.static_len = 0, this.matches = 0, this.insert = 0, this.bi_buf = 0, this.bi_valid = 0;
        }
        var Lt = function(t2) {
          if (!t2) return 1;
          var e2 = t2.state;
          return !e2 || e2.strm !== t2 || e2.status !== wt && 57 !== e2.status && 69 !== e2.status && 73 !== e2.status && 91 !== e2.status && 103 !== e2.status && e2.status !== mt && e2.status !== bt ? 1 : 0;
        }, Nt = function(t2) {
          if (Lt(t2)) return gt(t2, at);
          t2.total_in = t2.total_out = 0, t2.data_type = _t;
          var e2 = t2.state;
          return e2.pending = 0, e2.pending_out = 0, e2.wrap < 0 && (e2.wrap = -e2.wrap), e2.status = 2 === e2.wrap ? 57 : e2.wrap ? wt : mt, t2.adler = 2 === e2.wrap ? 0 : 1, e2.last_flush = -2, P(e2), tt;
        }, Bt = function(t2) {
          var e2, a2 = Nt(t2);
          return a2 === tt && ((e2 = t2.state).window_size = 2 * e2.w_size, vt(e2.head), e2.max_lazy_match = It[e2.level].max_lazy, e2.good_match = It[e2.level].good_length, e2.nice_match = It[e2.level].nice_length, e2.max_chain_length = It[e2.level].max_chain, e2.strstart = 0, e2.block_start = 0, e2.lookahead = 0, e2.insert = 0, e2.match_length = e2.prev_length = 2, e2.match_available = 0, e2.ins_h = 0), a2;
        }, Ct = function(t2, e2, a2, n2, i2, r2) {
          if (!t2) return at;
          var s2 = 1;
          if (e2 === rt && (e2 = 6), n2 < 0 ? (s2 = 0, n2 = -n2) : n2 > 15 && (s2 = 2, n2 -= 16), i2 < 1 || i2 > 9 || a2 !== ft || n2 < 8 || n2 > 15 || e2 < 0 || e2 > 9 || r2 < 0 || r2 > ht || 8 === n2 && 1 !== s2) return gt(t2, at);
          8 === n2 && (n2 = 9);
          var o2 = new Ft();
          return t2.state = o2, o2.strm = t2, o2.status = wt, o2.wrap = s2, o2.gzhead = null, o2.w_bits = n2, o2.w_size = 1 << o2.w_bits, o2.w_mask = o2.w_size - 1, o2.hash_bits = i2 + 7, o2.hash_size = 1 << o2.hash_bits, o2.hash_mask = o2.hash_size - 1, o2.hash_shift = ~~((o2.hash_bits + 3 - 1) / 3), o2.window = new Uint8Array(2 * o2.w_size), o2.head = new Uint16Array(o2.hash_size), o2.prev = new Uint16Array(o2.w_size), o2.lit_bufsize = 1 << i2 + 6, o2.pending_buf_size = 4 * o2.lit_bufsize, o2.pending_buf = new Uint8Array(o2.pending_buf_size), o2.sym_buf = o2.lit_bufsize, o2.sym_end = 3 * (o2.lit_bufsize - 1), o2.level = e2, o2.strategy = r2, o2.method = a2, Bt(t2);
        }, Mt = { deflateInit: function(t2, e2) {
          return Ct(t2, e2, ft, 15, 8, dt);
        }, deflateInit2: Ct, deflateReset: Bt, deflateResetKeep: Nt, deflateSetHeader: function(t2, e2) {
          return Lt(t2) || 2 !== t2.state.wrap ? at : (t2.state.gzhead = e2, tt);
        }, deflate: function(t2, e2) {
          if (Lt(t2) || e2 > $ || e2 < 0) return t2 ? gt(t2, at) : at;
          var a2 = t2.state;
          if (!t2.output || 0 !== t2.avail_in && !t2.input || a2.status === bt && e2 !== V) return gt(t2, 0 === t2.avail_out ? it : at);
          var n2 = a2.last_flush;
          if (a2.last_flush = e2, 0 !== a2.pending) {
            if (xt(t2), 0 === t2.avail_out) return a2.last_flush = -1, tt;
          } else if (0 === t2.avail_in && pt(e2) <= pt(n2) && e2 !== V) return gt(t2, it);
          if (a2.status === bt && 0 !== t2.avail_in) return gt(t2, it);
          if (a2.status === wt && 0 === a2.wrap && (a2.status = mt), a2.status === wt) {
            var i2 = ft + (a2.w_bits - 8 << 4) << 8;
            if (i2 |= (a2.strategy >= ot || a2.level < 2 ? 0 : a2.level < 6 ? 1 : 6 === a2.level ? 2 : 3) << 6, 0 !== a2.strstart && (i2 |= 32), Et(a2, i2 += 31 - i2 % 31), 0 !== a2.strstart && (Et(a2, t2.adler >>> 16), Et(a2, 65535 & t2.adler)), t2.adler = 1, a2.status = mt, xt(t2), 0 !== a2.pending) return a2.last_flush = -1, tt;
          }
          if (57 === a2.status) {
            if (t2.adler = 0, At(a2, 31), At(a2, 139), At(a2, 8), a2.gzhead) At(a2, (a2.gzhead.text ? 1 : 0) + (a2.gzhead.hcrc ? 2 : 0) + (a2.gzhead.extra ? 4 : 0) + (a2.gzhead.name ? 8 : 0) + (a2.gzhead.comment ? 16 : 0)), At(a2, 255 & a2.gzhead.time), At(a2, a2.gzhead.time >> 8 & 255), At(a2, a2.gzhead.time >> 16 & 255), At(a2, a2.gzhead.time >> 24 & 255), At(a2, 9 === a2.level ? 2 : a2.strategy >= ot || a2.level < 2 ? 4 : 0), At(a2, 255 & a2.gzhead.os), a2.gzhead.extra && a2.gzhead.extra.length && (At(a2, 255 & a2.gzhead.extra.length), At(a2, a2.gzhead.extra.length >> 8 & 255)), a2.gzhead.hcrc && (t2.adler = H(t2.adler, a2.pending_buf, a2.pending, 0)), a2.gzindex = 0, a2.status = 69;
            else if (At(a2, 0), At(a2, 0), At(a2, 0), At(a2, 0), At(a2, 0), At(a2, 9 === a2.level ? 2 : a2.strategy >= ot || a2.level < 2 ? 4 : 0), At(a2, 3), a2.status = mt, xt(t2), 0 !== a2.pending) return a2.last_flush = -1, tt;
          }
          if (69 === a2.status) {
            if (a2.gzhead.extra) {
              for (var r2 = a2.pending, s2 = (65535 & a2.gzhead.extra.length) - a2.gzindex; a2.pending + s2 > a2.pending_buf_size; ) {
                var o2 = a2.pending_buf_size - a2.pending;
                if (a2.pending_buf.set(a2.gzhead.extra.subarray(a2.gzindex, a2.gzindex + o2), a2.pending), a2.pending = a2.pending_buf_size, a2.gzhead.hcrc && a2.pending > r2 && (t2.adler = H(t2.adler, a2.pending_buf, a2.pending - r2, r2)), a2.gzindex += o2, xt(t2), 0 !== a2.pending) return a2.last_flush = -1, tt;
                r2 = 0, s2 -= o2;
              }
              var l2 = new Uint8Array(a2.gzhead.extra);
              a2.pending_buf.set(l2.subarray(a2.gzindex, a2.gzindex + s2), a2.pending), a2.pending += s2, a2.gzhead.hcrc && a2.pending > r2 && (t2.adler = H(t2.adler, a2.pending_buf, a2.pending - r2, r2)), a2.gzindex = 0;
            }
            a2.status = 73;
          }
          if (73 === a2.status) {
            if (a2.gzhead.name) {
              var h2, d2 = a2.pending;
              do {
                if (a2.pending === a2.pending_buf_size) {
                  if (a2.gzhead.hcrc && a2.pending > d2 && (t2.adler = H(t2.adler, a2.pending_buf, a2.pending - d2, d2)), xt(t2), 0 !== a2.pending) return a2.last_flush = -1, tt;
                  d2 = 0;
                }
                h2 = a2.gzindex < a2.gzhead.name.length ? 255 & a2.gzhead.name.charCodeAt(a2.gzindex++) : 0, At(a2, h2);
              } while (0 !== h2);
              a2.gzhead.hcrc && a2.pending > d2 && (t2.adler = H(t2.adler, a2.pending_buf, a2.pending - d2, d2)), a2.gzindex = 0;
            }
            a2.status = 91;
          }
          if (91 === a2.status) {
            if (a2.gzhead.comment) {
              var _2, f2 = a2.pending;
              do {
                if (a2.pending === a2.pending_buf_size) {
                  if (a2.gzhead.hcrc && a2.pending > f2 && (t2.adler = H(t2.adler, a2.pending_buf, a2.pending - f2, f2)), xt(t2), 0 !== a2.pending) return a2.last_flush = -1, tt;
                  f2 = 0;
                }
                _2 = a2.gzindex < a2.gzhead.comment.length ? 255 & a2.gzhead.comment.charCodeAt(a2.gzindex++) : 0, At(a2, _2);
              } while (0 !== _2);
              a2.gzhead.hcrc && a2.pending > f2 && (t2.adler = H(t2.adler, a2.pending_buf, a2.pending - f2, f2));
            }
            a2.status = 103;
          }
          if (103 === a2.status) {
            if (a2.gzhead.hcrc) {
              if (a2.pending + 2 > a2.pending_buf_size && (xt(t2), 0 !== a2.pending)) return a2.last_flush = -1, tt;
              At(a2, 255 & t2.adler), At(a2, t2.adler >> 8 & 255), t2.adler = 0;
            }
            if (a2.status = mt, xt(t2), 0 !== a2.pending) return a2.last_flush = -1, tt;
          }
          if (0 !== t2.avail_in || 0 !== a2.lookahead || e2 !== q && a2.status !== bt) {
            var u2 = 0 === a2.level ? Ut(a2, e2) : a2.strategy === ot ? (function(t3, e3) {
              for (var a3; ; ) {
                if (0 === t3.lookahead && (St(t3), 0 === t3.lookahead)) {
                  if (e3 === q) return 1;
                  break;
                }
                if (t3.match_length = 0, a3 = X(t3, 0, t3.window[t3.strstart]), t3.lookahead--, t3.strstart++, a3 && (zt(t3, false), 0 === t3.strm.avail_out)) return 1;
              }
              return t3.insert = 0, e3 === V ? (zt(t3, true), 0 === t3.strm.avail_out ? 3 : 4) : t3.sym_next && (zt(t3, false), 0 === t3.strm.avail_out) ? 1 : 2;
            })(a2, e2) : a2.strategy === lt ? (function(t3, e3) {
              for (var a3, n3, i3, r3, s3 = t3.window; ; ) {
                if (t3.lookahead <= ut) {
                  if (St(t3), t3.lookahead <= ut && e3 === q) return 1;
                  if (0 === t3.lookahead) break;
                }
                if (t3.match_length = 0, t3.lookahead >= 3 && t3.strstart > 0 && (n3 = s3[i3 = t3.strstart - 1]) === s3[++i3] && n3 === s3[++i3] && n3 === s3[++i3]) {
                  r3 = t3.strstart + ut;
                  do {
                  } while (n3 === s3[++i3] && n3 === s3[++i3] && n3 === s3[++i3] && n3 === s3[++i3] && n3 === s3[++i3] && n3 === s3[++i3] && n3 === s3[++i3] && n3 === s3[++i3] && i3 < r3);
                  t3.match_length = ut - (r3 - i3), t3.match_length > t3.lookahead && (t3.match_length = t3.lookahead);
                }
                if (t3.match_length >= 3 ? (a3 = X(t3, 1, t3.match_length - 3), t3.lookahead -= t3.match_length, t3.strstart += t3.match_length, t3.match_length = 0) : (a3 = X(t3, 0, t3.window[t3.strstart]), t3.lookahead--, t3.strstart++), a3 && (zt(t3, false), 0 === t3.strm.avail_out)) return 1;
              }
              return t3.insert = 0, e3 === V ? (zt(t3, true), 0 === t3.strm.avail_out ? 3 : 4) : t3.sym_next && (zt(t3, false), 0 === t3.strm.avail_out) ? 1 : 2;
            })(a2, e2) : It[a2.level].func(a2, e2);
            if (3 !== u2 && 4 !== u2 || (a2.status = bt), 1 === u2 || 3 === u2) return 0 === t2.avail_out && (a2.last_flush = -1), tt;
            if (2 === u2 && (e2 === J ? W(a2) : e2 !== $ && (Y(a2, 0, 0, false), e2 === Q && (vt(a2.head), 0 === a2.lookahead && (a2.strstart = 0, a2.block_start = 0, a2.insert = 0))), xt(t2), 0 === t2.avail_out)) return a2.last_flush = -1, tt;
          }
          return e2 !== V ? tt : a2.wrap <= 0 ? et : (2 === a2.wrap ? (At(a2, 255 & t2.adler), At(a2, t2.adler >> 8 & 255), At(a2, t2.adler >> 16 & 255), At(a2, t2.adler >> 24 & 255), At(a2, 255 & t2.total_in), At(a2, t2.total_in >> 8 & 255), At(a2, t2.total_in >> 16 & 255), At(a2, t2.total_in >> 24 & 255)) : (Et(a2, t2.adler >>> 16), Et(a2, 65535 & t2.adler)), xt(t2), a2.wrap > 0 && (a2.wrap = -a2.wrap), 0 !== a2.pending ? tt : et);
        }, deflateEnd: function(t2) {
          if (Lt(t2)) return at;
          var e2 = t2.state.status;
          return t2.state = null, e2 === mt ? gt(t2, nt) : tt;
        }, deflateSetDictionary: function(t2, e2) {
          var a2 = e2.length;
          if (Lt(t2)) return at;
          var n2 = t2.state, i2 = n2.wrap;
          if (2 === i2 || 1 === i2 && n2.status !== wt || n2.lookahead) return at;
          if (1 === i2 && (t2.adler = C(t2.adler, e2, a2, 0)), n2.wrap = 0, a2 >= n2.w_size) {
            0 === i2 && (vt(n2.head), n2.strstart = 0, n2.block_start = 0, n2.insert = 0);
            var r2 = new Uint8Array(n2.w_size);
            r2.set(e2.subarray(a2 - n2.w_size, a2), 0), e2 = r2, a2 = n2.w_size;
          }
          var s2 = t2.avail_in, o2 = t2.next_in, l2 = t2.input;
          for (t2.avail_in = a2, t2.next_in = 0, t2.input = e2, St(n2); n2.lookahead >= 3; ) {
            var h2 = n2.strstart, d2 = n2.lookahead - 2;
            do {
              n2.ins_h = yt(n2, n2.ins_h, n2.window[h2 + 3 - 1]), n2.prev[h2 & n2.w_mask] = n2.head[n2.ins_h], n2.head[n2.ins_h] = h2, h2++;
            } while (--d2);
            n2.strstart = h2, n2.lookahead = 2, St(n2);
          }
          return n2.strstart += n2.lookahead, n2.block_start = n2.strstart, n2.insert = n2.lookahead, n2.lookahead = 0, n2.match_length = n2.prev_length = 2, n2.match_available = 0, t2.next_in = o2, t2.input = l2, t2.avail_in = s2, n2.wrap = i2, tt;
        }, deflateInfo: "pako deflate (from Nodeca project)" };
        function Ht(t2) {
          return Ht = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(t3) {
            return typeof t3;
          } : function(t3) {
            return t3 && "function" == typeof Symbol && t3.constructor === Symbol && t3 !== Symbol.prototype ? "symbol" : typeof t3;
          }, Ht(t2);
        }
        var jt = function(t2, e2) {
          return Object.prototype.hasOwnProperty.call(t2, e2);
        }, Kt = function(t2) {
          for (var e2 = Array.prototype.slice.call(arguments, 1); e2.length; ) {
            var a2 = e2.shift();
            if (a2) {
              if ("object" !== Ht(a2)) throw new TypeError(a2 + "must be non-object");
              for (var n2 in a2) jt(a2, n2) && (t2[n2] = a2[n2]);
            }
          }
          return t2;
        }, Pt = function(t2) {
          for (var e2 = 0, a2 = 0, n2 = t2.length; a2 < n2; a2++) e2 += t2[a2].length;
          for (var i2 = new Uint8Array(e2), r2 = 0, s2 = 0, o2 = t2.length; r2 < o2; r2++) {
            var l2 = t2[r2];
            i2.set(l2, s2), s2 += l2.length;
          }
          return i2;
        }, Yt = true;
        try {
          String.fromCharCode.apply(null, new Uint8Array(1));
        } catch (t2) {
          Yt = false;
        }
        for (var Gt = new Uint8Array(256), Xt = 0; Xt < 256; Xt++) Gt[Xt] = Xt >= 252 ? 6 : Xt >= 248 ? 5 : Xt >= 240 ? 4 : Xt >= 224 ? 3 : Xt >= 192 ? 2 : 1;
        Gt[254] = Gt[254] = 1;
        var Wt = function(t2) {
          if ("function" == typeof TextEncoder && TextEncoder.prototype.encode) return new TextEncoder().encode(t2);
          var e2, a2, n2, i2, r2, s2 = t2.length, o2 = 0;
          for (i2 = 0; i2 < s2; i2++) 55296 == (64512 & (a2 = t2.charCodeAt(i2))) && i2 + 1 < s2 && 56320 == (64512 & (n2 = t2.charCodeAt(i2 + 1))) && (a2 = 65536 + (a2 - 55296 << 10) + (n2 - 56320), i2++), o2 += a2 < 128 ? 1 : a2 < 2048 ? 2 : a2 < 65536 ? 3 : 4;
          for (e2 = new Uint8Array(o2), r2 = 0, i2 = 0; r2 < o2; i2++) 55296 == (64512 & (a2 = t2.charCodeAt(i2))) && i2 + 1 < s2 && 56320 == (64512 & (n2 = t2.charCodeAt(i2 + 1))) && (a2 = 65536 + (a2 - 55296 << 10) + (n2 - 56320), i2++), a2 < 128 ? e2[r2++] = a2 : a2 < 2048 ? (e2[r2++] = 192 | a2 >>> 6, e2[r2++] = 128 | 63 & a2) : a2 < 65536 ? (e2[r2++] = 224 | a2 >>> 12, e2[r2++] = 128 | a2 >>> 6 & 63, e2[r2++] = 128 | 63 & a2) : (e2[r2++] = 240 | a2 >>> 18, e2[r2++] = 128 | a2 >>> 12 & 63, e2[r2++] = 128 | a2 >>> 6 & 63, e2[r2++] = 128 | 63 & a2);
          return e2;
        }, qt = function(t2, e2) {
          var a2, n2, i2 = e2 || t2.length;
          if ("function" == typeof TextDecoder && TextDecoder.prototype.decode) return new TextDecoder().decode(t2.subarray(0, e2));
          var r2 = new Array(2 * i2);
          for (n2 = 0, a2 = 0; a2 < i2; ) {
            var s2 = t2[a2++];
            if (s2 < 128) r2[n2++] = s2;
            else {
              var o2 = Gt[s2];
              if (o2 > 4) r2[n2++] = 65533, a2 += o2 - 1;
              else {
                for (s2 &= 2 === o2 ? 31 : 3 === o2 ? 15 : 7; o2 > 1 && a2 < i2; ) s2 = s2 << 6 | 63 & t2[a2++], o2--;
                o2 > 1 ? r2[n2++] = 65533 : s2 < 65536 ? r2[n2++] = s2 : (s2 -= 65536, r2[n2++] = 55296 | s2 >> 10 & 1023, r2[n2++] = 56320 | 1023 & s2);
              }
            }
          }
          return (function(t3, e3) {
            if (e3 < 65534 && t3.subarray && Yt) return String.fromCharCode.apply(null, t3.length === e3 ? t3 : t3.subarray(0, e3));
            for (var a3 = "", n3 = 0; n3 < e3; n3++) a3 += String.fromCharCode(t3[n3]);
            return a3;
          })(r2, n2);
        }, Jt = function(t2, e2) {
          (e2 = e2 || t2.length) > t2.length && (e2 = t2.length);
          for (var a2 = e2 - 1; a2 >= 0 && 128 == (192 & t2[a2]); ) a2--;
          return a2 < 0 || 0 === a2 ? e2 : a2 + Gt[t2[a2]] > e2 ? a2 : e2;
        };
        var Qt = function() {
          this.input = null, this.next_in = 0, this.avail_in = 0, this.total_in = 0, this.output = null, this.next_out = 0, this.avail_out = 0, this.total_out = 0, this.msg = "", this.state = null, this.data_type = 2, this.adler = 0;
        }, Vt = Object.prototype.toString, $t = K.Z_NO_FLUSH, te = K.Z_SYNC_FLUSH, ee = K.Z_FULL_FLUSH, ae = K.Z_FINISH, ne = K.Z_OK, ie = K.Z_STREAM_END, re = K.Z_DEFAULT_COMPRESSION, se = K.Z_DEFAULT_STRATEGY, oe = K.Z_DEFLATED;
        function le(t2) {
          this.options = Kt({ level: re, method: oe, chunkSize: 16384, windowBits: 15, memLevel: 8, strategy: se }, t2 || {});
          var e2 = this.options;
          e2.raw && e2.windowBits > 0 ? e2.windowBits = -e2.windowBits : e2.gzip && e2.windowBits > 0 && e2.windowBits < 16 && (e2.windowBits += 16), this.err = 0, this.msg = "", this.ended = false, this.chunks = [], this.strm = new Qt(), this.strm.avail_out = 0;
          var a2 = Mt.deflateInit2(this.strm, e2.level, e2.method, e2.windowBits, e2.memLevel, e2.strategy);
          if (a2 !== ne) throw new Error(j[a2]);
          if (e2.header && Mt.deflateSetHeader(this.strm, e2.header), e2.dictionary) {
            var n2;
            if (n2 = "string" == typeof e2.dictionary ? Wt(e2.dictionary) : "[object ArrayBuffer]" === Vt.call(e2.dictionary) ? new Uint8Array(e2.dictionary) : e2.dictionary, (a2 = Mt.deflateSetDictionary(this.strm, n2)) !== ne) throw new Error(j[a2]);
            this._dict_set = true;
          }
        }
        function he(t2, e2) {
          var a2 = new le(e2);
          if (a2.push(t2, true), a2.err) throw a2.msg || j[a2.err];
          return a2.result;
        }
        le.prototype.push = function(t2, e2) {
          var a2, n2, i2 = this.strm, r2 = this.options.chunkSize;
          if (this.ended) return false;
          for (n2 = e2 === ~~e2 ? e2 : true === e2 ? ae : $t, "string" == typeof t2 ? i2.input = Wt(t2) : "[object ArrayBuffer]" === Vt.call(t2) ? i2.input = new Uint8Array(t2) : i2.input = t2, i2.next_in = 0, i2.avail_in = i2.input.length; ; ) if (0 === i2.avail_out && (i2.output = new Uint8Array(r2), i2.next_out = 0, i2.avail_out = r2), (n2 === te || n2 === ee) && i2.avail_out <= 6) this.onData(i2.output.subarray(0, i2.next_out)), i2.avail_out = 0;
          else {
            if ((a2 = Mt.deflate(i2, n2)) === ie) return i2.next_out > 0 && this.onData(i2.output.subarray(0, i2.next_out)), a2 = Mt.deflateEnd(this.strm), this.onEnd(a2), this.ended = true, a2 === ne;
            if (0 !== i2.avail_out) {
              if (n2 > 0 && i2.next_out > 0) this.onData(i2.output.subarray(0, i2.next_out)), i2.avail_out = 0;
              else if (0 === i2.avail_in) break;
            } else this.onData(i2.output);
          }
          return true;
        }, le.prototype.onData = function(t2) {
          this.chunks.push(t2);
        }, le.prototype.onEnd = function(t2) {
          t2 === ne && (this.result = Pt(this.chunks)), this.chunks = [], this.err = t2, this.msg = this.strm.msg;
        };
        var de = { Deflate: le, deflate: he, deflateRaw: function(t2, e2) {
          return (e2 = e2 || {}).raw = true, he(t2, e2);
        }, gzip: function(t2, e2) {
          return (e2 = e2 || {}).gzip = true, he(t2, e2);
        }, constants: K }, _e = 16209, fe = function(t2, e2) {
          var a2, n2, i2, r2, s2, o2, l2, h2, d2, _2, f2, u2, c2, w2, m2, b2, g2, p2, v2, k2, y2, x2, z2, A2, E2 = t2.state;
          a2 = t2.next_in, z2 = t2.input, n2 = a2 + (t2.avail_in - 5), i2 = t2.next_out, A2 = t2.output, r2 = i2 - (e2 - t2.avail_out), s2 = i2 + (t2.avail_out - 257), o2 = E2.dmax, l2 = E2.wsize, h2 = E2.whave, d2 = E2.wnext, _2 = E2.window, f2 = E2.hold, u2 = E2.bits, c2 = E2.lencode, w2 = E2.distcode, m2 = (1 << E2.lenbits) - 1, b2 = (1 << E2.distbits) - 1;
          t: do {
            u2 < 15 && (f2 += z2[a2++] << u2, u2 += 8, f2 += z2[a2++] << u2, u2 += 8), g2 = c2[f2 & m2];
            e: for (; ; ) {
              if (f2 >>>= p2 = g2 >>> 24, u2 -= p2, 0 === (p2 = g2 >>> 16 & 255)) A2[i2++] = 65535 & g2;
              else {
                if (!(16 & p2)) {
                  if (0 == (64 & p2)) {
                    g2 = c2[(65535 & g2) + (f2 & (1 << p2) - 1)];
                    continue e;
                  }
                  if (32 & p2) {
                    E2.mode = 16191;
                    break t;
                  }
                  t2.msg = "invalid literal/length code", E2.mode = _e;
                  break t;
                }
                v2 = 65535 & g2, (p2 &= 15) && (u2 < p2 && (f2 += z2[a2++] << u2, u2 += 8), v2 += f2 & (1 << p2) - 1, f2 >>>= p2, u2 -= p2), u2 < 15 && (f2 += z2[a2++] << u2, u2 += 8, f2 += z2[a2++] << u2, u2 += 8), g2 = w2[f2 & b2];
                a: for (; ; ) {
                  if (f2 >>>= p2 = g2 >>> 24, u2 -= p2, !(16 & (p2 = g2 >>> 16 & 255))) {
                    if (0 == (64 & p2)) {
                      g2 = w2[(65535 & g2) + (f2 & (1 << p2) - 1)];
                      continue a;
                    }
                    t2.msg = "invalid distance code", E2.mode = _e;
                    break t;
                  }
                  if (k2 = 65535 & g2, u2 < (p2 &= 15) && (f2 += z2[a2++] << u2, (u2 += 8) < p2 && (f2 += z2[a2++] << u2, u2 += 8)), (k2 += f2 & (1 << p2) - 1) > o2) {
                    t2.msg = "invalid distance too far back", E2.mode = _e;
                    break t;
                  }
                  if (f2 >>>= p2, u2 -= p2, k2 > (p2 = i2 - r2)) {
                    if ((p2 = k2 - p2) > h2 && E2.sane) {
                      t2.msg = "invalid distance too far back", E2.mode = _e;
                      break t;
                    }
                    if (y2 = 0, x2 = _2, 0 === d2) {
                      if (y2 += l2 - p2, p2 < v2) {
                        v2 -= p2;
                        do {
                          A2[i2++] = _2[y2++];
                        } while (--p2);
                        y2 = i2 - k2, x2 = A2;
                      }
                    } else if (d2 < p2) {
                      if (y2 += l2 + d2 - p2, (p2 -= d2) < v2) {
                        v2 -= p2;
                        do {
                          A2[i2++] = _2[y2++];
                        } while (--p2);
                        if (y2 = 0, d2 < v2) {
                          v2 -= p2 = d2;
                          do {
                            A2[i2++] = _2[y2++];
                          } while (--p2);
                          y2 = i2 - k2, x2 = A2;
                        }
                      }
                    } else if (y2 += d2 - p2, p2 < v2) {
                      v2 -= p2;
                      do {
                        A2[i2++] = _2[y2++];
                      } while (--p2);
                      y2 = i2 - k2, x2 = A2;
                    }
                    for (; v2 > 2; ) A2[i2++] = x2[y2++], A2[i2++] = x2[y2++], A2[i2++] = x2[y2++], v2 -= 3;
                    v2 && (A2[i2++] = x2[y2++], v2 > 1 && (A2[i2++] = x2[y2++]));
                  } else {
                    y2 = i2 - k2;
                    do {
                      A2[i2++] = A2[y2++], A2[i2++] = A2[y2++], A2[i2++] = A2[y2++], v2 -= 3;
                    } while (v2 > 2);
                    v2 && (A2[i2++] = A2[y2++], v2 > 1 && (A2[i2++] = A2[y2++]));
                  }
                  break;
                }
              }
              break;
            }
          } while (a2 < n2 && i2 < s2);
          a2 -= v2 = u2 >> 3, f2 &= (1 << (u2 -= v2 << 3)) - 1, t2.next_in = a2, t2.next_out = i2, t2.avail_in = a2 < n2 ? n2 - a2 + 5 : 5 - (a2 - n2), t2.avail_out = i2 < s2 ? s2 - i2 + 257 : 257 - (i2 - s2), E2.hold = f2, E2.bits = u2;
        }, ue = 15, ce = new Uint16Array([3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258, 0, 0]), we = new Uint8Array([16, 16, 16, 16, 16, 16, 16, 16, 17, 17, 17, 17, 18, 18, 18, 18, 19, 19, 19, 19, 20, 20, 20, 20, 21, 21, 21, 21, 16, 72, 78]), me = new Uint16Array([1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577, 0, 0]), be = new Uint8Array([16, 16, 16, 16, 17, 17, 18, 18, 19, 19, 20, 20, 21, 21, 22, 22, 23, 23, 24, 24, 25, 25, 26, 26, 27, 27, 28, 28, 29, 29, 64, 64]), ge = function(t2, e2, a2, n2, i2, r2, s2, o2) {
          var l2, h2, d2, _2, f2, u2, c2, w2, m2, b2 = o2.bits, g2 = 0, p2 = 0, v2 = 0, k2 = 0, y2 = 0, x2 = 0, z2 = 0, A2 = 0, E2 = 0, R2 = 0, Z2 = null, S2 = new Uint16Array(16), U2 = new Uint16Array(16), D2 = null;
          for (g2 = 0; g2 <= ue; g2++) S2[g2] = 0;
          for (p2 = 0; p2 < n2; p2++) S2[e2[a2 + p2]]++;
          for (y2 = b2, k2 = ue; k2 >= 1 && 0 === S2[k2]; k2--) ;
          if (y2 > k2 && (y2 = k2), 0 === k2) return i2[r2++] = 20971520, i2[r2++] = 20971520, o2.bits = 1, 0;
          for (v2 = 1; v2 < k2 && 0 === S2[v2]; v2++) ;
          for (y2 < v2 && (y2 = v2), A2 = 1, g2 = 1; g2 <= ue; g2++) if (A2 <<= 1, (A2 -= S2[g2]) < 0) return -1;
          if (A2 > 0 && (0 === t2 || 1 !== k2)) return -1;
          for (U2[1] = 0, g2 = 1; g2 < ue; g2++) U2[g2 + 1] = U2[g2] + S2[g2];
          for (p2 = 0; p2 < n2; p2++) 0 !== e2[a2 + p2] && (s2[U2[e2[a2 + p2]]++] = p2);
          if (0 === t2 ? (Z2 = D2 = s2, u2 = 20) : 1 === t2 ? (Z2 = ce, D2 = we, u2 = 257) : (Z2 = me, D2 = be, u2 = 0), R2 = 0, p2 = 0, g2 = v2, f2 = r2, x2 = y2, z2 = 0, d2 = -1, _2 = (E2 = 1 << y2) - 1, 1 === t2 && E2 > 852 || 2 === t2 && E2 > 592) return 1;
          for (; ; ) {
            c2 = g2 - z2, s2[p2] + 1 < u2 ? (w2 = 0, m2 = s2[p2]) : s2[p2] >= u2 ? (w2 = D2[s2[p2] - u2], m2 = Z2[s2[p2] - u2]) : (w2 = 96, m2 = 0), l2 = 1 << g2 - z2, v2 = h2 = 1 << x2;
            do {
              i2[f2 + (R2 >> z2) + (h2 -= l2)] = c2 << 24 | w2 << 16 | m2 | 0;
            } while (0 !== h2);
            for (l2 = 1 << g2 - 1; R2 & l2; ) l2 >>= 1;
            if (0 !== l2 ? (R2 &= l2 - 1, R2 += l2) : R2 = 0, p2++, 0 == --S2[g2]) {
              if (g2 === k2) break;
              g2 = e2[a2 + s2[p2]];
            }
            if (g2 > y2 && (R2 & _2) !== d2) {
              for (0 === z2 && (z2 = y2), f2 += v2, A2 = 1 << (x2 = g2 - z2); x2 + z2 < k2 && !((A2 -= S2[x2 + z2]) <= 0); ) x2++, A2 <<= 1;
              if (E2 += 1 << x2, 1 === t2 && E2 > 852 || 2 === t2 && E2 > 592) return 1;
              i2[d2 = R2 & _2] = y2 << 24 | x2 << 16 | f2 - r2 | 0;
            }
          }
          return 0 !== R2 && (i2[f2 + R2] = g2 - z2 << 24 | 64 << 16 | 0), o2.bits = y2, 0;
        }, pe = K.Z_FINISH, ve = K.Z_BLOCK, ke = K.Z_TREES, ye = K.Z_OK, xe = K.Z_STREAM_END, ze = K.Z_NEED_DICT, Ae = K.Z_STREAM_ERROR, Ee = K.Z_DATA_ERROR, Re = K.Z_MEM_ERROR, Ze = K.Z_BUF_ERROR, Se = K.Z_DEFLATED, Ue = 16180, De = 16190, Te = 16191, Oe = 16192, Ie = 16194, Fe = 16199, Le = 16200, Ne = 16206, Be = 16209, Ce = function(t2) {
          return (t2 >>> 24 & 255) + (t2 >>> 8 & 65280) + ((65280 & t2) << 8) + ((255 & t2) << 24);
        };
        function Me() {
          this.strm = null, this.mode = 0, this.last = false, this.wrap = 0, this.havedict = false, this.flags = 0, this.dmax = 0, this.check = 0, this.total = 0, this.head = null, this.wbits = 0, this.wsize = 0, this.whave = 0, this.wnext = 0, this.window = null, this.hold = 0, this.bits = 0, this.length = 0, this.offset = 0, this.extra = 0, this.lencode = null, this.distcode = null, this.lenbits = 0, this.distbits = 0, this.ncode = 0, this.nlen = 0, this.ndist = 0, this.have = 0, this.next = null, this.lens = new Uint16Array(320), this.work = new Uint16Array(288), this.lendyn = null, this.distdyn = null, this.sane = 0, this.back = 0, this.was = 0;
        }
        var He, je, Ke = function(t2) {
          if (!t2) return 1;
          var e2 = t2.state;
          return !e2 || e2.strm !== t2 || e2.mode < Ue || e2.mode > 16211 ? 1 : 0;
        }, Pe = function(t2) {
          if (Ke(t2)) return Ae;
          var e2 = t2.state;
          return t2.total_in = t2.total_out = e2.total = 0, t2.msg = "", e2.wrap && (t2.adler = 1 & e2.wrap), e2.mode = Ue, e2.last = 0, e2.havedict = 0, e2.flags = -1, e2.dmax = 32768, e2.head = null, e2.hold = 0, e2.bits = 0, e2.lencode = e2.lendyn = new Int32Array(852), e2.distcode = e2.distdyn = new Int32Array(592), e2.sane = 1, e2.back = -1, ye;
        }, Ye = function(t2) {
          if (Ke(t2)) return Ae;
          var e2 = t2.state;
          return e2.wsize = 0, e2.whave = 0, e2.wnext = 0, Pe(t2);
        }, Ge = function(t2, e2) {
          var a2;
          if (Ke(t2)) return Ae;
          var n2 = t2.state;
          return e2 < 0 ? (a2 = 0, e2 = -e2) : (a2 = 5 + (e2 >> 4), e2 < 48 && (e2 &= 15)), e2 && (e2 < 8 || e2 > 15) ? Ae : (null !== n2.window && n2.wbits !== e2 && (n2.window = null), n2.wrap = a2, n2.wbits = e2, Ye(t2));
        }, Xe = function(t2, e2) {
          if (!t2) return Ae;
          var a2 = new Me();
          t2.state = a2, a2.strm = t2, a2.window = null, a2.mode = Ue;
          var n2 = Ge(t2, e2);
          return n2 !== ye && (t2.state = null), n2;
        }, We = true, qe = function(t2) {
          if (We) {
            He = new Int32Array(512), je = new Int32Array(32);
            for (var e2 = 0; e2 < 144; ) t2.lens[e2++] = 8;
            for (; e2 < 256; ) t2.lens[e2++] = 9;
            for (; e2 < 280; ) t2.lens[e2++] = 7;
            for (; e2 < 288; ) t2.lens[e2++] = 8;
            for (ge(1, t2.lens, 0, 288, He, 0, t2.work, { bits: 9 }), e2 = 0; e2 < 32; ) t2.lens[e2++] = 5;
            ge(2, t2.lens, 0, 32, je, 0, t2.work, { bits: 5 }), We = false;
          }
          t2.lencode = He, t2.lenbits = 9, t2.distcode = je, t2.distbits = 5;
        }, Je = function(t2, e2, a2, n2) {
          var i2, r2 = t2.state;
          return null === r2.window && (r2.wsize = 1 << r2.wbits, r2.wnext = 0, r2.whave = 0, r2.window = new Uint8Array(r2.wsize)), n2 >= r2.wsize ? (r2.window.set(e2.subarray(a2 - r2.wsize, a2), 0), r2.wnext = 0, r2.whave = r2.wsize) : ((i2 = r2.wsize - r2.wnext) > n2 && (i2 = n2), r2.window.set(e2.subarray(a2 - n2, a2 - n2 + i2), r2.wnext), (n2 -= i2) ? (r2.window.set(e2.subarray(a2 - n2, a2), 0), r2.wnext = n2, r2.whave = r2.wsize) : (r2.wnext += i2, r2.wnext === r2.wsize && (r2.wnext = 0), r2.whave < r2.wsize && (r2.whave += i2))), 0;
        }, Qe = { inflateReset: Ye, inflateReset2: Ge, inflateResetKeep: Pe, inflateInit: function(t2) {
          return Xe(t2, 15);
        }, inflateInit2: Xe, inflate: function(t2, e2) {
          var a2, n2, i2, r2, s2, o2, l2, h2, d2, _2, f2, u2, c2, w2, m2, b2, g2, p2, v2, k2, y2, x2, z2, A2, E2 = 0, R2 = new Uint8Array(4), Z2 = new Uint8Array([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
          if (Ke(t2) || !t2.output || !t2.input && 0 !== t2.avail_in) return Ae;
          (a2 = t2.state).mode === Te && (a2.mode = Oe), s2 = t2.next_out, i2 = t2.output, l2 = t2.avail_out, r2 = t2.next_in, n2 = t2.input, o2 = t2.avail_in, h2 = a2.hold, d2 = a2.bits, _2 = o2, f2 = l2, x2 = ye;
          t: for (; ; ) switch (a2.mode) {
            case Ue:
              if (0 === a2.wrap) {
                a2.mode = Oe;
                break;
              }
              for (; d2 < 16; ) {
                if (0 === o2) break t;
                o2--, h2 += n2[r2++] << d2, d2 += 8;
              }
              if (2 & a2.wrap && 35615 === h2) {
                0 === a2.wbits && (a2.wbits = 15), a2.check = 0, R2[0] = 255 & h2, R2[1] = h2 >>> 8 & 255, a2.check = H(a2.check, R2, 2, 0), h2 = 0, d2 = 0, a2.mode = 16181;
                break;
              }
              if (a2.head && (a2.head.done = false), !(1 & a2.wrap) || (((255 & h2) << 8) + (h2 >> 8)) % 31) {
                t2.msg = "incorrect header check", a2.mode = Be;
                break;
              }
              if ((15 & h2) !== Se) {
                t2.msg = "unknown compression method", a2.mode = Be;
                break;
              }
              if (d2 -= 4, y2 = 8 + (15 & (h2 >>>= 4)), 0 === a2.wbits && (a2.wbits = y2), y2 > 15 || y2 > a2.wbits) {
                t2.msg = "invalid window size", a2.mode = Be;
                break;
              }
              a2.dmax = 1 << a2.wbits, a2.flags = 0, t2.adler = a2.check = 1, a2.mode = 512 & h2 ? 16189 : Te, h2 = 0, d2 = 0;
              break;
            case 16181:
              for (; d2 < 16; ) {
                if (0 === o2) break t;
                o2--, h2 += n2[r2++] << d2, d2 += 8;
              }
              if (a2.flags = h2, (255 & a2.flags) !== Se) {
                t2.msg = "unknown compression method", a2.mode = Be;
                break;
              }
              if (57344 & a2.flags) {
                t2.msg = "unknown header flags set", a2.mode = Be;
                break;
              }
              a2.head && (a2.head.text = h2 >> 8 & 1), 512 & a2.flags && 4 & a2.wrap && (R2[0] = 255 & h2, R2[1] = h2 >>> 8 & 255, a2.check = H(a2.check, R2, 2, 0)), h2 = 0, d2 = 0, a2.mode = 16182;
            case 16182:
              for (; d2 < 32; ) {
                if (0 === o2) break t;
                o2--, h2 += n2[r2++] << d2, d2 += 8;
              }
              a2.head && (a2.head.time = h2), 512 & a2.flags && 4 & a2.wrap && (R2[0] = 255 & h2, R2[1] = h2 >>> 8 & 255, R2[2] = h2 >>> 16 & 255, R2[3] = h2 >>> 24 & 255, a2.check = H(a2.check, R2, 4, 0)), h2 = 0, d2 = 0, a2.mode = 16183;
            case 16183:
              for (; d2 < 16; ) {
                if (0 === o2) break t;
                o2--, h2 += n2[r2++] << d2, d2 += 8;
              }
              a2.head && (a2.head.xflags = 255 & h2, a2.head.os = h2 >> 8), 512 & a2.flags && 4 & a2.wrap && (R2[0] = 255 & h2, R2[1] = h2 >>> 8 & 255, a2.check = H(a2.check, R2, 2, 0)), h2 = 0, d2 = 0, a2.mode = 16184;
            case 16184:
              if (1024 & a2.flags) {
                for (; d2 < 16; ) {
                  if (0 === o2) break t;
                  o2--, h2 += n2[r2++] << d2, d2 += 8;
                }
                a2.length = h2, a2.head && (a2.head.extra_len = h2), 512 & a2.flags && 4 & a2.wrap && (R2[0] = 255 & h2, R2[1] = h2 >>> 8 & 255, a2.check = H(a2.check, R2, 2, 0)), h2 = 0, d2 = 0;
              } else a2.head && (a2.head.extra = null);
              a2.mode = 16185;
            case 16185:
              if (1024 & a2.flags && ((u2 = a2.length) > o2 && (u2 = o2), u2 && (a2.head && (y2 = a2.head.extra_len - a2.length, a2.head.extra || (a2.head.extra = new Uint8Array(a2.head.extra_len)), a2.head.extra.set(n2.subarray(r2, r2 + u2), y2)), 512 & a2.flags && 4 & a2.wrap && (a2.check = H(a2.check, n2, u2, r2)), o2 -= u2, r2 += u2, a2.length -= u2), a2.length)) break t;
              a2.length = 0, a2.mode = 16186;
            case 16186:
              if (2048 & a2.flags) {
                if (0 === o2) break t;
                u2 = 0;
                do {
                  y2 = n2[r2 + u2++], a2.head && y2 && a2.length < 65536 && (a2.head.name += String.fromCharCode(y2));
                } while (y2 && u2 < o2);
                if (512 & a2.flags && 4 & a2.wrap && (a2.check = H(a2.check, n2, u2, r2)), o2 -= u2, r2 += u2, y2) break t;
              } else a2.head && (a2.head.name = null);
              a2.length = 0, a2.mode = 16187;
            case 16187:
              if (4096 & a2.flags) {
                if (0 === o2) break t;
                u2 = 0;
                do {
                  y2 = n2[r2 + u2++], a2.head && y2 && a2.length < 65536 && (a2.head.comment += String.fromCharCode(y2));
                } while (y2 && u2 < o2);
                if (512 & a2.flags && 4 & a2.wrap && (a2.check = H(a2.check, n2, u2, r2)), o2 -= u2, r2 += u2, y2) break t;
              } else a2.head && (a2.head.comment = null);
              a2.mode = 16188;
            case 16188:
              if (512 & a2.flags) {
                for (; d2 < 16; ) {
                  if (0 === o2) break t;
                  o2--, h2 += n2[r2++] << d2, d2 += 8;
                }
                if (4 & a2.wrap && h2 !== (65535 & a2.check)) {
                  t2.msg = "header crc mismatch", a2.mode = Be;
                  break;
                }
                h2 = 0, d2 = 0;
              }
              a2.head && (a2.head.hcrc = a2.flags >> 9 & 1, a2.head.done = true), t2.adler = a2.check = 0, a2.mode = Te;
              break;
            case 16189:
              for (; d2 < 32; ) {
                if (0 === o2) break t;
                o2--, h2 += n2[r2++] << d2, d2 += 8;
              }
              t2.adler = a2.check = Ce(h2), h2 = 0, d2 = 0, a2.mode = De;
            case De:
              if (0 === a2.havedict) return t2.next_out = s2, t2.avail_out = l2, t2.next_in = r2, t2.avail_in = o2, a2.hold = h2, a2.bits = d2, ze;
              t2.adler = a2.check = 1, a2.mode = Te;
            case Te:
              if (e2 === ve || e2 === ke) break t;
            case Oe:
              if (a2.last) {
                h2 >>>= 7 & d2, d2 -= 7 & d2, a2.mode = Ne;
                break;
              }
              for (; d2 < 3; ) {
                if (0 === o2) break t;
                o2--, h2 += n2[r2++] << d2, d2 += 8;
              }
              switch (a2.last = 1 & h2, d2 -= 1, 3 & (h2 >>>= 1)) {
                case 0:
                  a2.mode = 16193;
                  break;
                case 1:
                  if (qe(a2), a2.mode = Fe, e2 === ke) {
                    h2 >>>= 2, d2 -= 2;
                    break t;
                  }
                  break;
                case 2:
                  a2.mode = 16196;
                  break;
                case 3:
                  t2.msg = "invalid block type", a2.mode = Be;
              }
              h2 >>>= 2, d2 -= 2;
              break;
            case 16193:
              for (h2 >>>= 7 & d2, d2 -= 7 & d2; d2 < 32; ) {
                if (0 === o2) break t;
                o2--, h2 += n2[r2++] << d2, d2 += 8;
              }
              if ((65535 & h2) != (h2 >>> 16 ^ 65535)) {
                t2.msg = "invalid stored block lengths", a2.mode = Be;
                break;
              }
              if (a2.length = 65535 & h2, h2 = 0, d2 = 0, a2.mode = Ie, e2 === ke) break t;
            case Ie:
              a2.mode = 16195;
            case 16195:
              if (u2 = a2.length) {
                if (u2 > o2 && (u2 = o2), u2 > l2 && (u2 = l2), 0 === u2) break t;
                i2.set(n2.subarray(r2, r2 + u2), s2), o2 -= u2, r2 += u2, l2 -= u2, s2 += u2, a2.length -= u2;
                break;
              }
              a2.mode = Te;
              break;
            case 16196:
              for (; d2 < 14; ) {
                if (0 === o2) break t;
                o2--, h2 += n2[r2++] << d2, d2 += 8;
              }
              if (a2.nlen = 257 + (31 & h2), h2 >>>= 5, d2 -= 5, a2.ndist = 1 + (31 & h2), h2 >>>= 5, d2 -= 5, a2.ncode = 4 + (15 & h2), h2 >>>= 4, d2 -= 4, a2.nlen > 286 || a2.ndist > 30) {
                t2.msg = "too many length or distance symbols", a2.mode = Be;
                break;
              }
              a2.have = 0, a2.mode = 16197;
            case 16197:
              for (; a2.have < a2.ncode; ) {
                for (; d2 < 3; ) {
                  if (0 === o2) break t;
                  o2--, h2 += n2[r2++] << d2, d2 += 8;
                }
                a2.lens[Z2[a2.have++]] = 7 & h2, h2 >>>= 3, d2 -= 3;
              }
              for (; a2.have < 19; ) a2.lens[Z2[a2.have++]] = 0;
              if (a2.lencode = a2.lendyn, a2.lenbits = 7, z2 = { bits: a2.lenbits }, x2 = ge(0, a2.lens, 0, 19, a2.lencode, 0, a2.work, z2), a2.lenbits = z2.bits, x2) {
                t2.msg = "invalid code lengths set", a2.mode = Be;
                break;
              }
              a2.have = 0, a2.mode = 16198;
            case 16198:
              for (; a2.have < a2.nlen + a2.ndist; ) {
                for (; b2 = (E2 = a2.lencode[h2 & (1 << a2.lenbits) - 1]) >>> 16 & 255, g2 = 65535 & E2, !((m2 = E2 >>> 24) <= d2); ) {
                  if (0 === o2) break t;
                  o2--, h2 += n2[r2++] << d2, d2 += 8;
                }
                if (g2 < 16) h2 >>>= m2, d2 -= m2, a2.lens[a2.have++] = g2;
                else {
                  if (16 === g2) {
                    for (A2 = m2 + 2; d2 < A2; ) {
                      if (0 === o2) break t;
                      o2--, h2 += n2[r2++] << d2, d2 += 8;
                    }
                    if (h2 >>>= m2, d2 -= m2, 0 === a2.have) {
                      t2.msg = "invalid bit length repeat", a2.mode = Be;
                      break;
                    }
                    y2 = a2.lens[a2.have - 1], u2 = 3 + (3 & h2), h2 >>>= 2, d2 -= 2;
                  } else if (17 === g2) {
                    for (A2 = m2 + 3; d2 < A2; ) {
                      if (0 === o2) break t;
                      o2--, h2 += n2[r2++] << d2, d2 += 8;
                    }
                    d2 -= m2, y2 = 0, u2 = 3 + (7 & (h2 >>>= m2)), h2 >>>= 3, d2 -= 3;
                  } else {
                    for (A2 = m2 + 7; d2 < A2; ) {
                      if (0 === o2) break t;
                      o2--, h2 += n2[r2++] << d2, d2 += 8;
                    }
                    d2 -= m2, y2 = 0, u2 = 11 + (127 & (h2 >>>= m2)), h2 >>>= 7, d2 -= 7;
                  }
                  if (a2.have + u2 > a2.nlen + a2.ndist) {
                    t2.msg = "invalid bit length repeat", a2.mode = Be;
                    break;
                  }
                  for (; u2--; ) a2.lens[a2.have++] = y2;
                }
              }
              if (a2.mode === Be) break;
              if (0 === a2.lens[256]) {
                t2.msg = "invalid code -- missing end-of-block", a2.mode = Be;
                break;
              }
              if (a2.lenbits = 9, z2 = { bits: a2.lenbits }, x2 = ge(1, a2.lens, 0, a2.nlen, a2.lencode, 0, a2.work, z2), a2.lenbits = z2.bits, x2) {
                t2.msg = "invalid literal/lengths set", a2.mode = Be;
                break;
              }
              if (a2.distbits = 6, a2.distcode = a2.distdyn, z2 = { bits: a2.distbits }, x2 = ge(2, a2.lens, a2.nlen, a2.ndist, a2.distcode, 0, a2.work, z2), a2.distbits = z2.bits, x2) {
                t2.msg = "invalid distances set", a2.mode = Be;
                break;
              }
              if (a2.mode = Fe, e2 === ke) break t;
            case Fe:
              a2.mode = Le;
            case Le:
              if (o2 >= 6 && l2 >= 258) {
                t2.next_out = s2, t2.avail_out = l2, t2.next_in = r2, t2.avail_in = o2, a2.hold = h2, a2.bits = d2, fe(t2, f2), s2 = t2.next_out, i2 = t2.output, l2 = t2.avail_out, r2 = t2.next_in, n2 = t2.input, o2 = t2.avail_in, h2 = a2.hold, d2 = a2.bits, a2.mode === Te && (a2.back = -1);
                break;
              }
              for (a2.back = 0; b2 = (E2 = a2.lencode[h2 & (1 << a2.lenbits) - 1]) >>> 16 & 255, g2 = 65535 & E2, !((m2 = E2 >>> 24) <= d2); ) {
                if (0 === o2) break t;
                o2--, h2 += n2[r2++] << d2, d2 += 8;
              }
              if (b2 && 0 == (240 & b2)) {
                for (p2 = m2, v2 = b2, k2 = g2; b2 = (E2 = a2.lencode[k2 + ((h2 & (1 << p2 + v2) - 1) >> p2)]) >>> 16 & 255, g2 = 65535 & E2, !(p2 + (m2 = E2 >>> 24) <= d2); ) {
                  if (0 === o2) break t;
                  o2--, h2 += n2[r2++] << d2, d2 += 8;
                }
                h2 >>>= p2, d2 -= p2, a2.back += p2;
              }
              if (h2 >>>= m2, d2 -= m2, a2.back += m2, a2.length = g2, 0 === b2) {
                a2.mode = 16205;
                break;
              }
              if (32 & b2) {
                a2.back = -1, a2.mode = Te;
                break;
              }
              if (64 & b2) {
                t2.msg = "invalid literal/length code", a2.mode = Be;
                break;
              }
              a2.extra = 15 & b2, a2.mode = 16201;
            case 16201:
              if (a2.extra) {
                for (A2 = a2.extra; d2 < A2; ) {
                  if (0 === o2) break t;
                  o2--, h2 += n2[r2++] << d2, d2 += 8;
                }
                a2.length += h2 & (1 << a2.extra) - 1, h2 >>>= a2.extra, d2 -= a2.extra, a2.back += a2.extra;
              }
              a2.was = a2.length, a2.mode = 16202;
            case 16202:
              for (; b2 = (E2 = a2.distcode[h2 & (1 << a2.distbits) - 1]) >>> 16 & 255, g2 = 65535 & E2, !((m2 = E2 >>> 24) <= d2); ) {
                if (0 === o2) break t;
                o2--, h2 += n2[r2++] << d2, d2 += 8;
              }
              if (0 == (240 & b2)) {
                for (p2 = m2, v2 = b2, k2 = g2; b2 = (E2 = a2.distcode[k2 + ((h2 & (1 << p2 + v2) - 1) >> p2)]) >>> 16 & 255, g2 = 65535 & E2, !(p2 + (m2 = E2 >>> 24) <= d2); ) {
                  if (0 === o2) break t;
                  o2--, h2 += n2[r2++] << d2, d2 += 8;
                }
                h2 >>>= p2, d2 -= p2, a2.back += p2;
              }
              if (h2 >>>= m2, d2 -= m2, a2.back += m2, 64 & b2) {
                t2.msg = "invalid distance code", a2.mode = Be;
                break;
              }
              a2.offset = g2, a2.extra = 15 & b2, a2.mode = 16203;
            case 16203:
              if (a2.extra) {
                for (A2 = a2.extra; d2 < A2; ) {
                  if (0 === o2) break t;
                  o2--, h2 += n2[r2++] << d2, d2 += 8;
                }
                a2.offset += h2 & (1 << a2.extra) - 1, h2 >>>= a2.extra, d2 -= a2.extra, a2.back += a2.extra;
              }
              if (a2.offset > a2.dmax) {
                t2.msg = "invalid distance too far back", a2.mode = Be;
                break;
              }
              a2.mode = 16204;
            case 16204:
              if (0 === l2) break t;
              if (u2 = f2 - l2, a2.offset > u2) {
                if ((u2 = a2.offset - u2) > a2.whave && a2.sane) {
                  t2.msg = "invalid distance too far back", a2.mode = Be;
                  break;
                }
                u2 > a2.wnext ? (u2 -= a2.wnext, c2 = a2.wsize - u2) : c2 = a2.wnext - u2, u2 > a2.length && (u2 = a2.length), w2 = a2.window;
              } else w2 = i2, c2 = s2 - a2.offset, u2 = a2.length;
              u2 > l2 && (u2 = l2), l2 -= u2, a2.length -= u2;
              do {
                i2[s2++] = w2[c2++];
              } while (--u2);
              0 === a2.length && (a2.mode = Le);
              break;
            case 16205:
              if (0 === l2) break t;
              i2[s2++] = a2.length, l2--, a2.mode = Le;
              break;
            case Ne:
              if (a2.wrap) {
                for (; d2 < 32; ) {
                  if (0 === o2) break t;
                  o2--, h2 |= n2[r2++] << d2, d2 += 8;
                }
                if (f2 -= l2, t2.total_out += f2, a2.total += f2, 4 & a2.wrap && f2 && (t2.adler = a2.check = a2.flags ? H(a2.check, i2, f2, s2 - f2) : C(a2.check, i2, f2, s2 - f2)), f2 = l2, 4 & a2.wrap && (a2.flags ? h2 : Ce(h2)) !== a2.check) {
                  t2.msg = "incorrect data check", a2.mode = Be;
                  break;
                }
                h2 = 0, d2 = 0;
              }
              a2.mode = 16207;
            case 16207:
              if (a2.wrap && a2.flags) {
                for (; d2 < 32; ) {
                  if (0 === o2) break t;
                  o2--, h2 += n2[r2++] << d2, d2 += 8;
                }
                if (4 & a2.wrap && h2 !== (4294967295 & a2.total)) {
                  t2.msg = "incorrect length check", a2.mode = Be;
                  break;
                }
                h2 = 0, d2 = 0;
              }
              a2.mode = 16208;
            case 16208:
              x2 = xe;
              break t;
            case Be:
              x2 = Ee;
              break t;
            case 16210:
              return Re;
            default:
              return Ae;
          }
          return t2.next_out = s2, t2.avail_out = l2, t2.next_in = r2, t2.avail_in = o2, a2.hold = h2, a2.bits = d2, (a2.wsize || f2 !== t2.avail_out && a2.mode < Be && (a2.mode < Ne || e2 !== pe)) && Je(t2, t2.output, t2.next_out, f2 - t2.avail_out), _2 -= t2.avail_in, f2 -= t2.avail_out, t2.total_in += _2, t2.total_out += f2, a2.total += f2, 4 & a2.wrap && f2 && (t2.adler = a2.check = a2.flags ? H(a2.check, i2, f2, t2.next_out - f2) : C(a2.check, i2, f2, t2.next_out - f2)), t2.data_type = a2.bits + (a2.last ? 64 : 0) + (a2.mode === Te ? 128 : 0) + (a2.mode === Fe || a2.mode === Ie ? 256 : 0), (0 === _2 && 0 === f2 || e2 === pe) && x2 === ye && (x2 = Ze), x2;
        }, inflateEnd: function(t2) {
          if (Ke(t2)) return Ae;
          var e2 = t2.state;
          return e2.window && (e2.window = null), t2.state = null, ye;
        }, inflateGetHeader: function(t2, e2) {
          if (Ke(t2)) return Ae;
          var a2 = t2.state;
          return 0 == (2 & a2.wrap) ? Ae : (a2.head = e2, e2.done = false, ye);
        }, inflateSetDictionary: function(t2, e2) {
          var a2, n2 = e2.length;
          return Ke(t2) || 0 !== (a2 = t2.state).wrap && a2.mode !== De ? Ae : a2.mode === De && C(1, e2, n2, 0) !== a2.check ? Ee : Je(t2, e2, n2, n2) ? (a2.mode = 16210, Re) : (a2.havedict = 1, ye);
        }, inflateInfo: "pako inflate (from Nodeca project)" };
        var Ve = function() {
          this.text = 0, this.time = 0, this.xflags = 0, this.os = 0, this.extra = null, this.extra_len = 0, this.name = "", this.comment = "", this.hcrc = 0, this.done = false;
        }, $e = Object.prototype.toString, ta = K.Z_NO_FLUSH, ea = K.Z_FINISH, aa = K.Z_OK, na = K.Z_STREAM_END, ia = K.Z_NEED_DICT, ra = K.Z_STREAM_ERROR, sa = K.Z_DATA_ERROR, oa = K.Z_MEM_ERROR;
        function la(t2) {
          this.options = Kt({ chunkSize: 65536, windowBits: 15, to: "" }, t2 || {});
          var e2 = this.options;
          e2.raw && e2.windowBits >= 0 && e2.windowBits < 16 && (e2.windowBits = -e2.windowBits, 0 === e2.windowBits && (e2.windowBits = -15)), !(e2.windowBits >= 0 && e2.windowBits < 16) || t2 && t2.windowBits || (e2.windowBits += 32), e2.windowBits > 15 && e2.windowBits < 48 && 0 == (15 & e2.windowBits) && (e2.windowBits |= 15), this.err = 0, this.msg = "", this.ended = false, this.chunks = [], this.strm = new Qt(), this.strm.avail_out = 0;
          var a2 = Qe.inflateInit2(this.strm, e2.windowBits);
          if (a2 !== aa) throw new Error(j[a2]);
          if (this.header = new Ve(), Qe.inflateGetHeader(this.strm, this.header), e2.dictionary && ("string" == typeof e2.dictionary ? e2.dictionary = Wt(e2.dictionary) : "[object ArrayBuffer]" === $e.call(e2.dictionary) && (e2.dictionary = new Uint8Array(e2.dictionary)), e2.raw && (a2 = Qe.inflateSetDictionary(this.strm, e2.dictionary)) !== aa)) throw new Error(j[a2]);
        }
        function ha(t2, e2) {
          var a2 = new la(e2);
          if (a2.push(t2), a2.err) throw a2.msg || j[a2.err];
          return a2.result;
        }
        la.prototype.push = function(t2, e2) {
          var a2, n2, i2, r2 = this.strm, s2 = this.options.chunkSize, o2 = this.options.dictionary;
          if (this.ended) return false;
          for (n2 = e2 === ~~e2 ? e2 : true === e2 ? ea : ta, "[object ArrayBuffer]" === $e.call(t2) ? r2.input = new Uint8Array(t2) : r2.input = t2, r2.next_in = 0, r2.avail_in = r2.input.length; ; ) {
            for (0 === r2.avail_out && (r2.output = new Uint8Array(s2), r2.next_out = 0, r2.avail_out = s2), (a2 = Qe.inflate(r2, n2)) === ia && o2 && ((a2 = Qe.inflateSetDictionary(r2, o2)) === aa ? a2 = Qe.inflate(r2, n2) : a2 === sa && (a2 = ia)); r2.avail_in > 0 && a2 === na && r2.state.wrap > 0 && 0 !== t2[r2.next_in]; ) Qe.inflateReset(r2), a2 = Qe.inflate(r2, n2);
            switch (a2) {
              case ra:
              case sa:
              case ia:
              case oa:
                return this.onEnd(a2), this.ended = true, false;
            }
            if (i2 = r2.avail_out, r2.next_out && (0 === r2.avail_out || a2 === na)) if ("string" === this.options.to) {
              var l2 = Jt(r2.output, r2.next_out), h2 = r2.next_out - l2, d2 = qt(r2.output, l2);
              r2.next_out = h2, r2.avail_out = s2 - h2, h2 && r2.output.set(r2.output.subarray(l2, l2 + h2), 0), this.onData(d2);
            } else this.onData(r2.output.length === r2.next_out ? r2.output : r2.output.subarray(0, r2.next_out));
            if (a2 !== aa || 0 !== i2) {
              if (a2 === na) return a2 = Qe.inflateEnd(this.strm), this.onEnd(a2), this.ended = true, true;
              if (0 === r2.avail_in) break;
            }
          }
          return true;
        }, la.prototype.onData = function(t2) {
          this.chunks.push(t2);
        }, la.prototype.onEnd = function(t2) {
          t2 === aa && ("string" === this.options.to ? this.result = this.chunks.join("") : this.result = Pt(this.chunks)), this.chunks = [], this.err = t2, this.msg = this.strm.msg;
        };
        var da = { Inflate: la, inflate: ha, inflateRaw: function(t2, e2) {
          return (e2 = e2 || {}).raw = true, ha(t2, e2);
        }, ungzip: ha, constants: K }, _a = de.Deflate, fa = de.deflate, ua = de.deflateRaw, ca = de.gzip, wa = da.Inflate, ma = da.inflate, ba = da.inflateRaw, ga = da.ungzip, pa = K, va = { Deflate: _a, deflate: fa, deflateRaw: ua, gzip: ca, Inflate: wa, inflate: ma, inflateRaw: ba, ungzip: ga, constants: pa };
        t.Deflate = _a, t.Inflate = wa, t.constants = pa, t.default = va, t.deflate = fa, t.deflateRaw = ua, t.gzip = ca, t.inflate = ma, t.inflateRaw = ba, t.ungzip = ga, Object.defineProperty(t, "__esModule", { value: true });
      }));
    }
  });

  // node_modules/pizzip/js/flate.js
  var require_flate = __commonJS({
    "node_modules/pizzip/js/flate.js"(exports) {
      "use strict";
      var USE_TYPEDARRAY = typeof Uint8Array !== "undefined" && typeof Uint16Array !== "undefined" && typeof Uint32Array !== "undefined";
      var pako = require_pako_es5_min();
      exports.uncompressInputType = USE_TYPEDARRAY ? "uint8array" : "array";
      exports.compressInputType = USE_TYPEDARRAY ? "uint8array" : "array";
      exports.magic = "\b\0";
      exports.compress = function(input, compressionOptions) {
        return pako.deflateRaw(input, {
          level: compressionOptions.level || -1
          // default compression
        });
      };
      exports.uncompress = function(input) {
        return pako.inflateRaw(input);
      };
    }
  });

  // node_modules/pizzip/js/compressions.js
  var require_compressions = __commonJS({
    "node_modules/pizzip/js/compressions.js"(exports) {
      "use strict";
      exports.STORE = {
        magic: "\0\0",
        compress: function compress(content) {
          return content;
        },
        uncompress: function uncompress(content) {
          return content;
        },
        compressInputType: null,
        uncompressInputType: null
      };
      exports.DEFLATE = require_flate();
    }
  });

  // node_modules/pizzip/js/nodeBuffer.js
  var require_nodeBuffer = __commonJS({
    "node_modules/pizzip/js/nodeBuffer.js"(exports, module) {
      "use strict";
      module.exports = function(data, encoding) {
        if (typeof data === "number") {
          return Buffer.alloc(data);
        }
        return Buffer.from(data, encoding);
      };
      module.exports.test = function(b) {
        return Buffer.isBuffer(b);
      };
    }
  });

  // node_modules/pizzip/js/utils.js
  var require_utils = __commonJS({
    "node_modules/pizzip/js/utils.js"(exports) {
      "use strict";
      function _typeof(o) {
        "@babel/helpers - typeof";
        return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }
      var support = require_support();
      var compressions = require_compressions();
      var nodeBuffer = require_nodeBuffer();
      exports.string2binary = function(str) {
        var result = "";
        for (var i = 0; i < str.length; i++) {
          result += String.fromCharCode(str.charCodeAt(i) & 255);
        }
        return result;
      };
      exports.arrayBuffer2Blob = function(buffer, mimeType) {
        exports.checkSupport("blob");
        mimeType = mimeType || "application/zip";
        try {
          return new Blob([buffer], {
            type: mimeType
          });
        } catch (_unused) {
          try {
            var Builder = window.BlobBuilder || window.WebKitBlobBuilder || window.MozBlobBuilder || window.MSBlobBuilder;
            var builder = new Builder();
            builder.append(buffer);
            return builder.getBlob(mimeType);
          } catch (_unused2) {
            throw new Error("Bug : can't construct the Blob.");
          }
        }
      };
      function identity(input) {
        return input;
      }
      function stringToArrayLike(str, array) {
        for (var i = 0; i < str.length; ++i) {
          array[i] = str.charCodeAt(i) & 255;
        }
        return array;
      }
      function arrayLikeToString(array) {
        var chunk = 65536;
        var result = [], len = array.length, type = exports.getTypeOf(array);
        var k = 0, canUseApply = true;
        try {
          switch (type) {
            case "uint8array":
              String.fromCharCode.apply(null, new Uint8Array(0));
              break;
            case "nodebuffer":
              String.fromCharCode.apply(null, nodeBuffer(0));
              break;
          }
        } catch (_unused3) {
          canUseApply = false;
        }
        if (!canUseApply) {
          var resultStr = "";
          for (var i = 0; i < array.length; i++) {
            resultStr += String.fromCharCode(array[i]);
          }
          return resultStr;
        }
        while (k < len && chunk > 1) {
          try {
            if (type === "array" || type === "nodebuffer") {
              result.push(String.fromCharCode.apply(null, array.slice(k, Math.min(k + chunk, len))));
            } else {
              result.push(String.fromCharCode.apply(null, array.subarray(k, Math.min(k + chunk, len))));
            }
            k += chunk;
          } catch (_unused4) {
            chunk = Math.floor(chunk / 2);
          }
        }
        return result.join("");
      }
      exports.applyFromCharCode = arrayLikeToString;
      function arrayLikeToArrayLike(arrayFrom, arrayTo) {
        for (var i = 0; i < arrayFrom.length; i++) {
          arrayTo[i] = arrayFrom[i];
        }
        return arrayTo;
      }
      var transform = {};
      transform.string = {
        string: identity,
        array: function array(input) {
          return stringToArrayLike(input, new Array(input.length));
        },
        arraybuffer: function arraybuffer(input) {
          return transform.string.uint8array(input).buffer;
        },
        uint8array: function uint8array(input) {
          return stringToArrayLike(input, new Uint8Array(input.length));
        },
        nodebuffer: function nodebuffer(input) {
          return stringToArrayLike(input, nodeBuffer(input.length));
        }
      };
      transform.array = {
        string: arrayLikeToString,
        array: identity,
        arraybuffer: function arraybuffer(input) {
          return new Uint8Array(input).buffer;
        },
        uint8array: function uint8array(input) {
          return new Uint8Array(input);
        },
        nodebuffer: function nodebuffer(input) {
          return nodeBuffer(input);
        }
      };
      transform.arraybuffer = {
        string: function string(input) {
          return arrayLikeToString(new Uint8Array(input));
        },
        array: function array(input) {
          return arrayLikeToArrayLike(new Uint8Array(input), new Array(input.byteLength));
        },
        arraybuffer: identity,
        uint8array: function uint8array(input) {
          return new Uint8Array(input);
        },
        nodebuffer: function nodebuffer(input) {
          return nodeBuffer(new Uint8Array(input));
        }
      };
      transform.uint8array = {
        string: arrayLikeToString,
        array: function array(input) {
          return arrayLikeToArrayLike(input, new Array(input.length));
        },
        arraybuffer: function arraybuffer(input) {
          return input.buffer;
        },
        uint8array: identity,
        nodebuffer: function nodebuffer(input) {
          return nodeBuffer(input);
        }
      };
      transform.nodebuffer = {
        string: arrayLikeToString,
        array: function array(input) {
          return arrayLikeToArrayLike(input, new Array(input.length));
        },
        arraybuffer: function arraybuffer(input) {
          return transform.nodebuffer.uint8array(input).buffer;
        },
        uint8array: function uint8array(input) {
          return arrayLikeToArrayLike(input, new Uint8Array(input.length));
        },
        nodebuffer: identity
      };
      exports.transformTo = function(outputType, input) {
        if (!input) {
          input = "";
        }
        if (!outputType) {
          return input;
        }
        exports.checkSupport(outputType);
        var inputType = exports.getTypeOf(input);
        var result = transform[inputType][outputType](input);
        return result;
      };
      exports.getTypeOf = function(input) {
        if (input == null) {
          return;
        }
        if (typeof input === "string") {
          return "string";
        }
        var protoResult = Object.prototype.toString.call(input);
        if (protoResult === "[object Array]") {
          return "array";
        }
        if (support.nodebuffer && nodeBuffer.test(input)) {
          return "nodebuffer";
        }
        if (support.uint8array && protoResult === "[object Uint8Array]") {
          return "uint8array";
        }
        if (support.arraybuffer && protoResult === "[object ArrayBuffer]") {
          return "arraybuffer";
        }
        if (protoResult === "[object Promise]") {
          throw new Error("Cannot read data from a promise, you probably are running new PizZip(data) with a promise");
        }
        if (_typeof(input) === "object" && typeof input.file === "function") {
          throw new Error("Cannot read data from a pizzip instance, you probably are running new PizZip(zip) with a zipinstance");
        }
        if (protoResult === "[object Date]") {
          throw new Error("Cannot read data from a Date, you probably are running new PizZip(data) with a date");
        }
        if (_typeof(input) === "object" && input.crc32 == null) {
          throw new Error("Unsupported data given to new PizZip(data) (object given)");
        }
      };
      exports.checkSupport = function(type) {
        var supported = support[type.toLowerCase()];
        if (!supported) {
          throw new Error(type + " is not supported by this browser");
        }
      };
      exports.MAX_VALUE_16BITS = 65535;
      exports.MAX_VALUE_32BITS = -1;
      exports.pretty = function(str) {
        var res = "", code, i;
        for (i = 0; i < (str || "").length; i++) {
          code = str.charCodeAt(i);
          res += "\\x" + (code < 16 ? "0" : "") + code.toString(16).toUpperCase();
        }
        return res;
      };
      exports.findCompression = function(compressionMethod) {
        for (var method in compressions) {
          if (!compressions.hasOwnProperty(method)) {
            continue;
          }
          if (compressions[method].magic === compressionMethod) {
            return compressions[method];
          }
        }
        return null;
      };
      exports.isRegExp = function(object) {
        return Object.prototype.toString.call(object) === "[object RegExp]";
      };
      exports.extend = function() {
        var result = {};
        var i, attr;
        for (i = 0; i < arguments.length; i++) {
          for (attr in arguments[i]) {
            if (arguments[i].hasOwnProperty(attr) && typeof result[attr] === "undefined") {
              result[attr] = arguments[i][attr];
            }
          }
        }
        return result;
      };
    }
  });

  // node_modules/pizzip/js/crc32.js
  var require_crc32 = __commonJS({
    "node_modules/pizzip/js/crc32.js"(exports, module) {
      "use strict";
      var utils = require_utils();
      var table = [0, 1996959894, 3993919788, 2567524794, 124634137, 1886057615, 3915621685, 2657392035, 249268274, 2044508324, 3772115230, 2547177864, 162941995, 2125561021, 3887607047, 2428444049, 498536548, 1789927666, 4089016648, 2227061214, 450548861, 1843258603, 4107580753, 2211677639, 325883990, 1684777152, 4251122042, 2321926636, 335633487, 1661365465, 4195302755, 2366115317, 997073096, 1281953886, 3579855332, 2724688242, 1006888145, 1258607687, 3524101629, 2768942443, 901097722, 1119000684, 3686517206, 2898065728, 853044451, 1172266101, 3705015759, 2882616665, 651767980, 1373503546, 3369554304, 3218104598, 565507253, 1454621731, 3485111705, 3099436303, 671266974, 1594198024, 3322730930, 2970347812, 795835527, 1483230225, 3244367275, 3060149565, 1994146192, 31158534, 2563907772, 4023717930, 1907459465, 112637215, 2680153253, 3904427059, 2013776290, 251722036, 2517215374, 3775830040, 2137656763, 141376813, 2439277719, 3865271297, 1802195444, 476864866, 2238001368, 4066508878, 1812370925, 453092731, 2181625025, 4111451223, 1706088902, 314042704, 2344532202, 4240017532, 1658658271, 366619977, 2362670323, 4224994405, 1303535960, 984961486, 2747007092, 3569037538, 1256170817, 1037604311, 2765210733, 3554079995, 1131014506, 879679996, 2909243462, 3663771856, 1141124467, 855842277, 2852801631, 3708648649, 1342533948, 654459306, 3188396048, 3373015174, 1466479909, 544179635, 3110523913, 3462522015, 1591671054, 702138776, 2966460450, 3352799412, 1504918807, 783551873, 3082640443, 3233442989, 3988292384, 2596254646, 62317068, 1957810842, 3939845945, 2647816111, 81470997, 1943803523, 3814918930, 2489596804, 225274430, 2053790376, 3826175755, 2466906013, 167816743, 2097651377, 4027552580, 2265490386, 503444072, 1762050814, 4150417245, 2154129355, 426522225, 1852507879, 4275313526, 2312317920, 282753626, 1742555852, 4189708143, 2394877945, 397917763, 1622183637, 3604390888, 2714866558, 953729732, 1340076626, 3518719985, 2797360999, 1068828381, 1219638859, 3624741850, 2936675148, 906185462, 1090812512, 3747672003, 2825379669, 829329135, 1181335161, 3412177804, 3160834842, 628085408, 1382605366, 3423369109, 3138078467, 570562233, 1426400815, 3317316542, 2998733608, 733239954, 1555261956, 3268935591, 3050360625, 752459403, 1541320221, 2607071920, 3965973030, 1969922972, 40735498, 2617837225, 3943577151, 1913087877, 83908371, 2512341634, 3803740692, 2075208622, 213261112, 2463272603, 3855990285, 2094854071, 198958881, 2262029012, 4057260610, 1759359992, 534414190, 2176718541, 4139329115, 1873836001, 414664567, 2282248934, 4279200368, 1711684554, 285281116, 2405801727, 4167216745, 1634467795, 376229701, 2685067896, 3608007406, 1308918612, 956543938, 2808555105, 3495958263, 1231636301, 1047427035, 2932959818, 3654703836, 1088359270, 936918e3, 2847714899, 3736837829, 1202900863, 817233897, 3183342108, 3401237130, 1404277552, 615818150, 3134207493, 3453421203, 1423857449, 601450431, 3009837614, 3294710456, 1567103746, 711928724, 3020668471, 3272380065, 1510334235, 755167117];
      module.exports = function crc32(input, crc) {
        if (typeof input === "undefined" || !input.length) {
          return 0;
        }
        var isArray = utils.getTypeOf(input) !== "string";
        if (typeof crc == "undefined") {
          crc = 0;
        }
        var x = 0;
        var y = 0;
        var b = 0;
        crc ^= -1;
        for (var i = 0, iTop = input.length; i < iTop; i++) {
          b = isArray ? input[i] : input.charCodeAt(i);
          y = (crc ^ b) & 255;
          x = table[y];
          crc = crc >>> 8 ^ x;
        }
        return crc ^ -1;
      };
    }
  });

  // node_modules/pizzip/js/signature.js
  var require_signature = __commonJS({
    "node_modules/pizzip/js/signature.js"(exports) {
      "use strict";
      exports.LOCAL_FILE_HEADER = "PK";
      exports.CENTRAL_FILE_HEADER = "PK";
      exports.CENTRAL_DIRECTORY_END = "PK";
      exports.ZIP64_CENTRAL_DIRECTORY_LOCATOR = "PK\x07";
      exports.ZIP64_CENTRAL_DIRECTORY_END = "PK";
      exports.DATA_DESCRIPTOR = "PK\x07\b";
    }
  });

  // node_modules/pizzip/js/defaults.js
  var require_defaults = __commonJS({
    "node_modules/pizzip/js/defaults.js"(exports) {
      "use strict";
      exports.base64 = false;
      exports.binary = false;
      exports.dir = false;
      exports.createFolders = false;
      exports.date = null;
      exports.compression = null;
      exports.compressionOptions = null;
      exports.comment = null;
      exports.unixPermissions = null;
      exports.dosPermissions = null;
    }
  });

  // node_modules/pizzip/js/compressedObject.js
  var require_compressedObject = __commonJS({
    "node_modules/pizzip/js/compressedObject.js"(exports, module) {
      "use strict";
      function CompressedObject() {
        this.compressedSize = 0;
        this.uncompressedSize = 0;
        this.crc32 = 0;
        this.compressionMethod = null;
        this.compressedContent = null;
      }
      CompressedObject.prototype = {
        /**
         * Return the decompressed content in an unspecified format.
         * The format will depend on the decompressor.
         * @return {Object} the decompressed content.
         */
        getContent: function getContent() {
          return null;
        },
        /**
         * Return the compressed content in an unspecified format.
         * The format will depend on the compressed conten source.
         * @return {Object} the compressed content.
         */
        getCompressedContent: function getCompressedContent() {
          return null;
        }
      };
      module.exports = CompressedObject;
    }
  });

  // node_modules/pizzip/js/utf8.js
  var require_utf8 = __commonJS({
    "node_modules/pizzip/js/utf8.js"(exports) {
      "use strict";
      var utils = require_utils();
      var support = require_support();
      var nodeBuffer = require_nodeBuffer();
      var _utf8len = new Array(256);
      for (i = 0; i < 256; i++) {
        _utf8len[i] = i >= 252 ? 6 : i >= 248 ? 5 : i >= 240 ? 4 : i >= 224 ? 3 : i >= 192 ? 2 : 1;
      }
      var i;
      _utf8len[254] = _utf8len[254] = 1;
      function string2buf(str) {
        var buf, c, c2, mPos, i2, bufLen = 0;
        var strLen = str.length;
        for (mPos = 0; mPos < strLen; mPos++) {
          c = str.charCodeAt(mPos);
          if ((c & 64512) === 55296 && mPos + 1 < strLen) {
            c2 = str.charCodeAt(mPos + 1);
            if ((c2 & 64512) === 56320) {
              c = 65536 + (c - 55296 << 10) + (c2 - 56320);
              mPos++;
            }
          }
          bufLen += c < 128 ? 1 : c < 2048 ? 2 : c < 65536 ? 3 : 4;
        }
        if (support.uint8array) {
          buf = new Uint8Array(bufLen);
        } else {
          buf = new Array(bufLen);
        }
        for (i2 = 0, mPos = 0; i2 < bufLen; mPos++) {
          c = str.charCodeAt(mPos);
          if ((c & 64512) === 55296 && mPos + 1 < strLen) {
            c2 = str.charCodeAt(mPos + 1);
            if ((c2 & 64512) === 56320) {
              c = 65536 + (c - 55296 << 10) + (c2 - 56320);
              mPos++;
            }
          }
          if (c < 128) {
            buf[i2++] = c;
          } else if (c < 2048) {
            buf[i2++] = 192 | c >>> 6;
            buf[i2++] = 128 | c & 63;
          } else if (c < 65536) {
            buf[i2++] = 224 | c >>> 12;
            buf[i2++] = 128 | c >>> 6 & 63;
            buf[i2++] = 128 | c & 63;
          } else {
            buf[i2++] = 240 | c >>> 18;
            buf[i2++] = 128 | c >>> 12 & 63;
            buf[i2++] = 128 | c >>> 6 & 63;
            buf[i2++] = 128 | c & 63;
          }
        }
        return buf;
      }
      function utf8border(buf, max) {
        var pos;
        max = max || buf.length;
        if (max > buf.length) {
          max = buf.length;
        }
        pos = max - 1;
        while (pos >= 0 && (buf[pos] & 192) === 128) {
          pos--;
        }
        if (pos < 0) {
          return max;
        }
        if (pos === 0) {
          return max;
        }
        return pos + _utf8len[buf[pos]] > max ? pos : max;
      }
      function buf2string(buf) {
        var i2, out, c, cLen;
        var len = buf.length;
        var utf16buf = new Array(len * 2);
        for (out = 0, i2 = 0; i2 < len; ) {
          c = buf[i2++];
          if (c < 128) {
            utf16buf[out++] = c;
            continue;
          }
          cLen = _utf8len[c];
          if (cLen > 4) {
            utf16buf[out++] = 65533;
            i2 += cLen - 1;
            continue;
          }
          c &= cLen === 2 ? 31 : cLen === 3 ? 15 : 7;
          while (cLen > 1 && i2 < len) {
            c = c << 6 | buf[i2++] & 63;
            cLen--;
          }
          if (cLen > 1) {
            utf16buf[out++] = 65533;
            continue;
          }
          if (c < 65536) {
            utf16buf[out++] = c;
          } else {
            c -= 65536;
            utf16buf[out++] = 55296 | c >> 10 & 1023;
            utf16buf[out++] = 56320 | c & 1023;
          }
        }
        if (utf16buf.length !== out) {
          if (utf16buf.subarray) {
            utf16buf = utf16buf.subarray(0, out);
          } else {
            utf16buf.length = out;
          }
        }
        return utils.applyFromCharCode(utf16buf);
      }
      exports.utf8encode = function utf8encode(str) {
        if (support.nodebuffer) {
          return nodeBuffer(str, "utf-8");
        }
        return string2buf(str);
      };
      exports.utf8decode = function utf8decode(buf) {
        if (support.nodebuffer) {
          return utils.transformTo("nodebuffer", buf).toString("utf-8");
        }
        buf = utils.transformTo(support.uint8array ? "uint8array" : "array", buf);
        var result = [], len = buf.length, chunk = 65536;
        var k = 0;
        while (k < len) {
          var nextBoundary = utf8border(buf, Math.min(k + chunk, len));
          if (support.uint8array) {
            result.push(buf2string(buf.subarray(k, nextBoundary)));
          } else {
            result.push(buf2string(buf.slice(k, nextBoundary)));
          }
          k = nextBoundary;
        }
        return result.join("");
      };
    }
  });

  // node_modules/pizzip/js/stringWriter.js
  var require_stringWriter = __commonJS({
    "node_modules/pizzip/js/stringWriter.js"(exports, module) {
      "use strict";
      var utils = require_utils();
      function StringWriter() {
        this.data = [];
      }
      StringWriter.prototype = {
        /**
         * Append any content to the current string.
         * @param {Object} input the content to add.
         */
        append: function append(input) {
          input = utils.transformTo("string", input);
          this.data.push(input);
        },
        /**
         * Finalize the construction an return the result.
         * @return {string} the generated string.
         */
        finalize: function finalize() {
          return this.data.join("");
        }
      };
      module.exports = StringWriter;
    }
  });

  // node_modules/pizzip/js/uint8ArrayWriter.js
  var require_uint8ArrayWriter = __commonJS({
    "node_modules/pizzip/js/uint8ArrayWriter.js"(exports, module) {
      "use strict";
      var utils = require_utils();
      function Uint8ArrayWriter(length) {
        this.data = new Uint8Array(length);
        this.index = 0;
      }
      Uint8ArrayWriter.prototype = {
        /**
         * Append any content to the current array.
         * @param {Object} input the content to add.
         */
        append: function append(input) {
          if (input.length !== 0) {
            input = utils.transformTo("uint8array", input);
            this.data.set(input, this.index);
            this.index += input.length;
          }
        },
        /**
         * Finalize the construction an return the result.
         * @return {Uint8Array} the generated array.
         */
        finalize: function finalize() {
          return this.data;
        }
      };
      module.exports = Uint8ArrayWriter;
    }
  });

  // node_modules/pizzip/js/object.js
  var require_object = __commonJS({
    "node_modules/pizzip/js/object.js"(exports, module) {
      "use strict";
      function _createForOfIteratorHelper(r, e) {
        var t = "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
        if (!t) {
          if (Array.isArray(r) || (t = _unsupportedIterableToArray(r)) || e && r && "number" == typeof r.length) {
            t && (r = t);
            var _n = 0, F = function F2() {
            };
            return { s: F, n: function n() {
              return _n >= r.length ? { done: true } : { done: false, value: r[_n++] };
            }, e: function e2(r2) {
              throw r2;
            }, f: F };
          }
          throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
        }
        var o, a = true, u = false;
        return { s: function s() {
          t = t.call(r);
        }, n: function n() {
          var r2 = t.next();
          return a = r2.done, r2;
        }, e: function e2(r2) {
          u = true, o = r2;
        }, f: function f() {
          try {
            a || null == t["return"] || t["return"]();
          } finally {
            if (u) throw o;
          }
        } };
      }
      function _unsupportedIterableToArray(r, a) {
        if (r) {
          if ("string" == typeof r) return _arrayLikeToArray(r, a);
          var t = {}.toString.call(r).slice(8, -1);
          return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
        }
      }
      function _arrayLikeToArray(r, a) {
        (null == a || a > r.length) && (a = r.length);
        for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
        return n;
      }
      var support = require_support();
      var utils = require_utils();
      var _crc = require_crc32();
      var signature = require_signature();
      var defaults = require_defaults();
      var base64 = require_base64();
      var compressions = require_compressions();
      var CompressedObject = require_compressedObject();
      var nodeBuffer = require_nodeBuffer();
      var utf8 = require_utf8();
      var StringWriter = require_stringWriter();
      var Uint8ArrayWriter = require_uint8ArrayWriter();
      function getRawData(file) {
        if (file._data instanceof CompressedObject) {
          file._data = file._data.getContent();
          file.options.binary = true;
          file.options.base64 = false;
          if (utils.getTypeOf(file._data) === "uint8array") {
            var copy = file._data;
            file._data = new Uint8Array(copy.length);
            if (copy.length !== 0) {
              file._data.set(copy, 0);
            }
          }
        }
        return file._data;
      }
      function getBinaryData(file) {
        var result = getRawData(file), type = utils.getTypeOf(result);
        if (type === "string") {
          if (!file.options.binary) {
            if (support.nodebuffer) {
              return nodeBuffer(result, "utf-8");
            }
          }
          return file.asBinary();
        }
        return result;
      }
      var out = {
        /**
         * Read an existing zip and merge the data in the current PizZip object.
         * The implementation is in pizzip-load.js, don't forget to include it.
         * @param {String|ArrayBuffer|Uint8Array|Buffer} stream  The stream to load
         * @param {Object} options Options for loading the stream.
         *  options.base64 : is the stream in base64 ? default : false
         * @return {PizZip} the current PizZip object
         */
        load: function load() {
          throw new Error("Load method is not defined. Is the file pizzip-load.js included ?");
        },
        /**
         * Filter nested files/folders with the specified function.
         * @param {Function} search the predicate to use :
         * function (relativePath, file) {...}
         * It takes 2 arguments : the relative path and the file.
         * @return {Array} An array of matching elements.
         */
        filter: function filter(search) {
          var result = [];
          var filename, relativePath, file, fileClone;
          for (filename in this.files) {
            if (!this.files.hasOwnProperty(filename)) {
              continue;
            }
            file = this.files[filename];
            fileClone = new ZipObject(file.name, file._data, utils.extend(file.options));
            relativePath = filename.slice(this.root.length, filename.length);
            if (filename.slice(0, this.root.length) === this.root && // the file is in the current root
            search(relativePath, fileClone)) {
              result.push(fileClone);
            }
          }
          return result;
        },
        /**
         * Add a file to the zip file, or search a file.
         * @param   {string|RegExp} name The name of the file to add (if data is defined),
         * the name of the file to find (if no data) or a regex to match files.
         * @param   {String|ArrayBuffer|Uint8Array|Buffer} data  The file data, either raw or base64 encoded
         * @param   {Object} o     File options
         * @return  {PizZip|Object|Array} this PizZip object (when adding a file),
         * a file (when searching by string) or an array of files (when searching by regex).
         */
        file: function file(name, data, o) {
          if (arguments.length === 1) {
            if (utils.isRegExp(name)) {
              var regexp = name;
              return this.filter(function(relativePath, file2) {
                return !file2.dir && regexp.test(relativePath);
              });
            }
            return this.filter(function(relativePath, file2) {
              return !file2.dir && relativePath === name;
            })[0] || null;
          }
          name = this.root + name;
          fileAdd.call(this, name, data, o);
          return this;
        },
        /**
         * Add a directory to the zip file, or search.
         * @param   {String|RegExp} arg The name of the directory to add, or a regex to search folders.
         * @return  {PizZip} an object with the new directory as the root, or an array containing matching folders.
         */
        folder: function folder(arg) {
          if (!arg) {
            return this;
          }
          if (utils.isRegExp(arg)) {
            return this.filter(function(relativePath, file) {
              return file.dir && arg.test(relativePath);
            });
          }
          var name = this.root + arg;
          var newFolder = folderAdd.call(this, name);
          var ret = this.shallowClone();
          ret.root = newFolder.name;
          return ret;
        },
        /**
         * Delete a file, or a directory and all sub-files, from the zip
         * @param {string} name the name of the file to delete
         * @return {PizZip} this PizZip object
         */
        remove: function remove(name) {
          name = this.root + name;
          var file = this.files[name];
          if (!file) {
            if (name.slice(-1) !== "/") {
              name += "/";
            }
            file = this.files[name];
          }
          if (file && !file.dir) {
            delete this.files[name];
          } else {
            var kids = this.filter(function(relativePath, file2) {
              return file2.name.slice(0, name.length) === name;
            });
            for (var i = 0; i < kids.length; i++) {
              delete this.files[kids[i].name];
            }
          }
          return this;
        },
        /**
         * Generate the complete zip file
         * @param {Object} options the options to generate the zip file :
         * - base64, (deprecated, use type instead) true to generate base64.
         * - compression, "STORE" by default.
         * - type, "base64" by default. Values are : string, base64, uint8array, arraybuffer, blob.
         * @return {String|Uint8Array|ArrayBuffer|Buffer|Blob} the zip file
         */
        generate: function generate(options) {
          options = utils.extend(options || {}, {
            base64: true,
            compression: "STORE",
            compressionOptions: null,
            type: "base64",
            platform: "DOS",
            comment: null,
            mimeType: "application/zip",
            encodeFileName: utf8.utf8encode
          });
          utils.checkSupport(options.type);
          if (options.platform === "darwin" || options.platform === "freebsd" || options.platform === "linux" || options.platform === "sunos") {
            options.platform = "UNIX";
          }
          if (options.platform === "win32") {
            options.platform = "DOS";
          }
          var zipData = [], encodedComment = utils.transformTo("string", options.encodeFileName(options.comment || this.comment || ""));
          var localDirLength = 0, centralDirLength = 0, writer, i;
          var fileNames = [];
          if (options.fileOrder instanceof Array) {
            fileNames = options.fileOrder;
          }
          for (var name in this.files) {
            if (fileNames.indexOf(name) === -1) {
              fileNames.push(name);
            }
          }
          if (typeof options.fileOrder === "function") {
            fileNames = options.fileOrder(this.files);
          }
          var _iterator = _createForOfIteratorHelper(fileNames), _step;
          try {
            for (_iterator.s(); !(_step = _iterator.n()).done; ) {
              var _name = _step.value;
              if (!this.files.hasOwnProperty(_name)) {
                continue;
              }
              var file = this.files[_name];
              var compressionName = file.options.compression || options.compression.toUpperCase();
              var compression = compressions[compressionName];
              if (!compression) {
                throw new Error(compressionName + " is not a valid compression method !");
              }
              var compressionOptions = file.options.compressionOptions || options.compressionOptions || {};
              var compressedObject = generateCompressedObjectFrom.call(this, file, compression, compressionOptions);
              var zipPart = generateZipParts.call(this, _name, file, compressedObject, localDirLength, options.platform, options.encodeFileName);
              localDirLength += zipPart.fileRecord.length + compressedObject.compressedSize;
              centralDirLength += zipPart.dirRecord.length;
              zipData.push(zipPart);
            }
          } catch (err) {
            _iterator.e(err);
          } finally {
            _iterator.f();
          }
          var dirEnd = "";
          dirEnd = signature.CENTRAL_DIRECTORY_END + // number of this disk
          "\0\0\0\0" + // total number of entries in the central directory on this disk
          decToHex(zipData.length, 2) + // total number of entries in the central directory
          decToHex(zipData.length, 2) + // size of the central directory   4 bytes
          decToHex(centralDirLength, 4) + // offset of start of central directory with respect to the starting disk number
          decToHex(localDirLength, 4) + // .ZIP file comment length
          decToHex(encodedComment.length, 2) + // .ZIP file comment
          encodedComment;
          var typeName = options.type.toLowerCase();
          if (typeName === "uint8array" || typeName === "arraybuffer" || typeName === "blob" || typeName === "nodebuffer") {
            writer = new Uint8ArrayWriter(localDirLength + centralDirLength + dirEnd.length);
          } else {
            writer = new StringWriter(localDirLength + centralDirLength + dirEnd.length);
          }
          for (i = 0; i < zipData.length; i++) {
            writer.append(zipData[i].fileRecord);
            writer.append(zipData[i].compressedObject.compressedContent);
          }
          for (i = 0; i < zipData.length; i++) {
            writer.append(zipData[i].dirRecord);
          }
          writer.append(dirEnd);
          var zip = writer.finalize();
          switch (options.type.toLowerCase()) {
            // case "zip is an Uint8Array"
            case "uint8array":
            case "arraybuffer":
            case "nodebuffer":
              return utils.transformTo(options.type.toLowerCase(), zip);
            case "blob":
              return utils.arrayBuffer2Blob(utils.transformTo("arraybuffer", zip), options.mimeType);
            // case "zip is a string"
            case "base64":
              return options.base64 ? base64.encode(zip) : zip;
            default:
              return zip;
          }
        },
        /**
         * @deprecated
         * This method will be removed in a future version without replacement.
         */
        crc32: function crc32(input, crc) {
          return _crc(input, crc);
        },
        /**
         * @deprecated
         * This method will be removed in a future version without replacement.
         */
        utf8encode: function utf8encode(string) {
          return utils.transformTo("string", utf8.utf8encode(string));
        },
        /**
         * @deprecated
         * This method will be removed in a future version without replacement.
         */
        utf8decode: function utf8decode(input) {
          return utf8.utf8decode(input);
        }
      };
      function dataToString(asUTF8) {
        var result = getRawData(this);
        if (result === null || typeof result === "undefined") {
          return "";
        }
        if (this.options.base64) {
          result = base64.decode(result);
        }
        if (asUTF8 && this.options.binary) {
          result = out.utf8decode(result);
        } else {
          result = utils.transformTo("string", result);
        }
        if (!asUTF8 && !this.options.binary) {
          result = utils.transformTo("string", out.utf8encode(result));
        }
        return result;
      }
      function ZipObject(name, data, options) {
        this.name = name;
        this.dir = options.dir;
        this.date = options.date;
        this.comment = options.comment;
        this.unixPermissions = options.unixPermissions;
        this.dosPermissions = options.dosPermissions;
        this._data = data;
        this.options = options;
        this._initialMetadata = {
          dir: options.dir,
          date: options.date
        };
      }
      ZipObject.prototype = {
        /**
         * Return the content as UTF8 string.
         * @return {string} the UTF8 string.
         */
        asText: function asText() {
          return dataToString.call(this, true);
        },
        /**
         * Returns the binary content.
         * @return {string} the content as binary.
         */
        asBinary: function asBinary() {
          return dataToString.call(this, false);
        },
        /**
         * Returns the content as a nodejs Buffer.
         * @return {Buffer} the content as a Buffer.
         */
        asNodeBuffer: function asNodeBuffer() {
          var result = getBinaryData(this);
          return utils.transformTo("nodebuffer", result);
        },
        /**
         * Returns the content as an Uint8Array.
         * @return {Uint8Array} the content as an Uint8Array.
         */
        asUint8Array: function asUint8Array() {
          var result = getBinaryData(this);
          return utils.transformTo("uint8array", result);
        },
        /**
         * Returns the content as an ArrayBuffer.
         * @return {ArrayBuffer} the content as an ArrayBufer.
         */
        asArrayBuffer: function asArrayBuffer() {
          return this.asUint8Array().buffer;
        }
      };
      function decToHex(dec, bytes) {
        var hex = "", i;
        for (i = 0; i < bytes; i++) {
          hex += String.fromCharCode(dec & 255);
          dec >>>= 8;
        }
        return hex;
      }
      function prepareFileAttrs(o) {
        o = o || {};
        if (o.base64 === true && (o.binary === null || o.binary === void 0)) {
          o.binary = true;
        }
        o = utils.extend(o, defaults);
        o.date = o.date || /* @__PURE__ */ new Date();
        if (o.compression !== null) {
          o.compression = o.compression.toUpperCase();
        }
        return o;
      }
      function fileAdd(name, data, o) {
        var dataType = utils.getTypeOf(data), parent;
        o = prepareFileAttrs(o);
        if (typeof o.unixPermissions === "string") {
          o.unixPermissions = parseInt(o.unixPermissions, 8);
        }
        if (o.unixPermissions && o.unixPermissions & 16384) {
          o.dir = true;
        }
        if (o.dosPermissions && o.dosPermissions & 16) {
          o.dir = true;
        }
        if (o.dir) {
          name = forceTrailingSlash(name);
        }
        if (o.createFolders && (parent = parentFolder(name))) {
          folderAdd.call(this, parent, true);
        }
        if (o.dir || data === null || typeof data === "undefined") {
          o.base64 = false;
          o.binary = false;
          data = null;
          dataType = null;
        } else if (dataType === "string") {
          if (o.binary && !o.base64) {
            if (o.optimizedBinaryString !== true) {
              data = utils.string2binary(data);
            }
          }
        } else {
          o.base64 = false;
          o.binary = true;
          if (!dataType && !(data instanceof CompressedObject)) {
            throw new Error("The data of '" + name + "' is in an unsupported format !");
          }
          if (dataType === "arraybuffer") {
            data = utils.transformTo("uint8array", data);
          }
        }
        var object = new ZipObject(name, data, o);
        this.files[name] = object;
        return object;
      }
      function parentFolder(path) {
        if (path.slice(-1) === "/") {
          path = path.substring(0, path.length - 1);
        }
        var lastSlash = path.lastIndexOf("/");
        return lastSlash > 0 ? path.substring(0, lastSlash) : "";
      }
      function forceTrailingSlash(path) {
        if (path.slice(-1) !== "/") {
          path += "/";
        }
        return path;
      }
      function folderAdd(name, createFolders) {
        createFolders = typeof createFolders !== "undefined" ? createFolders : false;
        name = forceTrailingSlash(name);
        if (!this.files[name]) {
          fileAdd.call(this, name, null, {
            dir: true,
            createFolders
          });
        }
        return this.files[name];
      }
      function generateCompressedObjectFrom(file, compression, compressionOptions) {
        var result = new CompressedObject();
        var content;
        if (file._data instanceof CompressedObject) {
          result.uncompressedSize = file._data.uncompressedSize;
          result.crc32 = file._data.crc32;
          if (result.uncompressedSize === 0 || file.dir) {
            compression = compressions.STORE;
            result.compressedContent = "";
            result.crc32 = 0;
          } else if (file._data.compressionMethod === compression.magic) {
            result.compressedContent = file._data.getCompressedContent();
          } else {
            content = file._data.getContent();
            result.compressedContent = compression.compress(utils.transformTo(compression.compressInputType, content), compressionOptions);
          }
        } else {
          content = getBinaryData(file);
          if (!content || content.length === 0 || file.dir) {
            compression = compressions.STORE;
            content = "";
          }
          result.uncompressedSize = content.length;
          result.crc32 = _crc(content);
          result.compressedContent = compression.compress(utils.transformTo(compression.compressInputType, content), compressionOptions);
        }
        result.compressedSize = result.compressedContent.length;
        result.compressionMethod = compression.magic;
        return result;
      }
      function generateUnixExternalFileAttr(unixPermissions, isDir) {
        var result = unixPermissions;
        if (!unixPermissions) {
          result = isDir ? 16893 : 33204;
        }
        return (result & 65535) << 16;
      }
      function generateDosExternalFileAttr(dosPermissions) {
        return (dosPermissions || 0) & 63;
      }
      function generateZipParts(name, file, compressedObject, offset, platform, encodeFileName) {
        var useCustomEncoding = encodeFileName !== utf8.utf8encode, encodedFileName = utils.transformTo("string", encodeFileName(file.name)), utfEncodedFileName = utils.transformTo("string", utf8.utf8encode(file.name)), comment = file.comment || "", encodedComment = utils.transformTo("string", encodeFileName(comment)), utfEncodedComment = utils.transformTo("string", utf8.utf8encode(comment)), useUTF8ForFileName = utfEncodedFileName.length !== file.name.length, useUTF8ForComment = utfEncodedComment.length !== comment.length, o = file.options;
        var dosTime, dosDate, extraFields = "", unicodePathExtraField = "", unicodeCommentExtraField = "", dir, date;
        if (file._initialMetadata.dir !== file.dir) {
          dir = file.dir;
        } else {
          dir = o.dir;
        }
        if (file._initialMetadata.date !== file.date) {
          date = file.date;
        } else {
          date = o.date;
        }
        var extFileAttr = 0;
        var versionMadeBy = 0;
        if (dir) {
          extFileAttr |= 16;
        }
        if (platform === "UNIX") {
          versionMadeBy = 798;
          extFileAttr |= generateUnixExternalFileAttr(file.unixPermissions, dir);
        } else {
          versionMadeBy = 20;
          extFileAttr |= generateDosExternalFileAttr(file.dosPermissions, dir);
        }
        dosTime = date.getHours();
        dosTime <<= 6;
        dosTime |= date.getMinutes();
        dosTime <<= 5;
        dosTime |= date.getSeconds() / 2;
        dosDate = date.getFullYear() - 1980;
        dosDate <<= 4;
        dosDate |= date.getMonth() + 1;
        dosDate <<= 5;
        dosDate |= date.getDate();
        if (useUTF8ForFileName) {
          unicodePathExtraField = // Version
          decToHex(1, 1) + // NameCRC32
          decToHex(_crc(encodedFileName), 4) + // UnicodeName
          utfEncodedFileName;
          extraFields += // Info-ZIP Unicode Path Extra Field
          "up" + // size
          decToHex(unicodePathExtraField.length, 2) + // content
          unicodePathExtraField;
        }
        if (useUTF8ForComment) {
          unicodeCommentExtraField = // Version
          decToHex(1, 1) + // CommentCRC32
          decToHex(this.crc32(encodedComment), 4) + // UnicodeName
          utfEncodedComment;
          extraFields += // Info-ZIP Unicode Path Extra Field
          "uc" + // size
          decToHex(unicodeCommentExtraField.length, 2) + // content
          unicodeCommentExtraField;
        }
        var header = "";
        header += "\n\0";
        header += !useCustomEncoding && (useUTF8ForFileName || useUTF8ForComment) ? "\0\b" : "\0\0";
        header += compressedObject.compressionMethod;
        header += decToHex(dosTime, 2);
        header += decToHex(dosDate, 2);
        header += decToHex(compressedObject.crc32, 4);
        header += decToHex(compressedObject.compressedSize, 4);
        header += decToHex(compressedObject.uncompressedSize, 4);
        header += decToHex(encodedFileName.length, 2);
        header += decToHex(extraFields.length, 2);
        var fileRecord = signature.LOCAL_FILE_HEADER + header + encodedFileName + extraFields;
        var dirRecord = signature.CENTRAL_FILE_HEADER + // version made by (00: DOS)
        decToHex(versionMadeBy, 2) + // file header (common to file and central directory)
        header + // file comment length
        decToHex(encodedComment.length, 2) + // disk number start
        "\0\0\0\0" + // external file attributes
        decToHex(extFileAttr, 4) + // relative offset of local header
        decToHex(offset, 4) + // file name
        encodedFileName + // extra field
        extraFields + // file comment
        encodedComment;
        return {
          fileRecord,
          dirRecord,
          compressedObject
        };
      }
      module.exports = out;
    }
  });

  // node_modules/pizzip/js/dataReader.js
  var require_dataReader = __commonJS({
    "node_modules/pizzip/js/dataReader.js"(exports, module) {
      "use strict";
      var utils = require_utils();
      function DataReader() {
        this.data = null;
        this.length = 0;
        this.index = 0;
        this.zero = 0;
      }
      DataReader.prototype = {
        /**
         * Check that the offset will not go too far.
         * @param {string} offset the additional offset to check.
         * @throws {Error} an Error if the offset is out of bounds.
         */
        checkOffset: function checkOffset(offset) {
          this.checkIndex(this.index + offset);
        },
        /**
         * Check that the specifed index will not be too far.
         * @param {string} newIndex the index to check.
         * @throws {Error} an Error if the index is out of bounds.
         */
        checkIndex: function checkIndex(newIndex) {
          if (this.length < this.zero + newIndex || newIndex < 0) {
            throw new Error("End of data reached (data length = " + this.length + ", asked index = " + newIndex + "). Corrupted zip ?");
          }
        },
        /**
         * Change the index.
         * @param {number} newIndex The new index.
         * @throws {Error} if the new index is out of the data.
         */
        setIndex: function setIndex(newIndex) {
          this.checkIndex(newIndex);
          this.index = newIndex;
        },
        /**
         * Skip the next n bytes.
         * @param {number} n the number of bytes to skip.
         * @throws {Error} if the new index is out of the data.
         */
        skip: function skip(n) {
          this.setIndex(this.index + n);
        },
        /**
         * Get the byte at the specified index.
         * @param {number} i the index to use.
         * @return {number} a byte.
         */
        byteAt: function byteAt() {
        },
        /**
         * Get the next number with a given byte size.
         * @param {number} size the number of bytes to read.
         * @return {number} the corresponding number.
         */
        readInt: function readInt(size) {
          var result = 0, i;
          this.checkOffset(size);
          for (i = this.index + size - 1; i >= this.index; i--) {
            result = (result << 8) + this.byteAt(i);
          }
          this.index += size;
          return result;
        },
        /**
         * Get the next string with a given byte size.
         * @param {number} size the number of bytes to read.
         * @return {string} the corresponding string.
         */
        readString: function readString(size) {
          return utils.transformTo("string", this.readData(size));
        },
        /**
         * Get raw data without conversion, <size> bytes.
         * @param {number} size the number of bytes to read.
         * @return {Object} the raw data, implementation specific.
         */
        readData: function readData() {
        },
        /**
         * Find the last occurence of a zip signature (4 bytes).
         * @param {string} sig the signature to find.
         * @return {number} the index of the last occurence, -1 if not found.
         */
        lastIndexOfSignature: function lastIndexOfSignature() {
        },
        /**
         * Get the next date.
         * @return {Date} the date.
         */
        readDate: function readDate() {
          var dostime = this.readInt(4);
          return new Date(
            (dostime >> 25 & 127) + 1980,
            // year
            (dostime >> 21 & 15) - 1,
            // month
            dostime >> 16 & 31,
            // day
            dostime >> 11 & 31,
            // hour
            dostime >> 5 & 63,
            // minute
            (dostime & 31) << 1
          );
        }
      };
      module.exports = DataReader;
    }
  });

  // node_modules/pizzip/js/stringReader.js
  var require_stringReader = __commonJS({
    "node_modules/pizzip/js/stringReader.js"(exports, module) {
      "use strict";
      var DataReader = require_dataReader();
      var utils = require_utils();
      function StringReader(data, optimizedBinaryString) {
        this.data = data;
        if (!optimizedBinaryString) {
          this.data = utils.string2binary(this.data);
        }
        this.length = this.data.length;
        this.index = 0;
        this.zero = 0;
      }
      StringReader.prototype = new DataReader();
      StringReader.prototype.byteAt = function(i) {
        return this.data.charCodeAt(this.zero + i);
      };
      StringReader.prototype.lastIndexOfSignature = function(sig) {
        return this.data.lastIndexOf(sig) - this.zero;
      };
      StringReader.prototype.readData = function(size) {
        this.checkOffset(size);
        var result = this.data.slice(this.zero + this.index, this.zero + this.index + size);
        this.index += size;
        return result;
      };
      module.exports = StringReader;
    }
  });

  // node_modules/pizzip/js/arrayReader.js
  var require_arrayReader = __commonJS({
    "node_modules/pizzip/js/arrayReader.js"(exports, module) {
      "use strict";
      var DataReader = require_dataReader();
      function ArrayReader(data) {
        if (data) {
          this.data = data;
          this.length = this.data.length;
          this.index = 0;
          this.zero = 0;
          for (var i = 0; i < this.data.length; i++) {
            data[i] &= data[i];
          }
        }
      }
      ArrayReader.prototype = new DataReader();
      ArrayReader.prototype.byteAt = function(i) {
        return this.data[this.zero + i];
      };
      ArrayReader.prototype.lastIndexOfSignature = function(sig) {
        var sig0 = sig.charCodeAt(0), sig1 = sig.charCodeAt(1), sig2 = sig.charCodeAt(2), sig3 = sig.charCodeAt(3);
        for (var i = this.length - 4; i >= 0; --i) {
          if (this.data[i] === sig0 && this.data[i + 1] === sig1 && this.data[i + 2] === sig2 && this.data[i + 3] === sig3) {
            return i - this.zero;
          }
        }
        return -1;
      };
      ArrayReader.prototype.readData = function(size) {
        this.checkOffset(size);
        if (size === 0) {
          return [];
        }
        var result = this.data.slice(this.zero + this.index, this.zero + this.index + size);
        this.index += size;
        return result;
      };
      module.exports = ArrayReader;
    }
  });

  // node_modules/pizzip/js/uint8ArrayReader.js
  var require_uint8ArrayReader = __commonJS({
    "node_modules/pizzip/js/uint8ArrayReader.js"(exports, module) {
      "use strict";
      var ArrayReader = require_arrayReader();
      function Uint8ArrayReader(data) {
        if (data) {
          this.data = data;
          this.length = this.data.length;
          this.index = 0;
          this.zero = 0;
        }
      }
      Uint8ArrayReader.prototype = new ArrayReader();
      Uint8ArrayReader.prototype.readData = function(size) {
        this.checkOffset(size);
        if (size === 0) {
          return new Uint8Array(0);
        }
        var result = this.data.subarray(this.zero + this.index, this.zero + this.index + size);
        this.index += size;
        return result;
      };
      module.exports = Uint8ArrayReader;
    }
  });

  // node_modules/pizzip/js/nodeBufferReader.js
  var require_nodeBufferReader = __commonJS({
    "node_modules/pizzip/js/nodeBufferReader.js"(exports, module) {
      "use strict";
      var Uint8ArrayReader = require_uint8ArrayReader();
      function NodeBufferReader(data) {
        this.data = data;
        this.length = this.data.length;
        this.index = 0;
        this.zero = 0;
      }
      NodeBufferReader.prototype = new Uint8ArrayReader();
      NodeBufferReader.prototype.readData = function(size) {
        this.checkOffset(size);
        var result = this.data.slice(this.zero + this.index, this.zero + this.index + size);
        this.index += size;
        return result;
      };
      module.exports = NodeBufferReader;
    }
  });

  // node_modules/pizzip/js/zipEntry.js
  var require_zipEntry = __commonJS({
    "node_modules/pizzip/js/zipEntry.js"(exports, module) {
      "use strict";
      var StringReader = require_stringReader();
      var utils = require_utils();
      var CompressedObject = require_compressedObject();
      var pizzipProto = require_object();
      var support = require_support();
      var MADE_BY_DOS = 0;
      var MADE_BY_UNIX = 3;
      function ZipEntry(options, loadOptions) {
        this.options = options;
        this.loadOptions = loadOptions;
      }
      ZipEntry.prototype = {
        /**
         * say if the file is encrypted.
         * @return {boolean} true if the file is encrypted, false otherwise.
         */
        isEncrypted: function isEncrypted() {
          return (this.bitFlag & 1) === 1;
        },
        /**
         * say if the file has utf-8 filename/comment.
         * @return {boolean} true if the filename/comment is in utf-8, false otherwise.
         */
        useUTF8: function useUTF8() {
          return (this.bitFlag & 2048) === 2048;
        },
        /**
         * Prepare the function used to generate the compressed content from this ZipFile.
         * @param {DataReader} reader the reader to use.
         * @param {number} from the offset from where we should read the data.
         * @param {number} length the length of the data to read.
         * @return {Function} the callback to get the compressed content (the type depends of the DataReader class).
         */
        prepareCompressedContent: function prepareCompressedContent(reader, from, length) {
          return function() {
            var previousIndex = reader.index;
            reader.setIndex(from);
            var compressedFileData = reader.readData(length);
            reader.setIndex(previousIndex);
            return compressedFileData;
          };
        },
        /**
         * Prepare the function used to generate the uncompressed content from this ZipFile.
         * @param {DataReader} reader the reader to use.
         * @param {number} from the offset from where we should read the data.
         * @param {number} length the length of the data to read.
         * @param {PizZip.compression} compression the compression used on this file.
         * @param {number} uncompressedSize the uncompressed size to expect.
         * @return {Function} the callback to get the uncompressed content (the type depends of the DataReader class).
         */
        prepareContent: function prepareContent(reader, from, length, compression, uncompressedSize) {
          return function() {
            var compressedFileData = utils.transformTo(compression.uncompressInputType, this.getCompressedContent());
            var uncompressedFileData = compression.uncompress(compressedFileData);
            if (uncompressedFileData.length !== uncompressedSize) {
              throw new Error("Bug : uncompressed data size mismatch");
            }
            return uncompressedFileData;
          };
        },
        /**
         * Read the local part of a zip file and add the info in this object.
         * @param {DataReader} reader the reader to use.
         */
        readLocalPart: function readLocalPart(reader) {
          reader.skip(22);
          this.fileNameLength = reader.readInt(2);
          var localExtraFieldsLength = reader.readInt(2);
          this.fileName = reader.readData(this.fileNameLength);
          reader.skip(localExtraFieldsLength);
          if (this.compressedSize === -1 || this.uncompressedSize === -1) {
            throw new Error("Bug or corrupted zip : didn't get enough informations from the central directory (compressedSize == -1 || uncompressedSize == -1)");
          }
          var compression = utils.findCompression(this.compressionMethod);
          if (compression === null) {
            throw new Error("Corrupted zip : compression " + utils.pretty(this.compressionMethod) + " unknown (inner file : " + utils.transformTo("string", this.fileName) + ")");
          }
          this.decompressed = new CompressedObject();
          this.decompressed.compressedSize = this.compressedSize;
          this.decompressed.uncompressedSize = this.uncompressedSize;
          this.decompressed.crc32 = this.crc32;
          this.decompressed.compressionMethod = this.compressionMethod;
          this.decompressed.getCompressedContent = this.prepareCompressedContent(reader, reader.index, this.compressedSize, compression);
          this.decompressed.getContent = this.prepareContent(reader, reader.index, this.compressedSize, compression, this.uncompressedSize);
          if (this.loadOptions.checkCRC32) {
            this.decompressed = utils.transformTo("string", this.decompressed.getContent());
            if (pizzipProto.crc32(this.decompressed) !== this.crc32) {
              throw new Error("Corrupted zip : CRC32 mismatch");
            }
          }
        },
        /**
         * Read the central part of a zip file and add the info in this object.
         * @param {DataReader} reader the reader to use.
         */
        readCentralPart: function readCentralPart(reader) {
          this.versionMadeBy = reader.readInt(2);
          this.versionNeeded = reader.readInt(2);
          this.bitFlag = reader.readInt(2);
          this.compressionMethod = reader.readString(2);
          this.date = reader.readDate();
          this.crc32 = reader.readInt(4);
          this.compressedSize = reader.readInt(4);
          this.uncompressedSize = reader.readInt(4);
          this.fileNameLength = reader.readInt(2);
          this.extraFieldsLength = reader.readInt(2);
          this.fileCommentLength = reader.readInt(2);
          this.diskNumberStart = reader.readInt(2);
          this.internalFileAttributes = reader.readInt(2);
          this.externalFileAttributes = reader.readInt(4);
          this.localHeaderOffset = reader.readInt(4);
          if (this.isEncrypted()) {
            throw new Error("Encrypted zip are not supported");
          }
          this.fileName = reader.readData(this.fileNameLength);
          this.readExtraFields(reader);
          this.parseZIP64ExtraField(reader);
          this.fileComment = reader.readData(this.fileCommentLength);
        },
        /**
         * Parse the external file attributes and get the unix/dos permissions.
         */
        processAttributes: function processAttributes() {
          this.unixPermissions = null;
          this.dosPermissions = null;
          var madeBy = this.versionMadeBy >> 8;
          this.dir = !!(this.externalFileAttributes & 16);
          if (madeBy === MADE_BY_DOS) {
            this.dosPermissions = this.externalFileAttributes & 63;
          }
          if (madeBy === MADE_BY_UNIX) {
            this.unixPermissions = this.externalFileAttributes >> 16 & 65535;
          }
          if (!this.dir && this.fileNameStr.slice(-1) === "/") {
            this.dir = true;
          }
        },
        /**
         * Parse the ZIP64 extra field and merge the info in the current ZipEntry.
         */
        parseZIP64ExtraField: function parseZIP64ExtraField() {
          if (!this.extraFields[1]) {
            return;
          }
          var extraReader = new StringReader(this.extraFields[1].value);
          if (this.uncompressedSize === utils.MAX_VALUE_32BITS) {
            this.uncompressedSize = extraReader.readInt(8);
          }
          if (this.compressedSize === utils.MAX_VALUE_32BITS) {
            this.compressedSize = extraReader.readInt(8);
          }
          if (this.localHeaderOffset === utils.MAX_VALUE_32BITS) {
            this.localHeaderOffset = extraReader.readInt(8);
          }
          if (this.diskNumberStart === utils.MAX_VALUE_32BITS) {
            this.diskNumberStart = extraReader.readInt(4);
          }
        },
        /**
         * Read the central part of a zip file and add the info in this object.
         * @param {DataReader} reader the reader to use.
         */
        readExtraFields: function readExtraFields(reader) {
          var start = reader.index;
          var extraFieldId, extraFieldLength, extraFieldValue;
          this.extraFields = this.extraFields || {};
          while (reader.index < start + this.extraFieldsLength) {
            extraFieldId = reader.readInt(2);
            extraFieldLength = reader.readInt(2);
            extraFieldValue = reader.readString(extraFieldLength);
            this.extraFields[extraFieldId] = {
              id: extraFieldId,
              length: extraFieldLength,
              value: extraFieldValue
            };
          }
        },
        /**
         * Apply an UTF8 transformation if needed.
         */
        handleUTF8: function handleUTF8() {
          var decodeParamType = support.uint8array ? "uint8array" : "array";
          if (this.useUTF8()) {
            this.fileNameStr = pizzipProto.utf8decode(this.fileName);
            this.fileCommentStr = pizzipProto.utf8decode(this.fileComment);
          } else {
            var upath = this.findExtraFieldUnicodePath();
            if (upath !== null) {
              this.fileNameStr = upath;
            } else {
              var fileNameByteArray = utils.transformTo(decodeParamType, this.fileName);
              this.fileNameStr = this.loadOptions.decodeFileName(fileNameByteArray);
            }
            var ucomment = this.findExtraFieldUnicodeComment();
            if (ucomment !== null) {
              this.fileCommentStr = ucomment;
            } else {
              var commentByteArray = utils.transformTo(decodeParamType, this.fileComment);
              this.fileCommentStr = this.loadOptions.decodeFileName(commentByteArray);
            }
          }
        },
        /**
         * Find the unicode path declared in the extra field, if any.
         * @return {String} the unicode path, null otherwise.
         */
        findExtraFieldUnicodePath: function findExtraFieldUnicodePath() {
          var upathField = this.extraFields[28789];
          if (upathField) {
            var extraReader = new StringReader(upathField.value);
            if (extraReader.readInt(1) !== 1) {
              return null;
            }
            if (pizzipProto.crc32(this.fileName) !== extraReader.readInt(4)) {
              return null;
            }
            return pizzipProto.utf8decode(extraReader.readString(upathField.length - 5));
          }
          return null;
        },
        /**
         * Find the unicode comment declared in the extra field, if any.
         * @return {String} the unicode comment, null otherwise.
         */
        findExtraFieldUnicodeComment: function findExtraFieldUnicodeComment() {
          var ucommentField = this.extraFields[25461];
          if (ucommentField) {
            var extraReader = new StringReader(ucommentField.value);
            if (extraReader.readInt(1) !== 1) {
              return null;
            }
            if (pizzipProto.crc32(this.fileComment) !== extraReader.readInt(4)) {
              return null;
            }
            return pizzipProto.utf8decode(extraReader.readString(ucommentField.length - 5));
          }
          return null;
        }
      };
      module.exports = ZipEntry;
    }
  });

  // node_modules/pizzip/js/zipEntries.js
  var require_zipEntries = __commonJS({
    "node_modules/pizzip/js/zipEntries.js"(exports, module) {
      "use strict";
      var StringReader = require_stringReader();
      var NodeBufferReader = require_nodeBufferReader();
      var Uint8ArrayReader = require_uint8ArrayReader();
      var ArrayReader = require_arrayReader();
      var utils = require_utils();
      var sig = require_signature();
      var ZipEntry = require_zipEntry();
      var support = require_support();
      function ZipEntries(data, loadOptions) {
        this.files = [];
        this.loadOptions = loadOptions;
        if (data) {
          this.load(data);
        }
      }
      ZipEntries.prototype = {
        /**
         * Check that the reader is on the speficied signature.
         * @param {string} expectedSignature the expected signature.
         * @throws {Error} if it is an other signature.
         */
        checkSignature: function checkSignature(expectedSignature) {
          var signature = this.reader.readString(4);
          if (signature !== expectedSignature) {
            throw new Error("Corrupted zip or bug : unexpected signature (" + utils.pretty(signature) + ", expected " + utils.pretty(expectedSignature) + ")");
          }
        },
        /**
         * Check if the given signature is at the given index.
         * @param {number} askedIndex the index to check.
         * @param {string} expectedSignature the signature to expect.
         * @return {boolean} true if the signature is here, false otherwise.
         */
        isSignature: function isSignature(askedIndex, expectedSignature) {
          var currentIndex = this.reader.index;
          this.reader.setIndex(askedIndex);
          var signature = this.reader.readString(4);
          var result = signature === expectedSignature;
          this.reader.setIndex(currentIndex);
          return result;
        },
        /**
         * Read the end of the central directory.
         */
        readBlockEndOfCentral: function readBlockEndOfCentral() {
          this.diskNumber = this.reader.readInt(2);
          this.diskWithCentralDirStart = this.reader.readInt(2);
          this.centralDirRecordsOnThisDisk = this.reader.readInt(2);
          this.centralDirRecords = this.reader.readInt(2);
          this.centralDirSize = this.reader.readInt(4);
          this.centralDirOffset = this.reader.readInt(4);
          this.zipCommentLength = this.reader.readInt(2);
          var zipComment = this.reader.readData(this.zipCommentLength);
          var decodeParamType = support.uint8array ? "uint8array" : "array";
          var decodeContent = utils.transformTo(decodeParamType, zipComment);
          this.zipComment = this.loadOptions.decodeFileName(decodeContent);
        },
        /**
         * Read the end of the Zip 64 central directory.
         * Not merged with the method readEndOfCentral :
         * The end of central can coexist with its Zip64 brother,
         * I don't want to read the wrong number of bytes !
         */
        readBlockZip64EndOfCentral: function readBlockZip64EndOfCentral() {
          this.zip64EndOfCentralSize = this.reader.readInt(8);
          this.versionMadeBy = this.reader.readString(2);
          this.versionNeeded = this.reader.readInt(2);
          this.diskNumber = this.reader.readInt(4);
          this.diskWithCentralDirStart = this.reader.readInt(4);
          this.centralDirRecordsOnThisDisk = this.reader.readInt(8);
          this.centralDirRecords = this.reader.readInt(8);
          this.centralDirSize = this.reader.readInt(8);
          this.centralDirOffset = this.reader.readInt(8);
          this.zip64ExtensibleData = {};
          var extraDataSize = this.zip64EndOfCentralSize - 44;
          var index = 0;
          var extraFieldId, extraFieldLength, extraFieldValue;
          while (index < extraDataSize) {
            extraFieldId = this.reader.readInt(2);
            extraFieldLength = this.reader.readInt(4);
            extraFieldValue = this.reader.readString(extraFieldLength);
            this.zip64ExtensibleData[extraFieldId] = {
              id: extraFieldId,
              length: extraFieldLength,
              value: extraFieldValue
            };
          }
        },
        /**
         * Read the end of the Zip 64 central directory locator.
         */
        readBlockZip64EndOfCentralLocator: function readBlockZip64EndOfCentralLocator() {
          this.diskWithZip64CentralDirStart = this.reader.readInt(4);
          this.relativeOffsetEndOfZip64CentralDir = this.reader.readInt(8);
          this.disksCount = this.reader.readInt(4);
          if (this.disksCount > 1) {
            throw new Error("Multi-volumes zip are not supported");
          }
        },
        /**
         * Read the local files, based on the offset read in the central part.
         */
        readLocalFiles: function readLocalFiles() {
          var i, file;
          for (i = 0; i < this.files.length; i++) {
            file = this.files[i];
            this.reader.setIndex(file.localHeaderOffset);
            this.checkSignature(sig.LOCAL_FILE_HEADER);
            file.readLocalPart(this.reader);
            file.handleUTF8();
            file.processAttributes();
          }
        },
        /**
         * Read the central directory.
         */
        readCentralDir: function readCentralDir() {
          var file;
          this.reader.setIndex(this.centralDirOffset);
          while (this.reader.readString(4) === sig.CENTRAL_FILE_HEADER) {
            file = new ZipEntry({
              zip64: this.zip64
            }, this.loadOptions);
            file.readCentralPart(this.reader);
            this.files.push(file);
          }
          if (this.centralDirRecords !== this.files.length) {
            if (this.centralDirRecords !== 0 && this.files.length === 0) {
              throw new Error("Corrupted zip or bug: expected " + this.centralDirRecords + " records in central dir, got " + this.files.length);
            } else {
            }
          }
        },
        /**
         * Read the end of central directory.
         */
        readEndOfCentral: function readEndOfCentral() {
          var offset = this.reader.lastIndexOfSignature(sig.CENTRAL_DIRECTORY_END);
          if (offset < 0) {
            var isGarbage = !this.isSignature(0, sig.LOCAL_FILE_HEADER);
            if (isGarbage) {
              throw new Error("Can't find end of central directory : is this a zip file ?");
            } else {
              throw new Error("Corrupted zip : can't find end of central directory");
            }
          }
          this.reader.setIndex(offset);
          var endOfCentralDirOffset = offset;
          this.checkSignature(sig.CENTRAL_DIRECTORY_END);
          this.readBlockEndOfCentral();
          if (this.diskNumber === utils.MAX_VALUE_16BITS || this.diskWithCentralDirStart === utils.MAX_VALUE_16BITS || this.centralDirRecordsOnThisDisk === utils.MAX_VALUE_16BITS || this.centralDirRecords === utils.MAX_VALUE_16BITS || this.centralDirSize === utils.MAX_VALUE_32BITS || this.centralDirOffset === utils.MAX_VALUE_32BITS) {
            this.zip64 = true;
            offset = this.reader.lastIndexOfSignature(sig.ZIP64_CENTRAL_DIRECTORY_LOCATOR);
            if (offset < 0) {
              throw new Error("Corrupted zip : can't find the ZIP64 end of central directory locator");
            }
            this.reader.setIndex(offset);
            this.checkSignature(sig.ZIP64_CENTRAL_DIRECTORY_LOCATOR);
            this.readBlockZip64EndOfCentralLocator();
            if (!this.isSignature(this.relativeOffsetEndOfZip64CentralDir, sig.ZIP64_CENTRAL_DIRECTORY_END)) {
              this.relativeOffsetEndOfZip64CentralDir = this.reader.lastIndexOfSignature(sig.ZIP64_CENTRAL_DIRECTORY_END);
              if (this.relativeOffsetEndOfZip64CentralDir < 0) {
                throw new Error("Corrupted zip : can't find the ZIP64 end of central directory");
              }
            }
            this.reader.setIndex(this.relativeOffsetEndOfZip64CentralDir);
            this.checkSignature(sig.ZIP64_CENTRAL_DIRECTORY_END);
            this.readBlockZip64EndOfCentral();
          }
          var expectedEndOfCentralDirOffset = this.centralDirOffset + this.centralDirSize;
          if (this.zip64) {
            expectedEndOfCentralDirOffset += 20;
            expectedEndOfCentralDirOffset += 12 + this.zip64EndOfCentralSize;
          }
          var extraBytes = endOfCentralDirOffset - expectedEndOfCentralDirOffset;
          if (extraBytes > 0) {
            if (this.isSignature(endOfCentralDirOffset, sig.CENTRAL_FILE_HEADER)) {
            } else {
              this.reader.zero = extraBytes;
            }
          } else if (extraBytes < 0) {
            throw new Error("Corrupted zip: missing " + Math.abs(extraBytes) + " bytes.");
          }
        },
        prepareReader: function prepareReader(data) {
          var type = utils.getTypeOf(data);
          utils.checkSupport(type);
          if (type === "string" && !support.uint8array) {
            this.reader = new StringReader(data, this.loadOptions.optimizedBinaryString);
          } else if (type === "nodebuffer") {
            this.reader = new NodeBufferReader(data);
          } else if (support.uint8array) {
            this.reader = new Uint8ArrayReader(utils.transformTo("uint8array", data));
          } else if (support.array) {
            this.reader = new ArrayReader(utils.transformTo("array", data));
          } else {
            throw new Error("Unexpected error: unsupported type '" + type + "'");
          }
        },
        /**
         * Read a zip file and create ZipEntries.
         * @param {String|ArrayBuffer|Uint8Array|Buffer} data the binary string representing a zip file.
         */
        load: function load(data) {
          this.prepareReader(data);
          this.readEndOfCentral();
          this.readCentralDir();
          this.readLocalFiles();
        }
      };
      module.exports = ZipEntries;
    }
  });

  // node_modules/pizzip/js/load.js
  var require_load = __commonJS({
    "node_modules/pizzip/js/load.js"(exports, module) {
      "use strict";
      var base64 = require_base64();
      var utf8 = require_utf8();
      var utils = require_utils();
      var ZipEntries = require_zipEntries();
      module.exports = function(data, options) {
        var i, input;
        options = utils.extend(options || {}, {
          base64: false,
          checkCRC32: false,
          optimizedBinaryString: false,
          createFolders: false,
          decodeFileName: utf8.utf8decode
        });
        if (options.base64) {
          data = base64.decode(data);
        }
        var zipEntries = new ZipEntries(data, options);
        var files = zipEntries.files;
        for (i = 0; i < files.length; i++) {
          input = files[i];
          this.file(input.fileNameStr, input.decompressed, {
            binary: true,
            optimizedBinaryString: true,
            date: input.date,
            dir: input.dir,
            comment: input.fileCommentStr.length ? input.fileCommentStr : null,
            unixPermissions: input.unixPermissions,
            dosPermissions: input.dosPermissions,
            createFolders: options.createFolders
          });
        }
        if (zipEntries.zipComment.length) {
          this.comment = zipEntries.zipComment;
        }
        return this;
      };
    }
  });

  // node_modules/pizzip/js/deprecatedPublicUtils.js
  var require_deprecatedPublicUtils = __commonJS({
    "node_modules/pizzip/js/deprecatedPublicUtils.js"(exports) {
      "use strict";
      var utils = require_utils();
      exports.string2binary = function(str) {
        return utils.string2binary(str);
      };
      exports.string2Uint8Array = function(str) {
        return utils.transformTo("uint8array", str);
      };
      exports.uint8Array2String = function(array) {
        return utils.transformTo("string", array);
      };
      exports.string2Blob = function(str) {
        var buffer = utils.transformTo("arraybuffer", str);
        return utils.arrayBuffer2Blob(buffer);
      };
      exports.arrayBuffer2Blob = function(buffer) {
        return utils.arrayBuffer2Blob(buffer);
      };
      exports.transformTo = function(outputType, input) {
        return utils.transformTo(outputType, input);
      };
      exports.getTypeOf = function(input) {
        return utils.getTypeOf(input);
      };
      exports.checkSupport = function(type) {
        return utils.checkSupport(type);
      };
      exports.MAX_VALUE_16BITS = utils.MAX_VALUE_16BITS;
      exports.MAX_VALUE_32BITS = utils.MAX_VALUE_32BITS;
      exports.pretty = function(str) {
        return utils.pretty(str);
      };
      exports.findCompression = function(compressionMethod) {
        return utils.findCompression(compressionMethod);
      };
      exports.isRegExp = function(object) {
        return utils.isRegExp(object);
      };
    }
  });

  // node_modules/pizzip/js/index.js
  var require_js = __commonJS({
    "node_modules/pizzip/js/index.js"(exports, module) {
      "use strict";
      var base64 = require_base64();
      function PizZip(data, options) {
        if (!(this instanceof PizZip)) {
          return new PizZip(data, options);
        }
        this.files = {};
        this.comment = null;
        this.root = "";
        if (data) {
          this.load(data, options);
        }
        this.clone = function() {
          var _this = this;
          var newObj = new PizZip();
          Object.keys(this.files).forEach(function(file) {
            newObj.file(file, _this.files[file].asUint8Array());
          });
          return newObj;
        };
        this.shallowClone = function() {
          var newObj = new PizZip();
          for (var i in this) {
            if (typeof this[i] !== "function") {
              newObj[i] = this[i];
            }
          }
          return newObj;
        };
      }
      PizZip.prototype = require_object();
      PizZip.prototype.load = require_load();
      PizZip.support = require_support();
      PizZip.defaults = require_defaults();
      PizZip.utils = require_deprecatedPublicUtils();
      PizZip.base64 = {
        /**
         * @deprecated
         * This method will be removed in a future version without replacement.
         */
        encode: function encode(input) {
          return base64.encode(input);
        },
        /**
         * @deprecated
         * This method will be removed in a future version without replacement.
         */
        decode: function decode(input) {
          return base64.decode(input);
        }
      };
      PizZip.compressions = require_compressions();
      module.exports = PizZip;
      module.exports["default"] = PizZip;
    }
  });

  // node_modules/@xmldom/xmldom/lib/conventions.js
  var require_conventions = __commonJS({
    "node_modules/@xmldom/xmldom/lib/conventions.js"(exports) {
      "use strict";
      function find(list, predicate, ac) {
        if (ac === void 0) {
          ac = Array.prototype;
        }
        if (list && typeof ac.find === "function") {
          return ac.find.call(list, predicate);
        }
        for (var i = 0; i < list.length; i++) {
          if (hasOwn(list, i)) {
            var item = list[i];
            if (predicate.call(void 0, item, i, list)) {
              return item;
            }
          }
        }
      }
      function freeze(object, oc) {
        if (oc === void 0) {
          oc = Object;
        }
        if (oc && typeof oc.getOwnPropertyDescriptors === "function") {
          object = oc.create(null, oc.getOwnPropertyDescriptors(object));
        }
        return oc && typeof oc.freeze === "function" ? oc.freeze(object) : object;
      }
      function hasOwn(object, key) {
        return Object.prototype.hasOwnProperty.call(object, key);
      }
      function assign(target, source) {
        if (target === null || typeof target !== "object") {
          throw new TypeError("target is not an object");
        }
        for (var key in source) {
          if (hasOwn(source, key)) {
            target[key] = source[key];
          }
        }
        return target;
      }
      var HTML_BOOLEAN_ATTRIBUTES = freeze({
        allowfullscreen: true,
        async: true,
        autofocus: true,
        autoplay: true,
        checked: true,
        controls: true,
        default: true,
        defer: true,
        disabled: true,
        formnovalidate: true,
        hidden: true,
        ismap: true,
        itemscope: true,
        loop: true,
        multiple: true,
        muted: true,
        nomodule: true,
        novalidate: true,
        open: true,
        playsinline: true,
        readonly: true,
        required: true,
        reversed: true,
        selected: true
      });
      function isHTMLBooleanAttribute(name) {
        return hasOwn(HTML_BOOLEAN_ATTRIBUTES, name.toLowerCase());
      }
      var HTML_VOID_ELEMENTS = freeze({
        area: true,
        base: true,
        br: true,
        col: true,
        embed: true,
        hr: true,
        img: true,
        input: true,
        link: true,
        meta: true,
        param: true,
        source: true,
        track: true,
        wbr: true
      });
      function isHTMLVoidElement(tagName) {
        return hasOwn(HTML_VOID_ELEMENTS, tagName.toLowerCase());
      }
      var HTML_RAW_TEXT_ELEMENTS = freeze({
        script: false,
        style: false,
        textarea: true,
        title: true
      });
      function isHTMLRawTextElement(tagName) {
        var key = tagName.toLowerCase();
        return hasOwn(HTML_RAW_TEXT_ELEMENTS, key) && !HTML_RAW_TEXT_ELEMENTS[key];
      }
      function isHTMLEscapableRawTextElement(tagName) {
        var key = tagName.toLowerCase();
        return hasOwn(HTML_RAW_TEXT_ELEMENTS, key) && HTML_RAW_TEXT_ELEMENTS[key];
      }
      function isHTMLMimeType(mimeType) {
        return mimeType === MIME_TYPE.HTML;
      }
      function hasDefaultHTMLNamespace(mimeType) {
        return isHTMLMimeType(mimeType) || mimeType === MIME_TYPE.XML_XHTML_APPLICATION;
      }
      var MIME_TYPE = freeze({
        /**
         * `text/html`, the only mime type that triggers treating an XML document as HTML.
         *
         * @see https://www.iana.org/assignments/media-types/text/html IANA MimeType registration
         * @see https://en.wikipedia.org/wiki/HTML Wikipedia
         * @see https://developer.mozilla.org/en-US/docs/Web/API/DOMParser/parseFromString MDN
         * @see https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html#dom-domparser-parsefromstring
         *      WHATWG HTML Spec
         */
        HTML: "text/html",
        /**
         * `application/xml`, the standard mime type for XML documents.
         *
         * @see https://www.iana.org/assignments/media-types/application/xml IANA MimeType
         *      registration
         * @see https://tools.ietf.org/html/rfc7303#section-9.1 RFC 7303
         * @see https://en.wikipedia.org/wiki/XML_and_MIME Wikipedia
         */
        XML_APPLICATION: "application/xml",
        /**
         * `text/xml`, an alias for `application/xml`.
         *
         * @see https://tools.ietf.org/html/rfc7303#section-9.2 RFC 7303
         * @see https://www.iana.org/assignments/media-types/text/xml IANA MimeType registration
         * @see https://en.wikipedia.org/wiki/XML_and_MIME Wikipedia
         */
        XML_TEXT: "text/xml",
        /**
         * `application/xhtml+xml`, indicates an XML document that has the default HTML namespace,
         * but is parsed as an XML document.
         *
         * @see https://www.iana.org/assignments/media-types/application/xhtml+xml IANA MimeType
         *      registration
         * @see https://dom.spec.whatwg.org/#dom-domimplementation-createdocument WHATWG DOM Spec
         * @see https://en.wikipedia.org/wiki/XHTML Wikipedia
         */
        XML_XHTML_APPLICATION: "application/xhtml+xml",
        /**
         * `image/svg+xml`,
         *
         * @see https://www.iana.org/assignments/media-types/image/svg+xml IANA MimeType registration
         * @see https://www.w3.org/TR/SVG11/ W3C SVG 1.1
         * @see https://en.wikipedia.org/wiki/Scalable_Vector_Graphics Wikipedia
         */
        XML_SVG_IMAGE: "image/svg+xml"
      });
      var _MIME_TYPES = Object.keys(MIME_TYPE).map(function(key) {
        return MIME_TYPE[key];
      });
      function isValidMimeType(mimeType) {
        return _MIME_TYPES.indexOf(mimeType) > -1;
      }
      var NAMESPACE = freeze({
        /**
         * The XHTML namespace.
         *
         * @see http://www.w3.org/1999/xhtml
         */
        HTML: "http://www.w3.org/1999/xhtml",
        /**
         * The SVG namespace.
         *
         * @see http://www.w3.org/2000/svg
         */
        SVG: "http://www.w3.org/2000/svg",
        /**
         * The `xml:` namespace.
         *
         * @see http://www.w3.org/XML/1998/namespace
         */
        XML: "http://www.w3.org/XML/1998/namespace",
        /**
         * The `xmlns:` namespace.
         *
         * @see https://www.w3.org/2000/xmlns/
         */
        XMLNS: "http://www.w3.org/2000/xmlns/"
      });
      exports.assign = assign;
      exports.find = find;
      exports.freeze = freeze;
      exports.HTML_BOOLEAN_ATTRIBUTES = HTML_BOOLEAN_ATTRIBUTES;
      exports.HTML_RAW_TEXT_ELEMENTS = HTML_RAW_TEXT_ELEMENTS;
      exports.HTML_VOID_ELEMENTS = HTML_VOID_ELEMENTS;
      exports.hasDefaultHTMLNamespace = hasDefaultHTMLNamespace;
      exports.hasOwn = hasOwn;
      exports.isHTMLBooleanAttribute = isHTMLBooleanAttribute;
      exports.isHTMLRawTextElement = isHTMLRawTextElement;
      exports.isHTMLEscapableRawTextElement = isHTMLEscapableRawTextElement;
      exports.isHTMLMimeType = isHTMLMimeType;
      exports.isHTMLVoidElement = isHTMLVoidElement;
      exports.isValidMimeType = isValidMimeType;
      exports.MIME_TYPE = MIME_TYPE;
      exports.NAMESPACE = NAMESPACE;
    }
  });

  // node_modules/@xmldom/xmldom/lib/errors.js
  var require_errors = __commonJS({
    "node_modules/@xmldom/xmldom/lib/errors.js"(exports) {
      "use strict";
      var conventions = require_conventions();
      function extendError(constructor, writableName) {
        constructor.prototype = Object.create(Error.prototype, {
          constructor: { value: constructor },
          name: { value: constructor.name, enumerable: true, writable: writableName }
        });
      }
      var DOMExceptionName = conventions.freeze({
        /**
         * the default value as defined by the spec
         */
        Error: "Error",
        /**
         * @deprecated
         * Use RangeError instead.
         */
        IndexSizeError: "IndexSizeError",
        /**
         * @deprecated
         * Just to match the related static code, not part of the spec.
         */
        DomstringSizeError: "DomstringSizeError",
        HierarchyRequestError: "HierarchyRequestError",
        WrongDocumentError: "WrongDocumentError",
        InvalidCharacterError: "InvalidCharacterError",
        /**
         * @deprecated
         * Just to match the related static code, not part of the spec.
         */
        NoDataAllowedError: "NoDataAllowedError",
        NoModificationAllowedError: "NoModificationAllowedError",
        NotFoundError: "NotFoundError",
        NotSupportedError: "NotSupportedError",
        InUseAttributeError: "InUseAttributeError",
        InvalidStateError: "InvalidStateError",
        SyntaxError: "SyntaxError",
        InvalidModificationError: "InvalidModificationError",
        NamespaceError: "NamespaceError",
        /**
         * @deprecated
         * Use TypeError for invalid arguments,
         * "NotSupportedError" DOMException for unsupported operations,
         * and "NotAllowedError" DOMException for denied requests instead.
         */
        InvalidAccessError: "InvalidAccessError",
        /**
         * @deprecated
         * Just to match the related static code, not part of the spec.
         */
        ValidationError: "ValidationError",
        /**
         * @deprecated
         * Use TypeError instead.
         */
        TypeMismatchError: "TypeMismatchError",
        SecurityError: "SecurityError",
        NetworkError: "NetworkError",
        AbortError: "AbortError",
        /**
         * @deprecated
         * Just to match the related static code, not part of the spec.
         */
        URLMismatchError: "URLMismatchError",
        QuotaExceededError: "QuotaExceededError",
        TimeoutError: "TimeoutError",
        InvalidNodeTypeError: "InvalidNodeTypeError",
        DataCloneError: "DataCloneError",
        EncodingError: "EncodingError",
        NotReadableError: "NotReadableError",
        UnknownError: "UnknownError",
        ConstraintError: "ConstraintError",
        DataError: "DataError",
        TransactionInactiveError: "TransactionInactiveError",
        ReadOnlyError: "ReadOnlyError",
        VersionError: "VersionError",
        OperationError: "OperationError",
        NotAllowedError: "NotAllowedError",
        OptOutError: "OptOutError"
      });
      var DOMExceptionNames = Object.keys(DOMExceptionName);
      function isValidDomExceptionCode(value) {
        return typeof value === "number" && value >= 1 && value <= 25;
      }
      function endsWithError(value) {
        return typeof value === "string" && value.substring(value.length - DOMExceptionName.Error.length) === DOMExceptionName.Error;
      }
      function DOMException(messageOrCode, nameOrMessage) {
        if (isValidDomExceptionCode(messageOrCode)) {
          this.name = DOMExceptionNames[messageOrCode];
          this.message = nameOrMessage || "";
        } else {
          this.message = messageOrCode;
          this.name = endsWithError(nameOrMessage) ? nameOrMessage : DOMExceptionName.Error;
        }
        if (Error.captureStackTrace) Error.captureStackTrace(this, DOMException);
      }
      extendError(DOMException, true);
      Object.defineProperties(DOMException.prototype, {
        code: {
          enumerable: true,
          get: function() {
            var code = DOMExceptionNames.indexOf(this.name);
            if (isValidDomExceptionCode(code)) return code;
            return 0;
          }
        }
      });
      var ExceptionCode = {
        INDEX_SIZE_ERR: 1,
        DOMSTRING_SIZE_ERR: 2,
        HIERARCHY_REQUEST_ERR: 3,
        WRONG_DOCUMENT_ERR: 4,
        INVALID_CHARACTER_ERR: 5,
        NO_DATA_ALLOWED_ERR: 6,
        NO_MODIFICATION_ALLOWED_ERR: 7,
        NOT_FOUND_ERR: 8,
        NOT_SUPPORTED_ERR: 9,
        INUSE_ATTRIBUTE_ERR: 10,
        INVALID_STATE_ERR: 11,
        SYNTAX_ERR: 12,
        INVALID_MODIFICATION_ERR: 13,
        NAMESPACE_ERR: 14,
        INVALID_ACCESS_ERR: 15,
        VALIDATION_ERR: 16,
        TYPE_MISMATCH_ERR: 17,
        SECURITY_ERR: 18,
        NETWORK_ERR: 19,
        ABORT_ERR: 20,
        URL_MISMATCH_ERR: 21,
        QUOTA_EXCEEDED_ERR: 22,
        TIMEOUT_ERR: 23,
        INVALID_NODE_TYPE_ERR: 24,
        DATA_CLONE_ERR: 25
      };
      var entries = Object.entries(ExceptionCode);
      for (i = 0; i < entries.length; i++) {
        key = entries[i][0];
        DOMException[key] = entries[i][1];
      }
      var key;
      var i;
      function ParseError(message, locator) {
        this.message = message;
        this.locator = locator;
        if (Error.captureStackTrace) Error.captureStackTrace(this, ParseError);
      }
      extendError(ParseError);
      exports.DOMException = DOMException;
      exports.DOMExceptionName = DOMExceptionName;
      exports.ExceptionCode = ExceptionCode;
      exports.ParseError = ParseError;
    }
  });

  // node_modules/@xmldom/xmldom/lib/grammar.js
  var require_grammar = __commonJS({
    "node_modules/@xmldom/xmldom/lib/grammar.js"(exports) {
      "use strict";
      function detectUnicodeSupport(RegExpImpl) {
        try {
          if (typeof RegExpImpl !== "function") {
            RegExpImpl = RegExp;
          }
          var match = new RegExpImpl("\u{1D306}", "u").exec("\u{1D306}");
          return !!match && match[0].length === 2;
        } catch (error) {
        }
        return false;
      }
      var UNICODE_SUPPORT = detectUnicodeSupport();
      function chars(regexp) {
        if (regexp.source[0] !== "[") {
          throw new Error(regexp + " can not be used with chars");
        }
        return regexp.source.slice(1, regexp.source.lastIndexOf("]"));
      }
      function chars_without(regexp, search) {
        if (regexp.source[0] !== "[") {
          throw new Error("/" + regexp.source + "/ can not be used with chars_without");
        }
        if (!search || typeof search !== "string") {
          throw new Error(JSON.stringify(search) + " is not a valid search");
        }
        if (regexp.source.indexOf(search) === -1) {
          throw new Error('"' + search + '" is not is /' + regexp.source + "/");
        }
        if (search === "-" && regexp.source.indexOf(search) !== 1) {
          throw new Error('"' + search + '" is not at the first postion of /' + regexp.source + "/");
        }
        return new RegExp(regexp.source.replace(search, ""), UNICODE_SUPPORT ? "u" : "");
      }
      function reg(args) {
        var self2 = this;
        return new RegExp(
          Array.prototype.slice.call(arguments).map(function(part) {
            var isStr = typeof part === "string";
            if (isStr && self2 === void 0 && part === "|") {
              throw new Error("use regg instead of reg to wrap expressions with `|`!");
            }
            return isStr ? part : part.source;
          }).join(""),
          UNICODE_SUPPORT ? "mu" : "m"
        );
      }
      function regg(args) {
        if (arguments.length === 0) {
          throw new Error("no parameters provided");
        }
        return reg.apply(regg, ["(?:"].concat(Array.prototype.slice.call(arguments), [")"]));
      }
      var UNICODE_REPLACEMENT_CHARACTER = "\uFFFD";
      var Char = /[-\x09\x0A\x0D\x20-\x2C\x2E-\uD7FF\uE000-\uFFFD]/;
      if (UNICODE_SUPPORT) {
        Char = reg("[", chars(Char), "\\u{10000}-\\u{10FFFF}", "]");
      }
      var _SChar = /[\x20\x09\x0D\x0A]/;
      var SChar_s = chars(_SChar);
      var S = reg(_SChar, "+");
      var S_OPT = reg(_SChar, "*");
      var NameStartChar = /[:_a-zA-Z\xC0-\xD6\xD8-\xF6\xF8-\u02FF\u0370-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/;
      if (UNICODE_SUPPORT) {
        NameStartChar = reg("[", chars(NameStartChar), "\\u{10000}-\\u{10FFFF}", "]");
      }
      var NameStartChar_s = chars(NameStartChar);
      var NameChar = reg("[", NameStartChar_s, chars(/[-.0-9\xB7]/), chars(/[\u0300-\u036F\u203F-\u2040]/), "]");
      var Name = reg(NameStartChar, NameChar, "*");
      var Nmtoken = reg(NameChar, "+");
      var EntityRef = reg("&", Name, ";");
      var CharRef = regg(/&#[0-9]+;|&#x[0-9a-fA-F]+;/);
      var Reference = regg(EntityRef, "|", CharRef);
      var PEReference = reg("%", Name, ";");
      var EntityValue = regg(
        reg('"', regg(/[^%&"]/, "|", PEReference, "|", Reference), "*", '"'),
        "|",
        reg("'", regg(/[^%&']/, "|", PEReference, "|", Reference), "*", "'")
      );
      var AttValue = regg('"', regg(/[^<&"]/, "|", Reference), "*", '"', "|", "'", regg(/[^<&']/, "|", Reference), "*", "'");
      var NCNameStartChar = chars_without(NameStartChar, ":");
      var NCNameChar = chars_without(NameChar, ":");
      var NCName = reg(NCNameStartChar, NCNameChar, "*");
      var QName = reg(NCName, regg(":", NCName), "?");
      var QName_exact = reg("^", QName, "$");
      var QName_group = reg("(", QName, ")");
      var SystemLiteral = regg(/"[^"]*"|'[^']*'/);
      var PI = reg(/^<\?/, "(", Name, ")", regg(S, "(", Char, "*?)"), "?", /\?>/);
      var PubidChar = /[\x20\x0D\x0Aa-zA-Z0-9-'()+,./:=?;!*#@$_%]/;
      var PubidLiteral = regg('"', PubidChar, '*"', "|", "'", chars_without(PubidChar, "'"), "*'");
      var COMMENT_START = "<!--";
      var COMMENT_END = "-->";
      var Comment = reg(COMMENT_START, regg(chars_without(Char, "-"), "|", reg("-", chars_without(Char, "-"))), "*", COMMENT_END);
      var PCDATA = "#PCDATA";
      var Mixed = regg(
        reg(/\(/, S_OPT, PCDATA, regg(S_OPT, /\|/, S_OPT, QName), "*", S_OPT, /\)\*/),
        "|",
        reg(/\(/, S_OPT, PCDATA, S_OPT, /\)/)
      );
      var _children_quantity = /[?*+]?/;
      var children = reg(
        /\([^>]+\)/,
        _children_quantity
        /*regg(choice, '|', seq), _children_quantity*/
      );
      var contentspec = regg("EMPTY", "|", "ANY", "|", Mixed, "|", children);
      var ELEMENTDECL_START = "<!ELEMENT";
      var elementdecl = reg(ELEMENTDECL_START, S, regg(QName, "|", PEReference), S, regg(contentspec, "|", PEReference), S_OPT, ">");
      var NotationType = reg("NOTATION", S, /\(/, S_OPT, Name, regg(S_OPT, /\|/, S_OPT, Name), "*", S_OPT, /\)/);
      var Enumeration = reg(/\(/, S_OPT, Nmtoken, regg(S_OPT, /\|/, S_OPT, Nmtoken), "*", S_OPT, /\)/);
      var EnumeratedType = regg(NotationType, "|", Enumeration);
      var AttType = regg(/CDATA|ID|IDREF|IDREFS|ENTITY|ENTITIES|NMTOKEN|NMTOKENS/, "|", EnumeratedType);
      var DefaultDecl = regg(/#REQUIRED|#IMPLIED/, "|", regg(regg("#FIXED", S), "?", AttValue));
      var AttDef = regg(S, Name, S, AttType, S, DefaultDecl);
      var ATTLIST_DECL_START = "<!ATTLIST";
      var AttlistDecl = reg(ATTLIST_DECL_START, S, Name, AttDef, "*", S_OPT, ">");
      var ABOUT_LEGACY_COMPAT = "about:legacy-compat";
      var ABOUT_LEGACY_COMPAT_SystemLiteral = regg('"' + ABOUT_LEGACY_COMPAT + '"', "|", "'" + ABOUT_LEGACY_COMPAT + "'");
      var SYSTEM = "SYSTEM";
      var PUBLIC = "PUBLIC";
      var ExternalID = regg(regg(SYSTEM, S, SystemLiteral), "|", regg(PUBLIC, S, PubidLiteral, S, SystemLiteral));
      var ExternalID_match = reg(
        "^",
        regg(
          regg(SYSTEM, S, "(?<SystemLiteralOnly>", SystemLiteral, ")"),
          "|",
          regg(PUBLIC, S, "(?<PubidLiteral>", PubidLiteral, ")", S, "(?<SystemLiteral>", SystemLiteral, ")")
        )
      );
      var NDataDecl = regg(S, "NDATA", S, Name);
      var EntityDef = regg(EntityValue, "|", regg(ExternalID, NDataDecl, "?"));
      var ENTITY_DECL_START = "<!ENTITY";
      var GEDecl = reg(ENTITY_DECL_START, S, Name, S, EntityDef, S_OPT, ">");
      var PEDef = regg(EntityValue, "|", ExternalID);
      var PEDecl = reg(ENTITY_DECL_START, S, "%", S, Name, S, PEDef, S_OPT, ">");
      var EntityDecl = regg(GEDecl, "|", PEDecl);
      var PublicID = reg(PUBLIC, S, PubidLiteral);
      var NotationDecl = reg("<!NOTATION", S, Name, S, regg(ExternalID, "|", PublicID), S_OPT, ">");
      var Eq = reg(S_OPT, "=", S_OPT);
      var VersionNum = /1[.]\d+/;
      var VersionInfo = reg(S, "version", Eq, regg("'", VersionNum, "'", "|", '"', VersionNum, '"'));
      var EncName = /[A-Za-z][-A-Za-z0-9._]*/;
      var EncodingDecl = regg(S, "encoding", Eq, regg('"', EncName, '"', "|", "'", EncName, "'"));
      var SDDecl = regg(S, "standalone", Eq, regg("'", regg("yes", "|", "no"), "'", "|", '"', regg("yes", "|", "no"), '"'));
      var XMLDecl = reg(/^<\?xml/, VersionInfo, EncodingDecl, "?", SDDecl, "?", S_OPT, /\?>/);
      var DOCTYPE_DECL_START = "<!DOCTYPE";
      var CDATA_START = "<![CDATA[";
      var CDATA_END = "]]>";
      var CDStart = /<!\[CDATA\[/;
      var CDEnd = /\]\]>/;
      var CData = reg(Char, "*?", CDEnd);
      var CDSect = reg(CDStart, CData);
      exports.chars = chars;
      exports.chars_without = chars_without;
      exports.detectUnicodeSupport = detectUnicodeSupport;
      exports.reg = reg;
      exports.regg = regg;
      exports.ABOUT_LEGACY_COMPAT = ABOUT_LEGACY_COMPAT;
      exports.ABOUT_LEGACY_COMPAT_SystemLiteral = ABOUT_LEGACY_COMPAT_SystemLiteral;
      exports.AttlistDecl = AttlistDecl;
      exports.CDATA_START = CDATA_START;
      exports.CDATA_END = CDATA_END;
      exports.CDSect = CDSect;
      exports.Char = Char;
      exports.Comment = Comment;
      exports.COMMENT_START = COMMENT_START;
      exports.COMMENT_END = COMMENT_END;
      exports.DOCTYPE_DECL_START = DOCTYPE_DECL_START;
      exports.elementdecl = elementdecl;
      exports.EntityDecl = EntityDecl;
      exports.EntityValue = EntityValue;
      exports.ExternalID = ExternalID;
      exports.ExternalID_match = ExternalID_match;
      exports.Name = Name;
      exports.NotationDecl = NotationDecl;
      exports.Reference = Reference;
      exports.PEReference = PEReference;
      exports.PI = PI;
      exports.PUBLIC = PUBLIC;
      exports.PubidLiteral = PubidLiteral;
      exports.QName = QName;
      exports.QName_exact = QName_exact;
      exports.QName_group = QName_group;
      exports.S = S;
      exports.SChar_s = SChar_s;
      exports.S_OPT = S_OPT;
      exports.SYSTEM = SYSTEM;
      exports.SystemLiteral = SystemLiteral;
      exports.UNICODE_REPLACEMENT_CHARACTER = UNICODE_REPLACEMENT_CHARACTER;
      exports.UNICODE_SUPPORT = UNICODE_SUPPORT;
      exports.XMLDecl = XMLDecl;
    }
  });

  // node_modules/@xmldom/xmldom/lib/dom.js
  var require_dom = __commonJS({
    "node_modules/@xmldom/xmldom/lib/dom.js"(exports) {
      "use strict";
      var conventions = require_conventions();
      var find = conventions.find;
      var hasDefaultHTMLNamespace = conventions.hasDefaultHTMLNamespace;
      var hasOwn = conventions.hasOwn;
      var isHTMLMimeType = conventions.isHTMLMimeType;
      var isHTMLRawTextElement = conventions.isHTMLRawTextElement;
      var isHTMLVoidElement = conventions.isHTMLVoidElement;
      var MIME_TYPE = conventions.MIME_TYPE;
      var NAMESPACE = conventions.NAMESPACE;
      var PDC = /* @__PURE__ */ Symbol();
      var errors = require_errors();
      var DOMException = errors.DOMException;
      var DOMExceptionName = errors.DOMExceptionName;
      var g = require_grammar();
      function checkSymbol(symbol) {
        if (symbol !== PDC) {
          throw new TypeError("Illegal constructor");
        }
      }
      function notEmptyString(input) {
        return input !== "";
      }
      function splitOnASCIIWhitespace(input) {
        return input ? input.split(/[\t\n\f\r ]+/).filter(notEmptyString) : [];
      }
      function orderedSetReducer(current, element) {
        if (!hasOwn(current, element)) {
          current[element] = true;
        }
        return current;
      }
      function toOrderedSet(input) {
        if (!input) return [];
        var list = splitOnASCIIWhitespace(input);
        return Object.keys(list.reduce(orderedSetReducer, {}));
      }
      function arrayIncludes(list) {
        return function(element) {
          return list && list.indexOf(element) !== -1;
        };
      }
      function validateQualifiedName(qualifiedName) {
        if (!g.QName_exact.test(qualifiedName)) {
          throw new DOMException(DOMException.INVALID_CHARACTER_ERR, 'invalid character in qualified name "' + qualifiedName + '"');
        }
      }
      function validateAndExtract(namespace, qualifiedName) {
        validateQualifiedName(qualifiedName);
        namespace = namespace || null;
        var prefix = null;
        var localName = qualifiedName;
        if (qualifiedName.indexOf(":") >= 0) {
          var splitResult = qualifiedName.split(":");
          prefix = splitResult[0];
          localName = splitResult[1];
        }
        if (prefix !== null && namespace === null) {
          throw new DOMException(DOMException.NAMESPACE_ERR, "prefix is non-null and namespace is null");
        }
        if (prefix === "xml" && namespace !== conventions.NAMESPACE.XML) {
          throw new DOMException(DOMException.NAMESPACE_ERR, 'prefix is "xml" and namespace is not the XML namespace');
        }
        if ((prefix === "xmlns" || qualifiedName === "xmlns") && namespace !== conventions.NAMESPACE.XMLNS) {
          throw new DOMException(
            DOMException.NAMESPACE_ERR,
            'either qualifiedName or prefix is "xmlns" and namespace is not the XMLNS namespace'
          );
        }
        if (namespace === conventions.NAMESPACE.XMLNS && prefix !== "xmlns" && qualifiedName !== "xmlns") {
          throw new DOMException(
            DOMException.NAMESPACE_ERR,
            'namespace is the XMLNS namespace and neither qualifiedName nor prefix is "xmlns"'
          );
        }
        return [namespace, prefix, localName];
      }
      function copy(src, dest) {
        for (var p in src) {
          if (hasOwn(src, p)) {
            dest[p] = src[p];
          }
        }
      }
      function _extends(Class, Super) {
        var pt = Class.prototype;
        if (!(pt instanceof Super)) {
          let t = function() {
          };
          t.prototype = Super.prototype;
          t = new t();
          copy(pt, t);
          Class.prototype = pt = t;
        }
        if (pt.constructor != Class) {
          if (typeof Class != "function") {
            console.error("unknown Class:" + Class);
          }
          pt.constructor = Class;
        }
      }
      var NodeType = {};
      var ELEMENT_NODE = NodeType.ELEMENT_NODE = 1;
      var ATTRIBUTE_NODE = NodeType.ATTRIBUTE_NODE = 2;
      var TEXT_NODE = NodeType.TEXT_NODE = 3;
      var CDATA_SECTION_NODE = NodeType.CDATA_SECTION_NODE = 4;
      var ENTITY_REFERENCE_NODE = NodeType.ENTITY_REFERENCE_NODE = 5;
      var ENTITY_NODE = NodeType.ENTITY_NODE = 6;
      var PROCESSING_INSTRUCTION_NODE = NodeType.PROCESSING_INSTRUCTION_NODE = 7;
      var COMMENT_NODE = NodeType.COMMENT_NODE = 8;
      var DOCUMENT_NODE = NodeType.DOCUMENT_NODE = 9;
      var DOCUMENT_TYPE_NODE = NodeType.DOCUMENT_TYPE_NODE = 10;
      var DOCUMENT_FRAGMENT_NODE = NodeType.DOCUMENT_FRAGMENT_NODE = 11;
      var NOTATION_NODE = NodeType.NOTATION_NODE = 12;
      var DocumentPosition = conventions.freeze({
        DOCUMENT_POSITION_DISCONNECTED: 1,
        DOCUMENT_POSITION_PRECEDING: 2,
        DOCUMENT_POSITION_FOLLOWING: 4,
        DOCUMENT_POSITION_CONTAINS: 8,
        DOCUMENT_POSITION_CONTAINED_BY: 16,
        DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC: 32
      });
      function commonAncestor(a, b) {
        if (b.length < a.length) return commonAncestor(b, a);
        var c = null;
        for (var n in a) {
          if (a[n] !== b[n]) return c;
          c = a[n];
        }
        return c;
      }
      function docGUID(doc) {
        if (!doc.guid) doc.guid = Math.random();
        return doc.guid;
      }
      function NodeList() {
      }
      NodeList.prototype = {
        /**
         * The number of nodes in the list. The range of valid child node indices is 0 to length-1
         * inclusive.
         *
         * @type {number}
         */
        length: 0,
        /**
         * Returns the item at `index`. If index is greater than or equal to the number of nodes in
         * the list, this returns null.
         *
         * @param index
         * Unsigned long Index into the collection.
         * @returns {Node | null}
         * The node at position `index` in the NodeList,
         * or null if that is not a valid index.
         */
        item: function(index) {
          return index >= 0 && index < this.length ? this[index] : null;
        },
        /**
         * Returns a string representation of the NodeList.
         *
         * @param {unknown} nodeFilter
         * __A filter function? Not implemented according to the spec?__.
         * @returns {string}
         * A string representation of the NodeList.
         */
        toString: function(nodeFilter) {
          for (var buf = [], i = 0; i < this.length; i++) {
            serializeToString(this[i], buf, nodeFilter);
          }
          return buf.join("");
        },
        /**
         * Filters the NodeList based on a predicate.
         *
         * @param {function(Node): boolean} predicate
         * - A predicate function to filter the NodeList.
         * @returns {Node[]}
         * An array of nodes that satisfy the predicate.
         * @private
         */
        filter: function(predicate) {
          return Array.prototype.filter.call(this, predicate);
        },
        /**
         * Returns the first index at which a given node can be found in the NodeList, or -1 if it is
         * not present.
         *
         * @param {Node} item
         * - The Node item to locate in the NodeList.
         * @returns {number}
         * The first index of the node in the NodeList; -1 if not found.
         * @private
         */
        indexOf: function(item) {
          return Array.prototype.indexOf.call(this, item);
        }
      };
      NodeList.prototype[Symbol.iterator] = function() {
        var me = this;
        var index = 0;
        return {
          next: function() {
            if (index < me.length) {
              return {
                value: me[index++],
                done: false
              };
            } else {
              return {
                done: true
              };
            }
          },
          return: function() {
            return {
              done: true
            };
          }
        };
      };
      function LiveNodeList(node, refresh) {
        this._node = node;
        this._refresh = refresh;
        _updateLiveList(this);
      }
      function _updateLiveList(list) {
        var inc = list._node._inc || list._node.ownerDocument._inc;
        if (list._inc !== inc) {
          var ls = list._refresh(list._node);
          __set__(list, "length", ls.length);
          if (!list.$$length || ls.length < list.$$length) {
            for (var i = ls.length; i in list; i++) {
              if (hasOwn(list, i)) {
                delete list[i];
              }
            }
          }
          copy(ls, list);
          list._inc = inc;
        }
      }
      LiveNodeList.prototype.item = function(i) {
        _updateLiveList(this);
        return this[i] || null;
      };
      _extends(LiveNodeList, NodeList);
      function NamedNodeMap() {
      }
      function _findNodeIndex(list, node) {
        var i = 0;
        while (i < list.length) {
          if (list[i] === node) {
            return i;
          }
          i++;
        }
      }
      function _addNamedNode(el, list, newAttr, oldAttr) {
        if (oldAttr) {
          list[_findNodeIndex(list, oldAttr)] = newAttr;
        } else {
          list[list.length] = newAttr;
          list.length++;
        }
        if (el) {
          newAttr.ownerElement = el;
          var doc = el.ownerDocument;
          if (doc) {
            oldAttr && _onRemoveAttribute(doc, el, oldAttr);
            _onAddAttribute(doc, el, newAttr);
          }
        }
      }
      function _removeNamedNode(el, list, attr) {
        var i = _findNodeIndex(list, attr);
        if (i >= 0) {
          var lastIndex = list.length - 1;
          while (i <= lastIndex) {
            list[i] = list[++i];
          }
          list.length = lastIndex;
          if (el) {
            var doc = el.ownerDocument;
            if (doc) {
              _onRemoveAttribute(doc, el, attr);
            }
            attr.ownerElement = null;
          }
        }
      }
      NamedNodeMap.prototype = {
        length: 0,
        item: NodeList.prototype.item,
        /**
         * Get an attribute by name. Note: Name is in lower case in case of HTML namespace and
         * document.
         *
         * @param {string} localName
         * The local name of the attribute.
         * @returns {Attr | null}
         * The attribute with the given local name, or null if no such attribute exists.
         * @see https://dom.spec.whatwg.org/#concept-element-attributes-get-by-name
         */
        getNamedItem: function(localName) {
          if (this._ownerElement && this._ownerElement._isInHTMLDocumentAndNamespace()) {
            localName = localName.toLowerCase();
          }
          var i = 0;
          while (i < this.length) {
            var attr = this[i];
            if (attr.nodeName === localName) {
              return attr;
            }
            i++;
          }
          return null;
        },
        /**
         * Set an attribute.
         *
         * @param {Attr} attr
         * The attribute to set.
         * @returns {Attr | null}
         * The old attribute with the same local name and namespace URI as the new one, or null if no
         * such attribute exists.
         * @throws {DOMException}
         * With code:
         * - {@link INUSE_ATTRIBUTE_ERR} - If the attribute is already an attribute of another
         * element.
         * @see https://dom.spec.whatwg.org/#concept-element-attributes-set
         */
        setNamedItem: function(attr) {
          var el = attr.ownerElement;
          if (el && el !== this._ownerElement) {
            throw new DOMException(DOMException.INUSE_ATTRIBUTE_ERR);
          }
          var oldAttr = this.getNamedItemNS(attr.namespaceURI, attr.localName);
          if (oldAttr === attr) {
            return attr;
          }
          _addNamedNode(this._ownerElement, this, attr, oldAttr);
          return oldAttr;
        },
        /**
         * Set an attribute, replacing an existing attribute with the same local name and namespace
         * URI if one exists.
         *
         * @param {Attr} attr
         * The attribute to set.
         * @returns {Attr | null}
         * The old attribute with the same local name and namespace URI as the new one, or null if no
         * such attribute exists.
         * @throws {DOMException}
         * Throws a DOMException with the name "InUseAttributeError" if the attribute is already an
         * attribute of another element.
         * @see https://dom.spec.whatwg.org/#concept-element-attributes-set
         */
        setNamedItemNS: function(attr) {
          return this.setNamedItem(attr);
        },
        /**
         * Removes an attribute specified by the local name.
         *
         * @param {string} localName
         * The local name of the attribute to be removed.
         * @returns {Attr}
         * The attribute node that was removed.
         * @throws {DOMException}
         * With code:
         * - {@link DOMException.NOT_FOUND_ERR} if no attribute with the given name is found.
         * @see https://dom.spec.whatwg.org/#dom-namednodemap-removenameditem
         * @see https://dom.spec.whatwg.org/#concept-element-attributes-remove-by-name
         */
        removeNamedItem: function(localName) {
          var attr = this.getNamedItem(localName);
          if (!attr) {
            throw new DOMException(DOMException.NOT_FOUND_ERR, localName);
          }
          _removeNamedNode(this._ownerElement, this, attr);
          return attr;
        },
        /**
         * Removes an attribute specified by the namespace and local name.
         *
         * @param {string | null} namespaceURI
         * The namespace URI of the attribute to be removed.
         * @param {string} localName
         * The local name of the attribute to be removed.
         * @returns {Attr}
         * The attribute node that was removed.
         * @throws {DOMException}
         * With code:
         * - {@link DOMException.NOT_FOUND_ERR} if no attribute with the given namespace URI and local
         * name is found.
         * @see https://dom.spec.whatwg.org/#dom-namednodemap-removenameditemns
         * @see https://dom.spec.whatwg.org/#concept-element-attributes-remove-by-namespace
         */
        removeNamedItemNS: function(namespaceURI, localName) {
          var attr = this.getNamedItemNS(namespaceURI, localName);
          if (!attr) {
            throw new DOMException(DOMException.NOT_FOUND_ERR, namespaceURI ? namespaceURI + " : " + localName : localName);
          }
          _removeNamedNode(this._ownerElement, this, attr);
          return attr;
        },
        /**
         * Get an attribute by namespace and local name.
         *
         * @param {string | null} namespaceURI
         * The namespace URI of the attribute.
         * @param {string} localName
         * The local name of the attribute.
         * @returns {Attr | null}
         * The attribute with the given namespace URI and local name, or null if no such attribute
         * exists.
         * @see https://dom.spec.whatwg.org/#concept-element-attributes-get-by-namespace
         */
        getNamedItemNS: function(namespaceURI, localName) {
          if (!namespaceURI) {
            namespaceURI = null;
          }
          var i = 0;
          while (i < this.length) {
            var node = this[i];
            if (node.localName === localName && node.namespaceURI === namespaceURI) {
              return node;
            }
            i++;
          }
          return null;
        }
      };
      NamedNodeMap.prototype[Symbol.iterator] = function() {
        var me = this;
        var index = 0;
        return {
          next: function() {
            if (index < me.length) {
              return {
                value: me[index++],
                done: false
              };
            } else {
              return {
                done: true
              };
            }
          },
          return: function() {
            return {
              done: true
            };
          }
        };
      };
      function DOMImplementation() {
      }
      DOMImplementation.prototype = {
        /**
         * Test if the DOM implementation implements a specific feature and version, as specified in
         * {@link https://www.w3.org/TR/DOM-Level-3-Core/core.html#DOMFeatures DOM Features}.
         *
         * The DOMImplementation.hasFeature() method returns a Boolean flag indicating if a given
         * feature is supported. The different implementations fairly diverged in what kind of
         * features were reported. The latest version of the spec settled to force this method to
         * always return true, where the functionality was accurate and in use.
         *
         * @deprecated
         * It is deprecated and modern browsers return true in all cases.
         * @function DOMImplementation#hasFeature
         * @param {string} feature
         * The name of the feature to test.
         * @param {string} [version]
         * This is the version number of the feature to test.
         * @returns {boolean}
         * Always returns true.
         * @see https://developer.mozilla.org/en-US/docs/Web/API/DOMImplementation/hasFeature MDN
         * @see https://www.w3.org/TR/REC-DOM-Level-1/level-one-core.html#ID-5CED94D7 DOM Level 1 Core
         * @see https://dom.spec.whatwg.org/#dom-domimplementation-hasfeature DOM Living Standard
         * @see https://www.w3.org/TR/DOM-Level-3-Core/core.html#ID-5CED94D7 DOM Level 3 Core
         */
        hasFeature: function(feature, version) {
          return true;
        },
        /**
         * Creates a DOM Document object of the specified type with its document element. Note that
         * based on the {@link DocumentType}
         * given to create the document, the implementation may instantiate specialized
         * {@link Document} objects that support additional features than the "Core", such as "HTML"
         * {@link https://www.w3.org/TR/DOM-Level-3-Core/references.html#DOM2HTML DOM Level 2 HTML}.
         * On the other hand, setting the {@link DocumentType} after the document was created makes
         * this very unlikely to happen. Alternatively, specialized {@link Document} creation methods,
         * such as createHTMLDocument
         * {@link https://www.w3.org/TR/DOM-Level-3-Core/references.html#DOM2HTML DOM Level 2 HTML},
         * can be used to obtain specific types of {@link Document} objects.
         *
         * __It behaves slightly different from the description in the living standard__:
         * - There is no interface/class `XMLDocument`, it returns a `Document`
         * instance (with it's `type` set to `'xml'`).
         * - `encoding`, `mode`, `origin`, `url` fields are currently not declared.
         *
         * @function DOMImplementation.createDocument
         * @param {string | null} namespaceURI
         * The
         * {@link https://www.w3.org/TR/DOM-Level-3-Core/glossary.html#dt-namespaceURI namespace URI}
         * of the document element to create or null.
         * @param {string | null} qualifiedName
         * The
         * {@link https://www.w3.org/TR/DOM-Level-3-Core/glossary.html#dt-qualifiedname qualified name}
         * of the document element to be created or null.
         * @param {DocumentType | null} [doctype=null]
         * The type of document to be created or null. When doctype is not null, its
         * {@link Node#ownerDocument} attribute is set to the document being created. Default is
         * `null`
         * @returns {Document}
         * A new {@link Document} object with its document element. If the NamespaceURI,
         * qualifiedName, and doctype are null, the returned {@link Document} is empty with no
         * document element.
         * @throws {DOMException}
         * With code:
         *
         * - `INVALID_CHARACTER_ERR`: Raised if the specified qualified name is not an XML name
         * according to {@link https://www.w3.org/TR/DOM-Level-3-Core/references.html#XML XML 1.0}.
         * - `NAMESPACE_ERR`: Raised if the qualifiedName is malformed, if the qualifiedName has a
         * prefix and the namespaceURI is null, or if the qualifiedName is null and the namespaceURI
         * is different from null, or if the qualifiedName has a prefix that is "xml" and the
         * namespaceURI is different from "{@link http://www.w3.org/XML/1998/namespace}"
         * {@link https://www.w3.org/TR/DOM-Level-3-Core/references.html#Namespaces XML Namespaces},
         * or if the DOM implementation does not support the "XML" feature but a non-null namespace
         * URI was provided, since namespaces were defined by XML.
         * - `WRONG_DOCUMENT_ERR`: Raised if doctype has already been used with a different document
         * or was created from a different implementation.
         * - `NOT_SUPPORTED_ERR`: May be raised if the implementation does not support the feature
         * "XML" and the language exposed through the Document does not support XML Namespaces (such
         * as {@link https://www.w3.org/TR/DOM-Level-3-Core/references.html#HTML40 HTML 4.01}).
         * @since DOM Level 2.
         * @see {@link #createHTMLDocument}
         * @see https://developer.mozilla.org/en-US/docs/Web/API/DOMImplementation/createDocument MDN
         * @see https://dom.spec.whatwg.org/#dom-domimplementation-createdocument DOM Living Standard
         * @see https://www.w3.org/TR/DOM-Level-3-Core/core.html#Level-2-Core-DOM-createDocument DOM
         *      Level 3 Core
         * @see https://www.w3.org/TR/DOM-Level-2-Core/core.html#Level-2-Core-DOM-createDocument DOM
         *      Level 2 Core (initial)
         */
        createDocument: function(namespaceURI, qualifiedName, doctype) {
          var contentType = MIME_TYPE.XML_APPLICATION;
          if (namespaceURI === NAMESPACE.HTML) {
            contentType = MIME_TYPE.XML_XHTML_APPLICATION;
          } else if (namespaceURI === NAMESPACE.SVG) {
            contentType = MIME_TYPE.XML_SVG_IMAGE;
          }
          var doc = new Document(PDC, { contentType });
          doc.implementation = this;
          doc.childNodes = new NodeList();
          doc.doctype = doctype || null;
          if (doctype) {
            doc.appendChild(doctype);
          }
          if (qualifiedName) {
            var root = doc.createElementNS(namespaceURI, qualifiedName);
            doc.appendChild(root);
          }
          return doc;
        },
        /**
         * Creates an empty DocumentType node. Entity declarations and notations are not made
         * available. Entity reference expansions and default attribute additions do not occur.
         *
         * **This behavior is slightly different from the one in the specs**:
         * - `encoding`, `mode`, `origin`, `url` fields are currently not declared.
         * - `publicId` and `systemId` contain the raw data including any possible quotes,
         *   so they can always be serialized back to the original value
         * - `internalSubset` contains the raw string between `[` and `]` if present,
         *   but is not parsed or validated in any form.
         *
         * @function DOMImplementation#createDocumentType
         * @param {string} qualifiedName
         * The {@link https://www.w3.org/TR/DOM-Level-3-Core/glossary.html#dt-qualifiedname qualified
         * name} of the document type to be created.
         * @param {string} [publicId]
         * The external subset public identifier.
         * @param {string} [systemId]
         * The external subset system identifier.
         * @param {string} [internalSubset]
         * the internal subset or an empty string if it is not present
         * @returns {DocumentType}
         * A new {@link DocumentType} node with {@link Node#ownerDocument} set to null.
         * @throws {DOMException}
         * With code:
         *
         * - `INVALID_CHARACTER_ERR`: Raised if the specified qualified name is not an XML name
         * according to {@link https://www.w3.org/TR/DOM-Level-3-Core/references.html#XML XML 1.0}.
         * - `NAMESPACE_ERR`: Raised if the qualifiedName is malformed.
         * - `NOT_SUPPORTED_ERR`: May be raised if the implementation does not support the feature
         * "XML" and the language exposed through the Document does not support XML Namespaces (such
         * as {@link https://www.w3.org/TR/DOM-Level-3-Core/references.html#HTML40 HTML 4.01}).
         * @since DOM Level 2.
         * @see https://developer.mozilla.org/en-US/docs/Web/API/DOMImplementation/createDocumentType
         *      MDN
         * @see https://dom.spec.whatwg.org/#dom-domimplementation-createdocumenttype DOM Living
         *      Standard
         * @see https://www.w3.org/TR/DOM-Level-3-Core/core.html#Level-3-Core-DOM-createDocType DOM
         *      Level 3 Core
         * @see https://www.w3.org/TR/DOM-Level-2-Core/core.html#Level-2-Core-DOM-createDocType DOM
         *      Level 2 Core
         * @see https://github.com/xmldom/xmldom/blob/master/CHANGELOG.md#050
         * @see https://www.w3.org/TR/DOM-Level-2-Core/#core-ID-Core-DocType-internalSubset
         * @prettierignore
         */
        createDocumentType: function(qualifiedName, publicId, systemId, internalSubset) {
          validateQualifiedName(qualifiedName);
          var node = new DocumentType(PDC);
          node.name = qualifiedName;
          node.nodeName = qualifiedName;
          node.publicId = publicId || "";
          node.systemId = systemId || "";
          node.internalSubset = internalSubset || "";
          node.childNodes = new NodeList();
          return node;
        },
        /**
         * Returns an HTML document, that might already have a basic DOM structure.
         *
         * __It behaves slightly different from the description in the living standard__:
         * - If the first argument is `false` no initial nodes are added (steps 3-7 in the specs are
         * omitted)
         * - `encoding`, `mode`, `origin`, `url` fields are currently not declared.
         *
         * @param {string | false} [title]
         * A string containing the title to give the new HTML document.
         * @returns {Document}
         * The HTML document.
         * @since WHATWG Living Standard.
         * @see {@link #createDocument}
         * @see https://dom.spec.whatwg.org/#dom-domimplementation-createhtmldocument
         * @see https://dom.spec.whatwg.org/#html-document
         */
        createHTMLDocument: function(title) {
          var doc = new Document(PDC, { contentType: MIME_TYPE.HTML });
          doc.implementation = this;
          doc.childNodes = new NodeList();
          if (title !== false) {
            doc.doctype = this.createDocumentType("html");
            doc.doctype.ownerDocument = doc;
            doc.appendChild(doc.doctype);
            var htmlNode = doc.createElement("html");
            doc.appendChild(htmlNode);
            var headNode = doc.createElement("head");
            htmlNode.appendChild(headNode);
            if (typeof title === "string") {
              var titleNode = doc.createElement("title");
              titleNode.appendChild(doc.createTextNode(title));
              headNode.appendChild(titleNode);
            }
            htmlNode.appendChild(doc.createElement("body"));
          }
          return doc;
        }
      };
      function Node(symbol) {
        checkSymbol(symbol);
      }
      Node.prototype = {
        /**
         * The first child of this node.
         *
         * @type {Node | null}
         */
        firstChild: null,
        /**
         * The last child of this node.
         *
         * @type {Node | null}
         */
        lastChild: null,
        /**
         * The previous sibling of this node.
         *
         * @type {Node | null}
         */
        previousSibling: null,
        /**
         * The next sibling of this node.
         *
         * @type {Node | null}
         */
        nextSibling: null,
        /**
         * The parent node of this node.
         *
         * @type {Node | null}
         */
        parentNode: null,
        /**
         * The parent element of this node.
         *
         * @type {Element | null}
         */
        get parentElement() {
          return this.parentNode && this.parentNode.nodeType === this.ELEMENT_NODE ? this.parentNode : null;
        },
        /**
         * The child nodes of this node.
         *
         * @type {NodeList}
         */
        childNodes: null,
        /**
         * The document object associated with this node.
         *
         * @type {Document | null}
         */
        ownerDocument: null,
        /**
         * The value of this node.
         *
         * @type {string | null}
         */
        nodeValue: null,
        /**
         * The namespace URI of this node.
         *
         * @type {string | null}
         */
        namespaceURI: null,
        /**
         * The prefix of the namespace for this node.
         *
         * @type {string | null}
         */
        prefix: null,
        /**
         * The local part of the qualified name of this node.
         *
         * @type {string | null}
         */
        localName: null,
        /**
         * The baseURI is currently always `about:blank`,
         * since that's what happens when you create a document from scratch.
         *
         * @type {'about:blank'}
         */
        baseURI: "about:blank",
        /**
         * Is true if this node is part of a document.
         *
         * @type {boolean}
         */
        get isConnected() {
          var rootNode = this.getRootNode();
          return rootNode && rootNode.nodeType === rootNode.DOCUMENT_NODE;
        },
        /**
         * Checks whether `other` is an inclusive descendant of this node.
         *
         * @param {Node | null | undefined} other
         * The node to check.
         * @returns {boolean}
         * True if `other` is an inclusive descendant of this node; false otherwise.
         * @see https://dom.spec.whatwg.org/#dom-node-contains
         */
        contains: function(other) {
          if (!other) return false;
          var parent = other;
          do {
            if (this === parent) return true;
            parent = other.parentNode;
          } while (parent);
          return false;
        },
        /**
         * @typedef GetRootNodeOptions
         * @property {boolean} [composed=false]
         */
        /**
         * Searches for the root node of this node.
         *
         * **This behavior is slightly different from the in the specs**:
         * - ignores `options.composed`, since `ShadowRoot`s are unsupported, always returns root.
         *
         * @param {GetRootNodeOptions} [options]
         * @returns {Node}
         * Root node.
         * @see https://dom.spec.whatwg.org/#dom-node-getrootnode
         * @see https://dom.spec.whatwg.org/#concept-shadow-including-root
         */
        getRootNode: function(options) {
          var parent = this;
          do {
            if (!parent.parentNode) {
              return parent;
            }
            parent = parent.parentNode;
          } while (parent);
        },
        /**
         * Checks whether the given node is equal to this node.
         *
         * @param {Node} [otherNode]
         * @see https://dom.spec.whatwg.org/#concept-node-equals
         */
        isEqualNode: function(otherNode) {
          if (!otherNode) return false;
          if (this.nodeType !== otherNode.nodeType) return false;
          switch (this.nodeType) {
            case this.DOCUMENT_TYPE_NODE:
              if (this.name !== otherNode.name) return false;
              if (this.publicId !== otherNode.publicId) return false;
              if (this.systemId !== otherNode.systemId) return false;
              break;
            case this.ELEMENT_NODE:
              if (this.namespaceURI !== otherNode.namespaceURI) return false;
              if (this.prefix !== otherNode.prefix) return false;
              if (this.localName !== otherNode.localName) return false;
              if (this.attributes.length !== otherNode.attributes.length) return false;
              for (var i = 0; i < this.attributes.length; i++) {
                var attr = this.attributes.item(i);
                if (!attr.isEqualNode(otherNode.getAttributeNodeNS(attr.namespaceURI, attr.localName))) {
                  return false;
                }
              }
              break;
            case this.ATTRIBUTE_NODE:
              if (this.namespaceURI !== otherNode.namespaceURI) return false;
              if (this.localName !== otherNode.localName) return false;
              if (this.value !== otherNode.value) return false;
              break;
            case this.PROCESSING_INSTRUCTION_NODE:
              if (this.target !== otherNode.target || this.data !== otherNode.data) {
                return false;
              }
              break;
            case this.TEXT_NODE:
            case this.COMMENT_NODE:
              if (this.data !== otherNode.data) return false;
              break;
          }
          if (this.childNodes.length !== otherNode.childNodes.length) {
            return false;
          }
          for (var i = 0; i < this.childNodes.length; i++) {
            if (!this.childNodes[i].isEqualNode(otherNode.childNodes[i])) {
              return false;
            }
          }
          return true;
        },
        /**
         * Checks whether or not the given node is this node.
         *
         * @param {Node} [otherNode]
         */
        isSameNode: function(otherNode) {
          return this === otherNode;
        },
        /**
         * Inserts a node before a reference node as a child of this node.
         *
         * @param {Node} newChild
         * The new child node to be inserted.
         * @param {Node | null} refChild
         * The reference node before which newChild will be inserted.
         * @returns {Node}
         * The new child node successfully inserted.
         * @throws {DOMException}
         * Throws a DOMException if inserting the node would result in a DOM tree that is not
         * well-formed, or if `child` is provided but is not a child of `parent`.
         * See {@link _insertBefore} for more details.
         * @since Modified in DOM L2
         */
        insertBefore: function(newChild, refChild) {
          return _insertBefore(this, newChild, refChild);
        },
        /**
         * Replaces an old child node with a new child node within this node.
         *
         * @param {Node} newChild
         * The new node that is to replace the old node.
         * If it already exists in the DOM, it is removed from its original position.
         * @param {Node} oldChild
         * The existing child node to be replaced.
         * @returns {Node}
         * Returns the replaced child node.
         * @throws {DOMException}
         * Throws a DOMException if replacing the node would result in a DOM tree that is not
         * well-formed, or if `oldChild` is not a child of `this`.
         * This can also occur if the pre-replacement validity assertion fails.
         * See {@link _insertBefore}, {@link Node.removeChild}, and
         * {@link assertPreReplacementValidityInDocument} for more details.
         * @see https://dom.spec.whatwg.org/#concept-node-replace
         */
        replaceChild: function(newChild, oldChild) {
          _insertBefore(this, newChild, oldChild, assertPreReplacementValidityInDocument);
          if (oldChild) {
            this.removeChild(oldChild);
          }
        },
        /**
         * Removes an existing child node from this node.
         *
         * @param {Node} oldChild
         * The child node to be removed.
         * @returns {Node}
         * Returns the removed child node.
         * @throws {DOMException}
         * Throws a DOMException if `oldChild` is not a child of `this`.
         * See {@link _removeChild} for more details.
         */
        removeChild: function(oldChild) {
          return _removeChild(this, oldChild);
        },
        /**
         * Appends a child node to this node.
         *
         * @param {Node} newChild
         * The child node to be appended to this node.
         * If it already exists in the DOM, it is removed from its original position.
         * @returns {Node}
         * Returns the appended child node.
         * @throws {DOMException}
         * Throws a DOMException if appending the node would result in a DOM tree that is not
         * well-formed, or if `newChild` is not a valid Node.
         * See {@link insertBefore} for more details.
         */
        appendChild: function(newChild) {
          return this.insertBefore(newChild, null);
        },
        /**
         * Determines whether this node has any child nodes.
         *
         * @returns {boolean}
         * Returns true if this node has any child nodes, and false otherwise.
         */
        hasChildNodes: function() {
          return this.firstChild != null;
        },
        /**
         * Creates a copy of the calling node.
         *
         * @param {boolean} deep
         * If true, the contents of the node are recursively copied.
         * If false, only the node itself (and its attributes, if it is an element) are copied.
         * @returns {Node}
         * Returns the newly created copy of the node.
         * @throws {DOMException}
         * May throw a DOMException if operations within {@link Element#setAttributeNode} or
         * {@link Node#appendChild} (which are potentially invoked in this method) do not meet their
         * specific constraints.
         * @see {@link cloneNode}
         */
        cloneNode: function(deep) {
          return cloneNode(this.ownerDocument || this, this, deep);
        },
        /**
         * Puts the specified node and all of its subtree into a "normalized" form. In a normalized
         * subtree, no text nodes in the subtree are empty and there are no adjacent text nodes.
         *
         * Specifically, this method merges any adjacent text nodes (i.e., nodes for which `nodeType`
         * is `TEXT_NODE`) into a single node with the combined data. It also removes any empty text
         * nodes.
         *
         * This method operates recursively, so it also normalizes any and all descendent nodes within
         * the subtree.
         *
         * @throws {DOMException}
         * May throw a DOMException if operations within removeChild or appendData (which are
         * potentially invoked in this method) do not meet their specific constraints.
         * @since Modified in DOM Level 2
         * @see {@link Node.removeChild}
         * @see {@link CharacterData.appendData}
         */
        normalize: function() {
          var child = this.firstChild;
          while (child) {
            var next = child.nextSibling;
            if (next && next.nodeType == TEXT_NODE && child.nodeType == TEXT_NODE) {
              this.removeChild(next);
              child.appendData(next.data);
            } else {
              child.normalize();
              child = next;
            }
          }
        },
        /**
         * Checks whether the DOM implementation implements a specific feature and its version.
         *
         * @deprecated
         * Since `DOMImplementation.hasFeature` is deprecated and always returns true.
         * @param {string} feature
         * The package name of the feature to test. This is the same name that can be passed to the
         * method `hasFeature` on `DOMImplementation`.
         * @param {string} version
         * This is the version number of the package name to test.
         * @returns {boolean}
         * Returns true in all cases in the current implementation.
         * @since Introduced in DOM Level 2
         * @see {@link DOMImplementation.hasFeature}
         */
        isSupported: function(feature, version) {
          return this.ownerDocument.implementation.hasFeature(feature, version);
        },
        /**
         * Look up the prefix associated to the given namespace URI, starting from this node.
         * **The default namespace declarations are ignored by this method.**
         * See Namespace Prefix Lookup for details on the algorithm used by this method.
         *
         * **This behavior is different from the in the specs**:
         * - no node type specific handling
         * - uses the internal attribute _nsMap for resolving namespaces that is updated when changing attributes
         *
         * @param {string | null} namespaceURI
         * The namespace URI for which to find the associated prefix.
         * @returns {string | null}
         * The associated prefix, if found; otherwise, null.
         * @see https://www.w3.org/TR/DOM-Level-3-Core/core.html#Node3-lookupNamespacePrefix
         * @see https://www.w3.org/TR/DOM-Level-3-Core/namespaces-algorithms.html#lookupNamespacePrefixAlgo
         * @see https://dom.spec.whatwg.org/#dom-node-lookupprefix
         * @see https://github.com/xmldom/xmldom/issues/322
         * @prettierignore
         */
        lookupPrefix: function(namespaceURI) {
          var el = this;
          while (el) {
            var map = el._nsMap;
            if (map) {
              for (var n in map) {
                if (hasOwn(map, n) && map[n] === namespaceURI) {
                  return n;
                }
              }
            }
            el = el.nodeType == ATTRIBUTE_NODE ? el.ownerDocument : el.parentNode;
          }
          return null;
        },
        /**
         * This function is used to look up the namespace URI associated with the given prefix,
         * starting from this node.
         *
         * **This behavior is different from the in the specs**:
         * - no node type specific handling
         * - uses the internal attribute _nsMap for resolving namespaces that is updated when changing attributes
         *
         * @param {string | null} prefix
         * The prefix for which to find the associated namespace URI.
         * @returns {string | null}
         * The associated namespace URI, if found; otherwise, null.
         * @since DOM Level 3
         * @see https://dom.spec.whatwg.org/#dom-node-lookupnamespaceuri
         * @see https://www.w3.org/TR/DOM-Level-3-Core/core.html#Node3-lookupNamespaceURI
         * @prettierignore
         */
        lookupNamespaceURI: function(prefix) {
          var el = this;
          while (el) {
            var map = el._nsMap;
            if (map) {
              if (hasOwn(map, prefix)) {
                return map[prefix];
              }
            }
            el = el.nodeType == ATTRIBUTE_NODE ? el.ownerDocument : el.parentNode;
          }
          return null;
        },
        /**
         * Determines whether the given namespace URI is the default namespace.
         *
         * The function works by looking up the prefix associated with the given namespace URI. If no
         * prefix is found (i.e., the namespace URI is not registered in the namespace map of this
         * node or any of its ancestors), it returns `true`, implying the namespace URI is considered
         * the default.
         *
         * **This behavior is different from the in the specs**:
         * - no node type specific handling
         * - uses the internal attribute _nsMap for resolving namespaces that is updated when changing attributes
         *
         * @param {string | null} namespaceURI
         * The namespace URI to be checked.
         * @returns {boolean}
         * Returns true if the given namespace URI is the default namespace, false otherwise.
         * @since DOM Level 3
         * @see https://www.w3.org/TR/DOM-Level-3-Core/core.html#Node3-isDefaultNamespace
         * @see https://dom.spec.whatwg.org/#dom-node-isdefaultnamespace
         * @prettierignore
         */
        isDefaultNamespace: function(namespaceURI) {
          var prefix = this.lookupPrefix(namespaceURI);
          return prefix == null;
        },
        /**
         * Compares the reference node with a node with regard to their position in the document and
         * according to the document order.
         *
         * @param {Node} other
         * The node to compare the reference node to.
         * @returns {number}
         * Returns how the node is positioned relatively to the reference node according to the
         * bitmask. 0 if reference node and given node are the same.
         * @since DOM Level 3
         * @see https://www.w3.org/TR/2004/REC-DOM-Level-3-Core-20040407/core.html#Node3-compare
         * @see https://dom.spec.whatwg.org/#dom-node-comparedocumentposition
         */
        compareDocumentPosition: function(other) {
          if (this === other) return 0;
          var node1 = other;
          var node2 = this;
          var attr1 = null;
          var attr2 = null;
          if (node1 instanceof Attr) {
            attr1 = node1;
            node1 = attr1.ownerElement;
          }
          if (node2 instanceof Attr) {
            attr2 = node2;
            node2 = attr2.ownerElement;
            if (attr1 && node1 && node2 === node1) {
              for (var i = 0, attr; attr = node2.attributes[i]; i++) {
                if (attr === attr1)
                  return DocumentPosition.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC + DocumentPosition.DOCUMENT_POSITION_PRECEDING;
                if (attr === attr2)
                  return DocumentPosition.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC + DocumentPosition.DOCUMENT_POSITION_FOLLOWING;
              }
            }
          }
          if (!node1 || !node2 || node2.ownerDocument !== node1.ownerDocument) {
            return DocumentPosition.DOCUMENT_POSITION_DISCONNECTED + DocumentPosition.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC + (docGUID(node2.ownerDocument) > docGUID(node1.ownerDocument) ? DocumentPosition.DOCUMENT_POSITION_FOLLOWING : DocumentPosition.DOCUMENT_POSITION_PRECEDING);
          }
          if (attr2 && node1 === node2) {
            return DocumentPosition.DOCUMENT_POSITION_CONTAINS + DocumentPosition.DOCUMENT_POSITION_PRECEDING;
          }
          if (attr1 && node1 === node2) {
            return DocumentPosition.DOCUMENT_POSITION_CONTAINED_BY + DocumentPosition.DOCUMENT_POSITION_FOLLOWING;
          }
          var chain1 = [];
          var ancestor1 = node1.parentNode;
          while (ancestor1) {
            if (!attr2 && ancestor1 === node2) {
              return DocumentPosition.DOCUMENT_POSITION_CONTAINED_BY + DocumentPosition.DOCUMENT_POSITION_FOLLOWING;
            }
            chain1.push(ancestor1);
            ancestor1 = ancestor1.parentNode;
          }
          chain1.reverse();
          var chain2 = [];
          var ancestor2 = node2.parentNode;
          while (ancestor2) {
            if (!attr1 && ancestor2 === node1) {
              return DocumentPosition.DOCUMENT_POSITION_CONTAINS + DocumentPosition.DOCUMENT_POSITION_PRECEDING;
            }
            chain2.push(ancestor2);
            ancestor2 = ancestor2.parentNode;
          }
          chain2.reverse();
          var ca = commonAncestor(chain1, chain2);
          for (var n in ca.childNodes) {
            var child = ca.childNodes[n];
            if (child === node2) return DocumentPosition.DOCUMENT_POSITION_FOLLOWING;
            if (child === node1) return DocumentPosition.DOCUMENT_POSITION_PRECEDING;
            if (chain2.indexOf(child) >= 0) return DocumentPosition.DOCUMENT_POSITION_FOLLOWING;
            if (chain1.indexOf(child) >= 0) return DocumentPosition.DOCUMENT_POSITION_PRECEDING;
          }
          return 0;
        }
      };
      function _xmlEncoder(c) {
        return c == "<" && "&lt;" || c == ">" && "&gt;" || c == "&" && "&amp;" || c == '"' && "&quot;" || "&#" + c.charCodeAt() + ";";
      }
      copy(NodeType, Node);
      copy(NodeType, Node.prototype);
      copy(DocumentPosition, Node);
      copy(DocumentPosition, Node.prototype);
      function _visitNode(node, callback) {
        if (callback(node)) {
          return true;
        }
        if (node = node.firstChild) {
          do {
            if (_visitNode(node, callback)) {
              return true;
            }
          } while (node = node.nextSibling);
        }
      }
      function Document(symbol, options) {
        checkSymbol(symbol);
        var opt = options || {};
        this.ownerDocument = this;
        this.contentType = opt.contentType || MIME_TYPE.XML_APPLICATION;
        this.type = isHTMLMimeType(this.contentType) ? "html" : "xml";
      }
      function _onAddAttribute(doc, el, newAttr) {
        doc && doc._inc++;
        var ns = newAttr.namespaceURI;
        if (ns === NAMESPACE.XMLNS) {
          el._nsMap[newAttr.prefix ? newAttr.localName : ""] = newAttr.value;
        }
      }
      function _onRemoveAttribute(doc, el, newAttr, remove) {
        doc && doc._inc++;
        var ns = newAttr.namespaceURI;
        if (ns === NAMESPACE.XMLNS) {
          delete el._nsMap[newAttr.prefix ? newAttr.localName : ""];
        }
      }
      function _onUpdateChild(doc, parent, newChild) {
        if (doc && doc._inc) {
          doc._inc++;
          var childNodes = parent.childNodes;
          if (newChild && !newChild.nextSibling) {
            childNodes[childNodes.length++] = newChild;
          } else {
            var child = parent.firstChild;
            var i = 0;
            while (child) {
              childNodes[i++] = child;
              child = child.nextSibling;
            }
            childNodes.length = i;
            delete childNodes[childNodes.length];
          }
        }
      }
      function _removeChild(parentNode, child) {
        if (parentNode !== child.parentNode) {
          throw new DOMException(DOMException.NOT_FOUND_ERR, "child's parent is not parent");
        }
        var oldPreviousSibling = child.previousSibling;
        var oldNextSibling = child.nextSibling;
        if (oldPreviousSibling) {
          oldPreviousSibling.nextSibling = oldNextSibling;
        } else {
          parentNode.firstChild = oldNextSibling;
        }
        if (oldNextSibling) {
          oldNextSibling.previousSibling = oldPreviousSibling;
        } else {
          parentNode.lastChild = oldPreviousSibling;
        }
        _onUpdateChild(parentNode.ownerDocument, parentNode);
        child.parentNode = null;
        child.previousSibling = null;
        child.nextSibling = null;
        return child;
      }
      function hasValidParentNodeType(node) {
        return node && (node.nodeType === Node.DOCUMENT_NODE || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE || node.nodeType === Node.ELEMENT_NODE);
      }
      function hasInsertableNodeType(node) {
        return node && (node.nodeType === Node.CDATA_SECTION_NODE || node.nodeType === Node.COMMENT_NODE || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE || node.nodeType === Node.DOCUMENT_TYPE_NODE || node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.PROCESSING_INSTRUCTION_NODE || node.nodeType === Node.TEXT_NODE);
      }
      function isDocTypeNode(node) {
        return node && node.nodeType === Node.DOCUMENT_TYPE_NODE;
      }
      function isElementNode(node) {
        return node && node.nodeType === Node.ELEMENT_NODE;
      }
      function isTextNode(node) {
        return node && node.nodeType === Node.TEXT_NODE;
      }
      function isElementInsertionPossible(doc, child) {
        var parentChildNodes = doc.childNodes || [];
        if (find(parentChildNodes, isElementNode) || isDocTypeNode(child)) {
          return false;
        }
        var docTypeNode = find(parentChildNodes, isDocTypeNode);
        return !(child && docTypeNode && parentChildNodes.indexOf(docTypeNode) > parentChildNodes.indexOf(child));
      }
      function isElementReplacementPossible(doc, child) {
        var parentChildNodes = doc.childNodes || [];
        function hasElementChildThatIsNotChild(node) {
          return isElementNode(node) && node !== child;
        }
        if (find(parentChildNodes, hasElementChildThatIsNotChild)) {
          return false;
        }
        var docTypeNode = find(parentChildNodes, isDocTypeNode);
        return !(child && docTypeNode && parentChildNodes.indexOf(docTypeNode) > parentChildNodes.indexOf(child));
      }
      function assertPreInsertionValidity1to5(parent, node, child) {
        if (!hasValidParentNodeType(parent)) {
          throw new DOMException(DOMException.HIERARCHY_REQUEST_ERR, "Unexpected parent node type " + parent.nodeType);
        }
        if (child && child.parentNode !== parent) {
          throw new DOMException(DOMException.NOT_FOUND_ERR, "child not in parent");
        }
        if (
          // 4. If `node` is not a DocumentFragment, DocumentType, Element, or CharacterData node, then throw a "HierarchyRequestError" DOMException.
          !hasInsertableNodeType(node) || // 5. If either `node` is a Text node and `parent` is a document,
          // the sax parser currently adds top level text nodes, this will be fixed in 0.9.0
          // || (node.nodeType === Node.TEXT_NODE && parent.nodeType === Node.DOCUMENT_NODE)
          // or `node` is a doctype and `parent` is not a document, then throw a "HierarchyRequestError" DOMException.
          isDocTypeNode(node) && parent.nodeType !== Node.DOCUMENT_NODE
        ) {
          throw new DOMException(
            DOMException.HIERARCHY_REQUEST_ERR,
            "Unexpected node type " + node.nodeType + " for parent node type " + parent.nodeType
          );
        }
      }
      function assertPreInsertionValidityInDocument(parent, node, child) {
        var parentChildNodes = parent.childNodes || [];
        var nodeChildNodes = node.childNodes || [];
        if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
          var nodeChildElements = nodeChildNodes.filter(isElementNode);
          if (nodeChildElements.length > 1 || find(nodeChildNodes, isTextNode)) {
            throw new DOMException(DOMException.HIERARCHY_REQUEST_ERR, "More than one element or text in fragment");
          }
          if (nodeChildElements.length === 1 && !isElementInsertionPossible(parent, child)) {
            throw new DOMException(DOMException.HIERARCHY_REQUEST_ERR, "Element in fragment can not be inserted before doctype");
          }
        }
        if (isElementNode(node)) {
          if (!isElementInsertionPossible(parent, child)) {
            throw new DOMException(DOMException.HIERARCHY_REQUEST_ERR, "Only one element can be added and only after doctype");
          }
        }
        if (isDocTypeNode(node)) {
          if (find(parentChildNodes, isDocTypeNode)) {
            throw new DOMException(DOMException.HIERARCHY_REQUEST_ERR, "Only one doctype is allowed");
          }
          var parentElementChild = find(parentChildNodes, isElementNode);
          if (child && parentChildNodes.indexOf(parentElementChild) < parentChildNodes.indexOf(child)) {
            throw new DOMException(DOMException.HIERARCHY_REQUEST_ERR, "Doctype can only be inserted before an element");
          }
          if (!child && parentElementChild) {
            throw new DOMException(DOMException.HIERARCHY_REQUEST_ERR, "Doctype can not be appended since element is present");
          }
        }
      }
      function assertPreReplacementValidityInDocument(parent, node, child) {
        var parentChildNodes = parent.childNodes || [];
        var nodeChildNodes = node.childNodes || [];
        if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
          var nodeChildElements = nodeChildNodes.filter(isElementNode);
          if (nodeChildElements.length > 1 || find(nodeChildNodes, isTextNode)) {
            throw new DOMException(DOMException.HIERARCHY_REQUEST_ERR, "More than one element or text in fragment");
          }
          if (nodeChildElements.length === 1 && !isElementReplacementPossible(parent, child)) {
            throw new DOMException(DOMException.HIERARCHY_REQUEST_ERR, "Element in fragment can not be inserted before doctype");
          }
        }
        if (isElementNode(node)) {
          if (!isElementReplacementPossible(parent, child)) {
            throw new DOMException(DOMException.HIERARCHY_REQUEST_ERR, "Only one element can be added and only after doctype");
          }
        }
        if (isDocTypeNode(node)) {
          let hasDoctypeChildThatIsNotChild = function(node2) {
            return isDocTypeNode(node2) && node2 !== child;
          };
          if (find(parentChildNodes, hasDoctypeChildThatIsNotChild)) {
            throw new DOMException(DOMException.HIERARCHY_REQUEST_ERR, "Only one doctype is allowed");
          }
          var parentElementChild = find(parentChildNodes, isElementNode);
          if (child && parentChildNodes.indexOf(parentElementChild) < parentChildNodes.indexOf(child)) {
            throw new DOMException(DOMException.HIERARCHY_REQUEST_ERR, "Doctype can only be inserted before an element");
          }
        }
      }
      function _insertBefore(parent, node, child, _inDocumentAssertion) {
        assertPreInsertionValidity1to5(parent, node, child);
        if (parent.nodeType === Node.DOCUMENT_NODE) {
          (_inDocumentAssertion || assertPreInsertionValidityInDocument)(parent, node, child);
        }
        var cp = node.parentNode;
        if (cp) {
          cp.removeChild(node);
        }
        if (node.nodeType === DOCUMENT_FRAGMENT_NODE) {
          var newFirst = node.firstChild;
          if (newFirst == null) {
            return node;
          }
          var newLast = node.lastChild;
        } else {
          newFirst = newLast = node;
        }
        var pre = child ? child.previousSibling : parent.lastChild;
        newFirst.previousSibling = pre;
        newLast.nextSibling = child;
        if (pre) {
          pre.nextSibling = newFirst;
        } else {
          parent.firstChild = newFirst;
        }
        if (child == null) {
          parent.lastChild = newLast;
        } else {
          child.previousSibling = newLast;
        }
        do {
          newFirst.parentNode = parent;
        } while (newFirst !== newLast && (newFirst = newFirst.nextSibling));
        _onUpdateChild(parent.ownerDocument || parent, parent, node);
        if (node.nodeType == DOCUMENT_FRAGMENT_NODE) {
          node.firstChild = node.lastChild = null;
        }
        return node;
      }
      Document.prototype = {
        /**
         * The implementation that created this document.
         *
         * @type DOMImplementation
         * @readonly
         */
        implementation: null,
        nodeName: "#document",
        nodeType: DOCUMENT_NODE,
        /**
         * The DocumentType node of the document.
         *
         * @type DocumentType
         * @readonly
         */
        doctype: null,
        documentElement: null,
        _inc: 1,
        insertBefore: function(newChild, refChild) {
          if (newChild.nodeType === DOCUMENT_FRAGMENT_NODE) {
            var child = newChild.firstChild;
            while (child) {
              var next = child.nextSibling;
              this.insertBefore(child, refChild);
              child = next;
            }
            return newChild;
          }
          _insertBefore(this, newChild, refChild);
          newChild.ownerDocument = this;
          if (this.documentElement === null && newChild.nodeType === ELEMENT_NODE) {
            this.documentElement = newChild;
          }
          return newChild;
        },
        removeChild: function(oldChild) {
          var removed = _removeChild(this, oldChild);
          if (removed === this.documentElement) {
            this.documentElement = null;
          }
          return removed;
        },
        replaceChild: function(newChild, oldChild) {
          _insertBefore(this, newChild, oldChild, assertPreReplacementValidityInDocument);
          newChild.ownerDocument = this;
          if (oldChild) {
            this.removeChild(oldChild);
          }
          if (isElementNode(newChild)) {
            this.documentElement = newChild;
          }
        },
        // Introduced in DOM Level 2:
        importNode: function(importedNode, deep) {
          return importNode(this, importedNode, deep);
        },
        // Introduced in DOM Level 2:
        getElementById: function(id) {
          var rtv = null;
          _visitNode(this.documentElement, function(node) {
            if (node.nodeType == ELEMENT_NODE) {
              if (node.getAttribute("id") == id) {
                rtv = node;
                return true;
              }
            }
          });
          return rtv;
        },
        /**
         * Creates a new `Element` that is owned by this `Document`.
         * In HTML Documents `localName` is the lower cased `tagName`,
         * otherwise no transformation is being applied.
         * When `contentType` implies the HTML namespace, it will be set as `namespaceURI`.
         *
         * __This implementation differs from the specification:__ - The provided name is not checked
         * against the `Name` production,
         * so no related error will be thrown.
         * - There is no interface `HTMLElement`, it is always an `Element`.
         * - There is no support for a second argument to indicate using custom elements.
         *
         * @param {string} tagName
         * @returns {Element}
         * @see https://developer.mozilla.org/en-US/docs/Web/API/Document/createElement
         * @see https://dom.spec.whatwg.org/#dom-document-createelement
         * @see https://dom.spec.whatwg.org/#concept-create-element
         */
        createElement: function(tagName) {
          var node = new Element(PDC);
          node.ownerDocument = this;
          if (this.type === "html") {
            tagName = tagName.toLowerCase();
          }
          if (hasDefaultHTMLNamespace(this.contentType)) {
            node.namespaceURI = NAMESPACE.HTML;
          }
          node.nodeName = tagName;
          node.tagName = tagName;
          node.localName = tagName;
          node.childNodes = new NodeList();
          var attrs = node.attributes = new NamedNodeMap();
          attrs._ownerElement = node;
          return node;
        },
        /**
         * @returns {DocumentFragment}
         */
        createDocumentFragment: function() {
          var node = new DocumentFragment(PDC);
          node.ownerDocument = this;
          node.childNodes = new NodeList();
          return node;
        },
        /**
         * @param {string} data
         * @returns {Text}
         */
        createTextNode: function(data) {
          var node = new Text(PDC);
          node.ownerDocument = this;
          node.childNodes = new NodeList();
          node.appendData(data);
          return node;
        },
        /**
         * @param {string} data
         * @returns {Comment}
         */
        createComment: function(data) {
          var node = new Comment(PDC);
          node.ownerDocument = this;
          node.childNodes = new NodeList();
          node.appendData(data);
          return node;
        },
        /**
         * @param {string} data
         * @returns {CDATASection}
         */
        createCDATASection: function(data) {
          var node = new CDATASection(PDC);
          node.ownerDocument = this;
          node.childNodes = new NodeList();
          node.appendData(data);
          return node;
        },
        /**
         * @param {string} target
         * @param {string} data
         * @returns {ProcessingInstruction}
         */
        createProcessingInstruction: function(target, data) {
          var node = new ProcessingInstruction(PDC);
          node.ownerDocument = this;
          node.childNodes = new NodeList();
          node.nodeName = node.target = target;
          node.nodeValue = node.data = data;
          return node;
        },
        /**
         * Creates an `Attr` node that is owned by this document.
         * In HTML Documents `localName` is the lower cased `name`,
         * otherwise no transformation is being applied.
         *
         * __This implementation differs from the specification:__ - The provided name is not checked
         * against the `Name` production,
         * so no related error will be thrown.
         *
         * @param {string} name
         * @returns {Attr}
         * @see https://developer.mozilla.org/en-US/docs/Web/API/Document/createAttribute
         * @see https://dom.spec.whatwg.org/#dom-document-createattribute
         */
        createAttribute: function(name) {
          if (!g.QName_exact.test(name)) {
            throw new DOMException(DOMException.INVALID_CHARACTER_ERR, 'invalid character in name "' + name + '"');
          }
          if (this.type === "html") {
            name = name.toLowerCase();
          }
          return this._createAttribute(name);
        },
        _createAttribute: function(name) {
          var node = new Attr(PDC);
          node.ownerDocument = this;
          node.childNodes = new NodeList();
          node.name = name;
          node.nodeName = name;
          node.localName = name;
          node.specified = true;
          return node;
        },
        /**
         * Creates an EntityReference object.
         * The current implementation does not fill the `childNodes` with those of the corresponding
         * `Entity`
         *
         * @deprecated
         * In DOM Level 4.
         * @param {string} name
         * The name of the entity to reference. No namespace well-formedness checks are performed.
         * @returns {EntityReference}
         * @throws {DOMException}
         * With code `INVALID_CHARACTER_ERR` when `name` is not valid.
         * @throws {DOMException}
         * with code `NOT_SUPPORTED_ERR` when the document is of type `html`
         * @see https://www.w3.org/TR/DOM-Level-3-Core/core.html#ID-392B75AE
         */
        createEntityReference: function(name) {
          if (!g.Name.test(name)) {
            throw new DOMException(DOMException.INVALID_CHARACTER_ERR, 'not a valid xml name "' + name + '"');
          }
          if (this.type === "html") {
            throw new DOMException("document is an html document", DOMExceptionName.NotSupportedError);
          }
          var node = new EntityReference(PDC);
          node.ownerDocument = this;
          node.childNodes = new NodeList();
          node.nodeName = name;
          return node;
        },
        // Introduced in DOM Level 2:
        /**
         * @param {string} namespaceURI
         * @param {string} qualifiedName
         * @returns {Element}
         */
        createElementNS: function(namespaceURI, qualifiedName) {
          var validated = validateAndExtract(namespaceURI, qualifiedName);
          var node = new Element(PDC);
          var attrs = node.attributes = new NamedNodeMap();
          node.childNodes = new NodeList();
          node.ownerDocument = this;
          node.nodeName = qualifiedName;
          node.tagName = qualifiedName;
          node.namespaceURI = validated[0];
          node.prefix = validated[1];
          node.localName = validated[2];
          attrs._ownerElement = node;
          return node;
        },
        // Introduced in DOM Level 2:
        /**
         * @param {string} namespaceURI
         * @param {string} qualifiedName
         * @returns {Attr}
         */
        createAttributeNS: function(namespaceURI, qualifiedName) {
          var validated = validateAndExtract(namespaceURI, qualifiedName);
          var node = new Attr(PDC);
          node.ownerDocument = this;
          node.childNodes = new NodeList();
          node.nodeName = qualifiedName;
          node.name = qualifiedName;
          node.specified = true;
          node.namespaceURI = validated[0];
          node.prefix = validated[1];
          node.localName = validated[2];
          return node;
        }
      };
      _extends(Document, Node);
      function Element(symbol) {
        checkSymbol(symbol);
        this._nsMap = /* @__PURE__ */ Object.create(null);
      }
      Element.prototype = {
        nodeType: ELEMENT_NODE,
        /**
         * The attributes of this element.
         *
         * @type {NamedNodeMap | null}
         */
        attributes: null,
        getQualifiedName: function() {
          return this.prefix ? this.prefix + ":" + this.localName : this.localName;
        },
        _isInHTMLDocumentAndNamespace: function() {
          return this.ownerDocument.type === "html" && this.namespaceURI === NAMESPACE.HTML;
        },
        /**
         * Implementaton of Level2 Core function hasAttributes.
         *
         * @returns {boolean}
         * True if attribute list is not empty.
         * @see https://www.w3.org/TR/DOM-Level-2-Core/#core-ID-NodeHasAttrs
         */
        hasAttributes: function() {
          return !!(this.attributes && this.attributes.length);
        },
        hasAttribute: function(name) {
          return !!this.getAttributeNode(name);
        },
        /**
         * Returns element’s first attribute whose qualified name is `name`, and `null`
         * if there is no such attribute.
         *
         * @param {string} name
         * @returns {string | null}
         */
        getAttribute: function(name) {
          var attr = this.getAttributeNode(name);
          return attr ? attr.value : null;
        },
        getAttributeNode: function(name) {
          if (this._isInHTMLDocumentAndNamespace()) {
            name = name.toLowerCase();
          }
          return this.attributes.getNamedItem(name);
        },
        /**
         * Sets the value of element’s first attribute whose qualified name is qualifiedName to value.
         *
         * @param {string} name
         * @param {string} value
         */
        setAttribute: function(name, value) {
          if (this._isInHTMLDocumentAndNamespace()) {
            name = name.toLowerCase();
          }
          var attr = this.getAttributeNode(name);
          if (attr) {
            attr.value = attr.nodeValue = "" + value;
          } else {
            attr = this.ownerDocument._createAttribute(name);
            attr.value = attr.nodeValue = "" + value;
            this.setAttributeNode(attr);
          }
        },
        removeAttribute: function(name) {
          var attr = this.getAttributeNode(name);
          attr && this.removeAttributeNode(attr);
        },
        setAttributeNode: function(newAttr) {
          return this.attributes.setNamedItem(newAttr);
        },
        setAttributeNodeNS: function(newAttr) {
          return this.attributes.setNamedItemNS(newAttr);
        },
        removeAttributeNode: function(oldAttr) {
          return this.attributes.removeNamedItem(oldAttr.nodeName);
        },
        //get real attribute name,and remove it by removeAttributeNode
        removeAttributeNS: function(namespaceURI, localName) {
          var old = this.getAttributeNodeNS(namespaceURI, localName);
          old && this.removeAttributeNode(old);
        },
        hasAttributeNS: function(namespaceURI, localName) {
          return this.getAttributeNodeNS(namespaceURI, localName) != null;
        },
        /**
         * Returns element’s attribute whose namespace is `namespaceURI` and local name is
         * `localName`,
         * or `null` if there is no such attribute.
         *
         * @param {string} namespaceURI
         * @param {string} localName
         * @returns {string | null}
         */
        getAttributeNS: function(namespaceURI, localName) {
          var attr = this.getAttributeNodeNS(namespaceURI, localName);
          return attr ? attr.value : null;
        },
        /**
         * Sets the value of element’s attribute whose namespace is `namespaceURI` and local name is
         * `localName` to value.
         *
         * @param {string} namespaceURI
         * @param {string} qualifiedName
         * @param {string} value
         * @see https://dom.spec.whatwg.org/#dom-element-setattributens
         */
        setAttributeNS: function(namespaceURI, qualifiedName, value) {
          var validated = validateAndExtract(namespaceURI, qualifiedName);
          var localName = validated[2];
          var attr = this.getAttributeNodeNS(namespaceURI, localName);
          if (attr) {
            attr.value = attr.nodeValue = "" + value;
          } else {
            attr = this.ownerDocument.createAttributeNS(namespaceURI, qualifiedName);
            attr.value = attr.nodeValue = "" + value;
            this.setAttributeNode(attr);
          }
        },
        getAttributeNodeNS: function(namespaceURI, localName) {
          return this.attributes.getNamedItemNS(namespaceURI, localName);
        },
        /**
         * Returns a LiveNodeList of all child elements which have **all** of the given class name(s).
         *
         * Returns an empty list if `classNames` is an empty string or only contains HTML white space
         * characters.
         *
         * Warning: This returns a live LiveNodeList.
         * Changes in the DOM will reflect in the array as the changes occur.
         * If an element selected by this array no longer qualifies for the selector,
         * it will automatically be removed. Be aware of this for iteration purposes.
         *
         * @param {string} classNames
         * Is a string representing the class name(s) to match; multiple class names are separated by
         * (ASCII-)whitespace.
         * @see https://developer.mozilla.org/en-US/docs/Web/API/Element/getElementsByClassName
         * @see https://developer.mozilla.org/en-US/docs/Web/API/Document/getElementsByClassName
         * @see https://dom.spec.whatwg.org/#concept-getelementsbyclassname
         */
        getElementsByClassName: function(classNames) {
          var classNamesSet = toOrderedSet(classNames);
          return new LiveNodeList(this, function(base) {
            var ls = [];
            if (classNamesSet.length > 0) {
              _visitNode(base, function(node) {
                if (node !== base && node.nodeType === ELEMENT_NODE) {
                  var nodeClassNames = node.getAttribute("class");
                  if (nodeClassNames) {
                    var matches = classNames === nodeClassNames;
                    if (!matches) {
                      var nodeClassNamesSet = toOrderedSet(nodeClassNames);
                      matches = classNamesSet.every(arrayIncludes(nodeClassNamesSet));
                    }
                    if (matches) {
                      ls.push(node);
                    }
                  }
                }
              });
            }
            return ls;
          });
        },
        /**
         * Returns a LiveNodeList of elements with the given qualifiedName.
         * Searching for all descendants can be done by passing `*` as `qualifiedName`.
         *
         * All descendants of the specified element are searched, but not the element itself.
         * The returned list is live, which means it updates itself with the DOM tree automatically.
         * Therefore, there is no need to call `Element.getElementsByTagName()`
         * with the same element and arguments repeatedly if the DOM changes in between calls.
         *
         * When called on an HTML element in an HTML document,
         * `getElementsByTagName` lower-cases the argument before searching for it.
         * This is undesirable when trying to match camel-cased SVG elements (such as
         * `<linearGradient>`) in an HTML document.
         * Instead, use `Element.getElementsByTagNameNS()`,
         * which preserves the capitalization of the tag name.
         *
         * `Element.getElementsByTagName` is similar to `Document.getElementsByTagName()`,
         * except that it only searches for elements that are descendants of the specified element.
         *
         * @param {string} qualifiedName
         * @returns {LiveNodeList}
         * @see https://developer.mozilla.org/en-US/docs/Web/API/Element/getElementsByTagName
         * @see https://dom.spec.whatwg.org/#concept-getelementsbytagname
         */
        getElementsByTagName: function(qualifiedName) {
          var isHTMLDocument = (this.nodeType === DOCUMENT_NODE ? this : this.ownerDocument).type === "html";
          var lowerQualifiedName = qualifiedName.toLowerCase();
          return new LiveNodeList(this, function(base) {
            var ls = [];
            _visitNode(base, function(node) {
              if (node === base || node.nodeType !== ELEMENT_NODE) {
                return;
              }
              if (qualifiedName === "*") {
                ls.push(node);
              } else {
                var nodeQualifiedName = node.getQualifiedName();
                var matchingQName = isHTMLDocument && node.namespaceURI === NAMESPACE.HTML ? lowerQualifiedName : qualifiedName;
                if (nodeQualifiedName === matchingQName) {
                  ls.push(node);
                }
              }
            });
            return ls;
          });
        },
        getElementsByTagNameNS: function(namespaceURI, localName) {
          return new LiveNodeList(this, function(base) {
            var ls = [];
            _visitNode(base, function(node) {
              if (node !== base && node.nodeType === ELEMENT_NODE && (namespaceURI === "*" || node.namespaceURI === namespaceURI) && (localName === "*" || node.localName == localName)) {
                ls.push(node);
              }
            });
            return ls;
          });
        }
      };
      Document.prototype.getElementsByClassName = Element.prototype.getElementsByClassName;
      Document.prototype.getElementsByTagName = Element.prototype.getElementsByTagName;
      Document.prototype.getElementsByTagNameNS = Element.prototype.getElementsByTagNameNS;
      _extends(Element, Node);
      function Attr(symbol) {
        checkSymbol(symbol);
        this.namespaceURI = null;
        this.prefix = null;
        this.ownerElement = null;
      }
      Attr.prototype.nodeType = ATTRIBUTE_NODE;
      _extends(Attr, Node);
      function CharacterData(symbol) {
        checkSymbol(symbol);
      }
      CharacterData.prototype = {
        data: "",
        substringData: function(offset, count) {
          return this.data.substring(offset, offset + count);
        },
        appendData: function(text) {
          text = this.data + text;
          this.nodeValue = this.data = text;
          this.length = text.length;
        },
        insertData: function(offset, text) {
          this.replaceData(offset, 0, text);
        },
        deleteData: function(offset, count) {
          this.replaceData(offset, count, "");
        },
        replaceData: function(offset, count, text) {
          var start = this.data.substring(0, offset);
          var end = this.data.substring(offset + count);
          text = start + text + end;
          this.nodeValue = this.data = text;
          this.length = text.length;
        }
      };
      _extends(CharacterData, Node);
      function Text(symbol) {
        checkSymbol(symbol);
      }
      Text.prototype = {
        nodeName: "#text",
        nodeType: TEXT_NODE,
        splitText: function(offset) {
          var text = this.data;
          var newText = text.substring(offset);
          text = text.substring(0, offset);
          this.data = this.nodeValue = text;
          this.length = text.length;
          var newNode = this.ownerDocument.createTextNode(newText);
          if (this.parentNode) {
            this.parentNode.insertBefore(newNode, this.nextSibling);
          }
          return newNode;
        }
      };
      _extends(Text, CharacterData);
      function Comment(symbol) {
        checkSymbol(symbol);
      }
      Comment.prototype = {
        nodeName: "#comment",
        nodeType: COMMENT_NODE
      };
      _extends(Comment, CharacterData);
      function CDATASection(symbol) {
        checkSymbol(symbol);
      }
      CDATASection.prototype = {
        nodeName: "#cdata-section",
        nodeType: CDATA_SECTION_NODE
      };
      _extends(CDATASection, Text);
      function DocumentType(symbol) {
        checkSymbol(symbol);
      }
      DocumentType.prototype.nodeType = DOCUMENT_TYPE_NODE;
      _extends(DocumentType, Node);
      function Notation(symbol) {
        checkSymbol(symbol);
      }
      Notation.prototype.nodeType = NOTATION_NODE;
      _extends(Notation, Node);
      function Entity(symbol) {
        checkSymbol(symbol);
      }
      Entity.prototype.nodeType = ENTITY_NODE;
      _extends(Entity, Node);
      function EntityReference(symbol) {
        checkSymbol(symbol);
      }
      EntityReference.prototype.nodeType = ENTITY_REFERENCE_NODE;
      _extends(EntityReference, Node);
      function DocumentFragment(symbol) {
        checkSymbol(symbol);
      }
      DocumentFragment.prototype.nodeName = "#document-fragment";
      DocumentFragment.prototype.nodeType = DOCUMENT_FRAGMENT_NODE;
      _extends(DocumentFragment, Node);
      function ProcessingInstruction(symbol) {
        checkSymbol(symbol);
      }
      ProcessingInstruction.prototype.nodeType = PROCESSING_INSTRUCTION_NODE;
      _extends(ProcessingInstruction, CharacterData);
      function XMLSerializer() {
      }
      XMLSerializer.prototype.serializeToString = function(node, nodeFilter) {
        return nodeSerializeToString.call(node, nodeFilter);
      };
      Node.prototype.toString = nodeSerializeToString;
      function nodeSerializeToString(nodeFilter) {
        var buf = [];
        var refNode = this.nodeType === DOCUMENT_NODE && this.documentElement || this;
        var prefix = refNode.prefix;
        var uri = refNode.namespaceURI;
        if (uri && prefix == null) {
          var prefix = refNode.lookupPrefix(uri);
          if (prefix == null) {
            var visibleNamespaces = [
              { namespace: uri, prefix: null }
              //{namespace:uri,prefix:''}
            ];
          }
        }
        serializeToString(this, buf, nodeFilter, visibleNamespaces);
        return buf.join("");
      }
      function needNamespaceDefine(node, isHTML, visibleNamespaces) {
        var prefix = node.prefix || "";
        var uri = node.namespaceURI;
        if (!uri) {
          return false;
        }
        if (prefix === "xml" && uri === NAMESPACE.XML || uri === NAMESPACE.XMLNS) {
          return false;
        }
        var i = visibleNamespaces.length;
        while (i--) {
          var ns = visibleNamespaces[i];
          if (ns.prefix === prefix) {
            return ns.namespace !== uri;
          }
        }
        return true;
      }
      function addSerializedAttribute(buf, qualifiedName, value) {
        buf.push(" ", qualifiedName, '="', value.replace(/[<>&"\t\n\r]/g, _xmlEncoder), '"');
      }
      function serializeToString(node, buf, nodeFilter, visibleNamespaces) {
        if (!visibleNamespaces) {
          visibleNamespaces = [];
        }
        var doc = node.nodeType === DOCUMENT_NODE ? node : node.ownerDocument;
        var isHTML = doc.type === "html";
        if (nodeFilter) {
          node = nodeFilter(node);
          if (node) {
            if (typeof node == "string") {
              buf.push(node);
              return;
            }
          } else {
            return;
          }
        }
        switch (node.nodeType) {
          case ELEMENT_NODE:
            var attrs = node.attributes;
            var len = attrs.length;
            var child = node.firstChild;
            var nodeName = node.tagName;
            var prefixedNodeName = nodeName;
            if (!isHTML && !node.prefix && node.namespaceURI) {
              var defaultNS;
              for (var ai = 0; ai < attrs.length; ai++) {
                if (attrs.item(ai).name === "xmlns") {
                  defaultNS = attrs.item(ai).value;
                  break;
                }
              }
              if (!defaultNS) {
                for (var nsi = visibleNamespaces.length - 1; nsi >= 0; nsi--) {
                  var namespace = visibleNamespaces[nsi];
                  if (namespace.prefix === "" && namespace.namespace === node.namespaceURI) {
                    defaultNS = namespace.namespace;
                    break;
                  }
                }
              }
              if (defaultNS !== node.namespaceURI) {
                for (var nsi = visibleNamespaces.length - 1; nsi >= 0; nsi--) {
                  var namespace = visibleNamespaces[nsi];
                  if (namespace.namespace === node.namespaceURI) {
                    if (namespace.prefix) {
                      prefixedNodeName = namespace.prefix + ":" + nodeName;
                    }
                    break;
                  }
                }
              }
            }
            buf.push("<", prefixedNodeName);
            for (var i = 0; i < len; i++) {
              var attr = attrs.item(i);
              if (attr.prefix == "xmlns") {
                visibleNamespaces.push({
                  prefix: attr.localName,
                  namespace: attr.value
                });
              } else if (attr.nodeName == "xmlns") {
                visibleNamespaces.push({ prefix: "", namespace: attr.value });
              }
            }
            for (var i = 0; i < len; i++) {
              var attr = attrs.item(i);
              if (needNamespaceDefine(attr, isHTML, visibleNamespaces)) {
                var prefix = attr.prefix || "";
                var uri = attr.namespaceURI;
                addSerializedAttribute(buf, prefix ? "xmlns:" + prefix : "xmlns", uri);
                visibleNamespaces.push({ prefix, namespace: uri });
              }
              serializeToString(attr, buf, nodeFilter, visibleNamespaces);
            }
            if (nodeName === prefixedNodeName && needNamespaceDefine(node, isHTML, visibleNamespaces)) {
              var prefix = node.prefix || "";
              var uri = node.namespaceURI;
              addSerializedAttribute(buf, prefix ? "xmlns:" + prefix : "xmlns", uri);
              visibleNamespaces.push({ prefix, namespace: uri });
            }
            var canCloseTag = !child;
            if (canCloseTag && (isHTML || node.namespaceURI === NAMESPACE.HTML)) {
              canCloseTag = isHTMLVoidElement(nodeName);
            }
            if (canCloseTag) {
              buf.push("/>");
            } else {
              buf.push(">");
              if (isHTML && isHTMLRawTextElement(nodeName)) {
                while (child) {
                  if (child.data) {
                    buf.push(child.data);
                  } else {
                    serializeToString(child, buf, nodeFilter, visibleNamespaces.slice());
                  }
                  child = child.nextSibling;
                }
              } else {
                while (child) {
                  serializeToString(child, buf, nodeFilter, visibleNamespaces.slice());
                  child = child.nextSibling;
                }
              }
              buf.push("</", prefixedNodeName, ">");
            }
            return;
          case DOCUMENT_NODE:
          case DOCUMENT_FRAGMENT_NODE:
            var child = node.firstChild;
            while (child) {
              serializeToString(child, buf, nodeFilter, visibleNamespaces.slice());
              child = child.nextSibling;
            }
            return;
          case ATTRIBUTE_NODE:
            return addSerializedAttribute(buf, node.name, node.value);
          case TEXT_NODE:
            return buf.push(node.data.replace(/[<&>]/g, _xmlEncoder));
          case CDATA_SECTION_NODE:
            return buf.push(g.CDATA_START, node.data, g.CDATA_END);
          case COMMENT_NODE:
            return buf.push(g.COMMENT_START, node.data, g.COMMENT_END);
          case DOCUMENT_TYPE_NODE:
            var pubid = node.publicId;
            var sysid = node.systemId;
            buf.push(g.DOCTYPE_DECL_START, " ", node.name);
            if (pubid) {
              buf.push(" ", g.PUBLIC, " ", pubid);
              if (sysid && sysid !== ".") {
                buf.push(" ", sysid);
              }
            } else if (sysid && sysid !== ".") {
              buf.push(" ", g.SYSTEM, " ", sysid);
            }
            if (node.internalSubset) {
              buf.push(" [", node.internalSubset, "]");
            }
            buf.push(">");
            return;
          case PROCESSING_INSTRUCTION_NODE:
            return buf.push("<?", node.target, " ", node.data, "?>");
          case ENTITY_REFERENCE_NODE:
            return buf.push("&", node.nodeName, ";");
          //case ENTITY_NODE:
          //case NOTATION_NODE:
          default:
            buf.push("??", node.nodeName);
        }
      }
      function importNode(doc, node, deep) {
        var node2;
        switch (node.nodeType) {
          case ELEMENT_NODE:
            node2 = node.cloneNode(false);
            node2.ownerDocument = doc;
          //var attrs = node2.attributes;
          //var len = attrs.length;
          //for(var i=0;i<len;i++){
          //node2.setAttributeNodeNS(importNode(doc,attrs.item(i),deep));
          //}
          case DOCUMENT_FRAGMENT_NODE:
            break;
          case ATTRIBUTE_NODE:
            deep = true;
            break;
        }
        if (!node2) {
          node2 = node.cloneNode(false);
        }
        node2.ownerDocument = doc;
        node2.parentNode = null;
        if (deep) {
          var child = node.firstChild;
          while (child) {
            node2.appendChild(importNode(doc, child, deep));
            child = child.nextSibling;
          }
        }
        return node2;
      }
      function cloneNode(doc, node, deep) {
        var node2 = new node.constructor(PDC);
        for (var n in node) {
          if (hasOwn(node, n)) {
            var v = node[n];
            if (typeof v != "object") {
              if (v != node2[n]) {
                node2[n] = v;
              }
            }
          }
        }
        if (node.childNodes) {
          node2.childNodes = new NodeList();
        }
        node2.ownerDocument = doc;
        switch (node2.nodeType) {
          case ELEMENT_NODE:
            var attrs = node.attributes;
            var attrs2 = node2.attributes = new NamedNodeMap();
            var len = attrs.length;
            attrs2._ownerElement = node2;
            for (var i = 0; i < len; i++) {
              node2.setAttributeNode(cloneNode(doc, attrs.item(i), true));
            }
            break;
          case ATTRIBUTE_NODE:
            deep = true;
        }
        if (deep) {
          var child = node.firstChild;
          while (child) {
            node2.appendChild(cloneNode(doc, child, deep));
            child = child.nextSibling;
          }
        }
        return node2;
      }
      function __set__(object, key, value) {
        object[key] = value;
      }
      try {
        if (Object.defineProperty) {
          let getTextContent = function(node) {
            switch (node.nodeType) {
              case ELEMENT_NODE:
              case DOCUMENT_FRAGMENT_NODE:
                var buf = [];
                node = node.firstChild;
                while (node) {
                  if (node.nodeType !== 7 && node.nodeType !== 8) {
                    buf.push(getTextContent(node));
                  }
                  node = node.nextSibling;
                }
                return buf.join("");
              default:
                return node.nodeValue;
            }
          };
          Object.defineProperty(LiveNodeList.prototype, "length", {
            get: function() {
              _updateLiveList(this);
              return this.$$length;
            }
          });
          Object.defineProperty(Node.prototype, "textContent", {
            get: function() {
              return getTextContent(this);
            },
            set: function(data) {
              switch (this.nodeType) {
                case ELEMENT_NODE:
                case DOCUMENT_FRAGMENT_NODE:
                  while (this.firstChild) {
                    this.removeChild(this.firstChild);
                  }
                  if (data || String(data)) {
                    this.appendChild(this.ownerDocument.createTextNode(data));
                  }
                  break;
                default:
                  this.data = data;
                  this.value = data;
                  this.nodeValue = data;
              }
            }
          });
          __set__ = function(object, key, value) {
            object["$$" + key] = value;
          };
        }
      } catch (e) {
      }
      exports._updateLiveList = _updateLiveList;
      exports.Attr = Attr;
      exports.CDATASection = CDATASection;
      exports.CharacterData = CharacterData;
      exports.Comment = Comment;
      exports.Document = Document;
      exports.DocumentFragment = DocumentFragment;
      exports.DocumentType = DocumentType;
      exports.DOMImplementation = DOMImplementation;
      exports.Element = Element;
      exports.Entity = Entity;
      exports.EntityReference = EntityReference;
      exports.LiveNodeList = LiveNodeList;
      exports.NamedNodeMap = NamedNodeMap;
      exports.Node = Node;
      exports.NodeList = NodeList;
      exports.Notation = Notation;
      exports.Text = Text;
      exports.ProcessingInstruction = ProcessingInstruction;
      exports.XMLSerializer = XMLSerializer;
    }
  });

  // node_modules/@xmldom/xmldom/lib/entities.js
  var require_entities = __commonJS({
    "node_modules/@xmldom/xmldom/lib/entities.js"(exports) {
      "use strict";
      var freeze = require_conventions().freeze;
      exports.XML_ENTITIES = freeze({
        amp: "&",
        apos: "'",
        gt: ">",
        lt: "<",
        quot: '"'
      });
      exports.HTML_ENTITIES = freeze({
        Aacute: "\xC1",
        aacute: "\xE1",
        Abreve: "\u0102",
        abreve: "\u0103",
        ac: "\u223E",
        acd: "\u223F",
        acE: "\u223E\u0333",
        Acirc: "\xC2",
        acirc: "\xE2",
        acute: "\xB4",
        Acy: "\u0410",
        acy: "\u0430",
        AElig: "\xC6",
        aelig: "\xE6",
        af: "\u2061",
        Afr: "\u{1D504}",
        afr: "\u{1D51E}",
        Agrave: "\xC0",
        agrave: "\xE0",
        alefsym: "\u2135",
        aleph: "\u2135",
        Alpha: "\u0391",
        alpha: "\u03B1",
        Amacr: "\u0100",
        amacr: "\u0101",
        amalg: "\u2A3F",
        AMP: "&",
        amp: "&",
        And: "\u2A53",
        and: "\u2227",
        andand: "\u2A55",
        andd: "\u2A5C",
        andslope: "\u2A58",
        andv: "\u2A5A",
        ang: "\u2220",
        ange: "\u29A4",
        angle: "\u2220",
        angmsd: "\u2221",
        angmsdaa: "\u29A8",
        angmsdab: "\u29A9",
        angmsdac: "\u29AA",
        angmsdad: "\u29AB",
        angmsdae: "\u29AC",
        angmsdaf: "\u29AD",
        angmsdag: "\u29AE",
        angmsdah: "\u29AF",
        angrt: "\u221F",
        angrtvb: "\u22BE",
        angrtvbd: "\u299D",
        angsph: "\u2222",
        angst: "\xC5",
        angzarr: "\u237C",
        Aogon: "\u0104",
        aogon: "\u0105",
        Aopf: "\u{1D538}",
        aopf: "\u{1D552}",
        ap: "\u2248",
        apacir: "\u2A6F",
        apE: "\u2A70",
        ape: "\u224A",
        apid: "\u224B",
        apos: "'",
        ApplyFunction: "\u2061",
        approx: "\u2248",
        approxeq: "\u224A",
        Aring: "\xC5",
        aring: "\xE5",
        Ascr: "\u{1D49C}",
        ascr: "\u{1D4B6}",
        Assign: "\u2254",
        ast: "*",
        asymp: "\u2248",
        asympeq: "\u224D",
        Atilde: "\xC3",
        atilde: "\xE3",
        Auml: "\xC4",
        auml: "\xE4",
        awconint: "\u2233",
        awint: "\u2A11",
        backcong: "\u224C",
        backepsilon: "\u03F6",
        backprime: "\u2035",
        backsim: "\u223D",
        backsimeq: "\u22CD",
        Backslash: "\u2216",
        Barv: "\u2AE7",
        barvee: "\u22BD",
        Barwed: "\u2306",
        barwed: "\u2305",
        barwedge: "\u2305",
        bbrk: "\u23B5",
        bbrktbrk: "\u23B6",
        bcong: "\u224C",
        Bcy: "\u0411",
        bcy: "\u0431",
        bdquo: "\u201E",
        becaus: "\u2235",
        Because: "\u2235",
        because: "\u2235",
        bemptyv: "\u29B0",
        bepsi: "\u03F6",
        bernou: "\u212C",
        Bernoullis: "\u212C",
        Beta: "\u0392",
        beta: "\u03B2",
        beth: "\u2136",
        between: "\u226C",
        Bfr: "\u{1D505}",
        bfr: "\u{1D51F}",
        bigcap: "\u22C2",
        bigcirc: "\u25EF",
        bigcup: "\u22C3",
        bigodot: "\u2A00",
        bigoplus: "\u2A01",
        bigotimes: "\u2A02",
        bigsqcup: "\u2A06",
        bigstar: "\u2605",
        bigtriangledown: "\u25BD",
        bigtriangleup: "\u25B3",
        biguplus: "\u2A04",
        bigvee: "\u22C1",
        bigwedge: "\u22C0",
        bkarow: "\u290D",
        blacklozenge: "\u29EB",
        blacksquare: "\u25AA",
        blacktriangle: "\u25B4",
        blacktriangledown: "\u25BE",
        blacktriangleleft: "\u25C2",
        blacktriangleright: "\u25B8",
        blank: "\u2423",
        blk12: "\u2592",
        blk14: "\u2591",
        blk34: "\u2593",
        block: "\u2588",
        bne: "=\u20E5",
        bnequiv: "\u2261\u20E5",
        bNot: "\u2AED",
        bnot: "\u2310",
        Bopf: "\u{1D539}",
        bopf: "\u{1D553}",
        bot: "\u22A5",
        bottom: "\u22A5",
        bowtie: "\u22C8",
        boxbox: "\u29C9",
        boxDL: "\u2557",
        boxDl: "\u2556",
        boxdL: "\u2555",
        boxdl: "\u2510",
        boxDR: "\u2554",
        boxDr: "\u2553",
        boxdR: "\u2552",
        boxdr: "\u250C",
        boxH: "\u2550",
        boxh: "\u2500",
        boxHD: "\u2566",
        boxHd: "\u2564",
        boxhD: "\u2565",
        boxhd: "\u252C",
        boxHU: "\u2569",
        boxHu: "\u2567",
        boxhU: "\u2568",
        boxhu: "\u2534",
        boxminus: "\u229F",
        boxplus: "\u229E",
        boxtimes: "\u22A0",
        boxUL: "\u255D",
        boxUl: "\u255C",
        boxuL: "\u255B",
        boxul: "\u2518",
        boxUR: "\u255A",
        boxUr: "\u2559",
        boxuR: "\u2558",
        boxur: "\u2514",
        boxV: "\u2551",
        boxv: "\u2502",
        boxVH: "\u256C",
        boxVh: "\u256B",
        boxvH: "\u256A",
        boxvh: "\u253C",
        boxVL: "\u2563",
        boxVl: "\u2562",
        boxvL: "\u2561",
        boxvl: "\u2524",
        boxVR: "\u2560",
        boxVr: "\u255F",
        boxvR: "\u255E",
        boxvr: "\u251C",
        bprime: "\u2035",
        Breve: "\u02D8",
        breve: "\u02D8",
        brvbar: "\xA6",
        Bscr: "\u212C",
        bscr: "\u{1D4B7}",
        bsemi: "\u204F",
        bsim: "\u223D",
        bsime: "\u22CD",
        bsol: "\\",
        bsolb: "\u29C5",
        bsolhsub: "\u27C8",
        bull: "\u2022",
        bullet: "\u2022",
        bump: "\u224E",
        bumpE: "\u2AAE",
        bumpe: "\u224F",
        Bumpeq: "\u224E",
        bumpeq: "\u224F",
        Cacute: "\u0106",
        cacute: "\u0107",
        Cap: "\u22D2",
        cap: "\u2229",
        capand: "\u2A44",
        capbrcup: "\u2A49",
        capcap: "\u2A4B",
        capcup: "\u2A47",
        capdot: "\u2A40",
        CapitalDifferentialD: "\u2145",
        caps: "\u2229\uFE00",
        caret: "\u2041",
        caron: "\u02C7",
        Cayleys: "\u212D",
        ccaps: "\u2A4D",
        Ccaron: "\u010C",
        ccaron: "\u010D",
        Ccedil: "\xC7",
        ccedil: "\xE7",
        Ccirc: "\u0108",
        ccirc: "\u0109",
        Cconint: "\u2230",
        ccups: "\u2A4C",
        ccupssm: "\u2A50",
        Cdot: "\u010A",
        cdot: "\u010B",
        cedil: "\xB8",
        Cedilla: "\xB8",
        cemptyv: "\u29B2",
        cent: "\xA2",
        CenterDot: "\xB7",
        centerdot: "\xB7",
        Cfr: "\u212D",
        cfr: "\u{1D520}",
        CHcy: "\u0427",
        chcy: "\u0447",
        check: "\u2713",
        checkmark: "\u2713",
        Chi: "\u03A7",
        chi: "\u03C7",
        cir: "\u25CB",
        circ: "\u02C6",
        circeq: "\u2257",
        circlearrowleft: "\u21BA",
        circlearrowright: "\u21BB",
        circledast: "\u229B",
        circledcirc: "\u229A",
        circleddash: "\u229D",
        CircleDot: "\u2299",
        circledR: "\xAE",
        circledS: "\u24C8",
        CircleMinus: "\u2296",
        CirclePlus: "\u2295",
        CircleTimes: "\u2297",
        cirE: "\u29C3",
        cire: "\u2257",
        cirfnint: "\u2A10",
        cirmid: "\u2AEF",
        cirscir: "\u29C2",
        ClockwiseContourIntegral: "\u2232",
        CloseCurlyDoubleQuote: "\u201D",
        CloseCurlyQuote: "\u2019",
        clubs: "\u2663",
        clubsuit: "\u2663",
        Colon: "\u2237",
        colon: ":",
        Colone: "\u2A74",
        colone: "\u2254",
        coloneq: "\u2254",
        comma: ",",
        commat: "@",
        comp: "\u2201",
        compfn: "\u2218",
        complement: "\u2201",
        complexes: "\u2102",
        cong: "\u2245",
        congdot: "\u2A6D",
        Congruent: "\u2261",
        Conint: "\u222F",
        conint: "\u222E",
        ContourIntegral: "\u222E",
        Copf: "\u2102",
        copf: "\u{1D554}",
        coprod: "\u2210",
        Coproduct: "\u2210",
        COPY: "\xA9",
        copy: "\xA9",
        copysr: "\u2117",
        CounterClockwiseContourIntegral: "\u2233",
        crarr: "\u21B5",
        Cross: "\u2A2F",
        cross: "\u2717",
        Cscr: "\u{1D49E}",
        cscr: "\u{1D4B8}",
        csub: "\u2ACF",
        csube: "\u2AD1",
        csup: "\u2AD0",
        csupe: "\u2AD2",
        ctdot: "\u22EF",
        cudarrl: "\u2938",
        cudarrr: "\u2935",
        cuepr: "\u22DE",
        cuesc: "\u22DF",
        cularr: "\u21B6",
        cularrp: "\u293D",
        Cup: "\u22D3",
        cup: "\u222A",
        cupbrcap: "\u2A48",
        CupCap: "\u224D",
        cupcap: "\u2A46",
        cupcup: "\u2A4A",
        cupdot: "\u228D",
        cupor: "\u2A45",
        cups: "\u222A\uFE00",
        curarr: "\u21B7",
        curarrm: "\u293C",
        curlyeqprec: "\u22DE",
        curlyeqsucc: "\u22DF",
        curlyvee: "\u22CE",
        curlywedge: "\u22CF",
        curren: "\xA4",
        curvearrowleft: "\u21B6",
        curvearrowright: "\u21B7",
        cuvee: "\u22CE",
        cuwed: "\u22CF",
        cwconint: "\u2232",
        cwint: "\u2231",
        cylcty: "\u232D",
        Dagger: "\u2021",
        dagger: "\u2020",
        daleth: "\u2138",
        Darr: "\u21A1",
        dArr: "\u21D3",
        darr: "\u2193",
        dash: "\u2010",
        Dashv: "\u2AE4",
        dashv: "\u22A3",
        dbkarow: "\u290F",
        dblac: "\u02DD",
        Dcaron: "\u010E",
        dcaron: "\u010F",
        Dcy: "\u0414",
        dcy: "\u0434",
        DD: "\u2145",
        dd: "\u2146",
        ddagger: "\u2021",
        ddarr: "\u21CA",
        DDotrahd: "\u2911",
        ddotseq: "\u2A77",
        deg: "\xB0",
        Del: "\u2207",
        Delta: "\u0394",
        delta: "\u03B4",
        demptyv: "\u29B1",
        dfisht: "\u297F",
        Dfr: "\u{1D507}",
        dfr: "\u{1D521}",
        dHar: "\u2965",
        dharl: "\u21C3",
        dharr: "\u21C2",
        DiacriticalAcute: "\xB4",
        DiacriticalDot: "\u02D9",
        DiacriticalDoubleAcute: "\u02DD",
        DiacriticalGrave: "`",
        DiacriticalTilde: "\u02DC",
        diam: "\u22C4",
        Diamond: "\u22C4",
        diamond: "\u22C4",
        diamondsuit: "\u2666",
        diams: "\u2666",
        die: "\xA8",
        DifferentialD: "\u2146",
        digamma: "\u03DD",
        disin: "\u22F2",
        div: "\xF7",
        divide: "\xF7",
        divideontimes: "\u22C7",
        divonx: "\u22C7",
        DJcy: "\u0402",
        djcy: "\u0452",
        dlcorn: "\u231E",
        dlcrop: "\u230D",
        dollar: "$",
        Dopf: "\u{1D53B}",
        dopf: "\u{1D555}",
        Dot: "\xA8",
        dot: "\u02D9",
        DotDot: "\u20DC",
        doteq: "\u2250",
        doteqdot: "\u2251",
        DotEqual: "\u2250",
        dotminus: "\u2238",
        dotplus: "\u2214",
        dotsquare: "\u22A1",
        doublebarwedge: "\u2306",
        DoubleContourIntegral: "\u222F",
        DoubleDot: "\xA8",
        DoubleDownArrow: "\u21D3",
        DoubleLeftArrow: "\u21D0",
        DoubleLeftRightArrow: "\u21D4",
        DoubleLeftTee: "\u2AE4",
        DoubleLongLeftArrow: "\u27F8",
        DoubleLongLeftRightArrow: "\u27FA",
        DoubleLongRightArrow: "\u27F9",
        DoubleRightArrow: "\u21D2",
        DoubleRightTee: "\u22A8",
        DoubleUpArrow: "\u21D1",
        DoubleUpDownArrow: "\u21D5",
        DoubleVerticalBar: "\u2225",
        DownArrow: "\u2193",
        Downarrow: "\u21D3",
        downarrow: "\u2193",
        DownArrowBar: "\u2913",
        DownArrowUpArrow: "\u21F5",
        DownBreve: "\u0311",
        downdownarrows: "\u21CA",
        downharpoonleft: "\u21C3",
        downharpoonright: "\u21C2",
        DownLeftRightVector: "\u2950",
        DownLeftTeeVector: "\u295E",
        DownLeftVector: "\u21BD",
        DownLeftVectorBar: "\u2956",
        DownRightTeeVector: "\u295F",
        DownRightVector: "\u21C1",
        DownRightVectorBar: "\u2957",
        DownTee: "\u22A4",
        DownTeeArrow: "\u21A7",
        drbkarow: "\u2910",
        drcorn: "\u231F",
        drcrop: "\u230C",
        Dscr: "\u{1D49F}",
        dscr: "\u{1D4B9}",
        DScy: "\u0405",
        dscy: "\u0455",
        dsol: "\u29F6",
        Dstrok: "\u0110",
        dstrok: "\u0111",
        dtdot: "\u22F1",
        dtri: "\u25BF",
        dtrif: "\u25BE",
        duarr: "\u21F5",
        duhar: "\u296F",
        dwangle: "\u29A6",
        DZcy: "\u040F",
        dzcy: "\u045F",
        dzigrarr: "\u27FF",
        Eacute: "\xC9",
        eacute: "\xE9",
        easter: "\u2A6E",
        Ecaron: "\u011A",
        ecaron: "\u011B",
        ecir: "\u2256",
        Ecirc: "\xCA",
        ecirc: "\xEA",
        ecolon: "\u2255",
        Ecy: "\u042D",
        ecy: "\u044D",
        eDDot: "\u2A77",
        Edot: "\u0116",
        eDot: "\u2251",
        edot: "\u0117",
        ee: "\u2147",
        efDot: "\u2252",
        Efr: "\u{1D508}",
        efr: "\u{1D522}",
        eg: "\u2A9A",
        Egrave: "\xC8",
        egrave: "\xE8",
        egs: "\u2A96",
        egsdot: "\u2A98",
        el: "\u2A99",
        Element: "\u2208",
        elinters: "\u23E7",
        ell: "\u2113",
        els: "\u2A95",
        elsdot: "\u2A97",
        Emacr: "\u0112",
        emacr: "\u0113",
        empty: "\u2205",
        emptyset: "\u2205",
        EmptySmallSquare: "\u25FB",
        emptyv: "\u2205",
        EmptyVerySmallSquare: "\u25AB",
        emsp: "\u2003",
        emsp13: "\u2004",
        emsp14: "\u2005",
        ENG: "\u014A",
        eng: "\u014B",
        ensp: "\u2002",
        Eogon: "\u0118",
        eogon: "\u0119",
        Eopf: "\u{1D53C}",
        eopf: "\u{1D556}",
        epar: "\u22D5",
        eparsl: "\u29E3",
        eplus: "\u2A71",
        epsi: "\u03B5",
        Epsilon: "\u0395",
        epsilon: "\u03B5",
        epsiv: "\u03F5",
        eqcirc: "\u2256",
        eqcolon: "\u2255",
        eqsim: "\u2242",
        eqslantgtr: "\u2A96",
        eqslantless: "\u2A95",
        Equal: "\u2A75",
        equals: "=",
        EqualTilde: "\u2242",
        equest: "\u225F",
        Equilibrium: "\u21CC",
        equiv: "\u2261",
        equivDD: "\u2A78",
        eqvparsl: "\u29E5",
        erarr: "\u2971",
        erDot: "\u2253",
        Escr: "\u2130",
        escr: "\u212F",
        esdot: "\u2250",
        Esim: "\u2A73",
        esim: "\u2242",
        Eta: "\u0397",
        eta: "\u03B7",
        ETH: "\xD0",
        eth: "\xF0",
        Euml: "\xCB",
        euml: "\xEB",
        euro: "\u20AC",
        excl: "!",
        exist: "\u2203",
        Exists: "\u2203",
        expectation: "\u2130",
        ExponentialE: "\u2147",
        exponentiale: "\u2147",
        fallingdotseq: "\u2252",
        Fcy: "\u0424",
        fcy: "\u0444",
        female: "\u2640",
        ffilig: "\uFB03",
        fflig: "\uFB00",
        ffllig: "\uFB04",
        Ffr: "\u{1D509}",
        ffr: "\u{1D523}",
        filig: "\uFB01",
        FilledSmallSquare: "\u25FC",
        FilledVerySmallSquare: "\u25AA",
        fjlig: "fj",
        flat: "\u266D",
        fllig: "\uFB02",
        fltns: "\u25B1",
        fnof: "\u0192",
        Fopf: "\u{1D53D}",
        fopf: "\u{1D557}",
        ForAll: "\u2200",
        forall: "\u2200",
        fork: "\u22D4",
        forkv: "\u2AD9",
        Fouriertrf: "\u2131",
        fpartint: "\u2A0D",
        frac12: "\xBD",
        frac13: "\u2153",
        frac14: "\xBC",
        frac15: "\u2155",
        frac16: "\u2159",
        frac18: "\u215B",
        frac23: "\u2154",
        frac25: "\u2156",
        frac34: "\xBE",
        frac35: "\u2157",
        frac38: "\u215C",
        frac45: "\u2158",
        frac56: "\u215A",
        frac58: "\u215D",
        frac78: "\u215E",
        frasl: "\u2044",
        frown: "\u2322",
        Fscr: "\u2131",
        fscr: "\u{1D4BB}",
        gacute: "\u01F5",
        Gamma: "\u0393",
        gamma: "\u03B3",
        Gammad: "\u03DC",
        gammad: "\u03DD",
        gap: "\u2A86",
        Gbreve: "\u011E",
        gbreve: "\u011F",
        Gcedil: "\u0122",
        Gcirc: "\u011C",
        gcirc: "\u011D",
        Gcy: "\u0413",
        gcy: "\u0433",
        Gdot: "\u0120",
        gdot: "\u0121",
        gE: "\u2267",
        ge: "\u2265",
        gEl: "\u2A8C",
        gel: "\u22DB",
        geq: "\u2265",
        geqq: "\u2267",
        geqslant: "\u2A7E",
        ges: "\u2A7E",
        gescc: "\u2AA9",
        gesdot: "\u2A80",
        gesdoto: "\u2A82",
        gesdotol: "\u2A84",
        gesl: "\u22DB\uFE00",
        gesles: "\u2A94",
        Gfr: "\u{1D50A}",
        gfr: "\u{1D524}",
        Gg: "\u22D9",
        gg: "\u226B",
        ggg: "\u22D9",
        gimel: "\u2137",
        GJcy: "\u0403",
        gjcy: "\u0453",
        gl: "\u2277",
        gla: "\u2AA5",
        glE: "\u2A92",
        glj: "\u2AA4",
        gnap: "\u2A8A",
        gnapprox: "\u2A8A",
        gnE: "\u2269",
        gne: "\u2A88",
        gneq: "\u2A88",
        gneqq: "\u2269",
        gnsim: "\u22E7",
        Gopf: "\u{1D53E}",
        gopf: "\u{1D558}",
        grave: "`",
        GreaterEqual: "\u2265",
        GreaterEqualLess: "\u22DB",
        GreaterFullEqual: "\u2267",
        GreaterGreater: "\u2AA2",
        GreaterLess: "\u2277",
        GreaterSlantEqual: "\u2A7E",
        GreaterTilde: "\u2273",
        Gscr: "\u{1D4A2}",
        gscr: "\u210A",
        gsim: "\u2273",
        gsime: "\u2A8E",
        gsiml: "\u2A90",
        Gt: "\u226B",
        GT: ">",
        gt: ">",
        gtcc: "\u2AA7",
        gtcir: "\u2A7A",
        gtdot: "\u22D7",
        gtlPar: "\u2995",
        gtquest: "\u2A7C",
        gtrapprox: "\u2A86",
        gtrarr: "\u2978",
        gtrdot: "\u22D7",
        gtreqless: "\u22DB",
        gtreqqless: "\u2A8C",
        gtrless: "\u2277",
        gtrsim: "\u2273",
        gvertneqq: "\u2269\uFE00",
        gvnE: "\u2269\uFE00",
        Hacek: "\u02C7",
        hairsp: "\u200A",
        half: "\xBD",
        hamilt: "\u210B",
        HARDcy: "\u042A",
        hardcy: "\u044A",
        hArr: "\u21D4",
        harr: "\u2194",
        harrcir: "\u2948",
        harrw: "\u21AD",
        Hat: "^",
        hbar: "\u210F",
        Hcirc: "\u0124",
        hcirc: "\u0125",
        hearts: "\u2665",
        heartsuit: "\u2665",
        hellip: "\u2026",
        hercon: "\u22B9",
        Hfr: "\u210C",
        hfr: "\u{1D525}",
        HilbertSpace: "\u210B",
        hksearow: "\u2925",
        hkswarow: "\u2926",
        hoarr: "\u21FF",
        homtht: "\u223B",
        hookleftarrow: "\u21A9",
        hookrightarrow: "\u21AA",
        Hopf: "\u210D",
        hopf: "\u{1D559}",
        horbar: "\u2015",
        HorizontalLine: "\u2500",
        Hscr: "\u210B",
        hscr: "\u{1D4BD}",
        hslash: "\u210F",
        Hstrok: "\u0126",
        hstrok: "\u0127",
        HumpDownHump: "\u224E",
        HumpEqual: "\u224F",
        hybull: "\u2043",
        hyphen: "\u2010",
        Iacute: "\xCD",
        iacute: "\xED",
        ic: "\u2063",
        Icirc: "\xCE",
        icirc: "\xEE",
        Icy: "\u0418",
        icy: "\u0438",
        Idot: "\u0130",
        IEcy: "\u0415",
        iecy: "\u0435",
        iexcl: "\xA1",
        iff: "\u21D4",
        Ifr: "\u2111",
        ifr: "\u{1D526}",
        Igrave: "\xCC",
        igrave: "\xEC",
        ii: "\u2148",
        iiiint: "\u2A0C",
        iiint: "\u222D",
        iinfin: "\u29DC",
        iiota: "\u2129",
        IJlig: "\u0132",
        ijlig: "\u0133",
        Im: "\u2111",
        Imacr: "\u012A",
        imacr: "\u012B",
        image: "\u2111",
        ImaginaryI: "\u2148",
        imagline: "\u2110",
        imagpart: "\u2111",
        imath: "\u0131",
        imof: "\u22B7",
        imped: "\u01B5",
        Implies: "\u21D2",
        in: "\u2208",
        incare: "\u2105",
        infin: "\u221E",
        infintie: "\u29DD",
        inodot: "\u0131",
        Int: "\u222C",
        int: "\u222B",
        intcal: "\u22BA",
        integers: "\u2124",
        Integral: "\u222B",
        intercal: "\u22BA",
        Intersection: "\u22C2",
        intlarhk: "\u2A17",
        intprod: "\u2A3C",
        InvisibleComma: "\u2063",
        InvisibleTimes: "\u2062",
        IOcy: "\u0401",
        iocy: "\u0451",
        Iogon: "\u012E",
        iogon: "\u012F",
        Iopf: "\u{1D540}",
        iopf: "\u{1D55A}",
        Iota: "\u0399",
        iota: "\u03B9",
        iprod: "\u2A3C",
        iquest: "\xBF",
        Iscr: "\u2110",
        iscr: "\u{1D4BE}",
        isin: "\u2208",
        isindot: "\u22F5",
        isinE: "\u22F9",
        isins: "\u22F4",
        isinsv: "\u22F3",
        isinv: "\u2208",
        it: "\u2062",
        Itilde: "\u0128",
        itilde: "\u0129",
        Iukcy: "\u0406",
        iukcy: "\u0456",
        Iuml: "\xCF",
        iuml: "\xEF",
        Jcirc: "\u0134",
        jcirc: "\u0135",
        Jcy: "\u0419",
        jcy: "\u0439",
        Jfr: "\u{1D50D}",
        jfr: "\u{1D527}",
        jmath: "\u0237",
        Jopf: "\u{1D541}",
        jopf: "\u{1D55B}",
        Jscr: "\u{1D4A5}",
        jscr: "\u{1D4BF}",
        Jsercy: "\u0408",
        jsercy: "\u0458",
        Jukcy: "\u0404",
        jukcy: "\u0454",
        Kappa: "\u039A",
        kappa: "\u03BA",
        kappav: "\u03F0",
        Kcedil: "\u0136",
        kcedil: "\u0137",
        Kcy: "\u041A",
        kcy: "\u043A",
        Kfr: "\u{1D50E}",
        kfr: "\u{1D528}",
        kgreen: "\u0138",
        KHcy: "\u0425",
        khcy: "\u0445",
        KJcy: "\u040C",
        kjcy: "\u045C",
        Kopf: "\u{1D542}",
        kopf: "\u{1D55C}",
        Kscr: "\u{1D4A6}",
        kscr: "\u{1D4C0}",
        lAarr: "\u21DA",
        Lacute: "\u0139",
        lacute: "\u013A",
        laemptyv: "\u29B4",
        lagran: "\u2112",
        Lambda: "\u039B",
        lambda: "\u03BB",
        Lang: "\u27EA",
        lang: "\u27E8",
        langd: "\u2991",
        langle: "\u27E8",
        lap: "\u2A85",
        Laplacetrf: "\u2112",
        laquo: "\xAB",
        Larr: "\u219E",
        lArr: "\u21D0",
        larr: "\u2190",
        larrb: "\u21E4",
        larrbfs: "\u291F",
        larrfs: "\u291D",
        larrhk: "\u21A9",
        larrlp: "\u21AB",
        larrpl: "\u2939",
        larrsim: "\u2973",
        larrtl: "\u21A2",
        lat: "\u2AAB",
        lAtail: "\u291B",
        latail: "\u2919",
        late: "\u2AAD",
        lates: "\u2AAD\uFE00",
        lBarr: "\u290E",
        lbarr: "\u290C",
        lbbrk: "\u2772",
        lbrace: "{",
        lbrack: "[",
        lbrke: "\u298B",
        lbrksld: "\u298F",
        lbrkslu: "\u298D",
        Lcaron: "\u013D",
        lcaron: "\u013E",
        Lcedil: "\u013B",
        lcedil: "\u013C",
        lceil: "\u2308",
        lcub: "{",
        Lcy: "\u041B",
        lcy: "\u043B",
        ldca: "\u2936",
        ldquo: "\u201C",
        ldquor: "\u201E",
        ldrdhar: "\u2967",
        ldrushar: "\u294B",
        ldsh: "\u21B2",
        lE: "\u2266",
        le: "\u2264",
        LeftAngleBracket: "\u27E8",
        LeftArrow: "\u2190",
        Leftarrow: "\u21D0",
        leftarrow: "\u2190",
        LeftArrowBar: "\u21E4",
        LeftArrowRightArrow: "\u21C6",
        leftarrowtail: "\u21A2",
        LeftCeiling: "\u2308",
        LeftDoubleBracket: "\u27E6",
        LeftDownTeeVector: "\u2961",
        LeftDownVector: "\u21C3",
        LeftDownVectorBar: "\u2959",
        LeftFloor: "\u230A",
        leftharpoondown: "\u21BD",
        leftharpoonup: "\u21BC",
        leftleftarrows: "\u21C7",
        LeftRightArrow: "\u2194",
        Leftrightarrow: "\u21D4",
        leftrightarrow: "\u2194",
        leftrightarrows: "\u21C6",
        leftrightharpoons: "\u21CB",
        leftrightsquigarrow: "\u21AD",
        LeftRightVector: "\u294E",
        LeftTee: "\u22A3",
        LeftTeeArrow: "\u21A4",
        LeftTeeVector: "\u295A",
        leftthreetimes: "\u22CB",
        LeftTriangle: "\u22B2",
        LeftTriangleBar: "\u29CF",
        LeftTriangleEqual: "\u22B4",
        LeftUpDownVector: "\u2951",
        LeftUpTeeVector: "\u2960",
        LeftUpVector: "\u21BF",
        LeftUpVectorBar: "\u2958",
        LeftVector: "\u21BC",
        LeftVectorBar: "\u2952",
        lEg: "\u2A8B",
        leg: "\u22DA",
        leq: "\u2264",
        leqq: "\u2266",
        leqslant: "\u2A7D",
        les: "\u2A7D",
        lescc: "\u2AA8",
        lesdot: "\u2A7F",
        lesdoto: "\u2A81",
        lesdotor: "\u2A83",
        lesg: "\u22DA\uFE00",
        lesges: "\u2A93",
        lessapprox: "\u2A85",
        lessdot: "\u22D6",
        lesseqgtr: "\u22DA",
        lesseqqgtr: "\u2A8B",
        LessEqualGreater: "\u22DA",
        LessFullEqual: "\u2266",
        LessGreater: "\u2276",
        lessgtr: "\u2276",
        LessLess: "\u2AA1",
        lesssim: "\u2272",
        LessSlantEqual: "\u2A7D",
        LessTilde: "\u2272",
        lfisht: "\u297C",
        lfloor: "\u230A",
        Lfr: "\u{1D50F}",
        lfr: "\u{1D529}",
        lg: "\u2276",
        lgE: "\u2A91",
        lHar: "\u2962",
        lhard: "\u21BD",
        lharu: "\u21BC",
        lharul: "\u296A",
        lhblk: "\u2584",
        LJcy: "\u0409",
        ljcy: "\u0459",
        Ll: "\u22D8",
        ll: "\u226A",
        llarr: "\u21C7",
        llcorner: "\u231E",
        Lleftarrow: "\u21DA",
        llhard: "\u296B",
        lltri: "\u25FA",
        Lmidot: "\u013F",
        lmidot: "\u0140",
        lmoust: "\u23B0",
        lmoustache: "\u23B0",
        lnap: "\u2A89",
        lnapprox: "\u2A89",
        lnE: "\u2268",
        lne: "\u2A87",
        lneq: "\u2A87",
        lneqq: "\u2268",
        lnsim: "\u22E6",
        loang: "\u27EC",
        loarr: "\u21FD",
        lobrk: "\u27E6",
        LongLeftArrow: "\u27F5",
        Longleftarrow: "\u27F8",
        longleftarrow: "\u27F5",
        LongLeftRightArrow: "\u27F7",
        Longleftrightarrow: "\u27FA",
        longleftrightarrow: "\u27F7",
        longmapsto: "\u27FC",
        LongRightArrow: "\u27F6",
        Longrightarrow: "\u27F9",
        longrightarrow: "\u27F6",
        looparrowleft: "\u21AB",
        looparrowright: "\u21AC",
        lopar: "\u2985",
        Lopf: "\u{1D543}",
        lopf: "\u{1D55D}",
        loplus: "\u2A2D",
        lotimes: "\u2A34",
        lowast: "\u2217",
        lowbar: "_",
        LowerLeftArrow: "\u2199",
        LowerRightArrow: "\u2198",
        loz: "\u25CA",
        lozenge: "\u25CA",
        lozf: "\u29EB",
        lpar: "(",
        lparlt: "\u2993",
        lrarr: "\u21C6",
        lrcorner: "\u231F",
        lrhar: "\u21CB",
        lrhard: "\u296D",
        lrm: "\u200E",
        lrtri: "\u22BF",
        lsaquo: "\u2039",
        Lscr: "\u2112",
        lscr: "\u{1D4C1}",
        Lsh: "\u21B0",
        lsh: "\u21B0",
        lsim: "\u2272",
        lsime: "\u2A8D",
        lsimg: "\u2A8F",
        lsqb: "[",
        lsquo: "\u2018",
        lsquor: "\u201A",
        Lstrok: "\u0141",
        lstrok: "\u0142",
        Lt: "\u226A",
        LT: "<",
        lt: "<",
        ltcc: "\u2AA6",
        ltcir: "\u2A79",
        ltdot: "\u22D6",
        lthree: "\u22CB",
        ltimes: "\u22C9",
        ltlarr: "\u2976",
        ltquest: "\u2A7B",
        ltri: "\u25C3",
        ltrie: "\u22B4",
        ltrif: "\u25C2",
        ltrPar: "\u2996",
        lurdshar: "\u294A",
        luruhar: "\u2966",
        lvertneqq: "\u2268\uFE00",
        lvnE: "\u2268\uFE00",
        macr: "\xAF",
        male: "\u2642",
        malt: "\u2720",
        maltese: "\u2720",
        Map: "\u2905",
        map: "\u21A6",
        mapsto: "\u21A6",
        mapstodown: "\u21A7",
        mapstoleft: "\u21A4",
        mapstoup: "\u21A5",
        marker: "\u25AE",
        mcomma: "\u2A29",
        Mcy: "\u041C",
        mcy: "\u043C",
        mdash: "\u2014",
        mDDot: "\u223A",
        measuredangle: "\u2221",
        MediumSpace: "\u205F",
        Mellintrf: "\u2133",
        Mfr: "\u{1D510}",
        mfr: "\u{1D52A}",
        mho: "\u2127",
        micro: "\xB5",
        mid: "\u2223",
        midast: "*",
        midcir: "\u2AF0",
        middot: "\xB7",
        minus: "\u2212",
        minusb: "\u229F",
        minusd: "\u2238",
        minusdu: "\u2A2A",
        MinusPlus: "\u2213",
        mlcp: "\u2ADB",
        mldr: "\u2026",
        mnplus: "\u2213",
        models: "\u22A7",
        Mopf: "\u{1D544}",
        mopf: "\u{1D55E}",
        mp: "\u2213",
        Mscr: "\u2133",
        mscr: "\u{1D4C2}",
        mstpos: "\u223E",
        Mu: "\u039C",
        mu: "\u03BC",
        multimap: "\u22B8",
        mumap: "\u22B8",
        nabla: "\u2207",
        Nacute: "\u0143",
        nacute: "\u0144",
        nang: "\u2220\u20D2",
        nap: "\u2249",
        napE: "\u2A70\u0338",
        napid: "\u224B\u0338",
        napos: "\u0149",
        napprox: "\u2249",
        natur: "\u266E",
        natural: "\u266E",
        naturals: "\u2115",
        nbsp: "\xA0",
        nbump: "\u224E\u0338",
        nbumpe: "\u224F\u0338",
        ncap: "\u2A43",
        Ncaron: "\u0147",
        ncaron: "\u0148",
        Ncedil: "\u0145",
        ncedil: "\u0146",
        ncong: "\u2247",
        ncongdot: "\u2A6D\u0338",
        ncup: "\u2A42",
        Ncy: "\u041D",
        ncy: "\u043D",
        ndash: "\u2013",
        ne: "\u2260",
        nearhk: "\u2924",
        neArr: "\u21D7",
        nearr: "\u2197",
        nearrow: "\u2197",
        nedot: "\u2250\u0338",
        NegativeMediumSpace: "\u200B",
        NegativeThickSpace: "\u200B",
        NegativeThinSpace: "\u200B",
        NegativeVeryThinSpace: "\u200B",
        nequiv: "\u2262",
        nesear: "\u2928",
        nesim: "\u2242\u0338",
        NestedGreaterGreater: "\u226B",
        NestedLessLess: "\u226A",
        NewLine: "\n",
        nexist: "\u2204",
        nexists: "\u2204",
        Nfr: "\u{1D511}",
        nfr: "\u{1D52B}",
        ngE: "\u2267\u0338",
        nge: "\u2271",
        ngeq: "\u2271",
        ngeqq: "\u2267\u0338",
        ngeqslant: "\u2A7E\u0338",
        nges: "\u2A7E\u0338",
        nGg: "\u22D9\u0338",
        ngsim: "\u2275",
        nGt: "\u226B\u20D2",
        ngt: "\u226F",
        ngtr: "\u226F",
        nGtv: "\u226B\u0338",
        nhArr: "\u21CE",
        nharr: "\u21AE",
        nhpar: "\u2AF2",
        ni: "\u220B",
        nis: "\u22FC",
        nisd: "\u22FA",
        niv: "\u220B",
        NJcy: "\u040A",
        njcy: "\u045A",
        nlArr: "\u21CD",
        nlarr: "\u219A",
        nldr: "\u2025",
        nlE: "\u2266\u0338",
        nle: "\u2270",
        nLeftarrow: "\u21CD",
        nleftarrow: "\u219A",
        nLeftrightarrow: "\u21CE",
        nleftrightarrow: "\u21AE",
        nleq: "\u2270",
        nleqq: "\u2266\u0338",
        nleqslant: "\u2A7D\u0338",
        nles: "\u2A7D\u0338",
        nless: "\u226E",
        nLl: "\u22D8\u0338",
        nlsim: "\u2274",
        nLt: "\u226A\u20D2",
        nlt: "\u226E",
        nltri: "\u22EA",
        nltrie: "\u22EC",
        nLtv: "\u226A\u0338",
        nmid: "\u2224",
        NoBreak: "\u2060",
        NonBreakingSpace: "\xA0",
        Nopf: "\u2115",
        nopf: "\u{1D55F}",
        Not: "\u2AEC",
        not: "\xAC",
        NotCongruent: "\u2262",
        NotCupCap: "\u226D",
        NotDoubleVerticalBar: "\u2226",
        NotElement: "\u2209",
        NotEqual: "\u2260",
        NotEqualTilde: "\u2242\u0338",
        NotExists: "\u2204",
        NotGreater: "\u226F",
        NotGreaterEqual: "\u2271",
        NotGreaterFullEqual: "\u2267\u0338",
        NotGreaterGreater: "\u226B\u0338",
        NotGreaterLess: "\u2279",
        NotGreaterSlantEqual: "\u2A7E\u0338",
        NotGreaterTilde: "\u2275",
        NotHumpDownHump: "\u224E\u0338",
        NotHumpEqual: "\u224F\u0338",
        notin: "\u2209",
        notindot: "\u22F5\u0338",
        notinE: "\u22F9\u0338",
        notinva: "\u2209",
        notinvb: "\u22F7",
        notinvc: "\u22F6",
        NotLeftTriangle: "\u22EA",
        NotLeftTriangleBar: "\u29CF\u0338",
        NotLeftTriangleEqual: "\u22EC",
        NotLess: "\u226E",
        NotLessEqual: "\u2270",
        NotLessGreater: "\u2278",
        NotLessLess: "\u226A\u0338",
        NotLessSlantEqual: "\u2A7D\u0338",
        NotLessTilde: "\u2274",
        NotNestedGreaterGreater: "\u2AA2\u0338",
        NotNestedLessLess: "\u2AA1\u0338",
        notni: "\u220C",
        notniva: "\u220C",
        notnivb: "\u22FE",
        notnivc: "\u22FD",
        NotPrecedes: "\u2280",
        NotPrecedesEqual: "\u2AAF\u0338",
        NotPrecedesSlantEqual: "\u22E0",
        NotReverseElement: "\u220C",
        NotRightTriangle: "\u22EB",
        NotRightTriangleBar: "\u29D0\u0338",
        NotRightTriangleEqual: "\u22ED",
        NotSquareSubset: "\u228F\u0338",
        NotSquareSubsetEqual: "\u22E2",
        NotSquareSuperset: "\u2290\u0338",
        NotSquareSupersetEqual: "\u22E3",
        NotSubset: "\u2282\u20D2",
        NotSubsetEqual: "\u2288",
        NotSucceeds: "\u2281",
        NotSucceedsEqual: "\u2AB0\u0338",
        NotSucceedsSlantEqual: "\u22E1",
        NotSucceedsTilde: "\u227F\u0338",
        NotSuperset: "\u2283\u20D2",
        NotSupersetEqual: "\u2289",
        NotTilde: "\u2241",
        NotTildeEqual: "\u2244",
        NotTildeFullEqual: "\u2247",
        NotTildeTilde: "\u2249",
        NotVerticalBar: "\u2224",
        npar: "\u2226",
        nparallel: "\u2226",
        nparsl: "\u2AFD\u20E5",
        npart: "\u2202\u0338",
        npolint: "\u2A14",
        npr: "\u2280",
        nprcue: "\u22E0",
        npre: "\u2AAF\u0338",
        nprec: "\u2280",
        npreceq: "\u2AAF\u0338",
        nrArr: "\u21CF",
        nrarr: "\u219B",
        nrarrc: "\u2933\u0338",
        nrarrw: "\u219D\u0338",
        nRightarrow: "\u21CF",
        nrightarrow: "\u219B",
        nrtri: "\u22EB",
        nrtrie: "\u22ED",
        nsc: "\u2281",
        nsccue: "\u22E1",
        nsce: "\u2AB0\u0338",
        Nscr: "\u{1D4A9}",
        nscr: "\u{1D4C3}",
        nshortmid: "\u2224",
        nshortparallel: "\u2226",
        nsim: "\u2241",
        nsime: "\u2244",
        nsimeq: "\u2244",
        nsmid: "\u2224",
        nspar: "\u2226",
        nsqsube: "\u22E2",
        nsqsupe: "\u22E3",
        nsub: "\u2284",
        nsubE: "\u2AC5\u0338",
        nsube: "\u2288",
        nsubset: "\u2282\u20D2",
        nsubseteq: "\u2288",
        nsubseteqq: "\u2AC5\u0338",
        nsucc: "\u2281",
        nsucceq: "\u2AB0\u0338",
        nsup: "\u2285",
        nsupE: "\u2AC6\u0338",
        nsupe: "\u2289",
        nsupset: "\u2283\u20D2",
        nsupseteq: "\u2289",
        nsupseteqq: "\u2AC6\u0338",
        ntgl: "\u2279",
        Ntilde: "\xD1",
        ntilde: "\xF1",
        ntlg: "\u2278",
        ntriangleleft: "\u22EA",
        ntrianglelefteq: "\u22EC",
        ntriangleright: "\u22EB",
        ntrianglerighteq: "\u22ED",
        Nu: "\u039D",
        nu: "\u03BD",
        num: "#",
        numero: "\u2116",
        numsp: "\u2007",
        nvap: "\u224D\u20D2",
        nVDash: "\u22AF",
        nVdash: "\u22AE",
        nvDash: "\u22AD",
        nvdash: "\u22AC",
        nvge: "\u2265\u20D2",
        nvgt: ">\u20D2",
        nvHarr: "\u2904",
        nvinfin: "\u29DE",
        nvlArr: "\u2902",
        nvle: "\u2264\u20D2",
        nvlt: "<\u20D2",
        nvltrie: "\u22B4\u20D2",
        nvrArr: "\u2903",
        nvrtrie: "\u22B5\u20D2",
        nvsim: "\u223C\u20D2",
        nwarhk: "\u2923",
        nwArr: "\u21D6",
        nwarr: "\u2196",
        nwarrow: "\u2196",
        nwnear: "\u2927",
        Oacute: "\xD3",
        oacute: "\xF3",
        oast: "\u229B",
        ocir: "\u229A",
        Ocirc: "\xD4",
        ocirc: "\xF4",
        Ocy: "\u041E",
        ocy: "\u043E",
        odash: "\u229D",
        Odblac: "\u0150",
        odblac: "\u0151",
        odiv: "\u2A38",
        odot: "\u2299",
        odsold: "\u29BC",
        OElig: "\u0152",
        oelig: "\u0153",
        ofcir: "\u29BF",
        Ofr: "\u{1D512}",
        ofr: "\u{1D52C}",
        ogon: "\u02DB",
        Ograve: "\xD2",
        ograve: "\xF2",
        ogt: "\u29C1",
        ohbar: "\u29B5",
        ohm: "\u03A9",
        oint: "\u222E",
        olarr: "\u21BA",
        olcir: "\u29BE",
        olcross: "\u29BB",
        oline: "\u203E",
        olt: "\u29C0",
        Omacr: "\u014C",
        omacr: "\u014D",
        Omega: "\u03A9",
        omega: "\u03C9",
        Omicron: "\u039F",
        omicron: "\u03BF",
        omid: "\u29B6",
        ominus: "\u2296",
        Oopf: "\u{1D546}",
        oopf: "\u{1D560}",
        opar: "\u29B7",
        OpenCurlyDoubleQuote: "\u201C",
        OpenCurlyQuote: "\u2018",
        operp: "\u29B9",
        oplus: "\u2295",
        Or: "\u2A54",
        or: "\u2228",
        orarr: "\u21BB",
        ord: "\u2A5D",
        order: "\u2134",
        orderof: "\u2134",
        ordf: "\xAA",
        ordm: "\xBA",
        origof: "\u22B6",
        oror: "\u2A56",
        orslope: "\u2A57",
        orv: "\u2A5B",
        oS: "\u24C8",
        Oscr: "\u{1D4AA}",
        oscr: "\u2134",
        Oslash: "\xD8",
        oslash: "\xF8",
        osol: "\u2298",
        Otilde: "\xD5",
        otilde: "\xF5",
        Otimes: "\u2A37",
        otimes: "\u2297",
        otimesas: "\u2A36",
        Ouml: "\xD6",
        ouml: "\xF6",
        ovbar: "\u233D",
        OverBar: "\u203E",
        OverBrace: "\u23DE",
        OverBracket: "\u23B4",
        OverParenthesis: "\u23DC",
        par: "\u2225",
        para: "\xB6",
        parallel: "\u2225",
        parsim: "\u2AF3",
        parsl: "\u2AFD",
        part: "\u2202",
        PartialD: "\u2202",
        Pcy: "\u041F",
        pcy: "\u043F",
        percnt: "%",
        period: ".",
        permil: "\u2030",
        perp: "\u22A5",
        pertenk: "\u2031",
        Pfr: "\u{1D513}",
        pfr: "\u{1D52D}",
        Phi: "\u03A6",
        phi: "\u03C6",
        phiv: "\u03D5",
        phmmat: "\u2133",
        phone: "\u260E",
        Pi: "\u03A0",
        pi: "\u03C0",
        pitchfork: "\u22D4",
        piv: "\u03D6",
        planck: "\u210F",
        planckh: "\u210E",
        plankv: "\u210F",
        plus: "+",
        plusacir: "\u2A23",
        plusb: "\u229E",
        pluscir: "\u2A22",
        plusdo: "\u2214",
        plusdu: "\u2A25",
        pluse: "\u2A72",
        PlusMinus: "\xB1",
        plusmn: "\xB1",
        plussim: "\u2A26",
        plustwo: "\u2A27",
        pm: "\xB1",
        Poincareplane: "\u210C",
        pointint: "\u2A15",
        Popf: "\u2119",
        popf: "\u{1D561}",
        pound: "\xA3",
        Pr: "\u2ABB",
        pr: "\u227A",
        prap: "\u2AB7",
        prcue: "\u227C",
        prE: "\u2AB3",
        pre: "\u2AAF",
        prec: "\u227A",
        precapprox: "\u2AB7",
        preccurlyeq: "\u227C",
        Precedes: "\u227A",
        PrecedesEqual: "\u2AAF",
        PrecedesSlantEqual: "\u227C",
        PrecedesTilde: "\u227E",
        preceq: "\u2AAF",
        precnapprox: "\u2AB9",
        precneqq: "\u2AB5",
        precnsim: "\u22E8",
        precsim: "\u227E",
        Prime: "\u2033",
        prime: "\u2032",
        primes: "\u2119",
        prnap: "\u2AB9",
        prnE: "\u2AB5",
        prnsim: "\u22E8",
        prod: "\u220F",
        Product: "\u220F",
        profalar: "\u232E",
        profline: "\u2312",
        profsurf: "\u2313",
        prop: "\u221D",
        Proportion: "\u2237",
        Proportional: "\u221D",
        propto: "\u221D",
        prsim: "\u227E",
        prurel: "\u22B0",
        Pscr: "\u{1D4AB}",
        pscr: "\u{1D4C5}",
        Psi: "\u03A8",
        psi: "\u03C8",
        puncsp: "\u2008",
        Qfr: "\u{1D514}",
        qfr: "\u{1D52E}",
        qint: "\u2A0C",
        Qopf: "\u211A",
        qopf: "\u{1D562}",
        qprime: "\u2057",
        Qscr: "\u{1D4AC}",
        qscr: "\u{1D4C6}",
        quaternions: "\u210D",
        quatint: "\u2A16",
        quest: "?",
        questeq: "\u225F",
        QUOT: '"',
        quot: '"',
        rAarr: "\u21DB",
        race: "\u223D\u0331",
        Racute: "\u0154",
        racute: "\u0155",
        radic: "\u221A",
        raemptyv: "\u29B3",
        Rang: "\u27EB",
        rang: "\u27E9",
        rangd: "\u2992",
        range: "\u29A5",
        rangle: "\u27E9",
        raquo: "\xBB",
        Rarr: "\u21A0",
        rArr: "\u21D2",
        rarr: "\u2192",
        rarrap: "\u2975",
        rarrb: "\u21E5",
        rarrbfs: "\u2920",
        rarrc: "\u2933",
        rarrfs: "\u291E",
        rarrhk: "\u21AA",
        rarrlp: "\u21AC",
        rarrpl: "\u2945",
        rarrsim: "\u2974",
        Rarrtl: "\u2916",
        rarrtl: "\u21A3",
        rarrw: "\u219D",
        rAtail: "\u291C",
        ratail: "\u291A",
        ratio: "\u2236",
        rationals: "\u211A",
        RBarr: "\u2910",
        rBarr: "\u290F",
        rbarr: "\u290D",
        rbbrk: "\u2773",
        rbrace: "}",
        rbrack: "]",
        rbrke: "\u298C",
        rbrksld: "\u298E",
        rbrkslu: "\u2990",
        Rcaron: "\u0158",
        rcaron: "\u0159",
        Rcedil: "\u0156",
        rcedil: "\u0157",
        rceil: "\u2309",
        rcub: "}",
        Rcy: "\u0420",
        rcy: "\u0440",
        rdca: "\u2937",
        rdldhar: "\u2969",
        rdquo: "\u201D",
        rdquor: "\u201D",
        rdsh: "\u21B3",
        Re: "\u211C",
        real: "\u211C",
        realine: "\u211B",
        realpart: "\u211C",
        reals: "\u211D",
        rect: "\u25AD",
        REG: "\xAE",
        reg: "\xAE",
        ReverseElement: "\u220B",
        ReverseEquilibrium: "\u21CB",
        ReverseUpEquilibrium: "\u296F",
        rfisht: "\u297D",
        rfloor: "\u230B",
        Rfr: "\u211C",
        rfr: "\u{1D52F}",
        rHar: "\u2964",
        rhard: "\u21C1",
        rharu: "\u21C0",
        rharul: "\u296C",
        Rho: "\u03A1",
        rho: "\u03C1",
        rhov: "\u03F1",
        RightAngleBracket: "\u27E9",
        RightArrow: "\u2192",
        Rightarrow: "\u21D2",
        rightarrow: "\u2192",
        RightArrowBar: "\u21E5",
        RightArrowLeftArrow: "\u21C4",
        rightarrowtail: "\u21A3",
        RightCeiling: "\u2309",
        RightDoubleBracket: "\u27E7",
        RightDownTeeVector: "\u295D",
        RightDownVector: "\u21C2",
        RightDownVectorBar: "\u2955",
        RightFloor: "\u230B",
        rightharpoondown: "\u21C1",
        rightharpoonup: "\u21C0",
        rightleftarrows: "\u21C4",
        rightleftharpoons: "\u21CC",
        rightrightarrows: "\u21C9",
        rightsquigarrow: "\u219D",
        RightTee: "\u22A2",
        RightTeeArrow: "\u21A6",
        RightTeeVector: "\u295B",
        rightthreetimes: "\u22CC",
        RightTriangle: "\u22B3",
        RightTriangleBar: "\u29D0",
        RightTriangleEqual: "\u22B5",
        RightUpDownVector: "\u294F",
        RightUpTeeVector: "\u295C",
        RightUpVector: "\u21BE",
        RightUpVectorBar: "\u2954",
        RightVector: "\u21C0",
        RightVectorBar: "\u2953",
        ring: "\u02DA",
        risingdotseq: "\u2253",
        rlarr: "\u21C4",
        rlhar: "\u21CC",
        rlm: "\u200F",
        rmoust: "\u23B1",
        rmoustache: "\u23B1",
        rnmid: "\u2AEE",
        roang: "\u27ED",
        roarr: "\u21FE",
        robrk: "\u27E7",
        ropar: "\u2986",
        Ropf: "\u211D",
        ropf: "\u{1D563}",
        roplus: "\u2A2E",
        rotimes: "\u2A35",
        RoundImplies: "\u2970",
        rpar: ")",
        rpargt: "\u2994",
        rppolint: "\u2A12",
        rrarr: "\u21C9",
        Rrightarrow: "\u21DB",
        rsaquo: "\u203A",
        Rscr: "\u211B",
        rscr: "\u{1D4C7}",
        Rsh: "\u21B1",
        rsh: "\u21B1",
        rsqb: "]",
        rsquo: "\u2019",
        rsquor: "\u2019",
        rthree: "\u22CC",
        rtimes: "\u22CA",
        rtri: "\u25B9",
        rtrie: "\u22B5",
        rtrif: "\u25B8",
        rtriltri: "\u29CE",
        RuleDelayed: "\u29F4",
        ruluhar: "\u2968",
        rx: "\u211E",
        Sacute: "\u015A",
        sacute: "\u015B",
        sbquo: "\u201A",
        Sc: "\u2ABC",
        sc: "\u227B",
        scap: "\u2AB8",
        Scaron: "\u0160",
        scaron: "\u0161",
        sccue: "\u227D",
        scE: "\u2AB4",
        sce: "\u2AB0",
        Scedil: "\u015E",
        scedil: "\u015F",
        Scirc: "\u015C",
        scirc: "\u015D",
        scnap: "\u2ABA",
        scnE: "\u2AB6",
        scnsim: "\u22E9",
        scpolint: "\u2A13",
        scsim: "\u227F",
        Scy: "\u0421",
        scy: "\u0441",
        sdot: "\u22C5",
        sdotb: "\u22A1",
        sdote: "\u2A66",
        searhk: "\u2925",
        seArr: "\u21D8",
        searr: "\u2198",
        searrow: "\u2198",
        sect: "\xA7",
        semi: ";",
        seswar: "\u2929",
        setminus: "\u2216",
        setmn: "\u2216",
        sext: "\u2736",
        Sfr: "\u{1D516}",
        sfr: "\u{1D530}",
        sfrown: "\u2322",
        sharp: "\u266F",
        SHCHcy: "\u0429",
        shchcy: "\u0449",
        SHcy: "\u0428",
        shcy: "\u0448",
        ShortDownArrow: "\u2193",
        ShortLeftArrow: "\u2190",
        shortmid: "\u2223",
        shortparallel: "\u2225",
        ShortRightArrow: "\u2192",
        ShortUpArrow: "\u2191",
        shy: "\xAD",
        Sigma: "\u03A3",
        sigma: "\u03C3",
        sigmaf: "\u03C2",
        sigmav: "\u03C2",
        sim: "\u223C",
        simdot: "\u2A6A",
        sime: "\u2243",
        simeq: "\u2243",
        simg: "\u2A9E",
        simgE: "\u2AA0",
        siml: "\u2A9D",
        simlE: "\u2A9F",
        simne: "\u2246",
        simplus: "\u2A24",
        simrarr: "\u2972",
        slarr: "\u2190",
        SmallCircle: "\u2218",
        smallsetminus: "\u2216",
        smashp: "\u2A33",
        smeparsl: "\u29E4",
        smid: "\u2223",
        smile: "\u2323",
        smt: "\u2AAA",
        smte: "\u2AAC",
        smtes: "\u2AAC\uFE00",
        SOFTcy: "\u042C",
        softcy: "\u044C",
        sol: "/",
        solb: "\u29C4",
        solbar: "\u233F",
        Sopf: "\u{1D54A}",
        sopf: "\u{1D564}",
        spades: "\u2660",
        spadesuit: "\u2660",
        spar: "\u2225",
        sqcap: "\u2293",
        sqcaps: "\u2293\uFE00",
        sqcup: "\u2294",
        sqcups: "\u2294\uFE00",
        Sqrt: "\u221A",
        sqsub: "\u228F",
        sqsube: "\u2291",
        sqsubset: "\u228F",
        sqsubseteq: "\u2291",
        sqsup: "\u2290",
        sqsupe: "\u2292",
        sqsupset: "\u2290",
        sqsupseteq: "\u2292",
        squ: "\u25A1",
        Square: "\u25A1",
        square: "\u25A1",
        SquareIntersection: "\u2293",
        SquareSubset: "\u228F",
        SquareSubsetEqual: "\u2291",
        SquareSuperset: "\u2290",
        SquareSupersetEqual: "\u2292",
        SquareUnion: "\u2294",
        squarf: "\u25AA",
        squf: "\u25AA",
        srarr: "\u2192",
        Sscr: "\u{1D4AE}",
        sscr: "\u{1D4C8}",
        ssetmn: "\u2216",
        ssmile: "\u2323",
        sstarf: "\u22C6",
        Star: "\u22C6",
        star: "\u2606",
        starf: "\u2605",
        straightepsilon: "\u03F5",
        straightphi: "\u03D5",
        strns: "\xAF",
        Sub: "\u22D0",
        sub: "\u2282",
        subdot: "\u2ABD",
        subE: "\u2AC5",
        sube: "\u2286",
        subedot: "\u2AC3",
        submult: "\u2AC1",
        subnE: "\u2ACB",
        subne: "\u228A",
        subplus: "\u2ABF",
        subrarr: "\u2979",
        Subset: "\u22D0",
        subset: "\u2282",
        subseteq: "\u2286",
        subseteqq: "\u2AC5",
        SubsetEqual: "\u2286",
        subsetneq: "\u228A",
        subsetneqq: "\u2ACB",
        subsim: "\u2AC7",
        subsub: "\u2AD5",
        subsup: "\u2AD3",
        succ: "\u227B",
        succapprox: "\u2AB8",
        succcurlyeq: "\u227D",
        Succeeds: "\u227B",
        SucceedsEqual: "\u2AB0",
        SucceedsSlantEqual: "\u227D",
        SucceedsTilde: "\u227F",
        succeq: "\u2AB0",
        succnapprox: "\u2ABA",
        succneqq: "\u2AB6",
        succnsim: "\u22E9",
        succsim: "\u227F",
        SuchThat: "\u220B",
        Sum: "\u2211",
        sum: "\u2211",
        sung: "\u266A",
        Sup: "\u22D1",
        sup: "\u2283",
        sup1: "\xB9",
        sup2: "\xB2",
        sup3: "\xB3",
        supdot: "\u2ABE",
        supdsub: "\u2AD8",
        supE: "\u2AC6",
        supe: "\u2287",
        supedot: "\u2AC4",
        Superset: "\u2283",
        SupersetEqual: "\u2287",
        suphsol: "\u27C9",
        suphsub: "\u2AD7",
        suplarr: "\u297B",
        supmult: "\u2AC2",
        supnE: "\u2ACC",
        supne: "\u228B",
        supplus: "\u2AC0",
        Supset: "\u22D1",
        supset: "\u2283",
        supseteq: "\u2287",
        supseteqq: "\u2AC6",
        supsetneq: "\u228B",
        supsetneqq: "\u2ACC",
        supsim: "\u2AC8",
        supsub: "\u2AD4",
        supsup: "\u2AD6",
        swarhk: "\u2926",
        swArr: "\u21D9",
        swarr: "\u2199",
        swarrow: "\u2199",
        swnwar: "\u292A",
        szlig: "\xDF",
        Tab: "	",
        target: "\u2316",
        Tau: "\u03A4",
        tau: "\u03C4",
        tbrk: "\u23B4",
        Tcaron: "\u0164",
        tcaron: "\u0165",
        Tcedil: "\u0162",
        tcedil: "\u0163",
        Tcy: "\u0422",
        tcy: "\u0442",
        tdot: "\u20DB",
        telrec: "\u2315",
        Tfr: "\u{1D517}",
        tfr: "\u{1D531}",
        there4: "\u2234",
        Therefore: "\u2234",
        therefore: "\u2234",
        Theta: "\u0398",
        theta: "\u03B8",
        thetasym: "\u03D1",
        thetav: "\u03D1",
        thickapprox: "\u2248",
        thicksim: "\u223C",
        ThickSpace: "\u205F\u200A",
        thinsp: "\u2009",
        ThinSpace: "\u2009",
        thkap: "\u2248",
        thksim: "\u223C",
        THORN: "\xDE",
        thorn: "\xFE",
        Tilde: "\u223C",
        tilde: "\u02DC",
        TildeEqual: "\u2243",
        TildeFullEqual: "\u2245",
        TildeTilde: "\u2248",
        times: "\xD7",
        timesb: "\u22A0",
        timesbar: "\u2A31",
        timesd: "\u2A30",
        tint: "\u222D",
        toea: "\u2928",
        top: "\u22A4",
        topbot: "\u2336",
        topcir: "\u2AF1",
        Topf: "\u{1D54B}",
        topf: "\u{1D565}",
        topfork: "\u2ADA",
        tosa: "\u2929",
        tprime: "\u2034",
        TRADE: "\u2122",
        trade: "\u2122",
        triangle: "\u25B5",
        triangledown: "\u25BF",
        triangleleft: "\u25C3",
        trianglelefteq: "\u22B4",
        triangleq: "\u225C",
        triangleright: "\u25B9",
        trianglerighteq: "\u22B5",
        tridot: "\u25EC",
        trie: "\u225C",
        triminus: "\u2A3A",
        TripleDot: "\u20DB",
        triplus: "\u2A39",
        trisb: "\u29CD",
        tritime: "\u2A3B",
        trpezium: "\u23E2",
        Tscr: "\u{1D4AF}",
        tscr: "\u{1D4C9}",
        TScy: "\u0426",
        tscy: "\u0446",
        TSHcy: "\u040B",
        tshcy: "\u045B",
        Tstrok: "\u0166",
        tstrok: "\u0167",
        twixt: "\u226C",
        twoheadleftarrow: "\u219E",
        twoheadrightarrow: "\u21A0",
        Uacute: "\xDA",
        uacute: "\xFA",
        Uarr: "\u219F",
        uArr: "\u21D1",
        uarr: "\u2191",
        Uarrocir: "\u2949",
        Ubrcy: "\u040E",
        ubrcy: "\u045E",
        Ubreve: "\u016C",
        ubreve: "\u016D",
        Ucirc: "\xDB",
        ucirc: "\xFB",
        Ucy: "\u0423",
        ucy: "\u0443",
        udarr: "\u21C5",
        Udblac: "\u0170",
        udblac: "\u0171",
        udhar: "\u296E",
        ufisht: "\u297E",
        Ufr: "\u{1D518}",
        ufr: "\u{1D532}",
        Ugrave: "\xD9",
        ugrave: "\xF9",
        uHar: "\u2963",
        uharl: "\u21BF",
        uharr: "\u21BE",
        uhblk: "\u2580",
        ulcorn: "\u231C",
        ulcorner: "\u231C",
        ulcrop: "\u230F",
        ultri: "\u25F8",
        Umacr: "\u016A",
        umacr: "\u016B",
        uml: "\xA8",
        UnderBar: "_",
        UnderBrace: "\u23DF",
        UnderBracket: "\u23B5",
        UnderParenthesis: "\u23DD",
        Union: "\u22C3",
        UnionPlus: "\u228E",
        Uogon: "\u0172",
        uogon: "\u0173",
        Uopf: "\u{1D54C}",
        uopf: "\u{1D566}",
        UpArrow: "\u2191",
        Uparrow: "\u21D1",
        uparrow: "\u2191",
        UpArrowBar: "\u2912",
        UpArrowDownArrow: "\u21C5",
        UpDownArrow: "\u2195",
        Updownarrow: "\u21D5",
        updownarrow: "\u2195",
        UpEquilibrium: "\u296E",
        upharpoonleft: "\u21BF",
        upharpoonright: "\u21BE",
        uplus: "\u228E",
        UpperLeftArrow: "\u2196",
        UpperRightArrow: "\u2197",
        Upsi: "\u03D2",
        upsi: "\u03C5",
        upsih: "\u03D2",
        Upsilon: "\u03A5",
        upsilon: "\u03C5",
        UpTee: "\u22A5",
        UpTeeArrow: "\u21A5",
        upuparrows: "\u21C8",
        urcorn: "\u231D",
        urcorner: "\u231D",
        urcrop: "\u230E",
        Uring: "\u016E",
        uring: "\u016F",
        urtri: "\u25F9",
        Uscr: "\u{1D4B0}",
        uscr: "\u{1D4CA}",
        utdot: "\u22F0",
        Utilde: "\u0168",
        utilde: "\u0169",
        utri: "\u25B5",
        utrif: "\u25B4",
        uuarr: "\u21C8",
        Uuml: "\xDC",
        uuml: "\xFC",
        uwangle: "\u29A7",
        vangrt: "\u299C",
        varepsilon: "\u03F5",
        varkappa: "\u03F0",
        varnothing: "\u2205",
        varphi: "\u03D5",
        varpi: "\u03D6",
        varpropto: "\u221D",
        vArr: "\u21D5",
        varr: "\u2195",
        varrho: "\u03F1",
        varsigma: "\u03C2",
        varsubsetneq: "\u228A\uFE00",
        varsubsetneqq: "\u2ACB\uFE00",
        varsupsetneq: "\u228B\uFE00",
        varsupsetneqq: "\u2ACC\uFE00",
        vartheta: "\u03D1",
        vartriangleleft: "\u22B2",
        vartriangleright: "\u22B3",
        Vbar: "\u2AEB",
        vBar: "\u2AE8",
        vBarv: "\u2AE9",
        Vcy: "\u0412",
        vcy: "\u0432",
        VDash: "\u22AB",
        Vdash: "\u22A9",
        vDash: "\u22A8",
        vdash: "\u22A2",
        Vdashl: "\u2AE6",
        Vee: "\u22C1",
        vee: "\u2228",
        veebar: "\u22BB",
        veeeq: "\u225A",
        vellip: "\u22EE",
        Verbar: "\u2016",
        verbar: "|",
        Vert: "\u2016",
        vert: "|",
        VerticalBar: "\u2223",
        VerticalLine: "|",
        VerticalSeparator: "\u2758",
        VerticalTilde: "\u2240",
        VeryThinSpace: "\u200A",
        Vfr: "\u{1D519}",
        vfr: "\u{1D533}",
        vltri: "\u22B2",
        vnsub: "\u2282\u20D2",
        vnsup: "\u2283\u20D2",
        Vopf: "\u{1D54D}",
        vopf: "\u{1D567}",
        vprop: "\u221D",
        vrtri: "\u22B3",
        Vscr: "\u{1D4B1}",
        vscr: "\u{1D4CB}",
        vsubnE: "\u2ACB\uFE00",
        vsubne: "\u228A\uFE00",
        vsupnE: "\u2ACC\uFE00",
        vsupne: "\u228B\uFE00",
        Vvdash: "\u22AA",
        vzigzag: "\u299A",
        Wcirc: "\u0174",
        wcirc: "\u0175",
        wedbar: "\u2A5F",
        Wedge: "\u22C0",
        wedge: "\u2227",
        wedgeq: "\u2259",
        weierp: "\u2118",
        Wfr: "\u{1D51A}",
        wfr: "\u{1D534}",
        Wopf: "\u{1D54E}",
        wopf: "\u{1D568}",
        wp: "\u2118",
        wr: "\u2240",
        wreath: "\u2240",
        Wscr: "\u{1D4B2}",
        wscr: "\u{1D4CC}",
        xcap: "\u22C2",
        xcirc: "\u25EF",
        xcup: "\u22C3",
        xdtri: "\u25BD",
        Xfr: "\u{1D51B}",
        xfr: "\u{1D535}",
        xhArr: "\u27FA",
        xharr: "\u27F7",
        Xi: "\u039E",
        xi: "\u03BE",
        xlArr: "\u27F8",
        xlarr: "\u27F5",
        xmap: "\u27FC",
        xnis: "\u22FB",
        xodot: "\u2A00",
        Xopf: "\u{1D54F}",
        xopf: "\u{1D569}",
        xoplus: "\u2A01",
        xotime: "\u2A02",
        xrArr: "\u27F9",
        xrarr: "\u27F6",
        Xscr: "\u{1D4B3}",
        xscr: "\u{1D4CD}",
        xsqcup: "\u2A06",
        xuplus: "\u2A04",
        xutri: "\u25B3",
        xvee: "\u22C1",
        xwedge: "\u22C0",
        Yacute: "\xDD",
        yacute: "\xFD",
        YAcy: "\u042F",
        yacy: "\u044F",
        Ycirc: "\u0176",
        ycirc: "\u0177",
        Ycy: "\u042B",
        ycy: "\u044B",
        yen: "\xA5",
        Yfr: "\u{1D51C}",
        yfr: "\u{1D536}",
        YIcy: "\u0407",
        yicy: "\u0457",
        Yopf: "\u{1D550}",
        yopf: "\u{1D56A}",
        Yscr: "\u{1D4B4}",
        yscr: "\u{1D4CE}",
        YUcy: "\u042E",
        yucy: "\u044E",
        Yuml: "\u0178",
        yuml: "\xFF",
        Zacute: "\u0179",
        zacute: "\u017A",
        Zcaron: "\u017D",
        zcaron: "\u017E",
        Zcy: "\u0417",
        zcy: "\u0437",
        Zdot: "\u017B",
        zdot: "\u017C",
        zeetrf: "\u2128",
        ZeroWidthSpace: "\u200B",
        Zeta: "\u0396",
        zeta: "\u03B6",
        Zfr: "\u2128",
        zfr: "\u{1D537}",
        ZHcy: "\u0416",
        zhcy: "\u0436",
        zigrarr: "\u21DD",
        Zopf: "\u2124",
        zopf: "\u{1D56B}",
        Zscr: "\u{1D4B5}",
        zscr: "\u{1D4CF}",
        zwj: "\u200D",
        zwnj: "\u200C"
      });
      exports.entityMap = exports.HTML_ENTITIES;
    }
  });

  // node_modules/@xmldom/xmldom/lib/sax.js
  var require_sax = __commonJS({
    "node_modules/@xmldom/xmldom/lib/sax.js"(exports) {
      "use strict";
      var conventions = require_conventions();
      var g = require_grammar();
      var errors = require_errors();
      var isHTMLEscapableRawTextElement = conventions.isHTMLEscapableRawTextElement;
      var isHTMLMimeType = conventions.isHTMLMimeType;
      var isHTMLRawTextElement = conventions.isHTMLRawTextElement;
      var hasOwn = conventions.hasOwn;
      var NAMESPACE = conventions.NAMESPACE;
      var ParseError = errors.ParseError;
      var DOMException = errors.DOMException;
      var S_TAG = 0;
      var S_ATTR = 1;
      var S_ATTR_SPACE = 2;
      var S_EQ = 3;
      var S_ATTR_NOQUOT_VALUE = 4;
      var S_ATTR_END = 5;
      var S_TAG_SPACE = 6;
      var S_TAG_CLOSE = 7;
      function XMLReader() {
      }
      XMLReader.prototype = {
        parse: function(source, defaultNSMap, entityMap) {
          var domBuilder = this.domBuilder;
          domBuilder.startDocument();
          _copy(defaultNSMap, defaultNSMap = /* @__PURE__ */ Object.create(null));
          parse(source, defaultNSMap, entityMap, domBuilder, this.errorHandler);
          domBuilder.endDocument();
        }
      };
      var ENTITY_REG = /&#?\w+;?/g;
      function parse(source, defaultNSMapCopy, entityMap, domBuilder, errorHandler) {
        var isHTML = isHTMLMimeType(domBuilder.mimeType);
        if (source.indexOf(g.UNICODE_REPLACEMENT_CHARACTER) >= 0) {
          errorHandler.warning("Unicode replacement character detected, source encoding issues?");
        }
        function fixedFromCharCode(code) {
          if (code > 65535) {
            code -= 65536;
            var surrogate1 = 55296 + (code >> 10), surrogate2 = 56320 + (code & 1023);
            return String.fromCharCode(surrogate1, surrogate2);
          } else {
            return String.fromCharCode(code);
          }
        }
        function entityReplacer(a2) {
          var complete = a2[a2.length - 1] === ";" ? a2 : a2 + ";";
          if (!isHTML && complete !== a2) {
            errorHandler.error("EntityRef: expecting ;");
            return a2;
          }
          var match = g.Reference.exec(complete);
          if (!match || match[0].length !== complete.length) {
            errorHandler.error("entity not matching Reference production: " + a2);
            return a2;
          }
          var k = complete.slice(1, -1);
          if (hasOwn(entityMap, k)) {
            return entityMap[k];
          } else if (k.charAt(0) === "#") {
            return fixedFromCharCode(parseInt(k.substring(1).replace("x", "0x")));
          } else {
            errorHandler.error("entity not found:" + a2);
            return a2;
          }
        }
        function appendText(end2) {
          if (end2 > start) {
            var xt = source.substring(start, end2).replace(ENTITY_REG, entityReplacer);
            locator && position(start);
            domBuilder.characters(xt, 0, end2 - start);
            start = end2;
          }
        }
        var lineStart = 0;
        var lineEnd = 0;
        var linePattern = /\r\n?|\n|$/g;
        var locator = domBuilder.locator;
        function position(p, m) {
          while (p >= lineEnd && (m = linePattern.exec(source))) {
            lineStart = lineEnd;
            lineEnd = m.index + m[0].length;
            locator.lineNumber++;
          }
          locator.columnNumber = p - lineStart + 1;
        }
        var parseStack = [{ currentNSMap: defaultNSMapCopy }];
        var unclosedTags = [];
        var start = 0;
        while (true) {
          try {
            var tagStart = source.indexOf("<", start);
            if (tagStart < 0) {
              if (!isHTML && unclosedTags.length > 0) {
                return errorHandler.fatalError("unclosed xml tag(s): " + unclosedTags.join(", "));
              }
              if (!source.substring(start).match(/^\s*$/)) {
                var doc = domBuilder.doc;
                var text = doc.createTextNode(source.substring(start));
                if (doc.documentElement) {
                  return errorHandler.error("Extra content at the end of the document");
                }
                doc.appendChild(text);
                domBuilder.currentElement = text;
              }
              return;
            }
            if (tagStart > start) {
              var fromSource = source.substring(start, tagStart);
              if (!isHTML && unclosedTags.length === 0) {
                fromSource = fromSource.replace(new RegExp(g.S_OPT.source, "g"), "");
                fromSource && errorHandler.error("Unexpected content outside root element: '" + fromSource + "'");
              }
              appendText(tagStart);
            }
            switch (source.charAt(tagStart + 1)) {
              case "/":
                var end = source.indexOf(">", tagStart + 2);
                var tagNameRaw = source.substring(tagStart + 2, end > 0 ? end : void 0);
                if (!tagNameRaw) {
                  return errorHandler.fatalError("end tag name missing");
                }
                var tagNameMatch = end > 0 && g.reg("^", g.QName_group, g.S_OPT, "$").exec(tagNameRaw);
                if (!tagNameMatch) {
                  return errorHandler.fatalError('end tag name contains invalid characters: "' + tagNameRaw + '"');
                }
                if (!domBuilder.currentElement && !domBuilder.doc.documentElement) {
                  return;
                }
                var currentTagName = unclosedTags[unclosedTags.length - 1] || domBuilder.currentElement.tagName || domBuilder.doc.documentElement.tagName || "";
                if (currentTagName !== tagNameMatch[1]) {
                  var tagNameLower = tagNameMatch[1].toLowerCase();
                  if (!isHTML || currentTagName.toLowerCase() !== tagNameLower) {
                    return errorHandler.fatalError('Opening and ending tag mismatch: "' + currentTagName + '" != "' + tagNameRaw + '"');
                  }
                }
                var config = parseStack.pop();
                unclosedTags.pop();
                var localNSMap = config.localNSMap;
                domBuilder.endElement(config.uri, config.localName, currentTagName);
                if (localNSMap) {
                  for (var prefix in localNSMap) {
                    if (hasOwn(localNSMap, prefix)) {
                      domBuilder.endPrefixMapping(prefix);
                    }
                  }
                }
                end++;
                break;
              // end element
              case "?":
                locator && position(tagStart);
                end = parseProcessingInstruction(source, tagStart, domBuilder, errorHandler);
                break;
              case "!":
                locator && position(tagStart);
                end = parseDoctypeCommentOrCData(source, tagStart, domBuilder, errorHandler, isHTML);
                break;
              default:
                locator && position(tagStart);
                var el = new ElementAttributes();
                var currentNSMap = parseStack[parseStack.length - 1].currentNSMap;
                var end = parseElementStartPart(source, tagStart, el, currentNSMap, entityReplacer, errorHandler, isHTML);
                var len = el.length;
                if (!el.closed) {
                  if (isHTML && conventions.isHTMLVoidElement(el.tagName)) {
                    el.closed = true;
                  } else {
                    unclosedTags.push(el.tagName);
                  }
                }
                if (locator && len) {
                  var locator2 = copyLocator(locator, {});
                  for (var i = 0; i < len; i++) {
                    var a = el[i];
                    position(a.offset);
                    a.locator = copyLocator(locator, {});
                  }
                  domBuilder.locator = locator2;
                  if (appendElement(el, domBuilder, currentNSMap)) {
                    parseStack.push(el);
                  }
                  domBuilder.locator = locator;
                } else {
                  if (appendElement(el, domBuilder, currentNSMap)) {
                    parseStack.push(el);
                  }
                }
                if (isHTML && !el.closed) {
                  end = parseHtmlSpecialContent(source, end, el.tagName, entityReplacer, domBuilder);
                } else {
                  end++;
                }
            }
          } catch (e) {
            if (e instanceof ParseError) {
              throw e;
            } else if (e instanceof DOMException) {
              throw new ParseError(e.name + ": " + e.message, domBuilder.locator, e);
            }
            errorHandler.error("element parse error: " + e);
            end = -1;
          }
          if (end > start) {
            start = end;
          } else {
            appendText(Math.max(tagStart, start) + 1);
          }
        }
      }
      function copyLocator(f, t) {
        t.lineNumber = f.lineNumber;
        t.columnNumber = f.columnNumber;
        return t;
      }
      function parseElementStartPart(source, start, el, currentNSMap, entityReplacer, errorHandler, isHTML) {
        function addAttribute(qname, value2, startIndex) {
          if (hasOwn(el.attributeNames, qname)) {
            return errorHandler.fatalError("Attribute " + qname + " redefined");
          }
          if (!isHTML && value2.indexOf("<") >= 0) {
            return errorHandler.fatalError("Unescaped '<' not allowed in attributes values");
          }
          el.addValue(
            qname,
            // @see https://www.w3.org/TR/xml/#AVNormalize
            // since the xmldom sax parser does not "interpret" DTD the following is not implemented:
            // - recursive replacement of (DTD) entity references
            // - trimming and collapsing multiple spaces into a single one for attributes that are not of type CDATA
            value2.replace(/[\t\n\r]/g, " ").replace(ENTITY_REG, entityReplacer),
            startIndex
          );
        }
        var attrName;
        var value;
        var p = ++start;
        var s = S_TAG;
        while (true) {
          var c = source.charAt(p);
          switch (c) {
            case "=":
              if (s === S_ATTR) {
                attrName = source.slice(start, p);
                s = S_EQ;
              } else if (s === S_ATTR_SPACE) {
                s = S_EQ;
              } else {
                throw new Error("attribute equal must after attrName");
              }
              break;
            case "'":
            case '"':
              if (s === S_EQ || s === S_ATTR) {
                if (s === S_ATTR) {
                  errorHandler.warning('attribute value must after "="');
                  attrName = source.slice(start, p);
                }
                start = p + 1;
                p = source.indexOf(c, start);
                if (p > 0) {
                  value = source.slice(start, p);
                  addAttribute(attrName, value, start - 1);
                  s = S_ATTR_END;
                } else {
                  throw new Error("attribute value no end '" + c + "' match");
                }
              } else if (s == S_ATTR_NOQUOT_VALUE) {
                value = source.slice(start, p);
                addAttribute(attrName, value, start);
                errorHandler.warning('attribute "' + attrName + '" missed start quot(' + c + ")!!");
                start = p + 1;
                s = S_ATTR_END;
              } else {
                throw new Error('attribute value must after "="');
              }
              break;
            case "/":
              switch (s) {
                case S_TAG:
                  el.setTagName(source.slice(start, p));
                case S_ATTR_END:
                case S_TAG_SPACE:
                case S_TAG_CLOSE:
                  s = S_TAG_CLOSE;
                  el.closed = true;
                case S_ATTR_NOQUOT_VALUE:
                case S_ATTR:
                  break;
                case S_ATTR_SPACE:
                  el.closed = true;
                  break;
                //case S_EQ:
                default:
                  throw new Error("attribute invalid close char('/')");
              }
              break;
            case "":
              errorHandler.error("unexpected end of input");
              if (s == S_TAG) {
                el.setTagName(source.slice(start, p));
              }
              return p;
            case ">":
              switch (s) {
                case S_TAG:
                  el.setTagName(source.slice(start, p));
                case S_ATTR_END:
                case S_TAG_SPACE:
                case S_TAG_CLOSE:
                  break;
                //normal
                case S_ATTR_NOQUOT_VALUE:
                //Compatible state
                case S_ATTR:
                  value = source.slice(start, p);
                  if (value.slice(-1) === "/") {
                    el.closed = true;
                    value = value.slice(0, -1);
                  }
                case S_ATTR_SPACE:
                  if (s === S_ATTR_SPACE) {
                    value = attrName;
                  }
                  if (s == S_ATTR_NOQUOT_VALUE) {
                    errorHandler.warning('attribute "' + value + '" missed quot(")!');
                    addAttribute(attrName, value, start);
                  } else {
                    if (!isHTML) {
                      errorHandler.warning('attribute "' + value + '" missed value!! "' + value + '" instead!!');
                    }
                    addAttribute(value, value, start);
                  }
                  break;
                case S_EQ:
                  if (!isHTML) {
                    return errorHandler.fatalError(`AttValue: ' or " expected`);
                  }
              }
              return p;
            /*xml space '\x20' | #x9 | #xD | #xA; */
            case "\x80":
              c = " ";
            default:
              if (c <= " ") {
                switch (s) {
                  case S_TAG:
                    el.setTagName(source.slice(start, p));
                    s = S_TAG_SPACE;
                    break;
                  case S_ATTR:
                    attrName = source.slice(start, p);
                    s = S_ATTR_SPACE;
                    break;
                  case S_ATTR_NOQUOT_VALUE:
                    var value = source.slice(start, p);
                    errorHandler.warning('attribute "' + value + '" missed quot(")!!');
                    addAttribute(attrName, value, start);
                  case S_ATTR_END:
                    s = S_TAG_SPACE;
                    break;
                }
              } else {
                switch (s) {
                  //case S_TAG:void();break;
                  //case S_ATTR:void();break;
                  //case S_ATTR_NOQUOT_VALUE:void();break;
                  case S_ATTR_SPACE:
                    if (!isHTML) {
                      errorHandler.warning('attribute "' + attrName + '" missed value!! "' + attrName + '" instead2!!');
                    }
                    addAttribute(attrName, attrName, start);
                    start = p;
                    s = S_ATTR;
                    break;
                  case S_ATTR_END:
                    errorHandler.warning('attribute space is required"' + attrName + '"!!');
                  case S_TAG_SPACE:
                    s = S_ATTR;
                    start = p;
                    break;
                  case S_EQ:
                    s = S_ATTR_NOQUOT_VALUE;
                    start = p;
                    break;
                  case S_TAG_CLOSE:
                    throw new Error("elements closed character '/' and '>' must be connected to");
                }
              }
          }
          p++;
        }
      }
      function appendElement(el, domBuilder, currentNSMap) {
        var tagName = el.tagName;
        var localNSMap = null;
        var i = el.length;
        while (i--) {
          var a = el[i];
          var qName = a.qName;
          var value = a.value;
          var nsp = qName.indexOf(":");
          if (nsp > 0) {
            var prefix = a.prefix = qName.slice(0, nsp);
            var localName = qName.slice(nsp + 1);
            var nsPrefix = prefix === "xmlns" && localName;
          } else {
            localName = qName;
            prefix = null;
            nsPrefix = qName === "xmlns" && "";
          }
          a.localName = localName;
          if (nsPrefix !== false) {
            if (localNSMap == null) {
              localNSMap = /* @__PURE__ */ Object.create(null);
              _copy(currentNSMap, currentNSMap = /* @__PURE__ */ Object.create(null));
            }
            currentNSMap[nsPrefix] = localNSMap[nsPrefix] = value;
            a.uri = NAMESPACE.XMLNS;
            domBuilder.startPrefixMapping(nsPrefix, value);
          }
        }
        var i = el.length;
        while (i--) {
          a = el[i];
          if (a.prefix) {
            if (a.prefix === "xml") {
              a.uri = NAMESPACE.XML;
            }
            if (a.prefix !== "xmlns") {
              a.uri = currentNSMap[a.prefix];
            }
          }
        }
        var nsp = tagName.indexOf(":");
        if (nsp > 0) {
          prefix = el.prefix = tagName.slice(0, nsp);
          localName = el.localName = tagName.slice(nsp + 1);
        } else {
          prefix = null;
          localName = el.localName = tagName;
        }
        var ns = el.uri = currentNSMap[prefix || ""];
        domBuilder.startElement(ns, localName, tagName, el);
        if (el.closed) {
          domBuilder.endElement(ns, localName, tagName);
          if (localNSMap) {
            for (prefix in localNSMap) {
              if (hasOwn(localNSMap, prefix)) {
                domBuilder.endPrefixMapping(prefix);
              }
            }
          }
        } else {
          el.currentNSMap = currentNSMap;
          el.localNSMap = localNSMap;
          return true;
        }
      }
      function parseHtmlSpecialContent(source, elStartEnd, tagName, entityReplacer, domBuilder) {
        var isEscapableRaw = isHTMLEscapableRawTextElement(tagName);
        if (isEscapableRaw || isHTMLRawTextElement(tagName)) {
          var elEndStart = source.indexOf("</" + tagName + ">", elStartEnd);
          var text = source.substring(elStartEnd + 1, elEndStart);
          if (isEscapableRaw) {
            text = text.replace(ENTITY_REG, entityReplacer);
          }
          domBuilder.characters(text, 0, text.length);
          return elEndStart;
        }
        return elStartEnd + 1;
      }
      function _copy(source, target) {
        for (var n in source) {
          if (hasOwn(source, n)) {
            target[n] = source[n];
          }
        }
      }
      function parseUtils(source, start) {
        var index = start;
        function char(n) {
          n = n || 0;
          return source.charAt(index + n);
        }
        function skip(n) {
          n = n || 1;
          index += n;
        }
        function skipBlanks() {
          var blanks = 0;
          while (index < source.length) {
            var c = char();
            if (c !== " " && c !== "\n" && c !== "	" && c !== "\r") {
              return blanks;
            }
            blanks++;
            skip();
          }
          return -1;
        }
        function substringFromIndex() {
          return source.substring(index);
        }
        function substringStartsWith(text) {
          return source.substring(index, index + text.length) === text;
        }
        function substringStartsWithCaseInsensitive(text) {
          return source.substring(index, index + text.length).toUpperCase() === text.toUpperCase();
        }
        function getMatch(args) {
          var expr = g.reg("^", args);
          var match = expr.exec(substringFromIndex());
          if (match) {
            skip(match[0].length);
            return match[0];
          }
          return null;
        }
        return {
          char,
          getIndex: function() {
            return index;
          },
          getMatch,
          getSource: function() {
            return source;
          },
          skip,
          skipBlanks,
          substringFromIndex,
          substringStartsWith,
          substringStartsWithCaseInsensitive
        };
      }
      function parseDoctypeInternalSubset(p, errorHandler) {
        function parsePI(p2, errorHandler2) {
          var match = g.PI.exec(p2.substringFromIndex());
          if (!match) {
            return errorHandler2.fatalError("processing instruction is not well-formed at position " + p2.getIndex());
          }
          if (match[1].toLowerCase() === "xml") {
            return errorHandler2.fatalError(
              "xml declaration is only allowed at the start of the document, but found at position " + p2.getIndex()
            );
          }
          p2.skip(match[0].length);
          return match[0];
        }
        var source = p.getSource();
        if (p.char() === "[") {
          p.skip(1);
          var intSubsetStart = p.getIndex();
          while (p.getIndex() < source.length) {
            p.skipBlanks();
            if (p.char() === "]") {
              var internalSubset = source.substring(intSubsetStart, p.getIndex());
              p.skip(1);
              return internalSubset;
            }
            var current = null;
            if (p.char() === "<" && p.char(1) === "!") {
              switch (p.char(2)) {
                case "E":
                  if (p.char(3) === "L") {
                    current = p.getMatch(g.elementdecl);
                  } else if (p.char(3) === "N") {
                    current = p.getMatch(g.EntityDecl);
                  }
                  break;
                case "A":
                  current = p.getMatch(g.AttlistDecl);
                  break;
                case "N":
                  current = p.getMatch(g.NotationDecl);
                  break;
                case "-":
                  current = p.getMatch(g.Comment);
                  break;
              }
            } else if (p.char() === "<" && p.char(1) === "?") {
              current = parsePI(p, errorHandler);
            } else if (p.char() === "%") {
              current = p.getMatch(g.PEReference);
            } else {
              return errorHandler.fatalError("Error detected in Markup declaration");
            }
            if (!current) {
              return errorHandler.fatalError("Error in internal subset at position " + p.getIndex());
            }
          }
          return errorHandler.fatalError("doctype internal subset is not well-formed, missing ]");
        }
      }
      function parseDoctypeCommentOrCData(source, start, domBuilder, errorHandler, isHTML) {
        var p = parseUtils(source, start);
        switch (isHTML ? p.char(2).toUpperCase() : p.char(2)) {
          case "-":
            var comment = p.getMatch(g.Comment);
            if (comment) {
              domBuilder.comment(comment, g.COMMENT_START.length, comment.length - g.COMMENT_START.length - g.COMMENT_END.length);
              return p.getIndex();
            } else {
              return errorHandler.fatalError("comment is not well-formed at position " + p.getIndex());
            }
          case "[":
            var cdata = p.getMatch(g.CDSect);
            if (cdata) {
              if (!isHTML && !domBuilder.currentElement) {
                return errorHandler.fatalError("CDATA outside of element");
              }
              domBuilder.startCDATA();
              domBuilder.characters(cdata, g.CDATA_START.length, cdata.length - g.CDATA_START.length - g.CDATA_END.length);
              domBuilder.endCDATA();
              return p.getIndex();
            } else {
              return errorHandler.fatalError("Invalid CDATA starting at position " + start);
            }
          case "D": {
            if (domBuilder.doc && domBuilder.doc.documentElement) {
              return errorHandler.fatalError("Doctype not allowed inside or after documentElement at position " + p.getIndex());
            }
            if (isHTML ? !p.substringStartsWithCaseInsensitive(g.DOCTYPE_DECL_START) : !p.substringStartsWith(g.DOCTYPE_DECL_START)) {
              return errorHandler.fatalError("Expected " + g.DOCTYPE_DECL_START + " at position " + p.getIndex());
            }
            p.skip(g.DOCTYPE_DECL_START.length);
            if (p.skipBlanks() < 1) {
              return errorHandler.fatalError("Expected whitespace after " + g.DOCTYPE_DECL_START + " at position " + p.getIndex());
            }
            var doctype = {
              name: void 0,
              publicId: void 0,
              systemId: void 0,
              internalSubset: void 0
            };
            doctype.name = p.getMatch(g.Name);
            if (!doctype.name)
              return errorHandler.fatalError("doctype name missing or contains unexpected characters at position " + p.getIndex());
            if (isHTML && doctype.name.toLowerCase() !== "html") {
              errorHandler.warning("Unexpected DOCTYPE in HTML document at position " + p.getIndex());
            }
            p.skipBlanks();
            if (p.substringStartsWith(g.PUBLIC) || p.substringStartsWith(g.SYSTEM)) {
              var match = g.ExternalID_match.exec(p.substringFromIndex());
              if (!match) {
                return errorHandler.fatalError("doctype external id is not well-formed at position " + p.getIndex());
              }
              if (match.groups.SystemLiteralOnly !== void 0) {
                doctype.systemId = match.groups.SystemLiteralOnly;
              } else {
                doctype.systemId = match.groups.SystemLiteral;
                doctype.publicId = match.groups.PubidLiteral;
              }
              p.skip(match[0].length);
            } else if (isHTML && p.substringStartsWithCaseInsensitive(g.SYSTEM)) {
              p.skip(g.SYSTEM.length);
              if (p.skipBlanks() < 1) {
                return errorHandler.fatalError("Expected whitespace after " + g.SYSTEM + " at position " + p.getIndex());
              }
              doctype.systemId = p.getMatch(g.ABOUT_LEGACY_COMPAT_SystemLiteral);
              if (!doctype.systemId) {
                return errorHandler.fatalError(
                  "Expected " + g.ABOUT_LEGACY_COMPAT + " in single or double quotes after " + g.SYSTEM + " at position " + p.getIndex()
                );
              }
            }
            if (isHTML && doctype.systemId && !g.ABOUT_LEGACY_COMPAT_SystemLiteral.test(doctype.systemId)) {
              errorHandler.warning("Unexpected doctype.systemId in HTML document at position " + p.getIndex());
            }
            if (!isHTML) {
              p.skipBlanks();
              doctype.internalSubset = parseDoctypeInternalSubset(p, errorHandler);
            }
            p.skipBlanks();
            if (p.char() !== ">") {
              return errorHandler.fatalError("doctype not terminated with > at position " + p.getIndex());
            }
            p.skip(1);
            domBuilder.startDTD(doctype.name, doctype.publicId, doctype.systemId, doctype.internalSubset);
            domBuilder.endDTD();
            return p.getIndex();
          }
          default:
            return errorHandler.fatalError('Not well-formed XML starting with "<!" at position ' + start);
        }
      }
      function parseProcessingInstruction(source, start, domBuilder, errorHandler) {
        var match = source.substring(start).match(g.PI);
        if (!match) {
          return errorHandler.fatalError("Invalid processing instruction starting at position " + start);
        }
        if (match[1].toLowerCase() === "xml") {
          if (start > 0) {
            return errorHandler.fatalError(
              "processing instruction at position " + start + " is an xml declaration which is only at the start of the document"
            );
          }
          if (!g.XMLDecl.test(source.substring(start))) {
            return errorHandler.fatalError("xml declaration is not well-formed");
          }
        }
        domBuilder.processingInstruction(match[1], match[2]);
        return start + match[0].length;
      }
      function ElementAttributes() {
        this.attributeNames = /* @__PURE__ */ Object.create(null);
      }
      ElementAttributes.prototype = {
        setTagName: function(tagName) {
          if (!g.QName_exact.test(tagName)) {
            throw new Error("invalid tagName:" + tagName);
          }
          this.tagName = tagName;
        },
        addValue: function(qName, value, offset) {
          if (!g.QName_exact.test(qName)) {
            throw new Error("invalid attribute:" + qName);
          }
          this.attributeNames[qName] = this.length;
          this[this.length++] = { qName, value, offset };
        },
        length: 0,
        getLocalName: function(i) {
          return this[i].localName;
        },
        getLocator: function(i) {
          return this[i].locator;
        },
        getQName: function(i) {
          return this[i].qName;
        },
        getURI: function(i) {
          return this[i].uri;
        },
        getValue: function(i) {
          return this[i].value;
        }
        //	,getIndex:function(uri, localName)){
        //		if(localName){
        //
        //		}else{
        //			var qName = uri
        //		}
        //	},
        //	getValue:function(){return this.getValue(this.getIndex.apply(this,arguments))},
        //	getType:function(uri,localName){}
        //	getType:function(i){},
      };
      exports.XMLReader = XMLReader;
      exports.parseUtils = parseUtils;
      exports.parseDoctypeCommentOrCData = parseDoctypeCommentOrCData;
    }
  });

  // node_modules/@xmldom/xmldom/lib/dom-parser.js
  var require_dom_parser = __commonJS({
    "node_modules/@xmldom/xmldom/lib/dom-parser.js"(exports) {
      "use strict";
      var conventions = require_conventions();
      var dom = require_dom();
      var errors = require_errors();
      var entities = require_entities();
      var sax = require_sax();
      var DOMImplementation = dom.DOMImplementation;
      var hasDefaultHTMLNamespace = conventions.hasDefaultHTMLNamespace;
      var isHTMLMimeType = conventions.isHTMLMimeType;
      var isValidMimeType = conventions.isValidMimeType;
      var MIME_TYPE = conventions.MIME_TYPE;
      var NAMESPACE = conventions.NAMESPACE;
      var ParseError = errors.ParseError;
      var XMLReader = sax.XMLReader;
      function normalizeLineEndings(input) {
        return input.replace(/\r[\n\u0085]/g, "\n").replace(/[\r\u0085\u2028\u2029]/g, "\n");
      }
      function DOMParser(options) {
        options = options || {};
        if (options.locator === void 0) {
          options.locator = true;
        }
        this.assign = options.assign || conventions.assign;
        this.domHandler = options.domHandler || DOMHandler;
        this.onError = options.onError || options.errorHandler;
        if (options.errorHandler && typeof options.errorHandler !== "function") {
          throw new TypeError("errorHandler object is no longer supported, switch to onError!");
        } else if (options.errorHandler) {
          options.errorHandler("warning", "The `errorHandler` option has been deprecated, use `onError` instead!", this);
        }
        this.normalizeLineEndings = options.normalizeLineEndings || normalizeLineEndings;
        this.locator = !!options.locator;
        this.xmlns = this.assign(/* @__PURE__ */ Object.create(null), options.xmlns);
      }
      DOMParser.prototype.parseFromString = function(source, mimeType) {
        if (!isValidMimeType(mimeType)) {
          throw new TypeError('DOMParser.parseFromString: the provided mimeType "' + mimeType + '" is not valid.');
        }
        var defaultNSMap = this.assign(/* @__PURE__ */ Object.create(null), this.xmlns);
        var entityMap = entities.XML_ENTITIES;
        var defaultNamespace = defaultNSMap[""] || null;
        if (hasDefaultHTMLNamespace(mimeType)) {
          entityMap = entities.HTML_ENTITIES;
          defaultNamespace = NAMESPACE.HTML;
        } else if (mimeType === MIME_TYPE.XML_SVG_IMAGE) {
          defaultNamespace = NAMESPACE.SVG;
        }
        defaultNSMap[""] = defaultNamespace;
        defaultNSMap.xml = defaultNSMap.xml || NAMESPACE.XML;
        var domBuilder = new this.domHandler({
          mimeType,
          defaultNamespace,
          onError: this.onError
        });
        var locator = this.locator ? {} : void 0;
        if (this.locator) {
          domBuilder.setDocumentLocator(locator);
        }
        var sax2 = new XMLReader();
        sax2.errorHandler = domBuilder;
        sax2.domBuilder = domBuilder;
        var isXml = !conventions.isHTMLMimeType(mimeType);
        if (isXml && typeof source !== "string") {
          sax2.errorHandler.fatalError("source is not a string");
        }
        sax2.parse(this.normalizeLineEndings(String(source)), defaultNSMap, entityMap);
        if (!domBuilder.doc.documentElement) {
          sax2.errorHandler.fatalError("missing root element");
        }
        return domBuilder.doc;
      };
      function DOMHandler(options) {
        var opt = options || {};
        this.mimeType = opt.mimeType || MIME_TYPE.XML_APPLICATION;
        this.defaultNamespace = opt.defaultNamespace || null;
        this.cdata = false;
        this.currentElement = void 0;
        this.doc = void 0;
        this.locator = void 0;
        this.onError = opt.onError;
      }
      function position(locator, node) {
        node.lineNumber = locator.lineNumber;
        node.columnNumber = locator.columnNumber;
      }
      DOMHandler.prototype = {
        /**
         * Either creates an XML or an HTML document and stores it under `this.doc`.
         * If it is an XML document, `this.defaultNamespace` is used to create it,
         * and it will not contain any `childNodes`.
         * If it is an HTML document, it will be created without any `childNodes`.
         *
         * @see http://www.saxproject.org/apidoc/org/xml/sax/ContentHandler.html
         */
        startDocument: function() {
          var impl = new DOMImplementation();
          this.doc = isHTMLMimeType(this.mimeType) ? impl.createHTMLDocument(false) : impl.createDocument(this.defaultNamespace, "");
        },
        startElement: function(namespaceURI, localName, qName, attrs) {
          var doc = this.doc;
          var el = doc.createElementNS(namespaceURI, qName || localName);
          var len = attrs.length;
          appendElement(this, el);
          this.currentElement = el;
          this.locator && position(this.locator, el);
          for (var i = 0; i < len; i++) {
            var namespaceURI = attrs.getURI(i);
            var value = attrs.getValue(i);
            var qName = attrs.getQName(i);
            var attr = doc.createAttributeNS(namespaceURI, qName);
            this.locator && position(attrs.getLocator(i), attr);
            attr.value = attr.nodeValue = value;
            el.setAttributeNode(attr);
          }
        },
        endElement: function(namespaceURI, localName, qName) {
          this.currentElement = this.currentElement.parentNode;
        },
        startPrefixMapping: function(prefix, uri) {
        },
        endPrefixMapping: function(prefix) {
        },
        processingInstruction: function(target, data) {
          var ins = this.doc.createProcessingInstruction(target, data);
          this.locator && position(this.locator, ins);
          appendElement(this, ins);
        },
        ignorableWhitespace: function(ch, start, length) {
        },
        characters: function(chars, start, length) {
          chars = _toString.apply(this, arguments);
          if (chars) {
            if (this.cdata) {
              var charNode = this.doc.createCDATASection(chars);
            } else {
              var charNode = this.doc.createTextNode(chars);
            }
            if (this.currentElement) {
              this.currentElement.appendChild(charNode);
            } else if (/^\s*$/.test(chars)) {
              this.doc.appendChild(charNode);
            }
            this.locator && position(this.locator, charNode);
          }
        },
        skippedEntity: function(name) {
        },
        endDocument: function() {
          this.doc.normalize();
        },
        /**
         * Stores the locator to be able to set the `columnNumber` and `lineNumber`
         * on the created DOM nodes.
         *
         * @param {Locator} locator
         */
        setDocumentLocator: function(locator) {
          if (locator) {
            locator.lineNumber = 0;
          }
          this.locator = locator;
        },
        //LexicalHandler
        comment: function(chars, start, length) {
          chars = _toString.apply(this, arguments);
          var comm = this.doc.createComment(chars);
          this.locator && position(this.locator, comm);
          appendElement(this, comm);
        },
        startCDATA: function() {
          this.cdata = true;
        },
        endCDATA: function() {
          this.cdata = false;
        },
        startDTD: function(name, publicId, systemId, internalSubset) {
          var impl = this.doc.implementation;
          if (impl && impl.createDocumentType) {
            var dt = impl.createDocumentType(name, publicId, systemId, internalSubset);
            this.locator && position(this.locator, dt);
            appendElement(this, dt);
            this.doc.doctype = dt;
          }
        },
        reportError: function(level, message) {
          if (typeof this.onError === "function") {
            try {
              this.onError(level, message, this);
            } catch (e) {
              throw new ParseError("Reporting " + level + ' "' + message + '" caused ' + e, this.locator);
            }
          } else {
            console.error("[xmldom " + level + "]	" + message, _locator(this.locator));
          }
        },
        /**
         * @see http://www.saxproject.org/apidoc/org/xml/sax/ErrorHandler.html
         */
        warning: function(message) {
          this.reportError("warning", message);
        },
        error: function(message) {
          this.reportError("error", message);
        },
        /**
         * This function reports a fatal error and throws a ParseError.
         *
         * @param {string} message
         * - The message to be used for reporting and throwing the error.
         * @returns {never}
         * This function always throws an error and never returns a value.
         * @throws {ParseError}
         * Always throws a ParseError with the provided message.
         */
        fatalError: function(message) {
          this.reportError("fatalError", message);
          throw new ParseError(message, this.locator);
        }
      };
      function _locator(l) {
        if (l) {
          return "\n@#[line:" + l.lineNumber + ",col:" + l.columnNumber + "]";
        }
      }
      function _toString(chars, start, length) {
        if (typeof chars == "string") {
          return chars.substr(start, length);
        } else {
          if (chars.length >= start + length || start) {
            return new java.lang.String(chars, start, length) + "";
          }
          return chars;
        }
      }
      "endDTD,startEntity,endEntity,attributeDecl,elementDecl,externalEntityDecl,internalEntityDecl,resolveEntity,getExternalSubset,notationDecl,unparsedEntityDecl".replace(
        /\w+/g,
        function(key) {
          DOMHandler.prototype[key] = function() {
            return null;
          };
        }
      );
      function appendElement(handler, node) {
        if (!handler.currentElement) {
          handler.doc.appendChild(node);
        } else {
          handler.currentElement.appendChild(node);
        }
      }
      function onErrorStopParsing(level) {
        if (level === "error") throw "onErrorStopParsing";
      }
      function onWarningStopParsing() {
        throw "onWarningStopParsing";
      }
      exports.__DOMHandler = DOMHandler;
      exports.DOMParser = DOMParser;
      exports.normalizeLineEndings = normalizeLineEndings;
      exports.onErrorStopParsing = onErrorStopParsing;
      exports.onWarningStopParsing = onWarningStopParsing;
    }
  });

  // node_modules/@xmldom/xmldom/lib/index.js
  var require_lib = __commonJS({
    "node_modules/@xmldom/xmldom/lib/index.js"(exports) {
      "use strict";
      var conventions = require_conventions();
      exports.assign = conventions.assign;
      exports.hasDefaultHTMLNamespace = conventions.hasDefaultHTMLNamespace;
      exports.isHTMLMimeType = conventions.isHTMLMimeType;
      exports.isValidMimeType = conventions.isValidMimeType;
      exports.MIME_TYPE = conventions.MIME_TYPE;
      exports.NAMESPACE = conventions.NAMESPACE;
      var errors = require_errors();
      exports.DOMException = errors.DOMException;
      exports.DOMExceptionName = errors.DOMExceptionName;
      exports.ExceptionCode = errors.ExceptionCode;
      exports.ParseError = errors.ParseError;
      var dom = require_dom();
      exports.Attr = dom.Attr;
      exports.CDATASection = dom.CDATASection;
      exports.CharacterData = dom.CharacterData;
      exports.Comment = dom.Comment;
      exports.Document = dom.Document;
      exports.DocumentFragment = dom.DocumentFragment;
      exports.DocumentType = dom.DocumentType;
      exports.DOMImplementation = dom.DOMImplementation;
      exports.Element = dom.Element;
      exports.Entity = dom.Entity;
      exports.EntityReference = dom.EntityReference;
      exports.LiveNodeList = dom.LiveNodeList;
      exports.NamedNodeMap = dom.NamedNodeMap;
      exports.Node = dom.Node;
      exports.NodeList = dom.NodeList;
      exports.Notation = dom.Notation;
      exports.ProcessingInstruction = dom.ProcessingInstruction;
      exports.Text = dom.Text;
      exports.XMLSerializer = dom.XMLSerializer;
      var domParser = require_dom_parser();
      exports.DOMParser = domParser.DOMParser;
      exports.normalizeLineEndings = domParser.normalizeLineEndings;
      exports.onErrorStopParsing = domParser.onErrorStopParsing;
      exports.onWarningStopParsing = domParser.onWarningStopParsing;
    }
  });

  // node_modules/docxtemplater/js/utils.js
  var require_utils2 = __commonJS({
    "node_modules/docxtemplater/js/utils.js"(exports, module) {
      "use strict";
      function last(a) {
        return a[a.length - 1];
      }
      function first(a) {
        return a[0];
      }
      module.exports = {
        last,
        first
      };
    }
  });

  // node_modules/docxtemplater/js/errors.js
  var require_errors2 = __commonJS({
    "node_modules/docxtemplater/js/errors.js"(exports, module) {
      "use strict";
      function _typeof(o) {
        "@babel/helpers - typeof";
        return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }
      function ownKeys(e, r) {
        var t = Object.keys(e);
        if (Object.getOwnPropertySymbols) {
          var o = Object.getOwnPropertySymbols(e);
          r && (o = o.filter(function(r2) {
            return Object.getOwnPropertyDescriptor(e, r2).enumerable;
          })), t.push.apply(t, o);
        }
        return t;
      }
      function _objectSpread(e) {
        for (var r = 1; r < arguments.length; r++) {
          var t = null != arguments[r] ? arguments[r] : {};
          r % 2 ? ownKeys(Object(t), true).forEach(function(r2) {
            _defineProperty(e, r2, t[r2]);
          }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r2) {
            Object.defineProperty(e, r2, Object.getOwnPropertyDescriptor(t, r2));
          });
        }
        return e;
      }
      function _defineProperty(e, r, t) {
        return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: true, configurable: true, writable: true }) : e[r] = t, e;
      }
      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");
        return "symbol" == _typeof(i) ? i : i + "";
      }
      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];
        if (void 0 !== e) {
          var i = e.call(t, r || "default");
          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }
        return ("string" === r ? String : Number)(t);
      }
      var _require = require_utils2();
      var last = _require.last;
      var first = _require.first;
      function XTError(message) {
        this.name = "GenericError";
        this.message = message;
        this.stack = new Error(message).stack;
      }
      XTError.prototype = Error.prototype;
      function XTTemplateError(message) {
        this.name = "TemplateError";
        this.message = message;
        this.stack = new Error(message).stack;
      }
      XTTemplateError.prototype = new XTError();
      function XTRenderingError(message) {
        this.name = "RenderingError";
        this.message = message;
        this.stack = new Error(message).stack;
      }
      XTRenderingError.prototype = new XTError();
      function XTScopeParserError(message) {
        this.name = "ScopeParserError";
        this.message = message;
        this.stack = new Error(message).stack;
      }
      XTScopeParserError.prototype = new XTError();
      function XTInternalError(message) {
        this.name = "InternalError";
        this.properties = {
          explanation: "InternalError"
        };
        this.message = message;
        this.stack = new Error(message).stack;
      }
      XTInternalError.prototype = new XTError();
      function XTAPIVersionError(message) {
        this.name = "APIVersionError";
        this.properties = {
          explanation: "APIVersionError"
        };
        this.message = message;
        this.stack = new Error(message).stack;
      }
      XTAPIVersionError.prototype = new XTError();
      function throwApiVersionError(msg, properties) {
        var err = new XTAPIVersionError(msg);
        err.properties = _objectSpread({
          id: "api_version_error"
        }, properties);
        throw err;
      }
      function throwFileTypeNotIdentified(zip) {
        var files = Object.keys(zip.files).slice(0, 10);
        var msg = "";
        if (files.length === 0) {
          msg = "Empty zip file";
        } else {
          msg = "Zip file contains : ".concat(files.join(","));
        }
        var err = new XTInternalError("The filetype for this file could not be identified, is this file corrupted ? ".concat(msg));
        err.properties = {
          id: "filetype_not_identified",
          explanation: "The filetype for this file could not be identified, is this file corrupted ? ".concat(msg)
        };
        throw err;
      }
      function throwFileTypeNotHandled(fileType) {
        var err = new XTInternalError('The filetype "'.concat(fileType, '" is not handled by docxtemplater'));
        err.properties = {
          id: "filetype_not_handled",
          explanation: 'The file you are trying to generate is of type "'.concat(fileType, '", but only docx and pptx formats are handled'),
          fileType
        };
        throw err;
      }
      function throwMultiError(errors) {
        var err = new XTTemplateError("Multi error");
        err.properties = {
          errors,
          id: "multi_error",
          explanation: "The template has multiple errors"
        };
        throw err;
      }
      function getUnopenedTagException(options) {
        var err = new XTTemplateError("Unopened tag");
        err.properties = {
          xtag: last(options.xtag.split(" ")),
          id: "unopened_tag",
          context: options.xtag,
          offset: options.offset,
          lIndex: options.lIndex,
          explanation: 'The tag beginning with "'.concat(options.xtag.substr(0, 30), '" is unopened')
        };
        return err;
      }
      function getDuplicateOpenTagException(options) {
        var err = new XTTemplateError("Duplicate open tag, expected one open tag");
        err.properties = {
          xtag: first(options.xtag.split(" ")),
          id: "duplicate_open_tag",
          context: options.xtag,
          offset: options.offset,
          lIndex: options.lIndex,
          explanation: 'The tag beginning with "'.concat(options.xtag.substr(0, 30), '" has duplicate open tags')
        };
        return err;
      }
      function getDuplicateCloseTagException(options) {
        var err = new XTTemplateError("Duplicate close tag, expected one close tag");
        err.properties = {
          xtag: first(options.xtag.split(" ")),
          id: "duplicate_close_tag",
          context: options.xtag,
          offset: options.offset,
          lIndex: options.lIndex,
          explanation: 'The tag ending with "'.concat(options.xtag.substr(0, 30), '" has duplicate close tags')
        };
        return err;
      }
      function getUnclosedTagException(options) {
        var err = new XTTemplateError("Unclosed tag");
        err.properties = {
          xtag: first(options.xtag.split(" ")).substr(1),
          // name
          id: "unclosed_tag",
          context: options.xtag,
          offset: options.offset,
          lIndex: options.lIndex,
          explanation: 'The tag beginning with "'.concat(options.xtag.substr(0, 30), '" is unclosed')
        };
        return err;
      }
      function throwXmlTagNotFound(options) {
        if (options.position === "left") {
          throwXmlTagNotFoundLeft(options);
        } else {
          throwXmlTagNotFoundRight(options);
        }
      }
      function throwXmlTagNotFoundLeft(options) {
        var err = new XTTemplateError('No tag "'.concat(options.element, '" was found at the ').concat(options.position));
        var part = options.parsed[options.index];
        err.properties = {
          id: "no_xml_tag_found_at_left",
          explanation: 'No tag "'.concat(options.element, '" was found at the left'),
          offset: part.offset,
          part,
          parsed: options.parsed,
          index: options.index,
          element: options.element
        };
        throw err;
      }
      function throwXmlTagNotFoundRight(options) {
        var err = new XTTemplateError('No tag "'.concat(options.element, '" was found at the ').concat(options.position));
        var part = options.parsed[options.index];
        err.properties = {
          id: "no_xml_tag_found_at_right",
          explanation: 'No tag "'.concat(options.element, '" was found at the right'),
          offset: part.offset,
          part,
          parsed: options.parsed,
          index: options.index,
          element: options.element
        };
        throw err;
      }
      function getCorruptCharactersException(_ref) {
        var tag = _ref.tag, value = _ref.value, offset = _ref.offset;
        var err = new XTRenderingError("There are some XML corrupt characters");
        err.properties = {
          id: "invalid_xml_characters",
          xtag: tag,
          value,
          offset,
          explanation: 'There are some corrupt characters for the field "'.concat(tag, '"')
        };
        return err;
      }
      function getInvalidRawXMLValueException(_ref2) {
        var tag = _ref2.tag, value = _ref2.value, offset = _ref2.offset, partDelims = _ref2.partDelims;
        var err = new XTRenderingError("Non string values are not allowed for rawXML tags");
        err.properties = {
          id: "invalid_raw_xml_value",
          xtag: tag,
          value,
          offset,
          explanation: 'The value of the raw tag : "'.concat(partDelims, '" is not a string')
        };
        return err;
      }
      function throwExpandNotFound(options) {
        var _options$part = options.part, value = _options$part.value, offset = _options$part.offset, _options$id = options.id, id = _options$id === void 0 ? "raw_tag_outerxml_invalid" : _options$id, _options$message = options.message, message = _options$message === void 0 ? "Raw tag not in paragraph" : _options$message;
        var part = options.part;
        var _options$explanation = options.explanation, explanation = _options$explanation === void 0 ? 'The tag "'.concat(value, '" is not inside a paragraph') : _options$explanation;
        if (typeof explanation === "function") {
          explanation = explanation(part);
        }
        var err = new XTTemplateError(message);
        err.properties = {
          id,
          explanation,
          rootError: options.rootError,
          xtag: value,
          offset,
          postparsed: options.postparsed,
          expandTo: options.expandTo,
          index: options.index
        };
        throw err;
      }
      function throwRawTagShouldBeOnlyTextInParagraph(options) {
        var err = new XTTemplateError("Raw tag should be the only text in paragraph");
        var tag = options.part.value;
        err.properties = {
          id: "raw_xml_tag_should_be_only_text_in_paragraph",
          explanation: 'The raw tag "'.concat(tag, '" should be the only text in this paragraph. This means that this tag should not be surrounded by any text or spaces.'),
          xtag: tag,
          offset: options.part.offset,
          paragraphParts: options.paragraphParts
        };
        throw err;
      }
      function getUnmatchedLoopException(part) {
        var location = part.location, offset = part.offset, square = part.square;
        var t = location === "start" ? "unclosed" : "unopened";
        var T = location === "start" ? "Unclosed" : "Unopened";
        var err = new XTTemplateError("".concat(T, " loop"));
        var tag = part.value;
        err.properties = {
          id: "".concat(t, "_loop"),
          explanation: 'The loop with tag "'.concat(tag, '" is ').concat(t),
          xtag: tag,
          offset
        };
        if (square) {
          err.properties.square = square;
        }
        return err;
      }
      function getUnbalancedLoopException(pair, lastPair) {
        var err = new XTTemplateError("Unbalanced loop tag");
        var lastL = lastPair[0].part.value;
        var lastR = lastPair[1].part.value;
        var l = pair[0].part.value;
        var r = pair[1].part.value;
        err.properties = {
          id: "unbalanced_loop_tags",
          explanation: "Unbalanced loop tags {#".concat(lastL, "}{/").concat(lastR, "}{#").concat(l, "}{/").concat(r, "}"),
          offset: [lastPair[0].part.offset, pair[1].part.offset],
          lastPair: {
            left: lastPair[0].part.value,
            right: lastPair[1].part.value
          },
          pair: {
            left: pair[0].part.value,
            right: pair[1].part.value
          }
        };
        return err;
      }
      function getClosingTagNotMatchOpeningTag(_ref3) {
        var tags = _ref3.tags;
        var err = new XTTemplateError("Closing tag does not match opening tag");
        err.properties = {
          id: "closing_tag_does_not_match_opening_tag",
          explanation: 'The tag "'.concat(tags[0].value, '" is closed by the tag "').concat(tags[1].value, '"'),
          openingtag: first(tags).value,
          offset: [first(tags).offset, last(tags).offset],
          closingtag: last(tags).value
        };
        if (first(tags).square) {
          err.properties.square = [first(tags).square, last(tags).square];
        }
        return err;
      }
      function getLoopPositionProducesInvalidXMLError(_ref4) {
        var tag = _ref4.tag, offset = _ref4.offset;
        var err = new XTTemplateError('The position of the loop tags "'.concat(tag, '" would produce invalid XML'));
        err.properties = {
          xtag: tag,
          id: "loop_position_invalid",
          explanation: 'The tags "'.concat(tag, '" are misplaced in the document, for example one of them is in a table and the other one outside the table'),
          offset
        };
        return err;
      }
      function getScopeCompilationError(_ref5) {
        var tag = _ref5.tag, rootError = _ref5.rootError, offset = _ref5.offset;
        var err = new XTScopeParserError("Scope parser compilation failed");
        err.properties = {
          id: "scopeparser_compilation_failed",
          offset,
          xtag: tag,
          explanation: 'The scope parser for the tag "'.concat(tag, '" failed to compile'),
          rootError
        };
        return err;
      }
      function getScopeParserExecutionError(_ref6) {
        var tag = _ref6.tag, scope = _ref6.scope, error = _ref6.error, offset = _ref6.offset;
        var err = new XTScopeParserError("Scope parser execution failed");
        err.properties = {
          id: "scopeparser_execution_failed",
          explanation: 'The scope parser for the tag "'.concat(tag, '" failed to execute'),
          scope,
          offset,
          xtag: tag,
          rootError: error
        };
        return err;
      }
      function throwUnimplementedTagType(part, index) {
        var errorMsg = 'Unimplemented tag type "'.concat(part.type, '"');
        if (part.module) {
          errorMsg += ' "'.concat(part.module, '"');
        }
        var err = new XTTemplateError(errorMsg);
        err.properties = {
          part,
          index,
          id: "unimplemented_tag_type"
        };
        throw err;
      }
      function throwMalformedXml() {
        var err = new XTInternalError("Malformed xml");
        err.properties = {
          explanation: "The template contains malformed xml",
          id: "malformed_xml"
        };
        throw err;
      }
      function throwResolveBeforeCompile() {
        var err = new XTInternalError("You must run `.compile()` before running `.resolveData()`");
        err.properties = {
          id: "resolve_before_compile",
          explanation: "You must run `.compile()` before running `.resolveData()`"
        };
        throw err;
      }
      function throwRenderInvalidTemplate() {
        var err = new XTInternalError("You should not call .render on a document that had compilation errors");
        err.properties = {
          id: "render_on_invalid_template",
          explanation: "You should not call .render on a document that had compilation errors"
        };
        throw err;
      }
      function throwRenderTwice() {
        var err = new XTInternalError("You should not call .render twice on the same docxtemplater instance");
        err.properties = {
          id: "render_twice",
          explanation: "You should not call .render twice on the same docxtemplater instance"
        };
        throw err;
      }
      function throwXmlInvalid(content, offset) {
        var err = new XTTemplateError("An XML file has invalid xml");
        err.properties = {
          id: "file_has_invalid_xml",
          content,
          offset,
          explanation: "The docx contains invalid XML, it is most likely corrupt"
        };
        throw err;
      }
      module.exports = {
        XTError,
        XTTemplateError,
        XTInternalError,
        XTScopeParserError,
        XTAPIVersionError,
        // Remove this alias in v4
        RenderingError: XTRenderingError,
        XTRenderingError,
        getClosingTagNotMatchOpeningTag,
        getLoopPositionProducesInvalidXMLError,
        getScopeCompilationError,
        getScopeParserExecutionError,
        getUnclosedTagException,
        getUnopenedTagException,
        getUnmatchedLoopException,
        getDuplicateCloseTagException,
        getDuplicateOpenTagException,
        getCorruptCharactersException,
        getInvalidRawXMLValueException,
        getUnbalancedLoopException,
        throwApiVersionError,
        throwFileTypeNotHandled,
        throwFileTypeNotIdentified,
        throwMalformedXml,
        throwMultiError,
        throwExpandNotFound,
        throwRawTagShouldBeOnlyTextInParagraph,
        throwUnimplementedTagType,
        throwXmlTagNotFound,
        throwXmlInvalid,
        throwResolveBeforeCompile,
        throwRenderInvalidTemplate,
        throwRenderTwice
      };
    }
  });

  // node_modules/docxtemplater/js/doc-utils.js
  var require_doc_utils = __commonJS({
    "node_modules/docxtemplater/js/doc-utils.js"(exports, module) {
      "use strict";
      function _slicedToArray(r, e) {
        return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest();
      }
      function _nonIterableRest() {
        throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
      }
      function _unsupportedIterableToArray(r, a) {
        if (r) {
          if ("string" == typeof r) return _arrayLikeToArray(r, a);
          var t = {}.toString.call(r).slice(8, -1);
          return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
        }
      }
      function _arrayLikeToArray(r, a) {
        (null == a || a > r.length) && (a = r.length);
        for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
        return n;
      }
      function _iterableToArrayLimit(r, l) {
        var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
        if (null != t) {
          var e, n, i, u, a = [], f = true, o = false;
          try {
            if (i = (t = t.call(r)).next, 0 === l) {
              if (Object(t) !== t) return;
              f = false;
            } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = true) ;
          } catch (r2) {
            o = true, n = r2;
          } finally {
            try {
              if (!f && null != t["return"] && (u = t["return"](), Object(u) !== u)) return;
            } finally {
              if (o) throw n;
            }
          }
          return a;
        }
      }
      function _arrayWithHoles(r) {
        if (Array.isArray(r)) return r;
      }
      var _require = require_lib();
      var DOMParser = _require.DOMParser;
      var XMLSerializer = _require.XMLSerializer;
      var _require2 = require_errors2();
      var throwXmlTagNotFound = _require2.throwXmlTagNotFound;
      var _require3 = require_utils2();
      var last = _require3.last;
      var first = _require3.first;
      function isWhiteSpace(value) {
        return /^[ \n\r\t]+$/.test(value);
      }
      function parser(tag) {
        return {
          get: function get(scope) {
            if (tag === ".") {
              return scope;
            }
            if (scope) {
              return scope[tag];
            }
            return scope;
          }
        };
      }
      function defaultWarnFn(errors) {
        for (var _i2 = 0; _i2 < errors.length; _i2++) {
          var error = errors[_i2];
          if (error.message) {
            console.warn("Warning : " + error.message);
          }
        }
      }
      var attrToRegex = {};
      function setSingleAttribute(partValue, attr, attrValue) {
        var regex;
        if (attrToRegex[attr]) {
          regex = attrToRegex[attr];
        } else {
          regex = new RegExp("(<.* ".concat(attr, '=")([^"]*)(".*)$'));
          attrToRegex[attr] = regex;
        }
        if (regex.test(partValue)) {
          return partValue.replace(regex, "$1".concat(attrValue, "$3"));
        }
        var end = partValue.lastIndexOf("/>");
        if (end === -1) {
          end = partValue.lastIndexOf(">");
        }
        return partValue.substr(0, end) + " ".concat(attr, '="').concat(attrValue, '"') + partValue.substr(end);
      }
      function getSingleAttribute(value, attributeName) {
        var index = value.indexOf(" ".concat(attributeName, '="'));
        if (index === -1) {
          return null;
        }
        var startIndex = value.substr(index).search(/["']/) + index;
        var endIndex = value.substr(startIndex + 1).search(/["']/) + startIndex;
        return value.substr(startIndex + 1, endIndex - startIndex);
      }
      function endsWith(str, suffix) {
        return str.indexOf(suffix, str.length - suffix.length) !== -1;
      }
      function startsWith(str, prefix) {
        return str.substring(0, prefix.length) === prefix;
      }
      function getDuplicates(arr) {
        var duplicates = [];
        var hash = {}, result = [];
        for (var i = 0, l = arr.length; i < l; ++i) {
          if (!hash[arr[i]]) {
            hash[arr[i]] = true;
            result.push(arr[i]);
          } else {
            duplicates.push(arr[i]);
          }
        }
        return duplicates;
      }
      function uniq(arr) {
        var hash = {}, result = [];
        for (var i = 0, l = arr.length; i < l; ++i) {
          if (!hash[arr[i]]) {
            hash[arr[i]] = true;
            result.push(arr[i]);
          }
        }
        return result;
      }
      function chunkBy(parsed, f) {
        var chunks = [[]];
        for (var _i4 = 0; _i4 < parsed.length; _i4++) {
          var p = parsed[_i4];
          var currentChunk = chunks[chunks.length - 1];
          var res = f(p);
          if (res === "start") {
            chunks.push([p]);
          } else if (res === "end") {
            currentChunk.push(p);
            chunks.push([]);
          } else {
            currentChunk.push(p);
          }
        }
        var result = [];
        for (var _i6 = 0; _i6 < chunks.length; _i6++) {
          var chunk = chunks[_i6];
          if (chunk.length > 0) {
            result.push(chunk);
          }
        }
        return result;
      }
      function getDefaults() {
        return {
          errorLogging: "json",
          stripInvalidXMLChars: false,
          paragraphLoop: false,
          nullGetter: function nullGetter(part) {
            return part.module ? "" : "undefined";
          },
          xmlFileNames: ["[Content_Types].xml"],
          parser,
          warnFn: defaultWarnFn,
          linebreaks: false,
          fileTypeConfig: null,
          delimiters: {
            start: "{",
            end: "}"
          },
          syntax: {
            changeDelimiterPrefix: "=",
            preserveNewlinesInTags: false,
            allowUnopenedTag: false,
            allowUnclosedTag: false,
            allowUnbalancedLoops: false
          }
        };
      }
      function xml2str(xmlNode) {
        return new XMLSerializer().serializeToString(xmlNode).replace(/xmlns(:[a-z0-9]+)?="" ?/g, "");
      }
      function str2xml(str) {
        if (str.charCodeAt(0) === 65279) {
          str = str.substr(1);
        }
        return new DOMParser().parseFromString(str, "text/xml");
      }
      var charMap = [["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"], ["'", "&apos;"]];
      var charMapRegexes = charMap.map(function(_ref) {
        var _ref2 = _slicedToArray(_ref, 2), endChar = _ref2[0], startChar = _ref2[1];
        return {
          rstart: new RegExp(startChar, "g"),
          rend: new RegExp(endChar, "g"),
          start: startChar,
          end: endChar
        };
      });
      function wordToUtf8(string) {
        for (var i = charMapRegexes.length - 1; i >= 0; i--) {
          var r = charMapRegexes[i];
          string = string.replace(r.rstart, r.end);
        }
        return string;
      }
      function utf8ToWord(string) {
        var _string;
        if ((_string = string) !== null && _string !== void 0 && _string.toString) {
          string = string.toString();
        } else {
          string = "";
        }
        var r;
        for (var i = 0, l = charMapRegexes.length; i < l; i++) {
          r = charMapRegexes[i];
          string = string.replace(r.rend, r.start);
        }
        return string;
      }
      function concatArrays(arrays) {
        var result = [];
        for (var _i8 = 0; _i8 < arrays.length; _i8++) {
          var array = arrays[_i8];
          for (var _i0 = 0; _i0 < array.length; _i0++) {
            var el = array[_i0];
            result.push(el);
          }
        }
        return result;
      }
      function pushArray(array1, array2) {
        if (!array2) {
          return array1;
        }
        for (var i = 0, len = array2.length; i < len; i++) {
          array1.push(array2[i]);
        }
        return array1;
      }
      var spaceRegexp = new RegExp(String.fromCharCode(160), "g");
      function convertSpaces(s) {
        return s.replace(spaceRegexp, " ");
      }
      function pregMatchAll(regex, content) {
        var matchArray = [];
        var match;
        while ((match = regex.exec(content)) != null) {
          matchArray.push({
            array: match,
            offset: match.index
          });
        }
        return matchArray;
      }
      function isEnding(value, element) {
        return value === "</" + element + ">";
      }
      function isStarting(value, element) {
        return value.indexOf("<" + element) === 0 && [">", " ", "/"].indexOf(value[element.length + 1]) !== -1;
      }
      function getRight(parsed, element, index) {
        var val = getRightOrNull(parsed, element, index);
        if (val !== null) {
          return val;
        }
        throwXmlTagNotFound({
          position: "right",
          element,
          parsed,
          index
        });
      }
      function getRightOrNull(parsed, elements, index) {
        if (typeof elements === "string") {
          elements = [elements];
        }
        var level = 1;
        for (var i = index, l = parsed.length; i < l; i++) {
          var part = parsed[i];
          for (var _i10 = 0, _elements2 = elements; _i10 < _elements2.length; _i10++) {
            var element = _elements2[_i10];
            if (isEnding(part.value, element)) {
              level--;
            }
            if (isStarting(part.value, element)) {
              level++;
            }
            if (level === 0) {
              return i;
            }
          }
        }
        return null;
      }
      function getLeft(parsed, element, index) {
        var val = getLeftOrNull(parsed, element, index);
        if (val !== null) {
          return val;
        }
        throwXmlTagNotFound({
          position: "left",
          element,
          parsed,
          index
        });
      }
      function getLeftOrNull(parsed, elements, index) {
        if (typeof elements === "string") {
          elements = [elements];
        }
        var level = 1;
        for (var i = index; i >= 0; i--) {
          var part = parsed[i];
          for (var _i12 = 0, _elements4 = elements; _i12 < _elements4.length; _i12++) {
            var element = _elements4[_i12];
            if (isStarting(part.value, element)) {
              level--;
            }
            if (isEnding(part.value, element)) {
              level++;
            }
            if (level === 0) {
              return i;
            }
          }
        }
        return null;
      }
      function isTagStart(tagType, _ref3) {
        var type = _ref3.type, tag = _ref3.tag, position = _ref3.position;
        return type === "tag" && tag === tagType && (position === "start" || position === "selfclosing");
      }
      function isTagEnd(tagType, _ref4) {
        var type = _ref4.type, tag = _ref4.tag, position = _ref4.position;
        return type === "tag" && tag === tagType && position === "end";
      }
      function isParagraphStart(_ref5) {
        var type = _ref5.type, tag = _ref5.tag, position = _ref5.position;
        return ["w:p", "a:p", "text:p"].indexOf(tag) !== -1 && type === "tag" && position === "start";
      }
      function isParagraphEnd(_ref6) {
        var type = _ref6.type, tag = _ref6.tag, position = _ref6.position;
        return ["w:p", "a:p", "text:p"].indexOf(tag) !== -1 && type === "tag" && position === "end";
      }
      function isBreakTag(_ref7) {
        var type = _ref7.type, tag = _ref7.tag, position = _ref7.position;
        return ["w:br", "a:br"].indexOf(tag) !== -1 && type === "tag" && (position === "start" || position === "selfclosing");
      }
      function isTextStart(_ref8) {
        var type = _ref8.type, position = _ref8.position, text = _ref8.text;
        return text && type === "tag" && position === "start";
      }
      function isTextEnd(_ref9) {
        var type = _ref9.type, position = _ref9.position, text = _ref9.text;
        return text && type === "tag" && position === "end";
      }
      function isContent(_ref0) {
        var type = _ref0.type, position = _ref0.position;
        return type === "placeholder" || type === "content" && position === "insidetag";
      }
      function isModule(_ref1, modules) {
        var module2 = _ref1.module, type = _ref1.type;
        if (!(modules instanceof Array)) {
          modules = [modules];
        }
        return type === "placeholder" && modules.indexOf(module2) !== -1;
      }
      var corruptCharacters = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;
      function hasCorruptCharacters(string) {
        corruptCharacters.lastIndex = 0;
        return corruptCharacters.test(string);
      }
      function removeCorruptCharacters(string) {
        if (typeof string !== "string") {
          string = String(string);
        }
        return string.replace(corruptCharacters, "");
      }
      function invertMap(map) {
        var invertedMap = {};
        for (var key in map) {
          var value = map[key];
          invertedMap[value] || (invertedMap[value] = []);
          invertedMap[value].push(key);
        }
        return invertedMap;
      }
      function stableSort(arr, compare) {
        var withIndex = [];
        for (var i = 0; i < arr.length; i++) {
          withIndex.push({
            item: arr[i],
            index: i
          });
        }
        withIndex.sort(function(a, b) {
          return compare(a.item, b.item) || a.index - b.index;
        });
        var result = [];
        for (var _i13 = 0; _i13 < withIndex.length; _i13++) {
          result.push(withIndex[_i13].item);
        }
        return result;
      }
      function getPartWithDelimiters(part, options) {
        return options.delimiters.start + part.raw + options.delimiters.end;
      }
      module.exports = {
        getPartWithDelimiters,
        endsWith,
        startsWith,
        isContent,
        isParagraphStart,
        isParagraphEnd,
        isBreakTag,
        isTagStart,
        isTagEnd,
        isTextStart,
        isTextEnd,
        isStarting,
        isEnding,
        isModule,
        uniq,
        getDuplicates,
        chunkBy,
        last,
        first,
        xml2str,
        str2xml,
        getRightOrNull,
        getRight,
        getLeftOrNull,
        getLeft,
        pregMatchAll,
        convertSpaces,
        charMapRegexes,
        hasCorruptCharacters,
        removeCorruptCharacters,
        getDefaults,
        wordToUtf8,
        utf8ToWord,
        concatArrays,
        pushArray,
        invertMap,
        charMap,
        getSingleAttribute,
        setSingleAttribute,
        isWhiteSpace,
        stableSort
      };
    }
  });

  // node_modules/docxtemplater/js/minizod.js
  var require_minizod = __commonJS({
    "node_modules/docxtemplater/js/minizod.js"(exports, module) {
      "use strict";
      function _slicedToArray(r, e) {
        return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest();
      }
      function _nonIterableRest() {
        throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
      }
      function _unsupportedIterableToArray(r, a) {
        if (r) {
          if ("string" == typeof r) return _arrayLikeToArray(r, a);
          var t = {}.toString.call(r).slice(8, -1);
          return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
        }
      }
      function _arrayLikeToArray(r, a) {
        (null == a || a > r.length) && (a = r.length);
        for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
        return n;
      }
      function _iterableToArrayLimit(r, l) {
        var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
        if (null != t) {
          var e, n, i, u, a = [], f = true, o = false;
          try {
            if (i = (t = t.call(r)).next, 0 === l) {
              if (Object(t) !== t) return;
              f = false;
            } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = true) ;
          } catch (r2) {
            o = true, n = r2;
          } finally {
            try {
              if (!f && null != t["return"] && (u = t["return"](), Object(u) !== u)) return;
            } finally {
              if (o) throw n;
            }
          }
          return a;
        }
      }
      function _arrayWithHoles(r) {
        if (Array.isArray(r)) return r;
      }
      function _typeof(o) {
        "@babel/helpers - typeof";
        return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }
      function _classCallCheck(a, n) {
        if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
      }
      function _defineProperties(e, r) {
        for (var t = 0; t < r.length; t++) {
          var o = r[t];
          o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, _toPropertyKey(o.key), o);
        }
      }
      function _createClass(e, r, t) {
        return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: false }), e;
      }
      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");
        return "symbol" == _typeof(i) ? i : i + "";
      }
      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];
        if (void 0 !== e) {
          var i = e.call(t, r || "default");
          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }
        return ("string" === r ? String : Number)(t);
      }
      var MiniZod = /* @__PURE__ */ (function() {
        function MiniZod2() {
          _classCallCheck(this, MiniZod2);
        }
        return _createClass(MiniZod2, null, [{
          key: "createSchema",
          value: function createSchema(validateFn) {
            var schema = {
              validate: validateFn,
              optional: function optional() {
                return MiniZod2.createSchema(function(value) {
                  return value === void 0 ? {
                    success: true,
                    value
                  } : validateFn(value);
                });
              },
              nullable: function nullable() {
                return MiniZod2.createSchema(function(value) {
                  return value == null ? {
                    success: true,
                    value
                  } : validateFn(value);
                });
              }
            };
            return schema;
          }
        }, {
          key: "string",
          value: function string() {
            return MiniZod2.createSchema(function(value) {
              if (typeof value !== "string") {
                return {
                  success: false,
                  error: "Expected string, received ".concat(_typeof(value))
                };
              }
              return {
                success: true,
                value
              };
            });
          }
        }, {
          key: "date",
          value: function date() {
            return MiniZod2.createSchema(function(value) {
              if (!(value instanceof Date)) {
                return {
                  success: false,
                  error: "Expected date, received ".concat(_typeof(value))
                };
              }
              return {
                success: true,
                value
              };
            });
          }
        }, {
          key: "boolean",
          value: function _boolean() {
            return MiniZod2.createSchema(function(value) {
              if (typeof value !== "boolean") {
                return {
                  success: false,
                  error: "Expected boolean, received ".concat(_typeof(value))
                };
              }
              return {
                success: true,
                value
              };
            });
          }
        }, {
          key: "number",
          value: function number() {
            return MiniZod2.createSchema(function(value) {
              if (typeof value !== "number") {
                return {
                  success: false,
                  error: "Expected number, received ".concat(_typeof(value))
                };
              }
              return {
                success: true,
                value
              };
            });
          }
        }, {
          key: "function",
          value: function _function() {
            return MiniZod2.createSchema(function(value) {
              if (typeof value !== "function") {
                return {
                  success: false,
                  error: "Expected function, received ".concat(_typeof(value))
                };
              }
              return {
                success: true,
                value
              };
            });
          }
        }, {
          key: "array",
          value: function array(itemSchema) {
            return MiniZod2.createSchema(function(value) {
              if (!Array.isArray(value)) {
                return {
                  success: false,
                  error: "Expected array, received ".concat(_typeof(value))
                };
              }
              for (var i = 0; i < value.length; i++) {
                var result = itemSchema.validate(value[i]);
                if (!result.success) {
                  return {
                    success: false,
                    error: "".concat(result.error, " at index ").concat(i)
                  };
                }
              }
              return {
                success: true,
                value
              };
            });
          }
        }, {
          key: "any",
          value: function any() {
            return MiniZod2.createSchema(function(value) {
              return {
                success: true,
                value
              };
            });
          }
        }, {
          key: "isRegex",
          value: function isRegex() {
            return MiniZod2.createSchema(function(value) {
              if (!(value instanceof RegExp)) {
                return {
                  success: false,
                  error: "Expected RegExp, received ".concat(_typeof(value))
                };
              }
              return {
                success: true,
                value
              };
            });
          }
        }, {
          key: "union",
          value: function union(schemas) {
            return MiniZod2.createSchema(function(value) {
              for (var _i2 = 0; _i2 < schemas.length; _i2++) {
                var s = schemas[_i2];
                var result = s.validate(value);
                if (result.success) {
                  return result;
                }
              }
              return {
                success: false,
                error: "Value ".concat(value, " does not match any schema in union")
              };
            });
          }
        }, {
          key: "object",
          value: function object(shape) {
            var schema = MiniZod2.createSchema(function(value) {
              if (value == null) {
                return {
                  success: false,
                  error: "Expected object, received ".concat(value)
                };
              }
              if (_typeof(value) !== "object") {
                return {
                  success: false,
                  error: "Expected object, received ".concat(_typeof(value))
                };
              }
              for (var _i4 = 0, _Object$entries2 = Object.entries(shape); _i4 < _Object$entries2.length; _i4++) {
                var _Object$entries2$_i = _slicedToArray(_Object$entries2[_i4], 2), key = _Object$entries2$_i[0], validator = _Object$entries2$_i[1];
                var result = validator.validate(value[key]);
                if (!result.success) {
                  return {
                    success: false,
                    error: "".concat(result.error, " at ").concat(key)
                  };
                }
              }
              return {
                success: true,
                value
              };
            });
            schema.strict = function() {
              return MiniZod2.createSchema(function(value) {
                var baseResult = schema.validate(value);
                if (!baseResult.success) {
                  return baseResult;
                }
                var extraKeys = Object.keys(value).filter(function(key) {
                  return !(key in shape);
                });
                if (extraKeys.length > 0) {
                  return {
                    success: false,
                    error: "Unexpected properties: ".concat(extraKeys.join(", "))
                  };
                }
                return baseResult;
              });
            };
            return schema;
          }
        }, {
          key: "record",
          value: function record(valueSchema) {
            return MiniZod2.createSchema(function(value) {
              if (value === null) {
                return {
                  success: false,
                  error: "Expected object, received null"
                };
              }
              if (_typeof(value) !== "object") {
                return {
                  success: false,
                  error: "Expected object, received ".concat(_typeof(value))
                };
              }
              for (var _i6 = 0, _Object$keys2 = Object.keys(value); _i6 < _Object$keys2.length; _i6++) {
                var key = _Object$keys2[_i6];
                if (typeof key !== "string") {
                  return {
                    success: false,
                    error: "Expected string key, received ".concat(_typeof(key), " at ").concat(key)
                  };
                }
                var result = valueSchema.validate(value[key]);
                if (!result.success) {
                  return {
                    success: false,
                    error: "".concat(result.error, " at key ").concat(key)
                  };
                }
              }
              return {
                success: true,
                value
              };
            });
          }
        }]);
      })();
      module.exports = MiniZod;
    }
  });

  // node_modules/docxtemplater/js/get-relation-types.js
  var require_get_relation_types = __commonJS({
    "node_modules/docxtemplater/js/get-relation-types.js"(exports, module) {
      "use strict";
      var _require = require_doc_utils();
      var str2xml = _require.str2xml;
      var relsFile = "_rels/.rels";
      function getRelsTypes(zip) {
        var rootRels = zip.files[relsFile];
        var rootRelsXml = rootRels ? str2xml(rootRels.asText()) : null;
        var rootRelationships = rootRelsXml ? rootRelsXml.getElementsByTagName("Relationship") : [];
        var relsTypes = {};
        for (var _i2 = 0; _i2 < rootRelationships.length; _i2++) {
          var relation = rootRelationships[_i2];
          relsTypes[relation.getAttribute("Target")] = relation.getAttribute("Type");
        }
        return relsTypes;
      }
      module.exports = {
        getRelsTypes
      };
    }
  });

  // node_modules/docxtemplater/js/get-content-types.js
  var require_get_content_types = __commonJS({
    "node_modules/docxtemplater/js/get-content-types.js"(exports, module) {
      "use strict";
      var _require = require_doc_utils();
      var str2xml = _require.str2xml;
      var ctXML = "[Content_Types].xml";
      function collectContentTypes(overrides, defaults, zip) {
        var partNames = {};
        for (var _i2 = 0; _i2 < overrides.length; _i2++) {
          var override = overrides[_i2];
          var contentType = override.getAttribute("ContentType");
          var partName = override.getAttribute("PartName").substr(1);
          partNames[partName] = contentType;
        }
        zip.file(/./).map(function(_ref) {
          var name = _ref.name;
          for (var _i4 = 0; _i4 < defaults.length; _i4++) {
            var def = defaults[_i4];
            var _contentType = def.getAttribute("ContentType");
            var extension = def.getAttribute("Extension");
            if (name.slice(name.length - extension.length) === extension && !partNames[name] && name !== ctXML) {
              partNames[name] = _contentType;
            }
          }
          partNames[name] || (partNames[name] = "");
        });
        return partNames;
      }
      function getContentTypes(zip) {
        var contentTypes = zip.files[ctXML];
        var contentTypeXml = contentTypes ? str2xml(contentTypes.asText()) : null;
        var overrides = contentTypeXml ? contentTypeXml.getElementsByTagName("Override") : null;
        var defaults = contentTypeXml ? contentTypeXml.getElementsByTagName("Default") : null;
        return {
          overrides,
          defaults,
          contentTypes,
          contentTypeXml
        };
      }
      module.exports = {
        collectContentTypes,
        getContentTypes
      };
    }
  });

  // node_modules/docxtemplater/js/module-wrapper.js
  var require_module_wrapper = __commonJS({
    "node_modules/docxtemplater/js/module-wrapper.js"(exports, module) {
      "use strict";
      var _require = require_errors2();
      var XTInternalError = _require.XTInternalError;
      function emptyFun() {
      }
      function identity(i) {
        return i;
      }
      module.exports = function(module2) {
        var defaults = {
          on: emptyFun,
          set: emptyFun,
          getFileType: emptyFun,
          optionsTransformer: identity,
          preparse: identity,
          matchers: function matchers() {
            return [];
          },
          parse: emptyFun,
          getTraits: emptyFun,
          postparse: identity,
          errorsTransformer: identity,
          preResolve: emptyFun,
          resolve: emptyFun,
          getRenderedMap: identity,
          render: emptyFun,
          nullGetter: emptyFun,
          postrender: identity
        };
        if (Object.keys(defaults).every(function(key2) {
          return !module2[key2];
        })) {
          var err = new XTInternalError("This module cannot be wrapped, because it doesn't define any of the necessary functions");
          err.properties = {
            id: "module_cannot_be_wrapped",
            explanation: "This module cannot be wrapped, because it doesn't define any of the necessary functions"
          };
          throw err;
        }
        for (var key in defaults) {
          module2[key] || (module2[key] = defaults[key]);
        }
        return module2;
      };
    }
  });

  // node_modules/docxtemplater/js/traits.js
  var require_traits = __commonJS({
    "node_modules/docxtemplater/js/traits.js"(exports, module) {
      "use strict";
      function _typeof(o) {
        "@babel/helpers - typeof";
        return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }
      function _toConsumableArray(r) {
        return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread();
      }
      function _nonIterableSpread() {
        throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
      }
      function _iterableToArray(r) {
        if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r);
      }
      function _arrayWithoutHoles(r) {
        if (Array.isArray(r)) return _arrayLikeToArray(r);
      }
      function _slicedToArray(r, e) {
        return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest();
      }
      function _nonIterableRest() {
        throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
      }
      function _unsupportedIterableToArray(r, a) {
        if (r) {
          if ("string" == typeof r) return _arrayLikeToArray(r, a);
          var t = {}.toString.call(r).slice(8, -1);
          return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
        }
      }
      function _arrayLikeToArray(r, a) {
        (null == a || a > r.length) && (a = r.length);
        for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
        return n;
      }
      function _iterableToArrayLimit(r, l) {
        var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
        if (null != t) {
          var e, n, i, u, a = [], f = true, o = false;
          try {
            if (i = (t = t.call(r)).next, 0 === l) {
              if (Object(t) !== t) return;
              f = false;
            } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = true) ;
          } catch (r2) {
            o = true, n = r2;
          } finally {
            try {
              if (!f && null != t["return"] && (u = t["return"](), Object(u) !== u)) return;
            } finally {
              if (o) throw n;
            }
          }
          return a;
        }
      }
      function _arrayWithHoles(r) {
        if (Array.isArray(r)) return r;
      }
      function ownKeys(e, r) {
        var t = Object.keys(e);
        if (Object.getOwnPropertySymbols) {
          var o = Object.getOwnPropertySymbols(e);
          r && (o = o.filter(function(r2) {
            return Object.getOwnPropertyDescriptor(e, r2).enumerable;
          })), t.push.apply(t, o);
        }
        return t;
      }
      function _objectSpread(e) {
        for (var r = 1; r < arguments.length; r++) {
          var t = null != arguments[r] ? arguments[r] : {};
          r % 2 ? ownKeys(Object(t), true).forEach(function(r2) {
            _defineProperty(e, r2, t[r2]);
          }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r2) {
            Object.defineProperty(e, r2, Object.getOwnPropertyDescriptor(t, r2));
          });
        }
        return e;
      }
      function _defineProperty(e, r, t) {
        return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: true, configurable: true, writable: true }) : e[r] = t, e;
      }
      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");
        return "symbol" == _typeof(i) ? i : i + "";
      }
      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];
        if (void 0 !== e) {
          var i = e.call(t, r || "default");
          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }
        return ("string" === r ? String : Number)(t);
      }
      var _require = require_doc_utils();
      var getRightOrNull = _require.getRightOrNull;
      var getRight = _require.getRight;
      var getLeft = _require.getLeft;
      var getLeftOrNull = _require.getLeftOrNull;
      var chunkBy = _require.chunkBy;
      var isTagStart = _require.isTagStart;
      var isTagEnd = _require.isTagEnd;
      var isContent = _require.isContent;
      var last = _require.last;
      var first = _require.first;
      var _require2 = require_errors2();
      var XTTemplateError = _require2.XTTemplateError;
      var throwExpandNotFound = _require2.throwExpandNotFound;
      var getLoopPositionProducesInvalidXMLError = _require2.getLoopPositionProducesInvalidXMLError;
      function lastTagIsOpenTag(tags, tag) {
        if (tags.length === 0) {
          return false;
        }
        var innerLastTag = last(tags).substr(1);
        return innerLastTag.indexOf(tag) === 0;
      }
      function getListXmlElements(parts) {
        var result = [];
        for (var _i2 = 0; _i2 < parts.length; _i2++) {
          var _parts$_i = parts[_i2], position = _parts$_i.position, value = _parts$_i.value, tag = _parts$_i.tag;
          if (!tag) {
            continue;
          }
          if (position === "end") {
            if (lastTagIsOpenTag(result, tag)) {
              result.pop();
            } else {
              result.push(value);
            }
          } else if (position === "start") {
            result.push(value);
          }
        }
        return result;
      }
      function has(name, xmlElements) {
        for (var _i4 = 0; _i4 < xmlElements.length; _i4++) {
          var xmlElement = xmlElements[_i4];
          if (xmlElement.indexOf("<".concat(name)) === 0) {
            return true;
          }
        }
        return false;
      }
      function getExpandToDefault(postparsed, pair, expandTags) {
        var xmlElements = getListXmlElements(postparsed.slice(pair[0].offset, pair[1].offset));
        var _loop = function _loop2() {
          var _expandTags$_i = expandTags[_i6], contains = _expandTags$_i.contains, expand = _expandTags$_i.expand, onlyTextInTag = _expandTags$_i.onlyTextInTag;
          if (has(contains, xmlElements)) {
            if (onlyTextInTag) {
              var left = getLeftOrNull(postparsed, contains, pair[0].offset);
              var right = getRightOrNull(postparsed, contains, pair[1].offset);
              if (left === null || right === null) {
                return 0;
              }
              var subparsed = postparsed.slice(left, right);
              var chunks = chunkBy(subparsed, function(p) {
                return isTagStart(contains, p) ? "start" : isTagEnd(contains, p) ? "end" : null;
              });
              var firstChunk = first(chunks);
              var lastChunk = last(chunks);
              var firstContent = firstChunk.filter(isContent);
              var lastContent = lastChunk.filter(isContent);
              if (firstContent.length !== 1 || lastContent.length !== 1) {
                return 0;
              }
            }
            var structured = getStructuredTagPositions(xmlElements);
            var openCount = 0;
            for (var _i8 = 0; _i8 < structured.length; _i8++) {
              var _structured$_i = structured[_i8], tag = _structured$_i.tag, position = _structured$_i.position;
              if (tag === expand) {
                if (position === "start") {
                  openCount++;
                }
                if (position === "end") {
                  openCount--;
                }
              }
            }
            if (openCount !== 0) {
              return {
                v: {
                  error: getLoopPositionProducesInvalidXMLError({
                    tag: first(pair).part.value,
                    offset: [first(pair).part.offset, last(pair).part.offset]
                  })
                }
              };
            }
            return {
              v: {
                value: expand
              }
            };
          }
        }, _ret;
        for (var _i6 = 0; _i6 < expandTags.length; _i6++) {
          _ret = _loop();
          if (_ret === 0) continue;
          if (_ret) return _ret.v;
        }
        if (!checkStartEnd(xmlElements)) {
          return {
            error: getLoopPositionProducesInvalidXMLError({
              tag: first(pair).part.value,
              offset: [first(pair).part.offset, last(pair).part.offset]
            })
          };
        }
        return {};
      }
      function getStructuredTagPositions(xmlElements) {
        var result = [];
        for (var _i0 = 0; _i0 < xmlElements.length; _i0++) {
          var el = xmlElements[_i0];
          var tag = getTagName(el);
          var position = /^\s*<\//.test(el) ? "end" : "start";
          result.push({
            tag,
            position
          });
        }
        return result;
      }
      function getTagName(tag) {
        return tag.replace(/^\s*<\/?([a-zA-Z:]+).*/, "$1");
      }
      function checkStartEnd(xmlElements) {
        if (xmlElements.length % 2 === 1) {
          return false;
        }
        for (var i = 0, len = xmlElements.length / 2; i < len; i++) {
          var start = xmlElements[i];
          var end = xmlElements[xmlElements.length - i - 1];
          var tagNameStart = getTagName(start);
          var tagNameEnd = getTagName(end);
          if (tagNameStart !== tagNameEnd) {
            return false;
          }
        }
        return true;
      }
      function getExpandLimit(part, index, postparsed, options) {
        var expandTo = part.expandTo || options.expandTo;
        if (!expandTo) {
          return;
        }
        var right, left;
        try {
          left = getLeft(postparsed, expandTo, index);
          right = getRight(postparsed, expandTo, index);
        } catch (rootError) {
          var errProps = _objectSpread({
            part,
            rootError,
            postparsed,
            expandTo,
            index
          }, options.error);
          if (options.onError) {
            var errorResult = options.onError(errProps);
            if (errorResult === "ignore") {
              return;
            }
          }
          throwExpandNotFound(errProps);
        }
        return [left, right];
      }
      function expandOne(_ref, part, postparsed, options) {
        var _ref2 = _slicedToArray(_ref, 2), left = _ref2[0], right = _ref2[1];
        var index = postparsed.indexOf(part);
        var leftParts = postparsed.slice(left, index);
        var rightParts = postparsed.slice(index + 1, right + 1);
        var inner = options.getInner({
          postparse: options.postparse,
          index,
          part,
          leftParts,
          rightParts,
          left,
          right,
          postparsed
        });
        if (!inner.length) {
          inner.expanded = [leftParts, rightParts];
          inner = [inner];
        }
        return {
          left,
          right,
          inner
        };
      }
      function expandToOne(postparsed, options) {
        var errors = [];
        if (postparsed.errors) {
          errors = postparsed.errors;
          postparsed = postparsed.postparsed;
        }
        var limits = [];
        for (var i = 0, len = postparsed.length; i < len; i++) {
          var part = postparsed[i];
          if (part.type === "placeholder" && part.module === options.moduleName && /*
           * The part.subparsed check is used to fix this github issue :
           * https://github.com/open-xml-templating/docxtemplater/issues/671
           */
          !part.subparsed && !part.expanded) {
            try {
              var limit = getExpandLimit(part, i, postparsed, options);
              if (!limit) {
                continue;
              }
              var _limit = _slicedToArray(limit, 2), left = _limit[0], right = _limit[1];
              limits.push({
                left,
                right,
                part,
                i,
                leftPart: postparsed[left],
                rightPart: postparsed[right]
              });
            } catch (error) {
              errors.push(error);
            }
          }
        }
        limits.sort(function(l1, l2) {
          if (l1.left === l2.left) {
            return l2.part.lIndex < l1.part.lIndex ? 1 : -1;
          }
          return l2.left < l1.left ? 1 : -1;
        });
        var maxRight = -1;
        var offset = 0;
        for (var _i1 = 0, _len = limits.length; _i1 < _len; _i1++) {
          var _postparsed;
          var _limit2 = limits[_i1];
          maxRight = Math.max(maxRight, _i1 > 0 ? limits[_i1 - 1].right : 0);
          if (_limit2.left < maxRight) {
            continue;
          }
          var result = void 0;
          try {
            result = expandOne([_limit2.left + offset, _limit2.right + offset], _limit2.part, postparsed, options);
          } catch (error) {
            if (options.onError) {
              var errorResult = options.onError(_objectSpread({
                part: _limit2.part,
                rootError: error,
                postparsed,
                expandOne
              }, options.errors));
              if (errorResult === "ignore") {
                continue;
              }
            }
            if (error instanceof XTTemplateError) {
              errors.push(error);
            } else {
              throw error;
            }
          }
          if (!result) {
            continue;
          }
          offset += result.inner.length - (result.right + 1 - result.left);
          (_postparsed = postparsed).splice.apply(_postparsed, [result.left, result.right + 1 - result.left].concat(_toConsumableArray(result.inner)));
        }
        return {
          postparsed,
          errors
        };
      }
      module.exports = {
        expandToOne,
        getExpandToDefault
      };
    }
  });

  // node_modules/docxtemplater/js/filetypes.js
  var require_filetypes = __commonJS({
    "node_modules/docxtemplater/js/filetypes.js"(exports, module) {
      "use strict";
      var docxContentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
      var docxmContentType = "application/vnd.ms-word.document.macroEnabled.main+xml";
      var dotxContentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml";
      var dotmContentType = "application/vnd.ms-word.template.macroEnabledTemplate.main+xml";
      var headerContentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml";
      var footnotesContentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml";
      var commentsContentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml";
      var footerContentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml";
      var pptxContentType = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";
      var pptxSlideMaster = "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml";
      var pptxSlideLayout = "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml";
      var pptxPresentationContentType = "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml";
      var xlsxContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
      var xlsmContentType = "application/vnd.ms-excel.sheet.macroEnabled.main+xml";
      var xlsxWorksheetContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";
      var main = [docxContentType, docxmContentType, dotxContentType, dotmContentType];
      var filetypes = {
        main,
        docx: [headerContentType].concat(main, [footerContentType, footnotesContentType, commentsContentType]),
        pptx: [pptxContentType, pptxSlideMaster, pptxSlideLayout, pptxPresentationContentType],
        xlsx: [xlsxContentType, xlsmContentType, xlsxWorksheetContentType]
      };
      module.exports = filetypes;
    }
  });

  // node_modules/docxtemplater/js/content-types.js
  var require_content_types = __commonJS({
    "node_modules/docxtemplater/js/content-types.js"(exports, module) {
      "use strict";
      var coreContentType = "application/vnd.openxmlformats-package.core-properties+xml";
      var appContentType = "application/vnd.openxmlformats-officedocument.extended-properties+xml";
      var customContentType = "application/vnd.openxmlformats-officedocument.custom-properties+xml";
      var settingsContentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml";
      var diagramDataContentType = "application/vnd.openxmlformats-officedocument.drawingml.diagramData+xml";
      var diagramDrawingContentType = "application/vnd.ms-office.drawingml.diagramDrawing+xml";
      module.exports = {
        settingsContentType,
        coreContentType,
        appContentType,
        customContentType,
        diagramDataContentType,
        diagramDrawingContentType
      };
    }
  });

  // node_modules/docxtemplater/js/modules/common.js
  var require_common = __commonJS({
    "node_modules/docxtemplater/js/modules/common.js"(exports, module) {
      "use strict";
      function _typeof(o) {
        "@babel/helpers - typeof";
        return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }
      function _classCallCheck(a, n) {
        if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
      }
      function _defineProperties(e, r) {
        for (var t = 0; t < r.length; t++) {
          var o = r[t];
          o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, _toPropertyKey(o.key), o);
        }
      }
      function _createClass(e, r, t) {
        return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: false }), e;
      }
      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");
        return "symbol" == _typeof(i) ? i : i + "";
      }
      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];
        if (void 0 !== e) {
          var i = e.call(t, r || "default");
          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }
        return ("string" === r ? String : Number)(t);
      }
      var _require = require_doc_utils();
      var pushArray = _require.pushArray;
      var wrapper = require_module_wrapper();
      var filetypes = require_filetypes();
      var _require2 = require_content_types();
      var settingsContentType = _require2.settingsContentType;
      var coreContentType = _require2.coreContentType;
      var appContentType = _require2.appContentType;
      var customContentType = _require2.customContentType;
      var diagramDataContentType = _require2.diagramDataContentType;
      var diagramDrawingContentType = _require2.diagramDrawingContentType;
      var commonContentTypes = [settingsContentType, coreContentType, appContentType, customContentType, diagramDataContentType, diagramDrawingContentType];
      var Common = /* @__PURE__ */ (function() {
        function Common2() {
          _classCallCheck(this, Common2);
          this.name = "Common";
        }
        return _createClass(Common2, [{
          key: "getFileType",
          value: function getFileType(_ref) {
            var doc = _ref.doc;
            var invertedContentTypes = doc.invertedContentTypes;
            if (!invertedContentTypes) {
              return;
            }
            for (var _i2 = 0; _i2 < commonContentTypes.length; _i2++) {
              var ct = commonContentTypes[_i2];
              if (invertedContentTypes[ct]) {
                pushArray(doc.targets, invertedContentTypes[ct]);
              }
            }
            var keys = ["docx", "pptx", "xlsx"];
            var ftCandidate;
            for (var _i4 = 0; _i4 < keys.length; _i4++) {
              var key = keys[_i4];
              var contentTypes = filetypes[key];
              for (var _i6 = 0; _i6 < contentTypes.length; _i6++) {
                var _ct = contentTypes[_i6];
                if (invertedContentTypes[_ct]) {
                  for (var _i8 = 0, _invertedContentTypes2 = invertedContentTypes[_ct]; _i8 < _invertedContentTypes2.length; _i8++) {
                    var target = _invertedContentTypes2[_i8];
                    if (doc.relsTypes[target] && ["http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"].indexOf(doc.relsTypes[target]) === -1) {
                      continue;
                    }
                    ftCandidate = key;
                    if (filetypes.main.indexOf(_ct) !== -1 || _ct === filetypes.pptx[0]) {
                      doc.textTarget || (doc.textTarget = target);
                    }
                    if (ftCandidate === "xlsx") {
                      continue;
                    }
                    doc.targets.push(target);
                  }
                }
              }
              if (ftCandidate) {
                continue;
              }
            }
            return ftCandidate;
          }
        }]);
      })();
      module.exports = function() {
        return wrapper(new Common());
      };
    }
  });

  // node_modules/docxtemplater/js/scope-manager.js
  var require_scope_manager = __commonJS({
    "node_modules/docxtemplater/js/scope-manager.js"(exports, module) {
      "use strict";
      function _typeof(o) {
        "@babel/helpers - typeof";
        return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }
      function _classCallCheck(a, n) {
        if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
      }
      function _defineProperties(e, r) {
        for (var t = 0; t < r.length; t++) {
          var o = r[t];
          o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, _toPropertyKey(o.key), o);
        }
      }
      function _createClass(e, r, t) {
        return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: false }), e;
      }
      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");
        return "symbol" == _typeof(i) ? i : i + "";
      }
      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];
        if (void 0 !== e) {
          var i = e.call(t, r || "default");
          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }
        return ("string" === r ? String : Number)(t);
      }
      var _require = require_errors2();
      var getScopeParserExecutionError = _require.getScopeParserExecutionError;
      var _require2 = require_utils2();
      var last = _require2.last;
      var _require3 = require_doc_utils();
      var concatArrays = _require3.concatArrays;
      function find(list, fn) {
        var length = list.length >>> 0;
        var value;
        for (var i = 0; i < length; i++) {
          value = list[i];
          if (fn.call(this, value, i, list)) {
            return value;
          }
        }
        return void 0;
      }
      function _getValue(tag, meta, num) {
        var _this = this;
        var scope = this.scopeList[num];
        var lastScope = this.scopeList[this.scopeList.length - 1];
        if (this.root.finishedResolving) {
          var w = this.resolved;
          var _loop = function _loop2() {
            var lIndex = _this.scopeLindex[i];
            w = find(w, function(r) {
              return r.lIndex === lIndex;
            });
            w = w.value[_this.scopePathItem[i]];
          };
          for (var i = this.resolveOffset, len = this.scopePath.length; i < len; i++) {
            _loop();
          }
          return find(w, function(r) {
            return meta.part.lIndex === r.lIndex;
          }).value;
        }
        var result;
        var parser;
        if (!this.cachedParsers || !meta.part) {
          parser = this.parser(tag, {
            tag: meta.part,
            scopePath: this.scopePath
          });
        } else if (this.cachedParsers[meta.part.lIndex]) {
          parser = this.cachedParsers[meta.part.lIndex];
        } else {
          parser = this.cachedParsers[meta.part.lIndex] = this.parser(tag, {
            tag: meta.part,
            scopePath: this.scopePath
          });
        }
        try {
          result = parser.get(scope, this.getContext(meta, num));
        } catch (error) {
          throw getScopeParserExecutionError({
            tag,
            scope,
            error,
            offset: meta.part.offset
          });
        }
        if (result == null && num > 0) {
          return _getValue.call(this, tag, meta, num - 1);
        }
        if (typeof result === "function") {
          try {
            result = result(lastScope, this);
          } catch (error) {
            throw getScopeParserExecutionError({
              tag,
              scope,
              error,
              offset: meta.part.offset
            });
          }
        }
        return result;
      }
      function _getValueAsync(tag, meta, num) {
        var _this2 = this;
        var scope = this.scopeList[num];
        var lastScope = this.scopeList[this.scopeList.length - 1];
        var parser;
        if (!this.cachedParsers || !meta.part) {
          parser = this.parser(tag, {
            tag: meta.part,
            scopePath: this.scopePath
          });
        } else if (this.cachedParsers[meta.part.lIndex]) {
          parser = this.cachedParsers[meta.part.lIndex];
        } else {
          parser = this.cachedParsers[meta.part.lIndex] = this.parser(tag, {
            tag: meta.part,
            scopePath: this.scopePath
          });
        }
        return Promise.resolve().then(function() {
          return parser.get(scope, _this2.getContext(meta, num));
        })["catch"](function(error) {
          throw getScopeParserExecutionError({
            tag,
            scope,
            error,
            offset: meta.part.offset
          });
        }).then(function(result) {
          if (result == null && num > 0) {
            return _getValueAsync.call(_this2, tag, meta, num - 1);
          }
          return result;
        }).then(function(result) {
          if (typeof result === "function") {
            try {
              result = result(lastScope, _this2);
            } catch (error) {
              throw getScopeParserExecutionError({
                tag,
                scope,
                error,
                offset: meta.part.offset
              });
            }
          }
          return result;
        });
      }
      var ScopeManager = /* @__PURE__ */ (function() {
        function ScopeManager2(options) {
          _classCallCheck(this, ScopeManager2);
          this.root = options.root || this;
          this.resolveOffset = options.resolveOffset || 0;
          this.scopePath = options.scopePath;
          this.scopePathItem = options.scopePathItem;
          this.scopePathLength = options.scopePathLength;
          this.scopeList = options.scopeList;
          this.scopeType = "";
          this.scopeTypes = options.scopeTypes;
          this.scopeLindex = options.scopeLindex;
          this.parser = options.parser;
          this.resolved = options.resolved;
          this.cachedParsers = options.cachedParsers;
        }
        return _createClass(ScopeManager2, [{
          key: "loopOver",
          value: function loopOver(tag, functor, inverted, meta) {
            return this.loopOverValue(this.getValue(tag, meta), functor, inverted);
          }
        }, {
          key: "functorIfInverted",
          value: function functorIfInverted(inverted, functor, value, i, length) {
            if (inverted) {
              functor(value, i, length);
            }
            return inverted;
          }
        }, {
          key: "isValueFalsy",
          value: function isValueFalsy(value, type) {
            return value == null || !value || type === "[object Array]" && value.length === 0;
          }
        }, {
          key: "loopOverValue",
          value: function loopOverValue(value, functor, inverted) {
            if (this.root.finishedResolving) {
              inverted = false;
            }
            var type = Object.prototype.toString.call(value);
            if (this.isValueFalsy(value, type)) {
              this.scopeType = false;
              return this.functorIfInverted(inverted, functor, last(this.scopeList), 0, 1);
            }
            if (type === "[object Array]") {
              this.scopeType = "array";
              for (var i = 0; i < value.length; i++) {
                this.functorIfInverted(!inverted, functor, value[i], i, value.length);
              }
              return true;
            }
            if (type === "[object Object]") {
              this.scopeType = "object";
              return this.functorIfInverted(!inverted, functor, value, 0, 1);
            }
            return this.functorIfInverted(!inverted, functor, last(this.scopeList), 0, 1);
          }
        }, {
          key: "getValue",
          value: function getValue(tag, meta) {
            var result = _getValue.call(this, tag, meta, this.scopeList.length - 1);
            return result;
          }
        }, {
          key: "getValueAsync",
          value: function getValueAsync(tag, meta) {
            return _getValueAsync.call(this, tag, meta, this.scopeList.length - 1);
          }
        }, {
          key: "getContext",
          value: function getContext(meta, num) {
            return {
              num,
              meta,
              scopeList: this.scopeList,
              resolved: this.resolved,
              scopePath: this.scopePath,
              scopeTypes: this.scopeTypes,
              scopePathItem: this.scopePathItem,
              scopePathLength: this.scopePathLength
            };
          }
        }, {
          key: "createSubScopeManager",
          value: function createSubScopeManager(scope, tag, i, part, length) {
            return new ScopeManager2({
              root: this.root,
              resolveOffset: this.resolveOffset,
              resolved: this.resolved,
              parser: this.parser,
              cachedParsers: this.cachedParsers,
              scopeTypes: concatArrays([this.scopeTypes, [this.scopeType]]),
              scopeList: concatArrays([this.scopeList, [scope]]),
              scopePath: concatArrays([this.scopePath, [tag]]),
              scopePathItem: concatArrays([this.scopePathItem, [i]]),
              scopePathLength: concatArrays([this.scopePathLength, [length]]),
              scopeLindex: concatArrays([this.scopeLindex, [part.lIndex]])
            });
          }
        }]);
      })();
      module.exports = function(options) {
        options.scopePath = [];
        options.scopePathItem = [];
        options.scopePathLength = [];
        options.scopeTypes = [];
        options.scopeLindex = [];
        options.scopeList = [options.tags];
        return new ScopeManager(options);
      };
    }
  });

  // node_modules/docxtemplater/js/lexer.js
  var require_lexer = __commonJS({
    "node_modules/docxtemplater/js/lexer.js"(exports, module) {
      "use strict";
      function _typeof(o) {
        "@babel/helpers - typeof";
        return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }
      function _slicedToArray(r, e) {
        return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest();
      }
      function _nonIterableRest() {
        throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
      }
      function _unsupportedIterableToArray(r, a) {
        if (r) {
          if ("string" == typeof r) return _arrayLikeToArray(r, a);
          var t = {}.toString.call(r).slice(8, -1);
          return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
        }
      }
      function _arrayLikeToArray(r, a) {
        (null == a || a > r.length) && (a = r.length);
        for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
        return n;
      }
      function _iterableToArrayLimit(r, l) {
        var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
        if (null != t) {
          var e, n, i, u, a = [], f = true, o = false;
          try {
            if (i = (t = t.call(r)).next, 0 === l) {
              if (Object(t) !== t) return;
              f = false;
            } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = true) ;
          } catch (r2) {
            o = true, n = r2;
          } finally {
            try {
              if (!f && null != t["return"] && (u = t["return"](), Object(u) !== u)) return;
            } finally {
              if (o) throw n;
            }
          }
          return a;
        }
      }
      function _arrayWithHoles(r) {
        if (Array.isArray(r)) return r;
      }
      function ownKeys(e, r) {
        var t = Object.keys(e);
        if (Object.getOwnPropertySymbols) {
          var o = Object.getOwnPropertySymbols(e);
          r && (o = o.filter(function(r2) {
            return Object.getOwnPropertyDescriptor(e, r2).enumerable;
          })), t.push.apply(t, o);
        }
        return t;
      }
      function _objectSpread(e) {
        for (var r = 1; r < arguments.length; r++) {
          var t = null != arguments[r] ? arguments[r] : {};
          r % 2 ? ownKeys(Object(t), true).forEach(function(r2) {
            _defineProperty(e, r2, t[r2]);
          }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r2) {
            Object.defineProperty(e, r2, Object.getOwnPropertyDescriptor(t, r2));
          });
        }
        return e;
      }
      function _defineProperty(e, r, t) {
        return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: true, configurable: true, writable: true }) : e[r] = t, e;
      }
      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");
        return "symbol" == _typeof(i) ? i : i + "";
      }
      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];
        if (void 0 !== e) {
          var i = e.call(t, r || "default");
          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }
        return ("string" === r ? String : Number)(t);
      }
      var _require = require_errors2();
      var getUnclosedTagException = _require.getUnclosedTagException;
      var getUnopenedTagException = _require.getUnopenedTagException;
      var getDuplicateOpenTagException = _require.getDuplicateOpenTagException;
      var getDuplicateCloseTagException = _require.getDuplicateCloseTagException;
      var throwMalformedXml = _require.throwMalformedXml;
      var throwXmlInvalid = _require.throwXmlInvalid;
      var XTTemplateError = _require.XTTemplateError;
      var _require2 = require_doc_utils();
      var isTextStart = _require2.isTextStart;
      var isTextEnd = _require2.isTextEnd;
      var wordToUtf8 = _require2.wordToUtf8;
      var pushArray = _require2.pushArray;
      var DELIMITER_NONE = 0;
      var DELIMITER_EQUAL = 1;
      var DELIMITER_START = 2;
      var DELIMITER_END = 3;
      function inRange(range, match) {
        return range[0] <= match.offset && match.offset < range[1];
      }
      function updateInTextTag(part, inTextTag) {
        if (isTextStart(part)) {
          if (inTextTag) {
            throwMalformedXml();
          }
          return true;
        }
        if (isTextEnd(part)) {
          if (!inTextTag) {
            throwMalformedXml();
          }
          return false;
        }
        return inTextTag;
      }
      function getTag(tag) {
        var position = "";
        var start = 1;
        var end = tag.indexOf(" ");
        if (tag[tag.length - 2] === "/") {
          position = "selfclosing";
          if (end === -1) {
            end = tag.length - 2;
          }
        } else if (tag[1] === "/") {
          start = 2;
          position = "end";
          if (end === -1) {
            end = tag.length - 1;
          }
        } else {
          position = "start";
          if (end === -1) {
            end = tag.length - 1;
          }
        }
        return {
          tag: tag.slice(start, end),
          position
        };
      }
      function tagMatcher(content, textMatchArray, othersMatchArray) {
        var cursor = 0;
        var contentLength = content.length;
        var allMatches = {};
        for (var _i2 = 0; _i2 < textMatchArray.length; _i2++) {
          var m = textMatchArray[_i2];
          allMatches[m] = true;
        }
        for (var _i4 = 0; _i4 < othersMatchArray.length; _i4++) {
          var _m = othersMatchArray[_i4];
          allMatches[_m] = false;
        }
        var totalMatches = [];
        while (cursor < contentLength) {
          cursor = content.indexOf("<", cursor);
          if (cursor === -1) {
            break;
          }
          var offset = cursor;
          var nextOpening = content.indexOf("<", cursor + 1);
          cursor = content.indexOf(">", cursor);
          if (cursor === -1 || nextOpening !== -1 && cursor > nextOpening) {
            throwXmlInvalid(content, offset);
          }
          var tagText = content.slice(offset, cursor + 1);
          var _getTag = getTag(tagText), tag = _getTag.tag, position = _getTag.position;
          var text = allMatches[tag];
          if (text == null) {
            continue;
          }
          totalMatches.push({
            type: "tag",
            position,
            text,
            offset,
            value: tagText,
            tag
          });
        }
        return totalMatches;
      }
      function getDelimiterErrors(delimiterMatches, fullText, syntaxOptions) {
        var errors = [];
        var inDelimiter = false;
        var lastDelimiterMatch = {
          offset: 0
        };
        var xtag;
        var delimiterWithErrors = delimiterMatches.reduce(function(delimiterAcc, currDelimiterMatch) {
          var position = currDelimiterMatch.position;
          var delimiterOffset = currDelimiterMatch.offset;
          var lastDelimiterOffset2 = lastDelimiterMatch.offset;
          var lastDelimiterLength = lastDelimiterMatch.length;
          xtag = fullText.substr(lastDelimiterOffset2, delimiterOffset - lastDelimiterOffset2);
          if (inDelimiter && position === "start") {
            if (lastDelimiterOffset2 + lastDelimiterLength === delimiterOffset) {
              xtag = fullText.substr(lastDelimiterOffset2, delimiterOffset - lastDelimiterOffset2 + lastDelimiterLength + 4);
              if (!syntaxOptions.allowUnclosedTag) {
                errors.push(getDuplicateOpenTagException({
                  xtag,
                  offset: lastDelimiterOffset2
                }));
                lastDelimiterMatch = currDelimiterMatch;
                delimiterAcc.push(_objectSpread(_objectSpread({}, currDelimiterMatch), {}, {
                  error: true
                }));
                return delimiterAcc;
              }
            }
            if (!syntaxOptions.allowUnclosedTag) {
              errors.push(getUnclosedTagException({
                xtag: wordToUtf8(xtag),
                offset: lastDelimiterOffset2
              }));
            }
            delimiterAcc.pop();
          }
          if (!inDelimiter && position === "end") {
            if (syntaxOptions.allowUnopenedTag) {
              return delimiterAcc;
            }
            if (lastDelimiterOffset2 + lastDelimiterLength === delimiterOffset) {
              xtag = fullText.substr(lastDelimiterOffset2 - 4, delimiterOffset - lastDelimiterOffset2 + lastDelimiterLength + 4);
              errors.push(getDuplicateCloseTagException({
                xtag,
                offset: lastDelimiterOffset2
              }));
              lastDelimiterMatch = currDelimiterMatch;
              delimiterAcc.push(_objectSpread(_objectSpread({}, currDelimiterMatch), {}, {
                error: true
              }));
              return delimiterAcc;
            }
            errors.push(getUnopenedTagException({
              xtag,
              offset: delimiterOffset
            }));
            lastDelimiterMatch = currDelimiterMatch;
            delimiterAcc.push(_objectSpread(_objectSpread({}, currDelimiterMatch), {}, {
              error: true
            }));
            return delimiterAcc;
          }
          inDelimiter = position === "start";
          lastDelimiterMatch = currDelimiterMatch;
          delimiterAcc.push(currDelimiterMatch);
          return delimiterAcc;
        }, []);
        if (inDelimiter) {
          var lastDelimiterOffset = lastDelimiterMatch.offset;
          xtag = fullText.substr(lastDelimiterOffset, fullText.length - lastDelimiterOffset);
          if (!syntaxOptions.allowUnclosedTag) {
            errors.push(getUnclosedTagException({
              xtag: wordToUtf8(xtag),
              offset: lastDelimiterOffset
            }));
          }
          delimiterWithErrors.pop();
        }
        return {
          delimiterWithErrors,
          errors
        };
      }
      function compareOffsets(startOffset, endOffset) {
        if (startOffset === -1 && endOffset === -1) {
          return DELIMITER_NONE;
        }
        if (startOffset === endOffset) {
          return DELIMITER_EQUAL;
        }
        if (startOffset === -1 || endOffset === -1) {
          return endOffset < startOffset ? DELIMITER_START : DELIMITER_END;
        }
        return startOffset < endOffset ? DELIMITER_START : DELIMITER_END;
      }
      function splitDelimiters(inside) {
        var newDelimiters = inside.split(" ");
        if (newDelimiters.length !== 2) {
          var err = new XTTemplateError("New Delimiters cannot be parsed");
          err.properties = {
            id: "change_delimiters_invalid",
            explanation: "Cannot parser delimiters"
          };
          throw err;
        }
        var _newDelimiters = _slicedToArray(newDelimiters, 2), start = _newDelimiters[0], end = _newDelimiters[1];
        if (start.length === 0 || end.length === 0) {
          var _err = new XTTemplateError("New Delimiters cannot be parsed");
          _err.properties = {
            id: "change_delimiters_invalid",
            explanation: "Cannot parser delimiters"
          };
          throw _err;
        }
        return [start, end];
      }
      function getAllDelimiterIndexes(fullText, delimiters, syntaxOptions) {
        var indexes = [];
        var start = delimiters.start, end = delimiters.end;
        var offset = -1;
        var insideTag = false;
        if (start == null && end == null) {
          return [];
        }
        while (true) {
          var startOffset = fullText.indexOf(start, offset + 1);
          var endOffset = fullText.indexOf(end, offset + 1);
          var position = null;
          var len = void 0;
          var compareResult = compareOffsets(startOffset, endOffset);
          if (compareResult === DELIMITER_EQUAL) {
            compareResult = insideTag ? DELIMITER_END : DELIMITER_START;
          }
          switch (compareResult) {
            case DELIMITER_NONE:
              return indexes;
            case DELIMITER_END:
              insideTag = false;
              offset = endOffset;
              position = "end";
              len = end.length;
              break;
            case DELIMITER_START:
              insideTag = true;
              offset = startOffset;
              position = "start";
              len = start.length;
              break;
          }
          if (syntaxOptions.changeDelimiterPrefix && compareResult === DELIMITER_START && fullText[offset + start.length] === syntaxOptions.changeDelimiterPrefix) {
            indexes.push({
              offset: startOffset,
              position: "start",
              length: start.length,
              changedelimiter: true
            });
            var nextEqual = fullText.indexOf(syntaxOptions.changeDelimiterPrefix, offset + start.length + 1);
            var nextEndOffset = fullText.indexOf(end, nextEqual + 1);
            indexes.push({
              offset: nextEndOffset,
              position: "end",
              length: end.length,
              changedelimiter: true
            });
            var _insideTag = fullText.substr(offset + start.length + 1, nextEqual - offset - start.length - 1);
            var _splitDelimiters = splitDelimiters(_insideTag);
            var _splitDelimiters2 = _slicedToArray(_splitDelimiters, 2);
            start = _splitDelimiters2[0];
            end = _splitDelimiters2[1];
            offset = nextEndOffset;
            continue;
          }
          indexes.push({
            offset,
            position,
            length: len
          });
        }
      }
      function parseDelimiters(innerContentParts, delimiters, syntaxOptions) {
        var full = "";
        for (var _i6 = 0; _i6 < innerContentParts.length; _i6++) {
          var p = innerContentParts[_i6];
          full += p.value;
        }
        var delimiterMatches = getAllDelimiterIndexes(full, delimiters, syntaxOptions);
        var offset = 0;
        var ranges = [];
        for (var _i8 = 0; _i8 < innerContentParts.length; _i8++) {
          var part = innerContentParts[_i8];
          offset += part.value.length;
          ranges.push({
            offset: offset - part.value.length,
            lIndex: part.lIndex
          });
        }
        var _getDelimiterErrors = getDelimiterErrors(delimiterMatches, full, syntaxOptions), delimiterWithErrors = _getDelimiterErrors.delimiterWithErrors, errors = _getDelimiterErrors.errors;
        var cutNext = 0;
        var delimiterIndex = 0;
        var parsed = [];
        for (var i = 0; i < ranges.length; i++) {
          var _p = ranges[i];
          var innerContentPart = innerContentParts[i];
          var _offset = _p.offset;
          var range = [_offset, _offset + innerContentPart.value.length];
          var partContent = innerContentPart.value;
          var delimitersInOffset = [];
          while (delimiterIndex < delimiterWithErrors.length && inRange(range, delimiterWithErrors[delimiterIndex])) {
            delimitersInOffset.push(delimiterWithErrors[delimiterIndex]);
            delimiterIndex++;
          }
          var parts = [];
          var cursor = 0;
          if (cutNext > 0) {
            cursor = cutNext;
            cutNext = 0;
          }
          for (var _i0 = 0; _i0 < delimitersInOffset.length; _i0++) {
            var delimiterInOffset = delimitersInOffset[_i0];
            var _value = partContent.substr(cursor, delimiterInOffset.offset - _offset - cursor);
            if (delimiterInOffset.changedelimiter) {
              if (delimiterInOffset.position === "start") {
                if (_value.length > 0) {
                  parts.push({
                    type: "content",
                    value: _value
                  });
                }
              } else {
                cursor = delimiterInOffset.offset - _offset + delimiterInOffset.length;
              }
              continue;
            }
            if (_value.length > 0) {
              parts.push({
                type: "content",
                value: _value
              });
              cursor += _value.length;
            }
            var delimiterPart = {
              type: "delimiter",
              position: delimiterInOffset.position,
              offset: cursor + _offset
            };
            parts.push(delimiterPart);
            cursor = delimiterInOffset.offset - _offset + delimiterInOffset.length;
          }
          cutNext = cursor - partContent.length;
          var value = partContent.substr(cursor);
          if (value.length > 0) {
            parts.push({
              type: "content",
              value
            });
          }
          parsed.push(parts);
        }
        return {
          parsed,
          errors
        };
      }
      function isInsideContent(part) {
        return part.type === "content" && part.position === "insidetag";
      }
      function getContentParts(xmlparsed) {
        return xmlparsed.filter(isInsideContent);
      }
      function decodeContentParts(xmlparsed, fileType) {
        var inTextTag = false;
        for (var _i10 = 0; _i10 < xmlparsed.length; _i10++) {
          var part = xmlparsed[_i10];
          inTextTag = updateInTextTag(part, inTextTag);
          if (part.type === "content") {
            part.position = inTextTag ? "insidetag" : "outsidetag";
          }
          if (fileType !== "text" && isInsideContent(part)) {
            part.value = part.value.replace(/>/g, "&gt;");
          }
        }
      }
      module.exports = {
        parseDelimiters,
        parse: function parse(xmllexed, delimiters, syntax, fileType) {
          decodeContentParts(xmllexed, fileType);
          var _parseDelimiters = parseDelimiters(getContentParts(xmllexed), delimiters, syntax), delimiterParsed = _parseDelimiters.parsed, errors = _parseDelimiters.errors;
          var lexed = [];
          var index = 0;
          var lIndex = 0;
          for (var _i12 = 0; _i12 < xmllexed.length; _i12++) {
            var part = xmllexed[_i12];
            if (isInsideContent(part)) {
              for (var _i14 = 0, _delimiterParsed$inde2 = delimiterParsed[index]; _i14 < _delimiterParsed$inde2.length; _i14++) {
                var p = _delimiterParsed$inde2[_i14];
                if (p.type === "content") {
                  p.position = "insidetag";
                }
                p.lIndex = lIndex++;
              }
              pushArray(lexed, delimiterParsed[index]);
              index++;
            } else {
              part.lIndex = lIndex++;
              lexed.push(part);
            }
          }
          return {
            errors,
            lexed
          };
        },
        xmlparse: function xmlparse(content, xmltags) {
          var matches = tagMatcher(content, xmltags.text, xmltags.other);
          var cursor = 0;
          var parsed = [];
          for (var _i16 = 0; _i16 < matches.length; _i16++) {
            var match = matches[_i16];
            if (content.length > cursor && match.offset - cursor > 0) {
              parsed.push({
                type: "content",
                value: content.substr(cursor, match.offset - cursor)
              });
            }
            cursor = match.offset + match.value.length;
            delete match.offset;
            parsed.push(match);
          }
          if (content.length > cursor) {
            parsed.push({
              type: "content",
              value: content.substr(cursor)
            });
          }
          return parsed;
        }
      };
    }
  });

  // node_modules/docxtemplater/js/get-tags.js
  var require_get_tags = __commonJS({
    "node_modules/docxtemplater/js/get-tags.js"(exports, module) {
      "use strict";
      function _toConsumableArray(r) {
        return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread();
      }
      function _nonIterableSpread() {
        throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
      }
      function _unsupportedIterableToArray(r, a) {
        if (r) {
          if ("string" == typeof r) return _arrayLikeToArray(r, a);
          var t = {}.toString.call(r).slice(8, -1);
          return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
        }
      }
      function _iterableToArray(r) {
        if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r);
      }
      function _arrayWithoutHoles(r) {
        if (Array.isArray(r)) return _arrayLikeToArray(r);
      }
      function _arrayLikeToArray(r, a) {
        (null == a || a > r.length) && (a = r.length);
        for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
        return n;
      }
      function isPlaceholder(part) {
        return part.type === "placeholder";
      }
      function getTags(postParsed) {
        var tags = {};
        var stack = [{
          items: postParsed.filter(isPlaceholder),
          parents: [],
          path: []
        }];
        function processFiltered(part2, current2, filtered) {
          if (filtered.length) {
            stack.push({
              items: filtered,
              parents: [].concat(_toConsumableArray(current2.parents), [part2]),
              path: part2.dataBound !== false && !part2.attrParsed && part2.value && !part2.attrParsed ? [].concat(_toConsumableArray(current2.path), [part2.value]) : _toConsumableArray(current2.path)
            });
          }
        }
        function getLocalTags(tags2, path) {
          var sizeScope2 = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : path.length;
          var localTags2 = tags2;
          for (var i = 0; i < sizeScope2; i++) {
            localTags2 = localTags2[path[i]];
          }
          return localTags2;
        }
        function getScopeSize(part2, parents) {
          var size = parents.length;
          for (var _i2 = 0; _i2 < parents.length; _i2++) {
            var parent = parents[_i2];
            var lIndexLoop = typeof parent.lIndex === "number" ? parent.lIndex : parseInt(parent.lIndex.split("-")[0], 10);
            if (lIndexLoop > part2.lIndex) {
              size--;
            }
          }
          return size;
        }
        while (stack.length > 0) {
          var current = stack.pop();
          var localTags = getLocalTags(tags, current.path);
          for (var _i4 = 0, _current$items2 = current.items; _i4 < _current$items2.length; _i4++) {
            var _localTags4, _part$value2;
            var part = _current$items2[_i4];
            if (part.attrParsed) {
              for (var key in part.attrParsed) {
                processFiltered(part, current, part.attrParsed[key].filter(isPlaceholder));
              }
              continue;
            }
            if (part.subparsed) {
              if (part.dataBound !== false) {
                var _localTags, _part$value;
                (_localTags = localTags)[_part$value = part.value] || (_localTags[_part$value] = {});
              }
              processFiltered(part, current, part.subparsed.filter(isPlaceholder));
              continue;
            }
            if (part.cellParsed) {
              for (var _i6 = 0, _part$cellPostParsed2 = part.cellPostParsed; _i6 < _part$cellPostParsed2.length; _i6++) {
                var cp = _part$cellPostParsed2[_i6];
                if (cp.type === "placeholder") {
                  if (cp.module === "pro-xml-templating/xls-module-loop") {
                    continue;
                  } else if (cp.subparsed) {
                    var _localTags2, _cp$value;
                    (_localTags2 = localTags)[_cp$value = cp.value] || (_localTags2[_cp$value] = {});
                    processFiltered(cp, current, cp.subparsed.filter(isPlaceholder));
                  } else {
                    var _localTags3, _cp$value2;
                    var sizeScope = getScopeSize(part, current.parents);
                    localTags = getLocalTags(tags, current.path, sizeScope);
                    (_localTags3 = localTags)[_cp$value2 = cp.value] || (_localTags3[_cp$value2] = {});
                  }
                }
              }
              continue;
            }
            if (part.dataBound === false) {
              continue;
            }
            (_localTags4 = localTags)[_part$value2 = part.value] || (_localTags4[_part$value2] = {});
          }
        }
        return tags;
      }
      module.exports = {
        getTags,
        isPlaceholder
      };
    }
  });

  // node_modules/docxtemplater/js/error-logger.js
  var require_error_logger = __commonJS({
    "node_modules/docxtemplater/js/error-logger.js"(exports, module) {
      "use strict";
      var _require = require_doc_utils();
      var pushArray = _require.pushArray;
      function replaceErrors(key, value) {
        if (value instanceof Error) {
          return pushArray(Object.getOwnPropertyNames(value), ["stack"]).reduce(function(error, key2) {
            error[key2] = value[key2];
            if (key2 === "stack") {
              error[key2] = value[key2].toString();
            }
            return error;
          }, {});
        }
        return value;
      }
      function logger(error, logging) {
        console.log(JSON.stringify({
          error
        }, replaceErrors, logging === "json" ? 2 : null));
        if (error.properties && error.properties.errors instanceof Array) {
          var errorMessages = error.properties.errors.map(function(error2) {
            return error2.properties.explanation;
          }).join("\n");
          console.log("errorMessages", errorMessages);
        }
      }
      module.exports = logger;
    }
  });

  // node_modules/docxtemplater/js/xml-matcher.js
  var require_xml_matcher = __commonJS({
    "node_modules/docxtemplater/js/xml-matcher.js"(exports, module) {
      "use strict";
      var _require = require_doc_utils();
      var pregMatchAll = _require.pregMatchAll;
      module.exports = function xmlMatcher(content, tagsXmlArray) {
        var res = {
          content
        };
        var taj = tagsXmlArray.join("|");
        var regexp = new RegExp("(?:(<(?:".concat(taj, ")[^>]*>)([^<>]*)</(?:").concat(taj, ")>)|(<(?:").concat(taj, ")[^>]*/>)"), "g");
        res.matches = pregMatchAll(regexp, res.content);
        return res;
      };
    }
  });

  // node_modules/docxtemplater/js/prefix-matcher.js
  var require_prefix_matcher = __commonJS({
    "node_modules/docxtemplater/js/prefix-matcher.js"(exports, module) {
      "use strict";
      function _typeof(o) {
        "@babel/helpers - typeof";
        return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }
      var nbspRegex = new RegExp(String.fromCharCode(160), "g");
      function replaceNbsps(str) {
        return str.replace(nbspRegex, " ");
      }
      function match(condition, placeHolderContent) {
        var type = _typeof(condition);
        if (type === "string") {
          return replaceNbsps(placeHolderContent.substr(0, condition.length)) === condition;
        }
        if (condition instanceof RegExp) {
          return condition.test(replaceNbsps(placeHolderContent));
        }
        if (type === "function") {
          return !!condition(placeHolderContent);
        }
      }
      function getValue(condition, placeHolderContent) {
        var type = _typeof(condition);
        if (type === "string") {
          return replaceNbsps(placeHolderContent).substr(condition.length);
        }
        if (condition instanceof RegExp) {
          return replaceNbsps(placeHolderContent).match(condition)[1];
        }
        if (type === "function") {
          return condition(placeHolderContent);
        }
      }
      function getValues(condition, placeHolderContent) {
        var type = _typeof(condition);
        if (type === "string") {
          return [placeHolderContent, replaceNbsps(placeHolderContent).substr(condition.length)];
        }
        if (condition instanceof RegExp) {
          return replaceNbsps(placeHolderContent).match(condition);
        }
        if (type === "function") {
          return [placeHolderContent, condition(placeHolderContent)];
        }
      }
      module.exports = {
        match,
        getValue,
        getValues
      };
    }
  });

  // node_modules/docxtemplater/js/parser.js
  var require_parser = __commonJS({
    "node_modules/docxtemplater/js/parser.js"(exports, module) {
      "use strict";
      function _typeof(o) {
        "@babel/helpers - typeof";
        return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }
      function ownKeys(e, r) {
        var t = Object.keys(e);
        if (Object.getOwnPropertySymbols) {
          var o = Object.getOwnPropertySymbols(e);
          r && (o = o.filter(function(r2) {
            return Object.getOwnPropertyDescriptor(e, r2).enumerable;
          })), t.push.apply(t, o);
        }
        return t;
      }
      function _objectSpread(e) {
        for (var r = 1; r < arguments.length; r++) {
          var t = null != arguments[r] ? arguments[r] : {};
          r % 2 ? ownKeys(Object(t), true).forEach(function(r2) {
            _defineProperty(e, r2, t[r2]);
          }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r2) {
            Object.defineProperty(e, r2, Object.getOwnPropertyDescriptor(t, r2));
          });
        }
        return e;
      }
      function _defineProperty(e, r, t) {
        return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: true, configurable: true, writable: true }) : e[r] = t, e;
      }
      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");
        return "symbol" == _typeof(i) ? i : i + "";
      }
      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];
        if (void 0 !== e) {
          var i = e.call(t, r || "default");
          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }
        return ("string" === r ? String : Number)(t);
      }
      function _slicedToArray(r, e) {
        return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest();
      }
      function _nonIterableRest() {
        throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
      }
      function _unsupportedIterableToArray(r, a) {
        if (r) {
          if ("string" == typeof r) return _arrayLikeToArray(r, a);
          var t = {}.toString.call(r).slice(8, -1);
          return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
        }
      }
      function _arrayLikeToArray(r, a) {
        (null == a || a > r.length) && (a = r.length);
        for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
        return n;
      }
      function _iterableToArrayLimit(r, l) {
        var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
        if (null != t) {
          var e, n, i, u, a = [], f = true, o = false;
          try {
            if (i = (t = t.call(r)).next, 0 === l) {
              if (Object(t) !== t) return;
              f = false;
            } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = true) ;
          } catch (r2) {
            o = true, n = r2;
          } finally {
            try {
              if (!f && null != t["return"] && (u = t["return"](), Object(u) !== u)) return;
            } finally {
              if (o) throw n;
            }
          }
          return a;
        }
      }
      function _arrayWithHoles(r) {
        if (Array.isArray(r)) return r;
      }
      var _require = require_doc_utils();
      var wordToUtf8 = _require.wordToUtf8;
      var pushArray = _require.pushArray;
      var isParagraphStart = _require.isParagraphStart;
      var isBreakTag = _require.isBreakTag;
      var _require2 = require_prefix_matcher();
      var match = _require2.match;
      var getValue = _require2.getValue;
      var getValues = _require2.getValues;
      function getMatchers(modules, options) {
        var allMatchers = [];
        for (var _i2 = 0; _i2 < modules.length; _i2++) {
          var _module = modules[_i2];
          if (_module.matchers) {
            var matchers = _module.matchers(options);
            if (!(matchers instanceof Array)) {
              throw new Error("module matcher returns a non array");
            }
            pushArray(allMatchers, matchers);
          }
        }
        return allMatchers;
      }
      function getMatches(matchers, placeHolderContent, options) {
        var matches = [];
        for (var _i4 = 0; _i4 < matchers.length; _i4++) {
          var matcher = matchers[_i4];
          var _matcher = _slicedToArray(matcher, 2), prefix = _matcher[0], _module2 = _matcher[1];
          var properties = matcher[2] || {};
          if (options.match(prefix, placeHolderContent)) {
            var values = options.getValues(prefix, placeHolderContent);
            if (typeof properties === "function") {
              properties = properties(values);
            }
            if (!properties.value) {
              var _values = _slicedToArray(values, 2);
              properties.value = _values[1];
            }
            matches.push(_objectSpread({
              type: "placeholder",
              prefix,
              module: _module2,
              onMatch: properties.onMatch,
              priority: properties.priority
            }, properties));
          }
        }
        return matches;
      }
      function moduleParse(placeHolderContent, options) {
        var modules = options.modules, startOffset = options.startOffset;
        var endLindex = options.lIndex;
        var moduleParsed;
        options.offset = startOffset;
        options.match = match;
        options.getValue = getValue;
        options.getValues = getValues;
        var matchers = getMatchers(modules, options);
        var matches = getMatches(matchers, placeHolderContent, options);
        if (matches.length > 0) {
          var bestMatch = null;
          for (var _i6 = 0; _i6 < matches.length; _i6++) {
            var _match = matches[_i6];
            _match.priority || (_match.priority = -_match.value.length);
            if (!bestMatch || _match.priority > bestMatch.priority) {
              bestMatch = _match;
            }
          }
          bestMatch.offset = startOffset;
          delete bestMatch.priority;
          bestMatch.endLindex = endLindex;
          bestMatch.lIndex = endLindex;
          bestMatch.raw = placeHolderContent;
          if (bestMatch.onMatch) {
            bestMatch.onMatch(bestMatch);
          }
          delete bestMatch.onMatch;
          delete bestMatch.prefix;
          return bestMatch;
        }
        for (var _i8 = 0; _i8 < modules.length; _i8++) {
          var _module3 = modules[_i8];
          moduleParsed = _module3.parse(placeHolderContent, options);
          if (moduleParsed) {
            moduleParsed.offset = startOffset;
            moduleParsed.endLindex = endLindex;
            moduleParsed.lIndex = endLindex;
            moduleParsed.raw = placeHolderContent;
            return moduleParsed;
          }
        }
        return {
          type: "placeholder",
          value: placeHolderContent,
          offset: startOffset,
          endLindex,
          lIndex: endLindex
        };
      }
      var parser = {
        preparse: function preparse(parsed, modules, options) {
          function preparse2(parsed2, options2) {
            for (var _i0 = 0; _i0 < modules.length; _i0++) {
              var _module4 = modules[_i0];
              parsed2 = _module4.preparse(parsed2, options2) || parsed2;
            }
            return parsed2;
          }
          return preparse2(parsed, options);
        },
        parse: function parse(lexed, modules, options) {
          var inPlaceHolder = false;
          var placeHolderContent = "";
          var startOffset;
          var tailParts = [];
          var droppedTags = options.fileTypeConfig.droppedTagsInsidePlaceholder || [];
          return lexed.reduce(function(parsed, token) {
            if (token.type === "delimiter") {
              inPlaceHolder = token.position === "start";
              if (token.position === "end") {
                options.parse = function(placeHolderContent2) {
                  return moduleParse(placeHolderContent2, _objectSpread(_objectSpread(_objectSpread({}, options), token), {}, {
                    startOffset,
                    modules
                  }));
                };
                parsed.push(options.parse(wordToUtf8(placeHolderContent)));
                pushArray(parsed, tailParts);
                tailParts = [];
              }
              if (token.position === "start") {
                tailParts = [];
                startOffset = token.offset;
              }
              placeHolderContent = "";
              return parsed;
            }
            if (!inPlaceHolder) {
              parsed.push(token);
              return parsed;
            }
            if (token.type !== "content" || token.position !== "insidetag") {
              if (options.syntax.preserveNewlinesInTags && (isBreakTag(token) || isParagraphStart(token))) {
                placeHolderContent += "\n";
              }
              if (droppedTags.indexOf(token.tag) !== -1) {
                return parsed;
              }
              tailParts.push(token);
              return parsed;
            }
            placeHolderContent += token.value;
            return parsed;
          }, []);
        },
        postparse: function postparse(postparsed, modules, options) {
          function getTraits(traitName, postparsed2, options2) {
            var result = [];
            for (var _i10 = 0; _i10 < modules.length; _i10++) {
              var _module5 = modules[_i10];
              result.push(_module5.getTraits(traitName, postparsed2, options2));
            }
            return result;
          }
          var errors = [];
          function _postparse(postparsed2, options2) {
            var newPostparsed = postparsed2;
            for (var _i12 = 0; _i12 < modules.length; _i12++) {
              var _module6 = modules[_i12];
              var postparseResult = _module6.postparse(newPostparsed, _objectSpread(_objectSpread({}, options2), {}, {
                postparse: function postparse2(parsed, opts) {
                  return _postparse(parsed, _objectSpread(_objectSpread({}, options2), opts));
                },
                getTraits
              }));
              if (postparseResult == null) {
                continue;
              }
              if (postparseResult.errors) {
                pushArray(errors, postparseResult.errors);
                newPostparsed = postparseResult.postparsed;
                continue;
              }
              newPostparsed = postparseResult;
            }
            return newPostparsed;
          }
          return {
            postparsed: _postparse(postparsed, options),
            errors
          };
        }
      };
      module.exports = parser;
    }
  });

  // node_modules/docxtemplater/js/get-resolved-id.js
  var require_get_resolved_id = __commonJS({
    "node_modules/docxtemplater/js/get-resolved-id.js"(exports, module) {
      "use strict";
      function getResolvedId(part, options) {
        if (part.lIndex == null) {
          return null;
        }
        var path = options.scopeManager.scopePathItem;
        if (part.parentPart) {
          path = path.slice(0, path.length - 1);
        }
        var res = options.filePath + "@" + part.lIndex.toString() + "-" + path.join("-");
        return res;
      }
      module.exports = getResolvedId;
    }
  });

  // node_modules/docxtemplater/js/render.js
  var require_render = __commonJS({
    "node_modules/docxtemplater/js/render.js"(exports, module) {
      "use strict";
      var _require = require_errors2();
      var throwUnimplementedTagType = _require.throwUnimplementedTagType;
      var XTScopeParserError = _require.XTScopeParserError;
      var _require2 = require_doc_utils();
      var pushArray = _require2.pushArray;
      var getResolvedId = require_get_resolved_id();
      function moduleRender(part, options) {
        for (var _i2 = 0, _options$modules2 = options.modules; _i2 < _options$modules2.length; _i2++) {
          var _module = _options$modules2[_i2];
          var moduleRendered = _module.render(part, options);
          if (moduleRendered) {
            return moduleRendered;
          }
        }
        return false;
      }
      function render(options) {
        var baseNullGetter = options.baseNullGetter;
        var compiled = options.compiled, scopeManager = options.scopeManager;
        options.nullGetter = function(part2, sm) {
          return baseNullGetter(part2, sm || scopeManager);
        };
        var errors = [];
        var parts = [];
        for (var i = 0, len = compiled.length; i < len; i++) {
          var part = compiled[i];
          options.index = i;
          options.resolvedId = getResolvedId(part, options);
          var moduleRendered = void 0;
          try {
            moduleRendered = moduleRender(part, options);
          } catch (e) {
            if (e instanceof XTScopeParserError) {
              errors.push(e);
              parts.push(part);
              continue;
            }
            throw e;
          }
          if (moduleRendered) {
            if (moduleRendered.errors) {
              pushArray(errors, moduleRendered.errors);
            }
            parts.push(moduleRendered);
            continue;
          }
          if (part.type === "content" || part.type === "tag") {
            parts.push(part);
            continue;
          }
          throwUnimplementedTagType(part, i);
        }
        var totalParts = [];
        for (var _i4 = 0; _i4 < parts.length; _i4++) {
          var value = parts[_i4].value;
          if (value instanceof Array) {
            pushArray(totalParts, value);
          } else if (value) {
            totalParts.push(value);
          }
        }
        return {
          errors,
          parts: totalParts
        };
      }
      module.exports = render;
    }
  });

  // node_modules/docxtemplater/js/postrender.js
  var require_postrender = __commonJS({
    "node_modules/docxtemplater/js/postrender.js"(exports, module) {
      "use strict";
      function string2buf(str) {
        var c, c2, mPos, i, bufLen = 0;
        var strLen = str.length;
        for (mPos = 0; mPos < strLen; mPos++) {
          c = str.charCodeAt(mPos);
          if ((c & 64512) === 55296 && mPos + 1 < strLen) {
            c2 = str.charCodeAt(mPos + 1);
            if ((c2 & 64512) === 56320) {
              c = 65536 + (c - 55296 << 10) + (c2 - 56320);
              mPos++;
            }
          }
          bufLen += c < 128 ? 1 : c < 2048 ? 2 : c < 65536 ? 3 : 4;
        }
        var buf = new Uint8Array(bufLen);
        for (i = 0, mPos = 0; i < bufLen; mPos++) {
          c = str.charCodeAt(mPos);
          if ((c & 64512) === 55296 && mPos + 1 < strLen) {
            c2 = str.charCodeAt(mPos + 1);
            if ((c2 & 64512) === 56320) {
              c = 65536 + (c - 55296 << 10) + (c2 - 56320);
              mPos++;
            }
          }
          if (c < 128) {
            buf[i++] = c;
          } else if (c < 2048) {
            buf[i++] = 192 | c >>> 6;
            buf[i++] = 128 | c & 63;
          } else if (c < 65536) {
            buf[i++] = 224 | c >>> 12;
            buf[i++] = 128 | c >>> 6 & 63;
            buf[i++] = 128 | c & 63;
          } else {
            buf[i++] = 240 | c >>> 18;
            buf[i++] = 128 | c >>> 12 & 63;
            buf[i++] = 128 | c >>> 6 & 63;
            buf[i++] = 128 | c & 63;
          }
        }
        return buf;
      }
      function postrender(parts, options) {
        for (var _i2 = 0, _options$modules2 = options.modules; _i2 < _options$modules2.length; _i2++) {
          var _module = _options$modules2[_i2];
          parts = _module.postrender(parts, options);
        }
        var fullLength = 0;
        var newParts = options.joinUncorrupt(parts, options);
        var longStr = "";
        var lenStr = 0;
        var maxCompact = 65536;
        var uintArrays = [];
        for (var i = 0, len = newParts.length; i < len; i++) {
          var part = newParts[i];
          if (part.length + lenStr > maxCompact) {
            var _arr = string2buf(longStr);
            fullLength += _arr.length;
            uintArrays.push(_arr);
            longStr = "";
          }
          longStr += part;
          lenStr += part.length;
          delete newParts[i];
        }
        var arr = string2buf(longStr);
        fullLength += arr.length;
        uintArrays.push(arr);
        var array = new Uint8Array(fullLength);
        var j = 0;
        for (var _i4 = 0; _i4 < uintArrays.length; _i4++) {
          var buf = uintArrays[_i4];
          for (var _i5 = 0; _i5 < buf.length; ++_i5) {
            array[_i5 + j] = buf[_i5];
          }
          j += buf.length;
        }
        return array;
      }
      module.exports = postrender;
    }
  });

  // node_modules/docxtemplater/js/resolve.js
  var require_resolve = __commonJS({
    "node_modules/docxtemplater/js/resolve.js"(exports, module) {
      "use strict";
      function _typeof(o) {
        "@babel/helpers - typeof";
        return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }
      function ownKeys(e, r) {
        var t = Object.keys(e);
        if (Object.getOwnPropertySymbols) {
          var o = Object.getOwnPropertySymbols(e);
          r && (o = o.filter(function(r2) {
            return Object.getOwnPropertyDescriptor(e, r2).enumerable;
          })), t.push.apply(t, o);
        }
        return t;
      }
      function _objectSpread(e) {
        for (var r = 1; r < arguments.length; r++) {
          var t = null != arguments[r] ? arguments[r] : {};
          r % 2 ? ownKeys(Object(t), true).forEach(function(r2) {
            _defineProperty(e, r2, t[r2]);
          }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r2) {
            Object.defineProperty(e, r2, Object.getOwnPropertyDescriptor(t, r2));
          });
        }
        return e;
      }
      function _defineProperty(e, r, t) {
        return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: true, configurable: true, writable: true }) : e[r] = t, e;
      }
      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");
        return "symbol" == _typeof(i) ? i : i + "";
      }
      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];
        if (void 0 !== e) {
          var i = e.call(t, r || "default");
          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }
        return ("string" === r ? String : Number)(t);
      }
      var _require = require_doc_utils();
      var pushArray = _require.pushArray;
      var getResolvedId = require_get_resolved_id();
      function moduleResolve(part, options) {
        for (var _i2 = 0, _options$modules2 = options.modules; _i2 < _options$modules2.length; _i2++) {
          var _module = _options$modules2[_i2];
          var moduleResolved = _module.resolve(part, options);
          if (moduleResolved) {
            return moduleResolved;
          }
        }
        return false;
      }
      function resolvePart(part, resolved, errors, options) {
        var moduleResolved = moduleResolve(part, _objectSpread(_objectSpread({}, options), {}, {
          resolvedId: getResolvedId(part, options)
        }));
        if (moduleResolved) {
          return moduleResolved.then(function(value) {
            resolved.push({
              tag: part.value,
              lIndex: part.lIndex,
              value
            });
          })["catch"](function(e) {
            if (e instanceof Array) {
              pushArray(errors, e);
            } else {
              errors.push(e);
            }
          });
        }
        if (part.type === "placeholder") {
          return options.scopeManager.getValueAsync(part.value, {
            part
          }).then(function(value) {
            return value == null ? options.nullGetter(part) : value;
          }).then(function(value) {
            resolved.push({
              tag: part.value,
              lIndex: part.lIndex,
              value
            });
          })["catch"](function(e) {
            if (e instanceof Array) {
              pushArray(errors, e);
            } else {
              errors.push(e);
            }
          });
        }
      }
      function resolve(options) {
        var resolved = [];
        var errors = [];
        var baseNullGetter = options.baseNullGetter;
        var scopeManager = options.scopeManager;
        options.nullGetter = function(part, sm) {
          return baseNullGetter(part, sm || scopeManager);
        };
        options.resolved = resolved;
        var p = resolveSerial(options, errors, resolved);
        if (p) {
          return p.then(function() {
            return resolveParallel(options, errors, resolved);
          });
        }
        return resolveParallel(options, errors, resolved);
      }
      function resolveSerial(options, errors, resolved) {
        var p = null;
        var _loop = function _loop2() {
          var part = _options$compiled2[_i4];
          if (["content", "tag"].indexOf(part.type) !== -1) {
            return 1;
          }
          if (part.resolveFirst) {
            p !== null && p !== void 0 ? p : p = Promise.resolve(null);
            p = p.then(function() {
              return resolvePart(part, resolved, errors, options);
            });
          }
        };
        for (var _i4 = 0, _options$compiled2 = options.compiled; _i4 < _options$compiled2.length; _i4++) {
          if (_loop()) continue;
        }
        return p;
      }
      function resolveParallel(options, errors, resolved) {
        var promises = [];
        for (var _i6 = 0, _options$compiled4 = options.compiled; _i6 < _options$compiled4.length; _i6++) {
          var part = _options$compiled4[_i6];
          if (["content", "tag"].indexOf(part.type) !== -1) {
            continue;
          }
          if (!part.resolveFirst) {
            promises.push(resolvePart(part, resolved, errors, options));
          }
        }
        return Promise.all(promises).then(function() {
          return {
            errors,
            resolved
          };
        });
      }
      module.exports = resolve;
    }
  });

  // node_modules/docxtemplater/js/join-uncorrupt.js
  var require_join_uncorrupt = __commonJS({
    "node_modules/docxtemplater/js/join-uncorrupt.js"(exports, module) {
      "use strict";
      var _require = require_doc_utils();
      var startsWith = _require.startsWith;
      var endsWith = _require.endsWith;
      var isStarting = _require.isStarting;
      var isEnding = _require.isEnding;
      var isWhiteSpace = _require.isWhiteSpace;
      var filetypes = require_filetypes();
      function addEmptyParagraphAfterTable(parts) {
        var lastNonEmpty = "";
        for (var i = 0, len = parts.length; i < len; i++) {
          var p = parts[i];
          if (isWhiteSpace(p) || startsWith(p, "<w:bookmarkEnd")) {
            continue;
          }
          if (endsWith(lastNonEmpty, "</w:tbl>")) {
            if (!startsWith(p, "<w:p") && !startsWith(p, "<w:tbl") && !startsWith(p, "<w:sectPr") && // Tested by #regression-paragraph-after-table-header-footer
            !startsWith(p, "</w:ftr>") && !startsWith(p, "</w:hdr>")) {
              p = "<w:p/>".concat(p);
            }
          }
          lastNonEmpty = p;
          parts[i] = p;
        }
        return parts;
      }
      function joinUncorrupt(parts, options) {
        var contains = options.fileTypeConfig.tagShouldContain || [];
        var collecting = "";
        var currentlyCollecting = -1;
        if (filetypes.docx.indexOf(options.contentType) !== -1) {
          parts = addEmptyParagraphAfterTable(parts);
        }
        var startIndex = -1;
        for (var j = 0, len2 = contains.length; j < len2; j++) {
          var _contains$j = contains[j], tag = _contains$j.tag, shouldContain = _contains$j.shouldContain, value = _contains$j.value, drop = _contains$j.drop, dropParent = _contains$j.dropParent;
          for (var i = 0, len = parts.length; i < len; i++) {
            var part = parts[i];
            if (currentlyCollecting === j) {
              if (isEnding(part, tag)) {
                currentlyCollecting = -1;
                if (dropParent) {
                  var start = -1;
                  for (var k = startIndex; k > 0; k--) {
                    if (isStarting(parts[k], dropParent)) {
                      start = k;
                      break;
                    }
                  }
                  for (var _k = start; _k <= parts.length; _k++) {
                    if (isEnding(parts[_k], dropParent)) {
                      parts[_k] = "";
                      break;
                    }
                    parts[_k] = "";
                  }
                } else {
                  for (var _k2 = startIndex; _k2 <= i; _k2++) {
                    parts[_k2] = "";
                  }
                  if (!drop) {
                    parts[i] = collecting + value + part;
                  }
                }
              }
              collecting += part;
              for (var _k3 = 0, len3 = shouldContain.length; _k3 < len3; _k3++) {
                var sc = shouldContain[_k3];
                if (isStarting(part, sc)) {
                  currentlyCollecting = -1;
                  break;
                }
              }
            }
            if (currentlyCollecting === -1 && isStarting(part, tag) && /*
             * To verify that the part doesn't have multiple tags,
             * such as <w:tc><w:p>
             */
            part.substr(1).indexOf("<") === -1) {
              if (part[part.length - 2] === "/") {
                parts[i] = "";
              } else {
                startIndex = i;
                currentlyCollecting = j;
                collecting = part;
              }
            }
          }
        }
        return parts;
      }
      module.exports = joinUncorrupt;
    }
  });

  // node_modules/docxtemplater/js/xml-templater.js
  var require_xml_templater = __commonJS({
    "node_modules/docxtemplater/js/xml-templater.js"(exports, module) {
      "use strict";
      function _typeof(o) {
        "@babel/helpers - typeof";
        return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }
      function _classCallCheck(a, n) {
        if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
      }
      function _defineProperties(e, r) {
        for (var t = 0; t < r.length; t++) {
          var o = r[t];
          o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, _toPropertyKey(o.key), o);
        }
      }
      function _createClass(e, r, t) {
        return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: false }), e;
      }
      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");
        return "symbol" == _typeof(i) ? i : i + "";
      }
      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];
        if (void 0 !== e) {
          var i = e.call(t, r || "default");
          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }
        return ("string" === r ? String : Number)(t);
      }
      var _require = require_doc_utils();
      var pushArray = _require.pushArray;
      var wordToUtf8 = _require.wordToUtf8;
      var convertSpaces = _require.convertSpaces;
      var xmlMatcher = require_xml_matcher();
      var Lexer = require_lexer();
      var Parser = require_parser();
      var _render = require_render();
      var postrender = require_postrender();
      var resolve = require_resolve();
      var joinUncorrupt = require_join_uncorrupt();
      function _getFullText(content, tagsXmlArray) {
        var matcher = xmlMatcher(content, tagsXmlArray);
        var result = [];
        for (var _i2 = 0, _matcher$matches2 = matcher.matches; _i2 < _matcher$matches2.length; _i2++) {
          var match = _matcher$matches2[_i2];
          result.push(match.array[2]);
        }
        return wordToUtf8(convertSpaces(result.join("")));
      }
      module.exports = /* @__PURE__ */ (function() {
        function XmlTemplater(content, options) {
          _classCallCheck(this, XmlTemplater);
          this.cachedParsers = {};
          this.content = content;
          for (var key in options) {
            this[key] = options[key];
          }
          this.setModules({
            inspect: {
              filePath: options.filePath
            }
          });
        }
        return _createClass(XmlTemplater, [{
          key: "resolveTags",
          value: function resolveTags(tags) {
            var _this = this;
            this.tags = tags;
            var options = this.getOptions();
            var filePath = this.filePath;
            options.scopeManager = this.scopeManager;
            options.resolve = resolve;
            var errors = [];
            var promises = [];
            for (var _i4 = 0, _this$modules2 = this.modules; _i4 < _this$modules2.length; _i4++) {
              var _module = _this$modules2[_i4];
              promises.push(Promise.resolve(_module.preResolve(options))["catch"](function(e) {
                errors.push(e);
              }));
            }
            return Promise.all(promises).then(function() {
              if (errors.length !== 0) {
                throw errors;
              }
              return resolve(options).then(function(_ref) {
                var resolved = _ref.resolved, errors2 = _ref.errors;
                for (var i = 0; i < errors2.length; i++) {
                  var _error;
                  var error = errors2[i];
                  if (!(error instanceof Error)) {
                    error = new Error(error);
                  }
                  (_error = error).properties || (_error.properties = {});
                  error.properties.file = filePath;
                  errors2[i] = error;
                }
                if (errors2.length !== 0) {
                  throw errors2;
                }
                return Promise.all(resolved).then(function(resolved2) {
                  options.scopeManager.root.finishedResolving = true;
                  options.scopeManager.resolved = resolved2;
                  _this.setModules({
                    inspect: {
                      resolved: resolved2,
                      filePath
                    }
                  });
                  return resolved2;
                });
              })["catch"](function(error) {
                _this.errorChecker(error);
                throw error;
              });
            });
          }
        }, {
          key: "getFullText",
          value: function getFullText() {
            return _getFullText(this.content, this.fileTypeConfig.tagsXmlTextArray);
          }
        }, {
          key: "setModules",
          value: function setModules(obj) {
            for (var _i6 = 0, _this$modules4 = this.modules; _i6 < _this$modules4.length; _i6++) {
              var _module2 = _this$modules4[_i6];
              _module2.set(obj);
            }
          }
        }, {
          key: "preparse",
          value: function preparse() {
            this.allErrors = [];
            this.xmllexed = Lexer.xmlparse(this.content, {
              text: this.fileTypeConfig.tagsXmlTextArray,
              other: this.fileTypeConfig.tagsXmlLexedArray
            });
            this.setModules({
              inspect: {
                filePath: this.filePath,
                xmllexed: this.xmllexed
              }
            });
            var _Lexer$parse = Lexer.parse(this.xmllexed, this.delimiters, this.syntax, this.fileType), lexed = _Lexer$parse.lexed, lexerErrors = _Lexer$parse.errors;
            pushArray(this.allErrors, lexerErrors);
            this.lexed = lexed;
            this.setModules({
              inspect: {
                filePath: this.filePath,
                lexed: this.lexed
              }
            });
            var options = this.getOptions();
            this.lexed = Parser.preparse(this.lexed, this.modules, options);
          }
        }, {
          key: "parse",
          value: function parse() {
            var _ref2 = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {}, noPostParse = _ref2.noPostParse;
            this.setModules({
              inspect: {
                filePath: this.filePath
              }
            });
            var options = this.getOptions();
            this.parsed = Parser.parse(this.lexed, this.modules, options);
            this.setModules({
              inspect: {
                filePath: this.filePath,
                parsed: this.parsed
              }
            });
            if (noPostParse) {
              return this;
            }
            return this.postparse();
          }
        }, {
          key: "postparse",
          value: function postparse() {
            var options = this.getOptions();
            var _Parser$postparse = Parser.postparse(this.parsed, this.modules, options), postparsed = _Parser$postparse.postparsed, postparsedErrors = _Parser$postparse.errors;
            this.postparsed = postparsed;
            this.setModules({
              inspect: {
                filePath: this.filePath,
                postparsed: this.postparsed
              }
            });
            pushArray(this.allErrors, postparsedErrors);
            this.errorChecker(this.allErrors);
            return this;
          }
        }, {
          key: "errorChecker",
          value: function errorChecker(errors) {
            for (var _i8 = 0, _errors2 = errors; _i8 < _errors2.length; _i8++) {
              var error = _errors2[_i8];
              error.properties || (error.properties = {});
              error.properties.file = this.filePath;
            }
            for (var _i0 = 0, _this$modules6 = this.modules; _i0 < _this$modules6.length; _i0++) {
              var _module3 = _this$modules6[_i0];
              errors = _module3.errorsTransformer(errors);
            }
          }
        }, {
          key: "baseNullGetter",
          value: function baseNullGetter(part, sm) {
            var value = null;
            for (var _i10 = 0, _this$modules8 = this.modules; _i10 < _this$modules8.length; _i10++) {
              var _module4 = _this$modules8[_i10];
              if (value != null) {
                continue;
              }
              value = _module4.nullGetter(part, sm, this);
            }
            if (value != null) {
              return value;
            }
            return this.nullGetter(part, sm);
          }
        }, {
          key: "getOptions",
          value: function getOptions() {
            return {
              compiled: this.postparsed,
              cachedParsers: this.cachedParsers,
              tags: this.tags,
              modules: this.modules,
              parser: this.parser,
              contentType: this.contentType,
              relsType: this.relsType,
              baseNullGetter: this.baseNullGetter.bind(this),
              filePath: this.filePath,
              syntax: this.syntax,
              fileTypeConfig: this.fileTypeConfig,
              fileType: this.fileType,
              linebreaks: this.linebreaks,
              stripInvalidXMLChars: this.stripInvalidXMLChars
            };
          }
        }, {
          key: "render",
          value: function render(to) {
            this.filePath = to;
            var options = this.getOptions();
            options.resolved = this.scopeManager.resolved;
            options.scopeManager = this.scopeManager;
            options.render = _render;
            options.joinUncorrupt = joinUncorrupt;
            var _render2 = _render(options), errors = _render2.errors, parts = _render2.parts;
            if (errors.length > 0) {
              this.allErrors = errors;
              this.errorChecker(errors);
              return this;
            }
            this.content = postrender(parts, options);
            this.setModules({
              inspect: {
                filePath: this.filePath,
                content: this.content
              }
            });
            return this;
          }
        }]);
      })();
    }
  });

  // node_modules/docxtemplater/js/modules/loop.js
  var require_loop = __commonJS({
    "node_modules/docxtemplater/js/modules/loop.js"(exports, module) {
      "use strict";
      function _typeof(o) {
        "@babel/helpers - typeof";
        return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }
      function ownKeys(e, r) {
        var t = Object.keys(e);
        if (Object.getOwnPropertySymbols) {
          var o = Object.getOwnPropertySymbols(e);
          r && (o = o.filter(function(r2) {
            return Object.getOwnPropertyDescriptor(e, r2).enumerable;
          })), t.push.apply(t, o);
        }
        return t;
      }
      function _objectSpread(e) {
        for (var r = 1; r < arguments.length; r++) {
          var t = null != arguments[r] ? arguments[r] : {};
          r % 2 ? ownKeys(Object(t), true).forEach(function(r2) {
            _defineProperty(e, r2, t[r2]);
          }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r2) {
            Object.defineProperty(e, r2, Object.getOwnPropertyDescriptor(t, r2));
          });
        }
        return e;
      }
      function _defineProperty(e, r, t) {
        return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: true, configurable: true, writable: true }) : e[r] = t, e;
      }
      function _slicedToArray(r, e) {
        return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest();
      }
      function _nonIterableRest() {
        throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
      }
      function _unsupportedIterableToArray(r, a) {
        if (r) {
          if ("string" == typeof r) return _arrayLikeToArray(r, a);
          var t = {}.toString.call(r).slice(8, -1);
          return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
        }
      }
      function _arrayLikeToArray(r, a) {
        (null == a || a > r.length) && (a = r.length);
        for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
        return n;
      }
      function _iterableToArrayLimit(r, l) {
        var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
        if (null != t) {
          var e, n, i, u, a = [], f = true, o = false;
          try {
            if (i = (t = t.call(r)).next, 0 === l) {
              if (Object(t) !== t) return;
              f = false;
            } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = true) ;
          } catch (r2) {
            o = true, n = r2;
          } finally {
            try {
              if (!f && null != t["return"] && (u = t["return"](), Object(u) !== u)) return;
            } finally {
              if (o) throw n;
            }
          }
          return a;
        }
      }
      function _arrayWithHoles(r) {
        if (Array.isArray(r)) return r;
      }
      function _classCallCheck(a, n) {
        if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
      }
      function _defineProperties(e, r) {
        for (var t = 0; t < r.length; t++) {
          var o = r[t];
          o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, _toPropertyKey(o.key), o);
        }
      }
      function _createClass(e, r, t) {
        return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: false }), e;
      }
      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");
        return "symbol" == _typeof(i) ? i : i + "";
      }
      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];
        if (void 0 !== e) {
          var i = e.call(t, r || "default");
          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }
        return ("string" === r ? String : Number)(t);
      }
      var _require = require_doc_utils();
      var chunkBy = _require.chunkBy;
      var last = _require.last;
      var isParagraphStart = _require.isParagraphStart;
      var isModule = _require.isModule;
      var pushArray = _require.pushArray;
      var isParagraphEnd = _require.isParagraphEnd;
      var isContent = _require.isContent;
      var startsWith = _require.startsWith;
      var isTagEnd = _require.isTagEnd;
      var isTagStart = _require.isTagStart;
      var getSingleAttribute = _require.getSingleAttribute;
      var setSingleAttribute = _require.setSingleAttribute;
      var filetypes = require_filetypes();
      var wrapper = require_module_wrapper();
      var _require2 = require_doc_utils();
      var isWhiteSpace = _require2.isWhiteSpace;
      var moduleName = "loop";
      function hasContent(parts) {
        for (var _i2 = 0; _i2 < parts.length; _i2++) {
          var part = parts[_i2];
          if (isContent(part)) {
            return true;
          }
        }
        return false;
      }
      function getFirstMeaningFulPart(parsed) {
        for (var _i4 = 0; _i4 < parsed.length; _i4++) {
          var part = parsed[_i4];
          if (part.type !== "content") {
            return part;
          }
        }
        return null;
      }
      function isInsideParagraphLoop(part) {
        var firstMeaningfulPart = getFirstMeaningFulPart(part.subparsed);
        return firstMeaningfulPart != null && firstMeaningfulPart.tag !== "w:t";
      }
      function getPageBreakIfApplies(part) {
        return part.hasPageBreak && isInsideParagraphLoop(part) ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : "";
      }
      function isEnclosedByParagraphs(parsed) {
        return parsed.length && isParagraphStart(parsed[0]) && isParagraphEnd(last(parsed));
      }
      function getOffset(chunk) {
        return hasContent(chunk) ? 0 : chunk.length;
      }
      function addPageBreakAtEnd(subRendered) {
        var j = subRendered.parts.length - 1;
        if (subRendered.parts[j] === "</w:p>") {
          subRendered.parts.splice(j, 0, '<w:r><w:br w:type="page"/></w:r>');
        } else {
          subRendered.parts.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
        }
      }
      function addPageBreakAtBeginning(subRendered) {
        subRendered.parts.unshift('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
      }
      function isContinuous(parts) {
        for (var _i6 = 0; _i6 < parts.length; _i6++) {
          var part = parts[_i6];
          if (isTagStart("w:type", part) && part.value.indexOf("continuous") !== -1) {
            return true;
          }
        }
        return false;
      }
      function isNextPage(parts) {
        for (var _i8 = 0; _i8 < parts.length; _i8++) {
          var part = parts[_i8];
          if (isTagStart("w:type", part) && part.value.indexOf('w:val="nextPage"') !== -1) {
            return true;
          }
        }
        return false;
      }
      function addSectionBefore(parts, sect) {
        var result = "";
        for (var _i0 = 0; _i0 < sect.length; _i0++) {
          var value = sect[_i0].value;
          result += value;
        }
        parts.unshift("<w:p><w:pPr>".concat(result, "</w:pPr></w:p>"));
      }
      function addContinuousType(parts) {
        var stop = false;
        var inSectPr = false;
        for (var i = 0; i < parts.length; i++) {
          var part = parts[i];
          if (!stop && startsWith(part, "<w:sectPr")) {
            inSectPr = true;
          }
          if (inSectPr) {
            if (startsWith(part, "<w:type")) {
              stop = true;
            }
            if (!stop && startsWith(part, "</w:sectPr")) {
              parts.splice(i, 0, '<w:type w:val="continuous"/>');
              i++;
            }
          }
        }
        return parts;
      }
      function dropHeaderFooterRefs(parts) {
        var writeIndex = 0;
        for (var readIndex = 0; readIndex < parts.length; readIndex++) {
          if (!startsWith(parts[readIndex], "<w:headerReference") && !startsWith(parts[readIndex], "<w:footerReference")) {
            parts[writeIndex] = parts[readIndex];
            writeIndex++;
          }
        }
        parts.length = writeIndex;
        return parts;
      }
      function hasPageBreak(chunk) {
        for (var _i10 = 0; _i10 < chunk.length; _i10++) {
          var part = chunk[_i10];
          if (part.tag === "w:br" && part.value.indexOf('w:type="page"') !== -1) {
            return true;
          }
        }
        return false;
      }
      function hasImage(chunk) {
        for (var _i12 = 0; _i12 < chunk.length; _i12++) {
          var el = chunk[_i12];
          if (el.tag === "w:drawing") {
            return true;
          }
        }
        return false;
      }
      function getSectPr(chunks) {
        var sectPrs = [];
        var currentSectPr = null;
        for (var _i14 = 0; _i14 < chunks.length; _i14++) {
          var part = chunks[_i14];
          if (isTagStart("w:sectPr", part)) {
            currentSectPr = [];
            sectPrs.push(currentSectPr);
          }
          if (currentSectPr !== null) {
            currentSectPr.push(part);
          }
          if (isTagEnd("w:sectPr", part)) {
            currentSectPr = null;
          }
        }
        return sectPrs;
      }
      function getSectPrHeaderFooterChangeCount(chunks) {
        var collectSectPr = false;
        var sectPrCount = 0;
        for (var _i16 = 0; _i16 < chunks.length; _i16++) {
          var part = chunks[_i16];
          if (isTagStart("w:sectPr", part)) {
            collectSectPr = true;
          }
          if (collectSectPr) {
            if (part.tag === "w:headerReference" || part.tag === "w:footerReference") {
              sectPrCount++;
              collectSectPr = false;
            }
          }
          if (isTagEnd("w:sectPr", part)) {
            collectSectPr = false;
          }
        }
        return sectPrCount;
      }
      function getLastSectPr(parsed) {
        var sectPr = [];
        var inSectPr = false;
        for (var i = parsed.length - 1; i >= 0; i--) {
          var part = parsed[i];
          if (isTagEnd("w:sectPr", part)) {
            inSectPr = true;
          }
          if (isTagStart("w:sectPr", part)) {
            sectPr.unshift(part.value);
            inSectPr = false;
          }
          if (inSectPr) {
            sectPr.unshift(part.value);
          }
          if (isParagraphStart(part)) {
            if (sectPr.length > 0) {
              return sectPr.join("");
            }
            break;
          }
        }
        return "";
      }
      var LoopModule = /* @__PURE__ */ (function() {
        function LoopModule2() {
          _classCallCheck(this, LoopModule2);
          this.name = "LoopModule";
          this.inXfrm = false;
          this.totalSectPr = 0;
          this.prefix = {
            start: "#",
            end: "/",
            dash: /^-([^\s]+)\s(.+)/,
            inverted: "^"
          };
        }
        return _createClass(LoopModule2, [{
          key: "optionsTransformer",
          value: function optionsTransformer(opts, docxtemplater) {
            this.docxtemplater = docxtemplater;
            return opts;
          }
        }, {
          key: "preparse",
          value: function preparse(parsed, _ref) {
            var contentType = _ref.contentType;
            if (filetypes.main.indexOf(contentType) !== -1) {
              this.sects = getSectPr(parsed);
            }
          }
        }, {
          key: "matchers",
          value: function matchers() {
            var module2 = moduleName;
            return [[this.prefix.start, module2, {
              expandTo: "auto",
              location: "start",
              inverted: false
            }], [this.prefix.inverted, module2, {
              expandTo: "auto",
              location: "start",
              inverted: true
            }], [this.prefix.end, module2, {
              location: "end"
            }], [this.prefix.dash, module2, function(_ref2) {
              var _ref3 = _slicedToArray(_ref2, 3), expandTo = _ref3[1], value = _ref3[2];
              return {
                location: "start",
                inverted: false,
                expandTo,
                value
              };
            }]];
          }
        }, {
          key: "getTraits",
          value: function getTraits(traitName, parsed) {
            if (traitName !== "expandPair") {
              return;
            }
            var tags = [];
            for (var offset = 0, len = parsed.length; offset < len; offset++) {
              var part = parsed[offset];
              if (isModule(part, moduleName) && part.subparsed == null) {
                tags.push({
                  part,
                  offset
                });
              }
            }
            return tags;
          }
          /* eslint-disable-next-line complexity */
        }, {
          key: "postparse",
          value: function postparse(parsed, _ref4) {
            var basePart = _ref4.basePart;
            if (basePart && this.docxtemplater.fileType === "docx" && parsed.length > 0) {
              basePart.sectPrCount = getSectPrHeaderFooterChangeCount(parsed);
              this.totalSectPr += basePart.sectPrCount;
              var sects = this.sects;
              for (var index = 0, len = sects.length; index < len; index++) {
                var sect = sects[index];
                if (basePart.lIndex < sect[0].lIndex) {
                  if (index + 1 < sects.length && isContinuous(sects[index + 1])) {
                    basePart.addContinuousType = true;
                  }
                  break;
                }
                if (parsed[0].lIndex < sect[0].lIndex && sect[0].lIndex < basePart.lIndex) {
                  if (isNextPage(sects[index])) {
                    basePart.addNextPage = {
                      index
                    };
                  }
                  break;
                }
              }
              basePart.lastParagrapSectPr = getLastSectPr(parsed);
            }
            if (!basePart || basePart.expandTo !== "auto" || basePart.module !== moduleName || !isEnclosedByParagraphs(parsed)) {
              return parsed;
            }
            basePart.paragraphLoop = true;
            var level = 0;
            var chunks = chunkBy(parsed, function(p) {
              if (isParagraphStart(p)) {
                level++;
                if (level === 1) {
                  return "start";
                }
              }
              if (isParagraphEnd(p)) {
                level--;
                if (level === 0) {
                  return "end";
                }
              }
              return null;
            });
            var firstChunk = chunks[0];
            var lastChunk = last(chunks);
            var firstOffset = getOffset(firstChunk);
            var lastOffset = getOffset(lastChunk);
            if (firstOffset > 0 && chunks[1][0].type === "content" && isWhiteSpace(chunks[1][0].value)) {
              firstOffset += 1;
            }
            if (lastOffset > 0 && last(chunks[chunks.length - 2]).type === "content" && isWhiteSpace(last(chunks[chunks.length - 2]).value)) {
              lastOffset += 1;
            }
            basePart.hasPageBreakBeginning = hasPageBreak(firstChunk);
            basePart.hasPageBreak = hasPageBreak(lastChunk);
            if (hasImage(firstChunk)) {
              firstOffset = 0;
            }
            if (hasImage(lastChunk)) {
              lastOffset = 0;
            }
            return parsed.slice(firstOffset, parsed.length - lastOffset);
          }
        }, {
          key: "resolve",
          value: function resolve(part, options) {
            var self2 = this;
            if (!isModule(part, moduleName)) {
              return null;
            }
            var sm = options.scopeManager;
            var promisedValue = sm.getValueAsync(part.value, {
              part
            });
            var promises = [];
            var lastPromise;
            if (self2.resolveSerially) {
              lastPromise = Promise.resolve(null);
            }
            function loopOver(scope, i, length) {
              var scopeManager = sm.createSubScopeManager(scope, part.value, i, part, length);
              if (self2.resolveSerially) {
                lastPromise = lastPromise.then(function() {
                  return options.resolve(_objectSpread(_objectSpread({}, options), {}, {
                    compiled: part.subparsed,
                    tags: {},
                    scopeManager
                  }));
                });
                promises.push(lastPromise);
              } else {
                promises.push(options.resolve(_objectSpread(_objectSpread({}, options), {}, {
                  compiled: part.subparsed,
                  tags: {},
                  scopeManager
                })));
              }
            }
            var errorList = [];
            return promisedValue.then(function(values) {
              values !== null && values !== void 0 ? values : values = options.nullGetter(part);
              if (values instanceof Promise) {
                return values.then(function(values2) {
                  if (values2 instanceof Array) {
                    return Promise.all(values2);
                  }
                  return values2;
                });
              }
              if (values instanceof Array) {
                return Promise.all(values);
              }
              return values;
            }).then(function(values) {
              sm.loopOverValue(values, loopOver, part.inverted);
              return Promise.all(promises).then(function(r) {
                var result = [];
                for (var _i18 = 0; _i18 < r.length; _i18++) {
                  var _r$_i = r[_i18], resolved = _r$_i.resolved, errors = _r$_i.errors;
                  pushArray(errorList, errors);
                  result.push(resolved);
                }
                return result;
              }).then(function(value) {
                if (errorList.length > 0) {
                  throw errorList;
                }
                return value;
              });
            });
          }
        }, {
          key: "render",
          value: function render(part, options) {
            var self2 = this;
            if (part.tag === "p:xfrm") {
              self2.inXfrm = part.position === "start";
            }
            if (part.tag === "a:ext" && self2.inXfrm) {
              self2.lastExt = part;
              return part;
            }
            if (!isModule(part, moduleName)) {
              return null;
            }
            var totalValue = [];
            var errors = [];
            var heightOffset = 0;
            var firstTag = part.subparsed[0];
            var tagHeight = 0;
            if ((firstTag === null || firstTag === void 0 ? void 0 : firstTag.tag) === "a:tr") {
              tagHeight = +getSingleAttribute(firstTag.value, "h");
            }
            heightOffset -= tagHeight;
            var a16RowIdOffset = 0;
            var insideParagraphLoop = isInsideParagraphLoop(part);
            function loopOver(scope, i, length) {
              heightOffset += tagHeight;
              var scopeManager = options.scopeManager.createSubScopeManager(scope, part.value, i, part, length);
              for (var _i20 = 0, _part$subparsed2 = part.subparsed; _i20 < _part$subparsed2.length; _i20++) {
                var pp = _part$subparsed2[_i20];
                if (isTagStart("a16:rowId", pp)) {
                  var val = +getSingleAttribute(pp.value, "val") + a16RowIdOffset;
                  a16RowIdOffset = 1;
                  pp.value = setSingleAttribute(pp.value, "val", val);
                }
              }
              var subRendered = options.render(_objectSpread(_objectSpread({}, options), {}, {
                compiled: part.subparsed,
                tags: {},
                scopeManager
              }));
              if (part.hasPageBreak && i === length - 1 && insideParagraphLoop) {
                addPageBreakAtEnd(subRendered);
              }
              var isNotFirst = scopeManager.scopePathItem.some(function(i2) {
                return i2 !== 0;
              });
              if (isNotFirst) {
                if (part.sectPrCount === 1) {
                  subRendered.parts = dropHeaderFooterRefs(subRendered.parts);
                }
                if (part.addContinuousType) {
                  subRendered.parts = addContinuousType(subRendered.parts);
                }
              } else if (part.addNextPage) {
                addSectionBefore(subRendered.parts, self2.sects[part.addNextPage.index]);
              }
              if (part.addNextPage) {
                addPageBreakAtEnd(subRendered);
              }
              if (part.hasPageBreakBeginning && insideParagraphLoop) {
                addPageBreakAtBeginning(subRendered);
              }
              for (var _i22 = 0, _subRendered$parts2 = subRendered.parts; _i22 < _subRendered$parts2.length; _i22++) {
                var _val = _subRendered$parts2[_i22];
                totalValue.push(_val);
              }
              pushArray(errors, subRendered.errors);
            }
            var value = options.scopeManager.getValue(part.value, {
              part
            });
            value !== null && value !== void 0 ? value : value = options.nullGetter(part);
            var result = options.scopeManager.loopOverValue(value, loopOver, part.inverted);
            if (result === false) {
              if (part.lastParagrapSectPr) {
                if (part.paragraphLoop) {
                  return {
                    value: "<w:p><w:pPr>".concat(part.lastParagrapSectPr, "</w:pPr></w:p>")
                  };
                }
                return {
                  value: "</w:t></w:r></w:p><w:p><w:pPr>".concat(part.lastParagrapSectPr, "</w:pPr><w:r><w:t>")
                };
              }
              return {
                value: getPageBreakIfApplies(part) || "",
                errors
              };
            }
            if (heightOffset !== 0) {
              var cy = +getSingleAttribute(self2.lastExt.value, "cy");
              self2.lastExt.value = setSingleAttribute(self2.lastExt.value, "cy", cy + heightOffset);
            }
            return {
              value: options.joinUncorrupt(totalValue, _objectSpread(_objectSpread({}, options), {}, {
                basePart: part
              })),
              errors
            };
          }
        }]);
      })();
      module.exports = function() {
        return wrapper(new LoopModule());
      };
    }
  });

  // node_modules/docxtemplater/js/modules/space-preserve.js
  var require_space_preserve = __commonJS({
    "node_modules/docxtemplater/js/modules/space-preserve.js"(exports, module) {
      "use strict";
      function _typeof(o) {
        "@babel/helpers - typeof";
        return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }
      function _classCallCheck(a, n) {
        if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
      }
      function _defineProperties(e, r) {
        for (var t = 0; t < r.length; t++) {
          var o = r[t];
          o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, _toPropertyKey(o.key), o);
        }
      }
      function _createClass(e, r, t) {
        return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: false }), e;
      }
      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");
        return "symbol" == _typeof(i) ? i : i + "";
      }
      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];
        if (void 0 !== e) {
          var i = e.call(t, r || "default");
          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }
        return ("string" === r ? String : Number)(t);
      }
      var wrapper = require_module_wrapper();
      var _require = require_doc_utils();
      var isTextStart = _require.isTextStart;
      var isTextEnd = _require.isTextEnd;
      var endsWith = _require.endsWith;
      var startsWith = _require.startsWith;
      var pushArray = _require.pushArray;
      var wTpreserve = '<w:t xml:space="preserve">';
      var wTpreservelen = wTpreserve.length;
      var wtEnd = "</w:t>";
      var wtEndlen = wtEnd.length;
      function isWtStart(part) {
        return isTextStart(part) && part.tag === "w:t";
      }
      function addXMLPreserve(chunk, index) {
        var tag = chunk[index].value;
        if (chunk[index + 1].value === "</w:t>") {
          return tag;
        }
        if (tag.indexOf('xml:space="preserve"') !== -1) {
          return tag;
        }
        return tag.substr(0, tag.length - 1) + ' xml:space="preserve">';
      }
      function isInsideLoop(meta, chunk) {
        return meta && meta.basePart && chunk.length > 1;
      }
      var SpacePreserve = /* @__PURE__ */ (function() {
        function SpacePreserve2() {
          _classCallCheck(this, SpacePreserve2);
          this.name = "SpacePreserveModule";
        }
        return _createClass(SpacePreserve2, [{
          key: "postparse",
          value: function postparse(postparsed, meta) {
            var chunk = [], inTextTag = false, endLindex = 0, lastTextTag = 0;
            function isStartingPlaceHolder(part, chunk2) {
              return part.type === "placeholder" && chunk2.length > 1;
            }
            var result = postparsed.reduce(function(postparsed2, part) {
              if (isWtStart(part)) {
                inTextTag = true;
                lastTextTag = chunk.length;
              }
              if (!inTextTag) {
                postparsed2.push(part);
                return postparsed2;
              }
              chunk.push(part);
              if (isInsideLoop(meta, chunk)) {
                endLindex = meta.basePart.endLindex;
                chunk[0].value = addXMLPreserve(chunk, 0);
              }
              if (isStartingPlaceHolder(part, chunk)) {
                chunk[lastTextTag].value = addXMLPreserve(chunk, lastTextTag);
                endLindex = part.endLindex;
              }
              if (isTextEnd(part) && part.lIndex > endLindex) {
                if (endLindex !== 0) {
                  chunk[lastTextTag].value = addXMLPreserve(chunk, lastTextTag);
                }
                pushArray(postparsed2, chunk);
                chunk = [];
                inTextTag = false;
                endLindex = 0;
                lastTextTag = 0;
              }
              return postparsed2;
            }, []);
            pushArray(result, chunk);
            return result;
          }
        }, {
          key: "postrender",
          value: function postrender(parts) {
            var lastNonEmpty = "";
            var lastNonEmptyIndex = 0;
            for (var i = 0, len = parts.length; i < len; i++) {
              var p = parts[i];
              if (p === "") {
                continue;
              }
              if (endsWith(lastNonEmpty, wTpreserve) && startsWith(p, wtEnd)) {
                parts[lastNonEmptyIndex] = lastNonEmpty.substr(0, lastNonEmpty.length - wTpreservelen) + "<w:t/>";
                p = p.substr(wtEndlen);
              }
              lastNonEmpty = p;
              lastNonEmptyIndex = i;
              parts[i] = p;
            }
            return parts;
          }
        }]);
      })();
      module.exports = function() {
        return wrapper(new SpacePreserve());
      };
    }
  });

  // node_modules/docxtemplater/js/modules/rawxml.js
  var require_rawxml = __commonJS({
    "node_modules/docxtemplater/js/modules/rawxml.js"(exports, module) {
      "use strict";
      function _typeof(o) {
        "@babel/helpers - typeof";
        return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }
      function _classCallCheck(a, n) {
        if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
      }
      function _defineProperties(e, r) {
        for (var t = 0; t < r.length; t++) {
          var o = r[t];
          o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, _toPropertyKey(o.key), o);
        }
      }
      function _createClass(e, r, t) {
        return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: false }), e;
      }
      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");
        return "symbol" == _typeof(i) ? i : i + "";
      }
      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];
        if (void 0 !== e) {
          var i = e.call(t, r || "default");
          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }
        return ("string" === r ? String : Number)(t);
      }
      var traits = require_traits();
      var _require = require_doc_utils();
      var isContent = _require.isContent;
      var getPartWithDelimiters = _require.getPartWithDelimiters;
      var _require2 = require_errors2();
      var throwRawTagShouldBeOnlyTextInParagraph = _require2.throwRawTagShouldBeOnlyTextInParagraph;
      var getInvalidRawXMLValueException = _require2.getInvalidRawXMLValueException;
      var wrapper = require_module_wrapper();
      var moduleName = "rawxml";
      function getInner(_ref) {
        var part = _ref.part, left = _ref.left, right = _ref.right, postparsed = _ref.postparsed, index = _ref.index;
        var paragraphParts = postparsed.slice(left + 1, right);
        for (var i = 0, len = paragraphParts.length; i < len; i++) {
          if (i === index - left - 1) {
            continue;
          }
          var p = paragraphParts[i];
          if (isContent(p)) {
            throwRawTagShouldBeOnlyTextInParagraph({
              paragraphParts,
              part
            });
          }
        }
        return part;
      }
      var RawXmlModule = /* @__PURE__ */ (function() {
        function RawXmlModule2() {
          _classCallCheck(this, RawXmlModule2);
          this.name = "RawXmlModule";
          this.prefix = "@";
        }
        return _createClass(RawXmlModule2, [{
          key: "optionsTransformer",
          value: function optionsTransformer(options, docxtemplater) {
            this.fileTypeConfig = docxtemplater.fileTypeConfig;
            return options;
          }
        }, {
          key: "matchers",
          value: function matchers() {
            return [[this.prefix, moduleName]];
          }
        }, {
          key: "postparse",
          value: function postparse(postparsed) {
            var _this = this;
            return traits.expandToOne(postparsed, {
              moduleName,
              getInner,
              expandTo: this.fileTypeConfig.tagRawXml,
              error: {
                message: "Raw tag not in paragraph",
                id: "raw_tag_outerxml_invalid",
                explanation: function explanation(part) {
                  return 'The tag "'.concat(getPartWithDelimiters(part, _this.docxtemplater), '" is not inside a paragraph, putting raw tags inside an inline loop is disallowed.');
                }
              }
            });
          }
        }, {
          key: "render",
          value: function render(part, options) {
            if (part.module !== moduleName) {
              return null;
            }
            var value;
            var errors = [];
            try {
              value = options.scopeManager.getValue(part.value, {
                part
              });
              value !== null && value !== void 0 ? value : value = options.nullGetter(part);
            } catch (e) {
              errors.push(e);
              return {
                errors
              };
            }
            value = value ? value : "";
            if (typeof value === "string") {
              return {
                value
              };
            }
            return {
              errors: [getInvalidRawXMLValueException({
                tag: part.value,
                value,
                partDelims: getPartWithDelimiters(part, this.docxtemplater),
                part,
                offset: part.offset
              })]
            };
          }
        }]);
      })();
      module.exports = function() {
        return wrapper(new RawXmlModule());
      };
    }
  });

  // node_modules/docxtemplater/js/merge-sort.js
  var require_merge_sort = __commonJS({
    "node_modules/docxtemplater/js/merge-sort.js"(exports, module) {
      "use strict";
      function getMinFromArrays(arrays, state) {
        var minIndex = -1;
        for (var i = 0, l = arrays.length; i < l; i++) {
          if (state[i] >= arrays[i].length) {
            continue;
          }
          if (minIndex === -1 || arrays[i][state[i]].offset < arrays[minIndex][state[minIndex]].offset) {
            minIndex = i;
          }
        }
        return minIndex;
      }
      module.exports = function(arrays) {
        var totalLength = 0;
        for (var _i2 = 0, _arrays2 = arrays; _i2 < _arrays2.length; _i2++) {
          var array = _arrays2[_i2];
          totalLength += array.length;
        }
        arrays = arrays.filter(function(array2) {
          return array2.length > 0;
        });
        var resultArray = new Array(totalLength);
        var state = arrays.map(function() {
          return 0;
        });
        for (var i = 0; i < totalLength; i++) {
          var arrayIndex = getMinFromArrays(arrays, state);
          resultArray[i] = arrays[arrayIndex][state[arrayIndex]];
          state[arrayIndex]++;
        }
        return resultArray;
      };
    }
  });

  // node_modules/docxtemplater/js/modules/expand-pair-trait.js
  var require_expand_pair_trait = __commonJS({
    "node_modules/docxtemplater/js/modules/expand-pair-trait.js"(exports, module) {
      "use strict";
      function _typeof(o) {
        "@babel/helpers - typeof";
        return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }
      function _classCallCheck(a, n) {
        if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
      }
      function _defineProperties(e, r) {
        for (var t = 0; t < r.length; t++) {
          var o = r[t];
          o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, _toPropertyKey(o.key), o);
        }
      }
      function _createClass(e, r, t) {
        return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: false }), e;
      }
      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");
        return "symbol" == _typeof(i) ? i : i + "";
      }
      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];
        if (void 0 !== e) {
          var i = e.call(t, r || "default");
          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }
        return ("string" === r ? String : Number)(t);
      }
      var traitName = "expandPair";
      var mergeSort = require_merge_sort();
      var _require = require_doc_utils();
      var getLeft = _require.getLeft;
      var getRight = _require.getRight;
      var pushArray = _require.pushArray;
      var wrapper = require_module_wrapper();
      var _require2 = require_traits();
      var getExpandToDefault = _require2.getExpandToDefault;
      var _require3 = require_errors2();
      var getUnmatchedLoopException = _require3.getUnmatchedLoopException;
      var getClosingTagNotMatchOpeningTag = _require3.getClosingTagNotMatchOpeningTag;
      var getUnbalancedLoopException = _require3.getUnbalancedLoopException;
      function getOpenCountChange(part) {
        switch (part.location) {
          case "start":
            return 1;
          case "end":
            return -1;
        }
      }
      function match(start, end) {
        return start != null && end != null && (start.part.location === "start" && end.part.location === "end" && start.part.value === end.part.value || end.part.value === "");
      }
      function transformer(traits) {
        var i = 0;
        var errors = [];
        while (i < traits.length) {
          var part = traits[i].part;
          if (part.location === "end") {
            if (i === 0) {
              traits.splice(0, 1);
              errors.push(getUnmatchedLoopException(part));
              return {
                traits,
                errors
              };
            }
            var endIndex = i;
            var startIndex = i - 1;
            var offseter = 1;
            if (match(traits[startIndex], traits[endIndex])) {
              traits.splice(endIndex, 1);
              traits.splice(startIndex, 1);
              return {
                errors,
                traits
              };
            }
            while (offseter < 50) {
              var startCandidate = traits[startIndex - offseter];
              var endCandidate = traits[endIndex + offseter];
              if (match(startCandidate, traits[endIndex])) {
                traits.splice(endIndex, 1);
                traits.splice(startIndex - offseter, 1);
                return {
                  errors,
                  traits
                };
              }
              if (match(traits[startIndex], endCandidate)) {
                traits.splice(endIndex + offseter, 1);
                traits.splice(startIndex, 1);
                return {
                  errors,
                  traits
                };
              }
              offseter++;
            }
            errors.push(getClosingTagNotMatchOpeningTag({
              tags: [traits[startIndex].part, traits[endIndex].part]
            }));
            traits.splice(endIndex, 1);
            traits.splice(startIndex, 1);
            return {
              traits,
              errors
            };
          }
          i++;
        }
        for (var _i2 = 0; _i2 < traits.length; _i2++) {
          var _part = traits[_i2].part;
          errors.push(getUnmatchedLoopException(_part));
        }
        return {
          traits: [],
          errors
        };
      }
      function getPairs(traits) {
        var levelTraits = {};
        var errors = [];
        var pairs = [];
        var transformedTraits = [];
        pushArray(transformedTraits, traits);
        while (transformedTraits.length > 0) {
          var result = transformer(transformedTraits);
          pushArray(errors, result.errors);
          transformedTraits = result.traits;
        }
        if (errors.length > 0) {
          return {
            pairs,
            errors
          };
        }
        var countOpen = 0;
        for (var _i4 = 0; _i4 < traits.length; _i4++) {
          var currentTrait = traits[_i4];
          var part = currentTrait.part;
          var change = getOpenCountChange(part);
          countOpen += change;
          if (change === 1) {
            levelTraits[countOpen] = currentTrait;
          } else {
            var startTrait = levelTraits[countOpen + 1];
            if (countOpen === 0) {
              pairs.push([startTrait, currentTrait]);
            }
          }
          countOpen = countOpen >= 0 ? countOpen : 0;
        }
        return {
          pairs,
          errors
        };
      }
      var ExpandPairTrait = /* @__PURE__ */ (function() {
        function ExpandPairTrait2() {
          _classCallCheck(this, ExpandPairTrait2);
          this.name = "ExpandPairTrait";
        }
        return _createClass(ExpandPairTrait2, [{
          key: "optionsTransformer",
          value: function optionsTransformer(options, docxtemplater) {
            if (docxtemplater.options.paragraphLoop) {
              pushArray(docxtemplater.fileTypeConfig.expandTags, docxtemplater.fileTypeConfig.onParagraphLoop);
            }
            this.expandTags = docxtemplater.fileTypeConfig.expandTags;
            return options;
          }
        }, {
          key: "postparse",
          value: function postparse(postparsed, options) {
            var _this = this;
            var getTraits = options.getTraits, postparse2 = options.postparse, fileType = options.fileType;
            var traits = getTraits(traitName, postparsed, options);
            traits = traits.map(function(trait) {
              return trait || [];
            });
            traits = mergeSort(traits);
            var _getPairs = getPairs(traits), pairs = _getPairs.pairs, errors = _getPairs.errors;
            var lastRight = 0;
            var lastPair = null;
            var expandedPairs = pairs.map(function(pair) {
              var expandTo = pair[0].part.expandTo;
              if (expandTo === "auto" && fileType !== "text") {
                var result = getExpandToDefault(postparsed, pair, _this.expandTags);
                if (result.error) {
                  errors.push(result.error);
                }
                expandTo = result.value;
              }
              if (!expandTo || fileType === "text") {
                var _left = pair[0].offset;
                var _right = pair[1].offset;
                if (_left < lastRight && !_this.docxtemplater.options.syntax.allowUnbalancedLoops) {
                  errors.push(getUnbalancedLoopException(pair, lastPair));
                }
                lastPair = pair;
                lastRight = _right;
                return [_left, _right];
              }
              var left, right;
              try {
                left = getLeft(postparsed, expandTo, pair[0].offset);
              } catch (e) {
                errors.push(e);
              }
              try {
                right = getRight(postparsed, expandTo, pair[1].offset);
              } catch (e) {
                errors.push(e);
              }
              if (left < lastRight && !_this.docxtemplater.options.syntax.allowUnbalancedLoops) {
                errors.push(getUnbalancedLoopException(pair, lastPair));
              }
              lastRight = right;
              lastPair = pair;
              return [left, right];
            });
            if (errors.length > 0) {
              return {
                postparsed,
                errors
              };
            }
            var currentPairIndex = 0;
            var innerParts;
            var newParsed = postparsed.reduce(function(newParsed2, part, i) {
              var inPair = currentPairIndex < pairs.length && expandedPairs[currentPairIndex][0] <= i && i <= expandedPairs[currentPairIndex][1];
              var pair = pairs[currentPairIndex];
              var expandedPair = expandedPairs[currentPairIndex];
              if (!inPair) {
                newParsed2.push(part);
                return newParsed2;
              }
              if (expandedPair[0] === i) {
                innerParts = [];
              }
              if (pair[0].offset !== i && pair[1].offset !== i) {
                innerParts.push(part);
              }
              if (expandedPair[1] === i) {
                var basePart = postparsed[pair[0].offset];
                basePart.subparsed = postparse2(innerParts, {
                  basePart
                });
                basePart.endLindex = pair[1].part.lIndex;
                delete basePart.location;
                delete basePart.expandTo;
                newParsed2.push(basePart);
                currentPairIndex++;
                var _expandedPair = expandedPairs[currentPairIndex];
                while (_expandedPair && _expandedPair[0] < i) {
                  currentPairIndex++;
                  _expandedPair = expandedPairs[currentPairIndex];
                }
              }
              return newParsed2;
            }, []);
            return {
              postparsed: newParsed,
              errors
            };
          }
        }]);
      })();
      module.exports = function() {
        return wrapper(new ExpandPairTrait());
      };
    }
  });

  // node_modules/docxtemplater/js/modules/render.js
  var require_render2 = __commonJS({
    "node_modules/docxtemplater/js/modules/render.js"(exports, module) {
      "use strict";
      function _typeof(o) {
        "@babel/helpers - typeof";
        return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }
      function _classCallCheck(a, n) {
        if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
      }
      function _defineProperties(e, r) {
        for (var t = 0; t < r.length; t++) {
          var o = r[t];
          o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, _toPropertyKey(o.key), o);
        }
      }
      function _createClass(e, r, t) {
        return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: false }), e;
      }
      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");
        return "symbol" == _typeof(i) ? i : i + "";
      }
      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];
        if (void 0 !== e) {
          var i = e.call(t, r || "default");
          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }
        return ("string" === r ? String : Number)(t);
      }
      var wrapper = require_module_wrapper();
      var _require = require_errors2();
      var getScopeCompilationError = _require.getScopeCompilationError;
      var getCorruptCharactersException = _require.getCorruptCharactersException;
      var _require2 = require_doc_utils();
      var utf8ToWord = _require2.utf8ToWord;
      var hasCorruptCharacters = _require2.hasCorruptCharacters;
      var removeCorruptCharacters = _require2.removeCorruptCharacters;
      var _require3 = require_content_types();
      var settingsContentType = _require3.settingsContentType;
      var coreContentType = _require3.coreContentType;
      var appContentType = _require3.appContentType;
      var customContentType = _require3.customContentType;
      var NON_LINE_BREAKS_CONTENT_TYPE = [settingsContentType, coreContentType, appContentType, customContentType];
      var ftprefix = {
        docx: "w",
        pptx: "a"
      };
      var Render = /* @__PURE__ */ (function() {
        function Render2() {
          _classCallCheck(this, Render2);
          this.name = "Render";
          this.recordRun = false;
          this.recordedRun = [];
        }
        return _createClass(Render2, [{
          key: "set",
          value: function set(obj) {
            if (obj.compiled) {
              this.compiled = obj.compiled;
            }
            if (obj.data != null) {
              this.data = obj.data;
            }
          }
        }, {
          key: "optionsTransformer",
          value: function optionsTransformer(options, docxtemplater) {
            this.docxtemplater = docxtemplater;
            this.brTag = docxtemplater.fileType === "docx" ? "<w:r><w:br/></w:r>" : "<a:br/>";
            this.prefix = ftprefix[docxtemplater.fileType];
            this.runStartTag = "".concat(this.prefix, ":r");
            this.runPropsStartTag = "".concat(this.prefix, ":rPr");
            return options;
          }
        }, {
          key: "postparse",
          value: function postparse(postparsed, options) {
            var errors = [];
            for (var _i2 = 0; _i2 < postparsed.length; _i2++) {
              var p = postparsed[_i2];
              if (p.type === "placeholder") {
                var tag = p.value;
                try {
                  options.cachedParsers[p.lIndex] = this.docxtemplater.parser(tag, {
                    tag: p
                  });
                } catch (rootError) {
                  errors.push(getScopeCompilationError({
                    tag,
                    rootError,
                    offset: p.offset
                  }));
                }
              }
            }
            return {
              postparsed,
              errors
            };
          }
        }, {
          key: "getRenderedMap",
          value: function getRenderedMap(mapper) {
            for (var from in this.compiled) {
              mapper[from] = {
                from,
                data: this.data
              };
            }
            return mapper;
          }
        }, {
          key: "render",
          value: function render(part, _ref) {
            var contentType = _ref.contentType, scopeManager = _ref.scopeManager, linebreaks = _ref.linebreaks, nullGetter = _ref.nullGetter, fileType = _ref.fileType, stripInvalidXMLChars = _ref.stripInvalidXMLChars;
            if (NON_LINE_BREAKS_CONTENT_TYPE.indexOf(contentType) !== -1) {
              linebreaks = false;
            }
            if (linebreaks) {
              this.recordRuns(part);
            }
            if (part.type !== "placeholder" || part.module) {
              return;
            }
            var value;
            try {
              value = scopeManager.getValue(part.value, {
                part
              });
            } catch (e) {
              return {
                errors: [e]
              };
            }
            value !== null && value !== void 0 ? value : value = nullGetter(part);
            if (typeof value === "string") {
              if (stripInvalidXMLChars) {
                value = removeCorruptCharacters(value);
              } else if (["docx", "pptx", "xlsx"].indexOf(fileType) !== -1 && hasCorruptCharacters(value)) {
                return {
                  errors: [getCorruptCharactersException({
                    tag: part.value,
                    value,
                    offset: part.offset
                  })]
                };
              }
            }
            if (fileType === "text") {
              return {
                value
              };
            }
            return {
              value: linebreaks && typeof value === "string" ? this.renderLineBreaks(value) : utf8ToWord(value)
            };
          }
        }, {
          key: "recordRuns",
          value: function recordRuns(part) {
            if (part.tag === this.runStartTag) {
              this.recordedRun = "";
            } else if (part.tag === this.runPropsStartTag) {
              if (part.position === "start") {
                this.recordRun = true;
                this.recordedRun += part.value;
              }
              if (part.position === "end" || part.position === "selfclosing") {
                this.recordedRun += part.value;
                this.recordRun = false;
              }
            } else if (this.recordRun) {
              this.recordedRun += part.value;
            }
          }
        }, {
          key: "renderLineBreaks",
          value: function renderLineBreaks(value) {
            var result = [];
            var lines = value.split("\n");
            for (var i = 0, len = lines.length; i < len; i++) {
              result.push(utf8ToWord(lines[i]));
              if (i < lines.length - 1) {
                result.push("</".concat(this.prefix, ":t></").concat(this.prefix, ":r>").concat(this.brTag, "<").concat(this.prefix, ":r>").concat(this.recordedRun, "<").concat(this.prefix, ":t").concat(this.docxtemplater.fileType === "docx" ? ' xml:space="preserve"' : "", ">"));
              }
            }
            return result;
          }
        }]);
      })();
      module.exports = function() {
        return wrapper(new Render());
      };
    }
  });

  // node_modules/docxtemplater/js/file-type-config.js
  var require_file_type_config = __commonJS({
    "node_modules/docxtemplater/js/file-type-config.js"(exports, module) {
      "use strict";
      var loopModule = require_loop();
      var spacePreserveModule = require_space_preserve();
      var rawXmlModule = require_rawxml();
      var expandPairTrait = require_expand_pair_trait();
      var render = require_render2();
      function DocXFileTypeConfig() {
        return {
          getTemplatedFiles: function getTemplatedFiles() {
            return [];
          },
          templatedNs: ["http://schemas.microsoft.com/office/2006/coverPageProps"],
          textPath: function textPath(doc) {
            return doc.textTarget;
          },
          tagsXmlTextArray: ["Company", "HyperlinkBase", "Manager", "cp:category", "cp:keywords", "dc:creator", "dc:description", "dc:subject", "dc:title", "cp:contentStatus", "PublishDate", "Abstract", "CompanyAddress", "CompanyPhone", "CompanyFax", "CompanyEmail", "w:t", "a:t", "m:t", "vt:lpstr", "vt:lpwstr"],
          tagsXmlLexedArray: ["w:proofState", "w:tc", "w:tr", "w:tbl", "w:ftr", "w:hdr", "w:body", "w:document", "w:p", "w:r", "w:br", "w:rPr", "w:pPr", "w:spacing", "w:sdtContent", "w:sdt", "w:drawing", "w:sectPr", "w:type", "w:headerReference", "w:footerReference", "w:bookmarkStart", "w:bookmarkEnd", "w:commentRangeStart", "w:commentRangeEnd", "w:commentReference"],
          droppedTagsInsidePlaceholder: ["w:p", "w:br", "w:bookmarkStart", "w:bookmarkEnd"],
          expandTags: [{
            contains: "w:tc",
            expand: "w:tr"
          }],
          onParagraphLoop: [{
            contains: "w:p",
            expand: "w:p",
            onlyTextInTag: true
          }],
          tagRawXml: "w:p",
          baseModules: [loopModule, spacePreserveModule, expandPairTrait, rawXmlModule, render],
          tagShouldContain: [{
            tag: "w:sdtContent",
            shouldContain: ["w:p", "w:r", "w:commentRangeStart", "w:sdt"],
            value: "<w:p></w:p>"
          }, {
            tag: "w:tc",
            shouldContain: ["w:p"],
            value: "<w:p></w:p>"
          }, {
            tag: "w:tr",
            shouldContain: ["w:tc"],
            drop: true
          }, {
            tag: "w:tbl",
            shouldContain: ["w:tr"],
            drop: true
          }]
        };
      }
      function PptXFileTypeConfig() {
        return {
          getTemplatedFiles: function getTemplatedFiles() {
            return [];
          },
          textPath: function textPath(doc) {
            return doc.textTarget;
          },
          tagsXmlTextArray: ["Company", "HyperlinkBase", "Manager", "cp:category", "cp:keywords", "dc:creator", "dc:description", "dc:subject", "dc:title", "a:t", "m:t", "vt:lpstr", "vt:lpwstr"],
          tagsXmlLexedArray: ["p:sp", "a:tc", "a:tr", "a:tbl", "a:graphicData", "a:p", "a:r", "a:rPr", "p:txBody", "a:txBody", "a:off", "a:ext", "p:graphicFrame", "p:xfrm", "a16:rowId", "a:endParaRPr"],
          droppedTagsInsidePlaceholder: ["a:p", "a:endParaRPr"],
          expandTags: [{
            contains: "a:tc",
            expand: "a:tr"
          }],
          onParagraphLoop: [{
            contains: "a:p",
            expand: "a:p",
            onlyTextInTag: true
          }],
          tagRawXml: "p:sp",
          baseModules: [loopModule, expandPairTrait, rawXmlModule, render],
          tagShouldContain: [{
            tag: "a:tbl",
            shouldContain: ["a:tr"],
            dropParent: "p:graphicFrame"
          }, {
            tag: "p:txBody",
            shouldContain: ["a:p"],
            value: "<a:p></a:p>"
          }, {
            tag: "a:txBody",
            shouldContain: ["a:p"],
            value: "<a:p></a:p>"
          }]
        };
      }
      module.exports = {
        docx: DocXFileTypeConfig,
        pptx: PptXFileTypeConfig
      };
    }
  });

  // node_modules/docxtemplater/js/docxtemplater.js
  var require_docxtemplater = __commonJS({
    "node_modules/docxtemplater/js/docxtemplater.js"(exports, module) {
      "use strict";
      var _excluded = ["modules"];
      function ownKeys(e, r) {
        var t = Object.keys(e);
        if (Object.getOwnPropertySymbols) {
          var o = Object.getOwnPropertySymbols(e);
          r && (o = o.filter(function(r2) {
            return Object.getOwnPropertyDescriptor(e, r2).enumerable;
          })), t.push.apply(t, o);
        }
        return t;
      }
      function _objectSpread(e) {
        for (var r = 1; r < arguments.length; r++) {
          var t = null != arguments[r] ? arguments[r] : {};
          r % 2 ? ownKeys(Object(t), true).forEach(function(r2) {
            _defineProperty(e, r2, t[r2]);
          }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r2) {
            Object.defineProperty(e, r2, Object.getOwnPropertyDescriptor(t, r2));
          });
        }
        return e;
      }
      function _defineProperty(e, r, t) {
        return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: true, configurable: true, writable: true }) : e[r] = t, e;
      }
      function _slicedToArray(r, e) {
        return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest();
      }
      function _nonIterableRest() {
        throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
      }
      function _unsupportedIterableToArray(r, a) {
        if (r) {
          if ("string" == typeof r) return _arrayLikeToArray(r, a);
          var t = {}.toString.call(r).slice(8, -1);
          return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
        }
      }
      function _arrayLikeToArray(r, a) {
        (null == a || a > r.length) && (a = r.length);
        for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
        return n;
      }
      function _iterableToArrayLimit(r, l) {
        var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
        if (null != t) {
          var e, n, i, u, a = [], f = true, o = false;
          try {
            if (i = (t = t.call(r)).next, 0 === l) {
              if (Object(t) !== t) return;
              f = false;
            } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = true) ;
          } catch (r2) {
            o = true, n = r2;
          } finally {
            try {
              if (!f && null != t["return"] && (u = t["return"](), Object(u) !== u)) return;
            } finally {
              if (o) throw n;
            }
          }
          return a;
        }
      }
      function _arrayWithHoles(r) {
        if (Array.isArray(r)) return r;
      }
      function _typeof(o) {
        "@babel/helpers - typeof";
        return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }
      function _objectWithoutProperties(e, t) {
        if (null == e) return {};
        var o, r, i = _objectWithoutPropertiesLoose(e, t);
        if (Object.getOwnPropertySymbols) {
          var n = Object.getOwnPropertySymbols(e);
          for (r = 0; r < n.length; r++) o = n[r], -1 === t.indexOf(o) && {}.propertyIsEnumerable.call(e, o) && (i[o] = e[o]);
        }
        return i;
      }
      function _objectWithoutPropertiesLoose(r, e) {
        if (null == r) return {};
        var t = {};
        for (var n in r) if ({}.hasOwnProperty.call(r, n)) {
          if (-1 !== e.indexOf(n)) continue;
          t[n] = r[n];
        }
        return t;
      }
      function _classCallCheck(a, n) {
        if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
      }
      function _defineProperties(e, r) {
        for (var t = 0; t < r.length; t++) {
          var o = r[t];
          o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, _toPropertyKey(o.key), o);
        }
      }
      function _createClass(e, r, t) {
        return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: false }), e;
      }
      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");
        return "symbol" == _typeof(i) ? i : i + "";
      }
      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];
        if (void 0 !== e) {
          var i = e.call(t, r || "default");
          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }
        return ("string" === r ? String : Number)(t);
      }
      var DocUtils = require_doc_utils();
      var z = require_minizod();
      var dxtSyntaxSchema = z.object({
        allowUnopenedTag: z["boolean"]().optional(),
        allowUnclosedTag: z["boolean"]().optional(),
        allowUnbalancedLoops: z["boolean"]().optional(),
        changeDelimiterPrefix: z.string().optional().nullable()
      });
      var dxtOptionsSchema = z.object({
        delimiters: z.object({
          start: z.string().nullable(),
          end: z.string().nullable()
        }).strict().optional(),
        fileTypeConfig: z.object({}).optional(),
        paragraphLoop: z["boolean"]().optional(),
        parser: z["function"]().optional(),
        errorLogging: z.union([z["boolean"](), z.string()]).optional(),
        linebreaks: z["boolean"]().optional(),
        nullGetter: z["function"]().optional(),
        syntax: dxtSyntaxSchema.optional(),
        stripInvalidXMLChars: z["boolean"]().optional(),
        warnFn: z["function"]().optional()
      }).strict();
      var _require = require_get_relation_types();
      var getRelsTypes = _require.getRelsTypes;
      var _require2 = require_get_content_types();
      var collectContentTypes = _require2.collectContentTypes;
      var getContentTypes = _require2.getContentTypes;
      var moduleWrapper = require_module_wrapper();
      var traits = require_traits();
      var commonModule = require_common();
      var createScope = require_scope_manager();
      var Lexer = require_lexer();
      var _require3 = require_get_tags();
      var _getTags = _require3.getTags;
      var logErrors = require_error_logger();
      var _require4 = require_errors2();
      var throwMultiError = _require4.throwMultiError;
      var throwResolveBeforeCompile = _require4.throwResolveBeforeCompile;
      var throwRenderInvalidTemplate = _require4.throwRenderInvalidTemplate;
      var throwRenderTwice = _require4.throwRenderTwice;
      var XTInternalError = _require4.XTInternalError;
      var XTTemplateError = _require4.XTTemplateError;
      var throwFileTypeNotIdentified = _require4.throwFileTypeNotIdentified;
      var throwFileTypeNotHandled = _require4.throwFileTypeNotHandled;
      var throwApiVersionError = _require4.throwApiVersionError;
      DocUtils.getRelsTypes = getRelsTypes;
      DocUtils.traits = traits;
      DocUtils.moduleWrapper = moduleWrapper;
      DocUtils.collectContentTypes = collectContentTypes;
      DocUtils.getContentTypes = getContentTypes;
      var getDefaults = DocUtils.getDefaults;
      var str2xml = DocUtils.str2xml;
      var xml2str = DocUtils.xml2str;
      var concatArrays = DocUtils.concatArrays;
      var uniq = DocUtils.uniq;
      var getDuplicates = DocUtils.getDuplicates;
      var stableSort = DocUtils.stableSort;
      var pushArray = DocUtils.pushArray;
      var utf8ToWord = DocUtils.utf8ToWord;
      var invertMap = DocUtils.invertMap;
      var ctXML = "[Content_Types].xml";
      var relsFile = "_rels/.rels";
      var currentModuleApiVersion = [3, 47, 2];
      function throwIfDuplicateModules(modules) {
        var names = [];
        for (var _i2 = 0; _i2 < modules.length; _i2++) {
          var mod = modules[_i2];
          names.push(mod.name);
        }
        var duplicates = getDuplicates(names);
        if (duplicates.length > 0) {
          throw new XTInternalError('Detected duplicate module "'.concat(duplicates[0], '"'));
        }
      }
      function addXmlFileNamesFromXmlContentType(doc) {
        for (var _i4 = 0, _doc$modules2 = doc.modules; _i4 < _doc$modules2.length; _i4++) {
          var _module = _doc$modules2[_i4];
          for (var _i6 = 0, _ref2 = _module.xmlContentTypes || []; _i6 < _ref2.length; _i6++) {
            var contentType = _ref2[_i6];
            var candidates = doc.invertedContentTypes[contentType] || [];
            for (var _i8 = 0; _i8 < candidates.length; _i8++) {
              var candidate = candidates[_i8];
              if (doc.zip.files[candidate]) {
                doc.options.xmlFileNames.push(candidate);
              }
            }
          }
        }
      }
      function reorderModules(modules) {
        return stableSort(modules, function(m1, m2) {
          return (m2.priority || 0) - (m1.priority || 0);
        });
      }
      function zipFileOrder(files) {
        var allFiles = [];
        for (var name in files) {
          allFiles.push(name);
        }
        var resultFiles = [ctXML, relsFile];
        var prefixes = ["word/", "xl/", "ppt/"];
        for (var _i0 = 0; _i0 < allFiles.length; _i0++) {
          var _name = allFiles[_i0];
          for (var _i10 = 0; _i10 < prefixes.length; _i10++) {
            var prefix = prefixes[_i10];
            if (_name.indexOf("".concat(prefix)) === 0) {
              resultFiles.push(_name);
            }
          }
        }
        for (var _i12 = 0; _i12 < allFiles.length; _i12++) {
          var _name2 = allFiles[_i12];
          if (resultFiles.indexOf(_name2) === -1) {
            resultFiles.push(_name2);
          }
        }
        return resultFiles;
      }
      function deprecatedMessage(obj, message) {
        if (obj.hideDeprecations === true) {
          return;
        }
        console.warn(message);
      }
      function deprecatedMethod(obj, method) {
        if (obj.hideDeprecations === true) {
          return;
        }
        return deprecatedMessage(obj, 'Deprecated method ".'.concat(method, '", view upgrade guide : https://docxtemplater.com/docs/api/#upgrade-guide, stack : ').concat(new Error().stack));
      }
      function dropUnsupportedFileTypesModules(doc) {
        doc.modules = doc.modules.filter(function(module2) {
          if (!module2.supportedFileTypes) {
            return true;
          }
          if (!Array.isArray(module2.supportedFileTypes)) {
            throw new Error("The supportedFileTypes field of the module must be an array");
          }
          var isSupportedModule = module2.supportedFileTypes.includes(doc.fileType);
          if (!isSupportedModule) {
            module2.on("detached");
          }
          return isSupportedModule;
        });
      }
      function verifyErrors(doc) {
        var compiled = doc.compiled;
        doc.errors = concatArrays(Object.keys(compiled).map(function(name) {
          return compiled[name].allErrors;
        }));
        if (doc.errors.length !== 0) {
          if (doc.options.errorLogging) {
            logErrors(doc.errors, doc.options.errorLogging);
          }
          throwMultiError(doc.errors);
        }
      }
      function isBuffer(v) {
        return typeof Buffer !== "undefined" && typeof Buffer.isBuffer === "function" && Buffer.isBuffer(v);
      }
      var Docxtemplater = /* @__PURE__ */ (function() {
        function Docxtemplater2(zip) {
          var _ref3 = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {}, _ref3$modules = _ref3.modules, modules = _ref3$modules === void 0 ? [] : _ref3$modules, options = _objectWithoutProperties(_ref3, _excluded);
          _classCallCheck(this, Docxtemplater2);
          this.targets = [];
          this.rendered = false;
          this.scopeManagers = {};
          this.compiled = {};
          this.modules = [commonModule()];
          this.xmlDocuments = {};
          if (arguments.length === 0) {
            deprecatedMessage(this, "Deprecated docxtemplater constructor with no arguments, view upgrade guide : https://docxtemplater.com/docs/api/#upgrade-guide, stack : ".concat(new Error().stack));
            this.hideDeprecations = true;
            this.setOptions(options);
          } else {
            this.hideDeprecations = true;
            this.setOptions(options);
            if (isBuffer(zip)) {
              throw new Error("You passed a Buffer to the Docxtemplater constructor. The first argument of docxtemplater's constructor must be a valid zip file (jszip v2 or pizzip v3)");
            }
            if (!zip || !zip.files || typeof zip.file !== "function") {
              throw new Error("The first argument of docxtemplater's constructor must be a valid zip file (jszip v2 or pizzip v3)");
            }
            if (!Array.isArray(modules)) {
              throw new Error("The modules argument of docxtemplater's constructor must be an array");
            }
            for (var _i14 = 0; _i14 < modules.length; _i14++) {
              var _module2 = modules[_i14];
              this.attachModule(_module2);
            }
            this.loadZip(zip);
            this.compile();
            this.v4Constructor = true;
          }
          this.hideDeprecations = false;
        }
        return _createClass(Docxtemplater2, [{
          key: "verifyApiVersion",
          value: function verifyApiVersion(neededVersion) {
            neededVersion = neededVersion.split(".");
            for (var i = 0; i < neededVersion.length; i++) {
              neededVersion[i] = parseInt(neededVersion[i], 10);
            }
            if (neededVersion.length !== 3) {
              throwApiVersionError("neededVersion is not a valid version", {
                neededVersion,
                explanation: "the neededVersion must be an array of length 3"
              });
            }
            if (neededVersion[0] !== currentModuleApiVersion[0]) {
              throwApiVersionError("The major api version do not match, you probably have to update docxtemplater with npm install --save docxtemplater", {
                neededVersion,
                currentModuleApiVersion,
                explanation: "moduleAPIVersionMismatch : needed=".concat(neededVersion.join("."), ", current=").concat(currentModuleApiVersion.join("."))
              });
            }
            if (neededVersion[1] > currentModuleApiVersion[1]) {
              throwApiVersionError("The minor api version is not uptodate, you probably have to update docxtemplater with npm install --save docxtemplater", {
                neededVersion,
                currentModuleApiVersion,
                explanation: "moduleAPIVersionMismatch : needed=".concat(neededVersion.join("."), ", current=").concat(currentModuleApiVersion.join("."))
              });
            }
            if (neededVersion[1] === currentModuleApiVersion[1] && neededVersion[2] > currentModuleApiVersion[2]) {
              throwApiVersionError("The patch api version is not uptodate, you probably have to update docxtemplater with npm install --save docxtemplater", {
                neededVersion,
                currentModuleApiVersion,
                explanation: "moduleAPIVersionMismatch : needed=".concat(neededVersion.join("."), ", current=").concat(currentModuleApiVersion.join("."))
              });
            }
            return true;
          }
        }, {
          key: "setModules",
          value: function setModules(obj) {
            for (var _i16 = 0, _this$modules2 = this.modules; _i16 < _this$modules2.length; _i16++) {
              var _module3 = _this$modules2[_i16];
              _module3.set(obj);
            }
          }
        }, {
          key: "sendEvent",
          value: function sendEvent(eventName) {
            for (var _i18 = 0, _this$modules4 = this.modules; _i18 < _this$modules4.length; _i18++) {
              var _module4 = _this$modules4[_i18];
              _module4.on(eventName);
            }
          }
        }, {
          key: "attachModule",
          value: function attachModule(module2) {
            if (this.v4Constructor) {
              throw new XTInternalError("attachModule() should not be called manually when using the v4 constructor");
            }
            deprecatedMethod(this, "attachModule");
            var moduleType = _typeof(module2);
            if (moduleType === "function") {
              throw new XTInternalError("Cannot attach a class/function as a module. Most probably you forgot to instantiate the module by using `new` on the module.");
            }
            if (!module2 || moduleType !== "object") {
              throw new XTInternalError("Cannot attachModule with a falsy value");
            }
            if (module2.requiredAPIVersion) {
              this.verifyApiVersion(module2.requiredAPIVersion);
            }
            if (module2.attached === true) {
              if (typeof module2.clone === "function") {
                module2 = module2.clone();
              } else {
                throw new Error('Cannot attach a module that was already attached : "'.concat(module2.name, '". The most likely cause is that you are instantiating the module at the root level, and using it for multiple instances of Docxtemplater'));
              }
            }
            module2.attached = true;
            var wrappedModule = moduleWrapper(module2);
            this.modules.push(wrappedModule);
            wrappedModule.on("attached");
            if (this.fileType) {
              dropUnsupportedFileTypesModules(this);
            }
            return this;
          }
        }, {
          key: "findModule",
          value: function findModule(name) {
            for (var _i20 = 0, _this$modules6 = this.modules; _i20 < _this$modules6.length; _i20++) {
              var _module5 = _this$modules6[_i20];
              if (_module5.name === name) {
                return _module5;
              }
            }
          }
        }, {
          key: "setOptions",
          value: function setOptions(options) {
            var _this$delimiters, _this$delimiters2;
            if (this.v4Constructor) {
              throw new Error("setOptions() should not be called manually when using the v4 constructor");
            }
            if (!options) {
              throw new Error("setOptions should be called with an object as first parameter");
            }
            var result = dxtOptionsSchema.validate(options);
            if (result.success === false) {
              throw new Error(result.error);
            }
            deprecatedMethod(this, "setOptions");
            this.options = {};
            var defaults = getDefaults();
            for (var key in defaults) {
              var defaultValue = defaults[key];
              this.options[key] = options[key] != null ? options[key] : this[key] || defaultValue;
              this[key] = this.options[key];
            }
            (_this$delimiters = this.delimiters).start && (_this$delimiters.start = utf8ToWord(this.delimiters.start));
            (_this$delimiters2 = this.delimiters).end && (_this$delimiters2.end = utf8ToWord(this.delimiters.end));
            return this;
          }
        }, {
          key: "loadZip",
          value: function loadZip(zip) {
            if (this.v4Constructor) {
              throw new Error("loadZip() should not be called manually when using the v4 constructor");
            }
            deprecatedMethod(this, "loadZip");
            if (zip.loadAsync) {
              throw new XTInternalError("Docxtemplater doesn't handle JSZip version >=3, please use pizzip");
            }
            if (zip.xtRendered) {
              this.options.warnFn([new Error("This zip file appears to be the outcome of a previous docxtemplater generation. This typically indicates that docxtemplater was integrated by reusing the same zip file. It is recommended to create a new Pizzip instance for each docxtemplater generation.")]);
            }
            this.zip = zip;
            this.updateFileTypeConfig();
            this.modules = concatArrays([this.fileTypeConfig.baseModules.map(function(moduleFunction) {
              return moduleFunction();
            }), this.modules]);
            for (var _i22 = 0, _this$modules8 = this.modules; _i22 < _this$modules8.length; _i22++) {
              var _module6 = _this$modules8[_i22];
              _module6.zip = this.zip;
              _module6.docxtemplater = this;
              _module6.fileTypeConfig = this.fileTypeConfig;
              _module6.fileType = this.fileType;
              _module6.xtOptions = this.options;
              _module6.modules = this.modules;
            }
            dropUnsupportedFileTypesModules(this);
            return this;
          }
        }, {
          key: "precompileFile",
          value: function precompileFile(fileName) {
            var currentFile = this.createTemplateClass(fileName);
            currentFile.preparse();
            this.compiled[fileName] = currentFile;
          }
        }, {
          key: "compileFile",
          value: function compileFile(fileName) {
            this.compiled[fileName].parse();
          }
        }, {
          key: "getScopeManager",
          value: function getScopeManager(to, currentFile, tags) {
            var _this$scopeManagers;
            (_this$scopeManagers = this.scopeManagers)[to] || (_this$scopeManagers[to] = createScope({
              tags,
              parser: this.parser,
              cachedParsers: currentFile.cachedParsers
            }));
            return this.scopeManagers[to];
          }
        }, {
          key: "resolveData",
          value: function resolveData(data) {
            var _this = this;
            deprecatedMethod(this, "resolveData");
            var errors = [];
            if (!Object.keys(this.compiled).length) {
              throwResolveBeforeCompile();
            }
            return Promise.resolve(data).then(function(data2) {
              _this.data = data2;
              _this.setModules({
                data: _this.data,
                Lexer
              });
              _this.mapper = _this.modules.reduce(function(value, module2) {
                return module2.getRenderedMap(value);
              }, {});
              var promises = [];
              var _loop = function _loop2() {
                var to = _Object$keys2[_i24];
                var _this$mapper$to = _this.mapper[to], from = _this$mapper$to.from, data3 = _this$mapper$to.data;
                promises.push(Promise.resolve(data3).then(function(data4) {
                  var currentFile = _this.compiled[from];
                  currentFile.filePath = to;
                  currentFile.scopeManager = _this.getScopeManager(to, currentFile, data4);
                  return currentFile.resolveTags(data4).then(function(result) {
                    currentFile.scopeManager.finishedResolving = true;
                    return result;
                  }, function(errs) {
                    pushArray(errors, errs);
                  });
                }));
              };
              for (var _i24 = 0, _Object$keys2 = Object.keys(_this.mapper); _i24 < _Object$keys2.length; _i24++) {
                _loop();
              }
              return Promise.all(promises).then(function(resolved) {
                if (errors.length !== 0) {
                  if (_this.options.errorLogging) {
                    logErrors(errors, _this.options.errorLogging);
                  }
                  throwMultiError(errors);
                }
                return concatArrays(resolved);
              });
            });
          }
        }, {
          key: "compile",
          value: function compile() {
            deprecatedMethod(this, "compile");
            this.updateFileTypeConfig();
            throwIfDuplicateModules(this.modules);
            this.modules = reorderModules(this.modules);
            if (Object.keys(this.compiled).length) {
              return this;
            }
            var options = this.options;
            for (var _i26 = 0, _this$modules0 = this.modules; _i26 < _this$modules0.length; _i26++) {
              var _module7 = _this$modules0[_i26];
              options = _module7.optionsTransformer(options, this);
            }
            this.options = options;
            this.options.xmlFileNames = uniq(this.options.xmlFileNames);
            for (var _i28 = 0, _this$options$xmlFile2 = this.options.xmlFileNames; _i28 < _this$options$xmlFile2.length; _i28++) {
              var fileName = _this$options$xmlFile2[_i28];
              var content = this.zip.files[fileName].asText();
              this.xmlDocuments[fileName] = str2xml(content);
            }
            this.setModules({
              zip: this.zip,
              xmlDocuments: this.xmlDocuments
            });
            for (var _i30 = 0, _this$modules10 = this.modules; _i30 < _this$modules10.length; _i30++) {
              var _module8 = _this$modules10[_i30];
              _module8.xmlDocuments = this.xmlDocuments;
            }
            this.getTemplatedFiles();
            this.sendEvent("before-preparse");
            for (var _i32 = 0, _this$templatedFiles2 = this.templatedFiles; _i32 < _this$templatedFiles2.length; _i32++) {
              var _fileName = _this$templatedFiles2[_i32];
              if (this.zip.files[_fileName] != null) {
                this.precompileFile(_fileName);
              }
            }
            this.sendEvent("after-preparse");
            for (var _i34 = 0, _this$templatedFiles4 = this.templatedFiles; _i34 < _this$templatedFiles4.length; _i34++) {
              var _fileName2 = _this$templatedFiles4[_i34];
              if (this.zip.files[_fileName2] != null) {
                this.compiled[_fileName2].parse({
                  noPostParse: true
                });
              }
            }
            this.sendEvent("after-parse");
            for (var _i36 = 0, _this$templatedFiles6 = this.templatedFiles; _i36 < _this$templatedFiles6.length; _i36++) {
              var _fileName3 = _this$templatedFiles6[_i36];
              if (this.zip.files[_fileName3] != null) {
                this.compiled[_fileName3].postparse();
              }
            }
            this.sendEvent("after-postparse");
            this.setModules({
              compiled: this.compiled
            });
            verifyErrors(this);
            return this;
          }
        }, {
          key: "updateFileTypeConfig",
          value: function updateFileTypeConfig() {
            this.relsTypes = getRelsTypes(this.zip);
            var _getContentTypes = getContentTypes(this.zip), overrides = _getContentTypes.overrides, defaults = _getContentTypes.defaults, contentTypes = _getContentTypes.contentTypes, contentTypeXml = _getContentTypes.contentTypeXml;
            if (contentTypeXml) {
              this.filesContentTypes = collectContentTypes(overrides, defaults, this.zip);
              this.invertedContentTypes = invertMap(this.filesContentTypes);
              this.setModules({
                contentTypes: this.contentTypes,
                invertedContentTypes: this.invertedContentTypes
              });
            }
            var fileType;
            if (this.zip.files.mimetype) {
              fileType = "odt";
            }
            for (var _i38 = 0, _this$modules12 = this.modules; _i38 < _this$modules12.length; _i38++) {
              var _module9 = _this$modules12[_i38];
              fileType = _module9.getFileType({
                zip: this.zip,
                contentTypes,
                contentTypeXml,
                overrides,
                defaults,
                doc: this
              }) || fileType;
            }
            this.fileType = fileType;
            if (fileType === "odt") {
              throwFileTypeNotHandled(fileType);
            }
            if (!fileType) {
              throwFileTypeNotIdentified(this.zip);
            }
            addXmlFileNamesFromXmlContentType(this);
            dropUnsupportedFileTypesModules(this);
            this.fileTypeConfig = this.options.fileTypeConfig || this.fileTypeConfig;
            if (!this.fileTypeConfig) {
              if (Docxtemplater2.FileTypeConfig[this.fileType]) {
                this.fileTypeConfig = Docxtemplater2.FileTypeConfig[this.fileType]();
              } else {
                var message = 'Filetype "'.concat(this.fileType, '" is not supported');
                var id = "filetype_not_supported";
                if (this.fileType === "xlsx") {
                  message = 'Filetype "'.concat(this.fileType, '" is supported only with the paid XlsxModule');
                  id = "xlsx_filetype_needs_xlsx_module";
                }
                var err = new XTTemplateError(message);
                err.properties = {
                  id,
                  explanation: message
                };
                throw err;
              }
            }
            return this;
          }
        }, {
          key: "renderAsync",
          value: function renderAsync(data) {
            var _this2 = this;
            this.hideDeprecations = true;
            var promise = this.resolveData(data);
            this.hideDeprecations = false;
            this.zip.xtRendered = true;
            return promise.then(function() {
              return _this2.render();
            });
          }
        }, {
          key: "render",
          value: function render(data) {
            this.zip.xtRendered = true;
            if (this.rendered) {
              throwRenderTwice();
            }
            this.rendered = true;
            if (Object.keys(this.compiled).length === 0) {
              this.compile();
            }
            if (this.errors.length > 0) {
              throwRenderInvalidTemplate();
            }
            if (arguments.length > 0) {
              this.data = data;
            }
            this.setModules({
              data: this.data,
              Lexer
            });
            this.mapper || (this.mapper = this.modules.reduce(function(value, module2) {
              return module2.getRenderedMap(value);
            }, {}));
            var output = [];
            for (var to in this.mapper) {
              var _this$mapper$to2 = this.mapper[to], from = _this$mapper$to2.from, _data = _this$mapper$to2.data;
              var currentFile = this.compiled[from];
              currentFile.scopeManager = this.getScopeManager(to, currentFile, _data);
              currentFile.render(to);
              output.push([to, currentFile.content, currentFile]);
              delete currentFile.content;
            }
            for (var _i40 = 0; _i40 < output.length; _i40++) {
              var outputPart = output[_i40];
              var _outputPart = _slicedToArray(outputPart, 3), content = _outputPart[1], _currentFile = _outputPart[2];
              for (var _i42 = 0, _this$modules14 = this.modules; _i42 < _this$modules14.length; _i42++) {
                var _module0 = _this$modules14[_i42];
                if (_module0.preZip) {
                  var result = _module0.preZip(content, _currentFile);
                  if (typeof result === "string") {
                    outputPart[1] = result;
                  }
                }
              }
            }
            for (var _i44 = 0; _i44 < output.length; _i44++) {
              var _output$_i = _slicedToArray(output[_i44], 2), _to = _output$_i[0], _content = _output$_i[1];
              this.zip.file(_to, _content, {
                createFolders: true
              });
            }
            verifyErrors(this);
            this.sendEvent("syncing-zip");
            this.syncZip();
            this.sendEvent("synced-zip");
            return this;
          }
        }, {
          key: "syncZip",
          value: function syncZip() {
            for (var fileName in this.xmlDocuments) {
              this.zip.remove(fileName);
              var content = xml2str(this.xmlDocuments[fileName]);
              this.zip.file(fileName, content, {
                createFolders: true
              });
            }
          }
        }, {
          key: "setData",
          value: function setData(data) {
            deprecatedMethod(this, "setData");
            this.data = data;
            return this;
          }
        }, {
          key: "getZip",
          value: function getZip() {
            return this.zip;
          }
        }, {
          key: "createTemplateClass",
          value: function createTemplateClass(path) {
            var content = this.zip.files[path].asText();
            return this.createTemplateClassFromContent(content, path);
          }
        }, {
          key: "createTemplateClassFromContent",
          value: function createTemplateClassFromContent(content, filePath) {
            var xmltOptions = {
              filePath,
              contentType: this.filesContentTypes[filePath],
              relsType: this.relsTypes[filePath]
            };
            var defaults = getDefaults();
            var defaultKeys = pushArray(Object.keys(defaults), ["filesContentTypes", "fileTypeConfig", "fileType", "modules"]);
            for (var _i46 = 0; _i46 < defaultKeys.length; _i46++) {
              var key = defaultKeys[_i46];
              xmltOptions[key] = this[key];
            }
            return new Docxtemplater2.XmlTemplater(content, xmltOptions);
          }
        }, {
          key: "getFullText",
          value: function getFullText(path) {
            return this.createTemplateClass(path || this.fileTypeConfig.textPath(this)).getFullText();
          }
        }, {
          key: "getTemplatedFiles",
          value: function getTemplatedFiles() {
            this.templatedFiles = this.fileTypeConfig.getTemplatedFiles(this.zip);
            pushArray(this.templatedFiles, this.targets);
            var templatedNs = this.fileTypeConfig.templatedNs || [];
            if (templatedNs.length > 0) {
              for (var key in this.filesContentTypes) {
                if (/^customXml\/item\d+\.xml$/.test(key)) {
                  for (var _i48 = 0; _i48 < templatedNs.length; _i48++) {
                    var ns = templatedNs[_i48];
                    var text = this.zip.file(key).asText();
                    if (text.indexOf('xmlns="'.concat(ns, '"')) !== -1) {
                      this.templatedFiles.push(key);
                    }
                  }
                }
              }
            }
            this.templatedFiles = uniq(this.templatedFiles);
            return this.templatedFiles;
          }
        }, {
          key: "getTags",
          value: function getTags() {
            var result = {
              headers: [],
              footers: []
            };
            for (var key in this.compiled) {
              var contentType = this.filesContentTypes[key];
              if (contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml") {
                result.document = {
                  target: key,
                  tags: _getTags(this.compiled[key].postparsed)
                };
              }
              if (contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml") {
                result.headers.push({
                  target: key,
                  tags: _getTags(this.compiled[key].postparsed)
                });
              }
              if (contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml") {
                result.footers.push({
                  target: key,
                  tags: _getTags(this.compiled[key].postparsed)
                });
              }
            }
            return result;
          }
          /* Export functions, present since 3.62.0 */
        }, {
          key: "toBuffer",
          value: function toBuffer(options) {
            return this.zip.generate(_objectSpread(_objectSpread({
              compression: "DEFLATE",
              fileOrder: zipFileOrder
            }, options), {}, {
              type: "nodebuffer"
            }));
          }
          /* Export functions, present since 3.62.0 */
        }, {
          key: "toBlob",
          value: function toBlob(options) {
            return this.zip.generate(_objectSpread(_objectSpread({
              compression: "DEFLATE",
              fileOrder: zipFileOrder
            }, options), {}, {
              type: "blob"
            }));
          }
          /* Export functions, present since 3.62.0 */
        }, {
          key: "toBase64",
          value: function toBase64(options) {
            return this.zip.generate(_objectSpread(_objectSpread({
              compression: "DEFLATE",
              fileOrder: zipFileOrder
            }, options), {}, {
              type: "base64"
            }));
          }
          /* Export functions, present since 3.62.0 */
        }, {
          key: "toUint8Array",
          value: function toUint8Array(options) {
            return this.zip.generate(_objectSpread(_objectSpread({
              compression: "DEFLATE",
              fileOrder: zipFileOrder
            }, options), {}, {
              type: "uint8array"
            }));
          }
          /* Export functions, present since 3.62.0 */
        }, {
          key: "toArrayBuffer",
          value: function toArrayBuffer(options) {
            return this.zip.generate(_objectSpread(_objectSpread({
              compression: "DEFLATE",
              fileOrder: zipFileOrder
            }, options), {}, {
              type: "arraybuffer"
            }));
          }
        }]);
      })();
      Docxtemplater.DocUtils = DocUtils;
      Docxtemplater.Errors = require_errors2();
      Docxtemplater.XmlTemplater = require_xml_templater();
      Docxtemplater.FileTypeConfig = require_file_type_config();
      Docxtemplater.XmlMatcher = require_xml_matcher();
      module.exports = Docxtemplater;
      module.exports["default"] = Docxtemplater;
    }
  });

  // packages/school/MVC/services/school/reportDocxRenderCore.js
  var require_reportDocxRenderCore = __commonJS({
    "packages/school/MVC/services/school/reportDocxRenderCore.js"(exports, module) {
      "use strict";
      function coerceToBuffer(binaryLike) {
        if (!binaryLike) return Buffer.alloc(0);
        if (Buffer.isBuffer(binaryLike)) return binaryLike;
        if (binaryLike instanceof Uint8Array) {
          return Buffer.from(binaryLike.buffer, binaryLike.byteOffset, binaryLike.byteLength);
        }
        if (binaryLike instanceof ArrayBuffer) return Buffer.from(new Uint8Array(binaryLike));
        return Buffer.from(binaryLike);
      }
      function getDocxDependencies() {
        let PizZip;
        let Docxtemplater;
        const missing = [];
        try {
          PizZip = require_js();
        } catch (error) {
          missing.push(`pizzip (${error?.code || error?.message || "load error"})`);
        }
        try {
          Docxtemplater = require_docxtemplater();
        } catch (error) {
          missing.push(`docxtemplater (${error?.code || error?.message || "load error"})`);
        }
        if (missing.length > 0) {
          throw new Error(
            `DOCX export dependencies are missing: ${missing.join(", ")}. Run \`npm install docxtemplater pizzip\` then restart the server.`
          );
        }
        return { PizZip, Docxtemplater };
      }
      function extractDocxRenderError(error) {
        if (!error) return "Unknown DOCX render error.";
        const properties = error.properties || {};
        const detailedErrors = Array.isArray(properties.errors) ? properties.errors : [];
        const detailMessage = detailedErrors.map((row) => {
          const explanation = row?.properties?.explanation || row?.message || "";
          return String(explanation || "").trim();
        }).filter(Boolean).join(" | ");
        if (detailMessage) return detailMessage;
        if (properties.explanation) return String(properties.explanation);
        if (error.message) return String(error.message);
        return "Unknown DOCX render error.";
      }
      function renderDocxFromTemplateBuffer(templateBuffer, { placeholders = {}, collections = {}, fileName = "report.docx" } = {}) {
        const { PizZip, Docxtemplater } = getDocxDependencies();
        const binary = coerceToBuffer(templateBuffer);
        const renderData = buildRenderData(placeholders, collections);
        let doc;
        try {
          const zip = new PizZip(binary);
          doc = new Docxtemplater(zip, {
            delimiters: { start: "{{", end: "}}" },
            paragraphLoop: true,
            linebreaks: true,
            nullGetter: () => ""
          });
          doc.render(renderData);
        } catch (error) {
          throw new Error(`DOCX render failed: ${extractDocxRenderError(error)}`);
        }
        const buffer = doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
        assertValidDocxPackage(buffer, fileName);
        return { buffer, fileName: String(fileName || "report.docx"), renderData };
      }
      function normalizeTokenKey(rawToken) {
        const clean = String(rawToken || "").trim();
        if (!clean) return "";
        const match = clean.match(/^\{\{\s*([^{}]+?)\s*\}\}$/);
        if (match && match[1]) return String(match[1]).trim();
        return clean;
      }
      function toDocxSafeValue(value) {
        if (value === void 0 || value === null) return "";
        if (typeof value === "boolean") return value ? "Yes" : "No";
        if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
        if (typeof value === "string") return value;
        if (Array.isArray(value)) return value.join(", ");
        try {
          return JSON.stringify(value);
        } catch (_) {
          return String(value);
        }
      }
      function normalizeCollectionRows(rows = []) {
        return (Array.isArray(rows) ? rows : []).filter((row) => row && typeof row === "object" && !Array.isArray(row)).map((row) => {
          const out = {};
          Object.keys(row).forEach((key) => {
            const cleanKey = normalizeTokenKey(key);
            if (!cleanKey) return;
            out[cleanKey] = toDocxSafeValue(row[key]);
          });
          return out;
        });
      }
      function buildRenderData(placeholders = {}, collections = {}) {
        const out = {};
        Object.keys(placeholders || {}).forEach((token) => {
          const normalizedKey = normalizeTokenKey(token);
          if (!normalizedKey) return;
          out[normalizedKey] = toDocxSafeValue(placeholders[token]);
        });
        Object.keys(collections || {}).forEach((key) => {
          const normalizedKey = normalizeTokenKey(key);
          if (!normalizedKey) return;
          out[normalizedKey] = normalizeCollectionRows(collections[key]);
        });
        return out;
      }
      function extractDocxRenderError(error) {
        if (!error) return "Unknown DOCX render error.";
        const properties = error.properties || {};
        const detailedErrors = Array.isArray(properties.errors) ? properties.errors : [];
        const detailMessage = detailedErrors.map((row) => {
          const explanation = row?.properties?.explanation || row?.message || "";
          return String(explanation || "").trim();
        }).filter(Boolean).join(" | ");
        if (detailMessage) return detailMessage;
        if (properties.explanation) return String(properties.explanation);
        if (error.message) return String(error.message);
        return "Unknown DOCX render error.";
      }
      function maxRelationshipNumericId(relsXml = "") {
        let max = 0;
        const re = /\bId="rId(\d+)"/g;
        let match;
        while (match = re.exec(String(relsXml))) {
          const n = Number.parseInt(match[1], 10);
          if (Number.isFinite(n) && n > max) max = n;
        }
        return max;
      }
      function parseRelationshipTagAttributes(attrText = "") {
        const attrs = {};
        const re = /(\w+)="([^"]*)"/g;
        let match;
        while (match = re.exec(String(attrText))) {
          attrs[match[1]] = match[2];
        }
        return attrs;
      }
      function zipEntryBinary(zipFile = null) {
        if (!zipFile) return null;
        if (typeof zipFile.asNodeBuffer === "function") return zipFile.asNodeBuffer();
        if (typeof zipFile.asUint8Array === "function") return Buffer.from(zipFile.asUint8Array());
        return Buffer.from(zipFile.asBinary(), "binary");
      }
      function findDocumentBodySliceBounds(xml = "") {
        const text = String(xml);
        const openMatch = text.match(/<w:body\b[^>]*>/);
        if (!openMatch || openMatch.index == null) {
          throw new Error("Rendered DOCX has an invalid document body.");
        }
        const openStart = openMatch.index;
        const openEnd = openStart + openMatch[0].length;
        const bodyEnd = text.lastIndexOf("</w:body>");
        if (bodyEnd < openEnd) {
          throw new Error("Rendered DOCX has an invalid document body.");
        }
        return { openStart, openEnd, bodyEnd, openTag: openMatch[0] };
      }
      function extractTrailingSectPrBlock(bodyInner = "") {
        const body = String(bodyInner);
        const lastSectStart = body.lastIndexOf("<w:sectPr");
        if (lastSectStart < 0) return { body, sectPr: "" };
        const tail = body.slice(lastSectStart);
        if (!/^<w:sectPr[\s\S]*<\/w:sectPr>\s*$/.test(tail)) {
          return { body, sectPr: "" };
        }
        return {
          body: body.slice(0, lastSectStart),
          sectPr: tail.trim()
        };
      }
      function extractSectPrFromDocument(xml = "") {
        const { openEnd, bodyEnd } = findDocumentBodySliceBounds(xml);
        const inner = String(xml).slice(openEnd, bodyEnd);
        return extractTrailingSectPrBlock(inner).sectPr;
      }
      function extractDocumentBodyInner(xml = "") {
        const { openEnd, bodyEnd } = findDocumentBodySliceBounds(xml);
        const inner = String(xml).slice(openEnd, bodyEnd);
        return extractTrailingSectPrBlock(inner).body;
      }
      function ensureContentTypesOverride(contentTypesXml = "", partName = "", contentType = "") {
        const part = partName.startsWith("/") ? partName : `/${partName}`;
        if (!contentType || !contentTypesXml || contentTypesXml.includes(`PartName="${part}"`)) {
          return contentTypesXml;
        }
        return contentTypesXml.replace(
          "</Types>",
          `  <Override PartName="${part}" ContentType="${contentType}"/>
</Types>`
        );
      }
      var MERGE_SKIP_WORD_PART = /^(document|styles|fontTable|settings|webSettings|numbering|theme)\.xml$/i;
      function cloneStudentWordParts(sourceZip, baseZip, mergeIndex) {
        let clonedBytes = 0;
        let clonedFiles = 0;
        Object.keys(sourceZip.files).forEach((name) => {
          const entry = sourceZip.files[name];
          if (!entry || entry.dir || !name.startsWith("word/")) return;
          const rel = name.slice("word/".length);
          if (MERGE_SKIP_WORD_PART.test(rel) || rel === "_rels/document.xml.rels") return;
          const dest = rel.startsWith("_rels/") ? `word/_rels/s${mergeIndex}_${rel.slice("_rels/".length)}` : `word/s${mergeIndex}_${rel.replace(/\//g, "_")}`;
          if (baseZip.file(dest)) return;
          const binary = zipEntryBinary(entry);
          if (!binary) return;
          baseZip.file(dest, binary);
          clonedBytes += binary.length;
          clonedFiles += 1;
        });
        return { clonedBytes, clonedFiles };
      }
      function rewriteClonedPartRelationshipTargets(baseZip, mergeIndex) {
        const prefix = `word/_rels/s${mergeIndex}_`;
        Object.keys(baseZip.files).forEach((name) => {
          if (!name.startsWith(prefix) || !name.endsWith(".rels")) return;
          const text = baseZip.file(name)?.asText() || "";
          if (!text) return;
          const rewritten = text.replace(/Target="([^"]+)"/g, (full, target) => {
            let t = String(target || "").trim();
            if (t.startsWith("../")) t = t.slice(3);
            if (/^(media|embeddings|charts)\//i.test(t)) {
              return `Target="s${mergeIndex}_${t.replace(/\//g, "_")}"`;
            }
            const baseName = t.split("/").pop();
            if (baseName && /^(header|footer)/i.test(baseName)) {
              return `Target="s${mergeIndex}_${baseName}"`;
            }
            return full;
          });
          baseZip.file(name, rewritten);
        });
      }
      function registerContentTypesForClonedParts(baseZip, mergeIndex, contentTypesXml = "") {
        let out = contentTypesXml;
        const headerCt = "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml";
        const footerCt = "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml";
        Object.keys(baseZip.files).forEach((name) => {
          if (!name.startsWith(`word/s${mergeIndex}_`)) return;
          if (/header\d+\.xml$/i.test(name)) {
            out = ensureContentTypesOverride(out, `/${name}`, headerCt);
          } else if (/footer\d+\.xml$/i.test(name)) {
            out = ensureContentTypesOverride(out, `/${name}`, footerCt);
          }
        });
        return out;
      }
      function remapSectionHeaderFooterParts({
        sourceZip,
        baseZip,
        mergeIndex,
        sectPrXml = "",
        relsXml = "",
        maxRid = 0,
        contentTypesXml = ""
      } = {}) {
        let outSect = String(sectPrXml);
        let outRels = String(relsXml);
        let nextRid = maxRid;
        let outContentTypes = contentTypesXml;
        const sourceRels = sourceZip.file("word/_rels/document.xml.rels")?.asText() || "";
        const refRe = /<w:(headerReference|footerReference)\b([^>]*)\/?>/g;
        let match;
        while (match = refRe.exec(sectPrXml)) {
          const kind = match[1];
          const attrText = match[2] || "";
          const idMatch = attrText.match(/\br:id="([^"]+)"/);
          if (!idMatch) continue;
          const oldId = idMatch[1];
          const relTagMatch = sourceRels.match(new RegExp(`<Relationship\\s+[^>]*Id="${oldId}"[^>]*\\/?>`, "i"));
          if (!relTagMatch) continue;
          const attrs = parseRelationshipTagAttributes(
            relTagMatch[0].replace(/^<Relationship\s+/, "").replace(/\/?>$/, "")
          );
          let target = String(attrs.Target || "").trim();
          if (!target) continue;
          if (target.startsWith("/")) target = target.slice(1);
          const srcPath = target.startsWith("word/") ? target : `word/${target}`;
          const srcFile = sourceZip.file(srcPath);
          if (!srcFile) continue;
          const baseName = target.split("/").pop() || `part_${mergeIndex}`;
          const destFileName = `s${mergeIndex}_${baseName}`;
          const destPath = `word/${destFileName}`;
          if (!baseZip.file(destPath)) {
            const binary = zipEntryBinary(srcFile);
            if (!binary) continue;
            baseZip.file(destPath, binary);
            const hfRelsPath = `word/_rels/${baseName}.rels`;
            const srcHfRels = sourceZip.file(hfRelsPath);
            if (srcHfRels) {
              const destRels = `word/_rels/${destFileName}.rels`;
              if (!baseZip.file(destRels)) {
                baseZip.file(destRels, zipEntryBinary(srcHfRels));
              }
            }
          }
          nextRid += 1;
          const newId = `rId${nextRid}`;
          const relType = kind === "headerReference" ? "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer";
          outRels = outRels.replace(
            "</Relationships>",
            `  <Relationship Id="${newId}" Type="${relType}" Target="${destFileName}"/>
</Relationships>`
          );
          outSect = outSect.replace(new RegExp(`r:id="${oldId}"`, "g"), `r:id="${newId}"`);
          const ct = kind === "headerReference" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml" : "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml";
          outContentTypes = ensureContentTypesOverride(outContentTypes, `/word/${destFileName}`, ct);
        }
        return { sectPrXml: outSect, relsXml: outRels, maxRid: nextRid, contentTypesXml: outContentTypes };
      }
      function isDocxZipBuffer(buffer) {
        const buf = coerceToBuffer(buffer);
        if (!buf.length || buf.length < 4) return false;
        return buf[0] === 80 && buf[1] === 75 && buf[2] === 3 && buf[3] === 4;
      }
      function assertValidDocxPackage(buffer, label = "document") {
        const tag = cleanDocxAssertLabel(label);
        const buf = coerceToBuffer(buffer);
        if (!buf.length) {
          const error = new Error(`${tag}: DOCX output is empty.`);
          error.statusCode = 500;
          throw error;
        }
        if (!isDocxZipBuffer(buf)) {
          const error = new Error(`${tag}: output is not a valid DOCX package (missing ZIP header).`);
          error.statusCode = 500;
          throw error;
        }
        const { PizZip } = getDocxDependencies();
        const zip = new PizZip(buf);
        if (!zip.file("word/document.xml")) {
          const error = new Error(`${tag}: DOCX package is missing word/document.xml.`);
          error.statusCode = 500;
          throw error;
        }
        return true;
      }
      function cleanDocxAssertLabel(label) {
        return String(label || "document").trim() || "document";
      }
      function summarizeDocxFileBuffers(files = []) {
        const rows = (Array.isArray(files) ? files : []).map((row) => Buffer.isBuffer(row?.buffer) ? row.buffer.length : 0).filter((size) => size > 0);
        return {
          count: Array.isArray(files) ? files.length : 0,
          withBuffer: rows.length,
          totalBytes: rows.reduce((sum, size) => sum + size, 0),
          minBytes: rows.length ? Math.min(...rows) : 0,
          maxBytes: rows.length ? Math.max(...rows) : 0
        };
      }
      function normalizeRelationshipTargetToZipPath(target = "") {
        let t = String(target || "").trim();
        if (t.startsWith("/")) t = t.slice(1);
        if (t.startsWith("../")) t = t.replace(/^\.\.\//, "");
        if (/^(media|embeddings|charts)\//i.test(t)) return `word/${t}`;
        if (t.startsWith("word/")) return t;
        return `word/${t}`;
      }
      function ensureContentTypesForMedia(contentTypesXml = "", fileName = "") {
        const ext = String(fileName || "").split(".").pop().toLowerCase();
        if (!ext) return contentTypesXml;
        const defaults = {
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          gif: "image/gif",
          bmp: "image/bmp",
          tiff: "image/tiff",
          emf: "image/x-emf",
          wmf: "image/x-wmf"
        };
        const contentType = defaults[ext];
        if (!contentType) return contentTypesXml;
        if (contentTypesXml.includes(`Extension="${ext}"`)) return contentTypesXml;
        return contentTypesXml.replace(
          "</Types>",
          `  <Default Extension="${ext}" ContentType="${contentType}"/>
</Types>`
        );
      }
      function remapRelationshipIdsInXml(xml = "", ridMap = /* @__PURE__ */ new Map()) {
        let out = String(xml);
        ridMap.forEach((newId, oldId) => {
          const patterns = [
            new RegExp(`r:embed="${oldId}"`, "g"),
            new RegExp(`r:id="${oldId}"`, "g"),
            new RegExp(`r:link="${oldId}"`, "g")
          ];
          patterns.forEach((re) => {
            out = out.replace(re, (full) => full.replace(oldId, newId));
          });
        });
        return out;
      }
      function appendMediaRelationshipsFromZip({
        sourceZip,
        baseZip,
        mergeIndex,
        baseRelsXml,
        maxRid
      } = {}) {
        const addRels = sourceZip.file("word/_rels/document.xml.rels")?.asText() || "";
        const ridMap = /* @__PURE__ */ new Map();
        const copiedMediaNames = [];
        let relsXml = baseRelsXml;
        let nextRid = maxRid;
        const relRegex = /<Relationship\s+([^/>]+)\/?>/g;
        let match;
        while (match = relRegex.exec(addRels)) {
          const attrs = parseRelationshipTagAttributes(match[1]);
          const oldId = attrs.Id;
          let targetRaw = String(attrs.Target || "").trim();
          if (!oldId || !targetRaw) continue;
          if (targetRaw.startsWith("/")) targetRaw = targetRaw.slice(1);
          const relTarget = targetRaw;
          const pathForMatch = relTarget.replace(/^\.\.\//, "");
          const isMedia = /^media\//i.test(pathForMatch) || /^embeddings\//i.test(pathForMatch);
          const isChart = /^charts\//i.test(pathForMatch) || String(attrs.Type || "").toLowerCase().includes("chart");
          const isImageRel = String(attrs.Type || "").toLowerCase().includes("image") || String(attrs.Type || "").toLowerCase().includes("oleobject");
          if (!isMedia && !isImageRel && !isChart) continue;
          const srcPath = normalizeRelationshipTargetToZipPath(relTarget);
          const srcFile = sourceZip.file(srcPath);
          if (!srcFile) continue;
          const baseName = pathForMatch.split("/").pop() || `part_${mergeIndex}`;
          const prefix = /^charts\//i.test(pathForMatch) ? "charts" : "media";
          const newTarget = `${prefix}/merged_${mergeIndex}_${baseName}`;
          const destPath = `word/${newTarget}`;
          const binary = zipEntryBinary(srcFile);
          if (!binary) continue;
          nextRid += 1;
          const newId = `rId${nextRid}`;
          ridMap.set(oldId, newId);
          baseZip.file(destPath, binary);
          copiedMediaNames.push(baseName);
          const relLine = `<Relationship Id="${newId}" Type="${attrs.Type}" Target="${newTarget}"/>`;
          relsXml = relsXml.replace("</Relationships>", `  ${relLine}
</Relationships>`);
        }
        return { relsXml, ridMap, nextRid, copiedMediaNames };
      }
      function mergeReportInstanceDocxBuffers(buffers = []) {
        const sourceBuffers = (Array.isArray(buffers) ? buffers : []).filter(Boolean).map((row) => coerceToBuffer(row));
        if (!sourceBuffers.length) throw new Error("No rendered report documents were available to combine.");
        const { PizZip } = getDocxDependencies();
        const baseZip = new PizZip(sourceBuffers[0]);
        const baseXml = baseZip.file("word/document.xml")?.asText();
        if (!baseXml) throw new Error("Rendered DOCX is missing word/document.xml.");
        const baseBounds = findDocumentBodySliceBounds(baseXml);
        let combinedBody = "";
        let relsXml = baseZip.file("word/_rels/document.xml.rels")?.asText() || '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
        let contentTypesXml = baseZip.file("[Content_Types].xml")?.asText() || "";
        let maxRid = maxRelationshipNumericId(relsXml);
        for (let index = 0; index < sourceBuffers.length; index += 1) {
          const zip = index === 0 ? baseZip : new PizZip(sourceBuffers[index]);
          const xml = index === 0 ? baseXml : zip.file("word/document.xml")?.asText();
          if (!xml) throw new Error("Rendered DOCX is missing word/document.xml.");
          if (index > 0) {
            combinedBody += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
            cloneStudentWordParts(zip, baseZip, index);
            rewriteClonedPartRelationshipTargets(baseZip, index);
            contentTypesXml = registerContentTypesForClonedParts(baseZip, index, contentTypesXml);
          }
          let mediaMerge = { relsXml, nextRid: maxRid, ridMap: /* @__PURE__ */ new Map(), copiedMediaNames: [] };
          if (index > 0) {
            mediaMerge = appendMediaRelationshipsFromZip({
              sourceZip: zip,
              baseZip,
              mergeIndex: index,
              baseRelsXml: relsXml,
              maxRid
            });
            relsXml = mediaMerge.relsXml;
            maxRid = mediaMerge.nextRid;
            (mediaMerge.copiedMediaNames || []).forEach((name) => {
              contentTypesXml = ensureContentTypesForMedia(contentTypesXml, name);
            });
          }
          let body = extractDocumentBodyInner(xml);
          if (index > 0) {
            body = remapRelationshipIdsInXml(body, mediaMerge.ridMap);
          }
          let sectPr = extractSectPrFromDocument(xml);
          if (index > 0 && sectPr) {
            const hfMerge = remapSectionHeaderFooterParts({
              sourceZip: zip,
              baseZip,
              mergeIndex: index,
              sectPrXml: sectPr,
              relsXml,
              maxRid,
              contentTypesXml
            });
            sectPr = hfMerge.sectPrXml;
            relsXml = hfMerge.relsXml;
            maxRid = hfMerge.maxRid;
            contentTypesXml = hfMerge.contentTypesXml;
          }
          combinedBody += body;
          if (sectPr) combinedBody += sectPr;
        }
        if (baseZip.file("word/_rels/document.xml.rels")) {
          baseZip.file("word/_rels/document.xml.rels", relsXml);
        }
        if (contentTypesXml && baseZip.file("[Content_Types].xml")) {
          baseZip.file("[Content_Types].xml", contentTypesXml);
        }
        baseZip.file(
          "word/document.xml",
          baseXml.slice(0, baseBounds.openEnd) + combinedBody + baseXml.slice(baseBounds.bodyEnd)
        );
        const merged = baseZip.generate({ type: "nodebuffer", compression: "DEFLATE" });
        assertValidDocxPackage(merged, "merged DOCX");
        const sumBodyInnerChars = sourceBuffers.reduce((sum, buf) => {
          try {
            const zip = new PizZip(buf);
            const xml = zip.file("word/document.xml")?.asText() || "";
            if (!xml) return sum;
            return sum + extractDocumentBodyInner(xml).length;
          } catch {
            return sum;
          }
        }, 0);
        const bodyInnerThreshold = Math.floor(sumBodyInnerChars * 0.85);
        if (sumBodyInnerChars > 0 && combinedBody.length < bodyInnerThreshold) {
          throw new Error("Merged DOCX document body is unexpectedly small; merge may be incomplete.");
        }
        return merged;
      }
      module.exports = {
        normalizeTokenKey,
        toDocxSafeValue,
        normalizeCollectionRows,
        buildRenderData,
        getDocxDependencies,
        extractDocxRenderError,
        renderDocxFromTemplateBuffer,
        isDocxZipBuffer,
        assertValidDocxPackage,
        cleanDocxAssertLabel,
        summarizeDocxFileBuffers,
        mergeReportInstanceDocxBuffers
      };
    }
  });

  // packages/school/MVC/services/school/sarLocalExportCore.browserEntry.js
  var require_sarLocalExportCore_browserEntry = __commonJS({
    "packages/school/MVC/services/school/sarLocalExportCore.browserEntry.js"(exports, module) {
      var { Buffer: Buffer2 } = require_buffer();
      if (typeof globalThis.Buffer === "undefined") {
        globalThis.Buffer = Buffer2;
      }
      var JSZip = require_jszip_min();
      var core = require_reportDocxRenderCore();
      var BUNDLE_SCHEMA_VERSION = 1;
      function validateClientBundle(bundle) {
        if (!bundle || typeof bundle !== "object") {
          throw new Error("Render bundle must be a JSON object.");
        }
        if (Number(bundle.schemaVersion) !== BUNDLE_SCHEMA_VERSION) {
          throw new Error(`Unsupported bundle schema version (expected ${BUNDLE_SCHEMA_VERSION}).`);
        }
        if (!Array.isArray(bundle.targets) || !bundle.targets.length) {
          throw new Error("Bundle has no targets.");
        }
        if (!bundle.templates || typeof bundle.templates !== "object") {
          throw new Error("Bundle is missing templates.");
        }
        return true;
      }
      async function parseSarBundleZip(arrayBuffer) {
        const zip = await JSZip.loadAsync(arrayBuffer);
        const manifestText = await zip.file("manifest.json")?.async("string");
        const targetsText = await zip.file("targets.json")?.async("string");
        const templateIndexText = await zip.file("templates/index.json")?.async("string");
        if (!manifestText || !targetsText || !templateIndexText) {
          throw new Error("Invalid .sarbundle.zip: missing manifest, targets, or template index.");
        }
        const manifestPack = JSON.parse(manifestText);
        const targets = JSON.parse(targetsText);
        const templateIndex = JSON.parse(templateIndexText);
        const templates = {};
        await Promise.all(Object.entries(templateIndex).map(async ([key, meta]) => {
          const b64 = await zip.file(meta.file)?.async("string");
          if (!b64) throw new Error(`Missing template payload for ${key}.`);
          templates[key] = {
            templateId: meta.templateId,
            variantKey: meta.variantKey,
            label: meta.label,
            dataBase64: b64
          };
        }));
        const bundle = {
          schemaVersion: manifestPack.schemaVersion,
          renderCoreVersion: manifestPack.renderCoreVersion,
          manifest: manifestPack.manifest,
          templates,
          targets
        };
        validateClientBundle(bundle);
        return bundle;
      }
      function base64ToUint8Array(b64) {
        const binary = atob(String(b64 || ""));
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i += 1) bytes[i] = binary.charCodeAt(i);
        return bytes;
      }
      function toBuffer(binaryLike) {
        if (Buffer2.isBuffer(binaryLike)) return binaryLike;
        if (binaryLike instanceof Uint8Array) return Buffer2.from(binaryLike);
        if (binaryLike instanceof ArrayBuffer) return Buffer2.from(new Uint8Array(binaryLike));
        return Buffer2.from(binaryLike || []);
      }
      async function renderTargetDocx(target, templates) {
        const tpl = templates[target.templateRefKey];
        if (!tpl?.dataBase64) throw new Error(`Missing template ${target.templateRefKey}`);
        const binary = toBuffer(base64ToUint8Array(tpl.dataBase64));
        return core.renderDocxFromTemplateBuffer(binary, {
          placeholders: target.placeholders || {},
          collections: target.collections || {},
          fileName: target.fileName || "report.docx"
        });
      }
      async function runPool(items, concurrency, worker) {
        const list = Array.isArray(items) ? items : [];
        const limit = Math.max(1, Math.min(Number(concurrency) || 4, 16));
        const results = new Array(list.length);
        let cursor = 0;
        const runners = Array.from({ length: Math.min(limit, list.length) }, async () => {
          while (cursor < list.length) {
            const index = cursor;
            cursor += 1;
            results[index] = await worker(list[index], index);
          }
        });
        await Promise.all(runners);
        return results;
      }
      function renderWithWorkerPool(targets, templates, concurrency, workerScriptUrl, onProgress) {
        return new Promise((resolve, reject) => {
          const list = Array.isArray(targets) ? targets : [];
          const limit = Math.max(1, Math.min(Number(concurrency) || 4, 16));
          const results = new Array(list.length);
          let nextIndex = 0;
          let completed = 0;
          let failed = false;
          const workers = Array.from({ length: Math.min(limit, list.length) }, () => new Worker(workerScriptUrl));
          const finishIfDone = () => {
            if (completed === list.length) {
              workers.forEach((worker) => worker.terminate());
              resolve(results);
            }
          };
          const assignWork = (worker, workerIndex) => {
            if (failed) return;
            if (nextIndex >= list.length) return;
            const index = nextIndex;
            nextIndex += 1;
            const target = list[index];
            worker.onmessage = (event) => {
              const payload = event.data || {};
              if (!payload.ok) {
                failed = true;
                workers.forEach((row) => row.terminate());
                reject(new Error(payload.error || "Worker render failed."));
                return;
              }
              results[index] = {
                buffer: payload.buffer,
                fileName: payload.fileName || target.fileName || `report_${index + 1}.docx`
              };
              completed += 1;
              if (typeof onProgress === "function") {
                onProgress({ index, total: list.length, fileName: results[index].fileName, phase: "render" });
              }
              if (nextIndex < list.length) {
                assignWork(worker, workerIndex);
              } else {
                finishIfDone();
              }
            };
            worker.onerror = (error) => {
              failed = true;
              workers.forEach((row) => row.terminate());
              reject(error);
            };
            const transfers = [];
            worker.postMessage({ target, templates, index }, transfers);
          };
          workers.forEach((worker, workerIndex) => assignWork(worker, workerIndex));
          if (!list.length) resolve([]);
        });
      }
      async function exportBundleLocally(bundle, { concurrency = 4, onProgress, workerScriptUrl } = {}) {
        validateClientBundle(bundle);
        const defaultConcurrency = Math.max(
          1,
          Math.min(Number(concurrency) || (typeof navigator !== "undefined" ? (navigator.hardwareConcurrency || 4) - 1 : 4), 8)
        );
        const useWorkers = typeof Worker !== "undefined" && String(workerScriptUrl || "").trim();
        const rendered = useWorkers ? await renderWithWorkerPool(bundle.targets, bundle.templates, defaultConcurrency, workerScriptUrl, onProgress) : await runPool(bundle.targets, defaultConcurrency, async (target, index) => {
          const row = await renderTargetDocx(target, bundle.templates);
          if (typeof onProgress === "function") {
            onProgress({ index, total: bundle.targets.length, fileName: row.fileName, phase: "render" });
          }
          return row;
        });
        if (typeof onProgress === "function") {
          onProgress({ phase: "merge", total: bundle.targets.length });
        }
        const mode = String(bundle.manifest?.mergePolicy?.mode || "single").toLowerCase();
        const stem = String(bundle.manifest?.mergePolicy?.outputStem || "student_attendance_export").replace(/[^A-Za-z0-9._-]+/g, "_");
        if (mode === "zip") {
          const zip = new JSZip();
          const used = /* @__PURE__ */ new Set();
          rendered.forEach((row, index) => {
            let name = String(bundle.targets[index]?.fileName || row.fileName || `report_${index + 1}.docx`);
            const key = name.toLowerCase();
            if (used.has(key)) name = `report_${index + 1}_${name}`;
            used.add(key);
            zip.file(name, row.buffer);
          });
          const buffer = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
          if (typeof onProgress === "function") onProgress({ phase: "complete", fileName: `${stem}.zip` });
          return { buffer: toBuffer(buffer), fileName: `${stem}.zip`, contentType: "application/zip" };
        }
        const merged = core.mergeReportInstanceDocxBuffers(
          rendered.map((row) => toBuffer(row.buffer))
        );
        if (typeof onProgress === "function") onProgress({ phase: "complete", fileName: `${stem}.docx` });
        return {
          buffer: merged,
          fileName: `${stem}.docx`,
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        };
      }
      module.exports = {
        ...core,
        BUNDLE_SCHEMA_VERSION,
        validateClientBundle,
        parseSarBundleZip,
        exportBundleLocally,
        renderTargetDocx
      };
    }
  });
  return require_sarLocalExportCore_browserEntry();
})();
/*! Bundled license information:

ieee754/index.js:
  (*! ieee754. BSD-3-Clause License. Feross Aboukhadijeh <https://feross.org/opensource> *)

buffer/index.js:
  (*!
   * The buffer module from node.js, for the browser.
   *
   * @author   Feross Aboukhadijeh <https://feross.org>
   * @license  MIT
   *)

jszip/dist/jszip.min.js:
  (*!
  
  JSZip v3.10.1 - A JavaScript class for generating and reading zip files
  <http://stuartk.com/jszip>
  
  (c) 2009-2016 Stuart Knightley <stuart [at] stuartk.com>
  Dual licenced under the MIT license or GPLv3. See https://raw.github.com/Stuk/jszip/main/LICENSE.markdown.
  
  JSZip uses the library pako released under the MIT license :
  https://github.com/nodeca/pako/blob/main/LICENSE
  *)

pako/dist/pako.es5.min.js:
  (*! pako 2.1.0 https://github.com/nodeca/pako @license (MIT AND Zlib) *)
*/
;

}));
