const isNode =
  typeof process !== 'undefined' &&
  process.versions != null &&
  process.versions.node != null;

const DEBUG = isNode ? !!process.env.DEBUG : false;

const debugLog = (message?: any, ...optionalParams: any[]) => {
  if (DEBUG) {
    console.debug(message, ...optionalParams);
  }
};

export { DEBUG, debugLog };
