#!/usr/bin/env node

try {
	var REQUIRED_NODE_VERSION = '10.10';
	var version = process.version;
	if( version.indexOf('v') === 0 ) version = version.substr(1);
		version = version.split('.');

	var majorVersion = version[0];
		majorVersion = parseInt(majorVersion);

	var minorVersion = version[1];
		minorVersion = parseInt(minorVersion);

	if( majorVersion < 10 || ( majorVersion === 10 && minorVersion < 10 ) )
		return console.error(`Error: athom-cli requires Node.js v${REQUIRED_NODE_VERSION} or higher to run. Please upgrade your Node.js version and try again.`);

} catch( err ) {
	console.error(`Failed to determine Node.js version, please make sure you\'re using version ${REQUIRED_NODE_VERSION} or higher.`);
}

require('./athom-cli.js');