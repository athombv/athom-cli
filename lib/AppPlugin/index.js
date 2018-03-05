'use strict';

class AppPlugin {
	
	constructor( app, opts = {}) {
		this._app = app;
		this._opts = opts;
	}
	
	async run() {
		throw new Error('Not implemented, your plugin should extend the run() method');
	}
	
	log(...args) {
		this._app.log(`${this.constructor.name}`, ...args);
	}
	
}

module.exports = AppPlugin;