'use strict';

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