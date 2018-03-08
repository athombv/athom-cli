'use strict';

const AppPlugin = require('../AppPlugin');

class AppPluginZwave extends AppPlugin {
	
	async run() {		
		await this.installNpmPackage({
			id: 'homey-meshdriver',
			version: this._options.version,
		})
	}
	
}

module.exports = AppPluginZwave;