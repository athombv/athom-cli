'use strict';

const Log = require('../../../..').Log;
const App = require('../../../..').App;
const colors = require('colors');

exports.desc = 'Change the capabilities of a Driver';
exports.handler = async yargs => {
	
	let appPath = yargs.path || process.cwd();

	try {
		let app = new App( appPath );
		await app.changeDriverCapabilities();
	} catch( err ) {
		Log(colors.red(err.message));
	}

}