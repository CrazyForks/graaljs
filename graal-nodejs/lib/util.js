// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

const {
  ArrayIsArray,
  ArrayPrototypeJoin,
  ArrayPrototypePop,
  ArrayPrototypePush,
  Date,
  DatePrototypeGetDate,
  DatePrototypeGetHours,
  DatePrototypeGetMinutes,
  DatePrototypeGetMonth,
  DatePrototypeGetSeconds,
  Error,
  ErrorCaptureStackTrace,
  FunctionPrototypeBind,
  NumberIsSafeInteger,
  ObjectDefineProperties,
  ObjectDefineProperty,
  ObjectGetOwnPropertyDescriptors,
  ObjectKeys,
  ObjectPrototypeToString,
  ObjectSetPrototypeOf,
  ObjectValues,
  ReflectApply,
  StringPrototypePadStart,
  StringPrototypeToWellFormed,
} = primordials;

const {
  ErrnoException,
  ExceptionWithHostPort,
  codes: {
    ERR_FALSY_VALUE_REJECTION,
    ERR_INVALID_ARG_TYPE,
    ERR_OUT_OF_RANGE,
  },
  isErrorStackTraceLimitWritable,
} = require('internal/errors');
const {
  format,
  formatWithOptions,
  inspect,
  stripVTControlCharacters,
} = require('internal/util/inspect');
const { debuglog } = require('internal/util/debuglog');
const {
  validateBoolean,
  validateFunction,
  validateNumber,
  validateString,
  validateOneOf,
  validateObject,
} = require('internal/validators');
const { isBuffer } = require('buffer').Buffer;
const {
  isReadableStream,
  isWritableStream,
  isNodeStream,
} = require('internal/streams/utils');
const types = require('internal/util/types');

let utilColors;
function lazyUtilColors() {
  utilColors ??= require('internal/util/colors');
  return utilColors;
}
const { getOptionValue } = require('internal/options');

const binding = internalBinding('util');

const {
  deprecate,
  getLazy,
  getSystemErrorMap,
  getSystemErrorName: internalErrorName,
  getSystemErrorMessage: internalErrorMessage,
  promisify,
  defineLazyProperties,
} = require('internal/util');

let abortController;

function lazyAbortController() {
  abortController ??= require('internal/abort_controller');
  return abortController;
}

let internalDeepEqual;

/**
 * @deprecated since v4.0.0
 * @param {any} arg
 * @returns {arg is boolean}
 */
function isBoolean(arg) {
  return typeof arg === 'boolean';
}

/**
 * @deprecated since v4.0.0
 * @param {any} arg
 * @returns {arg is null}
 */
function isNull(arg) {
  return arg === null;
}

/**
 * @deprecated since v4.0.0
 * @param {any} arg
 * @returns {arg is (null | undefined)}
 */
function isNullOrUndefined(arg) {
  return arg === null || arg === undefined;
}

/**
 * @deprecated since v4.0.0
 * @param {any} arg
 * @returns {arg is number}
 */
function isNumber(arg) {
  return typeof arg === 'number';
}

/**
 * @param {any} arg
 * @returns {arg is string}
 */
function isString(arg) {
  return typeof arg === 'string';
}

/**
 * @deprecated since v4.0.0
 * @param {any} arg
 * @returns {arg is symbol}
 */
function isSymbol(arg) {
  return typeof arg === 'symbol';
}

/**
 * @deprecated since v4.0.0
 * @param {any} arg
 * @returns {arg is undefined}
 */
function isUndefined(arg) {
  return arg === undefined;
}

/**
 * @deprecated since v4.0.0
 * @param {any} arg
 * @returns {a is NonNullable<object>}
 */
function isObject(arg) {
  return arg !== null && typeof arg === 'object';
}

/**
 * @deprecated since v4.0.0
 * @param {any} e
 * @returns {arg is Error}
 */
function isError(e) {
  return ObjectPrototypeToString(e) === '[object Error]' || e instanceof Error;
}

/**
 * @deprecated since v4.0.0
 * @param {any} arg
 * @returns {arg is Function}
 */
function isFunction(arg) {
  return typeof arg === 'function';
}

/**
 * @deprecated since v4.0.0
 * @param {any} arg
 * @returns {arg is (boolean | null | number | string | symbol | undefined)}
 */
function isPrimitive(arg) {
  return arg === null ||
         (typeof arg !== 'object' && typeof arg !== 'function');
}

/**
 * @param {number} n
 * @returns {string}
 */
function pad(n) {
  return StringPrototypePadStart(n.toString(), 2, '0');
}

/**
 * @param {string} [code]
 * @returns {string}
 */
function escapeStyleCode(code) {
  if (code === undefined) return '';
  return `\u001b[${code}m`;
}

/**
 * @param {string | string[]} format
 * @param {string} text
 * @param {object} [options={}]
 * @param {boolean} [options.validateStream=true] - Whether to validate the stream.
 * @param {Stream} [options.stream=process.stdout] - The stream used for validation.
 * @returns {string}
 */
function styleText(format, text, { validateStream = true, stream = process.stdout } = {}) {
  validateString(text, 'text');
  validateBoolean(validateStream, 'options.validateStream');

  let skipColorize;
  if (validateStream) {
    if (
      !isReadableStream(stream) &&
      !isWritableStream(stream) &&
      !isNodeStream(stream)
    ) {
      throw new ERR_INVALID_ARG_TYPE('stream', ['ReadableStream', 'WritableStream', 'Stream'], stream);
    }

    // If the stream is falsy or should not be colorized, set skipColorize to true
    skipColorize = !lazyUtilColors().shouldColorize(stream);
  }

  // If the format is not an array, convert it to an array
  const formatArray = ArrayIsArray(format) ? format : [format];

  let left = '';
  let right = '';
  for (const key of formatArray) {
    if (key === 'none') continue;
    const formatCodes = inspect.colors[key];
    // If the format is not a valid style, throw an error
    if (formatCodes == null) {
      validateOneOf(key, 'format', ObjectKeys(inspect.colors));
    }
    if (skipColorize) continue;
    left += escapeStyleCode(formatCodes[0]);
    right = `${escapeStyleCode(formatCodes[1])}${right}`;
  }

  return skipColorize ? text : `${left}${text}${right}`;
}

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
                'Oct', 'Nov', 'Dec'];

/**
 * @returns {string}  26 Feb 16:19:34
 */
function timestamp() {
  const d = new Date();
  const t = ArrayPrototypeJoin([
    pad(DatePrototypeGetHours(d)),
    pad(DatePrototypeGetMinutes(d)),
    pad(DatePrototypeGetSeconds(d)),
  ], ':');
  return `${DatePrototypeGetDate(d)} ${months[DatePrototypeGetMonth(d)]} ${t}`;
}

let console;
/**
 * Log is just a thin wrapper to console.log that prepends a timestamp
 * @deprecated since v6.0.0
 * @type {(...args: any[]) => void}
 */
function log(...args) {
  console ??= require('internal/console/global');
  console.log('%s - %s', timestamp(), format(...args));
}

/**
 * Inherit the prototype methods from one constructor into another.
 *
 * The Function.prototype.inherits from lang.js rewritten as a standalone
 * function (not on Function.prototype). NOTE: If this file is to be loaded
 * during bootstrapping this function needs to be rewritten using some native
 * functions as prototype setup using normal JavaScript does not work as
 * expected during bootstrapping (see mirror.js in r114903).
 * @param {Function} ctor Constructor function which needs to inherit the
 *     prototype.
 * @param {Function} superCtor Constructor function to inherit prototype from.
 * @throws {TypeError} Will error if either constructor is null, or if
 *     the super constructor lacks a prototype.
 */
function inherits(ctor, superCtor) {

  if (ctor === undefined || ctor === null)
    throw new ERR_INVALID_ARG_TYPE('ctor', 'Function', ctor);

  if (superCtor === undefined || superCtor === null)
    throw new ERR_INVALID_ARG_TYPE('superCtor', 'Function', superCtor);

  if (superCtor.prototype === undefined) {
    throw new ERR_INVALID_ARG_TYPE('superCtor.prototype',
                                   'Object', superCtor.prototype);
  }
  ObjectDefineProperty(ctor, 'super_', {
    __proto__: null,
    value: superCtor,
    writable: true,
    configurable: true,
  });
  ObjectSetPrototypeOf(ctor.prototype, superCtor.prototype);
}

/**
 * @deprecated since v6.0.0
 * @template T
 * @template S
 * @param {T} target
 * @param {S} source
 * @returns {S extends null ? T : (T & S)}
 */
function _extend(target, source) {
  // Don't do anything if source isn't an object
  if (source === null || typeof source !== 'object') return target;

  const keys = ObjectKeys(source);
  let i = keys.length;
  while (i--) {
    target[keys[i]] = source[keys[i]];
  }
  return target;
}

const callbackifyOnRejected = (reason, cb) => {
  // `!reason` guard inspired by bluebird (Ref: https://goo.gl/t5IS6M).
  // Because `null` is a special error value in callbacks which means "no error
  // occurred", we error-wrap so the callback consumer can distinguish between
  // "the promise rejected with null" or "the promise fulfilled with undefined".
  if (!reason) {
    reason = new ERR_FALSY_VALUE_REJECTION.HideStackFramesError(reason);
    ErrorCaptureStackTrace(reason, callbackifyOnRejected);
  }
  return cb(reason);
};

/**
 * @template {(...args: any[]) => Promise<any>} T
 * @param {T} original
 * @returns {T extends (...args: infer TArgs) => Promise<infer TReturn> ?
 *   ((...params: [...TArgs, ((err: Error, ret: TReturn) => any)]) => void) :
 *   never
 * }
 */
function callbackify(original) {
  validateFunction(original, 'original');

  // We DO NOT return the promise as it gives the user a false sense that
  // the promise is actually somehow related to the callback's execution
  // and that the callback throwing will reject the promise.
  function callbackified(...args) {
    const maybeCb = ArrayPrototypePop(args);
    validateFunction(maybeCb, 'last argument');
    const cb = FunctionPrototypeBind(maybeCb, this);
    // In true node style we process the callback on `nextTick` with all the
    // implications (stack, `uncaughtException`, `async_hooks`)
    ReflectApply(original, this, args)
      .then((ret) => process.nextTick(cb, null, ret),
            (rej) => process.nextTick(callbackifyOnRejected, rej, cb));
  }

  const descriptors = ObjectGetOwnPropertyDescriptors(original);
  // It is possible to manipulate a functions `length` or `name` property. This
  // guards against the manipulation.
  if (typeof descriptors.length.value === 'number') {
    descriptors.length.value++;
  }
  if (typeof descriptors.name.value === 'string') {
    descriptors.name.value += 'Callbackified';
  }
  const propertiesValues = ObjectValues(descriptors);
  for (let i = 0; i < propertiesValues.length; i++) {
  // We want to use null-prototype objects to not rely on globally mutable
  // %Object.prototype%.
    ObjectSetPrototypeOf(propertiesValues[i], null);
  }
  ObjectDefineProperties(callbackified, descriptors);
  return callbackified;
}

/**
 * @param {number} err
 * @returns {string}
 */
function getSystemErrorMessage(err) {
  validateNumber(err, 'err');
  if (err >= 0 || !NumberIsSafeInteger(err)) {
    throw new ERR_OUT_OF_RANGE('err', 'a negative integer', err);
  }
  return internalErrorMessage(err);
}

/**
 * @param {number} err
 * @returns {string}
 */
function getSystemErrorName(err) {
  validateNumber(err, 'err');
  if (err >= 0 || !NumberIsSafeInteger(err)) {
    throw new ERR_OUT_OF_RANGE('err', 'a negative integer', err);
  }
  return internalErrorName(err);
}

function _errnoException(...args) {
  if (isErrorStackTraceLimitWritable()) {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 0;
    const e = new ErrnoException(...args);
    Error.stackTraceLimit = limit;
    ErrorCaptureStackTrace(e, _exceptionWithHostPort);
    return e;
  }
  return new ErrnoException(...args);
}

function _exceptionWithHostPort(...args) {
  if (isErrorStackTraceLimitWritable()) {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 0;
    const e = new ExceptionWithHostPort(...args);
    Error.stackTraceLimit = limit;
    ErrorCaptureStackTrace(e, _exceptionWithHostPort);
    return e;
  }
  return new ExceptionWithHostPort(...args);
}

/**
 * Parses the content of a `.env` file.
 * @param {string} content
 * @returns {Record<string, string>}
 */
function parseEnv(content) {
  validateString(content, 'content');
  return binding.parseEnv(content);
}

const lazySourceMap = getLazy(() => require('internal/source_map/source_map_cache'));

/**
 * @typedef {object} CallSite // The call site
 * @property {string} scriptName // The name of the resource that contains the
 * script for the function for this StackFrame
 * @property {string} functionName // The name of the function associated with this stack frame
 * @property {number} lineNumber // The number, 1-based, of the line for the associate function call
 * @property {number} columnNumber // The 1-based column offset on the line for the associated function call
 */

/**
 * @param {CallSite} callSite // The call site object to reconstruct from source map
 * @returns {CallSite | undefined} // The reconstructed call site object
 */
function reconstructCallSite(callSite) {
  const { scriptName, lineNumber, columnNumber } = callSite;
  const sourceMap = lazySourceMap().findSourceMap(scriptName);
  if (!sourceMap) return;
  const entry = sourceMap.findEntry(lineNumber - 1, columnNumber - 1);
  if (!entry?.originalSource) return;
  return {
    __proto__: null,
    // If the name is not found, it is an empty string to match the behavior of `util.getCallSite()`
    functionName: entry.name ?? '',
    scriptName: entry.originalSource,
    lineNumber: entry.originalLine + 1,
    column: entry.originalColumn + 1,
    columnNumber: entry.originalColumn + 1,
  };
}

/**
 *
 * The call site array to map
 * @param {CallSite[]} callSites
 * Array of objects with the reconstructed call site
 * @returns {CallSite[]}
 */
function mapCallSite(callSites) {
  const result = [];
  for (let i = 0; i < callSites.length; ++i) {
    const callSite = callSites[i];
    const found = reconstructCallSite(callSite);
    ArrayPrototypePush(result, found ?? callSite);
  }
  return result;
}

/**
 * @typedef {object} CallSiteOptions // The call site options
 * @property {boolean} sourceMap // Enable source map support
 */

/**
 * Returns the callSite
 * @param {number} frameCount
 * @param {CallSiteOptions} options
 * @returns {CallSite[]}
 */
function getCallSites(frameCount = 10, options) {
  // If options is not provided check if frameCount is an object
  if (options === undefined) {
    if (typeof frameCount === 'object') {
      // If frameCount is an object, it is the options object
      options = frameCount;
      validateObject(options, 'options');
      if (options.sourceMap !== undefined) {
        validateBoolean(options.sourceMap, 'options.sourceMap');
      }
      frameCount = 10;
    } else {
      // If options is not provided, set it to an empty object
      options = {};
    };
  } else {
    // If options is provided, validate it
    validateObject(options, 'options');
    if (options.sourceMap !== undefined) {
      validateBoolean(options.sourceMap, 'options.sourceMap');
    }
  }

  // Using kDefaultMaxCallStackSizeToCapture as reference
  validateNumber(frameCount, 'frameCount', 1, 200);
  // If options.sourceMaps is true or if sourceMaps are enabled but the option.sourceMaps is not set explictly to false
  if (options.sourceMap === true || (getOptionValue('--enable-source-maps') && options.sourceMap !== false)) {
    return mapCallSite(binding.getCallSites(frameCount));
  }
  return binding.getCallSites(frameCount);
};

// Keep the `exports =` so that various functions can still be monkeypatched
module.exports = {
  _errnoException,
  _exceptionWithHostPort,
  _extend: deprecate(_extend,
                     'The `util._extend` API is deprecated. Please use Object.assign() instead.',
                     'DEP0060'),
  callbackify,
  debug: debuglog,
  debuglog,
  deprecate,
  format,
  styleText,
  formatWithOptions,
  // Deprecated getCallSite.
  // This API can be removed in next semver-minor release.
  getCallSite: deprecate(getCallSites,
                         'The `util.getCallSite` API has been renamed to `util.getCallSites()`.',
                         'ExperimentalWarning'),
  getCallSites,
  getSystemErrorMap,
  getSystemErrorName,
  getSystemErrorMessage,
  inherits,
  inspect,
  isArray: deprecate(ArrayIsArray,
                     'The `util.isArray` API is deprecated. Please use `Array.isArray()` instead.',
                     'DEP0044'),
  isBoolean: deprecate(isBoolean,
                       'The `util.isBoolean` API is deprecated.  Please use `typeof arg === "boolean"` instead.',
                       'DEP0045'),
  isBuffer: deprecate(isBuffer,
                      'The `util.isBuffer` API is deprecated. Please use `Buffer.isBuffer()` instead.',
                      'DEP0046'),
  isDeepStrictEqual(a, b) {
    if (internalDeepEqual === undefined) {
      internalDeepEqual = require('internal/util/comparisons')
        .isDeepStrictEqual;
    }
    return internalDeepEqual(a, b);
  },
  isNull: deprecate(isNull,
                    'The `util.isNull` API is deprecated. Please use `arg === null` instead.',
                    'DEP0050'),
  isNullOrUndefined: deprecate(isNullOrUndefined,
                               'The `util.isNullOrUndefined` API is deprecated. ' +
                               'Please use `arg === null || arg === undefined` instead.',
                               'DEP0051'),
  isNumber: deprecate(isNumber,
                      'The `util.isNumber` API is deprecated. Please use `typeof arg === "number"` instead.',
                      'DEP0052'),
  isString: deprecate(isString,
                      'The `util.isString` API is deprecated.  Please use `typeof arg === "string"` instead.',
                      'DEP0056'),
  isSymbol: deprecate(isSymbol,
                      'The `util.isSymbol` API is deprecated.  Please use `arg === "symbol"` instead.',
                      'DEP0057'),
  isUndefined: deprecate(isUndefined,
                         'The `util.isUndefined` API is deprecated. Please use `arg === undefined` instead.',
                         'DEP0058'),
  isRegExp: deprecate(types.isRegExp,
                      'The `util.isRegExp` API is deprecated. Please use `arg instanceof RegExp` instead.',
                      'DEP0055'),
  isObject: deprecate(isObject,
                      'The `util.isObject` API is deprecated. ' +
                      'Please use `arg !== null && typeof arg === "object"` instead.',
                      'DEP0053'),
  isDate: deprecate(types.isDate,
                    'The `util.isDate` API is deprecated.  Please use `arg instanceof Date` instead.',
                    'DEP0047'),
  isError: deprecate(isError,
                     'The `util.isError` API is deprecated. ' +
                     'Please use `ObjectPrototypeToString(e) === "[object Error]" ' +
                     '|| e instanceof Error` instead.',
                     'DEP0048'),
  isFunction: deprecate(isFunction,
                        'The `util.isFunction` API is deprecated.  Please use `typeof arg === "function"` instead.',
                        'DEP0049'),
  isPrimitive: deprecate(isPrimitive,
                         'The `util.isPrimitive` API is deprecated. ' +
                         'Please use `arg === null || ' +
                         '(typeof arg !== "object" && typeof arg !== "function")` instead.',
                         'DEP0054'),
  log: deprecate(log,
                 'The `util.log API is deprecated. ' +
                 'Please use console.log() with a custom formatter or a third-party logger instead.',
                 'DEP0059'),
  promisify,
  stripVTControlCharacters,
  toUSVString(input) {
    return StringPrototypeToWellFormed(`${input}`);
  },
  get transferableAbortSignal() {
    return lazyAbortController().transferableAbortSignal;
  },
  get transferableAbortController() {
    return lazyAbortController().transferableAbortController;
  },
  get aborted() {
    return lazyAbortController().aborted;
  },
  types,
  parseEnv,
};

defineLazyProperties(
  module.exports,
  'internal/util/parse_args/parse_args',
  ['parseArgs'],
);

defineLazyProperties(
  module.exports,
  'internal/encoding',
  ['TextDecoder', 'TextEncoder'],
);

defineLazyProperties(
  module.exports,
  'internal/mime',
  ['MIMEType', 'MIMEParams'],
);

defineLazyProperties(
  module.exports,
  'internal/util/diff',
  ['diff'],
);
