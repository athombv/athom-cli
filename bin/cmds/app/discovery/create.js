'use strict';

const Log = require('../../../..').Log;
const App = require('../../../..').App;
const colors = require('colors');

exports.desc = 'Create a new Discovery strategy';
exports.handler = async yargs => {
	
	let appPath = yargs.path || process.cwd();

	try {
		let app = new App( appPath );
		await app.createDiscovery();
	} catch( err ) {
		Log(colors.red(err.message));
	}

}