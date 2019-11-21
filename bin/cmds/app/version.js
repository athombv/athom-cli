'use strict';

const Log = require('../../..').Log;
const App = require('../../..').App;
const colors = require('colors');

exports.desc = 'Update a Homey App\'s version';
/*
exports.builder = yargs => {
	return yargs.option('level', {
		alias: 'l',
		default: 'debug',
		type: 'string',
	})
}
*/
exports.handler = async yargs => {

	try {
		const app = new App( yargs.path );
		const version = yargs._[yargs._.length-1];
		await app.version(version);
	} catch( err ) {
		console.trace(colors.red(err.message));
	}

}