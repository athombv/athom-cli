'use strict';

const Log = require('../../..').Log;
const App = require('../../..').App;
const colors = require('colors');

exports.desc = 'Validate a Homey App';
exports.builder = yargs => {
	return yargs.option('level', {
		alias: 'l',
		default: 'debug',
		type: 'string',
	})
}
exports.handler = async yargs => {
	
//	let appPath = yargs.path || process.cwd();

	try {
		let app = new App( yargs.path );
		await app.preprocess();
		await app.validate({
			level: yargs.level,
		});
	} catch( err ) {
		console.trace(colors.red(err.message));
	}

}