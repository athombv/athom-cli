'use strict';

const Log = require('../../..').Log;
const App = require('../../..').App;
const colors = require('colors');

exports.desc = 'Run a Homey App in development mode';
exports.builder = yargs => {
	return yargs
		.option('clean', {
			alias: 'c',
			type: 'boolean',
			default: false,
		})
		.option('skip-build', {
			alias: 's',
			type: 'boolean',
			default: false,
		});
}
exports.handler = async yargs => {

	let appPath = yargs.path || process.cwd();

	try {
		let app = new App( appPath );
		await app.run({
			clean: yargs.clean,
			skipBuild: yargs.skipBuild,
		});
	} catch( err ) {
		Log(colors.red(err.message));
	}

}