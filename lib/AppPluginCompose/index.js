'use strict';

const AppPlugin = require('../AppPlugin');

class AppPluginCompose extends AppPlugin {
	
	async run() {
		//throw new Error('Not implemented');
		console.log('Run', 'app', this._app, 'opts', this._opts)		
	}
	
}

module.exports = AppPluginCompose;