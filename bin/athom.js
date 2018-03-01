#!/usr/bin/env node

try {
	var version = process.version;
	if( version.indexOf('v') === 0 ) version = version.substr(1);
		version = version.split('.');
		
	var majorVersion = version[0];
		majorVersion = parseInt(majorVersion);
	if( majorVersion < 8 ) return console.error('Error: athom-cli requires Node.js 8 or higher to run. Please upgrade your Node.js version and try again.');
} catch( err ) {
	console.error('Failed to determine Node.js version, please make sure you\'re using version 8 or higher.');
}

require('./athom-cli.js');	