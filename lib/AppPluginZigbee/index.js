'use strict';

/*
	Plugin ID: zigbee
	
	This plugin installs homey-meshdriver.
	
	Enable the plugin by adding `{ "id": "zigbee" }` to your /.homeyplugins.json array
	
	Plugin options:
	{
		"version": "latest"
	}
*/

const AppPlugin = require('../AppPlugin');

class AppPluginZigbee extends AppPlugin {
	
	async run() {		
		await this.installNpmPackage({
			id: 'homey-meshdriver',
			version: this._options.version,
		})
	}
	
}

module.exports = AppPluginZigbee;