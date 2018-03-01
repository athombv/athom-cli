'use strict';

const Log = require('../../..').Log;
const App = require('../../..').App;
const colors = require('colors');

exports.desc = 'Create a new Homey App';
exports.handler = async yargs => {
	
	let appPath = yargs.path || process.cwd();

	try {
		await App.create({ appPath });
	} catch( err ) {
		Log(colors.red(err.message));
	}

}