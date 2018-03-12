'use strict';

/*
	Plugin ID: rf
	
	This plugin installs homey-rfdriver.
	
	Enable the plugin by adding `{ "id": "rf" }` to your /.homeyplugins.json array
	
	Plugin options:
	{
		"version": "latest"
	}
*/

const fse = require('fs-extra');
const path = require('path');

const AppPlugin = require('../AppPlugin');

class AppPluginRF extends AppPlugin {
	
	async run() {		
		await app.installNpmPackage({
			id: 'homey-rfdriver',
			version: this._options.version,
		})
		
		let rfdriverPath = path.join( this._app.path, 'node_modules', 'homey-rfdriver' );
		let appComposePath = path.join( this._app.path, '.homeycompose' );
		let appComposeDriversPairPath = path.join( appComposePath, 'drivers', 'pair' );
		let appComposeDriversTemplatesPath = path.join( appComposePath, 'drivers', 'templates' );
		
		await fse.ensureDir( appComposeDriversPairPath );
		await fse.copy( path.join( rfdriverPath, 'assets', 'pair' ), appComposeDriversPairPath );
		
		await fse.ensureDir( appComposeDriversTemplatesPath );
		await fse.copy( path.join( rfdriverPath, 'assets', 'templates' ), appComposeDriversTemplatesPath );
		
	}
	
	static createDriverQuestions() {
		return [
			{
				type: 'confirm',
				name: 'isRf',
				default: false,
				message: 'Is this a RF device (Infrared, 433 MHz or 868 MHz)?',
				when: answers => !answers.isZwave && !answers.isZigbee,
			}
		]
	}
	
	static async createDriver({ app, driverPath, answers, driverJson }) {

		await app.addPlugin('rf');
		await app.addPlugin('compose');
		await app.installNpmPackage({
			id: 'homey-rfdriver',
			version: 'latest',
		});
		
		/*
		// TODO
		await fse.copy(
			path.join(app.path, 'node_modules', 'homey-rfdriver', 'assets', 'driver', 'driver.js'),
			path.join(driverPath, 'driver.js')
		);
		await fse.copy(
			path.join(app.path, 'node_modules', 'homey-rfdriver', 'assets', 'driver', 'device.js'),
			path.join(driverPath, 'device.js')
		);
		*/
		
	}
	
}

module.exports = AppPluginRF;