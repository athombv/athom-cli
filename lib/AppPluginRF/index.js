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

const AppPlugin = require('../AppPlugin');

class AppPluginRF extends AppPlugin {
	
	async run() {		
		await this.installNpmPackage({
			id: 'homey-rfdriver',
			version: this._options.version,
		})
	}
	
}

module.exports = AppPluginRF;