'use strict';

const Log = require('../../..').Log;
const App = require('../../..').App;
const colors = require('colors');

exports.desc = 'Switch Homey App structure to compose plugin';
exports.handler = async yargs => {
	
	let appPath = yargs.path || process.cwd();

	try {
		let app = new App( appPath );
		await app.switchToCompose();
	} catch( err ) {
		Log(colors.red(err.message));
	}

}